import { fileStore } from '../core/fsdir.js';
import { assetStore } from './asset-store.js';
import { ensureIndexes } from './index-store.js';
import { unityMesh } from '../unity/mesh.js';
import { unityDecode } from '../unity/decode.js';
import { DIRS } from '../core/dirs.js';
const EMPTY_MAT = { materials: [], textures: [] };
const MAT_OPT = { keepCompressed: unityMesh.KEEP_DXT };

async function readBundle(handle, rel) {
  if (!rel || !handle) return null;
  return fileStore.readBytesUnder(handle, rel);
}

async function buildWeapons(read, list) {
  if (!unityMesh || !read) return [];
  const out = [];
  for (const w of list || []) {
    try {
      const mb = w.model ? await read(w.model) : null;
      if (!mb) continue;
      const matB = w.materials ? await read(w.materials) : null;
      const model = unityMesh.parseModelBundle(mb);
      if ((w.deps || []).length) await mergeMeshDeps(model, read, w.deps);
      out.push({ id: w.id, model, materials: matB ? unityMesh.parseMaterialBundle(matB, MAT_OPT) : EMPTY_MAT, slot: w.slot || 'wp_2', scale: w.scale || 1 });
    } catch (e) {}
  }
  return out;
}

async function mergeMeshDeps(model, read, deps) {
  const has = (list, pathID) => (list || []).some((x) => String(x.pathID) === String(pathID));
  for (const rel of deps || []) {
    let dep = null;
    try {
      const bytes = await read(rel);
      if (bytes) dep = unityMesh.parseModelBundle(bytes);
    } catch (e) {}
    if (!dep) continue;
    for (const mesh of dep.meshes || []) if (!has(model.meshes, mesh.pathID)) model.meshes.push(mesh);
    for (const mat of dep.materials || []) if (!has(model.materials, mat.pathID)) model.materials.push(mat);
    if (!model.avatar && dep.avatar) model.avatar = dep.avatar;
    if (!(model.clips || []).length && (dep.clips || []).length) model.clips = dep.clips;
  }
  return model;
}

async function loadModelBundle(read, modelRel, meshDeps, opts = {}) {
  const mb = modelRel ? await read(modelRel) : null;
  if (!mb) return null;
  try {
    const model = unityMesh.parseModelBundle(mb);
    const missing = (model.renderers || []).some((r) => !model.meshes.find((m) => String(m.pathID) === String(r.meshPathID)));
    const depRead = opts.depRead ? async (rel) => (await read(rel)) || (await opts.depRead(rel)) : read;
    if (opts.always || missing || !(model.clips || []).length) await mergeMeshDeps(model, depRead, meshDeps);
    return model;
  } catch (e) {
    return null;
  }
}

async function loadMaterialBundle(read, matRel) {
  const b = matRel ? await read(matRel) : null;
  if (!b) return EMPTY_MAT;
  try {
    return unityMesh.parseMaterialBundle(b, MAT_OPT);
  } catch (e) {
    return EMPTY_MAT;
  }
}

async function loadWeapons(handle, assets) {
  const wmap = assets && assets.weapon;
  if (!wmap) return null;
  const out = await buildWeapons(
    (rel) => readBundle(handle, rel),
    Object.keys(wmap).map((id) => ({ ...wmap[id], id })),
  );
  return out.length ? out : null;
}

async function loadMouthAtlas(bytes) {
  if (!unityMesh) return null;
  try {
    let b = bytes;
    if (!b) {
      const g = (await ensureIndexes()).assets.globalAssets || {};
      if (g.mouthAtlas) b = await assetStore.readAsset(DIRS.shared, g.mouthAtlas);
    }
    return b ? unityMesh.parseMouthAtlas(b) : null;
  } catch (e) {
    return null;
  }
}

async function load3d(cur, opts) {
  opts = opts || {};
  if (!unityMesh || !cur || !cur.handle) return null;
  const assets = (cur.meta || {}).assets || {};
  const folderKey = String(cur.folderKey || '');
  const modelPath = assets.model && (assets.model[folderKey] || assets.model[Object.keys(assets.model)[0]]);
  if (!modelPath) return null;
  const variations = Object.keys(assets.materials || {});
  const costume = opts.costume && variations.includes(opts.costume) ? opts.costume : variations.includes('default') ? 'default' : variations[0];
  const matPath = (assets.materials && assets.materials[costume]) || null;
  const modelBytes = await readBundle(cur.handle, modelPath);
  if (!modelBytes) return null;
  const matBytes = matPath ? await readBundle(cur.handle, matPath) : null;
  return {
    model: unityMesh.parseModelBundle(modelBytes),
    matBundle: matBytes ? unityMesh.parseMaterialBundle(matBytes, MAT_OPT) : EMPTY_MAT,
    weapons: await loadWeapons(cur.handle, assets),
    mouthAtlas: await loadMouthAtlas(opts.mouthAtlasBytes),
    variations,
    costume,
  };
}

const UI_KEYS = ['height', 'weaponAttach', 'costume', 'auraPicker', 'motionVoice', 'auraBytes', 'auraTexMap', 'hidePartsUI'];
function build3dOptions(loaded, master, ui) {
  const l = loaded || {},
    m = master || {},
    u = ui || {};
  const o = { mouthAtlas: l.mouthAtlas || null, weapons: l.weapons || null, attachments: m.attachments, attachmentColors: m.attachmentColors };
  for (const k of UI_KEYS) if (u[k] != null) o[k] = u[k];
  return o;
}

async function extractClips(handle, path) {
  if (!handle || !path) return [];
  const b = await fileStore.readBytesUnder(handle, path);
  if (!b) return [];
  try {
    return await unityDecode.extractVoiceClips(b);
  } catch (e) {
    return [];
  }
}

export const charAssets = { load3d, build3dOptions, extractClips, buildWeapons, mergeMeshDeps, loadModelBundle, loadMaterialBundle, loadMouthAtlas };
