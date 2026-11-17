// Stand-in for browsers without SharedWorker (some phones): runs bare-mux's worker as a normal worker owned by the Browser page.
// The page hands it one end of a MessageChannel for every "connection", just like a SharedWorker's connect event.
self.addEventListener('message', e => { if (e.data && e.data.connect && e.ports[0] && self.onconnect) self.onconnect({ ports: [e.ports[0]] }); });
importScripts('worker.js');
