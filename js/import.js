/**
 * import.js — AnansiForge Mission Control Hub for AnansiWorkbench.
 * Handles Vault import, IndexedDB persistence, sub-tab filtering, 
 * Table/Card views, asset inspection, and single/batch experiment creation.
 */

(() => {
  'use strict';

  const { escapeHtml, formatDate } = WorkbenchUtils;

  let _vaultAssets = [];
  let _subtab = 'projects'; // 'all' | 'projects' | 'characters' | 'scenarios' | 'universes'
  let _viewMode = 'table'; // 'table' | 'cards'
  let _searchQuery = '';
  let _selectedCategory = 'all';
  let _selectedUniverse = 'all';
  let _selectedIds = new Set();

  async function load() {
    // Load persisted assets from IndexedDB
    _vaultAssets = await WorkbenchDB.getForgeAssets();
    renderUI();
  }

  function renderUI() {
    const container = document.getElementById('tab-import');
    if (!container) return;

    // Count categories
    const projects = _vaultAssets.filter(a => a.assetType === 'project');
    const characters = _vaultAssets.filter(a => a.assetType === 'character');
    const scenarios = _vaultAssets.filter(a => a.assetType === 'scenario');
    const universes = _vaultAssets.filter(a => a.assetType === 'universe');

    container.innerHTML = `
      <div class="section-header">
        <div>
          <h1 class="section-title">AnansiForge Vault Hub</h1>
          <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">
            Browse, search, and batch convert legacy AnansiForge characters and projects into Workbench Experiments.
          </div>
        </div>
        <div class="section-actions">
          <button class="btn btn-sm" onclick="WorkbenchImport.triggerFilePicker()">📁 Load Backup JSON</button>
          ${_vaultAssets.length > 0 ? `<button class="btn btn-sm btn-danger" onclick="WorkbenchImport.clearVault()">🗑 Clear Vault</button>` : ''}
        </div>
      </div>

      <!-- KPI Summary Header -->
      <div class="flex-row gap-md" style="margin-bottom:16px;">
        <div class="panel flex-1" style="padding:12px 16px;">
          <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:700;">Compiled Bots</div>
          <div style="font-size:22px; font-weight:700; color:var(--text-primary); margin-top:2px;">${projects.length}</div>
        </div>
        <div class="panel flex-1" style="padding:12px 16px;">
          <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:700;">Characters</div>
          <div style="font-size:22px; font-weight:700; color:var(--accent); margin-top:2px;">${characters.length}</div>
        </div>
        <div class="panel flex-1" style="padding:12px 16px;">
          <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:700;">Scenarios</div>
          <div style="font-size:22px; font-weight:700; color:var(--text-secondary); margin-top:2px;">${scenarios.length}</div>
        </div>
        <div class="panel flex-1" style="padding:12px 16px;">
          <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:700;">Universes</div>
          <div style="font-size:22px; font-weight:700; color:var(--text-muted); margin-top:2px;">${universes.length}</div>
        </div>
      </div>

      ${_vaultAssets.length === 0 ? renderEmptyState() : renderMissionControlHub(projects.length, characters.length, scenarios.length, universes.length)}
    `;

    if (_vaultAssets.length > 0) {
      renderAssetView();
    }
  }

  function renderEmptyState() {
    return `
      <div class="panel" style="max-width:640px; margin:20px auto; text-align:center;">
        <div class="panel-body flex-column align-center gap-md" style="padding:40px 24px;">
          <div style="font-size:48px;">🔥</div>
          <h2 style="font-size:18px; font-weight:700;">No AnansiForge Vault Assets Loaded</h2>
          <p style="font-size:13px; color:var(--text-secondary); max-width:480px; line-height:1.5;">
            Load an <strong>AnansiForge .json backup file</strong> to persist all character cards, scenarios, and compiled bot projects into your local Workbench vault.
          </p>
          <button class="btn btn-primary" onclick="WorkbenchImport.triggerFilePicker()">📁 Select AnansiForge JSON Backup</button>
        </div>
      </div>
    `;
  }

  function renderMissionControlHub(projCount, charCount, scenCount, univCount) {
    // Collect unique universes
    const universesSet = new Set(_vaultAssets.map(a => a.universe).filter(Boolean));

    return `
      <!-- Sub-Tab Navigation -->
      <div class="subtab-nav">
        <button class="subtab-btn ${_subtab === 'projects' ? 'active' : ''}" onclick="WorkbenchImport.setSubtab('projects')">
          📦 Projects <span class="subtab-count">${projCount}</span>
        </button>
        <button class="subtab-btn ${_subtab === 'characters' ? 'active' : ''}" onclick="WorkbenchImport.setSubtab('characters')">
          🎭 Characters <span class="subtab-count">${charCount}</span>
        </button>
        <button class="subtab-btn ${_subtab === 'scenarios' ? 'active' : ''}" onclick="WorkbenchImport.setSubtab('scenarios')">
          🎬 Scenarios <span class="subtab-count">${scenCount}</span>
        </button>
        <button class="subtab-btn ${_subtab === 'universes' ? 'active' : ''}" onclick="WorkbenchImport.setSubtab('universes')">
          🌐 Universes <span class="subtab-count">${univCount}</span>
        </button>
        <button class="subtab-btn ${_subtab === 'all' ? 'active' : ''}" onclick="WorkbenchImport.setSubtab('all')">
          🌐 All Assets <span class="subtab-count">${_vaultAssets.length}</span>
        </button>
      </div>

      <!-- Controls Bar: Search, Filters, View Toggles -->
      <div class="flex-row align-center justify-between gap-md" style="margin-bottom:14px; flex-wrap:wrap;">
        <div class="flex-row align-center gap-sm flex-1" style="min-width:280px;">
          <input type="text" id="forge-search-input" placeholder="🔍 Search vault assets..." value="${escapeHtml(_searchQuery)}" 
                 oninput="WorkbenchImport.onSearch(this.value)" style="max-width:320px;">
          ${universesSet.size > 0 ? `
            <select id="forge-universe-select" onchange="WorkbenchImport.onUniverseFilter(this.value)" style="width:160px;">
              <option value="all">All Universes</option>
              ${Array.from(universesSet).map(u => `<option value="${escapeHtml(u)}" ${_selectedUniverse === u ? 'selected' : ''}>${escapeHtml(u)}</option>`).join('')}
            </select>
          ` : ''}
        </div>

        <div class="flex-row align-center gap-sm">
          <span style="font-size:12px; color:var(--text-muted); font-weight:600;">View:</span>
          <button class="btn btn-sm ${_viewMode === 'table' ? 'btn-primary' : ''}" onclick="WorkbenchImport.setViewMode('table')">📄 Table</button>
          <button class="btn btn-sm ${_viewMode === 'cards' ? 'btn-primary' : ''}" onclick="WorkbenchImport.setViewMode('cards')">🎴 Cards</button>
        </div>
      </div>

      <!-- Main Assets Render Area -->
      <div id="forge-assets-view" class="flex-1" style="overflow-y:auto; min-height:280px;"></div>

      <!-- Floating Batch Action Bar -->
      <div id="forge-batch-bar" class="batch-action-bar" style="display:${_selectedIds.size > 0 ? 'flex' : 'none'};">
        <div class="flex-row align-center gap-md">
          <span style="font-weight:700; font-size:14px; color:var(--text-primary);">
            ⚡ ${_selectedIds.size} Asset${_selectedIds.size === 1 ? '' : 's'} Selected
          </span>
          <button class="btn btn-sm" onclick="WorkbenchImport.selectAllFiltered(false)">Deselect All</button>
        </div>
        <button class="btn btn-primary" onclick="WorkbenchImport.batchCreateExperiments()">
          ⚡ Convert Selected (${_selectedIds.size}) to Experiments
        </button>
      </div>
    `;
  }

  function getFilteredAssets() {
    return _vaultAssets.filter(asset => {
      if (_subtab !== 'all' && asset.assetType !== _subtab) return false;
      if (_selectedUniverse !== 'all' && asset.universe !== _selectedUniverse) return false;
      if (_searchQuery) {
        const q = _searchQuery.toLowerCase();
        const titleMatch = (asset.name || asset.title || '').toLowerCase().includes(q);
        const descMatch = (asset.description || asset.personality || '').toLowerCase().includes(q);
        const universeMatch = (asset.universe || '').toLowerCase().includes(q);
        return titleMatch || descMatch || universeMatch;
      }
      return true;
    });
  }

  function renderAssetView() {
    const area = document.getElementById('forge-assets-view');
    if (!area) return;

    const filtered = getFilteredAssets();

    if (filtered.length === 0) {
      area.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <p>No matching vault assets found.</p>
          <p class="empty-sub">Try changing your search query or sub-tab filter.</p>
        </div>
      `;
      return;
    }

    if (_viewMode === 'table') {
      renderTableView(area, filtered);
    } else {
      renderCardView(area, filtered);
    }
  }

  function renderTableView(container, items) {
    const allSelected = items.every(item => _selectedIds.has(item.id));

    container.innerHTML = `
      <div class="forge-table-container">
        <table class="forge-table">
          <thead>
            <tr>
              <th style="width:36px; text-align:center;">
                <input type="checkbox" ${allSelected ? 'checked' : ''} onchange="WorkbenchImport.toggleSelectAll(this.checked)">
              </th>
              <th>Name / Asset Title</th>
              <th>Type</th>
              <th>Universe / Series</th>
              <th>Description / Preview</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(item => {
      const isSelected = _selectedIds.has(item.id);
      return `
                <tr class="${isSelected ? 'selected' : ''}">
                  <td style="text-align:center;">
                    <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="WorkbenchImport.toggleSelect('${item.id}', this.checked)">
                  </td>
                  <td>
                    <strong style="color:var(--text-primary);">${escapeHtml(item.name || 'Untitled Asset')}</strong>
                  </td>
                  <td>
                    <span class="badge ${getTypeBadgeClass(item.assetType)}">${item.assetType}</span>
                  </td>
                  <td>
                    ${item.universe ? `<span class="badge badge-gray">${escapeHtml(item.universe)}</span>` : '<span style="color:var(--text-muted);">—</span>'}
                  </td>
                  <td style="max-width:320px; font-size:12px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    ${escapeHtml(item.description || item.personality || 'No description')}
                  </td>
                  <td style="text-align:right; white-space:nowrap;">
                    <button class="btn btn-sm" onclick="WorkbenchImport.openAssetModal('${item.id}')">👁 Inspect</button>
                    <button class="btn btn-sm btn-primary" onclick="WorkbenchImport.createExperimentForAsset('${item.id}')">⚡ Convert</button>
                  </td>
                </tr>
              `;
    }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderCardView(container, items) {
    container.innerHTML = `
      <div class="forge-card-grid">
        ${items.map(item => {
      const isSelected = _selectedIds.has(item.id);
      return `
            <div class="forge-card ${isSelected ? 'selected' : ''}">
              <div class="forge-card-header">
                <div class="flex-row align-center gap-sm">
                  <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="WorkbenchImport.toggleSelect('${item.id}', this.checked)">
                  <strong style="font-size:14px; color:var(--text-primary);">${escapeHtml(item.name || 'Untitled')}</strong>
                </div>
                <span class="badge ${getTypeBadgeClass(item.assetType)}">${item.assetType}</span>
              </div>
              <div class="forge-card-body">
                ${item.universe ? `<div style="margin-bottom:6px;"><span class="badge badge-gray">${escapeHtml(item.universe)}</span></div>` : ''}
                <div style="font-size:12px; color:var(--text-secondary); max-height:80px; overflow:hidden;">
                  ${escapeHtml(item.description || item.personality || 'No prompt preview available.')}
                </div>
              </div>
              <div class="forge-card-footer">
                <button class="btn btn-sm" onclick="WorkbenchImport.openAssetModal('${item.id}')">👁 Inspect</button>
                <button class="btn btn-sm btn-primary" onclick="WorkbenchImport.createExperimentForAsset('${item.id}')">⚡ Convert</button>
              </div>
            </div>
          `;
    }).join('')}
      </div>
    `;
  }

  function getTypeBadgeClass(type) {
    switch (type) {
      case 'project': return 'badge-blue';
      case 'character': return 'badge-teal';
      case 'scenario': return 'badge-yellow';
      case 'universe': return 'badge-green';
      default: return 'badge-gray';
    }
  }

  // ─── Event Handlers ─────────────────────────────────────────────────────────

  function setSubtab(subtab) {
    _subtab = subtab;
    renderUI();
  }

  function setViewMode(mode) {
    _viewMode = mode;
    renderAssetView();
  }

  function onSearch(query) {
    _searchQuery = query;
    renderAssetView();
  }

  function onUniverseFilter(universe) {
    _selectedUniverse = universe;
    renderAssetView();
  }

  function toggleSelect(id, checked) {
    if (checked) _selectedIds.add(id);
    else _selectedIds.delete(id);

    const batchBar = document.getElementById('forge-batch-bar');
    if (batchBar) {
      batchBar.style.display = _selectedIds.size > 0 ? 'flex' : 'none';
    }
    renderAssetView();
  }

  function toggleSelectAll(checked) {
    const filtered = getFilteredAssets();
    if (checked) {
      filtered.forEach(item => _selectedIds.add(item.id));
    } else {
      filtered.forEach(item => _selectedIds.delete(item.id));
    }
    renderUI();
  }

  function selectAllFiltered(select) {
    if (!select) _selectedIds.clear();
    renderUI();
  }

  // ─── File Picker & Persistence ──────────────────────────────────────────────

  function triggerFilePicker() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const data = JSON.parse(evt.target.result);
          await parseAndStoreForgeBackup(data);
        } catch (err) {
          console.error('Forge import parse error:', err);
          showToast('Failed to parse AnansiForge JSON: ' + err.message, 'error');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  async function parseAndStoreForgeBackup(data) {
    const components = data.components || data.vault_components || [];
    const projects = data.projects || [];
    const trackerRecords = data.trackerRecords || [];

    const assetsToSave = [];

    // Parse compiled projects
    projects.forEach(p => {
      const card = p.compiledCard || p;
      assetsToSave.push({
        id: 'proj_' + (p.id || WorkbenchDB.generateId()),
        assetType: 'project',
        name: p.name || p.title || 'Untitled Project',
        description: p.description || 'Compiled Bot Project',
        universe: p.universe || p.series || '',
        personality: card.personality || card.system_prompt || '',
        scenario: card.scenario || card.world_scenario || '',
        initialMessage: card.first_mes || card.greeting || '',
        raw: p,
      });
    });

    // Parse components
    components.forEach(c => {
      const cat = (c.category || c.type || 'character').toLowerCase();
      let assetType = 'character';
      if (cat.includes('scenario')) assetType = 'scenario';
      else if (cat.includes('universe') || cat.includes('rule')) assetType = 'universe';

      assetsToSave.push({
        id: 'comp_' + (c.id || WorkbenchDB.generateId()),
        assetType,
        name: c.name || 'Untitled Component',
        description: c.description || c.content || '',
        universe: c.universe || c.series || '',
        personality: c.content || c.personality || '',
        scenario: c.scenario || '',
        initialMessage: c.first_mes || c.initialMessage || '',
        raw: c,
      });
    });

    if (assetsToSave.length === 0) {
      showToast('No valid components or projects found in JSON.', 'warning');
      return;
    }

    await WorkbenchDB.saveForgeAssets(assetsToSave);
    _vaultAssets = await WorkbenchDB.getForgeAssets();
    showToast(`Successfully imported & saved ${assetsToSave.length} vault assets!`, 'success');
    renderUI();
  }

  async function clearVault() {
    const confirm = await showConfirm('Are you sure you want to clear all loaded AnansiForge vault assets?', 'Clear Vault');
    if (!confirm) return;

    await WorkbenchDB.clearForgeAssets();
    _vaultAssets = [];
    _selectedIds.clear();
    showToast('AnansiForge Vault cleared.', 'info');
    renderUI();
  }

  // ─── Asset Inspector Modal ──────────────────────────────────────────────────

  function openAssetModal(id) {
    const item = _vaultAssets.find(a => a.id === id);
    if (!item) return;

    const content = document.getElementById('forge-asset-content');
    const title = document.getElementById('forge-asset-title');

    if (title) title.textContent = `Asset: ${item.name}`;

    if (content) {
      content.innerHTML = `
        <div class="flex-column gap-md">
          <div class="flex-row gap-sm align-center">
            <span class="badge ${getTypeBadgeClass(item.assetType)}">${item.assetType}</span>
            ${item.universe ? `<span class="badge badge-gray">Universe: ${escapeHtml(item.universe)}</span>` : ''}
          </div>

          <div class="form-group">
            <label>Title / Name</label>
            <input type="text" value="${escapeHtml(item.name)}" readonly>
          </div>

          ${item.personality ? `
            <div class="form-group">
              <label>Personality / System Prompt</label>
              <textarea readonly style="height:120px; font-family:var(--font-mono);">${escapeHtml(item.personality)}</textarea>
            </div>
          ` : ''}

          ${item.scenario ? `
            <div class="form-group">
              <label>Scenario Text</label>
              <textarea readonly style="height:80px; font-family:var(--font-mono);">${escapeHtml(item.scenario)}</textarea>
            </div>
          ` : ''}

          ${item.initialMessage ? `
            <div class="form-group">
              <label>Initial Message / Greeting</label>
              <textarea readonly style="height:80px; font-family:var(--font-mono);">${escapeHtml(item.initialMessage)}</textarea>
            </div>
          ` : ''}

          <div class="form-group">
            <label>Raw Data JSON</label>
            <textarea readonly style="height:120px; font-family:var(--font-mono); font-size:11px;">${escapeHtml(JSON.stringify(item.raw || item, null, 2))}</textarea>
          </div>
        </div>
      `;
    }

    const footer = document.getElementById('forge-asset-footer');
    if (footer) {
      footer.innerHTML = `
        <button class="btn" onclick="closeModal('modal-forge-asset')">Close</button>
        <button class="btn btn-primary" onclick="closeModal('modal-forge-asset'); WorkbenchImport.createExperimentForAsset('${item.id}');">
          ⚡ Convert to Experiment
        </button>
      `;
    }

    openModal('modal-forge-asset');
  }

  // ─── Convert to Experiment (Single & Batch) ─────────────────────────────────

  async function createExperimentForAsset(id) {
    const item = _vaultAssets.find(a => a.id === id);
    if (!item) return;

    const exp = {
      title: `[Forge] ${item.name}`,
      description: item.description || `Converted from AnansiForge ${item.assetType}`,
      category: 'AnansiForge',
      tags: ['anansi-forge', item.assetType],
      status: 'Draft',
      personality: item.personality || '',
      scenario: item.scenario || '',
      initialMessage: item.initialMessage || '',
      defaultRepetitions: 3,
      defaultParams: { temperature: 0.9, max_tokens: 500 },
      subtests: [
        {
          id: WorkbenchDB.generateId(),
          title: 'Voicing Subtest',
          description: 'Initial prompt response test case',
          testCases: ['Hello! Introduce yourself.'],
          overrides: {},
          disabled: false
        }
      ]
    };

    const saved = await WorkbenchDB.saveExperiment(exp);
    showToast(`Experiment "${saved.title}" created! Opening builder...`, 'success');
    WorkbenchExperiments.openBuilder(saved.id);
    WorkbenchApp.activateTab('experiments');
  }

  async function batchCreateExperiments() {
    if (_selectedIds.size === 0) return;

    const confirm = await showConfirm(`Create ${_selectedIds.size} new Workbench Experiments from the selected items?`, 'Batch Create');
    if (!confirm) return;

    let createdCount = 0;
    for (const id of _selectedIds) {
      const item = _vaultAssets.find(a => a.id === id);
      if (!item) continue;

      const exp = {
        title: `[Forge] ${item.name}`,
        description: item.description || `Batch converted from AnansiForge ${item.assetType}`,
        category: 'AnansiForge Batch',
        tags: ['anansi-forge', 'batch', item.assetType],
        status: 'Draft',
        personality: item.personality || '',
        scenario: item.scenario || '',
        initialMessage: item.initialMessage || '',
        defaultRepetitions: 3,
        subtests: [
          {
            id: WorkbenchDB.generateId(),
            title: 'Voicing Subtest',
            description: 'Initial prompt response test case',
            testCases: ['Hello! Introduce yourself.'],
            overrides: {},
            disabled: false
          }
        ]
      };

      await WorkbenchDB.saveExperiment(exp);
      createdCount++;
    }

    _selectedIds.clear();
    showToast(`Batch created ${createdCount} experiments! Navigating to Experiments tab...`, 'success');
    WorkbenchApp.activateTab('experiments');
  }

  async function init() {
    WorkbenchApp.registerTab('import', load);
  }

  window.WorkbenchImport = {
    init,
    load,
    setSubtab,
    setViewMode,
    onSearch,
    onUniverseFilter,
    toggleSelect,
    toggleSelectAll,
    selectAllFiltered,
    triggerFilePicker,
    clearVault,
    openAssetModal,
    createExperimentForAsset,
    batchCreateExperiments,
  };
  window.WorkbenchImportForge = window.WorkbenchImport;
})();
