const EMO_ANIM = {
  1: [
    { op: 'A', p: 'a', to: 1, dur: 0.25, delay: 0, ease: 'outSine' },
    { op: 'J', p: 'punch', to: 0.1, dur: 0.5, delay: 0, ease: 'outBack' },
    { op: 'J', p: 'y', to: 50, dur: 0.5, delay: 0, ease: 'linear' },
    { op: 'J', p: 'a', to: 0, dur: 0.5, delay: 0.25, ease: 'outSine' },
  ],
  2: [
    { op: 'A', p: 'a', to: 1, dur: 0.25, delay: 0, ease: 'outSine' },
    { op: 'J', p: 'y', to: 0, dur: 0.5, delay: 0, ease: 'outCubic' },
    { op: 'A', p: 'y', to: -50, dur: 0.5, delay: 0, ease: 'outCubic' },
    { op: 'J', p: 'a', to: 0, dur: 0.5, delay: 0.5, ease: 'outSine' },
  ],
  3: [
    { op: 'A', p: 'a', to: 1, dur: 0.25, delay: 0, ease: 'outSine' },
    { op: 'J', p: 's', to: 2, dur: 0.5, delay: 0, ease: 'outBounce' },
    { op: 'J', p: 'a', to: 0, dur: 0.5, delay: 0.25, ease: 'outSine' },
  ],
  4: [
    { op: 'A', p: 'a', to: 1, dur: 0.25, delay: 0, ease: 'outSine' },
    { op: 'J', p: 's', to: 2, dur: 0.5, delay: 0, ease: 'outElastic' },
    { op: 'J', p: 'a', to: 0, dur: 0.5, delay: 0.25, ease: 'outSine' },
  ],
  5: [
    { op: 'A', p: 'a', to: 1, dur: 0.25, delay: 0, ease: 'outSine' },
    { op: 'J', p: 'x', to: -25, dur: 0.25, delay: 0, ease: 'outSine' },
    { op: 'J', p: 'y', to: 25, dur: 0.25, delay: 0, ease: 'outSine' },
    { op: 'A', p: 'a', to: 0, dur: 0.5, delay: 0, ease: 'outSine' },
  ],
  6: [
    { op: 'A', p: 'a', to: 1, dur: 0.5, delay: 0, ease: 'outSine' },
    { op: 'A', p: 'a', to: 0, dur: 0.5, delay: 0, ease: 'outSine' },
  ],
  7: [
    { op: 'A', p: 'a', to: 1, dur: 0.5, delay: 0, ease: 'outSine' },
    { op: 'J', p: 'sx', to: 2, dur: 0.5, delay: 0, ease: 'inOutBack' },
    { op: 'J', p: 'sy', to: 2, dur: 0.5, delay: 0.125, ease: 'inOutBack' },
    { op: 'J', p: 'a', to: 0, dur: 0.5, delay: 0.5, ease: 'outSine' },
  ],
  8: [
    { op: 'A', p: 'a', to: 1, dur: 0.25, delay: 0, ease: 'outSine' },
    { op: 'J', p: 's', to: 2, dur: 0.5, delay: 0, ease: 'outElastic' },
    { op: 'J', p: 'a', to: 0, dur: 0.5, delay: 0.25, ease: 'outSine' },
  ],
  10: [
    { op: 'A', p: 'a', to: 1, dur: 0.25, delay: 0, ease: 'outSine' },
    { op: 'A', p: 'a', to: 0.25, dur: 0.25, delay: 0, ease: 'outSine' },
    { op: 'A', p: 'a', to: 1, dur: 0.25, delay: 0, ease: 'outSine' },
    { op: 'A', p: 'a', to: 0, dur: 0.25, delay: 0, ease: 'outSine' },
  ],
  11: [
    { op: 'A', p: 'a', to: 1, dur: 0.25, delay: 0, ease: 'outSine' },
    { op: 'J', p: 'sy', to: 1, dur: 0.25, delay: 0, ease: 'outSine' },
    { op: 'A', p: 'a', to: 0, dur: 0.3, delay: 0.25, ease: 'inSine' },
    { op: 'J', p: 'sy', to: 0, dur: 0.3, delay: 0, ease: 'inSine' },
  ],
  12: [
    { op: 'A', p: 'a', to: 1, dur: 0.3, delay: 0, ease: 'outSine' },
    { op: 'J', p: 'y', to: 25, dur: 0.3, delay: 0, ease: 'outSine' },
    { op: 'J', p: 's', to: 1, dur: 0.3, delay: 0, ease: 'outBack' },
    { op: 'A', p: 'a', to: 0, dur: 0.5, delay: 0.25, ease: 'inSine' },
  ],
  13: [
    { op: 'A', p: 'a', to: 1, dur: 0.25, delay: 0, ease: 'outSine' },
    {
      op: 'A',
      p: 'path',
      pts: [
        [10, -30],
        [25, -60],
        [60, -80],
        [100, -100],
      ],
      dur: 0.5,
      delay: 0,
      ease: 'outCubic',
    },
    { op: 'J', p: 'a', to: 0, dur: 0.5, delay: 0, ease: 'outSine' },
  ],
  14: [
    { op: 'A', p: 'a', to: 1, dur: 0.25, delay: 0, ease: 'outSine' },
    {
      op: 'A',
      p: 'path',
      pts: [
        [-10, -30],
        [-25, -60],
        [-60, -80],
        [-100, -100],
      ],
      dur: 0.5,
      delay: 0,
      ease: 'outCubic',
    },
    { op: 'J', p: 'a', to: 0, dur: 0.5, delay: 0, ease: 'outSine' },
  ],
  15: [
    { op: 'A', p: 'a', to: 1, dur: 0.25, delay: 0, ease: 'outSine' },
    { op: 'J', p: 'y', to: 50, dur: 0.5, delay: 0, ease: 'outSine' },
    { op: 'A', p: 'a', to: 0, dur: 0.5, delay: 0, ease: 'outSine' },
  ],
  16: [
    { op: 'A', p: 'a', to: 1, dur: 0.5, delay: 0, ease: 'outSine' },
    { op: 'J', p: 'sx', to: 1, dur: 0.5, delay: 0, ease: 'inOutBack' },
    { op: 'J', p: 'sy', to: 1, dur: 0.5, delay: 0.125, ease: 'inOutBack' },
    { op: 'A', p: 'sx', to: 0.98, dur: 0.15, delay: 0, ease: 'outSine' },
    { op: 'J', p: 'sy', to: 1.02, dur: 0.15, delay: 0, ease: 'outSine' },
    { op: 'A', p: 'sx', to: 1.02, dur: 0.15, delay: 0, ease: 'outSine' },
    { op: 'J', p: 'sy', to: 0.98, dur: 0.15, delay: 0, ease: 'outSine' },
    { op: 'A', p: 'sx', to: 0.98, dur: 0.15, delay: 0, ease: 'outSine' },
    { op: 'J', p: 'sy', to: 1.02, dur: 0.15, delay: 0, ease: 'outSine' },
    { op: 'A', p: 'sx', to: 1.02, dur: 0.15, delay: 0, ease: 'outSine' },
    { op: 'J', p: 'sy', to: 0.98, dur: 0.15, delay: 0, ease: 'outSine' },
    { op: 'J', p: 'a', to: 0, dur: 0.1, delay: 0, ease: 'outSine' },
  ],
  17: [
    { op: 'A', p: 'fill', to: 1, dur: 1, delay: 0, ease: 'linear' },
    { op: 'J', p: 'x', to: -150, dur: 1, delay: 0, ease: 'linear' },
    { op: 'A', p: 'a', to: 0, dur: 0.2, delay: 0, ease: 'outSine' },
  ],
  18: [
    { op: 'A', p: 'a', to: 1, dur: 0.25, delay: 0, ease: 'outSine' },
    { op: 'J', p: 's', to: 1, dur: 0.5, delay: 0, ease: 'outBounce' },
    { op: 'J', p: 'a', to: 0, dur: 0.5, delay: 0.5, ease: 'outSine' },
  ],
};

const c1 = 1.70158,
  c3 = c1 + 1,
  c4 = (2 * Math.PI) / 3,
  c5 = 1.525 * (1.70158 + 1);
function outBounce(t) {
  const n1 = 7.5625,
    d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}
const EASE = {
  linear: (t) => t,
  inSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  outSine: (t) => Math.sin((t * Math.PI) / 2),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  outBack: (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2),
  inOutBack: (t) => (t < 0.5 ? (Math.pow(2 * t, 2) * ((c5 + 1) * 2 * t - c5)) / 2 : (Math.pow(2 * t - 2, 2) * ((c5 + 1) * (t * 2 - 2) + c5) + 2) / 2),
  outBounce,
  outElastic: (t) => (t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1),
};
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const EMO_START = { 2: [0, 50], 11: [0, 50], 12: [0, 50], 17: [100, 50] };

function buildTracks(units) {
  let seqEnd = 0,
    lastAppend = 0,
    total = 0;
  const tracks = [];
  for (const u of units) {
    const delay = u.delay || 0,
      dur = u.dur || 0;
    const ap = u.op === 'A' ? seqEnd : lastAppend;
    if (u.op === 'A') lastAppend = ap;
    const start = ap + delay,
      end = start + dur;
    seqEnd = u.op === 'A' ? end : Math.max(seqEnd, end);
    total = Math.max(total, end);
    if (u.p) tracks.push({ p: u.p, to: u.to, pts: u.pts, dur, start, end, ease: u.ease });
  }
  return { tracks, total };
}

function catmullSeg(pts, u) {
  const n = pts.length - 1;
  if (n <= 0) return pts[0];
  const seg = Math.min(Math.floor(u * n), n - 1),
    lt = u * n - seg;
  const P = (i) => {
    if (i < 0) return pts[1];
    if (i > n) return [2 * pts[n][0] - pts[n - 1][0], 2 * pts[n][1] - pts[n - 1][1]];
    return pts[i];
  };
  const p0 = P(seg - 1),
    p1 = P(seg),
    p2 = P(seg + 1),
    p3 = P(seg + 2);
  const cr = (a, b, c, d, t) => {
    const t2 = t * t,
      t3 = t2 * t;
    return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  };
  return [cr(p0[0], p1[0], p2[0], p3[0], lt), cr(p0[1], p1[1], p2[1], p3[1], lt)];
}
function buildArcTable(pts) {
  const N = 200;
  const samples = [];
  let len = 0,
    prev = catmullSeg(pts, 0);
  samples.push({ d: 0, p: prev });
  for (let i = 1; i <= N; i++) {
    const p = catmullSeg(pts, i / N);
    len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    samples.push({ d: len, p });
    prev = p;
  }
  return { samples, len };
}
function sampleArc(table, frac) {
  const target = frac * table.len,
    s = table.samples;
  for (let i = 1; i < s.length; i++) {
    if (s[i].d >= target) {
      const a = s[i - 1],
        b = s[i],
        seg = b.d - a.d,
        t = seg > 0 ? (target - a.d) / seg : 0;
      return [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t];
    }
  }
  return s[s.length - 1].p;
}

function build(code) {
  const units = EMO_ANIM[code];
  if (!units) return { total: 0, sample: () => ({ a: 1, x: 0, y: 0, sx: 1, sy: 1, rz: 0 }) };
  const { tracks, total } = buildTracks(units);
  const byProp = {};
  for (const tr of tracks) (byProp[tr.p] = byProp[tr.p] || []).push(tr);
  const firstA = byProp.a && byProp.a[0];
  const baseA = firstA && firstA.to === 0 ? 1 : 0;
  const st = EMO_START[code] || [0, 0];
  const BASE = { a: baseA, s: 1, sx: 1, sy: 1, x: st[0], y: st[1], rz: 0, punch: 0, fill: 0 };
  for (const p in byProp) {
    byProp[p].sort((a, b) => a.start - b.start);
    let prev = BASE[p];
    for (const tr of byProp[p]) { tr.from = prev; if (p !== 'punch') prev = tr.to; }
  }
  function sample(t) {
    const v = { a: BASE.a, s: 1, sx: 1, sy: 1, x: BASE.x, y: BASE.y, rz: 0, punch: 0, fill: byProp.fill ? 0 : 1 };
    for (const p in byProp) {
      if (p === 'path') continue;
      const list = byProp[p];
      let val = list[0].from;
      for (const tr of list) {
        if (t < tr.start) break;
        if (t >= tr.end) { val = p === 'punch' ? 0 : tr.ease === 'flash' ? 1 : tr.to; continue; }
        const prog = tr.dur > 0 ? clamp01((t - tr.start) / tr.dur) : 1;
        if (p === 'punch') val = tr.to * Math.sin(prog * Math.PI);
        else if (tr.ease === 'flash') val = 1 + (tr.to - 1) * Math.sin(prog * Math.PI);
        else { const fn = EASE[tr.ease] || EASE.outSine; val = tr.from + (tr.to - tr.from) * fn(prog); }
        break;
      }
      v[p] = val;
    }
    if (byProp.path) {
      for (const tr of byProp.path) {
        if (t < tr.start) break;
        if (!tr._arc) tr._arc = buildArcTable([[0, 0]].concat(tr.pts));
        const frac = t >= tr.end ? 1 : (EASE[tr.ease] || EASE.outSine)(clamp01((t - tr.start) / tr.dur));
        const pos = sampleArc(tr._arc, frac);
        v.x = pos[0]; v.y = pos[1];
      }
    }
    const sx = v.s * v.sx * (1 + v.punch), sy = v.s * v.sy * (1 + v.punch);
    return { a: v.a, x: v.x, y: v.y, sx, sy, rz: v.rz, fill: v.fill };
  }
  return { total, sample };
}

export const emoAnim = { build, EMO_ANIM };
