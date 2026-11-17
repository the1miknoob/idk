/*global UVServiceWorker,__uv$config*/
// The Browser's proxy worker: every page opened in the Browser (addresses under go/) is fetched through the proxy here.
importScripts('uv/uv.bundle.js');
importScripts('uv/uv.config.js');
importScripts(__uv$config.sw);

const uv = new UVServiceWorker();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  e.respondWith((async () => {
    if (uv.route(e)) return uv.fetch(e);
    return fetch(e.request);
  })());
});
