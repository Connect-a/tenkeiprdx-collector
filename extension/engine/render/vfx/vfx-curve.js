import * as TQ from './quarks-ext.js';

const WRAP_REPEAT = 1;

function stepTangent(a, b) {
  const ao = a ? a.outSlope : 0,
    bi = b ? b.inSlope : 0;
  if (ao === Infinity || bi === Infinity) return 'a';
  if (ao === -Infinity || bi === -Infinity) return 'b';
  return null;
}

export function evalHermite(keys, t) {
  const ks = keys || [];
  if (!ks.length) return 0;
  if (ks.length === 1) return ks[0].value || 0;
  if (t <= ks[0].time) return ks[0].value || 0;
  const last = ks[ks.length - 1];
  if (t >= last.time) return last.value || 0;
  let i = 0;
  while (i < ks.length - 1 && ks[i + 1].time < t) i++;
  const a = ks[i],
    b = ks[i + 1];
  const dt = b.time - a.time;
  if (dt <= 1e-9) return a.value || 0;
  const step = stepTangent(a, b);
  if (step) return (step === 'a' ? a.value : b.value) || 0;
  const u = (t - a.time) / dt,
    u2 = u * u,
    u3 = u2 * u;
  return (
    (2 * u3 - 3 * u2 + 1) * (a.value || 0) +
    (u3 - 2 * u2 + u) * dt * (a.outSlope || 0) +
    (-2 * u3 + 3 * u2) * (b.value || 0) +
    (u3 - u2) * dt * (b.inSlope || 0)
  );
}

export function keyOnAt(keys, t) {
  if (!keys || !keys.length) return false;
  if (t <= keys[0][0]) return keys[0][1] >= 0.5;
  for (let i = keys.length - 1; i >= 0; i--) if (t >= keys[i][0]) return keys[i][1] >= 0.5;
  return keys[keys.length - 1][1] >= 0.5;
}

export function keyframesToBezier(keys, scalar, wrap) {
  if (!keys || !keys.length) return null;
  const curves = [];
  const flat = (v) => new TQ.Bezier(v, v, v, v);
  const t0 = Number(keys[0].time) || 0;
  const tl = Number(keys[keys.length - 1].time) || 0;
  const span = tl - t0;
  const post = wrap ? wrap.post | 0 : 0;
  const reps = post === WRAP_REPEAT && span > 1e-4 && tl < 1 - 1e-6 ? Math.ceil((1 - t0) / span) : 1;
  if (t0 > 1e-6) curves.push([flat((keys[0].value || 0) * scalar), 0]);
  for (let r = 0; r < reps; r++) {
    const base = t0 + span * r;
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i],
        b = keys[i + 1];
      const at = base + (a.time - t0);
      if (at >= 1 - 1e-6) break;
      const dt = b.time - a.time || 1;
      const p0 = (a.value || 0) * scalar;
      const p3 = (b.value || 0) * scalar;
      const step = stepTangent(a, b);
      if (step) {
        curves.push([flat(step === 'a' ? p0 : p3), at]);
        continue;
      }
      const p1 = p0 + ((a.outSlope || 0) * scalar * dt) / 3;
      const p2 = p3 - ((b.inSlope || 0) * scalar * dt) / 3;
      curves.push([new TQ.Bezier(p0, p1, p2, p3), at]);
    }
  }
  const endT = t0 + span * reps;
  if (endT < 1 - 1e-6) curves.push([flat((keys[keys.length - 1].value || 0) * scalar), endT]);
  if (!curves.length) return null;
  return new TQ.PiecewiseBezier(curves);
}

export function evalClipKeys(keys, t) {
  if (!keys || !keys.length) return 0;
  let lo = 0;
  for (let i = 0; i < keys.length; i++) {
    if (keys[i][0] <= t) lo = i;
    else break;
  }
  const k = keys[lo];
  const kn = keys[Math.min(lo + 1, keys.length - 1)];
  let dt = t - k[0];
  if (!(dt > 0)) dt = 0;
  const seg = kn[0] - k[0];
  if (seg > 0 && dt > seg) dt = seg;
  return ((k[2] * dt + k[3]) * dt + k[4]) * dt + k[1];
}
