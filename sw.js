const CACHE_VERSION = 'v1';
const SHELL_CACHE = `europe2027-shell-${CACHE_VERSION}`;
const DATA_CACHE = `europe2027-data-${CACHE_VERSION}`;

const SHELL_FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'data.js',
  'manifest.webmanifest',
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
      Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isDataRequest(url) {
  return url.hostname.includes('docs.google.com') || url.hostname.includes('googleusercontent.com');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (isDataRequest(url)) {
    // Network-first for live sheet data, fall back to cache.
    event.respondWith(
      fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(DATA_CACHE).then((cache) => cache.put(request, copy));
        return res;
      }).catch(() => caches.match(request))
    );
    return;
  }

  if (url.origin === self.location.origin) {
    // Cache-first for the app shell.
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request))
    );
  }
});
