import { spineWeb } from './spine-web.js';
import { observeVisibility } from '../../core/visibility.js';
import { createMosaicPass } from './mosaic-pass.js';
import { slotGroup } from './slot-group.js';
import { createStageCamera } from './stage-camera.js';
import { createCastScene } from './stage-cast.js';
import { createStillScene } from './stage-still.js';

const MOSAIC_RE = /mosaic/i;
const MOSAIC_REF_BLOCK = 10;
const spineLib = () => spineWeb.lib();
const spineGl = () => spineWeb.lib() && spineWeb.lib().webgl;

function buildSpineSkeleton(ctx, inputs) {
  const base = spineWeb.buildSkeleton(ctx, inputs);
  const bone = base.skeleton.findBone('adventure_position');
  return {
    ...base,
    advBone: bone ? { x: bone.worldX, y: bone.worldY } : null,
    emotionBone: base.skeleton.findBone('emotion'),
    curAnim: null,
    hasMosaic: base.data.slots.some((s) => MOSAIC_RE.test(s.name)),
    slotGroups: base.data.slots.map((s) => slotGroup(s.name)),
  };
}

function create(canvas, opts) {
  const wgl = spineGl();
  if (!spineLib() || !wgl || !wgl.SceneRenderer) throw new Error('spineWeb-webgl runtime unavailable');
  if (spineWeb.patchStaleDeformOnce) spineWeb.patchStaleDeformOnce();
  const cfg = opts || {};
  const ctx = new wgl.ManagedWebGLRenderingContext(canvas, { alpha: true, premultipliedAlpha: true, antialias: true });
  const gl = ctx.gl;
  const renderer = new wgl.SceneRenderer(canvas, ctx, true);
  const mosaicOn = cfg.mosaicOn || (() => false);
  const onStill = cfg.onStill || (() => {});
  const refSize = () => {
    const w = cfg.refW || 1136;
    return { w, h: cfg.refH || (w * 9) / 16 };
  };
  const layout = {
    scaleMul: cfg.scaleMul || 1,
    pinScreen: cfg.pinScreen != null ? cfg.pinScreen : 190 / 640,
    pinScreenAdv: cfg.pinScreenAdv != null ? cfg.pinScreenAdv : 0.075,
    pinBody: cfg.pinBody != null ? cfg.pinBody : 0.5,
  };
  const CAM = Object.assign({ planeZ: 950, worldPerSkel: 0.7, fovDeg: 30 }, cfg.stillCam || {});
  const stageCam = createStageCamera({ planeZ: CAM.planeZ, worldPerSkel: CAM.worldPerSkel, fovDeg: CAM.fovDeg, refSize });

  const skelCache = new Map();
  const unbuildable = new Set();
  let mosaic = null;
  let lastFrameMs = 0;
  let raf = 0;
  let disposed = false;
  let onScreen = true;

  const drawSkeleton = (sk) => renderer.drawSkeleton(sk, true);

  function setAnim(rec, name, loop, timeScale) {
    if (!rec || !name) return;
    const ts = timeScale > 0 ? timeScale : 1;
    if (rec.curAnim === name) {
      if (rec.curEntry && rec.curEntry.timeScale !== ts) rec.curEntry.timeScale = ts;
      return;
    }
    const pick = rec.anims.includes(name) ? name : rec.anims.find((n) => /idle/i.test(n)) || rec.anims[0];
    if (!pick) return;
    const entry = rec.state.setAnimation(0, pick, loop);
    if (entry) entry.timeScale = ts;
    rec.curEntry = entry || null;
    rec.curAnim = name;
  }

  const emotionTexCache = new WeakMap();
  const emotionTexture = (spriteName) => {
    const sprite = cfg.emotionSprite ? cfg.emotionSprite(spriteName) : null;
    if (!sprite) return null;
    let tex = emotionTexCache.get(sprite);
    if (!tex) {
      const pixels = sprite.canvas.getContext('2d').getImageData(0, 0, sprite.w, sprite.h);
      tex = spineWeb.makeRawGLTexture(ctx, new Uint8Array(pixels.data.buffer), sprite.w, sprite.h, false);
      emotionTexCache.set(sprite, tex);
    }
    return tex;
  };

  const castScene = createCastScene({ canvas, renderer, drawSkeleton, setAnim, emotionTexture, layout, refSize });
  const stillScene = createStillScene({ gl, canvas, renderer, drawSkeleton, setAnim, onStill });
  let scene = castScene;
  const mode = () => (scene === stillScene ? 'still' : 'cast');

  function toStill() {
    castScene.clear();
    scene = stillScene;
  }

  function toCast() {
    stillScene.clear();
    scene = castScene;
  }

  async function ensureSkeleton(key, makeInputs) {
    if (skelCache.has(key)) return skelCache.get(key);
    if (unbuildable.has(key)) return null;
    let inputs = null;
    try {
      inputs = await makeInputs();
    } catch (e) {
      inputs = null;
    }
    if (!inputs) return null;
    let rec = null;
    try {
      rec = buildSpineSkeleton(ctx, inputs);
    } catch (e) {
      console.warn('[tp] stage-gl build失敗', key, e && e.message);
      unbuildable.add(key);
      return null;
    }
    skelCache.set(key, rec);
    return rec;
  }

  function resize() {
    const dpr = Math.min(2, self.devicePixelRatio || 1);
    const w = canvas.clientWidth || 900;
    const h = canvas.clientHeight || Math.round((w * 9) / 16);
    const nw = Math.round(w * dpr);
    const nh = Math.round(h * dpr);
    if (nw === canvas.width && nh === canvas.height) return;
    canvas.width = nw;
    canvas.height = nh;
    castScene.relayout();
  }

  function clearTarget(W, H) {
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  function loop(nowMs) {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    const dt = lastFrameMs ? (nowMs - lastFrameMs) / 1000 : 0;
    lastFrameMs = nowMs;
    if (!onScreen || (globalThis.document && globalThis.document.hidden)) return;
    const W = canvas.width;
    const H = canvas.height;
    stageCam.step(dt);
    scene.step(dt);
    let mosaicActive = false;
    if (mosaicOn() && scene.skeletons().some((rec) => rec.hasMosaic)) {
      if (!mosaic) mosaic = createMosaicPass(gl);
      mosaicActive = mosaic.ensure(W, H);
    }
    const view = stageCam.frame(W, H, scene.cameraBounds());
    const cam = renderer.camera;
    cam.position.x = view.x;
    cam.position.y = view.y;
    cam.setViewport(view.vw, view.vh);
    cam.update();
    if (mosaicActive) mosaic.bindScene();
    clearTarget(W, H);
    scene.render({ nowMs, mosaicActive });
    if (mosaicActive) {
      mosaic.bindMask();
      clearTarget(W, H);
      scene.renderMosaic();
      const block = Math.max(3, Math.round((W / refSize().w) * MOSAIC_REF_BLOCK));
      mosaic.composite(W / block, H / block);
    }
    if (typeof cfg.onCam === 'function') cfg.onCam(stageCam.state(mode()));
  }

  resize();
  raf = requestAnimationFrame(loop);
  const onResize = () => resize();
  self.addEventListener('resize', onResize);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  if (ro) ro.observe(canvas);
  const stopVis = observeVisibility(canvas, (visible) => {
    onScreen = visible;
  });

  return {
    ensureSkeleton,
    setCamera(cam) {
      stageCam.set(cam);
    },
    showStill(rec, animName, timeScale) {
      toStill();
      return stillScene.show(rec, animName, timeScale);
    },
    setStillVisibility(map) {
      stillScene.setVisibility(map);
    },
    setStillClean(v) {
      stillScene.setClean(v);
    },
    setStillSpeed(v) {
      stillScene.setSpeed(v);
    },
    setUserZoom(v) {
      stageCam.setUserZoom(v);
    },
    setUserPan(x, y) {
      stageCam.setUserPan(x, y);
    },
    setCast(list) {
      toCast();
      castScene.setCast(list);
    },
    clear() {
      toCast();
      castScene.clear();
      stageCam.snapNeutral();
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      self.removeEventListener('resize', onResize);
      if (ro) ro.disconnect();
      stopVis();
      if (mosaic) mosaic.dispose();
      mosaic = null;
      stillScene.dispose();
      renderer.dispose();
    },
  };
}

export const stageGl = { create };
