import { collectionRepository } from '../../data/collection.js';
import { playerState } from '../runtime/player-state.js';
import { isTargetRoute, defaultSection } from '../runtime/router.js';
import { navTo } from '../runtime/router-controller.js';
import { pendingScan, beginScan } from '../runtime/state-refresh.js';
import { toast } from '../ui/notifier.js';
import { openRoster } from './roster-view.js';
import { openCharacter, showSection } from './detail-view.js';
import { showDownloadPrompt } from './download-ui.js';
import { rosterModel } from './roster-ui.js';

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

async function openById(id) {
  const sid = String(id || '');
  if (!sid) return false;
  const known = () => playerState.dl.some((z) => String(z.folderKey) === sid);
  if (!known()) {
    const scan = pendingScan() || beginScan();
    if (scan) await scan;
  }
  if (known() && (await openCharacter(sid))) return true;
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

export async function applyRoute(r) {
  if (isTargetRoute(r.rosterKind)) {
    openRoster(r.rosterKind, r.id);
    return;
  }
  if (!r.id) {
    openRoster(r.rosterKind);
    return;
  }
  playerState.rosterKind = r.rosterKind;
  if (playerState.viewKey() !== String(r.id) && !(await openById(r.id))) {
    openRoster(r.rosterKind);
    return;
  }
  if (playerState.viewKey() !== String(r.id)) return;
  await showSection(r.id, r.section || defaultSection(r.rosterKind), r.epId);
}
