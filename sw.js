/* Service worker: guarda la app en el celular para que abra sin señal */
const CACHE = 'memorias-obra-v1.0.0';
const ARCHIVOS = [
  './', 'index.html', 'app.js', 'xl.js', 'importar.js', 'exceljs.min.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/maskable-512.png',
  'fonts/ibm-plex-sans-condensed-latin-400-normal.woff2', 'fonts/ibm-plex-sans-condensed-latin-500-normal.woff2',
  'fonts/ibm-plex-sans-condensed-latin-600-normal.woff2', 'fonts/ibm-plex-sans-condensed-latin-700-normal.woff2',
  'fonts/ibm-plex-mono-latin-400-normal.woff2', 'fonts/ibm-plex-mono-latin-600-normal.woff2',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS.map((u) => new Request(u, { cache: 'reload' })))));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'activar') self.skipWaiting(); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // el servidor de Google va directo a la red
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then((r) => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req)));
});
