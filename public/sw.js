const CACHE = 'onehand-v8';
// HTML is not pre-cached — always fetched fresh from network
const ASSETS = [
    'style.css', 'hub.js', 'manifest.json',
    'games/flap/style.css', 'games/flap/flap.js',
    'games/dash/style.css', 'games/dash/dash.js',
    'games/charge/style.css', 'games/charge/charge.js',
    'games/orbit/style.css', 'games/orbit/orbit.js',
    'games/sling/style.css', 'games/sling/sling.js',
];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE)
            .then(c => c.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== CACHE).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    // Network-first: always try fresh, fall back to cache if offline
    e.respondWith(
        fetch(e.request)
            .then(res => {
                const clone = res.clone();
                caches.open(CACHE).then(c => c.put(e.request, clone));
                return res;
            })
            .catch(() => caches.match(e.request))
    );
});
