"""Galician builders: IDW and elevation correction, city placement, abbreviations, names, footprints."""

import math
import unittest

from pipeline.build.cities import footprints, place_city
from pipeline.build.climate import LAPSE_C_PER_M, idw, idw_temperature
from pipeline.build.galicia import comarca_abbrs, display_name, ring_centroid
from pipeline.core.hexgrid import HexGrid


class IdwTest(unittest.TestCase):
    def test_exact_station_and_none(self):
        self.assertEqual(idw(0, 0, [(0.01, 0, 12.0), (10, 0, 20.0)]), 12.0)
        self.assertIsNone(idw(0, 0, []))

    def test_midpoint_is_the_mean_and_nearer_weighs_more(self):
        st = [(-5, 0, 10.0), (5, 0, 20.0)]
        self.assertAlmostEqual(idw(0, 0, st), 15.0)
        self.assertLess(idw(-2, 0, st), 15.0)

    def test_only_k_nearest_count(self):
        st = [(1, 0, 10.0), (2, 0, 10.0), (1000, 0, 500.0)]
        self.assertAlmostEqual(idw(0, 0, st, k=2), 10.0)

    def test_temperature_lapse_rate(self):
        # one station at 100 m reads 15 degC; a cell at 1100 m is 6.5 degC colder
        self.assertAlmostEqual(idw_temperature(0, 0, 1100.0, [(0.0, 0.0, 100.0, 15.0)]), 15.0 - 6.5)
        # a cell lower than the station is warmer
        self.assertAlmostEqual(idw_temperature(0, 0, 0.0, [(0.0, 0.0, 100.0, 15.0)]), 15.0 + LAPSE_C_PER_M * 100)

    def test_temperature_two_stations_at_same_cell_height_agree(self):
        # stations on a slope: after correction both predict the same temperature at the cell height
        st = [(-3, 0, 0.0, 16.0), (3, 0, 1000.0, 9.5)]
        self.assertAlmostEqual(idw_temperature(0, 0, 500.0, st), 12.75)


class PlacementTest(unittest.TestCase):
    # 4 x 3 grid: cell 0 water, the rest land. Cells 1,2 are concello 0 (comarca 0); 5,6 concello 1 (comarca 0);
    # 9,10 concello 2 (comarca 1); 3 foreign (-2); 7 water.
    grid = HexGrid(5.0, 4, 3)
    owner = [-1, 0, 0, -2, 0, 0, 0, -1, 1, 1, 1, -1]
    county = [-1, 0, 0, -1, -1, 1, 1, -1, -1, 2, 2, -1]

    def centre(self, c):
        return self.grid.center(*self.grid.col_row(c))

    def test_own_concello_cell_nearest_and_never_water_or_foreign(self):
        x, y = self.centre(0)  # centroid on a water cell
        cell = place_city(self.grid, self.owner, self.county, set(), x, y, 0, 0)
        self.assertIn(cell, (1, 2))
        self.assertGreaterEqual(self.owner[cell], 0)

    def test_own_concello_prefers_the_built_up_cell(self):
        x, y = self.centre(1)
        built = [0] * self.grid.size
        built[2] = 80  # the town is on cell 2 although the centroid is on cell 1
        self.assertEqual(place_city(self.grid, self.owner, self.county, set(), x, y, 0, 0, built), 2)
        self.assertEqual(place_city(self.grid, self.owner, self.county, set(), x, y, 0, 0), 1)

    def test_second_city_never_shares_a_cell(self):
        x, y = self.centre(1)
        a = place_city(self.grid, self.owner, self.county, set(), x, y, 0, 0)
        b = place_city(self.grid, self.owner, self.county, {a}, x, y, 0, 0)
        self.assertNotEqual(a, b)
        self.assertEqual(self.county[b], 0)

    def test_falls_back_to_comarca_then_anywhere(self):
        x, y = self.centre(1)
        cell = place_city(self.grid, self.owner, self.county, {1, 2}, x, y, 0, 0)  # concello 0 full
        self.assertEqual(self.owner[cell], 0)
        self.assertNotIn(cell, (1, 2))
        # concello with no cell of its own (index 5), comarca 1: takes a comarca-1 cell
        cell = place_city(self.grid, self.owner, self.county, set(), x, y, 5, 1)
        self.assertEqual(self.owner[cell], 1)
        # nothing free in the comarca: any Galician land cell
        cell = place_city(self.grid, self.owner, self.county, {8, 9, 10}, x, y, 5, 1)
        self.assertGreaterEqual(self.owner[cell], 0)
        self.assertNotIn(cell, (8, 9, 10))

    def test_no_free_cell(self):
        land = {c for c, o in enumerate(self.owner) if o >= 0}
        self.assertEqual(place_city(self.grid, self.owner, self.county, land, 0, 0, 0, 0), -1)


class HelpersTest(unittest.TestCase):
    def test_footprint_majority(self):
        world = {"owner": [0, 0, -1], "county_samples": [[0, 0, 0, 0, 1, 1, -1], [0, 0, 0, 1, 1, 1, 1], [0] * 7]}
        feet = footprints(world, {"A": 0, "B": 1})
        self.assertEqual(feet, {"A": {0}, "B": {1}})  # cell 2 is not land

    def test_abbrs_are_unique_and_short(self):
        names = ["A Coruña", "A Barcala", "Barbanza", "Barbanza Norte", "O Barbanza", "Terra Chá", "Chantada",
                 "Chaves", "Chá"]
        cs = [{"code": str(i), "name": n} for i, n in enumerate(names)]
        ab = comarca_abbrs(cs)
        self.assertEqual(len(set(ab.values())), len(names))
        self.assertTrue(all(2 <= len(a) <= 6 and a.isascii() for a in ab.values()))
        self.assertEqual(ab, comarca_abbrs(list(reversed(cs))))

    def test_display_name_moves_the_article(self):
        self.assertEqual(display_name("Coruña, A"), "A Coruña")
        self.assertEqual(display_name("Grove, O"), "O Grove")
        self.assertEqual(display_name("Somozas, As"), "As Somozas")
        self.assertEqual(display_name("Vigo"), "Vigo")

    def test_ring_centroid_of_a_square(self):
        lon, lat, area = ring_centroid([(0, 0), (2, 0), (2, 2), (0, 2)])
        self.assertAlmostEqual(lon, 1.0)
        self.assertAlmostEqual(lat, 1.0)
        self.assertAlmostEqual(area, 4.0)
        self.assertTrue(math.isfinite(ring_centroid([(0, 0), (1, 1), (2, 2)])[0]))


class OverlayTest(unittest.TestCase):
    """Polygon-to-hex shares: a full cover is 1, a hole is subtracted, the same polygon twice is not double counted."""

    def setUp(self):
        from pipeline.build.overlay import cell_shares, polygon_spans, union
        self.spans, self.shares, self.union = polygon_spans, cell_shares, union
        self.g = HexGrid(2.5, 10, 10)
        self.cx, self.cy = self.g.center(4, 4)
        c, d = self.cx, self.cy
        self.square = [(c - 5, d - 5), (c + 5, d - 5), (c + 5, d + 5), (c - 5, d + 5)]

    def share(self, rings_list):
        spans = self.union([self.spans(r, lambda x, y: (x, y), 0.05) for r in rings_list])
        return self.shares(spans, self.g, 0.05).get(self.g.index(4, 4), 0.0)

    def test_full_cover_and_union(self):
        self.assertAlmostEqual(self.share([[self.square]]), 1.0)
        self.assertAlmostEqual(self.share([[self.square], [self.square]]), 1.0)

    def test_hole(self):
        c, d = self.cx, self.cy
        hole = [(c - 1, d - 1), (c + 1, d - 1), (c + 1, d + 1), (c - 1, d + 1)]
        hex_area = 1.5 * math.sqrt(3) * 2.5**2
        self.assertAlmostEqual(self.share([[self.square, hole]]), 1 - 4 / hex_area, delta=0.01)


if __name__ == "__main__":
    unittest.main()
