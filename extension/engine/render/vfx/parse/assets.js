import { unityMesh as MESH_MOD } from '../../../../unity/mesh.js';
import { UNITY_BUILTIN_MESH, builtinMeshGeo } from '../vfx-builtin-mesh.js';

export function readMeshAssets(ctx, bytes, systems, meshNodes) {
  const { meta, read, noteFail } = ctx;
  const meshByPid = {};
  const addBuiltin = (mp) => {
    if (typeof mp !== 'string' || !mp.startsWith('builtin:') || meshByPid[mp]) return;
    const g = builtinMeshGeo(UNITY_BUILTIN_MESH[mp.slice('builtin:'.length)]);
    if (g) meshByPid[mp] = g;
  };
  for (const s of systems) for (const mp of s.meshPids || []) addBuiltin(mp);
  for (const n of meshNodes) addBuiltin(n.meshPid);
  const MESH_SHAPE_TYPE = new Set([6, 13, 14]);
  for (const s of systems) {
    const sh = s.ps && s.ps.ShapeModule;
    if (!sh || !sh.enabled || !MESH_SHAPE_TYPE.has(sh.type | 0)) continue;
    const ref = sh.m_Mesh;
    const fid = ref ? ref.m_FileID | 0 : 0;
    if (!ref || fid === 0 || !Number(ref.m_PathID)) continue;
    const mp = String(ref.m_PathID);
    const ex = (meta.externals || [])[fid - 1];
    if (ex && /unity default resources/i.test(ex.pathName || '') && UNITY_BUILTIN_MESH[mp]) {
      s.shapeMeshPid = 'builtin:' + mp;
      addBuiltin(s.shapeMeshPid);
    }
  }
  if (MESH_MOD && MESH_MOD.extractMeshGeometry) {
    for (const o of meta.objects)
      if (o.classID === 43) {
        const mo = read(o);
        if (!mo) continue;
        try {
          const g = MESH_MOD.extractMeshGeometry(mo, meta.LE);
          if (g) {
            meshByPid[String(o.pathID)] = g;
          }
        } catch (e) {
          noteFail('mesh', e);
        }
      }
  }
  const shapeTexByPid = {};
  const wantTex = new Set();
  for (const s2 of systems) {
    const ref = s2.ps && s2.ps.ShapeModule && s2.ps.ShapeModule.m_Texture;
    if (ref && (ref.m_FileID | 0) === 0 && String(ref.m_PathID) !== '0') wantTex.add(String(ref.m_PathID));
  }
  if (wantTex.size && MESH_MOD && MESH_MOD.parseMaterialBundle) {
    try {
      const mb = MESH_MOD.parseMaterialBundle(bytes);
      for (const t of (mb && mb.textures) || []) if (t.rgba && wantTex.has(String(t.pathID))) shapeTexByPid[String(t.pathID)] = { width: t.width, height: t.height, rgba: t.rgba };
    } catch (e) {
      noteFail('shapeTexture', e);
    }
  }
  return { meshByPid, shapeTexByPid };
}
