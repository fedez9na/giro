// Il meteo dei lavori: Bright Sky (previsioni DWD, CC BY 4.0) e il bollettino di allerta della Protezione Civile (CC BY 4.0).
// Escono solo le coordinate del COMUNE (app/comuni.json, al centesimo di grado) e il giorno del foglio: mai via, cliente o telefono.
import { hm, nomeComune } from './testi.js';

export const chiave = n => n.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

// ponytail: il foglio dà la finestra d'ARRIVO, non quanto dura il lavoro: si guardano 2 ore dopo la fine della finestra
export const DOPO = 120;
// soglie mie, da tarare con Riccardo: pioggia probabile o già misurabile, raffiche che sul tetto si sentono
const SOGLIE = { prob: 40, mm: 0.5, raffica: 40 };
// dal più grave: la grandine si dice anche senza millimetri, la neve anche se poca (sul tetto scivola)
const TIPI = [['hail', 'grandine'], ['snow', 'neve'], ['sleet', 'nevischio']];

const minuti = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const giorniDa = (iso, altro) => (Date.parse(`${altro}T00:00Z`) - Date.parse(`${iso}T00:00Z`)) / 864e5;
// un'ora di Bright Sky vale per i 60 minuti che FINISCONO al timestamp; si conta in minuti dall'inizio del giorno del foglio
const fineOra = (iso, ts) => giorniDa(iso, ts.slice(0, 10)) * 1440 + minuti(ts.slice(11, 16));
// un valore che manca non vale zero
const numeri = (r, k) => r.map(x => x[k]).filter(v => v != null);
const massimo = v => (v.length ? Math.max(...v) : null);

export const compatta = w => ({ t: w.timestamp, mm: w.precipitation, prob: w.precipitation_probability, raffica: w.wind_gust_speed, cond: w.condition });

export function meteoDelLavoro(ore, iso, orario) {
  if (!orario?.da || !ore?.length) return null;
  // una fine prima dell'inizio (20-00, o un refuso) non svuota la finestra: si conta dall'inizio
  const da = minuti(orario.da), fine = Math.max(da, minuti(orario.a ?? orario.da)) + DOPO;
  const r = ore.filter(x => { const t = fineOra(iso, x.t); return t > da && t - 60 < fine; });
  const mm = numeri(r, 'mm');
  const m = {
    prob: massimo(numeri(r, 'prob')),
    mm: mm.length ? Math.round(mm.reduce((s, v) => s + v, 0) * 10) / 10 : null,
    raffica: massimo(numeri(r, 'raffica')),
    temporale: r.some(x => x.cond === 'thunderstorm'),
    tipo: TIPI.find(([c]) => r.some(x => x.cond === c))?.[1] ?? null,
  };
  return m.prob == null && m.mm == null && m.raffica == null ? null : m;
}

export function etichetta(m) {
  if (!m) return '';
  const p = [];
  if (m.temporale) p.push('temporale');
  const acqua = m.tipo ?? 'pioggia';
  if (m.tipo === 'grandine') p.push('grandine');
  else if (m.prob >= SOGLIE.prob) p.push(`${acqua} ${m.prob}%`);
  else if (m.mm >= SOGLIE.mm) p.push(`${acqua} ${String(m.mm).replace('.', ',')} mm`);
  else if (m.tipo) p.push(m.tipo);
  if (m.raffica >= SOGLIE.raffica) p.push(`raffiche ${Math.round(m.raffica)} km/h`);
  const s = p.join(' · ');
  return s && s[0].toUpperCase() + s.slice(1);
}

const RISCHI = [['Per rischio temporali', 'temporali'], ['Per rischio idrogeologico', 'rischio idrogeologico'], ['Per rischio idraulico', 'rischio idraulico']];
// zone del bollettino (topojson): ognuna elenca i suoi comuni e il livello per ogni rischio. Un comune può stare in più zone
// (si sommano); il bollettino è nazionale, quindi la zona di un omonimo lontano si scarta: conta solo se almeno metà dei
// suoi comuni sta nella nostra tabella (`noti`, Lombardia e Piemonte)
export function allerteDi(zone, chiavi, noti = null) {
  const out = {};
  for (const { properties: p } of zone) {
    const comuni = (p.Comuni ?? []).map(chiave);
    if (noti && comuni.filter(k => noti.has(k)).length * 2 < comuni.length) continue;
    const dentro = new Set(comuni);
    const allerte = RISCHI.map(([campo, nome]) => {
      const m = /ALLERTA (GIALLA|ARANCIONE|ROSSA)/.exec(p[campo] ?? '');
      return m && `Allerta ${m[1].toLowerCase()} per ${nome}`;
    }).filter(Boolean);
    for (const k of chiavi) {
      if (!dentro.has(k)) continue;
      const prima = out[k];
      out[k] = prima ? { zona: `${prima.zona}, ${p['Nome zona']}`, allerte: [...new Set([...prima.allerte, ...allerte])] } : { zona: p['Nome zona'], allerte };
    }
  }
  return out;
}

// il bollettino esce verso le 14-16 e vale per «oggi» e «domani»: per il giorno del foglio vale il più recente che lo copre
export function scegliBollettino(nomi, iso) {
  let meglio = null;
  for (const n of nomi) {
    const m = /(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})_(today|tomorrow)\.json$/.exec(n);
    if (!m) continue;
    const giorno = new Date(Date.UTC(+m[1], m[2] - 1, +m[3] + (m[6] === 'tomorrow' ? 1 : 0))).toISOString().slice(0, 10);
    const quando = m.slice(1, 6).join('');
    if (giorno === iso && (!meglio || quando > meglio.quando)) meglio = { quando, file: n, emesso: `${m[3]}/${m[2]} alle ${m[4]}:${m[5]}` };
  }
  return meglio && { file: meglio.file, emesso: meglio.emesso };
}

// Prima di partire: quali interventi hanno pioggia, vento o temporale; chi resta scoperto (comune senza dati, orario
// non letto) si dice, non si copre con «niente pioggia»
export function riassunto(giro, meteo, iso) {
  const conOra = giro.filter(i => i.orario.da);
  const misure = conOra.map(i => [i, meteoDelLavoro(meteo?.comuni?.[chiave(i.comune)]?.ore, iso, i.orario)]);
  const conDati = misure.filter(([, m]) => m);
  if (!conDati.length) return null;
  const nomi = l => [...new Set(l.map(i => nomeComune(i.comune)))].join(', ');
  const senzaDati = misure.filter(([, m]) => !m).map(([i]) => i), senzaOra = giro.filter(i => !i.orario.da);
  const nota = [senzaDati.length && `Senza dati per ${nomi(senzaDati)}`, senzaOra.length && `Senza orario: ${nomi(senzaOra)}`].filter(Boolean);
  const segnali = conDati.map(([i, m]) => [i, etichetta(m)]).filter(([, e]) => e);
  if (!segnali.length) return { principale: 'Niente pioggia né vento forte', righe: nota.length ? nota : ['Nelle ore dei tuoi interventi'] };
  if (segnali.length === 1) {
    const [i, e] = segnali[0];
    return { principale: `${e} alle ${hm(i.orario.da)} a ${nomeComune(i.comune)}`, righe: nota };
  }
  const elenco = segnali.map(([i, e]) => `${hm(i.orario.da)} ${nomeComune(i.comune)}: ${e[0].toLowerCase()}${e.slice(1)}`);
  return { principale: `Meteo da guardare in ${segnali.length} interventi`, righe: [...elenco, ...nota] };
}

// ---------- meteo.json del nostro sito (lavoro giornaliero: AROME 1,3 km + ICON-2I 2,2 km + allerte) ----------
// un'ora è del giorno in cui finisce; la mezzanotte chiude l'ora 23-24 del giorno prima
const delGiorno = (iso, t) => { const f = fineOra(iso, t); return f > 0 && f <= 1440; };
// si usa se è di meno di 12 ore e copre il giorno del foglio; sennò (anche se il file è rotto) si torna a Bright Sky dal telefono
export const sitoValido = (j, iso, adesso = Date.now()) =>
  Array.isArray(j?.ore) && !!j.comuni && adesso - Date.parse(j.creato) < 12 * 36e5 && j.ore.some(t => delGiorno(iso, t));

// ponytail: mm/h di neve o grandine (graupel di AROME) da cui si dice il nome; da tarare sul primo inverno vero
const GHIACCIO = 0.2;
// per ogni ora il PEGGIORE dei modelli (sul tetto conta il rischio, non la media); i fulmini di ICON-2I fanno «temporale».
// Nel telefono restano solo le ore del giorno del foglio
export function daSito(j, chiavi, iso) {
  const peggio = v => { const n = v.filter(x => x != null); return n.length ? Math.max(...n) : null; };
  const quali = j.ore.flatMap((t, n) => (delGiorno(iso, t) ? [n] : []));
  const comuni = {};
  for (const k of chiavi.filter(c => j.comuni[c])) {
    const m = Object.values(j.comuni[k]);
    const c = (campo, n) => m.some(x => x[campo]?.[n] >= GHIACCIO);
    comuni[k] = { ore: quali.map(n => ({
      t: j.ore[n], mm: peggio(m.map(x => x.mm?.[n])), prob: null, raffica: peggio(m.map(x => x.raffica?.[n])),
      cond: m.some(x => x.fulmini?.[n] === 1) ? 'thunderstorm' : c('grandine', n) ? 'hail' : c('neve', n) ? 'snow' : null,
    })) };
  }
  const b = j.allerte?.[iso];
  const allerte = b ? { file: `sito ${b.emesso}`, emesso: b.emesso, chiavi,
    comuni: Object.fromEntries(Object.entries(b.comuni).filter(([k]) => chiavi.includes(k))) } : null;
  return { comuni, mancano: chiavi.filter(k => !j.comuni[k]), allerte };
}

// ---------- rete (solo quando c'è) ----------
// dal nostro sito: niente esce verso terzi. 404 (lavoro non attivo) = null
export async function leggiMeteoSito(f = fetch) {
  const r = await f('meteo.json', { cache: 'no-cache', signal: AbortSignal.timeout?.(10000) });
  return r.ok ? r.json() : null;
}

// una richiesta appesa non deve tenere il meteo su «Cerco…» per sempre
const conLimite = (f, ms) => u => f(u, { signal: AbortSignal.timeout?.(ms) });

// un comune che non risponde non fa perdere gli altri: si dice in `mancano` e al giro dopo si richiede
export async function leggiMeteo(chiavi, iso, tabella, f = fetch) {
  const dopo = new Date(Date.parse(`${iso}T00:00Z`) + 864e5).toISOString().slice(0, 10);
  const prendi = conLimite(f, 10000);
  const conPunto = chiavi.filter(k => tabella[k]);
  const esiti = await Promise.allSettled(conPunto.map(async k => {
    const [lat, lon] = tabella[k];
    const r = await prendi(`https://api.brightsky.dev/weather?lat=${lat}&lon=${lon}&date=${iso}&last_date=${dopo}T01:00&tz=Europe/Rome`);
    if (!r.ok) throw new Error(`meteo ${r.status}`);
    const j = await r.json();
    const s = j.sources?.find(x => x.observation_type === 'forecast') ?? j.sources?.[0];
    return { stazione: s?.station_name ?? null, km: s ? Math.round(s.distance / 1000) : null, ore: j.weather.map(compatta) };
  }));
  const comuni = {}, mancano = [];
  esiti.forEach((e, n) => (e.status === 'fulfilled' ? (comuni[conPunto[n]] = e.value) : mancano.push(conPunto[n])));
  if (conPunto.length && !Object.keys(comuni).length) throw new Error('meteo: nessun comune ha risposto');
  return { letto: Date.now(), comuni, mancano };
}

const DPC = 'pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica';
export async function leggiAllerte(chiavi, iso, prima, noti, f = fetch) {
  const prendi = conLimite(f, 30000);
  const json = async u => { const r = await prendi(u); if (!r.ok) throw new Error(`allerte ${r.status}`); return r.json(); };
  // due richieste piccole per il nome dell'ultimo bollettino (l'elenco intero della cartella supera le 1000 voci).
  // Stile, oggi e domani arrivano in tre commit separati: dall'ultimo si prende la sigla dell'emissione e si compongono i due nomi.
  const [ultimo] = await json(`https://api.github.com/repos/${DPC}/commits?path=files/topojson&per_page=1`);
  const sigla = (await json(`https://api.github.com/repos/${DPC}/commits/${ultimo.sha}`)).files
    .map(x => /^files\/topojson\/(\d{8}_\d{4})_/.exec(x.filename)?.[1]).find(Boolean);
  const scelto = sigla && scegliBollettino(['today', 'tomorrow'].map(v => `files/topojson/${sigla}_${v}.json`), iso);
  if (!scelto) return prima ?? null;
  if (prima?.file === scelto.file && chiavi.every(k => prima.chiavi.includes(k))) return prima;
  // ~400 KB compressi (1,2 MB), una volta per bollettino
  const t = await json(`https://raw.githubusercontent.com/${DPC}/master/${scelto.file}`);
  return { ...scelto, chiavi, comuni: allerteDi(Object.values(t.objects)[0].geometries, chiavi, noti) };
}
