import { folderModel, characterDetail } from './folder-model.js';
import { rosterItems, buildRosterItemFor } from './roster.js';
import { otherList, fbxSlotAssets, other3dStatus, other3dReady, monsterList, monsterStatus, monsterReady, other2dList, other2dStatus, itemList, itemGroups } from './entity-lists.js';
import { homeData, homeStatus, homeAssetStatus } from './home-data.js';
import { scanFolder, scanOneFolder, scanFolderHandle, cachedFolderEntries } from './folder-scan.js';

export const collectionRepository = {
  folderModel,
  characterDetail,

  rosterItems,
  buildRosterItemFor,

  otherList,
  fbxSlotAssets,
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

  scanFolder,
  scanOneFolder,
  scanFolderHandle,
  cachedFolderEntries,
};
