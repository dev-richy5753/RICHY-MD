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
    assert.match(pageHtml, /dashboard-showcase/);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), 'ok\n');
    assert.equal(config.status, 200);
    assert.equal(typeof (await config.json()).telegramBotUrl, 'string');
    assert.equal(app.status, 200);
    assert.match(await app.text(), /Pair a WhatsApp number/);
    assert.equal(manifest.status, 200);
    assert.equal((await manifest.json()).start_url, '/app/');
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
