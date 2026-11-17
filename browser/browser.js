// 🌐 Browser: a web browser inside the site. Every page goes through a proxy:
//   this page → the proxy worker (sw.js, Ultraviolet) → an encrypted tunnel (epoxy) → a Wisp proxy server → the website.
// Tabs, bookmarks, history and settings are saved in this browser (localStorage).
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const BASE = location.pathname.replace(/[^/]*$/, '');   // this folder, e.g. /idk/browser/
  const CFG = self.__uv$config;
  const PREFIX = CFG.prefix;                               // pages through the proxy live here: /idk/browser/go/…

  // ---------- saving ----------
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem('browser-' + k)); return v == null ? d : v; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem('browser-' + k, JSON.stringify(v)); } catch (e) {} };

  // ✏️ EDIT: free public proxy servers (Wisp), run by other people. They come and go, so there are lots.
  // "Automatic" tests them in this order (each one has to actually load a small page) and uses the first that works,
  // and moves on to the next one by itself if pages stop loading.
  const SERVERS = load('servers', null) || [
    { name: 'FreeWisp', url: 'wss://wisp.freewisp.org/' },
    { name: 'Terbium', url: 'wss://wisp.terbiumon.top/wisp/' },
    { name: 'Anura', url: 'wss://anura.pro/' },
    { name: 'DayDreamX', url: 'wss://daydreamx.pro/wisp/' },
    { name: 'Go Into Space', url: 'wss://gointospace.app/wisp/' },
    { name: 'Truffled', url: 'wss://truffled.lol/wisp/' },
    { name: 'Fern', url: 'wss://fern.best/wisp/' },
    { name: 'WebMC', url: 'wss://wisp.webmc.fun/' },
    { name: 'Overcooked', url: 'wss://learn.overcookedchicken.org/wisp/' },
    { name: 'Mercury Workshop (slow demo)', url: 'wss://wisp.mercurywork.shop/' },
  ];
  const CHECK_URL = load('check-url', '') || 'https://example.com/';   // the tiny page every server has to load to count as working
  // ✏️ EDIT: search engines (%s is what was typed)
  const ENGINES = {
    ddg: ['DuckDuckGo', 'https://duckduckgo.com/?q=%s'],
    google: ['Google', 'https://www.google.com/search?q=%s'],
    bing: ['Bing', 'https://www.bing.com/search?q=%s'],
    brave: ['Brave Search', 'https://search.brave.com/search?q=%s'],
    wiki: ['Wikipedia', 'https://en.wikipedia.org/w/index.php?search=%s'],
  };
  // ✏️ EDIT: the shortcuts on a new tab (people can add and remove their own)
  const QUICK = [
    ['📖', 'Wikipedia', 'https://www.wikipedia.org/'],
    ['▶️', 'YouTube', 'https://www.youtube.com/'],
    ['🐙', 'GitHub', 'https://github.com/'],
    ['🎓', 'Khan Academy', 'https://www.khanacademy.org/'],
    ['🐱', 'Scratch', 'https://scratch.mit.edu/'],
    ['🦆', 'DuckDuckGo', 'https://duckduckgo.com/'],
  ];
  const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-pointer-lock allow-presentation';
  const COLORS = ['#5b5bd6', '#e0457b', '#0e9f9e', '#d97706', '#16a34a', '#3b82f6', '#c026d3', '#dc2626', '#64748b'];

  const prefs = Object.assign({ server: 'auto', custom: '', engine: 'ddg', restore: true }, load('prefs', {}));
  let bookmarks = load('bookmarks', []), visits = load('history', []);
  let quick = load('quick', null) || QUICK.map(([e, n, u]) => ({ e, n, u }));
  if (!Array.isArray(bookmarks)) bookmarks = [];
  if (!Array.isArray(visits)) visits = [];
  if (!Array.isArray(quick)) quick = QUICK.map(([e, n, u]) => ({ e, n, u }));

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } };
  const color = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
  const letter = u => (host(u)[0] || '?').toUpperCase();
  const toast = (m, ms) => (window.GS ? GS.toast(m, ms) : console.log(m));
  const same = (a, b) => (a || '').replace(/\/$/, '') === (b || '').replace(/\/$/, '');

  // ---------- addresses ----------
  // What was typed → a web address (or a search)
  function toUrl(input) {
    const s = String(input || '').trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) { try { return new URL(s).href; } catch (e) { /* not a real address: search it */ } }
    else if (!/\s/.test(s) && !/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(s)) {
      const local = /^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/|$)/i.test(s);
      if (local || /^[\w-]+(\.[\w-]+)*\.[a-z][a-z0-9-]{1,62}(:\d+)?([/?#].*)?$/i.test(s)) {
        try { return new URL((local ? 'http://' : 'https://') + s).href; } catch (e) {}
      }
    }
    const eng = ENGINES[prefs.engine] || ENGINES.ddg;
    return eng[1].replace('%s', encodeURIComponent(s));
  }
  const proxied = url => PREFIX + CFG.encodeUrl(url);
  // A proxied address (…/go/xyz) → the real web address, or null
  function realOf(href) {
    try {
      const u = new URL(href, location.href);
      if (u.origin !== location.origin || !u.pathname.startsWith(PREFIX)) return null;
      let r = CFG.decodeUrl(u.pathname.slice(PREFIX.length) + u.search);
      if (u.hash) r = r.replace(/#.*$/, '') + u.hash;
      return /^https?:/i.test(r) ? r : null;
    } catch (e) { return null; }
  }

  // ---------- the proxy engine ----------
  let engineP = null, conn = null, bare = null;
  const server = { url: '', ok: null };
  function unsupported() {
    if (location.protocol === 'file:') return 'The Browser only works on the real website, not when the page is opened as a file.';
    if (!('serviceWorker' in navigator)) return 'This browser can\'t run the proxy (it has no service workers). Private windows in some browsers turn them off. Try a normal window, or Chrome, Edge, Firefox or Safari.';
    if (!window.isSecureContext) return 'The proxy only works on a secure (https) page.';
    if (typeof SharedWorker === 'undefined') return 'This browser can\'t run the proxy (it has no shared workers). Try Chrome, Edge, Firefox or Safari on a computer, or a newer version of your browser.';
    if (!CFG || !window.BareMux) return 'The proxy files didn\'t load. Check your internet connection and reload the page.';
    return '';
  }
  function ping(url, ms = 6000) {
    return new Promise(res => {
      let ws = null; const t0 = performance.now();
      const done = ok => { clearTimeout(timer); try { ws && ws.close(); } catch (e) {} res(ok ? Math.max(1, Math.round(performance.now() - t0)) : 0); };
      const timer = setTimeout(() => done(false), ms);
      try { ws = new WebSocket(url); } catch (e) { return done(false); }
      ws.onopen = () => done(true);
      ws.onerror = () => done(false);
    });
  }
  function serverList() {
    if (prefs.server === 'custom') return prefs.custom ? [prefs.custom] : [];
    if (prefs.server && prefs.server !== 'auto') return [prefs.server];
    return SERVERS.map(s => s.url);
  }
  const serverName = url => (SERVERS.find(s => s.url === url) || {}).name || host(String(url).replace(/^ws/, 'http'));
  // Load a tiny page through one server, in a worker of its own (so a broken server can't upset the real connection)
  function deepCheck(url, ms = 10000) {
    return new Promise(res => {
      let w = null, said = false;
      const done = r => { clearTimeout(timer); try { w && w.terminate(); } catch (e) {} res(r); };
      const timer = setTimeout(() => done({ ok: false, error: said ? 'timed out' : 'timed out (no answer)' }), ms);
      try { w = new Worker(BASE + 'check.js', { type: 'module' }); } catch (e) { return done({ ok: null, error: 'can\'t test here' }); }
      w.onmessage = e => { said = true; done(e.data || { ok: false }); };
      w.onerror = e => { e.preventDefault && e.preventDefault(); done({ ok: null, error: 'can\'t test here: ' + (e.message || 'worker error') }); };
      w.postMessage({ wisp: url, url: CHECK_URL });
    });
  }
  const tested = {};          // server → what its last test found
  const bad = new Set();      // servers that stopped working this visit (Automatic skips them)
  async function pickServer(force) {
    const list = serverList();
    if (!list.length) return { url: '', ok: false, why: 'none' };
    const auto = prefs.server === 'auto';
    // The server that worked last time goes first, and if it still answers it's used straight away
    const good = load('good', null);
    if (auto && !force && good && list.includes(good.u) && !bad.has(good.u) && await ping(good.u, 5000)) return { url: good.u, ok: true };
    const pool = list.filter(u => !auto || !bad.has(u));
    const pings = await Promise.all(pool.map(u => ping(u, 6000)));
    const alive = pool.filter((u, i) => pings[i]);
    pool.forEach((u, i) => { if (!pings[i]) tested[u] = { ok: false, error: 'no answer' }; });
    if (!alive.length) return { url: pool[0] || list[0], ok: false, why: 'none answered' };
    // Answering isn't enough (some are overloaded or blocked): it has to load a page. Three at a time; the first to pass wins.
    let unsure = '';
    for (let i = 0; i < alive.length && !unsure; i += 3) {
      const batch = alive.slice(i, i + 3);
      const win = await new Promise(res => {
        let left = batch.length;
        batch.forEach(u => deepCheck(u).then(r => {
          tested[u] = r; drawNow();
          if (r.ok) res(u);
          else { if (r.ok === null && !unsure) unsure = u; if (--left === 0) res(''); }
        }));
      });
      if (win) { save('good', { u: win, at: Date.now() }); return { url: win, ok: true }; }
    }
    if (unsure) return { url: unsure, ok: true };
    return { url: alive[0], ok: false, why: 'no pages' };
  }
  function activated(reg) {
    return new Promise((res, rej) => {
      const w = reg.installing || reg.waiting || reg.active;
      if (!w || w.state === 'activated') return res();
      const timer = setTimeout(() => rej(new Error('The proxy took too long to start. Reload the page to try again.')), 20000);
      w.addEventListener('statechange', () => {
        if (w.state === 'activated') { clearTimeout(timer); res(); }
        else if (w.state === 'redundant') { clearTimeout(timer); res(activated(reg)); }
      });
    });
  }
  async function connect(force) {
    setStatus('wait', prefs.server === 'auto' ? 'Finding a proxy server that works…' : 'Connecting to the proxy server…');
    const pick = await pickServer(force);
    server.url = pick.url; server.ok = pick.ok; server.why = pick.why || '';
    if (pick.ok) await useServer(pick.url);   // never hand the tunnel a server that isn't working (it can break it)
    if (pick.ok) setStatus('ok', 'Proxy on · ' + serverName(pick.url));
    else setStatus('bad', pick.why === 'none' ? 'Pick a proxy server in Settings'
      : pick.why === 'no pages' ? 'The proxy servers answer but can\'t load pages · tap for help' : 'Can\'t reach any proxy server · tap for help');
    drawNow();
    return pick.ok;
  }
  // The encrypted tunnel (epoxy) runs in one background worker shared by every tab; this points it at a proxy server
  // (Swapping a tunnel that's already connected can upset it, so that only happens when the server really changes.)
  const EPOXY = BASE + 'epoxy/index.js';
  async function useServer(url) {
    conn = conn || new BareMux.BareMuxConnection(BASE + 'baremux/worker.js');
    let name = '';
    try { name = await conn.getTransport(); } catch (e) {}
    if (name === EPOXY && load('wisp', '') === url) return;
    await conn.setTransport(EPOXY, [{ wisp: url }]);
    save('wisp', url);
  }
  function engine() {
    if (!engineP) {
      engineP = (async () => {
        const why = unsupported();
        if (why) throw Object.assign(new Error(why), { kind: 'support' });
        const reg = await navigator.serviceWorker.register(BASE + 'sw.js', { scope: PREFIX });
        await activated(reg);
        await connect();
      })();
      const p = engineP;
      p.catch(e => {
        setStatus('bad', e.kind === 'support' ? 'The proxy can\'t run in this browser' : 'The proxy didn\'t start · tap for settings');
        if (e.kind !== 'support' && engineP === p) engineP = null;   // let it try again next time
      });
    }
    return engineP;
  }
  async function reconnect(force) {   // after changing servers, or when pages fail
    try { const fresh = !engineP; await engine(); return fresh ? server.ok : await connect(force); } catch (e) { return false; }
  }
  // A page failed. If the server is the problem, Automatic moves on to the next working server and tries the page again.
  let switching = null, fails = 0;
  async function failover(t) {
    if (prefs.server !== 'auto' || !server.url || t.retried === t.url) return;
    if (!switching) {
      switching = (async () => {
        const was = server.url;
        const r = await deepCheck(was);
        fails++;
        if (r.ok && fails < 3) return false;   // the server is fine, so it's this website
        bad.add(was); fails = 0;
        if (load('good', null) && load('good', null).u === was) save('good', null);
        await reconnect(true);
        return server.ok && server.url !== was;
      })();
    }
    const moved = await switching;
    switching = null;
    if (moved && t.err && t.url) { t.retried = t.url; toast('🔁 Switched to another proxy server: ' + serverName(server.url)); go(t, t.url, true); }
  }
  async function nextServer(t) {   // the "Try another server" button
    if (prefs.server !== 'auto') { openSheet('settings'); return; }
    if (server.url) bad.add(server.url);
    t.err = null; t.loading = true; paint(t);
    const ok = await reconnect(true);
    if (!ok) bad.clear();   // nothing else works: let them all be tried again next time
    toast(ok ? '🔁 Now using ' + serverName(server.url) : '😕 No other server is working right now');
    go(t, t.url, true);
  }
  function setStatus(kind, text) {
    $('#status-dot').className = 'dot' + (kind === 'ok' ? ' ok' : kind === 'bad' ? ' bad' : '');
    $('#status-text').textContent = text;
  }

  // ---------- tabs ----------
  let tabs = [], active = null, nextId = 1;
  const closed = [];
  const hooked = new WeakSet();
  function makeTab(title) {
    return { id: nextId++, url: '', title: title || 'New tab', icon: '', frame: null, hist: [''], pos: 0, loading: false, err: null, expect: null, from: null, pending: '', zoom: 1 };
  }
  function newTab(url, opt = {}) {
    const t = makeTab(opt.title);
    const at = opt.after ? tabs.indexOf(opt.after) + 1 : tabs.length;
    tabs.splice(at > 0 ? at : tabs.length, 0, t);
    if (!opt.background || !active) select(t);
    if (url) go(t, url);
    else setTimeout(focusSearch, 30);
    renderTabs(); saveTabs();
    return t;
  }
  function closeTab(t) {
    const i = tabs.indexOf(t);
    if (i < 0) return;
    if (t.url || t.pending) closed.push({ url: t.url || t.pending, title: t.title });
    if (t.frame) t.frame.remove();
    tabs.splice(i, 1);
    if (!tabs.length) newTab();
    else if (t === active) select(tabs[Math.min(i, tabs.length - 1)]);
    renderTabs(); saveTabs();
  }
  function select(t) {
    active = t;
    if (t.pending) { const u = t.pending; t.pending = ''; go(t, u); }
    show(); renderTabs();
    const el = document.querySelector(`.tab[data-id="${t.id}"]`);
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function saveTabs() {
    save('tabs', { list: tabs.map(t => ({ url: t.url || t.pending, title: t.title })), active: Math.max(0, tabs.indexOf(active)) });
  }
  function win(t) { try { return t.frame && t.frame.contentWindow; } catch (e) { return null; } }

  function makeFrame(t) {
    const f = document.createElement('iframe');
    f.title = 'Web page';
    f.setAttribute('sandbox', SANDBOX);
    f.setAttribute('allow', 'fullscreen; autoplay; clipboard-write; encrypted-media; picture-in-picture');
    f.allowFullscreen = true;
    f.hidden = t !== active;
    f.addEventListener('load', () => { t.loading = false; t.from = null; sync(t); hook(t); paint(t); });
    $('#frames').appendChild(f);
    t.frame = f;
    applyZoom(t);
    return f;
  }
  // Open an address in a tab (adds to the tab's back/forward list)
  async function go(t, input, keepList) {
    const url = toUrl(input);
    if (!url) return;
    if (!keepList) { t.hist = t.hist.slice(0, t.pos + 1); t.hist.push(url); t.pos = t.hist.length - 1; }
    t.url = url; t.err = null; t.loading = true; t.expect = url;
    t.title = host(url); t.icon = '';
    try { const w = win(t); t.from = w ? w.location.href : null; } catch (e) { t.from = null; }
    paint(t); saveTabs();
    try { await engine(); if (!server.ok) await reconnect(); }
    catch (e) { t.loading = false; t.err = { kind: e.kind === 'support' ? 'support' : 'engine', msg: e.message }; paint(t); return; }
    if (t.url !== url) return;   // something else was opened while waiting
    if (!server.ok) {
      t.loading = false;
      t.err = noServer();
      paint(t); return;
    }
    if (!t.frame) { makeFrame(t).src = proxied(url); return; }
    try { t.frame.contentWindow.location.replace(proxied(url)); } catch (e) { t.frame.src = proxied(url); }
  }
  function toEntry(t, i) {
    t.pos = i;
    const url = t.hist[i];
    if (!url) { t.url = ''; t.err = null; t.loading = false; t.title = 'New tab'; paint(t); saveTabs(); return; }
    go(t, url, true);
  }
  const back = (t = active) => { if (t.pos > 0) toEntry(t, t.pos - 1); };
  const fwd = (t = active) => { if (t.pos < t.hist.length - 1) toEntry(t, t.pos + 1); };
  function reload(t = active) {
    if (!t.url) return;
    if (t.loading) { try { win(t).stop(); } catch (e) {} t.loading = false; paint(t); return; }
    if (t.err || !t.frame) { retry(t); return; }
    t.loading = true; paint(t);
    try { win(t).location.reload(); } catch (e) { go(t, t.url, true); }
  }
  async function retry(t = active) {
    if (t.err && t.err.kind !== 'site') { t.err = null; t.loading = true; paint(t); await reconnect(); }
    go(t, t.url, true);
  }

  // Watch what happens inside a tab: new address, title, icon, errors
  function sync(t) {
    const w = win(t);
    if (!w || (!t.url && !t.expect)) return;
    let href, doc;
    try { href = w.location.href; doc = w.document; } catch (e) { return; }
    if (t.expect && t.from && href === t.from) return;   // still showing the page from before
    const real = realOf(href);
    if (!real) return;
    if (!same(real, t.url) || t.expect) moved(t, real);
    if (!doc) return;
    const bad = doc.getElementById('errorTitle') && doc.getElementById('errorTrace');
    if (bad) {
      const msg = doc.getElementById('errorTrace').value || '';
      if (!t.err || t.err.raw !== msg) { t.err = classify(msg); t.err.msg += '\n(proxy server: ' + server.url + ')'; t.err.raw = msg; t.loading = false; paint(t); failover(t); }
      return;
    }
    if (doc.readyState === 'complete' && doc.body && doc.body.childElementCount) fails = 0;
    if (t.err && t.err.kind !== 'support') { t.err = null; paint(t); }
    const title = (doc.title || '').trim().slice(0, 200) || host(t.url);
    if (title !== t.title) {
      t.title = title; renderTabs(); if (t === active) document.title = title + ' · Browser';
      const h = visits[0]; if (h && same(h.u, t.url)) { h.t = title; save('history', visits); }
      saveTabs();
    }
    if (doc.readyState !== 'loading') favicon(t, doc);
  }
  function moved(t, real) {
    const h = t.hist, p = t.pos;
    if (t.expect) { h[p] = real; t.expect = null; t.from = null; }
    else if (p > 0 && same(h[p - 1], real)) t.pos--;
    else if (p < h.length - 1 && same(h[p + 1], real)) t.pos++;
    else if (!same(h[p], real)) { t.hist = h.slice(0, p + 1); t.hist.push(real); t.pos++; }
    else h[p] = real;
    if (!same(real, t.url)) { t.title = host(real); t.icon = ''; }
    t.url = real;
    remember(real, '');
    if (t === active) { setAddr(); renderBar(); }
    saveTabs();
  }
  function noServer() {
    const pages = server.why === 'no pages', none = server.why === 'none';
    return {
      kind: 'proxy', icon: '📡',
      h: none ? 'Pick a proxy server' : pages ? 'The proxy servers aren\'t working right now' : 'Can\'t reach any proxy server',
      p: none ? 'Choose a server in Settings, or switch back to Automatic.'
        : (pages ? 'The free proxy servers answered, but none of them could load a test page (they may be overloaded).' : 'None of the free proxy servers answered.')
          + ' If you\'re on a school or work network, it may block proxy servers. You can try again later, or use your own server (Settings).',
      msg: Object.keys(tested).length ? Object.entries(tested).map(([u, r]) => `${u}: ${r.ok ? 'works' : r.error || 'failed'}`).join('\n') : 'No servers tested.',
    };
  }
  function classify(msg) {
    const m = String(msg);
    let kind = 'site', h = 'This page couldn\'t be opened', p = 'The proxy couldn\'t load this page. Some websites block proxies or don\'t work well through one.', icon = '😕';
    if (/websocket|wisp|ws:\/\/|wss:\/\/|bare-mux|no bare clients|MessagePort|transport/i.test(m) || (/failed to fetch|network/i.test(m) && !/dns|resolve/i.test(m))) {
      kind = 'proxy'; icon = '📡'; h = 'The proxy server stopped answering';
      p = 'The free proxy server this page went through isn\'t working right now. Try another server, or try again in a moment.';
    } else if (/dns|resolve|getaddrinfo|ENOTFOUND|not found|NXDOMAIN|invalid url|hostname/i.test(m)) {
      icon = '🔎'; h = 'That website couldn\'t be found'; p = 'Check the address for typos, or search for it instead.';
    } else if (/IncompleteMessage|closed before message completed|connection refused|unreachable/i.test(m)) {
      icon = '🔎'; h = 'This site can\'t be reached'; p = 'The website didn\'t answer through the proxy. Check the address for typos, or try again later.';
    } else if (/timed? ?out|timeout/i.test(m)) {
      icon = '⏳'; h = 'The page took too long'; p = 'The website or the proxy server is slow right now. Try again in a moment.';
    } else if (/certificate|tls|ssl|handshake/i.test(m)) {
      icon = '🔐'; h = 'A secure connection couldn\'t be made'; p = 'The website\'s security check failed through the proxy.';
    }
    return { kind, h, p, icon, msg: m };
  }
  // Make links that open new windows open new tabs here instead, and keep keyboard shortcuts working inside pages
  function hook(t) {
    const w = win(t);
    let d;
    try { d = w.document; } catch (e) { return; }
    if (!d || hooked.has(d)) return;
    hooked.add(d);
    try {
      d.addEventListener('click', e => onLink(t, e), true);
      d.addEventListener('auxclick', e => onLink(t, e), true);
      d.addEventListener('keydown', onKey, true);
      d.addEventListener('pointerdown', closeMenus, true);
      w.addEventListener('beforeunload', () => { t.loading = true; paint(t); });
      const open = w.open;
      w.open = function (u, target) {
        const s = u == null ? '' : String(u);
        let real = null;
        try { real = s && s !== 'about:blank' ? (realOf(s) || new URL(s, t.url).href) : null; } catch (e) {}
        if (!real || !/^https?:/i.test(real)) return open.apply(this, arguments);
        if (/^_(self|top|parent)$/i.test(target || '')) { go(t, real); return w; }
        newTab(real, { after: t });
        return null;
      };
    } catch (e) {}
  }
  function onLink(t, e) {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    let real = null;
    try { real = realOf(a.href) || a.href; } catch (err) { return; }
    if (!real || !/^https?:/i.test(real)) return;
    const extra = e.type === 'auxclick' ? e.button === 1 : (e.button === 0 && (e.ctrlKey || e.metaKey || e.shiftKey));
    const target = (a.getAttribute('target') || '').toLowerCase();
    if (extra) { e.preventDefault(); e.stopPropagation(); newTab(real, { after: t, background: !e.shiftKey }); if (!e.shiftKey) toast('Opened in a new tab'); return; }
    if (e.type !== 'click' || e.button !== 0) return;
    if (target === '_top' || target === '_parent') { e.preventDefault(); go(t, real); return; }
    if (target && target !== '_self') {
      let named = false;
      try { named = target !== '_blank' && !!win(t)[target]; } catch (err) {}
      if (!named) { e.preventDefault(); newTab(real, { after: t }); }
    }
  }

  // Favicons are fetched through the proxy, then shown from memory
  const favs = new Map();
  let favBusy = 0;
  function favicon(t, doc) {
    if (t.icon || !t.url) return;
    let href = '';
    try { const l = doc.querySelector('link[rel~="icon" i], link[rel="shortcut icon" i], link[rel~="apple-touch-icon" i]'); if (l) href = l.href; } catch (e) {}
    let src;
    try { src = href ? (href.startsWith('data:image/') ? href : (realOf(href) || new URL(href, t.url).href)) : new URL('/favicon.ico', t.url).href; } catch (e) { return; }
    if (src.startsWith('data:')) { t.icon = src; renderTabs(); return; }
    const known = favs.get(src);
    if (typeof known === 'string') { if (known) { t.icon = known; renderTabs(); } return; }
    if (known || favBusy > 3) return;
    favs.set(src, null); favBusy++;
    (async () => {
      try {
        bare = bare || new BareMux.BareClient();
        const r = await bare.fetch(src);
        const type = r.headers.get('content-type') || '';
        if (!r.ok || !/image|icon|octet/i.test(type)) throw 0;
        const b = await r.blob();
        if (!b.size || b.size > 400000) throw 0;
        const u = URL.createObjectURL(b);
        favs.set(src, u);
        tabs.forEach(x => { if (!x.icon && x.url && host(x.url) === host(src)) x.icon = u; });
        if (!t.icon) t.icon = u;
        renderTabs();
      } catch (e) { favs.set(src, ''); }
      finally { favBusy--; }
    })();
  }

  // ---------- drawing ----------
  function paint(t) {
    if (t === active) show();
    renderTabs();
  }
  function show() {
    const t = active;
    if (!t) return;
    tabs.forEach(x => { if (x.frame) x.frame.hidden = x !== t || !x.url; });
    const ntp = !t.url;
    $('#ntp').hidden = !ntp;
    $('#view').classList.toggle('ntp-on', ntp);
    if (ntp) renderNtp();
    const err = t.err;
    $('#err').hidden = !err;
    if (err) {
      $('#err-icon').textContent = err.icon || (err.kind === 'support' ? '🚫' : '📡');
      $('#err-h').textContent = err.h || (err.kind === 'support' ? 'The proxy can\'t run here' : 'The proxy didn\'t start');
      $('#err-p').textContent = err.p || err.msg;
      $('#err-trace').textContent = err.msg || '';
      $('#err-retry').hidden = err.kind === 'support';
      $('#err-next').hidden = err.kind === 'support' || prefs.server !== 'auto' || (err.kind === 'proxy' && !server.ok);
      $('#err-settings').hidden = err.kind === 'support';
    }
    document.title = (ntp ? 'New tab' : t.title || host(t.url)) + ' · Browser';
    setAddr(); renderBar();
  }
  function setAddr() {
    const input = $('#addr');
    if (document.activeElement !== input) input.value = active.url;
  }
  function renderBar() {
    const t = active;
    $('#back').disabled = t.pos <= 0;
    $('#fwd').disabled = t.pos >= t.hist.length - 1;
    const r = $('#reload');
    r.textContent = t.loading ? '✕' : '⟳';
    r.title = t.loading ? 'Stop' : 'Reload (Alt+R)';
    r.setAttribute('aria-label', t.loading ? 'Stop' : 'Reload');
    r.disabled = !t.url;
    $('#progress').hidden = !t.loading;
    const lock = $('#lock');
    if (!t.url) { lock.textContent = '🔍'; lock.title = 'Search or type a web address'; }
    else if (/^https:/i.test(t.url)) { lock.textContent = '🔒'; lock.title = 'Secure page, through the proxy'; }
    else { lock.textContent = '⚠️'; lock.title = 'Not secure (http), through the proxy'; }
    const star = $('#star'), on = !!t.url && bookmarks.some(b => same(b.u, t.url));
    star.hidden = !t.url;
    star.textContent = on ? '★' : '☆';
    star.classList.toggle('on', on);
    star.title = on ? 'Remove bookmark' : 'Bookmark this page';
    $('#zoom').textContent = Math.round(t.zoom * 100) + '%';
  }
  function renderTabs() {
    const box = $('#tabs');
    box.innerHTML = tabs.map(t => {
      const fav = t.loading ? '<span class="spin"></span>' : !t.url && !t.pending ? '🌐'
        : t.icon ? `<img src="${esc(t.icon)}" alt="">` : `<span style="color:${color(host(t.url || t.pending))};font-weight:700">${esc(letter(t.url || t.pending))}</span>`;
      const name = !t.url && !t.pending ? 'New tab' : t.title || host(t.url || t.pending);
      return `<div class="tab${t === active ? ' on' : ''}" data-id="${t.id}" role="tab" aria-selected="${t === active}" tabindex="0" title="${esc(name)}">
        <span class="fav">${fav}</span><span class="tt">${esc(name)}</span><button class="x" aria-label="Close tab" title="Close tab (Alt+W)">✕</button></div>`;
    }).join('');
  }
  const linkRow = (x, rm) => `<div class="link" role="button" tabindex="0" data-open="${esc(x.u)}"><span class="lf" style="background:${color(host(x.u))}">${esc(letter(x.u))}</span>
    <span class="lt"><b>${esc(x.t || host(x.u))}</b><small>${esc(host(x.u))}</small></span>${rm ? `<button class="rm" data-rm="${rm}" data-u="${esc(x.u)}" aria-label="Remove">✕</button>` : ''}</div>`;
  function renderNtp() {
    $('#ntp-q').placeholder = 'Search ' + (ENGINES[prefs.engine] || ENGINES.ddg)[0] + ' or type a web address';
    $('#quick').innerHTML = quick.map((q, i) => `<button class="q" data-open="${esc(q.u)}" title="${esc(q.u)}">
      <span class="ic" ${q.e ? '' : `style="background:${color(host(q.u))};border-color:transparent"`}>${esc(q.e || letter(q.u))}</span><span>${esc(q.n)}</span>
      <span class="del" data-del="${i}" role="button" aria-label="Remove ${esc(q.n)}">✕</span></button>`).join('');
    $('#ntp-bm').innerHTML = bookmarks.slice(0, 6).map(b => linkRow(b, 'bm')).join('') || '<div class="empty">Tap ☆ in the address bar to save a page here.</div>';
    $('#ntp-hist').innerHTML = visits.slice(0, 6).map(h => linkRow(h, 'hist')).join('') || '<div class="empty">Pages you visit will show up here.</div>';
  }
  function focusSearch() {
    if (active && !active.url) { const q = $('#ntp-q'); if (innerWidth > 640) q.focus(); }
    else $('#addr').focus();
  }

  // ---------- history & bookmarks ----------
  function remember(url, title) {
    if (!url) return;
    visits = visits.filter(h => !same(h.u, url));
    visits.unshift({ u: url, t: title && title !== host(url) ? title : '', at: Date.now() });
    if (visits.length > 300) visits.length = 300;
    save('history', visits);
  }
  function toggleBookmark() {
    const t = active;
    if (!t.url) return;
    const i = bookmarks.findIndex(b => same(b.u, t.url));
    if (i >= 0) { bookmarks.splice(i, 1); toast('Bookmark removed'); }
    else { bookmarks.unshift({ u: t.url, t: t.title, at: Date.now() }); toast('⭐ Bookmarked'); }
    save('bookmarks', bookmarks); renderBar();
    if (!$('#sheet').hidden) openSheet(sheetTab);
  }

  // ---------- address bar suggestions ----------
  let sugg = [], suggOn = -1;
  function suggest() {
    const raw = $('#addr').value.trim(), q = raw.toLowerCase();
    const box = $('#sugg');
    if (!q || document.activeElement !== $('#addr')) { box.hidden = true; sugg = []; return; }
    const seen = new Set(), list = [];
    const eng = ENGINES[prefs.engine] || ENGINES.ddg, first = toUrl(raw);
    const isSearch = first === eng[1].replace('%s', encodeURIComponent(raw));
    list.push({ u: first, t: isSearch ? `Search ${eng[0]} for “${raw}”` : first, ic: isSearch ? '🔍' : '🌐' });
    for (const x of bookmarks.concat(visits)) {
      if (list.length >= 7) break;
      const key = x.u.replace(/\/$/, '');
      if (seen.has(key)) continue;
      if ((x.u + ' ' + (x.t || '')).toLowerCase().includes(q)) { seen.add(key); list.push({ u: x.u, t: x.t || host(x.u), ic: bookmarks.includes(x) ? '⭐' : '🕘' }); }
    }
    sugg = list; suggOn = -1;
    box.innerHTML = list.map((s, i) => `<button type="button" role="option" data-i="${i}"><span>${s.ic}</span><b>${esc(s.t)}</b>${s.ic !== '🔍' && s.ic !== '🌐' ? `<small>${esc(host(s.u))}</small>` : ''}</button>`).join('');
    box.hidden = list.length < 2 && list[0].ic !== '🔍';
  }
  function hideSugg() { $('#sugg').hidden = true; sugg = []; suggOn = -1; }

  // ---------- side sheet: bookmarks, history, settings ----------
  let sheetTab = 'bookmarks', histFilter = '';
  function openSheet(which) {
    sheetTab = which;
    closeMenus();
    $('#sheet').hidden = false; $('#scrim').hidden = false;
    document.querySelectorAll('[data-sheet]').forEach(b => b.classList.toggle('on', b.dataset.sheet === which));
    const body = $('#sheet-body');
    if (which === 'bookmarks') {
      body.innerHTML = `<h3>Bookmarks</h3>` + (bookmarks.length ? `<div class="links">${bookmarks.map(b => linkRow(b, 'bm')).join('')}</div>` : '<p>No bookmarks yet. Open a page and tap ☆ in the address bar.</p>');
    } else if (which === 'history') {
      body.innerHTML = `<input class="search" id="h-search" type="search" placeholder="Search your history" value="${esc(histFilter)}" aria-label="Search your history"><div id="h-list"></div>
        <div class="row" style="margin-top:14px"><button class="btn" id="h-clear">🗑️ Clear history</button></div>`;
      drawHistory();
    } else {
      const radio = (val, name, small, cls) => `<label class="opt${cls ? ' ' + cls : ''}"><input type="radio" name="srv" value="${esc(val)}" ${prefs.server === val ? 'checked' : ''}>
        <span class="ot"><b>${esc(name)}</b>${small ? `<small>${esc(small)}</small>` : ''}${val === 'custom' ? `<input type="url" id="custom" placeholder="wss://your-server.example/wisp/" value="${esc(prefs.custom)}" spellcheck="false">` : ''}</span><span class="pg" data-pg="${esc(val)}">${val === 'auto' || val === 'custom' ? '' : result(tested[val])}</span></label>`;
      body.innerHTML = `<h3>Proxy server</h3>
        <p>Pages go through a free Wisp proxy server run by other people. They come and go, so <b>Automatic</b> tests them, uses one that works, and moves on by itself if it stops working.</p>
        <div class="now" id="now"></div>
        <div class="row" style="margin-bottom:10px"><button class="btn" id="test">📶 Test all the servers</button></div>
        ${radio('auto', 'Automatic (best)', 'Tests the servers and uses one that can load pages')}
        ${SERVERS.map(s => radio(s.url, s.name, s.url, 'small')).join('')}
        ${radio('custom', 'My own server', 'Run your own with wisp-js or wisp-server-python')}
        <p style="margin-top:8px">If none of them work, your network (for example at school or work) may block proxy servers.</p>
        <h3>Search engine</h3>
        <select id="engine" aria-label="Search engine">${Object.entries(ENGINES).map(([k, v]) => `<option value="${k}" ${prefs.engine === k ? 'selected' : ''}>${esc(v[0])}</option>`).join('')}</select>
        <h3>When you come back</h3>
        <label class="opt"><input type="checkbox" id="restore" ${prefs.restore ? 'checked' : ''}><span class="ot"><b>Reopen my tabs</b><small>Open the tabs you had last time</small></span></label>
        <h3>Your data</h3>
        <p>History and bookmarks stay in this browser only.</p>
        <div class="row"><button class="btn" id="clear-sites">🍪 Clear cookies and site data</button><button class="btn" id="clear-all">🗑️ Clear history</button></div>
        <h3>Keyboard shortcuts</h3>
        <div class="keys"><kbd>Alt+T</kbd><span>New tab</span><kbd>Alt+W</kbd><span>Close tab</span><kbd>Alt+Shift+T</kbd><span>Reopen closed tab</span>
          <kbd>Alt+L</kbd><span>Go to the address bar</span><kbd>Alt+R</kbd><span>Reload</span><kbd>Alt+←</kbd><span>Back</span><kbd>Alt+→</kbd><span>Forward</span>
          <kbd>Alt+1…9</kbd><span>Switch tabs</span><kbd>Alt+H</kbd><span>History</span><kbd>Alt+D</kbd><span>Bookmark this page</span></div>
        <h3>How it works</h3>
        <p>🛡️ The Browser runs a proxy right in this page (<a href="https://github.com/titaniumnetwork-dev/Ultraviolet" target="_blank" rel="noopener">Ultraviolet</a>). It sends each page through an encrypted tunnel to a Wisp proxy server, which fetches it from the website. Websites see the proxy server, not you. Secure (https) pages are encrypted all the way, so the proxy server can't read them.</p>
        <p>⚠️ Some sites (especially ones you log in to, or video sites) may not work perfectly through a proxy. Never type passwords for important accounts into a proxy you don't trust.</p>`;
      drawNow();
    }
  }
  function result(r) {
    if (!r) return '';
    if (r.ok) return '✅ works' + (r.ms ? ` · ${r.ms} ms` : '');
    if (r.ok === null) return '🟢 answers';
    return r.error === 'no answer' ? '❌ no answer' : '⚠️ can\'t load pages';
  }
  function drawNow() {
    const el = $('#now');
    if (!el) return;
    el.innerHTML = server.url ? `Now using: <b>${esc(serverName(server.url))}</b> ${server.ok ? '🟢 working' : '🔴 not working'}` : 'Not connected yet.';
    document.querySelectorAll('[data-pg]').forEach(x => { const u = x.dataset.pg; if (u !== 'auto' && u !== 'custom' && tested[u]) x.textContent = result(tested[u]); });
  }
  function drawHistory() {
    const q = histFilter.toLowerCase();
    const list = visits.filter(h => !q || (h.u + ' ' + (h.t || '')).toLowerCase().includes(q));
    let html = '', day = '';
    const today = new Date().toDateString(), yest = new Date(Date.now() - 864e5).toDateString();
    for (const h of list.slice(0, 200)) {
      const d = new Date(h.at).toDateString();
      if (d !== day) { day = d; html += `<div class="day">${d === today ? 'Today' : d === yest ? 'Yesterday' : new Date(h.at).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</div>`; }
      html += linkRow(h, 'hist');
    }
    $('#h-list').innerHTML = html ? `<div class="links">${html}</div>` : `<p>${q ? 'Nothing matches that.' : 'No history yet.'}</p>`;
  }
  function closeSheet() { $('#sheet').hidden = true; $('#scrim').hidden = true; }
  async function clearSites() {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('__uv$')) localStorage.removeItem(k);
      for (const k of Object.keys(sessionStorage)) if (k.startsWith('__uv$')) sessionStorage.removeItem(k);
    } catch (e) {}
    try {
      indexedDB.deleteDatabase('__op');
      if (indexedDB.databases) for (const db of await indexedDB.databases()) if (db.name && /^https?:\/\/[^@]+@/.test(db.name)) indexedDB.deleteDatabase(db.name);
    } catch (e) {}
    toast('🍪 Cookies and site data cleared');
    tabs.forEach(t => { if (t.url && t.frame) go(t, t.url, true); });
  }

  // ---------- zoom ----------
  function applyZoom(t) {
    if (!t.frame) return;
    const z = t.zoom, s = t.frame.style;
    s.width = z === 1 ? '' : (100 / z) + '%';
    s.height = z === 1 ? '' : (100 / z) + '%';
    s.transform = z === 1 ? '' : `scale(${z})`;
  }
  function zoom(dir) {
    const steps = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
    const t = active, i = steps.indexOf(t.zoom);
    t.zoom = steps[Math.max(0, Math.min(steps.length - 1, (i < 0 ? 5 : i) + dir))];
    applyZoom(t); renderBar();
  }

  // ---------- menu ----------
  function closeMenus() { $('#menu').hidden = true; $('#menu-btn').setAttribute('aria-expanded', 'false'); hideSugg(); }
  function act(a) {
    const t = active;
    if (a !== 'zoom+' && a !== 'zoom-') closeMenus();
    if (a === 'newtab') newTab();
    else if (a === 'reopen') { const c = closed.pop(); if (c) newTab(c.url, { title: c.title }); else toast('No closed tabs to reopen'); }
    else if (a === 'fwd') fwd();
    else if (a === 'bookmarks' || a === 'history' || a === 'settings') openSheet(a);
    else if (a === 'zoom+') zoom(1);
    else if (a === 'zoom-') zoom(-1);
    else if (a === 'copy') {
      if (!t.url) return toast('Open a page first');
      (navigator.clipboard ? navigator.clipboard.writeText(t.url) : Promise.reject()).then(() => toast('🔗 Link copied'), () => prompt('Copy this link:', t.url));
    } else if (a === 'direct') {
      if (!t.url) return toast('Open a page first');
      window.open(t.url, '_blank', 'noopener');
    } else if (a === 'full') {
      if (document.fullscreenElement) document.exitFullscreen();
      else (document.documentElement.requestFullscreen ? document.documentElement.requestFullscreen() : Promise.reject()).catch(() => toast('Full screen isn\'t available here'));
    }
  }

  // ---------- keyboard ----------
  function onKey(e) {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key.toLowerCase(), code = e.code;
    let done = true;
    if (code === 'KeyT' && e.shiftKey) act('reopen');
    else if (code === 'KeyT') newTab();
    else if (code === 'KeyW') closeTab(active);
    else if (code === 'KeyL') { const a = $('#addr'); a.focus(); a.select(); }
    else if (code === 'KeyR') reload();
    else if (code === 'KeyH') openSheet('history');
    else if (code === 'KeyD') toggleBookmark();
    else if (k === 'arrowleft') back();
    else if (k === 'arrowright') fwd();
    else if (/^Digit[1-9]$/.test(code)) { const i = +code.slice(5); const t = i === 9 ? tabs[tabs.length - 1] : tabs[i - 1]; if (t) select(t); }
    else done = false;
    if (done) { e.preventDefault(); e.stopPropagation(); }
  }

  // ---------- wiring ----------
  function wire() {
    $('#newtab').onclick = () => newTab();
    $('#back').onclick = () => back();
    $('#fwd').onclick = () => fwd();
    $('#reload').onclick = () => reload();
    $('#star').onclick = toggleBookmark;
    $('#bm-btn').onclick = () => openSheet('bookmarks');
    $('#status').onclick = () => openSheet('settings');
    $('#menu-btn').onclick = e => {
      e.stopPropagation();
      const m = $('#menu'), open = m.hidden;
      closeMenus();
      m.hidden = !open; $('#menu-btn').setAttribute('aria-expanded', String(open));
      m.querySelector('.fwd-sm').hidden = innerWidth > 640;
    };
    $('#menu').addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b) act(b.dataset.act); });
    document.addEventListener('click', e => { if (!e.target.closest('#menu, #menu-btn')) $('#menu').hidden = true; if (!e.target.closest('.addr')) hideSugg(); });
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#sheet').hidden) closeSheet(); closeMenus(); } });

    // tabs
    const tabsEl = $('#tabs');
    tabsEl.addEventListener('click', e => {
      const el = e.target.closest('.tab'); if (!el) return;
      const t = tabs.find(x => x.id === +el.dataset.id); if (!t) return;
      if (e.target.closest('.x')) closeTab(t); else if (t !== active) select(t);
    });
    tabsEl.addEventListener('auxclick', e => { const el = e.target.closest('.tab'); if (el && e.button === 1) { e.preventDefault(); closeTab(tabs.find(x => x.id === +el.dataset.id)); } });
    tabsEl.addEventListener('keydown', e => { const el = e.target.closest('.tab'); if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(tabs.find(x => x.id === +el.dataset.id)); } });
    tabsEl.addEventListener('wheel', e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { tabsEl.scrollLeft += e.deltaY; } }, { passive: true });

    // address bar
    const addr = $('#addr');
    let fresh = false;   // select the whole address when the bar is clicked, like other browsers
    addr.addEventListener('focus', () => { addr.select(); fresh = true; });
    addr.addEventListener('mouseup', e => { if (fresh) { e.preventDefault(); fresh = false; } });
    addr.addEventListener('input', () => { fresh = false; suggest(); });
    addr.addEventListener('blur', () => setTimeout(() => { hideSugg(); setAddr(); }, 150));
    addr.addEventListener('keydown', e => {
      if (e.key === 'Escape') { addr.value = active.url; hideSugg(); addr.blur(); }
      else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && sugg.length) {
        e.preventDefault();
        const n = sugg.length;
        if (e.key === 'ArrowDown') suggOn = suggOn + 1 >= n ? -1 : suggOn + 1;
        else suggOn = suggOn - 1 < -1 ? n - 1 : suggOn - 1;
        document.querySelectorAll('#sugg button').forEach((b, i) => b.classList.toggle('on', i === suggOn));
      }
    });
    $('#addr-form').addEventListener('submit', e => {
      e.preventDefault();
      const pick = suggOn >= 0 && sugg[suggOn];
      const v = pick ? pick.u : addr.value;
      if (!v.trim()) return;
      hideSugg(); addr.blur();
      go(active, v);
    });
    $('#sugg').addEventListener('mousedown', e => e.preventDefault());
    $('#sugg').addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (!b) return; const s = sugg[+b.dataset.i]; hideSugg(); addr.blur(); if (s) go(active, s.u); });

    // new tab page
    $('#ntp-form').addEventListener('submit', e => { e.preventDefault(); const v = $('#ntp-q').value; if (v.trim()) { $('#ntp-q').value = ''; go(active, v); } });
    $('#ntp').addEventListener('click', e => {
      const del = e.target.closest('[data-del]');
      if (del) { e.stopPropagation(); quick.splice(+del.dataset.del, 1); save('quick', quick); renderNtp(); return; }
      if ($('#quick').classList.contains('edit') && e.target.closest('.q')) return;
      const rm = e.target.closest('[data-rm]');
      if (rm) { removeLink(rm.dataset.rm, rm.dataset.u); return; }
      const o = e.target.closest('[data-open]');
      if (o) go(active, o.dataset.open);
    });
    $('#ntp').addEventListener('keydown', e => { const o = e.target.closest('.link[data-open]'); if (o && e.key === 'Enter' && e.target === o) go(active, o.dataset.open); });
    $('#q-edit').onclick = () => { const q = $('#quick'); q.classList.toggle('edit'); $('#q-edit').textContent = q.classList.contains('edit') ? '✅ Done' : '✏️ Edit shortcuts'; };
    $('#q-add').onclick = () => { const f = $('#addq'); f.hidden = !f.hidden; if (!f.hidden) $('#addq-name').focus(); };
    $('#addq').addEventListener('submit', e => {
      e.preventDefault();
      const n = $('#addq-name').value.trim(), raw = $('#addq-url').value.trim();
      if (!raw) return $('#addq-url').focus();
      const u = toUrl(raw);
      quick.push({ e: '', n: n || host(u), u });
      save('quick', quick);
      $('#addq-name').value = ''; $('#addq-url').value = ''; $('#addq').hidden = true;
      renderNtp(); toast('Shortcut added');
    });

    // error screen
    $('#err-retry').onclick = () => retry();
    $('#err-settings').onclick = () => openSheet('settings');
    $('#err-next').onclick = () => nextServer(active);
    $('#err-direct').onclick = () => act('direct');

    // side sheet
    $('#scrim').onclick = closeSheet;
    $('#sheet-x').onclick = closeSheet;
    document.querySelectorAll('[data-sheet]').forEach(b => b.onclick = () => openSheet(b.dataset.sheet));
    const body = $('#sheet-body');
    body.addEventListener('click', async e => {
      const rm = e.target.closest('[data-rm]');
      if (rm) { e.stopPropagation(); removeLink(rm.dataset.rm, rm.dataset.u); openSheet(sheetTab); return; }
      const o = e.target.closest('[data-open]');
      if (o) { closeSheet(); if (active.url) newTab(o.dataset.open); else go(active, o.dataset.open); return; }
      const id = e.target.id;
      if (id === 'h-clear' || id === 'clear-all') {
        if (!confirm('Clear all your browsing history?')) return;
        visits = []; save('history', visits); toast('History cleared'); openSheet(sheetTab); renderNtp();
      } else if (id === 'clear-sites') {
        if (confirm('Clear cookies and saved data for all websites? You\'ll be logged out of sites you opened here.')) clearSites();
      } else if (id === 'test') {
        const b = e.target; b.disabled = true; b.textContent = '📶 Testing… (this takes a few seconds)';
        const urls = SERVERS.map(s => s.url).concat(prefs.custom && !SERVERS.some(s => s.url === prefs.custom) ? [prefs.custom] : []);
        const cell = u => document.querySelector(`[data-pg="${CSS.escape(SERVERS.some(s => s.url === u) ? u : 'custom')}"]`);
        urls.forEach(u => { const el = cell(u); if (el) el.textContent = '…'; });
        const one = async u => {
          const r = (await ping(u, 6000)) ? await deepCheck(u) : { ok: false, error: 'no answer' };
          tested[u] = r; if (r.ok) bad.delete(u);
          const el = cell(u); if (el) el.textContent = result(r);
        };
        for (let i = 0; i < urls.length; i += 3) await Promise.all(urls.slice(i, i + 3).map(one));
        const works = urls.filter(u => tested[u] && tested[u].ok).length;
        b.disabled = false; b.textContent = '📶 Test all the servers';
        toast(works ? `✅ ${works} of ${urls.length} servers work right now` : '😕 None of the servers are working right now');
        if (prefs.server === 'auto' && !server.ok && works) { await reconnect(true); drawNow(); }
      }
    });
    body.addEventListener('change', async e => {
      const el = e.target;
      if (el.name === 'srv') {
        prefs.server = el.value; save('prefs', prefs);
        if (el.value === 'custom' && !prefs.custom) { $('#custom').focus(); return; }
        await reconnect(); drawNow();
        toast(server.ok ? '✅ Connected' : '⚠️ That server didn\'t answer');
      } else if (el.id === 'custom') {
        let v = el.value.trim();
        if (v && !/^wss?:\/\//i.test(v)) v = 'wss://' + v.replace(/^https?:\/\//i, '');
        el.value = v; prefs.custom = v; prefs.server = 'custom'; save('prefs', prefs);
        const r = document.querySelector('input[name=srv][value=custom]'); if (r) r.checked = true;
        if (v) { await reconnect(); drawNow(); toast(server.ok ? '✅ Connected to your server' : '⚠️ Your server didn\'t answer'); }
      } else if (el.id === 'engine') { prefs.engine = el.value; save('prefs', prefs); renderNtp(); toast('Search engine: ' + ENGINES[el.value][0]); }
      else if (el.id === 'restore') { prefs.restore = el.checked; save('prefs', prefs); }
    });
    body.addEventListener('input', e => { if (e.target.id === 'h-search') { histFilter = e.target.value; drawHistory(); } });
    body.addEventListener('keydown', e => { const o = e.target.closest('.link[data-open]'); if (o && e.key === 'Enter' && e.target === o) { closeSheet(); newTab(o.dataset.open); } });

    // keep the address, title and icon up to date (pages can change them at any time)
    setInterval(() => { tabs.forEach(t => { if (t.frame && (t === active || t.loading || t.expect)) { sync(t); hook(t); } }); renderBar(); }, 400);
    addEventListener('pagehide', saveTabs);
  }
  function removeLink(kind, u) {
    if (kind === 'bm') { bookmarks = bookmarks.filter(b => b.u !== u); save('bookmarks', bookmarks); }
    else { visits = visits.filter(h => h.u !== u); save('history', visits); }
    renderNtp(); renderBar();
  }

  // ---------- start ----------
  function start() {
    wire();
    // ?url=… opens a page straight away (for links and the home screen)
    const params = new URLSearchParams(location.search);
    const go_ = params.get('go');   // sent here by the 404 page: a proxied address whose proxy wasn't running
    const ask = params.get('url') || params.get('q') || (go_ && realOf(PREFIX + go_)) || '';
    const saved = load('tabs', null);
    if (prefs.restore && saved && Array.isArray(saved.list) && saved.list.length) {
      saved.list.slice(0, 30).forEach(s => {
        const t = makeTab();
        if (s && typeof s.url === 'string' && /^https?:/i.test(s.url)) { t.pending = s.url; t.title = s.title || host(s.url); }
        tabs.push(t);
      });
      active = tabs[Math.min(saved.active | 0, tabs.length - 1)];
    }
    if (ask) { history.replaceState(null, '', location.pathname); newTab(ask); }
    else if (!tabs.length) newTab();
    else select(active);
    renderTabs();
    engine().catch(e => {
      if (e.kind === 'support') tabs.forEach(t => { if (t.url) { t.err = { kind: 'support', msg: e.message }; t.loading = false; } });
      show();
    });
    if (!active.url) setTimeout(focusSearch, 50);
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', start); else start();
})();
