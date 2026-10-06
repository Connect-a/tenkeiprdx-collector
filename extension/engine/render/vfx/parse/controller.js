import { unitySf } from '../../../../unity/unity-sf.js';

function readScriptClasses(s) {
  const { meta, noteFail, rstr } = s;
  const clsByScript = new Map();
  for (const o of meta.objects) {
    if (o.classID !== 115) continue;
    try {
      let p = o.byteStart,
        s;
      [s, p] = rstr(p);
      p += 20;
      [s, p] = rstr(p);
      clsByScript.set(String(o.pathID), s);
    } catch (e) {
      noteFail('scriptName', e);
    }
  }
  return clsByScript;
}

function readNoiseProfiles(s) {
  const { parsed, meta, noteFail, dv, clsByScript } = s;
  const noiseByPid = new Map();
  for (const o of meta.objects) {
    if (o.classID !== 114) continue;
    try {
      const asSO = clsByScript.get(String(dv.getBigInt64(o.byteStart + 4, true))) === 'NoiseSettings';
      const asMB = clsByScript.get(String(dv.getBigInt64(o.byteStart + 20, true))) === 'NoiseSettings';
      if (!asSO && !asMB) continue;
      let p = o.byteStart + (asSO ? 16 : 32);
      const nameLen = dv.getInt32(p - 4, true);
      if (nameLen > 0) p += (nameLen + 3) & ~3;
      const readChans = () => {
        const n = dv.getInt32(p, true);
        p += 4;
        if (n < 0 || n > 64) throw new Error('n');
        const a = [];
        for (let i = 0; i < n; i++) {
          const ax = [];
          for (let k = 0; k < 3; k++) {
            ax.push({ f: dv.getFloat32(p, true), a: dv.getFloat32(p + 4, true), c: parsed.data[p + 8] !== 0 });
            p += 12;
          }
          a.push(ax);
        }
        return a;
      };
      const pos = readChans();
      const rot = readChans();
      if (o.byteStart + o.byteSize - p !== 0) continue;
      noiseByPid.set(String(o.pathID), { pos, rot });
    } catch (e) {
      noteFail('perlinNoise', e);
    }
  }
  return noiseByPid;
}

const AUDIO_CLIP_BYTES = 24;

function readVfxController(s) {
  const { parsed, meta, noteFail, dv, rstr, clsByScript } = s;
  for (const o of meta.objects) {
    if (o.classID !== 114) continue;
    try {
      if (clsByScript.get(String(dv.getBigInt64(o.byteStart + 20, true))) !== 'VFXController') continue;
      const modificator = dv.getInt32(o.byteStart + o.byteSize - 4, true);
      let p = rstr(o.byteStart + 28)[1] + 12;
      for (let k = 0; k < 4; k++) {
        const n = dv.getInt32(p, true);
        if (n < 0 || n > 4096) throw new Error('pptrs');
        p += 4 + 12 * n;
      }
      p += 12 + 8;
      const n = dv.getInt32(p, true);
      p += 4;
      if (n < 0 || o.byteStart + o.byteSize - (p + n * AUDIO_CLIP_BYTES) !== 4) throw new Error('audioClips');
      const ownCab = ((parsed.nodes || []).find((nd) => !/\.res(ource|S)$/.test(nd.path)) || {}).path || '';
      const audioClips = [];
      for (let i = 0; i < n; i++, p += AUDIO_CLIP_BYTES) {
        const fileID = dv.getInt32(p, true);
        const pathID = String(dv.getBigInt64(p + 4, true));
        const ext = fileID > 0 ? meta.externals[fileID - 1] : null;
        const cab = fileID === 0 ? ownCab : ext ? String(ext.pathName).split('/').pop() : '';
        audioClips.push({
          ref: pathID !== '0' && cab ? { cab: cab.toLowerCase(), pathID } : null,
          playOnAwake: parsed.data[p + 12] !== 0,
          looped: parsed.data[p + 13] !== 0,
          exclusive: parsed.data[p + 14] !== 0,
        });
      }
      return { modificator, audioClips };
    } catch (e) {
      noteFail('vfxController', e);
    }
  }
  return { modificator: null, audioClips: [] };
}

function readShakes(s, noiseByPid) {
  const { meta, noteFail, trByPath, trByGo, pathOf, cameraCurves, dv, clsByScript } = s;
  const shakeByGo = new Map();
  for (const o of meta.objects) {
    if (o.classID !== 114) continue;
    try {
      if (clsByScript.get(String(dv.getBigInt64(o.byteStart + 20, true))) !== 'CinemachineBasicMultiChannelPerlin') continue;
      let p = o.byteStart + 32;
      const npFid = dv.getInt32(p, true);
      const npPid = String(dv.getBigInt64(p + 4, true));
      p += 24;
      const amp = dv.getFloat32(p, true),
        frq = dv.getFloat32(p + 4, true);
      if (o.byteStart + o.byteSize - (p + 8 + 12) !== 0) continue;
      const prof = npFid === 0 ? noiseByPid.get(npPid) : null;
      if (!prof) continue;
      const off = { x: dv.getFloat32(p + 8, true), y: dv.getFloat32(p + 12, true), z: dv.getFloat32(p + 16, true) };
      let cur = String(dv.getBigInt64(o.byteStart + 4, true)),
        guard = 0;
      const ownTr = trByGo.get(cur);
      const cc = cameraCurves.get(ownTr ? pathOf(ownTr.pid) : '') || null;
      const ampKeys = (cc && cc.ampKeys) || null;
      const freqKeys = (cc && cc.freqKeys) || null;
      if (!ampKeys && !(amp > 0)) continue;
      if (!freqKeys && !(frq > 0)) continue;
      while (cur && cur !== '0' && guard++ < 8) {
        shakeByGo.set(cur, { amp, freq: frq, ampKeys, freqKeys, curveDur: (cc && cc.dur) || 0, pos: prof.pos, rot: prof.rot, offsets: off });
        const te = trByGo.get(cur);
        const tr = te && trByPath.get(te.pid);
        const father = tr && String(tr.m_Father && tr.m_Father.m_PathID);
        if (!father || father === '0') break;
        const ftr = trByPath.get(father);
        cur = ftr ? String(ftr.m_GameObject && ftr.m_GameObject.m_PathID) : '0';
      }
    } catch (e) {
      noteFail('perlinParent', e);
    }
  }
  return shakeByGo;
}

function readComposers(s) {
  const { meta, read, noteFail, trByPath, trByGo, dv, clsByScript } = s;
  const aimByGo = new Map();
  for (const o of meta.objects) {
    if (o.classID !== 114) continue;
    try {
      if (clsByScript.get(String(dv.getBigInt64(o.byteStart + 20, true))) !== 'CinemachineComposer') continue;
      const b = read(o);
      if (!b || b.m_ScreenX == null) continue;
      const v3 = b.m_TrackedObjectOffset || {};
      const aim = {
        offset: { x: v3.x || 0, y: v3.y || 0, z: v3.z || 0 },
        screenX: b.m_ScreenX || 0,
        screenY: b.m_ScreenY || 0,
        deadW: b.m_DeadZoneWidth || 0,
        deadH: b.m_DeadZoneHeight || 0,
        softW: b.m_SoftZoneWidth || 0,
        softH: b.m_SoftZoneHeight || 0,
        biasX: b.m_BiasX || 0,
        biasY: b.m_BiasY || 0,
        hDamp: b.m_HorizontalDamping || 0,
        vDamp: b.m_VerticalDamping || 0,
      };
      let cur = String(dv.getBigInt64(o.byteStart + 4, true)),
        guard = 0;
      while (cur && cur !== '0' && guard++ < 8) {
        if (!aimByGo.has(cur)) aimByGo.set(cur, aim);
        const te = trByGo.get(cur);
        const tr = te && trByPath.get(te.pid);
        const father = tr && String(tr.m_Father && tr.m_Father.m_PathID);
        if (!father || father === '0') break;
        const ftr = trByPath.get(father);
        cur = ftr ? String(ftr.m_GameObject && ftr.m_GameObject.m_PathID) : '0';
      }
    } catch (e) {
      noteFail('composerParent', e);
    }
  }
  return aimByGo;
}

function readBlendLists(s) {
  const { parsed, meta, noteFail, trByGo, pathOf, dv, clsByScript } = s;
  const blendLists = [];
  for (const o of meta.objects) {
    if (o.classID !== 114) continue;
    try {
      if (clsByScript.get(String(dv.getBigInt64(o.byteStart + 20, true))) !== 'CinemachineBlendListCamera') continue;
      let p = o.byteStart + 32;
      const nEx = dv.getInt32(p, true);
      p += 4;
      if (nEx < 0 || nEx > 64) continue;
      for (let i = 0; i < nEx; i++) {
        const l = dv.getInt32(p, true);
        if (l < 0 || l > 4096) throw new Error('s');
        p = (p + 4 + l + 3) & ~3;
      }
      const nLock = dv.getInt32(p, true);
      p += 4;
      if (nLock < 0 || nLock > 64) continue;
      p += 4 * nLock + 4;
      const priority = dv.getInt32(p, true);
      p += 8 + 24;
      const loop = parsed.data[p + 1] !== 0;
      p += 8;
      const nChild = dv.getInt32(p, true);
      p += 4;
      if (nChild < 0 || nChild > 64) continue;
      p += 12 * nChild;
      const nIns = dv.getInt32(p, true);
      p += 4;
      if (nIns < 0 || nIns > 64) continue;
      const instructions = [];
      for (let i = 0; i < nIns; i++) {
        const vcPid = String(dv.getBigInt64(p + 4, true));
        p += 12;
        const hold = dv.getFloat32(p, true);
        p += 4;
        const blendStyle = dv.getInt32(p, true);
        p += 4;
        const blendTime = dv.getFloat32(p, true);
        p += 4;
        const nk = dv.getInt32(p, true);
        p += 4;
        if (nk < 0 || nk > 256) throw new Error('k');
        const blendCurve = [];
        for (let k = 0; k < nk; k++) {
          const kb = p + k * 28;
          blendCurve.push({ time: dv.getFloat32(kb, true), value: dv.getFloat32(kb + 4, true), inSlope: dv.getFloat32(kb + 8, true), outSlope: dv.getFloat32(kb + 12, true) });
        }
        p += nk * 28 + 12;
        instructions.push({ vcamMb: vcPid, hold, blendStyle, blendTime, blendCurve });
      }
      if (o.byteStart + o.byteSize - p !== 0) continue;
      const goId = String(dv.getBigInt64(o.byteStart + 4, true));
      const trEnt = trByGo.get(goId);
      blendLists.push({ path: trEnt ? pathOf(trEnt.pid) : '', priority, loop, instructions });
    } catch (e) {
      noteFail('blendList', e);
    }
  }
  return blendLists;
}

function readVirtualCameras(s, aimByGo, shakeByGo) {
  const { meta, noteFail, trByPath, trByGo, worldPos, worldRot, goName, pathOf, localChain, cameraCurves, dv, rstr, clsByScript } = s;
  const out = [];
  for (const o of meta.objects) {
    if (o.classID !== 114) continue;
    try {
      if (clsByScript.get(String(dv.getBigInt64(o.byteStart + 20, true))) !== 'CinemachineVirtualCamera') continue;
      let p = o.byteStart + 32;
      const nEx = dv.getInt32(p, true);
      p += 4;
      if (nEx < 0 || nEx > 64) continue;
      for (let i = 0; i < nEx; i++) p = rstr(p)[1];
      const nLock = dv.getInt32(p, true);
      p += 4;
      if (nLock < 0 || nLock > 64) continue;
      p += 4 * nLock + 4;
      const priority = dv.getInt32(p, true);
      p += 8;
      const lookAtPid = String(dv.getBigInt64(p + 4, true));
      p += 24;
      const fov = dv.getFloat32(p, true),
        near = dv.getFloat32(p + 8, true),
        far = dv.getFloat32(p + 12, true),
        dutch = dv.getFloat32(p + 16, true);
      if (!(fov >= 1 && fov <= 179 && near > 0 && far > near)) continue;
      const goId = String(dv.getBigInt64(o.byteStart + 4, true));
      const trEnt = trByGo.get(goId);
      if (!trEnt) continue;
      const lookTr = lookAtPid !== '0' ? trByPath.get(lookAtPid) : null;
      const camPath = pathOf(trEnt.pid);
      const lensCurves = cameraCurves.get(camPath) || null;
      out.push({
        mbPid: String(o.pathID),
        path: camPath,
        fovKeys: (lensCurves && lensCurves.fovKeys) || null,
        dutchKeys: (lensCurves && lensCurves.dutchKeys) || null,
        lensCurveDur: (lensCurves && lensCurves.dur) || 0,
        name: goName.get(goId) || '',
        pos: worldPos(trEnt.pid),
        rot: worldRot(trEnt.pid),
        chain: localChain(trEnt.pid),
        fov,
        near,
        far,
        dutch,
        priority,
        lookAt: lookTr ? worldPos(lookAtPid) : null,
        lookAtPath: lookTr ? pathOf(lookAtPid) : null,
        lookAtRot: lookTr ? worldRot(lookAtPid) : null,
        aim: lookTr ? aimByGo.get(goId) || null : null,
        shake: shakeByGo.get(goId) || null,
      });
    } catch (e) {
      noteFail('vcam', e);
    }
  }
  return out;
}

function readFbxSlots(s) {
  const { parsed, meta, noteFail, trByGo, worldPos, worldScale, localScale, worldRot, goName, pathOf, dv, clsByScript } = s;
  const fbxSlots = [];
  for (const o of meta.objects) {
    if (o.classID !== 114) continue;
    try {
      if (clsByScript.get(String(dv.getBigInt64(o.byteStart + 20, true))) !== 'VFXFBXControllerSlot') continue;
      let p = o.byteStart + 32;
      const rs = () => {
        const l = dv.getInt32(p, true);
        if (l < 0 || l > 8192) throw new Error('s');
        const s = new TextDecoder().decode(parsed.data.subarray(p + 4, p + 4 + l));
        p = (p + 4 + l + 3) & ~3;
        return s;
      };
      p += 4;
      const modelId = rs();
      const modelCfg = rs();
      const weaponCfg = rs();
      if (o.byteStart + o.byteSize - p !== 0) continue;
      const goId = String(dv.getBigInt64(o.byteStart + 4, true));
      const trEnt = trByGo.get(goId);
      fbxSlots.push({
        path: trEnt ? pathOf(trEnt.pid) : '',
        name: goName.get(goId) || '',
        modelId,
        modelCfg,
        weaponCfg,
        pos: trEnt ? worldPos(trEnt.pid) : { x: 0, y: 0, z: 0 },
        rot: trEnt ? worldRot(trEnt.pid) : { x: 0, y: 0, z: 0, w: 1 },
        scale: trEnt ? worldScale(trEnt.pid) : { x: 1, y: 1, z: 1 },
    localScale: trEnt ? localScale(trEnt.pid) : { x: 1, y: 1, z: 1 },
      });
    } catch (e) {
      noteFail('fbxSlot', e);
    }
  }
  return fbxSlots;
}

function readPost(s) {
  const { parsed, meta, noteFail, trByGo, pathOf, dv, clsByScript } = s;
  const post = { bloom: null, chromatic: null, dof: null, dofSolo: null };
  const volumeOwnerOfComponent = new Map();
  try {
    const profileComponents = new Map();
    for (const o of meta.objects) {
      if (o.classID !== 114) continue;
      const cls = clsByScript.get(String(dv.getBigInt64(o.byteStart + 20, true)));
      if (cls !== 'VolumeProfile') continue;
      const p = unitySf.readObject(parsed.data, meta.LE, o);
      if (p && Array.isArray(p.components)) profileComponents.set(String(o.pathID), p.components.map((c) => String(c.m_PathID)));
    }
    for (const o of meta.objects) {
      if (o.classID !== 114) continue;
      const cls = clsByScript.get(String(dv.getBigInt64(o.byteStart + 20, true)));
      if (cls !== 'Volume') continue;
      const v = unitySf.readObject(parsed.data, meta.LE, o);
      const prof = v && v.sharedProfile && String(v.sharedProfile.m_PathID);
      const comps = prof ? profileComponents.get(prof) : null;
      if (!comps) continue;
      const trEnt = trByGo.get(String(v.m_GameObject && v.m_GameObject.m_PathID));
      const vp = trEnt ? pathOf(trEnt.pid) : '';
      for (const c of comps) if (!volumeOwnerOfComponent.has(c)) volumeOwnerOfComponent.set(c, vp);
    }
  } catch (e) {
    noteFail('volumeOwner', e);
  }
  for (const o of meta.objects) {
    if (o.classID !== 114) continue;
    try {
      if (clsByScript.get(String(dv.getBigInt64(o.byteStart + 20, true))) !== 'DepthOfField') continue;
      const v = unitySf.readObject(parsed.data, meta.LE, o);
      if (!v || v.active === 0) continue;
      const num = (x) => (x && typeof x === 'object' ? Number(x.m_Value) : Number(x));
      const d = { mode: num(v.mode), start: num(v.gaussianStart), end: num(v.gaussianEnd), maxRadius: num(v.gaussianMaxRadius), path: '' };
      if (d.mode !== 1 || !Number.isFinite(d.start) || !Number.isFinite(d.end) || !Number.isFinite(d.maxRadius)) continue;
      if (d.end - d.start <= 1e-5 || d.maxRadius <= 0) continue;
      const owner = volumeOwnerOfComponent.get(String(o.pathID));
      if (owner) d.path = owner;
      if (!post.dof || d.start > post.dof.start) post.dof = d;
      if (!post.dofSolo || d.start < post.dofSolo.start) post.dofSolo = d;
    } catch (e) {
      noteFail('dof', e);
    }
  }
  if (post.dof && post.dofSolo && post.dof.start === post.dofSolo.start) post.dofSolo = null;
  for (const o of meta.objects) {
    if (o.classID !== 114) continue;
    try {
      const cls = clsByScript.get(String(dv.getBigInt64(o.byteStart + 20, true)));
      if (cls !== 'Bloom' && cls !== 'ChromaticAberration') continue;
      let p = o.byteStart + 28;
      const nameLen = dv.getInt32(p, true);
      if (nameLen < 0 || nameLen > 256) continue;
      p += 4 + ((nameLen + 3) & ~3);
      const active = parsed.data[p] !== 0;
      if (!active) continue;
      p += 4;
      const pair = (i) => ({ on: dv.getInt32(p + 8 + i * 8, true) !== 0, v: dv.getFloat32(p + 12 + i * 8, true) });
      if (cls === 'Bloom') {
        const th = pair(0),
          it = pair(1),
          sc = pair(2);
        if (th.v >= 0 && th.v <= 10 && it.v >= 0 && it.v <= 100 && sc.v >= 0 && sc.v <= 1) post.bloom = { threshold: th.v, intensity: it.v, scatter: sc.v };
      } else {
        const it = pair(0);
        if (it.v >= 0 && it.v <= 1) post.chromatic = { intensity: it.v };
      }
    } catch (e) {
      noteFail('chromatic', e);
    }
  }
  return post;
}

export function readControllers(ctx, h, cameraCurves) {
  const { parsed, noteFail } = ctx;
  let dv;
  try {
    dv = new DataView(parsed.data.buffer, parsed.data.byteOffset, parsed.data.byteLength);
  } catch (e) {
    noteFail('dataView', e);
    return { cameras: [], modificator: null, audioClips: [], fbxSlots: [], post: null };
  }
  const rstr = (p) => {
    const l = dv.getInt32(p, true);
    if (l < 0 || l > 4096) throw new Error('str');
    return [new TextDecoder().decode(parsed.data.subarray(p + 4, p + 4 + l)), (p + 4 + l + 3) & ~3];
  };
  const s = { ...ctx, ...h, cameraCurves, dv, rstr };
  s.clsByScript = readScriptClasses(s);
  const noiseByPid = readNoiseProfiles(s);
  const { modificator, audioClips } = readVfxController(s);
  const shakeByGo = readShakes(s, noiseByPid);
  const aimByGo = readComposers(s);
  const blendLists = readBlendLists(s);
  const out = readVirtualCameras(s, aimByGo, shakeByGo);
  const fbxSlots = readFbxSlots(s);
  const post = readPost(s);
  out.sort((a, b) => b.priority - a.priority);
  const byMb = new Map(out.map((c) => [c.mbPid, c]));
  for (const bl of blendLists) {
    bl.steps = bl.instructions.map((ins) => ({ cam: byMb.get(ins.vcamMb) || null, hold: ins.hold, blendStyle: ins.blendStyle, blendTime: ins.blendTime, blendCurve: ins.blendCurve })).filter((s) => s.cam);
    for (const s of bl.steps) s.cam.inBlendList = bl.path;
  }
  out.blendLists = blendLists.filter((b) => b.steps && b.steps.length);
  return { cameras: out, modificator, audioClips, fbxSlots, post };
}
