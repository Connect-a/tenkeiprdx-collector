import * as THREE from '../../../vendor/three.module.js';
import * as TQ from './quarks-ext.js';
import { sampleMeshShape } from './vfx-shape.js';
import { mmToValue } from './vfx-minmax.js';
import { noteBuildFailure } from './vfx-failures.js';

const D2R = Math.PI / 180;
class BoxEmitter {
  constructor(mode) {
    this.type = 'tp-box';
    this.mode = mode | 0;
    this.speed = new TQ.ConstantValue(1);
  }
  update() {}
  initialize(p) {
    let x = Math.random() - 0.5,
      y = Math.random() - 0.5,
      z = Math.random() - 0.5;
    if (this.mode === 1 || this.mode === 2) {
      const face = (Math.random() * 3) | 0;
      const side = Math.random() < 0.5 ? -0.5 : 0.5;
      if (face === 0) x = side;
      else if (face === 1) y = side;
      else z = side;
      if (this.mode === 2) {
        const other = (Math.random() * 2) | 0;
        const side2 = Math.random() < 0.5 ? -0.5 : 0.5;
        if (face === 0) {
          if (other === 0) y = side2;
          else z = side2;
        } else if (face === 1) {
          if (other === 0) x = side2;
          else z = side2;
        } else {
          if (other === 0) x = side2;
          else y = side2;
        }
      }
    }
    p.position.set(x, y, z);
    p.velocity.set(0, 0, p.startSpeed);
  }
}

class EdgeEmitter {
  constructor(radius) {
    this.type = 'tp-edge';
    this.radius = radius;
    this.speed = new TQ.ConstantValue(1);
  }
  update() {}
  initialize(p) {
    p.position.set((Math.random() * 2 - 1) * this.radius, 0, 0);
    p.velocity.set(0, p.startSpeed, 0);
  }
}

class RectEmitter {
  constructor() {
    this.type = 'tp-rect';
    this.speed = new TQ.ConstantValue(1);
  }
  update() {}
  initialize(p) {
    p.position.set(Math.random() - 0.5, Math.random() - 0.5, 0);
    p.velocity.set(0, 0, p.startSpeed);
  }
}

class ConeVolumeEmitter {
  constructor(inner, length) {
    this.type = 'tp-conevolume';
    this.inner = inner;
    this.length = length;
    this.speed = new TQ.ConstantValue(1);
  }
  update(sys, dt) {
    if (this.inner.update) this.inner.update(sys, dt);
  }
  initialize(p, es) {
    this.inner.initialize(p, es);
    const sp = Math.hypot(p.velocity.x, p.velocity.y, p.velocity.z);
    if (sp > 1e-6) {
      const t = Math.random() * this.length;
      p.position.addScaledVector(p.velocity, t / sp);
    }
  }
}

class MeshShapeEmitter {
  constructor(geo, placement, opt) {
    this.type = 'tp-mesh';
    this.speed = new TQ.ConstantValue(1);
    this.geo = geo && geo.positions && geo.positions.length ? geo : null;
    this.placement = placement | 0;
    this.normalOffset = Number(opt && opt.normalOffset) || 0;
    this.useMeshColors = !(opt && opt.useMeshColors === false);
    this.tex = (opt && opt.shapeTex) || null;
    this.texColor = !!(opt && opt.texColor);
    this.texAlpha = !!(opt && opt.texAlpha);
    this.bilinear = !!(opt && opt.texBilinear);
    this.o = [0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 0, 0];
    this.t = [1, 1, 1, 1];
  }
  update() {}
  sampleTex(u, v, out) {
    const t = this.tex;
    const w = t.width | 0,
      h = t.height | 0;
    const fx = (u - Math.floor(u)) * w - 0.5,
      fy = (1 - (v - Math.floor(v))) * h - 0.5;
    const px = t.rgba;
    const at = (x, y, k) => {
      const xi = Math.min(w - 1, Math.max(0, x)),
        yi = Math.min(h - 1, Math.max(0, y));
      return px[(yi * w + xi) * 4 + k] / 255;
    };
    if (!this.bilinear) {
      const xi = Math.round(fx),
        yi = Math.round(fy);
      for (let k = 0; k < 4; k++) out[k] = at(xi, yi, k);
      return;
    }
    const x0 = Math.floor(fx),
      y0 = Math.floor(fy);
    const ax = fx - x0,
      ay = fy - y0;
    for (let k = 0; k < 4; k++) {
      const a = at(x0, y0, k) * (1 - ax) + at(x0 + 1, y0, k) * ax;
      const b = at(x0, y0 + 1, k) * (1 - ax) + at(x0 + 1, y0 + 1, k) * ax;
      out[k] = a * (1 - ay) + b * ay;
    }
  }
  initialize(p) {
    if (!this.geo) {
      p.position.set(0, 0, 0);
      p.velocity.set(0, 0, p.startSpeed);
      return;
    }
    const o = this.o;
    sampleMeshShape(this.geo, this.placement, o);
    p.position.set(o[0], o[1], o[2]);
    if (this.normalOffset) p.position.set(o[0] + o[3] * this.normalOffset, o[1] + o[4] * this.normalOffset, o[2] + o[5] * this.normalOffset);
    if (this.geo.normals) p.velocity.set(o[3], o[4], o[5]).normalize().multiplyScalar(p.startSpeed);
    else p.velocity.set(0, 0, p.startSpeed);
    if (!p.startColor) return;
    let cr = 1,
      cg = 1,
      cb = 1,
      ca = 1;
    if (this.useMeshColors && this.geo.colors) {
      cr *= o[6];
      cg *= o[7];
      cb *= o[8];
      ca *= o[9];
    }
    if (this.tex && this.tex.rgba && (this.texColor || this.texAlpha) && this.geo.uv) {
      this.sampleTex(o[10], o[11], this.t);
      if (this.texColor) {
        cr *= this.t[0];
        cg *= this.t[1];
        cb *= this.t[2];
      }
      if (this.texAlpha) ca *= this.t[3];
    }
    if (cr === 1 && cg === 1 && cb === 1 && ca === 1) return;
    p.startColor.x *= cr;
    p.startColor.y *= cg;
    p.startColor.z *= cb;
    p.startColor.w *= ca;
    if (p.color) p.color.copy(p.startColor);
  }
}

class ShapeXform {
  constructor(inner, opt) {
    this.type = 'tp-xform';
    this.inner = inner;
    this.speed = inner.speed || new TQ.ConstantValue(1);
    this.scale = opt.scale || null;
    this.offset = opt.offset || null;
    this.quat = opt.quat || null;
    this.randomPos = Number(opt.randomPos || 0);
    this.randomDir = Number(opt.randomDir || 0);
    this.sphericalDir = Number(opt.sphericalDir || 0);
    this.alignToDirection = !!opt.alignToDirection;
    this._v = new THREE.Vector3();
  }
  update(sys, dt) {
    if (this.inner.update) this.inner.update(sys, dt);
  }
  initialize(p, es) {
    this.inner.initialize(p, es);
    const sp = Math.hypot(p.velocity.x, p.velocity.y, p.velocity.z);
    const dir = this._v.set(p.velocity.x, p.velocity.y, p.velocity.z);
    if (sp > 1e-6) dir.multiplyScalar(1 / sp);
    if (this.sphericalDir > 0) {
      const pl = Math.hypot(p.position.x, p.position.y, p.position.z);
      if (pl > 1e-6) {
        const k = this.sphericalDir;
        dir.set(dir.x + (p.position.x / pl - dir.x) * k, dir.y + (p.position.y / pl - dir.y) * k, dir.z + (p.position.z / pl - dir.z) * k);
        const dl = dir.length() || 1;
        dir.multiplyScalar(1 / dl);
      }
    }
    if (this.randomDir > 0) {
      let rx = Math.random() * 2 - 1,
        ry = Math.random() * 2 - 1,
        rz = Math.random() * 2 - 1;
      const rl = Math.hypot(rx, ry, rz) || 1;
      rx /= rl;
      ry /= rl;
      rz /= rl;
      const k = this.randomDir;
      dir.set(dir.x + (rx - dir.x) * k, dir.y + (ry - dir.y) * k, dir.z + (rz - dir.z) * k);
      const dl = dir.length() || 1;
      dir.multiplyScalar(1 / dl);
    }
    if (this.randomPos > 0) {
      p.position.x += (Math.random() * 2 - 1) * this.randomPos;
      p.position.y += (Math.random() * 2 - 1) * this.randomPos;
      p.position.z += (Math.random() * 2 - 1) * this.randomPos;
    }
    if (this.scale) {
      p.position.multiply(this.scale);
      dir.multiply(this.scale);
      const dl = dir.length();
      if (dl > 1e-6) dir.multiplyScalar(1 / dl);
    }
    if (this.quat) {
      p.position.applyQuaternion(this.quat);
      dir.applyQuaternion(this.quat);
    }
    if (this.offset) p.position.add(this.offset);
    p.velocity.copy(dir).multiplyScalar(sp);
    if (this.alignToDirection && p.rotation && p.rotation.isQuaternion && sp > 1e-6) p.rotation.setFromUnitVectors(UP_Z, dir);
  }
}
const UP_Z = new THREE.Vector3(0, 0, 1);

export function makeEmitter(shapeMod, ctx) {
  ctx = ctx || {};
  if (!shapeMod || !shapeMod.enabled) return new TQ.PointEmitter();
  const t = shapeMod.type | 0;
  const radius = Math.max(0.0001, (shapeMod.radius && shapeMod.radius.value) || 0.1);
  const thickness = shapeMod.radiusThickness != null ? shapeMod.radiusThickness : 1;
  const arc = ((shapeMod.arc && shapeMod.arc.value) != null ? shapeMod.arc.value : 360) * D2R;
  const angle = (shapeMod.angle || 0) * D2R;
  const arcMM = shapeMod.arc || {};
  const arcMulti = { mode: arcMM.mode | 0, spread: Number(arcMM.spread) || 0, speed: mmToValue(arcMM.speed, 1) };
  const length = shapeMod.length != null ? Number(shapeMod.length) : 5;
  let inner = null;
  try {
    switch (t) {
      case 10:
      case 11:
        inner = new TQ.CircleEmitter({ radius, arc, thickness: t === 11 ? 0 : thickness, ...arcMulti });
        break;
      case 4:
      case 7:
        inner = new TQ.ConeEmitter({ radius, arc, thickness: t === 7 ? 0 : thickness, angle, ...arcMulti });
        break;
      case 8:
      case 9:
        inner = new ConeVolumeEmitter(new TQ.ConeEmitter({ radius, arc, thickness: t === 9 ? 0 : thickness, angle, ...arcMulti }), length);
        break;
      case 2:
      case 3:
        inner = new TQ.HemisphereEmitter({ radius, thickness: t === 3 ? 0 : thickness });
        break;
      case 0:
      case 1:
        inner = new TQ.SphereEmitter({ radius, thickness: t === 1 ? 0 : thickness });
        break;
      case 5:
        inner = new BoxEmitter(0);
        break;
      case 15:
        inner = new BoxEmitter(1);
        break;
      case 16:
        inner = new BoxEmitter(2);
        break;
      case 12:
        inner = new EdgeEmitter(radius);
        break;
      case 17:
        inner = new TQ.DonutEmitter({ radius, arc, thickness, donutRadius: shapeMod.donutRadius != null ? Number(shapeMod.donutRadius) : radius * 0.2, ...arcMulti });
        break;
      case 18:
      case 19:
      case 20:
        inner = new RectEmitter();
        break;
      case 6:
      case 13:
      case 14:
        inner = new MeshShapeEmitter(ctx.shapeMesh, shapeMod.placementMode, {
          normalOffset: shapeMod.m_MeshNormalOffset,
          useMeshColors: shapeMod.m_UseMeshColors,
          shapeTex: ctx.shapeTex || null,
          texColor: shapeMod.m_TextureColorAffectsParticles !== false,
          texAlpha: shapeMod.m_TextureAlphaAffectsParticles !== false,
          texBilinear: shapeMod.m_TextureBilinearFiltering === true,
        });
        break;
      default:
        inner = new TQ.SphereEmitter({ radius, thickness });
    }
  } catch (e) {
    noteBuildFailure('shapeEmitter', e);
    return new TQ.PointEmitter();
  }
  const sc = shapeMod.m_Scale;
  const po = shapeMod.m_Position;
  const ro = shapeMod.m_Rotation;
  const needScale = sc && (Math.abs((sc.x == null ? 1 : sc.x) - 1) > 1e-6 || Math.abs((sc.y == null ? 1 : sc.y) - 1) > 1e-6 || Math.abs((sc.z == null ? 1 : sc.z) - 1) > 1e-6);
  const needOffset = po && (po.x || po.y || po.z);
  const needRot = ro && (ro.x || ro.y || ro.z);
  const rda = Number(shapeMod.randomDirectionAmount || 0);
  const rpa = Number(shapeMod.randomPositionAmount || 0);
  const sda = Number(shapeMod.sphericalDirectionAmount || 0);
  const align = !!shapeMod.alignToDirection;
  if (!needScale && !needOffset && !needRot && rda <= 0.001 && rpa <= 0.001 && sda <= 0.001 && !align) return inner;
  return new ShapeXform(inner, {
    scale: needScale ? new THREE.Vector3(sc.x == null ? 1 : sc.x, sc.y == null ? 1 : sc.y, sc.z == null ? 1 : sc.z) : null,
    offset: needOffset ? new THREE.Vector3(po.x || 0, po.y || 0, po.z || 0) : null,
    quat: needRot ? new THREE.Quaternion().setFromEuler(new THREE.Euler((ro.x || 0) * D2R, (ro.y || 0) * D2R, (ro.z || 0) * D2R, 'ZXY')) : null,
    randomPos: rpa,
    randomDir: rda,
    sphericalDir: sda,
    alignToDirection: align,
  });
}
