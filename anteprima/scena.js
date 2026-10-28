// La casa è una stanza fotografata: un render di Blender (Cycles, stanza/costruisci.py) diviso per gruppi di luce, che qui si
// mescolano a ogni giro dei LED (luce = base + Σ tratto_i × colore_i). Muro e cartone nel render sono vuoti (la camera li vede
// bianchi: lì il render è la luce che arriva); la pagina ci mette sopra, con la stessa camera, ciò che cambia: il colore del muro,
// le copertine (qualunque disposizione, anche nessuna), la mappa del giorno e il percorso. Tutto prende la luce della stanza.
// Sulla mappa la geografia del giro in proporzione vera, nord verso il muro: strade principali (OpenStreetMap), edifici dei centri
// (altezza da height o building:levels, sennò 2 piani = 6 m), percorso OSRM. Tutto dai file di dati/ e stanza/: niente rete verso terzi.
// Un mondo solo, tre inquadrature: la casa (la camera del render), la giornata (china sulla mappa, dall'alto), la scheda (il
// centro di un comune). Si disegna solo quando qualcosa si muove (batteria), tranne in casa dove girano i LED.
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const TEX = 'vendor/textures/';
const QS = new URLSearchParams(location.search);
const STANZA = 'stanza/', LASTRE = `stanza/${QS.get('lastre') === 'anteprima' ? 'lastre-anteprima' : 'lastre'}/`;
const LATO = 1.0;                         // la mappa in unità del mondo (il cartone del render: 56 cm)
const PIASTRA_Z = 0.35;                   // dove sta la mappa sul tavolo (uguale in stanza/costruisci.py)
const UI_CASA = 161;                      // px: il riquadro «Il giro di oggi» e i tre tasti, uguali a 390, 360 e 320 (misurati)
const BASE = 0.012, TIGLIO = 0.002, PIANO = BASE + TIGLIO; // cartone piuma e carta
export const ALTEZZA_SENZA_DATO = 6;      // m: 2 piani, quando OSM non dice né height né building:levels
// la proiezione di prepara_plastico.py: sinusoidale locale sull'ellissoide WGS84 (x est, y nord, metri), e la sua inversa
const WGS_A = 6378137, WGS_E2 = (1 / 298.257223563) * (2 - 1 / 298.257223563), G = Math.PI / 180;
const raggi = lat => { const s = Math.sin(lat * G), w = Math.sqrt(1 - WGS_E2 * s * s); return [WGS_A * (1 - WGS_E2) / w ** 3, WGS_A / w]; };
const sinusoidale = (lat0, lon0) => (lat, lon) => [(lon - lon0) * G * raggi(lat)[1] * Math.cos(lat * G), (lat - lat0) * G * raggi((lat + lat0) / 2)[0]];
const inversa = (lat0, lon0) => (x, y) => {
  let lat = lat0 + y / (G * raggi(lat0)[0]);
  lat = lat0 + y / (G * raggi((lat + lat0) / 2)[0]); // un secondo passo: entro 1 km l'errore è sotto il millimetro
  return [lat, lon0 + x / (G * raggi(lat)[1] * Math.cos(lat * G))];
};
// larghezza delle vie in metri (vista da vicino) e in px minimi (vista da lontano)
const VIA_M = [22, 18, 13, 11, 9, 7, 6, 5, 5];
const DATI = 'dati/';

// ---------- piccoli aiuti ----------
const prendi = async u => { const r = await fetch(u); if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); };
// [x0, y0, dx1, dy1, ...] -> [[x, y], ...]
const spiana = v => { const out = []; let x = 0, y = 0; for (let i = 0; i < v.length; i += 2) { x += v[i]; y += v[i + 1]; out.push([x, y]); } return out; };
const areaFirmata = r => r.reduce((s, [x0, y0], i) => { const [x1, y1] = r[(i + 1) % r.length]; return s + x0 * y1 - x1 * y0; }, 0) / 2;
// una copertina: si decodifica; se non riesce si riprova una volta (con un parametro, per non riavere lo stesso errore dalla
// cache); se non riesce ancora quel poster si salta. Mai carta bianca sul muro.
async function copertina(url) {
  for (const u of [url, `${url}${url.includes('?') ? '&' : '?'}riprova=1`]) {
    const img = new Image(); img.alt = '';
    if (/^https?:/.test(u) && !u.startsWith(location.origin)) img.referrerPolicy = 'no-referrer'; // come app/parete.js: a Comic Vine non si dice da che pagina arriva
    img.src = u;
    try { await img.decode(); if (img.naturalWidth) return img; } catch { /* si riprova, poi si salta */ }
  }
  return null;
}
// un'immagine di un altro sito senza CORS (Comic Vine) «sporca» la tela: WebGL non la può caricare
const sporca = img => {
  try { const g = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d'); g.drawImage(img, 0, 0, 1, 1); g.getImageData(0, 0, 1, 1); return false; }
  catch { return true; }
};
// la matrice CSS che porta un elemento w×h sui quattro punti q (alto-sinistra, alto-destra, basso-destra, basso-sinistra, px CSS)
function matrice3d(w, h, q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q.map(v => [v.x, v.y]);
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3, dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den, hh = (dx1 * sy - sx * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + hh * x3, d = y1 - y0 + g * y1, e = y3 - y0 + hh * y3;
  return `matrix3d(${a / w},${d / w},0,${g / w},${b / h},${e / h},0,${hh / h},0,0,1,0,${x0},${y0},0,1)`;
}

// ---------- la luce della stanza, in GLSL: le lastre del render, decodificate e mescolate coi colori del momento ----------
// codifica (stanza/codifica.py): v = K (2^(e log2(1 + VMAX/K)) - 1). AgX: quella di Blender, in una tabella 3D (vedi agx()).
const GLSL_STANZA = /* glsl */`
  uniform sampler2D tB, tT, tR0, tR1, tStri, tIns, tMuro, tCarta, tGrad;
  uniform highp sampler3D tAgx;
  uniform vec3 uC0, uC1, uC2, uIns, uMuro;
  uniform float uBase, uLed, uAlpha, uGrana, uEsp, uCarta, uTela, uNero;
  uniform mat4 uSlabVP;
  uniform vec2 uStri;
  uniform vec4 uLogR; // log2(1 + VMAX/K) di base, led, striscia, insegna (lastre.json): ogni lastra ha il suo tetto
  const float K_ = 0.002;
  vec3 dec3(vec3 e, float r) { return K_ * (exp2(e * r) - 1.0); }
  float dec1(float e, float r) { return K_ * (exp2(e * r) - 1.0); }
  vec2 slabUV(vec4 clip) { return clip.xy / clip.w * 0.5 + 0.5; }
  vec3 luceStanza(vec2 uv) {
    vec3 T = dec3(texture2D(tT, uv).rgb, uLogR.y);
    float r0 = texture2D(tR0, uv).r, r1 = texture2D(tR1, uv).r;
    vec3 s = uBase * dec3(texture2D(tB, uv).rgb, uLogR.x) + uLed * T * (r0 * uC0 + r1 * uC1 + max(0.0, 1.0 - r0 - r1) * uC2);
    if (uIns.r + uIns.g + uIns.b > 0.0) s += dec3(texture2D(tIns, uv).rgb, uLogR.w) * uIns;
    return s * uEsp;
  }
  // la AgX del render: la tabella 3D che Blender ha scritto con la sua trasformazione (stanza/agx.png); esce già in sRGB
  vec3 agx(vec3 c) { vec3 t = clamp((log2(max(c, 1e-10)) + 12.47393) / 16.499999, 0.0, 1.0); return texture(tAgx, t * (32.0 / 33.0) + 0.5 / 33.0).rgb; }
  uniform float uSeme;
  vec3 grana(vec2 p) { vec3 q = fract(vec3(p.xyx + uSeme * 97.0) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yxz + 33.33); return fract((q.xxy + q.yxx) * q.zyx) - 0.5; }
`;
// in fondo a ogni shader della casa, sul colore già sRGB (uscito dalla tabella AgX): il nero di una foto del telefono, che non è mai
// nero assoluto (il telefono solleva le ombre: critico 2, «vuoto nero digitale»), e la grana del sensore: più forte nelle ombre, un
// filo colorata, nuova a ogni giro dei LED (critico 3: «la luce scorre sotto un velo di grana immobile»)
const FINE_CASA = /* glsl */`
  gl_FragColor.rgb = uNero + (1.0 - uNero) * gl_FragColor.rgb;
  { vec3 g = grana(gl_FragCoord.xy); gl_FragColor.rgb += mix(vec3(g.x), g, 0.35) * uGrana * (1.6 - 1.2 * dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114))); }
`;

// il colore della cornice LED in una direzione dello schermo (phi: gradi dall'alto, in senso orario), con la cornice girata
// di «angolo»: la striscia sul muro prende, punto per punto, il colore del pezzo di cornice che ha davanti
const STOP = ['#ff2d55', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#0a84ff', '#bf5af2', '#ff2d55'].map(c => new THREE.Color(c));
export function coloreLed(angolo, phi = 0) {
  const a = (((phi - angolo) % 360) + 360) % 360 / 360 * (STOP.length - 1);
  const i = Math.floor(a);
  return STOP[i].clone().lerp(STOP[Math.min(i + 1, STOP.length - 1)], a - i);
}

// ---------- le linee: nastri posati sulla piastra, con gli spigoli a punta (mitra) calcolati una volta sola ----------
// Larghi il maggiore fra i px minimi sullo schermo (da lontano) e la larghezza vera in metri (da vicino).
// In casa (uModo 1) il nastro è inchiostro sulla carta: il suo colore per la luce della stanza, e sparisce sotto ciò che sta sopra
// il cartone (la maschera della carta del render).
const schermo = new THREE.Vector2(1, 1), scalaPx = { value: 1 };
const uniformiStanza = {
  tAgx: { value: null }, tB: { value: null }, tT: { value: null }, tR0: { value: null }, tR1: { value: null }, tStri: { value: null }, tIns: { value: null }, tMuro: { value: null }, tCarta: { value: null }, tGrad: { value: null },
  uC0: { value: new THREE.Color() }, uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uIns: { value: new THREE.Color(0, 0, 0) }, uMuro: { value: new THREE.Color() },
  uBase: { value: 1 }, uLed: { value: 1 }, uAlpha: { value: 1 }, uGrana: { value: 0.011 }, uSeme: { value: 0 }, uNero: { value: 0.03 }, uLogR: { value: new THREE.Vector4() }, uEsp: { value: 1 }, uCarta: { value: 0.82 }, uTela: { value: 1 }, uSlabVP: { value: new THREE.Matrix4() }, uStri: { value: new THREE.Vector2(0, 1) }, // uEsp: l'esposizione della camera (camera.json; ?esp= per provarne un'altra)
};
function materialeNastro(colore, piu = 0) {
  return new THREE.ShaderMaterial({
    uniforms: { ...uniformiStanza, uColore: { value: new THREE.Color(colore) }, uColoreCasa: { value: new THREE.Color(colore) }, uOpacitaCasa: { value: 1 }, uLargoCasa: { value: 0.45 }, uOpacita: { value: 1 }, uLuce: { value: 1 }, uSchermo: { value: schermo }, uPiu: { value: piu }, uScala: scalaPx, uModo: { value: 0 } },
    vertexShader: `
      attribute vec3 normale; attribute float lato; attribute vec2 largo; // largo: px minimi, larghezza nel mondo
      uniform vec2 uSchermo; uniform float uPiu; uniform float uScala; uniform mat4 uSlabVP; uniform float uModo, uLargoCasa;
      varying vec4 vClip; varying float vLato;
      void main() {
        vec4 c = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        float pxUnita = projectionMatrix[1][1] * uSchermo.y * 0.5 / c.w;        // px per unità del mondo a questa profondità
        float w = (max(largo.x * uScala / pxUnita, largo.y) + uPiu / pxUnita) * mix(1.0, uLargoCasa, uModo); // in casa: la riga di un pennarello
        vLato = lato;
        vec4 p = modelMatrix * vec4(position + normale * lato * w * 0.5, 1.0);
        vClip = uSlabVP * p;
        gl_Position = projectionMatrix * viewMatrix * p;
      }`,
    fragmentShader: GLSL_STANZA + `
      uniform vec3 uColore, uColoreCasa; uniform float uOpacita, uOpacitaCasa; uniform float uLuce; uniform float uModo;
      varying vec4 vClip; varying float vLato;
      void main() {
        if (uModo > 0.001) { // in casa (1) e mentre ci si china (da 1 a 0): l'inchiostro sulla carta diventa il nastro della giornata
          vec2 uv = slabUV(vClip);
          float bordo = 1.0 - smoothstep(0.15, 1.0, abs(vLato));   // l'inchiostro sfuma nella carta: niente bordo a gradini (critico 4)
          gl_FragColor = vec4(agx(luceStanza(uv) * uColoreCasa * 0.9), uOpacitaCasa * bordo * texture2D(tCarta, uv).r);
          ${FINE_CASA}
          vec3 g = uColore * uLuce; g = mix(g * 12.92, 1.055 * pow(max(g, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, g));
          gl_FragColor = mix(vec4(g, uOpacita), gl_FragColor, uModo);
        } else {
          gl_FragColor = vec4(uColore * uLuce, uOpacita);
          #include <colorspace_fragment>
        }
      }`,
    transparent: true, depthWrite: false, depthTest: false, toneMapped: false, side: THREE.DoubleSide,
  });
}
// polilinee (punti nel mondo della piastra, sul piano) -> un nastro solo; px e metri per linea
function geoNastro(linee) {
  const pos = [], nor = [], lat = [], lar = [], idx = [];
  let n = 0;
  for (const { punti, px, metri } of linee) {
    const P = punti.filter((p, i) => i === 0 || p.distanceToSquared(punti[i - 1]) > 1e-14);
    if (P.length < 2) continue;
    const dir = P.slice(1).map((p, i) => { const d = p.clone().sub(P[i]); d.y = 0; return d.normalize(); });
    P.forEach((p, i) => {
      const a = dir[Math.max(0, i - 1)], b = dir[Math.min(dir.length - 1, i)];
      const t = a.clone().add(b); if (t.lengthSq() < 1e-9) t.copy(b); t.normalize();
      const perp = new THREE.Vector3(-t.z, 0, t.x), cosMezzo = Math.max(0.35, Math.abs(perp.dot(new THREE.Vector3(-b.z, 0, b.x))));
      perp.divideScalar(cosMezzo); // mitra: lo spigolo resta largo uguale, con un limite sulle curve strette
      for (const s of [1, -1]) { pos.push(p.x, p.y, p.z); nor.push(perp.x, 0, perp.z); lat.push(s); lar.push(px, metri); }
      if (i + 1 < P.length) idx.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
      n += 2;
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normale', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('lato', new THREE.Float32BufferAttribute(lat, 1));
  g.setAttribute('largo', new THREE.Float32BufferAttribute(lar, 2));
  g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10); // sempre dentro: la piastra è piccola
  return g;
}

// ---------- il mondo ----------
// parete: { copertine: [url, ...] } = le sue foto, nella disposizione della sua stanza (al massimo nove; i posti in più restano muro);
// { colore?, tessere: [{ url, col, row }] } = una parete composta sul poster shop; { tessere: [] } o null = parete vuota
export async function creaMondo(tela, giro, parete = null) {
  const r = new THREE.WebGLRenderer({ canvas: tela, antialias: true, alpha: true, powerPreference: 'high-performance' });
  r.setPixelRatio(Math.min(devicePixelRatio, 2));
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping; // la giornata; la casa fa la sua AgX nello shader (come il render)
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
  r.shadowMap.autoUpdate = false; // le ombre si rifanno solo a camera ferma (vedi ciclo): in volo non costano niente
  let ombraSporca = true, camMossa = true;
  const scena = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 40);

  // la piastra: metri veri (x est, y nord) -> mondo, con la stessa proiezione dello script
  const [lat0, lon0] = giro.piastra.centro;
  const K = LATO / giro.piastra.lato;      // unità del mondo per metro
  const metri = sinusoidale(lat0, lon0);
  const sulPiano = (x, y, su = 0) => new THREE.Vector3(x * K, PIANO + su * K, -y * K);           // dentro la piastra
  const nelMondo = (x, y, su = 0) => sulPiano(x, y, su).add(new THREE.Vector3(0, 0, PIASTRA_Z));  // nella scena: sul tavolo

  // ---------- la stanza fotografata: camera e geometria del render, le lastre ----------
  const caricatore = new THREE.TextureLoader();
  const lastra = async (nome, grigio = false) => {
    const t = await caricatore.loadAsync(LASTRE + nome);
    t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = false; t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    if (grigio) { t.format = THREE.RedFormat; t.internalFormat = 'R8'; }
    return t;
  };
  const tex = async (nome, { srgb = false, rip = [1, 1] } = {}) => {
    const t = await caricatore.loadAsync(TEX + nome);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...rip); t.anisotropy = 8;
    return t;
  };
  const [ST, LJ, tB, tT, tR0, tR1, tStri, tMuro, tCarta, tavC, tavN, tavR, hdr] = await Promise.all([
    prendi(STANZA + 'camera.json'), prendi(LASTRE + 'lastre.json'),
    lastra('base.webp'), lastra('led.webp'), lastra('led0.webp', true), lastra('led1.webp', true), lastra('striscia.webp', true), lastra('muro.webp', true), lastra('carta.webp', true),
    tex('tavolo-colore.jpg', { srgb: true, rip: [2, 1.6] }), tex('tavolo-normali.jpg', { rip: [2, 1.6] }), tex('tavolo-rugosita.jpg', { rip: [2, 1.6] }),
    new HDRLoader().loadAsync(TEX + 'stanza-512.hdr')]);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  { const pm = new THREE.PMREMGenerator(r); scena.environment = pm.fromEquirectangular(hdr).texture; hdr.dispose(); pm.dispose(); }
  const [WS, HS] = ST.lastra;
  { const V = LJ.codifica.VMAX, r = v => Math.log2(1 + v / LJ.codifica.K); uniformiStanza.uLogR.value.set(r(V.base), r(V.led), r(V.striscia), r(V.insegna)); }
  { // la tabella AgX di Blender: 1089x33 px (r + 33 b, g) -> una texture 3D 33x33x33
    const img = new Image(); img.src = STANZA + 'agx.png'; await img.decode();
    const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }), g = c.getContext('2d', { colorSpace: 'srgb' });
    g.drawImage(img, 0, 0); const px = g.getImageData(0, 0, img.width, img.height).data, N = 33, d = new Uint8Array(N * N * N * 4);
    for (let b = 0; b < N; b++) for (let gg = 0; gg < N; gg++) for (let rr = 0; rr < N; rr++) { const i = ((b * N + gg) * N + rr) * 4, j = (gg * img.width + rr + N * b) * 4; d[i] = px[j]; d[i + 1] = px[j + 1]; d[i + 2] = px[j + 2]; d[i + 3] = 255; }
    const t = new THREE.Data3DTexture(d, N, N, N); t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping; t.unpackAlignment = 1; t.needsUpdate = true;
    uniformiStanza.tAgx.value = t;
  }
  const occhio = new THREE.Vector3(...ST.camera.occhio), guardato = new THREE.Vector3(...ST.camera.guarda);
  const F_PX = HS / 2 / Math.tan(ST.camera.fov_v / 2 * G);         // focale in px di lastra
  // la camera del render, in three.js: proietta il mondo nelle coordinate della lastra
  const camLastra = new THREE.PerspectiveCamera(ST.camera.fov_v, WS / HS, 0.05, 40);
  camLastra.position.copy(occhio); camLastra.lookAt(guardato); camLastra.updateMatrixWorld();
  uniformiStanza.uSlabVP.value.multiplyMatrices(camLastra.projectionMatrix, camLastra.matrixWorldInverse);
  Object.assign(uniformiStanza, { tB: { value: tB }, tT: { value: tT }, tR0: { value: tR0 }, tR1: { value: tR1 }, tStri: { value: tStri }, tMuro: { value: tMuro }, tCarta: { value: tCarta }, tIns: { value: tB } });
  const MURO = ST.muro, AREA_POSTER = { x0: MURO.poster.x0, y0: MURO.poster.y0, w: MURO.poster.w, h: MURO.poster.y0 - MURO.poster.y1 };
  uniformiStanza.uMuro.value.set(parete?.colore ?? MURO.colore);
  uniformiStanza.uEsp.value = +(QS.get('esp') ?? 2 ** (ST.camera.esposizione_stop ?? Math.log2(0.45)));
  const slab = v => { const p = v.clone().applyMatrix4(uniformiStanza.uSlabVP.value); return new THREE.Vector2(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5); };
  const S = MURO.striscia;
  uniformiStanza.uStri.value.set(slab(new THREE.Vector3(S.x0, S.y, S.z)).x, slab(new THREE.Vector3(S.x1, S.y, S.z)).x);
  // la sfumatura della striscia, punto per punto (64 colori, aggiornata a ogni giro dei LED)
  const NG = 64, grad = new THREE.DataTexture(new Uint8Array(NG * 4).fill(255), NG, 1);
  grad.colorSpace = THREE.NoColorSpace; grad.minFilter = grad.magFilter = THREE.LinearFilter; grad.needsUpdate = true;
  uniformiStanza.tGrad.value = grad;
  const puntiStriscia = Array.from({ length: NG }, (_, i) => new THREE.Vector3(S.x0 + (S.x1 - S.x0) * (i + 0.5) / NG, S.y, S.z));
  const centriLed = [0, 1, 2].map(i => new THREE.Vector3(S.x0 + (S.x1 - S.x0) * (i + 0.5) / 3, S.y, S.z));

  // il fondo: tutta la lastra, presa lungo il raggio di ogni pixel (esatta finché la camera non si sposta: in casa e mentre si china)
  const mFondo = new THREE.ShaderMaterial({
    uniforms: { ...uniformiStanza, uInvVP: { value: new THREE.Matrix4() }, uOcchio: { value: new THREE.Vector3() } },
    vertexShader: 'varying vec2 vNdc; void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: GLSL_STANZA + `
      uniform mat4 uInvVP; uniform vec3 uOcchio; varying vec2 vNdc;
      void main() {
        vec4 w = uInvVP * vec4(vNdc, 1.0, 1.0);
        vec2 uv = slabUV(uSlabVP * vec4(w.xyz / w.w - uOcchio, 0.0));
        vec3 s = luceStanza(uv);
        float t = clamp((uv.x - uStri.x) / (uStri.y - uStri.x), 0.0, 1.0);
        s += uEsp * uLed * dec1(texture2D(tStri, uv).r, uLogR.z) * texture2D(tGrad, vec2(t, 0.5)).rgb;  // il diffusore acceso, col colore del punto
        float mu = texture2D(tMuro, uv).r, ca = texture2D(tCarta, uv).r;
        s *= mix(vec3(1.0), uMuro, mu) * mix(1.0, uCarta, ca);  // la vernice del muro; la carta (sotto la mappa) non è bianco puro
        gl_FragColor = vec4(agx(s), uAlpha);
        ${FINE_CASA}
      }`,
    depthTest: false, depthWrite: false, transparent: true, toneMapped: false });
  const scenaFondo = new THREE.Scene(), camFondo = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fondo = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mFondo); fondo.frustumCulled = false; scenaFondo.add(fondo);

  // luci (per la giornata e la scheda: la casa ha la sua luce nella lastra): la stanza (HDRI), un emisfero e il sole, la lampada
  const cielo = new THREE.HemisphereLight(0xffffff, 0x8a6e4a, 1);
  const sole = new THREE.DirectionalLight(0xffffff, 2);
  sole.castShadow = true; sole.shadow.mapSize.set(1024, 1024); sole.shadow.radius = 4; // 1024: la mappa d'ombra costa 8 MB invece di 32 (colore + profondità)
  const lampada = new THREE.SpotLight(0xffc690, 1, 0, 0.5, 0.85, 2); // calda, 2700 K circa
  lampada.position.set(-0.95, 1.75, 1.75); lampada.target.position.set(0.05, 0, PIASTRA_Z + 0.05);
  scena.add(cielo, sole, sole.target, lampada, lampada.target);

  // materiali
  const mTiglio = new THREE.MeshStandardMaterial({ color: 0xe2dac6, roughness: 0.9 }); // la carta stampata della mappa
  const mTiglioLato = new THREE.MeshStandardMaterial({ color: 0xf3f1eb, roughness: 0.92 });  // il bordo del cartone piuma
  const mCasa = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });        // i centri in cartoncino bianco
  const BIANCO = new THREE.Color(0xfffdf8), BRUNO = new THREE.Color(0x8d8476); // da lontano gli edifici più scuri: il centro abitato si legge come una macchia
  const mBlu = new THREE.MeshStandardMaterial({ color: 0x5a71d6, roughness: 0.78, emissive: 0x22378a, emissiveIntensity: 0.25 });
  const mBase = new THREE.MeshStandardMaterial({ color: 0xf2efe9, roughness: 0.95 });
  const mScrivania = new THREE.MeshStandardMaterial({ map: tavC, normalMap: tavN, roughnessMap: tavR, roughness: 1, normalScale: new THREE.Vector2(0.7, 0.7) });
  // la carta in casa: la stampa del giorno per la luce della stanza; dove nel render qualcosa sta sopra il cartone, si vede quello
  const mCartaCasa = new THREE.ShaderMaterial({
    uniforms: { ...uniformiStanza, map: { value: null } },
    vertexShader: 'uniform mat4 uSlabVP; varying vec2 vUv; varying vec4 vClip; void main() { vUv = uv; vec4 p = modelMatrix * vec4(position, 1.0); vClip = uSlabVP * p; gl_Position = projectionMatrix * viewMatrix * p; }',
    fragmentShader: GLSL_STANZA + `
      uniform sampler2D map; varying vec2 vUv; varying vec4 vClip;
      void main() {
        vec2 uv = slabUV(vClip);
        gl_FragColor = vec4(agx(luceStanza(uv) * mix(vec3(1.0), texture2D(map, vUv).rgb, uTela) * uCarta), texture2D(tCarta, uv).r * uAlpha);
        ${FINE_CASA}
      }`,
    transparent: true, depthWrite: false, toneMapped: false });
  const mNulla = new THREE.MeshBasicMaterial({ visible: false });
  Object.entries({ mTiglio, mTiglioLato, mCasa, mBlu, mBase, mScrivania, mCartaCasa, mFondo }).forEach(([n, m]) => { m.name = n; }); // nei programmi compilati si legge di chi sono

  // il tavolo (in giornata, intorno alla mappa; in casa c'è quello del render)
  const scrivania = new THREE.Mesh(new THREE.BoxGeometry(5, 0.05, 4), mScrivania);
  scrivania.position.set(0, -0.025, MURO.z + 2); scrivania.receiveShadow = true;
  scena.add(scrivania);

  // ---------- i poster: sul muro del render, con la luce che arriva lì; un'ombra morbida sotto ognuno ----------
  // di base: cinque in alto e quattro più grandi sotto; [x, y, larghezza, altezza] in frazioni dell'area, gradi di piega
  const COLLAGE = [
    [0.0, 0.0, 0.17, 0.355, -1.0], [0.208, 0.012, 0.17, 0.355, 0.7], [0.416, 0.0, 0.17, 0.355, -0.5], [0.624, 0.01, 0.17, 0.355, 1.1], [0.832, 0.0, 0.168, 0.355, -0.8],
    [0.0, 0.41, 0.215, 0.445, 0.6], [0.262, 0.42, 0.215, 0.445, -0.9], [0.524, 0.41, 0.215, 0.445, 0.5], [0.786, 0.42, 0.214, 0.445, -0.6],
  ];
  // una parete composta sul poster shop (app/parete.js, costruisciMuro): griglia col/row, tessere 0,65 larghe/alte, suo colore
  const composta = (p, larga, alta) => {
    const cols = p.tessere.map(t => t.col), rows = p.tessere.map(t => t.row);
    const c0 = Math.min(...cols), r0 = Math.min(...rows), nc = Math.max(...cols) - c0 + 1, nr = Math.max(...rows) - r0 + 1;
    const gx = 0.03, gy = gx * larga / alta;
    const w = Math.min((1 - gx * (nc - 1)) / nc, ((1 - gy * (nr - 1)) / nr) * 0.65 * alta / larga), hh = w / 0.65 * larga / alta;
    const x0 = (1 - (nc * w + (nc - 1) * gx)) / 2, y0 = (1 - (nr * hh + (nr - 1) * gy)) / 2;
    const pieghe = [-1.0, 0.7, -0.5, 1.1, -0.8, 0.6, -0.9, 0.5, -0.6];
    return p.tessere.map((t, k) => [x0 + (t.col - c0) * (w + gx), y0 + (t.row - r0) * (hh + gy), w, hh, pieghe[k % pieghe.length], t.url]);
  };
  const posti = Array.isArray(parete?.tessere) ? (parete.tessere.length ? composta(parete, AREA_POSTER.w, AREA_POSTER.h) : [])
    : (parete?.copertine ?? []).slice(0, COLLAGE.length).map((url, k) => [...COLLAGE[k], url]);
  // le copertine che WebGL non può leggere (Comic Vine non manda CORS): in WebGL resta la carta bianca illuminata dalla stanza, e la
  // copertina sta sopra il canvas come <img> con mix-blend-mode multiply (carta illuminata × immagine = colore × luce: anche i LED
  // ci cadono sopra), messa a ogni fotogramma sui quattro angoli proiettati, dentro il passe-partout. ?copertine-dom=1: tutte così (misure)
  const sopraTela = [], TUTTE_DOM = QS.get('copertine-dom') === '1';
  const poster = new THREE.Group(); scena.add(poster);
  const COC = ST.coc_px.muro; // il cerchio di confusione sul muro (px di lastra): la carta dei poster è sfocata come il muro
  const cocSchermo = { value: COC }; // lo stesso in px dello schermo (si aggiorna in misura)
  const vsMuro = 'uniform mat4 uSlabVP; varying vec2 vUv; varying vec4 vClip; void main() { vUv = uv; vec4 p = modelMatrix * vec4(position, 1.0); vClip = uSlabVP * p; gl_Position = projectionMatrix * viewMatrix * p; }';
  // la luce sulla carta del poster: media di cinque punti (la carta non segue il rilievo dell'intonaco)
  const LUCE_LISCIA = `vec3 luceLiscia(vec2 uv) { vec2 d = 2.5 / vec2(${WS}.0, ${HS}.0);
    return (2.0 * luceStanza(uv) + luceStanza(uv + vec2(d.x, 0.0)) + luceStanza(uv - vec2(d.x, 0.0)) + luceStanza(uv + vec2(0.0, d.y)) + luceStanza(uv - vec2(0.0, d.y))) / 6.0; }`;
  const posterPronti = Promise.all(posti.map(async ([x, y, w, h, rot, url], k) => {
    const W = w * AREA_POSTER.w, H = h * AREA_POSTER.h;
    const img = await copertina(url);
    if (!img) return; // non si decodifica nemmeno la seconda volta: quel posto resta muro
    const c = Object.assign(document.createElement('canvas'), { width: 192, height: Math.round(192 * H / W) }); // ~1,5 texel per px del telefono a 390
    const g = c.getContext('2d'), b = Math.round(c.width * 0.045);
    g.fillStyle = '#f5f1e8'; g.fillRect(0, 0, c.width, c.height);
    const iw = c.width - 2 * b, ih = c.height - 2 * b, kk = Math.max(iw / img.naturalWidth, ih / img.naturalHeight);
    const nelDom = TUTTE_DOM || sporca(img);
    if (!nelDom) {
      // la profondità di campo del render: il poster sfocato quanto il muro (COC px di lastra, in px di questa tela)
      const pxTela = c.width / (W * WS * 0.92 / MURO.poster.w); // px di tela per px di lastra (l'area dei poster è larga 0,92 della lastra)
      g.filter = `blur(${(COC / 2.4 * pxTela).toFixed(2)}px)`;
      g.drawImage(img, (img.naturalWidth - iw / kk) / 2, 0, iw / kk, ih / kk, b, b, iw, ih); // il titolo in alto resta
    } else {
      Object.assign(img.style, { position: 'fixed', left: '0', top: '0', width: '100px', height: `${(100 * ih / iw).toFixed(2)}px`, objectFit: 'cover', objectPosition: 'top',
        transformOrigin: '0 0', mixBlendMode: 'multiply', pointerEvents: 'none', opacity: '0' });
      img.setAttribute('aria-hidden', 'true'); img.className = 'copertina-sopra';
      tela.after(img);
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    const mP = new THREE.ShaderMaterial({
      uniforms: { ...uniformiStanza, tCop: { value: t }, uCoc: cocSchermo }, vertexShader: vsMuro,
      fragmentShader: GLSL_STANZA + LUCE_LISCIA + `
        uniform sampler2D tCop; uniform float uCoc; varying vec2 vUv; varying vec4 vClip;
        void main() {
          vec2 uv = slabUV(vClip);
          vec2 d = min(vUv, 1.0 - vUv) / max(fwidth(vUv), vec2(1e-6));
          float bordo = smoothstep(0.0, max(uCoc, 1.0), min(d.x, d.y));   // il bordo della carta, morbido come il muro
          gl_FragColor = vec4(agx(luceLiscia(uv) * texture2D(tCop, vUv).rgb * 0.88), bordo * texture2D(tMuro, uv).r * uAlpha);
          ${FINE_CASA}
        }`,
      transparent: true, depthWrite: false, depthTest: false, toneMapped: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mP);
    m.position.set(AREA_POSTER.x0 + (x + w / 2) * AREA_POSTER.w, AREA_POSTER.y0 - (y + h / 2) * AREA_POSTER.h, MURO.z + 0.004 + k * 0.0004);
    m.rotation.z = rot * Math.PI / 180; m.renderOrder = 21;
    // l'ombra: la carta sta a qualche millimetro dal muro, la luce viene dall'alto (LED) e da sinistra (lampada)
    const OM = 0.03, mO = new THREE.ShaderMaterial({
      uniforms: { ...uniformiStanza, uDim: { value: new THREE.Vector2(W, H) }, uM: { value: OM } }, vertexShader: vsMuro,
      fragmentShader: GLSL_STANZA + `
        uniform vec2 uDim; uniform float uM; varying vec2 vUv; varying vec4 vClip;
        void main() {
          vec2 uv = slabUV(vClip);
          vec2 p = (vUv - 0.5) * (uDim + 2.0 * uM) - vec2(0.0, -0.008);   // in unità: la luce che domina è la striscia sopra, l'ombra cade sotto (critico 5)
          vec2 q = max(abs(p) - uDim * 0.5, 0.0);
          float ombra = 1.0 - smoothstep(0.0, 0.016, length(q));
          gl_FragColor = vec4(agx(luceStanza(uv) * uMuro * (1.0 - 0.5 * ombra)), ombra * texture2D(tMuro, uv).r * uAlpha);
          ${FINE_CASA}
        }`,
      transparent: true, depthWrite: false, depthTest: false, toneMapped: false });
    const o = new THREE.Mesh(new THREE.PlaneGeometry(W + 2 * OM, H + 2 * OM), mO);
    o.position.copy(m.position).z -= 0.002; o.rotation.z = m.rotation.z; o.renderOrder = 20;
    poster.add(o, m);
    if (nelDom) sopraTela.push({ img, m, w: 100, h: 100 * ih / iw, bx: b / c.width, by: b / c.height });
  }));
  // a ogni fotogramma: la copertina sopra la tela segue i quattro angoli dentro il passe-partout; nei voli svanisce con la stanza
  const angolo = new THREE.Vector3();
  const sopraTelaAlPosto = () => {
    for (const p of sopraTela) {
      if (uCasa <= 0) { p.img.style.opacity = '0'; continue; }
      const { width: W_, height: H_ } = p.m.geometry.parameters;
      const q = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => proietta(angolo.set(sx * W_ * (0.5 - p.bx), sy * H_ * (0.5 - p.by), 0).applyMatrix4(p.m.matrixWorld)));
      p.img.style.transform = matrice3d(p.w, p.h, q); p.img.style.opacity = String(uCasa);
    }
  };

  // ---------- la piastra: la geografia vera ----------
  const piastra = new THREE.Group();
  piastra.position.set(0, 0, PIASTRA_Z); // appoggiata in piano sul tavolo
  scena.add(piastra);
  const base = new THREE.Mesh(new THREE.BoxGeometry(LATO + 0.02, BASE, LATO + 0.02), mBase);
  base.position.y = BASE / 2; base.castShadow = base.receiveShadow = true;
  const materialiFoglio = [mTiglioLato, mTiglioLato, mTiglio, mTiglio, mTiglioLato, mTiglioLato], materialiFoglioCasa = [mNulla, mNulla, mCartaCasa, mNulla, mNulla, mNulla];
  const foglio = new THREE.Mesh(new THREE.BoxGeometry(LATO, TIGLIO, LATO), materialiFoglio);
  foglio.position.y = BASE + TIGLIO / 2; foglio.receiveShadow = true;
  piastra.add(base, foglio);

  // i dati: rete principale della piastra e un pacchetto per comune del giro
  const comuni = giro.comuni; // chiavi, nell'ordine del giro
  const [rete, ...pacchi] = await Promise.all([prendi(`${DATI}rete.json`), ...comuni.map(k => prendi(`${DATI}comuni/${k.replace(/ /g, '_')}.json`))]);
  const pacco = Object.fromEntries(comuni.map((k, i) => [k, pacchi[i]]));

  // la rete principale: due nastri (autostrade e superstrade più scure, le altre più chiare)
  const linee = (lista, su) => lista.map(v => spiana(v)).map(p => p.map(([x, y]) => sulPiano(x, y, su)));
  const perClasse = [[], [], []];
  for (const l of rete.linee) perClasse[Math.max(0, l[0] - 1)].push({ punti: linee([l.slice(1)], 0.3)[0], px: [2.2, 1.9, 1.35, 0.9][l[0]], metri: [24, 18, 12, 9][l[0]] * K });
  const mRete = ['#a2947d', '#b9ad98', '#c9bfad'].map(c => materialeNastro(c)); // autostrade e superstrade, primarie, secondarie
  const reti = perClasse.map((l, i) => Object.assign(new THREE.Mesh(geoNastro(l), mRete[i]), { renderOrder: 3 - i }));
  // (i nastri della rete restano per le misure ma non si disegnano: la rete è stampata nella carta, vedi «stampa»)

  // i comuni: edifici estrusi (una mesh per comune) e vie col loro nome
  const comune = {}, impronte = [];
  for (const k of comuni) {
    const pk = pacco[k];
    const [cx, cy] = metri(...pk.centro);
    // il pacchetto ha metri dal SUO centro (proiezione centrata lì): si torna a lat/lon e si proietta sulla piastra
    const daPacco = inversa(...pk.centro);
    const qui = ([x, y]) => metri(...daPacco(x, y));
    const pos = [], nor = [], uv = [];
    const U = 1 / 60; // una venatura ogni ~60 m
    let senzaDato = 0;
    for (const e of pk.edifici) {
      const h = e[0] || ALTEZZA_SENZA_DATO; if (!e[0]) senzaDato++;
      const anelli = e.slice(1).map(v => spiana(v).map(qui));
      impronte.push(anelli[0]);
      if (areaFirmata(anelli[0]) < 0) anelli[0].reverse();             // esterno antiorario
      for (const b of anelli.slice(1)) if (areaFirmata(b) > 0) b.reverse(); // buchi orari
      const y0 = PIANO, y1 = PIANO + h * K;
      for (const a of anelli) for (let i = 0; i < a.length; i++) {
        const [px, py] = a[i], [qx, qy] = a[(i + 1) % a.length];
        const dx = qx - px, dy = qy - py, L = Math.hypot(dx, dy) || 1;
        const P0 = [px * K, y0, -py * K], Q0 = [qx * K, y0, -qy * K], Q1 = [qx * K, y1, -qy * K], P1 = [px * K, y1, -py * K];
        for (const v of [P0, Q0, Q1, P0, Q1, P1]) { pos.push(...v); nor.push(dy / L, 0, dx / L); }
        const u0 = (px + py) * U, u1 = (qx + qy) * U;
        uv.push(u0, 0, u1, 0, u1, h * U, u0, 0, u1, h * U, u0, h * U);
      }
      const tri = THREE.ShapeUtils.triangulateShape(anelli[0].map(([x, y]) => new THREE.Vector2(x, y)), anelli.slice(1).map(b => b.map(([x, y]) => new THREE.Vector2(x, y))));
      const tutti = anelli.flat();
      for (let [a, b, c] of tri) {
        if (areaFirmata([tutti[a], tutti[b], tutti[c]]) < 0) [b, c] = [c, b];
        for (const j of [a, b, c]) { const [x, y] = tutti[j]; pos.push(x * K, y1, -y * K); nor.push(0, 1, 0); uv.push(x * U, y * U); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const edifici = new THREE.Mesh(g, mCasa);
    edifici.receiveShadow = true;
    piastra.add(edifici);
    // le vie del comune: si vedono solo da vicino
    const vie = pk.vie.map(v => ({ classe: v[0], nome: v[1] >= 0 ? pk.nomi[v[1]] : '', punti: spiana(v.slice(2)).map(qui) }));
    const mVie = materialeNastro('#a39885');
    const nastroVie = new THREE.Mesh(geoNastro(vie.map(v => ({ punti: v.punti.map(([x, y]) => sulPiano(x, y, 0.3)), px: v.classe <= 4 ? 1.3 : 0.8, metri: VIA_M[v.classe] * K }))), mVie);
    nastroVie.renderOrder = 1; nastroVie.visible = false;
    piastra.add(nastroVie);
    // i nomi da scrivere: prima le vie più importanti (classe), poi le più lunghe, entro 450 m dal centro
    const perNome = new Map();
    for (const v of vie) {
      if (!v.nome) continue;
      const lungo = v.punti.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - v.punti[i - 1][0], p[1] - v.punti[i - 1][1]) : 0), 0);
      const vicino = Math.min(...v.punti.map(([x, y]) => Math.hypot(x - cx, y - cy)));
      const n = perNome.get(v.nome) ?? { nome: v.nome, classe: v.classe, lungo: 0, vicino: Infinity, pezzi: [] };
      n.classe = Math.min(n.classe, v.classe); n.lungo += lungo; n.vicino = Math.min(n.vicino, vicino);
      n.pezzi.push(v.punti);
      perNome.set(v.nome, n);
    }
    // OSM spezza una via in tanti tratti (a ogni incrocio): si ricuciono quelli che si toccano, per scriverci sopra il nome
    const uguale = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1.5;
    for (const n of perNome.values()) {
      const pz = n.pezzi.map(p => [...p]);
      for (let unito = true; unito;) {
        unito = false;
        for (let i = 0; i < pz.length && !unito; i++) for (let j = 0; j < pz.length && !unito; j++) {
          if (i === j) continue;
          const A = pz[i], B = pz[j];
          if (uguale(A.at(-1), B[0])) pz[i] = A.concat(B.slice(1));
          else if (uguale(A.at(-1), B.at(-1))) pz[i] = A.concat([...B].reverse().slice(1));
          else if (uguale(A[0], B[0])) pz[i] = [...A].reverse().concat(B.slice(1));
          else continue;
          pz.splice(j, 1); unito = true;
        }
      }
      n.pezzi = pz.map(p => p.map(([x, y]) => nelMondo(x, y, 0.3)));
    }
    const nomi = [...perNome.values()].filter(n => n.vicino < 350).sort((a, b) => (Math.min(a.classe, 5) - Math.min(b.classe, 5)) || b.lungo - a.lungo).slice(0, 16);
    comune[k] = { edifici, nastroVie, mVie, centro: [cx, cy], nomi, senzaDato, quanti: pk.edifici.length, pk };
  }

  // la stampa: strade principali e impronte degli edifici disegnate una volta nella carta (1536 px per i 38 km della piastra:
  // nella giornata ~1,2 texel per px del telefono; 2048 costava 22 MB di memoria grafica, 1536 ne costa 12,6).
  // Così l'inchiostro è carta più scura e prende la luce come lei; il percorso resta un nastro sopra (il pennarello)
  {
    const N = 1536, c = Object.assign(document.createElement('canvas'), { width: N, height: N }), g = c.getContext('2d');
    const px = ([x, y]) => [(x / giro.piastra.lato + 0.5) * N, (0.5 - y / giro.piastra.lato) * N];
    g.fillStyle = '#fff'; g.fillRect(0, 0, N, N);
    g.fillStyle = '#b9b0a2';
    for (const a of impronte) { g.beginPath(); a.forEach((p, i) => g[i ? 'lineTo' : 'moveTo'](...px(p))); g.fill(); }
    g.lineCap = g.lineJoin = 'round';
    for (const c_ of [3, 2, 1, 0]) {
      g.strokeStyle = ['#544c41', '#625a4d', '#7a7062', '#90877a'][c_]; g.lineWidth = [4.2, 3.4, 2.4, 1.7][c_] * N / 2048;
      g.beginPath();
      for (const l of rete.linee) if (l[0] === c_) spiana(l.slice(1)).forEach((p, i) => g[i ? 'lineTo' : 'moveTo'](...px(p)));
      g.stroke();
    }
    // le strade che il giro percorre (OSRM le segue, sono vere): stampate come le minori, così il pennarello ripassa una strada
    // della carta e non taglia il bianco (critico 3: «sembra una traccia GPS incollata sopra»)
    g.strokeStyle = '#90877a'; g.lineWidth = 1.5 * N / 2048; g.beginPath();
    for (const tr of giro.tratti) spiana(tr.linea).forEach((p, i) => g[i ? 'lineTo' : 'moveTo'](...px(p)));
    g.stroke();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    mTiglio.map = t; mTiglio.needsUpdate = true; mCartaCasa.uniforms.map.value = t;
  }

  // il percorso vero: un nastro per tratto (OSRM, da centro a centro)
  const tappe = giro.tappe.map(t => ({ ...t, xy: metri(...t.centro) }));
  const tratti = giro.tratti.map(t => {
    const punti = spiana(t.linea);
    const m = materialeNastro('#3d3125'), mBordo = materialeNastro('#fffaf0', 2.5);
    const geo = geoNastro([{ punti: punti.map(([x, y]) => sulPiano(x, y, 1)), px: 4, metri: 12 * K }]);
    const nastro = new THREE.Mesh(geo, m), bordo = new THREE.Mesh(geo, mBordo);
    nastro.renderOrder = 6; bordo.renderOrder = 5;
    piastra.add(bordo, nastro);
    // lunghezza progressiva, per trovare il mezzo del tratto
    const cum = [0]; for (let i = 1; i < punti.length; i++) cum.push(cum[i - 1] + Math.hypot(punti[i][0] - punti[i - 1][0], punti[i][1] - punti[i - 1][1]));
    return { ...t, punti, cum, nastro, bordo, m, mBordo };
  });
  // i nomi dei comuni del giro stampati sulla carta, come su una carta stradale (critici 2 e 4: «nessun nome di paese»). Solo in
  // casa, dove la carta è una foto: nella giornata i nomi li dicono già i cartellini. Prendono la luce della stanza come l'inchiostro.
  const nomiStampati = new THREE.Group(); piastra.add(nomiStampati);
  try { await document.fonts.load('600 52px DINish'); } catch { /* resta il carattere di riserva */ }
  const A_SINISTRA = new Set(['BUSTO ARSIZIO', 'FAGNANO OLONA']); // a destra del punto passa il percorso
  for (const t of tappe) {
    const c = Object.assign(document.createElement('canvas'), { width: 512, height: 72 }), g = c.getContext('2d');
    g.font = '600 52px DINish, sans-serif'; const lw = Math.min(508, g.measureText(t.comune).width + 4);
    g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(t.comune, 2, 38);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = 4;
    const H = 0.018, W = H * 512 / 72, sx = A_SINISTRA.has(t.chiave) ? -1 : 1;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.ShaderMaterial({
      uniforms: { ...uniformiStanza, tNome: { value: tex } },
      vertexShader: 'uniform mat4 uSlabVP; varying vec2 vUv; varying vec4 vClip; void main() { vUv = uv; vec4 p = modelMatrix * vec4(position, 1.0); vClip = uSlabVP * p; gl_Position = projectionMatrix * viewMatrix * p; }',
      fragmentShader: GLSL_STANZA + `uniform sampler2D tNome; varying vec2 vUv; varying vec4 vClip;
        void main() { vec2 uv = slabUV(vClip); gl_FragColor = vec4(agx(luceStanza(uv) * vec3(0.20, 0.19, 0.17) * 0.9), texture2D(tNome, vUv).r * 0.9 * texture2D(tCarta, uv).r * uAlpha);
          ${FINE_CASA} }`,
      transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
    m.rotation.x = -Math.PI / 2; m.renderOrder = 4;
    const p = sulPiano(...t.xy, 0.3); // il nome comincia 1 km a destra del punto (o finisce 1 km a sinistra)
    // la scritta sta a sinistra nella tela: a destra del punto comincia a 1 km, a sinistra finisce a 1 km
    m.position.set(sx > 0 ? p.x + 0.026 + W / 2 : p.x - 0.026 - lw / 512 * W + W / 2, p.y, p.z);
    nomiStampati.add(m);
  }
  const COLORI_TRATTO = { normale: '#4a3c2c', prossimo: '#2c47c4', fatto: '#b3a790', stretta: '#e0962f' };
  // in casa il percorso è disegnato a mano sul cartone: il giro a penna nera fine, il tratto da guidare col pennarello blu che sta
  // lì accanto, quello stretto con l'evidenziatore (largo e trasparente), i tratti fatti a matita. Il marrone sulla carta calda si
  // leggeva come una bruciatura (critico 3); il blu scuro accanto al blu non si distingueva (critico 4: ΔE 14,8)
  const COLORI_CASA = { normale: '#24211e', prossimo: '#2c47c4', fatto: '#9a958c', stretta: '#f0a23a' };
  const CASA_TRATTO = { normale: [0.4, 1], prossimo: [0.62, 1], fatto: [0.36, 0.8], stretta: [1.05, 0.55] }; // larghezza (frazione), opacità
  const LARGO_TRATTO = { normale: 3.6, prossimo: 5.5, fatto: 2.6, stretta: 5 };
  let soloZona = false; // la stanza ancora da riempire: sul cartone la mappa della zona, senza percorso

  // ---------- inquadrature ----------
  // la casa: la camera del render, adattata allo schermo «a copertura» (la lastra riempie lo schermo, tagliata ai lati o in alto)
  // e alzata o abbassata perché il fondo della mappa cada 6 px sopra i tasti. Area sicura e conti: ESITO, «la stanza fotografata».
  function adatta() {
    const W = innerWidth, H = innerHeight, s = Math.max(W / WS, H / HS); // css px per px di lastra
    const ox = (W - WS * s) / 2;
    const oy = Math.min(0, Math.max(H - HS * s, H - UI_CASA - 6 - ST.area_sicura_ws.fondo_mappa * WS * s));
    return { s, ox, oy };
  }
  const pose = {
    casa: (zoom = 1, verso = null) => {
      const { s, ox, oy } = adatta(), d = occhio.distanceTo(guardato), v = occhio.clone().sub(guardato);
      let px = ox + s * WS / 2, py = oy + s * HS / 2, sz = s; // dove cade il punto guardato (l'asse ottico) e la scala
      if (zoom !== 1 && verso) { // chinarsi: la lastra avanza (zoom) e il centro della mappa va dove sarà nella giornata
        const c = slab(new THREE.Vector3(0, PIANO, PIASTRA_Z)), cx = ox + s * c.x * WS, cy = oy + s * (1 - c.y) * HS;
        px = verso.x + (px - cx) * zoom; py = verso.y + (py - cy) * zoom; sz = s * zoom;
        // la lastra deve restare a coprire lo schermo (oltre il suo bordo non c'è foto): il centro si ferma dove serve
        px = THREE.MathUtils.clamp(px, innerWidth - sz * WS / 2, sz * WS / 2); py = THREE.MathUtils.clamp(py, innerHeight - sz * HS / 2, sz * HS / 2);
      }
      return { t: guardato.clone(), d, th: Math.atan2(v.x, v.z), ph: Math.asin(v.y / d), fx: px / innerWidth, fy: py / innerHeight,
        fov: 2 * Math.atan(innerHeight / (2 * sz * F_PX)) / G, casa: true, zoom };
    },
    // la giornata: vista dall'alto (una piastra parallela allo schermo ha la stessa scala dappertutto: le distanze sono in
    // proporzione vera e la barra «5 km» vale ovunque), nord in alto, tutto il giro nello spazio libero sopra il foglio
    giornata: area => {
      const punti = tratti.flatMap(t => t.punti.filter((_, i) => i % 4 === 0).map(([x, y]) => nelMondo(x, y)));
      tappe.forEach(t => punti.push(nelMondo(...t.xy)));
      const xs = tappe.map(t => t.xy[0]), ys = tappe.map(t => t.xy[1]);
      const t = nelMondo((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2);
      return inquadra(punti, { t, th: 0, ph: Math.PI / 2, fov: 24 }, area);
    },
    // la scheda: il centro vero del comune, ~350 m per lato, un po' più inclinata per vedere gli edifici in piedi
    scheda: (k, area) => {
      const [cx, cy] = comune[k].centro;
      const punti = [[-290, 0], [290, 0], [0, -230], [0, 260]].map(([x, y]) => nelMondo(cx + x, cy + y));
      return inquadra(punti, { t: nelMondo(cx, cy), th: 0, ph: 0.8, fov: 28 }, area);
    },
  };
  let ora = pose.casa(), giro_ = 0; // giro_: quanto ha girato la piastra col dito
  const metti = (p, a = p.th + giro_) => {
    const { t, d, ph, fx, fy, fov } = p;
    cam.fov = fov; cam.aspect = innerWidth / innerHeight;
    cam.near = Math.max(0.0004, d * 0.015); cam.far = d * 6 + 6;
    cam.updateProjectionMatrix();
    cam.projectionMatrix.elements[8] = 1 - 2 * fx; // il centro dell'inquadratura va dove lo schermo è libero
    cam.projectionMatrix.elements[9] = 2 * fy - 1;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    cam.position.set(t.x + d * Math.cos(ph) * Math.sin(a), t.y + d * Math.sin(ph), t.z + d * Math.cos(ph) * Math.cos(a));
    cam.up.set(-Math.sin(ph) * Math.sin(a), Math.cos(ph), -Math.sin(ph) * Math.cos(a)); // il «su» dello schermo: verticale guardando dritto, «avanti» guardando giù
    cam.lookAt(t);
    cam.updateMatrixWorld();
  };
  const proietta = v => {
    const p = v.clone().project(cam);
    return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight, dietro: p.z > 1 };
  };
  // la distanza più vicina che fa stare tutti i punti nell'area; poi sposta il centro dell'inquadratura sul centro dell'area
  function inquadra(punti, p, area) {
    let q = { ...p, d: 1, fx: (area.x0 + area.x1) / 2 / innerWidth, fy: (area.y0 + area.y1) / 2 / innerHeight };
    for (let giro3 = 0; giro3 < 4; giro3++) {
      let lo = 0.005, hi = 40;
      for (let k = 0; k < 40; k++) {
        const d = Math.sqrt(lo * hi); metti({ ...q, d }, q.th);
        const sta = punti.every(v => { const s = proietta(v); return s.x >= area.x0 && s.x <= area.x1 && s.y >= area.y0 && s.y <= area.y1; });
        if (sta) hi = d; else lo = d;
      }
      q.d = hi; metti(q, q.th);
      const s = punti.map(proietta);
      const mx = (Math.min(...s.map(v => v.x)) + Math.max(...s.map(v => v.x))) / 2, my = (Math.min(...s.map(v => v.y)) + Math.max(...s.map(v => v.y))) / 2;
      q.fx += ((area.x0 + area.x1) / 2 - mx) / innerWidth; q.fy += ((area.y0 + area.y1) / 2 - my) / innerHeight;
    }
    metti(ora);
    return q;
  }

  // l'ombra segue l'inquadratura: da vicino stretta (gli edifici fanno ombra), da lontano larga
  const sDir = new THREE.Vector3();
  const soleDa = new THREE.Vector3(-1.6, 3.4, 2.6);
  const applicaOmbra = () => {
    const s = THREE.MathUtils.clamp(ora.d * 0.6, 0.025, 1.6), ca = sole.shadow.camera;
    Object.assign(ca, { left: -s, right: s, top: s, bottom: -s, near: 0.05, far: 8 });
    ca.updateProjectionMatrix();
    const texel = 2 * s / 1024;
    sole.shadow.bias = -texel / 8 * 0.7; sole.shadow.normalBias = texel * 1.2;
    const vicino = ora.d < 0.4;
    for (const c of Object.values(comune)) c.edifici.castShadow = vicino;
    sole.target.position.copy(ora.t);
    sole.position.copy(ora.t).add(sDir.copy(soleDa).normalize().multiplyScalar(4));
  };
  // da lontano la rete; da vicino le vie del comune (stesse strade, più dettaglio): si scambiano mentre la camera scende
  const applicaDettaglio = () => {
    const f = THREE.MathUtils.clamp((Math.log(ora.d) - Math.log(0.07)) / (Math.log(0.35) - Math.log(0.07)), 0, 1); // 1 lontano, 0 vicino
    scalaPx.value = THREE.MathUtils.clamp(1 + (ora.d - 3.5) * 0.3, 1, 1.7); // in casa la piastra è piccola: strade più larghe
    for (const m of mRete) m.uniforms.uOpacita.value = f;
    for (const m of reti) m.visible = f > 0.01;
    const vicino = f < 0.5;
    for (const c of Object.values(comune)) { c.mVie.uniforms.uOpacita.value = 1 - f; c.nastroVie.visible = f < 0.99; c.mVie.depthTest = vicino; }
    for (const t of tratti) t.m.depthTest = t.mBordo.depthTest = vicino;
    mCasa.color.lerpColors(BIANCO, BRUNO, f);
  };
  const applica = () => { metti(ora); applicaOmbra(); applicaDettaglio(); ombraSporca = camMossa = true; };

  // luce: 0 = sera (lampada), 1 = giorno sulla mappa (chinati sul tavolo). In casa la luce è quella della lastra; uCasa dice
  // quanto si vede la stanza fotografata (1 in casa, 0 nella giornata, in mezzo mentre ci si china)
  let luce = 0, ledForza = 1, uCasa = 1;
  const ca = new THREE.Color(), cb = new THREE.Color();
  const mischia = (a, b, m) => ca.set(a).lerp(cb.set(b), m);
  const nastri = () => [...mRete, ...Object.values(comune).map(c => c.mVie), ...tratti.flatMap(t => [t.m, t.mBordo])];
  const lerp = THREE.MathUtils.lerp;
  const applicaLuce = () => {
    const m = luce;
    cielo.color.copy(mischia(0x5a6ab0, 0xfdfbf7, m)); cielo.groundColor.copy(mischia(0x120d0a, 0x9c8462, m));
    cielo.intensity = lerp(0.03, 1.25, m);
    sole.color.set(0xfff1dc); sole.intensity = lerp(0, 2.6, m); soleDa.set(-2.2, 2.4, 1.4); // più basso: i muri dei centri fanno ombra
    lampada.intensity = lerp(11, 3, m);
    scena.environmentIntensity = lerp(0.05, 0.7, m);
    mBlu.emissiveIntensity = 0.25 + 0.9 * (1 - m);
    for (const n of nastri()) n.uniforms.uLuce.value = lerp(0.78, 1, m);
    uniformiStanza.uLed.value = ledForza * luciAccese;
    applicaOmbra();
  };

  // ---------- stato del giro: tappa prossima accesa, tratti fatti spenti, punto stretto ambra ----------
  // s = { prossima: indice tappa o -1, fatti: Set di indici tratto, stretta: indice tratto o -1, scelta: chiave comune o null }
  let st = { prossima: -1, fatti: new Set(), stretta: -1, prossimoTratto: -1, scelta: null };
  function stato(s) {
    st = { ...st, ...s };
    for (const [k, c] of Object.entries(comune)) c.edifici.material = st.scelta == null && tappe[st.prossima]?.chiave === k ? mBlu : mCasa;
    tratti.forEach((t, i) => {
      const tipo = i === st.stretta && st.scelta == null ? 'stretta' : i === st.prossimoTratto ? 'prossimo' : st.fatti.has(i) ? 'fatto' : 'normale';
      t.m.uniforms.uColore.value.set(COLORI_TRATTO[tipo]); t.m.uniforms.uColoreCasa.value.set(COLORI_CASA[tipo]);
      [t.m.uniforms.uLargoCasa.value, t.m.uniforms.uOpacitaCasa.value] = CASA_TRATTO[tipo];
      const a = t.nastro.geometry.attributes.largo;
      for (let j = 0; j < a.count; j++) a.setX(j, LARGO_TRATTO[tipo]);
      a.needsUpdate = true;
      const sopra = tipo === 'normale' || tipo === 'fatto' ? 0 : 2;
      t.nastro.renderOrder = 6 + sopra; t.bordo.renderOrder = 5 + sopra;
    });
    applicaDettaglio();
    richiedi();
  }
  // punti nel mondo, per i cartellini
  const ancora = k => { const [x, y] = comune[k].centro; return nelMondo(x, y, 2); };
  const campiona = (t, passi) => passi.map(f => { // punto al tratto per frazione di lunghezza
    const L = t.cum.at(-1) * f; let i = t.cum.findIndex(c => c >= L); if (i <= 0) i = 1;
    const u = (L - t.cum[i - 1]) / ((t.cum[i] - t.cum[i - 1]) || 1);
    return nelMondo(t.punti[i - 1][0] + (t.punti[i][0] - t.punti[i - 1][0]) * u, t.punti[i - 1][1] + (t.punti[i][1] - t.punti[i - 1][1]) * u, 1);
  });
  const puntiTratto = i => (tratti[i] ? campiona(tratti[i], Array.from({ length: 13 }, (_, k) => 0.04 + k * 0.92 / 12)) : []);
  // la scala e il nord nel punto dello schermo (sx, sy): dove cade sulla piastra, quanto sono 1 km, dov'è il nord
  const ray = new THREE.Raycaster(), pianoPiastra = new THREE.Plane(new THREE.Vector3(0, 1, 0), -PIANO), suolo = new THREE.Vector3();
  function bussola(sx, sy) {
    ray.setFromCamera(new THREE.Vector2(sx / innerWidth * 2 - 1, 1 - sy / innerHeight * 2), cam);
    if (!ray.ray.intersectPlane(pianoPiastra, suolo)) return null;
    const p0 = proietta(suolo), est = proietta(suolo.clone().add(new THREE.Vector3(1000 * K, 0, 0))), nord = proietta(suolo.clone().add(new THREE.Vector3(0, 0, -1000 * K)));
    return { pxKm: Math.hypot(est.x - p0.x, est.y - p0.y), estAngolo: Math.atan2(est.y - p0.y, est.x - p0.x), nordAngolo: Math.atan2(nord.x - p0.x, -(nord.y - p0.y)) };
  }

  // ---------- disegno ----------
  // giornata: il mondo con le sue luci. Casa: la lastra (il fondo), poi sopra, con la camera del render, la carta con la stampa,
  // il percorso e i poster, che prendono la luce della lastra. In mezzo (chinandosi) il primo sotto e la stanza che svanisce sopra.
  const vInv = new THREE.Matrix4();
  const conGiornata = [scrivania, base, ...Object.values(comune).flatMap(c => [c.edifici, c.nastroVie]), ...reti];
  const visibiliGiornata = new Map();
  function disegna() {
    if (uCasa < 1) { poster.visible = nomiStampati.visible = false; for (const t of tratti) t.nastro.visible = t.bordo.visible = !soloZona && uCasa <= 0; r.render(scena, cam); }
    if (uCasa > 0) {
      vInv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).invert();
      mFondo.uniforms.uInvVP.value.copy(vInv); mFondo.uniforms.uOcchio.value.copy(cam.position);
      uniformiStanza.uAlpha.value = uCasa;
      r.autoClear = false;
      if (uCasa >= 1) r.clear();
      r.render(scenaFondo, camFondo);
      for (const o of conGiornata) { visibiliGiornata.set(o, o.visible); o.visible = false; }
      foglio.material = materialiFoglioCasa; poster.visible = nomiStampati.visible = true;
      for (const t of tratti) { t.m.uniforms.uModo.value = uCasa; t.bordo.visible = false; t.nastro.visible = !soloZona; }
      r.render(scena, cam);
      for (const [o, v] of visibiliGiornata) o.visible = v;
      foglio.material = materialiFoglio;
      for (const t of tratti) { t.m.uniforms.uModo.value = 0; t.bordo.visible = t.nastro.visible = !soloZona; }
      r.autoClear = true;
    }
    if (sopraTela.length) sopraTelaAlPosto();
  }

  // ---------- movimento ----------
  let chiede = true, voli = [], dopo = [], ledAttivi = false, velocita = 0, ultimo = performance.now(), luciAccese = 1, coloreFisso = null;
  const richiedi = () => { chiede = true; };
  const misura = () => {
    r.setSize(innerWidth, innerHeight, false);
    schermo.set(innerWidth, innerHeight);
    cocSchermo.value = COC * adatta().s * r.getPixelRatio();
    if (ora.casa) ora = pose.casa(ora.zoom ?? 1);
    applica(); richiedi();
  };
  addEventListener('resize', misura);
  misura();
  const inOut = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  // un passo di volo fra due pose (la distanza in scala logaritmica: dal giro al centro di un comune è un fattore 30;
  // scendendo il punto guardato arriva prima dello zoom: si guarda già il comune, non la campagna a metà strada)
  const interpola = (da, verso, e) => {
    const presto = da.d > verso.d * 1.0001 || (da.casa && !verso.casa);
    const et = presto ? 1 - Math.pow(1 - e, 2.6) : Math.pow(e, 2.6);
    return { t: da.t.clone().lerp(verso.t, et), d: Math.exp(lerp(Math.log(da.d), Math.log(verso.d), e)), th: da.th + (verso.th - da.th) * e,
      ph: lerp(da.ph, verso.ph, e), fx: lerp(da.fx ?? 0.5, verso.fx, e), fy: lerp(da.fy, verso.fy, e), fov: lerp(da.fov, verso.fov, e) };
  };
  // casa <-> giornata: prima la lastra avanza verso il cartone (solo zoom: la stanza fotografata resta esatta), poi la camera si
  // china fino alla vista dall'alto mentre la stanza svanisce; al ritorno l'inverso. CHINA = quanto del tempo va allo zoom.
  const CHINA = 0.38, ZOOM = 1.7;
  function vola(verso, ms = 1100, lu = null, ledF = null) {
    const da = { ...ora, t: ora.t.clone() }, l0 = luce, f0 = ledForza, g0 = giro_;
    const entra = da.casa && !verso.casa, esce = !da.casa && verso.casa;
    // il punto dove il centro della mappa arriva alla fine dello zoom: dov'è (circa) nella posa d'arrivo
    const mira = p => { metti(p, p.th); const q = proietta(new THREE.Vector3(0, PIANO, PIASTRA_Z)); metti(ora); return q; };
    const china = entra ? pose.casa(ZOOM, mira(verso)) : esce ? pose.casa(ZOOM, mira(da)) : null;
    return new Promise(ok => {
      voli = [{ t0: performance.now(), ms, passo: k => {
        const e = inOut(k);
        if (entra) {
          if (e < CHINA) { const z = e / CHINA; ora = { ...da, ...interpola(da, china, z), casa: true }; uCasa = 1; }
          else { const z = (e - CHINA) / (1 - CHINA); ora = interpola(china, verso, z); uCasa = 1 - THREE.MathUtils.smoothstep(z, 0, 0.4); }
        } else if (esce) {
          if (e < 1 - CHINA) { const z = e / (1 - CHINA); ora = interpola(da, china, z); uCasa = THREE.MathUtils.smoothstep(z, 0.6, 1); }
          else { const z = (e - (1 - CHINA)) / CHINA; ora = { ...interpola(china, verso, z), casa: true, zoom: lerp(ZOOM, 1, z) }; uCasa = 1; }
        } else ora = { ...interpola(da, verso, e), casa: verso.casa };
        if (k >= 1) { ora = verso; uCasa = verso.casa ? 1 : 0; }
        giro_ = g0 * (1 - e);
        if (lu != null) luce = lerp(l0, lu, e);
        if (ledF != null) ledForza = lerp(f0, ledF, e);
        applicaLuce(); applica();
      }, fine: ok }];
      if (ms === 0) { voli[0].passo(1); voli = []; ok(); }
      richiedi();
    });
  }
  let fotogrammi = null; // per le misure: durata di ogni fotogramma disegnato
  let ultimoLed = 0, phiLed = [], phiLuci = [];
  function coloriLed(adesso) {
    const a = document.querySelector('.cornice-led')?.getAnimations()[0];
    const GIRO_MS = 15000; // come .cornice-led in stile.css
    const ang = a ? ((a.currentTime ?? 0) % GIRO_MS) / GIRO_MS * 360 : 0;
    if (camMossa) {
      const W = innerWidth, H = innerHeight;
      const dir = p => { const q = p.clone().project(cam); return Math.atan2((q.x + 1) / 2 * W - W / 2, -((1 - q.y) / 2 * H - H / 2)) * 180 / Math.PI; };
      phiLed = puntiStriscia.map(dir); phiLuci = centriLed.map(dir);
      camMossa = false;
    }
    const fisso = coloreFisso && new THREE.Color(coloreFisso);
    const g = grad.image.data;
    phiLed.forEach((phi, i) => { const c = fisso ?? coloreLed(ang, phi); g[i * 4] = c.r * 255; g[i * 4 + 1] = c.g * 255; g[i * 4 + 2] = c.b * 255; }); // lineare, come lo vuole lo shader
    grad.needsUpdate = true;
    ['uC0', 'uC1', 'uC2'].forEach((u, i) => uniformiStanza[u].value.copy(fisso ?? coloreLed(ang, phiLuci[i])));
    document.documentElement.style.setProperty('--led', `#${(fisso ?? coloreLed(ang, phiLuci[1])).getHexString()}`);
  }
  function ciclo(adesso) {
    const dt = Math.min(64, adesso - ultimo); ultimo = adesso;
    // k fra 0 e 1: il primo fotogramma può avere l'ora di rAF prima di quella del via (k negativo: con la potenza dava NaN e fermava il ciclo)
    // (window.__kVolo, solo per gli scatti: ferma il volo a quella frazione)
    for (const v of voli) { const k = window.__kVolo ?? Math.min(1, Math.max(0, (adesso - v.t0) / v.ms)); v.passo(k); if (k >= 1) { v.fine(); v.finito = true; } }
    const vivi = voli.length > 0; voli = voli.filter(v => !v.finito);
    if (Math.abs(velocita) > 1e-5) { giro_ += velocita * dt; velocita *= Math.pow(0.9955, dt); applica(); chiede = true; }
    // i LED: la direzione sullo schermo di ogni punto della striscia si calcola solo quando la camera si muove; a ogni giro si
    // legge l'angolo della cornice e si colora. Se cambiano solo i LED si ridisegna a 30 al secondo (il giro dura 5 s: non si vede)
    let soloLed = false;
    if (ledAttivi && uCasa > 0 && adesso - ultimoLed >= 32) {
      ultimoLed = adesso; coloriLed(adesso); uniformiStanza.uSeme.value = (uniformiStanza.uSeme.value + 0.618034) % 1;
      soloLed = !chiede && !vivi; chiede = true;
    }
    if (chiede || vivi) {
      const t0 = performance.now();
      const fermo = !vivi && Math.abs(velocita) <= 1e-5;
      if (fermo && ombraSporca && uCasa < 1) { r.shadowMap.needsUpdate = true; ombraSporca = false; } // le ombre del giorno, a camera ferma
      disegna();
      if (!soloLed) dopo.forEach(f => f()); chiede = false;
      if (fotogrammi) fotogrammi.push({ t: adesso, cpu: performance.now() - t0 });
    }
    requestAnimationFrame(ciclo);
  }
  applicaLuce();
  // i programmi degli shader si compilano adesso, non al primo fotogramma del volo
  await r.compileAsync(scena, cam); await r.compileAsync(scenaFondo, camFondo);
  // e un fotogramma della giornata, nascosto dal primo della casa: la mappa d'ombra e il suo programma esistono già quando ci si china
  r.shadowMap.needsUpdate = true; r.render(scena, cam); ombraSporca = true;
  requestAnimationFrame(ciclo);

  // la piastra gira sotto il dito: 1:1 mentre trascina, poi va avanti con la velocità del dito e rallenta (Apple, WWDC 2018)
  function trascinabile(el) {
    let x0 = null, storia = [];
    el.addEventListener('pointerdown', e => { x0 = e.clientX; storia = [[e.clientX, e.timeStamp]]; velocita = 0; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', e => {
      if (x0 == null) return;
      giro_ -= (e.clientX - x0) * 0.0075; x0 = e.clientX; applica(); richiedi();
      storia.push([e.clientX, e.timeStamp]); if (storia.length > 5) storia.shift();
    });
    const lascia = () => {
      if (x0 == null) return;
      const [a, b] = [storia[0], storia.at(-1)];
      const v = b && a && b[1] > a[1] ? (b[0] - a[0]) / (b[1] - a[1]) : 0; // px al ms
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) velocita = -v * 0.0075;
      x0 = null;
    };
    el.addEventListener('pointerup', lascia); el.addEventListener('pointercancel', lascia);
  }

  await posterPronti;
  foglio.material = materialiFoglioCasa; await r.compileAsync(scena, cam); foglio.material = materialiFoglio; // anche i programmi della casa
  richiedi();
  let insegnaCaricata = null;
  return {
    angoliPiastra: () => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => proietta(new THREE.Vector3(a * LATO / 2, PIANO, PIASTRA_Z + b * LATO / 2))),
    // per le misure: quanto è larga sullo schermo ogni copertina, e il quadrilatero di ognuna
    copertine: () => poster.children.filter(m => m.renderOrder === 21).map(m => { m.geometry.computeBoundingBox(); const bb = m.geometry.boundingBox;
      const a = proietta(new THREE.Vector3(bb.min.x, 0, 0).applyMatrix4(m.matrixWorld)), b = proietta(new THREE.Vector3(bb.max.x, 0, 0).applyMatrix4(m.matrixWorld)); return Math.hypot(b.x - a.x, b.y - a.y); }),
    quadriPoster: () => poster.children.filter(m => m.renderOrder === 21).map(m => { m.geometry.computeBoundingBox(); const bb = m.geometry.boundingBox;
      return [[bb.min.x, bb.max.y], [bb.max.x, bb.max.y], [bb.max.x, bb.min.y], [bb.min.x, bb.min.y]].map(([x, y]) => proietta(new THREE.Vector3(x, y, 0).applyMatrix4(m.matrixWorld))); }),
    // per le misure: la lastra sullo schermo e dove la camera del render mette un punto del mondo (px della lastra -> schermo)
    lastra: () => ({ ...adatta(), WS, HS }),
    sullaLastra: v => { const c = slab(v); const { s, ox, oy } = adatta(); return { x: ox + s * c.x * WS, y: oy + s * (1 - c.y) * HS }; },
    pose, vola, stato, proietta, ancora, puntiTratto, campiona: (i, f) => campiona(tratti[i], [f])[0], bussola, trascinabile, richiedi,
    tappe, tratti: tratti.map(({ da, a, metri: m, minuti }) => ({ da, a, metri: m, minuti })),
    nomiVie: k => comune[k].nomi, quanti: k => ({ edifici: comune[k].quanti, senzaDato: comune[k].senzaDato }),
    dopoDisegno: f => dopo.push(f),
    led: on => { ledAttivi = on && !matchMedia('(prefers-reduced-motion: reduce)').matches; if (on && !ledAttivi) { coloreFisso ??= '#34c759'; coloriLed(); } /* fermi: verdi */ richiedi(); },
    // il colore delle luci lo sceglie il tecnico: null = la cornice che gira; '#rrggbb' = quel colore, fisso
    coloreLuci: c => { coloreFisso = c; document.documentElement.classList.toggle('luci-fisse', !!c); coloriLed(); richiedi(); },
    // la stanza a luci basse (prima schermata) o accesa: base attenuata, LED spenti o accesi
    luci: ({ base = 1, led = 1 } = {}) => { uniformiStanza.uBase.value = base; luciAccese = led; applicaLuce(); richiedi(); },
    // l'insegna: null = spenta; '#rrggbb' = accesa di quel colore (la luce sul muro; la scritta la compone la pagina)
    insegna: async (colore, forza = 1) => {
      if (colore && !insegnaCaricata) insegnaCaricata = lastra('insegna.webp').then(t => { uniformiStanza.tIns.value = t; });
      if (colore) await insegnaCaricata;
      uniformiStanza.uIns.value.set(colore ?? '#000').multiplyScalar(colore ? forza : 0); richiedi();
    },
    soloZona: on => { soloZona = on; richiedi(); }, // sul cartone la mappa della zona, senza percorso
    // per la verifica contro il render di Blender: muro e carta bianchi (come li vede la camera del render), niente stampa né
    // grana, tutte le luci bianche e l'insegna accesa: la pagina deve ridare riferimento-agx.png
    verificaBlender: async () => { uniformiStanza.uMuro.value.set('#ffffff'); Object.assign(uniformiStanza.uCarta, { value: 1 }); uniformiStanza.uTela.value = 0; uniformiStanza.uGrana.value = 0; uniformiStanza.uNero.value = 0;
      soloZona = true; coloreFisso = '#ffffff'; coloriLed(); await (async () => { insegnaCaricata ??= lastra('insegna.webp').then(t => { uniformiStanza.tIns.value = t; }); await insegnaCaricata; uniformiStanza.uIns.value.set(1, 1, 1); })(); richiedi(); },
    // per le prove: disegna adesso e legge i pixel del canvas (RGBA, dall'alto in basso, px del dispositivo)
    fotografa: () => { disegna(); const gl = r.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, a = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, a); return { w, h, a, dpr: w / innerWidth }; },
    misuraFotogrammi: on => { const f = fotogrammi; fotogrammi = on ? [] : null; return f; },
    info: () => ({ gl: r.getContext().getParameter(r.getContext().VERSION), chiamate: r.info.render.calls, triangoli: r.info.render.triangles, programmi: r.info.programs.map(p => `${p.name}:${p.type}`) }),
    stanza: () => ({ camera: ST, uCasa, zoom: ora.zoom ?? 1, copertineSopra: sopraTela.length }),
  };
}
