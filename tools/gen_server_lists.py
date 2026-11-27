"""servers-v3.json is the one source of the game's server list.

This module reads and checks it (contract S1). Importing it has no side effects.
"""
import json
import re

SCHEMA = 3
SERVER_ID_RE = re.compile(r"^[a-z0-9-]{2,32}$")
LANE_ID_RE = re.compile(r"^[a-z0-9-]{1,32}$")
KNOWN_RULES = ("classic", "renewal")


class CatalogError(Exception):
    """servers-v3.json breaks a shape rule of S1 and must not be used."""


def _check_id(value, pattern, what):
    if not isinstance(value, str) or not pattern.match(value):
        raise CatalogError(f"{what} id {value!r} must match {pattern.pattern}")
    return value


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

        rules = server.get("rules")
        if rules not in KNOWN_RULES:
            warnings.append(f"server {sid!r}: unknown rules {rules!r}; readers hide this server")

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
    return warnings


def load_catalog(path: str) -> dict:
    """Read a UTF-8 servers-v3.json, validate it, and return it."""
    with open(path, encoding="utf-8") as f:
        try:
            catalog = json.load(f)
        except json.JSONDecodeError as e:
            raise CatalogError(f"{path}: not valid JSON: {e}") from e
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
            gateway = lane.get("gateway")
            if not isinstance(gateway, str) or not gateway:
                raise CatalogError(f"server {server['id']!r} lane {lane['id']!r} needs a gateway")
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
