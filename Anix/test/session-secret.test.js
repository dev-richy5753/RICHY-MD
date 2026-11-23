const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { loadAppSessionSecret } = require('../telegram-bot/session-secret');

test('local app session secret remains stable across restarts', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'richy-md-secret-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const filePath = path.join(root, 'session', '.panel', 'app-session-secret');

    const first = loadAppSessionSecret({ configuredSecret: '', filePath });
    const second = loadAppSessionSecret({ configuredSecret: '', filePath });

    assert.equal(first.length, 64);
    assert.equal(second, first);
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
});

test('configured app session secret takes precedence over local storage', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'richy-md-secret-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const filePath = path.join(root, 'session', '.panel', 'app-session-secret');

    assert.equal(loadAppSessionSecret({ configuredSecret: 'configured-secret-value', filePath }), 'configured-secret-value');
    assert.equal(fs.existsSync(filePath), false);
});
