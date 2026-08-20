import { fileStore } from '../core/fsdir.js';
import { utilHelpers } from '../core/util.js';
import { characterMeta } from './character-meta.js';
import { folderModel } from './folder-model.js';

const SCAN_CONC = 8;

async function scanDirEntry(handle, folderKey, fm) {
  const eps = fm.episodes || [];
  let have = 0;
  let partial = 0;
  const found = await utilHelpers.pool(eps, SCAN_CONC, async (e) => {
    const ids = (e.sceneBinIds || []).map(String);
    if (!ids.length) return 0;
    const names = new Set(await fileStore.listUnder(handle, `story/${e.episodeId}`));
    return ids.every((sid) => names.has(`scene_${sid}.bin`)) ? 1 : names.has(`scene_${ids[0]}.bin`) ? 2 : 0;
  });
  for (const f of found) {
    if (f === 1) have++;
    else if (f === 2) partial++;
  }
  if (have === 0 && partial === 0 && !(await fileStore.anyEntry(handle))) return null;
  return {
    folderKey: String(folderKey),
    name: characterMeta.displayName(fm) || String(folderKey),
    rosterKind: fm.rosterKind || '',
    counts: { total: eps.length, have, partial },
    handle,
  };
}

export async function scanFolder() {
  const { folderMeta } = await folderModel();
  const dirs = (await fileStore.listFolderDirs()).filter((d) => folderMeta[String(d.folderKey)]);
  const scanned = await utilHelpers.pool(dirs, SCAN_CONC, (d) => scanDirEntry(d.handle, d.folderKey, folderMeta[String(d.folderKey)]));
  return scanned.filter(Boolean).sort((a, b) => (a.name > b.name ? 1 : -1));
}

export async function scanOneFolder(folderKey) {
  const key = String(folderKey);
  const { folderMeta } = await folderModel();
  const fm = folderMeta[key];
  if (!fm) return null;
  const d = (await fileStore.listFolderDirs()).find((x) => String(x.folderKey) === key);
  if (!d) return null;
  return scanDirEntry(d.handle, key, fm);
}
