// I margini del giro. Non sappiamo quanto dura un lavoro: il margine è il tempo che resta per il
// lavoro se arriva a inizio finestra; un ritardo si annuncia solo contro una durata confermata.

const min = hhmm => (hhmm ? +hhmm.slice(0, 2) * 60 + +hhmm.slice(3) : null);
export const piu = (hhmm, m) => {
  if (hhmm == null) return null;
  const t = min(hhmm) + m;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

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
