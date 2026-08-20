import { SK } from '../../core/constants.js';
import { bulkDownloader } from '../../data/acquire/bulk.js';
import { toast } from '../ui/notifier.js';

async function hasLiveToken() {
  try {
    const o = await chrome.storage.local.get([SK.apiAuth, SK.apiAuthBad]);
    const auth = o[SK.apiAuth];
    const tok = auth && auth.authorization;
    const expired = auth && auth.exp && Math.floor(Date.now() / 1000) >= auth.exp;
    return !!(tok && tok !== o[SK.apiAuthBad] && !expired);
  } catch (e) {
    return false;
  }
}

let inFlight = null;

export function resumeBulkIfWaitingForConnection() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    if (!(await hasLiveToken())) return false;
    const resumed = await bulkDownloader.resumeAfterReconnect();
    if (resumed) toast('一括ダウンロードを再開しました', 'ok');
    return resumed;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
