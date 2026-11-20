// Nuke Sim: draws everything that moves or burns on the 3D globe. Missile trails that rise off the globe
// (red near the launch, orange and yellow toward the warhead), bright warhead heads, white flashes, white
// smoke puffs over a red glow where warheads hit, fallout drifting east, submarines, silo fields, colored
// city dots and aircraft taking off. Everything is drawn with three.js inside the globe from globe.js.
(function (root) {
  'use strict';
  const NS = root.NS = root.NS || {};
  const DEG = Math.PI / 180;

  // ✏️ EDIT: colors and sizes
  const STYLE = {
    trailLaunch: [1.0, 0.10, 0.0],      // red, near where the missile was fired
    trailMid: [1.0, 0.42, 0.0],         // orange
    trailHead: [1.0, 0.86, 0.12],       // yellow, just behind the warhead
    trailStrength: 0.62,                // how bright one trail is (bundles of trails add up toward yellow-white)
    trailWidth: 2.0,                    // px, from far away (grows a little as you zoom in)
    trailFade: 240,                     // sim seconds a trail stays after its warhead lands
    head: [1.0, 0.97, 0.75],
    puff: [1.0, 1.0, 1.0],              // the white smoke cloud left at each hit
    glow: [1.0, 0.08, 0.04],            // red glow under it
    flashCore: [1.0, 1.0, 1.0],
    flashRing: [1.0, 0.55, 0.12],
    flashSeconds: 1.6,                  // real seconds a flash lasts
    fallout: [0.66, 0.33, 0.97],
    silo: [1.0, 0.86, 0.15],
    siloRing: [0.3, 0.85, 0.25],
    base: [1.0, 0.35, 0.2],
    cityBig: [1.0, 0.88, 0.25],         // cities of 1 million or more
    cityMid: [0.35, 0.86, 0.35],        // 300,000 to 1 million
    citySmall: [0.26, 0.84, 0.92],      // smaller cities
    target: [1.0, 0.16, 0.16]           // military targets
  };

  const R = 100, EARTH_KM = 6371;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ------------------------------------------------------------------ small pictures drawn once on a canvas
  function canvasTex(THREE, size, draw) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace || t.colorSpace;
    return t;
  }
  function glowTex(THREE) {
    return canvasTex(THREE, 64, (g, s) => {
      const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,.75)');
      r.addColorStop(0.6, 'rgba(255,255,255,.18)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, s, s);
    });
  }
  function dotTex(THREE) {
    return canvasTex(THREE, 32, (g, s) => {
      g.fillStyle = '#fff'; g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 3, 0, Math.PI * 2); g.fill();
    });
  }
  function ringTex(THREE) {
    return canvasTex(THREE, 64, (g, s) => {
      const r = g.createRadialGradient(s / 2, s / 2, s * 0.28, s / 2, s / 2, s / 2);
      r.addColorStop(0, 'rgba(255,255,255,0)'); r.addColorStop(0.55, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, s, s);
    });
  }
  // A fluffy white cloud: overlapping soft circles (what a mushroom cloud looks like from above)
  function puffTex(THREE) {
    return canvasTex(THREE, 128, (g, s) => {
      const rng = NS.rng ? NS.rng(7) : Math.random;
      const blobs = [[0.5, 0.5, 0.3]];
      for (let i = 0; i < 9; i++) { const a = rng() * Math.PI * 2, d = 0.1 + rng() * 0.12; blobs.push([0.5 + Math.cos(a) * d, 0.5 + Math.sin(a) * d, 0.13 + rng() * 0.1]); }
      blobs.forEach(([x, y, r]) => {
        const gr = g.createRadialGradient(x * s, y * s, 0, x * s, y * s, r * s);
        gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.7, 'rgba(250,250,250,.95)'); gr.addColorStop(1, 'rgba(240,240,240,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x * s, y * s, r * s, 0, Math.PI * 2); g.fill();
      });
      // a little shading so it reads as a cloud, not a dot
      const sh = g.createRadialGradient(s * 0.62, s * 0.66, 0, s * 0.62, s * 0.66, s * 0.4);
      sh.addColorStop(0, 'rgba(150,150,160,.28)'); sh.addColorStop(1, 'rgba(150,150,160,0)');
      g.globalCompositeOperation = 'source-atop'; g.fillStyle = sh; g.fillRect(0, 0, s, s);
    });
  }
  // A submarine seen from the side: grey hull with a red waterline (blue side) or all red (red side)
  function subTex(THREE, red) {
    return canvasTex(THREE, 128, (g, s) => {
      const y = s / 2, L = s * 0.92, x0 = (s - L) / 2, h = s * 0.075;
      g.save();
      g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 4;
      // hull
      g.fillStyle = red ? '#d61f1f' : '#8f969e';
      g.beginPath();
      g.moveTo(x0 + h, y - h); g.lineTo(x0 + L - h * 2.2, y - h);
      g.quadraticCurveTo(x0 + L, y - h * 0.6, x0 + L, y); g.quadraticCurveTo(x0 + L, y + h * 0.7, x0 + L - h * 2.2, y + h);
      g.lineTo(x0 + h, y + h); g.quadraticCurveTo(x0 - h * 0.4, y, x0 + h, y - h);
      g.fill();
      g.restore();
      // red waterline / dark top for the grey ones
      if (!red) { g.fillStyle = '#d42a2a'; g.fillRect(x0 + h, y + h * 0.35, L - h * 3, h * 0.65); }
      else { g.fillStyle = '#ff6a5a'; g.fillRect(x0 + h, y - h, L - h * 3.2, h * 0.35); }
      // sail (the tower)
      g.fillStyle = red ? '#b81616' : '#7a8088';
      g.fillRect(x0 + L * 0.36, y - h * 2.3, L * 0.06, h * 1.4);
      // rudder
      g.beginPath(); g.moveTo(x0 + h * 0.6, y - h); g.lineTo(x0 - h * 0.2, y - h * 2); g.lineTo(x0 + h * 1.6, y - h); g.fill();
    });
  }
  // A white airplane pointing up (the picture is turned to the way it flies)
  function planeTex(THREE) {
    return canvasTex(THREE, 64, (g, s) => {
      g.translate(s / 2, s / 2); g.scale(s / 64, s / 64);
      g.fillStyle = '#fff'; g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 3;
      g.beginPath();
      g.moveTo(0, -26); g.quadraticCurveTo(3, -22, 3, -14); g.lineTo(3, -6); g.lineTo(24, 6); g.lineTo(24, 10); g.lineTo(3, 4);
      g.lineTo(3, 16); g.lineTo(9, 22); g.lineTo(9, 25); g.lineTo(0, 22); g.lineTo(-9, 25); g.lineTo(-9, 22); g.lineTo(-3, 16);
      g.lineTo(-3, 4); g.lineTo(-24, 10); g.lineTo(-24, 6); g.lineTo(-3, -6); g.lineTo(-3, -14); g.quadraticCurveTo(-3, -22, 0, -26);
      g.fill();
    });
  }

  // ------------------------------------------------------------------ one shader for every sprite we draw
  // Each point has a color (with opacity), a size (km on the ground, or screen pixels) and a turn angle.
  const VERT = [
    'attribute vec4 rgba;', 'attribute float size;', 'attribute float minpx;', 'attribute float angle;',
    'uniform float uScale;', 'uniform float uPx;', 'uniform float uMin;', 'uniform float uMax;', 'uniform float uDpr;',
    'varying vec4 vColor;', 'varying float vAngle;',
    'void main() {',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  float px = uPx > 0.5 ? size * uDpr : size * uScale / max(0.0001, -mv.z);',
    '  px = max(px, minpx * uMin * uDpr);',
    '  gl_PointSize = clamp(px, 0.0, uMax);',
    '  vColor = rgba; vAngle = angle;',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');
  const FRAG = [
    'uniform sampler2D map;', 'varying vec4 vColor;', 'varying float vAngle;',
    'void main() {',
    '  vec2 c = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y) - 0.5;',
    '  float s = sin(vAngle), k = cos(vAngle);',
    '  vec2 uv = vec2(k * c.x - s * c.y, s * c.x + k * c.y) + 0.5;',
    '  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;',
    '  vec4 t = texture2D(map, uv);',
    '  float a = vColor.a * t.a;',
    '  if (a < 0.004) discard;',
    '  gl_FragColor = vec4(vColor.rgb * t.rgb, a);',
    '}'
  ].join('\n');

  // A growable set of sprites (positions, colors, sizes) drawn in one go
  function SpriteLayer(THREE, opts) {
    this.THREE = THREE;
    this.cap = 0; this.n = 0;
    this.geo = new THREE.BufferGeometry();
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: opts.texture }, uScale: { value: 1 }, uPx: { value: opts.px ? 1 : 0 },
        uMin: { value: 1 }, uMax: { value: 512 }, uDpr: { value: 1 }
      },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: opts.depthTest !== false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = opts.order || 0;
    this.grow(opts.cap || 64);
  }
  SpriteLayer.prototype.grow = function (cap) {
    const THREE = this.THREE, old = this.arr;
    this.cap = cap;
    this.arr = {
      position: new Float32Array(cap * 3), rgba: new Float32Array(cap * 4), size: new Float32Array(cap),
      minpx: new Float32Array(cap), angle: new Float32Array(cap)
    };
    if (old) Object.keys(old).forEach(k => this.arr[k].set(old[k].subarray(0, Math.min(old[k].length, this.arr[k].length))));
    const dims = { position: 3, rgba: 4, size: 1, minpx: 1, angle: 1 };
    Object.keys(dims).forEach(k => {
      const a = new THREE.BufferAttribute(this.arr[k], dims[k]);
      a.setUsage(THREE.DynamicDrawUsage);
      this.geo.setAttribute(k, a);
    });
  };
  SpriteLayer.prototype.clear = function () { this.n = 0; this.geo.setDrawRange(0, 0); };
  SpriteLayer.prototype.push = function (x, y, z, r, g, b, a, size, minpx, angle) {
    if (this.n >= this.cap) this.grow(this.cap * 2);
    const i = this.n++, A = this.arr;
    A.position[i * 3] = x; A.position[i * 3 + 1] = y; A.position[i * 3 + 2] = z;
    A.rgba[i * 4] = r; A.rgba[i * 4 + 1] = g; A.rgba[i * 4 + 2] = b; A.rgba[i * 4 + 3] = a;
    A.size[i] = size; A.minpx[i] = minpx || 0; A.angle[i] = angle || 0;
    return i;
  };
  SpriteLayer.prototype.commit = function () {
    const n = this.n;
    ['position', 'rgba', 'size', 'minpx', 'angle'].forEach(k => {
      const at = this.geo.getAttribute(k);
      at.clearUpdateRanges && at.clearUpdateRanges();
      if (n) { at.addUpdateRange ? at.addUpdateRange(0, n * at.itemSize) : null; at.needsUpdate = true; }
    });
    this.geo.setDrawRange(0, n);
  };
  SpriteLayer.prototype.uniforms = function (u) {
    const U = this.mat.uniforms;
    for (const k in u) U[k].value = u[k];
  };

  // ------------------------------------------------------------------ the renderer

  function Renderer(view) {
    if (!view || !view.scene || !root.THREE) throw new Error('Renderer needs the globe view');
    const THREE = root.THREE;
    this.view = view; this.THREE = THREE;
    this.options = { trails: true, damage: true, fallout: true };
    this.strikes = [];
    this.arcs = new Map();          // strike → its path through the sky (worked out once)
    this.booms = [];                // detonations so far: { s, x, y, z, puffKm, glowKm, at (sim), real (ms) }
    this.flashes = [];
    this.sites = [];
    this.aircraft = [];
    this.t = 0;
    this.group = new THREE.Group();
    view.scene.add(this.group);

    const tex = { glow: glowTex(THREE), dot: dotTex(THREE), ring: ringTex(THREE), puff: puffTex(THREE), subRed: subTex(THREE, true), subGrey: subTex(THREE, false), plane: planeTex(THREE) };
    this.tex = tex;
    const L = this.layers = {
      cities: new SpriteLayer(THREE, { texture: tex.dot, px: true, order: 5, cap: 2048 }),
      sites: new SpriteLayer(THREE, { texture: tex.dot, px: true, order: 6, cap: 1024 }),
      fallout: new SpriteLayer(THREE, { texture: tex.glow, order: 8, cap: 1024 }),
      glow: new SpriteLayer(THREE, { texture: tex.glow, additive: true, order: 9, cap: 1024 }),
      puffs: new SpriteLayer(THREE, { texture: tex.puff, order: 10, cap: 1024 }),
      subsRed: new SpriteLayer(THREE, { texture: tex.subRed, px: true, order: 11, cap: 64 }),
      subsGrey: new SpriteLayer(THREE, { texture: tex.subGrey, px: true, order: 11, cap: 64 }),
      planes: new SpriteLayer(THREE, { texture: tex.plane, px: true, order: 12, cap: 256 }),
      heads: new SpriteLayer(THREE, { texture: tex.glow, px: true, additive: true, order: 21, cap: 4096 }),
      flashes: new SpriteLayer(THREE, { texture: tex.glow, additive: true, order: 22, cap: 256 }),
      rings: new SpriteLayer(THREE, { texture: tex.ring, additive: true, order: 22, cap: 256 })
    };
    Object.keys(L).forEach(k => this.group.add(L[k].points));

    // the missile trails: thick lines (a few pixels wide) that are rebuilt every frame
    this.trailCap = 0;
    this.trailGeo = new THREE.LineSegmentsGeometry();
    this.trailMat = new THREE.LineMaterial({
      linewidth: STYLE.trailWidth, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, worldUnits: false
    });
    this.trails = new THREE.LineSegments2(this.trailGeo, this.trailMat);
    this.trails.frustumCulled = false;
    this.trails.renderOrder = 20;
    this.group.add(this.trails);
    this.growTrails(30000);

    const gl = view.renderer.getContext();
    this.maxPoint = (gl && gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) || [1, 256])[1] || 256;
    this.tmp = new THREE.Vector3();
  }

  Renderer.prototype.growTrails = function (cap) {
    cap = Math.max(cap, 1024);
    this.trailCap = cap;
    this.trailPos = new Float32Array(cap * 6);
    this.trailCol = new Float32Array(cap * 6);
    this.trailGeo.setPositions(this.trailPos);
    this.trailGeo.setColors(this.trailCol);
    this.trailGeo.instanceCount = 0;
  };

  // ------------------------------------------------------------------ the path of one missile
  // A great circle from launch to target, lifted into the sky (higher for longer flights, like real ballistic missiles)
  Renderer.prototype.arcOf = function (s) {
    let a = this.arcs.get(s);
    if (a) return a;
    const la1 = s.from.lat * DEG, lo1 = s.from.lon * DEG, la2 = s.to.lat * DEG, lo2 = s.to.lon * DEG;
    const A = [Math.cos(la1) * Math.sin(lo1), Math.sin(la1), Math.cos(la1) * Math.cos(lo1)];
    const B = [Math.cos(la2) * Math.sin(lo2), Math.sin(la2), Math.cos(la2) * Math.cos(lo2)];
    const w = Math.acos(clamp(A[0] * B[0] + A[1] * B[1] + A[2] * B[2], -1, 1));
    const kind = s.from && s.from.kind;
    const H = kind === 'tactical' ? 0.012 + w * 0.35 : kind === 'bomber' ? 0.004 : Math.min(0.3, 0.05 + w * 0.17);
    const N = Math.max(8, Math.min(56, Math.ceil(w / DEG / 2.2)));
    const pts = new Float32Array((N + 1) * 3), sw = Math.sin(w);
    for (let k = 0; k <= N; k++) {
      const f = k / N;
      let x, y, z;
      if (sw < 1e-6) { x = A[0]; y = A[1]; z = A[2]; }
      else { const p = Math.sin((1 - f) * w) / sw, q = Math.sin(f * w) / sw; x = p * A[0] + q * B[0]; y = p * A[1] + q * B[1]; z = p * A[2] + q * B[2]; }
      const r = R * (1 + 0.004 + H * 4 * f * (1 - f));
      pts[k * 3] = x * r; pts[k * 3 + 1] = y * r; pts[k * 3 + 2] = z * r;
    }
    a = { pts, N };
    this.arcs.set(s, a);
    return a;
  };

  // ------------------------------------------------------------------ the spec's API
  Renderer.prototype.setStrikes = function (list) { this.strikes = (list || []).slice(); this.arcs = new Map(); };
  Renderer.prototype.addStrike = function (s) { if (s) this.strikes.push(s); };

  // Launch sites: silo dots, submarines, launch points
  Renderer.prototype.setSites = function (sites) {
    this.sites = sites || [];
    const L = this.layers, V = this.view;
    L.sites.clear(); L.subsRed.clear(); L.subsGrey.clear();
    const p = {};
    this.sites.forEach(s => {
      if (!isFinite(s.lat) || !isFinite(s.lon)) return;
      if (s.kind === 'sub') {
        V.xyz(s.lat, s.lon, 0.003, p);
        (s.side === 'red' ? L.subsRed : L.subsGrey).push(p.x, p.y, p.z, 1, 1, 1, 1, 30, 0, 0);
      } else if (s.kind === 'silo') {
        V.xyz(s.lat, s.lon, 0.0042, p);
        L.sites.push(p.x, p.y, p.z, STYLE.siloRing[0], STYLE.siloRing[1], STYLE.siloRing[2], 0.55, 5, 0, 0);
        L.sites.push(p.x, p.y, p.z, STYLE.silo[0], STYLE.silo[1], STYLE.silo[2], 1, 2.6, 0, 0);
      } else {
        V.xyz(s.lat, s.lon, 0.0042, p);
        L.sites.push(p.x, p.y, p.z, STYLE.base[0], STYLE.base[1], STYLE.base[2], 1, 4, 0, 0);
      }
    });
    L.sites.commit(); L.subsRed.commit(); L.subsGrey.commit();
  };

  // Tiny colored dots for the cities (and red ones for military targets) of the countries at war, like the videos
  Renderer.prototype.setCityDots = function (countries) {
    const L = this.layers.cities, V = this.view, p = {};
    L.clear();
    const set = new Set(countries || []);
    if (set.size) {
      (NS.CITIES || []).forEach(c => {
        if (!set.has(c[1])) return;
        const col = c[4] >= 1e6 ? STYLE.cityBig : c[4] >= 3e5 ? STYLE.cityMid : STYLE.citySmall;
        V.xyz(c[2], c[3], 0.0041, p);
        L.push(p.x, p.y, p.z, col[0], col[1], col[2], 0.95, c[4] >= 1e6 ? 3.2 : 2.4, 0, 0);
      });
      (NS.TARGETS || []).forEach(t => {
        if (!set.has(t.cc)) return;
        V.xyz(t.lat, t.lon, 0.0042, p);
        L.push(p.x, p.y, p.z, STYLE.target[0], STYLE.target[1], STYLE.target[2], 1, 4, 0, 0);
      });
    }
    L.commit();
  };

  // Aircraft taking off when the warning comes (bombers and command planes flying away to survive)
  // list: [{ lat, lon, bearing (degrees), start (sim s), speed (km/h), range (km) }]
  Renderer.prototype.setAircraft = function (list) { this.aircraft = (list || []).filter(a => isFinite(a.lat) && isFinite(a.lon)); };

  Renderer.prototype.detonate = function (s, opts) {
    if (!s || !s.to) return;
    const instant = !!(opts && opts.instant);
    const E = NS.Effects;
    const r = E && E.radii ? E.radii(+s.yieldKt || 100, s.burst || 'air') : { fireball: 0.6, psi20: 2, psi5: 4.5, thermal: 7, psi1: 12 };
    const p = this.view.xyz(s.to.lat, s.to.lon, 0.0045, {});
    const yk = clamp(Math.log10(Math.max(1, +s.yieldKt || 100)) / 3.3, 0.35, 1.25);   // bigger bombs make bigger puffs from far away
    const b = { s, x: p.x, y: p.y, z: p.z, puffKm: Math.max(r.psi20, r.fireball * 2), glowKm: r.psi5 * 1.25, yk, at: s.launchAt + s.flight, real: instant ? -1e9 : performance.now() };
    this.booms.push(b);
    this.addBoom(b);
    if (!instant) this.flashes.push(b);
  };
  Renderer.prototype.addBoom = function (b) {
    const L = this.layers, V = this.view;
    L.glow.push(b.x, b.y, b.z, STYLE.glow[0], STYLE.glow[1], STYLE.glow[2], 0.75, b.glowKm * 2 * R / EARTH_KM * 2.2, 2.4 * b.yk, 0);
    L.puffs.push(b.x, b.y, b.z, STYLE.puff[0], STYLE.puff[1], STYLE.puff[2], 0.96, b.puffKm * 2 * R / EARTH_KM * 1.6, 1.0 * b.yk, (b.s.id || 0) * 2.39);
    if (this.options.fallout && b.s.burst === 'ground' && NS.Effects && NS.Effects.fallout) {
      const f = NS.Effects.fallout(+b.s.yieldKt || 100, 'ground');
      if (f && f.length > 0) {
        // a plume blown east by the wind: a row of soft violet blobs
        const n = 5, p = {};
        for (let i = 1; i <= n; i++) {
          const d = f.length * (i - 0.5) / n, w = f.width * (1 - i * 0.12);
          const lat = b.s.to.lat + Math.sin(i * 0.5) * 0.08 * (d / 111);
          const lon = b.s.to.lon + d / (111.3 * Math.max(0.2, Math.cos(b.s.to.lat * DEG)));
          V.xyz(lat, lon, 0.0043, p);
          L.fallout.push(p.x, p.y, p.z, STYLE.fallout[0], STYLE.fallout[1], STYLE.fallout[2], 0.22 * (1 - i / (n + 2)), w * R / EARTH_KM * 2.4, 0, 0);
        }
      }
    }
    this.boomsDirty = true;
  };

  Renderer.prototype.reset = function () {
    this.booms = []; this.flashes = [];
    ['glow', 'puffs', 'fallout', 'flashes', 'rings', 'heads'].forEach(k => { this.layers[k].clear(); this.layers[k].commit(); });
    this.trailGeo.instanceCount = 0;
  };

  // ------------------------------------------------------------------ every frame
  Renderer.prototype.frame = function (t) {
    this.t = t;
    const V = this.view, cam = V.camera, L = this.layers;
    const alt = Math.max(0.002, cam.position.length() / R - 1);
    const dpr = V.renderer.getPixelRatio ? V.renderer.getPixelRatio() : (root.devicePixelRatio || 1);
    const H = (V.renderer.domElement.clientHeight || innerHeight);
    const uScale = H * dpr / 2 / Math.tan((cam.fov || 50) * DEG / 2);
    // how big things look from far away: the videos make blasts and icons readable at any zoom
    const zoomK = clamp(Math.pow(1.1 / alt, 0.42), 0.55, 2.6);
    const common = { uScale, uDpr: dpr, uMax: this.maxPoint };
    L.glow.uniforms(Object.assign({ uMin: 10 * zoomK }, common));
    L.puffs.uniforms(Object.assign({ uMin: 13 * zoomK }, common));
    L.fallout.uniforms(Object.assign({ uMin: 1 }, common));
    L.flashes.uniforms(Object.assign({ uMin: 1 }, common));
    L.rings.uniforms(Object.assign({ uMin: 1 }, common));
    const iconK = clamp(Math.pow(1.4 / alt, 0.35), 0.7, 1.9);
    ['subsRed', 'subsGrey', 'planes'].forEach(k => L[k].uniforms({ uScale, uDpr: dpr * iconK, uMax: this.maxPoint }));
    ['cities', 'sites', 'heads'].forEach(k => L[k].uniforms({ uScale, uDpr: dpr * clamp(Math.pow(1.6 / alt, 0.25), 0.8, 1.6), uMax: this.maxPoint }));

    L.puffs.points.visible = L.glow.points.visible = this.options.damage !== false;
    L.fallout.points.visible = this.options.fallout !== false;
    if (this.boomsDirty) { L.glow.commit(); L.puffs.commit(); L.fallout.commit(); this.boomsDirty = false; }

    this.drawMissiles(t, alt);
    this.drawFlashes(zoomK);
    this.drawAircraft(t);
  };

  Renderer.prototype.drawMissiles = function (t, alt) {
    const heads = this.layers.heads;
    heads.clear();
    let seg = 0;
    const showTrails = this.options.trails !== false;
    const FADE = STYLE.trailFade, S = STYLE.trailStrength;
    const cL = STYLE.trailLaunch, cM = STYLE.trailMid, cH = STYLE.trailHead;
    for (let i = 0; i < this.strikes.length; i++) {
      const s = this.strikes[i];
      if (t < s.launchAt) continue;
      const end = s.launchAt + s.flight;
      const fade = t >= end ? 1 - (t - end) / FADE : 1;
      if (fade <= 0) continue;
      const f = clamp((t - s.launchAt) / Math.max(1, s.flight), 0, 1);
      const a = this.arcOf(s), P = a.pts, N = a.N;
      const kf = f * N, k0 = Math.floor(kf), fr = kf - k0;
      // head position (between two path points)
      let hx = P[k0 * 3], hy = P[k0 * 3 + 1], hz = P[k0 * 3 + 2];
      if (k0 < N) { hx += (P[k0 * 3 + 3] - hx) * fr; hy += (P[k0 * 3 + 4] - hy) * fr; hz += (P[k0 * 3 + 5] - hz) * fr; }
      if (t < end) heads.push(hx, hy, hz, STYLE.head[0], STYLE.head[1], STYLE.head[2], 1, 5.5, 0, 0);
      if (!showTrails) continue;
      const need = k0 + 1;
      if (seg + need >= this.trailCap) this.growTrails(this.trailCap * 2);
      const pos = this.trailPos, col = this.trailCol;
      for (let k = 0; k <= k0; k++) {
        const last = k === k0;
        if (last && fr < 1e-3) break;
        const x0 = P[k * 3], y0 = P[k * 3 + 1], z0 = P[k * 3 + 2];
        const x1 = last ? hx : P[k * 3 + 3], y1 = last ? hy : P[k * 3 + 4], z1 = last ? hz : P[k * 3 + 5];
        const u0 = kf > 0 ? k / kf : 0, u1 = kf > 0 ? Math.min(1, (k + 1) / kf) : 1;
        const o = seg * 6;
        pos[o] = x0; pos[o + 1] = y0; pos[o + 2] = z0; pos[o + 3] = x1; pos[o + 4] = y1; pos[o + 5] = z1;
        trailColor(col, o, u0, cL, cM, cH, S * fade);
        trailColor(col, o + 3, u1, cL, cM, cH, S * fade);
        seg++;
      }
    }
    const g = this.trailGeo;
    g.instanceCount = seg;
    const ps = g.attributes.instanceStart.data, cs = g.attributes.instanceColorStart.data;
    [ps, cs].forEach(b => { b.clearUpdateRanges && b.clearUpdateRanges(); if (seg) { b.addUpdateRange && b.addUpdateRange(0, seg * 6); b.needsUpdate = true; } });
    this.trailMat.linewidth = STYLE.trailWidth * clamp(Math.pow(1.2 / alt, 0.22), 0.85, 1.7);
    heads.commit();
  };
  function trailColor(arr, o, u, a, b, c, k) {
    let r, g, bl;
    if (u < 0.55) { const m = u / 0.55; r = a[0] + (b[0] - a[0]) * m; g = a[1] + (b[1] - a[1]) * m; bl = a[2] + (b[2] - a[2]) * m; }
    else { const m = (u - 0.55) / 0.45; r = b[0] + (c[0] - b[0]) * m; g = b[1] + (c[1] - b[1]) * m; bl = b[2] + (c[2] - b[2]) * m; }
    const w = k * (0.55 + 0.45 * u);   // brighter toward the warhead
    arr[o] = r * w; arr[o + 1] = g * w; arr[o + 2] = bl * w;
  }

  Renderer.prototype.drawFlashes = function (zoomK) {
    const F = this.layers.flashes, Rg = this.layers.rings, now = performance.now(), dur = STYLE.flashSeconds * 1000;
    F.clear(); Rg.clear();
    this.flashes = this.flashes.filter(b => now - b.real < dur);
    for (const b of this.flashes) {
      const k = (now - b.real) / dur;
      const core = Math.max(0, 1 - k * 1.6);
      const km = Math.max(b.puffKm * 3, 8) * R / EARTH_KM * 2;
      // white flash that shrinks into an orange glow
      F.push(b.x, b.y, b.z, STYLE.flashCore[0], STYLE.flashCore[1], STYLE.flashCore[2], core, km * (1.3 + k), (26 + 30 * b.yk) * zoomK * (1 - k * 0.5), 0);
      F.push(b.x, b.y, b.z, STYLE.flashRing[0], STYLE.flashRing[1], STYLE.flashRing[2], 0.9 * (1 - k), km * 2, (40 + 30 * b.yk) * zoomK * (0.6 + k * 0.6), 0);
      // a ring racing outward (the blast wave)
      Rg.push(b.x, b.y, b.z, 1, 0.75, 0.45, 0.85 * (1 - k), km * (1 + k * 3), (20 + 70 * k) * zoomK * b.yk, 0);
    }
    F.commit(); Rg.commit();
  };

  Renderer.prototype.drawAircraft = function (t) {
    const P = this.layers.planes, V = this.view;
    P.clear();
    if (!this.aircraft.length) { P.commit(); return; }
    const p = {}, q = {};
    for (const a of this.aircraft) {
      if (t < a.start) continue;
      const km = Math.min(a.range || 3000, (t - a.start) / 3600 * (a.speed || 850));
      const at = destination(a.lat, a.lon, a.bearing, km), ahead = destination(a.lat, a.lon, a.bearing, km + 40);
      V.xyz(at.lat, at.lon, 0.006, p);
      // which way is "forward" on the screen
      const s0 = V.project(at.lat, at.lon, 0.006), s1 = V.project(ahead.lat, ahead.lon, 0.006);
      if (!s0) continue;
      let ang = 0;
      if (s1) ang = Math.PI / 2 - Math.atan2(-(s1.y - s0.y), s1.x - s0.x);
      V.xyz(at.lat, at.lon, 0.006, q);
      P.push(q.x, q.y, q.z, 1, 1, 1, 0.95, 15, 0, ang);
    }
    P.commit();
  };

  // Where you end up going `km` from a place in a compass direction
  function destination(lat, lon, bearing, km) {
    const d = km / EARTH_KM, b = bearing * DEG, la = lat * DEG, lo = lon * DEG;
    const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
    const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
    return { lat: la2 / DEG, lon: ((lo2 / DEG + 540) % 360) - 180 };
  }

  NS.Renderer = Renderer;
  NS.Renderer.STYLE = STYLE;
  NS.Renderer.destination = destination;
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof window !== 'undefined' ? window : globalThis);
