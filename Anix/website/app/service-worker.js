const CACHE_NAME = 'richy-md-app-shell-v15';
const APP_SHELL = [
    '/app/',
    '/app/app.css',
    '/app/app.js',
    '/app/manifest.webmanifest',
    '/app/icon-512.png',
    '/app/icon.webp',
    '/assets/images/richy-md-icon.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(
            keys.filter((key) => key.startsWith('richy-md-app-shell-') && key !== CACHE_NAME)
                .map((key) => caches.delete(key))
        ))
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const requestUrl = new URL(event.request.url);
    if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin) return;
    if (requestUrl.pathname.startsWith('/api/')) return;

    if (requestUrl.pathname === '/app/' || requestUrl.pathname === '/app') {
        event.respondWith(fetch(event.request).catch(() => caches.match('/app/')));
        return;
    }

    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
