// Seek's engine: asks several search engines at the same time, reads their result pages, and merges everything into
// one list with Seek's own ranking. Also images, videos, news, word definitions, Wikipedia cards and a calculator.
// It doesn't load anything itself: it's handed a `get(url, opts)` function that fetches through the Browser's proxy
// tunnel (so the search engines can be reached even where they're blocked, and without the usual browser limits).
(function (root) {
  'use strict';

  // ✏️ EDIT: where web results come from, and how much each one counts in the ranking
  const WEB = [
    { id: 'ddg', name: 'DuckDuckGo', weight: 1.0 },
    { id: 'bing', name: 'Bing', weight: 1.0 },
    { id: 'mojeek', name: 'Mojeek', weight: 0.8 },   // has its own index of the web, so it finds different things
  ];
  const PER_PAGE = 10;
  const K = 8;                 // ranking: a result at place r in an engine scores weight / (K + r)
  const PER_SITE = 2;          // at most this many results from one website in a row of ten (more go further down)
  const TIMEOUT_MS = 9000;     // a source slower than this is left out

  // ---------- small helpers ----------
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const text = el => el ? clean(el.textContent) : '';
  const enc = encodeURIComponent;
  function withTimeout(p, ms, what) {
    return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error((what || 'It') + ' took too long')), ms))]);
  }
  function parseHTML(html) { return new DOMParser().parseFromString(html, 'text/html'); }
  function absUrl(href, base) { try { return new URL(href, base).href; } catch (e) { return ''; } }
  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
  // One key per page, so the same page found by two engines counts once
  function keyOf(u) {
    try {
      const x = new URL(u);
      x.hash = '';
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'fbclid', 'gclid'].forEach(p => x.searchParams.delete(p));
      return (x.hostname.replace(/^(www|m)\./, '') + x.pathname.replace(/\/(index\.html?)?$/, '') + (x.search || '')).toLowerCase();
    } catch (e) { return u; }
  }
  const okUrl = u => /^https?:\/\//i.test(u || '');
  function b64url(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    try { return decodeURIComponent(escape(atob(s))); } catch (e) { try { return atob(s); } catch (e2) { return ''; } }
  }
  // A search engine's "you look like a robot" page instead of results
  function blocked(doc, html) {
    return !!(doc.querySelector('#challenge-form, .anomaly-modal, form[action*="captcha" i], #captcha, .g-recaptcha, iframe[src*="captcha" i]') ||
      /unusual traffic|are you a robot|anomaly-modal|verify you are human|bots use duckduckgo|altcha/i.test(html.slice(0, 20000)));
  }
  // When an engine changes its page layout: take any outside links with real-looking titles
  function anyLinks(doc, base, skipHost) {
    const out = [], seen = new Set();
    for (const a of doc.querySelectorAll('a[href]')) {
      const u = absUrl(a.getAttribute('href'), base), h = hostOf(u), t = text(a);
      if (!okUrl(u) || !h || h.endsWith(skipHost) || t.length < 12 || seen.has(keyOf(u))) continue;
      seen.add(keyOf(u));
      out.push({ url: u, title: t.slice(0, 140), snippet: '' });
      if (out.length >= 12) break;
    }
    return out;
  }

  // ---------- web results from each engine ----------
  const SAFE = {   // safe search settings in each engine's own words
    ddg: { strict: '1', moderate: '-1', off: '-2' },
    bing: { strict: 'strict', moderate: 'moderate', off: 'off' },
    mojeek: { strict: '1', moderate: '1', off: '0' },
  };
  // Each source: request(q, page, safe, state) → { url, method, body, headers }, and parse(html, url, state) → results.
  // `state` is kept between the pages of one search (DuckDuckGo needs a code from page 1 to give page 2).
  // (These follow how SearXNG, the big open-source meta search engine, reads the same pages.)
  const SOURCES = {
    ddg: {
      // DuckDuckGo's no-JavaScript page, asked the way its own search form does (a POST)
      request(q, page, safe, state) {
        const kp = SAFE.ddg[safe];
        const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://html.duckduckgo.com/', Cookie: `kl=us-en; kp=${kp}` };
        let body;
        if (page > 1 && state.next) { body = new URLSearchParams(state.next); body.set('kp', kp); }
        else if (page > 1) throw new Error('DuckDuckGo has no more pages');
        else body = new URLSearchParams({ q, b: '', kl: 'us-en', kp });
        return { url: 'https://html.duckduckgo.com/html/', method: 'POST', body: body.toString(), headers };
      },
      parse(html, base, state) {
        const doc = parseHTML(html);
        if (blocked(doc, html)) throw new Error('DuckDuckGo asked for a robot check');
        // the "Next" button's form holds everything needed for the next page (including the vqd code)
        const vqd = doc.querySelector('input[name="vqd"]');
        const form = vqd && vqd.closest('form');
        state.next = form ? [...form.querySelectorAll('input[name]')].filter(i => i.type !== 'submit').map(i => [i.name, i.value]) : null;
        const out = [];
        for (const r of doc.querySelectorAll('.result, .web-result')) {
          if (/result--ad/.test(r.className) || r.querySelector('.badge--ad')) continue;
          const a = r.querySelector('a.result__a') || r.querySelector('h2 a');
          if (!a) continue;
          let u = absUrl(a.getAttribute('href'), base);
          try { const x = new URL(u); if (/duckduckgo\.com$/.test(x.hostname) && x.pathname.startsWith('/l/')) u = x.searchParams.get('uddg') || u; } catch (e) {}
          if (!okUrl(u) || /duckduckgo\.com\/y\.js/.test(u)) continue;
          out.push({ url: u, title: text(a), snippet: text(r.querySelector('.result__snippet')) });
        }
        return out.length ? out : anyLinks(doc, base, 'duckduckgo.com');
      }
    },
    bing: {
      // (no cc=US: Bing sends junk results for it)
      request: (q, page, safe) => ({ url: `https://www.bing.com/search?q=${enc(q)}&setlang=en&adlt=${SAFE.bing[safe]}` + (page > 1 ? `&first=${(page - 1) * 10 + 1}` : '') }),
      parse(html, base) {
        const doc = parseHTML(html);
        if (blocked(doc, html)) throw new Error('Bing asked for a robot check');
        const out = [];
        for (const li of doc.querySelectorAll('li.b_algo')) {
          const a = li.querySelector('h2 a');
          if (!a) continue;
          let u = absUrl(a.getAttribute('href'), base);
          try {   // Bing's own click-tracking links hide the real address (base64, after "a1")
            const x = new URL(u);
            if (/bing\.com$/.test(x.hostname) && x.pathname.startsWith('/ck/a')) { const p = x.searchParams.get('u') || ''; const d = b64url(p.replace(/^a1/, '')); if (okUrl(d)) u = d; }
          } catch (e) {}
          if (!okUrl(u)) continue;
          const snip = li.querySelector('.b_caption p, p.b_lineclamp2, p.b_lineclamp3, p.b_lineclamp4, .b_paractl, .b_algoSlug, p');
          out.push({ url: u, title: text(a), snippet: text(snip).replace(/^Web\s*/, '') });
        }
        return out.length ? out : anyLinks(doc, base, 'bing.com');
      }
    },
    mojeek: {
      // (s=0 on the first page sets off Mojeek's rate limit, so it's only sent for later pages)
      request: (q, page, safe) => ({ url: `https://www.mojeek.com/search?q=${enc(q)}&safe=${SAFE.mojeek[safe]}` + (page > 1 ? `&s=${(page - 1) * 10}` : '') }),
      parse(html, base) {
        const doc = parseHTML(html);
        if (blocked(doc, html)) throw new Error('Mojeek asked for a robot check');
        const out = [];
        for (const li of doc.querySelectorAll('ul.results-standard > li, .results-standard li')) {
          const a = li.querySelector('h2 a') || li.querySelector('a.title');
          if (!a) continue;
          const ob = li.querySelector('a.ob');
          const u = absUrl((ob || a).getAttribute('href'), base);
          if (!okUrl(u)) continue;
          out.push({ url: u, title: text(a), snippet: text(li.querySelector('p.s')) });
        }
        return out.length ? out : anyLinks(doc, base, 'mojeek.com');
      }
    }
  };

  // Seek's ranking: every engine votes for its results (a better place counts more, reciprocal rank fusion),
  // the same page found by several engines adds up, and one website can't fill the first page on its own
  function rank(lists, q) {
    const byKey = new Map();
    const words = clean(q).toLowerCase().split(' ').filter(w => w.length > 2);
    lists.forEach(({ src, items }) => {
      const w = (WEB.find(s => s.id === src) || { weight: 1 }).weight;
      items.forEach((it, i) => {
        const k = keyOf(it.url);
        let r = byKey.get(k);
        if (!r) { r = { url: it.url, title: it.title || '', snippet: it.snippet || '', host: hostOf(it.url), score: 0, from: [], best: Infinity }; byKey.set(k, r); }
        r.score += w / (K + i);
        if (!r.from.includes(src)) r.from.push(src);
        if (i < r.best || !r.title) { r.best = i; if (it.title) r.title = it.title; }
        if ((it.snippet || '').length > (r.snippet || '').length) r.snippet = it.snippet;
      });
    });
    const all = [...byKey.values()];
    all.forEach(r => {
      const t = (r.title || '').toLowerCase();
      const hits = words.filter(w => t.includes(w)).length;
      if (words.length) r.score += 0.02 * hits / words.length;   // a small nudge for titles that match what was searched
      if (r.from.length > 1) r.score *= 1 + 0.1 * (r.from.length - 1);
    });
    all.sort((a, b) => b.score - a.score);
    // no more than PER_SITE results from one site in each group of ten
    const out = [], later = [], perSite = {};
    all.forEach(r => {
      const group = Math.floor(out.length / PER_PAGE);
      const key = r.host + '#' + group;
      if ((perSite[key] || 0) >= PER_SITE) { later.push(r); return; }
      perSite[key] = (perSite[key] || 0) + 1;
      out.push(r);
    });
    return out.concat(later);
  }

  // ---------- the calculator ----------
  // Works out sums like "12*(3+4)", "2^10", "sqrt(144)", "15% of 80" (no eval: its own little parser)
  function calc(input) {
    let s = clean(input).toLowerCase().replace(/^(what is|what's|calculate|calc)\s+/, '').replace(/[=?]+$/, '').trim();
    const pct = s.match(/^([\d.]+)\s*%\s*of\s*([\d.]+)$/);
    if (pct) return { expr: s, value: +pct[1] / 100 * +pct[2] };
    s = s.replace(/×|x(?=\s*[\d(])/g, '*').replace(/÷/g, '/').replace(/\bpi\b|π/g, 'p').replace(/\*\*/g, '^');
    if (!/^[\d\s.+\-*/^%()pe,a-z]+$/.test(s) || !/\d|p/.test(s) || !/[+\-*/^%(]|sqrt|sin|cos|tan|log|ln|abs/.test(s)) return null;
    if (/^\d+\s*[-/]\s*\d+(\s*[-/]\s*\d+)?$/.test(s) && !/\s/.test(s) && /-/.test(s)) return null;   // looks like a date or a range ("9-11", "2024-2025")
    const FN = { sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log10, ln: Math.log, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil };
    let i = 0;
    const peek = () => { while (s[i] === ' ') i++; return s[i]; };
    function num() {
      const c = peek();
      if (c === '(') { i++; const v = add(); if (peek() !== ')') throw 0; i++; return v; }
      if (c === '-') { i++; return -pow(); }
      if (c === '+') { i++; return pow(); }
      if (c === 'p') { i++; return Math.PI; }
      const f = s.slice(i).match(/^(sqrt|sin|cos|tan|log|ln|abs|round|floor|ceil)/);
      if (f) { i += f[1].length; return FN[f[1]](num()); }
      if (c === 'e' && !/^e\d/.test(s.slice(i))) { i++; return Math.E; }
      const m = s.slice(i).match(/^\d+(\.\d+)?|^\.\d+/);
      if (!m) throw 0;
      i += m[0].length;
      return parseFloat(m[0]);
    }
    function pow() { let v = num(); if (peek() === '%') { i++; v /= 100; } if (peek() === '^') { i++; v = Math.pow(v, pow()); } return v; }
    function mul() { let v = pow(); for (;;) { const c = peek(); if (c === '*') { i++; v *= pow(); } else if (c === '/') { i++; v /= pow(); } else if (c === '(' || c === 'p' || /\d/.test(c || '')) { v *= pow(); } else return v; } }
    function add() { let v = mul(); for (;;) { const c = peek(); if (c === '+') { i++; v += mul(); } else if (c === '-') { i++; v -= mul(); } else return v; } }
    try {
      s = s.replace(/,/g, '');
      const v = add();
      if (peek() !== undefined || !isFinite(v)) return null;
      return { expr: clean(input).replace(/[=?]+$/, ''), value: v };
    } catch (e) { return null; }
  }
  function fmtNum(v) {
    if (Math.abs(v) >= 1e15 || (Math.abs(v) < 1e-6 && v !== 0)) return v.toExponential(6).replace(/\.?0+e/, 'e');
    return (+v.toPrecision(12)).toLocaleString('en-US', { maximumFractionDigits: 10 });
  }

  // ---------- the engine ----------
  // get(url, { method, body, headers, json, xml, direct }) → Promise of the page's text (or JSON);
  // `direct` means the site allows being read straight from the page (Wikipedia), so the proxy isn't needed
  function Engine(get, opts) {
    this.get = get;
    this.opts = Object.assign({ safe: 'strict' }, opts || {});
    this.state = { q: null };   // what each source needs to remember between pages of the same search
  }
  Engine.WEB = WEB;
  Engine.SOURCES = SOURCES;
  Engine.rank = rank;
  Engine.calc = calc;
  Engine.fmtNum = fmtNum;
  Engine.keyOf = keyOf;
  Engine.hostOf = hostOf;

  Engine.prototype.fetchText = function (url, o) {
    return withTimeout(Promise.resolve(this.get(url, o || {})), TIMEOUT_MS, hostOf(url));
  };

  // Web results: { results, sources: [{ id, name, ok, count, error }], ms }
  Engine.prototype.web = async function (q, page) {
    const t0 = Date.now();
    page = page || 1;
    const key = q + '\n' + this.opts.safe;
    if (this.state.q !== key) this.state = { q: key };   // a new search starts from scratch
    const runs = WEB.map(async s => {
      const src = SOURCES[s.id], st = this.state[s.id] || (this.state[s.id] = {});
      try {
        const req = src.request(q, page, this.opts.safe, st);
        const html = await this.fetchText(req.url, { method: req.method, body: req.body, headers: Object.assign({ 'Accept-Language': 'en-US,en;q=0.9' }, req.headers) });
        const items = src.parse(String(html), req.url, st).filter(x => okUrl(x.url) && x.title);
        return { id: s.id, name: s.name, ok: true, count: items.length, items };
      } catch (e) { return { id: s.id, name: s.name, ok: false, count: 0, items: [], error: String(e && e.message || e) }; }
    });
    const done = await Promise.all(runs);
    const results = rank(done.filter(d => d.ok).map(d => ({ src: d.id, items: d.items })), q);
    return { results, sources: done.map(({ items, ...d }) => d), ms: Date.now() - t0 };
  };

  // Images (from Bing images; Wikimedia Commons when that doesn't work): [{ thumb, full, title, page, w, h }]
  Engine.prototype.images = async function (q, page) {
    page = page || 1;
    const safe = SAFE.bing[this.opts.safe];
    try {
      const url = `https://www.bing.com/images/async?q=${enc(q)}&mmasync=1&first=${(page - 1) * 35 + 1}&count=35&setlang=en&adlt=${safe}`;
      const doc = parseHTML(String(await this.fetchText(url, { headers: { Cookie: 'SRCHHPGUSR=ADLT=' + safe.toUpperCase() } })));
      const out = [];
      for (const a of doc.querySelectorAll('a.iusc')) {
        let m = null;
        try { m = JSON.parse(a.getAttribute('m') || ''); } catch (e) {}
        if (!m || !okUrl(m.turl || m.murl)) continue;
        const li = a.closest('li') || a.parentElement;
        const cap = li && li.querySelector('.infnmpt a');
        const title = clean((cap && (cap.textContent || cap.getAttribute('title'))) || m.t || m.desc || '');
        out.push({ thumb: m.turl || m.murl, full: m.murl || m.turl, title, page: okUrl(m.purl) ? m.purl : m.murl });
      }
      if (out.length) return out;
    } catch (e) { /* try Wikimedia Commons */ }
    const api = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=40&gsroffset=${(page - 1) * 40}&gsrsearch=${enc(q)}&prop=imageinfo&iiprop=url&iiurlwidth=320&format=json&origin=*`;
    const j = await this.fetchText(api, { json: true, direct: true });
    const pages = (j && j.query && j.query.pages) ? Object.values(j.query.pages) : [];
    return pages.sort((a, b) => a.index - b.index).map(p => {
      const ii = (p.imageinfo || [])[0] || {};
      return { thumb: ii.thumburl || ii.url, full: ii.url, title: clean((p.title || '').replace(/^File:/, '').replace(/\.\w+$/, '')), page: ii.descriptionurl || ii.url };
    }).filter(x => okUrl(x.thumb));
  };

  // Videos (YouTube's own search results page): [{ id, url, title, channel, length, views, when, thumb }]
  Engine.prototype.videos = async function (q) {
    const url = `https://www.youtube.com/results?search_query=${enc(q)}&sp=EgIQAQ%253D%253D&hl=en&gl=US`;
    const headers = { 'Accept-Language': 'en-US,en;q=0.9' };
    headers.Cookie = 'CONSENT=YES+' + (this.opts.safe === 'strict' ? '; PREF=f2=8000000' : '');   // (Europe's cookie question; PREF is YouTube's Restricted Mode)
    const html = String(await this.fetchText(url, { headers }));
    const m = html.match(/ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s);
    if (!m) throw new Error('YouTube sent no results');
    let data;
    try { data = JSON.parse(m[1]); } catch (e) { throw new Error('YouTube\'s results couldn\'t be read'); }
    const out = [];
    const runs = x => x ? (x.simpleText || (x.runs || []).map(r => r.text).join('')) : '';
    (function walk(o, depth) {
      if (!o || typeof o !== 'object' || depth > 30 || out.length >= 40) return;
      if (o.videoRenderer && o.videoRenderer.videoId) {
        const v = o.videoRenderer;
        out.push({
          id: v.videoId, url: 'https://www.youtube.com/watch?v=' + v.videoId, title: runs(v.title), channel: runs(v.ownerText || v.longBylineText),
          length: runs(v.lengthText), views: runs(v.shortViewCountText || v.viewCountText), when: runs(v.publishedTimeText),
          thumb: 'https://i.ytimg.com/vi/' + v.videoId + '/mqdefault.jpg'
        });
        return;
      }
      for (const k in o) walk(o[k], depth + 1);
    })(data, 0);
    return out;
  };

  // News (Bing News; Google News when that doesn't work): [{ url, title, snippet, source, when }]
  Engine.prototype.news = async function (q) {
    const items = (xml, linkOf) => {
      const doc = new DOMParser().parseFromString(String(xml), 'text/xml');
      return [...doc.querySelectorAll('item')].map(it => {
        const g = tag => { const e = it.getElementsByTagName(tag)[0]; return e ? clean(e.textContent) : ''; };
        const src = it.getElementsByTagName('News:Source')[0] || it.getElementsByTagName('source')[0];
        const desc = clean(g('description').replace(/<[^>]+>/g, ' '));
        return { url: linkOf(g('link')), title: g('title'), snippet: desc, source: src ? clean(src.textContent) : '', when: g('pubDate') };
      }).filter(x => okUrl(x.url) && x.title);
    };
    try {
      const doc = parseHTML(String(await this.fetchText(`https://www.bing.com/news/infinitescrollajax?q=${enc(q)}&InfiniteScroll=1&first=1&SFX=0&form=PTFTNR&setlang=en`)));
      const out = [];
      for (const it of doc.querySelectorAll('div.newsitem, div.news-card')) {
        const a = it.querySelector('a.title');
        if (!a || !okUrl(a.getAttribute('href'))) continue;
        const src = it.querySelector('.source');
        const age = src && src.querySelector('span[aria-label]');
        out.push({ url: a.getAttribute('href'), title: text(a), snippet: text(it.querySelector('.snippet')), source: clean(a.getAttribute('data-author') || it.getAttribute('data-author') || (src && src.querySelector('a') ? text(src.querySelector('a')) : '')), when: age ? clean(age.getAttribute('aria-label')) : '' });
      }
      if (out.length) return out;
    } catch (e) { /* try the RSS feed */ }
    try {
      const xml = await this.fetchText(`https://www.bing.com/news/search?q=${enc(q)}&format=rss&setlang=en`, { xml: true });
      const out = items(xml, l => { try { const x = new URL(l); return x.searchParams.get('url') || l; } catch (e) { return l; } });
      if (out.length) return out;
    } catch (e) { /* try Google News */ }
    const xml = await this.fetchText(`https://news.google.com/rss/search?q=${enc(q)}&hl=en-US&gl=US&ceid=US:en`, { xml: true });
    return items(xml, l => l).map(x => Object.assign(x, { title: x.source ? x.title.replace(new RegExp('\\s+-\\s+' + x.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), '') : x.title }));
  };

  // A Wikipedia summary when an article clearly matches: { title, text, thumb, url, description }
  Engine.prototype.wiki = async function (q) {
    const s = await this.fetchText(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${enc(q)}&srlimit=3&format=json&origin=*`, { json: true, direct: true });
    const hits = (s && s.query && s.query.search) || [];
    const norm = x => clean(x).toLowerCase().replace(/[^a-z0-9 ]/g, '');
    const nq = norm(q).replace(/^(who|what) (is|are|was|were) (the |a |an )?/, '');
    const hit = hits.find(h => { const t = norm(h.title); return t === nq || t.replace(/ \(.*\)$/, '') === nq || (nq.length > 3 && t.startsWith(nq)); });
    if (!hit) return null;
    const sum = await this.fetchText('https://en.wikipedia.org/api/rest_v1/page/summary/' + enc(hit.title.replace(/ /g, '_')), { json: true, direct: true });
    if (!sum || sum.type === 'disambiguation' || !sum.extract) return null;
    return { title: sum.title, text: sum.extract, description: sum.description || '', thumb: sum.thumbnail && sum.thumbnail.source, url: (sum.content_urls && sum.content_urls.desktop && sum.content_urls.desktop.page) || ('https://en.wikipedia.org/wiki/' + enc(hit.title)) };
  };

  // Plain Wikipedia search results (used when the web search engines can't be reached)
  Engine.prototype.wikiList = async function (q) {
    const s = await this.fetchText(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${enc(q)}&srlimit=10&format=json&origin=*`, { json: true, direct: true });
    return ((s && s.query && s.query.search) || []).map(h => ({
      url: 'https://en.wikipedia.org/wiki/' + enc(h.title.replace(/ /g, '_')), title: h.title, host: 'en.wikipedia.org', from: ['wikipedia'],
      snippet: clean(String(h.snippet || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'"))
    }));
  };

  // Word definitions for "define …", "… meaning": { word, phonetic, meanings: [{ part, defs: [..] }] }
  Engine.wantsDefinition = q => {
    const m = clean(q).toLowerCase().match(/^(?:define|definition of|meaning of|what does ([a-z-]+) mean)\s*([a-z-]+)?$|^([a-z-]+)\s+(?:meaning|definition|define)$/);
    return m ? (m[1] || m[2] || m[3] || null) : null;
  };
  Engine.prototype.define = async function (word) {
    const j = await this.fetchText('https://api.dictionaryapi.dev/api/v2/entries/en/' + enc(word), { json: true, direct: true });
    const e = Array.isArray(j) && j[0];
    if (!e) return null;
    return {
      word: e.word, phonetic: e.phonetic || ((e.phonetics || []).find(p => p.text) || {}).text || '',
      meanings: (e.meanings || []).slice(0, 3).map(m => ({ part: m.partOfSpeech, defs: (m.definitions || []).slice(0, 2).map(d => d.definition) }))
    };
  };

  // Suggestions while typing (DuckDuckGo's, or Wikipedia's titles)
  Engine.prototype.suggest = async function (q) {
    try {
      const j = await this.fetchText(`https://duckduckgo.com/ac/?q=${enc(q)}&type=list&kl=us-en`, { json: true });
      if (Array.isArray(j) && Array.isArray(j[1])) return j[1].slice(0, 8);
    } catch (e) { /* Wikipedia below */ }
    const j = await this.fetchText(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${enc(q)}&limit=8&namespace=0&format=json&origin=*`, { json: true, direct: true });
    return Array.isArray(j) && Array.isArray(j[1]) ? j[1] : [];
  };

  root.SeekEngine = Engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
