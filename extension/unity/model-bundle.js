import { unityAnim as ANIM_MOD } from './anim.js';
import { openCab, attempt, readOne } from './bundle-cab.js';
import { extractMeshGeometry } from './mesh-geometry.js';
import { readMaterialObj } from './material.js';
function readMotionBinding(ac) {
  const pairs = ac && Array.isArray(ac.m_TOS) ? ac.m_TOS : null;
  if (!pairs) return null;
  const nameOf = new Map();
  for (const e of pairs) if (Array.isArray(e) && e.length === 2) nameOf.set(Number(e[0]), String(e[1]));
  const clipPathIDs = (Array.isArray(ac.m_AnimationClips) ? ac.m_AnimationClips : []).map((p) => (p && p.m_PathID != null ? String(p.m_PathID) : null));
  const out = [];
  for (const layer of ac.m_Controller && ac.m_Controller.m_StateMachineArray ? ac.m_Controller.m_StateMachineArray : []) {
    for (const s of (layer.data || layer).m_StateConstantArray || []) {
      const d = s.data || s;
      const state = nameOf.get(Number(d.m_NameID));
      const bt = (d.m_BlendTreeConstantArray || [])[0];
      const node = bt && ((bt.data || bt).m_NodeArray || [])[0];
      const clipID = node ? Number((node.data || node).m_ClipID) : NaN;
      const pathID = Number.isInteger(clipID) ? clipPathIDs[clipID] : null;
      if (state && pathID) out.push([state, pathID]);
    }
  }
  return out.length ? out : null;
}

function baseMotionMap(list) {
  const m = {};
  for (const e of list || []) {
    if (e && e.motionName) m[e.motionName] = (e.values || []).map(Number);
  }
  return m;
}

function avatarOfSkin(transforms, renderers, animators, avatarByPid) {
  if (!animators.length) return null;
  const trByPid = new Map(transforms.map((t) => [String(t.pathID), t]));
  const trByGo = new Map(transforms.map((t) => [String(t.gameObjectPathID), t]));
  const rootOf = (pid) => {
    let t = trByPid.get(String(pid));
    for (let i = 0; t && i < 128; i++) {
      const up = trByPid.get(String(t.fatherPathID));
      if (!up) break;
      t = up;
    }
    return t ? String(t.pathID) : null;
  };
  const skinRoots = new Set();
  for (const r of renderers) {
    const own = r.goPathID ? trByGo.get(String(r.goPathID)) : null;
    const b = (own && own.pathID) || r.rootBonePathID || (r.bones || [])[0];
    const rt = b ? rootOf(b) : null;
    if (rt) skinRoots.add(rt);
  }
  if (!skinRoots.size) return null;
  for (const an of animators) {
    const av = avatarByPid.get(String(an.avatar));
    if (!av || !an.go) continue;
    const t = trByGo.get(String(an.go));
    const rt = t ? rootOf(t.pathID) : null;
    if (rt && skinRoots.has(rt)) return av;
  }
  return null;
}

export function parseModelBundle(bytes) {
  const co = openCab(bytes);
  if (!co) return { meshes: [], renderers: [], materials: [], transforms: [], gameObjects: {}, avatar: null, clips: [], actionPoints: null, fbx: null };
  const { sf, sfp } = co;
  const meshes = [];
  const renderers = [];
  const materials = [];
  const transforms = [];
  const gameObjects = {};
  const goActive = {};
  const meshFilterByGO = {};
  const meshRenderers = [];
  let avatar = null;
  const avatarByPid = new Map();
  const animators = [];
  const clips = [];
  let fbxActionPointRefs = null;
  let fbx = null;
  let motionTransition = null;
  let motionBinding = null;
  const clipNameByPathID = new Map();
  for (const o of sfp.objects) {
    if (o.classID === 91 && motionTransition == null) {
      const ac = readOne(sf, sfp.LE, o);
      const sm = ac && ac.m_Controller && (ac.m_Controller.m_StateMachineArray || [])[0];
      const smd = sm && (sm.data || sm);
      const tr = smd && (smd.m_AnyStateTransitionConstantArray || [])[0];
      const td = tr && (tr.data || tr);
      const d = td && Number(td.m_TransitionDuration);
      if (Number.isFinite(d) && d >= 0 && d < 5) motionTransition = d;
      motionBinding = readMotionBinding(ac);
    }
    if (o.classID === 114) {
      const mb = readOne(sf, sfp.LE, o);
      const looksFbx = mb && (Array.isArray(mb.actionPoints) || Array.isArray(mb.blinkRelatedBlendShapes) || Array.isArray(mb.attachments) || mb.faceRenderer);
      if (looksFbx && !fbx) {
        if (Array.isArray(mb.actionPoints) && mb.actionPoints.length) fbxActionPointRefs = mb.actionPoints;
        const pid = (pp) => (pp && pp.m_PathID != null ? String(pp.m_PathID) : null);
        fbx = {
          attachmentSmrPathIDs: (mb.attachments || []).map(pid).filter(Boolean),
          blinkBlendShapes: (mb.blinkRelatedBlendShapes || []).map(Number),
          faceSmrPathID: pid(mb.faceRenderer),
          mouthSmrPathID: pid(mb.mouthRenderer),
          eyebrowsSmrPathID: pid(mb.eyebrowsRenderer),
          defaultMouthId: Number(mb.defaultMouthId) || 0,
          mouthMaterialOverride: Number(mb.mouthMaterialOverride) || 0,
          faceBaseValues: baseMotionMap(mb.faceRendererBaseValues),
          browBaseValues: baseMotionMap(mb.eyebrowsRendererBaseValues),
        };
      }
      continue;
    }
    if (o.classID === 90) {
      const av = readOne(sf, sfp.LE, o);
      if (av) {
        avatar = ANIM_MOD ? attempt(() => ANIM_MOD.parseAvatar(av)) : null;
        if (avatar) avatarByPid.set(String(o.pathID), avatar);
      }
      continue;
    } else if (o.classID === 74) {
      const clipObj = readOne(sf, sfp.LE, o);
      if (clipObj && clipObj.m_Name != null) clipNameByPathID.set(String(o.pathID), String(clipObj.m_Name));
      const dec = clipObj && ANIM_MOD ? attempt(() => ANIM_MOD.decodeClipObj(clipObj)) : null;
      if (dec) clips.push(dec);
      continue;
    }
    if (o.classID === 43) {
      const m = readOne(sf, sfp.LE, o);
      const geo = m ? attempt(() => extractMeshGeometry(m, sfp.LE)) : null;
      if (geo) {
        geo.pathID = o.pathID;
        meshes.push(geo);
      }
    } else if (o.classID === 137) {
      const r = readOne(sf, sfp.LE, o);
      if (!r) continue;
      renderers.push({
        smrPathID: String(o.pathID),
        meshPathID: r.m_Mesh ? String(r.m_Mesh.m_PathID) : null,
        materialPathIDs: (r.m_Materials || []).map((pp) => String(pp.m_PathID)),
        bones: (r.m_Bones || []).map((pp) => String(pp.m_PathID)),
        rootBonePathID: r.m_RootBone ? String(r.m_RootBone.m_PathID) : null,
        goPathID: r.m_GameObject ? String(r.m_GameObject.m_PathID) : null,
        enabled: r.m_Enabled === undefined ? 1 : Number(r.m_Enabled),
      });
    } else if (o.classID === 95) {
      const an = readOne(sf, sfp.LE, o);
      const apid = an && an.m_Avatar && an.m_Avatar.m_PathID;
      if (apid) animators.push({ go: an.m_GameObject ? String(an.m_GameObject.m_PathID) : null, avatar: String(apid) });
    } else if (o.classID === 33) {
      const mf = readOne(sf, sfp.LE, o);
      const go = mf && mf.m_GameObject && String(mf.m_GameObject.m_PathID);
      const mp = mf && mf.m_Mesh && String(mf.m_Mesh.m_PathID);
      if (go && mp) meshFilterByGO[go] = mp;
    } else if (o.classID === 23) {
      const mr = readOne(sf, sfp.LE, o);
      if (!mr) continue;
      meshRenderers.push({ pathID: String(o.pathID), go: mr.m_GameObject ? String(mr.m_GameObject.m_PathID) : null, materialPathIDs: (mr.m_Materials || []).map((pp) => String(pp.m_PathID)) });
    } else if (o.classID === 21) {
      const mat = attempt(() => readMaterialObj(sf, sfp.LE, o));
      if (mat) materials.push(mat);
    } else if (o.classID === 4) {
      const t = readOne(sf, sfp.LE, o);
      if (!t) continue;
      const p = t.m_LocalPosition || {},
        q = t.m_LocalRotation || {},
        s = t.m_LocalScale || {};
      transforms.push({
        pathID: o.pathID,
        pos: [p.x || 0, p.y || 0, p.z || 0],
        rot: [q.x || 0, q.y || 0, q.z || 0, q.w != null ? q.w : 1],
        scale: [s.x != null ? s.x : 1, s.y != null ? s.y : 1, s.z != null ? s.z : 1],
        fatherPathID: t.m_Father ? String(t.m_Father.m_PathID) : '0',
        gameObjectPathID: t.m_GameObject ? String(t.m_GameObject.m_PathID) : null,
      });
    } else if (o.classID === 1) {
      const g = readOne(sf, sfp.LE, o);
      if (!g) continue;
      gameObjects[o.pathID] = g.m_Name;
      goActive[o.pathID] = g.m_IsActive === undefined ? true : !!g.m_IsActive;
    }
  }
  for (const mr of meshRenderers) {
    const mp = mr.go ? meshFilterByGO[mr.go] : null;
    if (!mp) continue;
    if (renderers.some((r) => String(r.meshPathID) === mp)) continue;
    renderers.push({ smrPathID: mr.pathID, meshPathID: mp, materialPathIDs: mr.materialPathIDs, bones: [], rootBonePathID: null });
  }
  if (avatarByPid.size > 1) {
    const picked = avatarOfSkin(transforms, renderers, animators, avatarByPid);
    if (picked) avatar = picked;
  }
  let actionPoints = null;
  if (fbxActionPointRefs) {
    const trByPath = new Map(transforms.map((t) => [String(t.pathID), t]));
    actionPoints = {};
    for (const ref of fbxActionPointRefs) {
      const t = trByPath.get(String(ref.m_PathID));
      if (!t) continue;
      const nm = gameObjects[t.gameObjectPathID];
      if (!nm) continue;
      actionPoints[nm] = { pos: t.pos, rot: t.rot, scale: t.scale };
    }
  }
  const motionClips = {};
  for (const [state, pathID] of motionBinding || []) {
    const name = clipNameByPathID.get(pathID);
    if (name) motionClips[state] = name;
  }
  return { meshes, renderers, materials, transforms, gameObjects, goActive, avatar, clips, actionPoints, fbx, motionTransition, motionClips: Object.keys(motionClips).length ? motionClips : null };
}
