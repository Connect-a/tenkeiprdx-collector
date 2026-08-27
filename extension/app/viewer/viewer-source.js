import { fileStore } from '../../core/fsdir.js';
import { assetStore } from '../../data/asset-store.js';
import { collectionRepository } from '../../data/collection.js';
import { charAssets } from '../../data/char-assets.js';
import { unityMesh } from '../../unity/mesh.js';
import { characterMeta } from '../../data/character-meta.js';
import { PLACE } from '../../core/placement.js';
import { DIRS, FOLDER_PARENTS } from '../../core/constants.js';
import { ensureIndexes } from '../../data/index-store.js';

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

export async function listEntries(kind, mode) {
  const list = kind === 'monster' ? await monsterEntries(mode) : await characterEntries();
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
  const files = await bundleIn(handle, 'visual/weapon');
  if (!files.length) return null;
  const list = [];
  for (const w of (det && det.weapons) || []) {
    const wid = String(w.weaponId);
    const model = files.find((f) => f.startsWith(wid + '_model.'));
    if (!model) continue;
    const mat = files.find((f) => f.startsWith(wid + '_mat.'));
    list.push({ id: wid, slot: w.slot || 'wp_2', scale: w.scale || 1, model: 'visual/weapon/' + model, materials: mat ? 'visual/weapon/' + mat : null });
  }
  if (!list.length) return null;
  const out = await charAssets.buildWeapons(read, list);
  return out.length ? out : null;
}

export async function loadModelFor(entry, costume) {
  if (!entry) return null;
  if (entry.kind === 'monster') {
    const m = _monsters && _monsters.get(String(entry.id));
    if (!m || !m.model) return null;
    const byRel = new Map((m.assets || []).map((a) => [a.rel, a]));
    const read = (rel) => (byRel.has(rel) ? assetStore.readAsset(DIRS.monster, rel, PLACE.owned(byRel.get(rel))) : Promise.resolve(null));
    const model = await charAssets.loadModelBundle(read, m.model, m.meshDeps, { always: true });
    if (!model) return null;
    const matBundle = await charAssets.loadMaterialBundle(read, m.material);
    const weapons = await charAssets.buildWeapons(read, m.weapons);
    return { model, matBundle, weapons, variations: [], attachments: m.attachments || null, read, mouthAtlas: await mouthAtlas() };
  }
  const handle = charHandle(entry.id);
  if (!handle) return null;
  const models = await bundleIn(handle, 'visual/model');
  if (!models.length) return null;
  const mats = await bundleIn(handle, 'visual/materials');
  const read = async (sub) => {
    try {
      return await fileStore.readBytesUnder(handle, sub);
    } catch (e) {
      return null;
    }
  };
  const modelBytes = await read('visual/model/' + models[0]);
  if (!modelBytes) return null;
  const pick = (costume && mats.includes(costume) && costume) || mats.find((n) => /default/i.test(n)) || mats[0] || null;
  const matBytes = pick ? await read('visual/materials/' + pick) : null;
  const det = await charDetail(entry.id);
  return {
    model: unityMesh.parseModelBundle(modelBytes),
    matBundle: matBytes ? unityMesh.parseMaterialBundle(matBytes) : { materials: [], textures: [] },
    weapons: await charWeapons(handle, det, read),
    attachmentColors: (det && det.attachmentColors) || null,
    mouthAtlas: await mouthAtlas(),
    costume: pick || '',
    variations: mats.map((n) => ({ value: n, label: n.replace(/_[0-9a-f]{16,}\.bundle$/i, '').replace(/\.player\.bundle$/i, '') })),
    handle,
    matNames: mats,
  };
}

export async function spineInputsFor(entry) {
  if (entry && entry.kind === 'monster') {
    const m = _monsters && _monsters.get(String(entry.id));
    for (const a of spineAssets(m)) {
      try {
        const b = await assetStore.readAsset(DIRS.monster, a.rel, PLACE.owned(a));
        const inp = b ? unityMesh.extractSpineInputs(b) : null;
        if (inp) return inp;
      } catch (e) {}
    }
    return null;
  }
  const handle = charHandle(entry && entry.id);
  if (!handle) return null;
  for (const sub of ['visual/spine', 'visual/spinelight']) {
    for (const n of await bundleIn(handle, sub)) {
      try {
        const b = await fileStore.readBytesUnder(handle, sub + '/' + n);
        const inp = b ? unityMesh.extractSpineInputs(b) : null;
        if (inp) return inp;
      } catch (e) {}
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
