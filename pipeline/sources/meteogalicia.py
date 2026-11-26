"""MeteoGalicia: annual temperature, precipitation, wind, sunshine and humidity by weather station (keyless JSON).

Endpoints (servizos.meteogalicia.gal/mgrss/observacion):
  listaEstacionsMeteo.action            -> station list (id, name, concello, lat, lon, altitude)
  datosMensuaisEstacionsMeteo.action    -> monthly values; idEst (comma list), idParam, dataIni, dataFin (dd/MM/yyyy)
Parameters: TA_AVG_1.5m (monthly mean air temperature, degC), PP_SUM_1.5m (monthly rainfall, L/m2 = mm),
VV_AVG_10m (monthly mean wind speed at 10 m, m/s), HSOL_SUM_1.5m (monthly sunshine hours, h) and
HR_AVG_1.5m (monthly mean relative humidity, %).
Annual temperature, wind and humidity = mean of the 12 monthly means; annual precipitation and sunshine = sum of
the 12 monthly totals; only validated values (lnCodigoValidacion 1) are used and only years with all 12 months
present for that parameter count. Besides the last complete year, a mean over the last 5 complete years (needs 3
or more complete years) is given, because one year is noisy.
"""

from __future__ import annotations

import json
from datetime import date

from ..core.source import Source, SourceInfo

BASE = "https://servizos.meteogalicia.gal/mgrss/observacion"
LIST_FILE = "estacions.json"
PARAMS = "TA_AVG_1.5m,PP_SUM_1.5m,VV_AVG_10m,HSOL_SUM_1.5m,HR_AVG_1.5m"
MONTHLY_PREFIX = "mensual5"  # the older two-parameter cache was "mensual_<y0>_<y1>.json"
EXPECTED_UNITS = {"TA_AVG_1.5m": "ºC", "PP_SUM_1.5m": "L/m2", "VV_AVG_10m": "m/s", "HSOL_SUM_1.5m": "h", "HR_AVG_1.5m": "%"}
SPAN = 5  # years in the multi-year mean
MIN_YEARS = 3


def _years():
    last = date.today().year - 1
    return last - SPAN + 1, last


class MeteoGalicia(Source):
    info = SourceInfo(
        id="meteogalicia",
        title="Estaciones meteorológicas de MeteoGalicia: temperatura, precipitación, viento, sol y humedad",
        publisher="MeteoGalicia (Xunta de Galicia)",
        homepage="https://www.meteogalicia.gal/",
        license="Aviso legal de MeteoGalicia: uso libre y gratuito citando a MeteoGalicia y a la Consellería de Medio Ambiente e Cambio Climático (Xunta de Galicia)",
        description="Temperatura media anual, precipitación anual, velocidad media del viento a 10 m, horas de sol "
        "al año y humedad relativa media en cada estación de MeteoGalicia, del último año completo y como media "
        "de los últimos 5 años completos, a partir de observaciones mensuales validadas.",
        used_for=["Lente de clima (temperatura, precipitación, viento, sol y humedad)",
                  "Rendimiento de Alimento (condiciones de cultivo)"],
    )

    def _monthly_name(self, y0, y1):
        return f"{MONTHLY_PREFIX}_{y0}_{y1}.json"

    def fetch(self, force=False):
        if self.offline:
            return
        self.download(f"{BASE}/listaEstacionsMeteo.action", LIST_FILE, force=force, expect_binary=False)
        stations = json.loads((self.raw_dir / LIST_FILE).read_text(encoding="utf-8"))["listaEstacionsMeteo"]
        ids = ",".join(str(s["idEstacion"]) for s in stations)
        y0, y1 = _years()
        url = (f"{BASE}/datosMensuaisEstacionsMeteo.action?idEst={ids}&idParam={PARAMS}"
               f"&dataIni=01/01/{y0}&dataFin=31/12/{y1}")
        self.download(url, self._monthly_name(y0, y1), force=force)
        # the old two-parameter files are superseded: forget them so the manifest cites only files in use
        for old in sorted(self.raw_dir.glob("mensual_[0-9]*.json")):
            self.discard(old.name)

    def process(self):
        files = sorted(self.raw_dir.glob(f"{MONTHLY_PREFIX}_*.json"))
        if not files:
            raise FileNotFoundError("no cached MeteoGalicia monthly file; run fetch first")
        mfile = files[-1]
        y0, y1 = (int(x) for x in mfile.stem.split("_")[-2:])
        stations = json.loads((self.raw_dir / LIST_FILE).read_text(encoding="utf-8"))["listaEstacionsMeteo"]
        meta = {s["idEstacion"]: s for s in stations}
        monthly = json.loads(mfile.read_text(encoding="utf-8"))["listDatosMensuais"]
        # vals[id][param][year][month] = value
        vals: dict = {}
        units: dict = {}
        for rec in monthly:
            year, month = int(rec["data"][:4]), int(rec["data"][5:7])
            for e in rec["listaEstacions"]:
                for m in e["listaMedidas"]:
                    # lnCodigoValidacion: 1 = validated; 9 = missing (value -9999); 2 = flagged, dropped too.
                    if m.get("valor") is None or m.get("lnCodigoValidacion") != 1:
                        continue
                    units[m["codigoParametro"]] = m.get("unidade")
                    vals.setdefault(e["idEstacion"], {}).setdefault(m["codigoParametro"], {}).setdefault(year, {})[month] = m["valor"]
        if any(units.get(k) != u for k, u in EXPECTED_UNITS.items()):
            raise RuntimeError(f"meteogalicia: unexpected units {units}")

        def annual(by_year, fn):
            return {y: fn(list(mm.values())) for y, mm in by_year.items() if len(mm) == 12}

        out = []
        for sid, s in meta.items():
            p = vals.get(sid, {})
            t = annual(p.get("TA_AVG_1.5m", {}), lambda v: sum(v) / 12)
            r = annual(p.get("PP_SUM_1.5m", {}), sum)
            w = annual(p.get("VV_AVG_10m", {}), lambda v: sum(v) / 12)
            sn = annual(p.get("HSOL_SUM_1.5m", {}), sum)
            h = annual(p.get("HR_AVG_1.5m", {}), lambda v: sum(v) / 12)
            rec = {
                "id": sid, "name": s["estacion"], "concello": s["concello"], "province": s["provincia"],
                "lon": s["lon"], "lat": s["lat"], "altitude": s["altitude"],
                "temp_c": round(t[y1], 2) if y1 in t else None,
                "precip_mm": round(r[y1], 1) if y1 in r else None,
            }
            ty = sorted(t)
            ry = sorted(r)
            rec["temp_c_mean"] = round(sum(t.values()) / len(t), 2) if len(t) >= MIN_YEARS else None
            rec["precip_mm_mean"] = round(sum(r.values()) / len(r), 1) if len(r) >= MIN_YEARS else None
            rec["years_temp"], rec["years_precip"] = ty, ry
            rec["wind_ms"] = round(w[y1], 2) if y1 in w else None
            rec["sun_h"] = round(sn[y1], 1) if y1 in sn else None
            rec["humidity_pct"] = round(h[y1], 1) if y1 in h else None
            rec["wind_ms_mean"] = round(sum(w.values()) / len(w), 2) if len(w) >= MIN_YEARS else None
            rec["sun_h_mean"] = round(sum(sn.values()) / len(sn), 1) if len(sn) >= MIN_YEARS else None
            rec["humidity_pct_mean"] = round(sum(h.values()) / len(h), 1) if len(h) >= MIN_YEARS else None
            rec["years_wind"], rec["years_sun"], rec["years_humidity"] = sorted(w), sorted(sn), sorted(h)
            out.append(rec)
        out.sort(key=lambda x: x["id"])
        return {
            "vintage": f"MeteoGalicia monthly observations {y0}-{y1}",
            "year": y1,
            "years_window": [y0, y1],
            "units": {"temp_c": "degC", "precip_mm": "mm", "wind_ms": "m/s", "sun_h": "h", "humidity_pct": "%"},
            "n_listed": len(out),
            "n_with_both": sum(1 for x in out if x["temp_c"] is not None and x["precip_mm"] is not None),
            "stations": out,
            "_files": [LIST_FILE, mfile.name],
        }
