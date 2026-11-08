// Study Buddy: the page. brain.js does the research and makes the questions, practice.js makes math problems; this file is the screens.
// Saved in this browser: study-index (your study sets), study-set:<lang>:<title> (each set, so it opens instantly and offline),
// study-prog:<lang>:<title> (cards you know, best scores, your own notes) and study-prefs.
(function () {
  'use strict';
  const B = window.StudyBrain, P = window.StudyPractice, GS = window.GS;
  if (!B || !P || !GS) return;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = GS.store;
  const prefs = Object.assign({ simple: false, defsFirst: false, deck: 'all', quizN: 10, kinds: ['mc', 'tf', 'type'], level: 1 }, store.get('study-prefs', {}) || {});
  const savePrefs = () => store.set('study-prefs', prefs);
  const shuffle = arr => B.shuffle(arr, Math.random);

  // ✏️ Ideas on the start screen
  const EXAMPLES = [['🌱', 'Photosynthesis'], ['🏰', 'French Revolution'], ['📐', 'Pythagorean theorem'], ['🪐', 'Solar System'], ['🦖', 'Dinosaur'], ['🌋', 'Volcano'],
    ['🏛️', 'Ancient Egypt'], ['🍕', 'Fractions'], ['⚛️', 'Atom'], ['🗽', 'American Revolution'], ['🫀', 'Human heart'], ['🧮', 'Quadratic equation']];
  const STEPS = [['search', '🔎', 'Finding the best article'], ['read', '📖', 'Reading it'], ['terms', '🏷️', 'Looking up the key words'], ['facts', '🧠', 'Picking out facts and writing questions']];
  const TABS = [['notes', '📝 Notes'], ['cards', '🃏 Flashcards'], ['quiz', '❓ Quiz'], ['match', '🎯 Match'], ['write', '✍️ Write'], ['practice', '🧮 Practice'], ['read', '📖 Read']];

  // ---------- your saved study sets ----------
  const keyOf = (lang, title) => `${lang}:${title}`;
  const index = () => (Array.isArray(store.get('study-index', [])) ? store.get('study-index', []) : []);
  const cached = key => store.get('study-set:' + key, null);
  function remember(set, query) {
    const key = keyOf(set.lang, set.title), old = index().find(x => x.key === key);
    const qs = [...new Set([...(old ? old.qs || [] : []), (query || set.query || '').toLowerCase(), set.title.toLowerCase()].filter(Boolean))].slice(-6);
    const list = [{ key, title: set.title, lang: set.lang, desc: set.description, image: set.image, cards: B.cards(set).length, qs, at: Date.now() }, ...index().filter(x => x.key !== key)];
    for (const gone of list.slice(20)) { try { localStorage.removeItem('study-set:' + gone.key); localStorage.removeItem('study-prog:' + gone.key); } catch (e) {} }
    const keep = list.slice(0, 20);
    store.set('study-index', keep);
    for (let tries = 0; tries < 8; tries++) {   // (if the browser's storage is full, drop the oldest saved copies to make room)
      try { localStorage.setItem('study-set:' + key, JSON.stringify(set)); return; } catch (e) {
        const oldest = keep.slice(1).reverse().find(x => localStorage.getItem('study-set:' + x.key)); if (!oldest) return;
        try { localStorage.removeItem('study-set:' + oldest.key); } catch (er) {}
      }
    }
  }
  function forget(key) {
    store.set('study-index', index().filter(x => x.key !== key));
    try { localStorage.removeItem('study-set:' + key); localStorage.removeItem('study-prog:' + key); } catch (e) {}
  }
  const progOf = key => {
    const p = store.get('study-prog:' + key, {}) || {};
    return { known: {}, quizBest: null, matchBest: null, writeBest: null, notes: '', ...p, practice: { right: 0, tries: 0, streak: 0, best: 0, ...(p.practice || {}) } };
  };
  const saveProg = () => { if (cur) store.set('study-prog:' + cur.key, { ...cur.prog, at: Date.now() }); };
  const knownCount = c => c.cards.filter(x => c.prog.known[x.id]).length;

  // ---------- screens ----------
  let cur = null;   // the open study set: { key, set, prog, cards, math, tab }
  function show(id) {
    for (const s of ['home', 'loading', 'msg', 'set']) $('#' + s).hidden = s !== id;
    stopSpeaking();
    if (id === 'home') { document.title = 'Study Buddy · Mikaeel'; renderRecent(); }
  }
  function renderRecent() {
    const list = index();
    $('#recent-wrap').hidden = !list.length;
    $('#recent').innerHTML = list.map(x => {
      const p = progOf(x.key), k = Object.keys(p.known).length, pct = x.cards ? Math.round(100 * Math.min(k, x.cards) / x.cards) : 0;
      return `<div class="setcard" role="button" tabindex="0" data-key="${esc(x.key)}">${x.image ? `<img src="${esc(x.image)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ph',textContent:'📘'}))">` : '<span class="ph">📘</span>'}
        <span class="txt"><b>${esc(x.title)}${x.lang === 'simple' ? ' 🧒' : ''}</b><small>${k} of ${x.cards || '?'} cards known${p.quizBest != null ? ` · best quiz ${p.quizBest}%` : ''}</small><span class="bar"><i style="width:${pct}%"></i></span></span>
        <button class="x" data-forget="${esc(x.key)}" aria-label="Remove ${esc(x.title)}" title="Remove">✕</button></div>`;
    }).join('');
  }
  $('#examples').innerHTML = '<span class="muted" style="align-self:center;font-size:14px">Try:</span>' + EXAMPLES.map(([e, t]) => `<button data-try="${esc(t)}">${e} ${esc(t)}</button>`).join('');
  $('#examples').addEventListener('click', e => { const b = e.target.closest('[data-try]'); if (b) { $('#q').value = b.dataset.try; study(b.dataset.try); } });
  $('#recent').addEventListener('click', e => {
    const x = e.target.closest('[data-forget]');
    if (x) { e.stopPropagation(); if (confirm('Remove this study set and its progress?')) { forget(x.dataset.forget); renderRecent(); } return; }
    const c = e.target.closest('[data-key]'); if (c) openKey(c.dataset.key, { push: true });
  });
  $('#recent').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-key]')) { e.preventDefault(); openKey(e.target.dataset.key, { push: true }); } });
  $('#simple').checked = prefs.simple;
  $('#simple').addEventListener('change', e => { prefs.simple = e.target.checked; savePrefs(); });

  // ---------- searching, with suggestions as you type ----------
  const q = $('#q'), sugg = $('#sugg');
  let sugT = 0, sugList = [], sugAt = -1;
  const hideSugg = () => { sugg.hidden = true; sugList = []; sugAt = -1; q.removeAttribute('aria-activedescendant'); };
  function drawSugg() {
    sugg.innerHTML = sugList.map((t, i) => `<button type="button" role="option" id="sg${i}" class="${i === sugAt ? 'on' : ''}" data-s="${esc(t)}">${esc(t)}</button>`).join('');
    sugg.hidden = !sugList.length;
    if (sugAt >= 0) q.setAttribute('aria-activedescendant', 'sg' + sugAt); else q.removeAttribute('aria-activedescendant');
  }
  q.addEventListener('input', () => {
    clearTimeout(sugT); const v = q.value.trim();
    if (v.length < 2) return hideSugg();
    sugT = setTimeout(async () => {
      try { const list = await B.suggest(v, prefs.simple ? 'simple' : 'en', fetch.bind(window)); if (q.value.trim() === v) { sugList = list.slice(0, 7); sugAt = -1; drawSugg(); } } catch (e) { hideSugg(); }
    }, 220);
  });
  q.addEventListener('keydown', e => {
    if (!sugList.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {   // (around the list and back to what you typed)
      e.preventDefault(); const n = sugList.length; sugAt = ((sugAt + 1 + (e.key === 'ArrowDown' ? 1 : -1) + n + 1) % (n + 1)) - 1; drawSugg();
    }
    else if (e.key === 'Escape') hideSugg();
    else if (e.key === 'Enter' && sugAt >= 0) { e.preventDefault(); const t = sugList[sugAt]; q.value = t; study(t, { title: t }); }
  });
  sugg.addEventListener('mousedown', e => e.preventDefault());
  sugg.addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (b) { q.value = b.dataset.s; study(b.dataset.s, { title: b.dataset.s }); } });
  q.addEventListener('blur', () => setTimeout(hideSugg, 120));
  $('#form').addEventListener('submit', e => { e.preventDefault(); study(q.value); });

  // ---------- researching a topic ----------
  function drawSteps(now) {
    const k = STEPS.findIndex(s => s[0] === now), at = now === 'done' ? STEPS.length : k;
    $('#steps').innerHTML = STEPS.map(([id, e, t], i) => `<li class="${i < at ? 'done' : i === at ? 'now' : ''}"><span class="dot">${i < at ? '✓' : e}</span>${t}${i === at ? '…' : ''}</li>`).join('');
  }
  let busy = 0;
  async function study(query, o = {}) {
    query = String(query || '').trim(); if (!query) { q.focus(); return; }
    hideSugg();
    const lang = o.lang || (prefs.simple ? 'simple' : 'en'), want = (o.title || query).toLowerCase();
    const hit = !o.fresh && index().find(x => x.lang === lang && (x.title.toLowerCase() === want || (x.qs || []).includes(query.toLowerCase())));
    if (hit && cached(hit.key)) return openKey(hit.key, { push: o.push !== false, tab: o.tab });
    const my = ++busy;
    show('loading'); drawSteps('search');
    try {
      const res = await B.research(query, { lang, title: o.title, fetch: fetch.bind(window), onStep: s => { if (my === busy) drawSteps(s); } });
      if (my !== busy) return;
      if (res.notFound) return message(`<h2>🤔 I couldn't find “${esc(query)}”</h2><p class="muted">Check the spelling, or try fewer or simpler words.</p><div class="row" style="justify-content:center;margin-top:16px"><button class="btn primary" data-home>Search again</button></div>`);
      if (res.choose) return message(`<h2>“${esc(query)}” can mean a few things</h2><p class="muted">Which one do you want to study?</p><div class="choices">${res.options.map(r => `<button data-pick="${esc(r.title)}" data-lang="${res.lang}"><b>${esc(r.title)}</b><small>${esc(r.snippet.slice(0, 140))}</small></button>`).join('')}</div><div class="row" style="justify-content:center;margin-top:16px"><button class="btn" data-home>Search for something else</button></div>`);
      if (!res.terms.length && !res.facts.length) return message(`<h2>📄 There isn't much to study in “${esc(res.title)}”</h2><p class="muted">The article is very short. Try a bigger topic.</p><div class="row" style="justify-content:center;margin-top:16px"><button class="btn primary" data-home>Search again</button></div>`);
      remember(res, query);
      open(res, { push: o.push !== false, tab: o.tab });
    } catch (err) {
      if (my !== busy) return;
      const off = !navigator.onLine, saved = index().filter(x => cached(x.key)).slice(0, 6);
      message(`<h2>${off ? '📴 You\'re offline' : '😕 Wikipedia didn\'t answer'}</h2><p class="muted">${off ? 'Researching something new needs the internet.' : 'Try again in a moment.'}${saved.length ? ' You can still study your saved sets:' : ''}</p>
        ${saved.length ? `<div class="choices">${saved.map(x => `<button data-key="${esc(x.key)}"><b>${esc(x.title)}</b></button>`).join('')}</div>` : ''}
        <div class="row" style="justify-content:center;margin-top:16px"><button class="btn primary" data-retry>Try again</button><button class="btn" data-home>Back</button></div>`);
      $('#msg [data-retry]').onclick = () => study(query, o);
    }
  }
  function message(html) { $('#msg').innerHTML = html; show('msg'); }
  $('#msg').addEventListener('click', e => {
    const p = e.target.closest('[data-pick]'), k = e.target.closest('[data-key]');
    if (p) study(p.dataset.pick, { title: p.dataset.pick, lang: p.dataset.lang });
    else if (k) openKey(k.dataset.key, { push: true });
    else if (e.target.closest('[data-home]')) goHome(true);
  });
  function goHome(push) { if (push) history.pushState({}, '', location.pathname); cur = null; show('home'); q.focus(); }

  // ---------- an open study set ----------
  function openKey(key, o = {}) { const s = cached(key); if (s) open(s, o); else { const x = index().find(i => i.key === key); if (x) study(x.title, { title: x.title, lang: x.lang, fresh: true }); } }
  function open(set, o = {}) {
    const key = keyOf(set.lang, set.title);
    store.set('study-index', [{ ...(index().find(x => x.key === key) || {}), key, title: set.title, lang: set.lang, desc: set.description, image: set.image, cards: B.cards(set).length, at: Date.now() }, ...index().filter(x => x.key !== key)]);
    const m = P.detect(set.query, set.title, set.description);
    cur = { key, set, prog: progOf(key), cards: B.cards(set), math: m.math ? (m.ids.length ? m.ids : P.SKILLS.map(s => s.id)) : null };
    const tab = TABS.some(t => t[0] === o.tab) && (o.tab !== 'practice' || cur.math) ? o.tab : 'notes';
    $('#s-title').textContent = set.title;
    $('#s-desc').textContent = set.description ? set.description.charAt(0).toUpperCase() + set.description.slice(1) : '';
    const img = $('#s-img'); img.hidden = !set.image; img.onerror = () => { img.hidden = true; }; if (set.image) img.src = set.image;
    $('#s-meta').innerHTML = `<a href="${esc(set.url)}" target="_blank" rel="noopener">📖 ${set.lang === 'simple' ? 'Simple English ' : ''}Wikipedia ↗</a>
      <span>${cur.cards.length} cards · ${Math.max(1, Math.round(set.words / 200))} min read</span>
      <button class="linkbtn" data-act="fresh" title="Look it up again">🔄 Refresh</button><button class="linkbtn" data-act="share">🔗 Share</button><button class="linkbtn" data-act="new">🔎 New topic</button>`;
    $('#s-others').hidden = !(set.others && set.others.length);
    $('#s-others').innerHTML = set.others && set.others.length ? 'Not what you meant? ' + set.others.slice(0, 5).map(r => `<button data-pick="${esc(r.title)}">${esc(r.title)}</button>`).join('') : '';
    $('#tabs').innerHTML = TABS.filter(t => t[0] !== 'practice' || cur.math).map(([id, label]) => `<button role="tab" id="tab-${id}" data-tab="${id}" aria-selected="false" aria-controls="pane">${label}</button>`).join('');
    document.title = `${set.title} · Study Buddy`;
    show('set'); scrollTo(0, 0);
    setTab(tab, o.push ? 'push' : 'replace');
  }
  function urlFor(tab) { return `?topic=${encodeURIComponent(cur.set.title)}${cur.set.lang === 'simple' ? '&lang=simple' : ''}#${tab}`; }
  function setTab(tab, how = 'replace') {
    if (!cur) return;
    cur.tab = tab; stopSpeaking();
    document.querySelectorAll('#tabs [data-tab]').forEach(b => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; if (on) b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
    $('#pane').setAttribute('aria-labelledby', 'tab-' + tab);
    if (how === 'push') history.pushState({ topic: cur.set.title }, '', urlFor(tab)); else history.replaceState({ topic: cur.set.title }, '', urlFor(tab));
    const el = $('#pane'); el.className = 'pane'; void el.offsetWidth;
    ({ notes: paneNotes, cards: paneCards, quiz: paneQuiz, match: paneMatch, write: paneWrite, practice: panePractice, read: paneRead })[tab](el);
  }
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
  $('#tabs').addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const bs = [...document.querySelectorAll('#tabs [data-tab]')], i = bs.findIndex(b => b.dataset.tab === cur.tab), n = bs[(i + (e.key === 'ArrowRight' ? 1 : -1) + bs.length) % bs.length];
    setTab(n.dataset.tab); n.focus();
  });
  $('#s-meta').addEventListener('click', async e => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'fresh') study(cur.set.title, { title: cur.set.title, lang: cur.set.lang, fresh: true, tab: cur.tab, push: false });
    else if (a.dataset.act === 'new') goHome(true);
    else if (a.dataset.act === 'share') { const url = location.href.split('#')[0]; try { await navigator.clipboard.writeText(url); GS.toast('🔗 Link copied!'); } catch (er) { prompt('Copy this link:', url); } }
  });
  $('#s-others').addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (b) study(b.dataset.pick, { title: b.dataset.pick, lang: cur.set.lang }); });

  // ---------- 📝 notes ----------
  function notesText() {
    const n = cur.set.notes, out = [`${cur.set.title}`, cur.set.description || '', '', 'SUMMARY', n.summary.join(' ')];
    if (n.keyFacts.length) out.push('', 'KEY FACTS', ...n.keyFacts.map(f => '• ' + f));
    if (n.timeline.length) out.push('', 'TIMELINE', ...n.timeline.map(t => `${t.year}: ${t.text}`));
    if (n.glossary.length) out.push('', 'KEY WORDS', ...n.glossary.map(t => `${t.term}: ${t.def}`));
    for (const o of n.outline) out.push('', o.title.toUpperCase(), ...o.points.map(p => '• ' + p));
    if (cur.prog.notes.trim()) out.push('', 'MY NOTES', cur.prog.notes.trim());
    out.push('', `Source: ${cur.set.url} (Wikipedia, CC BY-SA)`);
    return out.join('\n');
  }
  function paneNotes(el) {
    const n = cur.set.notes;
    el.innerHTML = `
      <div class="tools"><button class="btn" data-act="speak">🔊 Read aloud</button><button class="btn" data-act="copy">📋 Copy</button><button class="btn" data-act="download">⬇️ Download</button><button class="btn" data-act="print">🖨️ Print</button></div>
      <div class="note"><h3>📝 Summary</h3><p>${esc(n.summary.join(' '))}</p></div>
      ${n.keyFacts.length ? `<div class="note"><h3>⭐ Key facts</h3><ul>${n.keyFacts.map(f => `<li>${esc(f)}</li>`).join('')}</ul></div>` : ''}
      ${n.timeline.length ? `<div class="note"><h3>🗓️ Timeline</h3><ul class="tl">${n.timeline.map(t => `<li><b>${esc(t.year)}</b>${esc(t.text)}</li>`).join('')}</ul></div>` : ''}
      ${n.glossary.length ? `<div class="note"><h3>🏷️ Key words</h3><div class="gloss">${n.glossary.map(t => `<div><b>${esc(t.term)}</b><span>${esc(t.def)}</span></div>`).join('')}</div></div>` : ''}
      ${n.outline.map(o => `<div class="note"><h3>${esc(o.title)}</h3><ul>${o.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>`).join('')}
      <div class="note"><h3>✏️ My notes</h3><textarea class="mine" id="mine" placeholder="Write your own notes here. They're saved as you type." aria-label="My notes">${esc(cur.prog.notes)}</textarea></div>`;
    let t = 0;
    $('#mine', el).addEventListener('input', e => { cur.prog.notes = e.target.value; clearTimeout(t); t = setTimeout(saveProg, 400); });
    $('.tools', el).addEventListener('click', async e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'speak') speak(notesText().replace(/\nSource:.*$/, ''), b);
      else if (b.dataset.act === 'copy') { try { await navigator.clipboard.writeText(notesText()); GS.toast('📋 Notes copied'); } catch (er) { GS.toast('Couldn\'t copy, sorry'); } }
      else if (b.dataset.act === 'download') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([notesText()], { type: 'text/plain' })); a.download = `${cur.set.title} - study notes.txt`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); }
      else if (b.dataset.act === 'print') print();
    });
  }

  // read aloud (one sentence at a time, so long notes don't get cut off)
  let speakBtn = null;
  function stopSpeaking() { try { speechSynthesis.cancel(); } catch (e) {} if (speakBtn) { speakBtn.textContent = speakBtn.dataset.label || '🔊 Read aloud'; speakBtn = null; } }
  function speak(text, btn) {
    if (!('speechSynthesis' in window)) { GS.toast('Your browser can\'t read aloud, sorry'); return; }
    if (speakBtn === btn) { stopSpeaking(); return; }
    stopSpeaking();
    speakBtn = btn; btn.dataset.label = btn.dataset.label || btn.textContent; btn.textContent = '⏹ Stop';
    const parts = B.sentences(text.replace(/\n+/g, '. ').replace(/\.\s*\./g, '.')).filter(Boolean);
    parts.forEach((s, i) => {
      const u = new SpeechSynthesisUtterance(s.replace(/•/g, '')); u.lang = 'en'; u.rate = 0.98;
      if (i === parts.length - 1) u.onend = () => { if (speakBtn === btn) stopSpeaking(); };
      speechSynthesis.speak(u);
    });
  }

  // ---------- 🃏 flashcards ----------
  let FC = null;   // { list, pos, flipped }
  function deck() {
    const c = cur.cards;
    if (prefs.deck === 'terms') return c.filter(x => x.kind === 'term');
    if (prefs.deck === 'facts') return c.filter(x => x.kind === 'fact');
    if (prefs.deck === 'todo') return c.filter(x => !cur.prog.known[x.id]);
    return c;
  }
  function paneCards(el, keep) {
    if (!keep || !FC) FC = { list: deck(), pos: 0, flipped: false };
    const todo = cur.cards.filter(x => !cur.prog.known[x.id]).length, known = knownCount(cur);
    const DECKS = [['all', `All (${cur.cards.length})`], ['terms', `Key words (${cur.cards.filter(x => x.kind === 'term').length})`], ['facts', `Facts (${cur.cards.filter(x => x.kind === 'fact').length})`], ['todo', `Not known yet (${todo})`]];
    const c = FC.list[FC.pos];
    let card;
    if (!FC.list.length) card = `<div class="note" style="text-align:center"><p>${prefs.deck === 'todo' ? '🎉 You know every card in this set!' : 'No cards here.'}</p><div class="row" style="justify-content:center;margin-top:10px"><button class="btn primary" data-act="all">Study all of them again</button></div></div>`;
    else if (!c) card = `<div class="note" style="text-align:center"><h3>🎉 That's the whole pile!</h3><p>You know ${known} of the ${cur.cards.length} cards.</p><div class="row" style="justify-content:center;margin-top:12px">${todo ? `<button class="btn primary" data-act="todo">Study the ${todo} you don't know yet</button>` : ''}<button class="btn" data-act="again">Go through again</button></div></div>`;
    else {
      const swap = prefs.defsFirst && c.kind === 'term', front = swap ? c.back : c.front, back = swap ? c.front : c.back;
      const big = s => s.length < 60 ? 'big' : 'mid';
      card = `<div class="flip${FC.flipped ? ' turned' : ''}" id="flip" role="button" tabindex="0" aria-label="Flashcard: tap or press space to turn it over">
        <div class="in"><div class="face front" aria-hidden="${FC.flipped}"><span class="tag">${c.kind === 'term' ? (swap ? 'What is it called?' : 'What is it?') : 'Fill the gap'}</span><div><div class="${big(front)}">${esc(front)}</div></div></div>
        <div class="face back" aria-hidden="${!FC.flipped}"><span class="tag">${cur.prog.known[c.id] ? '✓ You know this one' : 'Answer'}</span><div><div class="${big(back)}">${esc(back)}</div>${c.more ? `<small>${esc(c.more)}</small>` : ''}</div></div></div></div>
        <div class="cardnav"><button class="btn" data-act="prev" aria-label="Back one">←</button><button class="btn bad" data-act="learn">✗ Still learning</button><button class="btn good" data-act="know">✓ I know it</button><button class="btn" data-act="next" aria-label="Next">→</button></div>
        <p class="count">Card ${FC.pos + 1} of ${FC.list.length} · <kbd>Space</kbd> turn · <kbd>←</kbd> <kbd>→</kbd> move · <kbd>1</kbd> still learning · <kbd>2</kbd> know it</p>`;
    }
    el.innerHTML = `<div class="deckbar"><div class="seg" id="decks">${DECKS.map(([k, l]) => `<button data-deck="${k}" class="${prefs.deck === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="row"><button class="btn" data-act="shuffle" style="padding:6px 12px">🔀 Shuffle</button><button class="btn" data-act="swap" style="padding:6px 12px" aria-pressed="${prefs.defsFirst}">⇄ ${prefs.defsFirst ? 'Words first' : 'Meanings first'}</button></div></div>
      <div class="bar" style="height:8px;margin:0 0 6px" title="Cards you know"><i style="width:${Math.round(100 * known / Math.max(1, cur.cards.length))}%"></i></div>
      <p class="count" style="margin:0 0 14px">${known} of ${cur.cards.length} known</p>${card}`;
    const flip = $('#flip', el);
    if (flip) { flip.addEventListener('click', turn); GS.onSwipe(flip, d => { if (d === 'left') mark(false); else if (d === 'right') mark(true); }); }
  }
  function turn() { FC.flipped = !FC.flipped; const f = $('#flip'); if (f) { f.classList.toggle('turned', FC.flipped); f.querySelector('.front').setAttribute('aria-hidden', FC.flipped); f.querySelector('.back').setAttribute('aria-hidden', !FC.flipped); } GS.sfx('click'); }
  function move(d) { FC.pos = Math.max(0, Math.min(FC.list.length, FC.pos + d)); FC.flipped = false; paneCards($('#pane'), true); }
  function mark(know) {
    const c = FC.list[FC.pos]; if (!c) return;
    if (know) cur.prog.known[c.id] = 1; else delete cur.prog.known[c.id];
    saveProg(); GS.sfx(know ? 'pop' : 'place'); move(1);
  }
  document.addEventListener('click', e => {
    if (!cur || cur.tab !== 'cards') return;
    const d = e.target.closest('#pane [data-deck]'), a = e.target.closest('#pane [data-act]');
    if (d) { prefs.deck = d.dataset.deck; savePrefs(); paneCards($('#pane')); return; }
    if (!a) return;
    const act = a.dataset.act;
    if (act === 'prev') move(-1); else if (act === 'next') move(1); else if (act === 'know') mark(true); else if (act === 'learn') mark(false);
    else if (act === 'shuffle') { FC.list = shuffle(FC.list); FC.pos = 0; FC.flipped = false; paneCards($('#pane'), true); }
    else if (act === 'swap') { prefs.defsFirst = !prefs.defsFirst; savePrefs(); FC.flipped = false; paneCards($('#pane'), true); }
    else if (act === 'todo') { prefs.deck = 'todo'; savePrefs(); paneCards($('#pane')); }
    else if (act === 'all') { prefs.deck = 'all'; savePrefs(); paneCards($('#pane')); }
    else if (act === 'again') { FC.pos = 0; FC.flipped = false; paneCards($('#pane'), true); }
  });
  document.addEventListener('keydown', e => {
    if (!cur || $('#set').hidden || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    if (cur.tab === 'cards' && FC && FC.list[FC.pos]) {
      if (e.key === ' ' || (e.key === 'Enter' && document.activeElement.id === 'flip')) { e.preventDefault(); turn(); }
      else if (e.key === 'ArrowRight' && !e.target.closest('#tabs')) move(1); else if (e.key === 'ArrowLeft' && !e.target.closest('#tabs')) move(-1);
      else if (e.key === '1') mark(false); else if (e.key === '2') mark(true);
    } else if (cur.tab === 'quiz' && QZ && QZ.qs[QZ.i] && !QZ.done) {
      const q = QZ.qs[QZ.i];
      if (!QZ.answered && q.options && /^[1-4]$/.test(e.key) && q.options[+e.key - 1]) answerQuiz(q.options[+e.key - 1]);
      else if (QZ.answered && e.key === 'Enter') { e.preventDefault(); nextQuiz(); }
    }
  });

  // ---------- ❓ quiz ----------
  let QZ = null;   // { qs, i, score, wrong, answered, done }
  function paneQuiz(el) {
    if (QZ && QZ.key === cur.key && !QZ.done && QZ.qs.length) { drawQuiz(); return; }
    const kinds = [['mc', 'Multiple choice'], ['tf', 'True or false'], ['type', 'Type the answer']];
    el.innerHTML = `<div class="setup note">
      <h3>❓ Quiz yourself on ${esc(cur.set.title)}</h3>
      ${cur.prog.quizBest != null ? `<p class="muted">Your best: <b>${cur.prog.quizBest}%</b></p>` : ''}
      <div><div class="lbl">How many questions?</div><div class="seg" id="qn">${[5, 10, 15, 20].map(n => `<button data-n="${n}" class="${prefs.quizN === n ? 'on' : ''}">${n}</button>`).join('')}</div></div>
      <div><div class="lbl">Kinds of question</div><div class="seg" id="qk">${kinds.map(([k, l]) => `<button data-k="${k}" class="${prefs.kinds.includes(k) ? 'on' : ''}" aria-pressed="${prefs.kinds.includes(k)}">${l}</button>`).join('')}</div></div>
      <div><button class="btn primary" id="qstart">Start the quiz →</button></div></div>`;
    $('#qn', el).addEventListener('click', e => { const b = e.target.closest('[data-n]'); if (!b) return; prefs.quizN = +b.dataset.n; savePrefs(); paneQuiz(el); });
    $('#qk', el).addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; const k = b.dataset.k; prefs.kinds = prefs.kinds.includes(k) ? (prefs.kinds.length > 1 ? prefs.kinds.filter(x => x !== k) : prefs.kinds) : [...prefs.kinds, k]; savePrefs(); paneQuiz(el); });
    $('#qstart', el).addEventListener('click', () => startQuiz(B.quiz(cur.set, { n: prefs.quizN, kinds: prefs.kinds, seed: Date.now() })));
  }
  function startQuiz(qs) {
    if (!qs.length) { GS.toast('Not enough here to make a quiz, sorry'); return; }
    QZ = { key: cur.key, qs, i: 0, score: 0, wrong: [], answered: false, done: false };
    drawQuiz();
  }
  function drawQuiz() {
    const el = $('#pane'), q = QZ.qs[QZ.i];
    if (!q) return endQuiz();
    el.innerHTML = `<div class="qbox"><div class="qtop"><span>Question ${QZ.i + 1} of ${QZ.qs.length}</span><span>✓ ${QZ.score} right</span></div>
      <div class="bar" style="margin-bottom:16px"><i style="width:${100 * QZ.i / QZ.qs.length}%;background:var(--accent)"></i></div>
      <div class="prompt">${esc(q.prompt)}</div>${q.quote ? `<div class="quote">${esc(q.quote).replace('_____', '<b>_____</b>')}</div>` : ''}
      ${q.kind === 'type' ? `<form class="typein" id="qform"><input id="qin" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Type your answer" aria-label="Your answer"><button class="btn primary">Check</button></form>`
        : `<div class="answers" role="group" aria-label="Answers">${q.options.map((o, i) => `<button data-o="${i}"><kbd>${i + 1}</kbd><span>${esc(o)}</span></button>`).join('')}</div>`}
      <div id="qfb" aria-live="polite"></div></div>`;
    if (q.kind === 'type') { $('#qform').addEventListener('submit', e => { e.preventDefault(); if (QZ.answered) nextQuiz(); else if ($('#qin').value.trim()) answerQuiz($('#qin').value); }); $('#qin').focus(); }
    else { $('.answers', el).addEventListener('click', e => { const b = e.target.closest('[data-o]'); if (b && !QZ.answered) answerQuiz(q.options[+b.dataset.o]); }); }
  }
  function answerQuiz(given) {
    const q = QZ.qs[QZ.i], right = q.kind === 'type' ? B.check(given, q.answer) : given === q.answer;
    QZ.answered = true;
    if (right) QZ.score++; else QZ.wrong.push({ ...q, given });
    GS.sfx(right ? 'pop' : 'error');
    if (q.kind === 'type') { const i = $('#qin'); i.classList.add(right ? 'right' : 'wrong'); i.readOnly = true; }
    else document.querySelectorAll('.answers [data-o]').forEach(b => { const o = q.options[+b.dataset.o]; b.disabled = true; if (o === q.answer) b.classList.add('right'); else if (o === given) b.classList.add('wrong'); });
    $('#qfb').innerHTML = `<div class="feedback ${right ? 'right' : 'wrong'}">${right ? '✅ Right!' : `❌ Not quite. The answer is <b>${esc(q.answer)}</b>.`}<br><small class="muted">${esc(q.explain)}</small></div>
      <div class="next"><button class="btn primary" id="qnext">${QZ.i + 1 < QZ.qs.length ? 'Next →' : 'See my score'}</button></div>`;
    const nb = $('#qnext'); nb.addEventListener('click', nextQuiz); if (q.kind !== 'type') nb.focus();
  }
  function nextQuiz() { QZ.i++; QZ.answered = false; drawQuiz(); }
  function endQuiz() {
    QZ.done = true;
    const pct = Math.round(100 * QZ.score / QZ.qs.length), first = cur.prog.quizBest == null, better = first || pct > cur.prog.quizBest;
    if (better) { cur.prog.quizBest = pct; saveProg(); }
    GS.sfx(pct >= 60 ? 'win' : 'lose'); if (pct >= 80 && better) GS.confetti();
    const msg = pct === 100 ? 'Perfect! 🏆' : pct >= 80 ? 'Great job! 🌟' : pct >= 60 ? 'Nice work! 👍' : pct >= 40 ? 'Getting there! 💪' : 'Keep practising! 📚';
    $('#pane').innerHTML = `<div class="result note"><div class="muted">${esc(msg)}</div><div class="score">${QZ.score} / ${QZ.qs.length}</div><div class="muted">${pct}%${better && !first ? ' · <span class="new-best">New best!</span>' : !first ? ` · best ${cur.prog.quizBest}%` : ''}</div>
      <div class="row" style="justify-content:center;margin-top:14px">${QZ.wrong.length ? `<button class="btn primary" id="qretry">🔁 Try the ${QZ.wrong.length} I got wrong</button>` : ''}<button class="btn${QZ.wrong.length ? '' : ' primary'}" id="qnew">New quiz</button></div>
      ${QZ.wrong.length ? `<div class="review"><h3 style="margin-top:8px">To go over</h3>${QZ.wrong.map(w => `<div>${w.quote ? esc(w.quote) : esc(w.prompt)}<small>You said: ${esc(w.given)} · Answer: <b>${esc(w.answer)}</b></small></div>`).join('')}</div>` : ''}</div>`;
    const retry = $('#qretry'); if (retry) retry.addEventListener('click', () => startQuiz(shuffle(QZ.wrong.map(({ given, ...q }) => ({ ...q, options: q.options && shuffle(q.options) })))));
    $('#qnew').addEventListener('click', () => { QZ = null; paneQuiz($('#pane')); });
  }

  // ---------- 🎯 match ----------
  let MT = null;
  function paneMatch(el) {
    const pairs = cur.set.terms.filter(t => t.def.length <= 120);
    if (pairs.length < 3) { el.innerHTML = '<div class="note"><p>There aren\'t enough key words in this topic for a matching game. Try the flashcards or the quiz.</p></div>'; return; }
    const pick = shuffle(pairs).slice(0, Math.min(6, pairs.length));
    MT = { left: shuffle(pick), right: shuffle(pick), sel: null, done: 0, miss: 0, t0: 0, n: pick.length };
    el.innerHTML = `<div class="qtop" style="max-width:760px;margin:0 auto 10px"><span>Match each word to what it means</span><span id="mtime">⏱ 0.0 s</span></div>
      <div class="match"><div class="col">${MT.left.map((t, i) => `<button data-side="l" data-i="${i}">${esc(t.term)}</button>`).join('')}</div>
      <div class="col">${MT.right.map((t, i) => `<button data-side="r" data-i="${i}">${esc(t.masked)}</button>`).join('')}</div></div>
      <p class="count">${cur.prog.matchBest ? `Your best: ${cur.prog.matchBest.toFixed(1)} s` : 'Tap a word, then what it means.'}</p>`;
    $('.match', el).addEventListener('click', e => {
      const b = e.target.closest('[data-side]'); if (!b || b.classList.contains('done')) return;
      if (!MT.t0) { MT.t0 = performance.now(); tickMatch(); }
      const prev = MT.sel;
      if (!prev || prev.dataset.side === b.dataset.side) { if (prev) prev.classList.remove('sel'); MT.sel = b; b.classList.add('sel'); return; }
      const l = prev.dataset.side === 'l' ? prev : b, r = l === prev ? b : prev;
      if (MT.left[+l.dataset.i] === MT.right[+r.dataset.i]) { l.classList.add('done'); r.classList.add('done'); MT.done++; GS.sfx('pop'); if (MT.done === MT.n) endMatch(); }
      else { MT.miss++; [l, r].forEach(x => { x.classList.remove('shake'); void x.offsetWidth; x.classList.add('shake'); }); GS.sfx('error'); }
      prev.classList.remove('sel'); MT.sel = null;
    });
  }
  function tickMatch() { if (!MT || !MT.t0 || MT.end || cur.tab !== 'match') return; const t = $('#mtime'); if (t) t.textContent = `⏱ ${((performance.now() - MT.t0) / 1000).toFixed(1)} s`; requestAnimationFrame(tickMatch); }
  function endMatch() {
    MT.end = performance.now(); const s = (MT.end - MT.t0) / 1000 + MT.miss * 2, better = !cur.prog.matchBest || s < cur.prog.matchBest;
    if (better) { cur.prog.matchBest = +s.toFixed(1); saveProg(); GS.confetti(); }
    GS.sfx('win');
    $('#pane').insertAdjacentHTML('beforeend', `<div class="result note" style="margin-top:14px"><div class="score">${s.toFixed(1)} s</div><div class="muted">${MT.miss ? `(${MT.miss} wrong ${MT.miss === 1 ? 'try' : 'tries'} added ${MT.miss * 2} s)` : 'No mistakes!'}${better ? ' · <span class="new-best">New best!</span>' : ` · best ${cur.prog.matchBest} s`}</div>
      <div class="row" style="justify-content:center;margin-top:12px"><button class="btn primary" id="magain">Play again</button></div></div>`);
    $('#magain').addEventListener('click', () => paneMatch($('#pane')));
  }

  // ---------- ✍️ write: type the answers ----------
  let WR = null;
  function paneWrite(el) {
    if (!WR || WR.key !== cur.key || WR.done) WR = { key: cur.key, list: shuffle(cur.cards).filter(c => c.kind === 'fact' || c.front.split(' ').length <= 4).slice(0, 12), i: 0, right: 0, wrong: [], done: false, answered: false };
    const c = WR.list[WR.i];
    if (!c) return endWrite(el);
    const isTerm = c.kind === 'term', prompt = isTerm ? c.back : c.front, answer = isTerm ? c.front : c.back;
    el.innerHTML = `<div class="qbox"><div class="qtop"><span>${WR.i + 1} of ${WR.list.length}</span><span>✓ ${WR.right} right</span></div>
      <div class="prompt">${isTerm ? 'What is this called?' : 'Fill in the blank'}</div><div class="quote">${esc(prompt).replace('_____', '<b>_____</b>')}</div>
      <form class="typein" id="wform"><input id="win" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Type it" aria-label="Your answer"><button class="btn primary">Check</button></form>
      <div id="wfb" aria-live="polite"></div><p class="count">Small spelling mistakes are fine.</p></div>`;
    $('#win').focus();
    $('#wform').addEventListener('submit', e => {
      e.preventDefault();
      if (WR.answered) { WR.i++; WR.answered = false; paneWrite(el); return; }
      const v = $('#win').value; if (!v.trim()) return;
      const ok = B.check(v, answer); WR.answered = true; $('#win').readOnly = true; $('#win').classList.add(ok ? 'right' : 'wrong');
      if (ok) WR.right++; else WR.wrong.push({ prompt, answer, given: v });
      GS.sfx(ok ? 'pop' : 'error');
      $('#wfb').innerHTML = `<div class="feedback ${ok ? 'right' : 'wrong'}">${ok ? `✅ Right! <b>${esc(answer)}</b>` : `❌ It's <b>${esc(answer)}</b>.`}${c.more ? `<br><small class="muted">${esc(c.more)}</small>` : ''}</div>
        <div class="next">${ok ? '' : '<button type="button" class="btn" id="wmine">I was right</button>'}<button type="button" class="btn primary" id="wnext">Next → <kbd>Enter</kbd></button></div>`;
      $('#wnext').addEventListener('click', () => { WR.i++; WR.answered = false; paneWrite(el); });
      const mine = $('#wmine'); if (mine) mine.addEventListener('click', () => { WR.right++; WR.wrong.pop(); WR.i++; WR.answered = false; paneWrite(el); });
    });
  }
  function endWrite(el) {
    WR.done = true; const n = WR.list.length, pct = n ? Math.round(100 * WR.right / n) : 0, better = cur.prog.writeBest == null || pct > cur.prog.writeBest;
    if (better && n) { cur.prog.writeBest = pct; saveProg(); }
    GS.sfx(pct >= 60 ? 'win' : 'lose');
    el.innerHTML = `<div class="result note"><div class="score">${WR.right} / ${n}</div><div class="muted">${pct}%${better ? '' : ` · best ${cur.prog.writeBest}%`}</div>
      <div class="row" style="justify-content:center;margin-top:12px"><button class="btn primary" id="wagain">Go again</button></div>
      ${WR.wrong.length ? `<div class="review"><h3 style="margin-top:8px">To go over</h3>${WR.wrong.map(w => `<div>${esc(w.prompt)}<small>You wrote: ${esc(w.given)} · Answer: <b>${esc(w.answer)}</b></small></div>`).join('')}</div>` : ''}</div>`;
    $('#wagain').addEventListener('click', () => { WR = null; paneWrite(el); });
  }

  // ---------- 🧮 math practice ----------
  let PR = null;
  function panePractice(el) {
    const ids = cur.math || [];
    if (!PR || !ids.includes(PR.skill)) PR = { skill: ids[0], q: null };
    const st = cur.prog.practice, LV = [[1, 'Easy'], [2, 'Medium'], [3, 'Hard']];
    if (!PR.q) PR.q = P.make(PR.skill, prefs.level);
    const q = PR.q;
    el.innerHTML = `<div class="qbox">
      ${ids.length > 1 ? `<div class="seg" id="pskill" style="margin-bottom:10px">${ids.map(id => { const s = P.SKILLS.find(x => x.id === id); return `<button data-s="${id}" class="${id === PR.skill ? 'on' : ''}">${s.emoji} ${esc(s.name)}</button>`; }).join('')}</div>` : ''}
      <div class="deckbar"><div class="seg" id="plevel">${LV.map(([v, l]) => `<button data-l="${v}" class="${prefs.level === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="hud"><div class="chip"><small>Right</small><b>${st.right}/${st.tries}</b></div><div class="chip"><small>Streak</small><b>${st.streak}</b></div><div class="chip"><small>Best</small><b>${st.best}</b></div></div></div>
      <div class="prompt" style="font-size:24px;margin-top:6px">${esc(q.q)}</div>
      <form class="typein" id="pform"><input id="pin" inputmode="text" autocomplete="off" placeholder="Your answer" aria-label="Your answer"><button class="btn primary">Check</button></form>
      <div id="pfb" aria-live="polite"></div>
      <div class="next"><button type="button" class="btn" id="psteps">💡 How to solve it</button><button type="button" class="btn" id="pskip">New question →</button></div>
      <div id="pstepsbox"></div></div>`;
    const showSteps = () => { $('#pstepsbox').innerHTML = `<div class="steps-box"><b>How to solve it</b><ol>${q.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol></div>`; };
    $('#pin').focus();
    $('#pform').addEventListener('submit', e => {
      e.preventDefault();
      if (PR.answered) { PR.q = null; PR.answered = false; panePractice(el); return; }
      const v = $('#pin').value; if (!v.trim()) return;
      const ok = q.check(v); PR.answered = true; $('#pin').readOnly = true; $('#pin').classList.add(ok ? 'right' : 'wrong');
      st.tries++; if (ok) { st.right++; st.streak++; st.best = Math.max(st.best, st.streak); } else st.streak = 0;
      saveProg(); GS.sfx(ok ? 'pop' : 'error'); if (ok && st.streak > 0 && st.streak % 10 === 0) GS.confetti();
      $('#pfb').innerHTML = `<div class="feedback ${ok ? 'right' : 'wrong'}">${ok ? `✅ Right!${st.streak >= 3 ? ` 🔥 ${st.streak} in a row` : ''}` : `❌ The answer is <b>${esc(q.a)}</b>.`} <span class="muted">Press <kbd>Enter</kbd> for the next one.</span></div>`;
      if (!ok) showSteps();
    });
    $('#psteps').addEventListener('click', showSteps);
    $('#pskip').addEventListener('click', () => { PR.q = null; PR.answered = false; panePractice(el); });
    const sk = $('#pskill', el); if (sk) sk.addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (b) { PR = { skill: b.dataset.s, q: null }; panePractice(el); } });
    $('#plevel', el).addEventListener('click', e => { const b = e.target.closest('[data-l]'); if (b) { prefs.level = +b.dataset.l; savePrefs(); PR.q = null; PR.answered = false; panePractice(el); } });
  }

  // ---------- 📖 read the article ----------
  function paneRead(el) {
    const secs = cur.set.sections;
    el.innerHTML = `<div class="tools"><a class="btn" href="${esc(cur.set.url)}" target="_blank" rel="noopener">Open it on Wikipedia ↗</a></div><div class="read">${secs.map((s, i) => `
      ${i ? `<${s.level > 1 ? 'h4' : 'h3'}>${esc(s.title)} <button class="linkbtn" data-say="${i}" aria-label="Read ${esc(s.title)} aloud">🔊</button></${s.level > 1 ? 'h4' : 'h3'}>` : `<p class="muted"><button class="linkbtn" data-say="0">🔊 Read aloud</button></p>`}
      ${s.text.split('\n').map(p => `<p>${esc(p)}</p>`).join('')}`).join('')}</div>`;
    el.querySelector('.read').addEventListener('click', e => { const b = e.target.closest('[data-say]'); if (b) speak(secs[+b.dataset.say].text, b); });
  }

  // ---------- the address bar: ?topic=…&lang=simple#quiz ----------
  function route(push) {
    const u = new URLSearchParams(location.search), topic = u.get('topic'), lang = u.get('lang') === 'simple' ? 'simple' : 'en', tab = location.hash.slice(1);
    if (!topic) { cur = null; show('home'); return; }
    if (cur && cur.set.title === topic && cur.set.lang === lang) { if (tab && tab !== cur.tab && TABS.some(t => t[0] === tab)) setTab(tab); return; }
    const k = keyOf(lang, topic);
    if (cached(k)) open(cached(k), { tab, push });
    else study(topic, { title: topic, lang, tab, push: false });
  }
  addEventListener('popstate', () => route(false));
  route(false);
  window.Study = { study, get current() { return cur; }, setTab, get quiz() { return QZ; }, get match() { return MT; }, get write() { return WR; }, get practice() { return PR; } };   // (for tests)
})();
