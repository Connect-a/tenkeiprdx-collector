import { utilHelpers } from '../core/util.js';
import { SK } from '../core/constants.js';
import { routeFor, routeUrl } from '../core/asset-route.js';
import { CFG } from '../config.js';
const sleep = utilHelpers.sleep;
const bytesToB64 = utilHelpers.bytesToB64;

async function assetRoot() {
  const o = await chrome.storage.local.get([SK.assetRootManual, SK.assetRootEnv, SK.assetRoot]);
  return (o[SK.assetRootManual] || o[SK.assetRootEnv] || o[SK.assetRoot] || CFG.assetRootDefault || '').replace(/\/+$/, '');
}
async function assetRootAuto() {
  const o = await chrome.storage.local.get([SK.assetRootEnv, SK.assetRoot]);
  return (o[SK.assetRootEnv] || o[SK.assetRoot] || CFG.assetRootDefault || '').replace(/\/+$/, '');
}

const RETRY_DELAYS = [5000, 15000];
async function fetchUrl(url, take) {
  let saw404 = false,
    sawError = false;
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
    if (round < RETRY_DELAYS.length) await sleep(RETRY_DELAYS[round]);
  }
  return saw404 && !sawError ? { status: 'missing' } : { status: 'error', retriable: sawError };
}

const toBytes = async (res) => new Uint8Array(await res.arrayBuffer());
async function fetchBytes(url) {
  const r = await fetchUrl(url, toBytes);
  return r.status === 'ok' ? { status: 'ok', bytes: r.value } : r;
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
  return { status: sawMissing ? 'missing' : 'error', platform: last && last.platform, rel: last && last.rel };
}

async function fetchBytesRaw(url) {
  const r = await fetchBytes(url);
  if (r.status === 'ok') return r.bytes;
  return null;
}

async function apiFetchBytes(url, method, { withStatus } = {}) {
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
    const r = await fetch(url, { method: method || 'GET', headers, credentials: 'include', cache: 'no-store' });
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
    return withStatus ? { status: r.status, ok: true, base64: bytesToB64(buf) } : buf;
  } catch (e) {
    if (e && e.auth) throw e;
    return null;
  }
}

export const networkClient = { fetchAsset, assetRoot, assetRootAuto, fetchBytes, fetchBytesRaw, apiFetchBytes };
