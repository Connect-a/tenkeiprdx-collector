import { fileStore } from './fsdir.js';
import { DIRS } from './dirs.js';

const SCENES_SUB = 'scenes';
const PREFS_PATH = 'settings.json';
const FILE_RE = /^[^\\/:*?"<>|\x00-\x1f ]{1,60}$/;
const nameOk = (n) => FILE_RE.test(String(n || '')) && !/^\.+$/.test(String(n));

async function dir(create) {
  try {
    return await fileStore.getDir(DIRS.save, { create: !!create });
  } catch (e) {
    return null;
  }
}

async function readJson(path) {
  const d = await dir(false);
  if (!d) return null;
  try {
    const f = await fileStore.readUnder(d, path);
    if (!f) return null;
    return JSON.parse(await f.text());
  } catch (e) {
    return null;
  }
}

async function writeJson(path, value) {
  const d = await dir(true);
  if (!d) return false;
  try {
    await fileStore.writeUnder(d, path, new TextEncoder().encode(JSON.stringify(value, null, 2)));
    return true;
  } catch (e) {
    return false;
  }
}

async function removeJson(path) {
  const d = await dir(false);
  if (!d) return false;
  try {
    await fileStore.removeUnder(d, path);
    return true;
  } catch (e) {
    return false;
  }
}

const scenePath = (name) => `${SCENES_SUB}/${name}.json`;

async function listScenes() {
  const d = await dir(false);
  if (!d) return [];
  try {
    return (await fileStore.listUnder(d, SCENES_SUB, { nonEmpty: true }))
      .filter((n) => /\.json$/i.test(n))
      .map((n) => n.replace(/\.json$/i, ''))
      .sort();
  } catch (e) {
    return [];
  }
}

const loadScene = (name) => (nameOk(name) ? readJson(scenePath(name)) : Promise.resolve(null));
const saveScene = (name, value) => (nameOk(name) ? writeJson(scenePath(name), value) : Promise.resolve(false));
const deleteScene = (name) => (nameOk(name) ? removeJson(scenePath(name)) : Promise.resolve(false));

const SHOTS_SUB = 'images';

async function saveImage(name, blob) {
  if (!nameOk(name)) return '';
  const d = await dir(true);
  if (!d || !blob) return '';
  const path = `${SHOTS_SUB}/${name}.png`;
  try {
    await fileStore.writeUnder(d, path, new Uint8Array(await blob.arrayBuffer()));
    return `${DIRS.save}/${path}`;
  } catch (e) {
    return '';
  }
}

const FAV_PATH = 'favorites.json';

async function loadFavorites() {
  const v = await readJson(FAV_PATH);
  if (Array.isArray(v)) return v.map(String);
  return v && Array.isArray(v.items) ? v.items.map(String) : null;
}

const saveFavorites = (items) => writeJson(FAV_PATH, { items: [...new Set((items || []).map(String))].sort() });

async function loadPrefs() {
  return (await readJson(PREFS_PATH)) || {};
}

async function savePrefs(patch) {
  const cur = (await readJson(PREFS_PATH)) || {};
  return writeJson(PREFS_PATH, { ...cur, ...patch });
}

export const saveData = { loadPrefs, savePrefs, readJson, writeJson, removeJson, listScenes, loadScene, saveScene, deleteScene, saveImage, loadFavorites, saveFavorites, nameOk };
