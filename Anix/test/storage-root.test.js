const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { getStorageRoot } = require('../src/lib/storage-root');

test('session storage defaults to the project session directory', () => {
    const cwd = path.join(path.sep, 'srv', 'richy-md');

    assert.equal(getStorageRoot('', cwd), path.join(cwd, 'session'));
});

test('session storage supports an absolute persistent mount path', () => {
    const cwd = path.join(path.sep, 'srv', 'richy-md');
    const mount = path.join(path.sep, 'var', 'lib', 'richy-md', 'session');

    assert.equal(getStorageRoot(mount, cwd), mount);
});

test('session storage resolves relative paths against the project directory', () => {
    const cwd = path.join(path.sep, 'srv', 'richy-md');

    assert.equal(getStorageRoot('durable/session', cwd), path.join(cwd, 'durable', 'session'));
});
