import * as THREE from '../../../vendor/three.module.js';
import { bakeGameShaderTex, bakeGameShaderAges } from './vfx-bake.js';
import { proceduralTex } from './vfx-proctex.js';
import { materialClips } from '../game-shader-util.js';
import { NO_ENV, envLight } from './vfx-lighting.js';

export function materialEmission(entry) {
  if (!entry || !Array.isArray(entry.keywords) || !entry.keywords.includes('_EMISSION')) return null;
  if (Array.isArray(entry.texSlots) && entry.texSlots.includes('_EmissionMap')) return null;
  const c = entry.proc && entry.proc.colors && entry.proc.colors._EmissionColor;
  if (!c || !(c[0] || c[1] || c[2])) return null;
  return [c[0] || 0, c[1] || 0, c[2] || 0];
}
function queueOrder(entry) {
  const q = entry && entry.queue != null ? Number(entry.queue) : 2000;
  return (Number.isFinite(q) ? q - 2000 : 0) * 1e7;
}
export function drawOrder(entry, n) {
  const fudge = Math.round(Number(n && n.sortingFudge) || 0);
  return queueOrder(entry) + ((n && n.sortingLayer) | 0) * 3e6 + ((n && n.sortingOrder) || 0) * 1000 - Math.max(-999, Math.min(999, fudge));
}

const LIT = new WeakMap();
export const materialLit = (mat) => (mat && LIT.get(mat)) || null;
const AGE_STRIP = new WeakSet();
export const usesAgeStrip = (mat) => !!mat && AGE_STRIP.has(mat);

export function makeMaterial(entry, opt, vfx) {
  const env = (vfx && vfx.env) || NO_ENV;
  const bakes = vfx ? vfx.bakes : null;
  let tex = entry && entry.tex ? entry.tex : null;
  let ageStrip = false;
  if (opt && opt.ageSlices && entry && entry.proc && entry.proc.shader) {
    const strip = bakeGameShaderAges(bakes, entry.proc, tex, opt.ageSlices, opt.matAnim);
    if (strip && strip.tex) {
      tex = strip.tex;
      ageStrip = true;
    }
  } else if (tex && opt && opt.allowBake) {
    const baked = bakeGameShaderTex(bakes, entry.proc, tex, opt.streamValues, opt.matAnim);
    if (baked) tex = baked;
  }
  if (!tex) tex = proceduralTex(entry && entry.proc, bakes);
  const mat = materialFor(entry, tex, env);
  if (ageStrip) AGE_STRIP.add(mat);
  return mat;
}

function materialFor(entry, tex, env) {
  const blend = entry && entry.blend ? entry.blend : 'add';
  if (entry && entry.lit) {
    const light = envLight(env);
    const litMat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: blend !== 'opaque',
      blending: blend === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending,
      alphaTest: materialClips(entry) ? (entry.cutoff != null ? entry.cutoff : 0.5) : 0,
      depthWrite: blend === 'opaque',
      depthTest: true,
      side: entry.lit.cull === 2 ? THREE.BackSide : entry.lit.cull === 1 ? THREE.FrontSide : THREE.DoubleSide,
    });
    LIT.set(litMat, {
      metallic: entry.lit.metallic,
      perceptualRoughness: 1 - entry.lit.smoothness,
      emission: materialEmission(entry),
      env: env.avg || [1, 1, 1],
      envCube: env.cube,
      envHdr: env.hdr,
      lightDir: light.dir,
      lightColor: [light.color[0] * light.intensity, light.color[1] * light.intensity, light.color[2] * light.intensity],
    });
    return litMat;
  }
  if (blend === 'opaque') {
    const clips = materialClips(entry);
    const cut = entry && entry.cutoff != null ? Number(entry.cutoff) : null;
    if (clips && cut == null)
      return new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.NormalBlending, alphaTest: 1e-4, depthWrite: true, depthTest: true, side: THREE.DoubleSide });
    return new THREE.MeshBasicMaterial({
      map: tex,
      transparent: false,
      alphaTest: clips ? cut : 0,
      depthWrite: true,
      depthTest: true,
      side: THREE.DoubleSide,
    });
  }
  return new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    blending: blend === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });
}
