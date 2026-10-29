// I margini del giro. Non sappiamo quanto dura un lavoro: il margine è il tempo che resta per il
// lavoro se arriva a inizio finestra; un ritardo si annuncia solo contro una durata confermata.

const min = hhmm => (hhmm ? +hhmm.slice(0, 2) * 60 + +hhmm.slice(3) : null);
export const piu = (hhmm, m) => {
  if (hhmm == null) return null;
  const t = min(hhmm) + m;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

// Quanto manca all'orario: prima dell'inizio «tra …»; dentro la finestra «chiude tra …»; dopo niente (magari è già al lavoro).
export const durata = m => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);
export function quantoManca(orario, adesso) {
  const da = min(orario.da);
  let a = min(orario.a);
  if (da == null) return '';
  if (a != null && a < da) a = da >= 18 * 60 && a <= 6 * 60 ? a + 1440 : null;
  if (adesso < da) return `tra ${durata(da - adesso)}`;
  return a != null && adesso < a ? `chiude tra ${durata(a - adesso)}` : '';
}

// Il punto stretto: fra ciò che resta da fare, il passaggio col tempo più corto fra due inizi
// (lavoro e strada insieme: non serve sapere la guida per dirlo, ed è un dato vero del foglio).
export function puntoStretto(interventi) {
  const resta = interventi.filter(i => !i.esito?.stato && i.orario.da);
  let meglio = null;
  for (let k = 0; k + 1 < resta.length; k++) {
    const minuti = min(resta[k + 1].orario.da) - min(resta[k].orario.da);
    const puntuale = !!(resta[k].vincoli?.puntuale || resta[k + 1].vincoli?.puntuale);
    if (!meglio || minuti < meglio.minuti || (minuti === meglio.minuti && puntuale && !meglio.puntuale)) {
      meglio = { da: resta[k], a: resta[k + 1], minuti, puntuale };
    }
  }
  return meglio;
}

// `interventi` già in ordine; `guida(comuneA, comuneB)` dà i minuti di guida o null.
export function tratti(interventi, guida) {
  return interventi.slice(1).map((dopo, k) => {
    const prima = interventi[k];
    const stessoComune = prima.comune === dopo.comune;
    const g = stessoComune ? null : guida(prima.comune, dopo.comune);
    const ok = g != null && prima.orario.da && dopo.orario.da;
    return {
      da: prima.n, a: dopo.n, stessoComune, guida: g,
      margine: ok ? min(dopo.orario.da) - min(prima.orario.da) - g : null,
      partiAlle: ok ? piu(dopo.orario.da, -g) : null,
      partiEntro: ok ? piu(dopo.orario.a ?? dopo.orario.da, -g) : null,
    };
  });
}

// Minuti in macchina. La posizione resta nel telefono: serve solo a trovare il comune dove si è (il centro più vicino;
// oltre 8 km da ogni centro si è fuori zona e non si dà un numero). I minuti sono nella tabella strade.json:
// da centro a centro del comune, senza traffico (OSRM su OpenStreetMap). 255 = nessun percorso.
export function comuneVicino(tabella, chiavi, lat, lon, maxKm = 8) {
  const c = Math.cos(lat * Math.PI / 180);
  let meglio = null, km = Infinity;
  for (const k of chiavi) {
    const p = tabella[k];
    const d = p ? Math.hypot(p[0] - lat, (p[1] - lon) * c) * 111.2 : Infinity;
    if (d < km) { km = d; meglio = k; }
  }
  return km <= maxKm ? meglio : null;
}

// `ors`: i minuti di OpenRouteService già presi («A|B» → minuti), più vicini al vero della tabella (Federico, 29/10:
// Pogliano→Busto ORS 33, tabella 23, Google col traffico 37); dove mancano, la tabella.
export function minutiGuida(strade, da, a, ors = {}) {
  if (da === a) return 0;
  if (Number.isFinite(ors[`${da}|${a}`])) return ors[`${da}|${a}`];
  if (!strade) return null;
  const i = strade.comuni.indexOf(da), j = strade.comuni.indexOf(a);
  const m = i < 0 || j < 0 ? 255 : strade.minuti[i * strade.comuni.length + j];
  return m === 255 ? null : m;
}
