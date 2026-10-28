// La giornata: il foglio letto più ciò che segna Riccardo. Un intervento si riconosce da
// cliente + tipologia + comune (l'id del lettore), così un foglio nuovo non cancella gli esiti.

const ESITO_VUOTO = { stato: null, motivoKo: '', euroExtra: '' };
// «8.30-9» del PDF e «8:30-9:00» dell'ufficio sono lo stesso orario: si confrontano le ore lette, il testo solo se non si legge
const ora = o => (o.da ? `${o.da}-${o.a}` : o.testo);

export function nuovaGiornata(foglio) {
  return {
    iso: foglio.data?.iso ?? null, tecnico: foglio.tecnico, data: foglio.data, tabella: foglio.tabella,
    interventi: foglio.interventi.map(i => ({ ...structuredClone(i), esito: { ...ESITO_VUOTO }, aggiunte: {}, tolto: false })),
    cambi: [],
  };
}

// Un foglio nuovo per lo stesso giorno: prende orari, note e celle dal nuovo, tiene gli esiti,
// e dice cosa è cambiato. Gli interventi tolti restano (col loro esito) ma escono dal giro.
export function unisci(giornata, foglio) {
  if (foglio.data?.iso !== giornata.iso) throw new Error('foglio di un altro giorno');
  const vecchi = new Map(giornata.interventi.map(i => [i.id, i]));
  const cambi = [];
  const interventi = foglio.interventi.map(nuovo => {
    const v = vecchi.get(nuovo.id);
    vecchi.delete(nuovo.id);
    if (!v || v.tolto) {
      cambi.push({ tipo: 'aggiunto', n: nuovo.n, id: nuovo.id });
    } else {
      if (ora(v.orario) !== ora(nuovo.orario)) cambi.push({ tipo: 'orario', n: nuovo.n, id: nuovo.id, prima: v.orario.testo, dopo: nuovo.orario.testo });
      if (v.note !== nuovo.note) cambi.push({ tipo: 'note', n: nuovo.n, id: nuovo.id, prima: v.note, dopo: nuovo.note });
    }
    return { ...structuredClone(nuovo), esito: v ? { ...v.esito } : { ...ESITO_VUOTO }, aggiunte: { ...v?.aggiunte }, tolto: false };
  });
  for (const v of vecchi.values()) {
    if (v.aMano) { interventi.push(structuredClone(v)); continue; }
    if (!v.tolto) cambi.push({ tipo: 'tolto', n: v.n, id: v.id });
    interventi.push({ ...structuredClone(v), tolto: true });
  }
  return { ...giornata, tecnico: foglio.tecnico, data: foglio.data, tabella: foglio.tabella, interventi, cambi };
}

export function segna(giornata, id, esito) {
  return {
    ...giornata,
    interventi: giornata.interventi.map(i => (i.id === id ? { ...i, esito: { ...i.esito, ...esito } } : i)),
  };
}

// Ciò che il foglio non ha e Riccardo aggiunge (via, telefono): resta suo anche se arriva un foglio nuovo.
export function aggiungi(giornata, id, aggiunte) {
  return {
    ...giornata,
    interventi: giornata.interventi.map(i => (i.id === id ? { ...i, aggiunte: { ...i.aggiunte, ...aggiunte } } : i)),
  };
}

// L'ordine viene dall'orario del foglio, a parità dall'ordine del foglio; mai dallo stato.
// Un intervento senza orario leggibile resta dopo quello che lo precede nel foglio.
export function ordinati(giornata) {
  let prima = '00:00';
  return giornata.interventi
    .filter(i => !i.tolto)
    .sort((p, q) => p.n - q.n)
    .map(i => ({ i, k: (prima = i.orario.da ?? prima) }))
    .sort((p, q) => p.k.localeCompare(q.k) || p.i.n - q.i.n)
    .map(x => x.i);
}
