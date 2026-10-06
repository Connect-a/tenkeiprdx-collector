import * as THREE from '../../../vendor/three.module.js';

const _AXX = new THREE.Vector3(1, 0, 0);
const _AXY = new THREE.Vector3(0, 1, 0);
const _AXZ = new THREE.Vector3(0, 0, 1);
const _qx = new THREE.Quaternion();
const _qy = new THREE.Quaternion();
const _qz = new THREE.Quaternion();

function unityEulerQuat(out, ex, ey, ez) {
  const d = Math.PI / 180;
  _qx.setFromAxisAngle(_AXX, ex * d);
  _qy.setFromAxisAngle(_AXY, ey * d);
  _qz.setFromAxisAngle(_AXZ, ez * d);
  return out.copy(_qy).multiply(_qx).multiply(_qz);
}

function sampleKeys(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  if (t >= keys[keys.length - 1][0]) return keys[keys.length - 1][1];
  let lo = 0,
    hi = keys.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (keys[m][0] <= t) lo = m;
    else hi = m;
  }
  const a = keys[lo],
    b = keys[hi];
  if (a.length >= 5) {
    const dt = t - a[0];
    const v = ((a[2] * dt + a[3]) * dt + a[4]) * dt + a[1];
    if (Number.isFinite(v)) return v;
  }
  const u = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0;
  return a[1] + (b[1] - a[1]) * u;
}

export const sampleAxis = (arr, t, def) => (arr && arr.length ? sampleKeys(arr, t) : def);

const _scP = new THREE.Vector3();
const _scS = new THREE.Vector3();
const _scV = new THREE.Vector3();
const _scQ = new THREE.Quaternion();
const _scQ2 = new THREE.Quaternion();

export function composeChain(segs, animByPath, t, outPos, outQuat, outScale) {
  _scP.set(0, 0, 0);
  _scQ.set(0, 0, 0, 1);
  _scS.set(1, 1, 1);
  for (const sg of segs) {
    const a = animByPath && animByPath.get(sg.path);
    let lx = sg.pos.x,
      ly = sg.pos.y,
      lz = sg.pos.z,
      gx = sg.scale.x,
      gy = sg.scale.y,
      gz = sg.scale.z;
    _scQ2.set(sg.rot.x, sg.rot.y, sg.rot.z, sg.rot.w);
    if (a) {
      const tt = a.dur > 0.01 ? t % a.dur : t;
      if (a.posKeys) {
        lx = sampleAxis(a.posKeys[0], tt, lx);
        ly = sampleAxis(a.posKeys[1], tt, ly);
        lz = sampleAxis(a.posKeys[2], tt, lz);
      }
      if (a.scaleKeys) {
        gx = sampleAxis(a.scaleKeys[0], tt, gx);
        gy = sampleAxis(a.scaleKeys[1], tt, gy);
        gz = sampleAxis(a.scaleKeys[2], tt, gz);
      }
      if (a.eulerKeys) {
        const es = a.eulerStatic || [0, 0, 0];
        unityEulerQuat(_scQ2, sampleAxis(a.eulerKeys[0], tt, es[0]), sampleAxis(a.eulerKeys[1], tt, es[1]), sampleAxis(a.eulerKeys[2], tt, es[2]));
      }
    }
    _scV.set(lx * _scS.x, ly * _scS.y, lz * _scS.z).applyQuaternion(_scQ);
    _scP.add(_scV);
    _scQ.multiply(_scQ2);
    _scS.set(_scS.x * gx, _scS.y * gy, _scS.z * gz);
  }
  if (outPos) outPos.copy(_scP);
  if (outQuat) outQuat.copy(_scQ);
  if (outScale) outScale.copy(_scS);
}

export function createSpinNodes(group, transformAnims) {
  const nodes = new Map();
  const animByPath = new Map();
  for (const a of transformAnims || []) animByPath.set(a.path, a);
  for (const a of transformAnims || []) {
    const node = new THREE.Group();
    group.add(node);
    nodes.set(a.path, { node, anim: a, chain: a.chain && a.chain.length ? a.chain : null });
  }
  let elapsed = 0;
  const advance = (dt) => {
    elapsed += dt;
    for (const sp of nodes.values()) {
      const a = sp.anim;
      if (sp.chain) {
        composeChain(sp.chain, animByPath, elapsed, sp.node.position, sp.node.quaternion, sp.node.scale);
        continue;
      }
      const es = a.eulerStatic || [0, 0, 0];
      if (a.keys && a.keys.length) {
        const val = sampleKeys(a.keys, elapsed % (a.dur > 0.01 ? a.dur : 10));
        unityEulerQuat(sp.node.quaternion, a.axis === 0 ? val : es[0], a.axis === 1 ? val : es[1], a.axis === 2 ? val : es[2]);
      }
    }
  };
  return { nodes, animByPath, advance };
}

export const _testing = { unityEulerQuat, sampleKeys };
