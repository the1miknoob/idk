// Tests one proxy server for the Browser: connects to it and loads a tiny web page through it.
// Runs in a worker of its own and is thrown away afterwards, so a broken server can't upset the real connection.
import EpoxyTransport from './epoxy/index.js';

// Reads a response body, up to a limit
async function readBody(body, limit) {
  const parts = []; let size = 0;
  if (body && body.getReader) {
    const reader = body.getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); size += value.byteLength; if (size > limit) { reader.cancel().catch(() => {}); break; } }
  } else if (body && body.byteLength != null) { parts.push(new Uint8Array(body)); size = body.byteLength; }
  const all = new Uint8Array(size); let at = 0;
  for (const p of parts) { all.set(p.subarray(0, size - at), at); at += p.byteLength; if (at >= size) break; }
  return all;
}
const header = (h, name) => { if (!h) return ''; for (const k in h) if (k.toLowerCase() === name) return String(Array.isArray(h[k]) ? h[k][0] : h[k]); return ''; };
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), ms))]);

self.onmessage = async e => {
  const { wisp, url, icons } = e.data || {};
  if (icons) {   // the Browser's site icons: fetch each one (small images only) and send them back as data: addresses
    const out = [];
    try {
      const tunnel = new EpoxyTransport({ wisp });
      await tunnel.init();
      await Promise.all(icons.map(async (src, i) => {
        try {
          const res = await withTimeout(tunnel.request(new URL(src), 'GET', null, {}, undefined), 8000);
          let type = header(res.headers, 'content-type').split(';')[0].trim();
          if (res.status !== 200 || (type && !/image|icon|octet/i.test(type))) return;
          const bytes = await withTimeout(readBody(res.body, 60000), 8000);
          if (!bytes.length || bytes.length > 60000) return;
          if (!/^image\//.test(type)) type = 'image/x-icon';
          let bin = ''; for (let j = 0; j < bytes.length; j += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(j, j + 8192));
          out[i] = 'data:' + type + ';base64,' + btoa(bin);
        } catch (err) {}
      }));
    } catch (err) {}
    postMessage({ icons: icons.map((_, i) => out[i] || '') });
    return;
  }
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
