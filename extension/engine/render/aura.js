import { vfxParse } from './vfx-parse.js';
import { assetStore } from '../../data/asset-store.js';
import { networkClient } from '../../data/network.js';
import { fileStore } from '../../core/fsdir.js';
import { CATALOG_DIR } from '../../data/index-store.js';
import { DIRS } from '../../core/constants.js';
import { assetUrlOn } from '../../core/paths.js';
import * as THREE from '../../vendor/three.module.js';
const AURA_RE = /(vfx[a-z]*_assets_[a-z]*\/(abnorm[a-z]*aura[a-z0-9_]*)_[0-9a-f]{32}\.bundle)$/i;
const KEY_RE = /\/(abnorm[a-z]*aura[a-z0-9_]*)_[0-9a-f]{32}\.bundle$/i;
let _catalog = null;
const _cache = new Map();
const { assetRoot, fetchBytesRaw } = networkClient;

async function catalog() {
  if (_catalog) return _catalog;
  try {
    const dir = await fileStore.getDir(DIRS.shared, { create: false });
    if (dir) {
      const f = await fileStore.readUnder(dir, CATALOG_DIR + '/vfx_catalog.json');
      if (f) { _catalog = JSON.parse(await f.text()); return _catalog; }
    }
  } catch (e) {}
  const base = await assetRoot();
  const bytes = await fetchBytesRaw(assetUrlOn(base, 'web', 'vfx_catalog.json'));
  if (!bytes) throw new Error('vfx_catalog');
  _catalog = JSON.parse(new TextDecoder().decode(bytes));
  return _catalog;
}

async function list() {
  const out = [],
    seen = new Set();
  let cat;
  try {
    cat = await catalog();
  } catch (e) {
    return out;
  }
  for (const s of cat.m_InternalIds || []) {
    const m = String(s).match(AURA_RE);
    if (!m || seen.has(m[2])) continue;
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
  if (bytes && vfxParse && THREE) {
    try {
      const key = (rel.match(KEY_RE) || [])[1];
      const cat = await catalog();
      const deps = vfxParse.resolveDeps(cat, new RegExp(key + '\\.prefab$', 'i')).filter((d) => d !== rel);
      const db = [];
      for (const d of deps) {
        const b = await fetchBundleBytes(d);
        if (b) db.push(b);
      }
      texByMatPid = vfxParse.buildMaterialMap(THREE, db);
    } catch (e) {}
  }
  const out = { bytes, texByMatPid };
  if (texByMatPid) _cache.set(rel, out);
  return out;
}

export const auraRenderer = { catalog, list, load, AURA_RE };
