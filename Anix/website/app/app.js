const notice = document.querySelector('#notice');
const appLoading = document.querySelector('#app-loading');
const dashboard = document.querySelector('#dashboard');
const sessionList = document.querySelector('#session-list');
const themeAudio = document.querySelector('#theme-audio');
const themeAudioButton = document.querySelector('#theme-audio-button');
const themeAudioLabel = document.querySelector('#theme-audio-label');
let refreshTimer;
let installPrompt;

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

function maskNumber(number) {
    return `•••• ${String(number).slice(-4)}`;
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
        number.textContent = maskNumber(session.number);
        const status = document.createElement('span');
        status.className = 'session-status';
        status.dataset.status = session.status;
        status.textContent = statusLabel(session.status);
        info.append(number, status);

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
        remove.setAttribute('aria-label', `Remove session ${maskNumber(session.number)}`);
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
    } catch (error) {
        setAppLoading(false);
        showNotice(error.message, 'error');
    }
}

initialize();
