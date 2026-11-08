// Il foglio dei turni da una foto o da uno screenshot, letto SOLO nel telefono. L'OCR (Tesseract, app/vendor/tesseract/) si
// scarica alla prima foto e resta in cache; la foto e quello che c'è scritto non escono mai.
// Strada: la tabella si trova dai suoi bordi (linee lunghe e sottili), si raddrizza, si toglie la luce non uniforme, si
// trovano le linee interne come nel PDF, l'OCR legge le parole, e il resto lo fa lo stesso leggiFoglio del PDF.
import { leggiFoglio, leggiOrario, leggiVincoli, norm, COLONNE, GIORNI, MESI } from './lettore.js';

// ---------- immagini in grigio: { g: Uint8ClampedArray, w, h } ----------
export function grigi(rgba, w, h) {
  const g = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  return { g, w, h };
}

// media per aree: il lato lungo al massimo `lato`
export function rimpicciolisci(img, lato) {
  const f = Math.max(img.w, img.h) / lato;
  if (f <= 1) return img;
  const w = Math.round(img.w / f), h = Math.round(img.h / f), g = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * f), y1 = Math.max(y0 + 1, Math.min(img.h, Math.floor((y + 1) * f)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * f), x1 = Math.max(x0 + 1, Math.min(img.w, Math.floor((x + 1) * f)));
      let s = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0, i = yy * img.w + x0; xx < x1; xx++, i++) s += img.g[i];
      g[y * w + x] = s / ((y1 - y0) * (x1 - x0));
    }
  }
  return { g, w, h };
}

// le «creste»: pixel più scuri di tutti e due i vicini a distanza d (sopra/sotto = riga orizzontale, destra/sinistra = verticale).
// Una linea sottile è una cresta; il bordo del foglio sul tavolo è un gradino, non una cresta.
function creste({ g, w, h }, d, soglia) {
  const oriz = new Uint8Array(w * h), vert = new Uint8Array(w * h);
  for (let y = d; y < h - d; y++) {
    for (let x = d, i = y * w + d; x < w - d; x++, i++) {
      const v = g[i];
      if (Math.min(g[i - d * w], g[i + d * w]) - v > soglia) oriz[i] = 1;
      if (Math.min(g[i - d], g[i + d]) - v > soglia) vert[i] = 1;
    }
  }
  return { oriz, vert };
}

// Hough ristretto alle linee quasi orizzontali (y = r + x·tan t) o quasi verticali (x = r + y·tan t), |t| ≤ 25°.
// Dentro `zona(x, y)` soltanto. Ritorna le linee forti (≥ metà della più forte), già separate fra loro.
function linee(maschera, w, h, verticale, zona = () => true) {
  const passo = 0.25, n = Math.round(50 / passo) + 1;
  const tan = Float64Array.from({ length: n }, (_, k) => Math.tan(((k * passo - 25) * Math.PI) / 180));
  const [lungo, corto] = verticale ? [h, w] : [w, h];
  const R0 = Math.ceil(lungo * Math.tan((25 * Math.PI) / 180)) + 2, nr = corto + 2 * R0;
  const acc = new Uint32Array(n * nr);
  for (let y = 0; y < h; y++) {
    for (let x = 0, i = y * w; x < w; x++, i++) {
      if (!maschera[i] || !zona(x, y)) continue;
      const [a, b] = verticale ? [y, x] : [x, y]; // b = r + a·tan t
      for (let k = 0; k < n; k++) acc[k * nr + Math.round(b - a * tan[k]) + R0]++;
    }
  }
  let max = 0;
  for (const v of acc) if (v > max) max = v;
  if (!max) return [];
  const picchi = [];
  for (let k = 0; k < n; k++) {
    for (let r = 1; r < nr - 1; r++) {
      const v = acc[k * nr + r];
      if (v < max * 0.5) continue;
      let massimo = true;
      for (let dk = -2; dk <= 2 && massimo; dk++) {
        for (let dr = -3; dr <= 3; dr++) {
          const kk = k + dk, rr = r + dr;
          if ((dk || dr) && kk >= 0 && kk < n && rr >= 0 && rr < nr && acc[kk * nr + rr] > v) { massimo = false; break; }
        }
      }
      if (massimo) picchi.push({ t: tan[k], r: r - R0, voti: v });
    }
  }
  // una linea vera dà picchi vicini fra loro: si tiene il più forte entro 6 px (misurati a metà del lato lungo)
  const mezzo = lungo / 2, pos = p => p.r + mezzo * p.t;
  picchi.sort((p, q) => q.voti - p.voti);
  const tenute = [];
  for (const p of picchi) if (tenute.every(q => Math.abs(pos(q) - pos(p)) > 6)) tenute.push(p);
  return tenute.map(p => ({ ...p, pos: pos(p) }));
}

// la retta ritoccata coi minimi quadrati sui pixel di cresta entro 2 px
function ritocca(maschera, w, h, l, verticale, da, a) {
  let n = 0, sa = 0, sb = 0, saa = 0, sab = 0;
  for (let p = Math.max(0, Math.floor(da)); p < Math.min(verticale ? h : w, Math.ceil(a)); p++) {
    const c = l.r + p * l.t;
    for (let q = Math.round(c) - 2; q <= Math.round(c) + 2; q++) {
      const [x, y] = verticale ? [q, p] : [p, q];
      if (x < 0 || y < 0 || x >= w || y >= h || !maschera[y * w + x]) continue;
      n++; sa += p; sb += q; saa += p * p; sab += p * q;
    }
  }
  const den = n * saa - sa * sa;
  if (n < 20 || !den) return l;
  const t = (n * sab - sa * sb) / den;
  return { ...l, t, r: (sb - t * sa) / n };
}

const incrocio = (o, v) => { // o: y = ro + x·to ; v: x = rv + y·tv
  const y = (o.r + v.r * o.t) / (1 - o.t * v.t);
  return [v.r + y * v.t, y];
};

// I quattro angoli della tabella (alto-sinistra, alto-destra, basso-destra, basso-sinistra) in coordinate di `img`, o null.
export function trovaTabella(img, traccia = null) {
  // circa un milione di pixel (uno screenshot alto e stretto non perde la tabella), con 12 px di bianco intorno: un bordo
  // della tabella proprio sul margine dello screenshot resta una linea
  const q = rimpicciolisci(img, Math.max(img.w, img.h) / Math.max(1, Math.sqrt((img.w * img.h) / 9e5))), f = img.w / q.w, B = 12;
  const p = { w: q.w + 2 * B, h: q.h + 2 * B, g: new Uint8ClampedArray((q.w + 2 * B) * (q.h + 2 * B)).fill(255) };
  for (let y = 0; y < q.h; y++) p.g.set(q.g.subarray(y * q.w, (y + 1) * q.w), (y + B) * p.w + B);
  const { oriz, vert } = creste(p, 2, 18);
  const tutte = linee(oriz, p.w, p.h, false);
  if (tutte.length < 2) return null;
  const t0 = tutte[0].t; // le righe della tabella: quasi parallele alla più forte
  const o = tutte.filter(l => Math.abs(Math.atan(l.t) - Math.atan(t0)) < (12 * Math.PI) / 180).sort((a, b) => a.pos - b.pos);
  let [alto, basso] = [o[0], o.at(-1)];
  if (o.length < 3 || basso.pos - alto.pos < p.h * 0.04) return null;
  // le colonne: solo i pixel fra il bordo alto e quello basso (il tavolo e la pagina intorno non votano)
  const dentro = (x, y) => y > alto.r + x * alto.t - 2 && y < basso.r + x * basso.t + 2;
  const vv = linee(vert, p.w, p.h, true, dentro);
  const tv = vv[0]?.t;
  const v = vv.filter(l => Math.abs(Math.atan(l.t) - Math.atan(tv)) < (15 * Math.PI) / 180).sort((a, b) => a.pos - b.pos);
  if (traccia) Object.assign(traccia, { o: o.map(l => [Math.round(l.pos), l.voti]), v: v.map(l => [Math.round(l.pos), l.voti]), vv: vv.map(l => [Math.round(l.pos), l.voti, +(Math.atan(l.t) * 57.3).toFixed(1)]), w: p.w, h: p.h });
  if (v.length < 3) return null;
  let [sx, dx] = [v[0], v.at(-1)];
  // ritocco: ogni bordo sui suoi pixel, fra gli altri due bordi
  const ys = l => [incrocio(alto, l)[1], incrocio(basso, l)[1]].sort((a, b) => a - b);
  const xs = l => [incrocio(l, sx)[0], incrocio(l, dx)[0]].sort((a, b) => a - b);
  alto = ritocca(oriz, p.w, p.h, alto, false, ...xs(alto)); basso = ritocca(oriz, p.w, p.h, basso, false, ...xs(basso));
  sx = ritocca(vert, p.w, p.h, sx, true, ...ys(sx)); dx = ritocca(vert, p.w, p.h, dx, true, ...ys(dx));
  const angoli = [incrocio(alto, sx), incrocio(alto, dx), incrocio(basso, dx), incrocio(basso, sx)].map(([x, y]) => [(x - B) * f, (y - B) * f]);
  if (angoli.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return null;
  return angoli;
}

// omografia (8 numeri) che porta i punti `da` nei punti `a` (4 coppie)
function omografia(da, a) {
  const A = [], b = [];
  da.forEach(([x, y], k) => {
    const [u, v] = a[k];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  });
  for (let c = 0; c < 8; c++) { // Gauss col pivot
    let m = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[m][c])) m = r;
    [A[c], A[m]] = [A[m], A[c]]; [b[c], b[m]] = [b[m], b[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const k = A[r][c] / A[c][c];
      for (let j = c; j < 8; j++) A[r][j] -= k * A[c][j];
      b[r] -= k * b[c];
    }
  }
  return b.map((v, k) => v / A[k][k]);
}

const dist = ([a, b], [c, d]) => Math.hypot(a - c, b - d);

// La tabella raddrizzata, larga `larg` px più il margine `m` intorno; fuori dalla foto è bianco.
export function raddrizza(img, angoli, larg = 2000, m = 16, fuori = 255) {
  const [tl, tr, br, bl] = angoli;
  const alt = Math.round(larg * (dist(tl, bl) + dist(tr, br)) / (dist(tl, tr) + dist(bl, br)));
  const W = larg + 2 * m, H = alt + 2 * m;
  const T = omografia([[m, m], [m + larg, m], [m + larg, m + alt], [m, m + alt]], angoli);
  const g = new Uint8ClampedArray(W * H).fill(fuori);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = T[6] * x + T[7] * y + 1, sx = (T[0] * x + T[1] * y + T[2]) / d, sy = (T[3] * x + T[4] * y + T[5]) / d;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= img.w || y0 + 1 >= img.h) continue;
      const fx = sx - x0, fy = sy - y0, i = y0 * img.w + x0, s = img.g;
      g[y * W + x] = (s[i] * (1 - fx) + s[i + 1] * fx) * (1 - fy) + (s[i + img.w] * (1 - fx) + s[i + img.w + 1] * fx) * fy;
    }
  }
  return { g, w: W, h: H, m };
}

// massimo (o media) su una finestra quadrata, separabile
function filtro({ g, w, h }, r, massimo) {
  const passa = (src, lungo, corto, idx) => {
    const out = new Float32Array(src.length);
    for (let c = 0; c < corto; c++) {
      for (let l = 0; l < lungo; l++) {
        let v = massimo ? 0 : 0, n = 0;
        for (let k = Math.max(0, l - r); k <= Math.min(lungo - 1, l + r); k++) {
          const s = src[idx(c, k)];
          if (massimo) { if (s > v) v = s; } else { v += s; n++; }
        }
        out[idx(c, l)] = massimo ? v : v / n;
      }
    }
    return out;
  };
  const a = passa(g, w, h, (c, l) => c * w + l);
  return passa(a, h, w, (c, l) => l * w + c);
}

// via la luce non uniforme e le ombre: ogni pixel diviso per il «bianco della carta» intorno a lui
// (lo sfondo cambia piano: lo si stima a un quarto della risoluzione e lo si riporta su, interpolato)
export function normalizza(img) {
  const p = rimpicciolisci(img, Math.max(img.w, img.h) / 4), fx = p.w / img.w, fy = p.h / img.h;
  const mx = filtro(p, Math.max(2, Math.round(p.w / 250)), true);
  const bg = filtro({ g: mx, w: p.w, h: p.h }, Math.max(4, Math.round(p.w / 80)), false);
  const g = new Uint8ClampedArray(img.g.length);
  for (let y = 0; y < img.h; y++) {
    const sy = Math.min(p.h - 1.001, Math.max(0, (y + 0.5) * fy - 0.5)), y0 = Math.floor(sy), dy = sy - y0;
    for (let x = 0; x < img.w; x++) {
      const sx = Math.min(p.w - 1.001, Math.max(0, (x + 0.5) * fx - 0.5)), x0 = Math.floor(sx), dx = sx - x0, i = y0 * p.w + x0;
      const b = (bg[i] * (1 - dx) + bg[i + 1] * dx) * (1 - dy) + (bg[i + p.w] * (1 - dx) + bg[i + p.w + 1] * dx) * dy;
      g[y * img.w + x] = b > 0 ? (255 * img.g[y * img.w + x]) / b : 255;
    }
  }
  // e il contrasto: l'inchiostro più scuro (1° percentile) diventa nero, il grigio chiaro (aloni, grana, sfocatura) bianco
  const ist = new Uint32Array(256);
  for (const v of g) ist[v]++;
  let lo = 0;
  for (let n = 0; lo < 255 && (n += ist[lo]) < g.length * 0.01; lo++);
  const hi = 215;
  if (lo < hi - 40) for (let i = 0; i < g.length; i++) g[i] = ((g[i] - lo) * 255) / (hi - lo);
  return { ...img, g };
}

// le linee interne della tabella raddrizzata: centri (px) delle verticali e delle orizzontali, e lo spessore
export function griglia(img) {
  const d = Math.max(3, Math.round(img.w / 400));
  const { oriz, vert } = creste(img, d, 40);
  const prof = (maschera, lungo, corto, idx) => {
    const p = new Float32Array(corto);
    for (let c = 0; c < corto; c++) for (let l = 0; l < lungo; l++) p[c] += maschera[idx(c, l)];
    return p;
  };
  const picchi = (p, quanto) => {
    const out = [];
    for (let c = 0; c < p.length;) {
      if (p[c] < quanto) { c++; continue; }
      let s = 0, sc = 0, fine = c;
      while (fine < p.length && p[fine] >= quanto * 0.5) { s += p[fine]; sc += p[fine] * fine; fine++; }
      out.push({ c: sc / s, mezzo: (fine - c) / 2 });
      c = fine;
    }
    return out.filter((q, k) => !k || q.c - out[k - 1].c > 6);
  };
  const ph = prof(oriz, img.w, img.h, (c, l) => c * img.w + l), pv = prof(vert, img.h, img.w, (c, l) => l * img.w + c);
  const H = picchi(ph, (img.w - 2 * img.m) * 0.4), V = picchi(pv, (img.h - 2 * img.m) * 0.4);
  // dove la linea c'è davvero: lato per lato della cella (le verticali non attraversano la riga del tecnico), con una
  // maschera più tenera per le linee sfocate. Un lato è linea se è coperto almeno a metà.
  const tenera = creste(img, d, 20);
  const tratti = (maschera, l, altre, idx) => {
    const t = Math.ceil(l.mezzo) + 2, out = [];
    for (let j = 0; j + 1 < altre.length; j++) {
      const da = Math.round(altre[j].c), a = Math.round(altre[j + 1].c);
      // il tratto coperto più lungo (buchi fino a 3 px), lontano dagli incroci: una lettera che tocca la linea non basta
      let run = 0, lungo = 0, buco = 0;
      for (let p = da + t; p <= a - t; p++) {
        let c = false;
        for (let q = Math.round(l.c) - t; q <= Math.round(l.c) + t && !c; q++) c = !!maschera[idx(q, p)];
        if (c) { run += buco + 1; buco = 0; } else if (++buco > 3) { run = 0; buco = 0; }
        lungo = Math.max(lungo, run);
      }
      if (lungo >= (a - da - 2 * t) * 0.8) out.push([da, a]);
    }
    return out;
  };
  const dentro = (x, y) => (x < 0 || y < 0 || x >= img.w || y >= img.h ? -1 : y * img.w + x);
  return {
    h: H.map(l => ({ ...l, tratti: tratti(tenera.oriz, l, V, (q, p) => dentro(p, q)) })),
    v: V.map(l => ({ ...l, tratti: tratti(tenera.vert, l, H, (q, p) => dentro(q, p)) })),
  };
}

// le linee si cancellano prima dell'OCR (altrimenti diventano «|», «_» e lettere inventate), solo dove ci sono davvero
export function senzaLinee(img, gr) {
  const g = img.g.slice();
  for (const [dir, ls] of [['h', gr.h], ['v', gr.v]]) {
    for (const l of ls) {
      const t = Math.min(5, Math.ceil(l.mezzo) + 1); // stretta: la prima lettera della cella sta a 2 punti dalla linea
      for (const [da, a] of l.tratti) {
        for (let p = da - t; p <= a + t; p++) {
          for (let q = Math.round(l.c) - t; q <= Math.round(l.c) + t; q++) {
            const [x, y] = dir === 'h' ? [p, q] : [q, p];
            if (x >= 0 && y >= 0 && x < img.w && y < img.h) g[y * img.w + x] = 255;
          }
        }
      }
    }
  }
  return { ...img, g };
}

// in PGM (P5): lo legge Tesseract (Leptonica) sia nel telefono sia nelle prove in Node, senza canvas
export function aPgm({ g, w, h }) {
  const testa = new TextEncoder().encode(`P5\n${w} ${h}\n255\n`);
  const out = new Uint8Array(testa.length + g.length);
  out.set(testa); out.set(g, testa.length);
  return out;
}

// quanta parte del riquadro è inchiostro (dopo aver tolto le linee): una cella vuota resta vuota anche per l'OCR
export function inchiostro(img, r) {
  if (!img.g || r.width <= 0 || r.height <= 0) return 0;
  let n = 0;
  for (let y = Math.max(0, r.top); y < Math.min(img.h, r.top + r.height); y++) {
    for (let x = Math.max(0, r.left); x < Math.min(img.w, r.left + r.width); x++) if (img.g[y * img.w + x] < 128) n++;
  }
  return n / (r.width * r.height);
}

// l'inchiostro del riquadro che nessuna parola letta copre (4 px intorno a ogni parola). Con soglia 235 conta anche il grigio:
// un dito, un'ombra netta, una macchia sopra una parte della cella (la parte che resta si legge «bene» ma è troncata)
const SCOPERTO = 0.004, VELATO = 0.02;
export function scoperto(img, r, parole, soglia = 128) {
  if (!img.g || r.width <= 0 || r.height <= 0) return 0;
  const qui = parole.filter(p => p.x1 > r.left && p.x0 < r.left + r.width && p.y1 > r.top && p.y0 < r.top + r.height);
  let n = 0;
  for (let y = Math.max(0, r.top); y < Math.min(img.h, r.top + r.height); y++) {
    for (let x = Math.max(0, r.left); x < Math.min(img.w, r.left + r.width); x++) {
      if (img.g[y * img.w + x] < soglia && !qui.some(p => x >= p.x0 - 4 && x <= p.x1 + 4 && y >= p.y0 - 4 && y <= p.y1 + 4)) n++;
    }
  }
  return n / (r.width * r.height);
}

// ---------- dalle parole al foglio ----------
export function distanza(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prec = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prec + (a[i - 1] === b[j - 1] ? 0 : 1));
      prec = t;
    }
  }
  return d[b.length];
}
// la voce più vicina di `elenco`, se è vicina abbastanza e non c'è un'altra quasi uguale
export function piuVicino(s, elenco, tolleranza = n => Math.max(1, Math.floor(n / 4))) {
  let best = null, d1 = Infinity, d2 = Infinity;
  for (const e of elenco) {
    const d = distanza(s, e);
    if (d < d1) { d2 = d1; d1 = d; best = e; } else if (d < d2) d2 = d;
  }
  return best !== null && d1 <= tolleranza(s.length) && d2 > d1 ? { voce: best, d: d1 } : null;
}

// negli orari una O è uno zero e una l è un uno
export function correggiOrario(s) {
  const t = s.replace(/[Oo°DQ]/g, '0').replace(/[Il|!iL]/g, '1').replace(/[Ss]/g, '5').replace(/B/g, '8').replace(/[Zz]/g, '2')
    .replace(/[,;]/g, '.').replace(/[–—~_]/g, '-').replace(/\s*-\s*/g, '-').replace(/\s+/g, '').replace(/^[^\d]+|[^\d]+$/g, '');
  return t;
}
// L'orario letto: corretto nei caratteri; un trattino letto come punto (11.11.30) e un punto perso (1130) si rimettono, ma solo
// se resta UNA lettura che è un orario (e la fine viene dopo l'inizio). Sennò null: meglio vuoto che sbagliato.
export function orarioDaOcr(s) {
  const t = correggiOrario(s);
  // un orario di lavoro (dalle 6 alle 22); con il trattino serve anche la fine, dopo l'inizio
  const ok = o => !!o.da && o.da >= '06:00' && o.da <= '22:00' && (o.testo.includes('-') ? !!o.a && o.a > o.da : true);
  if (ok(leggiOrario(t))) return leggiOrario(t);
  const prove = [t.replace(/(^|-)(\d{1,2})(\d{2})(?=-|$)/g, '$1$2.$3')];
  const m = t.match(/^(\d{1,2})[.:](\d{1,2})[.:](\d{1,2})$/);
  if (m) prove.push(`${m[1]}-${m[2]}.${m[3]}`, `${m[1]}.${m[2]}-${m[3]}`);
  const una = l => { const v = [...new Set(l)].map(leggiOrario).filter(ok); return new Set(v.map(o => `${o.da}-${o.a}`)).size === 1 ? v[0] : null; };
  const leggera = una(prove);
  if (leggera) return leggera;
  // senza punteggiatura (foto sfocata: «12 12 30», «111130», «8309»): si provano le divisioni in ore e minuti, prima ai confini
  // degli spazi letti, poi su tutte le cifre. Vale se ne resta una sola, ed è comunque da far guardare (ricostruito).
  const pezzi = s.replace(/[Oo°DQ]/g, '0').replace(/[Il|!iL]/g, '1').split(/[^\d]+/).filter(Boolean);
  const ai = { 2: p => [`${p[0]}.${p[1]}`, `${p[0]}-${p[1]}`], 3: p => [`${p[0]}-${p[1]}.${p[2]}`, `${p[0]}.${p[1]}-${p[2]}`], 4: p => [`${p[0]}.${p[1]}-${p[2]}.${p[3]}`] };
  const cifre = d => [1, 2].flatMap(h1 => [0, 2].flatMap(m1 => {
    const primo = m1 ? `${d.slice(0, h1)}.${d.slice(h1, h1 + m1)}` : d.slice(0, h1), resto = d.slice(h1 + m1);
    if (h1 + m1 > d.length) return [];
    if (!resto) return [primo];
    return [1, 2].flatMap(h2 => [0, 2].filter(m2 => h2 + m2 === resto.length).map(m2 => `${primo}-${m2 ? `${resto.slice(0, h2)}.${resto.slice(h2)}` : resto}`));
  }));
  const r = (ai[pezzi.length] && una(ai[pezzi.length](pezzi))) || una(cifre(pezzi.join('')));
  return r && { ...r, ricostruito: true };
}

const PAROLE_TESTA = ['TECNICO', 'DATA', ...GIORNI, ...MESI];
function correggiTesta(s) {
  const n = norm(s).replace(/[^A-Z0-9]+$/, '');
  if (/\d/.test(n) && /^\d+$/.test(correggiOrario(n))) return correggiOrario(n);
  const v = n.length > 2 ? piuVicino(n, PAROLE_TESTA, k => (k <= 4 ? 1 : 2)) : null;
  return v ? (v.voce === 'TECNICO' || v.voce === 'DATA' ? `${v.voce}:` : v.voce) : s;
}
const CHIAVI_NOTE = ['NON', 'PRIMA', 'DOPO', 'SOLO', 'PUNTUALE', 'CHIAMALO', 'CHIAMARE', 'CHIAMA', 'DELLE', 'ARRIVA', 'APPOSTA'];
// le tipologie si confrontano su lettere e cifre: «FASTWEB 3,5» e «INS. KOLME» sono «FASTWEB 3.5» e «INS.KOLME»
const scheletro = s => norm(s).replace(/[^A-Z0-9]/g, '');

/**
 * Le parole dell'OCR (px della tabella raddrizzata, { s, x0, y0, x1, y1, conf }) e la griglia → lo stesso foglio del PDF,
 * più `incerti`: [n, campo] dei campi da far guardare a Riccardo. `comuni` = chiavi valide (comuni.json).
 */
export function foglioDaParole(parole, gr, dim, { oggi = new Date(), comuni = [], tipologie = [], traccia = null } = {}) {
  const V = gr.v.map(l => l.c).sort((a, b) => a - b), Hh = gr.h.map(l => l.c).sort((a, b) => a - b);
  if (V.length < 3 || Hh.length < 3) return { errore: 'bordi' };
  const k = 630 / (V.at(-1) - V[0]); // in punti, come il PDF: le tolleranze di leggiFoglio restano quelle
  const X = x => x * k, Y = y => (dim.h - y) * k;
  const centro = p => [(p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2];
  const cella = p => {
    const [cx, cy] = centro(p);
    return [Hh.findIndex((y, i) => i + 1 < Hh.length && cy > y && cy < Hh[i + 1]), V.findIndex((x, j) => j + 1 < V.length && cx > x && cx < V[j + 1])];
  };
  // la riga delle intestazioni: quella con più celle che somigliano ai nomi delle colonne
  const nomi = Object.values(COLONNE);
  let testa = null;
  for (let r = 0; r + 1 < Hh.length; r++) {
    const celle = V.slice(0, -1).map((_, c) => parole.filter(p => { const [rr, cc] = cella(p); return rr === r && cc === c; })
      .sort((a, b) => a.x0 - b.x0).map(p => norm(p.s)).join(' '));
    const trovati = celle.map(s => (s ? piuVicino(s, nomi, n => Math.max(1, Math.floor(n / 3)))?.voce ?? null : null));
    const n = trovati.filter(Boolean).length;
    if (n >= 4 && (!testa || n > testa.n)) testa = { r, trovati, n };
  }
  if (!testa) return { errore: 'colonne' };
  // otto colonne, ognuna una volta: una piega scura o un secondo foglio aggiungono colonne (critico, 29/10: prima era un TypeError)
  const lette = testa.trovati.filter(Boolean);
  if (testa.trovati.length !== nomi.length || new Set(lette).size !== lette.length) return { errore: 'colonne' };
  // le colonne che l'OCR non ha letto si deducono dall'ordine del foglio, se quelle lette sono al loro posto
  if (testa.n < nomi.length) {
    const alPosto = testa.trovati.length === nomi.length && testa.trovati.every((t, c) => !t || t === nomi[c]);
    if (!alPosto) return { errore: 'colonne' };
    testa.trovati = nomi.slice();
  }
  const yTesta = Y((Hh[testa.r] + Hh[testa.r + 1]) / 2);
  const testi = testa.trovati.map((s, c) => ({ s, x: X(V[c]) + 1, y: yTesta, w: X(V[c + 1]) - X(V[c]) - 2 }));
  for (const p of parole) {
    const [r] = cella(p);
    if (r === testa.r) continue;
    const [cx, cy] = centro(p);
    testi.push({ s: r < testa.r ? correggiTesta(p.s) : p.s, x: X(p.x0), y: Y(cy), w: X(p.x1) - X(p.x0), conf: p.conf, cx: X(cx) });
  }
  const linea = c => ({ a: c * k - 0.4, b: c * k + 0.4 });
  const geom = { pagine: 1, testi, v: V.map(linea), h: Hh.map(y => linea(dim.h - y)).reverse() }; // h dal basso, come nel PDF
  const foglio = leggiFoglio(geom, oggi);
  if (foglio.errore) return foglio;

  // i campi letti male: meglio vuoto (e segnato) che sbagliato
  const colonna = {};
  testa.trovati.forEach((s, c) => { const chiave = Object.keys(COLONNE).find(q => COLONNE[q] === s); colonna[chiave] = { x0: X(V[c]), x1: X(V[c + 1]) }; });
  const fiducia = (riga, campo) => {
    const dentro = testi.filter(t => t.conf != null && t.y > riga.y0 && t.y < riga.y1 && t.x >= colonna[campo].x0 - 1 && t.x < colonna[campo].x1);
    return dentro.length ? Math.min(...dentro.map(t => t.conf)) : 100;
  };
  const incerti = [], rileggi = [], fiducie = {};
  const POCA = 75;
  // il riquadro (px) di una cella, per rileggerla da sola
  const riquadro = (riga, campo) => {
    const c = testa.trovati.indexOf(COLONNE[campo]), t = 4;
    const top = dim.h - riga.y1 / k, bottom = dim.h - riga.y0 / k;
    return { left: Math.round(V[c] + t), top: Math.round(top + t), width: Math.round(V[c + 1] - V[c] - 2 * t), height: Math.round(bottom - top - 2 * t) };
  };
  for (const i of foglio.interventi) {
    const segna = campo => incerti.push([i.n, campo]);
    fiducie[i.n] = Object.fromEntries(['cliente', 'tipologia', 'comune', 'orario', 'note'].map(q => [q, Math.round(fiducia(i.celle.riga, q))]));
    if (traccia) traccia.push({ n: i.n, orario: i.orario.testo, tipologia: i.tipologia, comune: i.comune });
    // comune: la voce valida più vicina; se non ce n'è una sola vicina resta vuoto
    const c = norm(i.comune).replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
    const fc = fiducia(i.celle.riga, 'comune');
    if (!comuni.includes(c)) {
      // (sotto le 5 lettere niente correzione: un nome troncato da un dito diventava un altro comune di 3 lettere)
      const v = c.length >= 5 ? piuVicino(c, comuni, n => Math.max(1, Math.round(n / 4))) : null;
      if (v) { i.comune = v.voce; if (v.d > 1 || fc < 90) segna('comune'); } else { if (i.comune) segna('comune'); i.comune = ''; }
    } else { i.comune = c; if (fc < POCA) segna('comune'); }
    // orario: corretto nei caratteri, poi deve avere la forma di un orario
    const o = orarioDaOcr(i.orario.testo);
    if (!o) { if (i.orario.testo) segna('orario'); i.orario = { testo: '', da: null, a: null }; } else {
      const { ricostruito, ...letto } = o;
      i.orario = letto;
      // da guardare anche: un'ora sola senza minuti («16» da «16.15» con un dito sopra) e minuti che non sono di 5 in 5
      // (un puntino di penna: «10.00» letto 10:08)
      const strano = !letto.testo.includes('-') && !/[.:]/.test(letto.testo) || [letto.da, letto.a].some(t => t && +t.slice(3) % 5);
      if (ricostruito || strano || fiducia(i.celle.riga, 'orario') < POCA) segna('orario');
    }
    // da rileggere da sole: comune e orario vuoti o incerti, e ogni cella che ha inchiostro ma è rimasta senza parole
    // e ogni cella con inchiostro che nessuna parola copre (una riga di nota saltata dall'OCR): riletta, e se resta scoperta, segnata
    for (const campo of ['cliente', 'tipologia', 'comune', 'orario', 'note']) {
      const vuota = campo === 'orario' ? !i.orario.da : !i[campo], rett = riquadro(i.celle.riga, campo), sc = scoperto(dim, rett, parole);
      const ve = scoperto(dim, rett, parole, 235);
      fiducie[i.n][`scoperto_${campo}`] = +sc.toFixed(4);
      fiducie[i.n][`velato_${campo}`] = +ve.toFixed(4);
      if ((sc > SCOPERTO || ve > VELATO) && !incerti.some(([n, q]) => n === i.n && q === campo)) segna(campo);
      if ((vuota && inchiostro(dim, rett) > 0.002) || sc > SCOPERTO || (['comune', 'orario'].includes(campo) && incerti.some(([n, q]) => n === i.n && q === campo))) rileggi.push({ n: i.n, campo, rett });
    }
    // tipologia: una di quelle già viste su questo telefono, se lettere e cifre coincidono (cambia solo la punteggiatura).
    // Con una lettera diversa no: «FASTWEB 3.0» non diventa «FASTWEB 3.5» (critico, 29/10); resta com'è letta e si segna.
    const nota = tipologie.find(t => scheletro(t) === scheletro(i.tipologia));
    if (nota) i.tipologia = nota;
    else if (tipologie.length && i.tipologia) segna('tipologia');
    // (il nome si segna già sotto 93: nelle prove i nomi sbagliati avevano fino a 92)
    for (const campo of ['cliente', 'tipologia', 'note']) if (i[campo] && !(campo === 'tipologia' && nota) && fiducia(i.celle.riga, campo) < (campo === 'cliente' ? 93 : POCA)) segna(campo);
    // cliente, tipologia, comune e orario ci sono sempre sul foglio: se restano vuoti, Riccardo deve vederlo
    for (const campo of ['cliente', 'tipologia', 'comune', 'orario']) if ((campo === 'orario' ? !i.orario.da : !i[campo]) && !incerti.some(([n, q]) => n === i.n && q === campo)) segna(campo);
    // note: una parola a una o due lettere da quelle dei vincoli («MON PRIMA», «CMIAMALO», «DUPU LE 14») cambia cosa fa Riccardo
    if (i.note && !incerti.some(([n, q]) => n === i.n && q === 'note') && norm(i.note).split(/[^A-Z]+/).some(w => w.length >= 3 && !CHIAVI_NOTE.includes(w)
      && CHIAVI_NOTE.some(c => distanza(w, c) <= (c.length >= 6 || (c.length >= 4 && w[0] === c[0]) ? 2 : 1)))) segna('note');
    i.vincoli = leggiVincoli(i.note, i.orario);
    i.compilato = { esito: '', motivoKo: '', euroExtra: '' }; // la scrittura a mano non si legge: meglio vuoto
    i.id = norm(`${i.cliente}|${i.tipologia}|${i.comune}`);
  }
  // una riga senza due fra tipologia, comune e orario è una riga spezzata (una piega, una linea storta): si fa guardare tutta, e
  // con lei nome e note delle righe accanto, dove può essere finito il pezzo che manca (critico, 29/10: «PUNTUALE» perso)
  foglio.interventi.forEach((i, k) => {
    if ([i.tipologia, i.comune, i.orario.da].filter(Boolean).length > 1) return;
    for (const campo of ['cliente', 'tipologia', 'comune', 'orario', 'note']) incerti.push([i.n, campo]);
    for (const j of [foglio.interventi[k - 1], foglio.interventi[k + 1]]) if (j) incerti.push([j.n, 'cliente'], [j.n, 'note']);
  });
  // il foglio va per orario: quello che è fuori ordine rispetto a più di metà degli altri si fa guardare («10.00» letto 20:00)
  const con = foglio.interventi.filter(i => i.orario.da);
  for (const i of con) {
    const fuori = con.filter(j => j !== i && (j.n < i.n ? j.orario.da > i.orario.da : j.orario.da < i.orario.da)).length;
    if (fuori && fuori >= (con.length - 1) / 2 && !incerti.some(([n, q]) => n === i.n && q === 'orario')) incerti.push([i.n, 'orario']);
  }
  return { ...foglio, incerti, rileggi, fiducie, scala: k };
}

const dentro = (p, r) => { const cx = (p.x0 + p.x1) / 2, cy = (p.y0 + p.y1) / 2; return cx > r.left && cx < r.left + r.width && cy > r.top && cy < r.top + r.height; };
const AMMESSI = { orario: '0123456789.,:-', comune: "ABCDEFGHIJKLMNOPQRSTUVWXYZ' " };

/**
 * Dalla foto (grigi) al foglio. `ocr(pgm, { psm, rettangolo, ammessi })` → parole; è Tesseract nel telefono e nelle prove.
 * Una prima lettura di tutta la tabella; poi comune e orario rimasti vuoti o incerti si rileggono cella per cella
 * (una riga sola, solo i caratteri possibili).
 */
export async function leggiTabella(img, ocr, opzioni = {}) {
  const angoli = trovaTabella(img);
  if (!angoli) return { errore: 'tabella' };
  // sotto i 520 px di larghezza le lettere della tabella sono alte 6 px: si leggono numeri sbagliati (screenshot da 640, provato)
  const [tl, tr, br, bl] = angoli;
  if ((Math.hypot(tr[0] - tl[0], tr[1] - tl[1]) + Math.hypot(br[0] - bl[0], br[1] - bl[1])) / 2 < 520) return { errore: 'piccola', angoli };
  const base = normalizza(raddrizza(img, angoli));
  // la stessa tabella con 60 px in più intorno: serve a vedere se sotto l'ultima linea la tabella continua
  const largo = raddrizza(img, angoli, 2000, 16 + INTORNO, 0); // fuori dalla foto è nero: non sembra carta
  // il verso: la tabella è più larga che alta. Se esce alta la si gira di un quarto; se le colonne non si trovano, di mezzo giro
  let out;
  for (const quarti of base.h > base.w ? [1, 3] : [0, 2]) {
    out = await leggiDritta(ruota(base, quarti), ocr, opzioni, ruota(largo, quarti));
    if (out.foglio.errore !== 'colonne') break;
  }
  return { ...out, angoli };
}

// Le linee verticali della tabella continuano sotto l'ultima linea orizzontale trovata? Allora il fondo della tabella è fuori
// dalla foto o coperto (la tastiera sopra uno screenshot, la foto tagliata): le righe di sotto mancherebbero in silenzio.
// Si guarda una striscia di 14 px subito sotto, linea per linea, solo per le linee che dentro la tabella si vedono bene.
const INTORNO = 60;
export function continuaSotto(G, gr, extra = INTORNO) {
  const fondo = Math.round(Math.max(...gr.h.map(l => l.c)) + extra);
  const linee = gr.v.map(l => Math.round(l.c + extra)).sort((a, b) => a - b).slice(1, -1); // le interne: i bordi possono toccare altro
  const tratto = (x, da) => {
    let n = 0;
    for (let y = da; y < da + 14; y++) {
      let c = false;
      for (let xx = x - 3; xx <= x + 3 && !c; xx++) {
        const i = y * G.w + xx;
        if (y > 0 && y < G.h && xx > 3 && xx < G.w - 3 && Math.min(G.g[i - 3], G.g[i + 3]) - G.g[i] > 12) c = true;
      }
      if (c) n++;
    }
    return n >= 10;
  };
  const visibili = linee.filter(x => tratto(x, fondo - 26));
  if (visibili.length >= 2 && visibili.filter(x => tratto(x, fondo + 6)).length >= visibili.length / 2) return true;
  // e sotto il bordo ci deve essere carta, chiara come quella dell'ultima riga: se c'è la tastiera, o la foto finisce proprio sulla
  // linea, le righe di sotto potrebbero mancare senza che niente lo dica (critico, 29/10). Si confrontano le mediane.
  const xs = gr.v.map(l => l.c), x0 = Math.round(Math.min(...xs) + extra), x1 = Math.round(Math.max(...xs) + extra);
  const mediana = (y0, y1) => {
    const v = [];
    for (let y = Math.max(0, y0); y < Math.min(G.h, y1); y++) for (let x = x0 + 8; x < x1 - 8; x += 2) v.push(G.g[y * G.w + x]);
    return v.sort((a, b) => a - b)[v.length >> 1] ?? 0;
  };
  return mediana(fondo + 6, fondo + 20) < 0.9 * mediana(fondo - 30, fondo - 8); // la tastiera chiara di iOS è all'82%
}

async function leggiDritta(r, ocr, opzioni, largo) {
  const gr = griglia(r);
  if (largo && gr.h.length >= 3 && gr.v.length >= 3 && continuaSotto(largo, gr)) return { foglio: { errore: 'tagliata' }, immagine: r, foglioImg: r };
  const pulita = senzaLinee(r, gr), pgm = aPgm(pulita);
  let parole = await ocr(pgm, { psm: '6' }); // un blocco uniforme: sulle foto sfocate legge più celle del «testo sparso» (11), misurato
  let foglio = foglioDaParole(parole, gr, pulita, opzioni);
  if (!foglio.errore && foglio.rileggi.length) {
    for (const c of foglio.rileggi) {
      const nuove = await ocr(pgm, { psm: c.campo === 'note' || c.campo === 'cliente' ? '6' : '7', rettangolo: c.rett, ammessi: AMMESSI[c.campo] ?? '' });
      const testo = nuove.map(p => p.s).join(' ');
      // la seconda lettura vale solo se dà un valore possibile: un orario, un comune dell'elenco, del testo
      const valida = c.campo === 'orario' ? !!orarioDaOcr(testo)
        : c.campo === 'comune' ? !!piuVicino(norm(testo).replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim(), opzioni.comuni ?? [], n => Math.max(1, Math.round(n / 4)))
          : /[A-Za-z0-9]{2}/.test(testo);
      // e se copre almeno tanto inchiostro quanto la prima lettura
      const resto = parole.filter(p => !dentro(p, c.rett));
      if (valida && scoperto(pulita, c.rett, nuove) <= scoperto(pulita, c.rett, parole) + 0.0005) parole = resto.concat(nuove);
    }
    const prima = foglio;
    foglio = foglioDaParole(parole, gr, pulita, opzioni);
    if (foglio.errore) foglio = prima;
  }
  return { foglio, immagine: pulita, foglioImg: r };
}

// un quarto di giro alla volta, in senso orario
export function ruota(img, quarti) {
  const q = ((quarti % 4) + 4) % 4;
  if (!q) return img;
  const { g, w, h } = img, [W, H] = q === 2 ? [w, h] : [h, w], out = new Uint8ClampedArray(g.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [xo, yo] = q === 1 ? [y, h - 1 - x] : q === 2 ? [w - 1 - x, h - 1 - y] : [w - 1 - y, x];
      out[y * W + x] = g[yo * w + xo];
    }
  }
  return { ...img, g: out, w: W, h: H };
}

// Un worker di Tesseract.js come `ocr` di leggiTabella (lo stesso nel telefono e nelle prove in Node). `prima` vede ogni richiesta.
export const ocrCon = (worker, prima = () => {}) => async (pgm, opz) => {
  const { psm, rettangolo, ammessi = '' } = opz;
  prima(opz);
  await worker.setParameters({ tessedit_pageseg_mode: psm, tessedit_char_whitelist: ammessi, preserve_interword_spaces: '1' });
  const { data } = await worker.recognize(pgm, rettangolo ? { rectangle: rettangolo } : {}, { blocks: true, text: false });
  return (data.blocks ?? []).flatMap(b => b.paragraphs.flatMap(p => p.lines.flatMap(l => l.words)))
    .map(w => ({ s: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, conf: w.confidence }));
};

// ---------- nel telefono ----------
const VENDOR = new URL('./vendor/tesseract/', import.meta.url).href;

// la foto (JPEG, PNG, HEIC dove il telefono lo apre) in grigio, al massimo 3000 px di lato
async function grigiDaFoto(bytes) {
  const blob = new Blob([bytes]);
  let src;
  try { src = await createImageBitmap(blob); } catch {
    const url = URL.createObjectURL(blob);
    try { src = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; }); } finally { URL.revokeObjectURL(url); }
  }
  const w0 = src.naturalWidth || src.width, h0 = src.naturalHeight || src.height, f = Math.min(1, 3000 / Math.max(w0, h0));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(w0 * f), height: Math.round(h0 * f) });
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, c.width, c.height);
  src.close?.();
  return grigi(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
}

// Il foglio raddrizzato diventa un PDF di una pagina nelle stesse coordinate del foglio letto: così la sera compilaPdf scrive
// esito, motivo ed euro nelle celle giuste, come sul PDF dell'ufficio. In JPEG da 1400 px: resta piccolo nel telefono.
async function pdfDellaFoto(r, scala) {
  const { PDFDocument } = await import('pdf-lib');
  const piena = Object.assign(document.createElement('canvas'), { width: r.w, height: r.h });
  const dati = new ImageData(r.w, r.h);
  for (let i = 0; i < r.g.length; i++) { dati.data[4 * i] = dati.data[4 * i + 1] = dati.data[4 * i + 2] = r.g[i]; dati.data[4 * i + 3] = 255; }
  piena.getContext('2d').putImageData(dati, 0, 0);
  const f = Math.min(1, 1400 / r.w), piccola = Object.assign(document.createElement('canvas'), { width: Math.round(r.w * f), height: Math.round(r.h * f) });
  piccola.getContext('2d').drawImage(piena, 0, 0, piccola.width, piccola.height);
  const jpg = new Uint8Array(await (await new Promise(ok => piccola.toBlob(ok, 'image/jpeg', 0.75))).arrayBuffer());
  const pdf = await PDFDocument.create();
  const pagina = pdf.addPage([r.w * scala, r.h * scala]);
  pagina.drawImage(await pdf.embedJpg(jpg), { x: 0, y: 0, width: r.w * scala, height: r.h * scala });
  return pdf.save();
}

/**
 * Nel telefono: dai byte della foto al foglio, con l'avanzamento (0-100). Il motore si scarica alla prima foto (2,8 MB) e
 * resta in cache (sw.js); finita la lettura il worker si chiude e libera la memoria.
 * → { foglio, pdf } oppure { errore: 'immagine' | 'motore' | 'lettura' | 'tabella' | 'piccola' | 'tagliata' | 'colonne' | 'bordi' | 'vuoto' }
 */
export async function leggiFoto(bytes, { avanzamento = () => {}, comuni = [], tipologie = [], oggi = new Date() } = {}) {
  let img;
  try { img = await grigiDaFoto(bytes); } catch { return { errore: 'immagine' }; }
  avanzamento(2);
  let worker, tappa = 0;
  const TAPPE = [[2, 30], [30, 88], [88, 98]];
  const segna = p => avanzamento(Math.round(TAPPE[tappa][0] + (TAPPE[tappa][1] - TAPPE[tappa][0]) * Math.min(1, Math.max(0, p))));
  try {
    const T = (await import('./vendor/tesseract/tesseract.esm.min.js')).default;
    worker = await T.createWorker('ita', 1, { workerPath: `${VENDOR}worker.min.js`, corePath: VENDOR, langPath: VENDOR, gzip: false,
      cacheMethod: 'none', workerBlobURL: false, // dal suo indirizzo: così anche il worker passa dal service worker (cache, senza rete)
      logger: m => {
        if (tappa === 0) segna(/core/.test(m.status) ? m.progress / 2 : /traineddata/.test(m.status) ? 0.5 + m.progress / 2 : 0.5);
        else if (tappa === 1 && m.status === 'recognizing text') segna(m.progress);
      } });
  } catch { await worker?.terminate().catch(() => {}); return { errore: 'motore' }; }
  try {
    let riletture = 0;
    const ocr = ocrCon(worker, ({ rettangolo }) => { tappa = rettangolo ? 2 : 1; if (rettangolo) segna(Math.min(1, ++riletture / 12)); });
    let o;
    try { o = await leggiTabella(img, ocr, { oggi, comuni, tipologie }); } catch { return { errore: 'lettura' }; } // un guasto qui non è la rete
    if (o.errore) return { errore: o.errore };
    if (o.foglio.errore) return { errore: o.foglio.errore };
    const pdf = await pdfDellaFoto(o.foglioImg, o.foglio.scala);
    avanzamento(100);
    return { foglio: o.foglio, pdf };
  } finally {
    await worker.terminate().catch(() => {});
  }
}
