// Shared helpers for every game page: theme, saving, best scores, sounds and small UI bits.
(function () {
  const root = document.documentElement;

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };

  // ---- Light / dark theme (shared with the rest of the site) ----
  const isDark = () => root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  function applyTheme() {
    let t = null; try { t = localStorage.getItem('theme'); } catch (e) {}
    if (t) root.dataset.theme = t; else delete root.dataset.theme;
    document.querySelectorAll('[data-theme-toggle]').forEach(b => b.textContent = isDark() ? '☀️' : '🌙');
    document.dispatchEvent(new Event('themechange'));
  }
  document.addEventListener('click', e => {
    if (!e.target.closest('[data-theme-toggle]')) return;
    try { localStorage.setItem('theme', isDark() ? 'light' : 'dark'); } catch (err) {}
    applyTheme();
  });

  // ---- Sounds (can be muted with the 🔊 button) ----
  let ac = null;
  let muted = store.get('games-muted', false);
  function tone(freq, dur = 0.1, type = 'triangle', vol = 0.2, delay = 0, slideTo = null) {
    if (muted) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const t0 = ac.currentTime + delay;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(ac.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    } catch (e) {}
  }
  const SOUNDS = {
    click: () => tone(700, 0.05, 'triangle', 0.08),
    place: () => tone(330, 0.08, 'triangle', 0.2),
    pop: () => { tone(520, 0.08, 'sine', 0.2); tone(780, 0.1, 'sine', 0.15, 0.05); },
    clear: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.14, 'sine', 0.15, i * 0.06)),
    point: () => tone(880, 0.06, 'square', 0.06),
    flap: () => tone(400, 0.08, 'sine', 0.12, 0, 700),
    hit: () => tone(180, 0.25, 'sawtooth', 0.15, 0, 60),
    lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.18, 'triangle', 0.18, i * 0.12)),
    win: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.16, 'sine', 0.16, i * 0.08)),
    error: () => tone(150, 0.15, 'square', 0.08),
    level: () => [440, 554, 659, 880].forEach((f, i) => tone(f, 0.12, 'sine', 0.15, i * 0.07)),
  };
  function sfx(name) { (SOUNDS[name] || (() => {}))(); }
  function setMuted(m) {
    muted = m; store.set('games-muted', m);
    document.querySelectorAll('[data-mute-toggle]').forEach(b => { b.textContent = m ? '🔇' : '🔊'; b.title = m ? 'Sound off' : 'Sound on'; });
  }
  document.addEventListener('click', e => { if (e.target.closest('[data-mute-toggle]')) setMuted(!muted); });

  // ---- Best scores (shown on the Games page too) ----
  function best(id, score, lowerIsBetter = false) {
    const key = 'game-best-' + id;
    const old = store.get(key, null);
    if (score === undefined) return old;
    const better = old === null || (lowerIsBetter ? score < old : score > old);
    if (better) store.set(key, score);
    return { best: better ? score : old, isNew: better && old !== null, first: old === null };
  }
  function played(id) {
    const s = store.get('games-played', {});
    s[id] = (s[id] || 0) + 1;
    store.set('games-played', s);
    store.set('games-last', { id, at: Date.now() });
  }

  // ---- Toast message ----
  let toastTimer;
  function toast(msg, ms = 1600) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  // ---- Swipe detection for touch screens ----
  function onSwipe(el, cb, min = 24) {
    let sx = 0, sy = 0, active = false;
    el.addEventListener('touchstart', e => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; active = true; }, { passive: true });
    el.addEventListener('touchmove', e => { if (active) e.preventDefault(); }, { passive: false });
    el.addEventListener('touchend', e => {
      if (!active) return; active = false;
      const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < min) return;
      cb(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    });
  }

  // ---- Confetti burst ----
  function confetti(n = 80) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c = document.createElement('canvas');
    c.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:60';
    document.body.appendChild(c);
    const dpr = devicePixelRatio || 1; c.width = innerWidth * dpr; c.height = innerHeight * dpr;
    const x = c.getContext('2d'); x.scale(dpr, dpr);
    const colors = ['#e5484d', '#ffc53d', '#30a46c', '#0090ff', '#8e4ec6', '#ff8a3d', '#d6409f'];
    const ps = Array.from({ length: n }, () => ({
      x: innerWidth / 2, y: innerHeight / 3, vx: (Math.random() - .5) * 14, vy: -Math.random() * 12 - 4,
      r: Math.random() * 6.28, vr: (Math.random() - .5) * .3, c: colors[Math.floor(Math.random() * colors.length)], w: 6 + Math.random() * 6,
    }));
    let frames = 0;
    (function tick() {
      x.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of ps) {
        p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vx *= 0.99;
        x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.fillRect(-p.w / 2, -p.w / 4, p.w, p.w / 2); x.restore();
      }
      if (++frames < 150) requestAnimationFrame(tick); else c.remove();
    })();
  }

  window.GS = { store, sfx, tone, best, played, toast, onSwipe, confetti, isDark, applyTheme, setMuted, get muted() { return muted; } };
  applyTheme();
  setMuted(muted);
})();
