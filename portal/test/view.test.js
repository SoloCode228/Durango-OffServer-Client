"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../catalog.js");

const RAW_V3 = "https://raw.githubusercontent.com/SoloCode228/Durango-OffServer-Client/main/servers-v3.json";
const DEFAULT_DISCORD = "https://discord.gg/RMfeg6Drbu";

function fixture(name) {
  return C.parseCatalog(JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8")));
}

function ids(servers) {
  return servers.map((s) => s.id);
}

function server(overrides) {
  const base = fixture("s1.json").servers.find((s) => s.id === "classic");
  return Object.assign(base, overrides);
}

test("filter by rules and soon", () => {
  const all = fixture("many.json").servers;
  const classic = C.filterServers(all, { filter: "classic", query: "" });
  assert.deepEqual(ids(classic), ["classic", "ex-classic-open", "ex-classic-soon", "ex-classic-maint"]);
  assert.ok(classic.every((s) => s.rules === "classic"));

  const soon = C.filterServers(all, { filter: "soon", query: "" });
  assert.deepEqual(ids(soon), ["ex-classic-soon", "ex-renewal-soon"]);
  assert.ok(soon.every((s) => s.status === "soon"));

  assert.equal(C.filterServers(all, { filter: "all", query: "" }).length, 8);
});

test("search matches th, en and id, case-insensitive", () => {
  const all = fixture("many.json").servers;
  const classic = C.filterServers(all, { filter: "all", query: "  CLASSIC " });
  assert.ok(ids(classic).includes("classic"));
  assert.deepEqual(ids(classic), ["classic", "ex-classic-open", "ex-classic-soon", "ex-classic-maint"]);

  assert.deepEqual(ids(C.filterServers(all, { filter: "all", query: "sample renewal open" })), ["ex-renewal-open"]);
  assert.deepEqual(ids(C.filterServers(all, { filter: "all", query: "เรนิวัลตัวอย่าง เปิด" })), ["ex-renewal-open"]);
  assert.deepEqual(ids(C.filterServers(all, { filter: "all", query: "EX-PVP" })), ["ex-pvp"]);

  assert.equal(C.filterServers(all, { filter: "all", query: "" }).length, 8);
});

test("layout is decided by all servers, not the filtered list", () => {
  const all = fixture("many.json").servers;
  assert.equal(C.layoutFor(all.slice(0, 6)), "cards");
  assert.equal(C.layoutFor(all.slice(0, 7)), "table");

  const filtered = C.filterServers(all, { filter: "classic", query: "" });
  assert.ok(filtered.length <= 6);
  assert.equal(C.groupByRules(filtered).length, 1);
  assert.equal(C.layoutFor(filtered), "cards");
  assert.equal(C.layoutFor(all), "table");
});

test("groups classic, renewal, other in that order, skipping empty", () => {
  const groups = C.groupByRules(fixture("many.json").servers);
  assert.deepEqual(groups.map((g) => g.label), ["กฎ Classic", "กฎ Renewal", "กฎอื่น"]);
  assert.deepEqual(groups.map((g) => g.rules), ["classic", "renewal", "other"]);
  assert.deepEqual(ids(groups[0].servers), ["classic", "ex-classic-open", "ex-classic-soon", "ex-classic-maint"]);
  assert.deepEqual(ids(groups[1].servers), ["renewal", "ex-renewal-open", "ex-renewal-soon"]);
  assert.deepEqual(ids(groups[2].servers), ["ex-pvp"]);

  const two = C.groupByRules(fixture("s1.json").servers);
  assert.deepEqual(two.map((g) => g.label), ["กฎ Classic", "กฎ Renewal"]);
});

test("formatOpensAt in Bangkok time", () => {
  assert.equal(C.formatOpensAt("2026-11-25T00:00:00+07:00"), "25 พ.ย. 2026 00:00");
  assert.equal(C.formatOpensAt("2026-12-31T17:30:00Z"), "1 ม.ค. 2027 00:30");
  assert.equal(C.formatOpensAt("garbage"), null);
});

test("statusLabel", () => {
  const open = server({ status: "open" });
  assert.equal(C.statusLabel(open, null), "เปิดอยู่");
  assert.equal(C.statusLabel(open, 12), "เปิดอยู่ · 12 คน");
  assert.equal(C.statusLabel(server({ status: "soon", opensAt: "2026-11-25T00:00:00+07:00" }), null), "เปิด 25 พ.ย. 2026 00:00");
  assert.equal(C.statusLabel(server({ status: "soon", opensAt: null }), null), "เร็ว ๆ นี้");
  assert.equal(C.statusLabel(server({ status: "maintenance" }), null), "ปิดปรับปรุง");
});

test("actionFor", () => {
  assert.deepEqual(C.actionFor(server({ status: "open" })), {
    kind: "play",
    launcherUrl: "durango://play/classic",
    webUrl: "https://classic.solocode.co/play"
  });
  const noWeb = server({ status: "open" });
  noWeb.links = { site: "https://classic.solocode.co", playWeb: null };
  assert.deepEqual(C.actionFor(noWeb), { kind: "play", launcherUrl: "durango://play/classic", webUrl: null });
  assert.deepEqual(C.actionFor(server({ status: "open", rules: "other" })), { kind: "none" });

  const soonAt = "2026-12-20T19:00:00+07:00";
  assert.deepEqual(C.actionFor(server({ status: "soon", opensAt: soonAt })), { kind: "soon", opensText: C.formatOpensAt(soonAt) });
  assert.deepEqual(C.actionFor(server({ status: "soon", opensAt: null })), { kind: "soon", opensText: null });
  assert.deepEqual(C.actionFor(server({ status: "maintenance" })), { kind: "maintenance" });
});

test("idLinks", () => {
  const want = { signup: "https://play.dorangu.tech/id/signup", login: "https://play.dorangu.tech/id/login" };
  assert.deepEqual(C.idLinks({ web: "https://play.dorangu.tech/id" }), want);
  assert.deepEqual(C.idLinks({ web: "https://play.dorangu.tech/id/" }), want);
  assert.deepEqual(C.idLinks({ web: null }), { signup: null, login: null });
});

test("discordUrl", () => {
  assert.equal(C.DEFAULT_DISCORD, DEFAULT_DISCORD);
  assert.equal(C.discordUrl({ links: { discord: "https://discord.gg/abc" } }), "https://discord.gg/abc");
  assert.equal(C.discordUrl({ links: { discord: "http://discord.gg/abc" } }), DEFAULT_DISCORD);
  assert.equal(C.discordUrl({ links: { discord: "https://evil.test/x" } }), DEFAULT_DISCORD);
  assert.equal(C.discordUrl(null), DEFAULT_DISCORD);
});

test("catalogUrls honours ?catalog only on localhost", () => {
  assert.equal(C.RAW_V3, RAW_V3);
  const search = "?catalog=/portal/test/fixtures/many.json";
  assert.deepEqual(C.catalogUrls({ hostname: "localhost", search }), ["/portal/test/fixtures/many.json"]);
  assert.deepEqual(C.catalogUrls({ hostname: "127.0.0.1", search }), ["/portal/test/fixtures/many.json"]);
  assert.deepEqual(C.catalogUrls({ hostname: "solocode.co", search: "?catalog=https://evil.test/x.json" }), [RAW_V3, "servers-v3.json"]);
  assert.deepEqual(C.catalogUrls({ hostname: "localhost", search: "" }), [RAW_V3, "servers-v3.json"]);
});

test("readOnline", () => {
  assert.equal(C.readOnline({ ok: true, online: 5 }), 5);
  assert.equal(C.readOnline({ ok: true, online: -1 }), null);
  assert.equal(C.readOnline({ ok: false, online: 5 }), null);
  assert.equal(C.readOnline({ online: "5" }), null);
  assert.equal(C.readOnline(null), null);
});
