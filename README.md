# idk
My personal website, built with HTML, CSS and JavaScript and hosted on GitHub Pages.

Live at: https://the1miknoob.github.io/idk/

## What's inside
- **Games** (`games/`): Block Pop, Merge Drop, Word Hunt, Night Swarm, Sky Hop, Snake, 2048, Reaction Lab and Chess
- **Music Player** (`music-player/`): play your own songs with skins, visualizers and stickers
- **Personal Dashboard** (`dashboard/`): clock, weather, to-dos, notes, focus timer and more
- **World Watch** (`world-watch/`): a live world map with news, conflict zones, war news, earthquakes, storms, the space station, live news TV, markets and famous battles
- **Armor Pen Sim** (`armor-sim/`): a particle physics sandbox where shells, bullets, darts, rockets and missiles smash into armor you build yourself (steel, ceramics, uranium, glass, reactive tiles, sandbags, water, ice, oak…) and plates bend, crack, heat up and spall. Solve each shot with particles (full physics) or instantly with formulas (Alekseevskii–Tate erosion, Rosenberg ricochet, Recht–Ipson exit speed, Grady fragments), plate by plate. Try strange darts (plutonium, gold, osmium, diamond), old-time guns (musket balls, cannonballs) and air-to-air missiles (AIM-9 Sidewinder, AMRAAM, Sparrow, Phoenix, R-73, R-77) on a fighter jet's skin or a tank. After a rocket, missile or explosive shell goes off, the rest of it (a motor tube, tail fins, a heavy base) still slams into the armor. Shoot at 28 whole vehicles made of particles (Tiger I and II, Maus, KV-1, T-34-85, Sherman, Churchill, the Bob Semple tank, T-72, Leopard 1 and 2, M1 Abrams, Merkava, T-90, T-14 Armata…): see what happens to the crew, ammo and engine inside, blow the turret off, keep shooting the wreck, fire up to 8 shots at once (side by side or one after another), take on 16 challenges, or build your own vehicle and share it with a link. Make your own projectiles too (solid shots, darts, shaped charges, squash heads or explosive shells, from any material) and share them with a link. Also has a quick calculator, a target range with made-up tanks, and a Learn tab
- **Typing Test** (`typing-test/`), **Tier List Maker** (`tier-list/`) and **Spin the Wheel** (`spin-wheel/`)

## Site-wide features
- **Quick jump:** press `Ctrl` + `K` (or `/`) on any page to search and jump to any app or game (`site.js`)
- **Install as an app + works offline:** the site can be installed from the browser (on an iPhone: Share → Add to Home Screen), and pages and games keep working without internet (`manifest.webmanifest`, `sw.js`). Live data like news and weather still needs internet.
- **The app home screen** (`home.js`, `home.css`): the installed app opens on a phone-style home screen with a clock, a greeting, search, Jump back in, recently opened apps, every app and game as an icon, and a dock. Hold an icon (or tap ✏️) to drag apps around, hide them, pin them to the dock, or give them your own name, emoji and color. The 📱 button shows it in a browser too.
- **⚙️ Customize:** theme, accent color, background (aurora, glow, dots, plain or your own photo), font, text size, icon size and shape, grid or list, which parts to show, 12/24-hour clock, an app to open when the app starts, the 🏠 button that every other page gets inside the app (and its corner), calm mode (no animations anywhere), and backing up or restoring everything you've saved on the site.

Word Hunt checks guesses against the 5-letter words from [an-array-of-english-words](https://github.com/words/an-array-of-english-words) (MIT License).

World Watch uses free public data: Wikipedia (Current events and the list of ongoing armed conflicts, CC BY-SA), the GDELT Project, USGS, NASA EONET, Where the ISS at?, RainViewer, OpenSky Network, Hacker News, Spaceflight News API, CoinGecko, Frankfurter, OpenStreetMap/Nominatim, Open-Meteo and Natural Earth (via world-atlas). Map tiles by CARTO, Esri and OpenStreetMap, drawn with [Leaflet](https://leafletjs.com/).
