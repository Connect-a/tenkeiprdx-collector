import { bulkDownloader } from '../../data/acquire/bulk.js';
import { collectionRepository } from '../../data/collection.js';
import { getById } from '../../core/dom.js';
import { SK } from '../../core/constants.js';
import { ensureBulkTick, renderBulkBanner, renderBulkCard } from '../views/bulk-ui.js';
import { updateCard } from '../views/roster-ui.js';
import { refreshLists } from './state-refresh.js';
import { updateConn, maybeAutoDisconnect } from './connection-controller.js';
import { resumeBulkIfWaitingForConnection } from './bulk-resume.js';
import { reacquireData } from './data-reacquire.js';
import { playerState } from './player-state.js';
import { updateCdnReset } from '../views/shell-ui.js';

let reactTimer = null;
let bulkRefreshTimer = null;
let bound = false;
let manualPinned = false;

async function loadAssetRootPin() {
  try {
    const o = await chrome.storage.local.get(SK.originManual);
    manualPinned = !!o[SK.originManual];
  } catch (e) {}
}

function refreshListsSafe(parts) {
  return refreshLists(parts).catch((e) => {
    console.error('[tp] refreshLists failed', parts, e);
  });
}

function onChanged(ch, area) {
  if (area !== 'local') return;

  if (ch.bulkState) {
    const nv = ch.bulkState.newValue;
    const ov = ch.bulkState.oldValue;
    const active = nv && bulkDownloader.isActive(nv.phase);
    ensureBulkTick(!!active);
    if (!active) {
      renderBulkBanner();
      const bulkModal = getById('bulkModal');
      if (bulkModal && bulkModal.style.display !== 'none') renderBulkCard();
    }
    const nItems = Array.isArray(nv && nv.items) ? nv.items : [];
    const oItems = Array.isArray(ov && ov.items) ? ov.items : [];
    const doneKey = (it) => String((it && (it.id != null ? it.id : it.folderKey)) || '');
    const oDoneSet = new Set(oItems.filter((x) => x.status === 'done').map(doneKey));
    for (const it of nItems) {
      const fk = doneKey(it);
      if (!fk || it.status !== 'done' || oDoneSet.has(fk)) continue;
      const known = playerState.dl.find((x) => String(x.folderKey) === fk);
      (known && known.handle ? collectionRepository.scanFolderHandle(known.handle, fk) : collectionRepository.scanOneFolder(fk))
        .then((entry) => {
          if (!entry) return;
          entry.at = Date.now();
          const arr = Array.isArray(playerState.dl) ? playerState.dl : (playerState.dl = []);
          const idx = arr.findIndex((x) => String(x.folderKey) === fk);
          if (idx >= 0) arr[idx] = entry;
          else arr.push(entry);
          return updateCard(fk);
        })
        .catch(() => {});
    }
    const finished = ov && bulkDownloader.isActive(ov.phase) && (!nv || !bulkDownloader.isActive(nv.phase));
    if (finished) {
      clearTimeout(bulkRefreshTimer);
      bulkRefreshTimer = setTimeout(() => {
        refreshListsSafe(['fs']);
      }, 1200);
    }
  }

  if (ch.capturing || ch.captureLive || ch.captureError || ch.apiAuth || ch.apiAuthBad) updateConn();

  if (ch.apiAuth || ch.apiAuthBad) {
    const nTok = ch.apiAuth && ch.apiAuth.newValue && ch.apiAuth.newValue.authorization;
    const oTok = ch.apiAuth && ch.apiAuth.oldValue && ch.apiAuth.oldValue.authorization;
    const badCleared = !!(ch.apiAuthBad && ch.apiAuthBad.oldValue && !ch.apiAuthBad.newValue);
    if ((nTok && nTok !== oTok) || badCleared) resumeBulkIfWaitingForConnection();
  }

  if (ch.apiAuth || ch.apiAuthBad) {
    const fresh = !!(ch.apiAuth && ch.apiAuth.newValue && ch.apiAuth.newValue.authorization && ch.apiAuth.newValue.authorization !== (ch.apiAuth.oldValue && ch.apiAuth.oldValue.authorization));
    clearTimeout(reactTimer);
    reactTimer = setTimeout(async () => {
      if (fresh && playerState.owned.size <= 0) await reacquireData(getById('connInfo'));
      else await refreshLists(['owned']);
      await maybeAutoDisconnect();
    }, 1500);
  }

  if (ch.origin || ch.originManual) {
    const auto = (ch.origin && ch.origin.newValue && ch.origin.newValue.assets) || '';
    const cdnBase = getById('cdnBase');
    if (cdnBase) {
      if (auto) cdnBase.placeholder = auto;
      if (ch.originManual && document.activeElement !== cdnBase) {
        cdnBase.value = ch.originManual.newValue || '';
        updateCdnReset();
      }
    }
    const oldAssets = ch.origin && ch.origin.oldValue && ch.origin.oldValue.assets;
    const autoChanged = !!(ch.origin && oldAssets && oldAssets !== auto);
    const changed = ch.originManual ? ch.originManual.oldValue !== ch.originManual.newValue : !manualPinned && autoChanged;
    if (ch.originManual) manualPinned = !!ch.originManual.newValue;
    if (changed) {
      try {
        collectionRepository.invalidateIndex();
      } catch (e) {}
      refreshListsSafe(['binlist', 'index', 'dl']);
    }
  }
}

export function bind() {
  if (bound) return;
  bound = true;
  loadAssetRootPin();
  chrome.storage.onChanged.addListener(onChanged);
}
