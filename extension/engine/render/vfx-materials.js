import { SHARED_FILE } from '../../core/assetpath/placement.js';
import { vfxParse } from './vfx-parse.js';
import { b64ToBytes } from '../../core/bytes.js';
import { assetStore } from '../../data/asset-store.js';
import { networkClient } from '../../data/network.js';
import { fileStore } from '../../core/fsdir.js';
import { DIRS } from '../../core/dirs.js';
import { assetUrlOn } from '../../core/assetpath/paths.js';
import * as THREE from '../../vendor/three.module.js';

const { assetRoot, fetchBytesRaw } = networkClient;
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let _catalog = null;
async function catalog() {
  if (_catalog) return _catalog;
  try {
    const dir = await fileStore.getDir(DIRS.shared, { create: false });
    const f = dir && (await fileStore.readUnder(dir, SHARED_FILE.vfxCatalog));
    if (f) {
      _catalog = JSON.parse(await f.text());
      return _catalog;
    }
  } catch (e) {}
  const bytes = await fetchBytesRaw(assetUrlOn(await assetRoot(), 'web', 'vfx_catalog.json'));
  if (!bytes) throw new Error('vfx_catalog');
  _catalog = JSON.parse(new TextDecoder().decode(bytes));
  return _catalog;
}

function resolveDeps(catalog, prefabRe) {
  try {
    const bd = b64ToBytes(catalog.m_BucketDataString),
      ed = b64ToBytes(catalog.m_EntryDataString);
    const dvB = new DataView(bd.buffer),
      dvE = new DataView(ed.buffer);
    const rI = (dv, o) => dv.getInt32(o, true);
    const bc = rI(dvB, 0);
    let bo = 4;
    const buckets = [];
    for (let i = 0; i < bc; i++) {
      bo += 4;
      const cnt = rI(dvB, bo);
      bo += 4;
      const es = [];
      for (let k = 0; k < cnt; k++) {
        es.push(rI(dvB, bo));
        bo += 4;
      }
      buckets.push(es);
    }
    const ec2 = rI(dvE, 0);
    const entries = [];
    for (let i = 0; i < ec2; i++) {
      const o = 4 + i * 28;
      entries.push({ iid: rI(dvE, o), depKey: rI(dvE, o + 8) });
    }
    const ids = catalog.m_InternalIds || [];
    const prefabIid = ids.findIndex((s) => prefabRe.test(String(s)));
    if (prefabIid < 0) return [];
    const deps = new Set();
    for (const e of entries) {
      if (e.iid !== prefabIid) continue;
      if (e.depKey >= 0 && e.depKey < buckets.length)
        for (const ei of buckets[e.depKey]) {
          const de = entries[ei];
          if (de) deps.add(String(ids[de.iid]));
        }
    }
    return [...deps]
      .map((s) => {
        const m = s.match(/([a-z0-9]+_assets_[a-z0-9]+\/[^/]+\.bundle)$/i);
        return m ? m[1] : null;
      })
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

const _byPrefab = new Map();

async function forPrefab(prefabName, selfRel) {
  const key = String(prefabName || '').toLowerCase();
  if (!key) return null;
  if (_byPrefab.has(key)) return _byPrefab.get(key);
  const cat = await catalog();
  const deps = resolveDeps(cat, new RegExp(escapeRe(prefabName) + '\\.prefab$', 'i')).filter((d) => d !== selfRel);
  const db = [];
  for (const d of deps) {
    const b = await assetStore.readAsset(DIRS.shared, d);
    if (b) db.push(b);
  }
  const map = vfxParse.buildMaterialMap(THREE, db);
  _byPrefab.set(key, map);
  return map;
}

export const vfxMaterials = { catalog, forPrefab };
