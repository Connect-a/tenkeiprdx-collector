import { fileStore } from '../core/fsdir.js';
import { pool } from '../core/async.js';

const LIST_CONC = 16;

const folderOf = (p) => {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
};
const fileOf = (p) => p.slice(p.lastIndexOf('/') + 1);

async function presentFiles(dirName, paths) {
  const have = new Set();
  let dir = null;
  try {
    dir = await fileStore.getDir(dirName, { create: false });
  } catch (e) {}
  if (!dir) return have;
  const byFolder = new Map();
  for (const p of paths) {
    const f = folderOf(p);
    if (!byFolder.has(f)) byFolder.set(f, []);
    byFolder.get(f).push(p);
  }
  const groups = [...byFolder.entries()];
  const listed = await pool(groups, LIST_CONC, async ([f]) => {
    try {
      return new Set(await fileStore.listUnder(dir, f));
    } catch (e) {
      return new Set();
    }
  });
  groups.forEach(([, list], i) => {
    for (const p of list) if (listed[i].has(fileOf(p))) have.add(p);
  });
  return have;
}

function allPresent(keys, have) {
  return keys.length > 0 && keys.every((k) => have.has(k));
}

export const localInventory = { presentFiles, allPresent };
