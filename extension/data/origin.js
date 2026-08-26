import { SK } from '../core/constants.js';
import { CFG } from '../config.js';

const trim = (s) => String(s || '').replace(/\/+$/, '');
const ASSETS_RE = /https:\/\/[a-z0-9.-]+\/production\/production\d+-[0-9a-f-]{36}(?=\/Assets\/)/i;
const STATICS_RE = /https:\/\/[a-z0-9.-]+\/production\/[0-9a-f-]{36}-statics(?=\/)/i;

export function parseOrigin(text) {
  const s = String(text || '');
  const a = s.match(ASSETS_RE);
  const st = s.match(STATICS_RE);
  return { assets: a ? trim(a[0]) : null, statics: st ? trim(st[0]) : null };
}

export async function resolveOrigin({ ignoreManual } = {}) {
  let o = {};
  try {
    o = await chrome.storage.local.get([SK.originManual, SK.origin]);
  } catch (e) {}
  const saved = o[SK.origin] || {};
  const manual = ignoreManual ? '' : trim(o[SK.originManual]);
  return {
    assets: manual || trim(saved.assets) || trim(CFG.assetRootDefault),
    statics: trim(saved.statics) || trim(CFG.staticsRootDefault) || null,
    manual: manual || null,
    from: manual ? 'manual' : saved.assets ? saved.from || 'saved' : 'default',
  };
}

async function savedOrigin() {
  try {
    return (await chrome.storage.local.get(SK.origin))[SK.origin] || {};
  } catch (e) {
    return {};
  }
}

export async function saveOrigin(next, from) {
  const cur = (await resolveOrigin({ ignoreManual: true })) || {};
  const prev = await savedOrigin();
  const assets = trim(next && next.assets) || cur.assets || null;
  const statics = trim(next && next.statics) || cur.statics || null;
  if (!assets && !statics) return null;
  const alive = Array.isArray(next && next.alive) ? next.alive : prev.alive || null;
  const aliveAt = Array.isArray(next && next.alive) ? Date.now() : prev.aliveAt || 0;
  const value = { assets, statics, from: from || 'env', at: Date.now() };
  if (alive) {
    value.alive = alive;
    value.aliveAt = aliveAt;
  }
  try {
    await chrome.storage.local.set({ [SK.origin]: value });
  } catch (e) {}
  return value;
}

const GEN_RE = /^(https:\/\/[a-z0-9.-]+\/production\/production)(\d+)(-[0-9a-f-]{36})$/i;
const PROBE_SUB = '/Assets/WebGL/base_catalog.json';
const GEN_MAX = 9;
const NET_ERR_STOP = 3;

const ALIVE_TTL_MS = 7 * 24 * 3600 * 1000;

async function headGeneration(base) {
  try {
    const r = await fetch(base + PROBE_SUB, { method: 'HEAD' });
    return r.ok ? Date.parse(r.headers.get('last-modified') || '') || 1 : 0;
  } catch (e) {
    return -1;
  }
}

async function sweepGenerations(base) {
  const m = GEN_RE.exec(trim(base));
  if (!m) return null;
  const found = [];
  let netErr = 0;
  for (let n = 0; n <= GEN_MAX && netErr < NET_ERR_STOP; n++) {
    const at = await headGeneration(`${m[1]}${n}${m[3]}`);
    if (at < 0) netErr++;
    else if (at > 0) found.push({ base: `${m[1]}${n}${m[3]}`, at });
  }
  if (!found.length) return null;
  found.sort((a, b) => b.at - a.at);
  return found.map((f) => f.base);
}

let aliveChecked = false;
export async function ensureOriginAlive() {
  if (aliveChecked) return null;
  aliveChecked = true;
  const cur = await resolveOrigin({ ignoreManual: true });
  if (!cur.assets) return null;
  const prev = await savedOrigin();
  const listed = Array.isArray(prev.alive) && prev.alive.length;
  if (listed && prev.alive.indexOf(cur.assets) >= 0 && Date.now() - (prev.aliveAt || 0) < ALIVE_TTL_MS) return null;
  const alive = await sweepGenerations(cur.assets);
  if (!alive) return null;
  const keep = alive.indexOf(cur.assets) >= 0;
  const next = keep ? cur.assets : alive[0];
  await saveOrigin({ assets: next, alive }, keep ? prev.from || 'saved' : 'sweep');
  return keep ? null : next;
}

export async function recoverOrigin() {
  const cur = await resolveOrigin({ ignoreManual: true });
  if (!cur.assets) return null;
  const at = await headGeneration(cur.assets);
  if (at !== 0) return null;
  const alive = await sweepGenerations(cur.assets);
  if (!alive || alive[0] === cur.assets) return null;
  await saveOrigin({ assets: alive[0], alive }, 'sweep');
  return alive[0];
}

export async function fallbackBases(base) {
  const prev = await savedOrigin();
  const alive = Array.isArray(prev.alive) ? prev.alive : [];
  return alive.filter((b) => b && b !== trim(base));
}

export async function setManualOrigin(url) {
  try {
    if (url) await chrome.storage.local.set({ [SK.originManual]: trim(url) });
    else await chrome.storage.local.remove(SK.originManual);
  } catch (e) {}
}
