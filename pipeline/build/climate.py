"""Station interpolation for the climate lenses (helper, no build()).

Inverse-distance weighting (power 2) over the K nearest stations. Temperature is first moved to the
cell's elevation with a fixed lapse rate (-6.5 degC per km): T_i' = T_i - LAPSE * (z_cell - z_station).
Precipitation gets no elevation correction (no reliable rule for it).
"""

from __future__ import annotations

import math

LAPSE_C_PER_M = 0.0065
K_NEAREST = 6
POWER = 2.0
EXACT_KM = 0.05  # a station this close (km) is used as is


def idw(x: float, y: float, stations: list[tuple[float, float, float]],
        k: int = K_NEAREST, power: float = POWER) -> float | None:
    """IDW of (sx, sy, value) stations at (x, y); None if there are no stations."""
    if not stations:
        return None
    near = sorted((math.hypot(sx - x, sy - y), v) for sx, sy, v in stations)[:k]
    if near[0][0] <= EXACT_KM:
        return near[0][1]
    ws = [1.0 / d**power for d, _ in near]
    return sum(w * v for w, (_, v) in zip(ws, near)) / sum(ws)


def idw_temperature(x: float, y: float, z: float, stations: list[tuple[float, float, float, float]],
                    k: int = K_NEAREST) -> float | None:
    """IDW of station temperatures brought to elevation z (m). stations: (sx, sy, altitude_m, temp_c)."""
    return idw(x, y, [(sx, sy, t - LAPSE_C_PER_M * (z - alt)) for sx, sy, alt, t in stations], k)
