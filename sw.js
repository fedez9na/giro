// Senza rete: i file dell'app stanno in cache e si servono da lì. Il PDF condiviso (Android) arriva qui come POST.
const VERSIONE = 'giro-6';
const FILE = ['./', 'index.html', 'app.css', 'app.js', 'lettore.js', 'giornata.js', 'compila.js', 'link.js', 'margini.js', 'calendario.js', 'testi.js', 'meteo.js', 'parete.js', 'comuni.json', 'strade.json', 'vendor/Bangers-Regular.ttf',
  'manifest.webmanifest', 'icona.svg', 'icona-192.png', 'icona-512.png',
  'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs', 'vendor/pdf-lib.esm.min.js'];

// cache: 'reload' = dal server, non dalla memoria del browser (GitHub Pages la tiene 10 minuti: si installerebbero file vecchi)
self.addEventListener('install', e => e.waitUntil(caches.open(VERSIONE)
  .then(c => c.addAll(FILE.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(k => Promise.all(k.filter(n => n !== VERSIONE && n !== 'condivisi' && n !== 'parete').map(n => caches.delete(n)))).then(() => self.clients.claim())));

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
  // le copertine della parete composta sul poster shop: da Comic Vine la prima volta, poi da qui (meno richieste fuori, e senza rete)
  if (e.request.method === 'GET' && url.hostname === 'comicvine.gamespot.com' && url.pathname.startsWith('/a/uploads/')) {
    e.respondWith(caches.open('parete').then(async c => (await c.match(e.request)) ?? fetch(e.request).then(r => {
      if (r.ok || r.type === 'opaque') c.put(e.request, r.clone());
      return r;
    })));
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.endsWith('/meteo.json')) return; // il meteo del lavoro giornaliero: sempre dalla rete (senza rete l'app usa quello salvato)
  // dalla cache subito (funziona senza rete), e intanto si aggiorna: alla prossima apertura c'è la versione nuova
  e.respondWith(caches.open(VERSIONE).then(async c => {
    const inCache = await c.match(e.request, { ignoreSearch: true });
    const dallaRete = fetch(e.request, { cache: 'no-cache' }).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => inCache);
    if (inCache) { e.waitUntil(dallaRete); return inCache; }
    return dallaRete;
  }));
});
