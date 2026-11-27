"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../catalog.js");
const { startApp, flush, fixtureJson } = require("./fakedom.js");

const RAW = "https://raw.githubusercontent.com/SoloCode228/Durango-OffServer-Client/main/";

/* Starts app.js with mocked setTimeout; advance(ms) moves the fake clock and runs due timers. */
function boot(t, routes, opts) {
  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const app = startApp(routes, opts);
  let now = 0;
  app.advance = async (ms) => {
    now += ms;
    app.setClock(now);
    t.mock.timers.tick(ms);
    await flush();
  };
  return app;
}

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

test("play buttons name their server for screen readers", async (t) => {
  const app = boot(t, { [C.RAW_V3]: fixtureJson("s1.json") });
  await flush();
  const plays = app.$("list").byClass("go").filter((b) => b.textContent === "เล่น →");
  assert.equal(plays.length, 2);
  const names = C.parseCatalog(fixtureJson("s1.json")).servers.map((s) => "เล่น " + s.name.th);
  assert.deepEqual(plays.map((b) => b.getAttribute("aria-label")), names);
});

test("table soon row shows the open date once, cards keep the date line", async (t) => {
  const many = fixtureJson("many.json");
  const when = C.statusLabel(C.parseCatalog(many).servers.find((s) => s.id === "ex-classic-soon"));
  assert.match(when, /^เปิด /);

  const table = boot(t, { [C.RAW_V3]: many });
  await flush();
  const row = table.$("list").byClass("lrow").find((r) => r.textContent.includes("ex-classic-soon") ||
    r.textContent.includes(C.parseCatalog(many).servers.find((s) => s.id === "ex-classic-soon").name.th));
  assert.ok(row, "soon row drawn");
  assert.equal(count(row.textContent, when), 1);
  assert.equal(row.byClass("soon-at").length, 0);

  const few = Object.assign({}, many, { servers: many.servers.filter((s) => s.id === "classic" || s.id === "ex-classic-soon") });
  const cards = boot(t, { [C.RAW_V3]: few });
  await flush();
  const card = cards.$("list").byClass("card").find((c) => c.byClass("soon-at").length > 0);
  assert.ok(card, "card keeps the .soon-at date line");
  assert.equal(card.byClass("soon-at")[0].textContent, when);
});

test("a hanging raw GitHub falls back to the same-origin copy within 4 s", async (t) => {
  const app = boot(t, { [C.RAW_V3]: "hang", "servers-v3.json": fixtureJson("s1.json") });
  await flush();
  await app.advance(4000);
  const fallback = app.calls.find((c) => c.url === "servers-v3.json");
  assert.ok(fallback, "fallback fetched by 4 s");
  assert.ok(fallback.at <= 4000);
  assert.equal(app.$("list").byClass("card").length, 2);
});

test("the same-origin copy keeps the full 8 s timeout", async (t) => {
  const app = boot(t, { [C.RAW_V3]: 404, "servers-v3.json": "hang" });
  await flush();
  await app.advance(7999);
  assert.equal(app.$("list").textContent, "กำลังโหลดรายชื่อเซิร์ฟ…");
  await app.advance(1);
  assert.match(app.$("list").textContent, /^โหลดรายชื่อเซิร์ฟไม่ได้/);
});

test("a single ?catalog= preview url keeps the full 8 s timeout", async (t) => {
  const app = boot(t, { "/x.json": "hang" }, { location: { hostname: "localhost", search: "?catalog=/x.json" } });
  await flush();
  await app.advance(7999);
  assert.equal(app.$("list").textContent, "กำลังโหลดรายชื่อเซิร์ฟ…");
  await app.advance(1);
  assert.match(app.$("list").textContent, /^โหลดรายชื่อเซิร์ฟไม่ได้/);
});

test("a late android.json updates Discord links in place, no redraw", async (t) => {
  let release;
  const android = new Promise((r) => { release = r; });
  const discord = "https://discord.com/invite/abc";
  const app = boot(t, {
    [C.RAW_V3]: fixtureJson("many.json"),
    [RAW + "android.json"]: () => android
  });
  await flush();
  const list = app.$("list");
  const drawn = list.firstChild;
  const before = list.byTag("a").filter((a) => a.textContent === "ดูประกาศใน Discord");
  assert.equal(before.length, 2);
  before.forEach((a) => assert.equal(a.getAttribute("href"), C.DEFAULT_DISCORD));

  release({ links: { discord } });
  await flush();
  assert.equal(list.firstChild, drawn, "list was not redrawn");
  before.forEach((a) => assert.equal(a.getAttribute("href"), discord));
  assert.equal(app.$("nav-news").getAttribute("href"), discord);

  /* links drawn later (filter click) use the new value too */
  app.$("bar").byClass("chip").find((b) => b.getAttribute("data-filter") === "soon").click();
  const after = list.byTag("a").filter((a) => a.textContent === "ดูประกาศใน Discord");
  assert.equal(after.length, 2);
  after.forEach((a) => assert.equal(a.getAttribute("href"), discord));
});

test("list messages are status regions", async (t) => {
  const app = boot(t, {});
  await flush();
  const msgs = app.$("list").byClass("msg");
  assert.equal(msgs.length, 1);
  assert.match(msgs[0].textContent, /^โหลดรายชื่อเซิร์ฟไม่ได้/);
  assert.equal(msgs[0].getAttribute("role"), "status");

  const ok = boot(t, { [C.RAW_V3]: fixtureJson("s1.json") });
  await flush();
  ok.$("bar").byClass("chip").find((b) => b.getAttribute("data-filter") === "soon").click();
  const none = ok.$("list").byClass("msg");
  assert.equal(none.length, 1);
  assert.equal(none[0].textContent, "ไม่พบเซิร์ฟที่ตรงกับตัวกรอง");
  assert.equal(none[0].getAttribute("role"), "status");
});
