import { UNITY_BUILTIN_MESH } from '../vfx-builtin-mesh.js';

export function readParticleSystems(ctx, h, findAnimParent) {
  const { meta, read } = ctx;
  const { trByPath, trByGo, rotV, worldPos, worldScale, localScale, worldRot, relativeTransform, goName, pathOf, effectiveActive } = h;
  const systems = [];
  for (const o of meta.objects) {
    if (o.classID !== 198) continue;
    const ps = read(o);
    if (!ps) continue;
    const goId = String(ps.m_GameObject && ps.m_GameObject.m_PathID);
    const trEnt = trByGo.get(goId);
    let rend = null;
    for (const r of meta.objects) {
      if (r.classID !== 199) continue;
      const rr = read(r);
      if (rr && String(rr.m_GameObject && rr.m_GameObject.m_PathID) === goId) {
        rend = rr;
        break;
      }
    }
    const matPid = rend && rend.m_Materials ? String((Array.isArray(rend.m_Materials) ? rend.m_Materials[0] : rend.m_Materials).m_PathID) : null;
    const resolveMeshPid = (ref) => {
      if (!ref) return null;
      const fid = ref.m_FileID | 0;
      const mp = String(ref.m_PathID);
      if (fid === 0) return mp && mp !== '0' ? mp : null;
      const ext = (meta.externals || [])[fid - 1];
      if (ext && /unity default resources/i.test(ext.pathName || '') && UNITY_BUILTIN_MESH[mp]) return 'builtin:' + mp;
      return null;
    };
    const meshPids = [];
    if (rend && (rend.m_RenderMode | 0) === 4) for (const key of ['m_Mesh', 'm_Mesh1', 'm_Mesh2', 'm_Mesh3']) {
      const p = resolveMeshPid(rend[key]);
      if (p) meshPids.push(p);
    }
    const meshPid = meshPids[0] || null;
    const sysPath = trEnt ? pathOf(trEnt.pid) : '';
    const wPos = trEnt ? worldPos(trEnt.pid) : { x: 0, y: 0, z: 0 };
    const wRot = trEnt ? worldRot(trEnt.pid) : { x: 0, y: 0, z: 0, w: 1 };
    const ap = findAnimParent(sysPath);
    let animParent = null,
      localPos = null,
      localRot = null,
      animLocalScale = null;
    if (ap && trEnt) {
      const rel = relativeTransform(ap.nodePid, trEnt.pid);
      localPos = rel.pos;
      localRot = rel.rot;
      animLocalScale = rel.scale;
      animParent = ap.path;
    }
    let collisionPlanes = null;
    {
      const cm = ps.CollisionModule;
      if (cm && cm.enabled && (cm.type | 0) === 0) {
        const out = [];
        for (const ref of cm.m_Planes || []) {
          const pid = ref && ref.m_PathID != null ? String(ref.m_PathID) : '0';
          if (pid === '0' || (ref.m_FileID | 0) !== 0) continue;
          const tr = trByPath.get(pid);
          if (!tr) continue;
          const wp = worldPos(pid),
            wr = worldRot(pid);
          const n = rotV(wr, { x: 0, y: 1, z: 0 });
          out.push({ pos: wp, normal: n });
        }
        if (out.length)
          collisionPlanes = {
            planes: out,
            bounce: cm.m_Bounce && cm.m_Bounce.scalar != null ? Number(cm.m_Bounce.scalar) : 1,
            dampen: cm.m_Dampen && cm.m_Dampen.scalar != null ? Number(cm.m_Dampen.scalar) : 0,
            lifeLoss: cm.m_EnergyLossOnCollision && cm.m_EnergyLossOnCollision.scalar != null ? Number(cm.m_EnergyLossOnCollision.scalar) : 0,
            minKillSpeed: Number(cm.minKillSpeed) || 0,
            maxKillSpeed: cm.maxKillSpeed != null ? Number(cm.maxKillSpeed) : Infinity,
            radiusScale: cm.radiusScale != null ? Number(cm.radiusScale) : 1,
          };
      }
    }
    systems.push({
      kind: 'particles',
      collisionPlanes,
      ps,
      objPid: String(o.pathID),
      pos: wPos,
      rot: wRot,
      scale: trEnt ? worldScale(trEnt.pid) : { x: 1, y: 1, z: 1 },
      localScale: trEnt ? localScale(trEnt.pid) : { x: 1, y: 1, z: 1 },
      animParent,
      localPos,
      localRot,
      animLocalScale,
      moveWithTransform: ps.moveWithTransform == null ? null : Number(ps.moveWithTransform),
      moveWithCustomTransformPathID: ps.moveWithCustomTransform && ps.moveWithCustomTransform.m_PathID != null ? String(ps.moveWithCustomTransform.m_PathID) : '0',
      rendEnabled: !rend || rend.m_Enabled !== false,
      renderMode: rend ? rend.m_RenderMode : 0,
      renderAlignment: rend ? rend.m_RenderAlignment : 0,
      allowRoll: !rend || (rend.m_AllowRoll !== false && rend.m_AllowRoll !== 0),
      pivot: rend && rend.m_Pivot ? { x: rend.m_Pivot.x || 0, y: rend.m_Pivot.y || 0, z: rend.m_Pivot.z || 0 } : null,
      lengthScale: rend && rend.m_LengthScale != null ? rend.m_LengthScale : 2,
      velocityScale: rend && rend.m_VelocityScale != null ? rend.m_VelocityScale : 0,
      freeformStretching: !!(rend && (rend.m_FreeformStretching === true || rend.m_FreeformStretching === 1)),
      sortingOrder: rend ? rend.m_SortingOrder : 0,
      sortingLayer: rend && rend.m_SortingLayer != null ? Number(rend.m_SortingLayer) : 0,
      sortingLayerID: rend && rend.m_SortingLayerID != null ? Number(rend.m_SortingLayerID) : 0,
      meshDistribution: rend && rend.m_MeshDistribution != null ? Number(rend.m_MeshDistribution) : 0,
      normalDirection: rend && rend.m_NormalDirection != null ? Number(rend.m_NormalDirection) : 1,
      sortMode: rend && rend.m_SortMode != null ? Number(rend.m_SortMode) : 0,
      useCustomVertexStreams: !!(rend && (rend.m_UseCustomVertexStreams === true || rend.m_UseCustomVertexStreams === 1)),
      vertexStreams: rend && Array.isArray(rend.m_VertexStreams) ? rend.m_VertexStreams.map((v) => (typeof v === 'number' ? v : v && v.value != null ? Number(v.value) : -1)) : null,
      sortingFudge: rend && rend.m_SortingFudge != null ? Number(rend.m_SortingFudge) : 0,
      flip: rend && rend.m_Flip ? { x: rend.m_Flip.x || 0, y: rend.m_Flip.y || 0, z: rend.m_Flip.z || 0 } : null,
      trailMatPid: rend && Array.isArray(rend.m_Materials) && rend.m_Materials[1] ? String(rend.m_Materials[1].m_PathID) : null,
      name: goName.get(goId) || '',
      path: sysPath,
      goActive: trEnt ? effectiveActive(trEnt.pid) : true,
      matPid,
      meshPid,
      meshPids,
    });
  }
  return systems;
}

export function readMeshRenderers(ctx, h, findAnimParent) {
  const { meta, read } = ctx;
  const { trByGo, worldPos, worldScale, worldRot, relativeTransform, pathOf, effectiveActive } = h;
  const meshNodes = [];
  {
    const byPid = new Map();
    for (const o of meta.objects) byPid.set(String(o.pathID), o);
    for (const o of meta.objects) {
      if (o.classID !== 23 && o.classID !== 137) continue;
      const skinned = o.classID === 137;
      const r = read(o);
      if (!r || r.m_Enabled === false || r.m_Enabled === 0) continue;
      const goId = String(r.m_GameObject && r.m_GameObject.m_PathID);
      const trEnt = trByGo.get(goId);
      if (!trEnt) continue;
      const goObj = byPid.get(goId) ? read(byPid.get(goId)) : null;
      let meshPid = null,
        extMeshPid = null;
      if (skinned) {
        const ref = r.m_Mesh;
        if (ref && Number(ref.m_PathID) && (ref.m_FileID | 0) === 0) meshPid = String(ref.m_PathID);
      }
      for (const c of (skinned ? [] : (goObj && goObj.m_Component) || [])) {
        const cr = c && (c.component || c.second || c);
        const pid = cr && cr.m_PathID != null ? String(cr.m_PathID) : null;
        const co = pid ? byPid.get(pid) : null;
        if (!co || co.classID !== 33) continue;
        const mf = read(co);
        const ref = mf && mf.m_Mesh;
        if (!ref || !Number(ref.m_PathID)) continue;
        const fid = ref.m_FileID | 0;
        const mp = String(ref.m_PathID);
        if (fid === 0) {
          meshPid = mp;
          continue;
        }
        const ex = (meta.externals || [])[fid - 1];
        if (ex && /unity default resources/i.test(ex.pathName || '') && UNITY_BUILTIN_MESH[mp]) meshPid = 'builtin:' + mp;
        else extMeshPid = mp;
      }
      if (!meshPid && !extMeshPid) continue;
      const m0 = r.m_Materials && (Array.isArray(r.m_Materials) ? r.m_Materials[0] : r.m_Materials);
      const nodePath = pathOf(trEnt.pid);
      const wPos = worldPos(trEnt.pid),
        wRot = worldRot(trEnt.pid),
        wScale = worldScale(trEnt.pid);
      const ap = findAnimParent(nodePath);
      let animParent = null,
        localPos = null,
        localRot = null,
        animLocalScale = null;
      if (ap) {
        const rel = relativeTransform(ap.nodePid, trEnt.pid);
        localPos = rel.pos;
        localRot = rel.rot;
        animLocalScale = rel.scale;
        animParent = ap.path;
      }
      meshNodes.push({
        kind: 'mesh',
        path: nodePath,
        name: (goObj && goObj.m_Name) || '',
        goActive: effectiveActive(trEnt.pid),
        meshPid,
        extMeshPid,
        matPid: m0 ? String(m0.m_PathID) : null,
        pos: wPos,
        rot: wRot,
        scale: wScale,
        animParent,
        localPos,
        localRot,
        animLocalScale,
        sortingOrder: r.m_SortingOrder | 0,
        sortingLayer: r.m_SortingLayer | 0,
        sortingFudge: Number(r.m_SortingFudge) || 0,
        skinned,
      });
    }
  }
  return meshNodes;
}

export function readTrailRenderers(ctx, h) {
  const { meta, read, noteFail } = ctx;
  const { trByGo, pathOf, effectiveActive } = h;
  const trailNodes = [];
  for (const o of meta.objects) {
    if (o.classID !== 96) continue;
    try {
      const r = read(o);
      if (!r || r.m_Enabled === false || r.m_Enabled === 0) continue;
      const goId = String(r.m_GameObject && r.m_GameObject.m_PathID);
      const trEnt = trByGo.get(goId);
      if (!trEnt) continue;
      const P = r.m_Parameters || {};
      const m0 = r.m_Materials && (Array.isArray(r.m_Materials) ? r.m_Materials[0] : r.m_Materials);
      trailNodes.push({
        kind: 'trail',
        path: pathOf(trEnt.pid),
        goActive: effectiveActive(trEnt.pid),
        matPid: m0 ? String(m0.m_PathID) : null,
        time: Number(r.m_Time) || 0,
        minVertexDistance: Number(r.m_MinVertexDistance) || 0,
        width: Number(P.widthMultiplier) || 1,
        widthKeys: (P.widthCurve && P.widthCurve.m_Curve) || [],
        gradient: P.colorGradient || null,
        alignment: P.alignment | 0,
        textureMode: P.textureMode | 0,
        emitting: r.m_Emitting !== false,
        sortingOrder: r.m_SortingOrder | 0,
        sortingLayer: r.m_SortingLayer | 0,
      });
    } catch (e) {
      noteFail('trailRenderer', e);
    }
  }
  return trailNodes;
}
