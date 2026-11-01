// The home page: the app home screen (shown when the site runs as an installed app, or when you pick it in ⚙️ Customize),
// ⚙️ Customize itself, "Jump back in" (on both the app home screen and the website), and installing the app.
// Your choices are kept in this browser: app-settings (see site.js: DEFAULTS), app-home (your home screen) and app-wallpaper (your photo).
(function () {
  'use strict';
  const S = window.SiteJump; if (!S) return;
  const $ = (s, el = document) => el.querySelector(s);
  const root = document.documentElement;
  const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  const HEX = /^#[0-9a-f]{6}$/i;
  const calmNow = () => set.calm || matchMedia('(prefers-reduced-motion: reduce)').matches;
  let set = S.settings();

  // ✏️ Options in ⚙️ Customize
  const ACCENTS = ['#5b5bd6', '#e0457b', '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b'];
  const FONTS = { grotesk: ['Grotesk', '"Space Grotesk", system-ui, sans-serif'], system: ['System', 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'],
    rounded: ['Rounded', '"Nunito", ui-rounded, "SF Pro Rounded", system-ui, sans-serif'], serif: ['Serif', 'ui-serif, Georgia, "Times New Roman", serif'], mono: ['Mono', 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'] };
  const WALLS = { aurora: '🌌 Aurora', gradient: '🌅 Glow', dots: '⠿ Dots', plain: '⬜ Plain', photo: '🖼️ Your photo' };
  const EMOJIS = ['⭐', '🔥', '💜', '🎯', '🚀', '🧠', '🎲', '🌈', '🍕', '⚽', '🐱', '👾'];
  const DOCK_MAX = 5;

  // ---------- your home screen: the order, what's hidden, the dock, and your own names, icons and colors ----------
  const APPS = S.pages.filter(p => p[4] !== 'home').map(p => ({ id: p[2], emoji: p[0], name: p[1], words: p[3], kind: p[4], color: p[5], blurb: p[6] }));
  const byId = Object.fromEntries(APPS.map(a => [a.id, a]));
  const DOCK0 = ['music-player/', 'games/', 'dashboard/', 'world-watch/'];
  let L = loadLayout();
  function loadLayout() {
    const l = read('app-home', {}) || {}, ok = id => typeof id === 'string' && !!byId[id], uniq = a => [...new Set(a)];
    const order = uniq(Array.isArray(l.order) ? l.order.filter(ok) : []);
    for (const a of APPS) if (!order.includes(a.id)) order.push(a.id);   // (apps added to the site later join at the end)
    const custom = {};
    for (const [id, c] of Object.entries(l.custom && typeof l.custom === 'object' ? l.custom : {})) {
      if (!ok(id) || !c || typeof c !== 'object') continue;
      const o = {};
      if (typeof c.name === 'string' && c.name.trim()) o.name = c.name.trim().slice(0, 24);
      if (typeof c.emoji === 'string' && c.emoji.trim()) o.emoji = [...c.emoji.trim()].slice(0, 4).join('');
      if (HEX.test(c.color)) o.color = c.color;
      if (Object.keys(o).length) custom[id] = o;
    }
    return { order, hidden: uniq(Array.isArray(l.hidden) ? l.hidden.filter(ok) : []), dock: uniq(Array.isArray(l.dock) ? l.dock.filter(ok) : DOCK0).slice(0, DOCK_MAX), custom };
  }
  const saveLayout = () => write('app-home', L);
  const look = a => ({ ...a, ...(L.custom[a.id] || {}) });   // an app with your own name, icon and color

  // ---------- the look: theme, accent, font, background ----------
  function themeNow() { try { return localStorage.getItem('theme') || 'auto'; } catch (e) { return 'auto'; } }
  function setTheme(t) {
    try { t === 'auto' ? localStorage.removeItem('theme') : localStorage.setItem('theme', t); } catch (e) {}
    if (t === 'auto') delete root.dataset.theme; else root.dataset.theme = t;
    const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches), tb = $('#theme-toggle');
    if (tb) tb.textContent = dark ? '☀️' : '🌙';
    tintBar();
  }
  function tintBar() {   // the phone's status bar takes the page's color
    const m = $('meta[name="theme-color"]'); if (!m) return;
    requestAnimationFrame(() => { m.content = getComputedStyle(document.body).backgroundColor || m.content; });
  }
  function applyLook() {
    if (HEX.test(set.accent)) { root.style.setProperty('--accent', set.accent); root.style.setProperty('--accent-soft', `color-mix(in srgb, ${set.accent} 16%, var(--surface))`); }
    else { root.style.removeProperty('--accent'); root.style.removeProperty('--accent-soft'); }
    if (FONTS[set.font] && set.font !== 'grotesk') root.style.setProperty('--font', FONTS[set.font][1]); else root.style.removeProperty('--font');
    if (set.font === 'rounded' && !$('#font-nunito')) { const l = document.createElement('link'); l.id = 'font-nunito'; l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;800&display=swap'; document.head.appendChild(l); }
    S.applyCalm(set.calm);
    const v = $('#app-view'); if (!v) return;
    v.dataset.wall = set.wall === 'photo' && !wallpaper() ? 'aurora' : set.wall;
    v.dataset.icon = set.icon; v.dataset.shape = set.shape; v.dataset.labels = set.labels ? 'on' : 'off'; v.dataset.calm = calmNow() ? 'on' : 'off';
    v.style.setProperty('--text-scale', (set.text || 100) / 100);
    v.style.setProperty('--dim', Math.max(0, Math.min(80, +set.dim || 0)) / 100);
    const w = wallpaper(); v.style.setProperty('--wall-img', w ? `url("${w}")` : 'none');
    tintBar();
  }
  const wallpaper = () => { try { return localStorage.getItem('app-wallpaper') || ''; } catch (e) { return ''; } };
  function chooseView() {
    const app = set.view === 'app' || (set.view === 'auto' && S.inApp());
    root.dataset.view = app ? 'app' : 'site';
    if (app) buildApp();
    tintBar();
  }
  function change(key, value, redraw = true) {   // one setting changed in ⚙️ Customize: save it and show it straight away
    set[key] = value; S.saveSettings(set);
    applyLook();
    if (key === 'view') chooseView();
    if (key === 'homeBtn' || key === 'corner' || key === 'accent') S.homeButton(set);
    if (redraw && built) drawHome();
  }

  // ---------- "Jump back in": what you were last doing in your apps (read from what they saved in this browser) ----------
  function continueCards() {
    const cards = [];
    const now = read('mp-now', null);
    if (now && now.name) cards.push({ href: 'music-player/', art: '🎵', k: '<span class="eq-bars"><i></i><i></i><i></i></span>Last played', v: now.name, s: now.artist || 'Open your music player', track: now.id });
    const todos = read('dash-todos', null);
    if (Array.isArray(todos) && todos.length) {
      const left = todos.filter(t => t && !t.done);
      cards.push({ href: 'dashboard/', art: left.length ? '✅' : '🎉', k: 'To-do', v: left.length ? `${left.length} task${left.length === 1 ? '' : 's'} left` : 'All done!', s: left[0] ? 'Next: ' + left[0].text : 'Nice work.' });
    }
    const cds = read('dash-countdowns', null);
    if (Array.isArray(cds) && cds.length) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const up = cds.filter(c => c && typeof c.date === 'string').map(c => { const [y, m, d] = c.date.split('-').map(Number); return { ...c, n: Math.round((new Date(y, m - 1, d) - today) / 86400000) }; })
        .filter(c => c.n >= 0).sort((a, b) => a.n - b.n)[0];
      if (up) cards.push({ href: 'dashboard/', art: '📅', k: 'Coming up', v: up.name, s: up.n === 0 ? 'Today! 🎉' : `in ${up.n} day${up.n === 1 ? '' : 's'}` });
    }
    const chess = read('chess-game', null);
    if (chess && Array.isArray(chess.moves) && chess.moves.length && !chess.over) {
      const n = Math.ceil(chess.moves.length / 2), vs = chess.mode === 'ai' ? `vs computer (${chess.level})` : 'vs a friend';
      cards.push({ href: 'games/chess/', art: '♟️', k: 'Chess game in progress', v: `Move ${n} ${vs}`, s: chess.status || 'Tap to keep playing' });
    }
    const GAME = { blockpop: 'games/block-pop/', mergedrop: 'games/merge-drop/', wordhunt: 'games/word-hunt/', nightswarm: 'games/night-swarm/', skyhop: 'games/sky-hop/', snake: 'games/snake/', 2048: 'games/2048/', reactionlab: 'games/reaction-lab/', armor: 'armor-sim/' };
    const last = read('games-last', null), plays = read('games-played', {}) || {};
    if (last && GAME[last.id] && byId[GAME[last.id]]) {
      const a = look(byId[GAME[last.id]]), n = plays[last.id] || 1;
      cards.push({ href: a.id, art: a.emoji, k: 'Last game', v: a.name, s: `Played ${n} time${n === 1 ? '' : 's'} · tap to play again` });
    } else if (last && last.id === 'typing') cards.push({ href: 'typing-test/', art: '⌨️', k: 'Typing Test', v: 'Beat your speed', s: 'Tap to take another test' });
    return cards;
  }
  function fillContinue(box, cards) {
    box.innerHTML = '';
    for (const c of cards) {
      const a = document.createElement('a');
      a.className = 'cont'; a.href = c.href;
      a.innerHTML = `<div class="art">${esc(c.art)}</div><div class="txt"><div class="k">${c.k}</div><div class="v">${esc(c.v)}</div><div class="s">${esc(c.s || '')}</div></div>`;
      if (c.track != null) cover(c.track, a.querySelector('.art'));
      box.appendChild(a);
    }
  }
  function cover(id, art) {   // the song's cover art, straight from the music player's saved songs
    try {
      const req = indexedDB.open('music-player');
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('tracks')) return db.close();
        const get = db.transaction('tracks').objectStore('tracks').get(id);
        get.onsuccess = () => { const t = get.result; if (t && t.cover) { art.style.backgroundImage = `url("${URL.createObjectURL(t.cover)}")`; art.textContent = ''; } db.close(); };
        get.onerror = () => db.close();
      };
    } catch (e) {}
  }
  (function siteContinue() {   // the website's own "Jump back in"
    const grid = $('#cont-grid'), cards = continueCards();
    if (grid && cards.length) { fillContinue(grid, cards); $('#continue').classList.add('show'); }
  })();

  // ---------- the app home screen ----------
  let built = false, editing = false, query = '';
  function buildApp() {
    if (built) { drawHome(); return; }
    built = true;
    const v = $('#app-view');
    v.innerHTML = `
      <div class="a-wall" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="a-main">
        <div class="a-top">
          <div class="a-date" id="a-date"></div>
          <div class="a-btns">
            <button class="a-done" id="a-done" hidden>✓ Done</button>
            <button class="a-ibtn" id="a-edit" aria-label="Edit your home screen" title="Edit your home screen">✏️</button>
            <button class="a-ibtn" id="a-set" aria-label="Customize" title="Customize">⚙️</button>
          </div>
        </div>
        <div class="a-clock" id="a-clock" aria-live="off"></div>
        <div class="a-greet" id="a-greet"></div>
        <label class="a-search" id="a-search"><span aria-hidden="true">🔎</span><input type="search" id="a-q" placeholder="Search apps and games…" autocomplete="off" spellcheck="false" aria-label="Search apps and games"></label>
        <p class="a-hint" id="a-hint" hidden>Drag icons to move them · tap one to change it · ✕ hides it</p>
        <section class="a-sec" id="a-cont-sec" hidden><h2>Jump back in</h2><div class="a-cont" id="a-cont"></div></section>
        <section class="a-sec" id="a-recent-sec" hidden><h2>Recently opened</h2><div class="a-grid a-recent" id="a-recent"></div></section>
        <div id="a-grids"></div>
        <section class="a-sec" id="a-hidden-sec" hidden><h2>Hidden</h2><div class="a-grid" id="a-hidden" data-list="hidden"></div></section>
        <p class="a-foot"><button class="a-link" id="a-site">🌐 Website view</button><button class="a-link" id="a-install" hidden>📲 Install as an app</button></p>
      </div>
      <div class="a-dock" id="a-dock" data-list="dock" role="navigation" aria-label="Dock"></div>`;
    $('#a-set').addEventListener('click', openSettings);
    $('#a-edit').addEventListener('click', () => setEditing(!editing));
    $('#a-done').addEventListener('click', () => setEditing(false));
    $('#a-site').addEventListener('click', () => change('view', 'site'));
    $('#a-install').addEventListener('click', install);
    const q = $('#a-q');
    q.addEventListener('input', () => { query = q.value.trim().toLowerCase(); drawGrids(); });
    q.addEventListener('keydown', e => {
      if (e.key === 'Enter') { const first = $('#a-grids .a-tile'); if (first) location.href = first.getAttribute('href'); }
      else if (e.key === 'Escape') { q.value = ''; query = ''; drawGrids(); }
    });
    wireTiles(v);
    addEventListener('keydown', e => { if (e.key === 'Escape' && editing && !$('.a-sheet-back')) setEditing(false); });
    setInterval(tick, 1000);
    applyLook(); drawHome();
  }
  function drawHome() {
    if (!built) return;
    applyLook();
    $('#a-clock').hidden = !set.clock; $('#a-greet').hidden = !set.greeting; $('#a-search').hidden = !set.search;
    tick();
    const cards = set.cont ? continueCards() : [];
    $('#a-cont-sec').hidden = !cards.length || !!query || editing; if (cards.length) fillContinue($('#a-cont'), cards);
    $('#a-install').hidden = S.standalone() || !(installEvt || iOS);
    drawGrids();
  }
  function hour12() {
    if (set.hour === '12') return true;
    if (set.hour === '24') return false;
    try { return !/h2[34]/.test(new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle || ''); } catch (e) { return true; }
  }
  function tick() {
    if (!built) return;
    const d = new Date(), h12 = hour12(), pad = n => String(n).padStart(2, '0');
    let h = d.getHours(); const ap = h < 12 ? 'AM' : 'PM'; if (h12) h = h % 12 || 12;
    const t = `${h12 ? h : pad(h)}:${pad(d.getMinutes())}${set.seconds ? ':' + pad(d.getSeconds()) : ''}`;
    const c = $('#a-clock'), html = esc(t) + (h12 ? `<small>${ap}</small>` : '');
    if (c.innerHTML !== html) c.innerHTML = html;
    const hr = d.getHours(), hi = hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : hr < 22 ? 'Good evening' : 'Good night';
    const g = `${hi}${set.name ? ', ' + set.name.trim().slice(0, 30) : ''} 👋`;
    if ($('#a-greet').textContent !== g) $('#a-greet').textContent = g;
    const day = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    if ($('#a-date').textContent !== day) $('#a-date').textContent = day;
  }
  const tileHTML = (a, extra = '') => {
    const c = look(a);
    return `<a class="a-tile" href="${esc(a.id)}" data-id="${esc(a.id)}" draggable="false"><span class="a-ico" style="--c:${esc(c.color)}">${esc(c.emoji)}</span>`
      + `<span class="a-txt"><span class="a-lbl">${esc(c.name)}</span><span class="a-desc">${esc(a.blurb)}</span></span>${extra}</a>`;
  };
  const xBadge = (act, label) => `<span class="a-x" data-act="${act}" role="button" aria-label="${esc(label)}">${act === 'show' ? '+' : '✕'}</span>`;
  function drawGrids() {
    const shown = L.order.filter(id => !L.hidden.includes(id)).map(id => byId[id]);
    const matches = a => { const c = look(a); return (c.name + ' ' + a.name + ' ' + a.words + ' ' + a.blurb).toLowerCase().includes(query); };
    const list = set.layout === 'list' ? ' list' : '';
    const grid = (title, key, apps, empty) => `<section class="a-sec"><h2>${title}</h2>${apps.length ? `<div class="a-grid${list}" data-list="${key}">${apps.map(a => tileHTML(a, editing ? xBadge('hide', 'Hide ' + look(a).name) : '')).join('')}</div>` : `<p class="a-empty">${empty}</p>`}</section>`;
    let html;
    if (query) html = grid('Results', 'results', APPS.filter(matches), 'Nothing matches that. Try another word.');
    else if (set.group) html = grid('Apps', 'app', shown.filter(a => a.kind === 'app'), 'All your apps are hidden.') + grid('Games', 'game', shown.filter(a => a.kind === 'game'), 'All your games are hidden.');
    else html = grid('Apps &amp; games', 'all', shown, 'Everything is hidden.');
    $('#a-grids').innerHTML = html;
    // recently opened (not while searching or editing)
    const rec = set.recent && !query && !editing ? S.recent().map(r => r && byId[r.p]).filter(a => a && !L.hidden.includes(a.id)).slice(0, 4) : [];
    $('#a-recent-sec').hidden = !rec.length; $('#a-recent').innerHTML = rec.map(a => tileHTML(a)).join('');
    $('#a-cont-sec').hidden = $('#a-cont-sec').hidden || !!query || editing;
    // hidden ones (while editing), and the dock
    $('#a-hidden-sec').hidden = !editing || !L.hidden.length;
    $('#a-hidden').innerHTML = editing ? L.hidden.map(id => tileHTML(byId[id], xBadge('show', 'Show ' + look(byId[id]).name))).join('') : '';
    const dock = $('#a-dock');
    dock.hidden = !set.dock || (!L.dock.length && !editing);
    dock.innerHTML = L.dock.map(id => tileHTML(byId[id], editing ? xBadge('undock', 'Take ' + look(byId[id]).name + ' out of the dock') : '')).join('') + (editing && !L.dock.length ? '<span class="a-empty">Pin apps here: tap one and pick 📌</span>' : '');
    $('#app-view').classList.toggle('has-dock', !dock.hidden);
  }

  // ---------- editing: long-press (or ✏️) to edit, drag to move, ✕ to hide, tap to change one ----------
  function setEditing(on) {
    editing = on;
    $('#app-view').classList.toggle('editing', on);
    $('#a-done').hidden = !on; $('#a-edit').hidden = on; $('#a-hint').hidden = !on;
    if (on && query) { $('#a-q').value = ''; query = ''; }
    drawHome();
  }
  let drag = null, press = 0, pressed = false, ghost = null;
  function wireTiles(box) {
    box.addEventListener('contextmenu', e => { if (e.target.closest('.a-tile')) e.preventDefault(); });
    box.addEventListener('pointerdown', e => {
      const t = e.target.closest('.a-tile'); if (!t || e.button > 0) return;
      pressed = false;
      if (!editing) {   // hold an icon to start editing
        const x0 = e.clientX, y0 = e.clientY;
        clearTimeout(press);
        press = setTimeout(() => { pressed = true; setEditing(true); if (navigator.vibrate) navigator.vibrate(12); }, 520);
        const cancel = ev => { if (ev.type !== 'pointermove' || Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) { clearTimeout(press); off(); } };
        const off = () => ['pointermove', 'pointerup', 'pointercancel'].forEach(k => removeEventListener(k, cancel));
        ['pointermove', 'pointerup', 'pointercancel'].forEach(k => addEventListener(k, cancel));
        return;
      }
      const list = t.parentElement.dataset.list;
      if (e.target.closest('.a-x') || !['app', 'game', 'all', 'dock'].includes(list)) return;
      drag = { id: t.dataset.id, list, x0: e.clientX, y0: e.clientY, on: false, el: t };
    });
    box.addEventListener('click', e => {
      const t = e.target.closest('.a-tile'); if (!t) return;
      if (pressed) { e.preventDefault(); pressed = false; return; }
      if (!editing) return;
      e.preventDefault();
      const id = t.dataset.id, x = e.target.closest('.a-x');
      if (x && x.dataset.act === 'hide') { L.hidden.push(id); L.dock = L.dock.filter(d => d !== id); saveLayout(); drawGrids(); }
      else if (x && x.dataset.act === 'show') { L.hidden = L.hidden.filter(d => d !== id); saveLayout(); drawGrids(); }
      else if (x && x.dataset.act === 'undock') { L.dock = L.dock.filter(d => d !== id); saveLayout(); drawGrids(); }
      else openTile(id);
    });
  }
  addEventListener('pointermove', e => {
    if (!drag) return;
    if (!drag.on) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 7) return;
      drag.on = true; pressed = true;
      ghost = drag.el.querySelector('.a-ico').cloneNode(true); ghost.classList.add('a-ghost'); document.body.appendChild(ghost);
      drag.el.classList.add('drag-src');
    }
    e.preventDefault();
    ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px';
    if (e.clientY < 70) scrollBy(0, -10); else if (e.clientY > innerHeight - 70 && drag.list !== 'dock') scrollBy(0, 10);
    const over = document.elementFromPoint(e.clientX, e.clientY), t = over && over.closest('.a-tile');
    if (!t || t === drag.el || t.parentElement !== drag.el.parentElement) return;
    const arr = drag.list === 'dock' ? L.dock : L.order, from = arr.indexOf(drag.id), to = arr.indexOf(t.dataset.id);
    if (from < 0 || to < 0) return;
    arr.splice(from, 1); arr.splice(to, 0, drag.id);
    t.parentElement.insertBefore(drag.el, from < to ? t.nextSibling : t);
  }, { passive: false });
  const endDrag = () => {
    if (!drag) return;
    if (drag.on) { drag.el.classList.remove('drag-src'); if (ghost) ghost.remove(); ghost = null; saveLayout(); setTimeout(() => { pressed = false; }, 0); }
    drag = null;
  };
  addEventListener('pointerup', endDrag); addEventListener('pointercancel', endDrag);

  // ---------- sheets (⚙️ Customize, changing one app, installing on an iPhone) ----------
  let sheetBack = null, lastFocus = null;
  function sheet(title, html, wire) {
    closeSheet();
    lastFocus = document.activeElement;
    sheetBack = document.createElement('div'); sheetBack.className = 'a-sheet-back';
    sheetBack.innerHTML = `<div class="a-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="a-sheet-top"><h2>${esc(title)}</h2><button class="a-ibtn" data-close aria-label="Close">✕</button></div><div class="a-sheet-body">${html}</div></div>`;
    document.body.appendChild(sheetBack);
    sheetBack.addEventListener('click', e => { if (e.target === sheetBack || e.target.closest('[data-close]')) closeSheet(); });
    wire($('.a-sheet-body', sheetBack));
    requestAnimationFrame(() => { sheetBack && sheetBack.classList.add('open'); const f = $('[data-close]', sheetBack); if (f) f.focus(); });
  }
  addEventListener('keydown', e => { if (e.key === 'Escape' && sheetBack) { e.stopImmediatePropagation(); closeSheet(); } }, true);
  function closeSheet() { if (!sheetBack) return; sheetBack.remove(); sheetBack = null; if (lastFocus && lastFocus.focus) lastFocus.focus(); }

  // one app: its name, icon and color, the dock, hiding it
  function openTile(id) {
    const a = byId[id], c = look(a), docked = L.dock.includes(id), hidden = L.hidden.includes(id);
    sheet(`Change “${c.name}”`, `
      <div class="a-preview"><span class="a-ico" id="t-ico" style="--c:${esc(c.color)};--radius:${{ circle: '50%', square: '12%' }[set.shape] || '23%'}">${esc(c.emoji)}</span></div>
      <label class="a-field">Name <input type="text" id="t-name" maxlength="24" value="${esc(c.name)}" autocomplete="off"></label>
      <label class="a-field">Icon <input type="text" id="t-emoji" value="${esc(c.emoji)}" autocomplete="off" aria-describedby="t-emoji-help"></label>
      <div class="a-emojis" id="t-emojis">${[a.emoji, ...EMOJIS.filter(e => e !== a.emoji)].map(e => `<button type="button" data-e="${esc(e)}">${esc(e)}</button>`).join('')}</div>
      <p class="a-help" id="t-emoji-help">Type or paste any emoji, or pick one.</p>
      <div class="a-label">Color</div>
      <div class="a-swatches" id="t-colors">${[a.color, ...ACCENTS.filter(x => x !== a.color)].map(x => `<button type="button" class="a-sw" data-c="${x}" style="--c:${x}" aria-label="Color ${x}" aria-pressed="${x === c.color}"></button>`).join('')}<label class="a-sw a-sw-pick" title="Any color" aria-label="Any color"><input type="color" id="t-pick" value="${esc(c.color)}">🎨</label></div>
      <div class="a-actions">
        <button type="button" class="a-btn" id="t-dock" ${!docked && L.dock.length >= DOCK_MAX ? 'disabled title="The dock is full"' : ''}>${docked ? '📌 Take out of the dock' : '📌 Put in the dock'}</button>
        <button type="button" class="a-btn" id="t-left" ${hidden ? 'hidden' : ''}>⬅️ Move earlier</button>
        <button type="button" class="a-btn" id="t-right" ${hidden ? 'hidden' : ''}>Move later ➡️</button>
        <button type="button" class="a-btn" id="t-hide">${hidden ? '👁️ Show it again' : '🙈 Hide it'}</button>
        <button type="button" class="a-btn" id="t-reset">↺ Back to normal</button>
        <button type="button" class="a-btn primary" data-close>✓ Done</button>
      </div>`, body => {
      const save = patch => {
        const cur = { ...(L.custom[id] || {}), ...patch };
        for (const k of Object.keys(cur)) if (!cur[k] || cur[k] === a[k]) delete cur[k];
        if (Object.keys(cur).length) L.custom[id] = cur; else delete L.custom[id];
        saveLayout(); drawGrids();
        const n = look(a), ico = $('#t-ico', body); ico.textContent = n.emoji; ico.style.setProperty('--c', n.color);
        body.querySelectorAll('.a-sw[data-c]').forEach(b => b.setAttribute('aria-pressed', b.dataset.c === n.color));
      };
      $('#t-name', body).addEventListener('input', e => save({ name: e.target.value.trim().slice(0, 24) }));
      $('#t-emoji', body).addEventListener('input', e => save({ emoji: [...e.target.value.trim()].slice(0, 4).join('') }));
      $('#t-emojis', body).addEventListener('click', e => { const b = e.target.closest('[data-e]'); if (!b) return; $('#t-emoji', body).value = b.dataset.e; save({ emoji: b.dataset.e }); });
      $('#t-colors', body).addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (b) save({ color: b.dataset.c }); });
      $('#t-pick', body).addEventListener('input', e => save({ color: e.target.value }));
      $('#t-dock', body).addEventListener('click', () => { L.dock = L.dock.includes(id) ? L.dock.filter(d => d !== id) : [...L.dock, id].slice(0, DOCK_MAX); saveLayout(); drawGrids(); closeSheet(); });
      $('#t-hide', body).addEventListener('click', () => {
        if (L.hidden.includes(id)) L.hidden = L.hidden.filter(d => d !== id); else { L.hidden.push(id); L.dock = L.dock.filter(d => d !== id); }
        saveLayout(); drawGrids(); closeSheet();
      });
      const move = step => {   // one place earlier or later among the icons you can see in its section (for keyboards, or if dragging is fiddly)
        const peers = L.order.filter(x => !L.hidden.includes(x) && (!set.group || byId[x].kind === a.kind)), k = peers.indexOf(id), other = peers[k + step];
        if (!other) return;
        const i = L.order.indexOf(id), j = L.order.indexOf(other);
        L.order[i] = other; L.order[j] = id; saveLayout(); drawGrids();
      };
      $('#t-left', body).addEventListener('click', () => move(-1));
      $('#t-right', body).addEventListener('click', () => move(1));
      $('#t-reset', body).addEventListener('click', () => { delete L.custom[id]; saveLayout(); drawGrids(); closeSheet(); openTile(id); });
    });
  }

  // ⚙️ Customize
  function openSettings() {
    sheet('⚙️ Customize', settingsHTML(), wireSettings);
  }
  const chips = (key, opts, cur = set[key]) => `<div class="a-chips" data-key="${key}" role="group">${opts.map(([v, l, st]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${String(cur) === String(v)}"${st ? ` style="${st}"` : ''}>${l}</button>`).join('')}</div>`;
  const toggle = (key, label) => `<label class="a-switch"><span>${label}</span><input type="checkbox" data-key="${key}"${set[key] ? ' checked' : ''}><i aria-hidden="true"></i></label>`;
  function settingsHTML() {
    const acc = HEX.test(set.accent) ? set.accent : '';
    return `
      <h3>🎨 Look</h3>
      <div class="a-label">Theme</div>${chips('theme', [['auto', '🌓 Auto'], ['light', '☀️ Light'], ['dark', '🌙 Dark']], themeNow())}
      <div class="a-label">Accent color</div>
      <div class="a-swatches" data-key="accent"><button type="button" class="a-sw a-sw-def" data-c="" aria-label="The usual purple" aria-pressed="${!acc}">↺</button>${ACCENTS.slice(1).map(x => `<button type="button" class="a-sw" data-c="${x}" style="--c:${x}" aria-label="Color ${x}" aria-pressed="${acc === x}"></button>`).join('')}<label class="a-sw a-sw-pick" title="Any color" aria-label="Any color"><input type="color" id="s-accent" value="${acc || '#5b5bd6'}">🎨</label></div>
      <div class="a-label">Home screen background</div>${chips('wall', Object.entries(WALLS))}
      <div id="s-photo" ${set.wall === 'photo' ? '' : 'hidden'}>
        <div class="a-actions"><label class="a-btn">🖼️ Choose a photo<input type="file" id="s-photo-file" accept="image/*" hidden></label>${wallpaper() ? '<button type="button" class="a-btn" id="s-photo-del">🗑 Remove it</button>' : ''}</div>
        <label class="a-range"><span>Darken it so the icons stand out</span><output>${set.dim}%</output><input type="range" min="0" max="80" step="5" data-key="dim" value="${set.dim}"></label>
      </div>
      <div class="a-label">Font</div>${chips('font', Object.entries(FONTS).map(([k, [n, f]]) => [k, n, `font-family:${f.replace(/"/g, "'")}`]))}
      <div class="a-label">Text size</div>${chips('text', [[90, 'S'], [100, 'M'], [112, 'L'], [125, 'XL']])}

      <h3>🏠 Home screen</h3>
      <label class="a-field">Your name (for the greeting) <input type="text" id="s-name" maxlength="30" value="${esc(set.name)}" placeholder="Mikaeel" autocomplete="off"></label>
      <div class="a-label">Show</div>
      <div class="a-switches">${toggle('clock', '🕒 Clock')}${toggle('greeting', '👋 Greeting')}${toggle('search', '🔎 Search')}${toggle('cont', '⏯️ Jump back in')}${toggle('recent', '🕘 Recently opened')}${toggle('dock', '⚓ Dock')}</div>
      <div class="a-label">Clock</div>${chips('hour', [['auto', 'Auto'], ['12', '12-hour'], ['24', '24-hour']])}<div class="a-switches">${toggle('seconds', 'Show seconds')}</div>
      <div class="a-label">Icons</div>${chips('icon', [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']])}${chips('shape', [['rounded', 'Rounded'], ['circle', 'Circle'], ['square', 'Square']])}
      <div class="a-switches">${toggle('labels', 'Names under the icons')}${toggle('group', 'Games in their own section')}</div>
      <div class="a-label">Layout</div>${chips('layout', [['grid', '▦ Grid'], ['list', '☰ List']])}
      <div class="a-actions"><button type="button" class="a-btn" id="s-edit">✏️ Move, hide or change apps</button></div>
      <div class="a-label">Home page</div>${chips('view', [['auto', 'Auto'], ['app', '📱 Home screen'], ['site', '🌐 Website']])}
      <p class="a-help">Auto shows this home screen in the installed app and the website in a browser.</p>

      <h3>🚀 When the app opens</h3>
      <label class="a-field">Start in <select id="s-start"><option value="">🏠 The home screen</option>${APPS.map(a => `<option value="${esc(a.id)}"${set.start === a.id ? ' selected' : ''}>${esc(a.emoji + ' ' + a.name)}</option>`).join('')}</select></label>
      <p class="a-help">Opening the installed app takes you straight there.</p>

      <h3>📱 Every page</h3>
      <div class="a-label">🏠 Home button on the other pages</div>${chips('homeBtn', [['auto', 'In the app'], ['always', 'Always'], ['never', 'Never']])}
      ${chips('corner', [['tl', '↖ Top left'], ['tr', '↗ Top right'], ['bl', '↙ Bottom left'], ['br', '↘ Bottom right']])}
      <p class="a-help">Hold the home button to jump to any page.</p>
      <div class="a-switches">${toggle('calm', '🧘 Calm mode: no animations anywhere')}</div>

      <h3>💾 Your stuff</h3>
      <p class="a-help">Everything you've saved here (scores, to-dos, tier lists, your tanks, these settings…) lives in this browser. Back it up to move it to another device. (Songs in the music player aren't included: they're too big.)</p>
      <div class="a-actions">
        <button type="button" class="a-btn" id="s-backup">⬇️ Back up everything</button>
        <label class="a-btn">⬆️ Restore a backup<input type="file" id="s-restore" accept="application/json,.json" hidden></label>
        <button type="button" class="a-btn" id="s-reset-home">↺ Reset the home screen</button>
        <button type="button" class="a-btn" id="s-reset-look">↺ Reset all settings</button>
      </div>`;
  }
  function wireSettings(body) {
    const redraw = () => {   // (keeps your place, and keyboard focus on the same control)
      const top = $('.a-sheet', sheetBack).scrollTop, f = document.activeElement, key = f && f.closest && f.closest('[data-key]');
      const again = f && f.id ? '#' + f.id : key ? `[data-key="${key.dataset.key}"] ${f.dataset.v != null ? `[data-v="${f.dataset.v}"]` : f.dataset.c != null ? `[data-c="${f.dataset.c}"]` : ''}`.trim() : null;
      body.innerHTML = settingsHTML(); $('.a-sheet', sheetBack).scrollTop = top;
      const el = again && body.querySelector(again); if (el) el.focus({ preventScroll: true });
    };
    body.addEventListener('click', e => {
      const b = e.target.closest('.a-chips button');
      if (b) {
        const key = b.parentElement.dataset.key, raw = b.dataset.v, v = key === 'text' ? +raw : raw;
        if (key === 'theme') setTheme(v);
        else if (key === 'wall' && v === 'photo' && !wallpaper()) { change('wall', v); redraw(); $('#s-photo-file', body).click(); return; }
        else change(key, v);
        redraw(); return;
      }
      const sw = e.target.closest('[data-key="accent"] .a-sw[data-c]');
      if (sw) { change('accent', sw.dataset.c); redraw(); return; }
      if (e.target.closest('#s-edit')) { closeSheet(); setEditing(true); return; }
      if (e.target.closest('#s-photo-del')) { try { localStorage.removeItem('app-wallpaper'); } catch (er) {} change('wall', 'aurora'); redraw(); return; }
      if (e.target.closest('#s-backup')) { backup(); return; }
      if (e.target.closest('#s-reset-home') && confirm('Put every app back where it started, and undo your names, icons and colors?')) { try { localStorage.removeItem('app-home'); } catch (er) {} L = loadLayout(); drawHome(); S.toast('Home screen reset'); return; }
      if (e.target.closest('#s-reset-look') && confirm('Reset all these settings (and remove your wallpaper photo)? Your home screen and everything else you saved stays.')) {
        set = { ...S.DEFAULTS }; S.saveSettings(set); try { localStorage.removeItem('app-wallpaper'); } catch (er) {}
        setTheme('auto'); applyLook(); chooseView(); S.homeButton(set); drawHome(); redraw(); S.toast('Settings reset');
      }
    });
    body.addEventListener('change', e => {
      const el = e.target;
      if (el.matches('input[type=checkbox][data-key]')) change(el.dataset.key, el.checked);
      else if (el.id === 's-start') change('start', el.value, false);
      else if (el.id === 's-photo-file' && el.files[0]) setPhoto(el.files[0]).then(redraw);
      else if (el.id === 's-restore' && el.files[0]) restore(el.files[0]);
    });
    body.addEventListener('input', e => {
      const el = e.target;
      if (el.id === 's-name') { change('name', el.value.slice(0, 30), false); tick(); }
      else if (el.id === 's-accent') change('accent', el.value, false);
      else if (el.matches('input[type=range][data-key]')) { change(el.dataset.key, +el.value, false); el.previousElementSibling.textContent = el.value + '%'; }
    });
  }
  function setPhoto(file) {   // your own picture as the background (made smaller so it fits in the browser's storage)
    return new Promise(res => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        let ok = false; try { localStorage.setItem('app-wallpaper', c.toDataURL('image/jpeg', 0.82)); ok = true; } catch (e) {}
        if (ok) { change('wall', 'photo'); S.toast('🖼️ New background'); } else { change('wall', 'aurora'); S.toast('That picture is too big to keep, sorry. Try a smaller one.'); }
        res();
      };
      img.onerror = () => { URL.revokeObjectURL(url); S.toast('That file doesn\'t look like a picture.'); res(); };
      img.src = url;
    });
  }
  function backup() {
    const data = {};
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); data[k] = localStorage.getItem(k); } } catch (e) {}
    const blob = new Blob([JSON.stringify({ site: 'mikaeel', version: 1, saved: new Date().toISOString(), data })], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `mikaeel-site-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    S.toast(`⬇️ Backed up ${Object.keys(data).length} things`);
  }
  async function restore(file) {
    let b = null; try { b = JSON.parse(await file.text()); } catch (e) {}
    if (!b || b.site !== 'mikaeel' || !b.data || typeof b.data !== 'object') { S.toast('That isn\'t a backup from this site.'); return; }
    const items = Object.entries(b.data).filter(([k, v]) => typeof k === 'string' && typeof v === 'string');
    const when = b.saved ? new Date(b.saved).toLocaleDateString() : 'an earlier day';
    if (!confirm(`Restore ${items.length} things from the backup made on ${when}? Anything with the same name on this device is replaced.`)) return;
    let n = 0; for (const [k, v] of items) { try { localStorage.setItem(k, v); n++; } catch (e) {} }
    S.toast(`⬆️ Restored ${n} things. Reloading…`); setTimeout(() => location.reload(), 900);
  }

  // ---------- installing the app ----------
  let installEvt = null;
  const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const siteInstall = $('#install-btn');
  function showInstall() { const can = !S.standalone() && (installEvt || iOS); if (siteInstall) siteInstall.hidden = !can; if (built) $('#a-install').hidden = !can; }
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; showInstall(); });
  addEventListener('appinstalled', () => { installEvt = null; showInstall(); S.toast('📲 Installed! Find it on your home screen.'); });
  async function install() {
    if (installEvt) { installEvt.prompt(); await installEvt.userChoice; installEvt = null; showInstall(); return; }
    if (iOS) sheet('📲 Install on your iPhone or iPad', `<ol class="a-steps"><li>Tap the <b>Share</b> button <span aria-hidden="true">(the square with an arrow ⬆️)</span> at the bottom or top of Safari.</li><li>Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. It opens like an app, full screen, with this home screen.</li></ol>`, () => {});
  }
  if (siteInstall) siteInstall.addEventListener('click', install);

  // ---------- start ----------
  const toApp = $('#app-btn');
  if (toApp) toApp.addEventListener('click', () => change('view', 'app'));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (themeNow() === 'auto') setTheme('auto'); });
  addEventListener('storage', e => { if (e.key === 'app-settings') { set = S.settings(); applyLook(); if (built) drawHome(); } });
  addEventListener('pageshow', e => { if (e.persisted && built) drawHome(); });   // (coming back from an app: fresh "Jump back in" and recents)
  applyLook(); chooseView(); showInstall();
  window.AppHome = { get settings() { return set; }, get layout() { return L; }, openSettings, setEditing, openTile };
})();
