// La casa di Riccardo, fotografata: un render di Blender (Cycles) diviso per gruppi di luce, che qui si mescolano a ogni giro dei
// LED (luce = base + Σ tratto_i × colore_i). Muro e cartone nel render sono vuoti: la camera li vede bianchi, quindi lì il render è
// la luce che arriva. Sopra, con la stessa camera, la pagina mette ciò che cambia: le sue copertine, la mappa del giro di oggi
// (OpenStreetMap + OSRM, app/plastico/), il percorso a penna e pennarello, la luce dell'insegna. Tutto prende la luce della stanza.
// Si carica solo arrivando su #/casa (import dinamico da app.js) e si chiude del tutto uscendo (niente contesti WebGL che restano).
// Fatto in prototipi/design-v2/B-vera (stanza/costruisci.py, codifica.py, scena.js): qui la casa e la giornata («Il giro di oggi»:
// ci si china sul tavolo e la carta resta davanti, quasi dall'alto, coi cartellini delle tappe).
import * as THREE from './vendor/three.module.min.js';
import { riquadro, tiles as tilesDi, tile, percorso, decodifica, daTile } from './mappa.js';

const STANZA = new URL('./stanza/', import.meta.url).href;
const LATO = 1.0, PIASTRA_Z = 0.35, PIANO = 0.014;
const CARTA = 0.82;              // la carta sotto la mappa non è bianco puro (come in B-vera)
const LENTO_MS = 50;             // sotto i 20 fotogrammi al secondo (mediana dei primi 30 coi LED accesi) i LED si fermano
const PH_G = 1.43;               // la giornata: la carta vista quasi dall'alto (82 gradi)
const COLORI_G = { normale: '#4a3c2c', prossimo: '#2c47c4', fatto: '#b3a790', stretta: '#e0962f' }; // il pennarello della giornata (B-vera)
const LARGO_G = { normale: 3.6, prossimo: 5.5, fatto: 2.6, stretta: 5 };                            // px sullo schermo
const durata = m => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`); // come margini.js
const crea = (tag, classe, ...figli) => { const e = document.createElement(tag); if (classe) e.className = classe; e.append(...figli.filter(x => x != null && x !== false)); return e; };

const LIVELLI = ['landuse', 'water', 'waterway', 'transportation'];
const ABITATO = new Set(['residential', 'suburb', 'neighbourhood', 'quarter', 'industrial', 'commercial', 'retail']);
const STRADE = { motorway: ['#544c41', 4.2], trunk: ['#625a4d', 3.4], primary: ['#7a7062', 2.4], secondary: ['#90877a', 1.7], tertiary: ['#a49b8e', 1.1] }; // colore, px a 2048
const G = Math.PI / 180;
const prendi = async u => { const r = await fetch(u); if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); };

// una copertina: si decodifica; se non riesce si riprova una volta; se non riesce ancora quel poster si salta (mai carta bianca)
async function copertina(url) {
  for (const u of [url, url.startsWith('blob:') ? null : `${url}${url.includes('?') ? '&' : '?'}riprova=1`]) {
    if (!u) break;
    const img = new Image(); img.alt = '';
    if (/^https?:/.test(u) && !u.startsWith(location.origin)) img.referrerPolicy = 'no-referrer'; // come parete.js
    img.src = u;
    try { await img.decode(); if (img.naturalWidth) return img; } catch { /* si riprova, poi si salta */ }
  }
  return null;
}
// un'immagine di un altro sito senza CORS (Comic Vine) sporca la tela: WebGL non la può leggere, va nella pagina in «multiply»
const sporca = img => {
  try { const g = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d'); g.drawImage(img, 0, 0, 1, 1); g.getImageData(0, 0, 1, 1); return false; } catch { return true; }
};
function matrice3d(w, h, q) { // un elemento w×h sui quattro punti q (alto-sx, alto-dx, basso-dx, basso-sx)
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q.map(v => [v.x, v.y]);
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3, dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den, hh = (dx1 * sy - sx * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + hh * x3, d = y1 - y0 + g * y1, e = y3 - y0 + hh * y3;
  return `matrix3d(${a / w},${d / w},0,${g / w},${b / h},${e / h},0,${hh / h},0,0,1,0,${x0},${y0},0,1)`;
}

// il colore della cornice LED (app.css, .cornice-led) in una direzione dello schermo (phi: gradi dall'alto, orario), girata di «angolo»
const STOP = ['#ff2d55', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#0a84ff', '#bf5af2', '#ff2d55'].map(c => new THREE.Color(c));
function coloreLed(angolo, phi = 0) {
  const a = (((phi - angolo) % 360) + 360) % 360 / 360 * (STOP.length - 1), i = Math.floor(a);
  return STOP[i].clone().lerp(STOP[Math.min(i + 1, STOP.length - 1)], a - i);
}

// ---------- la luce della stanza in GLSL (B-vera/scena.js): lastre decodificate, mescolate coi colori; tono = AgX di Blender ----------
const GLSL = /* glsl */`
  uniform sampler2D tB, tT, tR0, tR1, tStri, tIns, tMuro, tCarta, tGrad;
  uniform highp sampler3D tAgx;
  uniform vec3 uC0, uC1, uC2, uIns, uMuro;
  uniform float uBase, uLed, uAlpha, uGrana, uEsp, uNero, uSeme;
  uniform vec4 uLogR;
  uniform mat4 uSlabVP;
  uniform vec2 uStri;
  const float K_ = 0.002;
  vec3 dec3(vec3 e, float r) { return K_ * (exp2(e * r) - 1.0); }
  float dec1(float e, float r) { return K_ * (exp2(e * r) - 1.0); }
  vec2 slabUV(vec4 clip) { return clip.xy / clip.w * 0.5 + 0.5; }
  vec3 luceStanza(vec2 uv) {
    vec3 T = dec3(texture(tT, uv).rgb, uLogR.y);
    float r0 = texture(tR0, uv).r, r1 = texture(tR1, uv).r;
    vec3 s = uBase * dec3(texture(tB, uv).rgb, uLogR.x) + uLed * T * (r0 * uC0 + r1 * uC1 + max(0.0, 1.0 - r0 - r1) * uC2);
    if (uIns.r + uIns.g + uIns.b > 0.0) s += dec3(texture(tIns, uv).rgb, uLogR.w) * uIns;
    return s * uEsp;
  }
  vec3 agx(vec3 c) { vec3 t = clamp((log2(max(c, 1e-10)) + 12.47393) / 16.499999, 0.0, 1.0); return texture(tAgx, t * (32.0 / 33.0) + 0.5 / 33.0).rgb; }
  vec3 grana(vec2 p) { vec3 q = fract(vec3(p.xyx + uSeme * 97.0) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yxz + 33.33); return fract((q.xxy + q.yxx) * q.zyx) - 0.5; }
`;
// il nero di una foto del telefono (mai nero assoluto) e la grana del sensore, più forte nelle ombre
const FINE = /* glsl */`
  gl_FragColor.rgb = uNero + (1.0 - uNero) * gl_FragColor.rgb;
  { vec3 g = grana(gl_FragCoord.xy); gl_FragColor.rgb += mix(vec3(g.x), g, 0.35) * uGrana * (1.6 - 1.2 * dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114))); }
`;
const VS_MONDO = 'uniform mat4 uSlabVP; varying vec2 vUv; varying vec4 vClip; void main() { vUv = uv; vec4 p = modelMatrix * vec4(position, 1.0); vClip = uSlabVP * p; gl_Position = projectionMatrix * viewMatrix * p; }';

// ---------- la casa ----------
// op: contenitore (.casa), insegnaEl (la sua insegna, da mettere sull'insegna del render), comandi (i tasti: la stanza sta sopra o accanto)
//   parete: quello che dà leggiCopertine() (elenco di Blob, o { colore, tessere: [{ url, col, row }] }, o [])
//   colore: '#rrggbb' delle luci, null = arcobaleno (la cornice che gira);  insegna: '#rrggbb', 'arcobaleno' o null (spenta)
//   giro: null, o { tappe: [{ chiave, nome, stato: 'fatto'|'prossimo'|'poi', ora, centro }], tratti: [{ tipo, stretta, minuti }] }
// La tela sta in un suo strato fisso sotto la .casa (che in 3D è trasparente): così, quando l'app ridisegna la casa, la stanza
// vecchia resta visibile finché la nuova non è pronta, e con gli stessi dati si riaggancia ai nuovi tasti senza rifarla (lega).
export async function apriCasa(op) {
  window.__casaCostruite = (window.__casaCostruite ?? 0) + 1; // per le prove: quante stanze si sono costruite
  const fermo = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let { contenitore, insegnaEl, comandi } = op;
  const strato = Object.assign(document.createElement('div'), { className: 'casa-strato' });
  strato.setAttribute('aria-hidden', 'true');
  const tela = document.createElement('canvas');
  const r = new THREE.WebGLRenderer({ canvas: tela, antialias: true, alpha: false, powerPreference: 'high-performance' });
  const libera = [], traccia = x => (libera.push(x), x);
  let vivo = true, idRaf = 0;
  const chiudi = () => {
    if (!vivo) return;
    vivo = false; cancelAnimationFrame(idRaf); ro?.disconnect();
    for (const f of pulizie) f(); // ciò che è nato dentro (ascoltatori, cartellini): non deve sopravvivere alla stanza
    for (const x of libera) x.dispose?.();
    r.dispose(); r.forceContextLoss();
    strato.remove();
    for (const u of urlFoto) URL.revokeObjectURL(u);
    if (window.__casa3d === api) window.__casa3d = null;
  };
  const urlFoto = [], pulizie = [];
  let ro = null, api = null;
  try {
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    const scena = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.05, 40);
    const gCasa = new THREE.Group(), gGiorno = new THREE.Group(); scena.add(gCasa, gGiorno); // la stanza fotografata; la carta del giorno

    // ---------- lastre, camera del render, tabella AgX ----------
    const caricatore = new THREE.TextureLoader();
    const lastra = async (nome, grigio = false) => {
      const t = traccia(await caricatore.loadAsync(STANZA + nome));
      t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = false; t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      if (grigio) { t.format = THREE.RedFormat; t.internalFormat = 'R8'; }
      return t;
    };
    const tabellaAgx = async () => { // la tabella AgX di Blender: 1089x33 px (r + 33 b, g) -> una texture 3D 33x33x33
      const img = new Image(); img.src = `${STANZA}agx.png`; await img.decode();
      const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }), g = c.getContext('2d');
      g.drawImage(img, 0, 0); const px = g.getImageData(0, 0, img.width, img.height).data, N = 33, d = new Uint8Array(N * N * N * 4);
      for (let b = 0; b < N; b++) for (let gg = 0; gg < N; gg++) for (let rr = 0; rr < N; rr++) { const i = ((b * N + gg) * N + rr) * 4, j = (gg * img.width + rr + N * b) * 4; d[i] = px[j]; d[i + 1] = px[j + 1]; d[i + 2] = px[j + 2]; d[i + 3] = 255; }
      const t = traccia(new THREE.Data3DTexture(d, N, N, N)); t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping; t.unpackAlignment = 1; t.needsUpdate = true;
      return t;
    };
    const insegnaAccesa = op.insegna != null;
    const [ST, LJ, tB, tT, tR0, tR1, tStri, tMuro, tCarta, tAgx, tIns] = await Promise.all([
      prendi(`${STANZA}camera.json`), prendi(`${STANZA}lastre.json`),
      lastra('base.webp'), lastra('led.webp'), lastra('led0.webp', true), lastra('led1.webp', true), lastra('striscia.webp', true),
      lastra('muro.webp', true), lastra('carta.webp', true), tabellaAgx(), insegnaAccesa ? lastra('insegna.webp') : null]);
    const [WS, HS] = ST.lastra, MURO = ST.muro, S = MURO.striscia;
    const occhio = new THREE.Vector3(...ST.camera.occhio), guardato = new THREE.Vector3(...ST.camera.guarda);
    const F_PX = HS / 2 / Math.tan(ST.camera.fov_v / 2 * G); // focale in px di lastra
    const camLastra = new THREE.PerspectiveCamera(ST.camera.fov_v, WS / HS, 0.05, 40);
    camLastra.position.copy(occhio); camLastra.lookAt(guardato); camLastra.updateMatrixWorld();
    const U = {
      tB: { value: tB }, tT: { value: tT }, tR0: { value: tR0 }, tR1: { value: tR1 }, tStri: { value: tStri }, tIns: { value: tIns ?? tB }, tMuro: { value: tMuro }, tCarta: { value: tCarta }, tGrad: { value: null }, tAgx: { value: tAgx },
      uC0: { value: new THREE.Color() }, uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uIns: { value: new THREE.Color(0, 0, 0) }, uMuro: { value: new THREE.Color(MURO.colore) },
      uBase: { value: 1 }, uLed: { value: 1 }, uAlpha: { value: 1 }, uGrana: { value: 0.011 }, uEsp: { value: 2 ** (ST.camera.esposizione_stop ?? -1.45) }, uNero: { value: 0.03 }, uSeme: { value: 0 },
      uLogR: { value: new THREE.Vector4() }, uSlabVP: { value: new THREE.Matrix4().multiplyMatrices(camLastra.projectionMatrix, camLastra.matrixWorldInverse) }, uStri: { value: new THREE.Vector2(0, 1) },
    };
    { const V = LJ.codifica.VMAX, rr = v => Math.log2(1 + v / LJ.codifica.K); U.uLogR.value.set(rr(V.base), rr(V.led), rr(V.striscia), rr(V.insegna)); }
    if (/^#[0-9a-f]{6}$/i.test(op.parete?.colore ?? '')) U.uMuro.value.set(op.parete.colore); // la parete composta ha il suo colore
    const slab = v => { const p = v.clone().applyMatrix4(U.uSlabVP.value); return new THREE.Vector2(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5); };
    U.uStri.value.set(slab(new THREE.Vector3(S.x0, S.y, S.z)).x, slab(new THREE.Vector3(S.x1, S.y, S.z)).x);
    const NG = 64, grad = traccia(new THREE.DataTexture(new Uint8Array(NG * 4).fill(255), NG, 1)); // la striscia, punto per punto
    grad.colorSpace = THREE.NoColorSpace; grad.minFilter = grad.magFilter = THREE.LinearFilter; grad.needsUpdate = true; U.tGrad.value = grad;
    const puntiStriscia = Array.from({ length: NG }, (_, i) => new THREE.Vector3(S.x0 + (S.x1 - S.x0) * (i + 0.5) / NG, S.y, S.z));
    const centriLed = [0, 1, 2].map(i => new THREE.Vector3(S.x0 + (S.x1 - S.x0) * (i + 0.5) / 3, S.y, S.z));

    // ---------- il fondo: tutta la lastra lungo il raggio di ogni pixel; oltre il bordo del render, il buio della stanza ----------
    const mFondo = traccia(new THREE.ShaderMaterial({
      uniforms: { ...U, uInvVP: { value: new THREE.Matrix4() }, uOcchio: { value: new THREE.Vector3() } },
      vertexShader: 'varying vec2 vNdc; void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: GLSL + `
        uniform mat4 uInvVP; uniform vec3 uOcchio; varying vec2 vNdc;
        void main() {
          vec4 w = uInvVP * vec4(vNdc, 1.0, 1.0);
          vec2 uv = slabUV(uSlabVP * vec4(w.xyz / w.w - uOcchio, 0.0));
          vec2 dentro = min(uv, 1.0 - uv);
          float bordo = smoothstep(-0.004, 0.045, dentro.x) * smoothstep(-0.004, 0.025, dentro.y);
          vec2 c = clamp(uv, 0.0, 1.0);
          vec3 s = luceStanza(c);
          float t = clamp((c.x - uStri.x) / (uStri.y - uStri.x), 0.0, 1.0);
          s += uEsp * uLed * dec1(texture(tStri, c).r, uLogR.z) * texture(tGrad, vec2(t, 0.5)).rgb;  // il diffusore, col colore del punto
          float mu = texture(tMuro, c).r, ca = texture(tCarta, c).r;
          s *= mix(vec3(1.0), uMuro, mu) * mix(1.0, ${CARTA.toFixed(2)}, ca) * bordo;
          gl_FragColor = vec4(agx(s), uAlpha);
          ${FINE}
        }`,
      transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    const scenaFondo = new THREE.Scene(), camFondo = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadFondo = new THREE.Mesh(traccia(new THREE.PlaneGeometry(2, 2)), mFondo); quadFondo.frustumCulled = false; scenaFondo.add(quadFondo);

    // ---------- i poster: la sua parete (foto o composta), sul muro del render ----------
    const AREA = { x0: MURO.poster.x0, y0: MURO.poster.y0, w: MURO.poster.w, h: MURO.poster.y0 - MURO.poster.y1 };
    const COLLAGE = [[0.0, 0.0, 0.17, 0.355, -1.0], [0.208, 0.012, 0.17, 0.355, 0.7], [0.416, 0.0, 0.17, 0.355, -0.5], [0.624, 0.01, 0.17, 0.355, 1.1], [0.832, 0.0, 0.168, 0.355, -0.8],
      [0.0, 0.41, 0.215, 0.445, 0.6], [0.262, 0.42, 0.215, 0.445, -0.9], [0.524, 0.41, 0.215, 0.445, 0.5], [0.786, 0.42, 0.214, 0.445, -0.6]];
    // le posizioni del poster shop, nell'area dei poster del render. «spazio» (cm, 0-10, facoltativo) è la distanza fra le card scelta nel
    // poster shop (Larghe 3, Vicine 1,2, Attaccate 0): in frazione di una card larga 17 cm (una copertina moderna). Senza: com'era
    // (3% dell'area, card un filo storte). Con lo spazio le card si storcono in proporzione: attaccate stanno dritte e si toccano.
    const composta = p => {
      const cols = p.tessere.map(t => t.col), rows = p.tessere.map(t => t.row);
      const c0 = Math.min(...cols), r0 = Math.min(...rows), nc = Math.max(...cols) - c0 + 1, nr = Math.max(...rows) - r0 + 1;
      const R = AREA.w / AREA.h, cm = Number.isFinite(p.spazio) ? Math.min(10, Math.max(0, p.spazio)) : null, f = cm == null ? null : cm / 17;
      const w = f == null ? Math.min((1 - 0.03 * (nc - 1)) / nc, ((1 - 0.03 * R * (nr - 1)) / nr) * 0.65 / R)
        : Math.min(1 / (nc + (nc - 1) * f), 1 / (R * (nr / 0.65 + (nr - 1) * f)));
      const gx = f == null ? 0.03 : f * w, gy = gx * R, hh = w / 0.65 * R;
      const x0 = (1 - (nc * w + (nc - 1) * gx)) / 2, y0 = (1 - (nr * hh + (nr - 1) * gy)) / 2, pieghe = [-1.0, 0.7, -0.5, 1.1, -0.8, 0.6, -0.9, 0.5, -0.6];
      const storta = cm == null ? 1 : Math.min(1, cm / 3);
      return p.tessere.map((t, k) => [x0 + (t.col - c0) * (w + gx), y0 + (t.row - r0) * (hh + gy), w, hh, pieghe[k % pieghe.length] * storta, t.url]);
    };
    const posti = Array.isArray(op.parete)
      ? op.parete.filter(b => b instanceof Blob).slice(0, COLLAGE.length).map((b, k) => { const u = URL.createObjectURL(b); urlFoto.push(u); return [...COLLAGE[k], u]; })
      : Array.isArray(op.parete?.tessere) && op.parete.tessere.length ? composta(op.parete) : [];
    const poster = new THREE.Group(); gCasa.add(poster);
    const COC = ST.coc_px.muro, cocSchermo = { value: COC };
    const LUCE_LISCIA = `vec3 luceLiscia(vec2 uv) { vec2 d = 2.5 / vec2(${WS}.0, ${HS}.0);
      return (2.0 * luceStanza(uv) + luceStanza(uv + vec2(d.x, 0.0)) + luceStanza(uv - vec2(d.x, 0.0)) + luceStanza(uv + vec2(0.0, d.y)) + luceStanza(uv - vec2(0.0, d.y))) / 6.0; }`;
    const sopraTela = []; // le copertine che WebGL non può leggere: <img> in multiply sopra la tela, nello stesso strato
    await Promise.all(posti.map(async ([x, y, w, h, rot, url], k) => {
      const W = w * AREA.w, H = h * AREA.h;
      const img = await copertina(url);
      if (!img) return;
      const c = Object.assign(document.createElement('canvas'), { width: 192, height: Math.round(192 * H / W) });
      const g = c.getContext('2d'), b = Math.round(c.width * 0.045);
      g.fillStyle = '#f5f1e8'; g.fillRect(0, 0, c.width, c.height);
      const iw = c.width - 2 * b, ih = c.height - 2 * b, kk = Math.max(iw / img.naturalWidth, ih / img.naturalHeight);
      const nelDom = sporca(img);
      if (!nelDom) {
        g.filter = `blur(${(COC / 2.4 * c.width / (W * WS * 0.92 / MURO.poster.w)).toFixed(2)}px)`; // sfocato quanto il muro del render
        g.drawImage(img, (img.naturalWidth - iw / kk) / 2, 0, iw / kk, ih / kk, b, b, iw, ih); // il titolo in alto resta
      } else {
        Object.assign(img.style, { position: 'absolute', left: '0', top: '0', width: '100px', height: `${(100 * ih / iw).toFixed(2)}px`, objectFit: 'cover', objectPosition: 'top',
          transformOrigin: '0 0', mixBlendMode: 'multiply', pointerEvents: 'none', opacity: '0' });
        img.className = 'casa-copertina';
      }
      const t = traccia(new THREE.CanvasTexture(c)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      const mP = traccia(new THREE.ShaderMaterial({
        uniforms: { ...U, tCop: { value: t }, uCoc: cocSchermo }, vertexShader: VS_MONDO,
        fragmentShader: GLSL + LUCE_LISCIA + `uniform sampler2D tCop; uniform float uCoc; varying vec2 vUv; varying vec4 vClip;
          void main() { vec2 uv = slabUV(vClip); vec2 d = min(vUv, 1.0 - vUv) / max(fwidth(vUv), vec2(1e-6));
            float bordo = smoothstep(0.0, max(uCoc, 1.0), min(d.x, d.y));
            gl_FragColor = vec4(agx(luceLiscia(uv) * texture(tCop, vUv).rgb * 0.88), bordo * texture(tMuro, uv).r * uAlpha);
            ${FINE} }`,
        transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
      const m = new THREE.Mesh(traccia(new THREE.PlaneGeometry(W, H)), mP);
      m.position.set(AREA.x0 + (x + w / 2) * AREA.w, AREA.y0 - (y + h / 2) * AREA.h, MURO.z + 0.004 + k * 0.0004);
      m.rotation.z = rot * Math.PI / 180; m.renderOrder = 21;
      const OM = 0.03, mO = traccia(new THREE.ShaderMaterial({ // l'ombra: corta e dritta in giù (la luce viene dai LED sopra)
        uniforms: { ...U, uDim: { value: new THREE.Vector2(W, H) }, uM: { value: OM } }, vertexShader: VS_MONDO,
        fragmentShader: GLSL + `uniform vec2 uDim; uniform float uM; varying vec2 vUv; varying vec4 vClip;
          void main() { vec2 uv = slabUV(vClip); vec2 p = (vUv - 0.5) * (uDim + 2.0 * uM) - vec2(0.0, -0.008);
            float ombra = 1.0 - smoothstep(0.0, 0.016, length(max(abs(p) - uDim * 0.5, 0.0)));
            gl_FragColor = vec4(agx(luceStanza(uv) * uMuro * (1.0 - 0.5 * ombra)), ombra * texture(tMuro, uv).r * uAlpha);
            ${FINE} }`,
        transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
      const o = new THREE.Mesh(traccia(new THREE.PlaneGeometry(W + 2 * OM, H + 2 * OM)), mO);
      o.position.copy(m.position).z -= 0.002; o.rotation.z = m.rotation.z; o.renderOrder = 20;
      poster.add(o, m);
      if (nelDom) sopraTela.push({ img, m, w: 100, h: 100 * ih / iw, bx: b / c.width, by: b / c.height });
    }));

    // ---------- la mappa sul cartone: il giro di oggi (o la zona). Strade da OpenFreeMap, percorsi da OpenRouteService (mappa.js) ----------
    // Tutto quello che serve è già nella cache del giorno se il foglio è arrivato con la rete; sennò si prova la rete ora.
    // Senza niente: la carta bianca coi nomi dei comuni e le rette tratteggiate fra le tappe (dichiarate in info().tratti[].dritta).
    const giro = op.giro?.tappe?.length ? op.giro : null;
    const cache = giro && op.giorno ? `mappa:${op.giorno}` : 'mappa:zona';
    const tappe = giro ? giro.tappe.filter(t => t.centro).map(t => ({ ...t, da: t })) : [];
    const R = riquadro(tappe.map(t => t.centro)), { cx, cy, latoM } = R, zona = R.zona;
    tappe.forEach(t => { t.xy = zona(...t.centro); });
    const K = LATO / latoM;
    const sulPiano = (x, y) => new THREE.Vector3((x - cx) * K, PIANO, -(y - cy) * K);
    const elencoTile = tilesDi(R);
    const [datiTile, datiPercorsi] = await Promise.all([
      Promise.all(elencoTile.map(([z, x, y]) => tile(cache, z, x, y).then(b => b && { z, x, y, livelli: decodifica(b, LIVELLI) }).catch(() => null))),
      Promise.all(tappe.slice(1).map((t, i) => (t.chiave === tappe[i].chiave ? null : percorso(cache, tappe[i].chiave, t.chiave).catch(() => null))))]);
    // i tratti fra le tappe: la strada di OpenRouteService; sennò una retta tratteggiata, dichiarata
    const tracciati = [];
    for (let i = 0; i + 1 < tappe.length; i++) {
      if (tappe[i].chiave === tappe[i + 1].chiave) continue;
      const dato = giro.tratti[giro.tappe.indexOf(tappe[i].da)] ?? {}; // il tratto che parte da questa tappa
      const p = datiPercorsi[i];
      const punti = p ? p.coords.map(([lon, lat]) => zona(lat, lon)) : [tappe[i].xy, tappe[i + 1].xy];
      tracciati.push({ punti, metri: p?.metri ?? null, dritta: !p, tipo: dato.tipo ?? 'normale', stretta: !!dato.stretta,
        minuti: Number.isFinite(p?.secondi) ? Math.round(p.secondi / 60) : dato.minuti ?? null }); // i minuti della strada disegnata (OpenRouteService)
    }

    // la stampa: aree abitate, acqua, strade fino alle terziarie (schema OpenMapTiles), le strade del giro; i nomi a parte (nostri)
    const N = 1536, carta = document.createElement('canvas'); carta.width = carta.height = N;
    const tileUsati = datiTile.filter(Boolean).length;
    {
      const g = carta.getContext('2d');
      const px = ([x, y]) => [((x - cx) / latoM + 0.5) * N, (0.5 - (y - cy) / latoM) * N];
      const traccia2d = (anelli, a) => { for (const r of anelli) r.forEach((v, k) => { const [x, y] = px(zona(...a(...v))); g[k ? 'lineTo' : 'moveTo'](x, y); }); };
      g.fillStyle = '#fff'; g.fillRect(0, 0, N, N);
      const passo = (nome, filtro, disegna) => { for (const t of datiTile) { const L = t?.livelli[nome]; if (!L) continue; const a = daTile(t.z, t.x, t.y, L.estensione);
        for (const e of L.elementi) if (filtro(e)) { g.beginPath(); traccia2d(e.geo, a); disegna(e); } } };
      passo('landuse', e => e.tipo === 3 && ABITATO.has(e.prop.class), () => { g.fillStyle = '#e4ddd1'; g.fill('evenodd'); });
      passo('water', e => e.tipo === 3, () => { g.fillStyle = '#d3dad8'; g.fill('evenodd'); });
      g.lineCap = g.lineJoin = 'round';
      passo('waterway', e => e.tipo === 2, () => { g.strokeStyle = '#bcc6c4'; g.lineWidth = 1.2 * N / 2048; g.stroke(); });
      for (const c of ['tertiary', 'secondary', 'primary', 'trunk', 'motorway']) // le minori sotto, le autostrade sopra
        passo('transportation', e => e.tipo === 2 && e.prop.class === c, () => { g.strokeStyle = STRADE[c][0]; g.lineWidth = STRADE[c][1] * N / 2048; g.stroke(); });
      g.strokeStyle = '#90877a'; g.lineWidth = 1.5 * N / 2048; g.beginPath(); // le strade del giro, stampate come le minori
      for (const t of tracciati) if (!t.dritta) t.punti.forEach((v, i) => g[i ? 'lineTo' : 'moveTo'](...px(v)));
      g.stroke();
    }
    const tCartaMappa = traccia(new THREE.CanvasTexture(carta)); tCartaMappa.colorSpace = THREE.SRGBColorSpace; tCartaMappa.anisotropy = 8;
    const mFoglio = traccia(new THREE.ShaderMaterial({
      uniforms: { ...U, map: { value: tCartaMappa } }, vertexShader: VS_MONDO,
      fragmentShader: GLSL + `uniform sampler2D map; varying vec2 vUv; varying vec4 vClip;
        void main() { vec2 uv = slabUV(vClip); gl_FragColor = vec4(agx(luceStanza(uv) * texture(map, vUv).rgb * ${CARTA.toFixed(2)}), texture(tCarta, uv).r * uAlpha);
          ${FINE} }`,
      transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
    const foglio = new THREE.Mesh(traccia(new THREE.PlaneGeometry(LATO, LATO)), mFoglio);
    foglio.rotation.x = -Math.PI / 2; foglio.position.set(0, PIANO, PIASTRA_Z); foglio.renderOrder = 2;
    const piastra = new THREE.Group(); piastra.position.set(0, 0, PIASTRA_Z); gCasa.add(foglio, piastra);

    // il percorso a mano: penna nera fine, il tratto da guidare col pennarello blu, i fatti a matita, lo stretto con l'evidenziatore sotto
    const INCHIOSTRO = { normale: ['#24211e', 2, 1], prossimo: ['#2c47c4', 3.6, 1], fatto: ['#9a958c', 1.5, 0.8], stretta: ['#f0a23a', 7, 0.55] }; // colore, px, opacità
    const schermo = new THREE.Vector2(1, 1);
    const mNastro = tipo => {
      const [colore, px, alfa] = INCHIOSTRO[tipo];
      return traccia(new THREE.ShaderMaterial({
        uniforms: { ...U, uColore: { value: new THREE.Color(colore) }, uPx: { value: px }, uAlfa: { value: alfa }, uSchermo: { value: schermo } },
        vertexShader: `attribute vec3 normale; attribute float lato; uniform vec2 uSchermo; uniform float uPx; uniform mat4 uSlabVP; varying vec4 vClip; varying float vLato;
          void main() { vec4 c = projectionMatrix * modelViewMatrix * vec4(position, 1.0); float pxUnita = projectionMatrix[1][1] * uSchermo.y * 0.5 / c.w;
            vec4 p = modelMatrix * vec4(position + normale * lato * uPx / pxUnita * 0.5, 1.0); vClip = uSlabVP * p; vLato = lato; gl_Position = projectionMatrix * viewMatrix * p; }`,
        fragmentShader: GLSL + `uniform vec3 uColore; uniform float uAlfa; varying vec4 vClip; varying float vLato;
          void main() { vec2 uv = slabUV(vClip); float bordo = 1.0 - smoothstep(0.15, 1.0, abs(vLato));
            gl_FragColor = vec4(agx(luceStanza(uv) * uColore * 0.9), uAlfa * bordo * texture(tCarta, uv).r * uAlpha);
            ${FINE} }`,
        transparent: true, depthWrite: false, depthTest: false, toneMapped: false, side: THREE.DoubleSide }));
    };
    function geoNastro(punti, tratteggio = 0) {
      const pos = [], nor = [], lat = [], idx = []; let n = 0, L = 0;
      const P = punti.filter((p, i) => i === 0 || p.distanceToSquared(punti[i - 1]) > 1e-14);
      if (P.length < 2) return null;
      const dir = P.slice(1).map((p, i) => { const d = p.clone().sub(P[i]); d.y = 0; return d.normalize(); });
      P.forEach((p, i) => {
        if (i) L += p.distanceTo(P[i - 1]);
        const a = dir[Math.max(0, i - 1)], b = dir[Math.min(dir.length - 1, i)];
        const t = a.clone().add(b); if (t.lengthSq() < 1e-9) t.copy(b); t.normalize();
        const perp = new THREE.Vector3(-t.z, 0, t.x);
        perp.divideScalar(Math.max(0.35, Math.abs(perp.dot(new THREE.Vector3(-b.z, 0, b.x))))); // gli spigoli non si assottigliano
        for (const s of [1, -1]) { pos.push(p.x, p.y, p.z); nor.push(perp.x, 0, perp.z); lat.push(s); }
        if (i + 1 < P.length && (!tratteggio || Math.floor(L / tratteggio) % 2 === 0)) idx.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
        n += 2;
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normale', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('lato', new THREE.Float32BufferAttribute(lat, 1)); g.setIndex(idx);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
      return traccia(g);
    }
    const ORDINE = { stretta: 5, fatto: 6, normale: 7, prossimo: 8 };
    for (const t of tracciati) {
      let pts = t.punti.map(([x, y]) => sulPiano(x, y));
      if (t.dritta) { const [a, b] = pts; pts = Array.from({ length: 41 }, (_, k) => a.clone().lerp(b, k / 40)); }
      const g = geoNastro(pts, t.dritta ? 0.012 : 0);
      if (!g) continue;
      for (const tipo of t.stretta && t.tipo !== 'fatto' ? ['stretta', t.tipo] : [t.tipo]) {
        const m = new THREE.Mesh(g, mNastro(tipo)); m.renderOrder = ORDINE[tipo]; m.userData.tipo = tipo; piastra.add(m);
      }
    }
    // i nomi dei comuni del giro, stampati sulla carta (prendono la luce come l'inchiostro)
    const H_NOME = 0.0252 * 22000 / Math.max(22000, latoM);
    for (const t of tappe.filter((t, i, a) => a.findIndex(u => u.chiave === t.chiave) === i)) {
      const c = Object.assign(document.createElement('canvas'), { width: 512, height: 72 }), g = c.getContext('2d');
      g.font = '600 50px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(t.nome, 2, 38, 508);
      const tex = traccia(new THREE.CanvasTexture(c)); tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = 4;
      const W = H_NOME * 512 / 72;
      const m = new THREE.Mesh(traccia(new THREE.PlaneGeometry(W, H_NOME)), traccia(new THREE.ShaderMaterial({
        uniforms: { ...U, tNome: { value: tex } }, vertexShader: VS_MONDO,
        fragmentShader: GLSL + `uniform sampler2D tNome; varying vec2 vUv; varying vec4 vClip;
          void main() { vec2 uv = slabUV(vClip); gl_FragColor = vec4(agx(luceStanza(uv) * vec3(0.20, 0.19, 0.17) * 0.9), texture(tNome, vUv).r * 0.9 * texture(tCarta, uv).r * uAlpha); ${FINE} }`,
        transparent: true, depthWrite: false, depthTest: false, toneMapped: false })));
      m.rotation.x = -Math.PI / 2; m.renderOrder = 4;
      const p = sulPiano(...t.xy);
      m.position.set(p.x + 0.022 + W / 2, p.y, p.z); // la scritta comincia a destra del punto
      piastra.add(m);
    }

    // ---------- la giornata: la stessa carta, vista quasi dall'alto con la luce del giorno (B-vera, «giornata») ----------
    // Il tavolo e il cartone sono semplici (si vedono appena ai bordi); il percorso è il pennarello largo della giornata, col bordo
    // bianco; le tappe sono cartellini nella pagina (più sotto). Qui niente luce della lastra: vale solo dalla camera del render.
    const SRGB = 'vec3 srgb(vec3 g) { return mix(g * 12.92, 1.055 * pow(max(g, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, g)); }';
    const mTavolo = traccia(new THREE.ShaderMaterial({
      uniforms: { uCentro: { value: new THREE.Vector2(0, PIASTRA_Z) } },
      vertexShader: 'varying vec3 vP; void main() { vec4 p = modelMatrix * vec4(position, 1.0); vP = p.xyz; gl_Position = projectionMatrix * viewMatrix * p; }',
      fragmentShader: SRGB + `uniform vec2 uCentro; varying vec3 vP;
        void main() {
          vec2 q = abs(vP.xz - uCentro) - vec2(0.5); float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
          float v = sin(vP.x * 210.0 + sin(vP.z * 19.0) * 2.4) * 0.5 + 0.5;               // la venatura
          vec3 c = mix(vec3(0.085, 0.045, 0.024), vec3(0.125, 0.068, 0.036), v);
          c *= (0.4 + 0.6 * smoothstep(0.0, 0.045, sd)) * (1.0 - 0.6 * smoothstep(0.6, 2.0, length(vP.xz - uCentro))); // l'ombra del cartone, il buio intorno
          gl_FragColor = vec4(srgb(c), 1.0); }`,
      depthWrite: false, depthTest: false }));
    const tavolo = new THREE.Mesh(traccia(new THREE.PlaneGeometry(8, 8)), mTavolo);
    tavolo.rotation.x = -Math.PI / 2; tavolo.position.set(0, 0, PIASTRA_Z); tavolo.renderOrder = 0;
    const piastraG = new THREE.Group(); piastraG.position.set(0, 0, PIASTRA_Z);
    const bordoCartone = new THREE.Mesh(traccia(new THREE.BoxGeometry(LATO + 0.012, PIANO, LATO + 0.012)), traccia(new THREE.MeshBasicMaterial({ color: 0xcdc6b8, depthTest: false, depthWrite: false })));
    bordoCartone.position.y = PIANO / 2; bordoCartone.renderOrder = 1;
    const cartaG = new THREE.Mesh(traccia(new THREE.PlaneGeometry(LATO, LATO)), traccia(new THREE.ShaderMaterial({
      uniforms: { map: { value: tCartaMappa } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: SRGB + `uniform sampler2D map; varying vec2 vUv;
        void main() { vec3 c = texture(map, vUv).rgb * vec3(0.95, 0.92, 0.85);              // la carta calda, alla luce del giorno
          c *= 0.9 + 0.1 * smoothstep(1.3, 0.0, length(vUv - vec2(0.15, 0.9)));               // la lampada, in alto a sinistra
          gl_FragColor = vec4(srgb(c), 1.0); }`,
      depthWrite: false, depthTest: false })));
    cartaG.rotation.x = -Math.PI / 2; cartaG.position.y = PIANO + 0.0002; cartaG.renderOrder = 2;
    piastraG.add(bordoCartone, cartaG); gGiorno.add(tavolo, piastraG);
    const mNastroG = (colore, px) => traccia(new THREE.ShaderMaterial({
      uniforms: { uColore: { value: new THREE.Color(colore) }, uPx: { value: px }, uSchermo: { value: schermo } },
      vertexShader: `attribute vec3 normale; attribute float lato; uniform vec2 uSchermo; uniform float uPx; varying float vLato;
        void main() { vec4 c = projectionMatrix * modelViewMatrix * vec4(position, 1.0); float pxUnita = projectionMatrix[1][1] * uSchermo.y * 0.5 / c.w;
          vLato = lato; gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normale * lato * uPx / pxUnita * 0.5, 1.0); }`,
      fragmentShader: SRGB + 'uniform vec3 uColore; varying float vLato; void main() { gl_FragColor = vec4(srgb(uColore), 1.0 - smoothstep(0.75, 1.0, abs(vLato))); }',
      transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
    for (const t of tracciati) { // la lunghezza progressiva (per campionare) e il nastro della giornata
      t.giorno = t.stretta && t.tipo !== 'fatto' ? 'stretta' : t.tipo;
      t.cum = [0]; for (let i = 1; i < t.punti.length; i++) t.cum.push(t.cum[i - 1] + Math.hypot(t.punti[i][0] - t.punti[i - 1][0], t.punti[i][1] - t.punti[i - 1][1]));
      let pts = t.punti.map(([x, y]) => sulPiano(x, y));
      if (t.dritta) { const [a, b] = pts; pts = Array.from({ length: 41 }, (_, k) => a.clone().lerp(b, k / 40)); }
      const g = geoNastro(pts, t.dritta ? 0.012 : 0);
      if (!g) continue;
      const su = t.giorno === 'prossimo' || t.giorno === 'stretta' ? 2 : 0;
      const bordo = new THREE.Mesh(g, mNastroG('#fffaf0', LARGO_G[t.giorno] + 2.5)), nastro = new THREE.Mesh(g, mNastroG(COLORI_G[t.giorno], LARGO_G[t.giorno]));
      bordo.renderOrder = 5 + su; nastro.renderOrder = 6 + su;
      piastraG.add(bordo, nastro);
    }
    const nelMondo = ([x, y]) => sulPiano(x, y).add(piastra.position);
    const campiona = (t, f) => { // il punto a una frazione della lunghezza del tratto
      const L = t.cum.at(-1) * f; let i = t.cum.findIndex(c => c >= L); if (i <= 0) i = 1;
      const u = (L - t.cum[i - 1]) / ((t.cum[i] - t.cum[i - 1]) || 1), a = t.punti[i - 1], b = t.punti[i];
      return nelMondo([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
    };

    // ---------- le pose della camera ----------
    // La casa: la camera del render, adattata allo schermo senza mai tagliare parete e tavolo. Si vede sempre la lastra dalla riga 0
    // (sopra l'insegna) a 1,78 larghezze (sotto il cartone): la scala è la più grande che ci sta in larghezza e fra il bordo alto
    // (zona sicura) e i tasti (o, coi tasti di lato, l'altezza intera); quello che avanza è buio.
    const RIGA_FONDO = Math.max(1.78, ST.area_sicura_ws.fondo_mappa + 0.03);
    let fit = { W: innerWidth, H: innerHeight, Wa: innerWidth, s: 0.5, ox: 0, oy: 0 };
    function adatta() {
      const W = innerWidth, H = innerHeight;
      if (!contenitore?.isConnected) return { ...fit, W, H, Wa: W }; // in giornata la casa non c'è: resta l'ultima misura
      const c = comandi?.isConnected ? comandi.getBoundingClientRect() : null;
      const laterale = c && c.width < W * 0.6 && c.left > W * 0.35; // tasti in colonna a destra (telefono girato, schermo largo)
      const Wa = laterale ? c.left : W, basso = (laterale || !c ? H : c.top) - 6;
      const alto = (parseFloat(getComputedStyle(contenitore).paddingTop) || 0) + 2;
      const s = Math.max(0.05, Math.min(Wa / WS, (basso - alto) / (RIGA_FONDO * WS)));
      return { W, H, Wa, s, ox: (Wa - WS * s) / 2, oy: basso - RIGA_FONDO * WS * s }; // in basso, sopra i tasti: quello che avanza va in alto
    }
    fit = adatta();
    const vC = occhio.clone().sub(guardato), D_CASA = vC.length(), TH_CASA = Math.atan2(vC.x, vC.z), PH_CASA = Math.asin(vC.y / D_CASA);
    const CHINA = 0.38, ZOOM = 1.7; // chinarsi: prima la lastra avanza (solo zoom: la stanza resta esatta), poi la camera scende
    function posaCasa(zoom = 1, verso = null) {
      const { W, H, s, ox, oy } = fit;
      let px = ox + s * WS / 2, py = oy + s * HS / 2, sz = s; // dove cade l'asse ottico della lastra, e la sua scala
      if (zoom !== 1 && verso) { // la lastra avanza e il centro del cartone scivola verso dove sarà nella giornata
        const c = slab(new THREE.Vector3(0, PIANO, PIASTRA_Z)), cxs = ox + s * c.x * WS, cys = oy + s * (1 - c.y) * HS, k = (zoom - 1) / (ZOOM - 1);
        sz = s * zoom;
        px = cxs + (verso.x - cxs) * k - sz * (c.x - 0.5) * WS; py = cys + (verso.y - cys) * k - sz * (0.5 - c.y) * HS;
      }
      return { t: guardato.clone(), d: D_CASA, th: TH_CASA, ph: PH_CASA, fx: px / W, fy: py / H, fov: 2 * Math.atan(H / (2 * sz * F_PX)) / G, casa: true, zoom };
    }
    function metti(p) {
      const { W, H } = fit;
      cam.fov = p.fov; cam.aspect = W / H; cam.near = Math.min(0.06, p.d * 0.05); cam.far = 30; cam.updateProjectionMatrix();
      cam.projectionMatrix.elements[8] = 1 - 2 * p.fx; cam.projectionMatrix.elements[9] = 2 * p.fy - 1; // il centro dove lo schermo è libero
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      cam.position.set(p.t.x + p.d * Math.cos(p.ph) * Math.sin(p.th), p.t.y + p.d * Math.sin(p.ph), p.t.z + p.d * Math.cos(p.ph) * Math.cos(p.th));
      cam.up.set(-Math.sin(p.ph) * Math.sin(p.th), Math.cos(p.ph), -Math.sin(p.ph) * Math.cos(p.th)); cam.lookAt(p.t); cam.updateMatrixWorld();
    }
    const proietta = v => { const p = v.clone().project(cam); return { x: (p.x + 1) / 2 * fit.W, y: (1 - p.y) / 2 * fit.H }; };
    let ora = posaCasa(), uCasa = 1, voli = null, vista = null;
    // La giornata: nord in alto, quasi dall'alto, tutte le tappe e i tratti nell'area libera (sopra il foglio della lista), con almeno
    // 8 km di lato: la carta riempie lo schermo. Distanza trovata per bisezione, poi il centro spostato sul centro dell'area.
    function posaGiornata(area) {
      const punti = [...tappe.map(t => nelMondo(t.xy)), ...tracciati.flatMap(t => t.punti.filter((_, i) => i % 8 === 0).map(nelMondo))]; // un punto ogni 8: basta, e il tocco non si blocca
      const xs = punti.map(v => v.x), zs = punti.map(v => v.z);
      const t = punti.length ? new THREE.Vector3((Math.min(...xs) + Math.max(...xs)) / 2, PIANO, (Math.min(...zs) + Math.max(...zs)) / 2) : new THREE.Vector3(0, PIANO, PIASTRA_Z);
      const m = punti.length ? 4000 * K : LATO / 2;
      punti.push(...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => t.clone().add(new THREE.Vector3(a * m, 0, b * m))));
      const q = { t, th: 0, ph: PH_G, fov: 24, d: 1, fx: (area.x0 + area.x1) / 2 / fit.W, fy: (area.y0 + area.y1) / 2 / fit.H, casa: false };
      for (let giro3 = 0; giro3 < 4; giro3++) {
        let lo = 0.05, hi = 20;
        for (let k = 0; k < 24; k++) { // 24 dimezzamenti: la distanza giusta al millesimo
          const d = Math.sqrt(lo * hi); metti({ ...q, d });
          if (punti.every(v => { const s = proietta(v); return s.x >= area.x0 && s.x <= area.x1 && s.y >= area.y0 && s.y <= area.y1; })) hi = d; else lo = d;
        }
        q.d = hi; metti(q);
        const s = punti.map(proietta), mx = (Math.min(...s.map(v => v.x)) + Math.max(...s.map(v => v.x))) / 2, my = (Math.min(...s.map(v => v.y)) + Math.max(...s.map(v => v.y))) / 2;
        q.fx += ((area.x0 + area.x1) / 2 - mx) / fit.W; q.fy += ((area.y0 + area.y1) / 2 - my) / fit.H;
      }
      metti(ora);
      return q;
    }
    // un volo fra due pose (la distanza in scala logaritmica). Casa <-> giornata: prima lo zoom sulla lastra, poi la camera si china
    // fino alla vista dall'alto mentre la stanza svanisce (uCasa); al ritorno l'inverso. Con «riduci movimento»: subito.
    const lerp = THREE.MathUtils.lerp, inOut = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
    const interpola = (da, a, e) => {
      const et = da.d > a.d * 1.0001 || (da.casa && !a.casa) ? 1 - (1 - e) ** 2.6 : e ** 2.6;
      return { t: da.t.clone().lerp(a.t, et), d: Math.exp(lerp(Math.log(da.d), Math.log(a.d), e)), th: da.th + (a.th - da.th) * e,
        ph: lerp(da.ph, a.ph, e), fx: lerp(da.fx, a.fx, e), fy: lerp(da.fy, a.fy, e), fov: lerp(da.fov, a.fov, e) };
    };
    function vola(verso, ms = 1100) {
      const da = { ...ora, t: ora.t.clone() }, entra = da.casa && !verso.casa, esce = !da.casa && verso.casa;
      const mira = p => { metti(p); const q = proietta(new THREE.Vector3(0, PIANO, PIASTRA_Z)); metti(ora); return q; };
      const china = entra ? posaCasa(ZOOM, mira(verso)) : esce ? posaCasa(ZOOM, mira(da)) : null;
      return new Promise(ok => {
        const passo = k => {
          const e = inOut(k);
          if (entra) {
            if (e < CHINA) { ora = { ...interpola(da, china, e / CHINA), casa: true, zoom: 2 }; uCasa = 1; }
            else { const z = (e - CHINA) / (1 - CHINA); ora = interpola(china, verso, z); uCasa = 1 - THREE.MathUtils.smoothstep(z, 0, 0.4); }
          } else if (esce) {
            if (e < 1 - CHINA) { const z = e / (1 - CHINA); ora = interpola(da, china, z); uCasa = THREE.MathUtils.smoothstep(z, 0.6, 1); }
            else { const z = (e - (1 - CHINA)) / CHINA; ora = { ...interpola(china, verso, z), casa: true, zoom: 2 }; uCasa = 1; }
          } else ora = { ...interpola(da, verso, e), casa: verso.casa };
          if (k >= 1) { ora = verso; uCasa = verso.casa ? 1 : 0; }
          metti(ora); chiesto = true;
        };
        if (ms === 0 || fermo) { voli = null; passo(1); return ok(); }
        voli = { t0: performance.now(), ms, passo, fine: ok };
        chiesto = true;
      });
    }

    // ---------- l'insegna (DOM: scritta e neon) sull'insegna del render ----------
    const mettiInsegna = () => {
      const el = insegnaEl; if (!el?.isConnected) return;
      const I = MURO.insegna, a = proietta(new THREE.Vector3(I.x0, I.y0, MURO.z)), b = proietta(new THREE.Vector3(I.x0 + I.w, I.y1, MURO.z));
      const larga = b.x - a.x, alta = b.y - a.y, lettere = parseFloat(el.style.getPropertyValue('--lettere')) || 5;
      Object.assign(el.style, { position: 'absolute', left: `${a.x.toFixed(1)}px`, width: `${larga.toFixed(1)}px`, margin: '0', padding: '0', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: `${Math.max(14, Math.min(alta * 0.78, larga / (lettere * 0.6))).toFixed(1)}px` });
      for (let px = parseFloat(el.style.fontSize); el.scrollWidth > el.clientWidth && px > 8; px -= 1) el.style.fontSize = `${px - 1}px`;
      el.style.top = `${Math.max(0, a.y + (alta - el.offsetHeight) / 2).toFixed(1)}px`;
    };

    // ---------- il cartellino del prossimo e il tempo del tratto da guidare (DOM, nello strato) ----------
    const etichette = [];
    const prossima = tappe.find(t => t.stato === 'prossimo');
    if (prossima) {
      const el = Object.assign(document.createElement('div'), { className: 'casa-cartellino' });
      // in 3 secondi: quale tappa su quante, dove, a che ora (il critico, 29/10: «il 2 non dice di quante»)
      el.append(Object.assign(document.createElement('small'), { className: 'quale', textContent: `Tappa ${giro.tappe.indexOf(prossima.da) + 1} di ${giro.tappe.length}` }),
        Object.assign(document.createElement('b'), { textContent: prossima.nome }));
      if (prossima.ora) el.append(' ', Object.assign(document.createElement('small'), { textContent: prossima.ora }));
      etichette.push({ el, dove: () => sulPiano(...prossima.xy).add(piastra.position), tipo: 'tappa' });
      const t = tracciati.find(x => x.tipo === 'prossimo');
      if (t && t.minuti != null) {
        const mezzo = t.punti[Math.floor(t.punti.length / 2)];
        const tag = Object.assign(document.createElement('div'), { className: 'casa-tratto', textContent: `${t.minuti} min${t.metri ? ` · ${(t.metri / 1000).toFixed(1).replace('.', ',')} km` : ''}` });
        etichette.push({ el: tag, dove: () => sulPiano(...mezzo).add(piastra.position), tipo: 'tratto' });
      }
    }
    const mettiEtichette = () => {
      const fuori = !ora.casa || ora.zoom !== 1 || uCasa < 1;
      let sopra = null;
      for (const e of etichette) {
        e.el.style.opacity = fuori ? '0' : '1';
        const p = proietta(e.dove()), w = e.el.offsetWidth, h = e.el.offsetHeight;
        const x = Math.min(fit.Wa - w - 6, Math.max(6, p.x - w / 2));
        let y = e.tipo === 'tappa' ? p.y - h - 10 : p.y + 8;
        if (sopra && x < sopra.x + sopra.w && x + w > sopra.x && y < sopra.y + sopra.h && y + h > sopra.y) y = sopra.y + sopra.h + 4; // non sopra il cartellino
        e.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        if (e.tipo === 'tappa') sopra = { x, y, w, h };
      }
    };

    // ---------- la giornata: i cartellini delle tappe (B-vera, «cartellini»), nella pagina sopra la tela ----------
    // Una carta per comune (Tradate con tre orari è una tappa sola), il numero della tappa, gli orari (quello del prossimo in grassetto,
    // gli esiti colorati), la nota del punto stretto su chi arriva dopo. Il prossimo ha l'anello; una tappa finita resta numero ed esito.
    // Toccandola si apre la sua scheda (#/i/N, la scheda dell'app). Sul tratto da guidare: minuti e km di OpenRouteService.
    const carteEl = crea('div', 'casa-carte'); pulizie.push(() => carteEl.remove());
    let spilli = [], tagTratto = null;
    function creaCarte() {
      carteEl.replaceChildren(); spilli = []; tagTratto = null;
      if (!giro || !vista) return;
      const perComune = new Map();
      for (const t of tappe) {
        const c = perComune.get(t.chiave) ?? { t, numeri: [], interventi: [] };
        c.numeri.push(giro.tappe.indexOf(t.da) + 1); c.interventi.push(...(t.interventi ?? []));
        perComune.set(t.chiave, c);
      }
      // poca mappa (bassa, o stretta come a 320 px): le tappe non accese diventano «3 · 11:00»; il resto è nella lista sotto
      const area = vista.area(), bassa = area.y1 - area.y0 < 200 || area.x1 - area.x0 < 320;
      for (const [k, { t, numeri, interventi }] of perComune) {
        const acceso = interventi.some(i => i.prossimo), fatto = interventi.length > 0 && interventi.every(i => i.esito);
        const primo = interventi.find(i => !i.esito) ?? interventi[0];
        const n = crea('span', 'n', numeri.join('·'));
        let dentro;
        if (fatto) { const esiti = [...new Set(interventi.map(i => i.esito))]; dentro = [n, crea('span', esiti.includes('KO') ? 'ko' : 'ok', esiti.join('/'))]; }
        else if (bassa && !acceso) dentro = [n, primo?.ora ?? ''];
        else {
          const ore = interventi.flatMap((i, j) => [j ? ' · ' : null, i.esito ? crea('span', i.esito === 'OK' ? 'ok' : 'ko', `${i.ora} ${i.esito}`) : i.prossimo ? crea('b', '', i.ora) : i.ora]);
          const nota = giro.stretto?.a === k && crea('span', 'stretta', ` · solo ${giro.stretto.minuti} min dopo ${giro.stretto.nomeDa}`);
          dentro = [n, t.nome, crea('small', '', ...ore, nota)];
        }
        const carta = crea('a', fatto || (bassa && !acceso) ? 'carta corta' : 'carta', ...dentro);
        if (primo) carta.href = `#/i/${primo.i}`;
        const el = crea('div', `spillo${acceso ? ' acceso' : ''}${fatto ? ' fatto' : ''}`, crea('span', 'filo'), crea('span', acceso ? 'pallino' : 'testa'), carta);
        carteEl.append(el);
        spilli.push({ el, carta, v: nelMondo(t.xy) });
      }
      const tp = tracciati.find(x => x.tipo === 'prossimo');
      if (tp && tp.minuti != null) {
        tagTratto = { el: crea('span', 'tag-tratto', `${durata(tp.minuti)}${tp.metri ? ` · ${(tp.metri / 1000).toFixed(1).replace('.', ',')} km` : ''}`), t: tp };
        carteEl.append(tagTratto.el);
      }
    }
    // un segmento attraversa un riquadro? (Liang-Barsky); due fili si incrociano?
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
    function segSeg(a, b, c, d) {
      const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
      if (Math.hypot(a.x - c.x, a.y - c.y) < 1) return false;
      return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
    }
    const tocca = (b, lista) => lista.some(m => (m.seg ? segBox(m.seg[0], m.seg[1], b) : b.x0 < m.x1 && b.x1 > m.x0 && b.y0 < m.y1 && b.y1 > m.y0));
    const sopra = (b, lista) => lista.reduce((t, m) => t + (m.seg ? (segBox(m.seg[0], m.seg[1], b) ? 400 : 0) : Math.max(0, Math.min(b.x1, m.x1) - Math.max(b.x0, m.x0)) * Math.max(0, Math.min(b.y1, m.y1) - Math.max(b.y0, m.y0))), 0);
    // I cartellini non si coprono: prima il prossimo, poi le tappe da fare dall'alto in giù, per ultime quelle fatte; ognuno prova
    // posti sempre più lontani dal suo punto e prende il primo libero (niente carte, punti, tratto da guidare e tratto stretto sotto).
    function posiziona() {
      if (voli || ora.casa || !vista || !carteEl.isConnected) return;
      const A = vista.area(), messi = [];
      const pronti = spilli.map(s => ({ s, p: proietta(s.v) }));
      for (const { p } of pronti) messi.push({ x0: p.x - 15, x1: p.x + 15, y0: p.y - 15, y1: p.y + 15, testa: true });
      for (const t of tracciati.filter(x => x.tipo === 'prossimo' || x.giorno === 'stretta'))
        for (let k = 0; k < 13; k++) { const q = proietta(campiona(t, 0.04 + k * 0.92 / 12)); messi.push({ x0: q.x - 7, x1: q.x + 7, y0: q.y - 7, y1: q.y + 7, strada: true }); }
      const peso = x => (x.s.el.classList.contains('acceso') ? 0 : x.s.el.classList.contains('fatto') ? 2 : 1);
      pronti.sort((a, b) => peso(a) - peso(b) || a.p.y - b.p.y);
      const ac = api.angoliCartone(), P = { x0: Math.min(...ac.map(v => v.x)) + 4, x1: Math.max(...ac.map(v => v.x)) - 4, y0: Math.min(...ac.map(v => v.y)) + 4, y1: Math.max(...ac.map(v => v.y)) - 4 };
      const dentro = b => b.y0 > Math.max(A.y0, P.y0) && b.y1 < Math.min(A.y1, P.y1) && b.x0 > Math.max(A.x0, P.x0) && b.x1 < Math.min(A.x1, P.x1);
      for (const { s, p } of pronti) {
        const mio = messi.find(m => m.testa && Math.abs((m.x0 + m.x1) / 2 - p.x) < 0.01 && Math.abs((m.y0 + m.y1) / 2 - p.y) < 0.01);
        const w = s.carta.offsetWidth, hh = s.carta.offsetHeight, prove = [];
        for (const r of [10, 18, 28, 40, 54, 70, 88, 108, 130]) for (let k = 0; k < 16; k++) {
          const th = k * Math.PI / 8, dx = Math.sin(th), dy = -Math.cos(th);
          const ext = Math.abs(dx) * w / 2 + Math.abs(dy) * hh / 2, cx = p.x + dx * (r + ext), cy = p.y + dy * (r + ext);
          const dentroCarta = Math.min(Math.abs(dx) > 1e-6 ? w / 2 / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? hh / 2 / Math.abs(dy) : Infinity);
          const lungo = r + ext - dentroCarta; // il filo arriva al bordo della carta
          prove.push({ r: lungo, th, box: { x0: cx - w / 2 - 3, x1: cx + w / 2 + 3, y0: cy - hh / 2 - 6, y1: cy + hh / 2 + 6 }, fine: { x: p.x + dx * lungo, y: p.y + dy * lungo }, costo: r + (1 - Math.cos(th)) * 12 });
        }
        prove.sort((x, y) => x.costo - y.costo);
        const ostacoli = messi.filter(m => m !== mio);
        const filoLibero = q => !ostacoli.some(m => (m.seg ? segSeg(p, q.fine, ...m.seg) : !m.strada && segBox(p, q.fine, m)));
        const libera = prove.find(q => dentro(q.box) && !tocca(q.box, ostacoli) && filoLibero(q))
          ?? prove.filter(q => dentro(q.box)).map(q => ({ ...q, c: sopra(q.box, ostacoli) })).sort((x, y) => x.c - y.c)[0] ?? prove[0]; // nessun posto libero: il meno coperto
        messi.push(libera.box, { seg: [p, libera.fine] });
        const st = s.el.style;
        st.setProperty('--r', `${libera.r}px`); st.setProperty('--ang', `${libera.th.toFixed(3)}rad`);
        st.setProperty('--cx', `${(libera.box.x0 + 3 - p.x).toFixed(1)}px`); st.setProperty('--cy', `${(libera.box.y0 + 6 - p.y).toFixed(1)}px`);
        st.setProperty('--x', `${p.x.toFixed(1)}px`); st.setProperty('--y', `${p.y.toFixed(1)}px`);
      }
      if (tagTratto) { // il tempo del tratto: sul nastro, dove non copre nessuno, come i tempi di Maps
        const x = tagTratto, w = x.el.offsetWidth, hh = x.el.offsetHeight, prove = [];
        for (const off of [0, 1, -1, 2, -2]) for (const f of [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78, 0.14, 0.86]) {
          const a = proietta(campiona(x.t, Math.max(0, f - 0.02))), b = proietta(campiona(x.t, Math.min(1, f + 0.02)));
          const L = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L, sp = off * (Math.abs(nx) * w / 2 + Math.abs(ny) * hh / 2 + 5);
          prove.push({ x: (a.x + b.x) / 2 + nx * sp, y: (a.y + b.y) / 2 + ny * sp });
        }
        const box = q => ({ x0: q.x - w / 2, x1: q.x + w / 2, y0: q.y - hh / 2, y1: q.y + hh / 2 });
        const libera = prove.find(q => dentro(box(q)) && !tocca(box(q), messi.filter(m => !m.strada)))
          ?? prove.map(q => ({ ...q, c: sopra(box(q), messi.filter(m => !m.strada)) + (dentro(box(q)) ? 0 : 1e6) })).sort((u, v) => u.c - v.c)[0];
        x.el.style.transform = `translate(${(libera.x - w / 2).toFixed(1)}px, ${(libera.y - hh / 2).toFixed(1)}px)`;
      }
    }
    const mostraCarte = () => { if (!carteEl.isConnected) { creaCarte(); document.body.append(carteEl); } posiziona(); };

    // ---------- i LED: tre colori per i tre tratti e una sfumatura per il diffusore; colore scelto o la cornice che gira ----------
    const coloreFisso = op.colore ?? null;
    let phiLed = [], phiLuci = [], camMossa = true;
    function coloriLed() {
      const a = document.querySelector('.cornice-led')?.getAnimations?.()[0];
      const dur = Number(a?.effect?.getTiming?.().duration) || 5000;
      const ang = a && !fermo ? ((Number(a.currentTime) || 0) % dur) / dur * 360 : 0;
      if (camMossa) {
        const dir = p => { const q = proietta(p); return Math.atan2(q.x - fit.W / 2, -(q.y - fit.H / 2)) * 180 / Math.PI; };
        phiLed = puntiStriscia.map(dir); phiLuci = centriLed.map(dir); camMossa = false;
      }
      const fisso = coloreFisso && new THREE.Color(coloreFisso), gd = grad.image.data;
      phiLed.forEach((phi, i) => { const c = fisso ?? coloreLed(ang, phi); gd[i * 4] = c.r * 255; gd[i * 4 + 1] = c.g * 255; gd[i * 4 + 2] = c.b * 255; });
      grad.needsUpdate = true;
      ['uC0', 'uC1', 'uC2'].forEach((u, i) => U[u].value.copy(fisso ?? coloreLed(ang, phiLuci[i])));
      // la luce dell'insegna: il suo colore; l'arcobaleno segue il LED di mezzo
      if (tIns) U.uIns.value.copy(op.insegna === 'arcobaleno' ? U.uC1.value : new THREE.Color(op.insegna));
    }

    // ---------- disegno ----------
    const vInv = new THREE.Matrix4(), angolo = new THREE.Vector3();
    // giornata: la carta del giorno; casa: la lastra (il fondo), poi sopra la carta, il percorso e i poster che prendono la sua luce.
    // Mentre ci si china: prima la giornata, sopra la stanza che svanisce (uAlpha = uCasa).
    function disegna() {
      r.autoClear = false; r.clear();
      if (uCasa < 1) { gCasa.visible = false; gGiorno.visible = true; r.render(scena, cam); }
      if (uCasa > 0) {
        vInv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).invert();
        mFondo.uniforms.uInvVP.value.copy(vInv); mFondo.uniforms.uOcchio.value.copy(cam.position);
        U.uAlpha.value = uCasa;
        r.render(scenaFondo, camFondo);
        gCasa.visible = true; gGiorno.visible = false; r.render(scena, cam);
      }
      for (const p of sopraTela) {
        if (uCasa <= 0) { p.img.style.opacity = '0'; continue; }
        const { width: W_, height: H_ } = p.m.geometry.parameters;
        const q = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => proietta(angolo.set(sx * W_ * (0.5 - p.bx), sy * H_ * (0.5 - p.by), 0).applyMatrix4(p.m.matrixWorld)));
        p.img.style.transform = matrice3d(p.w, p.h, q); p.img.style.opacity = String(uCasa);
      }
      mettiEtichette();
    }
    let chiesto = true, ultimoLed = 0, prec = 0, disegni = 0;
    const intervalli = [], tempi = [];
    let ledVivi = !fermo && (!coloreFisso || op.insegna === 'arcobaleno');
    function ciclo(t) {
      if (!vivo) return;
      if (voli) { const v = voli, k = Math.min(1, Math.max(0, (t - v.t0) / v.ms)); v.passo(k); if (k >= 1) { voli = null; v.fine(); } }
      if (ledVivi && uCasa > 0 && t - ultimoLed >= 32) {
        if (prec && intervalli.length < 30) intervalli.push(t - prec);
        if (intervalli.length === 30) { // il telefono non ce la fa: i LED restano fermi, la stanza resta
          const m = [...intervalli].sort((x, y) => x - y)[15];
          if (m > LENTO_MS) { ledVivi = false; api.lento = m; }
          intervalli.push(m);
        }
        prec = t; ultimoLed = t; coloriLed(); U.uSeme.value = (U.uSeme.value + 0.618034) % 1; chiesto = true;
      }
      if (chiesto) { const t0 = performance.now(); disegna(); chiesto = false; disegni++; tempi.push(performance.now() - t0); if (tempi.length > 300) tempi.shift(); }
      idRaf = requestAnimationFrame(ciclo);
    }
    const misura = () => {
      if (!vivo) return;
      fit = adatta();
      r.setSize(fit.W, fit.H, false);
      schermo.set(fit.W, fit.H); cocSchermo.value = COC * fit.s * r.getPixelRatio(); camMossa = true;
      chiesto = true;
      if (voli) return; // a fine volo
      if (ora.casa) { ora = posaCasa(); metti(ora); mettiInsegna(); coloriLed(); }
      else if (vista) { ora = posaGiornata(vista.area()); metti(ora); posiziona(); }
    };
    addEventListener('resize', misura); pulizie.push(() => removeEventListener('resize', misura));
    ro = new ResizeObserver(() => misura());
    const osserva = () => { ro.disconnect(); ro.observe(contenitore); if (comandi) ro.observe(comandi); };

    strato.append(tela, ...sopraTela.map(p => p.img), ...etichette.map(e => e.el));
    document.body.append(strato);
    misura();
    gGiorno.visible = true; await r.compileAsync(scena, cam); // anche i programmi della giornata: niente compilazioni durante il volo
    await r.compileAsync(scena, cam); await r.compileAsync(scenaFondo, camFondo);
    if (!vivo) throw new Error('chiusa');
    disegna(); chiesto = false;
    strato.classList.add('pronto');
    osserva();
    idRaf = requestAnimationFrame(ciclo);

    api = {
      lento: 0,
      // l'app ha ridisegnato la casa con gli stessi dati: la stanza resta, si riaggancia a insegna e tasti nuovi
      lega: o => { ({ contenitore, insegnaEl, comandi } = o); osserva(); misura(); },
      // «Il giro di oggi»: ci si china sul tavolo e la carta resta davanti, coi cartellini. v = { area: () => { x0, x1, y0, y1 }, ms }:
      // l'area dello schermo libera per la carta (sopra o accanto al foglio della lista)
      giornata: async v => {
        vista = v;
        await vola(posaGiornata(v.area()), v.ms ?? 1100);
        if (vivo && vista === v && !ora.casa) mostraCarte();
      },
      // «Parete» o il tasto indietro: si torna alla stanza
      casa: async o => { // o: la casa nuova (contenitore, insegna, tasti), a cui la stanza si riaggancia
        vista = null; carteEl.remove();
        if (o) { ({ contenitore, insegnaEl, comandi } = o); osserva(); }
        if (ora.casa && !voli) return misura();
        fit = adatta();
        await vola(posaCasa(), 1100);
        if (vivo && ora.casa) misura();
      },
      modo: () => (voli ? 'volo' : ora.casa ? 'casa' : 'giornata'),
      puntiTappe: () => tappe.map(t => proietta(nelMondo(t.xy))), // per le prove: le tappe sullo schermo
      posiziona,
      chiudi,
      // per le prove
      info: () => ({ poster: poster.children.filter(m => m.renderOrder === 21).length, sopra: sopraTela.length, tappe: tappe.map(t => ({ chiave: t.chiave, stato: t.stato })),
        tratti: tracciati.map(t => ({ tipo: t.tipo, stretta: t.stretta, dritta: t.dritta, metri: t.metri, minuti: t.minuti })), latoKm: latoM / 1000,
        tile: { chiesti: elencoTile.length, usati: tileUsati }, cache,
        fit: { ...fit }, tempi: [...tempi], disegni, intervalli: [...intervalli], ledVivi, lento: api.lento, chiamate: r.info.render.calls,
        memoria: { ...r.info.memory }, gl: r.getContext().getParameter(r.getContext().VERSION), insegnaAccesa: !!tIns,
        colori: { led: ['uC0', 'uC1', 'uC2'].map(u => `#${U[u].value.getHexString()}`), insegna: `#${U.uIns.value.getHexString()}` },
        // memoria della scheda video, stimata: texture (R8 = 1 byte, le altre 4, ×4/3 con le mipmap) + tela (colore e profondità, MSAA 4×)
        gpuMB: (() => {
          let b = 0;
          for (const x of libera) if (x.isTexture) { const i = x.image ?? {}, n = (i.width ?? 0) * (i.height ?? 0) * (i.depth ?? 1); b += n * (x.format === THREE.RedFormat ? 1 : 4) * (x.generateMipmaps && !x.isDataTexture ? 4 / 3 : 1); }
          const gl = r.getContext(), px = gl.drawingBufferWidth * gl.drawingBufferHeight;
          return +((b + px * 8 + px * 8 * 4) / 1048576).toFixed(1);
        })() }),
      angoliCartone: () => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => proietta(new THREE.Vector3(a * LATO / 2, PIANO, PIASTRA_Z + b * LATO / 2))),
      angoliParete: () => [[AREA.x0, AREA.y0], [AREA.x0 + AREA.w, AREA.y0], [AREA.x0 + AREA.w, MURO.poster.y1], [AREA.x0, MURO.poster.y1]].map(([x, y]) => proietta(new THREE.Vector3(x, y, MURO.z))),
      angoliLastra: () => ({ alto: fit.oy, basso: fit.oy + RIGA_FONDO * WS * fit.s, sinistra: fit.ox, destra: fit.ox + WS * fit.s }),
      quadriPoster: () => poster.children.filter(m => m.renderOrder === 21).map(m => { m.geometry.computeBoundingBox(); const bb = m.geometry.boundingBox;
        return [[bb.min.x, bb.max.y], [bb.max.x, bb.max.y], [bb.max.x, bb.min.y], [bb.min.x, bb.min.y]].map(([x, y]) => proietta(new THREE.Vector3(x, y, 0).applyMatrix4(m.matrixWorld))); }),
      fotografa: () => { disegna(); const gl = r.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, a = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, a); return { w, h, a, dpr: w / fit.W }; },
    };
    return api; // window.__casa3d lo mette l'app, quando questa stanza è davvero quella in uso
  } catch (e) {
    chiudi();
    throw e;
  }
}
