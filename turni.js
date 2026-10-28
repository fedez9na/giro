// I turni che l'ufficio scrive nella sua tabella e pubblica: le stesse colonne del loro foglio, più via e telefono.
// Qui solo logica (niente pagina, niente rete): la usano la pagina del gestore e Giro.
import { leggiVincoli, norm } from './lettore.js';
import { hm } from './testi.js';

export const CAMPI = ['da', 'a', 'cliente', 'tipologia', 'comune', 'via', 'telefono', 'note'];
const MASSIMO = { da: 5, a: 5, cliente: 120, tipologia: 60, comune: 60, via: 160, telefono: 30, note: 500 };
const ORA = /^([01]\d|2[0-3]):[0-5]\d$/;

const vuota = r => CAMPI.every(c => !r[c]);
export const pulite = righe => righe
  .map(r => ({ id: r.id, ...Object.fromEntries(CAMPI.map(c => [c, String(r[c] ?? '').trim().slice(0, MASSIMO[c])])) }))
  .map(r => ({ ...r, da: ORA.test(r.da) ? r.da : '', a: ORA.test(r.a) ? r.a : '' }))
  .filter(r => !vuota(r));

// Le righe numerate come le vede il gestore: si contano solo quelle piene
export function problemi(righe) {
  const p = pulite(righe);
  if (!p.length) return ['Non c’è nessuna riga da pubblicare'];
  return p.flatMap((r, k) => [
    !r.comune && `Riga ${k + 1}: manca il comune`,
    r.a && !r.da && `Riga ${k + 1}: c’è l’ora «a» ma non «da»`,
    r.a && r.da && r.a < r.da && `Riga ${k + 1}: l’ora «a» viene prima di «da»`,
  ].filter(Boolean));
}

const chiaveRiga = r => norm(`${r.cliente}|${r.tipologia}|${r.comune}`);

// Il PDF che l'ufficio fa già diventa righe. Una riga che c'era (stesso cliente, lavoro e comune) tiene il suo id,
// e via e telefono scritti a mano: così chi ha già segnato un esito non lo perde.
export function daFoglio(foglio, esistenti, nuovoId = () => crypto.randomUUID()) {
  const vecchie = new Map(pulite(esistenti).map(r => [chiaveRiga(r), r]));
  return foglio.interventi.map(i => {
    const r = { da: i.orario.da ?? '', a: i.orario.a ?? '', cliente: i.cliente, tipologia: i.tipologia, comune: i.comune, note: i.note };
    const v = vecchie.get(chiaveRiga(r));
    vecchie.delete(chiaveRiga(r));
    return { id: v?.id ?? nuovoId(), ...r, via: v?.via ?? '', telefono: v?.telefono ?? '' };
  });
}

// I turni pubblicati ({ versione, iso, tecnico, righe }) come un foglio letto: Giro li apre con nuovaGiornata / unisci.
// L'id è quello della riga: resta lo stesso anche se l'ufficio corregge il cliente, e l'esito non si perde.
export function foglioDaTurni(t) {
  return {
    tecnico: t.tecnico ?? '', data: { iso: t.iso }, tabella: null,
    interventi: pulite(t.righe).map((r, k) => {
      const orario = { testo: r.da ? (r.a ? `${hm(r.da)}-${hm(r.a)}` : hm(r.da)) : '', da: r.da || null, a: r.a || null };
      return { n: k + 1, id: r.id, cliente: r.cliente, tipologia: r.tipologia, comune: r.comune, orario, note: r.note,
        vincoli: leggiVincoli(r.note, orario), via: r.via, telefono: r.telefono,
        compilato: { esito: '', motivoKo: '', euroExtra: '' }, celle: null };
    }),
  };
}

// Un giorno aperto dal PDF che poi arriva anche dall'ufficio: gli interventi del PDF prendono l'id della riga
// corrispondente, così unisci tiene esiti e aggiunte invece di vedere tutto tolto e aggiunto.
export function adottaId(giornata, foglio) {
  const nuovi = new Map(foglio.interventi.map(i => [chiaveRiga(i), i.id]));
  return { ...giornata, interventi: giornata.interventi.map(i => (nuovi.has(i.id) ? { ...i, id: nuovi.get(i.id) } : i)) };
}

// Cosa torna all'ufficio: solo ciò che il loro foglio chiede. Orari di arrivo, posizione e ciò che Riccardo aggiunge restano suoi.
export const esitiDi = g => Object.fromEntries(g.interventi
  .filter(i => !i.tolto && (i.esito.stato || i.esito.motivoKo || i.esito.euroExtra))
  .map(i => [i.id, { stato: i.esito.stato, motivoKo: i.esito.motivoKo, euroExtra: i.esito.euroExtra }]));

export const uguali = (a, b) => JSON.stringify(pulite(a)) === JSON.stringify(pulite(b));
