import { vfxParse } from '../render/vfx-parse.js';
import { assetStore } from '../../data/asset-store.js';
import { ensureIndexes } from '../../data/index-store.js';
import { DIRS } from '../../core/constants.js';
import { bundleName } from '../../core/paths.js';
import * as THREE from '../../vendor/three.module.js';

const VFX_NAME_BY_CODE = {
  11: 'd_slash_01',
  12: 'd_slash_02',
  13: 'd_explosion_01',
  14: 'd_explosion_02',
  15: 'd_claw_01',
  16: 'd_claw_02',
  17: 'd_ray_01',
  18: 'd_ray_02',
};
const MATERIAL_CAT = /^vfxmaterials_assets_vfxmaterials\//;

let _index = null;
async function vfxIndex() {
  if (_index) return _index;
  const byName = new Map();
  const materials = [];
  try {
    for (const rel of (await ensureIndexes()).assets.vfxAllRels || []) {
      const n = bundleName(rel).toLowerCase();
      if (!byName.has(n)) byName.set(n, rel);
      if (MATERIAL_CAT.test(rel)) materials.push(rel);
    }
  } catch (e) {}
  _index = { byName, materials };
  return _index;
}

const fetchRel = (rel) => assetStore.readAsset(DIRS.shared, rel);

let _matMap = null;
async function sharedMaterialMap() {
  if (_matMap) return _matMap;
  const { materials } = await vfxIndex();
  const have = await assetStore.presentIds(DIRS.shared, materials);
  const db = [];
  for (const rel of materials) {
    if (!have.has(assetStore.idOf(rel))) continue;
    const b = await fetchRel(rel);
    if (b) db.push(b);
  }
  _matMap = vfxParse ? vfxParse.buildMaterialMap(THREE, db) : null;
  return _matMap;
}

const _cache = new Map();
async function loadByName(name) {
  if (!name) return null;
  const norm = String(name).toLowerCase();
  if (_cache.has(norm)) return _cache.get(norm);
  const { byName } = await vfxIndex();
  const rel = byName.get(norm) || [...byName.keys()].filter((n) => n.startsWith(norm + '_')).map((n) => byName.get(n))[0];
  const bytes = rel ? await fetchRel(rel) : null;
  const out = bytes ? { bytes, texByMatPid: await sharedMaterialMap() } : null;
  _cache.set(norm, out);
  return out;
}

const loadVfxByCode = (code) => loadByName(VFX_NAME_BY_CODE[code]);
const loadVfxByKey = (key) => loadByName(key);

export const vfxAssets = {
  loadVfxByCode,
  loadVfxByKey,
  VFX_NAME_BY_CODE,
};
