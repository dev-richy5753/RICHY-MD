const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { randomZenonImage } = require('../src/lib/zenon-images');

test('random Zenon image selection accepts arbitrary uploaded names and excludes unrelated artwork', (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'richy-md-zenon-images-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    fs.writeFileSync(path.join(directory, 'OIP (1).webp'), 'zenon one');
    fs.writeFileSync(path.join(directory, 'download.jpeg'), 'zenon two');
    fs.writeFileSync(path.join(directory, 'Black_Bull_members.webp'), 'not Zenon');
    fs.writeFileSync(path.join(directory, 'notes.txt'), 'not an image');

    assert.equal(randomZenonImage(directory, () => 0).toString(), 'zenon one');
    assert.equal(randomZenonImage(directory, () => 0.99).toString(), 'zenon two');
});
