// Come si scrivono le cose del foglio per chi legge (app, calendario): un posto solo.
export const hm = t => (t ? t.replace(/^0/, '') : '');
export const nomeComune = c => c.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, l => l.toUpperCase());
const TIPO = { 'FASTWEB 3.5': 'Fastweb 3.5', 'INS.KOLME': 'Installazione Kolme', 'DIS. FASTWEB': 'Disinstallazione Fastweb', 'FASTWEB 3.5 + EXT.': 'Fastweb 3.5 + ext.' };
export const tipo = t => TIPO[t] ?? t;
export const notePer = i => [i.vincoli.puntuale && 'Puntuale', i.vincoli.chiamaPrima && 'chiamalo prima',
  i.vincoli.nonPrima && `non prima delle ${hm(i.vincoli.nonPrima)}`].filter(Boolean).join(', ');
