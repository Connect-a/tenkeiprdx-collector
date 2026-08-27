import { folderModel } from './folder-model.js';
import { characterMeta } from './character-meta.js';
import { userStateService } from './user-state.js';

function binlistEpisodesCovered(meta, distSet) {
  if (!meta || !distSet || !distSet.size) return 0;
  let n = 0;
  for (const ep of meta.episodes || []) {
    if (ep.linkTo) continue;
    const ids = ep.sceneBinIds || [];
    if (ids.length && ids.every((sid) => distSet.has(String(sid)))) n++;
  }
  return n;
}

function openEpisodeCount(meta, ctx, level) {
  const episodes = (meta.episodes || []).filter((e) => !e.linkTo);
  if (meta.rosterKind === 'character') return level != null ? episodes.filter((e) => ctx.openEpisodes.has(String(e.episodeId))).length : 0;
  if (meta.rosterKind === 'special') return episodes.filter((e) => e.paidMasterId == null || ctx.paidUnlocked.has(String(e.paidMasterId))).length;
  return episodes.filter((e) => ctx.clearedNodes.has(String(e.episodeId))).length;
}

function buildRosterItem(folderKey, meta, ctx) {
  const key = String(folderKey);
  const isChar = meta.rosterKind === 'character';
  const episodes = (meta.episodes || []).filter((e) => !e.linkTo);
  const owned = isChar ? ctx.ownedLevels.has(key) : null;
  const level = owned ? ctx.ownedLevels.get(key) : null;
  const dl = ctx.dlMap.get(key) || null;
  return {
    folderKey: key,
    rosterKind: meta.rosterKind,
    apiType: meta.apiType,
    name: meta.name,
    title: meta.title || '',
    displayName: characterMeta.displayName(meta) || key,
    firstEpisodeTitle: (episodes[0] && episodes[0].title) || '',
    group: meta.group || '',
    rank: meta.rank || '',
    order: meta.order || 0,
    chapter: meta.chapter || '',
    chapterOrder: meta.chapterOrder || 0,
    subType: meta.subType || '',
    counts: {
      total: episodes.length,
      open: openEpisodeCount(meta, ctx, level),
      have: (dl && dl.counts && dl.counts.have) || 0,
      partial: (dl && dl.counts && dl.counts.partial) || 0,
      dist: binlistEpisodesCovered(meta, ctx.distSet),
    },
    owned,
    level,
    bwh: meta.bwh || null,
    hasDownload: !!dl,
    dl,
  };
}

async function rosterUserContext(opts) {
  const dlArr = Array.isArray(opts.dl) ? opts.dl : [];
  return {
    ownedLevels: await userStateService.ownedLevels(),
    paidUnlocked: await userStateService.unlockedPaidSet(),
    clearedNodes: await userStateService.clearedNodeSet(),
    openEpisodes: await userStateService.openEpisodeSet(),
    dlMap: new Map(dlArr.map((x) => [String(x.folderKey), x])),
    distSet: opts.distSet || null,
  };
}

export async function rosterItems(rosterKind, opts) {
  const { folderMeta } = await folderModel();
  const ctx = await rosterUserContext(opts || {});
  return Object.entries(folderMeta)
    .filter(([, meta]) => meta.rosterKind === rosterKind)
    .map(([folderKey, meta]) => buildRosterItem(folderKey, meta, ctx));
}

export async function buildRosterItemFor(folderKey, opts) {
  const { folderMeta } = await folderModel();
  const meta = folderMeta[String(folderKey)];
  if (!meta) return null;
  return buildRosterItem(folderKey, meta, await rosterUserContext(opts || {}));
}
