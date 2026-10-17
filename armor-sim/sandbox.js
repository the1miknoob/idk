// Sandbox mode: shells, armor and whole vehicles built from particles.
// engine.js does the physics and vehicles.js knows the vehicles; this file is the controls, the builders and the drawing.
(function () {
  'use strict';
  const E = window.ImpactEngine, V = window.Vehicles;
  if (!E || !V) return;
  const $ = id => document.getElementById(id);
  const clone = o => JSON.parse(JSON.stringify(o));
  const DEG = Math.PI / 180;
  const QUALITY = { low: ['Low', 3000], med: ['Medium', 6000], high: ['High', 12000], ultra: ['Ultra', 24000] };   // particle budgets (plain armor)
  const VQ = { low: 15000, med: 30000, high: 60000, ultra: 110000 };   // a whole vehicle (most of it sleeps until it's hit)
  const SPEEDS = { slow: ['🐢 Slow-mo', 40], normal: ['▶ Normal', 150], fast: ['⏩ Fast', Infinity] };              // simulated µs per real second
  const INSIDE_MAX = { slow: 20000, normal: 4500, fast: 2500 };   // ms of real time for the bits flying inside, so slow computers don't wait forever
  const VIEWS = { mat: '🎨 Material', heat: '🔥 Heat', damage: '💔 Damage', speed: '💨 Speed' };
  const FROM = ['front', 'rear', 'top'];
  const weak = innerWidth < 700 || (navigator.hardwareConcurrency || 8) <= 4;
  const DEF = { proj: 'ap88', v: null, aim: 0, preset: 'plate', plates: clone(E.ARMORS[0].plates), view: 'mat', speed: 'normal', quality: weak ? 'low' : 'med',
    target: 'armor', veh: 'tiger', from: 'front', tilt: 0, vaim: null, count: 1, pattern: 'spread', gap: 40 };
  const COUNTS = [1, 2, 3, 5, 8];   // shots at once
  const SB = Object.assign(clone(DEF), store.get('armor-sandbox', {}) || {});
  if (!E.PROJECTILES.some(p => p.id === SB.proj)) SB.proj = DEF.proj;
  if (!Array.isArray(SB.plates) || !SB.plates.length) SB.plates = clone(DEF.plates);
  SB.plates = SB.plates.map(p => ({ x: +p.x || 0, ang: clamp(+p.ang || 0, -80, 80), len: +p.len > 0 ? clamp(+p.len, 50, 3000) : 'auto', layers: (p.layers || []).filter(l => E.MATERIALS[l.mat]).map(l => ({ mat: l.mat, t: clamp(+l.t || 10, 1, 1000) })) })).filter(p => p.layers.length);
  if (!SB.plates.length) SB.plates = clone(DEF.plates);
  if (!QUALITY[SB.quality]) SB.quality = DEF.quality;
  if (!SPEEDS[SB.speed]) SB.speed = 'normal';
  if (!VIEWS[SB.view]) SB.view = 'mat';
  if (SB.target !== 'vehicle') SB.target = 'armor';
  if (!FROM.includes(SB.from)) SB.from = 'front';
  SB.tilt = clamp(Math.round(+SB.tilt || 0), -30, 30);
  if (!(Array.isArray(SB.vaim) && SB.vaim.length === 2 && SB.vaim.every(Number.isFinite))) SB.vaim = null;
  SB.count = COUNTS.includes(+SB.count) ? +SB.count : 1;
  if (SB.pattern !== 'row') SB.pattern = 'spread';
  SB.gap = clamp(Math.round(+SB.gap || 0), 0, 300);
  const saveSB = () => store.set('armor-sandbox', SB);
  const projDef = () => E.PROJECTILES.find(p => p.id === SB.proj);
  const speedOf = () => SB.v || projDef().v;
  const vol = () => ({ n: SB.count, pattern: SB.pattern, gap: SB.gap });   // several shots at once (engine.js: volleyRounds)

  // Your own vehicles (saved in this browser)
  let mine = (store.get('armor-vehicles', []) || []).map(V.sanitize).filter(Boolean);
  const saveMine = () => store.set('armor-vehicles', mine);
  const allVeh = () => V.VEHICLES.concat(mine);
  if (!allVeh().some(v => v.id === SB.veh)) SB.veh = DEF.veh;
  const vehDef = () => allVeh().find(v => v.id === SB.veh) || V.VEHICLES[0];
  function defaultAim(veh) { if (veh.aim) return veh.aim; const b = V.bbox(veh, false); return [b[0], b[2] + (b[3] - b[2]) * 0.45]; }
  const shotOf = veh => ({ from: SB.from, tilt: SB.tilt, at: SB.vaim || defaultAim(veh) });
  function volleyAims(veh, run) {   // where each shot of a volley would hit the vehicle (null: it misses the armor)
    const shot = shotOf(veh), f = V.frameFor(shot);
    return (E.volleyRounds(projDef(), vol()) || []).map(r => { const at = f.toV([0, r.dy]); return { dy: r.dy, e: V.entryPoint(veh, { ...shot, at }, run) }; });
  }

  // ===================== The simulation =====================
  // Plain armor: one shot per build. Vehicles: the whole vehicle is particles and stays damaged between shots, until you repair it.
  // A vehicle shot goes: approach → running (the hit) → inside (bits flying, real physics) → flight (what's left flies on in straight lines)
  // → blast + debris (only if ammo explodes) → done.
  let sim = null, state = 'idle', approachT0 = 0, verdict = null, verdictAt = 0, runStart = 0, flashes = [], seenEvents = 0, visible = false, raf = 0, stepsPerSec = 0;
  let VR = null;     // the vehicle: { veh, run, shots, last, fl, deb, … }
  let ED = null;     // the vehicle builder
  let paused = null; // which phase a pause interrupted
  const IDENT = V.frameFor({ from: 'front', tilt: 0, at: [0, 0] });
  let fr = IDENT;    // turns the engine's frame (shot flying along +x) into the picture's frame
  const cam = { x: 0, y: 0, s: 1 };
  let glide = null;  // smooth camera moves
  const physicsOn = () => state === 'running' || state === 'inside' || state === 'blast';
  const busyNow = () => state === 'approach' || physicsOn() || state === 'flight' || state === 'debris';

  // Plates mustn't start inside each other along the shot line
  function tidyPlates() {
    SB.plates[0].x = 0;
    for (let i = 1; i < SB.plates.length; i++) {
      const a = SB.plates[i - 1], t = E.plateThickness(a), min = a.x + t / Math.max(0.2, Math.cos(a.ang * DEG)) + 2;
      if (SB.plates[i].x < min) SB.plates[i].x = Math.round(min);
    }
  }
  function rebuild(keepView) {
    flashes = []; seenEvents = 0; verdict = null; paused = null;
    const P = projDef();
    if (ED) { VR = { veh: ED.veh, run: null }; sim = null; fr = IDENT; state = 'edit'; }
    else if (SB.target === 'vehicle') {
      const veh = vehDef(), run = V.buildVehicle(veh, VQ[SB.quality]);
      VR = { veh, run, shots: 0, last: null, fl: null, deb: null, turret: null, boom: null, reveal: null };
      sim = run.sim; fr = run.frame; seenEvents = sim.events.length; state = 'ready';
      aimChanged();
    } else {
      VR = null; tidyPlates();
      const scene = { plates: clone(SB.plates), proj: { ...P, v: speedOf(), aim: SB.aim }, volley: vol() };
      scene.h = E.pickH(scene, QUALITY[SB.quality][1]);
      sim = new E.Sim(scene); fr = IDENT; state = 'ready';
    }
    if (!keepView) fit();
    renderResult(); renderControlsState(); renderAimInfo(); draw();
  }
  let rbTimer = 0;
  const rebuildSoon = keepView => { clearTimeout(rbTimer); rbTimer = setTimeout(() => { rebuild(keepView); saveSB(); }, 160); };
  function aimChanged() {   // the vehicle stays as it is; only the planned shot moves
    if (!VR || ED) return;
    VR.entry = V.entryPoint(VR.veh, shotOf(VR.veh), VR.run); VR.aims = volleyAims(VR.veh, VR.run);
    renderAimInfo(); draw();
  }

  function fire() {
    if (ED || busyNow() || state === 'paused') return;
    const P = { ...projDef(), v: speedOf() };
    if (VR) {
      if (!VR.run) rebuild(true);
      if (!VR.entry && !(VR.aims || []).some(a => a.e)) { toast(`That ${SB.count > 1 ? 'volley misses' : 'shot misses'} the armor. Click on the vehicle where you want to hit.`); return; }
      const hits = V.aimShot(VR.run, shotOf(VR.veh), P, vol());
      if (!hits) { toast('That shot misses the armor.'); return; }
      fr = VR.run.frame; sim = VR.run.sim; VR.shots += SB.count; VR.missed = SB.count - hits; VR.fl = null; VR.reveal = null; VR.last = null; VR.burst = 0;
      if (VR.missed) toast(`${VR.missed} of the ${SB.count} shots miss the armor.`);
      seenEvents = sim.events.length; flashes = []; verdict = null;
      glideTo(impactView(), 450);
    } else if (!sim || state !== 'ready') rebuild(true);
    state = 'approach'; approachT0 = performance.now(); runStart = 0;
    sound('fire'); countPlay(); renderControlsState(); renderResult();
    loop();
  }
  function finish() {   // plain armor: the shot is over
    const v = verdict || sim.settleVerdict() || 'stop';
    verdict = v;
    sound(v === 'rico' ? 'rico' : v === 'pen' ? 'pen' : v === 'spall' ? 'boom' : 'stop');
    state = 'done';
    renderResult(); renderControlsState();
    checkChallenges({ veh: null, P: projDef(), v, tally: sim.tally, preset: SB.preset, held: v === 'stop' || v === 'spall', thick: SB.plates.reduce((t, p) => t + E.plateThickness(p), 0) });
  }

  // ---------- vehicle phases ----------
  function noteVerdict() {   // remember how this shot went at the armor (later phases keep moving things)
    const v = verdict || sim.settleVerdict() || 'stop', r = sim.res || sim.measure();
    verdict = v;
    VR.last = { v, resid: r.residual, depth: r.depth, group: VR.run.group, P: projDef(), maxT: r.maxT, tally: sim.tally, missed: VR.missed };
    sound(v === 'rico' ? 'rico' : v === 'pen' ? 'pen' : v === 'spall' ? 'boom' : 'stop');
  }
  function toInside() {
    noteVerdict();
    V.settle(VR.run);
    VR.t0 = sim.time; VR.phaseT0 = performance.now(); state = 'inside';
    glideTo(fitVehicle(), 900);
    renderResult(); renderControlsState();
  }
  function toFlight() {
    const run = VR.run, before = V.states(run), fl = V.launch(run), after = V.states(run);
    const ends = fl.pieces.map(p => p.stop).concat(fl.frags.map(f => (f.delay || 0) + f.stop));
    const far = Math.min(9000, Math.max(0, ...ends)), vs = Math.max(2500, far / 1.1);
    const reveal = run.veh.modules.map(() => 0);
    run.veh.modules.forEach((m, k) => {
      if (after[k] === before[k]) return;
      let t = Infinity;
      for (const p of fl.pieces) for (const h of p.hits) if (h.k === k) t = Math.min(t, h.t / vs);
      for (const f of fl.frags) for (const h of f.hits) if (h.k === k) t = Math.min(t, ((f.delay || 0) + h.t) / vs);
      reveal[k] = isFinite(t) ? t : 0;
    });
    VR.fl = fl; VR.vs = vs; VR.before = before; VR.reveal = reveal; VR.flT0 = performance.now(); VR.flEnd = far / vs + 0.45;
    // ammo set off by the flying bits explodes when they get there
    VR.flBooms = [];
    run.veh.modules.forEach((m, k) => { if (m.type === 'ammo' && after[k] === 2 && !run.boomed.includes(k)) { run.boomed.push(k); VR.flBooms.push({ k, t: reveal[k] }); } });
    VR.flBooms.sort((a, b) => a.t - b.t);
    if (!fl.pieces.length && !fl.frags.length && !VR.flBooms.length) { finishVehicle(); return; }
    state = 'flight';
    renderResult(); renderControlsState();
  }
  function toBlast(k) {
    if (state === 'flight' && VR.fl) { V.landFlight(VR.run, VR.fl); VR.fl = null; }
    V.ammoBlast(VR.run, k);
    const m = VR.veh.modules[k];
    VR.boom = { x: m.x + m.w / 2, y: m.y + m.h / 2, at: performance.now(), vent: !!m.vent };
    VR.blastT0 = sim.time; VR.phaseT0 = performance.now(); state = 'blast';
    sound('boom');
    renderResult(); renderControlsState();
  }
  function toDebris() {
    VR.deb = V.makeDebris(VR.run); state = 'debris';
    glideTo(fitVehicle(tossReach()), 600);
  }
  function finishVehicle() {
    if (VR.fl) { V.landFlight(VR.run, VR.fl); VR.fl = null; }
    if (VR.deb) { VR.turret = turretT(); VR.deb = null; }
    VR.reveal = null;
    if (!VR.last) noteVerdict();
    state = 'done';
    renderResult(); renderControlsState(); draw();
    const { states, fate } = V.fateOf(VR.run), f = fate.id;
    checkChallenges({ veh: VR.veh.id, modern: /^Modern/.test(VR.veh.group), from: SB.from, P: VR.last.P, v: VR.last.v, tally: VR.last.tally, fate: f, out: f === 'destroyed' || f === 'knocked',
      turret: !!VR.turret, shots: VR.shots, missed: VR.last.missed, saved: fate.saved || 0, fuelFire: VR.veh.modules.some((m, k) => m.type === 'fuel' && states[k] === 2) });
  }

  // ===================== The loop =====================
  let lastNow = 0;
  function loop() { if (!raf) raf = requestAnimationFrame(tick); }
  function physics(quota, budgetMs, each) {   // run steps until the simulated-time quota or the frame's time budget is used up
    const until = isFinite(quota) ? sim.time + quota : Infinity, t0 = performance.now();
    let n = 0;
    while (sim.time < until && performance.now() - t0 < budgetMs) {
      sim.step(); n++;
      if (each && each()) break;
    }
    return n;
  }
  function tick(now) {
    raf = 0;
    if (!visible) return;
    const dtReal = Math.min(0.05, (now - (lastNow || now)) / 1000); lastNow = now;
    if (glide) {
      const k = Math.min(1, (now - glide.t0) / glide.dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      cam.x = glide.a.x + (glide.b.x - glide.a.x) * e; cam.y = glide.a.y + (glide.b.y - glide.a.y) * e; cam.s = glide.a.s * Math.pow(glide.b.s / glide.a.s, e);
      if (k >= 1) glide = null;
    }
    if (sim && state === 'approach' && now - approachT0 > 450) { state = 'running'; runStart = now; }
    const quota = SPEEDS[SB.speed][1];
    let boom = -1;
    const zones = () => {   // vehicles: bits flying through crew, ammo, fuel and engines (and ammo that goes off)
      if (!VR || sim.steps % 4) return false;
      const o = V.zoneTick(VR.run, 4);
      if (o.bursts) { for (const b of o.bursts) flashes.push({ type: 'flash', x: b[0], y: b[1], r: 400, at: performance.now(), big: true }); VR.burst += o.bursts.length; sound('stop'); }
      if (o.booms) { boom = o.booms[0]; return true; }
      return false;
    };
    if (sim && state === 'running') {
      const n = physics(quota * dtReal, 11, () => {
        if (zones()) return true;
        if (sim.steps % 40 === 0) {
          if (!verdict) { const v = sim.verdict(); if (v) { verdict = v; verdictAt = sim.time; } }
          else if (sim.time - verdictAt > 90) return true;
        }
        return false;
      });
      stepsPerSec = stepsPerSec * 0.9 + (n / Math.max(dtReal, 0.001)) * 0.1;
      if (boom >= 0) { if (!VR.last) noteVerdict(); toBlast(boom); }
      else if (verdict && sim.time - verdictAt > 90) { if (VR) toInside(); else finish(); }
      else if (now - runStart > 120000) { if (VR) toInside(); else finish(); }   // safety: never run forever
      if (n) renderLive();
    } else if (state === 'inside') {   // the bits fly around inside: sped up, it's slow otherwise
      let done = false;
      physics(quota * 12 * dtReal, 11, () => {
        if (zones()) return true;
        if (sim.steps % 40 === 0 && (sim.time - VR.t0 > V.AIR || V.busy(VR.run) === 0 || performance.now() - VR.phaseT0 > INSIDE_MAX[SB.speed])) { done = true; return true; }
        return false;
      });
      if (boom >= 0) toBlast(boom); else if (done) toFlight();
      renderLive();
    } else if (state === 'flight') {
      const tp = (now - VR.flT0) / 1000;
      V.placeFlight(VR.run, VR.fl, p => tp * VR.vs);
      for (const b of VR.fl.bursts) if (!b.shown && tp >= b.at / VR.vs) { b.shown = true; VR.burst++; flashes.push({ type: 'flash', x: b.x, y: b.y, r: 420, at: now, big: true }); sound('stop'); }
      if (VR.flBooms.length && tp >= VR.flBooms[0].t) toBlast(VR.flBooms.shift().k);
      else if (tp >= VR.flEnd) finishVehicle();
    } else if (state === 'blast') {   // the explosion tears things loose (real physics, as fast as it goes)
      physics(Infinity, 11, () => sim.time - VR.blastT0 > 200);
      if (sim.time - VR.blastT0 > 200 || now - VR.phaseT0 > 3000) toDebris();
      renderLive();
    } else if (state === 'debris') {   // the pieces fly and fall with gravity, in real time
      V.stepDebris(VR.run, VR.deb, dtReal);
      if (VR.deb.done) finishVehicle();
    }
    if (sim) while (seenEvents < sim.events.length) { const ev = sim.events[seenEvents++], p = fr.toV([ev.x, ev.y]); flashes.push({ ...ev, x: p[0], y: p[1], at: now }); }
    flashes = flashes.filter(f => now - f.at < (f.big ? 1400 : 700));
    draw(now);
    if (busyNow() || flashes.length || glide || effectsOn(now)) loop();
  }
  const effectsOn = now => VR && VR.run && ((VR.boom && now - VR.boom.at < 7000) || fireLit() && now - (VR.fireAt || 0) < 9000);
  const fireLit = () => VR && VR.run && VR.veh.modules.some((m, k) => m.type === 'fuel' && shownState(k, performance.now()) === 2);

  // ===================== Drawing =====================
  const cv = $('sb-canvas'), ctx = cv.getContext('2d');
  const pcv = document.createElement('canvas'), pctx = pcv.getContext('2d');   // particles are painted here, then laid over the vehicle
  let img = null, buf = null, W = 0, H = 0, dpr = 1, tagEnd = 0;
  function resize() {
    const r = cv.getBoundingClientRect();
    dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const w = Math.max(50, Math.round(r.width * dpr)), h = Math.max(50, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; pcv.width = w; pcv.height = h; img = null; }
    W = r.width; H = r.height;
    const tag = cv.parentElement.querySelector('.view-tag'); tagEnd = tag ? tag.offsetLeft + tag.offsetWidth : 0;   // the clock must not cover the label
    if (!img) { img = pctx.createImageData(cv.width, cv.height); buf = new Uint32Array(img.data.buffer); }
  }
  function bounds() {   // plain armor: everything that's there, plus room for the shell to fly in
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const sh = sim.shape, len = sh.x1 - sh.x0, rs = sim.rounds, near = rs.filter(R => R.noseX >= rs[0].noseX - 2.2 * len);   // a long row: frame the first shots, the rest fly in
    const later = rs.filter(R => !near.includes(R)).flatMap(R => R.parts);
    for (let i = 0; i < sim.n; i++) {
      if (!sim.alive[i] || (later.length && later.some(([a, b]) => i >= a && i < b))) continue;
      const x = sim.px[i], y = sim.py[i]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    for (const R of near) { x0 = Math.min(x0, R.noseX - len * 1.15); y0 = Math.min(y0, R.aimY - sh.r * 1.5); y1 = Math.max(y1, R.aimY + sh.r * 1.5); }
    return [x0, x1, y0, y1];
  }
  function viewOf(x0, x1, y0, y1, pad = 1.12) {
    resize();
    const bw = (x1 - x0) * pad || 100, bh = (y1 - y0) * pad || 100;
    return { s: Math.min(W / bw, H / bh), x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  }
  function fitVehicle(reach) {   // on narrow screens the long gun barrel may run off the edge, so the vehicle itself is bigger
    resize();
    const narrow = W < 600, b = V.bbox(VR.veh, !narrow);
    let x0 = b[0] - (narrow ? 250 : 150), x1 = b[1] + 150, y1 = b[3] + 300;
    const tt = VR.run && VR.turret;
    if (tt) {   // a turret that was thrown off earlier stays in the picture
      const d = V.decoOf(VR.veh) || {}, pts = VR.veh.parts.filter(p => p.g === 't').flatMap(p => [p.a, p.b]).concat(d.barrel ? [[d.barrel.x1, d.barrel.y]] : []);
      for (const q of pts.map(p => moveBy(tt, p))) { x0 = Math.min(x0, q[0] - 150); x1 = Math.max(x1, q[0] + 150); y1 = Math.max(y1, q[1] + 300); }
    }
    if (reach) { x0 = Math.min(x0, reach.x0 - 200); x1 = Math.max(x1, reach.x1 + 200); y1 = Math.max(y1, reach.top + 300); }
    return viewOf(x0, x1, Math.min(b[2], 0) - 200, y1, 1.06);
  }
  function tossReach() {   // where the big pieces of a blast will fly, so the whole throw stays in the picture
    const g = 9810, out = { x0: Infinity, x1: -Infinity, top: -Infinity };
    for (const p of VR.deb.pieces) {
      if (p.big < 200) continue;
      let r = 0; for (const q of p.rel) r = Math.max(r, q[0] * q[0] + q[1] * q[1]); r = Math.sqrt(r);
      const up = Math.max(0, p.vy), apex = p.Y + up * up / (2 * g), t = up / g + Math.sqrt(2 * Math.max(0, apex) / g), xe = p.X + p.vx * t;
      out.x0 = Math.min(out.x0, p.X - r, xe - r); out.x1 = Math.max(out.x1, p.X + r, xe + r); out.top = Math.max(out.top, apex + r);
    }
    return out;
  }
  function impactView() {   // close up on the plates the shot hits
    const pts = VR.run.groups.flat().flatMap(g => VR.run.geo[g.i].poly), sh = sim.shape;
    if (sh) pts.push(fr.toV([sim.noseX - (sh.x1 - sh.x0) * 0.6, 0]));
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const grow = (a, b, min, max) => { const m = (a + b) / 2, h = Math.min(max, Math.max((b - a) / 2, min)) / 1; return [m - h, m + h]; };
    const es = sim.rounds.map(R => fr.toV([R.hitX, R.aimY])), ex = es.map(p => p[0]), ey = es.map(p => p[1]);   // where each shot meets the armor
    const ex0 = Math.min(...ex), ex1 = Math.max(...ex), ey0 = Math.min(...ey), ey1 = Math.max(...ey);
    [x0, x1] = grow(Math.max(x0, ex0 - 900), Math.min(x1, ex1 + 900), 300, 700 + (ex1 - ex0) / 2); [y0, y1] = grow(Math.max(y0, ey0 - 700), Math.min(y1, ey1 + 700), 250, 600 + (ey1 - ey0) / 2);
    return viewOf(x0, x1, y0, y1, 1.35);
  }
  function fit() {
    glide = null;
    if (VR) Object.assign(cam, fitVehicle());
    else if (sim) { const [x0, x1, y0, y1] = bounds(); Object.assign(cam, viewOf(x0, x1, y0, y1, 1.13)); }
  }
  function glideTo(b, dur = 600) { glide = { a: { ...cam }, b, t0: performance.now(), dur }; loop(); }
  const toSX = x => W / 2 + (x - cam.x) * cam.s, toSY = y => H / 2 - (y - cam.y) * cam.s;
  const toWX = sx => cam.x + (sx - W / 2) / cam.s, toWY = sy => cam.y - (sy - H / 2) / cam.s;

  // colors: packed 0xAABBGGRR for the pixel buffer
  const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const MATRGB = E.MAT_KEYS.map(k => rgb(E.MATERIALS[k].color));
  const pack = (r, g, b) => (255 << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const ramp = (stops, x) => {   // stops: [[value, [r,g,b]], …]
    if (x <= stops[0][0]) return stops[0][1];
    for (let k = 1; k < stops.length; k++) if (x <= stops[k][0]) return lerp3(stops[k - 1][1], stops[k][1], (x - stops[k - 1][0]) / (stops[k][0] - stops[k - 1][0]));
    return stops[stops.length - 1][1];
  };
  const GLOW = [[700, [110, 12, 0]], [1000, [215, 40, 0]], [1300, [255, 130, 20]], [1600, [255, 215, 80]], [2100, [255, 248, 215]]];
  const HEAT = [[300, [36, 44, 56]], [450, [70, 40, 90]], [700, [150, 20, 10]], ...GLOW.slice(1)];
  const SPEED = [[0, [32, 38, 46]], [0.03, [40, 70, 130]], [0.25, [50, 150, 240]], [1.0, [170, 235, 255]], [3, [255, 255, 255]]];
  const DMG = [[0, [96, 104, 114]], [0.3, [235, 190, 60]], [1, [225, 55, 45]]];
  const heatLUT = new Uint32Array(220), glowLUT = new Float32Array(220 * 4), speedLUT = new Uint32Array(200), dmgLUT = new Uint32Array(101);
  for (let k = 0; k < 220; k++) { const T = 280 + k * 10, c = ramp(HEAT, T); heatLUT[k] = pack(c[0], c[1], c[2]); const g = ramp(GLOW, T); glowLUT[4 * k] = g[0]; glowLUT[4 * k + 1] = g[1]; glowLUT[4 * k + 2] = g[2]; glowLUT[4 * k + 3] = T < 700 ? 0 : Math.min(1, (T - 700) / 700); }
  for (let k = 0; k < 200; k++) { const c = ramp(SPEED, k * 0.015); speedLUT[k] = pack(c[0], c[1], c[2]); }
  for (let k = 0; k <= 100; k++) { const c = ramp(DMG, k / 100); dmgLUT[k] = pack(c[0], c[1], c[2]); }
  const DETACHED = pack(170, 110, 240);

  function draw(now = performance.now()) {
    if (!visible) return;
    resize();
    const c = ctx;
    c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#0e1216'; c.fillRect(0, 0, cv.width, cv.height);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (VR) drawVehicle(c, now);
    if (sim) { drawParticles(now); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(pcv, 0, 0); c.setTransform(dpr, 0, 0, dpr, 0, 0); }
    if (VR && VR.run) drawModuleMarks(c, now);
    overlays(c, now);
  }
  function drawParticles(now) {
    buf.fill(0);
    const s = cam.s * dpr, cw = cv.width, ch = cv.height, splat = Math.max(1, Math.ceil(sim.h * s * 1.05)), half = splat / 2;
    const ox = cw / 2 - cam.x * s, oy = ch / 2 + cam.y * s;
    const view = SB.view, n = sim.n, fc = fr.c, fs = fr.s, Ox = fr.O[0], Oy = fr.O[1];
    const px = sim.px, py = sim.py, alive = sim.alive, mat = sim.mat, T = sim.T, shade = sim.shade, body = sim.body, vx = sim.vx, vy = sim.vy;
    // the incoming shell slides in from the left before the physics starts
    let off = 0, p0 = sim.projRange ? sim.projRange[0] : n;
    if (state === 'approach') { const f = Math.min(1, (now - approachT0) / 450), e = 1 - Math.pow(1 - f, 2); off = -(1 - e) * Math.max(W / cam.s, 400); }
    for (let i = 0; i < n; i++) {
      if (alive[i] === 0) continue;
      let x = px[i]; const y = py[i];
      if (off && body[i] === 0 && i >= p0) x += off;
      const X = Ox + fc * x - fs * y, Y = Oy + fs * x + fc * y;
      const sx = (ox + X * s - half) | 0, sy = (oy - Y * s - half) | 0;
      if (sx >= cw || sy >= ch || sx + splat <= 0 || sy + splat <= 0) continue;
      let col;
      const Ti = T[i], k = Ti < 280 ? 0 : Ti > 2470 ? 219 : ((Ti - 280) / 10) | 0;
      if (view === 'heat') col = heatLUT[k];
      else if (view === 'speed') { const sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]); col = speedLUT[Math.min(199, (sp / 0.015) | 0)]; }
      else if (view === 'damage') {
        if (body[i] > 0 && sim.attached[i] === 0) col = DETACHED;
        else { const nb = sim.nbond[i] || 6, d = Math.min(1, (sim.brk[i] === 255 ? nb : sim.brk[i]) / nb); col = dmgLUT[(d * 100) | 0]; }
      } else {
        const m = MATRGB[mat[i]], sh = shade[i], g = glowLUT[4 * k + 3];
        let r = m[0] * sh, gg = m[1] * sh, b = m[2] * sh;
        if (g > 0) { r += (glowLUT[4 * k] - r) * g; gg += (glowLUT[4 * k + 1] - gg) * g; b += (glowLUT[4 * k + 2] - b) * g; }
        col = pack(r > 255 ? 255 : r, gg > 255 ? 255 : gg, b > 255 ? 255 : b);
      }
      const x0 = sx < 0 ? 0 : sx, y0 = sy < 0 ? 0 : sy, x1 = Math.min(cw, sx + splat), y1 = Math.min(ch, sy + splat);
      for (let yy = y0; yy < y1; yy++) { const o = yy * cw; buf.fill(col, o + x0, o + x1); }
    }
    pctx.putImageData(img, 0, 0);
  }

  // ---------- vehicles ----------
  const path = (c, pts) => { c.beginPath(); pts.forEach((p, k) => (k ? c.lineTo(toSX(p[0]), toSY(p[1])) : c.moveTo(toSX(p[0]), toSY(p[1])))); c.closePath(); };
  // where the turret has gone (after a blast it flies off and lands somewhere): moves things that belong to it
  const compose = (a, b) => {   // the turret moved by a, then by b (a second blast can throw it again)
    if (!a || !b) return a || b;
    const c = Math.cos(b.a), s = Math.sin(b.a), dx = a.x - b.x0, dy = a.y - b.y0;
    return { x0: a.x0, y0: a.y0, a: a.a + b.a, x: b.x + c * dx - s * dy, y: b.y + s * dx + c * dy };
  };
  function turretT() { return compose(VR.turret, VR.deb && V.turretMove(VR.deb)); }
  const moveBy = (t, p) => { if (!t) return p; const c = Math.cos(t.a), s = Math.sin(t.a), dx = p[0] - t.x0, dy = p[1] - t.y0; return [t.x + c * dx - s * dy, t.y + s * dx + c * dy]; };
  const inTurret = (veh, m) => { const t = veh.parts.filter(p => p.g === 't').flatMap(p => [p.a, p.b]); if (!t.length) return false; const y0 = Math.min(...t.map(p => p[1])), x0 = Math.min(...t.map(p => p[0])), x1 = Math.max(...t.map(p => p[0])); return m.y + m.h / 2 > y0 && m.x + m.w / 2 > x0 && m.x + m.w / 2 < x1; };
  function shownState(k, now) {   // what to show for a crew member or part right now (hits during the replay show up when the bits get there)
    if (!VR.run) return 0;
    const st = state === 'done' || state === 'ready' ? V.fateOf(VR.run).states : V.states(VR.run);
    if (VR.reveal && state === 'flight') return (now - VR.flT0) / 1000 >= VR.reveal[k] ? st[k] : VR.before[k];
    if (VR.boom && VR.veh.modules[k].type === 'crew' && !VR.veh.modules[k].capsule && !VR.boom.vent) return 2;   // nobody survives the ammo going up (unless sealed in an armored capsule)
    return st[k];
  }
  function drawVehicle(c, now) {
    const veh = VR.veh, deco = V.decoOf(veh) || {}, tt = VR.run ? turretT() : null;
    // the ground
    const gy = toSY(0);
    if (gy < H) { c.fillStyle = '#12171c'; c.fillRect(0, gy, W, H - gy); c.strokeStyle = '#2b333c'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, gy); c.lineTo(W, gy); c.stroke(); }
    // tracks, wheels and the gun barrel (drawn only: they aren't armor)
    if (deco.track) { const [a, b, t] = deco.track; c.fillStyle = '#1a2026'; c.strokeStyle = '#2b343e'; c.lineWidth = 1; c.beginPath(); c.roundRect(toSX(a), toSY(t), (b - a) * cam.s, t * cam.s, t * cam.s / 2); c.fill(); c.stroke(); }
    for (const [x, y, r] of deco.wheels || []) { c.fillStyle = '#212932'; c.strokeStyle = '#34404b'; c.beginPath(); c.arc(toSX(x), toSY(y), r * cam.s, 0, Math.PI * 2); c.fill(); c.stroke(); c.fillStyle = '#2c3640'; c.beginPath(); c.arc(toSX(x), toSY(y), r * cam.s * 0.3, 0, Math.PI * 2); c.fill(); }
    if (deco.barrel) {
      const b = deco.barrel, x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), m = p => moveBy(tt, p);
      c.fillStyle = '#58636e';
      path(c, [[x0, b.y - b.d / 2], [x1, b.y - b.d / 2], [x1, b.y + b.d / 2], [x0, b.y + b.d / 2]].map(m)); c.fill();
      if (b.brake) { const w = Math.min(260, Math.abs(b.x0 - b.x1) * 0.12); path(c, [[b.x1 - 30, b.y - b.d * 0.85], [b.x1 - 30 + w, b.y - b.d * 0.85], [b.x1 - 30 + w, b.y + b.d * 0.85], [b.x1 - 30, b.y + b.d * 0.85]].map(m)); c.fill(); }
      if (b.evac != null) { path(c, [[b.evac - 200, b.y - b.d * 0.75], [b.evac + 200, b.y - b.d * 0.75], [b.evac + 200, b.y + b.d * 0.75], [b.evac - 200, b.y + b.d * 0.75]].map(m)); c.fill(); }
    }
    // the inside
    const hullPts = veh.parts.filter(p => p.g !== 't').flatMap(p => [p.a, p.b]), turPts = veh.parts.filter(p => p.g === 't').flatMap(p => [p.a, p.b]);
    c.fillStyle = '#151c23';
    if (hullPts.length > 2) { path(c, hullPts); c.fill(); }
    if (turPts.length > 2) { path(c, turPts.map(p => moveBy(tt, p))); c.fill(); }
    // what's inside: crew, ammo, fuel, engine…
    const fs = clamp(cam.s * 260, 9, 22);
    veh.modules.forEach((m, k) => drawModule(c, m, k, now, fs, tt && inTurret(veh, m) ? tt : null, tt && !inTurret(veh, m) ? ringY(veh) : null));
    // the armor itself: particles (drawn next), or solid while you're building
    if (!VR.run) {
      const geo = VR.geo && VR.geoOf === veh ? VR.geo : (VR.geo = V.geometry(veh), VR.geoOf = veh, VR.geo);
      veh.parts.forEach((p, i) => {
        const g = geo[i];
        V.layerBands(p, { poly: g.poly, f: g.f }).forEach(b => { path(c, b.poly); c.fillStyle = E.MATERIALS[b.mat].color; c.fill(); });
        path(c, g.poly); c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = 1; c.stroke();
      });
      if (ED) drawEditHandles(c);
    }
  }
  // once the turret has been thrown off, boxes that reached up into it (a loader standing on the floor…) end at the turret ring
  const ringY = veh => { const ys = veh.parts.filter(p => p.g === 't').flatMap(p => [p.a[1], p.b[1]]); return ys.length ? Math.min(...ys) : Infinity; };
  function drawModule(c, m, k, now, fs, tt, clipY) {
    const T = V.MODULES[m.type], st = VR.run ? shownState(k, now) : 0, top = clipY != null ? Math.min(m.y + m.h, clipY) : m.y + m.h;
    if (top <= m.y) return;
    const corners = [[m.x, m.y], [m.x + m.w, m.y], [m.x + m.w, top], [m.x, top]].map(p => moveBy(tt, p));
    c.fillStyle = st === 2 ? 'rgba(208,59,59,.42)' : st === 1 ? 'rgba(250,178,25,.25)' : T.color + '2b';
    c.strokeStyle = st === 2 ? '#ff6d60' : st === 1 ? '#fab219' : T.color + 'b0';
    c.lineWidth = ED && ED.sel && ED.sel.kind === 'mod' && ED.sel.i === k ? 2.5 : 1.2;
    path(c, corners); c.fill(); c.stroke();
    if (VR.reveal && state === 'flight') {   // flash when something hits it
      const a = (now - VR.flT0) / 1000 - VR.reveal[k];
      if (VR.reveal[k] > 0 && a >= 0 && a < 0.4) { c.fillStyle = `rgba(255,255,255,${0.7 * (1 - a / 0.4)})`; path(c, corners); c.fill(); }
    }
  }
  function drawModuleMarks(c, now) {   // icons and names go on top of the particles so you can always see them
    const veh = VR.veh, tt = turretT(), fs = clamp(cam.s * 260, 9, 22);
    veh.modules.forEach((m, k) => {
      const inT = tt && inTurret(veh, m), mh = tt && !inT ? Math.min(m.h, ringY(veh) - m.y) : m.h, w = m.w * cam.s, h = mh * cam.s;
      if (w < 14 || h < 14) return;
      const st = shownState(k, now), T = V.MODULES[m.type], ctr = moveBy(inT ? tt : null, [m.x + m.w / 2, m.y + mh / 2]);
      const cx = toSX(ctr[0]), cy = toSY(ctr[1]), big = w > 70 && h > 46;
      c.font = `${Math.min(fs, h * 0.5, w * 0.6)}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = '#fff'; c.globalAlpha = st === 2 ? 0.6 : 0.95; c.fillText(T.icon, cx, cy - (big ? fs * 0.35 : 0)); c.globalAlpha = 1;
      if (st === 2) { c.strokeStyle = '#ff6d60'; c.lineWidth = 2; const r = Math.min(fs, h * 0.4, w * 0.4) * 0.45, y = cy - (big ? fs * 0.35 : 0); c.beginPath(); c.moveTo(cx - r, y - r); c.lineTo(cx + r, y + r); c.moveTo(cx + r, y - r); c.lineTo(cx - r, y + r); c.stroke(); }
      if (big) { c.font = `600 ${clamp(fs * 0.55, 9, 12)}px system-ui, sans-serif`; c.fillStyle = st === 2 ? '#ffb3ab' : '#c9d2da'; c.fillText(fitText(c, m.n, w - 6), cx, cy + fs * 0.55); }
    });
  }
  function fitText(c, t, w) { if (c.measureText(t).width <= w) return t; while (t.length > 2 && c.measureText(t + '…').width > w) t = t.slice(0, -1); return t + '…'; }

  function overlays(c, now) {
    const sh = sim && sim.shape;
    // chemical rounds are drawn as a picture while they fly in (each one until it goes off)
    if (sim && sh && sim.kind !== 'ke' && (state === 'ready' && !VR || state === 'approach' || state === 'running')) {
      const len = (sh.x1 - sh.x0) * cam.s, sc = Math.max(0.2, len / 60), kind = sim.kind === 'heat' ? 'heat' : sim.kind === 'hesh' ? 'hesh' : 'he';
      let off = 0; if (state === 'approach') { const f = Math.min(1, (now - approachT0) / 450); off = -(1 - (1 - Math.pow(1 - f, 2))) * Math.max(W / cam.s, 400); }
      const fly = state === 'running' ? sim.v0 * (sim.time - sim.shotT0) : 0;
      c.save(); c.globalAlpha = state === 'ready' ? 0.9 : 1;
      for (const R of sim.rounds) {
        if (R.hitAt) continue;
        const p = fr.toV([R.noseX + off + fly, R.aimY]);
        drawShell(c, kind, toSX(p[0]), toSY(p[1]), Math.atan2(-fr.s, fr.c), sc, 1);
      }
      c.restore();
    }
    // the aim line before firing (one for each shot side by side; a row all comes down the same line)
    if (sim && state === 'ready' && !VR) {
      const far = 3 * Math.max(W, H) / cam.s, R0 = sim.rounds[0];
      sim.rounds.forEach((R, k) => { if (!k || R.aimY !== R0.aimY) reticle(c, fr.toV([R.hitX - far, R.aimY]), fr.toV([R.hitX, R.aimY]), '#ffb020', false, k > 0); });
      if (SB.pattern === 'row' && sim.rounds.length > 1) countTag(c, fr.toV([R0.hitX, R0.aimY]), sim.rounds.length);
    }
    if (VR && VR.run && (state === 'ready' || state === 'done')) {
      const f = V.frameFor(shotOf(VR.veh)), far = 3 * Math.max(W, H) / cam.s;
      for (const a of VR.aims || []) {   // the other shots of a volley, side by side
        if (!a.dy) continue;
        if (a.e) { const e = f.toE(a.e); reticle(c, f.toV([e[0] - far, a.dy]), a.e, '#ffb020', false, true); }
        else reticle(c, f.toV([-far, a.dy]), f.toV([far, a.dy]), '#e86a5c', true);
      }
      if (VR.entry) { const e = f.toE(VR.entry); reticle(c, f.toV([e[0] - far, 0]), VR.entry, '#ffb020', false); }
      else reticle(c, f.toV([-far, 0]), f.toV([far, 0]), '#e86a5c', true);
      if (SB.pattern === 'row' && SB.count > 1 && VR.entry) countTag(c, VR.entry, SB.count);
    }
    if (hover && VR && VR.run && (state === 'ready' || state === 'done')) {
      c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1.5; const x = toSX(hover[0]), y = toSY(hover[1]);
      c.beginPath(); c.arc(x, y, 7, 0, Math.PI * 2); c.moveTo(x - 11, y); c.lineTo(x + 11, y); c.moveTo(x, y - 11); c.lineTo(x, y + 11); c.stroke();
    }
    if (VR && VR.run) drawEffects(c, now);
    // flashes from explosions
    for (const f of flashes) {
      const life = f.big ? 1400 : 700, a = (now - f.at) / life, r = Math.max(8, (f.r || 40) * cam.s) * (0.4 + a * 0.9), x = toSX(f.x), y = toSY(f.y);
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      if (f.type === 'scab') { g.addColorStop(0, `rgba(255,220,150,${0.6 * (1 - a)})`); g.addColorStop(1, 'rgba(255,150,40,0)'); }
      else { g.addColorStop(0, `rgba(255,252,230,${1 - a})`); g.addColorStop(0.35, `rgba(255,190,60,${0.85 * (1 - a)})`); g.addColorStop(1, 'rgba(255,90,20,0)'); }
      c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); c.restore();
    }
    if (ED) return;
    // scale bar
    const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000], mm = nice.find(v => v * cam.s >= 70) || 2000, L = mm * cam.s;
    c.fillStyle = 'rgba(9,12,15,.8)'; c.fillRect(10, H - 34, L + 20, 24);
    c.strokeStyle = '#ecf0f3'; c.lineWidth = 2; c.beginPath(); c.moveTo(20, H - 18); c.lineTo(20 + L, H - 18); c.moveTo(20, H - 23); c.lineTo(20, H - 13); c.moveTo(20 + L, H - 23); c.lineTo(20 + L, H - 13); c.stroke();
    c.fillStyle = '#ecf0f3'; c.font = '600 11px "JetBrains Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText(mm >= 1000 ? `${mm / 1000} m` : `${mm} mm`, 20 + L / 2, H - 20);
    // clock
    if (!sim) return;
    c.textAlign = 'right'; c.textBaseline = 'top'; c.font = '700 13px "JetBrains Mono", monospace';
    c.fillStyle = 'rgba(9,12,15,.8)';
    const tt = state === 'flight' ? '⏩ following the bits' : state === 'debris' ? '⏩ real time' : `t = ${(sim.time - (VR && VR.run ? sim.shotT0 || 0 : 0)).toFixed(1)} µs`, tw = c.measureText(tt).width;
    const cy = W - tw - 22 < tagEnd + 8 ? 30 : 8;   // narrow screen: drop below the label
    c.fillRect(W - tw - 22, cy, tw + 14, 24); c.fillStyle = '#ffb020'; c.fillText(tt, W - 15, cy + 5);
  }
  function reticle(c, from, at, color, miss, small) {
    c.save(); c.setLineDash([6, 6]); c.strokeStyle = miss ? 'rgba(232,106,92,.7)' : `rgba(255,176,32,${small ? 0.45 : 0.7})`; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(toSX(from[0]), toSY(from[1])); c.lineTo(toSX(at[0]), toSY(at[1])); c.stroke(); c.restore();
    if (miss) return;
    const x = toSX(at[0]), y = toSY(at[1]), r = small ? 5 : 9, a = small ? 9 : 15;
    c.strokeStyle = color; c.lineWidth = 2; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.moveTo(x - a, y); c.lineTo(x + a, y); c.moveTo(x, y - a); c.lineTo(x, y + a); c.stroke();
  }
  function countTag(c, at, n) {   // "×5" next to the aim point: that many shots come down this line
    const x = toSX(at[0]) + 14, y = toSY(at[1]) - 14;
    c.font = '700 13px "JetBrains Mono", monospace'; c.textAlign = 'left'; c.textBaseline = 'bottom';
    c.fillStyle = 'rgba(9,12,15,.8)'; c.fillRect(x - 3, y - 17, c.measureText(`×${n}`).width + 6, 18);
    c.fillStyle = '#ffb020'; c.fillText(`×${n}`, x, y);
  }
  function drawEffects(c, now) {
    if (state === 'flight' && VR.fl) {   // an explosive shell's fragments (they aren't particles, so each is shown as a dot)
      const d0 = (now - VR.flT0) / 1000 * VR.vs;
      c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = 'rgba(255,214,90,.9)';
      for (const f of VR.fl.frags) {
        const d = d0 - (f.delay || 0); if (d <= 0 || d > f.stop) continue;
        c.fillRect(toSX(f.x + f.dx * d) - 1.5, toSY(f.y + f.dy * d) - 1.5, 3, 3);
      }
      c.restore();
    }
    // fire and smoke
    const t = now / 1000;
    VR.veh.modules.forEach((m, k) => {
      if (m.type !== 'fuel' || shownState(k, now) !== 2) return;
      if (!VR.fireAt) VR.fireAt = now;
      for (let j = 0; j < 7; j++) {
        const f = (t * 1.6 + j / 7) % 1, x = m.x + m.w * (0.15 + 0.7 * ((j * 0.37) % 1)), y = m.y + m.h * 0.3 + f * (m.h * 0.9 + 500);
        c.fillStyle = `rgba(255,${Math.round(120 + 100 * (1 - f))},40,${0.55 * (1 - f)})`;
        c.beginPath(); c.arc(toSX(x), toSY(y), Math.max(3, (90 + 120 * (1 - f)) * cam.s), 0, Math.PI * 2); c.fill();
      }
    });
    if (VR.boom) {
      const a = (now - VR.boom.at) / 1000;
      for (let j = 0; j < 9; j++) {
        const f = ((a * 0.35 + j / 9) % 1), x = VR.boom.x + Math.sin(j * 2.1) * 500 * f, y = VR.boom.y + 400 + f * 2600;
        c.fillStyle = `rgba(70,74,80,${0.35 * (1 - f) * Math.min(1, a * 2)})`;
        c.beginPath(); c.arc(toSX(x), toSY(y), (250 + 700 * f) * cam.s, 0, Math.PI * 2); c.fill();
      }
    }
  }

  // ===================== Results =====================
  const SB_WORDS = {
    pen: ['good', '✓ PENETRATED'], stop: ['crit', '✗ STOPPED'], rico: ['serious', '↗ RICOCHET'], spall: ['warn', '💥 SPALLED'],
  };
  // several shots at once: how many did what (t = sim.tally)
  function tallyBadge(v, t) {
    const k = t[v] === t.n ? (t.n === 2 ? 'BOTH' : `ALL ${t.n}`) : `${t[v]} OF ${t.n}`;
    return { pen: `✓ ${k} GOT THROUGH`, spall: `💥 ${k} SPALLED`, rico: `↗ ${k} BOUNCED`, stop: `✗ ${k} STOPPED` }[v];
  }
  function tallyWords(t, kind) {   // "3 got through, 1 was stopped and 1 bounced off"
    const W = { pen: ['got through', 'got through'], spall: kind === 'hesh' ? ['knocked a scab off the inside', 'knocked scabs off the inside'] : ['broke bits off the inside', 'broke bits off the inside'],
      rico: ['bounced off', 'bounced off'], stop: ['was stopped', 'were stopped'] };
    const bits = ['pen', 'spall', 'rico', 'stop'].filter(k => t[k]).map(k => `${t[k] === t.n ? (t.n === 2 ? 'both' : `all ${t.n}`) : t[k]} ${W[k][t[k] === 1 ? 0 : 1]}`);
    return bits.length > 1 ? `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}` : bits[0];
  }
  function formulaEstimate(P, v) {   // the classic formulas from the Calculator, for comparison
    const d = P.d, g = P.group;
    if (P.kind === 'heat') return Math.round(d.q * d.cal);   // a shaped charge goes about its design depth
    if (g === 'Strange darts (made up)') return null;          // the formula only knows tungsten and uranium
    let s = null;
    if (P.kind === 'hesh') s = { type: 'hesh', cal: d.cal };
    else if (P.kind === 'he') s = { type: 'he', cal: d.cal };
    else if (d.shape === 'rod') s = { type: 'apfsds', len: d.len, v };
    else if (/APCR/.test(g)) s = { type: 'apcr', cal: P.bore || d.cal, v };
    else if (P.bore) s = { type: 'apds', cal: P.bore, v };
    else if (d.shape === 'shell') s = { type: 'ap', cal: d.cal, v };
    return s ? Math.round(penAt(s, 0)) : null;
  }
  function liveLine() {
    const r = sim.res;
    let awake = '';
    if (VR && VR.run) { let a = 0; for (let q = 0; q < sim.an; q++) a += sim.awake[sim.alist[q]]; awake = ` · ${a.toLocaleString()} awake`; }
    const many = sim.rounds && sim.rounds.length > 1 && (state === 'running' || state === 'approach') ? `🎯 ${sim.rounds.filter(R => R.hitAt).length} of ${sim.rounds.length} shots in · ` : '';
    return `${VR && VR.run ? `Shot ${VR.shots} · ` : ''}${many}⏱ ${(sim.time - (VR && VR.run ? sim.shotT0 || 0 : 0)).toFixed(0)} µs · ${sim.n.toLocaleString()} particles${awake} · ${sim.broken.toLocaleString()} bonds snapped · 🔥 hottest ${Math.round((sim.maxT || 293) - 273).toLocaleString()} °C${r && r.depth ? ` · deepest ${Math.round(r.depth)} mm` : ''}`;
  }
  function renderLive() { $('sb-live').textContent = sim ? liveLine() : ''; }
  const estHTML = (P, est) => est ? `<p class="sb-est">📏 Classic formula: this ${esc(P.name)} beats about <b>${est.toLocaleString()} mm</b> of flat armor steel${P.kind === 'ke' ? ` at ${speedOf().toLocaleString()} m/s` : ''}. The sim is a 2D slice, so it won't match exactly.</p>` : '';
  function renderResult() {
    const box = $('sb-result'), P = projDef();
    if (ED) { box.innerHTML = '<span class="badge idle">BUILDING</span><div class="txt">You\'re building a vehicle. Press <b>Save &amp; try it</b> to shoot at it.</div>'; $('sb-live').textContent = ''; return; }
    if (!sim) return;
    if (VR && VR.run) { renderVehResult(); return; }
    if (state !== 'done') {
      const msg = state === 'ready' ? 'Press <b>Fire</b> (or Space). Click the armor to aim somewhere else.' : 'Simulating… every particle is doing its own physics.';
      box.innerHTML = `<span class="badge idle">${state === 'ready' ? 'READY' : 'LIVE'}</span><div class="txt">${msg}</div>`;
      $('sb-live').textContent = state === 'ready' ? `${sim.n.toLocaleString()} particles · ${sim.nb.toLocaleString()} bonds · particle size ${sim.h.toFixed(sim.h < 1 ? 2 : 1)} mm` : liveLine();
      return;
    }
    const r = sim.measure(), v = verdict, t = sim.tally, [st, badge0] = SB_WORDS[v] || SB_WORDS.stop, badge = t ? tallyBadge(v, t) : badge0, est = formulaEstimate(P, speedOf());
    const kind = P.kind;
    let text;
    if (t) text = `${t.n} shots at once: ${tallyWords(t, kind)}.${t.pen && kind !== 'he' && r.residual ? ` The fastest came out at ${Math.round(r.residual * 1000).toLocaleString()} m/s.` : ''}${!t.pen && (kind === 'ke' || kind === 'heat') ? ` The deepest got ${Math.round(r.depth)} mm in.` : ''}`;
    else if (v === 'pen') text = kind === 'heat' ? `The jet cut all the way through${r.residual ? ` and came out at ${Math.round(r.residual * 1000).toLocaleString()} m/s` : ''}.` : kind === 'he' ? 'The blast tore through and sent fragments out the back.' : r.residual < 0.05 ? 'It only just got through, with almost no speed left.' : `It punched all the way through and came out at ${Math.round(r.residual * 1000).toLocaleString()} m/s.`;
    else if (v === 'rico') text = 'The shell glanced off the armor.';
    else if (v === 'spall') text = kind === 'hesh' ? 'The shock wave knocked a scab of metal off the inside of the armor.' : `It didn't get through, but pieces broke off the inside (spall). Deepest point: ${Math.round(r.depth)} mm.`;
    else text = kind === 'hesh' ? 'The shock wave wasn\'t strong enough to knock anything off the inside.' : kind === 'he' ? 'The blast didn\'t get through.' : `The armor held. The deepest the ${kind === 'heat' ? 'jet' : 'shell'} got was ${Math.round(r.depth)} mm.`;
    const stats = [
      t ? ['Got through', `${t.pen} of ${t.n}`] : null,
      v === 'pen' && kind !== 'he' ? ['Exit speed', `${Math.round(r.residual * 1000).toLocaleString()} m/s`] : ['Deepest point', `${Math.round(r.depth)} mm`],
      kind === 'ke' ? ['Shell left', `${Math.round(r.massLeft * 100)}%`] : null,
      ['Hottest', `${Math.round(r.maxT - 273).toLocaleString()} °C`],
      ['Bits behind armor', (r.spall + (v === 'pen' ? r.behind : 0)).toLocaleString()],
      ['Bonds snapped', sim.broken.toLocaleString()],
      ['Simulated time', `${Math.round(sim.time)} µs`],
    ].filter(Boolean);
    box.innerHTML = `<span class="badge ${st}">${badge}</span><div class="txt">${esc(text)}
      <div class="sb-stats">${stats.map(([k, val]) => `<div><small>${k}</small><b>${val}</b></div>`).join('')}</div>
      ${estHTML(P, est)}</div>`;
    $('sb-live').textContent = liveLine();
  }
  function armorLine(L) {   // what happened at the armor on the last shot, in words
    const g = L.group, kind = L.P.kind, what = g.map(h => h.part.n.toLowerCase()).join(' and the '), los = g.reduce((s, h) => s + h.T / Math.max(0.05, h.cos), 0);
    const ang = Math.round(Math.acos(Math.min(1, g[0].cos)) / DEG), armor = `the ${what} (${g.map(h => `${h.T} mm`).join(' + ')} at ${ang}° = ${Math.round(los)} mm in the way)`;
    if (L.tally) return `${L.tally.n} shots at ${armor}: ${tallyWords(L.tally, kind)}.${L.missed ? ` (${L.missed} more missed the armor.)` : ''}`;
    if (L.v === 'pen') return kind === 'heat' ? `✓ The jet cut through ${armor}.` : kind === 'he' ? `✓ The blast broke through ${armor}.` : L.resid < 0.05 ? `✓ It only just got through ${armor}, with almost no speed left.` : `✓ It punched through ${armor} and flew on at ${Math.round(L.resid * 1000).toLocaleString()} m/s.`;
    if (L.v === 'rico') return `↗ It bounced off ${armor}.`;
    if (L.v === 'spall') return `💥 It didn't get through ${armor}, but bits broke off the inside.`;
    return `✗ ${armor.charAt(0).toUpperCase() + armor.slice(1)} stopped it.`;
  }
  function renderVehResult() {
    const box = $('sb-result'), veh = VR.veh, run = VR.run;
    if (!VR.shots) {
      box.innerHTML = `<span class="badge idle">READY</span><div class="txt">The whole ${esc(veh.name)} is made of ${sim.n.toLocaleString()} particles. Click where you want to hit, then press <b>Fire</b>. Damage stays, so you can keep shooting it; <b>Repair</b> fixes it.</div>`;
      $('sb-live').textContent = `${sim.n.toLocaleString()} particles · ${sim.nb.toLocaleString()} bonds · particle size ${sim.h.toFixed(1)} mm`;
      return;
    }
    if (state !== 'done') {
      const msg = state === 'approach' || state === 'running' ? 'Simulating the hit… every particle is doing its own physics.' : state === 'inside' ? 'Bits are flying around inside…' : state === 'flight' ? 'Following the bits flying around inside…' : state === 'blast' ? '💥 The ammo exploded!' : state === 'debris' ? '💥 Pieces are flying off…' : 'Paused.';
      box.innerHTML = `<span class="badge idle">LIVE</span><div class="txt">${VR.last ? esc(armorLine(VR.last)) + '<br>' : ''}${msg}</div>`;
      $('sb-live').textContent = liveLine(); return;
    }
    const { states, fate } = V.fateOf(run), L = VR.last, P = L ? L.P : projDef();
    let line = L ? armorLine(L) : '';
    if (VR.burst) line += L && L.tally ? ` Then ${VR.burst === 1 ? 'one of them' : VR.burst} burst inside!` : ' Then its explosive filling went off inside!';
    const order = V.MOD_KEYS, mods = veh.modules.map((m, k) => ({ m, k, s: states[k] })).sort((a, b) => order.indexOf(a.m.type) - order.indexOf(b.m.type));
    const chips = mods.map(({ m, s }) => `<span class="mchip s${s}">${V.MODULES[m.type].icon} ${esc(m.n)} <b>${s === 2 ? '✖ ' : s === 1 ? '⚠ ' : '✓ '}${V.MODULES[m.type].words[s]}</b></span>`).join('');
    const crew = veh.modules.filter(m => m.type === 'crew').length, ko = mods.filter(x => x.m.type === 'crew' && x.s === 2).length;
    const g = L && L.group, los = g ? g.reduce((s, h) => s + h.T / Math.max(0.05, h.cos), 0) : 0;
    const stats = [
      ['Shots fired', VR.shots.toLocaleString()],
      L && L.tally ? ['Got through', `${L.tally.pen} of ${L.tally.n}`] : null,
      g ? ['Armor hit', esc(g[0].part.n)] : null, g ? ['In the way', `${Math.round(los)} mm`] : null,
      L ? (L.v === 'pen' && P.kind !== 'he' ? ['Exit speed', `${Math.round(L.resid * 1000).toLocaleString()} m/s`] : ['Deepest point', `${Math.round(L.depth)} mm`]) : null,
      crew ? ['Crew out', `${ko} of ${crew}`] : null,
    ].filter(Boolean);
    box.innerHTML = `<span class="badge ${fate.st}">${fate.badge}</span><div class="txt">${esc(line)} ${esc(fate.text)}${fate.id === 'fine' || fate.id === 'damaged' ? ' Fire again: the damage stays.' : ''}
      <div class="mchips">${chips}</div>
      <div class="sb-stats">${stats.map(([k, val]) => `<div><small>${k}</small><b>${val}</b></div>`).join('')}</div>
      ${estHTML(P, formulaEstimate(P, speedOf()))}</div>`;
    $('sb-live').textContent = liveLine();
  }

  // ===================== Challenges =====================
  // ✏️ Goals to try. Each test gets what just happened: veh (vehicle id, or null for plain armor), P (the round), v (how it went at the armor),
  // tally (several shots at once), and for vehicles from, fate, out (destroyed or knocked out), turret (thrown off), shots (since the last repair),
  // missed, saved (crew a capsule kept alive) and fuelFire; for plain armor held, thick and preset.
  const gunSize = P => (P.group === 'Rockets & missiles' || P.group === 'Just for fun' ? Infinity : P.bore || (P.d.shape === 'rod' ? Infinity : P.d.cal));
  const CHALLENGES = [
    { id: 'bounce', text: 'Bounce a shell off a vehicle', test: c => c.veh && (c.v === 'rico' || !!(c.tally && c.tally.rico)) },
    { id: 'tiger76', text: 'Knock out a Tiger I from the front with a gun smaller than 80 mm', test: c => c.veh === 'tiger' && c.from === 'front' && gunSize(c.P) < 80 && c.out },
    { id: 'turret', text: 'Blow a turret off', test: c => c.turret },
    { id: 'tiger2', text: 'Destroy a Tiger II from the front with a single shot', test: c => c.veh === 'tiger2' && c.from === 'front' && c.shots === 1 && c.fate === 'destroyed' },
    { id: 'maus', text: 'Get a shot through the front of the Maus', test: c => c.veh === 'maus' && c.from === 'front' && c.v === 'pen' },
    { id: 'roof', text: 'Knock out a modern tank from above', test: c => c.modern && c.from === 'top' && c.out },
    { id: 'bmp', text: 'Set a BMP-1 on fire with a bullet (its back doors are fuel tanks)', test: c => c.veh === 'bmp1' && c.P.group === 'Bullets' && c.fuelFire },
    { id: 'five', text: 'Hit the same vehicle 5 times without repairing it', test: c => c.veh && c.shots >= 5 },
    { id: 'rpg', text: 'Stop an RPG-7 with armor less than 200 mm thick (all the layers added up)', test: c => !c.veh && c.P.id === 'rpg7' && c.held && c.thick < 200 },
    { id: 'vest', text: 'Stop a 12.7 mm AP bullet with armor less than 40 mm thick', test: c => !c.veh && c.P.id === 'b127' && c.held && c.thick < 40 },
    { id: 'plutonium', text: 'Get the plutonium dart through 500 mm of armor (it won\'t go nuclear)', test: c => !c.veh && c.P.id === 'fspu' && c.v === 'pen' && c.thick >= 500 },
    { id: 'ship', text: 'Put a cannonball right through the side of a wooden warship', test: c => !c.veh && /^cannon/.test(c.P.id) && c.v === 'pen' && c.preset === 'ship' },
    { id: 'semple', text: 'Knock out the Bob Semple tank with a bullet', test: c => c.veh === 'semple' && c.P.group === 'Bullets' && c.out },
    { id: 'capsule', text: 'Blow up a T-14\'s ammo while its crew lives through it in their capsule', test: c => c.veh === 't14' && c.fate === 'destroyed' && c.saved > 0 },
    { id: 'volley8', text: 'Get all 8 shots of an 8-shot volley through', test: c => !!c.tally && c.tally.n === 8 && c.tally.pen === 8 && !c.missed },
  ];
  let won = store.get('armor-challenges', {}) || {};
  function checkChallenges(c) {
    const fresh = CHALLENGES.filter(ch => !won[ch.id] && ch.test(c));
    if (!fresh.length) return;
    fresh.forEach(ch => { won[ch.id] = Date.now(); });
    store.set('armor-challenges', won);
    renderChallenges(fresh.map(ch => ch.id));
    toast(`🏆 Challenge done: ${fresh[0].text}${fresh.length > 1 ? ` (and ${fresh.length - 1} more)` : ''}`);
  }
  function renderChallenges(fresh = []) {
    const n = CHALLENGES.filter(ch => won[ch.id]).length;
    $('sb-ch-count').textContent = `${n} / ${CHALLENGES.length}`;
    $('sb-ch-list').innerHTML = CHALLENGES.map(ch => `<li class="${won[ch.id] ? 'done' : ''}${fresh.includes(ch.id) ? ' new' : ''}"><span class="ck" aria-hidden="true">${won[ch.id] ? '✓' : '○'}</span><span><span class="sr-only">${won[ch.id] ? 'Done: ' : 'Not done yet: '}</span>${esc(ch.text)}</span></li>`).join('');
    $('sb-ch-reset').hidden = !n;
  }
  $('sb-ch-reset').addEventListener('click', () => { if (!confirm('Start all the challenges over?')) return; won = {}; store.set('armor-challenges', won); renderChallenges(); });

  // ===================== Controls =====================
  const groups = [...new Set(E.PROJECTILES.map(p => p.group))];
  $('sb-proj').innerHTML = groups.map(g => `<optgroup label="${esc(g)}">${E.PROJECTILES.filter(p => p.group === g).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</optgroup>`).join('');
  $('sb-preset').innerHTML = E.ARMORS.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('') + '<option value="custom">Custom (your own)</option>';
  const matGroups = [...new Set(E.MAT_KEYS.map(k => E.MATERIALS[k].group))];
  const matOptions = sel => matGroups.map(g => `<optgroup label="${esc(g)}">${E.MAT_KEYS.filter(k => E.MATERIALS[k].group === g && !E.MATERIALS[k].hidden).map(k => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(E.MATERIALS[k].name)}</option>`).join('')}</optgroup>`).join('');
  const seg = (id, map, cur, key) => { $(id).innerHTML = Object.entries(map).map(([k, v]) => `<button data-${key}="${k}" class="${k === cur ? 'on' : ''}">${Array.isArray(v) ? v[0] : v}</button>`).join(''); };

  function renderProjControls() {
    const P = projDef();
    $('sb-proj').value = P.id;
    const ke = P.kind === 'ke';
    $('sb-v-field').hidden = !ke; $('sb-v-note').hidden = ke && !P.aphe && !P.note;
    if (ke) { $('sb-v').value = speedOf(); $('sb-v-out').textContent = speedOf().toLocaleString() + ' m/s'; }
    $('sb-v-note').textContent = P.note ? P.note : P.aphe ? 'Has a little explosive inside: if it gets into a vehicle, it goes off a moment later.' : P.d.tandem ? 'Two charges: a small one sets off reactive armor first, then the main jet goes through.' : P.kind === 'heat' ? 'Speed doesn\'t matter: the jet does the work (its tip flies at ' + P.d.vTip + ' km/s).' : 'Speed doesn\'t matter: it works by exploding on contact.';
    $('sb-aim').value = SB.aim; $('sb-aim-out').textContent = (SB.aim > 0 ? '+' : '') + SB.aim + ' mm';
    $('sb-proj-art').innerHTML = projSVG(P);
    const d = P.d, size = d.shape === 'rod' ? `${d.dia} mm × ${d.len} mm rod` : `${P.bore ? P.bore + ' mm gun, ' + d.cal + ' mm penetrator' : d.cal + ' mm'}${d.len ? ' · ' + d.len + ' mm long' : ''}`;
    $('sb-proj-info').textContent = size + (d.core ? ` · ${E.MATERIALS[d.core.mat].name.toLowerCase()} core` : '') + ` · ${E.MATERIALS[d.mat || (P.kind === 'heat' ? 'cu' : 'shot')].name.toLowerCase()}`;
    renderVolley();
  }
  function renderVolley() {
    $('sb-count').innerHTML = COUNTS.map(n => `<button data-count="${n}" class="${n === SB.count ? 'on' : ''}" aria-pressed="${n === SB.count}">${n}</button>`).join('');
    document.querySelectorAll('#sb-pattern [data-pattern]').forEach(b => { b.classList.toggle('on', b.dataset.pattern === SB.pattern); b.setAttribute('aria-pressed', b.dataset.pattern === SB.pattern); });
    $('sb-vol-more').hidden = SB.count < 2;
    $('sb-gap').value = SB.gap; $('sb-gap-out').textContent = SB.gap + ' mm';
    $('sb-gap-label').textContent = SB.pattern === 'row' ? 'Space between one and the next' : 'Space between them';
  }
  function projSVG(P) {   // a little side view of the projectile, drawn from its real shape
    const sh = E.makeShape(P.d), len = sh.x1 - sh.x0, r = sh.r, W = 200, Hh = 50, sc = Math.min((W - 10) / len, (Hh - 8) / (2 * r));
    let rects = '';
    const step = Math.max(len, 2 * r) / 70;
    for (let x = sh.x0; x <= 0; x += step) for (let y = -r; y <= r; y += step) {
      const m = sh.at(x, y); if (!m) continue;
      rects += `<rect x="${(W - 5 - (0 - x) * sc).toFixed(1)}" y="${(Hh / 2 - y * sc - step * sc / 2).toFixed(1)}" width="${(step * sc + 0.6).toFixed(1)}" height="${(step * sc + 0.6).toFixed(1)}" fill="${E.MATERIALS[m].color}"/>`;
    }
    return `<svg viewBox="0 0 ${W} ${Hh}" aria-hidden="true">${rects}</svg>`;
  }
  const layerRows = (layers, act) => layers.map((l, j) => `<div class="layer"><i style="background:${E.MATERIALS[l.mat].color}"></i><select data-${act}="mat" data-j="${j}" aria-label="Layer ${j + 1} material">${matOptions(l.mat)}</select><input type="number" data-${act}="t" data-j="${j}" min="1" max="1000" value="${l.t}" aria-label="Layer ${j + 1} thickness in mm"><span>mm</span>${layers.length > 1 ? `<button class="mini" data-${act}="dell" data-j="${j}" aria-label="Remove layer ${j + 1}">✕</button>` : '<span class="mini-gap"></span>'}</div>`).join('');
  function renderPlates() {
    $('sb-preset').value = SB.preset && E.ARMORS.some(a => a.id === SB.preset) ? SB.preset : 'custom';
    $('sb-plates').innerHTML = SB.plates.map((p, i) => {
      const T = E.plateThickness(p);
      return `<div class="plate-card" data-i="${i}">
        <div class="pc-head"><b>Plate ${i + 1}</b><span>${T} mm · ${p.ang}°</span>
          <button class="mini" data-act="dup" title="Copy this plate" aria-label="Copy plate ${i + 1}">⧉</button>${SB.plates.length > 1 ? `<button class="mini" data-act="del" title="Remove this plate" aria-label="Remove plate ${i + 1}">✕</button>` : ''}</div>
        <div class="pc-sub">Layers, outside → inside</div>
        ${layerRows(p.layers, 'act')}
        <button class="mini wide" data-act="addl">+ Add a layer</button>
        <div class="field"><label>Angle</label><output>${p.ang}°</output><input type="range" data-act="ang" min="-80" max="80" step="1" value="${p.ang}" aria-label="Plate ${i + 1} angle"></div>
        ${i > 0 ? `<div class="field"><label>Distance from plate 1</label><output>${p.x} mm</output><input type="range" data-act="x" min="0" max="1200" step="5" value="${p.x}" aria-label="Plate ${i + 1} distance"></div>` : ''}
      </div>`;
    }).join('');
  }
  function renderTarget() {
    const veh = SB.target === 'vehicle';
    document.querySelectorAll('#sb-target [data-target]').forEach(b => b.classList.toggle('on', b.dataset.target === SB.target));
    $('sb-target').hidden = !!ED;
    $('sb-armor-panel').hidden = veh || !!ED; $('sb-veh-panel').hidden = !veh || !!ED; $('sb-ed-panel').hidden = !ED;
    $('sb-target-kind').textContent = ED ? 'builder' : veh ? 'vehicles' : 'cut-aways';
    $('sb-aim-field').hidden = veh;
    cv.parentElement.classList.toggle('veh', veh || !!ED);
    cv.setAttribute('aria-label', veh ? 'Side cut-away of the vehicle, all made of particles. Click it to choose where the shell hits.' : 'Particle simulation of the projectile and the armor. Drag to look around, scroll to zoom, click the armor to aim.');
    if (!veh || ED) return;
    const list = allVeh(), vg = [...new Set(list.map(v => v.group))];
    $('sb-veh').innerHTML = vg.map(g => `<optgroup label="${esc(g)}">${list.filter(v => v.group === g).map(v => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('')}</optgroup>`).join('');
    const v = vehDef(); $('sb-veh').value = v.id;
    const crew = v.modules.filter(m => m.type === 'crew').length;
    $('sb-veh-info').textContent = `${v.from && v.from !== 'Made up' ? `${v.from} · ${v.year} · ` : ''}${crew} crew. ${v.about || 'Your own design.'}`;
    document.querySelectorAll('#sb-from [data-from]').forEach(b => b.classList.toggle('on', b.dataset.from === SB.from));
    $('sb-tilt').value = SB.tilt; $('sb-tilt-out').textContent = SB.tilt === 0 ? 'level' : SB.tilt > 0 ? `${SB.tilt}° down` : `${-SB.tilt}° up`;
    $('sb-veh-edit').textContent = v.mine ? '✏️ Edit this vehicle' : '✏️ Copy and edit';
  }
  let hover = null;
  function renderAimInfo(hoverPt) {
    if (SB.target !== 'vehicle' || ED) return;
    const veh = vehDef(), shot = hoverPt ? { ...shotOf(veh), at: hoverPt } : shotOf(veh), pr = V.probe(veh, shot, VR && VR.veh === veh ? VR.run : null);
    const aims = !hoverPt && VR && VR.aims && VR.aims.length ? VR.aims : null, miss = aims ? aims.filter(a => !a.e).length : 0;
    const many = aims ? ` <br>${SB.pattern === 'row' ? `${aims.length} shots, one after another` : `${aims.length} shots side by side`}${miss ? `: <b>${miss} of them miss the armor</b>` : ''}.` : '';
    $('sb-aim-info').innerHTML = (pr
      ? `🎯 ${hoverPt ? 'Pointing at' : 'Aiming at'} ${pr.map(p => `<b>${esc(p.name)}</b>: ${p.T} mm at ${p.ang}° → <b>${p.los} mm</b> in the way`).join(', then ')}`
      : `🎯 ${hoverPt ? 'No armor there.' : 'Not aimed at the armor.'} Click the vehicle where you want to hit.`) + many;
  }
  function renderControlsState() {
    const running = busyNow();
    $('sb-fire').textContent = state === 'done' ? (VR && VR.run ? '🔥 Fire again' : '🔥 Fire again') : '🔥 Fire';
    $('sb-fire').disabled = running || !!ED || state === 'paused';
    $('sb-pause').disabled = !(physicsOn() || state === 'approach' || state === 'paused');
    $('sb-pause').textContent = state === 'paused' ? '▶ Resume' : '⏸ Pause';
    $('sb-step').disabled = state !== 'paused';
    $('sb-reset').disabled = !!ED || running;
    $('sb-reset').textContent = VR && VR.run ? '🔧 Repair' : '↺ Reset';
    seg('sb-view', VIEWS, SB.view, 'view'); seg('sb-speed', SPEEDS, SB.speed, 'speed'); seg('sb-quality', QUALITY, SB.quality, 'quality');
    $('sb-legend').innerHTML = legendHTML();
  }
  function legendHTML() {
    const bar = stops => `linear-gradient(90deg, ${stops.map(([, c], k) => `rgb(${c.join(',')}) ${Math.round(k / (stops.length - 1) * 100)}%`).join(', ')})`;
    const inside = VR ? [...new Set(VR.veh.modules.map(m => m.type))].map(t => `<span><b style="color:${V.MODULES[t].color}">■</b> ${V.MODULES[t].icon} ${esc(V.MODULES[t].name)}</span>`).join('') : '';
    if (SB.view === 'heat') return `<span>🔥 Temperature</span><i style="background:${bar(HEAT)}"></i><span>20 °C → 1,800 °C</span>${inside}`;
    if (SB.view === 'speed') return `<span>💨 Speed</span><i style="background:${bar(SPEED)}"></i><span>still → 3 km/s</span>${inside}`;
    if (SB.view === 'damage') return `<span>💔 Damage</span><i style="background:${bar(DMG)}"></i><span>intact → shattered</span><span><b style="color:#aa6ef0">■</b> torn off</span>${inside}`;
    const used = new Set(VR ? VR.veh.parts.flatMap(p => p.layers.map(l => l.mat)) : SB.plates.flatMap(p => p.layers.map(l => l.mat)));
    return [...used].map(k => `<span><b style="color:${E.MATERIALS[k].color}">■</b> ${esc(E.MATERIALS[k].name)}</span>`).join('') + inside + '<span>· glowing = hot</span>';
  }
  let toastT = 0;
  function toast(msg) { const t = $('sb-toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3400); }

  // events: projectile and plain armor
  const vehMode = () => SB.target === 'vehicle';
  const projChanged = () => { if (vehMode()) { if (!busyNow()) renderResult(); aimChanged(); } else rebuildSoon(); };   // a vehicle keeps its damage: the new shell is used for the next shot
  $('sb-proj').addEventListener('change', e => { SB.proj = e.target.value; SB.v = null; renderProjControls(); saveSB(); projChanged(); });
  $('sb-v').addEventListener('input', e => { SB.v = +e.target.value; $('sb-v-out').textContent = SB.v.toLocaleString() + ' m/s'; saveSB(); projChanged(); });
  $('sb-count').addEventListener('click', e => {
    const b = e.target.closest('[data-count]'); if (!b) return;
    SB.count = +b.dataset.count; renderVolley(); saveSB(); projChanged();
  });
  $('sb-pattern').addEventListener('click', e => {
    const b = e.target.closest('[data-pattern]'); if (!b) return;
    SB.pattern = b.dataset.pattern; renderVolley(); saveSB(); projChanged();
  });
  $('sb-gap').addEventListener('input', e => { SB.gap = +e.target.value; $('sb-gap-out').textContent = SB.gap + ' mm'; saveSB(); projChanged(); });
  $('sb-aim').addEventListener('input', e => { SB.aim = +e.target.value; $('sb-aim-out').textContent = (SB.aim > 0 ? '+' : '') + SB.aim + ' mm'; rebuildSoon(); });
  $('sb-preset').addEventListener('change', e => {
    const a = E.ARMORS.find(x => x.id === e.target.value); if (!a) return;
    SB.preset = a.id; SB.plates = clone(a.plates).map(p => ({ ...p, len: p.len || 'auto' })); SB.aim = 0;
    renderPlates(); renderProjControls(); rebuildSoon();
  });
  const customized = () => { SB.preset = 'custom'; $('sb-preset').value = 'custom'; };
  $('sb-plates').addEventListener('input', e => {
    const card = e.target.closest('.plate-card'); if (!card) return;
    const p = SB.plates[+card.dataset.i], act = e.target.dataset.act;
    if (act === 'ang') { p.ang = +e.target.value; e.target.previousElementSibling.textContent = p.ang + '°'; card.querySelector('.pc-head span').textContent = `${E.plateThickness(p)} mm · ${p.ang}°`; }
    else if (act === 'x') { p.x = +e.target.value; e.target.previousElementSibling.textContent = p.x + ' mm'; }
    else if (act === 't') { const v = clamp(Math.round(+e.target.value || 0), 1, 1000); if (!+e.target.value) return; p.layers[+e.target.dataset.j].t = v; card.querySelector('.pc-head span').textContent = `${E.plateThickness(p)} mm · ${p.ang}°`; }
    else return;
    customized(); rebuildSoon();
  });
  $('sb-plates').addEventListener('change', e => {
    const card = e.target.closest('.plate-card'); if (!card || e.target.dataset.act !== 'mat') return;
    SB.plates[+card.dataset.i].layers[+e.target.dataset.j].mat = e.target.value;
    customized(); renderPlates(); renderControlsState(); rebuildSoon();
  });
  $('sb-plates').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const card = b.closest('.plate-card'), i = +card.dataset.i, p = SB.plates[i], act = b.dataset.act;
    if (act === 'dup') { const c = clone(p); c.x = p.x + E.plateThickness(p) / Math.max(0.2, Math.cos(p.ang * DEG)) + 60; SB.plates.splice(i + 1, 0, c); }
    else if (act === 'del') SB.plates.splice(i, 1);
    else if (act === 'addl') p.layers.push({ mat: 'rha', t: 20 });
    else if (act === 'dell') p.layers.splice(+b.dataset.j, 1);
    customized(); tidyPlates(); renderPlates(); rebuildSoon();
  });
  $('sb-add-plate').addEventListener('click', () => {
    const last = SB.plates[SB.plates.length - 1];
    if (SB.plates.length >= 6) return;
    SB.plates.push({ x: last.x + E.plateThickness(last) / Math.max(0.2, Math.cos(last.ang * DEG)) + 150, ang: 0, len: 'auto', layers: [{ mat: 'rha', t: 30 }] });
    customized(); renderPlates(); rebuildSoon();
  });
  // events: vehicles
  $('sb-target').addEventListener('click', e => {
    const b = e.target.closest('[data-target]'); if (!b || b.dataset.target === SB.target || busyNow()) return;
    SB.target = b.dataset.target; saveSB(); renderTarget(); renderControlsState(); rebuild();
  });
  $('sb-veh').addEventListener('change', e => { SB.veh = e.target.value; SB.vaim = null; saveSB(); renderTarget(); rebuild(); });
  $('sb-from').addEventListener('click', e => {
    const b = e.target.closest('[data-from]'); if (!b) return;
    SB.from = b.dataset.from; saveSB(); renderTarget(); aimChanged();
  });
  $('sb-tilt').addEventListener('input', e => { SB.tilt = +e.target.value; $('sb-tilt-out').textContent = SB.tilt === 0 ? 'level' : SB.tilt > 0 ? `${SB.tilt}° down` : `${-SB.tilt}° up`; saveSB(); aimChanged(); });
  $('sb-veh-edit').addEventListener('click', () => { if (!busyNow()) startEdit(vehDef(), false); });
  $('sb-veh-new').addEventListener('click', () => { if (!busyNow()) startEdit(null, true); });
  // events: the bar under the picture
  $('sb-fire').addEventListener('click', fire);
  $('sb-reset').addEventListener('click', () => { if (!busyNow()) { rebuild(!!VR); if (VR && VR.run) toast('Good as new!'); } });
  $('sb-pause').addEventListener('click', () => {
    if (physicsOn() || state === 'approach') { paused = state === 'approach' ? 'running' : state; state = 'paused'; }
    else if (state === 'paused') { state = paused || 'running'; paused = null; runStart = performance.now(); lastNow = 0; loop(); }
    renderControlsState();
  });
  $('sb-step').addEventListener('click', () => {
    if (state !== 'paused') return;
    for (let k = 0; k < 20; k++) sim.step();
    renderLive(); draw();
  });
  $('stage-sandbox').addEventListener('click', e => {
    const v = e.target.closest('[data-view]'), sp = e.target.closest('[data-speed]'), q = e.target.closest('[data-quality]');
    if (v) { SB.view = v.dataset.view; saveSB(); renderControlsState(); draw(); }
    if (sp) { SB.speed = sp.dataset.speed; saveSB(); renderControlsState(); }
    if (q && !busyNow()) { SB.quality = q.dataset.quality; saveSB(); renderControlsState(); if (!ED) rebuild(!!VR); }
  });
  const stopGlide = () => { glide = null; };
  $('sb-zoom-in').addEventListener('click', () => { stopGlide(); cam.s *= 1.3; draw(); });
  $('sb-zoom-out').addEventListener('click', () => { stopGlide(); cam.s /= 1.3; draw(); });
  $('sb-zoom-fit').addEventListener('click', () => { fit(); draw(); });

  // ===================== The vehicle builder =====================
  const SNAP = 10, snap = v => Math.round(v / SNAP) * SNAP;
  const SIZES = { crew: [450, 900], ammo: [800, 320], fuel: [400, 700], engine: [1000, 900], trans: [500, 500], gun: [1000, 180] };
  function startEdit(base, fresh) {
    let v;
    if (fresh || !base) v = V.starter();
    else if (base.mine) v = clone(base);
    else {   // a copy of a ready-made vehicle; its drawn-on gun barrel becomes a setting of the gun box
      const c = clone(base), d = base.deco, gun = c.modules.find(m => m.type === 'gun');
      if (gun && d && d.barrel) gun.barrel = Math.round(gun.x - d.barrel.x1);
      v = V.sanitize({ ...c, id: undefined, name: ('My ' + base.name).slice(0, 40) });
    }
    if (state === 'paused') state = 'idle';
    ED = { veh: v, srcId: base && base.mine && !fresh ? base.id : null, sel: null, drag: null };
    $('ed-name').value = v.name; $('ed-tracks').checked = v.tracks !== false; $('ed-link').hidden = true; $('ed-delete').hidden = !ED.srcId;
    cv.parentElement.classList.add('editing');
    renderTarget(); renderEdSel(); rebuild();
    toast('Builder: drag the handles to shape your vehicle.');
  }
  function endEdit() { ED = null; cv.parentElement.classList.remove('editing'); hover = null; renderTarget(); rebuild(); }
  function cleanVehicle() { return V.sanitize({ ...ED.veh, id: ED.srcId || ED.veh.id, name: $('ed-name').value, tracks: $('ed-tracks').checked }); }
  function renderEdSel() {
    const box = $('ed-sel'), sel = ED && ED.sel;
    if (!sel) { box.innerHTML = '<p class="blurb">Tap a plate or a box in the picture to change it.</p>'; return; }
    if (sel.kind === 'part') {
      const p = ED.veh.parts[sel.i], dx = p.b[0] - p.a[0], dy = p.b[1] - p.a[1], len = Math.round(Math.hypot(dx, dy)), up = Math.round(Math.atan2(Math.abs(dx), Math.abs(dy)) / DEG);
      box.innerHTML = `<div class="ed-sel">
        <div class="pc-head"><b>🧱 Armor plate</b><span>${len} mm long · ${up}° from upright</span><button class="mini" data-ed="dup" title="Copy" aria-label="Copy this plate">⧉</button><button class="mini" data-ed="del" title="Remove" aria-label="Remove this plate">✕</button></div>
        <label class="ed-field">Name <input type="text" data-ed="name" maxlength="40" value="${esc(p.n)}"></label>
        <div class="pc-sub">Layers, outside → inside</div>
        ${layerRows(p.layers, 'ed')}
        <button class="mini wide" data-ed="addl">+ Add a layer</button>
        <label class="toggle"><input type="checkbox" data-ed="turret" ${p.g === 't' ? 'checked' : ''}> Part of the turret</label>
        <button class="mini wide" data-ed="flip">↔ Swap outside and inside</button>
      </div>`;
    } else {
      const m = ED.veh.modules[sel.i];
      box.innerHTML = `<div class="ed-sel">
        <div class="pc-head"><b>${V.MODULES[m.type].icon} ${esc(V.MODULES[m.type].name)}</b><span>${m.w} × ${m.h} mm</span><button class="mini" data-ed="dup" title="Copy" aria-label="Copy this box">⧉</button><button class="mini" data-ed="del" title="Remove" aria-label="Remove this box">✕</button></div>
        <label class="ed-field">What is it? <select data-ed="type">${V.MOD_KEYS.map(k => `<option value="${k}" ${k === m.type ? 'selected' : ''}>${V.MODULES[k].icon} ${esc(V.MODULES[k].name)}</option>`).join('')}</select></label>
        <label class="ed-field">Name <input type="text" data-ed="name" maxlength="40" value="${esc(m.n)}"></label>
        ${m.type === 'gun' ? `<div class="field"><label>Barrel length</label><output>${m.barrel || 0} mm</output><input type="range" data-ed="barrel" min="0" max="7000" step="50" value="${m.barrel || 0}" aria-label="Barrel length"></div>` : ''}
        ${m.type === 'ammo' ? `<label class="toggle"><input type="checkbox" data-ed="vent" ${m.vent ? 'checked' : ''}> Blow-out panels (an explosion vents outside)</label>` : ''}
      </div>`;
    }
  }
  const edChanged = () => { VR.geo = null; draw(); };
  $('ed-sel').addEventListener('input', e => {
    if (!ED || !ED.sel) return;
    const a = e.target.dataset.ed, sel = ED.sel, item = sel.kind === 'part' ? ED.veh.parts[sel.i] : ED.veh.modules[sel.i];
    if (a === 'name') item.n = e.target.value.slice(0, 40) || item.n;
    else if (a === 't') { const v = Math.round(+e.target.value); if (!v) return; item.layers[+e.target.dataset.j].t = clamp(v, 1, 1000); }
    else if (a === 'barrel') { item.barrel = +e.target.value; e.target.previousElementSibling.textContent = item.barrel + ' mm'; }
    else return;
    edChanged();
  });
  $('ed-sel').addEventListener('change', e => {
    if (!ED || !ED.sel) return;
    const a = e.target.dataset.ed, sel = ED.sel, item = sel.kind === 'part' ? ED.veh.parts[sel.i] : ED.veh.modules[sel.i];
    if (a === 'mat') item.layers[+e.target.dataset.j].mat = e.target.value;
    else if (a === 'turret') item.g = e.target.checked ? 't' : 'h';
    else if (a === 'vent') item.vent = e.target.checked;
    else if (a === 'type') { item.type = e.target.value; if (item.n === '' || Object.values(V.MODULES).some(t => t.name === item.n)) item.n = V.MODULES[item.type].name; if (item.type === 'gun' && item.barrel == null) item.barrel = 2500; }
    else return;
    renderEdSel(); edChanged(); renderControlsState();
  });
  $('ed-sel').addEventListener('click', e => {
    const b = e.target.closest('button[data-ed]'); if (!b || !ED || !ED.sel) return;
    const a = b.dataset.ed, sel = ED.sel, list = sel.kind === 'part' ? ED.veh.parts : ED.veh.modules, item = list[sel.i];
    if (a === 'del') { list.splice(sel.i, 1); ED.sel = null; }
    else if (a === 'dup') {
      if ((sel.kind === 'part' && list.length >= 40) || (sel.kind === 'mod' && list.length >= 30)) { toast('That\'s as many as a vehicle can have.'); return; }
      const c = clone(item);
      if (sel.kind === 'part') { c.a = [c.a[0] + 150, c.a[1] - 150]; c.b = [c.b[0] + 150, c.b[1] - 150]; } else { c.x += 120; c.y += 120; }
      list.push(c); ED.sel = { kind: sel.kind, i: list.length - 1 };
    }
    else if (a === 'addl') { if (item.layers.length < 8) item.layers.push({ mat: 'rha', t: 20 }); }
    else if (a === 'dell') item.layers.splice(+b.dataset.j, 1);
    else if (a === 'flip') { const t = item.a; item.a = item.b; item.b = t; item.layers.reverse(); }
    else return;
    renderEdSel(); edChanged();
  });
  $('ed-add').addEventListener('click', e => {
    const b = e.target.closest('[data-add]'); if (!b || !ED) return;
    const type = b.dataset.add, cx = snap(cam.x), cy = snap(Math.max(400, cam.y));
    if (type === 'plate') {
      if (ED.veh.parts.length >= 40) { toast('That\'s as many plates as a vehicle can have.'); return; }
      ED.veh.parts.push({ n: 'Armor plate', a: [cx - 300, cy], b: [cx + 300, cy], g: 'h', layers: [{ mat: 'rha', t: 40 }] });
      ED.sel = { kind: 'part', i: ED.veh.parts.length - 1 };
    } else {
      if (ED.veh.modules.length >= 30) { toast('That\'s as many boxes as a vehicle can have.'); return; }
      const [w, h] = SIZES[type], m = { type, n: V.MODULES[type].name, x: snap(cx - w / 2), y: snap(cy - h / 2), w, h };
      if (type === 'gun') m.barrel = 2500;
      ED.veh.modules.push(m); ED.sel = { kind: 'mod', i: ED.veh.modules.length - 1 };
    }
    renderEdSel(); edChanged(); renderControlsState();
  });
  $('ed-name').addEventListener('input', e => { if (ED) ED.veh.name = e.target.value; });
  $('ed-tracks').addEventListener('change', e => { if (ED) { ED.veh.tracks = e.target.checked; edChanged(); } });
  $('ed-save').addEventListener('click', () => {
    if (!ED) return;
    const v = cleanVehicle();
    if (!v) { toast('Add at least one armor plate first.'); return; }
    const at = mine.findIndex(x => x.id === v.id);
    if (at >= 0) mine[at] = v; else { mine.push(v); if (mine.length > 40) mine.shift(); }
    saveMine(); SB.target = 'vehicle'; SB.veh = v.id; SB.vaim = null; saveSB();
    toast(`Saved “${v.name}”. Click it to aim, then fire!`);
    endEdit();
  });
  $('ed-share').addEventListener('click', async () => {
    if (!ED) return;
    const v = cleanVehicle();
    if (!v) { toast('Add at least one armor plate first.'); return; }
    const url = location.href.split('#')[0] + '#v=' + V.toLink(v), box = $('ed-link');
    box.value = url; box.hidden = false; box.select();
    try { await navigator.clipboard.writeText(url); toast('Link copied! Anyone who opens it gets your vehicle.'); }
    catch (err) { toast('Copy the link below to share your vehicle.'); }
  });
  $('ed-cancel').addEventListener('click', () => endEdit());
  $('ed-delete').addEventListener('click', () => {
    if (!ED || !ED.srcId || !confirm(`Delete “${ED.veh.name}” for good?`)) return;
    mine = mine.filter(v => v.id !== ED.srcId); saveMine();
    SB.veh = DEF.veh; SB.vaim = null; saveSB();
    endEdit();
  });
  function drawEditHandles(c) {
    const v = ED.veh, sel = ED.sel;
    // a light grid helps line things up
    const step = cam.s * 100 >= 12 ? 100 : 500;
    c.save(); c.strokeStyle = 'rgba(255,255,255,.045)'; c.lineWidth = 1; c.beginPath();
    for (let x = Math.floor(toWX(0) / step) * step; x <= toWX(W); x += step) { c.moveTo(toSX(x), 0); c.lineTo(toSX(x), H); }
    for (let y = Math.floor(toWY(H) / step) * step; y <= toWY(0); y += step) { c.moveTo(0, toSY(y)); c.lineTo(W, toSY(y)); }
    c.stroke(); c.restore();
    if (sel && sel.kind === 'part' && v.parts[sel.i]) { const g = V.geometry(v)[sel.i]; path(c, g.poly); c.strokeStyle = '#ffb020'; c.lineWidth = 2.5; c.stroke(); }
    for (const p of v.parts) for (const q of [p.a, p.b]) {
      c.fillStyle = '#ffb020'; c.strokeStyle = '#101418'; c.lineWidth = 1.5;
      c.beginPath(); c.arc(toSX(q[0]), toSY(q[1]), 6, 0, Math.PI * 2); c.fill(); c.stroke();
    }
    if (sel && sel.kind === 'mod' && v.modules[sel.i]) {
      const m = v.modules[sel.i], x = toSX(m.x + m.w), y = toSY(m.y + m.h);
      c.fillStyle = '#ffb020'; c.strokeStyle = '#101418'; c.fillRect(x - 6, y - 6, 12, 12); c.strokeRect(x - 6, y - 6, 12, 12);
    }
    // names and icons on the boxes
    const fs = clamp(cam.s * 260, 9, 22);
    v.modules.forEach(m => {
      const w = m.w * cam.s, h = m.h * cam.s; if (w < 14 || h < 14) return;
      const cx = toSX(m.x + m.w / 2), cy = toSY(m.y + m.h / 2), big = w > 70 && h > 46;
      c.font = `${Math.min(fs, h * 0.5, w * 0.6)}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff';
      c.fillText(V.MODULES[m.type].icon, cx, cy - (big ? fs * 0.35 : 0));
      if (big) { c.font = `600 ${clamp(fs * 0.55, 9, 12)}px system-ui, sans-serif`; c.fillStyle = '#c9d2da'; c.fillText(fitText(c, m.n, w - 6), cx, cy + fs * 0.55); }
    });
  }
  function edHit(wx, wy) {
    const v = ED.veh, tol = 13 / cam.s;
    if (ED.sel && ED.sel.kind === 'mod') { const m = v.modules[ED.sel.i]; if (m && Math.abs(wx - (m.x + m.w)) < tol && Math.abs(wy - (m.y + m.h)) < tol) return { kind: 'size', i: ED.sel.i }; }
    let best = null, bd = tol;
    v.parts.forEach(p => [p.a, p.b].forEach(q => { const d = Math.hypot(wx - q[0], wy - q[1]); if (d < bd) { bd = d; best = { kind: 'pt', at: q.slice() }; } }));
    if (best) return best;
    const geo = V.geometry(v);
    for (let i = v.parts.length - 1; i >= 0; i--) {
      const p = v.parts[i], q = geo[i].poly;
      const dx = p.b[0] - p.a[0], dy = p.b[1] - p.a[1], L2 = dx * dx + dy * dy || 1, k = clamp(((wx - p.a[0]) * dx + (wy - p.a[1]) * dy) / L2, 0, 1);
      if (E.inPoly(q, wx, wy) || Math.hypot(p.a[0] + k * dx - wx, p.a[1] + k * dy - wy) < tol * 0.7) return { kind: 'part', i };
    }
    for (let i = v.modules.length - 1; i >= 0; i--) { const m = v.modules[i]; if (wx >= m.x && wx <= m.x + m.w && wy >= m.y && wy <= m.y + m.h) return { kind: 'mod', i }; }
    return null;
  }
  const samePt = (p, q) => Math.abs(p[0] - q[0]) < 0.5 && Math.abs(p[1] - q[1]) < 0.5;
  function edDown(e, wx, wy) {
    const hit = edHit(wx, wy), v = ED.veh;
    ED.drag = { hit, x0: wx, y0: wy, sx: e.clientX, sy: e.clientY, moved: false, cam: { ...cam } };
    if (!hit) return;
    if (hit.kind === 'pt') {
      hit.refs = [];
      v.parts.forEach((p, i) => ['a', 'b'].forEach(end => { if (samePt(p[end], hit.at)) hit.refs.push({ i, end }); }));
      const pick = hit.refs.find(r => ED.sel && ED.sel.kind === 'part' && ED.sel.i === r.i) || hit.refs[0];
      ED.sel = { kind: 'part', i: pick.i };
    } else if (hit.kind === 'part') {
      const p = v.parts[hit.i]; hit.orig = { a: p.a.slice(), b: p.b.slice() };
      hit.joined = [];   // plates joined to this one stretch along with it
      v.parts.forEach((q, j) => { if (j === hit.i) return; ['a', 'b'].forEach(end => { if (samePt(q[end], p.a)) hit.joined.push({ j, end, from: 'a' }); if (samePt(q[end], p.b)) hit.joined.push({ j, end, from: 'b' }); }); });
      ED.sel = { kind: 'part', i: hit.i };
    } else { const m = v.modules[hit.i]; hit.orig = { x: m.x, y: m.y, w: m.w, h: m.h }; ED.sel = { kind: 'mod', i: hit.i }; }
    renderEdSel(); draw();
  }
  function edMove(e, wx, wy) {
    const d = ED.drag; if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
    d.moved = true;
    const v = ED.veh, h = d.hit, dx = wx - d.x0, dy = wy - d.y0;
    if (!h) { cam.x = d.cam.x - (e.clientX - d.sx) / cam.s; cam.y = d.cam.y + (e.clientY - d.sy) / cam.s; draw(); return; }
    if (h.kind === 'pt') {
      let nx = snap(h.at[0] + dx), ny = snap(h.at[1] + dy);
      const tol = 14 / cam.s;   // drop it onto another plate's end to join them
      v.parts.forEach((p, i) => ['a', 'b'].forEach(end => { if (h.refs.some(r => r.i === i && r.end === end)) return; const q = p[end]; if (Math.hypot(q[0] - (h.at[0] + dx), q[1] - (h.at[1] + dy)) < tol) { nx = q[0]; ny = q[1]; } }));
      for (const r of h.refs) v.parts[r.i][r.end] = [nx, ny];
    } else if (h.kind === 'part') {
      const ox = snap(dx), oy = snap(dy), p = v.parts[h.i];
      p.a = [h.orig.a[0] + ox, h.orig.a[1] + oy]; p.b = [h.orig.b[0] + ox, h.orig.b[1] + oy];
      for (const k of h.joined) v.parts[k.j][k.end] = [h.orig[k.from][0] + ox, h.orig[k.from][1] + oy];
    } else if (h.kind === 'mod') { const m = v.modules[h.i]; m.x = snap(h.orig.x + dx); m.y = snap(h.orig.y + dy); }
    else if (h.kind === 'size') { const m = v.modules[h.i]; m.w = Math.max(60, snap(h.orig.w + dx)); m.h = Math.max(60, snap(h.orig.h + dy)); }
    edChanged();
  }
  function edUp() {
    const d = ED.drag; ED.drag = null;
    if (!d) return;
    if (!d.moved && !d.hit) ED.sel = null;
    renderEdSel(); draw();
  }

  // ===================== The canvas: drag to look around, wheel to zoom, click to aim =====================
  let drag = null, hoverRaf = 0;
  const world = e => { const r = cv.getBoundingClientRect(); return [toWX(e.clientX - r.left), toWY(e.clientY - r.top)]; };
  cv.addEventListener('pointerdown', e => {
    stopGlide();
    if (ED) { const [wx, wy] = world(e); try { cv.setPointerCapture(e.pointerId); } catch (err) {} edDown(e, wx, wy); return; }
    drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false };
  });
  cv.addEventListener('pointermove', e => {
    if (ED) { if (ED.drag) { const [wx, wy] = world(e); edMove(e, wx, wy); } return; }
    if (drag && (e.buttons || e.pointerType !== 'mouse')) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 5) { drag.moved = true; try { cv.setPointerCapture(e.pointerId); } catch (err) {} }
      if (drag.moved) { cam.x = drag.cx - dx / cam.s; cam.y = drag.cy + dy / cam.s; draw(); }
      return;
    }
    if (VR && VR.run && e.pointerType === 'mouse' && (state === 'ready' || state === 'done')) {   // show what you'd hit
      hover = world(e);
      if (!hoverRaf) hoverRaf = requestAnimationFrame(() => { hoverRaf = 0; renderAimInfo(hover); draw(); });
    }
  });
  cv.addEventListener('pointerleave', () => { if (hover) { hover = null; renderAimInfo(); draw(); } });
  cv.addEventListener('pointerup', e => {
    if (ED) { edUp(); return; }
    if (drag && !drag.moved) {
      if (state === 'flight' && VR) VR.flT0 -= 60000;          // skip the replay
      else if (state === 'debris' && VR) VR.deb.t = 99;        // skip the falling pieces
      else if (state === 'ready' || state === 'done') {        // aim where you clicked
        const [wx, wy] = world(e);
        if (VR) { SB.vaim = [Math.round(wx), Math.round(wy)]; hover = null; saveSB(); aimChanged(); }
        else { SB.aim = clamp(Math.round(wy), -400, 400); renderProjControls(); rebuild(); saveSB(); }
      }
    }
    drag = null;
  });
  cv.addEventListener('pointercancel', () => { drag = null; if (ED) ED.drag = null; });
  cv.addEventListener('wheel', e => {
    e.preventDefault(); stopGlide();
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, wx = toWX(mx), wy = toWY(my);
    cam.s *= Math.exp(-e.deltaY * 0.0015); cam.s = clamp(cam.s, 0.02, 80);
    cam.x = wx - (mx - W / 2) / cam.s; cam.y = wy + (my - H / 2) / cam.s; draw();
  }, { passive: false });
  cv.addEventListener('dblclick', () => { fit(); draw(); });
  addEventListener('keydown', e => {
    if (!visible) return;
    const a = document.activeElement, typing = a && (a.tagName === 'SELECT' || (a.tagName === 'INPUT' && a.type !== 'range' && a.type !== 'checkbox') || a.tagName === 'TEXTAREA');
    if (ED && (e.key === 'Delete' || e.key === 'Backspace') && !typing && ED.sel) {   // remove the selected plate or box
      e.preventDefault(); (ED.sel.kind === 'part' ? ED.veh.parts : ED.veh.modules).splice(ED.sel.i, 1); ED.sel = null; renderEdSel(); edChanged(); return;
    }
    if (e.key !== ' ' || ED) return;
    if (a && (a.tagName === 'BUTTON' || a.tagName === 'A' || typing)) return;
    e.preventDefault();
    if (physicsOn() || state === 'approach' || state === 'paused') $('sb-pause').click(); else fire();
  });
  let rsT = 0;
  new ResizeObserver(() => { if (!visible) return; clearTimeout(rsT); rsT = setTimeout(() => { if (!busyNow()) fit(); draw(); }, 80); }).observe(cv);

  // ===================== Shared links (#v=…) =====================
  let linkMsg = null;
  (function importFromLink() {
    const m = location.hash.match(/[#&]v=([\w-]+)/);
    if (!m) return;
    history.replaceState(null, '', location.pathname + location.search);
    const v = V.fromLink(m[1]);
    if (!v) { linkMsg = 'That vehicle link looks broken, sorry.'; return; }
    const key = x => JSON.stringify(V.pack(x)), same = mine.find(x => key(x) === key(v));
    if (!same) { mine.push(v); if (mine.length > 40) mine.shift(); saveMine(); }
    const got = same || v;
    SB.target = 'vehicle'; SB.veh = got.id; SB.vaim = null; saveSB();
    linkMsg = `Loaded “${got.name}” from a link. It's saved in My vehicles.`;
  })();

  // ===================== Showing and hiding (mode tabs) =====================
  window.Sandbox = {
    show() {
      visible = true;
      if (!sim && !VR) rebuild(); else { if (!busyNow()) fit(); draw(); }
      if (busyNow()) loop();
      if (linkMsg) { toast(linkMsg); linkMsg = null; }
    },
    hide() { visible = false; if (physicsOn() || state === 'approach') { paused = state === 'approach' ? 'running' : state; state = 'paused'; } renderControlsState(); },
    get sim() { return sim; }, get state() { return state; }, get verdict() { return verdict; }, get vr() { return VR; }, get editor() { return ED; },
    get mine() { return mine; }, fire, rebuild, SB, startEdit, toast, aim(x, y) { SB.vaim = [x, y]; aimChanged(); },
  };
  renderProjControls(); renderPlates(); renderTarget(); renderControlsState(); renderChallenges();
  if (linkMsg && S.mode !== 'sandbox') setMode('sandbox');
  else if (S.mode === 'sandbox') Sandbox.show();
})();
