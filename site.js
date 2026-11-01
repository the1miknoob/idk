// Shared by every page: quick-jump search (Ctrl+K or /), offline support, and the app shell when the site is installed as an app
// (a home button on every page, recently opened apps, calm mode and an offline notice). Settings come from the home screen's ⚙️ Customize.
(function () {
  'use strict';
  const ROOT = new URL('./', document.currentScript.src).href;   // the site's home folder, wherever this page is

  // ✏️ EDIT: every page you can jump to: [emoji, name, address, search words, kind ('app' or 'game'), icon color, a line about it]
  const PAGES = [
    ['🏠', 'Home', '', 'start main about projects', 'home', '#5b5bd6', 'Back to the start'],
    ['🎵', 'Music Player', 'music-player/', 'songs audio play skins stickers', 'app', '#e0457b', 'Your songs, with skins, visualizers and stickers'],
    ['📊', 'Dashboard', 'dashboard/', 'clock weather todo notes timer countdown', 'app', '#3b82f6', 'Clock, weather, to-dos, notes and a focus timer'],
    ['🛰️', 'World Watch', 'world-watch/', 'map news war conflicts earthquakes space live tv', 'app', '#0e9f9e', 'A live world map: news, earthquakes, storms, the space station'],
    ['🛡️', 'Armor Pen Sim', 'armor-sim/', 'tank shell armor penetration ricochet heat sim sandbox physics particles vehicle builder destruction turret rocket missile rpg motor tail fins projectile maker make your own shell custom aim-9 sidewinder amraam air-to-air fighter jet challenges volley burst formulas ballistic limit plutonium dart cannonball musket pykrete tiger panther maus t-34 sherman kv-1 churchill pershing leopard abrams t-90 bmp merkava armata t-14 bob semple', 'app', '#64748b', 'Fire shells at armor and at tanks made of particles'],
    ['🎮', 'Games Arcade', 'games/', 'all games play', 'app', '#8b5cf6', 'All the games in one place'],
    ['🧩', 'Block Pop', 'games/block-pop/', 'puzzle blocks', 'game', '#06b6d4', 'Fit the blocks, clear the lines'],
    ['🪐', 'Merge Drop', 'games/merge-drop/', 'planets merge puzzle', 'game', '#6366f1', 'Drop and merge the planets'],
    ['🔤', 'Word Hunt', 'games/word-hunt/', 'word daily guess', 'game', '#65a30d', 'Guess the word of the day'],
    ['🌙', 'Night Swarm', 'games/night-swarm/', 'survive action', 'game', '#4338ca', 'Survive the swarm for as long as you can'],
    ['🎈', 'Sky Hop', 'games/sky-hop/', 'tap fly arcade', 'game', '#0ea5e9', 'Tap to fly through the gaps'],
    ['🐍', 'Snake', 'games/snake/', 'classic arcade', 'game', '#16a34a', 'The classic: eat and grow'],
    ['🔢', '2048', 'games/2048/', 'tiles numbers puzzle', 'game', '#ca8a04', 'Slide the tiles to make 2048'],
    ['⚡', 'Reaction Lab', 'games/reaction-lab/', 'reaction time aim memory', 'game', '#ea580c', 'Test your reactions, aim and memory'],
    ['♟️', 'Chess', 'games/chess/', 'board strategy analysis', 'game', '#78716c', 'Play the computer or a friend'],
    ['⌨️', 'Typing Test', 'typing-test/', 'wpm speed keyboard', 'app', '#d97706', 'How fast can you type?'],
    ['🏆', 'Tier List Maker', 'tier-list/', 'rank s tier', 'app', '#dc2626', 'Rank anything from S to F'],
    ['🎡', 'Spin the Wheel', 'spin-wheel/', 'random picker decide', 'app', '#22a35a', 'Can\'t decide? Let the wheel pick'],
  ];

  // ---------- Settings (changed on the home screen: ⚙️ Customize) ----------
  const DEFAULTS = {
    view: 'auto',            // home page: 'auto' (the app home screen when installed), 'app' or 'site'
    accent: '',              // your own accent color ('' = the usual purple)
    wall: 'aurora', dim: 35, // home screen background: 'aurora', 'gradient', 'dots', 'plain' or 'photo' (dim: how much darker your photo is made, %)
    font: 'grotesk', text: 100,
    icon: 'm', shape: 'rounded', labels: true, layout: 'grid', group: true,
    name: '', clock: true, greeting: true, search: true, cont: true, recent: true, dock: true, hour: 'auto', seconds: false,
    start: '',               // the app that opens when you launch the installed app ('' = the home screen)
    homeBtn: 'auto', corner: 'bl',   // the 🏠 button on other pages: 'auto' (only in the app), 'always' or 'never', and which corner
    calm: false,             // turn off animations on every page
  };
  function settings() {
    let s = null; try { s = JSON.parse(localStorage.getItem('app-settings')); } catch (e) {}
    return Object.assign({}, DEFAULTS, s && typeof s === 'object' ? s : {});
  }
  function saveSettings(s) { try { localStorage.setItem('app-settings', JSON.stringify(s)); } catch (e) {} }

  // Running as the installed app? (launching it opens ?source=app, remembered for the rest of the visit)
  const standalone = () => matchMedia('(display-mode: standalone), (display-mode: minimal-ui), (display-mode: fullscreen)').matches || navigator.standalone === true;
  try { if (/[?&]source=app\b/.test(location.search)) sessionStorage.setItem('in-app', '1'); } catch (e) {}
  const inApp = () => { if (standalone()) return true; try { return sessionStorage.getItem('in-app') === '1'; } catch (e) { return false; } };

  const here = () => { const p = location.href.split(/[?#]/)[0].replace(/index\.html$/, ''); return PAGES.find(x => ROOT + x[2] === p); };

  // ---------- Offline support (only on the real website, not when opened as a file) ----------
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    addEventListener('load', () => navigator.serviceWorker.register(ROOT + 'sw.js').catch(() => {}));
  }

  // ---------- Recently opened (for the home screen) ----------
  function recent() { try { const r = JSON.parse(localStorage.getItem('site-recent')); return Array.isArray(r) ? r : []; } catch (e) { return []; } }
  (function remember() {
    const p = here(); if (!p || !p[2]) return;
    const list = [{ p: p[2], t: Date.now() }, ...recent().filter(r => r && r.p !== p[2])].slice(0, 12);
    try { localStorage.setItem('site-recent', JSON.stringify(list)); } catch (e) {}
  })();

  // ---------- The app shell ----------
  const css = document.createElement('style');
  css.textContent = `
    .site-home { position: fixed; z-index: 99990; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; font-size: 20px; line-height: 1;
      text-decoration: none; background: rgba(18,22,34,.6); border: 1px solid rgba(255,255,255,.2); box-shadow: 0 6px 18px rgba(0,0,0,.3);
      -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); opacity: .8; transition: opacity .15s, transform .15s; -webkit-tap-highlight-color: transparent;
      -webkit-touch-callout: none; user-select: none; -webkit-user-select: none; }
    .site-home:hover, .site-home:focus-visible { opacity: 1; transform: scale(1.06); text-decoration: none; }
    .site-home:focus-visible { outline: 2px solid var(--site-accent, #8b8bf5); outline-offset: 2px; }
    .site-home.tl, .site-home.tr { top: calc(10px + env(safe-area-inset-top, 0px)); }
    .site-home.bl, .site-home.br { bottom: calc(12px + env(safe-area-inset-bottom, 0px)); }
    .site-home.tl, .site-home.bl { left: calc(10px + env(safe-area-inset-left, 0px)); }
    .site-home.tr, .site-home.br { right: calc(10px + env(safe-area-inset-right, 0px)); }
    .site-toast { position: fixed; left: 50%; bottom: calc(18px + env(safe-area-inset-bottom, 0px)); transform: translate(-50%, 20px); z-index: 99995; max-width: calc(100% - 32px);
      background: #151a26; color: #eef1f7; border: 1px solid #2c3550; border-radius: 999px; padding: 9px 16px; font: 14px/1.35 system-ui, sans-serif;
      box-shadow: 0 10px 30px rgba(0,0,0,.35); opacity: 0; pointer-events: none; transition: opacity .2s, transform .2s; }
    .site-toast.show { opacity: 1; transform: translate(-50%, 0); }`;
  document.head.appendChild(css);
  function applyCalm(on) {   // calm mode: no animations or smooth scrolling on any page
    let st = document.getElementById('site-calm');
    if (on && !st) { st = document.createElement('style'); st.id = 'site-calm'; st.textContent = '*, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; scroll-behavior: auto !important; }'; document.head.appendChild(st); }
    if (!on && st) st.remove();
  }
  let toastEl = null, toastT = 0;
  function toast(msg, ms = 3200) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'site-toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), ms);
  }
  let homeEl = null;
  function homeButton(s = settings()) {   // a way home from every other page (the installed app has no address bar or back button on some phones)
    const show = here() !== PAGES[0] && (s.homeBtn === 'always' || (s.homeBtn === 'auto' && inApp()));
    if (!show) { if (homeEl) { homeEl.remove(); homeEl = null; } return; }
    if (!homeEl) {
      homeEl = document.createElement('a'); homeEl.href = ROOT; homeEl.textContent = '🏠'; homeEl.title = 'Home (hold it to jump anywhere)'; homeEl.setAttribute('aria-label', 'Home');
      let hold = 0, held = false;
      homeEl.addEventListener('pointerdown', () => { held = false; hold = setTimeout(() => { held = true; open(); }, 550); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => homeEl.addEventListener(t, () => clearTimeout(hold)));
      homeEl.addEventListener('click', e => { if (held) e.preventDefault(); });
      homeEl.addEventListener('contextmenu', e => e.preventDefault());
      document.body.appendChild(homeEl);
    }
    homeEl.className = 'site-home ' + (['tl', 'tr', 'bl', 'br'].includes(s.corner) ? s.corner : 'bl');
    if (s.accent) homeEl.style.setProperty('--site-accent', s.accent);
  }
  (function shell() {
    const s = settings();
    applyCalm(s.calm);
    const go = () => homeButton(s);
    if (document.body) go(); else addEventListener('DOMContentLoaded', go);
    if (inApp()) {
      addEventListener('offline', () => toast('📴 You\'re offline. Saved pages and games still work.'));
      addEventListener('online', () => toast('✅ Back online'));
    }
  })();

  // ---------- Quick jump ----------
  let box = null, list = null, input = null, sel = 0, shown = [];
  function build() {
    const st = document.createElement('style');
    st.textContent = `
      .sj-back { position: fixed; inset: 0; z-index: 99999; background: rgba(5,8,15,.55); backdrop-filter: blur(3px); display: none; align-items: flex-start; justify-content: center; padding: 12vh 16px 16px; }
      .sj-back.open { display: flex; }
      .sj { width: min(520px, 100%); background: #151a26; color: #eef1f7; border: 1px solid #2c3550; border-radius: 16px; box-shadow: 0 24px 60px rgba(0,0,0,.45); overflow: hidden; font: 15px/1.4 "Space Grotesk", system-ui, sans-serif; }
      .sj input { width: 100%; box-sizing: border-box; padding: 16px 18px; border: none; border-bottom: 1px solid #2c3550; background: transparent; color: inherit; font: inherit; font-size: 17px; outline: none; }
      .sj ul { list-style: none; margin: 0; padding: 6px; max-height: min(52vh, 420px); overflow: auto; }
      .sj li a { display: flex; align-items: center; gap: 12px; padding: 9px 12px; border-radius: 10px; color: inherit; text-decoration: none; }
      .sj li a.on { background: #2a3555; }
      .sj li .e { font-size: 20px; width: 26px; text-align: center; }
      .sj li small { margin-left: auto; color: #8b95ad; font-size: 12px; }
      .sj .sj-foot { padding: 8px 14px; border-top: 1px solid #2c3550; color: #8b95ad; font-size: 12px; }
      .sj .sj-none { padding: 16px; color: #8b95ad; text-align: center; }
      .sj kbd { background: #222a3d; border: 1px solid #36405c; border-radius: 5px; padding: 0 5px; font: 11px ui-monospace, monospace; }`;
    document.head.appendChild(st);
    box = document.createElement('div');
    box.className = 'sj-back';
    box.innerHTML = '<div class="sj" role="dialog" aria-modal="true" aria-label="Jump to a page"><input type="text" placeholder="Where to? Type a game or app…" aria-label="Search pages" autocomplete="off" spellcheck="false"><ul role="listbox"></ul><div class="sj-foot"><kbd>↑</kbd> <kbd>↓</kbd> to pick · <kbd>Enter</kbd> to go · <kbd>Esc</kbd> to close</div></div>';
    document.body.appendChild(box);
    list = box.querySelector('ul'); input = box.querySelector('input');
    input.addEventListener('input', () => { sel = 0; render(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(shown.length, 1); render(); }
      else if (e.key === 'Enter' && shown[sel]) { location.href = ROOT + shown[sel][2]; }
      else if (e.key === 'Escape') close();
    });
    box.addEventListener('click', e => { if (e.target === box) close(); });
  }
  function render() {
    const q = input.value.trim().toLowerCase();
    shown = PAGES.filter(p => !q || (p[1] + ' ' + p[3]).toLowerCase().includes(q));
    if (q) shown.sort((a, b) => b[1].toLowerCase().startsWith(q) - a[1].toLowerCase().startsWith(q));
    const cur = here();
    list.innerHTML = shown.length ? shown.map((p, i) => `<li role="option" aria-selected="${i === sel}"><a href="${ROOT + p[2]}" class="${i === sel ? 'on' : ''}"><span class="e">${p[0]}</span>${p[1]}${p === cur ? '<small>you are here</small>' : ''}</a></li>`).join('')
      : '<li class="sj-none">Nothing found</li>';
    const on = list.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' });
  }
  function open() { if (!box) build(); box.classList.add('open'); input.value = ''; sel = 0; render(); input.focus(); }
  function close() { if (box) box.classList.remove('open'); }
  addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName) || (document.activeElement && document.activeElement.isContentEditable);
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); box && box.classList.contains('open') ? close() : open(); }
    else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && document.body.dataset.noSlash === undefined) { e.preventDefault(); open(); }
  });
  window.SiteJump = { open, close, pages: PAGES, root: ROOT, settings, saveSettings, DEFAULTS, inApp, standalone, recent, toast, applyCalm, homeButton };
})();
