import { bind as bindEvents } from './wire-events.js';
import { bind as bindStorage } from './storage-reactor.js';
import { route } from './router-controller.js';
import { init } from './init-orchestrator.js';
import { showUpgradeNotice } from './upgrade-notice.js';
import { collectionRepository } from '../../data/collection.js';
import { LOW_QUALITY_INDEX } from '../../core/messages.js';
import { toast } from '../ui/notifier.js';

async function warnLowQuality() {
  try {
    if (!(await collectionRepository.indexReady())) return;
    const idx = await collectionRepository.ensureIndexes();
    if (idx && idx.meta && idx.meta.altRelCount === 0) toast(LOW_QUALITY_INDEX, 'err');
  } catch (e) {}
}

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
