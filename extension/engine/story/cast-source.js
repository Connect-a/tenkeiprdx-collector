import { fileStore } from '../../core/fsdir.js';
import { assetStore, AREA } from '../../data/asset-store.js';
import { ensureIndexes } from '../../data/index-store.js';
import { DIRS } from '../../core/dirs.js';
import { CAST_CATS, castRelOf } from '../../data/character-meta.js';

export function createCastSource(readBundle) {
  let folders = null;

  async function folderMap() {
    if (folders) return folders;
    folders = {};
    try {
      for (const d of await fileStore.listFolderDirs()) folders[String(d.folderKey)] = d.handle;
    } catch (e) {}
    return folders;
  }

  async function fromOwnFolder(id) {
    const h = (await folderMap())[id];
    if (!h) return null;
    const idx = await indexes();
    const a = idx && idx.assets.assetIndex[id];
    if (!a) return null;
    for (const cat of CAST_CATS) {
      const rel = (a[cat] || [])[0];
      if (!rel) continue;
      let b = null;
      try {
        b = await assetStore.readIn(AREA.charVisual(h, cat), rel);
      } catch (e) {}
      if (b) return b;
    }
    return null;
  }

  async function indexes() {
    try {
      return await ensureIndexes();
    } catch (e) {
      return null;
    }
  }

  async function fromShared(id) {
    const idx = await indexes();
    if (!idx) return null;
    const rel = castRelOf(idx.assets.assetIndex[id]);
    if (!rel) return null;
    return await assetStore.readAsset(DIRS.shared, rel);
  }

  return {
    async bytesFor(id, routedPath) {
      id = String(id);
      const own = await fromOwnFolder(id);
      if (own) return own;
      if (routedPath) {
        const b = await readBundle(routedPath);
        if (b) return b;
      }
      return await fromShared(id);
    },
  };
}
