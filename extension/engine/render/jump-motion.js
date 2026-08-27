export const JUMP_CLIP_NAME = 'Jump';

const GRAVITY = 9.8;
const RISE_RATIO = 0.5;
const DIP_RATIO = 0.06;
const CROUCH_SEC = 0.16;
const LAND_SEC = 0.1;
const FPS = 60;
const SPEED_GROUND = 1.2;
const SPEED_AIR = 0.3;
const SPEED_LAND = 0.35;
const CYCLES = 1;
const XFADE_SEC = 0.2;

const boneNameOf = (tos, hash) => {
  const p = tos.get(hash) != null ? tos.get(hash) : tos.get(String(hash));
  return p ? String(p).split('/').pop() : null;
};

function sampleVec(track, t, stride) {
  const { times, values } = track;
  const n = times.length;
  if (!n) return null;
  if (t <= times[0]) return Array.from(values.slice(0, stride));
  if (t >= times[n - 1]) return Array.from(values.slice((n - 1) * stride, n * stride));
  let i = 0;
  while (i < n - 2 && times[i + 1] < t) i++;
  const t0 = times[i];
  const t1 = times[i + 1];
  const k = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  const out = new Array(stride);
  for (let c = 0; c < stride; c++) out[c] = values[i * stride + c] + (values[(i + 1) * stride + c] - values[i * stride + c]) * k;
  return out;
}

function sampleQuat(track, t) {
  const { times, values } = track;
  const n = times.length;
  if (!n) return null;
  if (t <= times[0]) return Array.from(values.slice(0, 4));
  if (t >= times[n - 1]) return Array.from(values.slice((n - 1) * 4, n * 4));
  let i = 0;
  while (i < n - 2 && times[i + 1] < t) i++;
  const t0 = times[i];
  const t1 = times[i + 1];
  const k = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  const a = [values[i * 4], values[i * 4 + 1], values[i * 4 + 2], values[i * 4 + 3]];
  const b = [values[(i + 1) * 4], values[(i + 1) * 4 + 1], values[(i + 1) * 4 + 2], values[(i + 1) * 4 + 3]];
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = dot < 0 ? -1 : 1;
  dot = Math.abs(dot);
  if (dot > 0.9995) {
    const out = [a[0] + (s * b[0] - a[0]) * k, a[1] + (s * b[1] - a[1]) * k, a[2] + (s * b[2] - a[2]) * k, a[3] + (s * b[3] - a[3]) * k];
    const len = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
    return [out[0] / len, out[1] / len, out[2] / len, out[3] / len];
  }
  const th = Math.acos(dot);
  const sn = Math.sin(th);
  const wa = Math.sin((1 - k) * th) / sn;
  const wb = Math.sin(k * th) / sn;
  return [wa * a[0] + wb * s * b[0], wa * a[1] + wb * s * b[1], wa * a[2] + wb * s * b[2], wa * a[3] + wb * s * b[3]];
}

function meanY(track) {
  let sum = 0;
  let n = 0;
  for (let i = 1; i < track.values.length; i += 3) {
    sum += track.values[i];
    n++;
  }
  return n ? sum / n : 0;
}

function yRange(track) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 1; i < track.values.length; i += 3) {
    if (track.values[i] < lo) lo = track.values[i];
    if (track.values[i] > hi) hi = track.values[i];
  }
  return hi > lo ? hi - lo : 0;
}

function resolveRoot(avatar, tracks) {
  const hashes = avatar.hashes || [];
  const depth = (i) => {
    let n = 0;
    let p = avatar.parents[i];
    while (p >= 0 && n < 64) {
      n++;
      p = avatar.parents[p];
    }
    return n;
  };
  let pick = -1;
  for (let i = 0; i < hashes.length; i++) {
    const dp = avatar.defPose && avatar.defPose[i];
    if (!dp || !(dp.t[1] > 0.05)) continue;
    if (boneNameOf(avatar.tos, hashes[i] >>> 0) === 'BodyCenter' || boneNameOf(avatar.tos, hashes[i]) === 'BodyCenter') {
      pick = i;
      break;
    }
    if (pick < 0 || depth(i) < depth(pick)) pick = i;
  }
  if (pick < 0) return null;
  const hash = hashes[pick] >>> 0;
  const track = tracks.find((t) => t.type === 'pos' && t.boneHash >>> 0 === hash) || null;
  const base = avatar.defPose[pick].t;
  return { hash, track, base, groundY: track ? meanY(track) : base[1] };
}

export function makeJumpClip(model, clips) {
  const avatar = model && model.avatar;
  const list = clips || (model && model.clips) || [];
  if (!avatar || !avatar.tos || !list.length) return null;
  const src = list.find((c) => /^run$/i.test(c.name)) || list.find((c) => /^idle$/i.test(c.name));
  if (!src) return null;

  let baked;
  try {
    baked = src.buildTracks(FPS);
  } catch (e) {
    return null;
  }
  if (!baked || !baked.tracks || !baked.tracks.length) return null;
  const srcDur = baked.duration > 0 ? baked.duration : 1;

  const root = resolveRoot(avatar, baked.tracks);
  if (!root || !(root.groundY > 0.05)) return null;

  const rise = root.groundY * RISE_RATIO;
  const air = 2 * Math.sqrt((2 * rise) / GRAVITY);
  const duration = CROUCH_SEC + air + LAND_SEC;
  const dip = Math.max(root.track ? yRange(root.track) : 0, root.groundY * DIP_RATIO);

  const speedAt = (t) => (t < CROUCH_SEC ? SPEED_GROUND : t > CROUCH_SEC + air ? SPEED_LAND : SPEED_AIR);
  const steps = Math.max(2, Math.round(duration * FPS));
  const times = new Float32Array(steps + 1);
  const srcTime = new Float32Array(steps + 1);
  const lift = new Float32Array(steps + 1);
  let acc = 0;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * duration;
    times[i] = t;
    if (i > 0) acc += speedAt(t) * (duration / steps);
    srcTime[i] = acc;
    if (t < CROUCH_SEC) lift[i] = -dip * Math.sin((t / CROUCH_SEC) * Math.PI);
    else if (t <= CROUCH_SEC + air) {
      const s = (t - CROUCH_SEC) / air;
      lift[i] = rise * 4 * s * (1 - s);
    } else {
      const s = (t - CROUCH_SEC - air) / LAND_SEC;
      lift[i] = -dip * Math.sin(s * Math.PI);
    }
  }
  const span = acc > 0 ? acc : 1;
  for (let i = 0; i <= steps; i++) srcTime[i] = ((srcTime[i] / span) * CYCLES * srcDur) % srcDur;

  const tracks = [];
  for (const tr of baked.tracks) {
    const stride = tr.type === 'rot' ? 4 : 3;
    const values = new Float32Array((steps + 1) * stride);
    const isRoot = root.track && tr === root.track;
    for (let i = 0; i <= steps; i++) {
      const v = tr.type === 'rot' ? sampleQuat(tr, srcTime[i]) : sampleVec(tr, srcTime[i], stride);
      if (!v) continue;
      for (let c = 0; c < stride; c++) values[i * stride + c] = v[c];
      if (isRoot) values[i * stride + 1] += lift[i];
    }
    tracks.push({ boneHash: tr.boneHash, type: tr.type, times, values });
  }
  if (!root.track) {
    const values = new Float32Array((steps + 1) * 3);
    for (let i = 0; i <= steps; i++) {
      values[i * 3] = root.base[0];
      values[i * 3 + 1] = root.base[1] + lift[i];
      values[i * 3 + 2] = root.base[2];
    }
    tracks.push({ boneHash: root.hash, type: 'pos', times, values });
  }

  return {
    name: JUMP_CLIP_NAME,
    duration,
    startTime: 0,
    stopTime: duration,
    sampleRate: FPS,
    events: [],
    genericBinds: [],
    xfade: XFADE_SEC,
    once: true,
    buildTracks: () => ({ name: JUMP_CLIP_NAME, duration, tracks }),
  };
}
