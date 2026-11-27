"""Every visible string that goes through t(), index.html or web/i18n/campos.json has a galego text."""

import importlib.util
import sys
import unittest
from pathlib import Path

_spec = importlib.util.spec_from_file_location("i18n_check", Path(__file__).resolve().parents[1] / "tools" / "i18n_check.py")
i18n_check = importlib.util.module_from_spec(_spec)
sys.modules["i18n_check"] = i18n_check  # dataclasses look the module up while it loads
_spec.loader.exec_module(i18n_check)


class TestI18n(unittest.TestCase):
    def test_every_key_has_galician(self):
        rep = i18n_check.run()
        self.assertFalse(rep.failures, "\n".join(rep.failures))

    def test_path_walk(self):
        data = {"lenses": [{"name": "A"}, {"name": "B"}], "rule": {"text": "C"}, "x": {"rule": "D"}}
        for path, want in (("lenses[].name", ["A", "B"]), ("rule.text", ["C"]), ("*.rule", ["D"])):
            out = []
            i18n_check.walk(data, i18n_check.split_path(path), out)
            self.assertEqual(out, want, path)


if __name__ == "__main__":
    unittest.main()
