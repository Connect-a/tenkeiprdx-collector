import * as THREE from '../../../vendor/three.module.js';
import { evalHermite } from './vfx-curve.js';
import { DEFAULT_VCAM_FOV } from './vfx-constants.js';

export function createCameraTrack(ctx, cameras) {
  const data = { cameras: cameras || [] };
  const animByPath = ctx.animByPath;
  const spinNodes = ctx.spinNodes;
  const scheduleFor = ctx.scheduleFor;
  const activeAt = ctx.activeAt;
  const gateDur = ctx.gateDur || 0;
  const svComposeChain = ctx.composeChain;
  const sampleAxis = ctx.sampleAxis;
  const camSamplers = new Map();
  const makeCamSampler = (c) => {
    const segs = (c.chain || []).map((sg) => ({ sg, anim: animByPath.get(sg.path) || null }));
    const hasTr = segs.some((s) => s.anim && (s.anim.posKeys || s.anim.eulerKeys || s.anim.scaleKeys));
    const hasLens = !!(c.fovKeys || c.dutchKeys);
    const hasShake = !!(c.shake && (c.shake.ampKeys || c.shake.freqKeys));
    if (!hasTr && !hasLens && !hasShake) return null;
    const out = { ...c, pos: { x: c.pos.x, y: c.pos.y, z: c.pos.z }, rot: { x: c.rot.x, y: c.rot.y, z: c.rot.z, w: c.rot.w } };
    if (c.shake) out.shake = { ...c.shake };
    const lensDur = c.lensCurveDur > 0.01 ? c.lensCurveDur : 0;
    const shakeDur = c.shake && c.shake.curveDur > 0.01 ? c.shake.curveDur : 0;
    const sampleLens = (t) => {
      if (hasLens) {
        const tt = lensDur ? t % lensDur : t;
        if (c.fovKeys) out.fov = sampleAxis(c.fovKeys, tt, c.fov);
        if (c.dutchKeys) out.dutch = sampleAxis(c.dutchKeys, tt, c.dutch);
      }
      if (hasShake) {
        const tt = shakeDur ? t % shakeDur : t;
        if (c.shake.ampKeys) out.shake.amp = sampleAxis(c.shake.ampKeys, tt, c.shake.amp);
        if (c.shake.freqKeys) out.shake.freq = sampleAxis(c.shake.freqKeys, tt, c.shake.freq);
      }
    };
    const _cp = new THREE.Vector3();
    const _cq = new THREE.Quaternion();
    return (t) => {
      sampleLens(t);
      if (hasTr) {
        svComposeChain(c.chain || [], animByPath, t, _cp, _cq, null);
        out.pos.x = _cp.x;
        out.pos.y = _cp.y;
        out.pos.z = _cp.z;
        out.rot.x = _cq.x;
        out.rot.y = _cq.y;
        out.rot.z = _cq.z;
        out.rot.w = _cq.w;
      }
      return out;
    };
  };
  const camStateAt = (c, t) => {
    if (!c) return c;
    if (!camSamplers.has(c)) camSamplers.set(c, makeCamSampler(c));
    const s = camSamplers.get(c);
    return s ? s(t) : c;
  };
  const cams = (data.cameras || []).map((c) => ({ cam: c, keys: scheduleFor(c.path) }));
  const blends = ((cameras && cameras.blendLists) || []).map((b) => ({ bl: b, keys: scheduleFor(b.path) }));
  const _bq = new THREE.Quaternion();
  const _bq2 = new THREE.Quaternion();
  const _blended = { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0, w: 1 }, fov: DEFAULT_VCAM_FOV, near: 0.1, far: 2000, dutch: 0, lookAt: null, shake: null, priority: 0 };
  const _bshake = { amp: 0, freq: 0, pos: null, rot: null, offsets: null };
  const BLEND_TANGENTS = [null, [0, 0], [1.4, 0], [0, 1.4], [0, 3], [3, 0], [1, 1]];
  const blendTimeOf = (s) => ((s.blendStyle | 0) === 0 ? 0 : Math.max(0, Number(s.blendTime) || 0));
  const stepDur = (s) => Math.max(0, Number(s.hold) || 0) + blendTimeOf(s);
  const blendWeight = (u, step) => {
    const x = u <= 0 ? 0 : u >= 1 ? 1 : u;
    const style = step.blendStyle | 0;
    let w;
    if (style === 7) {
      const kk = step.blendCurve;
      if (!kk || kk.length < 2) return 1;
      w = evalHermite(kk, x);
    } else {
      const tg = BLEND_TANGENTS[style] || [0, 0];
      const x2 = x * x,
        x3 = x2 * x;
      w = tg[0] * (x3 - 2 * x2 + x) + (3 * x2 - 2 * x3) + tg[1] * (x3 - x2);
    }
    return w <= 0 ? 0 : w >= 1 ? 1 : w;
  };
  const blendAt = (bl, t) => {
    const steps = bl.steps;
    if (steps.length === 1) return camStateAt(steps[0].cam, t);
    let total = 0;
    for (const s of steps) total += stepDur(s);
    let x = t;
    if (bl.loop && total > 0.01) x = t % total;
    let acc = 0,
      i = 0;
    for (; i < steps.length - 1; i++) {
      const d = stepDur(steps[i]);
      if (x < acc + d) break;
      acc += d;
    }
    const cur = steps[i];
    const prv = i > 0 ? steps[i - 1] : null;
    const bt = blendTimeOf(cur);
    const local = x - acc;
    if (!prv || bt <= 1e-4 || local >= bt) return camStateAt(cur.cam, t);
    const u = blendWeight(local / bt, cur);
    const a = camStateAt(prv.cam, t),
      b = camStateAt(cur.cam, t);
    const o = _blended;
    o.pos.x = a.pos.x + (b.pos.x - a.pos.x) * u;
    o.pos.y = a.pos.y + (b.pos.y - a.pos.y) * u;
    o.pos.z = a.pos.z + (b.pos.z - a.pos.z) * u;
    _bq.set(a.rot.x || 0, a.rot.y || 0, a.rot.z || 0, a.rot.w == null ? 1 : a.rot.w);
    _bq2.set(b.rot.x || 0, b.rot.y || 0, b.rot.z || 0, b.rot.w == null ? 1 : b.rot.w);
    _bq.slerp(_bq2, u);
    o.rot.x = _bq.x;
    o.rot.y = _bq.y;
    o.rot.z = _bq.z;
    o.rot.w = _bq.w;
    o.fov = a.fov + (b.fov - a.fov) * u;
    o.near = a.near + (b.near - a.near) * u;
    o.far = a.far + (b.far - a.far) * u;
    o.dutch = a.dutch + (b.dutch - a.dutch) * u;
    o.lookAt = null;
    if (a.shake || b.shake) {
      const src = b.shake || a.shake;
      _bshake.amp = ((a.shake && a.shake.amp) || 0) * (1 - u) + ((b.shake && b.shake.amp) || 0) * u;
      _bshake.freq = src.freq;
      _bshake.pos = src.pos;
      _bshake.rot = src.rot;
      _bshake.offsets = src.offsets;
      o.shake = _bshake;
    } else o.shake = null;
    return o;
  };
  let lastCam = null;
  let _elapsed = 0;
  const _laV = new THREE.Vector3();
  const _laQ = new THREE.Quaternion();
  const _laOff = new THREE.Vector3();
  const liveLookAt = (c) => {
    if (!c || !c.lookAtPath || !c.lookAt) return c;
    if (!c.aimBase) c.aimBase = { pos: c.lookAt, rot: c.lookAtRot || { x: 0, y: 0, z: 0, w: 1 } };
    const spin = spinNodes.get(c.lookAtPath);
    if (spin && spin.chain && spin.node) {
      spin.node.getWorldPosition(_laV);
      spin.node.getWorldQuaternion(_laQ);
      c.aimBase = { pos: { x: _laV.x, y: _laV.y, z: _laV.z }, rot: { x: _laQ.x, y: _laQ.y, z: _laQ.z, w: _laQ.w } };
    }
    const o = c.aim && c.aim.offset;
    if (o && (o.x || o.y || o.z)) {
      const r = c.aimBase.rot;
      _laOff.set(o.x, o.y, o.z).applyQuaternion(_laQ.set(r.x || 0, r.y || 0, r.z || 0, r.w == null ? 1 : r.w));
      c.lookAt = { x: c.aimBase.pos.x + _laOff.x, y: c.aimBase.pos.y + _laOff.y, z: c.aimBase.pos.z + _laOff.z };
    } else {
      c.lookAt = c.aimBase.pos;
    }
    c.lookAtRot = c.aimBase.rot;
    return c;
  };
  const activeCamera = () => {
    if (!cams.length) return null;
    const gt = gateDur > 0.01 ? _elapsed % gateDur : _elapsed;
    let bl = null;
    for (const e of blends) {
      if (e.keys && !activeAt(e.keys, gt)) continue;
      if (!bl || e.bl.priority > bl.bl.priority) bl = e;
    }
    let best = null;
    for (const c of cams) {
      if (c.cam.inBlendList) continue;
      if (c.keys && !activeAt(c.keys, gt)) continue;
      if (!best || c.cam.priority > best.cam.priority) best = c;
    }
    if (bl && (!best || bl.bl.priority >= best.cam.priority)) {
      lastCam = blendAt(bl.bl, gt);
      return lastCam;
    }
    lastCam = liveLookAt(best ? camStateAt(best.cam, gt) : camStateAt((cams.find((c) => !c.cam.inBlendList) || cams[0]).cam, gt));
    return lastCam;
  };
  return {
    activeCamera(elapsed) {
      _elapsed = elapsed;
      return activeCamera();
    },
    get last() {
      return lastCam;
    },
    get cameras() {
      return cams.map((c) => c.cam);
    },
    get count() {
      return cams.length;
    },
  };
}
