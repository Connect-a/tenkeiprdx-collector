import { fileStore } from '../../core/fsdir.js';
import { assetStore, AREA } from '../../data/asset-store.js';
import { collectionRepository } from '../../data/collection.js';
import { charAssets } from '../../data/char-assets.js';
import { unityMesh } from '../../unity/mesh.js';
import { CAST_CATS, characterMeta } from '../../data/character-meta.js';
import { CHAR_DIR } from '../../core/assetpath/placement.js';
import { bundleName } from '../../core/assetpath/paths.js';
import { FOLDER_PARENTS, DIRS } from '../../core/dirs.js';
import { ensureIndexes } from '../../data/index-store.js';
import { pool } from '../../core/async.js';

const bundleIn = async (handle, sub) => {
  try {
    const names = (await fileStore.listUnder(handle, sub, { nonEmpty: true })).filter((n) => /\.bundle$/i.test(n));
    return names.sort();
  } catch (e) {
    return [];
  }
};

const spineAssets = (m) => (m && m.assets ? m.assets.filter((a) => a.cat === 'spine' || a.cat === 'spinelight') : []);

let _charDirs = null;
let _monsters = null;
let _other3d = null;
const _byId = new Map();
const _loaded = new Set();

const index = (list) => {
  for (const e of list) _byId.set(e.id, e);
  return list;
};

async function characterEntries() {
  const { folderMeta } = await collectionRepository.folderModel();
  const dirs = (await fileStore.listFolderDirs()).filter((d) => d.parent === FOLDER_PARENTS.character);
  _charDirs = new Map(dirs.map((d) => [String(d.folderKey), d.handle]));
  return dirs
    .map((d) => {
      const fm = folderMeta[String(d.folderKey)] || {};
      return { id: String(d.folderKey), kind: 'character', displayName: characterMeta.displayName(fm) || String(d.folderKey), title: fm.title || '' };
    })
    .filter((e) => e.displayName);
}

async function monsterEntries(mode) {
  const list = await collectionRepository.monsterList();
  _monsters = new Map(list.map((m) => [String(m.id), m]));
  const has = mode === '2d' ? (m) => spineAssets(m).length : (m) => m.model;
  return list.filter(has).map((m) => ({ id: String(m.id), kind: 'monster', displayName: m.name || '#' + m.id, title: '' }));
}

const OTHER3D_GROUPS = [
  ['monster', 'モンスター'],
  ['boss', 'ボス・敵キャラ'],
  ['ally', '未分類'],
];

async function other3dEntries() {
  const list = await collectionRepository.otherList();
  _other3d = new Map(list.map((e) => [String(e.id), e]));
  const out = [];
  OTHER3D_GROUPS.forEach(([cat, label], groupNo) => {
    for (const e of list) {
      if (e.category !== cat || !e.model) continue;
      out.push({ id: String(e.id), kind: 'other3d', group: label, groupNo, displayName: e.name || '#' + e.id, title: e.name ? '#' + e.id : '' });
    }
  });
  return out;
}

const EX_RE = /^EX/i;

async function exEntries() {
  const { folderMeta } = await collectionRepository.folderModel();
  const dirs = (await fileStore.listFolderDirs()).filter((d) => d.parent === FOLDER_PARENTS.character);
  _charDirs = new Map(dirs.map((d) => [String(d.folderKey), d.handle]));
  const jobs = [];
  for (const d of dirs) {
    const fm = folderMeta[String(d.folderKey)];
    if (!fm || fm.rosterKind !== 'character') continue;
    for (const ep of fm.episodes || []) {
      if (!EX_RE.test(ep.label || '')) continue;
      jobs.push({ handle: d.handle, folderKey: String(d.folderKey), fm, ep });
    }
  }
  const found = await pool(jobs, 16, async (j) => {
    const sub = CHAR_DIR.episodeSlot(j.ep.episodeId, 'cg');
    const out = [];
    for (const name of await bundleIn(j.handle, sub)) {
      const m = name.match(/^(\d{8})_(\d+)\./);
      if (!m) continue;
      const no = String(parseInt(m[2], 10));
      out.push({
        id: `ex:${j.folderKey}:${j.ep.episodeId}:${m[2]}`,
        kind: 'ex',
        folderKey: j.folderKey,
        sub: sub + '/' + name,
        displayName: `${characterMeta.displayName(j.fm) || j.folderKey}EX${no}`,
        title: '',
      });
    }
    return out;
  });
  return found.flat().sort((a, b) => (a.displayName > b.displayName ? 1 : a.displayName < b.displayName ? -1 : 0));
}

export async function listEntries(kind, mode) {
  const list = kind === 'ex' ? await exEntries() : kind === 'other3d' ? await other3dEntries() : kind === 'monster' ? await monsterEntries(mode) : await characterEntries();
  _loaded.add(kind + ':' + mode);
  return index(list);
}

export async function ensureKinds(kinds, mode) {
  for (const kind of new Set(kinds)) {
    if (_loaded.has(kind + ':' + mode)) continue;
    try {
      await listEntries(kind, mode);
    } catch (e) {}
  }
}

export const entryOf = (id) => _byId.get(String(id)) || null;

const charHandle = (id) => (_charDirs ? _charDirs.get(String(id)) || null : null);

let _mouth;
async function mouthAtlas() {
  if (_mouth === undefined) _mouth = await charAssets.loadMouthAtlas(null);
  return _mouth;
}

async function charDetail(id) {
  try {
    return (await ensureIndexes()).master.characters[String(id)] || null;
  } catch (e) {
    return null;
  }
}

async function charWeapons(handle, det, read) {
  const files = await bundleIn(handle, CHAR_DIR.weapon);
  if (!files.length) return null;
  const list = [];
  for (const w of (det && det.weapons) || []) {
    const wid = String(w.weaponId);
    const model = files.find((f) => f.startsWith(wid + '_model.'));
    if (!model) continue;
    const mat = files.find((f) => f.startsWith(wid + '_mat.'));
    const deps = files.filter((f) => f.startsWith(wid + '_dep')).map((f) => CHAR_DIR.weapon + '/' + f);
    list.push({ id: wid, slot: w.slot || 'wp_2', scale: w.scale || 1, model: CHAR_DIR.weapon + '/' + model, materials: mat ? CHAR_DIR.weapon + '/' + mat : null, deps });
  }
  if (!list.length) return null;
  const out = await charAssets.buildWeapons(read, list);
  return out.length ? out : null;
}

const MAIN_MODEL = '@main';
const sharedRead = (rel) => (rel ? assetStore.readAsset(DIRS.shared, rel) : Promise.resolve(null));
const meshDepsOf = async (id) => {
  try {
    return ((await ensureIndexes()).meta.modelDeps || {})[String(id)] || [];
  } catch (e) {
    return [];
  }
};

export async function loadModelFor(entry, costume) {
  if (!entry) return null;
  if (entry.kind === 'other3d') {
    const e = _other3d && _other3d.get(String(entry.id));
    if (!e || !e.model) return null;
    const read = (rel) => (rel ? assetStore.readIn(AREA.other, rel) : Promise.resolve(null));
    const model = await charAssets.loadModelBundle(read, e.model, e.meshDeps, { depRead: sharedRead });
    if (!model) return null;
    const mats = e.materials || [];
    const pick = (costume && mats.includes(costume) && costume) || e.material || mats[0] || null;
    return {
      model,
      matBundle: await charAssets.loadMaterialBundle(read, pick),
      weapons: await charAssets.buildWeapons(read, e.weapons),
      attachments: e.attachments || undefined,
      attachmentColors: e.attachmentColors || null,
      mouthAtlas: e.mouth ? await mouthAtlas() : null,
      costume: pick || '',
      variations: mats.map((rel) => ({ value: rel, label: bundleName(rel) })),
      read,
    };
  }
  if (entry.kind === 'monster') {
    const m = _monsters && _monsters.get(String(entry.id));
    if (!m || !m.model) return null;
    const byRel = new Map((m.assets || []).map((a) => [a.rel, a]));
    const read = (rel) => (byRel.has(rel) ? assetStore.readIn(AREA.monster(byRel.get(rel)), rel) : Promise.resolve(null));
    const model = await charAssets.loadModelBundle(read, m.model, m.meshDeps, { always: true, depRead: sharedRead });
    if (!model) return null;
    const matBundle = await charAssets.loadMaterialBundle(read, m.material);
    const weapons = await charAssets.buildWeapons(read, m.weapons);
    return { model, matBundle, weapons, variations: [], attachments: m.attachments || null, read, mouthAtlas: await mouthAtlas() };
  }
  const handle = charHandle(entry.id);
  if (!handle) return null;
  const models = await bundleIn(handle, CHAR_DIR.visual('model'));
  if (!models.length) return null;
  const mats = await bundleIn(handle, CHAR_DIR.visual('materials'));
  const read = async (sub) => {
    try {
      return await fileStore.readBytesUnder(handle, sub);
    } catch (e) {
      return null;
    }
  };
  const modelBytes = await read(CHAR_DIR.visual('model') + '/' + models[0]);
  if (!modelBytes) return null;
  const pick = (costume && mats.includes(costume) && costume) || mats.find((n) => /default/i.test(n)) || mats[0] || null;
  const matBytes = pick ? await read(CHAR_DIR.visual('materials') + '/' + pick) : null;
  const det = await charDetail(entry.id);
  const modelRead = async (rel) => {
    if (rel === MAIN_MODEL) return modelBytes;
    try {
      return await assetStore.readIn(AREA.charVisual(handle, 'modeldep'), rel);
    } catch (e) {
      return null;
    }
  };
  const model = await charAssets.loadModelBundle(modelRead, MAIN_MODEL, await meshDepsOf(entry.id), { depRead: sharedRead });
  return {
    model: model || unityMesh.parseModelBundle(modelBytes),
    matBundle: matBytes ? unityMesh.parseMaterialBundle(matBytes, { keepCompressed: unityMesh.KEEP_DXT }) : { materials: [], textures: [] },
    weapons: await charWeapons(handle, det, read),
    attachmentColors: (det && det.attachmentColors) || null,
    mouthAtlas: await mouthAtlas(),
    costume: pick || '',
    variations: mats.map((n) => ({ value: n, label: n.replace(/_[0-9a-f]{16,}\.bundle$/i, '').replace(/\.player\.bundle$/i, '') })),
    handle,
    matNames: mats,
  };
}

const spineInputsOf = async (read) => {
  try {
    return unityMesh.extractSpineInputs(await read());
  } catch (e) {
    return null;
  }
};

export async function spineInputsFor(entry) {
  if (entry && entry.kind === 'ex') {
    const h = charHandle(entry.folderKey);
    return h ? await spineInputsOf(() => fileStore.readBytesUnder(h, entry.sub)) : null;
  }
  if (entry && entry.kind === 'monster') {
    const m = _monsters && _monsters.get(String(entry.id));
    for (const a of spineAssets(m)) {
      const inp = await spineInputsOf(() => assetStore.readIn(AREA.monster(a), a.rel));
      if (inp) return inp;
    }
    return null;
  }
  const handle = charHandle(entry && entry.id);
  if (!handle) return null;
  for (const cat of CAST_CATS) {
    const sub = CHAR_DIR.visual(cat);
    for (const n of await bundleIn(handle, sub)) {
      const inp = await spineInputsOf(() => fileStore.readBytesUnder(handle, sub + '/' + n));
      if (inp) return inp;
    }
  }
  return null;
}

const voiceNoOf = (nm) => {
  const m = String(nm).match(/_(\d+)[a-z]*$/i);
  return m ? parseInt(m[1], 10) : 0;
};

export async function voiceClipFor(entry, no) {
  if (!entry || entry.kind !== 'character' || !no) return null;
  const handle = charHandle(entry.id);
  if (!handle) return null;
  const names = (await fileStore.listUnder(handle, '')).filter((n) => /^voice_gallery\./i.test(n));
  if (!names.length) return null;
  const clips = await charAssets.extractClips(handle, names[0]);
  return clips.find((c) => voiceNoOf(c.name) === no) || null;
}
