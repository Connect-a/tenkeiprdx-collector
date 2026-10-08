import * as THREE from '../../../vendor/three.module.js';

export function createStaticMeshBuilder(ctx) {
  const items = [];
  const matCache = new Map();
  const add = (node, pre) => {
    const geo = node.meshPid ? ctx.geoResolver(node.meshPid) : null;
    if (!geo) return;
    const entry = pre.entry;
    let mesh;
    try {
      const animEnt = ctx.matAnimOf(node.path);
      const mk = String(node.matPid) + '|' + (animEnt ? animEnt.path : '');
      let mat = matCache.get(mk);
      if (!mat) {
        mat = ctx.makeMaterial(entry, { allowBake: true, matAnim: ctx.resolveMatAnim(animEnt, entry) });
        matCache.set(mk, mat);
      }
      mesh = new THREE.Mesh(geo, mat);
    } catch (e) {
      ctx.fail({ path: node.path, renderMode: -1, message: (e && e.message) || String(e), staticMesh: true });
      return;
    }
    mesh.frustumCulled = false;
    mesh.userData.tpStaticMesh = 1;
    mesh.renderOrder = pre.order;
    const spin = pre.spin;
    const p = spin && node.localPos ? node.localPos : node.pos || { x: 0, y: 0, z: 0 };
    const r = spin && node.localRot ? node.localRot : node.rot || { x: 0, y: 0, z: 0, w: 1 };
    mesh.position.set(p.x || 0, p.y || 0, p.z || 0);
    mesh.quaternion.set(r.x || 0, r.y || 0, r.z || 0, r.w == null ? 1 : r.w);
    const s = (spin && node.animLocalScale) || node.scale || { x: 1, y: 1, z: 1 };
    mesh.scale.set(s.x == null ? 1 : s.x, s.y == null ? 1 : s.y, s.z == null ? 1 : s.z);
    mesh.name = node.name || '';
    pre.parent.add(mesh);
    const gateKeys = pre.gateKeys;
    if (gateKeys && !ctx.activeAt(gateKeys, 0)) mesh.visible = false;
    items.push({ mesh, gateKeys });
  };
  const disposeMaterials = () => {
    for (const m of matCache.values()) {
      try {
        m.dispose();
      } catch (e) {}
    }
    matCache.clear();
  };
  return { items, add, disposeMaterials };
}

export function computeBounds(ctx) {
  const xs = [],
    ys = [],
    zs = [];
  const V = new THREE.Vector3();
  ctx.group.updateMatrixWorld(true);
  const push = (o) => {
    if (!o) return;
    o.getWorldPosition(V);
    xs.push(V.x);
    ys.push(V.y);
    zs.push(V.z);
  };
  for (const o of ctx.objects()) push(o);
  if (!xs.length)
    for (const sys of ctx.fallbackPositions()) {
      const p = sys || { x: 0, y: 0, z: 0 };
      xs.push(p.x || 0);
      ys.push(p.y || 0);
      zs.push(p.z || 0);
    }
  if (!xs.length) return null;
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  zs.sort((a, b) => a - b);
  const q = (arr, t) => arr[Math.max(0, Math.min(arr.length - 1, Math.round((arr.length - 1) * t)))];
  const cx = (q(xs, 0.1) + q(xs, 0.9)) / 2,
    cy = (q(ys, 0.1) + q(ys, 0.9)) / 2,
    cz = (q(zs, 0.1) + q(zs, 0.9)) / 2;
  const rad = Math.max(Math.abs(q(xs, 0.9) - cx), Math.abs(q(ys, 0.9) - cy), Math.abs(q(zs, 0.9) - cz));
  return { cx, cy: Math.max(cy, 0.6), cz, radius: Math.max(1.2, Math.min(6, rad + 1.2)) };
}
