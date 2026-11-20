// Nuke Sim: the map underneath everything. Dark satellite photos of the Earth, thin country borders,
// the two sides of the war tinted (NATO blue, Russia red, China amber) with glowing outlines, and the
// bold yellow labels on key targets ("Minot AFB", "The Pentagon", "Moscow"…).
//
//   const ml = NS.MapLayers.init(map);   // call once, right after making the Leaflet map
//   ml.ready.then(ok => …);              // country shapes are drawn (ok = false if they couldn't load)
//   ml.setSides(scenario.sides);         // tint the countries of each side
//   ml.setLabels(scenario.labels);       // [{ lat, lon, text, major }]
//
// If the country shapes can't be downloaded (offline, blocked) the photos and labels still work.
(function (root) {
  'use strict';
  const NS = root.NS = root.NS || {};

  // Every country's two-letter code (ISO 3166-1 alpha-2) → its three-digit number (ISO 3166-1 numeric).
  // world-atlas names its country shapes by these numbers, always as 3-character strings ("008", "840").
  NS.ISO_NUMERIC = {
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

  // ✏️ EDIT: how the map looks
  const LOOK = {
    imagery: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    imageryFilter: 'brightness(.5) saturate(.55) contrast(1.15) hue-rotate(-8deg)',  // darker, a bit washed-out and cold
    imageryMaxZoom: 8,        // sharper photos are never downloaded (they'd only be zoomed up from here)
    shapes: 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json',
    shapesTimeout: 20000,     // ms to wait for the country shapes before giving up
    vignette: true,           // darker corners, like a camera
    borders: { color: '#dbe7ff', weight: 0.8, opacity: 0.34 },   // land borders between countries
    coasts:  { color: '#dbe7ff', weight: 0.6, opacity: 0.14 },   // coastlines (faint: the photos already show them)
    fillOpacity: 0.28,        // how strongly the countries of each side are tinted
    dimOthers: 0.2,           // how much darker the countries outside the war get once sides are set (0 = not at all)
    labelMinZoom: 4,          // labels that aren't "major" only appear from this zoom level
    labelFont: '"Segoe UI", Roboto, "Helvetica Neue", Arial, system-ui, sans-serif',
  };

  // ✏️ EDIT: tint colors for sides that don't bring their own color
  const SIDE_COLORS = { blue: '#3b82f6', red: '#ef4444', china: '#f59e0b', yellow: '#f59e0b' };

  // ✏️ EDIT: places tinted together with the country they belong to (Greenland is part of the Kingdom of Denmark)
  const TERRITORIES = { DK: ['GL'], US: ['PR'] };

  // Shapes world-atlas gives no id: matched by name (N. Cyprus and Somaliland have no code, so they're never tinted)
  const NO_ID = { Kosovo: NS.ISO_NUMERIC.XK };
  const ANTARCTICA = NS.ISO_NUMERIC.AQ;

  // Our map layers, bottom to top. Leaflet's own panes: tiles 200, vectors 400, markers 600, tooltips 650, popups 700.
  // The missile/explosion renderer sits at ~450, so it draws above the tints and below the labels.
  const PANES = [
    ['nsImagery', 200],    // satellite photos (darkened with a CSS filter)
    ['nsShade', 300],      // the vignette
    ['nsCountries', 350],  // borders, side tints and their glow (one canvas)
    ['nsLabels', 620],     // target labels
  ];

  // ---------- small helpers ----------

  // Blend two #rrggbb colors (t = 0 → a, t = 1 → b)
  function mix(a, b, t) {
    const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const A = p(a), B = p(b);
    if (A.some(isNaN) || B.some(isNaN)) return a;
    return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }
  const hex = c => /^#[0-9a-f]{6}$/i.test(c || '') ? c : null;

  // Lines from world-atlas jump straight from 180° to -180° where they cross the date line. Cut them there:
  // both halves end at the same meridian, and the next copy of the world joins them up again.
  // Bits south of 85°S are cut too (the map can't show them; they'd smear along its bottom edge).
  function cutLines(lines) {
    const out = [];
    lines.forEach(line => {
      let cur = [];
      line.forEach((p, i) => {
        const q = line[i - 1];
        if (q && (Math.abs(p[0] - q[0]) > 180 || (p[1] < -85 && q[1] < -85))) { if (cur.length > 1) out.push(cur); cur = []; }
        cur.push(p);
      });
      if (cur.length > 1) out.push(cur);
    });
    return out;
  }

  // Make a ring's longitudes continuous, so Russia's far east runs on to 190° instead of jumping to -170°
  function unwrapRing(ring) {
    const out = [];
    let shift = 0;
    ring.forEach((p, i) => {
      let x = p[0] + shift;
      if (i) {
        const d = x - out[i - 1][0];
        if (d > 180) { shift -= 360; x -= 360; } else if (d < -180) { shift += 360; x += 360; }
      }
      out.push([x, p[1]]);
    });
    return out;
  }

  // A GeoJSON Polygon/MultiPolygon → list of polygons (lists of [lon, lat] rings), date-line safe
  function polygonsOf(geometry) {
    if (!geometry) return [];
    const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
    return polys.map(poly => {
      const rings = poly.map(unwrapRing);
      const outer = rings[0];
      // move the piece so its middle sits between -180° and 180° (holes move with it)
      const mid = outer.reduce((s, p) => s + p[0], 0) / outer.length;
      const dx = -360 * Math.round(mid / 360);
      return rings.map(r => (dx ? r.map(p => [p[0] + dx, p[1]]) : r));
    });
  }

  // [lon, lat] → Leaflet [lat, lng], once for every copy of the world (offsets in degrees: 0, 360, -360…)
  const copyLines = (lines, offsets) => {
    const out = [];
    offsets.forEach(dx => lines.forEach(l => out.push(l.map(p => [p[1], p[0] + dx]))));
    return out;
  };
  const copyPolys = (polys, offsets) => {
    const out = [];
    offsets.forEach(dx => polys.forEach(poly => out.push(poly.map(r => r.map(p => [p[1], p[0] + dx])))));
    return out;
  };

  // ---------- styles (added to the page once, so index.html doesn't need them) ----------

  function addStyles() {
    if (typeof document === 'undefined' || document.getElementById('ns-maplayer-css')) return;
    const f = LOOK.labelFont;
    const css = `
.ns-map { background: #03060b; }
.ns-vignette { position: absolute; left: 0; top: 0; pointer-events: none;
  background: radial-gradient(ellipse 75% 70% at 50% 50%, rgba(0, 0, 0, 0) 55%, rgba(0, 3, 10, .38) 85%, rgba(0, 3, 10, .62) 100%); }
.leaflet-marker-icon.ns-lbl, .ns-lbl * { pointer-events: none !important; }
.leaflet-marker-icon.ns-lbl { width: 0 !important; height: 0 !important; margin: 0 !important; background: none; border: 0; overflow: visible; }
.ns-lbl-dot { position: absolute; left: -3px; top: -3px; width: 6px; height: 6px; border-radius: 50%; background: #fff;
  box-shadow: 0 0 0 1.5px rgba(0, 0, 0, .85), 0 0 6px 1px rgba(255, 255, 255, .55); }
.ns-lbl-minor .ns-lbl-dot { left: -2.5px; top: -2.5px; width: 5px; height: 5px; }
.ns-lbl-txt { position: absolute; left: 7px; top: 0; transform: translateY(-50%); white-space: nowrap;
  font: 700 13px/1 ${f}; letter-spacing: .15px; color: #ffcc33;
  text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 -1px 0 #000, 0 1px 0 #000, -1px 0 0 #000, 1px 0 0 #000,
    0 0 4px rgba(0, 0, 0, .95), 0 0 8px rgba(0, 0, 0, .6); }
.ns-lbl-minor .ns-lbl-txt { font-size: 11px; color: #ffe08a; left: 6px; }
.ns-lbl-l .ns-lbl-txt { left: auto; right: 7px; }
.ns-lbl-minor.ns-lbl-l .ns-lbl-txt { right: 6px; }
.ns-lbl-u .ns-lbl-txt { top: 1px; transform: translateY(-100%); }
.ns-lbl-d .ns-lbl-txt { top: -1px; transform: none; }
.ns-lbl-notext .ns-lbl-txt, .ns-lbl-off { display: none !important; }
.leaflet-nsLabels-pane:not(.ns-lbl-zoomed) .ns-lbl-minor { display: none; }
`;
    const tag = document.createElement('style');
    tag.id = 'ns-maplayer-css';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  // ---------- the map layers ----------

  function init(map) {
    const L = root.L;
    addStyles();
    map.getContainer().classList.add('ns-map');

    PANES.forEach(([name, z]) => {
      const pane = map.getPane(name) || map.createPane(name);
      pane.style.zIndex = z;
      pane.style.pointerEvents = 'none';   // nothing here catches clicks: they go through to the map
    });

    // Satellite photos, darkened
    map.getPane('nsImagery').style.filter = LOOK.imageryFilter;
    L.tileLayer(LOOK.imagery, {
      pane: 'nsImagery', maxNativeZoom: LOOK.imageryMaxZoom, maxZoom: 22, attribution: 'Imagery © Esri',
    }).addTo(map);

    // Vignette: a box that always covers exactly the visible map (moved back whenever the map pans)
    if (LOOK.vignette) {
      const shade = L.DomUtil.create('div', 'ns-vignette', map.getPane('nsShade'));
      const placeShade = () => {
        const s = map.getSize();
        L.DomUtil.setPosition(shade, map.containerPointToLayerPoint([0, 0]));
        shade.style.width = s.x + 'px';
        shade.style.height = s.y + 'px';
      };
      map.on('move zoom viewreset resize zoomend moveend', placeShade);
      placeShade();
    }

    // ----- countries -----
    // A canvas that can also draw a glow under a line: lines with a `glow` option ([[width, opacity, color], …])
    // are stroked wide and faint first, then normally on top. (Leaflet 1.9's canvas drawing step; if a
    // different Leaflet version lacks it, lines are simply drawn without the glow.)
    const GlowCanvas = L.Canvas.extend({
      _fillStroke(ctx, layer) {
        const glow = layer.options.glow;
        if (glow && layer.options.stroke) {
          ctx.save();
          ctx.lineCap = ctx.lineJoin = 'round';
          glow.forEach(([w, a, c]) => { ctx.globalAlpha = a; ctx.lineWidth = w; ctx.strokeStyle = c; ctx.stroke(); });
          ctx.restore();
        }
        L.Canvas.prototype._fillStroke.call(this, ctx, layer);
      },
    });
    const renderer = new GlowCanvas({ pane: 'nsCountries', padding: 0.3 });
    const vec = { pane: 'nsCountries', renderer, interactive: false, bubblingMouseEvents: true };
    const sideLayer = L.layerGroup().addTo(map);
    let shapes = null;   // { topo, geoms, polys: Map(id → polygons) } once loaded
    let sides = null;

    // Borders and tints are drawn once for each copy of the world in view (two or three side by side when
    // zoomed out), so they carry on when you scroll past the date line. Checked again whenever the view moves.
    let copied = [];     // { layer, src, poly, group }
    let offsets = [0];
    function viewOffsets() {
      let b;
      try { b = map.getBounds(); } catch (e) { return [0]; }   // map has no view yet
      const w = b.getWest(), e = b.getEast(), m = Math.max(20, (e - w) * 0.4), out = [];
      // a copy at dx covers dx-180° … dx+190° (Russia's far east runs on past 180°)
      for (let k = Math.max(-3, Math.ceil((w - m - 190) / 360)); k <= Math.min(3, Math.floor((e + m + 180) / 360)); k++) out.push(k * 360);
      return out.length ? out : [0];
    }
    const latLngsOf = c => (c.poly ? copyPolys : copyLines)(c.src, offsets);
    function addCopied(src, poly, style, group) {
      const c = { src, poly, group };
      c.layer = (poly ? L.polygon : L.polyline)(latLngsOf(c), Object.assign({}, vec, style)).addTo(group);
      copied.push(c);
      return c.layer;
    }
    function updateCopies() {
      const next = viewOffsets();
      if (next.join() === offsets.join()) return;
      offsets = next;
      copied.forEach(c => c.layer.setLatLngs(latLngsOf(c)));
    }
    offsets = viewOffsets();
    map.on('moveend zoomend viewreset resize', updateCopies);

    async function loadShapes() {
      const tj = root.topojson;
      if (!tj || !tj.feature || !tj.mesh) throw new Error('topojson-client is missing');
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = setTimeout(() => ctrl && ctrl.abort(), LOOK.shapesTimeout);
      let topo;
      try {
        const res = await fetch(LOOK.shapes, ctrl ? { signal: ctrl.signal } : undefined);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        topo = await res.json();
      } finally { clearTimeout(timer); }
      const obj = topo && topo.objects && topo.objects.countries;
      if (!obj || !obj.geometries) throw new Error('unexpected country file');
      obj.geometries.forEach(g => {
        if (g.id == null && g.properties && NO_ID[g.properties.name]) g.id = NO_ID[g.properties.name];
        if (g.id != null) g.id = String(g.id).padStart(3, '0');
      });
      const polys = new Map();
      obj.geometries.forEach(g => {
        if (g.id != null && g.id !== ANTARCTICA) polys.set(g.id, polygonsOf(tj.feature(topo, g).geometry));
      });
      shapes = { topo, obj, geoms: obj.geometries, polys };

      // every border once (shared borders aren't drawn twice), coasts fainter than land borders
      const mesh = filter => cutLines(tj.mesh(topo, obj, filter).coordinates);
      offsets = viewOffsets();
      addCopied(mesh((a, b) => a === b), false, Object.assign({ smoothFactor: 1.2 }, LOOK.coasts), map);
      addCopied(mesh((a, b) => a !== b), false, Object.assign({ smoothFactor: 1.2, attribution: 'Borders © Natural Earth' }, LOOK.borders), map);
      drawSides();
    }

    // Tint each side: translucent fill, glowing outline around the whole side, its inner borders a little brighter.
    // Countries outside every side get slightly darker.
    function drawSides() {
      sideLayer.clearLayers();
      copied = copied.filter(c => c.group !== sideLayer);
      if (!shapes || !sides) return;
      const tj = root.topojson;
      const taken = new Set();
      const backs = [];   // fills, drawn underneath the border lines
      Object.keys(sides).forEach(key => {
        const side = sides[key];
        if (!side || !Array.isArray(side.countries)) return;
        const color = hex(side.color) || SIDE_COLORS[key] || SIDE_COLORS.china;
        const ids = new Set();
        side.countries.forEach(cc => {
          cc = String(cc).toUpperCase();
          [cc].concat(TERRITORIES[cc] || []).forEach(c => { if (NS.ISO_NUMERIC[c]) ids.add(NS.ISO_NUMERIC[c]); });
        });
        const geoms = shapes.geoms.filter(g => ids.has(g.id) && !taken.has(g.id) && shapes.polys.has(g.id));
        if (!geoms.length) return;
        geoms.forEach(g => taken.add(g.id));

        const polys = [].concat(...geoms.map(g => shapes.polys.get(g.id)));
        backs.push(addCopied(polys, true, { stroke: false, fillColor: color, fillOpacity: LOOK.fillOpacity }, sideLayer));

        const group = { type: 'GeometryCollection', geometries: geoms };
        const outline = cutLines(tj.mesh(shapes.topo, group, (a, b) => a === b).coordinates);
        const inner = cutLines(tj.mesh(shapes.topo, group, (a, b) => a !== b).coordinates);
        const bright = mix(color, '#ffffff', 0.45);
        if (inner.length) addCopied(inner, false, { color: bright, weight: 0.9, opacity: 0.45 }, sideLayer);
        // the outline glows: a wide faint line, a narrower stronger one, then a crisp bright edge
        addCopied(outline, false, { color: bright, weight: 1.4, opacity: 0.95, glow: [[11, 0.09, color], [5, 0.22, color]] }, sideLayer);
      });
      if (LOOK.dimOthers > 0 && taken.size) {
        const rest = [];
        shapes.polys.forEach((p, id) => { if (!taken.has(id)) rest.push(...p); });
        backs.push(addCopied(rest, true, { stroke: false, fillColor: '#000308', fillOpacity: LOOK.dimOthers }, sideLayer));
      }
      backs.forEach(l => l.bringToBack());
    }

    function setSides(s) {
      sides = s && typeof s === 'object' ? s : null;
      drawSides();
    }

    const ready = new Promise(resolve => {
      loadShapes().then(() => resolve(true), err => {
        if (root.console) console.warn('Nuke Sim: country shapes could not be loaded, the map works without them.', err && err.message);
        resolve(false);
      });
    });

    // ----- labels -----
    const labelPane = map.getPane('nsLabels');
    const labelGroup = L.layerGroup().addTo(map);
    let labels = [];
    const measure = (() => {
      let ctx = null;
      try { ctx = document.createElement('canvas').getContext('2d'); } catch (e) { /* no canvas: estimate */ }
      return (text, px) => {
        if (!ctx) return text.length * px * 0.58;
        ctx.font = `700 ${px}px ${LOOK.labelFont}`;
        return ctx.measureText(text).width + text.length * 0.15 + 1;   // + the letter spacing
      };
    })();

    // labels = [{ lat, lon, text, major, priority? }]. When labels crowd each other, major ones win, then the
    // higher priority (optional number), then whichever comes first in the list.
    function setLabels(list) {
      labelGroup.clearLayers();
      labels = [];
      const items = (Array.isArray(list) ? list : [])
        .map((d, i) => ({ d, i }))
        .filter(({ d }) => d && d.text != null && d.text !== '' && isFinite(d.lat) && isFinite(d.lon))
        .sort((a, b) => (!!b.d.major - !!a.d.major) || ((+b.d.priority || 0) - (+a.d.priority || 0)) || a.i - b.i);
      items.forEach(({ d }) => {
        const major = !!d.major, text = String(d.text), lat = +d.lat, lon = +d.lon;
        // the same name twice in the same place (a target and a city, say): show it once
        const key = text.trim().toLowerCase();
        if (labels.some(o => o.key === key && Math.abs(o.lat - lat) < 0.6 && Math.abs(o.lon - lon) < 0.9)) return;
        const el = document.createElement('div');
        el.innerHTML = '<span class="ns-lbl-dot"></span><span class="ns-lbl-txt"></span>';
        el.lastChild.textContent = text;
        const marker = L.marker([lat, lon], {
          pane: 'nsLabels', interactive: false, keyboard: false, zIndexOffset: major ? 1000 : 0,
          icon: L.divIcon({ className: 'ns-lbl ' + (major ? 'ns-lbl-major' : 'ns-lbl-minor'), html: el, iconSize: null }),
        }).addTo(labelGroup);
        labels.push({ key, lat, lon, at: lon, major, marker, w: measure(text, major ? 13 : 11), px: major ? 13 : 11 });
      });
      layoutLabels();
    }

    // Where the words can go around the dot, in order of preference: right, left, then above/below on either side
    const SPOTS = ['r', 'l', 'ru', 'rd', 'lu', 'ld'];
    function textBox(p, lb, spot) {
      const gap = lb.major ? 7 : 6, h = lb.px;
      const x0 = spot[0] === 'r' ? p.x + gap : p.x - gap - lb.w;
      const y0 = spot[1] === 'u' ? p.y - h + 1 : spot[1] === 'd' ? p.y - 1 : p.y - h / 2;
      return { x0, x1: x0 + lb.w, y0, y1: y0 + h };
    }
    const dotBox = p => ({ x0: p.x - 4, x1: p.x + 4, y0: p.y - 4, y1: p.y + 4 });

    // Show/hide labels for the current view: small labels only when zoomed in, and no words on top of other words or dots.
    function layoutLabels() {
      const zoomed = map.getZoom() >= LOOK.labelMinZoom;
      labelPane.classList.toggle('ns-lbl-zoomed', zoomed);
      if (!labels.length) return;
      const size = map.getSize(), cLon = map.getCenter().lng, placed = [];
      const free = b => !placed.some(o => b.x0 < o.x1 - 1 && b.x1 > o.x0 + 1 && b.y0 < o.y1 - 1 && b.y1 > o.y0 + 1);
      const fit = (p, lb) => SPOTS.find(s => free(textBox(p, lb, s)));
      labels.forEach(lb => {
        // use the copy of the world nearest the middle of the view
        const lon = lb.lon + 360 * Math.round((cLon - lb.lon) / 360);
        if (lon !== lb.at) { lb.at = lon; lb.marker.setLatLng([lb.lat, lon]); }
        lb.p = map.latLngToContainerPoint([lb.lat, lon]);
        lb.inView = lb.p.x > -220 && lb.p.y > -20 && lb.p.x < size.x + 20 && lb.p.y < size.y + 20;
        lb.state = (lb.major || zoomed) && !lb.inView ? 'on' : 'off';
        lb.spot = 'r';
      });
      // 1. the dots of the major targets, 2. their words, 3. the small labels (dot and words together)
      labels.forEach(lb => {
        if (lb.major && lb.inView && free(dotBox(lb.p))) { lb.state = 'dot'; placed.push(dotBox(lb.p)); }
      });
      labels.forEach(lb => {
        if (lb.state !== 'dot') return;
        const spot = fit(lb.p, lb);
        if (spot) { lb.state = 'on'; lb.spot = spot; placed.push(textBox(lb.p, lb, spot)); }
      });
      if (zoomed) labels.forEach(lb => {
        if (lb.major || !lb.inView || !free(dotBox(lb.p))) return;
        const spot = fit(lb.p, lb);
        if (spot) { lb.state = 'on'; lb.spot = spot; placed.push(dotBox(lb.p), textBox(lb.p, lb, spot)); }
      });
      labels.forEach(lb => {
        const el = lb.marker.getElement();
        if (!el) return;
        el.classList.toggle('ns-lbl-off', lb.state === 'off');
        el.classList.toggle('ns-lbl-notext', lb.state === 'dot');
        el.classList.toggle('ns-lbl-l', lb.spot[0] === 'l');
        el.classList.toggle('ns-lbl-u', lb.spot[1] === 'u');
        el.classList.toggle('ns-lbl-d', lb.spot[1] === 'd');
      });
    }
    map.on('moveend resize', layoutLabels);   // (moveend also follows every zoom)
    layoutLabels();

    return {
      ready,
      setSides,
      setLabels,
      panes: { imagery: 'nsImagery', shade: 'nsShade', countries: 'nsCountries', labels: 'nsLabels' },
    };
  }

  NS.MapLayers = { init, look: LOOK };

  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof window !== 'undefined' ? window : globalThis);
