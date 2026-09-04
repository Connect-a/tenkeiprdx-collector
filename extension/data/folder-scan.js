import { fileStore } from '../core/fsdir.js';
import { sceneHave } from '../core/assetpath/placement.js';
import { pool } from '../core/async.js';
import { characterMeta } from './character-meta.js';
import { folderModel } from './folder-model.js';
import { idbStore } from '../core/idb.js';

const SCAN_CONC = 8;
const SCAN_CACHE_KEY = 'dlScanCache';

async function scanDirEntry(handle, folderKey, fm) {
  const eps = fm.episodes || [];
  let have = 0;
  let partial = 0;
  const epDirs = await fileStore.listDirsUnder(handle, 'story');
  const found = await pool(eps, SCAN_CONC, async (e) => {
    const ids = (e.sceneBinIds || []).map(String);
    const epDir = epDirs.get(String(e.episodeId));
    if (!ids.length || !epDir) return 0;
    const names = new Set(await fileStore.listFilesIn(epDir));
    const h = sceneHave(ids, names);
    return h === 'full' ? 1 : h === 'partial' ? 2 : 0;
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

async function saveScanCache(entries) {
  try {
    await idbStore.set(SCAN_CACHE_KEY, { at: Date.now(), entries: entries.map(({ folderKey, name, rosterKind, counts }) => ({ folderKey, name, rosterKind, counts })) });
  } catch (e) {}
}

export async function cachedFolderEntries() {
  let cached = null;
  try {
    cached = await idbStore.get(SCAN_CACHE_KEY);
  } catch (e) {}
  const rows = cached && Array.isArray(cached.entries) ? cached.entries : null;
  if (!rows || !rows.length) return null;
  let dirs = [];
  try {
    dirs = await fileStore.listFolderDirs();
  } catch (e) {
    return null;
  }
  if (!dirs.length) return null;
  const byKey = new Map(dirs.map((d) => [String(d.folderKey), d.handle]));
  const out = [];
  for (const r of rows) {
    const handle = byKey.get(String(r.folderKey));
    if (handle) out.push({ ...r, handle });
  }
  return out.length ? out : null;
}

export async function scanFolder() {
  const { folderMeta } = await folderModel();
  const dirs = (await fileStore.listFolderDirs()).filter((d) => folderMeta[String(d.folderKey)]);
  const scanned = await pool(dirs, SCAN_CONC, (d) => scanDirEntry(d.handle, d.folderKey, folderMeta[String(d.folderKey)]));
  const out = scanned.filter(Boolean).sort((a, b) => (a.name > b.name ? 1 : -1));
  await saveScanCache(out);
  return out;
}

export async function scanFolderHandle(handle, folderKey) {
  const key = String(folderKey);
  const { folderMeta } = await folderModel();
  const fm = folderMeta[key];
  return fm && handle ? scanDirEntry(handle, key, fm) : null;
}

export async function scanOneFolder(folderKey) {
  const key = String(folderKey);
  const d = (await fileStore.listFolderDirs()).find((x) => String(x.folderKey) === key);
  return d ? scanFolderHandle(d.handle, key) : null;
}
