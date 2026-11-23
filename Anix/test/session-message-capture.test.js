const assert = require('node:assert/strict');
const test = require('node:test');

const { capturedMessageFromUpsert } = require('../src/session');

test('message capture excludes WhatsApp Channels and status updates', () => {
    for (const remoteJid of ['12345@newsletter', 'status@broadcast']) {
        assert.equal(capturedMessageFromUpsert({
            key: { remoteJid, fromMe: false },
            message: { conversation: 'Do not capture this channel text' },
        }, '14155550123@s.whatsapp.net'), null);
    }
});

test('message capture distinguishes incoming contacts from personal outgoing messages', () => {
    const messageTimestamp = Math.floor(Date.now() / 1000);
    const ownJid = '14155550123:4@s.whatsapp.net';
    const incoming = capturedMessageFromUpsert({
        key: { remoteJid: '14155550999@s.whatsapp.net', fromMe: false, id: 'incoming-id' },
        pushName: 'Jamie',
        message: { conversation: 'Hello' },
        messageTimestamp,
    }, ownJid);
    const outgoing = capturedMessageFromUpsert({
        key: { remoteJid: '14155550999@s.whatsapp.net', fromMe: true, id: 'personal-id' },
        message: { conversation: 'Sent from my phone' },
        messageTimestamp,
    }, ownJid);

    assert.deepEqual(
        { direction: incoming.direction, source: incoming.source, sender: incoming.sender, chatType: incoming.chatType },
        { direction: 'incoming', source: 'contact', sender: 'Jamie', chatType: 'direct' },
    );
    assert.deepEqual(
        {
            direction: outgoing.direction,
            source: outgoing.source,
            sender: outgoing.sender,
            senderNumber: outgoing.senderNumber,
            chatType: outgoing.chatType,
            text: outgoing.text,
            waMessageId: outgoing.waMessageId,
        },
        {
            direction: 'outgoing',
            source: 'personal',
            sender: 'You (WhatsApp)',
            senderNumber: '14155550123',
            chatType: 'direct',
            text: 'Sent from my phone',
            waMessageId: 'personal-id',
        },
    );
});

test('message capture identifies group chats', () => {
    const message = capturedMessageFromUpsert({
        key: {
            remoteJid: '120363012345678901@g.us',
            participant: '14155550999@s.whatsapp.net',
            fromMe: false,
        },
        message: { conversation: 'Hello group' },
    }, '14155550123@s.whatsapp.net');

    assert.equal(message.chatType, 'group');
});
