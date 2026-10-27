# Coordinate dei comuni di Lombardia e Piemonte per il meteo: escono da qui una volta, poi stanno nell'app (app/comuni.json).
# Fonte: Wikidata (CC0), codice ISTAT + coordinate del centro. Il telefono così non chiede a nessuno dove sta un comune:
# a Bright Sky va solo il punto del comune, arrotondato al centesimo di grado (~1 km).
# Uso: python strumenti/comuni.py   (rigenera app/comuni.json)
import json, re, sys, unicodedata, urllib.parse, urllib.request
from pathlib import Path

# province (prime 3 cifre del codice ISTAT del comune)
LOMBARDIA = {"012", "013", "014", "015", "016", "017", "018", "019", "020", "097", "098", "108"}
PIEMONTE = {"001", "002", "003", "004", "005", "006", "096", "103"}

QUERY = """SELECT ?istat ?nome ?coord WHERE {
  ?c wdt:P31 wd:Q747074 ; wdt:P635 ?istat ; wdt:P625 ?coord .
  FILTER NOT EXISTS { ?c wdt:P576 [] }
  ?c rdfs:label ?nome . FILTER(LANG(?nome) = "it")
}"""


def chiave(nome):
    """Stessa regola di chiave() in app/meteo.js: maiuscolo, senza accenti, solo lettere e cifre separate da uno spazio."""
    s = unicodedata.normalize("NFD", nome.upper())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^A-Z0-9]+", " ", s).strip()


def main():
    url = "https://query.wikidata.org/sparql?format=json&query=" + urllib.parse.quote(QUERY)
    r = urllib.request.Request(url, headers={"User-Agent": "giro-riccardo/1.0 (strumento una tantum)"})
    righe = json.load(urllib.request.urlopen(r, timeout=120))["results"]["bindings"]
    tab, doppi = {}, 0
    for x in sorted(righe, key=lambda x: x["istat"]["value"]):
        if x["istat"]["value"][:3] not in LOMBARDIA | PIEMONTE:
            continue
        lon, lat = map(float, re.findall(r"-?\d+\.?\d*", x["coord"]["value"]))
        k = chiave(x["nome"]["value"])
        if k in tab:
            doppi += 1  # stesso nome in due province: si tiene il primo per codice ISTAT
            continue
        tab[k] = [round(lat, 2), round(lon, 2)]
    out = Path(__file__).resolve().parent.parent / "app" / "comuni.json"
    out.write_text(json.dumps(tab, separators=(",", ":"), ensure_ascii=True), encoding="utf-8")
    print(f"comuni: {len(tab)}, nomi doppi saltati: {doppi}, byte: {out.stat().st_size}")


if __name__ == "__main__":
    sys.exit(main())
