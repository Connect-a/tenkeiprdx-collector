import * as THREE from '../../../vendor/three.module.js';

export const STRIP_MAX_POINTS = 256;

export function createStripMesh(mat, renderOrder, tag) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(STRIP_MAX_POINTS * 2 * 3);
  const col = new Float32Array(STRIP_MAX_POINTS * 2 * 4);
  const uv = new Float32Array(STRIP_MAX_POINTS * 2 * 2);
  const idx = new Uint16Array((STRIP_MAX_POINTS - 1) * 6);
  for (let i = 0; i < STRIP_MAX_POINTS - 1; i++) {
    const a = i * 2;
    idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.userData[tag] = 1;
  mesh.renderOrder = renderOrder;
  return { mesh, geo };
}

export function readCameraPosition(cam, out) {
  if (cam && cam.getWorldPosition) cam.getWorldPosition(out);
  else if (cam && cam.pos) out.set(cam.pos.x || 0, cam.pos.y || 0, cam.pos.z || 0);
  else if (cam && typeof cam.x === 'number') out.set(cam.x, cam.y, cam.z);
}

const _v = new THREE.Vector3();
export function stripSide(out, dir, px, py, pz, camPos) {
  if (dir.lengthSq() < 1e-12) dir.set(0, 0, 1);
  dir.normalize();
  _v.set(camPos.x - px, camPos.y - py, camPos.z - pz);
  if (_v.lengthSq() < 1e-12) _v.set(0, 0, 1);
  out.crossVectors(dir, _v.normalize());
  if (out.lengthSq() < 1e-12) out.set(1, 0, 0);
  out.normalize();
  return out;
}

export function writeStripPoint(geo, i, px, py, pz, side, hw, r, g, b, a, u) {
  const pa = geo.attributes.position.array,
    ca = geo.attributes.color.array,
    ua = geo.attributes.uv.array;
  const o3 = i * 6,
    o4 = i * 8,
    o2 = i * 4;
  pa[o3] = px + side.x * hw;
  pa[o3 + 1] = py + side.y * hw;
  pa[o3 + 2] = pz + side.z * hw;
  pa[o3 + 3] = px - side.x * hw;
  pa[o3 + 4] = py - side.y * hw;
  pa[o3 + 5] = pz - side.z * hw;
  for (let k = 0; k < 2; k++) {
    ca[o4 + k * 4] = r;
    ca[o4 + k * 4 + 1] = g;
    ca[o4 + k * 4 + 2] = b;
    ca[o4 + k * 4 + 3] = a;
  }
  ua[o2] = u;
  ua[o2 + 1] = 0;
  ua[o2 + 2] = u;
  ua[o2 + 3] = 1;
}

export function commitStrip(geo, count) {
  geo.attributes.position.needsUpdate = true;
  geo.attributes.color.needsUpdate = true;
  geo.attributes.uv.needsUpdate = true;
  geo.setDrawRange(0, (count - 1) * 6);
}
