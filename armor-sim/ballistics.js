// The "⚡ Formulas" solver: works a shot out with the classic terminal-ballistics models instead of particles, layer by layer,
// in a few milliseconds (the way analytic ballistics tools do it):
//  • Darts (long rods): the Alekseevskii–Tate model. The rod's nose wears away while the target flows aside; stepped through each layer.
//  • Shells and short cores: a rigid body slowed by the target's resistance (Poncelet's law); a thin plate gets a plug punched out.
//  • Ricochet: Rosenberg's criterion for eroding rods; the usual critical angles for shells (which also turn a little towards the plate).
//  • Ballistic limit: the slowest speed that still gets through a layer (found by bisection); exit speed from it by Recht–Ipson.
//  • Fragments behind the armor: Grady's fragment size.
//  • Shaped-charge jets: the density law (a jet goes deeper in less dense stuff), spaced gaps and reactive armor.
// Units inside: metres, seconds, kilograms and pascals. Answers come back in mm and m/s.
(function (root, factory) {
  const api = factory(root.ImpactEngine || (typeof require === 'function' ? require('./engine.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Ballistics = api;
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  if (!E) return null;
  const DEG = Math.PI / 180, MPa = 1e6;
  // ✏️ Tuning: target resistance per unit of strength (metals; the steel value gives Tate's usual ~5.5 GPa for armor steel),
  // rigid-shell resistance as a share of it, how thick (× diameter) a plate can be and still have a plug punched out, and how much extra
  // a slope costs a shell (it wastes energy turning; WWII firing trials found sloped plates worth more than their extra thickness)
  const K = { RT: 5.5, RIGID: 0.92, PLUG: 0.6, YP: 1.2, SOFT: 300, SLOPE: 0.5, ERA: 0.008, GRIND: 0.7 };

  // How a material resists (Pa): Rt against an eroding rod, Rr against a rigid shell, tau = shear strength for punching out a plug,
  // Yp = flow stress when the material is the projectile
  const GROUP_RT = { Ceramics: 1.6, 'Fibres & plastics': 0.3, 'Building & nature': 12, Explosives: 4 };
  const OVERRIDE = { sand: { Rt: 0.15e9 }, wood: { Rt: 0.1e9 }, oak: { Rt: 0.1e9 }, ice: { Rt: 0.03e9 }, water: { Rt: 0, tau: 0 }, grp: { Rt: 1.6e9 }, rubber: { Rt: 0.05e9 } };
  const PROPS = {};
  function mat(k) {
    if (PROPS[k]) return PROPS[k];
    const m = E.MATERIALS[k], Y = m.Y * MPa, brittle = m.ef < 0.02;
    const o = { key: k, name: m.name, group: m.group, rho: m.rho * 1000, Y, ef: m.ef, brittle, explosive: !!m.explosive,
      Rt: Y * (GROUP_RT[m.group] || K.RT), tau: Y * (brittle ? 0.1 : 0.6), Yp: Y * K.YP, metal: /Steel|metals/.test(m.group) };
    Object.assign(o, OVERRIDE[k] || {});
    o.Rr = o.Rt * K.RIGID;
    return (PROPS[k] = o);
  }

  // The part of the projectile that does the penetrating (a sabot or soft body is stripped off on impact): diameter, length, mass, material
  function penetrator(P) {
    const d = P.d, sh = E.makeShape(d), core = d.core, mk = core ? core.mat : d.mat;
    const inPen = m => (core ? m === core.mat : m !== 'fill' && m !== 'alu');
    let vol = 0, mass = 0, total = 0;
    const nx = 200, ny = 50, dx = (sh.x1 - sh.x0) / nx, dy = sh.r / ny;
    for (let i = 0; i < nx; i++) {
      const x = sh.x0 + (i + 0.5) * dx;
      for (let j = 0; j < ny; j++) {
        const y = (j + 0.5) * dy, m = sh.at(x, y);
        if (!m) continue;
        const ring = 2 * Math.PI * y * dy * dx;   // mm³ (a thin ring, the shape spun round its axis)
        total += ring * E.MATERIALS[m].rho;
        if (inPen(m)) { vol += ring; mass += ring * E.MATERIALS[m].rho; }
      }
    }
    const D = (d.shape === 'rod' ? d.dia : core ? 2 * core.r : d.cal) / 1000, A = Math.PI * D * D / 4;
    const L = vol * 1e-9 / A, mp = mass * 1e-6;   // m, kg (rho in g/cm³ × mm³ → mg)
    const nose = d.shape === 'ball' ? 0.5 : d.shape === 'block' ? 1 : d.shape === 'rod' ? 0.2 : Math.min(0.35, Math.max(0.1, 0.35 / (1 + (core ? core.nose || 1 : d.nose || 1))));
    const M = mat(mk), rod = d.shape === 'rod' || (L / D >= 4 && P.v >= 1200);
    const soft = !rod && M.Y < K.SOFT * MPa;   // a lead or copper bullet squashes flat as it hits, then pushes on as a wider, blunt lump
    const type = rod ? 'rod' : soft || d.shape === 'ball' || d.shape === 'block' ? 'blunt' : core && P.bore ? (P.v >= 1300 ? 'apds' : 'apcr') : d.cap ? 'capped' : 'ap';
    const De = soft ? 1.6 * D : D;
    return { D: De, A: Math.PI * De * De / 4, L: soft ? L * (D / De) ** 2 : L, L0: soft ? L * (D / De) ** 2 : L, m: mp, m0: mp, mTotal: total * 1e-6,
      rho: M.rho, Yp: M.Yp, brittle: M.ef < 0.01, Y: M.Y, mat: M, N: soft ? 0.5 : nose, rod, type, soft, capped: !!d.cap };
  }
  // Shells turn a little towards the plate as they bite in; each kind bounces off above about this angle (degrees from square-on)
  const NORM = { capped: 5, ap: 3, apcr: 2, apds: 3, blunt: 0, rod: 0 };
  const RICO = { capped: 72, ap: 68, apcr: 65, apds: 74, blunt: 55 };

  // Tate's interface speed u: where ½ρp(v−u)² + Yp = ½ρt·u² + Rt (0 if the rod can't push in at all)
  function interfaceU(v, rp, Yp, rt, Rt) {
    const a = 0.5 * (rp - rt), b = -rp * v, c = 0.5 * rp * v * v + Yp - Rt;
    if (c <= 0) return 0;
    if (Math.abs(a) < 1e-9) return Math.min(v, c / (rp * v));
    const disc = b * b - 4 * a * c;
    return Math.max(0, Math.min(v, (-b - Math.sqrt(Math.max(0, disc))) / (2 * a)));
  }
  // Push the penetrator (state s, speed v) through a slab T metres thick (along the shot) of material M.
  // Returns { through, P (how far it got, m), v, L, m, plug (m of plate punched out as a plug, or 0) }
  function slab(s, v, M, T, ang = 0) {
    let L = s.L, m = s.m, P = 0;
    const slope = s.rod ? 1 : 1 + K.SLOPE * (1 - Math.cos(ang * DEG));
    const eroding = s.rod || (M.group === 'Ceramics' && M.Y > K.GRIND * s.Y);   // a ceramic harder than the shot grinds it away
    const A = s.A, D = s.D, Dh = s.rod ? 2 * D : D;   // an eroding rod's head mushrooms to about twice its width
    for (let it = 0; it < 400000; it++) {
      if (v <= 1 || L <= 1e-5 || m <= 0) return { through: false, P, v: 0, L: Math.max(0, L), m: Math.max(0, m), plug: 0 };
      if (P >= T) return { through: true, P: T, v, L, m, plug: 0 };
      const rem = T - P;
      if (rem <= K.PLUG * Dh && M.tau > 0) {   // thin enough to punch out what's left as a plug?
        const W = 0.5 * Math.PI * Dh * rem * rem * M.tau, ke = 0.5 * m * v * v;
        if (ke >= W) { const mPlug = M.rho * Math.PI * Dh * Dh / 4 * rem; return { through: true, P: T, v: Math.sqrt(2 * (ke - W) / m) * m / (m + mPlug), L, m, plug: rem }; }
      }
      const dt = Math.min(2e-6, 0.02 * Math.min(D, Math.max(L, 2e-3)) / Math.max(v, 50));
      if (eroding) {
        const Yp = s.Yp, u = interfaceU(v, s.rho, Yp, M.rho, M.Rt);
        if (Yp > M.Rt + 0.5 * M.rho * v * v) {   // stronger than the target can push back: it goes in like a rigid body
          v -= A * (M.Rr + s.N * M.rho * v * v) / m * dt; P += v * dt;
        } else {
          v -= Yp / (s.rho * L) * dt;            // the back of the rod slows down…
          L -= (v - u) * dt; m = s.rho * A * L;  // …while its nose wears away
          P += u * dt;
        }
      } else {
        v -= A * (M.Rr * slope + s.N * M.rho * v * v) / m * dt;
        P += Math.max(0, v) * dt;
      }
    }
    return { through: false, P, v: 0, L, m, plug: 0 };
  }
  // The slowest speed that still gets through this slab, for this penetrator as it arrives (bisection)
  function limitSpeed(s, M, T, ang) {
    if (slab(s, 6000, M, T, ang).through === false) return Infinity;
    let lo = 0, hi = 6000;
    for (let k = 0; k < 28; k++) { const mid = (lo + hi) / 2; if (slab(s, mid, M, T, ang).through) hi = mid; else lo = mid; }
    return hi;
  }

  // Stations along the shot line: [{ name, ang (degrees from square-on), gap (mm of air before it), layers: [{ mat, t }] }]
  function stationsFromPlates(plates, aim = 0) {
    const out = []; let back = null;
    for (const [i, p] of plates.entries()) {
      const a = (p.ang || 0) * DEG, c = Math.max(0.05, Math.cos(a)), T = p.layers.reduce((s, l) => s + l.t, 0);
      if (p.len !== 'auto' && Math.abs(aim / c) > p.len / 2) continue;   // a short plate the shot line misses
      const x = (p.x || 0) + aim * Math.tan(a);
      out.push({ name: `Plate ${i + 1}`, ang: Math.abs(p.ang || 0), gap: back == null ? 0 : Math.max(0, x - back), layers: p.layers, x, tilt: p.ang || 0 });
      back = x + T / c;
    }
    return out;
  }
  function stationsFromGroup(group) {   // the plates a vehicle shot meets (vehicles.js firstArmor)
    let back = null;
    return group.map(h => {
      const st = { name: h.part.n, ang: Math.acos(Math.min(1, h.cos)) / DEG, gap: back == null ? 0 : Math.max(0, h.x - back), layers: h.part.layers };
      back = h.x + h.T / Math.max(0.05, h.cos);
      return st;
    });
  }

  // ---------- solid shot ----------
  // One plate (all its layers, back to back) for a penetrator in state s arriving at speed v. Each layer wears it down and slows it;
  // with rows, it also writes down what happened in each layer. Returns { through, v, L, m, P (how deep into the plate, m), stopAt }
  function plate(s, v, st, ang, rows) {
    const c = Math.max(0.05, Math.cos(ang * DEG));
    let L = s.L, m = s.m, P = 0;
    for (const [li, l] of st.layers.entries()) {
      const M = mat(l.mat), los = l.t / c, row = rows && { plate: st.name, layer: st.layers.length > 1 ? li + 1 : 0, mat: M.name, t: l.t, ang: Math.round(ang), los: Math.round(los), vIn: v };
      if (M.explosive) {   // reactive armor: the plates it throws cut a chunk off a rod (less off a short shot) and push it off line
        const flyers = st.layers.filter(q => !mat(q.mat).explosive).reduce((a, q) => a + q.t, 0);
        const f = Math.min(0.4, K.ERA * flyers * Math.sin(Math.max(ang, st.ang) * DEG)) * (s.rod ? 1 : 0.5);
        if (rows) rows.push({ ...row, vOut: v, wear: f * L / s.L0, result: 'era', note: `reactive armor went off: ${Math.round(f * 100)}% of the ${s.rod ? 'rod' : 'shot'} knocked away` });
        L *= 1 - f; m *= 1 - f; P += los / 1000; continue;
      }
      const r = slab({ ...s, L, m }, v, M, los / 1000, ang);
      if (rows) rows.push({ ...row, vOut: r.through ? r.v : 0, wear: (L - r.L) / s.L0, result: r.through ? 'through' : 'stop', depth: r.through ? undefined : Math.round(r.P * 1000) });
      if (!r.through) return { through: false, v: 0, L: r.L, m: r.m, P: P + r.P, stopLayer: li, rem: los / 1000 - r.P, M };
      L = r.L; m = r.m; v = r.v; P += los / 1000;
    }
    return { through: true, v, L, m, P };
  }
  function solveKE(P, stations) {
    const s = penetrator(P), rows = [], notes = [];
    let v = P.v, depth = 0, shattered = false;
    for (const [pi, st] of stations.entries()) {
      depth += st.gap;
      const T = st.layers.reduce((a, l) => a + l.t, 0), over = s.D * 1000 / Math.max(1, T);   // overmatch: how much wider the shot is than the plate is thick
      let ang = st.ang;
      if (!s.rod) ang = Math.max(0, ang - NORM[s.type] - (over > 2 ? Math.min(15, 5 * (over - 2)) : 0));
      // does it bounce off?
      if (pi === 0 || st.gap > 0) {
        let rico = false, why = '';
        if (s.rod) {   // Rosenberg: an eroding rod ricochets when tan²β < (Rt/ρp v²)·(v−u)/(v+u), β = angle between the rod and the plate
          const M = mat(st.layers[0].mat), u = interfaceU(v, s.rho, s.Yp, M.rho, M.Rt), beta = (90 - st.ang) * DEG;
          const lim = M.Rt / (s.rho * v * v) * (v - u) / (v + u), crit = 90 - Math.atan(Math.sqrt(lim)) / DEG;
          rico = Math.tan(beta) ** 2 < lim; why = `at this speed a dart glances off above ${Math.round(crit)}°`;
        } else if (over < 3) { const crit = RICO[s.type] + (over > 1 ? 4 * (over - 1) : 0); rico = ang >= crit; why = `shots like this glance off above about ${Math.round(crit)}°`; }
        if (rico) {
          rows.push({ plate: st.name, mat: E.MATERIALS[st.layers[0].mat].name, t: st.layers[0].t, ang: Math.round(st.ang), los: 0, vIn: v, vOut: v * 0.6, wear: 0, result: 'rico', note: why, plateEnd: true });
          return finish('rico', rows, depth, v * 0.6, s, notes, null);
        }
      }
      if (s.brittle && !shattered) {   // a brittle penetrator shatters if the impact is harder than it can take; its pieces still flow on
        const M = mat(st.layers[0].mat);
        if (0.5 * M.rho * v * v + M.Rt > 0.6 * s.Y) { shattered = true; s.Yp *= 0.05; s.rod = true; notes.push('It shattered on impact (it\'s brittle), but the pieces kept pushing in.'); }
      }
      const vIn = v, r = plate(s, v, st, ang, rows);
      // the ballistic limit of this plate (bisection) and the exit speed from it (Recht–Ipson: vr = a·√(v² − vbl²), a = m/(m + plug))
      let lo = 0, hi = 6000;
      if (!plate(s, hi, st, ang).through) hi = Infinity;
      else for (let k = 0; k < 26; k++) { const mid = (lo + hi) / 2; if (plate(s, mid, st, ang).through) hi = mid; else lo = mid; }
      const last = rows[rows.length - 1];
      last.plateEnd = true; last.vbl = isFinite(hi) ? Math.round(hi) : null;
      if (!r.through) {
        const spall = r.rem < 0.35 * s.D && r.M.metal;
        if (spall) last.result = 'spall';
        s.L = r.L; s.m = r.m;
        return finish(spall ? 'spall' : 'stop', rows, depth + r.P * 1000, 0, s, notes, null);
      }
      const lastM = mat(st.layers[st.layers.length - 1].mat), mPlug = lastM.rho * Math.PI * (1.2 * s.D) ** 2 / 4 * Math.min(T / 1000, 1.5 * s.D);
      s.L = r.L; s.m = r.m;
      v = (s.m / (s.m + mPlug)) * Math.sqrt(Math.max(0, vIn * vIn - hi * hi));
      last.vOut = v; last.resid = true;
      depth += r.P * 1000;
      if (v < 20) { last.result = 'stop'; return finish('stop', rows, depth, 0, s, notes, null); }
    }
    // Grady: fragments behind the armor, from how hard the last bit of plate is torn apart
    const lastSt = stations[stations.length - 1], lastL = lastSt.layers[lastSt.layers.length - 1], lm = mat(lastL.mat);
    const rate = Math.max(1e3, 3 * v / s.D), gam = Math.max(50, lm.Y * lm.ef * 5e-4);   // how fast the metal is torn (1/s) and the energy to break it (J/m²)
    const size = Math.min(0.03, Math.cbrt(24 * gam / (lm.rho * rate * rate)));
    const debris = Math.PI * (1.5 * s.D) ** 2 / 4 * Math.min(0.05, lastL.t / 1000) + 0.3 * s.A * Math.max(0, s.L0 - s.L);
    const frags = { n: Math.max(3, Math.min(5000, Math.round(debris / size ** 3))), size: size * 1000 };
    if (P.aphe) notes.push('Its explosive filling goes off just behind the armor.');
    return finish('pen', rows, depth, v, s, notes, frags);
  }
  function finish(verdict, rows, depth, resid, s, notes, frags) {
    return { verdict, rows, depth: Math.round(depth), resid: Math.round(resid), lenLeft: s ? Math.round(s.L * 1000) : null, len0: s ? Math.round(s.L0 * 1000) : null,
      massLeft: s ? Math.max(0, s.m / s.m0) : null, mass0: s ? s.m0 : null, dia: s ? s.D * 1000 : null, frags, notes, rod: s ? s.rod : false };
  }

  // ---------- shaped charges, squash heads and HE ----------
  const jetK = M => Math.sqrt(M.rho / 7850) * (M.group === 'Ceramics' ? 1.35 : M.group === 'Fibres & plastics' ? 1.15 : 1);
  function solveHEAT(P, stations) {
    const d = P.d, rows = [], notes = [];
    let jet = d.q * d.cal, depth = 0;
    if (d.tandem) notes.push('A small front charge sets off any reactive armor first, so the main jet isn\'t disturbed.');
    for (const [pi, st] of stations.entries()) {
      if (pi > 0 && st.gap > 0) { const k = Math.max(0.35, Math.pow(0.94, st.gap / 100)); jet *= k; depth += st.gap; }   // a jet spreads out crossing air
      const c = Math.max(0.05, Math.cos(st.ang * DEG));
      for (const [li, l] of st.layers.entries()) {
        const M = mat(l.mat), los = l.t / c, row = { plate: st.name, layer: st.layers.length > 1 ? li + 1 : 0, mat: M.name, t: l.t, ang: Math.round(st.ang), los: Math.round(los), jetIn: Math.round(jet) };
        if (M.explosive) {
          const e = d.tandem ? 0 : 0.8 * Math.min(1, Math.max(0.3, Math.sin(st.ang * DEG) / Math.sin(45 * DEG)));
          jet *= 1 - e; depth += los;
          rows.push({ ...row, jetOut: Math.round(jet), result: 'era', note: e ? `reactive armor cut the jet by ${Math.round(e * 100)}%` : 'reactive armor set off early by the front charge' });
          continue;
        }
        const need = los * jetK(M);
        if (jet < need) { rows.push({ ...row, jetOut: 0, result: 'stop', depth: Math.round(jet / jetK(M)) }); return { verdict: 'stop', rows, depth: Math.round(depth + jet / jetK(M)), jetLeft: 0, notes, heat: true }; }
        jet -= need; depth += los;
        rows.push({ ...row, jetOut: Math.round(jet), result: 'through' });
      }
    }
    return { verdict: 'pen', rows, depth: Math.round(depth), jetLeft: Math.round(jet), notes, heat: true, frags: { n: Math.round(40 + jet / 4), size: 4 } };
  }
  function solveBlast(P, stations) {
    const d = P.d, st = stations[0];
    if (!st) return { verdict: 'stop', rows: [], depth: 0, notes: [] };
    const M0 = mat(st.layers[0].mat), row = { plate: st.name, mat: M0.name, t: st.layers.reduce((a, l) => a + l.t, 0), ang: Math.round(st.ang), los: Math.round(st.layers.reduce((a, l) => a + l.t, 0) / Math.max(0.05, Math.cos(st.ang * DEG))) };
    if (st.layers.some(l => mat(l.mat).explosive)) return { verdict: 'stop', rows: [{ ...row, result: 'stop', note: 'reactive armor took the blast' }], depth: 0, notes: [], blast: true };
    if (P.kind === 'hesh') {   // the shock wave knocks a scab off the inside if the plate isn't too thick for it
      const eff = st.layers.reduce((a, l) => { const M = mat(l.mat); return a + l.t * (M.group === 'Ceramics' ? 2.2 : M.metal ? 1 : 0.5); }, 0), cap = 1.25 * d.cal;
      const ok = eff <= cap;
      return { verdict: ok ? 'spall' : 'stop', rows: [{ ...row, result: ok ? 'spall' : 'stop', note: `a ${d.cal} mm squash head can scab plates up to about ${Math.round(cap)} mm` }], depth: 0, notes: [], blast: true, frags: ok ? { n: 60, size: 12 } : null };
    }
    const pen = d.breach || 0.2 * (d.cal / 10) ** 2, ok = pen >= row.los;   // (a missile's body is mostly rocket motor, so its own figure)
    return { verdict: ok ? 'pen' : 'stop', rows: [{ ...row, result: ok ? 'through' : 'stop', note: `the blast breaks through about ${Math.round(pen)} mm` }], depth: ok ? row.los : Math.round(pen), notes: [], blast: true, frags: ok ? { n: 120, size: 8 } : null };
  }

  function solve(P, stations) {
    stations = stations.filter(st => st.layers && st.layers.length);
    if (!stations.length) return { verdict: 'miss', rows: [], depth: 0, notes: [] };
    if (P.kind === 'heat') return solveHEAT(P, stations);
    if (P.kind === 'hesh' || P.kind === 'he') return solveBlast(P, stations);
    return solveKE(P, stations);
  }
  const MODELS = { ke: 'Alekseevskii–Tate erosion (darts) or rigid-body penetration with plugging (shells), Rosenberg ricochet, Recht–Ipson exit speed, Grady fragments',
    heat: 'Jet penetration by the density law, with spaced gaps and reactive armor', hesh: 'Scabbing limit for squash heads', he: 'Blast penetration estimate' };

  return { solve, stationsFromPlates, stationsFromGroup, penetrator, mat, slab, limitSpeed, interfaceU, MODELS, K };
});
