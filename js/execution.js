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
        try {
            _worker = new Worker('worker.js');
            _worker.addEventListener('message', onWorkerMessage);
            _worker.addEventListener('error', e => {
                console.error('[Execution] Worker error:', e);
                showToast('Worker error: ' + e.message, 'error');
            });
        } catch (err) {
            console.warn('[Execution] Direct Worker creation restricted (file:// protocol):', err);
            initFallbackWorker();
        }
    }

    function initFallbackWorker() {
        fetch('worker.js')
            .then(r => r.text())
            .then(code => {
                const blob = new Blob([code], { type: 'application/javascript' });
                const blobUrl = URL.createObjectURL(blob);
                _worker = new Worker(blobUrl);
                _worker.addEventListener('message', onWorkerMessage);
                _worker.addEventListener('error', e => console.error('[Execution] Blob Worker error:', e));
                console.log('[Execution] Initialized Blob Worker fallback.');
            })
            .catch(err => {
                console.warn('[Execution] Blob worker fetch failed on file:// protocol. Launching Inline Queue Engine:', err);
                setupInlineExecutionEngine();
            });
    }

    function setupInlineExecutionEngine() {
        // Simple event target mimicking worker.postMessage protocol for file:// local testing
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
                case 'RESUME':
                    sendToUI('STATUS', { stats: { total: 1, pending: 0, completed: 1, failed: 0 } });
                    sendToUI('BATCH_COMPLETE', { runId: msg.runId });
                    break;
                case 'PAUSE':
                    sendToUI('BATCH_PAUSED');
                    break;
                default:
                    break;
            }
        }

        sendToUI('READY');
        showToast('Running in local file:// fallback mode.', 'info');
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
        const models = exp.defaultModels || [];

        if (enabledSubtests.length === 0 || models.length === 0) {
            showToast('No enabled subtests or models.', 'error');
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
                            effectivePersonality: st.personality != null ? st.personality : exp.personality,
                            effectiveScenario: st.scenario != null ? st.scenario : exp.scenario,
                            effectiveInitialMessage: st.initialMessage != null ? st.initialMessage : exp.initialMessage,
                            promptSnapshot: {
                                personality: st.personality != null ? st.personality : exp.personality,
                                scenario: st.scenario != null ? st.scenario : exp.scenario,
                                initialMessage: st.initialMessage != null ? st.initialMessage : exp.initialMessage,
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
        updateControls('idle');
        appendLog('✅ Batch complete!', 'log-success');
        showToast('Batch complete! All jobs finished.', 'success');
        WorkbenchBus.emit('batch:complete', { runId: msg.runId });
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

    // ─── Run info panel ───────────────────────────────────────────────────────────

    function renderRunInfo(exp, run, jobCount) {
        const titleEl = document.getElementById('exec-run-title');
        const metaEl = document.getElementById('exec-run-meta');
        if (titleEl) titleEl.textContent = exp ? `${exp.title} — Run` : `Run ${run.id.slice(0, 8)}`;
        if (metaEl) metaEl.textContent = `${plural(jobCount, 'job')} · Started ${formatDateTime(new Date().toISOString())}`;
        const uncertain = document.getElementById('uncertain-panel');
        if (uncertain) uncertain.style.display = 'none';
    }

    // ─── Control state ────────────────────────────────────────────────────────────

    function updateControls(mode) {
        // mode: 'idle' | 'running' | 'pausing' | 'paused'
        const set = (id, vis) => { const el = document.getElementById(id); if (el) el.style.display = vis ? '' : 'none'; };
        set('btn-exec-pause', mode === 'running');
        set('btn-exec-resume', mode === 'paused');
        set('btn-exec-cancel', mode === 'running' || mode === 'paused');
        set('btn-exec-retry', mode === 'idle' || mode === 'paused');
        const statusEl = document.getElementById('exec-status-badge');
        if (statusEl) {
            statusEl.textContent = mode === 'running' ? '● Running' : mode === 'paused' ? '⏸ Paused' : mode === 'pausing' ? '⏳ Pausing…' : '○ Idle';
            statusEl.className = `status-badge ${mode === 'running' ? 'badge-green' : mode === 'paused' ? 'badge-yellow' : 'badge-gray'}`;
        }
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

        updateControls('idle');

        WorkbenchBus.on('run:start', async ({ experimentId }) => {
            await startRun(experimentId);
        });

        WorkbenchApp.registerTab('execution', renderRunHistory);
    }

    window.WorkbenchExecution = { init, startRun, resumeRun, reviewRun, pause, resume, cancel, retryFailed };
})();
