"""Check web/data/relief3d_detalle.bin against world.json. No build(): tools/prep_relief3d.py writes the file.

The fine mesh of the 3D relief lives in the map km of the world.json it was made for. After a change of projection or
map size the viewer rejects it and stays on the normal mesh, so `pipeline check` FAILs. A change of game grid alone is
fine: the viewer works out the game cell of each fine cell itself. Same rules as web/js/ext/relief3d/terrain.js.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

FILE = "relief3d_detalle.bin"
FIX = "run tools/prep_relief3d.py again"
TOLERANCE = 1e-6  # for the projection numbers, as in terrain.js; width and height must be equal


def _header(data: bytes) -> dict:
    if len(data) < 8 or data[:4] != b"R3D1":
        raise ValueError("not an R3D1 file")
    length = struct.unpack_from("<I", data, 4)[0]
    header = json.loads(data[8:8 + length])
    if len(data) != 8 + length + header["count"] * 5:
        raise ValueError("incomplete file")
    return header


def check(web_dir: Path) -> list[tuple[str, str]]:
    web_dir = Path(web_dir)
    path = web_dir / FILE
    if not path.exists():
        return [("NOTE", f"{FILE} missing: the 3D relief has no high detail")]
    try:
        header = _header(path.read_bytes())
        made = header["game"]
        projection, size, grid = made["projection"], (made["width"], made["height"]), made["grid"]
    except (ValueError, KeyError, TypeError) as exc:
        return [("FAIL", f"{FILE} unreadable ({type(exc).__name__}: {exc}); {FIX}")]
    world_path = web_dir / "world.json"
    if not world_path.exists():
        return [("NOTE", f"{FILE} not compared: world.json is missing")]
    world = json.loads(world_path.read_text(encoding="utf-8"))
    ours = world.get("projection") or {}
    differ = [k for k, v in projection.items() if k not in ours or abs(v - ours[k]) >= TOLERANCE]
    differ += [k for k, v in zip(("width", "height"), size) if world.get(k) != v]
    if differ:
        return [("FAIL", f"{FILE} is stale: {', '.join(differ)} differ from world.json and the viewer rejects it; {FIX}")]
    out = [("PASS", f"{FILE} matches the projection and size of world.json ({header['count']} cells)")]
    if grid != world.get("grid"):
        out.append(("NOTE", f"{FILE} was made for another game grid; the viewer works out the game cells itself"))
    return out
