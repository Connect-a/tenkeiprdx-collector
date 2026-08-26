import * as THREE from '../../vendor/three.module.js';

const COLORS = { x: 0xff6070, y: 0x63d471, z: 0x5aa9ff, rotX: 0xff9aa4, rotY: 0xffc93c, rotZ: 0x9ecbff, scale: 0xf2f4f8 };
const RING_AXIS = { rotX: [1, 0, 0], rotY: [0, 1, 0], rotZ: [0, 0, 1] };
const RING_BASIS = {
  rotX: [
    [0, 0, 1],
    [0, 1, 0],
  ],
  rotY: [
    [0, 0, 1],
    [1, 0, 0],
  ],
  rotZ: [
    [1, 0, 0],
    [0, 1, 0],
  ],
};
const PICK = 0xffe066;
const SCREEN_SIZE = 0.16;

function mat(color) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
}

function arrow(axis, dir) {
  const g = new THREE.Group();
  const m = mat(COLORS[axis]);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.7, 8), m);
  shaft.position.y = 0.35;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 10), m);
  head.position.y = 0.8;
  const grab = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1, 6), m);
  grab.position.y = 0.5;
  grab.visible = false;
  g.add(shaft, head, grab);
  for (const o of g.children) o.userData.handle = axis;
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  return g;
}

function ringAngle(handle, p, origin) {
  const b = RING_BASIS[handle];
  if (!b) return 0;
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  const dz = p.z - origin.z;
  const u = b[0][0] * dx + b[0][1] * dy + b[0][2] * dz;
  const v = b[1][0] * dx + b[1][1] * dy + b[1][2] * dz;
  return Math.atan2(v, u);
}

export function createGizmo(scene) {
  const root = new THREE.Group();
  root.renderOrder = 999;
  root.visible = false;

  const axes = {
    x: arrow('x', new THREE.Vector3(1, 0, 0)),
    y: arrow('y', new THREE.Vector3(0, 1, 0)),
    z: arrow('z', new THREE.Vector3(0, 0, 1)),
  };
  for (const a of Object.values(axes)) root.add(a);

  for (const key of ['rotY', 'rotX', 'rotZ']) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(key === 'rotY' ? 0.85 : key === 'rotX' ? 0.72 : 0.79, 0.03, 6, 40), mat(COLORS[key]));
    if (key === 'rotY') r.rotation.x = Math.PI / 2;
    else if (key === 'rotX') r.rotation.y = Math.PI / 2;
    r.userData.handle = key;
    root.add(r);
  }

  const knob = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), mat(COLORS.scale));
  knob.position.set(0, 1.05, 0);
  knob.userData.handle = 'scale';
  root.add(knob);

  scene.add(root);

  const pickables = [];
  root.traverse((o) => {
    if (o.isMesh && o.userData.handle) pickables.push(o);
  });

  const plane = new THREE.Plane();
  const hitPoint = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const axisDir = new THREE.Vector3();
  let drag = null;

  const setColor = (name) => {
    for (const o of pickables) {
      const base = COLORS[o.userData.handle];
      o.material.color.setHex(o.userData.handle === name ? PICK : base);
    }
  };

  return {
    root,
    get active() {
      return !!drag;
    },
    attach(inst) {
      root.visible = true;
      inst.root.updateMatrixWorld(true);
      if (inst.center) root.position.copy(inst.center).applyMatrix4(inst.root.matrixWorld);
      else root.position.copy(inst.root.position);
    },
    detach() {
      root.visible = false;
      drag = null;
      setColor(null);
    },
    resize(camera) {
      if (!root.visible) return;
      const d = camera.position.distanceTo(root.position);
      root.scale.setScalar(Math.max(0.001, d * SCREEN_SIZE));
    },
    hover(raycaster) {
      if (!root.visible || drag) return null;
      const hit = raycaster.intersectObjects(pickables, false)[0];
      const name = hit ? hit.object.userData.handle : null;
      setColor(name);
      return name;
    },
    begin(raycaster, char, inst, camera) {
      if (!root.visible) return null;
      const hit = raycaster.intersectObjects(pickables, false)[0];
      if (!hit) return null;
      const handle = hit.object.userData.handle;
      origin.copy(root.position);
      const view = camera.getWorldDirection(new THREE.Vector3());
      const ringAxis = RING_AXIS[handle];
      if (ringAxis) plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(ringAxis[0], ringAxis[1], ringAxis[2]), origin);
      else if (handle === 'scale') plane.setFromNormalAndCoplanarPoint(view.clone().negate().normalize(), origin);
      else if (handle === 'y') plane.setFromNormalAndCoplanarPoint(view.clone().setY(0).normalize(), origin);
      else {
        axisDir.set(handle === 'x' ? 1 : 0, 0, handle === 'z' ? 1 : 0);
        const n = axisDir.clone().cross(view).cross(axisDir).normalize();
        plane.setFromNormalAndCoplanarPoint(n, origin);
      }
      if (!raycaster.ray.intersectPlane(plane, hitPoint)) return null;
      drag = {
        handle,
        start: hitPoint.clone(),
        char: { x: char.x || 0, y: char.y || 0, z: char.z || 0, rotX: char.rotX || 0, rotY: char.rotY || 0, rotZ: char.rotZ || 0, scale: char.scale || 1 },
        angle: ringAngle(handle, hitPoint, origin),
        dist: hitPoint.distanceTo(origin) || 1,
      };
      setColor(handle);
      return handle;
    },
    move(raycaster) {
      if (!drag) return null;
      if (!raycaster.ray.intersectPlane(plane, hitPoint)) return null;
      const d = hitPoint.clone().sub(drag.start);
      if (drag.handle === 'x') return { x: drag.char.x - d.x };
      if (drag.handle === 'y') return { y: drag.char.y + d.y };
      if (drag.handle === 'z') return { z: drag.char.z + d.z };
      if (RING_AXIS[drag.handle]) {
        const a = ringAngle(drag.handle, hitPoint, origin);
        const key = drag.handle === 'rotX' ? 'rotX' : drag.handle === 'rotZ' ? 'rotZ' : 'rotY';
        return { [key]: drag.char[key] + (a - drag.angle) };
      }
      const now = hitPoint.distanceTo(origin);
      if (!(now > 1e-6) || !(drag.dist > 1e-6)) return null;
      return { scale: Math.max(0.05, Math.min(8, drag.char.scale * (now / drag.dist))) };
    },
    end() {
      drag = null;
      setColor(null);
    },
    dispose() {
      scene.remove(root);
      root.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          o.material.dispose();
        }
      });
    },
  };
}
