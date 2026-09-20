/**
 * models.js — Model Provider Manager for AnansiWorkbench.
 */

(() => {
    'use strict';

    const PROVIDERS = [
        { id: 'openai_compatible', label: 'OpenAI-Compatible (default)' },
        { id: 'mock', label: 'Mock Provider (testing)' },
    ];

    let _models = [];

    // ─── Render ──────────────────────────────────────────────────────────────────

    function render() {
        const list = document.getElementById('models-list');
        if (!list) return;

        if (_models.length === 0) {
            list.innerHTML = `<div class="empty-state"><div class="empty-icon">🔌</div><p>No models configured yet.</p><p class="empty-sub">Add a provider to start running experiments.</p></div>`;
            return;
        }

        list.innerHTML = _models.map(m => `
      <div class="model-card ${m.enabled ? '' : 'model-disabled'}" data-id="${m.id}">
        <div class="model-card-header">
          <div class="model-info">
            <span class="model-name">${WorkbenchUtils.escapeHtml(m.name)}</span>
            <span class="model-provider-badge">${WorkbenchUtils.escapeHtml(PROVIDERS.find(p => p.id === m.provider)?.label || m.provider)}</span>
          </div>
          <div class="model-card-actions">
            <button class="btn-icon" onclick="WorkbenchModels.testConnection('${m.id}')" title="Test connection">🔗</button>
            <button class="btn-icon" onclick="WorkbenchModels.openEdit('${m.id}')" title="Edit">✏️</button>
            <button class="btn-icon btn-danger" onclick="WorkbenchModels.deleteModel('${m.id}')" title="Delete">🗑</button>
          </div>
        </div>
        <div class="model-card-body">
          <span class="model-identifier">${WorkbenchUtils.escapeHtml(m.modelIdentifier || '—')}</span>
          <span class="model-meta">Temp: ${m.temperature ?? '—'} · Max tokens: ${m.maxTokens ?? '—'} · Concurrency: ${m.concurrencyLimit ?? 1}</span>
        </div>
        <div class="model-status-bar" id="model-status-${m.id}"></div>
      </div>`).join('');
    }

    // ─── Load ────────────────────────────────────────────────────────────────────

    async function load() {
        _models = await WorkbenchDB.getAllModels();
        render();
    }

    // ─── Open modal ───────────────────────────────────────────────────────────────

    function openEdit(id) {
        const model = id ? _models.find(m => m.id === id) : null;

        const nameEl = document.getElementById('model-form-name');
        const providerEl = document.getElementById('model-form-provider');
        const endpointEl = document.getElementById('model-form-endpoint');
        const identEl = document.getElementById('model-form-identifier');
        const keyEl = document.getElementById('model-form-key');
        const tempEl = document.getElementById('model-form-temp');
        const tokensEl = document.getElementById('model-form-tokens');
        const timeoutEl = document.getElementById('model-form-timeout');
        const intervalEl = document.getElementById('model-form-interval');
        const conEl = document.getElementById('model-form-concurrency');
        const retryEl = document.getElementById('model-form-retry');
        const idEl = document.getElementById('model-form-id');
        const titleEl = document.getElementById('model-modal-title');
        const enabledEl = document.getElementById('model-form-enabled');

        if (model) {
            titleEl.textContent = 'Edit Model';
            idEl.value = model.id;
            nameEl.value = model.name;
            providerEl.value = model.provider;
            endpointEl.value = model.endpoint || '';
            identEl.value = model.modelIdentifier || '';
            keyEl.value = model.apiKey || '';
            tempEl.value = model.temperature ?? 0.9;
            tokensEl.value = model.maxTokens ?? 500;
            timeoutEl.value = (model.requestTimeout ?? 30000) / 1000;
            intervalEl.value = (model.requestInterval ?? 1000) / 1000;
            conEl.value = model.concurrencyLimit ?? 1;
            retryEl.value = model.retryLimit ?? 3;
            enabledEl.checked = model.enabled !== false;
        } else {
            titleEl.textContent = 'Add Model';
            idEl.value = '';
            nameEl.value = '';
            providerEl.value = 'openai_compatible';
            endpointEl.value = '';
            identEl.value = '';
            keyEl.value = '';
            tempEl.value = 0.9;
            tokensEl.value = 500;
            timeoutEl.value = 30;
            intervalEl.value = 1;
            conEl.value = 1;
            retryEl.value = 3;
            enabledEl.checked = true;
        }

        openModal('modal-model');
    }

    // ─── Save ────────────────────────────────────────────────────────────────────

    async function saveFromForm() {
        const id = document.getElementById('model-form-id').value.trim();
        const model = {
            id: id || undefined,
            name: document.getElementById('model-form-name').value.trim(),
            provider: document.getElementById('model-form-provider').value,
            endpoint: document.getElementById('model-form-endpoint').value.trim(),
            modelIdentifier: document.getElementById('model-form-identifier').value.trim(),
            apiKey: document.getElementById('model-form-key').value,
            temperature: parseFloat(document.getElementById('model-form-temp').value) || 0.9,
            maxTokens: parseInt(document.getElementById('model-form-tokens').value) || 500,
            requestTimeout: (parseFloat(document.getElementById('model-form-timeout').value) || 30) * 1000,
            requestInterval: (parseFloat(document.getElementById('model-form-interval').value) || 1) * 1000,
            concurrencyLimit: parseInt(document.getElementById('model-form-concurrency').value) || 1,
            retryLimit: parseInt(document.getElementById('model-form-retry').value) || 3,
            enabled: document.getElementById('model-form-enabled').checked,
        };

        if (!model.name) { showToast('Model name is required.', 'error'); return; }

        await WorkbenchDB.saveModel(model);
        closeModal('modal-model');
        await load();
        showToast('Model saved.', 'success');
        WorkbenchBus.emit('models:changed');
    }

    // ─── Delete ───────────────────────────────────────────────────────────────────

    async function deleteModel(id) {
        const model = _models.find(m => m.id === id);
        const ok = await showConfirm(`Delete model "${model?.name || id}"? This cannot be undone.`, 'Delete Model');
        if (!ok) return;
        await WorkbenchDB.deleteModel(id);
        await load();
        showToast('Model deleted.', 'info');
        WorkbenchBus.emit('models:changed');
    }

    // ─── Connection test ──────────────────────────────────────────────────────────

    async function testConnection(id) {
        const model = _models.find(m => m.id === id);
        if (!model) return;

        const statusBar = document.getElementById(`model-status-${id}`);
        if (statusBar) statusBar.innerHTML = '<span class="status-testing">Testing connection…</span>';

        try {
            // Send a minimal request through the appropriate adapter
            const adapter = model.provider === 'mock' ? getMockAdapter() : getOpenAIAdapter();
            const result = await adapter({
                model,
                messages: [{ role: 'user', content: 'Hi' }],
                params: { temperature: 0.1, max_tokens: 5 },
                apiKey: model.apiKey || '',
                endpoint: model.endpoint || '',
                timeout: 10000,
            });
            if (statusBar) statusBar.innerHTML = `<span class="status-ok">✓ Connected — responded in ${result.latencyMs}ms</span>`;
            showToast(`${model.name}: Connection successful.`, 'success');
        } catch (err) {
            if (statusBar) statusBar.innerHTML = `<span class="status-err">✗ ${WorkbenchUtils.escapeHtml(String(err.message).slice(0, 120))}</span>`;
            showToast(`${model.name}: Connection failed.`, 'error');
        }
    }

    function getMockAdapter() {
        return async ({ model, messages }) => {
            await new Promise(r => setTimeout(r, 300));
            return { text: 'mock', modelUsed: 'mock', tokensIn: 1, tokensOut: 1, latencyMs: 300 };
        };
    }

    function getOpenAIAdapter() {
        return async ({ model, messages, params, apiKey, endpoint, timeout }) => {
            const url = (endpoint || 'https://api.openai.com/v1') + '/chat/completions';
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeout);
            const t0 = Date.now();
            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                    body: JSON.stringify({ model: model.modelIdentifier, messages, ...params, max_tokens: 5 }),
                    signal: controller.signal,
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                return { text: data.choices?.[0]?.message?.content || '', modelUsed: data.model, tokensIn: null, tokensOut: null, latencyMs: Date.now() - t0 };
            } finally {
                clearTimeout(timer);
            }
        };
    }

    // ─── Public API ───────────────────────────────────────────────────────────────

    async function getModels() { return _models; }

    async function init() {
        await load();

        const saveBtn = document.getElementById('model-form-save');
        if (saveBtn) saveBtn.addEventListener('click', saveFromForm);

        const addBtn = document.getElementById('btn-add-model');
        if (addBtn) addBtn.addEventListener('click', () => openEdit(null));

        WorkbenchApp.registerTab('models', load);
    }

    window.WorkbenchModels = { init, load, openEdit, saveFromForm, deleteModel, testConnection, getModels };
})();
