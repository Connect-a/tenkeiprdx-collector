'use strict';
(function () {
  const CFG = globalThis.TP_CONFIG;
  const DECODE = globalThis.TP_DECODE;
  const FS = globalThis.TP_FS;
  const { MISSING, assetRoot, resolveVoiceBase, adventureVoiceUrl, characterVoiceUrl, fetchBytes, apiFetchBytes } = globalThis.TP_NET;
  const { ensureIndexes, indexes, characterDetail, ownedLevels, unlockedPaidSet, clearedNodeSet } = globalThis.TP_COLLECTION;
  const assetIndex = async () => (await ensureIndexes()).assetIndex;
  const sharedIndex = async () => (await ensureIndexes()).sharedIndex;
  const sceneAssetIndex = async () => (await ensureIndexes()).sceneAssetIndex;
  const latin1 = globalThis.TP_UTIL.latin1;
  const MOUTH_ATLAS_SUB = '3d/mouthmaterials.bundle';
  const sleep = globalThis.TP_UTIL.sleep;
  async function pool(items, limit, worker) {
    const out = new Array(items.length);
    let next = 0;
    const runner = async () => { while (true) { const i = next++; if (i >= items.length) return; out[i] = await worker(items[i], i); } };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
    return out;
  }
  const bytesToB64 = globalThis.TP_UTIL.bytesToB64;
  const decodeUserBytes = globalThis.TP_UTIL.decodeUserBytes;

  function extractSceneUrls(bytes, out) {
    let vals = null;
    try { vals = decodeUserBytes(bytes); } catch (e) {}
    let found = 0;
    if (vals) (function walk(x) {
      if (typeof x === 'string') { const m = x.match(/production\/scenes\/(\d+)\.bin\?[^\s"'\\]+/); if (m) { out[m[1]] = m[0]; found++; } }
      else if (Array.isArray(x)) x.forEach(walk);
    })(vals);
    if (found) return;
    const s = latin1.decode(bytes);
    const re = /production\/scenes\/(\d+)\.bin\?[A-Za-z0-9%=&._~:+\/-]+/g; let m;
    while ((m = re.exec(s)) !== null) out[m[1]] = m[0];
  }


  async function postLog(items, group) {
    if (!CFG.receiverUrl || !items.length) return;
    const email = (await chrome.storage.local.get('email')).email || '';
    try { await fetch(CFG.receiverUrl + '/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, email, group: String(group) }) }); } catch (e) {}
  }
  function sceneLogItem(sceneId, bytes) {
    return { url: `production/scenes/${sceneId}.bin`, base64: bytesToB64(bytes), base64Encoded: true, mime: 'application/octet-stream' };
  }

  async function buildSharedResources(progress) {
    const list = await sharedIndex();
    const base = await assetRoot();
    const dir = await FS.getDir('_共有リソース', true);
    if (!dir) throw new Error('フォルダ権限がありません');
    const prog = (m, f) => { try { progress && progress(m, f); } catch (e) {} };
    let done = 0, got = 0, skip = 0, fail = 0;
    const FAIL_CAP = 20;
    let aborted = null;
    const CONC = 8;
    await pool(list, CONC, async (sub) => {
      if (aborted) return;
      if (await FS.exists(dir, sub)) { skip++; done++; if (done % 30 === 0) prog(`確認中 ${done}/${list.length}（取得${got}/既存${skip}/失敗${fail}）`, done / list.length); return; }
      let bytes = null;
      try { bytes = await fetchBytes(`${base}/${sub}`); } catch (e) { if (e && e.auth) { aborted = e; return; } }
      done++;
      if (!bytes) { if (++fail >= FAIL_CAP) aborted = new Error(`失敗${FAIL_CAP}件で中断（リスト誤りの可能性）`); return; }
      try { await FS.writeUnder(dir, sub, bytes); got++; } catch (e) {}
      if (done % 5 === 0) prog(`DL中 ${done}/${list.length}（取得${got}/既存${skip}/失敗${fail}）`, done / list.length);
    });
    if (aborted) throw aborted;
    try {
      const idx = await ensureIndexes();
      const mouthRel = idx.globalAssets && idx.globalAssets.mouthAtlas;
      const msub = MOUTH_ATLAS_SUB;
      if (mouthRel && !(await FS.exists(dir, msub))) {
        const mb = await fetchBytes(`${base}/Assets/WebGL/${mouthRel}`);
        if (mb) { try { await FS.writeUnder(dir, msub, mb); got++; } catch (e) {} }
      }
    } catch (e) {}
    try { await chrome.storage.local.set({ sharedDlAt: Date.now() }); } catch (e) {}
    prog(`完了 取得${got} / 既存${skip} / 失敗${fail} / 全${list.length}`, 1);
    return { got, skip, fail, total: list.length };
  }

  async function readMouthAtlas() {
    const dir = await FS.getDir('_共有リソース', false);
    if (!dir) return null;
    const existing = await FS.readUnder(dir, MOUTH_ATLAS_SUB);
    return existing ? new Uint8Array(await existing.arrayBuffer()) : null;
  }

  async function sharedResourcesPresent() {
    try { if ((await chrome.storage.local.get('sharedDlAt')).sharedDlAt) return true; } catch (e) {}
    try {
      const dir = await FS.getDir('_共有リソース', false);
      if (!dir) return false;
      if (await FS.exists(dir, MOUTH_ATLAS_SUB)) return true;
      const assets = await dir.getDirectoryHandle('Assets', { create: false }).catch(() => null);
      const webgl = assets && await assets.getDirectoryHandle('WebGL', { create: false }).catch(() => null);
      if (!webgl) return false;
      for await (const [name, e] of webgl.entries()) { if (e.kind === 'directory' && /^(fontassets|uispritesassets|scenariolayouts|uicomponentspartsassets|builtinaudio|vfxmaterialassets)/i.test(name)) return true; }
      return false;
    } catch (e) { return false; }
  }

  async function downloadMouthAtlas() {
    const dir = await FS.getDir('_共有リソース', true);
    if (!dir) return null;
    const msub = MOUTH_ATLAS_SUB;
    const existing = await FS.readUnder(dir, msub);
    if (existing) return new Uint8Array(await existing.arrayBuffer());
    const base = await assetRoot();
    let mouthRel = null;
    try { const g = (await ensureIndexes()).globalAssets; mouthRel = g && g.mouthAtlas; } catch (e) {}
    if (!mouthRel) {
      try {
        const j = await (await fetch(`${base}/Assets/WebGL/3dModels_catalog.json`)).json();
        for (const id of (j.m_InternalIds || [])) { const m = String(id).match(/materialsbundles_assets_assets\/mouthmaterials_[0-9a-f]{16,}\.bundle$/); if (m) { mouthRel = m[0]; break; } }
      } catch (e) {}
    }
    if (!mouthRel) return null;
    let bytes = null;
    try { const r = await fetch(`${base}/Assets/WebGL/${mouthRel}`); if (r.ok) bytes = new Uint8Array(await r.arrayBuffer()); } catch (e) {}
    if (!bytes) return null;
    try { await FS.writeUnder(dir, msub, bytes); } catch (e) {}
    return bytes;
  }

  async function readSavedScenes(dir, episodes) {
    const sceneBytes = {}, servedByEp = {};
    for (const ep of episodes) {
      const gd = await FS.readUnder(dir, `story/${ep.id}/getDetails.bin`);
      if (gd) { const served = {}; try { extractSceneUrls(new Uint8Array(await gd.arrayBuffer()), served); } catch (e) {} servedByEp[ep.id] = Object.keys(served); }
      else servedByEp[ep.id] = null;
      for (const fn of await FS.listUnder(dir, `story/${ep.id}`)) {
        const m = fn.match(/^scene_(\d+)\.bin$/);
        if (m) { const f = await FS.readUnder(dir, `story/${ep.id}/${fn}`); if (f) sceneBytes[m[1]] = new Uint8Array(await f.arrayBuffer()); }
      }
    }
    return { sceneBytes, servedByEp };
  }

  const folderNameOf = (meta0, folderKey) => (meta0.type === 'character' && meta0.title) ? `${meta0.name || folderKey}${meta0.title}` : (meta0.name || folderKey);

  const apiTypeOf = (type) => type === 'quest' ? 'Quest' : type === 'character' ? 'Character' : type === 'special' ? 'Special' : null;

  async function planApiEpisodes(folderKey) {
    const { folderMeta } = await indexes();
    const meta0 = folderMeta[String(folderKey)];
    if (!meta0) return { apiType: null, episodes: [], dir: null, type: null };
    const apiType = apiTypeOf(meta0.type);
    const dir = await FS.getCharDir(folderKey, folderNameOf(meta0, folderKey), true);
    if (!apiType || !dir) return { apiType, episodes: [], dir, type: meta0.type };
    const { sceneBytes, servedByEp } = await readSavedScenes(dir, meta0.episodes);
    const level = meta0.type === 'character' ? ((await ownedLevels()).get(String(folderKey)) ?? 0) : null;

    const paid = meta0.type === 'special' ? await unlockedPaidSet() : null;
    const cleared = meta0.type === 'quest' ? await clearedNodeSet() : null;
    const eps = [];
    for (const ep of meta0.episodes) {
      if (paid && !paid.has(String(ep.paidMasterId))) continue;
      if (cleared && cleared.size && !cleared.has(String(ep.id))) continue;
      const reqLevel = meta0.type === 'character' ? (CFG.storyUnlockLevels || [])[(ep.order || 1) - 1] : null;
      if (level != null && reqLevel != null && level < reqLevel) continue;

      const served = servedByEp[ep.id];
      const need = new Set([...(ep.sceneBinIds || []).map(String), ...(served || [])]);
      const complete = served != null && [...need].every((sid) => sceneBytes[sid]);
      if (!complete) eps.push({ id: ep.id, order: ep.order, subType: ep.subType });
    }
    return { apiType, episodes: eps, dir, type: meta0.type };
  }

  function detailUrls(apiType, episodeId, subType) {
    if (apiType === 'Special') {
      const paid = `${CFG.apiBase}/api/Episodes/${episodeId}/getPaidEpisodeDetails`;
      const special = `${CFG.apiBase}/api/Episodes/Quest/${episodeId}/getSpecialEpisodeDetails`;
      return subType === 'イベントエピソード' ? [special, paid] : [paid, special];
    }
    return [`${CFG.apiBase}/api/Episodes/${apiType}/${episodeId}/getDetails`];
  }

  async function apiFetchStory(dir, apiType, episodeId, subType) {
    let b = null;
    for (const url of detailUrls(apiType, episodeId, subType)) { b = await apiFetchBytes(url, 'POST'); if (b) break; }
    if (!b) return { ok: false, log: [] };
    if (dir) { try { await FS.writeUnder(dir, `story/${episodeId}/getDetails.bin`, b); } catch (e) {} }
    const sas = {};
    try { extractSceneUrls(b, sas); } catch (e) {}
    const log = [];

    for (const sid of Object.keys(sas)) {
      try {
        if (await FS.exists(dir, `story/${episodeId}/scene_${sid}.bin`)) continue;
        if (!sas[sid]) continue;
        const r = await fetchBytes(CFG.masterDataBase + sas[sid], true);
        if (r === MISSING) continue;
        if (r) { try { await FS.writeUnder(dir, `story/${episodeId}/scene_${sid}.bin`, r); } catch (e) {} log.push(sceneLogItem(sid, r)); }
      } catch (e) {}
    }
    return { ok: true, log };
  }

  const GD_GAP_MS = 3000;
  const LOG_FLUSH = 10;
  async function collectStory(folderKey, progress) {
    const plan = await planApiEpisodes(folderKey);
    if (!plan.dir || !plan.apiType || !plan.episodes.length) return { got: 0, need: 0 };
    const prog = (m, f) => { try { progress && progress(m, f); } catch (e) {} };
    const eps = plan.episodes; const need = eps.length; let got = 0; let batch = [];
    const flush = async () => { if (batch.length) { const b = batch; batch = []; try { await postLog(b, folderKey); } catch (e) {} } };
    try {
      for (let i = 0; i < eps.length; i++) {
        if (i) await sleep(GD_GAP_MS);
        const r = await apiFetchStory(plan.dir, plan.apiType, eps[i].id, eps[i].subType);
        if (r.ok) { got++; if (r.log && r.log.length) batch.push(...r.log); if (batch.length >= LOG_FLUSH) await flush(); prog(`ストーリー取得中… ${got}/${need}`, 0.15 * got / need); }
      }
    } finally { await flush(); }
    return { got, need };
  }

  let _binlistScenes = null;
  async function binlistSceneSet(force) {
    if (_binlistScenes && !force) return _binlistScenes;
    if (!force) {
      try { const { binlistScenes } = await chrome.storage.local.get('binlistScenes'); if (Array.isArray(binlistScenes)) { _binlistScenes = new Set(binlistScenes.map(String)); return _binlistScenes; } } catch (e) {}
    }
    const set = new Set();
    try {
      const st = await chrome.storage.local.get(['binlistUrl', 'email']);
      const binlist = (st.binlistUrl || '').trim();
      const email = (st.email || '').trim();
      if (/^https?:\/\/\S+/.test(binlist) && email) {
        const url = binlist + (binlist.includes('?') ? '&' : '?') + 'id=' + encodeURIComponent(email);
        const res = await fetch(url);
        if (res.ok) { const d = await res.json(); if (Array.isArray(d.scenes)) for (const s of d.scenes) set.add(String(s)); }
      }
    } catch (e) {}
    _binlistScenes = set;
    try { await chrome.storage.local.set({ binlistScenes: [...set] }); } catch (e) {}
    return set;
  }
  function binlistEpisodesCovered(meta, distSet) {
    if (!meta || !distSet || !distSet.size) return 0;
    let n = 0;
    for (const ep of (meta.episodes || [])) { const ids = ep.sceneBinIds || []; if (ids.length && ids.every((sid) => distSet.has(String(sid)))) n++; }
    return n;
  }

  const HASH_STRIP = /_[0-9a-f]{16,}\.bundle$/i;
  const refNameOf = (fn) => fn.replace(HASH_STRIP, '').replace(/\.bundle$/i, '');
  const relOf = (sub) => sub.replace(/^Assets\/WebGL\//, '');

  async function downloadCharacterAssets(folderKey, progress, opts) {
    opts = opts || {};
    const { voice, folderMeta } = await indexes();
    const meta0 = folderMeta[String(folderKey)];
    if (!meta0) throw new Error('index に無いキー: ' + folderKey);
    const prog = (m, f) => { try { progress && progress(m, f); } catch (e) {} };
    const dir = await FS.getCharDir(folderKey, folderNameOf(meta0, folderKey), true);
    if (!dir) throw new Error('フォルダ権限がありません');
    const { sceneBytes } = await readSavedScenes(dir, meta0.episodes);
    const level = meta0.type === 'character' ? ((await ownedLevels()).get(String(folderKey)) ?? 0) : null;
    const clearedSet = meta0.type === 'quest' ? await clearedNodeSet() : null;
    const sceneAssets = await sceneAssetIndex();
    const base = await assetRoot();
    const fails = [], missing = [], missingVoices = [];
    let dlCount = 0;
    let dist = null;
    try {
      const st = await chrome.storage.local.get(['binlistUrl', 'email']);
      const binlist = (st.binlistUrl || '').trim();
      const distEmail = (st.email || '').trim();
      if (/^https?:\/\/\S+/.test(binlist) && distEmail) dist = { binUrl: binlist.replace('/binlist', '/bin'), email: distEmail };
    } catch (e) {}
    const distSet = dist ? await binlistSceneSet() : null;
    const grabTo = async (targetDir, url, subpath, label) => {
      if (!targetDir) { fails.push(label || subpath); return false; }
      if (await FS.exists(targetDir, subpath)) return true;
      const b = await fetchBytes(url, true);
      if (b === MISSING) { missing.push(label || subpath); return false; }
      if (!b) { fails.push(label || subpath); return false; }
      try { await FS.writeUnder(targetDir, subpath, b); dlCount++; return true; } catch (e) { fails.push(label || subpath); return false; }
    };
    const grab = (url, subpath, label) => grabTo(dir, url, subpath, label);
    const DL_CONC = 12;

    const routing = { unresolved: [] };
    const assetsManifest = {};
    const meta = {
      id: String(folderKey), type: meta0.type, name: meta0.name, title: meta0.title || '',
      level: level != null ? level : undefined, storyUnlockLevels: CFG.storyUnlockLevels || null,
      episodes: [], voiceGallery: null, assets: assetsManifest, routing, builtAt: Date.now(),
    };

    const orderedEpMetas = [];
    const work = [];
    for (const ep of meta0.episodes) {
      const epMeta = { episodeMasterId: ep.id, order: ep.order, chapter: ep.chapter || '', label: ep.label, title: ep.title, available: false, locked: false, lineCount: 0, voiced: 0, scenes: [] };
      orderedEpMetas.push(epMeta);
      const reqLevel = meta0.type === 'character' ? (CFG.storyUnlockLevels || [])[(ep.order || 1) - 1] : null;
      const locked = (level != null && reqLevel != null && level < reqLevel) || (clearedSet && clearedSet.size && !clearedSet.has(String(ep.id)));
      if (locked) { epMeta.locked = true; if (!dist) continue; }
      work.push({ ep, epMeta });
    }

    const firstSid = work.map((w) => w.ep.sceneBinIds[0]).find(Boolean);
    let voiceBase = null;
    if (firstSid) { prog('ボイス配信元を確認中…', 0); try { voiceBase = await resolveVoiceBase(voice, firstSid); } catch (e) {} }

    const castIds = new Set();
    const cgSetToEp = {};
    const sharedDir = await FS.getDir('_共有リソース', true);
    let done = 0;
    await pool(work, DL_CONC, async ({ ep, epMeta }) => {
      const epBg = new Set(), epBgm = new Set(), epSe = new Set();
      epMeta.bg = {}; epMeta.bgm = {}; epMeta.se = {};

      const queue = ep.sceneBinIds.map(String);
      const seen = new Set();
      while (queue.length) {
        const sid = String(queue.shift());
        if (seen.has(sid)) continue; seen.add(sid);
        const isChained = !ep.sceneBinIds.map(String).includes(sid);
        let bin = sceneBytes[sid] || null;
        const distEligible = dist && distSet && distSet.has(sid);
        if (!bin && distEligible) {
          let r = null;
          try { r = await fetchBytes(`${dist.binUrl}&id=${encodeURIComponent(dist.email)}&scene=${sid}`, true); } catch (e) {}
          if (r && r !== MISSING) { bin = r; try { await FS.writeUnder(dir, `story/${ep.id}/scene_${sid}.bin`, bin); } catch (e) {} }
          else if (!isChained) fails.push(`配布scene ${sid}`);
        }
        if (!bin) continue;
        let decoded, timeline;
        try { decoded = DECODE.decodeSceneBin(bin); timeline = DECODE.sceneToTimeline(decoded, sid); } catch (e) { console.warn('scene decode失敗', sid, e); continue; }
        try { const next = DECODE.sceneNext(decoded); if (next && !seen.has(next)) queue.push(next); } catch (e) {}
        epMeta.available = true; epMeta.lineCount += timeline.count;
        for (const ln of timeline.lines) { if (ln.bg) epBg.add(ln.bg); if (ln.bgm && !/^nobgm/i.test(ln.bgm)) epBgm.add(ln.bgm); }
        try { for (const cm of ((decoded[0] && decoded[0][4]) || [])) if (typeof cm[28] === 'string' && cm[28]) epSe.add(cm[28]); } catch (e) {} // SE(c28)
        for (const id of (timeline.castIds || [])) castIds.add(id);
        try { await FS.writeUnder(dir, `story/${ep.id}/scene_${sid}.json`, JSON.stringify(timeline)); } catch (e) {}
        const sc = { sceneId: String(sid), timeline: `story/${ep.id}/scene_${sid}.json`, scene: `story/${ep.id}/scene_${sid}.bin`, voice: null };
        const wantsVoice = timeline.lines.some((l) => l.voice);
        const advHash = voice.adventure[sid];
        if (advHash && voiceBase) {
          const vsub = `story/${ep.id}/voice/${sid}.bundle`;
          if (await grab(adventureVoiceUrl(voiceBase, sid, advHash), vsub, `voice ${sid}`)) { sc.voice = vsub; epMeta.voiced++; }
        }
        if (wantsVoice && !sc.voice) missingVoices.push({ sceneId: String(sid), kind: 'voice', hash: advHash || null, url: (advHash && voiceBase) ? adventureVoiceUrl(voiceBase, sid, advHash) : null, epId: String(ep.id), epLabel: ep.label || '', epTitle: ep.title || '' });
        epMeta.scenes.push(sc);
      }

      for (const name of epBg) { const m = String(name).match(/^(\d{8}_\d+)_still/); if (m) cgSetToEp[m[1]] = ep.id; }
      for (const name of epBg) {
        const sub0 = sceneAssets[name];
        if (!sub0) { routing.unresolved.push(name); continue; }
        const rel = relOf(sub0); const fn = rel.split('/').pop();
        const url = `${base}/Assets/WebGL/${rel}`;
        if (/^bg_adventure_/i.test(name) && sharedDir) {
          // 共有はフルパス(Assets/WebGL/…)で統一＝共有リソースDLのプリフェッチと同一パス→再利用(既存なら再取得しない)。SE/mouthと同方式。
          const sub = `Assets/WebGL/${rel}`;
          if ((await FS.exists(sharedDir, sub)) || await grabTo(sharedDir, url, sub, `bg ${name}`)) { epMeta.bg[name] = `_共有リソース/${sub}`; }
          else routing.unresolved.push(name);
        } else {
          const dsub = `story/${ep.id}/bg/${fn}`;
          if (await grab(url, dsub, `bg ${name}`)) { epMeta.bg[name] = dsub; }
          else routing.unresolved.push(name);
        }
      }
      for (const name of epBgm) {
        const sub0 = sceneAssets[name];
        if (!sub0) { routing.unresolved.push('bgm:' + name); continue; }
        const rel = relOf(sub0); const fn = rel.split('/').pop();
        const url = `${base}/Assets/WebGL/${rel}`;
        if (sharedDir) {
          // bg同様フルパス統一＝共有リソースDLと同一パスで再利用。
          const sub = `Assets/WebGL/${rel}`;
          if ((await FS.exists(sharedDir, sub)) || await grabTo(sharedDir, url, sub, `bgm ${name}`)) epMeta.bgm[name] = `_共有リソース/${sub}`;
          else routing.unresolved.push('bgm:' + name);
        } else {
          const dsub = `story/${ep.id}/bgm/${fn}`;
          if (await grab(url, dsub, `bgm ${name}`)) epMeta.bgm[name] = dsub;
          else routing.unresolved.push('bgm:' + name);
        }
      }
      for (const name of epSe) {
        const sub0 = sceneAssets['se:' + name.toLowerCase()];
        if (!sub0) { routing.unresolved.push('se:' + name); continue; }
        const rel = relOf(sub0); const fn = rel.split('/').pop();
        const url = `${base}/Assets/WebGL/${rel}`;
        const seSub = `Assets/WebGL/se_assets_se/${fn}`;
        if (sharedDir) {
          if ((await FS.exists(sharedDir, seSub)) || await grabTo(sharedDir, url, seSub, `se ${name}`)) epMeta.se[name] = `_共有リソース/${seSub}`;
          else routing.unresolved.push('se:' + name);
        } else {
          const dsub = `story/${ep.id}/se/${fn}`;
          if (await grab(url, dsub, `se ${name}`)) epMeta.se[name] = dsub;
          else routing.unresolved.push('se:' + name);
        }
      }
      done++; prog(`ストーリー ${done}/${work.length}`, 0.15 + 0.45 * (work.length ? done / work.length : 1));
    });
    meta.episodes = orderedEpMetas;

    const charHash = meta0.type === 'character' ? voice.character[String(folderKey)] : null;
    if (charHash) {
      if (!voiceBase) { try { voiceBase = await resolveVoiceBase(voice, meta0.episodes[0] && meta0.episodes[0].sceneBinIds[0]); } catch (e) {} }
      if (voiceBase && await grab(characterVoiceUrl(voiceBase, folderKey, charHash), 'voice_gallery.bundle', 'charvoice')) meta.voiceGallery = 'voice_gallery.bundle';
    }

    prog('キャラ資産取得中…', 0.50);
    const idx = await ensureIndexes();
    const a = idx.assetIndex[String(folderKey)] || {};
    const epMetaById = {}; for (const em of orderedEpMetas) epMetaById[String(em.episodeMasterId)] = em;
    const assetJobs = [];

    for (const [cat, rels] of Object.entries(a)) { if (cat === 'cg_bg' || cat === 'still' || cat === 'illustx') continue; for (const rel of rels) assetJobs.push({ cat, rel }); }
    if (meta0.type === 'character') {
      const det = idx.characters[String(folderKey)];
      const cid = det && det.chibiIconId;
      const chibiRel = cid && idx.chibiIndex && idx.chibiIndex[cid];
      if (chibiRel) assetJobs.push({ cat: 'chibiicon', rel: chibiRel });
      for (const it of (det && det.itemIconIds) || []) { const rel = idx.itemIndex && idx.itemIndex[it]; if (rel) assetJobs.push({ cat: 'itemicon', rel }); }
    }
    let av = 0;
    await pool(assetJobs, DL_CONC, async ({ cat, rel }) => {
      const fn = rel.split('/').pop();
      const sub = `visual/${cat}/${fn}`;
      if (await grab(`${base}/Assets/WebGL/${rel}`, sub, `${cat} ${fn}`)) {
        (assetsManifest[cat] || (assetsManifest[cat] = {}))[refNameOf(fn)] = sub;
      }
      av++; prog(`キャラ資産 ${av}/${assetJobs.length}`, 0.60 + 0.20 * (assetJobs.length ? av / assetJobs.length : 1));
    });

    const cgJobs = [];
    for (const cat of ['still', 'illustx']) for (const rel of (a[cat] || [])) cgJobs.push({ cat, rel });
    await pool(cgJobs, DL_CONC, async ({ cat, rel }) => {
      const fn = rel.split('/').pop(); const rn = refNameOf(fn);
      const m = rn.match(/^(\d{8}_\d+)/); const epId = m ? cgSetToEp[m[1]] : null;
      const em = epId ? epMetaById[String(epId)] : null;
      if (cat === 'still' && !em) return; // 未解放storyスチルは取得しない
      const sub = em ? `story/${epId}/cg/${fn}` : `visual/${cat}/${fn}`;
      if (await grab(`${base}/Assets/WebGL/${rel}`, sub, `${cat} ${fn}`)) {
        if (em) { (em.cg || (em.cg = {}))[rn] = sub; }
        else { (assetsManifest[cat] || (assetsManifest[cat] = {}))[rn] = sub; }
      }
    });

    if (meta0.type === 'character') {
      const det = idx.characters[String(folderKey)];
      const weapons = (det && det.weapons) || [];
      if (weapons.length) meta.assets.weapon = meta.assets.weapon || {};
      for (const w of weapons) {
        const wIdx = idx.assetIndex[String(w.weaponId)];
        if (!wIdx) continue;
        const modelRel = (wIdx.model || [])[0];
        const varLow = String(w.variation || 'Default').toLowerCase();
        const matRel = (wIdx.materials || []).find((r) => new RegExp(`/weapons/${w.weaponId}/${varLow}_`).test(r)) || (wIdx.materials || [])[0];
        const wrec = { slot: w.slot || 'wp_2', scale: w.scale || 1 };
        if (modelRel && await grab(`${base}/Assets/WebGL/${modelRel}`, `visual/weapon/${w.weaponId}_model.bundle`, `weapon model ${w.weaponId}`)) wrec.model = `visual/weapon/${w.weaponId}_model.bundle`;
        if (matRel && await grab(`${base}/Assets/WebGL/${matRel}`, `visual/weapon/${w.weaponId}_mat.bundle`, `weapon mat ${w.weaponId}`)) wrec.materials = `visual/weapon/${w.weaponId}_mat.bundle`;
        if (wrec.model) meta.assets.weapon[String(w.weaponId)] = wrec;
      }
    }

    const mouthRel = idx.globalAssets && idx.globalAssets.mouthAtlas;
    if (mouthRel && sharedDir) {
      const msub = MOUTH_ATLAS_SUB;
      if (!(await FS.exists(sharedDir, msub))) await grabTo(sharedDir, `${base}/Assets/WebGL/${mouthRel}`, msub, 'mouthatlas');
    }

    prog('登場キャラ立ち絵の解決中…', 0.92);
    routing.cast = {}; routing.unresolvedCast = [];
    const mainId = String(folderKey);
    const selfRec = {};
    if (assetsManifest.spine && assetsManifest.spine[mainId]) selfRec.spine = assetsManifest.spine[mainId];
    if (assetsManifest.spinelight && assetsManifest.spinelight[mainId]) selfRec.spinelight = assetsManifest.spinelight[mainId];
    if (Object.keys(selfRec).length) routing.cast[mainId] = selfRec;
    const otherCast = [...castIds].map(String).filter((id) => id !== mainId);
    if (otherCast.length) {
      const aidx = await assetIndex();
      let sv = 0; const stc = otherCast.length;
      const step = () => { sv++; prog(`登場キャラ立ち絵 ${sv}/${stc}`, 0.92 + 0.07 * (stc ? sv / stc : 1)); };
      await pool(otherCast, DL_CONC, async (id) => {
        const a = aidx[id];
        if (!a || !sharedDir) { routing.unresolvedCast.push(id); step(); return; }
        const c = idx.characters[id];
        const rec = { name: (c && c.name) || '', title: (c && c.title) || '' };
        for (const cat of ['spine', 'spinelight']) {
          const rels = a[cat]; if (!rels || !rels.length) continue;
          const rel = rels[0], fn = rel.split('/').pop(), sub = `cast/${id}/${cat}_${fn}`;
          let ok = await FS.exists(sharedDir, sub);
          if (!ok) { const b = await fetchBytes(`${base}/Assets/WebGL/${rel}`); if (b) { try { await FS.writeUnder(sharedDir, sub, b); ok = true; } catch (e) {} } }
          if (ok) rec[cat] = `_共有リソース/${sub}`;
        }
        if (rec.spine || rec.spinelight) routing.cast[id] = rec; else routing.unresolvedCast.push(id);
        step();
      });
    }

    if (meta0.type === 'character') { try { meta.profile = await characterDetail(mainId); if (meta.profile) delete meta.profile.voiceMessages; } catch (e) {} }

    meta.completeness = {
      episodesTotal: orderedEpMetas.length,
      episodesAvailable: orderedEpMetas.filter((e) => e.available).length,
      episodesLocked: orderedEpMetas.filter((e) => e.locked).length,
      sceneBgResolved: orderedEpMetas.reduce((n, e) => n + Object.keys(e.bg || {}).length, 0),
      sceneBgm: orderedEpMetas.reduce((n, e) => n + Object.keys(e.bgm || {}).length, 0),
      sceneUnresolved: routing.unresolved.length,
      castTotal: castIds.size,
      castResolved: Object.keys(routing.cast).length,
      castUnresolved: routing.unresolvedCast.length,
      voicedScenes: orderedEpMetas.reduce((n, e) => n + e.voiced, 0),
      missingVoices: missingVoices.length,
      assetCategories: Object.keys(assetsManifest).length,
      missing: missing.length,
    };

    meta.visuals = globalThis.TP_BUILD.buildVisuals(meta);
    await FS.writeUnder(dir, 'character.json', JSON.stringify(meta));
    prog(`完了${fails.length ? '・一時失敗' + fails.length : ''}${missing.length ? '・CDN欠番' + missing.length : ''}${routing.unresolved.length ? '・未解決bg' + routing.unresolved.length : ''}${routing.unresolvedCast.length ? '・未解決cast' + routing.unresolvedCast.length : ''}`, 1);
    if (missingVoices.length) {
      try {
        const store = (await chrome.storage.local.get('cdnMissing')).cdnMissing || { updatedAt: 0, chars: {} };
        const c = store.chars[String(folderKey)] || (store.chars[String(folderKey)] = { name: meta.name || '', title: meta.title || '', type: meta.type, stories: {} });
        c.name = meta.name || c.name; c.title = meta.title || c.title;
        for (const mv of missingVoices) {
          const st = c.stories[mv.epId] || (c.stories[mv.epId] = { label: mv.epLabel, title: mv.epTitle, scenes: {} });
          st.scenes[mv.sceneId] = { kind: mv.kind, hash: mv.hash, url: mv.url };
        }
        store.updatedAt = Date.now();
        await chrome.storage.local.set({ cdnMissing: store });
      } catch (e) {}
    }
    return { charId: String(folderKey), meta, fails, missing, missingVoices, downloaded: dlCount };
  }

  // ホーム枠(シーンイラスト/1コマ漫画/ホームBGM)を _ホーム/ へ自己完結DL。
  //   CG=sceneAssetIndex(backgrounds) / Voice=illustVoiceIndex / BGM=sceneAssetIndex(bgm・_icon除去・無ければ_loop) / 漫画=statics直URL(DDS)。
  async function collectHome(progress, onItem) {
    const idx = await ensureIndexes();
    const hi = idx.homeIndex || { sceneIllust: [], comic: [], homeBgm: [] };
    const sa = idx.sceneAssetIndex || {}, iv = idx.illustVoiceIndex || {};
    const staticsBase = idx.staticsBase || null;
    const base = await assetRoot();
    const dir = await FS.getDir('_ホーム', true);
    if (!dir) throw new Error('フォルダ権限がありません');
    const prog = (m, f) => { try { progress && progress(m, f); } catch (e) {} };
    const emit = (kind, entry) => { try { onItem && onItem(kind, entry); } catch (e) {} };
    let got = 0, skip = 0, fail = 0, miss = 0, unresolved = 0;
    const FAIL_CAP = 20; let aborted = null;
    const grab = async (rel, sub) => {
      if (!rel) { unresolved++; return null; }
      if (await FS.exists(dir, sub)) { skip++; return sub; }
      if (aborted) return null;
      let b = null; try { b = await fetchBytes(`${base}/Assets/WebGL/${rel}`, true); } catch (e) { if (e && e.auth) { aborted = e; return null; } }
      if (b === MISSING) { miss++; return null; }
      if (!b) { if (++fail >= FAIL_CAP) aborted = new Error(`失敗${FAIL_CAP}件で中断（カタログ/接続を確認）`); return null; }
      try { await FS.writeUnder(dir, sub, b); got++; return sub; } catch (e) { return null; }
    };
    // 絶対URL版(1コマ漫画=statics直URL用)。
    const grabAbs = async (url, sub) => {
      if (!url) { unresolved++; return null; }
      if (await FS.exists(dir, sub)) { skip++; return sub; }
      if (aborted) return null;
      let b = null; try { b = await fetchBytes(url, true); } catch (e) { if (e && e.auth) { aborted = e; return null; } }
      if (b === MISSING) { miss++; return null; }
      if (!b) { if (++fail >= FAIL_CAP) aborted = new Error(`失敗${FAIL_CAP}件で中断（statics/接続を確認）`); return null; }
      try { await FS.writeUnder(dir, sub, b); got++; return sub; } catch (e) { return null; }
    };
    const manifest = { builtAt: Date.now(), assetRoot: base, staticsBase, sceneIllust: [], comic: [], homeBgm: [] };

    const si = hi.sceneIllust || []; let n = 0;
    const saveManifest = async () => { manifest.unresolved = unresolved; manifest.missing = miss; try { await FS.writeUnder(dir, 'home.json', JSON.stringify(manifest)); } catch (e) {} };
    for (const e of si) {
      if (aborted) break;
      const cgName = (e.stillAdult && sa[e.stillAdult]) ? e.stillAdult : e.still;
      const cg = await grab(cgName ? relOf(sa[cgName]) : null, `scene-illust/${e.id}_cg.bundle`);
      // ボイス台詞が無いシーンイラストはvoiceを取りに行かない(未解決に数えない)。
      const voice = (e.lines && e.lines.length) ? await grab(iv[e.id] || null, `scene-illust/${e.id}_voice.bundle`) : null;
      const entry = { id: e.id, name: e.name, order: e.order || 0, lines: e.lines || [], cg: cg || null, voice: voice || null };
      manifest.sceneIllust.push(entry); emit('sceneIllust', entry);
      if (++n % 40 === 0) await saveManifest();
    }

    const cm = hi.comic || [];
    for (const e of cm) {
      if (aborted) break;
      // 1コマ漫画＝statics直URL InGameStatics/LoadingImages/DDS/<AssetId>.dds (DXT5)。
      const url = (staticsBase && e.asset) ? `${staticsBase}/InGameStatics/LoadingImages/DDS/${e.asset}.dds` : null;
      const img = await grabAbs(url, `comic/${e.id}.dds`);
      const entry = { id: e.id, title: e.title, order: e.order || 0, img: img || null };
      manifest.comic.push(entry); emit('comic', entry);
    }

    const bg = hi.homeBgm || [];
    for (const e of bg) {
      if (aborted) break;
      // ループ曲は単体bgm_XXXXが無くbgm_XXXX_loopのみ＝loopフォールバック(introは一度きりの導入なので省略)。
      const bgmSub = e.audio ? (sa[e.audio] || sa[e.audio + '_loop']) : null;
      const audio = await grab(bgmSub ? relOf(bgmSub) : null, `bgm/${e.audio || e.id}.bundle`);
      const entry = { id: e.id, name: e.name, order: e.order || 0, audio: audio || null };
      manifest.homeBgm.push(entry); emit('homeBgm', entry);
    }

    await saveManifest();
    if (aborted && aborted.auth) throw aborted;
    prog(`完了 取得${got}/既存${skip}/欠番${miss}/未解決${unresolved}${fail ? '/失敗' + fail : ''}`, 1);
    return { got, skip, miss, unresolved, fail, manifest };
  }

  async function cdnMissing() { return (await chrome.storage.local.get('cdnMissing')).cdnMissing || { updatedAt: 0, chars: {} }; }
  async function cdnMissingSummary() {
    const m = await cdnMissing();
    let chars = 0, stories = 0, scenes = 0, withUrl = 0;
    const rows = [];
    for (const [cid, c] of Object.entries(m.chars || {})) {
      chars++;
      for (const [eid, s] of Object.entries(c.stories || {})) {
        stories++;
        const sids = Object.keys(s.scenes || {});
        scenes += sids.length;
        for (const sc of Object.values(s.scenes || {})) if (sc.url) withUrl++;
        rows.push({ charId: cid, name: c.name, title: c.title, epId: eid, label: s.label, epTitle: s.title, scenes: sids.length });
      }
    }
    return { updatedAt: m.updatedAt || 0, chars, stories, scenes, withUrl, rows, data: m };
  }
  async function clearCdnMissing() { try { await chrome.storage.local.remove('cdnMissing'); } catch (e) {} }

  globalThis.TP_ACQUIRE = { downloadCharacterAssets, buildSharedResources, sharedResourcesPresent, readMouthAtlas, downloadMouthAtlas, planApiEpisodes, apiFetchStory, collectStory, collectHome, binlistSceneSet, binlistEpisodesCovered, postLog, cdnMissingSummary, clearCdnMissing };
})();
