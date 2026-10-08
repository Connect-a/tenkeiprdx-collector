import { evalHermite } from './vfx-curve.js';

const PERM_BASE = [
  151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225,
  140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148,
  247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32,
  57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175,
  74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122,
  60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54,
  65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169,
  200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64,
  52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212,
  207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213,
  119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9,
  129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104,
  218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241,
  81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157,
  184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93,
  222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
];
const PERM = new Int32Array(512);
for (let i = 0; i < 256; i++) PERM[i] = PERM[i + 256] = PERM_BASE[i];

const G3 = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
  1, 1, 0, -1, 1, 0, 0, -1, 1, 0, -1, -1,
]);
const R2 = Math.SQRT1_2;
const G2 = new Float32Array([1, 0, -1, 0, 0, 1, 0, -1, R2, R2, -R2, R2, R2, -R2, -R2, -R2]);
const G1 = [1, -1];

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const dfade = (t) => 30 * t * t * (t - 1) * (t - 1);
const lerp = (t, a, b) => a + t * (b - a);

function grad3(x, y, z, out) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const X = ix & 255, Y = iy & 255, Z = iz & 255;
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fade(fx), v = fade(fy), w = fade(fz);
  const du = dfade(fx), dv = dfade(fy);
  const A = PERM[X] + Y, AA = PERM[A] + Z, AB = PERM[A + 1] + Z;
  const B = PERM[X + 1] + Y, BA = PERM[B] + Z, BB = PERM[B + 1] + Z;
  const gi = [PERM[AA] & 15, PERM[BA] & 15, PERM[AB] & 15, PERM[BB] & 15,
    PERM[AA + 1] & 15, PERM[BA + 1] & 15, PERM[AB + 1] & 15, PERM[BB + 1] & 15];
  const n = [0, 0, 0, 0, 0, 0, 0, 0];
  const gx = [0, 0, 0, 0, 0, 0, 0, 0];
  const gy = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 8; i++) {
    const dx = fx - (i & 1), dy = fy - ((i >> 1) & 1), dz = fz - ((i >> 2) & 1);
    const b = gi[i] * 3;
    gx[i] = G3[b];
    gy[i] = G3[b + 1];
    n[i] = G3[b] * dx + G3[b + 1] * dy + G3[b + 2] * dz;
  }
  const n00 = lerp(u, n[0], n[1]), n10 = lerp(u, n[2], n[3]);
  const n01 = lerp(u, n[4], n[5]), n11 = lerp(u, n[6], n[7]);
  const dx00 = lerp(u, gx[0], gx[1]) + du * (n[1] - n[0]);
  const dx10 = lerp(u, gx[2], gx[3]) + du * (n[3] - n[2]);
  const dx01 = lerp(u, gx[4], gx[5]) + du * (n[5] - n[4]);
  const dx11 = lerp(u, gx[6], gx[7]) + du * (n[7] - n[6]);
  out[0] = lerp(w, lerp(v, dx00, dx10), lerp(v, dx01, dx11));
  const dy0 = lerp(v, lerp(u, gy[0], gy[1]), lerp(u, gy[2], gy[3])) + dv * (n10 - n00);
  const dy1 = lerp(v, lerp(u, gy[4], gy[5]), lerp(u, gy[6], gy[7])) + dv * (n11 - n01);
  out[1] = lerp(w, dy0, dy1);
}

function grad2(x, y, out) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const X = ix & 255, Y = iy & 255;
  const fx = x - ix, fy = y - iy;
  const u = fade(fx), v = fade(fy), du = dfade(fx), dv = dfade(fy);
  const A = PERM[X] + Y, B = PERM[X + 1] + Y;
  const gi = [PERM[A] & 7, PERM[B] & 7, PERM[A + 1] & 7, PERM[B + 1] & 7];
  const n = [0, 0, 0, 0], gx = [0, 0, 0, 0], gy = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const dx = fx - (i & 1), dy = fy - ((i >> 1) & 1);
    const b = gi[i] * 2;
    gx[i] = G2[b];
    gy[i] = G2[b + 1];
    n[i] = G2[b] * dx + G2[b + 1] * dy;
  }
  const n0 = lerp(u, n[0], n[1]), n1 = lerp(u, n[2], n[3]);
  out[0] = lerp(v, lerp(u, gx[0], gx[1]) + du * (n[1] - n[0]), lerp(u, gx[2], gx[3]) + du * (n[3] - n[2]));
  out[1] = lerp(u, lerp(v, gy[0], gy[2]), lerp(v, gy[1], gy[3])) + dv * (n1 - n0);
}

function grad1(x, out) {
  const ix = Math.floor(x);
  const i = ix & 255;
  const f = x - ix;
  const fd = fade(f), fdd = dfade(f);
  const g0 = G1[PERM[i] & 1], g1 = G1[PERM[i + 1] & 1];
  out[0] = g0 + fd * (g1 - g0) + fdd * ((f - 1) * g1 - f * g0);
  out[1] = 0;
}

const KSCALE = [2, Math.SQRT2, 1];

function kernel(q, x, y, z, freq, out) {
  if (q >= 2) grad3(x * freq, y * freq, z * freq, out);
  else if (q === 1) grad2(x * freq, y * freq, out);
  else grad1(x * freq, out);
  const k = KSCALE[q < 0 ? 0 : q > 2 ? 2 : q] * freq;
  out[0] *= k;
  out[1] *= k;
}

function octaves(o, x, y, z, out) {
  kernel(o.quality, x, y, z, o.freq, out);
  if (o.octaves < 2) return;
  let f = o.freq, amp = 1, w = 1, a0 = out[0], a1 = out[1];
  for (let k = 1; k < o.octaves; k++) {
    f *= o.octaveScale;
    amp *= o.octaveMul;
    w += amp;
    kernel(o.quality, x, y, z, f, out);
    a0 += amp * out[0];
    a1 += amp * out[1];
  }
  out[0] = a0 / w;
  out[1] = a1 / w;
}

const s1 = [0, 0], s2 = [0, 0], s3 = [0, 0];

export function unityNoise(o, px, py, pz, scroll, out3) {
  const a = pz + o.off0;
  const b = py + o.off1;
  let c = px + o.off2;
  octaves(o, a, b, c + scroll, s1);
  c += 100;
  octaves(o, c, a, b + scroll, s2);
  octaves(o, b, c, a + scroll, s3);
  out3[0] = s2[0] - s1[1];
  out3[1] = s1[0] - s3[1];
  out3[2] = s3[0] - s2[1];
}

export const remapNoise = (keys, v) => evalHermite(keys, Math.min(1, Math.max(0, v * 0.5 + 0.5)));
const remapKeys = (mm) => (mm && mm.maxCurve && mm.maxCurve.m_Curve && mm.maxCurve.m_Curve.length ? mm.maxCurve.m_Curve : null);
export function noiseRemapOf(noiseMod) {
  if (!noiseMod || noiseMod.remapEnabled !== true) return { x: null, y: null, z: null };
  return { x: remapKeys(noiseMod.remap), y: noiseMod.separateAxes ? remapKeys(noiseMod.remapY) : null, z: noiseMod.separateAxes ? remapKeys(noiseMod.remapZ) : null };
}

export function makeNoiseOffsets(rnd) {
  const r = rnd || Math.random;
  return { off0: r() * 100, off1: r() * 100, off2: r() * 100 };
}

export const _testing = { grad1, grad2, grad3, kernel, octaves };
