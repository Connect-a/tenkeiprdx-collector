import { vfxMaterials } from '../render/vfx-materials.js';
import { assetStore } from '../../data/asset-store.js';
import { ensureIndexes } from '../../data/index-store.js';
import { DIRS } from '../../core/dirs.js';
import { bundleName } from '../../core/assetpath/paths.js';

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
let _byName = null;
async function vfxIndex() {
  if (_byName) return _byName;
  const byName = new Map();
  try {
    for (const rel of (await ensureIndexes()).assets.vfxAllRels || []) {
      const n = bundleName(rel).toLowerCase();
      if (!byName.has(n)) byName.set(n, rel);
    }
  } catch (e) {}
  _byName = byName;
  return _byName;
}

const fetchRel = (rel) => assetStore.readAsset(DIRS.shared, rel);

const _cache = new Map();
async function loadByName(name) {
  if (!name) return null;
  const norm = String(name).toLowerCase();
  if (_cache.has(norm)) return _cache.get(norm);
  const byName = await vfxIndex();
  const rel = byName.get(norm) || [...byName.keys()].filter((n) => n.startsWith(norm + '_')).map((n) => byName.get(n))[0];
  const bytes = rel ? await fetchRel(rel) : null;
  const out = bytes ? { bytes, texByMatPid: await vfxMaterials.forPrefab(norm, rel) } : null;
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
