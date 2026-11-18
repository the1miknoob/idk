/*global UVServiceWorker,__uv$config,$scramjetLoadWorker*/
// The Browser's proxy worker: every page opened in the Browser (addresses under go/) is fetched through the proxy here.
// Two proxy engines live side by side: Scramjet (go/sj/…, the default, best for big modern sites) and Ultraviolet (go/…).
importScripts('uv/uv.bundle.js');
importScripts('uv/uv.config.js');
importScripts(__uv$config.sw);
importScripts('scramjet/scramjet.all.js');

const uv = new UVServiceWorker();
// Scramjet's worker opens its database without creating the tables in it, and if it gets there first the page
// can't save Scramjet's settings. So open it the right way first (database requests run in order).
const SJ_TABLES = ['config', 'cookies', 'redirectTrackers', 'referrerPolicies', 'publicSuffixList'];
try {
  const req = indexedDB.open('$scramjet', 1);
  req.onupgradeneeded = () => { for (const t of SJ_TABLES) if (!req.result.objectStoreNames.contains(t)) req.result.createObjectStore(t); };
  req.onsuccess = () => req.result.close();
} catch (e) {}
const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();
const HERE = new URL('./', location).href;                 // …/browser/
const SCRAMJET = [HERE + 'go/sj/', HERE + 'scramjet/'];    // Scramjet's pages and its own files

self.addEventListener('install', () => self.skipWaiting());
// "Clear cookies and site data" in the Browser's settings: forget the cookies Scramjet keeps in memory too
self.addEventListener('message', e => { if (e.data && e.data.browser === 'clear-cookies') scramjet.cookieStore = new scramjet.cookieStore.constructor(); });
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

const oops = (err, url) => new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title></head><body>
  <h1 id="errorTitle">The proxy couldn't load this page</h1><p id="fetchedURL"></p><textarea id="errorTrace"></textarea>
  <script>errorTrace.value = ${JSON.stringify(String((err && err.stack) || err))}; fetchedURL.textContent = ${JSON.stringify(url)};</script></body></html>`,
  { status: 500, headers: { 'content-type': 'text/html; charset=utf-8' } });

self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (SCRAMJET.some(p => url.startsWith(p))) {
    e.respondWith((async () => {
      try {
        await scramjet.loadConfig();   // the Browser page saves Scramjet's settings before it opens anything
        if (!scramjet.config) throw new Error('Scramjet isn\'t set up yet: open the Browser page first.');
        if (scramjet.route(e)) return await scramjet.fetch(e);
        return fetch(e.request);
      } catch (err) {
        console.error('Scramjet:', err);
        return oops(err, url);
      }
    })());
    return;
  }
  e.respondWith(uv.route(e) ? uv.fetch(e) : fetch(e.request));
});
