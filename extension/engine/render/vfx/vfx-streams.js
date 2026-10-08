import * as THREE from '../../../vendor/three.module.js';
import { mmToValue } from './vfx-minmax.js';
import { overLifeGradientGen } from './vfx-gradient.js';
import { noteBuildFailure } from './vfx-failures.js';

const STREAM_WIDTH = {
  4: 2, 5: 2, 6: 2, 7: 2, 
  8: 1, 9: 1, 
  10: 3, 11: 1, 
  12: 1, 13: 2, 14: 3, 
  15: 1, 16: 3, 17: 1, 18: 3, 
  19: 3, 20: 1, 21: 1, 22: 1, 
  23: 1, 24: 2, 25: 3, 26: 4, 
  27: 1, 28: 2, 29: 3, 30: 4, 
  31: 1, 32: 2, 33: 3, 34: 4, 
  35: 1, 36: 2, 37: 3, 38: 4, 
  39: 1, 40: 2, 41: 3, 42: 1, 43: 2, 44: 3,
  45: 1, 46: 1, 47: 2, 48: 3,
  49: 3, 50: 3, 51: 1, 52: 1,
};
const DEDICATED = new Set([0, 1, 2, 3]);
const CUSTOM1 = new Set([31, 32, 33, 34]);
const CUSTOM2 = new Set([35, 36, 37, 38]);

function streamChannels(streams) {
  const chans = [];
  for (const s of streams || []) {
    const id = s | 0;
    if (DEDICATED.has(id)) continue;
    const w = STREAM_WIDTH[id] || 0;
    if (!w) continue;
    let cur = chans[chans.length - 1];
    if (!cur || cur.used + w > 4) {
      cur = { used: 0, parts: [] };
      chans.push(cur);
    }
    cur.parts.push({ id, offset: cur.used, width: w });
    cur.used += w;
  }
  return chans;
}

function customValue(cd, which, t) {
  if (!cd || !cd.enabled) return null;
  const mode = Number(cd['mode' + which]);
  if (mode === 2) {
    const gen = overLifeGradientGen(cd['color' + which]);
    if (!gen) return null;
    const out = new THREE.Vector4(1, 1, 1, 1);
    gen.startGen([]);
    gen.genColor([], out, t);
    return [out.x, out.y, out.z, out.w];
  }
  if (mode !== 1) return null;
  const n = Math.max(0, Math.min(4, Number(cd['vectorComponentCount' + which]) || 0));
  const v = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const mm = cd['vector' + which + '_' + i];
    if (!mm) continue;
    try {
      const g = mmToValue(mm);
      v[i] = g.genValue ? g.genValue([], t) : 0;
    } catch (e) {
      noteBuildFailure('streamValue', e);
    }
  }
  return v;
}

export function streamVaryingValues(sys, t) {
  if (!sys || !sys.useCustomVertexStreams || !sys.vertexStreams) return null;
  const ps = sys.ps || {};
  const cd = ps.CustomDataModule;
  const c1 = customValue(cd, 0, t || 0);
  const c2 = customValue(cd, 1, t || 0);
  if (!c1 && !c2) return null;
  const out = {};
  const chans = streamChannels(sys.vertexStreams);
  chans.forEach((ch, i) => {
    let touched = false;
    const v = [0, 0, 0, 1];
    for (const p of ch.parts) {
      const src = CUSTOM1.has(p.id) ? c1 : CUSTOM2.has(p.id) ? c2 : null;
      if (!src) continue;
      touched = true;
      for (let k = 0; k < p.width; k++) v[p.offset + k] = src[k] == null ? 0 : src[k];
    }
    if (touched) out['in_TEXCOORD' + i] = v;
  });
  return Object.keys(out).length ? out : null;
}

export const _testing = { streamChannels };
