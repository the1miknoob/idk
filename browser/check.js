// Tests one proxy server for the Browser: connects to it and loads a tiny web page through it.
// Runs in a worker of its own and is thrown away afterwards, so a broken server can't upset the real connection.
import EpoxyTransport from './epoxy/index.js';

self.onmessage = async e => {
  const { wisp, url } = e.data || {};
  const t0 = performance.now();
  try {
    const tunnel = new EpoxyTransport({ wisp });
    await tunnel.init();
    const res = await tunnel.request(new URL(url), 'GET', null, {}, undefined);
    let size = 0;
    if (res.body && res.body.getReader) {
      const reader = res.body.getReader();
      for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 1e6) break; }
    } else if (res.body && res.body.byteLength != null) size = res.body.byteLength;
    postMessage({ ok: res.status >= 200 && res.status < 500, status: res.status, size, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    postMessage({ ok: false, error: String((err && err.message) || err).slice(0, 300) });
  }
};
