import { fileStore } from '../../core/fsdir.js';
import { assetStore } from '../asset-store.js';
import { DIRS } from '../../core/constants.js';
import { ensureIndexes } from '../index-store.js';
import { runBulkDownload } from './acquire-bulk.js';
const sharedIndex = async () => (await ensureIndexes()).assets.sharedIndex;
const vfxAllRels = async () => (await ensureIndexes()).assets.vfxAllRels || [];
const sharedResourceRels = async () => [...new Set([...(await sharedIndex()), ...(await vfxAllRels()), ...(await collectOrphanEventstillRels())])];

async function collectOrphanEventstillRels() {
  const a = (await ensureIndexes()).assets;
  const named = a.itemIconNamed || {};
  const sai = a.sceneAssetIndex || {};
  return Object.keys(named)
    .filter((k) => /^bg_eventstill_/.test(k) && !sai[k])
    .map((k) => named[k]);
}

export async function ensureSharedSingletons(dir, base, idx, grab, { includeStage } = {}) {
  if (!dir) return;
  const g = (idx && idx.assets && idx.assets.globalAssets) || {};
  if (g.mouthAtlas && !(await assetStore.hasAsset(DIRS.shared, g.mouthAtlas))) await grab(g.mouthAtlas);
  if (!includeStage) return;
  const stage = g.stage || {};
  for (const rel of [stage.scenarioUi, stage.adventureUi, stage.emotion, stage.bgCommon]) {
    if (rel && !(await assetStore.hasAsset(DIRS.shared, rel))) await grab(rel);
  }
}

async function buildSharedResources(progress, opts) {
  const list = await sharedResourceRels();
  const { ctx } = await runBulkDownload(list, {
    dirKey: DIRS.shared,
    progress,
    shouldAbort: opts && opts.shouldAbort,
    toRel: (rel) => rel,
    tick: (c, phase) =>
      phase === 'skip'
        ? c.done % 30 === 0
          ? `確認中 ${c.done}/${c.total}（新規${c.got}件・既にあった分${c.skip}件・失敗${c.fail}件）`
          : null
        : c.done % 5 === 0
          ? `DL中 ${c.done}/${c.total}（新規${c.got}件・既にあった分${c.skip}件・失敗${c.fail}件）`
          : null,
    finalize: async (c, { dir, base }) => {
      try {
        const idx = await ensureIndexes();
        await ensureSharedSingletons(
          dir,
          base,
          idx,
          async (rel) => {
            const r = await assetStore.acquireAsset(DIRS.shared, rel, { base });
            if (r.status === 'got') c.got++;
          },
          { includeStage: false },
        );
      } catch (e) {}
    },
    done: (c) => `完了 新規${c.got}件・既にあった分${c.skip}件・失敗${c.fail}件 / 全${c.total}件`,
  });
  return { got: ctx.got, skip: ctx.skip, fail: ctx.fail, total: ctx.total, purged: ctx.purged, stopped: !!ctx.stopped };
}

async function sharedResourcesPresent() {
  try {
    const dir = await fileStore.getDir(DIRS.shared, { create: false });
    if (!dir) return false;
    const mouth = ((await ensureIndexes()).assets.globalAssets || {}).mouthAtlas;
    if (mouth && !(await assetStore.hasAsset(DIRS.shared, mouth))) return false;
    let stage = {};
    try {
      stage = ((await ensureIndexes()).assets.globalAssets || {}).stage || {};
    } catch (e) {}
    for (const rel of [stage.bgCommon, stage.scenarioUi]) {
      if (rel && !(await assetStore.hasAsset(DIRS.shared, rel))) return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

async function sharedStatus() {
  try {
    const list = await sharedResourceRels();
    const have = await assetStore.presentIds(DIRS.shared, list);
    return { have: have.size, total: list.length };
  } catch (e) {
    return { have: 0, total: 0 };
  }
}

async function runSharedResourceDownload(progress, opts) {
  const root = fileStore && fileStore.supported ? await fileStore.ensure() : null;
  if (!root) {
    const e = new Error('先に保存先フォルダを選んでください');
    e.noFolder = true;
    throw e;
  }
  return buildSharedResources(progress, opts);
}

export const acquireShared = { sharedResourcesPresent, sharedStatus, runSharedResourceDownload };
