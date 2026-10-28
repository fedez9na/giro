// Il collegamento all'ufficio (Supabase, Francoforte). Tutto ciò che parte da qui è già chiuso in busta (cifra.js),
// tranne nome ed email delle persone. La password non esce mai: al server va l'«accesso» che ne deriva.
// La chiave privata, una volta aperta, resta in questo browser (IndexedDB) e non si può esportare.
import { daPassword, apriChiave, nuoveChiavi, riavvolgi, sigilla, apri, perChi, daB64, b64 } from './cifra.js';

export const PROGETTO = 'https://easlpebduevcyljcsxlt.supabase.co';
const CHIAVE_API = 'sb_publishable_SlqiOkBIMes0V6o4Frn4Dg_-Y7f8prz'; // pubblica per costruzione: senza accesso le regole non danno niente
const MEMORIA = 'giro:ufficio'; // chi sono (id, nome, ruolo, kid): serve anche senza rete

let client = null;
export async function server() {
  if (client) return client;
  if (!globalThis.supabase) {
    // la libreria si carica solo a chi si collega (213 KB): Giro senza ufficio resta leggero
    await new Promise((ok, no) => {
      const s = document.createElement('script');
      s.src = new URL('vendor/supabase.js', import.meta.url).href;
      s.onload = ok; s.onerror = () => no(new Error('Non riesco a caricare il collegamento: controlla la rete'));
      document.head.append(s);
    });
  }
  client = globalThis.supabase.createClient(PROGETTO, CHIAVE_API, {
    auth: { storageKey: 'giro:sessione', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return client;
}

// ---------- la chiave in questo browser ----------
function idb(modo, fn) {
  return new Promise((ok, no) => {
    const r = indexedDB.open('giro-chiavi', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('k');
    r.onerror = () => no(r.error);
    r.onsuccess = () => {
      const t = r.result.transaction('k', modo);
      const q = fn(t.objectStore('k'));
      t.oncomplete = () => { r.result.close(); ok(q.result); };
      t.onerror = () => { r.result.close(); no(t.error); };
    };
  });
}
const leggiChiave = id => idb('readonly', s => s.get(id));
const salvaChiave = (id, v) => idb('readwrite', s => s.put(v, id));
const togliChiave = id => idb('readwrite', s => s.delete(id)).catch(() => {});

const leggiMemoria = () => { try { return JSON.parse(localStorage.getItem(MEMORIA)); } catch { return null; } };
export const collegato = () => !!leggiMemoria(); // senza caricare niente: chi non si è mai collegato non scarica la libreria
export const ruoloCollegato = () => leggiMemoria()?.ruolo ?? null; // 'gestore' | 'dipendente' | null
export const collegatoCome = () => leggiMemoria(); // { id, nome, … } di chi è collegato qui, anche senza rete
const scriviMemoria = p => { try { localStorage.setItem(MEMORIA, JSON.stringify(p)); } catch { /* pieno: si rilegge dal server */ } };

const MESSAGGI = { 'Invalid login credentials': 'Email o password non giuste' };
const errore = (e, base) => new Error(MESSAGGI[e?.message] ?? (e?.status >= 500 || !navigator.onLine || e?.name === 'AuthRetryableFetchError' ? 'Non riesco a parlare col server: controlla la rete' : base));

// Si entra una volta: da qui la sessione si rinnova da sola e la chiave resta nel browser.
export async function entra(email, password) {
  const sb = await server();
  const e = email.trim().toLowerCase();
  const d = await daPassword(e, password);
  const { data, error } = await sb.auth.signInWithPassword({ email: e, password: d.accesso });
  if (error) throw errore(error, 'Email o password non giuste');
  const id = data.user.id;
  const [p, c] = await Promise.all([
    sb.from('persone').select('id, nome, email, ruolo, kid, pubblica').eq('id', id).maybeSingle(),
    sb.from('chiavi').select('privata').eq('persona', id).maybeSingle()]);
  if (!p.data || !c.data) { await sb.auth.signOut({ scope: 'local' }); throw new Error('Questo accesso non è completo: chiedi all’ufficio di rifarlo'); }
  const privata = await apriChiave(c.data.privata, d.apri);
  await salvaChiave(id, { kid: p.data.kid, privata });
  scriviMemoria(p.data);
  return { ...p.data, chiave: { kid: p.data.kid, privata } };
}

// Chi è collegato in questo browser, anche senza rete. null = nessuno, o la chiave non c'è più (si rientra).
export async function io() {
  const sb = await server();
  const { data: { session } } = await sb.auth.getSession();
  const m = leggiMemoria();
  if (!session || !m || m.id !== session.user.id) return null;
  const k = await leggiChiave(m.id).catch(() => null);
  if (!k || k.kid !== m.kid) return null;
  return { ...m, chiave: k };
}

// La chiave sul server è ancora quella di questo browser? Se il gestore ha cambiato la password, no: si rientra.
export async function controllaChiave(p) {
  const sb = await server();
  const { data, error } = await sb.from('persone').select('kid, nome, email').eq('id', p.id).maybeSingle();
  if (error) return true; // senza rete: si va avanti con quella che c'è
  if (data?.kid === p.chiave.kid) { scriviMemoria({ ...leggiMemoria(), nome: data.nome, email: data.email }); return true; }
  await esci(p);
  return false;
}

export async function esci(p) {
  const sb = await server();
  try {
    const sub = await (await navigator.serviceWorker?.getRegistration())?.pushManager?.getSubscription();
    if (sub) { await sb.from('iscrizioni').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
  } catch { /* senza rete: l'iscrizione la toglie il server al primo invio fallito */ }
  await sb.auth.signOut({ scope: 'local' }).catch(() => {});
  if (p?.id) await togliChiave(p.id);
  localStorage.removeItem(MEMORIA);
}

export async function chiama(azione, corpo = {}) {
  const sb = await server();
  const { data, error } = await sb.functions.invoke('accessi', { body: { azione, ...corpo } });
  if (error) {
    let m = null;
    try { m = (await error.context.json()).errore; } catch { /* nessuna risposta: rete */ }
    throw new Error(m ?? 'Non riesco a parlare col server: controlla la rete');
  }
  return data;
}

// Il gestore crea o cambia l'accesso di un dipendente: la password la trasforma questo browser, le chiavi nascono qui.
export async function accessoNuovo(email, password) {
  const d = await daPassword(email.trim().toLowerCase(), password);
  const c = await nuoveChiavi(d.apri);
  return { email: email.trim().toLowerCase(), accesso: d.accesso, pubblica: c.pubblica, privata: c.privata };
}

// Cambiare la propria email o password: stessa chiave, avvolta con la nuova. Poi si rientra con quella nuova.
export async function cambiaMioAccesso(p, vecchiaPassword, email, password) {
  const sb = await server();
  const vecchia = await daPassword(p.email, vecchiaPassword);
  const { data: c, error } = await sb.from('chiavi').select('privata').eq('persona', p.id).single();
  if (error) throw errore(error, 'Non riesco a leggere la tua chiave');
  const e = email.trim().toLowerCase();
  const nuova = await daPassword(e, password);
  let privata;
  try { privata = await riavvolgi(c.privata, vecchia.apri, nuova.apri); } catch { throw new Error('La password attuale non è giusta'); }
  await chiama('mio-accesso', { vecchio: vecchia.accesso, email: e, accesso: nuova.accesso, privata });
  return entra(e, password);
}

// ---------- il dipendente: turni in arrivo, esiti in partenza, notifiche ----------
export const contesto = (tabella, dip, iso, riga) => [tabella, dip, iso, riga].filter(Boolean).join('|');

export async function gestori() {
  const sb = await server();
  const { data, error } = await sb.from('persone').select('id, kid, pubblica').eq('ruolo', 'gestore');
  if (error) throw errore(error, 'Non riesco a leggere l’ufficio');
  return data;
}

// I turni da `daIso` in poi, già aperti: [{ iso, versione, turni }]. Una busta che non si apre si salta (chiave cambiata).
export async function mieiTurni(p, daIso) {
  const sb = await server();
  const { data, error } = await sb.from('turni').select('data, versione, busta').eq('dipendente', p.id).gte('data', daIso);
  if (error) throw errore(error, 'Non riesco a leggere i turni');
  return apriTurni(p, data);
}
export async function apriTurni(p, righe) {
  const fuori = [];
  for (const r of righe) {
    try { fuori.push({ iso: r.data, versione: r.versione, turni: await apri(r.busta, p.chiave, contesto('turni', p.id, r.data)) }); }
    catch { /* non per questa chiave */ }
  }
  return fuori;
}

export async function mieiEsiti(p, iso) {
  const sb = await server();
  const { data } = await sb.from('esiti').select('riga, busta').eq('dipendente', p.id).eq('data', iso);
  const fuori = {};
  for (const r of data ?? []) {
    try { fuori[r.riga] = await apri(r.busta, p.chiave, contesto('esiti', p.id, iso, r.riga)); } catch { /* non per me */ }
  }
  return fuori;
}

// Un esito per intervento: torna all'ufficio e resta leggibile anche da me (telefono nuovo).
export async function mandaEsito(p, iso, riga, esito, destinatari) {
  const sb = await server();
  const busta = await sigilla(esito, [...destinatari, { kid: p.kid, pubblica: p.pubblica }], contesto('esiti', p.id, iso, riga));
  const { error } = await sb.from('esiti').upsert({ dipendente: p.id, data: iso, riga, busta });
  if (error) throw errore(error, 'Esito non mandato');
}

// La sua stanza (scritta, colore, parete composta, collegamento al poster shop), chiusa con la sua chiave: dall'app i gestori non la leggono (chi conosce
// la sua password sì: oggi la sceglie il gestore). La busta non è firmata: che la scriva solo lui lo garantisce la regola sul server.
// null se non c'è o se è chiusa con una chiave vecchia (password cambiata): allora vale quella del telefono.
export async function miaStanza(p) {
  const sb = await server();
  const { data, error } = await sb.from('stanze').select('busta').eq('persona', p.id).maybeSingle();
  if (error) throw errore(error, 'Non riesco a leggere la tua stanza');
  try { return data ? await apri(data.busta, p.chiave, contesto('stanze', p.id)) : null; } catch { return null; }
}
export async function salvaStanza(p, stanza) {
  const sb = await server();
  const busta = await sigilla(stanza, [{ kid: p.kid, pubblica: p.pubblica }], contesto('stanze', p.id));
  const { error } = await sb.from('stanze').upsert({ persona: p.id, busta });
  if (error) throw errore(error, 'La tua stanza non è salvata sul server');
}

// Canali PRIVATI: li apre solo chi la regola sul server lascia entrare (turni:<id> il dipendente, esiti:ufficio i gestori).
// I messaggi li manda un trigger del database quando cambia una riga: dentro c'è solo la busta chiusa.
export async function ascolta(canale, evento, fn) {
  const sb = await server();
  await sb.realtime.setAuth();
  return sb.channel(canale, { config: { private: true } }).on('broadcast', { event: evento }, m => fn(m.payload)).subscribe();
}

export function statoNotifiche() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'non-supportate';
  return Notification.permission === 'granted' ? 'permesse' : Notification.permission === 'denied' ? 'negate' : 'da-chiedere';
}

// Va chiamata da un tocco (iPhone lo pretende). Una iscrizione fatta per un'altra persona su questo telefono si rifà da capo.
export async function attivaNotifiche(p) {
  if (statoNotifiche() === 'non-supportate') return 'non-supportate';
  if (await Notification.requestPermission() !== 'granted') return 'negate';
  const sb = await server();
  const reg = await navigator.serviceWorker.ready;
  const { chiave } = await chiama('vapid');
  const iscrivi = () => reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: daB64(chiave) });
  let sub = await reg.pushManager.getSubscription();
  if (sub && b64(sub.options.applicationServerKey) !== chiave) { await sub.unsubscribe(); sub = null; }
  sub ??= await iscrivi();
  const salva = s => sb.from('iscrizioni').upsert({ endpoint: s.endpoint, persona: p.id, chiavi: s.toJSON().keys });
  let { error } = await salva(sub);
  if (error) { await sub.unsubscribe(); sub = await iscrivi(); ({ error } = await salva(sub)); }
  if (error) throw errore(error, 'Non riesco ad attivare le notifiche');
  return 'attive';
}

export { sigilla, apri, perChi };
