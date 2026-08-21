import { DIRS } from '../../core/constants.js';
import { PLACE } from '../../core/placement.js';
import { ensureIndexes } from '../index-store.js';
import { monsterStatus, other3dStatus } from '../entity-lists.js';
import { runBulkDownload } from './acquire-bulk.js';
import { staticsList } from '../statics.js';
import { dlSession } from '../dl-session.js';
import { fileStore } from '../../core/fsdir.js';
import { DIRS as _D } from '../../core/constants.js';

const everyN = (n) => (c) => (c.done % n === 0 ? `DL中 ${c.done}/${c.total}（新規${c.got}件・失敗${c.fail}件）` : null);
const doneWithSkip = (c) => `完了 新規${c.got}件・既にあった分${c.skip}件${c.fail ? `・失敗${c.fail}件` : ''}${c.purged ? `・壊れた分を削除${c.purged}件` : ''}`;

async function runStaticsDownload(progress, opts) {
  const stop = (opts && opts.shouldAbort) || (() => false);
  const all = await staticsList();
  const list = all.filter((s) => s.url);
  const noUrl = all.length - list.length;
  const dir = await fileStore.getDir(_D.shared, { create: true });
  if (!dir || !list.length) return { got: 0, skip: 0, missing: 0, unresolved: noUrl, failed: 0 };
  const sess = dlSession.create();
  for (const s of list) {
    if (stop()) break;
    await sess.saveUrl(dir, { url: s.url, subpath: s.path, label: s.name }, "statics/接続を確認");
  }
  if (progress) progress(`統計素材 完了 新規${sess.counters.got}件`);
  return { got: sess.counters.got, skip: sess.counters.skip, missing: sess.counters.missing, unresolved: noUrl + sess.counters.unresolved, failed: sess.counters.fail };
}

async function runOther2dDownload(items, progress, opts) {
  const { ctx } = await runBulkDownload(items || [], {
    dirKey: DIRS.shared,
    progress,
    shouldAbort: opts && opts.shouldAbort,
    toRel: (it) => it.rel,
    tick: (c, phase) => (phase === 'dl' ? everyN(10)(c) : null),
    done: doneWithSkip,
  });
  const st = await runStaticsDownload(null, opts);
  return { got: ctx.got + st.got, skip: ctx.skip + st.skip, missing: ctx.missing + st.missing, unresolved: st.unresolved, failed: ctx.fail + st.failed, total: ctx.total + st.got + st.skip, purged: ctx.purged, stopped: !!ctx.stopped };
}

async function runMonsterDownload(progress, opts) {
  const st = await monsterStatus();
  const { ctx } = await runBulkDownload(st.refs, {
    dirKey: DIRS.monster,
    progress,
    shouldAbort: opts && opts.shouldAbort,
    toRel: (a) => a.rel,
    placeOf: (a) => PLACE.owned(a),
    tick: everyN(20),
    done: doneWithSkip,
  });
  return { got: ctx.got, skip: ctx.skip, missing: ctx.missing, unresolved: 0, failed: ctx.fail, total: ctx.total, purged: ctx.purged, stopped: !!ctx.stopped };
}

async function runOther3dDownload(progress, opts) {
  const st = await other3dStatus();
  const { ctx } = await runBulkDownload(st.refs, {
    dirKey: DIRS.other,
    progress,
    shouldAbort: opts && opts.shouldAbort,
    toRel: (rel) => rel,
    placeOf: () => PLACE.flat,
    tick: everyN(20),
    done: doneWithSkip,
  });
  return { got: ctx.got, skip: ctx.skip, missing: ctx.missing, unresolved: 0, failed: ctx.fail, total: ctx.total, purged: ctx.purged, stopped: !!ctx.stopped };
}

async function castRepairPlan(ids, prefix) {
  const aidx = (await ensureIndexes()).assets.assetIndex || {};
  const jobs = [];
  const noAsset = [];
  for (const id of ids || []) {
    const a = aidx[String(id)];
    const rels = a
      ? [
          ['spine', (a.spine || [])[0]],
          ['spinelight', (a.spinelight || [])[0]],
        ].filter(([, rel]) => rel)
      : [];
    if (!rels.length) {
      noAsset.push(String(id));
      continue;
    }
    for (const [cat, rel] of rels) jobs.push({ id: String(id), cat, rel });
  }
  return { jobs, noAsset };
}

async function runCastRepair(ids, progress, opts) {
  const prefix = opts && opts.prefix != null ? opts.prefix : null;
  const { jobs, noAsset } = await castRepairPlan(ids, prefix);
  const { ctx } = await runBulkDownload(jobs, {
    dirKey: (opts && opts.dirName) || DIRS.shared,
    progress,
    toRel: (j) => j.rel,
    placeOf: prefix == null ? null : (j) => PLACE.named(`${prefix}${j.id}/${j.cat}_`),
    tick: (c, phase) => (phase === 'dl' ? `取得中 ${c.done}/${c.total}` : null),
    done: doneWithSkip,
  });
  return { got: ctx.got, skip: ctx.skip, missing: ctx.missing, unresolved: 0, failed: ctx.fail, total: ctx.total, purged: ctx.purged, noAsset };
}

export const acquireLists = { runStaticsDownload, runOther2dDownload, runMonsterDownload, runOther3dDownload, runCastRepair };
