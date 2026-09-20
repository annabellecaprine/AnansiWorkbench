/**
 * db.js — IndexedDB wrapper for AnansiWorkbench.
 *
 * Database: "anansi-workbench" v1
 * Stores:
 *   experiments      — reusable experiment definitions
 *   runs             — immutable execution snapshots
 *   jobs             — persistent execution queue
 *   responses        — raw generated responses (append-only)
 *   records          — user Test Record Sheet data
 *   models           — configured API providers (credentials stored here only)
 *   field_schemas    — custom recording field definitions
 *   charts           — saved chart configurations
 */

(() => {
    'use strict';

    const DB_NAME = 'anansi-workbench';
    const DB_VERSION = 2;

    let dbInstance = null;

    // ─── Utilities ───────────────────────────────────────────────────────────────

    function generateId() {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = (Math.random() * 16) | 0;
            return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });
    }

    function promisify(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // ─── Init ────────────────────────────────────────────────────────────────     

    async function initDB() {
        if (dbInstance) return dbInstance;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onblocked = () => {
                console.warn('[WorkbenchDB] Upgrade blocked by another tab.');
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // 1. Experiments
                if (!db.objectStoreNames.contains('experiments')) {
                    const s = db.createObjectStore('experiments', { keyPath: 'id' });
                    s.createIndex('title', 'title', { unique: false });
                    s.createIndex('status', 'status', { unique: false });
                    s.createIndex('category', 'category', { unique: false });
                    s.createIndex('modifiedAt', 'modifiedAt', { unique: false });
                }

                // 2. Runs
                if (!db.objectStoreNames.contains('runs')) {
                    const s = db.createObjectStore('runs', { keyPath: 'id' });
                    s.createIndex('experimentId', 'experimentId', { unique: false });
                    s.createIndex('status', 'status', { unique: false });
                    s.createIndex('startedAt', 'startedAt', { unique: false });
                }

                // 3. Jobs (persistent queue)
                if (!db.objectStoreNames.contains('jobs')) {
                    const s = db.createObjectStore('jobs', { keyPath: 'id' });
                    s.createIndex('runId', 'runId', { unique: false });
                    s.createIndex('status', 'status', { unique: false });
                    s.createIndex('subtestId', 'subtestId', { unique: false });
                    s.createIndex('modelId', 'modelId', { unique: false });
                    s.createIndex('sortKey', 'sortKey', { unique: false }); // for ordering
                }

                // 4. Responses (append-only raw evidence)
                if (!db.objectStoreNames.contains('responses')) {
                    const s = db.createObjectStore('responses', { keyPath: 'id' });
                    s.createIndex('jobId', 'jobId', { unique: false });
                    s.createIndex('runId', 'runId', { unique: false });
                    s.createIndex('subtestId', 'subtestId', { unique: false });
                    s.createIndex('modelId', 'modelId', { unique: false });
                }

                // 5. Records (user-entered Test Record Sheet data)
                if (!db.objectStoreNames.contains('records')) {
                    const s = db.createObjectStore('records', { keyPath: 'id' });
                    s.createIndex('responseId', 'responseId', { unique: false });
                    s.createIndex('runId', 'runId', { unique: false });
                }

                // 6. Models (API providers — credentials stored here)
                if (!db.objectStoreNames.contains('models')) {
                    const s = db.createObjectStore('models', { keyPath: 'id' });
                    s.createIndex('name', 'name', { unique: false });
                    s.createIndex('provider', 'provider', { unique: false });
                }

                // 7. Field Schemas (custom recording field definitions)
                if (!db.objectStoreNames.contains('field_schemas')) {
                    const s = db.createObjectStore('field_schemas', { keyPath: 'id' });
                    s.createIndex('experimentId', 'experimentId', { unique: false });
                }

                // 8. Charts (saved chart configurations)
                if (!db.objectStoreNames.contains('charts')) {
                    const s = db.createObjectStore('charts', { keyPath: 'id' });
                    s.createIndex('experimentId', 'experimentId', { unique: false });
                }

                // 9. Forge Assets (AnansiForge Vault persistence)
                if (!db.objectStoreNames.contains('forge_assets')) {
                    const s = db.createObjectStore('forge_assets', { keyPath: 'id' });
                    s.createIndex('category', 'category', { unique: false });
                    s.createIndex('type', 'type', { unique: false });
                    s.createIndex('name', 'name', { unique: false });
                }
            };

            request.onsuccess = (event) => {
                dbInstance = event.target.result;
                resolve(dbInstance);
            };

            request.onerror = () => reject(request.error);
        });
    }

    // ─── Generic helpers ──────────────────────────────────────────────────────────

    async function getAll(storeName, indexName, indexValue) {
        const db = dbInstance || await initDB();
        if (!db.objectStoreNames.contains(storeName)) return [];
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        if (indexName && indexValue !== undefined) {
            const idx = store.index(indexName);
            return promisify(idx.getAll(indexValue));
        }
        return promisify(store.getAll());
    }

    async function getOne(storeName, key) {
        const db = dbInstance || await initDB();
        if (!db.objectStoreNames.contains(storeName)) return null;
        const tx = db.transaction(storeName, 'readonly');
        return promisify(tx.objectStore(storeName).get(key));
    }

    async function putOne(storeName, record) {
        const db = dbInstance || await initDB();
        if (!db.objectStoreNames.contains(storeName)) return record;
        const tx = db.transaction(storeName, 'readwrite');
        await promisify(tx.objectStore(storeName).put(record));
        return record;
    }

    async function deleteOne(storeName, key) {
        const db = dbInstance || await initDB();
        if (!db.objectStoreNames.contains(storeName)) return;
        const tx = db.transaction(storeName, 'readwrite');
        return promisify(tx.objectStore(storeName).delete(key));
    }

    // Cursor helper for ordered iteration without loading everything into memory
    async function forEachCursor(storeName, indexName, direction, callback) {
        const db = dbInstance || await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const source = indexName ? store.index(indexName) : store;
            const req = source.openCursor(null, direction || 'next');
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) { callback(cursor.value); cursor.continue(); }
                else resolve();
            };
            req.onerror = () => reject(req.error);
        });
    }

    // ─── Experiments ──────────────────────────────────────────────────────────────

    const EXPERIMENT_STATUSES = ['Draft', 'Ready', 'Running', 'In Review', 'Completed', 'Archived'];

    async function getAllExperiments() {
        return getAll('experiments');
    }

    async function getExperiment(id) {
        return getOne('experiments', id);
    }

    async function saveExperiment(exp) {
        const now = new Date().toISOString();
        const existing = exp.id ? await getExperiment(exp.id) : null;
        const record = {
            ...(existing || {}),
            ...exp,
            id: exp.id || generateId(),
            title: (exp.title || 'Untitled Experiment').trim(),
            description: exp.description || '',
            category: exp.category || '',
            tags: Array.isArray(exp.tags) ? exp.tags : [],
            version: exp.version || '1.0',
            status: EXPERIMENT_STATUSES.includes(exp.status) ? exp.status : 'Draft',
            // Prompt fields
            personality: exp.personality !== undefined ? exp.personality : (existing?.personality || ''),
            scenario: exp.scenario !== undefined ? exp.scenario : (existing?.scenario || ''),
            initialMessage: exp.initialMessage !== undefined ? exp.initialMessage : (existing?.initialMessage || ''),
            // Execution defaults
            defaultModels: Array.isArray(exp.defaultModels) ? exp.defaultModels : (existing?.defaultModels || []),
            defaultRepetitions: exp.defaultRepetitions ?? existing?.defaultRepetitions ?? 5,
            defaultParams: exp.defaultParams ?? existing?.defaultParams ?? { temperature: 0.9, max_tokens: 500 },
            throttle: exp.throttle ?? existing?.throttle ?? { minInterval: 1000, concurrency: 1 },
            spendingLimit: exp.spendingLimit ?? existing?.spendingLimit ?? null,
            // Subtests
            subtests: Array.isArray(exp.subtests) ? exp.subtests : (existing?.subtests || []),
            createdAt: existing?.createdAt || now,
            modifiedAt: now,
        };
        return putOne('experiments', record);
    }

    async function deleteExperiment(id) {
        return deleteOne('experiments', id);
    }

    async function duplicateExperiment(id) {
        const src = await getExperiment(id);
        if (!src) throw new Error('Experiment not found: ' + id);
        const now = new Date().toISOString();
        return saveExperiment({
            ...src,
            id: generateId(),
            title: src.title + ' (Copy)',
            status: 'Draft',
            createdAt: now,
            modifiedAt: now,
        });
    }

    // ─── Runs ─────────────────────────────────────────────────────────────────────

    async function getAllRuns(experimentId) {
        return getAll('runs', 'experimentId', experimentId);
    }

    async function getRun(id) {
        return getOne('runs', id);
    }

    async function saveRun(run) {
        const now = new Date().toISOString();
        const record = {
            ...run,
            id: run.id || generateId(),
            experimentId: run.experimentId,
            status: run.status || 'pending', // pending | running | paused | completed | cancelled
            // Immutable snapshot of experiment config at time of run
            snapshot: run.snapshot || null,
            startedAt: run.startedAt || null,
            completedAt: run.completedAt || null,
            createdAt: run.createdAt || now,
            modifiedAt: now,
        };
        return putOne('runs', record);
    }

    async function deleteRun(id) {
        return deleteOne('runs', id);
    }

    // ─── Jobs ─────────────────────────────────────────────────────────────────────

    const JOB_STATUSES = ['pending', 'in_progress', 'uncertain', 'completed', 'failed', 'cancelled', 'skipped'];

    async function getJobsForRun(runId) {
        return getAll('jobs', 'runId', runId);
    }

    async function getPendingJobsForRun(runId) {
        const all = await getJobsForRun(runId);
        return all.filter(j => j.status === 'pending').sort((a, b) => a.sortKey - b.sortKey);
    }

    async function getUncertainJobsForRun(runId) {
        const all = await getJobsForRun(runId);
        return all.filter(j => j.status === 'uncertain');
    }

    async function getJobStats(runId) {
        const jobs = await getJobsForRun(runId);
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

    async function saveJob(job) {
        const now = new Date().toISOString();
        const record = {
            ...job,
            id: job.id || generateId(),
            runId: job.runId,
            subtestId: job.subtestId,
            testCaseId: job.testCaseId,
            modelId: job.modelId,
            iteration: job.iteration,
            sortKey: job.sortKey ?? 0,
            status: JOB_STATUSES.includes(job.status) ? job.status : 'pending',
            // Snapshot of effective prompt & params for this job
            promptSnapshot: job.promptSnapshot || null,
            attempts: job.attempts ?? 0,
            lastError: job.lastError || null,
            startedAt: job.startedAt || null,
            completedAt: job.completedAt || null,
            createdAt: job.createdAt || now,
            updatedAt: now,
        };
        return putOne('jobs', record);
    }

    async function updateJobStatus(id, status, extra = {}) {
        const job = await getOne('jobs', id);
        if (!job) throw new Error('Job not found: ' + id);
        return putOne('jobs', { ...job, ...extra, status, updatedAt: new Date().toISOString() });
    }

    async function bulkCreateJobs(jobs) {
        const db = dbInstance || await initDB();
        const tx = db.transaction('jobs', 'readwrite');
        const store = tx.objectStore('jobs');
        const now = new Date().toISOString();
        const results = [];
        for (const j of jobs) {
            const record = {
                ...j,
                id: j.id || generateId(),
                status: 'pending',
                attempts: 0,
                createdAt: now,
                updatedAt: now,
            };
            store.put(record);
            results.push(record);
        }
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve(results);
            tx.onerror = () => reject(tx.error);
        });
    }

    // ─── Responses ────────────────────────────────────────────────────────────────

    async function getResponsesForRun(runId) {
        return getAll('responses', 'runId', runId);
    }

    async function getResponsesForSubtest(subtestId) {
        return getAll('responses', 'subtestId', subtestId);
    }

    async function getResponse(id) {
        return getOne('responses', id);
    }

    async function saveResponse(response) {
        const now = new Date().toISOString();
        const existing = response.id ? await getOne('responses', response.id) : null;
        const record = {
            ...response,
            id: response.id || generateId(),
            jobId: response.jobId,
            runId: response.runId,
            subtestId: response.subtestId,
            modelId: response.modelId,
            iteration: response.iteration,
            // The actual generated text — never modified after save
            text: response.text || '',
            // Request metadata
            promptSent: response.promptSent || null, // exact messages array sent
            modelUsed: response.modelUsed || null, // identifier returned by provider
            tokensIn: response.tokensIn ?? null,
            tokensOut: response.tokensOut ?? null,
            costUsd: response.costUsd ?? null,
            latencyMs: response.latencyMs ?? null,
            reviewFlag: response.reviewFlag ?? false,
            createdAt: existing?.createdAt || now,  // preserve original timestamp on update
        };
        return putOne('responses', record);
    }

    // Patch specific metadata fields on an existing response (e.g. reviewFlag).
    // Does NOT reset createdAt or any immutable fields.
    async function updateResponse(id, patch) {
        const existing = await getOne('responses', id);
        if (!existing) throw new Error('Response not found: ' + id);
        return putOne('responses', { ...existing, ...patch });
    }

    // ─── Records (Test Record Sheets) ─────────────────────────────────────────────

    async function getRecord(responseId) {
        const all = await getAll('records', 'responseId', responseId);
        return all[0] || null;
    }

    async function saveRecord(record) {
        const now = new Date().toISOString();
        const existing = record.id ? await getOne('records', record.id) : await getRecord(record.responseId);
        const saved = {
            ...(existing || {}),
            ...record,
            id: record.id || (existing?.id) || generateId(),
            responseId: record.responseId,
            runId: record.runId,
            // fieldValues: { [fieldId]: value } — stable field IDs, not display names
            fieldValues: record.fieldValues || (existing?.fieldValues || {}),
            reviewStatus: record.reviewStatus || (existing?.reviewStatus || 'unreviewed'), // unreviewed | in_progress | complete
            notes: record.notes !== undefined ? record.notes : (existing?.notes || ''),
            createdAt: existing?.createdAt || now,
            modifiedAt: now,
        };
        return putOne('records', saved);
    }

    // ─── Models ───────────────────────────────────────────────────────────────────

    async function getAllModels() {
        return getAll('models');
    }

    async function getModel(id) {
        return getOne('models', id);
    }

    async function saveModel(model) {
        const now = new Date().toISOString();
        const existing = model.id ? await getModel(model.id) : null;
        const record = {
            ...(existing || {}),
            ...model,
            id: model.id || generateId(),
            name: (model.name || 'Unnamed Model').trim(),
            provider: model.provider || 'openai_compatible',
            // modelIdentifier is the exact API-level model string; apiKey and endpoint stored here only
            modelIdentifier: model.modelIdentifier || '',
            endpoint: model.endpoint || '',
            apiKey: model.apiKey !== undefined ? model.apiKey : (existing?.apiKey || ''),
            // Generation params
            temperature: model.temperature ?? existing?.temperature ?? 0.9,
            maxTokens: model.maxTokens ?? existing?.maxTokens ?? 500,
            extraParams: model.extraParams ?? existing?.extraParams ?? {},
            // Throttle
            requestTimeout: model.requestTimeout ?? existing?.requestTimeout ?? 30000,
            requestInterval: model.requestInterval ?? existing?.requestInterval ?? 1000,
            concurrencyLimit: model.concurrencyLimit ?? existing?.concurrencyLimit ?? 1,
            retryLimit: model.retryLimit ?? existing?.retryLimit ?? 3,
            retryBackoff: model.retryBackoff ?? existing?.retryBackoff ?? 2000,
            enabled: model.enabled !== undefined ? model.enabled : true,
            createdAt: existing?.createdAt || now,
            modifiedAt: now,
        };
        return putOne('models', record);
    }

    async function deleteModel(id) {
        return deleteOne('models', id);
    }

    // Strip credentials before returning for export/display
    function sanitizeModel(model) {
        const m = { ...model };
        delete m.apiKey;
        return m;
    }

    // ─── Field Schemas ────────────────────────────────────────────────────────────

    const FIELD_TYPES = ['checkbox', 'single_choice', 'multi_choice', 'integer', 'decimal', 'rating', 'short_text', 'long_text', 'timestamp'];

    async function getFieldSchemas(experimentId) {
        return getAll('field_schemas', 'experimentId', experimentId);
    }

    async function saveFieldSchema(schema) {
        const now = new Date().toISOString();
        const record = {
            ...schema,
            id: schema.id || generateId(),
            experimentId: schema.experimentId,
            subtestId: schema.subtestId || null, // null = experiment-level
            name: (schema.name || 'Unnamed Field').trim(),
            description: schema.description || '',
            type: FIELD_TYPES.includes(schema.type) ? schema.type : 'short_text',
            options: Array.isArray(schema.options) ? schema.options : [],
            required: schema.required ?? false,
            displayOrder: schema.displayOrder ?? 0,
            defaultValue: schema.defaultValue ?? null,
            createdAt: schema.createdAt || now,
            modifiedAt: now,
        };
        return putOne('field_schemas', record);
    }

    async function deleteFieldSchema(id) {
        return deleteOne('field_schemas', id);
    }

    // ─── Charts ───────────────────────────────────────────────────────────────────

    async function getCharts(experimentId) {
        return getAll('charts', 'experimentId', experimentId);
    }

    async function saveChart(chart) {
        const now = new Date().toISOString();
        const record = {
            ...chart,
            id: chart.id || generateId(),
            experimentId: chart.experimentId,
            title: (chart.title || 'Untitled Chart').trim(),
            fieldId: chart.fieldId || null,
            chartType: chart.chartType || 'auto',
            filters: chart.filters || {},
            pinned: chart.pinned ?? false,
            createdAt: chart.createdAt || now,
            modifiedAt: now,
        };
        return putOne('charts', record);
    }

    async function deleteChart(id) {
        return deleteOne('charts', id);
    }

    // ─── Backup / Restore ─────────────────────────────────────────────────────────

    async function exportBackup() {
        const [experiments, runs, jobs, responses, records, fieldSchemas, charts] = await Promise.all([
            getAllExperiments(),
            getAll('runs'),
            getAll('jobs'),
            getAll('responses'),
            getAll('records'),
            getAll('field_schemas'),
            getAll('charts'),
        ]);
        // Models exported without credentials
        const models = (await getAllModels()).map(sanitizeModel);
        return {
            _app: 'anansi-workbench',
            _version: DB_VERSION,
            _exportedAt: new Date().toISOString(),
            experiments,
            runs,
            jobs,
            responses,
            records,
            models,
            fieldSchemas,
            charts,
        };
    }

    // ─── Public API ───────────────────────────────────────────────────────────────

    window.WorkbenchDB = {
        initDB,
        generateId,
        // Experiments
        getAllExperiments,
        getExperiment,
        saveExperiment,
        deleteExperiment,
        duplicateExperiment,
        // Runs
        getAllRuns,
        getRun,
        saveRun,
        deleteRun,
        // Jobs
        getJobsForRun,
        getPendingJobsForRun,
        getUncertainJobsForRun,
        getJobStats,
        saveJob,
        updateJobStatus,
        bulkCreateJobs,
        // Responses
        getResponsesForRun,
        getResponsesForSubtest,
        getResponse,
        saveResponse,
        updateResponse,
        // Records
        getRecord,
        saveRecord,
        // Models
        getAllModels,
        getModel,
        saveModel,
        deleteModel,
        sanitizeModel,
        // Field Schemas
        FIELD_TYPES,
        getFieldSchemas,
        saveFieldSchema,
        deleteFieldSchema,
        // Charts
        getCharts,
        saveChart,
        deleteChart,
        // Forge Assets
        getForgeAssets() { return getAll('forge_assets'); },
        async saveForgeAssets(assets) {
            for (const item of assets) {
                if (!item.id) item.id = generateId();
                await putOne('forge_assets', item);
            }
        },
        clearForgeAssets() { return clearStore('forge_assets'); },
        // Generic / Admin
        getAll(storeName) { return getAll(storeName); },
        putOne(storeName, value) { return putOne(storeName, value); },
        // Backup
        exportBackup,
        // Internals
        forEachCursor,
        getAll,
    };
})();
