import { ensureIndexes } from '../../data/index-store.js';
import { assetStore } from '../../data/asset-store.js';
import { localInventory } from '../../data/inventory.js';
import { DIRS } from '../../core/dirs.js';
import { bundleName } from '../../core/assetpath/paths.js';

const NONE = { key: '', kind: 'none', rel: '', label: '（なし）' };
const GRID = { key: 'grid', kind: 'grid', rel: '', label: 'グリッド' };

const mapLabel = (rel) =>
  bundleName(rel)
    .replace(/^battlemap_/i, '')
    .replace(/_/g, ' ');

async function presentSet(dir, rels) {
  if (!rels.length) return new Set();
  try {
    const have = await assetStore.presentIds(dir, rels);
    return new Set(have.keys());
  } catch (e) {
    return new Set();
  }
}

async function battleMaps() {
  const idx = await ensureIndexes();
  const rels = (idx.assets.battleFieldRels || []).filter((r) => /^battlefieldsassets_scenes_battlefields\//.test(r));
  const have = await presentSet(DIRS.shared, rels);
  return rels
    .filter((r) => have.has(assetStore.idOf(r)))
    .map((rel) => ({ key: 'bf:' + rel, kind: 'battlemap', rel, label: mapLabel(rel) }))
    .sort((a, b) => (a.label > b.label ? 1 : -1));
}

function backgroundNames(idx) {
  const hi = idx.master.homeIndex || {};
  const out = new Map();
  const comic = new Set();
  for (const e of hi.background || []) {
    if (e.bg && e.name) out.set(e.bg, e.name);
    if (e.bg && e.source === 'comic') comic.add(e.bg);
  }
  for (const e of hi.sceneIllust || []) {
    if (!e.name) continue;
    if (e.still) out.set(e.still, e.name);
    if (e.stillAdult) out.set(e.stillAdult, e.name);
  }
  return { name: out, comic };
}

async function backgrounds() {
  const idx = await ensureIndexes();
  const sai = idx.assets.sceneAssetIndex || {};
  const { name: named, comic: comicBg } = backgroundNames(idx);
  const rels = [];
  for (const [name, rel] of Object.entries(sai)) {
    if (!/^bg_/i.test(name) || /^bg_(gacha|garapon|common_system)/i.test(name)) continue;
    rels.push([name, rel]);
  }
  const all = rels.map(([, r]) => r);
  const inShared = await presentSet(DIRS.shared, all);
  const inHome = await presentSet(DIRS.home, all);
  return rels
    .map(([name, rel]) => {
      const id = assetStore.idOf(rel);
      const dir = inShared.has(id) ? DIRS.shared : inHome.has(id) ? DIRS.home : null;
      if (!dir) return null;
      const isComic = comicBg.has(name);
      const still = /^bg_eventstill_/i.test(name);
      return {
        key: 'bg:' + rel,
        kind: 'background',
        rel,
        dir,
        group: isComic ? '1コマ漫画' : still ? 'シーンイラスト' : '背景',
        label: named.get(name) || name.replace(/^bg_(adventure_)?/i, ''),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.label > b.label ? 1 : a.label < b.label ? -1 : 0));
}

const comicPath = (id) => `comic/${id}.dds`;

async function comics(idx) {
  const list = (idx.master.homeIndex || {}).comic || [];
  if (!list.length) return [];
  let have = new Set();
  try {
    have = await localInventory.presentFiles(
      DIRS.home,
      list.map((e) => comicPath(e.id)),
    );
  } catch (e) {
    return [];
  }
  return list
    .filter((e) => have.has(comicPath(e.id)))
    .map((e) => ({ key: 'comic:' + e.id, kind: 'background', rel: comicPath(e.id), dir: DIRS.home, group: '1コマ漫画', label: e.title || '#' + e.id }))
    .sort((a, b) => (a.label > b.label ? 1 : a.label < b.label ? -1 : 0));
}

export async function createFieldList(mode) {
  const head = mode === '2d' ? [NONE] : [GRID, NONE];
  try {
    if (mode !== '2d') return [...head, ...(await battleMaps())];
    const idx = await ensureIndexes();
    const [bg, cm] = await Promise.all([backgrounds(), comics(idx)]);
    return [...head, ...bg, ...cm];
  } catch (e) {
    return head;
  }
}
