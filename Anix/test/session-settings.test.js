const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const settingsModule = path.join(__dirname, '..', 'src', 'lib', 'settings.js');

test('session settings migrate existing status behavior to ghost-only likes', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'richy-md-status-settings-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const sessionDir = path.join(root, 'session', 'existing');
    fs.mkdirSync(sessionDir, { recursive: true });
    const settingsPath = path.join(sessionDir, 'bot-settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
        menuMedia: 'image',
        autoStatusView: true,
        autoStatusLike: true,
        statusEmojis: ['❤️'],
    }));

    const script = `
        const { createSessionSettings } = require(${JSON.stringify(settingsModule)});
        const settings = createSessionSettings('existing', '.', 'menu-image');
        const existing = {
            view: settings.get('autoStatusView'),
            like: settings.get('autoStatusLike'),
            emojis: settings.get('statusEmojis'),
            profile: settings.get('statusReactionProfile'),
        };
        const fresh = createSessionSettings('fresh', '.', 'menu-image');
        console.log(JSON.stringify({
            existing,
            fresh: {
                view: fresh.get('autoStatusView'),
                like: fresh.get('autoStatusLike'),
                emojis: fresh.get('statusEmojis'),
            },
        }));
    `;
    const result = JSON.parse(execFileSync(process.execPath, ['-e', script], {
        cwd: root,
        encoding: 'utf8',
    }));
    const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

    assert.deepEqual(result.existing, {
        view: false,
        like: true,
        emojis: ['👻'],
        profile: 'ghost-only-v1',
    });
    assert.deepEqual(result.fresh, { view: false, like: true, emojis: ['👻'] });
    assert.deepEqual(saved.statusEmojis, ['👻']);
});
