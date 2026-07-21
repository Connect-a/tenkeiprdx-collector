'use strict';
(function () {
  const D = () => globalThis.TP_DECODE;
  const SF = () => globalThis.TP_UNITYSF;
  const ANIM = () => globalThis.TP_ANIM;
  const crunch = () => globalThis.TP_CRUNCH;
  const TEX = () => globalThis.TP_TEXCODEC;

  const FMT_SIZE = { 0: 4, 1: 2, 2: 1, 3: 1, 4: 2, 5: 2, 6: 1, 7: 1, 8: 2, 9: 2, 10: 4, 11: 4 };
  const halfToFloat = (h) => { const s = (h & 0x8000) >> 15, e = (h & 0x7c00) >> 10, f = h & 0x03ff; if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024); if (e === 31) return f ? NaN : (s ? -1 : 1) * Infinity; return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024); };
  const readComponent = (dv, off, fmt, LE) => {
    switch (fmt) {
      case 0: return dv.getFloat32(off, LE);
      case 1: return halfToFloat(dv.getUint16(off, LE));
      case 2: return dv.getUint8(off) / 255;
      case 3: return Math.max(dv.getInt8(off) / 127, -1);
      case 4: return dv.getUint16(off, LE) / 65535;
      case 5: return Math.max(dv.getInt16(off, LE) / 32767, -1);
      case 6: return dv.getUint8(off);
      case 7: return dv.getInt8(off);
      case 8: return dv.getUint16(off, LE);
      case 9: return dv.getInt16(off, LE);
      case 10: return dv.getUint32(off, LE);
      case 11: return dv.getInt32(off, LE);
    }
    return 0;
  };

  const packedBitVectorBytes = (pv) => { const d = pv && pv.m_Data; if (!d) return new Uint8Array(0); if (d.__bytes) return d.__bytes; if (d instanceof Uint8Array) return d; return Uint8Array.from(d); };
  function unpackInts(pv) {
    const n = Number(pv.m_NumItems) || 0, bitSize = Number(pv.m_BitSize) || 0;
    const data = packedBitVectorBytes(pv), out = new Int32Array(n), mask = bitSize >= 32 ? 0xffffffff : ((1 << bitSize) - 1);
    let indexPos = 0, bitPos = 0;
    for (let i = 0; i < n; i++) {
      let bits = 0, val = 0;
      while (bits < bitSize) { val |= (data[indexPos] >> bitPos) << bits; const num = Math.min(bitSize - bits, 8 - bitPos); bitPos += num; bits += num; if (bitPos === 8) { indexPos++; bitPos = 0; } }
      out[i] = val & mask;
    }
    return out;
  }
  function unpackFloats(pv) {
    const n = Number(pv.m_NumItems) || 0, bitSize = Number(pv.m_BitSize) || 0;
    const range = Number(pv.m_Range) || 0, start = Number(pv.m_Start) || 0;
    const data = packedBitVectorBytes(pv), out = new Float32Array(n), maxv = (1 << bitSize) - 1;
    let indexPos = 0, bitPos = 0;
    for (let i = 0; i < n; i++) {
      let bits = 0, val = 0;
      while (bits < bitSize) { val |= (data[indexPos] >> bitPos) << bits; const num = Math.min(bitSize - bits, 8 - bitPos); bitPos += num; bits += num; if (bitPos === 8) { indexPos++; bitPos = 0; } }
      val &= maxv; out[i] = start + (maxv ? (val / maxv) : 0) * range;
    }
    return out;
  }
  function extractCompressedMeshGeometry(m) {
    const cm = m.m_CompressedMesh;
    if (!cm || !cm.m_Vertices || !Number(cm.m_Vertices.m_NumItems)) return null;
    const positions = unpackFloats(cm.m_Vertices);
    const vcount = positions.length / 3;
    if (!vcount) return null;
    let normals = null;
    if (cm.m_Normals && Number(cm.m_Normals.m_NumItems) > 0) {
      const nd = unpackFloats(cm.m_Normals), signs = unpackInts(cm.m_NormalSigns);
      normals = new Float32Array(vcount * 3);
      for (let i = 0; i < vcount; i++) {
        let x = nd[i * 2], y = nd[i * 2 + 1], z; const zsqr = 1 - x * x - y * y;
        if (zsqr >= 0) z = Math.sqrt(zsqr); else { const l = Math.hypot(x, y) || 1; x /= l; y /= l; z = 0; }
        if (signs[i] === 0) z = -z;
        normals[i * 3] = x; normals[i * 3 + 1] = y; normals[i * 3 + 2] = z;
      }
    }
    // tangent(2成分+符号)＝実ゲームToonの異方性ハイライト(Kajiya-Kay)に必要
    let tangents = null;
    if (cm.m_Tangents && Number(cm.m_Tangents.m_NumItems) > 0) {
      const td = unpackFloats(cm.m_Tangents), tsg = unpackInts(cm.m_TangentSigns);
      tangents = new Float32Array(vcount * 3);
      for (let i = 0; i < vcount; i++) {
        let x = td[i * 2], y = td[i * 2 + 1], z; const zsqr = 1 - x * x - y * y;
        if (zsqr >= 0) z = Math.sqrt(zsqr); else { const l = Math.hypot(x, y) || 1; x /= l; y /= l; z = 0; }
        if (tsg[i * 2] === 0) z = -z; // TangentSignsは2/頂点(z符号, w手性)。z符号のみ使用
        tangents[i * 3] = x; tangents[i * 3 + 1] = y; tangents[i * 3 + 2] = z;
      }
    }
    let uv = null;
    if (cm.m_UV && Number(cm.m_UV.m_NumItems) > 0) { const ud = unpackFloats(cm.m_UV); uv = new Float32Array(vcount * 2); for (let i = 0; i < vcount * 2 && i < ud.length; i++) uv[i] = ud[i]; }
    let indices = new Uint32Array(0);
    if (cm.m_Triangles && Number(cm.m_Triangles.m_NumItems) > 0) { const t = unpackInts(cm.m_Triangles); indices = Uint32Array.from(t, (x) => x >>> 0); }
    // skinning: Unityは4影響ぶんのweightを合計31にパック(最後は暗黙=31-sum)。BoneIndicesは影響ごとに1つ。
    let skinWeight = null, skinIndex = null;
    if (cm.m_Weights && Number(cm.m_Weights.m_NumItems) > 0) {
      const weights = unpackInts(cm.m_Weights), boneIdx = unpackInts(cm.m_BoneIndices);
      skinWeight = new Float32Array(vcount * 4); skinIndex = new Uint16Array(vcount * 4);
      let bonePos = 0, biPos = 0, j = 0, sum = 0;
      for (let i = 0; i < weights.length && bonePos < vcount; i++) {
        skinWeight[bonePos * 4 + j] = weights[i] / 31; skinIndex[bonePos * 4 + j] = boneIdx[biPos++] | 0; j++; sum += weights[i];
        if (sum >= 31) { for (; j < 4; j++) { skinWeight[bonePos * 4 + j] = 0; skinIndex[bonePos * 4 + j] = 0; } bonePos++; j = 0; sum = 0; }
        else if (j === 3) { skinWeight[bonePos * 4 + 3] = (31 - sum) / 31; skinIndex[bonePos * 4 + 3] = boneIdx[biPos++] | 0; bonePos++; j = 0; sum = 0; }
      }
    }
    const use16 = Number(m.m_IndexFormat) === 0;
    let submeshes = (m.m_SubMeshes || []).map((sm) => ({ indexStart: use16 ? (Number(sm.firstByte) >> 1) : (Number(sm.firstByte) >> 2), indexCount: Number(sm.indexCount), topology: Number(sm.topology) }));
    const sumIdx = submeshes.reduce((a, s) => a + s.indexCount, 0);
    if (!submeshes.length || sumIdx !== indices.length || submeshes.some((s) => s.indexStart < 0 || s.indexStart + s.indexCount > indices.length)) submeshes = [{ indexStart: 0, indexCount: indices.length, topology: 0 }];
    const shared = meshBonesAndShapes(m, vcount);
    if (!skinIndex && shared.rigidSkin) { skinWeight = shared.rigidSkin.w; skinIndex = shared.rigidSkin.i; }
    return { name: m.m_Name, vertexCount: vcount, positions, normals, tangents, colors: null, uv, indices, submeshes, skinWeight, skinIndex, bindposes: shared.bindposes, boneNameHashes: shared.boneNameHashes, blendShapes: shared.blendShapes };
  }

  function meshBonesAndShapes(m, vcount) {
    let bindposes = null;
    if (Array.isArray(m.m_BindPose) && m.m_BindPose.length) bindposes = m.m_BindPose.map((mx) => [mx.e00, mx.e01, mx.e02, mx.e03, mx.e10, mx.e11, mx.e12, mx.e13, mx.e20, mx.e21, mx.e22, mx.e23, mx.e30, mx.e31, mx.e32, mx.e33]);
    const boneNameHashes = Array.isArray(m.m_BoneNameHashes) ? m.m_BoneNameHashes.map((x) => (typeof x === 'bigint' ? Number(x) : x)) : null;
    let blendShapes = null;
    const sh = m.m_Shapes, shVerts = sh && (sh.vertices || sh.m_Vertices), shFrames = sh && (sh.shapes || sh.m_Shapes), shChans = sh && (sh.channels || sh.m_Channels);
    if (shVerts && shFrames && shChans && shChans.length) {
      blendShapes = [];
      for (const ch of shChans) {
        const name = ch.name || ch.m_Name || '';
        const fi = Number(ch.frameIndex != null ? ch.frameIndex : ch.m_FrameIndex) || 0;
        const fc = Number(ch.frameCount != null ? ch.frameCount : ch.m_FrameCount) || 1;
        const frame = shFrames[fi + fc - 1]; if (!frame) continue;
        const first = Number(frame.firstVertex != null ? frame.firstVertex : frame.m_FirstVertex) || 0;
        const cnt = Number(frame.vertexCount != null ? frame.vertexCount : frame.m_VertexCount) || 0;
        const deltas = new Float32Array(vcount * 3);
        for (let i = 0; i < cnt; i++) { const bv = shVerts[first + i]; if (!bv) continue; const vtx = bv.vertex || bv.m_Vertex || {}; const idx = Number(bv.index != null ? bv.index : bv.m_Index) || 0; if (idx < 0 || idx >= vcount) continue; deltas[idx * 3] += Number(vtx.x) || 0; deltas[idx * 3 + 1] += Number(vtx.y) || 0; deltas[idx * 3 + 2] += Number(vtx.z) || 0; }
        blendShapes.push({ name, deltas });
      }
      if (!blendShapes.length) blendShapes = null;
    }
    let rigidSkin = null;
    if (boneNameHashes && boneNameHashes.length >= 1 && bindposes && bindposes.length >= 1) {
      const w = new Float32Array(vcount * 4), ii = new Uint16Array(vcount * 4);
      for (let v = 0; v < vcount; v++) w[v * 4] = 1;
      rigidSkin = { w, i: ii };
    }
    return { bindposes, boneNameHashes, blendShapes, rigidSkin };
  }

  function extractMeshGeometry(m, LE) {
    if (Number(m.m_MeshCompression || 0) !== 0) return extractCompressedMeshGeometry(m);
    const vd = m.m_VertexData;
    if (!vd) return null;
    const vcount = Number(vd.m_VertexCount);
    const channels = (vd.m_Channels || []).map((c) => ({ stream: c.stream & 0xff, offset: c.offset & 0xff, format: c.format & 0xff, dimension: c.dimension & 0x0f }));
    const streamCount = Math.max(...channels.map((c) => c.stream)) + 1;
    const streams = [];
    let soff = 0;
    for (let s = 0; s < streamCount; s++) {
      let stride = 0;
      for (const c of channels) if (c.stream === s && c.dimension > 0) stride += c.dimension * FMT_SIZE[c.format];
      streams.push({ offset: soff, stride });
      soff += vcount * stride;
      soff = (soff + 15) & ~15;
    }
    const data = vd.m_DataSize && vd.m_DataSize.__bytes;
    if (!data) return null;
    const ddv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const readChannel = (chn) => {
      const c = channels[chn];
      if (!c || c.dimension === 0) return null;
      const st = streams[c.stream];
      const csz = FMT_SIZE[c.format];
      const dim = c.dimension;
      const out = new Float32Array(vcount * dim);
      for (let v = 0; v < vcount; v++) {
        const base = st.offset + c.offset + st.stride * v;
        for (let d = 0; d < dim; d++) out[v * dim + d] = readComponent(ddv, base + csz * d, c.format, LE);
      }
      return { arr: out, dim };
    };
    const pos = readChannel(0);
    const nrm = readChannel(1);
    const tan = readChannel(2); // tangent(実ゲームToonの異方性ハイライト用)
    const col = readChannel(3); // 頂点カラー(実ゲームToonのリムライトを in_COLOR0.r でゲート)
    const uv0 = readChannel(4);
    if (!pos) return null;

    const positions = pos.dim === 3 ? pos.arr : (() => { const o = new Float32Array(vcount * 3); for (let v = 0; v < vcount; v++) { o[v * 3] = pos.arr[v * pos.dim]; o[v * 3 + 1] = pos.arr[v * pos.dim + 1]; o[v * 3 + 2] = pos.arr[v * pos.dim + 2]; } return o; })();
    let normals = null;
    if (nrm) { normals = new Float32Array(vcount * 3); for (let v = 0; v < vcount; v++) { normals[v * 3] = nrm.arr[v * nrm.dim]; normals[v * 3 + 1] = nrm.arr[v * nrm.dim + 1]; normals[v * 3 + 2] = nrm.arr[v * nrm.dim + 2]; } }
    let tangents = null;
    if (tan && tan.dim >= 3) { tangents = new Float32Array(vcount * 3); for (let v = 0; v < vcount; v++) { tangents[v * 3] = tan.arr[v * tan.dim]; tangents[v * 3 + 1] = tan.arr[v * tan.dim + 1]; tangents[v * 3 + 2] = tan.arr[v * tan.dim + 2]; } }
    let colors = null;
    if (col && col.dim >= 1) { colors = new Float32Array(vcount * 4); for (let v = 0; v < vcount; v++) { colors[v * 4] = col.arr[v * col.dim]; colors[v * 4 + 1] = col.dim > 1 ? col.arr[v * col.dim + 1] : 0; colors[v * 4 + 2] = col.dim > 2 ? col.arr[v * col.dim + 2] : 0; colors[v * 4 + 3] = col.dim > 3 ? col.arr[v * col.dim + 3] : 1; } }
    let uv = null;
    if (uv0) { uv = new Float32Array(vcount * 2); for (let v = 0; v < vcount; v++) { uv[v * 2] = uv0.arr[v * uv0.dim]; uv[v * 2 + 1] = uv0.arr[v * uv0.dim + 1]; } }

    const use16 = Number(m.m_IndexFormat) === 0;
    const ibRaw = m.m_IndexBuffer;
    const ib = ibRaw && ibRaw.__bytes ? ibRaw.__bytes : Uint8Array.from(ibRaw || []);
    const idv = new DataView(ib.buffer, ib.byteOffset, ib.byteLength);
    const totalIdx = use16 ? (ib.byteLength >> 1) : (ib.byteLength >> 2);
    const indices = new Uint32Array(totalIdx);
    for (let i = 0; i < totalIdx; i++) indices[i] = use16 ? idv.getUint16(i * 2, LE) : idv.getUint32(i * 4, LE);

    const submeshes = (m.m_SubMeshes || []).map((sm) => {
      const fb = Number(sm.firstByte);
      return { indexStart: use16 ? (fb >> 1) : (fb >> 2), indexCount: Number(sm.indexCount), topology: Number(sm.topology) };
    });

    // skinning: BlendIndices(ch13) required; BlendWeight(ch12) optional.
    // Some meshes (e.g. mouth) store ONLY BlendIndices (1 bone per vertex, weight implicitly 1.0) with no
    // BlendWeight channel. Requiring both would drop these to the rigid fallback and bind them to bone 0
    // (BodyCenter) instead of their real bone (Head) -> the mouth detaches and floats during animation.
    const wCh = readChannel(12), iCh = readChannel(13);
    let skinWeight = null, skinIndex = null;
    if (iCh && iCh.dim >= 1) {
      skinWeight = new Float32Array(vcount * 4);
      skinIndex = new Uint16Array(vcount * 4);
      const wd = wCh ? wCh.dim : 0, id = iCh.dim;
      for (let v = 0; v < vcount; v++) {
        let wsum = 0;
        for (let k = 0; k < 4; k++) {
          skinIndex[v * 4 + k] = k < id ? (iCh.arr[v * id + k] | 0) : 0;
          const w = wCh ? (k < wd ? wCh.arr[v * wd + k] : 0) : (k === 0 ? 1 : 0);
          skinWeight[v * 4 + k] = w; wsum += w;
        }
        if (wsum < 1e-6) skinWeight[v * 4] = 1; // guard against all-zero weights
      }
    }
    const shared = meshBonesAndShapes(m, vcount);
    const bindposes = shared.bindposes, boneNameHashes = shared.boneNameHashes, blendShapes = shared.blendShapes;
    // rigid single-bone meshes (e.g. mouth) carry no BlendWeight/BlendIndices channels: bind every vertex to bone 0
    if (!skinIndex && shared.rigidSkin) { skinWeight = shared.rigidSkin.w; skinIndex = shared.rigidSkin.i; }

    return { name: m.m_Name, vertexCount: vcount, positions, normals, tangents, colors, uv, indices, submeshes, skinWeight, skinIndex, bindposes, boneNameHashes, blendShapes };
  }

  function readMaterialObj(sf, LE, o) {
    const mat = SF().readObject(sf, LE, o);
    const props = mat.m_SavedProperties || {};
    const tex = props.m_TexEnvs || mat.m_TexEnvs || [];
    let mainTexPathID = null, firstTexPathID = null, colorTexPathID = null, shadowTexPathID = null, maskTexPathID = null;
    for (const pair of tex) {
      const name = pair[0]; const env = pair[1];
      const pid = env && env.m_Texture ? String(env.m_Texture.m_PathID) : null;
      if (pid && pid !== '0') {
        if (firstTexPathID === null) firstTexPathID = pid;
        if (name === '_ColorTex') colorTexPathID = pid;
        else if (name === '_ShadowTex') shadowTexPathID = pid;
        else if (name === '_MaskTex') maskTexPathID = pid;
        else if (name === '_MainTex' || name === '_BaseMap') mainTexPathID = pid;
      }
    }
    const colors = props.m_Colors || [];
    const floats = props.m_Floats || [];
    const getColor = (n) => { const p = colors.find((x) => x[0] === n); if (!p) return null; const v = p[1] || {}; return [v.r != null ? v.r : (v.x != null ? v.x : 1), v.g != null ? v.g : (v.y != null ? v.y : 1), v.b != null ? v.b : (v.z != null ? v.z : 1), v.a != null ? v.a : (v.w != null ? v.w : 1)]; };
    const getF = (n) => { const p = floats.find((x) => x[0] === n); return p ? Number(p[1]) : null; };
    const dstBlend = getF('_DstBlend');
    const toon = {
      colorTexPathID, shadowTexPathID, maskTexPathID,
      outlineColor: getColor('_OutlineColor') || [0.35, 0.30, 0.26, 1],
      outlineThickness: getF('_OutlineThickness'),
      shadowColorWeight: getF('_ShadowColorWeight'),
      shadowBorderThreshold: getF('_ShadowBorderThreshold'),
      shadowBorderGradation: getF('_ShadowBorderGradation'),
      rimLightThreshold: getF('_RimLightThreshold'),
      highlightColor: getColor('_HighlightColor'),
      highlightIntensity: getF('_HighlightIntensity'),
      highlightPosition: getF('_HighlightPosition'),
      highlightSharpness: getF('_HighlightSharpness'),
      highlightNoiseIntensity: getF('_HighlightNoiseIntensity'),
      fresnel: getF('_Fresnel'),
    };
    return {
      pathID: o.pathID, name: mat.m_Name,
      mainTexPathID: mainTexPathID || colorTexPathID || firstTexPathID,
      color: getColor('_BaseColor') || getColor('_Color'),
      transparent: dstBlend != null && dstBlend !== 0,
      toon,
    };
  }

  function openCab(bytes) {
    const parsed = D().parseUnityFS(bytes);
    const cab = parsed.nodes.find((n) => !n.path.endsWith('.resource') && !n.path.endsWith('.resS'));
    if (!cab) return null;
    const sf = parsed.data.subarray(cab.off, cab.off + cab.sz);
    return { parsed, sf, sfp: SF().parseSerializedFile(sf) };
  }

  function baseMotionMap(list) {
    const m = {};
    for (const e of (list || [])) { if (e && e.motionName) m[e.motionName] = (e.values || []).map(Number); }
    return m;
  }

  function parseModelBundle(bytes) {
    const co = openCab(bytes);
    if (!co) return { meshes: [], renderers: [], materials: [], transforms: [], gameObjects: {}, avatar: null, clips: [], actionPoints: null, fbx: null };
    const { parsed, sf, sfp } = co;
    const meshes = [];
    const renderers = [];
    const materials = [];
    const transforms = [];
    const gameObjects = {};
    let avatar = null;
    const clips = [];
    let fbxActionPointRefs = null;
    let fbx = null;
    for (const o of sfp.objects) {
      if (o.classID === 114) {
        try {
          const mb = SF().readObject(sf, sfp.LE, o);
          const looksFbx = mb && (Array.isArray(mb.actionPoints) || Array.isArray(mb.blinkRelatedBlendShapes) || Array.isArray(mb.attachments) || mb.faceRenderer);
          if (looksFbx && !fbx) {
            if (Array.isArray(mb.actionPoints) && mb.actionPoints.length) fbxActionPointRefs = mb.actionPoints;
            const pid = (pp) => (pp && pp.m_PathID != null) ? String(pp.m_PathID) : null;
            fbx = {
              attachmentSmrPathIDs: (mb.attachments || []).map(pid).filter(Boolean),
              blinkBlendShapes: (mb.blinkRelatedBlendShapes || []).map(Number),
              faceSmrPathID: pid(mb.faceRenderer),
              mouthSmrPathID: pid(mb.mouthRenderer),
              eyebrowsSmrPathID: pid(mb.eyebrowsRenderer),
              defaultMouthId: Number(mb.defaultMouthId) || 0, // 0なら既定=6(defaultMouthIndex)
              mouthMaterialOverride: Number(mb.mouthMaterialOverride) || 0, // enum None=0/Fanged=1/SharkTeeth=2/Secondary=3
              // MotionBaseValues: motionName=クリップ名, values[i]=チャネルiのweight0-100(各モーションのrest表情)。
              faceBaseValues: baseMotionMap(mb.faceRendererBaseValues),
              browBaseValues: baseMotionMap(mb.eyebrowsRendererBaseValues),
            };
          }
        } catch (e) {}
        continue;
      }
      if (o.classID === 90) {
        try { const av = SF().readObject(sf, sfp.LE, o); avatar = ANIM() ? ANIM().parseAvatar(av) : null; } catch (e) {}
        continue;
      } else if (o.classID === 74) {
        try { const clipObj = SF().readObject(sf, sfp.LE, o); const dec = ANIM() ? ANIM().decodeClipObj(clipObj) : null; if (dec) clips.push(dec); } catch (e) {}
        continue;
      }
      if (o.classID === 43) {
        try {
          const m = SF().readObject(sf, sfp.LE, o);
          const geo = extractMeshGeometry(m, sfp.LE);
          if (geo) { geo.pathID = o.pathID; meshes.push(geo); }
        } catch (e) {}
      } else if (o.classID === 137) {
        try {
          const r = SF().readObject(sf, sfp.LE, o);
          const mats = (r.m_Materials || []).map((pp) => String(pp.m_PathID));
          const bones = (r.m_Bones || []).map((pp) => String(pp.m_PathID));
          renderers.push({ smrPathID: String(o.pathID), meshPathID: r.m_Mesh ? String(r.m_Mesh.m_PathID) : null, materialPathIDs: mats, bones, rootBonePathID: r.m_RootBone ? String(r.m_RootBone.m_PathID) : null });
        } catch (e) {}
      } else if (o.classID === 21) {
        try { materials.push(readMaterialObj(sf, sfp.LE, o)); } catch (e) {}
      } else if (o.classID === 4) {
        try {
          const t = SF().readObject(sf, sfp.LE, o);
          const p = t.m_LocalPosition || {}, q = t.m_LocalRotation || {}, s = t.m_LocalScale || {};
          transforms.push({
            pathID: o.pathID,
            pos: [p.x || 0, p.y || 0, p.z || 0],
            rot: [q.x || 0, q.y || 0, q.z || 0, q.w != null ? q.w : 1],
            scale: [s.x != null ? s.x : 1, s.y != null ? s.y : 1, s.z != null ? s.z : 1],
            fatherPathID: t.m_Father ? String(t.m_Father.m_PathID) : '0',
            gameObjectPathID: t.m_GameObject ? String(t.m_GameObject.m_PathID) : null,
          });
        } catch (e) {}
      } else if (o.classID === 1) {
        try { const g = SF().readObject(sf, sfp.LE, o); gameObjects[o.pathID] = g.m_Name; } catch (e) {}
      }
    }
    // ★武器/装備の装着アンカー＝FBXController.actionPoints（骨ではなくルート直下の静的Transform。
    // GO名wp_1/wp_2等でslotにマッチ）。ゲームはTryEquip(slot,equipment)でここに装着する。
    let actionPoints = null;
    if (fbxActionPointRefs) {
      const trByPath = new Map(transforms.map((t) => [String(t.pathID), t]));
      actionPoints = {};
      for (const ref of fbxActionPointRefs) {
        const t = trByPath.get(String(ref.m_PathID)); if (!t) continue;
        const nm = gameObjects[t.gameObjectPathID]; if (!nm) continue;
        actionPoints[nm] = { pos: t.pos, rot: t.rot, scale: t.scale };
      }
    }
    return { meshes, renderers, materials, transforms, gameObjects, avatar, clips, actionPoints, fbx };
  }

  function decodeTexture(tex, parsed) {
    const fmt = Number(tex.m_TextureFormat);
    const w = Number(tex.m_Width), h = Number(tex.m_Height);
    let bytes = tex['image data'] && tex['image data'].__bytes;
    if ((!bytes || bytes.length === 0) && tex.m_StreamData && tex.m_StreamData.path) {
      const sd = tex.m_StreamData;
      const off = Number(sd.offset), size = Number(sd.size);
      const base = String(sd.path).split('/').pop();
      const node = parsed.nodes.find((n) => n.path === sd.path || n.path.endsWith(base));
      if (node) bytes = parsed.data.subarray(node.off + off, node.off + off + size);
    }
    if (!bytes || !bytes.length) return { width: w, height: h, format: fmt, error: 'no-image-bytes' };
    let rgba = null;
    try {
      if (fmt === 29) { const cm = crunch(); if (cm && cm.canDecodeCrunched && cm.canDecodeCrunched() && cm.decodeLevel0RGBA) { const d = cm.decodeLevel0RGBA(bytes); return { width: d.width, height: d.height, format: fmt, rgba: d.rgbaBytes }; } return { width: w, height: h, format: fmt, error: 'crunch-unavailable' }; }
      else if (fmt === 12) rgba = TEX().decodeDxt5Rgba(bytes, w, h);
      else if (fmt === 2) rgba = TEX().decodeArgb4444(bytes, w, h);
      else if (fmt === 13) rgba = TEX().decodeRgba4444(bytes, w, h);
      else if (fmt === 4) { if (bytes.length >= w * h * 4) rgba = bytes.subarray(0, w * h * 4); }
      else return { width: w, height: h, format: fmt, error: 'unsupported-format-' + fmt };
    } catch (e) { return { width: w, height: h, format: fmt, error: e && e.message ? e.message : String(e) }; }
    if (!rgba) return { width: w, height: h, format: fmt, error: 'decode-failed' };
    return { width: w, height: h, format: fmt, rgba };
  }

  function parseMaterialBundle(bytes) {
    const co = openCab(bytes);
    if (!co) return { materials: [], textures: [] };
    const { parsed, sf, sfp } = co;
    const materials = [];
    const textures = [];
    for (const o of sfp.objects) {
      if (o.classID === 21) {
        try { materials.push(readMaterialObj(sf, sfp.LE, o)); } catch (e) {}
      } else if (o.classID === 28) {
        try {
          const tx = SF().readObject(sf, sfp.LE, o);
          const dec = decodeTexture(tx, parsed);
          textures.push({ pathID: o.pathID, name: tx.m_Name, width: dec.width, height: dec.height, format: dec.format, rgba: dec.rgba || null, error: dec.error || null });
        } catch (e) { textures.push({ pathID: o.pathID, error: e && e.message ? e.message : String(e) }); }
      }
    }
    return { materials, textures };
  }

  function decodePrimaryTexture(bytes) {
    const co = openCab(bytes);
    if (!co) return null;
    const { parsed, sf, sfp } = co;
    let best = null, bestArea = -1;
    for (const o of sfp.objects) {
      if (o.classID !== 28) continue;
      try {
        const tx = SF().readObject(sf, sfp.LE, o);
        const area = Number(tx.m_Width) * Number(tx.m_Height);
        if (area > bestArea) { bestArea = area; best = tx; }
      } catch (e) {}
    }
    if (!best) return null;
    const dec = decodeTexture(best, parsed);
    return { name: best.m_Name, width: dec.width, height: dec.height, format: dec.format, rgba: dec.rgba || null, error: dec.error || null };
  }

  function decodeTextureRgba(bytes, parsed) {
    parsed = parsed || D().parseUnityFS(bytes);
    const cm = crunch();
    try { const t = decodePrimaryTexture(bytes); if (t && t.rgba) return { rgba: t.rgba, width: t.width, height: t.height }; } catch (e) {}
    if (cm && cm.findInBuffer && cm.decodeLevel0RGBA) {
      const cands = cm.findInBuffer(parsed.data, 2);
      if (cands && cands.length) { try { const dec = cm.decodeLevel0RGBA(parsed.data.subarray(cands[0].offset)); return { rgba: dec.rgbaBytes, width: dec.width, height: dec.height }; } catch (e) {} }
    }
    const canDecode = !!(cm && cm.canDecodeCrunched && cm.canDecodeCrunched());
    const tr = TEX().extractTexture2DPreviews(parsed.data, canDecode ? cm : null, 1, { flipY: false });
    if (tr.previews.length) { const c = tr.previews[0].canvas; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height); return { rgba: new Uint8Array(d.data.buffer.slice(0)), width: c.width, height: c.height }; }
    return null;
  }

  // 共有の口アトラス(mouthmaterials)から4プリセットを取り出す。FBXController.mouthMaterialOverride
  // (enum None=0/Fanged=1/SharkTeeth=2/Secondary=3)でキャラ毎に選択。全て同一5x5グリッド(mouthMap共有)。
  function parseMouthAtlas(bytes) {
    if (!bytes) return null;
    const mb = parseMaterialBundle(bytes);
    const byName = (n) => { const t = (mb.textures || []).find((x) => x.name === n && x.rgba); return t ? { rgba: t.rgba, width: t.width, height: t.height } : null; };
    const variants = {
      0: byName('mouth_texture_preset'),
      1: byName('mouth_fanged_texture_preset'),
      2: byName('mouth_shark_texture_preset'),
      3: byName('mouth_secondary_texture_preset'),
    };
    const def = variants[0];
    if (!def) return null;
    return { rgba: def.rgba, width: def.width, height: def.height, variants };
  }

  function extractSpineInputs(bytes) {
    const d = D(); if (!bytes || !d) return null;
    const parsed = d.parseUnityFS(bytes);
    const tas = d.extractTextAssets ? (d.extractTextAssets(bytes) || []) : [];
    const a = tas.find((t) => /\.atlas$/i.test(t.name));
    const s = tas.find((t) => /\.skel(?:\.bytes)?$/i.test(t.name));
    if (!a || !a.bytes || !a.bytes.length || !s || !s.bytes || !s.bytes.length) return null;
    const texture = decodeTextureRgba(bytes, parsed);
    if (!texture || !texture.rgba) return null;
    return { atlasBytes: a.bytes, skeletonBytes: s.bytes, skeletonPath: s.name, texture };
  }

  globalThis.TP_MESH = { parseModelBundle, parseMaterialBundle, decodePrimaryTexture, decodeTextureRgba, parseMouthAtlas, extractSpineInputs, extractMeshGeometry };
})();
