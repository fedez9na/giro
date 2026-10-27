// L'app di F1: il foglio diventa la giornata, senza rete. Tutto resta nel telefono (localStorage):
// via e numero escono solo nei link che Riccardo apre lui. Il testo del foglio entra solo con textContent.
import * as pdfjs from './vendor/pdf.min.mjs';
import { estraiGeometria, leggiFoglio } from './lettore.js';
import { nuovaGiornata, unisci, segna, aggiungi, ordinati } from './giornata.js';
import { compilaPdf } from './compila.js';
import { naviga, chiama, stoArrivando, testoArrivo } from './link.js';
import { puntoStretto } from './margini.js';
import { creaIcs } from './calendario.js';
import { hm, nomeComune, tipo, notePer } from './testi.js';
import { chiave, meteoDelLavoro, etichetta, riassunto, leggiMeteo, leggiAllerte, leggiMeteoSito, daSito, sitoValido, DOPO } from './meteo.js';

pdfjs.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';
// grammatica del telefono: Material su Android, iOS altrove; ?os=ios|android la forza (per le prove)
document.documentElement.dataset.os = new URLSearchParams(location.search).get('os') ?? (/android/i.test(navigator.userAgent) ? 'android' : 'ios');
const ANDROID = document.documentElement.dataset.os === 'android';
const GIORNI_TENUTI = 7; // proposta: i dati di un giorno si cancellano da soli dopo 7 giorni
const MOTIVI_KO = ['Cliente assente', 'Segnale insufficiente', 'Manca linea vita o accesso al tetto', 'Il cavo non passa', 'Il cliente rinuncia'];
const MESSAGGI = {
  'senza-testo': 'Questo PDF non ha testo da leggere: forse è una foto o una scansione. Serve il PDF esportato da Excel.',
  pagine: 'Il foglio ha più di una pagina: per ora leggo solo fogli di una pagina.',
  colonne: 'Non trovo le colonne del foglio dei turni (CLIENTE, TIPOLOGIA ODL, INDIRIZZO…). È il file giusto?',
  bordi: 'Non riesco a leggere la tabella di questo foglio.',
  vuoto: 'Nel foglio non trovo interventi.',
};

// ---------- archivio nel telefono ----------
const CHIAVE = 'giro:giorno:';
const leggiLS = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const scriviLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const giorniSalvati = () => Object.keys(localStorage).filter(k => k.startsWith(CHIAVE)).map(k => k.slice(CHIAVE.length)).sort();
const isoDi = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const aBase64 = b => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const daBase64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

function pulisci() {
  const limite = isoDi(new Date(Date.now() - GIORNI_TENUTI * 864e5));
  for (const g of giorniSalvati()) if (g < limite) localStorage.removeItem(CHIAVE + g);
}

const stato = { iso: null, giorno: null, avviso: null, annulla: null };
function scegliGiorno() {
  const tutti = giorniSalvati(), oggi = isoDi(new Date());
  return tutti.includes(oggi) ? oggi : tutti.find(g => g > oggi) ?? tutti.at(-1) ?? null;
}
function salva() {
  if (!scriviLS(CHIAVE + stato.iso, stato.giorno)) stato.avviso = { errore: true, testo: 'Il telefono non ha spazio per salvare: le modifiche si perderanno chiudendo l’app.' };
}
const impostazioni = () => leggiLS('giro:impostazioni') ?? { chiSono: '' };

// ---------- aprire un foglio ----------
async function apriBytes(bytes) {
  let foglio;
  try {
    const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
    foglio = leggiFoglio(await estraiGeometria(doc, pdfjs.OPS), new Date());
  } catch {
    foglio = { errore: 'file' };
  }
  if (foglio.errore || !foglio.data?.iso) {
    stato.avviso = { errore: true, testo: foglio.errore ? MESSAGGI[foglio.errore] ?? 'Non riesco ad aprire questo file.'
      : foglio.avvisi.includes('data-incoerente') ? 'Sul foglio il giorno della settimana e la data non coincidono: controlla con l’ufficio.'
        : 'Non trovo la data nel foglio.' };
    return vai('#/');
  }
  const esistente = leggiLS(CHIAVE + foglio.data.iso);
  const giornata = esistente ? unisci(esistente.giornata, foglio) : nuovaGiornata(foglio);
  stato.iso = foglio.data.iso;
  stato.giorno = { giornata, pdf: aBase64(bytes), inviato: esistente?.inviato ?? null, meteo: esistente?.meteo ?? null, allerte: esistente?.allerte ?? null };
  stato.avviso = esistente ? avvisoCambi(giornata) : null;
  salva();
  vai('#/');
}

function avvisoCambi(g) {
  if (!g.cambi.length) return { testo: 'Foglio aggiornato: nessun cambiamento.' };
  const dove = c => nomeComune(g.interventi.find(i => i.id === c.id)?.comune ?? '');
  const riga = c => (c.tipo === 'orario' ? `${dove(c)}: ${c.prima} → ${c.dopo}` : c.tipo === 'note' ? `${dove(c)}: nota cambiata` : `${dove(c)}: ${c.tipo}`);
  return { testo: 'Foglio aggiornato. Gli esiti che avevi segnato restano.', lista: g.cambi.map(riga) };
}

// ---------- aiuti per il disegno ----------
function h(tag, props = {}, ...figli) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  e.append(...figli.flat().filter(x => x != null && x !== false && x !== ''));
  return e;
}
const SVG = 'http://www.w3.org/2000/svg';
const ICONE = { // disegnate apposta, tutte con lo stesso tratto
  naviga: 'M12 2 4.5 20.3l.7.7L12 18l6.8 3 .7-.7z',
  chiama: 'M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z',
  messaggio: 'M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z',
  chevron: 'M9 6l6 6-6 6', indietro: ANDROID ? 'M20 12H4m6-6-6 6 6 6' : 'M15 5l-7 7 7 7', // Material: freccia; iOS: ‹
  foglio: 'M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm7 1.5V8h4.5M8 13h8M8 17h6',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 7.5v7m0-10v.5',
  meteo: 'M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 17.6 8.5 4.75 4.75 0 0 1 17.25 18z',
};
function icona(nome, piena = nome === 'naviga' || nome === 'chiama' || nome === 'messaggio') {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('width', '20'); s.setAttribute('height', '20');
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', ICONE[nome]);
  if (piena) p.setAttribute('fill', 'currentColor');
  else { p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '2'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round'); }
  s.append(p);
  return s;
}
// il cliente arriva spesso TUTTO MAIUSCOLO dal foglio: si legge più lento, lo si scrive come un nome
const nomeCliente = c => (c === c.toUpperCase() ? nomeComune(c) : c);
const quando = i => (i.orario.da ? (i.orario.a ? `${hm(i.orario.da)}–${hm(i.orario.a)}` : hm(i.orario.da)) : i.orario.testo);
const minuti = t => +t.slice(0, 2) * 60 + +t.slice(3);
const adesso = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

// cambia = un tocco su un tasto: ridisegna. aggiorna = si scrive in un campo: salva e NON ridisegna,
// altrimenti il tasto sotto il dito sparisce mentre il campo perde il cursore e il tocco si perde.
function cambia(fn) {
  stato.giorno.giornata = fn(stato.giorno.giornata);
  salva();
  disegna();
}
function aggiorna(fn) {
  stato.giorno.giornata = fn(stato.giorno.giornata);
  salva();
}
const vai = hash => (location.hash === hash ? disegna() : (location.hash = hash));
const apriFile = () => document.getElementById('file').click();
const attuale = id => stato.giorno.giornata.interventi.find(x => x.id === id);

// I tre tasti leggono via e numero al momento del tocco: così vale anche quello appena incollato, senza ridisegnare.
function azioni(i) {
  const id = i.id;
  const tel = () => chiama({ telefono: attuale(id).aggiunte?.telefono });
  const chiamaTasto = h('a', { href: tel() ?? '#', onclick: e => {
    const t = tel();
    if (t) { e.currentTarget.href = t; return; }
    e.preventDefault();
    const campo = document.getElementById('campo-telefono');
    if (campo) campo.focus(); else vai(`#/i/${indice(attuale(id))}?telefono`);
  } }, icona('chiama'), tel() ? 'Chiama' : 'Aggiungi numero');
  return h('div', { class: 'azioni' },
    h('a', { href: naviga({ comune: i.comune, via: i.aggiunte?.via }), target: '_blank', rel: 'noopener noreferrer',
      onclick: e => { e.currentTarget.href = naviga({ comune: i.comune, via: attuale(id).aggiunte?.via }); } }, icona('naviga'), 'Naviga'),
    chiamaTasto,
    h('a', { href: '#', target: '_blank', rel: 'noopener noreferrer', onclick: e => {
      const x = attuale(id);
      // l'ora del foglio solo se non è già passata: altrimenti «arrivo a breve»
      const oggi = isoDi(new Date());
      const futuro = x.orario.da && (stato.iso > oggi || (stato.iso === oggi && minuti(x.orario.da) > adesso()));
      const ora = futuro ? hm(x.orario.da) : null;
      e.currentTarget.href = stoArrivando({ telefono: x.aggiunte?.telefono }, testoArrivo(x, ora, impostazioni().chiSono));
    } }, icona('messaggio'), 'Sto arrivando'));
}
const indice = i => stato.giorno.giornata.interventi.indexOf(i);
const titoloGiorno = () => (isoDi(new Date()) === stato.iso ? 'Oggi'
  : new Date(`${stato.iso}T12:00`).toLocaleDateString('it-IT', { weekday: 'long' }).replace(/^./, c => c.toUpperCase()));

// ---------- schermi ----------
function schermoVuoto() {
  // il primo passo dice DOVE sta il PDF: su iPhone il file di WhatsApp va prima salvato in File
  const passi = [ANDROID ? 'Su WhatsApp apri il PDF dell’ufficio, tocca Condividi e scegli Giro (con l’app installata). Oppure tocca il tasto qui sotto.'
    : 'Su WhatsApp apri il PDF dell’ufficio, tocca Condividi e «Salva su File». Poi qui tocca il tasto e scegli il file.',
  'Vedi la giornata: chi viene dopo, dove, a che ora.', 'Segna OK o KO. A sera rimandi il loro foglio compilato.'];
  const installata = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return [
    h('div', { class: 'barra' }),
    h('div', { class: 'titolo-grande' }, h('h1', {}, 'Il tuo giro'), h('p', {}, 'La giornata dal foglio dei turni')),
    stato.avviso && gruppoAvviso(),
    h('section', { class: 'gruppo' }, h('div', { class: 'lista passi' },
      passi.map((p, k) => h('div', { class: 'riga' }, h('span', { class: 'numero' }, String(k + 1)), h('span', { class: 'corpo' }, p))))),
    h('button', { type: 'button', class: 'tasto-pieno', onclick: apriFile }, 'Apri il foglio dei turni'),
    h('p', { class: 'piede' }, 'Il foglio e quello che segni restano solo in questo telefono.'),
    !installata && !ANDROID && h('p', { class: 'piede' },
      'Prima volta: Condividi → «Aggiungi alla schermata Home». Senza, Safari cancella i dati dopo 7 giorni.'),
  ];
}

function gruppoAvviso() {
  const av = stato.avviso;
  return h('section', { class: 'gruppo' }, h('div', { class: 'lista' },
    h('div', { class: av.errore ? 'avviso errore' : 'avviso' }, icona('info', false),
      h('div', {}, av.testo, av.lista && h('ul', {}, av.lista.map(r => h('li', {}, r)))))));
}

function schermoGiornata() {
  const g = stato.giorno.giornata;
  const data = new Date(`${stato.iso}T12:00`);
  const oggi = isoDi(new Date()) === stato.iso;
  const giro = ordinati(g);
  const prossimo = giro.find(i => !i.esito.stato);
  const poi = giro.filter(i => !i.esito.stato && i !== prossimo);
  const fatti = giro.filter(i => i.esito.stato);
  const dataTesto = data.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  const riga = i => h('a', { class: i.esito.stato ? 'riga fatta' : 'riga', href: `#/i/${indice(i)}` },
    h('span', { class: 'ora' }, hm(i.orario.da) || '—'),
    h('span', { class: 'corpo' }, h('div', { class: 'principale' }, nomeComune(i.comune)),
      h('div', { class: 'secondaria' }, tipo(i.tipologia)), !i.esito.stato && tagMeteo(i), !i.esito.stato && notePer(i) && h('div', { class: 'nota' }, notePer(i))),
    i.esito.stato && h('span', { class: i.esito.stato === 'OK' ? 'esito-ok' : 'esito-ko' }, i.esito.stato),
    h('span', { class: 'chevron' }, icona('chevron', false)));
  const imp = impostazioni();

  return [
    h('div', { class: 'barra' }, h('button', { type: 'button', class: 'azione', onclick: apriFile }, 'Foglio nuovo')),
    h('div', { class: 'titolo-grande' }, h('h1', {}, titoloGiorno()),
      h('p', {}, `${dataTesto} · ${giro.length} interventi, ${fatti.length} fatti`)),
    stato.avviso && gruppoAvviso(),
    prossimo && gruppoPrimaDiPartire(giro),
    prossimo && h('section', { class: 'gruppo' }, h('h2', { class: 'forte' }, 'Prossimo'),
      h('div', { class: 'lista' }, h('div', { class: 'prossimo' },
        h('div', { class: 'quando' }, quando(prossimo), tagMeteo(prossimo)),
        notePer(prossimo) && h('div', { class: 'nota' }, notePer(prossimo)),
        h('div', { class: 'dove' }, nomeComune(prossimo.comune)),
        h('div', { class: 'chi' }, nomeCliente(prossimo.cliente)),
        h('div', { class: 'cosa' }, tipo(prossimo.tipologia)),
        azioni(prossimo),
        h('button', { type: 'button', class: 'apri-scheda', onclick: () => vai(`#/i/${indice(prossimo)}`) }, 'Segna l’esito')))),
    prossimo && stato.iso >= isoDi(new Date()) && gruppoMeteo(),
    !prossimo && h('section', { class: 'gruppo' }, h('h2', { class: 'forte' }, 'Giornata finita'),
      h('p', { class: 'piede', style: 'padding:0 4px 12px' }, 'Hai segnato tutti gli interventi.')),
    !prossimo && h('button', { type: 'button', class: 'tasto-pieno', onclick: () => vai('#/prova') }, 'Manda il foglio all’ufficio'),
    poi.length > 0 && h('section', { class: 'gruppo' }, h('h2', {}, 'Poi'), h('div', { class: 'lista' }, poi.map(riga))),
    fatti.length > 0 && h('section', { class: 'gruppo' }, h('h2', {}, 'Fatti'), h('div', { class: 'lista' }, fatti.map(riga))),
    h('section', { class: 'gruppo' }, h('h2', {}, 'Fine giornata'),
      h('div', { class: 'lista' },
        prossimo && h('button', { type: 'button', class: 'riga azione-riga', onclick: () => vai('#/prova') }, 'Manda il foglio all’ufficio'),
        h('label', { class: 'riga' }, h('span', { class: 'etichetta' }, 'Nei messaggi sei'),
          h('input', { value: imp.chiSono, placeholder: 'il tuo nome', autocomplete: 'given-name',
            oninput: e => scriviLS('giro:impostazioni', { ...impostazioni(), chiSono: e.target.value.trim() }) }))),
      h('p', { class: 'piede' }, stato.giorno.inviato
        ? `Foglio preparato alle ${new Date(stato.giorno.inviato).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}. Nel foglio vanno solo esito, motivo KO ed euro extra.`
        : `Nel foglio vanno solo esito, motivo KO ed euro extra. I dati restano in questo telefono e si cancellano dopo ${GIORNI_TENUTI} giorni.`)),
    stato.annulla && h('div', { class: 'avviso-basso', role: 'status' },
      h('span', {}, stato.annulla.testo),
      h('button', { type: 'button', onclick: () => { const id = stato.annulla.id; stato.annulla = null; cambia(g => segna(g, id, { stato: null })); } }, 'Annulla')),
  ];
}

// quale dei due è puntuale, detto con l'orario: «Puntuale» da solo non diceva quale
function puntuali(p) {
  const a = p.da.vincoli?.puntuale, b = p.a.vincoli?.puntuale;
  if (a && b) return '. Puntuali tutti e due';
  return a || b ? `. Quello delle ${hm((a ? p.da : p.a).orario.da)} è puntuale` : '';
}

// Prima di partire: il punto stretto (dato vero del foglio: tempo fra due inizi, strada compresa) e la giornata nel Calendario
function gruppoPrimaDiPartire(giro) {
  const p = puntoStretto(giro);
  const stretto = p && p.minuti <= 60;
  return h('section', { class: 'gruppo' }, h('h2', {}, 'Prima di partire'),
    h('div', { class: 'lista' },
      stretto && h('div', { class: 'riga stretto' }, icona('info', false),
        h('span', { class: 'corpo' },
          h('div', { class: 'principale' }, `Punto stretto: ${p.minuti} minuti`),
          h('div', { class: 'secondaria' }, `fra ${nomeComune(p.da.comune)} alle ${hm(p.da.orario.da)} e ${nomeComune(p.a.comune)} alle ${hm(p.a.orario.da)}, strada compresa${puntuali(p)}`))),
      h('button', { type: 'button', class: 'riga azione-riga', onclick: () => calendario(giro) }, 'Aggiungi la giornata al Calendario')),
    h('p', { class: 'piede' }, 'Nel calendario vanno solo comune, lavoro e note, mai il nome del cliente. Avviso 30 minuti prima.'));
}

// ---------- meteo ----------
// I dati arrivano dalla rete mentre Riccardo tocca. Due regole (G14): non si ridisegna, si scrive solo dentro posti
// riservati senza tasti; e niente di ciò che arriva sta SOPRA un tasto, perché crescendo lo sposterebbe sotto il dito.
// Per questo la sezione Meteo sta sotto il Prossimo, e nel Prossimo l'etichetta sta sulla riga dell'orario, che non va a capo.
const tagMeteo = i => h('span', { class: 'meteo-tag', 'data-meteo-i': String(indice(i)) });
const gruppoMeteo = () => h('section', { class: 'gruppo' }, h('h2', {}, 'Meteo'),
  h('div', { class: 'lista' }, h('div', { class: 'riga meteo', 'data-meteo': 'riassunto' })),
  h('p', { class: 'piede', 'data-meteo': 'fonte' }));
const LICENZE = {
  'Licence Ouverte 2.0': 'https://www.etalab.gouv.fr/wp-content/uploads/2017/04/ETALAB-Licence-Ouverte-v2.0.pdf',
  'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/deed.it',
};
let tabellaComuni = null, attesaMeteo = null;
const tentativi = {}; // per giorno del foglio: { ultimo, stato: 'cerco' | 'errore' | null, allerteErrore }
const nomeStazione = s => s.toLowerCase().replace(/(^|[\s'/-])\p{L}/gu, l => l.toUpperCase());
const quandoLetto = t => {
  const d = new Date(t);
  return `${isoDi(d) === isoDi(new Date()) ? '' : `il ${d.getDate()}/${d.getMonth() + 1} `}alle ${d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
};

function riempiMeteo() {
  const g = stato.giorno;
  if (!g) return;
  const t = tentativi[stato.iso] ?? {};
  const ore = i => g.meteo?.comuni?.[chiave(i.comune)]?.ore;
  const segnale = i => etichetta(meteoDelLavoro(ore(i), stato.iso, i.orario));
  for (const el of document.querySelectorAll('[data-meteo-i]')) {
    const i = g.giornata.interventi[+el.dataset.meteoI];
    el.textContent = i ? segnale(i) : '';
  }
  const riga = document.querySelector('[data-meteo="riassunto"]');
  if (riga) {
    // un lavoro di oggi la cui finestra (con le 2 ore di coda) è già passata non ha più bisogno di meteo: non è «senza dati»
    const passato = i => isoDi(new Date()) === stato.iso && i.orario.da
      && Math.max(minuti(i.orario.da), minuti(i.orario.a ?? i.orario.da)) + DOPO <= adesso();
    const giro = ordinati(g.giornata).filter(i => !i.esito.stato && !passato(i));
    const r = riassunto(giro, g.meteo, stato.iso);
    const zone = giro.map(i => g.allerte?.comuni?.[chiave(i.comune)]).filter(z => z?.allerte.length);
    const allerte = [...new Set(zone.flatMap(z => z.allerte))];
    const attesa = t.stato === 'cerco' ? 'Cerco il meteo…' : !giro.length ? 'Gli orari rimasti sono già passati'
      : g.meteo ? 'Meteo non trovato per questi comuni'
      : !navigator.onLine ? 'Meteo: serve la rete' : t.stato === 'errore' ? 'Meteo non disponibile ora' : 'Cerco il meteo…';
    riga.classList.toggle('attenzione', allerte.length > 0 || giro.some(segnale));
    riga.replaceChildren(icona('meteo', false), h('span', { class: 'corpo' },
      allerte.length > 0 && h('div', { class: 'allerta' }, allerte.join(', ')),
      allerte.length > 0 && h('div', { class: 'secondaria' }, `Protezione Civile, zona ${[...new Set(zone.map(z => z.zona))].join(', ')}`),
      h('div', { class: 'principale' }, r?.principale ?? attesa),
      (r?.righe ?? []).map(t => h('div', { class: 'secondaria' }, t))));
  }
  const fonte = document.querySelector('[data-meteo="fonte"]');
  if (fonte) {
    const stazioni = [...new Set(Object.values(g.meteo?.comuni ?? {}).map(c => c.stazione).filter(Boolean))].map(nomeStazione);
    // la citazione che le licenze chiedono: chi, di quando è il dato (la corsa del modello), con che licenza, e che l'abbiamo elaborato
    const lic = l => (LICENZE[l] ? h('a', { href: LICENZE[l], target: '_blank', rel: 'noopener' }, l) : l);
    const modelli = Object.values(g.meteo?.modelli ?? {}).map(m => {
      const [nome, ente, l] = m.fonte.split(' · ');
      return [`${nome} di ${ente}${m.corsa ? `, corsa ${quandoLetto(Date.parse(m.corsa))}` : ''} (`, lic(l), ')'];
    });
    const parti = [
      modelli.length && ['Meteo: ', modelli.flatMap((m, n) => (n ? [' e ', ...m] : m)),
        `; ${modelli.length > 1 ? 'per ogni ora il peggiore dei due, ' : ''}calcolato ${quandoLetto(Date.parse(g.meteo.creato))}.`],
      g.meteo && stazioni.length && [`${modelli.length ? 'Fuori zona: ' : 'Meteo: '}DWD tramite Bright Sky (${stazioni.length > 1 ? 'stazioni' : 'stazione'} ${stazioni.join(', ')}), letto ${quandoLetto(g.meteo.letto)} (`, lic('CC BY 4.0'), ').'],
      g.allerte ? [`Allerte: Protezione Civile, bollettino del ${g.allerte.emesso} (`, lic('CC BY 4.0'), ').'] : t.allerteErrore && 'Allerte della Protezione Civile non lette ora.',
    ].filter(Boolean);
    fonte.replaceChildren(...parti.flatMap((p, n) => (n ? [' ', p] : [p])).flat(Infinity));
    fonte.hidden = !parti.length;
  }
}

// con la rete, al massimo ogni 30 minuti (o se nel foglio è entrato un comune nuovo). Dopo un errore si riprova da soli:
// fra 2 minuti, o fra 10 se mancano solo le allerte (GitHub dà 60 richieste l'ora a indirizzo, e i telefoni lo condividono)
async function aggiornaMeteo() {
  const g = stato.giorno, iso = stato.iso;
  if (!g || !navigator.onLine || iso < isoDi(new Date())) return;
  const t = (tentativi[iso] ??= { ultimo: 0, stato: null, allerteErrore: false });
  if (t.stato === 'cerco') return;
  const chiavi = [...new Set(g.giornata.interventi.filter(i => !i.tolto).map(i => chiave(i.comune)))];
  const fresco = x => { const eta = Date.now() - (x ?? 0); return eta >= 0 && eta < 30 * 6e4; }; // orologio indietro: non fresco
  if (g.meteo && fresco(g.meteo.letto) && fresco(g.allerteLette) && chiavi.every(k => g.meteo.chiavi?.includes(k))) return;
  const pausa = t.ultimo + (t.allerteErrore && t.stato !== 'errore' ? 10 : 2) * 6e4 - Date.now();
  if (pausa > 0) { clearTimeout(attesaMeteo); attesaMeteo = setTimeout(aggiornaMeteo, pausa); return; }
  t.stato = 'cerco'; t.ultimo = Date.now();
  riempiMeteo();
  try {
    tabellaComuni ??= await (await fetch('comuni.json')).json();
    // prima il meteo.json del lavoro giornaliero, dal nostro sito; Bright Sky dal telefono solo per ciò che lì manca
    const sito = await leggiMeteoSito().catch(() => null);
    const s = sitoValido(sito, iso) ? daSito(sito, chiavi, iso) : null;
    const daChiedere = (s ? s.mancano : chiavi).filter(k => tabellaComuni[k]);
    const [m, a] = await Promise.allSettled([daChiedere.length ? leggiMeteo(daChiedere, iso, tabellaComuni) : { comuni: {}, mancano: [] },
      s?.allerte ?? leggiAllerte(chiavi, iso, g.allerte, new Set(Object.keys(tabellaComuni)))]);
    const bs = m.status === 'fulfilled' ? m.value : { comuni: {}, mancano: daChiedere };
    // nel giorno giusto anche se intanto Riccardo ha aperto il foglio di un altro giorno
    const giorno = stato.iso === iso ? stato.giorno : leggiLS(CHIAVE + iso);
    if (giorno) {
      if (s || m.status === 'fulfilled') {
        giorno.meteo = { letto: Date.now(), comuni: { ...bs.comuni, ...s?.comuni }, mancano: bs.mancano,
          chiavi: chiavi.filter(k => !bs.mancano.includes(k)), modelli: s ? sito.modelli : null, creato: s ? sito.creato : null };
      }
      if (a.status === 'fulfilled') { giorno.allerte = a.value; giorno.allerteLette = Date.now(); }
      if (stato.iso === iso) salva(); else scriviLS(CHIAVE + iso, giorno);
    }
    t.stato = s || m.status === 'fulfilled' ? null : 'errore';
    t.allerteErrore = a.status === 'rejected';
  } catch {
    t.stato = 'errore';
  } finally {
    if (t.stato === 'cerco') t.stato = null;
    if (stato.iso === iso) riempiMeteo();
    if (t.stato === 'errore' || t.allerteErrore || g.meteo?.mancano?.length) aggiornaMeteo(); // si riprogramma da solo
  }
}

async function calendario(giro) {
  const nome = `giornata ${stato.iso}.ics`;
  const file = new File([creaIcs(giro.filter(i => !i.esito.stato), stato.iso)], nome, { type: 'text/calendar' });
  if (ANDROID && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: nome }); } catch { /* annullato */ }
    return;
  }
  // iPhone: Safari apre il file .ics e propone «Aggiungi tutti» al Calendario
  const a = h('a', { href: URL.createObjectURL(file), download: nome });
  document.body.append(a); a.click(); a.remove();
}

// La prova del foglio: il LORO PDF già compilato, con le celle scritte evidenziate, prima di mandarlo
function schermoProva() {
  const g = stato.giorno.giornata;
  const scritti = ordinati(g).filter(i => i.esito.stato);
  const vuoto = h('div', { class: 'prova-foglio', 'aria-label': 'Anteprima del foglio compilato' });
  const schermo = [
    h('div', { class: 'barra' }, h('button', { type: 'button', class: 'indietro', 'aria-label': `Torna a ${titoloGiorno()}`, onclick: () => history.back() },
      icona('indietro', false), h('span', { class: 'etichetta-indietro' }, titoloGiorno()))),
    h('div', { class: 'titolo-grande' }, h('h1', {}, 'Prova del foglio'), h('p', {}, 'Controlla: in giallo quello che scrivo nel loro foglio.')),
    h('section', { class: 'gruppo' }, vuoto, h('p', { class: 'piede' }, 'Allarga con due dita per leggere.')),
    h('section', { class: 'gruppo' }, h('h2', {}, `Scrivo ${scritti.length} righe su ${ordinati(g).length}`),
      h('div', { class: 'lista' }, scritti.map(i => h('div', { class: 'riga' },
        h('span', { class: 'ora' }, hm(i.orario.da)),
        h('span', { class: 'corpo' }, h('div', { class: 'principale' }, nomeComune(i.comune)),
          h('div', { class: 'secondaria' }, [i.esito.stato, i.esito.stato === 'KO' && i.esito.motivoKo, i.esito.euroExtra && `${i.esito.euroExtra} € extra`].filter(Boolean).join(' · '))))))),
    h('button', { type: 'button', class: 'tasto-pieno', onclick: manda }, 'Manda all’ufficio'),
  ];
  disegnaProva(vuoto, g);
  return schermo;
}

async function disegnaProva(box, g) {
  try {
    const out = await compilaPdf(daBase64(stato.giorno.pdf), g);
    const pagina = await (await pdfjs.getDocument({ data: out.slice(), isEvalSupported: false }).promise).getPage(1);
    // si inquadra solo la tabella (il resto del foglio è bianco), larga quanto lo schermo
    const pieno = pagina.getViewport({ scale: 1 });
    // 6 punti di margine: la scritta in testa alla tabella sporge appena dal bordo e veniva tagliata
    const M = 6, b = g.tabella ?? { x0: M, y0: M, x1: pieno.width - M, y1: pieno.height - M };
    const t = { x0: b.x0 - M, y0: b.y0 - M, x1: b.x1 + M, y1: b.y1 + M };
    const largo = box.clientWidth || 340, dpr = Math.min(devicePixelRatio || 1, 3);
    const s = largo / (t.x1 - t.x0);
    const inquadra = k => pagina.getViewport({ scale: s * k, offsetX: -t.x0 * s * k, offsetY: -(pieno.height - t.y1) * s * k });
    const vista = inquadra(1);
    const [w, hh] = [(t.x1 - t.x0) * s, (t.y1 - t.y0) * s];
    const tela = h('canvas', { width: Math.round(w * dpr), height: Math.round(hh * dpr) });
    tela.style.width = `${w}px`; tela.style.height = `${hh}px`;
    box.replaceChildren(tela);
    await pagina.render({ canvasContext: tela.getContext('2d'), viewport: inquadra(dpr) }).promise;
    for (const i of g.interventi.filter(x => !x.tolto && x.esito.stato)) {
      for (const k of ['esito', 'motivoKo', 'euroExtra']) {
        if (k === 'motivoKo' && i.esito.stato !== 'KO') continue;
        if (k === 'euroExtra' && !i.esito.euroExtra) continue;
        const c = i.celle[k];
        // dalle coordinate del PDF a quelle dello schermo con la matrice della vista (pdf.js 6 non ha più convertToViewportRectangle)
        const [a, b, cc, d, e, f] = vista.transform;
        const punto = (x, y) => [a * x + cc * y + e, b * x + d * y + f];
        const [[x0, y0], [x1, y1]] = [punto(c.x0, c.y0), punto(c.x1, c.y1)];
        box.append(h('span', { class: 'evidenzia', style: `left:${Math.min(x0, x1)}px;top:${Math.min(y0, y1)}px;width:${Math.abs(x1 - x0)}px;height:${Math.abs(y1 - y0)}px` }));
      }
    }
  } catch (e) {
    console.error('prova del foglio', e);
    box.replaceChildren(h('p', { class: 'piede' }, 'Non riesco a mostrare il foglio, ma posso mandarlo lo stesso.'));
  }
}

function schermoScheda(i, focusTelefono) {
  const a = i.aggiunte ?? {};
  const ko = i.esito.stato === 'KO';
  const segnaEsito = s => {
    const prima = i.esito.stato;
    cambia(g => segna(g, i.id, { stato: prima === s ? null : s }));
    if (s === 'OK' && prima !== 'OK') {
      // OK: torna alla giornata (il prossimo è già in cima) con «Annulla» per qualche secondo
      stato.annulla = { id: i.id, testo: `${nomeComune(i.comune)} segnato OK` };
      // allo scadere si toglie solo la barra: ridisegnare chiuderebbe la tastiera se intanto sta scrivendo in un'altra scheda
      setTimeout(() => { if (stato.annulla?.id === i.id) { stato.annulla = null; document.querySelector('.avviso-basso')?.remove(); } }, 8000);
      history.back();
    }
  };
  const campo = (etichetta, props) => h('label', { class: 'riga' }, h('span', { class: 'etichetta' }, etichetta), h('input', props));
  const telefono = { id: 'campo-telefono', type: 'tel', inputmode: 'tel', autocomplete: 'off', value: a.telefono ?? '', placeholder: 'incolla il numero',
    oninput: e => {
      aggiorna(g => aggiungi(g, i.id, { telefono: e.target.value.trim() }));
      const t = document.querySelector('.azioni a:nth-child(2)');
      if (t) t.lastChild.textContent = e.target.value.trim() ? 'Chiama' : 'Aggiungi numero';
    } };
  return [
    h('div', { class: 'barra' }, h('button', { type: 'button', class: 'indietro', 'aria-label': `Torna a ${titoloGiorno()}`, onclick: () => history.back() },
      icona('indietro', false), h('span', { class: 'etichetta-indietro' }, titoloGiorno()))),
    h('div', { class: 'testata' },
      h('div', { class: 'dove' }, nomeComune(i.comune)),
      h('div', { class: 'quando' }, `${quando(i)} · ${tipo(i.tipologia)}`),
      notePer(i) && h('div', { class: 'nota' }, notePer(i)),
      h('div', { class: 'chi' }, nomeCliente(i.cliente)),
      azioni(i)),
    h('section', { class: 'gruppo' }, h('h2', {}, 'Esito'),
      h('div', { class: 'lista' },
        h('div', { class: 'segmenti', role: 'group', 'aria-label': 'Esito' },
          h('button', { type: 'button', class: 'ok', 'aria-pressed': String(i.esito.stato === 'OK'), onclick: () => segnaEsito('OK') }, 'OK'),
          h('button', { type: 'button', class: 'ko', 'aria-pressed': String(ko), onclick: () => segnaEsito('KO') }, 'KO')),
        ko && campo('Motivo KO', { list: 'motivi', value: i.esito.motivoKo, placeholder: 'scegli o scrivi',
          oninput: e => aggiorna(g => segna(g, i.id, { motivoKo: e.target.value.trim() })) }),
        campo('Euro extra', { inputmode: 'decimal', value: i.esito.euroExtra, placeholder: '',
          oninput: e => aggiorna(g => segna(g, i.id, { euroExtra: e.target.value.trim().replace('.', ',') })) })),
      h('datalist', { id: 'motivi' }, MOTIVI_KO.map(m => h('option', { value: m })))),
    h('section', { class: 'gruppo' }, h('h2', {}, 'Indirizzo e telefono'),
      h('div', { class: 'lista' },
        campo('Via', { autocomplete: 'off', value: a.via ?? '', placeholder: 'incolla la via',
          oninput: e => aggiorna(g => aggiungi(g, i.id, { via: e.target.value.trim() })) }),
        campo('Telefono', telefono)),
      h('p', { class: 'piede' }, `Non sono nel foglio: incollali da un messaggio. Senza via, Naviga ti porta in centro a ${nomeComune(i.comune)}.`)),
    i.note && h('section', { class: 'gruppo' }, h('h2', {}, 'Note dell’ufficio'),
      h('div', { class: 'lista' }, h('div', { class: 'riga' }, h('span', { class: 'corpo' }, i.note)))),
  ];
}

function disegna() {
  const app = document.getElementById('app');
  const m = location.hash.match(/^#\/i\/(\d+)(\?telefono)?/);
  const i = m && stato.giorno?.giornata.interventi[+m[1]];
  const prova = location.hash === '#/prova' && stato.giorno;
  const schermo = i ? schermoScheda(i, !!m[2]) : prova ? [] : stato.giorno ? schermoGiornata() : schermoVuoto();
  // la prova misura la larghezza del riquadro: si costruisce dopo che lo schermo è nella pagina
  const contenitore = h('div', { class: 'schermo' }, schermo);
  app.replaceChildren(contenitore);
  if (prova) contenitore.append(...schermoProva());
  if (!i && !prova && stato.giorno) { riempiMeteo(); aggiornaMeteo(); }
  document.title = i ? `${nomeComune(i.comune)} · Giro` : 'Giro';
  if (i && m[2]) document.getElementById('campo-telefono')?.focus(); // arrivati da «Aggiungi numero»
}

async function manda() {
  const out = await compilaPdf(daBase64(stato.giorno.pdf), stato.giorno.giornata);
  const nome = `foglio ${stato.iso} compilato.pdf`;
  const file = new File([out], nome, { type: 'application/pdf' });
  stato.giorno.inviato = Date.now();
  salva();
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: nome }); } catch { /* annullato */ }
  } else {
    const a = h('a', { href: URL.createObjectURL(file), download: nome });
    document.body.append(a); a.click(); a.remove();
  }
  if (location.hash === '#/prova') history.back(); else disegna();
}

// ---------- avvio ----------
document.getElementById('file').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) apriBytes(new Uint8Array(await f.arrayBuffer()));
});
addEventListener('hashchange', () => { disegna(); scrollTo(0, 0); });
addEventListener('online', () => { if (document.querySelector('[data-meteo]')) aggiornaMeteo(); });

pulisci();
stato.iso = scegliGiorno();
stato.giorno = stato.iso ? leggiLS(CHIAVE + stato.iso) : null;
disegna();

// Android: il PDF condiviso da WhatsApp arriva dal service worker (Web Share Target)
if (new URLSearchParams(location.search).has('condiviso') && 'caches' in window) {
  const c = await caches.open('condivisi');
  const r = await c.match('foglio');
  if (r) { await c.delete('foglio'); apriBytes(new Uint8Array(await r.arrayBuffer())); }
  history.replaceState(null, '', './');
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
window.apriBytes = apriBytes; // per le prove in anteprima
