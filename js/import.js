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

  function matchesSubtab(asset, subtab) {
    if (!subtab || subtab === 'all') return true;
    const type = (asset.assetType || '').toLowerCase();
    const st = subtab.toLowerCase();

    if (st === 'projects' || st === 'project') {
      return type === 'project' || type === 'projects';
    }
    if (st === 'characters' || st === 'character') {
      return type === 'character' || type === 'characters' || type === 'bio';
    }
    if (st === 'scenarios' || st === 'scenario') {
      return type === 'scenario' || type === 'scenarios';
    }
    if (st === 'universes' || st === 'universe') {
      return type === 'universe' || type === 'universes';
    }
    return type === st;
  }

  function renderUI() {
    const container = document.getElementById('tab-import');
    if (!container) return;

    // Count categories
    const projects = _vaultAssets.filter(a => matchesSubtab(a, 'projects'));
    const characters = _vaultAssets.filter(a => matchesSubtab(a, 'characters'));
    const scenarios = _vaultAssets.filter(a => matchesSubtab(a, 'scenarios'));
    const universes = _vaultAssets.filter(a => matchesSubtab(a, 'universes'));

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
          <span id="forge-selected-count" style="font-weight:700; font-size:14px; color:var(--text-primary);">
            ⚡ ${_selectedIds.size} Asset${_selectedIds.size === 1 ? '' : 's'} Selected
          </span>
          <button class="btn btn-sm" onclick="WorkbenchImport.selectAllFiltered(false)">Deselect All</button>
        </div>
        <div class="flex-row align-center gap-sm">
          <button class="btn btn-sm btn-primary" onclick="WorkbenchImport.openAssemblyWorkspace()">
            🧪 Custom Assembly Workspace (Workflow A)
          </button>
          <button class="btn btn-sm btn-secondary" onclick="WorkbenchImport.createBulkSubtestExperiment()">
            ⚡ One Subtest Per Asset (Bulk Mode B)
          </button>
        </div>
      </div>
    `;
  }

  function getFilteredAssets() {
    return _vaultAssets.filter(asset => {
      if (!matchesSubtab(asset, _subtab)) return false;
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

  function updateBatchBar() {
    const batchBar = document.getElementById('forge-batch-bar');
    if (!batchBar) return;
    const count = _selectedIds.size;
    batchBar.style.display = count > 0 ? 'flex' : 'none';

    const countSpan = document.getElementById('forge-selected-count');
    if (countSpan) {
      countSpan.textContent = `⚡ ${count} Asset${count === 1 ? '' : 's'} Selected`;
    }
  }

  function toggleSelect(id, checked) {
    if (checked) _selectedIds.add(id);
    else _selectedIds.delete(id);

    updateBatchBar();
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

  function extractProjectPromptFields(asset, mode = 'compiled') {
    if (!asset) return { personality: '', scenario: '', initialMessage: '' };

    const raw = asset.raw || asset;

    const parseIfJson = (val) => {
      if (!val) return null;
      if (typeof val === 'object') return val;
      if (typeof val === 'string' && (val.trim().startsWith('{') || val.trim().startsWith('['))) {
        try { return JSON.parse(val); } catch (e) { return null; }
      }
      return null;
    };

    const candidateObjects = [];
    const addCandidate = (obj) => {
      if (!obj) return;
      if (typeof obj === 'string') {
        const parsed = parseIfJson(obj);
        if (parsed && typeof parsed === 'object' && !candidateObjects.includes(parsed)) {
          candidateObjects.push(parsed);
        }
        return;
      }
      if (typeof obj === 'object' && !candidateObjects.includes(obj)) {
        candidateObjects.push(obj);
        if (obj.data) addCandidate(obj.data);
        if (obj.compiledCard) addCandidate(obj.compiledCard);
        if (obj.card) addCandidate(obj.card);
        if (obj.characterCard) addCandidate(obj.characterCard);
        if (obj.character) addCandidate(obj.character);
        if (obj.bot) addCandidate(obj.bot);
      }
    };

    if (mode !== 'reassembled') {
      addCandidate(asset);
      addCandidate(raw);
    }

    const pick = (keys) => {
      for (const cand of candidateObjects) {
        if (!cand || typeof cand !== 'object') continue;
        for (const k of keys) {
          const val = cand[k];
          if (val && typeof val === 'string' && val.trim()) {
            return val.trim();
          }
        }
      }
      return '';
    };

    const personalityKeys = [
      'personality', 'system_prompt', 'systemPrompt', 'char_persona', 'charPersona',
      'personality_prompt', 'prompt', 'description', 'content', 'bio', 'persona', 'details', 'system'
    ];
    const scenarioKeys = [
      'scenario', 'world_scenario', 'worldScenario', 'scenario_prompt', 'scenarioText', 'world'
    ];
    const initialMessageKeys = [
      'initialMessage', 'first_mes', 'firstMessage', 'greeting', 'initial_message', 'initial_msg', 'first_message', 'mes'
    ];

    let personality = mode === 'reassembled' ? '' : pick(personalityKeys);
    let scenario = mode === 'reassembled' ? '' : pick(scenarioKeys);
    let initialMessage = mode === 'reassembled' ? '' : pick(initialMessageKeys);

    // Harvest components array if reassembled OR if compiled fields were empty
    const rawComps = raw.components || raw.vault_components || raw.componentIds || raw.component_ids || raw.cards || asset.components || [];

    if (Array.isArray(rawComps) && rawComps.length > 0 && (mode === 'reassembled' || !personality || !scenario || !initialMessage)) {
      const pParts = [];
      const sParts = [];
      const iParts = [];

      rawComps.forEach(c => {
        let cObj = (typeof c === 'string' ? parseIfJson(c) : c);
        let refId = null;

        if (typeof c === 'string') {
          refId = c;
          cObj = null;
        } else if (cObj && typeof cObj === 'object') {
          if (!cObj.content && !cObj.personality && !cObj.description && !cObj.system_prompt) {
            refId = cObj.id || cObj.componentId || cObj.assetId;
          }
        }

        if (refId) {
          const match = _vaultAssets.find(a => a.id === refId || a.raw?.id === refId || a.id === ('comp_' + refId) || (a.raw?.id && a.raw.id === String(refId).replace(/^comp_/, '')));
          if (match) {
            cObj = match.raw || match;
          }
        }

        if (!cObj || typeof cObj !== 'object') return;

        const cat = (cObj.category || cObj.type || cObj.assetType || '').toLowerCase();
        const pVal = cObj.personality || cObj.content || cObj.description || cObj.system_prompt || cObj.bio || '';
        const sVal = cObj.scenario || cObj.world_scenario || '';
        const iVal = cObj.first_mes || cObj.greeting || cObj.initialMessage || '';

        const isGeneric = (str) => !str || str === 'Compiled Bot Project' || str === 'Compiled AnansiForge Bot Project';

        if (pVal && !isGeneric(pVal) && (cat.includes('character') || cat.includes('personality') || cat.includes('bio') || cat.includes('rule') || !cat)) {
          pParts.push(pVal.trim());
        }
        if (sVal || (pVal && !isGeneric(pVal) && (cat.includes('scenario') || cat.includes('world')))) {
          const sText = (sVal || pVal).trim();
          if (!isGeneric(sText)) sParts.push(sText);
        }
        if (iVal && !isGeneric(iVal)) {
          iParts.push(iVal.trim());
        }
      });

      if ((mode === 'reassembled' || !personality) && pParts.length > 0) personality = pParts.join('\n\n');
      if ((mode === 'reassembled' || !scenario) && sParts.length > 0) scenario = sParts.join('\n\n');
      if ((mode === 'reassembled' || !initialMessage) && iParts.length > 0) initialMessage = iParts.join('\n\n');
    }

    // Fallback: If personality is STILL empty, try asset.description or raw.description (ignoring generic labels)
    if (!personality && (asset.description || raw.description)) {
      const d = (asset.description || raw.description).trim();
      if (d && d !== 'Compiled Bot Project' && d !== 'Compiled AnansiForge Bot Project') {
        personality = d;
      }
    }

    return { personality, scenario, initialMessage };
  }

  async function parseAndStoreForgeBackup(data) {
    const components = data.components || data.vault_components || [];
    const projects = data.projects || [];
    const trackerRecords = data.trackerRecords || [];

    const assetsToSave = [];

    // Parse compiled projects
    projects.forEach(p => {
      const fields = extractProjectPromptFields(p);
      assetsToSave.push({
        id: 'proj_' + (p.id || WorkbenchDB.generateId()),
        assetType: 'project',
        name: p.name || p.title || 'Untitled Project',
        description: p.description || 'Compiled Bot Project',
        universe: p.universe || p.series || '',
        personality: fields.personality,
        scenario: fields.scenario,
        initialMessage: fields.initialMessage,
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
        personality: c.content || c.personality || c.system_prompt || '',
        scenario: c.scenario || c.world_scenario || '',
        initialMessage: c.first_mes || c.initialMessage || c.greeting || '',
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

  // ─── Assembly Workspace (Workflow A) ───────────────────────────────────────

  let _assemblyState = {
    title: 'Custom Vault Experiment',
    description: '',
    personalityItems: [],
    scenarioItems: [],
    initialMessageItems: [],
    effectiveInitialMessageId: 'merged', // 'merged' or asset ID
    previewTab: 'combined', // 'personality' | 'scenario' | 'initialMessage' | 'combined'
  };

  function openAssemblyWorkspace(selectedIds) {
    const ids = selectedIds || Array.from(_selectedIds);
    if (ids.length === 0) {
      showToast('Please select at least one vault asset to assemble.', 'warning');
      return;
    }

    const items = ids.map(id => _vaultAssets.find(a => a.id === id)).filter(Boolean);

    _assemblyState = {
      title: items.length === 1 ? `[Assembly] ${items[0].name}` : `[Assembly] Custom Vault Experiment (${items.length} Assets)`,
      description: `Assembled from ${items.length} Vault components: ${items.map(i => i.name).join(', ')}`,
      personalityItems: [],
      scenarioItems: [],
      initialMessageItems: [],
      effectiveInitialMessageId: 'merged',
      previewTab: 'combined'
    };

    // Auto-map assets to fields based on category/type
    items.forEach(item => {
      const type = (item.assetType || '').toLowerCase();
      if (type === 'scenario') {
        _assemblyState.scenarioItems.push(item);
      } else if (item.initialMessage && !item.personality && !item.scenario) {
        _assemblyState.initialMessageItems.push(item);
      } else {
        _assemblyState.personalityItems.push(item);
      }
    });

    renderAssemblyWorkspaceUI();
    openModal('modal-assembly-workspace');
  }

  function renderAssemblyWorkspaceUI() {
    const container = document.getElementById('assembly-workspace-content');
    if (!container) return;

    const warnings = calculateAssemblyWarnings();

    container.innerHTML = `
      <div class="flex-column gap-md">
        <!-- Metadata Header -->
        <div class="panel" style="padding:12px 16px;">
          <div class="form-group" style="margin-bottom:8px;">
            <label>Experiment Title</label>
            <input type="text" id="assembly-title-input" value="${escapeHtml(_assemblyState.title)}" onchange="WorkbenchImport.updateAssemblyTitle(this.value)">
          </div>
          <div class="form-group" style="margin:0;">
            <label>Description / Assembly Notes</label>
            <input type="text" id="assembly-desc-input" value="${escapeHtml(_assemblyState.description)}" onchange="WorkbenchImport.updateAssemblyDesc(this.value)">
          </div>
        </div>

        <!-- Warning Callouts -->
        ${warnings.length > 0 ? `
          <div class="assembly-warning-box">
            <div class="assembly-warning-title">⚠️ Assembly Warnings & Considerations (${warnings.length})</div>
            <ul style="margin:0; padding-left:18px;">
              ${warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        <!-- 3 Workspace Sections -->
        <div class="flex-column gap-sm">
          <!-- Personality Section -->
          <div class="assembly-section">
            <div class="assembly-section-header">
              <div class="assembly-section-title">🎭 Personality / Character Components (${_assemblyState.personalityItems.length})</div>
            </div>
            ${renderAssemblyItemList(_assemblyState.personalityItems, 'personality')}
          </div>

          <!-- Scenario Section -->
          <div class="assembly-section">
            <div class="assembly-section-header">
              <div class="assembly-section-title">🎬 Scenario & World Components (${_assemblyState.scenarioItems.length})</div>
            </div>
            ${renderAssemblyItemList(_assemblyState.scenarioItems, 'scenario')}
          </div>

          <!-- Initial Message Section -->
          <div class="assembly-section">
            <div class="assembly-section-header">
              <div class="assembly-section-title">💬 Initial Message Components (${_assemblyState.initialMessageItems.length})</div>
            </div>
            ${renderAssemblyItemList(_assemblyState.initialMessageItems, 'initialMessage')}
            
            ${_assemblyState.initialMessageItems.length > 1 ? `
              <div style="margin-top:10px; padding:10px; background:var(--bg-elevated); border-radius:var(--radius-sm);">
                <label style="font-weight:700; font-size:12px; color:var(--text-primary); margin-bottom:6px; display:block;">
                  ⚡ Effective Initial Message Selection (Multiple Candidates Found)
                </label>
                <div class="flex-column gap-xs">
                  <label class="radio-label">
                    <input type="radio" name="init_msg_choice" value="merged" ${_assemblyState.effectiveInitialMessageId === 'merged' ? 'checked' : ''} onchange="WorkbenchImport.setInitialMessageChoice('merged')">
                    <strong>Merge all Initial Messages into one text block</strong>
                  </label>
                  ${_assemblyState.initialMessageItems.map(item => `
                    <label class="radio-label">
                      <input type="radio" name="init_msg_choice" value="${item.id}" ${_assemblyState.effectiveInitialMessageId === item.id ? 'checked' : ''} onchange="WorkbenchImport.setInitialMessageChoice('${item.id}')">
                      Use single candidate: <strong>${escapeHtml(item.name)}</strong>
                    </label>
                  `).join('')}
                </div>
              </div>
            ` : ''}
          </div>
        </div>

        <!-- Live Effective Prompt Preview -->
        <div class="panel" style="padding:14px;">
          <div class="assembly-preview-tabs">
            <button class="assembly-preview-tab ${_assemblyState.previewTab === 'combined' ? 'active' : ''}" onclick="WorkbenchImport.setAssemblyPreviewTab('combined')">⚡ Combined Full Prompt</button>
            <button class="assembly-preview-tab ${_assemblyState.previewTab === 'personality' ? 'active' : ''}" onclick="WorkbenchImport.setAssemblyPreviewTab('personality')">🎭 Personality Preview</button>
            <button class="assembly-preview-tab ${_assemblyState.previewTab === 'scenario' ? 'active' : ''}" onclick="WorkbenchImport.setAssemblyPreviewTab('scenario')">🎬 Scenario Preview</button>
            <button class="assembly-preview-tab ${_assemblyState.previewTab === 'initialMessage' ? 'active' : ''}" onclick="WorkbenchImport.setAssemblyPreviewTab('initialMessage')">💬 Initial Message Preview</button>
          </div>
          <div class="assembly-preview-body">${escapeHtml(getAssemblyPreviewText(_assemblyState.previewTab))}</div>
        </div>
      </div>
    `;
  }

  function renderAssemblyItemList(items, sectionName) {
    if (items.length === 0) {
      return `<div style="font-size:12px; color:var(--text-muted); font-style:italic; padding:6px 0;">No components assigned to ${sectionName}.</div>`;
    }

    return items.map((item, idx) => `
      <div class="assembly-item-card">
        <div class="assembly-drag-handle">⋮⋮</div>
        <div class="assembly-item-info">
          <div class="assembly-item-title">${escapeHtml(item.name)}</div>
          <div class="assembly-item-meta">${item.assetType} ${item.universe ? `• ${escapeHtml(item.universe)}` : ''}</div>
        </div>
        <div class="flex-row align-center gap-xs">
          <button class="btn btn-sm" title="Move Up" ${idx === 0 ? 'disabled' : ''} onclick="WorkbenchImport.moveAssemblyItem('${sectionName}', ${idx}, -1)">▲</button>
          <button class="btn btn-sm" title="Move Down" ${idx === items.length - 1 ? 'disabled' : ''} onclick="WorkbenchImport.moveAssemblyItem('${sectionName}', ${idx}, 1)">▼</button>
          <select class="btn btn-sm" style="padding:2px 6px; font-size:11px;" onchange="WorkbenchImport.reassignAssemblyItem('${sectionName}', ${idx}, this.value)">
            <option value="personality" ${sectionName === 'personality' ? 'selected' : ''}>Move to Personality</option>
            <option value="scenario" ${sectionName === 'scenario' ? 'selected' : ''}>Move to Scenario</option>
            <option value="initialMessage" ${sectionName === 'initialMessage' ? 'selected' : ''}>Move to Initial Message</option>
          </select>
          <button class="btn btn-sm btn-danger" title="Remove" onclick="WorkbenchImport.removeAssemblyItem('${sectionName}', ${idx})">✕</button>
        </div>
      </div>
    `).join('');
  }

  function moveAssemblyItem(sectionName, idx, direction) {
    const list = _assemblyState[`${sectionName}Items`];
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= list.length) return;
    const temp = list[idx];
    list[idx] = list[targetIdx];
    list[targetIdx] = temp;
    renderAssemblyWorkspaceUI();
  }

  function reassignAssemblyItem(fromSection, idx, toSection) {
    if (fromSection === toSection) return;
    const item = _assemblyState[`${fromSection}Items`].splice(idx, 1)[0];
    if (item) {
      _assemblyState[`${toSection}Items`].push(item);
    }
    renderAssemblyWorkspaceUI();
  }

  function removeAssemblyItem(sectionName, idx) {
    _assemblyState[`${sectionName}Items`].splice(idx, 1);
    renderAssemblyWorkspaceUI();
  }

  function setInitialMessageChoice(val) {
    _assemblyState.effectiveInitialMessageId = val;
    renderAssemblyWorkspaceUI();
  }

  function setAssemblyPreviewTab(tab) {
    _assemblyState.previewTab = tab;
    renderAssemblyWorkspaceUI();
  }

  function updateAssemblyTitle(val) { _assemblyState.title = val; }
  function updateAssemblyDesc(val) { _assemblyState.description = val; }

  function calculateAssemblyWarnings() {
    const warnings = [];
    const allItems = [
      ..._assemblyState.personalityItems,
      ..._assemblyState.scenarioItems,
      ..._assemblyState.initialMessageItems
    ];

    if (allItems.length === 0) {
      warnings.push('Workspace is empty. No components are currently selected.');
    }

    if (_assemblyState.initialMessageItems.length > 1 && _assemblyState.effectiveInitialMessageId === 'merged') {
      warnings.push('Multiple Initial Message components are selected. They will be combined into a single opening block.');
    }

    if (_assemblyState.personalityItems.length === 0) {
      warnings.push('No Personality components assigned. (Personality field will be empty).');
    }

    if (_assemblyState.scenarioItems.length === 0) {
      warnings.push('No Scenario components assigned. (Scenario field will be empty).');
    }

    // Check for duplicate asset IDs
    const idCounts = {};
    allItems.forEach(item => { idCounts[item.id] = (idCounts[item.id] || 0) + 1; });
    Object.keys(idCounts).forEach(id => {
      if (idCounts[id] > 1) {
        const dup = allItems.find(i => i.id === id);
        warnings.push(`Component "${dup ? dup.name : id}" is included more than once in this assembly.`);
      }
    });

    return warnings;
  }

  function getItemFieldText(item, fieldName) {
    if (item.assetType === 'project') {
      const f = extractProjectPromptFields(item);
      return f[fieldName] || '';
    }
    if (fieldName === 'personality') return (item.personality || item.description || '').trim();
    if (fieldName === 'scenario') return (item.scenario || item.description || '').trim();
    if (fieldName === 'initialMessage') return (item.initialMessage || item.description || '').trim();
    return '';
  }

  function getAssemblyPreviewText(type) {
    const pText = _assemblyState.personalityItems.map(i => getItemFieldText(i, 'personality')).filter(Boolean).join('\n\n');
    const sText = _assemblyState.scenarioItems.map(i => getItemFieldText(i, 'scenario')).filter(Boolean).join('\n\n');

    let iText = '';
    if (_assemblyState.effectiveInitialMessageId === 'merged') {
      iText = _assemblyState.initialMessageItems.map(i => getItemFieldText(i, 'initialMessage')).filter(Boolean).join('\n\n');
    } else {
      const chosen = _assemblyState.initialMessageItems.find(i => i.id === _assemblyState.effectiveInitialMessageId);
      if (chosen) iText = getItemFieldText(chosen, 'initialMessage');
    }

    if (type === 'personality') return pText || '[ No Personality content ]';
    if (type === 'scenario') return sText || '[ No Scenario content ]';
    if (type === 'initialMessage') return iText || '[ No Initial Message content ]';

    // Combined
    return `=== PERSONALITY ===\n${pText || '(None)'}\n\n=== SCENARIO ===\n${sText || '(None)'}\n\n=== INITIAL MESSAGE ===\n${iText || '(None)'}`;
  }

  async function getDefaultModelIds() {
    try {
      const all = await WorkbenchDB.getAllModels();
      const enabled = all.filter(m => m.enabled !== false);
      const real = enabled.filter(m => m.provider !== 'mock');
      return (real.length > 0 ? real : enabled).map(m => m.id);
    } catch (e) {
      return [];
    }
  }

  async function confirmAssemblyWorkspace() {
    const pText = _assemblyState.personalityItems.map(i => getItemFieldText(i, 'personality')).filter(Boolean).join('\n\n');
    const sText = _assemblyState.scenarioItems.map(i => getItemFieldText(i, 'scenario')).filter(Boolean).join('\n\n');

    let iText = '';
    if (_assemblyState.effectiveInitialMessageId === 'merged') {
      iText = _assemblyState.initialMessageItems.map(i => getItemFieldText(i, 'initialMessage')).filter(Boolean).join('\n\n');
    } else {
      const chosen = _assemblyState.initialMessageItems.find(i => i.id === _assemblyState.effectiveInitialMessageId);
      if (chosen) iText = getItemFieldText(chosen, 'initialMessage');
    }

    const allItems = [
      ..._assemblyState.personalityItems,
      ..._assemblyState.scenarioItems,
      ..._assemblyState.initialMessageItems
    ];

    const provenance = allItems.map((item, idx) => ({
      sourceApp: 'AnansiForge',
      originalId: item.id,
      originalName: item.name,
      category: item.assetType,
      universe: item.universe || '',
      contentHash: WorkbenchUtils.computeContentHash(item.personality || item.scenario || item.initialMessage || ''),
      importDate: new Date().toISOString(),
      assemblyOrder: idx + 1
    }));

    const defaultModels = await getDefaultModelIds();

    const exp = {
      title: _assemblyState.title || 'Assembled Vault Experiment',
      description: _assemblyState.description || 'Custom assembly from AnansiForge Vault components',
      category: 'AnansiForge Assembly',
      tags: ['anansi-forge', 'assembled'],
      status: 'Draft',
      personality: pText,
      scenario: sText,
      initialMessage: iText,
      defaultModels,
      defaultRepetitions: 3,
      provenance,
      subtests: [
        {
          id: WorkbenchDB.generateId(),
          title: 'Assembled Baseline Subtest',
          description: 'Default test case for assembled prompt configuration',
          testCases: ['Hello! Introduce yourself.'],
          overrides: {},
          disabled: false
        }
      ]
    };

    const saved = await WorkbenchDB.saveExperiment(exp);
    closeModal('modal-assembly-workspace');
    showToast(`Assembled Experiment "${saved.title}" created! Opening builder...`, 'success');
    WorkbenchExperiments.openBuilder(saved.id);
    WorkbenchApp.activateTab('experiments');
  }

  // ─── Project Converter (Workflow B) ─────────────────────────────────────────

  let _projectConvState = {
    projectAsset: null,
    sourceMode: 'compiled', // 'compiled' | 'reassembled'
  };

  function openProjectConversion(projectId) {
    const item = _vaultAssets.find(a => a.id === projectId);
    if (!item) return;

    _projectConvState = {
      projectAsset: item,
      sourceMode: 'compiled'
    };

    renderProjectConversionUI();
    openModal('modal-project-conversion');
  }

  function renderProjectConversionUI() {
    const container = document.getElementById('project-conversion-content');
    if (!container) return;

    const item = _projectConvState.projectAsset;
    const mode = _projectConvState.sourceMode || 'compiled';
    const fields = extractProjectPromptFields(item, mode);

    container.innerHTML = `
      <div class="flex-column gap-md">
        <div class="panel" style="padding:12px 16px;">
          <h3 style="font-size:16px; font-weight:700; margin-bottom:4px;">📦 ${escapeHtml(item.name)}</h3>
          <div style="font-size:12px; color:var(--text-secondary);">${escapeHtml(item.description || 'Compiled AnansiForge Bot Project')}</div>
        </div>

        <div class="form-group">
          <label style="font-weight:700; font-size:12px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px; display:block;">
            Choose Conversion Source Strategy
          </label>
          <div class="flex-column gap-sm">
            <label class="radio-label panel" style="padding:12px 14px; cursor:pointer; display:flex; flex-direction:row; align-items:flex-start; gap:12px; text-transform:none; letter-spacing:normal;">
              <input type="radio" name="proj_conv_mode" value="compiled" ${_projectConvState.sourceMode === 'compiled' ? 'checked' : ''} onchange="WorkbenchImport.setProjectConvMode('compiled')" style="margin-top:2px; flex-shrink:0;">
              <div style="flex:1;">
                <strong style="font-size:13px; font-weight:700; color:var(--text-primary); display:block; text-transform:none; letter-spacing:normal;">Import Compiled Project (Recommended)</strong>
                <div style="font-size:11px; color:var(--text-muted); margin-top:2px; text-transform:none; letter-spacing:normal; line-height:1.4;">
                  Imports the effective prompt content directly without duplicating source definitions.
                </div>
              </div>
            </label>

            <label class="radio-label panel" style="padding:12px 14px; cursor:pointer; display:flex; flex-direction:row; align-items:flex-start; gap:12px; text-transform:none; letter-spacing:normal;">
              <input type="radio" name="proj_conv_mode" value="reassembled" ${_projectConvState.sourceMode === 'reassembled' ? 'checked' : ''} onchange="WorkbenchImport.setProjectConvMode('reassembled')" style="margin-top:2px; flex-shrink:0;">
              <div style="flex:1;">
                <strong style="font-size:13px; font-weight:700; color:var(--text-primary); display:block; text-transform:none; letter-spacing:normal;">Reassemble from Source Components</strong>
                <div style="font-size:11px; color:var(--text-muted); margin-top:2px; text-transform:none; letter-spacing:normal; line-height:1.4;">
                  Reconstructs prompt by concatenating underlying vault components and project overrides.
                </div>
              </div>
            </label>
          </div>
        </div>

        <div class="panel" style="padding:12px 14px;">
          <label style="font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase;">Effective Prompt Preview</label>
          <div style="font-family:var(--font-mono); font-size:12px; color:var(--text-secondary); max-height:160px; overflow-y:auto; margin-top:6px; white-space:pre-wrap;">
=== PERSONALITY ===
${escapeHtml(fields.personality || '(None)')}

=== SCENARIO ===
${escapeHtml(fields.scenario || '(None)')}

=== INITIAL MESSAGE ===
${escapeHtml(fields.initialMessage || '(None)')}
          </div>
        </div>
      </div>
    `;
  }

  function setProjectConvMode(mode) {
    _projectConvState.sourceMode = mode;
    renderProjectConversionUI();
  }

  async function confirmProjectConversion() {
    const item = _projectConvState.projectAsset;
    if (!item) return;

    const mode = _projectConvState.sourceMode || 'compiled';
    const fields = extractProjectPromptFields(item, mode);

    const defaultModels = await getDefaultModelIds();

    const exp = {
      title: `[Forge Project] ${item.name}`,
      description: item.description || `Converted project (${_projectConvState.sourceMode}) from AnansiForge`,
      category: 'AnansiForge Project',
      tags: ['anansi-forge', 'project', _projectConvState.sourceMode],
      status: 'Draft',
      personality: fields.personality,
      scenario: fields.scenario,
      initialMessage: fields.initialMessage,
      defaultModels,
      defaultRepetitions: 3,
      provenance: [{
        sourceApp: 'AnansiForge',
        originalId: item.id,
        originalName: item.name,
        category: 'project',
        projectId: item.id,
        contentHash: WorkbenchUtils.computeContentHash(fields.personality || ''),
        importDate: new Date().toISOString()
      }],
      subtests: [
        {
          id: WorkbenchDB.generateId(),
          title: 'Project Baseline Subtest',
          description: 'Default test case for converted project prompt',
          testCases: ['Hello! Introduce yourself.'],
          overrides: {},
          disabled: false
        }
      ]
    };

    const saved = await WorkbenchDB.saveExperiment(exp);
    closeModal('modal-project-conversion');
    showToast(`Converted Project "${saved.title}" created! Opening builder...`, 'success');
    WorkbenchExperiments.openBuilder(saved.id);
    WorkbenchApp.activateTab('experiments');
  }

  // ─── Bulk Subtest Creation (Bulk Mode B) ──────────────────────────────────

  async function createBulkSubtestExperiment() {
    if (_selectedIds.size === 0) return;

    const items = Array.from(_selectedIds).map(id => _vaultAssets.find(a => a.id === id)).filter(Boolean);
    if (items.length === 0) return;

    const title = prompt(`Enter Experiment Title for Bulk Subtest suite (${items.length} assets):`, `[Forge Bulk] ${items.length} Character Voicing Suite`);
    if (!title) return;

    const defaultModels = await getDefaultModelIds();

    const parentExp = {
      title,
      description: `Bulk subtest suite containing ${items.length} individual vault asset subtests.`,
      category: 'AnansiForge Bulk Suite',
      tags: ['anansi-forge', 'bulk-subtests'],
      status: 'Draft',
      personality: '',
      scenario: 'Shared world setting / scenario context for all subtests.',
      initialMessage: '',
      defaultModels,
      defaultRepetitions: 3,
      subtests: items.map(item => ({
        id: WorkbenchDB.generateId(),
        title: item.name,
        description: `Character subtest for ${item.name}`,
        personality: item.personality || item.description || '',
        scenario: item.scenario || '',
        initialMessage: item.initialMessage || '',
        inheritanceMode: {
          personality: 'replace',
          scenario: 'inherit',
          initialMessage: 'inherit'
        },
        testCases: ['Tell me about yourself and your background.'],
        overrides: {},
        disabled: false,
        provenance: {
          originalId: item.id,
          name: item.name,
          category: item.assetType
        }
      }))
    };

    const saved = await WorkbenchDB.saveExperiment(parentExp);
    _selectedIds.clear();
    showToast(`Bulk Subtest Experiment "${saved.title}" (${items.length} subtests) created! Opening builder...`, 'success');
    WorkbenchExperiments.openBuilder(saved.id);
    WorkbenchApp.activateTab('experiments');
  }

  async function createExperimentForAsset(id) {
    const item = _vaultAssets.find(a => a.id === id);
    if (!item) return;

    if (item.assetType === 'project') {
      openProjectConversion(id);
      return;
    }

    openAssemblyWorkspace([id]);
  }

  async function batchCreateExperiments() {
    if (_selectedIds.size === 0) return;
    openAssemblyWorkspace(Array.from(_selectedIds));
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
    // Workflows A & B
    openAssemblyWorkspace,
    renderAssemblyWorkspaceUI,
    moveAssemblyItem,
    reassignAssemblyItem,
    removeAssemblyItem,
    setInitialMessageChoice,
    setAssemblyPreviewTab,
    updateAssemblyTitle,
    updateAssemblyDesc,
    confirmAssemblyWorkspace,
    openProjectConversion,
    setProjectConvMode,
    confirmProjectConversion,
    createBulkSubtestExperiment,
    extractProjectPromptFields,
  };
  window.WorkbenchImportForge = window.WorkbenchImport;
})();
