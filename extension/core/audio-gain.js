const MAX_GAIN = 1.5;

let ctx = null;
const gains = new WeakMap();

const clampVol = (v) => Math.max(0, Math.min(MAX_GAIN, Number(v) || 0));

function gainFor(el) {
  if (gains.has(el)) return gains.get(el);
  let node = null;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!ctx) ctx = new AC();
    if (ctx.state !== 'running') {
      ctx.resume().catch(() => {});
      return null;
    }
    node = ctx.createGain();
    ctx.createMediaElementSource(el).connect(node);
    node.connect(ctx.destination);
  } catch (e) {
    node = null;
  }
  gains.set(el, node);
  return node;
}

function setVolume(el, v) {
  if (!el) return;
  const vol = clampVol(v);
  el.volume = Math.min(1, vol);
  if (vol <= 1 && !gains.has(el)) return;
  const node = gainFor(el);
  if (!node) return;
  node.gain.value = vol <= 1 ? 1 : vol;
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

export const audioOut = { clampVol, setVolume };
