// La cifratura fra ufficio e telefono: il server conserva solo buste chiuse.
// - Dalla password escono due cose: l'«accesso» (va al server AL POSTO della password, così il server non la vede mai)
//   e la chiave che apre la chiave privata (non lascia mai il browser).
// - Ognuno ha una coppia di chiavi ECDH P-256; la privata sta sul server avvolta con la sua password.
// - Una busta: i dati cifrati una volta (AES-GCM), la chiave della busta cifrata per ogni destinatario.
//   Il «contesto» (tabella|dipendente|giorno) è legato alla busta: spostata in un'altra riga non si apre.
const s = crypto.subtle;
const testo = new TextEncoder(), leggi = new TextDecoder();
const EC = { name: 'ECDH', namedCurve: 'P-256' };
const ITERAZIONI = 600_000; // PBKDF2-SHA256, quanto chiede OWASP 2023: ~0,5 s su un telefono, una volta per accesso

export const b64 = b => {
  let t = '';
  const u = new Uint8Array(b);
  for (let i = 0; i < u.length; i += 0x8000) t += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(t).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const daB64 = t => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const caso = n => crypto.getRandomValues(new Uint8Array(n));

export async function daPassword(email, password, iterazioni = ITERAZIONI) {
  const base = await s.importKey('raw', testo.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bit = new Uint8Array(await s.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: iterazioni,
    salt: testo.encode(`giro:v1:${email.trim().toLowerCase()}`) }, base, 512));
  return {
    accesso: b64(bit.slice(0, 32)),
    apri: await s.importKey('raw', bit.slice(32), 'AES-GCM', false, ['wrapKey', 'unwrapKey']),
  };
}

const B64_32 = /^[A-Za-z0-9_-]{43}$/;
export async function importaPubblica(j) {
  if (j?.kty !== 'EC' || j.crv !== 'P-256' || !B64_32.test(j.x ?? '') || !B64_32.test(j.y ?? '')) throw new Error('chiave pubblica storta');
  return s.importKey('jwk', { kty: 'EC', crv: 'P-256', x: j.x, y: j.y, ext: true }, EC, true, []); // controlla anche che il punto stia sulla curva
}

// il nome della chiave: 16 byte dell'impronta della pubblica
export const kidDi = async j => b64((await s.digest('SHA-256', testo.encode(`${j.x}.${j.y}`))).slice(0, 16));

export async function nuoveChiavi(apri) {
  const c = await s.generateKey(EC, true, ['deriveBits']);
  const { x, y } = await s.exportKey('jwk', c.publicKey);
  const pubblica = { kty: 'EC', crv: 'P-256', x, y };
  return { pubblica, kid: await kidDi(pubblica), privata: await avvolgi(c.privateKey, apri) };
}

async function avvolgi(privata, apri) {
  const iv = caso(12);
  return { iv: b64(iv), ct: b64(await s.wrapKey('pkcs8', privata, apri, { name: 'AES-GCM', iv })) };
}

// con la password sbagliata GCM non torna: errore
export const apriChiave = (p, apri, estraibile = false) =>
  s.unwrapKey('pkcs8', daB64(p.ct), apri, { name: 'AES-GCM', iv: daB64(p.iv) }, EC, estraibile, ['deriveBits']);

// nuova password (o nuova email) per sé: la stessa chiave privata, avvolta con la nuova
export const riavvolgi = async (p, vecchia, nuova) => avvolgi(await apriChiave(p, vecchia, true), nuova);

async function chiaveFra(privata, pubblica, contesto, kid) {
  const bit = await s.deriveBits({ name: 'ECDH', public: pubblica }, privata, 256);
  const k = await s.importKey('raw', bit, 'HKDF', false, ['deriveKey']);
  return s.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: testo.encode(`giro:v1:${contesto}:${kid}`) },
    k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// destinatari: [{ kid, pubblica }]
export async function sigilla(oggetto, destinatari, contesto) {
  const k = caso(32), iv = caso(12);
  const ck = await s.importKey('raw', k, 'AES-GCM', false, ['encrypt']);
  const ct = await s.encrypt({ name: 'AES-GCM', iv, additionalData: testo.encode(contesto) }, ck, testo.encode(JSON.stringify(oggetto)));
  const per = {};
  for (const d of destinatari) {
    const e = await s.generateKey(EC, true, ['deriveBits']);
    const { x, y } = await s.exportKey('jwk', e.publicKey);
    const kek = await chiaveFra(e.privateKey, await importaPubblica(d.pubblica), contesto, d.kid);
    const iv2 = caso(12);
    per[d.kid] = { epk: { x, y }, iv: b64(iv2), k: b64(await s.encrypt({ name: 'AES-GCM', iv: iv2 }, kek, k)) };
  }
  return { v: 1, iv: b64(iv), ct: b64(ct), per };
}

// mio: { kid, privata: CryptoKey }
export async function apri(busta, mio, contesto) {
  const p = busta?.per?.[mio.kid];
  if (busta?.v !== 1 || !p) throw new Error('busta non per me');
  const kek = await chiaveFra(mio.privata, await importaPubblica({ kty: 'EC', crv: 'P-256', ...p.epk }), contesto, mio.kid);
  const k = await s.decrypt({ name: 'AES-GCM', iv: daB64(p.iv) }, kek, daB64(p.k));
  const ck = await s.importKey('raw', k, 'AES-GCM', false, ['decrypt']);
  return JSON.parse(leggi.decode(await s.decrypt({ name: 'AES-GCM', iv: daB64(busta.iv), additionalData: testo.encode(contesto) }, ck, daB64(busta.ct))));
}

// per chi è già chiusa una busta (per sapere se va richiusa per una chiave nuova)
export const perChi = busta => Object.keys(busta?.per ?? {});
