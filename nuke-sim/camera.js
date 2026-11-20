// Nuke Sim: the automatic camera. Like the nuclear war videos, it follows the action: the missile fields as
// they launch, a wide view while missiles are in the air, then closer views of the places being hit.
// It plans its "shots" (place + map zoom level) once per scenario from the strike list.
// Dragging or zooming the map turns it off; the camera button (or C) turns it back on.
(function (root) {
  'use strict';
  const NS = root.NS = root.NS || {};
  const DEG = Math.PI / 180, EARTH_KM = 6371;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ✏️ EDIT: how the camera behaves
  const CAM = {
    step: 240,          // sim seconds between possible camera moves
    window: 480,        // how far ahead (sim seconds) each shot looks for action
    lead: 150,          // start moving this many sim seconds before the action, so the camera is there in time
    flyMs: 2400,        // real milliseconds a camera move takes
    fill: 0.55,         // share of the screen width the action should fill
    minZoom: 3, maxZoom: 6.5,   // closest and widest views for groups of hits/launches (map zoom levels)
    flightZoom: 2.5,    // the wide view while missiles are in the air
    oneBombZoom: 7,     // a single bomb: this close
    maxLat: 62          // the flat map stretches the far north, so views stay south of this
  };

  function unit(lat, lon) { const la = lat * DEG, lo = lon * DEG, c = Math.cos(la); return [c * Math.sin(lo), Math.sin(la), c * Math.cos(lo)]; }
  function toLatLon(v) { const r = Math.hypot(v[0], v[1], v[2]) || 1; return { lat: Math.asin(v[1] / r) / DEG, lon: Math.atan2(v[0], v[2]) / DEG }; }
  function km(a, b) { const d = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1); return Math.acos(d) * EARTH_KM; }
  function slerp(a, b, f) {
    const w = Math.acos(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1)), s = Math.sin(w);
    if (s < 1e-6) return a.slice();
    const p = Math.sin((1 - f) * w) / s, q = Math.sin(f * w) / s;
    return [p * a[0] + q * b[0], p * a[1] + q * b[1], p * a[2] + q * b[2]];
  }

  // The densest group of events: bin them into 15° cells, take the heaviest cell, gather everything near it
  function focus(events) {
    if (!events.length) return null;
    const cells = new Map();
    for (const e of events) {
      const ll = toLatLon(e.v);
      const key = Math.floor((ll.lat + 90) / 15) + ':' + Math.floor((ll.lon + 180) / (15 / Math.max(0.35, Math.cos(ll.lat * DEG))));
      const c = cells.get(key) || { w: 0, v: [0, 0, 0] };
      c.w += e.w; c.v[0] += e.v[0] * e.w; c.v[1] += e.v[1] * e.w; c.v[2] += e.v[2] * e.w;
      cells.set(key, c);
    }
    let best = null;
    for (const c of cells.values()) if (!best || c.w > best.w) best = c;
    const n = Math.hypot(best.v[0], best.v[1], best.v[2]) || 1;
    const centre = [best.v[0] / n, best.v[1] / n, best.v[2] / n];
    const near = events.filter(e => km(e.v, centre) < 2200);
    const sum = [0, 0, 0]; let w = 0;
    near.forEach(e => { sum[0] += e.v[0] * e.w; sum[1] += e.v[1] * e.w; sum[2] += e.v[2] * e.w; w += e.w; });
    const m = Math.hypot(sum[0], sum[1], sum[2]) || 1;
    const c2 = [sum[0] / m, sum[1] / m, sum[2] / m];
    const d = near.map(e => km(e.v, c2)).sort((a, b) => a - b);
    const spread = d.length ? d[Math.floor(d.length * 0.85)] : 0;
    const kinds = { launch: 0, flight: 0, hit: 0 };
    near.forEach(e => { kinds[e.kind] += e.w; });
    return Object.assign(toLatLon(c2), { v: c2, w, spread, count: near.length, kinds });
  }

  // Plans the camera moves for a scenario: [{ at, lat, lon, zoom, kind }]
  // opts.width: the screen width in px (the zoom is picked so the action fills part of it)
  function plan(ns, opts) {
    opts = opts || {};
    const width = opts.width || 1280;
    const strikes = (ns && ns.strikes) || [];
    const shots = [];
    const v0 = ns && ns.view || { lat: 45, lon: 15, zoom: 2 };
    shots.push({ at: 0, lat: v0.lat, lon: v0.lon, zoom: +v0.zoom || 2, kind: 'start' });
    if (strikes.length < 1) return shots;
    const few = strikes.length < 5;   // one or two bombs: follow them closely
    // where everything happens, as unit vectors
    const pre = strikes.map(s => ({ s, a: unit(s.from.lat, s.from.lon), b: unit(s.to.lat, s.to.lon), det: s.launchAt + s.flight }));
    const end = ns.end || pre.reduce((m, p) => Math.max(m, p.det), 0);
    let last = shots[0];
    for (let t0 = 0; t0 < end; t0 += CAM.step) {
      const t1 = t0 + CAM.window, mid = t0 + CAM.window / 2;
      const ev = [];
      for (const p of pre) {
        const s = p.s;
        if (s.launchAt >= t0 && s.launchAt < t1) ev.push({ v: p.a, w: 0.7, kind: 'launch' });
        if (p.det >= t0 && p.det < t1) ev.push({ v: p.b, w: s.to.kind === 'city' ? 1.6 : 1, kind: 'hit' });
        if (s.launchAt < mid && p.det > mid && s.flight > 900 && (few || p.det - mid > 300)) {
          // a long-range missile in the air: count where it is halfway through the window (lightly)
          ev.push({ v: slerp(p.a, p.b, (mid - s.launchAt) / s.flight), w: 0.12, kind: 'flight' });
        }
      }
      const f = focus(ev);
      if (!f || f.w < (few ? 0.1 : 0.6)) continue;
      const k = f.kinds;
      const kind = k.hit >= k.launch && k.hit >= k.flight ? 'hit' : k.launch >= k.flight ? 'launch' : 'flight';
      let zoom, lat = clamp(f.lat, -55, CAM.maxLat), lon = f.lon;
      if (kind === 'flight') {
        // a wide view, centred between where the missiles come from and where they go
        zoom = few ? 3 : CAM.flightZoom;
        lat = clamp(f.lat, 25, 52);
      } else if (few) {
        zoom = CAM.oneBombZoom;
      } else {
        // fit the group: its spread should fill about CAM.fill of the screen width (Mercator: wider near the poles)
        const kmAcross = Math.max(250, f.spread * 2.2);
        zoom = Math.log2(CAM.fill * width * 40075 * Math.cos(lat * DEG) / (256 * kmAcross));
        zoom = clamp(Math.round(zoom * 2) / 2, CAM.minZoom, CAM.maxZoom);
      }
      const shot = { at: Math.max(0, t0 - CAM.lead), lat, lon, zoom, kind };
      // skip moves that would barely change the picture
      const moved = km(unit(last.lat, last.lon), unit(shot.lat, shot.lon));
      if (moved < 500 && Math.abs(shot.zoom - last.zoom) < 0.75) continue;
      if (shot.at - last.at < CAM.step * 0.9) shot.at = last.at + CAM.step * 0.9;
      if (shot.at >= end) break;
      shots.push(shot);
      last = shot;
    }
    return shots;
  }

  function AutoCamera(view) {
    this.view = view;
    this.shots = [];
    this.current = -1;
    this.enabled = true;
    this.listeners = [];
    if (view && view.onUserMove) view.onUserMove(() => { if (this.enabled) this.setEnabled(false); });
  }
  AutoCamera.prototype.plan = function (ns, opts) { this.shots = plan(ns, opts); this.current = -1; return this.shots; };
  AutoCamera.prototype.shotAt = function (t) {
    let i = -1;
    while (i + 1 < this.shots.length && this.shots[i + 1].at <= t) i++;
    return i;
  };
  // Call every frame with the sim time; `instant` jumps there without flying (after a seek)
  AutoCamera.prototype.update = function (t, instant) {
    if (!this.enabled || !this.view || !this.shots.length) return;
    const i = this.shotAt(t);
    if (i < 0 || i === this.current) return;
    this.current = i;
    const s = this.shots[i];
    this.view.flyTo({ lat: s.lat, lon: s.lon, zoom: s.zoom }, instant ? 700 : CAM.flyMs);
  };
  AutoCamera.prototype.setEnabled = function (on) {
    this.enabled = !!on;
    if (on) this.current = -1;
    this.listeners.forEach(cb => { try { cb(this.enabled); } catch (e) { /* ignore */ } });
  };
  AutoCamera.prototype.onChange = function (cb) { this.listeners.push(cb); };

  NS.AutoCamera = AutoCamera;
  NS.AutoCamera.plan = plan;
  NS.AutoCamera.CAM = CAM;
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof window !== 'undefined' ? window : globalThis);
