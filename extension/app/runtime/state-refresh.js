import { fileStore } from '../../core/fsdir.js';
import { collectionRepository } from '../../data/collection.js';
import { userStateService } from '../../data/user-state.js';
import { assetAcquirer } from '../../data/acquire/acquire-assemble.js';
import { playerState } from './player-state.js';
import { redraw } from './ui-bus.js';
import { settings } from '../../core/settings.js';
import { saveMasterArtifacts } from '../../data/index-store.js';

let _scan = null;
let _scanPending = false;

export function pendingScan() {
  return _scan;
}

export function beginScan() {
  if (!_scanPending) return null;
  return rescanAll();
}

export function rescanAll() {
  _scanPending = false;
  return startScan().then(afterScan);
}

function mergeScanned(scanned, startedAt) {
  const prev = Array.isArray(playerState.dl) ? playerState.dl : [];
  const byKey = new Map(scanned.map((x) => [String(x.folderKey), x]));
  for (const e of prev) {
    const k = String(e.folderKey);
    if (e && e.at > startedAt && !byKey.has(k)) byKey.set(k, e);
  }
  playerState.dl = [...byKey.values()].sort((a, b) => (a.name > b.name ? 1 : -1));
}

function startScan() {
  if (_scan) return _scan;
  const startedAt = Date.now();
  _scan = collectionRepository
    .scanFolder()
    .then((scanned) => {
      mergeScanned(scanned, startedAt);
    })
    .catch((e) => {
      console.error('[tp] 状態更新に失敗', e);
    })
    .finally(() => {
      _scan = null;
    });
  return _scan;
}

async function afterScan() {
  await redraw('download-dirty');
  await redraw('download');
  if (playerState.rosterOpen) await redraw('roster', { changed: ['fs'] });
}

export async function refreshLists(parts = ['fs', 'owned', 'binlist', 'dl'], opts) {
  const deferScan = !!(opts && opts.deferScan);
  playerState.fsGranted = false;
  if (fileStore && fileStore.supported) {
    try {
      playerState.fsGranted = (await fileStore.permission({ request: false })) === 'granted';
    } catch (e) {}
  }
  await redraw('fs');
  if (playerState.fsGranted) await settings.loadFilePrefs();

  if (parts.includes('fs')) {
    if (playerState.fsGranted) {
      try {
        saveMasterArtifacts && saveMasterArtifacts();
      } catch (e) {}
      if (deferScan) {
        let cached = null;
        try {
          cached = await collectionRepository.cachedFolderEntries();
        } catch (e) {}
        if (cached) {
          playerState.dl = cached;
          _scanPending = true;
        } else startScan().then(afterScan);
      } else {
        await startScan();
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

  await redraw('storage');
  if (parts.includes('dl')) await redraw('download');
  else if (parts.includes('index') || parts.includes('fs')) await redraw('download-dirty');
  if (playerState.rosterOpen) await redraw('roster', { changed: parts });
}

export function folderHandle(folderKey) {
  const e = playerState.dl.find((x) => String(x.folderKey) === String(folderKey));
  return e ? e.handle : null;
}
