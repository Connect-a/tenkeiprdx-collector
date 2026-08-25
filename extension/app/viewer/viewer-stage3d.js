import * as THREE from '../../vendor/three.module.js';
import { loadModel3d } from '../../engine/render/lazy.js';
import { loadModelFor } from './viewer-source.js';
import { guardRenderer } from '../../engine/render/gl-manager.js';
import { loadBattleField } from './viewer-battlefield.js';
import { updateFieldUniforms, noteShaderError } from '../../engine/render/field-shader.js';
import { createStageCore } from './viewer-stage-core.js';
import { el } from '../../core/dom.js';

const PITCH_LIMIT = 1.3;
const idleClip = (names) => (names || []).find((n) => /^idle$/i.test(n)) || (names || []).find((n) => /idle/i.test(n)) || (names || [])[0] || '';
const SLIDERS = [
  ['x', '左右', -6, 6, 0.05],
  ['y', '高さ', -6, 6, 0.05],
  ['z', '奥行', -6, 6, 0.05],
  ['rotY', '向き', -3.14, 3.14, 0.02],
  ['scale', '大きさ', 0.2, 3, 0.01],
];

export function createStage(hostEl, deps) {
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
  };
  camera.updateProjectionMatrix();
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace || 'srgb';
  wrap.appendChild(renderer.domElement);

  const light = new THREE.DirectionalLight(0xffffff, 0.9);
  light.position.set(0.4, 1, 0.8);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));

  let fieldGroup = null;
  let grid = null;
  let guard = null;
  let fieldMats = [];
  let sceneRT = null;
  let clock = 0;
  let m3d = null;
  const anchor = new THREE.Vector3(0, 0, 0);
  const focus = new THREE.Vector3(0, 1, 0);
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

  function place(c, inst) {
    inst.root.position.set(anchor.x - (c.x || 0), anchor.y + (c.y || 0), anchor.z + (c.z || 0));
    inst.root.rotation.y = (inst.defaultRotY || 0) + (c.rotY || 0);
    const s = c.scale || 1;
    inst.root.scale.set(s, s, s);
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
    scene.fog = null;
    setAnchor(null);
  }

  function bindPointer() {
    const cv = renderer.domElement;
    let drag = false;
    let pan = false;
    let lx = 0;
    let ly = 0;
    cv.style.touchAction = 'none';
    cv.style.cursor = 'grab';
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      lx = e.clientX;
      ly = e.clientY;
      if (e.button === 2 || e.button === 1) pan = true;
      else drag = true;
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointerup', (e) => {
      drag = pan = false;
      try {
        cv.releasePointerCapture(e.pointerId);
      } catch (x) {}
    });
    cv.addEventListener('pointermove', (e) => {
      const dx = e.clientX - lx,
        dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
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
        cam.dist = Math.max(0.05, Math.min(2000, cam.dist * (1 + Math.sign(e.deltaY) * 0.1)));
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
        if (!sceneRT || sceneRT.width !== size.x || sceneRT.height !== size.y) {
          if (sceneRT) {
            sceneRT.depthTexture.dispose();
            sceneRT.dispose();
          }
          sceneRT = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y));
          sceneRT.depthTexture = new THREE.DepthTexture(Math.max(1, size.x), Math.max(1, size.y));
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
      return inst;
    },
    destroy(inst) {
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
      if (c.mouth != null) inst.setMouth(c.mouth);
      inst.setFace(c.face || '');
      inst.setBrow(c.brow || '');
      place(c, inst);
    },
    controlsFor(inst) {
      if (!inst) return { motionLabel: 'モーション', motions: [], selects: [], sliders: SLIDERS };
      const selects = [
        { key: 'mouth', label: '口', keep: true, cast: 'number', options: (inst.mouths || []).map((v) => [v, String(v)]) },
        { key: 'face', label: '目', keep: true, options: (inst.faces || []).map((b, i) => [b, String(i + 1)]) },
        { key: 'brow', label: '眉', keep: true, options: (inst.brows || []).map((b, i) => [b, String(i + 1)]) },
      ].filter((s) => s.options.length);
      if ((inst.costumes || []).length > 1) selects.push({ key: 'costume', label: '服装', options: inst.costumes.map((x) => [x.value, x.label]) });
      return { motionLabel: 'モーション', motions: (inst.clipNames || []).map((n) => [n, n]), selects, sliders: SLIDERS };
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
          return;
        }
        fieldGroup = r.group;
        fieldMats = r.fieldMats || [];
        scene.add(fieldGroup);
        setAnchor(fieldGroup, r.origin);
        shiftCamera(prevAnchor);
        placeAll();
        frame();
        if (r.background) scene.background = r.background;
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
    dispose() {
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
