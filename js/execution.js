/**
 * execution.js — Execution panel UI for AnansiWorkbench.
 * Manages run creation, job scheduling, worker communication, and live stats display.
 */

(() => {
    'use strict';

    const { formatDateTime, formatDuration, plural } = WorkbenchUtils;

    let _worker = null;
    let _currentRunId = null;
    let _statsInterval = null;
    let _startTime = null;
    let _pendingStart = null; // { experimentId } set by bus event

    // ─── Worker Management ────────────────────────────────────────────────────────

    function ensureWorker() {
        if (_worker) return;

        // On file:// protocol, Web Workers and fetch are blocked by browser origin policy.
        // Instantly activate the Inline Execution Engine with zero console warnings.
        if (window.location.protocol === 'file:') {
            setupInlineExecutionEngine();
            return;
        }

        try {
            _worker = new Worker('worker.js');
            _worker.addEventListener('message', onWorkerMessage);
            _worker.addEventListener('error', e => {
                console.error('[Execution] Worker error:', e);
                showToast('Worker error: ' + e.message, 'error');
            });
        } catch {
            setupInlineExecutionEngine();
        }
    }

    let _inlinePaused = false;

    function setupInlineExecutionEngine() {
        const listeners = [];
        _worker = {
            postMessage(msg) {
                setTimeout(() => processInlineWorkerMessage(msg), 10);
            },
            addEventListener(type, fn) {
                if (type === 'message') listeners.push(fn);
            },
            removeEventListener(type, fn) {
                const idx = listeners.indexOf(fn);
                if (idx !== -1) listeners.splice(idx, 1);
            }
        };

        function sendToUI(type, data = {}) {
            const evt = { data: { type, ...data } };
            listeners.forEach(fn => fn(evt));
        }

        async function processInlineWorkerMessage(msg) {
            switch (msg.type) {
                case 'PING':
                    sendToUI('PONG');
                    break;
                case 'START':
                    _inlinePaused = false;
                    await runInlineBatch(msg.runId, sendToUI);
                    break;
                case 'RESUME':
                    _inlinePaused = false;
                    await runInlineBatch(msg.runId, sendToUI);
                    break;
                case 'PAUSE':
                    _inlinePaused = true;
                    sendToUI('BATCH_PAUSED');
                    break;
                default:
                    break;
            }
        }

        setTimeout(() => sendToUI('READY'), 20);
    }

    async function runInlineBatch(runId, sendToUI) {
        try {
            const run = await WorkbenchDB.getRun(runId);
            const snapshot = run?.snapshot || {};
            const jobs = await WorkbenchDB.getPendingJobsForRun(runId);
            const totalStats = await WorkbenchDB.getJobStats(runId);
            sendToUI('STATUS', { stats: totalStats, runId });

            for (const job of jobs) {
                if (_inlinePaused) {
                    sendToUI('BATCH_PAUSED');
                    return;
                }

                sendToUI('JOB_STARTED', { jobId: job.id });
                await WorkbenchDB.saveJob({ ...job, status: 'in_progress', startedAt: new Date().toISOString() });

                const model = await WorkbenchDB.getModel(job.modelId);
                if (!model) {
                    await WorkbenchDB.saveJob({ ...job, status: 'failed', lastError: 'Model not found' });
                    sendToUI('JOB_FAILED', { jobId: job.id, error: 'Model not found' });
                    continue;
                }

                // Construct prompt messages
                const personality = job.effectivePersonality || snapshot.personality || '';
                const scenario = job.effectiveScenario || snapshot.scenario || '';
                const initialMessage = job.effectiveInitialMessage || snapshot.initialMessage || '';
                const userResponse = job.userResponse || '';

                const messages = [];
                let systemContent = '';
                if (personality) systemContent += personality;
                if (personality && scenario) systemContent += '\n\n';
                if (scenario) systemContent += scenario;

                if (systemContent.trim()) {
                    messages.push({ role: 'system', content: systemContent.trim() });
                }
                if (initialMessage.trim()) {
                    messages.push({ role: 'assistant', content: initialMessage.trim() });
                }
                messages.push({ role: 'user', content: userResponse });

                let resultText = '';
                let modelUsed = model.modelIdentifier || model.name;
                let tokensIn = null;
                let tokensOut = null;
                let latencyMs = 0;

                const t0 = Date.now();

                try {
                    if (model.provider === 'mock') {
                        // Mock provider for explicit testing
                        const delay = model.mockDelay ?? 500;
                        await new Promise(r => setTimeout(r, delay));
                        resultText = `[Mock response to: "${userResponse.slice(0, 50)}..."]`;
                        tokensIn = 25;
                        tokensOut = 40;
                        latencyMs = Date.now() - t0;
                    } else {
                        // Real LLM fetch call (Chutes AI, OpenAI Compatible, etc.)
                        const defaultEp = model.provider === 'chutes' ? 'https://llm.chutes.ai/v1' : 'https://api.openai.com/v1';
                        const url = WorkbenchUtils.buildChatCompletionsUrl(model.endpoint || defaultEp, defaultEp);

                        const body = {
                            model: model.modelIdentifier,
                            messages,
                            temperature: model.temperature ?? snapshot.defaultParams?.temperature ?? 0.9,
                            max_tokens: model.maxTokens ?? snapshot.defaultParams?.max_tokens ?? 500,
                            ...(model.extraParams || {}),
                        };

                        const headers = { 'Content-Type': 'application/json' };
                        if (model.apiKey) {
                            headers['Authorization'] = `Bearer ${model.apiKey}`;
                        }

                        const response = await fetch(url, {
                            method: 'POST',
                            headers,
                            body: JSON.stringify(body),
                        });

                        if (!response.ok) {
                            const errText = await response.text().catch(() => '');
                            throw new Error(`HTTP ${response.status}: ${errText.slice(0, 200)}`);
                        }

                        const data = await response.json();
                        latencyMs = Date.now() - t0;
                        const choice = data.choices?.[0];
                        resultText = choice?.message?.content || '';
                        modelUsed = data.model || model.modelIdentifier;
                        tokensIn = data.usage?.prompt_tokens ?? null;
                        tokensOut = data.usage?.completion_tokens ?? null;
                    }

                    const resp = await WorkbenchDB.saveResponse({
                        id: WorkbenchDB.generateId(),
                        jobId: job.id,
                        runId: job.runId,
                        subtestId: job.subtestId,
                        modelId: job.modelId,
                        iteration: job.iteration,
                        text: resultText,
                        promptSent: messages,
                        modelUsed,
                        tokensIn,
                        tokensOut,
                        latencyMs,
                        reviewFlag: false,
                        createdAt: new Date().toISOString(),
                    });

                    await WorkbenchDB.saveJob({
                        ...job,
                        status: 'completed',
                        completedAt: new Date().toISOString()
                    });

                    sendToUI('JOB_COMPLETE', { jobId: job.id, responseId: resp.id });

                } catch (jobErr) {
                    console.error('[Execution Inline] Job execution error:', jobErr);
                    await WorkbenchDB.saveJob({
                        ...job,
                        status: 'failed',
                        lastError: String(jobErr.message || jobErr)
                    });
                    sendToUI('JOB_FAILED', { jobId: job.id, error: String(jobErr.message || jobErr) });
                }

                const currentStats = await WorkbenchDB.getJobStats(runId);
                sendToUI('STATUS', { stats: currentStats, runId });

                // Respect model request interval if defined
                const minInterval = model.requestInterval || snapshot.throttle?.minInterval || 500;
                if (minInterval > 0) {
                    await new Promise(r => setTimeout(r, minInterval));
                }
            }

            const runEnd = await WorkbenchDB.getRun(runId);
            if (runEnd) {
                await WorkbenchDB.saveRun({ ...runEnd, status: 'completed', completedAt: new Date().toISOString() });
            }

            sendToUI('BATCH_COMPLETE', { runId });
        } catch (err) {
            console.error('[Execution Inline] Batch error:', err);
            sendToUI('ERROR', { message: err.message });
        }
    }

    function onWorkerMessage(e) {
        const msg = e.data || {};
        switch (msg.type) {
            case 'READY': onWorkerReady(); break;
            case 'STATUS': updateStats(msg.stats); break;
            case 'JOB_STARTED': onJobStarted(msg); break;
            case 'JOB_COMPLETE': onJobComplete(msg); break;
            case 'JOB_FAILED': onJobFailed(msg); break;
            case 'BATCH_PAUSED': onBatchPaused(); break;
            case 'BATCH_COMPLETE': onBatchComplete(msg); break;
            case 'UNCERTAIN_JOBS': onUncertainJobs(msg.jobs); break;
            case 'ERROR': showToast('Worker: ' + msg.message, 'error'); break;
        }
    }

    function onWorkerReady() {
        WorkbenchState.workerRunning = true;
        updateControls('idle');
    }

    // ─── Run Creation ─────────────────────────────────────────────────────────────

    async function startRun(experimentId) {
        const exp = await WorkbenchDB.getExperiment(experimentId);
        if (!exp) { showToast('Experiment not found.', 'error'); return; }

        const enabledSubtests = (exp.subtests || []).filter(st => !st.disabled);

        // Resolve models: get all configured models from DB
        const allModels = await WorkbenchDB.getAllModels();
        const enabledModels = allModels.filter(m => m.enabled !== false);

        let models = exp.defaultModels || [];
        // Filter out any model IDs that no longer exist in DB
        models = models.filter(id => enabledModels.some(m => m.id === id));

        // Fallback: If no valid models selected in exp.defaultModels, use user's configured models (preferring real/non-mock providers)
        if (models.length === 0 && enabledModels.length > 0) {
            const realModels = enabledModels.filter(m => m.provider !== 'mock');
            const targetModels = realModels.length > 0 ? realModels : enabledModels;
            models = targetModels.map(m => m.id);
        }

        if (enabledSubtests.length === 0 || models.length === 0) {
            showToast('No enabled subtests or models configured.', 'error');
            return;
        }

        // Create run with config snapshot
        const run = await WorkbenchDB.saveRun({
            experimentId: exp.id,
            status: 'pending',
            snapshot: {
                title: exp.title,
                personality: exp.personality || '',
                scenario: exp.scenario || '',
                initialMessage: exp.initialMessage || '',
                defaultParams: exp.defaultParams || {},
                throttle: exp.throttle || {},
                defaultModels: models,
            },
        });

        // Build jobs
        const jobs = [];
        let sortKey = 0;
        for (const st of enabledSubtests) {
            const pMode = (st.inheritanceMode && st.inheritanceMode.personality) || 'inherit';
            const sMode = (st.inheritanceMode && st.inheritanceMode.scenario) || 'inherit';
            const iMode = (st.inheritanceMode && st.inheritanceMode.initialMessage) || 'inherit';

            const effectivePersonality = WorkbenchUtils.calculateEffectivePromptField(exp.personality, st.personality, pMode);
            const effectiveScenario = WorkbenchUtils.calculateEffectivePromptField(exp.scenario, st.scenario, sMode);
            const effectiveInitialMessage = WorkbenchUtils.calculateEffectivePromptField(exp.initialMessage, st.initialMessage, iMode);

            for (const resp of (st.userResponses || [])) {
                const testCaseId = WorkbenchDB.generateId();
                for (const modelId of models) {
                    const reps = st.repetitions ?? exp.defaultRepetitions ?? 5;
                    for (let i = 1; i <= reps; i++) {
                        jobs.push({
                            runId: run.id,
                            subtestId: st.id,
                            testCaseId,
                            modelId,
                            iteration: i,
                            sortKey: sortKey++,
                            userResponse: resp,
                            effectivePersonality,
                            effectiveScenario,
                            effectiveInitialMessage,
                            promptSnapshot: {
                                personality: effectivePersonality,
                                scenario: effectiveScenario,
                                initialMessage: effectiveInitialMessage,
                                userResponse: resp,
                                modelId,
                            },
                        });
                    }
                }
            }
        }

        await WorkbenchDB.bulkCreateJobs(jobs);

        _currentRunId = run.id;
        _startTime = Date.now();
        WorkbenchState.selectedRunId = run.id;

        renderRunInfo(exp, run, jobs.length);
        updateControls('running');

        ensureWorker();
        _worker.postMessage({ type: 'START', runId: run.id, config: run.snapshot });

        startStatsPolling();

        showToast(`Started: ${plural(jobs.length, 'job')} queued.`, 'success');
    }

    // ─── Resume existing run ──────────────────────────────────────────────────────

    async function resumeRun(runId) {
        const run = await WorkbenchDB.getRun(runId);
        if (!run) { showToast('Run not found.', 'error'); return; }

        _currentRunId = runId;
        _startTime = Date.now();
        WorkbenchState.selectedRunId = runId;

        const exp = await WorkbenchDB.getExperiment(run.experimentId);
        const stats = await WorkbenchDB.getJobStats(runId);
        renderRunInfo(exp, run, stats.total);
        updateStats(stats);
        updateControls('running');

        ensureWorker();
        _worker.postMessage({ type: 'RESUME', runId, config: run.snapshot });

        startStatsPolling();
        showToast('Run resumed.', 'success');
    }

    // ─── Controls ─────────────────────────────────────────────────────────────────

    function pause() {
        if (!_worker) return;
        _worker.postMessage({ type: 'PAUSE' });
        updateControls('pausing');
    }

    function resume() {
        if (!_worker || !_currentRunId) return;
        _worker.postMessage({ type: 'RESUME', runId: _currentRunId });
        updateControls('running');
        startStatsPolling();
    }

    function cancel() {
        if (!_worker || !_currentRunId) return;
        showConfirm('Cancel remaining jobs? Completed responses are preserved.', 'Cancel Run').then(ok => {
            if (!ok) return;
            _worker.postMessage({ type: 'CANCEL', runId: _currentRunId });
            updateControls('idle');
            stopStatsPolling();
        });
    }

    async function retryFailed() {
        if (!_worker || !_currentRunId) return;
        const run = await WorkbenchDB.getRun(_currentRunId);
        _worker.postMessage({ type: 'RETRY_FAILED', runId: _currentRunId, config: run?.snapshot });
        updateControls('running');
        startStatsPolling();
    }

    // ─── Uncertain Job Recovery ───────────────────────────────────────────────────

    function onUncertainJobs(jobs) {
        const container = document.getElementById('uncertain-panel');
        if (!container) return;
        container.style.display = '';
        container.innerHTML = `
      <div class="uncertain-header">⚠️ ${plural(jobs.length, 'job')} were interrupted mid-request.</div>
      <p class="uncertain-sub">These jobs were in-progress when the worker stopped. Their status is unknown.</p>
      <div class="uncertain-actions">
        <button class="btn btn-primary" id="btn-recover-retry">Retry These Jobs</button>
        <button class="btn" id="btn-recover-skip">Mark as Skipped</button>
      </div>`;
        const ids = jobs.map(j => j.id);
        document.getElementById('btn-recover-retry').onclick = () => {
            container.style.display = 'none';
            _worker.postMessage({ type: 'RECOVER_UNCERTAIN', runId: _currentRunId, jobIds: ids, action: 'retry' });
            updateControls('running');
            startStatsPolling();
        };
        document.getElementById('btn-recover-skip').onclick = () => {
            container.style.display = 'none';
            _worker.postMessage({ type: 'RECOVER_UNCERTAIN', runId: _currentRunId, jobIds: ids, action: 'skip' });
        };
    }

    // ─── Stats & Progress ─────────────────────────────────────────────────────────

    function updateStats(stats) {
        if (!stats) return;
        const completedPct = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

        setEl('stat-total', stats.total);
        setEl('stat-completed', stats.completed);
        setEl('stat-pending', stats.pending);
        setEl('stat-active', stats.in_progress);
        setEl('stat-failed', stats.failed);
        setEl('stat-pct', completedPct + '%');

        const bar = document.getElementById('exec-progress-bar');
        if (bar) bar.style.width = completedPct + '%';

        // ETA
        if (_startTime && stats.completed > 0 && stats.pending > 0) {
            const elapsed = Date.now() - _startTime;
            const rate = stats.completed / elapsed;
            const remainingMs = stats.pending / rate;
            setEl('stat-eta', formatDuration(remainingMs));
        }
        if (_startTime) setEl('stat-elapsed', formatDuration(Date.now() - _startTime));

        // Automatic completion transition when all jobs are finished
        if (stats.total > 0 && stats.pending === 0 && stats.in_progress === 0 && stats.uncertain === 0) {
            updateControls('completed');
            stopStatsPolling();
            setEl('stat-eta', 'Done');
            renderRunHistory();
        }
    }

    function setEl(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

    function onJobStarted(msg) {
        appendLog(`▶ Job ${msg.jobId.slice(0, 8)}… started`);
    }

    function onJobComplete(msg) {
        appendLog(`✓ Job ${msg.jobId.slice(0, 8)}… complete`);
        WorkbenchBus.emit('response:saved', { responseId: msg.responseId });
    }

    function onJobFailed(msg) {
        appendLog(`✗ Job ${msg.jobId.slice(0, 8)}… failed: ${msg.error}`, 'log-error');
    }

    function onBatchPaused() {
        stopStatsPolling();
        updateControls('paused');
        showToast('Batch paused. Active requests have completed.', 'info');
    }

    function onBatchComplete(msg) {
        stopStatsPolling();
        updateControls('completed');
        setEl('stat-eta', 'Done');
        appendLog('✅ Batch complete!', 'log-success');
        showToast('Batch complete! All jobs finished.', 'success');
        WorkbenchBus.emit('batch:complete', { runId: msg.runId });
        renderRunHistory();
    }

    function appendLog(msg, cls = '') {
        const log = document.getElementById('exec-log');
        if (!log) return;
        const entry = document.createElement('div');
        entry.className = 'log-entry ' + cls;
        entry.textContent = new Date().toLocaleTimeString() + ' — ' + msg;
        log.appendChild(entry);
        log.scrollTop = log.scrollHeight;
    }

    // ─── Stats polling ────────────────────────────────────────────────────────────

    function startStatsPolling() {
        stopStatsPolling();
        _statsInterval = setInterval(async () => {
            if (!_currentRunId) return;
            const stats = await WorkbenchDB.getJobStats(_currentRunId);
            updateStats(stats);
        }, 2000);
    }

    function stopStatsPolling() {
        if (_statsInterval) { clearInterval(_statsInterval); _statsInterval = null; }
    }

    // ─── HUD Sidebar State ────────────────────────────────────────────────────────

    let _currentRunTitle = '';
    let _lastHudMode = 'idle';

    function toggleHudExpand(evt) {
        if (evt && evt.target && evt.target.closest && evt.target.closest('.btn-xs')) return;
        const hud = document.getElementById('exec-hud-sidebar');
        const btn = document.getElementById('hud-toggle-btn');
        if (!hud) return;

        const isCollapsed = hud.classList.toggle('collapsed');
        if (btn) btn.textContent = isCollapsed ? '+' : '–';
        localStorage.setItem('workbench_hud_collapsed', isCollapsed ? 'true' : 'false');
    }

    function updateHud(stats, mode) {
        const hud = document.getElementById('exec-hud-sidebar');
        if (!hud) return;

        if (mode) _lastHudMode = mode;
        const currentMode = mode || _lastHudMode;

        // Show HUD if there is a run ID or active execution
        if (_currentRunId || currentMode === 'running' || currentMode === 'paused' || currentMode === 'completed') {
            hud.style.display = '';
        }

        // Run Title
        setEl('hud-run-name', _currentRunTitle || 'Execution Run');

        // Status Dot
        const dot = document.getElementById('hud-status-dot');
        if (dot) {
            dot.className = 'hud-status-dot ' + (
                currentMode === 'running' ? 'active' :
                    currentMode === 'paused' || currentMode === 'pausing' ? 'paused' :
                        currentMode === 'completed' ? 'completed' : ''
            );
        }

        if (stats) {
            const completedPct = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
            const bar = document.getElementById('hud-progress-bar');
            if (bar) bar.style.width = completedPct + '%';

            setEl('hud-pct', completedPct + '%');
            setEl('hud-counts', `${stats.completed} / ${stats.total} completed`);
            setEl('hud-completed', stats.completed);
            setEl('hud-active', stats.in_progress);
            setEl('hud-failed', stats.failed);

            if (_startTime && stats.completed > 0 && stats.pending > 0) {
                const elapsed = Date.now() - _startTime;
                const rate = stats.completed / elapsed;
                const remainingMs = stats.pending / rate;
                setEl('hud-eta', formatDuration(remainingMs));
            } else if (currentMode === 'completed') {
                setEl('hud-eta', 'Done');
            } else {
                setEl('hud-eta', '--');
            }
        }

        if (_startTime) {
            setEl('hud-elapsed', formatDuration(Date.now() - _startTime));
        }

        // Controls visibility
        const setVis = (id, vis) => { const el = document.getElementById(id); if (el) el.style.display = vis ? '' : 'none'; };
        setVis('hud-btn-cancel', currentMode === 'running' || currentMode === 'paused');
        setVis('hud-btn-pause', currentMode === 'running');
        setVis('hud-btn-resume', currentMode === 'paused');
    }

    // ─── Run info panel ───────────────────────────────────────────────────────────

    function renderRunInfo(exp, run, jobCount) {
        _currentRunTitle = exp ? exp.title : `Run ${run.id.slice(0, 8)}`;
        const titleEl = document.getElementById('exec-run-title');
        const metaEl = document.getElementById('exec-run-meta');
        if (titleEl) titleEl.textContent = exp ? `${exp.title} — Run` : `Run ${run.id.slice(0, 8)}`;
        if (metaEl) metaEl.textContent = `${plural(jobCount, 'job')} · Started ${formatDateTime(new Date().toISOString())}`;
        const uncertain = document.getElementById('uncertain-panel');
        if (uncertain) uncertain.style.display = 'none';

        updateHud(null, 'running');
    }

    // ─── Control state ────────────────────────────────────────────────────────────

    function updateControls(mode) {
        // mode: 'idle' | 'running' | 'pausing' | 'paused' | 'completed'
        const set = (id, vis) => { const el = document.getElementById(id); if (el) el.style.display = vis ? '' : 'none'; };
        set('btn-exec-pause', mode === 'running');
        set('btn-exec-resume', mode === 'paused');
        set('btn-exec-cancel', mode === 'running' || mode === 'paused');
        set('btn-exec-retry', mode === 'idle' || mode === 'paused' || mode === 'completed');
        const statusEl = document.getElementById('exec-status-badge');
        if (statusEl) {
            if (mode === 'running') {
                statusEl.textContent = '● Running';
                statusEl.className = 'status-badge badge-green';
            } else if (mode === 'paused') {
                statusEl.textContent = '⏸ Paused';
                statusEl.className = 'status-badge badge-yellow';
            } else if (mode === 'pausing') {
                statusEl.textContent = '⏳ Pausing…';
                statusEl.className = 'status-badge badge-yellow';
            } else if (mode === 'completed') {
                statusEl.textContent = '✓ Completed';
                statusEl.className = 'status-badge badge-teal';
            } else {
                statusEl.textContent = '○ Idle';
                statusEl.className = 'status-badge badge-gray';
            }
        }

        updateHud(null, mode);
    }

    // ─── Load run history ─────────────────────────────────────────────────────────

    async function renderRunHistory() {
        const container = document.getElementById('run-history-list');
        if (!container) return;

        const allExps = await WorkbenchDB.getAllExperiments();
        const allRuns = await WorkbenchDB.getAll('runs');
        allRuns.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

        if (allRuns.length === 0) {
            container.innerHTML = '<div class="empty-state-sm"><p>No runs yet.</p></div>';
            return;
        }

        container.innerHTML = allRuns.map(run => {
            const exp = allExps.find(e => e.id === run.experimentId);
            const badge = {
                completed: 'badge-teal', running: 'badge-green', paused: 'badge-yellow',
                cancelled: 'badge-red', pending: 'badge-gray',
            }[run.status] || 'badge-gray';
            return `
        <div class="run-row">
          <div class="run-info">
            <span class="run-exp">${WorkbenchUtils.escapeHtml(exp?.title || 'Unknown Experiment')}</span>
            <span class="badge ${badge}">${run.status}</span>
            <span class="run-date">${formatDateTime(run.createdAt)}</span>
          </div>
          <div class="run-actions">
            ${run.status === 'paused' ? `<button class="btn-sm btn-primary" onclick="WorkbenchExecution.resumeRun('${run.id}')">Resume</button>` : ''}
            <button class="btn-sm" onclick="WorkbenchExecution.reviewRun('${run.id}')">Review</button>
          </div>
        </div>`;
        }).join('');
    }

    function reviewRun(runId) {
        WorkbenchState.selectedRunId = runId;
        WorkbenchApp.activateTab('review');
    }

    // ─── Init ─────────────────────────────────────────────────────────────────────

    async function init() {
        ensureWorker();

        document.getElementById('btn-exec-pause')?.addEventListener('click', pause);
        document.getElementById('btn-exec-resume')?.addEventListener('click', resume);
        document.getElementById('btn-exec-cancel')?.addEventListener('click', cancel);
        document.getElementById('btn-exec-retry')?.addEventListener('click', retryFailed);

        const savedCollapsed = localStorage.getItem('workbench_hud_collapsed');
        const hud = document.getElementById('exec-hud-sidebar');
        const btn = document.getElementById('hud-toggle-btn');
        if (hud && savedCollapsed !== null) {
            if (savedCollapsed === 'false') {
                hud.classList.remove('collapsed');
                if (btn) btn.textContent = '–';
            } else {
                hud.classList.add('collapsed');
                if (btn) btn.textContent = '+';
            }
        }

        updateControls('idle');

        WorkbenchBus.on('run:start', async ({ experimentId }) => {
            await startRun(experimentId);
        });

        WorkbenchApp.registerTab('execution', renderRunHistory);
    }

    // ─── Stats & Progress ─────────────────────────────────────────────────────────

    function updateStats(stats) {
        if (!stats) return;
        const completedPct = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

        setEl('stat-total', stats.total);
        setEl('stat-completed', stats.completed);
        setEl('stat-pending', stats.pending);
        setEl('stat-active', stats.in_progress);
        setEl('stat-failed', stats.failed);
        setEl('stat-pct', completedPct + '%');

        const bar = document.getElementById('exec-progress-bar');
        if (bar) bar.style.width = completedPct + '%';

        // ETA
        if (_startTime && stats.completed > 0 && stats.pending > 0) {
            const elapsed = Date.now() - _startTime;
            const rate = stats.completed / elapsed;
            const remainingMs = stats.pending / rate;
            setEl('stat-eta', formatDuration(remainingMs));
        }
        if (_startTime) setEl('stat-elapsed', formatDuration(Date.now() - _startTime));

        updateHud(stats);

        // Automatic completion transition when all jobs are finished
        if (stats.total > 0 && stats.pending === 0 && stats.in_progress === 0 && stats.uncertain === 0) {
            updateControls('completed');
            stopStatsPolling();
            setEl('stat-eta', 'Done');
            renderRunHistory();
        }
    }

    function setEl(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

    function onJobStarted(msg) {
        appendLog(`▶ Job ${msg.jobId.slice(0, 8)}… started`);
    }

    function onJobComplete(msg) {
        appendLog(`✓ Job ${msg.jobId.slice(0, 8)}… complete`);
        WorkbenchBus.emit('response:saved', { responseId: msg.responseId });
    }

    function onJobFailed(msg) {
        appendLog(`✗ Job ${msg.jobId.slice(0, 8)}… failed: ${msg.error}`, 'log-error');
    }

    function onBatchPaused() {
        stopStatsPolling();
        updateControls('paused');
        showToast('Batch paused. Active requests have completed.', 'info');
    }

    function onBatchComplete(msg) {
        stopStatsPolling();
        updateControls('completed');
        setEl('stat-eta', 'Done');
        appendLog('✅ Batch complete!', 'log-success');
        showToast('Batch complete! All jobs finished.', 'success');
        WorkbenchBus.emit('batch:complete', { runId: msg.runId });
        renderRunHistory();
    }

    function appendLog(msg, cls = '') {
        const log = document.getElementById('exec-log');
        if (!log) return;
        const entry = document.createElement('div');
        entry.className = 'log-entry ' + cls;
        entry.textContent = new Date().toLocaleTimeString() + ' — ' + msg;
        log.appendChild(entry);
        log.scrollTop = log.scrollHeight;
    }

    // ─── Stats polling ────────────────────────────────────────────────────────────

    function startStatsPolling() {
        stopStatsPolling();
        _statsInterval = setInterval(async () => {
            if (!_currentRunId) return;
            const stats = await WorkbenchDB.getJobStats(_currentRunId);
            updateStats(stats);
        }, 2000);
    }

    function stopStatsPolling() {
        if (_statsInterval) { clearInterval(_statsInterval); _statsInterval = null; }
    }

    window.WorkbenchExecution = { init, startRun, resumeRun, reviewRun, pause, resume, cancel, retryFailed, toggleHudExpand };
})();

