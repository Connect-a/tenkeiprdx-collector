import { spineWeb } from '../../engine/story/spine-web.js';
import { visualRenderer } from '../../engine/render/visual.js';
import { spineInputsFor } from './viewer-source.js';
import { unityMesh } from '../../unity/mesh.js';
import { assetStore } from '../../data/asset-store.js';
import { DIRS } from '../../core/constants.js';
import { createStageCore } from './viewer-stage-core.js';
import { el } from '../../core/dom.js';

const SP = () => spineWeb.lib();
const GL = () => SP() && SP().webgl;
const REF_W = 1136;
const REF_H = 640;
const BASE_SCALE = 0.33;

const EXPRESSIONS = [
  ['idle_normal', 'ふつう'],
  ['idle_joy', 'よろこび'],
  ['idle_angry', 'おこり'],
  ['idle_sad', 'かなしみ'],
  ['idle_shy', 'てれ'],
  ['idle_surprise', 'おどろき'],
  ['idle_unique', 'とくべつ'],
];
const SLIDERS = [
  ['x', '左右', -6, 6, 0.05],
  ['y', '高さ', -6, 6, 0.05],
  ['z', '前後', -6, 6, 1],
  ['scale', '大きさ', 0.2, 3, 0.01],
];

const idleAnim = (names) => (names || []).find((n) => n === 'idle_normal') || (names || []).find((n) => /idle/i.test(n)) || (names || [])[0] || '';

function buildSkeleton(ctx, inputs) {
  const spine = SP();
  const atlasBytes = spineWeb.maybeScaleAtlas(inputs.atlasBytes, inputs.texture.width, inputs.texture.height);
  const tex = spineWeb.makeRawGLTexture(ctx, inputs.texture.rgba, inputs.texture.width, inputs.texture.height, false);
  const atlas = new spine.TextureAtlas(new TextDecoder('utf-8').decode(atlasBytes), () => tex);
  const loader = new spine.AtlasAttachmentLoader(atlas);
  const isJson = spineWeb.detectSkeletonIsJson(inputs.skeletonPath, inputs.skeletonBytes);
  const data = isJson
    ? new spine.SkeletonJson(loader).readSkeletonData(new TextDecoder('utf-8').decode(inputs.skeletonBytes))
    : new spine.SkeletonBinary(loader).readSkeletonData(inputs.skeletonBytes instanceof Uint8Array ? inputs.skeletonBytes : new Uint8Array(inputs.skeletonBytes));
  const skeleton = new spine.Skeleton(data);
  const stateData = new spine.AnimationStateData(data);
  stateData.defaultMix = 0.12;
  const anim = new spine.AnimationState(stateData);
  skeleton.setToSetupPose();
  skeleton.updateWorldTransform();
  const off = new spine.Vector2();
  const size = new spine.Vector2();
  skeleton.getBounds(off, size, []);
  return { atlas, skeleton, anim, anims: data.animations.map((a) => a.name), bounds: { x: off.x, y: off.y, w: size.x, h: size.y }, entry: null, cur: null };
}

export function createStage(hostEl, deps) {
  const core = createStageCore(hostEl, deps);
  const { state } = core;
  const canvas = el('canvas', { class: 'vw-canvas' });
  const bgEl = el('div', { class: 'vw-bg2d' });
  hostEl.appendChild(bgEl);
  hostEl.appendChild(canvas);

  let ctx = null;
  let renderer = null;
  let gl = null;
  let bgUrl = '';
  let bgCss = '';
  let bgImg = null;
  const CAM = () => state.scene.camera;
  const zoomOf = (cam) => 8 / Math.max(0.05, cam.dist || 8);

  function resize() {
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const w = Math.round((hostEl.clientWidth || REF_W) * dpr);
    const h = Math.round((hostEl.clientHeight || REF_H) * dpr);
    if (w === canvas.width && h === canvas.height) return;
    canvas.width = w;
    canvas.height = h;
  }

  function bindPointer() {
    let drag = false;
    let lx = 0;
    let ly = 0;
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      drag = true;
      lx = e.clientX;
      ly = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointerup', (e) => {
      drag = false;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (x) {}
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const cam = CAM();
      cam.panX += e.clientX - lx;
      cam.panY -= e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const cam = CAM();
        cam.dist = Math.max(0.5, Math.min(80, (cam.dist || 8) * (1 + Math.sign(e.deltaY) * 0.1)));
      },
      { passive: false },
    );
  }

  return core.attach({
    async init() {
      const r = await visualRenderer.prepareSpineRuntime(hostEl);
      if (!r.ok || !GL() || !GL().SceneRenderer) throw new Error('Spineランタイムを読み込めませんでした');
      ctx = new (GL().ManagedWebGLRenderingContext)(canvas, { alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: true });
      gl = ctx.gl;
      renderer = new (GL().SceneRenderer)(canvas, ctx, true);
      bindPointer();
      resize();
    },
    frame(delta) {
      resize();
      const W = canvas.width;
      const H = canvas.height;
      const cam = renderer.camera;
      cam.position.x = W / 2;
      cam.position.y = H / 2;
      cam.setViewport(W, H);
      cam.update();
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const view = CAM();
      const zoom = zoomOf(view);
      const dpr = W / (hostEl.clientWidth || REF_W);
      const px = W / 2 + view.panX * dpr;
      const py = H / 2 + view.panY * dpr;
      const css = `translate(${view.panX}px, ${-view.panY}px) scale(${zoom})`;
      if (css !== bgCss) {
        bgCss = css;
        bgEl.style.transform = css;
      }
      const heights = state.scene.chars
        .map((c) => core.live(c.id))
        .filter((r) => r && r.bounds.h > 0)
        .map((r) => r.bounds.h)
        .sort((a, b) => a - b);
      const refH = heights.length ? heights[heights.length >> 1] : 0;

      renderer.begin();
      for (const c of state.scene.chars.slice().sort((a, b) => (b.z || 0) - (a.z || 0))) {
        const rec = core.live(c.id);
        if (!rec) continue;
        rec.anim.update(c.paused ? 0 : delta);
        rec.anim.apply(rec.skeleton);
        const b = rec.bounds;
        if (!(b.h > 0)) continue;
        const scale = (refH > 0 ? (H * 0.5) / refH : BASE_SCALE * (H / REF_H)) * (c.scale || 1) * zoom;
        rec.skeleton.x = px + (c.x || 0) * (W / 12) * zoom - (b.x + b.w / 2) * scale;
        rec.skeleton.y = py + (c.y || 0) * (H / 12) * zoom - (b.y + b.h / 2) * scale;
        rec.skeleton.scaleX = scale;
        rec.skeleton.scaleY = scale;
        rec.skeleton.updateWorldTransform();
        try {
          renderer.drawSkeleton(rec.skeleton, true);
        } catch (e) {}
      }
      renderer.end();
    },
    async create(key, entry) {
      let inputs = null;
      try {
        inputs = await spineInputsFor(entry);
      } catch (e) {}
      if (!inputs) {
        core.note(`#${key} の立ち絵Spineが見つかりません。ダウンロードを確認してください。`);
        return null;
      }
      try {
        return buildSkeleton(ctx, inputs);
      } catch (e) {
        core.note(`#${key} の立ち絵を組み立てられませんでした。`);
        return null;
      }
    },
    destroy(rec) {
      try {
        rec.atlas.dispose();
      } catch (e) {}
    },
    defaultMotion: (rec) => idleAnim(rec.anims),
    apply(c, rec) {
      const pick = rec.anims.includes(c.motion) ? c.motion : idleAnim(rec.anims);
      if (!pick) return;
      if (rec.cur !== pick) {
        try {
          rec.entry = rec.anim.setAnimation(0, pick, true);
          rec.cur = pick;
        } catch (e) {}
      }
      if (rec.entry) rec.entry.timeScale = c.paused ? 0 : c.speed > 0 ? c.speed : 1;
    },
    controlsFor(rec) {
      if (!rec) return { motionLabel: '表情', motions: [], selects: [], sliders: SLIDERS };
      const have = rec.anims;
      const known = EXPRESSIONS.filter(([v]) => have.includes(v));
      const extra = have.filter((n) => !EXPRESSIONS.some(([v]) => v === n)).map((n) => [n, n]);
      return { motionLabel: '表情', motions: [...known, ...extra], selects: [], sliders: SLIDERS };
    },
    async syncField() {
      const f = state.scene.field;
      if (bgUrl) {
        URL.revokeObjectURL(bgUrl);
        bgUrl = '';
      }
      bgImg = null;
      if (!f || f.kind !== 'background' || !f.rel) {
        bgEl.style.backgroundImage = '';
        return;
      }
      core.busy(true, '背景を読み込み中…');
      try {
        const bytes = await assetStore.readAsset(DIRS.shared, f.rel);
        const canvases = bytes ? unityMesh.decodeAllTextureCanvases(bytes) : null;
        const cv = canvases && canvases.length ? canvases[0] : null;
        if (!cv) return;
        const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
        bgUrl = URL.createObjectURL(blob);
        bgEl.style.backgroundImage = `url(${bgUrl})`;
        bgImg = cv;
      } catch (e) {
        bgEl.style.backgroundImage = '';
      } finally {
        core.busy(false);
      }
    },
    snapshot() {
      const W = canvas.width;
      const H = canvas.height;
      const out = document.createElement('canvas');
      out.width = W;
      out.height = H;
      const g = out.getContext('2d');
      if (bgImg) {
        const view = CAM();
        const zoom = zoomOf(view);
        const dpr = W / (hostEl.clientWidth || REF_W);
        const cover = Math.max(W / bgImg.width, H / bgImg.height) * zoom;
        const dw = bgImg.width * cover;
        const dh = bgImg.height * cover;
        g.drawImage(bgImg, W / 2 + view.panX * dpr - dw / 2, H / 2 - view.panY * dpr - dh / 2, dw, dh);
      }
      g.drawImage(canvas, 0, 0);
      return new Promise((res) => out.toBlob(res, 'image/png'));
    },
    resetCamera() {
      const cam = CAM();
      cam.panX = 0;
      cam.panY = 0;
      cam.dist = 8;
    },
    dispose() {
      if (bgUrl) URL.revokeObjectURL(bgUrl);
      try {
        const lose = gl && gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      } catch (e) {}
    },
  });
}
