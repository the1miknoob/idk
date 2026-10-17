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
    du:       { name: 'Depleted uranium', group: 'Heavy metals', rho: 18.6, E: 170, Y: 1450, ef: 0.12, ec: 0.42, cp: 0.12, melt: 1400, duct: 10, color: '#717862' },
    cu:       { name: 'Copper', group: 'Heavy metals', rho: 8.96, E: 120, Y: 250, ef: 0.6, ec: 0.85, cp: 0.385, melt: 1358, duct: 80, color: '#c8784b' },
    lead:     { name: 'Lead', group: 'Heavy metals', rho: 11.3, E: 16, Y: 25, ef: 0.5, ec: 0.9, cp: 0.13, melt: 600, duct: 120, color: '#7a838d' },
    al2o3:    { name: 'Alumina ceramic', group: 'Ceramics', rho: 3.9, E: 370, Y: 3000, ef: 0.006, ec: 0.3, cp: 0.88, melt: 2300, duct: 6, color: '#e6e0cd' },
    sic:      { name: 'Silicon carbide', group: 'Ceramics', rho: 3.2, E: 420, Y: 3800, ef: 0.005, ec: 0.3, cp: 0.75, melt: 2800, duct: 6, color: '#5d6878' },
    b4c:      { name: 'Boron carbide', group: 'Ceramics', rho: 2.5, E: 450, Y: 4500, ef: 0.005, ec: 0.3, cp: 0.95, melt: 2700, duct: 6, color: '#3f444c' },
    glass:    { name: 'Glass', group: 'Ceramics', rho: 2.5, E: 70, Y: 900, ef: 0.004, ec: 0.06, cp: 0.84, melt: 1700, duct: 0, color: '#9ed6e4' },
    aramid:   { name: 'Aramid fabric', group: 'Fibres & plastics', rho: 1.44, E: 60, Y: 1200, ef: 0.15, ec: 0.6, cp: 1.4, melt: 800, duct: 60, color: '#d6b14a' },
    uhmwpe:   { name: 'Polyethylene fibre (UHMWPE)', group: 'Fibres & plastics', rho: 0.97, E: 40, Y: 1300, ef: 0.2, ec: 0.65, cp: 1.85, melt: 500, duct: 80, color: '#ecebe2' },
    poly:     { name: 'Polycarbonate', group: 'Fibres & plastics', rho: 1.2, E: 2.4, Y: 65, ef: 1, ec: 0.8, cp: 1.2, melt: 500, duct: 60, color: '#b4d5ee' },
    rubber:   { name: 'Rubber', group: 'Fibres & plastics', rho: 1.1, E: 0.1, Y: 15, ef: 3, ec: 0.9, cp: 1.9, melt: 500, duct: 200, color: '#3a3a3a' },
    grp:      { name: 'Glass-fibre textolite', group: 'Fibres & plastics', rho: 1.85, E: 25, Y: 350, ef: 0.03, ec: 0.35, cp: 1.0, melt: 600, duct: 4, color: '#c3cf86' },
    concrete: { name: 'Concrete', group: 'Building & nature', rho: 2.4, E: 30, Y: 40, ef: 0.0006, ec: 0.04, cp: 0.88, melt: 1800, duct: 0, color: '#a29d92' },
    brick:    { name: 'Brick', group: 'Building & nature', rho: 1.9, E: 15, Y: 12, ef: 0.0008, ec: 0.05, cp: 0.84, melt: 1800, duct: 0, color: '#a65a42' },
    sand:     { name: 'Sand', group: 'Building & nature', rho: 1.6, E: 10, Y: 0.5, ef: 0.002, ec: 0.5, cp: 0.83, melt: 1900, duct: 0, color: '#cdb07a' },
    wood:     { name: 'Wood', group: 'Building & nature', rho: 0.6, E: 11, Y: 50, ef: 0.03, ec: 0.3, cp: 1.7, melt: 600, duct: 4, color: '#a2723f' },
    water:    { name: 'Water', group: 'Building & nature', rho: 1.0, E: 2.2, Y: 1, ef: 0.5, ec: 0.95, cp: 4.18, melt: 600, duct: 250, color: '#3f86c4' },
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
    { id: 'p9', group: 'Bullets', name: '9 mm pistol bullet', kind: 'ke', v: 360, d: { shape: 'shell', cal: 9, len: 15, nose: 0.9, mat: 'lead', jacket: { t: 0.5, mat: 'cu' } } },
    { id: 'slug12', group: 'Bullets', name: '12-gauge shotgun slug (lead)', kind: 'ke', v: 450, d: { shape: 'shell', cal: 18.5, len: 22, nose: 0.5, mat: 'lead' } },
    { id: 'b556', group: 'Bullets', name: '5.56 mm rifle bullet (steel tip)', kind: 'ke', v: 940, d: { shape: 'shell', cal: 5.7, len: 23, nose: 3, mat: 'lead', jacket: { t: 0.45, mat: 'cu' }, core: { r: 1.8, tip: -2.5, len: 7, nose: 1.8, mat: 'hhs' } } },
    { id: 'b762', group: 'Bullets', name: '7.62 mm bullet (lead core)', kind: 'ke', v: 850, d: { shape: 'shell', cal: 7.62, len: 28, nose: 2.8, mat: 'lead', jacket: { t: 0.6, mat: 'cu' } } },
    { id: 'b762ap', group: 'Bullets', name: '7.62 mm AP bullet (carbide core)', kind: 'ke', v: 840, d: { shape: 'shell', cal: 7.62, len: 32, nose: 2.8, mat: 'lead', jacket: { t: 0.6, mat: 'cu' }, core: { r: 2.6, tip: -3, len: 22, nose: 1.8, mat: 'wc' } } },
    { id: 'b127', group: 'Bullets', name: '12.7 mm AP bullet', kind: 'ke', v: 880, d: { shape: 'shell', cal: 12.7, len: 58, nose: 2.6, mat: 'lead', jacket: { t: 0.9, mat: 'cu' }, core: { r: 4.4, tip: -5, len: 40, nose: 1.6, mat: 'hhs' } } },
    { id: 'b145', group: 'Bullets', name: '14.5 mm AP bullet', kind: 'ke', v: 1000, d: { shape: 'shell', cal: 14.5, len: 64, nose: 2.6, mat: 'lead', jacket: { t: 1, mat: 'cu' }, core: { r: 5, tip: -5, len: 45, nose: 1.6, mat: 'wc' } } },
    { id: 'ac20', group: 'Autocannon', name: '20 mm AP', kind: 'ke', v: 800, d: { shape: 'shell', cal: 20, len: 70, nose: 1.6, mat: 'shot' } },
    { id: 'ac30ds', bore: 30, group: 'Autocannon', name: '30 mm APDS (tungsten core)', kind: 'ke', v: 1100, d: { shape: 'shell', cal: 18, len: 80, nose: 1.8, mat: 'wha' } },
    { id: 'gau8', bore: 30, group: 'Autocannon', name: '30 mm uranium AP (A-10 gun)', kind: 'ke', v: 1010, d: { shape: 'shell', cal: 30, len: 110, nose: 1.4, mat: 'alu', core: { r: 9, tip: -10, len: 85, nose: 1.2, mat: 'du' } } },
    { id: 'ac30fs', bore: 30, group: 'Autocannon', name: '30 mm dart (APFSDS)', kind: 'ke', v: 1385, d: { shape: 'rod', dia: 10, len: 130, mat: 'wha' } },
    { id: 'ap37', group: 'Solid shells (AP)', name: '37 mm AP', kind: 'ke', v: 880, d: { shape: 'shell', cal: 37, len: 130, nose: 1.4, mat: 'shot' } },
    { id: 'ap57', group: 'Solid shells (AP)', name: '57 mm AP', kind: 'ke', v: 850, d: { shape: 'shell', cal: 57, len: 195, nose: 1.4, mat: 'shot' } },
    { id: 'ap75', group: 'Solid shells (AP)', name: '75 mm APC (capped)', kind: 'ke', v: 620, d: { shape: 'shell', cal: 75, len: 250, nose: 1.4, mat: 'shot', cap: { len: 45, mat: 'cap' } } },
    { id: 'ap76', group: 'Solid shells (AP)', name: '76 mm APCBC', kind: 'ke', v: 790, d: { shape: 'shell', cal: 76, len: 270, nose: 1.5, mat: 'shot', cap: { len: 45, mat: 'cap' } } },
    { id: 'ap88', group: 'Solid shells (AP)', name: '88 mm APCBC', kind: 'ke', v: 780, d: { shape: 'shell', cal: 88, len: 310, nose: 1.5, mat: 'shot', cap: { len: 52, mat: 'cap' } } },
    { id: 'ap100', group: 'Solid shells (AP)', name: '100 mm APBC', kind: 'ke', v: 890, d: { shape: 'shell', cal: 100, len: 340, nose: 1.2, mat: 'shot' } },
    { id: 'ap122', group: 'Solid shells (AP)', name: '122 mm AP', kind: 'ke', v: 800, d: { shape: 'shell', cal: 122, len: 420, nose: 1.4, mat: 'shot' } },
    { id: 'ap128', group: 'Solid shells (AP)', name: '128 mm APCBC', kind: 'ke', v: 920, d: { shape: 'shell', cal: 128, len: 460, nose: 1.5, mat: 'shot', cap: { len: 70, mat: 'cap' } } },
    { id: 'aphe76', group: 'Explosive-filled AP (APHE)', name: '76 mm APHE', kind: 'ke', v: 660, aphe: { fuse: 900, charge: 1 }, d: { shape: 'shell', cal: 76, len: 280, nose: 1.4, mat: 'shot' } },
    { id: 'aphe85', group: 'Explosive-filled AP (APHE)', name: '85 mm APHE', kind: 'ke', v: 792, aphe: { fuse: 900, charge: 1.3 }, d: { shape: 'shell', cal: 85, len: 300, nose: 1.4, mat: 'shot' } },
    { id: 'aphe88', group: 'Explosive-filled AP (APHE)', name: '88 mm APCBC-HE', kind: 'ke', v: 773, aphe: { fuse: 1000, charge: 1.2 }, d: { shape: 'shell', cal: 88, len: 320, nose: 1.5, mat: 'shot', cap: { len: 52, mat: 'cap' } } },
    { id: 'aphe122', group: 'Explosive-filled AP (APHE)', name: '122 mm APHE', kind: 'ke', v: 780, aphe: { fuse: 1000, charge: 2.2 }, d: { shape: 'shell', cal: 122, len: 440, nose: 1.4, mat: 'shot' } },
    { id: 'cr57', bore: 57, group: 'Hard-core shot (APCR)', name: '57 mm APCR', kind: 'ke', v: 1150, d: { shape: 'shell', cal: 57, len: 170, nose: 1.4, mat: 'alu', core: { r: 13, tip: -14, len: 100, nose: 1.2, mat: 'wc' } } },
    { id: 'cr76', bore: 76, group: 'Hard-core shot (APCR)', name: '76 mm APCR', kind: 'ke', v: 1040, d: { shape: 'shell', cal: 76, len: 230, nose: 1.4, mat: 'alu', core: { r: 18, tip: -18, len: 140, nose: 1.2, mat: 'wc' } } },
    { id: 'cr88', bore: 88, group: 'Hard-core shot (APCR)', name: '88 mm APCR', kind: 'ke', v: 1130, d: { shape: 'shell', cal: 88, len: 260, nose: 1.4, mat: 'alu', core: { r: 21, tip: -20, len: 160, nose: 1.2, mat: 'wc' } } },
    { id: 'ds84', bore: 84, group: 'Discarding sabot (APDS)', name: '84 mm APDS', kind: 'ke', v: 1430, d: { shape: 'shell', cal: 50, len: 190, nose: 1.2, mat: 'shot', core: { r: 15, tip: -10, len: 150, nose: 1, mat: 'wc' } } },
    { id: 'ds105', bore: 105, group: 'Discarding sabot (APDS)', name: '105 mm APDS', kind: 'ke', v: 1470, d: { shape: 'shell', cal: 60, len: 240, nose: 1.2, mat: 'shot', core: { r: 18, tip: -12, len: 190, nose: 1, mat: 'wc' } } },
    { id: 'ds17', bore: 76, group: 'Discarding sabot (APDS)', name: '76 mm APDS (17-pounder)', kind: 'ke', v: 1200, d: { shape: 'shell', cal: 44, len: 160, nose: 1.2, mat: 'shot', core: { r: 16, tip: -6, len: 135, nose: 1, mat: 'wc' } } },
    { id: 'fs1', bore: 115, group: 'Long-rod darts (APFSDS)', name: 'Early dart · 420 mm steel rod', kind: 'ke', v: 1500, d: { shape: 'rod', dia: 32, len: 420, mat: 'hhs' } },
    { id: 'fs2', bore: 120, group: 'Long-rod darts (APFSDS)', name: 'Dart · 550 mm tungsten rod', kind: 'ke', v: 1650, d: { shape: 'rod', dia: 26, len: 550, mat: 'wha' } },
    { id: 'fs3', bore: 120, group: 'Long-rod darts (APFSDS)', name: 'Long dart · 700 mm tungsten rod', kind: 'ke', v: 1700, d: { shape: 'rod', dia: 25, len: 700, mat: 'wha' } },
    { id: 'fs105du', bore: 105, group: 'Long-rod darts (APFSDS)', name: '105 mm dart · 450 mm uranium rod', kind: 'ke', v: 1490, d: { shape: 'rod', dia: 24, len: 450, mat: 'du' } },
    { id: 'fs120du', bore: 120, group: 'Long-rod darts (APFSDS)', name: '120 mm dart · 780 mm uranium rod', kind: 'ke', v: 1670, d: { shape: 'rod', dia: 25, len: 780, mat: 'du' } },
    { id: 'grenade40', group: 'Shaped charges (HEAT)', name: '40 mm grenade (shaped charge)', kind: 'heat', v: 76, d: { shape: 'heat', cal: 40, len: 100, probe: 10, q: 1.6, vTip: 6 } },
    { id: 'heat75', group: 'Shaped charges (HEAT)', name: '75 mm HEAT (early)', kind: 'heat', v: 450, d: { shape: 'heat', cal: 75, len: 250, probe: 20, q: 3.2, vTip: 6.5 } },
    { id: 'heat105', group: 'Shaped charges (HEAT)', name: '105 mm HEAT', kind: 'heat', v: 1170, d: { shape: 'heat', cal: 105, len: 420, probe: 110, q: 4.6, vTip: 7.5 } },
    { id: 'heat120', group: 'Shaped charges (HEAT)', name: '120 mm HEAT (modern)', kind: 'heat', v: 1140, d: { shape: 'heat', cal: 120, len: 480, probe: 170, q: 6, vTip: 8.5 } },
    { id: 'bazooka', group: 'Rockets & missiles', name: 'Bazooka rocket (60 mm HEAT, 1943)', kind: 'heat', v: 82, d: { shape: 'heat', cal: 60, len: 280, probe: 40, q: 1.7, vTip: 6 } },
    { id: 'pzf', group: 'Rockets & missiles', name: 'Panzerfaust (150 mm HEAT, 1944)', kind: 'heat', v: 60, d: { shape: 'heat', cal: 149, len: 330, probe: 0, q: 1.4, vTip: 5.5 } },
    { id: 'rpg7', group: 'Rockets & missiles', name: 'RPG-7 rocket (85 mm HEAT)', kind: 'heat', v: 115, d: { shape: 'heat', cal: 85, len: 330, probe: 120, q: 3.6, vTip: 7.2 } },
    { id: 'law66', group: 'Rockets & missiles', name: 'LAW rocket (66 mm HEAT)', kind: 'heat', v: 145, d: { shape: 'heat', cal: 66, len: 260, probe: 30, q: 3.8, vTip: 7 } },
    { id: 'atgm', group: 'Rockets & missiles', name: 'Wire-guided missile (120 mm HEAT)', kind: 'heat', v: 190, d: { shape: 'heat', cal: 120, len: 500, probe: 160, q: 4.3, vTip: 7.8 } },
    { id: 'tandem', group: 'Rockets & missiles', name: 'Tandem missile (beats reactive armor)', kind: 'heat', v: 300, d: { shape: 'heat', cal: 152, len: 620, probe: 260, q: 6.2, vTip: 9, tandem: { cal: 40, q: 2, delay: 70 } } },
    { id: 'topjav', group: 'Rockets & missiles', name: 'Top-attack tandem missile (127 mm)', kind: 'heat', v: 190, d: { shape: 'heat', cal: 127, len: 560, probe: 200, q: 6.2, vTip: 9, tandem: { cal: 35, q: 2, delay: 70 } } },
    { id: 'efp', group: 'Rockets & missiles', name: 'Top-attack slug (EFP, copper)', kind: 'ke', v: 2000, d: { shape: 'block', cal: 50, len: 120, mat: 'cu' } },
    { id: 'hesh105', group: 'Squash head (HESH)', name: '105 mm HESH', kind: 'hesh', v: 730, d: { shape: 'hesh', cal: 105, len: 360 } },
    { id: 'hesh120', group: 'Squash head (HESH)', name: '120 mm HESH', kind: 'hesh', v: 670, d: { shape: 'hesh', cal: 120, len: 410 } },
    { id: 'hesh165', group: 'Squash head (HESH)', name: '165 mm HESH (demolition)', kind: 'hesh', v: 260, d: { shape: 'hesh', cal: 165, len: 520 } },
    { id: 'he75', group: 'High explosive (HE)', name: '75 mm HE', kind: 'he', v: 550, d: { shape: 'shell', cal: 75, len: 280, nose: 2, mat: 'shot', fill: 0.62 } },
    { id: 'he122', group: 'High explosive (HE)', name: '122 mm HE', kind: 'he', v: 680, d: { shape: 'shell', cal: 122, len: 460, nose: 2, mat: 'shot', fill: 0.62 } },
    { id: 'he152', group: 'High explosive (HE)', name: '152 mm HE', kind: 'he', v: 650, d: { shape: 'shell', cal: 152, len: 600, nose: 2, mat: 'shot', fill: 0.62 } },
    { id: 'ball', group: 'Just for fun', name: '50 mm steel ball', kind: 'ke', v: 1000, d: { shape: 'ball', cal: 50, mat: 'hhs' } },
    { id: 'wcube', group: 'Just for fun', name: '40 mm tungsten block', kind: 'ke', v: 1500, d: { shape: 'block', cal: 40, len: 40, mat: 'wha' } },
    { id: 'rail', group: 'Just for fun', name: 'Railgun slug (made up, 2.5 km/s)', kind: 'ke', v: 2500, d: { shape: 'rod', dia: 30, len: 240, mat: 'wha' } },
    { id: 'bowling', group: 'Just for fun', name: 'Bowling ball from a cannon', kind: 'ke', v: 300, d: { shape: 'ball', cal: 218, mat: 'poly' } },
    { id: 'anvil', group: 'Just for fun', name: 'Anvil (made up, 300 m/s)', kind: 'ke', v: 300, d: { shape: 'block', cal: 120, len: 200, mat: 'mild' } },
    { id: 'meteor', group: 'Just for fun', name: 'Iron meteorite (made up, 3 km/s)', kind: 'ke', v: 3000, d: { shape: 'ball', cal: 150, mat: 'mild' } },
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
    { id: 'vest2', name: 'Silicon carbide + polyethylene plate', plates: [{ x: 0, ang: 0, len: 'auto', layers: [{ mat: 'sic', t: 10 }, { mat: 'uhmwpe', t: 20 }] }] },
    { id: 'nera', name: 'NERA (steel-rubber-steel sandwiches)', plates: [0, 70, 140].map(x => ({ x, ang: 60, len: 'auto', layers: [{ mat: 'rha', t: 5 }, { mat: 'rubber', t: 10 }, { mat: 'rha', t: 5 }] })).concat([{ x: 260, ang: 0, len: 'auto', layers: [{ mat: 'rha', t: 60 }] }]) },
    { id: 'tracks', name: 'Spare track links on a hull plate', plates: [{ x: 0, ang: 30, len: 'auto', layers: [{ mat: 'cast', t: 25 }] }, { x: 80, ang: 30, len: 'auto', layers: [{ mat: 'rha', t: 50 }] }] },
    { id: 'uranium', name: 'Uranium layer (made-up modern front)', plates: [{ x: 0, ang: 30, len: 'auto', layers: [{ mat: 'hhs', t: 40 }, { mat: 'du', t: 60 }, { mat: 'rubber', t: 15 }, { mat: 'rha', t: 60 }] }] },
    { id: 'sandbags', name: 'Sandbags (600 mm of sand)', plates: [{ x: 0, ang: 0, len: 'auto', layers: [{ mat: 'sand', t: 600 }] }] },
    { id: 'brick', name: 'Brick wall (two bricks thick)', plates: [{ x: 0, ang: 0, len: 'auto', layers: [{ mat: 'brick', t: 230 }] }] },
    { id: 'liner', name: 'Steel plate with a spall liner', plates: [{ x: 0, ang: 0, len: 'auto', layers: [{ mat: 'rha', t: 60 }, { mat: 'aramid', t: 20 }] }] },
    { id: 'heavyera', name: 'Heavy reactive armor on a sloped plate', plates: [{ x: 0, ang: 65, len: 'auto', layers: [{ mat: 'rha', t: 15 }, { mat: 'era', t: 15 }, { mat: 'rha', t: 15 }] }, { x: 200, ang: 65, len: 'auto', layers: [{ mat: 'rha', t: 80 }] }] },
    { id: 'cardoor', name: 'Car door (two thin steel skins)', plates: [{ x: 0, ang: 0, len: 500, layers: [{ mat: 'mild', t: 2 }] }, { x: 60, ang: 0, len: 500, layers: [{ mat: 'mild', t: 2 }] }] },   // tall, so the particles aren't tiny
    { id: 'shield', name: 'Police shield (polyethylene)', plates: [{ x: 0, ang: 0, len: 'auto', layers: [{ mat: 'uhmwpe', t: 14 }] }] },
    { id: 'engine', name: 'Engine block (metal walls with gaps)', plates: [0, 70, 140].map(x => ({ x, ang: 0, len: 'auto', layers: [{ mat: 'cast', t: 18 }] })) },
    { id: 'water', name: 'Water tank (500 mm of water)', plates: [{ x: 0, ang: 0, len: 'auto', layers: [{ mat: 'mild', t: 6 }, { mat: 'water', t: 500 }, { mat: 'mild', t: 6 }] }] },
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
    const a = p.ang * DEG, n = [Math.cos(a), -Math.sin(a)], t = [Math.sin(a), Math.cos(a)];
    if (p.cy != null) return { n, t, o: [p.cx, p.cy] };   // vehicle parts are placed by the middle of their front face
    return { n, t, o: [p.x + (p.off || 0) * t[0], (p.off || 0) * t[1]] };
  }
  // point-in-polygon and distance-to-segment, for plates cut to an exact outline (vehicle parts)
  function inPoly(poly, x, y) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function segDist(x, y, s) {
    const dx = s[2] - s[0], dy = s[3] - s[1], L2 = dx * dx + dy * dy || 1;
    const k = Math.max(0, Math.min(1, ((x - s[0]) * dx + (y - s[1]) * dy) / L2)), ex = s[0] + k * dx - x, ey = s[1] + k * dy - y;
    return Math.sqrt(ex * ex + ey * ey);
  }
  function autoLen(p, proj) {   // tall enough for the crater and for bending, without wasting particles
    const t = plateThickness(p), cal = proj ? projCal(proj) : 100;
    return Math.max(6 * cal, 0.45 * t, 120) / Math.max(0.35, Math.cos(p.ang * DEG));
  }
  const projCal = P => P.d.shape === 'rod' ? P.d.dia : P.d.cal;
  // Several shells at once. 'spread' puts them side by side (gap = mm between their sides), all arriving together;
  // 'row' lines them up one behind another (gap = mm from one's tail to the next one's nose), like a burst from a machine gun.
  // Returns [{ dy, back }] (sideways offset from the aim line, distance behind the first), the middle one first; null for one shell.
  function volleyRounds(proj, vol) {
    const n = Math.max(1, Math.min(8, Math.round((vol && vol.n) || 1)));
    if (n === 1) return null;
    const sh = makeShape(proj.d), gap = Math.max(0, +vol.gap || 0);
    const list = Array.from({ length: n }, (_, k) => (vol.pattern === 'row' ? { dy: 0, back: k * (sh.x1 - sh.x0 + gap) } : { dy: (k - (n - 1) / 2) * (2 * sh.r + gap), back: 0 }));
    return list.sort((a, b) => Math.abs(a.dy) - Math.abs(b.dy));
  }
  const volleySpan = (proj, vol) => { const r = proj && volleyRounds(proj, vol); return r ? Math.max(...r.map(q => q.dy)) - Math.min(...r.map(q => q.dy)) : 0; };   // how wide a spread is
  const plateLen = (p, proj, vol) => (p.len === 'auto' ? autoLen(p, proj) + volleySpan(proj, vol) / Math.max(0.35, Math.cos(p.ang * DEG)) : p.len);

  // Rough area (mm²) of a scene, so we can pick a particle size for a particle budget
  function sceneArea(scene) {
    let a = 0;
    for (const p of scene.plates) a += plateThickness(p) * plateLen(p, scene.proj, scene.volley);
    if (scene.proj.kind === 'ke') { const sh = makeShape(scene.proj.d); a += (sh.x1 - sh.x0) * sh.r * 1.7 * (volleyRounds(scene.proj, scene.volley) || [0]).length; }
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
  // Every particle has a value in each of these arrays (they grow together when more particles are added)
  const PARR = {
    px: Float32Array, py: Float32Array, vx: Float32Array, vy: Float32Array, fx: Float32Array, fy: Float32Array, m: Float32Array, im: Float32Array,
    T: Float32Array, soft: Float32Array, u: Float32Array, shade: Float32Array, sk: Float32Array, kp: Float32Array, icp: Float32Array, melt: Float32Array,
    ax: Float32Array, ay: Float32Array, ag: Float32Array,
    mat: Uint8Array, body: Int16Array, fixed: Uint8Array, alive: Uint8Array, nbond: Uint8Array, brk: Uint8Array, edge: Uint8Array, duct: Uint8Array,
    attached: Uint8Array, rubble: Uint8Array, awake: Uint8Array, calm: Uint8Array, loose: Uint8Array, nadj: Uint8Array, inlist: Uint8Array,
    next: Int32Array, cellOf: Int32Array, occ: Int32Array, uf: Int32Array, snext: Int32Array, scell: Int32Array, alist: Int32Array,
  };
  const BARR = { bi: Int32Array, bj: Int32Array, L0: Float32Array, Lo: Float32Array, bk: Float32Array, bey: Float32Array, bef: Float32Array, bec: Float32Array, bc: Float32Array };
  // Sleeping (whole vehicles): most of a vehicle sits still, so still particles skip the physics until something disturbs them
  const WAKE_V2 = 0.002 * 0.002;    // a particle moving faster than 2 m/s wakes its bonded neighbours
  const SLEEP_V2 = 0.001 * 0.001;   // one slower than 1 m/s for a while…
  const CALM_STEPS = 60;            // …this many steps in a row goes to sleep

  class Sim {
    // scene: { h, plates, proj (optional), sleep (whole vehicles), pad, trackGone }
    constructor(scene) {
      this.scene = scene;
      const h = this.h = scene.h, dyl = h * SQ3 / 2;
      this.sleepOn = !!scene.sleep;
      this.sleepV2 = SLEEP_V2; this.calmSteps = CALM_STEPS;   // how still, for how long, before a particle sleeps (vehicles relax this after a hit)
      this.volume = SQ3 / 2 * h * h * h;
      this.cap = 0; this.n = 0; this.bcap = 0; this.nb = 0; this.an = 0;   // an: how many entries the awake list has
      this.kc = new Float32Array(MP.length);   // contact stiffness per material
      MP.forEach((mp, i) => { this.kc[i] = SQ3 / 2 * mp.E * h; });
      // plates (body 1, 2, …) built in their own frame so faces are smooth at any angle
      const taken = new Map(), tkey = (x, y) => Math.floor(x / h) * 73856093 ^ Math.floor(y / h) * 19349663;
      const near2 = (scene.clash || 0.8) * h * h;
      const clash = (x, y) => {   // is there already a particle (from an earlier plate) right here?
        const cx = Math.floor(x / h), cy = Math.floor(y / h);
        for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const a = taken.get(gx * 73856093 ^ gy * 19349663); if (!a) continue;
          for (let k = 0; k < a.length; k += 2) { const dx = a[k] - x, dy = a[k + 1] - y; if (dx * dx + dy * dy < near2) return true; }
        }
        return false;
      };
      const proj = scene.proj;
      this.growParticles(4000);
      this.plates = scene.plates.map((p, pi) => {
        const len = plateLen(p, proj, scene.volley), T = plateThickness(p), f = plateFrame(p);
        const rows = Math.max(1, Math.round(T / dyl)), dy = T / rows, pin = K.PIN ? Math.max(2 * h, 6) : -1;   // (the 3D grip holds plates now, so edges aren't pinned)
        const start = this.n;
        for (let k = 0; k < rows; k++) {
          const u = dy * (k + 0.5);
          let acc = 0, mat = p.layers[p.layers.length - 1].mat;
          for (const l of p.layers) { if (u < acc + l.t) { mat = l.mat; break; } acc += l.t; }
          for (let v = -len / 2 + (k % 2) * h / 2; v <= len / 2; v += h) {
            const x = f.o[0] + u * f.n[0] + v * f.t[0], y = f.o[1] + u * f.n[1] + v * f.t[1];
            if (p.clip && !inPoly(p.clip.poly, x, y)) continue;
            if (pi > 0 && clash(x, y)) continue;
            const edge = p.clip ? p.clip.ends.some(s => segDist(x, y, s) < 3 * h) : Math.abs(v) > len / 2 - 3 * h;
            this.addRaw(x, y, MAT_INDEX[mat], pi + 1, 0, 0, u, edge ? 1 : 0, Math.abs(v) > len / 2 - pin);
          }
        }
        for (let i = start; i < this.n; i++) { const kk = tkey(this.px[i], this.py[i]); let a = taken.get(kk); if (!a) taken.set(kk, a = []); a.push(this.px[i], this.py[i]); }
        return { ...p, len, T, f, i0: start, i1: this.n };
      });
      this.growBonds(Math.ceil(this.n * 3.2) + 2000);
      for (const pl of this.plates) this.link(pl.i0, pl.i1);
      for (let i = 0; i < this.n; i++) {
        this.nbond[i] = this.nadj[i]; this.ax[i] = this.px[i]; this.ay[i] = this.py[i]; this.attached[i] = 1;
        this.rubble[i] = /Ceramics/.test(MATERIALS[MAT_KEYS[this.mat[i]]].group) || ['concrete', 'brick', 'sand'].includes(MAT_KEYS[this.mat[i]]) ? 1 : 0;
      }
      this.hasERA = this.plates.some(p => p.layers.some(l => MATERIALS[l.mat].explosive));
      this.gk = 0.05 * SQ3 / 2 * MP[MAT_INDEX.rha].E * h;   // grip stiffness (soft, so it barely changes how waves travel)
      this.weld = new Int32Array(8000);
      this.time = 0; this.steps = 0; this.broken = 0; this.shots = 0;
      this.events = []; this.detonated = new Set(); this.maxT = 293; this.res = null;
      this.gone = scene.trackGone ? [] : null;   // particles that flew out of the world box
      if (proj) this.addShot(proj, null, volleyRounds(proj, scene.volley));
      else {   // a whole vehicle waits for its first shot
        this.targets = this.plates; this.rounds = []; this.scabs = []; this.firstPlate = this.lastPlate = this.plates[0]; this.projRange = [this.n, this.n]; this.shape = null;
        this.kind = 'ke'; this.v0 = 1; this.hitAt = null; this.pending = null; this.jetQueue = null; this.shotT0 = 0; this.weldCap = Infinity;
        if (this.sleepOn) for (let i = 0; i < this.n; i++) this.awake[i] = 0;
        this.setBox(0); this.dt0 = this.dt = CFL * h / 6;
      }
    }

    // ---------------- particles, bonds and room for them ----------------
    growParticles(need) {
      if (need <= this.cap) return;
      const cap = Math.max(need + 4000, Math.ceil(this.cap * 1.5)), old = this.cap;
      for (const k in PARR) { const a = new PARR[k](cap); if (this[k]) a.set(this[k]); this[k] = a; }
      const adj = new Int32Array(cap * MAXN).fill(-1); if (this.adj) adj.set(this.adj); this.adj = adj;
      const bslot = new Int32Array(cap * MAXN).fill(-1); if (this.bslot) bslot.set(this.bslot); this.bslot = bslot;   // which bond each neighbour slot is
      this.scell.fill(-1, old);
      this.cap = cap;
    }
    growBonds(need) {
      if (need <= this.bcap) return;
      const cap = Math.max(need + 2000, Math.ceil(this.bcap * 1.5));
      for (const k in BARR) { const a = new BARR[k](cap); if (this[k]) a.set(this[k]); this[k] = a; }
      this.bcap = cap;
    }
    addRaw(x, y, mi, body, vx, vy, u, edge, fixed) {
      if (this.n >= this.cap) this.growParticles(this.n + 1);
      const i = this.n++, m = MP[mi].rho * this.volume;
      this.px[i] = x; this.py[i] = y; this.vx[i] = vx; this.vy[i] = vy; this.mat[i] = mi; this.body[i] = body; this.fixed[i] = fixed ? 1 : 0;
      this.u[i] = u; this.edge[i] = edge; this.m[i] = m; this.im[i] = fixed ? 0 : 1 / this.m[i]; this.T[i] = 293; this.soft[i] = 1; this.alive[i] = 1;
      this.shade[i] = 0.88 + 0.24 * frac(Math.sin(i * 12.9898) * 43758.5453);
      this.nadj[i] = 0; this.nbond[i] = 0; this.brk[i] = 0; this.attached[i] = 0; this.rubble[i] = 0; this.ag[i] = 0; this.ax[i] = x; this.ay[i] = y;
      this.awake[i] = 1; this.calm[i] = 0; this.loose[i] = 0; this.scell[i] = -1; this.inlist[i] = 0;
      if (this.sleepOn) { this.alist[this.an++] = i; this.inlist[i] = 1; }
      this.setDerived(i);
      return i;
    }
    link(i0, i1) {   // bonds between touching particles of the same body
      const h = this.h, inv = 1 / h, cells = new Map(), key = (cx, cy) => cx * 73856093 ^ cy * 19349663, B = [];
      for (let i = i0; i < i1; i++) { const k = key(Math.floor(this.px[i] * inv), Math.floor(this.py[i] * inv)); let a = cells.get(k); if (!a) cells.set(k, a = []); a.push(i); }
      const r2 = (1.25 * h) ** 2;
      for (let i = i0; i < i1; i++) {
        const cx = Math.floor(this.px[i] * inv), cy = Math.floor(this.py[i] * inv);
        for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const a = cells.get(key(gx, gy)); if (!a) continue;
          for (const j of a) if (j > i) { const dx = this.px[j] - this.px[i], dy = this.py[j] - this.py[i], d2 = dx * dx + dy * dy; if (d2 < r2) B.push(i, j, Math.sqrt(d2)); }
        }
      }
      this.growBonds(this.nb + B.length / 3);
      for (let b = 0; b < B.length; b += 3) this.addBond(B[b], B[b + 1], B[b + 2]);
    }

    // ---------------- a shot ----------------
    // Puts a projectile in front of the target plates (all plates, unless told which), sets the grip for it, and resets the scoring.
    // Several at once: rounds = [{ dy, back, targets }], each shell dy mm to the side of the aim line and back mm behind the first,
    // aimed at its own plates (a vehicle). A vehicle can be shot again and again: the damage from earlier shots stays.
    addShot(proj, targetIdx, rounds) {
      const h = this.h, dyl = h * SQ3 / 2, v0 = proj.v / 1000, again = this.shots > 0;
      if (again || this.sleepOn) {   // everything from earlier shots settles where it is
        for (let i = 0; i < this.n; i++) {
          if (!this.alive[i]) continue;
          this.vx[i] = 0; this.vy[i] = 0; this.ax[i] = this.px[i]; this.ay[i] = this.py[i];
          if (this.sleepOn) { this.awake[i] = 0; this.calm[i] = 0; }
        }
        if (again) this.findAttached();
      }
      this.shots++;
      const sh = this.shape = makeShape(proj.d), aim0 = proj.aim || 0, rowsR = Math.ceil(sh.r / dyl) + 1;
      const pStart = this.n;
      this.rounds = (rounds && rounds.length ? rounds : [{ dy: 0, back: 0, targets: targetIdx }]).map(rd => {
        const tp = rd.targets && rd.targets.length ? rd.targets.map(k => this.plates[k]) : this.plates, aimY = aim0 + (rd.dy || 0);
        // projectile (body 0): put its nose just in front of the first plate it would hit (a burst's later shells further back)
        let hitX = Infinity;
        for (const pl of tp) {   // where the line y = aim meets each plate's front face
          const n = pl.f.n, o = pl.f.o; if (Math.abs(n[0]) < 1e-6) continue;
          const x = o[0] + (n[1] * (o[1] - aimY)) / n[0];
          if (x < hitX) hitX = x;
        }
        if (!isFinite(hitX)) hitX = 0;
        let noseX = hitX - 1.5 * h;
        const surfaceX = y => {   // how far right the shell can be at height y: the left-most plate face, minus a gap measured square to that face
          let best = Infinity;
          for (const pl of tp) {
            const n = pl.f.n, o = pl.f.o; if (Math.abs(n[0]) < 1e-6) continue;
            const xf = o[0] + (n[1] * (o[1] - y)) / n[0];
            if (pl.cy != null && Math.abs((xf - o[0]) * pl.f.t[0] + (y - o[1]) * pl.f.t[1]) > pl.len / 2 + 2 * h) continue;   // this short plate isn't at this height
            const x = xf - 1.6 * h / Math.max(0.25, Math.abs(n[0]));
            if (x < best) best = x;
          }
          return best;
        };
        if (proj.kind === 'ke') {   // slide the shell back until no part of it is inside (or touching) a plate
          for (let k = -rowsR; k <= rowsR; k++) {
            const y = k * dyl;
            for (let x = 0; x >= sh.x0 - h; x -= h) if (sh.at(x, y)) { noseX = Math.min(noseX, surfaceX(aimY + y) - x); break; }
          }
        }
        noseX -= rd.back || 0;
        // Shaped charges, squash heads and HE shells are gone the instant they go off, so only solid shots are made of particles
        // (the page draws the others flying in, and the physics starts with the explosion).
        const a = this.n;
        if (proj.kind === 'ke') for (let k = -rowsR; k <= rowsR; k++) {
          const y = k * dyl;
          for (let x = (Math.abs(k) % 2) * h / 2; x >= sh.x0 - h; x -= h) {
            const m = sh.at(x, y);
            if (m) this.addRaw(noseX + x, aimY + y, MAT_INDEX[m], 0, v0, 0, 0, 0, false);
          }
        }
        this.link(a, this.n);
        for (let i = a; i < this.n; i++) this.nbond[i] = this.nadj[i];
        let m0 = 0; for (let i = a; i < this.n; i++) m0 += this.m[i];
        return { aimY, hitX, noseX, targets: tp, parts: [[a, this.n]], mass0: m0 || 1, delay: (rd.back || 0) / v0,
          lastPlate: tp.reduce((p, q) => (q.f.o[0] + q.T * q.f.n[0] > p.f.o[0] + p.T * p.f.n[0] ? q : p)), firstPlate: tp.reduce((p, q) => (q.f.o[0] < p.f.o[0] ? q : p)),
          hitAt: null, everBehind: false, penAt: 0, residual: 0, res: null, v: null, jetWait: false };
      });
      this.weldCap = Math.ceil(this.nb * 1.6) + 2000;   // re-joins stop once there are this many bonds (keeps runs the same as when tuned)
      const R0 = this.rounds[0];
      this.projRange = [pStart, this.n];
      this.noseX = R0.noseX; this.aimY = R0.aimY; this.hitX = R0.hitX;
      // In real (3D) armor, metal around the hole in the missing third direction also holds each bit in place.
      // A flat slice doesn't have that, so every armor particle gets a "grip" that resists being shoved (and gives way past its strength).
      // It's about the strength of the metal spread over the size of the hole, so it doesn't depend on the particle size.
      const bite = projCal(proj) * (proj.d.shape === 'rod' ? 2.5 : proj.kind === 'heat' ? 0.4 : 1);   // darts dig craters ~2–3× their width; a HEAT jet's hole is ~0.4× the charge
      // Sloped plates: in 3D a shell hitting at a steep angle gets turned and has to tear a longer, wider hole, which a flat slice
      // underplays, so steep plates hold on harder (tuned to WWII slope-effect tables; nothing changes below about 30°)
      // A shell much wider than the plate is thick ("overmatch") barely notices the slope, so the extra grip fades out for thin plates.
      const slopeK = proj.kind === 'ke' && proj.d.shape !== 'rod' ? K.SLOPE : 0, cal = projCal(proj);   // long darts and jets care much less about slope
      const over = pl => Math.max(0, Math.min(1, (pl.T / cal - 0.5) / 0.32));
      const slopeF = [1, ...this.plates.map(pl => 1 + slopeK * over(pl) * Math.max(0, 1 / Math.max(0.2, Math.abs(pl.f.n[0])) - K.SLOPE0))];
      for (let i = 0; i < pStart; i++) if (this.body[i] > 0 && !this.loose[i]) { const mp = MP[this.mat[i]]; this.ag[i] = K.GRIP * mp.ey * mp.E * K.STRENGTH * this.volume / bite * slopeF[this.body[i]]; }
      // time step from the fastest sound speed present
      let cmax = 1; for (let i = 0; i < this.n; i++) if (this.alive[i]) cmax = Math.max(cmax, MP[this.mat[i]].c);
      this.dt0 = CFL * h / cmax; this.dt = this.dt0;
      this.setBox(sh.x1 - sh.x0);
      // scoring for this shot
      this.kind = proj.kind; this.design = proj.d; this.v0 = v0;
      this.triggered = false; this.jetQueue = null; this.scabs = []; this.penAt = 0; this.shotT0 = this.time; this.maxT = 293; this.res = null; this.tally = null;
      this.targets = this.rounds.length === 1 ? R0.targets : [...new Set(this.rounds.flatMap(R => R.targets))];
      this.lastPlate = R0.lastPlate; this.firstPlate = R0.firstPlate;
      this.hitAt = null; this.residual = 0; this.everBehind = false;
      this.pending = proj.kind !== 'ke' ? this.rounds.map(R => ({ x: R.hitX, y: R.aimY, t: this.time + R.delay, R })).sort((p, q) => p.t - q.t) : null;   // when each one goes off
      let m0 = 0; for (let i = pStart; i < this.n; i++) m0 += this.m[i];
      this.projMass0 = m0 || 1;
    }
    // the world box (anything leaving it is gone) and the bucket grids that cover it
    setBox(extra) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < this.n; i++) { if (!this.alive[i]) continue; const x = this.px[i], y = this.py[i]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (!isFinite(x0)) { x0 = y0 = -100; x1 = y1 = 100; }
      const h = this.h, span = Math.max(x1 - x0, y1 - y0);
      let pad = Math.max(span * 0.25, 40 * h, this.scene.pad || 0);
      while (pad > 40 * h && ((span + 2 * pad) / h) ** 2 > 3e6) pad *= 0.8;   // keep the bucket grid a sensible size
      this.box = [x0 - pad, x1 + pad + (extra || 0), y0 - pad, y1 + pad];
      this.gw = Math.ceil((this.box[1] - this.box[0]) / h) + 1; this.gh = Math.ceil((this.box[3] - this.box[2]) / h) + 1;
      const cells = this.gw * this.gh;
      if (!this.head || this.head.length < cells) { this.head = new Int32Array(cells); this.stamp = new Int32Array(cells); if (this.sleepOn) this.shead = new Int32Array(cells); }
      this.stamp.fill(-1);   // every bucket starts empty
      if (this.sleepOn) {   // the still particles live in their own grid, which only changes when something wakes up or settles
        this.shead.fill(-1); this.scell.fill(-1, 0, this.n);
        for (let i = 0; i < this.n; i++) if (this.alive[i] && !this.awake[i]) this.sAdd(i);
      }
    }
    // Turn and slide the whole world (a new shot from another direction is lined up along +x this way)
    transform(c, s, tx, ty) {
      const n = this.n, px = this.px, py = this.py, vx = this.vx, vy = this.vy, ax = this.ax, ay = this.ay;
      for (let i = 0; i < n; i++) {
        let x = px[i], y = py[i]; px[i] = c * x - s * y + tx; py[i] = s * x + c * y + ty;
        x = ax[i]; y = ay[i]; ax[i] = c * x - s * y + tx; ay[i] = s * x + c * y + ty;
        x = vx[i]; y = vy[i]; vx[i] = c * x - s * y; vy[i] = s * x + c * y;
      }
      const rot = v => [c * v[0] - s * v[1], s * v[0] + c * v[1]];
      for (const p of this.plates) {
        p.f = { n: rot(p.f.n), t: rot(p.f.t), o: [c * p.f.o[0] - s * p.f.o[1] + tx, s * p.f.o[0] + c * p.f.o[1] + ty] };
        if (p.cy != null) { const x = p.cx, y = p.cy; p.cx = c * x - s * y + tx; p.cy = s * x + c * y + ty; }
        p.ang = Math.atan2(-p.f.n[1], p.f.n[0]) / DEG;
      }
    }
    // A big blast (an ammo rack going up): everything nearby is thrown outward and torn loose from its plate's grip
    explode(x, y, R, dv, heat = 500) {
      const R2 = R * R;
      for (let i = 0; i < this.n; i++) {
        if (!this.alive[i]) continue;
        const dx = this.px[i] - x, dy = this.py[i] - y, r2 = dx * dx + dy * dy;
        if (r2 > R2) continue;
        const r = Math.sqrt(r2) || 1, f = 1 - r / R;
        if (this.sleepOn) this.wake(i);
        this.vx[i] += dx / r * dv * f; this.vy[i] += dy / r * dv * f; this.T[i] += heat * f; this.loose[i] = 1; this.ag[i] = 0;
      }
      this.events.push({ type: 'flash', x, y, r: R * 0.5, t: this.time, big: true });
    }

    // ---------------- sleeping ----------------
    sAdd(i) {
      const gx = ((this.px[i] - this.box[0]) / this.h) | 0, gy = ((this.py[i] - this.box[2]) / this.h) | 0;
      if (gx < 0 || gy < 0 || gx >= this.gw || gy >= this.gh) return;
      const c = gy * this.gw + gx;
      this.snext[i] = this.shead[c]; this.shead[c] = i; this.scell[i] = c;
    }
    sRemove(i) {
      const c = this.scell[i]; if (c < 0) return;
      let p = -1, k = this.shead[c];
      while (k >= 0 && k !== i) { p = k; k = this.snext[k]; }
      if (k === i) { if (p < 0) this.shead[c] = this.snext[i]; else this.snext[p] = this.snext[i]; }
      this.scell[i] = -1;
    }
    wake(i) {
      if (this.awake[i]) return;
      this.awake[i] = 1; this.calm[i] = 0; this.sRemove(i);
      if (!this.inlist[i]) { this.alist[this.an++] = i; this.inlist[i] = 1; }
    }
    doze(i) { this.awake[i] = 0; this.vx[i] = 0; this.vy[i] = 0; this.sAdd(i); }

    // ---------------- one time step ----------------
    // (split into small functions: JavaScript engines optimize short, tight loops much better)
    step() {
      while (this.pending && this.time >= this.pending[0].t) {
        const p = this.pending.shift();
        if (!this.pending.length) this.pending = null;
        if (!this.hitAt) this.hitAt = [p.x, p.y, this.time];
        p.R.hitAt = [p.x, p.y, this.time]; this.trigger(p.x, p.y, p.R);
      }
      while (this.jetQueue && this.time >= this.jetQueue[0].t) {
        const q = this.jetQueue.shift(), a = this.n;
        if (!this.jetQueue.length) this.jetQueue = null;
        this.makeJet(q.x, q.y, q.P, q.vTip); q.R.parts.push([a, this.n]); q.R.jetWait = false;
      }
      const dt = this.dt;
      this.fx.fill(0, 0, this.n); this.fy.fill(0, 0, this.n);
      let hit, vmax2;
      if (this.sleepOn) { this.broken += this.bondForcesS(); this.buildGridS(); hit = this.contactForcesS(dt); vmax2 = this.moveS(dt); }
      else { this.broken += this.bondForces(); this.buildGrid(); hit = this.contactForces(dt); vmax2 = this.move(dt); }
      this.time += dt; this.steps++;
      this.dt = Math.min(this.dt0, 0.2 * this.h / Math.sqrt(vmax2 + 1e-9));
      // special events: shaped charges, squash heads and explosives go off on contact; reactive tiles explode when struck
      if (hit && !this.hitAt) this.hitAt = [hit[0], hit[1], this.time];
      if (hit && !this.triggered && this.kind !== 'ke') this.trigger(hit[0], hit[1]);
      if (this.hasERA && this.steps % 4 === 0) this.checkReactive();
      for (let k = 0; k < this.scabs.length; k++) if (this.time >= this.scabs[k].t) this.knockScab(this.scabs.splice(k--, 1)[0]);
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
    // the same, but only the bonds of awake particles (each bond once: from its sleeping-neighbour side, or the lower number)
    bondForcesS() {
      const px = this.px, py = this.py, vx = this.vx, vy = this.vy, fx = this.fx, fy = this.fy, T = this.T, soft = this.soft, alive = this.alive, icp = this.icp, brk = this.brk, awake = this.awake;
      const bi = this.bi, bj = this.bj, L0 = this.L0, Lo = this.Lo, bk = this.bk, bey = this.bey, bef = this.bef, bec = this.bec, bc = this.bc;
      const alist = this.alist, an = this.an, adj = this.adj, nadj = this.nadj, bslot = this.bslot;
      let broke = 0;
      const comp = K.COMP;
      for (let q = 0; q < an; q++) {
        const p0 = alist[q];
        if (alive[p0] === 0 || awake[p0] === 0) continue;
        const o = p0 * MAXN;
        for (let sl = nadj[p0] - 1; sl >= 0; sl--) {
        const pj = adj[o + sl], b = bslot[o + sl];
        if (awake[pj] === 1 && pj < p0) continue;
        if (b < 0 || bi[b] < 0) continue;
        const i = bi[b], j = bj[b];
        if (alive[i] === 0 || alive[j] === 0) { bi[b] = -1; this.unlink(i, j); continue; }
        const dx = px[j] - px[i], dy = py[j] - py[i], L = Math.sqrt(dx * dx + dy * dy) + 1e-9;
        const si = soft[i], sj = soft[j], s = si < sj ? si : sj;
        const lo = Lo[b], total = (L - lo) / lo;
        if (total > bef[b] || total < -bec[b]) {
          bi[b] = -1; if (brk[i] < 255) brk[i]++; if (brk[j] < 255) brk[j]++; broke++; this.unlink(i, j);
          continue;
        }
        let l0 = L0[b], e = (L - l0) / l0;
        const ey = bey[b] * s, ec = ey * comp;
        if (e > ey || e < -ec) {
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
    buildGridS() {   // only the particles that are awake (the still ones have their own grid)
      const px = this.px, py = this.py, alive = this.alive, awake = this.awake, head = this.head, stamp = this.stamp, next = this.next, cellOf = this.cellOf;
      const gw = this.gw, bx0 = this.box[0], by0 = this.box[2], inv = 1 / this.h, st = this.steps, alist = this.alist, an = this.an;
      const occ = this.occ; let no = 0;
      for (let q = 0; q < an; q++) {
        const i = alist[q];
        if (alive[i] === 0 || awake[i] === 0) continue;
        const c = ((py[i] - by0) * inv | 0) * gw + ((px[i] - bx0) * inv | 0);
        cellOf[i] = c;
        if (stamp[c] !== st) { stamp[c] = st; head[c] = -1; occ[no++] = c; }
        next[i] = head[c]; head[c] = i;
      }
      this.nocc = no;
    }

    // contacts: anything squeezed closer than its neighbors normally sit gets pushed apart (with friction)
    contactForces(dt) {
      const h = this.h, rc = CONTACT * h, rc2 = rc * rc;
      const px = this.px, py = this.py, vx = this.vx, vy = this.vy, fx = this.fx, fy = this.fy, T = this.T, icp = this.icp, body = this.body;
      const head = this.head, stamp = this.stamp, next = this.next, gw = this.gw, gh = this.gh, st = this.steps;
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
      this.doWelds(weld, nw);
      return hn ? [hx / hn, hy / hn] : null;
    }
    // the same for awake particles, plus awake ones pressing on still ones (a hard enough bump wakes the still one)
    contactForcesS(dt) {
      const h = this.h, rc = CONTACT * h, rc2 = rc * rc;
      const px = this.px, py = this.py, vx = this.vx, vy = this.vy, fx = this.fx, fy = this.fy, T = this.T, icp = this.icp, body = this.body;
      const head = this.head, stamp = this.stamp, next = this.next, gw = this.gw, gh = this.gh, st = this.steps;
      const shead = this.shead, snext = this.snext, alive = this.alive, awake = this.awake;
      const kp = this.kp, sk = this.sk, duct = this.duct, brk = this.brk, soft = this.soft, cdamp = K.CDAMP;
      const weld = this.weld; let nw = 0; const maxW = weld.length / 2;
      const woke = [];
      let hx = 0, hy = 0, hn = 0;
      const occ = this.occ, nocc = this.nocc, NB = [0, 1, gw - 1, gw, gw + 1];
      for (let q = 0; q < nocc; q++) {
        const c0 = occ[q], cx = c0 % gw, cy = (c0 / gw) | 0;
        for (let i = head[c0]; i >= 0; i = next[i]) {
          const bproj = body[i] === 0, ki = kp[i], si = sk[i], pxi = px[i], pyi = py[i], vxi = vx[i], vyi = vy[i];
          for (let nbk = 0; nbk < 5; nbk++) {   // awake neighbours (each pair once)
            let j;
            if (nbk === 0) j = next[i];
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
              if (body[i] === body[j] && nw < maxW && brk[i] < duct[i] && brk[j] < duct[j] && soft[i] > 0.1 && soft[j] > 0.1) { weld[2 * nw] = i; weld[2 * nw + 1] = j; nw++; }
              const Fn = kk * (rc - d) - cdamp * damp * rn;
              if (Fn <= 0) continue;
              const rt = -rvx * ny + rvy * nx;
              let Ft = -1.4 * damp * rt; const lim = FRICTION * Fn;
              if (Ft > lim) Ft = lim; else if (Ft < -lim) Ft = -lim;
              const Fx = Fn * nx - Ft * ny, Fy = Fn * ny + Ft * nx;
              fx[j] += Fx; fy[j] += Fy; fx[i] -= Fx; fy[i] -= Fy;
              const W = (Ft < 0 ? -Ft : Ft) * (rt < 0 ? -rt : rt) * dt * 0.25;
              T[i] += W * icp[i]; T[j] += W * icp[j];
              if (bproj !== (body[j] === 0)) { hx += pxi + px[j]; hy += pyi + py[j]; hn += 2; }
            }
          }
          for (let gy = cy - 1; gy <= cy + 1; gy++) {   // still neighbours
            if (gy < 0 || gy >= gh) continue;
            for (let gx = cx - 1; gx <= cx + 1; gx++) {
              if (gx < 0 || gx >= gw) continue;
              for (let j = shead[gy * gw + gx]; j >= 0; j = snext[j]) {
                if (alive[j] === 0 || awake[j] === 1) continue;
                const dx = px[j] - pxi, dy = py[j] - pyi, d2 = dx * dx + dy * dy;
                if (d2 >= rc2 || d2 < 1e-12) continue;
                const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
                const k2 = kp[j], kk = ki < k2 ? ki : k2, s2 = sk[j], damp = si < s2 ? si : s2;
                const rn = -vxi * nx - vyi * ny;
                const Fn = kk * (rc - d) - cdamp * damp * rn;
                if (Fn <= 0) continue;
                const rt = vxi * ny - vyi * nx;
                let Ft = -1.4 * damp * rt; const lim = FRICTION * Fn;
                if (Ft > lim) Ft = lim; else if (Ft < -lim) Ft = -lim;
                fx[i] -= Fn * nx - Ft * ny; fy[i] -= Fn * ny + Ft * nx;
                const W = (Ft < 0 ? -Ft : Ft) * (rt < 0 ? -rt : rt) * dt * 0.25;
                T[i] += W * icp[i]; T[j] += W * icp[j];
                if (bproj !== (body[j] === 0)) { hx += pxi + px[j]; hy += pyi + py[j]; hn += 2; }
                if (rn * rn > WAKE_V2) woke.push(j);
              }
            }
          }
        }
      }
      for (const j of woke) this.wake(j);
      this.doWelds(weld, nw);
      return hn ? [hx / hn, hy / hn] : null;
    }
    doWelds(weld, nw) {
      const px = this.px, py = this.py, brk = this.brk;
      for (let w = 0; w < nw; w++) {
        if (this.nb >= this.weldCap) break;
        const i = weld[2 * w], j = weld[2 * w + 1];
        if (this.bonded(i, j)) continue;
        const dx = px[j] - px[i], dy = py[j] - py[i];
        if (this.addBond(i, j, Math.sqrt(dx * dx + dy * dy))) { brk[i]++; brk[j]++; }   // each re-join uses up some of its ductility
      }
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
          if (x < bx0 || x > bx1 || y < by0 || y > by1) { alive[i] = 0; if (this.gone) this.gone.push(i); continue; }
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
    // the same for awake particles; fast ones wake their bonded neighbours, and ones that stay slow for a while go to sleep
    moveS(dt) {
      const px = this.px, py = this.py, vx = this.vx, vy = this.vy, fx = this.fx, fy = this.fy, im = this.im, T = this.T, soft = this.soft;
      const alive = this.alive, awake = this.awake, calm = this.calm, fixed = this.fixed, melt = this.melt, box = this.box, bx0 = box[0], bx1 = box[1], by0 = box[2], by1 = box[3];
      const ax = this.ax, ay = this.ay, ag = this.ag, attached = this.attached, rubble = this.rubble, icp = this.icp, gk = this.gk, adj = this.adj, nadj = this.nadj;
      let vmax2 = 0, maxT = this.maxT;
      const wakeList = [], dozeList = [], alist = this.alist, inl = this.inlist, an = this.an, sleepV2 = this.sleepV2, calmN = this.calmSteps;
      let w = 0;
      for (let q = 0; q < an; q++) {
        const i = alist[q];
        if (alive[i] === 0 || awake[i] === 0) { inl[i] = 0; continue; }
        alist[w++] = i;
        if (fixed[i] === 0) {
          const g = ag[i] * soft[i];
          if (g > 0 && (attached[i] === 1 || rubble[i] === 1)) {
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
          if (v2 > 144) { const k = 12 / Math.sqrt(v2); vxi *= k; vyi *= k; v2 = 144; }
          vx[i] = vxi; vy[i] = vyi;
          const x = px[i] + vxi * dt, y = py[i] + vyi * dt;
          px[i] = x; py[i] = y;
          if (v2 > vmax2) vmax2 = v2;
          if (x < bx0 || x > bx1 || y < by0 || y > by1) { alive[i] = 0; if (this.gone) this.gone.push(i); continue; }
          if (v2 > WAKE_V2) { calm[i] = 0; for (let k = 0, o = i * MAXN, nn = nadj[i]; k < nn; k++) { const j = adj[o + k]; if (awake[j] === 0) wakeList.push(j); } }
          if (v2 < sleepV2) { if (calm[i] < 250) calm[i]++; if (calm[i] > calmN) dozeList.push(i); }
          else calm[i] = 0;
        }
        let Ti = T[i];
        if (Ti > 400) {
          const mt = melt[i];
          if (Ti > mt + 250) Ti = T[i] = mt + 250;
          const s = (mt - Ti) / (mt - 400); soft[i] = s > 0.05 ? s : 0.05;
          if (Ti > maxT) maxT = Ti;
        }
      }
      this.an = w;
      for (const j of wakeList) if (alive[j]) this.wake(j);
      for (const i of dozeList) if (alive[i] && calm[i] > calmN) this.doze(i);
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
      if (this.sleepOn) {
        const adj = this.adj, bs = this.bslot, nadj = this.nadj;
        for (let b = 0; b < w; b++) for (const [a, z] of [[this.bi[b], this.bj[b]], [this.bj[b], this.bi[b]]]) {
          const o = a * MAXN; for (let k = 0, n = nadj[a]; k < n; k++) if (adj[o + k] === z) { bs[o + k] = b; break; }
        }
      }
    }

    addBond(i, j, L) {
      if (this.nadj[i] >= MAXN || this.nadj[j] >= MAXN) return false;
      if (this.nb >= this.bcap) this.growBonds(this.nb + 1);
      const b = this.nb++, a = MP[this.mat[i]], c = MP[this.mat[j]], h = this.h;
      const E = Math.min(a.E, c.E), k = SQ3 / 2 * E * h, mr = this.m[i] * this.m[j] / (this.m[i] + this.m[j]);
      this.bi[b] = i; this.bj[b] = j; this.L0[b] = L; this.Lo[b] = L; this.bk[b] = k;
      const pb = this.body[i] === 0 ? K.PSTR : 1;   // projectiles get the same 3D boost the armor gets from its grip
      this.bey[b] = Math.min(a.ey, c.ey) * K.STRENGTH * pb; this.bef[b] = Math.min(a.ef, c.ef) * K.STRETCH * Math.sqrt(pb);
      this.bec[b] = Math.min(a.ec, c.ec) * K.CRUSH * (this.body[i] === 0 ? K.PCRUSH : 1);   // squeezed projectiles flow rather than crumble
      this.bc[b] = K.DAMP * 2 * Math.sqrt(k * mr);
      this.bslot[i * MAXN + this.nadj[i]] = b; this.bslot[j * MAXN + this.nadj[j]] = b;
      this.adj[i * MAXN + this.nadj[i]++] = j; this.adj[j * MAXN + this.nadj[j]++] = i;
      return true;
    }
    unlink(i, j) {   // forget that i and j were bonded
      const adj = this.adj, bs = this.bslot;
      for (const [a, z] of [[i, j], [j, i]]) {
        const o = a * MAXN, n = this.nadj[a];
        for (let k = 0; k < n; k++) if (adj[o + k] === z) { adj[o + k] = adj[o + n - 1]; adj[o + n - 1] = -1; bs[o + k] = bs[o + n - 1]; bs[o + n - 1] = -1; this.nadj[a] = n - 1; break; }
      }
    }
    bonded(i, j) {
      const o = i * MAXN, n = this.nadj[i], adj = this.adj;
      for (let k = 0; k < n; k++) if (adj[o + k] === j) return true;
      return false;
    }

    addParticle(x, y, vx, vy, matKey, body, massScale = 1) {   // jets and fragments
      const i = this.addRaw(x, y, MAT_INDEX[matKey], body, vx, vy, 0, 0, false);
      this.m[i] *= massScale; this.im[i] = 1 / this.m[i]; this.T[i] = 900; this.shade[i] = 1; this.brk[i] = 255;   // jets and fragments never re-join
      this.setDerived(i);
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

    // the liner collapses into a thin, very fast metal jet (tip fastest, tail slowest)
    makeJet(cx, cy, P, vTip) {
      const h = this.h, L = P * K.JET_SCALE, count = Math.max(8, Math.round(L / (0.8 * h)));
      const vTail = Math.max(1.5, vTip * 0.28), startX = cx - 1.2 * h;
      for (let k = 0; k < count; k++) {
        const f = k / (count - 1);
        this.addParticle(startX - k * 0.8 * h, cy, vTip + (vTail - vTip) * f, 0, 'cu', 0, K.JET_MASS);
      }
    }
    trigger(cx, cy, shell = this.rounds[0]) {   // shell: which of the shells this is (its jet or fragments count as its own)
      this.triggered = true;
      const d = this.design, h = this.h, pl = this.plateAt(cx, cy) || this.firstPlate, n = pl.f.n, a0 = this.n;
      const kick = i => { if (this.sleepOn) this.wake(i); };
      if (this.kind === 'heat') {
        if (d.tandem) {   // a small charge in front sets off reactive armor first; the main jet follows a moment later
          this.makeJet(cx, cy, d.tandem.q * d.tandem.cal, d.vTip * 0.9);
          (this.jetQueue = this.jetQueue || []).push({ t: this.time + d.tandem.delay, x: cx, y: cy, P: d.q * d.cal, vTip: d.vTip, R: shell }); shell.jetWait = true;
        } else this.makeJet(cx, cy, d.q * d.cal, d.vTip);
        shell.parts.push([a0, this.n]);
        this.events.push({ type: 'flash', x: cx - d.probe * 0.5, y: cy, r: d.cal * 1.6, t: this.time });
      } else if (this.kind === 'hesh') {
        // the explosive spreads on the plate and slams it: a shock wave runs through and can knock a scab off the back
        const R = d.cal * 0.75, I = K.HESH_PUSH;
        const eff = pl.layers.reduce((s, l) => s + l.t * (l.mat === 'comp' || MATERIALS[l.mat].group === 'Ceramics' ? 2.2 : MP[MAT_INDEX[l.mat]].E > 0.1 ? 1 : 0.5), 0);
        this.scabs.push({ t: this.time + pl.T / 5.2, pl, cx, cy, ok: eff <= 1.25 * d.cal * K.HESH_CAP });
        for (let i = pl.i0; i < pl.i1; i++) {
          if (!this.alive[i] || this.fixed[i]) continue;
          const du = this.u[i]; if (du > 2.2 * h) continue;          // only the front skin gets the blast
          const dx = this.px[i] - cx, dy = this.py[i] - cy, r2 = dx * dx + dy * dy;
          if (r2 > 4 * R * R) continue;
          const g = Math.exp(-r2 / (R * R)) * I;
          kick(i); this.vx[i] += n[0] * g; this.vy[i] += n[1] * g; this.T[i] += 250 * g / I;
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
          kick(i); this.vx[i] += (dx / r) * g * 0.5 + n[0] * g * 0.5; this.vy[i] += (dy / r) * g * 0.5 + n[1] * g * 0.5; this.T[i] += 400 * g / K.HE_PUSH;
        }
        const nf = 48, cr = d.cal / 2;   // the steel case bursts into fragments spraying out from the shell's side
        for (let k = 0; k < nf; k++) {
          const a = (k / nf) * Math.PI * 2, sx = cx - n[0] * cr - Math.cos(a) * cr * 0.6, sy = cy - n[1] * cr - Math.sin(a) * cr * 0.6;
          const sp = 1.1 + 0.4 * frac(Math.sin(k * 91.3) * 437.5), dir = Math.atan2(sy - (cy - n[1] * cr * 1.6), sx - (cx - n[0] * cr * 1.6));
          this.addParticle(sx, sy, Math.cos(dir) * sp, Math.sin(dir) * sp, 'shot', 0, 1.5);
        }
        shell.parts.push([a0, this.n]);
        this.events.push({ type: 'flash', x: cx, y: cy, r: d.cal * 2.6, t: this.time });
      }
    }

    // HESH: the shock wave bounces off the inside face and tears a "scab" of metal off it
    knockScab(sc) {
      const { pl, cx, cy, ok } = sc;
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
        if (this.sleepOn) this.wake(i);
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
        let dv = 0;
        if (p.cy != null) { const v = Math.abs(dx * p.f.t[0] + dy * p.f.t[1]); dv = Math.max(0, v - p.len / 2); }   // short plates: how far past its end
        const dd = du + dv;
        if (dd < bd) { bd = dd; best = p; }
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
          if (this.sleepOn) this.wake(i);
          const side = this.u[i] < uMid ? -1 : 1;
          this.vx[i] += side * p.f.n[0] * K.ERA_FLY; this.vy[i] += side * p.f.n[1] * K.ERA_FLY; this.T[i] += 300;
        }
        for (let b = 0; b < this.nb; b++) { const i = this.bi[b]; if (i >= p.i0 && i < p.i1 && (this.u[i] < uMid) !== (this.u[this.bj[b]] < uMid)) { this.bi[b] = -1; if (this.sleepOn) this.unlink(i, this.bj[b]); } }
        this.events.push({ type: 'flash', x: cx / cn, y: cy / cn, r: Math.min(p.len, 1500) * 0.35, t: this.time, era: true });
      }
    }

    // ---------------- what happened? ----------------
    measure() {
      this.findAttached();
      if (this.rounds.length > 1) return this.measureVolley();
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
      const R = this.rounds[0];
      if (R) { R.everBehind = this.everBehind; R.residual = this.residual; R.res = res; }
      return res;
    }
    // The same for one shell of several (its own particles, and the plates on its own line)
    measureRound(R) {
      const lp = R.lastPlate, n = lp.f.n, o = lp.f.o, back = lp.T, fp = R.firstPlate;
      let behind = 0, sx = 0, sy = 0, deepest = -Infinity, cnt = 0, mx = 0, my = 0, mvx = 0, mvy = 0, mass = 0, spall = 0;
      for (const [a, b] of R.parts) for (let i = a; i < b; i++) {
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
        if (u > back + this.h && this.attached[i] === 0 && (this.vx[i] * n[0] + this.vy[i] * n[1]) > 0.02) spall++;
      }
      if (behind >= 2) { R.everBehind = true; R.residual = Math.max(0, (sx * n[0] + sy * n[1]) / behind); }
      if (!R.hitAt && this.kind === 'ke' && deepest > -1.5 * this.h) R.hitAt = [0, R.aimY, this.time];   // it has reached the armor
      return R.res = {
        time: this.time, steps: this.steps, particles: this.n, alive: cnt, behind, spall, residual: R.residual, everBehind: R.everBehind,
        depth: Math.max(0, deepest), vel: mass ? [mvx / mass, mvy / mass] : [0, 0], com: mass ? [mx / mass, my / mass] : [0, 0],
        massLeft: mass / R.mass0, maxT: this.maxT, broken: this.broken,
      };
    }
    measureVolley() {   // every shell, then the volley as a whole: the deepest, the fastest out, all the bits behind
      const all = this.rounds.map(R => this.measureRound(R)), deep = all.reduce((a, b) => (b.depth > a.depth ? b : a));
      this.everBehind = all.some(r => r.everBehind); this.residual = Math.max(...all.map(r => r.residual));
      return this.res = { ...deep, alive: all.reduce((t, r) => t + r.alive, 0), behind: all.reduce((t, r) => t + r.behind, 0), spall: Math.max(...all.map(r => r.spall)),
        residual: this.residual, everBehind: this.everBehind, massLeft: all.reduce((t, r, k) => t + r.massLeft * this.rounds[k].mass0, 0) / this.projMass0 };
    }

    // Has it played out? Returns the verdict or null while it's still going.
    verdict() {
      if (this.rounds.length > 1) return this.volleyVerdict();
      const r = this.measure(), fp = this.firstPlate, nIn = fp.f.n, t = this.time - this.shotT0;
      const vIn = r.vel[0] * nIn[0] + r.vel[1] * nIn[1], speed = Math.hypot(r.vel[0], r.vel[1]);
      const vSide = Math.abs(r.vel[0] * fp.f.t[0] + r.vel[1] * fp.f.t[1]);
      const tooLong = t > this.timeLimit();
      if (r.everBehind) {   // something of the shell got out the back: let it fly a little, then call it
        if (!this.penAt) this.penAt = this.rounds[0].penAt = this.time;
        return this.time - this.penAt > 60 || tooLong ? 'pen' : null;
      }
      if (this.kind === 'hesh' || this.kind === 'he') {
        const wait = this.kind === 'hesh' ? this.lastPlate.T / 5.2 + 120 : 160;
        if (t > wait) return r.spall > 2 ? (this.kind === 'hesh' ? 'spall' : 'pen') : 'stop';
        return null;
      }
      if (this.kind === 'ke' && this.hitAt && vIn < -0.05) return vSide > -vIn ? 'rico' : (r.spall > 2 ? 'spall' : 'stop');   // heading back out
      if (this.kind === 'ke' && this.hitAt && speed < 0.04) return r.spall > 2 ? 'spall' : 'stop';
      if (this.kind === 'heat' && this.triggered && !this.jetQueue && this.time - this.hitAt[2] > 40) {
        let fast = 0; for (let i = this.projRange[1]; i < this.n; i++) if (this.alive[i] && this.body[i] === 0 && this.vx[i] > 0.4) fast++;
        if (!fast) return r.everBehind ? 'pen' : r.spall > 2 ? 'spall' : 'stop';
      }
      if (tooLong) return r.everBehind ? 'pen' : r.spall > 2 ? 'spall' : 'stop';
      return null;
    }
    // The verdict now, even if it hasn't all played out (when something else cuts the shot short): a shell that isn't through yet counts as stopped
    settleVerdict() {
      const v = this.verdict();
      if (v || this.rounds.length < 2) return v;
      for (const R of this.rounds) if (!R.v) R.v = R.everBehind ? 'pen' : R.res && R.res.spall > 2 ? 'spall' : 'stop';
      return this.volleyVerdict();
    }
    // Several shells: each one plays out on its own (like a single shot, counted from when it arrives), and the volley is over
    // when they all have. The overall verdict is the best one (any got through → 'pen'); this.tally counts them.
    volleyVerdict() {
      this.measure();
      let left = 0;
      for (const R of this.rounds) { if (!R.v) R.v = this.roundVerdict(R, R.res); if (!R.v) left++; }
      if (left) { this.bringNext(); return null; }
      const t = this.tally = { n: this.rounds.length, pen: 0, stop: 0, rico: 0, spall: 0 };
      for (const R of this.rounds) t[R.v]++;
      return t.pen ? 'pen' : t.spall ? 'spall' : t.rico > t.stop ? 'rico' : 'stop';
    }
    // A row: once every shell that has arrived has played out, the next one comes in straight away instead of after a long empty wait.
    // The ones still on their way all move up together (keeping their spacing); solid ones never jump past anything in their way.
    bringNext() {
      const later = this.rounds.filter(R => !R.hitAt);
      if (!later.length || this.rounds.some(R => R.hitAt && !R.v)) return;
      const v0 = this.v0, h = this.h, t = this.time - this.shotT0;
      let skip = Math.min(...later.map(R => R.delay - t)) - 10;   // µs: the next one arrives 10 µs from now
      if (skip <= 0) return;
      if (this.kind === 'ke') {
        const own = new Uint8Array(this.n), r = this.shape.r + 2 * h;
        for (const R of later) for (const [a, b] of R.parts) own.fill(1, a, b);
        const lanes = later.map(R => { let nose = -Infinity; for (const [a, b] of R.parts) for (let i = a; i < b; i++) if (this.alive[i] && this.px[i] > nose) nose = this.px[i]; return { y: R.aimY, nose }; });
        for (let i = 0; i < this.n; i++) {   // stop short of whatever is ahead in each shell's lane (the armor, bits thrown back off it)
          if (!this.alive[i] || own[i]) continue;
          for (const L of lanes) if (this.px[i] > L.nose - h && Math.abs(this.py[i] - L.y) < r) skip = Math.min(skip, (this.px[i] - L.nose - 3 * h) / v0);
        }
        if (skip <= 0) return;
        for (const R of later) for (const [a, b] of R.parts) for (let i = a; i < b; i++) this.px[i] += v0 * skip;
      }
      for (const R of later) { R.delay -= skip; R.noseX += v0 * skip; }
      if (this.pending) for (const p of this.pending) p.t -= skip;
    }
    roundVerdict(R, r) {
      const fp = R.firstPlate, nIn = fp.f.n, t = this.time - this.shotT0 - R.delay;
      const vIn = r.vel[0] * nIn[0] + r.vel[1] * nIn[1], speed = Math.hypot(r.vel[0], r.vel[1]);
      const vSide = Math.abs(r.vel[0] * fp.f.t[0] + r.vel[1] * fp.f.t[1]);
      const tooLong = t > this.timeLimit(R);
      if (r.everBehind) { if (!R.penAt) R.penAt = this.time; return this.time - R.penAt > 60 || tooLong ? 'pen' : null; }
      if (this.kind === 'hesh' || this.kind === 'he') {
        if (!R.hitAt) return null;
        const wait = this.kind === 'hesh' ? R.lastPlate.T / 5.2 + 120 : 160;
        return this.time - R.hitAt[2] > wait ? (r.spall > 2 ? (this.kind === 'hesh' ? 'spall' : 'pen') : 'stop') : null;
      }
      if (this.kind === 'ke' && R.hitAt && vIn < -0.05) return vSide > -vIn ? 'rico' : (r.spall > 2 ? 'spall' : 'stop');
      if (this.kind === 'ke' && R.hitAt && speed < 0.04) return r.spall > 2 ? 'spall' : 'stop';
      if (this.kind === 'heat' && R.hitAt && !R.jetWait && this.time - R.hitAt[2] > 40) {
        let fast = 0;
        for (const [a, b] of R.parts) for (let i = a; i < b; i++) if (this.alive[i] && this.body[i] === 0 && this.vx[i] > 0.4) fast++;
        if (!fast) return r.everBehind ? 'pen' : r.spall > 2 ? 'spall' : 'stop';
      }
      if (tooLong) return r.everBehind ? 'pen' : r.spall > 2 ? 'spall' : 'stop';
      return null;
    }
    timeLimit(R) {
      const tp = R ? R.targets : this.targets, fp = R ? R.firstPlate : this.firstPlate, lp = R ? R.lastPlate : this.lastPlate;
      const T = tp.reduce((s, p) => s + p.T / Math.max(0.2, Math.cos(p.ang * DEG)), 0);
      const L = this.shape.x1 - this.shape.x0, gap = lp.f.o[0] - fp.f.o[0];
      return 200 + 2.5 * (T + L + gap) / Math.max(0.3, this.v0);
    }
  }
  function frac(x) { return x - Math.floor(x); }

  // Tuning knobs, set by calibrating against the classic penetration formulas (see the Learn page)
  const K = { STRENGTH: 1, STRETCH: 1, COMP: 1, CRUSH: 1, DUCT: 1, GRIP: 0.8, PSTR: 1, PCRUSH: 1, PIN: 0, DAMP: 0.02, CDAMP: 0.05, JET_SCALE: 1, JET_MASS: 1.25, HESH_PUSH: 0.3, HESH_CAP: 1, HE_PUSH: 0.35, ERA_FLY: 0.8, SLOPE: 3, SLOPE0: 1.15 };
  function tune(o) { Object.assign(K, o); }

  return { MATERIALS, MAT_KEYS, MAT_INDEX, PROJECTILES, ARMORS, Sim, makeShape, plateThickness, autoLen, pickH, sceneArea, projCal, tune, inPoly, volleyRounds };
});
