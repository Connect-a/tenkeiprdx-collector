import { SHARED_FILE } from '../core/assetpath/placement.js';
import { unityDecode } from '../unity/decode.js';
import { DIRS } from '../core/dirs.js';
import { fileStore } from '../core/fsdir.js';
import { num } from '../core/bytes.js';
const { decodeUserBytes } = unityDecode;

const errText = (e) => (e && e.message ? e.message : String(e));

let _userState = null;
async function parseUserState() {
  if (_userState) return _userState;
  const state = { levels: new Map(), paidUnlocked: new Set(), clearedNodes: new Set(), openEpisodes: new Set(), loaded: false, error: null };
  let bytes = null;
  let tried = '';
  try {
    const d = await fileStore.getDir(DIRS.master, { create: false });
    const f = d && (await fileStore.readUnder(d, SHARED_FILE.user));
    if (f) bytes = new Uint8Array(await f.arrayBuffer());
  } catch (e) {
    tried = errText(e);
  }
  if (!bytes) {
    state.error = { reason: 'missing', message: 'user.bin が見つかりません', detail: tried };
    return state;
  }
  try {
    (function walk(x, depth) {
      if (depth > 4 || !Array.isArray(x)) return;
      if (x.length >= 2 && (typeof x[0] === 'number' || typeof x[0] === 'bigint') && Array.isArray(x[1])) {
        const tag = num(x[0]);
        if (tag === 3) state.levels.set(String(num(x[1][1])), num(x[1][2]) || 0);
        else if (tag === 146) state.paidUnlocked.add(String(num(x[1][1])));
        else if (tag === 22) state.clearedNodes.add(String(num(x[1][1])));
        else if (tag === 34) state.openEpisodes.add(String(num(x[1][1])));
      }
      for (const e of x) walk(e, depth + 1);
    })(decodeUserBytes(bytes), 0);
  } catch (e) {
    state.error = { reason: 'parse', message: errText(e), detail: `bytes=${bytes.length}` };
    return state;
  }
  if (!state.levels.size) {
    state.error = { reason: 'empty', message: '所持キャラの情報が取り出せませんでした', detail: `bytes=${bytes.length}` };
    return state;
  }
  state.loaded = true;
  _userState = state;
  return state;
}
async function ownedLevels() {
  return (await parseUserState()).levels;
}
async function unlockedPaidSet() {
  return (await parseUserState()).paidUnlocked;
}
async function clearedNodeSet() {
  return (await parseUserState()).clearedNodes;
}
async function openEpisodeSet() {
  return (await parseUserState()).openEpisodes;
}
async function userLoaded() {
  return (await parseUserState()).loaded;
}
export const userStateService = { ownedLevels, unlockedPaidSet, clearedNodeSet, openEpisodeSet, userLoaded };
