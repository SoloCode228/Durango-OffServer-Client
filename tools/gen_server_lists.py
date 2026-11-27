"""servers-v3.json is the one source of the game's server list.

This module reads and checks it (contract S1) and writes servers-v2.json and
servers.json from it (contract S2). Importing it has no side effects.

    python tools/gen_server_lists.py            # write servers-v2.json, servers.json
    python tools/gen_server_lists.py --check    # exit 1 if either file is out of date
"""
import argparse
import datetime
import json
import os
import re
import sys

SCHEMA = 3
SERVER_ID_RE = re.compile(r"^[a-z0-9-]{2,32}$")
LANE_ID_RE = re.compile(r"^[a-z0-9-]{1,32}$")
KNOWN_RULES = ("classic", "renewal")
KNOWN_STATUS = ("open", "soon", "maintenance", "hidden")
KNOWN_ACCESS = ("all", "supporter")
URL_RE = re.compile(r"https?://\S+")  # used with fullmatch

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG_FILE = "servers-v3.json"
V2_FILE = "servers-v2.json"
V1_FILE = "servers.json"


class CatalogError(Exception):
    """servers-v3.json breaks a shape rule of S1 and must not be used."""


def _check_id(value, pattern, what):
    if not isinstance(value, str) or not pattern.match(value):
        raise CatalogError(f"{what} id {value!r} must match {pattern.pattern}")
    return value


def _is_url(value) -> bool:
    return isinstance(value, str) and URL_RE.fullmatch(value) is not None


def _check_optional_str(obj: dict, key: str, what: str):
    if key in obj and not isinstance(obj[key], str):
        raise CatalogError(f"{what}.{key} must be a string, got {obj[key]!r}")


def _check_id_service(catalog: dict):
    ids = catalog.get("id_service")
    if not isinstance(ids, dict):
        raise CatalogError(f"id_service must be an object, got {ids!r}")
    for key in ("api", "web"):
        if not _is_url(ids.get(key)):
            raise CatalogError(f"id_service.{key} must be an http(s) URL, got {ids.get(key)!r}")
    server = ids.get("server")
    if not isinstance(server, str) or not server:
        raise CatalogError(f"id_service.server must be a non-empty string, got {server!r}")


def _check_opens_at(value, where: str):
    """S1: ISO 8601 with a UTC offset. "Z" is accepted on every Python 3.10+."""
    parsed = None
    if isinstance(value, str):
        text = value[:-1] + "+00:00" if value.endswith("Z") else value
        try:
            parsed = datetime.datetime.fromisoformat(text)
        except ValueError:
            parsed = None
    if parsed is None or parsed.utcoffset() is None:
        raise CatalogError(f"{where}: opens_at must be ISO 8601 with a UTC offset, got {value!r}")


def _check_server_extras(server: dict, sid: str):
    """Optional server fields that S1 readers use: fatal when present but malformed."""
    where = f"server {sid!r}"
    _check_optional_str(server["name"], "en", f"{where}: name")
    if "tagline" in server:
        tagline = server["tagline"]
        if not isinstance(tagline, dict) or not all(isinstance(v, str) for v in tagline.values()):
            raise CatalogError(f"{where}: tagline must be an object of strings, got {tagline!r}")
    if "links" in server:
        links = server["links"]
        if not isinstance(links, dict):
            raise CatalogError(f"{where}: links must be an object, got {links!r}")
        for key, url in links.items():
            if not _is_url(url):
                raise CatalogError(f"{where}: links.{key} must be an http(s) URL, got {url!r}")
    if "opens_at" in server:
        _check_opens_at(server["opens_at"], where)


def _check_lane_name(lane: dict, where: str):
    if "name" not in lane:
        return
    name = lane["name"]
    if not isinstance(name, dict):
        raise CatalogError(f"{where}: name must be an object, got {name!r}")
    _check_optional_str(name, "th", f"{where}: name")
    _check_optional_str(name, "en", f"{where}: name")


def _check_gateway(server_id: str, lane: dict) -> str:
    gateway = lane.get("gateway")
    if not _is_url(gateway):
        raise CatalogError(
            f"server {server_id!r} lane {lane.get('id')!r} needs a gateway that is an http(s) URL, "
            f"got {gateway!r}"
        )
    return gateway


def validate(catalog: dict) -> list[str]:
    """Check catalog against S1.

    Raises CatalogError on a fatal shape error. Returns a list of
    non-fatal warnings (for example a server whose rules is unknown,
    which readers hide). Unknown fields are ignored.
    """
    if not isinstance(catalog, dict):
        raise CatalogError("catalog must be a JSON object")
    schema = catalog.get("schema")
    if type(schema) is not int or schema != SCHEMA:
        raise CatalogError(f"schema must be {SCHEMA}, got {schema!r}")
    _check_id_service(catalog)
    servers = catalog.get("servers")
    if not isinstance(servers, list):
        raise CatalogError("servers must be a list")

    warnings = []
    seen_servers = set()
    for i, server in enumerate(servers):
        if not isinstance(server, dict):
            raise CatalogError(f"servers[{i}] must be an object")
        sid = _check_id(server.get("id"), SERVER_ID_RE, f"servers[{i}]")
        if sid in seen_servers:
            raise CatalogError(f"duplicate server id {sid!r}")
        seen_servers.add(sid)

        name = server.get("name")
        if not isinstance(name, dict) or not isinstance(name.get("th"), str) or not name["th"]:
            raise CatalogError(f"server {sid!r} needs name.th")

        order = server.get("order")
        if type(order) is not int:
            raise CatalogError(f"server {sid!r}: order must be an int, got {order!r}")

        _check_server_extras(server, sid)

        rules = server.get("rules")
        if rules not in KNOWN_RULES:
            warnings.append(f"server {sid!r}: unknown rules {rules!r}; readers hide this server")
        status = server.get("status")
        if status not in KNOWN_STATUS:
            warnings.append(
                f"server {sid!r}: status {status!r} is not one of {'|'.join(KNOWN_STATUS)}; "
                "readers treat it as hidden"
            )

        lanes = server.get("lanes")
        if not isinstance(lanes, list) or not lanes:
            raise CatalogError(f"server {sid!r} needs at least one lane")
        seen_lanes = set()
        for j, lane in enumerate(lanes):
            if not isinstance(lane, dict):
                raise CatalogError(f"server {sid!r} lanes[{j}] must be an object")
            lid = _check_id(lane.get("id"), LANE_ID_RE, f"server {sid!r} lanes[{j}]")
            if lid in seen_lanes:
                raise CatalogError(f"server {sid!r} has duplicate lane id {lid!r}")
            seen_lanes.add(lid)
            _check_gateway(sid, lane)
            _check_lane_name(lane, f"server {sid!r} lane {lid!r}")
            access = lane.get("access")
            if access not in KNOWN_ACCESS:
                warnings.append(
                    f"server {sid!r} lane {lid!r}: access {access!r} is not one of {'|'.join(KNOWN_ACCESS)}; "
                    "readers treat it as supporter"
                )
    return warnings


class _StrictJSONError(ValueError):
    """JSON that Python accepts but the JS and C# readers do not."""


def _reject_constant(literal: str):
    raise _StrictJSONError(f"{literal} is not valid JSON")


def _reject_duplicate_keys(pairs: list) -> dict:
    obj = {}
    for key, value in pairs:
        if key in obj:
            raise _StrictJSONError(f"duplicate key {key!r} in one object")
        obj[key] = value
    return obj


def load_catalog(path: str) -> dict:
    """Read a UTF-8 servers-v3.json, validate it, and return it.

    A file that cannot be read, is not UTF-8, or is not valid JSON raises
    CatalogError naming the path. So do NaN/Infinity and duplicate keys,
    which Python's json accepts but other readers of the file do not.
    """
    try:
        with open(path, encoding="utf-8") as f:
            catalog = json.load(f, parse_constant=_reject_constant,
                                object_pairs_hook=_reject_duplicate_keys)
    except OSError as e:
        raise CatalogError(f"{path}: cannot read: {e}") from e
    except UnicodeDecodeError as e:
        raise CatalogError(f"{path}: not UTF-8: {e}") from e
    except json.JSONDecodeError as e:
        raise CatalogError(f"{path}: not valid JSON: {e}") from e
    except _StrictJSONError as e:
        raise CatalogError(f"{path}: {e}") from e
    validate(catalog)
    return catalog


def _playable(catalog: dict) -> list[dict]:
    """Servers that old lists carry: status open and known rules, by order (S1).

    sorted() is stable, so servers with the same order keep file order.
    """
    servers = [
        s for s in catalog["servers"]
        if s.get("status") == "open" and s.get("rules") in KNOWN_RULES
    ]
    for s in servers:
        order = s.get("order")
        if type(order) is not int:
            raise CatalogError(f"server {s['id']!r}: order must be an int, got {order!r}")
    return sorted(servers, key=lambda s: s["order"])


def _row_name(server: dict, lane: dict) -> str:
    """S2: legacy_name, else "<name.th> · <lane.name.th>" with many lanes, else name.th."""
    legacy = lane.get("legacy_name")
    if isinstance(legacy, str) and legacy:
        return legacy
    if len(server["lanes"]) == 1:
        return server["name"]["th"]
    lane_name = lane.get("name")
    if not isinstance(lane_name, dict) or not isinstance(lane_name.get("th"), str) or not lane_name["th"]:
        raise CatalogError(
            f"server {server['id']!r} lane {lane['id']!r} needs name.th or legacy_name "
            "(the server has more than one lane)"
        )
    return f"{server['name']['th']} · {lane_name['th']}"


def _rows(catalog: dict, with_mode: bool, rules: tuple[str, ...]) -> dict:
    rows = []
    for server in _playable(catalog):
        if server["rules"] not in rules:
            continue
        for lane in server["lanes"]:
            gateway = _check_gateway(server["id"], lane)
            row = {"name": _row_name(server, lane), "gateway": gateway}
            if with_mode:
                row["mode"] = server["rules"]
            rows.append(row)
    return {"servers": rows}


def build_v2(catalog: dict) -> dict:
    """servers-v2.json (S2): every open classic/renewal lane, with mode."""
    return _rows(catalog, with_mode=True, rules=KNOWN_RULES)


def build_v1(catalog: dict) -> dict:
    """servers.json (S2): open renewal lanes only, without mode."""
    return _rows(catalog, with_mode=False, rules=("renewal",))


def dump(obj: dict) -> str:
    """File text of S2: indent 2, non-ASCII kept, LF, newline at the end.

    Write it with newline="" (or as UTF-8 bytes) so Windows keeps LF.
    """
    return json.dumps(obj, indent=2, ensure_ascii=False) + "\n"


def _generated(catalog: dict) -> dict[str, dict]:
    """File name -> content of each generated file."""
    return {V2_FILE: build_v2(catalog), V1_FILE: build_v1(catalog)}


def output_warnings(generated: dict[str, dict]) -> list[str]:
    """Non-fatal problems of the generated lists: an empty list, or two
    servers-v2.json rows that a player could not tell apart by name."""
    warnings = []
    for name, obj in generated.items():
        if not obj["servers"]:
            warnings.append(f"{name} would have zero rows; old clients would show no server")
    names = [row["name"] for row in generated[V2_FILE]["servers"]]
    for row_name in dict.fromkeys(names):
        if names.count(row_name) > 1:
            warnings.append(f"{V2_FILE} has {names.count(row_name)} rows named {row_name!r}")
    return warnings


def _read_bytes(path: str) -> bytes | None:
    try:
        with open(path, "rb") as f:
            return f.read()
    except FileNotFoundError:
        return None


def main(argv: list[str]) -> int:
    """Write (or with --check, compare) servers-v2.json and servers.json.

    Exit 0 = written / in sync. Exit 1 = the catalog is invalid (nothing is
    written) or --check found a file that differs (its name goes to stderr).
    """
    parser = argparse.ArgumentParser(
        prog="gen_server_lists.py",
        description=f"Generate {V2_FILE} and {V1_FILE} from {CATALOG_FILE}.",
    )
    parser.add_argument("--root", default=REPO_ROOT,
                        help=f"folder holding {CATALOG_FILE} and the generated files (default: repo root)")
    parser.add_argument("--check", action="store_true",
                        help="do not write; exit 1 if a generated file differs from what is on disk")
    args = parser.parse_args(argv)

    try:
        catalog = load_catalog(os.path.join(args.root, CATALOG_FILE))
        warnings = validate(catalog)
        generated = _generated(catalog)
    except CatalogError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    warnings += output_warnings(generated)
    for w in warnings:
        print(f"warning: {w}", file=sys.stderr)
    outputs = {name: dump(obj).encode("utf-8") for name, obj in generated.items()}

    if args.check:
        stale = [name for name, data in outputs.items()
                 if _read_bytes(os.path.join(args.root, name)) != data]
        for name in stale:
            print(f"{name} is out of date; run python tools/gen_server_lists.py", file=sys.stderr)
        return 1 if stale else 0

    for name, data in outputs.items():
        with open(os.path.join(args.root, name), "wb") as f:
            f.write(data)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
