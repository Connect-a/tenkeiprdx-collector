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

export function buildSampler(seq, start) {
  const { tracks, total } = buildTracks(seq || []);
  const byProp = {};
  for (const tr of tracks) for (const p of tr.p === 's' ? ['sx', 'sy'] : [tr.p]) (byProp[p] = byProp[p] || []).push({ ...tr, p });
  const firstA = byProp.a && byProp.a[0];
  const BASE = {
    a: firstA && firstA.to === 0 ? 1 : 0,
    sx: start.scale[0],
    sy: start.scale[1],
    x: start.pos[0],
    y: start.pos[1],
    rz: 0,
    punch: 0,
    fill: 0,
  };
  for (const p in byProp) {
    byProp[p].sort((a, b) => a.start - b.start);
    let prev = BASE[p];
    for (const tr of byProp[p]) {
      tr.from = prev;
      if (p !== 'punch') prev = tr.to;
    }
  }
  function sample(sec) {
    const v = { a: BASE.a, sx: BASE.sx, sy: BASE.sy, x: BASE.x, y: BASE.y, rz: 0, punch: 0, fill: byProp.fill ? 0 : 1 };
    for (const p in byProp) {
      if (p === 'path') continue;
      const list = byProp[p];
      let val = list[0].from;
      for (const tr of list) {
        if (sec < tr.start) break;
        if (sec >= tr.end) {
          val = p === 'punch' ? 0 : tr.to;
          continue;
        }
        const prog = tr.dur > 0 ? clamp01((sec - tr.start) / tr.dur) : 1;
        if (p === 'punch') val = tr.to * Math.sin(prog * Math.PI);
        else {
          const fn = EASE[tr.ease] || EASE.outSine;
          val = tr.from + (tr.to - tr.from) * fn(prog);
        }
        break;
      }
      v[p] = val;
    }
    if (byProp.path) {
      for (const tr of byProp.path) {
        if (sec < tr.start) break;
        if (!tr._arc) tr._arc = buildArcTable([[0, 0]].concat(tr.pts));
        const frac = sec >= tr.end ? 1 : (EASE[tr.ease] || EASE.outSine)(clamp01((sec - tr.start) / tr.dur));
        const pos = sampleArc(tr._arc, frac);
        v.x = pos[0];
        v.y = pos[1];
      }
    }
    const punch = 1 + v.punch;
    return { a: clamp01(v.a), x: v.x, y: v.y, sx: v.sx * punch, sy: v.sy * punch, rz: v.rz, fill: clamp01(v.fill) };
  }
  return { total, sample };
}
