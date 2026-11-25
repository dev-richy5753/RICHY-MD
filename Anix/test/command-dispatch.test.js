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

test('view-once commands recognize wrapped quotes and explain they cannot copy the media', async () => {
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
            id: 'incoming-vv',
            remoteJid: '14155550999@s.whatsapp.net',
            fromMe: false,
        },
        message: {
            extendedTextMessage: {
                text: '.vv',
                contextInfo: {
                    stanzaId: 'view-once-id',
                    quotedMessage: {
                        viewOnceMessage: {
                            message: {
                                imageMessage: { caption: 'private photo' },
                            },
                        },
                    },
                },
            },
        },
    };

    await handleMessages(sock, { type: 'notify', messages: [message] }, {
        sessionId: 'view-once-command-test',
        settings,
    });

    assert.equal(sent.length, 1);
    assert.match(sent[0][1].caption, /cannot be copied by bot commands/);
    assert.equal('video' in sent[0][1], false);
});
