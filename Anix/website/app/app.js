const notice = document.querySelector('#notice');
const signIn = document.querySelector('#sign-in');
const dashboard = document.querySelector('#dashboard');
const widgetHost = document.querySelector('#telegram-widget');
const sessionList = document.querySelector('#session-list');
let refreshTimer;
let installPrompt;
let telegramBotUsername = '';

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

function loadTelegramWidget(username) {
    window.onTelegramAuth = async (user) => {
        hideNotice();
        try {
            await api('/api/auth/telegram', { method: 'POST', body: JSON.stringify(user) });
            await openDashboard(user);
        } catch (error) {
            showNotice(error.message, 'error');
        }
    };

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.dataset.telegramLogin = username;
    script.dataset.size = 'large';
    script.dataset.radius = '10';
    script.dataset.onauth = 'onTelegramAuth(user)';
    script.addEventListener('error', () => showNotice('Could not load Telegram sign-in. Please check your connection and try again.', 'error'));
    widgetHost.replaceChildren(script);
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
            dashboard.hidden = true;
            signIn.hidden = false;
            if (telegramBotUsername) loadTelegramWidget(telegramBotUsername);
            showNotice('Your sign-in expired. Sign in with Telegram again.', 'error');
            return;
        }
        if (showErrors) showNotice(error.message, 'error');
    }
}

async function openDashboard(user) {
    signIn.hidden = true;
    dashboard.hidden = false;
    const fullName = user.first_name || user.firstName || user.username || 'Telegram user';
    document.querySelector('#account-name').textContent = user.username ? `${fullName} (@${user.username})` : fullName;
    await refreshDashboard();
}

async function deleteSession(number, button) {
    if (!window.confirm(`Remove the WhatsApp session ending in ${String(number).slice(-4)}? This will unlink it from this server.`)) return;
    button.disabled = true;
    hideNotice();
    try {
        await api(`/api/sessions/${encodeURIComponent(number)}`, { method: 'DELETE' });
        await refreshDashboard();
        showNotice('Session removed.', 'success');
    } catch (error) {
        button.disabled = false;
        showNotice(error.message, 'error');
    }
}

document.querySelector('#pair-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.querySelector('#phone-number');
    const button = document.querySelector('#pair-button');
    button.disabled = true;
    hideNotice();
    try {
        await api('/api/sessions', {
            method: 'POST',
            body: JSON.stringify({ number: input.value }),
        });
        input.value = '';
        showNotice('Pairing started. Your code will appear with the session in a moment.', 'success');
        await refreshDashboard(false);
    } catch (error) {
        showNotice(error.message, 'error');
    } finally {
        button.disabled = false;
    }
});

document.querySelector('#refresh-button').addEventListener('click', () => refreshDashboard());
document.querySelector('#logout-button').addEventListener('click', async () => {
    try {
        await api('/api/auth/logout', { method: 'POST' });
        clearTimeout(refreshTimer);
        dashboard.hidden = true;
        signIn.hidden = false;
        if (telegramBotUsername) loadTelegramWidget(telegramBotUsername);
        showNotice('You have signed out.', 'success');
    } catch (error) {
        showNotice(error.message, 'error');
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
        const config = await api('/api/config');
        if (!config.loginEnabled || !config.telegramBotUsername) {
            showNotice('Telegram sign-in is not configured yet. Set TELEGRAM_BOT_USERNAME on the server and configure the bot domain with BotFather.');
            return;
        }
        telegramBotUsername = config.telegramBotUsername;
        const result = await api('/api/me');
        await openDashboard(result.user);
    } catch (error) {
        if (error.message.includes('Sign in with Telegram')) {
            signIn.hidden = false;
            loadTelegramWidget(telegramBotUsername);
            return;
        }
        showNotice(error.message, 'error');
    }
}

initialize();
