import * as THREE from '../../../vendor/three.module.js';
import * as TQ from './quarks-ext.js';

const _inv = new THREE.Matrix4();

const MOTION = new Set(['tp-velocity', 'tp-force', 'tp-noise', 'tp-clampvel', 'tp-planecollide', 'tp-trailhold', 'ApplyForce', 'GravityForce', 'ApplyCollision', 'OrbitOverLife', 'SpeedOverLife', 'LimitSpeedOverLife', 'Noise', 'ForceOverLife', 'TurbulenceField', 'ChangeEmitDirection']);
export const isMotionBehavior = (b) => !!b && MOTION.has(b.type);

function bornTrail(tps, a, inherit, dieWith) {
  const t = new TQ.TrailParticle();
  t.reset();
  t.speedModifier = 1;
  if (inherit) t.startColor.copy(a.startColor);
  else {
    tps.startColor.startGen(t.memory);
    tps.startColor.genColor(t.memory, t.startColor, 0);
  }
  t.color.copy(t.startColor);
  tps.startLife.startGen(t.memory);
  t.life = dieWith ? a.life : tps.startLife.genValue(t.memory, 0);
  t.age = 0;
  tps.startSize.startGen(t.memory);
  if (tps.startSize.type === 'vec3function') tps.startSize.genValue(t.memory, t.startSize, 0);
  else {
    const s = tps.startSize.genValue(t.memory, 0);
    t.startSize.set(s, s, s);
  }
  t.size.copy(t.startSize);
  tps.startTileIndex.startGen(t.memory);
  t.uvTile = tps.startTileIndex.genValue(t.memory);
  const sl = tps.rendererEmitterSettings && tps.rendererEmitterSettings.startLength;
  if (sl) {
    sl.startGen(t.memory);
    t.length = sl.genValue(t.memory, 0);
  }
  for (let j = 0; j < tps.behaviors.length; j++) tps.behaviors[j].initialize(t, tps);
  return t;
}

export function attachTrailSync(ps, tps, opt) {
  const o = opt || {};
  const inherit = o.inheritParticleColor !== false;
  const dieWith = o.dieWithParticles !== false;
  const sizeAffects = o.sizeAffectsWidth !== false;
  const follow = !!(tps.rendererEmitterSettings && tps.rendererEmitterSettings.followLocalOrigin);
  tps.onlyUsedByOther = true;
  let prevLive = new Set();
  let orphans = [];
  const place = (t, a) => {
    if (!follow) {
      t.position.copy(a.position);
      return;
    }
    if (!t.localPosition) t.localPosition = new THREE.Vector3();
    if (tps.worldSpace) t.localPosition.copy(a.position).applyMatrix4(_inv.copy(tps.emitter.matrixWorld).invert());
    else t.localPosition.copy(a.position);
  };
  const sync = () => {
    const src = ps.particles;
    const n = ps.particleNum | 0;
    const list = tps.particles;
    const live = new Set();
    let m = 0;
    for (let i = 0; i < n; i++) {
      const a = src[i];
      let t = a.tpTrail;
      if (!t || a.age + 1e-6 < a.tpTrailAge) {
        t = bornTrail(tps, a, inherit, dieWith);
        a.tpTrail = t;
      }
      a.tpTrailAge = a.age;
      place(t, a);
      t.velocity.set(0, 0, 0);
      if (sizeAffects) {
        t.startSize.copy(a.startSize);
        t.size.copy(a.size);
      }
      live.add(t);
      list[m++] = t;
    }
    for (const t of prevLive) if (!live.has(t)) orphans.push(t);
    const keep = [];
    for (const t of orphans) {
      if (live.has(t) || t.previous.length === 0) continue;
      t.velocity.set(0, 0, 0);
      list[m++] = t;
      keep.push(t);
    }
    orphans = keep;
    prevLive = live;
    tps.particleNum = m;
  };
  const orig = tps.update.bind(tps);
  tps.update = (dt) => {
    if (!tps.paused) sync();
    orig(dt);
  };
}
