import * as THREE from '../../../vendor/three.module.js';
import { bakeGameShaderTex } from './vfx-bake.js';

const UNITY_DEFAULT_TEX = {
  white: [255, 255, 255, 255],
  black: [0, 0, 0, 0],
  gray: [128, 128, 128, 128],
  grey: [128, 128, 128, 128],
  bump: [128, 128, 255, 128],
  red: [255, 0, 0, 0],
};
const _defTex = new Map();
function defaultTexture(name) {
  if (name == null) return null;
  const key = name === '' ? 'gray' : String(name).toLowerCase();
  const px = UNITY_DEFAULT_TEX[key];
  if (!px) return null;
  if (_defTex.has(key)) return _defTex.get(key);
  const t = new THREE.DataTexture(new Uint8Array(px), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  _defTex.set(key, t);
  return t;
}

const _procCache = new Map();
export function proceduralTex(proc, bakes) {
  if (!proc || !proc.shader) return null;
  const baked = bakeGameShaderTex(bakes || null, proc);
  if (baked) return baked;
  const sh = proc.shader,
    v = proc.vec1 || {};
  const Vf = v['Vector1_f0683063f9b44121bff83e626fd4632a'];
  const V1 = v['Vector1_1'];
  const V9 = v['Vector1_9e0b82cda8e244118777bca7e52af518'];
  let fnR = null;
  if (sh === 'Shader Graphs/CircleHole_add') {
    const vf = Vf != null ? Vf : 1,
      v1 = V1 != null ? V1 : 13,
      v9 = V9 != null ? V9 : 100;
    fnR = (r) => {
      const a = 2 * r * vf;
      return Math.max(0, Math.min(1, Math.pow(a, v1) * (1 - Math.pow(a, v9))));
    };
  } else if (/Circle_nomal_GF/.test(sh)) {
    const vf = Vf != null ? Vf : 1,
      v9 = V9 != null ? V9 : 30;
    fnR = (r) => Math.max(0, Math.min(1, 1 - Math.pow(2 * r * vf, v9)));
  } else if (/Circle_nomal|Circle_add/.test(sh)) {
    const v9 = V9 != null ? V9 : 4;
    fnR = (r) => Math.max(0, Math.min(1, 1 - Math.pow(Math.min(1, 2 * r), v9)));
  }
  if (!fnR) return defaultTexture(proc.defTex);
  const key = sh + '|' + JSON.stringify(v);
  if (_procCache.has(key)) return _procCache.get(key);
  const S = 128,
    data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const ux = (x + 0.5) / S,
        uy = (y + 0.5) / S;
      const a = fnR(Math.hypot(ux - 0.5, uy - 0.5));
      const i = (y * S + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  _procCache.set(key, tex);
  return tex;
}
