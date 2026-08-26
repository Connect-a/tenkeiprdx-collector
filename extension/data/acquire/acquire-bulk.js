import { fileStore } from '../../core/fsdir.js';
import { FAIL_CAP, MISS_STREAK_CAP, DL_CONC } from '../../core/constants.js';
import { utilHelpers } from '../../core/util.js';
import { assetStore } from '../asset-store.js';
import { networkClient } from '../network.js';
const { assetRoot } = networkClient;
const pool = utilHelpers.pool;

async function ensureDlDir(dirKey) {
  const root = fileStore && fileStore.supported ? await fileStore.ensure() : null;
  if (!root) {
    const e = new Error('先に保存先フォルダを選んでください');
    e.noFolder = true;
    throw e;
  }
  const dir = await fileStore.getDir(dirKey, { create: true });
  if (!dir) throw new Error('フォルダ権限がありません');
  return dir;
}

export async function runBulkDownload(items, opts) {
  const { dirKey, toRel, placeOf, skipExisting = true, tick, done: doneMsg, finalize, shouldAbort } = opts;
  const list = items || [];
  const dir = await ensureDlDir(dirKey);
  const base = opts.base || (await assetRoot());
  const prog = utilHelpers.safeProgress(opts.progress);
  const total = list.length;
  const ctx = { done: 0, got: 0, skip: 0, fail: 0, missing: 0, total };
  let aborted = null;
  let missStreak = 0;
  const emit = (phase) => {
    if (!tick) return;
    const m = tick(ctx, phase);
    if (m != null) prog(m, ctx.done / (total || 1), ctx);
  };
  let present = null;
  if (skipExisting && list.length) {
    prog('壊れた分を確認しています…', 0, ctx);
    ctx.purged = await fileStore.purgeEmpty(dir);
    prog(`確認中 0/${total}`, 0, ctx);
    try {
      present = await assetStore.presentIds(
        dirKey,
        list.map((it) => ({ rel: toRel(it), place: placeOf ? placeOf(it) : undefined })).filter((x) => x.rel),
      );
    } catch (e) {}
  }
  const grab = async (item) => {
    const rel = toRel(item);
    if (!rel) return null;
    if (present && present.has(assetStore.idOf(rel))) return 'skip';
    const place = placeOf ? placeOf(item) : undefined;
    const r = await assetStore.acquireAsset(dirKey, rel, { base, overwrite: !skipExisting, place, fast: skipExisting });
    return r.status;
  };
  const unsubOffline = networkClient.subscribeOffline((on) => {
    ctx.offline = on;
    prog(on ? '回線が切れています。復帰を待っています…' : `回線が戻りました。DLを再開します（${ctx.done}/${total}）`, ctx.done / (total || 1), ctx);
  });
  const deferred = [];
  try {
    await pool(list, DL_CONC.asset, async (item) => {
      if (aborted) return;
      if (shouldAbort && shouldAbort()) {
        ctx.stopped = true;
        return;
      }
      const status = await grab(item);
      if (!status) return;
      ctx.done++;
      if (status === 'skip' || status === 'got') missStreak = 0;
      if (status === 'skip') {
        ctx.skip++;
        emit('skip');
        return;
      }
      if (status === 'got') {
        ctx.got++;
        emit('dl');
        return;
      }
      if (status === 'missing') {
        ctx.missing++;
        if (++missStreak >= MISS_STREAK_CAP) aborted = new Error(`配信元が${MISS_STREAK_CAP}件連続で応答しなかったため中断しました（配信停止の可能性）`);
      } else {
        deferred.push(item);
        if (++ctx.fail >= FAIL_CAP) aborted = new Error(`通信の失敗${FAIL_CAP}件で中断`);
      }
    });
    if (!aborted && !ctx.stopped && deferred.length) {
      for (let i = 0; i < deferred.length; i++) {
        if (shouldAbort && shouldAbort()) {
          ctx.stopped = true;
          break;
        }
        prog(`取り直し中… ${i + 1}/${deferred.length}`, ctx.done / (total || 1), ctx);
        const status = await grab(deferred[i]);
        if (status === 'got') ctx.got++;
        else if (status === 'skip') ctx.skip++;
        else if (status === 'missing') ctx.missing++;
        else continue;
        ctx.fail = Math.max(0, ctx.fail - 1);
      }
    }
  } finally {
    unsubOffline();
  }
  if (aborted) throw aborted;
  if (finalize) await finalize(ctx, { dir, base, prog });
  if (ctx.purged == null) ctx.purged = await fileStore.purgeEmpty(dir);
  if (doneMsg) prog(doneMsg(ctx), 1);
  return { ctx, dir, base };
}
