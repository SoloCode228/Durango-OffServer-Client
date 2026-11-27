/* catalog.js: reads servers-v3.json (contract S1) into the data the portal page draws.
   Plain browser script (no ES module, no DOM access). Tested with `node --test "portal/test/*.test.js"`. */
"use strict";

var DurangoCatalog = (function () {
  var SERVER_ID = /^[a-z0-9-]{2,32}$/;
  var STATUSES = ["open", "soon", "maintenance"];

  function isObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  function nonEmptyString(v) {
    return typeof v === "string" && v.trim() !== "" ? v : null;
  }

  /* Returns the string when it parses as an https: URL, else null. */
  function httpsUrl(v) {
    if (typeof v !== "string") return null;
    try {
      return new URL(v).protocol === "https:" ? v : null;
    } catch (e) {
      return null;
    }
  }

  function readText(v) {
    if (!isObject(v)) return null;
    var th = nonEmptyString(v.th);
    if (th === null) return null;
    return { th: th, en: nonEmptyString(v.en) || th };
  }

  /* Only the first lane's gateway is used (lanes are not shown on the web). */
  function readStatusUrl(lanes) {
    if (!Array.isArray(lanes) || !isObject(lanes[0])) return null;
    var gw = httpsUrl(lanes[0].gateway);
    if (gw === null) return null;
    if (gw.charAt(gw.length - 1) === "/") gw = gw.slice(0, -1);
    return gw + "/status";
  }

  function readServer(raw) {
    var name = readText(raw.name);
    if (name === null) return null;
    var status = STATUSES.indexOf(raw.status) >= 0 ? raw.status : null;
    if (status === null) return null; /* hidden and unknown values are not shown */
    var links = isObject(raw.links) ? raw.links : {};
    return {
      id: raw.id,
      order: raw.order,
      rules: raw.rules === "classic" || raw.rules === "renewal" ? raw.rules : "other",
      name: name,
      tagline: readText(raw.tagline),
      status: status,
      opensAt: nonEmptyString(raw.opens_at),
      links: { site: httpsUrl(links.site), playWeb: httpsUrl(links.play_web) },
      statusUrl: readStatusUrl(raw.lanes)
    };
  }

  function parseCatalog(json) {
    if (!isObject(json) || json.schema !== 3 || !Array.isArray(json.servers)) return null;
    var idService = isObject(json.id_service) ? json.id_service : {};
    var seen = {};
    var kept = [];
    json.servers.forEach(function (raw, index) {
      if (!isObject(raw) || typeof raw.id !== "string" || !SERVER_ID.test(raw.id)) return;
      if (Object.prototype.hasOwnProperty.call(seen, raw.id)) return; /* first in the file wins */
      seen[raw.id] = true;
      var server = readServer(raw);
      if (server !== null) kept.push({ server: server, index: index });
    });
    kept.sort(function (a, b) {
      var oa = Number.isInteger(a.server.order) ? a.server.order : Infinity;
      var ob = Number.isInteger(b.server.order) ? b.server.order : Infinity;
      if (oa !== ob) return oa < ob ? -1 : 1;
      return a.index - b.index;
    });
    return {
      idService: { web: httpsUrl(idService.web) },
      servers: kept.map(function (k) { return k.server; })
    };
  }

  return {
    parseCatalog: parseCatalog
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = DurangoCatalog; else globalThis.DurangoCatalog = DurangoCatalog;
