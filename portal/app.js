/* app.js: draws the solocode.co server picker from servers-v3.json (contract S1) via catalog.js.
   DOM is built with createElement + textContent only. Links come from values that already passed
   parseCatalog / actionFor / idLinks / discordUrl (https: only, or durango://play/<checked id>). */
(function () {
  "use strict";

  var C = window.DurangoCatalog;
  var RAW_BASE = "https://raw.githubusercontent.com/SoloCode228/Durango-OffServer-Client/main/";
  var CATALOG_TIMEOUT_MS = 8000;
  /* raw GitHub is tried first with a shorter wait, so a hanging GitHub does not hold the page while the
     same-origin copy is one request away. The last (or only) url keeps the full CATALOG_TIMEOUT_MS. */
  var FIRST_CATALOG_TIMEOUT_MS = 3500;
  var STATUS_TIMEOUT_MS = 4000;
  var CHIPS = [
    { filter: "all", label: "ทั้งหมด" },
    { filter: "classic", label: "กฎ Classic" },
    { filter: "renewal", label: "กฎ Renewal" },
    { filter: "soon", label: "เปิดเร็ว ๆ นี้" }
  ];

  var state = {
    catalog: null,
    layout: "cards",
    filter: "all",
    query: "",
    online: {},          /* server id -> number, filled by the /status fetches */
    discord: C.DEFAULT_DISCORD,
    loadId: 0
  };
  var statusEls = {};    /* server id -> [label span] currently on the page */
  var discordEls = [];   /* «ดูประกาศใน Discord» links currently on the page */

  function $(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /* fetch JSON with a timeout; resolves null on any failure. */
  function getJson(url, timeoutMs, cacheMode) {
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs) : null;
    var opts = { cache: cacheMode };
    if (ctrl) opts.signal = ctrl.signal;
    return fetch(url, opts)
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (j) { if (timer) clearTimeout(timer); return j; });
  }

  /* ---------- downloads (moved from the old inline script) ---------- */

  /* Latest links from the same files the launcher checks for updates · failure = keep the links in the page. */
  function mb(n) { return n >= 1048576 ? Math.round(n / 1048576) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }

  function setDownload(id, l) {
    if (!l || typeof l.url !== "string" || !/^https:\/\/github\.com\//.test(l.url)) return;
    $(id).setAttribute("href", l.url);
    $(id + "-v").textContent = "v" + l.version + (l.size ? " · " + mb(l.size) : "");
  }

  function loadDownloads() {
    getJson(RAW_BASE + "pc-launcher.json", CATALOG_TIMEOUT_MS, "no-cache").then(function (j) {
      setDownload("dl-pc", j);
    });
    /* android.json is read once: Android download button + Discord link. */
    getJson(RAW_BASE + "android.json", CATALOG_TIMEOUT_MS, "no-cache").then(function (j) {
      setDownload("dl-and", j && j.launcher);
      state.discord = C.discordUrl(j);
      $("nav-news").setAttribute("href", state.discord);
      /* Update the drawn links in place: a redraw would drop keyboard focus. */
      discordEls.forEach(function (a) { a.setAttribute("href", state.discord); });
    });
  }

  /* ---------- catalog ---------- */

  function showMessage(text, withRetry) {
    var list = $("list");
    clear(list);
    var box = el("div", "msg", text);
    box.setAttribute("role", "status");
    if (withRetry) {
      box.appendChild(document.createElement("br"));
      var retry = el("button", "btn y", "ลองใหม่");
      retry.type = "button";
      retry.addEventListener("click", loadCatalog);
      box.appendChild(retry);
    }
    list.appendChild(box);
  }

  function loadCatalog() {
    var myLoad = ++state.loadId;
    $("bar").hidden = true;
    showMessage("กำลังโหลดรายชื่อเซิร์ฟ…", false);
    var urls = C.catalogUrls(window.location);
    var i = 0;
    function next() {
      if (myLoad !== state.loadId) return;
      if (i >= urls.length) {
        showMessage("โหลดรายชื่อเซิร์ฟไม่ได้", true);
        return;
      }
      var timeout = i === 0 && urls.length > 1 ? FIRST_CATALOG_TIMEOUT_MS : CATALOG_TIMEOUT_MS;
      getJson(urls[i++], timeout, "no-cache").then(function (j) {
        if (myLoad !== state.loadId) return;
        var catalog = j === null ? null : C.parseCatalog(j);
        if (catalog === null) { next(); return; }
        onCatalog(catalog);
      });
    }
    next();
  }

  function onCatalog(catalog) {
    state.catalog = catalog;
    state.layout = C.layoutFor(catalog.servers);
    var links = C.idLinks(catalog.idService);
    setAccountLink("signup", links.signup);
    setAccountLink("login", links.login);
    drawBar();
    drawList();
    loadOnline();
  }

  function setAccountLink(id, url) {
    var a = $(id);
    if (url) {
      a.setAttribute("href", url);
      a.hidden = false;
    } else {
      a.hidden = true;
    }
  }

  /* ---------- filter bar ---------- */

  function drawBar() {
    var bar = $("bar");
    clear(bar);
    CHIPS.forEach(function (c) {
      var b = el("button", "chip", c.label);
      b.type = "button";
      b.setAttribute("data-filter", c.filter);
      b.setAttribute("aria-pressed", c.filter === state.filter ? "true" : "false");
      b.addEventListener("click", function () {
        state.filter = c.filter;
        Array.prototype.forEach.call(bar.querySelectorAll(".chip"), function (x) {
          x.setAttribute("aria-pressed", x === b ? "true" : "false");
        });
        drawList();
      });
      bar.appendChild(b);
    });
    if (state.layout === "table") {
      var input = el("input");
      input.type = "search";
      input.placeholder = "ค้นหาเซิร์ฟ";
      input.setAttribute("aria-label", "ค้นหาเซิร์ฟ");
      input.value = state.query;
      input.addEventListener("input", function () {
        state.query = input.value;
        drawList();
      });
      bar.appendChild(input);
    } else {
      state.query = "";
    }
    bar.hidden = false;
  }

  /* ---------- list ---------- */

  function drawList() {
    var list = $("list");
    clear(list);
    statusEls = {};
    discordEls = [];
    var all = state.catalog.servers;
    var shown = C.filterServers(all, { filter: state.filter, query: state.query });
    if (shown.length === 0) {
      var none = el("div", "msg", "ไม่พบเซิร์ฟที่ตรงกับตัวกรอง");
      none.setAttribute("role", "status");
      list.appendChild(none);
      return;
    }
    list.appendChild(state.layout === "table" ? drawTable(shown) : drawCards(shown));
  }

  function rulesLabel(server) {
    return C.groupByRules([server])[0].label;
  }

  function rulesTag(server) {
    var cls = server.rules === "renewal" ? "tag y" : server.rules === "classic" ? "tag" : "tag o";
    return el("span", cls, rulesLabel(server));
  }

  function statusPill(server) {
    var pill = el("span", "state");
    var dot = el("i", server.status === "open" ? "dot" : server.status === "soon" ? "dot soon" : "dot off");
    var label = el("span", null, C.statusLabel(server, state.online[server.id]));
    pill.appendChild(dot);
    pill.appendChild(label);
    (statusEls[server.id] = statusEls[server.id] || []).push({ server: server, label: label });
    return pill;
  }

  /* inTable: the status column already shows the open date, so the action cell does not repeat it. */
  function actionBox(server, inTable) {
    var box = el("div", "act");
    var action = C.actionFor(server);
    if (action.kind === "play") {
      var play = el("button", "go", "เล่น →");
      play.type = "button";
      play.setAttribute("aria-label", "เล่น " + server.name.th);
      play.addEventListener("click", function () { openPlay(server, action); });
      box.appendChild(play);
    } else if (action.kind === "soon") {
      if (action.opensText !== null && !inTable) box.appendChild(el("span", "soon-at", C.statusLabel(server)));
      var news = el("a", null, "ดูประกาศใน Discord");
      news.setAttribute("href", state.discord);
      news.setAttribute("target", "_blank");
      news.setAttribute("rel", "noopener");
      discordEls.push(news);
      box.appendChild(news);
    } else if (action.kind === "maintenance") {
      var off = el("button", "go", "ปิดปรับปรุง");
      off.type = "button";
      off.disabled = true;
      box.appendChild(off);
    }
    return box;
  }

  function drawCards(servers) {
    var grid = el("div", "grid");
    servers.forEach(function (s) {
      var card = el("article", "card");
      var top = el("div", "top");
      top.appendChild(rulesTag(s));
      top.appendChild(statusPill(s));
      card.appendChild(top);
      card.appendChild(el("h2", null, s.name.th));
      if (s.tagline) {
        var p = el("p", null, s.tagline.th);
        p.appendChild(el("span", "en", s.tagline.en));
        card.appendChild(p);
      }
      var act = actionBox(s);
      if (act.firstChild) card.appendChild(act);
      if (s.links.site) {
        var site = el("div", "site");
        var a = el("a", null, "หน้าเซิร์ฟ →");
        a.setAttribute("href", s.links.site);
        a.setAttribute("rel", "noopener");
        site.appendChild(a);
        card.appendChild(site);
      }
      grid.appendChild(card);
    });
    return grid;
  }

  function drawTable(servers) {
    var table = el("div", "table");
    var head = el("div", "lrow head");
    head.appendChild(el("span", null, "เซิร์ฟเวอร์"));
    head.appendChild(el("span", null, "สถานะ"));
    head.appendChild(el("span", null, "ปุ่ม"));
    table.appendChild(head);
    C.groupByRules(servers).forEach(function (g) {
      table.appendChild(el("div", "grp", g.label + " · " + g.servers.length + " เซิร์ฟ"));
      g.servers.forEach(function (s) {
        var row = el("div", "lrow");
        var name = el("span", "nm", s.name.th);
        if (s.tagline) name.appendChild(el("span", "mut", s.tagline.th));
        row.appendChild(name);
        var status = el("span");
        status.appendChild(statusPill(s));
        row.appendChild(status);
        row.appendChild(actionBox(s, true));
        table.appendChild(row);
      });
    });
    return table;
  }

  /* ---------- online counts ---------- */

  /* After drawing: each open server with a statusUrl → /status (4 s) → readOnline. Failures (CORS etc.) are silent. */
  function loadOnline() {
    var myLoad = state.loadId;
    state.catalog.servers.forEach(function (s) {
      if (s.status !== "open" || !s.statusUrl) return;
      getJson(s.statusUrl, STATUS_TIMEOUT_MS, "no-store").then(function (j) {
        if (myLoad !== state.loadId) return;
        var n = j === null ? null : C.readOnline(j);
        if (n === null) return;
        state.online[s.id] = n;
        (statusEls[s.id] || []).forEach(function (x) {
          x.label.textContent = C.statusLabel(x.server, n);
        });
      });
    });
  }

  /* ---------- play dialog ---------- */

  function openPlay(server, action) {
    var dlg = $("play-dialog");
    $("play-title").textContent = "เล่น " + server.name.th;
    $("play-launcher").setAttribute("href", action.launcherUrl);
    var web = $("play-web");
    if (action.webUrl) {
      web.setAttribute("href", action.webUrl);
      web.hidden = false;
    } else {
      web.setAttribute("href", "#");
      web.hidden = true;
    }
    if (typeof dlg.showModal === "function") {
      if (!dlg.open) dlg.showModal();
    } else {
      dlg.setAttribute("open", "");
    }
  }

  function closePlay() {
    var dlg = $("play-dialog");
    if (typeof dlg.close === "function") dlg.close(); else dlg.removeAttribute("open");
  }

  function initDialog() {
    var dlg = $("play-dialog");
    $("play-close").addEventListener("click", closePlay);
    $("play-download").addEventListener("click", closePlay);
    /* Click on the backdrop (outside the box) closes too: the box itself is filled by .dlg, so only
       the backdrop targets the <dialog>. Esc is handled by <dialog>; the keydown covers the open-attribute fallback. */
    dlg.addEventListener("click", function (e) {
      if (e.target === dlg) closePlay();
    });
    document.addEventListener("keydown", function (e) {
      if ((e.key === "Escape" || e.key === "Esc") && dlg.hasAttribute("open")) closePlay();
    });
  }

  initDialog();
  loadDownloads();
  loadCatalog();
})();
