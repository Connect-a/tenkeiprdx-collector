import { ensureIndexes, rebuildIndexes, invalidateIndex, indexReady, saveMasterArtifacts } from './index-store.js';
import { folderModel, characterDetail } from './folder-model.js';
import { rosterItems, buildRosterItemFor } from './roster.js';
import { otherList, other3dStatus, other3dReady, monsterList, monsterStatus, monsterReady, other2dList, other2dStatus, itemList, itemGroups } from './entity-lists.js';
import { homeData, homeStatus, homeAssetStatus, otherBgmList } from './home-data.js';
import { scanFolder, scanOneFolder } from './folder-scan.js';

export const collectionRepository = {
  ensureIndexes,
  rebuildIndexes,
  invalidateIndex,
  indexReady,
  saveMasterArtifacts,

  folderModel,
  characterDetail,

  rosterItems,
  buildRosterItemFor,

  otherList,
  other3dStatus,
  other3dReady,
  monsterList,
  monsterStatus,
  monsterReady,
  other2dList,
  other2dStatus,
  itemList,
  itemGroups,

  homeData,
  homeStatus,
  homeAssetStatus,
  otherBgmList,

  scanFolder,
  scanOneFolder,
};
