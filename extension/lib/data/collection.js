'use strict';
(function () {
  const CFG = globalThis.TP_CONFIG;
  const DECODE = globalThis.TP_DECODE;
  const IDB = globalThis.TP_IDB;
  const FS = globalThis.TP_FS;
  const MP = globalThis.MessagePack;
  const latin1 = new TextDecoder('iso-8859-1');
  const MISSING = Symbol('missing');
  const MOUTH_ATLAS_SUB = '3d/mouthmaterials.bundle'; // 全3Dモデル共有の口表情アトラス（_共有リソース/配下の相対パス）
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function pool(items, limit, worker) {
    const out = new Array(items.length);
    let next = 0;
    const runner = async () => { while (true) { const i = next++; if (i >= items.length) return; out[i] = await worker(items[i], i); } };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
    return out;
  }
  const b64ToBytes = (b64) => { const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };
  const bytesToB64 = (buf) => { let bin = ''; const CHUNK = 0x8000; for (let i = 0; i < buf.length; i += CHUNK) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK)); return btoa(bin); };

  let _idx = null, _folderMeta = null;
  const IDX_SCHEMA = 5; // 索引スキーマ版（上げると既存キャッシュを再生成）
  // キャラの所属グループ（勢力/国）＝master tag4[10]。値の並び＝ゲームのグループフィルタ表示順。
  const GROUP_NAMES = { 1: 'リーニャ', 2: 'テーセツ', 3: 'ジャハラ', 4: 'クォンツィ', 5: 'ジェネラス', 6: 'ペイシェ', 7: 'ヒューム', 8: 'アンノウン' };
  // ランク＝master tag4[9]（maxLevel相関: 3→100/2→110/1→120/5→150）
  const RANK_NAMES = { 1: 'S', 2: 'A', 3: 'B', 5: 'UR' };
  const groupName = (d) => GROUP_NAMES[d && d.groupId] || '';
  const rankName = (d) => RANK_NAMES[d && d.rankId] || '';
  function extractMasterUrl(bytes) {
    const relRe = /production\/masterdata_\d[\d_]*\.bin\?[^\s"'\\]+/;
    try { let f = null; (function walk(x) { if (f) return; if (typeof x === 'string') { const m = x.match(relRe); if (m) f = m[0]; } else if (Array.isArray(x)) x.forEach(walk); })(decodeUserBytes(bytes)); if (f) return CFG.masterDataBase + f; } catch (e) {}
    const m = latin1.decode(bytes).match(/production\/masterdata_\d[\d_]*\.bin\?[A-Za-z0-9%=&._~:+\/-]+/);
    return m ? CFG.masterDataBase + m[0] : null;
  }
  function voiceCandidates(base) {
    const set = new Set([base + '/Assets/WebGL']);
    for (const n of [3, 0]) { const v = base.replace(/production\d+-/, 'production' + n + '-'); if (v !== base) set.add(v + '/Assets/WebGL'); }
    return [...set];
  }
  async function buildIndexes(progress) {
    const BUILD = globalThis.TP_BUILD;
    const prog = (m) => { try { progress && progress(m, 0); } catch (e) {} };
    prog('マスターデータ取得中…');
    const mbytes = await apiFetchBytes(CFG.apiBase + '/api/data/master', 'GET');
    if (!mbytes) throw new Error('master取得失敗');
    const murl = extractMasterUrl(mbytes);
    if (!murl) throw new Error('masterdata URL不明');
    const mbin = await fetchBytes(murl);
    if (!mbin) throw new Error('masterdata本体取得失敗');
    const dec = decodeUserBytes(mbin);
    let recs = (dec.length === 1 && Array.isArray(dec[0])) ? dec[0] : dec;
    if (recs.length && Array.isArray(recs[0]) && Array.isArray(recs[0][0])) recs = recs[0];
    const masterIdx = BUILD.masterIndexes(recs);
    prog('カタログ取得中…');
    const base = await assetRoot();
    const ids = [];
    for (const nm of (CFG.catalogNames || [])) {
      try { const j = await (await fetch(`${base}/Assets/WebGL/${nm}`)).json(); for (const x of (j.m_InternalIds || [])) ids.push(x); } catch (e) {}
    }
    const catalogIdx = BUILD.catalogIndexes(ids, voiceCandidates(base));
    if (!Object.keys(masterIdx.characterIndex).length) throw new Error('master索引が空(トークン/master形式)');
    if (!Object.keys(catalogIdx.assetIndex).length) throw new Error('カタログ索引が空(assetRoot/カタログ取得失敗)');
    prog('索引生成完了');
    const ver = (await chrome.storage.local.get('apiAuth')).apiAuth;
    return Object.assign({}, masterIdx, catalogIdx, { builtAssetRoot: base, builtMasterVer: (ver && ver['x-masterdata-version']) || null, builtAt: Date.now(), schemaV: IDX_SCHEMA });
  }
  let _building = null;
  async function ensureIndexes(progress) {
    if (_idx) return _idx;
    if (_building) return _building;
    _building = (async () => {
      let stale = null;
      const curBase = await assetRoot();
      const curVer = ((await chrome.storage.local.get('apiAuth')).apiAuth || {})['x-masterdata-version'] || null;
      try {
        const c = await IDB.get('indexCache');
        if (c && c.characterIndex && Object.keys(c.characterIndex).length && c.assetIndex && Object.keys(c.assetIndex).length) {
          const fresh = c.schemaV === IDX_SCHEMA && c.chibiIndex && (!c.builtAssetRoot || c.builtAssetRoot === curBase) && (!curVer || !c.builtMasterVer || c.builtMasterVer === curVer);
          if (fresh) { _idx = c; return _idx; }
          stale = c;
        }
      } catch (e) {}
      try {
        const built = await buildIndexes(progress);
        _idx = built; try { await IDB.set('indexCache', built); } catch (e) {}
        return built;
      } catch (e) {
        if (stale) { _idx = stale; return _idx; }
        throw e;
      }
    })();
    try { return await _building; } finally { _building = null; }
  }
  async function rebuildIndexes(progress) { _idx = null; _folderMeta = null; try { await IDB.del('indexCache'); } catch (e) {} return ensureIndexes(progress); }
  function invalidateIndex() { _idx = null; _folderMeta = null; }

  const assetIndex = async () => (await ensureIndexes()).assetIndex;
  const sharedIndex = async () => (await ensureIndexes()).sharedIndex;
  const sceneAssetIndex = async () => (await ensureIndexes()).sceneAssetIndex;
  async function characterDetail(charId) { const d = (await ensureIndexes()).characterDetails[String(charId)]; return d ? Object.assign({ group: groupName(d), rank: rankName(d) }, d) : null; }
  async function indexes() {
    const x = await ensureIndexes();
    if (!_folderMeta) {
      const folderMeta = {};
      for (const [cid, c] of Object.entries(x.characterIndex)) { const d = x.characterDetails[String(cid)] || {}; folderMeta[String(cid)] = { type: 'character', name: c.name, title: c.title, group: groupName(d), rank: rankName(d), episodes: c.episodes.map((e) => ({ id: e.episodeMasterId, order: e.order, label: e.label, title: e.title, sceneBinIds: e.sceneBinIds })) }; }
      // tag20＝quest（EventMaster単位）。cat＝'main'(常設)/'event'(期間限定)。episodeの chapter＝章名(LocationMaster)。DLは共にapiType=Quest。
      for (const [eid, q] of Object.entries(x.questIndex)) folderMeta['quest_' + eid] = { type: 'quest', cat: q.cat, order: q.order || 0, name: q.name, title: '', episodes: q.episodes.map((e) => ({ id: e.questEpisodeId, order: e.order, chapter: e.chapter || '', label: e.label, title: e.title, sceneBinIds: e.sceneBinIds })) };
      // tag145＝特別エピソード（有料/アイテム解放）。id＝episodeMasterId（getPaidEpisodeDetails/getSpecialEpisodeDetailsの引数）。paidMasterId＝解放判定(user PaidEpisode)照合用。
      for (const [eid, ev] of Object.entries(x.eventIndex)) folderMeta['special_' + eid] = { type: 'special', subType: ev.subType || '特別エピソード', name: ev.name, title: '', episodes: ev.episodes.map((e) => ({ id: e.episodeMasterId, paidMasterId: e.paidMasterId, subType: e.subType, order: e.order, label: e.label, title: e.title, unlockItem: e.unlockItem || null, sceneBinIds: e.sceneBinIds })) };
      _folderMeta = folderMeta;
    }
    return { voice: x.voiceIndex, folderMeta: _folderMeta };
  }

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

  function decodeUserBytes(bytes) {
    let lengths = null;
    const outerCodec = new MP.ExtensionCodec();
    for (let t = 0; t < 128; t++) outerCodec.register({ type: t, encode: () => null, decode: (d) => { lengths = []; for (const v of MP.decodeMulti(d)) lengths.push(Number(v)); return null; } });
    const vals = [];
    for (const root of MP.decodeMulti(bytes, { extensionCodec: outerCodec, useBigInt64: true })) {
      if (!Array.isArray(root)) { vals.push(root); continue; }
      const blocks = root.filter((e) => e instanceof Uint8Array);
      if (blocks.length && lengths && lengths.length) {
        const parts = blocks.map((b, i) => DECODE.lz4DecodeBlock(b, lengths[i]));
        let tot = 0; for (const p of parts) tot += p.length;
        const full = new Uint8Array(tot); let o = 0; for (const p of parts) { full.set(p, o); o += p.length; }
        const innerCodec = new MP.ExtensionCodec(); for (let t = 0; t < 128; t++) innerCodec.register({ type: t, encode: () => null, decode: () => null });
        try { for (const v of MP.decodeMulti(full, { extensionCodec: innerCodec, useBigInt64: true })) vals.push(v); } catch (e) { console.debug('[tp] decodeUserBytes: inner decodeMulti failed', e); }
      } else vals.push(root);
    }
    return vals;
  }

  let _owned = null;
  async function ownedLevels() {
    if (_owned && _owned.size) return _owned;
    _owned = new Map();
    let b64 = null; try { b64 = await IDB.get('userRaw'); } catch (e) {}
    if (!b64) return _owned;
    try {
      const vals = decodeUserBytes(b64ToBytes(b64));
      const num = (x) => (typeof x === 'bigint' ? Number(x) : x);
      (function walk(x, depth) {
        if (depth > 4 || !Array.isArray(x)) return;
        if (x.length >= 2 && (typeof x[0] === 'number' || typeof x[0] === 'bigint') && num(x[0]) === 3 && Array.isArray(x[1])) _owned.set(String(num(x[1][1])), num(x[1][2]) || 0);
        for (const e of x) walk(e, depth + 1);
      })(vals, 0);
    } catch (e) { console.warn('owned解析失敗', e); }
    return _owned;
  }

  const unlockedCount = (level) => (CFG.storyUnlockLevels || []).reduce((n, req) => n + ((level || 0) >= req ? 1 : 0), 0);

  // 解放済み特別エピソード＝user tag146(PaidEpisode)[Id, PaidEpisodeMasterId, IsCleared] の PaidEpisodeMasterId 集合。
  let _paidUnlocked = null;
  async function unlockedPaidSet() {
    if (_paidUnlocked) return _paidUnlocked;
    _paidUnlocked = new Set();
    let b64 = null; try { b64 = await IDB.get('userRaw'); } catch (e) {}
    if (!b64) return _paidUnlocked;
    try {
      const vals = decodeUserBytes(b64ToBytes(b64));
      const n = (x) => (typeof x === 'bigint' ? Number(x) : x);
      (function walk(x, depth) {
        if (depth > 4 || !Array.isArray(x)) return;
        if (x.length >= 2 && (typeof x[0] === 'number' || typeof x[0] === 'bigint') && n(x[0]) === 146 && Array.isArray(x[1])) _paidUnlocked.add(String(n(x[1][1])));
        for (const e of x) walk(e, depth + 1);
      })(vals, 0);
    } catch (e) { console.warn('paid解析失敗', e); }
    return _paidUnlocked;
  }

  // クリア済みノード＝user tag22(LocationNode)[Id, LocationNodeMasterId] の LocationNodeMasterId 集合。
  // LocationNodeMasterId＝tag20(LocationNodeMaster).Id＝questのepisode.id と一致＝メイン/イベントの各話クリア判定に使う。
  let _cleared = null;
  async function clearedNodeSet() {
    if (_cleared) return _cleared;
    _cleared = new Set();
    let b64 = null; try { b64 = await IDB.get('userRaw'); } catch (e) {}
    if (!b64) return _cleared;
    try {
      const vals = decodeUserBytes(b64ToBytes(b64));
      const n = (x) => (typeof x === 'bigint' ? Number(x) : x);
      (function walk(x, depth) {
        if (depth > 4 || !Array.isArray(x)) return;
        if (x.length >= 2 && (typeof x[0] === 'number' || typeof x[0] === 'bigint') && n(x[0]) === 22 && Array.isArray(x[1])) _cleared.add(String(n(x[1][1])));
        for (const e of x) walk(e, depth + 1);
      })(vals, 0);
    } catch (e) { console.warn('cleared解析失敗', e); }
    return _cleared;
  }

  async function refreshUserViaApi() {
    const auth = (await chrome.storage.local.get('apiAuth')).apiAuth;
    if (!auth || !auth.authorization) return { ok: false, reason: 'no-token' };
    let r; try { r = await apiFetchBytes(CFG.apiBase + '/api/data/user', 'GET', true); } catch (e) { return { ok: false, reason: e && e.auth ? 'auth' : 'error' }; }
    if (!r) return { ok: false, reason: 'fetch-failed' };
    await IDB.set('userRaw', r.base64); _owned = null; _paidUnlocked = null; _cleared = null;
    return { ok: true, owned: (await ownedLevels()).size };
  }

  async function scanFolder() {
    const downloaded = [];
    for (const d of await FS.listCharDirs()) {
      const f = await FS.readUnder(d.handle, 'character.json');
      if (!f) continue;
      let meta = null; try { meta = JSON.parse(await f.text()); } catch (e) {}
      if (!meta) continue;
      const eps = meta.episodes || [];
      const covered = eps.filter((e) => e.available).length;
      const name = (meta.type === 'character' && meta.title) ? `${meta.name || d.charId}${meta.title}` : (meta.name || d.charId);
      const unresolved = (meta.routing && meta.routing.unresolved) ? meta.routing.unresolved.length : 0;
      downloaded.push({ charId: d.charId, name, type: meta.type || '', covered, total: eps.length, unresolved, handle: d.handle });
    }
    return downloaded.sort((a, b) => (a.name > b.name ? 1 : -1));
  }

  async function assetRoot() {
    const o = await chrome.storage.local.get('assetRoot');
    return (o.assetRoot || CFG.assetRootDefault || '').replace(/\/+$/, '');
  }
  let _voiceBase = null;
  async function resolveVoiceBase(voice, probeSceneId) {
    if (_voiceBase) return _voiceBase;
    const root = await assetRoot();
    if (root) return (_voiceBase = root + '/Assets/WebGL');
    const candidates = (voice.cdnBaseCandidates || []).slice();
    const cached = (await chrome.storage.local.get('voiceBase')).voiceBase;
    if (cached && candidates.includes(cached)) return (_voiceBase = cached);
    const firstChar = Object.keys(voice.character)[0];
    const probe = probeSceneId && voice.adventure[probeSceneId]
      ? `adventurevoice_assets_adventurevoice/${probeSceneId}_${voice.adventure[probeSceneId]}.bundle`
      : `charactervoices_assets_charactervoices/${firstChar}_${voice.character[firstChar]}.bundle`;
    for (const base of candidates) {
      try { const res = await fetch(`${base}/${probe}`, { method: 'HEAD' }); if (res.ok) { _voiceBase = base; await chrome.storage.local.set({ voiceBase: base }); return base; } } catch (e) {}
    }
    return (_voiceBase = candidates[0]);
  }
  const advVoiceUrl = (base, sceneId, hash) => `${base}/adventurevoice_assets_adventurevoice/${sceneId}_${hash}.bundle`;
  const charVoiceUrl = (base, charId, hash) => `${base}/charactervoices_assets_charactervoices/${charId}_${hash}.bundle`;

  // 資産のsegmentは事前判定不能（内容不変の資産は初出segmentに残置）→404時に他のlive segment(3/4)へ
  // フォールバック。カテゴリ単位で効いたsegmentを学習・永続化し2回目以降は直行。live segmentは実測で3/4/5のみ。
  const SEG_FALLBACK = [3, 4];
  let _segHint = null;
  async function loadSegHints() { if (_segHint) return; try { _segHint = (await chrome.storage.local.get('segHints')).segHints || {}; } catch (e) { _segHint = {}; } }
  const segOf = (url) => { const m = url.match(/\/production\/production(\d+)-[0-9a-f-]+\//i); return m ? Number(m[1]) : null; };
  const swapSeg = (url, n) => url.replace(/(\/production\/production)\d+(-[0-9a-f-]+\/)/i, `$1${n}$2`);
  const catOf = (url) => { const m = url.match(/\/Assets\/WebGL\/([a-z0-9()]+_assets_[a-z0-9()]+)\//i); return m ? m[1] : null; };
  async function fetchBytes(url, classify) {
    const primary = segOf(url);
    let tryUrls = [url];
    if (primary != null) {
      await loadSegHints();
      const cat = catOf(url);
      const hint = cat != null ? _segHint[cat] : null;
      const order = [];
      if (hint != null) order.push(hint);           // 学習済みsegmentを最優先（直行）
      if (!order.includes(primary)) order.push(primary);
      for (const s of SEG_FALLBACK) if (!order.includes(s)) order.push(s);
      tryUrls = order.map((s) => swapSeg(url, s));
    }
    for (const u of tryUrls) {
      for (let i = 0; i < 2; i++) {
        try {
          const res = await fetch(u, { signal: AbortSignal.timeout(120000) });
          if (res.ok) {
            const cat = catOf(u), s = segOf(u);
            if (cat != null && s != null && _segHint && _segHint[cat] !== s) { _segHint[cat] = s; try { chrome.storage.local.set({ segHints: _segHint }); } catch (e) {} }
            return new Uint8Array(await res.arrayBuffer());
          }
          if (res.status === 404) break; // このsegmentに無い→次のsegment候補へ
        } catch (e) { if (i === 0) await sleep(5000); } // 一時失敗のみ再試行
      }
    }
    return classify ? MISSING : null;
  }

  async function apiFetchBytes(url, method, withStatus) {
    const st = await chrome.storage.local.get(['apiAuth', 'apiAuthBad']);
    const auth = st.apiAuth;
    if (!auth || !auth.authorization || auth.authorization === st.apiAuthBad) { const e = new Error('AUTH'); e.auth = true; throw e; }
    const headers = { Accept: 'application/vnd.msgpack', Authorization: auth.authorization };
    for (const k of ['X-Platform', 'X-Device', 'X-Rating', 'x-client-version', 'x-masterdata-version']) if (auth[k]) headers[k] = auth[k];
    // EXシナリオ続き(master field9=R18続行scene)のSASは x-rating=r18 でのみ getDetails応答に載る。
    // getDetails(POST)だけに限定（master/data/user=GETはrating非依存＝単一masterに全部入っている）。
    if ((method || 'GET') === 'POST' && !headers['X-Rating']) headers['X-Rating'] = 'r18';
    try {
      const r = await fetch(url, { method: method || 'GET', headers, credentials: 'include' });
      if (r.status === 401 || r.status === 403) { try { await chrome.storage.local.set({ apiAuthBad: auth.authorization }); } catch (e2) {} const e = new Error('AUTH'); e.auth = true; throw e; }
      if (!r.ok) return null;
      const buf = new Uint8Array(await r.arrayBuffer());
      return withStatus ? { status: r.status, ok: true, base64: bytesToB64(buf) } : buf;
    } catch (e) { if (e && e.auth) throw e; return null; }
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
    const FAIL_CAP = 20; // total-failure cap (avoid flooding the CDN with bad requests)
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
    prog(`完了 取得${got} / 既存${skip} / 失敗${fail} / 全${list.length}`, 1);
    return { got, skip, fail, total: list.length };
  }

  async function readMouthAtlas() {
    const dir = await FS.getDir('_共有リソース', false);
    if (!dir) return null;
    const existing = await FS.readUnder(dir, MOUTH_ATLAS_SUB);
    return existing ? new Uint8Array(await existing.arrayBuffer()) : null;
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

  // 取得済み判定用に3つ返す：sceneBytes(binがディスクに在るsid)／sceneMissing(CDN不在確定=.missing)／
  // servedByEp(保存済みgetDetailsが実際に提供するsid一覧・未保存はnull)。
  // 完全性は「getDetailsが提供する全sceneのbinが揃っているか」で判定＝masterの過剰列挙に惑わされない。
  async function readFolderCaptures(dir, episodes) {
    const sceneBytes = {}, sceneMissing = new Set(), servedByEp = {};
    for (const ep of episodes) {
      const gd = await FS.readUnder(dir, `story/${ep.id}/getDetails.bin`);
      if (gd) { const served = {}; try { extractSceneUrls(new Uint8Array(await gd.arrayBuffer()), served); } catch (e) {} servedByEp[ep.id] = Object.keys(served); }
      else servedByEp[ep.id] = null;
      for (const fn of await FS.listUnder(dir, `story/${ep.id}`)) {
        let m;
        if ((m = fn.match(/^scene_(\d+)\.bin$/))) { const f = await FS.readUnder(dir, `story/${ep.id}/${fn}`); if (f) sceneBytes[m[1]] = new Uint8Array(await f.arrayBuffer()); }
        else if ((m = fn.match(/^scene_(\d+)\.missing$/))) sceneMissing.add(m[1]);
      }
    }
    return { sceneBytes, sceneMissing, servedByEp };
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
    const { sceneBytes, sceneMissing, servedByEp } = await readFolderCaptures(dir, meta0.episodes);
    const level = meta0.type === 'character' ? ((await ownedLevels()).get(String(folderKey)) ?? 0) : null;
    // 特別＝解放済み(user PaidEpisode)のみ、メイン/イベント＝クリア済みノード(user LocationNode)のみ対象＝未解放/未クリアへリクエストを撃たない。
    const paid = meta0.type === 'special' ? await unlockedPaidSet() : null;
    const cleared = meta0.type === 'quest' ? await clearedNodeSet() : null;
    const eps = [];
    for (const ep of meta0.episodes) {
      if (paid && !paid.has(String(ep.paidMasterId))) continue;
      if (cleared && cleared.size && !cleared.has(String(ep.id))) continue; // クリア情報が有る時だけ絞る（空＝未取得なら全話）
      const reqLevel = meta0.type === 'character' ? (CFG.storyUnlockLevels || [])[(ep.order || 1) - 1] : null;
      if (level != null && reqLevel != null && level < reqLevel) continue;
      // 完全＝getDetails保存済み(≠null)かつ、索引の全scene(field8本編＋field9続き/R18)のbinが揃っている(or確定404)。
      // 古いgetDetailsが続き(102/104)を提供していなくても、索引側にfield9があれば未完扱いで再取得する（r18再要求で続きを拾う）。
      const served = servedByEp[ep.id];
      const need = new Set([...(ep.sceneBinIds || []).map(String), ...(served || [])]);
      const complete = served != null && [...need].every((sid) => sceneBytes[sid] || sceneMissing.has(String(sid)));
      if (!complete) eps.push({ id: ep.id, order: ep.order, subType: ep.subType, sceneBinIds: ep.sceneBinIds });
    }
    return { apiType, episodes: eps, dir, type: meta0.type };
  }

  // getDetails のURL候補。special は2系統（Event種別=Quest配下getSpecialEpisodeDetails／他=getPaidEpisodeDetails）を順に試す。
  function detailUrls(apiType, episodeId, subType) {
    if (apiType === 'Special') {
      const paid = `${CFG.apiBase}/api/Episodes/${episodeId}/getPaidEpisodeDetails`;
      const special = `${CFG.apiBase}/api/Episodes/Quest/${episodeId}/getSpecialEpisodeDetails`;
      return subType === 'イベントエピソード' ? [special, paid] : [paid, special];
    }
    return [`${CFG.apiBase}/api/Episodes/${apiType}/${episodeId}/getDetails`];
  }

  // 1エピソードの getDetails を取得・保存し、その SAS から scene.bin も取得・保存して収集ログ項目を返す。
  // 認証切れは throw（e.auth）。既取得の scene はスキップ。
  async function apiFetchStory(dir, apiType, episodeId, sceneBinIds, subType) {
    let b = null;
    for (const url of detailUrls(apiType, episodeId, subType)) { b = await apiFetchBytes(url, 'POST'); if (b) break; }
    if (!b) return { ok: false, log: [] };
    if (dir) { try { await FS.writeUnder(dir, `story/${episodeId}/getDetails.bin`, b); } catch (e) {} }
    const sas = {};
    try { extractSceneUrls(b, sas); } catch (e) {}
    const log = [];
    // 索引のsceneBinIds＋getDetailsが実際に返した全SAS の和集合を取得対象にする（続き=field9/R18も取りこぼさない）。
    const wanted = new Set([...(sceneBinIds || []).map(String), ...Object.keys(sas)]);
    for (const sid of wanted) {
      try {
        if (await FS.exists(dir, `story/${episodeId}/scene_${sid}.bin`)) continue;
        if (await FS.exists(dir, `story/${episodeId}/scene_${sid}.missing`)) continue; // CDNに存在しない確定分は再要求しない
        if (!sas[sid]) continue;
        const r = await fetchBytes(CFG.masterDataBase + sas[sid], true);
        if (r === MISSING) { try { await FS.writeUnder(dir, `story/${episodeId}/scene_${sid}.missing`, new Uint8Array(0)); } catch (e) {} continue; }
        if (r) { try { await FS.writeUnder(dir, `story/${episodeId}/scene_${sid}.bin`, r); } catch (e) {} log.push(sceneLogItem(sid, r)); }
      } catch (e) {}
    }
    return { ok: true, log };
  }

  // 1キャラ/1クエスト分のストーリー収集（getDetails＋scene.bin取得＋保存）とR2への収集送信。認証切れは throw。
  // getDetails は認証APIなので「逐次＋3秒間隔」で流す（並列なし・連打防止）。収集ログは溜め込まず LOG_FLUSH件ごとに送る
  // （数百話を最後に一括送信しない＝途中中断でも取得済み分がR2へ届く／巨大ボディを避ける）。
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
        const r = await apiFetchStory(plan.dir, plan.apiType, eps[i].id, eps[i].sceneBinIds, eps[i].subType);
        if (r.ok) { got++; if (r.log && r.log.length) batch.push(...r.log); if (batch.length >= LOG_FLUSH) await flush(); prog(`ストーリー取得中… ${got}/${need}`, 0.15 * got / need); }
      }
    } finally { await flush(); }
    return { got, need };
  }

  let _distScenes = null;
  async function distSceneSet(force) {
    if (_distScenes && !force) return _distScenes;
    if (!force) {
      try { const { binlistScenes } = await chrome.storage.local.get('binlistScenes'); if (Array.isArray(binlistScenes)) { _distScenes = new Set(binlistScenes.map(String)); return _distScenes; } } catch (e) {}
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
    _distScenes = set;
    try { await chrome.storage.local.set({ binlistScenes: [...set] }); } catch (e) {}
    return set;
  }
  function distEpisodesCovered(meta, distSet) {
    if (!meta || !distSet || !distSet.size) return 0;
    let n = 0;
    for (const ep of (meta.episodes || [])) { const ids = ep.sceneBinIds || []; if (ids.length && ids.every((sid) => distSet.has(String(sid)))) n++; }
    return n;
  }

  const HASH_STRIP = /_[0-9a-f]{16,}\.bundle$/i;
  const refNameOf = (fn) => fn.replace(HASH_STRIP, '').replace(/\.bundle$/i, '');
  const relOf = (sub) => sub.replace(/^Assets\/WebGL\//, '');

  async function downloadEntry(folderKey, progress, opts) {
    opts = opts || {};
    const { voice, folderMeta } = await indexes();
    const meta0 = folderMeta[String(folderKey)];
    if (!meta0) throw new Error('index に無いキー: ' + folderKey);
    const prog = (m, f) => { try { progress && progress(m, f); } catch (e) {} };
    const dir = await FS.getCharDir(folderKey, folderNameOf(meta0, folderKey), true);
    if (!dir) throw new Error('フォルダ権限がありません');
    const { sceneBytes } = await readFolderCaptures(dir, meta0.episodes);
    const level = meta0.type === 'character' ? ((await ownedLevels()).get(String(folderKey)) ?? 0) : null;
    const clearedSet = meta0.type === 'quest' ? await clearedNodeSet() : null;
    const sceneAssets = await sceneAssetIndex();
    const base = await assetRoot();
    const fails = [], missing = [];
    let dist = null;
    try {
      const st = await chrome.storage.local.get(['binlistUrl', 'email']);
      const binlist = (st.binlistUrl || '').trim();
      const distEmail = (st.email || '').trim();
      if (/^https?:\/\/\S+/.test(binlist) && distEmail) dist = { binUrl: binlist.replace('/binlist', '/bin'), email: distEmail };
    } catch (e) {}
    const distSet = dist ? await distSceneSet() : null;
    const grabTo = async (targetDir, url, subpath, label) => {
      if (!targetDir) { fails.push(label || subpath); return false; }
      if (await FS.exists(targetDir, subpath)) return true;
      const b = await fetchBytes(url, true);
      if (b === MISSING) { missing.push(label || subpath); return false; }
      if (!b) { fails.push(label || subpath); return false; }
      try { await FS.writeUnder(targetDir, subpath, b); return true; } catch (e) { fails.push(label || subpath); return false; }
    };
    const grab = (url, subpath, label) => grabTo(dir, url, subpath, label);
    const DL_CONC = 12;


    const routing = { scene: {}, unresolved: [] };
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
    const sharedDir = await FS.getDir('_共有リソース', true);
    let done = 0;
    await pool(work, DL_CONC, async ({ ep, epMeta }) => {
      const epBg = new Set(), epBgm = new Set();
      epMeta.bg = {}; epMeta.bgm = {};
      // 連鎖対応：master列挙のsceneを起点に、scene[6]の続きIDを辿って追加取得する（local→dist）。
      const queue = ep.sceneBinIds.map(String);
      const seen = new Set();
      while (queue.length) {
        const sid = String(queue.shift());
        if (seen.has(sid)) continue; seen.add(sid);
        const isChained = !ep.sceneBinIds.map(String).includes(sid); // master非列挙＝続き
        let bin = sceneBytes[sid] || null;
        const distEligible = dist && distSet && distSet.has(sid);
        if (!bin && distEligible) {
          let r = null;
          try { r = await fetchBytes(`${dist.binUrl}&id=${encodeURIComponent(dist.email)}&scene=${sid}`, true); } catch (e) {}
          if (r && r !== MISSING) { bin = r; try { await FS.writeUnder(dir, `story/${ep.id}/scene_${sid}.bin`, bin); } catch (e) {} }
          else if (!isChained) fails.push(`配布scene ${sid}`); // 続きの未収集は失敗扱いにしない（getDetails/SASでは取れない）
        }
        if (!bin) continue;
        let decoded, timeline;
        try { decoded = DECODE.decodeSceneBin(bin); timeline = DECODE.sceneToTimeline(decoded, sid); } catch (e) { console.warn('scene decode失敗', sid, e); continue; }
        try { const next = DECODE.sceneNext(decoded); if (next && !seen.has(next)) queue.push(next); } catch (e) {}
        epMeta.available = true; epMeta.lineCount += timeline.count;
        for (const ln of timeline.lines) { if (ln.bg) epBg.add(ln.bg); if (ln.bgm && !/^nobgm/i.test(ln.bgm)) epBgm.add(ln.bgm); }
        for (const id of (timeline.castIds || [])) castIds.add(id);
        try { await FS.writeUnder(dir, `story/${ep.id}/scene_${sid}.json`, JSON.stringify(timeline)); } catch (e) {}
        const sc = { sceneId: String(sid), timeline: `story/${ep.id}/scene_${sid}.json`, scene: `story/${ep.id}/scene_${sid}.bin`, voice: null };
        const advHash = voice.adventure[sid];
        if (advHash && voiceBase) {
          const vsub = `story/${ep.id}/voice/${sid}.bundle`;
          if (await grab(advVoiceUrl(voiceBase, sid, advHash), vsub, `voice ${sid}`)) { sc.voice = vsub; epMeta.voiced++; }
        }
        epMeta.scenes.push(sc);
      }
      for (const name of epBg) {
        const sub0 = sceneAssets[name];
        if (!sub0) { routing.unresolved.push(name); continue; }
        const rel = relOf(sub0); const fn = rel.split('/').pop();
        const url = `${base}/Assets/WebGL/${rel}`;
        if (/^bg_adventure_/i.test(name) && sharedDir) {
          if (await grabTo(sharedDir, url, `bg/${fn}`, `bg ${name}`)) { epMeta.bg[name] = `_共有リソース/bg/${fn}`; routing.scene[name] = epMeta.bg[name]; }
          else routing.unresolved.push(name);
        } else {
          const dsub = `story/${ep.id}/bg/${fn}`;
          if (await grab(url, dsub, `bg ${name}`)) { epMeta.bg[name] = dsub; routing.scene[name] = dsub; }
          else routing.unresolved.push(name);
        }
      }
      for (const name of epBgm) {
        const sub0 = sceneAssets[name];
        if (!sub0) { routing.unresolved.push('bgm:' + name); continue; }
        const rel = relOf(sub0); const fn = rel.split('/').pop();
        const url = `${base}/Assets/WebGL/${rel}`;
        if (sharedDir) {
          if (await grabTo(sharedDir, url, `bgm/${fn}`, `bgm ${name}`)) epMeta.bgm[name] = `_共有リソース/bgm/${fn}`;
          else routing.unresolved.push('bgm:' + name);
        } else {
          const dsub = `story/${ep.id}/bgm/${fn}`;
          if (await grab(url, dsub, `bgm ${name}`)) epMeta.bgm[name] = dsub;
          else routing.unresolved.push('bgm:' + name);
        }
      }
      done++; prog(`ストーリー ${done}/${work.length}`, 0.15 + 0.45 * (work.length ? done / work.length : 1));
    });
    meta.episodes = orderedEpMetas;

    const charHash = meta0.type === 'character' ? voice.character[String(folderKey)] : null;
    if (charHash) {
      if (!voiceBase) { try { voiceBase = await resolveVoiceBase(voice, meta0.episodes[0] && meta0.episodes[0].sceneBinIds[0]); } catch (e) {} }
      if (voiceBase && await grab(charVoiceUrl(voiceBase, folderKey, charHash), 'voice_gallery.bundle', 'charvoice')) meta.voiceGallery = 'voice_gallery.bundle';
    }

    prog('キャラ資産取得中…', 0.50);
    const idx = await ensureIndexes();
    const a = idx.assetIndex[String(folderKey)] || {};
    const assetJobs = [];
    for (const [cat, rels] of Object.entries(a)) { if (cat === 'cg_bg') continue; for (const rel of rels) assetJobs.push({ cat, rel }); }
    if (meta0.type === 'character') {
      const det = idx.characterDetails[String(folderKey)];
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

    if (meta0.type === 'character') {
      const det = idx.characterDetails[String(folderKey)];
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
        const rec = {};
        for (const cat of ['spine', 'spinelight']) {
          const rels = a[cat]; if (!rels || !rels.length) continue;
          const rel = rels[0], fn = rel.split('/').pop(), sub = `cast/${id}/${cat}_${fn}`;
          let ok = await FS.exists(sharedDir, sub);
          if (!ok) { const b = await fetchBytes(`${base}/Assets/WebGL/${rel}`); if (b) { try { await FS.writeUnder(sharedDir, sub, b); ok = true; } catch (e) {} } }
          if (ok) rec[cat] = `_共有リソース/${sub}`;
        }
        if (Object.keys(rec).length) routing.cast[id] = rec; else routing.unresolvedCast.push(id);
        step();
      });
    }

    prog('イラストボイス取得中…', 0.99);
    meta.illustVoice = [];
    if (meta0.type === 'character') {
      const ivList = (idx.illustVoiceByChar && idx.illustVoiceByChar[mainId]) || [];
      if (ivList.length && !voiceBase) { try { voiceBase = await resolveVoiceBase(voice, meta0.episodes[0] && meta0.episodes[0].sceneBinIds[0]); } catch (e) {} }
      for (const e of ivList) {
        const rec = { ivId: e.ivId, name: e.name, still: e.still || null, lines: e.lines, voice: {} };
        const ivRel = idx.illustVoiceIndex && idx.illustVoiceIndex[e.ivId];
        if (ivRel && await grab(`${base}/Assets/WebGL/${ivRel}`, `illustvoice/${e.ivId}.bundle`, `illustvoice ${e.ivId}`)) rec.voice.bundle = `illustvoice/${e.ivId}.bundle`;
        const scenes = new Set(e.lines.map((l) => (String(l.voiceId).match(/^[cs]_(\d+)_/) || [])[1]).filter(Boolean));
        for (const sid of scenes) { const h = voice.adventure[sid]; if (h && voiceBase && await grab(advVoiceUrl(voiceBase, sid, h), `illustvoice/adv_${sid}.bundle`, `illustvoice adv ${sid}`)) rec.voice[sid] = `illustvoice/adv_${sid}.bundle`; }
        meta.illustVoice.push(rec);
      }
    }

    if (meta0.type === 'character') { try { meta.profile = await characterDetail(mainId); } catch (e) {} }

    meta.completeness = {
      episodesTotal: orderedEpMetas.length,
      episodesAvailable: orderedEpMetas.filter((e) => e.available).length,
      episodesLocked: orderedEpMetas.filter((e) => e.locked).length,
      sceneBgResolved: Object.keys(routing.scene).length,
      sceneBgm: orderedEpMetas.reduce((n, e) => n + Object.keys(e.bgm || {}).length, 0),
      sceneUnresolved: routing.unresolved.length,
      castTotal: castIds.size,
      castResolved: Object.keys(routing.cast).length,
      castUnresolved: routing.unresolvedCast.length,
      voicedScenes: orderedEpMetas.reduce((n, e) => n + e.voiced, 0),
      assetCategories: Object.keys(assetsManifest).length,
      illustVoice: meta.illustVoice.length,
      missing: missing.length,
    };

    await FS.writeUnder(dir, 'character.json', JSON.stringify(meta));
    prog(`完了${fails.length ? '・一時失敗' + fails.length : ''}${missing.length ? '・CDN欠番' + missing.length : ''}${routing.unresolved.length ? '・未解決bg' + routing.unresolved.length : ''}${routing.unresolvedCast.length ? '・未解決cast' + routing.unresolvedCast.length : ''}`, 1);
    return { charId: String(folderKey), meta, fails, missing };
  }

  globalThis.TP_COLLECTION = { indexes, ownedLevels, unlockedCount, unlockedPaidSet, clearedNodeSet, refreshUserViaApi, scanFolder, downloadEntry, characterDetail, buildSharedResources, readMouthAtlas, downloadMouthAtlas, ensureIndexes, rebuildIndexes, invalidateIndex, planApiEpisodes, apiFetchStory, collectStory, distSceneSet, distEpisodesCovered, postLog };
})();
