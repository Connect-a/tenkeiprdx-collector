import * as THREE from '../../../vendor/three.module.js';
import { evalHermite } from './vfx-curve.js';
import { unityGradientKeysCached, sampleUnityGradient } from './vfx-gradient.js';
import { STRIP_MAX_POINTS, createStripMesh, readCameraPosition, stripSide, writeStripPoint, commitStrip } from './vfx-strip.js';

const _wp = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _d = new THREE.Vector3();
const _w = new THREE.Vector3();
const _rgba = [1, 1, 1, 1];

export function createTrailRenderers(ctx) {
  const items = [];
  const add = (n, pre) => {
    const node = ctx.nodeOf(n.path);
    if (!node) return;
    let mat;
    try {
      mat = ctx.makeMaterial(pre.entry, { allowBake: true });
    } catch (e) {
      ctx.fail({ path: n.path, renderMode: -2, message: (e && e.message) || String(e), trailRenderer: true });
      return;
    }
    mat.vertexColors = true;
    const { mesh, geo } = createStripMesh(mat, pre.order, 'tpTrailRenderer');
    ctx.group.add(mesh);
    items.push({ n, node, mesh, geo, mat, pts: [], gateKeys: pre.gateKeys, elapsed: 0 });
  };

  const update = (dt, cam) => {
    if (!items.length) return;
    readCameraPosition(cam, _camPos);
    for (const it of items) {
      it.elapsed += dt;
      const on = (!it.gateKeys || ctx.activeAt(it.gateKeys, it.elapsed)) && it.n.emitting !== false;
      it.node.getWorldPosition(_wp);
      const pts = it.pts;
      if (on) {
        const last = pts.length ? pts[pts.length - 1] : null;
        const far = !last || Math.hypot(_wp.x - last.x, _wp.y - last.y, _wp.z - last.z) >= (it.n.minVertexDistance || 0);
        if (far) pts.push({ x: _wp.x, y: _wp.y, z: _wp.z, t: it.elapsed });
        else {
          last.x = _wp.x;
          last.y = _wp.y;
          last.z = _wp.z;
          last.t = it.elapsed;
        }
        while (pts.length > STRIP_MAX_POINTS) pts.shift();
      }
      const life = it.n.time || 0;
      while (pts.length && it.elapsed - pts[0].t > life) pts.shift();
      const m = pts.length;
      if (m < 2) {
        it.geo.setDrawRange(0, 0);
        it.mesh.visible = false;
        continue;
      }
      it.mesh.visible = true;
      for (let i = 0; i < m; i++) {
        const p = pts[i];
        const pPrev = pts[Math.max(0, i - 1)],
          pNext = pts[Math.min(m - 1, i + 1)];
        _d.set(pNext.x - pPrev.x, pNext.y - pPrev.y, pNext.z - pPrev.z);
        stripSide(_w, _d, p.x, p.y, p.z, _camPos);
        const age = life > 1e-9 ? Math.max(0, Math.min(1, (it.elapsed - p.t) / life)) : 0;
        const wk = it.n.widthKeys;
        const hw = ((wk && wk.length ? evalHermite(wk, age) : 1) * (it.n.width || 1)) * 0.5;
        sampleUnityGradient(unityGradientKeysCached(it.n.gradient), age, _rgba);
        writeStripPoint(it.geo, i, p.x, p.y, p.z, _w, hw, _rgba[0], _rgba[1], _rgba[2], _rgba[3], m > 1 ? i / (m - 1) : 0);
      }
      commitStrip(it.geo, m);
    }
  };

  const dispose = () => {
    for (const it of items) {
      try {
        it.geo.dispose();
        it.mat.dispose();
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
