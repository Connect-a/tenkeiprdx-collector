const DEFS = {
  voiceMode: { key: 'voiceMode', def: 'voice', values: ['voice', 'voice+tts', 'tts', 'off'] },
  show3d: { key: 'show3d', def: true, type: 'bool' },
  showSpine: { key: 'showSpine', def: true, type: 'bool' },
  imageFlipY: { key: 'imageFlipY', def: true, type: 'bool' },
  masterVolume: { key: 'masterVolume', def: 0.5, type: 'num', min: 0, max: 1.5, scale: 100 },
  motionVoice: { key: 'motionVoice', def: true, type: 'bool' },
  homeBgmVolume: { key: 'homeBgmVolume', def: 0.7, type: 'num', min: 0, max: 1.5, scale: 100 },
  homeBgmMode: { key: 'homeBgmMode', def: 'repeat', values: ['repeat', 'sequence', 'shuffle'] },
  homeBgmPlaying: { key: 'homeBgmPlaying', def: true, type: 'bool' },
  homeBgmPriority: { key: 'homeBgmPriority', def: false, type: 'bool' },
  playerName: { key: 'playerName', def: '', type: 'text', max: 16, store: 'file' },
  letterName: { key: 'letterName', def: '', type: 'text', max: 40, store: 'file' },
  letterEmail: { key: 'letterEmail', def: '', type: 'text', max: 120, store: 'file' },
  storyMosaic: { key: 'storyMosaic', def: false, type: 'bool' },
  stillGroupMale: { key: 'stillGroupMale', def: 1, type: 'num', min: 0, max: 1 },
  stillGroupPenis: { key: 'stillGroupPenis', def: 1, type: 'num', min: 0, max: 1 },
  stillGroupHand: { key: 'stillGroupHand', def: 1, type: 'num', min: 0, max: 1 },
  stillGroupFemale: { key: 'stillGroupFemale', def: 1, type: 'num', min: 0, max: 1 },
  stillGroupBg: { key: 'stillGroupBg', def: 1, type: 'num', min: 0, max: 1 },
  stillGroupOther: { key: 'stillGroupOther', def: 1, type: 'num', min: 0, max: 1 },
  stillBackImgHidden: { key: 'stillBackImgHidden', def: false, type: 'bool' },
  sidebarCollapsed: { key: 'sidebarCollapsed', def: false, type: 'bool' },
  rosterOwn: { key: 'rosterOwn', def: 'all', values: ['all', 'owned', 'unowned'] },
  rosterGroup: { key: 'rosterGroup', def: '', type: 'text', max: 24 },
  rosterRank: { key: 'rosterRank', def: '', type: 'text', max: 8 },
  rosterSearch: { key: 'rosterSearch', def: '', type: 'text', max: 40 },
  rosterSort: { key: 'rosterSort', def: 'name', values: ['name', 'id', 'b', 'w', 'h'] },
  rosterSortAsc: { key: 'rosterSortAsc', def: true, type: 'bool' },
  rosterXpos: { key: 'rosterXpos', def: 0, type: 'num', min: 0, max: 131071 },
  exMode: { key: 'exMode', def: false, type: 'bool' },
  exFavOnly: { key: 'exFavOnly', def: false, type: 'bool' },
  exThumbCache: { key: 'exThumbCache', def: false, type: 'bool' },
};

import { saveData } from './savedata.js';

const state = {};
const isFile = (d) => d.store === 'file';
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
    const entries = Object.entries(DEFS);
    try {
      const o = await chrome.storage.local.get(entries.filter(([, d]) => !isFile(d)).map(([, d]) => d.key));
      for (const [n, d] of entries) if (!isFile(d)) state[n] = coerce(d, o[d.key]);
    } catch (e) {}
    await loadFilePrefs();
    return state;
  })();
  return loaded;
}

async function loadFilePrefs() {
  try {
    const o = await saveData.loadPrefs();
    for (const [n, d] of Object.entries(DEFS)) if (isFile(d)) state[n] = coerce(d, o[d.key]);
  } catch (e) {}
  for (const [n, d] of Object.entries(DEFS)) if (isFile(d)) notify(n);
  return state;
}

const get = (name) => (name in state ? state[name] : DEFS[name] && DEFS[name].def);

function set(name, value) {
  const d = DEFS[name];
  if (!d) return;
  const v = coerce(d, value);
  if (state[name] === v) return;
  state[name] = v;
  try {
    if (isFile(d)) saveData.savePrefs({ [d.key]: v });
    else chrome.storage.local.set({ [d.key]: v });
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
  loadFilePrefs,
  get,
  set,
  bind,
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
};
