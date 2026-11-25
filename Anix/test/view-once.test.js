const assert = require('node:assert/strict');
const test = require('node:test');

const { findViewOnceMessage } = require('../src/lib/view-once');

test('findViewOnceMessage detects a view-once wrapper after ephemeral wrapping', () => {
    const media = { imageMessage: { caption: 'photo' } };
    const message = {
        ephemeralMessage: {
            message: {
                viewOnceMessage: { message: media },
            },
        },
    };

    assert.equal(findViewOnceMessage(message), media);
});

test('findViewOnceMessage detects the newer view-once extension wrapper', () => {
    const media = { videoMessage: { caption: 'video' } };
    const message = { viewOnceMessageV2Extension: { message: media } };

    assert.equal(findViewOnceMessage(message), media);
});

test('findViewOnceMessage accepts media carrying the view-once marker', () => {
    const message = { imageMessage: { viewOnce: true } };

    assert.equal(findViewOnceMessage(message), message);
});

test('findViewOnceMessage does not treat regular media as view-once', () => {
    assert.equal(findViewOnceMessage({ imageMessage: { caption: 'regular photo' } }), null);
});
