import * as THREE from '../../../vendor/three.module.js';

const _VX = new THREE.Vector3(1, 0, 0);
const _VY = new THREE.Vector3(0, 1, 0);
const _VZ = new THREE.Vector3(0, 0, 1);
const _o = new THREE.Vector3();
const _u = new THREE.Vector3();
const _qx = new THREE.Quaternion();
const _qy = new THREE.Quaternion();
const _qz = new THREE.Quaternion();

export function orbitalVelocity(c, ax, ay, az, radialStep, dt) {
  _o.copy(c);
  if (ax || ay || az) {
    c.applyQuaternion(_qz.setFromAxisAngle(_VZ, az))
      .applyQuaternion(_qx.setFromAxisAngle(_VX, ax))
      .applyQuaternion(_qy.setFromAxisAngle(_VY, ay));
  }
  if (radialStep !== 0) {
    const l = c.length();
    if (l > 1e-6) c.addScaledVector(_u.copy(c).multiplyScalar(1 / l), radialStep);
  }
  return c.sub(_o).multiplyScalar(dt > 1e-6 ? 1 / dt : 0);
}
