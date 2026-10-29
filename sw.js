// Senza rete: i file dell'app stanno in cache e si servono da lì. Il PDF condiviso (Android) arriva qui come POST.
const VERSIONE = 'giro-10';
const FILE = ['./', 'index.html', 'app.css', 'app.js', 'lettore.js', 'giornata.js', 'compila.js', 'link.js', 'margini.js', 'calendario.js', 'testi.js', 'meteo.js', 'parete.js', 'turni.js', 'cifra.js', 'ufficio.js', 'stanza.js', 'vendor/supabase.js', 'comuni.json', 'strade.json', 'vendor/Bangers-Regular.ttf',
  'manifest.webmanifest', 'icona.svg', 'icona-192.png', 'icona-512.png',
  'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs', 'vendor/pdf-lib.esm.min.js'];

// cache: 'reload' = dal server, non dalla memoria del browser. E ?v=VERSIONE: il CDN di Pages tiene i file 10 minuti dopo un rilascio,
// e il 28/10 un'installazione in quei minuti ha preso un lettore.js vecchio accanto a un gestore.js nuovo (pagina che non partiva).
// Un indirizzo mai chiesto prima il CDN non ce l'ha: va a prenderlo nuovo. Si salva sotto il nome semplice.
self.addEventListener('install', e => e.waitUntil(caches.open(VERSIONE)
  .then(c => Promise.all(FILE.map(async f => {
    const r = await fetch(new Request(`${f}?v=${VERSIONE}`, { cache: 'reload' }));
    if (!r.ok) throw new Error(`${f}: ${r.status}`); // come addAll: o tutti o nessuno, si riprova alla prossima apertura
    return c.put(f, r);
  }))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(k => Promise.all(k.filter(n => n !== VERSIONE && n !== 'condivisi' && n !== 'parete').map(n => caches.delete(n)))).then(() => self.clients.claim())));

// La notifica dell'ufficio: il testo lo scrive il server dalla data, senza dati dei clienti. iPhone vuole sempre una notifica visibile.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data?.json() ?? {}; } catch { /* testo non JSON: notifica generica */ }
  const giorno = /^\d{4}-\d{2}-\d{2}$/.test(d.data ?? '') ? d.data : '';
  e.waitUntil(self.registration.showNotification(String(d.titolo ?? 'Turni pubblicati').slice(0, 60), {
    body: String(d.testo ?? 'L’ufficio ha pubblicato i turni').slice(0, 160), icon: 'icona-192.png', badge: 'icona-192.png',
    tag: `turni-${giorno}`, renotify: true, data: { giorno } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const giorno = e.notification.data?.giorno ?? '';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(lista => {
    const app = lista.find(c => new URL(c.url).pathname.endsWith('/') || c.url.includes('index.html'));
    if (app) { app.postMessage({ giorno }); return app.focus(); }
    return self.clients.openWindow(giorno ? `./?giorno=${giorno}` : './');
  }));
});

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
