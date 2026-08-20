import * as THREE from '../../vendor/three.module.js';
import * as TQ from '../../vendor/three.quarks.esm.js';
import { vfxParse } from './vfx-parse.js';

let _softRadial = null;
function softRadialTex() {
  if (_softRadial) return _softRadial;
  const S = 64, cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  _softRadial = new THREE.CanvasTexture(cv);
  _softRadial.needsUpdate = true;
  return _softRadial;
}

const _procCache = new Map();
function proceduralTex(proc) {
  if (!proc || !proc.shader) return softRadialTex();
  const sh = proc.shader, v = proc.vec1 || {};
  const Vf = v['Vector1_f0683063f9b44121bff83e626fd4632a'];
  const V1 = v['Vector1_1'];
  const V9 = v['Vector1_9e0b82cda8e244118777bca7e52af518'];
  let fnR = null, fnUV = null;
  if (sh === 'Shader Graphs/CircleHole_add') {
    const vf = Vf != null ? Vf : 1, v1 = V1 != null ? V1 : 13, v9 = V9 != null ? V9 : 100;
    fnR = (r) => { const a = 2 * r * vf; return Math.max(0, Math.min(1, Math.pow(a, v1) * (1 - Math.pow(a, v9)))); };
  } else if (/Circle_nomal_GF/.test(sh)) {
    const vf = Vf != null ? Vf : 1, v9 = V9 != null ? V9 : 30;
    fnR = (r) => Math.max(0, Math.min(1, 1 - Math.pow(2 * r * vf, v9)));
  } else if (/enemy_fire/.test(sh)) {
    fnR = (r) => Math.max(0, 1 - Math.pow(2.08 * r, 1.22));
  } else if (sh === 'Shader Graphs/SoftSmokeNormal') {
    fnUV = (ux, uy) => { const x = ux * (1 - ux) * uy * (1 - uy); return Math.max(0, Math.min(1, (Math.pow(Math.max(1e-6, x), 0.38) - 0.2176) * 13.63 + 0.2176)); };
  } else if (/MagLine/.test(sh)) {
    fnUV = (ux, uy) => {
      const d1 = Math.hypot(ux - 0.5, uy), d2 = Math.hypot(ux - 0.5, uy - 1), d3 = Math.hypot(ux - 0.5, uy - 0.5);
      const a1 = 1 - Math.pow(1.4 * d1, 20), a2 = 1 - Math.pow(1.4 * d2, 20);
      const u12 = a1 * a2;
      const glow = Math.max(0, 0.59 * (1 - Math.pow(1.94 * d3, 0.57)));
      return Math.max(0, Math.min(1, 0.69 * Math.max(u12, glow) + 0.31 * u12));
    };
  }
  if (!fnR && !fnUV) return softRadialTex();
  const key = sh + '|' + JSON.stringify(v);
  if (_procCache.has(key)) return _procCache.get(key);
  const S = 128, data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const ux = (x + 0.5) / S, uy = (y + 0.5) / S;
    const a = fnUV ? fnUV(ux, uy) : fnR(Math.hypot(ux - 0.5, uy - 0.5));
    const i = (y * S + x) * 4; data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = Math.round(a * 255);
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true;
  _procCache.set(key, tex);
  return tex;
}

function keyframesToBezier(keys, scalar) {
  const curves = [];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i],
      b = keys[i + 1];
    const dt = (b.time - a.time) || 1;
    const p0 = (a.value || 0) * scalar;
    const p3 = (b.value || 0) * scalar;
    const p1 = p0 + ((a.outSlope || 0) * scalar * dt) / 3;
    const p2 = p3 - ((b.inSlope || 0) * scalar * dt) / 3;
    curves.push([new TQ.Bezier(p0, p1, p2, p3), a.time]);
  }
  if (!curves.length) return null;
  return new TQ.PiecewiseBezier(curves);
}

function mmToValue(mm, mul) {
  mul = mul == null ? 1 : mul;
  if (!mm) return new TQ.ConstantValue(0);
  const st = mm.minMaxState;
  const scalar = (mm.scalar || 0) * mul;
  if (st === 0) return new TQ.ConstantValue(scalar);
  if (st === 3) return new TQ.IntervalValue((mm.minScalar || 0) * mul, scalar);
  if (st === 1) {
    const keys = mm.maxCurve && mm.maxCurve.m_Curve;
    const b = keys && keys.length ? keyframesToBezier(keys, scalar) : null;
    return b || new TQ.ConstantValue(scalar);
  }
  if (st === 2) {
    const keys = mm.maxCurve && mm.maxCurve.m_Curve;
    const b = keys && keys.length ? keyframesToBezier(keys, scalar) : null;
    return b || new TQ.ConstantValue(scalar);
  }
  return new TQ.ConstantValue(scalar);
}

function colorToV4(c, tint) {
  const t = tint || [1, 1, 1, 1];
  const r = c && c.r != null ? c.r : 1, g = c && c.g != null ? c.g : 1, b = c && c.b != null ? c.b : 1, a = c && c.a != null ? c.a : 1;
  return new THREE.Vector4(r * t[0], g * t[1], b * t[2], a);
}
function startColorGen(sc, tint) {
  const t = tint || [1, 1, 1, 1];
  if (!sc) return new TQ.ConstantColor(new THREE.Vector4(t[0], t[1], t[2], 1));
  if ((sc.minMaxState === 2 || sc.minMaxState === 3) && sc.minColor && sc.maxColor) {
    return new TQ.ColorRange(colorToV4(sc.minColor, t), colorToV4(sc.maxColor, t));
  }
  const c = sc.maxColor || sc.minColor || { r: 1, g: 1, b: 1, a: 1 };
  const r = c.r == null ? 1 : c.r, g = c.g == null ? 1 : c.g, b = c.b == null ? 1 : c.b, a = c.a == null ? 1 : c.a;
  return new TQ.ConstantColor(new THREE.Vector4(r * t[0], g * t[1], b * t[2], a));
}

function gradientGen(g) {
  if (!g) return null;
  const nc = g.m_NumColorKeys || 0,
    na = g.m_NumAlphaKeys || 0;
  const cstops = [];
  for (let i = 0; i < nc; i++) {
    const k = g['key' + i] || { r: 1, g: 1, b: 1 };
    cstops.push([new THREE.Vector3(k.r, k.g, k.b), (g['ctime' + i] || 0) / 65535]);
  }
  const astops = [];
  for (let i = 0; i < na; i++) {
    const k = g['key' + i] || { a: 1 };
    astops.push([k.a == null ? 1 : k.a, (g['atime' + i] || 0) / 65535]);
  }
  if (!cstops.length) cstops.push([new THREE.Vector3(1, 1, 1), 0]);
  if (!astops.length) astops.push([1, 0]);
  try {
    return new TQ.Gradient(cstops, astops);
  } catch (e) {
    return null;
  }
}

function mapRenderMode(rm) {
  switch (rm | 0) {
    case 1:
      return TQ.RenderMode.StretchedBillBoard;
    case 2:
      return TQ.RenderMode.HorizontalBillBoard;
    case 3:
      return TQ.RenderMode.VerticalBillBoard;
    case 4:
      return TQ.RenderMode.Mesh;
    default:
      return TQ.RenderMode.BillBoard;
  }
}

function isLocalMesh(sys) {
  return (sys.renderAlignment | 0) === 2 && (sys.renderMode | 0) === 0;
}
const REAL_VP = [2.10256, 0, 0, 0, 0, 3.73205, 0, 0, 0, 0, 1.0003, 1, 0, 0, -0.60009, 0];
function makeRealCamera() {
  const cam = new THREE.Camera();
  cam.matrixAutoUpdate = false;
  cam.matrixWorld.identity();
  cam.matrixWorldInverse.identity();
  cam.projectionMatrix.fromArray(REAL_VP);
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  return cam;
}
function qrotVec(q, x, y, z) {
  const qx = q.x || 0, qy = q.y || 0, qz = q.z || 0, qw = q.w == null ? 1 : q.w;
  const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
  return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
}
function qmulQ(a, b) {
  return { x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x, z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z };
}
function evalUnityCurve(keys, f) {
  if (!keys || !keys.length) return 0;
  if (f <= keys[0].time) return keys[0].value || 0;
  const last = keys[keys.length - 1];
  if (f >= last.time) return last.value || 0;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (f <= b.time) {
      const dt = (b.time - a.time) || 1, t = (f - a.time) / dt;
      const m0 = (a.outSlope || 0) * dt, m1 = (b.inSlope || 0) * dt;
      const t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * (a.value || 0) + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * (b.value || 0) + (t3 - t2) * m1;
    }
  }
  return last.value || 0;
}
function makeLocalQuad(sys, texByMatPid) {
  const ps = sys.ps || {}, init = ps.InitialModule || {}, rotM = ps.RotationModule || {};
  const sizeX = (init.startSize && init.startSize.scalar) || 1;
  const sizeY = init.size3D && init.startSizeY ? init.startSizeY.scalar : (init.startSizeX ? init.startSizeX.scalar : sizeX);
  const S = (sys.scale && sys.scale.x) || 1;
  const P = sys.pos || { x: 0, y: 0, z: 0 };
  const q0 = sys.rot || { x: 0, y: 0, z: 0, w: 1 };
  const pv = sys.pivot || { x: 0, y: 0 };
  const U = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  const rc = rotM.enabled ? rotM.curve : null;
  const rScalar = rc ? rc.scalar || 0 : 0;
  const rKeys = rc && rc.maxCurve && rc.maxCurve.m_Curve ? rc.maxCurve.m_Curve : [];
  const curveEval = (f) => evalUnityCurve(rKeys, f);
  const uvM = ps.UVModule || {};
  const entry = texByMatPid && sys.matPid ? texByMatPid.get(sys.matPid) : null;
  let u0 = 0, u1 = 1, v0 = 0, v1 = 1;
  if (uvM.enabled && entry && entry.tex) {
    const tx = Math.max(1, (uvM.tilesX | 0) || 1), ty = Math.max(1, (uvM.tilesY | 0) || 1);
    const animType = uvM.animationType | 0, rowIdx = uvM.rowIndex | 0;
    const frameCount = Math.max(1, animType === 1 ? tx : tx * ty);
    const fv = uvM.frameOverTime ? uvM.frameOverTime.scalar || 0 : 0;
    let frame = Math.min(frameCount - 1, Math.max(0, Math.floor(fv * frameCount)));
    const col = animType === 1 ? frame : frame % tx, row = animType === 1 ? rowIdx : Math.floor(frame / tx);
    u0 = col / tx; u1 = (col + 1) / tx;
    v1 = (ty - row) / ty; v0 = (ty - 1 - row) / ty;
    if (uvM.flipV) { const t = v0; v0 = v1; v1 = t; }
    if (uvM.flipU) { const t = u0; u0 = u1; u1 = t; }
  }
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(12);
  const posAttr = new THREE.BufferAttribute(pos, 3);
  g.setAttribute('position', posAttr);
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([u0, v0, u1, v0, u1, v1, u0, v1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const tex = entry && entry.tex ? entry.tex : proceduralTex(entry && entry.proc);
  const scRaw = (init.startColor && (init.startColor.maxColor || init.startColor)) || { r: 1, g: 1, b: 1, a: 1 };
  const tint = entry && entry.tint ? entry.tint : [1, 1, 1, 1];
  const sc = { r: (scRaw.r == null ? 1 : scRaw.r) * tint[0], g: (scRaw.g == null ? 1 : scRaw.g) * tint[1], b: (scRaw.b == null ? 1 : scRaw.b) * tint[2], a: scRaw.a };
  const additive = (entry && entry.blend ? entry.blend : 'add') === 'add';
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(sc.r, sc.g, sc.b), transparent: true, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
  mat.opacity = 0;
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = sys.sortingOrder || 0;
  const life = (init.startLifetime && init.startLifetime.scalar) || 0.25;
  const delay = (ps.startDelay && ps.startDelay.scalar) || 0;
  const baseA = sc.a == null ? 1 : sc.a;
  const colM = ps.ColorModule || {};
  const grad = colM.enabled && colM.gradient ? colM.gradient.maxGradient : null;
  let alphaKeys = null;
  if (grad && grad.m_NumAlphaKeys) { alphaKeys = []; for (let i = 0; i < grad.m_NumAlphaKeys; i++) { const k = grad['key' + i]; alphaKeys.push([(grad['atime' + i] || 0) / 65535, k && k.a != null ? k.a : 1]); } alphaKeys.sort((a, b) => a[0] - b[0]); }
  let colorKeys = null;
  if (grad && grad.m_NumColorKeys) { colorKeys = []; for (let i = 0; i < grad.m_NumColorKeys; i++) { const k = grad['key' + i]; colorKeys.push([(grad['ctime' + i] || 0) / 65535, k ? k.r : 1, k ? k.g : 1, k ? k.b : 1]); } colorKeys.sort((a, b) => a[0] - b[0]); }
  const chAt = (f, idx) => { if (!colorKeys || !colorKeys.length) return 1; if (f <= colorKeys[0][0]) return colorKeys[0][idx]; for (let i = 0; i < colorKeys.length - 1; i++) { const a = colorKeys[i], b = colorKeys[i + 1]; if (f <= b[0]) { const u = (f - a[0]) / ((b[0] - a[0]) || 1); return a[idx] + (b[idx] - a[idx]) * u; } } return colorKeys[colorKeys.length - 1][idx]; };
  const alphaAt = (f) => {
    if (!alphaKeys || !alphaKeys.length) return f < 0.6 ? 1 : Math.max(0, 1 - (f - 0.6) / 0.4);
    if (f <= alphaKeys[0][0]) return alphaKeys[0][1];
    for (let i = 0; i < alphaKeys.length - 1; i++) { const a = alphaKeys[i], b = alphaKeys[i + 1]; if (f <= b[0]) { const u = (f - a[0]) / ((b[0] - a[0]) || 1); return a[1] + (b[1] - a[1]) * u; } }
    return alphaKeys[alphaKeys.length - 1][1];
  };
  function writeCorners(theta) {
    const s = Math.sin(theta / 2), swq = { x: 0, y: 0, z: s, w: Math.cos(theta / 2) };
    const R = qmulQ(q0, swq);
    for (let i = 0; i < 4; i++) { const lx = (U[i][0] - pv.x) * sizeX, ly = (U[i][1] + pv.y) * sizeY; const rv = qrotVec(R, lx, ly, 0); pos[i * 3] = P.x + S * rv[0]; pos[i * 3 + 1] = P.y + S * rv[1]; pos[i * 3 + 2] = P.z + S * rv[2]; }
    posAttr.needsUpdate = true;
  }
  writeCorners(0);
  let el = 0, theta = 0;
  return {
    mesh,
    update: (dt) => {
      el += dt; const t = el - delay;
      if (t < 0 || t > life) { mesh.visible = false; return; }
      mesh.visible = true;
      const f = t / life;
      theta += -curveEval(f) * rScalar * dt;
      writeCorners(theta);
      mat.color.setRGB(sc.r * chAt(f, 1), sc.g * chAt(f, 2), sc.b * chAt(f, 3));
      mat.opacity = baseA * alphaAt(f);
    },
    dispose: () => { g.dispose(); mat.dispose(); },
  };
}

function makeMaterial(entry) {
  const tex = entry && entry.tex ? entry.tex : proceduralTex(entry && entry.proc);
  const additive = (entry && entry.blend ? entry.blend : 'add') === 'add';
  return new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });
}

function makeEmitter(shapeMod) {
  if (!shapeMod || !shapeMod.enabled) return new TQ.PointEmitter();
  const t = shapeMod.type | 0;
  const D2R = Math.PI / 180;
  const radius = Math.max(0.01, (shapeMod.radius && shapeMod.radius.value) || 0.1);
  const thickness = shapeMod.radiusThickness != null ? shapeMod.radiusThickness : 1;
  const arc = ((shapeMod.arc && shapeMod.arc.value) != null ? shapeMod.arc.value : 360) * D2R;
  const angle = (shapeMod.angle || 0) * D2R;
  try {
    switch (t) {
      case 10:
      case 11:
        return new TQ.CircleEmitter({ radius, arc, thickness });
      case 4:
      case 7:
      case 8:
      case 9:
        return new TQ.ConeEmitter({ radius, arc, thickness, angle });
      case 2:
      case 3:
        return new TQ.HemisphereEmitter({ radius, thickness });
      case 0:
      case 1:
        return new TQ.SphereEmitter({ radius, thickness });
      default:
        return new TQ.SphereEmitter({ radius, thickness });
    }
  } catch (e) {
    return new TQ.PointEmitter();
  }
}

class OrbitVelZ {
  constructor(speedGen, center, quat, scale) {
    this.speed = speedGen; this.type = 'OrbitVelZ';
    this.c = new THREE.Vector3(center.x || 0, center.y || 0, center.z || 0);
    this.q = new THREE.Quaternion(quat.x || 0, quat.y || 0, quat.z || 0, quat.w == null ? 1 : quat.w);
    this.qi = this.q.clone().invert();
    this.s = new THREE.Vector3(scale.x || 1, scale.y || 1, scale.z || 1);
    this._r = new THREE.Vector3(); this._vt = new THREE.Vector3();
  }
  initialize(p) { if (this.speed.startGen) this.speed.startGen(p.memory); if (!p._orbPrev) p._orbPrev = new THREE.Vector3(); else p._orbPrev.set(0, 0, 0); }
  update(p) {
    const w = this.speed.genValue(p.memory, p.age / (p.life || 1));
    this._r.set(p.position.x - this.c.x, p.position.y - this.c.y, p.position.z - this.c.z);
    this._r.applyQuaternion(this.qi);
    this._r.set(this._r.x / this.s.x, this._r.y / this.s.y, this._r.z / this.s.z);
    this._vt.set(-w * this._r.y, w * this._r.x, 0);
    this._vt.set(this._vt.x * this.s.x, this._vt.y * this.s.y, this._vt.z * this.s.z);
    this._vt.applyQuaternion(this.q);
    p.velocity.sub(p._orbPrev).add(this._vt);
    p._orbPrev.copy(this._vt);
  }
  frameUpdate() {}
}

class ClampVelUnity {
  constructor(limitGen, dampen) { this.limit = limitGen; this.dampen = Number(dampen) || 0; this.type = 'ClampVelUnity'; }
  initialize(p) { if (this.limit && this.limit.startGen) this.limit.startGen(p.memory); }
  update(p) {
    const v = p.velocity;
    const sp = Math.hypot(v.x, v.y, v.z);
    if (sp <= 1e-6) return;
    const lim = this.limit && this.limit.genValue ? this.limit.genValue(p.memory, p.age / (p.life || 1)) : Number(this.limit) || 0;
    if (sp > lim) {
      const target = sp + (lim - sp) * this.dampen;
      v.multiplyScalar(target / sp);
    }
  }
  frameUpdate() {}
}

class RandomizeDir {
  constructor(amount) { this.amount = amount; this.type = 'RandomizeDir'; }
  initialize(p) {
    const a = this.amount; if (a <= 0) return;
    const sp = Math.hypot(p.velocity.x, p.velocity.y, p.velocity.z); if (sp < 1e-6) return;
    let rx = Math.random() * 2 - 1, ry = Math.random() * 2 - 1, rz = Math.random() * 2 - 1;
    const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
    const dx = p.velocity.x / sp, dy = p.velocity.y / sp, dz = p.velocity.z / sp;
    let nx = dx + (rx - dx) * a, ny = dy + (ry - dy) * a, nz = dz + (rz - dz) * a;
    const nl = Math.hypot(nx, ny, nz) || 1;
    p.velocity.set((nx / nl) * sp, (ny / nl) * sp, (nz / nl) * sp);
  }
  update() {}
  frameUpdate() {}
}

function buildParams(sys, texByMatPid, loop) {
  const ps = sys.ps || {};
  const init = ps.InitialModule || {},
    em = ps.EmissionModule || {},
    rotMod = ps.RotationModule || {},
    colMod = ps.ColorModule || {},
    sizeMod = ps.SizeModule || {},
    uvMod = ps.UVModule || {},
    shapeMod = ps.ShapeModule || {},
    clampMod = ps.ClampVelocityModule || {};
  const entry = texByMatPid && sys.matPid ? texByMatPid.get(sys.matPid) : null;
  const bursts = (em.m_Bursts || []).map((b) => ({
    time: b.time || 0,
    count: new TQ.ConstantValue(Math.max(1, Math.round((b.countCurve && b.countCurve.scalar) || 1))),
    cycle: b.cycleCount == null ? 1 : b.cycleCount,
    interval: b.repeatInterval || 0.01,
    probability: b.probability == null ? 1 : b.probability,
  }));
  const scaleMag = sys.scale ? (Math.abs(sys.scale.x || 1) + Math.abs(sys.scale.y || 1) + Math.abs(sys.scale.z || 1)) / 3 : 1;
  const velComp = (ps.scalingMode | 0) === 0 ? scaleMag : 1;
  const behaviors = [];
  const velMod = ps.VelocityModule || {};
  if (velMod.enabled && velMod.orbitalZ && (velMod.orbitalZ.scalar || velMod.orbitalZ.minScalar)) {
    const P = sys.pos || { x: 0, y: 0, z: 0 }, qr = sys.rot || { x: 0, y: 0, z: 0, w: 1 }, sc = sys.scale || { x: 1, y: 1, z: 1 };
    behaviors.push(new OrbitVelZ(mmToValue(velMod.orbitalZ), P, qr, sc));
  }
  if (clampMod.enabled) behaviors.push(new ClampVelUnity(mmToValue(clampMod.magnitude, velComp), Number(clampMod.dampen || 0)));
  const rda = shapeMod.enabled ? Number(shapeMod.randomDirectionAmount || 0) : 0;
  if (rda > 0.001) behaviors.push(new RandomizeDir(rda));
  const gm = init.gravityModifier ? (init.gravityModifier.scalar || 0) : 0;
  if (Math.abs(gm) > 1e-6) behaviors.push(new TQ.ApplyForce(new THREE.Vector3(0, 1, 0), new TQ.ConstantValue(-9.81 * gm)));
  if (rotMod.enabled) behaviors.push(new TQ.RotationOverLife(mmToValue(rotMod.curve)));
  if (colMod.enabled) {
    const gg = gradientGen(colMod.gradient && colMod.gradient.maxGradient);
    if (gg) behaviors.push(new TQ.ColorOverLife(gg));
  }
  if (sizeMod.enabled) behaviors.push(new TQ.SizeOverLife(mmToValue(sizeMod.curve)));
  const useTiles = !!(uvMod.enabled && entry && entry.tex);
  const tilesX = useTiles ? Math.max(1, uvMod.tilesX | 0 || 1) : 1,
    tilesY = useTiles ? Math.max(1, uvMod.tilesY | 0 || 1) : 1;
  const animType = uvMod.animationType | 0;
  const frameCount = useTiles ? Math.max(1, animType === 1 ? tilesX : tilesX * tilesY) : 1;
  const rowBase = useTiles && animType === 1 ? (uvMod.rowIndex | 0) * tilesX : 0;
  const fot = uvMod.frameOverTime;
  const fotAnimated = useTiles && fot && (fot.minMaxState === 1 || fot.minMaxState === 2);
  let startTile = rowBase;
  if (fotAnimated) {
    behaviors.push(new TQ.FrameOverLife(mmToValue(fot, frameCount)));
  } else if (useTiles) {
    const fv = fot ? fot.scalar || 0 : 0;
    startTile = rowBase + Math.min(frameCount - 1, Math.max(0, Math.floor(fv * frameCount)));
  }
  const startRotation = mmToValue(init.startRotation);
  const renderMode = mapRenderMode(sys.renderMode);
  const params = {
    duration: ps.lengthInSec || 1,
    looping: loop ? ps.looping !== false : false,
    prewarm: !!ps.prewarm,
    worldSpace: true,
    shape: makeEmitter(shapeMod),
    startLife: mmToValue(init.startLifetime),
    startSpeed: mmToValue(init.startSpeed, velComp),
    startSize: mmToValue(init.startSize),
    startRotation,
    startColor: startColorGen(init.startColor, entry && entry.tint),
    emissionOverTime: mmToValue(em.rate || em.rateOverTime),
    emissionBursts: bursts,
    behaviors,
    material: makeMaterial(entry),
    renderMode,
    uTileCount: tilesX,
    vTileCount: tilesY,
    startTileIndex: new TQ.ConstantValue(startTile),
    renderOrder: sys.sortingOrder || 0,
  };
  if (renderMode === TQ.RenderMode.StretchedBillBoard) {
    params.rendererEmitterSettings = {
      speedFactor: Number(sys.velocityScale || 0),
      lengthFactor: Number(sys.lengthScale != null ? sys.lengthScale : 2),
    };
  }
  return params;
}

function createSceneVfx(bytes, opt) {
  const data = vfxParse.parseVfx(bytes);
  if (!data || !data.systems || !data.systems.length) return null;
  const texByMatPid = (opt && opt.texByMatPid) || null;
  const loop = !!(opt && opt.loop);
  const group = new THREE.Group();
  const batch = new TQ.BatchedRenderer();
  group.add(batch);
  const systems = [];
  const clawAnims = [];
  const delayed = [];
  const psByObjPid = new Map();
  for (const sys of data.systems) {
    if ((sys.renderMode | 0) === 5) continue;
    if (isLocalMesh(sys)) {
      try {
        const cm = makeLocalQuad(sys, texByMatPid);
        group.add(cm.mesh);
        clawAnims.push(cm);
      } catch (e) {}
      continue;
    }
    let ps;
    try {
      ps = new TQ.ParticleSystem(buildParams(sys, texByMatPid, loop));
    } catch (e) {
      continue;
    }
    batch.addSystem(ps);
    try {
      ps.play();
    } catch (err) {}
    const psDelay = (sys.ps && sys.ps.startDelay && Number(sys.ps.startDelay.scalar)) || 0;
    if (psDelay > 1e-4) {
      try { ps.pause(); } catch (err) {}
      delayed.push({ ps, delay: psDelay });
    }
    const e = ps.emitter;
    const p = sys.pos || { x: 0, y: 0, z: 0 },
      r = sys.rot || { x: 0, y: 0, z: 0, w: 1 },
      s = sys.scale || { x: 1, y: 1, z: 1 };
    e.position.set(p.x || 0, p.y || 0, p.z || 0);
    e.quaternion.set(r.x || 0, r.y || 0, r.z || 0, r.w == null ? 1 : r.w);
    const sm = (sys.ps && sys.ps.ShapeModule) || {};
    const sr = sm.enabled ? sm.m_Rotation : null;
    if (sr && (sr.x || sr.y || sr.z)) {
      const D2R = Math.PI / 180;
      const shapeQ = new THREE.Quaternion().setFromEuler(new THREE.Euler((sr.x || 0) * D2R, (sr.y || 0) * D2R, (sr.z || 0) * D2R, 'ZXY'));
      e.quaternion.multiply(shapeQ);
    }
    e.scale.set(s.x || 1, s.y || 1, s.z || 1);
    e.name = sys.name || '';
    group.add(e);
    systems.push(ps);
    if (sys.objPid) psByObjPid.set(String(sys.objPid), ps);
  }
  if (TQ.EmitSubParticleSystem && TQ.SubParticleEmitMode) {
    for (const link of vfxParse.getSubEmitterLinks(data.systems)) {
      const parentPs = link.parent.objPid ? psByObjPid.get(String(link.parent.objPid)) : null;
      const childPs = psByObjPid.get(link.childObjPid);
      if (!parentPs || !childPs || childPs === parentPs) continue;
      const mode = link.type === 0 ? TQ.SubParticleEmitMode.Birth : TQ.SubParticleEmitMode.Death;
      try {
        const beh = new TQ.EmitSubParticleSystem(parentPs, false, childPs.emitter, mode, link.prob);
        if (parentPs.addBehavior) parentPs.addBehavior(beh);
        else parentPs.behaviors.push(beh);
      } catch (err) {}
    }
  }
  let elapsed = 0;
  return {
    group,
    update: (dt) => {
      elapsed += dt;
      for (const d of delayed) {
        if (!d.started && elapsed >= d.delay) { d.started = true; try { d.ps.play(); } catch (e) {} }
      }
      try {
        batch.update(dt);
      } catch (e) {}
      for (const c of clawAnims) { try { c.update(dt); } catch (e) {} }
    },
    dispose: () => {
      try {
        for (const ps of systems) ps.dispose && ps.dispose();
      } catch (e) {}
      for (const c of clawAnims) { try { c.dispose(); } catch (e) {} }
    },
  };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FS_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const THRESH_FRAG = 'uniform sampler2D t; uniform float threshold; varying vec2 vUv;\n' +
  'void main(){ vec4 c = texture2D(t,vUv);\n' +
  ' float br = max(c.r, max(c.g, c.b));\n' +
  ' float knee = threshold * 0.5;\n' +
  ' float soft = clamp(br - threshold + knee, 0.0, 2.0*knee);\n' +
  ' soft = soft*soft / (4.0*knee + 1e-4);\n' +
  ' float w = max(soft, br - threshold) / max(br, 1e-4);\n' +
  ' gl_FragColor = vec4(c.rgb * w, 1.0); }';
const BLUR_FRAG = 'uniform sampler2D t; uniform vec2 dir; varying vec2 vUv;\n' +
  'void main(){ vec4 c = texture2D(t,vUv)*0.227027;' +
  ' c += texture2D(t,vUv+dir*1.3846)*0.316216; c += texture2D(t,vUv-dir*1.3846)*0.316216;' +
  ' c += texture2D(t,vUv+dir*3.2308)*0.070270; c += texture2D(t,vUv-dir*3.2308)*0.070270;' +
  ' gl_FragColor = c; }';
const COPY_FRAG = 'uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = texture2D(t,vUv); }';
const GLOW_FRAG = 'uniform sampler2D t; uniform float intensity; varying vec2 vUv;\n' +
  'void main(){ vec4 c = texture2D(t,vUv); gl_FragColor = vec4(c.rgb*intensity, c.a*intensity); }';

function createOverlay(canvas) {
  let renderer = null,
    scene = null,
    camera = null,
    raf = 0,
    fx = null,
    curW = 1136,
    curH = 640,
    bloom = null,
    _glHooked = false,
    _origRandom = null;
  function ensureBloom(w, h) {
    const opt = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, depthBuffer: false };
    const fw = Math.max(2, w | 0), fh = Math.max(2, h | 0), hw = Math.max(1, fw >> 1), hh = Math.max(1, fh >> 1);
    if (bloom && bloom.fw === fw && bloom.fh === fh) return bloom;
    if (bloom) { try { bloom.rtScene.dispose(); bloom.rtA.dispose(); bloom.rtB.dispose(); } catch (e) {} }
    const rtScene = new THREE.WebGLRenderTarget(fw, fh, { ...opt, type: THREE.HalfFloatType });
    const rtA = new THREE.WebGLRenderTarget(hw, hh, opt), rtB = new THREE.WebGLRenderTarget(hw, hh, opt);
    if (!bloom) {
      const fsScene = new THREE.Scene(), fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const threshMat = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, threshold: { value: 0.9 } }, vertexShader: FS_VERT, fragmentShader: THRESH_FRAG, depthTest: false, depthWrite: false });
      const blurMat = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, dir: { value: new THREE.Vector2() } }, vertexShader: FS_VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false });
      const copyMat = new THREE.ShaderMaterial({ uniforms: { t: { value: null } }, vertexShader: FS_VERT, fragmentShader: COPY_FRAG, depthTest: false, depthWrite: false, transparent: true, blending: THREE.NoBlending });
      const glowMat = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, intensity: { value: 1.0 } }, vertexShader: FS_VERT, fragmentShader: GLOW_FRAG, depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending });
      const fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copyMat);
      fsScene.add(fsQuad);
      bloom = { fsScene, fsCam, fsQuad, threshMat, blurMat, copyMat, glowMat };
    }
    bloom.rtScene = rtScene; bloom.rtA = rtA; bloom.rtB = rtB; bloom.fw = fw; bloom.fh = fh; bloom.hw = hw; bloom.hh = hh;
    return bloom;
  }
  function renderBloom() {
    const pr = renderer.getPixelRatio();
    const b = ensureBloom(curW * pr, curH * pr);
    const drawFs = (mat) => { b.fsQuad.material = mat; renderer.render(b.fsScene, b.fsCam); };
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(b.rtScene); renderer.clear(); renderer.render(scene, camera);
    b.threshMat.uniforms.t.value = b.rtScene.texture;
    renderer.setRenderTarget(b.rtA); renderer.clear(); drawFs(b.threshMat);
    b.blurMat.uniforms.t.value = b.rtA.texture; b.blurMat.uniforms.dir.value.set(2.5 / b.hw, 0);
    renderer.setRenderTarget(b.rtB); renderer.clear(); drawFs(b.blurMat);
    b.blurMat.uniforms.t.value = b.rtB.texture; b.blurMat.uniforms.dir.value.set(0, 2.5 / b.hh);
    renderer.setRenderTarget(b.rtA); renderer.clear(); drawFs(b.blurMat);
    renderer.setRenderTarget(null); renderer.clear();
    b.copyMat.uniforms.t.value = b.rtScene.texture; drawFs(b.copyMat);
    b.glowMat.uniforms.t.value = b.rtA.texture; drawFs(b.glowMat);
    renderer.autoClear = prevAuto;
  }
  function seedOn() {
    if (_origRandom) return;
    _origRandom = Math.random;
    const rng = mulberry32(0x9e3779b9);
    Math.random = rng;
  }
  function seedOff() {
    if (_origRandom) {
      Math.random = _origRandom;
      _origRandom = null;
    }
  }
  function ensure() {
    if (renderer) return true;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, premultipliedAlpha: false, antialias: true });
      renderer.setClearColor(0x000000, 0);
      if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace || 'srgb';
      scene = new THREE.Scene();
      if (!_glHooked) {
        _glHooked = true;
        canvas.addEventListener(
          'webglcontextlost',
          (e) => {
            e.preventDefault();
            if (raf) cancelAnimationFrame(raf);
            raf = 0;
            if (fx) {
              try {
                fx.dispose();
              } catch (er) {}
              fx = null;
            }
            try {
              if (renderer) renderer.dispose();
            } catch (er) {}
            renderer = null;
            scene = null;
            bloom = null;
          },
          false,
        );
      }
    } catch (e) {
      return false;
    }
    return true;
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (fx) {
      try {
        scene.remove(fx.group);
        fx.dispose();
      } catch (e) {}
      fx = null;
    }
    if (renderer) renderer.clear();
    seedOff();
  }
  function play(bytes, texByMatPid, durMs, opt) {
    if (!bytes || !ensure()) return;
    stop();
    const w = canvas.clientWidth || 1136,
      h = canvas.clientHeight || 640;
    curW = w;
    curH = h;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    const deterministicSeed = !(opt && opt.deterministicSeed === false);
    if (deterministicSeed) seedOn();
    const loop = !!(opt && opt.loop);
    fx = createSceneVfx(bytes, { texByMatPid, loop });
    if (!fx) return;
    camera = makeRealCamera();
    scene.add(fx.group);
    const speed = opt && Number(opt.speed) > 0 ? Number(opt.speed) : 1;
    const STEP = 1000 / 60;
    let prev = performance.now(),
      acc = 0,
      simMs = 0;
    const step = (t) => {
      acc += (t - prev) * speed;
      prev = t;
      let guard = 0;
      try {
        fx.group.updateMatrixWorld(true);
        while (acc >= STEP && guard++ < 8) {
          fx.update(1 / 60);
          acc -= STEP;
          simMs += STEP;
        }
        renderBloom();
      } catch (e) {
        try { renderer.setRenderTarget(null); } catch (e2) {}
        stop();
        return;
      }
      if (!loop && simMs >= (durMs || 1500)) {
        stop();
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  return { play, stop };
}

export const sceneVfx = { createSceneVfx, createOverlay };
