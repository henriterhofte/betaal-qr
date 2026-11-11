// Offline-cache. tools/bouw.py vervangt 'betaalqr-dev' door 'betaalqr-<commit>', zodat elke uitrol
// een nieuwe cache krijgt en de oude wordt opgeruimd.
var VERSIE = 'betaalqr-dev';
var BESTANDEN = [
  './', 'index.html', 'controleer.html', 'style.css', 'app.js', 'epc.js', 'versie.js', 'vendor/qrcode.js',
  'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSIE).then(function (c) { return c.addAll(BESTANDEN); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (namen) {
    return Promise.all(namen.filter(function (n) { return n !== VERSIE; }).map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.clients.claim(); }));
});

// Eigen bestanden: eerst de cache (werkt offline), anders het netwerk.
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(function (r) { return r || fetch(e.request); }));
});
