/**
 * worker.js — AnansiWorkbench persistent execution Web Worker.
 *
 * This worker runs batch LLM generation jobs independently of the UI thread.
 * All state is persisted in IndexedDB so the queue survives restarts.
 *
 * Message protocol (UI → Worker):
 *   { type: 'START',  runId, config }
 *   { type: 'PAUSE'  }
 *   { type: 'RESUME', runId }
 *   { type: 'CANCEL', runId }
 *   { type: 'RETRY_FAILED', runId }
 *   { type: 'RECOVER_UNCERTAIN', runId, jobIds, action } // action: 'retry'|'skip'
 *   { type: 'PING'  }  // health check
 *
 * Message protocol (Worker → UI):
 *   { type: 'READY'  }
 *   { type: 'STATUS', stats }
 *   { type: 'JOB_STARTED', jobId }
 *   { type: 'JOB_COMPLETE', jobId, responseId }
 *   { type: 'JOB_FAILED', jobId, error }
 *   { type: 'BATCH_PAUSED'  }
 *   { type: 'BATCH_COMPLETE', runId }
 *   { type: 'UNCERTAIN_JOBS', jobs }
 *   { type: 'ERROR', message }
 *   { type: 'PONG'  }
 */

'use strict';

// ─── IndexedDB (inline, no import) ───────────────────────────────────────────

let _db = null;
const DB_NAME = 'anansi-workbench';
const DB_VERSION = 1;

function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onsuccess = e => { _db = e.target.result; resolve(_db); };
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('DB blocked'));
        req.onupgradeneeded = () => reject(new Error('Worker opened DB before UI — schema mismatch'));
    });
}

function dbPromise(req) {
    return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}

async function dbGet(store, key) {
    const db = await openDB();
    return dbPromise(db.transaction(store, 'readonly').objectStore(store).get(key));
}

async function dbGetAll(store, indexName, value) {
    const db = await openDB();
    const tx = db.transaction(store, 'readonly');
    const s = tx.objectStore(store);
    return dbPromise(indexName ? s.index(indexName).getAll(value) : s.getAll());
}

async function dbPut(store, record) {
    const db = await openDB();
    return dbPromise(db.transaction(store, 'readwrite').objectStore(store).put(record));
}

async function dbPutBatch(store, records) {
    const db = await openDB();
    const tx = db.transaction(store, 'readwrite');
    const s = tx.objectStore(store);
    for (const r of records) s.put(r);
    return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
}

// ─── Workers state ────────────────────────────────────────────────────────────

let state = {
    runId: null,
    paused: false,
    cancelled: false,
    activeJobs: new Map(),   // jobId → { controller, startedAt }
    config: null,        // run config from UI
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function now() { return new Date().toISOString(); }

function send(msg) { self.postMessage(msg); }

function generateId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}

async function getJobStats(runId) {
    const jobs = await dbGetAll('jobs', 'runId', runId);
    return {
        total: jobs.length,
        pending: jobs.filter(j => j.status === 'pending').length,
        in_progress: jobs.filter(j => j.status === 'in_progress').length,
        uncertain: jobs.filter(j => j.status === 'uncertain').length,
        completed: jobs.filter(j => j.status === 'completed').length,
        failed: jobs.filter(j => j.status === 'failed').length,
        cancelled: jobs.filter(j => j.status === 'cancelled').length,
    };
}

async function emitStats(runId) {
    const stats = await getJobStats(runId || state.runId);
    send({ type: 'STATUS', stats, runId: runId || state.runId });
}

// ─── Prompt Construction ──────────────────────────────────────────────────────

/**
 * Build the messages array for a fresh conversation.
 * Each iteration is completely independent — no prior response context.
 * Preserves literal placeholders like {{User}} without processing.
 */
function buildMessages(snapshot, job, model) {
    const messages = [];

    // System-level: personality + scenario combined, or system_prompt if provider supports it
    const personality = job.effectivePersonality || snapshot.personality || '';
    const scenario = job.effectiveScenario || snapshot.scenario || '';

    let systemContent = '';
    if (personality) systemContent += personality;
    if (personality && scenario) systemContent += '\n\n';
    if (scenario) systemContent += scenario;

    if (systemContent.trim()) {
        messages.push({ role: 'system', content: systemContent.trim() });
    }

    // Initial message as assistant turn
    const initialMessage = job.effectiveInitialMessage || snapshot.initialMessage || '';
    if (initialMessage.trim()) {
        messages.push({ role: 'assistant', content: initialMessage.trim() });
    }

    // User response (the test stimulus)
    const userResponse = job.userResponse || '';
    messages.push({ role: 'user', content: userResponse });

    return messages;
}

// ─── Provider Adapters ───────────────────────────────────────────────────────

const ADAPTERS = {};

/**
 * OpenAI-compatible adapter.
 * Handles OpenAI, OpenRouter, any GGUF server, most open-source APIs.
 */
ADAPTERS.openai_compatible = {
    async call({ model, messages, params, apiKey, endpoint, timeout }) {
        const url = (endpoint || 'https://api.openai.com/v1') + '/chat/completions';
        const body = {
            model: model.modelIdentifier,
            messages,
            temperature: params.temperature ?? 0.9,
            max_tokens: params.max_tokens ?? 500,
            ...(model.extraParams || {}),
        };

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout || 30000);

        const t0 = Date.now();
        let response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timer);
        }

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            const err = new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
            err.status = response.status;
            err.retryAfter = parseInt(response.headers.get('retry-after') || '0') || null;
            throw err;
        }

        const data = await response.json();
        const latencyMs = Date.now() - t0;
        const choice = data.choices?.[0];
        const text = choice?.message?.content || '';
        const usage = data.usage || {};

        return {
            text,
            modelUsed: data.model || model.modelIdentifier,
            tokensIn: usage.prompt_tokens ?? null,
            tokensOut: usage.completion_tokens ?? null,
            latencyMs,
        };
    },
};

/**
 * Mock adapter — for testing without real API calls.
 * Returns a deterministic response based on the job.
 */
ADAPTERS.mock = {
    async call({ model, messages, params, timeout }) {
        // Simulate network latency
        const delay = model.mockDelay ?? (500 + Math.random() * 1000);
        await new Promise(res => setTimeout(res, delay));

        // Simulate configurable failures
        if (model.mockFailRate && Math.random() < model.mockFailRate) {
            const err = new Error('Mock provider: simulated failure');
            err.status = model.mockFailStatus || 500;
            throw err;
        }

        const userMsg = messages.find(m => m.role === 'user')?.content || '';
        return {
            text: `[Mock response to: "${userMsg.slice(0, 80)}..."] — Iteration generated by mock provider.`,
            modelUsed: model.modelIdentifier || 'mock-model',
            tokensIn: messages.reduce((n, m) => n + m.content.split(' ').length, 0),
            tokensOut: 42,
            latencyMs: delay,
        };
    },
};

function getAdapter(provider) {
    return ADAPTERS[provider] || ADAPTERS.openai_compatible;
}

// ─── Job Execution ────────────────────────────────────────────────────────────

let _concurrentActive = 0;

async function executeJob(job, modelRecord) {
    const runId = state.runId;
    send({ type: 'JOB_STARTED', jobId: job.id });

    // Mark in-progress
    await dbPut('jobs', { ...job, status: 'in_progress', startedAt: now(), attempts: (job.attempts || 0) + 1, updatedAt: now() });
    state.activeJobs.set(job.id, { startedAt: Date.now() });
    _concurrentActive++;

    const snapshot = state.config?.snapshot || {};
    const params = {
        temperature: modelRecord.temperature ?? snapshot.temperature ?? 0.9,
        max_tokens: modelRecord.maxTokens ?? snapshot.max_tokens ?? 500,
        ...(modelRecord.extraParams || {}),
    };

    const messages = buildMessages(snapshot, job, modelRecord);
    const adapter = getAdapter(modelRecord.provider);

    let attempt = 0;
    const maxAttempts = modelRecord.retryLimit ?? 3;
    let lastError = null;

    while (attempt <= maxAttempts) {
        if (state.cancelled) break;

        try {
            const result = await adapter.call({
                model: modelRecord,
                messages,
                params,
                apiKey: modelRecord.apiKey || '',
                endpoint: modelRecord.endpoint || '',
                timeout: modelRecord.requestTimeout || 30000,
            });

            // Save response immediately
            const responseId = generateId();
            await dbPut('responses', {
                id: responseId,
                jobId: job.id,
                runId: job.runId,
                subtestId: job.subtestId,
                modelId: job.modelId,
                iteration: job.iteration,
                text: result.text,
                promptSent: messages,
                modelUsed: result.modelUsed,
                tokensIn: result.tokensIn,
                tokensOut: result.tokensOut,
                costUsd: result.costUsd || null,
                latencyMs: result.latencyMs,
                reviewFlag: false,
                createdAt: now(),
            });

            // Mark job complete
            await dbPut('jobs', {
                ...job,
                status: 'completed',
                attempts: (job.attempts || 0) + attempt + 1,
                startedAt: job.startedAt || state.activeJobs.get(job.id)?.startedAt,
                completedAt: now(),
                updatedAt: now(),
                lastError: null,
            });

            state.activeJobs.delete(job.id);
            _concurrentActive--;
            send({ type: 'JOB_COMPLETE', jobId: job.id, responseId });
            await emitStats(runId);
            return;

        } catch (err) {
            lastError = String(err.message || err);
            attempt++;

            // Rate-limit: respect retry-after header
            if (err.status === 429 && err.retryAfter) {
                await sleep(err.retryAfter * 1000);
                continue;
            }

            // Auth failure: don't retry
            if (err.status === 401 || err.status === 403) break;

            // Timeout / network: retry with backoff
            if (attempt <= maxAttempts && !state.cancelled) {
                const backoff = (modelRecord.retryBackoff || 2000) * attempt;
                await sleep(backoff);
            }
        }
    }

    // All attempts exhausted
    const finalStatus = state.cancelled ? 'cancelled' : 'failed';
    await dbPut('jobs', {
        ...job,
        status: finalStatus,
        attempts: (job.attempts || 0) + attempt,
        lastError: lastError,
        updatedAt: now(),
    });

    state.activeJobs.delete(job.id);
    _concurrentActive--;
    send({ type: 'JOB_FAILED', jobId: job.id, error: lastError });
    await emitStats(runId);
}

function sleep(ms) {
    return new Promise(res => setTimeout(res, Math.max(ms, 0)));
}

// ─── Main Batch Loop ──────────────────────────────────────────────────────────

async function runBatch(runId) {
    state.paused = false;
    state.cancelled = false;

    // Mark run as running
    const run = await dbGet('runs', runId);
    if (run) await dbPut('runs', { ...run, status: 'running', startedAt: run.startedAt || now() });

    // Detect uncertain jobs from a prior crash (in_progress → uncertain)
    const allJobs = await dbGetAll('jobs', 'runId', runId);
    const uncertain = allJobs.filter(j => j.status === 'in_progress');
    if (uncertain.length > 0) {
        await dbPutBatch('jobs', uncertain.map(j => ({ ...j, status: 'uncertain', updatedAt: now() })));
        send({ type: 'UNCERTAIN_JOBS', jobs: uncertain });
        // Pause until user decides what to do with uncertain jobs
        state.paused = true;
        send({ type: 'BATCH_PAUSED' });
        await emitStats(runId);
        return;
    }

    await processPending(runId);
}

async function processPending(runId) {
    while (!state.cancelled) {
        if (state.paused) {
            await sleep(500);
            continue;
        }

        // Get pending jobs sorted by sortKey
        const pending = (await dbGetAll('jobs', 'runId', runId))
            .filter(j => j.status === 'pending')
            .sort((a, b) => a.sortKey - b.sortKey);

        if (pending.length === 0) break;

        // Find model config for concurrency limits
        const config = state.config || {};
        const globalConcurrency = config.throttle?.concurrency || 1;
        const minInterval = config.throttle?.minInterval || 1000;

        // Fill concurrency slots
        const slots = globalConcurrency - _concurrentActive;
        if (slots <= 0) { await sleep(200); continue; }

        const batch = pending.slice(0, slots);

        for (const job of batch) {
            if (state.paused || state.cancelled) break;

            const model = await dbGet('models', job.modelId);
            if (!model) {
                await dbPut('jobs', { ...job, status: 'failed', lastError: 'Model not found', updatedAt: now() });
                send({ type: 'JOB_FAILED', jobId: job.id, error: 'Model not found' });
                continue;
            }

            // Per-provider concurrency check
            const providerActive = [...state.activeJobs.values()].filter(a => a.modelId === job.modelId).length;
            const providerLimit = model.concurrencyLimit ?? 1;
            if (providerActive >= providerLimit) continue;

            // Execute without awaiting so we can fill other slots
            executeJob(job, model);

            // Enforce minimum interval between requests (per provider)
            const interval = Math.max(model.requestInterval || 0, minInterval);
            await sleep(interval);
        }

        // If no jobs were dispatched (all blocked by concurrency), wait a beat
        if (batch.length === 0 || _concurrentActive === 0) {
            await sleep(500);
        }
    }

    // Drain remaining active jobs
    while (_concurrentActive > 0) {
        await sleep(300);
    }

    if (!state.cancelled) {
        const run = await dbGet('runs', runId);
        if (run && run.status === 'running') {
            await dbPut('runs', { ...run, status: 'completed', completedAt: now() });
        }
        send({ type: 'BATCH_COMPLETE', runId });
        await emitStats(runId);
    }
}

// ─── Message Handler ──────────────────────────────────────────────────────────

self.addEventListener('message', async (e) => {
    const msg = e.data || {};

    try {
        switch (msg.type) {

            case 'START': {
                state.runId = msg.runId;
                state.config = msg.config || {};
                runBatch(msg.runId);
                break;
            }

            case 'PAUSE': {
                state.paused = true;
                // Let in-flight requests complete
                while (_concurrentActive > 0) await sleep(200);
                const run = await dbGet('runs', state.runId);
                if (run) await dbPut('runs', { ...run, status: 'paused' });
                send({ type: 'BATCH_PAUSED' });
                break;
            }

            case 'RESUME': {
                state.runId = msg.runId || state.runId;
                state.config = msg.config || state.config;
                state.paused = false;
                const resumeRun = await dbGet('runs', state.runId);
                if (resumeRun) await dbPut('runs', { ...resumeRun, status: 'running' });
                processPending(state.runId);
                break;
            }

            case 'CANCEL': {
                state.cancelled = true;
                state.paused = false;
                const jobs = await dbGetAll('jobs', 'runId', msg.runId || state.runId);
                const toCancel = jobs.filter(j => j.status === 'pending');
                await dbPutBatch('jobs', toCancel.map(j => ({ ...j, status: 'cancelled', updatedAt: now() })));
                const run = await dbGet('runs', msg.runId || state.runId);
                if (run) await dbPut('runs', { ...run, status: 'cancelled', completedAt: now() });
                await emitStats(msg.runId || state.runId);
                break;
            }

            case 'RETRY_FAILED': {
                const runId = msg.runId || state.runId;
                const failed = (await dbGetAll('jobs', 'runId', runId)).filter(j => j.status === 'failed');
                await dbPutBatch('jobs', failed.map(j => ({
                    ...j, status: 'pending', attempts: 0, lastError: null, updatedAt: now(),
                })));
                state.runId = runId;
                state.config = msg.config || state.config;
                state.paused = false;
                state.cancelled = false;
                processPending(runId);
                break;
            }

            case 'RECOVER_UNCERTAIN': {
                const runId = msg.runId || state.runId;
                const ids = new Set(msg.jobIds || []);
                const uncertain = (await dbGetAll('jobs', 'runId', runId)).filter(j => ids.has(j.id));
                const newStatus = msg.action === 'retry' ? 'pending' : 'skipped';
                await dbPutBatch('jobs', uncertain.map(j => ({
                    ...j, status: newStatus, attempts: 0, updatedAt: now(),
                })));
                state.paused = false;
                if (newStatus === 'pending') {
                    processPending(runId);
                } else {
                    await emitStats(runId);
                }
                break;
            }

            case 'PING': {
                send({ type: 'PONG' });
                break;
            }

            default:
                send({ type: 'ERROR', message: `Unknown message type: ${msg.type}` });
        }
    } catch (err) {
        send({ type: 'ERROR', message: String(err.message || err) });
    }
});

// ─── Ready ────────────────────────────────────────────────────────────────────

send({ type: 'READY' });
