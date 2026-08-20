import { fileStore } from '../core/fsdir.js';

const folderOf = (p) => {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
};
const fileOf = (p) => p.slice(p.lastIndexOf('/') + 1);

async function presentFiles(dirName, paths) {
  const have = new Set();
  try {
    const dir = await fileStore.getDir(dirName, { create: false });
    if (!dir) return have;
    const byFolder = new Map();
    for (const p of paths) {
      const f = folderOf(p);
      if (!byFolder.has(f)) byFolder.set(f, []);
      byFolder.get(f).push(p);
    }
    for (const [f, list] of byFolder) {
      const names = new Set(await fileStore.listUnder(dir, f));
      for (const p of list) if (names.has(fileOf(p))) have.add(p);
    }
  } catch (e) {}
  return have;
}

function allPresent(keys, have) {
  return keys.length > 0 && keys.every((k) => have.has(k));
}

export const localInventory = { presentFiles, allPresent };
