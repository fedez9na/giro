// L'app di F1: il foglio diventa la giornata, senza rete. Tutto resta nel telefono (localStorage):
// via e numero escono solo nei link che Riccardo apre lui. Il testo del foglio entra solo con textContent.
import * as pdfjs from './vendor/pdf.min.mjs';
import { estraiGeometria, leggiFoglio } from './lettore.js';
import { nuovaGiornata, unisci, segna, aggiungi, ordinati } from './giornata.js';
import { compilaPdf } from './compila.js';
import { naviga, chiama, stoArrivando, testoArrivo } from './link.js';

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
  stato.giorno = { giornata, pdf: aBase64(bytes), inviato: esistente?.inviato ?? null };
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
const hm = t => (t ? t.replace(/^0/, '') : '');
const nomeComune = c => c.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, l => l.toUpperCase());
const TIPO = { 'FASTWEB 3.5': 'Fastweb 3.5', 'INS.KOLME': 'Installazione Kolme', 'DIS. FASTWEB': 'Disinstallazione Fastweb', 'FASTWEB 3.5 + EXT.': 'Fastweb 3.5 + ext.' };
const tipo = t => TIPO[t] ?? t;
// il cliente arriva spesso TUTTO MAIUSCOLO dal foglio: si legge più lento, lo si scrive come un nome
const nomeCliente = c => (c === c.toUpperCase() ? nomeComune(c) : c);
const quando = i => (i.orario.da ? (i.orario.a ? `${hm(i.orario.da)}–${hm(i.orario.a)}` : hm(i.orario.da)) : i.orario.testo);
const notePer = i => [i.vincoli.puntuale && 'Puntuale', i.vincoli.chiamaPrima && 'chiamalo prima',
  i.vincoli.nonPrima && `non prima delle ${hm(i.vincoli.nonPrima)}`].filter(Boolean).join(', ');
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
      h('div', { class: 'secondaria' }, tipo(i.tipologia)), !i.esito.stato && notePer(i) && h('div', { class: 'nota' }, notePer(i))),
    i.esito.stato && h('span', { class: i.esito.stato === 'OK' ? 'esito-ok' : 'esito-ko' }, i.esito.stato),
    h('span', { class: 'chevron' }, icona('chevron', false)));
  const imp = impostazioni();

  return [
    h('div', { class: 'barra' }, h('button', { type: 'button', class: 'azione', onclick: apriFile }, 'Foglio nuovo')),
    h('div', { class: 'titolo-grande' }, h('h1', {}, titoloGiorno()),
      h('p', {}, `${dataTesto} · ${giro.length} interventi, ${fatti.length} fatti`)),
    stato.avviso && gruppoAvviso(),
    prossimo && h('section', { class: 'gruppo' }, h('h2', { class: 'forte' }, 'Prossimo'),
      h('div', { class: 'lista' }, h('div', { class: 'prossimo' },
        h('div', { class: 'quando' }, quando(prossimo)),
        notePer(prossimo) && h('div', { class: 'nota' }, notePer(prossimo)),
        h('div', { class: 'dove' }, nomeComune(prossimo.comune)),
        h('div', { class: 'chi' }, nomeCliente(prossimo.cliente)),
        h('div', { class: 'cosa' }, tipo(prossimo.tipologia)),
        azioni(prossimo),
        h('button', { type: 'button', class: 'apri-scheda', onclick: () => vai(`#/i/${indice(prossimo)}`) }, 'Segna l’esito')))),
    !prossimo && h('section', { class: 'gruppo' }, h('h2', { class: 'forte' }, 'Giornata finita'),
      h('p', { class: 'piede', style: 'padding:0 4px 12px' }, 'Hai segnato tutti gli interventi.')),
    !prossimo && h('button', { type: 'button', class: 'tasto-pieno', onclick: manda }, 'Manda il foglio all’ufficio'),
    poi.length > 0 && h('section', { class: 'gruppo' }, h('h2', {}, 'Poi'), h('div', { class: 'lista' }, poi.map(riga))),
    fatti.length > 0 && h('section', { class: 'gruppo' }, h('h2', {}, 'Fatti'), h('div', { class: 'lista' }, fatti.map(riga))),
    h('section', { class: 'gruppo' }, h('h2', {}, 'Fine giornata'),
      h('div', { class: 'lista' },
        prossimo && h('button', { type: 'button', class: 'riga azione-riga', onclick: manda }, 'Manda il foglio all’ufficio'),
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

function schermoScheda(i, focusTelefono) {
  const a = i.aggiunte ?? {};
  const ko = i.esito.stato === 'KO';
  const segnaEsito = s => {
    const prima = i.esito.stato;
    cambia(g => segna(g, i.id, { stato: prima === s ? null : s }));
    if (s === 'OK' && prima !== 'OK') {
      // OK: torna alla giornata (il prossimo è già in cima) con «Annulla» per qualche secondo
      stato.annulla = { id: i.id, testo: `${nomeComune(i.comune)} segnato OK` };
      setTimeout(() => { if (stato.annulla?.id === i.id) { stato.annulla = null; disegna(); } }, 8000);
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
  const schermo = i ? schermoScheda(i, !!m[2]) : stato.giorno ? schermoGiornata() : schermoVuoto();
  app.replaceChildren(h('div', { class: 'schermo' }, schermo));
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
  disegna();
}

// ---------- avvio ----------
document.getElementById('file').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) apriBytes(new Uint8Array(await f.arrayBuffer()));
});
addEventListener('hashchange', () => { disegna(); scrollTo(0, 0); });

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
