import { collectionRepository } from '../../data/collection.js';
import { playerState } from './player-state.js';
import { parseRoute, routeHash, isTargetRoute } from './router.js';
import { openRoster } from '../views/roster-view.js';
import { openCharacter } from '../views/detail-view.js';
import { showDownloadPrompt } from '../views/download-ui.js';
import { toast } from '../ui/notifier.js';
import { rosterModel } from '../views/roster-ui.js';
import { pendingScan, beginScan } from './state-refresh.js';

let appliedRoute = null;

export async function navChar(dir) {
  const model = await rosterModel();
  const flat = model.groups.flatMap((g) => g.items);
  const i = flat.findIndex((x) => String(x.folderKey) === String(playerState.navId || ''));
  if (i < 0) {
    toast('現在のキャラ一覧の並びに含まれないため移動できません（タブ/絞り込みを確認）');
    return;
  }
  const j = i + dir;
  if (j < 0 || j >= flat.length) {
    toast(dir > 0 ? '一覧の最後です' : '一覧の最初です');
    return;
  }
  navTo(playerState.rosterKind, String(flat[j].folderKey));
}

export function setAppliedRouteKey(v) {
  appliedRoute = v;
}

export function navTo(rosterKind, id, opts) {
  const next = routeHash(rosterKind, id || null);
  if (location.hash === next) {
    route(true);
    return;
  }
  try {
    if (opts && opts.replace) history.replaceState(null, '', next);
    else history.pushState(null, '', next);
    route(true);
  } catch (e) {
    location.hash = next;
  }
}

async function openById(id) {
  const sid = String(id || '');
  if (!sid) return false;
  const known = () => playerState.dl.some((z) => String(z.folderKey) === sid);
  if (!known()) {
    const scan = pendingScan() || beginScan();
    if (scan) await scan;
  }
  if (known()) {
    await openCharacter(sid);
    return true;
  }
  try {
    const item = await collectionRepository.buildRosterItemFor(sid, { dl: playerState.dl, distSet: playerState.binlistScenes });
    if (item) {
      showDownloadPrompt(item);
      return true;
    }
  } catch (e) {
    console.error('[tp] openById failed', e);
  }
  return false;
}

export async function route(skipDedup) {
  const r = parseRoute();
  const key = r.rosterKind + '|' + (r.id || '');
  if (!skipDedup && key === appliedRoute) return;
  appliedRoute = key;

  if (isTargetRoute(r.rosterKind)) {
    openRoster(r.rosterKind, r.id);
    return;
  }

  if (r.id) {
    playerState.rosterKind = r.rosterKind;
    const ok = await openById(r.id);
    if (!ok) openRoster(r.rosterKind);
    return;
  }

  openRoster(r.rosterKind);
}
