import { spineWeb } from '../../engine/story/spine-web.js';
import { visualRenderer } from '../../engine/render/visual.js';
import { spineInputsFor } from './viewer-source.js';
import { groupSlots } from '../../engine/story/slot-group.js';
import { visFactors, withSlotAlphas } from '../../engine/story/slot-alpha.js';
import { unityMesh } from '../../unity/mesh.js';
import { texCodec } from '../../unity/texcodec.js';
import { fileStore } from '../../core/fsdir.js';
import { assetStore } from '../../data/asset-store.js';
import { DIRS } from '../../core/dirs.js';
import { createStageCore } from './viewer-stage-core.js';
import { el } from '../../core/dom.js';

const SP = () => spineWeb.lib();
const GL = () => SP() && SP().webgl;
const REF_W = 1136;
const REF_H = 640;
const BASE_SCALE = 0.33;

async function readBg(dir, rel) {
  try {
    return await assetStore.readAsset(dir, rel);
  } catch (e) {
    return null;
  }
}

async function readPlainFile(dir, rel) {
  try {
    const d = await fileStore.getDir(dir, { create: false });
    return d ? await fileStore.readBytesUnder(d, rel) : null;
  } catch (e) {
    return null;
  }
}

async function backgroundCanvas(rel) {
  if (/\.dds$/i.test(rel)) {
    const bytes = await readPlainFile(DIRS.home, rel);
    return bytes ? texCodec.decodeDdsCanvas(bytes) : null;
  }
  const bytes = (await readBg(DIRS.shared, rel)) || (await readBg(DIRS.home, rel));
  const list = bytes ? unityMesh.decodeAllTextureCanvases(bytes) : null;
  return list && list.length ? list[0] : null;
}

const EXPRESSIONS = [
  ['idle_normal', 'ふつう'],
  ['idle_joy', 'よろこび'],
  ['idle_angry', 'おこり'],
  ['idle_sad', 'かなしみ'],
  ['idle_shy', 'てれ'],
  ['idle_surprise', 'おどろき'],
  ['idle_unique', 'とくべつ'],
];
const SLIDERS = [['z', '前後', -6, 6, 1]];

const idleAnim = (names) => (names || []).find((n) => n === 'idle_normal') || (names || []).find((n) => /idle/i.test(n)) || (names || [])[0] || '';

function buildSkeleton(ctx, inputs) {
  return { ...spineWeb.buildSkeleton(ctx, inputs), entry: null, cur: null, vis: {} };
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
  let selected = null;
  let mode = null;
  let dragFrom = null;
  const rects = new Map();
  const box = el('div', { class: 'vw-gizmo2d', style: { display: 'none' } });
  const knob = el('div', 'vw-gizmo2d-knob');
  const spin = el('div', 'vw-gizmo2d-spin');
  box.appendChild(knob);
  box.appendChild(spin);
  hostEl.appendChild(box);
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

  const localPos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const toLocal = (r, p) => {
    const cs = Math.cos(r.rot || 0);
    const sn = Math.sin(r.rot || 0);
    const dx = p.x - r.cx;
    const dy = p.y - r.cy;
    return { x: dx * cs + dy * sn, y: -dx * sn + dy * cs };
  };

  const toWorld = (r, x, y) => {
    const cs = Math.cos(r.rot || 0);
    const sn = Math.sin(r.rot || 0);
    return { x: r.cx + x * cs - y * sn, y: r.cy + x * sn + y * cs };
  };

  const near = (p, q) => Math.abs(p.x - q.x) <= 10 && Math.abs(p.y - q.y) <= 10;

  const handleAt = (p) => {
    const r = selected ? rects.get(selected) : null;
    if (!r) return null;
    if (near(p, toWorld(r, r.w / 2, -r.h / 2))) return 'scale';
    if (near(p, toWorld(r, 0, -r.h / 2 - 20))) return 'rotate';
    return null;
  };

  const charAt = (p) => {
    const order = state.scene.chars.slice().sort((a, b) => (a.z || 0) - (b.z || 0));
    for (const c of order) {
      const r = rects.get(String(c.id));
      if (!r) continue;
      const l = toLocal(r, p);
      if (Math.abs(l.x) <= r.w / 2 && Math.abs(l.y) <= r.h / 2) return String(c.id);
    }
    return null;
  };

  const unitPerPx = () => {
    const W = canvas.width;
    const H = canvas.height;
    const dpr = W / (hostEl.clientWidth || REF_W);
    const zoom = zoomOf(CAM());
    return { ux: 12 / ((W / dpr) * zoom), uy: 12 / ((H / dpr) * zoom) };
  };

  function bindPointer() {
    let drag = false;
    let moved = 0;
    let lx = 0;
    let ly = 0;
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      lx = e.clientX;
      ly = e.clientY;
      moved = 0;
      canvas.setPointerCapture(e.pointerId);
      const p = localPos(e);
      const h = selected ? handleAt(p) : null;
      if (h) {
        const c = state.get(selected);
        const r = rects.get(selected);
        mode = h;
        dragFrom = h === 'scale' ? { scale: c ? c.scale || 1 : 1, dist: Math.max(8, Math.hypot(p.x - r.cx, p.y - r.cy)) } : { rot: c ? c.rotY || 0 : 0, angle: Math.atan2(p.x - r.cx, -(p.y - r.cy)) };
        return;
      }
      if (selected && charAt(p) === selected) {
        const c = state.get(selected);
        mode = 'move';
        dragFrom = { x: c ? c.x || 0 : 0, y: c ? c.y || 0 : 0, px: p.x, py: p.y };
        return;
      }
      drag = true;
    });
    canvas.addEventListener('pointerup', (e) => {
      if (!mode && drag && moved < 5 && e.button === 0) {
        selected = charAt(localPos(e));
        if (deps.onSelect) deps.onSelect(selected);
      }
      drag = false;
      mode = null;
      dragFrom = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (x) {}
    });
    canvas.addEventListener('pointermove', (e) => {
      moved += Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly);
      if (mode && selected) {
        const p = localPos(e);
        if (mode === 'scale') {
          const r = rects.get(selected);
          const d = Math.max(8, Math.hypot(p.x - r.cx, p.y - r.cy));
          state.update(selected, { scale: Math.max(0.05, Math.min(8, dragFrom.scale * (d / dragFrom.dist))) });
        } else if (mode === 'rotate') {
          const r = rects.get(selected);
          const a = Math.atan2(p.x - r.cx, -(p.y - r.cy));
          state.update(selected, { rotY: dragFrom.rot - (a - dragFrom.angle) });
        } else {
          const u = unitPerPx();
          state.update(selected, { x: dragFrom.x + (p.x - dragFrom.px) * u.ux, y: dragFrom.y - (p.y - dragFrom.py) * u.uy });
        }
        if (deps.onGizmo) deps.onGizmo(selected);
        lx = e.clientX;
        ly = e.clientY;
        return;
      }
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
      rects.clear();
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
        rec.state.update(c.paused ? 0 : delta);
        rec.state.apply(rec.skeleton);
        const b = rec.bounds;
        if (!(b.h > 0)) continue;
        const scale = (refH > 0 ? (H * 0.5) / refH : BASE_SCALE * (H / REF_H)) * (c.scale || 1) * zoom;
        const th = c.rotY || 0;
        const cos = Math.cos(th);
        const sin = Math.sin(th);
        const ox = b.x + b.w / 2;
        const oy = b.y + b.h / 2;
        rec.skeleton.x = px + (c.x || 0) * (W / 12) * zoom - (ox * cos - oy * sin) * scale;
        rec.skeleton.y = py + (c.y || 0) * (H / 12) * zoom - (ox * sin + oy * cos) * scale;
        rec.skeleton.scaleX = scale;
        rec.skeleton.scaleY = scale;
        const rootBone = rec.skeleton.getRootBone ? rec.skeleton.getRootBone() : (rec.skeleton.bones || [])[0];
        if (rootBone) rootBone.rotation = ((c.rotY || 0) * 180) / Math.PI;
        rec.skeleton.updateWorldTransform();
        const cx = px + (c.x || 0) * (W / 12) * zoom;
        const cy = py + (c.y || 0) * (H / 12) * zoom;
        rects.set(String(c.id), { cx: cx / dpr, cy: (H - cy) / dpr, w: (b.w * scale) / dpr, h: (b.h * scale) / dpr, rot: -th });
        withSlotAlphas(rec.skeleton, visFactors(rec.skeleton, rec.vis), () => renderer.drawSkeleton(rec.skeleton, true));
      }
      renderer.end();
      const r = selected ? rects.get(selected) : null;
      if (!r) box.style.display = 'none';
      else {
        box.style.display = '';
        box.style.left = r.cx - r.w / 2 + 'px';
        box.style.top = r.cy - r.h / 2 + 'px';
        box.style.width = Math.max(4, r.w) + 'px';
        box.style.height = Math.max(4, r.h) + 'px';
        box.style.transform = r.rot ? `rotate(${(r.rot * 180) / Math.PI}deg)` : '';
      }
    },
    async create(key, entry) {
      let inputs = null;
      try {
        inputs = await spineInputsFor(entry);
      } catch (e) {}
      if (!inputs) {
        core.note(`#${key} のSpineが見つかりません。ダウンロードを確認してください。`);
        return null;
      }
      try {
        return buildSkeleton(ctx, inputs);
      } catch (e) {
        core.note(`#${key} のSpineを組み立てられませんでした。`);
        return null;
      }
    },
    selected: () => selected,
    select(id) {
      selected = id ? String(id) : null;
    },
    destroy(rec) {
      try {
        rec.atlas.dispose();
      } catch (e) {}
    },
    defaultMotion: (rec) => idleAnim(rec.anims),
    apply(c, rec) {
      if (!c.vis) c.vis = {};
      rec.vis = c.vis;
      const pick = rec.anims.includes(c.motion) ? c.motion : idleAnim(rec.anims);
      if (!pick) return;
      if (rec.cur !== pick) {
        try {
          rec.entry = rec.state.setAnimation(0, pick, true);
          rec.cur = pick;
        } catch (e) {}
      }
      if (rec.entry) rec.entry.timeScale = c.paused ? 0 : c.speed > 0 ? c.speed : 1;
    },
    controlsFor(rec, entry) {
      if (!rec) return { motionLabel: '表情', motions: [], selects: [], sliders: SLIDERS };
      const isEx = !!(entry && entry.kind === 'ex');
      const have = rec.anims;
      const known = EXPRESSIONS.filter(([v]) => have.includes(v));
      const extra = have.filter((n) => !EXPRESSIONS.some(([v]) => v === n)).map((n) => [n, n]);
      const motions = isEx ? have.map((n) => [n, n]) : [...known, ...extra];
      return { motionLabel: isEx ? 'アニメ' : '表情', motions, selects: [], sliders: SLIDERS, vis: true };
    },
    visInfo(id) {
      const rec = core.live(id);
      if (!rec || !rec.skeleton) return null;
      return {
        groups: groupSlots((rec.skeleton.slots || []).map((s) => s.data.name)),
        alphaOf: (n) => (rec.vis[n] == null ? 1 : rec.vis[n]),
        set: (names, a) => {
          for (const n of names) {
            if (a === 1) delete rec.vis[n];
            else rec.vis[n] = a;
          }
        },
        resetAll: () => {
          for (const k of Object.keys(rec.vis)) delete rec.vis[k];
        },
      };
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
        const cv = await backgroundCanvas(f.rel);
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
