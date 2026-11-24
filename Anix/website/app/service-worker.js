const CACHE_NAME = 'richy-md-app-shell-v22';
const APP_SHELL = [
    '/app/',
    '/app/app.css?v=22',
    '/app/notices.js?v=22',
    '/app/app.js?v=22',
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

    if (requestUrl.pathname === '/app/notices.js' || requestUrl.pathname === '/app/app.js') {
        event.respondWith(fetch(event.request).then((response) => {
            const responseCopy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseCopy));
            return response;
        }).catch(() => caches.match(event.request)));
        return;
    }

    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
