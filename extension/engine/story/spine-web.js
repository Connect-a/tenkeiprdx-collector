import { utilHelpers } from '../../core/util.js';
const latin1 = utilHelpers.latin1;
const utf8 = new TextDecoder('utf-8');
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
let _rawSeq = 0;
const lib = () => globalThis.spine;

const rewriteAtlasPageNames = (atlasText, token) =>
  atlasText
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      return t && !line.startsWith(' ') && !line.includes(':') && /\.(png|jpg|jpeg|webp)$/i.test(t) ? token : line;
    })
    .join('\n');
const scaleAtlasCoords = (atlasBytes, sx, sy) =>
  new TextEncoder().encode(
    utf8
      .decode(atlasBytes)
      .replace(/^([ \t]*)(size|xy|orig|offset):[ \t]*(-?\d+)[ \t]*,[ \t]*(-?\d+)[ \t]*$/gim, (m, ind, key, a, b) => `${ind}${key}: ${Math.round(Number(a) * sx)},${Math.round(Number(b) * sy)}`),
  );
const maybeScaleAtlas = (atlasBytes, texW, texH) => {
  const szm = latin1.decode(atlasBytes).match(/size:\s*(\d+)\s*,\s*(\d+)/);
  if (!szm) return atlasBytes;
  const pw = +szm[1],
    ph = +szm[2];
  return pw > 0 && ph > 0 && (pw !== texW || ph !== texH) ? scaleAtlasCoords(atlasBytes, texW / pw, texH / ph) : atlasBytes;
};
const makeRawGLTexture = (ctx, rgba, width, height, useMipMaps) => {
  const S = lib();
  const t = Object.create(S.webgl.GLTexture.prototype);
  t._image = { width, height };
  t._rawRgba = rgba;
  t.texture = null;
  t.boundUnit = 0;
  t.useMipMaps = !!useMipMaps;
  t.context = ctx instanceof S.webgl.ManagedWebGLRenderingContext ? ctx : new S.webgl.ManagedWebGLRenderingContext(ctx);
  t.update = function (mip) {
    const gl = this.context.gl;
    if (!this.texture) this.texture = gl.createTexture();
    this.bind();
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this._image.width, this._image.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, this._rawRgba);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
  };
  t.restore();
  t.context.addRestorable(t);
  return t;
};
const detectSkeletonIsJson = (path, bytes) => {
  const p = String(path || '').toLowerCase();
  if (p.endsWith('.json')) return true;
  if (!bytes || !bytes.length) return false;
  let i = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
  if (i < bytes.length && (bytes[i] === 0x7b || bytes[i] === 0x5b)) return true;
  return false;
};

const startDefaultIdle = (player) => {
  try {
    const anims = (player && player.skeleton && player.skeleton.data && player.skeleton.data.animations) || [];
    if (!anims.length || !player.animationState) return;
    const names = anims.map((a) => a.name);
    const pick = names.includes('idle_normal') ? 'idle_normal' : names.find((n) => /idle/i.test(n)) || names[0];
    if (pick) player.animationState.setAnimation(0, pick, true);
  } catch (e) {}
};

const runtimeReady = () => {
  const s = lib();
  return !!(s && s.SpinePlayer);
};

const buildPlayable = (host, input, opts) => {
  if (!runtimeReady()) throw new Error('spineWeb-runtime-not-ready');
  if (!host) throw new Error('host-missing');
  const o = opts || {};
  let atlasBytes = input.atlasBytes;
  const tex = input.texture;
  if (!atlasBytes || !input.skeletonBytes || !tex || !tex.rgba) throw new Error('spineWeb-inputs-incomplete');

  atlasBytes = maybeScaleAtlas(atlasBytes, tex.width, tex.height);
  const token = 'tp_raw_' + _rawSeq++ + '.png';
  const atlasText = utf8.decode(atlasBytes);
  const atlasUrl = URL.createObjectURL(new Blob([rewriteAtlasPageNames(atlasText, token)], { type: 'text/plain' }));
  const parent = atlasUrl.slice(0, atlasUrl.lastIndexOf('/'));
  const pageKey = (parent ? parent + '/' : '') + token;
  const isJson = detectSkeletonIsJson(input.skeletonPath, input.skeletonBytes);
  const skeletonUrl = URL.createObjectURL(new Blob([input.skeletonBytes], { type: isJson ? 'application/json' : 'application/octet-stream' }));

  let erred = false;
  const cfg = {
    atlasUrl,
    rawDataURIs: { [pageKey]: TINY_PNG },
    alpha: true,
    premultipliedAlpha: o.premultipliedAlpha !== false,
    showControls: !!o.showControls,
    fitToCanvas: o.fitToCanvas !== false,
    backgroundColor: o.backgroundColor || '#00000000',
    success: (player) => {
      if (o.onReady) {
        try {
          o.onReady(player);
        } catch (e) {}
      } else startDefaultIdle(player);
    },
    error: (player, err) => {
      if (erred) return;
      erred = true;
      const e0 = err !== undefined && err !== null ? err : player;
      const msg = e0 && e0.message ? e0.message : typeof e0 === 'string' ? e0 : String(e0);
      if (o.onError) {
        try {
          o.onError(msg, player);
        } catch (e) {}
      }
      try {
        player && player.dispose && player.dispose();
      } catch (x) {}
    },
  };
  if (isJson) cfg.jsonUrl = skeletonUrl;
  else cfg.skelUrl = skeletonUrl;

  const player = new (lib().SpinePlayer)(host, cfg);
  try {
    if (player.assetManager && player.context) {
      player.assetManager.textureLoader = () => makeRawGLTexture(player.context, tex.rgba, tex.width, tex.height, false);
    }
  } catch (e) {}
  const _urls = [atlasUrl, skeletonUrl];
  const prevDispose = player.dispose && player.dispose.bind(player);
  player.dispose = function () {
    try {
      if (player.stopRendering) player.stopRendering();
    } catch (e) {}
    try {
      const gl = player.context && player.context.gl;
      const ext = gl && gl.getExtension && gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    } catch (e) {}
    try {
      const dom = player.dom || player.canvas;
      if (dom && dom.parentNode) dom.parentNode.removeChild(dom);
    } catch (e) {}
    for (const u of _urls) {
      try {
        URL.revokeObjectURL(u);
      } catch (e) {}
    }
    if (prevDispose) return prevDispose();
  };
  gateByVisibility(player, host);
  return { player, isJson };
};

const gateByVisibility = (player, host) => {
  let stopped = false;
  const disconnect = utilHelpers.observeVisibility(host, (vis) => {
    if (!vis && !stopped) {
      stopped = true;
      if (player.stopRendering) player.stopRendering();
    } else if (vis && stopped) {
      stopped = false;
      player.stopRequestAnimationFrame = false;
      if (player.drawFrame) player.drawFrame();
    }
  });
  const origDispose = player.dispose && player.dispose.bind(player);
  player.dispose = function () {
    disconnect();
    if (origDispose) return origDispose();
  };
};

export const spineWeb = { lib, runtimeReady, buildPlayable, startDefaultIdle, maybeScaleAtlas, makeRawGLTexture, detectSkeletonIsJson };
