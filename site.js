// Shared by every page: quick-jump search (Ctrl+K or /) and offline support.
(function () {
  'use strict';
  const ROOT = new URL('./', document.currentScript.src).href;   // the site's home folder, wherever this page is

  // ✏️ EDIT: every page you can jump to
  const PAGES = [
    ['🏠', 'Home', '', 'start main about projects'],
    ['🎵', 'Music Player', 'music-player/', 'songs audio play skins stickers'],
    ['📊', 'Dashboard', 'dashboard/', 'clock weather todo notes timer countdown'],
    ['🛰️', 'World Watch', 'world-watch/', 'map news war conflicts earthquakes space live tv'],
    ['🎮', 'Games Arcade', 'games/', 'all games play'],
    ['🧩', 'Block Pop', 'games/block-pop/', 'puzzle blocks'],
    ['🪐', 'Merge Drop', 'games/merge-drop/', 'planets merge puzzle'],
    ['🔤', 'Word Hunt', 'games/word-hunt/', 'word daily guess'],
    ['🌙', 'Night Swarm', 'games/night-swarm/', 'survive action'],
    ['🎈', 'Sky Hop', 'games/sky-hop/', 'tap fly arcade'],
    ['🐍', 'Snake', 'games/snake/', 'classic arcade'],
    ['🔢', '2048', 'games/2048/', 'tiles numbers puzzle'],
    ['⚡', 'Reaction Lab', 'games/reaction-lab/', 'reaction time aim memory'],
    ['♟️', 'Chess', 'games/chess/', 'board strategy analysis'],
    ['⌨️', 'Typing Test', 'typing-test/', 'wpm speed keyboard'],
    ['🏆', 'Tier List Maker', 'tier-list/', 'rank s tier'],
    ['🎡', 'Spin the Wheel', 'spin-wheel/', 'random picker decide'],
  ];

  // ---------- Offline support (only on the real website, not when opened as a file) ----------
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    addEventListener('load', () => navigator.serviceWorker.register(ROOT + 'sw.js').catch(() => {}));
  }

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
  const here = () => { const p = location.href.split(/[?#]/)[0].replace(/index\.html$/, ''); return PAGES.find(x => ROOT + x[2] === p); };
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
  window.SiteJump = { open, close, pages: PAGES, root: ROOT };
})();
