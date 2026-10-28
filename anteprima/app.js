// Il prototipo: tre schermi dello stesso mondo. ?s=casa|giornata|scheda (scheda: &i=numero dell'intervento, 0-6).
// Dati finti della copia anonima (dati.js); la mappa è vera (dati/: OpenStreetMap + OSRM, da prepara_plastico.py).
// Niente rete verso terzi: le copertine sono le sue, dalla cartella del progetto.
import { creaMondo, ALTEZZA_SENZA_DATO } from './scena.js';
import { INTERVENTI, ADESSO, DATA, quando, minuti, durata, puntoStretto } from './dati.js';

const FERMO = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SCURO = matchMedia('(prefers-color-scheme: dark)').matches;
const LUCE_GIRO = SCURO ? 0.12 : 1; // di sera il plastico resta sotto la lampada
const LENTO = +(new URLSearchParams(location.search).get('lento') ?? 1) || 1; // solo per gli scatti dei movimenti
const ms = t => (FERMO ? 0 : t * LENTO);

// ---------- aiuti ----------
function h(tag, props = {}, ...figli) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  e.append(...figli.flat().filter(x => x != null && x !== false && x !== ''));
  return e;
}
const SVG = 'http://www.w3.org/2000/svg';
const ICONE = { // dall'app (app.js): disegnate apposta; il cielo è Lucide 0.460.0 (ISC, vendor/lucide-LICENSE.txt)
  naviga: 'M12 2 4.5 20.3l.7.7L12 18l6.8 3 .7-.7z',
  chiama: 'M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z',
  messaggio: 'M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z',
  chevron: 'M9 6l6 6-6 6', indietro: 'M15 5l-7 7 7 7',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 7.5v7m0-10v.5',
  meteo: 'M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 17.6 8.5 4.75 4.75 0 0 1 17.25 18z',
  sole: 'M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41',
  'sole-nuvole': 'M12 2v2M4.93 4.93l1.41 1.41M20 12h2M19.07 4.93l-1.41 1.41M15.947 12.65a4 4 0 0 0-5.925-4.128M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z',
  nuvole: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z',
  pioggia: 'M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242M16 14v6M8 14v6M12 16v6',
  ok: 'M5 12.5l4.2 4.2L19 7',
};
const NOMI_CIELO = { sole: 'Sereno', 'sole-nuvole': 'Poco nuvoloso', nuvole: 'Nuvoloso', pioggia: 'Pioggia' };
function icona(nome, piena = ['naviga', 'chiama', 'messaggio'].includes(nome)) {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', ICONE[nome]);
  if (piena) p.setAttribute('fill', 'currentColor');
  else Object.entries({ fill: 'none', stroke: 'currentColor', 'stroke-width': nome === 'ok' ? 3 : 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }).forEach(([k, v]) => p.setAttribute(k, v));
  s.append(p);
  return s;
}
const cielo = i => h('span', { class: 'cielo', 'data-tipo': i.cielo, role: 'img', 'aria-label': NOMI_CIELO[i.cielo] }, icona(i.cielo, false));
const km = m => `${(m / 1000).toFixed(1).replace('.', ',')} km`;
const chiave = n => n.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim(); // come app/meteo.js

// ---------- la mappa vera del giro (prepara_plastico.py) ----------
const GIRO = await (await fetch('dati/giro.json')).json();
const DATA_ESTRATTO = GIRO.fonte.match(/(\d{4})-(\d{2})-(\d{2})/).slice(1).reverse().slice(0, 2).map(Number).join('/'); // «26/10»

// ---------- stato ----------
const giornata = INTERVENTI.map(i => ({ ...i }));
const stato = { schermo: 'casa', scheda: null, visto: false, annulla: null };
const prossimoI = () => giornata.findIndex(i => !i.esito);
const prossimo = () => giornata[prossimoI()];
const quantoManca = i => { const m = minuti(i.da) - ADESSO; return m > 0 ? `tra ${durata(m)}` : ''; };
// le tappe: interventi di fila nello stesso comune = una tappa (Tradate 11:00, 12:00, 13:30 = tappa 3)
const tappaDi = [];
giornata.forEach((i, k) => tappaDi.push(k && giornata[k - 1].comune === i.comune ? tappaDi[k - 1] : (tappaDi[k - 1] ?? -1) + 1));
console.assert(giornata.every((i, k) => GIRO.tappe[tappaDi[k]]?.comune === i.comune), 'giro.json non corrisponde al foglio');
const suoi = t => giornata.filter((_, k) => tappaDi[k] === t);
// minuti in macchina sotto Naviga: da dove sei (l'ultimo fatto) al comune del cliente; stesso motore e stessi centri del plastico
const iCom = c => GIRO.comuni.indexOf(chiave(c));
const daDove = () => giornata.filter(x => x.esito).at(-1)?.comune ?? giornata[0].comune;
function guidaPer(i) {
  const da = daDove();
  const m = da === i.comune ? 0 : GIRO.minuti[iCom(da)]?.[iCom(i.comune)];
  return m == null ? '' : m === 0 ? 'in zona' : durata(m);
}

let mondo;
const ui = document.getElementById('ui');
function stretto() {
  const ps = puntoStretto(giornata);
  return ps && ps.minuti <= 60 && ps.da.comune !== ps.a.comune ? ps : null;
}
// il tratto che si guida adesso: quello che porta alla tappa del prossimo, finché non ci sei arrivato
function trattoProssimo() {
  const k = prossimoI();
  if (k < 0) return -1;
  const t = tappaDi[k];
  return t > 0 && !suoi(t)[0].esito ? t - 1 : -1;
}
function aggiornaScena() {
  const ps = stretto(), k = prossimoI();
  mondo.stato({
    prossima: k < 0 ? -1 : tappaDi[k],
    prossimoTratto: trattoProssimo(),
    fatti: new Set(GIRO.tratti.map((_, j) => j).filter(j => suoi(j + 1)[0]?.esito)), // fatto = sei arrivato alla tappa dopo
    stretta: ps ? GIRO.tratti.findIndex(t => GIRO.tappe[t.da].comune === ps.da.comune && GIRO.tappe[t.a].comune === ps.a.comune) : -1,
    scelta: stato.schermo === 'scheda' ? chiave(giornata[stato.scheda].comune) : null,
  });
}
const livello = document.getElementById('cartellini');
// lo spazio della mappa sopra il foglio: 42% dello schermo, ma mai meno di 300 px (sui telefoni bassi la mappa resta usabile)
const SCENA = () => Math.max(innerHeight * 0.42, 300);
const AREA = () => stato.schermo === 'scheda'
  ? { x0: 16, x1: innerWidth - 16, y0: 120, y1: SCENA() - 24 }
  : { x0: 22, x1: innerWidth - 22, y0: 118, y1: SCENA() - 20 };
const posa = (dove = stato.schermo) => {
  const s = stato.schermo; stato.schermo = dove;
  const p = dove === 'casa' ? mondo.pose.casa() : dove === 'scheda' ? mondo.pose.scheda(chiave(giornata[stato.scheda].comune), AREA()) : mondo.pose.giornata(AREA());
  stato.schermo = s;
  return p;
};

// ---------- i cartellini sul plastico ----------
let spilli = [], extra = [];
function cartellini() {
  livello.replaceChildren();
  spilli = []; extra = [];
  const inCasa = stato.schermo === 'casa';
  if (stato.schermo === 'scheda') {
    // il centro vero del comune: la casa del cliente non si mostra (l'indirizzo non esce dal telefono)
    const i = giornata[stato.scheda], k = chiave(i.comune);
    const el = h('div', { class: 'spillo acceso centro' }, h('span', { class: 'filo' }), h('span', { class: 'pallino' }),
      h('span', { class: 'carta' }, `Centro di ${i.comune}`, h('small', {}, 'la via precisa la apre Maps')));
    livello.append(el);
    spilli = [{ el, dove: () => mondo.ancora(k) }];
    // i nomi delle vie principali, scritti lungo la via
    // un foglio SVG sopra il plastico: il nome segue la via (textPath), come sulle carte stradali
    const tela = livello.appendChild(document.createElementNS(SVG, 'svg'));
    tela.setAttribute('class', 'vie');
    extra = mondo.nomiVie(k).map((n, j) => {
      const g = tela.appendChild(document.createElementNS(SVG, 'g'));
      const via = g.appendChild(document.createElementNS(SVG, 'path')); via.id = `via-${j}`;
      const testo = g.appendChild(document.createElementNS(SVG, 'text'));
      const tp = testo.appendChild(document.createElementNS(SVG, 'textPath'));
      tp.setAttribute('href', `#via-${j}`); tp.setAttribute('startOffset', '50%'); tp.setAttribute('text-anchor', 'middle'); tp.textContent = corto(n.nome);
      return { n, el: g, via, testo };
    });
  } else {
    const p = prossimo(), ps = stretto();
    // una cartolina per comune: Tradate ha tre orari e una tappa sola
    const perComune = new Map();
    giornata.forEach((i, k) => { const c = perComune.get(i.comune) ?? { tappe: new Set(), interventi: [] }; c.tappe.add(tappaDi[k] + 1); c.interventi.push(i); perComune.set(i.comune, c); });
    for (const [nome, { tappe, interventi }] of perComune) {
      if (inCasa && (prossimo()?.comune !== nome || document.documentElement.classList.contains('luci-basse'))) continue; // in casa basta il prossimo: la giornata intera è a un tocco (a luci basse niente: la stanza è da riempire)
      const acceso = p?.comune === nome;
      const fatto = interventi.every(i => i.esito);
      const ore = interventi.map(i => (i.esito ? h('span', { class: i.esito === 'OK' ? 'ok' : 'ko' }, `${i.da} ${i.esito}`) : i === p ? h('b', {}, i.da) : i.da));
      const sep = ore.flatMap((o, k) => (k ? [' · ', o] : [o]));
      // il punto stretto si scrive sul cartellino di chi arriva dopo, sopra la strada color ambra che ci porta
      const nota = ps?.a.comune === nome && h('span', { class: 'stretta' }, ` · solo ${ps.minuti} min dopo ${ps.da.comune}`);
      const primo = interventi.find(i => !i.esito) ?? interventi[0];
      // sul punto vero un puntino; il numero della tappa sta sulla carta, che si sposta col suo filo se serve spazio
      // una tappa finita non serve più per intero: resta il numero con l'esito (il nome è nella lista «Fatti»)
      const esiti = [...new Set(interventi.map(i => i.esito))];
      // sui telefoni bassi (spazio della mappa sotto i 200 px) le tappe non accese diventano «3 · 11:00»: il resto è nella lista sotto
      const stretta_ = SCENA() - 118 < 200;
      const carta = fatto
        ? h('span', { class: 'carta corta', onclick: () => vai('scheda', giornata.indexOf(primo)) }, h('span', { class: 'n' }, [...tappe].join('·')), h('span', { class: esiti.includes('KO') ? 'ko' : 'ok' }, esiti.join('/')))
        : stretta_ && !acceso ? h('span', { class: 'carta corta', onclick: () => vai('scheda', giornata.indexOf(primo)) }, h('span', { class: 'n' }, [...tappe].join('·')), primo.da)
        : h('span', { class: 'carta', onclick: () => vai('scheda', giornata.indexOf(primo)) }, h('span', { class: 'n' }, [...tappe].join('·')), nome, h('small', {}, sep, nota));
      const el = h('div', { class: `spillo${acceso ? ' acceso' : ''}${fatto ? ' fatto' : ''}` },
        h('span', { class: 'filo' }), acceso ? h('span', { class: 'pallino' }) : h('span', { class: 'testa' }), carta);
      livello.append(el);
      spilli.push({ el, dove: () => mondo.ancora(chiave(nome)) });
    }
    // quanto è lontano il prossimo: sul tratto che si guida adesso, minuti e chilometri del motore
    const t = trattoProssimo();
    // in casa, se fra la mappa e i tasti c'è poco spazio, il tempo del tratto resta sotto Naviga e qui non si scrive
    const pocoSpazio = inCasa && (document.querySelector('.casa')?.getBoundingClientRect().top ?? innerHeight) < innerHeight * 0.8;
    if (t >= 0 && !pocoSpazio && !(inCasa && document.documentElement.classList.contains('luci-basse'))) {
      const tr = GIRO.tratti[t];
      extra.push({ tratto: t, el: livello.appendChild(h('span', { class: 'tag-tratto' }, `${durata(tr.minuti)} · ${km(tr.metri)}`)) });
    }
  }
  posiziona();
}

// la scala e il nord: dove non coprono le tappe
const bussola = document.getElementById('bussola');
const SCALE = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20];
function mettiBussola(messi) {
  if (stato.schermo === 'casa') { bussola.hidden = true; return; }
  const P = piastraSchermo(), basso = Math.min(SCENA() - 14, P.y1 - 4);
  const sx = Math.max(8, P.x0 + 4), dx = Math.min(innerWidth - 8, P.x1 - 4);
  const posti = [[dx - 116, basso - 40], [sx, basso - 40]];
  const costo = ([x, y]) => messi.filter(m => m.testa || m.strada).filter(m => m.x0 < x + 116 && m.x1 > x && m.y0 < y + 40 && m.y1 > y).length;
  const [x, y] = posti.sort((p, q) => costo(p) - costo(q))[0];
  const b = mondo.bussola(x + 40, y + 30);
  if (!b) { bussola.hidden = true; return; }
  const kmScala = SCALE.find(s => s * b.pxKm >= 44) ?? 20;
  bussola.hidden = false;
  bussola.style.transform = `translate(${x}px, ${y}px)`;
  bussola.querySelector('.ago').style.transform = `rotate(${b.nordAngolo}rad)`;
  bussola.querySelector('.barra-scala').style.width = `${(kmScala * b.pxKm).toFixed(1)}px`;
  bussola.querySelector('.barra-scala').style.transform = `rotate(${b.estAngolo}rad)`;
  bussola.querySelector('.misura').textContent = kmScala < 1 ? `${kmScala * 1000} m` : `${kmScala} km`;
  // nella scheda la vista è inclinata: nord-sud e est-ovest hanno scale diverse, una barra sola mentirebbe
  bussola.querySelector('.scala').hidden = stato.schermo !== 'giornata';
  messi.push({ x0: x - 4, x1: x + 120, y0: y - 4, y1: y + 44 });
}

// il riquadro della piastra sullo schermo, con 4 px d'aria: niente carte che escono dal legno
function piastraSchermo() {
  const c = mondo.angoliPiastra();
  if (c.some(v => v.dietro)) return { x0: -1e4, x1: 1e4, y0: -1e4, y1: 1e4 }; // da vicino la piastra va oltre lo schermo (e dietro la camera)
  return { x0: Math.min(...c.map(v => v.x)) + 4, x1: Math.max(...c.map(v => v.x)) - 4, y0: Math.min(...c.map(v => v.y)) + 4, y1: Math.max(...c.map(v => v.y)) - 4 };
}
// un segmento attraversa un riquadro? (Liang-Barsky); i fili già messi sono segmenti, il resto riquadri
function segBox(a, b, m) {
  if (m.seg) return false;
  let t0 = 0, t1 = 1; const dx = b.x - a.x, dy = b.y - a.y;
  for (const [pp, q] of [[-dx, a.x - m.x0], [dx, m.x1 - a.x], [-dy, a.y - m.y0], [dy, m.y1 - a.y]]) {
    if (pp === 0) { if (q < 0) return false; continue; }
    const t = q / pp; if (pp < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}
// una polilinea sullo schermo tagliata sul riquadro: i pezzi che stanno dentro
function dentroRiquadro(q, R) {
  const pezzi = []; let cur = [];
  for (let i = 0; i + 1 < q.length; i++) {
    const a = q[i], b = q[i + 1], dx = b.x - a.x, dy = b.y - a.y;
    let t0 = 0, t1 = 1, fuori = false;
    for (const [pp, qq] of [[-dx, a.x - R.x0], [dx, R.x1 - a.x], [-dy, a.y - R.y0], [dy, R.y1 - a.y]]) {
      if (pp === 0) { if (qq < 0) fuori = true; continue; }
      const t = qq / pp; if (pp < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    }
    if (fuori || t0 > t1) { if (cur.length > 1) pezzi.push(cur); cur = []; continue; }
    const A = { x: a.x + dx * t0, y: a.y + dy * t0 }, B = { x: a.x + dx * t1, y: a.y + dy * t1 };
    if (!cur.length) cur = [A];
    cur.push(B);
    if (t1 < 1) { pezzi.push(cur); cur = []; }
  }
  if (cur.length > 1) pezzi.push(cur);
  return pezzi;
}
// le abbreviazioni delle carte stradali italiane, solo per il tipo di via: il nome resta intero
const corto = n => n.replace(/^Piazzale /, 'P.le ').replace(/^Piazza /, 'P.za ').replace(/^Corso /, 'C.so ').replace(/^Viale /, 'V.le ').replace(/^Largo /, 'L.go ');
// una polilinea sullo schermo con un punto ogni ~6 px
function fitta(q) {
  const out = [q[0]];
  for (let i = 1; i < q.length; i++) {
    const n = Math.max(1, Math.round(Math.hypot(q[i].x - q[i - 1].x, q[i].y - q[i - 1].y) / 6));
    for (let k = 1; k <= n; k++) out.push({ x: q[i - 1].x + (q[i].x - q[i - 1].x) * k / n, y: q[i - 1].y + (q[i].y - q[i - 1].y) * k / n });
  }
  return out;
}
// due fili si incrociano? (stesso punto di partenza = no)
function segSeg(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  if (Math.hypot(a.x - c.x, a.y - c.y) < 1) return false;
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
const tocca = (b, lista) => lista.some(m => (m.seg ? segBox(m.seg[0], m.seg[1], b) : b.x0 < m.x1 && b.x1 > m.x0 && b.y0 < m.y1 && b.y1 > m.y0));
const sopra = (b, lista) => lista.reduce((t, m) => t + (m.seg ? (segBox(m.seg[0], m.seg[1], b) ? 400 : 0) : Math.max(0, Math.min(b.x1, m.x1) - Math.max(b.x0, m.x0)) * Math.max(0, Math.min(b.y1, m.y1) - Math.max(b.y0, m.y0))), 0);

// i cartellini non si coprono: il cartellino acceso per primo, poi dal più vicino al più lontano; ognuno prova posti
// sempre più lontani dal suo (più su, più giù, spostato di lato) e prende il primo libero, senza coprire cartellini,
// numeri delle tappe, il tratto che si guida e quello stretto. Il numero resta sul punto vero: si sposta solo la carta.
function posiziona() {
  if (inVolo) return; // in volo cartellini e scala sono nascosti: si mettono a volo finito
  const cima = 58;
  const messi = [...document.querySelectorAll('.barra .pillola, .titolo-barra')].map(e => { const r = e.getBoundingClientRect(); return { x0: r.left - 4, x1: r.right + 4, y0: r.top - 4, y1: r.bottom + 4 }; });
  const pronti = spilli.map(s => ({ s, v: s.dove() })).filter(x => x.v).map(x => ({ ...x, p: mondo.proietta(x.v) }));
  for (const { p } of pronti) messi.push({ x0: p.x - 15, x1: p.x + 15, y0: p.y - 15, y1: p.y + 15, testa: true });
  if (stato.schermo === 'scheda') for (const m of messi) if (m.testa) Object.assign(m, { x0: m.x0 + 5, x1: m.x1 - 5, y0: m.y0 + 5, y1: m.y1 - 5 }); // il pallino del centro è piccolo
  if (stato.schermo !== 'scheda') {
    const ps = stretto(), st = ps ? GIRO.tratti.findIndex(t => GIRO.tappe[t.da].comune === ps.da.comune && GIRO.tappe[t.a].comune === ps.a.comune) : -1;
    for (const i of new Set([st, trattoProssimo()])) for (const v of mondo.puntiTratto(i)) { const q = mondo.proietta(v); messi.push({ x0: q.x - 7, x1: q.x + 7, y0: q.y - 7, y1: q.y + 7, strada: true }); }
  }
  if (stato.schermo !== 'scheda') mettiBussola(messi);
  if (stato.schermo === 'scheda') { for (const x of extra) if (x.n) x.scritta = false; scriviVie(messi, true); mettiBussola(messi); } // le vie principali prima della carta del centro e del nord
  // prima il prossimo, poi le tappe da fare dall'alto in giù, per ultime quelle fatte
  const peso = x => (x.s.el.classList.contains('acceso') ? 0 : x.s.el.classList.contains('fatto') ? 2 : 1);
  pronti.sort((a, b) => peso(a) - peso(b) || a.p.y - b.p.y);
  const basso = stato.schermo === 'casa' ? (document.querySelector('.casa')?.getBoundingClientRect().top ?? innerHeight) - 12 : SCENA() - 12; // l'area di tocco non finisce sotto il foglio o sotto i tasti
  const P = piastraSchermo();
  for (const { s, p } of pronti) {
    const mio = messi.find(m => m.testa && Math.abs((m.x0 + m.x1) / 2 - p.x) < 0.01 && Math.abs((m.y0 + m.y1) / 2 - p.y) < 0.01);
    const c = s.el.querySelector('.carta'), w = (s.w ??= c.offsetWidth), hh = (s.hh ??= c.offsetHeight);
    const prove = [];
    for (const r of [10, 18, 28, 40, 54, 70, 88, 108, 130]) for (let k = 0; k < 16; k++) {
      const th = k * Math.PI / 8, dx = Math.sin(th), dy = -Math.cos(th);
      const ext = Math.abs(dx) * w / 2 + Math.abs(dy) * hh / 2;
      const cx = p.x + dx * (r + ext), cy = p.y + dy * (r + ext);
      // preferenze: vicino; a parità sopra, poi di lato, sotto per ultimo
      // il filo arriva al bordo della carta: dal centro della carta verso il punto, dove esce dal riquadro
      const dentroCarta = Math.min(Math.abs(dx) > 1e-6 ? w / 2 / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? hh / 2 / Math.abs(dy) : Infinity);
      const lungo = r + ext - dentroCarta;
      prove.push({ r: lungo, th, cx, cy, box: { x0: cx - w / 2 - 3, x1: cx + w / 2 + 3, y0: cy - hh / 2 - 6, y1: cy + hh / 2 + 6 } /* 6 px sopra e sotto: le aree di tocco (±6 px) non si toccano */, fine: { x: p.x + dx * lungo, y: p.y + dy * lungo }, costo: r + (1 - Math.cos(th)) * 12 });
    }
    prove.sort((x, y) => x.costo - y.costo);
    const dentro = b => b.y0 > Math.max(cima, P.y0) && b.y1 < Math.min(basso, P.y1) && b.x0 > Math.max(2, P.x0) && b.x1 < Math.min(innerWidth - 2, P.x1);
    const ostacoli = messi.filter(m => m !== mio);
    const filoLibero = q => !ostacoli.some(m => (m.seg ? segSeg(p, q.fine, ...m.seg) : !m.strada && segBox(p, q.fine, m)));
    const libera = prove.find(q => dentro(q.box) && !tocca(q.box, ostacoli) && filoLibero(q))
      ?? prove.filter(q => dentro(q.box)).map(q => ({ ...q, c: sopra(q.box, ostacoli) })).sort((x, y) => x.c - y.c)[0] ?? prove[0]; // nessun posto libero: il meno coperto
    messi.push(libera.box, { seg: [p, libera.fine] });
    s.el.style.setProperty('--r', `${libera.r}px`); s.el.style.setProperty('--ang', `${libera.th.toFixed(3)}rad`);
    s.el.style.setProperty('--cx', `${(libera.box.x0 + 3 - p.x).toFixed(1)}px`); s.el.style.setProperty('--cy', `${(libera.box.y0 + 6 - p.y).toFixed(1)}px`);
    s.el.style.setProperty('--x', `${p.x.toFixed(1)}px`); s.el.style.setProperty('--y', `${p.y.toFixed(1)}px`);
    s.el.classList.toggle('via', p.dietro);
  }
  // l'etichetta del tratto, dopo i cartellini: sul nastro, dove non copre nessuno, come i tempi di Maps
  for (const x of extra.filter(x => x.tratto != null)) {
    const w = (x.w ??= x.el.offsetWidth), hh = (x.hh ??= x.el.offsetHeight);
    // sul nastro a varie altezze del tratto; se non c'è posto, accanto al nastro (di qua o di là)
    const prove = [];
    for (const off of [0, 1, -1, 2, -2]) for (const f of [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78, 0.14, 0.86]) {
      const a = mondo.proietta(mondo.campiona(x.tratto, Math.max(0, f - 0.02))), b = mondo.proietta(mondo.campiona(x.tratto, Math.min(1, f + 0.02)));
      const L = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L, sp = off * (Math.abs(nx) * w / 2 + Math.abs(ny) * hh / 2 + 5);
      prove.push({ x: (a.x + b.x) / 2 + nx * sp, y: (a.y + b.y) / 2 + ny * sp });
    }
    const box = q => ({ x0: q.x - w / 2, x1: q.x + w / 2, y0: q.y - hh / 2, y1: q.y + hh / 2 });
    const Pt = piastraSchermo(), sulLegno = q => { const b = box(q); return b.x0 > Pt.x0 && b.x1 < Pt.x1 && b.y0 > Pt.y0 && b.y1 < Math.min(Pt.y1, basso); };
    const libera = prove.find(q => sulLegno(q) && !tocca(box(q), messi.filter(m => !m.strada))) ?? prove.map(q => ({ ...q, c: sopra(box(q), messi.filter(m => !m.strada)) + (sulLegno(q) ? 0 : 1e6) })).sort((u, v) => u.c - v.c)[0];
    x.el.style.transform = `translate(${(libera.x - w / 2).toFixed(1)}px, ${(libera.y - hh / 2).toFixed(1)}px)`;
    messi.push({ x0: libera.x - w / 2 - 3, x1: libera.x + w / 2 + 3, y0: libera.y - hh / 2 - 3, y1: libera.y + hh / 2 + 3 });
  }
  scriviVie(messi, false); // poi le altre vie, finché c'è posto
}

// i nomi delle vie: su un tratto della via lungo quanto il nome, che giri poco, il più vicino al centro; al massimo sei.
// Prima le principali (fino a tertiary, scritte prima della carta del centro, che si sposta col suo filo), poi le altre.
function scriviVie(messi, principali) {
  const a = AREA(), cx = (a.x0 + a.x1) / 2, cy = (a.y0 + a.y1) / 2;
  let scritte = extra.filter(x => x.n && x.el.style.display !== 'none' && x.scritta).length;
  for (const x of extra.filter(x => x.n && (x.n.classe <= 4) === principali)) {
    x.lungo ??= x.testo.getComputedTextLength() || corto(x.n.nome).length * 6; // misurata da visibile, una volta
    x.el.style.display = 'none'; x.scritta = false;
    if (scritte >= 6) continue;
    const w = x.lungo + 10;
    let meglio = null;
    const curva = x.n.classe <= 4 ? 1.4 : 0.7; // la scritta segue la via (textPath): le principali possono girare di più
    for (const pezzo of x.n.pezzi) for (const q of dentroRiquadro(pezzo.map(v => mondo.proietta(v)), { x0: 6, x1: innerWidth - 6, y0: 68, y1: SCENA() - 10 }).map(fitta)) {
      for (let i = 0; i + 1 < q.length; i++) {
        let L = 0, giro = 0;
        for (let j = i + 1; j < q.length; j++) {
          if (j > i + 1) {
            let d = Math.abs(Math.atan2(q[j].y - q[j - 1].y, q[j].x - q[j - 1].x) - Math.atan2(q[j - 1].y - q[j - 2].y, q[j - 1].x - q[j - 2].x));
            if (d > Math.PI) d = 2 * Math.PI - d;
            if ((giro += d) > curva) break;
          }
          L += Math.hypot(q[j].x - q[j - 1].x, q[j].y - q[j - 1].y);
          if (L < w) continue;
          const pts = q.slice(i, j + 1);
          // l'ingombro della scritta: quadretti lungo la via, ogni 10 px (una scritta in diagonale non è un rettangolo)
          const quadri = [];
          for (let k = 0; k + 1 < pts.length; k++) {
            const n = Math.ceil(Math.hypot(pts[k + 1].x - pts[k].x, pts[k + 1].y - pts[k].y) / 10);
            for (let u = 0; u <= n; u++) { const X = pts[k].x + (pts[k + 1].x - pts[k].x) * u / n, Y = pts[k].y + (pts[k + 1].y - pts[k].y) * u / n; quadri.push({ x0: X - 6.5, x1: X + 6.5, y0: Y - 6.5, y1: Y + 6.5, strada: true }); }
          }
          const mx = pts.reduce((t, r) => t + r.x, 0) / pts.length, my = pts.reduce((t, r) => t + r.y, 0) / pts.length, d = Math.hypot(mx - cx, my - cy);
          if ((!meglio || d < meglio.d) && !quadri.some(b => tocca(b, messi))) meglio = { d, quadri, pts };
          break;
        }
      }
    }
    if (!meglio) continue;
    const pts = meglio.pts.at(-1).x < meglio.pts[0].x ? [...meglio.pts].reverse() : meglio.pts; // da sinistra a destra: si legge diritto
    x.via.setAttribute('d', 'M' + pts.map(r => `${r.x.toFixed(1)} ${r.y.toFixed(1)}`).join(' L'));
    x.el.style.display = ''; x.scritta = true;
    messi.push(...meglio.quadri); scritte++;
  }
}

// ---------- i tre tasti ----------
// nella scheda si può aprire qualunque intervento: i minuti partono da dove sei adesso (l'ultimo fatto), e lo si scrive;
// nel Prossimo della giornata il punto di partenza è già sul plastico (il tratto blu)
const azioni = (i, conDa = false) => h('div', { class: 'azioni' },
  h('a', { href: '#', class: 'primo', onclick: e => e.preventDefault() }, icona('naviga'), 'Naviga', h('span', { class: 'guida' }, guidaPer(i)),
    conDa && h('span', { class: 'da' }, daDove() === i.comune ? 'sei già lì' : `da ${daDove()}`)),
  h('a', { href: '#', onclick: e => e.preventDefault() }, icona('chiama'), 'Chiama'),
  h('a', { href: '#', onclick: e => e.preventDefault() }, icona('messaggio'), 'Sto arrivando'));

// la fonte della mappa, in fondo: cosa è vero e da dove viene
const fonteMappa = () => [
  h('p', { class: 'piede' }, 'Mappa: ', h('a', { href: GIRO.link, rel: 'noopener', target: '_blank' }, '© OpenStreetMap contributors'), ` (ODbL), estratto del ${DATA_ESTRATTO}.`),
  h('p', { class: 'piede' }, `Strade, centri ed edifici veri. La giornata è vista dall'alto: in proporzione, nord in alto. Edifici senza altezza nel dato: 2 piani (${ALTEZZA_SENZA_DATO} m). Percorso e minuti: OSRM da centro a centro, senza traffico.`)];

// ---------- schermi ----------
function schermoCasa() {
  const p = prossimo();
  return [h('section', { class: 'casa' },
    h('button', { type: 'button', class: 'casa-entra', onclick: () => vai('giornata') },
      h('span', { class: 'titolo' }, 'Il giro di oggi'),
      p && h('span', { class: 'sotto' }, 'Prossimo: ', h('b', {}, `${p.comune} alle ${p.da}`))),
    h('div', { class: 'casa-riga' },
      h('a', { class: 'casa-piccolo', href: '#', onclick: e => e.preventDefault() }, 'Componi'),
      h('button', { type: 'button', class: 'casa-piccolo' }, 'Incolla codice'),
      h('button', { type: 'button', class: 'casa-piccolo' }, 'Dalle foto')))];
}

function barraGiornata() {
  return h('header', { class: 'barra' },
    h('button', { type: 'button', class: 'pillola indietro', onclick: () => vai('casa') }, icona('indietro', false), 'Parete'),
    h('div', { class: 'titolo-barra' }, h('b', {}, 'Oggi'), h('span', {}, DATA)),
    h('button', { type: 'button', class: 'pillola' }, 'Foglio nuovo'));
}

function riga(i) {
  const k = giornata.indexOf(i);
  return h('a', { class: i.esito ? 'riga fatta' : 'riga', href: `?s=scheda&i=${k}`, onclick: e => { e.preventDefault(); vai('scheda', k); } },
    h('span', { class: 'ora' }, i.da, !i.esito && cielo(i)),
    h('span', { class: 'corpo' }, h('div', { class: 'principale' }, i.comune), h('div', { class: 'secondaria' }, i.lavoro),
      !i.esito && i.meteo && h('div', { class: 'avviso-meteo' }, i.meteo), !i.esito && i.nota && h('div', { class: 'nota' }, i.nota)),
    i.esito && h('span', { class: i.esito === 'OK' ? 'esito-ok' : 'esito-ko' }, i.esito),
    h('span', { class: 'chevron' }, icona('chevron', false)));
}

function schermoGiornata() {
  const p = prossimo(), poi = giornata.filter(i => !i.esito && i !== p), fatti = giornata.filter(i => i.esito);
  const ps = puntoStretto(giornata);
  const puntuali = ps?.puntuale ? `. Quello delle ${(ps.da.nota.includes('Puntuale') ? ps.da : ps.a).da} è puntuale` : '';
  const prima = h('section', { class: 'gruppo' },
    h('div', { class: 'testa' }, h('h2', {}, 'Prima di partire'),
      !stato.visto && h('button', { type: 'button', class: 'visto', onclick: () => { stato.visto = true; disegna(); } }, 'Visto')),
    h('div', { class: 'lista' },
      ps && ps.minuti <= 60 && h('div', { class: 'riga stretto' }, icona('info', false),
        h('span', { class: 'corpo' }, h('div', { class: 'principale' }, `Punto stretto: ${ps.minuti} minuti`),
          h('div', { class: 'secondaria' }, `fra ${ps.da.comune} alle ${ps.da.da} e ${ps.a.comune} alle ${ps.a.da}, strada compresa${puntuali}`))),
      h('button', { type: 'button', class: 'riga azione' }, 'Aggiungi la giornata al Calendario')),
    h('p', { class: 'piede' }, 'Nel calendario vanno solo comune, lavoro e note, mai il nome del cliente.'));
  const meteo = giornata.find(i => !i.esito && i.meteo);
  return [barraGiornata(),
    h('div', { class: 'foglio' }, h('div', { class: 'maniglia' }),
      p ? h('section', { class: 'prossimo', 'aria-label': 'Prossimo intervento' },
        h('p', { class: 'stato-prossimo' }, quantoManca(p) ? `Prossimo, ${quantoManca(p)}` : 'Prossimo'),
        h('p', { class: 'ora' }, quando(p), cielo(p)),
        h('h1', { class: 'dove' }, p.comune),
        h('p', { class: 'chi' }, p.cliente),
        h('p', { class: 'cosa' }, p.lavoro),
        p.nota && h('p', { class: 'nota' }, p.nota),
        // posto riservato (arriva dalla rete): mai vuoto, così non sembra una riga mancante
        h('p', { class: p.meteo ? 'meteo-riga avviso' : 'meteo-riga' }, p.meteo ?? 'Niente pioggia né vento forte'),
        azioni(p),
        h('button', { type: 'button', class: 'segna', onclick: () => vai('scheda', prossimoI()) }, 'Segna l’esito'))
        : h('section', { class: 'prossimo' }, h('h1', { class: 'dove' }, 'Giornata finita'), h('p', { class: 'cosa' }, 'Hai segnato tutti gli interventi.')),
      !stato.visto && prima,
      h('section', { class: 'gruppo' }, h('h2', {}, 'Meteo'), h('div', { class: 'lista' },
        h('div', { class: 'riga meteo' }, icona('meteo', false), h('span', { class: 'corpo' },
          h('div', { class: 'principale' }, meteo ? `${meteo.meteo} alle ${meteo.da} a ${meteo.comune}` : 'Niente pioggia né vento forte'),
          h('div', { class: 'secondaria' }, 'Nelle ore dei tuoi interventi')))),
        h('p', { class: 'piede' }, 'Meteo: AROME di Météo-France e ICON-2I, per ogni ora il peggiore dei due (dati di prova).')),
      poi.length > 0 && h('section', { class: 'gruppo' }, h('h2', {}, 'Poi'), h('div', { class: 'lista' }, poi.map(riga))),
      fatti.length > 0 && h('section', { class: 'gruppo' }, h('h2', {}, 'Fatti'), h('div', { class: 'lista' }, fatti.map(riga))),
      stato.visto && prima,
      h('section', { class: 'gruppo' }, h('h2', {}, 'Fine giornata'), h('div', { class: 'lista' },
        h('button', { type: 'button', class: 'riga azione' }, 'Manda il foglio all’ufficio'),
        h('label', { class: 'riga' }, h('span', { class: 'etichetta' }, 'Nei messaggi sei'), h('input', { placeholder: 'il tuo nome', autocomplete: 'given-name' }))),
        h('p', { class: 'piede' }, 'Nel foglio vanno solo esito, motivo KO ed euro extra. I dati restano in questo telefono.'),
        fonteMappa())),
    stato.annulla && h('div', { class: 'avviso-basso', role: 'status' }, h('span', {}, stato.annulla.testo),
      h('button', { type: 'button', onclick: annullaOk }, 'Annulla'))];
}

function schermoScheda(k) {
  const i = giornata[k];
  const campo = (etichetta, props) => h('label', { class: 'riga' }, h('span', { class: 'etichetta' }, etichetta), h('input', props));
  const q = mondo.quanti(chiave(i.comune));
  return [h('header', { class: 'barra' },
    h('button', { type: 'button', class: 'pillola indietro', onclick: () => vai('giornata') }, icona('indietro', false), 'Oggi')),
  h('div', { class: 'foglio' }, h('div', { class: 'maniglia' }),
    h('section', { class: 'prossimo testata' },
      h('p', { class: 'ora' }, quando(i), cielo(i)),
      h('h1', { class: 'dove' }, i.comune),
      h('p', { class: 'chi' }, i.cliente),
      h('p', { class: 'cosa' }, i.lavoro),
      i.nota && h('p', { class: 'nota' }, i.nota),
      azioni(i, true)),
    h('section', { class: 'gruppo' }, h('h2', {}, 'Esito'),
      h('div', { class: 'segmenti', role: 'group', 'aria-label': 'Esito' },
        h('button', { type: 'button', class: 'ok', 'aria-pressed': String(i.esito === 'OK'), onclick: () => segnaOk(k) }, 'OK'),
        h('button', { type: 'button', class: 'ko', 'aria-pressed': String(i.esito === 'KO'), onclick: () => { i.esito = i.esito === 'KO' ? null : 'KO'; aggiornaScena(); disegna(); } }, 'KO')),
      h('div', { class: 'lista' },
        i.esito === 'KO' && campo('Motivo KO', { placeholder: 'scegli o scrivi' }),
        campo('Euro extra', { inputmode: 'decimal', placeholder: '0 €' }))),
    h('section', { class: 'gruppo' }, h('h2', {}, 'Indirizzo e telefono'), h('div', { class: 'lista' },
      campo('Via', { placeholder: 'incolla la via' }), campo('Telefono', { type: 'tel', placeholder: 'incolla il numero' })),
    h('p', { class: 'piede' }, `Non sono nel foglio: incollali da un messaggio. Senza via, Naviga ti porta in centro a ${i.comune}.`),
    h('p', { class: 'piede' }, `Sopra: il centro di ${i.comune} entro 800 m, ${q.edifici} edifici da OpenStreetMap (${q.senzaDato} senza altezza nel dato: 2 piani).`),
    fonteMappa()))];
}

function disegna(entra = false) {
  document.body.dataset.schermo = stato.schermo;
  const s = stato.schermo === 'casa' ? schermoCasa() : stato.schermo === 'scheda' ? schermoScheda(stato.scheda) : schermoGiornata();
  ui.replaceChildren(...s);
  if (entra) ui.querySelector('.foglio')?.classList.add('entra');
  cartellini();
}

// ---------- i passaggi: la camera vola, lo schermo cambia ----------
let inVolo = false;
// cartellini e scala spariscono durante il volo (sarebbero da ricalcolare a ogni fotogramma) e tornano a volo finito
async function volo(posa_, durata_, ...luci) {
  livello.style.opacity = 0; bussola.hidden = true;
  await mondo.vola(posa_, durata_, ...luci);
  livello.style.opacity = 1;
}
async function vai(dove, k = null, { storia = true } = {}) {
  if (inVolo) return;
  inVolo = true;
  const da = stato.schermo;
  if (storia) history.pushState(null, '', `?s=${dove}${dove === 'scheda' ? `&i=${k}` : ''}`);
  if (dove === 'giornata') {
    if (da === 'casa') {
      ui.querySelector('.casa')?.classList.add('via');
      mondo.led(true);
      document.body.dataset.schermo = 'giornata';
      setTimeout(() => { stato.schermo = 'giornata'; aggiornaScena(); disegna(true); }, ms(650));
      await volo(posa('giornata'), ms(1400), LUCE_GIRO, 0);
      mondo.led(false);
    } else {
      stato.schermo = 'giornata'; aggiornaScena(); disegna(); ui.querySelector('.foglio')?.classList.add('cambia');
      await volo(posa('giornata'), ms(900));
    }
  } else if (dove === 'scheda') {
    stato.schermo = 'scheda'; stato.scheda = k ?? prossimoI();
    aggiornaScena();
    livello.replaceChildren(); spilli = []; extra = [];
    const viaggio = volo(posa('scheda'), ms(1300));
    disegna(); ui.querySelector('.foglio')?.classList.add('cambia');
    await viaggio;
    cartellini();
  } else {
    stato.schermo = 'casa';
    livello.replaceChildren(); spilli = []; extra = [];
    ui.replaceChildren();
    mondo.led(true);
    document.body.dataset.schermo = 'casa';
    bussola.hidden = true;
    await volo(posa('casa'), ms(1400), 0, 1);
    disegna();
  }
  inVolo = false;
  posiziona();
}

// OK dalla scheda: si torna sul plastico, il tratto fatto si spegne, si accende il prossimo
async function segnaOk(k) {
  const i = giornata[k];
  if (i.esito === 'OK') { i.esito = null; return disegna(); }
  i.esito = 'OK';
  document.querySelector('.segmenti .ok')?.setAttribute('aria-pressed', 'true'); // si vede subito, poi si vola
  stato.annulla = { k, testo: `${i.comune} segnato OK` };
  setTimeout(() => { if (stato.annulla?.k === k) { stato.annulla = null; document.querySelector('.avviso-basso')?.remove(); } }, 8000);
  history.pushState(null, '', '?s=giornata');
  inVolo = true;
  stato.schermo = 'giornata';
  livello.replaceChildren(); spilli = []; extra = [];
  aggiornaScena();
  disegna(); ui.querySelector('.foglio')?.classList.add('cambia');
  await volo(posa('giornata'), ms(1100));
  inVolo = false;
  cartellini();
}
function annullaOk() {
  const k = stato.annulla?.k;
  stato.annulla = null;
  if (k == null) return;
  giornata[k].esito = null;
  aggiornaScena();
  disegna();
}

// quando il foglio passa sotto la barra, la barra prende il suo vetro (come le barre di iOS)
addEventListener('scroll', () => document.querySelector('.barra')?.classList.toggle('piena', scrollY > SCENA() - 70), { passive: true });
addEventListener('resize', () => { if (stato.schermo !== 'casa' && !inVolo) mondo.vola(posa(), 0).then(posiziona); });

addEventListener('popstate', () => {
  const q = new URLSearchParams(location.search);
  vai(q.get('s') ?? 'casa', q.has('i') ? +q.get('i') : null, { storia: false });
});

// ---------- avvio ----------
// la parete: quella del telefono, nell'IndexedDB di Giro (aperto come apri() in app/parete.js: db «giro» v1, store «parete», chiave
// «copertine»; scadenza 800 ms come leggiCopertine). Due forme: un elenco di Blob JPEG (le sue foto, da prepara()) o una parete composta
// sul poster shop ({ colore, tessere: [{ url, col, row }] }). Niente, vuoto o errore: parete vuota. Si accetta solo la forma attesa.
const dalTelefono = () => Promise.race([new Promise((ok, no) => {
  const r = indexedDB.open('giro', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('parete');
  r.onerror = () => no(r.error);
  r.onsuccess = () => {
    const t = r.result.transaction('parete', 'readonly'), g = t.objectStore('parete').get('copertine');
    t.oncomplete = () => ok(g.result ?? null); t.onerror = () => no(t.error);
  };
}), new Promise(ok => setTimeout(() => ok(null), 800))]).catch(() => null);
function forma(v) {
  if (Array.isArray(v)) {
    const blob = v.filter(b => b instanceof Blob && /^image\//.test(b.type)).slice(0, 9); // al massimo nove: la disposizione della stanza
    return { copertine: blob.map(b => URL.createObjectURL(b)) };
  }
  const intero = n => Number.isInteger(n) && n >= 0 && n <= 20;
  if (v && Array.isArray(v.tessere)) {
    const tessere = v.tessere.filter(t => typeof t?.url === 'string' && (/^https:\/\//.test(t.url) || t.url.startsWith(`${location.origin}/`)) && t.url.length <= 300 && intero(t.col) && intero(t.row)).slice(0, 25);
    return { colore: /^#[0-9a-f]{6}$/i.test(v.colore ?? '') ? v.colore : null, tessere };
  }
  return { tessere: [] };
}
// ?parete=vuota (nessun poster); ?copertine=locali e ?parete=composta|tre|rotta (copertine di prova dal disco: solo per prove e scatti,
// da copertine-locali.js); ?luci=basse (la prima schermata: stanza vuota, luci basse, mappa della zona senza percorso);
// ?colore=rrggbb (le luci di un colore solo, scelto dal tecnico); ?insegna=rrggbb (l'insegna accesa di quel colore)
const Q0 = new URLSearchParams(location.search), BASSE = Q0.get('luci') === 'basse', VERIFICA = Q0.get('verifica') === 'blender';
async function parete() {
  const p = Q0.get('parete');
  if (BASSE || VERIFICA || p === 'vuota') return { tessere: [] };
  if (Q0.get('copertine') === 'locali' || ['composta', 'tre', 'rotta'].includes(p)) {
    try { const L = await import('./copertine-locali.js'); return L.PARETI_LOCALI[p] ?? { copertine: L.COLLAGE_LOCALE }; } catch { return { tessere: [] }; }
  }
  return forma(await dalTelefono());
}
mondo = await creaMondo(document.getElementById('mondo'), GIRO, await parete());
if (VERIFICA) { await mondo.verificaBlender(); document.documentElement.classList.add('verifica'); } // solo il canvas, contro riferimento-agx.png
if (BASSE) { mondo.luci({ base: 0.35, led: 0 }); mondo.soloZona(true); document.documentElement.classList.add('luci-basse'); }
if (/^[0-9a-f]{6}$/i.test(Q0.get('colore') ?? '')) mondo.coloreLuci(`#${Q0.get('colore')}`);
if (/^[0-9a-f]{6}$/i.test(Q0.get('insegna') ?? '')) await mondo.insegna(`#${Q0.get('insegna')}`);
mondo.dopoDisegno(posiziona); // durante i voli posiziona() non fa niente: i cartellini sono nascosti
mondo.trascinabile(document.getElementById('presa'));
const q = new URLSearchParams(location.search);
const inizio = ['casa', 'giornata', 'scheda'].includes(q.get('s')) ? q.get('s') : 'casa';
stato.schermo = inizio;
stato.scheda = inizio === 'scheda' ? Math.min(6, Math.max(0, +(q.get('i') ?? prossimoI()))) : null;
aggiornaScena();
await document.fonts.ready;
if (inizio === 'casa') { mondo.led(true); await mondo.vola(posa(), 0, 0, 1); }
else { mondo.led(false); await mondo.vola(posa(), 0, LUCE_GIRO, 0); }
disegna();
window.__pronto = performance.now(); // per le misure: dall'apertura alla mappa pronta
document.documentElement.dataset.pronto = '1';
window.__mondo = mondo; window.__vai = vai; window.__segnaOk = segnaOk; window.__GIRO = GIRO; window.__stato = stato; // per le prove
window.__giornata = giornata; window.__ridisegna = () => { aggiornaScena(); disegna(); };
