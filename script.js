// Kamkrle — core state, localStorage persistence, and date/id helpers shared by every other module.
// Loaded first: other modules rely on the globals and functions declared here.

// ---------- State ----------
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let todayKey = getFormattedDateKey(new Date());

let appDataStore = safeLoad('orbit_app_db', {});
let masterRoutineList = safeLoad('orbit_master_routine', []);

let analyticsChartInstance = null;
let storageAvailable = true;
function safeLoad(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
        return fallback;
    }
}

function saveData() {
    try {
        localStorage.setItem('orbit_app_db', JSON.stringify(appDataStore));
        localStorage.setItem('orbit_master_routine', JSON.stringify(masterRoutineList));
    } catch (e) {
        storageAvailable = false;
        document.getElementById('storage-banner').style.display = 'block';
    }
    scheduleCloudSync();
}

function generateId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// Older data may store master items as plain strings and day tasks
// without an id. Upgrade in place so existing users don't lose data.
function migrateLegacyData() {
    let changed = false;

    masterRoutineList = masterRoutineList.map(item => {
        if (typeof item === 'string') {
            changed = true;
            return { id: generateId(), title: item };
        }
        return item;
    });

    const titleToId = new Map(masterRoutineList.map(item => [item.title, item.id]));

    Object.keys(appDataStore).forEach(dateKey => {
        appDataStore[dateKey] = (appDataStore[dateKey] || []).map(task => {
            if (!task.id) {
                changed = true;
                return { id: titleToId.get(task.title) || generateId(), title: task.title, done: !!task.done };
            }
            return task;
        });
    });

    if (changed) saveData();
}

// ---------- Date helpers ----------
function getFormattedDateKey(dateObj) {
    let y = dateObj.getFullYear();
    let m = String(dateObj.getMonth() + 1).padStart(2, '0');
    let d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function daysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
}

function initializeTodayLog() {
    if (!appDataStore[todayKey]) {
        appDataStore[todayKey] = masterRoutineList.map(item => ({ id: item.id, title: item.title, done: false, time: item.time || null }));
        saveData();
    }
}

// Detect midnight rollover if the page is left open.
function checkForDateRollover() {
    const freshKey = getFormattedDateKey(new Date());
    if (freshKey !== todayKey) {
        todayKey = freshKey;
        initializeTodayLog();
        renderChecklistWorkspace();
        renderCalendar();
        calculateAndRenderMetrics();
    }
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeHelpModal();
        closeGuestWarning();
    }
});

document.addEventListener('DOMContentLoaded', () => {
    syncThemeToggleUI();
    initAuthListeners();
    initTiltCards();
    updateDateTimeBar();
    setInterval(updateDateTimeBar, 1000);

    // Supabase appends #...type=recovery to the URL when someone clicks
    // a password-reset email link — catch that before deciding whether
    // to auto sign them into the app.
    if (window.location.hash.includes('type=recovery')) {
        authMode = 'reset-confirm';
        renderAuthMode();
        return;
    }

    sb.auth.getSession().then(({ data: { session } }) => {
        if (session && session.user) {
            enterApp(session.user);
        } else if (localStorage.getItem('kamkrle_guest') === '1') {
            enterGuestMode();
        } else {
            showAuthScreen();
        }
    });
});
