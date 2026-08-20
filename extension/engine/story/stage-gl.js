import { spineWeb } from './spine-web.js';
import { utilHelpers } from '../../core/util.js';
import { emoAnim } from './emo-anim.js';
const SP = () => spineWeb.lib();
const GL = () => spineWeb.lib() && spineWeb.lib().webgl;
const ACT_DUR = { 1: 0.5, 2: 1.0, 3: 1.3, 4: 0.25, 6: 0.5, 9: 0.7 };
const EXIT_CODES = new Set([7, 8, 9, 10, 11, 12, 13, 16, 17]);
const EMO_SCALE = 0.33;
const EMO_ANCHOR = { def: [-200, 50], head: [0, 100], sighR: [200, -350], sighL: [-200, -350] };
const EMO_SIZE = { 1: 250, 2: 250, 3: 125, 4: 125, 5: 250, 6: 250, 7: 125, 8: 125, 10: 250, 11: 250, 12: 250, 13: 190, 14: 190, 15: 250, 16: 250, 17: 250, 18: 250 };
const EMO_HEAD_FRAC = 0.9;
const BASE_SCALE = 0.33;
const ZOOM_SCALE = 0.5 / BASE_SCALE;
const ZOOM_Y_REF = -200;

function actionDuration(code) {
  return ACT_DUR[code] || 0.5;
}

function layoutCast(c, b, { W, H, refW, refH, sRef, pinScreen, pinBody }) {
  const zf = c.zoom ? ZOOM_SCALE : 1;
  const baseline = pinScreen - (pinBody * sRef * zf * b.h) / refH;
  const scale = sRef * (H / refH);
  const zoomOff = zf > 1 ? ZOOM_Y_REF * (H / refH) : 0;
  return {
    tx: W * (0.5 + (c.posMapX || 0) / refW),
    y: H * baseline + zoomOff,
    sx: (c.flip ? -scale : scale) * zf,
    sy: scale * zf,
    dim: c.speaking === false ? 0.5 : 1.0,
    anchor: { x: refW / 2 + (c.posMapX || 0), y: refH * (1 - baseline) - (b.y + b.h) * sRef * zf * EMO_HEAD_FRAC },
  };
}

function buildSpineSkeleton(ctx, inputs) {
  const spine = SP();
  let atlasBytes = spineWeb && spineWeb.maybeScaleAtlas ? spineWeb.maybeScaleAtlas(inputs.atlasBytes, inputs.texture.width, inputs.texture.height) : inputs.atlasBytes;
  const atlasText = new TextDecoder('utf-8').decode(atlasBytes);
  const tex = spineWeb.makeRawGLTexture(ctx, inputs.texture.rgba, inputs.texture.width, inputs.texture.height, false);
  const atlas = new spine.TextureAtlas(atlasText, () => tex);
  const loader = new spine.AtlasAttachmentLoader(atlas);
  const isJson = spineWeb && spineWeb.detectSkeletonIsJson ? spineWeb.detectSkeletonIsJson(inputs.skeletonPath, inputs.skeletonBytes) : inputs.skeletonBytes[0] === 0x7b;
  let data;
  if (isJson) {
    const j = new spine.SkeletonJson(loader);
    data = j.readSkeletonData(new TextDecoder('utf-8').decode(inputs.skeletonBytes));
  } else {
    const b = new spine.SkeletonBinary(loader);
    data = b.readSkeletonData(inputs.skeletonBytes instanceof Uint8Array ? inputs.skeletonBytes : new Uint8Array(inputs.skeletonBytes));
  }
  const skeleton = new spine.Skeleton(data);
  const stateData = new spine.AnimationStateData(data);
  stateData.defaultMix = 0.12;
  const state = new spine.AnimationState(stateData);
  skeleton.setToSetupPose();
  skeleton.updateWorldTransform();
  const off = new spine.Vector2(),
    size = new spine.Vector2();
  skeleton.getBounds(off, size, []);
  return { data, skeleton, state, bounds: { x: off.x, y: off.y, w: size.x, h: size.y }, curAnim: null, anims: data.animations.map((a) => a.name) };
}

function create(canvas, opts) {
  const spineRT = SP(),
    wgl = GL();
  if (!spineRT || !wgl || !wgl.SceneRenderer) throw new Error('spineWeb-webgl runtime unavailable');
  const o = opts || {};
  const ctx = new wgl.ManagedWebGLRenderingContext(canvas, { alpha: true, premultipliedAlpha: true, antialias: true });
  const gl = ctx.gl;
  const renderer = new wgl.SceneRenderer(canvas, ctx, true);
  const spine = SP();
  const skels = new Map();
  const cast = new Map();
  let emoInstances = [];
  const emoTexCache = new Map();
  let leaving = [];
  let stillItem = null;
  let mode = 'cast';
  let lastT = 0,
    raf = 0,
    disposed = false,
    onScreen = true;
  const refWidth = () => o.refW || 1136,
    refHeight = () => o.refH || ((o.refW || 1136) * 9) / 16;
  const CAM = Object.assign({ planeZ: 950, worldPerSkel: 0.7, fovDeg: 30 }, o.stillCam || {});
  const fovTan = Math.tan((CAM.fovDeg * Math.PI) / 360);
  const CAM_FIELDS = ['panX', 'panY', 'zoom', 'camX', 'camY', 'camZ'];
  const neutralCam = () => ({ panX: 0, panY: 0, zoom: 1, camX: 0, camY: 0, camZ: 0 });
  let camCur = neutralCam(),
    camFrom = neutralCam(),
    camTo = neutralCam(),
    camT = 0,
    camDur = 0;
  let lastCamKey = '';
  const camFromTriple = (t) => {
    if (!t) return neutralCam();
    const X = Number(t[0]) || 0,
      Y = Number(t[1]) || 0,
      Z = Number(t[2]) || 0;
    return { panX: X / refWidth(), panY: Y / refHeight(), zoom: CAM.planeZ / Math.max(1, CAM.planeZ - Z), camX: X, camY: Y, camZ: Z };
  };
  const snapCamNeutral = () => {
    camCur = neutralCam();
    camFrom = neutralCam();
    camTo = neutralCam();
    camDur = 0;
    camT = 0;
    lastCamKey = '';
  };
  const lerp = (a, b, k) => a + (b - a) * k;

  function ensure(key, inputs) {
    if (skels.has(key)) return skels.get(key);
    let rec = null;
    try {
      rec = buildSpineSkeleton(ctx, inputs);
    } catch (e) {
      console.warn('[tp] stage-gl build失敗', key, e && e.message);
      rec = { dead: true };
    }
    skels.set(key, rec);
    return rec;
  }

  function setAnim(rec, name, loop, timeScale) {
    if (!rec || rec.dead || !name) return;
    const ts = timeScale > 0 ? timeScale : 1;
    if (rec.curAnim === name) {
      if (rec.curEntry && rec.curEntry.timeScale !== ts) rec.curEntry.timeScale = ts;
      return;
    }
    const pick = rec.anims.includes(name) ? name : rec.anims.find((n) => /idle/i.test(n)) || rec.anims[0];
    try {
      const entry = rec.state.setAnimation(0, pick, loop);
      if (entry) entry.timeScale = ts;
      rec.curEntry = entry || null;
      rec.curAnim = name;
    } catch (e) {}
  }

  function appearTr(code) {
    const D = 1500;
    const mk = (mode, axis, sign, dur, opts) => Object.assign({ mode, axis, sign, dur, ease: 'outCubic', dist: D, t: 0, fade: false }, opts || {});
    switch (code) {
      case 1:
        return mk('in', null, 0, 0.3, { fade: true, ease: 'linear' });
      case 2:
        return mk('in', 'y', -1, 0.75);
      case 3:
        return mk('in', 'x', -1, 0.75);
      case 4:
        return mk('in', 'x', 1, 0.75);
      case 5:
        return mk('in', 'x', -1, 0.375);
      case 6:
        return mk('in', 'x', 1, 0.375);
      case 8:
        return mk('out', null, 0, 0.3, { fade: true, ease: 'linear' });
      case 9:
        return mk('out', 'y', -1, 0.75);
      case 10:
        return mk('out', 'x', -1, 0.75);
      case 11:
        return mk('out', 'x', 1, 0.75);
      case 12:
        return mk('out', 'x', -1, 0.25);
      case 13:
        return mk('out', 'x', 1, 0.25);
      case 14:
        return mk('in', 'y', 1, 0.75);
      case 15:
        return mk('in', 'y', 1, 2.0);
      case 16:
        return mk('out', 'y', 1, 0.75);
      case 17:
        return mk('out', 'y', 1, 2.0);
      default:
        return null;
    }
  }

  function resize() {
    const dpr = Math.min(2, self.devicePixelRatio || 1);
    const w = canvas.clientWidth || 900,
      h = canvas.clientHeight || Math.round((w * 9) / 16);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }

  function loop(t) {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    const delta = lastT ? (t - lastT) / 1000 : 0;
    lastT = t;
    if (!onScreen || (globalThis.document && globalThis.document.hidden)) return;
    const W = canvas.width,
      H = canvas.height;
    if (camDur > 0) {
      camT += delta;
      const k = Math.min(1, camT / camDur);
      for (const f of CAM_FIELDS) camCur[f] = lerp(camFrom[f], camTo[f], k);
      if (k >= 1) camDur = 0;
    } else {
      camCur = { ...camTo };
    }
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const cam = renderer.camera;
    const stillM = mode === 'still' && stillItem;
    if (stillM) {
      const b = stillItem.bounds,
        sa = W / H;
      const D = Math.max(1, CAM.planeZ - (camCur.camZ || 0));
      const vh = (2 * D * fovTan) / CAM.worldPerSkel,
        vw = vh * sa;
      cam.position.x = b.x + b.w / 2 + (camCur.camX || 0) / CAM.worldPerSkel;
      cam.position.y = b.y + b.h / 2 + (camCur.camY || 0) / CAM.worldPerSkel;
      cam.setViewport(vw, vh);
      cam.update();
    } else {
      const z = camCur.zoom || 1;
      cam.position.x = W * (0.5 + camCur.panX);
      cam.position.y = H * (0.5 + camCur.panY);
      cam.setViewport(W / z, H / z);
      cam.update();
    }
    renderer.begin();
    const items = mode === 'still' && stillItem ? [stillItem] : [...cast.values(), ...leaving];
    const finishedOut = [];
    for (const it of items) {
      const rec = it.rec;
      if (!rec || rec.dead) continue;
      rec.state.update(delta);
      rec.state.apply(rec.skeleton);
      let ox = 0,
        oy = 0,
        alpha = 1;
      if (it.tr) {
        it.tr.t += delta;
        const k = Math.min(1, it.tr.t / it.tr.dur);
        const e = it.tr.ease === 'linear' ? k : 1 - Math.pow(1 - k, 3);
        const p = it.tr.mode === 'in' ? 1 - e : e;
        const dist = it.tr.dist || 0;
        if (it.tr.axis === 'x') ox = dist * (W / refWidth()) * p * (it.tr.sign || 1);
        else if (it.tr.axis === 'y') oy = dist * (H / refHeight()) * p * (it.tr.sign || 1);
        if (it.tr.fade) alpha = it.tr.mode === 'in' ? k : 1 - k;
        if (k >= 1) {
          if (it.tr.mode === 'out') finishedOut.push(it);
          it.tr = null;
        }
      }
      if (it.act) {
        it.act.t += delta;
        const t = it.act.t;
        if (t >= it.act.dur) it.act = null;
        else {
          const R = H / refHeight();
          const k = t / it.act.dur;
          const outSine = (x) => Math.sin((x * Math.PI) / 2);
          const outCubic = (x) => 1 - Math.pow(1 - x, 3);
          switch (it.act.type) {
            case 1:
              oy += 10 * R * Math.abs(Math.sin(k * Math.PI * 2));
              break;
            case 2: {
              const decay = 1 - k;
              const osc = Math.cos(k * Math.PI * 20);
              ox += 5 * R * decay * osc;
              oy += 5 * R * decay * osc;
              break;
            }
            case 3:
              if (t < 0.6) oy -= 25 * R * outSine(t / 0.6);
              else if (t < 0.8) oy -= 25 * R;
              else oy -= 25 * R * (1 - outCubic((t - 0.8) / 0.5));
              break;
            case 4:
              oy += 10 * R * Math.abs(Math.sin(k * Math.PI));
              break;
            case 6:
              alpha *= 1 - k;
              break;
            case 9:
              oy -= 25 * R * outSine(Math.min(1, t / 0.6));
              alpha *= Math.max(0, 1 - k);
              break;
          }
        }
      }
      rec.skeleton.x = it.tx + ox;
      rec.skeleton.y = it.y + oy;
      rec.skeleton.scaleX = it.sx;
      rec.skeleton.scaleY = it.sy;
      const dv = it.dim != null ? it.dim : 1;
      try {
        rec.skeleton.color.set(dv, dv, dv, alpha);
      } catch (e) {}
      rec.skeleton.updateWorldTransform();
      try {
        renderer.drawSkeleton(rec.skeleton, true);
      } catch (e) {}
    }
    if (finishedOut.length) leaving = leaving.filter((x) => !finishedOut.includes(x));
    if (mode !== 'still' && emoInstances.length) drawEmotions(t, W, H);
    renderer.end();
    if (typeof o.onCam === 'function') o.onCam({ panX: camCur.panX || 0, panY: camCur.panY || 0, zoom: camCur.zoom || 1, mode });
  }

  resize();
  raf = requestAnimationFrame(loop);
  function emoTex(name, sprite) {
    let t = emoTexCache.get(name);
    if (t) return t;
    const id = sprite.canvas.getContext('2d').getImageData(0, 0, sprite.w, sprite.h);
    t = spineWeb.makeRawGLTexture(ctx, new Uint8Array(id.data.buffer), sprite.w, sprite.h, false);
    emoTexCache.set(name, t);
    return t;
  }
  function drawEmotions(nowMs, W, H) {
    const R = H / refHeight();
    for (const em of emoInstances) {
      if (em.t0 == null) em.t0 = nowMs;
      const tSec = (nowMs - em.t0) / 1000;
      if (tSec > em.anim.total + 0.05) { em.done = true; continue; }
      const it = cast.get(em.id);
      if (!it || !it.rec || it.rec.dead) continue;
      const b = it.rec.bounds;
      const baseX = it.tx;
      const headY = it.y + (b.y + b.h) * it.sy * EMO_HEAD_FRAC;
      const v = em.anim.sample(tSec);
      const cx = baseX + (em.anchor[0] + v.x) * EMO_SCALE * R;
      const cy = headY + (em.anchor[1] + v.y) * EMO_SCALE * R;
      const aspect = em.sprite.h / em.sprite.w;
      const w = em.sizeBase * EMO_SCALE * R * v.sx;
      const h = em.sizeBase * EMO_SCALE * R * aspect * v.sy;
      const a = v.a < 0 ? 0 : v.a > 1 ? 1 : v.a;
      if (a <= 0.003 || w <= 0 || h <= 0 || !em.tex) continue;
      const tex = em.tex;
      const col = new spine.Color(a, a, a, a);
      let u0 = em.fx < 0 ? 1 : 0, u2 = em.fx < 0 ? 0 : 1;
      const fill = v.fill == null ? 1 : v.fill < 0 ? 0 : v.fill > 1 ? 1 : v.fill;
      if (fill < 0.999) {
        const left = cx - w / 2;
        renderer.drawTextureUV(tex, left, cy - h / 2, w * fill, h, u0, 0, u0 + (u2 - u0) * fill, 1, col);
      } else {
        renderer.drawTextureUV(tex, cx - w / 2, cy - h / 2, w, h, u0, 0, u2, 1, col);
      }
    }
    if (emoInstances.some((e) => e.done)) emoInstances = emoInstances.filter((e) => !e.done);
  }
  const onResize = () => resize();
  self.addEventListener('resize', onResize);
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => resize());
    ro.observe(canvas);
  }
  const stopVis = utilHelpers.observeVisibility(canvas, (vis) => {
    onScreen = vis;
  });

  const api = {
    ensure,
    setCamera(cam) {
      if (!cam) {
        if (lastCamKey === 'none') return;
        lastCamKey = 'none';
        camFrom = neutralCam();
        camTo = neutralCam();
        camCur = { ...camTo };
        camT = 0;
        camDur = 0;
        return;
      }
      const key = JSON.stringify({ s: cam.s || null, e: cam.e || null, dur: cam.dur || 0 });
      if (lastCamKey === key) return;
      lastCamKey = key;
      const dur = (Number(cam.dur) || 0) / 1000;
      camTo = camFromTriple(cam.e);
      if (dur > 0 && cam.s) {
        camFrom = camFromTriple(cam.s);
        camCur = { ...camFrom };
        camT = 0;
        camDur = dur;
      } else {
        camFrom = { ...camTo };
        camCur = { ...camTo };
        camT = 0;
        camDur = 0;
      }
    },
    snapCameraNeutral() {
      snapCamNeutral();
    },
    showStill(rec, animName, timeScale) {
      mode = 'still';
      cast.clear();
      leaving = [];
      if (!rec || rec.dead) {
        stillItem = null;
        return false;
      }
      setAnim(rec, animName, true, timeScale);
      stillItem = { rec, tx: 0, y: 0, sx: 1, sy: 1, dim: 1, tr: null, bounds: rec.bounds };
      return true;
    },
    setCast(list) {
      mode = 'cast';
      stillItem = null;
      const W = canvas.width,
        H = canvas.height;
      const refW = refWidth(),
        refH = refHeight();
      const sRef = (o.scaleMul || 1) * BASE_SCALE;
      const pinScreen = o.pinScreen != null ? o.pinScreen : 190 / 640;
      const pinBody = o.pinBody != null ? o.pinBody : 0.5;
      const seen = new Set();
      for (const c of list) {
        const rec = c.rec;
        if (!rec || rec.dead) continue;
        setAnim(rec, c.unityAnim, true);
        const b = rec.bounds;
        if (!(b.h > 0)) continue;
        if (EXIT_CODES.has(c.appear)) {
          const it = cast.get(c.id);
          if (it) {
            const tr = appearTr(c.appear);
            cast.delete(c.id);
            if (tr) {
              it.tr = tr;
              leaving.push(it);
            }
          }
          continue;
        }
        seen.add(c.id);
        const L = layoutCast(c, b, { W, H, refW, refH, sRef, pinScreen, pinBody });
        let it = cast.get(c.id);
        if (it) {
          it.rec = rec;
          it.tx = L.tx;
          it.y = L.y;
          it.sx = L.sx;
          it.sy = L.sy;
          it.dim = L.dim;
          it.anchor = L.anchor;
        } else {
          it = { rec, tx: L.tx, y: L.y, sx: L.sx, sy: L.sy, dim: L.dim, anchor: L.anchor, tr: appearTr(c.appear), actLast: 0, act: null };
          cast.set(c.id, it);
        }
        if (c.act && c.act !== 7 && c.act !== 8 && c.act !== it.actLast) {
          it.act = { type: c.act, t: 0, dur: actionDuration(c.act) };
        }
        it.actLast = c.act || 0;
      }
      for (const [id, it] of [...cast]) {
        if (!seen.has(id)) {
          it.tr = { mode: 'out', fade: true, dur: 0.15, t: 0 };
          cast.delete(id);
          leaving.push(it);
        }
      }
    },
    castAnchor(id) {
      const it = cast.get(id);
      return it ? it.anchor : null;
    },
    setEmotions(list) {
      emoInstances = (list || []).map((e) => ({
        id: e.id, code: e.code, name: e.name, sprite: e.sprite,
        tex: (() => { try { return emoTex(e.name, e.sprite); } catch (err) { return null; } })(),
        anim: emoAnim.build(e.code), t0: null, done: false,
        anchor: e.code === 13 ? EMO_ANCHOR.sighR : e.code === 14 ? EMO_ANCHOR.sighL : e.code === 10 ? EMO_ANCHOR.head : EMO_ANCHOR.def,
        fx: e.code === 13 ? -1 : 1,
        sizeBase: EMO_SIZE[e.code] || 250,
      }));
    },
    clearEmotions() { emoInstances = []; },
    camState() {
      return { panX: camCur.panX || 0, panY: camCur.panY || 0, zoom: camCur.zoom || 1, mode };
    },
    clear() {
      mode = 'cast';
      cast.clear();
      leaving = [];
      stillItem = null;
      snapCamNeutral();
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      self.removeEventListener('resize', onResize);
      if (ro) ro.disconnect();
      stopVis();
      try {
        renderer.dispose();
      } catch (e) {}
    },
    _skels: skels,
  };
  return api;
}

export const stageGl = { create };
