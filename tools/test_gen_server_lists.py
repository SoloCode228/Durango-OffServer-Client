"""Tests for tools/gen_server_lists.py. Run from the repo root:

    python -m unittest tools/test_gen_server_lists.py -v
"""
import contextlib
import copy
import io
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import gen_server_lists as g  # noqa: E402

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTDATA = os.path.join(REPO_ROOT, "tools", "testdata")
# servers-v3.json as of this branch, frozen: it must generate the cd8152b
# servers-v2.json / servers.json byte for byte. Tests that need known content
# read this copy, so a real edit of servers-v3.json never breaks them.
FROZEN_V3 = os.path.join(TESTDATA, "servers-v3.cd8152b.json")

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
    def test_frozen_catalog_loads(self):
        c = g.load_catalog(FROZEN_V3)
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

    def test_order_must_be_int(self):
        c = fixture()
        c["servers"][1]["order"] = "20"
        with self.assertRaises(g.CatalogError) as cm:
            g.validate(c)
        self.assertIn("order", str(cm.exception))

    def test_lane_needs_gateway(self):
        c = fixture()
        c["servers"][0]["lanes"][1]["gateway"] = ""
        with self.assertRaises(g.CatalogError) as cm:
            g.validate(c)
        self.assertIn("gateway", str(cm.exception))
        self.assertIn("supporter", str(cm.exception))

    def test_unknown_fields_ignored(self):
        c = fixture()
        c["future"] = 1
        c["servers"][0]["future"] = 1
        c["servers"][0]["lanes"][0]["future"] = 1
        self.assertEqual(g.validate(c), [])


class LoadTests(unittest.TestCase):
    """load_catalog is as strict as the JS and C# readers of servers-v3.json."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.file = os.path.join(self._tmp.name, "servers-v3.json")

    def load_text(self, text):
        with open(self.file, "w", encoding="utf-8", newline="") as f:
            f.write(text)
        return g.load_catalog(self.file)

    def test_nan_and_infinity_rejected(self):
        for literal in ("NaN", "Infinity", "-Infinity"):
            with self.subTest(literal=literal):
                # In an unknown field, so only the parser can catch it.
                text = json.dumps(FIXTURE, ensure_ascii=False).replace('{"schema": 3', '{"x": ' + literal + ', "schema": 3', 1)
                self.assertIn(literal, text)
                with self.assertRaises(g.CatalogError) as cm:
                    self.load_text(text)
                self.assertIn("servers-v3.json", str(cm.exception))
                self.assertIn(literal, str(cm.exception))

    def test_duplicate_keys_rejected(self):
        cases = {
            "top level": json.dumps(FIXTURE, ensure_ascii=False).replace('{"schema": 3', '{"schema": 3, "schema": 3', 1),
            "in a lane": json.dumps(FIXTURE, ensure_ascii=False).replace(
                '"gateway": "http://127.0.0.1:8290"', '"gateway": "http://127.0.0.1:8290", "gateway": "http://x.invalid"', 1),
        }
        for where, text in cases.items():
            with self.subTest(where=where):
                with self.assertRaises(g.CatalogError) as cm:
                    self.load_text(text)
                self.assertIn("servers-v3.json", str(cm.exception))
                self.assertIn("duplicate", str(cm.exception))

    def test_fixture_text_loads(self):
        self.assertEqual(self.load_text(json.dumps(FIXTURE, ensure_ascii=False)), FIXTURE)


def read_testdata(name):
    with open(os.path.join(TESTDATA, name), encoding="utf-8", newline="") as f:
        return f.read()


def gateways(rows):
    return [row["gateway"] for row in rows["servers"]]


def extra_server(sid, gateway, order=30, rules="classic", status="open"):
    return {
        "id": sid,
        "order": order,
        "rules": rules,
        "name": {"th": sid},
        "status": status,
        "lanes": [{"id": "main", "name": {"th": "เลนปกติ"}, "gateway": gateway, "access": "all"}],
    }


class BuildTests(unittest.TestCase):
    def test_v2_matches_main_bytes(self):
        c = g.load_catalog(FROZEN_V3)
        self.assertEqual(g.dump(g.build_v2(c)), read_testdata("servers-v2.cd8152b.json"))

    def test_v1_matches_main_bytes(self):
        c = g.load_catalog(FROZEN_V3)
        self.assertEqual(g.dump(g.build_v1(c)), read_testdata("servers.cd8152b.json"))

    def test_non_open_servers_excluded(self):
        c = fixture()
        c["servers"].append(extra_server("soon", "http://soon.invalid", rules="renewal", status="soon"))
        c["servers"].append(extra_server("maint", "http://maint.invalid", rules="renewal", status="maintenance"))
        c["servers"].append(extra_server("hidden", "http://hidden.invalid", rules="renewal", status="hidden"))
        c["servers"].append(extra_server("odd", "http://odd.invalid", rules="renewal", status="closed"))
        hidden = {"http://soon.invalid", "http://maint.invalid", "http://hidden.invalid", "http://odd.invalid"}
        for rows in (g.build_v2(c), g.build_v1(c)):
            self.assertEqual(hidden & set(gateways(rows)), set())
        self.assertEqual(len(g.build_v2(c)["servers"]), 3)

    def test_unknown_rules_excluded(self):
        c = fixture()
        c["servers"].append(extra_server("pvp", "http://pvp.invalid", rules="pvp"))
        self.assertNotIn("http://pvp.invalid", gateways(g.build_v2(c)))
        self.assertNotIn("http://pvp.invalid", gateways(g.build_v1(c)))

    def test_name_fallback_multi_lane(self):
        c = fixture()
        server = extra_server("classic-2", "http://c2a.invalid")
        server["name"] = {"th": "Classic 2"}
        server["lanes"] = [
            {"id": "main", "name": {"th": "เลนปกติ"}, "gateway": "http://c2a.invalid", "access": "all"},
            {"id": "test", "name": {"th": "เลนทดสอบ"}, "gateway": "http://c2b.invalid", "access": "supporter"},
        ]
        c["servers"].append(server)
        names = {row["gateway"]: row["name"] for row in g.build_v2(c)["servers"]}
        self.assertEqual(names["http://c2a.invalid"], "Classic 2 · เลนปกติ")
        self.assertEqual(names["http://c2b.invalid"], "Classic 2 · เลนทดสอบ")

    def test_name_fallback_single_lane(self):
        c = fixture()
        names = {row["gateway"]: row["name"] for row in g.build_v2(c)["servers"]}
        self.assertEqual(names["https://example.invalid/gw"], "Durango Classic")

    def test_missing_lane_name_fallback_errors(self):
        c = fixture()
        del c["servers"][0]["lanes"][1]["name"]
        for build in (g.build_v2, g.build_v1):
            with self.assertRaises(g.CatalogError) as cm:
                build(c)
            self.assertIn("renewal", str(cm.exception))
            self.assertIn("supporter", str(cm.exception))

    def test_order_then_file_order(self):
        c = fixture()
        c["servers"] = [
            extra_server("late", "http://late.invalid", order=5),
            extra_server("tie-a", "http://tie-a.invalid", order=3),
            extra_server("first", "http://first.invalid", order=1),
            extra_server("tie-b", "http://tie-b.invalid", order=3),
        ]
        self.assertEqual(
            gateways(g.build_v2(c)),
            ["http://first.invalid", "http://tie-a.invalid", "http://tie-b.invalid", "http://late.invalid"],
        )

    def test_v1_has_no_mode_and_only_renewal(self):
        c = fixture()
        v1 = g.build_v1(c)
        for row in v1["servers"]:
            self.assertNotIn("mode", row)
        self.assertNotIn("https://example.invalid/gw", gateways(v1))
        self.assertEqual(gateways(v1), ["http://127.0.0.1:8290", "http://127.0.0.1:8292"])


def run_main(argv):
    """Call g.main(argv) and return (exit code, stderr text)."""
    err = io.StringIO()
    with contextlib.redirect_stderr(err):
        code = g.main(argv)
    return code, err.getvalue()


def read_bytes(path):
    with open(path, "rb") as f:
        return f.read()


class MainTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name
        self.addCleanup(self._tmp.cleanup)

    def path(self, name):
        return os.path.join(self.root, name)

    def copy_v3(self):
        shutil.copy(FROZEN_V3, self.path("servers-v3.json"))

    def assert_nothing_written(self):
        self.assertFalse(os.path.exists(self.path("servers-v2.json")))
        self.assertFalse(os.path.exists(self.path("servers.json")))

    def test_write_creates_both_files(self):
        self.copy_v3()
        code, _ = run_main(["--root", self.root])
        self.assertEqual(code, 0)
        self.assertEqual(read_bytes(self.path("servers-v2.json")),
                         read_testdata("servers-v2.cd8152b.json").encode("utf-8"))
        self.assertEqual(read_bytes(self.path("servers.json")),
                         read_testdata("servers.cd8152b.json").encode("utf-8"))

    def test_check_passes_when_in_sync(self):
        self.copy_v3()
        self.assertEqual(run_main(["--root", self.root])[0], 0)
        code, err = run_main(["--root", self.root, "--check"])
        self.assertEqual(code, 0, err)

    def test_check_fails_on_hand_edit(self):
        self.copy_v3()
        self.assertEqual(run_main(["--root", self.root])[0], 0)
        v2 = self.path("servers-v2.json")
        data = read_bytes(v2)
        with open(v2, "wb") as f:
            f.write(data.replace(b"8290", b"8291", 1))
        code, err = run_main(["--root", self.root, "--check"])
        self.assertEqual(code, 1)
        self.assertIn("servers-v2.json", err)
        self.assertNotIn("servers.json ", err)

    def test_invalid_catalog_writes_nothing(self):
        c = json.loads(read_bytes(FROZEN_V3).decode("utf-8"))
        c["servers"][1]["id"] = c["servers"][0]["id"]
        with open(self.path("servers-v3.json"), "w", encoding="utf-8", newline="") as f:
            json.dump(c, f, ensure_ascii=False)
        code, err = run_main(["--root", self.root])
        self.assertEqual(code, 1)
        self.assertIn("duplicate", err)
        self.assert_nothing_written()

    def test_unknown_rules_prints_warning(self):
        c = json.loads(read_bytes(FROZEN_V3).decode("utf-8"))
        c["servers"].append(extra_server("pvp", "http://pvp.invalid", rules="pvp"))
        with open(self.path("servers-v3.json"), "w", encoding="utf-8", newline="") as f:
            json.dump(c, f, ensure_ascii=False)
        code, err = run_main(["--root", self.root])
        self.assertEqual(code, 0)
        self.assertTrue(err.startswith("warning: "), err)
        self.assertIn("pvp", err)
        self.assertEqual(read_bytes(self.path("servers-v2.json")),
                         read_testdata("servers-v2.cd8152b.json").encode("utf-8"))

    def test_missing_catalog_writes_nothing(self):
        code, err = run_main(["--root", self.root])
        self.assertEqual(code, 1)
        self.assertIn("servers-v3.json", err)
        self.assertNotIn("Traceback", err)
        self.assert_nothing_written()

    def test_repo_files_in_sync(self):
        # Read-only: --check on the real repo root. Fails when someone edits
        # servers-v3.json and forgets to run tools/gen_server_lists.py.
        code, err = run_main(["--check"])
        self.assertEqual(code, 0, err)

    def test_non_utf8_catalog_writes_nothing(self):
        with open(self.path("servers-v3.json"), "wb") as f:
            f.write(b'{"schema": 3, "servers": [], "x": "' + bytes([0xFF, 0xFE]) + b'"}')
        code, err = run_main(["--root", self.root])
        self.assertEqual(code, 1)
        self.assertIn("servers-v3.json", err)
        self.assert_nothing_written()


if __name__ == "__main__":
    unittest.main()
