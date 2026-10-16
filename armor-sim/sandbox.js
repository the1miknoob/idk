// Sandbox mode: shells and armor built from particles.
// engine.js does the physics; this file is the controls, the armor builder and the drawing.
(function () {
  'use strict';
  const E = window.ImpactEngine;
  if (!E) return;
  const $ = id => document.getElementById(id);
  const clone = o => JSON.parse(JSON.stringify(o));
  const QUALITY = { low: ['Low', 3000], med: ['Medium', 6000], high: ['High', 12000], ultra: ['Ultra', 24000] };   // particle budgets
  const SPEEDS = { slow: ['🐢 Slow-mo', 40], normal: ['▶ Normal', 150], fast: ['⏩ Fast', Infinity] };              // simulated µs per real second
  const VIEWS = { mat: '🎨 Material', heat: '🔥 Heat', damage: '💔 Damage', speed: '💨 Speed' };
  const weak = innerWidth < 700 || (navigator.hardwareConcurrency || 8) <= 4;
  const DEF = { proj: 'ap88', v: null, aim: 0, preset: 'plate', plates: clone(E.ARMORS[0].plates), view: 'mat', speed: 'normal', quality: weak ? 'low' : 'med' };
  const SB = Object.assign(clone(DEF), store.get('armor-sandbox', {}) || {});
  if (!E.PROJECTILES.some(p => p.id === SB.proj)) SB.proj = DEF.proj;
  if (!Array.isArray(SB.plates) || !SB.plates.length) SB.plates = clone(DEF.plates);
  SB.plates = SB.plates.map(p => ({ x: +p.x || 0, ang: clamp(+p.ang || 0, -80, 80), len: 'auto', layers: (p.layers || []).filter(l => E.MATERIALS[l.mat]).map(l => ({ mat: l.mat, t: clamp(+l.t || 10, 1, 1000) })) })).filter(p => p.layers.length);
  if (!SB.plates.length) SB.plates = clone(DEF.plates);
  if (!QUALITY[SB.quality]) SB.quality = DEF.quality;
  if (!SPEEDS[SB.speed]) SB.speed = 'normal';
  if (!VIEWS[SB.view]) SB.view = 'mat';
  const saveSB = () => store.set('armor-sandbox', SB);
  const projDef = () => E.PROJECTILES.find(p => p.id === SB.proj);
  const speedOf = () => SB.v || projDef().v;

  // ===================== The simulation =====================
  let sim = null, state = 'idle', approachT0 = 0, verdict = null, verdictAt = 0, runStart = 0, flashes = [], seenEvents = 0, visible = false, raf = 0, stepsPerSec = 0;
  const cam = { x: 0, y: 0, s: 1 };

  // Plates mustn't start inside each other along the shot line
  function tidyPlates() {
    SB.plates[0].x = 0;
    for (let i = 1; i < SB.plates.length; i++) {
      const a = SB.plates[i - 1], t = E.plateThickness(a), min = a.x + t / Math.max(0.2, Math.cos(a.ang * Math.PI / 180)) + 2;
      if (SB.plates[i].x < min) SB.plates[i].x = Math.round(min);
    }
  }
  function rebuild() {
    tidyPlates();
    const P = projDef();
    const scene = { plates: clone(SB.plates), proj: { ...P, v: speedOf(), aim: SB.aim } };
    scene.h = E.pickH(scene, QUALITY[SB.quality][1]);
    sim = new E.Sim(scene);
    state = 'ready'; verdict = null; flashes = []; seenEvents = 0;
    fit(); renderResult(); renderControlsState(); draw();
  }
  let rbTimer = 0;
  const rebuildSoon = () => { clearTimeout(rbTimer); rbTimer = setTimeout(() => { rebuild(); saveSB(); }, 160); };

  function fire() {
    if (!sim || state === 'done' || state === 'running' || state === 'approach' || state === 'paused') rebuild();
    state = 'approach'; approachT0 = performance.now(); runStart = 0;
    sound('fire'); countPlay(); renderControlsState(); renderResult();
    loop();
  }
  function finish() {
    state = 'done';
    const v = verdict || sim.verdict() || 'stop';
    verdict = v;
    sound(v === 'rico' ? 'rico' : v === 'pen' ? 'pen' : v === 'spall' ? 'boom' : 'stop');
    renderResult(); renderControlsState();
  }

  // ===================== The loop =====================
  let lastNow = 0;
  function loop() { if (!raf) raf = requestAnimationFrame(tick); }
  function tick(now) {
    raf = 0;
    if (!visible || !sim) return;
    const dtReal = Math.min(0.05, (now - (lastNow || now)) / 1000); lastNow = now;
    if (state === 'approach' && now - approachT0 > 450) { state = 'running'; runStart = now; }
    if (state === 'running') {
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
    // new explosions / flashes from the engine
    while (seenEvents < sim.events.length) { const ev = sim.events[seenEvents++]; flashes.push({ ...ev, at: now }); }
    flashes = flashes.filter(f => now - f.at < 700);
    draw(now);
    if (state === 'running' || state === 'approach' || flashes.length) loop();
  }

  // ===================== Drawing =====================
  const cv = $('sb-canvas'), ctx = cv.getContext('2d');
  let img = null, buf = null, W = 0, H = 0, dpr = 1, tagEnd = 0;
  function resize() {
    const r = cv.getBoundingClientRect();
    dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const w = Math.max(50, Math.round(r.width * dpr)), h = Math.max(50, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; img = null; }
    W = r.width; H = r.height;
    const tag = cv.parentElement.querySelector('.view-tag'); tagEnd = tag ? tag.offsetLeft + tag.offsetWidth : 0;   // the clock must not cover the label
    if (!img) { img = ctx.createImageData(cv.width, cv.height); buf = new Uint32Array(img.data.buffer); }
  }
  function bounds() {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < sim.n; i++) { if (!sim.alive[i]) continue; const x = sim.px[i], y = sim.py[i]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const sh = sim.shape, len = sh.x1 - sh.x0;
    x0 = Math.min(x0, sim.noseX - len * 1.15); y0 = Math.min(y0, sim.aimY - sh.r * 1.5); y1 = Math.max(y1, sim.aimY + sh.r * 1.5);
    return [x0, x1, y0, y1];
  }
  function fit() {
    resize();
    const [x0, x1, y0, y1] = bounds(), bw = (x1 - x0) * 1.12 || 100, bh = (y1 - y0) * 1.15 || 100;
    cam.s = Math.min(W / bw, H / bh); cam.x = (x0 + x1) / 2; cam.y = (y0 + y1) / 2;
  }
  const toSX = x => W / 2 + (x - cam.x) * cam.s, toSY = y => H / 2 - (y - cam.y) * cam.s;
  const toWX = sx => cam.x + (sx - W / 2) / cam.s, toWY = sy => cam.y - (sy - H / 2) / cam.s;

  // colors: packed 0xAABBGGRR for the pixel buffer
  const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const MATRGB = E.MAT_KEYS.map(k => rgb(E.MATERIALS[k].color));
  const pack = (r, g, b) => (255 << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
  const BG = pack(14, 18, 22);
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
    if (!visible || !sim) return;
    resize();
    buf.fill(BG);
    const s = cam.s * dpr, cw = cv.width, ch = cv.height, splat = Math.max(1, Math.ceil(sim.h * s * 1.05)), half = splat / 2;
    const cx = cw / 2 - cam.x * s, cy = ch / 2 + cam.y * s;
    const view = SB.view, n = sim.n;
    const px = sim.px, py = sim.py, alive = sim.alive, mat = sim.mat, T = sim.T, shade = sim.shade, body = sim.body, vx = sim.vx, vy = sim.vy;
    // the incoming shell slides in from the left before the physics starts
    let off = 0;
    if (state === 'approach' || state === 'ready') {
      const f = state === 'ready' ? 0 : Math.min(1, (now - approachT0) / 450), e = 1 - Math.pow(1 - f, 2);
      off = state === 'ready' ? 0 : -(1 - e) * Math.max(W / cam.s, 400);
    }
    for (let i = 0; i < n; i++) {
      if (alive[i] === 0) continue;
      let x = px[i], y = py[i];
      if (off && body[i] === 0) x += off;
      const sx = (cx + x * s - half) | 0, sy = (cy - y * s - half) | 0;
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
    ctx.putImageData(img, 0, 0);
    ctx.save(); ctx.scale(dpr, dpr);
    overlays(now, off);
    ctx.restore();
  }

  function overlays(now, off) {
    const c = ctx, P = projDef(), sh = sim.shape;
    // chemical rounds are drawn as a picture while they fly in
    if (P.kind !== 'ke' && (state === 'ready' || state === 'approach')) {
      const len = (sh.x1 - sh.x0) * cam.s, sc = Math.max(0.2, len / 60);
      c.save(); c.globalAlpha = state === 'ready' ? 0.9 : 1;
      drawShell(c, P.kind === 'heat' ? 'heat' : P.kind === 'hesh' ? 'hesh' : 'he', toSX(sim.noseX + off), toSY(sim.aimY), 0, sc, 1);
      c.restore();
    }
    // aim line before firing
    if (state === 'ready') {
      const yS = toSY(sim.aimY), xH = toSX(sim.hitX);
      c.save(); c.setLineDash([6, 6]); c.strokeStyle = 'rgba(255,176,32,.7)'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(0, yS); c.lineTo(xH, yS); c.stroke(); c.restore();
      c.strokeStyle = '#ffb020'; c.lineWidth = 2; c.beginPath(); c.arc(xH, yS, 9, 0, Math.PI * 2); c.moveTo(xH - 15, yS); c.lineTo(xH + 15, yS); c.moveTo(xH, yS - 15); c.lineTo(xH, yS + 15); c.stroke();
    }
    // flashes from explosions
    for (const f of flashes) {
      const a = (now - f.at) / 700, r = Math.max(8, (f.r || 40) * cam.s) * (0.4 + a * 0.9), x = toSX(f.x), y = toSY(f.y);
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      if (f.type === 'scab') { g.addColorStop(0, `rgba(255,220,150,${0.6 * (1 - a)})`); g.addColorStop(1, 'rgba(255,150,40,0)'); }
      else { g.addColorStop(0, `rgba(255,252,230,${1 - a})`); g.addColorStop(0.35, `rgba(255,190,60,${0.85 * (1 - a)})`); g.addColorStop(1, 'rgba(255,90,20,0)'); }
      c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); c.restore();
    }
    // scale bar
    const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000], mm = nice.find(v => v * cam.s >= 70) || 1000, L = mm * cam.s;
    c.fillStyle = 'rgba(9,12,15,.8)'; c.fillRect(10, H - 34, L + 20, 24);
    c.strokeStyle = '#ecf0f3'; c.lineWidth = 2; c.beginPath(); c.moveTo(20, H - 18); c.lineTo(20 + L, H - 18); c.moveTo(20, H - 23); c.lineTo(20, H - 13); c.moveTo(20 + L, H - 23); c.lineTo(20 + L, H - 13); c.stroke();
    c.fillStyle = '#ecf0f3'; c.font = '600 11px "JetBrains Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText(`${mm} mm`, 20 + L / 2, H - 20);
    // clock
    c.textAlign = 'right'; c.textBaseline = 'top'; c.font = '700 13px "JetBrains Mono", monospace';
    c.fillStyle = 'rgba(9,12,15,.8)'; const tt = `t = ${sim.time.toFixed(1)} µs`; const tw = c.measureText(tt).width;
    const cy = W - tw - 22 < tagEnd + 8 ? 30 : 8;   // narrow screen: drop below the label
    c.fillRect(W - tw - 22, cy, tw + 14, 24); c.fillStyle = '#ffb020'; c.fillText(tt, W - 15, cy + 5);
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
  function renderLive() { $('sb-live').textContent = liveLine(); }
  function renderResult() {
    const box = $('sb-result'), P = projDef(), est = formulaEstimate(P, speedOf());
    if (!sim) return;
    if (state !== 'done') {
      const msg = state === 'ready' ? 'Press <b>Fire</b> (or Space). Click the armor to aim somewhere else.' : 'Simulating… every particle is doing its own physics.';
      box.innerHTML = `<span class="badge idle">${state === 'ready' ? 'READY' : 'LIVE'}</span><div class="txt">${msg}</div>`;
      $('sb-live').textContent = state === 'ready' ? `${sim.n.toLocaleString()} particles · ${sim.nb.toLocaleString()} bonds · particle size ${sim.h.toFixed(sim.h < 1 ? 2 : 1)} mm` : liveLine();
      return;
    }
    const r = sim.measure(), v = verdict, [st, badge] = SB_WORDS[v] || SB_WORDS.stop;
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
      ${est ? `<p class="sb-est">📏 Classic formula: this ${esc(P.name)} beats about <b>${est.toLocaleString()} mm</b> of flat armor steel${kind === 'ke' ? ` at ${speedOf().toLocaleString()} m/s` : ''}. The sim is a 2D slice, so it won't match exactly.</p>` : ''}</div>`;
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
    $('sb-v-field').hidden = !ke; $('sb-v-note').hidden = ke;
    if (ke) { $('sb-v').value = speedOf(); $('sb-v-out').textContent = speedOf().toLocaleString() + ' m/s'; }
    $('sb-v-note').textContent = P.kind === 'heat' ? 'Speed doesn\'t matter: the jet does the work (its tip flies at ' + P.d.vTip + ' km/s).' : 'Speed doesn\'t matter: it works by exploding on contact.';
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
  function renderPlates() {
    $('sb-preset').value = SB.preset && E.ARMORS.some(a => a.id === SB.preset) ? SB.preset : 'custom';
    $('sb-plates').innerHTML = SB.plates.map((p, i) => {
      const T = E.plateThickness(p);
      return `<div class="plate-card" data-i="${i}">
        <div class="pc-head"><b>Plate ${i + 1}</b><span>${T} mm · ${p.ang}°</span>
          <button class="mini" data-act="dup" title="Copy this plate" aria-label="Copy plate ${i + 1}">⧉</button>${SB.plates.length > 1 ? `<button class="mini" data-act="del" title="Remove this plate" aria-label="Remove plate ${i + 1}">✕</button>` : ''}</div>
        <div class="pc-sub">Layers, outside → inside</div>
        ${p.layers.map((l, j) => `<div class="layer"><i style="background:${E.MATERIALS[l.mat].color}"></i><select data-act="mat" data-j="${j}" aria-label="Layer ${j + 1} material">${matOptions(l.mat)}</select><input type="number" data-act="t" data-j="${j}" min="1" max="1000" value="${l.t}" aria-label="Layer ${j + 1} thickness in mm"><span>mm</span>${p.layers.length > 1 ? `<button class="mini" data-act="dell" data-j="${j}" aria-label="Remove layer ${j + 1}">✕</button>` : '<span class="mini-gap"></span>'}</div>`).join('')}
        <button class="mini wide" data-act="addl">+ Add a layer</button>
        <div class="field"><label>Angle</label><output>${p.ang}°</output><input type="range" data-act="ang" min="-80" max="80" step="1" value="${p.ang}" aria-label="Plate ${i + 1} angle"></div>
        ${i > 0 ? `<div class="field"><label>Distance from plate 1</label><output>${p.x} mm</output><input type="range" data-act="x" min="0" max="1200" step="5" value="${p.x}" aria-label="Plate ${i + 1} distance"></div>` : ''}
      </div>`;
    }).join('');
  }
  function renderControlsState() {
    const running = state === 'running' || state === 'approach';
    $('sb-fire').textContent = state === 'done' ? '🔥 Fire again' : '🔥 Fire';
    $('sb-fire').disabled = running;
    $('sb-pause').disabled = !(running || state === 'paused');
    $('sb-pause').textContent = state === 'paused' ? '▶ Resume' : '⏸ Pause';
    $('sb-step').disabled = state !== 'paused';
    seg('sb-view', VIEWS, SB.view, 'view'); seg('sb-speed', SPEEDS, SB.speed, 'speed'); seg('sb-quality', QUALITY, SB.quality, 'quality');
    $('sb-legend').innerHTML = legendHTML();
  }
  function legendHTML() {
    const bar = stops => `linear-gradient(90deg, ${stops.map(([, c], k) => `rgb(${c.join(',')}) ${Math.round(k / (stops.length - 1) * 100)}%`).join(', ')})`;
    if (SB.view === 'heat') return `<span>🔥 Temperature</span><i style="background:${bar(HEAT)}"></i><span>20 °C → 1,800 °C</span>`;
    if (SB.view === 'speed') return `<span>💨 Speed</span><i style="background:${bar(SPEED)}"></i><span>still → 3 km/s</span>`;
    if (SB.view === 'damage') return `<span>💔 Damage</span><i style="background:${bar(DMG)}"></i><span>intact → shattered</span><span><b style="color:#aa6ef0">■</b> torn off</span>`;
    const used = new Set([...SB.plates.flatMap(p => p.layers.map(l => l.mat))]);
    return [...used].map(k => `<span><b style="color:${E.MATERIALS[k].color}">■</b> ${esc(E.MATERIALS[k].name)}</span>`).join('') + '<span>· glowing = hot</span>';
  }

  // events
  $('sb-proj').addEventListener('change', e => { SB.proj = e.target.value; SB.v = null; renderProjControls(); rebuildSoon(); });
  $('sb-v').addEventListener('input', e => { SB.v = +e.target.value; $('sb-v-out').textContent = SB.v.toLocaleString() + ' m/s'; rebuildSoon(); });
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
    if (act === 'dup') { const c = clone(p); c.x = p.x + E.plateThickness(p) / Math.max(0.2, Math.cos(p.ang * Math.PI / 180)) + 60; SB.plates.splice(i + 1, 0, c); }
    else if (act === 'del') SB.plates.splice(i, 1);
    else if (act === 'addl') p.layers.push({ mat: 'rha', t: 20 });
    else if (act === 'dell') p.layers.splice(+b.dataset.j, 1);
    customized(); tidyPlates(); renderPlates(); rebuildSoon();
  });
  $('sb-add-plate').addEventListener('click', () => {
    const last = SB.plates[SB.plates.length - 1];
    if (SB.plates.length >= 6) return;
    SB.plates.push({ x: last.x + E.plateThickness(last) / Math.max(0.2, Math.cos(last.ang * Math.PI / 180)) + 150, ang: 0, len: 'auto', layers: [{ mat: 'rha', t: 30 }] });
    customized(); renderPlates(); rebuildSoon();
  });
  $('sb-fire').addEventListener('click', fire);
  $('sb-reset').addEventListener('click', () => { rebuild(); });
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
    if (q) { SB.quality = q.dataset.quality; saveSB(); renderControlsState(); rebuild(); }
  });
  $('sb-zoom-in').addEventListener('click', () => { cam.s *= 1.3; draw(); });
  $('sb-zoom-out').addEventListener('click', () => { cam.s /= 1.3; draw(); });
  $('sb-zoom-fit').addEventListener('click', () => { fit(); draw(); });

  // the canvas: drag to look around, wheel to zoom, click to aim
  let drag = null;
  cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false }; });
  cv.addEventListener('pointermove', e => {
    if (!drag || !(e.buttons || e.pointerType !== 'mouse')) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 5) { drag.moved = true; try { cv.setPointerCapture(e.pointerId); } catch (err) {} }
    if (drag.moved) { cam.x = drag.cx - dx / cam.s; cam.y = drag.cy + dy / cam.s; draw(); }
  });
  cv.addEventListener('pointerup', e => {
    if (drag && !drag.moved && (state === 'ready' || state === 'done')) {   // aim where you clicked
      const r = cv.getBoundingClientRect(), y = toWY(e.clientY - r.top);
      SB.aim = clamp(Math.round(y), -400, 400); renderProjControls(); rebuild(); saveSB();
    }
    drag = null;
  });
  cv.addEventListener('pointercancel', () => { drag = null; });
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, wx = toWX(mx), wy = toWY(my);
    cam.s *= Math.exp(-e.deltaY * 0.0015); cam.s = clamp(cam.s, 0.05, 80);
    cam.x = wx - (mx - W / 2) / cam.s; cam.y = wy + (my - H / 2) / cam.s; draw();
  }, { passive: false });
  cv.addEventListener('dblclick', () => { fit(); draw(); });
  addEventListener('keydown', e => {
    if (!visible || e.key !== ' ') return;
    const a = document.activeElement;
    if (a && (a.tagName === 'BUTTON' || a.tagName === 'SELECT' || a.tagName === 'A' || (a.tagName === 'INPUT' && a.type !== 'range'))) return;
    e.preventDefault();
    if (state === 'running' || state === 'approach' || state === 'paused') $('sb-pause').click(); else fire();
  });
  let rsT = 0;
  new ResizeObserver(() => { if (!visible) return; clearTimeout(rsT); rsT = setTimeout(() => { fit(); draw(); }, 80); }).observe(cv);

  // ===================== Showing and hiding (mode tabs) =====================
  window.Sandbox = {
    show() {
      visible = true;
      if (!sim) rebuild(); else { fit(); draw(); }
      if (state === 'running' || state === 'approach') loop();
    },
    hide() { visible = false; if (state === 'running' || state === 'approach') state = 'paused'; renderControlsState(); },
    get sim() { return sim; }, get state() { return state; }, get verdict() { return verdict; }, fire, rebuild, SB,
  };
  renderProjControls(); renderPlates(); renderControlsState();
  if (S.mode === 'sandbox') Sandbox.show();
})();
