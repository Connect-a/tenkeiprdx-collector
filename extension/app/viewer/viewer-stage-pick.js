import * as THREE from '../../vendor/three.module.js';
import { createGizmo } from './viewer-gizmo.js';

const PITCH_LIMIT = 1.3;

export function createPicker(scene, renderer, camera, deps) {
  const { state, core, place, cam: CAM, camMoved, onGizmo } = deps;
  const gizmo = createGizmo(scene);
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let selected = null;
  function pickRay(e) {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(pointer, camera);
    ray.far = Infinity;
    return ray;
  }

  function charUnder(e) {
    const hits = pickRay(e).intersectObjects(
      [...core.items.values()].filter((i) => i && i.ok).map((i) => i.root),
      true,
    );
    if (!hits.length) return null;
    for (const c of state.scene.chars) {
      const inst = core.live(c.id);
      if (inst && (hits[0].object === inst.root || isDescendant(hits[0].object, inst.root))) return c.id;
    }
    return null;
  }

  function isDescendant(node, root) {
    for (let p = node; p; p = p.parent) if (p === root) return true;
    return false;
  }

  function selectChar(id) {
    selected = id ? String(id) : null;
    const inst = selected ? core.live(selected) : null;
    if (!inst) {
      selected = null;
      gizmo.detach();
      return;
    }
    gizmo.attach(inst);
    gizmo.resize(camera);
  }

  function bindPointer() {
    const cv = renderer.domElement;
    let drag = false;
    let pan = false;
    let gizmoDrag = false;
    let moved = 0;
    let lx = 0;
    let ly = 0;
    cv.style.touchAction = 'none';
    cv.style.cursor = 'grab';
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      lx = e.clientX;
      ly = e.clientY;
      moved = 0;
      cv.setPointerCapture(e.pointerId);
      if (e.button === 2 || e.button === 1) {
        pan = true;
        return;
      }
      if (selected) {
        const c = state.get(selected);
        const inst = core.live(selected);
        if (c && inst && gizmo.begin(pickRay(e), c, inst, camera)) {
          gizmoDrag = true;
          return;
        }
      }
      drag = true;
    });
    cv.addEventListener('pointerup', (e) => {
      if (gizmoDrag) gizmo.end();
      else if (drag && moved < 5 && e.button === 0) selectChar(charUnder(e));
      drag = pan = gizmoDrag = false;
      try {
        cv.releasePointerCapture(e.pointerId);
      } catch (x) {}
    });
    cv.addEventListener('pointermove', (e) => {
      const dx = e.clientX - lx,
        dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (gizmoDrag) {
        const patch = gizmo.move(pickRay(e));
        if (patch && selected) {
          state.update(selected, patch);
          const inst = core.live(selected);
          if (inst) place(state.get(selected), inst);
          gizmo.attach(inst);
          gizmo.resize(camera);
          if (onGizmo) onGizmo(selected);
        }
        return;
      }
      if (!drag && !pan) {
        gizmo.hover(pickRay(e));
        return;
      }
      const cam = CAM();
      if (drag) {
        cam.yaw += dx * 0.006;
        cam.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, cam.pitch + dy * 0.006));
      } else if (pan) {
        cam.panX += dx * cam.dist * 0.0016;
        cam.panY += dy * cam.dist * 0.0016;
      } else return;
      camMoved();
    });
    cv.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const cam = CAM();
        cam.dist = Math.max(0.05, Math.min(4000, cam.dist * (1 + Math.sign(e.deltaY) * 0.1)));
        camMoved();
      },
      { passive: false },
    );
  }
  return {
    bind: bindPointer,
    selected: () => selected,
    select: selectChar,
    syncFrame() {
      if (selected) {
        const sel = core.live(selected);
        if (sel) gizmo.sync(sel);
        else selectChar(null);
      }
      gizmo.resize(camera);
    },
    dispose() {
      gizmo.dispose();
    },
  };
}
