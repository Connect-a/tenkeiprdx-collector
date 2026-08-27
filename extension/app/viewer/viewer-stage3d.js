import * as THREE from '../../vendor/three.module.js';
import { loadModel3d } from '../../engine/render/lazy.js';
import { loadModelFor, voiceClipFor } from './viewer-source.js';
import { guardRenderer } from '../../engine/render/gl-manager.js';
import { loadBattleField } from './viewer-battlefield.js';
import { updateFieldUniforms, noteShaderError } from '../../engine/render/field-shader.js';
import { createStageCore } from './viewer-stage-core.js';
import { createShadow, disposeShadow, placeShadow, SHADOW_OPACITY, SHADOW_KINDS } from './viewer-shadow.js';
import { createGizmo } from './viewer-gizmo.js';
import { el } from '../../core/dom.js';
import { MOTION_VOICE, MOTION_ORDER } from '../../core/constants.js';
import { utilHelpers } from '../../core/util.js';

const PITCH_LIMIT = 1.3;
// 影の範囲は URP アセットの m_ShadowDistance=40。カスケードは1枚のままなので解像度で補う（設計資料_viewer.md）。
const FIELD_SHADOW_SIZE = 2048;
const FIELD_SHADOW_EXTENT = 40;
const LAYER_FIELD = 1;
const LAYER_CHAR = 2;
const idleClip = (names) => (names || []).find((n) => /^idle$/i.test(n)) || (names || []).find((n) => /idle/i.test(n)) || (names || [])[0] || '';
const clipLike = (names, re) => (names || []).find((n) => re.test(n)) || '';
const SLIDERS = [];
const MOTION_LC = MOTION_ORDER.map((n) => n.toLowerCase());
// 持っていないモーションも並びどおりに出し、選べないことが分かるようにする。
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

// 操作モードはビューワー独自の機能。実ゲームの移動速度・当たり判定の数値は持っていないので、
// ここは「見て操作できる」ことを目的にした値。クリップ名は実ゲームの文字列リテラル準拠（Idle/Run/Attack/Damage）。
const RUN_SPEED = 3;
const TURN_RATE = 12;
const HIT_REACH = 2.4;
const HIT_HALF_ANGLE = Math.PI / 4;
const HIT_HEIGHT = 1.6;
const HIT_AT = 0.35;
const HIT_DELAY = 0.12;

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

  // フィールド用の影。three のライトを増やすとキャラ実影の受け皿(ShadowMaterial)にもフィールドの影が
  // 二重に乗るので、深度だけ自前のRTへ焼いて実ゲームGLSLの sampler2DShadow に直接差す。
  // ライトは動かないので、フィールド読込時と基準点移動時に1回焼くだけ。
  const fieldShadowCam = new THREE.OrthographicCamera(-FIELD_SHADOW_EXTENT, FIELD_SHADOW_EXTENT, FIELD_SHADOW_EXTENT, -FIELD_SHADOW_EXTENT, 0.5, FIELD_SHADOW_EXTENT * 4);
  fieldShadowCam.layers.set(LAYER_FIELD);
  // URP の ShadowCasterPass と同じ ApplyShadowBias を掛けてから深度を焼く。
  // depthBias / normalBias は実データの Light.m_Shadows の値 × テクセルのワールドサイズ（Unityと同じ算出）。
  const fieldShadowDepthMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    side: THREE.DoubleSide,
    colorWrite: false,
    uniforms: { uLightDir: { value: new THREE.Vector3(0, 1, 0) }, uBias: { value: new THREE.Vector2(0, 0) } },
    vertexShader: [
      'precision highp float;',
      'in vec3 position;',
      'in vec3 normal;',
      'uniform mat4 modelMatrix, viewMatrix, projectionMatrix;',
      'uniform vec3 uLightDir;',
      'uniform vec2 uBias;',
      'void main(){',
      '  vec4 w = modelMatrix * vec4( position, 1.0 );',
      '  vec3 n = normalize( mat3( modelMatrix ) * normal );',
      '  float invNdotL = 1.0 - clamp( dot( uLightDir, n ), 0.0, 1.0 );',
      '  vec3 p = w.xyz + uLightDir * uBias.x + n * ( invNdotL * uBias.y );',
      '  gl_Position = projectionMatrix * viewMatrix * vec4( p, 1.0 );',
      '}',
    ].join('\n'),
    fragmentShader: 'precision highp float;\nout vec4 o;\nvoid main(){ o = vec4( 1.0 ); }',
  });
  let fieldShadowRT = null;
  let fieldShadowUniforms = [];
  const fieldShadow = { map: null, matrix: new THREE.Matrix4(), mapSize: new THREE.Vector2(FIELD_SHADOW_SIZE, FIELD_SHADOW_SIZE) };

  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: SHADOW_OPACITY, transparent: true, side: THREE.DoubleSide }));
  catcher.receiveShadow = true;
  catcher.visible = false;
  scene.add(catcher);

  let fieldGroup = null;
  let grid = null;
  let guard = null;
  let fieldMats = [];
  let sceneRT = null;
  let fogUniforms = [];
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
  let mainLight = null;
  let lightKey = '';
  let api = null;
  const CAM = () => state.scene.camera;

  async function setMainLight(l) {
    const key = l
      ? l.dir
          .concat(l.color)
          .map((v) => v.toFixed(3))
          .join(',')
      : '';
    if (key === lightKey) return;
    lightKey = key;
    mainLight = l ? { dir: l.dir, color: l.color } : null;
    if (!api) return;
    for (const id of [...core.items.keys()]) {
      api.removeChar(id);
      await api.addChar(id);
    }
  }

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
    for (const u of fogUniforms) u.uTpFogControl.value[1] = camera.near;
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

  const SHADOW_BIAS_MATRIX = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

  function renderFieldShadow(light) {
    fieldShadow.map = null;
    if (!fieldGroup || !light || !light.shadow || !(light.shadow.strength > 0)) return;
    if (!fieldShadowRT) {
      fieldShadowRT = new THREE.WebGLRenderTarget(FIELD_SHADOW_SIZE, FIELD_SHADOW_SIZE);
      fieldShadowRT.depthTexture = new THREE.DepthTexture(FIELD_SHADOW_SIZE, FIELD_SHADOW_SIZE, THREE.UnsignedIntType);
      fieldShadowRT.depthTexture.format = THREE.DepthFormat;
      fieldShadowRT.depthTexture.compareFunction = THREE.LessEqualCompare;
      fieldShadowRT.depthTexture.minFilter = THREE.LinearFilter;
      fieldShadowRT.depthTexture.magFilter = THREE.LinearFilter;
    }
    const d = new THREE.Vector3(light.dir[0], light.dir[1], light.dir[2]).normalize();
    fieldShadowCam.position.copy(anchor).addScaledVector(d, FIELD_SHADOW_EXTENT * 2);
    fieldShadowCam.lookAt(anchor);
    fieldShadowCam.updateMatrixWorld();
    fieldShadowCam.updateProjectionMatrix();
    // Unity: texelSize = 2 * frustumSize / resolution、bias は符号反転してライトと逆へ押し出す。
    const texel = (2 * FIELD_SHADOW_EXTENT * 2) / FIELD_SHADOW_SIZE;
    const soft = light.shadow.type === 2 ? Math.SQRT2 : 1;
    fieldShadowDepthMat.uniforms.uLightDir.value.copy(d);
    fieldShadowDepthMat.uniforms.uBias.value.set(-(light.shadow.bias || 0) * texel, -(light.shadow.normalBias || 0) * texel * soft);
    fieldShadow.matrix.copy(SHADOW_BIAS_MATRIX).multiply(fieldShadowCam.projectionMatrix).multiply(fieldShadowCam.matrixWorldInverse);
    const prev = scene.overrideMaterial;
    const bg = scene.background;
    scene.overrideMaterial = fieldShadowDepthMat;
    scene.background = null;
    renderer.setRenderTarget(fieldShadowRT);
    renderer.clear();
    renderer.render(scene, fieldShadowCam);
    renderer.setRenderTarget(null);
    scene.overrideMaterial = prev;
    scene.background = bg;
    fieldShadow.map = fieldShadowRT;
    for (const u of fieldShadowUniforms) {
      u.uShadowMap.value = fieldShadowRT.depthTexture;
      u.uShadowMatrix.value.copy(fieldShadow.matrix);
    }
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
        o.layers.enable(LAYER_CHAR);
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

  const keys = new Set();
  let act = null;
  const clipOf = (inst, re, fallback) => clipLike(inst.clipNames, re) || (fallback ? idleClip(inst.clipNames) : '');

  function onKey(e) {
    const k = (e.key || '').toLowerCase();
    if (!('wasd '.includes(k) || /^[0-9]$/.test(k)) || e.ctrlKey || e.altKey || e.metaKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (!state.scene.chars.some((c) => c.control)) return;
    e.preventDefault();
    if (e.type === 'keyup') keys.delete(k);
    else keys.add(k);
  }

  function playOnce(c, inst, clip, withHit) {
    inst.setClip(clip);
    lastMotion.set(String(c.id), clip);
    const dur = (inst.clipDuration && inst.clipDuration(clip)) || 1;
    act = { ...(act || {}), once: dur, hit: withHit ? dur * HIT_AT : null };
    playMotionVoice(c.id, String(clip).toLowerCase());
  }

  function charSelects(inst) {
    const selects = [
      { key: 'mouth', label: '口', keep: true, cast: 'number', options: (inst.mouths || []).map((v) => [v, String(v)]) },
      { key: 'face', label: '目', keep: true, options: (inst.faces || []).map((b, i) => [b, String(i + 1)]) },
      { key: 'brow', label: '眉', keep: true, options: (inst.brows || []).map((b, i) => [b, String(i + 1)]) },
    ].filter((s) => s.options.length);
    if ((inst.costumes || []).length > 1) selects.push({ key: 'costume', label: '服装', options: inst.costumes.map((x) => [x.value, x.label]) });
    return selects;
  }

  function randomParts(c, inst) {
    const patch = {};
    for (const s of charSelects(inst)) {
      const opts = s.options;
      const v = opts[Math.floor(Math.random() * opts.length)][0];
      patch[s.key] = s.cast === 'number' ? Number(v) : v;
    }
    if (!Object.keys(patch).length) return;
    state.update(c.id, patch);
    if (api) api.syncChar(c.id);
    if (deps.onDrive) deps.onDrive(c.id);
  }

  const voiceUrls = new Map();
  const lastMotion = new Map();
  let voiceEl = null;
  async function playMotionVoice(id, motion) {
    const no = MOTION_VOICE[motion];
    if (!no) return;
    try {
      const url = await utilHelpers.cachedAudioUrl(voiceUrls, id + ':' + motion, () => voiceClipFor(core.entryOf(id), no));
      if (!url) return;
      if (!voiceEl) voiceEl = new Audio();
      voiceEl.src = url;
      voiceEl.play().catch(() => {});
    } catch (e) {}
  }

  function strike(c, inst) {
    const from = inst.root.position;
    const face = inst.root.rotation.y;
    for (const o of state.scene.chars) {
      if (String(o.id) === String(c.id)) continue;
      const target = core.live(o.id);
      if (!target) continue;
      const dx = target.root.position.x - from.x;
      const dz = target.root.position.z - from.z;
      if (Math.abs(target.root.position.y - from.y) > HIT_HEIGHT) continue;
      const dist = Math.hypot(dx, dz);
      if (!(dist <= HIT_REACH)) continue;
      let diff = Math.atan2(dx, dz) - face;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > HIT_HALF_ANGLE) continue;
      const hurt = clipOf(target, /^damage$/i) || clipOf(target, /damage/i);
      if (!hurt) continue;
      act = act || {};
      (act.hurt = act.hurt || []).push({
        id: o.id,
        clip: hurt,
        wait: HIT_DELAY,
        until: (target.clipDuration && target.clipDuration(hurt)) || 0.8,
        rotY: Math.atan2(-dx, -dz) - (target.defaultRotY || 0),
      });
    }
  }

  function drive(dt) {
    const c = state.scene.chars.find((x) => x.control);
    const inst = c && core.live(c.id);
    if (!c || !inst) {
      act = null;
      return;
    }
    if (act && act.hurt) {
      for (const h of act.hurt) {
        const t = core.live(h.id);
        if (h.wait > 0) {
          h.wait -= dt;
          if (h.wait > 0) continue;
          if (t) {
            state.update(h.id, { rotY: h.rotY });
            place(state.get(h.id), t);
            t.setClip(h.clip);
            if (deps.onDrive) deps.onDrive(h.id);
          }
          continue;
        }
        h.until -= dt;
        if (h.until > 0) continue;
        const o = state.get(h.id);
        if (t) t.setClip(o && o.motion ? o.motion : idleClip(t.clipNames));
      }
      act.hurt = act.hurt.filter((h) => h.wait > 0 || h.until > 0);
      if (!act.hurt.length) delete act.hurt;
    }
    if (act && act.once != null) {
      act.once -= dt;
      if (act.hit != null) {
        act.hit -= dt;
        if (act.hit <= 0) {
          act.hit = null;
          strike(c, inst);
        }
      }
      if (act.once <= 0) {
        const back = idleClip(inst.clipNames);
        inst.setClip(back);
        lastMotion.set(String(c.id), back);
        state.update(c.id, { motion: back });
        if (deps.onDrive) deps.onDrive(c.id);
        act = act && act.hurt ? { hurt: act.hurt } : null;
      }
      return;
    }
    for (const k of keys) {
      if (!/^[0-9]$/.test(k)) continue;
      keys.delete(k);
      if (k === '0') {
        randomParts(c, inst);
        break;
      }
      const want = MOTION_ORDER[Number(k)];
      const clip = want && clipLike(inst.clipNames, new RegExp('^' + want + '$', 'i'));
      if (clip) playOnce(c, inst, clip, /^attack$/i.test(clip));
      break;
    }
    if (act && act.once != null) return;
    if (keys.has(' ')) {
      keys.delete(' ');
      const atk = clipOf(inst, /^attack$/i) || clipOf(inst, /attack/i);
      if (atk) {
        playOnce(c, inst, atk, true);
        return;
      }
    }
    let fx = 0;
    let fz = 0;
    if (keys.has('w')) fz += 1;
    if (keys.has('s')) fz -= 1;
    if (keys.has('a')) fx -= 1;
    if (keys.has('d')) fx += 1;
    const run = clipOf(inst, /^run$/i) || clipOf(inst, /run/i);
    if (!fx && !fz) {
      if (act && act.moving) {
        inst.setClip(c.motion || idleClip(inst.clipNames));
        act.moving = false;
      }
      return;
    }
    // 描画は X を反転している（camera.projectionMatrix の [0] を -1 倍）ので、
    // 画面の右＝ワールド -X。左右成分だけ符号を合わせる。
    const yaw = CAM().yaw;
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    const wx = -(fz * sy) - fx * cy;
    const wz = -(fz * cy) + fx * sy;
    const len = Math.hypot(wx, wz) || 1;
    const step = (RUN_SPEED * dt) / len;
    const nx = (c.x || 0) - wx * step;
    const nz = (c.z || 0) + wz * step;
    const want = Math.atan2(wx, wz) - (inst.defaultRotY || 0);
    let cur = c.rotY || 0;
    let diff = want - cur;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    cur += diff * Math.min(1, TURN_RATE * dt);
    state.update(c.id, { x: nx, z: nz, rotY: cur });
    place(state.get(c.id), inst);
    if (run) {
      inst.setClip(run);
      act = { ...(act || {}), moving: true };
    }
    if (deps.onDrive) deps.onDrive(c.id);
  }

  function placeAll() {
    for (const c of state.scene.chars) {
      const inst = core.live(c.id);
      if (inst) place(c, inst);
    }
  }

  function clearField() {
    fieldMats = [];
    fogUniforms = [];
    fieldShadowUniforms = [];
    fieldShadow.map = null;
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
      bindPointer();
      window.addEventListener('keydown', onKey);
      window.addEventListener('keyup', onKey);
      applyCam();
      resize();
    },
    frame(dt) {
      resize();
      clock += dt;
      drive(dt);
      for (const c of state.scene.chars) {
        const inst = core.live(c.id);
        if (inst) inst.update(c.paused ? 0 : dt);
      }
      if (guard && guard.lost) return;
      if (fieldMats.length) {
        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        const rw = Math.max(1, size.x);
        const rh = Math.max(1, size.y);
        if (!sceneRT || sceneRT.width !== rw || sceneRT.height !== rh) {
          if (sceneRT) {
            sceneRT.depthTexture.dispose();
            sceneRT.dispose();
          }
          sceneRT = new THREE.WebGLRenderTarget(rw, rh);
          sceneRT.texture.colorSpace = THREE.SRGBColorSpace || 'srgb';
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
        updateFieldUniforms(fieldMats, THREE, { camera, time: clock, width: size.x, height: size.y, opaque: sceneRT.texture, depth: sceneRT.depthTexture, shadow: fieldShadow });
      }
      if (selected) gizmo.sync(core.live(selected));
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
          mainLight,
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
      if (c.motion) {
        // キャラ詳細のビューワーと同じで、モーションを切り替えたら対応するボイスを鳴らす。
        const key = String(c.id);
        if (lastMotion.has(key) && lastMotion.get(key) !== c.motion) playMotionVoice(c.id, String(c.motion).toLowerCase());
        lastMotion.set(key, c.motion);
        inst.setClip(c.motion);
      }
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
      return { motionLabel: 'モーション', motions: motionOptions(inst.clipNames), selects: charSelects(inst), sliders: SLIDERS, shadow: SHADOW_KINDS, control: true };
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
        await setMainLight(null);
        shiftCamera(prevAnchor);
        placeAll();
        frame();
        return;
      }
      core.busy(true, 'フィールドを読み込み中…');
      try {
        const r = await loadBattleField(THREE, f.rel, {
          bptc: renderer.extensions.has('EXT_texture_compression_bptc'),
          renderer,
          maxAniso: renderer.capabilities.getMaxAnisotropy(),
        });
        if (!r) {
          core.note('このフィールドを読み込めませんでした。バトルフィールドDLを実行してください。');
          shiftCamera(prevAnchor);
          placeAll();
          frame();
          return;
        }
        fieldGroup = r.group;
        fieldMats = r.fieldMats || [];
        fogUniforms = r.fogUniforms || [];
        fieldShadowUniforms = r.shadowUniforms || [];
        // 影を落とすのは実体のジオメトリだけ。水面や空ドーム（実ゲームGLSL側）は落とさない。
        fieldGroup.traverse((o) => {
          if (o.isMesh && !(o.userData && o.userData.fieldShaderPass)) o.layers.enable(LAYER_FIELD);
        });
        scene.add(fieldGroup);
        setAnchor(fieldGroup, r.origin);
        renderFieldShadow(r.light);
        applyShadowMode();
        shiftCamera(prevAnchor);
        placeAll();
        frame();
        if (r.background) scene.background = r.background;
        scene.backgroundRotation = new THREE.Euler(0, r.backgroundRotation || 0, 0);
        scene.backgroundIntensity = r.backgroundIntensity || 1;
        await setMainLight(r.light && r.light.dir ? r.light : null);
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
      utilHelpers.revokeUrlMap(voiceUrls);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      gizmo.dispose();
      clearField();
      if (sceneRT) {
        sceneRT.depthTexture.dispose();
        sceneRT.dispose();
        sceneRT = null;
      }
      if (fieldShadowRT) {
        fieldShadowRT.depthTexture.dispose();
        fieldShadowRT.dispose();
        fieldShadowRT = null;
      }
      fieldShadowDepthMat.dispose();
      if (guard) guard.dispose();
    },
  });
  return api;
}
