import { matPropHash } from './parse/hash.js';
import { evalClipKeys } from './vfx-curve.js';

export function resolveMatAnim(ent, entry) {
  if (!ent || !ent.props || !ent.props.length || !entry || !entry.proc) return null;
  const names = new Set([...Object.keys(entry.proc.colors || {}), ...Object.keys(entry.proc.floats || {}), ...Object.keys(entry.proc.vec1 || {})]);
  const byHash = new Map();
  for (const n of names) byHash.set(matPropHash(n), n);
  const props = [];
  for (const p of ent.props) {
    const name = byHash.get(p.nameHash);
    if (name) props.push({ name, comp: p.comp, keys: p.keys });
  }
  return props.length ? { props, dur: ent.dur } : null;
}

export function applyMatAnim(uniforms, matAnim) {
  const jobs = [];
  for (const p of (matAnim && matAnim.props) || []) {
    const u = uniforms[p.name];
    if (!u) continue;
    jobs.push({ u, comp: p.comp, keys: p.keys });
  }
  if (!jobs.length) return null;
  return (t) => {
    for (const j of jobs) {
      const v = evalClipKeys(j.keys, t);
      if (j.comp < 0 || !j.u.value || typeof j.u.value !== 'object') j.u.value = v;
      else if (typeof j.u.value.setComponent === 'function') j.u.value.setComponent(j.comp, v);
    }
  };
}
