// Nuke Sim — the renderer: everything that flies, flashes or glows on top of the Leaflet map.
//
// It draws on three <canvas> layers inside its own map pane (above the map tiles and country shapes, below labels,
// markers and popups; it never catches clicks), bottom to top:
//  • the "animated" layer, redrawn every frame: missiles climbing in tall arcs with trails that go from red at the
//    launch to orange and yellow at the warhead, and white aircraft flying away from their bases;
//  • the "damage" layer: launch sites (silo dots, submarines), little colored city dots, fallout plumes and, for
//    every detonation, a white smoke puff over a red glow (like the videos). It is only redrawn when the map
//    moves/zooms/resizes (new detonations are painted onto it as they happen), so thousands of blasts cost almost
//    nothing per frame;
//  • the "flash" layer, redrawn every frame: white detonation flashes and expanding shock rings.
//
// How to use it (the app does this):
//   const r = new NS.Renderer(map);   // once, after the Leaflet map exists
//   r.setStrikes(scenario.strikes);   // every planned strike (in-flight ones are drawn automatically from their times)
//   r.setSites(scenario.sites);       // launch sites: silo dots, little submarines, bases
//   r.frame(simTime);                 // every animation frame (also while paused, so flashes finish and the map stays right)
//   r.detonate(strike);               // when a strike reaches its target (sim time ≥ launchAt + flight)
//   r.detonate(strike, { instant: true })  // same, but without the flash — e.g. when catching up after a seek
//                                         // ({ flash: false } works too)
//   r.addStrike(strike);              // custom mode: one more missile
//   r.reset();                        // forget all detonations and flashes (strikes and sites stay)
//   r.options = { trails: true, damage: true, fallout: true }   // can be changed at any time
//   r.stats → { inFlight, drawn, flashes, detonations, frameMs, staticMs }   // handy for tests
//   r.destroy();                      // remove the canvases again
//
// Missiles are drawn purely from the clock: a strike is in the air while launchAt ≤ t < launchAt + flight,
// so seeking backwards or forwards just works for them. Detonations are remembered until reset().
(function (root) {
  'use strict';
  const NS = root.NS = root.NS || {};

  // ✏️ EDIT: the look. Sizes are screen pixels, flash timings are real seconds (not sim time).
  const LOOK = {
    trail: 0.55,                  // share of the flight path that stays lit behind each missile
    trailFrom: '#ff1a00',         // tail end of a trail (red, near the launch)…
    trailTo: '#ffcc00',           // …through orange up to yellow near the warhead
    trailWidth: [0.8, 1.4],       // line width at the tail and at the head
    trailAlpha: [0.35, 0.9],      // how strong the tail and the head end are
    // Soft glow dabs just behind each warhead: [how far back (share of the whole path), radius px, strength]
    glowStamps: [[0.012, 4.5, 0.55], [0.035, 3.6, 0.32], [0.07, 3, 0.18]],
    adaptive: true,               // on a slow computer, shorten the faint tail ends when thousands of missiles fly at once
    headColor: '#fff3b0',         // the bright warhead dot
    headSize: 7,                  // radius of the warhead's glow
    // How tall the arc is, as a share of its length on screen (ICBMs climb high, submarine and short-range missiles less,
    // bombers and cruise missiles hug the ground)
    arc: { silo: 0.30, mobile: 0.28, sub: 0.22, tactical: 0.13, bomber: 0.03 },
    arcMax: 0.55,                 // …but no arc is taller than this share of the map's height
    flash: 0.3,                   // white flash (s)
    ring: 1.2,                    // shock ring (s)
    afterglow: 2.6,               // extra-bright glow that settles into the lasting damage glow (s)
    // The shared effect colours (same as the legend and the custom rings)
    colors: { fireball: '#fff4c2', psi20: '#ff2d2d', psi5: '#ff8a1f', thermal: '#ffd23f', psi1: '#9ca3af', fallout: '#a855f7' },
    // Smallest size each damage disc is drawn at, so blasts stay visible when zoomed out
    minPx: { fireball: 1.5, psi20: 2.6, psi5: 4.2, thermal: 5.4, psi1: 7 },
    // How strong each disc is. They add up (additive blending), so many overlapping blasts burn white-hot.
    alpha: { fireball: 0.9, psi20: 0.42, psi5: 0.24, thermal: 0.12, psi1: 0.10, fallout: 0.15 },
    falloutGrow: 2400,            // sim seconds for a fallout plume to stretch to its full length
    sides: { red: '#ef4444', blue: '#3b82f6' },   // bases are drawn in their side's colour
    // Each detonation leaves a white smoke cloud (seen from above) over a red glow, like the videos.
    // Sizes: the cloud covers the heavy-blast ring, the glow the moderate-blast ring, but never smaller than
    // these many pixels (the minimum grows as you zoom in, so hits stay big and readable)
    puffMin: [3.2, 1.9],          // px at zoom 2, and how much more per zoom level
    puffMax: 15,                  // …up to this many px
    glowAlpha: 0.75,
    cityColors: { big: '#ffe14a', mid: '#57d957', small: '#41d6e8', target: '#ff2a2a' },   // ≥ 1 million, ≥ 300,000, smaller, military targets
    plane: '#ffffff',
  };

  const PANE = 'nukeSimPane';
  const PANE_Z = 450;             // above tiles (200) and country shapes (400), below markers (600) / tooltips / popups
  const PAD = 0.15;               // the damage layer is drawn this much bigger than the map on each side (smooth drags)
  const MAX_DPR = 2;              // sharper than this isn't worth the cost
  const MAX_DPR_DAMAGE = 1.5;     // the soft damage glows look the same at lower resolution
  const D2R = Math.PI / 180;
  const RING_ORDER = ['psi1', 'thermal', 'psi5', 'psi20', 'fireball'];   // outermost first

  // ---------- a small built-in blast model, only used if effects.js isn't loaded ----------
  const FALLBACK = {
    radii(y, burst) {
      y = Math.max(0, +y || 0);
      const g = burst === 'ground' || burst === 'surface', c = Math.cbrt(y);
      return { fireball: (g ? 0.09 : 0.07) * Math.pow(y, 0.4), psi20: (g ? 0.23 : 0.28) * c, psi5: (g ? 0.45 : 0.68) * c,
        thermal: Math.min((g ? 0.5 : 0.6) * Math.pow(y, 0.41), (g ? 1.2 : 1.75) * c), psi1: (g ? 1.2 : 1.75) * c };
    },
    fallout(y, burst) {
      y = Math.max(0, +y || 0);
      if (!y || (burst !== 'ground' && burst !== 'surface')) return { length: 0, width: 0 };
      const length = 25 * Math.pow(y, 0.45);
      return { length, width: length / 6 };
    },
  };
  function blastRadii(y, burst) {
    const E = NS.Effects;
    let r = null;
    try { if (E && typeof E.radii === 'function') r = E.radii(y, burst); } catch (e) { r = null; }
    const f = FALLBACK.radii(y, burst), out = {};
    for (const k of RING_ORDER) out[k] = r && isFinite(r[k]) && r[k] >= 0 ? +r[k] : f[k];
    return out;
  }
  function falloutSize(y, burst) {
    const E = NS.Effects;
    let r = null;
    try { if (E && typeof E.fallout === 'function') r = E.fallout(y, burst); } catch (e) { r = null; }
    if (!r || !isFinite(r.length) || !isFinite(r.width)) r = FALLBACK.fallout(y, burst);
    return { length: Math.max(0, +r.length), width: Math.max(0, +r.width) };
  }

  // ---------- small helpers ----------
  function hexRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rgba(rgb, a) { return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (+a).toFixed(3) + ')'; }
  function mix(a, b, f) { return [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * f)); }
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  // Trail colour bands, from the tail (0) to the head. All trails are drawn band by band in a few big batches.
  const BANDS = 6;
  const BAND_STYLE = [], BAND_WIDTH = [];
  (function () {
    const a = hexRgb(LOOK.trailFrom), b = hexRgb(LOOK.trailTo);
    for (let i = 0; i < BANDS; i++) {
      const f = i / (BANDS - 1);
      // mostly red along the trail, turning orange and then yellow only near the warhead
      BAND_STYLE.push(rgba(mix(a, b, Math.pow(f, 1.8)), LOOK.trailAlpha[0] + (LOOK.trailAlpha[1] - LOOK.trailAlpha[0]) * Math.pow(f, 1.2)));
      BAND_WIDTH.push(LOOK.trailWidth[0] + (LOOK.trailWidth[1] - LOOK.trailWidth[0]) * f);
    }
  })();

  // ---------- pre-drawn glow pictures ("sprites"), made once and stamped thousands of times ----------
  let SPR = null;
  function canvasOf(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function radial(size, stops) {
    const c = canvasOf(size, size), g = c.getContext('2d'), h = size / 2;
    const grd = g.createRadialGradient(h, h, 0, h, h, h);
    for (const s of stops) grd.addColorStop(s[0], s[1]);
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    return c;
  }
  function disc(hex) {   // a soft-edged disc: solid in the middle, fading out at its rim
    const c = hexRgb(hex);
    return radial(128, [[0, rgba(c, 1)], [0.55, rgba(c, 0.9)], [0.82, rgba(c, 0.55)], [0.93, rgba(c, 0.2)], [1, rgba(c, 0)]]);
  }
  function makeSprites() {
    const head = hexRgb(LOOK.headColor);
    const S = {
      spark: radial(32, [[0, 'rgba(255,190,60,0.9)'], [0.35, 'rgba(255,120,0,0.45)'], [1, 'rgba(255,90,0,0)']]),
      head: radial(64, [[0, 'rgba(255,255,248,1)'], [0.1, rgba(head, 1)], [0.2, 'rgba(255,208,0,0.8)'],
        [0.42, 'rgba(255,120,0,0.3)'], [0.7, 'rgba(255,90,0,0.08)'], [1, 'rgba(255,90,0,0)']]),
      flash: radial(128, [[0, 'rgba(255,255,255,1)'], [0.22, 'rgba(255,255,255,0.95)'], [0.45, 'rgba(255,248,230,0.55)'],
        [0.7, 'rgba(255,225,180,0.18)'], [1, 'rgba(255,210,160,0)']]),
      ring: radial(256, [[0, 'rgba(255,120,30,0)'], [0.6, 'rgba(255,110,20,0)'], [0.8, 'rgba(255,140,40,0.35)'],
        [0.9, 'rgba(255,238,205,0.95)'], [0.95, 'rgba(255,170,80,0.45)'], [1, 'rgba(255,100,20,0)']]),
      glow: radial(64, [[0, 'rgba(255,252,240,1)'], [0.15, 'rgba(255,220,170,0.9)'], [0.36, 'rgba(255,80,40,0.55)'],
        [0.7, 'rgba(255,30,30,0.14)'], [1, 'rgba(255,30,30,0)']]),
      disc: {},
    };
    for (const k of RING_ORDER) S.disc[k] = disc(LOOK.colors[k]);

    // One ready-made picture of a blast at its smallest size (what you see when zoomed out): one stamp per blast
    const res = 4, R = LOOK.minPx.psi1 + 1, mini = canvasOf(Math.ceil(R * 2 * res), Math.ceil(R * 2 * res));
    const g = mini.getContext('2d');
    g.globalCompositeOperation = 'lighter';
    for (const k of RING_ORDER) {
      const r = LOOK.minPx[k] * res;
      g.globalAlpha = LOOK.alpha[k];
      g.drawImage(S.disc[k], R * res - r, R * res - r, r * 2, r * 2);
    }
    S.mini = mini; S.miniR = R;

    // Fallout plume: a soft purple cigar, thickest just downwind of ground zero, drawn pointing east (+x)
    const pc = hexRgb(LOOK.colors.fallout), plume = canvasOf(256, 64), pg = plume.getContext('2d');
    for (let i = 0; i <= 24; i++) {
      const x = 14 + i * 9.4, f = i / 24;
      const r = 30 * Math.sin(Math.min(1, (i + 1.5) / 7) * Math.PI / 2) * (1 - 0.7 * f);
      const grd = pg.createRadialGradient(x, 32, 0, x, 32, r);
      grd.addColorStop(0, rgba(pc, 0.22 * (1 - 0.6 * f)));
      grd.addColorStop(1, rgba(pc, 0));
      pg.fillStyle = grd;
      pg.fillRect(x - r, 32 - r, r * 2, r * 2);
    }
    S.plume = plume;

    // A white smoke cloud seen from above: a few overlapping soft circles (three shapes, so a field of them varies)
    S.puff = [0, 1, 2].map(n => {
      const c = canvasOf(96, 96), g = c.getContext('2d');
      let seed = 7 + n * 31;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const blobs = [[0.5, 0.5, 0.3]];
      for (let i = 0; i < 8; i++) { const a = rnd() * Math.PI * 2, d = 0.1 + rnd() * 0.13; blobs.push([0.5 + Math.cos(a) * d, 0.5 + Math.sin(a) * d, 0.12 + rnd() * 0.1]); }
      for (const [x, y, r] of blobs) {
        const grd = g.createRadialGradient(x * 96, y * 96, 0, x * 96, y * 96, r * 96);
        grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.72, 'rgba(250,250,250,0.96)'); grd.addColorStop(1, 'rgba(240,240,240,0)');
        g.fillStyle = grd; g.beginPath(); g.arc(x * 96, y * 96, r * 96, 0, Math.PI * 2); g.fill();
      }
      const sh = g.createRadialGradient(60, 62, 0, 60, 62, 40);   // a little shade on one side, so it reads as a cloud
      sh.addColorStop(0, 'rgba(140,140,150,0.3)'); sh.addColorStop(1, 'rgba(140,140,150,0)');
      g.globalCompositeOperation = 'source-atop'; g.fillStyle = sh; g.fillRect(0, 0, 96, 96);
      return c;
    });
    S.redGlow = radial(64, [[0, 'rgba(255,40,20,1)'], [0.35, 'rgba(255,20,10,0.75)'], [0.7, 'rgba(230,0,0,0.25)'], [1, 'rgba(200,0,0,0)']]);

    // Launch sites (drawn at 2× for sharp edges on hi-dpi screens): silos are yellow dots with a green halo
    S.silo = radial(24, [[0, 'rgba(255,225,60,1)'], [0.2, 'rgba(255,220,40,1)'], [0.3, 'rgba(90,220,70,0.75)'],
      [0.6, 'rgba(70,200,60,0.18)'], [1, 'rgba(70,200,60,0)']]);
    // City dots: a tiny solid dot per color
    S.city = {};
    for (const k of Object.keys(LOOK.cityColors)) {
      const c = canvasOf(12, 12), g = c.getContext('2d');
      g.fillStyle = LOOK.cityColors[k]; g.beginPath(); g.arc(6, 6, 4.6, 0, Math.PI * 2); g.fill();
      S.city[k] = c;
    }
    // A white airplane pointing up (turned to the way it flies when drawn)
    S.plane = (() => {
      const c = canvasOf(48, 48), g = c.getContext('2d');
      g.translate(24, 24); g.scale(48 / 64, 48 / 64);
      g.fillStyle = LOOK.plane; g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = 3;
      g.beginPath();
      g.moveTo(0, -26); g.quadraticCurveTo(3, -22, 3, -14); g.lineTo(3, -6); g.lineTo(24, 6); g.lineTo(24, 10); g.lineTo(3, 4);
      g.lineTo(3, 16); g.lineTo(9, 22); g.lineTo(9, 25); g.lineTo(0, 22); g.lineTo(-9, 25); g.lineTo(-9, 22); g.lineTo(-3, 16);
      g.lineTo(-3, 4); g.lineTo(-24, 10); g.lineTo(-24, 6); g.lineTo(-3, -6); g.lineTo(-3, -14); g.quadraticCurveTo(-3, -22, 0, -26);
      g.fill();
      return c;
    })();
    S.sub = {}; S.base = {};
    for (const side of Object.keys(LOOK.sides)) {
      const col = LOOK.sides[side];
      // a submarine seen from the side, like the videos: all red for the red side, grey with a red waterline for the blue side
      const sc = canvasOf(80, 24), s = sc.getContext('2d');   // 40 × 12 px on screen
      s.scale(2, 2);
      const red = side === 'red';
      s.shadowColor = 'rgba(0,0,0,0.6)'; s.shadowBlur = 2;
      s.fillStyle = red ? '#d61f1f' : '#8f969e';
      s.beginPath();
      s.moveTo(3, 6); s.lineTo(33, 6); s.quadraticCurveTo(38.5, 6.6, 38.5, 8.2); s.quadraticCurveTo(38.5, 9.8, 33, 10.4);
      s.lineTo(3, 10.4); s.quadraticCurveTo(0.6, 8.2, 3, 6); s.fill();
      s.shadowBlur = 0;
      s.fillStyle = red ? '#ff7060' : '#d42a2a';
      if (red) s.fillRect(3.5, 6, 28, 0.9); else s.fillRect(3.5, 9, 29, 1.4);
      s.fillStyle = red ? '#b81616' : '#757b83';
      s.fillRect(14.5, 2.4, 3.2, 3.8);                                      // sail (conning tower)
      s.beginPath(); s.moveTo(3.4, 6); s.lineTo(1.6, 3.6); s.lineTo(5.4, 6); s.fill();   // rudder
      S.sub[side] = sc;
      const bc = canvasOf(20, 20), b = bc.getContext('2d');   // 10 × 10 px on screen
      b.scale(2, 2);
      b.beginPath(); b.arc(5, 5, 3.3, 0, Math.PI * 2);
      b.fillStyle = 'rgba(0,0,0,0.35)'; b.fill();
      b.lineWidth = 1.3; b.strokeStyle = col; b.stroke();
      S.base[side] = bc;
    }
    return S;
  }

  // ---------- where a missile is ----------
  // A missile at fraction f of its flight (0 = launch, 1 = target), in canvas pixels. Writes into OUT (no garbage per frame).
  const OUT = { x: 0, y: 0 };
  function pathPoint(S, f, shift, k, ox, oy, h) {
    const P = S.pts, fi = f * S.n;
    let j = fi | 0;
    if (j >= S.n) j = S.n - 1; else if (j < 0) j = 0;
    const r = fi - j, a = j * 2;
    OUT.x = (P[a] + (P[a + 2] - P[a]) * r + shift) * k - ox;
    OUT.y = (P[a + 1] + (P[a + 3] - P[a + 1]) * r) * k - oy - h * Math.sin(Math.PI * f);   // the arc: lifted up the screen
  }
  function tracePath(ctx, S, a, b, segs, shift, k, ox, oy, h) {
    for (let i = 0; i <= segs; i++) {
      pathPoint(S, a + (b - a) * i / segs, shift, k, ox, oy, h);
      if (i === 0) ctx.moveTo(OUT.x, OUT.y); else ctx.lineTo(OUT.x, OUT.y);
    }
  }

  class Renderer {
    constructor(map) {
      const L = root.L;
      if (!L || !map) throw new Error('NS.Renderer needs Leaflet and a map');
      if (!SPR) SPR = makeSprites();
      this._map = map;
      this._L = L;
      this.options = { trails: true, damage: true, fallout: true };
      this.stats = { inFlight: 0, drawn: 0, flashes: 0, detonations: 0, frameMs: 0, staticMs: 0 };
      this._strikes = [];       // prepared strikes (paths pre-computed)
      this._sites = [];
      this._dets = [];          // every detonation so far (kept until reset)
      this._pending = [];       // detonations not yet painted on the damage layer
      this._flashes = [];       // flash / ring / afterglow animations in progress
      this._act = [];           // strikes drawn this frame (re-used array)
      this._vis = [];
      this._t = 0;
      this._dirty = true;       // damage layer needs a full redraw
      this._growing = false;    // some fallout plume is still stretching
      this._lastStatic = 0;
      this._lastStaticT = NaN;
      this._sig = -1;
      this._lod = 0;            // 0 = full trails; higher = shorter faint tails (only when the computer can't keep up)
      this._lodAt = 0;
      this._ema = 0;            // smoothed time between frames (ms)
      this._lastFrameAt = 0;

      // Projection: everything is pre-computed in "zoom 0" map pixels; one multiply turns that into any zoom.
      const crs = map.options.crs;
      this._crs = crs;
      this._merc = crs === L.CRS.EPSG3857;
      this._s0 = crs.scale(0);
      if (this._merc) this._ww = 256;
      else if (crs.wrapLng) this._ww = Math.abs(crs.latLngToPoint(L.latLng(0, 180), 0).x - crs.latLngToPoint(L.latLng(0, -180), 0).x);
      else this._ww = 0;

      // Our own pane, so we sit above the map and the country shapes but below labels and popups
      const pane = map.getPane(PANE) || map.createPane(PANE);
      pane.style.zIndex = PANE_Z;
      pane.style.pointerEvents = 'none';
      this._pane = pane;
      this._anim = this._makeCanvas('ns-render-anim');      // missiles (bottom)
      this._dmg = this._makeCanvas('ns-render-damage');     // smoke puffs, sites, city dots
      this._fx = this._makeCanvas('ns-render-flash');       // flashes (top)
      this._cities = [];
      this._planes = [];

      this._events = {
        zoomanim: this._onZoomAnim, zoom: this._onMove, move: this._onMove, moveend: this._onMoveEnd,
        zoomend: this._onMoveEnd, viewreset: this._onViewReset, resize: this._onResize,
      };
      map.on(this._events, this);
    }

    // ---------- public API ----------

    // All planned strikes. Strikes in the air at the current sim time are drawn by frame().
    setStrikes(strikes) {
      this._strikes = [];
      for (const s of strikes || []) { const p = this._prep(s); if (p) this._strikes.push(p); }
    }
    addStrike(strike) {
      const p = this._prep(strike);
      if (p) this._strikes.push(p);
    }
    setSites(sites) {
      this._sites = [];
      for (const s of sites || []) {
        if (!s || !isFinite(s.lat) || !isFinite(s.lon)) continue;
        const q = this._proj(+s.lat, +s.lon);
        this._sites.push({ X0: q[0], Y0: q[1], kind: s.kind || 'silo', side: s.side === 'blue' ? 'blue' : 'red' });
      }
      this._dirty = true;
    }

    // Tiny colored dots for every city (and red ones for military targets) in these countries, like the videos
    setCityDots(countries) {
      const set = new Set(countries || []);
      this._cities = [];
      if (set.size) {
        for (const c of NS.CITIES || []) {
          if (!set.has(c[1])) continue;
          const q = this._proj(c[2], c[3]);
          this._cities.push({ X0: q[0], Y0: q[1], kind: c[4] >= 1e6 ? 'big' : c[4] >= 3e5 ? 'mid' : 'small' });
        }
        for (const t of NS.TARGETS || []) {
          if (!set.has(t.cc)) continue;
          const q = this._proj(t.lat, t.lon);
          this._cities.push({ X0: q[0], Y0: q[1], kind: 'target' });
        }
      }
      this._dirty = true;
    }

    // Aircraft taking off when the warning comes: [{ lat, lon, bearing (degrees), start (sim s), speed (km/h), range (km) }]
    setAircraft(list) {
      this._planes = (list || []).filter(a => a && isFinite(a.lat) && isFinite(a.lon))
        .map(a => ({ lat: +a.lat, lon: +a.lon, bearing: +a.bearing || 0, start: +a.start || 0, speed: +a.speed || 850, range: +a.range || 3000 }));
    }

    // A warhead goes off: flash + shock ring (real time) and a lasting glow sized by the blast rings.
    // `strike` is a Strike ({ to: { lat, lon }, yieldKt, burst }) or a plain { lat, lon, yieldKt, burst }.
    detonate(strike, opts) {
      if (!strike) return null;
      const at = strike.to || strike;
      const lat = +at.lat, lon = at.lon != null ? +at.lon : +at.lng;
      if (!isFinite(lat) || !isFinite(lon)) return null;
      const y = isFinite(+strike.yieldKt) && +strike.yieldKt > 0 ? +strike.yieldKt : 100;
      const burst = strike.burst === 'ground' || strike.burst === 'surface' ? 'ground' : 'air';
      const r = blastRadii(y, burst);
      const fo = burst === 'ground' ? falloutSize(y, burst) : { length: 0, width: 0 };
      const q = this._proj(lat, lon);
      const tDet = isFinite(strike.launchAt) && isFinite(strike.flight) ? strike.launchAt + strike.flight : this._t;
      // Each plume leans a little differently (but always roughly east), so a field of them doesn't look stamped
      const jit = Math.sin(lat * 12.9898 + lon * 78.233) * 43758.5453;
      const d = {
        X0: q[0], Y0: q[1], ppk0: this._ppk0(lat, lon),
        fireball: r.fireball, psi20: r.psi20, psi5: r.psi5, thermal: r.thermal, psi1: r.psi1,
        fl: fo.length, fw: fo.width, ang: -0.1 + ((jit - Math.floor(jit)) - 0.5) * 0.4, tDet,
        yk: clamp(Math.log10(Math.max(1, y)) / 3, 0.45, 1.3), pv: Math.floor((jit - Math.floor(jit)) * 3) % 3,
        x: 0, y: 0, ppk: 0, mini: false,
      };
      this._dets.push(d);
      this._pending.push(d);
      if (!opts || (opts.flash !== false && !opts.instant)) this._flashes.push({ d, t0: now() });
      return d;
    }

    // Forget every detonation and flash (strikes and sites stay).
    reset() {
      this._dets = [];
      this._pending = [];
      this._flashes = [];
      this._growing = false;
      this._dirty = true;
    }

    // Force a full redraw of the damage layer (normally automatic).
    redraw() { this._dirty = true; }

    destroy() {
      if (!this._map) return;
      this._map.off(this._events, this);
      for (const c of [this._dmg, this._anim, this._fx]) if (c.el.parentNode) c.el.parentNode.removeChild(c.el);
      this._map = null;
    }

    // Call every animation frame with the current sim time (seconds since T+0).
    frame(simTime) {
      const map = this._map;
      if (!map || !map._loaded) return;
      const t0 = now();
      if (isFinite(simTime)) this._t = +simTime;
      const dt = t0 - this._lastFrameAt;
      if (this._lastFrameAt && dt > 0 && dt < 250) this._ema = this._ema ? this._ema * 0.92 + dt * 0.08 : dt;
      this._lastFrameAt = t0;
      const o = this.options || {};
      const sig = (o.damage !== false ? 1 : 0) | (o.fallout !== false ? 2 : 0);
      if (sig !== this._sig) { this._sig = sig; this._dirty = true; }
      this._checkSize();

      const zooming = !!map._animatingZoom;
      let tl = null;
      if (!zooming) {
        tl = map.containerPointToLayerPoint([0, 0]);
        if (this._dirty || this._nearEdge(tl, t0)) this._renderStatic();
        else if (this._growing && t0 - this._lastStatic > 400 && this._t !== this._lastStaticT) this._renderStatic();
      }
      if (this._pending.length) this._paintPending();
      this._drawAnim(tl, t0);
      this.stats.detonations = this._dets.length;
      this.stats.frameMs = now() - t0;
    }

    // ---------- set-up ----------

    _makeCanvas(cls) {
      const L = this._L, el = document.createElement('canvas');
      el.className = cls + (this._map._zoomAnimated ? ' leaflet-zoom-animated' : '');
      el.style.pointerEvents = 'none';
      el.style.position = 'absolute';
      el.setAttribute('aria-hidden', 'true');
      this._pane.appendChild(el);
      L.DomUtil.setPosition(el, L.point(0, 0));
      return { el, ctx: el.getContext('2d'), w: 0, h: 0, dpr: 1, tl: null, po: null, zoom: 0, view: null };
    }

    _checkSize() {
      const size = this._map.getSize();
      const dpr = Math.min(root.devicePixelRatio || 1, MAX_DPR);
      if (size.x !== this._W || size.y !== this._H || dpr !== this._dpr) {
        this._W = size.x; this._H = size.y; this._dpr = dpr;
        for (const a of [this._anim, this._fx]) {
          a.el.width = Math.max(1, Math.round(size.x * dpr));
          a.el.height = Math.max(1, Math.round(size.y * dpr));
          a.el.style.width = size.x + 'px';
          a.el.style.height = size.y + 'px';
          a.dpr = dpr;
        }
        this._dirty = true;
      }
    }

    // lat/lon → zoom-0 map pixels [x, y]
    _proj(lat, lon) {
      if (this._merc) {
        const s = Math.sin(clamp(lat, -85.0511287798, 85.0511287798) * D2R);
        return [(lon + 180) / 360 * 256, 128 - 64 / Math.PI * Math.log((1 + s) / (1 - s))];
      }
      const p = this._crs.latLngToPoint(this._L.latLng(lat, lon), 0);
      return [p.x, p.y];
    }
    // map pixels per km at zoom 0, at this spot (Mercator stretches things towards the poles)
    _ppk0(lat, lon) {
      const la = clamp(lat, -84, 84);
      if (this._merc) return 256 / (2 * Math.PI * 6378.137 * Math.cos(la * D2R));
      const dl = 50 / 111.195, a = this._proj(la - dl, lon), b = this._proj(la + dl, lon);
      return Math.hypot(b[0] - a[0], b[1] - a[1]) / 100;
    }

    // Pre-compute a strike's great-circle path (so per frame it's just a lookup)
    _prep(s) {
      if (!s || !s.from || !s.to || !(+s.flight > 0)) return null;
      const la1 = +s.from.lat, lo1 = s.from.lon != null ? +s.from.lon : +s.from.lng;
      const la2 = +s.to.lat, lo2 = s.to.lon != null ? +s.to.lon : +s.to.lng;
      if (![la1, lo1, la2, lo2].every(isFinite)) return null;
      const c1 = Math.cos(la1 * D2R), c2 = Math.cos(la2 * D2R);
      const ax = c1 * Math.cos(lo1 * D2R), ay = c1 * Math.sin(lo1 * D2R), az = Math.sin(la1 * D2R);
      const bx = c2 * Math.cos(lo2 * D2R), by = c2 * Math.sin(lo2 * D2R), bz = Math.sin(la2 * D2R);
      const d = Math.acos(clamp(ax * bx + ay * by + az * bz, -1, 1)), sd = Math.sin(d);
      const n = clamp(Math.ceil(d / D2R / 2) + 4, 6, 96);
      const pts = new Float64Array((n + 1) * 2);
      let prev = lo1, len = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i <= n; i++) {
        const f = i / n;
        let lat, lon;
        if (sd < 1e-6) { lat = la1 + (la2 - la1) * f; lon = lo1 + (lo2 - lo1) * f; }
        else {
          const A = Math.sin((1 - f) * d) / sd, B = Math.sin(f * d) / sd;
          const x = A * ax + B * bx, y = A * ay + B * by, z = A * az + B * bz;
          lat = Math.atan2(z, Math.hypot(x, y)) / D2R;
          lon = Math.atan2(y, x) / D2R;
        }
        // keep longitudes continuous, so a path never jumps across the date line
        while (lon - prev > 180) lon -= 360;
        while (lon - prev < -180) lon += 360;
        prev = lon;
        const q = this._proj(lat, lon);
        pts[i * 2] = q[0]; pts[i * 2 + 1] = q[1];
        if (i) len += Math.hypot(q[0] - pts[i * 2 - 2], q[1] - pts[i * 2 - 1]);
        if (q[0] < minX) minX = q[0]; if (q[0] > maxX) maxX = q[0];
        if (q[1] < minY) minY = q[1]; if (q[1] > maxY) maxY = q[1];
      }
      const kind = s.from.kind || 'silo';
      return {
        s, pts, n, len, minX, maxX, minY, maxY, mx: (minX + maxX) / 2,
        hf: LOOK.arc[kind] != null ? LOOK.arc[kind] : LOOK.arc.silo,
        t0: +s.launchAt || 0, dur: +s.flight,
        p: 0, sh: 0, h: 0, seg: 2,
      };
    }

    // ---------- keeping the canvases glued to the map ----------

    // How zoom-0 map pixels turn into this canvas' pixels: x = X0 * k - ox
    _viewFor(tl) {
      const map = this._map, z = map.getZoom(), po = map.getPixelOrigin();
      return { k: this._crs.scale(z) / this._s0, ox: po.x + tl.x, oy: po.y + tl.y, z, po };
    }

    // The CSS transform that makes a canvas drawn at an older view line up with the map at (zoom, pixel origin)
    _transformFor(c, zoom, po) {
      const s = this._map.getZoomScale(zoom, c.zoom);
      return { off: this._L.point((c.tl.x + c.po.x) * s - po.x, (c.tl.y + c.po.y) * s - po.y), s };
    }

    _onZoomAnim(e) {
      const map = this._map;
      if (typeof map._getNewPixelOrigin !== 'function') return;
      const po = map._getNewPixelOrigin(e.center, e.zoom);
      for (const c of [this._dmg, this._anim, this._fx]) {
        if (!c.tl) continue;
        const tr = this._transformFor(c, e.zoom, po);
        this._L.DomUtil.setTransform(c.el, tr.off, tr.s);
      }
    }

    // Pinch zoom and flyTo change the zoom without a CSS animation: stretch the damage layer until the move ends
    _onMove() {
      const map = this._map, c = this._dmg;
      if (map._animatingZoom || !c.tl) return;
      const z = map.getZoom();
      if (z === c.zoom && map.getPixelOrigin().equals(c.po)) return;   // plain drag: the pane carries us along
      const tr = this._transformFor(c, z, map.getPixelOrigin());
      this._L.DomUtil.setTransform(c.el, tr.off, tr.s);
    }

    _onMoveEnd() {
      if (!this._map || this._map._animatingZoom) return;
      this._dirty = true;
      this._checkSize();
      this._renderStatic();
      // put the animated layer back in place straight away (it's redrawn on the next frame)
      const tl = this._map.containerPointToLayerPoint([0, 0]);
      for (const a of [this._anim, this._fx]) {
        this._L.DomUtil.setPosition(a.el, tl);
        a.ctx.setTransform(1, 0, 0, 1, 0, 0);
        a.ctx.clearRect(0, 0, a.el.width, a.el.height);
        a.tl = null;
      }
    }
    _onViewReset() { this._dirty = true; }
    _onResize() { this._checkSize(); this._dirty = true; }

    // During a drag the damage layer moves with the map; redraw it before its edge comes into view
    _nearEdge(tl, t) {
      const c = this._dmg;
      if (!c.tl || t - this._lastStatic < 90) return false;
      if (this._map.getZoom() !== c.zoom) return true;
      const m = Math.min(c.padX, c.padY) * 0.3;
      return tl.x < c.tl.x + m || tl.y < c.tl.y + m ||
        tl.x + this._W > c.tl.x + c.w - m || tl.y + this._H > c.tl.y + c.h - m;
    }

    // ---------- the damage layer ----------

    _renderStatic() {
      const map = this._map;
      if (!map || !map._loaded) return;
      const t0 = now();
      this._checkSize();
      const c = this._dmg, W = this._W, H = this._H;
      const padX = Math.round(W * PAD), padY = Math.round(H * PAD);
      const cw = W + padX * 2, ch = H + padY * 2, dpr = Math.min(this._dpr, MAX_DPR_DAMAGE);
      const pw = Math.max(1, Math.round(cw * dpr)), ph = Math.max(1, Math.round(ch * dpr));
      if (c.el.width !== pw || c.el.height !== ph) {
        c.el.width = pw; c.el.height = ph;
        c.el.style.width = cw + 'px'; c.el.style.height = ch + 'px';
      }
      const tl = map.containerPointToLayerPoint([-padX, -padY]);
      this._L.DomUtil.setPosition(c.el, tl);
      const v = this._viewFor(tl);
      Object.assign(c, { w: cw, h: ch, padX, padY, dpr, tl, po: v.po, zoom: v.z, view: v });
      const ctx = c.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, pw, ph);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      this._paintSites(ctx, v, cw, ch);
      this._growing = false;
      if (this.options.fallout !== false) this._paintFallout(ctx, this._dets, v, cw, ch, dpr, 'source-over');
      if (this.options.damage !== false) this._paintDamage(ctx, this._dets, v, cw, ch);
      this._pending = [];
      this._dirty = false;
      this._lastStatic = now();
      this._lastStaticT = this._t;
      this.stats.staticMs = this._lastStatic - t0;
    }

    // New detonations since the last full redraw: just add them on top (cheap)
    _paintPending() {
      const c = this._dmg;
      if (!c.view) return;   // the next full redraw will include them
      const list = this._pending;
      this._pending = [];
      const ctx = c.ctx;
      ctx.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
      if (this.options.fallout !== false) this._paintFallout(ctx, list, c.view, c.w, c.h, c.dpr, 'destination-over');
      if (this.options.damage !== false) this._paintDamage(ctx, list, c.view, c.w, c.h);
    }

    // Which copies of the world (date-line wrapping) to draw a point at: the one nearest the map centre,
    // plus its neighbours when zoomed far enough out to see more than one world
    _shifts(X0, v, cw) {
      const ww = this._ww;
      if (!ww) return 0;
      return ww * Math.round(((v.ox + cw / 2) / v.k - X0) / ww);
    }

    _paintSites(ctx, v, cw, ch) {
      this._paintCities(ctx, v, cw, ch);
      if (!this._sites.length) return;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      const many = this._ww && this._ww * v.k < cw * 1.5;
      const subW = clamp(26 + (v.z - 2) * 6, 26, 52);
      for (const s of this._sites) {
        const base = this._shifts(s.X0, v, cw);
        for (let c = many ? -1 : 0; c <= (many ? 1 : 0); c++) {
          const x = (s.X0 + base + c * this._ww) * v.k - v.ox, y = s.Y0 * v.k - v.oy;
          if (x < -10 || y < -10 || x > cw + 10 || y > ch + 10) continue;
          if (s.kind === 'sub') ctx.drawImage(SPR.sub[s.side], x - subW / 2, y - subW * 0.15, subW, subW * 0.3);
          else if (s.kind === 'base') ctx.drawImage(SPR.base[s.side], x - 5, y - 5, 10, 10);
          else ctx.drawImage(SPR.silo, x - 4.5, y - 4.5, 9, 9);
        }
      }
    }

    // Collect the blasts that show on this canvas, with their position and pixels-per-km
    _visible(list, v, cw, ch) {
      const vis = this._vis;
      vis.length = 0;
      const ww = this._ww, many = ww && ww * v.k < cw * 1.5;
      for (const d of list) {
        const ppk = d.ppk0 * v.k, base = this._shifts(d.X0, v, cw);
        const reach = Math.max(d.psi1 * ppk, LOOK.puffMax * 2.6, this.options.fallout !== false ? d.fl * ppk : 0);
        for (let c = many ? -1 : 0; c <= (many ? 1 : 0); c++) {
          const x = (d.X0 + base + c * ww) * v.k - v.ox, y = d.Y0 * v.k - v.oy;
          if (x + reach < 0 || y + reach < 0 || x - reach > cw || y - reach > ch) continue;
          vis.push(d, x, y, ppk);
        }
      }
      return vis;
    }

    _paintFallout(ctx, list, v, cw, ch, dpr, mode) {
      const vis = this._visible(list, v, cw, ch);
      ctx.globalCompositeOperation = mode;
      ctx.globalAlpha = LOOK.alpha.fallout / 0.15;   // the plume picture itself is drawn at ~0.15
      const t = this._t;
      for (let i = 0; i < vis.length; i += 4) {
        const d = vis[i];
        if (!(d.fl > 0)) continue;
        const ppk = vis[i + 3];
        const g = clamp((t - d.tDet) / LOOK.falloutGrow, 0.06, 1);
        if (g < 1) this._growing = true;
        const e = 1 - (1 - g) * (1 - g);   // grows quickly at first, then slows down
        const len = Math.max(d.fl * ppk * e, 8 * e), wid = Math.max(d.fw * ppk * (0.45 + 0.55 * e), 3);
        const cs = Math.cos(d.ang), sn = Math.sin(d.ang);
        ctx.setTransform(dpr * cs, dpr * sn, -dpr * sn, dpr * cs, dpr * vis[i + 1], dpr * vis[i + 2]);
        ctx.drawImage(SPR.plume, -0.06 * len, -wid / 2, len, wid);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // Little colored dots for the cities and military targets of the countries at war (static, like the sites)
    _paintCities(ctx, v, cw, ch) {
      if (!this._cities.length) return;
      const r = clamp(1.3 + (v.z - 2) * 0.35, 1.3, 2.6);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.95;
      for (const c of this._cities) {
        const x = (c.X0 + this._shifts(c.X0, v, cw)) * v.k - v.ox, y = c.Y0 * v.k - v.oy;
        if (x < -4 || y < -4 || x > cw + 4 || y > ch + 4) continue;
        const rr = c.kind === 'target' ? r * 1.3 : c.kind === 'big' ? r * 1.15 : r;
        ctx.drawImage(SPR.city[c.kind], x - rr, y - rr, rr * 2, rr * 2);
      }
      ctx.globalAlpha = 1;
    }

    // Every blast: a red glow (the moderate-blast area) with a white smoke cloud on top (the heavy-blast area),
    // never smaller than a minimum size that grows as you zoom in
    _paintDamage(ctx, list, v, cw, ch) {
      const vis = this._visible(list, v, cw, ch);
      if (!vis.length) return;
      const puffMin = clamp(LOOK.puffMin[0] + (v.z - 2) * LOOK.puffMin[1], LOOK.puffMin[0], LOOK.puffMax);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = LOOK.glowAlpha;
      for (let i = 0; i < vis.length; i += 4) {
        const d = vis[i], r = Math.max(d.psi5 * vis[i + 3] * 1.25, puffMin * 1.9 * d.yk);
        ctx.drawImage(SPR.redGlow, vis[i + 1] - r, vis[i + 2] - r, r * 2, r * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.97;
      for (let i = 0; i < vis.length; i += 4) {
        const d = vis[i], r = Math.max(d.psi20 * vis[i + 3] * 1.25, puffMin * d.yk);
        ctx.drawImage(SPR.puff[d.pv], vis[i + 1] - r, vis[i + 2] - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
    }

    // ---------- the animated layer ----------

    _drawAnim(tl, tNow) {
      const a = this._anim, ctx = a.ctx, fx = this._fx, map = this._map;
      let v;
      if (tl) {
        // keep the canvases pinned to the map's top-left corner (the pane itself moves while dragging)
        v = this._viewFor(tl);
        for (const c of [a, fx]) { this._L.DomUtil.setPosition(c.el, tl); c.tl = tl; c.po = v.po; c.zoom = v.z; c.view = v; }
      } else {
        v = a.view;   // zoom animation: keep drawing at the old view; the CSS transform stretches it
      }
      for (const c of [a, fx]) {
        c.ctx.setTransform(1, 0, 0, 1, 0, 0);
        c.ctx.globalCompositeOperation = 'source-over';
        c.ctx.globalAlpha = 1;
        c.ctx.clearRect(0, 0, c.el.width, c.el.height);
      }
      if (!v || !map) return;
      ctx.setTransform(a.dpr, 0, 0, a.dpr, 0, 0);
      this._drawMissiles(ctx, v);
      this._drawPlanes(ctx, v);
      fx.ctx.setTransform(fx.dpr, 0, 0, fx.dpr, 0, 0);
      this._drawFlashes(fx.ctx, v, tNow);
    }

    // White aircraft flying away from their bases (see setAircraft)
    _drawPlanes(ctx, v) {
      const list = this._planes;
      if (!list.length) return;
      const t = this._t, W = this._W, H = this._H, img = SPR.plane;
      const size = clamp(9 + (v.z - 2) * 2.2, 9, 18);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.95;
      for (const a of list) {
        if (t < a.start) continue;
        const km = Math.min(a.range, (t - a.start) / 3600 * a.speed);
        const p = destination(a.lat, a.lon, a.bearing, km), q = destination(a.lat, a.lon, a.bearing, km + 30);
        const P = this._proj(p.lat, p.lon), Q = this._proj(q.lat, q.lon);
        const sh = this._shifts(P[0], v, W);
        const x = (P[0] + sh) * v.k - v.ox, y = P[1] * v.k - v.oy;
        if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
        let dx = Q[0] - P[0];
        if (dx > 128) dx -= 256; else if (dx < -128) dx += 256;
        const ang = Math.atan2(Q[1] - P[1], dx) + Math.PI / 2;
        const d = this._anim.dpr, c = Math.cos(ang), s = Math.sin(ang);
        ctx.setTransform(d * c, d * s, -d * s, d * c, d * x, d * y);
        ctx.drawImage(img, -size / 2, -size / 2, size, size);
      }
      ctx.setTransform(this._anim.dpr, 0, 0, this._anim.dpr, 0, 0);
      ctx.globalAlpha = 1;
    }

    _drawMissiles(ctx, v) {
      const W = this._W, H = this._H, k = v.k, ox = v.ox, oy = v.oy;
      const T = LOOK.trail, t = this._t, ww = this._ww, cx0 = (ox + W / 2) / k;
      const capH = Math.max(60, LOOK.arcMax * H), M = 24, trails = this.options.trails !== false;
      const act = this._act;
      act.length = 0;
      let inFlight = 0;
      for (const S of this._strikes) {
        const e = t - S.t0;
        if (e < 0) continue;
        const p = e / S.dur;
        if (p >= 1 + T || (p >= 1 && !trails)) continue;   // after impact the trail drains into the target
        if (p < 1) inFlight++;
        const sh = ww ? ww * Math.round((cx0 - S.mx) / ww) : 0;
        const L = S.len * k, h = Math.min(S.hf * L, capH);
        // skip strikes that are entirely off screen (arc included)
        if ((S.maxX + sh) * k - ox < -M || (S.minX + sh) * k - ox > W + M ||
          S.maxY * k - oy < -M || S.minY * k - oy - h > H + M) continue;
        S.p = p; S.sh = sh; S.h = h;
        act.push(S);
      }
      this.stats.inFlight = inFlight;
      this.stats.drawn = act.length;
      this._adapt(act.length);
      this.stats.lod = this._lod;
      if (!act.length) return;
      const lod = this._lod, segPx = 22 + Math.max(0, lod - 2) * 14;
      for (const S of act) S.seg = clamp(Math.round((S.len * k + S.h) * T / BANDS / segPx), 1, 8);
      // Trails are painted normally (not added together), so even crowded corridors stay red like the videos
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'bevel';

      if (trails) {
        // the trail, band by band from the dim orange tail to the yellow head (one batch per band for all missiles)
        for (let i = clamp(lod - 2, 0, BANDS - 3); i < BANDS; i++) {
          ctx.lineWidth = BAND_WIDTH[i];
          ctx.strokeStyle = BAND_STYLE[i];
          ctx.beginPath();
          for (const S of act) {
            // the visible part of the path (from the tail to the warhead) always runs red → orange → yellow
            const a0 = Math.max(0, S.p - T), len = Math.min(S.p, 1) - a0;
            const a = a0 + len * i / BANDS, b = a0 + len * (i + 1) / BANDS;
            if (b > a) tracePath(ctx, S, a, b, S.seg, S.sh, k, ox, oy, S.h);
          }
          ctx.stroke();
        }
      }
      // soft glow dabs just behind each warhead
      ctx.globalCompositeOperation = 'lighter';
      const nStamps = !trails ? 0 : lod === 0 ? LOOK.glowStamps.length : lod === 1 ? 1 : 0;
      for (let si = 0; si < nStamps; si++) {
        const g = LOOK.glowStamps[si], r = g[1];
        ctx.globalAlpha = g[2];
        for (const S of act) {
          const f = S.p - g[0];
          if (f < 0 || f > 1) continue;
          pathPoint(S, f, S.sh, k, ox, oy, S.h);
          if (OUT.x < -r || OUT.y < -r || OUT.x > W + r || OUT.y > H + r) continue;
          ctx.drawImage(SPR.spark, OUT.x - r, OUT.y - r, r * 2, r * 2);
        }
      }
      // the warheads: a bright glowing dot each
      const hr = LOOK.headSize, img = SPR.head;
      ctx.globalAlpha = 1;
      for (const S of act) {
        if (S.p >= 1) continue;
        pathPoint(S, S.p, S.sh, k, ox, oy, S.h);
        if (OUT.x < -hr || OUT.y < -hr || OUT.x > W + hr || OUT.y > H + hr) continue;
        ctx.drawImage(img, OUT.x - hr, OUT.y - hr, hr * 2, hr * 2);
      }
    }

    // If frames get slow (< ~30 fps) while lots of missiles fly, step down the quality: 1 = normal blending for the
    // trails and fewer glow dabs, 2 = no glow dabs, 3–4 = shorter faint tails. Steps back up when it's fast again.
    _adapt(drawn) {
      const t = this._lastFrameAt;
      if (!LOOK.adaptive) return;
      if (this._ema > 34 && drawn > 600 && this._lod < 4 && t - this._lodAt > 600) { this._lod++; this._lodAt = t; }
      else if ((this._ema < 22 || drawn < 300) && this._lod > 0 && t - this._lodAt > 1500) { this._lod--; this._lodAt = t; }
    }

    _drawFlashes(ctx, v, tNow) {
      const list = this._flashes;
      if (!list.length) { this.stats.flashes = 0; return; }
      const W = this._W, H = this._H, k = v.k;
      const F = LOOK.flash, RG = LOOK.ring, AG = LOOK.afterglow;
      ctx.globalCompositeOperation = 'lighter';
      let keep = 0;
      for (let i = 0; i < list.length; i++) {
        const f = list[i], age = (tNow - f.t0) / 1000;
        if (age >= AG) continue;
        list[keep++] = f;
        if (age < 0) continue;
        const d = f.d, ppk = d.ppk0 * k;
        const x = (d.X0 + this._shifts(d.X0, v, W)) * k - v.ox, y = d.Y0 * k - v.oy;
        const big = Math.max(d.thermal, d.psi1) * ppk;
        const rf = Math.max(big * 2.2, 26), rr = Math.max(big * 1.3, 28);
        if (x + rf < 0 || y + rf < 0 || x - rf > W || y - rf > H) continue;
        // afterglow: a hot red/white glow that settles into the lasting damage glow
        const ga = 1 - age / AG, rg = Math.max(d.psi5 * ppk * 1.6, 9);
        ctx.globalAlpha = 0.85 * ga * ga;
        ctx.drawImage(SPR.glow, x - rg, y - rg, rg * 2, rg * 2);
        // the shock ring, racing outwards
        if (age < RG) {
          const q = age / RG, e = 1 - Math.pow(1 - q, 3);
          const r = Math.max(d.fireball * ppk, 2) + (rr - Math.max(d.fireball * ppk, 2)) * e;
          ctx.globalAlpha = Math.pow(1 - q, 1.5);
          ctx.drawImage(SPR.ring, x - r, y - r, r * 2, r * 2);
        }
        // the flash: a big white burst for a split second
        if (age < F) {
          const q = age / F, r = rf * (0.7 + 0.3 * q);
          ctx.globalAlpha = (1 - q) * (1 - q);
          ctx.drawImage(SPR.flash, x - r, y - r, r * 2, r * 2);
        }
      }
      list.length = keep;
      ctx.globalAlpha = 1;
      this.stats.flashes = keep;
    }
  }

  function now() { return (root.performance && root.performance.now) ? root.performance.now() : Date.now(); }

  // Where you end up going `km` from a place in a compass direction
  function destination(lat, lon, bearing, km) {
    const d = km / 6371, b = bearing * D2R, la = lat * D2R, lo = lon * D2R;
    const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
    const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
    return { lat: la2 / D2R, lon: ((lo2 / D2R + 540) % 360) - 180 };
  }

  NS.Renderer = Renderer;
  NS.Renderer.LOOK = LOOK;   // exposed so the legend or tests can read the colours and sizes

  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof window !== 'undefined' ? window : globalThis);
