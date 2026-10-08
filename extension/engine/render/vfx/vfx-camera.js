import * as THREE from '../../../vendor/three.module.js';
import { GAME_WIDTH, GAME_HEIGHT, GAME_ASPECT } from '../../../core/game-screen.js';
import { notePlayFailure } from './vfx-failures.js';

// NOTE: 暫定値 追従先 … ビューワは使用者（原点）に置く。実機がこの瞬間どのユニットを追っているかは未読（値の出典は vfx-design 15.26）。
const BATTLE_CAM = {
  pos: { x: 11, y: 10, z: -8 },
  rot: { x: 0.27253198623657227, y: -0.4030582010746002, z: 0.12708373367786407, w: 0.8643611669540405 },
  fov: 37.84928894042969,
  near: 0.1,
  far: 2000,
  dutch: 0,
  lookAt: null,
  shake: null,
  priority: 0,
};
export const battleDefaultCamera = () => BATTLE_CAM;
const REAL_VP = [2.10256, 0, 0, 0, 0, 3.73205, 0, 0, 0, 0, 1.0003, 1, 0, 0, -0.60009, 0];
// NOTE: ビューワの選択。ゲームのカメラに固定しないときの自由視点のカメラ（ゲーム由来の値ではない）。
const FREE_CAM = Object.freeze({ fov: 38, near: 0.1, far: 2000 });

function makeStageCamera(aspect) {
  const cam = new THREE.PerspectiveCamera(FREE_CAM.fov, aspect, FREE_CAM.near, FREE_CAM.far);
  const base = cam.updateProjectionMatrix.bind(cam);
  cam.updateProjectionMatrix = function () {
    base();
    cam.projectionMatrix.elements[0] *= -1;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  };
  cam.updateProjectionMatrix();
  return cam;
}
function makeRealCamera() {
  const cam = new THREE.Camera();
  cam.matrixAutoUpdate = false;
  cam.matrixWorld.identity();
  cam.matrixWorldInverse.identity();
  cam.projectionMatrix.fromArray(REAL_VP);
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  return cam;
}

const PERM = (() => {
  const p = new Uint8Array(512);
  const base = [
    151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32,
    57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244,
    102, 143, 54, 65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64, 52, 217, 226, 250, 124, 123, 5, 202, 38, 147,
    118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108,
    110, 79, 113, 224, 232, 178, 185, 112, 104, 218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84,
    204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
  ];
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  return p;
})();
const pfade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function pgrad(h, x, y) {
  switch (h & 3) {
    case 0:
      return x + y;
    case 1:
      return -x + y;
    case 2:
      return x - y;
    default:
      return -x - y;
  }
}
function perlin2(x, y) {
  const xi = Math.floor(x) & 255,
    yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x),
    yf = y - Math.floor(y);
  const u = pfade(xf),
    v = pfade(yf);
  const aa = PERM[PERM[xi] + yi],
    ab = PERM[PERM[xi] + yi + 1],
    ba = PERM[PERM[xi + 1] + yi],
    bb = PERM[PERM[xi + 1] + yi + 1];
  const x1 = pgrad(aa, xf, yf) + u * (pgrad(ba, xf - 1, yf) - pgrad(aa, xf, yf));
  const x2 = pgrad(ab, xf, yf - 1) + u * (pgrad(bb, xf - 1, yf - 1) - pgrad(ab, xf, yf - 1));
  return Math.min(1, Math.max(0, (x1 + v * (x2 - x1)) * 0.5 + 0.5));
}
const chanAt = (c, time, off) => {
  const t = time * c.f + off;
  return c.c ? Math.cos(t * 2 * Math.PI) * c.a * 0.5 : (perlin2(t, 0) - 0.5) * c.a;
};
const noiseVec = (chans, t, off, out) => {
  out.set(0, 0, 0);
  for (const ax of chans || []) out.set(out.x + chanAt(ax[0], t, off.x), out.y + chanAt(ax[1], t, off.y), out.z + chanAt(ax[2], t, off.z));
  return out;
};

const cmDamp = (initial, dampTime, dt) => {
  if (dampTime < 1e-4 || Math.abs(initial) < 1e-4) return initial;
  if (dt < 1e-4) return 0;
  return initial * (1 - Math.exp((-4.605170249938965 / dampTime) * dt));
};

const _cmD = new THREE.Vector3();
const _cmQ = new THREE.Quaternion();
const _cmUp = new THREE.Vector3(0, 1, 0);
const _cmRight = new THREE.Vector3(1, 0, 0);
function composerAim(camera, c, dt, aspect, state) {
  const aim = c.aim;
  const t = c.lookAt;
  _cmD.set(t.x - camera.position.x, t.y - camera.position.y, t.z - camera.position.z);
  if (_cmD.lengthSq() < 1e-12) return false;
  _cmD.normalize();
  const tanH = Math.tan(((c.fov || camera.fov) * Math.PI) / 360);
  const lx = (2 * aim.screenX - 1) * tanH * aspect,
    ly = (2 * aim.screenY - 1) * tanH;
  const ll = Math.hypot(lx, ly, 1);
  const dx = lx / ll,
    dy = ly / ll,
    dz = -1 / ll;
  const R = Math.hypot(_cmD.x, _cmD.z);
  if (R < 1e-9 || Math.abs(dx) > R) return false;
  const phi = Math.atan2(_cmD.z, _cmD.x);
  const ac = Math.acos(Math.max(-1, Math.min(1, dx / R)));
  let yaw = ac - phi;
  if (_cmD.x * Math.sin(yaw) + _cmD.z * Math.cos(yaw) > 0) yaw = -ac - phi;
  const vz = _cmD.x * Math.sin(yaw) + _cmD.z * Math.cos(yaw);
  let pitch = Math.atan2(vz, _cmD.y) - Math.atan2(dz, dy);
  while (yaw > Math.PI) yaw -= 2 * Math.PI;
  while (yaw < -Math.PI) yaw += 2 * Math.PI;
  while (pitch > Math.PI) pitch -= 2 * Math.PI;
  while (pitch < -Math.PI) pitch += 2 * Math.PI;
  const st = state.get(c.path);
  if (st && dt > 1e-6) {
    let dyaw = st.yaw - yaw;
    while (dyaw > Math.PI) dyaw -= 2 * Math.PI;
    while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
    yaw = st.yaw - cmDamp(dyaw, aim.hDamp, dt);
    pitch = st.pitch - cmDamp(st.pitch - pitch, aim.vDamp, dt);
  }
  state.set(c.path, { yaw, pitch });
  camera.quaternion.setFromAxisAngle(_cmUp, yaw);
  _cmQ.setFromAxisAngle(_cmRight, pitch);
  camera.quaternion.multiply(_cmQ);
  return true;
}

const LETTERBOX = ['width', 'height', 'left', 'top', 'right', 'bottom'];

export function createVfxCameraRig(canvas, opt0) {
  const opt = opt0 || {};
  const stage = !!opt.stage;
  let camera = null,
    renderer = null,
    pivot = null,
    onUserCam = null;
  let curW = GAME_WIDTH,
    curH = GAME_HEIGHT;
  let gameCam = !!opt.gameCamera,
    gcApplied = false,
    userAdjusted = false;
  let sYaw = 0.5,
    sPitch = 0.28,
    sDist = 7,
    sTarget = null;
  let oYaw = 0,
    oPitch = 0,
    oZoom = Number(opt.zoom) > 0 ? Number(opt.zoom) : 1,
    oPanX = 0,
    oPanY = 0;
  const cmState = new Map();
  let shakeT = 0,
    shakeNoiseT = 0,
    shakeLastT = 0;
  const _gcQ = new THREE.Quaternion();
  const _gcFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  const _shakeP = new THREE.Vector3();
  const _shakeR = new THREE.Vector3();
  const _shakeQ = new THREE.Quaternion();
  const _shakeE = new THREE.Euler();

  const fit = () => {
    if (!canvas) return;
    const st = canvas.style;
    if (!gameCam) {
      for (const k of LETTERBOX) st.removeProperty(k);
      return;
    }
    const host = canvas.parentElement;
    const bw = (host && host.clientWidth) || canvas.clientWidth || GAME_WIDTH;
    const bh = (host && host.clientHeight) || canvas.clientHeight || GAME_HEIGHT;
    const w = Math.max(2, Math.min(bw, bh * GAME_ASPECT));
    const h = Math.max(2, w / GAME_ASPECT);
    st.setProperty('width', Math.round(w) + 'px', 'important');
    st.setProperty('height', Math.round(h) + 'px', 'important');
    st.setProperty('left', Math.round((bw - w) / 2) + 'px', 'important');
    st.setProperty('top', Math.round((bh - h) / 2) + 'px', 'important');
    st.setProperty('right', 'auto', 'important');
    st.setProperty('bottom', 'auto', 'important');
  };
  const resize = () => {
    if (!renderer || !canvas) return false;
    const w = canvas.clientWidth || GAME_WIDTH,
      h = canvas.clientHeight || GAME_HEIGHT;
    if (w === curW && h === curH) return false;
    curW = w;
    curH = h;
    renderer.setSize(w, h, false);
    return true;
  };
  const sizeTo = (w, h) => {
    curW = w;
    curH = h;
    if (renderer) renderer.setSize(w, h, false);
  };
  const applyOrbit = () => {
    if (pivot) {
      pivot.rotation.set(oPitch, oYaw, 0);
      pivot.scale.setScalar(oZoom);
    }
  };
  const applyPan = () => {
    if (canvas) canvas.style.transform = `translate(${oPanX}px, ${oPanY}px)`;
  };
  const stageAspect = () => {
    if (!camera || !camera.isPerspectiveCamera) return;
    camera.aspect = (curW || 1) / (curH || 1);
    camera.updateProjectionMatrix();
  };
  const applyGame = (c, keepLast) => {
    if (!gameCam || !camera) return false;
    if (!c) return gcApplied && !!keepLast;
    gcApplied = true;
    const shakeDt = Math.max(0, shakeT - shakeLastT);
    shakeLastT = shakeT;
    if (c.shake) shakeNoiseT += shakeDt * (c.shake.freq || 0);
    camera.position.set(c.pos.x || 0, c.pos.y || 0, c.pos.z || 0);
    _gcQ.set(c.rot.x || 0, c.rot.y || 0, c.rot.z || 0, c.rot.w == null ? 1 : c.rot.w);
    camera.quaternion.copy(_gcQ).multiply(_gcFlip);
    if (c.lookAt && !(c.aim && composerAim(camera, c, shakeDt, GAME_ASPECT, cmState))) camera.lookAt(c.lookAt.x || 0, c.lookAt.y || 0, c.lookAt.z || 0);
    if (Math.abs(c.dutch) > 1e-3) camera.rotateZ((-c.dutch * Math.PI) / 180);
    if (c.shake) {
      const off = c.shake.offsets || { x: 0, y: 0, z: 0 };
      const nt = shakeNoiseT;
      if (c.shake.pos && c.shake.pos.length) {
        noiseVec(c.shake.pos, nt, off, _shakeP).multiplyScalar(c.shake.amp);
        _shakeP.applyQuaternion(camera.quaternion);
        camera.position.add(_shakeP);
      }
      if (c.shake.rot && c.shake.rot.length) {
        noiseVec(c.shake.rot, nt, off, _shakeR).multiplyScalar((c.shake.amp * Math.PI) / 180);
        _shakeE.set(_shakeR.x, _shakeR.y, _shakeR.z, 'ZXY');
        camera.quaternion.multiply(_shakeQ.setFromEuler(_shakeE));
      }
    }
    if (camera.isPerspectiveCamera && (camera.fov !== c.fov || camera.near !== c.near || camera.far !== c.far || camera.aspect !== GAME_ASPECT)) {
      camera.fov = c.fov;
      camera.near = c.near;
      camera.far = c.far;
      camera.aspect = GAME_ASPECT;
      camera.updateProjectionMatrix();
    }
    return true;
  };
  const place = (c, keepLast) => {
    if (gameCam && applyGame(c, keepLast)) return;
    if (!stage || !camera || !sTarget) return;
    const cp = Math.cos(sPitch),
      sp = Math.sin(sPitch);
    camera.position.set(sTarget.x + sDist * cp * Math.sin(sYaw), sTarget.y + sDist * sp, sTarget.z + sDist * cp * Math.cos(sYaw));
    camera.lookAt(sTarget);
  };
  const adoptFromCurrent = () => {
    if (!camera) return;
    const d = Math.max(0.5, sDist || 8);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    if (!sTarget) sTarget = new THREE.Vector3();
    sTarget.copy(camera.position).addScaledVector(dir, d);
    sDist = d;
    const ox = camera.position.x - sTarget.x,
      oy = camera.position.y - sTarget.y,
      oz = camera.position.z - sTarget.z;
    sYaw = Math.atan2(ox, oz);
    sPitch = Math.max(-1.5, Math.min(1.5, Math.asin(oy / Math.max(1e-3, Math.hypot(ox, oy, oz)))));
  };
  const breakGame = () => {
    if (!gameCam) return;
    adoptFromCurrent();
    gameCam = false;
    fit();
    resize();
    stageAspect();
    userAdjusted = true;
    if (onUserCam)
      try {
        onUserCam();
      } catch (e) {
        notePlayFailure('onUserCamera', e);
      }
  };
  const setGameCamera = (on, c, keepLast) => {
    gameCam = !!on;
    fit();
    resize();
    if (camera && camera.isPerspectiveCamera) {
      if (gameCam) {
        camera.aspect = GAME_ASPECT;
      } else {
        camera.aspect = (curW || 1) / (curH || 1);
        camera.fov = FREE_CAM.fov;
        camera.near = FREE_CAM.near;
        camera.far = FREE_CAM.far;
      }
      camera.updateProjectionMatrix();
    }
    place(c, keepLast);
  };

  return {
    get camera() {
      return camera;
    },
    get width() {
      return curW;
    },
    get height() {
      return curH;
    },
    get gameCam() {
      return gameCam;
    },
    get userAdjusted() {
      return userAdjusted;
    },
    get target() {
      return sTarget;
    },
    get dist() {
      return sDist;
    },
    set dist(v) {
      sDist = v;
    },
    get zoom() {
      return oZoom;
    },
    attach(r) {
      renderer = r;
    },
    setPivot(p) {
      pivot = p;
    },
    setOnUserCam(fn) {
      onUserCam = fn;
    },
    makeCamera() {
      camera = stage ? makeStageCamera((curW || 1) / (curH || 1) || 1.6) : makeRealCamera();
      if (stage && !sTarget) sTarget = new THREE.Vector3(0, 1, 0);
      return camera;
    },
    clearCamera() {
      camera = null;
    },
    ensureTarget(x, y, z) {
      if (!sTarget) sTarget = new THREE.Vector3(x || 0, y || 0, z || 0);
      return sTarget;
    },
    frame(bounds, fovDeg) {
      if (!sTarget) sTarget = new THREE.Vector3();
      sTarget.set(bounds.cx, bounds.cy, bounds.cz);
      const fovR = ((fovDeg || FREE_CAM.fov) * Math.PI) / 180;
      sDist = Math.max(4, Math.min(22, (bounds.radius * 1.5) / Math.tan(fovR / 2)));
    },
    resetApplied() {
      gcApplied = false;
    },
    advanceShake(dt) {
      shakeT += dt;
    },
    fit,
    resize,
    sizeTo,
    stageAspect,
    applyOrbit,
    place,
    breakGame,
    setGameCamera,
    // NOTE: ビューワの値。ここから下の操作量（ドラッグ・ホイール・距離と角度の範囲・自動フレーミング）はゲーム由来でなく操作感で決めたもの＝確定作業の対象外。
    dragStage(dx, dy, panMode) {
      userAdjusted = true;
      if (panMode) {
        const k = sDist * 0.0018;
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
        sTarget.addScaledVector(right, -dx * k);
        sTarget.addScaledVector(up, dy * k);
      } else {
        sYaw -= dx * 0.01;
        sPitch = Math.max(-1.5, Math.min(1.5, sPitch + dy * 0.01));
      }
    },
    dragOrbit(dx, dy) {
      oYaw += dx * 0.01;
      oPitch = Math.max(-1.4, Math.min(1.4, oPitch + dy * 0.01));
      applyOrbit();
    },
    dragPan(dx, dy) {
      oPanX += dx;
      oPanY += dy;
      applyPan();
    },
    wheelStage(deltaY) {
      userAdjusted = true;
      sDist = Math.max(0.5, Math.min(60, sDist * (deltaY < 0 ? 1 / 1.12 : 1.12)));
    },
    wheelOrbit(deltaY) {
      oZoom = Math.max(0.3, Math.min(8, oZoom * (deltaY < 0 ? 1.12 : 1 / 1.12)));
      applyOrbit();
    },
  };
}
