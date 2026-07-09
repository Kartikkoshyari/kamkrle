// Kamkrle — Supabase authentication, guest mode, and cloud sync.
// Depends on state/helpers from script.js (appDataStore, masterRoutineList, saveData, escapeHtml, etc).

// ---------- Cloud sync (Supabase) ----------
const SUPABASE_URL = 'https://dfwgkkplofmbcuaqchxf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RTizbfh7r54NQJqBLROKCA_I2LIsJYy';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;
let isGuestMode = false;
let authMode = 'signin'; // 'signin' | 'signup' | 'reset-request' | 'reset-verify' | 'reset-confirm'
let cloudSyncTimeout = null;
let resetEmail = ''; // holds the email between the OTP request and verify steps

// ---------- Cloud sync ----------
// Debounced so rapid changes (checking several boxes in a row) don't
// fire a network request per click.
function scheduleCloudSync() {
    if (!currentUser) return;
    setSyncStatus('syncing');
    clearTimeout(cloudSyncTimeout);
    cloudSyncTimeout = setTimeout(pushToCloud, 700);
}

async function pushToCloud() {
    if (!currentUser) return;
    try {
        const { error } = await sb.from('orbit_data').upsert({
            user_id: currentUser.id,
            app_data: appDataStore,
            master_routine: masterRoutineList,
            updated_at: new Date().toISOString()
        });
        if (error) throw error;
        setSyncStatus('synced');
    } catch (e) {
        setSyncStatus('error');
    }
}

async function loadFromCloud(userId) {
    setSyncStatus('syncing');
    try {
        const { data, error } = await sb
            .from('orbit_data')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();
        if (error) throw error;

        if (data) {
            appDataStore = data.app_data || {};
            masterRoutineList = data.master_routine || [];
            saveLocalOnly();
        } else {
            // First time this account has synced — push whatever's on
            // this device up as the starting point.
            await pushToCloud();
        }
        setSyncStatus('synced');
    } catch (e) {
        setSyncStatus('error');
    }
}

// Writes to localStorage only, skipping the cloud push — used right
// after pulling fresh data down so we don't immediately re-upload it.
function saveLocalOnly() {
    try {
        localStorage.setItem('orbit_app_db', JSON.stringify(appDataStore));
        localStorage.setItem('orbit_master_routine', JSON.stringify(masterRoutineList));
    } catch (e) { /* private browsing or storage disabled; cloud copy still holds */ }
}

function setSyncStatus(state) {
    const pill = document.getElementById('sync-status-pill');
    const text = document.getElementById('sync-status-text');
    const icon = pill ? pill.querySelector('.material-icons-round') : null;
    if (!pill || !text || !icon) return;

    pill.classList.remove('synced', 'syncing', 'guest-pill');
    pill.onclick = null;
    pill.style.cursor = 'default';
    pill.removeAttribute('title');

    if (state === 'syncing') {
        pill.classList.add('syncing');
        icon.textContent = 'sync';
        text.textContent = 'Syncing…';
    } else if (state === 'synced') {
        pill.classList.add('synced');
        icon.textContent = 'cloud_done';
        text.textContent = 'Synced';
    } else if (state === 'guest') {
        pill.classList.add('guest-pill');
        icon.textContent = 'cloud_off';
        text.textContent = 'Local only — tap to sync';
        pill.style.cursor = 'pointer';
        pill.title = 'Add an email to sync this across your devices';
        pill.onclick = openLinkAccountFromGuest;
    } else {
        icon.textContent = 'cloud_off';
        text.textContent = 'Sync failed';
    }
}

// ---------- Auth ----------
function initAuthListeners() {
    sb.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
            // Kept as a safety net in case Supabase ever fires this, but the
            // OTP flow below drives reset-confirm mode directly via verifyOtp,
            // so this normally won't trigger anymore.
            enterResetConfirmMode();
        } else if (event === 'SIGNED_IN' && session && session.user && authMode !== 'reset-confirm') {
            enterApp(session.user);
        } else if (event === 'SIGNED_OUT') {
            currentUser = null;
            showAuthScreen();
        }
    });

    document.getElementById('auth-password').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleAuthSubmit();
    });
}

// Shared startup work once we know whether it's a real account or a guest.
function bootAppUI() {
    document.getElementById('auth-overlay').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';

    migrateLegacyData();
    initializeTodayLog();
    renderCalendar();
    calculateAndRenderMetrics();
    switchTab('routine-view');

    setInterval(checkForDateRollover, 60 * 1000);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForDateRollover();
    });
}

async function enterApp(user) {
    if (currentUser && currentUser.id === user.id) return; // already in
    currentUser = user;
    isGuestMode = false;
    try { localStorage.removeItem('kamkrle_guest'); } catch (e) { /* fine if unavailable */ }
    document.getElementById('signout-btn').style.display = 'flex';

    await loadFromCloud(user.id);
    bootAppUI();

    if (user.user_metadata && user.user_metadata.username) {
        updateGreeting(user);
    } else {
        openUsernamePrompt();
    }
}

// Shows "Hey <username>" for signed-in accounts. Falls back to the
// part of their email before the @ in the unlikely case metadata
// saved without one somehow slipping through.
function updateGreeting(user) {
    const el = document.getElementById('header-greeting');
    if (!el) return;
    const username = user && user.user_metadata && user.user_metadata.username;
    const fallback = user && user.email ? user.email.split('@')[0] : '';
    const name = (username || fallback || '').trim();
    el.innerHTML = name ? `Hey ${escapeHtml(name)} <span class="wave">👋</span>` : '';
}

// Same idea for guests — their username lives only in localStorage
// since there's no account to attach it to.
function updateGreetingForGuest() {
    const el = document.getElementById('header-greeting');
    if (!el) return;
    let name = '';
    try { name = localStorage.getItem('kamkrle_guest_username') || ''; } catch (e) { /* private browsing etc */ }
    el.innerHTML = name ? `Hey ${escapeHtml(name)} <span class="wave">👋</span>` : '';
}

function clearGreeting() {
    const el = document.getElementById('header-greeting');
    if (el) el.innerHTML = '';
}

// Local-only mode: no Supabase account, data lives only in this
// browser's localStorage until (if ever) they choose to add an email.
function enterGuestMode() {
    currentUser = null;
    isGuestMode = true;
    try { localStorage.setItem('kamkrle_guest', '1'); } catch (e) { /* private browsing etc — still works this session */ }
    document.getElementById('signout-btn').style.display = 'none';
    setSyncStatus('guest');
    bootAppUI();

    let guestUsername = '';
    try { guestUsername = localStorage.getItem('kamkrle_guest_username') || ''; } catch (e) { /* fine */ }
    if (guestUsername) {
        updateGreetingForGuest();
    } else {
        openUsernamePrompt();
    }
}

function continueAsGuest() {
    enterGuestMode();
}

// ---------- Post-login username prompt (guest + account) ----------
// Shown once, right after entering the app, whichever way someone got
// in. Not tied to the login form itself — it's a separate step so
// both Gmail-style accounts and guests end up with a name to greet.
function openUsernamePrompt() {
    const messageEl = document.getElementById('username-message');
    messageEl.textContent = '';
    messageEl.className = 'auth-message';
    document.getElementById('username-input').value = '';
    document.getElementById('username-preview').textContent = '';
    document.getElementById('username-overlay').style.display = 'flex';
}

function updateUsernamePreview() {
    const name = document.getElementById('username-input').value.trim();
    document.getElementById('username-preview').textContent = name ? `Hey ${name} 👋` : '';
}

function closeUsernamePrompt() {
    document.getElementById('username-overlay').style.display = 'none';
}

async function submitUsernamePrompt() {
    const input = document.getElementById('username-input');
    const messageEl = document.getElementById('username-message');
    const username = input.value.trim();

    if (!username) {
        messageEl.textContent = 'Please enter a username to continue.';
        messageEl.className = 'auth-message error';
        return;
    }

    const loadingEl = document.getElementById('username-loading');
    const submitBtn = document.getElementById('username-submit-btn');
    loadingEl.style.display = 'flex';
    submitBtn.disabled = true;

    try {
        if (currentUser) {
            const { data, error } = await sb.auth.updateUser({ data: { username } });
            if (error) throw error;
            currentUser = data.user;
            updateGreeting(currentUser);
        } else {
            try { localStorage.setItem('kamkrle_guest_username', username); } catch (e) { /* private browsing etc — greeting just won't persist */ }
            updateGreetingForGuest();
        }
        closeUsernamePrompt();
    } catch (e) {
        messageEl.textContent = e.message || 'Could not save that. Try again.';
        messageEl.className = 'auth-message error';
    } finally {
        loadingEl.style.display = 'none';
        submitBtn.disabled = false;
    }
}

// Shown the first time someone chooses "Continue without an account" —
// returning guests (kamkrle_guest already set) skip straight past this.
function handleGuestButtonClick() {
    document.getElementById('guest-warning-overlay').style.display = 'flex';
}

function closeGuestWarning() {
    document.getElementById('guest-warning-overlay').style.display = 'none';
}

function confirmContinueAsGuest() {
    closeGuestWarning();
    continueAsGuest();
}

// Lets a guest keep everything they've already tracked locally, and
// simply add sync on top by creating (or signing into) an account.
function openLinkAccountFromGuest() {
    authMode = 'signup';
    document.getElementById('auth-overlay').style.display = 'flex';
    document.getElementById('app-container').style.display = 'none';
    renderAuthMode();
}

function showAuthScreen() {
    document.getElementById('auth-overlay').style.display = 'flex';
    document.getElementById('app-container').style.display = 'none';
    document.getElementById('signout-btn').style.display = 'none';
}

// Redraws the auth card for whichever mode we're in. Kept as one
// function so the four modes can't drift out of sync with each other.
function renderAuthMode() {
    const title = document.getElementById('auth-title');
    const subtitle = document.getElementById('auth-subtitle');
    const primaryBtn = document.getElementById('auth-primary-btn');
    const toggleBtn = document.getElementById('auth-toggle-mode-btn');
    const forgotBtn = document.getElementById('auth-forgot-btn');
    const emailField = document.getElementById('auth-email-field');
    const passwordField = document.getElementById('auth-password-field');
    const passwordLabel = document.getElementById('auth-password-label');
    const passwordInput = document.getElementById('auth-password');
    const emailHint = document.getElementById('auth-email-hint');
    const guestBtn = document.getElementById('auth-guest-btn');

    clearAuthMessage();
    emailField.style.display = 'flex';
    passwordField.style.display = 'flex';
    forgotBtn.style.display = 'block';
    toggleBtn.style.display = 'block';
    guestBtn.style.display = 'block';
    passwordLabel.textContent = 'Password';
    passwordInput.type = 'password';
    passwordInput.placeholder = 'At least 6 characters';
    passwordInput.autocomplete = 'current-password';
    passwordInput.removeAttribute('maxlength');
    passwordInput.removeAttribute('inputmode');
    emailHint.style.display = 'none';

    if (authMode === 'signup') {
        title.textContent = 'Create your account';
        subtitle.textContent = 'One account, synced on every device.';
        primaryBtn.textContent = 'Sign Up';
        toggleBtn.textContent = 'Already have an account? Sign in';
        forgotBtn.style.display = 'none';
        passwordInput.autocomplete = 'new-password';
        emailHint.style.display = 'flex';
    } else if (authMode === 'reset-request') {
        title.textContent = 'Reset your password';
        subtitle.textContent = "We'll email you a 6-digit code.";
        primaryBtn.textContent = 'Send Code';
        toggleBtn.textContent = 'Back to sign in';
        passwordField.style.display = 'none';
        forgotBtn.style.display = 'none';
        guestBtn.style.display = 'none';
        emailHint.style.display = 'flex';
    } else if (authMode === 'reset-verify') {
        title.textContent = 'Enter your code';
        subtitle.textContent = `We emailed a 6-digit code to ${escapeHtml(resetEmail)}.`;
        primaryBtn.textContent = 'Verify Code';
        toggleBtn.textContent = 'Back to sign in';
        emailField.style.display = 'none';
        forgotBtn.style.display = 'none';
        guestBtn.style.display = 'none';
        passwordLabel.textContent = 'Code';
        passwordInput.type = 'text';
        passwordInput.inputMode = 'numeric';
        passwordInput.maxLength = 6;
        passwordInput.autocomplete = 'one-time-code';
        passwordInput.placeholder = '6-digit code';
    } else if (authMode === 'reset-confirm') {
        title.textContent = 'Set a new password';
        subtitle.textContent = 'Choose a new password for your account.';
        primaryBtn.textContent = 'Update Password';
        emailField.style.display = 'none';
        forgotBtn.style.display = 'none';
        toggleBtn.style.display = 'none';
        guestBtn.style.display = 'none';
        passwordLabel.textContent = 'New password';
        passwordInput.autocomplete = 'new-password';
    } else {
        title.textContent = 'Welcome back';
        subtitle.textContent = 'Sign in to sync your routine across devices.';
        primaryBtn.textContent = 'Sign In';
        toggleBtn.textContent = "Don't have an account? Sign up";
    }
}

function toggleAuthMode() {
    authMode = (authMode === 'signin') ? 'signup' : 'signin';
    renderAuthMode();
}

function handleForgotPassword() {
    authMode = 'reset-request';
    renderAuthMode();
}

function enterResetConfirmMode() {
    document.getElementById('auth-overlay').style.display = 'flex';
    document.getElementById('app-container').style.display = 'none';
    authMode = 'reset-confirm';
    renderAuthMode();
}

async function handleAuthSubmit() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    clearAuthMessage();

    // ---- Requesting a reset code (only needs an email) ----
    if (authMode === 'reset-request') {
        if (!email) {
            showAuthMessage('Enter your account email.', 'error');
            return;
        }
        setAuthLoading(true);
        try {
            // No redirectTo here — we want Supabase to send the 6-digit
            // code rather than a magic link.
            const { error } = await sb.auth.resetPasswordForEmail(email);
            if (error) throw error;
            resetEmail = email;
            authMode = 'reset-verify';
            renderAuthMode();
            showAuthMessage('Check your email for a 6-digit code.', 'success');
        } catch (e) {
            showAuthMessage(e.message || 'Could not send reset email. Try again.', 'error');
        } finally {
            setAuthLoading(false);
        }
        return;
    }

    // ---- Verifying the code from the email ----
    if (authMode === 'reset-verify') {
        const token = password.trim();
        if (!token || token.length !== 6) {
            showAuthMessage('Enter the 6-digit code from your email.', 'error');
            return;
        }
        setAuthLoading(true);
        try {
            const { error } = await sb.auth.verifyOtp({
                email: resetEmail,
                token,
                type: 'recovery'
            });
            if (error) throw error;
            authMode = 'reset-confirm';
            renderAuthMode();
        } catch (e) {
            showAuthMessage(e.message || 'Invalid or expired code. Try again.', 'error');
        } finally {
            setAuthLoading(false);
        }
        return;
    }

    // ---- Setting a new password after clicking the email link ----
    if (authMode === 'reset-confirm') {
        if (!password || password.length < 6) {
            showAuthMessage('New password must be at least 6 characters.', 'error');
            return;
        }
        setAuthLoading(true);
        try {
            const { error } = await sb.auth.updateUser({ password });
            if (error) throw error;
            showAuthMessage('Password updated. Signing you in…', 'success');
            resetEmail = '';
            const { data: { session } } = await sb.auth.getSession();
            authMode = 'signin';
            if (session && session.user) await enterApp(session.user);
        } catch (e) {
            showAuthMessage(e.message || 'Could not update password. Try again.', 'error');
        } finally {
            setAuthLoading(false);
        }
        return;
    }

    // ---- Normal sign in / sign up ----
    if (!email || !password) {
        showAuthMessage('Enter both an email and password.', 'error');
        return;
    }
    if (password.length < 6) {
        showAuthMessage('Password must be at least 6 characters.', 'error');
        return;
    }

    setAuthLoading(true);
    try {
        if (authMode === 'signup') {
            const { data, error } = await sb.auth.signUp({ email, password });
            if (error) throw error;
            if (data.session) {
                await enterApp(data.session.user);
            } else {
                showAuthMessage('Check your email to confirm your account, then sign in.', 'success');
            }
        } else {
            const { data, error } = await sb.auth.signInWithPassword({ email, password });
            if (error) throw error;
            await enterApp(data.user);
        }
    } catch (e) {
        showAuthMessage(e.message || 'Something went wrong. Try again.', 'error');
    } finally {
        setAuthLoading(false);
    }
}

async function handleSignOut() {
    await sb.auth.signOut();
    currentUser = null;
    authMode = 'signin';
    renderAuthMode();
    clearGreeting();
    showAuthScreen();
}

function setAuthLoading(isLoading) {
    document.getElementById('auth-loading').style.display = isLoading ? 'flex' : 'none';
    document.getElementById('auth-primary-btn').disabled = isLoading;
    document.getElementById('auth-toggle-mode-btn').disabled = isLoading;
}

function showAuthMessage(message, kind) {
    const el = document.getElementById('auth-message');
    el.textContent = message;
    el.className = 'auth-message ' + kind;
}

function clearAuthMessage() {
    const el = document.getElementById('auth-message');
    el.textContent = '';
    el.className = 'auth-message';
}
