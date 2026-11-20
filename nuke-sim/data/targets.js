// Nuke Sim: the places that would be targeted, where missiles would launch from, and rough arsenal sizes.
// Everything here is public, Wikipedia-level information. Coordinates are approximate (within ~10–20 km)
// and silo fields are an ILLUSTRATIVE random scatter around each base area — never real silo positions.
// This is an educational visualization of why nuclear war must never happen, not a planning tool.
(function (root) {
  'use strict';
  const NS = root.NS = root.NS || {};

  // ---------- targets ----------
  // Every target looks like:
  //   { id, name, side, cc, kind, lat, lon, major, full, also? }
  //   side  = whose camp it belongs to: 'US' | 'RU' | 'GB' | 'FR' | 'CN' | 'NATO' (non-nuclear NATO hosts / NATO bases in Europe)
  //   cc    = the country it is in (ISO alpha-2), e.g. Ramstein is side 'NATO', cc 'DE'
  //   kind  = 'icbm-base' | 'bomber-base' | 'ssbn-base' | 'command' | 'military'
  //   major = true → labelled prominently on the map; false → small label, only when zoomed in
  //   full  = a longer description (for tooltips / the log)
  //   also  = other kinds the place also counts as (e.g. Minot has missiles AND bombers)

  // ✏️ EDIT: targets, one row each: [id, short map label, country, kind, lat, lon, major?, longer description]
  const ROWS = {
    US: [
      // ICBM wings (Minuteman III)
      ['malmstrom', 'Malmstrom AFB', 'US', 'icbm-base', 47.51, -111.18, true, 'Malmstrom Air Force Base, Montana — 341st Missile Wing (Minuteman III)'],
      ['minot', 'Minot AFB', 'US', 'icbm-base', 48.42, -101.36, true, 'Minot Air Force Base, North Dakota — 91st Missile Wing and B-52 bombers'],
      ['warren', 'F.E. Warren AFB', 'US', 'icbm-base', 41.13, -104.87, true, 'F.E. Warren Air Force Base, Wyoming — 90th Missile Wing (Minuteman III)'],
      // bomber bases
      ['whiteman', 'Whiteman AFB', 'US', 'bomber-base', 38.73, -93.55, true, 'Whiteman Air Force Base, Missouri — B-2 stealth bombers'],
      ['barksdale', 'Global Strike Command', 'US', 'bomber-base', 32.50, -93.66, true, 'Barksdale Air Force Base, Louisiana — Air Force Global Strike Command and B-52 bombers'],
      ['dyess', 'Dyess AFB', 'US', 'bomber-base', 32.42, -99.86, false, 'Dyess Air Force Base, Texas — B-1 bombers'],
      ['ellsworth', 'Ellsworth AFB', 'US', 'bomber-base', 44.15, -103.10, false, 'Ellsworth Air Force Base, South Dakota — B-1 bombers'],
      // ballistic-missile submarine (SSBN) bases
      ['bangor', 'SSBN Base', 'US', 'ssbn-base', 47.73, -122.71, true, 'Naval Base Kitsap–Bangor, Washington — Pacific Ohio-class submarine base'],
      ['kings-bay', 'SSBN Base', 'US', 'ssbn-base', 30.80, -81.52, true, 'Naval Submarine Base Kings Bay, Georgia — Atlantic Ohio-class submarine base'],
      // command and control
      ['pentagon', 'The Pentagon', 'US', 'command', 38.871, -77.056, true, 'The Pentagon, Arlington, Virginia — Department of Defense headquarters'],
      ['white-house', 'The White House', 'US', 'command', 38.898, -77.037, true, 'The White House, Washington, D.C.'],
      ['stratcom', 'STRATCOM', 'US', 'command', 41.12, -95.91, true, 'Offutt Air Force Base, Nebraska — U.S. Strategic Command headquarters'],
      ['norad', 'NORAD', 'US', 'command', 38.74, -104.85, true, 'Cheyenne Mountain, Colorado — NORAD / missile-warning complex'],
      ['cybercom', 'CYBERCOM', 'US', 'command', 39.11, -76.74, true, 'Fort Meade, Maryland — U.S. Cyber Command and NSA'],
      ['raven-rock', 'Raven Rock', 'US', 'command', 39.73, -77.42, false, 'Raven Rock Mountain Complex ("Site R"), Pennsylvania — alternate military command center'],
      ['mount-weather', 'Mount Weather', 'US', 'command', 39.06, -77.89, false, 'Mount Weather Emergency Operations Center, Virginia — continuity-of-government site'],
      // other well-known military targets
      ['norfolk', 'Naval Station Norfolk', 'US', 'military', 36.95, -76.31, false, 'Naval Station Norfolk, Virginia — largest naval base in the world'],
      ['san-diego', 'Naval Base San Diego', 'US', 'military', 32.68, -117.13, false, 'Naval Base San Diego, California — Pacific Fleet'],
      ['pearl-harbor', 'Pearl Harbor', 'US', 'military', 21.35, -157.95, false, 'Joint Base Pearl Harbor–Hickam, Hawaii — U.S. Indo-Pacific Command'],
      ['kirtland', 'Kirtland AFB', 'US', 'military', 35.04, -106.61, false, 'Kirtland Air Force Base, New Mexico — nuclear weapons storage and support'],
    ],
    RU: [
      // Strategic Rocket Forces missile divisions (silo-based and road-mobile)
      ['kozelsk', 'Kozelsk', 'RU', 'icbm-base', 54.00, 35.80, true, '28th Guards Missile Division, Kaluga region — silo-based Yars'],
      ['tatishchevo', 'Tatishchevo', 'RU', 'icbm-base', 51.68, 45.60, true, '60th Missile Division, Saratov region — silo-based Topol-M'],
      ['teykovo', 'Teykovo', 'RU', 'icbm-base', 56.86, 40.54, false, '54th Guards Missile Division, Ivanovo region — road-mobile Yars'],
      ['yoshkar-ola', 'Yoshkar-Ola', 'RU', 'icbm-base', 56.66, 47.95, false, '14th Missile Division, Mari El — road-mobile Yars'],
      ['vypolzovo', 'Vypolzovo', 'RU', 'icbm-base', 57.88, 33.70, false, '7th Guards Missile Division near Bologoye, Tver region — Yars'],
      ['dombarovsky', 'Dombarovsky', 'RU', 'icbm-base', 51.00, 59.80, true, '13th Missile Division near Yasny, Orenburg region — heavy silo ICBMs and Avangard'],
      ['uzhur', 'Uzhur', 'RU', 'icbm-base', 55.32, 89.80, true, '62nd Missile Division, Krasnoyarsk region — heavy silo ICBMs (SS-18 / Sarmat)'],
      ['novosibirsk', 'Novosibirsk', 'RU', 'icbm-base', 55.15, 83.05, false, '39th Guards Missile Division, Novosibirsk — road-mobile Yars'],
      ['barnaul', 'Barnaul', 'RU', 'icbm-base', 53.40, 84.00, false, '35th Missile Division, Altai region — road-mobile Yars'],
      ['irkutsk', 'Irkutsk', 'RU', 'icbm-base', 52.33, 104.20, false, '29th Guards Missile Division, Irkutsk — road-mobile Yars'],
      ['nizhny-tagil', 'Nizhny Tagil', 'RU', 'icbm-base', 58.00, 60.30, false, '42nd Missile Division, Sverdlovsk region — road-mobile Yars'],
      ['yurya', 'Yurya', 'RU', 'icbm-base', 59.03, 49.28, false, '8th Missile Division, Kirov region — road-mobile Yars'],
      // bomber bases
      ['engels', 'Engels', 'RU', 'bomber-base', 51.48, 46.21, true, 'Engels-2 air base, Saratov region — Tu-160 and Tu-95 bombers'],
      ['ukrainka', 'Ukrainka', 'RU', 'bomber-base', 51.17, 128.44, false, 'Ukrainka air base, Amur region — Tu-95 bombers'],
      ['olenya', 'Olenya', 'RU', 'bomber-base', 68.15, 33.46, false, 'Olenya air base, Murmansk region — long-range bombers'],
      // ballistic-missile submarine bases
      ['gadzhiyevo', 'Gadzhiyevo', 'RU', 'ssbn-base', 69.25, 33.32, true, 'Gadzhiyevo, Kola Peninsula — Northern Fleet SSBN base'],
      ['vilyuchinsk', 'Vilyuchinsk', 'RU', 'ssbn-base', 52.93, 158.40, true, 'Vilyuchinsk, Kamchatka — Pacific Fleet SSBN base'],
      // command and control
      ['moscow', 'Moscow', 'RU', 'command', 55.752, 37.617, true, 'Moscow — the Kremlin and national leadership'],
      ['general-staff', 'General Staff', 'RU', 'command', 55.73, 37.59, false, 'Moscow — General Staff / National Defence Management Center'],
      ['kosvinsky', 'Kosvinsky Mountain', 'RU', 'command', 59.52, 59.06, true, 'Kosvinsky Kamen, Ural Mountains — hardened strategic command post'],
      ['yamantau', 'Mount Yamantau', 'RU', 'command', 54.26, 58.10, false, 'Mount Yamantau, Bashkortostan — large underground complex'],
      // other well-known military targets
      ['severomorsk', 'Severomorsk', 'RU', 'military', 69.07, 33.42, false, 'Severomorsk — Northern Fleet headquarters'],
      ['kaliningrad', 'Kaliningrad', 'RU', 'military', 54.71, 20.51, false, 'Kaliningrad — Baltic Fleet and short-range missile forces'],
      ['plesetsk', 'Plesetsk', 'RU', 'military', 62.93, 40.57, false, 'Plesetsk Cosmodrome, Arkhangelsk region — missile test launches'],
      ['vladivostok', 'Vladivostok', 'RU', 'military', 43.12, 131.89, false, 'Vladivostok — Pacific Fleet headquarters'],
    ],
    GB: [
      ['faslane', 'Faslane', 'GB', 'ssbn-base', 56.07, -4.82, true, 'HMNB Clyde (Faslane), Scotland — home of the UK\'s Vanguard-class Trident submarines'],
      ['northwood', 'Northwood HQ', 'GB', 'command', 51.63, -0.42, false, 'Northwood Headquarters, London — UK Permanent Joint HQ and submarine command'],
      ['london', 'London', 'GB', 'command', 51.503, -0.127, true, 'London — Whitehall and national leadership'],
      ['aldermaston', 'AWE Aldermaston', 'GB', 'military', 51.37, -1.14, false, 'Atomic Weapons Establishment, Aldermaston'],
    ],
    FR: [
      ['ile-longue', 'Île Longue', 'FR', 'ssbn-base', 48.31, -4.51, true, 'Île Longue, Brittany — base of France\'s Triomphant-class missile submarines'],
      ['brest', 'Brest', 'FR', 'military', 48.38, -4.49, false, 'Brest — Atlantic naval base'],
      ['paris', 'Paris', 'FR', 'command', 48.857, 2.352, true, 'Paris — national leadership'],
      ['taverny', 'Taverny', 'FR', 'command', 49.02, 2.21, false, 'Taverny air base — French strategic forces command center'],
      ['saint-dizier', 'Saint-Dizier', 'FR', 'bomber-base', 48.64, 4.90, false, 'Saint-Dizier air base (BA 113) — Rafale jets with ASMPA nuclear cruise missiles'],
      ['istres', 'Istres', 'FR', 'bomber-base', 43.52, 4.92, false, 'Istres air base (BA 125) — tanker aircraft and nuclear air forces'],
    ],
    CN: [
      ['beijing', 'Beijing', 'CN', 'command', 39.904, 116.407, true, 'Beijing — national leadership'],
      ['western-hills', 'Western Hills', 'CN', 'command', 39.98, 116.20, false, 'Western Hills, Beijing — military command center'],
      ['yulin', 'Yulin Naval Base', 'CN', 'ssbn-base', 18.22, 109.55, true, 'Yulin Naval Base, Hainan — Jin-class missile submarines'],
      ['jianggezhuang', 'Jianggezhuang', 'CN', 'ssbn-base', 36.11, 120.56, false, 'Jianggezhuang near Qingdao — submarine base'],
      ['yumen', 'Yumen silo field', 'CN', 'icbm-base', 40.15, 96.55, true, 'Yumen, Gansu — new ICBM silo field reported in 2021'],
      ['hami', 'Hami silo field', 'CN', 'icbm-base', 42.25, 92.65, false, 'Hami, Xinjiang — new ICBM silo field reported in 2021'],
      ['ordos', 'Ordos silo field', 'CN', 'icbm-base', 40.05, 107.80, false, 'Hanggin Banner (Ordos), Inner Mongolia — new ICBM silo field reported in 2021'],
      ['delingha', 'Delingha', 'CN', 'icbm-base', 37.37, 97.37, false, 'Delingha, Qinghai — rocket force missile base'],
      ['jilantai', 'Jilantai', 'CN', 'icbm-base', 39.75, 105.73, false, 'Jilantai training area, Inner Mongolia — missile training silos'],
    ],
    // NATO bases in Europe (including the nuclear-sharing bases). All small labels.
    NATO: [
      ['ramstein', 'Ramstein AB', 'DE', 'military', 49.44, 7.60, false, 'Ramstein Air Base, Germany — U.S. Air Forces in Europe headquarters'],
      ['buchel', 'Büchel AB', 'DE', 'military', 50.17, 7.06, false, 'Büchel Air Base, Germany — NATO nuclear sharing'],
      ['aviano', 'Aviano AB', 'IT', 'military', 46.03, 12.60, false, 'Aviano Air Base, Italy — NATO nuclear sharing'],
      ['ghedi', 'Ghedi AB', 'IT', 'military', 45.43, 10.27, false, 'Ghedi Air Base, Italy — NATO nuclear sharing'],
      ['kleine-brogel', 'Kleine Brogel AB', 'BE', 'military', 51.17, 5.47, false, 'Kleine Brogel Air Base, Belgium — NATO nuclear sharing'],
      ['volkel', 'Volkel AB', 'NL', 'military', 51.66, 5.71, false, 'Volkel Air Base, Netherlands — NATO nuclear sharing'],
      ['incirlik', 'Incirlik AB', 'TR', 'military', 37.00, 35.43, false, 'Incirlik Air Base, Türkiye — NATO nuclear sharing'],
      ['lakenheath', 'RAF Lakenheath', 'GB', 'military', 52.41, 0.56, false, 'RAF Lakenheath, England — U.S. Air Force fighter base'],
      ['rzeszow', 'Rzeszów', 'PL', 'military', 50.11, 22.02, false, 'Rzeszów, Poland — NATO logistics hub'],
      ['redzikowo', 'Redzikowo', 'PL', 'military', 54.48, 17.10, false, 'Redzikowo, Poland — Aegis Ashore missile-defense site'],
      ['deveselu', 'Deveselu', 'RO', 'military', 44.08, 24.41, false, 'Deveselu, Romania — Aegis Ashore missile-defense site'],
      ['nato-hq', 'NATO HQ', 'BE', 'command', 50.88, 4.43, false, 'NATO Headquarters, Brussels'],
      ['shape', 'SHAPE', 'BE', 'command', 50.50, 3.98, false, 'Supreme Headquarters Allied Powers Europe, Mons, Belgium'],
    ],
  };

  // ✏️ EDIT: places that count as more than one kind of target
  const ALSO = {
    minot: ['bomber-base'],        // missiles and B-52s on the same base
    barksdale: ['command'],        // Air Force Global Strike Command HQ
  };

  NS.TARGETS = [];
  Object.keys(ROWS).forEach(side => {
    ROWS[side].forEach(([id, name, cc, kind, lat, lon, major, full]) => {
      const t = { id, name, side, cc, kind, lat, lon, major: !!major, full: full || name };
      if (ALSO[id]) t.also = ALSO[id].slice();
      NS.TARGETS.push(t);
    });
  });

  // Find a target by its id, e.g. NS.targetById('minot')
  const BY_ID = {};
  NS.TARGETS.forEach(t => { BY_ID[t.id] = t; });
  NS.targetById = id => BY_ID[id] || null;

  // ---------- silo fields ----------
  // One area per ICBM base. The individual dots are drawn by NS.siloPoints() below as a clumpy random scatter.
  // ⚠️ The scatter is ILLUSTRATIVE and is NOT the real position of any silo or launcher.
  //   count    = how many silos / launchers to draw (rough public ballpark)
  //   radiusKm = how far from the center they spread
  //   type     = 'silo' (fixed silos) or 'mobile' (road-mobile launchers that drive out into the forest)
  //   base     = id of the matching target in NS.TARGETS
  // ✏️ EDIT: silo fields
  NS.SILO_FIELDS = [
    // United States — 450 Minuteman III silos (400 loaded), 150 per wing
    { id: 'malmstrom-field', side: 'US', base: 'malmstrom', name: 'Malmstrom missile field', lat: 47.30, lon: -110.40, radiusKm: 130, count: 150, type: 'silo' },
    { id: 'minot-field', side: 'US', base: 'minot', name: 'Minot missile field', lat: 48.20, lon: -101.40, radiusKm: 100, count: 150, type: 'silo' },
    { id: 'warren-field', side: 'US', base: 'warren', name: 'F.E. Warren missile field', lat: 41.20, lon: -104.00, radiusKm: 120, count: 150, type: 'silo' },
    // Russia — a mix of silos and road-mobile launchers
    { id: 'kozelsk-field', side: 'RU', base: 'kozelsk', name: 'Kozelsk missile field', lat: 54.00, lon: 35.80, radiusKm: 50, count: 10, type: 'silo' },
    { id: 'tatishchevo-field', side: 'RU', base: 'tatishchevo', name: 'Tatishchevo missile field', lat: 51.68, lon: 45.60, radiusKm: 60, count: 40, type: 'silo' },
    { id: 'dombarovsky-field', side: 'RU', base: 'dombarovsky', name: 'Dombarovsky missile field', lat: 51.00, lon: 59.80, radiusKm: 70, count: 18, type: 'silo' },
    { id: 'uzhur-field', side: 'RU', base: 'uzhur', name: 'Uzhur missile field', lat: 55.32, lon: 89.80, radiusKm: 60, count: 28, type: 'silo' },
    { id: 'teykovo-field', side: 'RU', base: 'teykovo', name: 'Teykovo mobile launchers', lat: 56.86, lon: 40.54, radiusKm: 80, count: 18, type: 'mobile' },
    { id: 'yoshkar-ola-field', side: 'RU', base: 'yoshkar-ola', name: 'Yoshkar-Ola mobile launchers', lat: 56.66, lon: 47.95, radiusKm: 80, count: 18, type: 'mobile' },
    { id: 'vypolzovo-field', side: 'RU', base: 'vypolzovo', name: 'Vypolzovo mobile launchers', lat: 57.88, lon: 33.70, radiusKm: 70, count: 18, type: 'mobile' },
    { id: 'novosibirsk-field', side: 'RU', base: 'novosibirsk', name: 'Novosibirsk mobile launchers', lat: 55.15, lon: 83.05, radiusKm: 90, count: 27, type: 'mobile' },
    { id: 'barnaul-field', side: 'RU', base: 'barnaul', name: 'Barnaul mobile launchers', lat: 53.40, lon: 84.00, radiusKm: 90, count: 18, type: 'mobile' },
    { id: 'irkutsk-field', side: 'RU', base: 'irkutsk', name: 'Irkutsk mobile launchers', lat: 52.33, lon: 104.20, radiusKm: 80, count: 18, type: 'mobile' },
    { id: 'nizhny-tagil-field', side: 'RU', base: 'nizhny-tagil', name: 'Nizhny Tagil mobile launchers', lat: 58.00, lon: 60.30, radiusKm: 90, count: 27, type: 'mobile' },
    { id: 'yurya-field', side: 'RU', base: 'yurya', name: 'Yurya mobile launchers', lat: 59.03, lon: 49.28, radiusKm: 80, count: 18, type: 'mobile' },
    // China — the three large silo fields seen on satellite images in 2021
    { id: 'yumen-field', side: 'CN', base: 'yumen', name: 'Yumen silo field', lat: 40.15, lon: 96.55, radiusKm: 50, count: 120, type: 'silo' },
    { id: 'hami-field', side: 'CN', base: 'hami', name: 'Hami silo field', lat: 42.25, lon: 92.65, radiusKm: 50, count: 110, type: 'silo' },
    { id: 'ordos-field', side: 'CN', base: 'ordos', name: 'Ordos silo field', lat: 40.05, lon: 107.80, radiusKm: 50, count: 90, type: 'silo' },
  ];

  // ---------- submarine launch areas ----------
  // Rough ocean areas where missile submarines could be on patrol. Subs are placed somewhere within spreadKm.
  // ✏️ EDIT: submarine patrol areas (subs = how many to draw there)
  NS.SUB_AREAS = [
    { id: 'us-atlantic', side: 'US', name: 'North Atlantic', lat: 52.0, lon: -22.0, spreadKm: 600, subs: 3 },
    { id: 'us-norwegian', side: 'US', name: 'Norwegian Sea', lat: 68.0, lon: 0.0, spreadKm: 350, subs: 1 },
    { id: 'us-pacific', side: 'US', name: 'North Pacific', lat: 42.0, lon: -170.0, spreadKm: 700, subs: 3 },
    { id: 'us-alaska', side: 'US', name: 'Gulf of Alaska', lat: 54.5, lon: -145.0, spreadKm: 350, subs: 1 },
    { id: 'ru-barents', side: 'RU', name: 'Barents Sea', lat: 73.0, lon: 36.0, spreadKm: 350, subs: 3 },
    { id: 'ru-okhotsk', side: 'RU', name: 'Sea of Okhotsk', lat: 53.0, lon: 149.0, spreadKm: 400, subs: 2 },
    { id: 'ru-atlantic', side: 'RU', name: 'North Atlantic', lat: 55.0, lon: -30.0, spreadKm: 600, subs: 1 },
    { id: 'ru-us-east', side: 'RU', name: 'off the US East Coast', lat: 36.0, lon: -66.0, spreadKm: 400, subs: 1 },
    { id: 'ru-us-west', side: 'RU', name: 'off the US West Coast', lat: 40.0, lon: -135.0, spreadKm: 400, subs: 1 },
    { id: 'gb-atlantic', side: 'GB', name: 'North Atlantic', lat: 55.0, lon: -20.0, spreadKm: 400, subs: 1 },
    { id: 'fr-atlantic', side: 'FR', name: 'North Atlantic', lat: 47.0, lon: -16.0, spreadKm: 400, subs: 1 },
    { id: 'cn-scs', side: 'CN', name: 'South China Sea', lat: 15.0, lon: 114.0, spreadKm: 400, subs: 2 },
  ];

  // ---------- arsenals ----------
  // Rough public ballparks of DEPLOYED warheads (FAS Nuclear Notebook-style public estimates, 2024–2025).
  // All numbers are approximate. Each leg: { warheads, yields: [min, max] kilotons, flightMin: [min, max] minutes, system }.
  // Each country also has .total and .note, and NS.ARSENALS has .note — these are hidden from Object.keys()
  // so you can loop over the legs (icbm / slbm / bomber) safely.
  // Bombers take hours to arrive — longer than most scenarios run.
  // ✏️ EDIT: arsenals
  NS.ARSENALS = {
    US: {
      icbm: { warheads: 400, yields: [300, 335], flightMin: [28, 33], system: 'Minuteman III' },
      slbm: { warheads: 970, yields: [90, 455], flightMin: [8, 15], system: 'Trident II D5 on Ohio-class submarines' },
      bomber: { warheads: 300, yields: [150, 1200], flightMin: [300, 600], system: 'B-52, B-2 (cruise missiles and gravity bombs)' },
    },
    RU: {
      icbm: { warheads: 870, yields: [150, 800], flightMin: [25, 35], system: 'Yars, Topol-M, SS-18 / Sarmat, Avangard' },
      slbm: { warheads: 640, yields: [100, 500], flightMin: [8, 15], system: 'Bulava and Sineva on Borei / Delta IV submarines' },
      bomber: { warheads: 200, yields: [200, 250], flightMin: [300, 600], system: 'Tu-95 and Tu-160 (cruise missiles)' },
    },
    GB: {
      slbm: { warheads: 120, yields: [100, 100], flightMin: [8, 15], system: 'Trident II D5 on Vanguard-class submarines' },
    },
    FR: {
      slbm: { warheads: 240, yields: [100, 300], flightMin: [8, 15], system: 'M51 on Triomphant-class submarines' },
      bomber: { warheads: 40, yields: [300, 300], flightMin: [150, 300], system: 'Rafale with ASMPA cruise missiles' },
    },
    CN: {
      icbm: { warheads: 400, yields: [200, 3000], flightMin: [28, 35], system: 'DF-41, DF-31, DF-5' },
      slbm: { warheads: 72, yields: [200, 300], flightMin: [15, 30], system: 'JL-2 / JL-3 on Jin-class submarines' },
      bomber: { warheads: 20, yields: [200, 300], flightMin: [300, 600], system: 'H-6N' },
    },
  };
  const NOTES = {
    US: 'About 1,700 deployed strategic warheads (of ~3,700 in the stockpile). About 100 more B61 bombs are stored in Europe.',
    RU: 'About 1,700 deployed strategic warheads (of ~4,300 in the stockpile), plus ~1,500 non-strategic warheads in storage.',
    GB: 'About 120 deployed warheads on submarines (of ~225 in total). One submarine is always on patrol.',
    FR: 'About 280 deployed warheads (290 in total): submarines plus air-launched missiles.',
    CN: 'About 600 warheads in total and growing fast; most are thought to be stored, not mated to missiles. ~500 used here.',
  };
  const hide = (obj, key, value) => Object.defineProperty(obj, key, { value, enumerable: false, configurable: true, writable: true });
  Object.keys(NS.ARSENALS).forEach(cc => {
    const a = NS.ARSENALS[cc];
    hide(a, 'total', Object.keys(a).reduce((sum, leg) => sum + a[leg].warheads, 0));
    hide(a, 'note', NOTES[cc]);
  });
  hide(NS.ARSENALS, 'note', 'Rough public ballparks of deployed warheads, based on FAS Nuclear Notebook-style public estimates (2024–2025). ' +
    'All numbers are approximate and change every year.');

  // ---------- alliances ----------
  // ✏️ EDIT: who is on which side (ISO alpha-2 codes)
  NS.ALLIANCES = {
    NATO: ['US', 'CA', 'GB', 'FR', 'DE', 'IT', 'ES', 'PT', 'NL', 'BE', 'LU', 'DK', 'NO', 'IS', 'TR', 'GR',
      'PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'SI', 'HR', 'AL', 'ME', 'MK', 'EE', 'LV', 'LT', 'FI', 'SE'],   // all 32 members
    RU: ['RU', 'BY'],
    CN: ['CN'],
    KP: ['KP'],
  };

  // ---------- seeded random numbers ----------
  // NS.rng(seed) → a function that returns numbers in [0, 1), the same sequence every time for the same seed
  // (mulberry32). The seed can be a number or a string. Leave it out for a random seed.
  function seedToInt(seed) {
    if (seed === undefined || seed === null) return (Math.random() * 4294967296) >>> 0;
    if (typeof seed === 'number' && Number.isInteger(seed)) return seed >>> 0;
    const s = String(seed);
    let h = 2166136261;                        // FNV-1a string hash
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  NS.rng = function (seed) {
    let a = seedToInt(seed);
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // ---------- silo scatter ----------
  // NS.siloPoints(field, rng) → [{ lat, lon }, …]: `count` dots within radiusKm of the field's center.
  // Fixed silos come in clumps of about 10 (like missile "flights"); mobile launchers spread out from a few garrisons.
  // ⚠️ Illustrative only — NOT real silo or launcher positions. Same rng seed → same dots.
  const KM_PER_DEG = 111.32;
  NS.siloPoints = function (field, rng) {
    if (!field) return [];
    rng = rng || NS.rng('silos:' + (field.id || field.name || ''));
    const count = Math.max(0, Math.round(field.count || 0));
    const R = Math.max(1, field.radiusKm || 50);
    const mobile = field.type === 'mobile';
    const k = Math.max(1, field.clusters || (mobile
      ? Math.min(4, Math.max(2, Math.round(count / 9)))
      : Math.min(15, Math.max(2, Math.round(count / 10)))));
    const sigma = mobile ? R * 0.22 : R * Math.max(0.07, 0.3 / Math.sqrt(k));   // how tight each clump is (km)
    const minSep = R * (mobile ? 0.05 : 0.035);                                  // keep dots from piling up (km)
    const gauss = () => Math.sqrt(-2 * Math.log(rng() || 1e-12)) * Math.cos(2 * Math.PI * rng());
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    // clump centers: well spread out inside the field (best of a few random tries)
    const centers = [];
    for (let i = 0; i < k; i++) {
      let best = null, bestD = -1;
      for (let tries = 0; tries < 8; tries++) {
        const r = 0.75 * R * Math.sqrt(rng()), ang = rng() * 2 * Math.PI;
        const c = { x: r * Math.cos(ang), y: r * Math.sin(ang) };
        const d = centers.length ? Math.min(...centers.map(o => dist(o, c))) : Infinity;
        if (d > bestD) { best = c; bestD = d; }
      }
      centers.push(best);
    }

    // dots: shared out evenly between the clumps
    const pts = [];
    for (let i = 0; i < count; i++) {
      const c = centers[i % k];
      let p = null;
      for (let tries = 0; tries < 12; tries++) {
        const q = { x: c.x + gauss() * sigma, y: c.y + gauss() * sigma };
        if (Math.hypot(q.x, q.y) > R) continue;
        p = q;
        if (!pts.some(o => dist(o, q) < minSep)) break;
      }
      if (!p) {                                  // every try landed outside: pull the clump center's direction back inside
        const r = Math.hypot(c.x, c.y) || 1, s = Math.min(1, 0.95 * R / r);
        p = { x: c.x * s, y: c.y * s };
      }
      pts.push(p);
    }

    const cosLat = Math.max(0.05, Math.cos(field.lat * Math.PI / 180));
    return pts.map(p => ({
      lat: Math.round((field.lat + p.y / KM_PER_DEG) * 1e4) / 1e4,
      lon: Math.round((field.lon + p.x / (KM_PER_DEG * cosLat)) * 1e4) / 1e4,
    }));
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof window !== 'undefined' ? window : globalThis);
