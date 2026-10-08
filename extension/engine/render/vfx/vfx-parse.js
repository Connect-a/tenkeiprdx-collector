import { unityDecode } from '../../../unity/decode.js';
import { unitySf } from '../../../unity/unity-sf.js';
import { buildMaterialMap } from './vfx-material-entry.js';
import { matPropHash } from './parse/hash.js';
import { readHierarchy } from './parse/hierarchy.js';
import { readAnimatorGate, readClipRoles, readTransformAnims, readMatAnims, readCameraCurves, attachAnimNodes } from './parse/animation.js';
import { readClipEvents } from './parse/events.js';
import { readControllers } from './parse/controller.js';
import { readParticleSystems, readMeshRenderers, readTrailRenderers } from './parse/renderers.js';
import { readMeshAssets } from './parse/assets.js';
import { noteParseFailure } from './vfx-failures.js';

function parseVfx(bytes) {
  const readFail = new Map();
  const noteFail = (where, e) => {
    readFail.set(where, (readFail.get(where) || 0) + 1);
    noteParseFailure(where, e);
  };
  let parsed, meta;
  try {
    parsed = unityDecode.parseUnityFS(bytes);
    meta = unitySf.parseSerializedFile(parsed.data);
  } catch (e) {
    noteParseFailure('bundle', e);
    return null;
  }
  const read = (o) => {
    try {
      return unitySf.readObject(parsed.data, meta.LE, o);
    } catch (e) {
      noteFail('object', e);
      return null;
    }
  };
  const ctx = { parsed, meta, read, noteFail };
  const h = readHierarchy(ctx);
  const animGate = readAnimatorGate(ctx, h);
  const clipIsOff = readClipRoles(ctx);
  const clipEvents = readClipEvents(ctx, clipIsOff);
  const cameraCurves = readCameraCurves(ctx, h, clipIsOff);
  const transformAnims = readTransformAnims(ctx, h, clipIsOff);
  const matAnims = readMatAnims(ctx, h, clipIsOff);
  const findAnimParent = attachAnimNodes(h, transformAnims);
  const { cameras, modificator, audioClips, fbxSlots, post } = readControllers(ctx, h, cameraCurves);
  const systems = readParticleSystems(ctx, h, findAnimParent);
  const meshNodes = readMeshRenderers(ctx, h, findAnimParent);
  const trailNodes = readTrailRenderers(ctx, h);
  const { meshByPid, shapeTexByPid } = readMeshAssets(ctx, bytes, systems, meshNodes);
  const nodes = [...systems, ...meshNodes, ...trailNodes];
  return { nodes, systems, meshNodes, trailNodes, meshByPid, shapeTexByPid, animGate, transformAnims, matAnims, cameras, fbxSlots, post, clipEvents, modificator, audioClips, readErrors: [...readFail.entries()] };
}

function getSubEmitterLinks(systems) {
  const links = [];
  for (const s of systems || []) {
    const sub = s.ps && s.ps.SubModule;
    if (!sub || !sub.enabled || !Array.isArray(sub.subEmitters)) continue;
    for (const se of sub.subEmitters) {
      const type = se.type | 0;
      if (type !== 0 && type !== 2) continue;
      if (se.emitter && se.emitter.m_FileID) continue;
      const childObjPid = se.emitter ? String(se.emitter.m_PathID) : '0';
      if (childObjPid === '0') continue;
      links.push({ parent: s, childObjPid, type, prob: se.emitProbability == null ? 1 : se.emitProbability, inherit: se.properties | 0 });
    }
  }
  return links;
}

export { matPropHash };
export const vfxParse = { parseVfx, buildMaterialMap, getSubEmitterLinks, matPropHash };
