import { sceneVfx } from '../render/scene-vfx.js';
import { vfxAssets } from './vfx-assets.js';
import { unityMesh as MESH_MOD } from '../../unity/mesh.js';

const VFX_DEFAULT_MS = {
  11: 1000,
  12: 1083,
  13: 1100,
  14: 1100,
  15: 600,
  16: 900,
  17: 1017,
  18: 1350,
};
const KNOWN_EFFECT_CODES = new Set([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
const SHAKE_STRENGTH = { 6: 12.5, 7: 25, 8: 50 };

function create(deps) {
  const els = deps.els || {};
  const readBundle = deps.readBundle;
  const getEp = deps.getEp || (() => null);

  function flash(fx, color, dur) {
    if (!fx) return;
    const half = dur / 2;
    fx.style.background = color;
    fx.style.transition = 'none';
    fx.style.opacity = '0';
    requestAnimationFrame(() => {
      fx.style.transition = 'opacity ' + half + 'ms ease-out';
      fx.style.opacity = '1';
      setTimeout(() => {
        fx.style.transition = 'opacity ' + half + 'ms ease-out';
        fx.style.opacity = '0';
      }, half);
    });
  }
  function shake(el, strengthRef, dur) {
    if (!el) return;
    const scale = (el.clientWidth || 1136) / 1136;
    el.classList.remove('fxShake');
    void el.offsetWidth;
    el.style.setProperty('--tps', (strengthRef * scale).toFixed(2) + 'px');
    el.style.setProperty('--tpsd', dur + 'ms');
    el.classList.add('fxShake');
    setTimeout(() => el.classList.remove('fxShake'), dur);
  }
  let lineRaf = 0;
  function concLine(dur, sizeParam) {
    const cv = els.lineLayer;
    if (!cv) return;
    if (lineRaf) cancelAnimationFrame(lineRaf);
    const W = (cv.width = 1136),
      H = (cv.height = 640);
    const ctx = cv.getContext('2d');
    const cx = W / 2,
      cy = H / 2,
      R = Math.hypot(cx, cy);
    const inner = R * (1 - Math.min(0.85, sizeParam / 100));
    const N = 140;
    const lines = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + (Math.random() - 0.5) * (Math.PI / N);
      lines.push({ a, w: 1 + Math.random() * 3, inR: inner * (0.9 + Math.random() * 0.25) });
    }
    const t0 = performance.now();
    const step = (t) => {
      const k = (t - t0) / dur;
      ctx.clearRect(0, 0, W, H);
      if (k >= 1) {
        lineRaf = 0;
        return;
      }
      const a = k < 0.3 ? k / 0.3 : 1 - (k - 0.3) / 0.7;
      ctx.strokeStyle = 'rgba(255,255,255,' + (Math.max(0, a) * 0.85).toFixed(3) + ')';
      for (const L of lines) {
        ctx.lineWidth = L.w;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(L.a) * L.inR, cy + Math.sin(L.a) * L.inR);
        ctx.lineTo(cx + Math.cos(L.a) * R * 1.05, cy + Math.sin(L.a) * R * 1.05);
        ctx.stroke();
      }
      lineRaf = requestAnimationFrame(step);
    };
    lineRaf = requestAnimationFrame(step);
  }
  function clearLines() {
    if (lineRaf) cancelAnimationFrame(lineRaf);
    lineRaf = 0;
    const cv = els.lineLayer;
    if (cv) cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
  }
  let eyeRaf = 0;
  function eyeCatch(dur) {
    const cv = els.eyeLayer;
    if (!cv) return;
    if (eyeRaf) cancelAnimationFrame(eyeRaf);
    const W = (cv.width = 1136),
      H = (cv.height = 640);
    const ctx = cv.getContext('2d');
    const cx = W / 2,
      cy = H / 2,
      R = Math.hypot(cx, cy) * 1.05;
    const N = 12,
      seg = (Math.PI * 2) / N;
    cv.style.opacity = '1';
    const t0 = performance.now();
    const step = (t) => {
      const k = (t - t0) / dur;
      ctx.clearRect(0, 0, W, H);
      if (k >= 1) {
        cv.style.opacity = '0';
        eyeRaf = 0;
        return;
      }
      const cov = k < 0.4 ? k / 0.4 : k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      const sweep = seg * Math.max(0, cov);
      const rot = k * Math.PI;
      ctx.fillStyle = '#0a0a12';
      for (let i = 0; i < N; i++) {
        const a0 = i * seg + rot;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, a0, a0 + sweep);
        ctx.closePath();
        ctx.fill();
      }
      eyeRaf = requestAnimationFrame(step);
    };
    eyeRaf = requestAnimationFrame(step);
  }
  function clearEye() {
    if (eyeRaf) cancelAnimationFrame(eyeRaf);
    eyeRaf = 0;
    const cv = els.eyeLayer;
    if (cv) {
      cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
      cv.style.opacity = '0';
    }
  }
  let vfxOverlay = null;
  function playVfx(code, dur, speed) {
    if (!els.vfxLayer) return;
    if (!vfxOverlay) vfxOverlay = sceneVfx.createOverlay(els.vfxLayer);
    const d = Number.isFinite(dur) && dur > 0 ? dur : VFX_DEFAULT_MS[code] || 700;
    vfxAssets
      .loadVfxByCode(code)
      .then((r) => {
        if (r && r.bytes && vfxOverlay) vfxOverlay.play(r.bytes, r.texByMatPid, Math.max(120, d), { speed: Number(speed) > 0 ? Number(speed) : 1 });
      })
      .catch(() => {});
  }
  let ambientOverlay = null,
    ambientKey = null;
  async function applyAmbient(key) {
    key = key || null;
    if (key === ambientKey) return;
    ambientKey = key;
    if (ambientOverlay) ambientOverlay.stop();
    if (!key) return;
    let res = null;
    try {
      res = await vfxAssets.loadVfxByKey(key);
    } catch (e) {}
    if (!res || !res.bytes || ambientKey !== key) return;
    if (!ambientOverlay) {
      if (!els.ambientLayer) return;
      ambientOverlay = sceneVfx.createOverlay(els.ambientLayer);
    }
    ambientOverlay.play(res.bytes, res.texByMatPid, Infinity, { loop: true });
  }
  async function applyInsert(ins) {
    const insertEl = els.insertEl;
    if (!insertEl) return;
    if (!ins) {
      insertEl.style.display = 'none';
      return;
    }
    const ep = getEp();
    const path = ep && ep.cg && (ep.cg[ins.img] || ep.cg[String(ins.img)]);
    let cv = null;
    if (path) {
      try {
        const b = await readBundle(path);
        cv = b && MESH_MOD.decodeLargestTextureCanvas(b);
      } catch (e) {}
    }
    if (!cv) {
      insertEl.style.display = 'none';
      return;
    }
    insertEl.src = cv.toDataURL();
    insertEl.style.left = (ins.x || 0) + 'px';
    insertEl.style.top = (ins.y || 0) + 'px';
    insertEl.style.display = '';
  }
  function clearVfx() {
    if (vfxOverlay) vfxOverlay.stop();
    if (ambientOverlay) ambientOverlay.stop();
    ambientKey = null;
    if (els.insertEl) els.insertEl.style.display = 'none';
  }
  let noiseRaf = 0,
    noiseLast = 0;
  function setNoise(on) {
    const cv = els.noiseLayer;
    if (!cv) return;
    if (on && !noiseRaf) {
      cv.style.opacity = '0.14';
      const ctx = cv.getContext('2d');
      const W = (cv.width = 160),
        H = (cv.height = 90);
      const draw = (t) => {
        noiseRaf = requestAnimationFrame(draw);
        if (t - noiseLast < 45) return;
        noiseLast = t;
        const img = ctx.createImageData(W, H);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          const v = (Math.random() * 255) | 0;
          d[i] = d[i + 1] = d[i + 2] = v;
          d[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      };
      noiseRaf = requestAnimationFrame(draw);
    } else if (!on && noiseRaf) {
      cancelAnimationFrame(noiseRaf);
      noiseRaf = 0;
      cv.style.opacity = '0';
    }
  }
  let lastFxIdx = -1;
  const unknownFxWarned = new Set();
  function playFrameEffect(fr, idx) {
    const shakeEl = els.shakeEl,
      fx = els.fxLayer;
    if (els.bandTop) els.bandTop.classList.toggle('show', !!fr.band);
    if (els.bandBottom) els.bandBottom.classList.toggle('show', !!fr.band);
    setNoise(!!fr.noise);
    if (shakeEl) shakeEl.classList.remove('fxShake');
    if (fx) {
      fx.style.transition = 'none';
      fx.style.opacity = '0';
    }
    if (lastFxIdx === idx) return;
    lastFxIdx = idx;
    for (const ef of fr.effects || []) {
      const dur = Math.max(120, ef.dur || (ef.code >= 6 && ef.code <= 8 ? 500 : 300));
      if (ef.code === 4) flash(fx, '#fff', dur);
      else if (ef.code === 5) flash(fx, '#ff0000', dur);
      else if (SHAKE_STRENGTH[ef.code]) shake(shakeEl, SHAKE_STRENGTH[ef.code], dur);
      else if (ef.code === 9) concLine(ef.dur || 1500, 50);
      else if (ef.code === 10) eyeCatch(ef.dur > 0 ? ef.dur : 2000);
      else if (ef.code >= 11 && ef.code <= 18) playVfx(ef.code, ef.dur);
      else if (!KNOWN_EFFECT_CODES.has(ef.code) && !unknownFxWarned.has(ef.code)) {
        unknownFxWarned.add(ef.code);
        console.warn('[tp] 未対応の演出コード', ef.code, 'frame=', fr && fr.i);
      }
    }
  }
  return {
    playFrameEffect,
    applyAmbient,
    applyInsert,
    clearVfx,
    clearLines,
    clearEye,
    setNoise,
    resetFxIdx: () => {
      lastFxIdx = -1;
    },
    dispose: () => {
      try {
        if (vfxOverlay && vfxOverlay.dispose) vfxOverlay.dispose();
      } catch (e) {}
      try {
        if (ambientOverlay && ambientOverlay.dispose) ambientOverlay.dispose();
      } catch (e) {}
      vfxOverlay = null;
      ambientOverlay = null;
    },
  };
}

export const sceneEffects = { create };
