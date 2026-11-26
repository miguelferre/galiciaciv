"""Population growth from the padrón series (INE via IGE 589), one consistent table.

Helper module (no build()): used by cities.py and states.py. Adapted from usaciv's build/growth.py
(Karpathy, MIT), which used the Census PEP series.

growth = population(end) / population(BASELINE_YEAR) - 1, over growth_years = [BASELINE_YEAR, end],
where `end` is the padrón year the panels show (nation.json "year"). Both numbers are official padrón
figures at 1 January, on today's 313 concellos: the last mergers (Oza-Cesuras, Cerdedo-Cotobade) are
older than 2021, so no border changes inside the window.

A rate is null (never a guess) when a population is missing or |growth| > MAX_GROWTH (a last sanity
check; no concello gained or lost a quarter of its people in four years).
"""

from __future__ import annotations

MAX_GROWTH = 0.25
BASELINE_YEAR = 2021  # a 4-year span ending at the padrón year, as in usaciv


def rate(latest: float | None, earlier: float | None) -> float | None:
    """latest / earlier - 1, rounded; None if either is missing or |rate| > MAX_GROWTH."""
    if not latest or not earlier:
        return None
    g = latest / earlier - 1
    return round(g, 4) if abs(g) <= MAX_GROWTH else None


class Growth:
    """Growth rates from the ine_padron interim for the window [BASELINE_YEAR, padrón year]."""

    def __init__(self, padron: dict):
        years = padron.get("series_years") or []
        end = padron["year"]
        ok = BASELINE_YEAR in years and end in years and end > BASELINE_YEAR
        self.years = [BASELINE_YEAR, end] if ok else None
        self._series = padron.get("series_by_concello") or {}
        self._galicia = padron.get("galicia_series") or {}

    def _pop(self, series: dict, year: int):
        return series.get(str(year))

    def concellos(self, codes: list[str]) -> float | None:
        """Growth of the sum of these concellos; None if any of them lacks a year."""
        if not self.years:
            return None
        a = b = 0
        for c in codes:
            s = self._series.get(c, {})
            pa, pb = self._pop(s, self.years[0]), self._pop(s, self.years[1])
            if pa is None or pb is None:
                return None
            a, b = a + pa, b + pb
        return rate(b, a)

    def nation(self) -> float | None:
        if not self.years:
            return None
        return rate(self._pop(self._galicia, self.years[1]), self._pop(self._galicia, self.years[0]))

    def pop_series(self, code: str) -> dict | None:
        """{year: population} of one concello, or None."""
        s = self._series.get(code)
        return {y: s[y] for y in sorted(s)} if s else None
