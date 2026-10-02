// Offline support: keeps a copy of the site so pages and games still open without internet.
// Live data (news, weather, maps…) is never stored here; it always comes fresh from the internet.
const VERSION = 'v1';
const CACHE = 'mikaeel-site-' + VERSION;
const PAGES = ['', '404.html', 'site.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'music-player/', 'dashboard/', 'world-watch/', 'typing-test/', 'tier-list/', 'spin-wheel/',
  'games/', 'games/shared.css', 'games/shared.js', 'games/block-pop/', 'games/merge-drop/', 'games/word-hunt/', 'games/word-hunt/words.js',
  'games/night-swarm/', 'games/sky-hop/', 'games/snake/', 'games/2048/', 'games/reaction-lab/', 'games/chess/'];
// Libraries and fonts from these sites never change for a given address, so a saved copy is fine
const CDN = /^https:\/\/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com)\//;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PAGES.map(p => new Request(p, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('mikaeel-site-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (!url.pathname.startsWith(new URL('./', location).pathname)) return;
    // Pages: try the internet first (so updates show right away), fall back to the saved copy
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === 'navigate' ? caches.match('404.html') : Response.error()))));
  } else if (CDN.test(req.url)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
  }
  // anything else (news, weather, map tiles…) goes straight to the internet
});
