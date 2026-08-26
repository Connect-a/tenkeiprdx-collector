import { SK } from '../../core/constants.js';
import { visualRenderer } from '../../engine/render/visual.js';
import { fileStore } from '../../core/fsdir.js';
import { unityDecode } from '../../unity/decode.js';
import { collectionRepository } from '../../data/collection.js';
import { assetAcquirer } from '../../data/acquire/acquire-assemble.js';
import { bulkDownloader } from '../../data/acquire/bulk.js';
import { networkClient } from '../../data/network.js';
import { createAudioPanel } from '../panels/audio-panel.js';
import { createImagePanel } from '../panels/image-panel.js';
import { createStoryPanel } from '../panels/story-panel.js';
import { createLetterPanel } from '../panels/letter-panel.js';
import { createOtherPanel } from '../panels/other-panel.js';
import { createItemPanel } from '../panels/item-panel.js';
import { createOther2dPanel } from '../panels/other2d-panel.js';
import { createMonsterPanel } from '../panels/monster-panel.js';
import { createHomePanel } from '../panels/home-panel.js';
import { playerState } from './player-state.js';
import { getById } from '../../core/dom.js';
import { nameFix, escapeHtml, spinnerHtml } from '../ui/ui-format.js';
import { toast } from '../ui/notifier.js';
import { buildOnboard } from '../views/onboarding-ui.js';
import { navTo, route } from './router-controller.js';
import { routeHash } from './router.js';
import { showVersionAndCheckUpdate } from './update-check.js';
import { updateCdnReset } from '../views/shell-ui.js';
import { renderIndexRebuild } from '../views/download-section.js';
import { renderStorageSummary } from '../views/storage-summary.js';
import { refreshLists } from './state-refresh.js';
import { renderRoster, restoreRosterPrefs } from '../views/roster-ui.js';
import { ensureBulkTick, renderBulkBanner } from '../views/bulk-ui.js';
import { registerPanels } from './panel-state.js';
import { audioScene } from './audio-scene.js';
import { settings } from '../../core/settings.js';
import { resolveOrigin, ensureOriginAlive } from '../../data/origin.js';
import { CFG } from '../../config.js';

export async function init() {
  showVersionAndCheckUpdate();

  try {
    const o = await chrome.storage.local.get(SK.email);
    await ensureOriginAlive();
    const origin = await resolveOrigin();
    const email = getById('email');
    if (email && o[SK.email]) email.value = o[SK.email];
    const cdnBase = getById('cdnBase');
    if (cdnBase) {
      cdnBase.value = origin.manual || '';
      cdnBase.placeholder = (await resolveOrigin({ ignoreManual: true })).assets;
    }
  } catch (e) {}

  updateCdnReset();
  renderIndexRebuild();
  renderStorageSummary();
  if (CFG.githubIssuesUrl && getById('ghIssue')) {
    getById('ghIssue').href = CFG.githubIssuesUrl;
    getById('ghIssue').style.display = '';
  }

  await settings.load();
  for (const id of ['voiceMode', 'imageFlipY', 'show3d', 'showSpine', 'masterVolume', 'playerName']) settings.bind(getById(id), id);
  document.body.classList.toggle('sbcollapsed', !!settings.get('sidebarCollapsed'));
  restoreRosterPrefs();
  const masterVol = () => settings.get('masterVolume');

  const homeBgm = {};
  const ctx = {
    playerState,
    audioScene,
    getById,
    visualRenderer,
    fileStore,
    unityDecode,
    collectionRepository,
    assetAcquirer,
    networkClient,
    CFG,
    toast,
    nameFix,
    escapeHtml,
    buildOnboard,
    navTo,
    masterVol,
    homeBgm,
    spinnerHtml,
    storage: chrome.storage.local,
  };
  const letterPanel = createLetterPanel({
    ...ctx,
    onDistUpdated: async () => {
      try {
        playerState.binlistScenes = await assetAcquirer.binlistSceneSet({ force: true });
      } catch (e) {}
      if (playerState.rosterOpen) renderRoster();
    },
    onDistCleared: async () => {
      try {
        playerState.binlistScenes = await assetAcquirer.clearBinlistScenes();
      } catch (e) {}
      if (playerState.rosterOpen) renderRoster();
    },
  });
  letterPanel.bind();
  await letterPanel.refresh();

  const audioPanel = createAudioPanel(ctx);
  audioPanel.bind();
  await audioPanel.initFromStorage();

  const imagePanel = createImagePanel(ctx);
  imagePanel.bind();

  const storyPanel = createStoryPanel(ctx);
  const otherPanel = createOtherPanel(ctx);
  const itemPanel = createItemPanel(ctx);
  const other2dPanel = createOther2dPanel(ctx);
  const monsterPanel = createMonsterPanel(ctx);
  const homePanel = createHomePanel(ctx);
  homePanel.bind();

  const panels = [letterPanel, audioPanel, imagePanel, storyPanel, otherPanel, homePanel, itemPanel, other2dPanel, monsterPanel];

  try {
    await refreshLists(undefined, { deferScan: true });
  } catch (e) {
    console.error('[tp] 初期索引取得に失敗(続行)', e);
  }
  homePanel.restoreHomeBgm();

  try {
    const bst = await bulkDownloader.getState();
    if (bst && bulkDownloader.isActive(bst.phase)) {
      ensureBulkTick(true);
      await renderBulkBanner();
      bulkDownloader.resume();
    }
  } catch (e) {}

  const q = new URLSearchParams(location.search).get('char');
  if (q && !location.hash) {
    try {
      history.replaceState(null, '', routeHash('character', q));
    } catch (e) {}
  }
  const result = { letterPanel, audioPanel, imagePanel, storyPanel, otherPanel, homePanel, itemPanel, other2dPanel, monsterPanel, panels };
  registerPanels(result);

  await route();

  return result;
}
