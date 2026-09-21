/**
 * review.js — Results Review Interface for AnansiWorkbench.
 */

(() => {
  'use strict';

  const { escapeHtml, formatDateTime } = WorkbenchUtils;

  let _runId = null;
  let _responses = [];
  let _currentIdx = 0;
  let _filter = 'all'; // all | unreviewed | flagged | complete
  let _compareMode = false;
  let _effectiveFields = [];
  let _modelMap = new Map(); // id -> model object, cached for nav labels
  let _completedRuns = [];
  let _crossRunId = null;
  let _crossRunResponses = [];

  // ─── Load ────────────────────────────────────────────────────────────────────

  async function load() {
    _runId = WorkbenchState.selectedRunId;
    if (!_runId) {
      renderEmpty('Select a run from the Execution tab to begin reviewing.');
      return;
    }
    await loadRun(_runId);
  }

  async function loadRun(runId) {
    _runId = runId;
    _responses = await WorkbenchDB.getResponsesForRun(runId);
    _responses.sort((a, b) => {
      if (a.subtestId !== b.subtestId) return (a.subtestId || '').localeCompare(b.subtestId || '');
      if (a.iteration !== b.iteration) return (a.iteration || 0) - (b.iteration || 0);
      return (a.modelId || '').localeCompare(b.modelId || '');
    });

    // Cache model names for nav labels
    const models = await WorkbenchDB.getAllModels();
    _modelMap = new Map(models.map(m => [m.id, m]));

    // Fetch other completed runs for the cross-run comparison
    const currentRun = await WorkbenchDB.getRun(runId);
    if (currentRun && currentRun.experimentId) {
      const allRuns = await WorkbenchDB.getAll('runs');
      _completedRuns = allRuns.filter(r => r.experimentId === currentRun.experimentId && r.status === 'completed' && r.id !== runId);
      _completedRuns.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    } else {
      _completedRuns = [];
    }
    _crossRunId = null;
    _crossRunResponses = [];

    renderNav();
    if (_responses.length > 0) await renderResponse(0);
    else renderEmpty('No responses in this run yet.');
  }

  function filteredResponses() {
    if (_filter === 'unreviewed') return _responses.filter(r => (!r._reviewStatus || r._reviewStatus === 'unreviewed') && !r.reviewFlag);
    if (_filter === 'flagged') return _responses.filter(r => r.reviewFlag);
    if (_filter === 'complete') return _responses.filter(r => r._reviewStatus === 'complete');
    return _responses;
  }

  // ─── Navigation ───────────────────────────────────────────────────────────────

  function renderNav() {
    const list = document.getElementById('review-nav-list');
    if (!list) return;

    const items = filteredResponses();
    list.innerHTML = items.map((r, idx) => {
      const modelName = _modelMap.get(r.modelId)?.name || r.modelId?.slice(0, 8) || '—';
      const subtestLabel = r.subtestTitle || r.subtestId?.slice(0, 10) || '—';
      return `
      <div class="nav-item ${idx === _currentIdx ? 'nav-active' : ''} ${r.reviewFlag ? 'nav-flagged' : ''}"
           data-idx="${idx}" onclick="WorkbenchReview.goTo(${idx})">
        <span class="nav-subtest" title="${escapeHtml(subtestLabel)}">${escapeHtml(subtestLabel.length > 14 ? subtestLabel.slice(0, 13) + '…' : subtestLabel)}</span>
        <span class="nav-model" title="${escapeHtml(modelName)}">${escapeHtml(modelName.length > 12 ? modelName.slice(0, 11) + '…' : modelName)}</span>
        <span class="nav-iter">#${r.iteration || '?'}</span>
        ${r.reviewFlag ? '<span class="nav-flag">🔖</span>' : ''}
      </div>`;
    }).join('');
  }

  async function renderResponse(idx) {
    const items = filteredResponses();
    if (items.length === 0) { renderEmpty('No responses match the current filter.'); return; }
    _currentIdx = Math.max(0, Math.min(idx, items.length - 1));
    const resp = items[_currentIdx];

    const run = await WorkbenchDB.getRun(resp.runId);
    const expId = run?.experimentId;

    // Load effective schema fields for this subtest
    _effectiveFields = await WorkbenchRecordSheet.getEffectiveFields(expId, resp.subtestId);

    // Load record
    const record = await WorkbenchDB.getRecord(resp.id);
    const model = await WorkbenchDB.getModel(resp.modelId);

    const container = document.getElementById('review-main');
    if (!container) return;

    if (_compareMode) {
      await renderCompareView(resp, container);
      return;
    }

    container.innerHTML = `
      <div class="review-header">
        <div class="review-breadcrumb">
          <span>Subtest: ${escapeHtml(resp.subtestId?.slice(0, 8) || '—')}</span>
          <span>›</span>
          <span>${escapeHtml(model?.name || resp.modelId || '—')}</span>
          <span>›</span>
          <span>Iteration ${resp.iteration || '?'}</span>
        </div>
        <div class="flex-row align-center gap-sm">
          <select id="review-cross-run-select" class="form-control" style="width: auto; padding: 4px 8px; font-size: 11px;" onchange="WorkbenchReview.onCrossRunChange(this.value)">
            <option value="">Compare with Run...</option>
            ${_completedRuns.map(r => `<option value="${r.id}" ${r.id === _crossRunId ? 'selected' : ''}>Run ${r.id.slice(0, 8)} (${formatDateTime(r.createdAt || '')})</option>`).join('')}
          </select>
          <button class="btn btn-sm" onclick="WorkbenchReview.toggleCompareMode()">${_compareMode ? '📄 Single View' : '⚖ Compare Models'}</button>
          <div class="review-meta">
            <span class="meta-tag">⏱ ${resp.latencyMs ? (resp.latencyMs / 1000).toFixed(2) + 's' : '—'}</span>
            <span class="meta-tag">↑ ${resp.tokensIn ?? '—'} tok</span>
            <span class="meta-tag">↓ ${resp.tokensOut ?? '—'} tok</span>
            <span class="meta-tag">📅 ${formatDateTime(resp.createdAt)}</span>
          </div>
        </div>
      </div>

      <div class="review-prompt-toggle">
        <button class="btn-sm" onclick="WorkbenchReview.togglePrompt()">▼ Show Prompt Sent</button>
        <div id="review-prompt-panel" style="display:none" class="review-prompt-panel">
          <pre>${escapeHtml(JSON.stringify(resp.promptSent || [], null, 2))}</pre>
        </div>
      </div>

      <div style="display:flex; gap:16px;">
        <div style="flex:1; min-width:0;">
          ${_crossRunId ? `<div style="font-weight:600; margin-bottom:12px; color:var(--text-primary);">Current Run</div>` : ''}
          <div class="review-stimulus">
            <div class="review-label">USER RESPONSE (Stimulus)</div>
            <div class="review-stimulus-text">${escapeHtml(resp.promptSent?.find(m => m.role === 'user')?.content || '—')}</div>
          </div>

          <div class="review-response">
            <div class="review-label">GENERATED RESPONSE</div>
            <div class="review-response-text" id="review-resp-text">${escapeHtml(resp.text || '(empty response)')}</div>
          </div>
        </div>
        ${_crossRunId ? `
        <div style="flex:1; min-width:0; border-left:1px solid var(--border); padding-left:16px;">
          <div style="font-weight:600; margin-bottom:12px; color:var(--text-muted);">Run ${_crossRunId.slice(0, 8)}</div>
          ${(() => {
          const cross = _crossRunResponses.find(r => r.subtestId === resp.subtestId && r.iteration === resp.iteration && r.modelId === resp.modelId);
          if (!cross) return '<div class="empty-state-sm">No matching response found.</div>';
          return `
              <div class="review-stimulus">
                <div class="review-label">USER RESPONSE (Stimulus)</div>
                <div class="review-stimulus-text">${escapeHtml(cross.promptSent?.find(m => m.role === 'user')?.content || '—')}</div>
              </div>
              <div class="review-response">
                <div class="review-label">GENERATED RESPONSE</div>
                <div class="review-response-text">${escapeHtml(cross.text || '(empty response)')}</div>
              </div>
            `;
        })()}
        </div>
        ` : ''}
      </div>

      <div class="review-record-sheet" id="review-record-sheet">
        ${WorkbenchRecordSheet.renderFormHTML(_effectiveFields, record)}
      </div>

      <div class="review-controls">
        <div class="review-flags">
          <label class="checkbox-label">
            <input type="checkbox" id="review-flag-check" ${resp.reviewFlag ? 'checked' : ''}
              onchange="WorkbenchReview.toggleFlag('${resp.id}', this.checked)">
            🔖 Flag for further review
          </label>
        </div>
        <div class="review-nav-btns">
          <button class="btn" onclick="WorkbenchReview.prev()" ${_currentIdx === 0 ? 'disabled' : ''}>← Prev</button>
          <span class="nav-counter">${_currentIdx + 1} / ${items.length}</span>
          <button class="btn" onclick="WorkbenchReview.next()" ${_currentIdx >= items.length - 1 ? 'disabled' : ''}>Next →</button>
          <button class="btn btn-primary" onclick="WorkbenchReview.saveAndNext()">💾 Save &amp; Next →</button>
        </div>
      </div>`;

    document.querySelectorAll('.nav-item').forEach((el, i) => el.classList.toggle('nav-active', i === _currentIdx));
  }

  /**
   * Compare View: Shows responses from all models for the current subtest & iteration side by side.
   */
  async function renderCompareView(currentResp, container) {
    const matching = _responses.filter(r => r.subtestId === currentResp.subtestId && r.iteration === currentResp.iteration);
    const modelsMap = new Map();
    const models = await WorkbenchDB.getAllModels();
    models.forEach(m => modelsMap.set(m.id, m));

    let html = `
      <div class="review-header">
        <div class="review-breadcrumb">
          <span>Subtest: ${escapeHtml(currentResp.subtestId?.slice(0, 8) || '—')}</span>
          <span>›</span>
          <span>Iteration ${currentResp.iteration || '?'}</span>
          <span>›</span>
          <span>Model Comparison (${matching.length} models)</span>
        </div>
        <div>
          <button class="btn btn-sm" onclick="WorkbenchReview.toggleCompareMode()">📄 Single View</button>
        </div>
      </div>

      <div class="review-stimulus">
        <div class="review-label">USER RESPONSE (Stimulus)</div>
        <div class="review-stimulus-text">${escapeHtml(currentResp.promptSent?.find(m => m.role === 'user')?.content || '—')}</div>
      </div>

      <div class="compare-grid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap:16px; margin-top:16px;">
    `;

    matching.forEach(resp => {
      const modelObj = modelsMap.get(resp.modelId);
      html += `
        <div class="panel" style="display:flex; flex-direction:column;">
          <div class="panel-header" style="justify-content:space-between; flex-wrap:wrap; gap:6px;">
            <span class="panel-title">${escapeHtml(modelObj?.name || resp.modelId)}</span>
            <span class="flex-row gap-sm" style="font-size:11px; color:var(--text-muted);">
              <span>⏱ ${resp.latencyMs ? (resp.latencyMs / 1000).toFixed(2) + 's' : '—'}</span>
              <span>↑ ${resp.tokensIn ?? '—'}</span>
              <span>↓ ${resp.tokensOut ?? '—'}</span>
            </span>
          </div>
          <div class="panel-body flex-1" style="white-space:pre-wrap; font-size:13px; line-height:1.5;">${escapeHtml(resp.text || '(empty response)')}</div>
        </div>
      `;
    });

    html += `</div>
      <div class="review-controls" style="margin-top:20px;">
        <div class="review-nav-btns">
          <button class="btn" onclick="WorkbenchReview.prev()" ${_currentIdx === 0 ? 'disabled' : ''}>← Prev</button>
          <span class="nav-counter">${_currentIdx + 1} / ${_responses.length}</span>
          <button class="btn" onclick="WorkbenchReview.next()" ${_currentIdx >= _responses.length - 1 ? 'disabled' : ''}>Next →</button>
        </div>
      </div>
    `;

    container.innerHTML = html;

    // Keyboard shortcut hint (show once per session)
    if (!sessionStorage.getItem('kb-hint-shown')) {
      setTimeout(() => {
        showToast('Tip: Use ← → to navigate, F to flag, S to save & next', 'info');
        sessionStorage.setItem('kb-hint-shown', '1');
      }, 600);
    }
  }

  function toggleCompareMode() {
    _compareMode = !_compareMode;
    renderResponse(_currentIdx);
  }

  async function onCrossRunChange(runId) {
    _crossRunId = runId || null;
    if (_crossRunId) {
      _crossRunResponses = await WorkbenchDB.getResponsesForRun(_crossRunId);
    } else {
      _crossRunResponses = [];
    }
    renderResponse(_currentIdx);
  }

  function renderEmpty(msg) {
    const container = document.getElementById('review-main');
    if (container) container.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><p>${escapeHtml(msg)}</p></div>`;
    const nav = document.getElementById('review-nav-list');
    if (nav) nav.innerHTML = '';
  }

  // ─── Actions ─────────────────────────────────────────────────────────────────

  async function goTo(idx) {
    await saveCurrent();
    await renderResponse(idx);
  }

  function prev() {
    if (_currentIdx > 0) goTo(_currentIdx - 1);
  }

  function next() {
    const items = filteredResponses();
    if (_currentIdx < items.length - 1) goTo(_currentIdx + 1);
  }

  async function saveAndNext() {
    await saveCurrent();
    next();
  }

  async function saveCurrent() {
    const items = filteredResponses();
    if (items.length === 0 || _compareMode) return;
    const resp = items[_currentIdx];

    const values = WorkbenchRecordSheet.collectValues(_effectiveFields);
    if (!values) return;

    await WorkbenchDB.saveRecord({
      responseId: resp.id,
      runId: resp.runId,
      reviewStatus: values.reviewStatus,
      notes: values.notes,
      fieldValues: values.fieldValues,
    });
    resp._reviewStatus = values.reviewStatus;
    showToast('Record saved.', 'success');

    // Auto-progress experiment to Completed (Item 11)
    if (_responses.every(r => r._reviewStatus === 'complete')) {
      const run = await WorkbenchDB.getRun(resp.runId);
      if (run) {
        const expId = run.experimentId;
        const exp = await WorkbenchDB.getExperiment(expId);
        if (exp && exp.status === 'In Review') {
          setTimeout(async () => {
            if (confirm(`All responses for "${exp.title}" are now reviewed.\nWould you like to mark the experiment as Completed?`)) {
              exp.status = 'Completed';
              await WorkbenchDB.saveExperiment(exp);
              WorkbenchBus.emit('experiments:changed');
              showToast('Experiment status updated to Completed.', 'success');
            }
          }, 300); // delay to let UI settle
        }
      }
    }
  }

  async function toggleFlag(responseId, flagged) {
    const resp = _responses.find(r => r.id === responseId);
    if (!resp) return;
    resp.reviewFlag = flagged;
    await WorkbenchDB.updateResponse(responseId, { reviewFlag: flagged });
    renderNav();
  }

  function togglePrompt() {
    const panel = document.getElementById('review-prompt-panel');
    if (!panel) return;
    const btn = panel.previousElementSibling;
    const shown = panel.style.display !== 'none';
    panel.style.display = shown ? 'none' : '';
    if (btn) btn.textContent = shown ? '▼ Show Prompt Sent' : '▲ Hide Prompt Sent';
  }

  function setFilter(f) {
    _filter = f;
    document.querySelectorAll('.filter-btn').forEach(el => el.classList.toggle('active', el.dataset.filter === f));
    renderNav();
    renderResponse(0);
  }

  // ─── Init ─────────────────────────────────────────────────────────────────────

  async function init() {
    WorkbenchBus.on('response:saved', async () => {
      if (!_runId) return;
      _responses = await WorkbenchDB.getResponsesForRun(_runId);
      _responses.sort((a, b) => {
        if (a.subtestId !== b.subtestId) return (a.subtestId || '').localeCompare(b.subtestId || '');
        if (a.iteration !== b.iteration) return (a.iteration || 0) - (b.iteration || 0);
        return (a.modelId || '').localeCompare(b.modelId || '');
      });
      renderNav();
    });

    WorkbenchBus.on('batch:complete', () => { if (_runId) loadRun(_runId); });

    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => setFilter(btn.dataset.filter));
    });

    // Keyboard navigation
    document.addEventListener('keydown', e => {
      // Only fire when the review tab is active and not inside an input/textarea
      if (WorkbenchApp.getActiveTab() !== 'review') return;
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (e.key === 'ArrowRight' || e.key === 'n') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft' || e.key === 'p') { e.preventDefault(); prev(); }
      else if (e.key === 'f' || e.key === 'F') {
        const items = filteredResponses();
        const resp = items[_currentIdx];
        if (resp) toggleFlag(resp.id, !resp.reviewFlag);
      }
      else if (e.key === 's' || e.key === 'S') { e.preventDefault(); saveAndNext(); }
    });

    WorkbenchApp.registerTab('review', load);
  }

  /**
   * Called by WorkbenchCharts when a bar is clicked.
   * Loads the given run and pre-filters responses to the specified modelId.
   */
  async function drilldown(runId, modelId, label) {
    _runId = runId;
    WorkbenchState.selectedRunId = runId;
    _responses = await WorkbenchDB.getResponsesForRun(runId);
    _responses.sort((a, b) => {
      if (a.subtestId !== b.subtestId) return (a.subtestId || '').localeCompare(b.subtestId || '');
      if (a.iteration !== b.iteration) return (a.iteration || 0) - (b.iteration || 0);
      return (a.modelId || '').localeCompare(b.modelId || '');
    });

    if (modelId) {
      // Apply a temporary model filter by reducing visible responses
      const filtered = _responses.filter(r => r.modelId === modelId);
      if (filtered.length > 0) {
        // Show a notice in the log area
        showToast(`Showing ${filtered.length} response${filtered.length !== 1 ? 's' : ''} for model: ${label || modelId}`, 'info');
      }
      _responses = filtered.length > 0 ? filtered : _responses;
    }

    renderNav();
    if (_responses.length > 0) await renderResponse(0);
    else renderEmpty('No responses found for this filter.');
  }

  window.WorkbenchReview = { init, load, loadRun, drilldown, goTo, prev, next, saveAndNext, toggleFlag, togglePrompt, setFilter, toggleCompareMode, onCrossRunChange };
})();
