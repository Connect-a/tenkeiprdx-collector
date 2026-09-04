import { bind as bindEvents } from './wire-events.js';
import { bind as bindStorage } from './storage-reactor.js';
import { route } from './router-controller.js';
import { init } from './init-orchestrator.js';
import { showUpgradeNotice } from './upgrade-notice.js';
import { LOW_QUALITY_INDEX } from '../../core/messages.js';
import { toast } from '../ui/notifier.js';
import { ensureIndexes, indexReady } from '../../data/index-store.js';

async function warnLowQuality() {
  try {
    if (!(await indexReady())) return;
    const idx = await ensureIndexes();
    if (idx && idx.meta && idx.meta.altRelCount === 0) toast(LOW_QUALITY_INDEX, 'err');
  } catch (e) {}
}

window.addEventListener('unhandledrejection', (ev) => {
  console.error('[tp] 未処理のエラー', ev.reason);
});

async function boot() {
  bindEvents();
  bindStorage();
  window.addEventListener('popstate', () => route());
  window.addEventListener('hashchange', () => route());

  await init();
  showUpgradeNotice();
  warnLowQuality();
}

boot().catch((err) => {
  console.error('[tp] boot error', err);
});
