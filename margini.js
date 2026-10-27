// I margini del giro. Non sappiamo quanto dura un lavoro: il margine è il tempo che resta per il
// lavoro se arriva a inizio finestra; un ritardo si annuncia solo contro una durata confermata.

const min = hhmm => (hhmm ? +hhmm.slice(0, 2) * 60 + +hhmm.slice(3) : null);
export const piu = (hhmm, m) => {
  if (hhmm == null) return null;
  const t = min(hhmm) + m;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

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
