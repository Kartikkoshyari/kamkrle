// Kamkrle — theme toggle, tab switching, tilt cards, help modal, daily checklist,
// and the Manage Routine panel.


// ---------- Help modal ----------
function openHelpModal() {
    document.getElementById('help-overlay').style.display = 'flex';
}

function closeHelpModal() {
    document.getElementById('help-overlay').style.display = 'none';
}

// ---------- Live date/time bar ----------
function updateDateTimeBar() {
    const dateEl = document.getElementById('datetime-date');
    const timeEl = document.getElementById('datetime-time');
    if (!dateEl || !timeEl) return;

    const now = new Date();
    dateEl.textContent = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    timeEl.textContent = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ---------- 3D tilt effect for stat cards ----------
// Cards are static in the markup (not re-rendered), so binding once
// at load is enough — no need to rebind after every data update.
function initTiltCards() {
    document.querySelectorAll('.stat-card').forEach((card) => {
        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            const relX = (e.clientX - rect.left) / rect.width;
            const relY = (e.clientY - rect.top) / rect.height;
            const rotateY = (relX - 0.5) * 14;
            const rotateX = (0.5 - relY) * 14;
            card.style.transform = `perspective(700px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-6px)`;
        });
        card.addEventListener('mouseleave', () => {
            card.style.transform = '';
        });
    });
}

// ---------- Theme (day / dark mode) ----------
function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('orbit_theme', next); } catch (e) { /* storage unavailable, theme just won't persist */ }
    syncThemeToggleUI();
    // Chart colors are baked in at draw time, so redraw with the new palette.
    if (analyticsChartInstance) calculateAndRenderMetrics();
}

function syncThemeToggleUI() {
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    const icon = document.getElementById('theme-toggle-icon');
    const btn = document.getElementById('theme-toggle-btn');
    const metaColor = document.getElementById('meta-theme-color');
    if (icon) icon.textContent = theme === 'dark' ? 'dark_mode' : 'light_mode';
    if (btn) btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to day mode' : 'Switch to dark mode');
    if (metaColor) metaColor.setAttribute('content', theme === 'dark' ? '#090a0f' : '#f2f4f3');
}

// ---------- Tab switching ----------
const TAB_CONFIG = {
    'routine-view': { btn: 'tab-routine-btn', panel: 'routine-view-panel' },
    'calendar-view': { btn: 'tab-calendar-btn', panel: 'calendar-view-panel' },
    'manage-view': { btn: 'tab-manage-btn', panel: 'manage-view-panel' }
};

function switchTab(targetTabId) {
    Object.values(TAB_CONFIG).forEach(({ btn, panel }) => {
        document.getElementById(btn).classList.remove('active');
        document.getElementById(btn).setAttribute('aria-selected', 'false');
        document.getElementById(panel).classList.remove('active');
    });

    const target = TAB_CONFIG[targetTabId];
    document.getElementById(target.btn).classList.add('active');
    document.getElementById(target.btn).setAttribute('aria-selected', 'true');
    document.getElementById(target.panel).classList.add('active');

    document.getElementById('calendar-controls').style.display = (targetTabId === 'calendar-view') ? 'flex' : 'none';

    // The stats bar (progress, streak, etc.) is only relevant while
    // looking at today's checklist or the calendar — not while editing
    // the routine's task list.
    document.getElementById('stats-grid-section').style.display = (targetTabId === 'manage-view') ? 'none' : 'grid';

    if (targetTabId === 'routine-view') renderChecklistWorkspace();
    else if (targetTabId === 'calendar-view') renderCalendar();
    else if (targetTabId === 'manage-view') renderManagementPanel();
}

// ---------- Daily checklist ----------
function renderChecklistWorkspace() {
    const container = document.getElementById('routine-checklist-element');
    container.innerHTML = '';

    const todayTasks = appDataStore[todayKey] || [];
    const doneCount = todayTasks.filter(t => t.done).length;
    const pct = todayTasks.length > 0 ? Math.round((doneCount / todayTasks.length) * 100) : 0;

    document.getElementById('today-progress-fill').style.width = `${pct}%`;
    document.getElementById('today-progress-label').textContent = `${doneCount} / ${todayTasks.length} complete`;

    if (todayTasks.length === 0) {
        container.innerHTML = `<li class="task-item empty-state">No tracked actions found. Go to 'Manage Routine' to create tasks!</li>`;
        return;
    }

    todayTasks.forEach((task, idx) => {
        const li = document.createElement('li');
        li.className = 'task-item' + (task.done ? ' done' : '');
        const timeBadge = task.time
            ? `<span class="task-time-badge"><span class="material-icons-round" aria-hidden="true">schedule</span>${formatScheduledTime(task.time)}</span>`
            : '';
        li.innerHTML = `
            <div class="task-text-section">
                <label class="task-text" for="task-check-${idx}">${escapeHtml(task.title)}</label>
                ${timeBadge}
            </div>
            <div class="task-checkbox-section">
                <label class="checkbox-wrap">
                    <input type="checkbox" id="task-check-${idx}" data-idx="${idx}" ${task.done ? 'checked' : ''}>
                    <span class="custom-checkbox" aria-hidden="true"></span>
                </label>
            </div>
        `;
        container.appendChild(li);
    });
}

// Event delegation avoids re-binding a handler per row on every render.
document.getElementById('routine-checklist-element').addEventListener('change', (e) => {
    const checkbox = e.target.closest('input[type="checkbox"]');
    if (!checkbox) return;
    const idx = Number(checkbox.dataset.idx);
    if (appDataStore[todayKey] && appDataStore[todayKey][idx]) {
        appDataStore[todayKey][idx].done = checkbox.checked;
        saveData();
        renderChecklistWorkspace();
        calculateAndRenderMetrics();
    }
});

// ---------- Manage routine ----------
// Tracks which master item (by id), if any, currently has its inline
// time editor open in the Manage Routine list. Re-render swaps that
// single row between its normal Edit/Delete view and the editor view.
let editingTimeItemId = null;

function renderManagementPanel() {
    const container = document.getElementById('master-configuration-list-element');
    container.innerHTML = '';
    hideFeedback();

    if (masterRoutineList.length === 0) {
        container.innerHTML = `<li class="task-item empty-state">No daily actions added yet. Use the entry field above.</li>`;
        return;
    }

    masterRoutineList.forEach((item) => {
        const li = document.createElement('li');
        li.className = 'task-item';

        if (editingTimeItemId === item.id) {
            li.innerHTML = `
                <div class="task-left">
                    <span class="material-icons-round" aria-hidden="true" style="color: var(--accent);">schedule</span>
                    <span class="task-text">${escapeHtml(item.title)}</span>
                </div>
                <div class="time-editor" data-id="${item.id}">
                    <input type="time" class="time-editor-input" value="${item.time || ''}" aria-label="Scheduled time for ${escapeHtml(item.title)}">
                    <button type="button" class="btn-icon btn-time-save" data-id="${item.id}" aria-label="Save time">
                        <span class="material-icons-round" aria-hidden="true">check</span>
                    </button>
                    <button type="button" class="btn-icon btn-time-clear" data-id="${item.id}" aria-label="Clear time">
                        <span class="material-icons-round" aria-hidden="true">close</span>
                    </button>
                    <button type="button" class="btn-secondary-link btn-time-cancel" data-id="${item.id}">Cancel</button>
                </div>
            `;
            container.appendChild(li);
            return;
        }

        const timeBadge = item.time
            ? `<span class="task-time-badge"><span class="material-icons-round" aria-hidden="true">schedule</span>${formatScheduledTime(item.time)}</span>`
            : '';
        li.innerHTML = `
            <div class="task-left">
                <span class="material-icons-round" aria-hidden="true" style="color: var(--accent);">drag_indicator</span>
                <span class="task-text">${escapeHtml(item.title)}</span>
                ${timeBadge}
            </div>
            <div class="task-item-actions">
                <button type="button" class="btn-edit" data-id="${item.id}" aria-label="${item.time ? 'Edit' : 'Add'} scheduled time for ${escapeHtml(item.title)}">
                    <span class="material-icons-round" aria-hidden="true">schedule</span>
                </button>
                <button type="button" class="btn-delete" data-id="${item.id}" aria-label="Delete ${escapeHtml(item.title)}">
                    <span class="material-icons-round" aria-hidden="true">delete</span>
                </button>
            </div>
        `;
        container.appendChild(li);
    });
}

// Applies a (possibly cleared) time to a master routine item, and keeps
// today's already-generated task in sync so both views agree without
// creating a duplicate task or a duplicate id.
function applyTaskTimeChange(id, newTime) {
    const item = masterRoutineList.find(i => i.id === id);
    if (!item) return;

    item.time = newTime || null;

    if (appDataStore[todayKey]) {
        const todayTask = appDataStore[todayKey].find(t => t.id === id);
        if (todayTask) todayTask.time = newTime || null;
    }

    editingTimeItemId = null;
    saveData();
    renderManagementPanel();
    renderChecklistWorkspace();
}

// Delete by stable id — fixes the original bug where deletion matched
// on (HTML-escaped) title text and silently failed or removed the
// wrong row whenever a title had an apostrophe or a duplicate.
// Also handles the inline time editor's Edit/Save/Clear/Cancel controls,
// all via the same delegated listener so nothing gets double-bound
// across re-renders.
document.getElementById('master-configuration-list-element').addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('.btn-delete');
    if (deleteBtn) {
        const id = deleteBtn.dataset.id;

        masterRoutineList = masterRoutineList.filter(item => item.id !== id);
        if (appDataStore[todayKey]) {
            appDataStore[todayKey] = appDataStore[todayKey].filter(task => task.id !== id);
        }
        if (editingTimeItemId === id) editingTimeItemId = null;

        saveData();
        renderManagementPanel();
        calculateAndRenderMetrics();
        return;
    }

    const editBtn = e.target.closest('.btn-edit');
    if (editBtn) {
        editingTimeItemId = editBtn.dataset.id;
        renderManagementPanel();
        return;
    }

    const cancelBtn = e.target.closest('.btn-time-cancel');
    if (cancelBtn) {
        editingTimeItemId = null;
        renderManagementPanel();
        return;
    }

    const clearBtn = e.target.closest('.btn-time-clear');
    if (clearBtn) {
        applyTaskTimeChange(clearBtn.dataset.id, null);
        return;
    }

    const saveBtn = e.target.closest('.btn-time-save');
    if (saveBtn) {
        const id = saveBtn.dataset.id;
        const editorInput = document.querySelector(`.time-editor[data-id="${id}"] .time-editor-input`);
        applyTaskTimeChange(id, editorInput ? editorInput.value : null);
        return;
    }
});

// Enter saves the open time editor, Escape closes it without saving —
// mirrors the Add Activity input's existing Enter-to-submit behavior.
document.getElementById('master-configuration-list-element').addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('time-editor-input')) return;
    if (e.key === 'Enter') {
        e.preventDefault();
        const id = e.target.closest('.time-editor').dataset.id;
        applyTaskTimeChange(id, e.target.value || null);
    } else if (e.key === 'Escape') {
        editingTimeItemId = null;
        renderManagementPanel();
    }
});

function addMasterItem() {
    const input = document.getElementById('master-routine-input');
    const timeInput = document.getElementById('master-routine-time');
    const cleanText = input.value.trim();
    const cleanTime = timeInput.value || null;
    if (!cleanText) return;

    if (masterRoutineList.length >= 10) {
        showFeedback("⚠️ Allocation ceiling reached — limit is 10 items max.");
        return;
    }

    const isDuplicate = masterRoutineList.some(item => item.title.toLowerCase() === cleanText.toLowerCase());
    if (isDuplicate) {
        showFeedback("⚠️ That activity is already on your list.");
        return;
    }

    const newItem = { id: generateId(), title: cleanText, time: cleanTime };
    masterRoutineList.push(newItem);

    if (!appDataStore[todayKey]) appDataStore[todayKey] = [];
    if (appDataStore[todayKey].length < 10) {
        appDataStore[todayKey].push({ id: newItem.id, title: cleanText, done: false, time: cleanTime });
    }

    input.value = '';
    timeInput.value = '';
    saveData();
    renderManagementPanel();
    calculateAndRenderMetrics();
}

// Converts a 24-hour "HH:MM" value from <input type="time"> into a
// friendly 12-hour label, e.g. "07:30" -> "7:30 AM".
function formatScheduledTime(time24) {
    if (!time24) return '';
    const [hStr, mStr] = time24.split(':');
    let h = parseInt(hStr, 10);
    const suffix = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${mStr} ${suffix}`;
}

function showFeedback(message) {
    const el = document.getElementById('master-feedback');
    el.textContent = message;
    el.style.display = 'block';
}

function hideFeedback() {
    document.getElementById('master-feedback').style.display = 'none';
}

document.getElementById('master-routine-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addMasterItem();
});

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
