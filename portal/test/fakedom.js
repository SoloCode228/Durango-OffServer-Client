"use strict";
/* fakedom.js: the smallest DOM app.js needs, so its drawing can be tested with `node --test` (no npm, no jsdom).
   Not a test file itself (the runner only picks *.test.js). */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const C = require("../catalog.js");

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.childNodes = [];
    this.parentNode = null;
    this.attrs = {};
    this.listeners = {};
    this.className = "";
    this.hidden = false;
    this.disabled = false;
    this.type = "";
    this.value = "";
    this.placeholder = "";
    this.open = false;
    this._text = "";
  }
  get firstChild() { return this.childNodes[0] || null; }
  appendChild(c) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    this.childNodes.push(c);
    return c;
  }
  removeChild(c) {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) this.childNodes.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  get textContent() { return this._text + this.childNodes.map((c) => c.textContent).join(""); }
  set textContent(v) {
    this.childNodes.forEach((c) => { c.parentNode = null; });
    this.childNodes = [];
    this._text = String(v);
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === "open") this.open = true;
  }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); }
  removeAttribute(k) {
    delete this.attrs[k];
    if (k === "open") this.open = false;
  }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  dispatch(type, ev) { (this.listeners[type] || []).forEach((fn) => fn(ev || { target: this })); }
  click() { if (!this.disabled) this.dispatch("click", { target: this }); }
  /* Descendants in document order. */
  all() {
    const out = [];
    (function walk(n) { n.childNodes.forEach((c) => { out.push(c); walk(c); }); })(this);
    return out;
  }
  /* Only ".class" selectors (all app.js uses). */
  querySelectorAll(sel) {
    if (sel.charAt(0) !== ".") throw new Error("fakedom: unsupported selector " + sel);
    return this.byClass(sel.slice(1));
  }
  byClass(cls) { return this.all().filter((e) => e.className.split(" ").includes(cls)); }
  byTag(tag) { return this.all().filter((e) => e.tagName === tag.toUpperCase()); }
}

/* Every id app.js looks up. */
const IDS = ["list", "bar", "signup", "login", "nav-news", "dl-pc", "dl-pc-v", "dl-and", "dl-and-v",
  "play-dialog", "play-title", "play-launcher", "play-web", "play-close", "play-download"];

function makeDocument() {
  const byId = {};
  const docListeners = {};
  IDS.forEach((id) => {
    const e = new FakeEl(id === "play-dialog" ? "dialog" : "div");
    e.attrs.id = id;
    byId[id] = e;
  });
  byId.bar.hidden = true;
  return {
    byId,
    getElementById: (id) => byId[id] || null,
    createElement: (tag) => new FakeEl(tag),
    addEventListener: (type, fn) => { (docListeners[type] = docListeners[type] || []).push(fn); }
  };
}

/* routes: url -> object (200 JSON) | number (that HTTP status) | "hang" (only the abort ends it)
   | a function returning a Promise of one of those. Unknown urls answer 404. */
function makeFetch(routes, now) {
  const calls = [];
  function fetch(url, opts) {
    calls.push({ url, at: now(), opts });
    const signal = opts && opts.signal;
    return new Promise((resolve, reject) => {
      if (signal) {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      }
      let r = Object.prototype.hasOwnProperty.call(routes, url) ? routes[url] : 404;
      Promise.resolve(typeof r === "function" ? r() : r).then((v) => {
        if (v === "hang") return;
        if (typeof v === "number") resolve({ ok: false, status: v, json: () => Promise.reject(new Error("no body")) });
        else resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(v))) });
      });
    });
  }
  return { fetch, calls };
}

/* Runs app.js in a fresh context. Call after mock.timers.enable so the mocked setTimeout is used. */
function startApp(routes, opts) {
  const document = makeDocument();
  let clock = 0;
  const f = makeFetch(routes, () => clock);
  const ctx = {
    document,
    fetch: f.fetch,
    AbortController,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    URL,
    URLSearchParams,
    console,
    DurangoCatalog: C,
    location: (opts && opts.location) || { hostname: "solocode.co", search: "" }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8"), ctx);
  return {
    document,
    $: (id) => document.byId[id],
    calls: f.calls,
    setClock: (ms) => { clock = ms; }
  };
}

/* Lets pending promise callbacks run (setImmediate is not mocked). */
async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

function fixtureJson(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));
}

module.exports = { FakeEl, startApp, flush, fixtureJson };
