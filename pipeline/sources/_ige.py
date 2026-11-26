"""Shared helpers for the IGE (Instituto Galego de Estatística) BDT CSV API.

URL pattern: https://www.ige.gal/igebdt/igeapi/csv/datos/<table>/<dim>:<value>
Files are ISO-8859-1 (latin-1), quoted, comma separated. The columns include
CodTempo, Tempo, ..., CodEspazo, Espazo, DatoN (number), DatoT (formatted text).

CodEspazo: "12" = Galicia, 2 digits = province (15, 27, 32, 36), 4 digits = comarca,
5 digits = concello (INE code). A table or period that does not exist answers
HTTP 200 with an empty body or only the header, so fetch_latest() probes periods
from the newest candidate down and keeps the first one that has data rows.
This module has no Source subclass, so the registry ignores it.
"""

from __future__ import annotations

import csv
import io
from datetime import date

from ..core.fetch import UnexpectedContentError

BASE = "https://www.ige.gal/igebdt/igeapi/csv/datos"
PROVINCES = ("15", "27", "32", "36")
GALICIA = "12"
N_CONCELLOS = 313


def url(table: int, flt: str = "") -> str:
    return f"{BASE}/{table}" + (f"/{flt}" if flt else "")


def _candidates(kind: str, n: int):
    today = date.today()
    if kind == "year":
        return [str(today.year - i) for i in range(n)]
    out, y, m = [], today.year, today.month
    for _ in range(n):
        out.append(f"{y}{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out


def parse(text: str) -> list[dict]:
    return list(csv.DictReader(io.StringIO(text)))


def read_rows(path) -> list[dict]:
    return parse(path.read_text(encoding="latin-1"))


def has_data(path) -> bool:
    """True if the file is a real CSV (header with CodEspazo) with at least one data row.
    A missing period can come back as an HTML error page, an empty body or only the header."""
    text = path.read_text(encoding="latin-1")
    head = text.partition("\n")[0]
    return "CodEspazo" in head and len(parse(text)) > 0


def rel_name(table: int, period: str) -> str:
    return f"t{table}_{period}.csv"


def fetch_latest(src, table: int, dim: int, kind: str, *, force: bool = False, tries: int = 8) -> str:
    """Download the newest period of `table` that has data; returns its period string.

    `dim` is the index of the time dimension in the IGE filter (e.g. 0 -> "0:202609").
    kind is "year" or "month". Empty answers are discarded so they are not cached.
    """
    for period in _candidates(kind, tries):
        rel = rel_name(table, period)
        try:
            path = src.download(url(table, f"{dim}:{period}"), rel, force=force, expect_binary=True)
        except UnexpectedContentError:
            continue  # HTML error page: nothing cached
        if has_data(path):
            return period
        src.discard(rel)
    raise RuntimeError(f"IGE table {table}: no data for the last {tries} {kind} candidates")


def cached_latest(src, table: int):
    """Newest cached t<table>_<period>.csv in the source's raw dir -> (period, Path)."""
    files = sorted(src.raw_dir.glob(f"t{table}_*.csv"))
    if not files:
        raise FileNotFoundError(f"no cached IGE table {table} in {src.raw_dir}; run fetch first")
    p = files[-1]
    return p.stem.split("_", 1)[1], p


def concello_code(row: dict) -> str | None:
    """The 5-digit INE code of a concello row, else None (Galicia, province, comarca rows)."""
    c = row["CodEspazo"].strip()
    return c if len(c) == 5 and c.isdigit() and c[:2] in PROVINCES else None


def number(row: dict):
    """DatoN as a float; None when the cell is empty (statistical secrecy)."""
    v = row["DatoN"].strip()
    return float(v) if v else None


def galicia_total(rows: list[dict], pick=lambda r: True):
    for r in rows:
        if r["CodEspazo"].strip() == GALICIA and pick(r):
            return number(r)
    return None


def check_count(codes, label: str) -> None:
    n = len(set(codes))
    if n != N_CONCELLOS:
        raise RuntimeError(f"{label}: {n} concellos, expected {N_CONCELLOS}")


def concello_values(rows: list[dict], pick=lambda r: True) -> dict[str, float]:
    """{5-digit code: DatoN} for the rows `pick` accepts; empty cells (secrecy, or the
    4 pre-merger concellos 15026, 15063, 36011, 36012 that the IGE keeps) are skipped."""
    out = {}
    for r in rows:
        c = concello_code(r)
        if c and pick(r) and number(r) is not None:
            out[c] = number(r)
    return out
