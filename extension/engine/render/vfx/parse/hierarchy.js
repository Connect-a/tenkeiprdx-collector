import { quatMul } from '../../../../unity/quat.js';
import { crc32 } from './hash.js';

export function readHierarchy(ctx) {
  const { meta, read } = ctx;
  const trByPath = new Map(),
    trByGo = new Map();
  for (const o of meta.objects)
    if (o.classID === 4) {
      const tr = read(o);
      if (tr) {
        trByPath.set(String(o.pathID), tr);
        trByGo.set(String(tr.m_GameObject && tr.m_GameObject.m_PathID), { tr, pid: String(o.pathID) });
      }
    }
  const rotV = (q, v) => {
    const qx = q.x || 0,
      qy = q.y || 0,
      qz = q.z || 0,
      qw = q.w == null ? 1 : q.w;
    const ix = qw * v.x + qy * v.z - qz * v.y,
      iy = qw * v.y + qz * v.x - qx * v.z,
      iz = qw * v.z + qx * v.y - qy * v.x,
      iw = -qx * v.x - qy * v.y - qz * v.z;
    return {
      x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
      y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
      z: iz * qw + iw * -qz + ix * -qy - iy * -qx,
    };
  };
  const worldPos = (trPid) => {
    let p = { x: 0, y: 0, z: 0 },
      cur = trPid,
      guard = 0;
    while (cur && cur !== '0' && guard++ < 32) {
      const tr = trByPath.get(cur);
      if (!tr) break;
      const s = tr.m_LocalScale || { x: 1, y: 1, z: 1 };
      p = { x: p.x * (s.x == null ? 1 : s.x), y: p.y * (s.y == null ? 1 : s.y), z: p.z * (s.z == null ? 1 : s.z) };
      p = rotV(tr.m_LocalRotation || { x: 0, y: 0, z: 0, w: 1 }, p);
      const lp = tr.m_LocalPosition || { x: 0, y: 0, z: 0 };
      p.x += lp.x || 0;
      p.y += lp.y || 0;
      p.z += lp.z || 0;
      cur = String(tr.m_Father && tr.m_Father.m_PathID);
    }
    return p;
  };
  const worldScale = (trPid) => {
    let sx = 1,
      sy = 1,
      sz = 1,
      cur = trPid,
      guard = 0;
    while (cur && cur !== '0' && guard++ < 32) {
      const tr = trByPath.get(cur);
      if (!tr) break;
      const s = tr.m_LocalScale || { x: 1, y: 1, z: 1 };
      sx *= s.x == null ? 1 : s.x;
      sy *= s.y == null ? 1 : s.y;
      sz *= s.z == null ? 1 : s.z;
      cur = String(tr.m_Father && tr.m_Father.m_PathID);
    }
    return { x: sx, y: sy, z: sz };
  };
  const localScale = (trPid) => {
    const tr = trByPath.get(String(trPid));
    const s = (tr && tr.m_LocalScale) || { x: 1, y: 1, z: 1 };
    return { x: s.x == null ? 1 : s.x, y: s.y == null ? 1 : s.y, z: s.z == null ? 1 : s.z };
  };
  const worldRot = (trPid) => {
    let q = { x: 0, y: 0, z: 0, w: 1 };
    let cur = trPid,
      guard = 0;
    while (cur && cur !== '0' && guard++ < 32) {
      const tr = trByPath.get(cur);
      if (!tr) break;
      const lq = tr.m_LocalRotation || { x: 0, y: 0, z: 0, w: 1 };
      q = quatMul(lq, q);
      cur = String(tr.m_Father && tr.m_Father.m_PathID);
    }
    return q;
  };
  const localChainRaw = (trPid) => {
    const out = [];
    let cur = trPid,
      guard = 0;
    while (cur && cur !== '0' && guard++ < 32) {
      const tr = trByPath.get(cur);
      if (!tr) break;
      const lp = tr.m_LocalPosition || {},
        lr = tr.m_LocalRotation || {},
        ls = tr.m_LocalScale || {};
      out.unshift({
        pid: cur,
        pos: { x: lp.x || 0, y: lp.y || 0, z: lp.z || 0 },
        rot: { x: lr.x || 0, y: lr.y || 0, z: lr.z || 0, w: lr.w == null ? 1 : lr.w },
        scale: { x: ls.x == null ? 1 : ls.x, y: ls.y == null ? 1 : ls.y, z: ls.z == null ? 1 : ls.z },
      });
      cur = String(tr.m_Father && tr.m_Father.m_PathID);
    }
    return out;
  };
  const relativeTransform = (ancestorPid, trPid) => {
    const segs = localChainRaw(trPid);
    const at = segs.findIndex((s) => s.pid === String(ancestorPid));
    let pos = { x: 0, y: 0, z: 0 },
      rot = { x: 0, y: 0, z: 0, w: 1 },
      scale = { x: 1, y: 1, z: 1 };
    for (const s of segs.slice(at + 1)) {
      const d = rotV(rot, { x: s.pos.x * scale.x, y: s.pos.y * scale.y, z: s.pos.z * scale.z });
      pos = { x: pos.x + d.x, y: pos.y + d.y, z: pos.z + d.z };
      rot = quatMul(rot, s.rot);
      scale = { x: scale.x * s.scale.x, y: scale.y * s.scale.y, z: scale.z * s.scale.z };
    }
    return { pos, rot, scale };
  };
  const goName = new Map();
  const goActive = new Map();
  for (const o of meta.objects)
    if (o.classID === 1) {
      const g = read(o);
      if (g && g.m_Name != null) goName.set(String(o.pathID), g.m_Name);
      if (g) goActive.set(String(o.pathID), g.m_IsActive !== 0 && g.m_IsActive !== false);
    }
  const pathOf = (trPid) => {
    const parts = [];
    let cur = trPid,
      guard = 0;
    while (cur && cur !== '0' && guard++ < 32) {
      const tr = trByPath.get(cur);
      if (!tr) break;
      const father = String(tr.m_Father && tr.m_Father.m_PathID);
      if (!father || father === '0') break;
      parts.unshift(goName.get(String(tr.m_GameObject && tr.m_GameObject.m_PathID)) || '');
      cur = father;
    }
    return parts.join('/');
  };
  const localChain = (trPid) => localChainRaw(trPid).map((s) => ({ path: pathOf(s.pid), pos: s.pos, rot: s.rot, scale: s.scale }));
  const effectiveActive = (trPid) => {
    let cur = trPid,
      guard = 0;
    while (cur && cur !== '0' && guard++ < 32) {
      const tr = trByPath.get(cur);
      if (!tr) break;
      const goId = String(tr.m_GameObject && tr.m_GameObject.m_PathID);
      if (goActive.has(goId) && goActive.get(goId) === false) return false;
      const father = String(tr.m_Father && tr.m_Father.m_PathID);
      if (!father || father === '0') break;
      cur = father;
    }
    return true;
  };
  const hashToPath = new Map();
  for (const pid of trByPath.keys()) {
    const p = pathOf(pid);
    if (p) hashToPath.set(crc32(p), p);
  }
  const pathToTr = new Map();
  let rootTrPid = null;
  for (const pid of trByPath.keys()) {
    const p = pathOf(pid);
    if (p) pathToTr.set(p, pid);
    else {
      const tr = trByPath.get(pid);
      const father = String(tr.m_Father && tr.m_Father.m_PathID);
      if (!father || father === '0') rootTrPid = pid;
    }
  }
  return { trByPath, trByGo, rotV, worldPos, worldScale, localScale, worldRot, relativeTransform, goName, pathOf, localChain, effectiveActive, hashToPath, pathToTr, rootTrPid };
}
