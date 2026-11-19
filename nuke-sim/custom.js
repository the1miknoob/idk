// Nuke Sim: the "Build your own" mode. Click the map to drop one warhead and see what it would do:
// its damage rings drawn to scale, and a rough estimate of the people killed and injured (in the spirit of NUKEMAP).
// app.js hands us the map, the clock and the casualty model through `ctx`; this file is the side panel, the clicks and the rings.
// The rings come from NS.Effects.radii (effects.js) and the words for each ring from NS.CONTENT.legend (content.js).
(function (root) {
  'use strict';
  const NS = root.NS = root.NS || {};

  // ✏️ EDIT: the yields you can pick, in kilotons of TNT (1,000 kt = 1 megaton). `def: true` is the one picked at the start.
  const YIELDS = [
    { kt: 15, name: 'Hiroshima bomb (1945)' },
    { kt: 100, name: 'W76 submarine warhead' },
    { kt: 300, name: 'W87 ICBM warhead' },
    { kt: 800, name: 'Typical Russian ICBM warhead', def: true },
    { kt: 1200, name: 'B83 bomb, largest US bomb today' },
    { kt: 5000, name: 'Large Cold War warhead' },
    { kt: 50000, name: 'Tsar Bomba, largest ever tested' }
  ];

  // ✏️ EDIT: the two ways a warhead can go off
  const BURSTS = [
    { id: 'air', name: 'Airburst (widest blast damage)' },
    { id: 'ground', name: 'Surface burst (makes fallout)' }
  ];

  // The shared effect colors (the same everywhere: renderer, legend, these rings)
  const COLORS = { fireball: '#fff4c2', psi20: '#ff2d2d', psi5: '#ff8a1f', thermal: '#ffd23f', psi1: '#9ca3af', fallout: '#a855f7' };
  const RINGS = ['psi1', 'thermal', 'psi5', 'psi20', 'fireball'];   // drawn from the outside in, so the small ones sit on top

  // Words for each ring, used only if content.js has no legend entry for it
  const MEANING = {
    fireball: ['Fireball', 'Everything inside is vaporised.'],
    psi20: ['Heavy blast (20 psi)', 'Even concrete buildings are destroyed. Almost no one survives.'],
    psi5: ['Moderate blast (5 psi)', 'Most houses collapse; deaths and injuries are widespread.'],
    thermal: ['Heat flash (3rd-degree burns)', 'Exposed skin gets third-degree burns. Fires break out.'],
    psi1: ['Light blast (1 psi)', 'Windows shatter. Flying glass and debris injure many people.'],
    fallout: ['Fallout (ground bursts only)', 'Radioactive dust falls downwind.']
  };

  const SUB_RANGE_KM = 3000;   // a submarine launch area closer than this is used before a land silo field
  const MIN_LAUNCH_KM = 300;   // don't launch from a site right next to the target (unless nothing else is left)
  const PANE = 'nsCustomRings';   // our own map pane, just above the renderer's glow (z 450) and below markers (600)
  let nextId = 1;

  // ---------- small helpers ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmtInt = n => Math.round(Math.max(0, +n || 0)).toLocaleString('en-US');
  const fmtKm = km => {
    const v = Math.max(0, +km || 0);
    if (v > 0 && v < 0.01) return '< 0.01 km';
    const d = v < 1 ? 2 : 1;
    return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' km';
  };
  const fmtYield = kt => kt >= 1000 ? `${+(kt / 1000).toFixed(2)} Mt` : `${+(+kt).toFixed(2)} kt`;
  const burstName = b => b === 'ground' ? 'surface burst' : 'airburst';
  const pad = n => String(n).padStart(2, '0');
  const fmtClock = s => { s = Math.max(0, Math.round(+s || 0)); return `T+${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };
  const fmtLeft = s => { s = Math.max(0, Math.ceil(+s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return (h ? `${h}:${pad(m)}` : `${m}`) + `:${pad(s % 60)}`; };
  const coordName = p => `${Math.abs(p.lat).toFixed(2)}°${p.lat >= 0 ? 'N' : 'S'}, ${Math.abs(p.lon).toFixed(2)}°${p.lon >= 0 ? 'E' : 'W'}`;

  // Distance in km (effects.js has the shared one; this is the same great-circle maths in case it isn't loaded)
  function distKm(a, b) {
    if (NS.Effects && NS.Effects.distanceKm) return NS.Effects.distanceKm(a, b);
    const R = 6371, rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // Flight time in seconds (effects.js decides; the fallback is a rough ICBM / SLBM guess)
  function flightSeconds(from, to) {
    let t = NaN;
    try { if (NS.Effects && NS.Effects.flightTime) t = +NS.Effects.flightTime(from, to, from.kind); } catch (e) { /* use the guess below */ }
    if (Number.isFinite(t) && t > 0) return t;
    const d = distKm(from, to);
    return from.kind === 'sub' ? 480 + d * 0.15 : 1500 + d * 0.035;
  }

  // The damage radii (km) for a yield, with every ring present
  function radiiFor(yieldKt, burst) {
    let r = null;
    try { if (NS.Effects && NS.Effects.radii) r = NS.Effects.radii(yieldKt, burst); } catch (e) { r = null; }
    const out = {};
    for (const k of RINGS) out[k] = Math.max(0, +(r && r[k]) || 0);
    return out;
  }

  function falloutFor(yieldKt, burst) {
    if (burst !== 'ground' || !NS.Effects || !NS.Effects.fallout) return null;
    try {
      const f = NS.Effects.fallout(yieldKt, burst);
      return f && f.length > 0 ? f : null;
    } catch (e) { return null; }
  }

  // Name and meaning of a ring: from content.js if it has one, otherwise the short text above
  function ringInfo(key) {
    const legend = (NS.CONTENT && Array.isArray(NS.CONTENT.legend)) ? NS.CONTENT.legend : [];
    const l = legend.find(x => x && x.key === key) || {};
    return { name: l.name || MEANING[key][0], text: l.text || MEANING[key][1] };
  }

  // Pick a plausible launcher for a target: the nearest submarine area if one is within 3,000 km, otherwise the nearest silo field
  function nearestLauncher(to) {
    const nearest = (list, kind) => {
      let best = null, fallback = null;
      for (const s of list || []) {
        if (!s || !Number.isFinite(+s.lat) || !Number.isFinite(+s.lon)) continue;
        const d = distKm({ lat: +s.lat, lon: +s.lon }, to);
        if (!fallback || d < fallback.d) fallback = { site: s, d, kind };
        if (d >= MIN_LAUNCH_KM && (!best || d < best.d)) best = { site: s, d, kind };
      }
      return best || fallback;
    };
    const sub = nearest(NS.SUB_AREAS, 'sub'), silo = nearest(NS.SILO_FIELDS, 'silo');
    if (sub && sub.d <= SUB_RANGE_KM && sub.d >= MIN_LAUNCH_KM) return sub;
    return silo || sub;
  }

  // ---------- the look of our own bits (the rest of the panel uses the page's styles) ----------
  const CSS = `
.ns-cm-hint{margin:0 0 10px;line-height:1.4}
.ns-cm-field{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:6px 0}
.ns-cm-field>span{opacity:.8;flex:0 0 auto}
.ns-cm-field select{flex:1 1 auto;min-width:0;max-width:72%}
.ns-cm-check{display:flex;gap:8px;align-items:flex-start;margin:10px 0 12px;cursor:pointer;line-height:1.35}
.ns-cm-check input{margin:2px 0 0;flex:0 0 auto}
.ns-cm-result{border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:10px 12px;background:rgba(255,255,255,.04);margin:0 0 12px}
.ns-cm-muted{opacity:.65;margin:0;font-size:.92em;line-height:1.4}
.ns-cm-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.ns-cm-place{font-weight:700;line-height:1.3}
.ns-cm-sub{opacity:.7;font-size:.88em;margin:2px 0 8px}
.ns-cm-zoom{flex:0 0 auto;font:inherit;font-size:.8em;padding:2px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.25);background:transparent;color:inherit;cursor:pointer}
.ns-cm-zoom:hover{background:rgba(255,255,255,.08)}
.ns-cm-stats{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 0 8px}
.ns-cm-stats span{display:block;font-size:.72em;opacity:.65;text-transform:uppercase;letter-spacing:.05em}
.ns-cm-stats b{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:1.12em;font-variant-numeric:tabular-nums}
.ns-cm-stats .ns-cm-deaths b{color:#ff6b6b}
.ns-cm-cities{font-size:.82em;opacity:.75;margin:0 0 8px;line-height:1.35}
.ns-cm-radii{width:100%;border-collapse:collapse;font-size:.86em}
.ns-cm-radii th{text-align:left;font-weight:600;opacity:.6;font-size:.85em;padding:0 0 3px}
.ns-cm-radii td{padding:2px 0;vertical-align:middle}
.ns-cm-radii th:last-child,.ns-cm-radii td:last-child{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.ns-cm-sw{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:7px;vertical-align:-1px;border:2px solid;box-sizing:border-box}
.ns-cm-note{margin:8px 0 0;font-size:.76em;opacity:.55}
.ns-cm-listhead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 6px;font-size:.92em}
.ns-cm-listhead button{font:inherit;font-size:.85em}
.ns-cm-list{list-style:none;margin:0;padding:0;max-height:240px;overflow:auto}
.ns-cm-list:empty::before{content:'Nothing placed yet.';opacity:.55;font-size:.88em}
.ns-cm-list li{display:flex;align-items:center;gap:8px;padding:6px 2px;border-top:1px solid rgba(255,255,255,.08);cursor:pointer;font-size:.88em;line-height:1.3}
.ns-cm-list li:hover,.ns-cm-list li:focus{background:rgba(255,255,255,.05);outline:none}
.ns-cm-list .ns-cm-n{flex:0 0 auto;width:1.6em;height:1.6em;border-radius:50%;display:inline-grid;place-items:center;font-size:.78em;background:rgba(255,255,255,.1)}
.ns-cm-list .ns-cm-what{flex:1 1 auto;min-width:0}
.ns-cm-list .ns-cm-what b{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ns-cm-list .ns-cm-what small{opacity:.65}
.ns-cm-list .ns-cm-toll{flex:0 0 auto;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
.ns-cm-list .is-flight .ns-cm-toll{color:#ffd23f;font-family:inherit}
.leaflet-container.ns-cm-on,.leaflet-container.ns-cm-on .ns-cm-ring{cursor:crosshair}
.ns-cm-target{pointer-events:auto}
.ns-cm-target i{position:absolute;inset:0;border-radius:50%;box-sizing:border-box}
.ns-cm-target .ns-cm-pulse{border:2px solid #ffd23f;animation:ns-cm-pulse 1.3s ease-out infinite}
.ns-cm-target .ns-cm-cross{inset:9px;border:2px solid #ff5a00;background:rgba(255,90,0,.25);box-shadow:0 0 8px #ff5a00}
.ns-cm-target .ns-cm-dot{inset:13px;background:#fff3b0}
@keyframes ns-cm-pulse{0%{transform:scale(.35);opacity:1}100%{transform:scale(1.25);opacity:0}}
@media (prefers-reduced-motion:reduce){.ns-cm-target .ns-cm-pulse{animation:none;opacity:.7}}
.leaflet-tooltip.ns-cm-tip,.ns-cm-popup .leaflet-popup-content-wrapper,.ns-cm-popup .leaflet-popup-tip{background:rgba(14,17,23,.94);color:#e8eaf0;border:1px solid rgba(255,255,255,.18);box-shadow:0 4px 18px rgba(0,0,0,.5)}
.leaflet-tooltip.ns-cm-tip{max-width:260px;white-space:normal;line-height:1.35;font-size:12px}
.leaflet-tooltip-top.ns-cm-tip::before{border-top-color:rgba(14,17,23,.94)}
.leaflet-tooltip-bottom.ns-cm-tip::before{border-bottom-color:rgba(14,17,23,.94)}
.leaflet-tooltip-left.ns-cm-tip::before{border-left-color:rgba(14,17,23,.94)}
.leaflet-tooltip-right.ns-cm-tip::before{border-right-color:rgba(14,17,23,.94)}
.ns-cm-popup .leaflet-popup-content{margin:10px 12px;font-size:12px;line-height:1.4}
.ns-cm-popup a.leaflet-popup-close-button{color:#aab}
.ns-cm-pop table{border-collapse:collapse;margin-top:6px;width:100%}
.ns-cm-pop td{padding:2px 6px 2px 0;vertical-align:top}
.ns-cm-pop td:nth-child(2){white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums}
.ns-cm-pop small{display:block;opacity:.65}
`;
  function addStyles() {
    if (typeof document === 'undefined' || document.getElementById('ns-custom-css')) return;
    const s = document.createElement('style');
    s.id = 'ns-custom-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ---------- the mode itself ----------
  // ctx = { map, renderer, casualties, panel, launch(strike), now(), onDetonation(cb) }
  // Note: launch(strike) is what puts the missile on the clock and on screen (app.js adds it to the renderer),
  // and app.js applies the casualties when it goes off. We only draw the rings and fill the panel.
  function CustomMode(ctx) {
    if (!(this instanceof CustomMode)) return new CustomMode(ctx);
    this.ctx = ctx || {};
    this.enabled = false;
    this.yieldKt = (YIELDS.find(y => y.def) || YIELDS[0]).kt;
    this.burst = 'air';
    this.fromSite = true;     // launch a missile from the nearest launch site (or drop the warhead in place)
    this.autoZoom = true;     // after a blast too small to see, zoom the map in on it
    this._entries = [];       // what you placed, oldest first: see _newEntry
    this._byKey = new Map();
    this._ours = new Set();   // every strike this mode ever launched (so we still recognise one that lands after "Clear")
    this._last = null;        // the latest blast that went off (shown in the result card)
    this._timer = null;
    this._onClick = this._onClick.bind(this);
    if (typeof this.ctx.onDetonation === 'function') this.ctx.onDetonation((strike, result) => this._onDetonation(strike, result));
  }

  CustomMode.YIELDS = YIELDS;
  CustomMode.BURSTS = BURSTS;
  CustomMode.COLORS = COLORS;

  // A copy of what's been placed, oldest first (handy for tests and app.js)
  Object.defineProperty(CustomMode.prototype, 'blasts', {
    get() {
      return this._entries.map(e => ({ strike: e.strike, place: e.place, yieldKt: e.yieldKt, burst: e.burst,
        status: e.status, detonateAt: e.detAt, result: e.result, radii: e.radii }));
    }
  });

  CustomMode.prototype.enable = function () {
    if (this.enabled) return;
    const map = this.ctx.map, L = root.L;
    this.enabled = true;
    addStyles();
    this._buildPanel();
    if (map && L) {
      if (!map.getPane(PANE)) { const p = map.createPane(PANE); p.style.zIndex = 460; }
      map.on('click', this._onClick);
      // In this mode every click drops a warhead, so a double click shouldn't also zoom the map
      this._hadDblZoom = !!(map.doubleClickZoom && map.doubleClickZoom.enabled());
      if (this._hadDblZoom) map.doubleClickZoom.disable();
      L.DomUtil.addClass(map.getContainer(), 'ns-cm-on');
    }
    this._timer = setInterval(() => this._tick(), 250);
  };

  CustomMode.prototype.disable = function () {
    const map = this.ctx.map, L = root.L;
    if (this.enabled && map && L) {
      map.off('click', this._onClick);
      if (this._hadDblZoom && map.doubleClickZoom) map.doubleClickZoom.enable();
      L.DomUtil.removeClass(map.getContainer(), 'ns-cm-on');
    }
    this.enabled = false;
    clearInterval(this._timer);
    this._timer = null;
    clearTimeout(this._zoomTimer);
    this._forget();
    if (this.ctx.panel) this.ctx.panel.innerHTML = '';
    this._el = null;
  };

  CustomMode.prototype.clear = function () {
    this._forget();
    try { if (this.ctx.casualties && this.ctx.casualties.reset) this.ctx.casualties.reset(); } catch (e) { console.error(e); }
    try { if (this.ctx.renderer && this.ctx.renderer.reset) this.ctx.renderer.reset(); } catch (e) { console.error(e); }
    this._renderList();
    this._renderResult();
  };

  // Remove every ring and marker and forget the list (the clock may still land missiles already in the air;
  // if one lands while the mode is on, it shows up again, so the list always matches the counters)
  CustomMode.prototype._forget = function () {
    for (const e of this._entries) this._removeLayers(e);
    this._entries = [];
    this._byKey.clear();
    this._last = null;
    clearTimeout(this._zoomTimer);
  };

  CustomMode.prototype._removeLayers = function (e) {
    if (e.marker) { e.marker.remove(); e.marker = null; }
    if (e.rings) { e.rings.remove(); e.rings = null; }
  };

  // ---------- the panel ----------
  CustomMode.prototype._buildPanel = function () {
    const panel = this.ctx.panel;
    if (!panel) { this._el = null; return; }
    panel.innerHTML = `
<p class="ns-cm-hint">Click anywhere on the map to drop a warhead.</p>
<label class="ns-cm-field"><span>Yield</span><select id="yield">${YIELDS.map(y =>
      `<option value="${y.kt}"${y.kt === this.yieldKt ? ' selected' : ''}>${esc(y.name)} (${fmtYield(y.kt)})</option>`).join('')}</select></label>
<label class="ns-cm-field"><span>Burst</span><select id="burst">${BURSTS.map(b =>
      `<option value="${b.id}"${b.id === this.burst ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
<label class="ns-cm-check"><input type="checkbox" id="custom-launch"${this.fromSite ? ' checked' : ''}> <span>Launch a missile from the nearest launch site</span></label>
<div id="custom-result" class="ns-cm-result" aria-live="polite"></div>
<div class="ns-cm-listhead"><span id="custom-total">Your warheads</span><button type="button" id="custom-clear">Clear all</button></div>
<ul id="custom-list" class="ns-cm-list"></ul>`;
    const $ = sel => panel.querySelector(sel);
    this._el = { yield: $('#yield'), burst: $('#burst'), launch: $('#custom-launch'), result: $('#custom-result'),
      list: $('#custom-list'), total: $('#custom-total'), clear: $('#custom-clear') };
    const el = this._el;
    el.yield.addEventListener('change', () => { this.yieldKt = +el.yield.value || this.yieldKt; });
    el.burst.addEventListener('change', () => { this.burst = el.burst.value === 'ground' ? 'ground' : 'air'; });
    el.launch.addEventListener('change', () => { this.fromSite = el.launch.checked; });
    el.clear.addEventListener('click', () => this.clear());
    el.list.addEventListener('click', ev => {
      const li = ev.target.closest('li[data-n]');
      if (li) this._show(this._entries.find(e => e.n === +li.dataset.n));
    });
    el.list.addEventListener('keydown', ev => {
      const li = ev.target.closest('li[data-n]');
      if (li && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); this._show(this._entries.find(e => e.n === +li.dataset.n)); }
    });
    el.result.addEventListener('click', ev => { if (ev.target.closest('.ns-cm-zoom')) this._show(this._last); });
    // If the app floats the panel over the map, clicks on it must not drop warheads
    const map = this.ctx.map, L = root.L;
    if (map && L && map.getContainer().contains(panel) && !panel._nsCmStopped) {
      L.DomEvent.disableClickPropagation(panel);
      L.DomEvent.disableScrollPropagation(panel);
      panel._nsCmStopped = true;
    }
    this._renderList();
    this._renderResult();
  };

  CustomMode.prototype._renderList = function () {
    const el = this._el;
    if (!el) return;
    el.list.innerHTML = this._entries.map(e => {
      const toll = e.status === 'done'
        ? `${fmtInt(e.result && e.result.deaths)} deaths`
        : `<span class="ns-cm-eta">${this._etaText(e)}</span>`;
      return `<li data-n="${e.n}" class="${e.status === 'done' ? 'is-done' : 'is-flight'}" tabindex="0" title="Show it on the map">` +
        `<span class="ns-cm-n">${e.n}</span><span class="ns-cm-what"><b>${esc(e.place)}</b><small>${fmtYield(e.yieldKt)} ${burstName(e.burst)}</small></span>` +
        `<span class="ns-cm-toll">${toll}</span></li>`;
    }).join('');
    const done = this._entries.filter(e => e.status === 'done');
    const total = done.reduce((a, e) => a + (+(e.result && e.result.deaths) || 0), 0);
    el.total.textContent = this._entries.length
      ? `Your warheads (${this._entries.length})${done.length ? ` · ${fmtInt(total)} deaths` : ''}`
      : 'Your warheads';
  };

  CustomMode.prototype._etaText = function (e) {
    const left = e.detAt - (+this.ctx.now() || 0);
    return left > 0 ? `in flight · ${fmtLeft(left)}` : 'arriving';
  };

  CustomMode.prototype._renderResult = function () {
    const el = this._el;
    if (!el) return;
    const e = this._last;
    if (!e) {
      const next = this._entries.filter(x => x.status !== 'done').sort((a, b) => a.detAt - b.detAt)[0];
      el.result.innerHTML = next
        ? `<p class="ns-cm-muted">Missile in flight to ${esc(next.place)}. It arrives at ${fmtClock(next.detAt)}.</p>`
        : '<p class="ns-cm-muted">Pick a yield, then click a place on the map. The damage rings and an estimate of deaths and injuries will show here.</p>';
      return;
    }
    const r = e.result || {};
    const rows = RINGS.slice().reverse().filter(k => e.radii[k] > 0).map(k => {
      const info = ringInfo(k);
      return `<tr data-key="${k}" title="${esc(info.text)}"><td><i class="ns-cm-sw" style="border-color:${COLORS[k]};background:${COLORS[k]}55"></i>${esc(info.name)}</td><td>${fmtKm(e.radii[k])}</td></tr>`;
    });
    if (e.fallout) {
      const info = ringInfo('fallout');
      rows.push(`<tr data-key="fallout" title="${esc(info.text)}"><td><i class="ns-cm-sw" style="border-color:${COLORS.fallout};background:${COLORS.fallout}55"></i>${esc(info.name)}</td><td>${fmtInt(e.fallout.length)} × ${fmtInt(e.fallout.width)} km</td></tr>`);
    }
    const hit = (Array.isArray(r.cities) ? r.cities : []).filter(c => c && c.deaths >= 1).slice(0, 3);
    el.result.innerHTML = `
<div class="ns-cm-head"><div><div class="ns-cm-place">${esc(e.place)}</div><div class="ns-cm-sub">${fmtYield(e.yieldKt)} ${burstName(e.burst)} · ${fmtClock(e.detAt)}</div></div><button type="button" class="ns-cm-zoom">Show</button></div>
<div class="ns-cm-stats"><div class="ns-cm-deaths"><span>Estimated deaths</span><b>${fmtInt(r.deaths)}</b></div><div class="ns-cm-injuries"><span>Injuries</span><b>${fmtInt(r.injuries)}</b></div></div>
${hit.length ? `<p class="ns-cm-cities">Worst hit: ${hit.map(c => `${esc(c.name)} (${fmtInt(c.deaths)})`).join(', ')}</p>` : ''}
<table class="ns-cm-radii"><thead><tr><th>Effect</th><th>Radius</th></tr></thead><tbody>${rows.join('')}</tbody></table>
<p class="ns-cm-note">Rough estimate from a simple model: cities over 50,000 people, blast and heat only.</p>`;
  };

  // Every quarter second: count down the missiles in the air
  CustomMode.prototype._tick = function () {
    const el = this._el;
    if (!el) return;
    const spans = el.list.querySelectorAll('li.is-flight .ns-cm-eta');
    for (const span of spans) {
      const e = this._entries.find(x => x.n === +span.closest('li').dataset.n);
      if (e) span.textContent = this._etaText(e);
    }
  };

  // Pan / zoom the map to one of your warheads
  CustomMode.prototype._show = function (e) {
    const map = this.ctx.map;
    if (!e || !map) return;
    if (e.rings && e.radii.psi1 > 0) {
      const outer = Math.max(...RINGS.map(k => e.radii[k]));
      map.flyToBounds(root.L.latLng(e.at.lat, e.at.lon).toBounds(outer * 2000 * 1.15), { padding: [30, 30], maxZoom: 13, duration: 1 });
    } else {
      map.panTo([e.at.lat, e.at.lon]);
    }
  };

  // ---------- placing a warhead ----------
  CustomMode.prototype._onClick = function (ev) {
    if (!this.enabled || !ev || !ev.latlng) return;
    const at = { lat: ev.latlng.lat, lon: ev.latlng.lng };                 // where you clicked (rings go here)
    const w = ev.latlng.wrap ? ev.latlng.wrap() : ev.latlng;               // the same spot with longitude in -180…180
    const to = { lat: w.lat, lon: w.lng };
    const yieldKt = this.yieldKt, burst = this.burst;
    this.place(to, { yieldKt, burst, at });
  };

  // Drop a warhead at { lat, lon } (the map click calls this; tests and app.js may too). Returns the strike.
  CustomMode.prototype.place = function (to, opts) {
    opts = opts || {};
    const yieldKt = +opts.yieldKt || this.yieldKt, burst = opts.burst === 'ground' || opts.burst === 'air' ? opts.burst : this.burst;
    const fromSite = opts.fromSite != null ? !!opts.fromSite : this.fromSite;
    let prev = null;
    try { if (this.ctx.casualties && this.ctx.casualties.preview) prev = this.ctx.casualties.preview({ lat: to.lat, lon: to.lon, yieldKt, burst }); } catch (e) { prev = null; }
    const name = (prev && prev.place) || coordName(to);
    const now = +this.ctx.now() || 0;
    let from = null, flight = 1;
    if (fromSite) {
      const l = nearestLauncher(to);
      if (l) {
        from = { lat: +l.site.lat, lon: +l.site.lon, name: l.kind === 'sub' ? `Submarine, ${l.site.name}` : l.site.name, kind: l.kind };
        flight = flightSeconds(from, to);
      }
    }
    if (!from) { from = { lat: to.lat, lon: to.lon, name: 'Placed by hand', kind: 'tactical' }; flight = 1; }
    const n = nextId++;
    const strike = {
      id: 1000000 + n, side: 'blue', from,
      to: { lat: to.lat, lon: to.lon, name, cc: (prev && prev.cc) || '', kind: 'custom' },
      launchAt: now, flight: Math.round(flight * 10) / 10, yieldKt, burst,
      custom: true, customId: 'custom-' + n
    };
    const e = this._newEntry(strike, opts.at || to);
    this._addTarget(e);
    this._renderList();
    if (!this._last) this._renderResult();
    try { if (typeof this.ctx.launch === 'function') this.ctx.launch(strike); } catch (err) { console.error(err); }
    return strike;
  };

  CustomMode.prototype._newEntry = function (strike, at) {
    const key = strike.customId || 'id:' + strike.id;
    const e = {
      n: this._entries.length ? this._entries[this._entries.length - 1].n + 1 : 1,
      key, strike, at: { lat: +at.lat, lon: +at.lon },
      place: (strike.to && strike.to.name) || coordName(strike.to),
      yieldKt: strike.yieldKt, burst: strike.burst, detAt: (+strike.launchAt || 0) + (+strike.flight || 0),
      status: 'flight', result: null, radii: null, fallout: null, marker: null, rings: null
    };
    this._entries.push(e);
    this._byKey.set(key, e);
    this._ours.add(key);
    return e;
  };

  // The small pulsing target marker that waits at the spot until the warhead arrives
  CustomMode.prototype._addTarget = function (e) {
    const map = this.ctx.map, L = root.L;
    if (!map || !L) return;
    e.marker = L.marker([e.at.lat, e.at.lon], {
      icon: L.divIcon({ className: 'ns-cm-target', html: '<i class="ns-cm-pulse"></i><i class="ns-cm-cross"></i><i class="ns-cm-dot"></i>', iconSize: [32, 32] }),
      keyboard: false, zIndexOffset: 500
    }).bindTooltip(`Incoming: ${fmtYield(e.yieldKt)} ${burstName(e.burst)} on ${esc(e.place)}<br>from ${esc(e.strike.from.name)} · arrives ${fmtClock(e.detAt)}`,
      { className: 'ns-cm-tip', direction: 'top', offset: [0, -14] }).addTo(map);
  };

  // ---------- a warhead goes off ----------
  CustomMode.prototype._onDetonation = function (strike, result) {
    if (!this.enabled || !strike) return;
    const key = strike.customId || 'id:' + strike.id;
    let e = this._byKey.get(key);
    if (!e) {
      if (!this._ours.has(key)) return;        // somebody else's strike (a scenario)
      e = this._newEntry(strike, strike.to);   // one of ours that was in the air when you pressed "Clear all"
    }
    if (e.status === 'done') return;
    e.status = 'done';
    e.result = result || null;
    if (!e.result) {   // the app passed nothing: show an estimate without touching the totals
      try { e.result = this.ctx.casualties.preview({ lat: strike.to.lat, lon: strike.to.lon, yieldKt: e.yieldKt, burst: e.burst }); } catch (err) { e.result = null; }
    }
    if (e.result && e.result.place) e.place = e.result.place;
    e.radii = radiiFor(e.yieldKt, e.burst);
    e.fallout = falloutFor(e.yieldKt, e.burst);
    if (e.marker) { e.marker.remove(); e.marker = null; }
    this._drawRings(e);
    this._last = e;
    this._renderList();
    this._renderResult();
    this._maybeZoom(e);
  };

  CustomMode.prototype._drawRings = function (e) {
    const map = this.ctx.map, L = root.L;
    if (!map || !L) return;
    const group = L.layerGroup();
    const keys = RINGS.filter(k => e.radii[k] > 0).sort((a, b) => e.radii[b] - e.radii[a]);   // biggest first, so smaller rings stay on top
    for (const k of keys) {
      const info = ringInfo(k);
      L.circle([e.at.lat, e.at.lon], {
        pane: PANE, radius: e.radii[k] * 1000,
        color: COLORS[k], weight: k === 'fireball' ? 1 : 1.5, opacity: 0.9,
        fillColor: COLORS[k], fillOpacity: k === 'fireball' ? 0.35 : 0.08,
        className: 'ns-cm-ring ns-cm-ring-' + k,
        bubblingMouseEvents: true   // a click on a ring still drops the next warhead
      }).bindTooltip(`<b>${esc(info.name)}</b> · ${fmtKm(e.radii[k])}<br>${esc(info.text)}`, { className: 'ns-cm-tip', sticky: true, direction: 'top', offset: [0, -8] })
        .addTo(group);
    }
    // Ground zero: a small dot you can click for the whole summary
    const r = e.result || {};
    const rows = RINGS.slice().reverse().filter(k => e.radii[k] > 0).map(k => {
      const info = ringInfo(k);
      return `<tr><td><i class="ns-cm-sw" style="border-color:${COLORS[k]};background:${COLORS[k]}55"></i><b>${esc(info.name)}</b><small>${esc(info.text)}</small></td><td>${fmtKm(e.radii[k])}</td></tr>`;
    }).join('');
    L.circleMarker([e.at.lat, e.at.lon], {
      pane: PANE, radius: 4, color: '#ffffff', weight: 1.5, fillColor: '#ffffff', fillOpacity: 1,
      className: 'ns-cm-gz', bubblingMouseEvents: false
    }).bindPopup(`<div class="ns-cm-pop"><b>${esc(e.place)}</b><br>${fmtYield(e.yieldKt)} ${burstName(e.burst)} · ${fmtClock(e.detAt)}<br>` +
      `Estimated deaths: <b>${fmtInt(r.deaths)}</b> · injuries: <b>${fmtInt(r.injuries)}</b><table>${rows}</table></div>`,
    { className: 'ns-cm-popup', maxWidth: 300 }).addTo(group);
    e.rings = group.addTo(map);
  };

  // If the blast is too small to see at this zoom and nothing else is in the air, fly in to it (after the flash)
  CustomMode.prototype._maybeZoom = function (e) {
    const map = this.ctx.map, L = root.L;
    if (!this.autoZoom || !map || !L || !e.rings) return;
    const outer = Math.max(...RINGS.map(k => e.radii[k]));
    if (!(outer > 0)) return;
    const c = L.latLng(e.at.lat, e.at.lon), b = c.toBounds(outer * 2000);
    const px = map.latLngToContainerPoint(b.getNorthEast()).x - map.latLngToContainerPoint(b.getSouthWest()).x;
    if (px >= 40 || this._entries.some(x => x.status !== 'done')) return;
    clearTimeout(this._zoomTimer);
    this._zoomTimer = setTimeout(() => {
      if (this.enabled && this._last === e && e.rings && !this._entries.some(x => x.status !== 'done')) this._show(e);
    }, 900);
  };

  NS.CustomMode = CustomMode;
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof window !== 'undefined' ? window : globalThis);
