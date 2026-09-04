import * as THREE from '../../vendor/three.module.js';

let _softRadial = null;
function softRadialTex() {
  if (_softRadial) return _softRadial;
  const S = 64,
    cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  _softRadial = new THREE.CanvasTexture(cv);
  _softRadial.needsUpdate = true;
  return _softRadial;
}

const _procCache = new Map();
export function proceduralTex(proc) {
  if (!proc || !proc.shader) return softRadialTex();
  const sh = proc.shader,
    v = proc.vec1 || {};
  const Vf = v['Vector1_f0683063f9b44121bff83e626fd4632a'];
  const V1 = v['Vector1_1'];
  const V9 = v['Vector1_9e0b82cda8e244118777bca7e52af518'];
  let fnR = null,
    fnUV = null;
  if (sh === 'Shader Graphs/CircleHole_add') {
    const vf = Vf != null ? Vf : 1,
      v1 = V1 != null ? V1 : 13,
      v9 = V9 != null ? V9 : 100;
    fnR = (r) => {
      const a = 2 * r * vf;
      return Math.max(0, Math.min(1, Math.pow(a, v1) * (1 - Math.pow(a, v9))));
    };
  } else if (/Circle_nomal_GF/.test(sh)) {
    const vf = Vf != null ? Vf : 1,
      v9 = V9 != null ? V9 : 30;
    fnR = (r) => Math.max(0, Math.min(1, 1 - Math.pow(2 * r * vf, v9)));
  } else if (/Circle_nomal|Circle_add/.test(sh)) {
    const v9 = V9 != null ? V9 : 4;
    fnR = (r) => Math.max(0, Math.min(1, 1 - Math.pow(Math.min(1, 2 * r), v9)));
  } else if (/enemy_fire/.test(sh)) {
    fnR = (r) => Math.max(0, 1 - Math.pow(2.08 * r, 1.22));
  } else if (/GlitterNormal/.test(sh)) {
    const w = 0.09;
    fnUV = (ux, uy) => {
      let cover = 0;
      const C = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ];
      for (const c of C) {
        const d = 2 * Math.hypot(ux - c[0], uy - c[1]);
        cover = Math.max(cover, Math.max(0, Math.min(1, (1 - d) / w)));
      }
      return 1 - cover;
    };
  } else if (/SimpleMoon/.test(sh)) {
    fnUV = (ux, uy) => {
      const cx = ux - 0.5,
        cy = uy - 0.5;
      const main = Math.max(0, Math.min(1, (1 - Math.hypot(cx, cy) / 0.47) / 0.05));
      const cut = Math.max(0, Math.min(1, (1 - Math.hypot(cx - 0.22, cy) / 0.47) / 0.05));
      return main * (1 - cut);
    };
  } else if (/SoftSmoke/.test(sh)) {
    fnUV = (ux, uy) => {
      const x = ux * (1 - ux) * uy * (1 - uy);
      return Math.max(0, Math.min(1, (Math.pow(Math.max(1e-6, x), 0.38) - 0.2176) * 13.63 + 0.2176));
    };
  } else if (/MagLineCross/.test(sh)) {
    fnUV = (ux, uy) => {
      const dv1 = Math.hypot(ux - 0.5, uy - 0),
        dv2 = Math.hypot(ux - 0.5, uy - 1);
      const vert = (1 - Math.pow(1.4 * dv1, 20)) * (1 - Math.pow(1.4 * dv2, 20));
      const dh1 = Math.hypot(ux - 0, uy - 0.5),
        dh2 = Math.hypot(ux - 1, uy - 0.5);
      const horiz = (1 - Math.pow(1.4 * dh1, 20)) * (1 - Math.pow(1.4 * dh2, 20));
      const cross = Math.max(vert, horiz);
      const dc = Math.hypot(ux - 0.5, uy - 0.5);
      const glow = Math.max(0, Math.min(1, (1 - Math.pow(1.94 * dc, 0.57)) * 1.47));
      return Math.max(0, Math.min(1, cross * glow));
    };
  } else if (/MagLine/.test(sh)) {
    fnUV = (ux, uy) => {
      const d1 = Math.hypot(ux - 0.5, uy),
        d2 = Math.hypot(ux - 0.5, uy - 1),
        d3 = Math.hypot(ux - 0.5, uy - 0.5);
      const a1 = 1 - Math.pow(1.4 * d1, 20),
        a2 = 1 - Math.pow(1.4 * d2, 20);
      const u12 = a1 * a2;
      const glow = Math.max(0, 0.59 * (1 - Math.pow(1.94 * d3, 0.57)));
      return Math.max(0, Math.min(1, 0.69 * Math.max(u12, glow) + 0.31 * u12));
    };
  }
  if (!fnR && !fnUV) return softRadialTex();
  const key = sh + '|' + JSON.stringify(v);
  if (_procCache.has(key)) return _procCache.get(key);
  const S = 128,
    data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const ux = (x + 0.5) / S,
        uy = (y + 0.5) / S;
      const a = fnUV ? fnUV(ux, uy) : fnR(Math.hypot(ux - 0.5, uy - 0.5));
      const i = (y * S + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  _procCache.set(key, tex);
  return tex;
}
