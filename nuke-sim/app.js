// Nuke Sim: the controller. It builds the page from the other modules (scenarios, map layers, renderer,
// casualty model, build-your-own mode and the text in content.js), runs the simulation clock and keeps
// the counters, the phase card, the side panel and the event log up to date.
// Every module is optional: if one fails to load, the page still opens and simply does less.
(function (root) {
  'use strict';
  const NS = root.NS = root.NS || {};
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
  if (typeof document === 'undefined') return;   // loaded in Node for a test: there is no page to run

  // ---------------------------------------------------------------- settings

  // ✏️ EDIT: clock speeds people can pick (sim seconds per real second) and the label shown for each
  const SPEEDS = [[15, '15 s/s'], [30, '30 s/s'], [60, '1 min/s'], [120, '2 min/s'], [300, '5 min/s']];
  const DEFAULT_SPEED = 60;
  const SEEK_STEP = 300;        // ← and → jump this many sim seconds
  const LOG_MAX = 50;           // how many lines the event log keeps
  const GROUP_OVER = 3;         // more detonations than this at once are shown as one grouped log line
  const LOG_FLUSH_MS = 350;     // new detonations are collected for this long (real time) before they go in the log
  const TOP_COUNTRIES = 8;      // rows in "Fatalities by country"
  const MAX_ZOOM = 8;           // how far you can zoom in while watching a scenario
  const MAX_ZOOM_CUSTOM = 12;   // …and in build-your-own mode, so the rings of small bombs are big enough to see
  const MAX_FRAME_S = 0.25;     // a long pause between frames (a hidden tab) never jumps the clock more than this
  const IDLE_MS = 2600;         // while playing, the controls fade away after this long without the mouse moving
  const STORE = { intro: 'nuke-intro-seen', speed: 'nuke-speed', panel: 'nuke-panel-v2' };

  // The effect colors every module shares (see SPEC: renderer, custom rings and legend use the same ones)
  const EFFECT_COLORS = (NS.Effects && NS.Effects.COLORS) ||
    { fireball: '#fff4c2', psi20: '#ff2d2d', psi5: '#ff8a1f', thermal: '#ffd23f', psi1: '#9ca3af', fallout: '#a855f7' };
  const NEUTRAL_BAR = '#9ca3af';

  // Used only if content.js did not load
  const FALLBACK_CONTENT = {
    intro: {
      title: 'What a nuclear war could do',
      paragraphs: [
        'This is a simulation of a nuclear war on a world map. It exists to show, as plainly as possible, why a nuclear war must never happen.',
        'The scenarios are made up, and the numbers are rough estimates from a simple model.'
      ],
      start: 'Start'
    },
    legend: [
      { key: 'fireball', name: 'Fireball', text: '' }, { key: 'psi20', name: 'Heavy blast (20 psi)', text: '' },
      { key: 'psi5', name: 'Moderate blast (5 psi)', text: '' }, { key: 'thermal', name: 'Heat flash', text: '' },
      { key: 'psi1', name: 'Light blast (1 psi)', text: '' }, { key: 'fallout', name: 'Fallout', text: '' }
    ],
    learn: [], sources: [],
    disclaimer: 'An educational simulation with made-up scenarios. All numbers are rough estimates from a simple model.'
  };

  // ---------------------------------------------------------------- small helpers

  const $ = id => document.getElementById(id);
  const body = document.body;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pad = n => String(n).padStart(2, '0');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Runs fn; if it throws (a module is missing or broken), logs it once and carries on.
  const warned = new Set();
  function safe(label, fn, fallback) {
    try { return fn(); } catch (e) {
      if (!warned.has(label)) { warned.add(label); console.warn('[Nuke Sim] ' + label + ' failed:', e); }
      return fallback;
    }
  }
  function load(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function save(key, v) { try { localStorage.setItem(key, v); } catch (e) { /* private mode: fine */ } }

  const fmtInt = n => Math.round(Math.max(0, n || 0)).toLocaleString('en-US');
  function fmtClock(sec, withSeconds) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return 'T+' + pad(h) + ':' + pad(m) + (withSeconds === false ? '' : ':' + pad(s));
  }
  // 1234567 → "1.2M", 45210 → "45k", 812 → "812"
  function fmtCompact(n) {
    n = Math.max(0, Math.round(n || 0));
    if (n >= 999.5e6) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + 'B';
    if (n >= 999.5e3) return (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M';
    if (n >= 1000) return Math.round(n / 1000) + 'k';
    return String(n);
  }
  // 800 → "800 kt", 1200 → "1.2 Mt", 0.3 → "0.3 kt"
  function fmtYield(kt) {
    kt = Math.max(0, kt || 0);
    if (kt >= 1000) return trim((kt / 1000).toFixed(kt >= 100000 ? 0 : kt >= 10000 ? 1 : 2)) + ' Mt';
    if (kt < 10) return trim(kt.toFixed(1)) + ' kt';
    return Math.round(kt) + ' kt';
  }
  const trim = s => s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  const countryName = cc => (NS.COUNTRIES && NS.COUNTRIES[cc]) || cc || 'Unknown';
  const detAt = s => (+s.launchAt || 0) + (+s.flight || 0);   // when a strike detonates (sim seconds)

  // ---------------------------------------------------------------- the map library is required

  if (typeof root.L === 'undefined') {
    const box = document.createElement('div');
    box.className = 'fatal-msg';
    box.innerHTML = '<div><b>The map could not load.</b><br>Nuke Sim needs an internet connection the first time it opens.<br>' +
      '<button class="btn-ghost" type="button" onclick="location.reload()">Try again</button></div>';
    body.appendChild(box);
    return;
  }
  const L = root.L;
  const CONTENT = Object.assign({}, FALLBACK_CONTENT, NS.CONTENT || {});

  // ---------------------------------------------------------------- the map and the modules

  const map = L.map('map', {
    zoomControl: false, worldCopyJump: true, minZoom: 2, maxZoom: MAX_ZOOM, keyboard: false,   // arrow keys seek the clock instead
    zoomSnap: 0.5, zoomDelta: 0.5, wheelPxPerZoomLevel: 90, attributionControl: true
  });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  map.setView([35, 20], 2, { animate: false });

  let maplayer = null;
  if (NS.MapLayers && NS.MapLayers.init) maplayer = safe('MapLayers.init', () => NS.MapLayers.init(map), null);
  if (!maplayer) {
    // No map layer module: plain darkened satellite tiles so there is still a world to look at
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxNativeZoom: 8, maxZoom: MAX_ZOOM_CUSTOM, className: 'tiles-fallback', attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics'
    }).addTo(map);
  }
  // Credit the data: maplayer.js credits Esri and Natural Earth itself (the borders, once they load); we add the city data
  safe('attribution', () => {
    map.attributionControl.addAttribution('Cities: <a href="https://www.geonames.org/" target="_blank" rel="noopener">GeoNames</a>');
  });

  const NOOP_RENDERER = { setStrikes() {}, addStrike() {}, setSites() {}, setCityDots() {}, setAircraft() {}, detonate() {}, frame() {}, reset() {}, options: {} };
  const renderer = (NS.Renderer && safe('Renderer', () => new NS.Renderer(map), null)) || NOOP_RENDERER;
  if (!renderer.setCityDots) renderer.setCityDots = () => {};
  if (!renderer.setAircraft) renderer.setAircraft = () => {};

  // The automatic camera follows the action like the videos (camera.js). It moves the map through this little
  // adapter; dragging, scrolling or pinching the map hands the camera back to you.
  const director = NS.AutoCamera ? safe('AutoCamera', () => new NS.AutoCamera({
    flyTo(v, ms) { flyToView({ lat: v.lat, lon: v.lon, zoom: v.zoom }, !(ms > 0), ms); },
    onUserMove(cb) { ['pointerdown', 'wheel', 'touchstart'].forEach(ev => map.getContainer().addEventListener(ev, () => cb(), { passive: true })); }
  }), null) : null;

  const NO_RESULT = { deaths: 0, injuries: 0, place: '', cc: '', cities: [] };
  const casualties = (NS.Casualties && safe('Casualties', () => new NS.Casualties(NS.CITIES || []), null)) || (function () {
    // Stand-in when effects.js is missing: counts nothing, but keeps the page running
    return { apply: () => NO_RESULT, preview: () => NO_RESULT, totals: () => ({ deaths: 0, injuries: 0, byCountry: {} }), reset() {} };
  })();

  // ---------------------------------------------------------------- simulation state

  const SCENARIOS = Array.isArray(NS.SCENARIOS) ? NS.SCENARIOS.filter(s => s && s.id) : [];
  let scenarioId = SCENARIOS.length ? SCENARIOS[0].id : '';
  let ns = emptyScenario();     // the built scenario (strikes, phases, view…)
  let mode = 'scenario';        // 'scenario' or 'custom'
  let t = 0;                    // sim time, seconds since T+0
  let running = false;
  let ended = false;
  let speed = DEFAULT_SPEED;

  // The live strikes, plus two sorted copies with moving pointers so each frame only touches what is new
  let strikes = [];
  let byLaunch = [], launchIdx = 0;   // sorted by launch time; launchIdx = how many have launched
  let byDet = [], detIdx = 0;         // sorted by detonation time; detIdx = how many have detonated
  let yieldKt = 0;                    // total yield detonated so far
  let phases = [], phaseIdx = -1;

  let totals = { deaths: 0, injuries: 0, byCountry: {} };
  let totalsDirty = true;
  let shown = { deaths: 0, injuries: 0 };    // what the counter shows right now (it counts up towards totals)
  let pending = [];                           // detonations waiting to be written to the log
  let lastFlush = 0, lastCountries = 0;
  let customSeq = 0;
  let custom = null;                          // the NS.CustomMode instance (made the first time it is needed)
  let savedScenarioT = 0;                     // where the scenario was when we switched to build-your-own
  const detonationListeners = [];

  function emptyScenario() {
    return { id: '', name: 'No scenario', blurb: '', sides: null, strikes: [], phases: [], labels: [], sites: [], view: { lat: 35, lon: 20, zoom: 2 }, end: 7200 };
  }

  // Fills in anything a scenario left out, so the rest of the code can trust its shape
  function normalizeScenario(s, id) {
    const base = emptyScenario();
    if (!s || typeof s !== 'object') return Object.assign(base, { id });
    const out = Object.assign(base, s);
    out.strikes = (Array.isArray(s.strikes) ? s.strikes : []).filter(x => x && x.to && isFinite(x.to.lat) && isFinite(x.to.lon));
    out.phases = (Array.isArray(s.phases) ? s.phases : []).filter(p => p && isFinite(p.at)).slice().sort((a, b) => a.at - b.at);
    out.labels = Array.isArray(s.labels) ? s.labels : [];
    out.sites = Array.isArray(s.sites) ? s.sites : [];
    if (!s.view || !isFinite(s.view.lat)) out.view = base.view;
    if (!isFinite(out.end) || out.end <= 0) {
      const last = out.strikes.reduce((m, x) => Math.max(m, detAt(x)), 0);
      out.end = Math.max(600, Math.ceil((last + 600) / 60) * 60);
    }
    return out;
  }

  // Makes `list` the live strikes (renderer gets its own copy, so adding custom strikes never doubles up)
  function useStrikes(list) {
    strikes = list;
    byLaunch = list.slice().sort((a, b) => (a.launchAt || 0) - (b.launchAt || 0));
    byDet = list.slice().sort((a, b) => detAt(a) - detAt(b));
    launchIdx = 0; detIdx = 0;
    safe('renderer.setStrikes', () => renderer.setStrikes(list.slice()));
  }

  // Puts `item` into an array sorted by key(), never before index `from` (what is already processed stays put)
  function insertSorted(arr, item, key, from) {
    const k = key(item);
    let lo = from, hi = arr.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (key(arr[mid]) <= k) lo = mid + 1; else hi = mid; }
    arr.splice(lo, 0, item);
  }

  // One warhead reaches its target
  function detonate(s, live) {
    const res = safe('casualties.apply', () => casualties.apply({ lat: s.to.lat, lon: s.to.lon, yieldKt: s.yieldKt, burst: s.burst || 'air' }), NO_RESULT) || NO_RESULT;
    safe('renderer.detonate', () => renderer.detonate(s, { instant: !live }));
    yieldKt += +s.yieldKt || 0;
    totalsDirty = true;
    const rec = { s, res, at: detAt(s) };
    if (live) {
      pending.push(rec);
      for (const cb of detonationListeners.slice()) safe('onDetonation callback', () => cb(s, res));
    }
    return rec;
  }

  // Moves the clock forward to `nt`, setting off everything that lands on the way. O(new events) per call.
  function advanceTo(nt) {
    t = nt;
    while (launchIdx < byLaunch.length && (byLaunch[launchIdx].launchAt || 0) <= t) launchIdx++;
    let hit = false;
    while (detIdx < byDet.length && detAt(byDet[detIdx]) <= t) { detonate(byDet[detIdx++], true); hit = true; }
    if (hit) bumpCounter();
    if (mode === 'scenario' && t >= ns.end) finish();
  }

  // Jumps to any time: forget everything, then re-apply every detonation up to there in one go (no animations).
  // In build-your-own mode the clock only moves forward (the rings there belong to custom.js), so it just fast-forwards.
  function seek(nt) {
    nt = clamp(+nt || 0, 0, mode === 'scenario' ? ns.end : Infinity);
    if (mode === 'custom') { if (nt > t) advanceTo(nt); updateClock(); return; }
    resetTo(nt);
  }
  function resetTo(nt) {
    t = nt;
    ended = false;
    safe('casualties.reset', () => casualties.reset());
    safe('renderer.reset', () => renderer.reset());
    launchIdx = 0; detIdx = 0; yieldKt = 0; pending = [];
    const recs = [];
    while (detIdx < byDet.length && detAt(byDet[detIdx]) <= t) {
      recs.push(detonate(byDet[detIdx++], false));
      if (recs.length > 600) recs.splice(0, 300);   // the log only needs the latest ones
    }
    while (launchIdx < byLaunch.length && (byLaunch[launchIdx].launchAt || 0) <= t) launchIdx++;
    rebuildLog(recs);
    totalsDirty = true;
    refreshTotals(true);
    shown.deaths = totals.deaths; shown.injuries = totals.injuries;
    phaseIdx = -2;
    if (mode === 'scenario' && t >= ns.end && ns.end > 0) finish(true);
    else syncPhase(true);
    updateCounterText();
    updateClock();
    updatePlayUi();
    safe('renderer.frame', () => renderer.frame(t));
    if (director && mode === 'scenario') { director.current = -1; safe('camera.update', () => director.update(t, true)); }
  }

  // The scenario reached its end: stop the clock and show the totals in the phase card
  function finish(instant) {
    t = ns.end;
    if (ended) return;
    ended = true;
    running = false;
    flushLog();
    refreshTotals(true);
    showEndCard(instant);
    updatePlayUi();
  }

  function play() {
    if (mode === 'scenario' && (ended || t >= ns.end)) seek(0);
    running = true;
    closeMenu();
    updatePlayUi();
    wake();
  }
  function pause() { running = false; flushLog(); updatePlayUi(); }
  function toggle() { running ? pause() : play(); }
  function restart() {
    if (mode === 'custom') { if (custom) safe('custom.clear', () => custom.clear()); useStrikes([]); resetTo(0); }
    else seek(0);
    play();
  }

  // ---------------------------------------------------------------- scenarios

  function loadScenario(id, opts) {
    opts = opts || {};
    const built = NS.buildScenario ? safe('buildScenario', () => NS.buildScenario(id, { seed: 1 }), null) : null;
    ns = normalizeScenario(built, id);
    scenarioId = id || ns.id;
    if ($('scenario').value !== scenarioId) $('scenario').value = scenarioId;
    if (maplayer) {
      safe('maplayer.setSides', () => maplayer.setSides(ns.sides || null));
      safe('maplayer.setLabels', () => maplayer.setLabels(ns.labels));
    }
    safe('renderer.setSites', () => renderer.setSites(ns.sites));
    safe('renderer.setCityDots', () => renderer.setCityDots(sideCountries(ns)));
    safe('renderer.setAircraft', () => renderer.setAircraft(planAircraft(ns)));
    useStrikes(ns.strikes);
    phases = ns.phases;
    running = false;
    if (director) safe('camera.plan', () => director.plan(ns, { width: Math.max(320, innerWidth - (body.classList.contains('panel-closed') ? 0 : 380)) }));
    resetTo(clamp(+opts.t || 0, 0, ns.end));
    if (!opts.keepView) flyToView(ns.view, opts.instant);
    const meta = SCENARIOS.find(s => s.id === scenarioId) || {};
    $('scenario-name').textContent = ns.name || meta.name || '';
    $('scenario-blurb').textContent = ns.blurb || meta.blurb || '';
    safe('url', () => {
      const u = new URL(location.href);
      if (scenarioId) u.searchParams.set('s', scenarioId); else u.searchParams.delete('s');
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    });
    updatePlayUi();
  }

  // Every country on either side (for the little city dots)
  function sideCountries(sc) {
    const sd = sc && sc.sides;
    if (!sd) return [];
    return [].concat((sd.blue && sd.blue.countries) || [], (sd.red && sd.red.countries) || []);
  }

  // When the first enemy missile is launched, bombers and command planes take off from their bases and fly away
  // to survive (the white planes in the videos). Only a picture: they don't change any numbers.
  function planAircraft(sc) {
    const out = [];
    if (!sc || !sc.sides || !Array.isArray(NS.TARGETS) || !sc.strikes.length) return out;
    const firstBy = { red: Infinity, blue: Infinity };
    sc.strikes.forEach(s => { if (s.launchAt < firstBy[s.side]) firstBy[s.side] = s.launchAt; });
    const rng = NS.rng ? NS.rng('planes-' + sc.id) : Math.random;
    ['blue', 'red'].forEach(side => {
      const list = (sc.sides[side] && sc.sides[side].countries) || [];
      const warned = Math.min(firstBy[side === 'blue' ? 'red' : 'blue'], firstBy[side]);
      if (!isFinite(warned)) return;
      NS.TARGETS.forEach(tg => {
        if (list.indexOf(tg.cc) < 0) return;
        const also = Array.isArray(tg.also) ? tg.also : (tg.also ? [tg.also] : []);
        const bombers = tg.kind === 'bomber-base' || also.indexOf('bomber-base') >= 0;
        const n = bombers ? 6 : tg.kind === 'command' ? 2 : 0;
        for (let i = 0; i < n; i++) {
          out.push({ lat: tg.lat, lon: tg.lon, bearing: rng() * 360, start: warned + 60 + rng() * 420, speed: 760 + rng() * 180, range: 1800 + rng() * 2200 });
        }
      });
    });
    return out;
  }

  // Flies the camera to a scenario's view, keeping the target clear of the side panel
  function flyToView(v, instant, ms) {
    if (!v || !isFinite(v.lat) || !isFinite(v.lon)) return;
    const phone = innerWidth <= 640;
    const zoom = clamp((+v.zoom || 2) - (phone ? 1 : 0), map.getMinZoom(), map.getMaxZoom());
    let center = L.latLng(v.lat, v.lon);
    const panelOpen = !phone && !body.classList.contains('panel-closed');
    if (panelOpen) {
      const shift = ($('panel').offsetWidth + 24) / 2;
      center = map.unproject(map.project(center, zoom).add([shift, 0]), zoom);
    }
    if (instant) map.setView(center, zoom, { animate: false });
    else map.flyTo(center, zoom, { duration: (ms || 1400) / 1000 });
  }

  // ---------------------------------------------------------------- build-your-own mode

  function setMode(m) {
    if (m === mode) return;
    closeMenu();
    if (m === 'custom') {
      savedScenarioT = t;
      flushLog();
      mode = 'custom';
      ended = false;
      body.classList.add('mode-custom');
      map.setMaxZoom(MAX_ZOOM_CUSTOM);
      if (maplayer) {
        safe('maplayer.setSides', () => maplayer.setSides(null));
        safe('maplayer.setLabels', () => maplayer.setLabels([]));
      }
      safe('renderer.setSites', () => renderer.setSites([]));
      safe('renderer.setCityDots', () => renderer.setCityDots([]));
      safe('renderer.setAircraft', () => renderer.setAircraft([]));
      if (director) director.setEnabled(false);
      if (innerWidth > 640) setPanel(true, true);
      useStrikes([]);
      phases = [];
      resetTo(0);
      ensureCustom();
      if (custom) safe('custom.enable', () => custom.enable());
      showCustomCard();
      running = true;          // the clock keeps going so launched missiles fly
    } else {
      if (custom) {
        safe('custom.clear', () => custom.clear());
        safe('custom.disable', () => custom.disable());
      }
      mode = 'scenario';
      body.classList.remove('mode-custom');
      map.setMaxZoom(MAX_ZOOM);   // zooms back out if you were closer than that
      loadScenario(scenarioId, { keepView: true, t: savedScenarioT });
      if (load(STORE.panel) !== 'open') setPanel(false, true);
      if (director) director.setEnabled(true);
    }
    $('mode-scenario').setAttribute('aria-pressed', String(mode === 'scenario'));
    $('mode-custom').setAttribute('aria-pressed', String(mode === 'custom'));
    updatePlayUi();
  }

  function ensureCustom() {
    if (custom) return custom;
    const panel = $('custom-panel');
    if (!NS.CustomMode) {
      panel.innerHTML = '<p class="custom-missing">The build-your-own tools did not load. Try reloading the page.</p>';
      return null;
    }
    custom = safe('CustomMode', () => new NS.CustomMode({
      map, renderer, casualties, panel,
      launch: launchCustom,
      now: () => t,
      onDetonation(cb) {
        if (typeof cb !== 'function') return () => {};
        detonationListeners.push(cb);
        return () => { const i = detonationListeners.indexOf(cb); if (i >= 0) detonationListeners.splice(i, 1); };
      }
    }), null);
    if (!custom) panel.innerHTML = '<p class="custom-missing">The build-your-own tools could not start. Try reloading the page.</p>';
    return custom;
  }

  // A strike from build-your-own mode: it launches now and joins the clock like any other
  function launchCustom(s) {
    if (!s || !s.to || !isFinite(s.to.lat) || !isFinite(s.to.lon)) return null;
    s.launchAt = t;
    if (!isFinite(s.flight) || s.flight < 0) s.flight = 0;
    if (s.id == null) s.id = 'c' + (++customSeq);
    if (!s.side) s.side = 'red';
    strikes.push(s);
    insertSorted(byLaunch, s, x => x.launchAt || 0, launchIdx);
    insertSorted(byDet, s, detAt, detIdx);
    safe('renderer.addStrike', () => renderer.addStrike(s));
    if (!running) { running = true; updatePlayUi(); }
    return s;
  }

  // The panel's "Clear all" button wipes custom's rings and the totals; also drop the missiles still in the air,
  // so after a clear the map, the list and the counters all start from nothing
  $('custom-panel').addEventListener('click', e => {
    if (mode !== 'custom' || !e.target.closest('#custom-clear')) return;
    setTimeout(() => { useStrikes([]); resetTo(t); }, 0);
  });

  // ---------------------------------------------------------------- phase card

  function setCard(kicker, title, text, cls, instant) {
    const card = $('phase');
    const apply = () => {
      $('phase-kicker').textContent = kicker;
      $('phase-title').textContent = title;
      $('phase-text').textContent = text;
      card.classList.toggle('end', cls === 'end');
      card.classList.remove('fade');
      // a new phase stays on screen for a while even when the controls have faded away
      card.classList.add('flash');
      clearTimeout(setCard.flashTimer);
      setCard.flashTimer = setTimeout(() => card.classList.remove('flash'), 9000);
    };
    clearTimeout(setCard.timer);
    if (instant) { apply(); return; }
    card.classList.add('fade');
    setCard.timer = setTimeout(apply, 280);
  }

  // Shows whichever phase the clock is in (forward-only scan each frame; a seek recomputes from scratch)
  function syncPhase(instant) {
    if (mode !== 'scenario' || ended) return;
    let i = Math.max(-1, phaseIdx);   // phaseIdx -2 means "not known yet" (after a seek): scan from the start
    while (i + 1 < phases.length && phases[i + 1].at <= t) i++;
    if (i === phaseIdx) return;
    phaseIdx = i;
    if (i < 0) {
      setCard('Scenario', ns.name || 'Nuke Sim', ns.blurb || 'Press Play to start.', '', instant);
    } else {
      const p = phases[i];
      setCard('Phase ' + (i + 1) + ' of ' + phases.length + ' · ' + fmtClock(p.at, false), p.title || '', p.text || '', '', instant);
    }
  }

  function showEndCard(instant) {
    const n = detIdx;
    const hours = ns.end / 3600;
    const span = hours >= 1 ? (Math.round(hours * 10) / 10) + (hours === 1 ? ' hour' : ' hours') : Math.round(ns.end / 60) + ' minutes';
    setCard('Simulation ended · ' + fmtClock(ns.end), 'Simulation ended',
      'In ' + span + ', ' + fmtInt(n) + (n === 1 ? ' warhead' : ' warheads') + ' detonated (' + fmtYield(yieldKt) + ' in total). ' +
      'Estimated ' + fmtInt(totals.deaths) + ' deaths and ' + fmtInt(totals.injuries) + ' injuries from blast and heat alone. ' +
      'Fallout, fires, the collapse of hospitals, power and food supplies, and the cooling from smoke would kill many more in the weeks and years after.',
      'end', instant);
  }

  function showCustomCard() {
    setCard('Build your own', 'One bomb, one city',
      custom ? 'Pick a yield and burst type in the panel, then click anywhere on the map to drop a warhead and see how far each effect reaches.'
        : 'The build-your-own tools did not load.', '', true);
  }

  // ---------------------------------------------------------------- counters, stats and the country list

  function refreshTotals(force) {
    if (!totalsDirty && !force) return;
    totalsDirty = false;
    const tt = safe('casualties.totals', () => casualties.totals(), null);
    totals = { deaths: +(tt && tt.deaths) || 0, injuries: +(tt && tt.injuries) || 0, byCountry: (tt && tt.byCountry) || {} };
    updateStats();
    updateCountries(true);
  }

  function updateCounterText() {
    $('fatalities-num').textContent = fmtInt(shown.deaths);
    $('injuries-num').textContent = fmtInt(shown.injuries);
  }

  // The counter counts up smoothly towards the real total
  function animateCounter(dt) {
    let changed = false;
    for (const k of ['deaths', 'injuries']) {
      const target = totals[k];
      if (shown[k] === target) continue;
      const step = (target - shown[k]) * Math.min(1, dt * 3.2);
      shown[k] = Math.abs(target - shown[k]) < 1.5 || Math.abs(step) < 0.5 ? target : shown[k] + step;
      changed = true;
    }
    if (changed) updateCounterText();
  }
  function bumpCounter() {
    const c = $('counter');
    c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump');
  }

  let lastStats = '';
  function updateStats() {
    const launched = launchIdx, det = detIdx;
    const key = launched + '|' + det + '|' + yieldKt + '|' + totals.deaths;
    if (key === lastStats) return;
    lastStats = key;
    $('stat-launched').textContent = fmtInt(launched);
    $('stat-flight').textContent = fmtInt(Math.max(0, launched - det));
    $('stat-detonated').textContent = fmtInt(det);
    $('stat-yield').textContent = fmtYield(yieldKt);
    $('sheet-stats').textContent = fmtInt(det) + ' detonated · ' + fmtCompact(totals.deaths) + ' deaths';
    $('log-count').textContent = det ? fmtInt(det) + ' total' : '';
  }

  function sideColor(cc) {
    const sides = mode === 'scenario' && ns.sides;
    if (!sides) return NEUTRAL_BAR;
    for (const k of Object.keys(sides)) {
      const sd = sides[k];
      if (sd && Array.isArray(sd.countries) && sd.countries.includes(cc)) return sd.color || NEUTRAL_BAR;
    }
    return NEUTRAL_BAR;
  }

  let lastCountryKey = '';
  function updateCountries(force) {
    const now = performance.now();
    if (!force && now - lastCountries < 300) return;
    lastCountries = now;
    const rows = Object.keys(totals.byCountry || {})
      .map(cc => ({ cc, deaths: +(totals.byCountry[cc] && totals.byCountry[cc].deaths) || 0 }))
      .filter(r => r.deaths >= 1)
      .sort((a, b) => b.deaths - a.deaths)
      .slice(0, TOP_COUNTRIES);
    const key = rows.map(r => r.cc + Math.round(r.deaths)).join(',');
    if (key === lastCountryKey) return;
    lastCountryKey = key;
    const box = $('by-country');
    if (!rows.length) { box.innerHTML = '<p class="empty">No detonations yet.</p>'; return; }
    const max = rows[0].deaths;
    box.innerHTML = rows.map(r =>
      '<div class="bc-row"><div class="bc-top"><span>' + esc(countryName(r.cc)) + '</span><b>' + fmtCompact(r.deaths) + '</b></div>' +
      '<div class="bc-bar"><i style="width:' + Math.max(1.5, r.deaths / max * 100).toFixed(1) + '%;background:' + esc(sideColor(r.cc)) + '"></i></div></div>'
    ).join('');
  }

  // ---------------------------------------------------------------- event log

  // Where a warhead went off, for the log. The casualty model names the nearest big city ("Moscow, Russia"); when that is
  // only "near X" or "a remote area", the target's own name ("Minot AFB, United States") says more.
  function placeOf(rec) {
    const place = rec.res && rec.res.place, to = rec.s.to || {};
    if (place && !/^(near |a remote)/i.test(place)) return place;
    if (to.name && to.kind !== 'custom') {
      const country = to.cc ? countryName(to.cc) : '';
      return to.name + (country && to.name.indexOf(country) < 0 ? ', ' + country : '');
    }
    return place || to.name || 'Unknown target';
  }

  // Turns a batch of detonations into log lines: a few become one line each, many become one grouped line
  function groupRecords(recs) {
    if (recs.length <= GROUP_OVER) {
      return recs.map(r => ({ at: r.at, count: 1, yieldKt: +r.s.yieldKt || 0, deaths: +r.res.deaths || 0, place: placeOf(r) }));
    }
    const byPlace = new Map();
    let deaths = 0, y = 0;
    for (const r of recs) {
      const d = +r.res.deaths || 0;
      deaths += d; y += +r.s.yieldKt || 0;
      const p = placeOf(r);
      byPlace.set(p, (byPlace.get(p) || 0) + d + 1e-6);
    }
    const places = [...byPlace.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
    return [{ at: recs[0].at, count: recs.length, yieldKt: y, deaths, places }];
  }

  function logItem(e) {
    const li = document.createElement('li');
    const time = '<span class="lt">' + fmtClock(e.at, false) + '</span>';
    const deaths = '<span class="ld" title="Estimated deaths">' + fmtCompact(e.deaths) + '</span>';
    if (e.count === 1) {
      li.innerHTML = time + ' · ' + fmtYield(e.yieldKt) + ' · ' + esc(e.place) + ' · ' + deaths;
    } else {
      const shownPlaces = e.places.slice(0, 2).map(esc).join('; ');
      const more = e.places.length > 2 ? ' and ' + (e.places.length - 2) + ' more' : '';
      li.innerHTML = time + ' · ' + e.count + ' warheads · ' + fmtYield(e.yieldKt) + ' · ' + deaths +
        '<span class="lg">' + shownPlaces + more + '</span>';
    }
    return li;
  }

  function addLogEntries(entries, animate) {
    const log = $('log');
    for (const e of entries) {
      const li = logItem(e);
      if (animate) li.className = 'new';
      log.insertBefore(li, log.firstChild);
    }
    while (log.children.length > LOG_MAX) log.removeChild(log.lastChild);
    $('log-empty').hidden = log.children.length > 0;
  }

  function flushLog() {
    lastFlush = performance.now();
    if (!pending.length) return;
    const batch = pending; pending = [];
    addLogEntries(groupRecords(batch), true);
  }

  // After a seek: rebuild the log from the latest detonations, grouped by sim minute
  function rebuildLog(recs) {
    $('log').innerHTML = '';
    const entries = [];
    let i = 0;
    while (i < recs.length) {
      const minute = Math.floor(recs[i].at / 60);
      let j = i;
      while (j < recs.length && Math.floor(recs[j].at / 60) === minute) j++;
      entries.push(...groupRecords(recs.slice(i, j)));
      i = j;
    }
    addLogEntries(entries.slice(-LOG_MAX), false);
  }

  // ---------------------------------------------------------------- clock and play button

  let lastClock = '';
  function updateClock() {
    const txt = fmtClock(t);
    if (txt !== lastClock) { lastClock = txt; $('clock').textContent = txt; }
    const label = (SPEEDS.find(s => s[0] === speed) || [0, speed + ' s/s'])[1];
    const state = mode === 'custom' ? (running ? 'Build your own · ' + label : 'Paused') :
      ended ? 'Simulation ended' : running ? 'Running · ' + label : (t > 0 ? 'Paused' : 'Ready · press Play');
    if (updateClock.state !== state) { updateClock.state = state; $('clock-sub').textContent = state; }
  }

  function updatePlayUi() {
    const isEnd = mode === 'scenario' && ended;
    body.classList.toggle('running', running);
    body.classList.toggle('ended', isEnd && !running);
    body.classList.toggle('waiting', mode === 'scenario' && !running && !isEnd && t === 0 && introClosed);
    const label = running ? 'Pause' : isEnd ? 'Replay' : 'Play';
    $('play').querySelector('.play-text').textContent = label;
    $('play').setAttribute('aria-label', label);
    updateClock();
  }

  // ---------------------------------------------------------------- the animation loop

  let lastFrame = performance.now();
  function loop(now) {
    const dt = clamp((now - lastFrame) / 1000, 0, MAX_FRAME_S);
    lastFrame = now;
    if (running) advanceTo(mode === 'scenario' ? Math.min(ns.end, t + dt * speed) : t + dt * speed);
    if (pending.length && (now - lastFlush > LOG_FLUSH_MS || !running)) flushLog();
    refreshTotals(false);
    updateStats();
    syncPhase(false);
    animateCounter(dt);
    updateClock();
    safe('renderer.frame', () => renderer.frame(t));
    if (director && mode === 'scenario' && running) safe('camera.update', () => director.update(t, false));
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- building the page

  function fillScenarioSelect() {
    const sel = $('scenario');
    if (!SCENARIOS.length) {
      sel.innerHTML = '<option value="">No scenarios loaded</option>';
      sel.disabled = true;
      return;
    }
    sel.innerHTML = SCENARIOS.map(s => '<option value="' + esc(s.id) + '"' + (s.blurb ? ' title="' + esc(s.blurb) + '"' : '') + '>' + esc(s.name || s.id) + '</option>').join('');
  }

  function fillSpeedSelect() {
    const saved = +load(STORE.speed);
    if (SPEEDS.some(s => s[0] === saved)) speed = saved;
    $('speed').innerHTML = SPEEDS.map(s => '<option value="' + s[0] + '"' + (s[0] === speed ? ' selected' : '') + '>' + esc(s[1]) + '</option>').join('');
  }

  function fillLegend() {
    const items = Array.isArray(CONTENT.legend) ? CONTENT.legend : [];
    $('legend').innerHTML = items.map(it => {
      const c = EFFECT_COLORS[it.key] || NEUTRAL_BAR;
      const shape = it.key === 'fireball' ? ' fill' : it.key === 'fallout' ? ' plume' : '';
      return '<li><i class="sw' + shape + '" style="--c:' + c + '"></i><div><b>' + esc(it.name) + '</b>' + (it.text ? '<span>' + esc(it.text) + '</span>' : '') + '</div></li>';
    }).join('');
  }

  function fillIntro() {
    const intro = CONTENT.intro || FALLBACK_CONTENT.intro;
    $('intro-title').textContent = intro.title || 'Nuke Sim';
    $('intro-body').innerHTML = (intro.paragraphs || []).map(p => '<p>' + esc(p) + '</p>').join('');
    $('intro-start').textContent = intro.start || 'Start';
    $('intro-fine').textContent = CONTENT.disclaimer || '';
  }

  function fillLearn() {
    const learn = Array.isArray(CONTENT.learn) ? CONTENT.learn : [];
    // The learn sections are trusted HTML written in content.js (paragraphs and lists)
    $('learn-body').innerHTML = learn.map(s => '<section class="learn-sec"><h3>' + esc(s.title) + '</h3>' + (s.html || '') + '</section>').join('') ||
      '<section class="learn-sec"><p>The background notes did not load.</p></section>';
    const src = Array.isArray(CONTENT.sources) ? CONTENT.sources : [];
    $('learn-sources').innerHTML = src.map(s => '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.name) + '</a></li>').join('');
    $('learn-disclaimer').textContent = CONTENT.disclaimer || '';
    $('disclaimer').textContent = CONTENT.disclaimer || '';
  }

  // ---------------------------------------------------------------- overlays, menu and panel

  let introClosed = false;
  let lastFocus = null;
  const isOpen = id => !$(id).hidden;
  function openOverlay(id) {
    lastFocus = document.activeElement;
    $(id).hidden = false;
    const btn = $(id).querySelector('button');
    if (btn) btn.focus({ preventScroll: true });
  }
  function closeOverlay(id) {
    const el = $(id);
    if (el.hidden) return;
    el.hidden = true;
    if (lastFocus && lastFocus.focus && lastFocus !== body) safe('focus', () => lastFocus.focus({ preventScroll: true }));
  }

  function startFromIntro() {
    save(STORE.intro, '1');
    closeOverlay('intro');
    introClosed = true;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (mode === 'scenario' && !running && t === 0) setTimeout(() => { if (!running && t === 0 && mode === 'scenario' && !isOpen('learn-panel')) play(); }, 700);
    updatePlayUi();
  }

  function openLearn() { closeMenu(); openOverlay('learn-panel'); }

  function closeMenu() { body.classList.remove('menu-open'); $('menu-btn').setAttribute('aria-expanded', 'false'); }
  function toggleMenu() {
    const open = !body.classList.contains('menu-open');
    body.classList.toggle('menu-open', open);
    $('menu-btn').setAttribute('aria-expanded', String(open));
  }

  function setPanel(open, dontRemember) {
    body.classList.toggle('panel-closed', !open);
    $('panel-toggle').setAttribute('aria-expanded', String(open));
    $('panel-toggle').setAttribute('aria-label', open ? 'Hide the details panel' : 'Show the details panel');
    if (!dontRemember) save(STORE.panel, open ? 'open' : 'closed');
  }

  // While playing, the controls fade away so the map fills the screen like a video; moving the mouse brings them back
  let idleTimer = 0;
  function wake() {
    body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (running && mode === 'scenario' && !body.classList.contains('menu-open') && !document.querySelector('#bar :focus, #panel :focus')) body.classList.add('idle');
    }, IDLE_MS);
  }
  function setCamButton(on) {
    $('cam-btn').setAttribute('aria-pressed', String(!!on));
    $('cam-btn').title = on ? 'The camera follows the action (C to stop)' : 'The camera is yours: click (or press C) to follow the action again';
  }
  function setSheet(open) {
    body.classList.toggle('sheet-open', open);
    $('sheet-head').setAttribute('aria-expanded', String(open));
  }

  function wireUi() {
    $('scenario').addEventListener('change', e => {
      const id = e.target.value;
      e.target.blur();
      if (mode === 'custom') { savedScenarioT = 0; scenarioId = id; setMode('scenario'); flyToView(ns.view); }
      else loadScenario(id);
    });
    $('play').addEventListener('click', toggle);
    $('restart').addEventListener('click', () => { closeMenu(); restart(); });
    $('speed').addEventListener('change', e => {
      speed = +e.target.value || DEFAULT_SPEED;
      save(STORE.speed, String(speed));
      e.target.blur();
      updateClock();
    });
    $('mode-scenario').addEventListener('click', () => setMode('scenario'));
    $('mode-custom').addEventListener('click', () => setMode('custom'));
    $('learn').addEventListener('click', openLearn);
    $('note-learn').addEventListener('click', openLearn);
    $('intro-learn').addEventListener('click', () => { startFromIntro(); openLearn(); });
    $('intro-start').addEventListener('click', startFromIntro);
    $('learn-close').addEventListener('click', () => closeOverlay('learn-panel'));
    $('learn-panel').addEventListener('click', e => { if (e.target === $('learn-panel')) closeOverlay('learn-panel'); });
    $('menu-btn').addEventListener('click', e => { e.stopPropagation(); toggleMenu(); });
    document.addEventListener('click', e => {
      if (body.classList.contains('menu-open') && !e.target.closest('#bar-more, #menu-btn')) closeMenu();
      // A mouse click should not leave focus on a button, so Space keeps meaning play/pause
      const b = e.target.closest && e.target.closest('button');
      if (b && e.detail > 0 && !b.closest('.overlay, #custom-panel')) b.blur();
    });
    $('panel-toggle').addEventListener('click', () => setPanel(body.classList.contains('panel-closed')));
    $('cam-btn').addEventListener('click', () => { if (director) director.setEnabled(!director.enabled); });
    if (director) director.onChange(on => { setCamButton(on); if (on && mode === 'scenario') director.update(t, true); });
    setCamButton(!!director);
    if (!director) $('cam-btn').hidden = true;
    ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => addEventListener(ev, wake, { passive: true }));
    wake();
    $('phase').addEventListener('click', () => $('phase').classList.toggle('open'));   // phones: show the whole phase text
    $('sheet-head').addEventListener('click', () => setSheet(!body.classList.contains('sheet-open')));

    addEventListener('keydown', e => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement;
      const tag = el && el.tagName;
      if (e.key === 'Escape') {
        if (isOpen('learn-panel')) closeOverlay('learn-panel');
        else if (isOpen('intro')) startFromIntro();
        else closeMenu();
        return;
      }
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (el && el.isContentEditable)) return;
      if (isOpen('intro') || isOpen('learn-panel')) return;
      if (e.key === ' ' || e.code === 'Space') {
        if (tag === 'BUTTON' || tag === 'A') return;   // let the focused button do its own thing
        e.preventDefault(); toggle();
      } else if (e.key === 'r' || e.key === 'R') {
        restart();
      } else if ((e.key === 'c' || e.key === 'C') && director && mode === 'scenario') {
        director.setEnabled(!director.enabled);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault(); seek(t - SEEK_STEP);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault(); seek(t + SEEK_STEP);
      }
    });
  }

  // ---------------------------------------------------------------- start up

  fillScenarioSelect();
  fillSpeedSelect();
  fillLegend();
  fillIntro();
  fillLearn();
  wireUi();
  setPanel(load(STORE.panel) === 'open' && innerWidth > 640, true);   // closed by default: the map fills the screen like the videos

  const wanted = safe('url', () => new URLSearchParams(location.search).get('s'), null);
  if (wanted && SCENARIOS.some(s => s.id === wanted)) scenarioId = wanted;
  loadScenario(scenarioId, { instant: true });

  if (load(STORE.intro) === '1') {
    introClosed = true;
    setTimeout(() => { if (!running && t === 0 && mode === 'scenario' && !isOpen('learn-panel')) play(); }, 900);
  } else {
    openOverlay('intro');
  }
  updatePlayUi();
  requestAnimationFrame(now => { lastFrame = now; requestAnimationFrame(loop); });

  // ---------------------------------------------------------------- test hook (used by the automated checks)

  root.NukeSim = {
    get t() { return t; },
    play, pause, seek,
    get running() { return running; },
    get strikes() { return strikes; },
    get detonated() { return detIdx; },   // how many strikes have gone off so far
    totals() {
      refreshTotals(true);
      return { deaths: totals.deaths, injuries: totals.injuries, byCountry: totals.byCountry, launched: launchIdx, detonated: detIdx, yieldKt };
    },
    get mode() { return mode; },
    setMode,
    get scenario() { return ns; },
    get map() { return map; },
    get camera() { return director; },
    get renderer() { return renderer; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
