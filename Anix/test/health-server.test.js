const assert = require('node:assert/strict');
const fs = require('node:fs');
const { once } = require('node:events');
const path = require('node:path');
const test = require('node:test');

const { startHealthServer } = require('../telegram-bot/health-server');

test('health server serves the expanded landing page and preserves the health check', async (t) => {
    const server = startHealthServer(0);
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const [page, health, config, app, manifest] = await Promise.all([
        fetch(baseUrl),
        fetch(`${baseUrl}/health`),
        fetch(`${baseUrl}/site-config.json`),
        fetch(`${baseUrl}/app/`),
        fetch(`${baseUrl}/app/manifest.webmanifest`),
    ]);

    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    const pageHtml = await page.text();
    assert.match(pageHtml, /RICHY MD/);
    assert.match(pageHtml, /id="mascot-companion"/);
    assert.match(pageHtml, /Your WhatsApp\./);
    assert.match(pageHtml, /id="insights"/);
    assert.match(pageHtml, /id="faq"/);
    assert.match(pageHtml, /id="admin-entry"/);
    assert.doesNotMatch(pageHtml, /<video\b|montagem\.mp4/);
    assert.match(pageHtml, /Pair WhatsApp/);
    assert.match(pageHtml, /dashboard-showcase/);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), 'ok\n');
    assert.equal(config.status, 200);
    assert.equal(typeof (await config.json()).telegramBotUrl, 'string');
    assert.equal(app.status, 200);
    const appHtml = await app.text();
    assert.match(appHtml, /Pair your WhatsApp/);
    assert.match(appHtml, /id="pair-form"/);
    assert.match(appHtml, /id="pairing-code"/);
    assert.doesNotMatch(appHtml, /analysis-nav|analysis-view|Message analysis/);
    assert.match(appHtml, /id="admin-view"/);
    assert.match(appHtml, /id="admin-message-list"/);
    assert.match(appHtml, /id="admin-message-table-wrap"/);
    assert.match(appHtml, /<th>Type<\/th>/);
    assert.match(appHtml, /Full phone numbers are shown here/);
    assert.match(appHtml, /Tap one of the WhatsApp numbers/);
    assert.match(appHtml, /id="admin-login-form"/);
    assert.match(appHtml, /id="admin-password"/);
    assert.match(appHtml, /id="admin-content"[\s\S]*id="recording-disabled"/);
    assert.match(appHtml, /Admin lists sessions from all browser owners/);
    assert.match(appHtml, /WhatsApp Channel posts and status updates are not collected/);
    assert.match(appHtml, /informed the people whose messages may be recorded/);
    assert.match(appHtml, /bot administrator can view these records/);
    assert.match(appHtml, /app-loading/);
    assert.match(appHtml, /richy-md-icon\.png/);
    assert.doesNotMatch(appHtml, /telegram-widget|Sign in with Telegram/);
    assert.match(appHtml, /assets\/videos\/app-theme\.mp4/);
    assert.match(appHtml, /assets\/videos\/music\.mp3/);
    assert.equal(manifest.status, 200);
    const appManifest = await manifest.json();
    assert.equal(appManifest.start_url, '/app/');
    assert.equal(appManifest.icons[0].src, '/app/icon.webp');
});

test('health server streams media ranges and serves the optimized app icon', async (t) => {
    const server = startHealthServer(0);
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const [video, audio, icon] = await Promise.all([
        fetch(`${baseUrl}/assets/videos/app-theme.mp4`, { headers: { Range: 'bytes=0-31' } }),
        fetch(`${baseUrl}/assets/videos/music.mp3`, { method: 'HEAD' }),
        fetch(`${baseUrl}/app/icon.webp`, { method: 'HEAD' }),
    ]);

    assert.equal(video.status, 206);
    assert.equal(video.headers.get('accept-ranges'), 'bytes');
    assert.equal(video.headers.get('content-range'), `bytes 0-31/${fs.statSync(path.join(__dirname, '..', 'assets', 'videos', 'app-theme.mp4')).size}`);
    assert.equal((await video.arrayBuffer()).byteLength, 32);
    assert.match(audio.headers.get('content-type'), /audio\/mpeg/);
    assert.equal(audio.headers.get('accept-ranges'), 'bytes');
    assert.match(icon.headers.get('content-type'), /image\/webp/);

    const invalidRange = await fetch(`${baseUrl}/assets/videos/app-theme.mp4`, {
        headers: { Range: 'bytes=999999999-' },
    });
    assert.equal(invalidRange.status, 416);
    assert.match(invalidRange.headers.get('content-range'), /^bytes \*\/\d+$/);
});

test('health server serves an APK when built and reports it missing otherwise', async (t) => {
    const server = startHealthServer(0);
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/downloads/Base-Tele-X-WA.apk`, {
        method: 'HEAD',
    });

    const apkExists = fs.existsSync(path.join(__dirname, '..', 'website', 'downloads', 'Base-Tele-X-WA.apk'));
    assert.equal(response.status, apkExists ? 200 : 404);
    if (apkExists) {
        assert.match(response.headers.get('content-type'), /application\/vnd\.android\.package-archive/);
        assert.match(response.headers.get('content-disposition'), /filename="Base-Tele-X-WA\.apk"/);
        assert.ok(Number(response.headers.get('content-length')) > 0);
    }
});

test('health server delegates app API requests with non-static methods', async (t) => {
    const appApi = (request, response, pathname) => {
        const body = JSON.stringify({ method: request.method, pathname });
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(body);
    };
    const server = startHealthServer(0, appApi);
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/sessions`, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { method: 'POST', pathname: '/api/sessions' });
});
