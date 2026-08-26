import * as THREE from '../../vendor/three.module.js';

export const SHADOW_KINDS = [
  ['none', 'なし'],
  ['blob', '丸影'],
  ['cast', '実影'],
];

export const SHADOW_OPACITY = 0.62;
const SIZE = 1.65;
const FALLOFF = [
  [0.0, 1.0],
  [0.5, 1.0],
  [0.55, 0.991],
  [0.6, 0.95],
  [0.65, 0.879],
  [0.7, 0.75],
  [0.75, 0.577],
  [0.8, 0.424],
  [0.85, 0.24],
  [0.9, 0.103],
  [0.95, 0.037],
  [1.0, 0.0],
];

let tex = null;

function texture() {
  if (tex) return tex;
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  for (const [stop, a] of FALLOFF) grad.addColorStop(stop, `rgba(0,0,0,${a})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace || 'srgb';
  return tex;
}

export function createShadow() {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: texture(),
    color: 0x000000,
    transparent: true,
    opacity: SHADOW_OPACITY,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  return mesh;
}

export function disposeShadow(mesh) {
  if (!mesh) return;
  if (mesh.parent) mesh.parent.remove(mesh);
  mesh.geometry.dispose();
  mesh.material.dispose();
}

export function placeShadow(mesh, o) {
  if (o.kind !== 'blob') {
    mesh.visible = false;
    return;
  }
  const s = SIZE * (o.scale || 1);
  mesh.rotation.y = o.rotY || 0;
  mesh.position.set(o.x, o.groundY + 0.01, o.z);
  mesh.scale.set(s, 1, s);
  mesh.visible = true;
}
