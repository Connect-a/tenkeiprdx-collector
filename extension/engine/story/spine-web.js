import { observeVisibility } from '../../core/visibility.js';
import { spineAtlas } from '../../unity/spine-atlas.js';
const TINY_PNG_BYTES = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const utf8 = new TextDecoder('utf-8');
const DEFAULT_MIX = 0.12;
let _rawSeq = 0;
const lib = () => globalThis.spine;
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
const buildAtlas = (ctx, input) => {
  const S = lib();
  const { text, pages } = spineAtlas.prepareAtlas(input, null);
  if (!pages.length) throw new Error('spineWeb-atlas-has-no-page');
  const cache = new Map();
  const texOf = (tex) => {
    let t = cache.get(tex);
    if (!t) {
      t = makeRawGLTexture(ctx, tex.rgba, tex.width, tex.height, false);
      cache.set(tex, t);
    }
    return t;
  };
  return new S.TextureAtlas(text, (pageName) => {
    const p = pages.find((q) => q.token === pageName) || pages[0];
    if (!p || !p.tex) throw new Error('spineWeb-page-texture-missing:' + pageName);
    return texOf(p.tex);
  });
};

const buildSkeleton = (ctx, input) => {
  const S = lib();
  const atlas = buildAtlas(ctx, input);
  const loader = new S.AtlasAttachmentLoader(atlas);
  const bytes = input.skeletonBytes instanceof Uint8Array ? input.skeletonBytes : new Uint8Array(input.skeletonBytes);
  const data = detectSkeletonIsJson(input.skeletonPath, bytes) ? new S.SkeletonJson(loader).readSkeletonData(utf8.decode(bytes)) : new S.SkeletonBinary(loader).readSkeletonData(bytes);
  const skeleton = new S.Skeleton(data);
  const stateData = new S.AnimationStateData(data);
  stateData.defaultMix = DEFAULT_MIX;
  const state = new S.AnimationState(stateData);
  skeleton.setToSetupPose();
  skeleton.updateWorldTransform();
  const off = new S.Vector2();
  const size = new S.Vector2();
  skeleton.getBounds(off, size, []);
  return { atlas, data, skeleton, state, anims: data.animations.map((a) => a.name), bounds: { x: off.x, y: off.y, w: size.x, h: size.y } };
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

let _deformPatched = false;
const patchStaleDeformOnce = () => {
  if (_deformPatched) return;
  const s = lib();
  const proto = s && s.VertexAttachment && s.VertexAttachment.prototype;
  if (!proto || !proto.computeWorldVertices) return;
  _deformPatched = true;
  const orig = proto.computeWorldVertices;
  proto.computeWorldVertices = function (slot, start, count, worldVertices, offset, stride) {
    const d = slot && slot.deform;
    if (d && d.length && this.vertices) {
      const exp = this.bones ? (this.vertices.length / 3) * 2 : this.vertices.length;
      if (d.length !== exp) d.length = 0;
    }
    return orig.call(this, slot, start, count, worldVertices, offset, stride);
  };
};

const buildPlayable = (host, input, opts) => {
  if (!runtimeReady()) throw new Error('spineWeb-runtime-not-ready');
  patchStaleDeformOnce();
  if (!host) throw new Error('host-missing');
  const o = opts || {};
  const textures = spineAtlas.textureListOf(input);
  if (!input.atlasBytes || !input.skeletonBytes || !textures.length) throw new Error('spineWeb-inputs-incomplete');

  const seq = _rawSeq++;
  const { text: atlasText, pages } = spineAtlas.prepareAtlas(input, (i) => 'tp_raw_' + seq + '_' + i + '.png');
  if (!pages.length) throw new Error('spineWeb-atlas-has-no-page');
  const atlasUrl = URL.createObjectURL(new Blob([atlasText], { type: 'text/plain' }));
  const parent = atlasUrl.slice(0, atlasUrl.lastIndexOf('/'));
  const rawDataURIs = {};
  const texByUrl = new Map();
  const pageUrls = [];
  for (const p of pages) {
    const u = URL.createObjectURL(new Blob([TINY_PNG_BYTES], { type: 'image/png' }));
    pageUrls.push(u);
    rawDataURIs[(parent ? parent + '/' : '') + p.token] = u;
    texByUrl.set(u, p.tex || textures[0]);
  }
  const isJson = detectSkeletonIsJson(input.skeletonPath, input.skeletonBytes);
  const skeletonUrl = URL.createObjectURL(new Blob([input.skeletonBytes], { type: isJson ? 'application/json' : 'application/octet-stream' }));

  let erred = false;
  const cfg = {
    atlasUrl,
    rawDataURIs,
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
  if (player.assetManager && player.context) {
    const cache = new Map();
    player.assetManager.textureLoader = (img) => {
      const t = texByUrl.get(img && img.src) || (pages[0] && pages[0].tex) || textures[0];
      let gt = cache.get(t);
      if (!gt) {
        gt = makeRawGLTexture(player.context, t.rgba, t.width, t.height, false);
        cache.set(t, gt);
      }
      return gt;
    };
  }
  const _urls = [atlasUrl, skeletonUrl, ...pageUrls];
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
  const disconnect = observeVisibility(host, (vis) => {
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

export const spineWeb = { lib, runtimeReady, buildPlayable, buildAtlas, buildSkeleton, startDefaultIdle, makeRawGLTexture, detectSkeletonIsJson, patchStaleDeformOnce };
