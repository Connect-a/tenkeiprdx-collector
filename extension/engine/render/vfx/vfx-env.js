import * as THREE from '../../../vendor/three.module.js';
import { unityMesh } from '../../../unity/mesh.js';
import { assetStore } from '../../../data/asset-store.js';
import { ensureIndexes } from '../../../data/index-store.js';
import { DIRS } from '../../../core/dirs.js';
import { bundleName } from '../../../core/assetpath/paths.js';
import { hdrDecodeValues } from './vfx-lighting.js';
import { noteBuildFailure } from './vfx-failures.js';

const DEFAULT_MAP = 'battlemap_desert';

const _byMap = new Map();

async function relOf(name) {
  const idx = await ensureIndexes();
  const rels = (idx.assets.battleFieldRels || []).filter((r) => /^battlefieldsassets_scenes_battlefields\//.test(r));
  const want = String(name).toLowerCase();
  return rels.find((r) => String(bundleName(r)).toLowerCase() === want) || null;
}

function cubeOf(rec) {
  const faces = rec.faces.map((f) => new THREE.DataTexture(f, rec.width, rec.height, THREE.RGBAFormat, THREE.UnsignedByteType));
  const tex = new THREE.CubeTexture(faces);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.LinearSRGBColorSpace || 'srgb-linear';
  tex.magFilter = THREE.LinearFilter;
  tex.flipY = false;
  tex.unpackAlignment = 1;
  const levels = rec.levels && rec.mipCount > 1 ? rec.levels : null;
  if (levels) {
    tex.mipmaps = [];
    for (let i = 1; i < rec.mipCount; i++)
      tex.mipmaps.push({ image: levels.map((c) => new THREE.DataTexture(c[i].rgba, c[i].width, c[i].height, THREE.RGBAFormat, THREE.UnsignedByteType)) });
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = false;
  } else {
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
  }
  tex.needsUpdate = true;
  return tex;
}

function avgEnv(rec, hdr) {
  let n = 0,
    r = 0,
    g = 0,
    b = 0;
  for (const f of rec.faces) {
    const step = Math.max(4, (f.length / 4 / 4096) | 0) * 4;
    for (let i = 0; i < f.length; i += step) {
      const m = Math.pow(Math.max(hdr[2] * (f[i + 3] / 255 - 1) + 1, 0), hdr[1]) * hdr[0];
      r += (f[i] / 255) * m;
      g += (f[i + 1] / 255) * m;
      b += (f[i + 2] / 255) * m;
      n++;
    }
  }
  return n ? [r / n, g / n, b / n] : [1, 1, 1];
}

function decodeBattleEnv(rel, bytes) {
  const rec = unityMesh.extractReflectionCube(bytes);
  if (!rec || !rec.faces) throw new Error('no cubemap');
  const hdr = hdrDecodeValues(rec.lightmapFormat);
  const cube = cubeOf(rec);
  cube.userData = { map: bundleName(rel), name: rec.name, size: rec.width, matchedRenderSettings: rec.matchedRenderSettings, reflectionIntensity: rec.reflectionIntensity, lightmapFormat: rec.lightmapFormat, colorSpace: rec.colorSpace, hdr };
  let light = null;
  try {
    light = unityMesh.extractSceneLight(bytes);
  } catch (e) {
    noteBuildFailure('battleLight', e);
  }
  return { cube, avg: avgEnv(rec, hdr), light };
}

export function loadBattleEnv(mapName) {
  const key = String(mapName || DEFAULT_MAP);
  if (_byMap.has(key)) return _byMap.get(key);
  const p = (async () => {
    let rel = null,
      bytes = null;
    try {
      rel = await relOf(key);
      bytes = rel ? await assetStore.readAsset(DIRS.shared, rel) : null;
    } catch (e) {
      noteBuildFailure('battleEnvironmentRead', e);
    }
    if (!bytes) {
      _byMap.delete(key);
      return null;
    }
    try {
      return decodeBattleEnv(rel, bytes);
    } catch (e) {
      noteBuildFailure('battleEnvironment', e);
      return null;
    }
  })();
  _byMap.set(key, p);
  return p;
}
