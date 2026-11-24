const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { once } = require('node:events');
const test = require('node:test');

const { createAppApi, validateTelegramLogin } = require('../telegram-bot/app-api');

const BOT_TOKEN = 'test-token-for-signing';

function signedTelegramData(id, firstName = 'Test User') {
    const data = {
        id,
        first_name: firstName,
        auth_date: Math.floor(Date.now() / 1000),
    };
    const dataCheckString = Object.entries(data)
        .map(([key, value]) => `${key}=${value}`)
        .sort((left, right) => {
            const leftKey = left.slice(0, left.indexOf('='));
            const rightKey = right.slice(0, right.indexOf('='));
            return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
        })
        .join('\n');
    const secretKey = crypto.createHash('sha256').update(BOT_TOKEN).digest();
    const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    return { ...data, hash };
}

function createStore() {
    const sessions = new Map();
    const events = [];
    const messageRecording = new Set();
    const messagesByOwner = new Map();
    const allMessages = () => [...messagesByOwner.values()].flat();
    return {
        getSession: (number) => sessions.get(number),
        setSession(number, patch) {
            const session = { ...(sessions.get(number) || {}), ...patch };
            sessions.set(number, session);
            return session;
        },
        deleteSession(number) {
            sessions.delete(number);
            for (const [ownerId, messages] of messagesByOwner) {
                messagesByOwner.set(ownerId, messages.filter((message) => message.sessionNumber !== number));
            }
        },
        sessionsForUser(userId) {
            return [...sessions].filter(([, session]) => session.appOwnerId === userId || session.telegramUserId === userId)
                .map(([number, session]) => ({ number, ...session }));
        },
        allSessions() {
            return Object.fromEntries(sessions);
        },
        recordAppEvent(telegramUserId, type, at = Date.now()) {
            events.push({ ownerId: telegramUserId, type, at });
        },
        appEventsForUser(userId, since = 0) {
            return events.filter((event) => (event.ownerId ?? event.telegramUserId) === userId && event.at >= since);
        },
        isMessageRecordingEnabled: (userId) => messageRecording.has(userId),
        setMessageRecording(userId, enabled) {
            if (enabled) messageRecording.add(userId);
            else {
                messageRecording.delete(userId);
                messagesByOwner.delete(userId);
            }
        },
        recordAppMessage(userId, sessionNumber, message) {
            if (!messageRecording.has(userId)) return false;
            const messages = messagesByOwner.get(userId) || [];
            messages.push({
                id: `message-${messages.length}`,
                ownerId: userId,
                sessionNumber,
                consentVersion: 2,
                source: message.direction === 'outgoing' ? 'bot' : 'contact',
                ...message,
            });
            messagesByOwner.set(userId, messages);
            return true;
        },
        appMessagesForUser(userId) {
            return (messagesByOwner.get(userId) || [])
                .map(({ ownerId: _ownerId, ...message }) => message);
        },
        allAppMessages() {
            return allMessages().map(({ ownerId: _ownerId, ...message }) => message);
        },
    };
}

function createEngine() {
    const running = new Set();
    const paired = new Set();
    const connected = new Set();
    const callbacks = new Map();
    return {
        callbacks,
        setConnected(number, value) {
            if (value) connected.add(number);
            else connected.delete(number);
        },
        async startSession(number, options) {
            running.add(number);
            callbacks.set(number, options);
            return {};
        },
        async removeSession(number) {
            running.delete(number);
            paired.delete(number);
            connected.delete(number);
        },
        isRunning: (number) => running.has(number),
        isPaired: (number) => paired.has(number),
        isConnected: (number) => connected.has(number),
    };
}

async function createApiServer(t, options = {}) {
    const store = createStore();
    const engine = createEngine();
    const api = createAppApi({
        botToken: BOT_TOKEN,
        botUsername: 'richy_md_bot',
        adminPassword: 'test-admin-password',
        store,
        engine,
        ...options,
    });
    const server = http.createServer((request, response) => {
        void api(request, response, new URL(request.url, 'http://localhost').pathname);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const address = server.address();
    return { baseUrl: `http://127.0.0.1:${address.port}`, store, engine };
}

async function signIn(baseUrl, id) {
    const response = await fetch(`${baseUrl}/api/auth/telegram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl },
        body: JSON.stringify(signedTelegramData(id)),
    });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
}

async function signInAdmin(baseUrl, password) {
    return fetch(`${baseUrl}/api/admin/auth/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl },
        body: JSON.stringify({ password }),
    });
}

test('Telegram login verifies the Bot API signature and freshness', () => {
    const data = signedTelegramData(123456);
    assert.deepEqual(validateTelegramLogin(data, BOT_TOKEN), {
        id: 123456,
        firstName: 'Test User',
        username: '',
    });
    assert.equal(validateTelegramLogin({ ...data, first_name: 'Forged' }, BOT_TOKEN), null);
    assert.equal(validateTelegramLogin(data, 'different-token'), null);
    assert.equal(validateTelegramLogin({
        ...data,
        auth_date: Math.floor(Date.now() / 1000) - 6 * 60,
    }, BOT_TOKEN), null);
});

test('pairing sessions and analytics are isolated to the signed-in Telegram user', async (t) => {
    const { baseUrl, engine } = await createApiServer(t);
    const config = await fetch(`${baseUrl}/api/config`).then((response) => response.json());
    assert.deepEqual(config, { appEnabled: true });

    const unauthenticated = await fetch(`${baseUrl}/api/sessions`);
    assert.equal(unauthenticated.status, 401);

    const firstCookie = await signIn(baseUrl, 12001);
    const number = '14155550123';
    const createResponse = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl, Cookie: firstCookie },
        body: JSON.stringify({ number: `+${number}` }),
    });
    assert.equal(createResponse.status, 202);

    const rateLimited = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl, Cookie: firstCookie },
        body: JSON.stringify({ number: '14155550124' }),
    });
    assert.equal(rateLimited.status, 429);

    engine.callbacks.get(number).onPairingCode('ABCD-EFGH');
    const firstSessions = await fetch(`${baseUrl}/api/sessions`, {
        headers: { Cookie: firstCookie },
    }).then((response) => response.json());
    assert.equal(firstSessions.sessions.length, 1);
    assert.equal(firstSessions.sessions[0].pairingCode, 'ABCD-EFGH');
    assert.equal(firstSessions.sessions[0].status, 'awaiting_pairing');

    const secondCookie = await signIn(baseUrl, 22002);
    const secondSessions = await fetch(`${baseUrl}/api/sessions`, {
        headers: { Cookie: secondCookie },
    }).then((response) => response.json());
    assert.deepEqual(secondSessions.sessions, []);

    const secondAnalytics = await fetch(`${baseUrl}/api/analytics`, {
        headers: { Cookie: secondCookie },
    }).then((response) => response.json());
    assert.equal(secondAnalytics.totalSessions, 0);
    assert.equal(JSON.stringify(secondAnalytics).includes(number), false);

    const forbiddenDelete = await fetch(`${baseUrl}/api/sessions/${number}`, {
        method: 'DELETE',
        headers: { Origin: baseUrl, Cookie: secondCookie },
    });
    assert.equal(forbiddenDelete.status, 404);

    engine.setConnected(number, true);
    engine.callbacks.get(number).onConnected(true, { profileName: 'Richy', username: 'ezihe' });
    engine.setConnected(number, false);
    engine.callbacks.get(number).onDisconnected();
    engine.setConnected(number, true);
    engine.callbacks.get(number).onConnected();

    const connectedSessions = await fetch(`${baseUrl}/api/sessions`, {
        headers: { Cookie: firstCookie },
    }).then((response) => response.json());
    assert.deepEqual({
        number: connectedSessions.sessions[0].number,
        profileName: connectedSessions.sessions[0].profileName,
        username: connectedSessions.sessions[0].username,
    }, { number, profileName: 'Richy', username: 'ezihe' });

    const firstAnalytics = await fetch(`${baseUrl}/api/analytics`, {
        headers: { Cookie: firstCookie },
    }).then((response) => response.json());
    assert.equal(firstAnalytics.connectedSessions, 1);
    assert.equal(firstAnalytics.reconnectCount, 1);
    assert.equal(firstAnalytics.pairingActivity.reduce((sum, day) => sum + day.pairingRequests, 0), 1);
    assert.equal(firstAnalytics.pairingActivity.reduce((sum, day) => sum + day.successfulPairings, 0), 1);
    assert.equal(JSON.stringify(firstAnalytics).includes(number), false);
});

test('pairing API rejects cross-origin requests and invalid phone numbers', async (t) => {
    const { baseUrl } = await createApiServer(t);
    const cookie = await signIn(baseUrl, 98765);
    const crossOrigin = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://other.example', Cookie: cookie },
        body: JSON.stringify({ number: '14155550123' }),
    });
    assert.equal(crossOrigin.status, 403);

    const invalidNumber = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl, Cookie: cookie },
        body: JSON.stringify({ number: '123' }),
    });
    assert.equal(invalidNumber.status, 400);
});

test('the app can pair without Telegram and keeps browser sessions isolated', async (t) => {
    const { baseUrl, engine, store } = await createApiServer(t);
    const startSession = (origin = baseUrl) => fetch(`${baseUrl}/api/app-session`, {
        method: 'POST',
        headers: { Origin: origin },
    });
    const firstInit = await startSession();
    assert.equal(firstInit.status, 200);
    assert.match(firstInit.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
    const firstCookie = firstInit.headers.get('set-cookie').split(';')[0];

    const number = '14155550123';
    const pair = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl, Cookie: firstCookie },
        body: JSON.stringify({ number }),
    });
    assert.equal(pair.status, 202);
    engine.callbacks.get(number).onPairingCode('ABCD-EFGH');

    const reusedInit = await fetch(`${baseUrl}/api/app-session`, {
        method: 'POST',
        headers: { Origin: baseUrl, Cookie: firstCookie },
    });
    assert.equal(reusedInit.status, 200);
    assert.equal(reusedInit.headers.get('set-cookie'), null);

    const ownSessions = await fetch(`${baseUrl}/api/sessions`, {
        headers: { Cookie: firstCookie },
    }).then((response) => response.json());
    assert.equal(ownSessions.sessions[0].pairingCode, 'ABCD-EFGH');

    const secondInit = await startSession();
    const secondCookie = secondInit.headers.get('set-cookie').split(';')[0];
    const otherSessions = await fetch(`${baseUrl}/api/sessions`, {
        headers: { Cookie: secondCookie },
    }).then((response) => response.json());
    assert.deepEqual(otherSessions.sessions, []);
    const otherDelete = await fetch(`${baseUrl}/api/sessions/${number}`, {
        method: 'DELETE',
        headers: { Origin: baseUrl, Cookie: secondCookie },
    });
    assert.equal(otherDelete.status, 404);
    const otherPair = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl, Cookie: secondCookie },
        body: JSON.stringify({ number }),
    });
    assert.equal(otherPair.status, 409);

    const removeOwn = await fetch(`${baseUrl}/api/sessions/${number}`, {
        method: 'DELETE',
        headers: { Origin: baseUrl, Cookie: firstCookie },
    });
    assert.equal(removeOwn.status, 200);
    assert.equal(engine.isRunning(number), false);
    const ownSessionsAfterRemove = await fetch(`${baseUrl}/api/sessions`, {
        headers: { Cookie: firstCookie },
    }).then((response) => response.json());
    assert.deepEqual(ownSessionsAfterRemove.sessions, []);
    assert.equal(store.getSession(number), undefined);
    assert.equal(engine.isPaired(number), false);

    const crossOrigin = await startSession('https://other.example');
    assert.equal(crossOrigin.status, 403);
    assert.equal((await fetch(`${baseUrl}/api/sessions`)).status, 401);
});

test('the admin panel can see sessions paired from different browsers', async (t) => {
    const { baseUrl } = await createApiServer(t);
    const firstInit = await fetch(`${baseUrl}/api/app-session`, {
        method: 'POST',
        headers: { Origin: baseUrl },
    });
    const firstCookie = firstInit.headers.get('set-cookie').split(';')[0];
    const secondInit = await fetch(`${baseUrl}/api/app-session`, {
        method: 'POST',
        headers: { Origin: baseUrl },
    });
    const secondCookie = secondInit.headers.get('set-cookie').split(';')[0];

    for (const [cookie, number] of [[firstCookie, '14155550123'], [secondCookie, '14155550124']]) {
        const paired = await fetch(`${baseUrl}/api/sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: baseUrl, Cookie: cookie },
            body: JSON.stringify({ number }),
        });
        assert.equal(paired.status, 202);
    }

    const adminLogin = await signInAdmin(baseUrl, 'test-admin-password');
    const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];
    const adminSessions = await fetch(`${baseUrl}/api/admin/sessions`, {
        headers: { Cookie: adminCookie },
    }).then((response) => response.json());
    assert.deepEqual(adminSessions.sessions.map((session) => session.number).sort(), [
        '14155550123',
        '14155550124',
    ]);

    const firstSessions = await fetch(`${baseUrl}/api/sessions`, {
        headers: { Cookie: firstCookie },
    }).then((response) => response.json());
    assert.deepEqual(firstSessions.sessions.map((session) => session.number), ['14155550123']);
});

test('message analysis requires participant consent, isolates users, and clears data when disabled', async (t) => {
    const { baseUrl, engine } = await createApiServer(t);
    const firstInit = await fetch(`${baseUrl}/api/app-session`, {
        method: 'POST',
        headers: { Origin: baseUrl },
    });
    const firstCookie = firstInit.headers.get('set-cookie').split(';')[0];
    const number = '14155550123';
    const pair = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl, Cookie: firstCookie },
        body: JSON.stringify({ number }),
    });
    assert.equal(pair.status, 202);
    engine.callbacks.get(number).onIncomingMessage({
        direction: 'incoming',
        sender: 'Jamie',
        senderNumber: '14155550999',
        chat: '14155550999',
        text: 'Not recorded while disabled',
        at: Date.now(),
    });

    const initiallyDisabled = await fetch(`${baseUrl}/api/messages`, {
        headers: { Cookie: firstCookie },
    }).then((response) => response.json());
    assert.deepEqual(initiallyDisabled, { recordingEnabled: false });

    const missingConsent = await fetch(`${baseUrl}/api/messages/recording`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl, Cookie: firstCookie },
        body: JSON.stringify({ enabled: true }),
    });
    assert.equal(missingConsent.status, 400);

    const enable = await fetch(`${baseUrl}/api/messages/recording`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl, Cookie: firstCookie },
        body: JSON.stringify({ enabled: true, informedParticipants: true }),
    });
    assert.deepEqual(await enable.json(), { recordingEnabled: true });
    engine.callbacks.get(number).onIncomingMessage({
        direction: 'incoming',
        sender: 'Jamie',
        senderNumber: '14155550999',
        chat: '14155550999',
        text: 'Hello',
        at: Date.now(),
    });
    engine.callbacks.get(number).onOutgoingMessage({
        direction: 'outgoing',
        sender: 'RICHY MD',
        senderNumber: number,
        chat: '14155550999',
        text: 'Hi there',
        at: Date.now(),
    });
    engine.callbacks.get(number).onIncomingMessage({
        direction: 'incoming',
        sender: 'Jamie',
        senderNumber: '14155550999',
        chat: '120363012345678901',
        text: 'Hello group',
        at: Date.now(),
    });

    const firstMessages = await fetch(`${baseUrl}/api/messages`, {
        headers: { Cookie: firstCookie },
    }).then((response) => response.json());
    assert.deepEqual(firstMessages, { recordingEnabled: true });

    const adminLogin = await signInAdmin(baseUrl, 'test-admin-password');
    assert.equal(adminLogin.status, 200);
    const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];
    const adminSessions = await fetch(`${baseUrl}/api/admin/sessions`, {
        headers: { Cookie: adminCookie },
    }).then((response) => response.json());
    assert.equal(adminSessions.sessions.length, 1);
    const selectedSessionId = adminSessions.sessions[0].sessionId;
    assert.equal(typeof selectedSessionId, 'string');
    assert.equal(selectedSessionId.includes(number), false);
    const adminMessages = await fetch(`${baseUrl}/api/admin/messages`, {
        headers: { Cookie: adminCookie },
    }).then((response) => response.json());
    assert.deepEqual(adminMessages.messages.map(({ sender, text, source, sessionId, chatType }) => ({
        sender, text, source, sessionId, chatType,
    })), [
        { sender: 'Jamie', text: 'Hello', source: 'contact', sessionId: selectedSessionId, chatType: 'direct' },
        { sender: 'RICHY MD', text: 'Hi there', source: 'bot', sessionId: selectedSessionId, chatType: 'direct' },
        { sender: 'Jamie', text: 'Hello group', source: 'contact', sessionId: selectedSessionId, chatType: 'group' },
    ]);

    const secondInit = await fetch(`${baseUrl}/api/app-session`, {
        method: 'POST',
        headers: { Origin: baseUrl },
    });
    const secondCookie = secondInit.headers.get('set-cookie').split(';')[0];
    const secondMessages = await fetch(`${baseUrl}/api/messages`, {
        headers: { Cookie: secondCookie },
    }).then((response) => response.json());
    assert.deepEqual(secondMessages, { recordingEnabled: false });

    const disable = await fetch(`${baseUrl}/api/messages/recording`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl, Cookie: firstCookie },
        body: JSON.stringify({ enabled: false }),
    });
    assert.deepEqual(await disable.json(), { recordingEnabled: false });
    const cleared = await fetch(`${baseUrl}/api/messages`, {
        headers: { Cookie: firstCookie },
    }).then((response) => response.json());
    assert.deepEqual(cleared, { recordingEnabled: false });
    const clearedAdminMessages = await fetch(`${baseUrl}/api/admin/messages`, {
        headers: { Cookie: adminCookie },
    }).then((response) => response.json());
    assert.deepEqual(clearedAdminMessages, { messages: [] });
});

test('web-only app sessions work without a Telegram bot token', async (t) => {
    const { baseUrl } = await createApiServer(t, {
        botToken: '',
        sessionKey: 'web-only-test-key',
        adminPassword: 'Ezihe',
    });

    const [config, adminConfig] = await Promise.all([
        fetch(`${baseUrl}/api/config`).then((response) => response.json()),
        fetch(`${baseUrl}/api/admin/config`).then((response) => response.json()),
    ]);
    assert.deepEqual(config, { appEnabled: true });
    assert.equal(adminConfig.enabled, true);

    const adminLogin = await signInAdmin(baseUrl, 'Ezihe');
    assert.equal(adminLogin.status, 200);

    const initialized = await fetch(`${baseUrl}/api/app-session`, {
        method: 'POST',
        headers: { Origin: baseUrl },
    });
    assert.equal(initialized.status, 200);
    const cookie = initialized.headers.get('set-cookie').split(';')[0];
    const sessions = await fetch(`${baseUrl}/api/sessions`, {
        headers: { Cookie: cookie },
    });
    assert.equal(sessions.status, 200);
    assert.deepEqual(await sessions.json(), { sessions: [] });
});

test('admin password access is protected, short-lived, and exposes full session identities', async (t) => {
    const { baseUrl, store, engine } = await createApiServer(t);
    const config = await fetch(`${baseUrl}/api/admin/config`).then((response) => response.json());
    assert.deepEqual(config, { enabled: true });

    const deniedList = await fetch(`${baseUrl}/api/admin/sessions`);
    assert.equal(deniedList.status, 401);

    const appCookie = await signIn(baseUrl, 12001);
    const appLoginCannotAccessAdmin = await fetch(`${baseUrl}/api/admin/sessions`, {
        headers: { Cookie: appCookie },
    });
    assert.equal(appLoginCannotAccessAdmin.status, 401);

    const badPassword = await signInAdmin(baseUrl, 'incorrect-password');
    assert.equal(badPassword.status, 401);
    const crossOriginLogin = await fetch(`${baseUrl}/api/admin/auth/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://other.example' },
        body: JSON.stringify({ password: 'test-admin-password' }),
    });
    assert.equal(crossOriginLogin.status, 403);

    const number = '14155550123';
    const messageOwner = 'a'.repeat(32);
    store.setSession(number, {
        appOwnerId: messageOwner,
        connected: true,
        connectedSince: Date.now() - 60000,
        profileName: 'Richy',
        username: 'ezihe',
        pairingCode: 'NEVER-EXPOSE',
        pairingCodeExpiresAt: Date.now() + 60000,
    });
    engine.setConnected(number, true);
    store.setMessageRecording(messageOwner, true);
    store.recordAppMessage(messageOwner, number, {
        direction: 'incoming',
        sender: 'Jamie',
        senderNumber: '14155550999',
        chat: '14155550999',
        text: 'Opt-in message',
        at: Date.now(),
    });

    const ownerLogin = await signInAdmin(baseUrl, 'test-admin-password');
    assert.equal(ownerLogin.status, 200);
    assert.match(ownerLogin.headers.get('set-cookie'), /^richy_md_admin=.*HttpOnly; SameSite=Strict; Max-Age=3600/);
    const adminCookie = ownerLogin.headers.get('set-cookie').split(';')[0];

    const adminSession = await fetch(`${baseUrl}/api/admin/session`, {
        headers: { Cookie: adminCookie },
    }).then((response) => response.json());
    assert.deepEqual(adminSession, { authenticated: true, firstName: 'Owner' });

    const sessionResult = await fetch(`${baseUrl}/api/admin/sessions`, {
        headers: { Cookie: adminCookie },
    }).then((response) => response.json());
    assert.equal(sessionResult.totalSessions, 1);
    assert.equal(sessionResult.connectedSessions, 1);
    assert.equal(sessionResult.sessions[0].number, number);
    assert.equal(sessionResult.sessions[0].profileName, 'Richy');
    assert.equal(sessionResult.sessions[0].username, 'ezihe');
    assert.equal(typeof sessionResult.sessions[0].sessionId, 'string');
    assert.equal(sessionResult.sessions[0].sessionId.includes(number), false);
    assert.equal('pairingCode' in sessionResult.sessions[0], false);

    const messageResult = await fetch(`${baseUrl}/api/admin/messages`, {
        headers: { Cookie: adminCookie },
    }).then((response) => response.json());
    assert.deepEqual(messageResult.messages.map((message) => message.text), ['Opt-in message']);
    assert.equal(messageResult.messages[0].sessionNumber, `•••• ${number.slice(-4)}`);

    const logout = await fetch(`${baseUrl}/api/admin/logout`, {
        method: 'POST',
        headers: { Origin: baseUrl, Cookie: adminCookie },
    });
    assert.equal(logout.status, 200);
    const afterLogout = await fetch(`${baseUrl}/api/admin/sessions`, {
        headers: { Cookie: adminCookie },
    });
    assert.equal(afterLogout.status, 401);
});

test('admin password login is disabled when unset and rate-limits repeated failures', async (t) => {
    const { baseUrl } = await createApiServer(t, { adminPassword: '' });
    const config = await fetch(`${baseUrl}/api/admin/config`).then((response) => response.json());
    assert.deepEqual(config, { enabled: false });

    const disabledLogin = await fetch(`${baseUrl}/api/admin/auth/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl },
        body: JSON.stringify({ password: 'some-long-password' }),
    });
    assert.equal(disabledLogin.status, 503);

    const limited = await createApiServer(t);
    for (let attempt = 0; attempt < 5; attempt++) {
        const response = await signInAdmin(limited.baseUrl, 'incorrect-password');
        assert.equal(response.status, 401);
    }
    const blocked = await signInAdmin(limited.baseUrl, 'test-admin-password');
    assert.equal(blocked.status, 429);
});
