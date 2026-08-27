function parseAvatar(av) {
  const A = av.m_Avatar || {};
  const skel = A.m_AvatarSkeleton && A.m_AvatarSkeleton.data;
  if (!skel) return null;
  const ids = (skel.m_ID || []).map((x) => Number(x) >>> 0);
  const nodes = (skel.m_Node || []).map((n) => ({ parent: Number(n.m_ParentId) }));
  const tosArr = av.m_TOS || [];
  const tos = new Map(tosArr.map((p) => [Number(p[0]) >>> 0, p[1]]));
  const hashToIndex = new Map();
  ids.forEach((h, i) => hashToIndex.set(h, i));
  const dp = A.m_DefaultPose && A.m_DefaultPose.data && A.m_DefaultPose.data.m_X;
  const defPose = Array.isArray(dp) ? dp.map((x) => readTransform(x)) : null;
  return { count: ids.length, hashes: ids, parents: nodes.map((n) => n.parent), tos, hashToIndex, defPose, name: av.m_Name };
}
function readTransform(x) {
  return {
    t: [num(x.t && x.t.x), num(x.t && x.t.y), num(x.t && x.t.z)],
    q: [num(x.q && x.q.x), num(x.q && x.q.y), num(x.q && x.q.z), x.q && x.q.w != null ? Number(x.q.w) : 1],
    s: [x.s && x.s.x != null ? Number(x.s.x) : 1, x.s && x.s.y != null ? Number(x.s.y) : 1, x.s && x.s.z != null ? Number(x.s.z) : 1],
  };
}
const num = (v) => (v == null ? 0 : Number(v));

function curveSize(b) {
  if (Number(b.typeID) === 4) {
    switch (Number(b.attribute)) {
      case 1:
      case 3:
      case 4:
        return 3;
      case 2:
        return 4;
      default:
        return 1;
    }
  }
  return 1;
}

const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

function qSlerpFromIdentity(q, t) {
  let [x, y, z, w] = q;
  if (w < 0) {
    x = -x;
    y = -y;
    z = -z;
    w = -w;
  }
  const ang = Math.acos(Math.min(1, w));
  if (ang < 1e-6) return [0, 0, 0, 1];
  const s = Math.sin(ang);
  const a = Math.sin((1 - t) * ang) / s;
  const b = Math.sin(t * ang) / s;
  return [x * b, y * b, z * b, w * b + a];
}

function applyLoopBlend(tr, frames) {
  if (frames < 2) return;
  const v = tr.values;
  if (tr.type === 'rot') {
    const e = (frames - 1) * 4;
    const inv = [-v[0], -v[1], -v[2], v[3]];
    const delta = qMul([v[e], v[e + 1], v[e + 2], v[e + 3]], inv);
    if (Math.abs(delta[0]) + Math.abs(delta[1]) + Math.abs(delta[2]) < 1e-7) return;
    for (let i = 0; i < frames; i++) {
      const c = qSlerpFromIdentity(delta, i / (frames - 1));
      const q = qMul([-c[0], -c[1], -c[2], c[3]], [v[i * 4], v[i * 4 + 1], v[i * 4 + 2], v[i * 4 + 3]]);
      const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
      for (let k = 0; k < 4; k++) v[i * 4 + k] = q[k] / l;
    }
    return;
  }
  const d = [v[(frames - 1) * 3] - v[0], v[(frames - 1) * 3 + 1] - v[1], v[(frames - 1) * 3 + 2] - v[2]];
  if (Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2]) < 1e-7) return;
  for (let i = 0; i < frames; i++) {
    const f = i / (frames - 1);
    for (let k = 0; k < 3; k++) v[i * 3 + k] -= d[k] * f;
  }
}

function decodeClipObj(clipObj) {
  const name = clipObj.m_Name;
  const mc = clipObj.m_MuscleClip;
  if (!mc || !mc.m_Clip || !mc.m_Clip.data) return null;
  const cd = mc.m_Clip.data;
  const gb = (clipObj.m_ClipBindingConstant && clipObj.m_ClipBindingConstant.genericBindings) || [];
  let off = 0;
  const bindOff = gb.map((b) => {
    const s = off;
    const sz = curveSize(b);
    off += sz;
    return { start: s, size: sz, attr: Number(b.attribute), path: Number(b.path) >>> 0, typeID: Number(b.typeID) };
  });
  const totalCurves = off;

  const sc = cd.m_StreamedClip || {};
  const streamCount = Number(sc.curveCount || 0);
  const perCurveKeys = Array.from({ length: totalCurves }, () => []);
  const uintData = sc.data || [];
  if (uintData.length) {
    const buf = new ArrayBuffer(uintData.length * 4);
    const bdv = new DataView(buf);
    for (let i = 0; i < uintData.length; i++) bdv.setUint32(i * 4, Number(uintData[i]) >>> 0, true);
    let bp = 0;
    while (bp + 8 <= buf.byteLength) {
      const time = bdv.getFloat32(bp, true);
      bp += 4;
      const numKeys = bdv.getInt32(bp, true);
      bp += 4;
      if (numKeys < 0 || bp + numKeys * 20 > buf.byteLength) break;
      for (let k = 0; k < numKeys; k++) {
        const index = bdv.getInt32(bp, true);
        const c0 = bdv.getFloat32(bp + 4, true),
          c1 = bdv.getFloat32(bp + 8, true),
          c2 = bdv.getFloat32(bp + 12, true),
          c3 = bdv.getFloat32(bp + 16, true);
        bp += 20;
        if (index >= 0 && index < totalCurves) perCurveKeys[index].push({ time, coeff: [c0, c1, c2, c3] });
      }
    }
  }

  const dc = cd.m_DenseClip || {};
  const denseCount = Number(dc.m_CurveCount || 0);
  const denseFrames = Number(dc.m_FrameCount || 0);
  const denseRate = Number(dc.m_SampleRate || 30);
  const denseBegin = Number(dc.m_BeginTime || 0);
  const denseArr = dc.m_SampleArray || [];

  const constArr = (cd.m_ConstantClip && cd.m_ConstantClip.data) || [];

  const startTime = Number(mc.m_StartTime || 0);
  const stopTime = Number(mc.m_StopTime || 0);
  const sampleRate = Number(clipObj.m_SampleRate || 30) || 30;
  const loopBlend = !!(mc.m_LoopTime && mc.m_LoopBlend);

  const evalStreamed = (keys, t) => {
    if (!keys.length) return 0;
    let lo = 0;
    for (let i = 0; i < keys.length; i++) {
      if (keys[i].time <= t) lo = i;
      else break;
    }
    const k = keys[lo];
    const kn = keys[Math.min(lo + 1, keys.length - 1)];
    let dt = t - k.time;
    if (!isFinite(dt) || dt < 0) dt = 0;
    const seg = kn.time - k.time;
    if (isFinite(seg) && seg > 0 && dt > seg) dt = seg;
    const c = k.coeff;
    return ((c[0] * dt + c[1]) * dt + c[2]) * dt + c[3];
  };
  const sampleCurve = (gi, t) => {
    if (gi < streamCount) return evalStreamed(perCurveKeys[gi], t);
    if (gi < streamCount + denseCount) {
      const local = gi - streamCount;
      let f = (t - denseBegin) * denseRate;
      if (f < 0) f = 0;
      if (f > denseFrames - 1) f = denseFrames - 1;
      const f0 = Math.floor(f),
        f1 = Math.min(f0 + 1, denseFrames - 1),
        frac = f - f0;
      const v0 = Number(denseArr[f0 * denseCount + local]),
        v1 = Number(denseArr[f1 * denseCount + local]);
      return v0 + (v1 - v0) * frac;
    }
    const li = gi - streamCount - denseCount;
    return Number(constArr[li]);
  };

  const duration = Math.max(0, stopTime - startTime);

  const byPath = new Map();
  for (const b of bindOff) {
    if (b.typeID !== 4) continue;
    let e = byPath.get(b.path);
    if (!e) {
      e = { path: b.path };
      byPath.set(b.path, e);
    }
    if (b.attr === 1) e.pos = b.start;
    else if (b.attr === 2) e.rot = b.start;
    else if (b.attr === 3) e.scale = b.start;
    else if (b.attr === 4) e.euler = b.start;
  }
  const buildTracks = (fps) => {
    const rate = fps || sampleRate || 30;
    const frames = Math.max(2, Math.round(duration * rate) + 1);
    const times = new Float32Array(frames);
    for (let i = 0; i < frames; i++) times[i] = (i / (frames - 1)) * duration;
    const tracks = [];
    for (const e of byPath.values()) {
      if (e.pos != null) {
        const vals = new Float32Array(frames * 3);
        for (let i = 0; i < frames; i++) {
          const t = startTime + times[i];
          vals[i * 3] = sampleCurve(e.pos, t);
          vals[i * 3 + 1] = sampleCurve(e.pos + 1, t);
          vals[i * 3 + 2] = sampleCurve(e.pos + 2, t);
        }
        tracks.push({ boneHash: e.path, type: 'pos', times, values: vals });
      }
      if (e.rot != null) {
        const vals = new Float32Array(frames * 4);
        let px = 0,
          py = 0,
          pz = 0,
          pw = 0;
        for (let i = 0; i < frames; i++) {
          const t = startTime + times[i];
          let x = sampleCurve(e.rot, t),
            y = sampleCurve(e.rot + 1, t),
            z = sampleCurve(e.rot + 2, t),
            w = sampleCurve(e.rot + 3, t);
          const len = Math.hypot(x, y, z, w) || 1;
          x /= len;
          y /= len;
          z /= len;
          w /= len;
          if (i > 0 && x * px + y * py + z * pz + w * pw < 0) {
            x = -x;
            y = -y;
            z = -z;
            w = -w;
          }
          px = x;
          py = y;
          pz = z;
          pw = w;
          vals[i * 4] = x;
          vals[i * 4 + 1] = y;
          vals[i * 4 + 2] = z;
          vals[i * 4 + 3] = w;
        }
        tracks.push({ boneHash: e.path, type: 'rot', times, values: vals });
      }
      if (e.scale != null) {
        const vals = new Float32Array(frames * 3);
        for (let i = 0; i < frames; i++) {
          const t = startTime + times[i];
          vals[i * 3] = sampleCurve(e.scale, t);
          vals[i * 3 + 1] = sampleCurve(e.scale + 1, t);
          vals[i * 3 + 2] = sampleCurve(e.scale + 2, t);
        }
        tracks.push({ boneHash: e.path, type: 'scale', times, values: vals });
      }
      if (e.euler != null && e.rot == null) {
        const vals = new Float32Array(frames * 4);
        let px = 0,
          py = 0,
          pz = 0,
          pw = 0;
        for (let i = 0; i < frames; i++) {
          const t = startTime + times[i];
          const rx = (sampleCurve(e.euler, t) * Math.PI) / 180;
          const ry = (sampleCurve(e.euler + 1, t) * Math.PI) / 180;
          const rz = (sampleCurve(e.euler + 2, t) * Math.PI) / 180;
          const cx = Math.cos(rx / 2),
            sx = Math.sin(rx / 2);
          const cy = Math.cos(ry / 2),
            sy = Math.sin(ry / 2);
          const cz = Math.cos(rz / 2),
            sz = Math.sin(rz / 2);
          const qx = [sx, 0, 0, cx],
            qy = [0, sy, 0, cy],
            qz = [0, 0, sz, cz];
          let q = qMul(qy, qx);
          q = qMul(q, qz);
          let [x, y, z, w] = q;
          if (i > 0 && x * px + y * py + z * pz + w * pw < 0) {
            x = -x;
            y = -y;
            z = -z;
            w = -w;
          }
          px = x;
          py = y;
          pz = z;
          pw = w;
          vals[i * 4] = x;
          vals[i * 4 + 1] = y;
          vals[i * 4 + 2] = z;
          vals[i * 4 + 3] = w;
        }
        tracks.push({ boneHash: e.path, type: 'rot', times, values: vals });
      }
    }
    if (loopBlend) for (const tr of tracks) applyLoopBlend(tr, frames);
    return { name, duration, tracks };
  };

  const rawEv = clipObj.m_Events || [];
  const events = [];
  for (const e of rawEv) {
    const fn = e.functionName != null ? e.functionName : e.m_FunctionName;
    const data = e.data != null ? e.data : e.stringParameter != null ? e.stringParameter : e.m_Data;
    const time = Number(e.time != null ? e.time : e.m_Time) || 0;
    if (!fn) continue;
    if (fn === 'FBX_EVENT_ChangeBlendShapeState') {
      const p = String(data || '').split('-');
      if (p.length >= 4) events.push({ time, type: 'blend', target: p[1], weight: Number(p[2]) / 100, dur: Number(p[3]) || 0 });
    } else if (fn === 'FBX_EVENT_ChangeMouthOffset') {
      const p = String(data || '').split('-');
      if (p.length >= 2) {
        const idx = parseInt(p[p.length - 1], 10);
        if (isFinite(idx)) events.push({ time, type: 'mouth', index: idx });
      }
    } else if (fn === 'FBX_EVENT_ShowAttachmentEvent' || fn === 'FBX_EVENT_HideAttachmentEvent') {
      const p = String(data || '').split('-');
      const idx = parseInt(p[p.length - 1], 10);
      events.push({ time, type: 'attach', show: fn === 'FBX_EVENT_ShowAttachmentEvent', index: isFinite(idx) ? idx : 0 });
    } else if (fn === 'FBX_EVENT_ShowWeaponEvent' || fn === 'FBX_EVENT_HideWeaponEvent') {
      events.push({ time, type: 'weapon', show: fn === 'FBX_EVENT_ShowWeaponEvent' });
    }
  }
  events.sort((a, b) => a.time - b.time);

  const genericBinds = [...new Set(gb.map((b) => Number(b.typeID) + ':' + Number(b.customType || 0) + ':' + Number(b.attribute)))];
  return { name, duration, startTime, stopTime, sampleRate, buildTracks, events, genericBinds };
}

export const unityAnim = { parseAvatar, decodeClipObj };
