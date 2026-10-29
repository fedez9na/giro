// Senza rete: i file dell'app stanno in cache e si servono da lì. Il PDF condiviso (Android) arriva qui come POST.
const VERSIONE = 'giro-12';
const FILE = ['./', 'index.html', 'app.css', 'app.js', 'lettore.js', 'giornata.js', 'compila.js', 'link.js', 'margini.js', 'calendario.js', 'testi.js', 'meteo.js', 'parete.js', 'turni.js', 'cifra.js', 'ufficio.js', 'stanza.js', 'vendor/supabase.js', 'comuni.json', 'strade.json', 'vendor/Bangers-Regular.ttf',
  'manifest.webmanifest', 'icona.svg', 'icona-192.png', 'icona-512.png',
  'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs', 'vendor/pdf-lib.esm.min.js',
  // la casa fotografata: si apre a ogni avvio, quindi si scaricherebbe comunque subito; in cache apre anche senza rete dopo un
  // aggiornamento (0,85 MB gzip). La carta del giorno (tile di OpenFreeMap e percorsi) no: la scarica casa3d/mappa.js quando
  // arriva il foglio, nelle cache «mappa:<giorno>», che qui sotto non si cancellano
  'casa3d/casa.js', 'casa3d/mappa.js', 'casa3d/vendor/three.module.min.js', 'casa3d/vendor/three.core.min.js', 'casa3d/stanza/camera.json', 'casa3d/stanza/lastre.json', 'casa3d/stanza/agx.png',
  'casa3d/stanza/base.webp', 'casa3d/stanza/led.webp', 'casa3d/stanza/led0.webp', 'casa3d/stanza/led1.webp', 'casa3d/stanza/striscia.webp', 'casa3d/stanza/insegna.webp',
  'casa3d/stanza/muro.webp', 'casa3d/stanza/carta.webp'];

// cache: 'reload' = dal server, non dalla memoria del browser. E ?v=VERSIONE: il CDN di Pages tiene i file 10 minuti dopo un rilascio,
// e il 28/10 un'installazione in quei minuti ha preso un lettore.js vecchio accanto a un gestore.js nuovo (pagina che non partiva).
// Un indirizzo mai chiesto prima il CDN non ce l'ha: va a prenderlo nuovo. Si salva sotto il nome semplice.
self.addEventListener('install', e => e.waitUntil(caches.open(VERSIONE)
  .then(c => Promise.all(FILE.map(async f => {
    const r = await fetch(new Request(`${f}?v=${VERSIONE}`, { cache: 'reload' }));
    if (!r.ok) throw new Error(`${f}: ${r.status}`); // come addAll: o tutti o nessuno, si riprova alla prossima apertura
    return c.put(f, r);
  }))).then(() => self.skipWaiting())));
// Una versione nuova ricarica subito le pagine aperte (Federico, 29/10: alla prima apertura dopo un rilascio vedeva ancora la
// versione vecchia, «dove sono tutte le modifiche?»). Solo se prima c'era un'altra versione: alla primissima installazione no.
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(async k => {
  const vecchie = k.filter(n => n !== VERSIONE && n !== 'condivisi' && n !== 'parete' && !n.startsWith('mappa:'));
  await Promise.all(vecchie.map(n => caches.delete(n)));
  await self.clients.claim();
  if (vecchie.some(n => n.startsWith('giro-'))) for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url).catch(() => {});
})));

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
