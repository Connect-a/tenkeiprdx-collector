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
    const o = await chrome.storage.local.get(SK.assetRootManual);
    manualPinned = !!o[SK.assetRootManual];
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
    renderBulkBanner();
    const bulkModal = getById('bulkModal');
    if (bulkModal && bulkModal.style.display !== 'none') renderBulkCard();
    const nItems = Array.isArray(nv && nv.items) ? nv.items : [];
    const oItems = Array.isArray(ov && ov.items) ? ov.items : [];
    const doneKey = (it) => String((it && (it.id != null ? it.id : it.folderKey)) || '');
    const oDoneSet = new Set(oItems.filter((x) => x.status === 'done').map(doneKey));
    for (const it of nItems) {
      const fk = doneKey(it);
      if (!fk || it.status !== 'done' || oDoneSet.has(fk)) continue;
      collectionRepository
        .scanOneFolder(fk)
        .then((entry) => {
          if (!entry) return;
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

  if (ch.assetRoot || ch.assetRootManual || ch.assetRootEnv) {
    const cdnBase = getById('cdnBase');
    if (cdnBase) {
      const auto = (ch.assetRootEnv && ch.assetRootEnv.newValue) || (ch.assetRoot && ch.assetRoot.newValue);
      if (auto) cdnBase.placeholder = auto;
      if (ch.assetRootManual && document.activeElement !== cdnBase) {
        cdnBase.value = ch.assetRootManual.newValue || '';
        updateCdnReset();
      }
    }
    const autoChanged = (ch.assetRootEnv && ch.assetRootEnv.oldValue !== ch.assetRootEnv.newValue) || (ch.assetRoot && ch.assetRoot.oldValue && ch.assetRoot.oldValue !== ch.assetRoot.newValue);
    const changed = ch.assetRootManual ? ch.assetRootManual.oldValue !== ch.assetRootManual.newValue : !manualPinned && !!autoChanged;
    if (ch.assetRootManual) manualPinned = !!ch.assetRootManual.newValue;
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
