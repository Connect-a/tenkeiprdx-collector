import { vfxMaterials } from './vfx-materials.js';
import { assetStore } from '../../data/asset-store.js';
import { DIRS } from '../../core/dirs.js';
const AURA_RE = /(vfx[a-z]*_assets_[a-z]*\/(abnorm[a-z]*aura[a-z0-9_]*)_[0-9a-f]{32}\.bundle)$/i;
const KEY_RE = /\/(abnorm[a-z]*aura[a-z0-9_]*)_[0-9a-f]{32}\.bundle$/i;
const _cache = new Map();

async function list() {
  const out = [],
    seen = new Set();
  let cat;
  try {
    cat = await vfxMaterials.catalog();
  } catch (e) {
    return out;
  }
  for (const s of cat.m_InternalIds || []) {
    const m = String(s).match(AURA_RE);
    if (!m || seen.has(m[2])) continue;
    if (/vfxmaterials/i.test(m[1])) continue;
    seen.add(m[2]);
    out.push({ rel: m[1], label: m[2].replace(/^abnorma.?aura_?/i, '') || m[2] });
  }
  return out;
}

async function fetchBundleBytes(rel) {
  return await assetStore.readAsset(DIRS.shared, rel);
}

async function load(rel) {
  if (!rel) return null;
  if (_cache.has(rel)) return _cache.get(rel);
  const bytes = await fetchBundleBytes(rel);
  let texByMatPid = null;
  if (bytes) {
    try {
      texByMatPid = await vfxMaterials.forPrefab((rel.match(KEY_RE) || [])[1], rel);
    } catch (e) {}
  }
  const out = { bytes, texByMatPid };
  if (texByMatPid) _cache.set(rel, out);
  return out;
}

export const auraCatalog = { list, load };
