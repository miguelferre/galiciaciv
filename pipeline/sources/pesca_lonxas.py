"""Primera venta de pesca fresca en las lonjas de Galicia (Pesca de Galicia, Xunta), año 2025.

CSV sin cabecera, UTF-8 con BOM, separado por `;`, decimales con coma. Orden de columnas comprobado el
2026-11-26 sobre las primeras líneas (importe = kg x precio):
    fecha; grupo; código FAO; especie; provincia; zona; lonja; kg; euros; precio (euros/kg)

El CSV no trae coordenadas. CONCELLOS asigna cada lonja a un código INE de concello. Los nombres de parroquia o
puerto se comprobaron en OpenStreetMap (Nominatim) y asume que la lonja está en la localidad que le da nombre;
Coop. Ría de Arosa tiene la lonja en Abanqueiro (Boiro) según la propia cooperativa. Lo que no es inequívoco no
está en la tabla y sale en `unmatched`:
    Foz-San Cosme  el nombre junta Foz y San Cosme (Barreiros)
    Río Anllóns    es un estuario entre Ponteceso y Cabana de Bergantiños; sin fuente oficial de la sede
    Baldaio        comprobada la laguna (Carballo), no la sede de la lonja
"""

from ..core.source import Source, SourceInfo

YEAR = 2025
URL = f"https://www.pescadegalicia.com/descargas/pescafresca/pescafresca{YEAR}.csv"
REL = f"pescafresca{YEAR}.csv"
HEADERS = {"User-Agent": "galiciaciv/0.1 (open data pipeline)"}
TOP = 5
PROVINCE_CODE = {"A Coruña": "15", "Lugo": "27", "Pontevedra": "36"}

# lonja (tal como viene en el CSV) -> código INE del concello
CONCELLOS = {
    # A Coruña
    "A Coruña (Confraría)": "15030",
    "A Coruña (Lonja Coruña, S.A.)": "15030",
    "Aguiño": "15073",  # Ribeira
    "Barallobre": "15035",  # Fene
    "Cabo de Cruz": "15011",  # Boiro
    "Camariñas": "15016",
    "Camelle": "15016",  # Camariñas
    "Cariño.": "15901",
    "Carnota (Lira)": "15020",
    "Carnota (O Pindo)": "15020",
    "Cedeira": "15022",
    "Coop. Ría de Arosa": "15011",  # Abanqueiro, Boiro
    "Corcubión": "15028",
    "Corme": "15068",  # Ponteceso
    "Esteiro": "15053",  # Muros (zona IV)
    "Ferrol": "15036",
    "Fisterra": "15037",
    "Laxe": "15040",
    "Malpica": "15043",  # Malpica de Bergantiños
    "Miño": "15048",
    "Mugardos": "15051",
    "Muros": "15053",
    "Muxía": "15052",
    "Noia": "15057",
    "O Barqueiro": "15044",  # Mañón
    "Ortigueira": "15061",
    "Pobra do Caramiñal": "15067",
    "Pontedeume": "15069",
    "Porto do Son": "15071",
    "Portosín": "15071",  # Porto do Son
    "Rianxo": "15072",
    "Ribeira.": "15073",
    "Sada": "15075",
    # Lugo
    "Burela": "27902",
    "Celeiro": "27066",  # Viveiro
    "Ribadeo": "27051",
    # Pontevedra
    "A Guarda": "36023",
    "A Illa de Arousa": "36901",
    "Aldán-Hio": "36008",  # Cangas
    "Arcade": "36053",  # Soutomaior
    "Baiona": "36003",
    "Bueu": "36004",
    "Cambados": "36006",
    "Campelo": "36041",  # Poio
    "Cangas": "36008",
    "Carril": "36060",  # Vilagarcía de Arousa
    "Marín": "36026",
    "Moaña": "36029",
    "O Grove": "36022",
    "Panxón": "36035",  # Nigrán
    "Portonovo": "36051",  # Sanxenxo
    "Redondela": "36045",
    "Vigo": "36057",
    "Vigo (Canido)": "36057",
    "Vilaboa": "36058",
    "Vilanova": "36061",  # Vilanova de Arousa
    "Vilaxoán": "36060",  # Vilagarcía de Arousa
}


def _num(text):
    if "." in text:  # el fichero usa coma decimal y sin separador de millares; un punto cambiaría la lectura
        raise ValueError(f"número con punto: {text!r}")
    return float(text.replace(",", "."))


class PescaLonxas(Source):
    info = SourceInfo(
        id="pesca_lonxas",
        title=f"Pesca fresca en lonja, {YEAR}",
        publisher="Xunta de Galicia, Pesca de Galicia (Plataforma tecnolóxica da pesca)",
        homepage="https://www.pescadegalicia.gal/",
        license="Aviso legal del portal: reutilización permitida, comercial y no comercial, citando la fuente y sin "
        "desnaturalizar el contenido (pescadegalicia.com/gl/aviso-legal). Un conjunto abierto relacionado de la Xunta es "
        "CC BY-SA 4.0.",
        description=f"Ventas de primera venta de pesca fresca y marisqueo de {YEAR} agregadas por lonja: kilos, euros y "
        f"las {TOP} especies de más importe (nombres en gallego, como en el origen). Cada lonja se asigna a un concello "
        "con una tabla manual; las de ubicación no inequívoca quedan sin asignar. El importe es el del puerto de venta, "
        "no el de residencia de la flota.",
        used_for=["Pesca en lonja (euros y kilos por concello con lonja)"],
    )

    def fetch(self, force=False):
        self.download(URL, REL, force=force, headers=HEADERS, expect_binary=True)

    def process(self):
        lonjas, bad, total, rows = {}, [], 0.0, 0
        with open(self.raw_dir / REL, encoding="utf-8-sig") as f:
            for n, line in enumerate(f, 1):
                r = [c.strip() for c in line.rstrip("\r\n").split(";")]
                if r == [""]:
                    continue
                try:
                    if len(r) != 10 or not r[0].endswith(f"/{YEAR}"):
                        raise ValueError("columnas o año inesperados")
                    kg, eur = _num(r[7]), _num(r[8])
                except ValueError as exc:
                    bad.append((n, str(exc)))
                    continue
                rows += 1
                total += eur
                d = lonjas.setdefault(r[6], {"kg": 0.0, "eur": 0.0, "provinces": set(), "species": {}})
                d["kg"] += kg
                d["eur"] += eur
                d["provinces"].add(r[4])
                d["species"][r[3]] = d["species"].get(r[3], 0.0) + eur
        if bad:
            raise RuntimeError(f"pesca_lonxas: {len(bad)} líneas ilegibles, primeras: {bad[:5]}")

        out, unmatched = [], []
        for raw_name, d in sorted(lonjas.items(), key=lambda kv: -kv[1]["eur"]):
            name = raw_name.rstrip(".") if raw_name in ("Ribeira.", "Cariño.") else raw_name
            code = CONCELLOS.get(raw_name)
            if code is None:
                unmatched.append({"name": name, "eur": round(d["eur"], 2)})
                continue
            if len(d["provinces"]) != 1:
                raise RuntimeError(f"pesca_lonxas: {raw_name} aparece en varias provincias {d['provinces']}")
            province = next(iter(d["provinces"]))
            if PROVINCE_CODE.get(province) != code[:2]:
                raise RuntimeError(f"pesca_lonxas: {raw_name} ({province}) asignada a {code}, de otra provincia")
            top = sorted(d["species"].items(), key=lambda kv: (-kv[1], kv[0]))[:TOP]
            out.append({
                "name": name, "concello": code, "province": province,
                "kg": round(d["kg"], 3), "eur": round(d["eur"], 2),
                "top_species": [{"name": s, "eur": round(e, 2)} for s, e in top],
            })
        gone = sorted(set(CONCELLOS) - set(lonjas))
        parts = sum(l["eur"] for l in out) + sum(u["eur"] for u in unmatched)
        if abs(parts - total) > 1:
            raise RuntimeError(f"pesca_lonxas: las lonjas suman {parts:.2f} y el fichero {total:.2f}")
        print(f"    {rows} ventas, {len(lonjas)} lonjas, {total / 1e6:.1f} M€, "
              f"{sum(d['kg'] for d in lonjas.values()) / 1e6:.1f} M kg")
        print(f"    sin concello: {[(u['name'], u['eur']) for u in unmatched]}")
        if gone:
            print(f"    en la tabla pero sin ventas este año: {gone}")
        return {
            "vintage": f"Pesca de Galicia, primera venta de pesca fresca {YEAR}",
            "year": YEAR,
            "lonjas": out,
            "unmatched": unmatched,
            "total_eur": round(total, 2),
            "_files": [REL],
        }
