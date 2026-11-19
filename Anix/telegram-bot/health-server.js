const fs = require('fs');
const http = require('http');
const path = require('path');

const WEBSITE_ROOT = path.resolve(__dirname, '..', 'website');
const ASSETS_ROOT = path.resolve(__dirname, '..', 'assets');
const CONTENT_TYPES = {
    '.apk': 'application/vnd.android.package-archive',
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webm': 'video/webm',
    '.webp': 'image/webp',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
};
const TELEGRAM_HOSTS = new Set(['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me']);

function configuredTelegramUrl() {
    const value = process.env.TELEGRAM_BOT_URL?.trim();
    if (!value) return '';

    try {
        const url = new URL(value);
        if (url.protocol === 'https:' && TELEGRAM_HOSTS.has(url.hostname.toLowerCase())) {
            return url.href;
        }
    } catch {
        // Report invalid configuration below.
    }

    console.error('[http] TELEGRAM_BOT_URL must be an HTTPS link to t.me or telegram.me');
    return '';
}

function staticFilePath(pathname) {
    const isAsset = pathname.startsWith('/assets/');
    const root = isAsset ? ASSETS_ROOT : WEBSITE_ROOT;
    const relativePath = isAsset
        ? pathname.slice('/assets/'.length)
        : pathname === '/' ? 'index.html'
            : pathname === '/app' || pathname === '/app/' ? 'app/index.html'
                : pathname.slice(1);
    const target = path.resolve(root, relativePath);

    if (relativePath.split(path.sep).some((part) => part.startsWith('.'))) return null;
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) return null;
    return target;
}

function startHealthServer(port, appApi) {
    const telegramBotUrl = configuredTelegramUrl();
    const server = http.createServer((request, response) => {
        let pathname;
        try {
            pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        } catch {
            response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('bad request\n');
            return;
        }

        if (pathname.startsWith('/api/')) {
            if (appApi) {
                appApi(request, response, pathname);
                return;
            }
            response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
            response.end(JSON.stringify({ error: 'The app API is not configured.' }));
            return;
        }

        if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('method not allowed\n');
            return;
        }

        if (pathname === '/health') {
            response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end(request.method === 'HEAD' ? undefined : 'ok\n');
            return;
        }

        if (pathname === '/site-config.json') {
            const body = JSON.stringify({ telegramBotUrl });
            response.writeHead(200, {
                'Cache-Control': 'no-store',
                'Content-Length': Buffer.byteLength(body),
                'Content-Type': 'application/json; charset=utf-8',
                'X-Content-Type-Options': 'nosniff',
            });
            response.end(request.method === 'HEAD' ? undefined : body);
            return;
        }

        const filePath = staticFilePath(pathname);
        if (!filePath) {
            response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('not found\n');
            return;
        }

        fs.stat(filePath, (error, stats) => {
            if (error) {
                if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') {
                    console.error(`[http] Failed to inspect website file: ${error.message}`);
                    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                    response.end('internal server error\n');
                    return;
                }

                response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                response.end('not found\n');
                return;
            }

            if (!stats.isFile()) {
                response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                response.end('not found\n');
                return;
            }

            const extension = path.extname(filePath).toLowerCase();
            response.writeHead(200, {
                'Cache-Control': extension === '.apk' ? 'no-store' : 'no-cache',
                'Content-Length': stats.size,
                'Content-Type': CONTENT_TYPES[extension] || 'application/octet-stream',
                'X-Content-Type-Options': 'nosniff',
                ...(extension === '.apk'
                    ? { 'Content-Disposition': 'attachment; filename="Base-Tele-X-WA.apk"' }
                    : {}),
            });

            if (request.method === 'HEAD') {
                response.end();
                return;
            }

            const fileStream = fs.createReadStream(filePath);
            fileStream.on('error', (streamError) => {
                console.error(`[http] Failed to serve website file: ${streamError.message}`);
                if (response.headersSent) response.destroy(streamError);
                else {
                    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                    response.end('internal server error\n');
                }
            });
            fileStream.pipe(response);
        });
    });

    server.listen(port, '0.0.0.0');
    return server;
}

module.exports = { startHealthServer };
