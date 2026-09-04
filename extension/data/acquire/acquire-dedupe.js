import { assetStore } from '../asset-store.js';
import { DIRS } from '../../core/dirs.js';
import { ensureIndexes } from '../index-store.js';

export async function dropSharedModelDeps(ownerAreaOf) {
  let deps = null;
  try {
    deps = (await ensureIndexes()).meta.modelDeps || {};
  } catch (e) {
    return 0;
  }
  let dropped = 0;
  for (const [id, rels] of Object.entries(deps)) {
    for (const rel of rels || []) {
      let area = null;
      try {
        area = await ownerAreaOf(id, rel);
      } catch (e) {
        area = null;
      }
      if (!area) continue;
      let owned = false;
      try {
        owned = await assetStore.hasIn(area, rel);
      } catch (e) {
        owned = false;
      }
      if (!owned) continue;
      try {
        if (!(await assetStore.hasAsset(DIRS.shared, rel))) continue;
        await assetStore.removeAsset(DIRS.shared, rel);
        dropped++;
      } catch (e) {}
    }
  }
  return dropped;
}
