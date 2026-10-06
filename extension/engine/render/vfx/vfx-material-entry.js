import { unityMesh as MESH_MOD } from '../../../unity/mesh.js';
import { noteBuildFailure } from './vfx-failures.js';

const URP_LIT = /^Universal Render Pipeline\/(Particles\/)?Lit$/;
const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));
const MAIN_TEX_SLOTS = ['_BaseMap', '_MainTex'];
const mainDefTex = (si) => {
  for (const n of MAIN_TEX_SLOTS) {
    const p = si && si.props && si.props[n];
    if (p) return p.defTex == null ? '' : String(p.defTex);
  }
  return null;
};

export function buildMaterialMap(T, depBundles) {
  const map = new Map();
  if (!MESH_MOD || !MESH_MOD.parseMaterialBundle) return map;
  const alphaOpaqueCache = new Map();
  const isAlphaOpaque = (t) => {
    const k = String(t.pathID);
    if (alphaOpaqueCache.has(k)) return alphaOpaqueCache.get(k);
    const px = t.rgba,
      n = px.length / 4,
      step = Math.max(1, Math.floor(n / 4096));
    let aMin = 255;
    for (let i = 0; i < n; i += step) {
      const a = px[i * 4 + 3];
      if (a < aMin) aMin = a;
      if (aMin < 24) break;
    }
    const opaque = aMin > 200;
    alphaOpaqueCache.set(k, opaque);
    return opaque;
  };
  const mkTex = (t, lumAlpha) => {
    if (!t || !t.rgba) return null;
    let data = t.rgba;
    if (lumAlpha && isAlphaOpaque(t)) {
      data = new Uint8Array(t.rgba);
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i],
          g = data[i + 1],
          b = data[i + 2];
        data[i + 3] = Math.max(r, g, b);
      }
    }
    const tx = new T.DataTexture(data, t.width, t.height, T.RGBAFormat);
    tx.needsUpdate = true;
    tx.minFilter = T.LinearFilter;
    tx.magFilter = T.LinearFilter;
    if ('colorSpace' in tx) tx.colorSpace = T.LinearSRGBColorSpace || T.NoColorSpace || 'srgb-linear';
    return tx;
  };
  const parsed = [];
  const texPool = new Map();
  const shaderNameByPid = {};
  const shaderInfoByPid = {};
  for (const bytes of depBundles) {
    if (!bytes) continue;
    let b = null;
    try {
      b = MESH_MOD.parseMaterialBundle(bytes);
    } catch (e) {
      noteBuildFailure('materialBundle', e);
    }
    if (!b) continue;
    const mats = b.materials || [],
      texs = b.textures || [];
    parsed.push({ mats, texs });
    if (b.shaders) Object.assign(shaderNameByPid, b.shaders);
    if (b.shaderInfo) Object.assign(shaderInfoByPid, b.shaderInfo);
    for (const t of texs) if (t.rgba && !texPool.has(String(t.pathID))) texPool.set(String(t.pathID), t);
  }
  const texCache = new Map();
  const poolTex = (pid, lumAlpha) => {
    const k = String(pid) + (lumAlpha ? '|L' : '');
    if (texCache.has(k)) return texCache.get(k);
    const tx = texPool.has(String(pid)) ? mkTex(texPool.get(String(pid)), lumAlpha) : null;
    texCache.set(k, tx);
    return tx;
  };
  for (const { mats, texs } of parsed) {
    let onlyPid = null;
    if (texs.length === 1 && texs[0].rgba) onlyPid = String(texs[0].pathID);
    for (const m of mats) {
      if (map.has(String(m.pathID))) continue;
      const blend = MESH_MOD.resolveBlend(m, shaderInfoByPid) || m.blend || (m.dstBlend === 10 ? 'alpha' : 'add');
      const lumAlpha = blend === 'alpha';
      let tx = null;
      if (m.mainTexPathID) tx = poolTex(m.mainTexPathID, lumAlpha);
      if (!tx && onlyPid) tx = poolTex(onlyPid, lumAlpha);
      const shaderName = m.shaderName || (m.shaderPathID ? shaderNameByPid[m.shaderPathID] || null : null);
      const kw = m.keywords;
      const keywords = kw && typeof kw.has === 'function' ? [...kw] : Array.isArray(kw) ? kw.slice() : [];
      const si0 = m.shaderPathID ? shaderInfoByPid[m.shaderPathID] : null;
      const proc = { shader: shaderName, vec1: m.vec1 || {}, colors: m.allColors || {}, floats: m.allFloats || {}, keywords, defTex: mainDefTex(si0) };
      const texSlots = Object.keys(m.texByName || {});
      const alphaClip = Number(m.alphaClip) > 0.5 || keywords.includes('_ALPHATEST_ON') || keywords.includes('_ALPHATEST');
      const fl = m.allFloats || {};
      const lit = URP_LIT.test(shaderName || '')
        ? {
            metallic: clamp01(fl._Metallic),
            smoothness: fl._Smoothness == null ? 0.5 : clamp01(fl._Smoothness),
            cull: m.cull == null ? 0 : Number(m.cull) | 0,
          }
        : null;
      const si = m.shaderPathID ? shaderInfoByPid[m.shaderPathID] : null;
      const queue = Number(m.renderQueue) >= 0 ? Number(m.renderQueue) : si && si.queue != null ? si.queue : blend === 'opaque' ? 2000 : 3000;
      map.set(String(m.pathID), { tex: tx || null, blend, solid: !m.mainTexPathID, tint: m.color || null, proc, cutoff: m.cutoff != null ? m.cutoff : null, alphaClip: !!alphaClip, lit, keywords, texSlots, queue });
    }
  }
  map.rawTex = (pid) => (pid ? texPool.get(String(pid)) || null : null);
  return map;
}
