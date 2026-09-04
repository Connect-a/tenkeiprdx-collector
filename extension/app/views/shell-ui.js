import { visualRenderer } from '../../engine/render/visual.js';
import { getById } from '../../core/dom.js';
import { dispatchPanels } from '../runtime/panel-state.js';
import { audioScene } from '../runtime/audio-scene.js';
import { refreshSharedNotice } from './shared-notice.js';

const EMPTY_IDLE = '「キャラ一覧」から選択してください。';

export function showEmptyIdle() {
  const em = getById('emptyMsg');
  if (em) em.textContent = EMPTY_IDLE;
  getById('empty').style.display = '';
}

export function setStageMax(on) {
  const st = getById('stage');
  if (!st) return;
  st.classList.toggle('max', !!on);
  document.body.classList.toggle('stagemax', !!on);
  const btn = getById('stageMax');
  if (btn) {
    btn.textContent = on ? '⤢ 縮小' : '⛶ 最大化';
    btn.title = on ? '通常の大きさに戻す（Escでも戻せます）' : '再生画面を画面いっぱいに広げます';
  }
}

export function applyKindTabs(rosterKind) {
  const charOnly = rosterKind === 'character';
  document.querySelectorAll('.tab').forEach((t) => {
    t.style.display = charOnly || t.dataset.tab !== 'voice' ? '' : 'none';
  });
  for (const id of ['show3d', 'showSpine']) {
    const lb = getById(id) && getById(id).closest('label');
    if (lb) lb.style.display = charOnly ? '' : 'none';
  }
  const save = getById('saveDecodedPack');
  if (save) save.textContent = charOnly ? 'デコード結果を保存（画像+ボイス）…' : 'デコード結果を保存（画像）…';
}

export function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === name));
  if (name !== 'story') {
    setStageMax(false);
    audioScene.set({ storyPlaying: false });
  }
  dispatchPanels('onTabSwitched', name);
  if (name === 'story') refreshSharedNotice();
}

export function updateCdnReset() {
  getById('cdnReset').disabled = !(getById('cdnBase').value || '').trim();
}

export function resetVisualPanel() {
  if (visualRenderer && visualRenderer.disposeSpinePlayers) {
    try {
      visualRenderer.disposeSpinePlayers();
    } catch (e) {}
  }
  if (visualRenderer && visualRenderer.disposeGallery) {
    try {
      visualRenderer.disposeGallery();
    } catch (e) {}
  }
  const imageHost = getById('imageHost');
  if (imageHost) {
    imageHost.style.display = 'none';
    imageHost.textContent = '';
  }
  const spineHost = getById('spineHost');
  if (spineHost) {
    spineHost.style.display = 'none';
    spineHost.textContent = '';
  }
}
