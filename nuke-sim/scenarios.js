// Nuke Sim: the scenarios (who fires what, from where, at what, and when).
//
//   NS.SCENARIOS                     → [{ id, name, blurb }] for the menu (the first one is the default)
//   NS.buildScenario(id, { seed })   → { id, name, blurb, sides, strikes, phases, view, labels, sites, end }
//
// Every scenario is built from the shared data (data/targets.js, data/cities.js) with a seeded random number
// generator, so the same seed always gives exactly the same strikes. Nothing here is a real war plan: it is a
// rough, illustrative sketch based on public descriptions of how nuclear forces are organised, made to show
// why a nuclear war must never be fought.
(function (root) {
  'use strict';
  const NS = root.NS = root.NS || {};

  // ---------- settings ----------

  // ✏️ EDIT: how missiles are loaded (rough public figures).
  //   icbm / slbm = warheads on one missile, perSub = warheads one submarine on patrol carries.
  const LOADING = {
    US: { icbm: 1, slbm: 4, perSub: 90 },   // Minuteman III: 1 warhead; Trident II: ~4–5 each, 20 tubes
    RU: { icbm: 4, slbm: 4, perSub: 64 },   // Yars ~3–4, SS-18 / Sarmat up to 10; Bulava ~4–6 each, 16 tubes
    GB: { slbm: 5, perSub: 40 },            // one Vanguard-class boat on patrol, ~40 warheads
    FR: { slbm: 4, perSub: 64 },            // M51 on a Triomphant-class boat, 16 tubes
    CN: { icbm: 1, slbm: 1, perSub: 12 },   // JL-2 / JL-3 on a Jin-class boat, 12 tubes
  };

  // ✏️ EDIT: common warhead yields in kilotons. Only values inside the arsenal's yields [min, max] are used;
  // listing a value twice makes it more common.
  const TYPICAL_YIELDS = {
    US: { icbm: [300, 300, 335], slbm: [90, 90, 90, 455] },          // W87 / W78; W76-1 (most) / W88
    RU: { icbm: [150, 150, 300, 500, 800], slbm: [100, 100, 150] },
    GB: { slbm: [100] },
    FR: { slbm: [100, 150] },
    CN: { icbm: [250, 250, 1000, 3000], slbm: [250] },
  };

  // ✏️ EDIT: short-range ("tactical") nuclear forces near the NATO–Russia border. Not in data/targets.js
  // because they are not strategic arsenals. Launch points are rough, public locations.
  const TACTICAL = {
    RU: {
      cc: 'RU', warheads: 300, yields: [10, 50], rangeKm: 1000,     // Iskander-class missiles (a small share of ~1,500 non-strategic warheads)
      launchers: [
        { name: 'Iskander launchers, Kaliningrad', lat: 54.63, lon: 21.81 },
        { name: 'Iskander launchers, Belarus', lat: 53.30, lon: 28.65 },
        { name: 'Iskander launchers, Luga', lat: 58.74, lon: 29.85 },
        { name: 'Iskander launchers, Kursk', lat: 51.73, lon: 36.19 },
      ],
    },
    NATO: {
      cc: 'US', warheads: 100, yields: [10, 50], rangeKm: 900,      // ~100 US B61 bombs stored in Europe, dropped by NATO aircraft
      launchers: [
        { name: 'NATO aircraft over Poland', lat: 52.9, lon: 20.2 },
        { name: 'NATO aircraft over Lithuania', lat: 55.3, lon: 24.2 },
        { name: 'NATO aircraft over Estonia', lat: 58.9, lon: 26.2 },
        { name: 'NATO aircraft over Norway', lat: 69.4, lon: 25.5 },
      ],
    },
  };

  // ✏️ EDIT: extra bases near the NATO–Russia border (not in data/targets.js), used by the European strikes.
  // Same shape as NS.TARGETS. Coordinates are approximate.
  const BORDER_TARGETS = [
    { id: 'lask', name: 'Łask Air Base', side: 'NATO', cc: 'PL', kind: 'military', lat: 51.55, lon: 19.18, major: false },
    { id: 'powidz', name: 'Powidz Air Base', side: 'NATO', cc: 'PL', kind: 'military', lat: 52.38, lon: 17.85, major: false },
    { id: 'siauliai', name: 'Šiauliai Air Base', side: 'NATO', cc: 'LT', kind: 'military', lat: 55.89, lon: 23.39, major: false },
    { id: 'amari', name: 'Ämari Air Base', side: 'NATO', cc: 'EE', kind: 'military', lat: 59.26, lon: 24.21, major: false },
    { id: 'chernyakhovsk', name: 'Chernyakhovsk', side: 'RU', cc: 'RU', kind: 'military', lat: 54.63, lon: 21.81, major: false },
    { id: 'chkalovsk', name: 'Chkalovsk Air Base', side: 'RU', cc: 'RU', kind: 'military', lat: 54.77, lon: 20.40, major: false },
    { id: 'machulishchy', name: 'Machulishchy Air Base', side: 'RU', cc: 'BY', kind: 'military', lat: 53.77, lon: 27.58, major: false },
    { id: 'asipovichy', name: 'Asipovichy', side: 'RU', cc: 'BY', kind: 'military', lat: 53.30, lon: 28.65, major: false },
    { id: 'pskov', name: 'Pskov', side: 'RU', cc: 'RU', kind: 'military', lat: 57.78, lon: 28.40, major: false },
    { id: 'luga', name: 'Luga', side: 'RU', cc: 'RU', kind: 'military', lat: 58.74, lon: 29.85, major: false },
  ];

  // ✏️ EDIT: the first nuclear use in the European scenarios: who is hit (target ids from NS.TARGETS or BORDER_TARGETS)
  const FIRST_USE = {
    red: ['redzikowo', 'rzeszow', 'lask', 'powidz', 'siauliai'],         // Russian missiles at NATO bases near Poland
    blue: ['chernyakhovsk', 'chkalovsk', 'asipovichy', 'machulishchy'],  // NATO bombs on missile and air bases near the border
  };

  // ✏️ EDIT: warheads per military target: [major target, other target]. Extra roles (`also`) add one each.
  const WEIGHTS = {
    'icbm-base': [2, 2], 'bomber-base': [2, 2], 'ssbn-base': [3, 2], command: [3, 2], military: [2, 1],
  };
  // ✏️ EDIT: burst height by target kind. Ground bursts dig into hardened targets but make fallout.
  const BURST = {
    silo: 'ground', 'icbm-base': 'ground', 'ssbn-base': 'ground', command: 'ground', 'bomber-base': 'air', military: 'air',
  };
  // ✏️ EDIT: leadership targets in the middle of capital cities, left out of the "military targets only" strikes
  const CITY_CENTRE_TARGETS = ['white-house', 'moscow', 'london', 'paris', 'beijing'];

  // ✏️ EDIT: capital cities, as named in data/cities.js (they are always put on the city lists first)
  const CAPITALS = {
    US: 'Washington, D.C.', CA: 'Ottawa', GB: 'London', FR: 'Paris', DE: 'Berlin', IT: 'Rome', ES: 'Madrid',
    PT: 'Lisbon', NL: 'Amsterdam', BE: 'Brussels', LU: 'Luxembourg', DK: 'Copenhagen', NO: 'Oslo', IS: 'Reykjavík',
    TR: 'Ankara', GR: 'Athens', PL: 'Warsaw', CZ: 'Prague', SK: 'Bratislava', HU: 'Budapest', RO: 'Bucharest',
    BG: 'Sofia', SI: 'Ljubljana', HR: 'Zagreb', AL: 'Tirana', ME: 'Podgorica', MK: 'Skopje', EE: 'Tallinn',
    LV: 'Riga', LT: 'Vilnius', FI: 'Helsinki', SE: 'Stockholm', RU: 'Moscow', BY: 'Minsk', CN: 'Beijing',
  };

  const COLORS = { NATO: '#3b82f6', RU: '#ef4444', CN: '#f59e0b' };
  const HIROSHIMA_KT = 15;

  // ---------- small helpers ----------

  const RAD = Math.PI / 180;
  const EARTH_KM = 6371.0088;

  function distKm(a, b) {
    if (NS.Effects && typeof NS.Effects.distanceKm === 'function') return NS.Effects.distanceKm(a, b);
    const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // The point `km` away from (lat, lon) in direction `bearing` (degrees clockwise from north)
  function offset(lat, lon, km, bearing) {
    const d = km / EARTH_KM, b = bearing * RAD, p1 = lat * RAD;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    const l2 = lon * RAD + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return { lat: p2 / RAD, lon: normLon(l2 / RAD) };
  }

  const normLon = lon => ((((lon + 180) % 360) + 360) % 360) - 180;
  const r4 = x => Math.round(x * 1e4) / 1e4;
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const fmt = n => Math.round(n).toLocaleString('en-US');

  // Rough flight times if effects.js is missing (the same simple rule it uses)
  const FALLBACK_FLIGHT = { icbm: [600, 0.17, 1500, 2100], slbm: [480, 0.25, 420, 960], tactical: [180, 0.3, 180, 480] };
  function flightTime(from, to, kind) {
    const E = NS.Effects;
    if (E && typeof E.flightTime === 'function') {
      const s = +E.flightTime(from, to, kind);
      if (isFinite(s) && s > 0) return s;
    }
    const f = FALLBACK_FLIGHT[kind] || FALLBACK_FLIGHT.icbm;
    return Math.min(f[3], Math.max(f[2], f[0] + f[1] * distKm(from, to)));
  }

  function makeRng(seed) {
    if (typeof NS.rng === 'function') return NS.rng(seed);
    let a = (typeof seed === 'number' ? seed : 1) >>> 0;   // mulberry32, same as data/targets.js
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Shared data, read when a scenario is built (so the script order never matters)
  function data() {
    const A = NS.ALLIANCES || {};
    return {
      targets: Array.isArray(NS.TARGETS) ? NS.TARGETS : [],
      fields: Array.isArray(NS.SILO_FIELDS) ? NS.SILO_FIELDS : [],
      subAreas: Array.isArray(NS.SUB_AREAS) ? NS.SUB_AREAS : [],
      arsenals: NS.ARSENALS || {},
      cities: Array.isArray(NS.CITIES) ? NS.CITIES : [],
      nato: Array.isArray(A.NATO) && A.NATO.length ? A.NATO.slice() : ['US', 'CA', 'GB', 'FR', 'DE', 'IT', 'PL'],
      russia: Array.isArray(A.RU) && A.RU.length ? A.RU.slice() : ['RU', 'BY'],
    };
  }

  // Strike `to.kind` for a target kind
  const STRIKE_KIND = { 'icbm-base': 'icbm-field', 'bomber-base': 'bomber-base', 'ssbn-base': 'ssbn-base', command: 'command', military: 'military' };

  // ---------- the builder: pools of weapons, aim points, and launch waves ----------

  function Builder(def, seed) {
    this.def = def;
    this.D = data();
    this.rand = makeRng(seed);
    this.strikes = [];
    this.pools = [];
    this.struck = new Set();        // ids of targets hit
    this.cityHits = new Map();      // 'cc|name' → city row
    this.fieldsShown = new Set();   // silo fields to draw (launching or hit)
    this.siloCache = new Map();
    this.extraLabels = [];
    const caps = new Map();
    Object.keys(CAPITALS).forEach(cc => caps.set(cc, fold(CAPITALS[cc])));
    this.capitalOf = caps;
  }
  const B = Builder.prototype;

  B.r = function () { return this.rand(); };
  B.between = function (a, b) { return a + (b - a) * this.rand(); };
  B.pick = function (arr) { return arr[Math.floor(this.rand() * arr.length) % arr.length]; };
  B.shuffle = function (arr) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.rand() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  };
  B.sideOf = function (cc) {
    return this.def.sides.red.countries.includes(cc) ? 'red' : 'blue';
  };
  B.isCapital = function (row) {
    const cap = this.capitalOf.get(row[1]);
    if (!cap) return false;
    const n = fold(row[0]);
    return n === cap || n.startsWith(cap + ',');
  };
  B.findTarget = function (id) {
    return (typeof NS.targetById === 'function' && NS.targetById(id)) ||
      this.D.targets.find(t => t.id === id) || BORDER_TARGETS.find(t => t.id === id) || null;
  };

  // Silo dots of a field (illustrative scatter, seeded by the field id, so they look the same in every scenario)
  B.silos = function (field) {
    if (this.siloCache.has(field.id)) return this.siloCache.get(field.id);
    let pts = [];
    if (typeof NS.siloPoints === 'function') pts = NS.siloPoints(field) || [];
    else {
      const rng = makeRng(field.id && field.id.length * 7919);
      for (let i = 0; i < (field.count || 0); i++) {
        const p = offset(field.lat, field.lon, (field.radiusKm || 50) * Math.sqrt(rng()), rng() * 360);
        pts.push({ lat: r4(p.lat), lon: r4(p.lon) });
      }
    }
    this.siloCache.set(field.id, pts);
    return pts;
  };

  B.yieldsFor = function (cc, sys, leg) {
    const ys = leg && Array.isArray(leg.yields) && leg.yields.length ? leg.yields : [100, 100];
    const lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys);
    const typical = ((TYPICAL_YIELDS[cc] || {})[sys] || []).filter(y => y >= lo && y <= hi);
    return { list: typical.length ? typical : null, lo, hi };
  };
  B.pickYield = function (pool) {
    const y = pool.yields;
    if (y.list) return this.pick(y.list);
    if (y.lo === y.hi) return y.lo;
    return Math.max(1, Math.round(this.between(y.lo, y.hi) / 5) * 5);
  };

  // Intercontinental missiles in silos / on road-mobile launchers
  B.icbmPool = function (side, cc, share) {
    const leg = (this.D.arsenals[cc] || {}).icbm;
    if (!leg || !(leg.warheads > 0)) return null;
    const launchers = [];
    this.D.fields.filter(f => f.side === cc).forEach(f => {
      this.silos(f).forEach(p => launchers.push({ lat: p.lat, lon: p.lon, name: f.name, kind: f.type === 'mobile' ? 'mobile' : 'silo', field: f.id }));
    });
    if (!launchers.length) {   // no silo field listed: launch from the country's missile bases instead
      this.D.targets.filter(t => t.cc === cc && t.kind === 'icbm-base')
        .forEach(t => launchers.push({ lat: t.lat, lon: t.lon, name: t.name, kind: 'mobile' }));
    }
    if (!launchers.length) return null;
    this.shuffle(launchers);
    const budget = Math.round(leg.warheads * (share == null ? 1 : share));
    const per = Math.max((LOADING[cc] && LOADING[cc].icbm) || 1, Math.ceil(budget / launchers.length));
    const pool = { id: cc + ':icbm', side, cc, sys: 'icbm', left: budget, initial: budget, mirv: per,
      yields: this.yieldsFor(cc, 'icbm', leg), launchers, next: 0 };
    this.pools.push(pool);
    return pool;
  };

  // Missile submarines on patrol (placed somewhere in each patrol area)
  B.slbmPool = function (side, cc, share) {
    const leg = (this.D.arsenals[cc] || {}).slbm;
    if (!leg || !(leg.warheads > 0)) return null;
    const per = (LOADING[cc] && LOADING[cc].perSub) || 48;
    const subs = [];
    this.D.subAreas.filter(a => a.side === cc).forEach(a => {
      const n = Math.max(1, Math.round(a.subs || 1));
      for (let i = 0; i < n; i++) {
        const p = offset(a.lat, a.lon, (a.spreadKm || 300) * 0.6 * Math.sqrt(this.r()), this.r() * 360);
        subs.push({ lat: r4(p.lat), lon: r4(p.lon), name: 'Submarine, ' + a.name, left: per, queue: [], used: false });
      }
    });
    if (!subs.length) return null;
    const budget = Math.min(Math.round(leg.warheads * (share == null ? 1 : share)), per * subs.length);
    subs.forEach((s, i) => { s.left = Math.floor(budget / subs.length) + (i < budget % subs.length ? 1 : 0); });
    const pool = { id: cc + ':slbm', side, cc, sys: 'slbm', left: budget, initial: budget,
      mirv: (LOADING[cc] && LOADING[cc].slbm) || 4, yields: this.yieldsFor(cc, 'slbm', leg), subs };
    this.pools.push(pool);
    return pool;
  };

  // Short-range missiles / aircraft near the NATO–Russia border
  B.tacPool = function (side, key) {
    const cfg = TACTICAL[key];
    if (!cfg) return null;
    const pool = { id: key + ':tac', side, cc: cfg.cc, sys: 'tac', left: cfg.warheads, initial: cfg.warheads, mirv: 1,
      yields: { list: cfg.yields.slice(), lo: Math.min.apply(null, cfg.yields), hi: Math.max.apply(null, cfg.yields) },
      rangeKm: cfg.rangeKm, launchers: cfg.launchers.map(l => Object.assign({ kind: 'tactical', used: false }, l)) };
    this.pools.push(pool);
    return pool;
  };

  // How many warheads a target gets
  B.weight = function (t) {
    const w = WEIGHTS[t.kind] || [1, 1];
    return w[t.major ? 0 : 1] + (Array.isArray(t.also) ? t.also.length : 0);
  };

  // Aim points on targets (each warhead after the first lands a little off the centre)
  B.targetAims = function (list, opts) {
    opts = opts || {};
    const aims = [];
    list.forEach(t => {
      if (typeof t === 'string') t = this.findTarget(t);
      if (!t) return;
      const n = opts.one ? 1 : this.weight(t);
      for (let k = 0; k < n; k++) {
        const p = k === 0 ? { lat: t.lat, lon: t.lon } : offset(t.lat, t.lon, this.between(0.4, 1.8), this.r() * 360);
        const urgent = t.kind !== 'military' && t.kind !== 'icbm-base';
        aims.push({
          lat: p.lat, lon: p.lon, name: t.name, cc: t.cc, kind: STRIKE_KIND[t.kind] || 'military', burst: BURST[t.kind] || 'air',
          group: 't:' + t.id, ref: t.id, pref: opts.pref,
          prio: k === 0 ? (urgent || t.kind === 'icbm-base' ? 1 : 2) : (k === 1 && urgent ? 2 : 3),
        });
      }
    });
    return aims;
  };

  // Aim points on silo fields: every illustrative silo dot gets `perSilo` ground bursts
  B.siloAims = function (fields, perSilo, secondPref) {
    const aims = [];
    fields.forEach(f => {
      const pts = this.silos(f);
      for (let k = 0; k < perSilo; k++) {
        pts.forEach(p => aims.push({
          lat: p.lat, lon: p.lon, name: f.name, cc: f.cc || f.side, kind: 'silo', burst: 'ground',
          group: 'f:' + f.id, field: f.id, prio: k === 0 ? 1 : 3, pref: k === 0 ? ['icbm', 'slbm'] : (secondPref || ['icbm']),
        }));
      }
    });
    return aims;
  };

  // Military aim points: silo fields + targets that pass `keepTarget`.
  //   opts: perSilo (warheads per silo dot, default 2), secondPref (weapons allowed for the 2nd one, default ICBMs only),
  //         skipStruck, border (add BORDER_TARGETS), noCityCentres
  B.militaryAims = function (keepTarget, keepField, opts) {
    opts = opts || {};
    const fields = keepField ? this.D.fields.filter(keepField) : [];
    let targets = this.D.targets.concat(opts.border ? BORDER_TARGETS : []).filter(keepTarget);
    if (opts.skipStruck) targets = targets.filter(t => !this.struck.has(t.id));
    if (opts.noCityCentres) targets = targets.filter(t => !CITY_CENTRE_TARGETS.includes(t.id));
    return this.siloAims(fields, opts.perSilo == null ? 2 : opts.perSilo, opts.secondPref).concat(this.targetAims(targets));
  };

  // Aim points on cities: big cities get several, spread around the centre
  B.cityAims = function (ccs, opts) {
    opts = opts || {};
    const set = new Set(ccs), minPop = opts.minPop || 100000;
    let list = this.D.cities.filter(c => set.has(c[1]) && c[4] >= minPop && (!opts.filter || opts.filter(c)));
    if (opts.capitalsFirst !== false) list = list.filter(c => this.isCapital(c)).concat(list.filter(c => !this.isCapital(c)));
    if (opts.maxCities) list = list.slice(0, opts.maxCities);
    const scale = opts.aimScale || 2.5;
    const aims = [];
    list.forEach(c => {
      const pop = c[4];
      const n = Math.max(1, Math.min(10, Math.round(scale * Math.sqrt(pop / 1e6))));
      const spread = 0.35 * Math.sqrt(pop / (4000 * Math.PI));        // km; about a third of the built-up radius
      const turn = this.r() * 360;
      for (let k = 0; k < n; k++) {
        const p = k === 0
          ? offset(c[2], c[3], this.between(0, 0.4), this.r() * 360)
          : offset(c[2], c[3], spread * this.between(0.55, 1), turn + 360 * k / (n - 1) + this.between(-15, 15));
        aims.push({ lat: p.lat, lon: p.lon, name: c[0], cc: c[1], kind: 'city', burst: 'air', group: 'c:' + c[1] + '|' + c[0], city: c, prio: 1 });
      }
    });
    return aims;
  };

  // One attack wave: give each aim point a weapon, group warheads onto missiles, and time the launches.
  //   st = { pools, aims, windows: { icbm: [from, to], slbm: [...], tac: [...] }, reserve: { icbm: 0.2 }, limit, deadline }
  B.stage = function (st) {
    const pools = (st.pools || []).filter(Boolean);
    if (!pools.length || !st.aims || !st.aims.length) return 0;
    const allow = new Map();
    pools.forEach(p => {
      const keep = Math.ceil(p.initial * ((st.reserve && st.reserve[p.sys]) || 0));
      allow.set(p, Math.max(0, p.left - keep));
    });
    const subs = [];
    pools.forEach(p => { if (p.sys === 'slbm') p.subs.forEach(s => subs.push(s)); });
    const nearKm = st.nearKm || 2500;
    const limit = st.limit == null ? Infinity : st.limit;

    // 1. weapons for aim points, most important first
    const aims = st.aims.map((a, i) => [a, i]).sort((x, y) => (x[0].prio || 1) - (y[0].prio || 1) || x[1] - y[1]).map(x => x[0]);
    const buckets = new Map();
    let count = 0;
    for (const a of aims) {
      if (count >= limit) break;
      let order = a.pref;
      if (!order) {
        const near = subs.some(s => distKm(s, a) <= nearKm);
        order = near ? ['tac', 'slbm', 'icbm'] : ['tac', 'icbm', 'slbm'];
      }
      let chosen = null;
      for (const sys of order) {
        for (const p of pools) {
          if (p.sys !== sys || allow.get(p) <= 0) continue;
          if (sys === 'tac' && nearest(p.launchers, a).d > p.rangeKm) continue;
          chosen = p; break;
        }
        if (chosen) break;
      }
      if (!chosen) continue;
      allow.set(chosen, allow.get(chosen) - 1);
      chosen.left--;
      count++;
      const key = chosen.id + '|' + a.group;
      if (!buckets.has(key)) buckets.set(key, { pool: chosen, aims: [] });
      buckets.get(key).aims.push(a);
    }

    // 2. warheads onto missiles (warheads of one missile share a launch point and launch time)
    const missiles = [];
    buckets.forEach(({ pool, aims: list }) => {
      for (let i = 0; i < list.length; i += pool.mirv) {
        const chunk = list.slice(i, i + pool.mirv);
        if (pool.sys === 'icbm') {
          missiles.push({ pool, from: pool.launchers[pool.next++ % pool.launchers.length], aims: chunk });
        } else if (pool.sys === 'slbm') {
          let rest = chunk;
          while (rest.length) {
            let best = null, bestD = Infinity;
            pool.subs.forEach(s => { if (s.left > 0) { const d = distKm(s, rest[0]); if (d < bestD) { best = s; bestD = d; } } });
            if (!best) break;
            const take = rest.slice(0, best.left);
            best.left -= take.length;
            rest = rest.slice(take.length);
            const m = { pool, from: best, aims: take };
            best.queue.push(m);
            best.used = true;
            missiles.push(m);
          }
        } else {
          chunk.forEach(a => missiles.push({ pool, from: nearest(pool.launchers, a).p, aims: [a] }));
        }
      }
    });

    // 3. launch times: missiles from silos / launchers spread over the window, each submarine fires one every ~15–25 s
    const win = p => (st.windows && (st.windows[p.id] || st.windows[p.sys])) || [0, 300];
    missiles.forEach(m => { if (m.pool.sys !== 'slbm') { const w = win(m.pool); m.t = this.between(w[0], w[1]); } });
    pools.forEach(p => {
      if (p.sys !== 'slbm') return;
      const w = win(p);
      p.subs.forEach(s => {
        if (!s.queue.length) return;
        const gap = this.between(15, 25), span = gap * (s.queue.length - 1);
        let t = w[0] + Math.max(0, (w[1] - w[0]) - span) * this.r();
        s.queue.forEach(m => { m.t = t; t += gap; });
        s.queue = [];
      });
    });

    // 4. strikes
    missiles.forEach(m => {
      const sys = m.pool.sys;
      const flightKind = sys === 'tac' ? 'tactical' : sys;
      const from = {
        lat: r4(m.from.lat), lon: r4(m.from.lon), name: m.from.name,
        kind: sys === 'slbm' ? 'sub' : sys === 'tac' ? 'tactical' : (m.from.kind || 'silo'),
      };
      const y = this.pickYield(m.pool);
      const flights = m.aims.map(a => flightTime(from, a, flightKind) * (m.aims.length > 1 ? this.between(0.985, 1.015) : 1));
      let t = m.t;
      if (st.deadline) {
        const maxF = Math.max.apply(null, flights);
        if (t + maxF > st.deadline) t = st.deadline - maxF;
      }
      t = Math.max(0, Math.round(t));
      m.from.used = true;
      if (m.from.field) this.fieldsShown.add(m.from.field);
      m.aims.forEach((a, i) => this.addStrike(m.pool.side, from, a, t, flights[i], y));
    });
    return count;
  };

  B.addStrike = function (side, from, a, launchAt, flight, yieldKt) {
    this.strikes.push({
      id: 0, side,
      from: { lat: from.lat, lon: from.lon, name: from.name, kind: from.kind },
      to: { lat: r4(a.lat), lon: r4(normLon(a.lon)), name: a.name, cc: a.cc, kind: a.kind },
      launchAt: Math.max(0, Math.round(launchAt)), flight: Math.max(1, Math.round(flight)),
      yieldKt, burst: a.burst,
    });
    if (a.ref) this.struck.add(a.ref);
    if (a.field) this.fieldsShown.add(a.field);
    if (a.city) this.cityHits.set(a.city[1] + '|' + a.city[0], a.city);
  };

  function nearest(list, a) {
    let p = null, d = Infinity;
    list.forEach(l => { const x = distKm(l, a); if (x < d) { d = x; p = l; } });
    return { p, d };
  }

  // ---------- finishing: sort, number, labels, sites, end time ----------

  B.finish = function () {
    const def = this.def;
    const strikes = this.strikes.sort((a, b) => a.launchAt - b.launchAt);   // stable: ties keep build order
    strikes.forEach((s, i) => { s.id = i + 1; });

    let first = Infinity, last = 0;
    const count = { red: 0, blue: 0 };
    strikes.forEach(s => {
      const d = s.launchAt + s.flight;
      if (d < first) first = d;
      if (d > last) last = d;
      count[s.side]++;
    });
    if (!strikes.length) first = 0;
    const end = Math.max(600, Math.ceil((last + (def.tail || 300)) / 60) * 60);
    const stats = { n: strikes.length, red: count.red, blue: count.blue, firstDet: first, lastDet: last, end, cities: this.cityHits.size };

    const phases = def.phases(stats, this).filter(p => p && isFinite(p.at))
      .map(p => ({ at: Math.max(0, Math.min(end, Math.round(p.at))), title: p.title, text: p.text }))
      .sort((a, b) => a.at - b.at);

    return {
      id: def.id, name: def.name, blurb: def.blurb,
      sides: JSON.parse(JSON.stringify(def.sides)),
      strikes, phases,
      view: Object.assign({}, def.view),
      labels: this.labels(),
      sites: this.sites(),
      end,
    };
  };

  B.labels = function () {
    const out = [];
    // A city label is skipped when the same name is already there (e.g. the "Moscow" target), or when a
    // prominent label sits right on top of it (e.g. "Washington, D.C." under "The White House").
    const addCity = (lat, lon, text, major) => {
      const f = fold(text);
      for (const l of out) {
        const d = distKm(l, { lat, lon });
        if (fold(l.text) === f && d < 60) { if (major) l.major = true; return; }
        if (d < 8 && (l.major || !major)) return;
      }
      out.push({ lat: r4(lat), lon: r4(lon), text, major: !!major });
    };
    // targets: every major target of the sides involved, plus everything actually hit (small labels)
    const sides = new Set(this.def.labelSides || []);
    const box = this.def.labelBox;
    const inBox = t => !box || (t.lat >= box[0] && t.lat <= box[2] && t.lon >= box[1] && t.lon <= box[3]);
    const seen = new Set();
    this.D.targets.concat(BORDER_TARGETS).forEach(t => {
      if (seen.has(t.id)) return;
      const hit = this.struck.has(t.id);
      if (hit || (t.major && sides.has(t.side) && inBox(t))) {
        seen.add(t.id);
        out.push({ lat: t.lat, lon: t.lon, text: t.name, major: !!t.major });
      }
    });
    this.extraLabels.forEach(l => addCity(l.lat, l.lon, l.text, l.major));
    // cities: the biggest ones hit, plus hit capitals of the main countries
    const hit = Array.from(this.cityHits.values()).sort((a, b) => b[4] - a[4]);
    const topN = this.def.cityLabels == null ? 16 : this.def.cityLabels;
    hit.forEach((c, i) => {
      const capital = this.isCapital(c);
      const keyCapital = capital && ['US', 'RU', 'GB', 'FR', 'DE', 'CN', 'PL', 'BY', 'CA'].includes(c[1]);
      if (i < topN || keyCapital) addCity(c[2], c[3], c[0], capital || i < 8);
    });
    return out;
  };

  B.sites = function () {
    const out = [];
    this.D.fields.forEach(f => {
      if (!this.fieldsShown.has(f.id)) return;
      const side = this.sideOf(f.side);
      this.silos(f).forEach(p => out.push({ lat: p.lat, lon: p.lon, kind: 'silo', side }));
    });
    this.pools.forEach(p => {
      if (p.sys === 'slbm') p.subs.forEach(s => { if (s.used) out.push({ lat: s.lat, lon: s.lon, kind: 'sub', side: p.side }); });
      if (p.sys === 'tac') p.launchers.forEach(l => { if (l.used) out.push({ lat: l.lat, lon: l.lon, kind: 'base', side: p.side }); });
    });
    return out;
  };

  // ---------- the scenarios ----------

  const mins = s => Math.round(s / 60);
  const natoSide = D => ({ name: 'NATO', color: COLORS.NATO, countries: D.nato.slice() });
  const russiaSide = D => ({ name: 'Russia', color: COLORS.RU, countries: D.russia.slice() });
  const isNatoTarget = (D) => t => t.side === 'US' || t.side === 'GB' || t.side === 'FR' || t.side === 'NATO' ||
    (t.side !== 'RU' && t.side !== 'CN' && D.nato.includes(t.cc));
  const isRussiaTarget = (D) => t => t.side === 'RU' || D.russia.includes(t.cc);
  const isNatoField = D => f => D.nato.includes(f.side);
  const isRussiaField = D => f => D.russia.includes(f.side);
  const aftermathText = (S, extra) => 'In about ' + mins(S.lastDet) + ' minutes, ' + fmt(S.n) + ' nuclear warheads have exploded. ' + extra;

  const DEFS = [
    {
      id: 'nato-russia',
      name: 'NATO vs Russia',
      blurb: 'A full nuclear war between NATO and Russia: from a first "tactical" strike in Europe to attacks on cities, in about 90 minutes.',
      view: { lat: 50, lon: 0, zoom: 2 },
      labelSides: ['US', 'GB', 'FR', 'NATO', 'RU'],
      sides: D => ({ blue: natoSide(D), red: russiaSide(D) }),
      plan(B) {
        const D = B.D, natoT = isNatoTarget(D), ruT = isRussiaTarget(D);
        const ruTac = B.tacPool('red', 'RU'), ruIcbm = B.icbmPool('red', 'RU'), ruSlbm = B.slbmPool('red', 'RU');
        const natoTac = B.tacPool('blue', 'NATO'), usIcbm = B.icbmPool('blue', 'US'), usSlbm = B.slbmPool('blue', 'US');
        const gbSlbm = B.slbmPool('blue', 'GB'), frSlbm = B.slbmPool('blue', 'FR');
        // 1. a "tactical" first use in Europe, and a limited NATO reply
        B.stage({ pools: [ruTac], aims: B.targetAims(FIRST_USE.red, { one: true, pref: ['tac'] }), windows: { tac: [120, 170] } });
        B.stage({ pools: [natoTac], aims: B.targetAims(FIRST_USE.blue, { one: true, pref: ['tac'] }), windows: { tac: [630, 720] } });
        // 2. counterforce: missile fields, bomber and submarine bases, command centres
        B.stage({
          pools: [ruTac, ruSlbm, ruIcbm], aims: B.militaryAims(natoT, isNatoField(D), { skipStruck: true }),
          windows: { icbm: [1080, 1380], slbm: [1080, 1260], tac: [1140, 1500] }, reserve: { icbm: 0.2, slbm: 0.3 },
        });
        B.stage({
          pools: [usIcbm, usSlbm], aims: B.militaryAims(ruT, isRussiaField(D), { skipStruck: true, border: true, secondPref: ['icbm', 'slbm'] }),
          windows: { icbm: [1260, 1560], slbm: [1320, 1800] }, reserve: { slbm: 0.3 },
        });
        // 3. cities
        B.stage({
          pools: [ruTac, ruSlbm, ruIcbm], aims: B.cityAims(D.nato, { minPop: 100000 }),
          windows: { icbm: [2100, 2640], slbm: [2160, 3900], tac: [2160, 3600] }, deadline: 5160,
        });
        B.stage({
          pools: [gbSlbm, frSlbm, usSlbm], aims: B.cityAims(D.russia, { minPop: 50000 }),
          windows: { slbm: [2400, 3900] }, deadline: 5160,
        });
      },
      phases: S => [
        { at: 0, title: 'Tensions', text: 'A military crisis between NATO and Russia has spiralled out of control. Both sides have put their nuclear forces on high alert.' },
        { at: 120, title: 'Tactical strike', text: 'Russia fires a few low-yield nuclear missiles at NATO bases in Poland and Lithuania, hoping to force NATO to back down. NATO answers with a few nuclear bombs on Russian and Belarusian military bases.' },
        { at: 1080, title: 'Strategic counterforce', text: 'Russia launches its intercontinental missiles over the North Pole at US missile silos, bomber and submarine bases and command centres, and submarines off the US coasts fire missiles that arrive within about 15 minutes. The US launches its own missiles at Russia before they can be destroyed.' },
        { at: 2100, title: 'Cities', text: 'With leaders and forces under attack, the remaining warheads are fired at cities, and the largest are struck by several at once. Britain and France fire their submarine missiles at Russian cities.' },
        { at: S.lastDet + 30, title: 'Aftermath', text: aftermathText(S, 'Fires, radioactive fallout and the collapse of hospitals, power and food supplies would kill many more people in the weeks and years that follow.') },
      ],
    },
    {
      id: 'strike-us',
      name: 'Attack on the United States',
      blurb: 'A one-sided Russian attack on US nuclear forces, command centres and then cities.',
      view: { lat: 41, lon: -98, zoom: 4 },
      labelSides: ['US', 'RU'],
      sides: D => ({ blue: { name: 'United States', color: COLORS.NATO, countries: ['US'] }, red: russiaSide(D) }),
      plan(B) {
        const TOTAL = 1200;   // ✏️ EDIT: how many warheads this attack uses in all
        const ruIcbm = B.icbmPool('red', 'RU'), ruSlbm = B.slbmPool('red', 'RU');
        B.stage({
          pools: [ruSlbm, ruIcbm], aims: B.militaryAims(t => t.cc === 'US', f => f.side === 'US'),
          windows: { icbm: [60, 360], slbm: [60, 240] }, reserve: { icbm: 0.25, slbm: 0.3 }, limit: TOTAL,
        });
        B.stage({
          pools: [ruSlbm, ruIcbm], aims: B.cityAims(['US'], { minPop: 50000 }),
          windows: { icbm: [900, 1200], slbm: [1200, 2100] }, limit: TOTAL - B.strikes.length,
        });
      },
      phases: S => [
        { at: 0, title: 'Tensions', text: 'In a deep crisis, Russia\'s leaders decide to strike first, hoping to destroy US nuclear forces before they can be used.' },
        { at: 60, title: 'Launch', text: 'Intercontinental missiles leave Russia on a route over the North Pole and take about 30 minutes. Submarines off the US coasts fire missiles that arrive in 10–15 minutes.' },
        { at: S.firstDet, title: 'First detonations', text: 'Submarine-launched warheads hit command centres and submarine and bomber bases first. Each US missile silo is targeted by up to two warheads exploding at ground level, which throws up radioactive fallout.' },
        { at: 900, title: 'Cities', text: 'A second wave is aimed at the largest US cities, most of them struck by several warheads.' },
        { at: S.lastDet + 30, title: 'Aftermath', text: aftermathText(S, 'Fallout from the ground bursts on the missile fields drifts east over farms and towns for hundreds of kilometres.') },
      ],
    },
    {
      id: 'counterforce',
      name: 'Military targets only',
      blurb: 'Both sides aim only at nuclear forces, bases and command centres, not at cities. Millions still die.',
      view: { lat: 50, lon: 0, zoom: 2 },
      labelSides: ['US', 'GB', 'FR', 'NATO', 'RU'],
      sides: D => ({ blue: natoSide(D), red: russiaSide(D) }),
      tail: 600,
      plan(B) {
        const D = B.D;
        const ruTac = B.tacPool('red', 'RU'), ruIcbm = B.icbmPool('red', 'RU'), ruSlbm = B.slbmPool('red', 'RU');
        const usIcbm = B.icbmPool('blue', 'US'), usSlbm = B.slbmPool('blue', 'US');
        B.stage({
          pools: [ruTac, ruSlbm, ruIcbm], aims: B.militaryAims(isNatoTarget(D), isNatoField(D), { noCityCentres: true, border: true }),
          windows: { icbm: [60, 360], slbm: [60, 240], tac: [60, 420] },
        });
        B.stage({
          pools: [usIcbm, usSlbm], aims: B.militaryAims(isRussiaTarget(D), isRussiaField(D), { noCityCentres: true, border: true, secondPref: ['icbm', 'slbm'] }),
          windows: { icbm: [420, 720], slbm: [480, 1200] },
        });
      },
      phases: S => [
        { at: 0, title: 'Tensions', text: 'In a severe crisis, Russia tries to disarm NATO by striking only its nuclear forces and command centres, not its cities.' },
        { at: 60, title: 'First strike', text: 'Russian missiles are aimed at US missile silos, bomber and submarine bases, command bunkers and NATO air bases in Europe. The silos are hit with ground bursts, which make heavy radioactive fallout.' },
        { at: 420, title: 'Counterstrike', text: 'US satellites detect the launches. The US fires its missiles at Russian missile fields, bases and command centres before the incoming warheads arrive.' },
        { at: S.lastDet + 30, title: 'Fallout', text: 'No city was a target, yet blast and fire kill people living near the bases and command centres. Fallout from hundreds of ground bursts drifts over towns and farmland downwind and would kill many more in the following weeks (not counted here).' },
      ],
    },
    {
      id: 'europe',
      name: 'Escalation in Europe',
      blurb: 'A "limited" nuclear exchange in Europe that escalates to British, French and Russian cities.',
      view: { lat: 53, lon: 16, zoom: 4 },
      labelSides: ['GB', 'FR', 'NATO', 'RU'],
      labelBox: [30, -30, 75, 62],   // [south, west, north, east]
      sides: D => ({
        blue: { name: 'NATO', color: COLORS.NATO, countries: D.nato.filter(cc => cc !== 'US' && cc !== 'CA') },
        red: russiaSide(D),
      }),
      plan(B) {
        const D = B.D;
        const europe = t => t.lon > -30 && t.lon < 62 && t.lat > 30;
        const natoEu = t => isNatoTarget(D)(t) && t.cc !== 'US' && t.cc !== 'CA' && europe(t);
        const ruEu = t => isRussiaTarget(D)(t) && europe(t) && (t.kind === 'military' || t.kind === 'bomber-base');
        const ruTac = B.tacPool('red', 'RU'), ruSlbm = B.slbmPool('red', 'RU', 0.4);
        const natoTac = B.tacPool('blue', 'NATO'), gbSlbm = B.slbmPool('blue', 'GB'), frSlbm = B.slbmPool('blue', 'FR');
        // 1. first use and the NATO reply
        B.stage({ pools: [ruTac], aims: B.targetAims(FIRST_USE.red, { one: true, pref: ['tac'] }), windows: { tac: [120, 170] } });
        B.stage({ pools: [natoTac], aims: B.targetAims(FIRST_USE.blue, { one: true, pref: ['tac'] }), windows: { tac: [630, 720] } });
        // 2. escalation across Europe
        B.stage({
          pools: [ruTac, ruSlbm], aims: B.militaryAims(natoEu, null, { skipStruck: true, border: true, noCityCentres: true }),
          windows: { tac: [1200, 1680], slbm: [1260, 1500] },
        });
        B.stage({
          pools: [natoTac], aims: B.militaryAims(ruEu, null, { skipStruck: true, border: true }).map(a => Object.assign(a, { pref: ['tac'] })),
          windows: { tac: [1560, 2040] },
        });
        // 3. cities: Britain and France at Russia, Russia at Britain and France
        B.stage({
          pools: [gbSlbm, frSlbm], aims: B.cityAims(['RU'], { minPop: 100000, filter: c => c[3] < 60 }),
          windows: { slbm: [2400, 3300] }, deadline: 4800,
        });
        B.stage({
          pools: [ruSlbm, ruTac], aims: B.cityAims(['GB', 'FR'], { minPop: 100000 }),
          windows: { slbm: [2520, 3600], tac: [2520, 3300] }, limit: 150, deadline: 4800,
        });
      },
      phases: S => [
        { at: 0, title: 'Tensions', text: 'A conventional war between NATO and Russia is under way in Eastern Europe. Both sides have readied their nuclear weapons.' },
        { at: 120, title: 'Tactical strike', text: 'Russia fires a few low-yield nuclear missiles at NATO bases in Poland and Lithuania, hoping to end the war on its terms.' },
        { at: 630, title: 'NATO response', text: 'NATO answers with a few nuclear bombs on Russian and Belarusian military bases near the border.' },
        { at: 1200, title: 'Escalation', text: 'Russia now strikes NATO air bases, ports and headquarters across Europe with dozens of nuclear weapons. NATO replies against Russian bases within reach of its aircraft.' },
        { at: 2400, title: 'Cities', text: 'Britain and France fire their submarine missiles at Russian cities. Russia answers by striking British and French cities.' },
        { at: S.lastDet + 30, title: 'Aftermath', text: aftermathText(S, 'The United States was never attacked, yet much of Europe is in ruins, and fallout and the loss of food, power and medical care would cost many more lives.') },
      ],
    },
    {
      id: 'us-china',
      name: 'United States vs China',
      blurb: 'A smaller exchange between the United States and China, at military targets and cities.',
      view: { lat: 38, lon: -170, zoom: 2.5 },
      labelSides: ['US', 'CN'],
      sides: () => ({
        blue: { name: 'United States', color: COLORS.NATO, countries: ['US'] },
        red: { name: 'China', color: COLORS.CN, countries: ['CN'] },
      }),
      plan(B) {
        const cnIcbm = B.icbmPool('red', 'CN'), cnSlbm = B.slbmPool('red', 'CN');
        const usIcbm = B.icbmPool('blue', 'US'), usSlbm = B.slbmPool('blue', 'US');
        // China: too few warheads to go after US silos, so command centres, bases and then cities
        B.stage({
          pools: [cnSlbm, cnIcbm], aims: B.militaryAims(t => t.side === 'US' && t.cc === 'US', null),
          windows: { icbm: [120, 420], slbm: [120, 300] }, reserve: { icbm: 0.6 },
        });
        B.stage({
          pools: [cnSlbm, cnIcbm], aims: B.cityAims(['US'], { minPop: 100000 }),
          windows: { icbm: [180, 600], slbm: [180, 400] },
        });
        // United States: silo fields (one warhead each), bases and command, then the largest cities
        B.stage({
          pools: [usIcbm, usSlbm], aims: B.militaryAims(t => t.side === 'CN', f => f.side === 'CN', { perSilo: 1 }),
          windows: { icbm: [360, 660], slbm: [420, 1200] },
        });
        B.stage({
          pools: [usSlbm, usIcbm], aims: B.cityAims(['CN'], { minPop: 1000000 }),
          windows: { slbm: [1500, 2700], icbm: [600, 720] }, deadline: 3900,
        });
      },
      phases: S => [
        { at: 0, title: 'Tensions', text: 'A military crisis in the western Pacific has escalated, and both countries have put their nuclear forces on alert.' },
        { at: 120, title: 'Launch', text: 'Believing a US attack has begun, China launches its missiles at US command centres, bases and the largest US cities. Its arsenal is far smaller than Russia\'s, so most of it is aimed at cities.' },
        { at: 360, title: 'US response', text: 'The US fires back at China\'s missile silo fields, bases and command centres, and its submarines later strike China\'s largest cities.' },
        { at: 1500, title: 'Cities', text: 'Warheads fall on the largest cities of both countries; most are struck by several at once.' },
        { at: S.lastDet + 30, title: 'Aftermath', text: aftermathText(S, 'Even this "smaller" war would kill tens of millions, and smoke from burning cities could cool the climate and cause famine far beyond both countries.') },
      ],
    },
    {
      id: 'single',
      name: 'One bomb',
      blurb: 'A single 800-kiloton warhead over New York City, to show the scale of one modern weapon.',
      view: { lat: 40.73, lon: -73.98, zoom: 8 },
      labelSides: [],
      cityLabels: 0,
      tail: 600,
      sides: D => ({ blue: { name: 'United States', color: COLORS.NATO, countries: ['US'] }, red: russiaSide(D) }),
      plan(B) {
        const D = B.D, YIELD = 800;   // ✏️ EDIT: the yield (kt) of the one warhead
        const field = D.fields.find(f => f.id === 'tatishchevo-field') || D.fields.find(f => f.side === 'RU');
        const pts = field ? B.silos(field) : [];
        const silo = pts.length ? pts[Math.floor(B.r() * pts.length)] : { lat: 51.68, lon: 45.6 };
        const from = { lat: r4(silo.lat), lon: r4(silo.lon), name: field ? field.name : 'Tatishchevo missile field', kind: 'silo' };
        const ny = D.cities.find(c => c[0] === 'New York City' && c[1] === 'US') || ['New York City', 'US', 40.714, -74.006, 8175133];
        const aim = { lat: ny[2], lon: ny[3], name: ny[0], cc: 'US', kind: 'city', burst: 'air', city: ny };
        B.addStrike('red', from, aim, 60, flightTime(from, aim, 'icbm'), YIELD);
        if (field) B.fieldsShown.add(field.id);
        B.extraLabels.push({ lat: ny[2], lon: ny[3], text: ny[0], major: true });
        // nearby cities, for a sense of scale when zoomed in
        D.cities.filter(c => c[1] === 'US' && c !== ny && c[4] >= 100000 && distKm({ lat: c[2], lon: c[3] }, aim) < 45)
          .forEach(c => B.extraLabels.push({ lat: c[2], lon: c[3], text: c[0], major: false }));
        const t = field && B.findTarget(field.base);
        if (t) B.extraLabels.push({ lat: t.lat, lon: t.lon, text: t.name, major: true });
        B.single = { yieldKt: YIELD, flight: B.strikes[0].flight };
      },
      phases: (S, B) => {
        const y = (B.single && B.single.yieldKt) || 800;
        const r = NS.Effects && typeof NS.Effects.radii === 'function' ? NS.Effects.radii(y, 'air') : null;
        const km = x => (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10) + ' km';
        const detText = r
          ? 'An air burst over Manhattan. The fireball is about ' + km(2 * r.fireball) + ' wide; most buildings collapse out to about ' + km(r.psi5) +
            ', bare skin is burned out to about ' + km(r.thermal) + ', and windows shatter as far as ' + km(r.psi1) + ' away.'
          : 'An air burst over Manhattan. Most buildings within several kilometres collapse, and people much further away are burned by the heat flash.';
        return [
          { at: 0, title: 'One warhead', text: 'This is a single ' + fmt(y) + '-kiloton warhead, about ' + Math.round(y / HIROSHIMA_KT) + ' times the Hiroshima bomb and similar to those on some of today\'s intercontinental missiles.' },
          { at: 60, title: 'Launch', text: 'The missile is launched from a silo in Russia and takes about ' + mins(S.firstDet - 60) + ' minutes to reach New York City.' },
          { at: S.firstDet, title: 'Detonation', text: detText },
          { at: S.firstDet + 120, title: 'Aftermath', text: 'Hospitals, fire services and power in the area are destroyed along with the city. Today\'s arsenals hold thousands of warheads like this one.' },
        ];
      },
    },
  ];

  const BY_ID = {};
  DEFS.forEach(d => { BY_ID[d.id] = d; });

  // The menu list (the first one is the default)
  NS.SCENARIOS = DEFS.map(d => ({ id: d.id, name: d.name, blurb: d.blurb }));

  // Build one scenario. Same id + same seed → exactly the same result.
  NS.buildScenario = function (id, opts) {
    const base = BY_ID[id] || DEFS[0];
    const seed = opts && opts.seed != null ? opts.seed : 1;
    const D = data();
    const def = Object.assign({}, base, { sides: base.sides(D) });
    const b = new Builder(def, seed);
    def.plan(b);
    return b.finish();
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof window !== 'undefined' ? window : globalThis);
