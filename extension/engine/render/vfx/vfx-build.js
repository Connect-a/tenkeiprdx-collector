import * as THREE from '../../../vendor/three.module.js';
import * as TQ from './quarks-ext.js';
import { InheritVelocityUnity, TrailHoldAfter, buildPlaneCollisionBehavior, buildVelocityBehavior, buildNoiseBehavior, buildForceBehavior, ClampVelUnity, SizeSeparate, FlipInit, RotationFlip, AgeToCustom, ColorOverTrail, isIdentityColorGen } from './vfx-behaviors.js';
import { makeEmitter } from './vfx-emitters.js';
import { mmToValue, mmIsActive } from './vfx-minmax.js';
import { isMotionBehavior } from './vfx-trailsync.js';
import { overLifeGradientGen, startColorGen, MultipliedColor } from './vfx-gradient.js';
import { streamVaryingValues } from './vfx-streams.js';
import { drawOrder, materialLit, usesAgeStrip } from './vfx-material.js';
import { LIVE_MODE, buildLiveGameShader } from './vfx-live-shader.js';
import { GRAVITY } from './vfx-constants.js';
import { noteBuildFailure } from './vfx-failures.js';

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

export const emitterScale = (sys) => {
  const mode = (sys.ps && sys.ps.scalingMode) | 0;
  const s = (mode === 1 ? sys.localScale : sys.scale) || sys.scale || { x: 1, y: 1, z: 1 };
  return { x: s.x == null ? 1 : s.x, y: s.y == null ? 1 : s.y, z: s.z == null ? 1 : s.z };
};
const AGE_TILES = 8;
function ageStripSlices(sys, useTiles) {
  if (useTiles) return null;
  const cd = sys.ps && sys.ps.CustomDataModule;
  if (!cd || !cd.enabled || !sys.useCustomVertexStreams) return null;
  const slices = [];
  for (let k = 0; k < AGE_TILES; k++) slices.push(streamVaryingValues(sys, (k + 0.5) / AGE_TILES));
  if (!slices[0]) return null;
  const s0 = JSON.stringify(slices[0]);
  return slices.some((s, i) => i && JSON.stringify(s) !== s0) ? slices : null;
}

function shapeTexOf(shapeMod, shapeTexOfPid) {
  if (!shapeMod || !shapeMod.enabled || typeof shapeTexOfPid !== 'function') return null;
  const ref = shapeMod.m_Texture;
  if (!ref || (ref.m_FileID | 0) !== 0) return null;
  const pid = String(ref.m_PathID);
  return pid && pid !== '0' ? shapeTexOfPid(pid) : null;
}
function shapeMeshOf(shapeMod, rawMesh, shapeMeshPid) {
  if (!rawMesh || !shapeMod || !shapeMod.enabled) return null;
  const t = shapeMod.type | 0;
  if (t !== 6 && t !== 13 && t !== 14) return null;
  if (shapeMeshPid) return rawMesh(shapeMeshPid);
  const ref = shapeMod.m_Mesh;
  if (!ref || (ref.m_FileID | 0) !== 0) return null;
  const pid = String(ref.m_PathID);
  return pid && pid !== '0' ? rawMesh(pid) : null;
}

function applyTrailColor(p, tm, entry) {
  const tint = entry ? entry.tint : null;
  const inherit = tm.inheritParticleColor !== false;
  let behaviors = p.behaviors || [];
  let idx = behaviors.findIndex((b) => b && b.type === 'ColorOverLife');
  if (!inherit) {
    p.startColor = startColorGen(null, { tint });
    if (idx >= 0) {
      behaviors = behaviors.slice();
      behaviors.splice(idx, 1);
      idx = -1;
    }
  }
  const trailGen = overLifeGradientGen(tm.colorOverLifetime, tint);
  if (trailGen) {
    behaviors = behaviors === p.behaviors ? behaviors.slice() : behaviors;
    if (idx >= 0) behaviors[idx] = new TQ.ColorOverLife(new MultipliedColor(behaviors[idx].color, trailGen));
    else behaviors = behaviors.concat([new TQ.ColorOverLife(trailGen)]);
  }
  p.behaviors = behaviors;
}

export function buildTrailParams(sys, ctx) {
  const texByMatPid = ctx && ctx.texByMatPid;
  const ps = sys.ps || {};
  const tm = ps.TrailModule || {};
  if (!tm.enabled || !sys.trailMatPid) return null;
  if ((tm.mode | 0) === 1) return null;
  const base = buildParams(sys, ctx, null, { appearance: false });
  const em = ps.EmissionModule || {};
  const entry = texByMatPid ? texByMatPid.get(String(sys.trailMatPid)) : null;
  const startSizeK = tm.sizeAffectsLifetime === true ? Number(ps.InitialModule && ps.InitialModule.startSize && ps.InitialModule.startSize.scalar) || 1 : 1;
  const life = (Number(tm.lifetime && tm.lifetime.scalar) || 1) * startSizeK;
  const ratio = tm.ratio == null ? 1 : Math.max(0, Math.min(1, Number(tm.ratio)));
  const width = mmIsActive(tm.widthOverTrail, 1) ? mmToValue(tm.widthOverTrail) : null;
  const p = base;
  p.renderMode = TQ.RenderMode.Trail;
  p.material = ctx.makeMaterial(entry);
  delete p.instancingGeometry;
  delete p.tpAlign;
  p.rendererEmitterSettings = { startLength: new TQ.ConstantValue(Math.max(2, Math.min(120, Math.round(life * 60)))), followLocalOrigin: !tm.worldSpace && !!p.worldSpace };
  if (tm.sizeAffectsWidth === false) {
    p.startSize = new TQ.ConstantValue(1);
    p.behaviors = (p.behaviors || []).filter((b) => b && b.type !== 'SizeOverLife' && b.type !== 'SizeBySpeed');
  }
  if (tm.dieWithParticles === false) {
    const pl = Number((ps.InitialModule && ps.InitialModule.startLifetime && ps.InitialModule.startLifetime.scalar) || 0);
    if (life > pl + 1e-6) {
      p.startLife = new TQ.ConstantValue(life);
      p.behaviors = (p.behaviors || []).concat([new TrailHoldAfter(pl)]);
    }
  }
  p.behaviors = (p.behaviors || []).filter((b) => !isMotionBehavior(b));
  if (width) p.behaviors = p.behaviors.concat([new TQ.WidthOverLength(width)]);
  applyTrailColor(p, tm, entry);
  const cotGen = overLifeGradientGen(tm.colorOverTrail);
  if (cotGen && !isIdentityColorGen(cotGen)) p.behaviors = p.behaviors.concat([new ColorOverTrail(cotGen)]);
  p.emissionOverTime = mmToValue(em.rate || em.rateOverTime, ratio);
  p.emissionBursts = (em.m_Bursts || []).map((b) => ({
    time: b.time || 0,
    count: new TQ.ConstantValue(Math.max(1, Math.round(((b.countCurve && b.countCurve.scalar) || 1) * ratio))),
    cycle: b.cycleCount == null ? 1 : b.cycleCount,
    interval: b.repeatInterval || 0.01,
    probability: b.probability == null ? 1 : b.probability,
  }));
  return p;
}

const _pivotQuads = new Map();
function pivotQuad(pv) {
  const px = (pv && pv.x) || 0,
    py = (pv && pv.y) || 0;
  if (!px && !py) return null;
  const k = px + ',' + py;
  let g = _pivotQuads.get(k);
  if (g) return g;
  g = new THREE.PlaneGeometry(1, 1, 1, 1);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setXY(i, p.getX(i) + px, p.getY(i) + py);
  p.needsUpdate = true;
  _pivotQuads.set(k, g);
  return g;
}

export function buildParams(sys, ctx, split, opt) {
  const appearance = !(opt && opt.appearance === false);
  const { texByMatPid, loop, geoResolver, rawMesh, shapeTexOfPid } = ctx || {};
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
  const splitN = split && split.count > 1 ? split.count : 1;
  const splitI = split ? split.index | 0 : 0;
  const shareOf = (n) => (splitN === 1 ? n : Math.floor((n + splitN - 1 - splitI) / splitN));
  const bursts = (em.m_Bursts || []).map((b) => ({
    time: b.time || 0,
    count: new TQ.ConstantValue(Math.max(splitN === 1 ? 1 : 0, shareOf(Math.max(1, Math.round((b.countCurve && b.countCurve.scalar) || 1))))),
    cycle: b.cycleCount == null ? 1 : b.cycleCount,
    interval: b.repeatInterval || 0.01,
    probability: b.probability == null ? 1 : b.probability,
  }));
  const esc = emitterScale(sys);
  const scaleMag = (Math.abs(esc.x || 1) + Math.abs(esc.y || 1) + Math.abs(esc.z || 1)) / 3;
  const localSpace = (ps.moveWithTransform | 0) === 0;
  const shapeOnly = (ps.scalingMode | 0) === 2;
  const velComp = !localSpace && (ps.scalingMode | 0) === 0 ? scaleMag : localSpace && shapeOnly && scaleMag > 1e-6 ? 1 / scaleMag : 1;
  const behaviors = [];
  const velMod = ps.VelocityModule || {};
  const vel = buildVelocityBehavior(velMod, sys, velComp);
  if (vel) behaviors.push(vel);
  if (clampMod.enabled)
    behaviors.push(
      new ClampVelUnity(mmToValue(clampMod.magnitude, velComp), Number(clampMod.dampen || 0), mmIsActive(clampMod.drag, 0) ? mmToValue(clampMod.drag, velComp) : null, {
        multiplyDragByParticleSize: clampMod.multiplyDragByParticleSize,
        multiplyDragByParticleVelocity: clampMod.multiplyDragByParticleVelocity,
        axes: clampMod.separateAxis === true ? [mmToValue(clampMod.x, velComp), mmToValue(clampMod.y, velComp), mmToValue(clampMod.z, velComp)] : null,
      })
    );
  const gm = init.gravityModifier ? init.gravityModifier.scalar || 0 : 0;
  if (Math.abs(gm) > 1e-6) behaviors.push(new TQ.ApplyForce(new THREE.Vector3(0, 1, 0), new TQ.ConstantValue(-GRAVITY * gm)));
  const force = buildForceBehavior(ps.ForceModule, sys, velComp);
  if (force) behaviors.push(force);
  const noise = buildNoiseBehavior(ps.NoiseModule, velComp);
  if (noise) behaviors.push(noise);
  const collide = buildPlaneCollisionBehavior(sys);
  if (collide) behaviors.push(collide);
  if (rotMod.enabled) {
    const rotFlip = Number(init.randomizeRotationDirection) || 0;
    const av = mmToValue(rotMod.curve);
    behaviors.push(rotFlip > 0 ? new RotationFlip(av, rotFlip) : new TQ.RotationOverLife(av));
  }
  if (colMod.enabled) {
    const gg = overLifeGradientGen(colMod.gradient);
    if (gg) behaviors.push(new TQ.ColorOverLife(gg));
  }
  if (sizeMod.enabled) {
    if (sizeMod.separateAxes) behaviors.push(new SizeSeparate(mmToValue(sizeMod.curve), mmToValue(sizeMod.y), mmToValue(sizeMod.z)));
    else behaviors.push(new TQ.SizeOverLife(mmToValue(sizeMod.curve)));
  } else {
    const sbs = ps.SizeBySpeedModule || {};
    if (sbs.enabled && TQ.SizeBySpeed) {
      const r = sbs.range || { x: 0, y: 1 };
      try {
        behaviors.push(new TQ.SizeBySpeed(sbs.separateAxes ? new TQ.Vector3Function(mmToValue(sbs.curve), mmToValue(sbs.y), mmToValue(sbs.z)) : mmToValue(sbs.curve), new TQ.IntervalValue(Number(r.x) || 0, Number(r.y) || 1)));
      } catch (e) {
        noteBuildFailure('sizeBySpeed', e);
      }
    }
  }
  const ivMod = ps.InheritVelocityModule;
  if (ivMod && ivMod.enabled === true && (ps.emitterVelocityMode | 0) === 0 && mmIsActive(ivMod.m_Curve, 0))
    behaviors.push(new InheritVelocityUnity(Number(ivMod.m_Curve.scalar) || 0, (ivMod.m_Mode | 0) === 1));
  const flip = sys.flip;
  if (flip && (flip.x > 0 || flip.y > 0 || flip.z > 0)) behaviors.push(new FlipInit(flip.x, flip.y, flip.z));
  const useTiles = !!(uvMod.enabled && entry && entry.tex);
  const tilesX = useTiles ? Math.max(1, uvMod.tilesX | 0 || 1) : 1,
    tilesY = useTiles ? Math.max(1, uvMod.tilesY | 0 || 1) : 1;
  const animType = uvMod.animationType | 0;
  const frameCount = useTiles ? Math.max(1, animType === 1 ? tilesX : tilesX * tilesY) : 1;
  const rowMode = uvMod.rowMode == null ? 1 : uvMod.rowMode | 0;
  const meshIdx = split && split.count > 1 ? split.index | 0 : 0;
  const rowIdx = useTiles && animType === 1 ? (rowMode === 0 ? uvMod.rowIndex | 0 : rowMode === 2 ? Math.min(tilesY - 1, meshIdx) : Math.floor(Math.random() * tilesY)) : 0;
  const rowBase = useTiles && animType === 1 ? rowIdx * tilesX : 0;
  const cycles = Number(uvMod.cycles) > 0 ? Number(uvMod.cycles) : 1;
  const startFrameVal = mmIsActive(uvMod.startFrame, 0) ? Math.floor((uvMod.startFrame.scalar || 0) * frameCount) : 0;
  const fot = uvMod.frameOverTime;
  const fotAnimated = useTiles && fot && (fot.minMaxState === 1 || fot.minMaxState === 2);
  let startTile = rowBase + (useTiles ? Math.min(frameCount - 1, Math.max(0, startFrameVal)) : 0);
  if (fotAnimated) {
    behaviors.push(new TQ.FrameOverLife(mmToValue(fot, frameCount * cycles)));
  } else if (useTiles) {
    const fv = fot ? fot.scalar || 0 : 0;
    startTile = rowBase + Math.min(frameCount - 1, Math.max(0, Math.floor(fv * frameCount) + startFrameVal));
  }
  const renderMode = mapRenderMode(sys.renderMode);
  const tileOn = useTiles && (tilesX > 1 || tilesY > 1);
  const liveMode = renderMode === TQ.RenderMode.StretchedBillBoard && sys.freeformStretching ? 'freeform' : LIVE_MODE[renderMode];
  const live = appearance && !(entry && entry.lit) ? buildLiveGameShader(entry, sys, liveMode, tileOn, sys.renderAlignment | 0, ctx.liveCache) : null;
  let ageSlices = appearance && !live ? ageStripSlices(sys, useTiles) : null;
  const mat = appearance ? ctx.makeMaterial(entry, { allowBake: !useTiles && !live, streamValues: streamVaryingValues(sys, 0), matAnim: sys.matAnim || null, ageSlices }) : null;
  if (ageSlices && !usesAgeStrip(mat)) ageSlices = null;
  if (ageSlices || (live && live.useCustom)) behaviors.push(new AgeToCustom());
  const aniso = !!init.size3D;
  const startSize = aniso
    ? new TQ.Vector3Function(mmToValue(init.startSize), mmToValue(init.startSizeY || init.startSize), mmToValue(init.startSizeZ || init.startSize))
    : mmToValue(init.startSize);
  const startRotation =
    renderMode === TQ.RenderMode.Mesh && init.rotation3D
      ? new TQ.EulerGenerator(mmToValue(init.startRotationX), mmToValue(init.startRotationY), mmToValue(init.startRotation), 'ZXY')
      : mmToValue(init.startRotation);
  const params = {
    duration: ps.lengthInSec || 1,
    looping: loop ? ps.looping !== false : false,
    prewarm: !!ps.prewarm,
    worldSpace: !localSpace,
    shape: makeEmitter(shapeMod, { shapeMesh: shapeMeshOf(shapeMod, rawMesh, sys.shapeMeshPid), shapeTex: shapeTexOf(shapeMod, shapeTexOfPid) }),
    startLife: mmToValue(init.startLifetime),
    startSpeed: mmToValue(init.startSpeed, velComp),
    startSize,
    startRotation,
    startColor: startColorGen(init.startColor, { tint: entry ? entry.tint : null, ignoreVertexColor: !!(entry && entry.lit), duration: ps.lengthInSec || 1 }),
    emissionOverTime: mmToValue(em.rate || em.rateOverTime, 1 / splitN),
    emissionOverDistance: mmToValue(em.rateOverDistance, 1 / splitN),
    emissionBursts: bursts,
    behaviors,
    material: mat,
    renderMode,
    tpAlign: sys.renderAlignment | 0,
    tpAllowRoll: sys.allowRoll !== false,
    tpShapeScaleOnly: shapeOnly,
    tpMaxParticles: Number(init.maxNumParticles) > 0 ? Number(init.maxNumParticles) : 0,
    tpCustomCount: ageSlices || (live && live.useCustom) ? 1 : 0,
    tpAgeTiles: ageSlices ? ageSlices.length : 0,
    tpGameShader: live ? live.shader : null,
    tpLit: materialLit(mat),
    tpSetDepth: live ? live.setDepth || null : null,
    uTileCount: tilesX,
    vTileCount: tilesY,
    startTileIndex: new TQ.ConstantValue(startTile),
    renderOrder: drawOrder(entry, sys),
  };
  if (renderMode === TQ.RenderMode.StretchedBillBoard) {
    params.rendererEmitterSettings = {
      speedFactor: Number(sys.velocityScale || 0),
      lengthFactor: Number(sys.lengthScale != null ? sys.lengthScale : 2),
    };
  }
  if (renderMode === TQ.RenderMode.Mesh) {
    const pid = split && split.meshPid ? split.meshPid : sys.meshPid;
    const geo = pid && geoResolver ? geoResolver(pid, sys.pivot) : null;
    if (geo) params.instancingGeometry = geo;
  } else if (renderMode === TQ.RenderMode.BillBoard || renderMode === TQ.RenderMode.HorizontalBillBoard || renderMode === TQ.RenderMode.VerticalBillBoard) {
    const q = pivotQuad(sys.pivot);
    if (q) params.instancingGeometry = q;
  }
  return params;
}

