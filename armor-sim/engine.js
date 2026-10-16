// Impact engine: a 2D particle simulation of shells hitting armor.
// Every plate and projectile is made of particles joined by "bonds" (springs) that can
// stretch, bend for good (plastic), heat up, and snap (fracture). Nothing is animated by hand:
// holes, cracks, spall and ricochets come out of the physics.
//
// Units inside the engine: millimetres, microseconds (µs), grams.
// So speeds are mm/µs (= km/s), forces are MN and energy is kJ.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ImpactEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const SQ3 = Math.sqrt(3), DEG = Math.PI / 180;
  const C_MAX = 6;            // fastest sound speed we allow (mm/µs); stiffer materials are softened a bit to keep steps big
  const CFL = 0.3;            // time step = CFL × particle size ÷ sound speed
  const HEAT_GAIN = 1.5;      // boosts heating a little: real 3D shear bands get hotter than a 2D slice can show
  const FRICTION = 0.12;
  const MAXN = 8;             // most bonds one particle can have
  const CONTACT = 0.94;       // particles push each other away when closer than this × their size (bonded neighbors sit at 1×)

  // ✏️ Materials: density (g/cm³), stiffness E (GPa), strength Y (MPa), stretch before breaking (ef) or crushing (ec),
  // heat capacity cp (J/g·K), melting point (K), and duct = how much it can flow (metals re-bond as they squeeze past
  // each other; brittle things like ceramics and glass have 0, so they crack instead)
  const MATERIALS = {
    rha:      { name: 'Armor steel', group: 'Steel', rho: 7.85, E: 210, Y: 1000, ef: 0.2, ec: 0.55, cp: 0.46, melt: 1750, duct: 40, color: '#8b96a2' },
    hhs:      { name: 'Hard armor steel', group: 'Steel', rho: 7.85, E: 210, Y: 1500, ef: 0.1, ec: 0.5, cp: 0.46, melt: 1750, duct: 20, color: '#aab6c3' },
    cast:     { name: 'Cast steel', group: 'Steel', rho: 7.8, E: 200, Y: 750, ef: 0.14, ec: 0.5, cp: 0.46, melt: 1720, duct: 25, color: '#767e86' },
    mild:     { name: 'Mild steel', group: 'Steel', rho: 7.85, E: 200, Y: 320, ef: 0.35, ec: 0.6, cp: 0.46, melt: 1780, duct: 60, color: '#69727b' },
    shot:     { name: 'Shell steel', group: 'Steel', rho: 7.85, E: 210, Y: 1300, ef: 0.16, ec: 0.55, cp: 0.46, melt: 1750, duct: 30, color: '#b7a78a' },
    cap:      { name: 'Hardened cap steel', group: 'Steel', rho: 7.85, E: 210, Y: 1900, ef: 0.07, ec: 0.45, cp: 0.46, melt: 1750, duct: 10, color: '#8e7c60' },
    alu:      { name: 'Aluminium', group: 'Light metals', rho: 2.66, E: 70, Y: 280, ef: 0.18, ec: 0.55, cp: 0.9, melt: 900, duct: 40, color: '#c7cfd7' },
    ti:       { name: 'Titanium', group: 'Light metals', rho: 4.43, E: 115, Y: 900, ef: 0.14, ec: 0.5, cp: 0.52, melt: 1940, duct: 30, color: '#9aa1b6' },
    wha:      { name: 'Tungsten alloy', group: 'Heavy metals', rho: 17.6, E: 360, Y: 1400, ef: 0.1, ec: 0.45, cp: 0.13, melt: 1750, duct: 25, color: '#6a7485' },
    wc:       { name: 'Tungsten carbide', group: 'Heavy metals', rho: 15.6, E: 600, Y: 3800, ef: 0.012, ec: 0.18, cp: 0.2, melt: 3000, duct: 0, color: '#4e545e' },
    cu:       { name: 'Copper', group: 'Heavy metals', rho: 8.96, E: 120, Y: 250, ef: 0.6, ec: 0.85, cp: 0.385, melt: 1358, duct: 80, color: '#c8784b' },
    lead:     { name: 'Lead', group: 'Heavy metals', rho: 11.3, E: 16, Y: 25, ef: 0.5, ec: 0.9, cp: 0.13, melt: 600, duct: 120, color: '#7a838d' },
    al2o3:    { name: 'Alumina ceramic', group: 'Ceramics', rho: 3.9, E: 370, Y: 3000, ef: 0.006, ec: 0.3, cp: 0.88, melt: 2300, duct: 6, color: '#e6e0cd' },
    b4c:      { name: 'Boron carbide', group: 'Ceramics', rho: 2.5, E: 450, Y: 4500, ef: 0.005, ec: 0.3, cp: 0.95, melt: 2700, duct: 6, color: '#3f444c' },
    glass:    { name: 'Glass', group: 'Ceramics', rho: 2.5, E: 70, Y: 900, ef: 0.004, ec: 0.06, cp: 0.84, melt: 1700, duct: 0, color: '#9ed6e4' },
    aramid:   { name: 'Aramid fabric', group: 'Other', rho: 1.44, E: 60, Y: 1200, ef: 0.15, ec: 0.6, cp: 1.4, melt: 800, duct: 60, color: '#d6b14a' },
    poly:     { name: 'Polycarbonate', group: 'Other', rho: 1.2, E: 2.4, Y: 65, ef: 1, ec: 0.8, cp: 1.2, melt: 500, duct: 60, color: '#b4d5ee' },
    rubber:   { name: 'Rubber', group: 'Other', rho: 1.1, E: 0.1, Y: 15, ef: 3, ec: 0.9, cp: 1.9, melt: 500, duct: 200, color: '#3a3a3a' },
    concrete: { name: 'Concrete', group: 'Other', rho: 2.4, E: 30, Y: 40, ef: 0.0006, ec: 0.04, cp: 0.88, melt: 1800, duct: 0, color: '#a29d92' },
    wood:     { name: 'Wood', group: 'Other', rho: 0.6, E: 11, Y: 50, ef: 0.03, ec: 0.3, cp: 1.7, melt: 600, duct: 4, color: '#a2723f' },
    era:      { name: 'Reactive explosive', group: 'Explosives', rho: 1.7, E: 8, Y: 30, ef: 0.08, ec: 0.25, cp: 1, melt: 600, duct: 0, color: '#d8a21c', explosive: true },
    fill:     { name: 'Shell explosive', group: 'Explosives', rho: 1.7, E: 8, Y: 30, ef: 0.1, ec: 0.3, cp: 1, melt: 600, duct: 0, color: '#dfc25c' },
  };
  const MAT_KEYS = Object.keys(MATERIALS);
  const MAT_INDEX = Object.fromEntries(MAT_KEYS.map((k, i) => [k, i]));
  const MP = MAT_KEYS.map(k => {   // the same numbers in engine units
    const m = MATERIALS[k], rho = m.rho * 1e-3, E = Math.min(m.E, m.rho * C_MAX * C_MAX) * 1e-3;
    return { rho, E, ey: (m.Y * 1e-6) / E, ef: m.ef, ec: m.ec, cp: m.cp * 1e-3, melt: m.melt, c: Math.sqrt(E / rho), explosive: !!m.explosive, duct: m.duct };
  });

  // ✏️ Projectiles: made-up, generic designs. Lengths in mm, speed in m/s.
  // shape 'shell' = pointed (ogive) nose; 'rod' = long dart; 'heat' = shaped charge; 'hesh' = squash head; 'ball' = sphere
  const PROJECTILES = [
    { id: 'b762', group: 'Bullets', name: '7.62 mm bullet (lead core)', kind: 'ke', v: 850, d: { shape: 'shell', cal: 7.62, len: 28, nose: 2.8, mat: 'lead', jacket: { t: 0.6, mat: 'cu' } } },
    { id: 'b762ap', group: 'Bullets', name: '7.62 mm AP bullet (carbide core)', kind: 'ke', v: 840, d: { shape: 'shell', cal: 7.62, len: 32, nose: 2.8, mat: 'lead', jacket: { t: 0.6, mat: 'cu' }, core: { r: 2.6, tip: -3, len: 22, nose: 1.8, mat: 'wc' } } },
    { id: 'b127', group: 'Bullets', name: '12.7 mm AP bullet', kind: 'ke', v: 880, d: { shape: 'shell', cal: 12.7, len: 58, nose: 2.6, mat: 'lead', jacket: { t: 0.9, mat: 'cu' }, core: { r: 4.4, tip: -5, len: 40, nose: 1.6, mat: 'hhs' } } },
    { id: 'b145', group: 'Bullets', name: '14.5 mm AP bullet', kind: 'ke', v: 1000, d: { shape: 'shell', cal: 14.5, len: 64, nose: 2.6, mat: 'lead', jacket: { t: 1, mat: 'cu' }, core: { r: 5, tip: -5, len: 45, nose: 1.6, mat: 'wc' } } },
    { id: 'ac20', group: 'Autocannon', name: '20 mm AP', kind: 'ke', v: 800, d: { shape: 'shell', cal: 20, len: 70, nose: 1.6, mat: 'shot' } },
    { id: 'ac30ds', bore: 30, group: 'Autocannon', name: '30 mm APDS (tungsten core)', kind: 'ke', v: 1100, d: { shape: 'shell', cal: 18, len: 80, nose: 1.8, mat: 'wha' } },
    { id: 'ac30fs', group: 'Autocannon', name: '30 mm dart (APFSDS)', kind: 'ke', v: 1385, d: { shape: 'rod', dia: 10, len: 130, mat: 'wha' } },
    { id: 'ap37', group: 'Solid shells (AP)', name: '37 mm AP', kind: 'ke', v: 880, d: { shape: 'shell', cal: 37, len: 130, nose: 1.4, mat: 'shot' } },
    { id: 'ap57', group: 'Solid shells (AP)', name: '57 mm AP', kind: 'ke', v: 850, d: { shape: 'shell', cal: 57, len: 195, nose: 1.4, mat: 'shot' } },
    { id: 'ap75', group: 'Solid shells (AP)', name: '75 mm APC (capped)', kind: 'ke', v: 620, d: { shape: 'shell', cal: 75, len: 250, nose: 1.4, mat: 'shot', cap: { len: 45, mat: 'cap' } } },
    { id: 'ap76', group: 'Solid shells (AP)', name: '76 mm APCBC', kind: 'ke', v: 790, d: { shape: 'shell', cal: 76, len: 270, nose: 1.5, mat: 'shot', cap: { len: 45, mat: 'cap' } } },
    { id: 'ap88', group: 'Solid shells (AP)', name: '88 mm APCBC', kind: 'ke', v: 780, d: { shape: 'shell', cal: 88, len: 310, nose: 1.5, mat: 'shot', cap: { len: 52, mat: 'cap' } } },
    { id: 'ap100', group: 'Solid shells (AP)', name: '100 mm APBC', kind: 'ke', v: 890, d: { shape: 'shell', cal: 100, len: 340, nose: 1.2, mat: 'shot' } },
    { id: 'ap122', group: 'Solid shells (AP)', name: '122 mm AP', kind: 'ke', v: 800, d: { shape: 'shell', cal: 122, len: 420, nose: 1.4, mat: 'shot' } },
    { id: 'ap128', group: 'Solid shells (AP)', name: '128 mm APCBC', kind: 'ke', v: 920, d: { shape: 'shell', cal: 128, len: 460, nose: 1.5, mat: 'shot', cap: { len: 70, mat: 'cap' } } },
    { id: 'cr57', bore: 57, group: 'Hard-core shot (APCR)', name: '57 mm APCR', kind: 'ke', v: 1150, d: { shape: 'shell', cal: 57, len: 170, nose: 1.4, mat: 'alu', core: { r: 13, tip: -14, len: 100, nose: 1.2, mat: 'wc' } } },
    { id: 'cr76', bore: 76, group: 'Hard-core shot (APCR)', name: '76 mm APCR', kind: 'ke', v: 1040, d: { shape: 'shell', cal: 76, len: 230, nose: 1.4, mat: 'alu', core: { r: 18, tip: -18, len: 140, nose: 1.2, mat: 'wc' } } },
    { id: 'cr88', bore: 88, group: 'Hard-core shot (APCR)', name: '88 mm APCR', kind: 'ke', v: 1130, d: { shape: 'shell', cal: 88, len: 260, nose: 1.4, mat: 'alu', core: { r: 21, tip: -20, len: 160, nose: 1.2, mat: 'wc' } } },
    { id: 'ds84', bore: 84, group: 'Discarding sabot (APDS)', name: '84 mm APDS', kind: 'ke', v: 1430, d: { shape: 'shell', cal: 50, len: 190, nose: 1.2, mat: 'shot', core: { r: 15, tip: -10, len: 150, nose: 1, mat: 'wc' } } },
    { id: 'ds105', bore: 105, group: 'Discarding sabot (APDS)', name: '105 mm APDS', kind: 'ke', v: 1470, d: { shape: 'shell', cal: 60, len: 240, nose: 1.2, mat: 'shot', core: { r: 18, tip: -12, len: 190, nose: 1, mat: 'wc' } } },
    { id: 'fs1', group: 'Long-rod darts (APFSDS)', name: 'Early dart · 420 mm steel rod', kind: 'ke', v: 1500, d: { shape: 'rod', dia: 32, len: 420, mat: 'hhs' } },
    { id: 'fs2', group: 'Long-rod darts (APFSDS)', name: 'Dart · 550 mm tungsten rod', kind: 'ke', v: 1650, d: { shape: 'rod', dia: 26, len: 550, mat: 'wha' } },
    { id: 'fs3', group: 'Long-rod darts (APFSDS)', name: 'Long dart · 700 mm tungsten rod', kind: 'ke', v: 1700, d: { shape: 'rod', dia: 25, len: 700, mat: 'wha' } },
    { id: 'heat75', group: 'Shaped charges (HEAT)', name: '75 mm HEAT (early)', kind: 'heat', v: 450, d: { shape: 'heat', cal: 75, len: 250, probe: 20, q: 3.2, vTip: 6.5 } },
    { id: 'heat105', group: 'Shaped charges (HEAT)', name: '105 mm HEAT', kind: 'heat', v: 1170, d: { shape: 'heat', cal: 105, len: 420, probe: 110, q: 4.6, vTip: 7.5 } },
    { id: 'heat120', group: 'Shaped charges (HEAT)', name: '120 mm HEAT (modern)', kind: 'heat', v: 1140, d: { shape: 'heat', cal: 120, len: 480, probe: 170, q: 6, vTip: 8.5 } },
    { id: 'hesh105', group: 'Squash head (HESH)', name: '105 mm HESH', kind: 'hesh', v: 730, d: { shape: 'hesh', cal: 105, len: 360 } },
    { id: 'hesh120', group: 'Squash head (HESH)', name: '120 mm HESH', kind: 'hesh', v: 670, d: { shape: 'hesh', cal: 120, len: 410 } },
    { id: 'hesh165', group: 'Squash head (HESH)', name: '165 mm HESH (demolition)', kind: 'hesh', v: 260, d: { shape: 'hesh', cal: 165, len: 520 } },
    { id: 'he75', group: 'High explosive (HE)', name: '75 mm HE', kind: 'he', v: 550, d: { shape: 'shell', cal: 75, len: 280, nose: 2, mat: 'shot', fill: 0.62 } },
    { id: 'he122', group: 'High explosive (HE)', name: '122 mm HE', kind: 'he', v: 680, d: { shape: 'shell', cal: 122, len: 460, nose: 2, mat: 'shot', fill: 0.62 } },
    { id: 'he152', group: 'High explosive (HE)', name: '152 mm HE', kind: 'he', v: 650, d: { shape: 'shell', cal: 152, len: 600, nose: 2, mat: 'shot', fill: 0.62 } },
    { id: 'ball', group: 'Just for fun', name: '50 mm steel ball', kind: 'ke', v: 1000, d: { shape: 'ball', cal: 50, mat: 'hhs' } },
    { id: 'wcube', group: 'Just for fun', name: '40 mm tungsten block', kind: 'ke', v: 1500, d: { shape: 'block', cal: 40, len: 40, mat: 'wha' } },
  ];

  // ✏️ Armor setups (all made up). x = where the plate's front face crosses the shot line (mm),
  // ang = tilt in degrees (0 = facing the shell), len = how tall the plate is, layers from the outside in.
  const ARMORS = [
    { id: 'plate', name: 'Single steel plate', plates: [{ x: 0, ang: 0, len: 'auto', layers: [{ mat: 'rha', t: 100 }] }] },
    { id: 'slope', name: 'Sloped plate (60°)', plates: [{ x: 0, ang: 60, len: 'auto', layers: [{ mat: 'rha', t: 80 }] }] },
    { id: 'spaced', name: 'Spaced armor (skirt + plate)', plates: [{ x: 0, ang: 0, len: 'auto', layers: [{ mat: 'mild', t: 8 }] }, { x: 350, ang: 0, len: 'auto', layers: [{ mat: 'rha', t: 50 }] }] },
    { id: 'era', name: 'Reactive tile on a plate', plates: [{ x: 0, ang: 55, len: 'auto', layers: [{ mat: 'rha', t: 4 }, { mat: 'era', t: 12 }, { mat: 'rha', t: 4 }] }, { x: 140, ang: 55, len: 'auto', layers: [{ mat: 'rha', t: 60 }] }] },
    { id: 'composite', name: 'Composite (steel + ceramic + aluminium)', plates: [{ x: 0, ang: 0, len: 'auto', layers: [{ mat: 'hhs', t: 20 }, { mat: 'al2o3', t: 60 }, { mat: 'alu', t: 40 }, { mat: 'rha', t: 40 }] }] },
    { id: 'cheek', name: 'Made-up tank turret cheek', plates: [{ x: 0, ang: 30, len: 'auto', layers: [{ mat: 'rha', t: 50 }, { mat: 'al2o3', t: 120 }, { mat: 'rubber', t: 20 }, { mat: 'al2o3', t: 120 }, { mat: 'rha', t: 60 }] }] },
    { id: 'glacis', name: 'Made-up tank glacis (steep)', plates: [{ x: 0, ang: 68, len: 'auto', layers: [{ mat: 'hhs', t: 60 }, { mat: 'b4c', t: 30 }, { mat: 'rha', t: 40 }] }] },
    { id: 'light', name: 'Light vehicle side (aluminium)', plates: [{ x: 0, ang: 0, len: 'auto', layers: [{ mat: 'alu', t: 40 }] }] },
    { id: 'heavy', name: 'Heavy cast front', plates: [{ x: 0, ang: 10, len: 'auto', layers: [{ mat: 'cast', t: 200 }] }] },
    { id: 'wall', name: 'Concrete wall', plates: [{ x: 0, ang: 0, len: 'auto', layers: [{ mat: 'concrete', t: 300 }] }] },
    { id: 'glassw', name: 'Bulletproof glass', plates: [{ x: 0, ang: 0, len: 'auto', layers: [{ mat: 'glass', t: 30 }, { mat: 'glass', t: 20 }, { mat: 'poly', t: 8 }] }] },
    { id: 'vest', name: 'Ceramic plate + fabric', plates: [{ x: 0, ang: 0, len: 'auto', layers: [{ mat: 'b4c', t: 10 }, { mat: 'aramid', t: 14 }] }] },
  ];

  // ---------- projectile shapes (nose tip at x = 0, pointing to +x) ----------
  function ogiveR(x, r, ln) {   // radius of a pointed (tangent ogive) nose at x
    if (x <= -ln) return r;
    const rho = (r * r + ln * ln) / (2 * r), s = x + ln;
    return Math.sqrt(Math.max(0, rho * rho - s * s)) + r - rho;
  }
  function makeShape(d) {
    const s = d.shape;
    if (s === 'shell') {
      const r = d.cal / 2, ln = d.nose * d.cal, len = d.len, c = d.core;
      return { x0: -len, x1: 0, r, at(x, y) {
        if (x > 0 || x < -len) return null;
        const R = ogiveR(x, r, ln), ay = Math.abs(y);
        if (ay > R) return null;
        if (c) { const cx = x - c.tip; if (cx <= 0 && cx >= -c.len && ay <= ogiveR(cx, c.r, c.nose * c.r * 2)) return c.mat; }
        if (d.fill && x < -ln * 0.6 && x > -len + d.cal * 0.25 && ay < r * d.fill) return 'fill';
        if (d.cap && x > -d.cap.len) return d.cap.mat;
        if (d.jacket && R - ay < d.jacket.t) return d.jacket.mat;
        return d.mat;
      } };
    }
    if (s === 'rod') {
      const r = d.dia / 2, len = d.len, tip = d.dia * 2.2, fin = d.dia * 3;
      return { x0: -len, x1: 0, r: r * 2.6, at(x, y) {
        if (x > 0 || x < -len) return null;
        const ay = Math.abs(y);
        const R = x > -tip ? r * (-x / tip) : r;
        if (ay <= R) return d.mat;
        if (x < -len + fin && ay <= r + (r * 1.6) * (1 - (x + len) / fin)) return 'alu';   // fins
        return null;
      } };
    }
    if (s === 'heat') {
      const r = d.cal / 2, len = d.len, probe = d.probe, cone = d.cal * 0.9, wall = Math.max(2, d.cal * 0.05);
      return { x0: -len, x1: 0, r, at(x, y) {
        if (x > 0 || x < -len) return null;
        const ay = Math.abs(y);
        if (x > -probe) return ay <= Math.max(3, r * 0.14) ? 'alu' : null;                 // standoff probe
        if (x > -probe - cone) { const R = r * 0.25 + (r * 0.75) * ((-probe - x) / cone); return ay <= R ? (R - ay < wall ? 'alu' : null) : null; }   // hollow nose cone
        if (ay > r) return null;
        if (r - ay < wall) return 'shot';
        const lx = -probe - cone - x;                                                      // copper liner cone, then explosive behind it
        if (Math.abs(lx - ay * 0.9) < wall * 1.2) return 'cu';
        if (lx > ay * 0.9) return 'fill';
        return null;
      } };
    }
    if (s === 'hesh') {
      const r = d.cal / 2, len = d.len, wall = Math.max(2, d.cal * 0.04);
      return { x0: -len, x1: 0, r, at(x, y) {
        if (x > 0 || x < -len) return null;
        const ay = Math.abs(y);
        const R = x > -r ? Math.sqrt(Math.max(0, r * r - (x + r) * (x + r))) : r;          // round nose
        if (ay > R) return null;
        return R - ay < wall || x < -len + wall * 3 ? 'shot' : 'fill';
      } };
    }
    if (s === 'ball') { const r = d.cal / 2; return { x0: -d.cal, x1: 0, r, at: (x, y) => ((x + r) * (x + r) + y * y <= r * r ? d.mat : null) }; }
    if (s === 'block') { const r = d.cal / 2; return { x0: -d.len, x1: 0, r, at: (x, y) => (x <= 0 && x >= -d.len && Math.abs(y) <= r ? d.mat : null) }; }
    throw new Error('Unknown shape ' + s);
  }

  // ---------- armor geometry ----------
  const plateThickness = p => p.layers.reduce((s, l) => s + l.t, 0);
  function plateFrame(p) {   // inward normal, direction along the plate, and the front-face point on the shot line
    const a = p.ang * DEG;
    return { n: [Math.cos(a), -Math.sin(a)], t: [Math.sin(a), Math.cos(a)], o: [p.x + (p.off || 0) * Math.sin(a), (p.off || 0) * Math.cos(a)] };
  }
  function autoLen(p, proj) {   // tall enough for the crater and for bending, without wasting particles
    const t = plateThickness(p), cal = proj ? projCal(proj) : 100;
    return Math.max(6 * cal, 0.45 * t, 120) / Math.max(0.35, Math.cos(p.ang * DEG));
  }
  const projCal = P => P.d.shape === 'rod' ? P.d.dia : P.d.cal;

  // Rough area (mm²) of a scene, so we can pick a particle size for a particle budget
  function sceneArea(scene) {
    let a = 0;
    for (const p of scene.plates) a += plateThickness(p) * (p.len === 'auto' ? autoLen(p, scene.proj) : p.len);
    if (scene.proj.kind === 'ke') { const sh = makeShape(scene.proj.d); a += (sh.x1 - sh.x0) * sh.r * 1.7; }
    return a;
  }
  // Particle size: fit the budget, but keep at least ~7 particles across the projectile (allowing up to 2.5× the budget for that)
  function pickH(scene, budget) {
    const area = sceneArea(scene), hb = Math.sqrt(area / (budget * SQ3 / 2)), hmin = Math.sqrt(area / (2.5 * budget * SQ3 / 2));
    const d = scene.proj.d, cal = scene.proj.kind !== 'ke' ? Infinity : d.shape === 'rod' ? d.dia : d.core ? d.core.r * 2 : d.cal;
    const thinnest = Math.min(...scene.plates.flatMap(p => p.layers.map(l => l.t)));   // even thin layers get at least two rows
    return Math.max(0.08, Math.max(hmin, Math.min(hb, cal / 7, thinnest / 2)));
  }

  // ======================================================================
  class Sim {
    constructor(scene) {
      this.scene = scene;
      const h = this.h = scene.h, dyl = h * SQ3 / 2;
      const P = [];   // [x, y, mat, body, fixed, vx]
      const proj = scene.proj, v0 = proj.v / 1000;
      // plates (body 1, 2, …) built in their own frame so faces are smooth at any angle
      const taken = new Map(), tkey = (x, y) => Math.floor(x / h) * 73856093 ^ Math.floor(y / h) * 19349663;
      const clash = (x, y) => {   // is there already a particle (from an earlier plate) right here?
        const cx = Math.floor(x / h), cy = Math.floor(y / h);
        for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const a = taken.get(gx * 73856093 ^ gy * 19349663); if (!a) continue;
          for (let k = 0; k < a.length; k += 2) { const dx = a[k] - x, dy = a[k + 1] - y; if (dx * dx + dy * dy < 0.8 * h * h) return true; }
        }
        return false;
      };
      this.plates = scene.plates.map((p, pi) => {
        const len = p.len === 'auto' ? autoLen(p, proj) : p.len, T = plateThickness(p), f = plateFrame(p);
        const rows = Math.max(1, Math.round(T / dyl)), dy = T / rows, pin = K.PIN ? Math.max(2 * h, 6) : -1;   // (the 3D grip holds plates now, so edges aren't pinned)
        const start = P.length;
        for (let k = 0; k < rows; k++) {
          const u = dy * (k + 0.5);
          let acc = 0, mat = p.layers[p.layers.length - 1].mat;
          for (const l of p.layers) { if (u < acc + l.t) { mat = l.mat; break; } acc += l.t; }
          for (let v = -len / 2 + (k % 2) * h / 2; v <= len / 2; v += h) {
            const x = f.o[0] + u * f.n[0] + v * f.t[0], y = f.o[1] + u * f.n[1] + v * f.t[1];
            if (pi > 0 && clash(x, y)) continue;
            P.push([x, y, MAT_INDEX[mat], pi + 1, Math.abs(v) > len / 2 - pin ? 1 : 0, 0, u, Math.abs(v) > len / 2 - 3 * h ? 1 : 0]);
          }
        }
        for (let i = start; i < P.length; i++) { const kk = tkey(P[i][0], P[i][1]); let a = taken.get(kk); if (!a) taken.set(kk, a = []); a.push(P[i][0], P[i][1]); }
        return { ...p, len, T, f, i0: start, i1: P.length };
      });
      // projectile (body 0): put its nose just in front of the first plate it would hit
      const sh = this.shape = makeShape(proj.d), aimY = proj.aim || 0;
      let hitX = Infinity;
      for (const pl of this.plates) {   // where the line y = aim meets each plate's front face
        const n = pl.f.n, o = pl.f.o; if (Math.abs(n[0]) < 1e-6) continue;
        const x = o[0] + (n[1] * (o[1] - aimY)) / n[0];
        if (x < hitX) hitX = x;
      }
      if (!isFinite(hitX)) hitX = 0;
      let noseX = hitX - 1.5 * h;
      const surfaceX = y => {   // how far right the shell can be at height y: the left-most plate face, minus a gap measured square to that face
        let best = Infinity;
        for (const pl of this.plates) {
          const n = pl.f.n, o = pl.f.o; if (Math.abs(n[0]) < 1e-6) continue;
          const x = o[0] + (n[1] * (o[1] - y)) / n[0] - 1.6 * h / Math.max(0.25, Math.abs(n[0]));
          if (x < best) best = x;
        }
        return best;
      };
      if (proj.kind === 'ke') {   // slide the shell back until no part of it is inside (or touching) a plate
        for (let k = -Math.ceil(sh.r / dyl) - 1; k <= Math.ceil(sh.r / dyl) + 1; k++) {
          const y = k * dyl;
          for (let x = 0; x >= sh.x0 - h; x -= h) if (sh.at(x, y)) { noseX = Math.min(noseX, surfaceX(aimY + y) - x); break; }
        }
      }
      const pStart = P.length;
      // Shaped charges, squash heads and HE shells are gone the instant they go off, so only solid shots are made of particles
      // (the page draws the others flying in, and the physics starts with the explosion).
      if (proj.kind === 'ke') for (let k = -Math.ceil(sh.r / dyl) - 1; k <= Math.ceil(sh.r / dyl) + 1; k++) {
        const y = k * dyl;
        for (let x = (Math.abs(k) % 2) * h / 2; x >= sh.x0 - h; x -= h) {
          const m = sh.at(x, y);
          if (m) P.push([noseX + x, aimY + y, MAT_INDEX[m], 0, 0, v0, 0]);
        }
      }
      this.projRange = [pStart, P.length];
      this.noseX = noseX; this.aimY = aimY; this.hitX = hitX;

      // typed arrays (with room for jets and fragments)
      const cap = this.cap = P.length + 4000;
      this.n = P.length;
      const F32 = n => new Float32Array(n);
      this.px = F32(cap); this.py = F32(cap); this.vx = F32(cap); this.vy = F32(cap); this.fx = F32(cap); this.fy = F32(cap);
      this.m = F32(cap); this.im = F32(cap); this.T = F32(cap); this.soft = F32(cap); this.u = F32(cap);
      this.mat = new Uint8Array(cap); this.body = new Int16Array(cap); this.fixed = new Uint8Array(cap); this.alive = new Uint8Array(cap);
      this.nbond = new Uint8Array(cap); this.brk = new Uint8Array(cap); this.shade = F32(cap); this.edge = new Uint8Array(cap);
      const volume = SQ3 / 2 * h * h * h;
      P.forEach((p, i) => {
        this.px[i] = p[0]; this.py[i] = p[1]; this.mat[i] = p[2]; this.body[i] = p[3]; this.fixed[i] = p[4]; this.vx[i] = p[5]; this.u[i] = p[6]; this.edge[i] = p[7] || 0;
        const mp = MP[p[2]];
        this.m[i] = mp.rho * volume; this.im[i] = p[4] ? 0 : 1 / this.m[i]; this.T[i] = 293; this.soft[i] = 1; this.alive[i] = 1;
        this.shade[i] = 0.88 + 0.24 * frac(Math.sin(i * 12.9898) * 43758.5453);
      });
      this.volume = volume;

      // bonds between touching particles of the same body
      const B = [];
      const link = (i0, i1) => {
        const inv = 1 / h, cells = new Map(), key = (cx, cy) => cx * 73856093 ^ cy * 19349663;
        for (let i = i0; i < i1; i++) { const k = key(Math.floor(this.px[i] * inv), Math.floor(this.py[i] * inv)); let a = cells.get(k); if (!a) cells.set(k, a = []); a.push(i); }
        const r2 = (1.25 * h) ** 2;
        for (let i = i0; i < i1; i++) {
          const cx = Math.floor(this.px[i] * inv), cy = Math.floor(this.py[i] * inv);
          for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
            const a = cells.get(key(gx, gy)); if (!a) continue;
            for (const j of a) if (j > i) { const dx = this.px[j] - this.px[i], dy = this.py[j] - this.py[i], d2 = dx * dx + dy * dy; if (d2 < r2) B.push(i, j, Math.sqrt(d2)); }
          }
        }
      };
      for (const pl of this.plates) link(pl.i0, pl.i1);
      link(pStart, P.length);
      const nb = this.nb = B.length / 3, bcap = this.bcap = Math.ceil(nb * 1.6) + 2000;
      this.bi = new Int32Array(bcap); this.bj = new Int32Array(bcap); this.L0 = F32(bcap); this.Lo = F32(bcap);
      this.bk = F32(bcap); this.bey = F32(bcap); this.bef = F32(bcap); this.bec = F32(bcap); this.bc = F32(bcap);
      this.adj = new Int32Array(cap * MAXN).fill(-1); this.nadj = new Uint8Array(cap);
      this.nb = 0;
      for (let b = 0; b < nb; b++) this.addBond(B[3 * b], B[3 * b + 1], B[3 * b + 2]);
      for (let i = 0; i < this.n; i++) this.nbond[i] = this.nadj[i];
      // contact stiffness per material
      this.kc = new Float32Array(MP.length);
      MP.forEach((mp, i) => { this.kc[i] = SQ3 / 2 * mp.E * h; });

      // the world box (anything leaving it is gone)
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < this.n; i++) { x0 = Math.min(x0, this.px[i]); x1 = Math.max(x1, this.px[i]); y0 = Math.min(y0, this.py[i]); y1 = Math.max(y1, this.py[i]); }
      const span = Math.max(x1 - x0, y1 - y0), pad = Math.max(span * 0.25, 40 * h);
      this.box = [x0 - pad, x1 + pad + (sh.x1 - sh.x0), y0 - pad, y1 + pad];
      this.gw = Math.ceil((this.box[1] - this.box[0]) / h) + 1; this.gh = Math.ceil((this.box[3] - this.box[2]) / h) + 1;
      // a grid of buckets, rebuilt every step without clearing (each bucket remembers which step filled it)
      this.head = new Int32Array(this.gw * this.gh); this.stamp = new Int32Array(this.gw * this.gh).fill(-1); this.next = new Int32Array(cap); this.cellOf = new Int32Array(cap); this.occ = new Int32Array(cap); this.nocc = 0; this.weld = new Int32Array(8000);
      // per-particle numbers the hot loops need (looked up once here instead of every step)
      this.sk = F32(cap); this.kp = F32(cap); this.icp = F32(cap); this.melt = F32(cap); this.duct = new Uint8Array(cap);
      this.ax = F32(cap); this.ay = F32(cap); this.ag = F32(cap);   // 3D grip: anchor point and how hard it can hold
      this.attached = new Uint8Array(cap); this.uf = new Int32Array(cap);   // still part of its plate? (found by following bonds)
      this.rubble = new Uint8Array(cap);   // shattered ceramic stays boxed in by the layers around it, so it keeps resisting
      for (let i = 0; i < this.n; i++) this.setDerived(i);
      this.hasERA = this.plates.some(p => p.layers.some(l => MATERIALS[l.mat].explosive));
      // In real (3D) armor, metal around the hole in the missing third direction also holds each bit in place.
      // A flat slice doesn't have that, so every armor particle gets a "grip" that resists being shoved (and gives way past its strength).
      // It's about the strength of the metal spread over the size of the hole, so it doesn't depend on the particle size.
      const bite = projCal(proj) * (proj.d.shape === 'rod' ? 2.5 : proj.kind === 'heat' ? 0.4 : 1);   // darts dig craters ~2–3× their width; a HEAT jet's hole is ~0.4× the charge
      for (let i = 0; i < this.n; i++) if (this.body[i] > 0) { const mp = MP[this.mat[i]]; this.ax[i] = this.px[i]; this.ay[i] = this.py[i]; this.ag[i] = K.GRIP * mp.ey * mp.E * K.STRENGTH * volume / bite; this.attached[i] = 1; this.rubble[i] = /Ceramics/.test(MATERIALS[MAT_KEYS[this.mat[i]]].group) || MAT_KEYS[this.mat[i]] === 'concrete' ? 1 : 0; }

      // time step from the fastest sound speed present
      let cmax = 1; for (let i = 0; i < this.n; i++) cmax = Math.max(cmax, MP[this.mat[i]].c);
      this.dt0 = CFL * h / cmax; this.dt = this.dt0;
      this.gk = 0.05 * SQ3 / 2 * MP[MAT_INDEX.rha].E * h;   // grip stiffness (soft, so it barely changes how waves travel)
      this.time = 0; this.steps = 0; this.broken = 0;
      this.kind = proj.kind; this.design = proj.d; this.v0 = v0;
      this.triggered = false; this.events = []; this.detonated = new Set();
      this.maxT = 293; this.res = null;
      this.lastPlate = this.plates.reduce((a, b) => (b.f.o[0] + b.T * b.f.n[0] > a.f.o[0] + a.T * a.f.n[0] ? b : a));
      this.firstPlate = this.plates.reduce((a, b) => (b.f.o[0] < a.f.o[0] ? b : a));
      this.hitAt = null; this.residual = 0; this.everBehind = false;
      this.pending = proj.kind !== 'ke' ? [hitX, aimY] : null;
      let m0 = 0; for (let i = pStart; i < P.length; i++) m0 += this.m[i];
      this.projMass0 = m0 || 1;
    }

    // ---------------- one time step ----------------
    // (split into small functions: JavaScript engines optimize short, tight loops much better)
    step() {
      if (this.pending) { const [x, y] = this.pending; this.pending = null; this.hitAt = [x, y, 0]; this.trigger(x, y); }
      const dt = this.dt;
      this.fx.fill(0, 0, this.n); this.fy.fill(0, 0, this.n);
      this.broken += this.bondForces();
      this.buildGrid();
      const hit = this.contactForces(dt);
      const vmax2 = this.move(dt);
      this.time += dt; this.steps++;
      this.dt = Math.min(this.dt0, 0.2 * this.h / Math.sqrt(vmax2 + 1e-9));
      // special events: shaped charges, squash heads and explosives go off on contact; reactive tiles explode when struck
      if (hit && !this.hitAt) this.hitAt = [hit[0], hit[1], this.time];
      if (hit && !this.triggered && this.kind !== 'ke') this.trigger(hit[0], hit[1]);
      if (this.hasERA && this.steps % 4 === 0) this.checkReactive();
      if (this.scab && this.time >= this.scab.t) this.knockScab();
      if (this.steps % 400 === 0) this.compactBonds();
      if (this.steps % 32 === 0) this.findAttached();
    }

    // Which bits are still connected to the main part of their plate? (union-find over the bonds)
    findAttached() {
      const N = this.n, uf = this.uf, bi = this.bi, bj = this.bj, alive = this.alive, body = this.body, att = this.attached;
      for (let i = 0; i < N; i++) uf[i] = i;
      const find = x => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
      for (let b = 0, nb = this.nb; b < nb; b++) {
        const i = bi[b]; if (i < 0) continue;
        const a = find(i), c = find(bj[b]); if (a !== c) uf[a] = c;
      }
      // A piece still joined to a plate's far ends is part of the plate (that's where it meets the rest of the vehicle).
      // In a 2D slice a hole cuts a plate into a top and a bottom half, and both halves count.
      const edge = this.edge;
      for (const p of this.plates) {
        const roots = new Set();
        for (let i = p.i0; i < p.i1; i++) if (alive[i] && edge[i]) roots.add(find(i));
        for (let i = p.i0; i < p.i1; i++) att[i] = alive[i] && roots.has(find(i)) ? 1 : 0;
      }
      for (let i = 0; i < N; i++) if (body[i] === 0) att[i] = 0;
    }

    // bonds: elastic pull/push, permanent bending past the yield point, snapping past the break point
    bondForces() {
      const px = this.px, py = this.py, vx = this.vx, vy = this.vy, fx = this.fx, fy = this.fy, T = this.T, soft = this.soft, alive = this.alive, icp = this.icp, brk = this.brk;
      const bi = this.bi, bj = this.bj, L0 = this.L0, Lo = this.Lo, bk = this.bk, bey = this.bey, bef = this.bef, bec = this.bec, bc = this.bc;
      let broke = 0;
      const comp = K.COMP;
      for (let b = 0, nb = this.nb; b < nb; b++) {
        const i = bi[b]; if (i < 0) continue;
        const j = bj[b];
        if (alive[i] === 0 || alive[j] === 0) { bi[b] = -1; this.unlink(i, j); continue; }
        const dx = px[j] - px[i], dy = py[j] - py[i], L = Math.sqrt(dx * dx + dy * dy) + 1e-9;
        const si = soft[i], sj = soft[j], s = si < sj ? si : sj;
        const lo = Lo[b], total = (L - lo) / lo;
        if (total > bef[b] || total < -bec[b]) {   // snap (hot metal gets weaker, not more brittle)
          bi[b] = -1; if (brk[i] < 255) brk[i]++; if (brk[j] < 255) brk[j]++; broke++; this.unlink(i, j);
          continue;
        }
        let l0 = L0[b], e = (L - l0) / l0;
        const ey = bey[b] * s, ec = ey * comp;   // metal boxed in by the metal around it is much harder to squash than to stretch
        if (e > ey || e < -ec) {   // yield: the bond takes a new shape, and the work turns into heat
          const lim = e > 0 ? ey : -ec, nl = L / (1 + lim);
          const W = bk[b] * (e > 0 ? ey : ec) * l0 * (nl > l0 ? nl - l0 : l0 - nl) * HEAT_GAIN * 0.5;
          T[i] += W * icp[i]; T[j] += W * icp[j];
          L0[b] = l0 = nl; e = lim;
        }
        const nx = dx / L, ny = dy / L;
        const F = bk[b] * e * l0 + bc[b] * ((vx[j] - vx[i]) * nx + (vy[j] - vy[i]) * ny);
        const Fx = F * nx, Fy = F * ny;
        fx[i] += Fx; fy[i] += Fy; fx[j] -= Fx; fy[j] -= Fy;
      }
      return broke;
    }

    // a grid of buckets, rebuilt every step without clearing (each bucket remembers which step filled it)
    buildGrid() {
      const N = this.n, px = this.px, py = this.py, alive = this.alive, head = this.head, stamp = this.stamp, next = this.next, cellOf = this.cellOf;
      const gw = this.gw, bx0 = this.box[0], by0 = this.box[2], inv = 1 / this.h, st = this.steps;
      const occ = this.occ; let no = 0;
      for (let i = 0; i < N; i++) {
        if (alive[i] === 0) { cellOf[i] = -1; continue; }
        const c = ((py[i] - by0) * inv | 0) * gw + ((px[i] - bx0) * inv | 0);
        cellOf[i] = c;
        if (stamp[c] !== st) { stamp[c] = st; head[c] = -1; occ[no++] = c; }
        next[i] = head[c]; head[c] = i;
      }
      this.nocc = no;
    }

    // contacts: anything squeezed closer than its neighbors normally sit gets pushed apart (with friction)
    contactForces(dt) {
      const N = this.n, h = this.h, rc = CONTACT * h, rc2 = rc * rc;
      const px = this.px, py = this.py, vx = this.vx, vy = this.vy, fx = this.fx, fy = this.fy, T = this.T, icp = this.icp, body = this.body;
      const cellOf = this.cellOf, head = this.head, stamp = this.stamp, next = this.next, gw = this.gw, gh = this.gh, st = this.steps;
      const kp = this.kp, sk = this.sk, duct = this.duct, brk = this.brk, soft = this.soft, cdamp = K.CDAMP;
      const weld = this.weld; let nw = 0; const maxW = weld.length / 2;
      let hx = 0, hy = 0, hn = 0;
      const occ = this.occ, nocc = this.nocc, NB = [0, 1, gw - 1, gw, gw + 1];
      for (let q = 0; q < nocc; q++) {
        const c0 = occ[q], cx = c0 % gw, cy = (c0 / gw) | 0;
        for (let i = head[c0]; i >= 0; i = next[i]) {
        const bproj = body[i] === 0, ki = kp[i], si = sk[i], pxi = px[i], pyi = py[i], vxi = vx[i], vyi = vy[i];
          for (let nbk = 0; nbk < 5; nbk++) {
            let j;
            if (nbk === 0) j = next[i];   // the rest of this bucket
            else {
              const ox = nbk === 1 || nbk === 4 ? 1 : nbk === 2 ? -1 : 0;
              if (cx + ox < 0 || cx + ox >= gw || cy + (nbk > 1 ? 1 : 0) >= gh) continue;
              const c = c0 + NB[nbk];
              if (stamp[c] !== st) continue;
              j = head[c];
            }
            for (; j >= 0; j = next[j]) {
              const dx = px[j] - pxi, dy = py[j] - pyi, d2 = dx * dx + dy * dy;
              if (d2 >= rc2 || d2 < 1e-12) continue;
              const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
              const k2 = kp[j], kk = ki < k2 ? ki : k2, s2 = sk[j], damp = si < s2 ? si : s2;
              const rvx = vx[j] - vxi, rvy = vy[j] - vyi, rn = rvx * nx + rvy * ny;
              // metal squeezed against metal of the same piece joins up again (that's how it flows instead of cracking)
              if (body[i] === body[j] && nw < maxW && brk[i] < duct[i] && brk[j] < duct[j] && soft[i] > 0.1 && soft[j] > 0.1) { weld[2 * nw] = i; weld[2 * nw + 1] = j; nw++; }
              const Fn = kk * (rc - d) - cdamp * damp * rn;
              if (Fn <= 0) continue;
              const rt = -rvx * ny + rvy * nx;
              let Ft = -1.4 * damp * rt; const lim = FRICTION * Fn;
              if (Ft > lim) Ft = lim; else if (Ft < -lim) Ft = -lim;
              const Fx = Fn * nx - Ft * ny, Fy = Fn * ny + Ft * nx;
              fx[j] += Fx; fy[j] += Fy; fx[i] -= Fx; fy[i] -= Fy;
              const W = (Ft < 0 ? -Ft : Ft) * (rt < 0 ? -rt : rt) * dt * 0.25;   // rubbing makes heat (most of it leaves with the debris)
              T[i] += W * icp[i]; T[j] += W * icp[j];
              if (bproj !== (body[j] === 0)) { hx += pxi + px[j]; hy += pyi + py[j]; hn += 2; }
            }
          }
        }
      }
      for (let w = 0; w < nw; w++) {
        const i = weld[2 * w], j = weld[2 * w + 1];
        if (this.bonded(i, j)) continue;
        const dx = px[j] - px[i], dy = py[j] - py[i];
        if (this.addBond(i, j, Math.sqrt(dx * dx + dy * dy))) { brk[i]++; brk[j]++; }   // each re-join uses up some of its ductility
      }
      return hn ? [hx / hn, hy / hn] : null;
    }

    // move everything (and find the fastest particle for the next time step)
    move(dt) {
      const N = this.n, px = this.px, py = this.py, vx = this.vx, vy = this.vy, fx = this.fx, fy = this.fy, im = this.im, T = this.T, soft = this.soft;
      const alive = this.alive, fixed = this.fixed, melt = this.melt, box = this.box, bx0 = box[0], bx1 = box[1], by0 = box[2], by1 = box[3];
      const ax = this.ax, ay = this.ay, ag = this.ag, attached = this.attached, rubble = this.rubble, icp = this.icp, gk = this.gk;
      let vmax2 = 0, maxT = this.maxT;
      for (let i = 0; i < N; i++) {
        if (alive[i] === 0) continue;
        if (fixed[i] === 0) {
          const g = ag[i] * soft[i];   // hot metal holds on less
          if (g > 0 && (attached[i] === 1 || rubble[i] === 1)) {   // 3D grip: pulls back toward the anchor, slipping (and heating) when pushed past its strength
            let gx = (ax[i] - px[i]) * gk, gy = (ay[i] - py[i]) * gk;
            const gm = Math.sqrt(gx * gx + gy * gy);
            if (gm > g) {
              const k = g / gm; gx *= k; gy *= k;
              const nx = px[i] + gx / gk, ny = py[i] + gy / gk, slip = Math.sqrt((ax[i] - nx) * (ax[i] - nx) + (ay[i] - ny) * (ay[i] - ny));
              ax[i] = nx; ay[i] = ny; T[i] += g * slip * icp[i] * HEAT_GAIN * 0.5;
            }
            fx[i] += gx; fy[i] += gy;
          }
          let vxi = vx[i] + fx[i] * im[i] * dt, vyi = vy[i] + fy[i] * im[i] * dt;
          let v2 = vxi * vxi + vyi * vyi;
          if (v2 > 144) { const k = 12 / Math.sqrt(v2); vxi *= k; vyi *= k; v2 = 144; }   // safety limit: 12 km/s
          vx[i] = vxi; vy[i] = vyi;
          const x = px[i] + vxi * dt, y = py[i] + vyi * dt;
          px[i] = x; py[i] = y;
          if (v2 > vmax2) vmax2 = v2;
          if (x < bx0 || x > bx1 || y < by0 || y > by1) { alive[i] = 0; continue; }
        }
        let Ti = T[i];
        if (Ti > 400) {
          const mt = melt[i];
          if (Ti > mt + 250) Ti = T[i] = mt + 250;   // molten stuff doesn't keep heating (the heat leaves with it)
          const s = (mt - Ti) / (mt - 400); soft[i] = s > 0.05 ? s : 0.05;
          if (Ti > maxT) maxT = Ti;
        }
      }
      this.maxT = maxT;
      return vmax2;
    }

    compactBonds() {
      let w = 0;
      for (let b = 0; b < this.nb; b++) {
        if (this.bi[b] < 0) continue;
        if (w !== b) { this.bi[w] = this.bi[b]; this.bj[w] = this.bj[b]; this.L0[w] = this.L0[b]; this.Lo[w] = this.Lo[b]; this.bk[w] = this.bk[b]; this.bey[w] = this.bey[b]; this.bef[w] = this.bef[b]; this.bec[w] = this.bec[b]; this.bc[w] = this.bc[b]; }
        w++;
      }
      this.nb = w;
    }

    addBond(i, j, L) {
      if (this.nb >= this.bcap || this.nadj[i] >= MAXN || this.nadj[j] >= MAXN) return false;
      const b = this.nb++, a = MP[this.mat[i]], c = MP[this.mat[j]], h = this.h;
      const E = Math.min(a.E, c.E), k = SQ3 / 2 * E * h, mr = this.m[i] * this.m[j] / (this.m[i] + this.m[j]);
      this.bi[b] = i; this.bj[b] = j; this.L0[b] = L; this.Lo[b] = L; this.bk[b] = k;
      const pb = this.body[i] === 0 ? K.PSTR : 1;   // projectiles get the same 3D boost the armor gets from its grip
      this.bey[b] = Math.min(a.ey, c.ey) * K.STRENGTH * pb; this.bef[b] = Math.min(a.ef, c.ef) * K.STRETCH * Math.sqrt(pb);
      this.bec[b] = Math.min(a.ec, c.ec) * K.CRUSH * (this.body[i] === 0 ? K.PCRUSH : 1);   // squeezed projectiles flow rather than crumble
      this.bc[b] = K.DAMP * 2 * Math.sqrt(k * mr);
      this.adj[i * MAXN + this.nadj[i]++] = j; this.adj[j * MAXN + this.nadj[j]++] = i;
      return true;
    }
    unlink(i, j) {   // forget that i and j were bonded
      const adj = this.adj;
      for (const [a, z] of [[i, j], [j, i]]) {
        const o = a * MAXN, n = this.nadj[a];
        for (let k = 0; k < n; k++) if (adj[o + k] === z) { adj[o + k] = adj[o + n - 1]; adj[o + n - 1] = -1; this.nadj[a] = n - 1; break; }
      }
    }
    bonded(i, j) {
      const o = i * MAXN, n = this.nadj[i], adj = this.adj;
      for (let k = 0; k < n; k++) if (adj[o + k] === j) return true;
      return false;
    }

    addParticle(x, y, vx, vy, matKey, body, massScale = 1) {
      if (this.n >= this.cap) return -1;
      const i = this.n++, mi = MAT_INDEX[matKey];
      this.px[i] = x; this.py[i] = y; this.vx[i] = vx; this.vy[i] = vy; this.mat[i] = mi; this.body[i] = body;
      this.m[i] = MP[mi].rho * this.volume * massScale; this.im[i] = 1 / this.m[i]; this.T[i] = 900; this.soft[i] = 1; this.alive[i] = 1; this.fixed[i] = 0;
      this.shade[i] = 1; this.nbond[i] = 0; this.setDerived(i); this.brk[i] = 255;   // jets and fragments never re-join
      return i;
    }
    setDerived(i) {
      const mp = MP[this.mat[i]];
      this.kp[i] = this.kc[this.mat[i]]; this.sk[i] = Math.sqrt(this.kp[i] * this.m[i]); this.icp[i] = 1 / (this.m[i] * mp.cp); this.melt[i] = mp.melt; this.duct[i] = Math.min(255, Math.round(mp.duct * K.DUCT));
    }

    // The shell's own particles vanish in the explosion (shown as a flash)
    removeProjectile() {
      const [a, b] = this.projRange;
      for (let i = a; i < b; i++) this.alive[i] = 0;
    }

    trigger(cx, cy) {
      this.triggered = true;
      const d = this.design, h = this.h, pl = this.plateAt(cx, cy) || this.firstPlate, n = pl.f.n;
      if (this.kind === 'heat') {
        // the liner collapses into a thin, very fast metal jet (tip fastest, tail slowest)
        const P = d.q * d.cal;                       // how deep the design should go into steel
        const L = P * K.JET_SCALE, count = Math.max(8, Math.round(L / (0.8 * h)));
        const vTip = d.vTip, vTail = Math.max(1.5, vTip * 0.28);
        const startX = cx - 1.2 * h;
        for (let k = 0; k < count; k++) {
          const f = k / (count - 1);
          this.addParticle(startX - k * 0.8 * h, cy, vTip + (vTail - vTip) * f, 0, 'cu', 0, K.JET_MASS);
        }
        this.events.push({ type: 'flash', x: cx - d.probe * 0.5, y: cy, r: d.cal * 1.6, t: this.time });
      } else if (this.kind === 'hesh') {
        // the explosive spreads on the plate and slams it: a shock wave runs through and can knock a scab off the back
        const R = d.cal * 0.75, I = K.HESH_PUSH;
        const eff = pl.layers.reduce((s, l) => s + l.t * (l.mat === 'comp' || MATERIALS[l.mat].group === 'Ceramics' ? 2.2 : MP[MAT_INDEX[l.mat]].E > 0.1 ? 1 : 0.5), 0);
        this.scab = { t: this.time + pl.T / 5.2, pl, cx, cy, ok: eff <= 1.25 * d.cal * K.HESH_CAP };
        for (let i = pl.i0; i < pl.i1; i++) {
          if (!this.alive[i] || this.fixed[i]) continue;
          const du = this.u[i]; if (du > 2.2 * h) continue;          // only the front skin gets the blast
          const dx = this.px[i] - cx, dy = this.py[i] - cy, r2 = dx * dx + dy * dy;
          if (r2 > 4 * R * R) continue;
          const g = Math.exp(-r2 / (R * R)) * I;
          this.vx[i] += n[0] * g; this.vy[i] += n[1] * g; this.T[i] += 250 * g / I;
        }
        this.events.push({ type: 'flash', x: cx, y: cy, r: d.cal * 1.8, t: this.time });
      } else if (this.kind === 'he') {
        // a blast pushes the plate, and the steel case breaks into fast fragments
        const R = d.cal * 1.1;
        for (const p of this.plates) for (let i = p.i0; i < p.i1; i++) {
          if (!this.alive[i] || this.fixed[i]) continue;
          const dx = this.px[i] - cx, dy = this.py[i] - cy, r2 = dx * dx + dy * dy;
          if (r2 > 4 * R * R) continue;
          const g = Math.exp(-r2 / (R * R)) * K.HE_PUSH, r = Math.sqrt(r2) || 1;
          this.vx[i] += (dx / r) * g * 0.5 + n[0] * g * 0.5; this.vy[i] += (dy / r) * g * 0.5 + n[1] * g * 0.5; this.T[i] += 400 * g / K.HE_PUSH;
        }
        const nf = 48, cr = d.cal / 2;   // the steel case bursts into fragments spraying out from the shell's side
        for (let k = 0; k < nf; k++) {
          const a = (k / nf) * Math.PI * 2, sx = cx - n[0] * cr - Math.cos(a) * cr * 0.6, sy = cy - n[1] * cr - Math.sin(a) * cr * 0.6;
          const sp = 1.1 + 0.4 * frac(Math.sin(k * 91.3) * 437.5), dir = Math.atan2(sy - (cy - n[1] * cr * 1.6), sx - (cx - n[0] * cr * 1.6));
          this.addParticle(sx, sy, Math.cos(dir) * sp, Math.sin(dir) * sp, 'shot', 0, 1.5);
        }
        this.events.push({ type: 'flash', x: cx, y: cy, r: d.cal * 2.6, t: this.time });
      }
    }

    // HESH: the shock wave bounces off the inside face and tears a "scab" of metal off it
    knockScab() {
      const { pl, cx, cy, ok } = this.scab; this.scab = null;
      if (!ok) return;
      const n = pl.f.n, t = pl.f.t, R = this.design.cal * 0.7, depth = Math.min(40, Math.max(2 * this.h, pl.T * 0.25));
      const along = (cx - pl.f.o[0]) * t[0] + (cy - pl.f.o[1]) * t[1];
      const inScab = new Uint8Array(this.n);
      for (let i = pl.i0; i < pl.i1; i++) {
        if (!this.alive[i] || this.u[i] < pl.T - depth) continue;
        const v = (this.px[i] - pl.f.o[0]) * t[0] + (this.py[i] - pl.f.o[1]) * t[1] - along;
        const r = R * (1 - (pl.T - this.u[i]) / depth * 0.35);   // a dish shape, wider at the face
        if (Math.abs(v) > r) continue;
        inScab[i] = 1;
        const sp = 0.16 + 0.08 * (1 - Math.abs(v) / r);
        this.vx[i] += n[0] * sp + t[0] * v / R * 0.04; this.vy[i] += n[1] * sp + t[1] * v / R * 0.04; this.T[i] += 120; this.brk[i] = 255;
      }
      for (let b = 0; b < this.nb; b++) { const i = this.bi[b]; if (i >= 0 && inScab[i] !== inScab[this.bj[b]]) { this.bi[b] = -1; this.unlink(i, this.bj[b]); } }
      this.events.push({ type: 'scab', x: cx + n[0] * pl.T, y: cy + n[1] * pl.T, t: this.time });
    }

    plateAt(x, y) {   // which plate is this point in (or nearest to)
      let best = null, bd = Infinity;
      for (const p of this.plates) {
        const dx = x - p.f.o[0], dy = y - p.f.o[1], u = dx * p.f.n[0] + dy * p.f.n[1];
        const du = u < 0 ? -u : u > p.T ? u - p.T : 0;
        if (du < bd) { bd = du; best = p; }
      }
      return best;
    }

    checkReactive() {
      for (const p of this.plates) {
        if (this.detonated.has(p) || !p.layers.some(l => MATERIALS[l.mat].explosive)) continue;
        let fire = false, cx = 0, cy = 0, cn = 0;
        for (let i = p.i0; i < p.i1; i++) {
          if (!MP[this.mat[i]].explosive) continue;
          const sp = Math.hypot(this.vx[i], this.vy[i]);
          if (!this.alive[i] || this.brk[i] > 0 || sp > 0.06 || this.T[i] > 500) { fire = true; }
          cx += this.px[i]; cy += this.py[i]; cn++;
        }
        if (!fire) continue;
        // boom: the explosive turns to gas and throws the two steel faces apart
        this.detonated.add(p);
        let acc = 0, uMid = 0;
        for (const l of p.layers) { if (MATERIALS[l.mat].explosive) { uMid = acc + l.t / 2; break; } acc += l.t; }
        for (let i = p.i0; i < p.i1; i++) {
          if (!this.alive[i]) continue;
          if (MP[this.mat[i]].explosive) { this.alive[i] = 0; continue; }
          if (this.fixed[i]) continue;
          const side = this.u[i] < uMid ? -1 : 1;
          this.vx[i] += side * p.f.n[0] * K.ERA_FLY; this.vy[i] += side * p.f.n[1] * K.ERA_FLY; this.T[i] += 300;
        }
        for (let b = 0; b < this.nb; b++) { const i = this.bi[b]; if (i >= p.i0 && i < p.i1 && (this.u[i] < uMid) !== (this.u[this.bj[b]] < uMid)) this.bi[b] = -1; }
        this.events.push({ type: 'flash', x: cx / cn, y: cy / cn, r: p.len * 0.35, t: this.time, era: true });
      }
    }

    // ---------------- what happened? ----------------
    measure() {
      this.findAttached();
      const lp = this.lastPlate, n = lp.f.n, o = lp.f.o, back = lp.T;
      const fp = this.firstPlate;
      const [a] = this.projRange;
      let behind = 0, sx = 0, sy = 0, deepest = -Infinity, cnt = 0, mx = 0, my = 0, mvx = 0, mvy = 0, mass = 0, spall = 0;
      for (let i = a; i < this.n; i++) {
        if (this.body[i] !== 0 || !this.alive[i]) continue;
        cnt++;
        const u = (this.px[i] - o[0]) * n[0] + (this.py[i] - o[1]) * n[1];
        const uf = (this.px[i] - fp.f.o[0]) * fp.f.n[0] + (this.py[i] - fp.f.o[1]) * fp.f.n[1];
        if (uf > deepest) deepest = uf;
        const mi = this.m[i]; mass += mi; mx += this.px[i] * mi; my += this.py[i] * mi; mvx += this.vx[i] * mi; mvy += this.vy[i] * mi;
        if (u > back + 2 * this.h) { behind++; sx += this.vx[i]; sy += this.vy[i]; }
      }
      for (let i = lp.i0; i < lp.i1; i++) {
        if (!this.alive[i]) continue;
        const u = (this.px[i] - o[0]) * n[0] + (this.py[i] - o[1]) * n[1];
        if (u > back + this.h && this.attached[i] === 0 && (this.vx[i] * n[0] + this.vy[i] * n[1]) > 0.02) spall++;   // torn-off bits only (a bulge isn't spall)
      }
      if (behind >= 2) { this.everBehind = true; this.residual = Math.max(0, (sx * n[0] + sy * n[1]) / behind); }
      const res = this.res = {
        time: this.time, steps: this.steps, particles: this.n, alive: cnt,
        behind, spall, residual: this.residual, everBehind: this.everBehind,
        depth: Math.max(0, deepest),
        vel: mass ? [mvx / mass, mvy / mass] : [0, 0], com: mass ? [mx / mass, my / mass] : [0, 0],
        massLeft: mass / this.projMass0,
        maxT: this.maxT, broken: this.broken,
      };
      return res;
    }

    // Has it played out? Returns the verdict or null while it's still going.
    verdict() {
      const r = this.measure(), fp = this.firstPlate, nIn = fp.f.n;
      const vIn = r.vel[0] * nIn[0] + r.vel[1] * nIn[1], speed = Math.hypot(r.vel[0], r.vel[1]);
      const vSide = Math.abs(r.vel[0] * fp.f.t[0] + r.vel[1] * fp.f.t[1]);
      const tooLong = this.time > this.timeLimit();
      if (r.everBehind) {   // something of the shell got out the back: let it fly a little, then call it
        if (!this.penAt) this.penAt = this.time;
        return this.time - this.penAt > 60 || tooLong ? 'pen' : null;
      }
      if (this.kind === 'hesh' || this.kind === 'he') {
        const wait = this.kind === 'hesh' ? this.lastPlate.T / 5.2 + 120 : 160;
        if (this.time > wait) return r.spall > 2 ? (this.kind === 'hesh' ? 'spall' : 'pen') : 'stop';
        return null;
      }
      if (this.kind === 'ke' && this.hitAt && vIn < -0.05) return vSide > -vIn ? 'rico' : (r.spall > 2 ? 'spall' : 'stop');   // heading back out
      if (this.kind === 'ke' && this.hitAt && speed < 0.04) return r.spall > 2 ? 'spall' : 'stop';
      if (this.kind === 'heat' && this.triggered && this.time - this.hitAt[2] > 40) {
        let fast = 0; for (let i = this.projRange[1]; i < this.n; i++) if (this.alive[i] && this.body[i] === 0 && this.vx[i] > 0.4) fast++;
        if (!fast) return r.everBehind ? 'pen' : r.spall > 2 ? 'spall' : 'stop';
      }
      if (tooLong) return r.everBehind ? 'pen' : r.spall > 2 ? 'spall' : 'stop';
      return null;
    }
    timeLimit() {
      const T = this.plates.reduce((s, p) => s + p.T / Math.max(0.2, Math.cos(p.ang * DEG)), 0);
      const L = this.shape.x1 - this.shape.x0, gap = this.lastPlate.f.o[0] - this.firstPlate.f.o[0];
      return 200 + 2.5 * (T + L + gap) / Math.max(0.3, this.v0);
    }
  }
  function frac(x) { return x - Math.floor(x); }

  // Tuning knobs, set by calibrating against the classic penetration formulas (see the Learn page)
  const K = { STRENGTH: 1, STRETCH: 1, COMP: 1, CRUSH: 1, DUCT: 1, GRIP: 0.8, PSTR: 1, PCRUSH: 1, PIN: 0, DAMP: 0.02, CDAMP: 0.05, JET_SCALE: 1, JET_MASS: 1.25, HESH_PUSH: 0.3, HESH_CAP: 1, HE_PUSH: 0.35, ERA_FLY: 0.8 };
  function tune(o) { Object.assign(K, o); }

  return { MATERIALS, MAT_KEYS, MAT_INDEX, PROJECTILES, ARMORS, Sim, makeShape, plateThickness, autoLen, pickH, sceneArea, projCal, tune };
});
