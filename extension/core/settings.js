const DEFS = {
  voiceMode: { key: 'storyVoiceMode', def: 'voice', values: ['voice', 'voice+tts', 'tts', 'off'] },
  show3d: { key: 'imgShow3d', def: true, type: 'bool' },
  showSpine: { key: 'imgShowSpine', def: true, type: 'bool' },
  imageFlipY: { key: 'imgFlipY', def: true, type: 'bool' },
  masterVolume: { key: 'masterVolume', def: 0.5, type: 'num', min: 0, max: 1.5, scale: 100 },
  motionVoice: { key: 'motionVoice', def: true, type: 'bool' },
  homeBgmVolume: { key: 'homeBgmVolume', def: 0.7, type: 'num', min: 0, max: 1.5, scale: 100 },
  homeBgmMode: { key: 'homeBgmMode', def: 'repeat', values: ['repeat', 'sequence', 'shuffle'] },
  homeBgmPlaying: { key: 'homeBgmPlaying', def: true, type: 'bool' },
  homeBgmPriority: { key: 'homeBgmPriority', def: false, type: 'bool' },
  playerName: { key: 'storyPlayerName', def: '', type: 'text', max: 16 },
};

const state = {};
const subs = new Set();
let loaded = null;

const coerce = (d, v) => {
  if (v == null) return d.def;
  if (d.type === 'bool') return !!v;
  if (d.type === 'num') {
    const n = Number(v);
    if (!Number.isFinite(n)) return d.def;
    return Math.min(d.max ?? n, Math.max(d.min ?? n, n));
  }
  if (d.type === 'text') {
    const s = String(v).trim();
    return d.max ? s.slice(0, d.max) : s;
  }
  if (d.values && !d.values.includes(v)) return d.def;
  return v;
};

function notify(name) {
  for (const fn of subs) {
    try {
      fn(name, state[name]);
    } catch (e) {
      console.error('[tp] settings subscriber failed', name, e);
    }
  }
}

async function load() {
  if (loaded) return loaded;
  loaded = (async () => {
    for (const [n, d] of Object.entries(DEFS)) state[n] = d.def;
    try {
      const o = await chrome.storage.local.get(Object.values(DEFS).map((d) => d.key));
      for (const [n, d] of Object.entries(DEFS)) state[n] = coerce(d, o[d.key]);
    } catch (e) {}
    return state;
  })();
  return loaded;
}

const get = (name) => (name in state ? state[name] : DEFS[name] && DEFS[name].def);

function set(name, value) {
  const d = DEFS[name];
  if (!d) return;
  const v = coerce(d, value);
  if (state[name] === v) return;
  state[name] = v;
  try {
    chrome.storage.local.set({ [d.key]: v });
  } catch (e) {}
  notify(name);
}

function bind(el, name) {
  const d = DEFS[name];
  if (!el || !d || el._tpSetting) return;
  el._tpSetting = name;
  const isCheck = el.type === 'checkbox';
  const read = () => (isCheck ? el.checked : d.scale ? (Number(el.value) || 0) / d.scale : el.value);
  const write = (v) => {
    if (isCheck) el.checked = !!v;
    else el.value = String(d.scale ? Math.round(v * d.scale) : v);
  };
  el.addEventListener('change', () => set(name, read()));
  if (d.type === 'num') el.addEventListener('input', () => set(name, read()));
  write(get(name));
  subs.add((n) => {
    if (n === name && String(read()) !== String(get(name))) write(get(name));
  });
}

export const settings = {
  load,
  get,
  set,
  bind,
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
};
