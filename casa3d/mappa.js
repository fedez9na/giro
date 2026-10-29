// La carta della casa: le strade da OpenFreeMap (tile vettoriali, schema OpenMapTiles), i percorsi fra le tappe da OpenRouteService
// (la nostra funzione su Supabase: nella richiesta solo le chiavi dei due comuni). Quando arriva il foglio, con la rete, si
// scaricano qui i tile del riquadro del giro e i percorsi delle coppie di tappe di fila, e restano nel telefono per quel giorno
// (Cache «mappa:<giorno>»): la casa si apre senza rete per tutta la giornata. Senza rete e senza niente salvato: i comuni e le rette
// tratteggiate, dichiarate. Niente three.js qui: l'app lo importa da sola per scaricare quando arriva il foglio.

const TILEJSON = 'https://tiles.openfreemap.org/planet';
const MEMORIA_TILE = 'giro:mappa-tile';       // l'indirizzo dei tile letto dal TileJSON (contiene la data della versione)
const ZOOM = 11;                              // a z11 ci sono le strade fino alle terziarie e le aree abitate: per 22-40 km bastano
const PARALLELE = 3;                          // le regole d'uso: al massimo 4 richieste insieme
export const ZONA = [45.775, 8.975];          // il centro della zona dei 749 comuni: la carta senza giro
export const ATTRIBUZIONE = '© OpenMapTiles © OpenStreetMap contributors';
// i percorsi: la funzione «percorso» su Supabase (server/percorso/), che li chiede a OpenRouteService e li tiene per tutti;
// riceve solo le chiavi dei due comuni
export const FUNZIONE = 'https://easlpebduevcyljcsxlt.supabase.co/functions/v1/percorso';

// ---------- proiezione: sinusoidale locale sull'ellissoide WGS84 (x est, y nord, metri), come strumenti/plastico.py ----------
const WGS_A = 6378137, WGS_E2 = (1 / 298.257223563) * (2 - 1 / 298.257223563), G = Math.PI / 180;
const raggi = lat => { const s = Math.sin(lat * G), w = Math.sqrt(1 - WGS_E2 * s * s); return [WGS_A * (1 - WGS_E2) / w ** 3, WGS_A / w]; };
export const sinusoidale = (lat0, lon0) => (lat, lon) => [(lon - lon0) * G * raggi(lat)[1] * Math.cos(lat * G), (lat - lat0) * G * raggi((lat + lat0) / 2)[0]];
export const inversa = (lat0, lon0) => (x, y) => {
  let lat = lat0 + y / (G * raggi(lat0)[0]);
  lat = lat0 + y / (G * raggi((lat + lat0) / 2)[0]);
  return [lat, lon0 + x / (G * raggi(lat)[1] * Math.cos(lat * G))];
};

// Il riquadro della carta: quadrato sulle tappe con un margine, almeno 22 km; senza giro 30 km attorno al centro della zona.
// centri: [[lat, lon], ...] dei comuni del giro (comuni.json). Lo usano sia lo scarico sia la casa: devono dare gli stessi tile.
export function riquadro(centri) {
  const zona = sinusoidale(...ZONA);
  if (!centri.length) { const [cx, cy] = zona(...ZONA); return { zona, cx, cy, latoM: 30000 }; }
  const xy = centri.map(c => zona(...c)), xs = xy.map(p => p[0]), ys = xy.map(p => p[1]);
  return { zona, cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2,
    latoM: Math.max(22000, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 1.35 + 6000) };
}
// i tile z/x/y che coprono il riquadro (Web Mercator)
const tileX = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const tileY = (lat, z) => Math.floor((1 - Math.log(Math.tan(lat * G) + 1 / Math.cos(lat * G)) / Math.PI) / 2 * 2 ** z);
export function tiles({ cx, cy, latoM }, z = ZOOM) {
  const inv = inversa(...ZONA), m = latoM / 2;
  const angoli = [[-m, -m], [m, -m], [m, m], [-m, m]].map(([dx, dy]) => inv(cx + dx, cy + dy));
  const lat = angoli.map(a => a[0]), lon = angoli.map(a => a[1]), out = [];
  for (let x = tileX(Math.min(...lon), z); x <= tileX(Math.max(...lon), z); x++)
    for (let y = tileY(Math.max(...lat), z); y <= tileY(Math.min(...lat), z); y++) out.push([z, x, y]);
  return out;
}
// da coordinate di tile (0..estensione) a lat/lon
export function daTile(z, x, y, estensione) {
  const n = 2 ** z;
  return (px, py) => {
    const lon = (x + px / estensione) / n * 360 - 180, t = Math.PI * (1 - 2 * (y + py / estensione) / n);
    return [Math.atan(Math.sinh(t)) / G, lon];
  };
}

// ---------- tile vettoriale (Mapbox Vector Tile 2.1): un decodificatore protobuf minimo, solo ciò che serve alla carta ----------
// Tile { layers = 3 }; Layer { name = 1, features = 2, keys = 3, values = 4, extent = 5 }; Feature { tags = 2, type = 3, geometry = 4 };
// Value { string = 1, float = 2, double = 3, int = 4, uint = 5, sint = 6, bool = 7 }. Geometria: comandi MoveTo/LineTo/ClosePath.
function lettore(buf) {
  let p = 0;
  const v = () => { let r = 0, m = 1, b; do { b = buf[p++]; r += (b & 127) * m; m *= 128; } while (b & 128); return r; };
  const campi = (fine, f) => { while (p < fine) { const k = v(), n = k >> 3, t = k & 7; const prima = p; f(n, t); if (p === prima) salta(t); } };
  const salta = t => { if (t === 0) v(); else if (t === 1) p += 8; else if (t === 2) p += v(); else if (t === 5) p += 4; else throw new Error('mvt: tipo ' + t); };
  return { v, campi, salta, get p() { return p; }, set p(x) { p = x; }, buf };
}
const zz = n => (n % 2 ? -(n + 1) / 2 : n / 2);
export function decodifica(buf, voluti = null) {
  const L = lettore(buf instanceof Uint8Array ? buf : new Uint8Array(buf)), dec = new TextDecoder(), livelli = {};
  const testo = () => { const n = L.v(), s = dec.decode(L.buf.subarray(L.p, L.p + n)); L.p += n; return s; };
  L.campi(L.buf.length, (n, t) => {
    if (n !== 3 || t !== 2) return;
    const fine = L.v() + L.p, liv = { nome: '', estensione: 4096, chiavi: [], valori: [], grezze: [] };
    L.campi(fine, (m, tt) => {
      if (m === 1) liv.nome = testo();
      else if (m === 2) { const n2 = L.v(); liv.grezze.push([L.p, L.p + n2]); L.p += n2; }
      else if (m === 3) liv.chiavi.push(testo());
      else if (m === 4) {
        const f2 = L.v() + L.p; let val = null;
        L.campi(f2, (k, t3) => {
          if (k === 1) val = testo();
          else if (k === 2) { val = new DataView(L.buf.buffer, L.buf.byteOffset + L.p, 4).getFloat32(0, true); L.p += 4; }
          else if (k === 3) { val = new DataView(L.buf.buffer, L.buf.byteOffset + L.p, 8).getFloat64(0, true); L.p += 8; }
          else if (k === 4 || k === 5) val = L.v();
          else if (k === 6) val = zz(L.v());
          else if (k === 7) val = !!L.v();
          else L.salta(t3);
        });
        liv.valori.push(val);
      } else if (m === 5) liv.estensione = L.v();
    });
    if (voluti && !voluti.includes(liv.nome)) return;
    liv.elementi = liv.grezze.map(([a, b]) => {
      const el = { tipo: 0, prop: {}, geo: [] };
      const q = L.p; L.p = a;
      L.campi(b, (k) => {
        if (k === 2) { const f3 = L.v() + L.p; while (L.p < f3) { const kk = L.v(), vv = L.v(); el.prop[liv.chiavi[kk]] = liv.valori[vv]; } }
        else if (k === 3) el.tipo = L.v();
        else if (k === 4) {
          const f3 = L.v() + L.p; let x = 0, y = 0, anello = null;
          while (L.p < f3) {
            const c = L.v(), id = c & 7, quanti = c >> 3;
            if (id === 7) { if (anello) anello.chiuso = true; continue; }
            for (let i = 0; i < quanti; i++) {
              x += zz(L.v()); y += zz(L.v());
              if (id === 1) { anello = [[x, y]]; el.geo.push(anello); } else anello.push([x, y]);
            }
          }
        }
      });
      L.p = q;
      return el;
    });
    delete liv.grezze;
    livelli[liv.nome] = liv;
  });
  return livelli;
}

// ---------- scaricare e tenere: Cache «mappa:<giorno>» (o «mappa:zona»), chiavi finte che non vanno mai in rete ----------
const chiaveTile = (z, x, y) => `${location.origin}/__mappa/t/${z}/${x}/${y}.pbf`;
const chiavePercorso = (da, a) => `${location.origin}/__mappa/p/${encodeURIComponent(da)}/${encodeURIComponent(a)}.json`;
const apriCache = nome => (globalThis.caches ? caches.open(nome).catch(() => null) : Promise.resolve(null));
let letturaTileJson = null; // tutti i tile insieme: il TileJSON si legge una volta
function indirizzoTile(nuovo = false) {
  let m = null;
  try { m = JSON.parse(localStorage.getItem(MEMORIA_TILE)); } catch { /* niente */ }
  if (!nuovo && m?.url && Date.now() - m.t < 3 * 864e5) return Promise.resolve(m.url);
  letturaTileJson ??= (async () => {
    try {
      const j = await (await fetch(TILEJSON, scadenza())).json();
      const url = j?.tiles?.[0];
      if (typeof url === 'string' && /^https:\/\/tiles\.openfreemap\.org\/[\w/.-]+\{z\}\/\{x\}\/\{y\}\.pbf$/.test(url)) {
        try { localStorage.setItem(MEMORIA_TILE, JSON.stringify({ url, t: Date.now() })); } catch { /* pieno: si rilegge */ }
        return url;
      }
    } catch { /* senza rete: quello salvato, anche vecchio */ }
    return m?.url ?? null;
  })().finally(() => { setTimeout(() => { letturaTileJson = null; }, 0); });
  return letturaTileJson;
}
// un tile: dalla cache del giorno, sennò dalla rete (e lo si tiene). null se non c'è e non si può avere.
const inVolo = new Map(); // la casa e lo scarico del foglio chiedono gli stessi tile insieme: una richiesta sola
export function tile(nome, z, x, y, op = {}) {
  const k = `${nome} ${z}/${x}/${y}`;
  if (!inVolo.has(k)) inVolo.set(k, prendiTile(nome, z, x, y, op).finally(() => inVolo.delete(k)));
  return inVolo.get(k);
}
const ATTESA = 10000; // una rete che non risponde non tiene ferma la casa: dopo 10 s si disegna senza
const scadenza = () => (globalThis.AbortSignal?.timeout ? { signal: AbortSignal.timeout(ATTESA) } : {});
async function prendiTile(nome, z, x, y, { soloCache = false } = {}) {
  const c = await apriCache(nome), k = chiaveTile(z, x, y);
  const r = await c?.match(k);
  if (r) return new Uint8Array(await r.arrayBuffer());
  if (soloCache) return null;
  for (const nuovo of [false, true]) { // una versione dei tile ritirata: si rilegge il TileJSON una volta
    const url = await indirizzoTile(nuovo);
    if (!url) return null;
    try {
      const risposta = await fetch(url.replace('{z}', z).replace('{x}', x).replace('{y}', y), scadenza());
      if (risposta.status === 404 && !nuovo) continue;
      if (!risposta.ok) return null;
      const b = new Uint8Array(await risposta.arrayBuffer());
      await c?.put(k, new Response(b, { headers: { 'content-type': 'application/vnd.mapbox-vector-tile' } })).catch(() => {});
      return b;
    } catch { return null; }
  }
  return null;
}
// il percorso fra due comuni (chiavi di strade.json): { coords: [[lon, lat], ...], metri, secondi } oppure null
export async function percorso(nome, da, a, { soloCache = false } = {}) {
  const c = await apriCache(nome), k = chiavePercorso(da, a);
  const r = await c?.match(k);
  if (r) return r.json();
  if (soloCache) return null;
  const p = await percorsoFra(da, a);
  if (p) await c?.put(k, new Response(JSON.stringify(p), { headers: { 'content-type': 'application/json' } })).catch(() => {});
  return p;
}
const valido = p => (p && Array.isArray(p.coords) && p.coords.length >= 2 && p.coords.every(c => Array.isArray(c) && c.length >= 2 && c.every(Number.isFinite))
  && Number.isFinite(p.metri) ? { coords: p.coords.map(([lon, lat]) => [lon, lat]), metri: p.metri, secondi: Number.isFinite(p.secondi) ? p.secondi : null } : null);
export async function percorsoFra(da, a) {
  try {
    const r = await fetch(FUNZIONE, { ...scadenza(), method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ da, a }) });
    return r.ok ? valido(await r.json()) : null;
  } catch { return null; }
}
// a più alla volta, ma non più di PARALLELE
async function inFila(lavori) {
  const esiti = [], coda = [...lavori.entries()];
  await Promise.all(Array.from({ length: PARALLELE }, async () => { for (let e = coda.shift(); e; e = coda.shift()) esiti[e[0]] = await e[1]().catch(() => null); }));
  return esiti;
}
// quando arriva il foglio: tile del riquadro e percorsi delle coppie di fila, nella cache di quel giorno
export async function prepara(iso, tappe) { // tappe: [{ chiave, centro: [lat, lon] }] in ordine
  const nome = `mappa:${iso}`, con = tappe.filter(t => t.centro);
  const R = riquadro(con.map(t => t.centro));
  const coppie = con.slice(1).map((t, i) => [con[i].chiave, t.chiave]).filter(([a, b]) => a !== b);
  const t = await inFila([...tiles(R).map(([z, x, y]) => () => tile(nome, z, x, y)), ...coppie.map(([a, b]) => () => percorso(nome, a, b))]);
  return { tile: tiles(R).length, presi: t.filter(Boolean).length };
}
// si tengono le carte dei giorni ancora nel telefono (e quella della zona)
export async function pulisci(giorni) {
  if (!globalThis.caches) return;
  for (const n of await caches.keys()) if (/^mappa:\d{4}-\d{2}-\d{2}$/.test(n) && !giorni.includes(n.slice(6))) await caches.delete(n);
}
