/**
 * app.js — AnansiWorkbench application boot, routing, and shared utilities.
 */

(() => {
    'use strict';

    // ─── Global Event Bus ────────────────────────────────────────────────────────

    const bus = {
        _listeners: {},
        on(event, fn) { (this._listeners[event] = this._listeners[event] || []).push(fn); },
        off(event, fn) { this._listeners[event] = (this._listeners[event] || []).filter(f => f !== fn); },
        emit(event, data) { (this._listeners[event] || []).forEach(fn => fn(data)); },
    };
    window.WorkbenchBus = bus;

    // ─── Utilities ───────────────────────────────────────────────────────────────

    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatDate(iso) {
        if (!iso) return '—';
        try {
            return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        } catch { return iso; }
    }

    function formatDateTime(iso) {
        if (!iso) return '—';
        try {
            return new Date(iso).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch { return iso; }
    }

    function formatDuration(ms) {
        if (ms == null || ms < 0) return '—';
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const h = Math.floor(m / 60);
        if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
        if (m > 0) return `${m}m ${s % 60}s`;
        return `${s}s`;
    }

    function debounce(fn, delay) {
        let timer;
        return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
    }

    function downloadJSON(data, filename) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'), { href: url, download: filename });
        a.click();
        URL.revokeObjectURL(url);
    }

    function downloadCSV(rows, filename) {
        const csv = rows.map(r => r.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'), { href: url, download: filename });
        a.click();
        URL.revokeObjectURL(url);
    }

    function slugify(str) {
        return String(str).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }

    function plural(n, word) {
        return `${n} ${word}${n === 1 ? '' : 's'}`;
    }

    window.WorkbenchUtils = { escapeHtml, formatDate, formatDateTime, formatDuration, debounce, downloadJSON, downloadCSV, slugify, plural };

    // ─── Toast Notifications ─────────────────────────────────────────────────────

    let toastContainer;
    function getToastContainer() {
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            document.body.appendChild(toastContainer);
        }
        return toastContainer;
    }

    function showToast(message, type = 'info', duration = 3500) {
        const container = getToastContainer();
        const el = document.createElement('div');
        el.className = `toast toast-${type}`;
        el.innerHTML = `<span class="toast-msg">${escapeHtml(message)}</span><button class="toast-close" aria-label="Close">✕</button>`;
        el.querySelector('.toast-close').onclick = () => el.remove();
        container.appendChild(el);
        setTimeout(() => { el.classList.add('toast-hide'); setTimeout(() => el.remove(), 400); }, duration);
    }

    window.showToast = showToast;

    // ─── Modal System ─────────────────────────────────────────────────────────────

    function openModal(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.add('active');
        document.body.classList.add('modal-open');
        el.querySelector('[autofocus]')?.focus();
    }

    function closeModal(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.remove('active');
        if (!document.querySelector('.modal.active')) {
            document.body.classList.remove('modal-open');
        }
    }

    function closeAllModals() {
        document.querySelectorAll('.modal.active').forEach(el => el.classList.remove('active'));
        document.body.classList.remove('modal-open');
    }

    // Close on backdrop click
    document.addEventListener('click', e => {
        if (e.target.classList.contains('modal') && e.target.classList.contains('active')) {
            closeAllModals();
        }
    });
    // Close on Escape
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeAllModals();
    });

    window.openModal = openModal;
    window.closeModal = closeModal;
    window.closeAllModals = closeAllModals;

    // ─── Confirm Dialog ───────────────────────────────────────────────────────────

    function showConfirm(message, title = 'Confirm') {
        return new Promise(resolve => {
            const modal = document.getElementById('modal-confirm');
            if (!modal) { resolve(window.confirm(message)); return; }
            modal.querySelector('#confirm-title').textContent = title;
            modal.querySelector('#confirm-message').textContent = message;
            modal.classList.add('active');
            document.body.classList.add('modal-open');
            function onBtn(e) {
                modal.classList.remove('active');
                document.body.classList.remove('modal-open');
                modal.removeEventListener('click', onBtn);
                resolve(e.target.closest('[data-confirm]')?.dataset.confirm === 'yes');
            }
            modal.addEventListener('click', onBtn);
        });
    }

    window.showConfirm = showConfirm;

    // ─── Prompt Dialog ────────────────────────────────────────────────────────────

    function showPrompt(message, defaultValue = '', title = 'Enter value') {
        return new Promise(resolve => {
            const modal = document.getElementById('modal-prompt');
            if (!modal) { resolve(window.prompt(message, defaultValue)); return; }
            modal.querySelector('#prompt-title').textContent = title;
            modal.querySelector('#prompt-message').textContent = message;
            const input = modal.querySelector('#prompt-input');
            input.value = defaultValue;
            modal.classList.add('active');
            document.body.classList.add('modal-open');
            setTimeout(() => input.focus(), 50);
            function onAction(e) {
                const btn = e.target.closest('[data-prompt]');
                if (!btn) return;
                modal.classList.remove('active');
                document.body.classList.remove('modal-open');
                modal.removeEventListener('click', onAction);
                input.removeEventListener('keydown', onKey);
                resolve(btn.dataset.prompt === 'ok' ? input.value : null);
            }
            function onKey(e) {
                if (e.key === 'Enter') { modal.querySelector('[data-prompt="ok"]').click(); }
                if (e.key === 'Escape') { modal.querySelector('[data-prompt="cancel"]').click(); }
            }
            modal.addEventListener('click', onAction);
            input.addEventListener('keydown', onKey);
        });
    }

    window.showPrompt = showPrompt;

    // ─── Tab Routing ─────────────────────────────────────────────────────────────

    const tabs = {};
    let activeTab = null;

    function registerTab(id, onActivate) {
        tabs[id] = onActivate;
    }

    function activateTab(id) {
        if (activeTab === id) return;
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === id);
        });
        document.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.toggle('active', panel.id === `tab-${id}`);
        });
        activeTab = id;
        if (tabs[id]) tabs[id]();
        bus.emit('tab:changed', id);
    }

    document.addEventListener('click', e => {
        const btn = e.target.closest('.tab-btn[data-tab]');
        if (btn) activateTab(btn.dataset.tab);
    });

    window.WorkbenchApp = { registerTab, activateTab, getActiveTab: () => activeTab };

    // ─── Shared State ─────────────────────────────────────────────────────────────

    // Currently selected experiment / run for cross-module coordination
    const state = {
        selectedExperimentId: null,
        selectedRunId: null,
        workerRunning: false,
    };
    window.WorkbenchState = state;

    // ─── Boot ─────────────────────────────────────────────────────────────────────

    async function boot() {
        try {
            await WorkbenchDB.initDB();
            console.log('[Workbench] Database ready.');
        } catch (err) {
            console.error('[Workbench] DB init failed:', err);
            showToast('Database failed to initialize. Please refresh.', 'error', 0);
            return;
        }

        // Initialize modules in order
        if (typeof WorkbenchModels !== 'undefined') WorkbenchModels.init();
        if (typeof WorkbenchExperiments !== 'undefined') WorkbenchExperiments.init();
        if (typeof WorkbenchExecution !== 'undefined') WorkbenchExecution.init();
        if (typeof WorkbenchReview !== 'undefined') WorkbenchReview.init();
        if (typeof WorkbenchArchive !== 'undefined') WorkbenchArchive.init();
        if (typeof WorkbenchCharts !== 'undefined') WorkbenchCharts.init();
        if (typeof WorkbenchImport !== 'undefined') WorkbenchImport.init();

        // Default tab
        activateTab('experiments');

        console.log('[Workbench] Boot complete.');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
