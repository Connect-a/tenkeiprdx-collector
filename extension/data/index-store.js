import { assetUrlOn, relKey } from '../core/paths.js';
import { idbStore } from '../core/idb.js';
import { fileStore } from '../core/fsdir.js';
import { unityDecode } from '../unity/decode.js';
import { DIRS, SK } from '../core/constants.js';
import { networkClient } from './network.js';
import { utilHelpers } from '../core/util.js';
import { buildIndexes as BUILD_MOD } from './build-indexes.js';
import { parseOrigin, saveOrigin, recoverOrigin, resolveOrigin } from './origin.js';
import { CFG } from '../config.js';

const { assetRoot, fetchBytesRaw, apiFetchBytes } = networkClient;
const { latin1, b64ToBytes } = utilHelpers;

const MASTER_DIR = DIRS.master;
const MASTER_FILE = 'masterdata.bin';
export const CATALOG_DIR = 'catalogs';
const USER_FILE = 'user.bin';

let _indexes = null;
let _building = null;
let _rawMaster = null;
let _rawMasterSaved = false;
let _masterFromFolder = false;

const extVersion = () => {
  try {
    return chrome.runtime.getManifest().version || '';
  } catch (e) {
    return '';
  }
};

function extractMasterUrl(bytes) {
  const MASTER_URL = /production\/masterdata_\d[\d_]*\.bin\?[A-Za-z0-9%=&._~:+-]+/g;
  const ms = unityDecode.extractEmbeddedUrls(bytes, MASTER_URL);
  return ms.length ? CFG.masterDataBase + ms[0][0] : null;
}

async function readFolderMaster() {
  try {
    const d = await fileStore.getDir(MASTER_DIR, { create: false });
    if (!d) return null;
    return await fileStore.readBytesUnder(d, MASTER_FILE);
  } catch (e) {
    return null;
  }
}

export async function saveMasterArtifacts() {
  if (!_rawMaster || _rawMasterSaved) return;
  try {
    if (!(fileStore && fileStore.supported) || (await fileStore.permission({ request: false })) !== 'granted') return;
    const d = await fileStore.getDir(MASTER_DIR, { create: true });
    if (!d) return;
    await fileStore.writeUnder(d, MASTER_FILE, _rawMaster);
    try {
      const ur = await idbStore.get(SK.userRaw);
      if (ur) await fileStore.writeUnder(d, USER_FILE, b64ToBytes(ur));
    } catch (e) {}
    _rawMasterSaved = true;
  } catch (e) {}
}

async function resolveCatalogNames(base) {
  const diag = { step: 'start', assetRoot: base };
  let envBytes = null;
  for (const method of ['GET', 'POST']) {
    try {
      envBytes = await apiFetchBytes(CFG.apiBase + '/api/Environment/EnvConfiguration', method);
    } catch (e) {
      diag.envErr = e && e.auth ? 'auth' : String((e && e.message) || e);
    }
    if (envBytes) {
      diag.method = method;
      break;
    }
  }
  let assetBase = null;
  let staticsBase = null;
  if (envBytes) {
    const parsed = parseOrigin(latin1.decode(envBytes));
    diag.originFromEnv = parsed;
    const saved = await saveOrigin(parsed, 'env');
    assetBase = parsed.assets || null;
    staticsBase = (saved && saved.statics) || null;
  } else {
    diag.env = 'none';
    staticsBase = (await resolveOrigin()).statics || null;
  }
  if (!staticsBase) {
    diag.step = 'no-statics';
    return { names: null, diag, assetBase };
  }
  const idxUrl = `${staticsBase}/InGameStatics/IndexFiles/CatalogMetadataIndex.json`;
  diag.idxUrl = idxUrl;
  let j = null;
  try {
    const r = await fetch(idxUrl);
    diag.idxStatus = r.status;
    j = await r.json();
  } catch (e) {
    diag.step = 'idx-fail';
    diag.idxErr = String((e && e.message) || e);
    return { names: null, staticsBase, diag, assetBase };
  }
  if (!Array.isArray(j)) {
    diag.step = 'idx-not-array';
    return { names: null, staticsBase, diag, assetBase };
  }
  const names = j.map((x) => (x && x.Name ? x.Name + '.json' : null)).filter(Boolean);
  diag.step = 'ok';
  diag.count = names.length;
  return { names: names.length ? names : null, staticsBase, diag, metaIndex: j, assetBase };
}

async function fetchMasterRecords(prog) {
  prog('マスターデータ取得中…');
  _masterFromFolder = false;
  const folder = await readFolderMaster();
  try {
    const mbytes = await apiFetchBytes(CFG.apiBase + '/api/data/master', 'GET');
    const murl = mbytes && extractMasterUrl(mbytes);
    const mbin = murl && (await fetchBytesRaw(murl));
    if (masterUsable(mbin, folder)) return mbin;
  } catch (e) {}
  if (CFG.masterDataFallbackUrl) {
    prog('マスターデータを配信元から取得中…');
    try {
      const mbin = await fetchBytesRaw(CFG.masterDataFallbackUrl);
      if (masterUsable(mbin, folder)) return mbin;
    } catch (e) {}
  }
  if (folder && folder.length) {
    prog('配信元から取得できないため、保存済みのマスターデータを使います');
    _masterFromFolder = true;
    return folder;
  }
  throw new Error('ゲームのデータを取得できませんでした。');
}

let _recsBin = null;
let _recsCache = null;

function masterRecords(mbin) {
  if (_recsBin === mbin && _recsCache) return _recsCache;
  const dec = unityDecode.decodeUserBytes(mbin);
  let recs = dec.length === 1 && Array.isArray(dec[0]) ? dec[0] : dec;
  if (recs.length && Array.isArray(recs[0]) && Array.isArray(recs[0][0])) recs = recs[0];
  if (!Object.keys(BUILD_MOD.masterIndexes(recs).characters).length) throw new Error('ゲームのデータを読み取れませんでした。');
  _recsBin = mbin;
  _recsCache = recs;
  return recs;
}

const MASTER_MIN_BYTES = 1 << 20;

function masterUsable(mbin, folder) {
  if (!mbin || mbin.length < MASTER_MIN_BYTES) return false;
  if (folder && folder.length && mbin.length < folder.length * 0.9) return false;
  try {
    masterRecords(mbin);
    return true;
  } catch (e) {
    return false;
  }
}

async function fetchCatalogs(base, prog) {
  prog('カタログ取得中…');
  let names = CFG.catalogNames || [];
  let diag = { dynamic: false };
  let staticsBase = null;
  let metaIndex = null;
  try {
    const r = await resolveCatalogNames(base);
    diag = r.diag || diag;
    staticsBase = r.staticsBase || null;
    metaIndex = r.metaIndex || null;
    if (r.assetBase) base = r.assetBase.replace(/\/+$/, '');
    if (r.names && r.names.length) {
      names = r.names;
      diag.dynamic = true;
    }
  } catch (e) {
    diag.buildErr = String((e && e.message) || e);
  }
  const ids = [];
  const objects = [];
  let sharedDir = null;
  try {
    sharedDir = await fileStore.getDir(DIRS.shared, { create: true });
  } catch (e) {}
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const readDiskCatalog = async (fname) => {
    if (!sharedDir) return null;
    try {
      const b = await fileStore.readBytesUnder(sharedDir, CATALOG_DIR + '/' + fname);
      return b ? dec.decode(b) : null;
    } catch (e) {
      return null;
    }
  };
  const writeDiskCatalog = async (fname, txt) => {
    if (!sharedDir) return;
    try {
      await fileStore.writeUnder(sharedDir, CATALOG_DIR + '/' + fname, enc.encode(txt));
    } catch (e) {}
  };
  if (metaIndex) await writeDiskCatalog('_metaindex.json', JSON.stringify(metaIndex));

  const ETAG_FILE = '_etags.json';
  let etags = {};
  try {
    etags = JSON.parse((await readDiskCatalog(ETAG_FILE)) || '{}') || {};
  } catch (e) {}
  const nextEtags = { ...etags };
  const loadCatalog = async (platform, nm, diskName) => {
    const url = assetUrlOn(base, platform, nm);
    const key = platform + '|' + nm;
    let tag = null;
    try {
      const h = await fetch(url, { method: 'HEAD' });
      if (h.ok) tag = h.headers.get('etag') || h.headers.get('last-modified') || h.headers.get('content-length');
    } catch (e) {}
    if (tag && etags[key] === tag) {
      const cached = await readDiskCatalog(diskName);
      if (cached != null) return { txt: cached, fresh: false };
    }
    try {
      const r = await fetch(url);
      if (r.ok) {
        const txt = await r.text();
        JSON.parse(txt);
        if (tag) nextEtags[key] = tag;
        return { txt, fresh: true };
      }
    } catch (e) {}
    const cached = await readDiskCatalog(diskName);
    return cached != null ? { txt: cached, fresh: false } : null;
  };

  if (!diag.dynamic) {
    const dn = await readDiskCatalog('_names.json');
    if (dn) {
      try {
        const arr = JSON.parse(dn);
        if (Array.isArray(arr) && arr.length) {
          names = arr;
          diag.diskNames = true;
        }
      } catch (e) {}
    }
  }

  const first = names[0] ? await loadCatalog('web', names[0], names[0]) : null;
  if (names[0] && !first) {
    const next = await recoverOrigin();
    if (next) {
      base = next;
      diag.recoveredBase = next;
    }
  }

  let savedCatalogs = 0;
  for (let i = 0; i < names.length; i++) {
    const nm = names[i];
    const r = i === 0 && first ? first : await loadCatalog('web', nm, nm);
    if (!r) continue;
    if (r.fresh) {
      await writeDiskCatalog(nm, r.txt);
      savedCatalogs++;
    }
    try {
      const j = JSON.parse(r.txt);
      objects.push(j);
      for (const x of j.m_InternalIds || []) ids.push(x);
    } catch (e) {}
  }
  if (objects.length) await writeDiskCatalog('_names.json', JSON.stringify(names));
  diag.namesUsed = names;
  diag.savedCatalogs = savedCatalogs;

  prog('Player版カタログを確認中…');
  const altRel = {};
  let altOk = 0;
  for (const nm of names) {
    const pf = '_player_' + nm;
    const r = await loadCatalog('player', nm, pf);
    if (!r) continue;
    if (r.fresh) await writeDiskCatalog(pf, r.txt);
    try {
      const j = JSON.parse(r.txt);
      for (const x of j.m_InternalIds || []) {
        const m = String(x)
          .split('\\')
          .join('/')
          .match(/^PariPari(?:Public)?Remote\/(.+)$/);
        if (m) altRel[relKey(m[1])] = m[1];
      }
      altOk++;
    } catch (e) {}
  }
  await writeDiskCatalog(ETAG_FILE, JSON.stringify(nextEtags));
  diag.altCatalogs = altOk;
  diag.altRels = Object.keys(altRel).length;
  return { ids, objects, diag, staticsBase, altRel, base };
}

async function buildIndexes(progress, masterBinIn, fromFolder) {
  const prog = (m) => {
    try {
      progress && progress(m, 0);
    } catch (e) {}
  };
  const mbin = masterBinIn || (await fetchMasterRecords(prog));
  const recs = masterRecords(mbin);
  _rawMaster = mbin;
  _rawMasterSaved = !!fromFolder || _masterFromFolder;
  saveMasterArtifacts();

  const catalogs = await fetchCatalogs(await assetRoot(), prog);
  const base = catalogs.base;
  const built = BUILD_MOD.compose({ recs, catalogIds: catalogs.ids, catalogObjs: catalogs.objects });
  prog('データの準備が完了しました');
  return {
    master: built.master,
    assets: { ...built.assets, altRel: catalogs.altRel || {} },
    meta: {
      modelDeps: built.modelDeps,
      modelFolder: built.modelFolder,
      matVariation: built.matVariation,
      builtAssetRoot: base,
      builtVersion: extVersion(),
      builtAt: Date.now(),
      catalogOk: Object.keys(built.assets.assetIndex).length > 0,
      catalogCount: (catalogs.objects || []).length,
      altCatalogCount: catalogs.diag ? catalogs.diag.altCatalogs || 0 : 0,
      altRelCount: Object.keys(catalogs.altRel || {}).length,
    },
  };
}

async function commitIndexes(built) {
  _indexes = built;
  if (built.meta.catalogOk) {
    try {
      await idbStore.set(SK.indexCache, built);
    } catch (e) {}
  }
  return built;
}

async function tryFolderMasterBuild(progress) {
  try {
    const fm = await readFolderMaster();
    if (fm) return commitIndexes(await buildIndexes(progress, fm, true));
  } catch (e) {}
  return null;
}

const usableCache = (c) => !!(c && c.master && c.master.characters && Object.keys(c.master.characters).length && c.assets && c.assets.assetIndex && Object.keys(c.assets.assetIndex).length);

async function readCache(strict) {
  try {
    const c = await idbStore.get(SK.indexCache);
    if (strict ? usableCache(c) : c && c.master && c.master.characters) return c;
  } catch (e) {}
  return null;
}

const NEWER_KEYS = ['miniGameRels', 'battleFieldRels', 'skillFxSharedRels', 'skillFxUniqueRels', 'worldMapRels', 'uiSpriteRels', 'uiPanelRels', 'gachaBgRels', 'gachaExtraRels', 'systemVoiceRel'];

export async function ensureIndexes(progress) {
  if (_indexes) return _indexes;
  if (_building) return _building;
  _building = (async () => {
    const cached = await readCache(true);
    const curBase = await assetRoot();
    if (
      cached &&
      cached.meta &&
      cached.assets.chibiIndex &&
      cached.assets.altRel &&
      Object.keys(cached.assets.altRel).length &&
      NEWER_KEYS.every((k) => cached.assets[k] !== undefined) &&
      cached.meta.builtVersion === extVersion() &&
      (!cached.meta.builtAssetRoot || cached.meta.builtAssetRoot === curBase)
    ) {
      _indexes = cached;
      return _indexes;
    }
    try {
      return await commitIndexes(await buildIndexes(progress));
    } catch (netErr) {
      const fb = await tryFolderMasterBuild(progress);
      if (fb) return fb;
      if (cached) {
        _indexes = cached;
        return _indexes;
      }
      throw netErr;
    }
  })();
  try {
    return await _building;
  } finally {
    _building = null;
  }
}

export async function rebuildIndexes(progress) {
  const prev = _indexes;
  _indexes = null;
  try {
    return await commitIndexes(await buildIndexes(progress));
  } catch (netErr) {
    const fb = await tryFolderMasterBuild(progress);
    if (fb) return fb;
    _indexes = prev || (await readCache(false));
    if (_indexes) return _indexes;
    throw netErr;
  }
}

export function invalidateIndex() {
  _indexes = null;
}

export async function indexReady() {
  return !!(_indexes || (await readCache(true)));
}
