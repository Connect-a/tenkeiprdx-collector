import { unityDecode } from '../../unity/decode.js';
import { fileStore } from '../../core/fsdir.js';
import { DIRS, SK, DL_CONC, OTHER_EPISODE_SUBTYPE } from '../../core/constants.js';
import { networkClient } from '../network.js';
import { dlSession } from '../dl-session.js';
import { ensureIndexes } from '../index-store.js';
import { folderModel, characterDetail } from '../folder-model.js';
import { userStateService } from '../user-state.js';
import { utilHelpers } from '../../core/util.js';
import { characterMeta } from '../character-meta.js';
import { assetRefs } from '../asset-refs.js';
import { ensureSharedSingletons } from './acquire-shared-res.js';
import { CFG } from '../../config.js';
import { fileNameOf } from '../../core/paths.js';
import { PLACE } from '../../core/placement.js';
import { assetStore } from '../asset-store.js';
const { assetRoot, fetchBytes, apiFetchBytes } = networkClient;
const { ownedLevels, unlockedPaidSet, clearedNodeSet, userLoaded } = userStateService;
const sleep = utilHelpers.sleep;
const pool = utilHelpers.pool;
const bytesToB64 = utilHelpers.bytesToB64;

async function distConfig() {
  let binUrl = '',
    email = '';
  try {
    const st = await chrome.storage.local.get([SK.binlistUrl, SK.email]);
    binUrl = (st[SK.binlistUrl] || '').trim();
    email = (st[SK.email] || '').trim();
  } catch (e) {}
  return { binUrl, email, valid: /^https?:\/\/\S+/.test(binUrl) && !!email };
}

function episodeLocked(ep, ctx) {
  if (ctx.paidSet && ep.paidMasterId != null && !ctx.paidSet.has(String(ep.paidMasterId))) return true;
  if (ctx.clearedSet) {
    if (!ctx.clearedLoaded) return true;
    if (!ctx.clearedSet.has(String(ep.episodeId))) return true;
  }
  const reqLevel = ctx.apiType === 'Character' ? (ctx.storyUnlockLevels || [])[(ep.order || 1) - 1] : null;
  if (ctx.level != null && reqLevel != null && ctx.level < reqLevel) return true;
  return false;
}

function extractSceneUrls(bytes, out) {
  const SCENE_URL = /production\/scenes\/(\d+)\.bin\?[A-Za-z0-9%=&._~:+-]+/g;
  for (const m of unityDecode.extractEmbeddedUrls(bytes, SCENE_URL)) if (!out[m[1]]) out[m[1]] = m[0];
}

async function postLog(items, group) {
  if (!CFG.receiverUrl || !items.length) return;
  const { email } = await distConfig();
  try {
    await fetch(CFG.receiverUrl + '/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, email, group: String(group) }) });
  } catch (e) {}
}
function sceneLogItem(sceneId, bytes) {
  return { url: `production/scenes/${sceneId}.bin`, base64: bytesToB64(bytes), base64Encoded: true, mime: 'application/octet-stream' };
}

async function readSavedScenes(dir, episodes, { contents = true } = {}) {
  const sceneBytes = {},
    servedByEp = {},
    choiceGroupsByEp = {};
  if (!contents) return { sceneBytes, servedByEp, choiceGroupsByEp };
  for (const ep of episodes) {
    const gd = await fileStore.readUnder(dir, `story/${ep.episodeId}/getDetails.bin`);
    if (gd) {
      const bytes = new Uint8Array(await gd.arrayBuffer());
      const served = {};
      try {
        extractSceneUrls(bytes, served);
      } catch (e) {}
      servedByEp[ep.episodeId] = Object.keys(served);
      try {
        const cg = unityDecode.extractChoiceGroups(bytes);
        if (cg && Object.keys(cg).length) choiceGroupsByEp[ep.episodeId] = cg;
      } catch (e) {}
    } else servedByEp[ep.episodeId] = null;
    for (const fn of await fileStore.listUnder(dir, `story/${ep.episodeId}`, { nonEmpty: true })) {
      const m = fn.match(/^scene_(\d+)\.bin$/);
      if (m) {
        const f = await fileStore.readUnder(dir, `story/${ep.episodeId}/${fn}`);
        if (f) sceneBytes[m[1]] = new Uint8Array(await f.arrayBuffer());
      }
    }
  }
  return { sceneBytes, servedByEp, choiceGroupsByEp };
}

const folderNameOf = (meta0, folderKey) => characterMeta.displayName(meta0) || folderKey;

async function planApiEpisodes(folderKey, opts) {
  const overwrite = !!(opts && opts.overwrite);
  const { folderMeta } = await folderModel();
  const meta0 = folderMeta[String(folderKey)];
  if (!meta0) return { apiType: null, episodes: [], dir: null };
  const apiType = meta0.apiType;
  const dir = await fileStore.getFolderDir(folderKey, folderNameOf(meta0, folderKey), { create: true, kind: meta0.rosterKind });
  if (!apiType || !dir) return { apiType, episodes: [], dir };
  const { sceneBytes, servedByEp } = await readSavedScenes(dir, meta0.episodes);
  const level = meta0.apiType === 'Character' ? ((await ownedLevels()).get(String(folderKey)) ?? 0) : null;

  const paid = meta0.apiType === 'Special' ? await unlockedPaidSet() : null;
  const cleared = meta0.apiType === 'Quest' ? await clearedNodeSet() : null;
  const clearedLoaded = meta0.apiType === 'Quest' ? await userLoaded() : true;
  const eps = [];
  for (const ep of meta0.episodes) {
    if (episodeLocked(ep, { apiType: meta0.apiType, level, storyUnlockLevels: CFG.storyUnlockLevels, clearedSet: cleared, clearedLoaded, paidSet: paid })) continue;
    const served = servedByEp[ep.episodeId];
    const need = new Set([...(ep.sceneBinIds || []).map(String), ...(served || [])]);
    const complete = served != null && [...need].every((sid) => sceneBytes[sid]);
    if (!complete || overwrite) eps.push({ episodeId: ep.episodeId, order: ep.order, subType: ep.subType });
  }
  return { apiType, episodes: eps, dir };
}

function detailUrls(apiType, episodeId, subType) {
  if (apiType === 'Special') {
    const paid = `${CFG.apiBase}/api/Episodes/${episodeId}/getPaidEpisodeDetails`;
    const special = `${CFG.apiBase}/api/Episodes/Quest/${episodeId}/getSpecialEpisodeDetails`;
    return subType === 'イベントエピソード' || subType === OTHER_EPISODE_SUBTYPE ? [special, paid] : [paid, special];
  }
  return [`${CFG.apiBase}/api/Episodes/${apiType}/${episodeId}/getDetails`];
}

async function apiFetchStory(dir, apiType, episodeId, subType, overwrite) {
  let b = null;
  for (const url of detailUrls(apiType, episodeId, subType)) {
    b = await apiFetchBytes(url, 'POST');
    if (b) break;
  }
  if (!b) return { ok: false, log: [] };
  if (dir) {
    try {
      await fileStore.writeUnder(dir, `story/${episodeId}/getDetails.bin`, b);
    } catch (e) {}
  }
  const sas = {};
  try {
    extractSceneUrls(b, sas);
  } catch (e) {}
  const log = [];

  for (const sid of Object.keys(sas)) {
    try {
      if (!overwrite && (await fileStore.exists(dir, `story/${episodeId}/scene_${sid}.bin`))) continue;
      if (!sas[sid]) continue;
      const r = await fetchBytes(CFG.masterDataBase + sas[sid]);
      if (r.status === 'missing') continue;
      if (r.status === 'ok' && r.bytes) {
        try {
          await fileStore.writeUnder(dir, `story/${episodeId}/scene_${sid}.bin`, r.bytes);
        } catch (e) {}
        log.push(sceneLogItem(sid, r.bytes));
      }
    } catch (e) {}
  }
  return { ok: true, log };
}

const GD_INTERVAL_MS = 3000;
async function collectStory(folderKey, progress, opts) {
  const o = opts || {};
  const plan = await planApiEpisodes(folderKey, { overwrite: o.overwrite });
  const eps = plan.episodes || [];
  const need = eps.length;
  if (o.onPlan) o.onPlan(need);
  if (!plan.dir || !plan.apiType || !need) return { got: 0, need, fail: 0, logged: 0, aborted: false };
  const prog = utilHelpers.safeProgress(progress);
  const wait = o.sleep || sleep;
  const interval = o.intervalMs != null ? o.intervalMs : GD_INTERVAL_MS;
  const stop = o.shouldAbort || (() => false);
  const log = [];
  let got = 0,
    fail = 0,
    aborted = false;
  try {
    for (let i = 0; i < need; i++) {
      if (stop()) {
        aborted = true;
        break;
      }
      if (i && interval > 0) {
        if (o.onWait) o.onWait(interval);
        await wait(interval);
        if (stop()) {
          aborted = true;
          break;
        }
      }
      const ep = eps[i];
      if (o.onEpisodeStart) o.onEpisodeStart(ep);
      const r = await apiFetchStory(plan.dir, plan.apiType, ep.episodeId, ep.subType, o.overwrite);
      if (r.ok) {
        got++;
        if (r.log && r.log.length) log.push(...r.log);
        prog(`ストーリー取得中… ${got}/${need}`, (0.15 * got) / need);
      } else fail++;
      if (o.onEpisode) o.onEpisode(ep, r);
    }
  } finally {
    if (log.length) {
      try {
        await postLog(log, folderKey);
      } catch (e) {}
    }
  }
  return { got, need, fail, logged: log.length, aborted };
}

let _binlistScenes = null;
async function binlistSceneSet({ force } = {}) {
  if (_binlistScenes && !force) return _binlistScenes;
  if (!force) {
    try {
      const { binlistScenes } = await chrome.storage.local.get(SK.binlistScenes);
      if (Array.isArray(binlistScenes)) {
        _binlistScenes = new Set(binlistScenes.map(String));
        return _binlistScenes;
      }
    } catch (e) {}
  }
  const set = new Set();
  try {
    const { binUrl, email, valid } = await distConfig();
    if (valid) {
      const url = binUrl + (binUrl.includes('?') ? '&' : '?') + 'id=' + encodeURIComponent(email);
      const res = await fetch(url);
      if (res.ok) {
        const d = await res.json();
        if (Array.isArray(d.scenes)) for (const s of d.scenes) set.add(String(s));
      }
    }
  } catch (e) {}
  _binlistScenes = set;
  try {
    await chrome.storage.local.set({ [SK.binlistScenes]: [...set] });
  } catch (e) {}
  return set;
}

async function clearBinlistScenes() {
  _binlistScenes = new Set();
  try {
    await chrome.storage.local.set({ [SK.binlistScenes]: [] });
  } catch (e) {}
  return _binlistScenes;
}

const HASH_STRIP = /_[0-9a-f]{16,}\.bundle$/i;
const refNameOf = (fn) => fn.replace(HASH_STRIP, '').replace(/\.bundle$/i, '');

async function createAcquireContext(folderKey, meta0, opts) {
  const download = !opts || opts.download !== false;
  const decode = download || !opts || opts.decode !== false;
  const overwrite = !!(opts && opts.overwrite);
  const dir = await fileStore.getFolderDir(folderKey, folderNameOf(meta0, folderKey), { create: download, kind: meta0.rosterKind });
  if (!dir) throw new Error('フォルダ権限がありません');

  const fails = [];
  const missing = [];
  const sess = dlSession.create({ overwrite });
  const baseUrl = await assetRoot();
  const grabAsset = async (targetDir, rel, place, label) => {
    const spec = { base: baseUrl, label, place };
    if (!download) return await assetStore.locate(targetDir, rel, place);
    const r = await sess.saveAsset(targetDir, rel, spec, '通信が不安定か、ゲーム側にデータが無い可能性があります');
    if (r.status === 'missing') missing.push(label || rel);
    else if (r.status === 'fail' && !r.retriable) fails.push(label || rel);
    return r.status === 'got' || r.status === 'skip' ? r.path : null;
  };

  let dist = null;
  if (download) {
    const cfg = await distConfig();
    if (cfg.valid) dist = { binUrl: cfg.binUrl.replace('/binlist', '/bin'), email: cfg.email };
  }

  const idx = await ensureIndexes();
  return {
    folderKey: String(folderKey),
    meta0,
    download,
    decode,
    overwrite,
    dir,
    sharedDir: await fileStore.getDir(DIRS.shared, { create: true }),
    base: baseUrl,
    idx,
    sceneAssets: idx.assets.sceneAssetIndex || {},
    itemIdx: idx.assets.itemIndex || {},
    itemIconNamed: idx.assets.itemIconNamed || {},
    sess,
    grabAsset,
    grabOwn: (rel, place, label) => grabAsset(dir, rel, place, label),
    jobs: [],
    fails,
    missing,
    missingVoices: [],
    castIds: new Set(),
    cgSetToEp: {},
    dist,
    distSet: dist ? await binlistSceneSet() : null,
  };
}

function planEpisodes(ctx, choiceGroupsByEp, gate, savedIds) {
  const orderedEpMetas = [];
  const work = [];
  for (const ep of ctx.meta0.episodes) {
    const epMeta = { episodeId: ep.episodeId, order: ep.order, chapter: ep.chapter || '', label: ep.label, title: ep.title, gate: 'open', have: 'none', lineCount: 0, voiced: 0, scenes: [] };
    if (choiceGroupsByEp && choiceGroupsByEp[ep.episodeId]) epMeta.choiceGroups = choiceGroupsByEp[ep.episodeId];
    orderedEpMetas.push(epMeta);
    if (episodeLocked(ep, gate)) {
      epMeta.gate = 'locked';
      const saved = savedIds && (ep.sceneBinIds || []).some((sid) => savedIds.has(String(sid)));
      if (!ctx.dist && !saved) continue;
    }
    work.push({ ep, epMeta });
  }
  return { orderedEpMetas, work };
}

async function decodeEpisodeScenes(ctx, ep, epMeta, sceneBytes, voice) {
  const used = { bg: new Set(), bgm: new Set(), se: new Set(), insert: new Set() };
  const queue = ep.sceneBinIds.map(String);
  const own = new Set(queue);
  const seen = new Set();
  while (queue.length) {
    const sid = String(queue.shift());
    if (seen.has(sid)) continue;
    seen.add(sid);
    let bin = sceneBytes[sid] || null;
    if (!bin && ctx.dist && ctx.distSet && ctx.distSet.has(sid)) {
      let r = null;
      try {
        r = await fetchBytes(`${ctx.dist.binUrl}${ctx.dist.binUrl.includes('?') ? '&' : '?'}id=${encodeURIComponent(ctx.dist.email)}&scene=${sid}`);
      } catch (e) {}
      if (r && r.status === 'ok' && r.bytes) {
        bin = r.bytes;
        try {
          await fileStore.writeUnder(ctx.dir, `story/${ep.episodeId}/scene_${sid}.bin`, bin);
        } catch (e) {}
      } else if (own.has(sid)) ctx.fails.push(`ストーリー本文 ${sid}`);
    }
    if (!bin) continue;
    let decoded, timeline;
    try {
      decoded = unityDecode.decodeSceneBin(bin);
      timeline = unityDecode.sceneToTimeline(decoded, sid);
    } catch (e) {
      console.warn('[tp] 台本の解析に失敗', sid, e);
      continue;
    }
    try {
      const next = unityDecode.sceneNext(decoded);
      if (next && !seen.has(next)) queue.push(next);
    } catch (e) {}

    epMeta.have = 'partial';
    epMeta.lineCount += timeline.count;
    for (const ln of timeline.lines) {
      if (ln.bg) used.bg.add(ln.bg);
      if (ln.bgm) {
        const cue = unityDecode.bgmCue(ln.bgm);
        if (!cue.stop) used.bgm.add(cue.name);
      }
    }
    try {
      for (const cm of (decoded[0] && decoded[0][4]) || []) {
        if (typeof cm[28] === 'string' && cm[28] && !/^no_?se$/i.test(cm[28])) used.se.add(cm[28]);
        if (cm[23] != null && cm[23] !== '' && (Number(cm[24]) || 0) !== 1) used.insert.add(String(cm[23]));
      }
    } catch (e) {}
    for (const id of timeline.castIds || []) ctx.castIds.add(id);
    if (ctx.download) {
      try {
        await fileStore.writeUnder(ctx.dir, `story/${ep.episodeId}/scene_${sid}.json`, JSON.stringify(timeline));
      } catch (e) {}
    }

    const sc = { sceneId: String(sid), timeline: `story/${ep.episodeId}/scene_${sid}.json`, scene: `story/${ep.episodeId}/scene_${sid}.bin`, voice: null };
    epMeta.scenes.push(sc);
    queueSceneVoice(ctx, ep, epMeta, sc, timeline, voice.adventure[sid]);
  }

  if (epMeta.have !== 'none') {
    const got = new Set(epMeta.scenes.map((s) => String(s.sceneId)));
    epMeta.have = ep.sceneBinIds.every((sid) => got.has(String(sid))) ? 'full' : 'partial';
  }
  return used;
}

function queueSceneVoice(ctx, ep, epMeta, sc, timeline, advHash) {
  const sid = sc.sceneId;
  const wantsVoice = timeline.lines.some((l) => l.voice);
  const noteMissing = () =>
    ctx.missingVoices.push({
      sceneId: sid,
      rosterKind: 'voice',
      hash: advHash || null,
      rel: advHash ? `adventurevoice_assets_adventurevoice/${sid}_${advHash}.bundle` : null,
      epId: String(ep.episodeId),
      epLabel: ep.label || '',
      epTitle: ep.title || '',
    });
  if (!advHash) {
    if (wantsVoice) noteMissing();
    return;
  }
  ctx.jobs.push(async () => {
    if (ctx.sess.aborted) return;
    const vrel = advHash ? `adventurevoice_assets_adventurevoice/${sid}_${advHash}.bundle` : null;
    const vplace = PLACE.episode(`story/${ep.episodeId}`, 'voice');
    const vpath = vrel ? await ctx.grabOwn(vrel, vplace, `voice ${sid}`) : null;
    const ok = !!vpath;
    if (ok) {
      sc.voice = vpath;
      epMeta.voiced++;
    } else if (wantsVoice) noteMissing();
  });
}

function queueAssetGrab(ctx, { rel, label, sharedFirst, episodeDir, sharedPlace, onGot, onFail }) {
  ctx.jobs.push(async () => {
    if (ctx.sess.aborted) return;
    const shared = !!(sharedFirst && ctx.sharedDir);
    const p = shared ? await ctx.grabAsset(ctx.sharedDir, rel, sharedPlace || null, label) : await ctx.grabOwn(rel, episodeDir, label);
    if (p) onGot(shared ? `${DIRS.shared}/${p}` : p);
    else if (onFail) onFail();
  });
}

function queueEpisodeAssets(ctx, ep, epMeta, used, routing) {
  const epDir = `story/${ep.episodeId}`;

  for (const id of used.insert) {
    const rel = ctx.itemIdx[id];
    if (!rel) {
      routing.unresolved.push('insert:' + id);
      continue;
    }
    queueAssetGrab(ctx, {
      rel,
      label: `insert ${id}`,
      sharedFirst: true,
      episodeDir: PLACE.episode(epDir, 'cg'),
      onGot: (path) => ((epMeta.cg || (epMeta.cg = {}))[id] = path),
    });
  }

  for (const name of used.bg) {
    const m = String(name).match(/^(\d{8}_\d+)_still/);
    if (m) ctx.cgSetToEp[m[1]] = ep.episodeId;
  }
  for (const name of used.bg) {
    const rel = ctx.sceneAssets[name];
    if (!rel) {
      routing.unresolved.push(name);
      continue;
    }
    queueAssetGrab(ctx, {
      rel,
      label: `bg ${name}`,
      sharedFirst: /^bg_(adventure|eventstill)_/i.test(name),
      episodeDir: PLACE.episode(epDir, 'bg'),
      onGot: (path) => (epMeta.bg[name] = path),
      onFail: () => routing.dlFailed.push(name),
    });
    const trel = /^bg_eventstill_/.test(name) ? ctx.itemIconNamed[name] : null;
    if (trel) {
      ctx.jobs.push(async () => {
        if (ctx.sess.aborted) return;
        await ctx.grabOwn(trel, PLACE.episode(epDir, 'cgthumb'), `cgthumb ${name}`);
      });
    }
  }

  for (const name of used.bgm) {
    const parts = assetRefs.bgmParts(ctx.sceneAssets, name);
    if (!parts) {
      routing.unresolved.push('bgm:' + name);
      continue;
    }
    const fetchPart = async (suf) => {
      const rel = ctx.sceneAssets[name + suf];
      if (!rel) return null;
      const label = `bgm ${name}${suf}`;
      if (ctx.sharedDir) {
        const sp2 = await ctx.grabAsset(ctx.sharedDir, rel, null, label);
        return sp2 ? `${DIRS.shared}/${sp2}` : null;
      }
      return await ctx.grabOwn(rel, PLACE.episode(epDir, 'bgm'), label);
    };
    ctx.jobs.push(async () => {
      if (ctx.sess.aborted) return;
      const main = await fetchPart(parts.split ? '_loop' : '');
      if (!main) {
        routing.dlFailed.push('bgm:' + name);
        return;
      }
      epMeta.bgm[name] = main;
      const intro = parts.split ? await fetchPart('_intro') : null;
      if (intro) epMeta.bgmIntro[name] = intro;
    });
  }

  for (const name of used.se) {
    const rel = ctx.sceneAssets['se:' + name.toLowerCase()];
    if (!rel) {
      routing.unresolved.push('se:' + name);
      continue;
    }
    const fn = fileNameOf(rel);
    queueAssetGrab(ctx, {
      rel,
      label: `se ${name}`,
      sharedFirst: true,
      episodeDir: PLACE.episode(epDir, 'se'),
      onGot: (path) => (epMeta.se[name] = path),
      onFail: () => routing.dlFailed.push('se:' + name),
    });
  }
}

function queueCardVisuals(ctx, meta, orderedEpMetas) {
  const { idx, folderKey } = ctx;
  const assetsManifest = meta.assets;
  const epMetaById = {};
  for (const em of orderedEpMetas) epMetaById[String(em.episodeId)] = em;

  for (const { cat, rel } of assetRefs.visualAssetsForCard(idx, ctx.meta0, folderKey)) {
    const fn = fileNameOf(rel);
    ctx.jobs.push(async () => {
      if (ctx.sess.aborted) return;
      const p = await ctx.grabOwn(rel, PLACE.visual(cat), `${cat} ${fn}`);
      if (p) (assetsManifest[cat] || (assetsManifest[cat] = {}))[refNameOf(fn)] = p;
    });
  }

  const a = idx.assets.assetIndex[folderKey] || {};
  for (const cat of ['still', 'illustx']) {
    for (const rel of a[cat] || []) {
      ctx.jobs.push(async () => {
        if (ctx.sess.aborted) return;
        const fn = fileNameOf(rel);
        const rn = refNameOf(fn);
        const m = rn.match(/^(\d{8}_\d+)/);
        const epId = m ? ctx.cgSetToEp[m[1]] : null;
        const em = epId ? epMetaById[String(epId)] : null;
        if (cat === 'still' && !em) return;
        const sub = await ctx.grabOwn(rel, em ? PLACE.episode(`story/${epId}`, 'cg') : PLACE.visual(cat), `${cat} ${fn}`);
        if (!sub) return;
        if (em) (em.cg || (em.cg = {}))[rn] = sub;
        else (assetsManifest[cat] || (assetsManifest[cat] = {}))[rn] = sub;
      });
    }
  }

  if (ctx.meta0.apiType !== 'Character') return;
  const det = idx.master.characters[folderKey];
  const weapons = (det && det.weapons) || [];
  if (weapons.length) assetsManifest.weapon = assetsManifest.weapon || {};
  for (const w of weapons) {
    const wIdx = idx.assets.assetIndex[String(w.weaponId)];
    if (!wIdx) continue;
    const modelRel = (wIdx.model || [])[0];
    const matRel = assetRefs.resolveVariationMaterial(idx.meta.matVariation, String(w.weaponId), w.variation, wIdx.materials || []) || (wIdx.materials || [])[0];
    const wrec = { slot: w.slot || 'wp_2', scale: w.scale || 1 };
    ctx.jobs.push(async () => {
      if (ctx.sess.aborted) return;
      const mp = modelRel ? await ctx.grabOwn(modelRel, PLACE.fixed('visual/weapon/', `${w.weaponId}_model`), `weapon model ${w.weaponId}`) : null;
      if (mp) wrec.model = mp;
      const tp = matRel ? await ctx.grabOwn(matRel, PLACE.fixed('visual/weapon/', `${w.weaponId}_mat`), `weapon mat ${w.weaponId}`) : null;
      if (tp) wrec.materials = tp;
      if (wrec.model) assetsManifest.weapon[String(w.weaponId)] = wrec;
    });
  }
}

function queueCastSpines(ctx, routing) {
  routing.cast = {};
  routing.unresolvedCast = [];
  const aidx = ctx.idx.assets.assetIndex;
  for (const id of [...ctx.castIds].map(String)) {
    if (id === ctx.folderKey) continue;
    ctx.jobs.push(async () => {
      if (ctx.sess.aborted) return;
      const a2 = aidx[id];
      if (!a2 || !ctx.sharedDir) {
        routing.unresolvedCast.push(id);
        return;
      }
      const c = ctx.idx.master.characters[id];
      const rec = { name: (c && c.name) || '', title: (c && c.title) || '' };
      for (const cat of ['spine', 'spinelight']) {
        const rel = (a2[cat] || [])[0];
        if (!rel) continue;
        const cp = await ctx.grabAsset(ctx.sharedDir, rel, null, `${cat} ${id}`);
        if (cp) rec[cat] = `${DIRS.shared}/${cp}`;
      }
      if (rec.spine || rec.spinelight) routing.cast[id] = rec;
      else routing.unresolvedCast.push(id);
    });
  }
}

function summarizeCompleteness(ctx, meta, orderedEpMetas, routing) {
  const sum = (fn) => orderedEpMetas.reduce((n, e) => n + fn(e), 0);
  return {
    episodesTotal: orderedEpMetas.length,
    episodesHave: orderedEpMetas.filter((e) => e.have !== 'none').length,
    episodesPartial: orderedEpMetas.filter((e) => e.have === 'partial').length,
    episodesLocked: orderedEpMetas.filter((e) => e.gate === 'locked').length,
    sceneBgResolved: sum((e) => Object.keys(e.bg || {}).length),
    sceneBgm: sum((e) => Object.keys(e.bgm || {}).length),
    sceneUnresolved: routing.unresolved.length,
    sceneDlFailed: routing.dlFailed.length,
    castTotal: ctx.castIds.size,
    castResolved: Object.keys(routing.cast).length,
    castUnresolved: routing.unresolvedCast.length,
    voicedScenes: sum((e) => e.voiced),
    missingVoices: ctx.missingVoices.length,
    assetCategories: Object.keys(meta.assets).length,
    missing: ctx.missing.length,
    transientFails: ctx.fails.length,
  };
}

async function saveFailureReport(storageKey, folderKey, meta, rows) {
  try {
    const state = await chrome.storage.local.get(storageKey);
    const store = state[storageKey] || { updatedAt: 0, chars: {} };
    if (rows.length) {
      const c = { name: meta.name || '', title: meta.title || '', rosterKind: meta.rosterKind, stories: {} };
      for (const r of rows) {
        const st = c.stories[r.epId] || (c.stories[r.epId] = { label: r.epLabel, title: r.epTitle, scenes: {} });
        st.scenes[r.sceneId] = r.scene;
      }
      store.chars[String(folderKey)] = c;
    } else {
      delete store.chars[String(folderKey)];
    }
    store.updatedAt = Date.now();
    await chrome.storage.local.set({ [storageKey]: store });
  } catch (e) {}
}

function sortManifest(manifest) {
  const out = {};
  for (const cat of Object.keys(manifest).sort()) {
    const rec = manifest[cat];
    if (!rec || typeof rec !== 'object') {
      out[cat] = rec;
      continue;
    }
    const inner = {};
    for (const k of Object.keys(rec).sort()) inner[k] = rec[k];
    out[cat] = inner;
  }
  return out;
}

async function findMissingScenes(ctx, work, servedByEp) {
  const out = [];
  for (const { ep } of work) {
    for (const sid of servedByEp[ep.episodeId] || []) {
      if (!(await fileStore.exists(ctx.dir, `story/${ep.episodeId}/scene_${sid}.bin`))) out.push({ sceneId: String(sid), epId: String(ep.episodeId), epLabel: ep.label || '', epTitle: ep.title || '' });
    }
  }
  return out;
}

async function downloadCharacterAssets(folderKey, progress, opts) {
  const { voice, folderMeta } = await folderModel();
  const meta0 = folderMeta[String(folderKey)];
  if (!meta0) throw new Error('index に無いキー: ' + folderKey);
  const prog = utilHelpers.safeProgress(progress);
  const ctx = await createAcquireContext(folderKey, meta0, opts);
  const { sceneBytes, servedByEp, choiceGroupsByEp } = await readSavedScenes(ctx.dir, meta0.episodes, { contents: ctx.decode });

  const level = meta0.apiType === 'Character' ? ((await ownedLevels()).get(ctx.folderKey) ?? 0) : null;
  const gate = {
    apiType: meta0.apiType,
    level,
    storyUnlockLevels: CFG.storyUnlockLevels,
    clearedSet: meta0.apiType === 'Quest' ? await clearedNodeSet() : null,
    clearedLoaded: meta0.apiType === 'Quest' ? await userLoaded() : true,
    paidSet: meta0.apiType === 'Special' ? await unlockedPaidSet() : null,
  };
  const { orderedEpMetas, work } = planEpisodes(ctx, choiceGroupsByEp, gate, new Set(Object.keys(sceneBytes)));

  const routing = { unresolved: [], dlFailed: [] };
  const meta = {
    id: ctx.folderKey,
    apiType: meta0.apiType,
    rosterKind: meta0.rosterKind,
    name: meta0.name,
    title: meta0.title || '',
    chapter: meta0.chapter || '',
    attachmentColors: meta0.attachmentColors,
    level: level != null ? level : undefined,
    storyUnlockLevels: CFG.storyUnlockLevels || null,
    episodes: orderedEpMetas,
    voiceGallery: null,
    assets: {},
    routing,
    builtAt: Date.now(),
  };

  if (ctx.decode) {
    let parsed = 0;
    await pool(work, DL_CONC.decode, async ({ ep, epMeta }) => {
      if (ctx.sess.aborted) return;
      Object.assign(epMeta, { bg: {}, bgm: {}, bgmIntro: {}, se: {} });
      const used = await decodeEpisodeScenes(ctx, ep, epMeta, sceneBytes, voice);
      queueEpisodeAssets(ctx, ep, epMeta, used, routing);
      parsed++;
      prog(`解析中… ${parsed}/${work.length}`, 0.15 + 0.15 * (work.length ? parsed / work.length : 1));
    });
  } else {
    const byId = new Map(orderedEpMetas.map((m) => [String(m.episodeId), m]));
    for (const ep of ctx.meta0.episodes) {
      const epMeta = byId.get(String(ep.episodeId));
      if (!epMeta) continue;
      const ids = (ep.sceneBinIds || []).map(String);
      const names = new Set(await fileStore.listUnder(ctx.dir, `story/${ep.episodeId}`, { nonEmpty: true }));
      epMeta.have = !ids[0] || !names.has(`scene_${ids[0]}.bin`) ? 'none' : ids.every((sid) => names.has(`scene_${sid}.bin`)) ? 'full' : 'partial';
    }
  }

  const charHash = meta0.apiType === 'Character' ? voice.character[ctx.folderKey] : null;
  if (charHash) {
    ctx.jobs.push(async () => {
      if (ctx.sess.aborted) return;
      const cvrel = charHash ? `charactervoices_assets_charactervoices/${folderKey}_${charHash}.bundle` : null;
      const cvp = cvrel ? await ctx.grabOwn(cvrel, PLACE.fixed('', 'voice_gallery'), 'charvoice') : null;
      const ok = !!cvp;
      if (ok) meta.voiceGallery = { bundle: cvp };
    });
  }

  queueCardVisuals(ctx, meta, orderedEpMetas);
  if (ctx.download) {
    ctx.jobs.push(async () => {
      if (ctx.sess.aborted) return;
      await ensureSharedSingletons(ctx.sharedDir, ctx.base, ctx.idx, (rel) => ctx.grabAsset(ctx.sharedDir, rel, null), { includeStage: true });
    });
  }
  queueCastSpines(ctx, routing);

  prog('ダウンロード中…', 0.3);
  let dlDone = 0;
  const dlTotal = ctx.jobs.length;
  await pool(ctx.jobs, DL_CONC.asset, async (job) => {
    await job();
    dlDone++;
    prog(`ダウンロード中… ${dlDone}/${dlTotal}`, 0.3 + 0.65 * (dlTotal ? dlDone / dlTotal : 1));
  });

  if (ctx.sess.deferred.length) {
    const n = ctx.sess.deferred.length;
    const res = await ctx.sess.flushDeferred((i) => prog(`取り直し中… ${i}/${n}`, 0.96));
    for (const label of res.stillFailed) if (label) ctx.fails.push(label);
  }

  meta.assets = sortManifest(meta.assets);

  const selfRec = {};
  for (const cat of ['spine', 'spinelight']) if (meta.assets[cat] && meta.assets[cat][ctx.folderKey]) selfRec[cat] = meta.assets[cat][ctx.folderKey];
  if (Object.keys(selfRec).length) routing.cast[ctx.folderKey] = selfRec;
  if (ctx.download && ctx.sharedDir && Object.keys(selfRec).length) {
    const own = ctx.idx.assets.assetIndex[ctx.folderKey] || {};
    await Promise.all(['spine', 'spinelight'].flatMap((cat) => (own[cat] || []).map((rel) => assetStore.removeAsset(ctx.sharedDir, rel))));
  }

  if (meta0.apiType === 'Character') {
    try {
      meta.profile = await characterDetail(ctx.folderKey);
      if (meta.profile) {
        if (meta.voiceGallery && meta.profile.voiceMessages) meta.voiceGallery.messages = meta.profile.voiceMessages;
        delete meta.profile.voiceMessages;
      }
    } catch (e) {}
  }

  meta.completeness = summarizeCompleteness(ctx, meta, orderedEpMetas, routing);
  meta.visuals = characterMeta.buildVisuals(meta);
  const result = { folderKey: ctx.folderKey, meta, fails: ctx.fails, missing: ctx.missing, missingVoices: ctx.missingVoices, downloaded: ctx.sess.counters.got };
  if (!ctx.download) return result;
  result.purged = await fileStore.purgeEmpty(ctx.dir);

  const shortfall = routing.unresolved.length + routing.dlFailed.length;
  prog(
    `完了${ctx.fails.length ? '・通信に失敗' + ctx.fails.length : ''}${ctx.missing.length ? '・データ無し' + ctx.missing.length : ''}${shortfall ? '・背景など不足' + shortfall : ''}${routing.unresolvedCast.length ? '・立ち絵不足' + routing.unresolvedCast.length : ''}`,
    1,
  );
  await saveFailureReport(
    SK.cdnMissing,
    folderKey,
    meta,
    ctx.missingVoices.map((mv) => ({ ...mv, scene: { rosterKind: mv.rosterKind, hash: mv.hash, url: mv.url } })),
  );
  await saveFailureReport(
    SK.missingScenes,
    folderKey,
    meta,
    (await findMissingScenes(ctx, work, servedByEp)).map((ms) => ({ ...ms, scene: { rosterKind: 'scene' } })),
  );
  return result;
}

async function charMeta(folderKey) {
  const r = await downloadCharacterAssets(folderKey, null, { download: false, decode: false });
  return r && r.meta;
}
async function charMetaFull(folderKey, progress) {
  const r = await downloadCharacterAssets(folderKey, progress, { download: false });
  return r && r.meta;
}

export const acquireCore = { downloadCharacterAssets, charMeta, charMetaFull, collectStory, binlistSceneSet, clearBinlistScenes };
