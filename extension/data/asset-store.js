import { fileStore } from '../core/fsdir.js';
import { relKey } from '../core/paths.js';
import { platformsFor } from '../core/asset-route.js';
import { subFor, dirOfPrefix, fileHead } from '../core/placement.js';
import { networkClient } from './network.js';
import { ensureIndexes } from './index-store.js';

const idOf = relKey;
const dirOf = (d, create) => (typeof d === 'string' ? fileStore.getDir(d, { create: !!create }) : Promise.resolve(d));

async function altRelMap() {
  try {
    return (await ensureIndexes()).assets.altRel || {};
  } catch (e) {
    return {};
  }
}

const diskPaths = (rel, place) => platformsFor(rel).map((platform) => ({ platform, path: subFor(place, rel, platform) }));

export async function locate(dir, rel, place) {
  const d = await dirOf(dir, false);
  if (!d) return null;
  for (const c of diskPaths(rel, place)) if (await fileStore.exists(d, c.path)) return c.path;
  return null;
}

export async function readAsset(dir, rel, place) {
  const d = await dirOf(dir, false);
  if (!d) return null;
  const p = await locate(d, rel, place);
  if (!p) return null;
  const f = await fileStore.readUnder(d, p);
  return f ? new Uint8Array(await f.arrayBuffer()) : null;
}

export async function hasAsset(dir, rel, place) {
  return !!(await locate(dir, rel, place));
}

export async function presentIds(dir, items) {
  const have = new Map();
  const d = await dirOf(dir, false);
  if (!d) return have;
  const rows = [];
  const byDir = new Map();
  for (const it of items) {
    const rel = it.rel || it;
    const row = { id: idOf(rel), path: null };
    rows.push(row);
    for (const c of diskPaths(rel, it.place)) {
      const key = dirOfPrefix(c.path);
      if (!byDir.has(key)) byDir.set(key, []);
      byDir.get(key).push({ row, name: fileHead(c.path), path: c.path });
    }
  }
  for (const [sub, list] of byDir) {
    const names = new Set(await fileStore.listUnder(d, sub));
    for (const x of list) if (!x.row.path && names.has(x.name)) x.row.path = x.path;
  }
  const short = new Set();
  for (const r of rows) if (!r.path) short.add(r.id);
  for (const r of rows) if (r.path && !short.has(r.id) && !have.has(r.id)) have.set(r.id, r.path);
  return have;
}

let _dirSeq = 0;
const _dirIds = new WeakMap();
const dirKeyOf = (d) => {
  if (typeof d === 'string') return d;
  if (!d) return '?';
  let k = _dirIds.get(d);
  if (!k) {
    k = 'h' + ++_dirSeq;
    _dirIds.set(d, k);
  }
  return k;
};
const _inflight = new Map();

export async function acquireAsset(dir, rel, opts) {
  const o = opts || {};
  const id = idOf(rel);
  if (!o.overwrite) {
    const p = await locate(dir, rel, o.place);
    if (p) return { status: 'skip', path: p, id };
  }
  const cands = diskPaths(rel, o.place);
  const key = dirKeyOf(dir) + '\u0000' + ((cands[0] && cands[0].path) || id);
  const running = _inflight.get(key);
  if (running) return running;
  const job = (async () => {
    const alt = await altRelMap();
    const base = o.base || (await networkClient.assetRoot());
    const d = await dirOf(dir, true);
    if (!d) return { status: 'fail', id };
    const toFile = (res, cand) => fileStore.saveStream(d, subFor(o.place, rel, cand.platform), res.body);
    const r = await networkClient.fetchAsset(base, rel, alt[id], toFile);
    if (r.status !== 'ok') return { status: r.status === 'missing' ? 'missing' : 'fail', id, retriable: r.status !== 'missing' };
    return { status: 'got', path: r.value, id };
  })();
  _inflight.set(key, job);
  try {
    return await job;
  } finally {
    _inflight.delete(key);
  }
}

export async function removeAsset(dir, rel, place) {
  const d = await dirOf(dir, false);
  if (!d) return;
  for (const c of diskPaths(rel, place)) await fileStore.removeUnder(d, c.path);
}

export const assetStore = { locate, readAsset, hasAsset, presentIds, acquireAsset, removeAsset, idOf };
