const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const storePath = path.join(__dirname, '..', 'telegram-bot', 'store.js');

test('panel state uses the configured persistent session directory', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'richy-md-session-root-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const sessionRoot = path.join(root, 'mounted', 'sessions');
    const script = `
        const store = require(${JSON.stringify(storePath)});
        store.setSession('14155550123', { connected: false });
    `;

    execFileSync(process.execPath, ['-e', script], {
        cwd: root,
        env: { ...process.env, SESSION_DIR: sessionRoot },
    });

    assert.equal(fs.existsSync(path.join(sessionRoot, '.panel', 'store.json')), true);
    assert.equal(fs.existsSync(path.join(root, 'session', '.panel', 'store.json')), false);
});

test('message recordings are stored in separate per-owner files and migrate legacy records', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'richy-md-store-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const ownerA = 'a'.repeat(32);
    const ownerB = 'b'.repeat(32);
    const now = Date.now();
    const legacy = [ownerA, ownerB].map((ownerId, index) => ({
        id: `legacy-${index}`,
        ownerId,
        sessionNumber: `1415555012${index}`,
        direction: 'incoming',
        consentVersion: 2,
        sender: `Sender ${index}`,
        senderNumber: `1415555099${index}`,
        chat: `1415555099${index}`,
        text: `Owner ${index} message`,
        at: now,
    }));
    const panelDir = path.join(root, 'session', '.panel');
    fs.mkdirSync(panelDir, { recursive: true });
    fs.writeFileSync(path.join(panelDir, 'store.json'), JSON.stringify({
        sessions: {},
        users: {},
        messageRecording: {
            [ownerA]: { enabled: true, consentVersion: 2 },
            [ownerB]: { enabled: true, consentVersion: 2 },
        },
        appMessages: legacy,
    }));

    const script = `
        const fs = require('node:fs');
        const path = require('node:path');
        const store = require(${JSON.stringify(storePath)});
        const ownerA = ${JSON.stringify(ownerA)};
        const ownerB = ${JSON.stringify(ownerB)};
        store.recordAppMessage(ownerA, '14155550120', {
            direction: 'outgoing', sender: 'RICHY MD', senderNumber: '14155550120',
            chat: '14155550990', text: 'Owner A new message',
        });
        const beforeDisable = {
            ownerA: store.appMessagesForUser(ownerA).map(({ text }) => text),
            ownerB: store.appMessagesForUser(ownerB).map(({ text }) => text),
        };
        store.setMessageRecording(ownerA, false);
        const messageDir = path.join(process.cwd(), 'session', '.panel', 'messages');
        const state = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'session', '.panel', 'store.json'), 'utf8'));
        console.log(JSON.stringify({
            beforeDisable,
            ownerFilesAfterDisable: fs.readdirSync(messageDir),
            ownerBMessages: store.allAppMessages().map(({ text }) => text),
            hasLegacyGlobalArray: Object.hasOwn(state, 'appMessages'),
        }));
    `;
    const result = JSON.parse(execFileSync(process.execPath, ['-e', script], {
        cwd: root,
        encoding: 'utf8',
    }));

    assert.deepEqual(result.beforeDisable, {
        ownerA: ['Owner 0 message', 'Owner A new message'],
        ownerB: ['Owner 1 message'],
    });
    assert.deepEqual(result.ownerFilesAfterDisable, [`${ownerB}.json`]);
    assert.deepEqual(result.ownerBMessages, ['Owner 1 message']);
    assert.equal(result.hasLegacyGlobalArray, false);
});

test('duplicate outgoing WhatsApp events are stored once and prefer the bot source', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'richy-md-message-dedupe-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const owner = 'c'.repeat(32);
    const script = `
        const store = require(${JSON.stringify(storePath)});
        const owner = ${JSON.stringify(owner)};
        store.setMessageRecording(owner, true);
        const base = {
            direction: 'outgoing', senderNumber: '14155550120',
            chat: '14155550990', chatType: 'group', text: 'Hello', at: Date.now(),
            waMessageId: 'whatsapp-message-1',
        };
        const personalEvent = store.recordAppMessage(owner, '14155550120', {
            ...base, source: 'personal', sender: 'You (WhatsApp)',
        });
        const botEvent = store.recordAppMessage(owner, '14155550120', {
            ...base, source: 'bot', sender: 'RICHY MD',
        });
        console.log(JSON.stringify({
            personalEvent,
            botEvent,
            messages: store.appMessagesForUser(owner),
        }));
    `;
    const result = JSON.parse(execFileSync(process.execPath, ['-e', script], {
        cwd: root,
        encoding: 'utf8',
    }));

    assert.equal(result.personalEvent, true);
    assert.equal(result.botEvent, false);
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].source, 'bot');
    assert.equal(result.messages[0].chatType, 'group');
    assert.equal(Object.hasOwn(result.messages[0], 'waMessageId'), false);
});
