// Nuke Sim: the Sandbox. You choose which nuclear country fires, what kind of missile, how many warheads and how
// big they are, then click anywhere on the map to fire, or launch a quick strike on a whole country's cities or
// military targets. Missiles fly from the real launch areas (silo fields, submarine patrol areas), each country's
// warheads run out, and with "fire back" on, a country that is hit (or its nuclear ally) launches back at the
// attacker, so you can watch one strike escalate into a full war.
// app.js hands us the map, the clock and the casualty model through `ctx` (the same as Build your own, plus
// setSides / setLabels / flyTo / clearAll); this file is the side panel, the clicks and the war logic.
(function (root) {
  'use strict';
  const NS = root.NS = root.NS || {};

  // ✏️ EDIT: short-range nuclear weapons, which targets.js doesn't count (rough public figures)
  const TACTICAL = { RU: 300, US: 100 };
  const TACTICAL_RANGE_KM = 2500;   // short-range missiles can't reach further than this
  const SUB_RANGE_KM = 3500;        // "best missile" uses a submarine when one patrols closer than this to the target
  // ✏️ EDIT: warheads on one missile (they share a launch), per kind of missile
  const MIRV = { silo: 3, mobile: 1, sub: 4, tactical: 1 };
  // ✏️ EDIT: the yields you can pick (kilotons); "typical" uses each missile's own warhead size from targets.js
  const YIELDS = [
    { kt: 0, name: 'Typical for the missile' },
    { kt: 15, name: '15 kt · Hiroshima bomb' },
    { kt: 100, name: '100 kt · submarine warhead' },
    { kt: 300, name: '300 kt · US ICBM warhead' },
    { kt: 800, name: '800 kt · Russian ICBM warhead' },
    { kt: 5000, name: '5 Mt · large Cold War warhead' },
    { kt: 50000, name: '50 Mt · Tsar Bomba' }
  ];
  // ✏️ EDIT: how many warheads one click or quick strike fires
  const COUNTS = [1, 3, 10, 50, 200, 500, 'all'];
  const RETALIATE_SHARE = 0.3;      // a country firing back uses this share of what it has left (at least RETALIATE_MIN)
  const RETALIATE_MIN = 10;
  const RETALIATE_GAP = 600;        // sim seconds before the same country fires back at the same enemy again
  const MAX_LABELS = 90;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmtInt = n => Math.round(Math.max(0, +n || 0)).toLocaleString('en-US');
  const pad = n => String(n).padStart(2, '0');
  const fmtClock = s => { s = Math.max(0, Math.round(+s || 0)); return `T+${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };
  const fmtYield = kt => kt >= 1000 ? `${+(kt / 1000).toFixed(2)} Mt` : `${Math.round(kt)} kt`;
  const name = cc => (NS.COUNTRIES && NS.COUNTRIES[cc]) || cc;
  const theName = cc => ({ US: 'the United States', GB: 'the United Kingdom', NL: 'the Netherlands', PH: 'the Philippines', AE: 'the United Arab Emirates', CZ: 'the Czech Republic' }[cc] || name(cc));
  function distKm(a, b) {
    if (NS.Effects && NS.Effects.distanceKm) return NS.Effects.distanceKm(a, b);
    const R = 6371, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function flightSeconds(from, to, kind) {
    let t = NaN;
    try { if (NS.Effects && NS.Effects.flightTime) t = +NS.Effects.flightTime(from, to, kind); } catch (e) { /* guess below */ }
    if (Number.isFinite(t) && t > 0) return t;
    const d = distKm(from, to);
    return kind === 'sub' ? 480 + d * 0.15 : kind === 'tactical' ? 120 + d * 0.3 : 1500 + d * 0.035;
  }
  // A point `km` away in a random direction (warheads aimed at one place land a little apart)
  function jitter(p, km, rng) {
    if (!(km > 0)) return { lat: p.lat, lon: p.lon };
    const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * km;
    return { lat: p.lat + Math.sin(a) * d / 111, lon: p.lon + Math.cos(a) * d / (111 * Math.max(0.15, Math.cos(p.lat * Math.PI / 180))) };
  }

  // ---------- who is on which side ----------
  const nuclear = () => Object.keys(NS.ARSENALS || {});
  const allies = key => ((NS.ALLIANCES && NS.ALLIANCES[key]) || []);
  function blocOf(cc) {
    if (allies('NATO').indexOf(cc) >= 0) return 'NATO';
    if (allies('RU').indexOf(cc) >= 0) return 'RU';
    if (allies('CN').indexOf(cc) >= 0) return 'CN';
    return cc;
  }
  function blocCountries(bloc) {
    if (bloc === 'NATO' || bloc === 'RU' || bloc === 'CN') return allies(bloc).slice();
    return [bloc];
  }
  function blocName(bloc) { return bloc === 'NATO' ? 'NATO' : name(bloc === 'RU' ? 'RU' : bloc === 'CN' ? 'CN' : bloc); }
  // The nuclear country that answers for a country that was hit: itself, or its bloc's (NATO: US, UK, France)
  function responderFor(cc, left) {
    if (left[cc] > 0) return cc;
    const bloc = blocOf(cc);
    const order = bloc === 'NATO' ? ['US', 'GB', 'FR'] : bloc === 'RU' ? ['RU'] : bloc === 'CN' ? ['CN'] : [];
    return order.find(c => left[c] > 0) || null;
  }

  // ---------- the look ----------
  const CSS = `
.sb-hint{margin:0 0 10px;line-height:1.4;opacity:.85}
.sb-field{display:block;margin:0 0 8px}
.sb-field>span{display:block;font-size:.8em;opacity:.7;margin:0 0 3px}
.sb-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.sb-ctl{width:100%;height:32px;border-radius:8px;border:1px solid var(--line-2,rgba(255,255,255,.2));background-color:rgba(255,255,255,.04);color:inherit;font:inherit;font-size:13px;padding:0 10px;cursor:pointer;min-width:0}
.sb-ctl:hover{background-color:rgba(255,255,255,.08)}
.sb-ctl:focus-visible{outline:2px solid var(--accent,#ffb547);outline-offset:1px}
select.sb-ctl{appearance:none;-webkit-appearance:none;padding-right:28px;text-overflow:ellipsis;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%238d929b' stroke-width='1.6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center}
select.sb-ctl option{background:#101318;color:#ecebe7}
.sb-quick{border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:10px 12px;background:rgba(255,255,255,.04);margin:4px 0 10px}
.sb-quick-btns{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px}
.sb-btn{height:32px;border-radius:8px;border:1px solid rgba(255,90,60,.5);background:rgba(255,60,30,.14);color:#ffd2c4;font:inherit;font-size:13px;font-weight:600;cursor:pointer}
.sb-btn:hover{background:rgba(255,60,30,.24)}
.sb-btn:disabled{opacity:.4;cursor:default}
.sb-check{display:flex;gap:8px;align-items:flex-start;margin:8px 0 12px;cursor:pointer;line-height:1.35}
.sb-check input{margin:2px 0 0;flex:0 0 auto;accent-color:var(--accent,#ffb547)}
.sb-note{min-height:1.3em;margin:0 0 10px;font-size:12.5px;color:#ffcf8a;line-height:1.4}
.sb-ars{width:100%;border-collapse:collapse;font-size:12.5px;margin:2px 0 10px}
.sb-ars td{padding:3px 0;border-bottom:1px solid rgba(255,255,255,.06)}
.sb-ars td:last-child{text-align:right;font-family:var(--mono,ui-monospace,monospace);font-variant-numeric:tabular-nums}
.sb-ars tr.on td:first-child{color:#ffd69a;font-weight:600}
.sb-bar{display:block;height:3px;border-radius:2px;background:rgba(255,255,255,.08);margin-top:3px;overflow:hidden}
.sb-bar i{display:block;height:100%;background:#ff7a45}
.sb-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:6px 0 6px;font-size:12px;opacity:.75;text-transform:uppercase;letter-spacing:.1em}
.sb-log{list-style:none;margin:0 0 10px;padding:0;max-height:180px;overflow:auto;font-size:12.5px;line-height:1.4}
.sb-log li{padding:4px 0;border-bottom:1px solid rgba(255,255,255,.06)}
.sb-log b{font-family:var(--mono,ui-monospace,monospace);font-weight:500;color:#9aa0aa;margin-right:6px}
.sb-log .sb-back{color:#ffb09a}
.sb-clear{height:30px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.04);color:inherit;font:inherit;font-size:12.5px;padding:0 10px;cursor:pointer}
.sb-on .leaflet-container,.leaflet-container.sb-on{cursor:crosshair}
`;
  function addStyles() {
    if (typeof document === 'undefined' || document.getElementById('ns-sandbox-css')) return;
    const s = document.createElement('style');
    s.id = 'ns-sandbox-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  let nextId = 1;

  function SandboxMode(ctx) {
    this.ctx = ctx || {};
    this.enabled = false;
    this.attacker = 'RU';
    this.weapon = 'auto';
    this.count = 10;
    this.yieldKt = 0;
    this.burst = 'auto';
    this.target = 'US';
    this.retaliate = true;
    this.rng = NS.rng ? NS.rng('sandbox') : Math.random;
    this._reset();
    this._onClick = this._onClick.bind(this);
    if (typeof this.ctx.onDetonation === 'function') this.ctx.onDetonation((s, res) => this._onDetonation(s, res));
  }

  SandboxMode.TACTICAL = TACTICAL;
  SandboxMode.blocOf = blocOf;

  // Full arsenals again, nothing involved yet
  SandboxMode.prototype._reset = function () {
    const A = NS.ARSENALS || {};
    this.total = {}; this.left = {}; this.pools = {};
    nuclear().forEach(cc => {
      const a = A[cc] || {};
      const pool = { silo: +(a.icbm && a.icbm.warheads) || 0, sub: +(a.slbm && a.slbm.warheads) || 0, tactical: TACTICAL[cc] || 0 };
      this.pools[cc] = pool;
      this.total[cc] = this.left[cc] = pool.silo + pool.sub + pool.tactical;
    });
    this.involved = new Set();
    this.firstPair = null;
    this.lastBack = {};
    this.hitLabels = [];
    this.log = [];
    this.fired = 0;
  };

  SandboxMode.prototype.enable = function () {
    if (this.enabled) return;
    this.enabled = true;
    addStyles();
    this._build();
    const map = this.ctx.map;
    if (map && map.on) {
      map.on('click', this._onClick);
      this._hadDbl = !!(map.doubleClickZoom && map.doubleClickZoom.enabled());
      if (this._hadDbl) map.doubleClickZoom.disable();
      map.getContainer().classList.add('sb-on');
    }
    this._showSides();
  };

  SandboxMode.prototype.disable = function () {
    const map = this.ctx.map;
    if (this.enabled && map && map.off) {
      map.off('click', this._onClick);
      if (this._hadDbl && map.doubleClickZoom) map.doubleClickZoom.enable();
      map.getContainer().classList.remove('sb-on');
    }
    this.enabled = false;
    clearTimeout(this._labelTimer);
    if (this.ctx.panel) this.ctx.panel.innerHTML = '';
    this.el = null;
  };

  // Forget everything: full arsenals, no sides, an empty log (the app clears the missiles and the counters)
  SandboxMode.prototype.clear = function () {
    this._reset();
    if (this.enabled) { this._showSides(); this._render(); this._note(''); }
  };

  // ---------- the panel ----------
  SandboxMode.prototype._build = function () {
    const panel = this.ctx.panel;
    if (!panel) { this.el = null; return; }
    const opt = (v, label, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
    const countries = Object.keys(NS.COUNTRIES || {}).sort((a, b) => name(a).localeCompare(name(b)));
    panel.innerHTML = `
<p class="sb-hint">Choose who fires, then click anywhere on the map to launch, or use a quick strike on a whole country. Every country's warheads run out.</p>
<label class="sb-field"><span>Fired by</span><select id="sb-attacker" class="sb-ctl">${nuclear().map(cc => opt(cc, name(cc), cc === this.attacker)).join('')}</select></label>
<label class="sb-field"><span>Missile</span><select id="sb-weapon" class="sb-ctl">
${opt('auto', 'Best missile for the target', this.weapon === 'auto')}${opt('silo', 'Long-range missile (ICBM) from silos', this.weapon === 'silo')}${opt('sub', 'Missile from a submarine', this.weapon === 'sub')}${opt('tactical', 'Short-range missile', this.weapon === 'tactical')}</select></label>
<div class="sb-row">
<label class="sb-field"><span>Warheads per launch</span><select id="sb-count" class="sb-ctl">${COUNTS.map(c => opt(c, c === 'all' ? 'Everything left' : fmtInt(c), c === this.count)).join('')}</select></label>
<label class="sb-field"><span>Burst</span><select id="sb-burst" class="sb-ctl">${opt('auto', 'Auto', this.burst === 'auto')}${opt('air', 'Airburst', this.burst === 'air')}${opt('ground', 'Surface burst', this.burst === 'ground')}</select></label>
</div>
<label class="sb-field"><span>Warhead size</span><select id="sb-yield" class="sb-ctl">${YIELDS.map(y => opt(y.kt, y.name, y.kt === this.yieldKt)).join('')}</select></label>
<div class="sb-quick">
<label class="sb-field" style="margin:0"><span>Quick strike on</span><select id="sb-target" class="sb-ctl">${countries.map(cc => opt(cc, name(cc), cc === this.target)).join('')}</select></label>
<div class="sb-quick-btns"><button type="button" class="sb-btn" data-q="cities">Cities</button><button type="button" class="sb-btn" data-q="military">Military</button><button type="button" class="sb-btn" data-q="both">Both</button></div>
</div>
<label class="sb-check"><input type="checkbox" id="sb-retaliate"${this.retaliate ? ' checked' : ''}> <span>Countries fire back when they (or their allies) are hit</span></label>
<p class="sb-note" id="sb-note" aria-live="polite"></p>
<div class="sb-head"><span>Warheads left</span></div>
<table class="sb-ars" id="sb-arsenals"></table>
<div class="sb-head"><span>What happened</span><button type="button" class="sb-clear" id="sb-clear">Clear all</button></div>
<ol class="sb-log" id="sb-log"></ol>`;
    const $ = sel => panel.querySelector(sel);
    this.el = { attacker: $('#sb-attacker'), weapon: $('#sb-weapon'), count: $('#sb-count'), burst: $('#sb-burst'), yield: $('#sb-yield'),
      target: $('#sb-target'), retaliate: $('#sb-retaliate'), note: $('#sb-note'), ars: $('#sb-arsenals'), log: $('#sb-log'), clear: $('#sb-clear') };
    const el = this.el;
    el.attacker.addEventListener('change', () => {
      this.attacker = el.attacker.value;
      if (this.target === this.attacker || blocOf(this.target) === blocOf(this.attacker)) {
        this.target = blocOf(this.attacker) === 'NATO' ? 'RU' : 'US';
        el.target.value = this.target;
      }
      this._showSides(); this._render();
    });
    el.weapon.addEventListener('change', () => { this.weapon = el.weapon.value; });
    el.count.addEventListener('change', () => { this.count = el.count.value === 'all' ? 'all' : +el.count.value; });
    el.burst.addEventListener('change', () => { this.burst = el.burst.value; });
    el.yield.addEventListener('change', () => { this.yieldKt = +el.yield.value || 0; });
    el.target.addEventListener('change', () => { this.target = el.target.value; });
    el.retaliate.addEventListener('change', () => { this.retaliate = el.retaliate.checked; });
    panel.querySelectorAll('.sb-btn').forEach(b => b.addEventListener('click', () => this.quickStrike(this.target, b.dataset.q)));
    el.clear.addEventListener('click', () => { if (typeof this.ctx.clearAll === 'function') this.ctx.clearAll(); this.clear(); });
    this._render();
  };

  SandboxMode.prototype._note = function (text) { if (this.el) this.el.note.textContent = text || ''; };

  SandboxMode.prototype._render = function () {
    const el = this.el;
    if (!el) return;
    el.ars.innerHTML = nuclear().map(cc => {
      const left = this.left[cc], tot = this.total[cc] || 1;
      return `<tr class="${cc === this.attacker ? 'on' : ''}"><td>${esc(name(cc))}<span class="sb-bar"><i style="width:${(100 * left / tot).toFixed(1)}%"></i></span></td><td>${fmtInt(left)} of ${fmtInt(tot)}</td></tr>`;
    }).join('');
    el.log.innerHTML = this.log.slice(-40).reverse().map(l => `<li${l.back ? ' class="sb-back"' : ''}><b>${fmtClock(l.at)}</b>${esc(l.text)}</li>`).join('') ||
      '<li style="opacity:.6">Nothing fired yet.</li>';
    el.target.querySelectorAll('option').forEach(o => { o.disabled = blocOf(o.value) === blocOf(this.attacker) && o.value !== this.target; });
  };

  // ---------- sides and labels on the map ----------
  SandboxMode.prototype._showSides = function () {
    if (typeof this.ctx.setSides !== 'function') return;
    const pair = this.firstPair || { a: blocOf(this.attacker), b: null };
    const sideOf = bloc => ({ name: blocName(bloc), countries: blocCountries(bloc) });
    // like the videos: NATO is blue and its enemy red; otherwise the attacker is red
    let red = pair.a, blue = pair.b;
    if (red === 'NATO') { red = pair.b; blue = pair.a; }
    const sides = {};
    if (blue) sides.blue = sideOf(blue);
    if (red) sides.red = sideOf(red);
    try { this.ctx.setSides(Object.keys(sides).length ? sides : null); } catch (e) { console.error(e); }
    this._showLabels();
  };

  SandboxMode.prototype._showLabels = function () {
    if (typeof this.ctx.setLabels !== 'function') return;
    clearTimeout(this._labelTimer);
    this._labelTimer = setTimeout(() => {
      const inv = new Set();
      this.involved.forEach(cc => blocCountries(blocOf(cc)).forEach(c => inv.add(c)));
      inv.add(this.attacker);
      const list = [];
      (NS.TARGETS || []).forEach(t => { if (t.major && inv.has(t.cc)) list.push({ lat: t.lat, lon: t.lon, text: t.name, major: true }); });
      // the biggest city of each country involved (cities are sorted biggest first)
      const seen = new Set();
      (NS.CITIES || []).forEach(c => { if (inv.has(c[1]) && !seen.has(c[1])) { seen.add(c[1]); list.push({ lat: c[2], lon: c[3], text: c[0], major: true }); } });
      this.hitLabels.forEach(h => list.push(h));
      try { this.ctx.setLabels(list.slice(0, MAX_LABELS)); } catch (e) { console.error(e); }
    }, 250);
  };

  // ---------- firing ----------
  // Where a missile of this kind would come from, for a target. Returns { from, kind } or null.
  SandboxMode.prototype._launcher = function (cc, to, want) {
    const pool = this.pools[cc] || {};
    const fields = (NS.SILO_FIELDS || []).filter(f => f.side === cc);
    const subs = (NS.SUB_AREAS || []).filter(a => a.side === cc);
    const pick = kind => {
      if (!(pool[kind] > 0)) return null;
      if (kind === 'silo' && fields.length) {
        const f = fields[Math.floor(this.rng() * fields.length)];
        const pts = NS.siloPoints ? NS.siloPoints(f) : null;
        const p = pts && pts.length ? pts[Math.floor(this.rng() * pts.length)] : f;
        return { from: { lat: +p.lat, lon: +p.lon, name: f.name, kind: f.type === 'mobile' ? 'mobile' : 'silo' }, kind: 'silo' };
      }
      if (kind === 'sub' && subs.length) {
        let best = subs[0];
        subs.forEach(a => { if (distKm(a, to) < distKm(best, to)) best = a; });
        const p = jitter(best, Math.min(best.spreadKm || 400, 600), this.rng);
        return { from: { lat: p.lat, lon: p.lon, name: 'Submarine, ' + best.name, kind: 'sub' }, kind: 'sub' };
      }
      if (kind === 'tactical') {
        // launched from the nearest place in the attacker's own bloc (Kaliningrad and Belarus for Russia, Europe for the US)
        let best = null, bd = Infinity;
        const own = blocCountries(blocOf(cc));
        for (const c of NS.CITIES || []) {
          if (own.indexOf(c[1]) < 0) continue;
          const d = distKm({ lat: c[2], lon: c[3] }, to);
          if (d < bd && d > 150) { bd = d; best = c; }
        }
        if (!best || bd > TACTICAL_RANGE_KM) return null;
        return { from: { lat: best[2], lon: best[3], name: 'Short-range launcher near ' + best[0], kind: 'tactical' }, kind: 'tactical' };
      }
      return null;
    };
    if (want && want !== 'auto') return pick(want);
    // best: a submarine close to the target, then silos, then any submarine, then short range
    const nearSub = subs.some(a => distKm(a, to) < SUB_RANGE_KM);
    return (nearSub && pick('sub')) || pick('silo') || pick('sub') || pick('tactical');
  };

  SandboxMode.prototype._yield = function (cc, kind) {
    if (this.yieldKt > 0) return this.yieldKt;
    const a = (NS.ARSENALS || {})[cc] || {};
    const leg = kind === 'sub' ? a.slbm : kind === 'tactical' ? null : a.icbm;
    const ys = leg && leg.yields && leg.yields.length ? leg.yields : kind === 'tactical' ? [10, 50] : [100, 300];
    return ys[Math.floor(this.rng() * ys.length)];
  };

  // Fire warheads from `cc` at a list of aim points [{ lat, lon, name, cc, kind }]. Returns how many were fired.
  SandboxMode.prototype.fire = function (cc, aims, opts) {
    opts = opts || {};
    if (!aims.length) return 0;
    if (!(this.left[cc] > 0)) { this._note(`${name(cc)} has no warheads left.`); return 0; }
    const now = +(this.ctx.now && this.ctx.now()) || 0;
    const side = blocOf(cc) === 'NATO' ? 'blue' : 'red';
    let fired = 0, missile = null, onMissile = 0, launchAt = now, kinds = {};
    const want = opts.weapon || this.weapon;
    for (const aim of aims) {
      if (!(this.left[cc] > 0)) break;
      // a new missile when the last one is full (warheads on one missile share its launch)
      if (!missile || onMissile >= (MIRV[missile.from.kind] || 1)) {
        missile = this._launcher(cc, aim, want);   // only the kind you picked (none left or out of range: nothing fires)
        if (!missile) break;
        onMissile = 0;
        if (fired) launchAt += 3 + this.rng() * 9;   // missiles leave a few seconds apart
      }
      const kind = missile.kind;
      this.pools[cc][kind]--;
      this.left[cc]--;
      kinds[kind] = (kinds[kind] || 0) + 1;
      onMissile++;
      const military = aim.kind === 'military' || aim.kind === 'silo' || aim.kind === 'icbm-field';
      const burst = this.burst === 'auto' ? (military ? 'ground' : 'air') : this.burst;
      const flight = flightSeconds(missile.from, aim, missile.from.kind) * (0.96 + this.rng() * 0.08);
      const strike = {
        id: 2000000 + nextId++, side, from: Object.assign({}, missile.from),
        to: { lat: aim.lat, lon: aim.lon, name: aim.name || '', cc: aim.cc || '', kind: aim.kind || 'custom' },
        launchAt: Math.round(launchAt * 10) / 10, flight: Math.round(flight), yieldKt: this._yield(cc, kind), burst,
        sandbox: true, fromCc: cc
      };
      try { if (typeof this.ctx.launch === 'function') this.ctx.launch(strike); } catch (e) { console.error(e); }
      fired++;
    }
    if (fired) {
      this.fired += fired;
      if (!this.firstPair && opts.targetCc && blocOf(opts.targetCc) !== blocOf(cc)) this.firstPair = { a: blocOf(cc), b: blocOf(opts.targetCc) };
      this.involved.add(cc);
      if (opts.targetCc) this.involved.add(opts.targetCc);
      const how = kinds.sub && !kinds.silo ? 'from submarines' : kinds.tactical && !kinds.silo && !kinds.sub ? 'on short-range missiles' : '';
      this.log.push({ at: now, back: !!opts.back, text: (opts.back ? `${name(cc)} fires back: ` : `${name(cc)} launches `) + `${fmtInt(fired)} warhead${fired === 1 ? '' : 's'}${how ? ' ' + how : ''} at ${opts.what || 'the map'}.` });
      this._showSides();
      this._note(this.left[cc] > 0 ? '' : `${name(cc)} has now fired every warhead it had.`);
    } else if (want === 'tactical' && (this.pools[cc] || {}).tactical > 0) {
      this._note(`That's out of range of ${theName(cc)}'s short-range missiles (about ${fmtInt(TACTICAL_RANGE_KM)} km). Pick another missile.`);
    } else if (want !== 'auto') {
      this._note(`${name(cc)} has no ${want === 'sub' ? 'submarine missiles' : want === 'silo' ? 'missiles in silos' : 'short-range missiles'} left. Pick another missile.`);
    } else {
      this._note(`${name(cc)} has no warheads left.`);
    }
    this._render();
    return fired;
  };

  SandboxMode.prototype._howMany = function (cc) {
    const left = this.left[cc] || 0;
    return this.count === 'all' ? left : Math.min(left, +this.count || 1);
  };

  // A click on the map: the chosen number of warheads at that spot (a few km apart)
  SandboxMode.prototype._onClick = function (ev) {
    if (!this.enabled || !ev || !ev.latlng) return;
    const w = ev.latlng.wrap ? ev.latlng.wrap() : ev.latlng;
    this.fireAt({ lat: w.lat, lon: w.lng });
  };
  SandboxMode.prototype.fireAt = function (p) {
    const cc = this.attacker, n = this._howMany(cc);
    if (!n) { this._note(`${name(cc)} has no warheads left.`); return 0; }
    let place = null;
    try { if (this.ctx.casualties && this.ctx.casualties.preview) place = this.ctx.casualties.preview({ lat: p.lat, lon: p.lon, yieldKt: 100, burst: 'air' }); } catch (e) { place = null; }
    const where = (place && place.place) || `${Math.abs(p.lat).toFixed(1)}°${p.lat >= 0 ? 'N' : 'S'}, ${Math.abs(p.lon).toFixed(1)}°${p.lon >= 0 ? 'E' : 'W'}`;
    const tcc = (place && place.cc) || '';
    const spread = n > 1 ? Math.min(60, 4 + Math.sqrt(n) * 3) : 0;
    const aims = [];
    for (let i = 0; i < n; i++) { const q = i ? jitter(p, spread, this.rng) : p; aims.push({ lat: q.lat, lon: q.lon, name: where, cc: tcc, kind: 'custom' }); }
    return this.fire(cc, aims, { targetCc: tcc && blocOf(tcc) !== blocOf(cc) ? tcc : null, what: where });
  };

  // Aim points in a country: its biggest cities (more warheads on bigger ones) and/or its military targets
  SandboxMode.prototype.aimsIn = function (cc, what, n) {
    const mil = [], cities = [];
    if (what !== 'cities') {
      (NS.TARGETS || []).filter(t => t.cc === cc).forEach(t => mil.push({ lat: t.lat, lon: t.lon, name: t.name, cc, kind: t.kind === 'icbm-base' ? 'silo' : 'military', w: t.major ? 2 : 1 }));
      (NS.SILO_FIELDS || []).filter(f => f.side === cc).forEach(f => {
        const pts = NS.siloPoints ? NS.siloPoints(f) : [];
        pts.forEach(p => mil.push({ lat: p.lat, lon: p.lon, name: f.name, cc, kind: 'silo', w: 1 }));
      });
    }
    if (what !== 'military') {
      (NS.CITIES || []).filter(c => c[1] === cc).slice(0, 400).forEach(c => cities.push({ lat: c[2], lon: c[3], name: c[0], cc, kind: 'city', pop: c[4] }));
    }
    const out = [];
    const takeMil = what === 'military' ? n : what === 'both' ? Math.round(n * 0.45) : 0;
    // military: majors first, then silos, one each, round and round
    const milSorted = mil.sort((a, b) => b.w - a.w);
    for (let i = 0; i < takeMil && milSorted.length; i++) out.push(milSorted[i % milSorted.length]);
    // cities: share the rest by population (big cities get several, spread across them)
    const rest = n - out.length;
    if (rest > 0 && cities.length) {
      const weights = cities.map(c => Math.pow(c.pop, 0.75)), sum = weights.reduce((a, b) => a + b, 0);
      const share = cities.map((c, i) => ({ c, k: rest * weights[i] / sum }));
      let given = 0;
      share.forEach(s => { s.n = Math.floor(s.k); given += s.n; });
      share.sort((a, b) => (b.k - b.n) - (a.k - a.n));
      for (let i = 0; given < rest; i++, given++) share[i % share.length].n++;
      share.sort((a, b) => b.c.pop - a.c.pop);
      share.forEach(s => {
        const spread = 3 + Math.sqrt(s.c.pop / 1e6) * 8;
        for (let i = 0; i < s.n; i++) { const q = i ? jitter(s.c, spread, this.rng) : s.c; out.push({ lat: q.lat, lon: q.lon, name: s.c.name, cc, kind: 'city' }); }
      });
    } else if (rest > 0 && milSorted.length) {
      for (let i = 0; i < rest; i++) out.push(milSorted[(takeMil + i) % milSorted.length]);
    }
    return out;
  };

  SandboxMode.prototype.quickStrike = function (cc, what) {
    const from = this.attacker;
    if (!cc) return 0;
    if (blocOf(cc) === blocOf(from)) { this._note(`${name(from)} won't strike its own side. Pick another country.`); return 0; }
    const n = this._howMany(from);
    if (!n) { this._note(`${name(from)} has no warheads left.`); return 0; }
    const aims = this.aimsIn(cc, what, n);
    if (!aims.length) { this._note(`There's nothing to aim at in ${theName(cc)} in this model (no cities over 50,000 or bases).`); return 0; }
    const words = { cities: 'cities in ', military: 'military targets in ', both: '' }[what] || '';
    const fired = this.fire(from, aims, { targetCc: cc, what: words + theName(cc) });
    if (fired && typeof this.ctx.flyTo === 'function') {
      // show the country being hit
      let lat = 0, lon = 0, x = 0, y = 0;
      aims.slice(0, 200).forEach(a => { lat += a.lat; x += Math.cos(a.lon * Math.PI / 180); y += Math.sin(a.lon * Math.PI / 180); });
      lat /= Math.min(200, aims.length); lon = Math.atan2(y, x) * 180 / Math.PI;
      const span = Math.max(...aims.slice(0, 200).map(a => distKm(a, { lat, lon })));
      try { this.ctx.flyTo({ lat, lon, zoom: span > 2500 ? 3 : span > 1200 ? 4 : span > 500 ? 5 : 6 }); } catch (e) { /* the map just stays */ }
    }
    return fired;
  };

  // ---------- a warhead lands: labels for hard-hit places, and maybe the other side fires back ----------
  SandboxMode.prototype._onDetonation = function (s, res) {
    if (!this.enabled || !s || !s.sandbox) return;
    const deaths = +(res && res.deaths) || 0;
    if (deaths > 50000 && res.cities && res.cities[0] && this.hitLabels.length < 40) {
      const c = res.cities[0];
      const city = (NS.CITIES || []).find(x => x[0] === c.name && x[1] === c.cc);
      if (city && !this.hitLabels.some(h => h.text === city[0])) { this.hitLabels.push({ lat: city[2], lon: city[3], text: city[0], major: false }); this._showLabels(); }
    }
    if (!this.retaliate) return;
    const hit = s.to.cc || (res && res.cc) || '';
    if (!hit || blocOf(hit) === blocOf(s.fromCc)) return;
    const who = responderFor(hit, this.left);
    if (!who || blocOf(who) === blocOf(s.fromCc)) return;
    const now = +(this.ctx.now && this.ctx.now()) || 0, key = who + '>' + s.fromCc;
    if (this.lastBack[key] != null && now - this.lastBack[key] < RETALIATE_GAP) return;
    this.lastBack[key] = now;
    const n = Math.min(this.left[who], Math.max(RETALIATE_MIN, Math.round(this.left[who] * RETALIATE_SHARE)));
    const target = s.fromCc;
    const aims = this.aimsIn(target, 'both', n);
    // a few seconds later: deciding to fire back takes a moment
    setTimeout(() => {
      if (!this.enabled) return;
      const saved = { weapon: this.weapon, burst: this.burst, yieldKt: this.yieldKt };
      this.burst = 'auto'; this.yieldKt = 0;
      this.fire(who, aims, { back: true, weapon: 'auto', targetCc: target, what: theName(target) + (hit !== who ? ` (for ${name(hit)})` : '') });
      Object.assign(this, saved);
    }, 400);
  };

  NS.SandboxMode = SandboxMode;
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof window !== 'undefined' ? window : globalThis);
