import { linearToGamma as L2G } from '../color.js';

export function hdrDecodeValues(lightmapFormat) {
  const bit = 1 << (lightmapFormat | 0);
  if ((lightmapFormat | 0) <= 9 && bit & 548) return [5, 1, 1];
  if ((lightmapFormat | 0) <= 9 && bit & 130) return [2, 1, 0];
  return [1, 1, 0];
}

const BATTLE_LIGHT = { color: [1, 1, 1], intensity: 0.9, dir: [0, 1, 0] };

const envAverageOf = (avg) => (avg && avg.length === 3 ? [L2G(avg[0]), L2G(avg[1]), L2G(avg[2])] : null);
function envHdrOf(hdr) {
  if (Array.isArray(hdr) && hdr.length === 3) return [Number(hdr[0]) || 1, Number(hdr[1]) || 1, Number(hdr[2]) || 0];
  return [Number(hdr) > 0 ? Number(hdr) : 1, 1, 0];
}
const sceneLightOf = (l) => (l && l.dir && l.color ? { dir: l.dir.slice(0, 3), color: l.color.slice(0, 3), intensity: Number.isFinite(Number(l.intensity)) ? Number(l.intensity) : 1 } : null);

export const NO_ENV = Object.freeze({ avg: null, cube: null, hdr: [1, 1, 0], light: null });

export const makeVfxEnv = (cube, avg, light) => ({ avg: envAverageOf(avg), cube: cube || null, hdr: envHdrOf(cube && cube.userData ? cube.userData.hdr : null), light: sceneLightOf(light) });

export const envLight = (env) => (env && env.light) || BATTLE_LIGHT;
