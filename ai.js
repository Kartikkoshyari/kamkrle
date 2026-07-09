// Kamkrle — AI Habit Coach (frontend).
//
// Talks only to our own Netlify Function at /api/coach — never to Gemini
// directly, and no API key ever appears in this file. Chat history is kept
// in a plain in-memory array, so it's gone on refresh (session-only, by
// design — nothing here touches localStorage or Supabase).
//
// Depends on globals from other modules, so this must load last:
//   - script.js:   appDataStore, masterRoutineList, todayKey
//   - auth.js:     sb, currentUser, isGuestMode
//   - ui.js:       escapeHtml

const COACH_ENDPOINT = '/api/coach';

let coachHistory = []; // { role: 'user' | 'coach', text: string }[]
let coachRequestInFlight = false;

function openCoachModal() {
    document.getElementById('ai-coach-overlay').style.display = 'flex';
    document.getElementById('ai-coach-input').focus();
}

function closeCoachModal() {
    document.getElementById('ai-coach-overlay').style.display = 'none';
}

// Reads from data/state that other modules already maintain, rather than
// recomputing streaks or percentages here.
function buildHabitContext() {
    const todayTasks = appDataStore[todayKey] || [];
    return {
        habitNames: masterRoutineList.map(item => item.title),
        todayCompletionPct: document.getElementById('stat-day-pct').innerText,
        thirtyDayAvgPct: document.getElementById('stat-month-pct').innerText,
        currentStreak: document.getElementById('stat-streak').innerText,
        perfectDaysThisMonth: document.getElementById('stat-perfect').innerText,
        todayTasks: todayTasks.map(t => ({ title: t.title, done: !!t.done })),
    };
}

function appendCoachMessage(role, text) {
    const list = document.getElementById('ai-coach-messages');
    const bubble = document.createElement('div');
    bubble.className = 'coach-msg coach-msg-' + (role === 'user' ? 'user' : 'coach');
    bubble.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
    list.appendChild(bubble);
    list.scrollTop = list.scrollHeight;
    return bubble;
}

function setCoachLoading(isLoading) {
    coachRequestInFlight = isLoading;
    document.getElementById('ai-coach-send-btn').disabled = isLoading;
    document.getElementById('ai-coach-input').disabled = isLoading;

    const existing = document.getElementById('ai-coach-typing');
    if (isLoading && !existing) {
        const list = document.getElementById('ai-coach-messages');
        const bubble = document.createElement('div');
        bubble.className = 'coach-msg coach-msg-coach coach-msg-typing';
        bubble.id = 'ai-coach-typing';
        bubble.innerHTML = '<span></span><span></span><span></span>';
        list.appendChild(bubble);
        list.scrollTop = list.scrollHeight;
    } else if (!isLoading && existing) {
        existing.remove();
    }
}

async function sendCoachMessage() {
    if (coachRequestInFlight) return;

    const input = document.getElementById('ai-coach-input');
    const message = input.value.trim();
    if (!message) return;

    appendCoachMessage('user', message);
    coachHistory.push({ role: 'user', text: message });
    input.value = '';
    setCoachLoading(true);

    try {
        const headers = { 'Content-Type': 'application/json' };

        // Signed-in users pass their Supabase access token so the backend
        // can verify the request is coming from a real account. Guests
        // proceed without one.
        if (!isGuestMode && currentUser) {
            const { data: { session } } = await sb.auth.getSession();
            if (session && session.access_token) {
                headers['Authorization'] = `Bearer ${session.access_token}`;
            }
        }

        const res = await fetch(COACH_ENDPOINT, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                message,
                history: coachHistory.slice(0, -1), // everything before this message
                habitContext: buildHabitContext(),
            }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            throw new Error(data.error || `Request failed (${res.status})`);
        }

        appendCoachMessage('coach', data.reply);
        coachHistory.push({ role: 'coach', text: data.reply });
    } catch (err) {
        console.error('Coach request failed:', err);
        appendCoachMessage('coach', "Sorry, I couldn't reach the coach just now. Please try again in a moment.");
    } finally {
        setCoachLoading(false);
    }
}

document.getElementById('ai-coach-fab').addEventListener('click', openCoachModal);

document.getElementById('ai-coach-send-btn').addEventListener('click', sendCoachMessage);

document.getElementById('ai-coach-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendCoachMessage();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeCoachModal();
});
