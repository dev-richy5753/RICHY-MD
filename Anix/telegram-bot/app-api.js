const crypto = require('node:crypto');

const COOKIE_NAME = 'richy_md_app';
const ADMIN_COOKIE_NAME = 'richy_md_admin';
const BODY_LIMIT = 8192;
const LOGIN_MAX_AGE_SECONDS = 5 * 60;
const TOKEN_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const ADMIN_TOKEN_MAX_AGE_SECONDS = 60 * 60;
const ADMIN_LOGIN_LIMIT = 5;
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_PASSWORD_MIN_LENGTH = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const ADMIN_SESSION_ID = crypto.createHash('sha256')
    .update('RICHY MD password-authenticated admin')
    .digest('hex')
    .slice(0, 32);

class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function sendJson(response, status, value, headers = {}) {
    const body = JSON.stringify(value);
    response.writeHead(status, {
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(body),
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        ...headers,
    });
    response.end(body);
}

async function readJsonBody(request) {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > BODY_LIMIT) tooLarge = true;
        else if (!tooLarge) chunks.push(chunk);
    }
    if (tooLarge) throw new ApiError(413, 'Request body is too large.');
    if (!chunks.length) throw new ApiError(400, 'A JSON request body is required.');
    try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('Expected an object.');
        }
        return value;
    } catch {
        throw new ApiError(400, 'The request body must be valid JSON.');
    }
}

function assertSameOrigin(request) {
    const origin = request.headers.origin;
    if (typeof origin !== 'string') throw new ApiError(403, 'A same-origin request is required.');

    try {
        const url = new URL(origin);
        if (!['http:', 'https:'].includes(url.protocol) || url.host !== request.headers.host) {
            throw new ApiError(403, 'A same-origin request is required.');
        }
    } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(403, 'A same-origin request is required.');
    }
}

function validateTelegramLogin(data, botToken, now = Date.now()) {
    if (!botToken || typeof data.hash !== 'string' || !/^[a-f\d]{64}$/i.test(data.hash)) return null;
    const authDate = Number(data.auth_date);
    const userId = Number(data.id);
    const age = Math.floor(now / 1000) - authDate;
    if (!Number.isSafeInteger(authDate) || age < -30 || age > LOGIN_MAX_AGE_SECONDS) return null;
    if (!Number.isSafeInteger(userId) || userId <= 0) return null;

    const entries = Object.entries(data).filter(([key]) => key !== 'hash');
    if (entries.some(([, value]) => !['string', 'number'].includes(typeof value))) return null;
    const dataCheckString = entries
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
    const secretKey = crypto.createHash('sha256').update(botToken).digest();
    const expected = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest();
    const supplied = Buffer.from(data.hash, 'hex');
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;

    return {
        id: userId,
        firstName: typeof data.first_name === 'string' ? data.first_name.slice(0, 80) : '',
        username: typeof data.username === 'string' ? data.username.slice(0, 64) : '',
    };
}

function sessionSecret(botToken) {
    return crypto.createHmac('sha256', crypto.createHash('sha256').update(botToken).digest())
        .update('RICHY MD PWA session cookie')
        .digest();
}

function signSession(user, secret, now = Date.now(), maxAgeSeconds = TOKEN_MAX_AGE_SECONDS) {
    const payload = Buffer.from(JSON.stringify({
        ...user,
        exp: Math.floor(now / 1000) + maxAgeSeconds,
    })).toString('base64url');
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
}

function parseCookies(header = '') {
    return Object.fromEntries(header.split(';').map((part) => {
        const separator = part.indexOf('=');
        return separator < 0
            ? ['', '']
            : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
    }).filter(([key]) => key));
}

function verifySession(token, secret, now = Date.now()) {
    if (typeof token !== 'string') return null;
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra !== undefined) return null;

    const expected = crypto.createHmac('sha256', secret).update(payload).digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;

    try {
        const user = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        const validId = Number.isSafeInteger(user.id) && user.id > 0
            || typeof user.id === 'string' && /^[a-f\d]{32}$/i.test(user.id);
        if (!validId || !Number.isSafeInteger(user.exp)) return null;
        if (user.exp <= Math.floor(now / 1000)) return null;
        return { id: user.id, firstName: user.firstName || '', username: user.username || '' };
    } catch {
        return null;
    }
}

function sessionStatus(number, session, engine, now) {
    if (engine.isConnected(number)) return 'connected';
    if (session.pairingState === 'awaiting_pairing') {
        return session.pairingCodeExpiresAt > now ? 'awaiting_pairing' : 'expired';
    }
    if (session.pairingState === 'error' || session.pairingState === 'expired' || session.pairingState === 'logged_out') {
        return session.pairingState;
    }
    if (engine.isRunning(number)) return session.pairingState || 'connecting';
    if (engine.isPaired(number)) return 'offline';
    return session.pairingState || 'offline';
}

function maskPhoneNumber(number) {
    return `•••• ${String(number).slice(-4)}`;
}

function messageChatType(message) {
    if (message.chatType === 'group' || message.chatType === 'direct') return message.chatType;
    if (typeof message.chat !== 'string') return 'unknown';
    if (/^\d{8,15}$/.test(message.chat)) return 'direct';
    if (/^\d{16,40}$/.test(message.chat)) return 'group';
    return 'unknown';
}

function sessionLookupId(number, secret) {
    return crypto.createHmac('sha256', secret)
        .update(`admin-message-session:${number}`)
        .digest('base64url');
}

function publicSession({ number, ...session }, engine, now) {
    const connected = engine.isConnected(number);
    const connectedSince = connected && Number.isSafeInteger(session.connectedSince) ? session.connectedSince : null;
    return {
        number,
        status: sessionStatus(number, session, engine, now),
        connected,
        running: engine.isRunning(number),
        pairingCode: session.pairingCodeExpiresAt > now ? session.pairingCode || null : null,
        pairingCodeExpiresAt: session.pairingCodeExpiresAt > now ? session.pairingCodeExpiresAt : null,
        profileName: session.profileName || '',
        username: session.username || '',
        createdAt: session.createdAt || null,
        connectedAt: session.connectedAt || null,
        lastDisconnectedAt: session.lastDisconnectedAt || null,
        reconnectCount: session.reconnectCount || 0,
        uptimeMs: (session.totalUptimeMs || 0) + (connectedSince ? now - connectedSince : 0),
        lastError: session.lastError || '',
    };
}

function analyticsForUser(userId, store, engine, now) {
    const sessions = store.sessionsForUser(userId);
    const events = store.appEventsForUser(userId, now - 90 * DAY_MS);
    const days = Array.from({ length: 7 }, (_, index) => {
        const date = new Date(now - (6 - index) * DAY_MS).toISOString().slice(0, 10);
        const dayEvents = events.filter((event) => new Date(event.at).toISOString().slice(0, 10) === date);
        return {
            date,
            pairingRequests: dayEvents.filter((event) => event.type === 'pair_requested').length,
            successfulPairings: dayEvents.filter((event) => event.type === 'pair_connected').length,
        };
    });
    const connectedSessions = sessions.filter(({ number }) => engine.isConnected(number)).length;

    return {
        connectedSessions,
        totalSessions: sessions.length,
        connectionHealth: sessions.length ? Math.round((connectedSessions / sessions.length) * 100) : 0,
        reconnectCount: events.filter((event) => event.type === 'session_reconnected').length,
        totalUptimeMs: sessions.reduce((total, session) => {
            const active = engine.isConnected(session.number) && Number.isSafeInteger(session.connectedSince)
                ? Math.max(0, now - session.connectedSince)
                : 0;
            return total + (session.totalUptimeMs || 0) + active;
        }, 0),
        pairingActivity: days,
    };
}

function createAppApi({ botToken, botUsername, adminPassword, sessionKey, store, engine }) {
    const username = String(botUsername || '').replace(/^@/, '').trim();
    const secret = botToken
        ? sessionSecret(botToken)
        : sessionKey
            ? crypto.createHash('sha256').update(sessionKey).digest()
            : null;
    const adminPasswordHash = typeof adminPassword === 'string'
        && adminPassword.length >= ADMIN_PASSWORD_MIN_LENGTH
        ? crypto.createHash('sha256').update(adminPassword).digest()
        : null;
    const pairingStarts = new Set();
    const pairingHistory = new Map();
    const pairingCodeTimers = new Map();
    const failedAdminLogins = new Map();
    const revokedAdminCookies = new Map();

    function secureCookie(request) {
        return process.env.NODE_ENV === 'production'
            || request.socket.encrypted
            || request.headers['x-forwarded-proto'] === 'https'
            ? '; Secure'
            : '';
    }

    function adminUser(request) {
        const token = parseCookies(request.headers.cookie)[ADMIN_COOKIE_NAME];
        const now = Date.now();
        for (const [hash, expiresAt] of revokedAdminCookies) {
            if (expiresAt <= now) revokedAdminCookies.delete(hash);
        }
        if (token) {
            const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
            if (revokedAdminCookies.has(tokenHash)) return null;
        }
        const user = secret ? verifySession(token, secret) : null;
        return user?.id === ADMIN_SESSION_ID ? user : null;
    }

    function adminLoginKey(request) {
        return request.socket.remoteAddress || 'unknown';
    }

    function pruneFailedAdminLogins(now = Date.now()) {
        for (const [key, attempt] of failedAdminLogins) {
            if (attempt.expiresAt <= now) failedAdminLogins.delete(key);
        }
    }

    function clearPairingCodeTimer(number) {
        clearTimeout(pairingCodeTimers.get(number));
        pairingCodeTimers.delete(number);
    }

    function schedulePairingCodeExpiry(number, expiresAt) {
        clearPairingCodeTimer(number);
        const timer = setTimeout(() => {
            const session = store.getSession(number);
            if (session?.pairingCodeExpiresAt === expiresAt && expiresAt <= Date.now()) {
                store.setSession(number, {
                    pairingCode: null,
                    pairingCodeExpiresAt: null,
                    pairingState: 'expired',
                    lastError: 'The pairing code expired before it was used.',
                });
            }
            pairingCodeTimers.delete(number);
        }, Math.max(0, expiresAt - Date.now()));
        timer.unref?.();
        pairingCodeTimers.set(number, timer);
    }

    return async function handleAppApi(request, response, pathname) {
        try {
            if (pathname === '/api/config' && request.method === 'GET') {
                return sendJson(response, 200, {
                    appEnabled: Boolean(secret),
                });
            }

            if (pathname === '/api/admin/config' && request.method === 'GET') {
                return sendJson(response, 200, {
                    enabled: Boolean(secret && adminPasswordHash),
                });
            }

            if (pathname === '/api/app-session' && request.method === 'POST') {
                assertSameOrigin(request);
                if (!secret) throw new ApiError(503, 'The pairing app is not configured yet.');

                const cookies = parseCookies(request.headers.cookie);
                let appUser = verifySession(cookies[COOKIE_NAME], secret);
                let headers = {};
                if (!appUser) {
                    appUser = {
                        id: crypto.randomBytes(16).toString('hex'),
                        firstName: 'RICHY MD user',
                        username: '',
                    };
                    const token = signSession(appUser, secret);
                    headers = {
                        'Set-Cookie': `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TOKEN_MAX_AGE_SECONDS}${secureCookie(request)}`,
                    };
                }
                return sendJson(response, 200, { ok: true }, headers);
            }

            if (pathname === '/api/admin/auth/password' && request.method === 'POST') {
                assertSameOrigin(request);
                if (!secret || !adminPasswordHash) {
                    throw new ApiError(503, `Set ADMIN_PASSWORD to at least ${ADMIN_PASSWORD_MIN_LENGTH} characters to enable admin access.`);
                }
                const now = Date.now();
                pruneFailedAdminLogins(now);
                const loginKey = adminLoginKey(request);
                const attempts = failedAdminLogins.get(loginKey);
                if (attempts?.count >= ADMIN_LOGIN_LIMIT) {
                    return sendJson(response, 429, { error: 'Too many failed attempts. Try again in 15 minutes.' }, {
                        'Retry-After': String(Math.ceil((attempts.expiresAt - now) / 1000)),
                    });
                }
                const data = await readJsonBody(request);
                const suppliedPassword = typeof data.password === 'string' ? data.password : '';
                const suppliedHash = crypto.createHash('sha256').update(suppliedPassword).digest();
                if (!crypto.timingSafeEqual(suppliedHash, adminPasswordHash)) {
                    const count = (attempts?.count || 0) + 1;
                    failedAdminLogins.set(loginKey, { count, expiresAt: now + ADMIN_LOGIN_WINDOW_MS });
                    if (failedAdminLogins.size > 1000) {
                        const oldestKey = failedAdminLogins.keys().next().value;
                        if (oldestKey) failedAdminLogins.delete(oldestKey);
                    }
                    throw new ApiError(401, 'Incorrect admin password.');
                }
                failedAdminLogins.delete(loginKey);

                const user = { id: ADMIN_SESSION_ID, firstName: 'Owner', username: '' };
                const token = signSession(user, secret, now, ADMIN_TOKEN_MAX_AGE_SECONDS);
                return sendJson(response, 200, { user }, {
                    'Set-Cookie': `${ADMIN_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ADMIN_TOKEN_MAX_AGE_SECONDS}${secureCookie(request)}`,
                });
            }

            if (pathname === '/api/admin/session' && request.method === 'GET') {
                const user = adminUser(request);
                return sendJson(response, 200, {
                    authenticated: Boolean(user),
                    firstName: user?.firstName || '',
                });
            }

            if (pathname === '/api/admin/logout' && request.method === 'POST') {
                assertSameOrigin(request);
                const token = parseCookies(request.headers.cookie)[ADMIN_COOKIE_NAME];
                if (token && adminUser(request)) {
                    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
                    revokedAdminCookies.set(tokenHash, Date.now() + ADMIN_TOKEN_MAX_AGE_SECONDS * 1000);
                }
                return sendJson(response, 200, { ok: true }, {
                    'Set-Cookie': `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secureCookie(request)}`,
                });
            }

            if (pathname.startsWith('/api/admin/')) {
                const user = adminUser(request);
                if (!user) throw new ApiError(401, 'Admin sign-in is required.');

                if (pathname === '/api/admin/sessions' && request.method === 'GET') {
                    const now = Date.now();
                    const sessions = Object.entries(store.allSessions()).map(([number, session]) => {
                        const connected = engine.isConnected(number);
                        const connectedSince = connected && Number.isSafeInteger(session.connectedSince)
                            ? session.connectedSince
                            : null;
                        return {
                            sessionId: sessionLookupId(number, secret),
                            number,
                            profileName: session.profileName || '',
                            username: session.username || '',
                            status: sessionStatus(number, session, engine, now),
                            connected,
                            running: engine.isRunning(number),
                            createdAt: session.createdAt || null,
                            connectedAt: session.connectedAt || null,
                            lastDisconnectedAt: session.lastDisconnectedAt || null,
                            reconnectCount: session.reconnectCount || 0,
                            uptimeMs: (session.totalUptimeMs || 0)
                                + (connectedSince ? Math.max(0, now - connectedSince) : 0),
                        };
                    });
                    return sendJson(response, 200, {
                        connectedSessions: sessions.filter((session) => session.connected).length,
                        totalSessions: sessions.length,
                        sessions,
                    });
                }

                if (pathname === '/api/admin/messages' && request.method === 'GET') {
                    const messages = store.allAppMessages().map((message) => ({
                        ...message,
                        chatType: messageChatType(message),
                        sessionId: sessionLookupId(message.sessionNumber, secret),
                        sessionNumber: maskPhoneNumber(message.sessionNumber),
                    }));
                    return sendJson(response, 200, { messages });
                }

                throw new ApiError(404, 'Admin API endpoint not found.');
            }

            if (pathname === '/api/auth/telegram' && request.method === 'POST') {
                assertSameOrigin(request);
                const data = await readJsonBody(request);
                const user = validateTelegramLogin(data, botToken);
                if (!user || !botToken || !secret || !username) throw new ApiError(401, 'Telegram sign-in could not be verified.');
                const token = signSession(user, secret);
                return sendJson(response, 200, { user }, {
                    'Set-Cookie': `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TOKEN_MAX_AGE_SECONDS}${secureCookie(request)}`,
                });
            }

            if (pathname === '/api/auth/logout' && request.method === 'POST') {
                assertSameOrigin(request);
                return sendJson(response, 200, { ok: true }, {
                    'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
                });
            }

            const cookies = parseCookies(request.headers.cookie);
            const user = secret ? verifySession(cookies[COOKIE_NAME], secret) : null;
            if (pathname === '/api/me' && request.method === 'GET') {
                if (!user) throw new ApiError(401, 'Initialize the pairing app to continue.');
                return sendJson(response, 200, { user });
            }
            if (!user) throw new ApiError(401, 'Sign in with Telegram to continue.');

            if (pathname === '/api/sessions' && request.method === 'GET') {
                const now = Date.now();
                return sendJson(response, 200, {
                    sessions: store.sessionsForUser(user.id).map((session) => {
                        if (session.pairingCode && session.pairingCodeExpiresAt <= now) {
                            clearPairingCodeTimer(session.number);
                            store.setSession(session.number, {
                                pairingCode: null,
                                pairingCodeExpiresAt: null,
                                pairingState: 'expired',
                                lastError: 'The pairing code expired before it was used.',
                            });
                            return publicSession({
                                ...session,
                                pairingCode: null,
                                pairingCodeExpiresAt: null,
                                pairingState: 'expired',
                                lastError: 'The pairing code expired before it was used.',
                            }, engine, now);
                        }
                        return publicSession(session, engine, now);
                    }),
                });
            }

            if (pathname === '/api/analytics' && request.method === 'GET') {
                return sendJson(response, 200, analyticsForUser(user.id, store, engine, Date.now()));
            }

            if (pathname === '/api/messages' && request.method === 'GET') {
                return sendJson(response, 200, {
                    recordingEnabled: store.isMessageRecordingEnabled(user.id),
                });
            }

            if (pathname === '/api/messages/recording' && request.method === 'POST') {
                assertSameOrigin(request);
                const body = await readJsonBody(request);
                if (typeof body.enabled !== 'boolean') {
                    throw new ApiError(400, 'Choose whether message recording is enabled.');
                }
                if (body.enabled && body.informedParticipants !== true) {
                    throw new ApiError(400, 'Confirm that affected participants have been informed and have consented.');
                }
                store.setMessageRecording(user.id, body.enabled);
                return sendJson(response, 200, { recordingEnabled: body.enabled });
            }

            if (pathname === '/api/sessions' && request.method === 'POST') {
                assertSameOrigin(request);
                if (!store.isMessageRecordingEnabled(user.id)) {
                    throw new ApiError(403, 'Agree to the privacy notice and confirm participant consent before pairing.');
                }
                const body = await readJsonBody(request);
                const rawNumber = typeof body.number === 'string' ? body.number : '';
                const number = rawNumber.replace(/\D/g, '');
                if (rawNumber.length > 30 || !/^\d{8,15}$/.test(number)) {
                    throw new ApiError(400, 'Enter a WhatsApp number with its country code.');
                }
                if (store.isMaintenance?.()) throw new ApiError(503, 'Pairing is paused for maintenance.');

                const existing = store.getSession(number);
                const existingOwnerId = existing?.appOwnerId ?? existing?.telegramUserId;
                if (existing && existingOwnerId !== user.id) {
                    throw new ApiError(409, 'This number already has a saved session.');
                }
                if (engine.isRunning(number) || engine.isPaired(number)) {
                    throw new ApiError(409, 'This number already has a saved session. Refresh your sessions list.');
                }
                if (pairingStarts.has(number)) throw new ApiError(409, 'Pairing for this number is already starting.');
                const now = Date.now();
                const recentAttempts = (pairingHistory.get(user.id) || []).filter((at) => now - at < 60 * 60 * 1000);
                if (recentAttempts.length >= 5 || recentAttempts.at(-1) && now - recentAttempts.at(-1) < 30 * 1000) {
                    throw new ApiError(429, 'Too many pairing requests. Please wait before trying again.');
                }
                pairingStarts.add(number);
                try {
                    if (existing) {
                        store.deleteSession(number);
                    }

                    store.setSession(number, {
                        appOwnerId: user.id,
                        appOwned: true,
                        connected: false,
                        pairingState: 'connecting',
                        pairingCode: null,
                        pairingCodeExpiresAt: null,
                        createdAt: now,
                        connectedAt: null,
                        connectedSince: null,
                        totalUptimeMs: 0,
                        reconnectCount: 0,
                        lastError: '',
                    });
                    store.recordAppEvent(user.id, 'pair_requested', now);
                    pairingHistory.set(user.id, [...recentAttempts, now]);

                    try {
                        const started = await engine.startSession(number, {
                            pairingNumber: number,
                            onPairingCode: (code) => {
                                const expiresAt = Date.now() + 60 * 1000;
                                store.setSession(number, {
                                    pairingState: 'awaiting_pairing',
                                    pairingCode: String(code),
                                    pairingCodeExpiresAt: expiresAt,
                                });
                                schedulePairingCodeExpiry(number, expiresAt);
                                store.recordAppEvent(user.id, 'pair_code_issued');
                            },
                            onPairingError: async () => {
                                clearPairingCodeTimer(number);
                                await engine.removeSession(number);
                                store.setSession(number, {
                                    connected: false,
                                    pairingState: 'error',
                                    pairingCode: null,
                                    pairingCodeExpiresAt: null,
                                    lastError: 'WhatsApp could not issue a pairing code. Please try again later.',
                                });
                                store.recordAppEvent(user.id, 'pair_failed');
                            },
                            onPairingFailed: () => {
                                clearPairingCodeTimer(number);
                                store.setSession(number, {
                                    connected: false,
                                    pairingState: 'expired',
                                    pairingCode: null,
                                    pairingCodeExpiresAt: null,
                                    lastError: 'The pairing code expired before it was used.',
                                });
                                store.recordAppEvent(user.id, 'pair_failed');
                            },
                            onConnected: (_isFirstTime, account = {}) => {
                                clearPairingCodeTimer(number);
                                const previous = store.getSession(number) || {};
                                const reconnected = Boolean(previous.connectedAt);
                                const connectedAt = Date.now();
                                store.setSession(number, {
                                    ...(account.profileName ? { profileName: account.profileName } : {}),
                                    ...(account.username ? { username: account.username } : {}),
                                    connected: true,
                                    pairingState: 'connected',
                                    pairingCode: null,
                                    pairingCodeExpiresAt: null,
                                    connectedAt: previous.connectedAt || connectedAt,
                                    connectedSince: connectedAt,
                                    totalUptimeMs: previous.totalUptimeMs || 0,
                                    reconnectCount: (previous.reconnectCount || 0) + (reconnected ? 1 : 0),
                                    lastError: '',
                                });
                                store.recordAppEvent(user.id, reconnected ? 'session_reconnected' : 'pair_connected');
                            },
                            onDisconnected: () => {
                                const previous = store.getSession(number) || {};
                                const disconnectedAt = Date.now();
                                const accrued = previous.connectedSince
                                    ? Math.max(0, disconnectedAt - previous.connectedSince)
                                    : 0;
                                store.setSession(number, {
                                    connected: false,
                                    pairingState: 'reconnecting',
                                    connectedSince: null,
                                    totalUptimeMs: (previous.totalUptimeMs || 0) + accrued,
                                    lastDisconnectedAt: disconnectedAt,
                                });
                                store.recordAppEvent(user.id, 'session_disconnected', disconnectedAt);
                            },
                            onLoggedOut: () => {
                                clearPairingCodeTimer(number);
                                const previous = store.getSession(number) || {};
                                const loggedOutAt = Date.now();
                                const accrued = previous.connectedSince
                                    ? Math.max(0, loggedOutAt - previous.connectedSince)
                                    : 0;
                                store.setSession(number, {
                                    connected: false,
                                    pairingState: 'logged_out',
                                    connectedSince: null,
                                    totalUptimeMs: (previous.totalUptimeMs || 0) + accrued,
                                    pairingCode: null,
                                    pairingCodeExpiresAt: null,
                                    lastError: 'This WhatsApp session was logged out.',
                                });
                                store.recordAppEvent(user.id, 'session_logged_out', loggedOutAt);
                            },
                            onReplaced: () => {
                                clearPairingCodeTimer(number);
                                store.setSession(number, {
                                    connected: false,
                                    pairingState: 'error',
                                    connectedSince: null,
                                    lastError: 'This session is also open in another place.',
                                });
                            },
                            onIncomingMessage: (message) => store.recordAppMessage(user.id, number, message),
                            onOutgoingMessage: (message) => store.recordAppMessage(user.id, number, message),
                        });
                        if (!started) throw new Error('Pairing start was cancelled.');
                    } catch (error) {
                        clearPairingCodeTimer(number);
                        store.setSession(number, {
                            connected: false,
                            pairingState: 'error',
                            lastError: 'Could not start pairing. Please try again.',
                        });
                        store.recordAppEvent(user.id, 'pair_failed');
                        console.error('[app] failed to start pairing:', error.message);
                        throw new ApiError(500, 'Could not start pairing. Please try again.');
                    }
                    return sendJson(response, 202, {
                        session: publicSession({ number, ...store.getSession(number) }, engine, Date.now()),
                    });
                } finally {
                    pairingStarts.delete(number);
                }
            }

            const deleteMatch = pathname.match(/^\/api\/sessions\/(\d{8,15})$/);
            if (deleteMatch && request.method === 'DELETE') {
                assertSameOrigin(request);
                const number = deleteMatch[1];
                const session = store.getSession(number);
                const ownerId = session?.appOwnerId ?? session?.telegramUserId;
                if (!session || ownerId !== user.id) {
                    throw new ApiError(404, 'Session not found.');
                }
                clearPairingCodeTimer(number);
                await engine.removeSession(number);
                store.deleteSession(number);
                store.recordAppEvent(user.id, 'session_deleted');
                return sendJson(response, 200, { ok: true });
            }

            throw new ApiError(404, 'API endpoint not found.');
        } catch (error) {
            if (error instanceof ApiError) return sendJson(response, error.status, { error: error.message });
            console.error('[app] API request failed:', error.message);
            return sendJson(response, 500, { error: 'The request could not be completed.' });
        }
    };
}

module.exports = {
    createAppApi,
    validateTelegramLogin,
};
