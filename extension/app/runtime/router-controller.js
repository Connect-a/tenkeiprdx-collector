import { collectionRepository } from '../../data/collection.js';
import { playerState } from './player-state.js';
import { parseRoute, routeHash, routeKey, isTargetRoute } from './router.js';
import { openRoster } from '../views/roster-view.js';
import { openCharacter, showSection } from '../views/detail-view.js';
import { defaultSection } from '../views/shell-ui.js';
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

export function navTo(rosterKind, id, opts) {
  const o = opts || {};
  const wantEp = o.section === 'story' && o.epId;
  const section = id && o.section && (o.section !== defaultSection(rosterKind) || wantEp) ? o.section : null;
  const next = routeHash(rosterKind, id || null, section, section === 'story' ? o.epId : null);
  if (location.hash === next) {
    route(true);
    return;
  }
  try {
    if (o.replace) history.replaceState(null, '', next);
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

async function apply(r) {
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

export async function route(force) {
  const r = parseRoute();
  const key = routeKey(r);
  if (!force && key === appliedRoute) return;
  appliedRoute = key;
  await apply(r);
}
