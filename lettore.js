// Il lettore del foglio dei turni. Separato da tutto il resto: è il pezzo che cambierà per primo
// (altre colonne, un altro committente, l'Excel). Righe e colonne vengono dai BORDI della tabella,
// le intestazioni danno solo il nome alla colonna: l'ordine del testo nel PDF non è affidabile.

const COLONNE = {
  cliente: 'CLIENTE', tipologia: 'TIPOLOGIA ODL', comune: 'INDIRIZZO', orario: 'ORARIO',
  esito: 'ESITO ODL', note: 'NOTE', motivoKo: 'MOTIVO KO', euroExtra: 'EURO EXTRA',
};
const GIORNI = ['DOMENICA', 'LUNEDI', 'MARTEDI', 'MERCOLEDI', 'GIOVEDI', 'VENERDI', 'SABATO'];
const MESI = ['GENNAIO', 'FEBBRAIO', 'MARZO', 'APRILE', 'MAGGIO', 'GIUGNO', 'LUGLIO', 'AGOSTO',
  'SETTEMBRE', 'OTTOBRE', 'NOVEMBRE', 'DICEMBRE'];

const r1 = v => Math.round(v * 10) / 10;
// ordine di lettura: dall'alto in basso, e sulla stessa riga (baseline entro 3 pt) da sinistra a destra
const lettura = (p, q) => (Math.abs(p.y - q.y) > 3 ? q.y - p.y : p.x - q.x);
export const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

// Si può scegliere qualunque file (Federico, 29/10): il tipo si capisce dai primi byte, non dal nome né da quello che dice il
// telefono (l'iPhone a volte non riconosce un PDF arrivato da WhatsApp e lo rende grigio nel selettore).
export function tipoFile(b) {
  const testa = String.fromCharCode(...b.subarray(0, 1024));
  if (testa.includes('%PDF')) return 'pdf'; // la norma lo vuole nei primi 1024 byte, non per forza in testa
  if ((b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50) || /^....ftyp(hei[cs]|mif1|avif)/.test(testa)) return 'foto';
  return 'altro';
}

// Da un documento pdf.js a testi e linee. `OPS` è pdfjs.OPS (passato da fuori: qui niente import di pdf.js).
export async function estraiGeometria(doc, OPS) {
  if (doc.numPages !== 1) return { pagine: doc.numPages, testi: [], v: [], h: [] };
  const page = await doc.getPage(1);
  const testi = (await page.getTextContent()).items
    .filter(i => i.str && i.str.trim())
    .map(i => ({ x: i.transform[4], y: i.transform[5], w: i.width, s: i.str }));
  const ops = await page.getOperatorList();
  const v = [], h = [];
  ops.fnArray.forEach((f, k) => {
    if (f !== OPS.constructPath) return;
    const mm = ops.argsArray[k][2];
    if (!mm) return;
    const [x0, y0, x1, y1] = mm;
    if (x1 - x0 < 2 && y1 - y0 > 20) v.push({ a: r1(x0), b: r1(x1) });
    else if (y1 - y0 < 2 && x1 - x0 > 20) h.push({ a: r1(y0), b: r1(y1) });
  });
  const unici = l => l.sort((p, q) => p.a - q.a).filter((p, i, t) => !i || p.a - t[i - 1].a > 1);
  return { pagine: 1, testi, v: unici(v), h: unici(h) };
}

export function leggiOrario(testo) {
  const m = testo.trim().match(/^(\d{1,2})(?:[.:,](\d{2}))?(?:\s*-\s*(\d{1,2})(?:[.:,](\d{2}))?)?$/);
  const hhmm = (h, mi = '00') => (+h < 24 && +mi < 60 ? `${h.padStart(2, '0')}:${mi}` : null);
  if (!m) return { testo, da: null, a: null };
  const da = hhmm(m[1], m[2]);
  return { testo, da, a: da && m[3] ? hhmm(m[3], m[4]) : null };
}

// Le note sono vincoli: «NON PRIMA» vale per l'orario della riga, «DOPO LE 14» è un minimo,
// «CHIAMALO» è un'azione prima di arrivare, «PUNTUALE» vuol dire che il ritardo costa.
export function leggiVincoli(note, orario) {
  const n = norm(note);
  const ora = (h, mi) => leggiOrario(mi ? `${h}.${mi}` : h).da;
  const dopo = n.match(/DOPO LE (\d{1,2})(?:[.:,](\d{2}))?/);
  const nonPrima = n.match(/NON PRIMA(?: DELLE? (\d{1,2})(?:[.:,](\d{2}))?)?/);
  return {
    nonPrima: dopo ? ora(dopo[1], dopo[2]) : nonPrima ? (nonPrima[1] ? ora(nonPrima[1], nonPrima[2]) : orario.da) : null,
    chiamaPrima: /\bCHIAMA/.test(n),
    puntuale: /PUNTUAL/.test(n),
  };
}

// L'anno non c'è nel foglio: è quello, entro sei mesi da oggi, in cui quel giorno della settimana
// coincide. Se non coincide mai è un errore dell'ufficio (null).
export function annoDelFoglio(giornoSettimana, giorno, mese, oggi) {
  const g = GIORNI.indexOf(norm(giornoSettimana));
  const anni = [-1, 0, 1].map(d => oggi.getFullYear() + d)
    .map(a => new Date(a, mese - 1, giorno))
    .filter(d => d.getMonth() === mese - 1 && d.getDay() === g && Math.abs(d - oggi) < 183 * 864e5)
    .sort((p, q) => Math.abs(p - oggi) - Math.abs(q - oggi));
  return anni.length ? anni[0].getFullYear() : null;
}

function leggiIntestazione(testi, sopra, oggi) {
  const riga = norm(testi.filter(t => t.y > sopra).sort(lettura).map(t => t.s).join(' '));
  const m = riga.match(/TECNICO:?\s*(.*?)\s*DATA:?\s*([A-Z]+)\s+(\d{1,2})\s+([A-Z]+)/);
  if (!m) return { tecnico: '', data: null };
  const [giorno, mese] = [+m[3], MESI.indexOf(m[4]) + 1];
  const anno = mese ? annoDelFoglio(m[2], giorno, mese, oggi) : null;
  const iso = anno && `${anno}-${String(mese).padStart(2, '0')}-${String(giorno).padStart(2, '0')}`;
  return { tecnico: m[1], data: { giornoSettimana: m[2], giorno, mese: mese || null, anno, iso } };
}

export function leggiFoglio(g, oggi = new Date()) {
  if (g.pagine !== 1) return { errore: 'pagine' };
  if (!g.testi.length) return { errore: 'senza-testo' };
  const intest = {};
  for (const [k, nome] of Object.entries(COLONNE)) {
    const t = g.testi.find(t => norm(t.s) === nome);
    if (!t) return { errore: 'colonne' };
    intest[k] = t;
  }
  const yIntest = intest.cliente.y;
  if (Object.values(intest).some(t => Math.abs(t.y - yIntest) > 2)) return { errore: 'colonne' };

  // colonne: lo spazio fra la linea a sinistra e quella a destra del centro dell'intestazione
  const col = {};
  for (const [k, t] of Object.entries(intest)) {
    const c = t.x + t.w / 2;
    const sx = g.v.filter(l => l.a <= c).at(-1), dx = g.v.find(l => l.a >= c);
    if (!sx || !dx) return { errore: 'bordi' };
    col[k] = { x0: sx.b, x1: dx.a };
  }
  // righe: fra due linee orizzontali consecutive sotto l'intestazione (h è dal basso, y crescente)
  const sotto = g.h.filter(l => l.b < yIntest).reverse();
  const sopra = g.h.find(l => l.a > yIntest);
  if (sotto.length < 2 || !sopra) return { errore: 'bordi' };
  const { tecnico, data } = leggiIntestazione(g.testi, sopra.b, oggi);

  const interventi = [];
  for (let i = 0; i + 1 < sotto.length; i++) {
    const riga = { x0: g.v[0].b, x1: g.v.at(-1).a, y0: sotto[i + 1].b, y1: sotto[i].a };
    const cella = k => g.testi
      .filter(t => t.y > riga.y0 && t.y < riga.y1 && t.x >= col[k].x0 - 1 && t.x < col[k].x1)
      .sort(lettura)
      .map(t => t.s).join(' ').replace(/\s+/g, ' ').trim();
    const v = Object.fromEntries(Object.keys(COLONNE).map(k => [k, cella(k)]));
    if (!v.cliente && !v.tipologia && !v.comune) continue;
    const orario = leggiOrario(v.orario);
    const box = k => ({ x0: col[k].x0, x1: col[k].x1, y0: riga.y0, y1: riga.y1 });
    interventi.push({
      n: interventi.length + 1,
      id: norm(`${v.cliente}|${v.tipologia}|${v.comune}`),
      cliente: v.cliente, tipologia: v.tipologia, comune: v.comune, orario, note: v.note,
      vincoli: leggiVincoli(v.note, orario),
      // celle che l'ufficio lascia vuote: se il foglio arriva già compilato, si vede
      compilato: { esito: v.esito, motivoKo: v.motivoKo, euroExtra: v.euroExtra },
      celle: { riga, esito: box('esito'), motivoKo: box('motivoKo'), euroExtra: box('euroExtra') },
    });
  }
  if (!interventi.length) return { errore: 'vuoto' };
  const avvisi = [];
  if (!data) avvisi.push('intestazione');
  else if (!data.anno) avvisi.push('data-incoerente');
  const tabella = { x0: g.v[0].a, y0: g.h[0].a, x1: g.v.at(-1).b, y1: g.h.at(-1).b };
  return { tecnico, data, interventi, avvisi, tabella };
}
