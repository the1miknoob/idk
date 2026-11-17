/*global Ultraviolet*/
// Settings for the proxy engine (Ultraviolet). Pages opened through the proxy live at <browser folder>/go/<scrambled address>.
// The folder is worked out from this page's own address, so it works wherever the site is hosted.
(function () {
  var p = self.location.pathname;
  var i = p.indexOf('/go/');
  var base = i >= 0 ? p.slice(0, i + 1) : p.slice(0, p.lastIndexOf('/') + 1);
  self.__uv$config = {
    prefix: base + 'go/',
    encodeUrl: Ultraviolet.codec.xor.encode,
    decodeUrl: Ultraviolet.codec.xor.decode,
    handler: base + 'uv/uv.handler.js',
    client: base + 'uv/uv.client.js',
    bundle: base + 'uv/uv.bundle.js',
    config: base + 'uv/uv.config.js',
    sw: base + 'uv/uv.sw.js',
  };
})();
