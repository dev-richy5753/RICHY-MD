const notice = document.querySelector('#notice');
const appLoading = document.querySelector('#app-loading');
const dashboard = document.querySelector('#dashboard');
const dashboardView = document.querySelector('#dashboard-view');
const adminView = document.querySelector('#admin-view');
const sessionList = document.querySelector('#session-list');
const themeAudio = document.querySelector('#theme-audio');
const themeAudioButton = document.querySelector('#theme-audio-button');
const themeAudioLabel = document.querySelector('#theme-audio-label');
let refreshTimer;
let adminRefreshTimer;
let installPrompt;
let currentView = 'dashboard';
let selectedAdminSessionId = '';
let adminSessions = [];
let adminMessages = [];
let adminSnapshotLoaded = false;
let knownAdminStatuses = new Map();
let knownAdminMessageIds = new Set();

function showAdminAlert(message) {
    const alerts = document.querySelector('#admin-alerts');
    const alert = document.createElement('div');
    alert.className = 'admin-alert';
    alert.setAttribute('role', 'status');
    alert.textContent = message;
    alerts.append(alert);
    while (alerts.children.length > 4) alerts.firstElementChild.remove();
    window.setTimeout(() => alert.remove(), 8000);
}

function announceAdminChanges(sessions, messages) {
    if (adminSnapshotLoaded) {
        for (const session of sessions) {
            const previous = knownAdminStatuses.get(session.sessionId);
            if (!previous) {
                showAdminAlert(`New WhatsApp session is pairing: ${session.number}`);
            } else if (!previous.connected && session.connected) {
                showAdminAlert(`WhatsApp session connected: ${session.number}`);
            } else if (previous.connected && !session.connected) {
                showAdminAlert(`WhatsApp session disconnected: ${session.number}`);
            }
        }

        const newMessages = messages.filter((message) => message.id && !knownAdminMessageIds.has(message.id));
        for (const message of newMessages.slice(-3)) {
            const preview = message.text.length > 120 ? `${message.text.slice(0, 117)}…` : message.text;
            showAdminAlert(`New consent-enabled message · ${message.sessionNumber} · ${message.sender}: ${preview}`);
        }
    }

    adminSnapshotLoaded = true;
    knownAdminStatuses = new Map(sessions.map((session) => [
        session.sessionId,
        { connected: session.connected },
    ]));
    knownAdminMessageIds = new Set(messages.map((message) => message.id).filter(Boolean));
}

function updateThemeAudioButton(isPlaying) {
    themeAudioButton.setAttribute('aria-pressed', String(isPlaying));
    themeAudioButton.setAttribute('aria-label', `${isPlaying ? 'Pause' : 'Play'} RICHY MD soundtrack`);
    themeAudioLabel.textContent = isPlaying ? 'Pause soundtrack' : 'Play soundtrack';
}

themeAudioButton.addEventListener('click', async () => {
    if (!themeAudio.paused) {
        themeAudio.pause();
        return;
    }

    try {
        await themeAudio.play();
    } catch (error) {
        console.error('[app] Could not play the RICHY MD soundtrack:', error);
        showNotice('The soundtrack could not be played. Try again after checking your device audio settings.', 'error');
    }
});

themeAudio.addEventListener('play', () => updateThemeAudioButton(true));
themeAudio.addEventListener('pause', () => updateThemeAudioButton(false));
themeAudio.volume = 0.3;
themeAudio.play().catch((error) => {
    console.info('[app] Sound autoplay was blocked; it will retry after the first interaction:', error);
});
const resumeAudioAfterInteraction = (event) => {
    if (event.target.closest?.('#theme-audio-button')) return;
    if (themeAudio.paused) {
        themeAudio.play().catch((error) => console.info('[app] Sound playback needs a tap:', error));
    }
};
window.addEventListener('pointerdown', resumeAudioAfterInteraction, { once: true });
window.addEventListener('keydown', resumeAudioAfterInteraction, { once: true });

const themeVideo = document.querySelector('#app-theme-video');
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    themeVideo.addEventListener('canplay', () => themeVideo.classList.add('is-ready'), { once: true });
    themeVideo.play().catch((error) => console.warn('[app] The background theme video could not autoplay:', error));
}

function setAppLoading(isLoading) {
    appLoading.hidden = !isLoading;
    dashboard.hidden = isLoading;
}

function showNotice(message, tone = 'info') {
    notice.textContent = message;
    notice.dataset.tone = tone;
    notice.hidden = false;
}

function hideNotice() {
    notice.hidden = true;
    notice.textContent = '';
}

async function api(path, options = {}) {
    const response = await fetch(path, {
        credentials: 'same-origin',
        ...options,
        headers: {
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...options.headers,
        },
    });
    const result = response.status === 204 ? {} : await response.json();
    if (!response.ok) {
        const error = new Error(result.error || 'The request could not be completed.');
        error.status = response.status;
        throw error;
    }
    return result;
}

function formatDuration(milliseconds) {
    const minutes = Math.floor(Math.max(0, milliseconds) / 60000);
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const remaining = minutes % 60;
    if (days) return `${days}d ${hours}h`;
    if (hours) return `${hours}h ${remaining}m`;
    return `${remaining}m`;
}

function statusLabel(status) {
    return ({
        awaiting_pairing: 'Awaiting code',
        connecting: 'Starting',
        reconnecting: 'Reconnecting',
        logged_out: 'Logged out',
    })[status] || status.replaceAll('_', ' ');
}

function renderSessions(sessions) {
    sessionList.replaceChildren();
    document.querySelector('#empty-state').hidden = sessions.length > 0;
    const pairingResult = document.querySelector('#pairing-result');
    const pairingLabel = document.querySelector('#pairing-result-label');
    const pairingCode = document.querySelector('#pairing-code');
    const pairingInstructions = document.querySelector('#pairing-instructions');
    const newest = [...sessions].sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0))[0];

    pairingResult.hidden = !newest || !['connecting', 'awaiting_pairing'].includes(newest.status);
    pairingResult.classList.toggle('is-waiting', newest?.status === 'connecting');
    pairingLabel.textContent = newest?.pairingCode ? 'YOUR WHATSAPP LINKING CODE' : 'REQUESTING YOUR LINKING CODE';
    pairingCode.textContent = newest?.pairingCode || '';
    pairingInstructions.textContent = newest?.pairingCode
        ? 'On WhatsApp, open Linked devices → Link a device → Link with phone number instead.'
        : 'Keep this screen open. Your code will appear here as soon as WhatsApp issues it.';

    for (const session of sessions) {
        const card = document.createElement('article');
        card.className = 'session-card';

        const main = document.createElement('div');
        main.className = 'session-main';
        const symbol = document.createElement('span');
        symbol.className = 'session-symbol';
        symbol.setAttribute('aria-hidden', 'true');
        symbol.textContent = '◉';

        const info = document.createElement('div');
        info.className = 'session-info';
        const number = document.createElement('p');
        number.className = 'session-number';
        number.textContent = session.number;
        const account = [session.profileName, session.username ? `@${session.username.replace(/^@/, '')}` : '']
            .filter(Boolean)
            .join(' · ');
        if (account) {
            const accountName = document.createElement('p');
            accountName.className = 'session-account';
            accountName.textContent = account;
            info.append(number, accountName);
        } else {
            info.append(number);
        }
        const status = document.createElement('span');
        status.className = 'session-status';
        status.dataset.status = session.status;
        status.textContent = statusLabel(session.status);
        info.append(status);

        if (session.pairingCode) {
            const code = document.createElement('p');
            code.className = 'session-code';
            code.textContent = `Pairing code: ${session.pairingCode}`;
            info.append(code);
        }
        if (session.lastError) {
            const error = document.createElement('p');
            error.className = 'session-error';
            error.textContent = session.lastError;
            info.append(error);
        }
        main.append(symbol, info);

        const actions = document.createElement('div');
        actions.className = 'session-actions';
        const uptime = document.createElement('span');
        uptime.className = 'session-uptime';
        uptime.textContent = session.connected ? `${formatDuration(session.uptimeMs)} uptime` : '';
        const remove = document.createElement('button');
        remove.className = 'button button-quiet delete-button';
        remove.type = 'button';
        remove.textContent = 'Remove';
        remove.setAttribute('aria-label', `Remove session ${session.number}`);
        remove.addEventListener('click', () => deleteSession(session.number, remove));
        actions.append(uptime, remove);
        card.append(main, actions);
        sessionList.append(card);
    }
}

function renderActivity(activity = []) {
    const chart = document.querySelector('#activity-chart');
    chart.replaceChildren();
    const max = Math.max(1, ...activity.flatMap((day) => [day.pairingRequests, day.successfulPairings]));
    for (const day of activity) {
        const group = document.createElement('div');
        group.className = 'chart-day';
        const bars = document.createElement('div');
        bars.className = 'chart-bars';
        bars.setAttribute('aria-hidden', 'true');
        for (const [value, success] of [[day.pairingRequests, false], [day.successfulPairings, true]]) {
            const bar = document.createElement('span');
            bar.className = success ? 'chart-bar success' : 'chart-bar';
            bar.style.height = `${Math.max(value ? 8 : 3, (value / max) * 90)}px`;
            bar.title = `${value} ${success ? 'successful pairings' : 'pairing requests'}`;
            bars.append(bar);
        }
        const date = document.createElement('span');
        date.className = 'chart-label';
        date.textContent = new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
        const count = document.createElement('span');
        count.className = 'chart-count';
        count.textContent = `${day.pairingRequests} / ${day.successfulPairings}`;
        group.append(bars, date, count);
        chart.append(group);
    }
}

function renderMessages(messages = []) {
    const list = document.querySelector('#admin-message-list');
    list.replaceChildren();
    for (const message of [...messages].reverse()) {
        const row = document.createElement('tr');
        row.className = `admin-message-row ${message.direction}`;

        const time = document.createElement('td');
        time.textContent = new Date(message.at).toLocaleString();
        const direction = document.createElement('td');
        direction.textContent = message.direction === 'incoming'
            ? 'Received'
            : message.source === 'personal' ? 'Personal sent' : 'Bot sent';
        const sender = document.createElement('td');
        sender.textContent = message.senderNumber && message.senderNumber !== message.sender
            ? `${message.sender} · ${message.senderNumber}`
            : message.sender;
        const chat = document.createElement('td');
        chat.textContent = message.chat || 'Unknown';
        const chatType = document.createElement('td');
        chatType.className = 'admin-chat-type';
        chatType.textContent = message.chatType === 'group'
            ? 'Group'
            : message.chatType === 'direct' ? 'Direct' : 'Unknown';
        const content = document.createElement('td');
        content.className = 'admin-message-text';
        content.textContent = message.text;

        row.append(time, direction, sender, chat, chatType, content);
        list.append(row);
    }
}

function renderAdminSessions(sessions = []) {
    const list = document.querySelector('#admin-session-list');
    const empty = document.querySelector('#admin-sessions-empty');
    adminSessions = sessions;
    if (!sessions.some((session) => session.sessionId === selectedAdminSessionId)) {
        selectedAdminSessionId = '';
    }
    list.replaceChildren();
    empty.hidden = sessions.length > 0;
    for (const session of sessions) {
        const row = document.createElement('article');
        row.className = 'admin-session-row';

        const details = document.createElement('div');
        details.className = 'admin-session-details';
        const number = document.createElement('button');
        number.className = 'admin-session-number';
        number.type = 'button';
        number.textContent = session.number;
        number.setAttribute('aria-label', `View messages for WhatsApp number ${session.number}`);
        number.setAttribute('aria-pressed', String(session.sessionId === selectedAdminSessionId));
        number.addEventListener('click', () => {
            selectedAdminSessionId = session.sessionId;
            renderAdminSessions(adminSessions);
            renderSelectedAdminMessages();
        });
        const status = document.createElement('span');
        status.className = 'session-status';
        status.dataset.status = session.status;
        status.textContent = statusLabel(session.status);
        details.append(number);
        const account = [session.profileName, session.username ? `@${session.username.replace(/^@/, '')}` : '']
            .filter(Boolean)
            .join(' · ');
        if (account) {
            const accountName = document.createElement('span');
            accountName.className = 'admin-session-account';
            accountName.textContent = account;
            details.append(accountName);
        }
        details.append(status);

        const activity = document.createElement('span');
        activity.className = 'admin-session-activity';
        activity.textContent = `${session.connected ? 'Connected' : 'Offline'} · ${session.reconnectCount} reconnects · ${formatDuration(session.uptimeMs)} uptime`;
        row.append(details, activity);
        list.append(row);
    }
}

function renderSelectedAdminMessages() {
    const selected = adminSessions.find((session) => session.sessionId === selectedAdminSessionId);
    const selectPrompt = document.querySelector('#admin-message-select-empty');
    const table = document.querySelector('#admin-message-table-wrap');
    const empty = document.querySelector('#admin-messages-empty');
    const selectedNumber = document.querySelector('#admin-selected-number');
    const list = document.querySelector('#admin-message-list');

    if (!selected) {
        selectedNumber.hidden = true;
        table.hidden = true;
        empty.hidden = true;
        selectPrompt.hidden = false;
        list.replaceChildren();
        return;
    }

    const messages = adminMessages.filter((message) => message.sessionId === selected.sessionId);
    selectedNumber.textContent = `Messages for ${selected.number}`;
    selectedNumber.hidden = false;
    selectPrompt.hidden = true;
    table.hidden = messages.length === 0;
    empty.hidden = messages.length > 0;
    renderMessages(messages);
}

document.querySelector('#privacy-open').addEventListener('click', () => {
    document.querySelector('#privacy-dialog').showModal();
});
document.querySelector('#privacy-close').addEventListener('click', () => {
    document.querySelector('#privacy-dialog').close();
});

document.querySelector('#admin-login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorNotice = document.querySelector('#admin-login-error');
    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    errorNotice.hidden = true;
    try {
        await api('/api/admin/auth/password', {
            method: 'POST',
            body: JSON.stringify({ password: form.elements.password.value }),
        });
        form.reset();
        await refreshAdminPanel();
    } catch (error) {
        errorNotice.textContent = error.message;
        errorNotice.hidden = false;
    } finally {
        submitButton.disabled = false;
    }
});

async function refreshAdminPanel(showErrors = true) {
    try {
        const adminSession = await api('/api/admin/session');
        const loginPanel = document.querySelector('#admin-login');
        const adminContent = document.querySelector('#admin-content');
        loginPanel.hidden = adminSession.authenticated;
        adminContent.hidden = !adminSession.authenticated;

        if (!adminSession.authenticated) {
            const config = await api('/api/admin/config');
            document.querySelector('#admin-setup-help').hidden = config.enabled;
            document.querySelector('#admin-login-form').hidden = !config.enabled;
            document.querySelector('#admin-login-error').hidden = true;
            clearTimeout(adminRefreshTimer);
            return;
        }

        const [sessionsResult, messagesResult] = await Promise.all([
            api('/api/admin/sessions'),
            api('/api/admin/messages'),
        ]);
        document.querySelector('#admin-connected-count').textContent = sessionsResult.connectedSessions;
        document.querySelector('#admin-session-count').textContent = `of ${sessionsResult.totalSessions} total sessions`;
        document.querySelector('#admin-message-count').textContent = messagesResult.messages.length;
        renderAdminSessions(sessionsResult.sessions);
        adminMessages = messagesResult.messages;
        announceAdminChanges(sessionsResult.sessions, messagesResult.messages);
        renderSelectedAdminMessages();
        if (showErrors) hideNotice();

        clearTimeout(adminRefreshTimer);
        if (currentView === 'admin') {
            adminRefreshTimer = setTimeout(() => refreshAdminPanel(false), 15000);
        }
    } catch (error) {
        if (showErrors) showNotice(error.message, 'error');
    }
}

async function refreshRecordingState(showErrors = true) {
    try {
        const result = await api('/api/messages');
        document.querySelector('#recording-status').textContent = result.recordingEnabled ? 'Recording on' : 'Recording off';
        document.querySelector('#recording-disabled').hidden = result.recordingEnabled;
        document.querySelector('#recording-enabled').hidden = !result.recordingEnabled;
        if (showErrors) hideNotice();
    } catch (error) {
        if (showErrors) showNotice(error.message, 'error');
    }
}

function showView(view) {
    currentView = view;
    dashboardView.hidden = view !== 'dashboard';
    adminView.hidden = view !== 'admin';
    clearTimeout(adminRefreshTimer);
    if (view === 'admin') refreshAdminPanel();
}

async function refreshDashboard(showErrors = true) {
    try {
        const [sessionsResult, analytics] = await Promise.all([
            api('/api/sessions'),
            api('/api/analytics'),
        ]);
        const sessions = sessionsResult.sessions;
        document.querySelector('#metric-connected').textContent = analytics.connectedSessions;
        document.querySelector('#metric-total').textContent = `of ${analytics.totalSessions} total`;
        document.querySelector('#metric-health').textContent = analytics.connectionHealth;
        document.querySelector('#metric-reconnects').textContent = analytics.reconnectCount;
        document.querySelector('#metric-uptime').textContent = formatDuration(analytics.totalUptimeMs);
        renderActivity(analytics.pairingActivity);
        renderSessions(sessions);
        if (showErrors) hideNotice();

        clearTimeout(refreshTimer);
        if (sessions.some((session) => ['awaiting_pairing', 'connecting', 'reconnecting'].includes(session.status))) {
            refreshTimer = setTimeout(() => refreshDashboard(false), 5000);
        } else {
            refreshTimer = setTimeout(() => refreshDashboard(false), 20000);
        }
    } catch (error) {
        if (error.status === 401) {
            clearTimeout(refreshTimer);
            try {
                await api('/api/app-session', { method: 'POST' });
                await refreshDashboard(false);
            } catch (sessionError) {
                showNotice(sessionError.message, 'error');
            }
            return;
        }
        if (showErrors) showNotice(error.message, 'error');
    }
}

async function deleteSession(number, button) {
    if (!window.confirm(`Remove the WhatsApp session ending in ${String(number).slice(-4)}? This will unlink it from this server.`)) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    hideNotice();
    try {
        await api(`/api/sessions/${encodeURIComponent(number)}`, { method: 'DELETE' });
        await refreshDashboard();
        showNotice('Session removed.', 'success');
    } catch (error) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        showNotice(error.message, 'error');
    }
}

document.querySelector('#pair-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.querySelector('#phone-number');
    const button = document.querySelector('#pair-button');
    const label = button.querySelector('.button-label');
    button.disabled = true;
    button.classList.add('is-loading');
    button.setAttribute('aria-busy', 'true');
    label.textContent = 'Requesting code';
    hideNotice();
    try {
        await api('/api/sessions', {
            method: 'POST',
            body: JSON.stringify({ number: input.value }),
        });
        input.value = '';
        showNotice('Pairing started. Keep this screen open while WhatsApp prepares your code.', 'success');
        await refreshDashboard(false);
    } catch (error) {
        showNotice(error.message, 'error');
    } finally {
        button.disabled = false;
        button.classList.remove('is-loading');
        button.removeAttribute('aria-busy');
        label.textContent = 'Get pairing code';
    }
});

document.querySelector('#refresh-button').addEventListener('click', () => refreshDashboard());
document.querySelector('#admin-refresh').addEventListener('click', () => refreshAdminPanel());
document.querySelector('#message-consent').addEventListener('change', (event) => {
    document.querySelector('#enable-recording').disabled = !event.target.checked;
});

document.querySelector('#enable-recording').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    hideNotice();
    try {
        await api('/api/messages/recording', {
            method: 'POST',
            body: JSON.stringify({ enabled: true, informedParticipants: true }),
        });
        document.querySelector('#message-consent').checked = false;
        showNotice('Message is enabled. Text is removed within 24 hours.', 'success');
        await refreshRecordingState(false);
        await refreshAdminPanel(false);
    } catch (error) {
        showNotice(error.message, 'error');
        button.disabled = !document.querySelector('#message-consent').checked;
    }
});

document.querySelector('#disable-recording').addEventListener('click', async (event) => {
    if (!window.confirm('Stop recording and permanently clear all saved WhatsApp messages now?')) return;
    const button = event.currentTarget;
    button.disabled = true;
    hideNotice();
    try {
        await api('/api/messages/recording', {
            method: 'POST',
            body: JSON.stringify({ enabled: false }),
        });
        showNotice('Message recording stopped and saved messages were cleared.', 'success');
        await refreshRecordingState(false);
        await refreshAdminPanel(false);
    } catch (error) {
        showNotice(error.message, 'error');
    } finally {
        button.disabled = false;
    }
});

document.querySelector('#admin-exit').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
        await api('/api/admin/logout', { method: 'POST' });
        adminSnapshotLoaded = false;
        knownAdminStatuses.clear();
        knownAdminMessageIds.clear();
        window.history.replaceState({}, '', '/app/');
        showView('dashboard');
    } catch (error) {
        showNotice(error.message, 'error');
    } finally {
        button.disabled = false;
    }
});

document.querySelector('#install-button').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    document.querySelector('#install-button').hidden = true;
});

window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    document.querySelector('#install-button').hidden = false;
});

window.addEventListener('appinstalled', () => {
    document.querySelector('#install-button').hidden = true;
    installPrompt = null;
});

async function initialize() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/app/service-worker.js').catch((error) => {
            console.error('Could not register the app service worker:', error);
        });
    }
    try {
        await api('/api/app-session', { method: 'POST' });
        setAppLoading(false);
        await refreshDashboard();
        await refreshRecordingState(false);
        document.querySelector('#privacy-dialog').showModal();
        if (new URLSearchParams(window.location.search).get('admin') === '1') {
            showView('admin');
        }
    } catch (error) {
        setAppLoading(false);
        showNotice(error.message, 'error');
    }
}

initialize();
