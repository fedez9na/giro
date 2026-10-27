// Il foglio che torna all'ufficio: il LORO PDF, con le sole celle vuote (esito, motivo KO, euro
// extra) riempite nelle coordinate che il lettore ha già trovato. Niente orari, posizioni o km:
// quelli sono dati di Riccardo e restano sul telefono.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const MARGINE = 2;

export async function compilaPdf(bytes, giornata) {
  const pdf = await PDFDocument.load(bytes);
  const pagina = pdf.getPage(0);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const ammessi = new Set(font.getCharacterSet());
  const pulisci = s => [...String(s ?? '')].filter(c => ammessi.has(c.codePointAt(0))).join('').trim();

  const scrivi = (testo, cella) => {
    testo = pulisci(testo);
    if (!testo) return;
    const largo = cella.x1 - cella.x0 - 2 * MARGINE, alto = cella.y1 - cella.y0 - 2 * MARGINE;
    // stesso corpo (8,8 pt) e stessa riga di base in fondo alla cella del testo che scrive Excel; se non ci sta, va a capo e rimpicciolisce
    let size = 8.8, righe;
    for (; size >= 5; size -= 0.4) {
      righe = aCapo(testo, font, size, largo);
      if (righe.length * size * 1.15 <= alto && righe.every(r => font.widthOfTextAtSize(r, size) <= largo)) break;
    }
    const passo = size * 1.15, base = cella.y0 + MARGINE + 0.5;
    righe.forEach((r, k) => pagina.drawText(r, { x: cella.x0 + MARGINE, y: base + (righe.length - 1 - k) * passo, size, font, color: rgb(0, 0, 0) }));
  };

  for (const i of giornata.interventi) {
    if (i.tolto || !i.esito?.stato) continue;
    scrivi(i.esito.stato, i.celle.esito);
    if (i.esito.stato === 'KO') scrivi(i.esito.motivoKo, i.celle.motivoKo);
    scrivi(i.esito.euroExtra, i.celle.euroExtra);
  }
  return pdf.save();
}

function aCapo(testo, font, size, largo) {
  const righe = [];
  for (const parola of testo.split(/\s+/)) {
    const prova = righe.length ? `${righe.at(-1)} ${parola}` : parola;
    if (righe.length && font.widthOfTextAtSize(prova, size) <= largo) righe[righe.length - 1] = prova;
    else righe.push(parola);
  }
  return righe;
}
