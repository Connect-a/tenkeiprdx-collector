import * as THREE from '../../../vendor/three.module.js';
import { evalHermite } from './vfx-curve.js';
import { unityGradientKeys, sampleUnityGradient } from './vfx-gradient.js';
import { STRIP_MAX_POINTS, createStripMesh, readCameraPosition, stripSide, writeStripPoint, commitStrip } from './vfx-strip.js';

const _camPos = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _w = new THREE.Vector3();
const _rgbaLife = [1, 1, 1, 1];
const _rgbaTrail = [1, 1, 1, 1];

const curveKeys = (mm) => (mm && mm.maxCurve && mm.maxCurve.m_Curve && mm.maxCurve.m_Curve.length ? mm.maxCurve.m_Curve : null);

export function createRibbonTrails(ctx) {
  const items = [];

  const add = (sys, ps, node, pre) => {
    const tm = (sys.ps && sys.ps.TrailModule) || {};
    const entry = ctx.entryOf ? ctx.entryOf(sys.trailMatPid) : null;
    let mat;
    try {
      mat = ctx.makeMaterial(entry, { allowBake: true });
    } catch (e) {
      ctx.fail({ path: sys.path, renderMode: -3, message: (e && e.message) || String(e), ribbon: true });
      return;
    }
    mat.vertexColors = true;
    const count = Math.max(1, Math.min(64, tm.ribbonCount | 0 || 1));
    const strips = [];
    for (let r = 0; r < count; r++) {
      const { mesh, geo } = createStripMesh(mat, pre.order, 'tpRibbon');
      ctx.group.add(mesh);
      strips.push({ mesh, geo });
    }
    items.push({
      sys,
      ps,
      node,
      mat,
      strips,
      count,
      widthKeys: curveKeys(tm.widthOverTrail),
      widthScalar: tm.widthOverTrail && tm.widthOverTrail.scalar != null ? Number(tm.widthOverTrail.scalar) : 1,
      sizeAffectsWidth: tm.sizeAffectsWidth !== false,
      inheritColor: tm.inheritParticleColor !== false,
      gradLife: unityGradientKeys(tm.colorOverLifetime && tm.colorOverLifetime.maxGradient),
      gradTrail: unityGradientKeys(tm.colorOverTrail && tm.colorOverTrail.maxGradient),
      buf: [],
    });
  };

  const update = (dt, cam) => {
    if (!items.length) return;
    readCameraPosition(cam, _camPos);
    for (const it of items) {
      const ps = it.ps;
      const n = ps.particleNum | 0;
      const live = [];
      for (let i = 0; i < n; i++) live.push(ps.particles[i]);
      live.sort((a, b) => b.age - a.age);
      const world = !ps.worldSpace && it.node ? it.node.matrixWorld : null;
      for (let r = 0; r < it.count; r++) {
        const strip = it.strips[r];
        const pts = it.buf;
        pts.length = 0;
        for (let i = r; i < live.length && pts.length < STRIP_MAX_POINTS; i += it.count) pts.push(live[i]);
        const m = pts.length;
        if (m < 2) {
          strip.geo.setDrawRange(0, 0);
          strip.mesh.visible = false;
          continue;
        }
        strip.mesh.visible = true;
        for (let i = 0; i < m; i++) {
          const q = pts[i];
          _p.copy(q.position);
          if (world) _p.applyMatrix4(world);
          const qPrev = pts[Math.max(0, i - 1)],
            qNext = pts[Math.min(m - 1, i + 1)];
          _d.set(qNext.position.x - qPrev.position.x, qNext.position.y - qPrev.position.y, qNext.position.z - qPrev.position.z);
          if (world) _d.transformDirection(world);
          stripSide(_w, _d, _p.x, _p.y, _p.z, _camPos);
          const u = m > 1 ? i / (m - 1) : 0;
          const lifeT = Math.max(0, Math.min(1, q.age / (q.life || 1)));
          let hw = (it.widthKeys ? evalHermite(it.widthKeys, u) : 1) * it.widthScalar;
          if (it.sizeAffectsWidth) hw *= (Math.abs(q.size.x) + Math.abs(q.size.y)) * 0.5;
          hw *= 0.5;
          let cr = 1,
            cg = 1,
            cb = 1,
            cadd = 1;
          if (it.gradLife) {
            sampleUnityGradient(it.gradLife, lifeT, _rgbaLife);
            cr *= _rgbaLife[0];
            cg *= _rgbaLife[1];
            cb *= _rgbaLife[2];
            cadd *= _rgbaLife[3];
          }
          if (it.gradTrail) {
            sampleUnityGradient(it.gradTrail, u, _rgbaTrail);
            cr *= _rgbaTrail[0];
            cg *= _rgbaTrail[1];
            cb *= _rgbaTrail[2];
            cadd *= _rgbaTrail[3];
          }
          if (it.inheritColor && q.color) {
            cr *= q.color.x;
            cg *= q.color.y;
            cb *= q.color.z;
            cadd *= q.color.w;
          }
          writeStripPoint(strip.geo, i, _p.x, _p.y, _p.z, _w, hw, cr, cg, cb, cadd, u);
        }
        commitStrip(strip.geo, m);
      }
    }
  };

  const dispose = () => {
    for (const it of items) {
      try {
        it.mat.dispose();
        for (const s of it.strips) s.geo.dispose();
      } catch (e) {}
    }
    items.length = 0;
  };

  return {
    add,
    update,
    dispose,
    get count() {
      return items.length;
    },
  };
}
