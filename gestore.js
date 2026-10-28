// La pagina dell'ufficio: la tabella del giorno per ogni dipendente, come il loro foglio. Si scrive e basta (si salva da sola),
// «Pubblica i turni» la manda al telefono del dipendente con una notifica, gli esiti tornano qui mentre lavora.
// Tutto ciò che va al server è chiuso in busta in questo browser (cifra.js). Il testo entra nella pagina solo come testo.
import * as pdfjs from './vendor/pdf.min.mjs';
import { estraiGeometria, leggiFoglio } from './lettore.js';
import { CAMPI, pulite, problemi, daFoglio, uguali } from './turni.js';
import { server, entra, io, esci, chiama, accessoNuovo, cambiaMioAccesso, contesto, sigilla, apri, perChi, ascolta } from './ufficio.js';

pdfjs.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';
const TITOLI = { da: 'Da', a: 'A', cliente: 'Cliente', tipologia: 'Tipologia', comune: 'Comune', via: 'Indirizzo', telefono: 'Telefono', note: 'Note' };
const TIPOLOGIE = ['FASTWEB 3.5', 'FASTWEB 3.5 + EXT.', 'INS.KOLME', 'DIS. FASTWEB'];
const MESSAGGI_PDF = {
  'senza-testo': 'Questo PDF non ha testo da leggere: serve quello esportato da Excel.', pagine: 'Il foglio ha più di una pagina: per ora leggo solo fogli di una pagina.',
  colonne: 'Non trovo le colonne del foglio dei turni (CLIENTE, TIPOLOGIA ODL, INDIRIZZO…).', bordi: 'Non riesco a leggere la tabella di questo foglio.', vuoto: 'Nel foglio non trovo interventi.',
};
const RICORDA = 'giro:gestore';

const isoDi = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const oggi = () => isoDi(new Date());
const domani = () => isoDi(new Date(Date.now() + 864e5));
const spostaGiorno = (iso, n) => { const d = new Date(`${iso}T12:00`); d.setDate(d.getDate() + n); return isoDi(d); };
const giorno = iso => new Date(`${iso}T12:00`).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
const ora = t => new Date(t).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
const ricordati = () => { try { return JSON.parse(localStorage.getItem(RICORDA)) ?? {}; } catch { return {}; } };

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
const $ = s => document.querySelector(s);
const pagina = document.getElementById('pagina');

const st = {
  io: null, persone: [], dip: null, iso: domani(), righe: [], pubblicato: null, esiti: {}, pubblicatiDelGiorno: {},
  aperto: false, illeggibile: false, sporco: false, errSalva: false, salvo: Promise.resolve(true), timer: 0, carica: 0,
  pubblico: false, avviso: null, ascolto: null, uscita: null,
};
const dipendenti = () => st.persone.filter(p => p.ruolo === 'dipendente').sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
const gestoriDest = () => st.persone.filter(p => p.ruolo === 'gestore').map(p => ({ kid: p.kid, pubblica: p.pubblica }));
const dip = () => st.persone.find(p => p.id === st.dip);

// ---------- accesso ----------
function schermoAccesso(messaggio) {
  const email = h('input', { type: 'email', autocomplete: 'username', required: true, id: 'acc-email' });
  const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true, id: 'acc-pw' });
  const esito = h('p', { class: 'messaggio errore', role: 'alert' }, messaggio ?? '');
  const tasto = h('button', { type: 'submit', class: 'pieno' }, 'Entra');
  pagina.replaceChildren(h('main', { class: 'accesso' },
    h('h1', {}, 'Giro · Ufficio'), h('p', { class: 'sotto' }, 'Qui l’ufficio scrive i turni e li pubblica sul telefono dei tecnici.'),
    h('form', { onsubmit: async e => {
      e.preventDefault();
      tasto.disabled = true; tasto.textContent = 'Entro…'; esito.textContent = '';
      try { st.io = await entra(email.value, pw.value); await avvia(); } catch (x) { esito.textContent = x.message; tasto.disabled = false; tasto.textContent = 'Entra'; }
    } },
    h('label', { for: 'acc-email' }, 'Email'), email, h('label', { for: 'acc-pw' }, 'Password'), pw, esito, tasto)));
  email.focus();
}

async function avvia() {
  const sb = await server();
  if (!st.io) st.io = await io();
  if (!st.io) return schermoAccesso();
  if (st.io.ruolo !== 'gestore') {
    return pagina.replaceChildren(h('main', { class: 'accesso' }, h('h1', {}, 'Questa pagina è per l’ufficio'),
      h('p', { class: 'sotto' }, 'Il tuo giro lo trovi in Giro, sul telefono.'), h('a', { class: 'pieno', href: './' }, 'Apri Giro'),
      h('button', { type: 'button', class: 'piccolo', onclick: async () => { await esci(st.io); st.io = null; schermoAccesso(); } }, 'Esci')));
  }
  if (!st.uscita) st.uscita = sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT' && st.io) { st.io = null; schermoAccesso('Sei uscito: rientra.'); } });
  const { data, error } = await sb.from('persone').select('id, nome, email, ruolo, kid, pubblica');
  if (error) return schermoAccesso('Non riesco a parlare col server: controlla la rete e riprova.');
  st.persone = data;
  if (!data.some(p => p.id === st.io.id && p.kid === st.io.chiave.kid)) { await esci(st.io); st.io = null; return schermoAccesso('Il tuo accesso è cambiato: rientra con la password nuova.'); }
  const r = ricordati();
  st.dip = dipendenti().some(p => p.id === r.dip) ? r.dip : dipendenti()[0]?.id ?? null;
  st.iso = r.iso && r.iso >= oggi() ? r.iso : domani();
  disegna();
  if (st.dip) await caricaGiorno(); // senza dipendenti c'è solo «Aggiungi il primo dipendente»
  st.ascolto ??= await ascolta('esiti:ufficio', 'esiti', esitoArrivato);
  risigilla().catch(e => console.warn('richiudere le buste', e));
}

// ---------- la pagina ----------
function disegna() {
  const dips = dipendenti();
  pagina.replaceChildren(
    h('header', { class: 'testa' }, h('strong', {}, 'Giro · Ufficio'),
      h('span', { class: 'chi' }, st.io.nome),
      h('button', { type: 'button', class: 'piccolo', onclick: () => finestraMioAccesso() }, 'Il mio accesso'),
      h('button', { type: 'button', class: 'piccolo', onclick: async () => { if (!(await salvaOra())) return; await esci(st.io); st.io = null; schermoAccesso(); } }, 'Esci')),
    h('main', {},
      h('nav', { class: 'persone', 'aria-label': 'Dipendenti' },
        dips.map(p => h('button', { type: 'button', class: 'persona', 'aria-pressed': String(p.id === st.dip), 'data-persona': p.id, onclick: () => scegli(p.id, st.iso) },
          h('span', { class: 'nome' }, p.nome), h('span', { class: 'segno', 'data-segno': p.id }))),
        h('button', { type: 'button', class: 'persona aggiungi', onclick: () => finestraDipendente() }, '+ Aggiungi dipendente')),
      dips.length ? [
        h('div', { class: 'giorno' },
          h('button', { type: 'button', class: 'piccolo', 'aria-label': 'Giorno prima', onclick: () => scegli(st.dip, spostaGiorno(st.iso, -1)) }, '‹'),
          h('input', { type: 'date', value: st.iso, 'aria-label': 'Giorno', onchange: e => e.target.value && scegli(st.dip, e.target.value) }),
          h('button', { type: 'button', class: 'piccolo', 'aria-label': 'Giorno dopo', onclick: () => scegli(st.dip, spostaGiorno(st.iso, 1)) }, '›'),
          h('h1', {}, `${dip()?.nome ?? ''} · ${giorno(st.iso)}`),
          h('button', { type: 'button', class: 'piccolo', onclick: () => scegli(st.dip, oggi()) }, 'Oggi'),
          h('button', { type: 'button', class: 'piccolo', onclick: () => scegli(st.dip, domani()) }, 'Domani')),
        h('div', { class: 'comandi' },
          h('p', { class: 'stato', id: 'stato', role: 'status' }),
          h('button', { type: 'button', class: 'piccolo', onclick: () => $('#pdf').click() }, 'Carica il PDF'),
          h('button', { type: 'button', class: 'pieno', id: 'pubblica', onclick: pubblica }, 'Pubblica i turni')),
        h('div', { id: 'avviso' }),
        h('div', { class: 'foglio', id: 'foglio' }),
        h('p', { class: 'nota' }, 'Si salva da solo mentre scrivi. Il telefono vede i turni solo quando premi «Pubblica i turni». ',
          'Clienti, indirizzi, telefoni e note partono già cifrati da questo computer: il server non li legge.'),
        h('p', { class: 'nota' }, h('button', { type: 'button', class: 'link', onclick: () => finestraDipendente(dip()) }, `Cambia email o password di ${dip()?.nome ?? ''}`)),
      ] : h('section', { class: 'vuoto' }, h('h1', {}, 'Aggiungi il primo dipendente'),
        h('p', {}, 'Scegli tu email e password: lui le scrive una volta in Giro e il telefono resta collegato.'),
        h('button', { type: 'button', class: 'pieno', onclick: () => finestraDipendente() }, 'Aggiungi dipendente'))),
    h('datalist', { id: 'tipologie' }, TIPOLOGIE.map(t => h('option', { value: t }))),
    h('datalist', { id: 'comuni' }));
  riempiComuni();
  disegnaTabella();
  disegnaStato();
  segniDelGiorno();
}

let comuni = null;
async function riempiComuni() {
  comuni ??= Object.keys(await (await fetch('comuni.json')).json()).sort();
  $('#comuni')?.replaceChildren(...comuni.map(c => h('option', { value: c })));
}

async function segniDelGiorno() {
  const sb = await server();
  const iso = st.iso;
  const { data } = await sb.from('turni').select('dipendente, pubblicati').eq('data', iso);
  if (iso !== st.iso) return;
  st.pubblicatiDelGiorno = Object.fromEntries((data ?? []).map(t => [t.dipendente, t.pubblicati]));
  for (const el of document.querySelectorAll('[data-segno]')) {
    const t = st.pubblicatiDelGiorno[el.dataset.segno];
    el.textContent = t ? `pubblicati ${ora(t)}` : 'da pubblicare';
    el.classList.toggle('fatto', !!t);
  }
}

// ---------- la tabella ----------
const rigaVuota = () => ({ id: crypto.randomUUID(), ...Object.fromEntries(CAMPI.map(c => [c, ''])) });
const piena = r => CAMPI.some(c => r[c]);

function disegnaTabella() {
  const box = $('#foglio');
  if (!box) return;
  if (!st.aperto) return box.replaceChildren(h('p', { class: 'nota' }, 'Apro il giorno…'));
  if (!st.righe.length || piena(st.righe.at(-1))) st.righe.push(rigaVuota()); // c'è sempre una riga vuota in fondo
  box.replaceChildren(h('table', {},
    h('thead', {}, h('tr', {}, h('th', { scope: 'col', class: 'n' }, '#'), CAMPI.map(c => h('th', { scope: 'col', class: c }, TITOLI[c])),
      h('th', { scope: 'col', class: 'esito' }, 'Esito'), h('th', { scope: 'col', class: 'togli' }, h('span', { class: 'nascosto' }, 'Togli')))),
    h('tbody', { id: 'righe' }, st.righe.map(trDi))));
  numeri();
  disegnaEsiti();
}

function trDi(r) {
  const cella = c => h('td', { class: c }, h('input', {
    type: c === 'da' || c === 'a' ? 'time' : c === 'telefono' ? 'tel' : 'text', value: r[c], 'data-campo': c, title: r[c] || null, // una nota lunga si legge intera passandoci sopra
    maxlength: { cliente: 120, tipologia: 60, comune: 60, via: 160, telefono: 30, note: 500 }[c],
    list: c === 'comune' ? 'comuni' : c === 'tipologia' ? 'tipologie' : null, autocomplete: 'off', spellcheck: c === 'note' ? 'true' : 'false',
    oninput: e => scrivi(r, c, e.target), onkeydown: e => invio(e, c),
  }));
  return h('tr', { 'data-riga': r.id }, h('td', { class: 'n' }), CAMPI.map(cella), h('td', { class: 'esito', 'data-esito': r.id }),
    h('td', { class: 'togli' }, h('button', { type: 'button', class: 'togli', title: 'Togli la riga', onclick: () => togli(r) }, '×')));
}

// i numeri e le etichette per chi legge con lo screen reader: «Riga 3, Cliente»
function numeri() {
  [...document.querySelectorAll('#righe tr')].forEach((tr, k) => {
    tr.querySelector('.n').textContent = k + 1;
    for (const i of tr.querySelectorAll('input')) i.setAttribute('aria-label', `Riga ${k + 1}, ${TITOLI[i.dataset.campo]}`);
  });
}

// Si scrive e basta: niente ridisegno mentre scrive (il cursore resta dov'è), la riga vuota in fondo si aggiunge da sola
function scrivi(r, c, el) {
  r[c] = el.value;
  el.title = el.value;
  if (r === st.righe.at(-1) && piena(r)) {
    const nuova = rigaVuota();
    st.righe.push(nuova);
    $('#righe').append(trDi(nuova));
    numeri();
  }
  programma();
}

// Invio: stessa colonna, riga sotto (come nel loro Excel)
function invio(e, c) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  e.target.closest('tr').nextElementSibling?.querySelector(`[data-campo="${c}"]`)?.focus();
}

function togli(r) {
  const k = st.righe.indexOf(r);
  if (k < 0 || !piena(r)) return;
  st.righe.splice(k, 1);
  document.querySelector(`#righe tr[data-riga="${r.id}"]`)?.remove();
  numeri();
  programma();
  mostraAvviso(`Riga ${k + 1} tolta.`, 'Annulla', () => { st.righe.splice(k, 0, r); disegnaTabella(); programma(); });
}

function mostraAvviso(testo, tasto, fn, errore = false) {
  const box = $('#avviso');
  if (!box) return;
  clearTimeout(st.avviso);
  box.replaceChildren(h('div', { class: errore ? 'avviso errore' : 'avviso', role: errore ? 'alert' : 'status' },
    Array.isArray(testo) ? h('ul', {}, testo.map(t => h('li', {}, t))) : h('span', {}, testo),
    tasto && h('button', { type: 'button', class: 'piccolo', onclick: () => { box.replaceChildren(); fn(); } }, tasto)));
  if (!errore) st.avviso = setTimeout(() => box.replaceChildren(), 10000);
}

function disegnaEsiti() {
  for (const td of document.querySelectorAll('[data-esito]')) {
    const e = st.esiti[td.dataset.esito];
    td.className = `esito ${e?.stato === 'OK' ? 'ok' : e?.stato === 'KO' ? 'ko' : ''}`;
    td.textContent = !e ? '' : [e.stato, e.stato === 'KO' && e.motivoKo, e.euroExtra && `+${e.euroExtra} €`].filter(Boolean).join(' · ');
    td.title = td.textContent; // tagliato coi puntini se lungo: per intero passandoci sopra
  }
}

function disegnaStato() {
  const el = $('#stato'), tasto = $('#pubblica');
  if (!el) return;
  const p = st.pubblicato, uguale = p && uguali(st.righe, p.righe);
  const [testo, tipo] = !st.aperto ? ['Apro il giorno…', '']
    : st.errSalva ? ['Non salvato: manca la rete. Riprovo da solo.', 'errore']
    : st.sporco ? ['Salvo…', '']
    : st.illeggibile ? ['Questo giorno era chiuso con una chiave che qui non c’è: riscrivilo o caricalo dal PDF.', 'errore']
    : uguale ? [`Pubblicati alle ${ora(p.alle)}${p.avvisato != null ? (p.avvisato ? ' · avvisato con una notifica' : ' · notifiche non attive sul suo telefono: li vede aprendo Giro') : ''}`, 'ok']
    : p ? [`Modifiche salvate, non ancora pubblicate (l’ultima pubblicazione è delle ${ora(p.alle)})`, 'attesa']
    : pulite(st.righe).length ? ['Salvato. Non ancora pubblicato.', 'attesa'] : ['Scrivi le righe o carica il PDF dell’ufficio. Si salva da solo.', ''];
  el.textContent = testo;
  el.className = `stato ${tipo}`;
  tasto.textContent = st.pubblico ? 'Pubblico…' : uguale ? 'Già pubblicati' : p ? 'Pubblica le modifiche' : 'Pubblica i turni';
  tasto.disabled = st.pubblico || !st.aperto || !!uguale;
}

// ---------- salvare ----------
function programma() {
  st.sporco = true;
  disegnaStato();
  clearTimeout(st.timer);
  st.timer = setTimeout(salvaOra, 700);
}

// Un salvataggio alla volta, sempre con le righe di adesso. Torna false se non è riuscito (senza rete).
function salvaOra() {
  clearTimeout(st.timer);
  st.salvo = st.salvo.then(async () => {
    if (!st.sporco) return !st.errSalva;
    const [d, iso, righe] = [st.dip, st.iso, pulite(st.righe)];
    st.sporco = false;
    try {
      const sb = await server();
      const busta = await sigilla({ righe }, gestoriDest(), contesto('bozza', d, iso));
      const { error } = await sb.from('bozze').upsert({ dipendente: d, data: iso, busta });
      if (error) throw error;
      st.errSalva = false;
    } catch {
      if (d === st.dip && iso === st.iso) { st.sporco = true; st.timer = setTimeout(salvaOra, 5000); }
      st.errSalva = true;
    }
    disegnaStato();
    return !st.errSalva;
  });
  return st.salvo;
}
addEventListener('beforeunload', e => { if (st.sporco || st.errSalva) { salvaOra(); e.preventDefault(); } });

// Cambiare dipendente o giorno: prima si salva quello che c'è (se non si può, si resta qui: niente righe perse)
async function scegli(d, iso) {
  if (d === st.dip && iso === st.iso) return;
  if (!(await salvaOra())) return mostraAvviso('Non riesco a salvare: controlla la rete prima di cambiare giorno o dipendente.', null, null, true);
  st.dip = d; st.iso = iso;
  try { localStorage.setItem(RICORDA, JSON.stringify({ dip: d, iso })); } catch { /* niente */ }
  disegna();
  await caricaGiorno();
}

const prova = async (p, fallback = null) => { try { return await p; } catch { return fallback; } };

async function caricaGiorno() {
  const n = ++st.carica;
  Object.assign(st, { aperto: false, righe: [], pubblicato: null, esiti: {}, illeggibile: false });
  disegnaTabella(); disegnaStato();
  const sb = await server();
  const [d, iso, mia] = [st.dip, st.iso, st.io.chiave];
  const [b, t, e] = await Promise.all([
    sb.from('bozze').select('busta').eq('dipendente', d).eq('data', iso).maybeSingle(),
    sb.from('turni').select('busta, versione, pubblicati').eq('dipendente', d).eq('data', iso).maybeSingle(),
    sb.from('esiti').select('riga, busta').eq('dipendente', d).eq('data', iso)]);
  if (n !== st.carica) return; // intanto ha scelto un altro giorno
  if (b.error || t.error || e.error) return $('#foglio')?.replaceChildren(h('p', { class: 'messaggio errore' }, 'Non riesco a leggere il giorno: controlla la rete. '),
    h('button', { type: 'button', class: 'piccolo', onclick: caricaGiorno }, 'Riprova'));
  const pub = t.data && await prova(apri(t.data.busta, mia, contesto('turni', d, iso)));
  const bozza = b.data && await prova(apri(b.data.busta, mia, contesto('bozza', d, iso)));
  const esiti = {};
  for (const r of e.data) { const x = await prova(apri(r.busta, mia, contesto('esiti', d, iso, r.riga))); if (x) esiti[r.riga] = x; }
  if (n !== st.carica) return;
  Object.assign(st, {
    aperto: true, esiti, illeggibile: (!!b.data && !bozza) || (!!t.data && !pub),
    pubblicato: pub ? { versione: t.data.versione, alle: t.data.pubblicati, righe: pub.righe } : t.data ? { versione: t.data.versione, alle: t.data.pubblicati, righe: [] } : null,
    righe: structuredClone(bozza?.righe ?? pub?.righe ?? []),
  });
  disegnaTabella(); disegnaStato();
}

// ---------- il PDF che fanno già ----------
document.getElementById('pdf').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f || !st.dip) return;
  let foglio;
  try {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()), isEvalSupported: false }).promise;
    foglio = leggiFoglio(await estraiGeometria(doc, pdfjs.OPS), new Date());
  } catch { foglio = { errore: 'file' }; }
  if (foglio.errore) return mostraAvviso(MESSAGGI_PDF[foglio.errore] ?? 'Non riesco ad aprire questo file.', null, null, true);
  if (!foglio.data?.iso) return mostraAvviso('Nel foglio non trovo la data (o giorno e data non coincidono).', null, null, true);
  if (foglio.data.iso !== st.iso) {
    await scegli(st.dip, foglio.data.iso);
    if (st.iso !== foglio.data.iso) return;
  }
  while (!st.aperto) await new Promise(r => setTimeout(r, 50));
  const ce = pulite(st.righe).length;
  if (ce && !confirm(`Sostituisco le ${ce} righe di ${giorno(st.iso)} con le ${foglio.interventi.length} del PDF? Indirizzi e telefoni già scritti restano.`)) return;
  st.righe = daFoglio(foglio, st.righe);
  disegnaTabella();
  programma();
  mostraAvviso(`Dal PDF ${foglio.interventi.length} righe per ${giorno(st.iso)}${foglio.tecnico ? ` (foglio di ${foglio.tecnico})` : ''}. Aggiungi indirizzi e telefoni se li hai, poi pubblica.`);
});

// ---------- pubblicare ----------
async function pubblica() {
  const d = dip();
  if (!d || st.pubblico) return;
  const p = problemi(st.righe);
  if (p.length) return mostraAvviso(p, null, null, true);
  st.pubblico = true; disegnaStato();
  try {
    if (!(await salvaOra())) throw new Error('Non riesco a salvare: controlla la rete.');
    const sb = await server();
    const [iso, righe] = [st.iso, pulite(st.righe)];
    // la versione la dice il server: se è andata avanti solo perché le buste sono state richiuse si va avanti,
    // se un altro gestore ha pubblicato righe diverse ci si ferma (niente sovrascritture a sorpresa)
    const { data: corrente, error: e0 } = await sb.from('turni').select('versione, busta').eq('dipendente', d.id).eq('data', iso).maybeSingle();
    if (e0) throw new Error('Non riesco a pubblicare: controlla la rete.');
    if (corrente && corrente.versione !== st.pubblicato?.versione) {
      const x = await prova(apri(corrente.busta, st.io.chiave, contesto('turni', d.id, iso)));
      if (!x || !uguali(x.righe, st.pubblicato?.righe ?? [])) {
        await caricaGiorno();
        throw new Error('Un altro gestore ha appena pubblicato questo giorno: ho ricaricato le sue righe, controlla e ripubblica.');
      }
    }
    const versione = (corrente?.versione ?? 0) + 1;
    const busta = await sigilla({ versione, iso, tecnico: d.nome, righe }, [{ kid: d.kid, pubblica: d.pubblica }, ...gestoriDest()], contesto('turni', d.id, iso));
    const { data, error } = await sb.from('turni').upsert({ dipendente: d.id, data: iso, busta, versione }).select('pubblicati').single();
    if (error?.code === 'PT409') { await caricaGiorno(); throw new Error('Un altro gestore ha appena pubblicato questo giorno: ho ricaricato le sue righe, controlla e ripubblica.'); }
    if (error) throw new Error('Non riesco a pubblicare: controlla la rete.');
    st.pubblicato = { versione, alle: data.pubblicati, righe, avvisato: null };
    disegnaStato();
    segniDelGiorno();
    const a = await prova(chiama('avvisa', { dipendente: d.id, data: iso }));
    if (st.pubblicato?.versione === versione && iso === st.iso) st.pubblicato.avvisato = a ? a.mandate > 0 : false;
  } catch (x) {
    mostraAvviso(x.message, null, null, true);
  } finally {
    st.pubblico = false;
    disegnaStato();
  }
}

// ---------- gli esiti che arrivano dal telefono ----------
async function esitoArrivato(r) {
  if (!r?.riga || r.dipendente !== st.dip || r.data !== st.iso) return;
  const x = await prova(apri(r.busta, st.io.chiave, contesto('esiti', r.dipendente, r.data, r.riga)));
  if (!x || r.dipendente !== st.dip || r.data !== st.iso) return;
  st.esiti[r.riga] = x;
  disegnaEsiti();
}

// ---------- le buste si richiudono per le chiavi di adesso ----------
// Dopo un cambio di password (chiave nuova del dipendente) o un gestore nuovo, i giorni aperti si richiudono per tutti.
// Si può richiudere solo ciò che questo browser sa aprire; gli altri gestori fanno il resto quando aprono la pagina.
async function risigilla() {
  const sb = await server();
  const da = spostaGiorno(oggi(), -14);
  const g = gestoriDest(), mia = st.io.chiave;
  const per = id => { const p = st.persone.find(x => x.id === id); return p ? [{ kid: p.kid, pubblica: p.pubblica }] : []; };
  const stessi = (busta, dest) => { const a = perChi(busta).sort(), b = dest.map(x => x.kid).sort(); return a.length === b.length && a.every((k, i) => k === b[i]); };
  const tabelle = [
    ['bozze', 'dipendente, data, busta', r => g, r => contesto('bozza', r.dipendente, r.data)],
    ['turni', 'dipendente, data, busta, versione', r => [...per(r.dipendente), ...g], r => contesto('turni', r.dipendente, r.data)],
    ['esiti', 'dipendente, data, riga, busta', r => [...per(r.dipendente), ...g], r => contesto('esiti', r.dipendente, r.data, r.riga)],
  ];
  for (const [tabella, colonne, dest, ctx] of tabelle) {
    const { data } = await sb.from(tabella).select(colonne).gte('data', da);
    for (const r of data ?? []) {
      if (stessi(r.busta, dest(r))) continue;
      const x = await prova(apri(r.busta, mia, ctx(r)));
      if (!x) continue;
      const busta = await sigilla(x, dest(r), ctx(r));
      const chiave = { dipendente: r.dipendente, data: r.data, ...(r.riga ? { riga: r.riga } : {}) };
      await sb.from(tabella).update({ busta, ...(tabella === 'turni' ? { versione: r.versione + 1 } : {}) }).match(chiave);
    }
  }
}

// ---------- persone e accessi ----------
// 12 lettere senza quelle che si confondono (0/o, 1/l/i), a gruppi di 4: facile da dettare e da scrivere sul telefono
function generaPassword() {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  const n = crypto.getRandomValues(new Uint32Array(12));
  return [...n].map(x => a[x % a.length]).join('').replace(/(.{4})(?=.)/g, '$1-');
}

function finestra(titolo, campi, tasto, fn) {
  const errore = h('p', { class: 'messaggio errore', role: 'alert' });
  const invia = h('button', { type: 'submit', class: 'pieno' }, tasto);
  const d = h('dialog', { class: 'finestra', onclose: () => d.remove() },
    h('form', { onsubmit: async e => {
      e.preventDefault();
      invia.disabled = true; errore.textContent = '';
      try { await fn(d); } catch (x) { errore.textContent = x.message; } finally { invia.disabled = false; }
    } }, h('h2', {}, titolo), campi, errore,
    h('div', { class: 'tasti' }, h('button', { type: 'button', class: 'piccolo', onclick: () => d.close() }, 'Annulla'), invia)));
  document.body.append(d);
  d.showModal();
  return d;
}
const campo = (id, etichetta, props) => [h('label', { for: id }, etichetta), h('input', { id, autocomplete: 'off', ...props })];

function finestraDipendente(p) {
  const pw = h('input', { id: 'f-pw', type: 'text', required: true, minlength: 10, autocomplete: 'new-password', spellcheck: 'false', value: generaPassword() });
  const campi = [
    ...campo('f-nome', 'Nome', { required: true, maxlength: 60, value: p?.nome ?? '' }),
    ...campo('f-email', 'Email', { type: 'email', required: true, value: p?.email ?? '' }),
    h('label', { for: 'f-pw' }, p ? 'Password nuova' : 'Password'),
    h('div', { class: 'con-tasto' }, pw, h('button', { type: 'button', class: 'piccolo', onclick: () => { pw.value = generaPassword(); } }, 'Un’altra')),
    h('p', { class: 'nota' }, p ? `Il telefono di ${p.nome} esce e va ricollegato con la password nuova. I turni dei prossimi giorni restano: li richiudo io per la chiave nuova.`
      : 'Scegli tu email e password (almeno 10 caratteri). Gliele dai tu: le scrive una volta in Giro, «Collegati all’ufficio». Non parte nessuna email.'),
  ];
  finestra(p ? `Accesso di ${p.nome}` : 'Nuovo dipendente', campi, p ? 'Cambia l’accesso' : 'Crea l’accesso', async d => {
    const [nome, email, password] = ['#f-nome', '#f-email', '#f-pw'].map(s => d.querySelector(s).value.trim());
    if (password.length < 10) throw new Error('La password deve avere almeno 10 caratteri.');
    if (!(await salvaOra())) throw new Error('Non riesco a salvare la tabella: controlla la rete.');
    const a = await accessoNuovo(email, password);
    const r = p ? await chiama('cambia', { id: p.id, nome, ...a }) : await chiama('crea', { nome, ...a });
    d.close();
    await ricaricaPersone(r.id);
    risigilla().catch(() => {});
    fatto(`${p ? 'Accesso cambiato' : 'Accesso creato'} per ${nome}`, email, password);
  });
}

// la password si vede una volta sola, qui: poi non la conosce più nessuno (il server ha solo l'«accesso» che ne deriva)
function fatto(titolo, email, password) {
  const d = h('dialog', { class: 'finestra', onclose: () => d.remove() },
    h('h2', {}, titolo),
    h('p', {}, 'Dagli queste due righe. Sul telefono: Giro → «Collegati all’ufficio».'),
    h('pre', { class: 'credenziali' }, `Email: ${email}\nPassword: ${password}`),
    h('p', { class: 'nota' }, 'Dopo che chiudi questa finestra la password non si vede più. Se la perde, gliene fai una nuova da «Cambia email o password».'),
    h('div', { class: 'tasti' },
      h('button', { type: 'button', class: 'piccolo', onclick: e => navigator.clipboard?.writeText(`Email: ${email}\nPassword: ${password}`).then(() => { e.target.textContent = 'Copiate'; }) }, 'Copia'),
      h('button', { type: 'button', class: 'pieno', onclick: () => d.close() }, 'Fatto')));
  document.body.append(d);
  d.showModal();
}

function finestraMioAccesso() {
  const campi = [
    ...campo('m-vecchia', 'Password di adesso', { type: 'password', required: true, autocomplete: 'current-password' }),
    ...campo('m-email', 'Email', { type: 'email', required: true, value: st.io.email, autocomplete: 'username' }),
    ...campo('m-nuova', 'Password nuova (almeno 10 caratteri; vuota = resta quella di adesso)', { type: 'password', autocomplete: 'new-password' }),
  ];
  finestra('Il mio accesso', campi, 'Cambia', async d => {
    const [vecchia, email, nuova] = ['#m-vecchia', '#m-email', '#m-nuova'].map(s => d.querySelector(s).value);
    if (nuova && nuova.length < 10) throw new Error('La password nuova deve avere almeno 10 caratteri.');
    if (!(await salvaOra())) throw new Error('Non riesco a salvare la tabella: controlla la rete.');
    st.io = await cambiaMioAccesso(st.io, vecchia, email.trim(), nuova || vecchia);
    d.close();
    await ricaricaPersone();
    mostraAvviso('Accesso cambiato. Negli altri browser rientri con quello nuovo.');
  });
}

// dopo aver creato o cambiato un accesso; `scelto` = il dipendente da mostrare (quello appena creato)
async function ricaricaPersone(scelto) {
  const sb = await server();
  const { data } = await sb.from('persone').select('id, nome, email, ruolo, kid, pubblica');
  if (data) st.persone = data;
  const prima = st.dip;
  if (scelto && dipendenti().some(p => p.id === scelto)) st.dip = scelto;
  if (!dipendenti().some(p => p.id === st.dip)) st.dip = dipendenti()[0]?.id ?? null;
  disegna();
  if (st.dip && (st.dip !== prima || !st.aperto)) await caricaGiorno();
}

avvia().catch(e => { console.error(e); schermoAccesso('Non riesco a partire: controlla la rete e ricarica la pagina.'); });
