/**
 * experiments.js — Experiment Builder and Subtest Builder for AnansiWorkbench.
 */

(() => {
    'use strict';

    const { escapeHtml, formatDate, formatDateTime, plural } = WorkbenchUtils;

    let _experiments = [];
    let _editingId = null;    // id of experiment being edited (null = new)
    let _models = [];

    const STATUS_COLORS = {
        'Draft': 'badge-gray',
        'Ready': 'badge-blue',
        'Running': 'badge-green',
        'In Review': 'badge-yellow',
        'Completed': 'badge-teal',
        'Archived': 'badge-red',
    };

    // ─── Load ────────────────────────────────────────────────────────────────────

    async function load() {
        [_experiments, _models] = await Promise.all([WorkbenchDB.getAllExperiments(), WorkbenchDB.getAllModels()]);
        _experiments.sort((a, b) => (b.modifiedAt || '').localeCompare(a.modifiedAt || ''));
        renderList();
    }

    // ─── Experiment List ─────────────────────────────────────────────────────────

    function renderList() {
        const container = document.getElementById('experiments-list');
        if (!container) return;

        if (_experiments.length === 0) {
            container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔬</div><p>No experiments yet.</p><p class="empty-sub">Create one to begin testing.</p></div>`;
            return;
        }

        container.innerHTML = _experiments.map(exp => `
      <div class="experiment-card" data-id="${exp.id}">
        <div class="exp-card-header">
          <div class="exp-title-group">
            <span class="exp-title">${escapeHtml(exp.title)}</span>
            <span class="badge ${STATUS_COLORS[exp.status] || 'badge-gray'}">${escapeHtml(exp.status)}</span>
            ${exp.version ? `<span class="badge badge-outline">v${escapeHtml(exp.version)}</span>` : ''}
          </div>
          <div class="exp-card-actions">
            <button class="btn-sm btn-primary" onclick="WorkbenchExperiments.openBuilder('${exp.id}')">Edit</button>
            <button class="btn-sm" onclick="WorkbenchExperiments.runExperiment('${exp.id}')">▶ Run</button>
            <button class="btn-sm" onclick="WorkbenchExperiments.duplicate('${exp.id}')">⊕ Duplicate</button>
            <button class="btn-sm btn-danger" onclick="WorkbenchExperiments.deleteExperiment('${exp.id}')">🗑</button>
          </div>
        </div>
        <div class="exp-card-body">
          ${exp.description ? `<p class="exp-desc">${escapeHtml(exp.description)}</p>` : ''}
          <div class="exp-meta-row">
            ${exp.category ? `<span class="meta-tag">📁 ${escapeHtml(exp.category)}</span>` : ''}
            ${(exp.tags || []).map(t => `<span class="meta-tag">🏷 ${escapeHtml(t)}</span>`).join('')}
            <span class="meta-tag">🧪 ${plural(exp.subtests?.length || 0, 'subtest')}</span>
            <span class="meta-tag">🔄 ${exp.defaultRepetitions ?? 5}× per model</span>
          </div>
          ${exp.subtests?.length > 0 ? `<div class="exp-subtest-chips">${exp.subtests.slice(0, 3).map(st => `<span class="subtest-chip">${escapeHtml(st.title || 'Untitled')}</span>`).join('')
                }${exp.subtests.length > 3 ? `<span class="subtest-chip subtest-chip-more">+${exp.subtests.length - 3} more</span>` : ''}</div>` : ''}
          <div class="exp-dates">Modified ${formatDateTime(exp.modifiedAt)}</div>
        </div>
      </div>`).join('');
    }

    // ─── Open Builder ─────────────────────────────────────────────────────────────

    async function openBuilder(id) {
        _editingId = id || null;
        WorkbenchState.selectedExperimentId = _editingId;
        const exp = id ? await WorkbenchDB.getExperiment(id) : null;

        // Header
        document.getElementById('builder-modal-title').textContent = exp ? `Edit: ${exp.title}` : 'New Experiment';

        // Metadata
        document.getElementById('exp-form-title').value = exp?.title || '';
        document.getElementById('exp-form-desc').value = exp?.description || '';
        document.getElementById('exp-form-category').value = exp?.category || '';
        document.getElementById('exp-form-tags').value = (exp?.tags || []).join(', ');
        document.getElementById('exp-form-notes').value = exp?.notes || '';
        document.getElementById('exp-form-version').value = exp?.version || '1.0';
        document.getElementById('exp-form-status').value = exp?.status || 'Draft';

        // Prompt
        document.getElementById('exp-form-personality').value = exp?.personality || '';
        document.getElementById('exp-form-scenario').value = exp?.scenario || '';
        document.getElementById('exp-form-initial-msg').value = exp?.initialMessage || '';

        // Execution defaults
        document.getElementById('exp-form-reps').value = exp?.defaultRepetitions ?? 5;
        document.getElementById('exp-form-temp').value = exp?.defaultParams?.temperature ?? 0.9;
        document.getElementById('exp-form-tokens').value = exp?.defaultParams?.max_tokens ?? 500;
        document.getElementById('exp-form-interval').value = (exp?.throttle?.minInterval ?? 1000) / 1000;
        document.getElementById('exp-form-concurrency').value = exp?.throttle?.concurrency ?? 1;
        document.getElementById('exp-form-budget-tokens').value = exp?.spendingLimit?.tokens || '';
        document.getElementById('exp-form-budget-time').value = exp?.spendingLimit?.minutes || '';

        // Model selection
        renderModelCheckboxes(exp?.defaultModels || []);

        // Subtests
        renderSubtestList(exp?.subtests || [], exp);

        // Field schemas
        const schemas = exp?.id ? await WorkbenchDB.getFieldSchemas(exp.id) : [];
        renderFieldSchemaList(schemas);

        openModal('modal-builder');
    }

    function renderModelCheckboxes(selected) {
        const container = document.getElementById('exp-model-checkboxes');
        if (!container) return;
        if (_models.length === 0) {
            container.innerHTML = '<p class="hint">No models configured. Add one in the Models tab.</p>';
            return;
        }

        const enabledModels = _models.filter(m => m.enabled !== false);
        const realModels = enabledModels.filter(m => m.provider !== 'mock');
        const defaultCheck = (realModels.length > 0 ? realModels : enabledModels).map(m => m.id);
        const effectiveSelected = (selected && selected.length > 0) ? selected : defaultCheck;

        container.innerHTML = _models.map(m => `
      <label class="checkbox-label">
        <input type="checkbox" name="exp-model" value="${m.id}" ${effectiveSelected.includes(m.id) ? 'checked' : ''}>
        ${escapeHtml(m.name)}
      </label>`).join('');
    }

    // ─── Save Experiment ──────────────────────────────────────────────────────────

    async function saveFromBuilder() {
        const title = document.getElementById('exp-form-title').value.trim();
        if (!title) { showToast('Title is required.', 'error'); return; }

        const selectedModels = [...document.querySelectorAll('input[name="exp-model"]:checked')].map(el => el.value);
        const tagsRaw = document.getElementById('exp-form-tags').value;
        const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);

        // Preserve existing subtests
        const existing = _editingId ? await WorkbenchDB.getExperiment(_editingId) : null;

        const exp = {
            id: _editingId || undefined,
            title,
            description: document.getElementById('exp-form-desc').value.trim(),
            category: document.getElementById('exp-form-category').value.trim(),
            tags,
            notes: document.getElementById('exp-form-notes').value,
            version: document.getElementById('exp-form-version').value.trim() || '1.0',
            status: document.getElementById('exp-form-status').value,
            personality: document.getElementById('exp-form-personality').value,
            scenario: document.getElementById('exp-form-scenario').value,
            initialMessage: document.getElementById('exp-form-initial-msg').value,
            defaultModels: selectedModels,
            defaultRepetitions: parseInt(document.getElementById('exp-form-reps').value) || 5,
            defaultParams: {
                temperature: parseFloat(document.getElementById('exp-form-temp').value) || 0.9,
                max_tokens: parseInt(document.getElementById('exp-form-tokens').value) || 500,
            },
            throttle: {
                minInterval: (parseFloat(document.getElementById('exp-form-interval').value) || 1) * 1000,
                concurrency: parseInt(document.getElementById('exp-form-concurrency').value) || 1,
            },
            spendingLimit: {
                tokens: parseInt(document.getElementById('exp-form-budget-tokens').value) || null,
                minutes: parseFloat(document.getElementById('exp-form-budget-time').value) || null,
            },
            subtests: existing?.subtests || [],
        };

        const saved = await WorkbenchDB.saveExperiment(exp);
        _editingId = saved.id;

        // Refresh subtests section
        document.getElementById('builder-modal-title').textContent = `Edit: ${saved.title}`;
        await load();
        showToast('Experiment saved.', 'success');
        WorkbenchBus.emit('experiments:changed');
    }

    // ─── Subtest Builder ──────────────────────────────────────────────────────────

    function renderSubtestList(subtests, exp) {
        const container = document.getElementById('subtest-list');
        if (!container) return;

        if (subtests.length === 0) {
            container.innerHTML = `<div class="empty-state-sm"><p>No subtests yet. Use the buttons below to add some.</p></div>`;
            return;
        }

        container.innerHTML = subtests.map((st, idx) => `
      <div class="subtest-row ${st.disabled ? 'subtest-disabled' : ''}" data-idx="${idx}" draggable="true">
        <span class="drag-handle">⠿</span>
        <div class="subtest-info">
          <span class="subtest-name">${escapeHtml(st.title || 'Untitled Subtest')}</span>
          ${st.disabled ? '<span class="badge badge-gray">Disabled</span>' : ''}
          <span class="subtest-meta">${(st.userResponses || []).length} response(s) · ${overrideCount(st, exp)} override(s)</span>
        </div>
        <div class="subtest-actions">
          <button class="btn-icon" onclick="WorkbenchExperiments.editSubtest(${idx})" title="Edit">✏️</button>
          <button class="btn-icon" onclick="WorkbenchExperiments.duplicateSubtest(${idx})" title="Duplicate">⊕</button>
          <button class="btn-icon" onclick="WorkbenchExperiments.toggleSubtest(${idx})" title="${st.disabled ? 'Enable' : 'Disable'}">${st.disabled ? '▶' : '⏸'}</button>
          <button class="btn-icon btn-danger" onclick="WorkbenchExperiments.deleteSubtest(${idx})" title="Delete">🗑</button>
        </div>
      </div>`).join('');

        // Drag-to-reorder
        setupSubtestDrag(subtests);
    }

    function overrideCount(st, exp) {
        let count = 0;
        if (st.personality !== undefined && st.personality !== null) count++;
        if (st.scenario !== undefined && st.scenario !== null) count++;
        if (st.initialMessage !== undefined && st.initialMessage !== null) count++;
        if (st.models !== undefined && st.models !== null) count++;
        if (st.repetitions !== undefined && st.repetitions !== null) count++;
        return count;
    }

    function setupSubtestDrag(subtests) {
        const rows = document.querySelectorAll('.subtest-row');
        let dragSrc = null;

        rows.forEach(row => {
            row.addEventListener('dragstart', e => {
                dragSrc = row;
                row.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', row.dataset.idx);
            });
            row.addEventListener('dragend', e => { row.classList.remove('dragging'); });
            row.addEventListener('dragover', e => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            });
            row.addEventListener('drop', async e => {
                e.preventDefault();
                if (dragSrc === row) return;
                const srcIdx = parseInt(e.dataTransfer.getData('text/plain'));
                const destIdx = parseInt(row.dataset.idx);
                const exp = _editingId ? await WorkbenchDB.getExperiment(_editingId) : null;
                if (!exp) return;
                const moved = exp.subtests.splice(srcIdx, 1)[0];
                exp.subtests.splice(destIdx, 0, moved);
                await WorkbenchDB.saveExperiment(exp);
                renderSubtestList(exp.subtests, exp);
            });
        });
    }

    // ─── Add Subtest (single) ────────────────────────────────────────────────────

    async function addSubtest() {
        if (!_editingId) {
            showToast('Save the experiment first before adding subtests.', 'error');
            return;
        }
        openSubtestEditor(null);
    }

    // ─── Bulk Create ──────────────────────────────────────────────────────────────

    async function bulkCreate() {
        if (!_editingId) { showToast('Save the experiment first.', 'error'); return; }

        const raw = await showPrompt(
            'Enter subtest names — one per line.\nEach will inherit the experiment defaults and can be edited individually.',
            '',
            'Bulk Create Subtests'
        );
        if (raw === null) return;

        const names = raw.split('\n').map(n => n.trim()).filter(Boolean);
        if (names.length === 0) return;

        if (names.length > 200) {
            const ok = await showConfirm(`You are about to create ${names.length} subtests. Continue?`, 'Bulk Create');
            if (!ok) return;
        }

        const exp = await WorkbenchDB.getExperiment(_editingId);
        for (const name of names) {
            exp.subtests.push({
                id: WorkbenchDB.generateId(),
                title: name,
                description: '',
                tags: [],
                userResponses: [],
                personality: null,
                scenario: null,
                initialMessage: null,
                models: null,
                repetitions: null,
                disabled: false,
                extraFields: [],
            });
        }
        await WorkbenchDB.saveExperiment(exp);
        renderSubtestList(exp.subtests, exp);
        showToast(`Created ${names.length} subtests.`, 'success');
    }

    // ─── Edit Subtest ─────────────────────────────────────────────────────────────

    async function editSubtest(idx) {
        const exp = _editingId ? await WorkbenchDB.getExperiment(_editingId) : null;
        if (!exp) return;
        openSubtestEditor(exp.subtests[idx], idx);
    }

    function openSubtestEditor(st, idx) {
        const isNew = st == null;
        st = st || {
            id: WorkbenchDB.generateId(),
            title: '',
            description: '',
            tags: [],
            userResponses: [],
            personality: null,
            scenario: null,
            initialMessage: null,
            models: null,
            repetitions: null,
            disabled: false,
        };

        document.getElementById('st-form-idx').value = isNew ? -1 : idx;
        document.getElementById('st-form-id').value = st.id;
        document.getElementById('st-form-title').value = st.title || '';
        document.getElementById('st-form-desc').value = st.description || '';
        document.getElementById('st-form-tags').value = (st.tags || []).join(', ');
        document.getElementById('st-form-responses').value = (st.userResponses || []).join('\n');

        // Prompt Modes
        const modePersonality = document.getElementById('st-mode-personality');
        const modeScenario = document.getElementById('st-mode-scenario');
        const modeInitialMsg = document.getElementById('st-mode-initial');
        const ovReps = document.getElementById('st-override-reps');

        modePersonality.value = st.personalityMode || (st.personality != null ? 'replace' : 'inherit');
        modeScenario.value = st.scenarioMode || (st.scenario != null ? 'replace' : 'inherit');
        modeInitialMsg.value = st.initialMessageMode || (st.initialMessage != null ? 'replace' : 'inherit');
        ovReps.checked = st.repetitions != null;

        document.getElementById('st-form-personality').value = st.personality || '';
        document.getElementById('st-form-scenario').value = st.scenario || '';
        document.getElementById('st-form-initial-msg').value = st.initialMessage || '';
        document.getElementById('st-form-reps').value = st.repetitions || 5;

        // Toggle override panels
        toggleOverridePanel('personality', modePersonality.value !== 'inherit');
        toggleOverridePanel('scenario', modeScenario.value !== 'inherit');
        toggleOverridePanel('initial', modeInitialMsg.value !== 'inherit');
        toggleOverridePanel('reps', ovReps.checked);

        openModal('modal-subtest');
    }

    function toggleOverridePanel(key, show) {
        const panel = document.getElementById(`st-panel-${key}`);
        if (panel) panel.style.display = show ? '' : 'none';
    }

    async function saveSubtestFromForm() {
        const idx = parseInt(document.getElementById('st-form-idx').value);
        const isNew = idx === -1;

        const tag = document.getElementById('st-form-tags').value;

        const modePersonality = document.getElementById('st-mode-personality').value;
        const modeScenario = document.getElementById('st-mode-scenario').value;
        const modeInitial = document.getElementById('st-mode-initial').value;
        const ovReps = document.getElementById('st-override-reps').checked;

        const responsesRaw = document.getElementById('st-form-responses').value;
        const userResponses = responsesRaw.split('\n').map(r => r.trim()).filter(Boolean);

        if (userResponses.length === 0) {
            showToast('At least one user response is required.', 'error');
            return;
        }

        const st = {
            id: document.getElementById('st-form-id').value || WorkbenchDB.generateId(),
            title: document.getElementById('st-form-title').value.trim() || 'Untitled Subtest',
            description: document.getElementById('st-form-desc').value.trim(),
            tags: tag.split(',').map(t => t.trim()).filter(Boolean),
            userResponses,
            personalityMode: modePersonality,
            scenarioMode: modeScenario,
            initialMessageMode: modeInitial,
            personality: modePersonality !== 'inherit' ? document.getElementById('st-form-personality').value : null,
            scenario: modeScenario !== 'inherit' ? document.getElementById('st-form-scenario').value : null,
            initialMessage: modeInitial !== 'inherit' ? document.getElementById('st-form-initial-msg').value : null,
            models: null,  // extended in Phase 2
            repetitions: ovReps ? (parseInt(document.getElementById('st-form-reps').value) || 5) : null,
            disabled: false,
        };

        const exp = await WorkbenchDB.getExperiment(_editingId);
        if (!exp) return;

        if (isNew) {
            exp.subtests.push(st);
        } else {
            exp.subtests[idx] = st;
        }

        await WorkbenchDB.saveExperiment(exp);
        closeModal('modal-subtest');
        renderSubtestList(exp.subtests, exp);
        showToast('Subtest saved.', 'success');
    }

    async function duplicateSubtest(idx) {
        const exp = await WorkbenchDB.getExperiment(_editingId);
        if (!exp) return;
        const copy = { ...exp.subtests[idx], id: WorkbenchDB.generateId(), title: exp.subtests[idx].title + ' (Copy)' };
        exp.subtests.splice(idx + 1, 0, copy);
        await WorkbenchDB.saveExperiment(exp);
        renderSubtestList(exp.subtests, exp);
    }

    async function toggleSubtest(idx) {
        const exp = await WorkbenchDB.getExperiment(_editingId);
        if (!exp) return;
        exp.subtests[idx].disabled = !exp.subtests[idx].disabled;
        await WorkbenchDB.saveExperiment(exp);
        renderSubtestList(exp.subtests, exp);
    }

    async function deleteSubtest(idx) {
        const exp = await WorkbenchDB.getExperiment(_editingId);
        if (!exp) return;
        const ok = await showConfirm(`Delete subtest "${exp.subtests[idx]?.title}"?`, 'Delete Subtest');
        if (!ok) return;
        exp.subtests.splice(idx, 1);
        await WorkbenchDB.saveExperiment(exp);
        renderSubtestList(exp.subtests, exp);
    }

    // ─── Effective Prompt Preview ─────────────────────────────────────────────────

    async function showPreview(subtestIdx) {
        const exp = _editingId ? await WorkbenchDB.getExperiment(_editingId) : null;
        if (!exp) return;

        const st = subtestIdx != null ? exp.subtests[subtestIdx] : null;

        const personality = (st?.personality != null ? st.personality : exp.personality) || '(none)';
        const scenario = (st?.scenario != null ? st.scenario : exp.scenario) || '(none)';
        const initialMessage = (st?.initialMessage != null ? st.initialMessage : exp.initialMessage) || '(none)';
        const userResponse = st?.userResponses?.[0] || '(none)';

        const container = document.getElementById('preview-content');
        if (!container) return;
        container.innerHTML = `
      <div class="preview-block"><div class="preview-label">SYSTEM (Personality + Scenario)</div><pre>${escapeHtml(personality + '\n\n' + scenario)}</pre></div>
      <div class="preview-block"><div class="preview-label">ASSISTANT (Initial Message)</div><pre>${escapeHtml(initialMessage)}</pre></div>
      <div class="preview-block"><div class="preview-label">USER (Test Response)</div><pre>${escapeHtml(userResponse)}</pre></div>`;

        openModal('modal-preview');
    }

    // ─── Run Experiment ───────────────────────────────────────────────────────────

    async function runExperiment(id) {
        const exp = await WorkbenchDB.getExperiment(id);
        if (!exp) return;

        if ((exp.subtests || []).length === 0) {
            showToast('Add at least one subtest before running.', 'error');
            return;
        }
        if ((exp.defaultModels || []).length === 0) {
            showToast('Select at least one model before running.', 'error');
            return;
        }

        const enabledSubtests = exp.subtests.filter(st => !st.disabled);
        if (enabledSubtests.length === 0) {
            showToast('All subtests are disabled.', 'error');
            return;
        }

        WorkbenchBus.emit('run:start', { experimentId: id });
        WorkbenchApp.activateTab('execution');
    }

    // ─── Field Schema Drag Reorder ────────────────────────────────────────────────

    function setupFieldSchemaDrag() {
        const rows = document.querySelectorAll('#field-schema-list [data-schema-id]');
        let dragSrc = null;

        rows.forEach(row => {
            row.addEventListener('dragstart', e => {
                dragSrc = row;
                row.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', row.dataset.idx);
            });
            row.addEventListener('dragend', () => row.classList.remove('dragging'));
            row.addEventListener('dragover', e => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            });
            row.addEventListener('drop', async e => {
                e.preventDefault();
                if (dragSrc === row) return;
                const srcIdx = parseInt(e.dataTransfer.getData('text/plain'));
                const destIdx = parseInt(row.dataset.idx);
                // Reorder the local array
                const moved = _fieldSchemas.splice(srcIdx, 1)[0];
                _fieldSchemas.splice(destIdx, 0, moved);
                // Persist new displayOrder for every schema
                await Promise.all(
                    _fieldSchemas.map((s, i) => WorkbenchDB.saveFieldSchema({ ...s, displayOrder: i }))
                );
                renderFieldSchemaList(_fieldSchemas);
            });
        });
    }

    // ─── Field Schema Builder ─────────────────────────────────────────────────────

    let _fieldSchemas = [];

    async function renderFieldSchemaList(schemas) {
        _fieldSchemas = (schemas || []).slice().sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
        const container = document.getElementById('field-schema-list');
        if (!container) return;

        if (_fieldSchemas.length === 0) {
            container.innerHTML = `<div class="empty-state-sm"><p>No custom recording fields defined yet. Click <strong>+ Add Recording Field</strong> to define metrics.</p></div>`;
            return;
        }

        container.innerHTML = _fieldSchemas.map((s, idx) => `
      <div class="subtest-card flex-row align-center" data-schema-id="${s.id}" data-idx="${idx}" draggable="true">
        <span class="subtest-drag-handle" style="cursor:grab;">≡</span>
        <div class="flex-1" style="min-width:0;">
          <div style="font-weight:600; font-size:13px; color:var(--text-primary); display:flex; align-items:center; gap:8px;">
            <span>${escapeHtml(s.name)}</span>
            <span class="badge badge-gray" style="font-size:10px;">${s.type}</span>
            ${s.required ? '<span class="badge badge-warning" style="font-size:10px;">Required</span>' : ''}
          </div>
          ${s.description ? `<div style="font-size:12px; color:var(--text-muted); margin-top:2px;">${escapeHtml(s.description)}</div>` : ''}
        </div>
        <div class="subtest-actions flex-row gap-xs">
          <button class="btn btn-sm" onclick="WorkbenchExperiments.editFieldSchema('${s.id}')">Edit</button>
          <button class="btn btn-sm btn-danger" onclick="WorkbenchExperiments.deleteFieldSchema('${s.id}')">✕</button>
        </div>
      </div>
    `).join('');

        setupFieldSchemaDrag();
    }

    function onFieldTypeChange(type) {
        const optsGroup = document.getElementById('field-form-options-group');
        if (optsGroup) {
            optsGroup.style.display = (type === 'single_choice' || type === 'multi_choice') ? 'block' : 'none';
        }
    }

    function addFieldSchema() {
        if (!_editingId) {
            showToast('Please save the experiment first before adding recording fields.', 'warning');
            return;
        }
        document.getElementById('field-modal-title').textContent = 'Add Recording Field';
        document.getElementById('field-form-id').value = '';
        document.getElementById('field-form-name').value = '';
        document.getElementById('field-form-type').value = 'short_text';
        document.getElementById('field-form-desc').value = '';
        document.getElementById('field-form-options').value = '';
        document.getElementById('field-form-default').value = '';
        document.getElementById('field-form-required').checked = false;
        onFieldTypeChange('short_text');
        openModal('modal-field-schema');
    }

    async function editFieldSchema(id) {
        const schema = _fieldSchemas.find(s => s.id === id);
        if (!schema) return;
        document.getElementById('field-modal-title').textContent = `Edit Field: ${schema.name}`;
        document.getElementById('field-form-id').value = schema.id;
        document.getElementById('field-form-name').value = schema.name;
        document.getElementById('field-form-type').value = schema.type;
        document.getElementById('field-form-desc').value = schema.description || '';
        document.getElementById('field-form-options').value = (schema.options || []).join('\n');
        document.getElementById('field-form-default').value = schema.defaultValue || '';
        document.getElementById('field-form-required').checked = !!schema.required;
        onFieldTypeChange(schema.type);
        openModal('modal-field-schema');
    }

    async function saveFieldSchemaFromForm() {
        if (!_editingId) return;
        const name = document.getElementById('field-form-name').value.trim();
        if (!name) { showToast('Field name is required.', 'error'); return; }

        const id = document.getElementById('field-form-id').value;
        const type = document.getElementById('field-form-type').value;
        const description = document.getElementById('field-form-desc').value.trim();
        const optionsRaw = document.getElementById('field-form-options').value;
        const options = optionsRaw.split('\n').map(o => o.trim()).filter(Boolean);
        const defaultValue = document.getElementById('field-form-default').value.trim() || null;
        const required = document.getElementById('field-form-required').checked;

        const schemaRecord = {
            id: id || undefined,
            experimentId: _editingId,
            name,
            type,
            description,
            options,
            defaultValue,
            required,
            displayOrder: _fieldSchemas.length
        };

        await WorkbenchDB.saveFieldSchema(schemaRecord);
        closeModal('modal-field-schema');
        showToast('Field schema saved.', 'success');
        const updated = await WorkbenchDB.getFieldSchemas(_editingId);
        renderFieldSchemaList(updated);
    }

    const DEBUG_PRESET_FIELDS = [
        { name: 'Persona Fidelity', type: 'rating', description: 'Did the character sound like themselves?', required: true },
        { name: 'Tone Consistency', type: 'rating', description: 'Were tone and mood appropriate?', required: true },
        { name: 'Instruction Compliance', type: 'single_choice', description: 'Did it follow system instructions?', required: true, options: ['Yes', 'Partial', 'No'] },
        { name: 'Response Coherence', type: 'rating', description: 'Internal logic and readability.', required: false },
        { name: 'Hallucination Flag', type: 'checkbox', description: 'Did the model hallucinate details?', required: false },
        { name: 'Reviewer Notes', type: 'long_text', description: 'Internal review notes limit 1000 chars.', required: false }
    ];

    async function loadDebugPreset() {
        if (!_editingId) {
            showToast('Please save the experiment first.', 'warning');
            return;
        }
        const ok = await showConfirm('Load standard 6-field Debug Tracker preset? Existing fields will NOT be deleted.', 'Load Preset');
        if (!ok) return;

        let currentOrder = _fieldSchemas.length;
        for (const pf of DEBUG_PRESET_FIELDS) {
            await WorkbenchDB.saveFieldSchema({
                experimentId: _editingId,
                name: pf.name,
                type: pf.type,
                description: pf.description,
                options: pf.options || [],
                required: pf.required,
                displayOrder: currentOrder++
            });
        }

        showToast('Debug Tracker preset loaded.', 'success');
        const updated = await WorkbenchDB.getFieldSchemas(_editingId);
        renderFieldSchemaList(updated);
    }

    async function deleteFieldSchema(id) {
        const ok = await showConfirm('Delete this recording field?', 'Delete Field');
        if (!ok) return;
        await WorkbenchDB.deleteFieldSchema(id);
        showToast('Recording field deleted.', 'info');
        if (_editingId) {
            const updated = await WorkbenchDB.getFieldSchemas(_editingId);
            renderFieldSchemaList(updated);
        }
    }

    // ─── Delete / Duplicate ───────────────────────────────────────────────────────

    async function deleteExperiment(id) {
        const exp = _experiments.find(e => e.id === id);
        const ok = await showConfirm(`Delete experiment "${exp?.title}"? This cannot be undone.`, 'Delete Experiment');
        if (!ok) return;
        await WorkbenchDB.deleteExperiment(id);
        await load();
        showToast('Experiment deleted.', 'info');
    }

    async function duplicate(id) {
        await WorkbenchDB.duplicateExperiment(id);
        await load();
        showToast('Experiment duplicated.', 'success');
    }

    // ─── Init ─────────────────────────────────────────────────────────────────────

    async function init() {
        await load();

        document.getElementById('btn-new-experiment')?.addEventListener('click', () => openBuilder(null));
        document.getElementById('exp-builder-save')?.addEventListener('click', saveFromBuilder);
        document.getElementById('btn-add-subtest')?.addEventListener('click', addSubtest);
        document.getElementById('btn-bulk-create')?.addEventListener('click', bulkCreate);
        document.getElementById('st-form-save')?.addEventListener('click', saveSubtestFromForm);
        document.getElementById('btn-preview-prompt')?.addEventListener('click', () => showPreview(null));

        document.getElementById('btn-add-field-schema')?.addEventListener('click', addFieldSchema);
        document.getElementById('field-form-save')?.addEventListener('click', saveFieldSchemaFromForm);
        document.getElementById('btn-load-preset-fields')?.addEventListener('click', loadDebugPreset);

        // Prompt Mode & Override toggle handlers
        ['personality', 'scenario', 'initial'].forEach(key => {
            document.getElementById(`st-mode-${key}`)?.addEventListener('change', e => {
                toggleOverridePanel(key, e.target.value !== 'inherit');
            });
        });
        document.getElementById('st-override-reps')?.addEventListener('change', e => {
            toggleOverridePanel('reps', e.target.checked);
        });

        WorkbenchBus.on('models:changed', () => { if (_editingId) load(); });
        WorkbenchApp.registerTab('experiments', load);

        // Live char/token counters on prompt textareas
        const promptFields = [
            'exp-form-personality', 'exp-form-scenario', 'exp-form-initial-msg',
            'st-form-personality', 'st-form-scenario', 'st-form-initial-msg',
        ];
        promptFields.forEach(fieldId => {
            const el = document.getElementById(fieldId);
            if (!el) return;
            const counter = document.createElement('span');
            counter.className = 'char-counter';
            counter.textContent = '0 chars / ~0 tokens';
            el.insertAdjacentElement('afterend', counter);
            const update = () => {
                const len = el.value.length;
                counter.textContent = `${len.toLocaleString()} chars / ~${Math.ceil(len / 4).toLocaleString()} tokens`;
            };
            el.addEventListener('input', update);
            update();
        });
    }

    window.WorkbenchExperiments = {
        init, load, openBuilder, saveFromBuilder, runExperiment, deleteExperiment, duplicate,
        editSubtest, duplicateSubtest, toggleSubtest, deleteSubtest, addSubtest, bulkCreate,
        saveSubtestFromForm, showPreview,
        onFieldTypeChange, addFieldSchema, editFieldSchema, saveFieldSchemaFromForm, deleteFieldSchema,
    };
})();
