const ATTR_ISACTIVE = 2086281974;
const ATTR_EMISSION = 2883525743;
const ATTR_M_ENABLED = 3305885265;
const ATTR_AMPGAIN = 247293932;
const ATTR_FREQGAIN = 664433463;
const ATTR_LENS_FOV = 3703709682;
const ATTR_LENS_DUTCH = 1049100914;

function streamedLaneSeries(dataArr) {
  const out = new Map();
  if (!Array.isArray(dataArr) && !ArrayBuffer.isView(dataArr)) return out;
  const u = Uint32Array.from(Array.from(dataArr, (x) => Number(x) >>> 0));
  const f = new Float32Array(u.buffer);
  let p = 0,
    guard = 0;
  while (p < u.length && guard++ < 8192) {
    const time = f[p++];
    const numKeys = u[p++];
    if (numKeys < 0 || numKeys > 256 || p + numKeys * 5 > u.length) break;
    for (let k = 0; k < numKeys; k++) {
      const index = u[p];
      const val = f[p + 4];
      const c0 = f[p + 1],
        c1 = f[p + 2],
        c2 = f[p + 3];
      p += 5;
      if (!Number.isFinite(time) || time < -1e6 || time > 1e6) continue;
      let a = out.get(index);
      if (!a) {
        a = [];
        out.set(index, a);
      }
      a.push([time, val, c0, c1, c2]);
    }
  }
  for (const a of out.values()) a.sort((x, y) => x[0] - y[0]);
  return out;
}

function bindingLaneCount(b) {
  if ((b.typeID | 0) === 4) {
    const a = b.attribute >>> 0;
    if (a === 2) return 4;
    if (a === 1 || a === 3 || a === 4) return 3;
  }
  return 1;
}

function clipLayout(clip) {
  const cd = clip && clip.m_MuscleClip && clip.m_MuscleClip.m_Clip && (clip.m_MuscleClip.m_Clip.data || clip.m_MuscleClip.m_Clip);
  if (!cd) return null;
  const bindings = (clip.m_ClipBindingConstant && clip.m_ClipBindingConstant.genericBindings) || [];
  const streamed = cd.m_StreamedClip || {};
  const S = Number(streamed.curveCount) || 0;
  const dense = cd.m_DenseClip || {};
  const D = Number(dense.m_CurveCount) || 0;
  const denseFrames = Number(dense.m_FrameCount) || 0;
  const denseRate = Number(dense.m_SampleRate) || 30;
  const denseBegin = Number(dense.m_BeginTime) || 0;
  const denseArr = dense.m_SampleArray || [];
  const constData = (cd.m_ConstantClip && cd.m_ConstantClip.data) || [];
  let series = null;
  const denseKeys = (li) => {
    if (denseFrames < 2) return null;
    const out = [];
    for (let i = 0; i < denseFrames; i++) {
      const v = Number(denseArr[i * D + li]);
      const nv = Number(denseArr[Math.min(i + 1, denseFrames - 1) * D + li]);
      out.push([denseBegin + i / denseRate, v, 0, 0, (nv - v) * denseRate]);
    }
    return out;
  };
  const keysAt = (lane) => {
    if (lane < S) {
      if (!series) series = streamedLaneSeries(streamed.data || []);
      return series.get(lane) || null;
    }
    return lane < S + D ? denseKeys(lane - S) : null;
  };
  const constAt = (lane) => {
    const ci = lane - S - D;
    return ci >= 0 && ci < constData.length ? Number(constData[ci]) : null;
  };
  const items = [];
  let lane = 0;
  for (const b of bindings) {
    const n = bindingLaneCount(b);
    items.push({ b, lane, n, keyed: lane < S + D });
    lane += n;
  }
  return { items, keysAt, constAt, dur: (clip.m_MuscleClip && clip.m_MuscleClip.m_StopTime) || 0 };
}

function defaultStateClipRef(smd, refs) {
  const states = (smd && smd.m_StateConstantArray) || [];
  if (!states.length || !refs.length) return null;
  const sw = states[Math.min(smd.m_DefaultState || 0, states.length - 1)];
  const stc = sw.data || sw;
  const btWrap = (stc.m_BlendTreeConstantArray || [])[0];
  const bt = btWrap && (btWrap.data || btWrap);
  const nodeWrap = bt && (bt.m_NodeArray || [])[0];
  if (!nodeWrap) return null;
  return refs[nodeWrap.data ? nodeWrap.data.m_ClipID : nodeWrap.m_ClipID] || null;
}

export function readAnimatorGate(ctx, h) {
  const { meta, read, noteFail } = ctx;
  const { hashToPath } = h;
  const decodeClip = (clipPathID) => {
    let clip = null;
    for (const o of meta.objects)
      if (o.classID === 74 && String(o.pathID) === clipPathID) {
        clip = read(o);
        break;
      }
    const lay = clipLayout(clip);
    if (!lay) return null;
    const stop = lay.dur;
    const active = new Map();
    const emission = new Map();
    const activeKeys = new Map();
    const volumeKeys = new Map();
    for (const { b, lane } of lay.items) {
      const sr = lay.keysAt(lane);
      const keys = sr && sr.length ? sr : null;
      const v = keys ? keys[keys.length - 1][1] : lay.constAt(lane);
      const path = hashToPath.get(Number(b.path)) || hashToPath.get(b.path >>> 0);
      if (!path || v == null) continue;
      if (b.attribute === ATTR_ISACTIVE) {
        let peak = v;
        if (keys) for (const kv of keys) peak = Math.max(peak, kv[1]);
        active.set(path, peak >= 0.5);
        if (keys && keys.length > 1) activeKeys.set(path, keys);
      } else if (b.attribute === ATTR_EMISSION) {
        let peak = v;
        if (keys) for (const kv of keys) peak = Math.max(peak, kv[1]);
        emission.set(path, peak);
      } else if ((b.typeID | 0) === 114 && (b.customType | 0) === 24 && (Number(b.attribute) >>> 0) === ATTR_M_ENABLED) {
        if (keys && keys.length) volumeKeys.set(path, keys);
      }
    }
    return { active, emission, activeKeys, volumeKeys, stop };
  };
  const parseAnimatorGate = () => {
    const ctrls = [];
    for (const o of meta.objects) if (o.classID === 91) ctrls.push(o);
    for (const o of ctrls) {
      const g = buildAnimatorGate(read(o));
      if (g) return g;
    }
    return null;
  };
  const buildAnimatorGate = (ctrlObj) => {
    try {
      const ctrl = ctrlObj && ctrlObj.m_Controller;
      const smWrap = ctrl && ctrl.m_StateMachineArray && ctrl.m_StateMachineArray[0];
      const smd = smWrap && (smWrap.data || smWrap);
      const clipRef = defaultStateClipRef(smd, ctrlObj.m_AnimationClips || []);
      const defaultClipPid = clipRef ? String(clipRef.m_PathID) : null;
      const dps = defaultClipPid ? decodeClip(defaultClipPid) : null;
      if (!dps) return null;
      const inactive = [...dps.active].filter(([, a]) => !a).map(([p]) => p);
      const emission = dps.emission;
      const defaultActive = [...dps.active].filter(([, a]) => a).map(([p]) => p);
      const timeline = [...dps.activeKeys.entries()].map(([path, keys]) => ({ path, keys }));
      const volumeTimeline = [...(dps.volumeKeys || new Map()).entries()].map(([path, keys]) => ({ path, keys }));
      if (!inactive.length && !emission.size && !defaultActive.length && !timeline.length && !volumeTimeline.length) return null;
      return { inactive, emission: [...emission.entries()], defaultActive, timeline, volumeTimeline, duration: dps.stop || 0 };
    } catch (e) {
      noteFail('animatorGate', e);
      return null;
    }
  };
  return parseAnimatorGate();
}

export function readClipRoles(ctx) {
  const { meta, read, noteFail } = ctx;
  const clipRoles = (() => {
    const referenced = new Set(),
      defaults = new Set();
    for (const o of meta.objects) {
      if (o.classID !== 91) continue;
      const c = read(o);
      try {
        const refs = c.m_AnimationClips || [];
        for (const r of refs) referenced.add(String(r.m_PathID));
        for (const smWrap of (c.m_Controller && c.m_Controller.m_StateMachineArray) || []) {
          const ref = defaultStateClipRef(smWrap.data || smWrap, refs);
          if (ref) defaults.add(String(ref.m_PathID));
        }
      } catch (e) {
        noteFail('clipRoles', e);
      }
    }
    return { referenced, defaults };
  })();
  const clipIsOff = (pid) => clipRoles.referenced.has(pid) && !clipRoles.defaults.has(pid);
  return clipIsOff;
}

export function readTransformAnims(ctx, h, clipIsOff) {
  const { meta, read } = ctx;
  const { hashToPath } = h;
  const parseTransformAnims = () => {
    const byPath = new Map();
    for (const o of meta.objects) {
      if (o.classID !== 74) continue;
      if (clipIsOff(String(o.pathID))) continue;
      const lay = clipLayout(read(o));
      if (!lay) continue;
      const dur = lay.dur;
      for (const { b, lane, keyed } of lay.items) {
        if (!keyed) continue;
        const attr = b.attribute >>> 0;
        if ((b.typeID | 0) === 4 && (attr === 1 || attr === 3 || attr === 4)) {
          const rawHash = b.path >>> 0;
          const path = rawHash === 0 ? '' : hashToPath.get(Number(b.path)) || hashToPath.get(rawHash) || null;
          if (path === null) continue;
          const axes = [];
          let varying = false;
          for (let a = 0; a < 3; a++) {
            const sr = lay.keysAt(lane + a);
            axes.push(sr);
            if (!sr || sr.length < 2) continue;
            let mn = Infinity,
              mx = -Infinity;
            for (const kv of sr) {
              if (kv[1] < mn) mn = kv[1];
              if (kv[1] > mx) mx = kv[1];
            }
            if (mx - mn > 1e-4) varying = true;
          }
          let ent = byPath.get(path);
          if (!ent) {
            ent = { path, dur };
            byPath.set(path, ent);
          }
          if (dur > ent.dur) ent.dur = dur;
          if (attr === 1 && varying) ent.posKeys = axes;
          if (attr === 3 && varying) ent.scaleKeys = axes;
          if (attr === 4) {
            const eulerStatic = [0, 0, 0];
            let animAxis = -1,
              keys = null;
            for (let a = 0; a < 3; a++) {
              const sr = axes[a];
              if (!sr || !sr.length) continue;
              eulerStatic[a] = sr[0][1];
              let mn = Infinity,
                mx = -Infinity;
              for (const kv of sr) {
                if (kv[1] < mn) mn = kv[1];
                if (kv[1] > mx) mx = kv[1];
              }
              if (mx - mn > 1) {
                animAxis = a;
                keys = sr.map((kv) => kv.slice());
              }
            }
            if (animAxis >= 0) {
              ent.axis = animAxis;
              ent.from = keys[0][1];
              ent.to = keys[keys.length - 1][1];
              ent.eulerStatic = eulerStatic;
              ent.keys = keys;
            }
            if (varying) ent.eulerKeys = axes;
          }
        }
      }
    }
    return [...byPath.values()].filter((e) => e.keys || e.posKeys || e.scaleKeys || e.eulerKeys);
  };
  return parseTransformAnims();
}

export function readMatAnims(ctx, h, clipIsOff) {
  const { meta, read } = ctx;
  const { hashToPath } = h;
  const parseMatAnims = () => {
    const byPath = new Map();
    for (const o of meta.objects) {
      if (o.classID !== 74 || clipIsOff(String(o.pathID))) continue;
      const lay = clipLayout(read(o));
      if (!lay) continue;
      const dur = lay.dur;
      for (const { b, lane } of lay.items) {
        if ((b.customType | 0) !== 22) continue;
        const sr = lay.keysAt(lane);
        if (!sr || sr.length < 2) continue;
        let mn = Infinity,
          mx = -Infinity;
        for (const kv of sr) {
          if (kv[1] < mn) mn = kv[1];
          if (kv[1] > mx) mx = kv[1];
        }
        if (mx - mn <= 1e-6) continue;
        const rawHash = b.path >>> 0;
        const path = rawHash === 0 ? '' : hashToPath.get(Number(b.path)) || hashToPath.get(rawHash) || null;
        if (path === null) continue;
        const kind = (b.attribute >>> 0) >>> 28;
        let ent = byPath.get(path);
        if (!ent) {
          ent = { path, dur, props: [] };
          byPath.set(path, ent);
        }
        if (dur > ent.dur) ent.dur = dur;
        ent.props.push({ nameHash: (b.attribute >>> 0) & 0x0fffffff, comp: kind === 8 ? -1 : kind - 4, keys: sr.map((kv) => kv.slice()) });
      }
    }
    return [...byPath.values()];
  };
  return parseMatAnims();
}

export function readCameraCurves(ctx, h, clipIsOff) {
  const { meta, read } = ctx;
  const { hashToPath } = h;
  const parseCameraCurves = () => {
    const byPath = new Map();
    const FIELD = { [ATTR_AMPGAIN]: 'ampKeys', [ATTR_FREQGAIN]: 'freqKeys', [ATTR_LENS_FOV]: 'fovKeys', [ATTR_LENS_DUTCH]: 'dutchKeys' };
    for (const o of meta.objects) {
      if (o.classID !== 74 || clipIsOff(String(o.pathID))) continue;
      const lay = clipLayout(read(o));
      if (!lay) continue;
      const dur = lay.dur;
      for (const { b, lane, keyed } of lay.items) {
        if (!keyed) continue;
        const field = (b.typeID | 0) === 114 ? FIELD[b.attribute >>> 0] : null;
        if (field) {
          const rawHash = b.path >>> 0;
          const path = rawHash === 0 ? '' : hashToPath.get(Number(b.path)) || hashToPath.get(rawHash) || null;
          const sr = lay.keysAt(lane);
          if (path !== null && sr && sr.length > 1) {
            let mn = Infinity,
              mx = -Infinity;
            for (const kv of sr) {
              if (kv[1] < mn) mn = kv[1];
              if (kv[1] > mx) mx = kv[1];
            }
            if (mx - mn > 1e-5) {
              let ent = byPath.get(path);
              if (!ent) {
                ent = { path, dur };
                byPath.set(path, ent);
              }
              if (dur > ent.dur) ent.dur = dur;
              ent[field] = sr.map((kv) => kv.slice());
            }
          }
        }
      }
    }
    return byPath;
  };
  return parseCameraCurves();
}

export function attachAnimNodes(h, transformAnims) {
  const { localChain, pathToTr, rootTrPid } = h;
  for (const a of transformAnims) {
    const pid = a.path ? pathToTr.get(a.path) : rootTrPid;
    a.nodePid = pid || null;
    a.chain = pid ? localChain(pid) : [];
  }
  const findAnimParent = (sysPath) => {
    let best = null;
    for (const a of transformAnims) {
      if (!a.path) continue;
      if (sysPath === a.path || sysPath.startsWith(a.path + '/')) {
        if (!best || a.path.length > best.path.length) best = a;
      }
    }
    return best;
  };
  return findAnimParent;
}
