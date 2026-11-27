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
    return gw === null ? null : stripSlash(gw) + "/status";
  }

  /* Drops one trailing "/". */
  function stripSlash(url) {
    return url.charAt(url.length - 1) === "/" ? url.slice(0, -1) : url;
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

  /* ---- data for the page ---- */

  var RAW_V3 = "https://raw.githubusercontent.com/SoloCode228/Durango-OffServer-Client/main/servers-v3.json";
  var DEFAULT_DISCORD = "https://discord.gg/RMfeg6Drbu";
  var THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  var GROUPS = [
    { rules: "classic", label: "กฎ Classic" },
    { rules: "renewal", label: "กฎ Renewal" },
    { rules: "other", label: "กฎอื่น" }
  ];

  function filterServers(servers, opts) {
    var filter = opts && opts.filter;
    var query = opts && typeof opts.query === "string" ? opts.query.trim().toLowerCase() : "";
    return servers.filter(function (s) {
      if (filter === "classic" || filter === "renewal") {
        if (s.rules !== filter) return false;
      } else if (filter === "soon") {
        if (s.status !== "soon") return false;
      }
      if (query === "") return true;
      return [s.name.th, s.name.en, s.id].some(function (t) {
        return t.toLowerCase().indexOf(query) >= 0;
      });
    });
  }

  /* Pass every server, not the filtered list, so the layout does not jump when a filter is clicked. */
  function layoutFor(all) {
    return all.length > 6 ? "table" : "cards";
  }

  function groupByRules(servers) {
    return GROUPS.map(function (g) {
      return {
        rules: g.rules,
        label: g.label,
        servers: servers.filter(function (s) { return s.rules === g.rules; })
      };
    }).filter(function (g) { return g.servers.length > 0; });
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  /* Bangkok time (UTC+7, no daylight saving), Gregorian year. Not toLocaleString: that gives
     Buddhist-era years and differs between machines. */
  function formatOpensAt(iso) {
    if (typeof iso !== "string") return null;
    var ms = Date.parse(iso);
    if (isNaN(ms)) return null;
    var d = new Date(ms + 7 * 60 * 60 * 1000);
    return d.getUTCDate() + " " + THAI_MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear() + " " +
      pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes());
  }

  function statusLabel(server, online) {
    if (server.status === "open") {
      return Number.isInteger(online) && online >= 0 ? "เปิดอยู่ · " + online + " คน" : "เปิดอยู่";
    }
    if (server.status === "soon") {
      var when = formatOpensAt(server.opensAt);
      return when === null ? "เร็ว ๆ นี้" : "เปิด " + when;
    }
    return "ปิดปรับปรุง";
  }

  function actionFor(server) {
    if (server.status === "open") {
      if (server.rules !== "classic" && server.rules !== "renewal") return { kind: "none" };
      return {
        kind: "play",
        launcherUrl: "durango://play/" + server.id,
        webUrl: server.links && server.links.playWeb ? server.links.playWeb : null
      };
    }
    if (server.status === "soon") return { kind: "soon", opensText: formatOpensAt(server.opensAt) };
    if (server.status === "maintenance") return { kind: "maintenance" };
    return { kind: "none" };
  }

  function idLinks(idService) {
    var web = httpsUrl(idService && idService.web);
    if (web === null) return { signup: null, login: null };
    web = stripSlash(web);
    return { signup: web + "/signup", login: web + "/login" };
  }

  function discordUrl(androidManifest) {
    var raw = isObject(androidManifest) && isObject(androidManifest.links) ? androidManifest.links.discord : null;
    var url = httpsUrl(raw);
    if (url === null) return DEFAULT_DISCORD;
    var host = new URL(url).hostname;
    return host === "discord.gg" || host === "discord.com" ? url : DEFAULT_DISCORD;
  }

  /* ?catalog= is honoured only on a local preview, so a shared solocode.co link cannot load a fake list. */
  function catalogUrls(loc) {
    var host = loc && loc.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      var override = new URLSearchParams((loc && loc.search) || "").get("catalog");
      if (override) return [override];
    }
    return [RAW_V3, "servers-v3.json"];
  }

  function readOnline(json) {
    if (!isObject(json) || json.ok !== true) return null;
    return Number.isInteger(json.online) && json.online >= 0 ? json.online : null;
  }

  return {
    RAW_V3: RAW_V3,
    DEFAULT_DISCORD: DEFAULT_DISCORD,
    parseCatalog: parseCatalog,
    filterServers: filterServers,
    layoutFor: layoutFor,
    groupByRules: groupByRules,
    formatOpensAt: formatOpensAt,
    statusLabel: statusLabel,
    actionFor: actionFor,
    idLinks: idLinks,
    discordUrl: discordUrl,
    catalogUrls: catalogUrls,
    readOnline: readOnline
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = DurangoCatalog; else globalThis.DurangoCatalog = DurangoCatalog;
