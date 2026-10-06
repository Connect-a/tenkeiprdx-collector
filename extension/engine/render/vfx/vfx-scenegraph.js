import * as THREE from '../../../vendor/three.module.js';
import * as TQ from './quarks-ext.js';
import { vfxParse } from './vfx-parse.js';
import { quatMul, quatRotate } from '../../../unity/quat.js';
import { proceduralTex } from './vfx-proctex.js';
import { evalHermite, keyOnAt } from './vfx-curve.js';
import { createSpinNodes, composeChain, sampleAxis } from './vfx-transform.js';
import { attachTrailSync } from './vfx-trailsync.js';
import { createCameraTrack } from './vfx-camtrack.js';
import { interpretClipEvents, backgroundVisibleAt } from './vfx-events.js';
import { createStaticMeshBuilder, computeBounds } from './vfx-meshnodes.js';
import { createTrailRenderers } from './vfx-trailrend.js';
import { createRibbonTrails } from './vfx-ribbon.js';
import { envLight } from './vfx-lighting.js';
import { scriptVfxContext } from './vfx-context.js';
import { meshPositionsWithPivot } from './vfx-shape.js';
import { resolveMatAnim } from './vfx-matanim.js';
import { buildParams, buildTrailParams, emitterScale } from './vfx-build.js';
import { makeMaterial, drawOrder } from './vfx-material.js';
import { SubEmitterInherit } from './vfx-behaviors.js';
import { unityGradientKeys, sampleUnityGradient } from './vfx-gradient.js';
import { noteBuildFailure, notePlayFailure } from './vfx-failures.js';
const MODIFICATOR_BITS = [
  [1, 'Looped'],
  [2, 'Throwable'],
  [4, 'UseAtTargetPosition'],
  [8, 'LogEvents'],
  [16, 'PlaybackAtOrigin'],
  [32, 'UseAnimatorStates'],
  [64, 'PlaybackAtClickPoint'],
  [128, 'PlaybackAtFieldCenter'],
];
function placementLabel(m) {
  if (m == null) return null;
  return { flags: MODIFICATOR_BITS.filter(([b]) => m & b).map(([, n]) => n) };
}
function isLocalMesh(sys) {
  return (sys.renderAlignment | 0) === 2 && (sys.renderMode | 0) === 0;
}
function makeLocalQuad(sys, texByMatPid, makeMat) {
  const ps = sys.ps || {},
    init = ps.InitialModule || {},
    rotM = ps.RotationModule || {};
  const sizeX = (init.startSize && init.startSize.scalar) || 1;
  const sizeY = init.size3D && init.startSizeY ? init.startSizeY.scalar : init.startSizeX ? init.startSizeX.scalar : sizeX;
  const S = (ps.scalingMode | 0) === 2 ? 1 : emitterScale(sys).x || 1;
  const P = sys.pos || { x: 0, y: 0, z: 0 };
  const q0 = sys.rot || { x: 0, y: 0, z: 0, w: 1 };
  const pv = sys.pivot || { x: 0, y: 0 };
  const U = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ];
  const rc = rotM.enabled ? rotM.curve : null;
  const rScalar = rc ? rc.scalar || 0 : 0;
  const rKeys = rc && rc.maxCurve && rc.maxCurve.m_Curve ? rc.maxCurve.m_Curve : [];
  const curveEval = (f) => evalHermite(rKeys, f);
  const uvM = ps.UVModule || {};
  const entry = texByMatPid && sys.matPid ? texByMatPid.get(sys.matPid) : null;
  let u0 = 0,
    u1 = 1,
    v0 = 0,
    v1 = 1;
  const uvTiled = !!(uvM.enabled && entry && entry.tex);
  if (uvTiled) {
    const tx = Math.max(1, uvM.tilesX | 0 || 1),
      ty = Math.max(1, uvM.tilesY | 0 || 1);
    const animType = uvM.animationType | 0,
      rowIdx = uvM.rowIndex | 0;
    const frameCount = Math.max(1, animType === 1 ? tx : tx * ty);
    const fv = uvM.frameOverTime ? uvM.frameOverTime.scalar || 0 : 0;
    let frame = Math.min(frameCount - 1, Math.max(0, Math.floor(fv * frameCount)));
    const col = animType === 1 ? frame : frame % tx,
      row = animType === 1 ? rowIdx : Math.floor(frame / tx);
    u0 = col / tx;
    u1 = (col + 1) / tx;
    v1 = (ty - row) / ty;
    v0 = (ty - 1 - row) / ty;
    if (uvM.flipV) {
      const t = v0;
      v0 = v1;
      v1 = t;
    }
    if (uvM.flipU) {
      const t = u0;
      u0 = u1;
      u1 = t;
    }
  }
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(12);
  const posAttr = new THREE.BufferAttribute(pos, 3);
  g.setAttribute('position', posAttr);
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([u0, v0, u1, v0, u1, v1, u0, v1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const scRaw = (init.startColor && (init.startColor.maxColor || init.startColor)) || { r: 1, g: 1, b: 1, a: 1 };
  const tint = entry && entry.tint ? entry.tint : [1, 1, 1, 1];
  const sc = { r: (scRaw.r == null ? 1 : scRaw.r) * tint[0], g: (scRaw.g == null ? 1 : scRaw.g) * tint[1], b: (scRaw.b == null ? 1 : scRaw.b) * tint[2], a: scRaw.a };
  const mat = makeMat(entry, { allowBake: !uvTiled });
  mat.color.setRGB(sc.r, sc.g, sc.b);
  const fades = mat.transparent;
  if (fades) mat.opacity = 0;
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = drawOrder(entry, sys);
  const life = (init.startLifetime && init.startLifetime.scalar) || 0.25;
  const delay = (ps.startDelay && ps.startDelay.scalar) || 0;
  const baseA = sc.a == null ? 1 : sc.a;
  const colM = ps.ColorModule || {};
  const grad = colM.enabled && colM.gradient ? colM.gradient.maxGradient : null;
  const gradKeys = unityGradientKeys(grad);
  const gradSmp = [1, 1, 1, 1];
  const sampleAt = (f) => sampleUnityGradient(gradKeys, f, gradSmp);
  function writeCorners(theta) {
    const s = Math.sin(theta / 2),
      swq = { x: 0, y: 0, z: s, w: Math.cos(theta / 2) };
    const R = quatMul(q0, swq);
    for (let i = 0; i < 4; i++) {
      const lx = (U[i][0] + pv.x) * sizeX,
        ly = (U[i][1] + pv.y) * sizeY;
      const rv = quatRotate(R, lx, ly, 0);
      pos[i * 3] = P.x + S * rv[0];
      pos[i * 3 + 1] = P.y + S * rv[1];
      pos[i * 3 + 2] = P.z + S * rv[2];
    }
    posAttr.needsUpdate = true;
  }
  writeCorners(0);
  let el = 0,
    theta = 0;
  const api = {
    mesh,
    gateKeys: null,
    gateOn: true,
    update: (dt) => {
      el += dt;
      const t = el - delay;
      if (t < 0 || t > life || api.gateOn === false) {
        mesh.visible = false;
        return;
      }
      mesh.visible = true;
      const f = t / life;
      theta += -curveEval(f) * rScalar * dt;
      writeCorners(theta);
      sampleAt(f);
      mat.color.setRGB(sc.r * gradSmp[0], sc.g * gradSmp[1], sc.b * gradSmp[2]);
      if (fades) mat.opacity = baseA * (gradKeys ? gradSmp[3] : 1);
    },
    dispose: () => {
      g.dispose();
      mat.dispose();
    },
  };
  return api;
}

const litEntry = (texByMatPid, sys) => {
  const e = texByMatPid && sys && sys.matPid ? texByMatPid.get(sys.matPid) : null;
  return !!(e && e.lit);
};
function addSceneLights(root, L) {
  const d = new THREE.DirectionalLight(new THREE.Color(L.color[0], L.color[1], L.color[2]), L.intensity);
  d.position.set(L.dir[0] * 50, L.dir[1] * 50, L.dir[2] * 50);
  root.add(d);
}

const _evq = new THREE.Quaternion();
function emitterVelocityOf(iv, dt) {
  const v = iv.ps.tpEmitterVel;
  v.subVectors(iv.world, iv.prev).divideScalar(dt);
  if (!iv.ps.worldSpace) v.applyQuaternion(iv.obj.getWorldQuaternion(_evq).invert());
}
const _spv = new THREE.Vector3();
const _viewPos = new THREE.Vector3();
const _viewFwd = new THREE.Vector3();
function viewOf(renderCam, dataCam) {
  if (renderCam && renderCam.getWorldPosition) {
    renderCam.getWorldPosition(_viewPos);
    renderCam.getWorldDirection(_viewFwd);
    return { pos: _viewPos, fwd: _viewFwd };
  }
  if (dataCam && dataCam.pos) {
    _viewPos.set(dataCam.pos.x || 0, dataCam.pos.y || 0, dataCam.pos.z || 0);
    const f = quatRotate(dataCam.rot || { x: 0, y: 0, z: 0, w: 1 }, 0, 0, 1);
    _viewFwd.set(f[0], f[1], f[2]);
    return { pos: _viewPos, fwd: _viewFwd };
  }
  return null;
}
function sortParticles(ps, mode, emitterObj, view) {
  const n = ps.particleNum | 0;
  if (n < 2 || !ps.particles) return;
  const live = ps.particles.slice(0, n);
  const world = emitterObj && !ps.worldSpace ? emitterObj.matrixWorld : null;
  const key = (p) => {
    if (mode === 2) return p.age;
    if (mode === 3) return -p.age;
    if (!view) return 0;
    _spv.copy(p.position);
    if (world) _spv.applyMatrix4(world);
    const dx = _spv.x - view.pos.x,
      dy = _spv.y - view.pos.y,
      dz = _spv.z - view.pos.z;
    if (mode === 4 || mode === 6) {
      const z = dx * view.fwd.x + dy * view.fwd.y + dz * view.fwd.z;
      return mode === 6 ? z : -z;
    }
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return mode === 5 ? d : -d;
  };
  live.sort((a, b) => key(b) - key(a));
  for (let i = 0; i < n; i++) ps.particles[i] = live[i];
}

function createSceneVfx(bytes, opt) {
  const data = vfxParse.parseVfx(bytes);
  if (!data) return null;
  const hasSystems = !!(data.systems && data.systems.length);
  const hasCamera = !!(data.cameras && data.cameras.length);
  const hasEvents = !!(data.clipEvents && data.clipEvents.length);
  if (!hasSystems && !hasCamera && !hasEvents) return null;
  if (!data.systems) data.systems = [];
  const texByMatPid = (opt && opt.texByMatPid) || null;
  const loop = !!(opt && opt.loop);
  const vfx = (opt && opt.vfx) || scriptVfxContext();
  const makeMat = (entry, o) => makeMaterial(entry, o, vfx);
  const meshByPid = data.meshByPid || {};
  const gate = data.animGate;
  const gInactive = (gate && gate.inactive) || [];
  const gEmission = new Map((gate && gate.emission) || []);
  const gDefaultActive = new Set((gate && gate.defaultActive) || []);
  const goHidden = (sys) => sys.goActive === false && !gDefaultActive.has(sys.path);
  const gateHidden = (p) => {
    if (!p) return false;
    if (gInactive.some((ip) => p === ip || p.startsWith(ip + '/'))) return true;
    for (const [ep, ev] of gEmission) if (ev <= 1e-4 && (p === ep || p.startsWith(ep + '/'))) return true;
    return false;
  };
  const gTimeline = (gate && gate.timeline) || [];
  const gateDur = (gate && gate.duration) || 0;
  const scheduleFor = (p) => {
    if (!p || !gTimeline.length) return null;
    const out = [];
    for (const tl of gTimeline) if (p === tl.path || p.startsWith(tl.path + '/')) if (tl.keys && tl.keys.length > 1) out.push(tl.keys);
    return out.length ? out : null;
  };
  const activeAt = (list, t) => {
    for (const keys of list) if (!keyOnAt(keys, t)) return false;
    return true;
  };
  const rawMesh = (pid) => meshByPid[String(pid)] || null;
  const shapeTexOfPid = (pid) => (data.shapeTexByPid && data.shapeTexByPid[String(pid)]) || null;
  const geoCache = new Map();
  const geoResolver = (pid, pv) => {
    const px = (pv && pv.x) || 0,
      py = (pv && pv.y) || 0,
      pz = (pv && pv.z) || 0;
    const k = String(pid) + '|' + px + ',' + py + ',' + pz;
    if (geoCache.has(k)) return geoCache.get(k);
    const md = meshByPid[String(pid)];
    let g = null;
    if (md && md.positions && md.positions.length) {
      g = new THREE.BufferGeometry();
      const posArr = meshPositionsWithPivot(md.positions, { x: px, y: py, z: pz });
      g.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
      if (md.uv) g.setAttribute('uv', new THREE.BufferAttribute(md.uv, 2));
      if (md.normals) g.setAttribute('normal', new THREE.BufferAttribute(md.normals, 3));
      if (md.indices) g.setIndex(new THREE.BufferAttribute(md.indices, 1));
    }
    geoCache.set(k, g);
    return g;
  };
  const buildCtx = { texByMatPid, loop, geoResolver, rawMesh, shapeTexOfPid, makeMaterial: makeMat, liveCache: new Map() };
  const updateErrors = new Map();
  const guard = (tag, fn) => {
    try {
      fn();
    } catch (e) {
      const r = updateErrors.get(tag) || { count: 0, message: '' };
      r.count++;
      r.message = (e && e.message) || String(e);
      updateErrors.set(tag, r);
      notePlayFailure(tag, e);
    }
  };
  const group = new THREE.Group();
  if ((data.systems || []).some((s) => litEntry(texByMatPid, s))) addSceneLights(group, envLight(vfx.env));
  const batch = new TQ.BatchedRenderer();
  group.add(batch);
  const { nodes: spinNodes, animByPath, advance: advanceSpins } = createSpinNodes(group, data.transformAnims);
  const matAnimByPath = new Map();
  for (const a of data.matAnims || []) matAnimByPath.set(a.path, a);
  const showAll = !data.systems.some((s) => (s.renderMode | 0) !== 5 && !gateHidden(s.path) && !goHidden(s));
  const systems = [];
  const buildFailures = [];
  const failBuild = (rec) => {
    buildFailures.push(rec);
    noteBuildFailure(rec.kind || (rec.trailRenderer ? 'trailRenderer' : rec.ribbon ? 'ribbon' : rec.local ? 'localMesh' : 'system'), rec);
  };
  const depthSetters = [];
  const ownedMaterials = [];
  const unscaled = [];
  const undoSpinScale = () => {
    for (const u of unscaled) {
      const n = u.node.scale;
      u.obj.scale.set(Math.abs(n.x) > 1e-6 ? u.s.x / n.x : u.s.x, Math.abs(n.y) > 1e-6 ? u.s.y / n.y : u.s.y, Math.abs(n.z) > 1e-6 ? u.s.z / n.z : u.s.z);
    }
  };
  let depthWriters = 0;
  let view = null;
  const clawAnims = [];
  const psByObjPid = new Map();
  const ctx = {
    group,
    spinNodes,
    geoResolver,
    animByPath,
    composeChain,
    sampleAxis,
    entryOf: (pid) => (texByMatPid && pid ? texByMatPid.get(pid) : null),
    matAnimOf: (path) => matAnimByPath.get(path) || null,
    nodeOf: (path) => {
      const sp = spinNodes.get(path);
      return (sp && sp.node) || group.getObjectByName(path.split('/').pop()) || null;
    },
    makeMaterial: makeMat,
    resolveMatAnim,
    hidden: (node) => !showAll && (gateHidden(node.path) || goHidden(node)),
    scheduleFor,
    activeAt,
    get gateDur() {
      return gateDur;
    },
    prepare: (node) => {
      const entry = texByMatPid && node.matPid ? texByMatPid.get(node.matPid) : null;
      const spin = node.animParent ? spinNodes.get(node.animParent) : null;
      return {
        hidden: !showAll && (gateHidden(node.path) || goHidden(node)),
        entry,
        gateKeys: scheduleFor(node.path),
        spin,
        parent: (spin && spin.node) || group,
        order: drawOrder(entry, node),
      };
    },
    fail: failBuild,
  };
  const inheritVel = [];
  const staticMeshes = createStaticMeshBuilder(ctx);
  const trailRends = createTrailRenderers(ctx);
  const ribbons = createRibbonTrails(ctx);
  const addParticleSystem = (sys, pre) => {
    if ((sys.renderMode | 0) === 5 || sys.rendEnabled === false) return;
    if (isLocalMesh(sys)) {
      try {
        const cm = makeLocalQuad(sys, texByMatPid, makeMat);
        cm.gateKeys = pre.gateKeys;
        group.add(cm.mesh);
        clawAnims.push(cm);
      } catch (e) {
        failBuild({ path: sys.path, renderMode: sys.renderMode | 0, message: (e && e.message) || String(e), local: true });
      }
      return;
    }
    sys.matAnim = resolveMatAnim(ctx.matAnimOf(sys.path), pre.entry);
    const meshChoices = (sys.renderMode | 0) === 4 ? (sys.meshPids || []).filter((mp) => geoResolver(mp)) : [];
    const nSplit = meshChoices.length > 1 ? Math.min(4, meshChoices.length) : 1;
    for (let k = 0; k < nSplit; k++) {
      let ps;
      try {
        const params = buildParams(sys, buildCtx, nSplit > 1 ? { index: k, count: nSplit, meshPid: meshChoices[k] } : null);
        if (params.material) ownedMaterials.push(params.material);
        if (params.tpSetDepth) depthSetters.push(params.tpSetDepth);
        if (params.material && params.material.depthWrite) depthWriters++;
        ps = TQ.createParticleSystem(params);
      } catch (e) {
        failBuild({ path: sys.path, renderMode: sys.renderMode | 0, message: (e && e.message) || String(e) });
        continue;
      }
      batch.addSystem(ps);
      try {
        ps.play();
      } catch (err) {
        notePlayFailure('play', err);
      }
      const psDelay = (sys.ps && sys.ps.startDelay && Number(sys.ps.startDelay.scalar)) || 0;
      const delay = psDelay > 1e-4 ? psDelay : 0;
      if (delay) {
        try {
          ps.pause();
        } catch (err) {
          notePlayFailure('pause', err);
        }
      }
      const e = ps.emitter;
      const spin = sys.animParent ? spinNodes.get(sys.animParent) : null;
      const localMode = ((sys.ps && sys.ps.scalingMode) | 0) === 1;
      const p = spin && sys.localPos ? sys.localPos : sys.pos || { x: 0, y: 0, z: 0 },
        r = spin && sys.localRot ? sys.localRot : sys.rot || { x: 0, y: 0, z: 0, w: 1 },
        s = spin && sys.animLocalScale && !localMode ? sys.animLocalScale : emitterScale(sys);
      e.position.set(p.x || 0, p.y || 0, p.z || 0);
      e.quaternion.set(r.x || 0, r.y || 0, r.z || 0, r.w == null ? 1 : r.w);
      e.scale.set(s.x, s.y, s.z);
      e.name = sys.name || '';
      e.userData.tpPath = sys.path;
      (spin ? spin.node : group).add(e);
      if (spin && localMode) unscaled.push({ obj: e, s, node: spin.node });
      const speed = Number(sys.ps && sys.ps.simulationSpeed) > 0 ? Number(sys.ps.simulationSpeed) : 1;
      const gateKeys = scheduleFor(sys.path);
      const ent = { ps, speed, gateKeys, on: true, delay, playAt: delay || null };
      if (ps.behaviors && ps.behaviors.some((b) => b && b.type === 'tp-inheritvel')) {
        ps.tpEmitterVel = new THREE.Vector3();
        inheritVel.push({ ps, obj: e, prev: null, world: new THREE.Vector3() });
      }
      const sortMode = sys.sortMode | 0;
      if (speed !== 1 || sortMode) {
        const orig = ps.update.bind(ps);
        ps.update = (d) => {
          orig(d * speed);
          if (sortMode) sortParticles(ps, sortMode, e, view);
        };
      }
      if (gateKeys && !activeAt(gateKeys, 0)) {
        ent.on = false;
        ent.playAt = null;
        try {
          ps.pause();
        } catch (err) {
          notePlayFailure('pause', err);
        }
        ps.particleNum = 0;
      }
      systems.push(ent);
      if (sys.objPid && k === 0) psByObjPid.set(String(sys.objPid), ps);
      const tmod = (sys.ps && sys.ps.TrailModule) || {};
      if (k === 0 && tmod.enabled === true && sys.trailMatPid && (tmod.mode | 0) === 1) ribbons.add(sys, ps, spin ? spin.node : group, pre);
      const trailParams = k === 0 ? buildTrailParams(sys, buildCtx) : null;
      if (trailParams && trailParams.material) ownedMaterials.push(trailParams.material);
      if (trailParams) {
        try {
          const tps = TQ.createParticleSystem(trailParams);
          batch.addSystem(tps);
          tps.play();
          const te = tps.emitter;
          te.position.copy(e.position);
          te.quaternion.copy(e.quaternion);
          te.scale.copy(e.scale);
          te.name = (sys.name || '') + '#trail';
          te.userData.tpPath = sys.path;
          te.userData.tpTrail = 1;
          (spin ? spin.node : group).add(te);
          if (spin && localMode) unscaled.push({ obj: te, s, node: spin.node });
          attachTrailSync(ps, tps, sys.ps && sys.ps.TrailModule);
          if (speed !== 1) {
            const synced = tps.update.bind(tps);
            tps.update = (d) => synced(d * speed);
          }
          const tent = { ps: tps, speed, gateKeys, on: ent.on, delay: 0, playAt: null };
          if (!ent.on) {
            tps.pause();
            tps.particleNum = 0;
          }
          systems.push(tent);
        } catch (err) {
          failBuild({ path: sys.path, renderMode: sys.renderMode | 0, kind: 'trail', message: (err && err.message) || String(err) });
        }
      }
    }
  };
  const addByKind = { particles: addParticleSystem, mesh: staticMeshes.add, trail: trailRends.add };
  for (const node of data.nodes) {
    const add = addByKind[node.kind];
    if (!add) continue;
    const pre = ctx.prepare(node);
    if (pre.hidden) continue;
    add(node, pre);
  }
  if (TQ.EmitSubParticleSystem && TQ.SubParticleEmitMode) {
    for (const link of vfxParse.getSubEmitterLinks(data.systems)) {
      const parentPs = link.parent.objPid ? psByObjPid.get(String(link.parent.objPid)) : null;
      const childPs = psByObjPid.get(link.childObjPid);
      if (!parentPs || !childPs || childPs === parentPs) continue;
      const mode = link.type === 0 ? TQ.SubParticleEmitMode.Birth : TQ.SubParticleEmitMode.Death;
      try {
        const beh = link.inherit ? new SubEmitterInherit(parentPs, false, childPs.emitter, mode, link.prob, link.inherit) : new TQ.EmitSubParticleSystem(parentPs, false, childPs.emitter, mode, link.prob);
        if (parentPs.addBehavior) parentPs.addBehavior(beh);
        else parentPs.behaviors.push(beh);
      } catch (err) {
        failBuild({ path: (link && link.parent && link.parent.path) || null, kind: 'subEmitter', message: (err && err.message) || String(err) });
      }
    }
  }
  let bounds = null;
  const refreshBounds = () => {
    bounds =
      computeBounds({
        group,
        objects: function* () {
          for (const ent of systems) yield ent.ps && ent.ps.emitter;
          for (const c of clawAnims) yield c.mesh;
          for (const sm of staticMeshes.items) yield sm.mesh;
        },
        fallbackPositions: () => (data.systems || []).map((s) => s.pos),
      }) || bounds;
  };
  advanceSpins(0);
  undoSpinScale();
  refreshBounds();
  const camTrack = createCameraTrack(ctx, data.cameras || []);
  const activeCamera = () => camTrack.activeCamera(gateDur > 0.01 ? elapsed % gateDur : elapsed);
  const renderCamera = () => (opt && typeof opt.renderCamera === 'function' ? opt.renderCamera() : null);
  const events = interpretClipEvents(data.clipEvents, data.animGate, data.audioClips);
  const backgroundVisible = () => (events.background.length ? backgroundVisibleAt(events.background, gateDur > 0.01 ? elapsed % gateDur : elapsed) : true);
  let elapsed = 0;
  return {
    group,
    cameras: camTrack.cameras,
    blendLists: (data.cameras && data.cameras.blendLists) || [],
    fbxSlots: data.fbxSlots || [],
    post: data.post || null,
    volumeGate: (path) => {
      const vt = (data.animGate && data.animGate.volumeTimeline) || [];
      const hit = vt.find((x) => x.path === path);
      return hit ? hit.keys : null;
    },
    activeCamera,
    backgroundVisible,
    hasBackgroundEvents: events.background.length > 0,
    motionEvents: events.motions,
    soundEvents: events.sounds,
    textEvents: events.texts,
    duration: events.duration,
    chainAt: events.chainAt,
    effectCues: events.effectCues,
    buildFailures,
    needsDepth: depthSetters.length > 0 && depthWriters > 0,
    setDepthTexture: (tex) => {
      for (const f of depthSetters) f(tex);
    },
    modificator: data.modificator == null ? null : data.modificator | 0,
    placement: placementLabel(data.modificator),
    updateErrors,
    update: (dt) => {
      elapsed += dt;
      const gt = gateDur > 0.01 ? elapsed % gateDur : elapsed;
      for (const ent of systems) {
        if (ent.gateKeys) {
          const on = activeAt(ent.gateKeys, gt);
          if (on !== ent.on) {
            ent.on = on;
            guard('gateToggle', () => {
              if (on) {
                ent.ps.restart();
                if (ent.delay) {
                  ent.ps.pause();
                  ent.playAt = elapsed + ent.delay;
                } else ent.ps.play();
              } else {
                ent.ps.pause();
                ent.ps.particleNum = 0;
                ent.playAt = null;
              }
            });
          }
        }
        if (ent.playAt != null && elapsed >= ent.playAt) {
          ent.playAt = null;
          guard('delayedPlay', () => ent.ps.play());
        }
      }
      const rc = renderCamera();
      if (rc) rc.updateMatrixWorld();
      const dataCam = activeCamera();
      const orientCam = rc || dataCam;
      view = viewOf(rc, dataCam);
      if (spinNodes.size) {
        advanceSpins(dt);
        undoSpinScale();
      }
      for (const iv of inheritVel) {
        iv.obj.updateWorldMatrix(true, false);
        iv.world.setFromMatrixPosition(iv.obj.matrixWorld);
        if (iv.prev && dt > 1e-6) emitterVelocityOf(iv, dt);
        else iv.ps.tpEmitterVel.set(0, 0, 0);
        (iv.prev || (iv.prev = new THREE.Vector3())).copy(iv.world);
      }
      guard('batchUpdate', () => {
        batch.tpCamera = rc;
        batch.update(dt);
      });
      for (const c of clawAnims)
        guard('clawUpdate', () => {
          if (c.gateKeys) c.gateOn = activeAt(c.gateKeys, gt);
          c.update(dt);
        });
      for (const sm of staticMeshes.items) if (sm.gateKeys) sm.mesh.visible = activeAt(sm.gateKeys, gt);
      if (trailRends.count) guard('trailUpdate', () => trailRends.update(dt, orientCam));
      if (ribbons.count) guard('ribbonUpdate', () => ribbons.update(dt, orientCam));
    },
    bounds,
    liveCount: () => {
      let n = 0;
      for (const ent of systems) n += ent.ps.particleNum || 0;
      for (const c of clawAnims) if (c.mesh && c.mesh.visible) n++;
      for (const sm of staticMeshes.items) if (sm.mesh.visible) n++;
      return n;
    },
    dispose: () => {
      guard('dispose', () => {
        for (const ent of systems) ent.ps.dispose();
      });
      guard('dispose', () => TQ.disposeBatchedRenderer(batch));
      for (const m of ownedMaterials) guard('dispose', () => m.dispose());
      for (const g of geoCache.values()) if (g) guard('dispose', () => g.dispose());
      for (const c of clawAnims) guard('dispose', () => c.dispose());
      staticMeshes.disposeMaterials();
      guard('dispose', () => trailRends.dispose());
      guard('dispose', () => ribbons.dispose());
    },
  };
}

function prewarmMaterials(texByMatPid) {
  if (!texByMatPid) return { ok: 0, failed: 0 };
  let n = 0,
    failed = 0;
  for (const [, e] of texByMatPid) {
    if (!e || e.tex || !e.proc) continue;
    try {
      if (proceduralTex(e.proc)) n++;
    } catch (err) {
      failed++;
    }
  }
  return { ok: n, failed };
}

export { createSceneVfx, prewarmMaterials };
