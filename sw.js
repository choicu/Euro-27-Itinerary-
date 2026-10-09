// Bump CACHE_VERSION on every app-shell change so phones pick up the update.
const CACHE_VERSION = 'v19';
const SHELL_CACHE = `europe2027-shell-${CACHE_VERSION}`;

const SHELL_FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'icons.js',
  'data.js',
  'manifest.webmanifest',
  'manifest-friends.webmanifest',
  'manifest-switch.js',
  'data/itinerary.snapshot.csv',
  'content/handy.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Live sheet data is NOT handled here: data.js caches it itself (with its real
  // fetch time), so an offline phone never mislabels an old copy as "just updated".
  if (url.origin !== self.location.origin) return;

  // App shell: cache-first, fall back to network.
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => cached || fetch(request))
  );
});
