// Nuke Sim — effects.js
// A rough, educational model of what one nuclear explosion does: how big the damage rings are, how long a
// missile takes to arrive, and an estimate of how many people in nearby cities are killed or injured.
//
// It works in the same spirit as NUKEMAP by Alex Wellerstein, but is much simpler. The ring sizes come from
// the public "cube-root scaling" rules of thumb in Glasstone & Dolan, "The Effects of Nuclear Weapons" (1977):
// blast damage reaches out roughly with the cube root of the yield, heat a little faster.
// Every number here is an estimate. Real effects depend on the weapon, burst height, weather, terrain,
// buildings, time of day, warning time and much more. None of this is meant to be precise.
//
//   NS.Effects.radii(yieldKt, burst)        → { fireball, psi20, psi5, thermal, psi1 }   (km)
//   NS.Effects.fallout(yieldKt, burst)      → { length, width }   (km; ground bursts only, drifts east)
//   NS.Effects.flightTime(from, to, kind)   → seconds
//   NS.Effects.distanceKm(a, b)             → km along the Earth's surface
//   const c = new NS.Casualties(NS.CITIES)
//   c.apply({ lat, lon, yieldKt, burst })   → { deaths, injuries, place, cc, cities: [{ name, cc, deaths }] }
//   c.preview(sameArgs)                     → the same, without changing anything
//   c.totals()                              → { deaths, injuries, byCountry: { RU: { deaths, injuries }, … } }
//   c.topCities(n)                          → the n worst-hit cities so far [{ name, cc, deaths, injuries }]
//   c.reset()
(function (root) {
  'use strict';
  const NS = root.NS = root.NS || {};

  const EARTH_RADIUS_KM = 6371.0088;
  const RAD = Math.PI / 180;
  const KM_PER_DEG = EARTH_RADIUS_KM * RAD;          // ≈ 111.2 km per degree of latitude

  // ---------- damage rings ----------

  // ✏️ EDIT: ring sizes. Each ring's radius in km = (air or ground number) × yield_in_kilotons ^ exp.
  // "air" = an air burst at the height that spreads 5 psi blast the furthest (what most city targeting uses).
  // "ground" = a surface burst: smaller blast rings (the ground soaks some up) but lots of radioactive fallout.
  // Rough checks: 100 kt air → 5 psi ≈ 3.2 km, burns ≈ 4 km, 1 psi ≈ 8 km. 15 kt (about Hiroshima) → 5 psi ≈ 1.7 km.
  const RINGS = {
    fireball: { exp: 0.4,   air: 0.07, ground: 0.09 },  // inside the fireball itself: everything is vaporised
    psi20:    { exp: 1 / 3, air: 0.28, ground: 0.23 },  // 20 psi: heavy blast, even reinforced concrete is destroyed
    psi5:     { exp: 1 / 3, air: 0.68, ground: 0.45 },  // 5 psi: most homes and buildings collapse
    thermal:  { exp: 0.41,  air: 0.6,  ground: 0.5 },   // heat flash ≈ 8 cal/cm²: third-degree burns on bare skin
    psi1:     { exp: 1 / 3, air: 1.75, ground: 1.2 },   // 1 psi: windows shatter, flying glass injures people
  };
  // Heat from really huge bombs (tens of megatons) is partly soaked up by the air and the fireball's own height,
  // so above this yield the burn ring stops growing faster than the blast rings (it grows like the cube root).
  const THERMAL_BEND_KT = 20000;
  const MAX_YIELD_KT = 100000;                        // 100 Mt: bigger than anything ever built (Tsar Bomba was ~50 Mt)

  const isGround = burst => burst === 'ground' || burst === 'surface';

  function cleanYield(yieldKt) {
    const y = +yieldKt;
    if (!isFinite(y) || y <= 0) return 0;
    return Math.min(y, MAX_YIELD_KT);
  }

  // Ring radii in km. Note: for small bombs (below ~5 kt) the 5 psi ring is bigger than the burn ring —
  // that's real (blast matters more than heat for small weapons), so don't assume the rings always nest.
  function radii(yieldKt, burst) {
    const y = cleanYield(yieldKt);
    if (!y) return { fireball: 0, psi20: 0, psi5: 0, thermal: 0, psi1: 0 };
    const k = isGround(burst) ? 'ground' : 'air';
    const ring = name => RINGS[name][k] * Math.pow(y, RINGS[name].exp);
    const psi1 = ring('psi1');
    let thermal = y <= THERMAL_BEND_KT
      ? ring('thermal')
      : RINGS.thermal[k] * Math.pow(THERMAL_BEND_KT, RINGS.thermal.exp) * Math.cbrt(y / THERMAL_BEND_KT);
    thermal = Math.min(thermal, psi1);                // burns never reach further than the window-breaking ring
    return { fireball: ring('fireball'), psi20: ring('psi20'), psi5: ring('psi5'), thermal, psi1 };
  }

  // ✏️ EDIT: fallout plume size. Purely illustrative: a cigar shape drifting downwind (the app draws it drifting east,
  // like the prevailing westerly winds over Europe, Russia and North America). Real fallout depends on the winds on
  // the day, and its danger fades quickly (most of the dose comes in the first days). Air bursts make almost none.
  const FALLOUT = { coef: 25, exp: 0.45, widthRatio: 1 / 6 };

  function fallout(yieldKt, burst) {
    const y = cleanYield(yieldKt);
    if (!y || !isGround(burst)) return { length: 0, width: 0 };
    const length = FALLOUT.coef * Math.pow(y, FALLOUT.exp);   // 100 kt ≈ 200 km, 1 Mt ≈ 560 km
    return { length, width: length * FALLOUT.widthRatio };
  }

  // ---------- distance & flight time ----------

  const lonOf = p => (p.lon != null ? +p.lon : +p.lng);

  // Great-circle ("as the crow flies") distance in km between two { lat, lon } points (haversine formula).
  function havKm(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * RAD, dLon = (lon2 - lon1) * RAD;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function distanceKm(a, b) {
    if (!a || !b) return 0;
    const d = havKm(+a.lat, lonOf(a), +b.lat, lonOf(b));
    return isFinite(d) ? d : 0;
  }

  // ✏️ EDIT: rough flight times: seconds = base + perKm × distance, then kept between min and max.
  // ICBMs take roughly 25–35 minutes between Russia and the US; submarine missiles fired from closer in can arrive
  // in 8–15 minutes; short-range (tactical) missiles in a few minutes. Bombers and cruise missiles are far slower.
  const FLIGHT = {
    icbm:     { base: 600, perKm: 0.17, min: 1500, max: 2100 },
    slbm:     { base: 480, perKm: 0.25, min: 420,  max: 960 },
    tactical: { base: 180, perKm: 0.30, min: 180,  max: 480 },
  };
  const SLOW_SPEED_KM_S = 0.25;                       // bombers / cruise missiles ≈ 250 m/s (900 km/h)
  const KINDS = {
    icbm: 'icbm', silo: 'icbm', mobile: 'icbm', 'icbm-field': 'icbm',
    slbm: 'slbm', sub: 'slbm', submarine: 'slbm', ssbn: 'slbm',
    tactical: 'tactical', srbm: 'tactical', irbm: 'tactical',
    bomber: 'slow', aircraft: 'slow', cruise: 'slow',
  };

  function flightTime(from, to, kind) {
    const type = KINDS[kind || (from && from.kind)] || 'icbm';
    const d = distanceKm(from, to);
    if (type === 'slow') return Math.max(300, Math.round(d / SLOW_SPEED_KM_S));
    const f = FLIGHT[type];
    return Math.round(Math.min(f.max, Math.max(f.min, f.base + f.perKm * d)));
  }

  // ---------- casualties ----------
  //
  // How the estimate works (deliberately simple — please read before quoting any number):
  //  * Only the cities in NS.CITIES (places with ≥ 50,000 people) are counted. People in the countryside, small
  //    towns and villages are NOT counted, and neither are later deaths from fallout, fires, hunger, lack of
  //    medical care, or climate effects. So the real toll of a nuclear war would be far higher.
  //  * Each city's people are spread out like a soft round blob (a 2-D bell curve / Gaussian) around its centre.
  //    Its size comes from R = √(population ÷ (4,000 people/km² × π)), so 1 million people → R ≈ 9 km and
  //    10 million → R ≈ 28 km. The bell curve's width is R/3, which puts ~99% of people inside R and gives a
  //    crowded centre of about 18,000 people/km², thinning out to suburbs. (This gives about 85,000 deaths for a
  //    15 kt blast over a city of 340,000 — close to the roughly 70,000–80,000 immediate deaths at Hiroshima.)
  //  * The blob is stored as 48 sample spots laid out in a sunflower spiral. Each spot holds an equal share of the
  //    city's people and covers a small round patch of ground (smaller in the crowded middle, bigger in the suburbs).
  //    Each spot remembers what fraction of its people are still alive and how many of those are injured.
  //  * A blast hits the part of each patch that lies inside each ring, using the rates below. If rings overlap
  //    (e.g. two bombs on one city), the second blast only hits people still alive, so nobody is counted twice.
  //    Injured survivors can be killed by a later blast: they then move from "injured" to "dead". A survivor who
  //    is hurt again stays counted as one injured person.
  //  * So totals().injuries = injured people still alive, which can be a little lower than adding up every
  //    apply().injuries (each apply() reports the people newly injured by that blast).

  // ✏️ EDIT: what happens to people inside each ring, from the worst ring outwards (fractions of those still alive).
  const BANDS = [
    { key: 'fireball', dead: 1.00, injured: 0.00 },
    { key: 'psi20',    dead: 0.95, injured: 0.05 },
    { key: 'psi5',     dead: 0.50, injured: 0.40 },
    { key: 'thermal',  dead: 0.25, injured: 0.45 },
    { key: 'psi1',     dead: 0.02, injured: 0.25 },
  ];
  const DENSITY = 4000;          // ✏️ EDIT: people per km² used to size each city's blob (see R above)
  const SIGMA_OF_R = 1 / 3;      // bell-curve width as a fraction of R
  const N = 48;                  // sample spots per city
  const PLACE_KM = 30;           // a blast within this distance of a city is "in" it ("Moscow, Russia")
  const NEAR_STEPS_KM = [150, 500, 1500];   // otherwise look this far out for "near X"

  const B_DEAD = BANDS.map(b => b.dead), B_INJ = BANDS.map(b => b.injured), NB = BANDS.length;

  // The sunflower pattern, in units of the bell-curve width (σ). Spot i sits at the middle of the i-th equal
  // slice of people (counted from the centre out); its patch has the area of that slice's ring of ground.
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
  const PAT_X = new Float64Array(N), PAT_Y = new Float64Array(N), PAT_RHO = new Float64Array(N);
  let PAT_REACH = 0;                                    // furthest any patch reaches from the centre (in σ)
  {
    const radiusAt = u => Math.sqrt(-2 * Math.log(1 - u));   // radius holding a fraction u of a 2-D bell curve
    for (let i = 0; i < N; i++) {
      const uLo = i / N, uHi = i === N - 1 ? 1 - 0.25 / N : (i + 1) / N;   // the last slice's long tail is cut off
      const r = radiusAt((i + 0.5) / N), a = i * GOLDEN_ANGLE;
      PAT_X[i] = r * Math.cos(a);
      PAT_Y[i] = r * Math.sin(a);
      PAT_RHO[i] = Math.sqrt(radiusAt(uHi) ** 2 - radiusAt(uLo) ** 2);
      PAT_REACH = Math.max(PAT_REACH, r + PAT_RHO[i]);
    }
  }

  // Fraction of a round patch (radius rho, centre at distance d from ground zero) inside a ring of radius r.
  function patchInside(r, d, rho) {
    if (r <= 0) return 0;
    if (d + rho <= r) return 1;
    if (d >= r + rho) return 0;
    if (d + r <= rho) return (r * r) / (rho * rho);    // the whole ring fits inside the patch
    const r2 = r * r, p2 = rho * rho, d2 = d * d;
    const clamp1 = x => (x < -1 ? -1 : x > 1 ? 1 : x);
    const lens = r2 * Math.acos(clamp1((d2 + r2 - p2) / (2 * d * r)))
      + p2 * Math.acos(clamp1((d2 + p2 - r2) / (2 * d * rho)))
      - 0.5 * Math.sqrt(Math.max(0, (-d + r + rho) * (d + r - rho) * (d - r + rho) * (d + r + rho)));
    const f = lens / (Math.PI * p2);
    return f < 0 ? 0 : f > 1 ? 1 : f;
  }

  // Grid cells of `deg` degrees (1° for blasts, 10° for the far "near X" search), so a lookup only checks
  // cities close by. Cells are numbered row × columns + column, counting from the south pole and 180°W.
  const cellIndex = (row, col, deg) => { const cols = 360 / deg; return row * cols + ((col % cols) + cols) % cols; };
  const cellOf = (lat, lon, deg) =>
    cellIndex(Math.min(180 / deg - 1, Math.max(0, Math.floor((lat + 90) / deg))), Math.floor((lon + 180) / deg), deg);
  const wrapDeg = x => ((x + 540) % 360 + 360) % 360 - 180;   // longitude difference in −180…180

  class Casualties {
    constructor(cities) {
      const list = Array.isArray(cities) ? cities : (Array.isArray(NS.CITIES) ? NS.CITIES : []);
      const names = [], ccs = [], lat = [], lon = [], pop = [];
      for (const c of list) {
        if (!c) continue;
        const rec = Array.isArray(c) ? c : [c.name, c.cc, c.lat, lonOf(c), c.pop];
        const la = +rec[2], lo = +rec[3], p = +rec[4];
        if (!isFinite(la) || !isFinite(lo) || !(p > 0)) continue;
        names.push(String(rec[0])); ccs.push(rec[1] ? String(rec[1]) : ''); lat.push(la); lon.push(lo); pop.push(p);
      }
      const n = names.length;
      this._names = names;
      this._cc = ccs;
      this._lat = Float64Array.from(lat);
      this._lon = Float64Array.from(lon);
      this._pop = Float64Array.from(pop);
      this._r = new Float64Array(n);          // city size R (km)
      this._sigma = new Float64Array(n);      // bell-curve width (km)
      this._cos = new Float64Array(n);
      this._reach = new Float64Array(n);      // furthest sample patch from the centre (km)
      this._grids = { 1: [], 10: [] };
      this._maxReach = 0;
      this.totalPopulation = 0;
      for (let i = 0; i < n; i++) {
        const R = Math.sqrt(pop[i] / (DENSITY * Math.PI));
        this._r[i] = R;
        this._sigma[i] = R * SIGMA_OF_R;
        this._cos[i] = Math.cos(lat[i] * RAD);
        this._reach[i] = this._sigma[i] * PAT_REACH;
        this._maxReach = Math.max(this._maxReach, this._reach[i]);
        this.totalPopulation += pop[i];
        for (const deg of [1, 10]) {
          const grid = this._grids[deg], key = cellOf(lat[i], lon[i], deg);
          (grid[key] || (grid[key] = [])).push(i);
        }
      }
      this._alive = new Float64Array(n * N);     // fraction of each spot's people still alive (injured included)
      this._hurt = new Float64Array(n * N);      // fraction of each spot's people alive but injured
      this._cityDeaths = new Float64Array(n);
      this._cityInjuries = new Float64Array(n);
      this.reset();
    }

    get cityCount() { return this._names.length; }

    reset() {
      this._alive.fill(1);
      this._hurt.fill(0);
      this._cityDeaths.fill(0);
      this._cityInjuries.fill(0);
      this._touched = new Set();
      this._deaths = 0;
      this._injuries = 0;
      this._byCountry = {};
    }

    apply(blast) { return this._hit(blast || {}, true); }
    preview(blast) { return this._hit(blast || {}, false); }

    totals() {
      const byCountry = {};
      for (const cc in this._byCountry) {
        const t = this._byCountry[cc];
        byCountry[cc] = { deaths: Math.round(t.deaths), injuries: Math.max(0, Math.round(t.injuries)) };
      }
      return { deaths: Math.round(this._deaths), injuries: Math.max(0, Math.round(this._injuries)), byCountry };
    }

    // The n cities with the most deaths so far (an extra for the info panel).
    topCities(n = 10) {
      return [...this._touched]
        .sort((a, b) => this._cityDeaths[b] - this._cityDeaths[a])
        .slice(0, n)
        .map(i => ({ name: this._names[i], cc: this._cc[i], deaths: Math.round(this._cityDeaths[i]), injuries: Math.max(0, Math.round(this._cityInjuries[i])) }));
    }

    // Calls fn(cityIndex) once for every city whose centre is in a grid cell within km of (lat, lon).
    _forEachNear(lat, lon, km, fn, deg = 1) {
      const grid = this._grids[deg], allCols = 360 / deg;
      const dLat = km / KM_PER_DEG;
      const latLo = lat - dLat, latHi = lat + dLat;
      const rowLo = Math.max(0, Math.floor((latLo + 90) / deg)), rowHi = Math.min(180 / deg - 1, Math.floor((latHi + 90) / deg));
      const worstCos = Math.cos(Math.min(89.99, Math.max(Math.abs(latLo), Math.abs(latHi))) * RAD);
      const dLon = km / (KM_PER_DEG * worstCos);
      let colLo, cols;
      if (latLo <= -89 || latHi >= 89 || dLon >= 180) { colLo = 0; cols = allCols; }
      else {
        colLo = Math.floor((lon - dLon + 180) / deg);
        cols = Math.min(allCols, Math.floor((lon + dLon + 180) / deg) - colLo + 1);
      }
      for (let row = rowLo; row <= rowHi; row++) {
        for (let k = 0; k < cols; k++) {
          const cell = grid[cellIndex(row, colLo + k, deg)];
          if (cell) for (let j = 0; j < cell.length; j++) fn(cell[j]);
        }
      }
    }

    _label(i) {
      const countries = NS.COUNTRIES || {};
      const cc = this._cc[i];
      const country = countries[cc] || cc;
      return country ? this._names[i] + ', ' + country : this._names[i];
    }

    // Where a blast is: the city it's inside of (within 30 km — preferring the city it's deepest inside of, relative
    // to the city's size, so a blast in Moscow's suburbs says "Moscow" rather than a small neighbouring town),
    // otherwise "near" the closest listed city.
    _place(lat, lon) {
      let best = -1, bestScore = Infinity;
      this._forEachNear(lat, lon, PLACE_KM, i => {
        const d = havKm(lat, lon, this._lat[i], this._lon[i]);
        if (d > PLACE_KM) return;
        const score = d / Math.max(2, this._r[i]);
        if (score < bestScore) { bestScore = score; best = i; }
      });
      if (best >= 0) return { place: this._label(best), cc: this._cc[best] || null };
      for (const km of NEAR_STEPS_KM) {
        let bestD = Infinity;
        this._forEachNear(lat, lon, km, i => {
          const d = havKm(lat, lon, this._lat[i], this._lon[i]);
          if (d <= km && d < bestD) { bestD = d; best = i; }
        }, km > 200 ? 10 : 1);
        if (best >= 0) return { place: 'near ' + this._label(best), cc: bestD <= NEAR_STEPS_KM[0] ? (this._cc[best] || null) : null };
      }
      return { place: 'a remote area', cc: null };
    }

    _hit(blast, commit) {
      const lat = +blast.lat, lon = lonOf(blast);
      const result = { deaths: 0, injuries: 0, place: 'unknown location', cc: null, cities: [] };
      if (!isFinite(lat) || !isFinite(lon)) return result;
      Object.assign(result, this._place(lat, lon));

      const rr = radii(blast.yieldKt != null ? blast.yieldKt : blast.yield, blast.burst);
      // Each person gets the worst ring that reaches them, so use "worst-so-far" radii: ring k covers everything
      // that is at least as bad as band k.
      const R = new Float64Array(NB);
      let maxR = 0;
      BANDS.forEach((b, k) => { maxR = Math.max(maxR, rr[b.key]); R[k] = maxR; });
      if (!(maxR > 0)) return result;

      const hits = [];
      let totalDeaths = 0, totalNewInjuries = 0;
      this._forEachNear(lat, lon, maxR + this._maxReach, ci => {
        const dCentre = havKm(lat, lon, this._lat[ci], this._lon[ci]);
        if (dCentre >= maxR + this._reach[ci]) return;
        // Ground zero in flat km around the city centre (fine at these small distances).
        const bx = wrapDeg(lon - this._lon[ci]) * this._cos[ci] * KM_PER_DEG;
        const by = (lat - this._lat[ci]) * KM_PER_DEG;
        const s = this._sigma[ci], share = this._pop[ci] / N, base = ci * N;
        let dead = 0, newHurt = 0, hurtKilled = 0;
        for (let i = 0; i < N; i++) {
          const rho = PAT_RHO[i] * s;
          const dx = PAT_X[i] * s - bx, dy = PAT_Y[i] * s - by;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d - rho >= maxR) continue;
          const alive = this._alive[base + i];
          if (alive <= 0) continue;
          // Split this patch between the rings, worst first.
          let inside = 0, pDead = 0, pHurt = 0;
          for (let k = 0; k < NB; k++) {
            const f = patchInside(R[k], d, rho);
            const part = f - inside;
            if (part > 0) { pDead += part * B_DEAD[k]; pHurt += part * B_INJ[k]; inside = f; }
            if (f >= 1) break;
          }
          if (pDead <= 0 && pHurt <= 0) continue;
          const hurt = this._hurt[base + i];
          const killed = alive * pDead;              // of everyone still alive here
          const injuredNow = (alive - hurt) * pHurt; // newly injured, from the unhurt survivors
          const injuredDied = hurt * pDead;          // already-injured people killed this time
          dead += killed * share; newHurt += injuredNow * share; hurtKilled += injuredDied * share;
          if (commit) {
            this._alive[base + i] = alive - killed;
            this._hurt[base + i] = hurt - injuredDied + injuredNow;
          }
        }
        if (dead <= 0 && newHurt <= 0) return;
        totalDeaths += dead;
        totalNewInjuries += newHurt;
        hits.push({ ci, dead });
        if (commit) {
          const cc = this._cc[ci] || '??';
          const t = this._byCountry[cc] || (this._byCountry[cc] = { deaths: 0, injuries: 0 });
          t.deaths += dead;
          t.injuries += newHurt - hurtKilled;
          this._deaths += dead;
          this._injuries += newHurt - hurtKilled;
          this._cityDeaths[ci] += dead;
          this._cityInjuries[ci] += newHurt - hurtKilled;
          this._touched.add(ci);
        }
      });

      result.deaths = Math.round(totalDeaths);
      result.injuries = Math.round(totalNewInjuries);
      result.cities = hits
        .filter(h => h.dead >= 0.5)
        .sort((a, b) => b.dead - a.dead)
        .slice(0, 5)
        .map(h => ({ name: this._names[h.ci], cc: this._cc[h.ci], deaths: Math.round(h.dead) }));
      return result;
    }
  }

  NS.Effects = {
    radii, fallout, flightTime, distanceKm,
    // Extras other parts may find handy (read-only use, please):
    KEYS: ['fireball', 'psi20', 'psi5', 'thermal', 'psi1'],
    COLORS: { fireball: '#fff4c2', psi20: '#ff2d2d', psi5: '#ff8a1f', thermal: '#ffd23f', psi1: '#9ca3af', fallout: '#a855f7' },
    BANDS: BANDS.map(b => Object.assign({}, b)),
    DENSITY,
  };
  NS.Casualties = Casualties;

  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof window !== 'undefined' ? window : globalThis);
