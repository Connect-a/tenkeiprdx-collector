import { fileStore } from '../../core/fsdir.js';
import { assetRefs } from '../asset-refs.js';
import { DIRS, DL_CONC } from '../../core/constants.js';
import { networkClient } from '../network.js';
import { dlSession } from '../dl-session.js';
import { ensureIndexes } from '../index-store.js';
import { homeData, otherBgmList } from '../home-data.js';
import { utilHelpers } from '../../core/util.js';
const { assetRoot } = networkClient;

async function collectHome(progress, onItem, opts) {
  const stop = (opts && opts.shouldAbort) || (() => false);
  const idx = await ensureIndexes();
  const hi = idx.master.homeIndex || { sceneIllust: [], comic: [], homeBgm: [] };
  const sa = idx.assets.sceneAssetIndex || {};
  const staticsBase = idx.meta.staticsBase || null;
  const base = await assetRoot();
  const dir = await fileStore.getDir(DIRS.home, { create: true });
  if (!dir) throw new Error('フォルダ権限がありません');
  const sharedDir = await fileStore.getDir(DIRS.shared, { create: true });
  const prog = utilHelpers.safeProgress(progress);
  const emit = (section, entry) => {
    try {
      onItem && onItem(section, entry);
    } catch (e) {}
  };
  const sess = dlSession.create();
  const counters = sess.counters;
  const grab = async (rel) => {
    if (!rel) {
      counters.unresolved++;
      return null;
    }
    const r = await sess.saveAsset(dir, rel, { base }, 'カタログ/接続を確認');
    return r.path || null;
  };
  const grabShared = async (rel) => {
    if (!rel) {
      counters.unresolved++;
      return null;
    }
    const r = await sess.saveAsset(sharedDir, rel, { base }, 'カタログ/接続を確認');
    return r.path ? DIRS.shared + '/' + r.path : null;
  };
  const grabAbs = async (url, sub) => {
    const r = await sess.saveUrl(dir, { url, subpath: sub }, 'statics/接続を確認');
    return r.path || null;
  };
  const otherBgms = otherBgmList(idx).sort((a, b) => a.order - b.order);
  const home = await homeData();
  const bgmIconRel = new Map(home.homeBgm.concat(home.otherBgm).map((h) => [String(h.id), h.iconRel || null]));

  const tasks = [];
  for (const e of home.sceneIllust || [])
    tasks.push(async () => {
      const cg = await grabShared(e.cgRel);
      const voice = e.lines && e.lines.length ? await grab(e.voiceRel) : null;
      emit('sceneIllust', { id: e.id, name: e.name, order: e.order || 0, lines: e.lines || [], cg: cg || null, voice: voice || null });
    });
  for (const e of hi.comic || [])
    tasks.push(async () => {
      const url = staticsBase && e.asset ? `${staticsBase}/InGameStatics/LoadingImages/DDS/${e.asset}.dds` : null;
      const img = await grabAbs(url, `comic/${e.id}.dds`);
      emit('comic', { id: e.id, title: e.title, order: e.order || 0, img: img || null });
    });
  for (const e of [...(hi.homeBgm || []), ...otherBgms])
    tasks.push(async () => {
      const parts = assetRefs.bgmParts(sa, e.audio);
      const audio = await grabShared((parts && parts.loop) || null);
      const intro = parts && parts.intro ? await grabShared(parts.intro) : null;
      const iconRel = bgmIconRel.get(String(e.id));
      const icon = iconRel ? await grab(iconRel) : null;
      const section = /^x/.test(String(e.id)) ? 'otherBgm' : 'homeBgm';
      emit(section, { id: e.id, name: e.name, order: e.order || 0, audio: audio || null, intro: intro || null, icon: icon || null });
    });
  for (const e of home.background || [])
    tasks.push(async () => {
      const icon = e.iconRel ? await grab(e.iconRel) : null;
      const bg = e.sharedRel ? await grabShared(e.sharedRel) : e.bodyRel ? await grab(e.bodyRel) : null;
      emit('background', { id: e.id, name: e.name, desc: e.desc || '', source: e.source || '', order: e.order || 0, icon: icon || null, bg: bg || null });
    });
  for (const e of home.profileIcon || [])
    tasks.push(async () => {
      const icon = e.iconRel ? await grab(e.iconRel) : null;
      emit('profileIcon', { id: e.id, name: e.name, kind: e.kind, order: e.order || 0, icon: icon || null });
    });

  const total = tasks.length;
  let done = 0;
  let stopped = false;
  await utilHelpers.pool(tasks, DL_CONC.asset, async (t) => {
    if (sess.aborted) return;
    if (stop()) {
      stopped = true;
      return;
    }
    await t();
    done++;
    if (done % 5 === 0 || done === total)
      prog(`DL中 ${done}/${total}（新規${counters.got}件・既にあった分${counters.skip}件）`, total ? done / total : 1, { done, total, got: counters.got, skip: counters.skip, fail: counters.fail, missing: counters.missing });
  });
  if (sess.aborted) throw sess.aborted;
  const purged = await fileStore.purgeEmpty(dir);
  prog(
    `完了（新規${counters.got}件・既にあった分${counters.skip}件${counters.missing ? `・ゲーム側にデータが無い分${counters.missing}件` : ''}${counters.unresolved ? `・紐づけできなかった分${counters.unresolved}件` : ''}${
      counters.fail ? `・通信に失敗${counters.fail}件` : ''
    }${purged ? `・壊れた分を削除${purged}件` : ''}）`,
    1,
  );
  return { got: counters.got, skip: counters.skip, miss: counters.missing, unresolved: counters.unresolved, fail: counters.fail, purged, stopped };
}

export const acquireHome = { collectHome };
