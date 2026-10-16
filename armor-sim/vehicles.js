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

  // ✏️ Vehicle cut-aways. Real ones use rough public armor numbers and simplified insides; the made-up ones are made up.
  const VEHICLES = [
    {
      id: 'tiger', name: 'Tiger I', group: 'WW2 tanks (approx.)', year: 1942, from: 'Germany', aim: [565, 1500],
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
      deco: { track: [-60, 6230, 1120], wheels: [[330, 860, 330], ...wheelsRow(1000, 5200, 8, 400, 420), [5900, 760, 300]], barrel: { x0: 1250, x1: -2150, y: 2400, d: 130, brake: true } },
    },
    {
      id: 'panther', name: 'Panther Ausf. G', group: 'WW2 tanks (approx.)', year: 1944, from: 'Germany', aim: [560, 1405],
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
      deco: { track: [-120, 6820, 1060], wheels: [[250, 880, 330], ...wheelsRow(850, 5900, 8, 430, 450), [6550, 820, 300]], barrel: { x0: 1700, x1: -1950, y: 2340, d: 100, brake: true } },
    },
    {
      id: 'pz4', name: 'Panzer IV Ausf. H', group: 'WW2 tanks (approx.)', year: 1943, from: 'Germany', aim: [600, 1380],
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
      deco: { track: [-40, 5850, 820], wheels: [[200, 640, 270], ...wheelsRow(700, 5000, 8, 235, 260), [5550, 600, 250]], barrel: { x0: 1550, x1: -1130, y: 2120, d: 85, brake: true } },
    },
    {
      id: 't34', name: 'T-34-85', group: 'WW2 tanks (approx.)', year: 1944, from: 'Soviet Union', aim: [700, 1240],
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
      deco: { track: [-60, 6060, 900], wheels: [[150, 600, 300], ...wheelsRow(800, 5100, 5, 415, 420), [5800, 620, 300]], barrel: { x0: 1450, x1: -1600, y: 2150, d: 100, brake: false } },
    },
    {
      id: 'sherman', name: 'M4A3E8 Sherman', group: 'WW2 tanks (approx.)', year: 1944, from: 'USA', aim: [500, 1600],
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
      deco: { track: [-100, 5900, 900], wheels: [[150, 620, 300], ...wheelsRow(800, 5000, 6, 260, 280), [5600, 600, 280]], barrel: { x0: 1650, x1: -1450, y: 2470, d: 95, brake: true } },
    },
    {
      id: 'is2', name: 'IS-2', group: 'WW2 tanks (approx.)', year: 1944, from: 'Soviet Union', aim: [550, 1270],
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
      deco: { track: [-60, 6650, 860], wheels: [[150, 620, 300], ...wheelsRow(800, 5700, 6, 280, 300), [6400, 640, 300]], barrel: { x0: 1450, x1: -1750, y: 2150, d: 140, brake: true } },
    },
    {
      id: 't55', name: 'T-55', group: 'Cold War tanks (approx.)', year: 1958, from: 'Soviet Union', aim: [640, 1200],
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
      deco: { track: [-80, 6150, 850], wheels: [[150, 560, 290], ...wheelsRow(750, 5200, 5, 405, 410), [5900, 600, 280]], barrel: { x0: 1500, x1: -2800, y: 1900, d: 115, brake: false, evac: -1900 } },
    },
    {
      id: 't72', name: 'T-72 Ural', group: 'Cold War tanks (approx.)', year: 1973, from: 'Soviet Union', aim: [1000, 1300],
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
      deco: { track: [-80, 6900, 800], wheels: [[150, 560, 280], ...wheelsRow(800, 5800, 6, 375, 380), [6650, 560, 280]], barrel: { x0: 2400, x1: -2580, y: 1990, d: 135, brake: false } },
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
      deco: { track: [-60, 7250, 880], wheels: [[150, 600, 300], ...wheelsRow(850, 6200, 7, 320, 340), [7000, 620, 280]], barrel: { x0: 2250, x1: -2900, y: 2150, d: 150, brake: false } },
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
      deco: { track: [-40, 4950, 780], wheels: [[150, 560, 240], ...wheelsRow(700, 4300, 5, 300, 300), [4700, 560, 220]] },
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
      if (d.track) { add(d.track[0], 0); add(d.track[1], d.track[2]); }
      if (d.barrel) { add(d.barrel.x1, d.barrel.y - d.barrel.d); add(d.barrel.x0, d.barrel.y + d.barrel.d); }
    }
    if (!isFinite(x0)) return [0, 1000, 0, 1000];
    return [x0, x1, y0, y1];
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
      d.track = [x0 - 60, x1 + 60, Math.min(yb + r * 1.1, yb + 450)];
      d.wheels = wheelsRow(x0 + r * 1.3, x1 - r * 1.3, n, r, r);
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
  function crossings(veh, shot, geo) {
    geo = geo || geometry(veh);
    const fr = frameFor(shot), out = [];
    veh.parts.forEach((p, i) => {
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
  function firstArmor(veh, shot, geo) {
    const hits = crossings(veh, shot, geo), group = [];
    let back = -Infinity;
    for (const h of hits) {
      if (group.length && (h.x - back > GAP || group.length >= 4)) break;
      group.push(h); back = Math.max(back, h.x + h.T / Math.max(0.15, h.cos));
    }
    return group;
  }
  // Info for the "aiming at" line: the plate, how thick, at what angle, and how much steel is in the way
  function probe(veh, shot) {
    const g = firstArmor(veh, shot);
    if (!g.length) return null;
    return g.map(h => ({ name: h.part.n, T: h.T, ang: Math.round(Math.acos(Math.min(1, h.cos)) / DEG), los: Math.round(h.T / Math.max(0.05, h.cos)), layers: h.part.layers }));
  }

  // ---------- building the simulation for one shot ----------
  function buildShot(veh, shot, P, budget) {
    const geo = geometry(veh), fr = frameFor(shot), group = firstArmor(veh, shot, geo);
    if (!group.length) return null;
    const cal = E.projCal(P), cuts = [];
    const plates = group.map(h => {
      const p = h.part, g = geo[h.i], f = g.f, T = f.T;
      const want = Math.max(6 * cal, 0.45 * T, 120) / Math.max(0.35, h.cos);
      const sHit = h.k * f.len;
      let s0 = sHit - want / 2, s1 = sHit + want / 2;
      if (s0 < 0) { s1 = Math.min(f.len, s1 - s0); s0 = 0; }
      if (s1 > f.len) { s0 = Math.max(0, s0 - (s1 - f.len)); s1 = f.len; }
      const atA = s0 < 1e-6, atB = s1 > f.len - 1e-6;
      const oa = lerp(p.a, p.b, s0 / f.len), ob = lerp(p.a, p.b, s1 / f.len);
      const ia = atA ? g.poly[3] : [oa[0] + f.n[0] * T, oa[1] + f.n[1] * T], ib = atB ? g.poly[2] : [ob[0] + f.n[0] * T, ob[1] + f.n[1] * T];
      const cut = [oa, ob, ib, ia];
      cuts.push({ i: h.i, s0, s1, cut, atA, atB });
      const mid = lerp(oa, ob, 0.5), c = fr.toE(mid), cE = cut.map(fr.toE);
      const reach = Math.max(...cut.map(q => Math.abs((q[0] - mid[0]) * f.t[0] + (q[1] - mid[1]) * f.t[1])));   // the rectangle must cover the whole cut outline
      return {
        cx: c[0], cy: c[1], ang: Math.atan2(-h.nE[1], h.nE[0]) / DEG, len: 2 * reach + 2, layers: clone(p.layers),
        clip: { poly: cE, ends: [[...cE[1], ...cE[2]], [...cE[3], ...cE[0]]] }, name: p.n, part: h.i,
      };
    });
    const scene = { plates, proj: { ...P, aim: 0 }, pad: 700, trackGone: true };
    scene.h = E.pickH(scene, budget);
    // everything else stays solid (drawn, and stops bits flying around inside)
    const statics = [];
    geo.forEach((g, i) => {
      const c = cuts.find(k => k.i === i), p = veh.parts[i];
      if (!c) { statics.push({ i, poly: g.poly }); return; }
      const f = g.f, [a, b, ib, ia] = g.poly;
      if (!c.atA) statics.push({ i, poly: [a, c.cut[0], c.cut[3], ia] });
      if (!c.atB) statics.push({ i, poly: [c.cut[1], b, ib, c.cut[2]] });
      void p; void f;
    });
    return { scene, fr, group, cuts, statics, geo };
  }

  // ---------- after the hit: follow everything that's flying into the vehicle ----------
  const MIN_SPEED = 0.06;   // km/s: slower bits don't hurt anything
  function rayBox(px, py, dx, dy, x0, y0, x1, y1) {   // where a ray enters (and leaves) a box
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
  // Fly one bit (energy e in kJ per mm of slice) along a ray through the vehicle; it stops in armor or when it runs out of energy
  function castRay(st, x, y, dx, dy, e, maxLen, fromInside) {
    const hits = [];
    st.mods.forEach((m, k) => {
      const r = rayBox(x, y, dx, dy, m.x, m.y, m.x + m.w, m.y + m.h);
      if (r && r[0] <= maxLen && !(fromInside && r[0] === 0)) hits.push({ t: r[0], t1: r[1], k });   // a burst's own box was already hit by the blast
    });
    let stop = maxLen;
    for (const s of st.statics) { const t = rayPoly(x, y, dx, dy, s.poly); if (t < stop) stop = t; }
    if (dy < 0) stop = Math.min(stop, Math.max(0, -y / dy));   // the ground
    hits.sort((a, b) => a.t - b.t);
    const got = [];
    for (const h of hits) {
      if (h.t > stop || e <= 0) break;
      const m = st.mods[h.k], T = MODULES[m.type], chord = Math.min(h.t1, stop) - h.t;
      const share = 1 - Math.exp(-chord / T.gap), lost = Math.min(e, e * share + T.soak);
      st.dmg[h.k] += lost; got.push({ t: h.t, k: h.k, e: lost });
      e -= lost;
      if (e <= 1e-5) { stop = h.t + chord * Math.min(1, lost ? (e * share) / lost + 0.3 : 0.3); break; }
    }
    return { x, y, dx, dy, stop, hits: got };
  }
  function afterShot(veh, shot, built, sim, P) {
    sim.findAttached();
    const { fr } = built, N = sim.n, h = sim.h;
    const st = { mods: veh.modules, statics: built.statics, dmg: veh.modules.map(() => 0) };
    // 1) group the loose bits into chunks (a whole shell, a plug of armor, single fragments…)
    const uf = new Int32Array(N), free = new Uint8Array(N);
    for (let i = 0; i < N; i++) { uf[i] = i; free[i] = sim.alive[i] && (sim.body[i] === 0 || !sim.attached[i]) ? 1 : 0; }
    const find = x => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
    for (let b = 0; b < sim.nb; b++) { const i = sim.bi[b]; if (i < 0) continue; const j = sim.bj[b]; if (free[i] && free[j]) { const a = find(i), c = find(j); if (a !== c) uf[a] = c; } }
    const acc = new Map();
    const addTo = (key, i) => {
      let c = acc.get(key); if (!c) acc.set(key, c = { m: 0, x: 0, y: 0, vx: 0, vy: 0, n: 0, proj: false });
      const m = sim.m[i]; c.m += m; c.x += sim.px[i] * m; c.y += sim.py[i] * m; c.vx += sim.vx[i] * m; c.vy += sim.vy[i] * m; c.n++;
      if (sim.body[i] === 0) c.proj = true;
    };
    for (let i = 0; i < N; i++) if (free[i]) addTo(find(i), i);
    for (const i of sim.gone || []) addTo('g' + i, i);
    const chunks = [];
    for (const c of acc.values()) {
      c.x /= c.m; c.y /= c.m; c.vx /= c.m; c.vy /= c.m;
      const sp = Math.hypot(c.vx, c.vy);
      if (sp < MIN_SPEED) continue;
      c.e = 0.5 * c.m * sp * sp / h; c.sp = sp;
      chunks.push(c);
    }
    chunks.sort((a, b) => b.e - a.e);
    // 2) fly them through the vehicle
    const rays = [];
    let main = chunks.find(c => c.proj && c.n > 1) || null;
    for (const c of chunks.slice(0, 1500)) {
      const p = fr.toV([c.x, c.y]), d = fr.dirV([c.vx / c.sp, c.vy / c.sp]);
      let maxLen = 12000, fuse = null;
      if (c === main && P.aphe && sim.everBehind) maxLen = P.aphe.fuse;   // it'll go off after a short way (or when it hits something)
      const r = castRay(st, p[0], p[1], d[0], d[1], c.e, maxLen);
      r.proj = c.proj; r.big = c.n > 3; r.e = c.e;
      if (c === main && P.aphe && sim.everBehind) { fuse = Math.min(r.stop, P.aphe.fuse); r.fuse = fuse; }
      rays.push(r);
    }
    // 3) explosive-filled shells burst inside
    let burst = null;
    const mr = main && rays.find(r => r.fuse != null);
    if (mr) {
      const t = Math.max(0, mr.fuse - 30), bx = mr.x + mr.dx * t, by = mr.y + mr.dy * t, q = P.aphe.charge, R = 650 * Math.cbrt(q);
      burst = { x: bx, y: by, r: R, at: t };
      veh.modules.forEach((m, k) => {   // the blast itself
        const dx = Math.max(m.x - bx, 0, bx - (m.x + m.w)), dy = Math.max(m.y - by, 0, by - (m.y + m.h)), d = Math.hypot(dx, dy);
        if (d < R) st.dmg[k] += 0.09 * q * (1 - d / R);
      });
      for (let k = 0; k < 72; k++) {   // and its fragments
        const a = (k + 0.37) / 72 * Math.PI * 2, r = castRay(st, bx, by, Math.cos(a), Math.sin(a), 0.016 * q, 4000, true);
        r.frag = true; r.delay = t; rays.push(r);
      }
    }
    // 4) what state is everything in?
    const states = veh.modules.map((m, k) => { const T = MODULES[m.type], d = st.dmg[k] / (m.tough || 1); return d >= T.hp[1] ? 2 : d >= T.hp[0] ? 1 : 0; });
    const fate = judge(veh, states);
    if (fate.id === 'destroyed') veh.modules.forEach((m, k) => { if (m.type === 'crew') states[k] = 2; });
    return { rays, burst, states, dmg: st.dmg, fate, chunks: chunks.length };
  }
  function judge(veh, states) {
    const ms = veh.modules, of = t => ms.map((m, k) => (m.type === t ? states[k] : -1)).filter(s => s >= 0);
    const crew = of('crew'), crewKO = crew.filter(s => s === 2).length;
    const boom = ms.some((m, k) => m.type === 'ammo' && states[k] === 2 && !m.vent), vented = ms.some((m, k) => m.type === 'ammo' && states[k] === 2 && m.vent);
    const any = states.some(s => s > 0);
    if (boom) return { id: 'destroyed', badge: '💥 DESTROYED', st: 'crit', text: 'The ammo exploded. Nobody inside could survive that.' };
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
      m: v.modules.map(m => [m.type, m.n, m.x, m.y, m.w, m.h, m.type === 'gun' ? m.barrel || 0 : m.vent ? 1 : 0]) };
  }
  function unpack(o) {
    if (!o || !Array.isArray(o.p)) return null;
    return sanitize({ name: o.n, tracks: o.t !== 0,
      parts: o.p.map(a => ({ n: a[0], a: [a[1], a[2]], b: [a[3], a[4]], g: a[5] ? 't' : 'h', layers: Array.from({ length: Math.floor((a.length - 6) / 2) }, (_, k) => ({ mat: a[6 + 2 * k], t: a[7 + 2 * k] })) })),
      modules: (o.m || []).map(a => ({ type: a[0], n: a[1], x: a[2], y: a[3], w: a[4], h: a[5], barrel: a[0] === 'gun' ? a[6] : 0, vent: a[0] === 'ammo' && a[6] === 1 })) });
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

  return { MODULES, MOD_KEYS, VEHICLES, geometry, layerBands, bbox, decoOf, shotAngle, frameFor, crossings, firstArmor, probe, buildShot, afterShot, judge, sanitize, pack, unpack, toLink, fromLink, starter, castRay };
});
