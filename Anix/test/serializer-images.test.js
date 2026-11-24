const assert = require('node:assert/strict');
const test = require('node:test');

const { serializeMessage } = require('../src/lib/serializer');

test('text command replies include a Zenon image while existing media replies stay unchanged', async () => {
    const sent = [];
    const sock = {
        sendMessage: async (...args) => {
            sent.push(args);
            return { key: { id: String(sent.length) } };
        },
    };
    const raw = {
        key: { remoteJid: '12345@s.whatsapp.net', id: 'incoming' },
        message: { conversation: '.ping' },
    };
    const message = serializeMessage(sock, raw, { get: () => undefined });
    message._cmd = 'ping';

    await message.reply('Pong!');
    assert.ok(Buffer.isBuffer(sent[0][1].image));
    assert.equal(sent[0][1].caption, 'Pong!');
    assert.deepEqual(sent[0][2], { quoted: raw });

    await message.send({ text: 'Direct text response' });
    assert.ok(Buffer.isBuffer(sent[1][1].image));
    assert.equal(sent[1][1].caption, 'Direct text response');

    const existingImage = Buffer.from('command media');
    await message.send({ image: existingImage, caption: 'Original image response' });
    assert.equal(sent.length, 3);
    assert.equal(sent[2][1].image, existingImage);
    assert.equal(sent[2][1].caption, 'Original image response');
});

test('long text command replies send the image separately before the full text', async () => {
    const sent = [];
    const sock = {
        sendMessage: async (...args) => {
            sent.push(args);
            return { key: { id: String(sent.length) } };
        },
    };
    const raw = {
        key: { remoteJid: '12345@s.whatsapp.net', id: 'incoming' },
        message: { conversation: '.help' },
    };
    const message = serializeMessage(sock, raw, { get: () => undefined });
    message._cmd = 'help';
    const longText = 'x'.repeat(1025);

    await message.reply(longText);

    assert.equal(sent.length, 2);
    assert.ok(Buffer.isBuffer(sent[0][1].image));
    assert.equal(sent[0][1].caption, undefined);
    assert.equal(sent[1][1].text, longText);
});
