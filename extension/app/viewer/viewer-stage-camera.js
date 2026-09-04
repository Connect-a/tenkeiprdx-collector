import * as THREE from '../../vendor/three.module.js';

export function createCameraRig(camera, renderer, wrap, deps) {
  const { anchor, state, core, fieldGroup, grid, fog } = deps;
  const CAM = () => state.scene.camera;
  const focus = new THREE.Vector3(0, 1, 0);
  let framed = false;
  let authored = false;
  let camLocked = false;
  const applyCam = () => {
    const cam = CAM();
    focus.set(cam.tx, cam.ty, cam.tz);
    const d = Math.max(0.05, cam.dist);
    const tx = focus.x + cam.panX;
    const ty = focus.y + cam.panY;
    const tz = focus.z;
    camera.position.set(tx + Math.cos(cam.pitch) * Math.sin(cam.yaw) * d, ty + Math.sin(cam.pitch) * d, tz + Math.cos(cam.pitch) * Math.cos(cam.yaw) * d);
    camera.lookAt(tx, ty, tz);
    const near = Math.max(0.01, Math.min(1, d / 60));
    if (Math.abs(camera.near - near) > 1e-4) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }
    for (const u of fog()) u.uTpFogControl.value[1] = camera.near;
  };

  function setAnchor(group, origin) {
    anchor.set(0, 0, 0);
    if (!group) return;
    if (origin) {
      anchor.set(origin.x, origin.y, origin.z);
      return;
    }
    const b = new THREE.Box3().setFromObject(group);
    if (isFinite(b.min.y) && isFinite(b.max.y)) anchor.set((b.min.x + b.max.x) / 2, 0, (b.min.z + b.max.z) / 2);
  }
  function shiftCamera(prev) {
    if (anchor.distanceToSquared(prev) < 1e-9) return;
    const cam = CAM();
    cam.tx += anchor.x - prev.x;
    cam.ty += anchor.y - prev.y;
    cam.tz += anchor.z - prev.z;
    applyCam();
  }

  const FRAME_REACH_LIMIT = 20;
  const BODY_MESH = /^body(_model)?$/i;
  const charBox = (root) => {
    const parts = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      const box = new THREE.Box3().expandByObject(o);
      if (!box.isEmpty()) parts.push({ name: o.name || '', box });
    });
    const body = parts.find((p) => BODY_MESH.test(p.name));
    const out = new THREE.Box3();
    if (!body) {
      for (const p of parts) out.union(p.box);
      return out;
    }
    const mid = body.box.getCenter(new THREE.Vector3());
    const size = body.box.getSize(new THREE.Vector3());
    const limit = Math.max(size.x, size.y, size.z, 1e-3) * FRAME_REACH_LIMIT;
    for (const p of parts) {
      const far = Math.max(p.box.max.distanceTo(mid), p.box.min.distanceTo(mid));
      if (far <= limit) out.union(p.box);
    }
    return out;
  };

  function frame(force) {
    const cam = CAM();
    if (!force && (framed || camLocked)) return;
    const b = new THREE.Box3();
    let any = false;
    for (const inst of core.items.values()) {
      if (!inst || !inst.ok) continue;
      b.union(charBox(inst.root));
      any = true;
    }
    let r;
    if (any) {
      b.getCenter(focus);
      const size = b.getSize(new THREE.Vector3());
      r = Math.max(size.x, size.y, size.z) || 1;
    } else if (fieldGroup() || grid()) {
      focus.copy(anchor);
      focus.y += 1;
      r = 3;
    } else return;
    cam.tx = focus.x;
    cam.ty = focus.y;
    cam.tz = focus.z;
    cam.dist = r * 2.2;
    framed = any;
    camera.near = Math.max(0.01, r / 100);
    camera.updateProjectionMatrix();
    applyCam();
  }

  let lastW = 0,
    lastH = 0;
  function resize() {
    const w = wrap.clientWidth,
      h = wrap.clientHeight;
    if (w < 2 || h < 2) return;
    if (w === lastW && h === lastH) return;
    lastW = w;
    lastH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  return {
    focus,
    apply: applyCam,
    setAnchor,
    shift: shiftCamera,
    frame,
    resize,
    locked: () => camLocked,
    moved() {
      camLocked = true;
      applyCam();
    },
    markAuthored() {
      authored = true;
      camLocked = true;
      framed = true;
    },
    frameOnAdd(liveCount) {
      frame(liveCount === 1 && !authored);
    },
    reset() {
      const cam = CAM();
      cam.yaw = 0.5;
      cam.pitch = 0.28;
      cam.panX = 0;
      cam.panY = 0;
      camLocked = false;
      frame(true);
    },
  };
}
