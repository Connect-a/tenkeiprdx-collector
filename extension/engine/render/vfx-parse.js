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

// streamed clip の各 lane の 実キーフレーム時間範囲での first/last/min/max を返す(アニメ軸/範囲判定用)。
function streamedLaneTrack(dataArr) {
  const out = new Map();
  if (!Array.isArray(dataArr) && !ArrayBuffer.isView(dataArr)) return out;
  const u = Uint32Array.from(Array.from(dataArr, (x) => Number(x) >>> 0));
  const f = new Float32Array(u.buffer);
  let p = 0, guard = 0;
  while (p < u.length && guard++ < 8192) {
    const time = f[p++];
    const numKeys = u[p++];
    if (numKeys < 0 || numKeys > 256 || p + numKeys * 5 > u.length) break;
    for (let k = 0; k < numKeys; k++) {
      const index = u[p];
      const val = f[p + 4];
      p += 5;
      if (!Number.isFinite(time) || time < -1e6 || time > 1e6) continue;
      let s = out.get(index);
      if (!s) { s = { first: val, last: val, min: val, max: val, tFirst: time, tLast: time }; out.set(index, s); }
      else { s.last = val; s.tLast = time; if (val < s.min) s.min = val; if (val > s.max) s.max = val; if (time < s.tFirst) { s.tFirst = time; s.first = val; } }
    }
  }
  return out;
}

// streamed clip の各 lane の実キーフレーム列 [[t,v],...](時間昇順)を返す。
function streamedLaneSeries(dataArr) {
  const out = new Map();
  if (!Array.isArray(dataArr) && !ArrayBuffer.isView(dataArr)) return out;
  const u = Uint32Array.from(Array.from(dataArr, (x) => Number(x) >>> 0));
  const f = new Float32Array(u.buffer);
  let p = 0, guard = 0;
  while (p < u.length && guard++ < 8192) {
    const time = f[p++];
    const numKeys = u[p++];
    if (numKeys < 0 || numKeys > 256 || p + numKeys * 5 > u.length) break;
    for (let k = 0; k < numKeys; k++) {
      const index = u[p]; const val = f[p + 4]; p += 5;
      if (!Number.isFinite(time) || time < -1e6 || time > 1e6) continue;
      let a = out.get(index); if (!a) { a = []; out.set(index, a); }
      a.push([time, val]);
    }
  }
  for (const a of out.values()) a.sort((x, y) => x[0] - y[0]);
  return out;
}

// Transform binding(typeID 4) の attribute→lane数。1=pos(3),2=quat(4),3=scale(3),4=euler(3)。他は1。
function bindingLaneCount(b) {
  if ((b.typeID | 0) === 4) {
    const a = b.attribute >>> 0;
    if (a === 2) return 4;
    if (a === 1 || a === 3 || a === 4) return 3;
  }
  return 1;
}

// Unity 組込メッシュ(`Library/unity default resources`)の PathID → 種別。詳細は _research/aura-vfx-glsl-method.md。
const UNITY_BUILTIN_MESH = { '10210': 'quad', '10209': 'plane', '10207': 'sphere', '10202': 'cube', '10206': 'cylinder', '10208': 'capsule' };
function builtinMeshGeo(kind) {
  if (kind === 'quad') {
    return {
      name: 'builtin_quad',
      positions: new Float32Array([-0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0]),
      normals: new Float32Array([0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1]),
      uv: new Float32Array([0, 0, 1, 1, 1, 0, 0, 1]),
      indices: new Uint16Array([0, 1, 2, 1, 0, 3]),
    };
  }
  return null;
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
  const goActive = new Map(); // goId → m_IsActive(prefab既定)。既定非アクティブ(loop2等スキル専用要素)を idle で描かないため。
  for (const o of meta.objects)
    if (o.classID === 1) {
      const g = read(o);
      if (g && g.m_Name != null) goName.set(String(o.pathID), g.m_Name);
      if (g) goActive.set(String(o.pathID), g.m_IsActive !== 0 && g.m_IsActive !== false);
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
  // system の Transform 親チェーンをたどり、途中の GameObject が1つでも m_IsActive=false なら inactive。
  // (loop2 は自身が m_IsActive=false ＝ 既定で非表示。Animator が特定 state で activate するスキル専用要素。)
  const effectiveActive = (trPid) => {
    let cur = trPid, guard = 0;
    while (cur && cur !== '0' && guard++ < 32) {
      const tr = trByPath.get(cur);
      if (!tr) break;
      const goId = String(tr.m_GameObject && tr.m_GameObject.m_PathID);
      if (goActive.has(goId) && goActive.get(goId) === false) return false;
      const father = String(tr.m_Father && tr.m_Father.m_PathID);
      if (!father || father === '0') break;
      cur = father;
    }
    return true;
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
      const dps = perState[Math.min(smd.m_DefaultState || 0, perState.length - 1)];
      const emission = dps.emission;
      // デフォルト(idle) state が明示 active 化する path。prefab で m_IsActive=false でも idle で有効化される要素を隠さないため。
      const defaultActive = [...dps.active].filter(([, a]) => a).map(([p]) => p);
      if (!inactive.length && !emission.size && !defaultActive.length) return null;
      return { inactive, emission: [...emission.entries()], defaultActive };
    } catch (e) {
      return null;
    }
  };
  const animGate = parseAnimatorGate();
  // Transform euler アニメ(周回スピン等)を clip から抽出。euler は 3レーン消費するので lane を会計する。
  const parseTransformAnims = () => {
    const anims = [];
    try {
      for (const o of meta.objects) {
        if (o.classID !== 74) continue;
        const clip = read(o);
        if (!clip) continue;
        const bindings = (clip.m_ClipBindingConstant && clip.m_ClipBindingConstant.genericBindings) || [];
        const cd = clip.m_MuscleClip && clip.m_MuscleClip.m_Clip && (clip.m_MuscleClip.m_Clip.data || clip.m_MuscleClip.m_Clip);
        const streamed = cd && cd.m_StreamedClip && cd.m_StreamedClip.data;
        if (!streamed) continue;
        const series = streamedLaneSeries(streamed);
        const dur = (clip.m_MuscleClip && clip.m_MuscleClip.m_StopTime) || 0;
        let lane = 0;
        const D = (cd.m_DenseClip && cd.m_DenseClip.m_CurveCount) || 0;
        const C = (cd.m_ConstantClip && cd.m_ConstantClip.data && cd.m_ConstantClip.data.length) || 0;
        const S = Math.max(0, bindings.length - D - C);
        for (let bi = 0; bi < bindings.length; bi++) {
          const b = bindings[bi];
          const n = bindingLaneCount(b);
          if (bi < S) {
            if ((b.typeID | 0) === 4 && (b.attribute >>> 0) === 4) { // Transform euler (Vector3)
              const path = hashToPath.get(Number(b.path)) || hashToPath.get(b.path >>> 0) || '';
              const eulerStatic = [0, 0, 0];
              let animAxis = -1, keys = null;
              for (let a = 0; a < 3; a++) {
                const sr = series.get(lane + a);
                if (!sr || !sr.length) continue;
                eulerStatic[a] = sr[0][1];
                let mn = Infinity, mx = -Infinity;
                for (const kv of sr) { if (kv[1] < mn) mn = kv[1]; if (kv[1] > mx) mx = kv[1]; }
                if (mx - mn > 1) { animAxis = a; keys = sr.map((kv) => [kv[0], kv[1]]); }
              }
              // 実キーフレーム列(keys)をそのまま再生する。線形0→360ではなく静止→急回転→静止の実カーブを保持。
              if (animAxis >= 0) anims.push({ path, axis: animAxis, from: keys[0][1], to: keys[keys.length - 1][1], dur, eulerStatic, keys });
            }
            lane += n;
          }
        }
      }
    } catch (e) {}
    return anims;
  };
  const transformAnims = parseTransformAnims();
  const pathToTr = new Map();
  for (const pid of trByPath.keys()) { const p = pathOf(pid); if (p) pathToTr.set(p, pid); }
  const qConj = (q) => ({ x: -(q.x || 0), y: -(q.y || 0), z: -(q.z || 0), w: q.w == null ? 1 : q.w });
  // アニメノード(周回する親)の静的 world 変換を求める。子systemはこのノードのローカル系に配置して親を回す。
  for (const a of transformAnims) {
    const pid = pathToTr.get(a.path);
    a.nodeWorldPos = pid ? worldPos(pid) : { x: 0, y: 0, z: 0 };
    a.nodeWorldRot = pid ? worldRot(pid) : { x: 0, y: 0, z: 0, w: 1 };
  }
  const findAnimParent = (sysPath) => {
    let best = null;
    for (const a of transformAnims) {
      if (!a.path) continue;
      if (sysPath === a.path || sysPath.startsWith(a.path + '/')) { if (!best || a.path.length > best.path.length) best = a; }
    }
    return best;
  };
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
    let meshPid = null;
    if (rend && (rend.m_RenderMode | 0) === 4 && rend.m_Mesh) {
      const fid = rend.m_Mesh.m_FileID | 0;
      const mp = String(rend.m_Mesh.m_PathID);
      if (fid === 0) {
        if (mp && mp !== '0') meshPid = mp;
      } else {
        const ext = (meta.externals || [])[fid - 1];
        if (ext && /unity default resources/i.test(ext.pathName || '') && UNITY_BUILTIN_MESH[mp]) meshPid = 'builtin:' + mp;
      }
    }
    const sysPath = trEnt ? pathOf(trEnt.pid) : '';
    const wPos = trEnt ? worldPos(trEnt.pid) : { x: 0, y: 0, z: 0 };
    const wRot = trEnt ? worldRot(trEnt.pid) : { x: 0, y: 0, z: 0, w: 1 };
    const ap = findAnimParent(sysPath);
    let animParent = null, localPos = null, localRot = null;
    if (ap) {
      const inv = qConj(ap.nodeWorldRot);
      const rel = { x: wPos.x - ap.nodeWorldPos.x, y: wPos.y - ap.nodeWorldPos.y, z: wPos.z - ap.nodeWorldPos.z };
      localPos = rotV(inv, rel);
      localRot = quatMul(inv, wRot);
      animParent = ap.path;
    }
    systems.push({
      ps,
      objPid: String(o.pathID),
      pos: wPos,
      rot: wRot,
      scale: trEnt ? worldScale(trEnt.pid) : { x: 1, y: 1, z: 1 },
      animParent,
      localPos,
      localRot,
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
      path: sysPath,
      goActive: trEnt ? effectiveActive(trEnt.pid) : true, // 既定非アクティブ(スキル専用等)は idle で描かない
      matPid,
      meshPid,
    });
  }
  let meshGeo = null;
  const meshByPid = {};
  for (const s of systems) {
    if (typeof s.meshPid === 'string' && s.meshPid.startsWith('builtin:') && !meshByPid[s.meshPid]) {
      const g = builtinMeshGeo(UNITY_BUILTIN_MESH[s.meshPid.slice('builtin:'.length)]);
      if (g) meshByPid[s.meshPid] = g;
    }
  }
  if (MESH_MOD && MESH_MOD.extractMeshGeometry) {
    for (const o of meta.objects)
      if (o.classID === 43) {
        const mo = read(o);
        if (!mo) continue;
        try {
          const g = MESH_MOD.extractMeshGeometry(mo, meta.LE);
          if (g) {
            meshByPid[String(o.pathID)] = g;
            if (!meshGeo) meshGeo = g;
          }
        } catch (e) {}
      }
  }
  return { systems, meshGeo, meshByPid, unityVersion: meta.unityVersion, animGate, transformAnims };
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
  const alphaOpaqueCache = new Map();
  const isAlphaOpaque = (t) => {
    const k = String(t.pathID);
    if (alphaOpaqueCache.has(k)) return alphaOpaqueCache.get(k);
    const px = t.rgba, n = px.length / 4, step = Math.max(1, Math.floor(n / 4096));
    let aMin = 255;
    for (let i = 0; i < n; i += step) { const a = px[i * 4 + 3]; if (a < aMin) aMin = a; if (aMin < 24) break; }
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
        const r = data[i], g = data[i + 1], b = data[i + 2];
        data[i + 3] = Math.max(r, g, b);
      }
    }
    const tx = new T.DataTexture(data, t.width, t.height, T.RGBAFormat);
    tx.needsUpdate = true;
    tx.minFilter = T.LinearFilter;
    tx.magFilter = T.LinearFilter;
    if ('colorSpace' in tx) tx.colorSpace = T.SRGBColorSpace || 'srgb';
    return tx;
  };
  const parsed = [];
  const texPool = new Map();
  const shaderNameByPid = {};
  const shaderInfoByPid = {}; // pid → {name,dst,dynamic}。ブレンドをバンドル跨ぎで解決するため全バンドル分を統合する。
  for (const bytes of depBundles) {
    if (!bytes) continue;
    try {
      const b = MESH_MOD.parseMaterialBundle(bytes);
      const mats = b.materials || [],
        texs = b.textures || [];
      parsed.push({ mats, texs });
      if (b.shaders) Object.assign(shaderNameByPid, b.shaders);
      if (b.shaderInfo) Object.assign(shaderInfoByPid, b.shaderInfo);
      for (const t of texs) if (t.rgba && !texPool.has(String(t.pathID))) texPool.set(String(t.pathID), t);
    } catch (e) {}
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
      // ブレンドはバンドル跨ぎ統合した shaderInfo で再解決する(シェーダが別バンドルにあると
      // parseMaterialBundle 単体では RenderState を見られず 'add' 既定に誤落下する＝leviathan等が
      // alpha→additive で白飛びしていた)。統合情報で解けたらそれを優先。
      const blend = MESH_MOD.resolveBlend(m, shaderInfoByPid) || m.blend || (m.dstBlend === 10 ? 'alpha' : 'add');
      const lumAlpha = blend !== 'add';
      let tx = null;
      if (m.mainTexPathID) tx = poolTex(m.mainTexPathID, lumAlpha);
      if (!tx && onlyPid) tx = poolTex(onlyPid, lumAlpha);
      const shaderName = m.shaderName || (m.shaderPathID ? shaderNameByPid[m.shaderPathID] || null : null);
      // proc に材質の全 prop(色/float/vec1)を載せ、実行時に実ゲームGLSLの uniform を各オーラ値で上書きできるようにする。
      // テクスチャ付き材質でも proc(shader名/色)を持たせる: シェーダが baked game shader(サンプラ有=テクスチャを
      // 実ゲーム通りに matcap/HSV 合成、サンプラ無=プロシージャルでテクスチャ無視)なら実GLSLで描くため。
      // vfx-aura 側で resolveGameKey が解ければ game shader(tex を sampler にバインド)、解けなければ tex 素通し。
      const proc = { shader: shaderName, vec1: m.vec1 || {}, colors: m.allColors || {}, floats: m.allFloats || {} };
      map.set(String(m.pathID), { tex: tx || null, blend, solid: !m.mainTexPathID, tint: m.color || null, proc, cutoff: m.cutoff != null ? m.cutoff : null });
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
