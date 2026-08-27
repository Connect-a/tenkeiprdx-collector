import { fileStore } from '../../core/fsdir.js';
import { R18_ALT_EPISODES, R18_ALT_OWNER } from '../../core/constants.js';
import { folderModel } from '../folder-model.js';
import { characterMeta } from '../character-meta.js';

const attempted = new Set();

async function walk(dir, sub) {
  const out = [];
  for (const name of await fileStore.listUnder(dir, sub)) out.push(sub ? `${sub}/${name}` : name);
  for (const name of (await fileStore.listDirsUnder(dir, sub)).keys()) out.push(...(await walk(dir, sub ? `${sub}/${name}` : name)));
  return out;
}

async function folderDir(folderKey, folderMeta, create) {
  const meta = folderMeta[String(folderKey)];
  if (!meta) return null;
  const name = characterMeta.displayName(meta) || String(folderKey);
  try {
    return await fileStore.getFolderDir(String(folderKey), name, { create, kind: meta.rosterKind });
  } catch (e) {
    return null;
  }
}

async function moveEpisode(srcDir, destDir, episodeId) {
  const sub = `story/${episodeId}`;
  const files = await walk(srcDir, sub);
  if (!files.length) return 'none';

  const sizes = new Map();
  for (const rel of files) {
    const bytes = await fileStore.readBytesUnder(srcDir, rel);
    if (!bytes) return 'read-failed';
    sizes.set(rel, bytes.length);
    try {
      await fileStore.writeUnder(destDir, rel, bytes);
    } catch (e) {
      return 'write-failed';
    }
  }

  for (const rel of files) {
    const bytes = await fileStore.readBytesUnder(destDir, rel);
    if (!bytes || bytes.length !== sizes.get(rel)) return 'verify-failed';
  }

  for (const rel of files) await fileStore.removeUnder(srcDir, rel);
  await fileStore.removeDirUnder(srcDir, sub);
  return 'moved';
}

const targets = new Set(R18_ALT_EPISODES.map((a) => a.after));

export async function migrateR18Episodes(folderKey, episodes) {
  const key = String(folderKey);
  const owns = key === R18_ALT_OWNER || (episodes || []).some((e) => targets.has(String(e.episodeId)));
  if (!owns) return null;
  if (attempted.has('r18')) return null;
  attempted.add('r18');

  let folderMeta = {};
  try {
    ({ folderMeta } = await folderModel());
  } catch (e) {
    return null;
  }
  const srcDir = await folderDir(R18_ALT_OWNER, folderMeta, false);
  if (!srcDir) return null;

  const ownerOf = (episodeId) => Object.keys(folderMeta).find((k) => (folderMeta[k].episodes || []).some((e) => String(e.episodeId) === episodeId));

  const result = { moved: [], failed: [] };
  const destCache = new Map();
  for (const alt of R18_ALT_EPISODES) {
    if (!(await walk(srcDir, `story/${alt.id}`)).length) continue;
    const ownerKey = ownerOf(alt.after);
    if (!ownerKey) continue;
    if (!destCache.has(ownerKey)) destCache.set(ownerKey, await folderDir(ownerKey, folderMeta, true));
    const destDir = destCache.get(ownerKey);
    if (!destDir) continue;
    const r = await moveEpisode(srcDir, destDir, alt.id);
    if (r === 'moved') result.moved.push(alt.id);
    else if (r !== 'none') result.failed.push(`${alt.id}:${r}`);
  }
  if (result.failed.length) console.warn('[tp] R18話の移動に失敗', result.failed.join(' , '));
  return result.moved.length || result.failed.length ? result : null;
}
