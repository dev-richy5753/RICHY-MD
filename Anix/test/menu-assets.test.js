const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { loadMenuAsset } = require('../src/lib/menu-assets');

test('menu assets are read once and reused from memory', (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'richy-md-menu-assets-'));
    const assetPath = path.join(directory, 'menu-image.webp');
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    fs.writeFileSync(assetPath, 'first image');

    const first = loadMenuAsset(assetPath);
    fs.writeFileSync(assetPath, 'replacement image');
    const second = loadMenuAsset(assetPath);

    assert.strictEqual(second, first);
    assert.equal(second.toString(), 'first image');
});
