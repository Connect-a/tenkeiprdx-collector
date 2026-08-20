import { unityDecode } from '../../unity/decode.js';
import { unitySf } from '../../unity/unity-sf.js';
import { unityMesh as MESH_MOD } from '../../unity/mesh.js';
import { utilHelpers } from '../../core/util.js';

const ATTR_ISACTIVE = 2086281974;
const ATTR_EMISSION = 2883525743;

function crc32(str) {
  let crc = 0xffffffff;
  const b = new TextEncoder().encode(str);
  for (let i = 0; i < b.length; i++) {
    let c = (crc ^ b[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function streamedPeakValues(dataArr) {
  const out = new Map();
  if (!Array.isArray(dataArr) && !ArrayBuffer.isView(dataArr)) return out;
  const u = Uint32Array.from(Array.from(dataArr, (x) => Number(x) >>> 0));
  const f = new Float32Array(u.buffer);
  let p = 0,
    guard = 0;
  while (p < u.length && guard++ < 4096) {
    const time = f[p++];
    const numKeys = u[p++];
    if (numKeys < 0 || numKeys > 256 || p + numKeys * 5 > u.length) break;
    for (let k = 0; k < numKeys; k++) {
      const index = u[p];
      const val = f[p + 4];
      p += 5;
      if (Number.isFinite(time)) out.set(index, Math.max(out.has(index) ? out.get(index) : -Infinity, val));
    }
  }
  return out;
}

function parseVfx(bytes) {
  let parsed, meta;
  try {
    parsed = unityDecode.parseUnityFS(bytes);
    meta = unitySf.parseSerializedFile(parsed.data);
  } catch (e) {
    return null;
  }
  const read = (o) => {
    try {
      return unitySf.readObject(parsed.data, meta.LE, o);
    } catch (e) {
      return null;
    }
  };
  const trByPath = new Map(),
    trByGo = new Map();
  for (const o of meta.objects)
    if (o.classID === 4) {
      const tr = read(o);
      if (tr) {
        trByPath.set(String(o.pathID), tr);
        trByGo.set(String(tr.m_GameObject && tr.m_GameObject.m_PathID), { tr, pid: String(o.pathID) });
      }
    }
  const rotV = (q, v) => {
    const qx = q.x || 0,
      qy = q.y || 0,
      qz = q.z || 0,
      qw = q.w == null ? 1 : q.w;
    const ix = qw * v.x + qy * v.z - qz * v.y,
      iy = qw * v.y + qz * v.x - qx * v.z,
      iz = qw * v.z + qx * v.y - qy * v.x,
      iw = -qx * v.x - qy * v.y - qz * v.z;
    return {
      x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
      y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
      z: iz * qw + iw * -qz + ix * -qy - iy * -qx,
    };
  };
  const worldPos = (trPid) => {
    let p = { x: 0, y: 0, z: 0 },
      cur = trPid,
      guard = 0;
    while (cur && cur !== '0' && guard++ < 32) {
      const tr = trByPath.get(cur);
      if (!tr) break;
      const s = tr.m_LocalScale || { x: 1, y: 1, z: 1 };
      p = { x: p.x * (s.x == null ? 1 : s.x), y: p.y * (s.y == null ? 1 : s.y), z: p.z * (s.z == null ? 1 : s.z) };
      p = rotV(tr.m_LocalRotation || { x: 0, y: 0, z: 0, w: 1 }, p);
      const lp = tr.m_LocalPosition || { x: 0, y: 0, z: 0 };
      p.x += lp.x || 0;
      p.y += lp.y || 0;
      p.z += lp.z || 0;
      cur = String(tr.m_Father && tr.m_Father.m_PathID);
    }
    return p;
  };
  const worldScale = (trPid) => {
    let sx = 1,
      sy = 1,
      sz = 1,
      cur = trPid,
      guard = 0;
    while (cur && cur !== '0' && guard++ < 32) {
      const tr = trByPath.get(cur);
      if (!tr) break;
      const s = tr.m_LocalScale || { x: 1, y: 1, z: 1 };
      sx *= s.x == null ? 1 : s.x;
      sy *= s.y == null ? 1 : s.y;
      sz *= s.z == null ? 1 : s.z;
      cur = String(tr.m_Father && tr.m_Father.m_PathID);
    }
    return { x: sx, y: sy, z: sz };
  };
  const quatMul = (a, b) => ({
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  });
  const worldRot = (trPid) => {
    let q = { x: 0, y: 0, z: 0, w: 1 };
    let cur = trPid,
      guard = 0;
    while (cur && cur !== '0' && guard++ < 32) {
      const tr = trByPath.get(cur);
      if (!tr) break;
      const lq = tr.m_LocalRotation || { x: 0, y: 0, z: 0, w: 1 };
      q = quatMul(lq, q);
      cur = String(tr.m_Father && tr.m_Father.m_PathID);
    }
    return q;
  };
  const goName = new Map();
  for (const o of meta.objects)
    if (o.classID === 1) {
      const g = read(o);
      if (g && g.m_Name != null) goName.set(String(o.pathID), g.m_Name);
    }
  const pathOf = (trPid) => {
    const parts = [];
    let cur = trPid,
      guard = 0;
    while (cur && cur !== '0' && guard++ < 32) {
      const tr = trByPath.get(cur);
      if (!tr) break;
      const father = String(tr.m_Father && tr.m_Father.m_PathID);
      if (!father || father === '0') break;
      parts.unshift(goName.get(String(tr.m_GameObject && tr.m_GameObject.m_PathID)) || '');
      cur = father;
    }
    return parts.join('/');
  };
  const hashToPath = new Map();
  for (const pid of trByPath.keys()) {
    const p = pathOf(pid);
    if (p) hashToPath.set(crc32(p), p);
  }
  const decodeClip = (clipPathID) => {
    let clip = null;
    for (const o of meta.objects)
      if (o.classID === 74 && String(o.pathID) === clipPathID) {
        clip = read(o);
        break;
      }
    if (!clip) return null;
    const bindings = (clip.m_ClipBindingConstant && clip.m_ClipBindingConstant.genericBindings) || [];
    const cd = clip.m_MuscleClip && clip.m_MuscleClip.m_Clip && (clip.m_MuscleClip.m_Clip.data || clip.m_MuscleClip.m_Clip);
    const streamed = cd && cd.m_StreamedClip;
    const D = (cd && cd.m_DenseClip && cd.m_DenseClip.m_CurveCount) || 0;
    const constData = (cd && cd.m_ConstantClip && cd.m_ConstantClip.data) || [];
    const C = constData.length;
    const S = Math.max(0, bindings.length - D - C);
    const streamedFinals = streamed && streamed.data ? streamedPeakValues(streamed.data) : new Map();
    const valueAt = (i) => {
      if (i < S) return streamedFinals.has(i) ? streamedFinals.get(i) : null;
      if (i >= S + D) return Number(constData[i - S - D]);
      return null;
    };
    const active = new Map();
    const emission = new Map();
    bindings.forEach((b, i) => {
      const path = hashToPath.get(Number(b.path)) || hashToPath.get(b.path >>> 0);
      if (!path) return;
      const v = valueAt(i);
      if (v == null) return;
      if (b.attribute === ATTR_ISACTIVE) active.set(path, v >= 0.5);
      else if (b.attribute === ATTR_EMISSION) emission.set(path, v);
    });
    return { active, emission };
  };
  const parseAnimatorGate = () => {
    try {
      let ctrlObj = null;
      for (const o of meta.objects)
        if (o.classID === 91) {
          ctrlObj = read(o);
          break;
        }
      const ctrl = ctrlObj && ctrlObj.m_Controller;
      const smWrap = ctrl && ctrl.m_StateMachineArray && ctrl.m_StateMachineArray[0];
      const smd = smWrap && (smWrap.data || smWrap);
      const states = (smd && smd.m_StateConstantArray) || [];
      const clipRefs = ctrlObj.m_AnimationClips || [];
      if (!states.length) return null;
      const perState = [];
      for (const sw of states) {
        const st = sw.data || sw;
        const btWrap = (st.m_BlendTreeConstantArray || [])[0];
        const bt = btWrap && (btWrap.data || btWrap);
        const nodeWrap = bt && (bt.m_NodeArray || [])[0];
        const clipID = nodeWrap ? (nodeWrap.data ? nodeWrap.data.m_ClipID : nodeWrap.m_ClipID) : 0;
        const clipRef = clipRefs[clipID];
        const dec = clipRef ? decodeClip(String(clipRef.m_PathID)) : null;
        if (dec) perState.push(dec);
      }
      if (!perState.length) return null;
      const inactiveCount = new Map();
      const activeAnywhere = new Set();
      const boundStates = new Map();
      for (const ps of perState)
        for (const [path, act] of ps.active) {
          boundStates.set(path, (boundStates.get(path) || 0) + 1);
          if (act) activeAnywhere.add(path);
          else inactiveCount.set(path, (inactiveCount.get(path) || 0) + 1);
        }
      const N = perState.length;
      const inactive = [];
      for (const [path, cnt] of inactiveCount) {
        if (activeAnywhere.has(path)) continue;
        if ((boundStates.get(path) || 0) < N) continue;
        inactive.push(path);
      }
      const emission = perState[Math.min(smd.m_DefaultState || 0, perState.length - 1)].emission;
      if (!inactive.length && !emission.size) return null;
      return { inactive, emission: [...emission.entries()] };
    } catch (e) {
      return null;
    }
  };
  const animGate = parseAnimatorGate();
  const systems = [];
  for (const o of meta.objects) {
    if (o.classID !== 198) continue;
    const ps = read(o);
    if (!ps) continue;
    const goId = String(ps.m_GameObject && ps.m_GameObject.m_PathID);
    const trEnt = trByGo.get(goId);
    let rend = null;
    for (const r of meta.objects) {
      if (r.classID !== 199) continue;
      const rr = read(r);
      if (rr && String(rr.m_GameObject && rr.m_GameObject.m_PathID) === goId) {
        rend = rr;
        break;
      }
    }
    const matPid = rend && rend.m_Materials ? String((Array.isArray(rend.m_Materials) ? rend.m_Materials[0] : rend.m_Materials).m_PathID) : null;
    systems.push({
      ps,
      objPid: String(o.pathID),
      pos: trEnt ? worldPos(trEnt.pid) : { x: 0, y: 0, z: 0 },
      rot: trEnt ? worldRot(trEnt.pid) : { x: 0, y: 0, z: 0, w: 1 },
      scale: trEnt ? worldScale(trEnt.pid) : { x: 1, y: 1, z: 1 },
      moveWithTransform: ps.moveWithTransform == null ? null : Number(ps.moveWithTransform),
      moveWithCustomTransformPathID:
        ps.moveWithCustomTransform && ps.moveWithCustomTransform.m_PathID != null ? String(ps.moveWithCustomTransform.m_PathID) : '0',
      renderMode: rend ? rend.m_RenderMode : 0,
      renderAlignment: rend ? rend.m_RenderAlignment : 0,
      pivot: rend && rend.m_Pivot ? { x: rend.m_Pivot.x || 0, y: rend.m_Pivot.y || 0 } : null,
      lengthScale: rend && rend.m_LengthScale != null ? rend.m_LengthScale : 2,
      velocityScale: rend && rend.m_VelocityScale != null ? rend.m_VelocityScale : 0,
      sortingOrder: rend ? rend.m_SortingOrder : 0,
      name: goName.get(goId) || '',
      path: trEnt ? pathOf(trEnt.pid) : '',
      matPid,
    });
  }
  let meshGeo = null;
  for (const o of meta.objects)
    if (o.classID === 43) {
      const mo = read(o);
      if (mo && MESH_MOD && MESH_MOD.extractMeshGeometry) {
        try {
          meshGeo = MESH_MOD.extractMeshGeometry(mo, meta.LE);
        } catch (e) {}
      }
      break;
    }
  return { systems, meshGeo, unityVersion: meta.unityVersion, animGate };
}

function resolveDeps(catalog, prefabRe) {
  try {
    const b64 = utilHelpers.b64ToBytes;
    const bd = b64(catalog.m_BucketDataString),
      ed = b64(catalog.m_EntryDataString);
    const dvB = new DataView(bd.buffer),
      dvE = new DataView(ed.buffer);
    const rI = (dv, o) => dv.getInt32(o, true);
    const bc = rI(dvB, 0);
    let bo = 4;
    const buckets = [];
    for (let i = 0; i < bc; i++) {
      bo += 4;
      const cnt = rI(dvB, bo);
      bo += 4;
      const es = [];
      for (let k = 0; k < cnt; k++) {
        es.push(rI(dvB, bo));
        bo += 4;
      }
      buckets.push(es);
    }
    const ec2 = rI(dvE, 0);
    const entries = [];
    for (let i = 0; i < ec2; i++) {
      const o = 4 + i * 28;
      entries.push({ iid: rI(dvE, o), depKey: rI(dvE, o + 8) });
    }
    const ids = catalog.m_InternalIds || [];
    const auraIid = ids.findIndex((s) => prefabRe.test(String(s)));
    if (auraIid < 0) return [];
    const deps = new Set();
    for (const e of entries) {
      if (e.iid !== auraIid) continue;
      if (e.depKey >= 0 && e.depKey < buckets.length)
        for (const ei of buckets[e.depKey]) {
          const de = entries[ei];
          if (de) deps.add(String(ids[de.iid]));
        }
    }
    return [...deps]
      .map((s) => {
        const m = s.match(/([a-z0-9]+_assets_[a-z0-9]+\/[^/]+\.bundle)$/i);
        return m ? m[1] : null;
      })
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

function buildMaterialMap(T, depBundles) {
  const map = new Map();
  if (!MESH_MOD || !MESH_MOD.parseMaterialBundle) return map;
  const mkTex = (t) => {
    if (!t || !t.rgba) return null;
    const tx = new T.DataTexture(t.rgba, t.width, t.height, T.RGBAFormat);
    tx.needsUpdate = true;
    tx.minFilter = T.LinearFilter;
    tx.magFilter = T.LinearFilter;
    if ('colorSpace' in tx) tx.colorSpace = T.SRGBColorSpace || 'srgb';
    return tx;
  };
  const parsed = [];
  const texPool = new Map();
  const shaderNameByPid = {};
  for (const bytes of depBundles) {
    if (!bytes) continue;
    try {
      const b = MESH_MOD.parseMaterialBundle(bytes);
      const mats = b.materials || [],
        texs = b.textures || [];
      parsed.push({ mats, texs });
      if (b.shaders) Object.assign(shaderNameByPid, b.shaders);
      for (const t of texs) if (t.rgba && !texPool.has(String(t.pathID))) texPool.set(String(t.pathID), t);
    } catch (e) {}
  }
  const texCache = new Map();
  const poolTex = (pid) => {
    const k = String(pid);
    if (texCache.has(k)) return texCache.get(k);
    const tx = texPool.has(k) ? mkTex(texPool.get(k)) : null;
    texCache.set(k, tx);
    return tx;
  };
  for (const { mats, texs } of parsed) {
    let onlyPid = null;
    if (texs.length === 1 && texs[0].rgba) onlyPid = String(texs[0].pathID);
    for (const m of mats) {
      if (map.has(String(m.pathID))) continue;
      let tx = null;
      if (m.mainTexPathID) tx = poolTex(m.mainTexPathID);
      if (!tx && onlyPid) tx = poolTex(onlyPid);
      const blend = m.blend || (m.dstBlend === 10 ? 'alpha' : 'add');
      const shaderName = m.shaderName || (m.shaderPathID ? shaderNameByPid[m.shaderPathID] || null : null);
      const proc = tx ? null : { shader: shaderName, vec1: m.vec1 || {} };
      map.set(String(m.pathID), { tex: tx || null, blend, solid: !m.mainTexPathID, tint: m.color || null, proc });
    }
  }
  return map;
}

function getSubEmitterLinks(systems) {
  const links = [];
  for (const s of systems || []) {
    const sub = s.ps && s.ps.SubModule;
    if (!sub || !sub.enabled || !Array.isArray(sub.subEmitters)) continue;
    for (const se of sub.subEmitters) {
      const type = se.type | 0;
      if (type !== 0 && type !== 2) continue;
      if (se.emitter && se.emitter.m_FileID) continue;
      const childObjPid = se.emitter ? String(se.emitter.m_PathID) : '0';
      if (childObjPid === '0') continue;
      links.push({ parent: s, childObjPid, type, prob: se.emitProbability == null ? 1 : se.emitProbability });
    }
  }
  return links;
}

export const vfxParse = { parseVfx, buildMaterialMap, resolveDeps, getSubEmitterLinks };
