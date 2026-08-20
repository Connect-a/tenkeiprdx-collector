import { fileStore } from '../../core/fsdir.js';
import { collectionRepository } from '../../data/collection.js';
import { userStateService } from '../../data/user-state.js';
import { assetAcquirer } from '../../data/acquire/acquire-assemble.js';
import { playerState } from './player-state.js';
import { updateFsUi, updateStorage } from '../views/fs-ui.js';
import { renderRoster } from '../views/roster-ui.js';
import { refreshDownloadSection, markDownloadSectionDirty } from '../views/download-section.js';

export async function refreshLists(parts = ['fs', 'owned', 'binlist', 'dl']) {
  playerState.fsGranted = false;
  if (fileStore && fileStore.supported) {
    try {
      playerState.fsGranted = (await fileStore.permission({ request: false })) === 'granted';
    } catch (e) {}
  }
  updateFsUi();

  if (parts.includes('fs')) {
    if (playerState.fsGranted) {
      try {
        collectionRepository.saveMasterArtifacts && collectionRepository.saveMasterArtifacts();
      } catch (e) {}
      try {
        playerState.dl = await collectionRepository.scanFolder();
      } catch (e) {
        console.error('[tp] 状態更新に失敗', e);
      }
    } else {
      playerState.dl = [];
    }
  }

  if (parts.includes('owned')) {
    if (playerState.fsGranted) {
      try {
        playerState.owned = await userStateService.ownedLevels();
      } catch (e) {}
    } else {
      playerState.owned = new Map();
    }
  }

  if (parts.includes('binlist')) {
    try {
      playerState.binlistScenes = await assetAcquirer.binlistSceneSet();
    } catch (e) {
      playerState.binlistScenes = new Set();
    }
  }

  await updateStorage();
  if (parts.includes('dl')) await refreshDownloadSection();
  else if (parts.includes('index') || parts.includes('fs')) markDownloadSectionDirty();
  if (playerState.rosterOpen) await renderRoster({ changed: parts });
}

export function folderHandle(folderKey) {
  const e = playerState.dl.find((x) => String(x.folderKey) === String(folderKey));
  return e ? e.handle : null;
}
