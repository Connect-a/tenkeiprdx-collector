import { bundleName, relKey, APP_REL } from './paths.js';

const ASSET_DIR = 'assets';
const CAT_RE = /^([a-z0-9()]+_(?:assets|scenes)_[a-z0-9()]+)\//i;

export const catOf = (rel) => {
  if (APP_REL.test(rel)) return 'builtin';
  const m = String(rel).match(CAT_RE);
  return m ? m[1] : '';
};

const BAD_NAME = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\ufeff<>:"\\|?*]/g;
const safeName = (s) => String(s).replace(BAD_NAME, '_');

let NAME_ALIAS = {};
export const setNameAlias = (map) => {
  NAME_ALIAS = map || {};
};
const fileFor = (rel, platform) => `${safeName(bundleName(String(rel)))}.${platform}.bundle`;

const ownerSeg = (rel) => {
  const s = String(rel);
  const m = s.match(CAT_RE);
  if (!m) return '';
  const rest = s.slice(m[0].length);
  const i = rest.lastIndexOf('/');
  return i < 0 ? '' : safeName(rest.slice(0, i).split('/').pop()) + '_';
};

const shortCat = (rel) => {
  const c = catOf(rel);
  if (!c || c === 'builtin') return '';
  const m = c.match(/^([a-z0-9()]+)_(?:assets|scenes)_/i);
  return m ? m[1] : c;
};

export const CHAR_DIR = {
  visual: (cat) => `visual/${cat}`,
  weapon: 'visual/weapon',
  voiceGallery: '',
  episodeRoot: (episodeId) => `story/${episodeId}`,
  episodeSlot: (episodeId, slot) => `story/${episodeId}/${slot}`,
};

export const EPISODE_FILE = {
  sceneName: (sceneId) => `scene_${sceneId}.bin`,
  timelineName: (sceneId) => `scene_${sceneId}.json`,
  detailsName: 'getDetails.bin',
  scene: (episodeId, sceneId) => `${CHAR_DIR.episodeRoot(episodeId)}/scene_${sceneId}.bin`,
  timeline: (episodeId, sceneId) => `${CHAR_DIR.episodeRoot(episodeId)}/scene_${sceneId}.json`,
  details: (episodeId) => `${CHAR_DIR.episodeRoot(episodeId)}/getDetails.bin`,
};

export const SHARED_FILE = {
  master: 'masterdata.bin',
  user: 'user.bin',
  catalogDir: 'catalogs',
  catalog: (name) => 'catalogs/' + name,
  vfxCatalog: 'catalogs/vfx_catalog.json',
  staticsDir: 'statics',
  statics: (name) => 'statics/' + name,
  gachaMissing: 'statics/_gacha_missing.json',
};

export const sceneHave = (sceneIds, names) => {
  const ids = (sceneIds || []).map(String);
  if (!ids[0] || !names.has(EPISODE_FILE.sceneName(ids[0]))) return 'none';
  return ids.every((sid) => names.has(EPISODE_FILE.sceneName(sid))) ? 'full' : 'partial';
};

export const PLACE = {
  mirror: (rel) => {
    const dir = `${ASSET_DIR}/${catOf(rel) || 'misc'}/`;
    const a = NAME_ALIAS[relKey(String(rel))];
    return a ? { dir, name: a } : dir;
  },
  flat: (rel) => (shortCat(rel) ? shortCat(rel) + '_' : '') + ownerSeg(rel),
  visual: (cat) => () => CHAR_DIR.visual(cat) + '/',
  episode: (episodeId, slot) => () => CHAR_DIR.episodeSlot(episodeId, slot) + '/',
  weapon: (name) => () => ({ dir: CHAR_DIR.weapon + '/', name }),
  voiceGallery: () => () => ({ dir: CHAR_DIR.voiceGallery, name: 'voice_gallery' }),
  owned: (item) => (rel) => `${item.ownerId || item.id}/${item.cat}_${ownerSeg(rel)}`,
  named: (prefix) => () => prefix,
  fixed: (dir, name) => () => ({ dir, name }),
};

export const subFor = (place, rel, platform) => {
  const p = (place || PLACE.mirror)(rel);
  if (typeof p === 'function') throw new Error('保存先の指定を誤っています（place が関数を返しました）');
  return typeof p === 'object' ? `${p.dir}${p.name}.${platform}.bundle` : p + fileFor(rel, platform);
};
export const dirOfPrefix = (p) => {
  const i = String(p).lastIndexOf('/');
  return i < 0 ? '' : String(p).slice(0, i);
};
export const fileHead = (p) => {
  const i = String(p).lastIndexOf('/');
  return i < 0 ? String(p) : String(p).slice(i + 1);
};
