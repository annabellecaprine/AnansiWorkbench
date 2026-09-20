/**
 * import.js — AnansiForge Vault Import Adapter for AnansiWorkbench.
 * Converts AnansiForge JSON backup exports into Workbench Experiments & Subtests.
 */

(() => {
  'use strict';

  const { escapeHtml } = WorkbenchUtils;

  let _importedData = null;

  async function load() {
    renderUI();
  }

  function renderUI() {
    const container = document.getElementById('tab-import');
    if (!container) return;

    container.innerHTML = `
      <div class="section-header">
        <h1 class="section-title">AnansiForge Vault Import</h1>
      </div>

      <div class="panel" style="max-width:800px;">
        <div class="panel-header">
          <span class="panel-title">📥 Import AnansiForge JSON Backup</span>
        </div>
        <div class="panel-body flex-column gap-md">
          <p style="color:var(--text-secondary); font-size:14px; line-height:1.5;">
            Import character cards, scenarios, and compiled bot projects directly from an <strong>AnansiForge</strong> backup file.
            The workbench will automatically map components into reusable <strong>Experiment definitions</strong> and <strong>Subtests</strong>.
          </p>

          <div style="background:var(--bg-card); border:2px dashed var(--border-color); border-radius:8px; padding:32px; text-align:center; cursor:pointer;" 
               onclick="WorkbenchImportForge.triggerFilePicker()">
            <div style="font-size:36px; margin-bottom:8px;">📁</div>
            <div style="font-weight:600; font-size:15px; color:var(--text-primary);">Click to select an AnansiForge .json file</div>
            <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">Supports AnansiForge backup schemas (components, projects, trackerRecords)</div>
          </div>

          <div id="forge-preview-area" style="margin-top:16px;"></div>
        </div>
      </div>
    `;
  }

  function triggerFilePicker() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = JSON.parse(evt.target.result);
          parseForgeBackup(data);
        } catch (err) {
          console.error('Forge import parse error:', err);
          showToast('Failed to parse AnansiForge JSON: ' + err.message, 'error');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function parseForgeBackup(data) {
    // AnansiForge JSON structure has: components, projects, trackerRecords
    const components = data.components || data.vault_components || [];
    const projects = data.projects || [];

    if (components.length === 0 && projects.length === 0) {
      showToast('No AnansiForge components or projects found in JSON file.', 'warning');
      return;
    }

    _importedData = { components, projects };
    renderPreviewArea();
  }

  function renderPreviewArea() {
    const area = document.getElementById('forge-preview-area');
    if (!area || !_importedData) return;

    const { components, projects } = _importedData;

    // Extract characters and scenarios from components
    const characters = components.filter(c => c.category === 'character' || c.type === 'character' || c.name);
    const scenarios = components.filter(c => c.category === 'scenario' || c.type === 'scenario');

    area.innerHTML = `
      <div style="border-top:1px solid var(--border-color); padding-top:16px;">
        <h3 style="font-size:14px; font-weight:700; color:var(--text-primary); margin-bottom:12px;">Import Preview</h3>
        <div class="flex-row gap-lg" style="margin-bottom:16px; font-size:13px; color:var(--text-secondary);">
          <span>🎭 <strong>${characters.length}</strong> Character Components</span>
          <span>🎬 <strong>${scenarios.length}</strong> Scenario Components</span>
          <span>📦 <strong>${projects.length}</strong> Projects / Compiled Bots</span>
        </div>

        <div style="font-size:13px; font-weight:600; color:var(--text-primary); margin-bottom:8px;">Select Project or Character to Convert to Experiment:</div>
        
        <div class="flex-column gap-sm" style="max-height:240px; overflow-y:auto;">
          ${projects.map((proj, idx) => `
            <div class="flex-row align-center justify-between" style="background:var(--bg-card); padding:10px 14px; border-radius:6px; border:1px solid var(--border-subtle);">
              <div>
                <strong>${escapeHtml(proj.name || proj.title || 'Untitled Project')}</strong>
                <div style="font-size:11px; color:var(--text-muted);">${escapeHtml(proj.description || 'Compiled Bot Project')}</div>
              </div>
              <button class="btn btn-sm btn-primary" onclick="WorkbenchImportForge.importProject(${idx})">⚡ Create Experiment</button>
            </div>
          `).join('')}

          ${characters.map((c, idx) => `
            <div class="flex-row align-center justify-between" style="background:var(--bg-card); padding:10px 14px; border-radius:6px; border:1px solid var(--border-subtle);">
              <div>
                <strong>${escapeHtml(c.name || 'Untitled Character')}</strong>
                <div style="font-size:11px; color:var(--text-muted);">Character Component</div>
              </div>
              <button class="btn btn-sm" onclick="WorkbenchImportForge.importComponent(${idx})">⚡ Create Experiment</button>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  async function importProject(index) {
    if (!_importedData || !_importedData.projects[index]) return;
    const proj = _importedData.projects[index];
    const card = proj.compiledCard || proj;

    const personality = card.personality || card.description || card.system_prompt || '';
    const scenario = card.scenario || card.world_scenario || '';
    const initialMessage = card.first_mes || card.initial_message || card.greeting || '';

    const exp = {
      title: `[Forge Import] ${proj.name || 'Imported Bot'}`,
      description: `Imported from AnansiForge project: ${proj.name || ''}`,
      category: 'AnansiForge Import',
      tags: ['anansi-forge', 'imported'],
      status: 'Draft',
      personality,
      scenario,
      initialMessage,
      defaultRepetitions: 3,
      defaultParams: { temperature: 0.9, max_tokens: 500 },
      subtests: [
        {
          id: WorkbenchDB.generateId(),
          title: 'Standard Greeting & Voicing Test',
          description: 'Imported initial test case',
          testCases: ['Hello! Tell me about yourself and your role.'],
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

  async function importComponent(index) {
    if (!_importedData || !_importedData.components[index]) return;
    const c = _importedData.components[index];

    const exp = {
      title: `[Forge Import] ${c.name || 'Character'}`,
      description: c.description || 'Imported from AnansiForge character component',
      category: 'AnansiForge Import',
      tags: ['anansi-forge', 'character'],
      status: 'Draft',
      personality: c.content || c.personality || c.description || '',
      scenario: '',
      initialMessage: c.first_mes || c.initialMessage || '',
      defaultRepetitions: 3,
      subtests: [
        {
          id: WorkbenchDB.generateId(),
          title: 'Voicing Subtest',
          description: 'Basic introduction test',
          testCases: ['Who are you?'],
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

  async function init() {
    WorkbenchApp.registerTab('import', load);
  }

  window.WorkbenchImport = {
    init, load, triggerFilePicker, importProject, importComponent
  };
  window.WorkbenchImportForge = window.WorkbenchImport;
})();
