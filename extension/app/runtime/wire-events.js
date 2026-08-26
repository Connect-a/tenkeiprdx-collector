import { bulkDownloader } from '../../data/acquire/bulk.js';
import { fileStore } from '../../core/fsdir.js';
import { collectionRepository } from '../../data/collection.js';
import { setManualOrigin } from '../../data/origin.js';
import { playerState } from './player-state.js';
import { getById } from '../../core/dom.js';
import { getStoryPanel } from './panel-state.js';
import { parseRoute, isTargetRoute, routeHash, routeKey } from './router.js';
import { switchTab, setStageMax, updateCdnReset } from '../views/shell-ui.js';
import { ensureEpisodes } from '../views/detail-view.js';
import { navTo, navChar, setAppliedRouteKey } from './router-controller.js';
import { renderRoster } from '../views/roster-ui.js';
import { runLineSearch } from '../views/line-search.js';
import { openBulk, closeBulk, startBulk, stopBulk, renderBulkCard, renderBulkBanner, refreshBulkTarget } from '../views/bulk-ui.js';
import { pickFolder } from '../views/fs-ui.js';
import { refreshLists } from './state-refresh.js';
import { toast } from '../ui/notifier.js';
import { runSharedDownload, sharedDlToast } from '../views/shared-notice.js';
import { networkClient } from '../../data/network.js';
import { settings } from '../../core/settings.js';
import { assetUrlOn } from '../../core/paths.js';

const probeRel = async () => {
  try {
    const idx = await collectionRepository.ensureIndexes();
    const rel = Object.values(idx.assets.chibiIndex || {})[0] || (Object.values(idx.assets.assetIndex || {})[0] || {}).icon;
    if (rel) return rel;
  } catch (e) {}
  return 'base_catalog.json';
};

let lineSearchTimer = null;
let rosterSearchSaveTimer = null;
let bound = false;

const on = (id, type, fn) => getById(id).addEventListener(type, fn);
const onClick = (id, fn) => on(id, 'click', fn);
const eachIn = (id, sel, fn) => getById(id).querySelectorAll(sel).forEach(fn);

function bindNavigation() {
  document.querySelectorAll('.tab').forEach((t) =>
    t.addEventListener('click', () => {
      switchTab(t.dataset.tab);
      if (t.dataset.tab === 'story') ensureEpisodes();
    }),
  );
  const step = (d) => () => {
    const p = getStoryPanel();
    if (p) p.go(d);
  };
  onClick('next', step(1));
  onClick('prev', step(-1));
  const backToRoster = () => navTo(playerState.rosterKind || 'character');
  onClick('homeTitle', backToRoster);
  onClick('backToRoster', backToRoster);
  onClick('prevChar', () => navChar(-1));
  onClick('nextChar', () => navChar(1));
  onClick('sidebarToggle', () => {
    const collapsed = !document.body.classList.contains('sbcollapsed');
    document.body.classList.toggle('sbcollapsed', collapsed);
    settings.set('sidebarCollapsed', collapsed);
  });
  onClick('scrollTopBtn', () => {
    const m = getById('main');
    if (m) m.scrollTo({ top: 0, behavior: 'smooth' });
    const sb = document.querySelector('.sidebar');
    if (sb) sb.scrollTo({ top: 0, behavior: 'smooth' });
    const r = parseRoute();
    if (!r.id || !isTargetRoute(r.rosterKind)) return;
    try {
      history.replaceState(null, '', routeHash(r.rosterKind, null));
      setAppliedRouteKey(routeKey({ rosterKind: r.rosterKind }));
    } catch (e) {}
  });
}

function bindRosterFilters() {
  on('rosterSearch', 'input', () => {
    clearTimeout(rosterSearchSaveTimer);
    rosterSearchSaveTimer = setTimeout(() => settings.set('rosterSearch', getById('rosterSearch').value || ''), 400);
    renderRoster();
  });
  on('lineSearch', 'input', () => {
    clearTimeout(lineSearchTimer);
    lineSearchTimer = setTimeout(runLineSearch, 200);
  });
  eachIn('rosterType', '.rf[data-roster-type]', (b) => b.addEventListener('click', () => navTo(b.dataset.rosterType)));
  for (const id of ['rosterGroup', 'rosterRank']) {
    on(id, 'change', () => {
      playerState[id] = getById(id).value;
      settings.set(id, playerState[id]);
      renderRoster();
    });
  }
  eachIn('rosterOwn', '.rf', (b) =>
    b.addEventListener('click', () => {
      eachIn('rosterOwn', '.rf', (x) => x.classList.remove('active'));
      b.classList.add('active');
      playerState.rosterOwn = b.dataset.rosterOwn;
      settings.set('rosterOwn', playerState.rosterOwn);
      renderRoster();
    }),
  );
}

function bindBulk() {
  onClick('bulkOpen', openBulk);
  onClick('bulkClose', closeBulk);
  onClick('bulkStart', startBulk);
  onClick('bulkStop', stopBulk);
  onClick('bulkModal', (e) => {
    if (e.target === getById('bulkModal')) closeBulk();
  });
  onClick('bulkClear', async () => {
    await bulkDownloader.clear();
    await renderBulkCard();
    await renderBulkBanner();
    await refreshBulkTarget();
  });
}

function bindStage() {
  onClick('stageMax', () => setStageMax(!getById('stage').classList.contains('max')));
  onClick('storyProgBar', (e) => {
    const bar = getById('storyProgBar');
    const p = getStoryPanel();
    if (!bar || !p || !p.jumpFrac) return;
    const rect = bar.getBoundingClientRect();
    if (rect.width <= 0) return;
    p.jumpFrac((e.clientX - rect.left) / rect.width);
  });
  onClick('stageZoomReset', () => {
    const p = getStoryPanel();
    if (p && p.resetView) p.resetView();
  });
  onClick('stageMove', () => {
    const btn = getById('stageMove');
    const on = !btn.classList.contains('active');
    btn.classList.toggle('active', on);
    const p = getStoryPanel();
    if (p && p.setMoveMode) p.setMoveMode(on);
  });
  onClick('storyReplay', () => {
    const p = getStoryPanel();
    if (p && p.replayVoice) p.replayVoice();
  });
  onClick('stillToggle', () => {
    const p = getStoryPanel();
    if (p && p.toggleStill) p.toggleStill();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && getById('stage').classList.contains('max')) setStageMax(false);
  });
}

function bindFolder() {
  onClick('fsPick', () => {
    pickFolder();
  });
  onClick('fsGrant', async () => {
    playerState.fsGranted = (await fileStore.permission({ request: true })) === 'granted';
    await refreshLists();
  });
}

async function probeCdn(base) {
  try {
    const r = await fetch(assetUrlOn(base, 'web', await probeRel()), { method: 'HEAD' });
    return { ok: r.ok, text: `HTTP ${r.status} ${r.ok ? 'OK（配信中）' : 'NG'}` };
  } catch (e) {
    return { ok: false, text: 'error: ' + (e && e.message ? e.message : e) };
  }
}

function bindCdnSettings() {
  on('cdnBase', 'input', updateCdnReset);
  onClick('cdnSave', async () => {
    const btn = getById('cdnSave');
    const out = getById('cdnOut');
    const v = (getById('cdnBase').value || '').trim().replace(/\/+$/, '');
    if (!v) {
      await setManualOrigin(null);
      out.textContent = '';
      getById('cdnSaved').textContent = '自動に戻しました';
      setTimeout(() => (getById('cdnSaved').textContent = ''), 2500);
      updateCdnReset();
      return;
    }
    btn.disabled = true;
    out.textContent = '接続を確認中…';
    const r = await probeCdn(v);
    btn.disabled = false;
    out.textContent = `${v}\n${r.text}`;
    if (!r.ok) {
      toast('その配信元からは取得できなかったので保存しませんでした。自動取得のままです。', 'err');
      return;
    }
    await setManualOrigin(v);
    getById('cdnSaved').textContent = '更新';
    setTimeout(() => (getById('cdnSaved').textContent = ''), 1500);
    updateCdnReset();
  });
  onClick('cdnReset', async () => {
    getById('cdnBase').value = '';
    await setManualOrigin(null);
    getById('cdnOut').textContent = '';
    updateCdnReset();
  });
  onClick('cdnTest', async () => {
    const out = getById('cdnOut');
    const base = (getById('cdnBase').value || '').trim().replace(/\/+$/, '') || (await networkClient.assetRootAuto());
    out.textContent = 'テスト中…';
    const r = await probeCdn(base);
    out.textContent = `${base}\n${r.text}`;
  });
}

function bindMaintenance() {
  onClick('sharedDl', async () => {
    const out = getById('sharedOut');
    out.style.display = '';
    getById('sharedDl').disabled = true;
    const o = await runSharedDownload((m) => {
      out.textContent = m;
    });
    sharedDlToast(o);
    if (!o.ok) out.textContent = o.message;
    getById('sharedDl').disabled = false;
  });
}

export function bind() {
  if (bound) return;
  bound = true;
  bindNavigation();
  bindRosterFilters();
  bindBulk();
  bindStage();
  bindFolder();
  bindCdnSettings();
  bindMaintenance();
}
