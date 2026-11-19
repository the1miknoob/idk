// Nuke Sim: all the words on the page. The intro screen, the map legend, the "Learn" panel,
// the list of sources and the small disclaimer all live here, so they are easy to read and change.
// Rules for the text: plain, factual and sober. No "winning", no scores, nothing that makes this look fun.
// The intro, legend, source names and disclaimer are plain text (no <, > or &), so they work as text or as HTML.
// The "learn" sections are small bits of HTML: paragraphs and lists only.
(function (root) {
  'use strict';
  const NS = root.NS = root.NS || {};

  // ✏️ EDIT: the welcome screen people see first (keep it short: 3 or 4 paragraphs)
  const intro = {
    title: 'What a nuclear war could do',
    paragraphs: [
      'This is a simulation of a nuclear war on a world map. It exists for one reason: to show, as plainly as possible, why a nuclear war must never happen.',
      'The scenarios are made up. They are not predictions, and they are not based on any real war plan. Targets, missiles and arsenals use rough public information only.',
      'The fatality counter is a rough estimate from a simple model. It only counts people in cities of more than 50,000, and only the first effects of blast and heat. It leaves out fallout, fires, nuclear winter and famine, which would add many more deaths.',
      'You can watch a scenario play out, or choose “Build your own” to see what one bomb would do to a city. The Learn panel explains what you are seeing and where the numbers come from. Some of this can be upsetting to watch.'
    ],
    start: 'Start the simulation'
  };

  // ✏️ EDIT: the map legend, one entry per damage ring (keys and colors must match effects.js and render.js)
  const legend = [
    { key: 'fireball', name: 'Fireball',
      text: 'A ball of glowing gas hotter than the surface of the Sun. Almost nothing inside survives.' },
    { key: 'psi20', name: 'Heavy blast (20 psi)',
      text: 'Even concrete buildings are destroyed or badly damaged. Almost no one survives.' },
    { key: 'psi5', name: 'Moderate blast (5 psi)',
      text: 'Most houses collapse; injuries are almost universal, deaths widespread.' },
    { key: 'thermal', name: 'Heat flash (3rd-degree burns)',
      text: 'Exposed skin gets third-degree burns, often deadly without treatment. Fires break out.' },
    { key: 'psi1', name: 'Light blast (1 psi)',
      text: 'Windows shatter. Flying glass and debris injure many people.' },
    { key: 'fallout', name: 'Fallout (ground bursts only)',
      text: 'Radioactive dust falls downwind. Without shelter, people can get dangerous doses within hours.' }
  ];

  // ✏️ EDIT: the "Learn" panel. Each section is a title plus a little HTML (paragraphs and lists only).
  const learn = [
    {
      title: 'How the simulation works',
      html: `
<p>Each scenario is a made-up chain of events. A crisis turns into a first use of a nuclear weapon, the other side answers, and the war grows step by step. The scenarios are not predictions and do not follow any real war plan.</p>
<p>Missiles are shown as glowing arcs. The clock shows the time since the first launch (T+). Flight times are roughly realistic:</p>
<ul>
<li><strong>Land-based missiles (ICBMs)</strong> are fired from underground silos and take about 30 minutes to reach the other side of the world.</li>
<li><strong>Submarine-launched missiles (SLBMs)</strong> can be fired from much closer and arrive in about 10 to 15 minutes.</li>
<li><strong>Short-range (tactical) weapons</strong> take only a few minutes. Bombers take hours.</li>
</ul>
<p>When a warhead arrives, the map shows its damage rings, and the counters add an estimate of the people killed and injured in nearby cities. Only cities with more than 50,000 people are counted.</p>
<p>In <strong>Build your own</strong> mode you choose a yield, click a place on the map, and see the damage rings and estimated casualties of a single bomb.</p>
<p>Missile silo fields are drawn as random dots around the real base areas. They are not the real silo locations.</p>`
    },
    {
      title: 'What a nuclear explosion does',
      html: `
<p>A nuclear weapon releases an enormous amount of energy in less than a millionth of a second. Its size, called its <strong>yield</strong>, is measured in kilotons (kt). One kiloton is the energy of 1,000 tons of TNT. The bomb that destroyed Hiroshima in 1945 was about 15 kt. Many warheads today are 100 to 800 kt, roughly 7 to 50 times larger.</p>
<ul>
<li><strong>Fireball:</strong> a ball of glowing gas, hotter than the surface of the Sun, forms in an instant. Anything inside it is vaporized.</li>
<li><strong>Blast:</strong> a wall of compressed air rushes outward faster than sound. Its strength is measured in psi (pounds per square inch above normal air pressure). At 20 psi even concrete buildings are destroyed. At 5 psi most houses collapse. At 1 psi windows shatter and flying glass injures people.</li>
<li><strong>Heat:</strong> a flash of thermal radiation travels at the speed of light. It can cause third-degree burns on exposed skin many kilometers away and set fires across a whole city.</li>
<li><strong>Radiation:</strong> a burst of radiation in the first minute is deadly close to ground zero. For large weapons, blast and heat reach farther than this first radiation does.</li>
</ul>
<p>An <strong>air burst</strong> explodes high above the ground. It spreads blast damage over the widest area and creates little local fallout. A <strong>ground burst</strong> explodes at or near the surface. It is used against hardened targets like missile silos. It digs a crater and throws huge amounts of radioactive dirt into the sky.</p>
<p>By the end of 1945, the bombings of Hiroshima and Nagasaki had killed well over 100,000 people, most of them from blast, heat and fire.</p>`
    },
    {
      title: 'Counterforce and countervalue targets',
      html: `
<p>Nuclear planners talk about two kinds of targets.</p>
<ul>
<li><strong>Counterforce</strong> means aiming at the other side’s nuclear weapons and military: missile silos, bomber and submarine bases, and command centers. The idea is to destroy weapons before they can be used.</li>
<li><strong>Countervalue</strong> means aiming at cities, industry and the things a country needs to function. In plain words: attacking where people live and work.</li>
</ul>
<p>The difference is smaller than it sounds. Many bases are close to cities, and command centers are often in or near capitals. Missile silos are usually hit with ground bursts, which spread fallout over large areas downwind. A 1979 study for the US Congress estimated that an attack on US nuclear forces alone could kill between 2 and 20 million Americans, mostly from fallout.</p>
<p>Many experts also doubt that a nuclear war, once started, could be kept limited to military targets.</p>`
    },
    {
      title: 'Fallout',
      html: `
<p>When a nuclear weapon explodes on or near the ground, it pulls huge amounts of soil and debris up into the mushroom cloud. These particles mix with radioactive material from the bomb, then fall back to earth, mostly downwind. This is <strong>fallout</strong>. It can spread for hundreds of kilometers.</p>
<p>Fallout is most dangerous in the first hours and days, because its radioactivity drops quickly. After 7 hours it is about one tenth as strong as after 1 hour, and after about 2 days it is about one hundredth. Still, heavy fallout can give people outdoors a deadly dose within hours.</p>
<p>Shelter makes a big difference. Going inside a solid building, ideally into a basement or the middle of a large building, and staying there for at least 24 hours greatly reduces the dose. Official guidance sums this up as “Get inside, stay inside, stay tuned.”</p>
<p>The fallout plumes on this map are only illustrative: they drift east, like typical winds in the middle latitudes, and their size depends only on the yield. Real fallout depends on the weather on the day. Fallout deaths are not included in the counter.</p>`
    },
    {
      title: 'After the first day',
      html: `
<p>The counter stops at the first effects of blast and heat. In a real war, the deaths would keep rising for months and years.</p>
<ul>
<li><strong>Fires:</strong> burning cities could merge into enormous fires. A firestorm broke out in Hiroshima in 1945.</li>
<li><strong>No help:</strong> hospitals, power, water, fuel and transport would be destroyed or overwhelmed. Many injured people would die without care. Severe burns and radiation sickness need intensive treatment that would not be available.</li>
<li><strong>Nuclear winter:</strong> smoke from burning cities could rise into the stratosphere, above the weather, where rain cannot wash it out. It could block sunlight for years and make the world colder, darker and drier.</li>
<li><strong>Famine:</strong> colder weather and shorter growing seasons could make harvests fail around the world, including in countries that were never attacked.</li>
</ul>
<p>A 2022 study in the journal Nature Food estimated that more than 5 billion people could die from famine after a large war between the United States and Russia, and more than 2 billion after a smaller war between India and Pakistan. These are model estimates, and scientists still debate how strong the cooling would be. Even so, the research shows that a nuclear war could harm far more people than the bombs themselves kill.</p>`
    },
    {
      title: 'How many nuclear weapons exist',
      html: `
<p>As of the mid-2020s, there are approximately 12,000 nuclear warheads in the world. About 3,900 of them are deployed: placed on missiles or at bases with operational forces. The rest are kept in storage or are waiting to be taken apart.</p>
<p>Nine countries have nuclear weapons: the United States, Russia, China, France, the United Kingdom, India, Pakistan, Israel and North Korea. The United States and Russia together hold close to 90 percent of all warheads. China’s arsenal is growing; it had roughly 600 warheads by 2025.</p>
<p>That is far fewer than at the height of the Cold War in the mid-1980s, when there were about 70,000. But a single modern missile submarine can carry enough warheads to destroy dozens of cities.</p>
<p>All of these numbers are public estimates. Governments do not publish full details, so researchers count them from official statements, budgets, satellite images and other open sources.</p>`
    },
    {
      title: 'Why this matters',
      html: `
<p>In 1985, US President Ronald Reagan and Soviet leader Mikhail Gorbachev declared that “a nuclear war cannot be won and must never be fought.” In 2022, the leaders of the five permanent members of the UN Security Council, all of them nuclear powers, repeated those words.</p>
<ul>
<li><strong>Deterrence:</strong> each side keeps nuclear weapons so that any attack would be met with certain retaliation. Supporters say this has helped prevent a war between the great powers since 1945. Critics point out that it only works if every leader, every computer and every warning system gets it right, every time.</li>
<li><strong>Close calls:</strong> during the Cuban Missile Crisis in 1962, the world came very close to nuclear war. In 1983, a Soviet officer, Stanislav Petrov, decided that a warning of incoming US missiles was a false alarm. He was right.</li>
<li><strong>Arms control:</strong> treaties have cut arsenals and set rules. The Non-Proliferation Treaty (1968) limits the spread of nuclear weapons. The INF Treaty (1987) eliminated a whole class of US and Soviet missiles; it ended in 2019. New START (2010) limited the United States and Russia to 1,550 deployed strategic warheads each. Russia suspended its participation in 2023, and the treaty’s term ended in February 2026.</li>
<li><strong>Other efforts:</strong> hotlines between leaders, limits on nuclear testing, and the Treaty on the Prohibition of Nuclear Weapons, which entered into force in 2021. No nuclear-armed country has joined it.</li>
</ul>
<p>In a real crisis, leaders might have only minutes to decide, under stress and with incomplete information. Fewer weapons, open lines of communication and public understanding of what these weapons do all make it less likely that anyone ever faces that choice.</p>`
    },
    {
      title: 'Limits of this model',
      html: `
<p>This is a simple model, not a forecast. Its main limits:</p>
<ul>
<li>It only counts people in cities of more than 50,000. Towns and the countryside are left out.</li>
<li>It only counts the first effects of blast and heat. It leaves out fallout, fires, radiation sickness, the collapse of hospitals and food supplies, nuclear winter and famine. Each of these could add many more deaths.</li>
<li>City populations and locations are approximate, and each city is simplified. Real cities have suburbs, tall buildings, hills and basements that change the damage.</li>
<li>Damage rings are simple circles that depend on the yield. Real damage depends on the height of the burst, the terrain, the weather and the time of day.</li>
<li>The scenarios, targets and timings are invented. Real war plans are secret, and a real war would not follow a script. Missile defenses, failed launches and last-minute decisions are not modeled.</li>
<li>Arsenal sizes are rough public estimates. Missile silos are drawn as random dots around the real base areas, not at their real locations.</li>
</ul>
<p>Because so much is left out, the full toll of a real nuclear war would very likely be much higher than the counter shows. Treat the numbers as a rough sense of scale.</p>`
    }
  ];

  // ✏️ EDIT: sources and further reading (public, well-known references only)
  const sources = [
    { name: 'NUKEMAP by Alex Wellerstein: interactive map of nuclear weapon effects', url: 'https://nuclearsecrecy.com/nukemap/' },
    { name: 'Federation of American Scientists: Status of World Nuclear Forces', url: 'https://fas.org/initiative/status-world-nuclear-forces/' },
    { name: 'The Effects of Nuclear Weapons, Glasstone and Dolan (1977)', url: 'https://www.osti.gov/biblio/6852629' },
    { name: 'Plan A: a simulated US-Russia nuclear war, Princeton Science and Global Security', url: 'https://sgs.princeton.edu/the-lab/plan-a' },
    { name: 'Xia, Robock, Toon and others (2022), Nature Food: famine from climate disruption after nuclear war', url: 'https://www.nature.com/articles/s43016-022-00573-0' },
    { name: 'Ready.gov: what to do in a nuclear explosion', url: 'https://www.ready.gov/nuclear-explosion' },
    { name: 'Arms Control Association: treaties and fact sheets', url: 'https://www.armscontrol.org/' },
    { name: 'GeoNames: city locations and populations', url: 'https://www.geonames.org/' },
    { name: 'world-atlas: country shapes (made from Natural Earth data)', url: 'https://github.com/topojson/world-atlas' },
    { name: 'Natural Earth: public domain map data', url: 'https://www.naturalearthdata.com/' },
    { name: 'Esri World Imagery: satellite map tiles', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer' },
    { name: 'Leaflet: the map library', url: 'https://leafletjs.com/' }
  ];

  // ✏️ EDIT: the small print shown under the map
  const disclaimer = 'This is an educational simulation with made-up scenarios. All numbers are rough estimates from a simple model based on public sources; they are not predictions and do not reflect any real war plan.';

  NS.CONTENT = { intro, legend, learn, sources, disclaimer };

  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof window !== 'undefined' ? window : globalThis);
