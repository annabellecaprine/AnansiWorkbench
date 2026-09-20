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
                    const data = JSON.parse(evt.target.result);
                    if (data._app !== 'anansi-workbench') {
                        showToast('Invalid backup file. App signature does not match.', 'error');
                        return;
                    }

                    const ok = await showConfirm(`Restore backup from ${data._exportedAt}? Existing records with matching IDs will be overwritten.`, 'Restore Backup');
                    if (!ok) return;

                    // Import all stores
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
