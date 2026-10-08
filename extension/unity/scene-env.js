import { unityDecode } from './decode.js';
import { unitySf } from './unity-sf.js';
import { attempt, readOne } from './bundle-cab.js';
import { decodeCubemap } from './texture.js';
import { noteFailure } from '../core/failures.js';
export function extractReflectionCube(bytes) {
  const parsed = unityDecode.parseUnityFS(bytes);
  const cabs = [];
  for (const n of parsed.nodes) {
    if (n.path.endsWith('.resource') || n.path.endsWith('.resS')) continue;
    const sf = parsed.data.subarray(n.off, n.off + n.sz);
    const sfp = attempt(() => unitySf.parseSerializedFile(sf));
    if (sfp) cabs.push({ sf, sfp });
  }
  let wantPid = null,
    ambientIntensity = 1,
    reflectionIntensity = 1;
  for (const { sf, sfp } of cabs) {
    for (const o of sfp.objects) {
      if (o.classID !== 104) continue;
      const rs = readOne(sf, sfp.LE, o);
      if (!rs) continue;
      const cust = rs.m_CustomReflection;
      const gen = rs.m_GeneratedSkyboxReflection;
      const ref = cust && String(cust.m_PathID) !== '0' ? cust : gen;
      if (ref && String(ref.m_PathID) !== '0') wantPid = String(ref.m_PathID);
      if (rs.m_AmbientIntensity != null) ambientIntensity = Number(rs.m_AmbientIntensity) || 1;
      if (rs.m_ReflectionIntensity != null) reflectionIntensity = Number(rs.m_ReflectionIntensity);
      break;
    }
    if (wantPid) break;
  }
  const cands = [];
  for (const { sf, sfp } of cabs) for (const o of sfp.objects) if (o.classID === 89) cands.push({ sf, sfp, o });
  const rank = (c) => (wantPid && String(c.o.pathID) === wantPid ? 0 : /reflectionprobe/i.test(String(c.o.pathID)) ? 1 : 2);
  cands.sort((a, b) => rank(a) - rank(b));
  const named = [];
  for (const c of cands) {
    const tx = readOne(c.sf, c.sfp.LE, c.o);
    if (!tx) continue;
    named.push({ c, tx, pref: wantPid && String(c.o.pathID) === wantPid ? 0 : /reflectionprobe/i.test(String(tx.m_Name || '')) ? 1 : 2 });
  }
  named.sort((a, b) => a.pref - b.pref || Number(b.tx.m_Width) - Number(a.tx.m_Width));
  for (const n of named) {
    const dec = decodeCubemap(n.tx, parsed);
    if (dec.error || !dec.faces) continue;
    return {
      name: n.tx.m_Name,
      pathID: String(n.c.o.pathID),
      matchedRenderSettings: !!wantPid && String(n.c.o.pathID) === wantPid,
      width: dec.width,
      height: dec.height,
      faces: dec.faces,
      levels: dec.levels,
      mipCount: dec.mipCount,
      lightmapFormat: Number(n.tx.m_LightmapFormat) | 0,
      colorSpace: Number(n.tx.m_ColorSpace) | 0,
      ambientIntensity,
      reflectionIntensity,
    };
  }
  return null;
}

export function extractSceneLight(bytes) {
  let parsed = null;
  try {
    parsed = unityDecode.parseUnityFS(bytes);
  } catch (e) {
    noteFailure('シーン環境', 'scene light', e);
    return null;
  }
  const qmul = (a, b) => ({
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  });
  for (const n of parsed.nodes) {
    if (n.path.endsWith('.resource') || n.path.endsWith('.resS')) continue;
    const sf = parsed.data.subarray(n.off, n.off + n.sz);
    const sfp = attempt(() => unitySf.parseSerializedFile(sf));
    if (!sfp) continue;
    const lights = sfp.objects.filter((o) => o.classID === 108);
    if (!lights.length) continue;
    const trByPid = new Map(),
      trByGo = new Map();
    for (const o of sfp.objects) {
      if (o.classID !== 4) continue;
      const t = readOne(sf, sfp.LE, o);
      if (!t) continue;
      trByPid.set(String(o.pathID), t);
      trByGo.set(String(t.m_GameObject && t.m_GameObject.m_PathID), String(o.pathID));
    }
    const worldQ = (trPid) => {
      const chain = [];
      let cur = trPid,
        guard = 0;
      while (cur && cur !== '0' && guard++ < 32) {
        const t = trByPid.get(cur);
        if (!t) break;
        chain.push(t);
        cur = String(t.m_Father && t.m_Father.m_PathID);
      }
      let q = { x: 0, y: 0, z: 0, w: 1 };
      for (let i = chain.length - 1; i >= 0; i--) {
        const lq = chain[i].m_LocalRotation || { x: 0, y: 0, z: 0, w: 1 };
        q = qmul(q, { x: lq.x || 0, y: lq.y || 0, z: lq.z || 0, w: lq.w == null ? 1 : lq.w });
      }
      return q;
    };
    for (const o of lights) {
      const L = readOne(sf, sfp.LE, o);
      if (!L || (L.m_Type | 0) !== 1 || L.m_Enabled === 0) continue;
      const q = worldQ(trByGo.get(String(L.m_GameObject && L.m_GameObject.m_PathID)));
      const tx = 2 * q.y,
        ty = -2 * q.x;
      const fx = q.w * tx + q.y * 0 - q.z * ty,
        fy = q.w * ty + q.z * tx,
        fz = 1 + (q.x * ty - q.y * tx);
      const c = L.m_Color || {};
      return {
        dir: [-fx, -fy, -fz],
        color: [c.r == null ? 1 : c.r, c.g == null ? 1 : c.g, c.b == null ? 1 : c.b],
        intensity: L.m_Intensity == null ? 1 : Number(L.m_Intensity),
      };
    }
  }
  return null;
}
