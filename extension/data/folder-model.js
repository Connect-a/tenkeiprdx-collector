import { ensureIndexes } from './index-store.js';
import { apiTypeForKind } from './character-meta.js';
import { AFFILIATION_NAMES, RARITY_NAMES } from './master-labels.js';
import { CHARACTER_CV } from './character-cv.js';

const CV_UNKNOWN = '【不明】';
const groupName = (d) => AFFILIATION_NAMES[d && d.groupId] || '';
const rankName = (d) => RARITY_NAMES[d && d.rankId] || '';

const episodeRef = (e) => ({ episodeId: e.episodeId, order: e.order, label: e.label, title: e.title, xpos: e.xpos || 0, thumb: e.thumb || null, sceneBinIds: e.sceneBinIds, linkTo: e.linkTo });

function buildFolderMeta(x) {
  const folderMeta = {};

  for (const [cid, c] of Object.entries(x.master.characters)) {
    if (!(c.episodes || []).length) continue;
    folderMeta[String(cid)] = {
      apiType: apiTypeForKind('character'),
      rosterKind: 'character',
      name: c.name,
      title: c.title,
      group: groupName(c),
      rank: rankName(c),
      bwh: c.bwh,
      attachmentColors: c.attachmentColors,
      episodes: c.episodes.map(episodeRef),
    };
  }

  for (const [questKey, q] of Object.entries(x.master.questIndex)) {
    folderMeta['quest_' + questKey] = {
      apiType: apiTypeForKind(q.cat),
      rosterKind: q.cat,
      order: q.order || 0,
      eventId: q.event,
      name: q.name,
      title: '',
      chapter: q.chapter || '',
      chapterOrder: q.chapterOrder || 0,
      episodes: q.episodes.map((e) => ({ ...episodeRef(e), chapter: e.chapter || '' })),
    };
  }

  for (const [eid, ev] of Object.entries(x.master.eventIndex)) {
    folderMeta['special_' + eid] = {
      apiType: apiTypeForKind('special'),
      rosterKind: 'special',
      subType: ev.subType || '特別エピソード',
      name: ev.name,
      title: '',
      episodes: ev.episodes.map((e) => ({ ...episodeRef(e), paidMasterId: e.paidMasterId, subType: e.subType, unlockItem: e.unlockItem || null })),
    };
  }

  return folderMeta;
}

let _cache = { indexes: null, folderMeta: null };

export async function folderModel() {
  const x = await ensureIndexes();
  if (_cache.indexes !== x) _cache = { indexes: x, folderMeta: buildFolderMeta(x) };
  return { voice: x.assets.voiceIndex, folderMeta: _cache.folderMeta, homeIndex: x.master.homeIndex };
}

export async function characterDetail(charId) {
  const c = (await ensureIndexes()).master.characters[String(charId)];
  if (!c) return null;
  const { episodes, ...d } = c;
  const cv = CHARACTER_CV[String(c.name || '').replace(/\(.*\)$/, '')] || CV_UNKNOWN;
  return { group: groupName(c), rank: rankName(c), cv, ...d };
}
