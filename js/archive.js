/**
 * archive.js — Searchable Research Archive Module for AnansiWorkbench.
 */

(() => {
  'use strict';

  const { escapeHtml, formatDateTime } = WorkbenchUtils;

  let _experiments = [];
  let _runs = [];
  let _allResponses = [];
  let _query = '';
  let _selectedExp = 'all';

  async function load() {
    _experiments = await WorkbenchDB.getAllExperiments();
    _runs = await WorkbenchDB.getAll('runs');
    _allResponses = await WorkbenchDB.getAll('responses');

    renderUI();
  }

  function renderUI() {
    const container = document.getElementById('tab-archive');
    if (!container) return;

    const totalExps = _experiments.length;
    const totalRuns = _runs.length;
    const totalResponses = _allResponses.length;
    const flaggedCount = _allResponses.filter(r => r.reviewFlag).length;

    container.innerHTML = `
      <div class="section-header">
        <h1 class="section-title">Research Archive</h1>
        <div class="section-actions flex-row gap-sm">
          <button class="btn" onclick="WorkbenchExport.exportJSON()">⬇ Export Backup (JSON)</button>
          <button class="btn" onclick="WorkbenchExport.exportCSV()">📊 Export CSV Data</button>
        </div>
      </div>

      <!-- Overview stats -->
      <div class="exec-stats-grid" style="margin-bottom:20px;">
        <div class="stat-card">
          <div class="stat-value">${totalExps}</div>
          <div class="stat-label">Experiments</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${totalRuns}</div>
          <div class="stat-label">Total Runs</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${totalResponses}</div>
          <div class="stat-label">Generated Responses</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${flaggedCount}</div>
          <div class="stat-label">Flagged Reviews</div>
        </div>
      </div>

      <!-- Controls & Search Bar -->
      <div class="panel" style="margin-bottom:20px;">
        <div class="panel-body flex-row gap-md align-center wrap">
          <div class="form-group flex-1" style="margin-bottom:0; min-width:250px;">
            <input type="text" id="archive-search-input" placeholder="🔍 Search prompts, responses, tags, experiments..." 
                   value="${escapeHtml(_query)}" oninput="WorkbenchArchive.onSearch(this.value)">
          </div>
          <div class="form-group" style="margin-bottom:0; min-width:200px;">
            <select id="archive-exp-filter" onchange="WorkbenchArchive.onFilterExp(this.value)">
              <option value="all">All Experiments</option>
              ${_experiments.map(e => `<option value="${e.id}" ${e.id === _selectedExp ? 'selected' : ''}>${escapeHtml(e.title)}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <!-- Results List -->
      <div class="archive-list" id="archive-list">
        ${renderArchiveList()}
      </div>
    `;
  }

  function renderArchiveList() {
    let filteredExps = _experiments;
    if (_selectedExp !== 'all') {
      filteredExps = filteredExps.filter(e => e.id === _selectedExp);
    }

    const q = _query.toLowerCase().trim();
    if (q) {
      filteredExps = filteredExps.filter(e => {
        const titleMatch = e.title.toLowerCase().includes(q);
        const descMatch = (e.description || '').toLowerCase().includes(q);
        const catMatch = (e.category || '').toLowerCase().includes(q);
        const tagMatch = (e.tags || []).some(t => t.toLowerCase().includes(q));
        return titleMatch || descMatch || catMatch || tagMatch;
      });
    }

    if (filteredExps.length === 0) {
      return `<div class="empty-state"><div class="empty-icon">🗄</div><p>No matching experiments or research records found.</p></div>`;
    }

    return filteredExps.map(exp => {
      const expRuns = _runs.filter(r => r.experimentId === exp.id);
      const expResponses = _allResponses.filter(r => expRuns.some(run => run.id === r.runId));

      return `
        <div class="panel" style="margin-bottom:16px;">
          <div class="panel-header" style="justify-content:space-between; align-items:center;">
            <div>
              <span class="panel-title" style="font-size:16px; font-weight:700;">${escapeHtml(exp.title)}</span>
              <span class="badge badge-gray" style="margin-left:8px;">${exp.status}</span>
              ${exp.category ? `<span class="badge badge-blue" style="margin-left:4px;">${escapeHtml(exp.category)}</span>` : ''}
            </div>
            <div class="meta-tag">Modified ${formatDateTime(exp.modifiedAt)}</div>
          </div>
          <div class="panel-body">
            <p style="font-size:13px; color:var(--text-secondary); margin-bottom:12px;">${escapeHtml(exp.description || 'No description provided.')}</p>
            
            <div class="flex-row gap-lg align-center wrap" style="font-size:12px; color:var(--text-muted); border-top:1px solid var(--border-subtle); margin-top:8px; padding-top:8px;">
              <span>🏃 <strong>${expRuns.length}</strong> Runs</span>
              <span>💬 <strong>${expResponses.length}</strong> Responses</span>
              <span>🏷 Tags: ${exp.tags?.length ? exp.tags.map(t => `<span class="badge badge-gray" style="font-size:10px;">${escapeHtml(t)}</span>`).join(' ') : '—'}</span>
              ${expResponses.length > 0 ? (() => {
          const reviewed = expResponses.filter(r => r._reviewStatus === 'complete').length;
          const flagged = expResponses.filter(r => r.reviewFlag).length;
          const pct = Math.round((reviewed / expResponses.length) * 100);
          return `<span>✅ <strong>${pct}%</strong> reviewed</span><span>🔖 <strong>${flagged}</strong> flagged</span>`;
        })() : ''}
            </div>

            ${expRuns.length > 0 ? `
              <div style="margin-top:12px;">
                <div style="font-size:12px; font-weight:600; color:var(--text-primary); margin-bottom:6px;">Runs History:</div>
                <div class="flex-column gap-xs">
                  ${expRuns.map(run => {
          const runResps = expResponses.filter(r => r.runId === run.id);
          const runReviewed = runResps.filter(r => r._reviewStatus === 'complete').length;
          const runFlagged = runResps.filter(r => r.reviewFlag).length;
          const runPct = runResps.length > 0 ? Math.round((runReviewed / runResps.length) * 100) : 0;
          return `
                    <div class="flex-row align-center justify-between" style="background:var(--bg-card); padding:8px 12px; border-radius:6px; font-size:12px;">
                      <div>
                        <strong>Run ${run.id.slice(0, 8)}</strong> — <span class="status-badge badge-${run.status === 'completed' ? 'green' : 'gray'}">${run.status}</span>
                        <span style="color:var(--text-muted); margin-left:8px;">${formatDateTime(run.startedAt || run.createdAt)}</span>
                        ${runResps.length > 0 ? `<span style="color:var(--text-muted); margin-left:8px;">· ${runResps.length} responses · ${runPct}% reviewed · ${runFlagged} flagged</span>` : ''}
                      </div>
                      <div class="flex-row gap-sm">
                        <button class="btn btn-sm" onclick="WorkbenchArchive.openRunInReview('${run.id}')">📋 Open in Review</button>
                        <button class="btn btn-sm btn-danger" onclick="WorkbenchArchive.confirmDeleteRun('${run.id}')">🗑</button>
                      </div>
                    </div>`;
        }).join('')}
                </div>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  function onSearch(q) {
    _query = q;
    const listContainer = document.getElementById('archive-list');
    if (listContainer) listContainer.innerHTML = renderArchiveList();
  }

  function onFilterExp(expId) {
    _selectedExp = expId;
    const listContainer = document.getElementById('archive-list');
    if (listContainer) listContainer.innerHTML = renderArchiveList();
  }

  function openRunInReview(runId) {
    WorkbenchState.selectedRunId = runId;
    WorkbenchReview.loadRun(runId);
    WorkbenchApp.activateTab('review');
  }

  async function confirmDeleteRun(runId) {
    if (!confirm('Are you sure you want to delete this run? This will cascade delete all jobs, responses, and records associated with it. This cannot be undone.')) return;
    try {
      await WorkbenchDB.deleteRun(runId);
      showToast('Run and all associated data deleted.', 'success');
      await load();
    } catch (e) {
      console.error(e);
      showToast('Error deleting run.', 'error');
    }
  }

  async function init() {
    WorkbenchApp.registerTab('archive', load);
  }

  window.WorkbenchArchive = {
    init, load, onSearch, onFilterExp, openRunInReview, confirmDeleteRun
  };
})();
