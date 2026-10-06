import * as THREE from '../../../vendor/three.module.js';
import * as TQ from './quarks-ext.js';
import { unityNoise, makeNoiseOffsets, remapNoise, noiseRemapOf } from './vfx-noise.js';
import { mmToValue, mmIsActive } from './vfx-minmax.js';
import { orbitalVelocity } from './vfx-orbital.js';

const genVal = (g, p, t) => (g && g.genValue ? g.genValue(p.memory, t) : 0);
const startGen = (g, p) => {
  if (g && g.startGen) g.startGen(p.memory);
};

class VelocityUnity {
  constructor(spec) {
    this.type = 'tp-velocity';
    this.lin = spec.lin || null;
    this.orb = spec.orb || null;
    this.off = spec.off || null;
    this.radial = spec.radial || null;
    this.speedMod = spec.speedMod || null;
    this.center = spec.center ? spec.center.clone() : new THREE.Vector3();
    this.q = spec.quat ? spec.quat.clone() : new THREE.Quaternion();
    this.qi = this.q.clone().invert();
    this.s = spec.scale ? spec.scale.clone() : new THREE.Vector3(1, 1, 1);
    this.worldSpace = !!spec.worldSpace;
    this.simWorld = !!spec.simWorld;
    this._add = new THREE.Vector3();
    this._r = new THREE.Vector3();
    this._t = new THREE.Vector3();
  }
  reset() {}
  toLocal(v) {
    const s = this.s;
    v.set(Math.abs(s.x) > 1e-6 ? v.x / s.x : 0, Math.abs(s.y) > 1e-6 ? v.y / s.y : 0, Math.abs(s.z) > 1e-6 ? v.z / s.z : 0);
    return v;
  }
  initialize(p) {
    for (const g of [this.lin, this.orb, this.off]) if (g) for (const k of ['x', 'y', 'z']) startGen(g[k], p);
    if (this.radial) startGen(this.radial, p);
    if (this.speedMod) startGen(this.speedMod, p);
    if (!p._tpVel) p._tpVel = new THREE.Vector3();
    else p._tpVel.set(0, 0, 0);
  }
  update(p, dt) {
    const t = p.age / (p.life || 1);
    const add = this._add.set(0, 0, 0);
    if (this.lin) {
      this._t.set(genVal(this.lin.x, p, t), genVal(this.lin.y, p, t), genVal(this.lin.z, p, t));
      if (this.simWorld && !this.worldSpace) this._t.multiply(this.s).applyQuaternion(this.q);
      else if (!this.simWorld && this.worldSpace) this.toLocal(this._t.applyQuaternion(this.qi));
      add.add(this._t);
    }
    if (this.orb || this.radial) {
      const c = this._r.copy(p.position);
      if (this.simWorld) this.toLocal(c.sub(this.center).applyQuaternion(this.qi));
      if (this.off) c.sub(this._t.set(genVal(this.off.x, p, t), genVal(this.off.y, p, t), genVal(this.off.z, p, t)));
      const h = dt == null ? 1 / 60 : dt;
      const orb = this.orb;
      const ax = orb ? genVal(orb.x, p, t) * h : 0,
        ay = orb ? genVal(orb.y, p, t) * h : 0,
        az = orb ? genVal(orb.z, p, t) * h : 0;
      orbitalVelocity(c, ax, ay, az, this.radial ? genVal(this.radial, p, t) * h : 0, h);
      if (this.simWorld) c.multiply(this.s).applyQuaternion(this.q);
      add.add(c);
    }
    const sm = this.speedMod ? genVal(this.speedMod, p, t) : 1;
    if (sm && sm !== 1) add.multiplyScalar(1 / sm);
    p.velocity.sub(p._tpVel).add(add);
    p._tpVel.copy(add);
    if (this.speedMod) p.speedModifier = sm;
  }
  frameUpdate() {}
}

class ForceUnity {
  constructor(gx, gy, gz, quat, scale, worldSpace, simWorld) {
    this.type = 'tp-force';
    this.gx = gx;
    this.gy = gy;
    this.gz = gz;
    this.q = quat ? quat.clone() : new THREE.Quaternion();
    this.qi = this.q.clone().invert();
    this.s = scale ? scale.clone() : new THREE.Vector3(1, 1, 1);
    this.worldSpace = !!worldSpace;
    this.simWorld = !!simWorld;
    this._t = new THREE.Vector3();
  }
  reset() {}
  initialize(p) {
    startGen(this.gx, p);
    startGen(this.gy, p);
    startGen(this.gz, p);
  }
  update(p, dt) {
    const t = p.age / (p.life || 1);
    this._t.set(genVal(this.gx, p, t), genVal(this.gy, p, t), genVal(this.gz, p, t));
    if (this.simWorld && !this.worldSpace) this._t.multiply(this.s).applyQuaternion(this.q);
    else if (!this.simWorld && this.worldSpace) {
      this._t.applyQuaternion(this.qi);
      const s = this.s;
      this._t.set(Math.abs(s.x) > 1e-6 ? this._t.x / s.x : 0, Math.abs(s.y) > 1e-6 ? this._t.y / s.y : 0, Math.abs(s.z) > 1e-6 ? this._t.z / s.z : 0);
    }
    p.velocity.addScaledVector(this._t, dt == null ? 0.016 : dt);
  }
  frameUpdate() {}
}

export function buildForceBehavior(forceMod, sys, velComp) {
  if (!forceMod || !forceMod.enabled) return null;
  if (!mmIsActive(forceMod.x, 0) && !mmIsActive(forceMod.y, 0) && !mmIsActive(forceMod.z, 0)) return null;
  const qr = sys.rot || { x: 0, y: 0, z: 0, w: 1 };
  const sc = sys.scale || { x: 1, y: 1, z: 1 };
  return new ForceUnity(
    mmToValue(forceMod.x, velComp),
    mmToValue(forceMod.y, velComp),
    mmToValue(forceMod.z, velComp),
    new THREE.Quaternion(qr.x || 0, qr.y || 0, qr.z || 0, qr.w == null ? 1 : qr.w),
    new THREE.Vector3(sc.x || 1, sc.y || 1, sc.z || 1),
    !!forceMod.inWorldSpace,
    ((sys.ps && sys.ps.moveWithTransform) | 0) !== 0
  );
}

class PlaneCollisionUnity {
  constructor(cfg, toLocalFn) {
    this.type = 'tp-planecollide';
    this.cfg = cfg;
    this.toLocal = toLocalFn || null;
  }
  reset() {}
  initialize() {}
  update(p, dt) {
    const c = this.cfg;
    const pos = p.position,
      vel = p.velocity;
    if (!pos || !vel) return;
    for (const pl of c.planes) {
      const n = pl.normal,
        q = pl.pos;
      const sz = p.size && p.size.x != null ? Math.max(p.size.x, p.size.y, p.size.z) : Number(p.size) || 0;
      const r = (Number(sz) || 0) * 0.5 * (c.radiusScale || 0);
      const d = (pos.x - q.x) * n.x + (pos.y - q.y) * n.y + (pos.z - q.z) * n.z - r;
      if (d >= 0) continue;
      pos.x -= n.x * d;
      pos.y -= n.y * d;
      pos.z -= n.z * d;
      const vn = vel.x * n.x + vel.y * n.y + vel.z * n.z;
      if (vn < 0) {
        const tx = vel.x - n.x * vn,
          ty = vel.y - n.y * vn,
          tz = vel.z - n.z * vn;
        const keep = 1 - (c.dampen || 0);
        const nb = -vn * (c.bounce == null ? 1 : c.bounce);
        vel.x = tx * keep + n.x * nb;
        vel.y = ty * keep + n.y * nb;
        vel.z = tz * keep + n.z * nb;
      }
      if (c.lifeLoss > 0) p.age = Math.min(p.life, p.age + p.life * c.lifeLoss);
      const sp = Math.hypot(vel.x, vel.y, vel.z);
      if (sp < (c.minKillSpeed || 0) || sp > (c.maxKillSpeed == null ? Infinity : c.maxKillSpeed)) p.age = p.life;
    }
  }
  frameUpdate() {}
  clone() {
    return new PlaneCollisionUnity(this.cfg, this.toLocal);
  }
  toJSON() {
    return { type: this.type };
  }
}

export function buildPlaneCollisionBehavior(sys) {
  const cp = sys && sys.collisionPlanes;
  if (!cp || !cp.planes || !cp.planes.length) return null;
  const simWorld = ((sys.ps && sys.ps.moveWithTransform) | 0) !== 0;
  if (simWorld) return new PlaneCollisionUnity(cp);
  const P = sys.pos || { x: 0, y: 0, z: 0 };
  const qr = sys.rot || { x: 0, y: 0, z: 0, w: 1 };
  const sc = sys.scale || { x: 1, y: 1, z: 1 };
  const qi = new THREE.Quaternion(qr.x || 0, qr.y || 0, qr.z || 0, qr.w == null ? 1 : qr.w).invert();
  const v = new THREE.Vector3();
  const planes = cp.planes.map((pl) => {
    v.set(pl.pos.x - P.x, pl.pos.y - P.y, pl.pos.z - P.z).applyQuaternion(qi);
    const pos = { x: v.x / (sc.x || 1), y: v.y / (sc.y || 1), z: v.z / (sc.z || 1) };
    v.set(pl.normal.x, pl.normal.y, pl.normal.z).applyQuaternion(qi).normalize();
    return { pos, normal: { x: v.x, y: v.y, z: v.z } };
  });
  return new PlaneCollisionUnity({ ...cp, planes });
}

export class TrailHoldAfter {
  constructor(holdAfter) {
    this.type = 'tp-trailhold';
    this.holdAfter = Number(holdAfter) || 0;
  }
  reset() {}
  initialize() {}
  update(p, dt) {
    if (p.age < this.holdAfter) return;
    const v = p.velocity;
    if (v) v.set(0, 0, 0);
  }
  frameUpdate() {}
  clone() {
    return new TrailHoldAfter(this.holdAfter);
  }
  toJSON() {
    return { type: this.type, holdAfter: this.holdAfter };
  }
}

export class ClampVelUnity {
  constructor(limitGen, dampen, dragGen, opt) {
    this.type = 'tp-clampvel';
    this.limit = limitGen;
    this.dampen = Number(dampen) || 0;
    this.drag = dragGen || null;
    this.axes = opt && opt.axes ? opt.axes : null;
    this.dragBySize = !(opt && opt.multiplyDragByParticleSize === false);
    this.dragBySpeed = !(opt && opt.multiplyDragByParticleVelocity === false);
  }
  reset() {}
  initialize(p) {
    startGen(this.limit, p);
    startGen(this.drag, p);
  }
  update(p, dt) {
    const v = p.velocity;
    const sp = Math.hypot(v.x, v.y, v.z);
    if (sp <= 1e-6) return;
    const t = p.age / (p.life || 1);
    if (this.axes) {
      const k = ["x", "y", "z"];
      for (let i = 0; i < 3; i++) {
        const g = this.axes[i];
        if (!g) continue;
        const lim = genVal(g, p, t);
        const c0 = v[k[i]];
        const a0 = Math.abs(c0);
        if (a0 > lim) v[k[i]] = c0 < 0 ? -(a0 + (lim - a0) * this.dampen) : a0 + (lim - a0) * this.dampen;
      }
    } else {
      const lim = genVal(this.limit, p, t);
      if (sp > lim) {
        const target = sp + (lim - sp) * this.dampen;
        v.multiplyScalar(target / sp);
      }
    }
    if (this.drag) {
      let d = genVal(this.drag, p, t);
      if (d > 0) {
        if (this.dragBySize) d *= (Math.abs(p.size.x) + Math.abs(p.size.y) + Math.abs(p.size.z)) / 3;
        if (this.dragBySpeed) d *= sp;
        const cur = Math.hypot(v.x, v.y, v.z);
        const next = Math.max(0, cur - d * (dt == null ? 0.016 : dt));
        if (cur > 1e-6) v.multiplyScalar(next / cur);
      }
    }
  }
  frameUpdate() {}
}

export class SizeSeparate {
  constructor(gx, gy, gz) {
    this.type = 'tp-size3';
    this.gx = gx;
    this.gy = gy;
    this.gz = gz;
  }
  reset() {}
  initialize(p) {
    startGen(this.gx, p);
    startGen(this.gy, p);
    startGen(this.gz, p);
  }
  update(p) {
    const t = p.age / (p.life || 1);
    p.size.set(p.startSize.x * genVal(this.gx, p, t), p.startSize.y * genVal(this.gy, p, t), p.startSize.z * genVal(this.gz, p, t));
  }
  frameUpdate() {}
}

class NoiseUnity {
  constructor(spec) {
    this.type = 'tp-noise';
    this.freq = Math.max(Number(spec.frequency) || 0.5, 1e-6);
    this.sx = spec.strengthX;
    this.sy = spec.strengthY;
    this.sz = spec.strengthZ;
    this.scroll = spec.scrollSpeed || null;
    this.damping = spec.damping !== false;
    this.octaves = Math.max(1, Math.min(4, spec.octaves | 0 || 1));
    this.octaveMul = spec.octaveMultiplier != null ? Number(spec.octaveMultiplier) : 0.5;
    this.octaveScale = spec.octaveScale != null ? Number(spec.octaveScale) : 2;
    this.quality = spec.quality == null ? 2 : spec.quality | 0;
    this.posAmount = spec.positionAmount || null;
    this.rotAmount = spec.rotationAmount || null;
    this.sizeAmount = spec.sizeAmount || null;
    this.remap = spec.remap || null;
    this.remapY = spec.remapY || null;
    this.remapZ = spec.remapZ || null;
    this.scrollT = 0;
    this._n = new THREE.Vector3();
    this._o = [0, 0, 0];
    Object.assign(this, makeNoiseOffsets());
  }
  reset() {
    this.scrollT = 0;
    Object.assign(this, makeNoiseOffsets());
  }
  initialize(p) {
    for (const g of [this.sx, this.sy, this.sz, this.scroll, this.posAmount, this.rotAmount, this.sizeAmount]) startGen(g, p);
    p._tpNoiseSizeK = 0;
    p._tpNoiseSizeOut = undefined;
  }
  frameUpdate(dt) {
    this.scrollT += dt || 0;
  }
  update(p, dt) {
    const t = p.age / (p.life || 1);
    const scroll = this.scroll ? genVal(this.scroll, p, t) * this.scrollT : 0;
    const damp = this.damping ? 1 / this.freq : 1;
    const n = this._o;
    unityNoise(this, p.position.x, p.position.y, p.position.z, scroll, n);
    if (this.remap) {
      n[0] = remapNoise(this.remap, n[0]);
      n[1] = remapNoise(this.remapY || this.remap, n[1]);
      n[2] = remapNoise(this.remapZ || this.remap, n[2]);
    }
    const posAmt = this.posAmount ? genVal(this.posAmount, p, t) : 1;
    if (posAmt !== 0) {
      const h = dt == null ? 1 / 60 : dt;
      this._n.set(n[0] * genVal(this.sx, p, t), n[1] * genVal(this.sy, p, t), n[2] * genVal(this.sz, p, t)).multiplyScalar(damp * posAmt * h);
      p.position.add(this._n);
    }
    if (this.rotAmount) {
      const ra = genVal(this.rotAmount, p, t);
      if (ra !== 0 && typeof p.rotation === 'number') p.rotation += n[2] * ra * damp * (dt == null ? 0.016 : dt);
    }
    if (this.sizeAmount) {
      const sa = genVal(this.sizeAmount, p, t);
      const k = sa !== 0 ? 1 + n[0] * sa * damp : 1;
      if (p._tpNoiseSizeK && p._tpNoiseSizeOut === p.size.x) p.size.multiplyScalar(1 / p._tpNoiseSizeK);
      p.size.multiplyScalar(k);
      p._tpNoiseSizeK = k;
      p._tpNoiseSizeOut = p.size.x;
    }
  }
}

export class FlipInit {
  constructor(fx, fy, fz) {
    this.type = 'tp-flip';
    this.fx = fx;
    this.fy = fy;
    this.fz = fz;
  }
  reset() {}
  initialize(p) {
    if (this.fx > 0 && Math.random() < this.fx) p.startSize.x = -p.startSize.x;
    if (this.fy > 0 && Math.random() < this.fy) p.startSize.y = -p.startSize.y;
    if (this.fz > 0 && Math.random() < this.fz) p.startSize.z = -p.startSize.z;
    p.size.copy(p.startSize);
  }
  update() {}
  frameUpdate() {}
}

const INHERIT_COLOR = 1,
  INHERIT_SIZE = 2,
  INHERIT_ROTATION = 4,
  INHERIT_LIFETIME = 8;
const MIN_LIFETIME = 1e-5;

function snapshotParent(st, particle) {
  const s = st.parentSnap || (st.parentSnap = {});
  s.color = particle.color ? (s.color || new THREE.Vector4()).copy(particle.color) : null;
  s.size = typeof particle.size === 'number' ? particle.size : particle.size ? (s.size && s.size.isVector3 ? s.size : new THREE.Vector3()).copy(particle.size) : null;
  s.rotation = particle.rotation;
  s.remaining = Math.max(0, particle.life - particle.age);
}

export class SubEmitterInherit extends TQ.EmitSubParticleSystem {
  constructor(parentPs, useVel, subEmitter, mode, prob, inherit) {
    super(parentPs, useVel, subEmitter, mode, prob);
    this.inherit = inherit | 0;
  }
  emit(particle, delta) {
    const n = this.subEmissions.length;
    super.emit(particle, delta);
    if (this.subEmissions.length > n) snapshotParent(this.subEmissions[this.subEmissions.length - 1], particle);
  }
  frameUpdate(delta) {
    const sys = this.subParticleSystem && this.subParticleSystem.system;
    const inh = this.inherit;
    if (!sys || !inh) return super.frameUpdate(delta);
    const doCol = inh & INHERIT_COLOR,
      doSize = inh & INHERIT_SIZE,
      doRot = inh & INHERIT_ROTATION,
      doLife = inh & INHERIT_LIFETIME;
    for (let i = 0; i < this.subEmissions.length; i++) {
      const st = this.subEmissions[i];
      if (st.time >= sys.duration) {
        this.subEmissions[i] = this.subEmissions[this.subEmissions.length - 1];
        this.subEmissions.length -= 1;
        i--;
        continue;
      }
      if (st.particle && st.particle.age < st.particle.life) {
        this.setMatrixFromParticle(st.matrix, st.particle);
        snapshotParent(st, st.particle);
      } else st.particle = undefined;
      const before = sys.particleNum | 0;
      sys.emit(delta, st, st.matrix);
      const src = st.parentSnap;
      if (!src) continue;
      for (let k = before; k < (sys.particleNum | 0); k++) {
        const p = sys.particles[k];
        if (!p) continue;
        if (doCol && p.color && src.color) {
          p.color.x *= src.color.x;
          p.color.y *= src.color.y;
          p.color.z *= src.color.z;
          p.color.w *= src.color.w;
          if (p.startColor) p.startColor.copy(p.color);
        }
        if (doSize) {
          const ss = typeof src.size === 'number' ? src.size : src.size && src.size.x;
          if (ss != null) {
            if (typeof p.size === 'number') p.size *= ss;
            else if (p.size) {
              p.size.x *= ss;
              p.size.y *= typeof src.size === 'number' ? ss : src.size.y;
              p.size.z *= typeof src.size === 'number' ? ss : src.size.z;
            }
            if (p.startSize && p.startSize.copy && p.size && p.size.x != null) p.startSize.copy(p.size);
            else if (typeof p.startSize === 'number') p.startSize *= ss;
          }
        }
        if (doRot && typeof p.rotation === 'number' && typeof src.rotation === 'number') p.rotation += src.rotation;
        if (doLife) p.life = Math.max(p.life * src.remaining, MIN_LIFETIME);
      }
    }
  }
}

export class RotationFlip {
  constructor(angularVelocity, ratio) {
    this.type = 'tp-rotflip';
    this.angularVelocity = angularVelocity;
    this.ratio = ratio;
  }
  reset() {}
  initialize(p) {
    if (this.angularVelocity && this.angularVelocity.startGen) this.angularVelocity.startGen(p.memory);
    p.tpRotSign = Math.random() < this.ratio ? -1 : 1;
  }
  update(p, dt) {
    if (typeof p.rotation !== 'number') return;
    p.rotation += dt * (p.tpRotSign || 1) * this.angularVelocity.genValue(p.memory, p.age / p.life);
  }
  frameUpdate() {}
}

export class AgeToCustom {
  constructor() {
    this.type = 'tp-age-custom';
  }
  initialize(p) {
    if (!p.tpCustom1) p.tpCustom1 = new THREE.Vector4();
    p.tpCustom1.set(0, 0, 0, 1);
  }
  update(p) {
    if (!p.tpCustom1) p.tpCustom1 = new THREE.Vector4();
    p.tpCustom1.x = p.age / (p.life || 1);
  }
  frameUpdate() {}
  reset() {}
  clone() {
    return new AgeToCustom();
  }
  toJSON() {
    return { type: this.type };
  }
}

const _cotTmp = new THREE.Vector4();
export class ColorOverTrail {
  constructor(gen) {
    this.type = 'tp-color-over-trail';
    this.color = gen;
  }
  initialize(p) {
    if (this.color.startGen) this.color.startGen(p.memory);
  }
  update(p) {
    const prev = p.previous;
    if (!prev || !prev.values) return;
    const iter = prev.values();
    const n = prev.length;
    for (let i = 0; i < n; i++) {
      const rs = iter.next().value;
      if (!rs) break;
      if (!rs.tpBaseColor) rs.tpBaseColor = rs.color.clone();
      this.color.genColor(p.memory, _cotTmp, (n - i) / (p.length || 1));
      rs.color.set(rs.tpBaseColor.x * _cotTmp.x, rs.tpBaseColor.y * _cotTmp.y, rs.tpBaseColor.z * _cotTmp.z, rs.tpBaseColor.w * _cotTmp.w);
    }
  }
  frameUpdate() {}
  reset() {}
  clone() {
    return new ColorOverTrail(this.color.clone ? this.color.clone() : this.color);
  }
  toJSON() {
    return { type: this.type };
  }
}

const _idTmp = new THREE.Vector4();
export function isIdentityColorGen(gen) {
  if (!gen || !gen.genColor) return true;
  const mem = [];
  if (gen.startGen) gen.startGen(mem);
  for (let k = 0; k <= 8; k++) {
    gen.genColor(mem, _idTmp, k / 8);
    if (Math.abs(_idTmp.x - 1) > 1e-6 || Math.abs(_idTmp.y - 1) > 1e-6 || Math.abs(_idTmp.z - 1) > 1e-6 || Math.abs(_idTmp.w - 1) > 1e-6) return false;
  }
  return true;
}

export function buildVelocityBehavior(velMod, sys, velComp) {
  if (!velMod || !velMod.enabled) return null;
  const has = (mm, base) => mmIsActive(mm, base);
  const linOn = has(velMod.x, 0) || has(velMod.y, 0) || has(velMod.z, 0);
  const orbOn = has(velMod.orbitalX, 0) || has(velMod.orbitalY, 0) || has(velMod.orbitalZ, 0);
  const offOn = has(velMod.orbitalOffsetX, 0) || has(velMod.orbitalOffsetY, 0) || has(velMod.orbitalOffsetZ, 0);
  const radOn = has(velMod.radial, 0);
  const spdOn = has(velMod.speedModifier, 1);
  if (!linOn && !orbOn && !radOn && !spdOn) return null;
  const P = sys.pos || { x: 0, y: 0, z: 0 };
  const qr = sys.rot || { x: 0, y: 0, z: 0, w: 1 };
  const sc = sys.scale || { x: 1, y: 1, z: 1 };
  return new VelocityUnity({
    lin: linOn ? { x: mmToValue(velMod.x, velComp), y: mmToValue(velMod.y, velComp), z: mmToValue(velMod.z, velComp) } : null,
    orb: orbOn ? { x: mmToValue(velMod.orbitalX), y: mmToValue(velMod.orbitalY), z: mmToValue(velMod.orbitalZ) } : null,
    off: offOn ? { x: mmToValue(velMod.orbitalOffsetX), y: mmToValue(velMod.orbitalOffsetY), z: mmToValue(velMod.orbitalOffsetZ) } : null,
    radial: radOn ? mmToValue(velMod.radial, velComp) : null,
    speedMod: spdOn ? mmToValue(velMod.speedModifier) : null,
    center: new THREE.Vector3(P.x || 0, P.y || 0, P.z || 0),
    quat: new THREE.Quaternion(qr.x || 0, qr.y || 0, qr.z || 0, qr.w == null ? 1 : qr.w),
    scale: new THREE.Vector3(sc.x || 1, sc.y || 1, sc.z || 1),
    worldSpace: !!velMod.inWorldSpace,
    simWorld: ((sys.ps && sys.ps.moveWithTransform) | 0) !== 0,
  });
}

export function buildNoiseBehavior(noiseMod, velComp) {
  if (!noiseMod || !noiseMod.enabled) return null;
  const sepa = !!noiseMod.separateAxes;
  const sx = mmToValue(noiseMod.strength, velComp);
  const remapOf = noiseRemapOf(noiseMod);
  return new NoiseUnity({
    frequency: noiseMod.frequency,
    strengthX: sx,
    strengthY: sepa ? mmToValue(noiseMod.strengthY, velComp) : sx,
    strengthZ: sepa ? mmToValue(noiseMod.strengthZ, velComp) : sx,
    scrollSpeed: mmIsActive(noiseMod.scrollSpeed, 0) ? mmToValue(noiseMod.scrollSpeed) : null,
    damping: noiseMod.damping,
    octaves: noiseMod.octaves,
    octaveMultiplier: noiseMod.octaveMultiplier,
    octaveScale: noiseMod.octaveScale,
    quality: noiseMod.quality,
    positionAmount: mmToValue(noiseMod.positionAmount),
    rotationAmount: mmIsActive(noiseMod.rotationAmount, 0) ? mmToValue(noiseMod.rotationAmount) : null,
    sizeAmount: mmIsActive(noiseMod.sizeAmount, 0) ? mmToValue(noiseMod.sizeAmount) : null,
    remap: remapOf.x,
    remapY: remapOf.y,
    remapZ: remapOf.z,
  });
}

export class InheritVelocityUnity {
  constructor(factor, current) {
    this.type = 'tp-inheritvel';
    this.factor = factor;
    this.current = !!current;
    this.ps = null;
    this.applied = null;
  }
  reset() {}
  initialize(p, ps) {
    this.ps = ps || this.ps;
    const v = this.ps && this.ps.tpEmitterVel;
    if (!v) return;
    if (this.current) {
      p.tpInheritApplied = new TQ.Vector3(0, 0, 0);
      return;
    }
    p.velocity.addScaledVector(v, this.factor);
  }
  update(p) {
    if (!this.current) return;
    const v = this.ps && this.ps.tpEmitterVel;
    const prev = p.tpInheritApplied;
    if (!v || !prev) return;
    p.velocity.sub(prev);
    prev.copy(v).multiplyScalar(this.factor);
    p.velocity.add(prev);
  }
  frameUpdate() {}
}
