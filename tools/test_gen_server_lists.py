"""Tests for tools/gen_server_lists.py. Run from the repo root:

    python -m unittest tools/test_gen_server_lists.py -v
"""
import copy
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import gen_server_lists as g  # noqa: E402

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# A small valid v3 catalog (rules of S1) that each test mutates.
FIXTURE = {
    "schema": 3,
    "servers": [
        {
            "id": "renewal",
            "order": 10,
            "rules": "renewal",
            "name": {"th": "Durango Renewal", "en": "Durango Renewal"},
            "status": "open",
            "lanes": [
                {"id": "main", "name": {"th": "เลนปกติ"}, "gateway": "http://127.0.0.1:8290", "access": "all"},
                {"id": "supporter", "name": {"th": "เลน Supporter"}, "gateway": "http://127.0.0.1:8292", "access": "supporter"},
            ],
        },
        {
            "id": "classic",
            "order": 20,
            "rules": "classic",
            "name": {"th": "Durango Classic"},
            "status": "open",
            "lanes": [
                {"id": "main", "name": {"th": "เลนปกติ"}, "gateway": "https://example.invalid/gw", "access": "all"},
            ],
        },
    ],
}


def fixture():
    return copy.deepcopy(FIXTURE)


class ValidateTests(unittest.TestCase):
    def test_valid_catalog_loads(self):
        c = g.load_catalog(os.path.join(REPO_ROOT, "servers-v3.json"))
        self.assertEqual(len(c["servers"]), 2)

    def test_schema_must_be_3(self):
        c = fixture()
        c["schema"] = 2
        with self.assertRaises(g.CatalogError) as cm:
            g.validate(c)
        self.assertIn("schema", str(cm.exception))

    def test_duplicate_server_id(self):
        c = fixture()
        c["servers"][0]["id"] = "classic"
        with self.assertRaises(g.CatalogError) as cm:
            g.validate(c)
        self.assertIn("classic", str(cm.exception))

    def test_duplicate_lane_id(self):
        c = fixture()
        c["servers"][0]["lanes"][1]["id"] = "main"
        with self.assertRaises(g.CatalogError) as cm:
            g.validate(c)
        self.assertIn("main", str(cm.exception))

    def test_server_needs_lane(self):
        c = fixture()
        c["servers"][1]["lanes"] = []
        with self.assertRaises(g.CatalogError):
            g.validate(c)

    def test_bad_id_pattern(self):
        c = fixture()
        c["servers"][1]["id"] = "Classic 2"
        with self.assertRaises(g.CatalogError):
            g.validate(c)

    def test_name_th_required(self):
        c = fixture()
        del c["servers"][1]["name"]["th"]
        with self.assertRaises(g.CatalogError):
            g.validate(c)

    def test_unknown_rules_is_warning(self):
        c = fixture()
        c["servers"][1]["rules"] = "Classic"
        warnings = g.validate(c)
        self.assertEqual(len(warnings), 1)
        self.assertIn("rules", warnings[0])

    def test_unknown_fields_ignored(self):
        c = fixture()
        c["future"] = 1
        c["servers"][0]["future"] = 1
        c["servers"][0]["lanes"][0]["future"] = 1
        self.assertEqual(g.validate(c), [])


if __name__ == "__main__":
    unittest.main()
