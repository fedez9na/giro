// L'app di F1: il foglio diventa la giornata, senza rete. Tutto resta nel telefono (localStorage):
// via e numero escono solo nei link che Riccardo apre lui. Il testo del foglio entra solo con textContent.
import * as pdfjs from './vendor/pdf.min.mjs';
import { estraiGeometria, leggiFoglio } from './lettore.js';
import { nuovaGiornata, unisci, segna, aggiungi, ordinati } from './giornata.js';
import { compilaPdf } from './compila.js';
import { naviga, chiama, stoArrivando, testoArrivo } from './link.js';

pdfjs.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';
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

let stato = { iso: null, giorno: null, aperto: null, avviso: null };

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
  if (foglio.errore) {
    stato.avviso = { errore: true, testo: MESSAGGI[foglio.errore] ?? 'Non riesco ad aprire questo file.' };
    return disegna();
  }
  if (!foglio.data?.iso) {
    stato.avviso = { errore: true, testo: foglio.avvisi.includes('data-incoerente')
      ? 'Sul foglio il giorno della settimana e la data non coincidono: controlla con l’ufficio.'
      : 'Non trovo la data nel foglio.' };
    return disegna();
  }
  const esistente = leggiLS(CHIAVE + foglio.data.iso);
  const giornata = esistente ? unisci(esistente.giornata, foglio) : nuovaGiornata(foglio);
  stato.iso = foglio.data.iso;
  stato.giorno = { giornata, pdf: aBase64(bytes), inviato: esistente?.inviato ?? null };
  stato.aperto = null;
  stato.avviso = esistente ? avvisoCambi(giornata.cambi) : null;
  salva();
  disegna();
}

function avvisoCambi(cambi) {
  if (!cambi.length) return { testo: 'Foglio aggiornato: nessun cambiamento.' };
  const n = c => stato.giorno?.giornata.interventi.find(i => i.id === c.id);
  const riga = c => {
    const i = n(c), dove = i ? nomeComune(i.comune) : '';
    if (c.tipo === 'orario') return `${dove}: ${c.prima} → ${c.dopo}`;
    if (c.tipo === 'note') return `${dove}: nota cambiata`;
    return `${dove}: ${c.tipo}`;
  };
  return { testo: 'Foglio aggiornato, gli esiti segnati restano. Cambiato:', lista: () => cambi.map(riga) };
}

// ---------- disegno ----------
function h(tag, props = {}, ...figli) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  e.append(...figli.flat().filter(x => x != null && x !== false));
  return e;
}
const hm = t => (t ? t.replace(/^0/, '') : '');
const nomeComune = c => c.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, l => l.toUpperCase());
const TIPO = { 'FASTWEB 3.5': 'Fastweb 3.5', 'INS.KOLME': 'Installazione Kolme', 'DIS. FASTWEB': 'Disinstallazione Fastweb', 'FASTWEB 3.5 + EXT.': 'Fastweb 3.5 + ext.' };
const tipo = t => TIPO[t] ?? t;
const notePer = i => [i.vincoli.puntuale && 'puntuale', i.vincoli.chiamaPrima && 'chiamalo prima',
  i.vincoli.nonPrima && (i.vincoli.nonPrima === i.orario.da ? 'non prima' : `non prima delle ${hm(i.vincoli.nonPrima)}`)].filter(Boolean).join(', ');

function cambia(fn) {
  stato.giorno.giornata = fn(stato.giorno.giornata);
  salva();
  disegna();
}

function scheda(i, prossimo) {
  const a = i.aggiunte ?? {};
  const tel = chiama({ telefono: a.telefono });
  const testo = testoArrivo(i, hm(i.orario.da), impostazioni().chiSono);
  const arrivo = i.orario.da ? (i.orario.a ? `Arrivo fra le ${hm(i.orario.da)} e le ${hm(i.orario.a)}` : `Arrivo alle ${hm(i.orario.da)}`) : `Orario: ${i.orario.testo}`;
  const campoTel = h('input', { type: 'tel', inputmode: 'tel', autocomplete: 'off', value: a.telefono ?? '', placeholder: 'incolla il numero',
    onchange: e => cambia(g => aggiungi(g, i.id, { telefono: e.target.value.trim() })) });
  const koAperto = i.esito.stato === 'KO';
  return h('div', { class: 'scheda' },
    h('div', {}, h('div', { class: 'cliente' }, i.cliente), h('div', { class: 'sotto' }, `${tipo(i.tipologia)} · ${arrivo}`)),
    i.note && h('div', { class: 'nota' }, i.note),
    h('div', { class: 'azioni' },
      h('a', { class: 'primario', href: naviga({ comune: i.comune, via: a.via }), target: '_blank', rel: 'noopener noreferrer' },
        'Naviga', h('small', {}, a.via ? a.via : 'centro del comune')),
      tel ? h('a', { href: tel }, 'Chiama', h('small', {}, a.telefono))
        : h('button', { type: 'button', 'aria-disabled': 'true', onclick: () => campoTel.focus() }, 'Chiama', h('small', {}, 'manca il numero')),
      h('a', { href: stoArrivando({ telefono: a.telefono }, testo), target: '_blank', rel: 'noopener noreferrer' }, 'Sto arrivando', h('small', {}, 'WhatsApp'))),
    h('div', { class: 'campi' },
      h('label', { class: 'campo' }, 'Via (non è nel foglio)', h('input', { autocomplete: 'off', value: a.via ?? '', placeholder: 'incolla la via',
        onchange: e => cambia(g => aggiungi(g, i.id, { via: e.target.value.trim() })) })),
      h('label', { class: 'campo' }, 'Telefono (non è nel foglio)', campoTel)),
    h('div', { class: 'esito' },
      h('button', { type: 'button', class: 'b-ok', 'aria-pressed': String(i.esito.stato === 'OK'),
        // OK chiude la scheda e apre da sola il prossimo; KO resta aperta per il motivo
        onclick: () => { if (i.esito.stato !== 'OK') stato.aperto = null; cambia(g => segna(g, i.id, { stato: i.esito.stato === 'OK' ? null : 'OK' })); } }, 'OK'),
      h('button', { type: 'button', class: 'b-ko', 'aria-pressed': String(koAperto),
        onclick: () => cambia(g => segna(g, i.id, { stato: koAperto ? null : 'KO' })) }, 'KO')),
    h('div', { class: 'campi' },
      koAperto && h('label', { class: 'campo' }, 'Motivo KO',
        h('input', { list: 'motivi', value: i.esito.motivoKo, placeholder: 'scegli o scrivi', onchange: e => cambia(g => segna(g, i.id, { motivoKo: e.target.value.trim() })) })),
      h('label', { class: 'campo' }, 'Euro extra',
        h('input', { inputmode: 'decimal', value: i.esito.euroExtra, placeholder: '0', onchange: e => cambia(g => segna(g, i.id, { euroExtra: e.target.value.trim().replace('.', ',') })) }))),
  );
}

function disegna() {
  const main = document.getElementById('main');
  main.replaceChildren();
  if (stato.avviso) {
    const av = stato.avviso;
    main.append(h('div', { class: av.errore ? 'avviso errore' : 'avviso' }, av.testo, av.lista && h('ul', {}, av.lista().map(r => h('li', {}, r)))));
  }
  const g = stato.giorno?.giornata;
  if (!g) {
    document.getElementById('giorno').textContent = 'Il tuo giro';
    document.getElementById('conteggio').textContent = '';
    main.append(h('p', { class: 'vuoto' }, 'Apri il foglio dei turni che ti manda l’ufficio: qui vedi la tua giornata.'));
    return;
  }
  const data = new Date(`${stato.iso}T12:00`);
  const oggi = isoDi(new Date()) === stato.iso;
  const giro = ordinati(g);
  const fatti = giro.filter(i => i.esito.stato).length;
  document.getElementById('giorno').textContent = `${oggi ? 'Oggi, ' : ''}${data.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}`;
  document.getElementById('conteggio').textContent = `${giro.length} interventi · ${fatti} segnati`;

  const prossimo = giro.find(i => !i.esito.stato);
  const aperto = stato.aperto ?? prossimo?.id;
  for (const i of giro) {
    const chip = i.esito.stato ? h('span', { class: `stato ${i.esito.stato.toLowerCase()}` }, i.esito.stato)
      : i === prossimo ? h('span', { class: 'stato prossimo' }, 'Prossimo') : h('span', { class: 'stato' }, 'Da fare');
    const d = h('details', { class: i.esito.stato ? 'int fatto' : 'int', open: i.id === aperto },
      h('summary', {}, h('span', { class: 'ora' }, hm(i.orario.da) || i.orario.testo), h('span', { class: 'comune' }, nomeComune(i.comune)), chip,
        h('span', { class: 'tipo' }, tipo(i.tipologia)), notePer(i) && h('span', { class: 'nota' }, notePer(i))),
      scheda(i, i === prossimo));
    d.addEventListener('toggle', () => { if (d.open) stato.aperto = i.id; });
    main.append(d);
  }
  main.append(h('datalist', { id: 'motivi' }, MOTIVI_KO.map(m => h('option', { value: m }))));

  const imp = impostazioni();
  main.append(h('section', { class: 'fine' },
    h('strong', {}, 'Fine giornata'),
    h('button', { type: 'button', class: 'manda', onclick: manda }, 'Manda il foglio all’ufficio'),
    h('p', { class: 'piccolo' }, stato.giorno.inviato ? `Preparato l’ultima volta alle ${new Date(stato.giorno.inviato).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}.` : `${fatti} su ${giro.length} interventi segnati. Nel foglio vanno solo esito, motivo KO ed euro extra.`),
    h('label', { class: 'campo' }, 'Nei messaggi ti presenti come',
      h('input', { value: imp.chiSono, placeholder: 'es. Riccardo', autocomplete: 'off', onchange: e => { scriviLS('giro:impostazioni', { ...imp, chiSono: e.target.value.trim() }); disegna(); } })),
    h('p', { class: 'piccolo' }, `I dati di un giorno restano solo in questo telefono e si cancellano da soli dopo ${GIORNI_TENUTI} giorni.`)));
}

async function manda() {
  const g = stato.giorno.giornata;
  const out = await compilaPdf(daBase64(stato.giorno.pdf), g);
  const nome = `foglio ${stato.iso} compilato.pdf`;
  const file = new File([out], nome, { type: 'application/pdf' });
  stato.giorno.inviato = Date.now();
  salva();
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: nome }); } catch { /* annullato da Riccardo */ }
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
