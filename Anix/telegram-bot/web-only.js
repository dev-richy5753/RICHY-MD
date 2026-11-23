require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const { loadAppSessionSecret } = require('./session-secret');
const path = require('node:path');
const { startHealthServer } = require('./health-server');
const { createAppApi } = require('./app-api');
const store = require('./store');
const {
    startSession,
    removeSession,
    isPaired,
    isRunning,
    isConnected,
    listSavedSessionIds,
} = require('../src/session');

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`[http] Invalid PORT value: ${process.env.PORT}`);
    process.exit(1);
}

const botToken = process.env.BOT_TOKEN || '';
const sessionKey = loadAppSessionSecret();
if (!process.env.APP_SESSION_SECRET) {
    console.warn('[app] APP_SESSION_SECRET is unset; using a persistent local key. Configure it explicitly on hosted deployments.');
}

function callbacksFor(number) {
    const recordMessage = (message) => {
        const ownerId = store.getSession(number)?.appOwnerId;
        if (ownerId && store.isMessageRecordingEnabled(ownerId)) {
            store.recordAppMessage(ownerId, number, message);
        }
    };

    return {
        restored: true,
        onIncomingMessage: recordMessage,
        onOutgoingMessage: recordMessage,
        onConnected: (_isFirstTime, account = {}) => {
            const previous = store.getSession(number) || {};
            const now = Date.now();
            const reconnected = Boolean(previous.connectedAt);
            store.setSession(number, {
                ...(account.profileName ? { profileName: account.profileName } : {}),
                ...(account.username ? { username: account.username } : {}),
                connected: true,
                pairingState: 'connected',
                connectedAt: previous.connectedAt || now,
                connectedSince: now,
                totalUptimeMs: previous.totalUptimeMs || 0,
                reconnectCount: (previous.reconnectCount || 0) + (reconnected ? 1 : 0),
                lastError: '',
            });
            store.recordAppEvent(previous.appOwnerId, reconnected ? 'session_reconnected' : 'pair_connected');
        },
        onDisconnected: () => {
            const previous = store.getSession(number) || {};
            const now = Date.now();
            const accrued = previous.connectedSince ? Math.max(0, now - previous.connectedSince) : 0;
            store.setSession(number, {
                connected: false,
                pairingState: 'reconnecting',
                connectedSince: null,
                totalUptimeMs: (previous.totalUptimeMs || 0) + accrued,
                lastDisconnectedAt: now,
            });
            store.recordAppEvent(previous.appOwnerId, 'session_disconnected', now);
        },
        onLoggedOut: () => {
            const previous = store.getSession(number) || {};
            store.setSession(number, {
                connected: false,
                pairingState: 'logged_out',
                connectedSince: null,
                pairingCode: null,
                pairingCodeExpiresAt: null,
                lastError: 'This WhatsApp session was logged out.',
            });
            store.recordAppEvent(previous.appOwnerId, 'session_logged_out');
        },
        onReplaced: () => {
            store.setSession(number, {
                connected: false,
                pairingState: 'error',
                connectedSince: null,
                lastError: 'This session is also open in another place.',
            });
        },
    };
}

const appApi = createAppApi({
    botToken,
    botUsername: process.env.TELEGRAM_BOT_USERNAME,
    adminPassword: process.env.ADMIN_PASSWORD,
    sessionKey,
    store,
    engine: { startSession, removeSession, isPaired, isRunning, isConnected },
});
const server = startHealthServer(port, appApi);

server.on('listening', () => {
    console.log(`[http] web-only app listening on port ${port}`);
    const savedSessions = listSavedSessionIds().filter((number) => store.getSession(number)?.appOwnerId);
    if (!savedSessions.length) {
        console.log('[app] no app-owned WhatsApp sessions to restore');
        return;
    }

    console.log(`[app] restoring ${savedSessions.length} app-owned WhatsApp session(s)`);
    for (const number of savedSessions) {
        store.setSession(number, { connected: false, connectedSince: null });
        startSession(number, callbacksFor(number)).catch((error) => {
            console.error(`[app] could not restore session ${number}:`, error.message);
        });
    }
});
server.on('error', (error) => {
    console.error('[http] web server failed:', error);
    process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
        console.log(`[http] shutting down after ${signal}`);
        if (server.listening) server.close();
        process.exit(0);
    });
}
