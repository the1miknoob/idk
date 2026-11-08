// Study Buddy's brain: looks a topic up on Wikipedia and turns the article into notes, flashcards and quiz questions.
// No AI and no server: it reads the article, scores every sentence by how much it says about the topic, finds the key terms
// (the articles it links to that it talks about most) and their one-line definitions, and blanks out terms, years and names to ask about.
// Works in the browser (window.StudyBrain) and in Node (for tests): research() takes the fetch function to use.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StudyBrain = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- Wikipedia ----------
  const HOST = { en: 'en.wikipedia.org', simple: 'simple.wikipedia.org' };
  async function wiki(lang, params, fetchFn) {
    const url = `https://${HOST[lang] || HOST.en}/w/api.php?` + new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });
    const r = await fetchFn(url);
    if (!r.ok) throw new Error(`Wikipedia answered ${r.status}`);
    return r.json();
  }
  async function search(q, lang, fetchFn, limit = 8) {   // the best-matching articles (and a spelling suggestion)
    const j = await wiki(lang, { action: 'query', list: 'search', srsearch: q, srlimit: limit, srinfo: 'suggestion', srprop: 'snippet' }, fetchFn);
    return { results: ((j.query && j.query.search) || []).map(r => ({ title: r.title, snippet: stripTags(r.snippet || '') })), suggestion: j.query && j.query.searchinfo && j.query.searchinfo.suggestion };
  }
  async function suggest(q, lang, fetchFn) {   // titles as you type
    const j = await wiki(lang, { action: 'opensearch', search: q, limit: 8, namespace: 0 }, fetchFn);
    return Array.isArray(j) && Array.isArray(j[1]) ? j[1] : [];
  }
  async function article(title, lang, fetchFn) {
    const j = await wiki(lang, { action: 'query', prop: 'extracts|pageimages|description|pageprops|info', titles: title, redirects: 1, explaintext: 1, exsectionformat: 'wiki',
      piprop: 'thumbnail', pithumbsize: 480, ppprop: 'disambiguation', inprop: 'url' }, fetchFn);
    const p = j.query && j.query.pages && j.query.pages[0];
    if (!p || p.missing || p.invalid) return null;
    return { title: p.title, text: p.extract || '', description: p.description || '', image: p.thumbnail ? p.thumbnail.source : '', url: p.fullurl || `https://${HOST[lang]}/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
      disambiguation: !!(p.pageprops && 'disambiguation' in p.pageprops) };
  }
  async function links(title, lang, fetchFn) {   // every article this one links to
    const out = []; let cont = {};
    for (let k = 0; k < 3; k++) {
      const j = await wiki(lang, { action: 'query', prop: 'links', titles: title, redirects: 1, plnamespace: 0, pllimit: 'max', ...cont }, fetchFn);
      const p = j.query && j.query.pages && j.query.pages[0];
      if (p && p.links) out.push(...p.links.map(l => l.title));
      if (!j.continue || !j.continue.plcontinue) break;
      cont = { plcontinue: j.continue.plcontinue };
    }
    return out;
  }
  async function definitions(titles, lang, fetchFn) {   // a short description and the first two sentences of each (20 at a time)
    const out = {};
    for (let i = 0; i < titles.length; i += 20) {
      const batch = titles.slice(i, i + 20);
      const j = await wiki(lang, { action: 'query', prop: 'extracts|description|pageprops', titles: batch.join('|'), redirects: 1, exintro: 1, explaintext: 1, exsentences: 2, exlimit: 20, ppprop: 'disambiguation' }, fetchFn);
      const q = j.query || {}, to = {};
      for (const n of q.normalized || []) to[n.from] = n.to;
      for (const r of q.redirects || []) to[r.from] = r.to;
      const pages = {}; for (const p of q.pages || []) pages[p.title] = p;
      for (const t of batch) {
        let name = t; for (let k = 0; k < 3 && to[name]; k++) name = to[name];
        const p = pages[name];
        if (!p || p.missing || (p.pageprops && 'disambiguation' in p.pageprops)) continue;
        out[t] = { title: p.title, description: p.description || '', extract: p.extract || '' };
      }
    }
    return out;
  }

  // ---------- cleaning up the text ----------
  const stripTags = s => String(s).replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  // Math in plain-text articles comes as {\displaystyle …} LaTeX: turn the common bits into readable text (a/b, x², √x, π…)
  function latex(s) {
    const out = []; let i = 0;
    while (i < s.length) {
      const k = s.indexOf('{\\displaystyle', i);
      if (k < 0) { out.push(s.slice(i)); break; }
      out.push(s.slice(i, k));
      let d = 0, j = k;
      for (; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}' && --d === 0) break; }
      out.push(texToText(s.slice(k + 14, j)));
      i = j + 1;
    }
    return out.join('');
  }
  const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', n: 'ⁿ', '-': '⁻', '+': '⁺' };
  const TEX = { pm: '±', mp: '∓', times: '×', cdot: '·', div: '÷', pi: 'π', theta: 'θ', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', lambda: 'λ', mu: 'μ', sigma: 'σ', Sigma: 'Σ', omega: 'ω', Omega: 'Ω', phi: 'φ', infty: '∞',
    leq: '≤', geq: '≥', le: '≤', ge: '≥', neq: '≠', ne: '≠', approx: '≈', to: '→', rightarrow: '→', in: '∈', sum: 'Σ', int: '∫', partial: '∂', ldots: '…', cdots: '…', circ: '°', angle: '∠', triangle: '△', equiv: '≡', propto: '∝' };
  const wrap = x => (/^[\w.²³ⁿ]+$/.test(x.trim()) ? x.trim() : `(${x.trim()})`);   // brackets only where they're needed
  function texToText(t) {
    let s = t.replace(/\\(?:mathrm|mathbf|mathit|text|textbf|operatorname|left|right|big|Big)\b/g, '');
    for (let k = 0, was = ''; k < 8 && was !== s; k++) {   // innermost first, until nothing changes
      was = s;
      s = s.replace(/\^\{([^{}]{1,4})\}|\^([0-9n+-])/g, (m, a, b) => { const x = a != null ? a : b; return [...x].every(c => SUP[c]) ? [...x].map(c => SUP[c]).join('') : '^(' + x + ')'; })
        .replace(/_\{([^{}]*)\}/g, '$1').replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (m, a, b) => `${wrap(a)}/${wrap(b)} `).replace(/\\sqrt\s*\{([^{}]*)\}/g, (m, a) => '√' + wrap(a))
        .replace(/(?<!(?:frac|sqrt)\s*|\}\s*)\{([^{}]*)\}/g, '$1');   // (plain brackets, but not a fraction's or root's own)
    }
    s = s.replace(/\\([A-Za-z]+)/g, (m, w) => TEX[w] != null ? TEX[w] : '');
    return s.replace(/[{}]/g, '').replace(/\\[,;:! ]/g, ' ').replace(/\s+/g, ' ').replace(/([±√]) /g, '$1').trim();
  }
  function clean(text) {
    return latex(text)
      .replace(/\(\s*(?:[^()]*[ˈˌəɪʊæɒʌɛɔː][^()]*|listen|[;,\s]*)\)/g, '')   // pronunciations and empty brackets
      .replace(/\(\s*[;,]\s*/g, '(').replace(/\s*[;,]\s*\)/g, ')')
      .replace(/[ \t]{2,}/g, ' ').replace(/ ([,.;:])/g, '$1');
  }
  const SKIP = /^(see also|references|notes|external links|further reading|bibliography|sources|citations|gallery|footnotes|works cited|explanatory notes|notes and references|references and notes|literature|external sources)$/i;
  function sections(text) {   // the lead, then each section (== Heading ==), without the reference lists at the end (or their sub-sections)
    const out = [{ title: 'Introduction', level: 1, text: [] }];
    let skipping = false;
    for (const line of clean(text).split('\n')) {
      const h = line.match(/^(={2,6})\s*(.+?)\s*\1\s*$/);
      if (h) {
        const level = h[1].length - 1;
        if (level === 1 || !skipping) skipping = SKIP.test(h[2]);
        if (!skipping) out.push({ title: h[2], level, text: [] });
      } else if (line.trim() && !skipping) out[out.length - 1].text.push(line.trim());
    }
    return out.map(s => ({ ...s, text: s.text.join('\n') })).filter((s, k, a) => k === 0 || s.text.length > 40 || (a[k + 1] && a[k + 1].level > s.level));
  }
  // Sentences: careful with "e.g.", "U.S.", "c. 1500", "J. R. R. Tolkien" and decimals
  const ABBR = ['e.g.', 'i.e.', 'etc.', 'vs.', 'Mr.', 'Mrs.', 'Ms.', 'Dr.', 'St.', 'Jr.', 'Sr.', 'U.S.', 'U.K.', 'U.N.', 'c.', 'ca.', 'approx.', 'No.', 'Nos.', 'Fig.', 'Mt.', 'Ft.', 'Inc.', 'Ltd.', 'Co.', 'Corp.', 'Gen.', 'Col.', 'Lt.', 'Capt.', 'Sgt.', 'Prof.', 'Rev.', 'Gov.', 'Pres.', 'Sen.', 'Rep.', 'a.m.', 'p.m.', 'B.C.', 'A.D.', 'al.', 'cf.', 'viz.', 'ed.', 'vol.', 'pp.', 'p.', 'Jan.', 'Feb.', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
  const ABBR_RE = new RegExp('(^|[\\s(])(' + ABBR.map(a => a.replace(/\./g, '\\.')).join('|') + ')', 'g');
  function sentences(par) {
    const s = par.replace(ABBR_RE, (m, a, b) => a + b.replace(/\./g, '\u0000'))
      .replace(/(^|\s)([A-Z])\.(?=(\s?[A-Z]\.)|\s[A-Z])/g, (m, sp, L, nextInitial, off, str) => {
        const prev = str.slice(0, off).match(/(\S+)$/);
        return nextInitial || !prev || /^[A-Z]/.test(prev[1]) ? sp + L + '\u0000' : m;
      });
    return s.split(/(?<=[.!?]["”’)]?)\s+(?=["“(]?[A-Z0-9])/).map(x => x.replace(/\u0000/g, '.').trim()).filter(x => x.length > 2);
  }
  const STOP = new Set(('a about above after again against all also although am among an and any are around as at be because been before being below between both but by can could did do does doing down during each either else ever few '
    + 'for from further had has have having he her here hers herself him himself his how however i if in into is it its itself just known later like made make many may me might more most much must my no nor not now of off often on once one only or other '
    + 'our ours out over own per same several she should since so some such than that the their theirs them themselves then there these they this those though through thus to too two under until up upon us used using very was we were what when '
    + 'where whether which while who whom whose why will with within without would yet you your called including include includes became become well first second new three part various another until whereas especially'). split(' '));
  const words = s => (s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[a-z][a-z'-]+|\d+/g) || []);
  const content = s => words(s).filter(w => w.length > 2 && !STOP.has(w));
  const PRONOUN = /^(It|Its|This|These|That|Those|They|Their|He|She|His|Her|However|But|Also|Thus|Therefore|Such|Both|Another|Other|In addition|Furthermore|Moreover|Here|There)\b/;
  const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';

  // ---------- reading the article ----------
  function read(art) {
    const secs = sections(art.text), all = [];
    secs.forEach((sec, si) => sec.text.split('\n').forEach((par, pi) => sentences(par).forEach((t, k) => all.push({ t, si, pi, k, sec: sec.title, lead: si === 0 }))));
    // how important each word is: often used here, and in the title
    const freq = new Map(), title = new Set(content(art.title));
    for (const s of all) for (const w of new Set(content(s.t))) freq.set(w, (freq.get(w) || 0) + 1);
    const top = Math.max(1, ...freq.values());
    all.forEach((s, i) => {
      const ws = content(s.t), n = words(s.t).length;
      let sc = ws.reduce((a, w) => a + (title.has(w) ? 2.2 : 0) + Math.log(1 + (freq.get(w) || 0)) / Math.log(1 + top), 0) / Math.sqrt(Math.max(6, ws.length));
      if (s.lead) sc += 1.2 - Math.min(0.9, s.k * 0.12);
      if (s.k === 0 && s.pi === 0) sc += 0.35;   // a section's first sentence says what it's about
      if (PRONOUN.test(s.t) && !(s.lead && s.k === 0)) sc -= 0.55;
      if (n < 7) sc -= 1.2; else if (n > 48) sc -= 0.9; else if (n > 36) sc -= 0.35;
      if (/[:;]\s*$|^\W|\?$/.test(s.t) || (s.t.match(/"/g) || []).length > 2) sc -= 0.6;
      if (/[=√∫Σ±×÷^²³]/.test(s.t) && (s.t.match(/[=√∫Σ±×÷^²³+]/g) || []).length > 3) sc -= 0.8;   // mostly a formula
      s.score = sc; s.i = i; s.n = n;
    });
    return { secs, all, freq, title };
  }
  // the article's lead often starts "It is…" in later sentences: say what "it" is
  const named = (t, title) => t.replace(/^It (is|was|has|had|can|uses|makes|occurs|includes) /, `${title.replace(/\s*\(.*\)$/, '')} $1 `);

  // ---------- key terms: the linked articles it talks about most, with their one-line definitions ----------
  const JUNK = /^(List of|Lists of|Index of|Outline of|Timeline of|Glossary of|Category:|Template:|ISBN|Doi|PMID|JSTOR|S2CID|Bibcode|OCLC|ArXiv|ISSN|Wayback Machine)|\((identifier|disambiguation)\)$/i;
  const DATEISH = new RegExp(`^(\\d+(s| BC| BCE| AD| CE)?|\\d+(st|nd|rd|th) century( BC)?|(${MONTHS})( \\d+)?|\\d+ (${MONTHS})|Common Era|Anno Domini)$`, 'i');
  function candidates(art, R, linkTitles, max = 30) {
    const text = R.all.map(s => s.t).join(' '), lower = text.toLowerCase(), lead = R.all.filter(s => s.lead).map(s => s.t).join(' ').toLowerCase();
    const self = art.title.toLowerCase().replace(/\s*\(.*\)$/, '');
    const seen = new Set(), out = [];
    for (const L of linkTitles) {
      if (JUNK.test(L) || DATEISH.test(L)) continue;
      const name = L.replace(/\s*\([^)]*\)$/, '').trim(), key = name.toLowerCase();
      if (!name || seen.has(key) || key === self || name.length < 3 || name.length > 48) continue;
      seen.add(key);
      const re = new RegExp(`(^|[^a-z0-9])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(e?s)?(?=$|[^a-z0-9])`, 'g');
      const count = (lower.match(re) || []).length;
      if (!count) continue;
      const inLead = re.test(lead); re.lastIndex = 0;
      const score = Math.min(count, 8) + (inLead ? 4 : 0) + (name.includes(' ') ? 0.5 : 0) - (STOP.has(key) ? 3 : 0);
      out.push({ link: L, name, count, score });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, max);
  }
  const mask = (text, name) => text.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(e?s)?\\b`, 'gi'), '___');
  const GENERIC = /^(Wikimedia|topics referred to|disambiguation|human settlement|Wikipedia list|family name|given name)/i;
  function terms(cands, defs, art) {
    const out = [];
    for (const c of cands) {
      const d = defs[c.link]; if (!d) continue;
      const more = (sentences(clean(d.extract).split('\n')[0] || '')[0] || '').trim();   // its first sentence, for "more"
      let def = d.description && d.description.split(' ').length >= 3 && !GENERIC.test(d.description) ? d.description : '';
      if (!def) def = more.replace(/^.*?\b(is|are|was|were)\s+(an?|the)?\s*/i, '').replace(/\.$/, '');   // or what the first sentence says it is
      if (!def || def.split(' ').length < 2) continue;
      def = def.charAt(0).toUpperCase() + def.slice(1);
      const masked = mask(def, c.name);
      if ((masked.match(/___/g) || []).length > 1 || masked.replace(/___/g, '').trim().length < 8) continue;
      out.push({ term: c.name, def, more: more && more !== def ? more : '', masked, link: d.title, lc: c.name !== c.name.toLowerCase() && new RegExp(`(^|[^A-Za-z])${c.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(art.text) });
    }
    // the topic itself comes first
    if (art.description && art.description.split(' ').length >= 2 && !GENERIC.test(art.description)) {
      const name = art.title.replace(/\s*\(.*\)$/, '');
      out.unshift({ term: name, def: art.description.charAt(0).toUpperCase() + art.description.slice(1), more: '', masked: mask(art.description, name), link: art.title, main: true });
    }
    return out;
  }

  // ---------- blanks: terms, years, names and numbers to ask about ----------
  const YEAR = /\b(?:(?:c\.|circa|around)\s)?(\d{1,4}\s?(?:BC|BCE|AD|CE)|1[0-9]{3}|20[0-9]{2})\b/;
  const NUMBER = /\b\d[\d,]*(?:\.\d+)?\s?(?:%|percent|per cent|million|billion|trillion|thousand|hundred|km|kilometres|kilometers|miles|metres|meters|m|cm|mm|kg|grams|tonnes|tons|°C|°F|degrees|years|days|hours|minutes|seconds|people|species|countries|times)\b/;
  function properNouns(t) {   // capitalised names not at the start of the sentence (Louis XVI, Paris, the Calvin cycle…)
    const out = [], re = /(?:^|[^.!?]\s)((?:[A-Z][a-zà-ÿ'’-]+|[A-Z]{2,}|XVI|XIV|XV|XIII|II|III|IV|VI|VII|VIII|IX|XI|XII)(?:\s(?:of|the|de|von|van|da|del|du|la|le)?\s?(?:[A-Z][a-zà-ÿ'’-]+|[A-Z]{2,}|[IVX]{1,5})){0,3})/g;
    let m;
    while ((m = re.exec(t))) {
      const p = m[1].trim().replace(/\s(of|the|de|von|van|da|del|du|la|le)$/, '');
      if (m.index === 0 && t.indexOf(p) === 0) continue;
      if (new RegExp(`^(${MONTHS}|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|The|A|An|In|On|At|By|It|This|However|During|After|Before|When|While|Since|Although)$`).test(p)) continue;
      if (p.length > 2) out.push(p);
    }
    return out;
  }
  function blanks(R, T, art, max = 40) {
    const termNames = T.map(t => t.term).sort((a, b) => b.length - a.length);
    const self = art.title.replace(/\s*\(.*\)$/, '');
    const facts = [];
    const pool = R.all.filter(s => s.n >= 7 && s.n <= 42 && !/^\W/.test(s.t)).slice().sort((a, b) => b.score - a.score);
    const perSec = new Map();
    for (const s of pool) {
      if (facts.length >= max) break;
      if ((perSec.get(s.si) || 0) >= 5) continue;
      const t = named(s.t, art.title), opts = [];
      for (const n of termNames) {
        if (n.toLowerCase() === self.toLowerCase()) continue;
        const m = t.match(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(e?s)?\\b`, 'i'));
        if (m && m.index > 0) { opts.push({ type: 'term', answer: m[0], at: m.index, w: 3 }); break; }
      }
      const y = t.match(YEAR); if (y) opts.push({ type: 'year', answer: y[1], at: y.index + y[0].indexOf(y[1]), w: 2.6 });
      const pn = properNouns(t).filter(p => { const q = p.toLowerCase(); return q !== self.toLowerCase() && !self.toLowerCase().includes(q) && !termNames.some(n => n.toLowerCase() !== q && n.toLowerCase().includes(q) && t.toLowerCase().includes(n.toLowerCase())); });
      if (pn.length) { const p = pn.sort((a, b) => b.length - a.length)[0]; opts.push({ type: 'name', answer: p, at: t.indexOf(p), w: 2 }); }
      const nu = t.match(NUMBER); if (nu && !(y && nu[0].includes(y[1]))) opts.push({ type: 'number', answer: nu[0], at: nu.index, w: 1.6 });
      if (!opts.length) continue;
      opts.sort((a, b) => b.w - a.w || a.at - b.at);
      const alt = opts.find((o, k) => k > 0 && !opts[0].answer.toLowerCase().includes(o.answer.toLowerCase()) && !o.answer.toLowerCase().includes(opts[0].answer.toLowerCase()));
      const pick = s.i % 3 === 2 && alt ? alt : opts[0];   // (now and then a year or a name instead, for variety)
      const at = t.indexOf(pick.answer, Math.max(0, pick.at - 1));
      if (at < 0) continue;
      facts.push({ id: 'f' + s.i, text: t, answer: pick.answer, type: pick.type, before: t.slice(0, at), after: t.slice(at + pick.answer.length), sec: s.sec, score: s.score, i: s.i });
      perSec.set(s.si, (perSec.get(s.si) || 0) + 1);
    }
    return facts.sort((a, b) => a.i - b.i);
  }

  // ---------- notes ----------
  function notes(art, R, T, F) {
    const lead = R.all.filter(s => s.lead);
    const summary = lead.slice(0, 4).map(s => named(s.t, art.title));
    const used = new Set(lead.slice(0, 4).map(s => s.i));
    const keyFacts = R.all.filter(s => !used.has(s.i) && s.n >= 7 && s.n <= 40).sort((a, b) => b.score - a.score).slice(0, 8).sort((a, b) => a.i - b.i).map(s => named(s.t, art.title));
    const parent = []; let cur = 0;   // each sub-section belongs to the main section above it
    R.secs.forEach((s, i) => { if (s.level === 1) cur = i; parent[i] = cur; });
    const outline = R.secs.map((sec, si) => ({ sec, si })).filter(x => x.si > 0 && x.sec.level === 1).slice(0, 10).map(({ sec, si }) => ({
      title: sec.title,
      points: R.all.filter(s => parent[s.si] === si && s.n >= 6 && s.n <= 40).sort((a, b) => b.score - a.score).slice(0, 3).sort((a, b) => a.i - b.i).map(s => s.t),
    })).filter(s => s.points.length);
    // a timeline when the article is full of dates
    const seenY = new Set(), timeline = [];
    for (const s of R.all.slice().sort((a, b) => b.score - a.score)) {
      const m = s.t.match(YEAR); if (!m || s.n > 40 || s.n < 6) continue;
      const y = m[1], v = /BC/.test(y) ? -parseInt(y, 10) : parseInt(y, 10);
      if (seenY.has(v) || timeline.length >= 14) continue;
      seenY.add(v);
      const short = s.t.replace(new RegExp(`^(In|On|By|During|Around|Since|From|Until|After|Before)\\s[^,]{0,25}?\\b${y}\\b,?\\s+`), '');   // (the year is already beside it)
      timeline.push({ year: y, v, text: short !== s.t && short.split(' ').length >= 5 ? short.charAt(0).toUpperCase() + short.slice(1) : s.t });
    }
    timeline.sort((a, b) => a.v - b.v);
    return { summary, keyFacts, outline, timeline: timeline.length >= 4 ? timeline : [], glossary: T.slice(0, 16) };
  }

  // ---------- everything at once ----------
  async function research(query, opts = {}) {
    const fetchFn = opts.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null), step = opts.onStep || (() => {});
    let lang = opts.lang === 'simple' ? 'simple' : 'en';
    step('search');
    let found = await search(query, lang, fetchFn);
    if (!found.results.length && found.suggestion) found = await search(found.suggestion, lang, fetchFn);
    if (!found.results.length && lang === 'simple') { lang = 'en'; found = await search(query, lang, fetchFn); }
    if (!found.results.length) return { notFound: true, query };
    const pick = opts.title || found.results[0].title;
    step('read');
    let art = await article(pick, lang, fetchFn);
    if (!art) return { notFound: true, query };
    if (art.disambiguation) return { choose: true, query, options: found.results.filter(r => r.title !== art.title).slice(0, 8), lang };
    const R = read(art);
    step('terms');
    const linked = await links(art.title, lang, fetchFn);
    const cands = candidates(art, R, linked);
    const defs = cands.length ? await definitions(cands.map(c => c.link), lang, fetchFn) : {};
    const T = terms(cands, defs, art);
    step('facts');
    const F = blanks(R, T, art);
    const N = notes(art, R, T, F);
    step('done');
    return {
      v: 1, query, lang, title: art.title, description: art.description, image: art.image, url: art.url, made: Date.now(),
      others: found.results.filter(r => r.title !== art.title).slice(0, 6),
      notes: N, terms: T, facts: F,
      sections: R.secs.map(s => ({ title: s.title, level: s.level, text: s.text })),
      words: R.all.reduce((a, s) => a + s.n, 0),
    };
  }

  // ---------- quizzes ----------
  function rng(seed) { let a = seed >>> 0 || 1; return () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; return (a >>> 0) / 4294967296; }; }
  const shuffle = (arr, r) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const yearVal = y => (/B\.?C/.test(y) ? -1 : 1) * parseInt(y, 10);
  const PERSON = /\(\s*(c\.\s*)?\d{3,4}\s*(BC)?\s*[–-]\s*(c\.\s*)?\d{3,4}\s*(BC)?\s*\)|\b(king|queen|emperor|empress|scientist|chemist|physicist|biologist|philosopher|mathematician|lawyer|leader|president|writer|poet|artist|painter|politician|explorer|general|inventor|pope|prophet|composer|singer|actor|actress)\b/i;
  const PLACE = /\b(city|country|capital|town|village|region|river|mountain|island|province|county|continent|sea|ocean|lake|state in|located)\b/i;
  function similar(t, list, r, n = 3) {   // the terms most like this one (same kind of thing, shared words), with a little chance mixed in
    const tw = new Set(content(t.def)), kind = x => (PERSON.test(x.def) ? 2 : 0) + (PLACE.test(x.def) ? 1 : 0);
    return list.filter(x => x !== t && x.term.toLowerCase() !== t.term.toLowerCase() && !x.term.toLowerCase().includes(t.term.toLowerCase()) && !t.term.toLowerCase().includes(x.term.toLowerCase()))
      .map(x => ({ x, s: (kind(x) === kind(t) ? 3 : 0) + content(x.def).filter(w => tw.has(w)).length * 0.6 + (x.term.includes(' ') === t.term.includes(' ') ? 0.4 : 0) + r() * 1.2 }))
      .sort((a, b) => b.s - a.s).slice(0, n).map(o => o.x);
  }
  const placeish = (text, p) => new RegExp(`\\b(in|at|to|from|across|near|into|of)\\s(the\\s)?${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text);
  function distractors(f, set, r, n = 3) {   // wrong answers of the same kind
    const ans = f.answer.toLowerCase(), uniq = new Set([ans]), out = [];
    const add = x => { const k = String(x).toLowerCase(); if (!uniq.has(k) && String(x).trim()) { uniq.add(k); out.push(String(x)); } };
    if (f.type === 'year') {
      const years = shuffle(set.facts.filter(x => x.type === 'year').map(x => x.answer).concat((set.notes.timeline || []).map(x => x.year)), r);
      const v = yearVal(f.answer), bc = /BC/.test(f.answer);
      for (const y of years) if (out.length < n && Math.abs(yearVal(y) - v) > 0 && /BC/.test(y) === bc) add(y);
      for (const d of shuffle([3, 5, 8, 12, 15, 20, 25, 40, 50, 60, 100], r)) { if (out.length >= n) break; const w = v + (r() < 0.5 ? -d : d); if (w > 0 && w < 2100 && !bc) add(w); else if (bc && w < 0) add(`${-w} BC`); }
    } else if (f.type === 'term') {
      const me = set.terms.find(t => ans === t.term.toLowerCase() || ans.replace(/e?s$/, '') === t.term.toLowerCase()) || { term: f.answer, def: f.text };
      const small = f.answer[0] !== f.answer[0].toUpperCase();
      for (const t of similar(me, set.terms.filter(x => !x.main), r, 8)) if (out.length < n) add(small && t.lc ? t.term.charAt(0).toLowerCase() + t.term.slice(1) : t.term);
    } else if (f.type === 'name') {
      const names = new Map(), place = placeish(f.text, f.answer), words = f.answer.split(' ').length;
      for (const x of set.facts) for (const p of properNouns(x.text)) if (!names.has(p)) names.set(p, placeish(x.text, p));
      for (const t of set.terms) if (/^[A-Z]/.test(t.term) && !names.has(t.term)) names.set(t.term, PLACE.test(t.def));
      const ranked = shuffle([...names.keys()], r).map(p => ({ p, s: (names.get(p) === place ? 2 : 0) + (p.split(' ').length === words ? 1 : 0) + r() })).sort((a, b) => b.s - a.s);
      for (const { p } of ranked) if (out.length < n && !p.toLowerCase().includes(ans) && !ans.includes(p.toLowerCase())) add(p);
    } else {
      const m = f.answer.match(/^([\d,]*\.?\d+)(.*)$/), num = m ? parseFloat(m[1].replace(/,/g, '')) : NaN, unit = m ? m[2] : '';
      for (const k of shuffle([0.5, 2, 1.5, 0.25, 3, 10, 0.1, 0.75], r)) {
        if (out.length >= n || !isFinite(num)) break;
        const v = num * k, txt = Number.isInteger(num) ? Math.round(v).toLocaleString('en-US') : v.toFixed((m[1].split('.')[1] || '').length);
        add((m[1].includes(',') ? txt : txt.replace(/,/g, '')) + unit);
      }
    }
    return out.slice(0, n);
  }
  // kinds: 'mc' (multiple choice), 'tf' (true or false), 'type' (type the answer)
  function quiz(set, opts = {}) {
    const r = rng(opts.seed || Date.now()), n = opts.n || 10, kinds = opts.kinds || ['mc', 'tf', 'type'];
    const qs = [], used = new Set();
    const T = set.terms.filter(t => !t.main), F = set.facts;
    const pool = [];
    for (const t of T) pool.push({ src: 't', t });
    for (const f of F) pool.push({ src: 'f', f });
    for (const item of shuffle(pool, r)) {
      if (qs.length >= n) break;
      const kind = kinds[Math.floor(r() * kinds.length)];
      if (item.src === 't') {
        const t = item.t, others = similar(t, T, r, 3);
        if (others.length < 3 || used.has('t' + t.term)) continue;
        used.add('t' + t.term);
        if (kind === 'type' && t.term.split(' ').length <= 4) qs.push({ kind: 'type', prompt: 'Which word or name matches this?', quote: t.masked, answer: t.term, explain: `${t.term}: ${t.def}` });
        else if (kind === 'tf') {
          const lie = r() < 0.5, other = others[0];
          qs.push({ kind: 'tf', prompt: 'True or false?', quote: `${t.term}: ${lie ? other.def : t.def}`, answer: lie ? 'False' : 'True', options: ['True', 'False'], explain: `${t.term}: ${t.def}` });
        } else if (r() < 0.5) qs.push({ kind: 'mc', prompt: 'Which one matches this?', quote: t.masked, answer: t.term, options: shuffle([t.term, ...others.map(o => o.term)], r), explain: `${t.term}: ${t.def}` });
        else qs.push({ kind: 'mc', prompt: `Which of these describes ${t.term}?`, answer: t.def, options: shuffle([t.def, ...others.map(o => o.def)], r), explain: `${t.term}: ${t.def}` });
      } else {
        const f = item.f;
        if (used.has(f.id)) continue;
        const wrong = distractors(f, set, r);
        if (wrong.length < (kind === 'mc' ? 3 : 1) && kind !== 'type') continue;
        used.add(f.id);
        const blankText = `${f.before}_____${f.after}`;
        if (kind === 'type' && f.answer.split(' ').length <= 4) qs.push({ kind: 'type', prompt: 'Fill in the blank', quote: blankText, answer: f.answer, explain: f.text });
        else if (kind === 'tf' && wrong.length) {
          const lie = r() < 0.5;
          qs.push({ kind: 'tf', prompt: 'True or false?', quote: lie ? `${f.before}${wrong[0]}${f.after}` : f.text, answer: lie ? 'False' : 'True', options: ['True', 'False'], explain: f.text });
        } else if (wrong.length >= 3) qs.push({ kind: 'mc', prompt: 'Fill in the blank', quote: blankText, answer: f.answer, options: shuffle([f.answer, ...wrong], r), explain: f.text });
      }
    }
    return qs;
  }

  // ---------- checking a typed answer (forgiving about capitals, accents, "the" and small typos) ----------
  const norm = s => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(the|a|an)\b/g, ' ').replace(/\s+/g, ' ').trim();
  function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  function check(input, answer) {
    const a = norm(input), b = norm(answer);
    if (!a) return false;
    if (a === b || a.replace(/s$/, '') === b.replace(/s$/, '')) return true;
    if (/\d/.test(b)) return a.replace(/\D/g, '') === b.replace(/\D/g, '') && a.replace(/\D/g, '').length > 0;   // numbers and years must be exact
    return b.length >= 5 && lev(a, b) <= Math.max(1, Math.floor(b.length / 7));
  }

  // flashcards: every term, then the best facts as fill-in-the-blank cards
  function cards(set) {
    return set.terms.map(t => ({ id: 't:' + t.term, front: t.term, back: t.def, more: t.more, kind: 'term' }))
      .concat(set.facts.slice().sort((a, b) => b.score - a.score).slice(0, 20).map(f => ({ id: f.id, front: `${f.before}_____${f.after}`, back: f.answer, more: f.text, kind: 'fact' })));
  }

  return { research, search, suggest, article, links, definitions, sections, sentences, clean, latex, read, candidates, terms, blanks, notes, quiz, distractors, check, cards, rng, shuffle, HOST };
});
