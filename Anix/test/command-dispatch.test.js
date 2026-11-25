const assert = require('node:assert/strict');
const test = require('node:test');

const { handleMessages } = require('../src/Anix');

test('incoming .ping messages reach the WhatsApp command handler', async () => {
    const sent = [];
    const sock = {
        sendMessage: async (...args) => {
            sent.push(args);
            return { key: { id: String(sent.length) } };
        },
        sendPresenceUpdate: async () => {},
    };
    const values = {
        prefix: '.',
        public: true,
        owners: [],
        banned: [],
        sudo: [],
        workMode: 'all',
        antidelete: { enabled: false },
        autoType: false,
        autoRecord: false,
        autoRecordType: false,
    };
    const settings = {
        get(key, fallback) {
            return Object.hasOwn(values, key) ? values[key] : fallback;
        },
    };
    const message = {
        key: {
            id: 'incoming-ping',
            remoteJid: '14155550999@s.whatsapp.net',
            fromMe: false,
        },
        message: { conversation: '.ping' },
    };

    await handleMessages(sock, { type: 'notify', messages: [message] }, {
        sessionId: 'command-dispatch-test',
        settings,
    });

    const replies = sent.map(([, content]) => content.caption || content.text);
    assert.equal(replies.length, 2);
    assert.equal(replies[0], 'Pinging...');
    assert.match(replies[1], /^🏓 Pong! \d+ms$/);
});
