import { SK } from '../core/storage-keys.js';
import { routeFor, routeUrl } from '../core/assetpath/route.js';
import { resolveOrigin, fallbackBases } from './origin.js';
import { bgSleep, bgTimeout } from '../core/bgtimer.js';
const sleep = bgSleep;

const assetRoot = async () => (await resolveOrigin()).assets;
const assetRootAuto = async () => (await resolveOrigin({ ignoreManual: true })).assets;

const RETRY_DELAYS = [5000, 15000];
const API_TIMEOUT_MS = 60000;
const DIST_TIMEOUT_MS = 20000;
const OFFLINE_POLL_MS = 3000;
const OFFLINE_MAX_MS = 1800000;
const offlineSubs = new Set();
let offlineGate = null;
const isOffline = () => globalThis.navigator && navigator.onLine === false;
const notifyOffline = (on) => {
  for (const fn of [...offlineSubs]) {
    try {
      fn(on);
    } catch (e) {}
  }
};

function waitOnline() {
  if (offlineGate) return offlineGate;
  offlineGate = new Promise((resolve) => {
    const started = Date.now();
    let cancelPoll = null;
    const done = (ok) => {
      if (cancelPoll) cancelPoll();
      globalThis.removeEventListener('online', onOnline);
      offlineGate = null;
      notifyOffline(false);
      resolve(ok);
    };
    const onOnline = () => done(true);
    globalThis.addEventListener('online', onOnline);
    const poll = () => {
      if (!isOffline()) return done(true);
      if (Date.now() - started >= OFFLINE_MAX_MS) return done(false);
      cancelPoll = bgTimeout(OFFLINE_POLL_MS, poll);
    };
    cancelPoll = bgTimeout(OFFLINE_POLL_MS, poll);
  });
  notifyOffline(true);
  return offlineGate;
}

async function waitIfOffline() {
  if (!isOffline()) return false;
  return await waitOnline();
}

const OFFLINE_WAITS_MAX = 2;
async function fetchUrl(url, take) {
  let saw404 = false,
    sawError = false,
    offlineWaits = 0;
  for (let round = 0; round <= RETRY_DELAYS.length; round++) {
    let retriable = false;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (res.ok) {
        try {
          return { status: 'ok', value: await take(res) };
        } catch (e2) {
          sawError = true;
          retriable = true;
        }
      } else if (res.status === 404) {
        saw404 = true;
      } else {
        sawError = true;
        retriable = true;
      }
    } catch (e) {
      sawError = true;
      retriable = true;
    }
    if (!retriable) break;
    if (offlineWaits < OFFLINE_WAITS_MAX && (await waitIfOffline())) {
      offlineWaits++;
      sawError = false;
      round--;
      continue;
    }
    if (round < RETRY_DELAYS.length) await sleep(RETRY_DELAYS[round]);
  }
  return saw404 && !sawError ? { status: 'missing' } : { status: 'error', retriable: sawError };
}

const toBytes = async (res) => new Uint8Array(await res.arrayBuffer());
async function fetchBytes(url) {
  const r = await fetchUrl(url, toBytes);
  return r.status === 'ok' ? { status: 'ok', bytes: r.value } : r;
}

const FALLBACK_GENS = 3;
const FALLBACK_GIVEUP = 20;
const fb = { hit: 0, tried: 0, streak: 0, off: false };

async function fetchFromOtherGenerations(base, cands, take) {
  if (fb.off) return null;
  const others = (await fallbackBases(base)).slice(0, FALLBACK_GENS);
  for (const b of others) {
    for (const c of cands) {
      const r = await fetchUrl(routeUrl(b, c), (res) => (take || toBytes)(res, c));
      if (r.status === 'ok') {
        fb.hit++;
        fb.streak = 0;
        return { ...r, platform: c.platform, rel: c.rel, viaBase: b };
      }
      if (r.status === 'error') break;
    }
  }
  fb.tried++;
  fb.streak++;
  if (fb.streak >= FALLBACK_GIVEUP) fb.off = true;
  return null;
}

async function fetchAsset(base, rel, altRel, take) {
  const cands = routeFor(rel, altRel);
  let sawMissing = false;
  for (const c of cands) {
    const r = await fetchUrl(routeUrl(base, c), (res) => (take || toBytes)(res, c));
    if (r.status === 'ok') return { ...r, platform: c.platform, rel: c.rel };
    if (r.status === 'error') return { status: 'error', retriable: true, platform: c.platform, rel: c.rel };
    sawMissing = true;
  }
  const last = cands[cands.length - 1];
  if (sawMissing) {
    const alt = await fetchFromOtherGenerations(base, cands, take);
    if (alt) return alt;
  }
  return { status: sawMissing ? 'missing' : 'error', platform: last && last.platform, rel: last && last.rel };
}

const fallbackStats = () => ({ ...fb });

async function fetchBytesRaw(url) {
  const r = await fetchBytes(url);
  if (r.status === 'ok') return r.bytes;
  return null;
}

async function apiFetchBytes(url, method) {
  const st = await chrome.storage.local.get([SK.apiAuth, SK.apiAuthBad]);
  const auth = st[SK.apiAuth];
  const expired = auth && auth.exp && Math.floor(Date.now() / 1000) >= auth.exp;
  if (!auth || !auth.authorization || auth.authorization === st[SK.apiAuthBad] || expired) {
    const e = new Error('AUTH');
    e.auth = true;
    throw e;
  }
  const headers = { Accept: 'application/vnd.msgpack', Authorization: auth.authorization };
  for (const k of ['X-Platform', 'X-Device', 'x-client-version', 'x-masterdata-version']) if (auth[k]) headers[k] = auth[k];
  headers['X-Rating'] = 'r18';
  try {
    const r = await fetch(url, { method: method || 'GET', headers, credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(API_TIMEOUT_MS) });
    if (r.status === 401 || r.status === 403) {
      try {
        await chrome.storage.local.set({ [SK.apiAuthBad]: auth.authorization });
      } catch (e2) {}
      const e = new Error('AUTH');
      e.auth = true;
      throw e;
    }
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    return buf;
  } catch (e) {
    if (e && e.auth) throw e;
    return null;
  }
}

let distOff = false;
const resetDistGate = () => {
  distOff = false;
};
async function distFetchBytes(url) {
  if (distOff) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(DIST_TIMEOUT_MS) });
    if (res.status === 401 || res.status === 403) {
      distOff = true;
      return null;
    }
    if (!res.ok) return null;
    if (/json/i.test(res.headers.get('content-type') || '')) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    return null;
  }
}

const subscribeOffline = (fn) => {
  offlineSubs.add(fn);
  return () => offlineSubs.delete(fn);
};

export const networkClient = { fetchAsset, assetRoot, assetRootAuto, fetchBytes, fetchBytesRaw, apiFetchBytes, distFetchBytes, resetDistGate, fallbackStats, isOffline, subscribeOffline };
