import { ensureIndexes } from '../../data/index-store.js';
import { assetStore } from '../../data/asset-store.js';
import { DIRS } from '../../core/constants.js';
import { bundleName } from '../../core/paths.js';

const NONE = { key: '', kind: 'none', rel: '', label: '（なし）' };
const GRID = { key: 'grid', kind: 'grid', rel: '', label: 'グリッド' };

const mapLabel = (rel) =>
  bundleName(rel)
    .replace(/^battlemap_/i, '')
    .replace(/_/g, ' ');

async function presentSet(rels) {
  if (!rels.length) return new Set();
  try {
    const have = await assetStore.presentIds(DIRS.shared, rels);
    return new Set(have.keys());
  } catch (e) {
    return new Set();
  }
}

async function battleMaps() {
  const idx = await ensureIndexes();
  const rels = (idx.assets.battleFieldRels || []).filter((r) => /^battlefieldsassets_scenes_battlefields\//.test(r));
  const have = await presentSet(rels);
  return rels
    .filter((r) => have.has(assetStore.idOf(r)))
    .map((rel) => ({ key: 'bf:' + rel, kind: 'battlemap', rel, label: mapLabel(rel) }))
    .sort((a, b) => (a.label > b.label ? 1 : -1));
}

async function backgrounds() {
  const idx = await ensureIndexes();
  const sai = idx.assets.sceneAssetIndex || {};
  const rels = [];
  for (const [name, rel] of Object.entries(sai)) {
    if (!/^bg_/i.test(name) || /^bg_(eventstill|common_system)/i.test(name)) continue;
    rels.push([name, rel]);
  }
  const have = await presentSet(rels.map(([, r]) => r));
  return rels
    .filter(([, r]) => have.has(assetStore.idOf(r)))
    .map(([name, rel]) => ({ key: 'bg:' + rel, kind: 'background', rel, label: name.replace(/^bg_(adventure_)?/i, '') }))
    .sort((a, b) => (a.label > b.label ? 1 : -1));
}

export async function createFieldList(mode) {
  const head = mode === '2d' ? [NONE] : [GRID, NONE];
  try {
    const list = mode === '2d' ? await backgrounds() : await battleMaps();
    return [...head, ...list];
  } catch (e) {
    return head;
  }
}
