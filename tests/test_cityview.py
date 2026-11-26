"""City View builders: citizens (rounding, rows) and districts (location quotients over local units)."""

import unittest

from pipeline.build.citizens import GROUPS, full_row, largest_remainder, row
from pipeline.build.districts import badge_district, badge_for, evaluate, measure, units_of
from pipeline.sources.ign_limites import polygon_area_km2


def rec(total, **divisions):
    return {"total": total, "divisions": {k.lstrip("d"): v for k, v in divisions.items()}}


class CitizensTest(unittest.TestCase):
    def test_figures_add_up_exactly(self):
        f = largest_remainder({"a": 1, "b": 1, "c": 1}, 10)
        self.assertEqual(sum(f.values()), 10)

    def test_hidden_value_gives_no_row(self):
        occupation = {f"cno{i}": 10 for i in range(1, 10)}
        occupation["cno4"] = None
        self.assertIsNone(row(occupation, "workforce"))

    def test_unclassified_is_left_out_of_the_shares(self):
        occupation = {f"cno{i}": 10 for i in range(1, 10)} | {"nc": 500}
        r = full_row(None, {"occupation": occupation}, None)
        self.assertEqual(r["workforce"]["total"], 90)
        self.assertEqual(r["workforce"]["unclassified"], 500)
        self.assertEqual(sum(r["workforce"]["figures"].values()), 20)
        self.assertIsNone(r["age"])

    def test_age_groups_cover_every_quinquennial_group_once(self):
        parts = [p for g in GROUPS["age"] for p in g["parts"]]
        self.assertEqual(len(parts), 21)
        self.assertEqual(len(set(parts)), 21)


class DistrictsTest(unittest.TestCase):
    GAL = rec(100_000, d29=100, d31=900, d47=30_000)

    def test_hidden_division_is_not_zero(self):
        self.assertIsNone(units_of(rec(10, d29=None, d31=1), ["29", "31"]))

    def test_location_quotient(self):
        m = measure(rec(1000, d47=600), self.GAL, ["47"])
        self.assertAlmostEqual(m["lq"], 2.0)
        self.assertAlmostEqual(m["excess"], 300)

    def test_a_handful_of_units_names_nothing(self):
        self.assertEqual(evaluate(rec(100, d29=5, d31=0, d47=30), self.GAL), [])

    def test_speciality_names_the_city(self):
        dists = evaluate(rec(1000, d29=40, d31=0, d47=300), self.GAL)
        self.assertEqual([d["id"] for d in dists], ["industry"])
        self.assertEqual(badge_for(badge_district(dists))["label"], "Ciudad del motor")


class AreaTest(unittest.TestCase):
    def test_one_degree_square_at_the_equator_with_a_hole(self):
        outer = [[0, -0.5], [1, -0.5], [1, 0.5], [0, 0.5], [0, -0.5]]
        hole = [[0.25, -0.25], [0.75, -0.25], [0.75, 0.25], [0.25, 0.25], [0.25, -0.25]]
        full = polygon_area_km2({"type": "Polygon", "coordinates": [outer]})
        self.assertAlmostEqual(full, 111.195**2, delta=2)
        holed = polygon_area_km2({"type": "Polygon", "coordinates": [outer, hole]})
        self.assertAlmostEqual(holed, full * 0.75, delta=2)


if __name__ == "__main__":
    unittest.main()
