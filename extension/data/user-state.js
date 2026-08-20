import { idbStore } from '../core/idb.js';
import { unityDecode } from '../unity/decode.js';
import { SK, DIRS } from '../core/constants.js';
import { networkClient } from './network.js';
import { fileStore } from '../core/fsdir.js';
import { utilHelpers } from '../core/util.js';
import { CFG } from '../config.js';
const { apiFetchBytes } = networkClient;
const { decodeUserBytes } = unityDecode;
const { b64ToBytes, num } = utilHelpers;

let _userState = null;
async function parseUserState() {
  if (_userState) return _userState;
  const state = { levels: new Map(), paidUnlocked: new Set(), clearedNodes: new Set(), loaded: false };
  let bytes = null;
  try {
    const b64 = await idbStore.get(SK.userRaw);
    if (b64) bytes = b64ToBytes(b64);
  } catch (e) {}
  if (!bytes) {
    try {
      const d = await fileStore.getDir(DIRS.master, { create: false });
      const f = d && (await fileStore.readUnder(d, 'user.bin'));
      if (f) bytes = new Uint8Array(await f.arrayBuffer());
    } catch (e) {}
  }
  if (!bytes) return state;
  try {
    (function walk(x, depth) {
      if (depth > 4 || !Array.isArray(x)) return;
      if (x.length >= 2 && (typeof x[0] === 'number' || typeof x[0] === 'bigint') && Array.isArray(x[1])) {
        const tag = num(x[0]);
        if (tag === 3) state.levels.set(String(num(x[1][1])), num(x[1][2]) || 0);
        else if (tag === 146) state.paidUnlocked.add(String(num(x[1][1])));
        else if (tag === 22) state.clearedNodes.add(String(num(x[1][1])));
      }
      for (const e of x) walk(e, depth + 1);
    })(decodeUserBytes(bytes), 0);
    state.loaded = true;
    _userState = state;
  } catch (e) {
    console.warn('[tp] userState の解析に失敗', e);
  }
  return state;
}
async function ownedLevels() {
  return (await parseUserState()).levels;
}
const unlockedCount = (level) => (CFG.storyUnlockLevels || []).reduce((n, req) => n + ((level || 0) >= req ? 1 : 0), 0);
async function unlockedPaidSet() {
  return (await parseUserState()).paidUnlocked;
}
async function clearedNodeSet() {
  return (await parseUserState()).clearedNodes;
}
async function userLoaded() {
  return (await parseUserState()).loaded;
}

async function refreshUserViaApi() {
  const authState = await chrome.storage.local.get(SK.apiAuth);
  const auth = authState[SK.apiAuth];
  if (!auth || !auth.authorization) return { ok: false, reason: 'no-token' };
  let r;
  try {
    r = await apiFetchBytes(CFG.apiBase + '/api/data/user', 'GET', { withStatus: true });
  } catch (e) {
    return { ok: false, reason: e && e.auth ? 'auth' : 'error' };
  }
  if (!r || !r.base64) return { ok: false, reason: 'fetch-failed' };
  await idbStore.set(SK.userRaw, r.base64);
  try {
    const d = await fileStore.getDir(DIRS.master, { create: true });
    if (d) await fileStore.writeUnder(d, 'user.bin', b64ToBytes(r.base64));
  } catch (e) {}
  _userState = null;
  return { ok: true, owned: (await ownedLevels()).size };
}

export const userStateService = { ownedLevels, unlockedCount, unlockedPaidSet, clearedNodeSet, userLoaded, refreshUserViaApi };
