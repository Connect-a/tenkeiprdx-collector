import { fileStore } from '../core/fsdir.js';
import { relKey } from '../core/assetpath/paths.js';
import { platformsFor } from '../core/assetpath/route.js';
import { subFor, dirOfPrefix, fileHead, PLACE } from '../core/assetpath/placement.js';
import { DIRS } from '../core/dirs.js';
import { pool } from '../core/async.js';
import { networkClient } from './network.js';
import { ensureIndexes } from './index-store.js';

const LIST_CONC = 16;

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

async function locate(dir, rel, place, opts) {
  const d = await dirOf(dir, false);
  if (!d) return null;
  const checkSize = !(opts && opts.fast);
  for (const c of diskPaths(rel, place)) if (await fileStore.exists(d, c.path, { checkSize })) return c.path;
  return null;
}

async function readAsset(dir, rel, place) {
  const d = await dirOf(dir, false);
  if (!d) return null;
  const p = await locate(d, rel, place);
  if (!p) return null;
  return fileStore.readBytesUnder(d, p);
}

async function hasAsset(dir, rel, place) {
  return !!(await locate(dir, rel, place));
}

function dirsFor(items) {
  const set = new Set();
  for (const it of items || []) {
    const rel = it.rel || it;
    for (const c of diskPaths(rel, it.place)) set.add(dirOfPrefix(c.path));
  }
  return [...set];
}

async function presentIds(dir, items, opts) {
  const nonEmpty = !!(opts && opts.nonEmpty);
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
  const groups = [...byDir.entries()];
  const listed = await pool(groups, LIST_CONC, async ([sub]) => new Set(await fileStore.listUnder(d, sub, { nonEmpty })));
  groups.forEach(([, list], i) => {
    for (const x of list) if (!x.row.path && listed[i].has(x.name)) x.row.path = x.path;
  });
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

async function acquireAsset(dir, rel, opts) {
  const o = opts || {};
  const id = idOf(rel);
  if (!o.overwrite) {
    const p = await locate(dir, rel, o.place, { fast: !!o.fast });
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

async function removeAsset(dir, rel, place) {
  const d = await dirOf(dir, false);
  if (!d) return;
  for (const c of diskPaths(rel, place)) await fileStore.removeUnder(d, c.path);
}

export const AREA = {
  other: { dir: DIRS.other, place: PLACE.flat },
  monster: (item) => ({ dir: DIRS.monster, place: PLACE.owned(item) }),
  charVisual: (handle, cat) => ({ dir: handle, place: PLACE.visual(cat) }),
  charEpisode: (handle, episodeId, slot) => ({ dir: handle, place: PLACE.episode(episodeId, slot) }),
};

const readIn = (area, rel) => readAsset(area.dir, rel, area.place);
const hasIn = (area, rel) => hasAsset(area.dir, rel, area.place);
const locateIn = (area, rel, opts) => locate(area.dir, rel, area.place, opts);
const removeIn = (area, rel) => removeAsset(area.dir, rel, area.place);
const specIn = (area, rel) => ({ rel, place: area.place });

export const assetStore = { dirsFor, locate, readAsset, hasAsset, presentIds, acquireAsset, removeAsset, idOf, readIn, hasIn, locateIn, removeIn, specIn };
