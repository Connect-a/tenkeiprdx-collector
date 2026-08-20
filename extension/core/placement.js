import { bundleName, APP_REL } from './paths.js';

const ASSET_DIR = 'assets';
const CAT_RE = /^([a-z0-9()]+_(?:assets|scenes)_[a-z0-9()]+)\//i;

export const catOf = (rel) => {
  if (APP_REL.test(rel)) return 'builtin';
  const m = String(rel).match(CAT_RE);
  return m ? m[1] : '';
};

const BAD_NAME = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\ufeff<>:"\\|?*]/g;
const safeName = (s) => String(s).replace(BAD_NAME, '_');

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

export const PLACE = {
  mirror: (rel) => `${ASSET_DIR}/${catOf(rel) || 'misc'}/`,
  flat: (rel) => (shortCat(rel) ? shortCat(rel) + '_' : '') + ownerSeg(rel),
  visual: (cat) => () => `visual/${cat}/`,
  episode: (epDir, slot) => () => `${epDir}/${slot}/`,
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
