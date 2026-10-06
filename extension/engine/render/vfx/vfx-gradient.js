import * as THREE from '../../../vendor/three.module.js';
import * as TQ from './quarks-ext.js';
import { gammaToLinear as G2L, linearToGamma as L2G } from '../color.js';

const OK_LMS = [
  0.4122214615345001, 0.5363325476646423, 0.05144599452614784,
  0.21190349757671356, 0.6806995272636414, 0.10739696025848389,
  0.08830246329307556, 0.2817188501358032, 0.6299787163734436,
];
const OK_RGB = [
  4.076741695404053, -3.307711601257324, 0.23096993565559387,
  -1.2684379816055298, 2.609757423400879, -0.34131938219070435,
  -0.004196086432784796, -0.7034186124801636, 1.7076146602630615,
];
const cbrt = Math.cbrt || ((x) => (x < 0 ? -Math.pow(-x, 1 / 3) : Math.pow(x, 1 / 3)));

export function unityGradientKeys(g) {
  if (!g) return null;
  const cv = (x) => (x == null ? 1 : Number(x) || 0);
  const nc = Math.max(0, g.m_NumColorKeys | 0);
  const na = Math.max(0, g.m_NumAlphaKeys | 0);
  const color = [];
  const alpha = [];
  for (let i = 0; i < nc; i++) {
    const k = g['key' + i] || {};
    color.push([(g['ctime' + i] || 0) / 65535, cv(k.r), cv(k.g), cv(k.b)]);
  }
  for (let i = 0; i < na; i++) {
    const k = g['key' + i] || {};
    alpha.push([(g['atime' + i] || 0) / 65535, k.a == null ? 1 : k.a]);
  }
  return { mode: g.m_Mode | 0, color, alpha };
}

const _keyCache = new WeakMap();

export function unityGradientKeysCached(g) {
  if (!g || typeof g !== 'object') return null;
  let keys = _keyCache.get(g);
  if (keys === undefined) {
    keys = unityGradientKeys(g);
    _keyCache.set(g, keys);
  }
  return keys;
}

function clampToKeys(keys, t) {
  const lo = keys[0][0];
  const hi = keys[keys.length - 1][0];
  return t < lo ? lo : t > hi ? hi : t;
}

function fixedIndex(keys, t) {
  const x = clampToKeys(keys, t);
  for (let i = 0; i < keys.length; i++) if (keys[i][0] >= x) return i;
  return keys.length - 1;
}

function segment(keys, t, out) {
  if (t <= keys[0][0]) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return out;
  }
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const d = keys[i][0] - keys[i - 1][0];
      out[0] = i - 1;
      out[1] = i;
      out[2] = d > 0 ? (t - keys[i - 1][0]) / d : 0;
      return out;
    }
  }
  const n = keys.length - 1;
  out[0] = n;
  out[1] = n;
  out[2] = 0;
  return out;
}

function perceptualMix(a, b, u, out) {
  const ar = G2L(a[1]),
    ag = G2L(a[2]),
    ab = G2L(a[3]);
  const br = G2L(b[1]),
    bg = G2L(b[2]),
    bb = G2L(b[3]);
  const la = cbrt(OK_LMS[0] * ar + OK_LMS[1] * ag + OK_LMS[2] * ab);
  const ma = cbrt(OK_LMS[3] * ar + OK_LMS[4] * ag + OK_LMS[5] * ab);
  const sa = cbrt(OK_LMS[6] * ar + OK_LMS[7] * ag + OK_LMS[8] * ab);
  const lb = cbrt(OK_LMS[0] * br + OK_LMS[1] * bg + OK_LMS[2] * bb);
  const mb = cbrt(OK_LMS[3] * br + OK_LMS[4] * bg + OK_LMS[5] * bb);
  const sb = cbrt(OK_LMS[6] * br + OK_LMS[7] * bg + OK_LMS[8] * bb);
  const l = la + (lb - la) * u;
  const m = ma + (mb - ma) * u;
  const s = sa + (sb - sa) * u;
  const l3 = l * l * l;
  const m3 = m * m * m;
  const s3 = s * s * s;
  out[0] = L2G(OK_RGB[0] * l3 + OK_RGB[1] * m3 + OK_RGB[2] * s3);
  out[1] = L2G(OK_RGB[3] * l3 + OK_RGB[4] * m3 + OK_RGB[5] * s3);
  out[2] = L2G(OK_RGB[6] * l3 + OK_RGB[7] * m3 + OK_RGB[8] * s3);
  return out;
}

const _seg = [0, 0, 0];
const _mix = [1, 1, 1];

export function sampleUnityGradient(gk, t, out) {
  const o = out || [1, 1, 1, 1];
  o[0] = 1;
  o[1] = 1;
  o[2] = 1;
  o[3] = 1;
  if (!gk) return o;
  const mode = gk.mode;
  const ck = gk.color;
  const ak = gk.alpha;
  if (ck.length >= 2) {
    if (mode === 1) {
      const k = ck[fixedIndex(ck, t)];
      o[0] = k[1];
      o[1] = k[2];
      o[2] = k[3];
    } else {
      segment(ck, t, _seg);
      const a = ck[_seg[0]];
      const b = ck[_seg[1]];
      const u = _seg[2];
      if (mode === 2) {
        perceptualMix(a, b, u, _mix);
        o[0] = _mix[0];
        o[1] = _mix[1];
        o[2] = _mix[2];
      } else {
        o[0] = a[1] + (b[1] - a[1]) * u;
        o[1] = a[2] + (b[2] - a[2]) * u;
        o[2] = a[3] + (b[3] - a[3]) * u;
      }
    }
  }
  if (ak.length >= 2) {
    if (mode === 1) {
      o[3] = ak[fixedIndex(ak, t)][1];
    } else {
      segment(ak, t, _seg);
      const a = ak[_seg[0]];
      const b = ak[_seg[1]];
      o[3] = a[1] + (b[1] - a[1]) * _seg[2];
    }
  }
  return o;
}

const _smp = [1, 1, 1, 1];

class UnityGradient {
  constructor(gk, gkMin) {
    this.type = 'function';
    this.gk = gk;
    this.gkMin = gkMin || null;
    this.indexCount = -1;
  }
  startGen(memory) {
    if (!this.gkMin) return;
    this.indexCount = memory.length;
    memory.push(Math.random());
  }
  genColor(memory, color, t) {
    sampleUnityGradient(this.gk, t, _smp);
    if (!this.gkMin) return color.set(_smp[0], _smp[1], _smp[2], _smp[3]);
    if (this.indexCount === -1) this.startGen(memory);
    const rnd = memory[this.indexCount];
    const mx = [_smp[0], _smp[1], _smp[2], _smp[3]];
    sampleUnityGradient(this.gkMin, t, _smp);
    return color.set(
      _smp[0] + (mx[0] - _smp[0]) * rnd,
      _smp[1] + (mx[1] - _smp[1]) * rnd,
      _smp[2] + (mx[2] - _smp[2]) * rnd,
      _smp[3] + (mx[3] - _smp[3]) * rnd
    );
  }
  toJSON() {
    return { type: 'tp-unity-gradient' };
  }
  clone() {
    return new UnityGradient(this.gk, this.gkMin);
  }
}

export function overLifeGradientGen(mm, tint) {
  if (!mm) return null;
  const state = mm.minMaxState | 0;
  if (state === 1 || state === 3) {
    const gk = unityGradientKeys(mm.maxGradient);
    if (!gk) return null;
    return new UnityGradient(gk, state === 3 ? unityGradientKeys(mm.minGradient) : null);
  }
  if (state === 4) {
    const gk = unityGradientKeys(mm.maxGradient);
    if (gk) return new StartGradient(gk, null, tint, 1, true);
  }
  if (state === 2 && mm.minColor && mm.maxColor) return new TQ.ColorRange(colorToV4(mm.minColor, tint), colorToV4(mm.maxColor, tint));
  const c = mm.maxColor || mm.minColor;
  return c ? new TQ.ConstantColor(colorToV4(c, tint)) : null;
}

const _mulTmp = [1, 1, 1, 1];

export class MultipliedColor {
  constructor(a, b) {
    this.type = 'function';
    this.a = a;
    this.b = b;
  }
  startGen(memory) {
    if (this.a.startGen) this.a.startGen(memory);
    if (this.b.startGen) this.b.startGen(memory);
  }
  genColor(memory, color, t) {
    this.a.genColor(memory, color, t);
    _mulTmp[0] = color.x;
    _mulTmp[1] = color.y;
    _mulTmp[2] = color.z;
    _mulTmp[3] = color.w;
    this.b.genColor(memory, color, t);
    return color.set(color.x * _mulTmp[0], color.y * _mulTmp[1], color.z * _mulTmp[2], color.w * _mulTmp[3]);
  }
  toJSON() {
    return { type: 'tp-multiplied-color' };
  }
  clone() {
    return new MultipliedColor(this.a.clone(), this.b.clone());
  }
}

class StartGradient {
  constructor(gk, gkMin, tint, invDuration, randomTime) {
    this.type = 'function';
    this.gk = gk;
    this.gkMin = gkMin || null;
    this.tint = tint || [1, 1, 1, 1];
    this.invDuration = invDuration;
    this.randomTime = !!randomTime;
    this.indexCount = -1;
  }
  startGen(memory) {
    this.indexCount = memory.length;
    memory.push(Math.random());
  }
  genColor(memory, color, time) {
    if (this.indexCount === -1) this.startGen(memory);
    const rnd = memory[this.indexCount];
    const tn = this.randomTime ? rnd : Math.min(1, Math.max(0, time * this.invDuration));
    sampleUnityGradient(this.gk, tn, _smp);
    let r = _smp[0];
    let g = _smp[1];
    let b = _smp[2];
    let a = _smp[3];
    if (this.gkMin) {
      const r1 = r;
      const g1 = g;
      const b1 = b;
      const a1 = a;
      sampleUnityGradient(this.gkMin, tn, _smp);
      r = _smp[0] + (r1 - _smp[0]) * rnd;
      g = _smp[1] + (g1 - _smp[1]) * rnd;
      b = _smp[2] + (b1 - _smp[2]) * rnd;
      a = _smp[3] + (a1 - _smp[3]) * rnd;
    }
    const t = this.tint;
    return color.set(r * t[0], g * t[1], b * t[2], a);
  }
  toJSON() {
    return { type: 'tp-start-gradient' };
  }
  clone() {
    return new StartGradient(this.gk, this.gkMin, this.tint, this.invDuration, this.randomTime);
  }
}

class RgbOverride {
  constructor(inner, tint) {
    this.type = 'function';
    this.inner = inner;
    this.tint = tint || [1, 1, 1, 1];
  }
  startGen(memory) {
    this.inner.startGen(memory);
  }
  genColor(memory, color, t) {
    this.inner.genColor(memory, color, t);
    color.x = this.tint[0];
    color.y = this.tint[1];
    color.z = this.tint[2];
    return color;
  }
  toJSON() {
    return { type: 'tp-rgb-override' };
  }
  clone() {
    return new RgbOverride(this.inner.clone(), this.tint);
  }
}

function colorToV4(c, tint) {
  const t = tint || [1, 1, 1, 1];
  const r = c && c.r != null ? c.r : 1;
  const g = c && c.g != null ? c.g : 1;
  const b = c && c.b != null ? c.b : 1;
  const a = c && c.a != null ? c.a : 1;
  return new THREE.Vector4(r * t[0], g * t[1], b * t[2], a);
}

export function startColorGen(sc, opt) {
  const o = opt || {};
  const tint = o.tint || [1, 1, 1, 1];
  const duration = Math.max(1e-6, Number(o.duration) || 1);
  let gen = null;
  const state = sc ? sc.minMaxState | 0 : 0;
  if (sc && (state === 1 || state === 3 || state === 4)) {
    const gk = unityGradientKeys(sc.maxGradient);
    if (gk) gen = new StartGradient(gk, state === 3 ? unityGradientKeys(sc.minGradient) : null, tint, 1 / duration, state === 4);
  } else if (sc && state === 2 && sc.minColor && sc.maxColor) {
    gen = new TQ.ColorRange(colorToV4(sc.minColor, tint), colorToV4(sc.maxColor, tint));
  }
  if (!gen) {
    const c = (sc && (sc.maxColor || sc.minColor)) || { r: 1, g: 1, b: 1, a: 1 };
    gen = new TQ.ConstantColor(colorToV4(c, tint));
  }
  return o.ignoreVertexColor ? new RgbOverride(gen, tint) : gen;
}

const _gmax = [1, 1, 1, 1];
function evalGradientAt(g, t, out) {
  return sampleUnityGradient(unityGradientKeysCached(g), t, out || [1, 1, 1, 1]);
}
export function evalMinMaxGradient(mm, rnd, emitT, out) {
  out = out || [1, 1, 1, 1];
  if (!mm) {
    out[0] = out[1] = out[2] = out[3] = 1;
    return out;
  }
  const st = mm.minMaxState;
  if (st === 4) return evalGradientAt(mm.maxGradient, rnd, out);
  if (st === 1) return evalGradientAt(mm.maxGradient, emitT, out);
  if (st === 3) {
    evalGradientAt(mm.maxGradient, emitT, _gmax);
    evalGradientAt(mm.minGradient, emitT, out);
    for (let i = 0; i < 4; i++) out[i] += (_gmax[i] - out[i]) * rnd;
    return out;
  }
  if (st === 2 && mm.minColor && mm.maxColor) {
    const a = mm.minColor,
      b = mm.maxColor,
      u = rnd == null ? 0.5 : rnd;
    out[0] = a.r + (b.r - a.r) * u;
    out[1] = a.g + (b.g - a.g) * u;
    out[2] = a.b + (b.b - a.b) * u;
    out[3] = a.a + (b.a - a.a) * u;
    return out;
  }
  const c = mm.maxColor || mm.minColor || { r: 1, g: 1, b: 1, a: 1 };
  out[0] = c.r;
  out[1] = c.g;
  out[2] = c.b;
  out[3] = c.a;
  return out;
}

export const _testing = { UnityGradient };
