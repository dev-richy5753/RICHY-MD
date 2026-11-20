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
    return {
        getSession: (number) => sessions.get(number),
        setSession(number, patch) {
            const session = { ...(sessions.get(number) || {}), ...patch };
            sessions.set(number, session);
            return session;
        },
        deleteSession: (number) => sessions.delete(number),
        sessionsForUser(userId) {
            return [...sessions].filter(([, session]) => session.appOwnerId === userId || session.telegramUserId === userId)
                .map(([number, session]) => ({ number, ...session }));
        },
        recordAppEvent(telegramUserId, type, at = Date.now()) {
            events.push({ ownerId: telegramUserId, type, at });
        },
        appEventsForUser(userId, since = 0) {
            return events.filter((event) => (event.ownerId ?? event.telegramUserId) === userId && event.at >= since);
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
    engine.callbacks.get(number).onConnected();
    engine.setConnected(number, false);
    engine.callbacks.get(number).onDisconnected();
    engine.setConnected(number, true);
    engine.callbacks.get(number).onConnected();

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
    const { baseUrl, engine } = await createApiServer(t);
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

    const crossOrigin = await startSession('https://other.example');
    assert.equal(crossOrigin.status, 403);
    assert.equal((await fetch(`${baseUrl}/api/sessions`)).status, 401);
});
