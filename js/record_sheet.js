/**
 * record_sheet.js — Test Record Sheet Custom Fields & Dynamic Rendering for AnansiWorkbench.
 * Manages field schemas (experiment level & subtest level inheritance) and dynamic form rendering.
 */

(() => {
    'use strict';

    const { escapeHtml } = WorkbenchUtils;

    const FIELD_TYPES = [
        { id: 'checkbox', name: 'Checkbox (Yes/No)', icon: '☑️' },
        { id: 'single_choice', name: 'Single Choice (Dropdown)', icon: '🔘' },
        { id: 'multi_choice', name: 'Multiple Choice (Checkboxes)', icon: '☑️' },
        { id: 'rating', name: 'Rating (1-5 Stars)', icon: '⭐' },
        { id: 'integer', name: 'Integer Number', icon: '🔢' },
        { id: 'decimal', name: 'Decimal Number', icon: '📐' },
        { id: 'short_text', name: 'Short Text', icon: '✍️' },
        { id: 'long_text', name: 'Long Text / Notes', icon: '📝' },
        { id: 'timestamp', name: 'Timestamp', icon: '⏱️' }
    ];

    /**
     * Get effective list of field schemas for a given experiment & subtest.
     * Merges experiment-level fields with subtest-level field additions or overrides.
     */
    async function getEffectiveFields(experimentId, subtestId = null) {
        if (!experimentId) return [];
        const allSchemas = await WorkbenchDB.getFieldSchemas(experimentId);

        // Experiment-level fields (subtestId is null or empty)
        const expFields = allSchemas.filter(s => !s.subtestId);

        if (!subtestId) {
            return expFields.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
        }

        // Subtest-level fields
        const stFields = allSchemas.filter(s => s.subtestId === subtestId);

        // Merge: subtest fields with same name or ID override experiment fields, otherwise append
        const mergedMap = new Map();
        expFields.forEach(f => mergedMap.set(f.id, { ...f, inherited: true }));
        stFields.forEach(f => {
            if (mergedMap.has(f.id)) {
                mergedMap.set(f.id, { ...f, inherited: false, overridden: true });
            } else {
                mergedMap.set(f.id, { ...f, inherited: false });
            }
        });

        return Array.from(mergedMap.values()).sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
    }

    /**
     * Render the Test Record Sheet form HTML for a response record.
     * @param {Array} fields — effective field schemas
     * @param {Object} currentRecord — existing record object from IndexedDB
     */
    function renderFormHTML(fields, currentRecord) {
        const fieldValues = currentRecord?.fieldValues || {};
        const reviewStatus = currentRecord?.reviewStatus || 'unreviewed';
        const notes = currentRecord?.notes || '';

        let html = `
      <div class="record-sheet-wrapper">
        <div class="review-label">TEST RECORD SHEET</div>
        <div class="record-meta-row form-row">
          <div class="form-group">
            <label for="record-status-select">Review Status</label>
            <select id="record-status-select">
              <option value="unreviewed" ${reviewStatus === 'unreviewed' ? 'selected' : ''}>⏳ Unreviewed</option>
              <option value="in_progress" ${reviewStatus === 'in_progress' ? 'selected' : ''}>🔄 In Progress</option>
              <option value="complete" ${reviewStatus === 'complete' ? 'selected' : ''}>✅ Complete</option>
              <option value="flagged" ${reviewStatus === 'flagged' ? 'selected' : ''}>🔖 Flagged for Review</option>
            </select>
          </div>
        </div>
    `;

        if (!fields || fields.length === 0) {
            html += `
        <div class="record-fields-container">
          <p class="hint" style="margin-bottom: 12px;">No custom recording fields defined for this experiment. You can define custom metrics in the Experiment Builder.</p>
        </div>
      `;
        } else {
            html += `<div class="record-fields-container">`;
            fields.forEach(f => {
                const val = fieldValues[f.id] !== undefined ? fieldValues[f.id] : (f.defaultValue ?? '');
                html += renderSingleField(f, val);
            });
            html += `</div>`;
        }

        html += `
        <div class="form-group" style="margin-top: 14px;">
          <label for="record-general-notes">General Notes / Observations</label>
          <textarea id="record-general-notes" rows="3" placeholder="Enter qualitative observations, bugs, or anomalies...">${escapeHtml(notes)}</textarea>
        </div>
      </div>
    `;

        return html;
    }

    /**
     * Helper to render individual field controls based on field schema type.
     */
    function renderSingleField(field, val) {
        const fieldId = `rec-field-${field.id}`;
        const reqAttr = field.required ? 'data-required="true"' : '';
        const reqBadge = field.required ? '<span style="color:var(--danger)"> *</span>' : '';
        const inhBadge = field.inherited ? '<span class="override-badge" title="Inherited from Experiment">INHERITED</span>' : '';

        let inputHtml = '';

        switch (field.type) {
            case 'checkbox':
                inputHtml = `
          <label class="checkbox-label" style="margin-top:4px;">
            <input type="checkbox" id="${fieldId}" ${val ? 'checked' : ''} ${reqAttr}>
            ${escapeHtml(field.description || 'Enable / Yes')}
          </label>
        `;
                break;

            case 'single_choice':
                const opts = field.options || [];
                inputHtml = `
          <select id="${fieldId}" ${reqAttr}>
            <option value="">-- Select --</option>
            ${opts.map(o => `<option value="${escapeHtml(o)}" ${String(val) === String(o) ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
          </select>
        `;
                break;

            case 'multi_choice':
                const mOpts = field.options || [];
                const selectedArr = Array.isArray(val) ? val : [];
                inputHtml = `
          <div class="multi-choice-group" id="${fieldId}" ${reqAttr}>
            ${mOpts.map((o, idx) => `
              <label class="checkbox-label" style="margin-bottom:4px;">
                <input type="checkbox" value="${escapeHtml(o)}" ${selectedArr.includes(o) ? 'checked' : ''}>
                ${escapeHtml(o)}
              </label>
            `).join('')}
          </div>
        `;
                break;

            case 'rating':
                const maxStars = field.maxStars || 5;
                const currentRating = parseInt(val) || 0;
                inputHtml = `
          <div class="rating-picker" id="${fieldId}" data-value="${currentRating}" ${reqAttr}>
            ${Array.from({ length: maxStars }, (_, i) => i + 1).map(star => `
              <button type="button" class="rating-star ${star <= currentRating ? 'active' : ''}" 
                      onclick="WorkbenchRecordSheet.setRating('${fieldId}', ${star})">★</button>
            `).join('')}
            <span class="rating-label">${currentRating}/${maxStars}</span>
          </div>
        `;
                break;

            case 'integer':
                inputHtml = `<input type="number" step="1" id="${fieldId}" value="${val !== null ? escapeHtml(String(val)) : ''}" placeholder="${field.placeholder || ''}" ${reqAttr}>`;
                break;

            case 'decimal':
                inputHtml = `<input type="number" step="0.01" id="${fieldId}" value="${val !== null ? escapeHtml(String(val)) : ''}" placeholder="${field.placeholder || ''}" ${reqAttr}>`;
                break;

            case 'short_text':
                inputHtml = `<input type="text" id="${fieldId}" value="${escapeHtml(String(val || ''))}" placeholder="${field.placeholder || ''}" ${reqAttr}>`;
                break;

            case 'long_text':
                inputHtml = `<textarea id="${fieldId}" rows="3" placeholder="${field.placeholder || ''}" ${reqAttr}>${escapeHtml(String(val || ''))}</textarea>`;
                break;

            case 'timestamp':
                inputHtml = `
          <div class="flex-row">
            <input type="text" id="${fieldId}" value="${escapeHtml(String(val || ''))}" placeholder="ISO timestamp or text" ${reqAttr} class="flex-1">
            <button type="button" class="btn btn-sm" onclick="document.getElementById('${fieldId}').value = new Date().toISOString()">Now</button>
          </div>
        `;
                break;

            default:
                inputHtml = `<input type="text" id="${fieldId}" value="${escapeHtml(String(val || ''))}" ${reqAttr}>`;
        }

        return `
      <div class="form-group record-field-item" data-field-id="${field.id}" data-type="${field.type}">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <label for="${fieldId}" style="margin-bottom:0;">${escapeHtml(field.name)}${reqBadge}</label>
          ${inhBadge}
        </div>
        ${field.description && field.type !== 'checkbox' ? `<div class="hint" style="margin-bottom:6px;">${escapeHtml(field.description)}</div>` : ''}
        ${inputHtml}
      </div>
    `;
    }

    /**
     * Collect field values from the rendered form DOM.
     * Returns { reviewStatus, notes, fieldValues }
     */
    function collectValues(fields) {
        const statusEl = document.getElementById('record-status-select');
        const notesEl = document.getElementById('record-general-notes');

        const reviewStatus = statusEl ? statusEl.value : 'unreviewed';
        const notes = notesEl ? notesEl.value : '';

        const fieldValues = {};

        (fields || []).forEach(f => {
            const fieldId = `rec-field-${f.id}`;
            const el = document.getElementById(fieldId);
            if (!el) return;

            switch (f.type) {
                case 'checkbox':
                    fieldValues[f.id] = el.checked;
                    break;
                case 'single_choice':
                case 'integer':
                case 'decimal':
                case 'short_text':
                case 'long_text':
                case 'timestamp':
                    if (f.type === 'integer') fieldValues[f.id] = el.value !== '' ? parseInt(el.value, 10) : null;
                    else if (f.type === 'decimal') fieldValues[f.id] = el.value !== '' ? parseFloat(el.value) : null;
                    else fieldValues[f.id] = el.value;
                    break;
                case 'multi_choice':
                    const checked = Array.from(el.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
                    fieldValues[f.id] = checked;
                    break;
                case 'rating':
                    fieldValues[f.id] = parseInt(el.dataset.value, 10) || 0;
                    break;
            }
        });

        return { reviewStatus, notes, fieldValues };
    }

    /**
     * Interactive rating star setter
     */
    function setRating(elementId, val) {
        const container = document.getElementById(elementId);
        if (!container) return;
        container.dataset.value = val;
        const stars = container.querySelectorAll('.rating-star');
        stars.forEach((star, idx) => {
            star.classList.toggle('active', (idx + 1) <= val);
        });
        const label = container.querySelector('.rating-label');
        if (label) label.textContent = `${val}/${stars.length}`;
    }

    window.WorkbenchRecordSheet = {
        FIELD_TYPES,
        getEffectiveFields,
        renderFormHTML,
        collectValues,
        setRating,
    };
})();
