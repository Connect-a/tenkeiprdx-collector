const KIND_TO_API = { character: 'Character', main: 'Quest', event: 'Quest', special: 'Special' };
const apiTypeForKind = (rosterKind) => KIND_TO_API[rosterKind] || null;
const episodeIdOf = (ep) => ep && ep.episodeId;

export { apiTypeForKind, episodeIdOf };

const displayName = (meta) => {
  if (!meta) return '';
  const name = meta.name || '';
  if (meta.rosterKind === 'character') return meta.title ? name + meta.title : name;
  return meta.chapter ? (name ? name + ' ' : '') + meta.chapter : name;
};
const voiceGalleryBundle = (vg) => (vg && vg.bundle) || null;

export const CAST_CATS = ['spine', 'spinelight'];
export const castRelOf = (assets) => {
  for (const cat of CAST_CATS) {
    const rel = ((assets && assets[cat]) || [])[0];
    if (rel) return rel;
  }
  return null;
};

const VIS_SPINE = new Set(['spine', 'spinelight', 'still']);
const VIS_IMAGE = new Set(['icon', 'iconlight', 'chibiicon', 'itemicon', 'equipicon', 'battleicon', 'monstericon', 'illustx', 'thumb', 'banner']);
const VIS_ORDER = ['spine', 'spinelight', 'still', 'icon', 'iconlight', 'chibiicon', 'battleicon', 'monstericon', 'itemicon', 'equipicon', 'illustx', 'thumb', 'banner'];
const visRank = (cat) => {
  const i = VIS_ORDER.indexOf(cat);
  return i < 0 ? VIS_ORDER.length : i;
};

function buildVisuals(meta) {
  const out = [];
  const assets = (meta && meta.assets) || {};
  const cats = Object.keys(assets)
    .filter((cat) => VIS_SPINE.has(cat) || VIS_IMAGE.has(cat))
    .sort((a, b) => visRank(a) - visRank(b) || (a > b ? 1 : -1));
  for (const cat of cats) {
    const spine = VIS_SPINE.has(cat);
    const rec = assets[cat];
    const entries = (typeof rec === 'string' ? [['', rec]] : rec && typeof rec === 'object' ? Object.entries(rec) : []).sort((a, b) => (a[0] > b[0] ? 1 : -1));
    for (const [k, path] of entries) {
      if (typeof path !== 'string') continue;
      if (spine) out.push({ kind: 'spine', scope: 'own', path, label: cat === 'still' && k ? 'still ' + k : cat, stand: cat !== 'still' });
      else out.push({ kind: 'image', scope: 'own', path, label: k ? cat + ' ' + k : cat });
    }
  }
  if (Array.isArray(meta && meta.episodes)) {
    for (const ep of meta.episodes) {
      if (!ep || !ep.cg) continue;
      const eid = episodeIdOf(ep);
      for (const [k, path] of Object.entries(ep.cg)) {
        if (typeof path !== 'string') continue;
        if (/^\d{8}_\d+$/.test(k)) out.push({ kind: 'spine', scope: 'story', ep: eid, path, label: 'still ' + k, stand: false });
        else out.push({ kind: 'image', scope: 'story', ep: eid, path, label: k });
      }
    }
  }
  const seen = new Set();
  return out.filter((v) => v.path && !seen.has(v.path) && seen.add(v.path));
}

export const characterMeta = { buildVisuals, voiceGalleryBundle, displayName };
