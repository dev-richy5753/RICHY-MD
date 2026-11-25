const assert = require('node:assert/strict');
const test = require('node:test');

const { getBotJid } = require('../src/lib/bot-jid');

test('getBotJid returns the bot account JID without its device suffix', () => {
    assert.equal(getBotJid({ user: { id: '123456789:4@s.whatsapp.net' } }), '123456789@s.whatsapp.net');
});

test('getBotJid returns null when the bot account is unavailable', () => {
    assert.equal(getBotJid({}), null);
});
