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

// Il codice di «Pubblica su Giro» del poster shop. Arriva dagli appunti, cioè da fuori: si accetta solo la forma attesa
// (immagini di Comic Vine, posizioni intere piccole, un colore #rrggbb); ogni altra cosa si scarta.
const IMMAGINE = /^https:\/\/comicvine\.gamespot\.com\/a\/uploads\/[\w./-]+\.(jpe?g|png|webp|gif)$/i;
export function leggiCodice(testo) {
  const m = /^\s*giro-parete:([A-Za-z0-9_-]+)={0,2}\s*$/.exec(testo ?? '');
  let j = null;
  try { j = m && JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; }
  const intero = v => Number.isInteger(v) && Math.abs(v) <= 40;
  const tessere = (Array.isArray(j?.tessere) ? j.tessere : [])
    .filter(t => Array.isArray(t) && IMMAGINE.test(t[0]) && !t[0].includes('..') && intero(t[1]) && intero(t[2])).slice(0, 60)
    .map(([url, col, row]) => ({ url, col, row }));
  if (j?.v !== 1 || !tessere.length) return null;
  return { colore: /^#[0-9a-f]{6}$/i.test(j.colore) ? j.colore : null, tessere };
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

// null se non ha ancora scelto copertine; sennò { prima(testo, sotto), chiudi() }
export async function mostraParete() {
  const salvata = await leggiCopertine();
  const composta = Array.isArray(salvata) ? null : salvata;
  if (!composta && !salvata.length) return null;
  const larga = innerWidth - 44, alta = innerHeight - 70, gap = 8; // margine per le copertine inclinate
  const box = el('div', 'ingresso'), led = el('div', 'led'), muro = el('div', 'muro'), balloon = el('div', 'balloon');
  box.setAttribute('role', 'status');
  box.setAttribute('aria-label', 'Sto leggendo il foglio');
  let scelte;
  if (composta) {
    // la parete com'è stata composta sul poster shop: stesse posizioni, stesso colore del muro, niente caso
    const cols = composta.tessere.map(t => t.col), rows = composta.tessere.map(t => t.row);
    const c0 = Math.min(...cols), r0 = Math.min(...rows), nc = Math.max(...cols) - c0 + 1, nr = Math.max(...rows) - r0 + 1;
    const w = Math.min((larga - gap * (nc - 1)) / nc, ((alta - gap * (nr - 1)) / nr) * 0.65);
    Object.assign(muro.style, { gridTemplateColumns: `repeat(${nc}, ${w}px)`, gridTemplateRows: `repeat(${nr}, ${w / 0.65}px)`, justifyContent: 'center', alignContent: 'center' });
    if (composta.colore) box.style.background = composta.colore;
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
  box.append(led, muro, balloon, el('div', 'salta', 'Tocca per entrare'));
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
      led.classList.add('fatto');
      setTimeout(() => {
        if (chiusa) return;
        balloon.append(el('span', '', testo), sotto ? el('small', '', sotto) : '');
        balloon.classList.add('su');
        setTimeout(chiudi, 1300);
      }, fermo ? 0 : Math.max(0, Math.min(scelte.length, 16) * 50 + 280 - (performance.now() - inizio)));
    },
  };
}
