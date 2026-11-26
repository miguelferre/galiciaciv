"""Polygon-to-hex overlays: how much of each hex a set of lon/lat polygons covers (helper, no build()).

Polygons are rasterised in map km on a fine square grid (sample = centre of each square) with an
even-odd scanline fill, so holes are respected. Overlapping polygons of one call are merged (union),
never counted twice. The covered share of a hex = covered samples in the hex / samples a whole hex
holds (hex area / square area). With 25 to 50 m squares one hex holds thousands of samples.
"""

from __future__ import annotations

import math
from collections import defaultdict


def polygon_spans(rings, project, step: float) -> dict[int, list[tuple[int, int]]]:
    """{raster row: [(first column, last column + 1)]} of one polygon.

    `rings` = [outer, hole, ...], each [(lon, lat), ...]; `project` = lon, lat -> map km.
    """
    xs_by_row: dict[int, list[float]] = defaultdict(list)
    for ring in rings:
        pts = [project(lon, lat) for lon, lat in ring]
        for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]):
            if y0 == y1:
                continue
            if y0 > y1:
                x0, y0, x1, y1 = x1, y1, x0, y0
            # rows whose centre line y = (j + 0.5) * step lies in [y0, y1)
            for j in range(math.ceil(y0 / step - 0.5), math.ceil(y1 / step - 0.5)):
                y = (j + 0.5) * step
                xs_by_row[j].append(x0 + (x1 - x0) * (y - y0) / (y1 - y0))
    out = {}
    for j, xs in xs_by_row.items():
        xs.sort()
        spans = []
        for a, b in zip(xs[::2], xs[1::2]):
            i0, i1 = math.ceil(a / step - 0.5), math.ceil(b / step - 0.5)
            if i1 > i0:
                spans.append((i0, i1))
        if spans:
            out[j] = spans
    return out


def union(span_sets) -> dict[int, list[tuple[int, int]]]:
    """Merge several span maps into one with no overlaps."""
    rows: dict[int, list[tuple[int, int]]] = defaultdict(list)
    for s in span_sets:
        for j, spans in s.items():
            rows[j].extend(spans)
    for j, spans in rows.items():
        spans.sort()
        merged = [spans[0]]
        for a, b in spans[1:]:
            if a <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(merged[-1][1], b))
            else:
                merged.append((a, b))
        rows[j] = merged
    return dict(rows)


def cell_shares(spans, grid, step: float) -> dict[int, float]:
    """{hex index: covered share 0..1} for the hexes the spans touch."""
    full = 1.5 * math.sqrt(3) * grid.radius**2 / step**2
    hits: dict[int, int] = defaultdict(int)
    max_x = math.sqrt(3) * grid.radius * (grid.cols + 1)
    max_y = 1.5 * grid.radius * (grid.rows + 1)
    for j, row_spans in spans.items():
        y = (j + 0.5) * step
        if not -grid.radius <= y <= max_y:
            continue
        for i0, i1 in row_spans:
            for i in range(max(i0, int(-max_x / step)), min(i1, int(max_x / step) + 1)):
                cell = grid.cell_at((i + 0.5) * step, y)
                if cell >= 0:
                    hits[cell] += 1
    return {c: min(1.0, n / full) for c, n in hits.items()}
