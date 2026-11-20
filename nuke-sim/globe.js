// Nuke Sim: the 3D globe. Satellite pictures on a globe you can spin and zoom, the two sides colored in
// (NATO steel blue, Russia red), gold place labels on black boxes next to white dots, and a camera that can
// tilt toward the horizon and fly from place to place like the nuclear war simulation videos.
// It runs on globe.gl + three.js (lib/globe-three.min.js gives window.Globe and window.THREE).
(function (root) {
  'use strict';
  const NS = root.NS = root.NS || {};
  const DEG = Math.PI / 180;
  const R = 100;            // globe.gl draws the Earth as a ball with a radius of 100 units
  const EARTH_KM = 6371;

  // Country codes: two letters (US) → the numbers world-atlas uses for its shapes ("840")
  NS.ISO_NUMERIC = NS.ISO_NUMERIC || {
    AD: '020', AE: '784', AF: '004', AG: '028', AI: '660', AL: '008', AM: '051', AO: '024', AQ: '010', AR: '032', AS: '016', AT: '040',
    AU: '036', AW: '533', AX: '248', AZ: '031', BA: '070', BB: '052', BD: '050', BE: '056', BF: '854', BG: '100', BH: '048', BI: '108',
    BJ: '204', BL: '652', BM: '060', BN: '096', BO: '068', BQ: '535', BR: '076', BS: '044', BT: '064', BV: '074', BW: '072', BY: '112',
    BZ: '084', CA: '124', CC: '166', CD: '180', CF: '140', CG: '178', CH: '756', CI: '384', CK: '184', CL: '152', CM: '120', CN: '156',
    CO: '170', CR: '188', CU: '192', CV: '132', CW: '531', CX: '162', CY: '196', CZ: '203', DE: '276', DJ: '262', DK: '208', DM: '212',
    DO: '214', DZ: '012', EC: '218', EE: '233', EG: '818', EH: '732', ER: '232', ES: '724', ET: '231', FI: '246', FJ: '242', FK: '238',
    FM: '583', FO: '234', FR: '250', GA: '266', GB: '826', GD: '308', GE: '268', GF: '254', GG: '831', GH: '288', GI: '292', GL: '304',
    GM: '270', GN: '324', GP: '312', GQ: '226', GR: '300', GS: '239', GT: '320', GU: '316', GW: '624', GY: '328', HK: '344', HM: '334',
    HN: '340', HR: '191', HT: '332', HU: '348', ID: '360', IE: '372', IL: '376', IM: '833', IN: '356', IO: '086', IQ: '368', IR: '364',
    IS: '352', IT: '380', JE: '832', JM: '388', JO: '400', JP: '392', KE: '404', KG: '417', KH: '116', KI: '296', KM: '174', KN: '659',
    KP: '408', KR: '410', KW: '414', KY: '136', KZ: '398', LA: '418', LB: '422', LC: '662', LI: '438', LK: '144', LR: '430', LS: '426',
    LT: '440', LU: '442', LV: '428', LY: '434', MA: '504', MC: '492', MD: '498', ME: '499', MF: '663', MG: '450', MH: '584', MK: '807',
    ML: '466', MM: '104', MN: '496', MO: '446', MP: '580', MQ: '474', MR: '478', MS: '500', MT: '470', MU: '480', MV: '462', MW: '454',
    MX: '484', MY: '458', MZ: '508', NA: '516', NC: '540', NE: '562', NF: '574', NG: '566', NI: '558', NL: '528', NO: '578', NP: '524',
    NR: '520', NU: '570', NZ: '554', OM: '512', PA: '591', PE: '604', PF: '258', PG: '598', PH: '608', PK: '586', PL: '616', PM: '666',
    PN: '612', PR: '630', PS: '275', PT: '620', PW: '585', PY: '600', QA: '634', RE: '638', RO: '642', RS: '688', RU: '643', RW: '646',
    SA: '682', SB: '090', SC: '690', SD: '729', SE: '752', SG: '702', SH: '654', SI: '705', SJ: '744', SK: '703', SL: '694', SM: '674',
    SN: '686', SO: '706', SR: '740', SS: '728', ST: '678', SV: '222', SX: '534', SY: '760', SZ: '748', TC: '796', TD: '148', TF: '260',
    TG: '768', TH: '764', TJ: '762', TK: '772', TL: '626', TM: '795', TN: '788', TO: '776', TR: '792', TT: '780', TV: '798', TW: '158',
    TZ: '834', UA: '804', UG: '800', UM: '581', US: '840', UY: '858', UZ: '860', VA: '336', VC: '670', VE: '862', VG: '092', VI: '850',
    VN: '704', VU: '548', WF: '876', WS: '882', YE: '887', YT: '175', ZA: '710', ZM: '894', ZW: '716',
    // Kosovo has no official ISO number; '983' is the stand-in most software uses. world-atlas leaves its id
    // empty, so the map matches Kosovo's shape by name instead (see NO_ID below).
    XK: '983',
  };

  // ✏️ EDIT: the look of the globe
  const LOOK = {
    imagery: (x, y, l) => 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/' + l + '/' + y + '/' + x,
    maxLevel: 15,            // most detailed satellite pictures to load (higher = sharper close-ups, more downloads)
    space: '#000207',        // the background behind the Earth
    atmosphere: '#4f8dff',
    atmosphereAltitude: 0.12,
    // side colors: the fill over the country and its border
    tints: {
      blue: { fill: '#5a9ad2', opacity: 0.62, line: '#a9d4ff' },     // NATO / the United States
      red: { fill: '#d00000', opacity: 0.74, line: '#ff5050' },      // the main enemy country (Russia, China)
      redAlly: { fill: '#6e1414', opacity: 0.78, line: '#c03a3a' },  // its allies (Belarus)
      watch: { fill: '#d8cf3a', opacity: 0.58, line: '#f5ee80' }     // countries caught in the middle (Ukraine)
    }
  };

  // ✏️ EDIT: countries shown in yellow between the sides, when the red side includes this country
  const CAUGHT_BETWEEN = { RU: ['UA'] };
  // ✏️ EDIT: big spaced-out words written across a region (lat, lon)
  const REGION_WORDS = {
    NATO: { lat: 50.2, lon: 6.5 },
    UA: { text: 'Ukraine', lat: 49.0, lon: 31.6 },
    BY: { text: 'Belarus', lat: 53.5, lon: 28.0 }
  };
  // ✏️ EDIT: places colored together with the country they belong to (Greenland is part of the Kingdom of Denmark)
  const TERRITORIES = { DK: ['GL'], US: ['PR'] };
  const WORLD_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

  // A place on the globe → x, y, z in globe.gl's units (alt = height above the ground as a fraction of the Earth's radius)
  function xyz(lat, lon, alt, out) {
    const r = R * (1 + (alt || 0)), la = lat * DEG, lo = lon * DEG, c = Math.cos(la);
    out = out || {};
    out.x = r * c * Math.sin(lo); out.y = r * Math.sin(la); out.z = r * c * Math.cos(lo);
    return out;
  }
  function latLonOf(x, y, z) {
    const r = Math.sqrt(x * x + y * y + z * z) || 1;
    return { lat: Math.asin(y / r) / DEG, lon: Math.atan2(x, z) / DEG, alt: r / R - 1 };
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = k => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // Old flat-map zoom levels (2 = whole world, 8 = one city) → how high above the ground the camera sits
  function altFromZoom(z) { return clamp(0.093 * Math.pow(2, 8 - (+z || 2)), 0.012, 2.4); }

  // A stealth bomber outline with a white dot, used at bomber bases (like the videos)
  const BOMBER_SVG = '<svg viewBox="0 0 40 18" aria-hidden="true"><path d="M20 2 L39 13 L31 16 L26 13 L20 16 L14 13 L9 16 L1 13 Z" fill="#14070a" stroke="#ff2a2a" stroke-width="1.6" stroke-linejoin="round"/><circle cx="20" cy="9.5" r="3.6" fill="#fff"/></svg>';

  function bomberBase(name) {
    const t = (NS.TARGETS || []).find(x => x.name === name);
    if (!t) return false;
    const also = Array.isArray(t.also) ? t.also : (t.also ? [t.also] : []);
    return t.kind === 'bomber-base' || also.indexOf('bomber-base') >= 0;
  }

  function injectCss() {
    if (document.getElementById('gv-css')) return;
    const s = document.createElement('style');
    s.id = 'gv-css';
    s.textContent = [
      '.gv-labels{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2;contain:strict}',
      '.gv-l{position:absolute;left:0;top:0;will-change:transform;white-space:nowrap}',
      '.gv-l[hidden]{display:none}',
      '.gv-dot{position:absolute;left:-4px;top:-4px;width:8px;height:8px;border-radius:50%;background:#fff;box-shadow:0 0 4px rgba(255,255,255,.9),0 0 1px #000}',
      '.gv-l.major .gv-dot{left:-5px;top:-5px;width:10px;height:10px}',
      '.gv-bomber{position:absolute;left:-17px;top:-8px;width:34px;height:16px;display:block}',
      '.gv-bomber svg{width:100%;height:100%;display:block;filter:drop-shadow(0 0 2px rgba(0,0,0,.8))}',
      '.gv-tag{position:absolute;left:10px;top:0;transform:translateY(-50%);font:600 11px/1.15 Jost,"Century Gothic",Futura,"Trebuchet MS",system-ui,sans-serif;color:#f5a31a;background:rgba(0,0,0,.74);padding:2px 5px 2px;letter-spacing:.01em}',
      '.gv-l.major .gv-tag{font-size:16px;padding:2px 7px 3px;left:13px;color:#f7a81b}',
      '.gv-l.bomber .gv-tag{left:22px}',
      '.gv-l.left .gv-tag{left:auto;right:10px}',
      '.gv-l.left.major .gv-tag{right:13px}',
      '.gv-l.bomber.left .gv-tag{right:22px}',
      '.gv-l.notext .gv-tag{display:none}',
      '.gv-region{position:absolute;left:0;top:0;transform-origin:0 0;font:500 26px/1 Jost,"Century Gothic",Futura,system-ui,sans-serif;letter-spacing:.32em;text-transform:uppercase;white-space:nowrap;text-shadow:0 0 6px rgba(0,0,0,.55)}',
      '.gv-region[hidden]{display:none}',
      '.gv-region.blue{color:#a7d8ff;font-size:30px}',
      '.gv-region.watch{color:#6d6512;font-size:13px;letter-spacing:.24em;text-shadow:none}',
      '.gv-region.redAlly{color:#d06060;font-size:12px;letter-spacing:.22em;text-shadow:none}',
      '.gv-marker{position:absolute;left:0;top:0;will-change:transform}',
      '@media (max-width:640px){.gv-tag{font-size:10px}.gv-l.major .gv-tag{font-size:13px}.gv-region.blue{font-size:22px}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  // ------------------------------------------------------------------------------------------------ the view

  function create(el, opts) {
    opts = opts || {};
    const THREE = root.THREE, GlobeCtor = root.Globe;
    if (!THREE || !GlobeCtor) throw new Error('the 3D globe library did not load');
    injectCss();

    const globe = new GlobeCtor(el, {
      rendererConfig: { antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserveDrawingBuffer },
      animateIn: false, waitForGlobeReady: false
    });
    globe.backgroundColor(LOOK.space)
      .showAtmosphere(true).atmosphereColor(LOOK.atmosphere).atmosphereAltitude(LOOK.atmosphereAltitude)
      .showGraticules(false)
      .globeTileEngineUrl(LOOK.imagery).globeTileEngineMaxLevel(LOOK.maxLevel)
      .enablePointerInteraction(false)       // we handle clicks ourselves (faster than hover-testing every shape)
      .polygonsTransitionDuration(0)
      .polygonAltitude(0.0035)
      .polygonCapCurvatureResolution(2.5)
      .polygonSideColor(() => 'rgba(0,0,0,0)')
      .width(el.clientWidth || innerWidth).height(el.clientHeight || innerHeight);
    safe(() => { const m = globe.globeMaterial(); m.color = new THREE.Color('#0b1d3a'); });   // dark ocean blue while pictures load

    const scene = globe.scene(), camera = globe.camera(), controls = globe.controls(), renderer = globe.renderer();
    controls.minDistance = R * 1.004;
    controls.maxDistance = R * 5.2;
    controls.zoomSpeed = 1.1;
    camera.near = 0.05;
    camera.updateProjectionMatrix();

    // the label layer (plain HTML on top of the 3D canvas)
    const labelsEl = document.createElement('div');
    labelsEl.className = 'gv-labels';
    el.appendChild(labelsEl);

    const view = {
      globe, THREE, scene, camera, controls, renderer, R, EARTH_KM, xyz, latLonOf, altFromZoom,
      ready: null, autoCamera: true
    };

    // ---------------------------------------------------------------- size
    function resize() {
      const w = el.clientWidth || innerWidth, h = el.clientHeight || innerHeight;
      globe.width(w).height(h);
      dirty = true;
    }
    addEventListener('resize', resize);
    if (root.ResizeObserver) new root.ResizeObserver(resize).observe(el);

    // ---------------------------------------------------------------- countries
    let features = null, sides = null;
    view.ready = (async () => {
      try {
        const res = await fetch(WORLD_URL);
        const topo = await res.json();
        features = root.topojson.feature(topo, topo.objects.countries).features.filter(f => f.id !== NS.ISO_NUMERIC.AQ);
        if (sides) applySides();
      } catch (e) { console.warn('[Nuke Sim] country shapes failed to load', e); }
    })();

    const tintMats = {};
    function tintMaterial(key) {
      if (tintMats[key]) return tintMats[key];
      const t = LOOK.tints[key];
      return (tintMats[key] = new THREE.MeshBasicMaterial({ color: t.fill, transparent: true, opacity: t.opacity, depthWrite: false, side: THREE.DoubleSide }));
    }
    function idsFor(list) {
      const ids = new Set();
      (list || []).forEach(cc => [cc].concat(TERRITORIES[cc] || []).forEach(c => { if (NS.ISO_NUMERIC[c]) ids.add(NS.ISO_NUMERIC[c]); }));
      return ids;
    }
    function applySides() {
      const tintOf = {};
      if (sides && sides.blue) idsFor(sides.blue.countries).forEach(id => { tintOf[id] = 'blue'; });
      if (sides && sides.red) {
        const reds = (sides.red.countries || []).slice();
        idsFor(reds.slice(0, 1)).forEach(id => { tintOf[id] = 'red'; });
        idsFor(reds.slice(1)).forEach(id => { tintOf[id] = 'redAlly'; });
        const between = [].concat.apply([], reds.map(cc => CAUGHT_BETWEEN[cc] || []));
        idsFor(between).forEach(id => { if (!tintOf[id]) tintOf[id] = 'watch'; });
      }
      const list = (features || []).filter(f => tintOf[f.id]).map(f => ({ geometry: f.geometry, tint: tintOf[f.id] }));
      globe.polygonsData(list)
        .polygonCapMaterial(d => tintMaterial(d.tint))
        .polygonStrokeColor(d => LOOK.tints[d.tint].line);
      setRegionWords(tintOf);
      dirty = true;
    }
    view.setSides = function (s) { sides = s || null; applySides(); };

    // ---------------------------------------------------------------- labels
    let labels = [], regions = [], markers = [], dirty = true;
    const tmpV = new THREE.Vector3();
    const camLast = new Float32Array(16);

    function setRegionWords(tintOf) {
      regions.forEach(r => r.el.remove());
      regions = [];
      if (!sides) return;
      const add = (text, lat, lon, cls) => {
        const e = document.createElement('div');
        e.className = 'gv-region ' + cls;
        e.textContent = text;
        labelsEl.appendChild(e);
        regions.push({ el: e, lat, lon, p: xyz(lat, lon, 0.004), w: 0, h: 0 });
      };
      // the blue side's name across Europe when it includes European countries
      const blue = sides.blue && sides.blue.countries || [];
      if (sides.blue && blue.some(cc => ['DE', 'FR', 'GB', 'PL', 'IT'].indexOf(cc) >= 0)) add(sides.blue.name || 'NATO', REGION_WORDS.NATO.lat, REGION_WORDS.NATO.lon, 'blue');
      Object.keys(REGION_WORDS).forEach(cc => {
        if (cc === 'NATO') return;
        const id = NS.ISO_NUMERIC[cc], k = id && tintOf[id];
        if (k === 'watch' || k === 'redAlly') add(REGION_WORDS[cc].text, REGION_WORDS[cc].lat, REGION_WORDS[cc].lon, k);
      });
      regions.forEach(r => { r.w = r.el.offsetWidth; r.h = r.el.offsetHeight; });
    }

    view.setLabels = function (list) {
      labels.forEach(l => l.el.remove());
      labels = (list || []).filter(l => l && isFinite(l.lat) && isFinite(l.lon) && l.text).map((l, i) => {
        const e = document.createElement('div');
        const bomber = bomberBase(l.text);
        e.className = 'gv-l' + (l.major ? ' major' : '') + (bomber ? ' bomber' : '');
        e.innerHTML = (bomber ? '<i class="gv-bomber">' + BOMBER_SVG + '</i>' : '<i class="gv-dot"></i>') + '<b class="gv-tag">' + esc(l.text) + '</b>';
        e.hidden = true;
        labelsEl.appendChild(e);
        return { el: e, tag: e.lastChild, lat: l.lat, lon: l.lon, text: l.text, major: !!l.major, bomber, order: i, p: xyz(l.lat, l.lon, 0.004), w: 0, h: 0, x: -1e4, y: -1e4, state: '' };
      });
      // measure every tag once (one layout pass), then sort by priority: big labels first, then in the given order
      labels.forEach(l => { l.el.hidden = false; });
      labels.forEach(l => { l.w = l.tag.offsetWidth; l.h = l.tag.offsetHeight; });
      labels.forEach(l => { l.el.hidden = true; });
      labels.sort((a, b) => (b.major - a.major) || (a.order - b.order));
      dirty = true;
    };

    // Is a point on the globe facing the camera (not around the back)?
    function facing(p, cam) { return p.x * cam.x + p.y * cam.y + p.z * cam.z > R * R * 1.0005; }
    // Screen position of a point (in CSS pixels), or null when it is behind the camera
    function toScreen(p) {
      tmpV.set(p.x, p.y, p.z).project(camera);
      if (tmpV.z > 1) return null;
      return { x: (tmpV.x + 1) / 2 * W, y: (1 - tmpV.y) / 2 * H };
    }
    let W = 1, H = 1;

    function layoutLabels() {
      W = el.clientWidth || innerWidth; H = el.clientHeight || innerHeight;
      const cam = camera.position;
      const boxes = [];
      const hit = (x0, y0, x1, y1) => {
        for (let i = 0; i < boxes.length; i++) { const b = boxes[i]; if (x0 < b[2] && x1 > b[0] && y0 < b[3] && y1 > b[1]) return true; }
        return false;
      };
      // region words first (they never hide), then labels; dots always take a little room
      regions.forEach(r => {
        const s = facing(r.p, cam) && toScreen(r.p);
        if (!s) { r.el.hidden = true; return; }
        r.el.hidden = false;
        r.el.style.transform = 'translate(' + (s.x - r.w / 2).toFixed(1) + 'px,' + (s.y - r.h / 2).toFixed(1) + 'px)';
      });
      const alt = cam.length() / R - 1;
      for (const l of labels) {
        const s = facing(l.p, cam) && toScreen(l.p);
        if (!s || s.x < -40 || s.y < -20 || s.x > W + 40 || s.y > H + 20) { if (!l.el.hidden) l.el.hidden = true; continue; }
        // from far away only the big labels get their names; the rest show as dots until you zoom in
        const dotR = l.bomber ? 12 : 6;
        let state = 'notext';
        const wantText = l.major || alt < 1.35;
        if (wantText) {
          const off = (l.bomber ? 22 : l.major ? 13 : 10), hh = l.h / 2 + 1;
          if (!hit(s.x + off - 2, s.y - hh, s.x + off + l.w + 2, s.y + hh)) { state = ''; boxes.push([s.x + off - 2, s.y - hh, s.x + off + l.w + 2, s.y + hh]); }
          else if (!hit(s.x - off - l.w - 2, s.y - hh, s.x - off + 2, s.y + hh)) { state = 'left'; boxes.push([s.x - off - l.w - 2, s.y - hh, s.x - off + 2, s.y + hh]); }
        }
        boxes.push([s.x - dotR, s.y - dotR, s.x + dotR, s.y + dotR]);
        if (state !== l.state) { l.el.classList.toggle('left', state === 'left'); l.el.classList.toggle('notext', state === 'notext'); l.state = state; }
        if (l.el.hidden) l.el.hidden = false;
        if (Math.abs(s.x - l.x) > 0.3 || Math.abs(s.y - l.y) > 0.3) { l.x = s.x; l.y = s.y; l.el.style.transform = 'translate(' + s.x.toFixed(1) + 'px,' + s.y.toFixed(1) + 'px)'; }
      }
      for (const m of markers) {
        const s = facing(m.p, cam) && toScreen(m.p);
        m.el.style.display = s ? '' : 'none';
        if (s) m.el.style.transform = 'translate(' + s.x.toFixed(1) + 'px,' + s.y.toFixed(1) + 'px)';
      }
    }

    // HTML markers pinned to a place (Build your own mode uses these for the target marks)
    view.addMarker = function (lat, lon, node) {
      const wrap = document.createElement('div');
      wrap.className = 'gv-marker';
      wrap.appendChild(node);
      labelsEl.appendChild(wrap);
      const m = { el: wrap, p: xyz(lat, lon, 0.002) };
      markers.push(m);
      dirty = true;
      return { remove() { wrap.remove(); markers = markers.filter(x => x !== m); }, el: wrap };
    };

    // ---------------------------------------------------------------- rings on the ground (Build your own)
    // rings: [{ km, color, fill (0..1 opacity of the inside), width }] → drawn as circles that hug the globe
    view.addRings = function (lat, lon, rings) {
      const group = new THREE.Group();
      const c = xyz(lat, lon, 0), n = new THREE.Vector3(c.x, c.y, c.z).normalize();
      // two directions along the ground at that place
      const east = new THREE.Vector3(Math.cos(lon * DEG), 0, -Math.sin(lon * DEG)).normalize();
      const north = new THREE.Vector3().crossVectors(n, east).normalize();
      const sorted = rings.slice().sort((a, b) => b.km - a.km);
      sorted.forEach((ring, idx) => {
        const ang = ring.km / EARTH_KM, SEG = 96, pts = [];
        const alt = 0.0045 + idx * 0.00004;
        for (let i = 0; i <= SEG; i++) {
          const a = i / SEG * Math.PI * 2;
          const dir = new THREE.Vector3().copy(east).multiplyScalar(Math.cos(a)).addScaledVector(north, Math.sin(a));
          const v = new THREE.Vector3().copy(n).multiplyScalar(Math.cos(ang)).addScaledVector(dir, Math.sin(ang)).multiplyScalar(R * (1 + alt));
          pts.push(v);
        }
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: ring.color, transparent: true, opacity: 0.95, depthWrite: false }));
        line.renderOrder = 30;
        group.add(line);
        if (ring.fill > 0) {
          const centre = new THREE.Vector3().copy(n).multiplyScalar(R * (1 + alt));
          const verts = [centre.x, centre.y, centre.z];
          pts.forEach(v => verts.push(v.x, v.y, v.z));
          const idxs = [];
          for (let i = 1; i <= SEG; i++) idxs.push(0, i, i + 1);
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
          g.setIndex(idxs);
          const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: ring.color, transparent: true, opacity: ring.fill, depthWrite: false, side: THREE.DoubleSide }));
          mesh.renderOrder = 29;
          group.add(mesh);
        }
      });
      scene.add(group);
      return {
        remove() {
          scene.remove(group);
          group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        },
        setOpacity(k) { group.traverse(o => { if (o.material) { if (o.material._base == null) o.material._base = o.material.opacity; o.material.opacity = o.material._base * k; } }); }
      };
    };

    // ---------------------------------------------------------------- camera: flights and tilt
    // A view: { lat, lon } the place in the middle of the screen, alt the camera height (in Earth radii),
    // tilt how far the camera leans toward the horizon (0 = looking straight down, 60 = very low and dramatic)
    let fly = null, tilt = 0;
    function camPlace(v) {
      const d = 1 + v.alt, tau = clamp(v.tilt || 0, 0, 70) * DEG;
      const s = Math.min(0.97, d * Math.sin(tau));
      const phi = Math.asin(s) - Math.asin(s / d);   // how far the camera sits back from the place it looks at
      return { lat: clamp(v.lat - phi / DEG, -86, 86), lon: v.lon, alt: v.alt, tilt: Math.asin(s / d) / DEG };
    }
    function setCam(lat, lon, alt) {
      const p = xyz(lat, lon, alt);
      camera.position.set(p.x, p.y, p.z);
    }
    view.getView = function () {
      const p = latLonOf(camera.position.x, camera.position.y, camera.position.z);
      return { lat: p.lat, lon: p.lon, alt: p.alt, tilt };
    };
    view.flyTo = function (v, ms) {
      if (!v || !isFinite(v.lat) || !isFinite(v.lon)) return;
      const to = camPlace({ lat: v.lat, lon: v.lon, alt: clamp(isFinite(v.alt) ? v.alt : 1.5, 0.004, 5), tilt: v.tilt || 0 });
      const from = view.getView();
      if (!(ms > 0)) { fly = null; tilt = to.tilt; setCam(to.lat, to.lon, to.alt); dirty = true; return; }
      // a smooth flight along the shortest way round, rising a little in the middle for long trips
      let dLon = ((to.lon - from.lon + 540) % 360) - 180;
      const dist = Math.acos(clamp(Math.sin(from.lat * DEG) * Math.sin(to.lat * DEG) + Math.cos(from.lat * DEG) * Math.cos(to.lat * DEG) * Math.cos(dLon * DEG), -1, 1)) / DEG;
      fly = { from, to, dLon, t0: performance.now(), ms, bump: clamp(dist / 90, 0, 1.2) * Math.max(0.3, Math.max(from.alt, to.alt)) };
    };
    view.isFlying = () => !!fly;
    view.altForRadius = function (km) {
      const half = Math.tan((camera.fov || 50) * DEG / 2);
      return clamp((km / EARTH_KM) / (half * 0.62), 0.006, 3);
    };

    // When you drag or zoom, the automatic camera lets go and the camera straightens up
    const userCbs = [];
    view.onUserMove = cb => { userCbs.push(cb); };
    let tiltRelease = null;
    controls.addEventListener('start', () => {
      if (fly) fly = null;
      if (tilt > 0.5) tiltRelease = { from: tilt, t0: performance.now() };
      userCbs.forEach(cb => safe(() => cb()));
    });

    // ---------------------------------------------------------------- clicks on the globe
    const clickCbs = [];
    view.onClick = cb => { clickCbs.push(cb); return () => { const i = clickCbs.indexOf(cb); if (i >= 0) clickCbs.splice(i, 1); }; };
    let down = null;
    el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    el.addEventListener('pointerup', e => {
      if (!down || !clickCbs.length) { down = null; return; }
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), quick = performance.now() - down.t < 800;
      down = null;
      if (moved > 6 || !quick) return;
      const r = el.getBoundingClientRect();
      const c = view.pick(e.clientX - r.left, e.clientY - r.top);
      if (c) clickCbs.forEach(cb => safe(() => cb(c, e)));
    });
    // Screen point → place on the globe (or null for space)
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), sphere = new THREE.Sphere(new THREE.Vector3(), R), hitP = new THREE.Vector3();
    view.pick = function (x, y) {
      const w = el.clientWidth || innerWidth, h = el.clientHeight || innerHeight;
      ndc.set(x / w * 2 - 1, -(y / h) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      if (!ray.ray.intersectSphere(sphere, hitP)) return null;
      const p = latLonOf(hitP.x, hitP.y, hitP.z);
      return { lat: p.lat, lon: p.lon };
    };
    view.project = function (lat, lon, alt) {
      W = el.clientWidth || innerWidth; H = el.clientHeight || innerHeight;
      const p = xyz(lat, lon, alt || 0);
      const s = facing(p, camera.position) && toScreen(p);
      return s ? { x: s.x, y: s.y, visible: s.x >= 0 && s.y >= 0 && s.x <= W && s.y <= H } : null;
    };
    // How many km one screen pixel covers in the middle of the screen
    view.kmPerPixel = function () {
      const alt = camera.position.length() / R - 1;
      const h = el.clientHeight || innerHeight;
      return 2 * alt * EARTH_KM * Math.tan((camera.fov || 50) * DEG / 2) / h;
    };

    // ---------------------------------------------------------------- every frame, just before drawing
    const frameCbs = [];
    view.onFrame = cb => { frameCbs.push(cb); };
    scene.onBeforeRender = function () {
      const now = performance.now();
      if (fly) {
        const k = Math.min(1, (now - fly.t0) / fly.ms), e = ease(k);
        const lat = fly.from.lat + (fly.to.lat - fly.from.lat) * e;
        const lon = fly.from.lon + fly.dLon * e;
        const alt = fly.from.alt + (fly.to.alt - fly.from.alt) * e + fly.bump * Math.sin(Math.PI * e);
        tilt = fly.from.tilt + (fly.to.tilt - fly.from.tilt) * e;
        setCam(lat, lon, alt);
        if (k >= 1) fly = null;
      } else if (tiltRelease) {
        const k = Math.min(1, (now - tiltRelease.t0) / 450);
        tilt = tiltRelease.from * (1 - ease(k));
        if (k >= 1) { tilt = 0; tiltRelease = null; }
      }
      camera.up.set(0, 1, 0);
      camera.lookAt(0, 0, 0);
      if (tilt > 0.01) camera.rotateX(tilt * DEG);
      camera.updateMatrixWorld();
      for (let i = 0; i < frameCbs.length; i++) safe(() => frameCbs[i](camera));
      // move the HTML labels only when the camera moved
      const m = camera.projectionMatrix.elements, mw = camera.matrixWorld.elements;
      let changed = dirty;
      for (let i = 0; i < 16 && !changed; i++) if (Math.abs(camLast[i] - (m[i] + mw[i] * 3.1)) > 1e-6) changed = true;
      if (changed) { for (let i = 0; i < 16; i++) camLast[i] = m[i] + mw[i] * 3.1; dirty = false; layoutLabels(); }
    };

    // start looking at Europe from far away
    view.flyTo({ lat: 45, lon: 15, alt: 2.2 }, 0);
    return view;
  }

  function safe(fn) { try { return fn(); } catch (e) { console.warn('[Nuke Sim] globe:', e); } }

  NS.GlobeView = { create, xyz, latLonOf, altFromZoom, LOOK, R, EARTH_KM };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof window !== 'undefined' ? window : globalThis);
