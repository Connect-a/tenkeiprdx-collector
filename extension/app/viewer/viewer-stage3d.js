import * as THREE from '../../vendor/three.module.js';
import { loadModel3d } from '../../engine/render/lazy.js';
import { loadModelFor } from './viewer-source.js';
import { guardRenderer } from '../../engine/render/gl-manager.js';
import { loadBattleField, stepFieldAnimation } from './viewer-battlefield.js';
import { noteShaderError } from '../../engine/render/field-shader.js';
import { createStageCore } from './viewer-stage-core.js';
import { createShadow, disposeShadow, placeShadow } from './viewer-shadow.js';
import { createShadows, LAYER_CHAR } from './viewer-stage-shadow.js';
import { createFieldPass, LAYER_FIELD } from './viewer-stage-pass.js';
import { createSky } from './viewer-stage-sky.js';
import { createDriver } from './viewer-stage-drive.js';
import { createPicker } from './viewer-stage-pick.js';
import { createCameraRig } from './viewer-stage-camera.js';
import { buildGroundIndex } from './viewer-ground.js';
import { el } from '../../core/dom.js';
import { MOTION_ORDER, idleClip } from '../../engine/render/motion-names.js';

const SLIDERS = [];
const MOTION_LC = MOTION_ORDER.map((n) => n.toLowerCase());
const motionOptions = (names) => {
  const have = new Map((names || []).map((n) => [String(n).toLowerCase(), n]));
  const out = [];
  MOTION_ORDER.forEach((label, i) => {
    const real = have.get(MOTION_LC[i]);
    if (real) {
      out.push([real, real]);
      have.delete(MOTION_LC[i]);
    } else out.push(['', label, true]);
  });
  for (const n of [...have.values()].sort((a, b) => (a > b ? 1 : a < b ? -1 : 0))) out.push([n, n]);
  return out;
};

export function createStage(hostEl, deps) {
  deps = deps || {};
  const core = createStageCore(hostEl, deps);
  const { state } = core;
  const wrap = el('div', 'vw-canvas');
  hostEl.appendChild(wrap);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.05, 5000);
  camera.layers.enable(LAYER_FIELD);
  camera.layers.enable(LAYER_CHAR);
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

  const sky = createSky(scene, renderer);

  let fieldGroup = null;
  let fieldAnim = [];
  let fieldSeq = 0;
  let grid = null;
  let guard = null;
  let clock = 0;
  let m3d = null;
  const anchor = new THREE.Vector3(0, 0, 0);
  const pivot = new THREE.Vector3();
  const spun = new THREE.Vector3();
  let mainLight = null;
  let lightKey = '';
  let api = null;
  const CAM = () => state.scene.camera;

  const shadows = createShadows(scene, renderer, { anchor, state, core, mainLight: () => mainLight, fieldGroup: () => fieldGroup });
  const pass = createFieldPass(renderer, scene, camera, { catcher: shadows.catcher, shadows });

  async function setMainLight(l) {
    const key = l
      ? l.dir
          .concat(l.color)
          .map((v) => v.toFixed(3))
          .join(',')
      : '';
    if (key === lightKey) return;
    lightKey = key;
    mainLight = l ? { dir: l.dir, color: l.color, shadow: l.shadow || null } : null;
    if (!api) return;
    for (const id of [...core.items.keys()]) {
      api.removeChar(id);
      await api.addChar(id);
    }
  }

  const rig = createCameraRig(camera, renderer, wrap, { anchor, state, core, fieldGroup: () => fieldGroup, grid: () => grid, fog: pass.fog });
  const applyCam = rig.apply;
  const frame = rig.frame;
  const focus = rig.focus;

  const GROUND_FOOT = 0.25;
  const GROUND_TAPS = [
    [0, 0],
    [GROUND_FOOT, 0],
    [-GROUND_FOOT, 0],
    [0, GROUND_FOOT],
    [0, -GROUND_FOOT],
  ];
  const groundMemo = new WeakMap();
  let groundSeq = 0;
  function groundFor(inst, x, y, z) {
    const c = groundMemo.get(inst);
    if (c && c.seq === groundSeq && c.x === x && c.y === y && c.z === z) return c.v;
    const v = groundAt(x, y, z);
    groundMemo.set(inst, { seq: groundSeq, x, y, z, v });
    return v;
  }

  const movingMeshes = () => new Set(fieldAnim.flatMap((it) => it.meshes || []));
  let groundIdx = null;
  function groundAt(x, y, z) {
    if (!fieldGroup) return anchor.y;
    if (!groundIdx) groundIdx = buildGroundIndex(THREE, fieldGroup, movingMeshes());
    let best = null;
    for (const [dx, dz] of GROUND_TAPS) {
      const h = groundIdx.heightAt(x + dx, z + dz, y + 0.001, y + 6 - 60);
      if (h !== null && (best === null || h > best)) best = h;
    }
    return best === null ? anchor.y : best;
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
    const kind = state.scene.shadow;
    placeShadow(inst.shadow, { kind, x: p.x, groundY: kind === 'blob' ? groundFor(inst, p.x, p.y, p.z) : 0, z: p.z, scale: s, rotY: inst.root.rotation.y });
  }

  const driver = createDriver({ state, core, place, cam: CAM, onDrive: deps.onDrive, syncChar: (id) => api && api.syncChar(id) });

  function placeAll() {
    for (const c of state.scene.chars) {
      const inst = core.live(c.id);
      if (inst) place(c, inst);
    }
  }

  function clearField() {
    fieldAnim = [];
    groundSeq++;
    groundIdx = null;
    pass.clear();
    shadows.setUniforms([], []);
    shadows.char.strength = 0;
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
    sky.set(null, 0);
    scene.fog = null;
    rig.setAnchor(null);
  }

  const picker = createPicker(scene, renderer, camera, { state, core, place, cam: CAM, camMoved: rig.moved, onGizmo: deps.onGizmo });

  api = core.attach({
    async init() {
      m3d = await loadModel3d();
      renderer.debug.onShaderError = (gl, program, vs) => {
        const name = noteShaderError(gl, program, vs);
        if (!name) return;
        core.note(`${name} のシェーダを実行できないため、フィールドを通常表示に戻します。`);
        this.syncField().catch(() => {});
      };
      guard = guardRenderer(renderer, { deadMs: 2600, onDead: () => core.note('描画コンテキストを復帰できませんでした。ページを再読み込みしてください。') });
      picker.bind();
      window.addEventListener('keydown', driver.onKey);
      window.addEventListener('keyup', driver.onKey);
      applyCam();
      rig.resize();
    },
    frame(dt) {
      rig.resize();
      clock += dt;
      driver.drive(dt);
      if (fieldAnim.length) stepFieldAnimation(THREE, fieldAnim, clock);
      for (const c of state.scene.chars) {
        const inst = core.live(c.id);
        if (!inst) continue;
        const step = c.paused ? 0 : dt;
        if (step > 0) shadows.markPosed();
        inst.update(step);
      }
      if (guard && guard.lost) return;
      shadows.renderChar();
      pass.render(clock);
      picker.syncFrame();
      pass.present();
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
          mainLight,
        });
      } catch (e) {}
      if (!inst || !inst.ok) {
        core.note(`#${key} は表示できる形状データを持っていません。`);
        return null;
      }
      if (!(d.model.meshes || []).some((g) => g.positions && g.positions.length)) {
        core.note(`#${key} は本体の形状データが手元にありません（武器だけ表示されます）。`);
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
      rig.frameOnAdd(core.liveCount());
    },
    afterSync() {
      frame();
    },
    defaultMotion: (inst) => idleClip(inst.clipNames),
    needsRebuild: (c, inst) => !!(c.costume && inst.costume && inst.costume !== c.costume),
    apply(c, inst) {
      if (c.motion) {
        const key = String(c.id);
        driver.noteMotion(c.id, c.motion);
        inst.setClip(c.motion);
      }
      inst.setSpeed(c.speed);
      inst.setPaused(c.paused);
      inst.setMouth(c.mouth);
      inst.setFace(c.face || '');
      inst.setBrow(c.brow || '');
      place(c, inst);
      shadows.applyMode();
    },
    syncShadow() {
      shadows.applyMode();
      placeAll();
      frame();
    },
    controlsFor(inst) {
      if (!inst) return { motionLabel: 'モーション', motions: [], selects: [], sliders: SLIDERS };
      return { motionLabel: 'モーション', motions: motionOptions(inst.clipNames), selects: driver.selectsFor(inst), sliders: SLIDERS, control: true };
    },
    async syncField() {
      const prevAnchor = anchor.clone();
      const seq = ++fieldSeq;
      clearField();
      const f = state.scene.field;
      if (f && f.kind === 'grid') {
        grid = new THREE.GridHelper(40, 40, 0x4ade80, 0x2f7d4f);
        scene.add(grid);
      }
      if (!f || f.kind !== 'battlemap' || !f.rel) {
        await setMainLight(null);
        if (seq !== fieldSeq) return;
        rig.shift(prevAnchor);
        placeAll();
        frame();
        return;
      }
      core.busy(true, 'フィールドを読み込み中…');
      try {
        const r = await loadBattleField(THREE, f.rel, {
          bptc: renderer.extensions.has('EXT_texture_compression_bptc'),
          s3tc: renderer.extensions.has('WEBGL_compressed_texture_s3tc'),
          renderer,
          maxAniso: renderer.capabilities.getMaxAnisotropy(),
          charShadow: shadows.char,
        });
        if (seq !== fieldSeq) {
          if (r && r.group && r.group.__dispose) r.group.__dispose();
          return;
        }
        if (!r) {
          core.note('このフィールドを読み込めませんでした。バトルフィールドDLを実行してください。');
          rig.shift(prevAnchor);
          placeAll();
          frame();
          return;
        }
        fieldGroup = r.group;
        fieldAnim = r.animated || [];
        shadows.setUniforms(r.shadowUniforms, r.charShadowUniforms);
        pass.adopt(fieldGroup, r);
        scene.add(fieldGroup);
        rig.setAnchor(fieldGroup, r.origin);
        shadows.renderField(r.light);
        pass.seedShadows();
        shadows.applyMode();
        rig.shift(prevAnchor);
        placeAll();
        frame();
        sky.set(r.background, r.backgroundRotation || 0);
        await setMainLight(r.light && r.light.dir ? r.light : null);
        shadows.applyMode();
      } catch (e) {
        if (seq === fieldSeq) core.note('フィールドの読み込みに失敗しました。');
      } finally {
        if (seq === fieldSeq) core.busy(false);
      }
    },
    snapshot() {
      pass.present();
      return new Promise((res) => renderer.domElement.toBlob(res, 'image/png'));
    },
    lockCamera() {
      rig.markAuthored();
    },
    resetCamera() {
      rig.reset();
    },
    selected: () => picker.selected(),
    select(id) {
      picker.select(id);
    },
    dispose() {
      driver.dispose();
      window.removeEventListener('keydown', driver.onKey);
      window.removeEventListener('keyup', driver.onKey);
      picker.dispose();
      clearField();
      shadows.dispose();
      sky.dispose();
      pass.dispose();
      if (guard) guard.dispose();
    },
  });
  return api;
}
