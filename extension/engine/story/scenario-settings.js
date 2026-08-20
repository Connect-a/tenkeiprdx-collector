import { SK } from '../../core/constants.js';

const VOL_MAX = 10;
const WINDOW_ALPHA = [1, 0.5, 0];
const TEXT_MS = [25, 12, 0];
const DEFAULTS = { bgm: 7, se: 10, voice: 10, alpha: 0, speed: 0, voiceContinue: 0 };

const clampInt = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
const normalize = (o) => ({
  bgm: clampInt(o.bgm != null ? o.bgm : DEFAULTS.bgm, VOL_MAX),
  se: clampInt(o.se != null ? o.se : DEFAULTS.se, VOL_MAX),
  voice: clampInt(o.voice != null ? o.voice : DEFAULTS.voice, VOL_MAX),
  alpha: clampInt(o.alpha, WINDOW_ALPHA.length - 1),
  speed: clampInt(o.speed, TEXT_MS.length - 1),
  voiceContinue: clampInt(o.voiceContinue, 1),
});

let state = normalize(DEFAULTS);
let loaded = false;
const subs = new Set();
const notify = () => {
  for (const fn of [...subs]) {
    try {
      fn(state);
    } catch (e) {}
  }
};

function percentGain(pct) {
  if (pct <= 0) return 0;
  if (pct >= 100) return 1;
  return Math.pow(10, (80 * Math.pow(pct / 100, 0.125) - 80) / 20);
}

async function load() {
  if (loaded) return state;
  loaded = true;
  try {
    const o = await chrome.storage.local.get(SK.scenarioSettings);
    const v = o && o[SK.scenarioSettings];
    if (v) state = normalize(v);
  } catch (e) {}
  notify();
  return state;
}

function apply(patch) {
  state = normalize({ ...state, ...(patch || {}) });
  notify();
  return state;
}

async function save() {
  try {
    await chrome.storage.local.set({ [SK.scenarioSettings]: state });
  } catch (e) {}
}

export const scenarioSettings = {
  DEFAULTS,
  VOL_MAX,
  WINDOW_ALPHA,
  TEXT_MS,
  load,
  apply,
  save,
  get: () => state,
  defaults: () => ({ ...DEFAULTS }),
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
  percentGain,
  channelGain: (level) => percentGain(clampInt(level, VOL_MAX) * 10),
  volumeOf: (ch) => percentGain(clampInt(state[ch], VOL_MAX) * 10),
  textMs: () => TEXT_MS[state.speed] || 0,
  windowAlpha: () => WINDOW_ALPHA[state.alpha],
  outlineFont: () => state.alpha === WINDOW_ALPHA.length - 1,
  voiceContinues: () => state.voiceContinue === 0,
};
