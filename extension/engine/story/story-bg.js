import { unityMesh } from '../../unity/mesh.js';
import { ensureIndexes } from '../../data/index-store.js';
import { scenarioUi } from './scenario-ui.js';

export function createStoryBg({ readBundle, getEp, getGen }) {
  const cache = new Map();

  const decodeCanvas = (bytes) => {
    try {
      return unityMesh.decodeLargestTextureCanvas(bytes);
    } catch (e) {
      return null;
    }
  };

  async function canvasFor(bgId) {
    if (!bgId) return null;
    let cv = cache.get(bgId);
    if (cv) return cv;
    const ep = getEp() || {};
    const path = (ep.bg && ep.bg[bgId]) || null;
    if (path) {
      const b = await readBundle(path);
      if (b) {
        try {
          cv = decodeCanvas(b);
        } catch (e) {}
      }
    }
    if (!cv) {
      try {
        const rel = ((await ensureIndexes()).assets.sceneAssetIndex || {})[bgId];
        if (rel) {
          const pack = await scenarioUi.loadPack(rel);
          const sp = pack && (pack.get(bgId) || Object.values(pack.sprites || {})[0]);
          if (sp && sp.canvas) cv = sp.canvas;
        }
      } catch (e) {}
    }
    if (cv) cache.set(bgId, cv);
    return cv;
  }

  function elementFor(cv, bgId) {
    let el;
    if (cv instanceof HTMLCanvasElement) {
      el = document.createElement('canvas');
      el.width = cv.width;
      el.height = cv.height;
      try {
        el.getContext('2d').drawImage(cv, 0, 0);
      } catch (e) {}
    } else {
      el = document.createElement('div');
      el.textContent = bgId;
      el.style.background = '#000';
    }
    el.style.position = 'absolute';
    el.style.left = el.style.top = '0';
    el.style.width = el.style.height = '100%';
    return el;
  }

  async function crossfade(bgHost, bgId, flip, fadeMs, gen, instant) {
    const cv = await canvasFor(bgId);
    if (gen !== getGen()) return;
    const el = elementFor(cv, bgId);
    el.style.transform = flip ? 'scaleX(-1)' : '';
    if (getComputedStyle(bgHost).position === 'static') bgHost.style.position = 'relative';
    const dur = instant ? 0 : Number(fadeMs) > 0 ? Number(fadeMs) : 500;
    if (!bgHost.children.length || dur <= 0) {
      el.style.opacity = '1';
      el.style.transition = '';
      bgHost.innerHTML = '';
      bgHost.appendChild(el);
      return;
    }
    el.style.opacity = '0';
    el.style.transition = `opacity ${dur}ms linear`;
    bgHost.appendChild(el);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    el.style.opacity = '1';
    await new Promise((r) => setTimeout(r, dur));
    if (gen !== getGen()) {
      el.remove();
      return;
    }
    for (const c of [...bgHost.children]) if (c !== el) c.remove();
  }

  return { crossfade, clearCache: () => cache.clear() };
}
