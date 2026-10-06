import * as TQ from './quarks-ext.js';
import { keyframesToBezier, evalHermite } from './vfx-curve.js';

export function mmToValue(mm, mul) {
  mul = mul == null ? 1 : mul;
  if (!mm) return new TQ.ConstantValue(0);
  const st = mm.minMaxState;
  const scalar = (mm.scalar || 0) * mul;
  if (st === 0) return new TQ.ConstantValue(scalar);
  if (st === 3) return new TQ.IntervalValue((mm.minScalar || 0) * mul, scalar);
  const keys = mm.maxCurve && mm.maxCurve.m_Curve;
  const wrap = mm.maxCurve ? { pre: mm.maxCurve.m_PreInfinity, post: mm.maxCurve.m_PostInfinity } : null;
  const b = keys && keys.length ? keyframesToBezier(keys, scalar, wrap) : null;
  return b || new TQ.ConstantValue(scalar);
}

export const mmIsActive = (mm, base) => {
  if (!mm) return false;
  const st = mm.minMaxState | 0;
  if (st === 0) return Math.abs((mm.scalar || 0) - (base || 0)) > 1e-6;
  if (st === 3) return Math.abs((mm.scalar || 0) - (base || 0)) > 1e-6 || Math.abs((mm.minScalar || 0) - (base || 0)) > 1e-6;
  return true;
};

const evalCurve = (curve, t) => evalHermite((curve && curve.m_Curve) || [], t);
export function evalMinMax(mm, t, rnd) {
  if (!mm) return 0;
  const st = mm.minMaxState;
  if (st === 1) return (mm.scalar || 0) * evalCurve(mm.maxCurve, t);
  if (st === 2) {
    const a = (mm.scalar || 0) * evalCurve(mm.maxCurve, t),
      b = (mm.scalar || 0) * evalCurve(mm.minCurve, t);
    return b + (a - b) * (rnd == null ? 0.5 : rnd);
  }
  if (st === 3) {
    const a = mm.scalar || 0,
      b = mm.minScalar || 0;
    return b + (a - b) * (rnd == null ? Math.random() : rnd);
  }
  return mm.scalar || 0;
}
export const sampleMinMax = (mm, rnd) => evalMinMax(mm, 0, rnd);
