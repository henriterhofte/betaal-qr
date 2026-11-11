// SPDX-FileCopyrightText: 2026 Henri ter Hofte
// SPDX-License-Identifier: EUPL-1.2
// Offline-cache. tools/bouw.py vervangt de cachenaam hieronder door betaalqr-<commit>, zodat elke uitrol
// een nieuwe cache krijgt en de oude wordt opgeruimd.
var VERSIE = 'betaalqr-dev';
// Tijdelijke plek voor een gedeelde PDF (Android: "Delen → Betaal-QR"). De app haalt hem op en wist hem.
var GEDEELD = 'betaalqr-gedeeld';
var BESTANDEN = [
  './', 'index.html', 'controleer.html', 'style.css', 'app.js', 'epc.js', 'versie.js', 'vendor/qrcode.js',
  'factuur.js', 'herinnering.js', 'pdflezer.mjs', 'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs', 'vendor/jsqr/jsQR.js',
  'beeld/henri.jpg', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'
];

self.addEventListener('install', function (e) {
  // cache: 'reload' haalt elk bestand vers van de server, niet uit de HTTP-cache van de browser
  // (GitHub Pages laat bestanden 10 minuten cachen; zonder dit kon een update half oud zijn).
  e.waitUntil(caches.open(VERSIE).then(function (c) {
    return c.addAll(BESTANDEN.map(function (u) { return new Request(u, { cache: 'reload' }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (namen) {
    return Promise.all(namen.filter(function (n) { return n !== VERSIE && n !== GEDEELD; }).map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // Web Share Target: het besturingssysteem stuurt de gedeelde PDF als POST naar ./gedeeld.
  // We vangen die hier op het apparaat af; er gaat niets naar de server.
  if (e.request.method === 'POST' && /\/gedeeld\/?$/.test(url.pathname)) {
    e.respondWith(bewaarGedeeld(e.request));
    return;
  }

  // Eigen bestanden: eerst de cache (werkt offline), anders het netwerk.
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(function (r) { return r || fetch(e.request); }));
});

function bewaarGedeeld(request) {
  return request.formData().then(function (fd) {
    var bestand = fd.get('factuur');
    if (!bestand || typeof bestand === 'string') return Response.redirect('./?gedeeld=leeg', 303);
    return caches.open(GEDEELD).then(function (c) {
      return c.put('gedeelde-factuur', new Response(bestand, {
        headers: { 'Content-Type': bestand.type || 'application/pdf', 'X-Bestandsnaam': encodeURIComponent(bestand.name || 'factuur.pdf') }
      }));
    }).then(function () { return Response.redirect('./?gedeeld=1', 303); });
  }).catch(function () { return Response.redirect('./?gedeeld=fout', 303); });
}
