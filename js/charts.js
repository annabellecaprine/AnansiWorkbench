/**
 * charts.js — Automatic Visualization & Charts Module for AnansiWorkbench.
 * Local HTML5 Canvas renderer for offline usage without external CDN dependencies.
 * Bars are clickable: clicking a bar drills down to the Review tab filtered to that model/category.
 */

(() => {
  'use strict';

  const { escapeHtml } = WorkbenchUtils;

  let _experiments = [];
  let _selectedExpId = null;
  let _runs = [];

  async function load() {
    _experiments = await WorkbenchDB.getAllExperiments();
    if (!_selectedExpId && _experiments.length > 0) {
      _selectedExpId = _experiments[0].id;
    }
    renderUI();
  }

  async function renderUI() {
    const container = document.getElementById('tab-charts');
    if (!container) return;

    if (_experiments.length === 0) {
      container.innerHTML = `
        <div class="section-header">
          <h1 class="section-title">Charts &amp; Analysis</h1>
        </div>
        <div class="empty-state">
          <div class="empty-icon">📊</div>
          <p>No experiments available. Create and run an experiment to see visual analysis.</p>
        </div>
      `;
      return;
    }

    const exp = _experiments.find(e => e.id === _selectedExpId) || _experiments[0];
    _selectedExpId = exp.id;

    _runs = await WorkbenchDB.getAllRuns(exp.id);
    const sortedRuns = [..._runs].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const mostRecentRun = sortedRuns[0];
    const runIds = new Set(_runs.map(r => r.id));
    const responses = (await WorkbenchDB.getAll('responses')).filter(r => runIds.has(r.runId));
    const records = (await WorkbenchDB.getAll('records')).filter(r => runIds.has(r.runId));
    const fieldSchemas = await WorkbenchDB.getFieldSchemas(exp.id);
    const models = await WorkbenchDB.getAllModels();
    const modelMap = new Map(models.map(m => [m.id, m.name]));

    container.innerHTML = `
      <div class="section-header">
        <h1 class="section-title">Charts &amp; Analysis</h1>
        <div class="section-actions">
          <select id="charts-exp-select" onchange="WorkbenchCharts.selectExperiment(this.value)">
            ${_experiments.map(e => `<option value="${e.id}" ${e.id === exp.id ? 'selected' : ''}>${escapeHtml(e.title)}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="exec-stats-grid" style="margin-bottom:20px;">
        <div class="stat-card">
          <div class="stat-value">${_runs.length}</div>
          <div class="stat-label">Runs Executed</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${responses.length}</div>
          <div class="stat-label">Responses Analyzed</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${records.length}</div>
          <div class="stat-label">Records Reviewed</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${fieldSchemas.length}</div>
          <div class="stat-label">Custom Metrics</div>
        </div>
      </div>

      <div style="font-size:11px; color:var(--text-muted); margin-bottom:12px; padding:6px 10px; background:rgba(99,102,241,0.07); border-radius:6px; border:1px solid rgba(99,102,241,0.15);">
        💡 <strong>Click any bar</strong> to open the corresponding responses in the Review tab.
      </div>

      <div class="charts-grid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap:20px;">

        <!-- Chart 1: Latency by Model -->
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">⏱ Avg Latency by Model (Seconds)</span>
          </div>
          <div class="panel-body" style="position:relative;">
            <canvas id="chart-canvas-latency" width="400" height="220" style="cursor:pointer;"></canvas>
          </div>
        </div>

        <!-- Chart 2: Token Output by Model -->
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">↓ Avg Tokens Generated per Response</span>
          </div>
          <div class="panel-body" style="position:relative;">
            <canvas id="chart-canvas-tokens" width="400" height="220" style="cursor:pointer;"></canvas>
          </div>
        </div>

        ${fieldSchemas.map(s => `
          <div class="panel">
            <div class="panel-header">
              <span class="panel-title">📊 ${escapeHtml(s.name)} (${s.type})</span>
            </div>
            <div class="panel-body" style="position:relative;">
              <canvas id="chart-canvas-field-${s.id}" width="400" height="220" style="cursor:pointer;"></canvas>
            </div>
          </div>
        `).join('')}

      </div>
    `;

    setTimeout(() => {
      renderLatencyChart(responses, modelMap, mostRecentRun);
      renderTokensChart(responses, modelMap, mostRecentRun);
      fieldSchemas.forEach(s => renderCustomFieldChart(s, records, mostRecentRun));
    }, 50);
  }

  // ─── Click Drilldown ─────────────────────────────────────────────────────────

  /**
   * Map<canvasId, Array<{x, y, w, h, modelId, label}>>
   */
  const _hitRegions = new Map();

  function attachClickHandler(canvas, canvasId, mostRecentRun) {
    canvas._hudClick = null;
    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const my = (e.clientY - rect.top) * (canvas.height / rect.height);
      const regions = _hitRegions.get(canvasId) || [];
      for (const region of regions) {
        if (mx >= region.x && mx <= region.x + region.w &&
          my >= region.y && my <= region.y + region.h) {
          drilldownToReview(mostRecentRun?.id, region.modelId, region.label);
          return;
        }
      }
    });
  }

  function drilldownToReview(runId, modelId, label) {
    if (!runId) {
      showToast('No runs available for this experiment yet.', 'warning');
      return;
    }
    WorkbenchState.selectedRunId = runId;
    WorkbenchApp.activateTab('review');
    // Give the review tab time to load, then apply the drilldown filter
    setTimeout(() => {
      if (typeof WorkbenchReview?.drilldown === 'function') {
        WorkbenchReview.drilldown(runId, modelId, label);
      }
    }, 150);
  }

  // ─── Chart Renderers ─────────────────────────────────────────────────────────

  function renderLatencyChart(responses, modelMap, mostRecentRun) {
    const canvas = document.getElementById('chart-canvas-latency');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const modelStats = {};
    responses.forEach(r => {
      const mName = modelMap.get(r.modelId) || r.modelId?.slice(0, 8) || 'Unknown';
      if (!modelStats[mName]) modelStats[mName] = { sum: 0, count: 0, modelId: r.modelId };
      if (r.latencyMs) {
        modelStats[mName].sum += r.latencyMs / 1000;
        modelStats[mName].count++;
      }
    });

    const labels = Object.keys(modelStats);
    const data = labels.map(l => modelStats[l].count ? (modelStats[l].sum / modelStats[l].count) : 0);
    const modelIds = labels.map(l => modelStats[l].modelId);

    const regions = drawBarChart(ctx, canvas.width, canvas.height, labels, data, '#6366f1', 's');
    _hitRegions.set('chart-canvas-latency', regions.map((r, i) => ({ ...r, modelId: modelIds[i], label: labels[i] })));
    attachClickHandler(canvas, 'chart-canvas-latency', mostRecentRun);
  }

  function renderTokensChart(responses, modelMap, mostRecentRun) {
    const canvas = document.getElementById('chart-canvas-tokens');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const modelStats = {};
    responses.forEach(r => {
      const mName = modelMap.get(r.modelId) || r.modelId?.slice(0, 8) || 'Unknown';
      if (!modelStats[mName]) modelStats[mName] = { sum: 0, count: 0, modelId: r.modelId };
      if (r.tokensOut !== null && r.tokensOut !== undefined) {
        modelStats[mName].sum += r.tokensOut;
        modelStats[mName].count++;
      }
    });

    const labels = Object.keys(modelStats);
    const data = labels.map(l => modelStats[l].count ? Math.round(modelStats[l].sum / modelStats[l].count) : 0);
    const modelIds = labels.map(l => modelStats[l].modelId);

    const regions = drawBarChart(ctx, canvas.width, canvas.height, labels, data, '#10b981', 'tok');
    _hitRegions.set('chart-canvas-tokens', regions.map((r, i) => ({ ...r, modelId: modelIds[i], label: labels[i] })));
    attachClickHandler(canvas, 'chart-canvas-tokens', mostRecentRun);
  }

  function renderCustomFieldChart(fieldSchema, records, mostRecentRun) {
    const canvasId = `chart-canvas-field-${fieldSchema.id}`;
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const dist = {};
    records.forEach(r => {
      const val = r.fieldValues ? r.fieldValues[fieldSchema.id] : null;
      if (val !== null && val !== undefined && val !== '') {
        const key = Array.isArray(val) ? val.join(', ') : String(val);
        dist[key] = (dist[key] || 0) + 1;
      }
    });

    const labels = Object.keys(dist);
    const data = labels.map(l => dist[l]);

    if (labels.length === 0) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#6b7280';
      ctx.font = '13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No review data recorded for this field yet.', canvas.width / 2, canvas.height / 2);
      return;
    }

    const regions = drawBarChart(ctx, canvas.width, canvas.height, labels, data, '#ec4899', '');
    // Field charts navigate to review without a model filter
    _hitRegions.set(canvasId, regions.map((r, i) => ({ ...r, modelId: null, label: labels[i] })));
    attachClickHandler(canvas, canvasId, mostRecentRun);
  }

  // ─── Canvas Bar Chart Painter ────────────────────────────────────────────────

  /**
   * Draws a bar chart on ctx and returns array of hit regions [{x, y, w, h}]
   */
  function drawBarChart(ctx, width, height, labels, data, color, unit) {
    ctx.clearRect(0, 0, width, height);
    const regions = [];

    if (data.length === 0) {
      ctx.fillStyle = '#6b7280';
      ctx.font = '13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No data available', width / 2, height / 2);
      return regions;
    }

    const padding = 40;
    const chartW = width - padding * 2;
    const chartH = height - padding * 2;
    const maxVal = Math.max(...data, 1);
    const barWidth = Math.min(40, chartW / data.length - 12);

    // Horizontal grid lines
    ctx.strokeStyle = '#27272a';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding + chartH - (chartH * (i / 4));
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();

      ctx.fillStyle = '#71717a';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'right';
      const valText = (maxVal * (i / 4)).toFixed(maxVal > 10 ? 0 : 1);
      ctx.fillText(valText, padding - 6, y + 3);
    }

    // Draw bars
    data.forEach((val, idx) => {
      const barH = (val / maxVal) * chartH;
      const x = padding + (idx * (chartW / data.length)) + (chartW / data.length - barWidth) / 2;
      const y = padding + chartH - barH;

      // Store hit region (extend slightly above bar for value label click)
      regions.push({ x, y: y - 20, w: barWidth, h: barH + 20 });

      ctx.fillStyle = color;
      ctx.globalAlpha = 0.88;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, barWidth, barH, [4, 4, 0, 0]);
      else ctx.rect(x, y, barWidth, barH);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Value label on top of bar
      ctx.fillStyle = '#f4f4f5';
      ctx.font = '11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${val}${unit}`, x + barWidth / 2, y - 6);

      // Label on bottom
      ctx.fillStyle = '#a1a1aa';
      ctx.font = '11px Inter, sans-serif';
      const labelText = labels[idx].length > 10 ? labels[idx].slice(0, 9) + '…' : labels[idx];
      ctx.fillText(labelText, x + barWidth / 2, height - padding + 16);
    });

    return regions;
  }

  function selectExperiment(id) {
    _selectedExpId = id;
    renderUI();
  }

  async function init() {
    WorkbenchApp.registerTab('charts', load);
  }

  window.WorkbenchCharts = {
    init, load, selectExperiment
  };
})();
