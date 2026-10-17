// Vehicles for the Sandbox: side cut-aways made of armor plates, with crew, ammo, fuel and engines inside.
// engine.js simulates the plates the shell actually hits (as particles); this file picks those plates,
// and afterwards follows the shell and the bits of armor it knocked loose through the inside of the vehicle.
//
// Coordinates are in mm, seen from the side: x = 0 is the front of the hull (the vehicle faces left), y = 0 is the ground.
(function (root, factory) {
  const E = root.ImpactEngine || (typeof require === 'function' ? require('./engine.js') : null);
  const api = factory(E);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Vehicles = api;
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const DEG = Math.PI / 180;
  const clone = o => JSON.parse(JSON.stringify(o));
  const L = (...a) => { const o = []; for (let i = 0; i < a.length; i += 2) o.push({ mat: a[i], t: a[i + 1] }); return o; };

  // ✏️ What can be inside. hp = energy it can soak up before it's [hurt, knocked out] (energy per mm of the slice, in kJ/mm).
  // A bit flying through a box gives up a share of its energy that grows with how far it goes through (gap = the distance
  // that takes ~63% of it; boxes are bigger than what's inside them, so soft things let a lot through and an engine block
  // stops almost anything), and always at least soak, so tiny bits stop.
  const MODULES = {
    crew:   { icon: '🧑', name: 'Crew', color: '#62c886', hp: [0.008, 0.04], gap: 700, soak: 0.004, words: ['OK', 'Hurt', 'Knocked out'] },
    ammo:   { icon: '💣', name: 'Ammo', color: '#e25b4f', hp: [0.006, 0.03], gap: 400, soak: 0.006, words: ['OK', 'Hit', 'Exploded'] },
    fuel:   { icon: '⛽', name: 'Fuel tank', color: '#e9a640', hp: [0.01, 0.05], gap: 350, soak: 0.006, words: ['OK', 'Leaking', 'On fire'] },
    engine: { icon: '⚙️', name: 'Engine', color: '#97a3b0', hp: [0.04, 0.3], gap: 130, soak: 0.02, words: ['OK', 'Damaged', 'Wrecked'] },
    trans:  { icon: '🔩', name: 'Transmission', color: '#8796a4', hp: [0.04, 0.3], gap: 130, soak: 0.02, words: ['OK', 'Damaged', 'Wrecked'] },
    gun:    { icon: '🎯', name: 'Gun breech', color: '#c2b07c', hp: [0.04, 0.25], gap: 200, soak: 0.01, words: ['OK', 'Damaged', 'Wrecked'] },
  };
  const MOD_KEYS = Object.keys(MODULES);

  // ---------- helpers for describing vehicles ----------
  // A chain of plates through the points (clockwise round the outline, so the inside is on the right).
  function chain(g, pts, segs, closed) {
    const out = [], n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) out.push({ n: segs[i][0], a: pts[i].slice(), b: pts[(i + 1) % pts.length].slice(), layers: segs[i][1], g });
    return out;
  }
  const M = (type, n, x0, y0, x1, y1, extra) => ({ type, n, x: x0, y: y0, w: x1 - x0, h: y1 - y0, ...(extra || {}) });
  const wheelsRow = (x0, x1, n, r, y = r) => Array.from({ length: n }, (_, k) => [Math.round(x0 + (x1 - x0) * (n === 1 ? 0.5 : k / (n - 1))), y, r]);
  // Running gear (drawn only): the wheels at each end ([x, y, r]: one is the drive sprocket), road wheels (x positions, radius r) standing on
  // the track (t thick) on the ground, and small return rollers holding up the top of the track.
  const gear = ({ ends, road, r, t = 60, rollers = [], ry = 0, rr = 90, drive = 'front', inter = false }) =>
    ({ wheels: [ends[0], ...road.map(x => [x, r + t, r]), ends[1]], rollers: rollers.map(x => [x, ry, rr]), trackT: t, drive, interleave: inter });
  const pairs = (xs, gap) => xs.flatMap(x => [x - gap / 2, x + gap / 2]);   // road wheels in twos (bogies)
  // Outside details (drawn only): a commander's cupola on the turret roof, and plain boxes (t: moves with the turret)
  const cupola = (x0, x1, y, h) => ({ t: 1, p: [[x0, y - 20], [x0, y + h * 0.75], [x0 + (x1 - x0) * 0.15, y + h], [x1 - (x1 - x0) * 0.15, y + h], [x1, y + h * 0.75], [x1, y - 20]] });
  const box = (x0, y0, x1, y1, t = 0) => ({ t, p: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
  const bowMG = (x, y, len = 240) => box(x - len, y - 25, x + 10, y + 25);   // a machine gun poking out of the front plate at (x, y)
  const roofMG = (x, y, len = 600) => [box(x - 20, y, x + 20, y + 230, 1), box(x - len, y + 195, x + 140, y + 240, 1)];   // on a post on the turret roof


  // ✏️ Vehicle cut-aways. Real ones use rough public armor numbers and simplified insides; the made-up ones are made up.
  const VEHICLES = [
    {
      id: 'tiger', name: 'Tiger I', group: 'WW2 (approx.)', year: 1942, from: 'Germany', aim: [565, 1500],
      about: 'Thick, flat armor and the famous 88 mm gun. Slow and heavy, but hard to hurt from the front.',
      parts: [
        ...chain('h', [[3700, 1830], [5950, 1830], [6080, 1000], [5700, 450], [650, 450], [220, 760], [60, 1100], [520, 1180], [630, 1830], [1650, 1830]], [
          ['Engine deck', L('rha', 25)], ['Rear plate', L('rha', 80)], ['Lower rear plate', L('rha', 60)], ['Belly', L('rha', 25)],
          ['Lower front plate', L('rha', 60)], ['Nose plate', L('rha', 100)], ['Glacis', L('rha', 60)], ["Driver's plate", L('rha', 100)], ['Hull roof', L('rha', 25)]]),
        ...chain('t', [[1450, 1860], [1450, 2900], [3750, 2900], [3860, 1860]], [['Turret front', L('rha', 100)], ['Turret roof', L('rha', 25)], ['Turret rear', L('rha', 80)]]),
        ...chain('t', [[1250, 2020], [1250, 2780]], [['Gun mantlet', L('rha', 120)]]),
      ],
      modules: [
        M('trans', 'Transmission', 300, 520, 850, 1000), M('crew', 'Driver', 760, 560, 1200, 1650), M('crew', 'Radio operator', 1240, 560, 1680, 1650),
        M('ammo', 'Ammo (side racks)', 1780, 1360, 3600, 1790), M('ammo', 'Ammo (floor)', 1950, 500, 3450, 820),
        M('crew', 'Gunner', 1720, 1640, 2160, 2560), M('crew', 'Loader', 2240, 880, 2720, 2200), M('crew', 'Commander', 2820, 1950, 3300, 2850),
        M('gun', 'Gun breech', 1450, 2290, 2650, 2490), M('fuel', 'Fuel tanks', 4100, 560, 4650, 1660), M('engine', 'Engine', 4720, 560, 5850, 1680),
      ],
      deco: { ...gear({ ends: [[330, 860, 330], [5900, 760, 300]], road: [1000, 1600, 2200, 2800, 3400, 4000, 4600, 5200], r: 400, inter: true }), barrel: { x0: 1250, x1: -2070, y: 2400, d: 130, taper: 0.75, brake: 'double' }, shapes: [bowMG(583, 1550), cupola(2900, 3400, 2900, 180), box(5990, 1350, 6090, 2150)] },
    },
    {
      id: 'tiger2', name: 'Tiger II', group: 'WW2 (approx.)', year: 1944, from: 'Germany', aim: [505, 1575],
      about: 'The heaviest German tank of the war: a 150 mm front plate sloped at 50° and a very long 88 mm gun. Almost nothing got through its front.',
      parts: [
        ...chain('h', [[4300, 2000], [7000, 2000], [7380, 1250], [7000, 490], [790, 490], [0, 1150], [1010, 2000], [2250, 2000]], [
          ['Engine deck', L('rha', 40)], ['Upper rear plate', L('rha', 80)], ['Lower rear plate', L('rha', 80)], ['Belly', L('rha', 40)],
          ['Lower front plate', L('rha', 100)], ['Upper front plate', L('rha', 150)], ['Hull roof', L('rha', 40)]]),
        ...chain('t', [[1700, 2030], [1800, 2700], [2300, 3000], [4500, 3000], [4850, 2150], [4300, 2050]], [
          ['Turret front', L('rha', 180)], ['Turret roof (front)', L('rha', 44)], ['Turret roof', L('rha', 40)], ['Turret rear', L('rha', 80)], ['Bustle floor', L('rha', 40)]]),
        ...chain('t', [[1550, 2200], [1550, 2650]], [['Gun mantlet', L('cast', 100)]]),
      ],
      modules: [
        M('trans', 'Transmission', 350, 570, 950, 1150), M('crew', 'Driver', 1000, 570, 1450, 1750), M('crew', 'Radio operator', 1500, 570, 1950, 1850),
        M('ammo', 'Ammo (side racks)', 2050, 1450, 4200, 1950), M('ammo', 'Ammo (turret bustle)', 3950, 2150, 4650, 2850),
        M('crew', 'Gunner', 2050, 1750, 2450, 2750), M('crew', 'Loader', 2550, 600, 3050, 2500), M('crew', 'Commander', 3150, 2050, 3650, 2900),
        M('gun', 'Gun breech', 1900, 2340, 3150, 2540), M('fuel', 'Fuel tanks', 4350, 570, 4850, 1900), M('engine', 'Engine', 4900, 570, 6900, 1900),
      ],
      deco: { ...gear({ ends: [[250, 780, 330], [7050, 720, 300]], road: [1000, 1662, 2325, 2988, 3650, 4312, 4975, 5638, 6300], r: 400, inter: true }), barrel: { x0: 1550, x1: -2900, y: 2430, d: 120, taper: 0.75, brake: 'double' }, shapes: [bowMG(535, 1600), cupola(3150, 3600, 3000, 160), box(7150, 1600, 7250, 2300)] },
    },
    {
      id: 'panther', name: 'Panther Ausf. G', group: 'WW2 (approx.)', year: 1944, from: 'Germany', aim: [560, 1405],
      about: 'Sloped armor like the T-34, a long 75 mm gun, and a thin roof. Its rounded mantlet could bounce shells down into the hull.',
      parts: [
        ...chain('h', [[4150, 1800], [6300, 1800], [6870, 820], [6400, 560], [650, 560], [0, 1010], [1120, 1800], [2350, 1800]], [
          ['Engine deck', L('rha', 16)], ['Rear plate', L('rha', 40)], ['Lower rear plate', L('rha', 40)], ['Belly', L('rha', 16)],
          ['Lower front plate', L('rha', 60)], ['Upper front plate', L('rha', 80)], ['Hull roof', L('rha', 40)]]),
        ...chain('t', [[1950, 1830], [2130, 2700], [2700, 2950], [4150, 2950], [4650, 1830]], [
          ['Turret front', L('rha', 110)], ['Turret roof (front)', L('rha', 16)], ['Turret roof', L('rha', 16)], ['Turret rear', L('rha', 45)]]),
        ...chain('t', [[1830, 1960], [1700, 2200], [1700, 2480], [1830, 2730]], [['Mantlet (lower curve)', L('cast', 100)], ['Mantlet', L('cast', 100)], ['Mantlet (upper curve)', L('cast', 100)]]),
      ],
      modules: [
        M('trans', 'Transmission', 200, 640, 820, 1100), M('crew', 'Driver', 1100, 640, 1530, 1600), M('crew', 'Radio operator', 1570, 640, 2000, 1600),
        M('ammo', 'Ammo (side racks)', 2100, 1340, 3900, 1770), M('crew', 'Gunner', 2200, 1700, 2600, 2620), M('crew', 'Loader', 2700, 700, 3200, 2350),
        M('crew', 'Commander', 3350, 1950, 3800, 2900), M('gun', 'Gun breech', 1950, 2270, 3150, 2460),
        M('fuel', 'Fuel tanks', 4300, 640, 4900, 1700), M('engine', 'Engine', 4950, 640, 6200, 1720),
      ],
      deco: { ...gear({ ends: [[250, 880, 330], [6550, 820, 300]], road: [850, 1571, 2293, 3014, 3736, 4457, 5179, 5900], r: 430, inter: true }), barrel: { x0: 1700, x1: -1790, y: 2340, d: 100, taper: 0.75, brake: 'double' }, shapes: [bowMG(624, 1450), cupola(3350, 3800, 2950, 140), box(6560, 1400, 6660, 2100)] },
    },
    {
      id: 'jagdpanther', name: 'Jagdpanther', group: 'WW2 (approx.)', year: 1944, from: 'Germany', aim: [700, 1500],
      about: 'A tank hunter: a Panther hull with a fixed box on top and the long 88 mm gun. No turret, so the whole vehicle turns to aim. Its front is one big 80 mm plate sloped at 55°.',
      parts: [
        ...chain('h', [[2385, 2680], [4200, 2680], [4500, 1800], [6300, 1800], [6870, 820], [6400, 560], [650, 560], [0, 1010]], [
          ['Roof', L('rha', 25)], ['Back of the box', L('rha', 40)], ['Engine deck', L('rha', 16)], ['Rear plate', L('rha', 40)], ['Lower rear plate', L('rha', 40)],
          ['Belly', L('rha', 16)], ['Lower front plate', L('rha', 60)], ['Upper front plate', L('rha', 80)]], true),
        ...chain('h', [[1271, 1900], [1209, 2162], [1689, 2498], [1914, 2350]], [['Gun mantlet (lower)', L('cast', 100)], ['Gun mantlet', L('cast', 100)], ['Gun mantlet (upper)', L('cast', 100)]]),
      ],
      modules: [
        M('trans', 'Transmission', 250, 640, 820, 1100), M('crew', 'Driver', 1050, 640, 1500, 1640), M('crew', 'Radio operator', 1550, 640, 2000, 1800),
        M('crew', 'Gunner', 2350, 1600, 2800, 2550), M('gun', 'Gun breech', 2100, 2150, 3300, 2350), M('crew', 'Loader', 2900, 640, 3350, 2550),
        M('crew', 'Commander', 3450, 1550, 3950, 2600), M('ammo', 'Ammo (side racks)', 3450, 640, 4250, 1500),
        M('fuel', 'Fuel tanks', 4550, 640, 5000, 1700), M('engine', 'Engine', 5050, 640, 6250, 1720),
      ],
      deco: { ...gear({ ends: [[250, 880, 330], [6550, 820, 300]], road: [850, 1571, 2293, 3014, 3736, 4457, 5179, 5900], r: 430, inter: true }), barrel: { x0: 1500, x1: -3000, y: 2250, d: 120, taper: 0.75, brake: 'double' }, shapes: [bowMG(628, 1450), box(6560, 1400, 6660, 2100)] },
    },
    {
      id: 'elefant', name: 'Elefant', group: 'WW2 (approx.)', year: 1944, from: 'Germany', aim: [90, 1400],
      about: 'A Porsche tank hunter with 200 mm of armor on the front and the long 88 mm gun. Its gun box sits at the back, so the engines are in the middle.',
      parts: [
        ...chain('h', [[3590, 2970], [6500, 2970], [6800, 1100], [6300, 480], [550, 480], [0, 980], [180, 1820], [3050, 1820]], [
          ['Roof of the box', L('rha', 30)], ['Back of the box', L('rha', 80)], ['Lower rear plate', L('rha', 50)], ['Belly', L('rha', 30)],
          ['Lower front plate', L('rha', 100)], ['Front plate', L('rha', 100, 'rha', 100)], ['Hull roof', L('rha', 30)], ['Front of the box', L('rha', 200)]], true),
        ...chain('h', [[3150, 2300], [3150, 2600]], [['Gun mantlet', L('cast', 120)]]),
      ],
      modules: [
        M('crew', 'Driver', 650, 560, 1100, 1700), M('crew', 'Radio operator', 1150, 560, 1600, 1700),
        M('fuel', 'Fuel tanks', 1650, 560, 2000, 1750), M('engine', 'Engines and generators', 2050, 560, 3000, 1750),
        M('crew', 'Gunner', 3850, 1950, 4250, 2900), M('gun', 'Gun breech', 3650, 2350, 5000, 2550),
        M('crew', 'Loader', 4350, 560, 4800, 2850), M('crew', 'Second loader', 4900, 560, 5350, 2850), M('crew', 'Commander', 5450, 1900, 5900, 2900),
        M('ammo', 'Ammo (racks)', 5450, 560, 6200, 1450),
      ],
      deco: { ...gear({ ends: [[250, 680, 300], [6550, 680, 300]], road: [1090, 1910, 2790, 3610, 4490, 5310], r: 380, drive: 'rear' }), barrel: { x0: 3150, x1: -1340, y: 2450, d: 120, taper: 0.75, brake: 'double' }, shapes: [cupola(5450, 5850, 2970, 150)] },
    },
    {
      id: 'maus', name: 'Maus', group: 'WW2 (approx.)', year: 1944, from: 'Germany', aim: [650, 1455],
      about: 'A 188-tonne giant, the heaviest tank ever built (only two were made). 200 mm of sloped steel on the front and a 240 mm turret face.',
      parts: [
        ...chain('h', [[6100, 1910], [8700, 1910], [9030, 1100], [8600, 500], [700, 500], [0, 1000], [1300, 1910], [2700, 1910]], [
          ['Engine deck', L('rha', 50)], ['Rear plate', L('rha', 160)], ['Lower rear plate', L('rha', 160)], ['Belly', L('rha', 100)],
          ['Lower front plate', L('rha', 200)], ['Upper front plate', L('rha', 200)], ['Hull roof', L('rha', 50)]]),
        ...chain('t', [[2600, 1940], [2400, 2600], [2650, 3350], [3050, 3630], [6100, 3630], [6450, 1940]], [
          ['Turret front (lower)', L('cast', 240)], ['Turret front', L('cast', 240)], ['Turret roof (front)', L('cast', 60)], ['Turret roof', L('cast', 60)], ['Turret rear', L('cast', 200)]]),
        ...chain('t', [[2250, 2500], [2250, 2900]], [['Gun mantlet', L('cast', 100)]]),
      ],
      modules: [
        M('fuel', 'Fuel tanks (front)', 950, 600, 1400, 1300), M('crew', 'Driver', 1450, 600, 1900, 1750), M('crew', 'Radio operator', 1950, 600, 2400, 1800),
        M('engine', 'Engine and generator', 2500, 600, 5200, 1750), M('ammo', 'Ammo (hull racks)', 5300, 600, 7100, 1500), M('trans', 'Electric motors', 7300, 600, 8400, 1500),
        M('crew', 'Gunner', 2950, 2050, 3400, 3300), M('crew', 'Loader', 3500, 1950, 3950, 3450), M('crew', 'Second loader', 4050, 1950, 4500, 3450),
        M('crew', 'Commander', 4600, 2300, 5100, 3550), M('gun', 'Gun breech', 2800, 2600, 4600, 2850), M('ammo', 'Ammo (turret)', 5200, 2000, 5900, 3200),
      ],
      deco: { ...gear({ ends: [[300, 820, 350], [8750, 820, 350]], road: [800, 1473, 2145, 2818, 3491, 4164, 4836, 5509, 6182, 6855, 7527, 8200], r: 270, drive: 'rear' }), barrel: { x0: 2250, x1: -1060, y: 2700, d: 160, taper: 0.8, brake: false } },
    },
    {
      id: 'pz4', name: 'Panzer IV Ausf. H', group: 'WW2 (approx.)', year: 1943, from: 'Germany', aim: [600, 1380],
      about: 'The workhorse German tank. Thick 80 mm plates on the front of the hull, but a thin 50 mm turret front.',
      parts: [
        ...chain('h', [[3500, 1700], [5600, 1700], [5800, 620], [5500, 400], [300, 400], [150, 950], [450, 1050], [550, 1700], [1900, 1700]], [
          ['Engine deck', L('rha', 16)], ['Rear plate', L('rha', 20)], ['Lower rear plate', L('rha', 20)], ['Belly', L('rha', 10)],
          ['Lower front plate', L('rha', 80)], ['Glacis', L('rha', 25)], ["Driver's plate", L('rha', 80)], ['Hull roof', L('rha', 16)]]),
        ...chain('t', [[1650, 1730], [1760, 2340], [2200, 2560], [3500, 2600], [3800, 1730]], [
          ['Turret front', L('rha', 50)], ['Turret roof (front)', L('rha', 15)], ['Turret roof', L('rha', 10)], ['Turret rear', L('rha', 30)]]),
        ...chain('t', [[1550, 1950], [1580, 2300]], [['Gun mantlet', L('rha', 50)]]),
      ],
      modules: [
        M('trans', 'Transmission', 420, 470, 940, 950), M('crew', 'Driver', 760, 470, 1190, 1600), M('crew', 'Radio operator', 1230, 470, 1650, 1600),
        M('crew', 'Gunner', 1850, 1450, 2220, 2400), M('crew', 'Loader', 2280, 500, 2720, 2200), M('crew', 'Commander', 2800, 1700, 3250, 2550),
        M('gun', 'Gun breech', 1700, 2040, 2700, 2200), M('ammo', 'Ammo (floor racks)', 1800, 470, 3400, 860),
        M('fuel', 'Fuel tanks', 3460, 470, 3960, 1150), M('engine', 'Engine', 4020, 470, 5400, 1580),
      ],
      deco: { ...gear({ ends: [[200, 640, 270], [5550, 600, 250]], road: [790, 1290, 1890, 2390, 2990, 3490, 4090, 4590], r: 235, rollers: [1040, 2140, 3240, 4340], ry: 760, rr: 100 }), barrel: { x0: 1550, x1: -1130, y: 2120, d: 85, taper: 0.8, brake: 'double' }, shapes: [bowMG(504, 1400), cupola(2800, 3250, 2600, 130), { t: 1, p: [[3700, 2000], [4060, 2000], [4060, 2380], [3570, 2380]] }] },
    },
    {
      id: 'stug3', name: 'StuG III Ausf. G', group: 'WW2 (approx.)', year: 1943, from: 'Germany', aim: [860, 1700],
      about: 'A low assault gun on the Panzer III hull: no turret, an 80 mm front and a long 75 mm gun. Germany built more of these than any other armored vehicle.',
      parts: [
        ...chain('h', [[950, 2160], [3100, 2160], [3300, 1500], [5100, 1500], [5400, 900], [5000, 390], [600, 390], [0, 860], [180, 1330], [800, 1400]], [
          ['Roof', L('rha', 10)], ['Back of the box', L('rha', 30)], ['Engine deck', L('rha', 16)], ['Rear plate', L('rha', 50)], ['Lower rear plate', L('rha', 50)],
          ['Belly', L('rha', 16)], ['Lower front plate', L('rha', 50)], ['Nose plate', L('rha', 50, 'rha', 30)], ['Glacis', L('rha', 25)], ['Front of the box', L('rha', 50, 'rha', 30)]], true),
        ...chain('h', [[700, 1650], [700, 1950]], [['Gun mantlet', L('cast', 50)]]),
      ],
      modules: [
        M('trans', 'Transmission', 620, 450, 1000, 1150), M('crew', 'Driver', 1050, 450, 1450, 1700), M('crew', 'Gunner', 1250, 1400, 1650, 2100),
        M('gun', 'Gun breech', 1000, 1700, 2300, 1900), M('crew', 'Loader', 1750, 450, 2200, 2100), M('crew', 'Commander', 2300, 1450, 2750, 2140),
        M('ammo', 'Ammo (racks)', 2300, 450, 3150, 1350), M('fuel', 'Fuel tanks', 3350, 450, 3800, 1400), M('engine', 'Engine', 3850, 450, 5050, 1420),
      ],
      deco: { ...gear({ ends: [[250, 640, 280], [5150, 640, 260]], road: [800, 1560, 2320, 3080, 3840, 4600], r: 260, rollers: [1180, 2700, 4220], ry: 690, rr: 90 }), barrel: { x0: 700, x1: -1390, y: 1800, d: 85, taper: 0.8, brake: 'double' }, shapes: [cupola(2300, 2700, 2160, 140)] },
    },
    {
      id: 'kv1', name: 'KV-1 (1941)', group: 'WW2 (approx.)', year: 1941, from: 'Soviet Union', aim: [195, 1375],
      about: 'In 1941 hardly any German gun could get through its 75 mm armor. Slow and unreliable, but very hard to knock out.',
      parts: [
        ...chain('h', [[3800, 1950], [6200, 1950], [6750, 1300], [6300, 440], [460, 440], [60, 1050], [330, 1700], [900, 1950], [1800, 1950]], [
          ['Engine deck', L('rha', 30)], ['Upper rear plate', L('rha', 60)], ['Lower rear plate', L('rha', 60)], ['Belly', L('rha', 40)],
          ['Lower front plate', L('rha', 75)], ["Driver's plate", L('rha', 75)], ['Glacis', L('rha', 75)], ['Hull roof', L('rha', 30)]]),
        ...chain('t', [[1700, 1980], [1650, 2650], [3700, 2710], [3950, 1980]], [['Turret front', L('rha', 75)], ['Turret roof', L('rha', 40)], ['Turret rear', L('rha', 75)]]),
        ...chain('t', [[1500, 2050], [1500, 2500]], [['Gun mantlet', L('cast', 90)]]),
      ],
      modules: [
        M('crew', 'Driver', 700, 520, 1150, 1650), M('crew', 'Radio operator', 1200, 520, 1650, 1700),
        M('crew', 'Gunner', 1800, 1550, 2200, 2550), M('crew', 'Loader', 2300, 600, 2750, 2400), M('crew', 'Commander', 2850, 1550, 3300, 2600),
        M('gun', 'Gun breech', 1750, 2180, 2850, 2380), M('ammo', 'Ammo (floor boxes)', 1850, 500, 3700, 800), M('ammo', 'Ammo (turret rack)', 3350, 2000, 3750, 2450),
        M('fuel', 'Fuel tanks', 3900, 520, 4300, 1850), M('engine', 'Engine', 4350, 520, 5700, 1800), M('trans', 'Transmission', 5750, 500, 6300, 1250),
      ],
      deco: { ...gear({ ends: [[250, 700, 300], [6450, 700, 320]], road: [900, 1860, 2820, 3780, 4740, 5700], r: 300, rollers: [1380, 3300, 5220], ry: 890, rr: 100, drive: 'rear' }), barrel: { x0: 1500, x1: -800, y: 2280, d: 95, taper: 0.85, brake: false }, shapes: [bowMG(205, 1400)] },
    },
    {
      id: 't34', name: 'T-34-85', group: 'WW2 (approx.)', year: 1944, from: 'Soviet Union', aim: [700, 1240],
      about: 'Thin but steeply sloped armor, so shells often glanced off. Ammo sat in boxes on the floor.',
      parts: [
        ...chain('h', [[3600, 1630], [5300, 1630], [6000, 1000], [5600, 400], [600, 400], [0, 850], [1350, 1630], [1900, 1630]], [
          ['Engine deck', L('rha', 20)], ['Upper rear plate', L('rha', 45)], ['Lower rear plate', L('rha', 45)], ['Belly', L('rha', 20)],
          ['Lower front plate', L('rha', 45)], ['Upper front plate', L('rha', 45)], ['Hull roof', L('rha', 20)]]),
        ...chain('t', [[1700, 1660], [1660, 2150], [1850, 2600], [3700, 2620], [3950, 1660]], [
          ['Turret front', L('cast', 90)], ['Turret front (upper)', L('cast', 75)], ['Turret roof', L('rha', 20)], ['Turret rear', L('cast', 52)]]),
        ...chain('t', [[1450, 1950], [1450, 2350]], [['Gun mantlet', L('cast', 40)]]),
      ],
      modules: [
        M('crew', 'Driver', 1150, 470, 1560, 1390), M('crew', 'Bow gunner', 1600, 470, 2000, 1390),
        M('crew', 'Gunner', 1900, 1450, 2300, 2350), M('crew', 'Loader', 2350, 560, 2800, 2250), M('crew', 'Commander', 2900, 1650, 3400, 2560),
        M('gun', 'Gun breech', 1700, 2050, 2900, 2250), M('ammo', 'Ammo (floor boxes)', 1900, 460, 3600, 780),
        M('fuel', 'Fuel tanks', 3700, 470, 4200, 1550), M('engine', 'Engine', 4250, 470, 5250, 1560), M('trans', 'Transmission', 5300, 450, 5750, 1050),
      ],
      deco: { ...gear({ ends: [[150, 600, 300], [5800, 620, 300]], road: [800, 1875, 2950, 4025, 5100], r: 415, drive: 'rear' }), barrel: { x0: 1450, x1: -2050, y: 2150, d: 100, taper: 0.8, brake: false }, shapes: [bowMG(779, 1300), cupola(2950, 3400, 2615, 150)] },
    },
    {
      id: 'sherman', name: 'M4A3E8 Sherman', group: 'WW2 (approx.)', year: 1944, from: 'USA', aim: [500, 1600],
      about: 'Tall and reliable. This late version kept its ammo in water-jacketed "wet" racks, so it caught fire less often.',
      parts: [
        ...chain('h', [[3700, 2000], [5400, 2000], [5700, 900], [5300, 430], [750, 430], [250, 750], [50, 1150], [960, 2000], [2000, 2000]], [
          ['Engine deck', L('rha', 13)], ['Rear plate', L('rha', 38)], ['Lower rear plate', L('rha', 38)], ['Belly', L('rha', 13)],
          ['Transmission cover (lower)', L('cast', 51)], ['Transmission cover (upper)', L('cast', 108)], ['Upper front plate', L('rha', 63)], ['Hull roof', L('rha', 19)]]),
        ...chain('t', [[1900, 2030], [1850, 2600], [2150, 2950], [3700, 2950], [3950, 2030]], [
          ['Turret front', L('cast', 64)], ['Turret front (upper)', L('cast', 64)], ['Turret roof', L('rha', 25)], ['Turret rear', L('cast', 64)]]),
        ...chain('t', [[1650, 2250], [1650, 2700]], [['Gun mantlet', L('cast', 89)]]),
      ],
      modules: [
        M('trans', 'Transmission', 300, 500, 1000, 1100), M('crew', 'Driver', 1100, 600, 1540, 1820), M('crew', 'Assistant driver', 1580, 600, 2020, 1820),
        M('crew', 'Gunner', 2150, 1500, 2550, 2500), M('crew', 'Loader', 2600, 700, 3100, 2400), M('crew', 'Commander', 3150, 1800, 3650, 2850),
        M('gun', 'Gun breech', 1900, 2370, 3100, 2570), M('ammo', 'Ammo (wet racks)', 2100, 500, 3700, 1000, { tough: 2.5 }),
        M('fuel', 'Fuel tanks', 4000, 500, 4450, 1900), M('engine', 'Engine', 4500, 500, 5450, 1850),
      ],
      deco: { ...gear({ ends: [[150, 620, 300], [5600, 600, 280]], road: [1050, 1610, 2550, 3110, 4050, 4610], r: 260, rollers: [1330, 2830, 4330], ry: 820, rr: 90 }), barrel: { x0: 1650, x1: -1600, y: 2470, d: 95, taper: 0.8, brake: 'single' }, shapes: [bowMG(585, 1650), ...roofMG(3550, 2950, 700), cupola(3150, 3550, 2950, 130)] },
    },
    {
      id: 'hellcat', name: 'M18 Hellcat', group: 'WW2 (approx.)', year: 1944, from: 'USA', aim: [475, 1275],
      about: 'The fastest tank of the war (80 km/h) with a strong 76 mm gun, but only 13 mm of armor and an open-top turret.',
      parts: [
        ...chain('h', [[3800, 1650], [5000, 1650], [5440, 900], [5000, 360], [650, 360], [0, 900], [950, 1650], [1700, 1650]], [
          ['Engine deck', L('rha', 8)], ['Rear plate', L('rha', 13)], ['Lower rear plate', L('rha', 13)], ['Belly', L('rha', 6)],
          ['Lower front plate', L('rha', 13)], ['Upper front plate', L('rha', 13)], ['Hull roof', L('rha', 8)]]),
        ...chain('t', [[1800, 1680], [1520, 2340]], [['Turret front', L('rha', 19)]]),
        ...chain('t', [[3750, 2340], [3950, 1680]], [['Turret rear', L('rha', 13)]]),
        ...chain('t', [[1400, 1950], [1400, 2250]], [['Gun mantlet', L('rha', 19)]]),
      ],
      modules: [
        M('trans', 'Transmission', 600, 430, 1050, 950), M('crew', 'Driver', 1100, 430, 1550, 1550), M('crew', 'Assistant driver', 1600, 430, 2050, 1550),
        M('crew', 'Gunner', 2000, 1450, 2400, 2350), M('crew', 'Commander', 2500, 1600, 2950, 2450), M('crew', 'Loader', 3050, 430, 3500, 2350),
        M('gun', 'Gun breech', 1700, 2000, 2850, 2200), M('ammo', 'Ammo (side racks)', 2100, 430, 3000, 900),
        M('fuel', 'Fuel tanks', 3800, 430, 4150, 1550), M('engine', 'Engine', 4200, 430, 4950, 1550),
      ],
      deco: { ...gear({ ends: [[200, 600, 280], [5250, 600, 260]], road: [750, 1738, 2725, 3712, 4700], r: 330, rollers: [1240, 2230, 3220, 4210], ry: 800, rr: 80 }), barrel: { x0: 1400, x1: -1210, y: 2100, d: 90, taper: 0.8, brake: 'single' }, shapes: [bowMG(507, 1300), ...roofMG(3700, 2340, 700)] },
    },
    {
      id: 'pershing', name: 'M26 Pershing', group: 'WW2 (approx.)', year: 1945, from: 'USA', aim: [455, 1460],
      about: 'America\'s heavy tank at the very end of the war: a 90 mm gun and a 102 mm front plate sloped at 46°.',
      parts: [
        ...chain('h', [[3700, 1900], [5900, 1900], [6330, 1150], [6000, 480], [720, 480], [0, 1020], [910, 1900], [1900, 1900]], [
          ['Engine deck', L('rha', 22)], ['Rear plate', L('rha', 51)], ['Lower rear plate', L('rha', 51)], ['Belly', L('rha', 25)],
          ['Lower front plate', L('rha', 76)], ['Upper front plate', L('rha', 102)], ['Hull roof', L('rha', 22)]]),
        ...chain('t', [[1950, 1920], [1880, 2550], [2200, 2780], [3700, 2780], [4100, 2200], [3750, 1950]], [
          ['Turret front', L('cast', 102)], ['Turret roof (front)', L('rha', 25)], ['Turret roof', L('rha', 25)], ['Turret rear', L('cast', 76)], ['Bustle floor', L('rha', 25)]]),
        ...chain('t', [[1700, 2050], [1700, 2500]], [['Gun mantlet', L('cast', 114)]]),
      ],
      modules: [
        M('crew', 'Driver', 950, 560, 1400, 1700), M('crew', 'Assistant driver', 1450, 560, 1900, 1800),
        M('crew', 'Gunner', 2100, 1500, 2500, 2550), M('crew', 'Loader', 2600, 600, 3050, 2450), M('crew', 'Commander', 3150, 1650, 3600, 2700),
        M('gun', 'Gun breech', 1950, 2180, 3150, 2380), M('ammo', 'Ammo (floor racks)', 1950, 560, 3650, 900),
        M('fuel', 'Fuel tanks', 3800, 560, 4250, 1800), M('engine', 'Engine', 4300, 560, 5450, 1800), M('trans', 'Transmission', 5500, 560, 5950, 1300),
      ],
      deco: { ...gear({ ends: [[150, 650, 300], [6100, 650, 300]], road: [800, 1720, 2640, 3560, 4480, 5400], r: 330, rollers: [1260, 2180, 3100, 4020, 4940], ry: 850, rr: 80, drive: 'rear' }), barrel: { x0: 1700, x1: -2320, y: 2280, d: 110, taper: 0.75, brake: 'double' }, shapes: [bowMG(496, 1500), ...roofMG(3650, 2780, 700), cupola(3150, 3600, 2780, 130)] },
    },
    {
      id: 'is2', name: 'IS-2', group: 'WW2 (approx.)', year: 1944, from: 'Soviet Union', aim: [550, 1270],
      about: 'A heavy tank with a huge 122 mm gun and a steep 120 mm front plate. It carried only 28 big shells.',
      parts: [
        ...chain('h', [[3700, 1590], [5800, 1590], [6500, 900], [6300, 420], [300, 420], [0, 950], [1108, 1590], [1900, 1590]], [
          ['Engine deck', L('rha', 30)], ['Upper rear plate', L('rha', 60)], ['Lower rear plate', L('rha', 60)], ['Belly', L('rha', 20)],
          ['Lower front plate', L('rha', 100)], ['Upper front plate', L('rha', 120)], ['Hull roof', L('rha', 30)]]),
        ...chain('t', [[1750, 1620], [1700, 2150], [2000, 2600], [3500, 2700], [3900, 1620]], [
          ['Turret front', L('cast', 100)], ['Turret front (upper)', L('cast', 100)], ['Turret roof', L('rha', 30)], ['Turret rear', L('cast', 90)]]),
        ...chain('t', [[1450, 1850], [1450, 2450]], [['Gun mantlet', L('cast', 100)]]),
      ],
      modules: [
        M('crew', 'Driver', 1250, 500, 1700, 1450), M('crew', 'Gunner', 1850, 1250, 2220, 2350), M('crew', 'Loader', 2260, 550, 2660, 2250),
        M('crew', 'Commander', 2700, 1700, 3100, 2600), M('gun', 'Gun breech', 1700, 2050, 3200, 2260),
        M('ammo', 'Shells (turret rack)', 3150, 1650, 3480, 2150), M('ammo', 'Charges (hull racks)', 2000, 1200, 3700, 1570),
        M('fuel', 'Fuel tanks', 4100, 500, 4600, 1500), M('engine', 'Engine', 4600, 500, 5800, 1500), M('trans', 'Transmission', 5800, 480, 6300, 1100),
      ],
      deco: { ...gear({ ends: [[150, 620, 300], [6400, 640, 300]], road: [800, 1780, 2760, 3740, 4720, 5700], r: 275, rollers: [1290, 3250, 5210], ry: 820, rr: 90, drive: 'rear' }), barrel: { x0: 1450, x1: -3060, y: 2150, d: 140, taper: 0.7, brake: 'double' }, shapes: [cupola(2750, 3150, 2660, 140)] },
    },
    {
      id: 'churchill', name: 'Churchill VII', group: 'WW2 (approx.)', year: 1944, from: 'UK', aim: [60, 1550],
      about: 'A slow British infantry tank with some of the thickest armor of the war: 152 mm on the front. Its tracks run all the way round the hull.',
      parts: [
        ...chain('h', [[3700, 2050], [6900, 2050], [7100, 1300], [6900, 500], [700, 500], [60, 1150], [60, 1950], [500, 2050], [1900, 2050]], [
          ['Engine deck', L('rha', 20)], ['Rear plate', L('rha', 50)], ['Lower rear plate', L('rha', 50)], ['Belly', L('rha', 25)],
          ['Nose plate', L('rha', 140)], ['Front plate', L('rha', 152)], ['Glacis', L('rha', 58)], ['Hull roof', L('rha', 20)]]),
        ...chain('t', [[2000, 2070], [1950, 2700], [3550, 2750], [3700, 2070]], [['Turret front', L('cast', 152)], ['Turret roof', L('rha', 20)], ['Turret rear', L('cast', 95)]]),
        ...chain('t', [[1800, 2200], [1800, 2600]], [['Gun mantlet', L('cast', 90)]]),
      ],
      modules: [
        M('crew', 'Driver', 800, 600, 1250, 1850), M('crew', 'Hull gunner', 1300, 600, 1750, 1850),
        M('crew', 'Gunner', 2200, 1600, 2600, 2600), M('crew', 'Loader', 2700, 650, 3150, 2450), M('crew', 'Commander', 3200, 1700, 3550, 2700),
        M('gun', 'Gun breech', 2150, 2300, 3150, 2500), M('ammo', 'Ammo (side bins)', 1800, 580, 3650, 1000),
        M('fuel', 'Fuel tanks', 3800, 580, 4300, 1950), M('engine', 'Engine', 4350, 580, 6000, 1900), M('trans', 'Transmission', 6050, 560, 6800, 1400),
      ],
      deco: { ...gear({ ends: [[350, 1500, 320], [6850, 1500, 320]], road: [900, 1440, 1980, 2520, 3060, 3600, 4140, 4680, 5220, 5760, 6300], r: 140, drive: 'rear' }), barrel: { x0: 1800, x1: -300, y: 2400, d: 90, taper: 0.85, brake: false }, shapes: [bowMG(65, 1700), cupola(3150, 3550, 2750, 130)] },
    },
    {
      id: 'semple', name: 'Bob Semple tank', group: 'WW2 (approx.)', year: 1941, from: 'New Zealand', aim: [200, 2300],
      about: 'A farm tractor with a box of corrugated steel bolted on, built in a hurry in New Zealand in case of invasion. Often called the worst tank ever made: it rocked, it was slow, and its thin plating only just keeps out rifle bullets. It carried 8 crew, 6 of them machine gunners.',
      parts: [
        ...chain('h', [[400, 650], [100, 1300], [300, 3300], [4300, 3300], [4500, 650]], [
          ['Lower front plate', L('mild', 10)], ['Front plate (corrugated)', L('mild', 10)], ['Roof', L('mild', 10)], ['Back plate', L('mild', 10)], ['Floor (the tractor)', L('mild', 12)]], true),
      ],
      modules: [
        M('engine', 'Tractor engine', 500, 720, 1500, 1700), M('fuel', 'Fuel tank', 1550, 720, 2050, 1300), M('trans', 'Gearbox', 3700, 720, 4400, 1300),
        M('crew', 'Driver', 1550, 1350, 1950, 2300), M('crew', 'Machine gunner 1', 2000, 1350, 2400, 2300), M('crew', 'Machine gunner 2', 2450, 1350, 2850, 2300), M('crew', 'Machine gunner 3', 2900, 1350, 3300, 2300),
        M('crew', 'Commander', 1600, 2350, 2000, 3200), M('crew', 'Machine gunner 4', 2050, 2350, 2450, 3200), M('crew', 'Machine gunner 5', 2500, 2350, 2900, 3200), M('crew', 'Machine gunner 6', 2950, 2350, 3350, 3200),
      ],
      deco: { ...gear({ ends: [[300, 700, 330], [4300, 800, 380]], road: [900, 1460, 2020, 2580, 3140, 3700], r: 180, rollers: [1600, 3000], ry: 900, rr: 90, drive: 'rear' }) },
    },
    {
      id: 't55', name: 'T-55', group: 'Cold War (approx.)', year: 1958, from: 'Soviet Union', aim: [640, 1200],
      about: 'One of the most-built tanks ever. A thick cast dome turret and a 100 mm gun. Some shells sit in a rack next to the driver.',
      parts: [
        ...chain('h', [[3700, 1515], [5700, 1515], [6200, 800], [5900, 425], [650, 425], [0, 880], [1100, 1515], [1800, 1515]], [
          ['Engine deck', L('rha', 20)], ['Rear plate', L('rha', 45)], ['Lower rear plate', L('rha', 20)], ['Belly', L('rha', 20)],
          ['Lower front plate', L('rha', 100)], ['Upper front plate', L('rha', 100)], ['Hull roof', L('rha', 30)]]),
        ...chain('t', [[1600, 1540], [1500, 1950], [1800, 2250], [2700, 2350], [3700, 2250], [4000, 1540]], [
          ['Turret front', L('cast', 200)], ['Turret front (upper)', L('cast', 160)], ['Turret roof (front)', L('cast', 40)],
          ['Turret roof', L('cast', 30)], ['Turret rear', L('cast', 65)]]),
      ],
      modules: [
        M('crew', 'Driver', 1250, 500, 1700, 1350), M('fuel', 'Fuel tank (front)', 1750, 480, 2150, 1450), M('ammo', 'Ammo (front rack)', 2200, 480, 2550, 1450),
        M('crew', 'Gunner', 2050, 1250, 2450, 2150), M('crew', 'Loader', 2600, 500, 3050, 2100), M('crew', 'Commander', 3100, 1400, 3550, 2250),
        M('gun', 'Gun breech', 1550, 1820, 2700, 2000), M('ammo', 'Ammo (rear rack)', 3500, 600, 3900, 1450),
        M('engine', 'Engine', 4300, 500, 5500, 1450), M('trans', 'Transmission', 5500, 480, 6000, 1100),
      ],
      deco: { ...gear({ ends: [[150, 560, 290], [5900, 600, 280]], road: [830, 2000, 2950, 3900, 4850], r: 405, drive: 'rear' }), barrel: { x0: 1500, x1: -2750, y: 1900, d: 115, taper: 0.85, brake: false, evac: -2250 }, shapes: [...roofMG(2550, 2330), cupola(3100, 3500, 2280, 120)] },
    },
    {
      id: 't62', name: 'T-62', group: 'Cold War (approx.)', year: 1961, from: 'Soviet Union', aim: [580, 1215],
      about: 'A T-55 stretched to fit a big 115 mm smoothbore gun, the first tank gun of its kind. It threw its empty shell cases out of a hatch in the turret.',
      parts: [
        ...chain('h', [[3900, 1550], [6000, 1550], [6630, 800], [6300, 425], [650, 425], [0, 880], [1160, 1550], [1850, 1550]], [
          ['Engine deck', L('rha', 20)], ['Rear plate', L('rha', 45)], ['Lower rear plate', L('rha', 20)], ['Belly', L('rha', 20)],
          ['Lower front plate', L('rha', 100)], ['Upper front plate', L('rha', 100)], ['Hull roof', L('rha', 30)]]),
        ...chain('t', [[1650, 1575], [1520, 1980], [1850, 2300], [2900, 2400], [3900, 2280], [4150, 1575]], [
          ['Turret front', L('cast', 230)], ['Turret front (upper)', L('cast', 160)], ['Turret roof (front)', L('cast', 40)],
          ['Turret roof', L('cast', 30)], ['Turret rear', L('cast', 65)]]),
      ],
      modules: [
        M('crew', 'Driver', 1250, 500, 1700, 1380), M('fuel', 'Fuel tank (front)', 1750, 480, 2100, 1450), M('ammo', 'Ammo (front rack)', 2150, 480, 2500, 1450),
        M('crew', 'Gunner', 2150, 1450, 2550, 2250), M('crew', 'Loader', 2700, 500, 3150, 2200), M('crew', 'Commander', 3250, 1450, 3700, 2250),
        M('gun', 'Gun breech', 1800, 1870, 2950, 2060), M('ammo', 'Ammo (rear rack)', 3500, 550, 3850, 1450),
        M('engine', 'Engine', 4300, 500, 5650, 1450), M('trans', 'Transmission', 5650, 480, 6150, 1100),
      ],
      deco: { ...gear({ ends: [[150, 560, 290], [6350, 600, 280]], road: [830, 1780, 2730, 4030, 5330], r: 405, drive: 'rear' }), barrel: { x0: 1520, x1: -2710, y: 1950, d: 125, taper: 0.85, brake: false, evac: -1300 }, shapes: [...roofMG(2650, 2380), cupola(3250, 3650, 2320, 120)] },
    },
    {
      id: 't72', name: 'T-72 Ural', group: 'Cold War (approx.)', year: 1973, from: 'Soviet Union', aim: [1000, 1300],
      about: 'Low and fast-firing, with a layered steel-and-fibreglass front plate. Its autoloader keeps 22 rounds in a ring under the turret.',
      parts: [
        ...chain('h', [[4600, 1720], [6400, 1720], [6950, 900], [6600, 490], [700, 490], [0, 900], [2030, 1720], [2600, 1720]], [
          ['Engine deck', L('rha', 20)], ['Rear plate', L('rha', 40)], ['Lower rear plate', L('rha', 40)], ['Belly', L('rha', 20)],
          ['Lower front plate', L('rha', 85)], ['Upper front plate (layered)', L('rha', 80, 'grp', 105, 'rha', 20)], ['Hull roof', L('rha', 20)]]),
        ...chain('t', [[2500, 1740], [2350, 1950], [2700, 2180], [3500, 2230], [4400, 2150], [4800, 1740]], [
          ['Turret front', L('cast', 280)], ['Turret front (upper)', L('cast', 200)], ['Turret roof (front)', L('cast', 45)],
          ['Turret roof', L('cast', 45)], ['Turret rear', L('cast', 70)]]),
      ],
      modules: [
        M('fuel', 'Fuel tanks (front)', 1400, 560, 2200, 1150), M('crew', 'Driver', 2250, 560, 2700, 1450),
        M('ammo', 'Autoloader carousel', 2900, 560, 4700, 800), M('ammo', 'Extra ammo (hull)', 4750, 560, 5100, 1500),
        M('crew', 'Gunner', 2900, 1100, 3300, 2050), M('crew', 'Commander', 3400, 1150, 3850, 2150),
        M('gun', 'Gun breech', 2500, 1920, 3800, 2080), M('engine', 'Engine', 5150, 560, 6300, 1600), M('trans', 'Transmission', 6300, 520, 6800, 1150),
      ],
      deco: { ...gear({ ends: [[150, 560, 280], [6650, 560, 280]], road: [800, 1800, 2800, 3800, 4800, 5800], r: 375, rollers: [1300, 3300, 5300], ry: 760, rr: 80, drive: 'rear' }), barrel: { x0: 2400, x1: -2580, y: 1990, d: 135, taper: 0.85, brake: false, evac: -1100 }, shapes: [...roofMG(3600, 2330), cupola(3350, 3800, 2200, 130)] },
    },
    {
      id: 'leopard1', name: 'Leopard 1', group: 'Cold War (approx.)', year: 1965, from: 'West Germany', aim: [580, 1265],
      about: 'West Germany chose speed over armor: only 70 mm on the front, but a fast tank with the excellent British-designed 105 mm gun.',
      parts: [
        ...chain('h', [[4400, 1600], [6400, 1600], [7090, 950], [6700, 440], [700, 440], [0, 930], [1160, 1600], [2300, 1600]], [
          ['Engine deck', L('rha', 20)], ['Rear plate', L('rha', 25)], ['Lower rear plate', L('rha', 25)], ['Belly', L('rha', 15)],
          ['Lower front plate', L('rha', 70)], ['Upper front plate', L('rha', 70)], ['Hull roof', L('rha', 25)]]),
        ...chain('t', [[2150, 1620], [1900, 2000], [2500, 2400], [4400, 2450], [5000, 2150], [4500, 1640]], [
          ['Turret front (lower)', L('cast', 52)], ['Turret front (upper)', L('cast', 52)], ['Turret roof', L('rha', 20)], ['Turret rear', L('cast', 30)], ['Bustle floor', L('rha', 20)]]),
        ...chain('t', [[1750, 1850], [1750, 2150]], [['Gun mantlet', L('rha', 60)]]),
      ],
      modules: [
        M('crew', 'Driver', 900, 520, 1350, 1450), M('ammo', 'Ammo (hull rack)', 1400, 500, 2200, 1450),
        M('crew', 'Gunner', 2500, 1350, 2900, 2300), M('crew', 'Commander', 3000, 1450, 3450, 2380), M('crew', 'Loader', 3550, 520, 4000, 2350),
        M('gun', 'Gun breech', 2100, 1900, 3350, 2100), M('ammo', 'Ammo (turret)', 4150, 1880, 4650, 2300),
        M('fuel', 'Fuel tanks', 4500, 500, 5000, 1500), M('engine', 'Engine', 5050, 500, 6300, 1500), M('trans', 'Transmission', 6300, 480, 6900, 1150),
      ],
      deco: { ...gear({ ends: [[200, 600, 300], [6850, 600, 280]], road: [900, 1767, 2633, 3500, 4367, 5233, 6100], r: 350, rollers: [1333, 2633, 3933, 5233], ry: 800, rr: 80, drive: 'rear' }), barrel: { x0: 1750, x1: -2450, y: 2000, d: 115, taper: 0.85, brake: false, evac: -1050 }, shapes: [cupola(3000, 3450, 2420, 130)] },
    },
    {
      id: 'bmp1', name: 'BMP-1', group: 'Cold War (approx.)', year: 1966, from: 'Soviet Union', aim: [275, 570],
      about: 'A Soviet infantry fighting vehicle with a 73 mm gun and room for 8 soldiers, but very thin armor. Its back doors are fuel tanks.',
      parts: [
        ...chain('h', [[3800, 1600], [6400, 1600], [6735, 600], [6400, 390], [550, 390], [0, 750], [2200, 1180], [2500, 1600], [2700, 1600]], [
          ['Roof', L('rha', 6)], ['Back doors', L('rha', 16)], ['Lower rear plate', L('rha', 16)], ['Belly', L('rha', 6)],
          ['Lower front plate', L('rha', 19)], ['Upper front plate (ribbed)', L('rha', 7)], ['Front of the roof', L('rha', 7)], ['Hull roof', L('rha', 6)]]),
        ...chain('t', [[2800, 1620], [2650, 1900], [3000, 2068], [3550, 2068], [3750, 1620]], [
          ['Turret front', L('rha', 23)], ['Turret roof (front)', L('rha', 10)], ['Turret roof', L('rha', 10)], ['Turret rear', L('rha', 19)]]),
      ],
      modules: [
        M('engine', 'Engine', 700, 450, 1700, 850), M('crew', 'Driver', 1750, 450, 2200, 1050), M('crew', 'Commander', 2550, 450, 2950, 1550),
        M('crew', 'Gunner', 3000, 1000, 3400, 2000), M('gun', 'Gun breech', 2750, 1780, 3500, 1920), M('ammo', 'Ammo (carousel)', 2700, 450, 3800, 800),
        M('crew', 'Soldier 1', 3900, 450, 4450, 1500), M('crew', 'Soldier 2', 4500, 450, 5050, 1500), M('crew', 'Soldier 3', 5100, 450, 5650, 1500), M('crew', 'Soldier 4', 5700, 450, 6150, 1500),
        M('fuel', 'Fuel tanks (back doors)', 6200, 650, 6420, 1450),
      ],
      deco: { ...gear({ ends: [[200, 520, 230], [6450, 520, 230]], road: [800, 1820, 2840, 3860, 4880, 5900], r: 300, t: 50, rollers: [1310, 3350, 5390], ry: 680, rr: 70 }), barrel: { x0: 2650, x1: 550, y: 1850, d: 80, taper: 0.9, brake: false }, shapes: [box(1950, 1930, 2800, 2010, 1)] },
    },
    {
      id: 'leopard2', name: 'Leopard 2A4', group: 'Modern (approx.)', year: 1985, from: 'West Germany', aim: [2540, 1650],
      about: 'West Germany\'s 1980s main battle tank. Its real armor is secret, so this uses rough public estimates. Some of its ammo sits in the hull next to the driver.',
      parts: [
        ...chain('h', [[5100, 1480], [7400, 1480], [7720, 800], [7300, 490], [600, 490], [80, 1100], [2300, 1480], [2450, 1480]], [
          ['Engine deck', L('rha', 25)], ['Rear plate', L('rha', 25)], ['Lower rear plate', L('rha', 25)], ['Belly', L('rha', 25)],
          ['Lower front plate (layered)', L('hhs', 50, 'al2o3', 100, 'rha', 50)], ['Upper front plate', L('rha', 50)], ['Hull roof', L('rha', 40)]]),
        ...chain('t', [[2550, 1500], [2500, 2250], [3000, 2480], [6300, 2480], [6600, 1800], [5150, 1800]], [
          ['Turret front (layered)', L('hhs', 50, 'al2o3', 200, 'rubber', 30, 'al2o3', 200, 'rha', 70)], ['Turret roof (front)', L('rha', 40)], ['Turret roof', L('rha', 30)],
          ['Bustle rear', L('rha', 30)], ['Bustle floor', L('rha', 25)]]),
        ...chain('t', [[2350, 1750], [2350, 2100]], [['Gun mantlet', L('rha', 150)]]),
      ],
      modules: [
        M('ammo', 'Ammo (hull rack)', 850, 560, 1750, 1150), M('crew', 'Driver', 1800, 560, 2250, 1330),
        M('crew', 'Gunner', 3150, 1450, 3600, 2400), M('crew', 'Commander', 3700, 1650, 4150, 2420), M('crew', 'Loader', 4250, 560, 4700, 2420),
        M('gun', 'Gun breech', 3150, 1830, 4400, 2030), M('ammo', 'Ammo (bustle, blow-out panels)', 5200, 1850, 6250, 2420, { vent: true }),
        M('fuel', 'Fuel tanks', 4800, 560, 5100, 1400), M('engine', 'Engine', 5150, 560, 6700, 1420), M('trans', 'Transmission', 6750, 540, 7250, 1200),
      ],
      deco: { ...gear({ ends: [[250, 650, 300], [7450, 650, 300]], road: [950, 1908, 2867, 3825, 4783, 5742, 6700], r: 350, rollers: [1429, 2867, 4304, 5742], ry: 840, rr: 80, drive: 'rear' }), barrel: { x0: 2350, x1: -1870, y: 1930, d: 140, taper: 0.85, brake: false, evac: -700 }, shapes: [cupola(3700, 4150, 2480, 120), box(3400, 2470, 3600, 2700, 1)] },
    },
    {
      id: 'abrams', name: 'M1A1 Abrams', group: 'Modern (approx.)', year: 1985, from: 'USA', aim: [2618, 1750],
      about: 'America\'s main battle tank. Its real armor is secret, so this uses rough public estimates: thick layered armor on the turret front, and most of the ammo in the turret bustle behind blow-out panels.',
      parts: [
        ...chain('h', [[5100, 1600], [7500, 1600], [7930, 900], [7500, 480], [550, 480], [0, 1150], [2400, 1600], [2600, 1600]], [
          ['Engine deck', L('rha', 30)], ['Rear plate', L('rha', 30)], ['Lower rear plate', L('rha', 30)], ['Belly', L('rha', 30)],
          ['Lower front plate (layered)', L('hhs', 50, 'al2o3', 120, 'rha', 50)], ['Upper front plate', L('rha', 50)], ['Hull roof', L('rha', 40)]]),
        ...chain('t', [[2650, 1630], [2500, 2200], [3000, 2440], [6600, 2440], [6750, 1900], [5150, 1900]], [
          ['Turret front (layered)', L('hhs', 60, 'al2o3', 250, 'rubber', 30, 'al2o3', 250, 'rha', 80)], ['Turret roof (front)', L('rha', 50)], ['Turret roof', L('rha', 40)],
          ['Bustle rear', L('rha', 30)], ['Bustle floor', L('rha', 30)]]),
        ...chain('t', [[2350, 1850], [2350, 2150]], [['Gun mantlet', L('rha', 150)]]),
      ],
      modules: [
        M('fuel', 'Fuel tanks (front)', 800, 560, 1250, 1200), M('crew', 'Driver', 1300, 560, 1750, 1300),
        M('crew', 'Gunner', 3350, 1500, 3800, 2350), M('crew', 'Commander', 3900, 1700, 4350, 2400), M('crew', 'Loader', 4450, 560, 4900, 2400),
        M('gun', 'Gun breech', 3300, 1900, 4700, 2100), M('ammo', 'Ammo (bustle, blow-out panels)', 5200, 1950, 6550, 2380, { vent: true }),
        M('engine', 'Engine and transmission', 5200, 560, 7300, 1550),
      ],
      deco: { ...gear({ ends: [[250, 650, 300], [7550, 650, 300]], road: [900, 1900, 2900, 3900, 4900, 5900, 6900], r: 320, rollers: [2400, 5400], ry: 840, rr: 80, drive: 'rear' }), barrel: { x0: 2350, x1: -1900, y: 2000, d: 140, taper: 0.85, brake: false, evac: -700 }, shapes: [...roofMG(4150, 2610, 700), cupola(3900, 4350, 2440, 170)] },
    },
    {
      id: 't90', name: 'T-90A', group: 'Modern (approx.)', year: 2004, from: 'Russia', aim: [1000, 1340],
      about: 'A modern T-72 with heavy reactive armor on the front, strong enough to knock many darts off course. Its real armor is secret, so this uses rough public estimates. Like the T-72, its ammo sits in a ring under the turret.',
      parts: [
        ...chain('h', [[4600, 1720], [6400, 1720], [6950, 900], [6600, 490], [700, 490], [0, 900], [2030, 1720], [2600, 1720]], [
          ['Engine deck', L('rha', 20)], ['Rear plate', L('rha', 40)], ['Lower rear plate', L('rha', 40)], ['Belly', L('rha', 20)],
          ['Lower front plate', L('rha', 85)], ['Upper front plate (layered)', L('rha', 80, 'grp', 105, 'rha', 70)], ['Hull roof', L('rha', 20)]]),
        ...chain('h', [[162, 1031], [1739, 1668]], [['Reactive armor (heavy)', L('rha', 15, 'era', 15, 'rha', 15)]]),
        ...chain('t', [[2500, 1740], [2350, 1950], [2700, 2180], [3500, 2230], [4400, 2150], [4800, 1740]], [
          ['Turret front (layered)', L('rha', 70, 'al2o3', 150, 'rubber', 20, 'rha', 100)], ['Turret front (upper)', L('rha', 70, 'al2o3', 100, 'rha', 60)], ['Turret roof (front)', L('rha', 45)],
          ['Turret roof', L('rha', 45)], ['Turret rear', L('rha', 70)]]),
      ],
      modules: [
        M('fuel', 'Fuel tanks (front)', 1400, 560, 2200, 1150), M('crew', 'Driver', 2250, 560, 2700, 1450),
        M('ammo', 'Autoloader carousel', 2900, 560, 4700, 800), M('ammo', 'Extra ammo (hull)', 4750, 560, 5100, 1500),
        M('crew', 'Gunner', 2950, 1100, 3350, 2000), M('crew', 'Commander', 3400, 1150, 3850, 2150),
        M('gun', 'Gun breech', 2850, 1920, 3900, 2080), M('engine', 'Engine', 5150, 560, 6300, 1600), M('trans', 'Transmission', 6300, 520, 6800, 1150),
      ],
      deco: { ...gear({ ends: [[150, 560, 280], [6650, 560, 280]], road: [800, 1800, 2800, 3800, 4800, 5800], r: 375, rollers: [1300, 3300, 5300], ry: 760, rr: 80, drive: 'rear' }), barrel: { x0: 2350, x1: -2770, y: 1990, d: 135, taper: 0.85, brake: false, evac: -1150 }, shapes: [...roofMG(3650, 2340), cupola(3400, 3850, 2210, 130)] },
    },
    {
      id: 'merkava', name: 'Merkava Mk 4', group: 'Modern (approx.)', year: 2004, from: 'Israel', aim: [950, 1300],
      about: 'Israel\'s main battle tank. Unlike most tanks, its engine is in the front, so a shot through the front has to get through the engine before it reaches the crew. There\'s a door in the back for the crew to get out. Its real armor is secret, so this uses rough public estimates.',
      parts: [
        ...chain('h', [[6300, 1700], [7450, 1700], [7650, 1050], [7350, 480], [500, 480], [0, 950], [1900, 1650], [2900, 1650]], [
          ['Rear roof', L('rha', 30)], ['Rear door', L('rha', 30)], ['Lower rear plate', L('rha', 30)], ['Belly', L('rha', 30)],
          ['Lower front plate', L('rha', 60)], ['Upper front plate (layered)', L('hhs', 40, 'al2o3', 80, 'rha', 40)], ['Hull roof', L('rha', 40)]]),
        ...chain('t', [[2850, 1720], [2200, 2050], [3200, 2600], [6200, 2600], [6500, 2150], [6250, 1720]], [
          ['Turret front (lower, layered)', L('hhs', 50, 'al2o3', 150, 'rubber', 30, 'al2o3', 120, 'rha', 50)], ['Turret front (upper, layered)', L('hhs', 40, 'al2o3', 100, 'rha', 40)],
          ['Turret roof', L('rha', 40)], ['Turret rear', L('rha', 40)], ['Bustle floor', L('rha', 30)]]),
      ],
      modules: [
        M('trans', 'Transmission', 450, 640, 850, 920), M('engine', 'Engine (in front, shields the crew)', 900, 560, 1950, 1100),
        M('fuel', 'Fuel tanks', 2000, 560, 2450, 950), M('crew', 'Driver', 2000, 1000, 2450, 1590),
        M('crew', 'Gunner', 2950, 1150, 3350, 2450), M('crew', 'Commander', 3450, 1300, 3900, 2540), M('crew', 'Loader', 4000, 560, 4450, 2500),
        M('gun', 'Gun breech', 2600, 2150, 4100, 2350), M('ammo', 'Ammo (rear hull, fire-proof boxes)', 5200, 560, 6800, 1300),
      ],
      deco: { ...gear({ ends: [[250, 650, 300], [7450, 650, 280]], road: [950, 2100, 3250, 4400, 5550, 6700], r: 380, rollers: [1525, 3825, 6125], ry: 880, rr: 80 }), barrel: { x0: 2300, x1: -1440, y: 2280, d: 140, taper: 0.85, brake: false }, shapes: [...roofMG(3700, 2740), cupola(3450, 3900, 2600, 140)] },
    },
    {
      id: 't14', name: 'T-14 Armata', group: 'Modern (approx.)', year: 2015, from: 'Russia', aim: [1000, 1426],
      about: 'Russia\'s newest tank. Nobody sits in the turret: the 3 crew sit side by side in an armored capsule at the front of the hull (drawn one behind another here), walled off from the ammo, so they have a chance even if it blows up. Its real armor is secret, so this uses rough public estimates.',
      parts: [
        ...chain('h', [[5300, 1750], [8000, 1750], [8650, 1050], [8350, 500], [800, 500], [0, 1000], [2100, 1750], [2850, 1750]], [
          ['Engine deck', L('rha', 25)], ['Rear plate', L('rha', 40)], ['Lower rear plate', L('rha', 30)], ['Belly', L('rha', 30)],
          ['Lower front plate', L('rha', 80)], ['Upper front plate (layered)', L('rha', 80, 'al2o3', 100, 'rha', 80)], ['Hull roof (over the crew)', L('rha', 60)]]),
        ...chain('h', [[214, 1145], [1768, 1700]], [['Reactive armor (heavy)', L('rha', 15, 'era', 20, 'rha', 15)]]),
        ...chain('h', [[2950, 560], [2950, 1690]], [['Crew capsule wall', L('rha', 50)]]),
        ...chain('t', [[2800, 1770], [2650, 2150], [3050, 2500], [5700, 2500], [5900, 1770]], [
          ['Turret front (nobody inside)', L('rha', 60)], ['Turret front (upper)', L('rha', 45)], ['Turret roof', L('rha', 25)], ['Turret rear', L('rha', 30)]]),
      ],
      modules: [
        M('fuel', 'Fuel tanks (front)', 900, 580, 1450, 1000), M('crew', 'Driver', 1500, 580, 1900, 1250, { capsule: true }),
        M('crew', 'Gunner', 1950, 580, 2400, 1400, { capsule: true }), M('crew', 'Commander', 2450, 580, 2900, 1650, { capsule: true }),
        M('ammo', 'Autoloader carousel (under the turret)', 3100, 580, 5200, 900), M('gun', 'Gun breech', 3000, 2050, 4600, 2250),
        M('engine', 'Engine', 5400, 580, 7500, 1650), M('trans', 'Transmission', 7550, 580, 8250, 1200),
      ],
      deco: { ...gear({ ends: [[200, 600, 280], [8450, 600, 260]], road: [900, 2050, 3200, 4350, 5500, 6650, 7800], r: 380, drive: 'rear' }), barrel: { x0: 2700, x1: -2100, y: 2150, d: 140, taper: 0.85, brake: false, evac: -800 }, shapes: [box(4300, 2500, 4800, 2700, 1)] },
    },
    {
      id: 'warden', name: 'Warden MBT (made up)', group: 'Made-up vehicles', year: 2030, from: 'Made up', aim: [800, 1300],
      about: 'A made-up modern tank: ceramic layers, a reactive tile on the front, and ammo in a sealed rack with blow-out panels.',
      parts: [
        ...chain('h', [[4800, 1750], [6700, 1750], [7300, 950], [6900, 500], [750, 500], [0, 950], [2100, 1750], [2700, 1750]], [
          ['Engine deck', L('rha', 40)], ['Rear plate', L('rha', 40)], ['Lower rear plate', L('rha', 30)], ['Belly (mine plate)', L('rha', 40)],
          ['Lower front plate', L('hhs', 80)], ['Upper front plate (ceramic)', L('hhs', 50, 'al2o3', 80, 'rha', 40)], ['Hull roof', L('rha', 40)]]),
        ...chain('h', [[186, 1093], [1761, 1693]], [['Reactive tile', L('rha', 8, 'era', 10, 'rha', 8)]]),
        ...chain('t', [[2600, 1770], [2450, 2250], [3200, 2600], [5900, 2600], [6100, 1770]], [
          ['Turret front (composite)', L('hhs', 60, 'al2o3', 150, 'rubber', 20, 'al2o3', 150, 'rha', 60)], ['Turret roof (front)', L('hhs', 50)],
          ['Turret roof', L('rha', 40)], ['Turret bustle', L('rha', 30)]]),
        ...chain('t', [[2250, 1900], [2250, 2350]], [['Gun mantlet', L('rha', 120)]]),
      ],
      modules: [
        M('fuel', 'Fuel tanks (front)', 1300, 580, 2200, 1050), M('crew', 'Driver', 2300, 580, 2750, 1500), M('ammo', 'Ready rack (hull)', 2800, 580, 3100, 1300),
        M('crew', 'Gunner', 3100, 1350, 3500, 2300), M('crew', 'Loader', 3600, 700, 4100, 2350), M('crew', 'Commander', 4150, 1500, 4600, 2450),
        M('gun', 'Gun breech', 2450, 2050, 3900, 2250), M('ammo', 'Bustle ammo (blow-out panels)', 4900, 1900, 5800, 2500, { vent: true }),
        M('engine', 'Engine', 5150, 580, 6500, 1650), M('trans', 'Transmission', 6500, 560, 7050, 1200),
      ],
      deco: { ...gear({ ends: [[150, 600, 300], [7000, 620, 280]], road: [850, 1742, 2633, 3525, 4417, 5308, 6200], r: 320, rollers: [1700, 3525, 5350], ry: 820, rr: 80, drive: 'rear' }), barrel: { x0: 2250, x1: -2900, y: 2150, d: 150, taper: 0.85, brake: false } },
    },
    {
      id: 'mule', name: 'Mule troop carrier (made up)', group: 'Made-up vehicles', year: 2020, from: 'Made up', aim: [450, 1250],
      about: 'A made-up aluminium box that carries soldiers. Light enough to float, but heavy guns go straight through.',
      parts: [
        ...chain('h', [[500, 420], [0, 900], [900, 1700], [4800, 1700], [4900, 420]], [
          ['Lower front plate', L('alu', 38)], ['Front plate', L('alu', 38)], ['Roof', L('alu', 38)], ['Rear ramp', L('alu', 38)], ['Belly', L('alu', 30)]], true),
      ],
      modules: [
        M('crew', 'Driver', 1000, 500, 1450, 1550), M('engine', 'Engine', 1500, 480, 2300, 1450),
        M('crew', 'Soldier 1', 2400, 500, 2850, 1550), M('crew', 'Soldier 2', 2900, 500, 3350, 1550), M('crew', 'Soldier 3', 3400, 500, 3850, 1550), M('crew', 'Soldier 4', 3900, 500, 4350, 1550),
        M('fuel', 'Fuel tank', 4400, 480, 4800, 900),
      ],
      deco: { ...gear({ ends: [[150, 560, 240], [4700, 560, 220]], road: [700, 1600, 2500, 3400, 4300], r: 300 }) },
    },
  ];

  // ---------- geometry ----------
  function frameOf(p) {
    const dx = p.b[0] - p.a[0], dy = p.b[1] - p.a[1], len = Math.hypot(dx, dy) || 1;
    const t = [dx / len, dy / len];
    return { t, n: [t[1], -t[0]], len, T: E.plateThickness(p) };   // n points inside (to the right of a → b)
  }
  const same = (p, q) => Math.abs(p[0] - q[0]) < 0.5 && Math.abs(p[1] - q[1]) < 0.5;
  function miter(f, g, at) {   // where the inside faces of two joined plates meet
    const p1 = [at[0] + f.n[0] * f.T, at[1] + f.n[1] * f.T], p2 = [at[0] + g.n[0] * g.T, at[1] + g.n[1] * g.T];
    const den = f.t[0] * g.t[1] - f.t[1] * g.t[0];
    if (Math.abs(den) < 0.05) return p1;   // nearly straight: a plain square end
    const s = ((p2[0] - p1[0]) * g.t[1] - (p2[1] - p1[1]) * g.t[0]) / den, m = [p1[0] + s * f.t[0], p1[1] + s * f.t[1]];
    return Math.hypot(m[0] - at[0], m[1] - at[1]) > 3 * Math.max(f.T, g.T) + 1 ? p1 : m;
  }
  // The outline of every plate: [outer start, outer end, inner end, inner start], with neat corners where plates meet
  function geometry(veh) {
    const F = veh.parts.map(frameOf);
    return veh.parts.map((p, i) => {
      const f = F[i];
      const prev = veh.parts.findIndex((q, j) => j !== i && same(q.b, p.a)), next = veh.parts.findIndex((q, j) => j !== i && same(q.a, p.b));
      const ia = prev >= 0 ? miter(f, F[prev], p.a) : [p.a[0] + f.n[0] * f.T, p.a[1] + f.n[1] * f.T];
      const ib = next >= 0 ? miter(f, F[next], p.b) : [p.b[0] + f.n[0] * f.T, p.b[1] + f.n[1] * f.T];
      return { f, poly: [p.a.slice(), p.b.slice(), ib, ia] };
    });
  }
  // Layer bands of a plate outline (for drawing): splits the outline at each layer boundary
  function layerBands(part, g) {
    const [a, b, ib, ia] = g.poly, T = g.f.T || 1, out = [];
    let acc = 0;
    for (const l of part.layers) {
      const k0 = acc / T, k1 = (acc + l.t) / T; acc += l.t;
      out.push({ mat: l.mat, poly: [lerp(a, ia, k0), lerp(b, ib, k0), lerp(b, ib, k1), lerp(a, ia, k1)] });
    }
    return out;
  }
  const lerp = (p, q, k) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  function bbox(veh, withDeco = true) {
    let x0 = Infinity, x1 = -Infinity, y0 = 0, y1 = -Infinity;
    const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
    geometry(veh).forEach(g => g.poly.forEach(p => add(p[0], p[1])));
    veh.modules.forEach(m => { add(m.x, m.y); add(m.x + m.w, m.y + m.h); });
    const d = withDeco && decoOf(veh);
    if (d) {
      if (d.wheels) trackLoop(d).forEach(p => add(p[0], p[1]));
      if (d.barrel) { add(d.barrel.x1, d.barrel.y - d.barrel.d); add(d.barrel.x0, d.barrel.y + d.barrel.d); }
      for (const sh of d.shapes || []) sh.p.forEach(p => add(p[0], p[1]));
    }
    if (!isFinite(x0)) return [0, 1000, 0, 1000];
    return [x0, x1, y0, y1];
  }
  // The track runs round the outside of all the wheels and rollers: their outline (convex hull), the track's thickness further out
  function trackLoop(d, thick = d.trackT || 60) {
    const pts = [];
    for (const [x, y, r] of d.wheels.concat(d.rollers || [])) for (let k = 0; k < 32; k++) { const a = k / 32 * 2 * Math.PI; pts.push([x + Math.cos(a) * (r + thick), y + Math.sin(a) * (r + thick)]); }
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
    for (const q of pts) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = pts.length - 1; i >= 0; i--) { const q = pts[i]; while (up.length > 1 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  // Wheels, tracks and gun barrel are only drawn (they aren't armor). Your own vehicles get them worked out for you.
  function decoOf(veh) {
    if (veh.deco) return veh.deco;
    const hull = veh.parts.filter(p => p.g !== 't');
    if (!hull.length && !veh.parts.length) return null;
    const pts = (hull.length ? hull : veh.parts).flatMap(p => [p.a, p.b]);
    const x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0])), yb = Math.min(...pts.map(p => p[1]));
    const d = {};
    if (veh.tracks !== false && yb > 150) {
      const r = Math.min(400, Math.max(150, yb * 0.62)), n = Math.max(3, Math.min(9, Math.round((x1 - x0) / (2.3 * r))));
      d.wheels = wheelsRow(x0 + r * 1.3, x1 - r * 1.3, n, r, r + 50); d.trackT = 50;
    }
    const gun = veh.modules.find(m => m.type === 'gun');
    if (gun && (gun.barrel || 0) > 0) d.barrel = { x0: gun.x, x1: gun.x - gun.barrel, y: gun.y + gun.h / 2, d: Math.max(40, Math.min(160, gun.h * 0.6)), brake: false };
    return d;
  }

  // ---------- aiming ----------
  // A shot: where it comes from ('front', 'rear' or 'top'), tilt in degrees (shooter higher = positive), and a point it passes through.
  function shotAngle(shot) {
    const t = shot.tilt || 0;
    return shot.from === 'rear' ? 180 + t : shot.from === 'top' ? -90 + t : -t;
  }
  function frameFor(shot) {
    const th = shotAngle(shot) * DEG, c = Math.cos(th), s = Math.sin(th), O = shot.at;
    return {
      th, c, s, O,
      toE: p => { const dx = p[0] - O[0], dy = p[1] - O[1]; return [c * dx + s * dy, -s * dx + c * dy]; },   // vehicle → shot frame (shot flies along +x)
      toV: e => [O[0] + c * e[0] - s * e[1], O[1] + s * e[0] + c * e[1]],                                     // shot frame → vehicle
      dirV: e => [c * e[0] - s * e[1], s * e[0] + c * e[1]],
      dirE: v => [c * v[0] + s * v[1], -s * v[0] + c * v[1]],
    };
  }
  // Which plates does the shot line go through, in order (only ones it enters from the outside)?
  function crossings(veh, shot, geo, gone) {
    geo = geo || geometry(veh);
    const fr = frameFor(shot), out = [];
    veh.parts.forEach((p, i) => {
      if (gone && gone[i]) return;   // blown off by an earlier shot
      const A = fr.toE(p.a), B = fr.toE(p.b);
      if ((A[1] > 0 && B[1] > 0) || (A[1] < 0 && B[1] < 0) || A[1] === B[1]) return;
      const k = A[1] / (A[1] - B[1]), x = A[0] + k * (B[0] - A[0]);
      const nE = fr.dirE(geo[i].f.n);
      if (nE[0] <= 0.04) return;   // we'd be coming at it from the inside, or edge-on
      out.push({ i, x, k, cos: nE[0], nE, T: geo[i].f.T, part: p });
    });
    return out.sort((a, b) => a.x - b.x);
  }
  const GAP = 450;   // armor closer behind than this is simulated too (spaced plates, a mantlet in front of the turret…)
  function firstArmor(veh, shot, geo, gone) {
    const hits = crossings(veh, shot, geo, gone), group = [];
    let back = -Infinity;
    for (const h of hits) {
      if (group.length && (h.x - back > GAP || group.length >= 4)) break;
      group.push(h); back = Math.max(back, h.x + h.T / Math.max(0.15, h.cos));
    }
    return group;
  }
  // Info for the "aiming at" line: the plate, how thick, at what angle, and how much steel is in the way
  function probe(veh, shot, run) {
    const g = firstArmor(veh, shot, run && run.geo, run && run.gone);
    if (!g.length) return null;
    return g.map(h => ({ name: h.part.n, T: h.T, ang: Math.round(Math.acos(Math.min(1, h.cos)) / DEG), los: Math.round(h.T / Math.max(0.05, h.cos)), layers: h.part.layers }));
  }

  // ---------- the whole vehicle, made of particles ----------
  const SQ3 = Math.sqrt(3);
  const MIN_SPEED = 0.06;   // km/s: slower bits don't hurt anything
  function vehicleArea(veh) { return veh.parts.reduce((s, p) => s + Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]) * E.plateThickness(p), 0); }
  // Particle size for a whole vehicle: just fit the budget (most of the vehicle sleeps until it's hit, so budgets can be big)
  function pickVehH(veh, budget) { return Math.max(1.2, Math.sqrt(vehicleArea(veh) / (budget * SQ3 / 2))); }
  function buildVehicle(veh, budget) {
    const geo = geometry(veh), h = pickVehH(veh, budget);
    const plates = veh.parts.map((p, i) => {
      const g = geo[i], f = g.f, mid = lerp(p.a, p.b, 0.5);
      const reach = Math.max(...g.poly.map(q => Math.abs((q[0] - mid[0]) * f.t[0] + (q[1] - mid[1]) * f.t[1])));   // the rectangle must cover the whole outline
      return { cx: mid[0], cy: mid[1], ang: Math.atan2(-f.n[1], f.n[0]) / DEG, len: 2 * reach + 2 * h, layers: clone(p.layers),
        clip: { poly: g.poly, ends: [[...g.poly[1], ...g.poly[2]], [...g.poly[3], ...g.poly[0]]] }, name: p.n, part: i };
    });
    const sim = new E.Sim({ h, plates, sleep: true, pad: 900, clash: 0.95 });
    return { veh, sim, geo, h, frame: frameFor({ from: 'front', tilt: 0, at: [0, 0] }), dmg: veh.modules.map(() => 0), zin: null, boomed: [], shots: 0, group: null, groups: [], bursts: [] };
  }
  const isTurret = (run, body) => { const pl = run.sim.plates[body - 1]; return !!(pl && run.veh.parts[pl.part] && run.veh.parts[pl.part].g === 't'); };
  // Line the world up so this shot flies along +x through the aim point, then put the projectile in.
  // vol: several shells at once (see E.volleyRounds), each hitting the armor on its own line. Returns how many were fired (0: they all miss).
  function aimShot(run, shot, P, vol) {
    const sim = run.sim, f1 = run.frame, f2 = frameFor(shot);
    const d = f1.th - f2.th, c = Math.cos(d), s = Math.sin(d), t = f2.dirE([f1.O[0] - f2.O[0], f1.O[1] - f2.O[1]]);
    sim.transform(c, s, t[0], t[1]);
    run.frame = f2; run.shot = shot;
    const rounds = [];
    for (const rd of E.volleyRounds(P, vol) || [{ dy: 0, back: 0 }]) {   // a shell to the side of the aim line meets whatever armor is on its own line
      const g = firstArmor(run.veh, { ...shot, at: f2.toV([0, rd.dy]) }, run.geo, run.gone);
      if (g.length) rounds.push({ ...rd, targets: g.map(h => h.i), group: g });
    }
    run.groups = rounds.map(r => r.group); run.group = rounds.length ? rounds[0].group : [];
    if (!rounds.length) return 0;
    unsettle(run);
    sim.addShot({ ...P, aim: 0 }, null, rounds);
    run.shots++;
    run.bursts = P.aphe && P.kind === 'ke' ? sim.rounds.map(R => ({ R, fuse: P.aphe.fuse, q: P.aphe.charge, done: false })) : [];
    return rounds.length;
  }
  // Where the next shot would hit (for the aiming line), in vehicle coordinates
  function entryPoint(veh, shot, run) { const g = firstArmor(veh, shot, run && run.geo, run && run.gone); return g.length ? frameFor(shot).toV([g[0].x, 0]) : null; }

  // Bits flying through the inside: crew, ammo, fuel and engines soak up their energy (and get hurt by it).
  // A bit gives up a share of its energy that grows with how far it travels through a box; loose single bits always lose at least `soak`.
  // Returns what happened: ammo that just exploded, and an explosive shell bursting.
  function zoneTick(run, steps) {
    const sim = run.sim, fr = run.frame, h = sim.h, dtAcc = steps * sim.dt, mods = run.veh.modules;
    if (!run.zin || run.zin.length < sim.cap) { const z = new Int16Array(sim.cap).fill(-1); if (run.zin) z.set(run.zin.subarray(0, Math.min(run.zin.length, z.length))); run.zin = z; }
    const zin = run.zin, c = fr.c, s = fr.s, O = fr.O, out = {}, al = sim.alist;
    for (let q = 0, an = sim.an; q < an; q++) {
      const i = al[q];
      if (!sim.alive[i] || !sim.awake[i] || (sim.body[i] > 0 && sim.attached[i])) continue;
      const vx = sim.vx[i], vy = sim.vy[i], sp2 = vx * vx + vy * vy;
      if (sp2 < MIN_SPEED * MIN_SPEED) { zin[i] = -1; continue; }
      const x = O[0] + c * sim.px[i] - s * sim.py[i], y = O[1] + s * sim.px[i] + c * sim.py[i];
      let k = -1;
      for (let m = 0; m < mods.length; m++) { const md = mods[m]; if (x >= md.x && x <= md.x + md.w && y >= md.y && y <= md.y + md.h) { k = m; break; } }
      if (k < 0) { zin[i] = -1; continue; }
      const T = MODULES[mods[k].type], sp = Math.sqrt(sp2), e = 0.5 * sim.m[i] * sp2 / h;
      let lost = e * (1 - Math.exp(-sp * dtAcc / T.gap));
      if (zin[i] !== k && sim.nadj[i] === 0) lost += T.soak;
      if (lost > e) lost = e;
      run.dmg[k] += lost;
      const keep = Math.sqrt((e - lost) / e);
      sim.vx[i] = vx * keep; sim.vy[i] = vy * keep; zin[i] = k;
    }
    // ammo that's had enough goes off (once)
    const st = states(run);
    mods.forEach((m, k) => { if (m.type === 'ammo' && st[k] === 2 && !run.boomed.includes(k)) { run.boomed.push(k); (out.booms = out.booms || []).push(k); } });
    // an explosive-filled shell bursts a moment after it gets through (or as soon as it's stopped)
    for (const b of run.bursts) {
      const R = b.R;
      if (b.done || !R.everBehind || !R.penAt) continue;
      const r = sim.rounds.length > 1 ? sim.measureRound(R) : sim.measure(), sp = Math.hypot(r.vel[0], r.vel[1]);
      if ((sim.time - R.penAt) * Math.max(0.05, r.residual) >= b.fuse || sp < 0.08 || r.alive < 3) { burstShell(run, r.com, b.q, R); b.done = true; (out.bursts = out.bursts || []).push(fr.toV(r.com)); }
    }
    return out;
  }
  function burstShell(run, at, q, R) {
    const sim = run.sim;
    for (const [a, b] of R.parts) for (let i = a; i < b; i++) if (sim.body[i] === 0) sim.alive[i] = 0;   // the shell itself is gone…
    const nf = 90;
    for (let k = 0; k < nf; k++) {   // …into fast fragments, every which way
      const ang = (k + 0.37) / nf * Math.PI * 2, sp = 0.9 + 0.5 * ((k * 0.618) % 1);
      sim.addParticle(at[0] + Math.cos(ang) * 30, at[1] + Math.sin(ang) * 30, Math.cos(ang) * sp, Math.sin(ang) * sp, 'shot', 0, 1.2 * q);
    }
    blast(run, at[0], at[1], 450 * Math.cbrt(q), 0.05, { loose: 0, turret: false });
    sim.events.push({ type: 'flash', x: at[0], y: at[1], r: 400, t: sim.time, big: true });
  }
  // A blast inside the vehicle: things near it are thrown outward and torn loose. Turret plates fly off easily;
  // the heavy hull mostly stays, apart from the bits closest to the blast.
  function blast(run, x, y, R, dv, opt = {}) {
    const sim = run.sim, R2 = R * R, share = opt.loose == null ? 0.5 : opt.loose, heat = opt.heat || 500, turretToo = opt.turret !== false;
    for (let i = 0; i < sim.n; i++) {
      if (!sim.alive[i]) continue;
      const dx = sim.px[i] - x, dy = sim.py[i] - y, r2 = dx * dx + dy * dy, tur = turretToo && sim.body[i] > 0 && isTurret(run, sim.body[i]);
      if (r2 > R2 && !tur) continue;   // the whole turret lifts off its ring, however far it is
      const r = Math.sqrt(r2) || 1, f = tur ? Math.max(0.2, 1 - r / R) : 1 - r / R;
      const k = sim.body[i] === 0 || tur ? 1 : 0.3;
      sim.wake(i);
      sim.vx[i] += dx / r * dv * f * k; sim.vy[i] += dy / r * dv * f * k; sim.T[i] += heat * f;
      if (tur || sim.body[i] === 0 || r < R * share) { sim.loose[i] = 1; sim.ag[i] = 0; }
    }
  }
  function ammoBlast(run, k) {
    const m = run.veh.modules[k], c = run.frame.toE([m.x + m.w / 2, m.y + m.h / 2]);
    if (m.vent) blast(run, c[0], c[1], Math.max(m.w, m.h) * 0.9, 0.05, { loose: 1, turret: false, heat: 300 });   // blow-out panels: the blast goes out the top of the rack
    else blast(run, c[0], c[1], 1900, 0.16, { loose: 0.45, heat: 700 });
    run.sim.events.push({ type: 'flash', x: c[0], y: c[1], r: m.vent ? 600 : 1800, t: run.sim.time, big: true });
  }
  function states(run) {
    return run.veh.modules.map((m, k) => { const T = MODULES[m.type], d = run.dmg[k] / (m.tough || 1); return d >= T.hp[1] ? 2 : d >= T.hp[0] ? 1 : 0; });
  }
  function fateOf(run) {
    const st = states(run), fate = judge(run.veh, st);
    if (fate.id === 'destroyed') run.veh.modules.forEach((m, k) => { if (m.type === 'crew' && !m.capsule) st[k] = 2; });
    return { states: st, fate };
  }
  // Is anything still flying around inside? (the replay keeps going until it settles)
  function busy(run, min = 0.15) {   // bits faster than min (km/s) still flying around inside the vehicle
    const sim = run.sim, al = sim.alist, fr = run.frame, b = run.box || (run.box = bbox(run.veh, false));
    let fast = 0;
    for (let q = 0, an = sim.an; q < an; q++) {
      const i = al[q];
      if (!sim.alive[i] || !sim.awake[i] || (sim.body[i] > 0 && sim.attached[i])) continue;
      if (sim.vx[i] * sim.vx[i] + sim.vy[i] * sim.vy[i] < min * min) continue;
      const x = fr.O[0] + fr.c * sim.px[i] - fr.s * sim.py[i], y = fr.O[1] + fr.s * sim.px[i] + fr.c * sim.py[i];
      if (x > b[0] && x < b[1] && y > b[2] && y < b[3]) fast++;
    }
    return fast;
  }
  // After the hit has played out at the armor, shaking plates may settle sooner: only flying bits matter now
  function settle(run) { run.sim.sleepV2 = 0.004 * 0.004; run.sim.calmSteps = 25; }
  function unsettle(run) { run.sim.sleepV2 = 0.001 * 0.001; run.sim.calmSteps = 60; }

  // ---------- after the physics window: what's still flying keeps going in straight lines ----------
  // Slow bits take many milliseconds to cross a vehicle, far too long to simulate particle by particle, so after a short window
  // every loose piece flies on as one rigid lump: crew, ammo and engines along its path soak up its energy, and armor stops it.
  const AIR = 1200;   // µs of full physics after the hit
  function rayBox(px, py, dx, dy, x0, y0, x1, y1) {   // where a ray enters and leaves a box
    let t0 = 0, t1 = Infinity;
    for (const [p, d, lo, hi] of [[px, dx, x0, x1], [py, dy, y0, y1]]) {
      if (Math.abs(d) < 1e-12) { if (p < lo || p > hi) return null; continue; }
      let a = (lo - p) / d, b = (hi - p) / d; if (a > b) [a, b] = [b, a];
      if (a > t0) t0 = a; if (b < t1) t1 = b;
      if (t0 > t1) return null;
    }
    return [t0, t1];
  }
  function rayPoly(px, py, dx, dy, poly) {   // first place a ray meets a polygon (0 if it starts inside)
    if (E.inPoly(poly, px, py)) return 0;
    let best = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const ax = poly[j][0], ay = poly[j][1], ex = poly[i][0] - ax, ey = poly[i][1] - ay;
      const den = dx * ey - dy * ex; if (Math.abs(den) < 1e-12) continue;
      const t = ((ax - px) * ey - (ay - py) * ex) / den, u = ((ax - px) * dy - (ay - py) * dx) / den;
      if (t >= 0 && u >= 0 && u <= 1 && t < best) best = t;
    }
    return best;
  }
  // Fly a lump (energy e, kJ per mm of slice) along a ray; returns where it stops and what it went through (and records the damage)
  function flyLine(run, x, y, dx, dy, e, maxLen, fromInside) {
    const mods = run.veh.modules, hits = [];
    mods.forEach((m, k) => { const r = rayBox(x, y, dx, dy, m.x, m.y, m.x + m.w, m.y + m.h); if (r && r[0] <= maxLen && !(fromInside && r[0] === 0)) hits.push({ t: r[0], t1: r[1], k }); });
    let stop = maxLen;
    for (const g of run.geo) { const t = rayPoly(x + dx * 2, y + dy * 2, dx, dy, g.poly); if (t + 2 < stop) stop = t + 2; }
    if (dy < 0) stop = Math.min(stop, Math.max(0, -y / dy));   // the ground
    hits.sort((a, b) => a.t - b.t);
    const got = [];
    for (const h of hits) {
      if (h.t > stop || e <= 0) break;
      const T = MODULES[mods[h.k].type], chord = Math.min(h.t1, stop) - h.t;
      const lost = Math.min(e, e * (1 - Math.exp(-chord / T.gap)) + T.soak);
      run.dmg[h.k] += lost; got.push({ t: h.t, k: h.k, e: lost }); e -= lost;
      if (e <= 1e-5) { stop = h.t + chord * 0.5; break; }
    }
    return { x, y, dx, dy, stop, hits: got };
  }
  function launch(run) {
    const sim = run.sim, fr = run.frame, n = sim.n, h = sim.h, b = run.box || (run.box = bbox(run.veh, false));
    sim.findAttached();
    const uf = new Int32Array(n), mover = new Uint8Array(n);
    for (let i = 0; i < n; i++) uf[i] = i;
    const find = x => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
    for (let q = 0; q < sim.an; q++) {
      const i = sim.alist[q];
      if (!sim.alive[i] || !sim.awake[i] || (sim.body[i] > 0 && sim.attached[i])) continue;
      if (sim.vx[i] * sim.vx[i] + sim.vy[i] * sim.vy[i] > MIN_SPEED * MIN_SPEED) mover[i] = 1;
    }
    for (let k = 0; k < sim.nb; k++) { const i = sim.bi[k]; if (i < 0) continue; const j = sim.bj[k]; if (mover[i] && mover[j]) { const a = find(i), c = find(j); if (a !== c) uf[a] = c; } }
    const groups = new Map();
    for (let i = 0; i < n; i++) if (mover[i]) { const r = find(i); let g = groups.get(r); if (!g) groups.set(r, g = []); g.push(i); }
    const pieces = [], [p0] = sim.projRange;
    for (const idx of groups.values()) {
      let M = 0, X = 0, Y = 0, VX = 0, VY = 0, own = false;
      const P = idx.map(i => fr.toV([sim.px[i], sim.py[i]]));
      idx.forEach((i, k) => { const m = sim.m[i]; M += m; X += P[k][0] * m; Y += P[k][1] * m; const v = fr.dirV([sim.vx[i], sim.vy[i]]); VX += v[0] * m; VY += v[1] * m; if (sim.body[i] === 0 && i >= p0) own = true; });
      X /= M; Y /= M; VX /= M; VY /= M;
      const sp = Math.hypot(VX, VY);
      if (sp < MIN_SPEED || X < b[0] - 300 || X > b[1] + 300 || Y < -100 || Y > b[3] + 300) continue;   // too slow, or already outside the vehicle
      pieces.push({ idx, rel: P.map(p => [p[0] - X, p[1] - Y]), X, Y, dx: VX / sp, dy: VY / sp, sp, e: 0.5 * M * sp * sp / h, own, big: idx.length });
    }
    pieces.sort((a, c) => c.e - a.e);
    const out = { pieces: [], frags: [], bursts: [] }, mains = new Map();   // an explosive shell that hasn't gone off yet: its biggest piece → its burst
    for (const bu of run.bursts) {
      if (bu.done) continue;
      const p = pieces.find(p => p.own && p.big > 1 && !mains.has(p) && p.idx.some(i => bu.R.parts.some(([a, c]) => i >= a && i < c)));
      if (p) mains.set(p, bu);
    }
    for (const p of pieces.slice(0, 1200)) {
      let maxLen = 12000;
      const bu = mains.get(p);
      if (bu) maxLen = Math.max(0, bu.fuse - (bu.R.penAt ? (sim.time - bu.R.penAt) * p.sp : 0));
      const r = flyLine(run, p.X, p.Y, p.dx, p.dy, p.e, maxLen);
      Object.assign(p, { stop: r.stop, hits: r.hits });
      out.pieces.push(p);
      if (bu) {   // the explosive filling goes off where the shell got to
        const t = Math.max(0, r.stop - 20), bx = p.X + p.dx * t, by = p.Y + p.dy * t, q = bu.q;
        bu.done = true; out.bursts.push({ x: bx, y: by, at: t, piece: p });
        const R = 650 * Math.cbrt(q);
        run.veh.modules.forEach((m, k) => {   // the blast itself
          const ddx = Math.max(m.x - bx, 0, bx - (m.x + m.w)), ddy = Math.max(m.y - by, 0, by - (m.y + m.h)), d = Math.hypot(ddx, ddy);
          if (d < R) run.dmg[k] += 0.09 * q * (1 - d / R);
        });
        for (let k = 0; k < 72; k++) {   // and its fragments
          const a = (k + 0.37) / 72 * Math.PI * 2, f = flyLine(run, bx, by, Math.cos(a), Math.sin(a), 0.016 * q, 4000, true);
          f.delay = t; out.frags.push(f);
        }
      }
    }
    return out;
  }
  // Move the flying lumps to where they are after travelling d mm (vehicle frame), writing their particles back into the simulation
  function placeFlight(run, fl, dist) {
    const sim = run.sim, fr = run.frame;
    for (const p of fl.pieces) {
      const d = Math.min(p.stop, dist(p)), X = p.X + p.dx * d, Y = p.Y + p.dy * d;
      p.idx.forEach((i, k) => { const e = fr.toE([X + p.rel[k][0], Y + p.rel[k][1]]); sim.px[i] = e[0]; sim.py[i] = e[1]; });
    }
  }
  function landFlight(run, fl) {   // everything comes to rest where it stopped
    const sim = run.sim;
    placeFlight(run, fl, () => Infinity);
    for (const p of fl.pieces) for (const i of p.idx) { sim.vx[i] = 0; sim.vy[i] = 0; if (sim.awake[i]) sim.doze(i); }
    for (const b of fl.bursts) for (const i of b.piece.idx) sim.alive[i] = 0;   // the burst shells are gone
  }

  // ---------- debris: after a big blast, pieces fly off and fall with gravity ----------
  // The particle physics runs in microseconds; flying through the air takes seconds. So everything that's loose and moving becomes
  // a rigid piece (one per connected bit; the turret stays in one piece) that the page then throws in real time. Pieces land on
  // whatever stayed put (or the ground), bounce a little and tip over onto a flat side.
  const SHOW = 0.11;   // how fast pieces fly on screen, for each mm/µs they had (real blasts would throw them out of sight)
  const TOSS = 2.5;    // a turret is thrown harder than the rest (a real rack going up can throw it many metres)
  const CELL = 12;     // mm: the map of what stayed put
  function cornersOf(pts, tol, step) {   // points around the outside of a piece (its convex hull, every `step` mm): what it can land on
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 4) return p;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
    for (const q of p) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length > 1 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    let hull = lo.slice(0, -1).concat(up.slice(0, -1));
    for (let again = true; again && hull.length > 3;) {   // drop corners that hardly bend the outline
      again = false;
      for (let i = 0; i < hull.length && hull.length > 3; i++) {
        const a = hull[(i + hull.length - 1) % hull.length], b = hull[i], c = hull[(i + 1) % hull.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
        if (Math.abs(cross(a, c, b)) / L < tol) { hull.splice(i, 1); i--; again = true; }
      }
    }
    const out = [];
    hull.forEach((a, i) => {
      const b = hull[(i + 1) % hull.length], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step);
      for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
    });
    return out;
  }
  function solidMap(run, fly) {   // which 12 mm cells hold something that stayed put (each particle fills a square twice its size, so nothing lands overlapping it)
    const sim = run.sim, fr = run.frame, b = run.box || (run.box = bbox(run.veh, false)), r = sim.h;
    const x0 = b[0] - 8000, nx = Math.ceil((b[1] - b[0] + 16000) / CELL), ny = Math.ceil((b[3] + 6000) / CELL), cells = new Uint8Array(nx * ny);
    for (let i = 0; i < sim.n; i++) {
      if (!sim.alive[i] || fly[i] || sim.body[i] === 0 || !sim.attached[i] || sim.loose[i]) continue;   // bits lying around don't hold anything up
      const v = fr.toV([sim.px[i], sim.py[i]]);
      const ca = Math.max(0, Math.floor((v[0] - r - x0) / CELL)), cb = Math.min(nx - 1, Math.floor((v[0] + r - x0) / CELL));
      const ra = Math.max(0, Math.floor((v[1] - r) / CELL)), rb = Math.min(ny - 1, Math.floor((v[1] + r) / CELL));
      for (let y = ra; y <= rb; y++) for (let x = ca; x <= cb; x++) cells[y * nx + x] = 1;
    }
    const at = (x, y) => { if (y < 0) return true; const cx = Math.floor((x - x0) / CELL), cy = Math.floor(y / CELL); return cx >= 0 && cx < nx && cy < ny && cells[cy * nx + cx] === 1; };
    // how far to move a point up, or sideways, to get it out
    const up = (x, y) => { let t = Math.max(0, Math.floor(y / CELL) + 1) * CELL; while (at(x, t + 0.01) && t < ny * CELL) t += CELL; return t + 0.01 - y; };
    const side = (x, y, dir) => { let k = 0; while (at(x + dir * k * CELL, y) && k < 40) k++; const cx = Math.floor((x + dir * k * CELL - x0) / CELL); return Math.abs((dir > 0 ? cx : cx + 1) * CELL + x0 - x) + 1; };
    return { at, up, side };
  }
  function makeDebris(run) {
    const sim = run.sim, fr = run.frame, n = sim.n;
    sim.findAttached();
    const uf = new Int32Array(n); for (let i = 0; i < n; i++) uf[i] = i;
    const find = x => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
    const join = (a, b) => { a = find(a); b = find(b); if (a !== b) uf[a] = b; };
    const fly = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (sim.alive[i] && (sim.loose[i] || (sim.body[i] > 0 && !sim.attached[i])) && sim.vx[i] * sim.vx[i] + sim.vy[i] * sim.vy[i] > 1e-6) fly[i] = 1;
    for (let b = 0; b < sim.nb; b++) { const i = sim.bi[b]; if (i < 0) continue; const j = sim.bj[b]; if (fly[i] && fly[j]) join(i, j); }
    let tRoot = -1;
    for (let i = 0; i < n; i++) if (fly[i] && sim.body[i] > 0 && isTurret(run, sim.body[i])) { if (tRoot < 0) tRoot = i; else join(i, tRoot); }
    // plates that mostly flew away aren't there to hit any more
    const tot = new Int32Array(sim.plates.length + 1), flew = new Int32Array(sim.plates.length + 1);
    for (let i = 0; i < n; i++) if (sim.alive[i] && sim.body[i] > 0) { tot[sim.body[i]]++; flew[sim.body[i]] += fly[i]; }
    run.gone = run.gone || [];
    sim.plates.forEach((pl, b) => { if (tot[b + 1] && flew[b + 1] > tot[b + 1] * 0.5) run.gone[pl.part] = true; });
    const groups = new Map();
    for (let i = 0; i < n; i++) { if (!fly[i]) continue; const r = find(i); let g = groups.get(r); if (!g) groups.set(r, g = []); g.push(i); }
    const pieces = [], tKey = tRoot >= 0 ? find(tRoot) : -2, deco = decoOf(run.veh), barrel = deco && deco.barrel;
    for (const [root, idx] of groups) {
      let M = 0, X = 0, Y = 0, VX = 0, VY = 0;
      const P = idx.map(i => fr.toV([sim.px[i], sim.py[i]])), Vv = idx.map(i => fr.dirV([sim.vx[i], sim.vy[i]]));
      idx.forEach((i, k) => { const m = sim.m[i]; M += m; X += P[k][0] * m; Y += P[k][1] * m; VX += Vv[k][0] * m; VY += Vv[k][1] * m; });
      X /= M; Y /= M; VX /= M; VY /= M;
      let Lz = 0, I = 0;
      idx.forEach((i, k) => { const m = sim.m[i], rx = P[k][0] - X, ry = P[k][1] - Y; Lz += m * (rx * (Vv[k][1] - VY) - ry * (Vv[k][0] - VX)); I += m * (rx * rx + ry * ry); });
      const turret = root === tKey, show = SHOW * 1e6 * (turret ? TOSS : 1);
      let vx = VX * show, vy = VY * show;
      const sp = Math.hypot(vx, vy), cap = turret ? 7500 : 15000, spin = turret ? 3 : 7;   // a light turret mustn't fly out of sight
      if (sp > cap) { vx *= cap / sp; vy *= cap / sp; }
      const w = I > 0 ? Math.max(-spin, Math.min(spin, Lz / I * show)) : 0, rel = P.map(p => [p[0] - X, p[1] - Y]);
      const pts = idx.length < 4 ? [[0, 0]] : cornersOf(rel, 2 * sim.h, 80);
      if (turret && barrel) for (const s of [-0.5, 0.5]) pts.push([barrel.x1 - X, barrel.y + s * barrel.d - Y]);   // the gun barrel lands too
      pieces.push({ idx, rel, X, Y, X0: X, Y0: Y, vx, vy, a: 0, w, rest: false, turret, big: idx.length, pts, free: new Uint8Array(pts.length), still: 0,
        iM: 1 / M, iI: idx.length < 4 || I <= 0 ? 0 : 1 / I, R: Math.max(1, ...pts.map(q => Math.hypot(q[0], q[1]))) });
    }
    const map = solidMap(run, fly), b = run.box;
    for (const p of pieces) p.pts.forEach((q, k) => { p.free[k] = map.at(p.X + q[0], p.Y + q[1]) ? 0 : 1; });   // corners that start inside something (where they broke off) can't land on it
    return { pieces, t: 0, done: false, map, x0: b[0] - 7000, x1: b[1] + 7000 };
  }
  function stepDebris(run, deb, dt) {
    const sim = run.sim, fr = run.frame, map = deb.map, g = 9810, SUB = 4, h = dt / SUB;
    let moving = 0;
    for (const p of deb.pieces) {
      if (p.rest) continue;
      moving++;
      for (let sub = 0; sub < SUB && !p.rest; sub++) {
        const ox = p.X, oy = p.Y, oa = p.a;
        p.vy -= g * h; p.X += p.vx * h; p.Y += p.vy * h; p.a += p.w * h;
        const c = Math.cos(p.a), s = Math.sin(p.a), c0 = Math.cos(oa), s0 = Math.sin(oa);
        let touch = false, lift = 0, drop = 0, pushX = 0;
        p.age = (p.age || 0) + h;
        for (let k = 0; k < p.pts.length; k++) {
          const r = p.pts[k], rx = c * r[0] - s * r[1], ry = s * r[0] + c * r[1];
          let x = p.X + rx, y = p.Y + ry;
          const qx = ox + c0 * r[0] - s0 * r[1], qy = oy + s0 * r[0] + c0 * r[1];
          // sweep from where it was, so fast pieces can't skip through a thin plate
          const steps = Math.min(40, Math.ceil(Math.hypot(x - qx, y - qy) / (CELL / 2)));
          let hit = false, px = qx, py = qy;
          for (let j = 1; j <= steps; j++) {
            const sx = qx + (x - qx) * j / steps, sy = qy + (y - qy) * j / steps;
            if (sy < 0 || (p.free[k] && map.at(sx, sy))) { hit = true; x = sx; y = sy; break; }   // the ground always counts
            px = sx; py = sy;
          }
          if (!hit) { if (!p.free[k] && !map.at(x, y)) p.free[k] = 1; continue; }
          touch = true;
          let nx = 0, ny = 1;
          const endX = p.X + rx, endY = p.Y + ry;
          if (map.at(px, y) || !map.at(x, py)) {   // came down onto it (or up into it)
            if (y <= py) lift = Math.max(lift, y + map.up(x, y) - endY); else { ny = -1; drop = Math.min(drop, py - endY); }
          } else {   // ran into it sideways
            nx = px < x ? -1 : 1; ny = 0;
            const d = x + nx * map.side(x, y, nx) - endX; if (Math.abs(d) > Math.abs(pushX)) pushX = d;
          }
          // bounce and friction at that corner (it can make the piece tip over)
          const vcx = p.vx - p.w * ry, vcy = p.vy + p.w * rx, vn = vcx * nx + vcy * ny;
          if (vn < 0) {
            const rn = rx * ny - ry * nx, jn = -(vn < -600 && p.big >= 60 ? 1.25 : 1) * vn / (p.iM + rn * rn * p.iI);   // only big pieces landing hard bounce
            const tx = -ny, ty = nx, vt = vcx * tx + vcy * ty, rt = rx * ty - ry * tx;
            let jt = -vt / (p.iM + rt * rt * p.iI); const lim = 0.6 * jn; jt = Math.max(-lim, Math.min(lim, jt));
            p.vx += (jn * nx + jt * tx) * p.iM; p.vy += (jn * ny + jt * ty) * p.iM; p.w += (rn * jn + rt * jt) * p.iI;
          }
        }
        if (touch) {
          p.Y += lift > 0 ? lift : drop; p.X += pushX; p.touchAt = p.age;
          if (p.big < 60) { p.w *= 0.8; p.vx *= 0.9; } else p.w *= 0.98;   // small bits don't roll far
        }
        if (p.X < deb.x0 || p.X > deb.x1) { dropDown(p, map); p.rest = true; p.vx = p.vy = p.w = 0; }   // thrown right out of the picture
        // at rest once it's been slow (and touching something) for a little while
        if (p.touchAt != null && p.age - p.touchAt < 0.1 && Math.hypot(p.vx, p.vy) < 220 && Math.abs(p.w) * p.R < 220) { if (++p.still > 12) { p.rest = true; p.vx = p.vy = p.w = 0; } }
        else p.still = 0;
      }
      const c = Math.cos(p.a), s = Math.sin(p.a);
      p.idx.forEach((i, k) => {
        const r = p.rel[k], e = fr.toE([p.X + c * r[0] - s * r[1], p.Y + s * r[0] + c * r[1]]);
        sim.px[i] = e[0]; sim.py[i] = e[1];
      });
    }
    deb.t += dt;
    if (!moving || deb.t > 4.5) {   // done: everything stays where it landed (anything still in the air drops straight down)
      for (const p of deb.pieces) {
        if (!p.rest) { dropDown(p, map); p.rest = true; p.vx = p.vy = p.w = 0; }
        const c = Math.cos(p.a), s = Math.sin(p.a);
        p.idx.forEach((i, k) => {
          const r = p.rel[k], e = fr.toE([p.X + c * r[0] - s * r[1], p.Y + s * r[0] + c * r[1]]);
          sim.px[i] = e[0]; sim.py[i] = e[1]; sim.vx[i] = 0; sim.vy[i] = 0; sim.ax[i] = e[0]; sim.ay[i] = e[1]; if (sim.awake[i]) sim.doze(i);
        });
      }
      deb.done = true;
    }
  }
  function dropDown(p, map) {   // move a piece straight down until one of its corners lands on something
    const c = Math.cos(p.a), s = Math.sin(p.a);
    let fall = Infinity;
    p.pts.forEach((r, k) => {
      const x = p.X + c * r[0] - s * r[1], y = p.Y + s * r[0] + c * r[1];
      if (!p.free[k] && map.at(x, y)) return;   // still stuck where it broke off
      let yy = y - CELL / 2;
      while (yy > 0 && !map.at(x, yy)) yy -= CELL / 2;
      fall = Math.min(fall, Math.max(0, y - Math.max(0, (Math.floor(yy / CELL) + 1) * CELL)));
    });
    if (isFinite(fall)) p.Y -= fall;
  }
  // Where the turret is now (so the gun barrel and the crew boxes can go with it)
  function turretMove(deb) {
    const p = deb && deb.pieces.find(q => q.turret);
    return p ? { x0: p.X0, y0: p.Y0, x: p.X, y: p.Y, a: p.a } : null;
  }

  function judge(veh, states) {
    const ms = veh.modules, of = t => ms.map((m, k) => (m.type === t ? states[k] : -1)).filter(s => s >= 0);
    const crew = of('crew'), crewKO = crew.filter(s => s === 2).length;
    const boom = ms.some((m, k) => m.type === 'ammo' && states[k] === 2 && !m.vent), vented = ms.some((m, k) => m.type === 'ammo' && states[k] === 2 && m.vent);
    const any = states.some(s => s > 0);
    if (boom) {
      const safe = ms.filter((m, k) => m.type === 'crew' && m.capsule && states[k] < 2).length;   // crew in an armored capsule can live through it
      return safe ? { id: 'destroyed', badge: '💥 DESTROYED', st: 'crit', text: `The ammo exploded and wrecked it, but the armored capsule kept ${safe === crew.length ? 'the crew' : `${safe} of the ${crew.length} crew`} alive.`, saved: safe }
        : { id: 'destroyed', badge: '💥 DESTROYED', st: 'crit', text: 'The ammo exploded. Nobody inside could survive that.' };
    }
    if (crew.length && crewKO > crew.length / 2) return { id: 'knocked', badge: '☠️ KNOCKED OUT', st: 'crit', text: 'Too few crew are left to keep fighting.' };
    if (of('fuel').some(s => s === 2)) return { id: 'fire', badge: '🔥 ON FIRE', st: 'serious', text: 'A fuel tank caught fire. The crew will have to get out.', vented };
    if (of('engine').concat(of('trans')).some(s => s === 2)) return { id: 'stuck', badge: '🛑 IMMOBILIZED', st: 'serious', text: 'It can\'t drive any more, but it can still shoot.', vented };
    if (of('gun').some(s => s === 2)) return { id: 'nogun', badge: '🎯 GUN KNOCKED OUT', st: 'serious', text: 'Its gun is wrecked, so it can\'t shoot back.', vented };
    if (vented) return { id: 'vented', badge: '🔧 DAMAGED', st: 'warn', text: 'The ammo rack blew up, but the blow-out panels sent the blast outside and saved the crew.', vented };
    if (any) return { id: 'damaged', badge: '🔧 DAMAGED', st: 'warn', text: 'Some things inside were hit, but it can still fight.' };
    return { id: 'fine', badge: '🛡️ NO DAMAGE', st: 'good', text: 'Nothing inside was hurt.' };
  }

  // ---------- your own vehicles: checking, saving and sharing ----------
  const num = (v, lo, hi, d = 0) => { v = +v; return isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d; };
  const str = (v, n, d) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : d);
  function sanitize(v) {
    if (!v || typeof v !== 'object') return null;
    const C = 15000;
    const parts = (Array.isArray(v.parts) ? v.parts : []).slice(0, 40).map(p => ({
      n: str(p && p.n, 40, 'Armor plate'), a: [num(p && p.a && p.a[0], -C, C), num(p && p.a && p.a[1], -C, C)], b: [num(p && p.b && p.b[0], -C, C), num(p && p.b && p.b[1], -C, C)],
      g: p && p.g === 't' ? 't' : 'h',
      layers: (Array.isArray(p && p.layers) ? p.layers : []).slice(0, 8).filter(l => l && E.MATERIALS[l.mat]).map(l => ({ mat: l.mat, t: num(l.t, 1, 1000, 20) })),
    })).filter(p => p.layers.length && (p.a[0] !== p.b[0] || p.a[1] !== p.b[1]));
    const modules = (Array.isArray(v.modules) ? v.modules : []).slice(0, 30).filter(m => m && MODULES[m.type]).map(m => {
      const o = { type: m.type, n: str(m.n, 40, MODULES[m.type].name), x: num(m.x, -C, C), y: num(m.y, -C, C), w: num(m.w, 60, 8000, 400), h: num(m.h, 60, 8000, 400) };
      if (m.type === 'gun') o.barrel = num(m.barrel, 0, 8000, 0);
      if (m.type === 'ammo' && m.vent) o.vent = true;
      if (m.type === 'crew' && m.capsule) o.capsule = true;
      return o;
    });
    if (!parts.length) return null;
    const out = { id: str(v.id, 40, 'my-' + Math.random().toString(36).slice(2, 9)).replace(/[^\w-]/g, ''), name: str(v.name, 40, 'My vehicle'), group: 'My vehicles', mine: true, parts, modules, tracks: v.tracks !== false };
    if (Array.isArray(v.aim)) out.aim = [num(v.aim[0], -C, C), num(v.aim[1], -C, C)];
    return out;
  }
  // Short text versions for links: plates as [name, ax, ay, bx, by, turret?, mat, t, mat, t…]
  function pack(v) {
    return { n: v.name, t: v.tracks === false ? 0 : 1, p: v.parts.map(p => [p.n, p.a[0], p.a[1], p.b[0], p.b[1], p.g === 't' ? 1 : 0, ...p.layers.flatMap(l => [l.mat, l.t])]),
      m: v.modules.map(m => [m.type, m.n, m.x, m.y, m.w, m.h, m.type === 'gun' ? m.barrel || 0 : m.vent || m.capsule ? 1 : 0]) };
  }
  function unpack(o) {
    if (!o || !Array.isArray(o.p)) return null;
    return sanitize({ name: o.n, tracks: o.t !== 0,
      parts: o.p.map(a => ({ n: a[0], a: [a[1], a[2]], b: [a[3], a[4]], g: a[5] ? 't' : 'h', layers: Array.from({ length: Math.floor((a.length - 6) / 2) }, (_, k) => ({ mat: a[6 + 2 * k], t: a[7 + 2 * k] })) })),
      modules: (o.m || []).map(a => ({ type: a[0], n: a[1], x: a[2], y: a[3], w: a[4], h: a[5], barrel: a[0] === 'gun' ? a[6] : 0, vent: a[0] === 'ammo' && a[6] === 1, capsule: a[0] === 'crew' && a[6] === 1 })) });
  }
  function toLink(v) {
    const s = JSON.stringify(pack(v)), bytes = new TextEncoder().encode(s);
    let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromLink(code) {
    try {
      const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/')), bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
      return unpack(JSON.parse(new TextDecoder().decode(bytes)));
    } catch (e) { return null; }
  }
  // A simple starting shape for a brand-new vehicle
  function starter() {
    return sanitize({
      name: 'My tank', parts: [
        ...chain('h', [[500, 450], [0, 950], [900, 1600], [4800, 1600], [5000, 450]], [['Lower front', L('rha', 50)], ['Upper front', L('rha', 60)], ['Roof', L('rha', 20)], ['Rear', L('rha', 30)], ['Belly', L('rha', 20)]], true),
        ...chain('t', [[1700, 1630], [1700, 2400], [3600, 2400], [3700, 1630]], [['Turret front', L('rha', 80)], ['Turret roof', L('rha', 25)], ['Turret rear', L('rha', 40)]]),
      ],
      modules: [M('crew', 'Driver', 1100, 520, 1550, 1450), M('crew', 'Gunner', 1900, 1400, 2350, 2300), M('crew', 'Commander', 2700, 1500, 3200, 2350),
        M('ammo', 'Ammo', 1700, 520, 3200, 850), M('gun', 'Gun', 1700, 1950, 2700, 2120, { barrel: 2600 }), M('engine', 'Engine', 3600, 520, 4700, 1450), M('fuel', 'Fuel tank', 3250, 520, 3550, 1300)],
    });
  }

  return { MODULES, MOD_KEYS, VEHICLES, geometry, layerBands, bbox, decoOf, trackLoop, shotAngle, frameFor, crossings, firstArmor, probe, entryPoint, buildVehicle, pickVehH, aimShot, zoneTick, ammoBlast, blast, states, fateOf, busy, settle, unsettle, AIR, launch, placeFlight, landFlight, flyLine, makeDebris, stepDebris, turretMove, isTurret, judge, sanitize, pack, unpack, toLink, fromLink, starter };
});
