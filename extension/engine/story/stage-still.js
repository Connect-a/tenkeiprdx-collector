import { createStillCompositor } from './still-compositor.js';
import { visFactors, withSlotAlphas } from './slot-alpha.js';

const MOSAIC_RE = /mosaic/i;

export function createStillScene({ gl, canvas, renderer, drawSkeleton, setAnim, onStill }) {
  let rec = null;
  let speed = 1;
  let visAlpha = null;
  let semi = false;
  let clean = false;
  let compositor = null;
  let alphaCache = { sk: null, gen: -1, alphas: null };
  let visGen = 0;

  const slotAlphas = (sk) => {
    if (alphaCache.sk !== sk || alphaCache.gen !== visGen) alphaCache = { sk, gen: visGen, alphas: visFactors(sk, visAlpha) };
    return alphaCache.alphas;
  };
  let emittedRec;
  const emit = () => {
    if (rec === emittedRec) return;
    emittedRec = rec;
    onStill(rec ? rec.skeleton.slots.map((s) => s.data.name) : null);
  };

  function runs() {
    const sk = rec.skeleton;
    const order = sk.drawOrder || sk.slots;
    const alphas = slotAlphas(sk);
    const split = [];
    let group = null;
    let cur = null;
    for (let i = 0; i < order.length; i++) {
      const idx = order[i].data.index;
      if (rec.slotGroups[idx] !== group) {
        group = rec.slotGroups[idx];
        cur = null;
      }
      if (alphas[idx] <= 0) continue;
      if (!cur) {
        cur = { from: i, to: i, maxA: 0, direct: false };
        split.push(cur);
      }
      cur.to = i;
      if (alphas[idx] > cur.maxA) cur.maxA = alphas[idx];
    }
    const merged = [];
    for (const r of split) {
      r.direct = r.maxA >= 1;
      const last = merged[merged.length - 1];
      if (r.direct && last && last.direct) last.to = r.to;
      else merged.push(r);
    }
    return merged;
  }

  function drawRun(run) {
    const sk = rec.skeleton;
    const order = sk.drawOrder || sk.slots;
    const alphas = slotAlphas(sk);
    const mask = new Array(sk.slots.length).fill(0);
    for (let i = run.from; i <= run.to; i++) {
      const idx = order[i].data.index;
      mask[idx] = alphas[idx] / run.maxA;
    }
    withSlotAlphas(sk, mask, () => drawSkeleton(sk));
  }

  function renderClean() {
    if (!compositor) compositor = createStillCompositor(gl);
    if (!compositor.ensure(canvas.width, canvas.height)) return false;
    compositor.beginAccum();
    for (const run of runs()) {
      if (run.direct) compositor.bindAccum();
      else compositor.bindTemp();
      renderer.begin();
      drawRun(run);
      renderer.end();
      if (!run.direct) compositor.overAccum(run.maxA);
    }
    compositor.toCanvas();
    return true;
  }

  return {
    skeletons: () => (rec ? [rec] : []),
    cameraBounds: () => (rec ? rec.bounds : null),
    step(dt) {
      if (!rec) return;
      rec.state.update(dt * speed);
      rec.state.apply(rec.skeleton);
      rec.skeleton.x = 0;
      rec.skeleton.y = 0;
      rec.skeleton.scaleX = 1;
      rec.skeleton.scaleY = 1;
      rec.skeleton.color.set(1, 1, 1, 1);
      rec.skeleton.updateWorldTransform();
    },
    render({ mosaicActive }) {
      if (!rec) return;
      if (clean && semi && !mosaicActive && renderClean()) return;
      renderer.begin();
      if (visAlpha) withSlotAlphas(rec.skeleton, slotAlphas(rec.skeleton), () => drawSkeleton(rec.skeleton));
      else drawSkeleton(rec.skeleton);
      renderer.end();
    },
    renderMosaic() {
      if (!rec) return;
      const sk = rec.skeleton;
      const alphas = visAlpha ? slotAlphas(sk) : null;
      const mask = sk.slots.map((s, i) => (MOSAIC_RE.test(s.data.name) ? (alphas ? alphas[i] : 1) : 0));
      renderer.begin();
      withSlotAlphas(sk, mask, () => drawSkeleton(sk));
      renderer.end();
    },
    show(nextRec, animName, timeScale) {
      rec = nextRec;
      if (!rec) {
        emit();
        return false;
      }
      rec.skeleton.setToSetupPose();
      setAnim(rec, animName, true, timeScale);
      emit();
      return true;
    },
    clear() {
      rec = null;
      emit();
    },
    setVisibility(map) {
      const entries = map ? Object.entries(map).filter(([, v]) => v !== 1) : [];
      visAlpha = entries.length ? new Map(entries) : null;
      semi = entries.some(([, v]) => v > 0 && v < 1);
      visGen++;
    },
    setClean(v) {
      clean = !!v;
    },
    setSpeed(v) {
      speed = v >= 0 ? v : 1;
    },
    dispose() {
      if (compositor) compositor.dispose();
      compositor = null;
    },
  };
}
