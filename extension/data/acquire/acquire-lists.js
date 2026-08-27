import { DIRS, DL_CONC } from '../../core/constants.js';
import { PLACE } from '../../core/placement.js';
import { ensureIndexes } from '../index-store.js';
import { monsterStatus, other3dStatus } from '../entity-lists.js';
import { runBulkDownload } from './acquire-bulk.js';
import { assetStore } from '../asset-store.js';
import { staticsList } from '../statics.js';
import { KIND_BY_KEY, gachaFileList } from '../gacha.js';
import { dlSession } from '../dl-session.js';
import { localInventory } from '../inventory.js';
import { fileStore } from '../../core/fsdir.js';
import { DIRS as _D } from '../../core/constants.js';

const everyN = (n) => (c) => (c.done % n === 0 ? `DL中 ${c.done}/${c.total}（新規${c.got}件・失敗${c.fail}件）` : null);
const doneWithSkip = (c) => `完了 新規${c.got}件・既にあった分${c.skip}件${c.fail ? `・失敗${c.fail}件` : ''}${c.purged ? `・壊れた分を削除${c.purged}件` : ''}`;

async function saveStatics(all, progress, opts, doneLabel, onMiss) {
  const stop = (opts && opts.shouldAbort) || (() => false);
  const list = all.filter((s) => s.url);
  const noUrl = all.length - list.length;
  const dir = await fileStore.getDir(_D.shared, { create: true });
  if (!dir || !list.length) return { got: 0, skip: 0, missing: 0, unresolved: noUrl, failed: 0, stopped: false };
  const sess = dlSession.create();
  let done = 0;
  let stopped = false;
  for (const s of list) {
    if (stop()) {
      stopped = true;
      break;
    }
    const r = await sess.saveUrl(dir, { url: s.url, subpath: s.path, label: s.name }, 'statics/接続を確認');
    if (r && r.status === 'missing' && onMiss && onMiss(s, sess.counters) === false) break;
    done++;
    if (progress && done % 10 === 0) progress(`DL中 ${done}/${list.length}（新規${sess.counters.got}件・失敗${sess.counters.fail}件）`);
  }
  if (progress) progress(`${doneLabel} 完了 新規${sess.counters.got}件・既にあった分${sess.counters.skip}件${sess.counters.fail ? `・失敗${sess.counters.fail}件` : ''}`);
  return { got: sess.counters.got, skip: sess.counters.skip, missing: sess.counters.missing, unresolved: noUrl + sess.counters.unresolved, failed: sess.counters.fail, stopped };
}

async function runStaticsDownload(progress, opts) {
  return saveStatics(await staticsList(), progress, opts, '統計素材');
}

const gachaBgRels = async () => (await ensureIndexes()).assets.gachaBgRels || [];
const gachaExtraRels = async () => (await ensureIndexes()).assets.gachaExtraRels || [];
const gachaBundleRels = async () => [...(await gachaBgRels()), ...(await gachaExtraRels())];

const MISSING_FILE = 'statics/_gacha_missing.json';

async function runGachaDownload(progress, opts) {
  const stop = (opts && opts.shouldAbort) || (() => false);
  const dir = await fileStore.getDir(_D.shared, { create: true });
  const all = await gachaFileList();
  const groups = new Map();
  for (const f of all) {
    const key = (f.kindKey === 'ticket' ? 'T' : 'G') + f.gachaId;
    if (!groups.has(key)) groups.set(key, { id: f.gachaId, kind: f.kindKey === 'ticket' ? 'チケット' : 'ガチャ', files: [] });
    groups.get(key).files.push(f);
  }
  const list = [...groups.values()].sort((a, b) => (a.kind === b.kind ? Number(a.id) - Number(b.id) : a.kind === 'ガチャ' ? -1 : 1));
  const missingIds = {};
  const sess = dlSession.create();
  let unresolved = 0;
  let stopped = false;
  let done = 0;
  const note = () => `新規${sess.counters.got}件・既にあった分${sess.counters.skip}件・配信なし${sess.counters.missing}件${sess.counters.fail ? `・失敗${sess.counters.fail}件` : ''}`;
  if (dir) {
    for (const g of list) {
      if (stop()) {
        stopped = true;
        break;
      }
      unresolved += g.files.filter((f) => !f.url).length;
      const rs = await Promise.all(g.files.filter((f) => f.url).map((f) => sess.saveUrl(dir, { url: f.url, subpath: f.path, label: f.name }, 'statics/接続を確認').then((r) => [f, r])));
      for (const [f, r] of rs) if (r.status === 'missing') (missingIds[f.kindKey] || (missingIds[f.kindKey] = [])).push(f.gachaId);
      done++;
      if (progress) progress(`${g.kind} ${done}/${list.length}（ID ${g.id}）${note()}`, done / list.length, sess.counters);
      if (sess.aborted) {
        stopped = true;
        break;
      }
    }
  }
  const cdnDown = !!sess.cdnDown;
  const { ctx } = stopped
    ? { ctx: { got: 0, skip: 0, missing: 0, fail: 0, total: 0, purged: 0, stopped: true } }
    : await runBulkDownload(await gachaBundleRels(), {
        dirKey: DIRS.shared,
        progress: (m, f, c) => progress && progress('背景 ' + m, f, c),
        shouldAbort: opts && opts.shouldAbort,
        toRel: (rel) => rel,
        tick: (c, phase) => (phase === 'dl' ? everyN(20)(c) : null),
        done: doneWithSkip,
      });
  if (Object.keys(missingIds).length) {
    console.log('[gacha] 配信なしだったID', JSON.stringify(missingIds));
    if (dir) {
      try {
        await fileStore.writeUnder(dir, MISSING_FILE, new TextEncoder().encode(JSON.stringify({ missingIds, cdnDown }, null, 1)));
      } catch (e) {}
    }
  }
  if (cdnDown) console.warn('[gacha]', sess.aborted.message);
  const missList = Object.entries(missingIds).flatMap(([k, ids]) => ids.map((id) => `${(KIND_BY_KEY.get(k) || { label: k }).label} ${id}`));
  return {
    got: sess.counters.got + ctx.got,
    skip: sess.counters.skip + ctx.skip,
    missing: sess.counters.missing + ctx.missing,
    unresolved: unresolved + sess.counters.unresolved,
    failed: sess.counters.fail + ctx.fail,
    total: sess.counters.got + sess.counters.skip + ctx.total,
    purged: ctx.purged,
    stopped: stopped || !!ctx.stopped,
    missingIds,
    missList,
    cdnDown,
  };
}

async function gachaStatus() {
  try {
    const [files, bgRels] = [await gachaFileList(), await gachaBundleRels()];
    const [haveF, haveB] = [
      await localInventory.presentFiles(
        _D.shared,
        files.map((s) => s.path),
      ),
      await assetStore.presentIds(DIRS.shared, bgRels),
    ];
    return { have: haveF.size + haveB.size, total: files.length + bgRels.length, unknown: 0 };
  } catch (e) {
    return { have: 0, total: 0, unknown: 0 };
  }
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
  return {
    got: ctx.got + st.got,
    skip: ctx.skip + st.skip,
    missing: ctx.missing + st.missing,
    unresolved: st.unresolved,
    failed: ctx.fail + st.failed,
    total: ctx.total + st.got + st.skip,
    purged: ctx.purged,
    stopped: !!ctx.stopped,
  };
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

const battleFieldRels = async () => (await ensureIndexes()).assets.battleFieldRels || [];

async function battleFieldStatus() {
  try {
    const list = await battleFieldRels();
    const have = await assetStore.presentIds(DIRS.shared, list);
    return { have: have.size, total: list.length, unknown: 0 };
  } catch (e) {
    return { have: 0, total: 0, unknown: 0 };
  }
}

async function runBattleFieldDownload(progress, opts) {
  const { ctx } = await runBulkDownload(await battleFieldRels(), {
    dirKey: DIRS.shared,
    progress,
    shouldAbort: opts && opts.shouldAbort,
    toRel: (rel) => rel,
    conc: DL_CONC.large,
    tick: (c, phase) => (phase === 'dl' ? `DL中 ${c.done}/${c.total}（1件あたり10〜30MBあります）` : null),
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

export const acquireLists = {
  runStaticsDownload,
  runGachaDownload,
  gachaStatus,
  gachaBgRels,
  gachaExtraRels,
  runOther2dDownload,
  runMonsterDownload,
  runOther3dDownload,
  runBattleFieldDownload,
  battleFieldStatus,
  runCastRepair,
};
