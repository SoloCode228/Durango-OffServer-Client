"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../catalog.js");

function s1() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "s1.json"), "utf8"));
}

function byId(cat, id) {
  return cat.servers.find((s) => s.id === id);
}

test("parses the S1 catalog", () => {
  const cat = C.parseCatalog(s1());
  assert.ok(cat);
  assert.equal(cat.servers.length, 2);
  assert.deepEqual(cat.servers.map((s) => s.id), ["renewal", "classic"]);
  assert.equal(cat.idService.web, "https://play.dorangu.tech/id");

  const classic = byId(cat, "classic");
  assert.equal(classic.opensAt, "2026-11-25T00:00:00+07:00");
  assert.equal(classic.links.playWeb, "https://classic.solocode.co/play");
  assert.equal(classic.statusUrl, "https://play-classic.solocode.co/gw/status");
  assert.equal(classic.rules, "classic");
  assert.equal(classic.status, "open");
  assert.deepEqual(classic.name, { th: "Durango Classic", en: "Durango Classic" });

  const renewal = byId(cat, "renewal");
  assert.equal(renewal.statusUrl, null);
  assert.equal(renewal.opensAt, null);
});

test("rejects schema other than 3", () => {
  const two = s1();
  two.schema = 2;
  assert.equal(C.parseCatalog(two), null);

  const none = s1();
  delete none.schema;
  assert.equal(C.parseCatalog(none), null);

  const str = s1();
  str.schema = "3";
  assert.equal(C.parseCatalog(str), null);

  assert.equal(C.parseCatalog(null), null);
  assert.equal(C.parseCatalog([]), null);
});

test("drops hidden and unknown status", () => {
  const j = s1();
  const base = j.servers[1];
  const mk = (id, status) => Object.assign(JSON.parse(JSON.stringify(base)), { id, status });
  j.servers = [mk("a-open", "open"), mk("b-soon", "soon"), mk("c-maint", "maintenance"), mk("d-hidden", "hidden"), mk("e-closed", "closed")];
  const cat = C.parseCatalog(j);
  assert.deepEqual(cat.servers.map((s) => s.id), ["a-open", "b-soon", "c-maint"]);
  assert.deepEqual(cat.servers.map((s) => s.status), ["open", "soon", "maintenance"]);
});

test("drops bad id or missing name.th, keeps first duplicate", () => {
  const j = s1();
  const bad = JSON.parse(JSON.stringify(j.servers[1]));
  bad.id = "Classic 2";
  const noTh = JSON.parse(JSON.stringify(j.servers[1]));
  noTh.id = "no-th";
  delete noTh.name.th;
  const dup = JSON.parse(JSON.stringify(j.servers[0]));
  dup.name = { th: "Second Renewal", en: "Second Renewal" };
  j.servers.push(bad, noTh, dup);
  const cat = C.parseCatalog(j);
  assert.deepEqual(cat.servers.map((s) => s.id), ["renewal", "classic"]);
  assert.equal(byId(cat, "renewal").name.th, "Durango Renewal");
});

test("name.en falls back to th", () => {
  const j = s1();
  delete j.servers[1].name.en;
  delete j.servers[1].tagline;
  const classic = byId(C.parseCatalog(j), "classic");
  assert.equal(classic.name.en, classic.name.th);
  assert.equal(classic.name.en, "Durango Classic");
  assert.equal(classic.tagline, null);
});

test("unknown rules become other", () => {
  const j = s1();
  j.servers[0].rules = "pvp";
  j.servers[1].rules = "Classic";
  const cat = C.parseCatalog(j);
  assert.deepEqual(cat.servers.map((s) => s.id), ["renewal", "classic"]);
  assert.equal(byId(cat, "renewal").rules, "other");
  assert.equal(byId(cat, "classic").rules, "other");
});

test("sorts by order, stable", () => {
  const j = s1();
  const base = j.servers[1];
  const mk = (id, order) => Object.assign(JSON.parse(JSON.stringify(base)), { id, order });
  j.servers = [mk("x-30", 30), mk("first-10", 10), mk("odd", 1.5), mk("second-10", 10)];
  const cat = C.parseCatalog(j);
  assert.deepEqual(cat.servers.map((s) => s.id), ["first-10", "second-10", "x-30", "odd"]);
});

test("drops non-https links", () => {
  const j = s1();
  j.servers[1].links.play_web = "javascript:alert(1)";
  j.servers[0].links.play_web = "http://x.test";
  j.id_service.web = "http://play.dorangu.tech/id";
  const cat = C.parseCatalog(j);
  assert.equal(byId(cat, "classic").links.playWeb, null);
  assert.equal(byId(cat, "classic").links.site, "https://classic.solocode.co");
  assert.equal(byId(cat, "renewal").links.playWeb, null);
  assert.equal(byId(cat, "renewal").links.site, "https://play.dorangu.tech");
  assert.equal(cat.idService.web, null);
});

test("ignores unknown fields", () => {
  const plain = C.parseCatalog(s1());
  const j = s1();
  j.future = 1;
  j.servers[0].future = 1;
  j.servers[1].future = 1;
  j.servers[1].lanes[0].future = 1;
  assert.deepEqual(C.parseCatalog(j), plain);
});
