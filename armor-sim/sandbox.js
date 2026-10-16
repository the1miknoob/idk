// Sandbox mode: shells, armor and whole vehicles built from particles.
// engine.js does the physics and vehicles.js knows the vehicles; this file is the controls, the builders and the drawing.
(function () {
  'use strict';
  const E = window.ImpactEngine, V = window.Vehicles;
  if (!E || !V) return;
  const $ = id => document.getElementById(id);
  const clone = o => JSON.parse(JSON.stringify(o));
  const DEG = Math.PI / 180;
  const QUALITY = { low: ['Low', 3000], med: ['Medium', 6000], high: ['High', 12000], ultra: ['Ultra', 24000] };   // particle budgets
  const SPEEDS = { slow: ['🐢 Slow-mo', 40], normal: ['▶ Normal', 150], fast: ['⏩ Fast', Infinity] };              // simulated µs per real second
  const VIEWS = { mat: '🎨 Material', heat: '🔥 Heat', damage: '💔 Damage', speed: '💨 Speed' };
  const FROM = ['front', 'rear', 'top'];
  const weak = innerWidth < 700 || (navigator.hardwareConcurrency || 8) <= 4;
  const DEF = { proj: 'ap88', v: null, aim: 0, preset: 'plate', plates: clone(E.ARMORS[0].plates), view: 'mat', speed: 'normal', quality: weak ? 'low' : 'med',
    target: 'armor', veh: 'tiger', from: 'front', tilt: 0, vaim: null };
  const SB = Object.assign(clone(DEF), store.get('armor-sandbox', {}) || {});
  if (!E.PROJECTILES.some(p => p.id === SB.proj)) SB.proj = DEF.proj;
  if (!Array.isArray(SB.plates) || !SB.plates.length) SB.plates = clone(DEF.plates);
  SB.plates = SB.plates.map(p => ({ x: +p.x || 0, ang: clamp(+p.ang || 0, -80, 80), len: 'auto', layers: (p.layers || []).filter(l => E.MATERIALS[l.mat]).map(l => ({ mat: l.mat, t: clamp(+l.t || 10, 1, 1000) })) })).filter(p => p.layers.length);
  if (!SB.plates.length) SB.plates = clone(DEF.plates);
  if (!QUALITY[SB.quality]) SB.quality = DEF.quality;
  if (!SPEEDS[SB.speed]) SB.speed = 'normal';
  if (!VIEWS[SB.view]) SB.view = 'mat';
  if (SB.target !== 'vehicle') SB.target = 'armor';
  if (!FROM.includes(SB.from)) SB.from = 'front';
  SB.tilt = clamp(Math.round(+SB.tilt || 0), -30, 30);
  if (!(Array.isArray(SB.vaim) && SB.vaim.length === 2 && SB.vaim.every(Number.isFinite))) SB.vaim = null;
  const saveSB = () => store.set('armor-sandbox', SB);
  const projDef = () => E.PROJECTILES.find(p => p.id === SB.proj);
  const speedOf = () => SB.v || projDef().v;

  // Your own vehicles (saved in this browser)
  let mine = (store.get('armor-vehicles', []) || []).map(V.sanitize).filter(Boolean);
  const saveMine = () => store.set('armor-vehicles', mine);
  const allVeh = () => V.VEHICLES.concat(mine);
  if (!allVeh().some(v => v.id === SB.veh)) SB.veh = DEF.veh;
  const vehDef = () => allVeh().find(v => v.id === SB.veh) || V.VEHICLES[0];
  function defaultAim(veh) { if (veh.aim) return veh.aim; const b = V.bbox(veh, false); return [b[0], b[2] + (b[3] - b[2]) * 0.45]; }
  const shotOf = veh => ({ from: SB.from, tilt: SB.tilt, at: SB.vaim || defaultAim(veh) });

  // ===================== The simulation =====================
  let sim = null, state = 'idle', approachT0 = 0, verdict = null, verdictAt = 0, runStart = 0, flashes = [], seenEvents = 0, visible = false, raf = 0, stepsPerSec = 0;
  let VR = null;     // shooting at a vehicle: { veh, shot, built, geo }
  let POST = null;   // after the hit: what flew where inside the vehicle, and what it broke
  let ED = null;     // the vehicle builder
  const IDENT = V.frameFor({ from: 'front', tilt: 0, at: [0, 0] });
  let fr = IDENT;    // turns the engine's frame (shot flying along +x) into the picture's frame
  const cam = { x: 0, y: 0, s: 1 };
  let glide = null;  // smooth camera moves

  // Plates mustn't start inside each other along the shot line
  function tidyPlates() {
    SB.plates[0].x = 0;
    for (let i = 1; i < SB.plates.length; i++) {
      const a = SB.plates[i - 1], t = E.plateThickness(a), min = a.x + t / Math.max(0.2, Math.cos(a.ang * DEG)) + 2;
      if (SB.plates[i].x < min) SB.plates[i].x = Math.round(min);
    }
  }
  function rebuild(keepView) {
    POST = null; flashes = []; seenEvents = 0; verdict = null;
    const P = projDef();
    if (ED) { VR = { veh: ED.veh, shot: shotOf(ED.veh), built: null }; sim = null; fr = IDENT; state = 'edit'; }
    else if (SB.target === 'vehicle') {
      const veh = vehDef(), shot = shotOf(veh);
      const built = V.buildShot(veh, shot, { ...P, v: speedOf() }, QUALITY[SB.quality][1]);
      VR = { veh, shot, built };
      if (built) { sim = new E.Sim(built.scene); fr = built.fr; state = 'ready'; }
      else { sim = null; fr = V.frameFor(shot); state = 'miss'; }
    } else {
      VR = null; tidyPlates();
      const scene = { plates: clone(SB.plates), proj: { ...P, v: speedOf(), aim: SB.aim } };
      scene.h = E.pickH(scene, QUALITY[SB.quality][1]);
      sim = new E.Sim(scene); fr = IDENT; state = 'ready';
    }
    if (!keepView) fit();
    renderResult(); renderControlsState(); renderAimInfo(); draw();
  }
  let rbTimer = 0;
  const rebuildSoon = keepView => { clearTimeout(rbTimer); rbTimer = setTimeout(() => { rebuild(keepView); saveSB(); }, 160); };

  function fire() {
    if (ED) return;
    if (state === 'miss') { toast('That shot misses the armor. Click on the vehicle where you want to hit.'); return; }
    if (!sim || state === 'done' || state === 'post' || state === 'running' || state === 'approach' || state === 'paused') rebuild(true);
    if (!sim) return;
    state = 'approach'; approachT0 = performance.now(); runStart = 0;
    if (VR) glideTo(impactView(), 450);
    sound('fire'); countPlay(); renderControlsState(); renderResult();
    loop();
  }
  function finish() {
    const v = verdict || sim.verdict() || 'stop';
    verdict = v;
    sound(v === 'rico' ? 'rico' : v === 'pen' ? 'pen' : v === 'spall' ? 'boom' : 'stop');
    if (VR && VR.built) { startPost(); return; }
    state = 'done';
    renderResult(); renderControlsState();
  }

  // ===================== After the hit: follow the bits inside the vehicle =====================
  function startPost() {
    const veh = VR.veh, out = V.afterShot(veh, VR.shot, VR.built, sim, { ...projDef(), v: speedOf() });
    const ends = out.rays.map(r => (r.delay || 0) + Math.min(r.stop, 9000));
    const vs = Math.max(3500, Math.max(0, ...ends) / 1.1);   // how fast (mm per real second) the bits fly in the replay
    const reveal = veh.modules.map(() => Infinity);
    for (const r of out.rays) for (const h of r.hits) { const t = ((r.delay || 0) + h.t) / vs; if (out.states[h.k] && t < reveal[h.k]) reveal[h.k] = t; }
    let boomAt = Infinity;
    veh.modules.forEach((m, k) => { if (m.type === 'ammo' && out.states[k] === 2 && !m.vent) boomAt = Math.min(boomAt, reveal[k]); });
    if (isFinite(boomAt)) veh.modules.forEach((m, k) => { if (out.states[k] && !isFinite(reveal[k])) reveal[k] = boomAt + 0.05; });
    const last = Math.min(1.6, Math.max(0, ...ends) / vs);
    POST = { out, vs, reveal, boomAt, t0: performance.now(), end: last + (isFinite(boomAt) ? 2.6 : 0.6), burstDone: false, boomDone: false, toss: null, boom: null };
    state = 'post';
    glideTo(fitVehicle(), 800);
    renderResult(); renderControlsState(); loop();
  }
  function postTick(now) {
    const tp = (now - POST.t0) / 1000, out = POST.out;
    if (out.burst && !POST.burstDone && tp >= out.burst.at / POST.vs) {
      POST.burstDone = true; sound('stop');
      flashes.push({ type: 'flash', x: out.burst.x, y: out.burst.y, r: 300, at: now, v: true });
    }
    if (!POST.boomDone && tp >= POST.boomAt) {
      POST.boomDone = true; sound('boom');
      const ammo = VR.veh.modules.filter((m, k) => m.type === 'ammo' && out.states[k] === 2);
      const cx = ammo.reduce((s, m) => s + m.x + m.w / 2, 0) / ammo.length, cy = ammo.reduce((s, m) => s + m.y + m.h / 2, 0) / ammo.length;
      POST.boom = { x: cx, y: cy, at: now };
      flashes.push({ type: 'flash', x: cx, y: cy, r: 1600, at: now, v: true, big: true });
      if (VR.veh.parts.some(p => p.g === 't')) POST.toss = { at: now + 120 };
    }
    if (tp >= POST.end && state === 'post') { state = 'done'; renderResult(); renderControlsState(); }
  }
  const effectsOn = now => POST && (state === 'post' || (POST.toss && now - POST.toss.at < 2600) || POST.out.fate.id === 'fire' && now - POST.t0 < 9000 || POST.boom && now - POST.boom.at < 6000);

  // ===================== The loop =====================
  let lastNow = 0;
  function loop() { if (!raf) raf = requestAnimationFrame(tick); }
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
    if (sim && state === 'running') {
      const quota = SPEEDS[SB.speed][1], until = isFinite(quota) ? sim.time + quota * dtReal : Infinity;
      const t0 = performance.now(), budget = 11;
      let n = 0;
      while (sim.time < until && performance.now() - t0 < budget) {
        sim.step(); n++;
        if (sim.steps % 40 === 0) {
          if (!verdict) { const v = sim.verdict(); if (v) { verdict = v; verdictAt = sim.time; } }
          else if (sim.time - verdictAt > 90) { finish(); break; }
        }
      }
      stepsPerSec = stepsPerSec * 0.9 + (n / Math.max(dtReal, 0.001)) * 0.1;
      if (state === 'running' && now - runStart > 120000) finish();   // safety: never run forever
      if (n && sim.steps % 40 < n) renderLive();
    }
    if (sim) while (seenEvents < sim.events.length) { const ev = sim.events[seenEvents++], p = fr.toV([ev.x, ev.y]); flashes.push({ ...ev, x: p[0], y: p[1], at: now }); }
    flashes = flashes.filter(f => now - f.at < (f.big ? 1400 : 700));
    if (state === 'post') postTick(now);
    draw(now);
    if (state === 'running' || state === 'approach' || state === 'post' || flashes.length || glide || effectsOn(now)) loop();
  }

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
    for (let i = 0; i < sim.n; i++) { if (!sim.alive[i]) continue; const x = sim.px[i], y = sim.py[i]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const sh = sim.shape, len = sh.x1 - sh.x0;
    x0 = Math.min(x0, sim.noseX - len * 1.15); y0 = Math.min(y0, sim.aimY - sh.r * 1.5); y1 = Math.max(y1, sim.aimY + sh.r * 1.5);
    return [x0, x1, y0, y1];
  }
  function viewOf(x0, x1, y0, y1, pad = 1.12) {
    resize();
    const bw = (x1 - x0) * pad || 100, bh = (y1 - y0) * pad || 100;
    return { s: Math.min(W / bw, H / bh), x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  }
  function fitVehicle() {   // on narrow screens the long gun barrel may run off the edge, so the vehicle itself is bigger
    resize();
    const narrow = W < 600, b = V.bbox(VR.veh, !narrow);
    return viewOf(b[0] - (narrow ? 250 : 150), b[1] + 150, Math.min(b[2], 0) - 200, b[3] + 300, 1.06);
  }
  function impactView() {   // close up on the plates being simulated
    const pts = VR.built.cuts.flatMap(c => c.cut), sh = sim.shape;
    pts.push(fr.toV([sim.noseX - (sh.x1 - sh.x0) * 0.6, 0]));
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const grow = (a, b, min) => { const m = (a + b) / 2, h = Math.max((b - a) / 2, min / 2); return [m - h, m + h]; };
    [x0, x1] = grow(x0, x1, 500); [y0, y1] = grow(y0, y1, 400);
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
    overlays(c, now);
  }
  function drawParticles(now) {
    buf.fill(0);
    const s = cam.s * dpr, cw = cv.width, ch = cv.height, splat = Math.max(1, Math.ceil(sim.h * s * 1.05)), half = splat / 2;
    const ox = cw / 2 - cam.x * s, oy = ch / 2 + cam.y * s;
    const view = SB.view, n = sim.n, fc = fr.c, fs = fr.s, Ox = fr.O[0], Oy = fr.O[1];
    const px = sim.px, py = sim.py, alive = sim.alive, mat = sim.mat, T = sim.T, shade = sim.shade, body = sim.body, vx = sim.vx, vy = sim.vy;
    const hide = tossingBodies(now);
    // the incoming shell slides in from the left before the physics starts
    let off = 0;
    if (state === 'approach') { const f = Math.min(1, (now - approachT0) / 450), e = 1 - Math.pow(1 - f, 2); off = -(1 - e) * Math.max(W / cam.s, 400); }
    for (let i = 0; i < n; i++) {
      if (alive[i] === 0 || (hide && hide[body[i]])) continue;
      let x = px[i]; const y = py[i];
      if (off && body[i] === 0) x += off;
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
  const turretPivot = veh => { const pts = veh.parts.filter(p => p.g === 't').flatMap(p => [p.a, p.b]); return pts.length ? [pts.reduce((s, p) => s + p[0], 0) / pts.length, Math.min(...pts.map(p => p[1]))] : null; };
  function tossNow(now) {   // the turret flying off after the ammo explodes: where it is now
    if (!POST || !POST.toss || now < POST.toss.at) return null;
    const k = Math.min(1, (now - POST.toss.at) / 2000), base = turretPivot(VR.veh);
    if (!base) return null;
    return { base, dx: -650 * k, dy: 3800 * 4 * k * (1 - k) + 70 * k, rot: k * (Math.PI * 2 + 0.33) };   // up, a spin and a bit, and it lands crooked on the hull
  }
  function withToss(c, tz, fn) {   // draw something that belongs to the turret, moved to where the turret is now
    if (!tz) { fn(); return; }
    const bx = toSX(tz.base[0]), by = toSY(tz.base[1]);
    c.save(); c.translate(bx + tz.dx * cam.s, by - tz.dy * cam.s); c.rotate(-tz.rot); c.translate(-bx, -by); fn(); c.restore();
  }
  function tossingBodies(now) {
    if (!VR || !VR.built || !tossNow(now)) return null;
    const hide = new Uint8Array(sim.plates.length + 1);
    sim.plates.forEach((pl, k) => { if (VR.veh.parts[pl.part] && VR.veh.parts[pl.part].g === 't') hide[k + 1] = 1; });
    return hide;
  }
  const inTurret = (veh, m) => { const t = veh.parts.filter(p => p.g === 't').flatMap(p => [p.a, p.b]); if (!t.length) return false; const y0 = Math.min(...t.map(p => p[1])), x0 = Math.min(...t.map(p => p[0])), x1 = Math.max(...t.map(p => p[0])); return m.y + m.h / 2 > y0 && m.x + m.w / 2 > x0 && m.x + m.w / 2 < x1; };
  function moduleState(k, now) {
    if (!POST) return 0;
    if (state === 'done') return POST.out.states[k];
    return (now - POST.t0) / 1000 >= POST.reveal[k] ? POST.out.states[k] : 0;
  }
  function drawVehicle(c, now) {
    const veh = VR.veh, geo = VR.geo && VR.geoOf === veh ? VR.geo : (VR.geo = V.geometry(veh), VR.geoOf = veh, VR.geo), deco = V.decoOf(veh) || {};
    const tz = tossNow(now), editing = !!ED;
    // the ground
    const gy = toSY(0);
    if (gy < H) { c.fillStyle = '#12171c'; c.fillRect(0, gy, W, H - gy); c.strokeStyle = '#2b333c'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, gy); c.lineTo(W, gy); c.stroke(); }
    // tracks, wheels and the gun barrel (drawn only: they aren't armor)
    if (deco.track) { const [a, b, t] = deco.track; c.fillStyle = '#1a2026'; c.strokeStyle = '#2b343e'; c.lineWidth = 1; c.beginPath(); c.roundRect(toSX(a), toSY(t), (b - a) * cam.s, t * cam.s, t * cam.s / 2); c.fill(); c.stroke(); }
    for (const [x, y, r] of deco.wheels || []) { c.fillStyle = '#212932'; c.strokeStyle = '#34404b'; c.beginPath(); c.arc(toSX(x), toSY(y), r * cam.s, 0, Math.PI * 2); c.fill(); c.stroke(); c.fillStyle = '#2c3640'; c.beginPath(); c.arc(toSX(x), toSY(y), r * cam.s * 0.3, 0, Math.PI * 2); c.fill(); }
    if (deco.barrel) withToss(c, tz, () => {
      const b = deco.barrel, x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1);
      c.fillStyle = '#58636e'; c.fillRect(toSX(x0), toSY(b.y + b.d / 2), (x1 - x0) * cam.s, b.d * cam.s);
      if (b.brake) c.fillRect(toSX(b.x1 - 30), toSY(b.y + b.d * 0.85), Math.min(260, Math.abs(b.x0 - b.x1) * 0.12) * cam.s, b.d * 1.7 * cam.s);
      if (b.evac != null) c.fillRect(toSX(b.evac - 200), toSY(b.y + b.d * 0.75), 400 * cam.s, b.d * 1.5 * cam.s);
    });
    // the inside
    const hullPts = veh.parts.filter(p => p.g !== 't').flatMap(p => [p.a, p.b]), turPts = veh.parts.filter(p => p.g === 't').flatMap(p => [p.a, p.b]);
    c.fillStyle = '#151c23';
    if (hullPts.length > 2) { path(c, hullPts); c.fill(); }
    if (turPts.length > 2) withToss(c, tz, () => { path(c, turPts); c.fill(); });
    // what's inside: crew, ammo, fuel, engine…
    const fs = clamp(cam.s * 260, 9, 22);
    veh.modules.forEach((m, k) => {
      const go = () => drawModule(c, m, k, now, fs);
      if (tz && inTurret(veh, m)) withToss(c, tz, go); else go();
    });
    // the armor: solid where it isn't being simulated, particles where it is
    const cuts = VR.built && sim && !editing ? VR.built.cuts : null;
    veh.parts.forEach((p, i) => {
      const turret = p.g === 't', g = geo[i];
      const go = pieces => pieces.forEach(poly => {
        V.layerBands(p, { poly, f: g.f }).forEach(b => { path(c, b.poly); c.fillStyle = E.MATERIALS[b.mat].color; c.fill(); });
        path(c, poly); c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = 1; c.stroke();
      });
      const cut = cuts && cuts.find(k => k.i === i);
      if (turret && tz) withToss(c, tz, () => go([g.poly]));
      else if (cut) go(VR.built.statics.filter(s => s.i === i).map(s => s.poly));
      else go([g.poly]);
    });
    if (editing) drawEditHandles(c);
  }
  function drawModule(c, m, k, now, fs) {
    const T = V.MODULES[m.type], st = moduleState(k, now), x = toSX(m.x), y = toSY(m.y + m.h), w = m.w * cam.s, h = m.h * cam.s;
    c.fillStyle = st === 2 ? 'rgba(208,59,59,.42)' : st === 1 ? 'rgba(250,178,25,.25)' : T.color + '2b';
    c.strokeStyle = st === 2 ? '#ff6d60' : st === 1 ? '#fab219' : T.color + 'b0';
    c.lineWidth = ED && ED.sel && ED.sel.kind === 'mod' && ED.sel.i === k ? 2.5 : 1.2;
    c.beginPath(); c.roundRect(x, y, w, h, Math.min(6, w / 4, h / 4)); c.fill(); c.stroke();
    if (POST && state !== 'done') {   // flash when something hits it
      const a = (now - POST.t0) / 1000 - POST.reveal[k];
      if (a >= 0 && a < 0.4) { c.fillStyle = `rgba(255,255,255,${0.7 * (1 - a / 0.4)})`; c.fillRect(x, y, w, h); }
    }
    if (w > 14 && h > 14) {
      const big = w > 70 && h > 46;
      c.font = `${Math.min(fs, h * 0.5, w * 0.6)}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = '#fff'; c.globalAlpha = st === 2 ? 0.55 : 1; c.fillText(T.icon, x + w / 2, y + h / 2 - (big ? fs * 0.35 : 0)); c.globalAlpha = 1;
      if (st === 2) { c.strokeStyle = '#ff6d60'; c.lineWidth = 2; const r = Math.min(fs, h * 0.4, w * 0.4) * 0.45, cx = x + w / 2, cy = y + h / 2 - (big ? fs * 0.35 : 0); c.beginPath(); c.moveTo(cx - r, cy - r); c.lineTo(cx + r, cy + r); c.moveTo(cx + r, cy - r); c.lineTo(cx - r, cy + r); c.stroke(); }
      if (big) { c.font = `600 ${clamp(fs * 0.55, 9, 12)}px system-ui, sans-serif`; c.fillStyle = st === 2 ? '#ffb3ab' : '#c9d2da'; c.fillText(fitText(c, m.n, w - 6), x + w / 2, y + h / 2 + fs * 0.55); }
    }
  }
  function fitText(c, t, w) { if (c.measureText(t).width <= w) return t; while (t.length > 2 && c.measureText(t + '…').width > w) t = t.slice(0, -1); return t + '…'; }

  function overlays(c, now) {
    const P = projDef(), sh = sim && sim.shape;
    // chemical rounds are drawn as a picture while they fly in
    if (sim && P.kind !== 'ke' && (state === 'ready' || state === 'approach')) {
      const len = (sh.x1 - sh.x0) * cam.s, sc = Math.max(0.2, len / 60);
      let off = 0; if (state === 'approach') { const f = Math.min(1, (now - approachT0) / 450); off = -(1 - (1 - Math.pow(1 - f, 2))) * Math.max(W / cam.s, 400); }
      const p = fr.toV([sim.noseX + off, sim.aimY]);
      c.save(); c.globalAlpha = state === 'ready' ? 0.9 : 1;
      drawShell(c, P.kind === 'heat' ? 'heat' : P.kind === 'hesh' ? 'hesh' : 'he', toSX(p[0]), toSY(p[1]), Math.atan2(-fr.s, fr.c), sc, 1);
      c.restore();
    }
    // aim line before firing
    if (sim && state === 'ready') {
      const far = 3 * Math.max(W, H) / cam.s, h0 = fr.toV([sim.hitX, sim.aimY]), s0 = fr.toV([sim.hitX - far, sim.aimY]);
      reticle(c, s0, h0, '#ffb020', false);
    }
    if (state === 'miss' && VR) {
      const f = V.frameFor(VR.shot), far = 3 * Math.max(W, H) / cam.s, a = f.toV([-far, 0]), b = f.toV([far, 0]);
      reticle(c, a, b, '#e86a5c', true);
    }
    if (hover && VR && !ED && (state === 'ready' || state === 'miss' || state === 'done')) {
      c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1.5; const x = toSX(hover[0]), y = toSY(hover[1]);
      c.beginPath(); c.arc(x, y, 7, 0, Math.PI * 2); c.moveTo(x - 11, y); c.lineTo(x + 11, y); c.moveTo(x, y - 11); c.lineTo(x, y + 11); c.stroke();
    }
    if (POST) drawPost(c, now);
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
    c.fillStyle = 'rgba(9,12,15,.8)'; const tt = `t = ${sim.time.toFixed(1)} µs`; const tw = c.measureText(tt).width;
    const cy = W - tw - 22 < tagEnd + 8 ? 30 : 8;   // narrow screen: drop below the label
    c.fillRect(W - tw - 22, cy, tw + 14, 24); c.fillStyle = '#ffb020'; c.fillText(tt, W - 15, cy + 5);
  }
  function reticle(c, from, at, color, miss) {
    c.save(); c.setLineDash([6, 6]); c.strokeStyle = miss ? 'rgba(232,106,92,.7)' : 'rgba(255,176,32,.7)'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(toSX(from[0]), toSY(from[1])); c.lineTo(toSX(at[0]), toSY(at[1])); c.stroke(); c.restore();
    if (miss) return;
    const x = toSX(at[0]), y = toSY(at[1]);
    c.strokeStyle = color; c.lineWidth = 2; c.beginPath(); c.arc(x, y, 9, 0, Math.PI * 2); c.moveTo(x - 15, y); c.lineTo(x + 15, y); c.moveTo(x, y - 15); c.lineTo(x, y + 15); c.stroke();
  }
  function drawPost(c, now) {
    const tp = state === 'done' ? Infinity : (now - POST.t0) / 1000, d0 = tp * POST.vs, out = POST.out;
    if (state !== 'done') {   // tracers: the shell and the bits of armor flying through the inside
      c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
      for (const r of out.rays) {
        const d = d0 - (r.delay || 0); if (d <= 0) continue;
        const head = Math.min(d, r.stop), tail = Math.max(0, head - (r.proj && r.big ? 700 : 260)), fade = d > r.stop ? Math.max(0, 1 - (d - r.stop) / 900) : 1;
        if (fade <= 0 || head <= tail) continue;
        c.strokeStyle = r.frag ? `rgba(255,214,90,${0.75 * fade})` : r.proj ? `rgba(255,236,190,${fade})` : `rgba(255,150,60,${(r.big ? 0.95 : 0.6) * fade})`;
        c.lineWidth = r.proj && r.big ? 3.2 : r.big ? 2.2 : 1.2;
        c.beginPath(); c.moveTo(toSX(r.x + r.dx * tail), toSY(r.y + r.dy * tail)); c.lineTo(toSX(r.x + r.dx * head), toSY(r.y + r.dy * head)); c.stroke();
      }
      c.restore();
    }
    // smoke and flames
    const fireMods = VR.veh.modules.filter((m, k) => m.type === 'fuel' && moduleState(k, now) === 2);
    const t = now / 1000;
    for (const m of fireMods) {
      for (let k = 0; k < 7; k++) {
        const f = (t * 1.6 + k / 7) % 1, x = m.x + m.w * (0.15 + 0.7 * ((k * 0.37) % 1)), y = m.y + m.h * 0.3 + f * (m.h * 0.9 + 500);
        c.fillStyle = `rgba(255,${Math.round(120 + 100 * (1 - f))},40,${0.55 * (1 - f)})`;
        c.beginPath(); c.arc(toSX(x), toSY(y), Math.max(3, (90 + 120 * (1 - f)) * cam.s), 0, Math.PI * 2); c.fill();
      }
    }
    if (POST.boom) {
      const a = (now - POST.boom.at) / 1000;
      for (let k = 0; k < 9; k++) {
        const f = ((a * 0.35 + k / 9) % 1), x = POST.boom.x + Math.sin(k * 2.1) * 500 * f, y = POST.boom.y + 400 + f * 2600;
        c.fillStyle = `rgba(70,74,80,${0.35 * (1 - f) * Math.min(1, a * 2)})`;
        c.beginPath(); c.arc(toSX(x), toSY(y), (250 + 700 * f) * cam.s, 0, Math.PI * 2); c.fill();
      }
    }
  }

  // ===================== Results =====================
  const SB_WORDS = {
    pen: ['good', '✓ PENETRATED'], stop: ['crit', '✗ STOPPED'], rico: ['serious', '↗ RICOCHET'], spall: ['warn', '💥 SPALLED'],
  };
  function formulaEstimate(P, v) {   // the classic formulas from the Calculator, for comparison
    const d = P.d, g = P.group;
    let s = null;
    if (P.kind === 'heat') s = { type: 'heat', cal: d.cal, q: Math.max(0, [3.2, 4.6, 6].indexOf(d.q)) };
    else if (P.kind === 'hesh') s = { type: 'hesh', cal: d.cal };
    else if (P.kind === 'he') s = { type: 'he', cal: d.cal };
    else if (d.shape === 'rod') s = { type: 'apfsds', len: d.len, v };
    else if (/APCR/.test(g)) s = { type: 'apcr', cal: P.bore || d.cal, v };
    else if (P.bore) s = { type: 'apds', cal: P.bore, v };
    else if (d.shape === 'shell') s = { type: 'ap', cal: d.cal, v };
    return s ? Math.round(penAt(s, 0)) : null;
  }
  function liveLine() {
    const r = sim.res;
    return `⏱ ${sim.time.toFixed(0)} µs · ${sim.n.toLocaleString()} particles · ${sim.broken.toLocaleString()} bonds snapped · 🔥 hottest ${Math.round((sim.maxT || 293) - 273).toLocaleString()} °C${r && r.depth ? ` · deepest ${Math.round(r.depth)} mm` : ''}`;
  }
  function renderLive() { $('sb-live').textContent = sim ? liveLine() : ''; }
  const estHTML = (P, est) => est ? `<p class="sb-est">📏 Classic formula: this ${esc(P.name)} beats about <b>${est.toLocaleString()} mm</b> of flat armor steel${P.kind === 'ke' ? ` at ${speedOf().toLocaleString()} m/s` : ''}. The sim is a 2D slice, so it won't match exactly.</p>` : '';
  function renderResult() {
    const box = $('sb-result'), P = projDef();
    if (ED) { box.innerHTML = '<span class="badge idle">BUILDING</span><div class="txt">You\'re building a vehicle. Press <b>Save &amp; try it</b> to shoot at it.</div>'; $('sb-live').textContent = ''; return; }
    if (state === 'miss') { box.innerHTML = '<span class="badge idle">AIM</span><div class="txt">That shot would miss the armor. <b>Click on the vehicle</b> where you want the shell to hit.</div>'; $('sb-live').textContent = ''; return; }
    if (!sim) return;
    if (VR && (state === 'post' || state === 'done')) { renderVehResult(); return; }
    if (state !== 'done') {
      const msg = state === 'ready' ? (VR ? 'Press <b>Fire</b> (or Space). Click the vehicle to aim somewhere else.' : 'Press <b>Fire</b> (or Space). Click the armor to aim somewhere else.') : 'Simulating… every particle is doing its own physics.';
      box.innerHTML = `<span class="badge idle">${state === 'ready' ? 'READY' : 'LIVE'}</span><div class="txt">${msg}</div>`;
      $('sb-live').textContent = state === 'ready' ? `${sim.n.toLocaleString()} particles · ${sim.nb.toLocaleString()} bonds · particle size ${sim.h.toFixed(sim.h < 1 ? 2 : 1)} mm` : liveLine();
      return;
    }
    const r = sim.measure(), v = verdict, [st, badge] = SB_WORDS[v] || SB_WORDS.stop, est = formulaEstimate(P, speedOf());
    const kind = P.kind;
    let text;
    if (v === 'pen') text = kind === 'heat' ? `The jet cut all the way through${r.residual ? ` and came out at ${Math.round(r.residual * 1000).toLocaleString()} m/s` : ''}.` : kind === 'he' ? 'The blast tore through and sent fragments out the back.' : `It punched all the way through and came out at ${Math.round(r.residual * 1000).toLocaleString()} m/s.`;
    else if (v === 'rico') text = 'The shell glanced off the armor.';
    else if (v === 'spall') text = kind === 'hesh' ? 'The shock wave knocked a scab of metal off the inside of the armor.' : `It didn't get through, but pieces broke off the inside (spall). Deepest point: ${Math.round(r.depth)} mm.`;
    else text = kind === 'hesh' ? 'The shock wave wasn\'t strong enough to knock anything off the inside.' : kind === 'he' ? 'The blast didn\'t get through.' : `The armor held. The deepest the ${kind === 'heat' ? 'jet' : 'shell'} got was ${Math.round(r.depth)} mm.`;
    const stats = [
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
  function renderVehResult() {
    const box = $('sb-result'), P = projDef(), r = sim.measure(), v = verdict, out = POST.out, fate = out.fate, veh = VR.veh;
    const g = VR.built.group, what = g.map(h => h.part.n.toLowerCase()).join(' and the '), los = g.reduce((s, h) => s + h.T / Math.max(0.05, h.cos), 0);
    const first = g[0], ang = Math.round(Math.acos(Math.min(1, first.cos)) / DEG), kind = P.kind;
    const armor = `the ${what} (${g.map(h => `${h.T} mm`).join(' + ')} at ${ang}° = ${Math.round(los)} mm in the way)`;
    let line;
    if (v === 'pen') line = kind === 'heat' ? `✓ The jet cut through ${armor}.` : kind === 'he' ? `✓ The blast broke through ${armor}.` : `✓ It punched through ${armor} and flew on at ${Math.round(r.residual * 1000).toLocaleString()} m/s.`;
    else if (v === 'rico') line = `↗ It bounced off ${armor}.`;
    else if (v === 'spall') line = `💥 It didn't get through ${armor}, but bits broke off the inside.`;
    else line = `✗ ${armor.charAt(0).toUpperCase() + armor.slice(1)} stopped it.`;
    if (P.aphe && out.burst) line += ' Then its explosive filling went off inside!';
    if (state === 'post') {
      box.innerHTML = `<span class="badge idle">LIVE</span><div class="txt">${esc(line)}<br>Following the bits flying around inside…</div>`;
      $('sb-live').textContent = liveLine(); return;
    }
    const order = V.MOD_KEYS, mods = veh.modules.map((m, k) => ({ m, k, s: out.states[k] })).sort((a, b) => order.indexOf(a.m.type) - order.indexOf(b.m.type));
    const chips = mods.map(({ m, s }) => `<span class="mchip s${s}">${V.MODULES[m.type].icon} ${esc(m.n)} <b>${s === 2 ? '✖ ' : s === 1 ? '⚠ ' : '✓ '}${V.MODULES[m.type].words[s]}</b></span>`).join('');
    const crew = veh.modules.filter(m => m.type === 'crew').length, ko = mods.filter(x => x.m.type === 'crew' && x.s === 2).length;
    const stats = [
      ['Armor hit', esc(first.part.n)], ['In the way', `${Math.round(los)} mm`],
      v === 'pen' && kind !== 'he' ? ['Exit speed', `${Math.round(r.residual * 1000).toLocaleString()} m/s`] : ['Deepest point', `${Math.round(r.depth)} mm`],
      crew ? ['Crew out', `${ko} of ${crew}`] : null, ['Hottest', `${Math.round(r.maxT - 273).toLocaleString()} °C`],
    ].filter(Boolean);
    box.innerHTML = `<span class="badge ${fate.st}">${fate.badge}</span><div class="txt">${esc(line)} ${esc(fate.text)}
      <div class="mchips">${chips}</div>
      <div class="sb-stats">${stats.map(([k, val]) => `<div><small>${k}</small><b>${val}</b></div>`).join('')}</div>
      ${estHTML(P, formulaEstimate(P, speedOf()))}</div>`;
    $('sb-live').textContent = liveLine();
  }

  // ===================== Controls =====================
  const groups = [...new Set(E.PROJECTILES.map(p => p.group))];
  $('sb-proj').innerHTML = groups.map(g => `<optgroup label="${esc(g)}">${E.PROJECTILES.filter(p => p.group === g).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</optgroup>`).join('');
  $('sb-preset').innerHTML = E.ARMORS.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('') + '<option value="custom">Custom (your own)</option>';
  const matGroups = [...new Set(E.MAT_KEYS.map(k => E.MATERIALS[k].group))];
  const matOptions = sel => matGroups.map(g => `<optgroup label="${esc(g)}">${E.MAT_KEYS.filter(k => E.MATERIALS[k].group === g).map(k => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(E.MATERIALS[k].name)}</option>`).join('')}</optgroup>`).join('');
  const seg = (id, map, cur, key) => { $(id).innerHTML = Object.entries(map).map(([k, v]) => `<button data-${key}="${k}" class="${k === cur ? 'on' : ''}">${Array.isArray(v) ? v[0] : v}</button>`).join(''); };

  function renderProjControls() {
    const P = projDef();
    $('sb-proj').value = P.id;
    const ke = P.kind === 'ke';
    $('sb-v-field').hidden = !ke; $('sb-v-note').hidden = ke && !P.aphe;
    if (ke) { $('sb-v').value = speedOf(); $('sb-v-out').textContent = speedOf().toLocaleString() + ' m/s'; }
    $('sb-v-note').textContent = P.aphe ? 'Has a little explosive inside: if it gets into a vehicle, it goes off a moment later.' : P.kind === 'heat' ? 'Speed doesn\'t matter: the jet does the work (its tip flies at ' + P.d.vTip + ' km/s).' : 'Speed doesn\'t matter: it works by exploding on contact.';
    $('sb-aim').value = SB.aim; $('sb-aim-out').textContent = (SB.aim > 0 ? '+' : '') + SB.aim + ' mm';
    $('sb-proj-art').innerHTML = projSVG(P);
    const d = P.d, size = d.shape === 'rod' ? `${d.dia} mm × ${d.len} mm rod` : `${P.bore ? P.bore + ' mm gun, ' + d.cal + ' mm penetrator' : d.cal + ' mm'}${d.len ? ' · ' + d.len + ' mm long' : ''}`;
    $('sb-proj-info').textContent = size + (d.core ? ` · ${E.MATERIALS[d.core.mat].name.toLowerCase()} core` : '') + ` · ${E.MATERIALS[d.mat || (P.kind === 'heat' ? 'cu' : 'shot')].name.toLowerCase()}`;
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
    cv.setAttribute('aria-label', veh ? 'Side cut-away of the vehicle. Click it to choose where the shell hits; the part being hit is simulated as particles.' : 'Particle simulation of the projectile and the armor. Drag to look around, scroll to zoom, click the armor to aim.');
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
    const veh = vehDef(), shot = hoverPt ? { ...shotOf(veh), at: hoverPt } : shotOf(veh), pr = V.probe(veh, shot);
    $('sb-aim-info').innerHTML = pr
      ? `🎯 ${hoverPt ? 'Pointing at' : 'Aiming at'} ${pr.map(p => `<b>${esc(p.name)}</b>: ${p.T} mm at ${p.ang}° → <b>${p.los} mm</b> in the way`).join(', then ')}`
      : `🎯 ${hoverPt ? 'No armor there.' : 'Not aimed at the armor.'} Click the vehicle where you want to hit.`;
  }
  function renderControlsState() {
    const running = state === 'running' || state === 'approach' || state === 'post';
    $('sb-fire').textContent = state === 'done' ? '🔥 Fire again' : '🔥 Fire';
    $('sb-fire').disabled = running || !!ED;
    $('sb-pause').disabled = !(state === 'running' || state === 'approach' || state === 'paused');
    $('sb-pause').textContent = state === 'paused' ? '▶ Resume' : '⏸ Pause';
    $('sb-step').disabled = state !== 'paused';
    $('sb-reset').disabled = !!ED;
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
    return [...used].map(k => `<span><b style="color:${E.MATERIALS[k].color}">■</b> ${esc(E.MATERIALS[k].name)}</span>`).join('') + (VR ? inside + '<span>· particles = the part being hit</span>' : '<span>· glowing = hot</span>');
  }
  let toastT = 0;
  function toast(msg) { const t = $('sb-toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3400); }

  // events: projectile and plain armor
  const vehView = () => SB.target === 'vehicle';   // vehicles keep the view; plain armor re-fits around the new shell
  $('sb-proj').addEventListener('change', e => { SB.proj = e.target.value; SB.v = null; renderProjControls(); rebuildSoon(vehView()); });
  $('sb-v').addEventListener('input', e => { SB.v = +e.target.value; $('sb-v-out').textContent = SB.v.toLocaleString() + ' m/s'; rebuildSoon(vehView()); });
  $('sb-aim').addEventListener('input', e => { SB.aim = +e.target.value; $('sb-aim-out').textContent = (SB.aim > 0 ? '+' : '') + SB.aim + ' mm'; rebuildSoon(); });
  $('sb-preset').addEventListener('change', e => {
    const a = E.ARMORS.find(x => x.id === e.target.value); if (!a) return;
    SB.preset = a.id; SB.plates = clone(a.plates).map(p => ({ ...p, len: 'auto' })); SB.aim = 0;
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
    const b = e.target.closest('[data-target]'); if (!b || b.dataset.target === SB.target) return;
    SB.target = b.dataset.target; saveSB(); renderTarget(); renderControlsState(); rebuild();
  });
  $('sb-veh').addEventListener('change', e => { SB.veh = e.target.value; SB.vaim = null; saveSB(); renderTarget(); rebuild(); });
  $('sb-from').addEventListener('click', e => {
    const b = e.target.closest('[data-from]'); if (!b) return;
    SB.from = b.dataset.from; saveSB(); renderTarget(); rebuild(true);
  });
  $('sb-tilt').addEventListener('input', e => { SB.tilt = +e.target.value; $('sb-tilt-out').textContent = SB.tilt === 0 ? 'level' : SB.tilt > 0 ? `${SB.tilt}° down` : `${-SB.tilt}° up`; renderAimInfo(); rebuildSoon(true); });
  $('sb-veh-edit').addEventListener('click', () => startEdit(vehDef(), false));
  $('sb-veh-new').addEventListener('click', () => startEdit(null, true));
  // events: the bar under the picture
  $('sb-fire').addEventListener('click', fire);
  $('sb-reset').addEventListener('click', () => { rebuild(!!VR); });
  $('sb-pause').addEventListener('click', () => {
    if (state === 'running' || state === 'approach') state = 'paused';
    else if (state === 'paused') { state = 'running'; runStart = performance.now(); loop(); }
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
    if (q) { SB.quality = q.dataset.quality; saveSB(); renderControlsState(); if (!ED) rebuild(!!VR); }
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
    if (state === 'running' || state === 'approach' || state === 'paused') state = 'idle';
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
    if (VR && e.pointerType === 'mouse' && (state === 'ready' || state === 'miss' || state === 'done')) {   // show what you'd hit
      hover = world(e);
      if (!hoverRaf) hoverRaf = requestAnimationFrame(() => { hoverRaf = 0; renderAimInfo(hover); draw(); });
    }
  });
  cv.addEventListener('pointerleave', () => { if (hover) { hover = null; renderAimInfo(); draw(); } });
  cv.addEventListener('pointerup', e => {
    if (ED) { edUp(); return; }
    if (drag && !drag.moved) {
      if (state === 'post' && POST) POST.t0 -= 60000;   // skip the replay
      else if (state === 'ready' || state === 'done' || state === 'miss') {   // aim where you clicked
        const [wx, wy] = world(e);
        if (VR) { SB.vaim = [Math.round(wx), Math.round(wy)]; hover = null; saveSB(); rebuild(true); }
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
    if (state === 'running' || state === 'approach' || state === 'paused') $('sb-pause').click(); else fire();
  });
  let rsT = 0;
  new ResizeObserver(() => { if (!visible) return; clearTimeout(rsT); rsT = setTimeout(() => { fit(); draw(); }, 80); }).observe(cv);

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
      if (!sim && !VR) rebuild(); else { fit(); draw(); }
      if (state === 'running' || state === 'approach' || state === 'post') loop();
      if (linkMsg) { toast(linkMsg); linkMsg = null; }
    },
    hide() { visible = false; if (state === 'running' || state === 'approach') state = 'paused'; renderControlsState(); },
    get sim() { return sim; }, get state() { return state; }, get verdict() { return verdict; }, get post() { return POST; }, get vr() { return VR; }, get editor() { return ED; },
    get mine() { return mine; }, fire, rebuild, SB, startEdit, toast,
  };
  renderProjControls(); renderPlates(); renderTarget(); renderControlsState();
  if (linkMsg && S.mode !== 'sandbox') setMode('sandbox');
  else if (S.mode === 'sandbox') Sandbox.show();
})();
