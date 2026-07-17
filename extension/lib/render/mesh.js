'use strict';
(function () {
  const D = () => globalThis.TP_DECODE;
  const SF = () => globalThis.TP_UNITYSF;
  const ANIM = () => globalThis.TP_ANIM;
  const crunch = () => globalThis.TP_CRUNCH;
  const TEX = () => globalThis.TP_TEXCODEC; // テクスチャ展開はtexcodecに集約

  const FMT_SIZE = { 0: 4, 1: 2, 2: 1, 3: 1, 4: 2, 5: 2, 6: 1, 7: 1, 8: 2, 9: 2, 10: 4, 11: 4 };
  const half2float = (h) => { const s = (h & 0x8000) >> 15, e = (h & 0x7c00) >> 10, f = h & 0x03ff; if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024); if (e === 31) return f ? NaN : (s ? -1 : 1) * Infinity; return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024); };
  const readComp = (dv, off, fmt, LE) => {
    switch (fmt) {
      case 0: return dv.getFloat32(off, LE);
      case 1: return half2float(dv.getUint16(off, LE));
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

  function extractMeshGeometry(m, LE) {
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
        for (let d = 0; d < dim; d++) out[v * dim + d] = readComp(ddv, base + csz * d, c.format, LE);
      }
      return { arr: out, dim };
    };
    const pos = readChannel(0);
    const nrm = readChannel(1);
    const uv0 = readChannel(4);
    if (!pos) return null;

    const positions = pos.dim === 3 ? pos.arr : (() => { const o = new Float32Array(vcount * 3); for (let v = 0; v < vcount; v++) { o[v * 3] = pos.arr[v * pos.dim]; o[v * 3 + 1] = pos.arr[v * pos.dim + 1]; o[v * 3 + 2] = pos.arr[v * pos.dim + 2]; } return o; })();
    let normals = null;
    if (nrm) { normals = new Float32Array(vcount * 3); for (let v = 0; v < vcount; v++) { normals[v * 3] = nrm.arr[v * nrm.dim]; normals[v * 3 + 1] = nrm.arr[v * nrm.dim + 1]; normals[v * 3 + 2] = nrm.arr[v * nrm.dim + 2]; } }
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
    // bind poses (inverse bind matrices), row-major e00..e33
    let bindposes = null;
    if (Array.isArray(m.m_BindPose) && m.m_BindPose.length) {
      bindposes = m.m_BindPose.map((mx) => [mx.e00, mx.e01, mx.e02, mx.e03, mx.e10, mx.e11, mx.e12, mx.e13, mx.e20, mx.e21, mx.e22, mx.e23, mx.e30, mx.e31, mx.e32, mx.e33]);
    }
    const boneNameHashes = Array.isArray(m.m_BoneNameHashes) ? m.m_BoneNameHashes.map((x) => (typeof x === 'bigint' ? Number(x) : x)) : null;

    // blendshapes (m_Shapes): per-channel position deltas -> THREE morph targets. Expression channels are
    // split into _R/_L halves; keep each channel separate and let the UI apply matching halves together.
    let blendShapes = null;
    const sh = m.m_Shapes;
    const shVerts = sh && (sh.vertices || sh.m_Vertices);
    const shFrames = sh && (sh.shapes || sh.m_Shapes);
    const shChans = sh && (sh.channels || sh.m_Channels);
    if (shVerts && shFrames && shChans && shChans.length) {
      blendShapes = [];
      for (const ch of shChans) {
        const name = ch.name || ch.m_Name || '';
        const fi = Number(ch.frameIndex != null ? ch.frameIndex : ch.m_FrameIndex) || 0;
        const fc = Number(ch.frameCount != null ? ch.frameCount : ch.m_FrameCount) || 1;
        const frame = shFrames[fi + fc - 1]; // last frame = full weight
        if (!frame) continue;
        const first = Number(frame.firstVertex != null ? frame.firstVertex : frame.m_FirstVertex) || 0;
        const cnt = Number(frame.vertexCount != null ? frame.vertexCount : frame.m_VertexCount) || 0;
        const deltas = new Float32Array(vcount * 3);
        for (let i = 0; i < cnt; i++) {
          const bv = shVerts[first + i]; if (!bv) continue;
          const vtx = bv.vertex || bv.m_Vertex || {};
          const idx = Number(bv.index != null ? bv.index : bv.m_Index) || 0;
          if (idx < 0 || idx >= vcount) continue;
          deltas[idx * 3] += Number(vtx.x) || 0; deltas[idx * 3 + 1] += Number(vtx.y) || 0; deltas[idx * 3 + 2] += Number(vtx.z) || 0;
        }
        blendShapes.push({ name, deltas });
      }
      if (!blendShapes.length) blendShapes = null;
    }

    // rigid single-bone meshes (e.g. mouth) carry no BlendWeight/BlendIndices channels: bind every vertex to bone 0
    if (!skinIndex && boneNameHashes && boneNameHashes.length >= 1 && bindposes && bindposes.length >= 1) {
      skinWeight = new Float32Array(vcount * 4);
      skinIndex = new Uint16Array(vcount * 4);
      for (let v = 0; v < vcount; v++) skinWeight[v * 4] = 1;
    }

    return { name: m.m_Name, vertexCount: vcount, positions, normals, uv, indices, submeshes, skinWeight, skinIndex, bindposes, boneNameHashes, blendShapes };
  }

  function readMaterialObj(sf, LE, o) {
    const mat = SF().readObject(sf, LE, o);
    const props = mat.m_SavedProperties || {};
    const tex = props.m_TexEnvs || mat.m_TexEnvs || [];
    let mainTexPathID = null, firstTexPathID = null, colorTexPathID = null;
    for (const pair of tex) {
      const name = pair[0]; const env = pair[1];
      const pid = env && env.m_Texture ? String(env.m_Texture.m_PathID) : null;
      if (pid && pid !== '0') {
        if (firstTexPathID === null) firstTexPathID = pid;
        if (name === '_ColorTex') colorTexPathID = pid;
        if (name === '_MainTex' || name === '_BaseMap') { mainTexPathID = pid; break; }
      }
    }
    const colors = props.m_Colors || [];
    const floats = props.m_Floats || [];
    const getCol = (n) => { const p = colors.find((x) => x[0] === n); if (!p) return null; const v = p[1] || {}; return [v.r != null ? v.r : (v.x != null ? v.x : 1), v.g != null ? v.g : (v.y != null ? v.y : 1), v.b != null ? v.b : (v.z != null ? v.z : 1), v.a != null ? v.a : (v.w != null ? v.w : 1)]; };
    const getF = (n) => { const p = floats.find((x) => x[0] === n); return p ? Number(p[1]) : null; };
    const dstBlend = getF('_DstBlend');
    return {
      pathID: o.pathID, name: mat.m_Name,
      mainTexPathID: mainTexPathID || colorTexPathID || firstTexPathID,
      color: getCol('_BaseColor') || getCol('_Color'),
      transparent: dstBlend != null && dstBlend !== 0,
    };
  }

  // UnityFS を開いて CAB(非.resource/.resS の SerializedFile)を取り出す共通前段。cab無しはnull。
  function openCab(bytes) {
    const parsed = D().parseUnityFS(bytes);
    const cab = parsed.nodes.find((n) => !n.path.endsWith('.resource') && !n.path.endsWith('.resS'));
    if (!cab) return null;
    const sf = parsed.data.subarray(cab.off, cab.off + cab.sz);
    return { parsed, sf, sfp: SF().parseSerializedFile(sf) };
  }

  function parseModelBundle(bytes) {
    const co = openCab(bytes);
    if (!co) return { meshes: [], renderers: [], materials: [], transforms: [], gameObjects: {}, avatar: null, clips: [] };
    const { parsed, sf, sfp } = co;
    const meshes = [];
    const renderers = [];
    const materials = [];
    const transforms = [];
    const gameObjects = {};
    let avatar = null;
    const clips = [];
    for (const o of sfp.objects) {
      if (o.classID === 90) {
        try { const av = SF().readObject(sf, sfp.LE, o); avatar = ANIM() ? ANIM().parseAvatar(av) : null; } catch (e) {}
        continue;
      } else if (o.classID === 74) {
        try { const co = SF().readObject(sf, sfp.LE, o); const dec = ANIM() ? ANIM().decodeClipObj(co) : null; if (dec) clips.push(dec); } catch (e) {}
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
          renderers.push({ meshPathID: r.m_Mesh ? String(r.m_Mesh.m_PathID) : null, materialPathIDs: mats, bones, rootBonePathID: r.m_RootBone ? String(r.m_RootBone.m_PathID) : null });
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
    return { meshes, renderers, materials, transforms, gameObjects, avatar, clips };
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
      if (fmt === 29) { const cm = crunch(); if (cm && cm.ready && cm.ready() && cm.decodeLevel0RGBA) { const d = cm.decodeLevel0RGBA(bytes); return { width: d.width, height: d.height, format: fmt, rgba: d.rgbaBytes }; } return { width: w, height: h, format: fmt, error: 'crunch-unavailable' }; }
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
        try {
          const mat = SF().readObject(sf, sfp.LE, o);
          const tex = (mat.m_SavedProperties && mat.m_SavedProperties.m_TexEnvs) || mat.m_TexEnvs || [];
          let mainTexPathID = null;
          let firstTexPathID = null;
          for (const pair of tex) {
            const name = pair[0]; const env = pair[1];
            const pid = env && env.m_Texture ? String(env.m_Texture.m_PathID) : null;
            if (pid && pid !== '0') {
              if (firstTexPathID === null) firstTexPathID = pid;
              if (name === '_MainTex' || name === '_BaseMap') { mainTexPathID = pid; break; }
            }
          }
          materials.push({ pathID: o.pathID, name: mat.m_Name, mainTexPathID: mainTexPathID || firstTexPathID });
        } catch (e) {}
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

  globalThis.TP_MESH = { parseModelBundle, parseMaterialBundle, decodePrimaryTexture };
})();
