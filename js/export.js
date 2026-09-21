/**
 * export.js — JSON Backup & CSV Export Module for AnansiWorkbench.
 */

(() => {
    'use strict';

    /**
     * Download text/blob as a file
     */
    function downloadFile(content, fileName, contentType) {
        const a = document.createElement('a');
        const file = new Blob([content], { type: contentType });
        a.href = URL.createObjectURL(file);
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    /**
     * Export complete IndexedDB database to JSON (API credentials isolated)
     */
    async function exportJSON() {
        try {
            const data = await WorkbenchDB.exportBackup();
            const dateStr = new Date().toISOString().split('T')[0];
            const fileName = `anansi-workbench-backup-${dateStr}.json`;
            const jsonStr = JSON.stringify(data, null, 2);
            downloadFile(jsonStr, fileName, 'application/json');
            showToast('Backup exported successfully.', 'success');
        } catch (err) {
            console.error('Export error:', err);
            showToast('Failed to export backup: ' + err.message, 'error');
        }
    }

    /**
     * Export Responses & Test Record Sheet data as CSV for spreadsheets/R/Python
     */
    async function exportCSV() {
        try {
            const [responses, records, models, exps] = await Promise.all([
                WorkbenchDB.getAll('responses'),
                WorkbenchDB.getAll('records'),
                WorkbenchDB.getAllModels(),
                WorkbenchDB.getAllExperiments(),
            ]);

            if (responses.length === 0) {
                showToast('No responses available to export.', 'warning');
                return;
            }

            const modelMap = new Map(models.map(m => [m.id, m.name]));
            const expMap = new Map(exps.map(e => [e.id, e.title]));
            const recordMap = new Map(records.map(r => [r.responseId, r]));

            // Gather all custom field keys across records
            const customKeys = new Set();
            records.forEach(r => {
                if (r.fieldValues) {
                    Object.keys(r.fieldValues).forEach(k => customKeys.add(k));
                }
            });
            const customKeysArr = Array.from(customKeys);

            // CSV Header
            const headers = [
                'ResponseID',
                'RunID',
                'SubtestID',
                'ModelName',
                'Iteration',
                'LatencyMs',
                'TokensIn',
                'TokensOut',
                'ReviewFlag',
                'ReviewStatus',
                'Notes',
                'CreatedAt',
                ...customKeysArr.map(k => `Field_${k}`),
                'ResponseText'
            ];

            const rows = [headers.join(',')];

            responses.forEach(resp => {
                const rec = recordMap.get(resp.id) || {};
                const modelName = modelMap.get(resp.modelId) || resp.modelId;
                const fieldValues = rec.fieldValues || {};

                const row = [
                    escapeCsv(resp.id),
                    escapeCsv(resp.runId),
                    escapeCsv(resp.subtestId),
                    escapeCsv(modelName),
                    resp.iteration,
                    resp.latencyMs ?? '',
                    resp.tokensIn ?? '',
                    resp.tokensOut ?? '',
                    resp.reviewFlag ? 'TRUE' : 'FALSE',
                    escapeCsv(rec.reviewStatus || 'unreviewed'),
                    escapeCsv(rec.notes || ''),
                    escapeCsv(resp.createdAt),
                    ...customKeysArr.map(k => escapeCsv(fieldValues[k] !== undefined ? fieldValues[k] : '')),
                    escapeCsv(resp.text || '')
                ];
                rows.push(row.join(','));
            });

            const csvContent = rows.join('\n');
            const dateStr = new Date().toISOString().split('T')[0];
            downloadFile(csvContent, `anansi-workbench-results-${dateStr}.csv`, 'text/csv');
            showToast('CSV export complete.', 'success');
        } catch (err) {
            console.error('CSV Export error:', err);
            showToast('Failed to export CSV: ' + err.message, 'error');
        }
    }

    function escapeCsv(val) {
        if (val === null || val === undefined) return '""';
        let str = typeof val === 'object' ? JSON.stringify(val) : String(val);
        str = str.replace(/"/g, '""');
        return `"${str}"`;
    }

    /**
     * File input trigger to restore IndexedDB backup
     */
    function openBackupRestore() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (evt) => {
                try {
                    let jsonStr = evt.target.result;
                    let data = JSON.parse(jsonStr);
                    if (data._app !== 'anansi-workbench') {
                        showToast('Invalid backup file. App signature does not match.', 'error');
                        return;
                    }

                    // Check for conflicts
                    const conflicts = [];
                    for (const exp of (data.experiments || [])) {
                        if (await WorkbenchDB.getOne('experiments', exp.id)) conflicts.push({ type: 'Experiment', id: exp.id, title: exp.title || exp.name });
                    }
                    for (const mod of (data.models || [])) {
                        if (await WorkbenchDB.getOne('models', mod.id)) conflicts.push({ type: 'Model', id: mod.id, title: mod.name || mod.modelIdentifier });
                    }

                    let resolution = 'overwrite';

                    if (conflicts.length > 0) {
                        resolution = await new Promise(resolve => {
                            const list = document.getElementById('conflict-list');
                            if (list) list.innerHTML = conflicts.map(c => `<div><strong style="color:var(--text-primary)">${c.type}:</strong> ${escapeHtml(c.title)} <span style="color:var(--text-muted);font-size:10px;">(${c.id})</span></div>`).join('');

                            openModal('modal-import-conflict');

                            const cleanup = () => {
                                document.getElementById('btn-conflict-skip').onclick = null;
                                document.getElementById('btn-conflict-overwrite').onclick = null;
                                document.getElementById('btn-conflict-duplicate').onclick = null;
                                closeModal('modal-import-conflict');
                            };

                            document.getElementById('btn-conflict-skip').onclick = () => { cleanup(); resolve('skip'); };
                            document.getElementById('btn-conflict-overwrite').onclick = () => { cleanup(); resolve('overwrite'); };
                            document.getElementById('btn-conflict-duplicate').onclick = () => { cleanup(); resolve('duplicate'); };
                        });
                    } else {
                        const ok = await showConfirm(`Restore backup from ${WorkbenchUtils.formatDate(data._exportedAt)}?`, 'Restore Backup');
                        if (!ok) return;
                    }

                    if (resolution === 'skip') {
                        // Remove conflicts from import package completely
                        const conflictIds = new Set(conflicts.map(c => c.id));
                        data.experiments = (data.experiments || []).filter(e => !conflictIds.has(e.id));
                        data.models = (data.models || []).filter(m => !conflictIds.has(m.id));

                        // Cascade filter for dependent runs (which trickles down to jobs/responses based on the same assumption that runs drive jobs)
                        data.runs = (data.runs || []).filter(r => !conflictIds.has(r.experimentId));
                        const validRunIds = new Set((data.runs || []).map(r => r.id));
                        data.jobs = (data.jobs || []).filter(j => validRunIds.has(j.runId));
                        data.responses = (data.responses || []).filter(r => validRunIds.has(r.runId));
                        data.records = (data.records || []).filter(r => validRunIds.has(r.runId));
                    } else if (resolution === 'duplicate') {
                        // Remap IDs via regex replacing the entire JSON string to be completely foolproof
                        for (const c of conflicts) {
                            const newId = WorkbenchDB.generateId();
                            const regex = new RegExp(`"${c.id}"`, 'g');
                            jsonStr = jsonStr.replace(regex, `"${newId}"`);
                        }
                        data = JSON.parse(jsonStr);

                        // Modify titles minimally just to indicate they were duped
                        for (const exp of (data.experiments || [])) {
                            if (conflicts.find(c => c.type === 'Experiment' && c.title === exp.title)) exp.title = `${exp.title} (Restored)`;
                        }
                        for (const mod of (data.models || [])) {
                            if (conflicts.find(c => c.type === 'Model' && c.title === mod.name)) mod.name = `${mod.name} (Restored)`;
                        }
                    }

                    // Import all stores logically
                    const stores = ['experiments', 'runs', 'jobs', 'responses', 'records', 'models', 'fieldSchemas', 'charts'];
                    for (const storeName of stores) {
                        const items = data[storeName] || [];
                        const targetStore = storeName === 'fieldSchemas' ? 'field_schemas' : storeName;
                        for (const item of items) {
                            await WorkbenchDB.putOne(targetStore, item);
                        }
                    }

                    showToast('Backup restored successfully! Refreshing...', 'success');
                    setTimeout(() => window.location.reload(), 1500);
                } catch (err) {
                    console.error('Restore error:', err);
                    showToast('Failed to parse backup file: ' + err.message, 'error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    window.WorkbenchExport = {
        exportJSON,
        exportCSV,
        openBackupRestore,
    };
})();
