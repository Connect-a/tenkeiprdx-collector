import * as THREE from '../../vendor/three.module.js';
import { loadModel3d } from '../../engine/render/lazy.js';
import { loadModelFor } from './viewer-source.js';
import { guardRenderer } from '../../engine/render/gl-manager.js';
import { loadBattleField } from './viewer-battlefield.js';
import { updateFieldUniforms, noteShaderError } from '../../engine/render/field-shader.js';
import { createStageCore } from './viewer-stage-core.js';
import { createShadow, disposeShadow, placeShadow, SHADOW_OPACITY, SHADOW_KINDS } from './viewer-shadow.js';
import { createGizmo } from './viewer-gizmo.js';
import { el } from '../../core/dom.js';

const PITCH_LIMIT = 1.3;
const OPAQUE_RT_CAP = 1600;
const idleClip = (names) => (names || []).find((n) => /^idle$/i.test(n)) || (names || []).find((n) => /idle/i.test(n)) || (names || [])[0] || '';
const SLIDERS = [];

export function createStage(hostEl, deps) {
  deps = deps || {};
  const core = createStageCore(hostEl, deps);
  const { state } = core;
  const wrap = el('div', 'vw-canvas');
  hostEl.appendChild(wrap);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.05, 5000);
  const _updateProj = camera.updateProjectionMatrix.bind(camera);
  camera.updateProjectionMatrix = function () {
    _updateProj();
    camera.projectionMatrix.elements[0] *= -1;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  };
  camera.updateProjectionMatrix();
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, logarithmicDepthBuffer: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace || 'srgb';
  wrap.appendChild(renderer.domElement);

  const light = new THREE.DirectionalLight(0xffffff, 0.9);
  light.position.set(0.4, 1, 0.8);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));

  const shadowLight = new THREE.DirectionalLight(0xffffff, 0);
  shadowLight.shadow.mapSize.set(2048, 2048);
  shadowLight.shadow.bias = -0.0006;
  const sc = shadowLight.shadow.camera;
  sc.left = -8;
  sc.right = 8;
  sc.top = 8;
  sc.bottom = -8;
  sc.near = 0.5;
  sc.far = 40;
  sc.updateProjectionMatrix();
  scene.add(shadowLight);
  scene.add(shadowLight.target);

  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: SHADOW_OPACITY, transparent: true, side: THREE.DoubleSide }));
  catcher.receiveShadow = true;
  catcher.visible = false;
  scene.add(catcher);

  let fieldGroup = null;
  let grid = null;
  let guard = null;
  let fieldMats = [];
  let sceneRT = null;
  let clock = 0;
  let m3d = null;
  const anchor = new THREE.Vector3(0, 0, 0);
  const focus = new THREE.Vector3(0, 1, 0);
  const ray = new THREE.Raycaster();
  const rayFrom = new THREE.Vector3();
  const pivot = new THREE.Vector3();
  const spun = new THREE.Vector3();
  const DOWN = new THREE.Vector3(0, -1, 0);
  let selected = null;
  const pointer = new THREE.Vector2();
  const gizmo = createGizmo(scene);
  let framed = false;
  let camLocked = false;
  let authored = false;
  const CAM = () => state.scene.camera;

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

  function frame(force) {
    const cam = CAM();
    if (!force && (framed || camLocked)) return;
    const b = new THREE.Box3();
    let any = false;
    for (const inst of core.items.values()) {
      if (!inst || !inst.ok) continue;
      b.expandByObject(inst.root);
      any = true;
    }
    let r;
    if (any) {
      b.getCenter(focus);
      const size = b.getSize(new THREE.Vector3());
      r = Math.max(size.x, size.y, size.z) || 1;
    } else if (fieldGroup || grid) {
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

  function resize() {
    const w = wrap.clientWidth,
      h = wrap.clientHeight;
    if (w < 2 || h < 2) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function groundAt(x, y, z) {
    if (!fieldGroup) return anchor.y;
    rayFrom.set(x, y + 6, z);
    ray.set(rayFrom, DOWN);
    ray.far = 60;
    const hit = ray.intersectObject(fieldGroup, true);
    for (const h of hit) if (h.object.visible && h.point.y <= y + 0.001) return h.point.y;
    return anchor.y;
  }

  function applyShadowMode() {
    let any = false;
    for (const c of state.scene.chars) {
      const inst = core.live(c.id);
      if (!inst) continue;
      const cast = c.shadow === 'cast';
      if (cast) any = true;
      inst.root.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = cast;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!m) continue;
          m.shadowSide = THREE.DoubleSide;
        }
      });
    }
    if (renderer.shadowMap.enabled !== any) {
      renderer.shadowMap.enabled = any;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      scene.traverse((o) => {
        if (!o.material) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
      });
    }
    shadowLight.castShadow = any;
    catcher.visible = any;
    catcher.position.set(anchor.x, anchor.y + 0.005, anchor.z);
    if (!any) return;
    const d = new THREE.Vector3(0.4, 1, 0.8);
    shadowLight.position.copy(anchor).addScaledVector(d.normalize(), 14);
    shadowLight.target.position.copy(anchor);
    shadowLight.target.updateMatrixWorld();
  }

  function place(c, inst) {
    inst.root.position.set(anchor.x - (c.x || 0), anchor.y + (c.y || 0), anchor.z + (c.z || 0));
    inst.root.rotation.set(c.rotX || 0, (inst.defaultRotY || 0) + (c.rotY || 0), c.rotZ || 0);
    if (inst.center) {
      const s0 = c.scale || 1;
      pivot.copy(inst.center).multiplyScalar(s0);
      spun.copy(pivot).applyEuler(inst.root.rotation);
      inst.root.position.add(pivot).sub(spun);
    }
    const s = c.scale || 1;
    inst.root.scale.set(s, s, s);
    if (!inst.shadow) return;
    const p = inst.root.position;
    placeShadow(inst.shadow, { kind: c.shadow, x: p.x, groundY: groundAt(p.x, p.y, p.z), z: p.z, scale: s, rotY: inst.root.rotation.y });
  }

  function placeAll() {
    for (const c of state.scene.chars) {
      const inst = core.live(c.id);
      if (inst) place(c, inst);
    }
  }

  function clearField() {
    fieldMats = [];
    if (fieldGroup) {
      scene.remove(fieldGroup);
      if (fieldGroup.__dispose) fieldGroup.__dispose();
      fieldGroup = null;
    }
    if (grid) {
      scene.remove(grid);
      grid.geometry.dispose();
      grid.material.dispose();
      grid = null;
    }
    scene.background = null;
    scene.backgroundRotation = new THREE.Euler(0, 0, 0);
    scene.backgroundIntensity = 1;
    scene.fog = null;
    setAnchor(null);
  }

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
          if (deps.onGizmo) deps.onGizmo(selected);
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
      camLocked = true;
      applyCam();
    });
    cv.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const cam = CAM();
        cam.dist = Math.max(0.05, Math.min(4000, cam.dist * (1 + Math.sign(e.deltaY) * 0.1)));
        camLocked = true;
        applyCam();
      },
      { passive: false },
    );
  }

  return core.attach({
    async init() {
      m3d = await loadModel3d();
      renderer.debug.onShaderError = (gl, program, vs) => {
        const name = noteShaderError(gl, program, vs);
        if (!name) return;
        core.note(`${name} のシェーダを実行できないため、フィールドを通常表示に戻します。`);
        this.syncField().catch(() => {});
      };
      guard = guardRenderer(renderer, { deadMs: 2600, onDead: () => core.note('描画コンテキストを復帰できませんでした。ページを再読み込みしてください。') });
      bindPointer();
      applyCam();
      resize();
    },
    frame(dt) {
      resize();
      clock += dt;
      for (const c of state.scene.chars) {
        const inst = core.live(c.id);
        if (inst) inst.update(c.paused ? 0 : dt);
      }
      if (guard && guard.lost) return;
      if (fieldMats.length) {
        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        const k = Math.min(1, OPAQUE_RT_CAP / Math.max(size.x, size.y));
        const rw = Math.max(1, Math.round(size.x * k));
        const rh = Math.max(1, Math.round(size.y * k));
        if (!sceneRT || sceneRT.width !== rw || sceneRT.height !== rh) {
          if (sceneRT) {
            sceneRT.depthTexture.dispose();
            sceneRT.dispose();
          }
          sceneRT = new THREE.WebGLRenderTarget(rw, rh);
          sceneRT.depthTexture = new THREE.DepthTexture(rw, rh);
          sceneRT.depthTexture.format = THREE.DepthFormat;
          sceneRT.depthTexture.type = THREE.UnsignedIntType;
        }
        const hidden = [];
        if (fieldGroup)
          fieldGroup.traverse((o) => {
            if (o.userData && o.userData.fieldShaderPass && o.visible) {
              o.visible = false;
              hidden.push(o);
            }
          });
        renderer.setRenderTarget(sceneRT);
        renderer.clear();
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);
        for (const o of hidden) o.visible = true;
        updateFieldUniforms(fieldMats, THREE, { camera, time: clock, width: size.x, height: size.y, opaque: sceneRT.texture, depth: sceneRT.depthTexture });
      }
      gizmo.resize(camera);
      renderer.render(scene, camera);
    },
    async create(key, entry, want) {
      let d = null;
      try {
        d = await loadModelFor(entry, want && want.costume);
      } catch (e) {}
      if (!d || !d.model) {
        core.note(`#${key} の3Dモデルが見つかりません。ダウンロードを確認してください。`);
        return null;
      }
      let inst = null;
      try {
        inst = m3d.buildInstance(d.model, d.matBundle, {
          weapons: d.weapons || null,
          mouthAtlas: d.mouthAtlas || null,
          attachments: d.attachments || undefined,
          attachmentColors: d.attachmentColors || undefined,
        });
      } catch (e) {}
      if (!inst || !inst.ok) {
        core.note(`#${key} は表示できる形状データを持っていません。`);
        return null;
      }
      inst.costumes = d.variations || [];
      inst.costume = d.costume || '';
      scene.add(inst.root);
      inst.shadow = createShadow();
      scene.add(inst.shadow);
      return inst;
    },
    destroy(inst) {
      disposeShadow(inst.shadow);
      inst.dispose();
    },
    added() {
      frame(core.liveCount() === 1 && !authored);
    },
    afterSync() {
      frame();
    },
    defaultMotion: (inst) => idleClip(inst.clipNames),
    needsRebuild: (c, inst) => !!(c.costume && inst.costume && inst.costume !== c.costume),
    apply(c, inst) {
      if (c.motion) inst.setClip(c.motion);
      inst.setSpeed(c.speed);
      inst.setPaused(c.paused);
      inst.setMouth(c.mouth);
      inst.setFace(c.face || '');
      inst.setBrow(c.brow || '');
      place(c, inst);
      applyShadowMode();
    },
    controlsFor(inst) {
      if (!inst) return { motionLabel: 'モーション', motions: [], selects: [], sliders: SLIDERS };
      const selects = [
        { key: 'mouth', label: '口', keep: true, cast: 'number', options: (inst.mouths || []).map((v) => [v, String(v)]) },
        { key: 'face', label: '目', keep: true, options: (inst.faces || []).map((b, i) => [b, String(i + 1)]) },
        { key: 'brow', label: '眉', keep: true, options: (inst.brows || []).map((b, i) => [b, String(i + 1)]) },
      ].filter((s) => s.options.length);
      if ((inst.costumes || []).length > 1) selects.push({ key: 'costume', label: '服装', options: inst.costumes.map((x) => [x.value, x.label]) });
      return { motionLabel: 'モーション', motions: (inst.clipNames || []).map((n) => [n, n]), selects, sliders: SLIDERS, shadow: SHADOW_KINDS };
    },
    async syncField() {
      const prevAnchor = anchor.clone();
      clearField();
      const f = state.scene.field;
      if (f && f.kind === 'grid') {
        grid = new THREE.GridHelper(40, 40, 0x4ade80, 0x2f7d4f);
        scene.add(grid);
      }
      if (!f || f.kind !== 'battlemap' || !f.rel) {
        shiftCamera(prevAnchor);
        placeAll();
        frame();
        return;
      }
      core.busy(true, 'フィールドを読み込み中…');
      try {
        const r = await loadBattleField(THREE, f.rel, { bptc: renderer.extensions.has('EXT_texture_compression_bptc') });
        if (!r) {
          core.note('このフィールドを読み込めませんでした。バトルフィールドDLを実行してください。');
          shiftCamera(prevAnchor);
          placeAll();
          frame();
          return;
        }
        fieldGroup = r.group;
        fieldMats = r.fieldMats || [];
        scene.add(fieldGroup);
        setAnchor(fieldGroup, r.origin);
        applyShadowMode();
        shiftCamera(prevAnchor);
        placeAll();
        frame();
        if (r.background) scene.background = r.background;
        scene.backgroundRotation = new THREE.Euler(0, r.backgroundRotation || 0, 0);
        scene.backgroundIntensity = r.backgroundIntensity || 1;
        if (r.fog) scene.fog = r.fog;
        if (r.light) {
          light.intensity = r.light.intensity;
          light.color.setRGB(r.light.r, r.light.g, r.light.b);
        }
      } catch (e) {
        core.note('フィールドの読み込みに失敗しました。');
      } finally {
        core.busy(false);
      }
    },
    snapshot() {
      renderer.render(scene, camera);
      return new Promise((res) => renderer.domElement.toBlob(res, 'image/png'));
    },
    lockCamera() {
      authored = true;
      camLocked = true;
      framed = true;
    },
    resetCamera() {
      const cam = CAM();
      cam.yaw = 0.5;
      cam.pitch = 0.28;
      cam.panX = 0;
      cam.panY = 0;
      camLocked = false;
      frame(true);
    },
    selected: () => selected,
    select(id) {
      selectChar(id);
    },
    dispose() {
      gizmo.dispose();
      clearField();
      if (sceneRT) {
        sceneRT.depthTexture.dispose();
        sceneRT.dispose();
        sceneRT = null;
      }
      if (guard) guard.dispose();
    },
  });
}
