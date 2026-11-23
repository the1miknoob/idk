// Browser: a web browser inside the site. Every page goes through a proxy:
//   this page → the proxy worker (sw.js, Ultraviolet) → an encrypted tunnel (epoxy) → a Wisp proxy server → the website.
// Tabs, bookmarks, history and settings are saved in this browser (localStorage).
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const BASE = location.pathname.replace(/[^/]*$/, '');   // this folder, e.g. /idk/browser/
  const CFG = self.__uv$config;
  const PREFIX = CFG.prefix;                               // pages through the proxy live here: /idk/browser/go/…
  const SJ_PREFIX = PREFIX + 'sj/';                        // …and Scramjet's pages here: /idk/browser/go/sj/…
  // Two proxy engines: Scramjet (newer, handles big modern sites like YouTube) and Ultraviolet (older)
  const CORES = { sj: 'Scramjet', uv: 'Ultraviolet' };

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
    ['YouTube', 'https://www.youtube.com/'],
    ['Wikipedia', 'https://www.wikipedia.org/'],
    ['GitHub', 'https://github.com/'],
    ['Khan Academy', 'https://www.khanacademy.org/'],
    ['Scratch', 'https://scratch.mit.edu/'],
    ['DuckDuckGo', 'https://duckduckgo.com/'],
  ];
  // ✏️ EDIT: accent colors and new tab backgrounds to choose from (Settings → Appearance)
  const ACCENTS = [['Blue', '#2563eb'], ['Indigo', '#4f46e5'], ['Violet', '#7c3aed'], ['Pink', '#db2777'], ['Red', '#dc2626'],
    ['Orange', '#ea580c'], ['Green', '#16a34a'], ['Teal', '#0d9488'], ['Graphite', '#475569']];
  const BGS = {   // [name, CSS background, is it dark?]
    none: ['Plain', '', false], paper: ['Paper', '#f3efe7', false], sage: ['Sage', '#dfe6da', false], sky: ['Sky', '#dbe6f2', false],
    dusk: ['Dusk', 'linear-gradient(160deg, #3b3f58, #6b5b7a 55%, #b0806f)', true], slate: ['Slate', '#1f2530', true],
    forest: ['Forest', 'linear-gradient(160deg, #1d3b2f, #3f6a4d)', true],
  };
  // Simple line icons (drawn on a 24×24 grid)
  const ICONS = {
    back: 'M19 12H5M11 18l-6-6 6-6', forward: 'M5 12h14M13 6l6 6-6 6', reload: 'M20 12a8 8 0 1 1-2.34-5.66L20 8.5M20 3.5v5h-5',
    x: 'M17 7 7 17M7 7l10 10', play: 'M8.5 5.8v12.4L18.5 12z', plus: 'M12 5v14M5 12h14', minus: 'M5 12h14',
    home: 'M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z',
    star: 'M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z',
    more: 'M12 5.5v.01M12 12v.01M12 18.5v.01', lock: 'M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9.5h-13z',
    warn: 'M12 4 3 19.5h18zM12 10v4.5M12 17v.01', search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.8-4.8',
    globe: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5s1.2-6.1 3.5-8.5z',
    bookmark: 'M6.5 4h11v16.5L12 16.8l-5.5 3.7z', history: 'M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5M3.5 4v4.5H8M12 7.5V12l3 2',
    settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
    brush: 'M14.5 4.5l5 5L11 18H6v-5zM12.5 6.5l5 5M6 18c0 1.7-1.3 2.5-3 2.5 0-1.7.8-3 2.5-3',
    zoom: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.8-4.8M10.5 8v5M8 10.5h5',
    link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
    external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5', full: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
    shield: 'M12 3.5 5 6.3v5.4c0 4.2 2.9 7.5 7 8.8 4.1-1.3 7-4.6 7-8.8V6.3z', undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
    trash: 'M4.5 7h15M10 11v6M14 11v6M6.5 7l.9 13h9.2l.9-13M9.5 7V4.5h5V7', check: 'M5 12.5 10 17l9-10',
    offline: 'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4.2-2.4M19 13a10 10 0 0 0-2.4-1.7M2 9.2a15 15 0 0 1 4.4-2.6M22 9.2A15 15 0 0 0 11 5.1M12 20v.01',
    alert: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 8v4.5M12 15.5v.01', clock: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 3',
    ban: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM6 6l12 12', image: 'M4 5h16v14H4zM9 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM20 15l-4.5-4.5L5 19',
  };
  const icon = (name, cls = '') => `<svg class="i${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name] || ICONS.globe}"/></svg>`;
  const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-pointer-lock allow-presentation';
  const COLORS = ['#5b5bd6', '#e0457b', '#0e9f9e', '#d97706', '#16a34a', '#3b82f6', '#c026d3', '#dc2626', '#64748b'];

  const LOOK = { theme: 'auto', accent: '#2563eb', tabs: 'classic', density: 'comfy', font: 'system', homeBtn: true, bmbar: 'ntp', bg: 'none', clock: true, shortcuts: true, lists: true };
  const prefs = Object.assign({ server: 'auto', custom: '', engine: 'ddg', restore: true, core: 'sj', yt: 'auto' }, LOOK, load('prefs', {}));
  if (!CORES[prefs.core]) prefs.core = 'sj';
  let bookmarks = load('bookmarks', []), visits = load('history', []);
  let quick = load('quick', null) || QUICK.map(([n, u]) => ({ n, u }));
  if (!Array.isArray(bookmarks)) bookmarks = [];
  if (!Array.isArray(visits)) visits = [];
  if (!Array.isArray(quick)) quick = QUICK.map(([n, u]) => ({ n, u }));

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } };
  const color = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
  const letter = u => (host(u)[0] || '?').toUpperCase();
  const same = (a, b) => (a || '').replace(/\/$/, '') === (b || '').replace(/\/$/, '');
  let toastTimer = 0;
  function toast(msg, ms = 2400) {
    const el = $('#toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  // ---------- the look (Settings → Appearance) ----------
  let fontLink = null;
  function applyLook() {
    const r = document.documentElement;
    let theme = prefs.theme;
    if (theme === 'auto') { let site = null; try { site = localStorage.getItem('theme'); } catch (e) {} theme = site || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
    r.dataset.theme = theme;
    r.style.setProperty('--accent', /^#[0-9a-f]{6}$/i.test(prefs.accent) ? prefs.accent : LOOK.accent);
    r.dataset.tabs = prefs.tabs; r.dataset.density = prefs.density; r.dataset.font = prefs.font;
    if (prefs.font === 'site' && !fontLink) {   // the site's own font, loaded only when it's picked
      fontLink = document.createElement('link'); fontLink.rel = 'stylesheet';
      fontLink.href = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600&display=swap';
      document.head.appendChild(fontLink);
    }
    $('#home').hidden = !prefs.homeBtn;
    // new tab page background
    const ntp = $('#ntp'), bg = prefs.bg === 'image' ? (load('bg-image', '') ? 'image' : 'none') : (BGS[prefs.bg] ? prefs.bg : 'none');
    ntp.style.background = bg === 'image' ? `linear-gradient(rgba(0,0,0,.25), rgba(0,0,0,.25)), url("${load('bg-image', '').replace(/"/g, '%22')}") center / cover` : (BGS[bg][1] || '');
    ntp.classList.toggle('has-bg', bg !== 'none');
    ntp.classList.toggle('dark-bg', bg === 'image' || !!BGS[bg][2]);
    if (active) { show(); renderBookmarksBar(); }
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener && matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => prefs.theme === 'auto' && applyLook());
  function setPref(k, v) { prefs[k] = v; save('prefs', prefs); applyLook(); }

  // ---------- site icons ----------
  // Each site's icon is fetched once through the proxy server and kept (small) in this browser, so it shows straight away
  // next time. They're fetched in a throwaway worker (check.js) so they never get in the way of the pages themselves.
  let icons = load('icons', {});
  if (!icons || typeof icons !== 'object') icons = {};
  const iconQueue = new Map(), iconTried = new Map();   // site → [address, from the page itself?] / what was tried
  let iconBusy = false;
  function siteIcon(url, size = 16) {
    const h = host(url), src = icons[h];
    if (src) return `<img src="${esc(src)}" alt="" width="${size}" height="${size}" loading="lazy">`;
    if (h && /^https?:/i.test(url)) { try { queueIcon(h, new URL(url).origin + '/favicon.ico'); } catch (e) {} }
    return `<span class="mono">${esc((h[0] || '?'))}</span>`;
  }
  function queueIcon(h, src, better) {
    if (icons[h]) return;
    if (better ? iconTried.get(h) === 'page' || (iconQueue.get(h) || [])[1] : iconTried.has(h) || iconQueue.has(h)) return;
    iconQueue.set(h, [src, !!better]);
    clearTimeout(queueIcon.t); queueIcon.t = setTimeout(runIcons, 300);
  }
  async function runIcons() {
    if (iconBusy || !server.ok || !iconQueue.size) return;
    iconBusy = true;
    const batch = [...iconQueue.entries()].slice(0, 12);
    batch.forEach(([h, [, fromPage]]) => { iconQueue.delete(h); iconTried.set(h, fromPage ? 'page' : 'site'); });
    let got = null, w = null;
    try {
      w = new Worker(BASE + 'check.js', { type: 'module' });
      got = await new Promise(res => {
        const timer = setTimeout(() => res(null), 25000);
        w.onmessage = e => { clearTimeout(timer); res(e.data); };
        w.onerror = e => { e.preventDefault && e.preventDefault(); clearTimeout(timer); res(null); };
        w.postMessage({ wisp: server.url, icons: batch.map(([, [src]]) => src) });
      });
    } catch (e) {}
    try { w && w.terminate(); } catch (e) {}
    if (got && Array.isArray(got.icons)) {
      got.icons.forEach((data, i) => { if (data) icons[batch[i][0]] = data; });
      const keys = Object.keys(icons); while (keys.length > 150) delete icons[keys.shift()];
      save('icons', icons);
      renderTabs(); renderBookmarksBar();
      if (active && !active.url) renderNtp();
    }
    iconBusy = false;
    if (iconQueue.size) setTimeout(runIcons, 500);
  }

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
  // A web address → its address through the proxy (Scramjet keeps the #part separate, like it does itself)
  function proxied(url, c = core()) {
    if (c === 'uv') return PREFIX + CFG.encodeUrl(url);
    const u = new URL(url), hash = u.hash.slice(1);
    u.hash = '';
    return SJ_PREFIX + encodeURIComponent(u.href) + (hash ? '#' + encodeURIComponent(hash) : '');
  }
  // A proxied address (…/go/xyz or …/go/sj/xyz) → the real web address, or null
  function realOf(href) {
    try {
      const u = new URL(href, location.href);
      if (u.origin !== location.origin || !u.pathname.startsWith(PREFIX)) return null;
      let r;
      if (u.pathname.startsWith(SJ_PREFIX)) {
        r = decodeURIComponent(u.pathname.slice(SJ_PREFIX.length)) + u.search;
        if (u.hash) r = r.replace(/#.*$/, '') + '#' + decodeURIComponent(u.hash.slice(1));
      } else {
        r = CFG.decodeUrl(u.pathname.slice(PREFIX.length) + u.search);
        if (u.hash) r = r.replace(/#.*$/, '') + u.hash;
      }
      return /^https?:/i.test(r) ? r : null;
    } catch (e) { return null; }
  }
  const coreOf = href => { try { return new URL(href, location.href).pathname.startsWith(SJ_PREFIX) ? 'sj' : 'uv'; } catch (e) { return prefs.core; } };

  // ---------- the proxy engine ----------
  let engineP = null, conn = null;
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
  function deepCheck(url, ms = 10000, target = CHECK_URL) {
    return new Promise(res => {
      let w = null, said = false;
      const done = r => { clearTimeout(timer); try { w && w.terminate(); } catch (e) {} res(r); };
      const timer = setTimeout(() => done({ ok: false, error: said ? 'timed out' : 'timed out (no answer)' }), ms);
      try { w = new Worker(BASE + 'check.js', { type: 'module' }); } catch (e) { return done({ ok: null, error: 'can\'t test here' }); }
      w.onmessage = e => { said = true; done(e.data || { ok: false }); };
      w.onerror = e => { e.preventDefault && e.preventDefault(); done({ ok: null, error: 'can\'t test here: ' + (e.message || 'worker error') }); };
      w.postMessage({ wisp: url, url: target });
    });
  }
  const tested = {};          // server → what its last test found
  const bad = new Set();      // servers that stopped working this visit (Automatic skips them)
  async function pickServer(force, avoid) {
    const list = serverList();
    if (!list.length) return { url: '', ok: false, why: 'none' };
    const auto = prefs.server === 'auto';
    // The server that worked last time goes first, and if it still answers it's used straight away
    const good = load('good', null);
    if (auto && !force && good && list.includes(good.u) && !bad.has(good.u) && await ping(good.u, 5000)) return { url: good.u, ok: true };
    const pool = list.filter(u => !auto || (!bad.has(u) && !(avoid && avoid.has(u))));
    if (!pool.length) return { url: '', ok: false, why: 'all tried' };
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
  const SW_VERSION = 2;   // must match VERSION in sw.js
  function swVersion(reg) {
    const w = reg.active;
    if (!w) return Promise.resolve(0);
    return new Promise(res => {
      const ch = new MessageChannel(), timer = setTimeout(() => res(0), 1500);
      ch.port1.onmessage = e => { clearTimeout(timer); res(+e.data || 0); };
      try { w.postMessage({ browser: 'version' }, [ch.port2]); } catch (e) { clearTimeout(timer); res(0); }
    });
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
  async function connect(force, avoid) {
    setStatus('wait', prefs.server === 'auto' ? 'Finding a proxy server that works…' : 'Connecting to the proxy server…');
    const pick = await pickServer(force, avoid);
    if (pick.why === 'all tried' && server.ok) { setStatus('ok', 'Proxy on · ' + serverName(server.url)); return false; }   // keep the one we have
    server.url = pick.url; server.ok = pick.ok; server.why = pick.why || '';
    if (pick.ok) await useServer(pick.url);   // never hand the tunnel a server that isn't working (it can break it)
    if (pick.ok) { setStatus('ok', 'Proxy on · ' + serverName(pick.url)); setTimeout(runIcons, 1500); }
    else setStatus('bad', pick.why === 'none' ? 'Pick a proxy server in Settings'
      : pick.why === 'no pages' ? 'The proxy servers answer but can\'t load pages · tap for help' : 'Can\'t reach any proxy server · tap for help');
    drawNow();
    return pick.ok;
  }
  // The encrypted tunnel (epoxy) runs in one background worker shared by every tab; this points it at a proxy server
  // (Swapping a tunnel that's already connected can upset it, so that only happens when the server really changes.)
  // (tunnel.js is epoxy with a fix: it only ever starts once, even when lots of things are asked for at the same moment)
  const EPOXY = BASE + 'tunnel.js';
  async function useServer(url) {
    conn = conn || new BareMux.BareMuxConnection(BASE + 'baremux/worker.js');
    let name = '';
    try { name = await conn.getTransport(); } catch (e) {}
    if (name === EPOXY && load('wisp', '') === url) return;
    await conn.setTransport(EPOXY, [{ wisp: url }]);
    save('wisp', url);
  }
  // Scramjet's settings are saved where the proxy worker can read them, before any page opens
  let sj = null, swReg = null;
  let sjBroken = '';
  async function startScramjet() {
    if (sj || typeof $scramjetLoadController !== 'function') return;
    const { ScramjetController } = $scramjetLoadController();
    const make = () => new ScramjetController({
      prefix: SJ_PREFIX,
      files: { wasm: BASE + 'scramjet/scramjet.wasm.wasm', all: BASE + 'scramjet/scramjet.all.js', sync: BASE + 'scramjet/scramjet.sync.js' },
    });
    try { const c = make(); await c.init(); sj = c; await seedSuffixList(); }
    catch (e) {
      // Its saved data is damaged: start it fresh (if that can't happen yet, use Ultraviolet for now)
      console.warn('Scramjet:', e);
      await new Promise(res => { const d = indexedDB.deleteDatabase('$scramjet'); d.onsuccess = d.onerror = res; setTimeout(res, 3000); });
      try { const c = make(); await c.init(); sj = c; await seedSuffixList(); } catch (e2) { sjBroken = String(e2 && e2.message || e2); console.warn('Scramjet still not working, using Ultraviolet:', e2); }
    }
  }
  // Scramjet needs the public suffix list (which part of an address is the "site") for every page that loads things from
  // other sites, and it downloads it through the proxy every hour; when that fails, those pages break. So it gets a copy from here.
  async function seedSuffixList() {
    try {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('$scramjet'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const store = 'publicSuffixList';
      if (!db.objectStoreNames.contains(store)) return db.close();
      const have = await new Promise(res => { const q = db.transaction(store).objectStore(store).get(store); q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
      if (!(have && have.from === 'browser' && have.expiry > Date.now() + 30 * 864e5)) {
        const data = await (await fetch(BASE + 'scramjet/psl.json')).json();
        await new Promise(res => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put({ data, expiry: Date.now() + 365 * 864e5, from: 'browser' }, store); tx.oncomplete = tx.onerror = res; });
      }
      db.close();
    } catch (e) { console.warn('Couldn\'t give Scramjet the suffix list:', e); }
  }
  const core = () => (prefs.core === 'sj' && !sj ? 'uv' : prefs.core);   // the engine actually in use
  function engine() {
    if (!engineP) {
      engineP = (async () => {
        const why = unsupported();
        if (why) throw Object.assign(new Error(why), { kind: 'support' });
        swReg = await navigator.serviceWorker.register(BASE + 'sw.js', { scope: PREFIX, updateViaCache: 'none' });
        await activated(swReg);
        // After an update, the old proxy worker can still be running for a moment: wait for the new one
        for (let i = 0; i < 30 && (await swVersion(swReg)) < SW_VERSION; i++) {
          if (i % 5 === 0) try { await swReg.update(); } catch (e) {}
          await new Promise(r => setTimeout(r, 400));
          await activated(swReg);
        }
        await startScramjet();
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
  async function reconnect(force, avoid) {   // after changing servers, or when pages fail
    try { const fresh = !engineP; await engine(); return fresh ? server.ok : await connect(force, avoid); } catch (e) { return false; }
  }
  // A page failed. If the server is the problem, Automatic moves on to the next working server and tries the page again.
  // When a page fails, Automatic works out whether it's the server or the website. Free servers often refuse big sites
  // (like YouTube) or cap how much you use them, so the page is tried through other servers in the background first.
  let switching = false;
  const refused = {};   // website → servers it didn't load through
  const firstOk = (list, test) => new Promise(res => {   // run the tests together; the first one that passes wins
    let left = list.length;
    if (!left) return res('');
    list.forEach(u => test(u).then(r => { tested[u] = tested[u] && !r.ok ? tested[u] : r; if (r.ok) res(u); else if (--left === 0) res(''); }));
  });
  async function failover(t) {
    if (prefs.server !== 'auto' || !server.url || !t.url || !t.err || switching) return;
    t.tries = t.tries || {};
    const url = t.url, site = host(url), n = t.tries[url] || 0, was = server.url;
    if (n >= 3) return;   // tried enough servers for this page
    switching = true;
    try {
      let to = '';
      if (t.err.kind === 'proxy' && !(await deepCheck(was)).ok) {   // the server itself stopped working
        bad.add(was);
        if ((load('good', null) || {}).u === was) save('good', null);
        await reconnect(true, refused[site]);
        if (server.ok && server.url !== was) to = server.url;
      }
      if (!to) {
        const skip = new Set([was, ...bad, ...(refused[site] || [])]);
        const others = SERVERS.map(x => x.url).filter(u => !skip.has(u))
          .sort((a, b) => (tested[b] && tested[b].ok ? 1 : 0) - (tested[a] && tested[a].ok ? 1 : 0)).slice(0, 4);
        if (others.length) {
          if (t.err && t.url === url) { t.err.p = 'Checking whether it opens through another proxy server…'; paint(t); }
          setStatus('wait', 'Trying ' + site + ' through other proxy servers…');
          to = await firstOk(others, u => deepCheck(u, 15000, url));
          if (to) {
            (refused[site] = refused[site] || new Set()).add(was);
            await useServer(to);
            server.url = to; server.ok = true;
            save('good', { u: to, at: Date.now() });
          }
          setStatus(server.ok ? 'ok' : 'bad', server.ok ? 'Proxy on · ' + serverName(server.url) : 'Can\'t reach any proxy server · tap for help');
          drawNow();
        }
      }
      if (to && t.err && t.url === url) {
        t.tries[url] = n + 1;
        toast(site + ' didn\'t load through ' + serverName(was) + '. Trying ' + serverName(to) + '…');
        go(t, url, true);
      } else if (t.err && t.url === url && t.err.kind !== 'proxy') {
        t.err.p = site + ' didn\'t load through any of the proxy servers. The site might be down, or the free servers might be blocking it (they often block big sites like YouTube, or limit how much you can use them). Try again later.';
        paint(t);
      }
    } finally { switching = false; }
  }
  async function nextServer(t) {   // the "Try another server" button
    if (prefs.server !== 'auto') { openSheet('settings'); return; }
    if (server.url) bad.add(server.url);
    t.err = null; t.loading = true; paint(t);
    const ok = await reconnect(true);
    if (!ok) bad.clear();   // nothing else works: let them all be tried again next time
    toast(ok ? 'Now using ' + serverName(server.url) : 'No other server is working right now');
    go(t, t.url, true);
  }
  // ---------- YouTube videos ----------
  // Videos play fine through the proxy, but YouTube's full page often refuses to play them for a proxy server (its
  // bot checks catch the free servers: "Sign in to confirm you're not a bot"). YouTube's simple player (the one other
  // websites embed) usually still works. So on a YouTube video the Browser watches the player, and if the video won't
  // play it switches to the simple player at the same moment. A bar under the toolbar offers the other fixes.
  const INVIDIOUS = ['inv.nadeko.net', 'yewtu.be', 'invidious.nerdvpn.de', 'invidious.f5.si', 'inv.tux.pizza'];   // ✏️ EDIT: Invidious sites to try
  const YT_STUCK_MS = 15000;   // a video that says it's playing but hasn't moved for this long counts as stuck
  const ytTime = s => { s = String(s || ''); if (/^\d+$/.test(s)) return +s; const m = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; };
  // A YouTube video address → { id, kind: 'page' | 'simple' | 'invidious', start } (or null for anything else)
  function ytVideo(url) {
    let u; try { u = new URL(url); } catch (e) { return null; }
    const h = u.hostname.replace(/^(www|m|music)\./, '');
    let id = null, kind = 'page';
    if (h === 'youtu.be') id = u.pathname.split('/')[1];
    else if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else { const m = u.pathname.match(/^\/(shorts|live|embed|v)\/([^/?#]+)/); if (m) { id = m[2]; if (m[1] === 'embed') kind = 'simple'; } }
    } else if (INVIDIOUS.includes(u.hostname) && u.pathname === '/watch') { id = u.searchParams.get('v'); kind = 'invidious'; }
    if (!id || !/^[\w-]{6,20}$/.test(id)) return null;
    return { id, kind, start: ytTime(u.searchParams.get('t') || u.searchParams.get('start')) };
  }
  // (they keep the scheme and port of the page they come from: always https on the real YouTube)
  const ytBase = (from, hostName) => { try { const u = new URL(from); return u.protocol + '//' + hostName + (u.port ? ':' + u.port : ''); } catch (e) { return 'https://' + hostName; } };
  const ytSimple = (id, start, from) => ytBase(from, 'www.youtube-nocookie.com') + '/embed/' + id + '?autoplay=1&playsinline=1&rel=0' + (start >= 1 ? '&start=' + Math.floor(start) : '');
  const ytPage = (id, start, from) => ytBase(from, 'www.youtube.com') + '/watch?v=' + id + (start >= 1 ? '&t=' + Math.floor(start) + 's' : '');
  // How the video in a tab is doing: { time, fail: '' | 'bot' | 'error' | 'stuck', text }
  function ytState(t) {
    let d;
    try { d = win(t).document; } catch (e) { return {}; }
    if (!d || !d.body) return {};
    const v = d.querySelector('video'), now = Date.now(), vid = t.vid;
    const time = v ? v.currentTime || 0 : 0;
    if (v && time > vid.last + 0.2) { vid.last = time; vid.lastAt = now; vid.played = true; }
    if (v && v.paused) vid.lastAt = now;   // paused on purpose (or waiting for a click): not stuck
    const shown = e => !!(e && (e.offsetWidth || e.offsetHeight) && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden');
    const err = [...d.querySelectorAll('.ytp-error, yt-playability-error-supported-renderers, ytd-enforcement-message-view-model, .ytp-error-content-wrap')].find(shown);
    const text = err ? (err.textContent || '').replace(/\s+/g, ' ').trim() : '';
    if (/not a bot|confirm (that )?you|sign in to confirm/i.test(text)) return { time, fail: 'bot', text };
    if (err && text) return { time, fail: 'error', text };
    if (v && v.error) return { time, fail: 'error', text: 'The video stopped with an error.' };
    if (v && !v.paused && now - vid.lastAt > YT_STUCK_MS && now - vid.at > YT_STUCK_MS) return { time, fail: 'stuck' };   // trying to play, not moving
    return { time };
  }
  function toSimple(t, why) {
    const vid = t.vid; if (!vid) return;
    const at = Math.max(vid.last || 0, vid.start || 0);
    t.vnote = { id: vid.id, why };
    go(t, ytSimple(vid.id, at > 3 ? at : 0, t.url));
  }
  // Every second and a half: check the video in the open tab, switch to the simple player if it won't play
  function ytCheck() {
    const t = active;
    const yt = t && t.url && !t.err ? ytVideo(t.url) : null;
    if (!yt) { if (t && t.vid) { t.vid = null; } renderVideoBar(); return; }
    if (!t.vid || t.vid.id !== yt.id || t.vid.kind !== yt.kind || t.vid.url !== t.url) {
      t.vid = { id: yt.id, kind: yt.kind, start: yt.start, url: t.url, at: Date.now(), last: 0, lastAt: Date.now(), played: false, fail: '' };
    }
    // (the page itself must be there: checked directly, because a tab can still look busy after an earlier page failed)
    let ready = false;
    try { const w = win(t), r = realOf(w.location.href); ready = !!r && same(r, t.url) && w.document.readyState !== 'loading'; } catch (e) {}
    if (ready) {
      if (yt.kind === 'page' && prefs.yt === 'simple' && t.vforce !== yt.id) { toSimple(t, 'pref'); return; }
      const st = ytState(t);
      if (st.fail && !t.vid.fail) {
        t.vid.fail = st.fail; t.vid.text = st.text || '';
        if (yt.kind === 'page' && prefs.yt !== 'page' && t.vforce !== yt.id) { toSimple(t, st.fail); return; }
      }
    }
    renderVideoBar();
  }
  function renderVideoBar() {
    const bar = $('#vbar'), t = active, vid = t && t.url && !t.err ? t.vid : null;
    if (!vid || t.vhide === vid.id) { bar.hidden = true; return; }
    const b = (act, label, primary) => `<button type="button" class="vb-b${primary ? ' primary' : ''}" data-v="${act}">${label}</button>`;
    const other = core() === 'sj' ? 'uv' : 'sj';
    const fixes = (prefs.server === 'auto' ? b('server', 'Another server') : '') + b('engine', 'Try ' + CORES[other]) + b('invidious', 'Invidious');
    let text, btns, warn = !!vid.fail;
    const why = vid.fail === 'bot' ? 'YouTube is asking this proxy server to prove it isn\'t a bot.' : vid.fail === 'stuck' ? 'The video isn\'t loading.' : vid.fail ? 'YouTube showed an error.' : '';
    if (vid.kind === 'page') {
      text = vid.fail ? why + ' Try:' : 'Video not playing?';
      btns = b('simple', 'Simple player', vid.fail) + fixes;
    } else if (vid.kind === 'simple') {
      const note = t.vnote && t.vnote.id === vid.id ? t.vnote.why : '';
      text = vid.fail ? 'It won\'t play in the simple player either. ' + why + ' Try:'
        : note === 'pref' ? 'Playing in YouTube\'s simple player (you can change this in Settings).'
          : note ? 'YouTube\'s full page wouldn\'t play this video through the proxy, so it\'s in the simple player.' : 'YouTube\'s simple player';
      btns = (vid.fail ? fixes : '') + b('page', 'Full YouTube page');
    } else {
      text = vid.fail ? 'This Invidious site isn\'t working. Try:' : 'Watching on Invidious, a different website for YouTube videos.';
      btns = b('invidious', 'Another Invidious site', vid.fail) + b('simple', 'Simple player') + b('page', 'YouTube page');
    }
    const html = `<span class="vb-ic">${icon(warn ? 'warn' : 'play')}</span><span class="vb-text">${esc(text)}</span><span class="vb-btns">${btns}</span>`;
    if (bar.dataset.html !== html) { bar.dataset.html = html; $('#vbar-body').innerHTML = html; }
    bar.classList.toggle('warn', warn);
    bar.hidden = false;
  }
  function videoAction(a) {
    const t = active, vid = t && t.vid;
    if (!vid) return;
    const at = Math.max(vid.last || 0, vid.start || 0);
    if (a === 'simple') { t.vforce = null; toSimple(t, 'button'); }
    else if (a === 'page') { t.vforce = vid.id; t.vnote = null; go(t, ytPage(vid.id, at > 3 ? at : 0, t.url)); }
    else if (a === 'server') nextServer(t);
    else if (a === 'engine') useCore(core() === 'sj' ? 'uv' : 'sj');
    else if (a === 'invidious') {
      t.inv = ((t.inv == null ? -1 : t.inv) + 1) % INVIDIOUS.length;
      go(t, 'https://' + INVIDIOUS[t.inv] + '/watch?v=' + vid.id + '&local=true' + (at > 3 ? '&t=' + Math.floor(at) : ''));
      toast('Opening the video on ' + INVIDIOUS[t.inv] + '…');
    } else if (a === 'hide') { t.vhide = vid.id; renderVideoBar(); }
  }

  function setStatus(kind, text) {
    $('#status-dot').className = 'dot' + (kind === 'ok' ? ' ok' : kind === 'bad' ? ' bad' : '');
    $('#status-text').textContent = text;
    $('#shield').dataset.state = kind;
    $('#shield').title = text;
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
    if (sj) try { sj.createFrame(f); } catch (e) {}   // lets Scramjet treat this frame as the page's own window
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
    if (!url) {
      // back to the new tab page: forget the page that was still loading, or it would take this place when it arrives
      t.url = ''; t.err = null; t.loading = false; t.expect = null; t.from = null; t.title = 'New tab';
      try { win(t).stop(); } catch (e) {}
      paint(t); saveTabs(); return;
    }
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
      kind: 'proxy', icon: 'offline',
      h: none ? 'Pick a proxy server' : pages ? 'The proxy servers aren\'t working right now' : 'Can\'t reach any proxy server',
      p: none ? 'Choose a server in Settings, or switch back to Automatic.'
        : (pages ? 'The free proxy servers answered, but none of them could load a test page (they may be overloaded).' : 'None of the free proxy servers answered.')
          + ' If you\'re on a school or work network, it may block proxy servers. You can try again later, or use your own server (Settings).',
      msg: Object.keys(tested).length ? Object.entries(tested).map(([u, r]) => `${u}: ${r.ok ? 'works' : r.error || 'failed'}`).join('\n') : 'No servers tested.',
    };
  }
  function classify(msg) {
    const m = String(msg);
    let kind = 'site', h = 'This page couldn\'t be opened', p = 'The proxy couldn\'t load this page. Some websites block proxies or don\'t work well through one.', icon = 'alert';
    if (/BlockedAddress|Throttled/i.test(m)) {
      kind = 'blocked'; icon = 'ban'; h = 'This proxy server won\'t open this site';
      p = 'Some free proxy servers block big sites (like YouTube) or limit how much you can use them.';
    } else if (/ServerStreamUnreachable|ServerStreamConnectionRefused|ServerStreamInvalidInfo/i.test(m)) {
      icon = 'search'; h = 'This site can\'t be reached'; p = 'The proxy server couldn\'t connect to this website. Check the address for typos, or try again later.';
    } else if (/ServerStreamConnectionTimedOut|ServerStreamTimedOut/i.test(m)) {
      icon = 'clock'; h = 'The page took too long'; p = 'The website didn\'t answer the proxy server in time. Try again in a moment.';
    } else if (/websocket|wisp|ws:\/\/|wss:\/\/|bare-mux|no bare clients|MessagePort|transport/i.test(m) || (/failed to fetch|network/i.test(m) && !/dns|resolve/i.test(m))) {
      kind = 'proxy'; icon = 'offline'; h = 'The proxy server stopped answering';
      p = 'The free proxy server this page went through isn\'t working right now. Try another server, or try again in a moment.';
    } else if (/dns|resolve|getaddrinfo|ENOTFOUND|not found|NXDOMAIN|invalid url|hostname/i.test(m)) {
      icon = 'search'; h = 'That website couldn\'t be found'; p = 'Check the address for typos, or search for it instead.';
    } else if (/IncompleteMessage|closed before message completed|connection refused|unreachable/i.test(m)) {
      icon = 'search'; h = 'This site can\'t be reached'; p = 'The website didn\'t answer through the proxy. Check the address for typos, or try again later.';
    } else if (/timed? ?out|timeout/i.test(m)) {
      icon = 'clock'; h = 'The page took too long'; p = 'The website or the proxy server is slow right now. Try again in a moment.';
    } else if (/certificate|tls|ssl|handshake/i.test(m)) {
      icon = 'lock'; h = 'A secure connection couldn\'t be made'; p = 'The website\'s security check failed through the proxy.';
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

  // A page's own icon (from its <link rel="icon">) is used for its site when there's none yet
  function favicon(t, doc) {
    if (t.icon || !t.url) return;
    const h = host(t.url);
    if (icons[h] || iconTried.get(h) === 'page') return;
    let href = '';
    try { const l = doc.querySelector('link[rel~="icon" i], link[rel="shortcut icon" i], link[rel~="apple-touch-icon" i]'); if (l) href = l.href; } catch (e) {}
    if (!href) return;
    let src;
    try { src = href.startsWith('data:image/') ? href : (realOf(href) || new URL(href, t.url).href); } catch (e) { return; }
    if (src.startsWith('data:')) { if (src.length < 80000) { icons[h] = src; save('icons', icons); renderTabs(); } return; }
    queueIcon(h, src, true);
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
      $('#err-icon').innerHTML = icon(err.icon || (err.kind === 'support' ? 'ban' : 'offline'));
      $('#err-h').textContent = err.h || (err.kind === 'support' ? 'The proxy can\'t run here' : 'The proxy didn\'t start');
      $('#err-p').textContent = err.p || err.msg;
      $('#err-trace').textContent = err.msg || '';
      $('#err-retry').hidden = err.kind === 'support';
      $('#err-next').hidden = err.kind === 'support' || prefs.server !== 'auto' || (err.kind === 'proxy' && !server.ok);
      const other = prefs.core === 'sj' ? 'uv' : 'sj';
      $('#err-core').hidden = err.kind === 'support' || err.kind === 'proxy' || err.kind === 'blocked' || !t.url;
      $('#err-core').textContent = 'Try with ' + CORES[other];
      $('#err-settings').hidden = err.kind === 'support';
    }
    document.title = ntp ? 'New tab' : t.title || host(t.url);
    setAddr(); renderBar(); renderBookmarksBar(); renderVideoBar();
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
    if (r.dataset.state !== String(t.loading)) { r.innerHTML = icon(t.loading ? 'x' : 'reload'); r.dataset.state = String(t.loading); }
    r.title = t.loading ? 'Stop' : 'Reload (Alt+R)';
    r.setAttribute('aria-label', t.loading ? 'Stop' : 'Reload');
    r.disabled = !t.url;
    $('#progress').hidden = !t.loading;
    const lock = $('#lock'), state = !t.url ? 'search' : /^https:/i.test(t.url) ? 'secure' : 'insecure';
    if (lock.dataset.state !== state) {
      lock.dataset.state = state;
      lock.innerHTML = icon(state === 'search' ? 'search' : state === 'secure' ? 'lock' : 'warn');
      lock.title = state === 'search' ? 'Search or type a web address' : state === 'secure' ? 'Secure connection, through the proxy' : 'Not secure (http), through the proxy';
    }
    const star = $('#star'), on = !!t.url && bookmarks.some(b => same(b.u, t.url));
    star.hidden = !t.url;
    star.classList.toggle('on', on);
    star.title = on ? 'Remove bookmark' : 'Bookmark this page';
    $('#zoom').textContent = Math.round(t.zoom * 100) + '%';
  }
  function renderTabs() {
    const box = $('#tabs');
    box.innerHTML = tabs.map(t => {
      const fav = t.loading ? '<span class="spin"></span>' : !t.url && !t.pending ? icon('globe')
        : t.icon ? `<img src="${esc(t.icon)}" alt="">` : siteIcon(t.url || t.pending);
      const name = !t.url && !t.pending ? 'New tab' : t.title || host(t.url || t.pending);
      return `<div class="tab${t === active ? ' on' : ''}" data-id="${t.id}" role="tab" aria-selected="${t === active}" tabindex="0" title="${esc(name)}">
        <span class="fav">${fav}</span><span class="tt">${esc(name)}</span><button class="x" aria-label="Close tab" title="Close tab (Alt+W)">${icon('x')}</button></div>`;
    }).join('');
  }
  const linkRow = (x, rm) => `<div class="link" role="button" tabindex="0" data-open="${esc(x.u)}">${siteIcon(x.u, 18)}
    <span class="lt"><b>${esc(x.t || host(x.u))}</b><small>${esc(host(x.u))}</small></span>${rm ? `<button class="rm" data-rm="${rm}" data-u="${esc(x.u)}" aria-label="Remove" title="Remove">${icon('x')}</button>` : ''}</div>`;
  function renderNtp() {
    $('#ntp-q').placeholder = 'Search with ' + (ENGINES[prefs.engine] || ENGINES.ddg)[0] + ' or type a web address';
    $('#clockbox').hidden = !prefs.clock;
    if (prefs.clock) tick();
    $('#quickbox').hidden = !prefs.shortcuts;
    $('#quick').innerHTML = quick.map((q, i) => `<button class="q" data-open="${esc(q.u)}" title="${esc(q.n)} · ${esc(host(q.u))}">
      <span class="ic">${siteIcon(q.u, 24)}</span><span class="n">${esc(q.n)}</span>
      <span class="del" data-del="${i}" role="button" aria-label="Remove ${esc(q.n)}">${icon('x')}</span></button>`).join('')
      + (quick.length < 12 ? `<button class="q" id="q-add" title="Add a shortcut"><span class="ic add">${icon('plus')}</span><span class="n">Add shortcut</span></button>` : '');
    $('#cols').hidden = !prefs.lists;
    $('#ntp-bm').innerHTML = bookmarks.slice(0, 5).map(b => linkRow(b, 'bm')).join('') || '<div class="empty">Pages you bookmark show up here.</div>';
    $('#ntp-hist').innerHTML = visits.slice(0, 5).map(h => linkRow(h, 'hist')).join('') || '<div class="empty">Nothing yet.</div>';
  }
  function tick() {
    const d = new Date();
    $('#clock').textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    $('#date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  }
  function renderBookmarksBar() {
    const bar = $('#bmbar'), ntp = active && !active.url;
    const on = prefs.bmbar === 'always' || (prefs.bmbar === 'ntp' && ntp);
    bar.hidden = !on;
    if (!on) return;
    bar.innerHTML = (bookmarks.length ? bookmarks.slice(0, 30).map(b => `<button data-open="${esc(b.u)}" title="${esc(b.t || b.u)}">${siteIcon(b.u)}<span>${esc(b.t || host(b.u))}</span></button>`).join('')
      : '<span class="empty">Bookmark pages with the star in the address bar and they show up here.</span>') + `<button class="all" data-all title="All bookmarks">All bookmarks</button>`;
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
    else { bookmarks.unshift({ u: t.url, t: t.title, at: Date.now() }); toast('Bookmarked'); }
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
    list.push({ u: first, t: isSearch ? `${raw} – Search with ${eng[0]}` : first, ic: isSearch ? 'search' : 'globe' });
    for (const x of bookmarks.concat(visits)) {
      if (list.length >= 7) break;
      const key = x.u.replace(/\/$/, '');
      if (seen.has(key)) continue;
      if ((x.u + ' ' + (x.t || '')).toLowerCase().includes(q)) { seen.add(key); list.push({ u: x.u, t: x.t || host(x.u), ic: bookmarks.includes(x) ? 'star' : 'history' }); }
    }
    sugg = list; suggOn = -1;
    box.innerHTML = list.map((s, i) => `<button type="button" role="option" data-i="${i}">${icon(s.ic)}<b>${esc(s.t)}</b>${s.ic !== 'search' && s.ic !== 'globe' ? `<small>${esc(host(s.u))}</small>` : ''}</button>`).join('');
    box.hidden = list.length < 2 && list[0].ic !== 'search';
  }
  function hideSugg() { $('#sugg').hidden = true; sugg = []; suggOn = -1; }

  // ---------- side sheet: bookmarks, history, settings ----------
  let sheetTab = 'bookmarks', histFilter = '';
  function openSheet(which, focus) {
    sheetTab = which;
    closeMenus();
    $('#sheet').hidden = false; $('#scrim').hidden = false;
    document.querySelectorAll('[data-sheet]').forEach(b => b.classList.toggle('on', b.dataset.sheet === which));
    const body = $('#sheet-body');
    if (which === 'bookmarks') {
      body.innerHTML = bookmarks.length ? `<div class="links" style="margin-top:10px">${bookmarks.map(b => linkRow(b, 'bm')).join('')}</div>` : '<p style="margin-top:16px">No bookmarks yet. Open a page and click the star in the address bar.</p>';
    } else if (which === 'history') {
      body.innerHTML = `<input class="search" id="h-search" type="search" placeholder="Search history" value="${esc(histFilter)}" aria-label="Search history"><div id="h-list"></div>
        <div class="row" style="margin-top:16px"><button class="btn" id="h-clear">Clear history</button></div>`;
      drawHistory();
    } else {
      const seg = (key, opts) => `<div class="seg" data-pref="${key}">${opts.map(([v, n]) => `<button type="button" data-v="${v}" class="${prefs[key] === v ? 'on' : ''}">${n}</button>`).join('')}</div>`;
      const sw = (key, label, small) => `<div class="set"><label for="sw-${key}">${label}${small ? `<small>${small}</small>` : ''}</label><span class="sw"><input type="checkbox" id="sw-${key}" data-pref="${key}" ${prefs[key] ? 'checked' : ''}><span></span></span></div>`;
      const radio = (val, name, small) => `<label class="srv"><input type="radio" name="srv" value="${esc(val)}" ${prefs.server === val ? 'checked' : ''}>
        <span class="ot"><b>${esc(name)}</b>${small ? `<small>${esc(small)}</small>` : ''}${val === 'custom' ? `<input type="url" class="field" id="custom" placeholder="wss://your-server.example/wisp/" value="${esc(prefs.custom)}" spellcheck="false">` : ''}</span><span class="pg" data-pg="${esc(val)}"></span></label>`;
      const custom = !ACCENTS.some(a => a[1].toLowerCase() === String(prefs.accent).toLowerCase());
      body.innerHTML = `
        <h3 id="look">Appearance</h3>
        <div class="group">
          <div class="set"><span class="lab">Theme</span>${seg('theme', [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']])}</div>
          <div class="set" style="display:block"><span class="lab">Accent color</span>
            <div class="swatches">${ACCENTS.map(([n, c]) => `<button type="button" class="swatch${!custom && prefs.accent.toLowerCase() === c ? ' on' : ''}" data-accent="${c}" style="--c:${c}" title="${n}" aria-label="${n}"></button>`).join('')}
              <label class="swatch custom${custom ? ' on' : ''}" style="--c:${esc(prefs.accent)}" title="Pick any color"><input type="color" id="accent-pick" value="${esc(prefs.accent)}" aria-label="Pick any color"></label></div></div>
          <div class="set"><span class="lab">Tabs</span>${seg('tabs', [['classic', 'Classic'], ['pills', 'Rounded']])}</div>
          <div class="set"><span class="lab">Density</span>${seg('density', [['comfy', 'Comfortable'], ['compact', 'Compact']])}</div>
          <div class="set"><label for="font-pick" class="lab">Font</label><select id="font-pick" style="width:auto;flex:none">${[['system', 'System'], ['site', 'Space Grotesk'], ['serif', 'Serif'], ['mono', 'Monospace']].map(([v, n]) => `<option value="${v}" ${prefs.font === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
          <div class="set"><span class="lab">Bookmarks bar</span>${seg('bmbar', [['always', 'Always'], ['ntp', 'New tab'], ['never', 'Never']])}</div>
          ${sw('homeBtn', 'Home button', 'Back to the main site, next to the tabs')}
        </div>
        <h3>New tab page</h3>
        <div class="group">
          <div class="set" style="display:block"><span class="lab">Background</span>
            <div class="bgs">${Object.entries(BGS).map(([k, [n, css, dark]]) => `<button type="button" class="bgopt ${dark ? 'darkb' : 'light'}${prefs.bg === k ? ' on' : ''}" data-bg="${k}" style="--b:${css || 'var(--page)'}"><span>${n}</span></button>`).join('')}
              <button type="button" class="bgopt darkb${prefs.bg === 'image' ? ' on' : ''}" data-bg="image" style="--b:${load('bg-image', '') ? `url(&quot;${esc(load('bg-image', ''))}&quot;)` : 'var(--field)'}"><span${load('bg-image', '') ? '' : ' style="color:var(--muted)"'}>Picture</span></button></div>
            <div class="row" style="padding-bottom:10px"><button class="btn" id="bg-upload" type="button">${icon('image')}Choose a picture</button><input type="file" id="bg-file" accept="image/*" hidden>
              <input class="field" id="bg-url" type="url" placeholder="…or paste a picture's web address" style="flex:1;min-width:160px;width:auto"></div></div>
          ${sw('clock', 'Clock and date')}
          ${sw('shortcuts', 'Shortcuts')}
          ${sw('lists', 'Bookmarks and recent pages')}
        </div>
        <div class="row" style="margin-top:10px"><button class="linkbtn" id="look-reset" type="button">Reset appearance</button></div>

        <h3>Search</h3>
        <div class="group"><div class="set"><label for="engine" class="lab">Search engine</label><select id="engine" style="width:auto;flex:none">${Object.entries(ENGINES).map(([k, v]) => `<option value="${k}" ${prefs.engine === k ? 'selected' : ''}>${esc(v[0])}</option>`).join('')}</select></div></div>

        <h3>Proxy</h3>
        <p>Pages go through free Wisp proxy servers run by other people. Automatic tests them, uses one that works and switches by itself when one stops working.</p>
        <div class="now" id="now"></div>
        <div class="group">
          ${radio('auto', 'Automatic', 'Recommended')}
          ${SERVERS.map(x => radio(x.url, x.name, x.url)).join('')}
          ${radio('custom', 'Your own server', '')}
        </div>
        <div class="row" style="margin-top:10px"><button class="btn" id="test" type="button">Test servers</button></div>
        <div class="group" style="margin-top:12px"><div class="set"><label for="core" class="lab">Engine<small>Scramjet handles big sites like YouTube best</small></label>
          <select id="core" style="width:auto;flex:none"><option value="sj" ${prefs.core === 'sj' ? 'selected' : ''}>Scramjet</option><option value="uv" ${prefs.core === 'uv' ? 'selected' : ''}>Ultraviolet</option></select></div></div>
        <div class="group" style="margin-top:12px"><div class="set"><label for="yt" class="lab">YouTube videos<small>The simple player works through more proxy servers</small></label>
          <select id="yt" style="width:auto;flex:none">${[['auto', 'Automatic'], ['simple', 'Simple player'], ['page', 'Full YouTube page']].map(([v, n]) => `<option value="${v}" ${prefs.yt === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
        <p style="margin-top:10px">If nothing works, your network (at school or work, for example) may block proxy servers.</p>

        <h3>Privacy</h3>
        <div class="group">
          <div class="set"><label for="restore">Reopen tabs from last time</label><span class="sw"><input type="checkbox" id="restore" ${prefs.restore ? 'checked' : ''}><span></span></span></div>
        </div>
        <div class="row" style="margin-top:10px"><button class="btn" id="clear-sites" type="button">Clear cookies and site data</button><button class="btn" id="clear-all" type="button">Clear history</button></div>

        <h3>Keyboard shortcuts</h3>
        <div class="keys"><kbd>Alt+T</kbd><span>New tab</span><kbd>Alt+W</kbd><span>Close tab</span><kbd>Alt+Shift+T</kbd><span>Reopen closed tab</span>
          <kbd>Alt+L</kbd><span>Address bar</span><kbd>Alt+R</kbd><span>Reload</span><kbd>Alt+←</kbd><span>Back</span><kbd>Alt+→</kbd><span>Forward</span>
          <kbd>Alt+1–9</kbd><span>Switch tabs</span><kbd>Alt+H</kbd><span>History</span><kbd>Alt+D</kbd><span>Bookmark page</span></div>

        <h3>About</h3>
        <p>Every page is loaded through a proxy that runs in this tab (<a href="https://github.com/MercuryWorkshop/scramjet" target="_blank" rel="noopener">Scramjet</a> or <a href="https://github.com/titaniumnetwork-dev/Ultraviolet" target="_blank" rel="noopener">Ultraviolet</a>) and an encrypted tunnel to the proxy server. Websites see the proxy server instead of you, and https pages stay encrypted end to end. Some sites, especially ones you sign in to, may not work perfectly. Don't enter passwords for important accounts through a proxy you don't trust.</p>`;
      drawNow();
      if (focus === 'look') setTimeout(() => $('#look').scrollIntoView({ block: 'start' }), 0);
    }
  }
  function result(r) {   // [text, kind] for a server test result
    if (!r) return ['', ''];
    if (r.ok) return ['Works' + (r.ms ? ` · ${r.ms} ms` : ''), 'ok'];
    if (r.ok === null) return ['Answers', 'ok'];
    return r.error === 'no answer' ? ['No answer', 'bad'] : ['Can\'t load pages', 'warn'];
  }
  function showResult(el, r) { const [text, kind] = result(r); el.textContent = text; el.dataset.r = kind; }
  function drawNow() {
    const el = $('#now');
    if (!el) return;
    el.innerHTML = server.url ? `<span class="dot ${server.ok ? 'ok' : 'bad'}"></span><span>${server.ok ? 'Connected to' : 'Not working:'} <b>${esc(serverName(server.url))}</b></span>` : '<span class="dot"></span><span>Not connected yet</span>';
    document.querySelectorAll('[data-pg]').forEach(x => { const u = x.dataset.pg; if (u !== 'auto' && u !== 'custom' && tested[u]) showResult(x, tested[u]); });
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
    const site = k => k.startsWith('__uv$') || /^(localhost|[a-z0-9-]+(\.[a-z0-9-]+)+)(:\d+)?@/i.test(k);   // websites' saved data (both engines)
    try {
      for (const k of Object.keys(localStorage)) if (site(k)) localStorage.removeItem(k);
      for (const k of Object.keys(sessionStorage)) if (site(k)) sessionStorage.removeItem(k);
    } catch (e) {}
    try { if (swReg && swReg.active) swReg.active.postMessage({ browser: 'clear-cookies' }); } catch (e) {}
    try {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('$scramjet'); r.onsuccess = () => res(r.result); r.onerror = rej; });
      if (db.objectStoreNames.contains('cookies')) await new Promise(res => { const tx = db.transaction('cookies', 'readwrite'); tx.objectStore('cookies').clear(); tx.oncomplete = tx.onerror = res; });
      db.close();
    } catch (e) {}
    try {
      indexedDB.deleteDatabase('__op');
      if (indexedDB.databases) for (const db of await indexedDB.databases()) if (db.name && /^https?:\/\/[^@]+@/.test(db.name)) indexedDB.deleteDatabase(db.name);
    } catch (e) {}
    toast('Cookies and site data cleared');
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
    else if (a === 'customize') openSheet('settings', 'look');
    else if (a === 'zoom+') zoom(1);
    else if (a === 'zoom-') zoom(-1);
    else if (a === 'copy') {
      if (!t.url) return toast('Open a page first');
      (navigator.clipboard ? navigator.clipboard.writeText(t.url) : Promise.reject()).then(() => toast('Link copied'), () => prompt('Copy this link:', t.url));
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
    $('#shield').onclick = () => openSheet('settings');
    $('#customize').onclick = () => openSheet('settings', 'look');
    $('#bmbar').addEventListener('click', e => {
      if (e.target.closest('[data-all]')) return openSheet('bookmarks');
      const o = e.target.closest('[data-open]'); if (o) go(active, o.dataset.open);
    });
    setInterval(() => { if (prefs.clock && active && !active.url) tick(); }, 10000);
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
      if (e.target.closest('#q-add')) { const f = $('#addq'); f.hidden = !f.hidden; if (!f.hidden) $('#addq-name').focus(); return; }
      if ($('#quick').classList.contains('edit') && e.target.closest('.q')) return;
      const rm = e.target.closest('[data-rm]');
      if (rm) { removeLink(rm.dataset.rm, rm.dataset.u); return; }
      const o = e.target.closest('[data-open]');
      if (o) go(active, o.dataset.open);
    });
    $('#ntp').addEventListener('keydown', e => { const o = e.target.closest('.link[data-open]'); if (o && e.key === 'Enter' && e.target === o) go(active, o.dataset.open); });
    $('#q-edit').onclick = () => { const q = $('#quick'); q.classList.toggle('edit'); $('#q-edit').textContent = q.classList.contains('edit') ? 'Done' : 'Edit shortcuts'; };
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
    $('#err-core').onclick = () => useCore(prefs.core === 'sj' ? 'uv' : 'sj');
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
        const b = e.target; b.disabled = true; b.textContent = 'Testing…';
        const urls = SERVERS.map(s => s.url).concat(prefs.custom && !SERVERS.some(s => s.url === prefs.custom) ? [prefs.custom] : []);
        const cell = u => document.querySelector(`[data-pg="${CSS.escape(SERVERS.some(s => s.url === u) ? u : 'custom')}"]`);
        urls.forEach(u => { const el = cell(u); if (el) { el.textContent = '…'; el.dataset.r = ''; } });
        const one = async u => {
          const r = (await ping(u, 6000)) ? await deepCheck(u) : { ok: false, error: 'no answer' };
          tested[u] = r; if (r.ok) bad.delete(u);
          const el = cell(u); if (el) showResult(el, r);
        };
        for (let i = 0; i < urls.length; i += 3) await Promise.all(urls.slice(i, i + 3).map(one));
        const works = urls.filter(u => tested[u] && tested[u].ok).length;
        b.disabled = false; b.textContent = 'Test servers';
        toast(works ? `${works} of ${urls.length} servers work right now` : 'None of the servers are working right now');
        if (prefs.server === 'auto' && !server.ok && works) { await reconnect(true); drawNow(); }
      }
    });
    body.addEventListener('click', e => {
      const segBtn = e.target.closest('.seg[data-pref] button');
      if (segBtn) {
        const key = segBtn.parentElement.dataset.pref;
        segBtn.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === segBtn));
        setPref(key, segBtn.dataset.v);
        return;
      }
      const sw = e.target.closest('[data-accent]');
      if (sw) { setPref('accent', sw.dataset.accent); body.querySelectorAll('.swatch').forEach(x => x.classList.toggle('on', x === sw)); return; }
      const bg = e.target.closest('[data-bg]');
      if (bg) {
        if (bg.dataset.bg === 'image' && !load('bg-image', '')) { $('#bg-file').click(); return; }
        setPref('bg', bg.dataset.bg); body.querySelectorAll('.bgopt').forEach(x => x.classList.toggle('on', x === bg)); return;
      }
      if (e.target.closest('#bg-upload')) { $('#bg-file').click(); return; }
      if (e.target.closest('#look-reset')) {
        Object.assign(prefs, LOOK); save('prefs', prefs); applyLook(); openSheet('settings', 'look'); toast('Appearance reset'); return;
      }
    });
    body.addEventListener('input', e => {
      if (e.target.id === 'accent-pick') {
        const c = e.target.value; setPref('accent', c);
        const lab = e.target.parentElement; lab.style.setProperty('--c', c);
        body.querySelectorAll('.swatch').forEach(x => x.classList.toggle('on', x === lab));
      }
    });
    body.addEventListener('change', async e => {
      const el = e.target;
      if (el.name === 'srv') {
        prefs.server = el.value; save('prefs', prefs);
        if (el.value === 'custom' && !prefs.custom) { $('#custom').focus(); return; }
        await reconnect(); drawNow();
        toast(server.ok ? 'Connected' : 'That server didn\'t answer');
      } else if (el.id === 'custom') {
        let v = el.value.trim();
        if (v && !/^wss?:\/\//i.test(v)) v = 'wss://' + v.replace(/^https?:\/\//i, '');
        el.value = v; prefs.custom = v; prefs.server = 'custom'; save('prefs', prefs);
        const r = document.querySelector('input[name=srv][value=custom]'); if (r) r.checked = true;
        if (v) { await reconnect(); drawNow(); toast(server.ok ? 'Connected to your server' : 'Your server didn\'t answer'); }
      } else if (el.id === 'core') {
        useCore(el.value);
      } else if (el.id === 'yt') {
        prefs.yt = el.value; save('prefs', prefs);
        toast({ auto: 'YouTube: the simple player when a video won\'t play', simple: 'YouTube: always the simple player', page: 'YouTube: always the full page' }[el.value]);
        if (active) { active.vforce = null; active.vid = null; }
      } else if (el.id === 'engine') { prefs.engine = el.value; save('prefs', prefs); renderNtp(); toast('Search engine: ' + ENGINES[el.value][0]); }
      else if (el.id === 'restore') { prefs.restore = el.checked; save('prefs', prefs); }
      else if (el.matches('input[type=checkbox][data-pref]')) setPref(el.dataset.pref, el.checked);
      else if (el.id === 'font-pick') setPref('font', el.value);
      else if (el.id === 'bg-file' && el.files[0]) {
        const pic = await shrinkPicture(el.files[0]);
        if (!pic) return toast('That picture couldn\'t be used');
        save('bg-image', pic);
        if (load('bg-image', '') !== pic) return toast('That picture is too big to save. Try a smaller one.');
        setPref('bg', 'image'); openSheet('settings', 'look'); toast('Background set');
      } else if (el.id === 'bg-url') {
        const v = el.value.trim();
        if (!/^https?:\/\/\S+$/i.test(v)) { if (v) toast('That doesn\'t look like a web address'); return; }
        save('bg-image', v); setPref('bg', 'image'); openSheet('settings', 'look'); toast('Background set');
      }
    });
    body.addEventListener('input', e => { if (e.target.id === 'h-search') { histFilter = e.target.value; drawHistory(); } });
    body.addEventListener('keydown', e => { const o = e.target.closest('.link[data-open]'); if (o && e.key === 'Enter' && e.target === o) { closeSheet(); newTab(o.dataset.open); } });

    // keep the address, title and icon up to date (pages can change them at any time)
    setInterval(() => { tabs.forEach(t => { if (t.frame && (t === active || t.loading || t.expect)) { sync(t); hook(t); } }); renderBar(); }, 400);
    setInterval(ytCheck, 1500);
    $('#vbar').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (b) videoAction(b.dataset.v); });
    addEventListener('pagehide', saveTabs);
  }
  // Switch proxy engines (Settings, or the button on the error screen) and reopen the page with it
  function useCore(core) {
    if (!CORES[core] || core === prefs.core) return;
    prefs.core = core; save('prefs', prefs);
    toast('Now using ' + CORES[core] + ' (change it in Settings)');
    const sel = document.getElementById('core'); if (sel) sel.value = core;
    if (active && active.url) go(active, active.url, true);
  }
  // Make an uploaded picture small enough to keep (it's saved in this browser)
  function shrinkPicture(file) {
    return new Promise(res => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, 1920 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        res(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); res(''); };
      img.src = url;
    });
  }
  function removeLink(kind, u) {
    if (kind === 'bm') { bookmarks = bookmarks.filter(b => b.u !== u); save('bookmarks', bookmarks); }
    else { visits = visits.filter(h => h.u !== u); save('history', visits); }
    renderNtp(); renderBar();
  }

  // ---------- start ----------
  function start() {
    // draw the icons into the buttons that ask for one
    document.querySelectorAll('[data-icon]').forEach(el => {
      if (el.tagName === 'SPAN' && !el.textContent) el.outerHTML = icon(el.dataset.icon);
      else el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
    });
    applyLook();
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
