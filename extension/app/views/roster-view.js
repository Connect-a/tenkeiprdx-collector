import { getById } from '../../core/dom.js';
import { playerState } from '../runtime/player-state.js';
import { ROUTE_KINDS as routeKinds } from '../runtime/router.js';
import { getStoryPanel, getHomePanel, getOtherPanel, getMonsterPanel } from '../runtime/panel-state.js';
import { renderRoster } from './roster-ui.js';
import { showEmptyIdle } from './shell-ui.js';
import { audioScene } from '../runtime/audio-scene.js';

let pendingTarget = null;

function syncRosterTypeButtons() {
  const wrap = getById('rosterType');
  if (wrap) wrap.querySelectorAll('.rf').forEach((x) => x.classList.toggle('active', x.dataset.rosterType === playerState.rosterKind));
  const own = getById('rosterOwn');
  if (own) own.style.display = playerState.rosterKind === 'character' ? '' : 'none';
}

const targetPanel = () => (playerState.rosterKind === 'home' ? getHomePanel() : playerState.rosterKind === 'other' ? getOtherPanel() : playerState.rosterKind === 'monster' ? getMonsterPanel() : null);

function focusTarget(panel, target) {
  if (!panel || !target) return;
  if (panel.openTarget) panel.openTarget(target);
  else if (panel.scrollToSection) panel.scrollToSection(target);
}

export function applyPendingTarget(panel) {
  focusTarget(panel, pendingTarget);
  pendingTarget = null;
}

export function openRoster(rosterKind, target) {
  const sameView = playerState.rosterOpen && !playerState.cur && playerState.rosterKind === (rosterKind || playerState.rosterKind);
  if (rosterKind && routeKinds.includes(rosterKind)) playerState.rosterKind = rosterKind;
  syncRosterTypeButtons();
  playerState.rosterOpen = true;
  playerState.cur = null;
  audioScene.set({ storyVisible: false });
  const storyPanel = getStoryPanel();
  if (storyPanel) storyPanel.reset();
  getById('roster').style.display = '';
  getById('empty').style.display = 'none';
  getById('detail').style.display = 'none';
  if (sameView) {
    focusTarget(targetPanel(), target);
    return;
  }
  pendingTarget = target || null;
  renderRoster();
}

export function closeRoster() {
  playerState.rosterOpen = false;
  getById('roster').style.display = 'none';
  if (!playerState.cur) showEmptyIdle();
}
