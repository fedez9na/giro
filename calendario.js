// La giornata nel Calendario del telefono (file .ics, RFC 5545). Dentro solo comune, lavoro e note:
// MAI il nome del cliente né la via, perché il calendario si sincronizza con iCloud o Google.
import { nomeComune, tipo, notePer } from './testi.js';

const ESCI = s => String(s).replace(/[\\;,]/g, c => `\\${c}`).replace(/\n/g, '\\n');
const UTC = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
const MINUTI_SENZA_FINE = 30;
const AVVISO_MINUTI = 30; // ponytail: senza tempi di guida l'avviso è fisso; con F2 diventa «parti alle…»

// righe lunghe piegate a 75 byte, come vuole lo standard
function piega(riga) {
  const enc = new TextEncoder();
  const out = [];
  let cur = '';
  for (const c of riga) {
    if (enc.encode(cur + c).length > (out.length ? 74 : 75)) { out.push(cur); cur = ''; }
    cur += c;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function creaIcs(interventi, iso, adesso = new Date()) {
  const righe = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Giro//Giornata//IT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const i of interventi) {
    if (!i.orario.da) continue;
    const inizio = new Date(`${iso}T${i.orario.da}`);
    const fine = i.orario.a ? new Date(`${iso}T${i.orario.a}`) : new Date(inizio.getTime() + MINUTI_SENZA_FINE * 6e4);
    const dove = nomeComune(i.comune);
    const note = notePer(i);
    righe.push('BEGIN:VEVENT', `UID:giro-${iso}-${i.n}@giro`, `DTSTAMP:${UTC(adesso)}`, `DTSTART:${UTC(inizio)}`, `DTEND:${UTC(fine)}`,
      `SUMMARY:${ESCI(`${tipo(i.tipologia)} – ${dove}`)}`, `LOCATION:${ESCI(`${dove}, Italia`)}`,
      ...(note ? [`DESCRIPTION:${ESCI(note)}`] : []),
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${ESCI(`Fra ${AVVISO_MINUTI} minuti: ${dove}`)}`, `TRIGGER:-PT${AVVISO_MINUTI}M`, 'END:VALARM',
      'END:VEVENT');
  }
  righe.push('END:VCALENDAR');
  return righe.map(piega).join('\r\n') + '\r\n';
}
