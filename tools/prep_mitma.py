"""Reduce one day of MITMA mobile-phone mobility (origin-destination matrix by municipal zone) to Galicia.

    PYTHONUTF8=1 uv run python tools/prep_mitma.py

Stdlib only. It lives in tools/ because the daily file is large (~153 MB gzipped, ~1 pass of some
minutes); the source `mitma_movilidad` (pipeline/sources/) only reads the small result.

Downloads (cached, recorded in data/raw/mitma_movilidad/manifest.json):

* 20250312_Viajes_municipios.csv.gz  ONE day: Wednesday 2025-03-12. Not a Galician holiday (Decreto
  171/2024) nor a school holiday (Orde 12-04-2024: Entroido was 3-5 March). Do not add more days.
* relacion_ine_zonificacionMitma.csv  census section -> INE municipality -> MITMA municipal zone.
* nombres_municipios.csv              name of each MITMA municipal zone.

Output data/raw/mitma_movilidad/dia_galicia.json:

* flows: [origin, destination, trips, trip_km, {destination activity: trips}] for every zone pair with
  at least one end in Galicia, all hours and all other dimensions summed. Intrazonal pairs included.
  Ends outside Galicia are collapsed into ext_ES (rest of Spain), ext_PT, ext_FR, ext_externo.
* galicia_total_trips: trips with at least one end in Galicia (internal + outbound + inbound).
* breakdowns: Galicia-wide [trips, trip_km] for every other dimension of the file.

IDs that match no known zone are printed, listed in unmatched_ids and left out.
"""

from __future__ import annotations

import csv
import gzip
import hashlib
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline.core import fetch  # noqa: E402
from pipeline.core.store import atomic_write_text  # noqa: E402

SOURCE_ID = "mitma_movilidad"
DATE = "2025-03-12"
DAY = DATE.replace("-", "")
BASE = "https://movilidad-opendata.mitma.es"
DAILY = f"{DAY}_Viajes_municipios.csv.gz"
DAILY_URL = f"{BASE}/estudios_basicos/por-municipios/viajes/ficheros-diarios/{DATE[:7]}/{DAILY}"
RELATION = "relacion_ine_zonificacionMitma.csv"
NAMES = "nombres_municipios.csv"
URLS = {
    DAILY: DAILY_URL,
    RELATION: f"{BASE}/zonificacion/{RELATION}",
    NAMES: f"{BASE}/zonificacion/zonificacion_municipios/{NAMES}",
}
OUT = "dia_galicia.json"
MAX_BYTES = 3_000_000
HEADERS = {"User-Agent": "galiciaciv/0.1 (open data pipeline)"}

PROVINCES = ("15", "27", "32", "36")
N_CONCELLOS = 313
COLUMNS = [
    "fecha", "periodo", "origen", "destino", "distancia", "actividad_origen", "actividad_destino",
    "estudio_origen_posible", "estudio_destino_posible", "residencia", "renta", "edad", "sexo", "viajes", "viajes_km",
]
DIMENSIONS = [c for c in COLUMNS if c not in ("fecha", "origen", "destino", "viajes", "viajes_km")]
ACTIVITIES = {"casa", "trabajo_estudio", "frecuente", "no_frecuente"}
# trip_km / trips (great-circle km) must fall inside the published distance bin.
BINS = {"0.5-2": (0.5, 2.0), "2-10": (2.0, 10.0), "10-50": (10.0, 50.0), ">50": (50.0, float("inf"))}
EXT_NAMES = {
    "ext_ES": "Resto de España",
    "ext_PT": "Portugal",
    "ext_FR": "Francia",
    "ext_externo": "Fuera de la zonificación del estudio (resto del mundo)",
}


def read_pipe_csv(path: Path) -> list[dict]:
    with open(path, encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh, delimiter="|"))


def zoning(relation: Path, names_file: Path):
    """-> ({galician zone: [concellos]}, {zone: name}, set of every Spanish MITMA municipal zone)."""
    galician, everything = defaultdict(set), defaultdict(set)
    for r in read_pipe_csv(relation):
        zone, ine = r["municipio_mitma"].strip(), r["municipio_ine"].strip()
        everything[zone].add(ine)
        if ine[:2] in PROVINCES:
            galician[zone].add(ine)
    names = {r["ID"].strip(): r["name"].strip() for r in read_pipe_csv(names_file)}
    concellos = [c for z in galician for c in galician[z]]
    if len(concellos) != len(set(concellos)) or len(concellos) != N_CONCELLOS:
        raise RuntimeError(f"zoning: {len(set(concellos))} Galician concellos ({len(concellos)} rows), expected {N_CONCELLOS}")
    if not {"15902", "36902"} <= set(concellos):
        raise RuntimeError("zoning: merged concellos 15902 / 36902 are missing")
    mixed = [z for z in galician if everything[z] != galician[z]]
    if mixed:
        raise RuntimeError(f"zoning: zones mixing Galician and other municipalities: {mixed}")
    unnamed = [z for z in galician if not names.get(z)]
    if unnamed:
        raise RuntimeError(f"zoning: Galician zones without a name: {unnamed}")
    return {z: sorted(v) for z, v in galician.items()}, names, set(everything) | set(names)


def external(zone: str, spanish: set[str]) -> str | None:
    """The ext_* bucket of a non-Galician zone id; None if the id is not recognised."""
    if zone in spanish:
        # a Galician-province id that is not in the Galician set would be a zoning mismatch, not "rest of Spain"
        return None if re.fullmatch(r"(15|27|32|36)\d{3}(_AM)?", zone) else "ext_ES"
    if zone == "externo":
        return "ext_externo"
    if re.fullmatch(r"PT[0-9A-Z]*", zone):
        return "ext_PT"
    if re.fullmatch(r"FR[0-9A-Z]*", zone):
        return "ext_FR"
    return None


def scan(path: Path, galician: dict, spanish: set[str]):
    flows: dict = {}
    breakdowns = {d: defaultdict(lambda: [0.0, 0.0]) for d in DIMENSIONS}
    split = {k: [0.0, 0.0] for k in ("internal", "outbound", "inbound", "intrazonal")}
    ext_ids: dict[str, set] = defaultdict(set)
    unmatched: dict[str, int] = defaultdict(int)
    seen_zones: set[str] = set()
    rows = kept = dropped = off_bin = 0
    all_trips = dropped_trips = 0.0
    dim_idx = [(d, COLUMNS.index(d)) for d in DIMENSIONS]

    with gzip.open(path, "rt", encoding="utf-8", newline="") as fh:  # reading to EOF checks the gzip CRC
        header = fh.readline().rstrip("\r\n").split("|")
        if header != COLUMNS:
            raise RuntimeError(f"{path.name}: unexpected header {header}")
        for line in fh:
            f = line.rstrip("\r\n").split("|")
            rows += 1
            if len(f) != len(COLUMNS) or f[0] != DAY:
                raise RuntimeError(f"{path.name}: bad row {rows}: {line[:200]!r}")
            if rows % 2_000_000 == 0:
                print(f"    {rows / 1e6:.0f} M rows read, {kept / 1e6:.2f} M kept", flush=True)
            o, d = f[2], f[3]
            trips, km = float(f[13]), float(f[14])
            all_trips += trips
            og, dg = o in galician, d in galician
            # unknown ids are reported even when the other end is not Galician
            oe = o if og else external(o, spanish)
            de = d if dg else external(d, spanish)
            if oe is None:
                unmatched[o] += 1
            if de is None:
                unmatched[d] += 1
            if not (og or dg):
                continue
            if oe is None or de is None:
                dropped += 1
                dropped_trips += trips
                continue
            kept += 1
            if og:
                seen_zones.add(o)
            else:
                ext_ids[oe].add(o)
            if dg:
                seen_zones.add(d)
            else:
                ext_ids[de].add(d)
            act = f[6]
            if act not in ACTIVITIES:
                raise RuntimeError(f"{path.name}: unknown actividad_destino {act!r}")
            low, high = BINS[f[4]]
            if trips > 0 and not (low * 0.98 - 0.01 <= km / trips <= high * 1.02 + 0.01):
                off_bin += 1
            p = flows.get((oe, de))
            if p is None:
                p = flows[(oe, de)] = [0.0, 0.0, defaultdict(float)]
            p[0] += trips
            p[1] += km
            p[2][act] += trips
            kind = "internal" if og and dg else "outbound" if og else "inbound"
            split[kind][0] += trips
            split[kind][1] += km
            if o == d:
                split["intrazonal"][0] += trips
                split["intrazonal"][1] += km
            for name, i in dim_idx:
                cell = breakdowns[name][f[i]]
                cell[0] += trips
                cell[1] += km

    stats = {
        "rows_total": rows, "rows_kept": kept, "rows_dropped_unmatched": dropped,
        "trips_dropped_unmatched": round(dropped_trips, 1), "rows_outside_distance_bin": off_bin,
        "all_spain_trips": round(all_trips, 1),
    }
    return flows, breakdowns, split, ext_ids, dict(unmatched), seen_zones, stats


def pair(v) -> list[float]:
    return [round(v[0], 1), round(v[1], 1)]


def main() -> None:
    raw = fetch.RAW / SOURCE_ID
    paths = {
        name: fetch.download(SOURCE_ID, url, name, headers=HEADERS, expect_binary=True) for name, url in URLS.items()
    }
    manifest = fetch.read_manifest(SOURCE_ID)
    missing = [n for n in URLS if n not in manifest]
    if missing:
        raise RuntimeError(f"{missing} cached without a manifest entry (provenance unknown): delete and rerun")
    # the cached bytes must still be the ones the manifest describes
    for name, path in paths.items():
        with open(path, "rb") as fh:
            sha = hashlib.file_digest(fh, "sha256").hexdigest()
        if sha != manifest[name]["sha256"]:
            raise RuntimeError(f"{name}: sha256 differs from the manifest")

    galician, names, spanish = zoning(paths[RELATION], paths[NAMES])
    print(f"  {len(galician)} Galician zones, {sum(map(len, galician.values()))} concellos")
    flows, breakdowns, split, ext_ids, unmatched, seen, stats = scan(paths[DAILY], galician, spanish)

    absent = sorted(set(galician) - seen)
    if absent:
        print(f"  ! Galician zones with no row in the daily file: {absent}")
    if unmatched:
        print(f"  ! unmatched zone ids (id: rows): {unmatched}")
    if stats["rows_outside_distance_bin"] > 0.01 * stats["rows_kept"]:
        raise RuntimeError(f"{stats['rows_outside_distance_bin']} rows outside their distance bin: check the number format")
    total = sum(split[k][0] for k in ("internal", "outbound", "inbound"))
    # Galicia has about 2.7 M inhabitants: a few million trips a day, not thousands nor hundreds of millions
    if not 2e6 < total < 20e6:
        raise RuntimeError(f"implausible Galician total: {total:,.0f} trips")

    out = {
        "date": DATE,
        "daily_file": {k: manifest[DAILY][k] for k in ("url", "sha256", "bytes", "retrieved")},
        "raw_files": [DAILY, RELATION, NAMES],
        "columns_source": COLUMNS,
        "stats": stats,
        "zones": [{"id": z, "name": names[z], "concellos": galician[z]} for z in sorted(galician)],
        "ext_zones": [{"id": z, "name": EXT_NAMES[z], "source_ids": len(ext_ids[z])} for z in sorted(ext_ids)],
        "zones_without_rows": absent,
        "unmatched_ids": unmatched,
        "galicia_total_trips": round(total, 1),
        "split": {k: pair(v) for k, v in split.items()},
        "breakdowns": {d: {k: pair(v) for k, v in sorted(vals.items())} for d, vals in breakdowns.items()},
        "flows": [
            [o, d, round(t, 1), round(km, 1), {a: round(v, 1) for a, v in sorted(acts.items())}]
            for (o, d), (t, km, acts) in sorted(flows.items())
        ],
    }
    text = json.dumps(out, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    size = len(text.encode("utf-8"))
    if size > MAX_BYTES:
        raise RuntimeError(f"{OUT} would be {size:,} bytes, over the {MAX_BYTES:,} limit ({len(flows)} pairs)")
    atomic_write_text(raw / OUT, text)
    print(f"  {stats['rows_total']:,} rows read, {stats['rows_kept']:,} kept, {len(flows):,} zone pairs")
    print(f"  Galician trips: {total:,.0f}  " + "  ".join(f"{k}={v[0]:,.0f}" for k, v in split.items()))
    print(f"  -> {raw / OUT} ({size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
