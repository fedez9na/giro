// La parete d'ingresso: le copertine che Riccardo sceglie dalle SUE foto, come la parete della sua stanza.
// Restano solo in questo telefono (IndexedDB): il sito non ne pubblica nessuna. Si vede quando apre il foglio del mattino,
// mentre l'app lo legge (la striscia verde in alto è il caricamento, come il LED della stanza); un tocco la salta.

const apri = () => new Promise((ok, no) => {
  const r = indexedDB.open('giro', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('parete');
  r.onsuccess = () => ok(r.result);
  r.onerror = () => no(r.error);
});
const passo = (modo, fn) => apri().then(db => new Promise((ok, no) => {
  const t = db.transaction('parete', modo), r = fn(t.objectStore('parete'));
  t.oncomplete = () => ok(r.result);
  t.onerror = () => no(t.error);
}));
// due forme: un elenco di immagini (le sue foto) o una parete composta sul poster shop ({ colore, tessere })
export const leggiCopertine = () => Promise.race([
  passo('readonly', s => s.get('copertine')).then(v => v ?? []),
  new Promise(ok => setTimeout(() => ok([]), 800)), // se il telefono non risponde, il foglio si apre lo stesso senza parete
]).catch(() => []);
export const salvaCopertine = parete => passo('readwrite', s => s.put(parete, 'copertine'));
// senza la scadenza di 800 ms: chi decide se coprire la parete (la stanza dal server, l'uscita) deve sapere davvero cosa c'è;
// se il telefono non risponde, rifiuta e non si tocca niente
export const leggiCopertineAdagio = () => passo('readonly', s => s.get('copertine')).then(v => v ?? []);

// Il codice di «Pubblica su Giro» del poster shop. Arriva dagli appunti, cioè da fuori: si accetta solo la forma attesa
// (immagini di Comic Vine, posizioni intere piccole, un colore #rrggbb); ogni altra cosa si scarta.
// letto come indirizzo vero: il 6% delle copertine di Comic Vine ha %20/%24/~ e alcune non hanno estensione (misurato su 6.036)
const immagine = s => {
  if (typeof s !== 'string' || s.length > 300) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && u.hostname === 'comicvine.gamespot.com' && u.pathname.startsWith('/a/uploads/')
      && !u.search && !u.hash && !u.port && !u.username && !u.password && u.href === s; // forma canonica: niente ../ né spazi
  } catch {
    return false;
  }
};
export function leggiCodice(testo) {
  const m = /^\s*giro-parete:([A-Za-z0-9_-]+)={0,2}\s*$/.exec(testo ?? '');
  let j = null;
  try { j = m && JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; }
  return validaParete(j);
}

// la stessa forma arriva dal codice incollato e dal poster shop: si controlla sempre qui
export function validaParete(j) {
  const intero = v => Number.isInteger(v) && Math.abs(v) <= 40;
  const tessere = (Array.isArray(j?.tessere) ? j.tessere : [])
    .filter(t => Array.isArray(t) && immagine(t[0]) && intero(t[1]) && intero(t[2])).slice(0, 60)
    .map(([url, col, row]) => ({ url, col, row }));
  if (j?.v !== 1 || !tessere.length) return null;
  return { colore: /^#[0-9a-f]{6}$/i.test(j.colore) ? j.colore : null, tessere };
}

// «Una volta e basta»: il codice di collegamento del poster shop si mette in Giro una volta sola; poi ogni «Pubblica su
// Giro» si scarica da qui. Al poster shop va solo il codice (16 caratteri a caso): nessun dato del foglio, nessuna posizione.
export const NEGOZIO = 'https://immersive-poster-shop.vercel.app/api/giro';
export const leggiCollegamento = testo => /^\s*giro-collega:([a-z0-9]{16})\s*$/.exec(testo ?? '')?.[1] ?? null;
// null se non c'è niente di pubblicato, se la rete non va o se arriva qualcosa di storto: la parete salvata resta
export async function scaricaParete(id, f = fetch) {
  if (!/^[a-z0-9]{16}$/.test(id ?? '')) return null;
  try {
    const r = await f(`${NEGOZIO}?id=${id}`, { cache: 'no-store', signal: AbortSignal.timeout?.(10000) });
    return r.ok ? validaParete(await r.json()) : null;
  } catch {
    return null;
  }
}

// a 900 px di altezza: 25 copertine stanno in pochi MB
export async function prepara(file) {
  const img = await createImageBitmap(file);
  const k = Math.min(1, 900 / img.height);
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  img.close();
  return new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.82));
}

// colonne scelte perché ogni posto abbia la forma di una copertina (circa 2:3), non per tagliarle
export function colonne(quante, larga, alta) {
  const forma = c => Math.abs(larga / c / (alta / Math.ceil(quante / c)) - 0.65);
  return [1, 2, 3, 4].reduce((a, c) => (forma(c) < forma(a) ? c : a));
}

const PIEGHE = [-2, 1.5, -1, 2, -1.5, 1, -2.5, 1.8, -0.8, 1.2, -1.6, 2.2];
const el = (tag, classe, testo) => Object.assign(document.createElement(tag), { className: classe, textContent: testo ?? '' });

// I LED tutt'intorno al telefono, come la striscia della sua stanza ma di tutti i colori e sempre in giro:
// due cornici uguali, una nitida e una sfocata per l'alone. Con «riduci movimento» restano ferme.
export const cornice = () => [el('div', 'cornice-led'), el('div', 'cornice-led alone')];

// Le copertine sul muro, nello spazio dato: la parete composta sul poster shop (sue posizioni, suo colore) o le sue foto
// (12 a caso, ogni volta un'altra parete). null se non ha ancora scelto niente.
export async function costruisciMuro(larga, alta) {
  const salvata = await leggiCopertine();
  const composta = Array.isArray(salvata) ? null : salvata;
  if (!composta && !salvata.length) return null;
  const gap = 8, muro = el('div', 'muro');
  let scelte;
  if (composta) {
    // la parete com'è stata composta sul poster shop: stesse posizioni, stesso colore del muro, niente caso
    const cols = composta.tessere.map(t => t.col), rows = composta.tessere.map(t => t.row);
    const c0 = Math.min(...cols), r0 = Math.min(...rows), nc = Math.max(...cols) - c0 + 1, nr = Math.max(...rows) - r0 + 1;
    const w = Math.min((larga - gap * (nc - 1)) / nc, ((alta - gap * (nr - 1)) / nr) * 0.65);
    Object.assign(muro.style, { gridTemplateColumns: `repeat(${nc}, ${w}px)`, gridTemplateRows: `repeat(${nr}, ${w / 0.65}px)`, justifyContent: 'center', alignContent: 'center' });
    scelte = composta.tessere.map(t => ({ url: t.url, colonna: t.col - c0 + 1, riga: t.row - r0 + 1 }));
  } else {
    const mescolate = salvata.map(b => [Math.random(), b]).sort((a, b) => a[0] - b[0]).map(x => x[1]); // ogni mattina un'altra parete
    const col = colonne(Math.min(12, mescolate.length), larga, alta);
    scelte = mescolate.slice(0, Math.min(mescolate.length, col * Math.ceil(Math.min(12, mescolate.length) / col))).map(b => ({ blob: b }));
    const righe = Math.ceil(scelte.length / col), w = Math.min((larga - gap * (col - 1)) / col, ((alta - gap * (righe - 1)) / righe) * 0.65);
    Object.assign(muro.style, { gridTemplateColumns: `repeat(${col}, ${w}px)`, gridTemplateRows: `repeat(${righe}, ${w / 0.65}px)`, justifyContent: 'center', alignContent: 'center' });
  }
  const indirizzi = [];
  scelte.forEach((c, n) => {
    const img = el('img', 'copertina');
    img.alt = '';
    if (c.blob) indirizzi.push(img.src = URL.createObjectURL(c.blob));
    else {
      img.referrerPolicy = 'no-referrer'; // a Comic Vine non si dice da che pagina arriva
      img.onerror = () => { img.style.visibility = 'hidden'; };
      img.src = c.url;
      Object.assign(img.style, { gridColumn: String(c.colonna), gridRow: String(c.riga) });
    }
    img.style.setProperty('--r', `${PIEGHE[n % PIEGHE.length]}deg`);
    img.style.setProperty('--t', `${Math.min(n, 16) * 50}ms`);
    muro.append(img);
  });
  return { muro, quante: scelte.length, indirizzi, colore: composta?.colore ?? null };
}
export const liberaMuro = m => m?.indirizzi.forEach(u => URL.revokeObjectURL(u));

// L'ingresso mentre legge il foglio. null se non ha ancora scelto copertine; sennò { prima(testo, sotto), chiudi() }
export async function mostraParete() {
  const m = await costruisciMuro(innerWidth - 44, innerHeight - 70); // margine per le copertine inclinate e per i LED
  if (!m) return null;
  const { muro, indirizzi } = m;
  const box = el('div', 'ingresso'), balloon = el('div', 'balloon');
  box.setAttribute('role', 'status');
  box.setAttribute('aria-label', 'Sto leggendo il foglio');
  if (m.colore) box.style.background = m.colore;
  box.append(muro, balloon, el('div', 'salta', 'Tocca per entrare'), ...cornice());
  document.body.append(box);
  const inizio = performance.now(), fermo = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let chiusa = false;
  const chiudi = () => {
    if (chiusa) return;
    chiusa = true;
    box.classList.add('via');
    setTimeout(() => { box.remove(); indirizzi.forEach(u => URL.revokeObjectURL(u)); }, 260);
  };
  box.addEventListener('click', chiudi);
  return {
    chiudi,
    // il foglio è letto: la striscia arriva in fondo e, quando le copertine sono attaccate, il balloon dice la prima tappa;
    // poi si entra da soli
    prima(testo, sotto) {
      if (chiusa) return;
      setTimeout(() => {
        if (chiusa) return;
        balloon.append(el('span', '', testo), sotto ? el('small', '', sotto) : '');
        balloon.classList.add('su');
        setTimeout(chiudi, 1300);
      }, fermo ? 0 : Math.max(0, Math.min(m.quante, 16) * 50 + 280 - (performance.now() - inizio)));
    },
  };
}
