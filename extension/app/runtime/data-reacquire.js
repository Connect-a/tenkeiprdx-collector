import { collectionRepository } from '../../data/collection.js';
import { userStateService } from '../../data/user-state.js';
import { refreshLists } from './state-refresh.js';

let inFlight = null;

export function reacquireData(info, onUser) {
  if (inFlight) return inFlight;
  const p = (async () => {
    let user = null;
    try {
      user = await userStateService.refreshUserViaApi();
    } catch (e) {}
    if (onUser) onUser(user);
    try {
      await collectionRepository.rebuildIndexes((m) => {
        if (info) info.textContent = m;
      });
    } catch (e) {
      if (info) info.textContent = 'ゲームのデータを取得できませんでした。ゲームと接続してからやり直してください。';
    }
    await refreshLists(['fs', 'owned', 'index', 'dl']);
    return user;
  })();
  inFlight = p;
  p.catch(() => {}).then(() => {
    if (inFlight === p) inFlight = null;
  });
  return p;
}
