"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(name) {
  return fs.readFileSync(path.join(__dirname, "..", name), "utf8");
}

test("page has no hard-coded server names", () => {
  const banned = ["Durango Classic", "Durango Renewal", "Dorangu", "reborn", "renewal.solocode.co", "OBT"];
  for (const file of ["index.html", "app.js"]) {
    const text = read(file);
    for (const word of banned) {
      assert.ok(!text.includes(word), file + " contains " + JSON.stringify(word));
    }
  }
});

test("app.js never writes HTML", () => {
  const js = read("app.js");
  for (const word of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write"]) {
    assert.ok(!js.includes(word), "app.js contains " + word);
  }
});

test("index.html loads catalog.js before app.js", () => {
  const html = read("index.html");
  const catalog = html.indexOf('src="catalog.js"');
  const app = html.indexOf('src="app.js"');
  assert.ok(catalog >= 0, "catalog.js is not loaded");
  assert.ok(app >= 0, "app.js is not loaded");
  assert.ok(catalog < app, "catalog.js must load before app.js");

  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length >= 2);
  for (const [, attrs, body] of scripts) {
    assert.match(attrs, /\bsrc="/, "every <script> needs src");
    assert.equal(body.trim(), "", "no inline script code");
  }
});

test("filter bar is a labelled group; only the message boxes are live", () => {
  const html = read("index.html");
  const bar = html.match(/<div\b[^>]*\bid="bar"[^>]*>/);
  assert.ok(bar, "#bar exists");
  assert.match(bar[0], /\brole="group"/);
  assert.match(bar[0], /\baria-label="ตัวกรอง"/);
  const list = html.match(/<div\b[^>]*\bid="list"[^>]*>/);
  assert.ok(list, "#list exists");
  assert.doesNotMatch(list[0], /aria-live/, "the whole list must not be a live region");
  assert.match(html, /<div class="msg" role="status">กำลังโหลดรายชื่อเซิร์ฟ…<\/div>/);
});
