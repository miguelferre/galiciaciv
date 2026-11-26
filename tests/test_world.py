"""The built map (web/data/world.json): 1 km hexes (D-004), land cells, rías, reservoirs and concellos."""

import json
import unittest
from collections import Counter

from pipeline.build.world import HEX_RADIUS_KM, LAKE
from pipeline.core.geo import MapProjection
from pipeline.core.hexgrid import HexGrid
from pipeline.core.paths import WEB_DATA

PATH = WEB_DATA / "world.json"
# (lon, lat) of points in open water inside the rías, which must stay water
RIAS = {"Muros e Noia": (-8.99, 42.75), "Muros e Noia (fondo)": (-8.93, 42.79), "Arousa": (-8.87, 42.55),
        "Pontevedra": (-8.78, 42.38), "Vigo": (-8.80, 42.23), "Vigo (San Simón)": (-8.63, 42.30),
        "Ferrol": (-8.24, 43.47), "Ortigueira": (-7.86, 43.68)}


@unittest.skipUnless(PATH.exists(), "world.json not built")
class WorldDataTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.w = json.loads(PATH.read_text(encoding="utf-8"))
        cls.grid = HexGrid(**cls.w["grid"])
        cls.proj = MapProjection(**cls.w["projection"])

    def test_radius_is_the_builder_s(self):
        self.assertEqual(HEX_RADIUS_KM, 1.0)
        self.assertEqual(self.grid.radius, HEX_RADIUS_KM)

    def test_galician_land_cells(self):
        land = sum(o >= 0 for o in self.w["owner"])
        self.assertAlmostEqual(land, 11_500, delta=1_150)

    def test_rias_are_water(self):
        wet = {name: self.w["water"][self.grid.cell_at(*self.proj(*pt))] for name, pt in RIAS.items()}
        self.assertTrue(all(wet.values()), wet)

    def test_big_reservoirs_have_hexes(self):
        # Belesar and Portas (D-004): at least three lake hexes within 12 km of a point on each
        lakes = [self.grid.center(*self.grid.col_row(i)) for i, k in enumerate(self.w["water"]) if k == LAKE]
        for name, pt in {"Belesar": (-7.66, 42.745), "Portas": (-7.274, 42.092)}.items():
            x, y = self.proj(*pt)
            near = sum((x - a) ** 2 + (y - b) ** 2 <= 12 ** 2 for a, b in lakes)
            self.assertGreaterEqual(near, 3, name)

    def test_almost_every_concello_owns_a_cell(self):
        owned = Counter(c for c, o in zip(self.w["county"], self.w["owner"]) if o >= 0)
        none = [c["name"] for k, c in enumerate(self.w["counties"]) if not owned[k]]
        self.assertLessEqual(len(none), 3, none)


if __name__ == "__main__":
    unittest.main()
