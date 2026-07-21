'use strict';
(function () {
  const CFG = globalThis.TP_CONFIG;
  const DECODE = globalThis.TP_DECODE;
  const IDB = globalThis.TP_IDB;
  const FS = globalThis.TP_FS;
  const { voiceCandidates, assetRoot, fetchBytes, apiFetchBytes } = globalThis.TP_NET;
  const latin1 = globalThis.TP_UTIL.latin1;
  const b64ToBytes = globalThis.TP_UTIL.b64ToBytes;

  let _indexes = null, _folderMeta = null;
  // 索引キャッシュの無効化＝「拡張バージョンが変わった」or「6時間経過」or「CDNベース変更」or「手動再生成ボタン」。
  // 無効化トリガはバージョン更新で足りるので手動スキーマ番号は持たない(コード構造変更はリリース時のバージョンで反映)。
  const INDEX_TTL_MS = 6 * 60 * 60 * 1000;
  const HOME_DIR = '_ホーム', HOME_MANIFEST = 'home.json';

  const GROUP_NAMES = { 1: 'リーニャ', 2: 'テーセツ', 3: 'ジャハラ', 4: 'クォンツィ', 5: 'ジェネラス', 6: 'ペイシェ', 7: 'ヒューム', 8: 'アンノウン' };

  const RANK_NAMES = { 1: 'S', 2: 'A', 3: 'B', 5: 'UR' };
  const groupName = (d) => GROUP_NAMES[d && d.groupId] || '';
  const rankName = (d) => RANK_NAMES[d && d.rankId] || '';
  function extractMasterUrl(bytes) {
    const relRe = /production\/masterdata_\d[\d_]*\.bin\?[^\s"'\\]+/;
    try { let f = null; (function walk(x) { if (f) return; if (typeof x === 'string') { const m = x.match(relRe); if (m) f = m[0]; } else if (Array.isArray(x)) x.forEach(walk); })(decodeUserBytes(bytes)); if (f) return CFG.masterDataBase + f; } catch (e) {}
    const m = latin1.decode(bytes).match(/production\/masterdata_\d[\d_]*\.bin\?[A-Za-z0-9%=&._~:+\/-]+/);
    return m ? CFG.masterDataBase + m[0] : null;
  }

  const MASTER_DIR = '_master', MASTER_FILE = 'masterdata.bin', USER_FILE = 'user.bin';
  let _rawMaster = null, _rawMasterSaved = false;
  async function readFolderMaster() {
    try { const d = await FS.getDir(MASTER_DIR, false); if (!d) return null; const f = await FS.readUnder(d, MASTER_FILE); if (!f) return null; return new Uint8Array(await f.arrayBuffer()); } catch (e) { return null; }
  }

  async function saveMasterArtifacts() {
    if (!_rawMaster || _rawMasterSaved) return;
    try {
      if (!(FS && FS.supported) || (await FS.permission(false)) !== 'granted') return;
      const d = await FS.getDir(MASTER_DIR, true); if (!d) return;
      await FS.writeUnder(d, MASTER_FILE, _rawMaster);
      try { const ur = await IDB.get('userRaw'); if (ur) await FS.writeUnder(d, USER_FILE, b64ToBytes(ur)); } catch (e) {}
      _rawMasterSaved = true;
    } catch (e) {}
  }

  // ゲームと同じ手順でカタログ全集合を実行時に取得する:
  //   /api/Environment/EnvConfiguration → statics GUID → <production>/<guid>-statics/InGameStatics/IndexFiles/CatalogMetadataIndex.json → [{Name}]。
  // これで現行の追加カタログ(1コマ漫画を含むpp_assets_dataN等)も取りこぼさない。失敗時はCFG.catalogNamesにフォールバック。
  async function resolveCatalogNames(base) {
    const diag = { step: 'start', assetRoot: base };
    let envBytes = null;
    for (const method of ['GET', 'POST']) { try { envBytes = await apiFetchBytes(CFG.apiBase + '/api/Environment/EnvConfiguration', method); } catch (e) { diag.envErr = (e && e.auth) ? 'auth' : String(e && e.message || e); } if (envBytes) { diag.method = method; break; } }
    if (!envBytes) { diag.step = 'no-env'; return { names: null, diag }; }
    const m = latin1.decode(envBytes).match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}-statics/);
    if (!m) { diag.step = 'no-guid'; return { names: null, diag }; }
    diag.guid = m[0];
    const prodRoot = base.split('/production/')[0] + '/production';
    const staticsBase = `${prodRoot}/${m[0]}`;
    diag.staticsBase = staticsBase;
    const idxUrl = `${staticsBase}/InGameStatics/IndexFiles/CatalogMetadataIndex.json`;
    diag.idxUrl = idxUrl;
    let j = null;
    try { const r = await fetch(idxUrl); diag.idxStatus = r.status; j = await r.json(); } catch (e) { diag.step = 'idx-fail'; diag.idxErr = String(e && e.message || e); return { names: null, staticsBase, diag }; }
    if (!Array.isArray(j)) { diag.step = 'idx-not-array'; return { names: null, staticsBase, diag }; }
    const names = j.map((x) => (x && x.Name) ? x.Name + '.json' : null).filter(Boolean);
    diag.step = 'ok'; diag.count = names.length;
    return { names: names.length ? names : null, staticsBase, diag };
  }

  async function buildIndexes(progress, masterBinIn, fromFolder) {
    const BUILD = globalThis.TP_BUILD;
    const prog = (m) => { try { progress && progress(m, 0); } catch (e) {} };
    let mbin = masterBinIn || null;
    if (!mbin) {
      prog('マスターデータ取得中…');
      const mbytes = await apiFetchBytes(CFG.apiBase + '/api/data/master', 'GET');
      if (!mbytes) throw new Error('master取得失敗');
      const murl = extractMasterUrl(mbytes);
      if (!murl) throw new Error('masterdata URL不明');
      mbin = await fetchBytes(murl);
      if (!mbin) throw new Error('masterdata本体取得失敗');
    }
    const dec = decodeUserBytes(mbin);
    let recs = (dec.length === 1 && Array.isArray(dec[0])) ? dec[0] : dec;
    if (recs.length && Array.isArray(recs[0]) && Array.isArray(recs[0][0])) recs = recs[0];
    const masterIdx = BUILD.masterIndexes(recs);
    if (!Object.keys(masterIdx.characters).length) throw new Error('master索引が空(トークン/master形式)');
    _rawMaster = mbin; _rawMasterSaved = !!fromFolder; saveMasterArtifacts();
    prog('カタログ取得中…');
    const base = await assetRoot();
    let catalogNames = CFG.catalogNames || [];
    let catalogDiag = { dynamic: false }; let staticsBase = null;
    try { const r = await resolveCatalogNames(base); catalogDiag = r.diag || catalogDiag; staticsBase = r.staticsBase || null; if (r.names && r.names.length) { catalogNames = r.names; catalogDiag.dynamic = true; } } catch (e) { catalogDiag.buildErr = String(e && e.message || e); }
    const ids = [];
    for (const nm of catalogNames) {
      try { const j = await (await fetch(`${base}/Assets/WebGL/${nm}`)).json(); for (const x of (j.m_InternalIds || [])) ids.push(x); } catch (e) {}
    }
    const catalogIdx = BUILD.catalogIndexes(ids, voiceCandidates(base));
    const catalogOk = Object.keys(catalogIdx.assetIndex).length > 0;
    prog('索引生成完了');
    catalogDiag.namesUsed = catalogNames;
    return Object.assign({}, masterIdx, catalogIdx, { builtAssetRoot: base, builtAt: Date.now(), builtExtVer: extVersion(), catalogOk, catalogDiag, staticsBase });
  }
  function extVersion() { try { return chrome.runtime.getManifest().version || ''; } catch (e) { return ''; } }
  let _building = null;
  async function ensureIndexes(progress) {
    if (_indexes) return _indexes;
    if (_building) return _building;
    _building = (async () => {
      let stale = null;
      const curBase = await assetRoot();
      try {
        const c = await IDB.get('indexCache');
        if (c && c.characters && Object.keys(c.characters).length && c.assetIndex && Object.keys(c.assetIndex).length) {
          const age = Date.now() - (c.builtAt || 0);
          const fresh = c.builtExtVer === extVersion() && c.chibiIndex && (!c.builtAssetRoot || c.builtAssetRoot === curBase) && age >= 0 && age < INDEX_TTL_MS;
          if (fresh) { _indexes = c; return _indexes; }
          stale = c;
        }
      } catch (e) {}

      try {
        const built = await buildIndexes(progress);
        _indexes = built; if (built.catalogOk) { try { await IDB.set('indexCache', built); } catch (e) {} }
        return built;
      } catch (netErr) {

        try {
          const fm = await readFolderMaster();
          if (fm) { const built = await buildIndexes(progress, fm, true); _indexes = built; if (built.catalogOk) { try { await IDB.set('indexCache', built); } catch (e) {} } return built; }
        } catch (e) {}
        // TTL切れでも新規に取れなかった→旧データ維持＋builtAtを更新し、以後6hは無駄な再試行をしない(手動接続で強制再取得は可能)。
        if (stale) { _indexes = stale; try { stale.builtAt = Date.now(); await IDB.set('indexCache', stale); } catch (e) {} return _indexes; }
        throw netErr;
      }
    })();
    try { return await _building; } finally { _building = null; }
  }
  // 強制再取得(接続ボタン/手動再生成)。マスタもカタログも取り直す。★成功した時だけ差し替え、
  // 失敗(新規に取れない=通信不可/サービス終了等)なら旧キャッシュを維持＝更新しない。
  async function rebuildIndexes(progress) {
    _folderMeta = null;
    const prevIdx = _indexes; _indexes = null;
    try {
      const built = await buildIndexes(progress);
      _indexes = built; if (built.catalogOk) { try { await IDB.set('indexCache', built); } catch (e) {} }
      return built;
    } catch (netErr) {
      try { const fm = await readFolderMaster(); if (fm) { const built = await buildIndexes(progress, fm, true); _indexes = built; if (built.catalogOk) { try { await IDB.set('indexCache', built); } catch (e) {} } return built; } } catch (e) {}
      if (prevIdx) { _indexes = prevIdx; return _indexes; }               // 旧データ維持(消さない)
      try { const c = await IDB.get('indexCache'); if (c && c.characters) { _indexes = c; return _indexes; } } catch (e) {}
      throw netErr;
    }
  }
  function invalidateIndex() { _indexes = null; _folderMeta = null; }

  async function characterDetail(charId) { const c = (await ensureIndexes()).characters[String(charId)]; if (!c) return null; const { episodes, ...d } = c; return Object.assign({ group: groupName(c), rank: rankName(c) }, d); }
  async function indexes() {
    const x = await ensureIndexes();
    if (!_folderMeta) {
      const folderMeta = {};
      for (const [cid, c] of Object.entries(x.characters)) { if (!c.episodes || !c.episodes.length) continue; folderMeta[String(cid)] = { type: 'character', name: c.name, title: c.title, group: groupName(c), rank: rankName(c), episodes: c.episodes.map((e) => ({ id: e.episodeMasterId, order: e.order, label: e.label, title: e.title, sceneBinIds: e.sceneBinIds })) }; }

      for (const [eid, q] of Object.entries(x.questIndex)) folderMeta['quest_' + eid] = { type: 'quest', cat: q.cat, order: q.order || 0, name: q.name, title: '', episodes: q.episodes.map((e) => ({ id: e.questEpisodeId, order: e.order, chapter: e.chapter || '', label: e.label, title: e.title, sceneBinIds: e.sceneBinIds })) };

      for (const [eid, ev] of Object.entries(x.eventIndex)) folderMeta['special_' + eid] = { type: 'special', subType: ev.subType || '特別エピソード', name: ev.name, title: '', episodes: ev.episodes.map((e) => ({ id: e.episodeMasterId, paidMasterId: e.paidMasterId, subType: e.subType, order: e.order, label: e.label, title: e.title, unlockItem: e.unlockItem || null, sceneBinIds: e.sceneBinIds })) };
      _folderMeta = folderMeta;
    }
    return { voice: x.voiceIndex, folderMeta: _folderMeta, homeIndex: x.homeIndex };
  }

  // ホーム枠の表示モデル。BGMのみ未取得ボタンのツールチップ用に解決可否を付す(CG/漫画はstaticsBase有無で判断)。
  async function homeData() {
    const x = await ensureIndexes();
    const hi = x.homeIndex || { sceneIllust: [], comic: [], homeBgm: [] };
    const sa = x.sceneAssetIndex || {};
    const homeBgm = (hi.homeBgm || []).map((e) => ({ ...e, audioResolvable: !!(e.audio && (sa[e.audio] || sa[e.audio + '_loop'])) }));
    return { sceneIllust: hi.sceneIllust || [], comic: hi.comic || [], homeBgm, catalogDiag: x.catalogDiag || null, staticsBase: x.staticsBase || null };
  }

  async function scanHome() {
    try { const d = await FS.getDir(HOME_DIR, false); if (!d) return null; const f = await FS.readUnder(d, HOME_MANIFEST); if (!f) return null; return JSON.parse(await f.text()); } catch (e) { return null; }
  }

  const decodeUserBytes = globalThis.TP_UTIL.decodeUserBytes;

  // tag3=所持Lv / 146=有償解放 / 22=クリア済
  let _userState = null;
  async function parseUserState() {
    if (_userState) return _userState;
    const state = { levels: new Map(), paidUnlocked: new Set(), clearedNodes: new Set() };
    let b64 = null; try { b64 = await IDB.get('userRaw'); } catch (e) {}
    if (!b64) return state; // userRaw未着はmemoせず(後着で再取得させる)
    try {
      const num = globalThis.TP_UTIL.num;
      (function walk(x, depth) {
        if (depth > 4 || !Array.isArray(x)) return;
        if (x.length >= 2 && (typeof x[0] === 'number' || typeof x[0] === 'bigint') && Array.isArray(x[1])) {
          const tag = num(x[0]);
          if (tag === 3) state.levels.set(String(num(x[1][1])), num(x[1][2]) || 0);
          else if (tag === 146) state.paidUnlocked.add(String(num(x[1][1])));
          else if (tag === 22) state.clearedNodes.add(String(num(x[1][1])));
        }
        for (const e of x) walk(e, depth + 1);
      })(decodeUserBytes(b64ToBytes(b64)), 0);
      _userState = state;
    } catch (e) { console.warn('userState解析失敗', e); }
    return state;
  }
  async function ownedLevels() { return (await parseUserState()).levels; }
  const unlockedCount = (level) => (CFG.storyUnlockLevels || []).reduce((n, req) => n + ((level || 0) >= req ? 1 : 0), 0);
  async function unlockedPaidSet() { return (await parseUserState()).paidUnlocked; }
  async function clearedNodeSet() { return (await parseUserState()).clearedNodes; }

  async function refreshUserViaApi() {
    const auth = (await chrome.storage.local.get('apiAuth')).apiAuth;
    if (!auth || !auth.authorization) return { ok: false, reason: 'no-token' };
    let r; try { r = await apiFetchBytes(CFG.apiBase + '/api/data/user', 'GET', true); } catch (e) { return { ok: false, reason: e && e.auth ? 'auth' : 'error' }; }
    if (!r) return { ok: false, reason: 'fetch-failed' };
    await IDB.set('userRaw', r.base64); _userState = null;
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


  globalThis.TP_COLLECTION = { indexes, homeData, scanHome, ownedLevels, unlockedCount, unlockedPaidSet, clearedNodeSet, refreshUserViaApi, scanFolder, characterDetail, ensureIndexes, rebuildIndexes, invalidateIndex, saveMasterArtifacts };
})();
