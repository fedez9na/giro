// Senza rete: i file dell'app stanno in cache e si servono da lì. Il PDF condiviso (Android) arriva qui come POST.
const VERSIONE = 'giro-4';
const FILE = ['./', 'index.html', 'app.css', 'app.js', 'lettore.js', 'giornata.js', 'compila.js', 'link.js', 'margini.js',
  'manifest.webmanifest', 'icona.svg', 'icona-192.png', 'icona-512.png',
  'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs', 'vendor/pdf-lib.esm.min.js'];

self.addEventListener('install', e => e.waitUntil(caches.open(VERSIONE).then(c => c.addAll(FILE)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(k => Promise.all(k.filter(n => n !== VERSIONE && n !== 'condivisi').map(n => caches.delete(n)))).then(() => self.clients.claim())));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname.endsWith('/condividi')) {
    e.respondWith((async () => {
      const f = (await e.request.formData()).get('foglio');
      if (f) await (await caches.open('condivisi')).put('foglio', new Response(f));
      return Response.redirect('./?condiviso=1', 303);
    })());
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // dalla cache subito (funziona senza rete), e intanto si aggiorna: alla prossima apertura c'è la versione nuova
  e.respondWith(caches.open(VERSIONE).then(async c => {
    const inCache = await c.match(e.request, { ignoreSearch: true });
    const dallaRete = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => inCache);
    if (inCache) { e.waitUntil(dallaRete); return inCache; }
    return dallaRete;
  }));
});
