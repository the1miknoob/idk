// Seek's page: the search box, the results, the tabs (All, Images, Videos, News), suggestions while you type and the
// settings. Everything Seek looks up goes through the Browser's encrypted proxy tunnel (engine.js does the searching).
// Inside the Browser it uses the Browser's own tunnel; on its own it connects to the proxy server the Browser last used.
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const enc = encodeURIComponent;
  const Engine = window.SeekEngine;

  const BROWSER = new URL('../browser/', location.href);
  // Opened inside the Browser (as one of its tabs)? Then links are handled by the Browser and its tunnel is used.
  const inBrowser = (() => { try { return window.parent !== window && parent.location.pathname.startsWith(BROWSER.pathname); } catch (e) { return false; } })();
  if (!inBrowser && window.top === window) { const s = document.createElement('script'); s.src = '../site.js'; s.defer = true; document.head.appendChild(s); }

  // ---------- settings and look ----------
  const prefs = Object.assign({ safe: 'strict', open: 'browser' }, read('seek-prefs', {}));
  const look = read('browser-prefs', {}) || {};
  const dark = look.theme === 'dark' || (look.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  if (/^#[0-9a-f]{6}$/i.test(look.accent || '')) document.documentElement.style.setProperty('--accent', look.accent);
  const meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = dark ? '#15171b' : '#ffffff';
  if (inBrowser) $('#open-set').hidden = true;   // in the Browser, results always open in the Browser

  // ---------- the proxy tunnel ----------
  // ✏️ EDIT: the same free proxy servers as the Browser (used only when Seek is opened on its own before the Browser ever was)
  const SERVERS = ['wss://wisp.freewisp.org/', 'wss://wisp.terbiumon.top/wisp/', 'wss://anura.pro/', 'wss://daydreamx.pro/wisp/', 'wss://gointospace.app/wisp/',
    'wss://truffled.lol/wisp/', 'wss://fern.best/wisp/', 'wss://wisp.webmc.fun/', 'wss://learn.overcookedchicken.org/wisp/', 'wss://wisp.mercurywork.shop/'];
  function ping(url, ms) {
    return new Promise(res => {
      let ws; const done = ok => { clearTimeout(t); try { ws && ws.close(); } catch (e) {} res(ok); };
      const t = setTimeout(() => done(false), ms);
      try { ws = new WebSocket(url); ws.onopen = () => done(true); ws.onerror = () => done(false); } catch (e) { done(false); }
    });
  }
  async function findServer() {
    const bp = read('browser-prefs', {}) || {};
    if (bp.server === 'custom' && bp.custom) return bp.custom;
    if (bp.server && bp.server !== 'auto') return bp.server;
    const saved = read('browser-wisp', '');
    const list = [saved].concat((read('browser-servers', null) || []).map(s => s.url), SERVERS).filter((u, i, a) => u && a.indexOf(u) === i);
    return new Promise(res => {
      let left = list.length;
      list.forEach(u => ping(u, 6000).then(ok => { if (ok) res(u); else if (--left === 0) res(''); }));
    });
  }
  let client = null, ready = null;
  function tunnel() {
    if (ready) return ready;
    ready = (async () => {
      if (!window.BareMux) throw Object.assign(new Error('The proxy files didn\'t load.'), { kind: 'tunnel' });
      const conn = new BareMux.BareMuxConnection(BROWSER.pathname + 'baremux/worker.js');
      const transport = () => Promise.race([conn.getTransport(), new Promise(r => setTimeout(() => r(''), 3000))]).catch(() => '');
      let name = await transport();
      // inside the Browser, it may still be finding a server: give it a little while
      for (let i = 0; !name && inBrowser && i < 6; i++) { await new Promise(r => setTimeout(r, 1500)); name = await transport(); }
      if (!name) {
        if (inBrowser) throw Object.assign(new Error('The Browser\'s proxy isn\'t connected yet.'), { kind: 'tunnel' });
        const wisp = await findServer();
        if (!wisp) throw Object.assign(new Error('No proxy server answered.'), { kind: 'tunnel' });
        await conn.setTransport(BROWSER.pathname + 'tunnel.js', [{ wisp }]);
        write('browser-wisp', wisp);
      }
      client = new BareMux.BareClient();
    })();
    ready.catch(() => { ready = null; });
    return ready;
  }
  // A second tunnel, through a different free proxy server, for when the search engines don't answer through the first
  // one (they often block a busy free server for a while, and some servers block them). It runs in this page only, so
  // the Browser's own connection isn't touched.
  let spare = null, spareFinding = null;
  const badSpares = new Set();
  const mainWisp = () => { const bp = read('browser-prefs', {}) || {}; return bp.server === 'custom' ? bp.custom : (bp.server && bp.server !== 'auto' ? bp.server : read('browser-wisp', '')); };
  function spareReady() {
    if (window.__seekFetch) return Promise.resolve(!!window.__seekSpareOk);   // automated tests
    if (spare) return Promise.resolve(true);
    if (!spareFinding) {
      spareFinding = (async () => {
        const used = mainWisp();
        const list = (read('browser-servers', null) || []).map(x => x && x.url).concat(SERVERS).filter((u, i, a) => u && a.indexOf(u) === i && u !== used && !badSpares.has(u));
        if (!list.length) return false;
        const url = await new Promise(res => { let left = list.length; list.forEach(u => ping(u, 5000).then(ok => { if (ok) res(u); else if (--left === 0) res(''); })); });
        if (!url) return false;
        const { default: Tunnel } = await import(BROWSER.pathname + 'tunnel.js');
        const t = new Tunnel({ wisp: url });
        await t.init();
        spare = { wisp: url, t };
        return true;
      })().catch(() => false).finally(() => { spareFinding = null; });
    }
    return spareFinding;
  }
  async function spareFetch(url, o) {
    const sp = spare;
    if (!sp) throw new Error('No other proxy server answered');
    let u = url, method = o.method || 'GET', body = o.body;
    try {
      for (let hop = 0; hop < 6; hop++) {
        const r = await sp.t.request(new URL(u), method, body, o.headers || {}, undefined);
        const h = r.headers || {};
        let loc = h.location || h.Location || '';
        if (Array.isArray(loc)) loc = loc[0];
        if (r.status >= 300 && r.status < 400 && loc) {
          u = new URL(loc, u).href;
          if (r.status === 303 || ((r.status === 301 || r.status === 302) && method === 'POST')) { method = 'GET'; body = undefined; }
          continue;
        }
        const txt = r.body ? await new Response(r.body).text() : '';
        if (r.status >= 400) return Promise.reject(Object.assign(new Error(new URL(u).hostname + ' answered ' + r.status), { answered: true }));
        return o.json ? JSON.parse(txt) : txt;
      }
    } catch (e) {
      if (!e.answered && spare === sp) { badSpares.add(sp.wisp); spare = null; }   // that server stopped working: find another next time
      throw e;
    }
    throw new Error('Too many redirects');
  }
  const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), ms))]);
  // Fetch a page's text (or JSON) for the engine: through the tunnel; sites that allow it (Wikipedia) are tried directly first
  async function get(url, o) {
    o = o || {};
    if (window.__seekFetch) return window.__seekFetch(url, o);   // automated tests
    if (o.spare) { if (!(await spareReady())) throw new Error('No other proxy server answered'); return spareFetch(url, o); }
    if (o.direct) {
      try { const r = await timeout(fetch(url), 4000); if (r.ok) return o.json ? r.json() : r.text(); } catch (e) { /* through the tunnel instead */ }
    }
    await tunnel();
    const r = await client.fetch(url, { method: o.method || 'GET', body: o.body, headers: o.headers || {} });
    if (r.status >= 400) throw new Error(new URL(url).hostname + ' answered ' + r.status);
    const t = await r.text();
    return o.json ? JSON.parse(t) : t;
  }
  async function getBlob(url) {
    await tunnel();
    const r = await client.fetch(url);
    if (r.status >= 400) throw new Error(String(r.status));
    return r.blob();
  }

  const engine = new Engine(get, { safe: prefs.safe, spare: spareReady, onStatus: t => { if (q) $('#status').textContent = t; } });

  // ---------- links, icons and pictures ----------
  // Where a result opens: in the Browser (through its proxy), or the address itself
  function linkFor(url) {
    if (inBrowser || prefs.open === 'direct') return url;
    return BROWSER.href + '?url=' + enc(url);
  }
  const icons = read('browser-icons', {}) || {};
  function fav(host) {
    const h = (host || '').replace(/^www\./, '');
    if (icons[h] || icons['www.' + h]) return `<span class="fav"><img src="${esc(icons[h] || icons['www.' + h])}" alt=""></span>`;
    let n = 0; for (const c of h) n = (n * 31 + c.charCodeAt(0)) >>> 0;
    return `<span class="fav" style="background:hsl(${n % 360} 45% 46%);border-color:transparent">${esc((h[0] || '?').toUpperCase())}</span>`;
  }
  function crumbs(url) {
    try { const u = new URL(url); const parts = u.pathname.split('/').filter(Boolean).slice(0, 3).map(p => { try { return decodeURIComponent(p); } catch (e) { return p; } }); return u.hostname.replace(/^www\./, '') + (parts.length ? ' › ' + parts.join(' › ') : ''); } catch (e) { return url; }
  }
  // A picture that won't load directly (blocked network, picky website) is fetched through the tunnel instead
  window.__seekImg = img => {
    if (img.dataset.tried) return;
    img.dataset.tried = '1';
    getBlob(img.dataset.src || img.src).then(b => { img.src = URL.createObjectURL(b); }, () => { img.style.visibility = 'hidden'; });
  };
  const pic = (src, alt, cls) => `<img${cls ? ` class="${cls}"` : ''} src="${esc(src)}" data-src="${esc(src)}" alt="${esc(alt || '')}" loading="lazy" referrerpolicy="no-referrer" onerror="__seekImg(this)">`;

  // ---------- searching ----------
  let q = '', kind = 'web', page = 1, run = 0, shown = new Set();
  const KINDS = ['web', 'images', 'videos', 'news'];
  function readUrl() {
    const p = new URLSearchParams(location.search);
    return { q: (p.get('q') || '').trim(), kind: KINDS.includes(p.get('t')) ? p.get('t') : 'web' };
  }
  function setUrl(push) {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (q && kind !== 'web') p.set('t', kind);
    const url = location.pathname + (p.toString() ? '?' + p : '');
    if (url !== location.pathname + location.search) history[push ? 'pushState' : 'replaceState'](null, '', url);
  }
  function go(newQ, newKind, push) {
    q = String(newQ || '').trim();
    kind = newKind || kind;
    document.body.classList.toggle('searching', !!q);
    $('#q').value = q; $('#home-q').value = q;
    ['#form', '#home-form'].forEach(s => $(s).classList.toggle('has-text', !!q));
    document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.kind === kind)));
    document.title = q ? q + ' - Seek' : 'Seek';
    setUrl(push);
    hideSugg();
    if (!q) { setTimeout(() => $('#home-q').focus(), 0); return; }
    page = 1; shown = new Set();
    $('#list').innerHTML = skeleton(); $('#side').innerHTML = ''; $('#more').hidden = true; $('#after').innerHTML = '';
    $('#cols').classList.toggle('wide', kind === 'images');
    $('#status').textContent = 'Searching…';
    window.scrollTo(0, 0);
    const mine = ++run;
    ({ web: searchWeb, images: searchImages, videos: searchVideos, news: searchNews })[kind](mine);
  }
  const skeleton = () => '<div class="skeleton">' + '<div class="r"><div class="bar" style="width:30%"></div><div class="bar" style="width:70%;height:16px"></div><div class="bar" style="width:95%"></div><div class="bar" style="width:80%"></div></div>'.repeat(4) + '</div>';
  // Links to search the same thing on other search engines (they open in the Browser, through its proxy)
  // ✏️ EDIT: the other search engines offered
  const ELSEWHERE = [['Bing', 'https://www.bing.com/search?q='], ['DuckDuckGo', 'https://duckduckgo.com/?q='], ['Google', 'https://www.google.com/search?q='], ['Brave', 'https://search.brave.com/search?q=']];
  const elsewhere = () => `<div class="elsewhere"><span>Search for <b>${esc(q)}</b> on</span>` + ELSEWHERE.map(([n, u]) => `<a class="btn" href="${esc(linkFor(u + enc(q)))}" data-url="${esc(u + enc(q))}">${esc(n)}</a>`).join('') + '</div>';
  function fail(mine, e, what) {
    if (mine !== run) return;
    const tunnelProblem = e && e.kind === 'tunnel';
    $('#status').textContent = '';
    $('#list').innerHTML = `<div class="msg"><h2>${tunnelProblem ? 'Seek couldn\'t connect to the proxy' : esc(what || 'Nothing came back')}</h2>
      <p>${tunnelProblem ? (inBrowser ? 'The Browser is still connecting to a proxy server. Wait a moment, then try again.' : 'Seek searches through the Browser\'s proxy servers, and none of them answered. Open the Browser once (it finds a server that works), then search again.') : esc(String(e && e.message || e || 'Try again in a moment.'))}</p>
      <button class="btn primary" type="button" data-act="retry">Try again</button>${tunnelProblem && !inBrowser ? ` <a class="btn" href="${esc(BROWSER.href)}">Open the Browser</a>` : ''}</div>` + elsewhere();
  }

  // All: web results, a calculator or dictionary answer, and a Wikipedia card
  function searchWeb(mine) {
    const t0 = performance.now();
    const sum = Engine.calc(q);
    const word = Engine.wantsDefinition(q);
    if (word) engine.define(word).then(d => { if (mine === run && d) $('#side').insertAdjacentHTML('afterbegin', defCard(d)); }).catch(() => {});
    engine.wiki(q).then(w => { if (mine === run && w) $('#side').insertAdjacentHTML('beforeend', wikiCard(w)); }).catch(() => {});
    $('#after').innerHTML = '';
    // (no need to wait for the tunnel first: if it can't connect, the engine tries another proxy server by itself)
    engine.web(q, 1).then(async res => {
      if (mine !== run) return;
      let list = res.results, note = '';
      if (!list.length) {
        // nothing from any search engine: Wikipedia's own search (which also fixes spelling mistakes)
        const why = res.sources.map(s => s.name + ': ' + (s.error || 'nothing found')).join('; ');
        // every engine answered, with nothing: Strict safe search hides whole searches when it thinks they may not be for kids
        const strict = prefs.safe === 'strict' && res.sources.every(s => s.ok);
        const hint = strict ? `<p>Safe search is on <b>Strict</b>, which can hide all the results for some searches. <button class="btn" type="button" data-act="moderate">Search with Moderate safe search</button></p>` : '';
        try { list = await engine.wikiList(q); } catch (e) { list = []; }
        if (mine !== run) return;
        if (!list.length && sum) { $('#list').innerHTML = calcCard(sum); $('#status').textContent = ''; $('#after').innerHTML = elsewhere(); return; }
        if (!list.length) { fail(mine, new Error(strict ? 'None of the search engines found anything (' + why + ').' : 'The search engines didn\'t give any results through the proxy servers (' + why + '). Try again in a moment, or search on one of these:'), 'No results'); if (hint) $('#list .msg h2').insertAdjacentHTML('afterend', hint); return; }
        note = `<div class="msg note"><p>${list.fixed ? `No results for <b>${esc(q)}</b>. Showing results for <b>${esc(list.fixed)}</b> from Wikipedia.` : (res.sources.every(s => s.ok) ? 'The search engines didn\'t find anything, so these are Wikipedia\'s results.' : 'The search engines didn\'t answer through the proxy servers this time, so these are Wikipedia\'s results.')}</p>
          ${hint}<p class="why">${esc(why)}</p><button class="btn" type="button" data-act="retry">Try again</button></div>`;
      }
      $('#list').innerHTML = (sum ? calcCard(sum) : '') + note + list.slice(0, 10).map(resultHtml).join('');
      list.slice(0, 10).forEach(r => shown.add(Engine.keyOf(r.url)));
      more = list.slice(10);
      $('#more').hidden = !res.results.length;
      $('#after').innerHTML = elsewhere();
      status(res, list.length, performance.now() - t0);
    }).catch(e => fail(mine, e));
  }
  let more = [];
  async function moreWeb() {
    const mine = run;
    $('#more').disabled = true; $('#more').textContent = 'Loading…';
    let list = more.filter(r => !shown.has(Engine.keyOf(r.url)));
    if (list.length < 10) {
      try {
        page++;
        const res = await engine.web(q, page);
        list = list.concat(res.results.filter(r => !shown.has(Engine.keyOf(r.url)) && !list.some(x => Engine.keyOf(x.url) === Engine.keyOf(r.url))));
        if (!res.results.length) $('#more').hidden = true;
      } catch (e) { $('#more').hidden = true; }
    }
    if (mine !== run) return;
    const next = list.slice(0, 10);
    more = list.slice(10);
    next.forEach(r => shown.add(Engine.keyOf(r.url)));
    $('#list').insertAdjacentHTML('beforeend', next.map(resultHtml).join(''));
    $('#more').disabled = false; $('#more').textContent = 'More results';
    if (!next.length) $('#more').hidden = true;
  }
  function status(res, n, ms) {
    const src = res.sources.map(s => `<span class="src${s.ok && s.count ? '' : ' no'}" title="${esc((s.ok ? s.count + ' results' : s.error || '') + (s.spare ? ' (through another proxy server)' : ''))}"><i></i>${esc(s.name)}</span>`).join('');
    $('#status').innerHTML = `<span>${n} result${n === 1 ? '' : 's'} in ${(ms / 1000).toFixed(1)} s</span>${src}`;
  }
  const NAMES = { ddg: 'DuckDuckGo', bing: 'Bing', mojeek: 'Mojeek', wikipedia: 'Wikipedia' };
  function resultHtml(r) {
    const site = (r.host || Engine.hostOf(r.url));
    return `<article class="r"><div class="site">${fav(site)}<span class="name"><b>${esc(site)}</b><small>${esc(crumbs(r.url))}</small></span></div>
      <h3><a href="${esc(linkFor(r.url))}" data-url="${esc(r.url)}">${esc(r.title)}</a></h3>${r.snippet ? `<p>${esc(r.snippet)}</p>` : ''}
      <div class="by">Found by ${esc((r.from || []).map(f => NAMES[f] || f).join(', '))}</div></article>`;
  }
  const calcCard = c => `<div class="card calc"><div class="expr">${esc(c.expr)} =</div><div class="val">${esc(Engine.fmtNum(c.value))}</div></div>`;
  const defCard = d => `<div class="card def"><h2>${esc(d.word)}</h2><div class="sub">${esc(d.phonetic || 'Dictionary')}</div>` +
    d.meanings.map(m => `<div class="part">${esc(m.part)}</div><ol>${m.defs.map(x => `<li>${esc(x)}</li>`).join('')}</ol>`).join('') + '</div>';
  const wikiCard = w => `<div class="card">${w.thumb ? pic(w.thumb, w.title, 'wimg') : ''}<h2>${esc(w.title)}</h2>${w.description ? `<div class="sub">${esc(w.description)}</div>` : ''}
      <p>${esc(w.text.length > 600 ? w.text.slice(0, 600).replace(/\s\S*$/, '') + '…' : w.text)}</p><a class="src-link" href="${esc(linkFor(w.url))}" data-url="${esc(w.url)}">Read more on Wikipedia</a></div>`;

  function searchImages(mine) {
    engine.images(q, 1).then(list => {
      if (mine !== run) return;
      if (!list.length) return fail(mine, null, 'No pictures found');
      $('#status').textContent = list.length + ' pictures';
      $('#list').innerHTML = '<div class="imgs">' + list.map(i => `<a href="${esc(linkFor(i.page))}" data-url="${esc(i.page)}" title="${esc(i.title)}">${pic(i.thumb, i.title)}<span>${esc(i.title || Engine.hostOf(i.page))}</span></a>`).join('') + '</div>';
    }).catch(e => fail(mine, e, 'Pictures couldn\'t be loaded'));
  }
  function searchVideos(mine) {
    engine.videos(q).then(list => {
      if (mine !== run) return;
      if (!list.length) return fail(mine, null, 'No videos found');
      $('#status').textContent = list.length + ' videos from YouTube';
      $('#list').innerHTML = list.map(v => `<a class="vid" href="${esc(linkFor(v.url))}" data-url="${esc(v.url)}"><span class="th">${pic(v.thumb, '')}${v.length ? `<span class="len">${esc(v.length)}</span>` : ''}</span>
        <span><b>${esc(v.title)}</b><small>${esc([v.channel, v.views, v.when].filter(Boolean).join(' · '))}</small></span></a>`).join('');
    }).catch(e => fail(mine, e, 'Videos couldn\'t be loaded'));
  }
  function ago(when) {
    const t = Date.parse(when);
    if (!t) return /^[\w .]{1,24}$/.test(when || '') ? when : '';   // already short, like Bing's 2h
    const m = Math.round((Date.now() - t) / 60000);
    return m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : m < 43200 ? Math.round(m / 1440) + ' days ago' : new Date(t).toLocaleDateString();
  }
  function searchNews(mine) {
    engine.news(q).then(list => {
      if (mine !== run) return;
      if (!list.length) return fail(mine, null, 'No news found');
      $('#status').textContent = list.length + ' news stories';
      $('#list').innerHTML = list.slice(0, 30).map(n => `<a class="news" href="${esc(linkFor(n.url))}" data-url="${esc(n.url)}"><small>${esc([n.source || Engine.hostOf(n.url), ago(n.when)].filter(Boolean).join(' · '))}</small>
        <b>${esc(n.title)}</b>${n.snippet ? `<p>${esc(n.snippet.slice(0, 240))}</p>` : ''}</a>`).join('');
    }).catch(e => fail(mine, e, 'News couldn\'t be loaded'));
  }

  // ---------- suggestions while typing ----------
  let sugg = [], suggOn = -1, suggFor = null, suggTimer = 0;
  function hideSugg() { document.querySelectorAll('.sugg').forEach(s => s.remove()); sugg = []; suggOn = -1; }
  function showSugg(form, list) {
    hideSugg();
    if (!list.length || document.activeElement !== form.querySelector('input')) return;
    sugg = list; suggOn = -1;
    const box = document.createElement('div');
    box.className = 'sugg'; box.setAttribute('role', 'listbox');
    box.innerHTML = list.map((s, i) => `<button type="button" role="option" data-i="${i}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.5 15.5 20 20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>${esc(s)}</button>`).join('');
    box.addEventListener('mousedown', e => e.preventDefault());
    box.addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) go(sugg[+b.dataset.i], kind, true); });
    form.appendChild(box);
  }
  function onType(form) {
    const input = form.querySelector('input'), v = input.value.trim();
    form.classList.toggle('has-text', !!input.value);
    clearTimeout(suggTimer);
    if (!v) { hideSugg(); return; }
    suggTimer = setTimeout(() => {
      suggFor = v;
      engine.suggest(v).then(list => { if (suggFor === v && input.value.trim() === v) showSugg(form, list.filter(s => s.toLowerCase() !== v.toLowerCase()).slice(0, 7)); }).catch(() => {});
    }, 180);
  }
  function onKey(e, form) {
    const box = form.querySelector('.sugg');
    if (e.key === 'Escape') { hideSugg(); return; }
    if (!box || !sugg.length || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    const n = sugg.length;
    suggOn = e.key === 'ArrowDown' ? (suggOn + 1 >= n ? -1 : suggOn + 1) : (suggOn - 1 < -1 ? n - 1 : suggOn - 1);
    if (suggOn === -1) form.querySelector('input').value = suggFor || '';
    box.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === suggOn));
    if (suggOn >= 0) form.querySelector('input').value = sugg[suggOn];
  }

  // ---------- wiring ----------
  [['#form', '#q'], ['#home-form', '#home-q']].forEach(([f, i]) => {
    const form = $(f), input = $(i);
    form.addEventListener('submit', e => { e.preventDefault(); input.blur(); go(input.value, kind, true); });
    input.addEventListener('input', () => onType(form));
    input.addEventListener('keydown', e => onKey(e, form));
    input.addEventListener('blur', () => setTimeout(hideSugg, 120));
    form.querySelector('.clear').addEventListener('click', () => { input.value = ''; form.classList.remove('has-text'); hideSugg(); input.focus(); });
  });
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button[data-kind]'); if (b && b.dataset.kind !== kind) go(q, b.dataset.kind, true); });
  $('#home-kinds').addEventListener('click', e => {
    const b = e.target.closest('button[data-kind]');
    if (!b) return;
    if ($('#home-q').value.trim()) go($('#home-q').value, b.dataset.kind, true);
    else { kind = b.dataset.kind; $('#home-q').placeholder = 'Search for ' + b.dataset.kind; $('#home-q').focus(); }
  });
  $('#more').addEventListener('click', moreWeb);
  document.addEventListener('click', e => {
    if (e.target.closest('[data-act=retry]')) { ready = null; go(q, kind, false); }
    if (e.target.closest('[data-act=moderate]')) { prefs.safe = 'moderate'; write('seek-prefs', prefs); engine.opts.safe = 'moderate'; go(q, kind, false); }
    const set = $('#settings');
    if (e.target.closest('#set-btn, #home-set')) { set.hidden = !set.hidden; paintSettings(); }
    else if (!set.hidden && !e.target.closest('#settings')) set.hidden = true;
  });
  function paintSettings() { document.querySelectorAll('.seg[data-pref]').forEach(s => s.querySelectorAll('button').forEach(b => b.classList.toggle('on', prefs[s.dataset.pref] === b.dataset.v))); }
  $('#settings').addEventListener('click', e => {
    const b = e.target.closest('.seg[data-pref] button');
    if (!b) return;
    const k = b.closest('.seg').dataset.pref;
    prefs[k] = b.dataset.v; write('seek-prefs', prefs); paintSettings();
    engine.opts.safe = prefs.safe;
    if (q && k === 'safe') go(q, kind, false);
    if (q && k === 'open') document.querySelectorAll('a[data-url]').forEach(a => { a.href = linkFor(a.dataset.url); });
  });
  addEventListener('keydown', e => {
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { e.preventDefault(); (q ? $('#q') : $('#home-q')).focus(); }
    if (e.key === 'Escape') $('#settings').hidden = true;
  });
  addEventListener('popstate', () => { const s = readUrl(); go(s.q, s.kind, false); });
  const start = readUrl();
  kind = start.kind;
  go(start.q, start.kind, false);
  tunnel().catch(() => {});   // get the tunnel ready while you type
  window.Seek = { get q() { return q; }, get kind() { return kind; }, go, engine, inBrowser, get, spareServer: () => spare && spare.wisp };   // for the automated tests
})();
