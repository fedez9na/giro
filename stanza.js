// La stanza di ogni tecnico (Federico, 28/10: «ogni tecnico decida lui cosa scrivere, cosa mettere»): la scritta sull'insegna
// sopra i poster e il colore dei LED. I poster restano in parete.js. Si tiene nel telefono e, per chi è collegato, anche sul
// server, chiusa con la sua chiave (ufficio.js): così su un telefono nuovo ritrova la sua stanza. Vince la modifica più nuova.
import { validaParete } from './parete.js';

// i colori della striscia LED (gli stessi della cornice); arcobaleno = la cornice che gira di adesso
export const COLORI = { arcobaleno: null, rosso: '#ff2d55', arancio: '#ff9500', giallo: '#ffcc00', verde: '#34c759', acqua: '#00c7be', blu: '#0a84ff', viola: '#bf5af2', bianco: '#f5f5f7' };
export const MAX = 18; // quanto ci sta sull'insegna di un telefono stretto (320 px)
const MEMORIA = 'giro:stanza';
// le lettere come le vede chi legge (un'emoji è una); Firefox prima del 125 non ha Segmenter: lì si conta per caratteri
const SEGMENTI = globalThis.Intl?.Segmenter ? new Intl.Segmenter('it') : null;
export const lettere = s => (SEGMENTI ? [...SEGMENTI.segment(s)].map(x => x.segment) : [...s]);

// una riga sola, senza caratteri nascosti; si taglia per lettere vere, così un'emoji non resta a metà.
// Dei caratteri di formato restano solo quelli che compongono le emoji: il «legante» (👩‍🔧) e le lettere «tag», ma solo dentro
// una delle tre bandiere vere che li usano (Inghilterra, Scozia, Galles). Via anche i selettori di variante supplementari
// (invisibili) e il «combining grapheme joiner». E una «lettera» non può essere lunga a piacere: 500 segni attaccati a una «a»
// contano come una lettera sola (il critico, 28/10), quindi oltre 120 unità in tutto ci si ferma, senza spezzarne una.
const tag = s => [...s].map(c => String.fromCodePoint(0xE0000 + c.codePointAt(0))).join('');
const BANDIERA_O_TAG = new RegExp(`(${['gbeng', 'gbsct', 'gbwls'].map(b => `\u{1F3F4}${tag(b)}\u{E007F}`).join('|')})|[\\u{E0000}-\\u{E007F}\\u{E0100}-\\u{E01EF}\\u034F\\u180B-\\u180F\\u115F\\u1160\\u3164\\uFFA0\\u2800]`, 'gu');
// ogni nuovo segno invisibile si può attaccare a una lettera: invece di inseguirli, una lettera più lunga di 16 unità si scarta
// (la più lunga emoji vera, una coppia con le tonalità della pelle, ne usa 15; la bandiera della Scozia 14)
const LETTERA_MAX = 16;
// selettori di variante e «legante» solo dove fanno un'emoji: un FE0F dopo un'emoji (o un tasto 0-9 # *), lo ZWJ fra due emoji;
// altrove sono segni invisibili che si possono ammucchiare su una lettera per nasconderci del testo (il critico, giro finale)
const EMOJI = /\p{Extended_Pictographic}/u;
function soloNelleEmoji(riga) {
  const cp = [...riga.replace(/[︀-︎឴឵]/g, '').replace(/([\p{Extended_Pictographic}#*0-9])️+|️+/gu, (_, base) => (base ? `${base}️` : ''))];
  // lo ZWJ resta se prima (saltando FE0F e tonalità della pelle) e dopo c'è un'emoji
  return cp.filter((c, i) => {
    if (c !== '‍') return true;
    let j = i - 1;
    while (j >= 0 && /[️\u{1F3FB}-\u{1F3FF}]/u.test(cp[j])) j--;
    return j >= 0 && EMOJI.test(cp[j]) && EMOJI.test(cp[i + 1] ?? '');
  }).join('');
}

export function pulisci(s) {
  const riga = soloNelleEmoji(String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').replace(BANDIERA_O_TAG, (_, bandiera) => bandiera ?? ''))
    .replace(/[\p{Cc}\p{Co}\p{Cn}]|(?![‍\u{E0020}-\u{E007F}])\p{Cf}/gu, '').trim();
  const fuori = [];
  let unita = 0;
  for (const l of lettere(riga)) {
    if (l.length > LETTERA_MAX) continue;
    if (fuori.length === MAX || unita + l.length > 120) break;
    fuori.push(l); unita += l.length;
  }
  return fuori.join('').trim();
}

// l'ora di una modifica: quella del telefono, ma sempre dopo l'ultima già vista (un telefono con l'orologio avanti
// non deve vincere per sempre: chi ha visto la sua stanza scrive dopo di lei)
export const prossimaOra = vista => Math.max(Date.now(), (vista?.t ?? 0) + 1);

// arriva anche dal server, cioè da fuori: si accetta solo la forma attesa (la parete passa dallo stesso controllo del codice)
export function valida(j) {
  if (!j || typeof j !== 'object' || j.v !== 1) return null;
  return { v: 1, scritta: pulisci(j.scritta), colore: Object.hasOwn(COLORI, j.colore) ? j.colore : 'arcobaleno',
    t: Number.isSafeInteger(j.t) && j.t > 0 && j.t < 1e13 ? j.t : 0, parete: j.parete ? validaParete(j.parete) : null,
    negozio: /^[a-z0-9]{16}$/.test(j.negozio ?? '') ? j.negozio : null }; // il collegamento al poster shop: torna anche dopo «Esci»
}

// la parete composta sul poster shop viaggia nella forma del suo codice; le foto (un elenco di immagini) restano nel telefono
export const aCodice = p => (p && !Array.isArray(p) && Array.isArray(p.tessere) ? { v: 1, colore: p.colore, tessere: p.tessere.map(t => [t.url, t.col, t.row]) } : null);

// fra quella del telefono e quella del server: 'locale' = va mandata, 'remota' = va presa, null = sono uguali
export function piuNuova(locale, remota) {
  if (!remota) return locale ? 'locale' : null;
  if (!locale) return 'remota';
  return remota.t > locale.t ? 'remota' : locale.t > remota.t ? 'locale' : null;
}

// sull'insegna: la sua scritta; se non l'ha ancora scritta il suo nome; senza account «Giro»
export const scrittaDi = (s, nome) => s?.scritta || pulisci(String(nome ?? '').trim().split(/\s+/)[0]) || 'Giro';

// nel telefono una sola, di chi l'ha fatta (null = senza account, e diventa sua quando si collega); quella di un altro no
export function leggiStanza(persona = null) {
  try {
    const j = JSON.parse(localStorage.getItem(MEMORIA));
    return j && (!j.persona || j.persona === persona) ? valida(j) : null;
  } catch {
    return null;
  }
}
export function scriviStanza(s, persona = null) {
  try { localStorage.setItem(MEMORIA, JSON.stringify({ v: 1, scritta: s.scritta, colore: s.colore, t: s.t, persona })); } catch { /* pieno: resta quella di prima */ }
}
export const dimenticaStanza = () => { try { localStorage.removeItem(MEMORIA); } catch { /* niente da togliere */ } };

// la striscia LED del colore scelto (la cornice legge --led-sfondo; senza, gira l'arcobaleno)
export function luci(colore) {
  const v = COLORI[colore], r = document.documentElement.style;
  if (v) r.setProperty('--led-sfondo', v); else r.removeProperty('--led-sfondo');
}
