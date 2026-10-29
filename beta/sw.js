/* Service worker: guarda la app en el celular para que abra sin señal */
const CACHE = 'mobeta-v0.3.5';
const NUCLEO = [
  './', 'index.html', 'app.js', 'plano.js', 'vistas.js', 'planos-cad.js', 'xl.js', 'importar.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/maskable-512.png',
  'fonts/ibm-plex-sans-condensed-latin-400-normal.woff2', 'fonts/ibm-plex-sans-condensed-latin-500-normal.woff2',
  'fonts/ibm-plex-sans-condensed-latin-600-normal.woff2', 'fonts/ibm-plex-sans-condensed-latin-700-normal.woff2',
  'fonts/ibm-plex-mono-latin-400-normal.woff2', 'fonts/ibm-plex-mono-latin-600-normal.woff2',
];
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // Primero lo indispensable para abrir sin señal (liviano), luego el generador de Excel
    await c.addAll(NUCLEO.map((u) => new Request(u, { cache: 'reload' })));
    for (const lib of ['exceljs.min.js', 'jspdf.umd.min.js', 'three.min.js']) { try { await c.add(new Request(lib, { cache: 'reload' })); } catch (err) {} }
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('mobeta-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'activar') self.skipWaiting(); });
async function desdeCache(req) {
  const c = await caches.open(CACHE);
  const r = await c.match(req, { ignoreSearch: true });
  if (r) return r;
  const net = await fetch(req);
  if (net && net.ok && new URL(req.url).origin === location.origin) c.put(req, net.clone()).catch(() => {});
  return net;
}
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // el servidor de Google va directo a la red
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const r = (await c.match('index.html')) || (await c.match('./')) || (await caches.match('index.html', { ignoreSearch: true }));
      return r || fetch(req);
    })());
    return;
  }
  e.respondWith(desdeCache(req));
});
