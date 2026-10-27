"""Lavoro giornaliero (GitHub Actions): il meteo dei comuni della zona, ora per ora, oggi e domani.

Fonti, tutte ammesse anche per lavoro:
- AROME 1,3 km di Météo-France (Licence Ouverte 2.0: «à des fins commerciales ou non»): pioggia+neve+graupel, raffiche
- ICON-2I 2,2 km di ItaliaMeteo-ARPAE (CC BY 4.0): pioggia, raffiche, potenziale di fulmini (LPI)
- bollettino di allerta della Protezione Civile (CC BY 4.0)
Scrive meteo.json, che il sito pubblica accanto all'app: il telefono lo legge dal NOSTRO sito e non chiede niente a nessun altro.
I file dei modelli pesano 20-80 MB: si leggono solo le intestazioni e i messaggi che servono (richieste a intervalli di byte).

Uso:   python strumenti/meteo_giornaliero.py [uscita.json]
Prova: python strumenti/meteo_giornaliero.py --prova
"""
import json
import os
import re
import struct
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

QUI = Path(__file__).resolve().parent
sys.path.insert(0, str(QUI))
from comuni import chiave  # noqa: E402  stessa regola di app/meteo.js

AREA = (45.30, 46.25, 8.40, 9.55)  # sud, nord, ovest, est: Varese, Milano, Como, Monza, Novara est (749 comuni)
LPI_TEMPORALE = 1.0  # ponytail: J/kg, soglia mia per «temporale» da ICON-2I; da tarare guardando giorni veri
UTC = timezone.utc


# ---------- tempo: ora italiana senza dipendenze (le regole UE dal 1996) ----------
def _ultima_domenica(anno, mese):
    d = date(anno, mese + 1, 1) - timedelta(days=1)
    return d - timedelta(days=(d.weekday() + 1) % 7)


def offset_roma(t):
    """ore di differenza da UTC: +2 dall'ultima domenica di marzo all'ultima di ottobre (cambio alle 01:00 UTC), sennò +1"""
    inizio = datetime.combine(_ultima_domenica(t.year, 3), datetime.min.time(), UTC) + timedelta(hours=1)
    fine = datetime.combine(_ultima_domenica(t.year, 10), datetime.min.time(), UTC) + timedelta(hours=1)
    return 2 if inizio <= t < fine else 1


def ore_dei_giorni(giorno, giorni=2):
    """fine di ogni ora (UTC) le cui ore locali cadono in `giorno` e nei giorni dopo: 48 ore, 47 o 49 al cambio d'ora"""
    base = datetime(giorno.year, giorno.month, giorno.day, tzinfo=UTC)
    out = []
    for h in range(-3, 24 * giorni + 3):
        t = base + timedelta(hours=h)
        prima = t - timedelta(hours=1)
        if giorno <= (prima + timedelta(hours=offset_roma(prima))).date() < giorno + timedelta(days=giorni):
            out.append(t)
    return out


def locale(t):
    """come Bright Sky con tz=Europe/Rome, così l'app lo legge con lo stesso codice"""
    o = offset_roma(t)
    return (t + timedelta(hours=o)).strftime("%Y-%m-%dT%H:%M:%S") + f"+0{o}:00"


# ---------- numeri ----------
def orarie(cumulate):
    """da cumulate dall'inizio della corsa a millimetri ora per ora; un buco resta buco, un calo (arrotondamenti) vale 0"""
    out = []
    for prima, dopo in zip(cumulate, cumulate[1:]):
        out.append(None if prima is None or dopo is None else round(max(0.0, dopo - prima), 1))
    return out


def kmh(u, v=None):
    return None if u is None else round(3.6 * (u if v is None else (u * u + v * v) ** 0.5))


# ---------- rete ----------
_locale = threading.local()
_lucchetto = threading.Lock()


def _sessione():
    import requests
    if not hasattr(_locale, "s"):
        _locale.s = requests.Session()
        _locale.s.headers["User-Agent"] = "giro-meteo/1.0 (lavoro giornaliero, una app per un tecnico)"
    return _locale.s


def prendi(url, a=None, b=None, **kw):
    extra = kw.pop("headers", {})  # fuori dal ciclo: anche i nuovi tentativi devono averle
    for tentativo in range(4):
        try:
            h = {"Range": f"bytes={a}-{b}"} if a is not None else {}
            r = _sessione().get(url, headers={**h, **extra}, timeout=90, **kw)
            r.raise_for_status()
            return r
        except Exception:
            if tentativo == 3:
                raise
            time.sleep(2 * (tentativo + 1))


def messaggi(url, fino=None):
    """(inizio, lunghezza, categoria, numero) dei messaggi GRIB2 del file (i primi `fino`), leggendo solo le intestazioni"""
    tot = int(prendi(url, 0, 15).headers["Content-Range"].split("/")[1])
    out, off = [], 0
    while off < tot and (fino is None or len(out) < fino):
        b = prendi(url, off, off + 511).content
        if b[:4] != b"GRIB":
            raise ValueError(f"non è GRIB a {off}: {url}")
        lung = struct.unpack(">Q", b[8:16])[0]
        p, cat, num = 16, None, None
        while p + 10 < len(b):
            sez = struct.unpack(">I", b[p:p + 4])[0]
            if b[p + 4] == 4:
                cat, num = b[p + 9], b[p + 10]
                break
            p += sez
        out.append((off, lung, cat, num))
        off += lung
    return out


class Griglia:
    """indici dei punti di griglia più vicini ai comuni, calcolati una volta per griglia"""

    def __init__(self, g, punti):
        import eccodes
        import numpy as np
        lats, lons = eccodes.codes_get_array(g, "latitudes"), eccodes.codes_get_array(g, "longitudes")
        lons = np.where(lons > 180, lons - 360, lons)
        dentro = (lats > AREA[0] - 0.2) & (lats < AREA[1] + 0.2) & (lons > AREA[2] - 0.2) & (lons < AREA[3] + 0.2)
        vicini = np.nonzero(dentro)[0]
        self.indici = {}
        for k, (la, lo) in punti.items():
            d = (lats[vicini] - la) ** 2 + ((lons[vicini] - lo) * np.cos(np.radians(la))) ** 2
            self.indici[k] = int(vicini[int(np.argmin(d))])
        self.distanza_max_km = max(
            111 * float(np.hypot(lats[i] - punti[k][0], (lons[i] - punti[k][1]) * np.cos(np.radians(punti[k][0]))))
            for k, i in self.indici.items())


def valori(contenuto, griglie, punti):
    """{comune: valore} da un messaggio GRIB; il valore mancante del file (9999) diventa None"""
    import eccodes
    # si scarica in parallelo, si decodifica in fila: eccodes, alla prima lettura, carica le sue definizioni e con più fili
    # insieme non le trova («no definitions found»); la griglia (AROME: 5 milioni di punti) si calcola così una volta sola
    with _lucchetto:
        g = eccodes.codes_new_from_message(contenuto)
        try:
            chiave_griglia = tuple(eccodes.codes_get(g, k) for k in ("gridType", "Ni", "Nj"))
            if chiave_griglia not in griglie:
                griglie[chiave_griglia] = Griglia(g, punti)
            v = eccodes.codes_get_values(g)
            manca = eccodes.codes_get(g, "missingValue")
            passo = eccodes.codes_get(g, "endStep")
            return passo, {k: (None if v[i] == manca else float(v[i])) for k, i in griglie[chiave_griglia].indici.items()}
        finally:
            eccodes.codes_release(g)


# ---------- AROME (Météo-France) ----------
AROME = "https://meteofrance-pnt.s3.rbx.io.cloud.ovh.net/pnt/{c}/arome/001/{p}/arome__001__{p}__{h:02d}H__{c}.grib2"
AROME_FINE = 51  # ogni corsa arriva all'ora 51 (letto il 27/10 su sei corse: l'ora 52 non esiste)
SP2 = {(1, 65): 0, (1, 66): 1, (1, 75): 2}  # pioggia, neve, graupel: cumulate dall'inizio della corsa


def corse_arome(adesso):
    """le corse AROME (ogni 3 ore) delle ultime 12 ore, dalla più recente: i file di una corsa arrivano 2-4 ore dopo"""
    ultima = adesso.replace(minute=0, second=0, microsecond=0) - timedelta(hours=adesso.hour % 3)
    return [ultima - timedelta(hours=3 * n) for n in range(4)]


def arome(ore, punti, adesso=None):
    # gli indirizzi si compongono dal nome: l'elenco di data.gouv, mentre arriva una corsa, mescola file di due corse
    for inizio in corse_arome(adesso or datetime.now(UTC)):
        c = inizio.strftime("%Y-%m-%dT%H:%M:%SZ")
        passi = {t: int((t - inizio).total_seconds() // 3600) for t in ore}
        ultimo = min(max(passi.values()), AROME_FINE)
        # i file di una corsa arrivano in ordine di ora: se c'è l'ultimo che serve, ci sono tutti
        if all(_sessione().head(AROME.format(c=c, p=p, h=ultimo), timeout=30).status_code == 200 for p in ("SP1", "SP2")):
            break
    else:
        raise RuntimeError("nessuna corsa completa nelle ultime 12 ore")
    # anche il passo prima di ogni ora: la pioggia di un'ora è la differenza fra due cumulate
    servono = sorted({x for s in passi.values() for x in (s - 1, s) if 1 <= x <= AROME_FINE})
    griglie = {}

    def un_passo(s):
        try:
            letti = {}
            for p, voglio in (("SP2", set(SP2)), ("SP1", {(2, 23), (2, 24)})):
                url = AROME.format(c=c, p=p, h=s)
                for off, lung, cat, num in messaggi(url):
                    if (cat, num) in voglio:
                        letti[(cat, num)] = valori(prendi(url, off, off + lung - 1).content, griglie, punti)[1]
            if not set(SP2) <= set(letti):  # una pioggia non trovata non deve diventare «asciutto»
                raise ValueError(f"ora {s}: trovati {sorted(letti)}")
            acqua = {k: None if any(letti[x][k] is None for x in SP2) else tuple(letti[x][k] for x in SP2) for k in punti}
            u, w = letti.get((2, 23), {}), letti.get((2, 24), {})
            return s, acqua, {k: None if u.get(k) is None or w.get(k) is None else kmh(u[k], w[k]) for k in punti}
        except Exception as e:  # noqa: BLE001  un file che manca toglie solo le sue ore
            return s, None, str(e)

    with ThreadPoolExecutor(8) as ex:
        fatti = list(ex.map(un_passo, servono))
    mancano = [s for s, a, _ in fatti if a is None]
    if len(mancano) == len(servono):
        raise RuntimeError(f"nessuna ora letta: {fatti[0][2]}")
    cum = {0: {k: (0.0, 0.0, 0.0) for k in punti}, **{s: a for s, a, _ in fatti if a is not None}}  # all'inizio non è caduto niente
    raffiche = {s: r for s, a, r in fatti if a is not None}
    out = {}
    for k in punti:
        def ogni(f):
            return [orarie([f(cum.get(passi[t] - 1, {}).get(k)), f(cum.get(passi[t], {}).get(k))])[0]
                    if 1 <= passi[t] <= AROME_FINE else None for t in ore]
        out[k] = {"mm": ogni(lambda x: None if x is None else sum(x)),
                  "raffica": [raffiche.get(passi[t], {}).get(k) for t in ore]}
        for nome, i in (("neve", 1), ("grandine", 2)):  # solo dove c'è: d'estate e quasi ovunque è tutto zero
            v = ogni(lambda x, i=i: None if x is None else x[i])
            if any(v):
                out[k][nome] = v
    info = {"corsa": inizio.strftime("%Y-%m-%dT%H:%MZ"), "distanza_max_km": round(max(g.distanza_max_km for g in griglie.values()), 2)}
    return {**info, "ore_mancanti": mancano} if mancano else info, out


# ---------- ICON-2I (ItaliaMeteo-ARPAE) ----------
ICON = "https://meteohub.agenziaitaliameteo.it/nwp/ICON-2I_SURFACE_PRESSURE_LEVELS/"


def recenti(corse, adesso, ore=24):
    """le corse (AAAAMMGGHH) di meno di `ore` ore, dalla più recente: ICON-2I gira alle 00 e alle 12, e una ne può saltare"""
    inizio = lambda c: datetime.strptime(c, "%Y%m%d%H").replace(tzinfo=UTC)  # noqa: E731
    return sorted((c for c in set(corse) if adesso - inizio(c) <= timedelta(hours=ore)), reverse=True)


def icon2i(ore, punti, adesso=None, prima=None):
    corse = recenti(re.findall(r'href="(\d{10})/', prendi(ICON).text), adesso or datetime.now(UTC))
    saltate = []
    for corsa in corse:  # la più recente completa: una corsa appena uscita può avere file a metà
        # già letta dal giro prima, per le stesse ore: non si riscarica (MeteoHub chiede un uso misurato)
        if prima and prima[0].get("corsa") == datetime.strptime(corsa, "%Y%m%d%H").strftime("%Y-%m-%dT%H:%MZ"):
            return {**prima[0], "saltate": saltate, "riusata": True}, prima[1]
        try:
            info, dati = _icon_corsa(corsa, ore, punti)
            return {**info, "saltate": saltate}, dati  # si vede nel resoconto, non succede in silenzio
        except Exception as e:  # noqa: BLE001
            saltate.append(f"{corsa}: {e}")
    raise RuntimeError(f"nessuna corsa completa nelle ultime 24 ore ({saltate})")


def _icon_corsa(corsa, ore, punti):
    inizio = datetime.strptime(corsa, "%Y%m%d%H").replace(tzinfo=UTC)
    passi = {t: int((t - inizio).total_seconds() // 3600) for t in ore}
    # il passo 0 non si scarica: all'inizio della corsa non è caduto niente (e eccodes lo dà come «0m», in minuti)
    servono = {x for s in passi.values() if s >= 1 for x in (s - 1, s) if x >= 1}
    griglie, campi = {}, {}
    for var in ("TOT_PREC", "VMAX_10M", "LPI"):
        nome = re.findall(r'href="([^"]+\.grib)"', prendi(f"{ICON}{corsa}/{var}/").text)[0]
        url = f"{ICON}{corsa}/{var}/{nome}"
        elenco = messaggi(url, max(servono) + 1)  # le intestazioni oltre l'ultimo passo che serve non si leggono
        if len(elenco) - 1 < max(servono):
            raise ValueError(f"{var} {corsa}: {len(elenco)} messaggi, ne servono {max(servono) + 1}")
        # i messaggi sono in ordine di passo (0, 1, 2…): si scaricano solo quelli che servono, e si controlla il passo
        with ThreadPoolExecutor(8) as ex:
            letti = ex.map(lambda s: valori(prendi(url, elenco[s][0], elenco[s][0] + elenco[s][1] - 1).content, griglie, punti),
                           sorted(servono))
            campi[var] = {}
            for s, (passo, v) in zip(sorted(servono), letti):
                if passo != s:
                    raise ValueError(f"{var}: il messaggio {s} ha passo {passo}")
                campi[var][s] = v
    out = {}
    for k in punti:
        tp = lambda s: 0.0 if s == 0 else campi["TOT_PREC"].get(s, {}).get(k)  # noqa: E731
        out[k] = {"mm": [orarie([tp(passi[t] - 1), tp(passi[t])])[0] if passi[t] >= 1 else None for t in ore],
                  "raffica": [kmh(campi["VMAX_10M"].get(passi[t], {}).get(k)) if passi[t] >= 1 else None for t in ore],
                  "fulmini": [None if passi[t] < 1 or campi["LPI"].get(passi[t], {}).get(k) is None
                              else int(campi["LPI"][passi[t]][k] >= LPI_TEMPORALE) for t in ore]}
    return {"corsa": inizio.strftime("%Y-%m-%dT%H:%MZ"), "distanza_max_km": round(max(g.distanza_max_km for g in griglie.values()), 2)}, out


# ---------- allerte della Protezione Civile ----------
DPC = "pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica"
RISCHI = [("Per rischio temporali", "temporali"), ("Per rischio idrogeologico", "rischio idrogeologico"),
          ("Per rischio idraulico", "rischio idraulico")]


def allerte_di(zone, chiavi, noti):
    """come allerteDi in app/meteo.js: le zone di un comune si sommano, quella di un omonimo lontano si scarta"""
    out = {}
    for z in zone:
        p = z["properties"]
        comuni = [chiave(c) for c in p.get("Comuni", [])]
        if sum(k in noti for k in comuni) * 2 < len(comuni):
            continue
        allerte = []
        for campo, nome in RISCHI:
            m = re.search(r"ALLERTA (GIALLA|ARANCIONE|ROSSA)", p.get(campo) or "")
            if m:
                allerte.append(f"Allerta {m[1].lower()} per {nome}")
        for k in set(comuni) & set(chiavi):
            prima = out.get(k)
            out[k] = {"zona": p["Nome zona"], "allerte": allerte} if not prima else {
                "zona": f'{prima["zona"]}, {p["Nome zona"]}', "allerte": list(dict.fromkeys(prima["allerte"] + allerte))}
    return out


def allerte(chiavi, noti):
    tok = os.environ.get("GITHUB_TOKEN")  # nel lavoro: 1000 richieste l'ora per repository invece di 60 per indirizzo
    h = {"Authorization": f"Bearer {tok}"} if tok else {}
    api = f"https://api.github.com/repos/{DPC}"
    sha = prendi(f"{api}/commits?path=files/topojson&per_page=1", headers=h).json()[0]["sha"]
    nomi = [f["filename"] for f in prendi(f"{api}/commits/{sha}", headers=dict(h)).json()["files"]]
    sigla = next(m[1] for n in nomi if (m := re.match(r"files/topojson/(\d{8}_\d{4})_", n)))
    emesso = f"{sigla[6:8]}/{sigla[4:6]} alle {sigla[9:11]}:{sigla[11:13]}"
    giorno = datetime.strptime(sigla[:8], "%Y%m%d").date()
    out = {}
    for variante, quando in (("today", giorno), ("tomorrow", giorno + timedelta(days=1))):
        t = prendi(f"https://raw.githubusercontent.com/{DPC}/master/files/topojson/{sigla}_{variante}.json").json()
        tutte = allerte_di(next(iter(t["objects"].values()))["geometries"], chiavi, noti)
        out[quando.isoformat()] = {"emesso": emesso, "comuni": {k: v for k, v in tutte.items() if v["allerte"]}}
    return out


# ---------- insieme ----------
def principale(uscita):
    tab = json.loads(next(p for p in (QUI.parent / "app" / "comuni.json", QUI.parent / "comuni.json") if p.exists()).read_text("utf-8"))
    punti = {k: v for k, v in tab.items() if AREA[0] <= v[0] <= AREA[1] and AREA[2] <= v[1] <= AREA[3]}
    adesso = datetime.now(UTC)
    oggi = (adesso + timedelta(hours=offset_roma(adesso))).date()
    ore = ore_dei_giorni(oggi)
    risultato = {"creato": adesso.strftime("%Y-%m-%dT%H:%MZ"), "ore": [locale(t) for t in ore], "modelli": {}, "comuni": {}, "allerte": {}, "errori": []}
    # il giro prima (nel lavoro: scaricato dal sito). Resta pubblicato se questo giro non arriva in fondo
    try:
        vecchio = json.loads(Path(uscita).read_text("utf-8"))
        prima_icon = ({**vecchio["modelli"]["icon2i"]}, {k: v["icon2i"] for k, v in vecchio["comuni"].items() if "icon2i" in v}) \
            if vecchio["ore"] == risultato["ore"] else None
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        prima_icon = None
    for nome, fonte, leggi in (("arome", "AROME 1,3 km · Météo-France · Licence Ouverte 2.0", lambda: arome(ore, punti, adesso)),
                               ("icon2i", "ICON-2I 2,2 km · ItaliaMeteo-ARPAE · CC BY 4.0", lambda: icon2i(ore, punti, adesso, prima_icon))):
        t0 = time.time()
        try:
            info, dati = leggi()
            risultato["modelli"][nome] = {"fonte": fonte, **info, "secondi": round(time.time() - t0)}
            for k, v in dati.items():
                risultato["comuni"].setdefault(k, {})[nome] = v
        except Exception as e:  # noqa: BLE001  un modello che manca non ferma l'altro
            risultato["errori"].append(f"{nome}: {e}")
    try:
        risultato["allerte"] = allerte(list(punti), set(tab))
    except Exception as e:  # noqa: BLE001
        risultato["errori"].append(f"allerte: {e}")
    if not risultato["modelli"]:
        print("nessun modello letto:", risultato["errori"], file=sys.stderr)
        return 1
    # prima un file a parte, poi lo scambio: un lavoro fermato a metà scrittura non lascia un json rotto
    Path(f"{uscita}.tmp").write_text(json.dumps(risultato, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(f"{uscita}.tmp", uscita)
    print(f"comuni {len(risultato['comuni'])}, ore {len(ore)}, modelli {list(risultato['modelli'])}, "
          f"byte {Path(uscita).stat().st_size}, errori {risultato['errori']}")
    for n, m in risultato["modelli"].items():
        print(f"  {n}: corsa {m['corsa']}, {m['secondi']} s, punto di griglia più lontano {m['distanza_max_km']} km, "
              f"saltate {m.get('saltate', [])}, ore mancanti {m.get('ore_mancanti', [])}, riusata {m.get('riusata', False)}")
    return 0


def prova():
    assert offset_roma(datetime(2026, 3, 29, 0, 59, tzinfo=UTC)) == 1 and offset_roma(datetime(2026, 3, 29, 1, 0, tzinfo=UTC)) == 2
    assert offset_roma(datetime(2026, 10, 25, 0, 59, tzinfo=UTC)) == 2 and offset_roma(datetime(2026, 10, 25, 1, 0, tzinfo=UTC)) == 1
    assert len(ore_dei_giorni(date(2026, 10, 28))) == 48
    assert len(ore_dei_giorni(date(2026, 3, 28))) == 47 and len(ore_dei_giorni(date(2026, 10, 24))) == 49
    o = ore_dei_giorni(date(2026, 10, 28))
    assert locale(o[0]) == "2026-10-28T01:00:00+01:00" and locale(o[-1]) == "2026-10-30T00:00:00+01:00"
    assert locale(ore_dei_giorni(date(2026, 7, 1))[0]) == "2026-07-01T01:00:00+02:00"
    assert orarie([0.0, 0.0, 1.25, 1.2, None, 3.0]) == [0.0, 1.2, 0.0, None, None]  # 1,25 → 1,2 (arrotondamento pari)
    assert kmh(3.0, 4.0) == 18 and kmh(10.0) == 36 and kmh(None) is None
    utc = lambda *a: datetime(*a, tzinfo=UTC)  # noqa: E731
    assert corse_arome(utc(2026, 10, 27, 21, 28)) == [utc(2026, 10, 27, h) for h in (21, 18, 15, 12)]
    assert corse_arome(utc(2026, 10, 28, 1, 5))[:2] == [utc(2026, 10, 28, 0), utc(2026, 10, 27, 21)]
    assert recenti(["2026102712", "2026102700", "2026102612", "2026102712"], utc(2026, 10, 28, 4, 20)) == ["2026102712"]
    assert recenti(["2026102712", "2026102800"], utc(2026, 10, 28, 4, 20)) == ["2026102800", "2026102712"]
    noti = {"ASTI", "CANELLI", "LIVO", "GRAVEDONA"}
    z = lambda nome, comuni, t: {"properties": {"Nome zona": nome, "Comuni": comuni, "Per rischio temporali": t}}  # noqa: E731
    a = allerte_di([z("Belbo", ["Asti", "Canelli"], "Moderata criticità / ALLERTA ARANCIONE"), z("Pianura", ["Asti"], "NESSUNA ALLERTA"),
                    z("Lario", ["Livo", "Gravedona"], "Ordinaria criticità / ALLERTA GIALLA"), z("Trento", ["Livo", "Trento", "Arco"], "ALLERTA ROSSA")],
                   ["ASTI", "LIVO"], noti)
    assert a == {"ASTI": {"zona": "Belbo, Pianura", "allerte": ["Allerta arancione per temporali"]},
                 "LIVO": {"zona": "Lario", "allerte": ["Allerta gialla per temporali"]}}, a
    print("prova: ok")
    return 0


if __name__ == "__main__":
    sys.exit(prova() if "--prova" in sys.argv else principale(sys.argv[1] if len(sys.argv) > 1 else "meteo.json"))
