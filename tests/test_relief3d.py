"""pipeline/build/relief3d.py: the detail file of the 3D relief must match world.json."""

import copy
import json
import struct
import tempfile
import unittest
from pathlib import Path

from pipeline.build import BUILDERS, relief3d

WORLD = {
    "projection": {"min_x": -105.7, "max_y": 110.4, "margin": 25.0, "lon0": -8.0},
    "width": 259.8, "height": 270.7, "grid": {"radius": 1.0, "cols": 151, "rows": 182},
}


def detail(world, count=4):
    """A detail file made for `world`, laid out as tools/prep_relief3d.py writes it."""
    game = {k: world[k] for k in ("grid", "projection", "width", "height")}
    text = json.dumps({"count": count, "game": game}).encode()
    return b"R3D1" + struct.pack("<I", len(text)) + text + bytes(count * 5)


class Relief3dCheckTest(unittest.TestCase):
    def run_check(self, data, world=WORLD):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "world.json").write_text(json.dumps(world), encoding="utf-8")
            if data is not None:
                (Path(tmp) / relief3d.FILE).write_bytes(data)
            return relief3d.check(Path(tmp))

    def levels(self, lines):
        return [level for level, _ in lines]

    def test_it_is_a_check_and_not_a_builder(self):
        self.assertNotIn("relief3d", BUILDERS)

    def test_matching_file_passes(self):
        self.assertEqual(self.levels(self.run_check(detail(WORLD))), ["PASS"])

    def test_another_projection_or_size_fails_and_names_what_differs(self):
        changes = {
            "min_x": lambda w: w["projection"].update(min_x=-105.5),
            "margin": lambda w: w["projection"].pop("margin"),
            "width": lambda w: w.update(width=259.7),
            "height": lambda w: w.update(height=270.2),
        }
        for what, change in changes.items():
            world = copy.deepcopy(WORLD)
            change(world)
            with self.subTest(what=what):
                lines = self.run_check(detail(WORLD), world)
                self.assertEqual(self.levels(lines), ["FAIL"])
                self.assertIn(f"is stale: {what} differ", lines[0][1])

    def test_another_game_grid_alone_does_not_fail(self):
        world = {**WORLD, "grid": {"radius": 2.5, "cols": 61, "rows": 74}}
        self.assertEqual(self.levels(self.run_check(detail(WORLD), world)), ["PASS", "NOTE"])

    def test_broken_file_fails(self):
        good = detail(WORLD)
        for what, data in {"magic": b"XXXX" + good[4:], "short": good[:-1], "empty": b""}.items():
            with self.subTest(what=what):
                self.assertEqual(self.levels(self.run_check(data)), ["FAIL"])

    def test_missing_file_is_a_note(self):
        self.assertEqual(self.levels(self.run_check(None)), ["NOTE"])


if __name__ == "__main__":
    unittest.main()
