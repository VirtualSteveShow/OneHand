const CACHE = 'onehand-v15';
// HTML is not pre-cached — always fetched fresh from network. Gaze's
// external CDN dependencies (MediaPipe) are deliberately NOT listed here —
// pre-caching them at SW install time would fail the whole install if the
// CDN is briefly unreachable; they get opportunistically cached on first
// real use instead, same as any other cross-origin fetch this SW sees.
const ASSETS = [
    'style.css', 'hub.js', 'manifest.json',
    'games/flap/style.css', 'games/flap/flap.js',
    'games/dash/style.css', 'games/dash/dash.js',
    'games/charge/style.css', 'games/charge/charge.js',
    'games/orbit/style.css', 'games/orbit/orbit.js',
    'games/sling/style.css', 'games/sling/sling.js',
    'games/tilt/style.css', 'games/tilt/tilt.js',
    'games/flick/style.css', 'games/flick/flick.js',
    'games/gaze/style.css', 'games/gaze/gaze.js',
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
