import { assetUrlOn, APP_REL } from './paths.js';
import { catOf } from './placement.js';

const KIND_ORDER = {
  image: ['player', 'web'],
  audio: ['web', 'player'],
  mesh: ['web', 'player'],
};

const AUDIO_CAT = /^(adventurevoice|charactervoices|illustrationvoice|bgm|se|vfxse|battlese(\(uncompressed\))?|builtinaudio(\(uncompressed\))?)_assets_|^minigames_assets_bgm$/i;
const MESH_CAT = /^3dmodels_assets_3dmodels$/i;
function kindOf(rel) {
  const cat = catOf(rel);
  if (AUDIO_CAT.test(cat)) return 'audio';
  if (MESH_CAT.test(cat)) return 'mesh';
  return 'image';
}

export function platformsFor(rel) {
  if (APP_REL.test(rel)) return ['web'];
  return KIND_ORDER[kindOf(rel)] || KIND_ORDER.image;
}

export function routeFor(rel, altRel) {
  const out = [];
  for (const platform of platformsFor(rel)) {
    const r = platform === 'web' ? rel : altRel || rel;
    if (!r) continue;
    out.push({ platform, rel: r });
  }
  return out;
}

export const routeUrl = (base, cand) => assetUrlOn(base, cand.platform, cand.rel);
