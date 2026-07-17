'use strict';
(function () {
  // Avatar(classID 90) skeleton + Mecanim generic AnimationClip(classID 74) decoder.
  // Pure (no THREE dependency): returns plain skeleton info + resampled track data.

  function parseAvatar(av) {
    const A = av.m_Avatar || {};
    const skel = A.m_AvatarSkeleton && A.m_AvatarSkeleton.data;
    if (!skel) return null;
    const ids = (skel.m_ID || []).map((x) => Number(x) >>> 0);
    const nodes = (skel.m_Node || []).map((n) => ({ parent: Number(n.m_ParentId) }));
    const tosArr = av.m_TOS || [];
    const tos = new Map(tosArr.map((p) => [Number(p[0]) >>> 0, p[1]]));
    const hashToIndex = new Map(); ids.forEach((h, i) => hashToIndex.set(h, i));
    // default pose local TRS per node (usually identity for these avatars)
    const dp = A.m_DefaultPose && A.m_DefaultPose.data && A.m_DefaultPose.data.m_X;
    const defPose = Array.isArray(dp) ? dp.map((x) => xf(x)) : null;
    return { count: ids.length, hashes: ids, parents: nodes.map((n) => n.parent), tos, hashToIndex, defPose, name: av.m_Name };
  }
  function xf(x) {
    return {
      t: [num(x.t && x.t.x), num(x.t && x.t.y), num(x.t && x.t.z)],
      q: [num(x.q && x.q.x), num(x.q && x.q.y), num(x.q && x.q.z), x.q && x.q.w != null ? Number(x.q.w) : 1],
      s: [x.s && x.s.x != null ? Number(x.s.x) : 1, x.s && x.s.y != null ? Number(x.s.y) : 1, x.s && x.s.z != null ? Number(x.s.z) : 1],
    };
  }
  const num = (v) => (v == null ? 0 : Number(v));

  // curve count consumed by one generic binding (Transform attributes)
  function curveSize(b) {
    if (Number(b.typeID) === 4) {
      switch (Number(b.attribute)) {
        case 1: case 3: case 4: return 3; // position, scale, euler
        case 2: return 4;                 // rotation (quaternion)
        default: return 1;
      }
    }
    return 1;
  }

  function decodeClipObj(clipObj) {
    const name = clipObj.m_Name;
    const mc = clipObj.m_MuscleClip;
    if (!mc || !mc.m_Clip || !mc.m_Clip.data) return null;
    const cd = mc.m_Clip.data;
    const gb = (clipObj.m_ClipBindingConstant && clipObj.m_ClipBindingConstant.genericBindings) || [];
    let off = 0;
    const bindOff = gb.map((b) => { const s = off; const sz = curveSize(b); off += sz; return { start: s, size: sz, attr: Number(b.attribute), path: Number(b.path) >>> 0, typeID: Number(b.typeID) }; });
    const totalCurves = off;

    // --- StreamedClip: uint[] -> frames of {time, keys[{index, coeff[4]}]} ---
    const sc = cd.m_StreamedClip || {};
    const streamCount = Number(sc.curveCount || 0);
    const perCurveKeys = Array.from({ length: totalCurves }, () => []);
    const uintData = (sc.data || []);
    if (uintData.length) {
      const buf = new ArrayBuffer(uintData.length * 4);
      const bdv = new DataView(buf);
      for (let i = 0; i < uintData.length; i++) bdv.setUint32(i * 4, Number(uintData[i]) >>> 0, true);
      let bp = 0;
      while (bp + 8 <= buf.byteLength) {
        const time = bdv.getFloat32(bp, true); bp += 4;
        const numKeys = bdv.getInt32(bp, true); bp += 4;
        if (numKeys < 0 || bp + numKeys * 20 > buf.byteLength) break;
        for (let k = 0; k < numKeys; k++) {
          const index = bdv.getInt32(bp, true);
          const c0 = bdv.getFloat32(bp + 4, true), c1 = bdv.getFloat32(bp + 8, true), c2 = bdv.getFloat32(bp + 12, true), c3 = bdv.getFloat32(bp + 16, true);
          bp += 20;
          if (index >= 0 && index < totalCurves) perCurveKeys[index].push({ time, coeff: [c0, c1, c2, c3] });
        }
      }
    }

    // --- DenseClip ---
    const dc = cd.m_DenseClip || {};
    const denseCount = Number(dc.m_CurveCount || 0);
    const denseFrames = Number(dc.m_FrameCount || 0);
    const denseRate = Number(dc.m_SampleRate || 30);
    const denseBegin = Number(dc.m_BeginTime || 0);
    const denseArr = dc.m_SampleArray || [];

    // --- ConstantClip ---
    const constArr = (cd.m_ConstantClip && cd.m_ConstantClip.data) || [];

    const startTime = Number(mc.m_StartTime || 0);
    const stopTime = Number(mc.m_StopTime || 0);
    const sampleRate = Number(clipObj.m_SampleRate || 30) || 30;

    const evalStreamed = (keys, t) => {
      if (!keys.length) return 0;
      let lo = 0;
      for (let i = 0; i < keys.length; i++) { if (keys[i].time <= t) lo = i; else break; }
      const k = keys[lo];
      const kn = keys[Math.min(lo + 1, keys.length - 1)];
      let dt = t - k.time; if (!isFinite(dt) || dt < 0) dt = 0;
      const seg = kn.time - k.time;
      if (isFinite(seg) && seg > 0 && dt > seg) dt = seg;
      const c = k.coeff;
      return ((c[0] * dt + c[1]) * dt + c[2]) * dt + c[3];
    };
    const sampleCurve = (gi, t) => {
      if (gi < streamCount) return evalStreamed(perCurveKeys[gi], t);
      if (gi < streamCount + denseCount) {
        const local = gi - streamCount;
        let f = (t - denseBegin) * denseRate; if (f < 0) f = 0; if (f > denseFrames - 1) f = denseFrames - 1;
        const f0 = Math.floor(f), f1 = Math.min(f0 + 1, denseFrames - 1), frac = f - f0;
        const v0 = Number(denseArr[f0 * denseCount + local]), v1 = Number(denseArr[f1 * denseCount + local]);
        return v0 + (v1 - v0) * frac;
      }
      const li = gi - streamCount - denseCount;
      return Number(constArr[li]);
    };

    const duration = Math.max(0, stopTime - startTime);

    // Build resampled per-bone tracks. type: 0=pos,1=rot(quat),2=scale
    const buildTracks = (fps) => {
      const rate = fps || sampleRate || 30;
      const frames = Math.max(2, Math.round(duration * rate) + 1);
      const times = new Float32Array(frames);
      for (let i = 0; i < frames; i++) times[i] = (i / (frames - 1)) * duration;
      // group bindings by path
      const byPath = new Map();
      for (const b of bindOff) {
        if (b.typeID !== 4) continue;
        let e = byPath.get(b.path); if (!e) { e = { path: b.path }; byPath.set(b.path, e); }
        if (b.attr === 1) e.pos = b.start; else if (b.attr === 2) e.rot = b.start; else if (b.attr === 3) e.scale = b.start;
      }
      const tracks = [];
      for (const e of byPath.values()) {
        if (e.pos != null) {
          const vals = new Float32Array(frames * 3);
          for (let i = 0; i < frames; i++) { const t = startTime + times[i]; vals[i * 3] = sampleCurve(e.pos, t); vals[i * 3 + 1] = sampleCurve(e.pos + 1, t); vals[i * 3 + 2] = sampleCurve(e.pos + 2, t); }
          tracks.push({ boneHash: e.path, type: 'pos', times, values: vals });
        }
        if (e.rot != null) {
          const vals = new Float32Array(frames * 4);
          let px = 0, py = 0, pz = 0, pw = 0;
          for (let i = 0; i < frames; i++) {
            const t = startTime + times[i];
            let x = sampleCurve(e.rot, t), y = sampleCurve(e.rot + 1, t), z = sampleCurve(e.rot + 2, t), w = sampleCurve(e.rot + 3, t);
            const len = Math.hypot(x, y, z, w) || 1; x /= len; y /= len; z /= len; w /= len;
            // keep consecutive quaternions in the same hemisphere so slerp doesn't take the long way (fixes 180° flips / judder)
            if (i > 0 && (x * px + y * py + z * pz + w * pw) < 0) { x = -x; y = -y; z = -z; w = -w; }
            px = x; py = y; pz = z; pw = w;
            vals[i * 4] = x; vals[i * 4 + 1] = y; vals[i * 4 + 2] = z; vals[i * 4 + 3] = w;
          }
          tracks.push({ boneHash: e.path, type: 'rot', times, values: vals });
        }
        if (e.scale != null) {
          const vals = new Float32Array(frames * 3);
          for (let i = 0; i < frames; i++) { const t = startTime + times[i]; vals[i * 3] = sampleCurve(e.scale, t); vals[i * 3 + 1] = sampleCurve(e.scale + 1, t); vals[i * 3 + 2] = sampleCurve(e.scale + 2, t); }
          tracks.push({ boneHash: e.path, type: 'scale', times, values: vals });
        }
      }
      return { name, duration, tracks };
    };

    return { name, duration, startTime, stopTime, sampleRate, buildTracks };
  }

  globalThis.TP_ANIM = { parseAvatar, decodeClipObj };
})();
