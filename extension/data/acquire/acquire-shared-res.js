import { fileStore } from '../../core/fsdir.js';
import { assetStore } from '../asset-store.js';
import { DIRS } from '../../core/constants.js';
import { ensureIndexes } from '../index-store.js';
import { runBulkDownload } from './acquire-bulk.js';
import { resolveOrigin } from '../origin.js';
import { networkClient } from '../network.js';
import { AA_BUNDLES } from '../credits-assets.js';

async function grabCreditsAaBundles(dir, c, prog) {
  let origin = null;
  for (const a of AA_BUNDLES) {
    try {
      if (await fileStore.exists(dir, a.cache)) continue;
      if (!origin) origin = await resolveOrigin();
      if (!origin || !origin.assets) return;
      if (prog) prog(a.label + '（クレジット用）を取得中…');
      const r = await networkClient.fetchBytes(origin.assets + '/' + a.path);
      if (r.status === 'ok' && r.bytes) {
        await fileStore.writeUnder(dir, a.cache, r.bytes);
        if (c) c.got++;
        if (prog) prog(a.label + '（クレジット用）を取得しました');
      } else if (prog) {
        prog(a.label + '（クレジット用）取得失敗: ' + (r && r.status));
      }
    } catch (e) {}
  }
}
const sharedIndex = async () => (await ensureIndexes()).assets.sharedIndex;
const vfxAllRels = async () => (await ensureIndexes()).assets.vfxAllRels || [];
const skillFxSharedRels = async () => (await ensureIndexes()).assets.skillFxSharedRels || [];
const skillFxUniqueRels = async () => (await ensureIndexes()).assets.skillFxUniqueRels || [];
const miniGameRels = async () => (await ensureIndexes()).assets.miniGameRels || [];
const sharedResourceRels = async () => {
  const unique = new Set(await skillFxUniqueRels());
  return [...new Set([...(await sharedIndex()), ...(await vfxAllRels()), ...(await skillFxSharedRels()), ...(await miniGameRels()), ...(await collectOrphanEventstillRels())])].filter((rel) => !unique.has(rel));
};

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
    finalize: async (c, { dir, base, prog }) => {
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
      await grabCreditsAaBundles(dir, c, prog);
    },
    done: (c) => `完了 新規${c.got}件・既にあった分${c.skip}件・失敗${c.fail}件 / 全${c.total}件`,
  });
  return { got: ctx.got, skip: ctx.skip, missing: ctx.missing, unresolved: 0, failed: ctx.fail, total: ctx.total, purged: ctx.purged, stopped: !!ctx.stopped };
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
    // クレジット/ロゴ用 aa バンドルも件数に含める＝欠けると「一部 N/M」表示になり見て分かる。
    let extraHave = 0;
    try {
      const dir = await fileStore.getDir(DIRS.shared, { create: false });
      if (dir) for (const a of AA_BUNDLES) if (await fileStore.exists(dir, a.cache)) extraHave++;
    } catch (e) {}
    return { have: have.size + extraHave, total: list.length + AA_BUNDLES.length, unknown: 0 };
  } catch (e) {
    return { have: 0, total: 0, unknown: 0 };
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
