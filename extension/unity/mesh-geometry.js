const FMT_SIZE = { 0: 4, 1: 2, 2: 1, 3: 1, 4: 2, 5: 2, 6: 1, 7: 1, 8: 2, 9: 2, 10: 4, 11: 4 };
const halfToFloat = (h) => {
  const s = (h & 0x8000) >> 15,
    e = (h & 0x7c00) >> 10,
    f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : (s ? -1 : 1) * Infinity;
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
};
const readComponent = (dv, off, fmt, LE) => {
  switch (fmt) {
    case 0:
      return dv.getFloat32(off, LE);
    case 1:
      return halfToFloat(dv.getUint16(off, LE));
    case 2:
      return dv.getUint8(off) / 255;
    case 3:
      return Math.max(dv.getInt8(off) / 127, -1);
    case 4:
      return dv.getUint16(off, LE) / 65535;
    case 5:
      return Math.max(dv.getInt16(off, LE) / 32767, -1);
    case 6:
      return dv.getUint8(off);
    case 7:
      return dv.getInt8(off);
    case 8:
      return dv.getUint16(off, LE);
    case 9:
      return dv.getInt16(off, LE);
    case 10:
      return dv.getUint32(off, LE);
    case 11:
      return dv.getInt32(off, LE);
  }
  return 0;
};

const packedBitVectorBytes = (pv) => {
  const d = pv && pv.m_Data;
  if (!d) return new Uint8Array(0);
  if (d.__bytes) return d.__bytes;
  if (d instanceof Uint8Array) return d;
  return Uint8Array.from(d);
};
function unpackInts(pv) {
  const n = Number(pv.m_NumItems) || 0,
    bitSize = Number(pv.m_BitSize) || 0;
  const data = packedBitVectorBytes(pv),
    out = new Int32Array(n),
    mask = bitSize >= 32 ? 0xffffffff : (1 << bitSize) - 1;
  let indexPos = 0,
    bitPos = 0;
  for (let i = 0; i < n; i++) {
    let bits = 0,
      val = 0;
    while (bits < bitSize) {
      val |= (data[indexPos] >> bitPos) << bits;
      const num = Math.min(bitSize - bits, 8 - bitPos);
      bitPos += num;
      bits += num;
      if (bitPos === 8) {
        indexPos++;
        bitPos = 0;
      }
    }
    out[i] = val & mask;
  }
  return out;
}
function unpackFloats(pv) {
  const n = Number(pv.m_NumItems) || 0,
    bitSize = Number(pv.m_BitSize) || 0;
  const range = Number(pv.m_Range) || 0,
    start = Number(pv.m_Start) || 0;
  const data = packedBitVectorBytes(pv),
    out = new Float32Array(n),
    maxv = (1 << bitSize) - 1;
  let indexPos = 0,
    bitPos = 0;
  for (let i = 0; i < n; i++) {
    let bits = 0,
      val = 0;
    while (bits < bitSize) {
      val |= (data[indexPos] >> bitPos) << bits;
      const num = Math.min(bitSize - bits, 8 - bitPos);
      bitPos += num;
      bits += num;
      if (bitPos === 8) {
        indexPos++;
        bitPos = 0;
      }
    }
    val &= maxv;
    out[i] = start + (maxv ? val / maxv : 0) * range;
  }
  return out;
}
function buildBinormals(normals, tangents, vcount, handedness) {
  if (!normals || !tangents) return null;
  const out = new Float32Array(vcount * 3);
  for (let i = 0; i < vcount; i++) {
    const nx = normals[i * 3],
      ny = normals[i * 3 + 1],
      nz = normals[i * 3 + 2];
    const tx = tangents[i * 3],
      ty = tangents[i * 3 + 1],
      tz = tangents[i * 3 + 2];
    const w = handedness(i);
    let x = (ny * tz - nz * ty) * w,
      y = (nz * tx - nx * tz) * w,
      z = (nx * ty - ny * tx) * w;
    const l = Math.hypot(x, y, z) || 1;
    out[i * 3] = x / l;
    out[i * 3 + 1] = y / l;
    out[i * 3 + 2] = z / l;
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
    const nd = unpackFloats(cm.m_Normals),
      signs = unpackInts(cm.m_NormalSigns);
    normals = new Float32Array(vcount * 3);
    for (let i = 0; i < vcount; i++) {
      let x = nd[i * 2],
        y = nd[i * 2 + 1],
        z;
      const zsqr = 1 - x * x - y * y;
      if (zsqr >= 0) z = Math.sqrt(zsqr);
      else {
        const l = Math.hypot(x, y) || 1;
        x /= l;
        y /= l;
        z = 0;
      }
      if (signs[i] === 0) z = -z;
      normals[i * 3] = x;
      normals[i * 3 + 1] = y;
      normals[i * 3 + 2] = z;
    }
  }
  let tangents = null,
    binormals = null,
    tangentW = null,
    tanSigns = null;
  if (cm.m_Tangents && Number(cm.m_Tangents.m_NumItems) > 0) {
    const td = unpackFloats(cm.m_Tangents),
      tsg = unpackInts(cm.m_TangentSigns);
    tanSigns = tsg;
    tangents = new Float32Array(vcount * 3);
    for (let i = 0; i < vcount; i++) {
      let x = td[i * 2],
        y = td[i * 2 + 1],
        z;
      const zsqr = 1 - x * x - y * y;
      if (zsqr >= 0) z = Math.sqrt(zsqr);
      else {
        const l = Math.hypot(x, y) || 1;
        x /= l;
        y /= l;
        z = 0;
      }
      if (tsg[i * 2] === 0) z = -z;
      tangents[i * 3] = x;
      tangents[i * 3 + 1] = y;
      tangents[i * 3 + 2] = z;
    }
    tangentW = new Float32Array(vcount);
    for (let i = 0; i < vcount; i++) tangentW[i] = tanSigns[i * 2 + 1] === 0 ? -1 : 1;
    binormals = buildBinormals(normals, tangents, vcount, (i) => tangentW[i]);
  }
  let uv = null;
  if (cm.m_UV && Number(cm.m_UV.m_NumItems) > 0) {
    const ud = unpackFloats(cm.m_UV);
    uv = new Float32Array(vcount * 2);
    for (let i = 0; i < vcount * 2 && i < ud.length; i++) uv[i] = ud[i];
  }
  let colors = null;
  if (cm.m_Colors && Number(cm.m_Colors.m_NumItems) > 0) {
    const cd = unpackInts({ m_NumItems: Number(cm.m_Colors.m_NumItems) * 4, m_BitSize: Number(cm.m_Colors.m_BitSize) / 4, m_Data: cm.m_Colors.m_Data });
    colors = new Float32Array(vcount * 4);
    for (let i = 0; i < vcount * 4 && i < cd.length; i++) colors[i] = (cd[i] & 0xff) / 255;
  }
  let indices = new Uint32Array(0);
  if (cm.m_Triangles && Number(cm.m_Triangles.m_NumItems) > 0) {
    const t = unpackInts(cm.m_Triangles);
    indices = Uint32Array.from(t, (x) => x >>> 0);
  }
  let skinWeight = null,
    skinIndex = null;
  if (cm.m_Weights && Number(cm.m_Weights.m_NumItems) > 0) {
    const weights = unpackInts(cm.m_Weights),
      boneIdx = unpackInts(cm.m_BoneIndices);
    skinWeight = new Float32Array(vcount * 4);
    skinIndex = new Uint16Array(vcount * 4);
    let bonePos = 0,
      biPos = 0,
      j = 0,
      sum = 0;
    for (let i = 0; i < weights.length && bonePos < vcount; i++) {
      skinWeight[bonePos * 4 + j] = weights[i] / 31;
      skinIndex[bonePos * 4 + j] = boneIdx[biPos++] | 0;
      j++;
      sum += weights[i];
      if (sum >= 31) {
        for (; j < 4; j++) {
          skinWeight[bonePos * 4 + j] = 0;
          skinIndex[bonePos * 4 + j] = 0;
        }
        bonePos++;
        j = 0;
        sum = 0;
      } else if (j === 3) {
        skinWeight[bonePos * 4 + 3] = (31 - sum) / 31;
        skinIndex[bonePos * 4 + 3] = boneIdx[biPos++] | 0;
        bonePos++;
        j = 0;
        sum = 0;
      }
    }
  }
  const use16 = Number(m.m_IndexFormat) === 0;
  let submeshes = (m.m_SubMeshes || []).map((sm) => ({ indexStart: use16 ? Number(sm.firstByte) >> 1 : Number(sm.firstByte) >> 2, indexCount: Number(sm.indexCount), topology: Number(sm.topology) }));
  const sumIdx = submeshes.reduce((a, s) => a + s.indexCount, 0);
  if (!submeshes.length || sumIdx !== indices.length || submeshes.some((s) => s.indexStart < 0 || s.indexStart + s.indexCount > indices.length))
    submeshes = [{ indexStart: 0, indexCount: indices.length, topology: 0 }];
  const shared = meshBonesAndShapes(m, vcount);
  if (!skinIndex && shared.rigidSkin) {
    skinWeight = shared.rigidSkin.w;
    skinIndex = shared.rigidSkin.i;
  }
  return {
    name: m.m_Name,
    vertexCount: vcount,
    positions,
    normals,
    tangents,
    binormals,
    tangentW,
    colors,
    uv,
    indices,
    submeshes,
    skinWeight,
    skinIndex,
    bindposes: shared.bindposes,
    boneNameHashes: shared.boneNameHashes,
    blendShapes: shared.blendShapes,
  };
}

function meshBonesAndShapes(m, vcount) {
  let bindposes = null;
  if (Array.isArray(m.m_BindPose) && m.m_BindPose.length)
    bindposes = m.m_BindPose.map((mx) => [mx.e00, mx.e01, mx.e02, mx.e03, mx.e10, mx.e11, mx.e12, mx.e13, mx.e20, mx.e21, mx.e22, mx.e23, mx.e30, mx.e31, mx.e32, mx.e33]);
  const boneNameHashes = Array.isArray(m.m_BoneNameHashes) ? m.m_BoneNameHashes.map((x) => (typeof x === 'bigint' ? Number(x) : x)) : null;
  let blendShapes = null;
  const sh = m.m_Shapes,
    shVerts = sh && (sh.vertices || sh.m_Vertices),
    shFrames = sh && (sh.shapes || sh.m_Shapes),
    shChans = sh && (sh.channels || sh.m_Channels);
  if (shVerts && shFrames && shChans && shChans.length) {
    blendShapes = [];
    for (const ch of shChans) {
      const name = ch.name || ch.m_Name || '';
      const fi = Number(ch.frameIndex != null ? ch.frameIndex : ch.m_FrameIndex) || 0;
      const fc = Number(ch.frameCount != null ? ch.frameCount : ch.m_FrameCount) || 1;
      const frame = shFrames[fi + fc - 1];
      if (!frame) continue;
      const first = Number(frame.firstVertex != null ? frame.firstVertex : frame.m_FirstVertex) || 0;
      const cnt = Number(frame.vertexCount != null ? frame.vertexCount : frame.m_VertexCount) || 0;
      const deltas = new Float32Array(vcount * 3);
      for (let i = 0; i < cnt; i++) {
        const bv = shVerts[first + i];
        if (!bv) continue;
        const vtx = bv.vertex || bv.m_Vertex || {};
        const idx = Number(bv.index != null ? bv.index : bv.m_Index) || 0;
        if (idx < 0 || idx >= vcount) continue;
        deltas[idx * 3] += Number(vtx.x) || 0;
        deltas[idx * 3 + 1] += Number(vtx.y) || 0;
        deltas[idx * 3 + 2] += Number(vtx.z) || 0;
      }
      blendShapes.push({ name, deltas });
    }
    if (!blendShapes.length) blendShapes = null;
  }
  let rigidSkin = null;
  if (boneNameHashes && boneNameHashes.length >= 1 && bindposes && bindposes.length >= 1) {
    const w = new Float32Array(vcount * 4),
      ii = new Uint16Array(vcount * 4);
    for (let v = 0; v < vcount; v++) w[v * 4] = 1;
    rigidSkin = { w, i: ii };
  }
  return { bindposes, boneNameHashes, blendShapes, rigidSkin };
}

export function extractMeshGeometry(m, LE) {
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
  const tan = readChannel(2);
  const col = readChannel(3);
  const uv0 = readChannel(4);
  const uv1c = readChannel(5);
  if (!pos) return null;

  const positions =
    pos.dim === 3
      ? pos.arr
      : (() => {
          const o = new Float32Array(vcount * 3);
          for (let v = 0; v < vcount; v++) {
            o[v * 3] = pos.arr[v * pos.dim];
            o[v * 3 + 1] = pos.arr[v * pos.dim + 1];
            o[v * 3 + 2] = pos.arr[v * pos.dim + 2];
          }
          return o;
        })();
  let normals = null;
  if (nrm) {
    normals = new Float32Array(vcount * 3);
    for (let v = 0; v < vcount; v++) {
      normals[v * 3] = nrm.arr[v * nrm.dim];
      normals[v * 3 + 1] = nrm.arr[v * nrm.dim + 1];
      normals[v * 3 + 2] = nrm.arr[v * nrm.dim + 2];
    }
  }
  let tangents = null,
    binormals = null,
    tangentW = null;
  if (tan && tan.dim >= 3) {
    tangents = new Float32Array(vcount * 3);
    tangentW = new Float32Array(vcount);
    for (let v = 0; v < vcount; v++) {
      tangents[v * 3] = tan.arr[v * tan.dim];
      tangents[v * 3 + 1] = tan.arr[v * tan.dim + 1];
      tangents[v * 3 + 2] = tan.arr[v * tan.dim + 2];
      tangentW[v] = tan.dim >= 4 && tan.arr[v * tan.dim + 3] < 0 ? -1 : 1;
    }
    binormals = buildBinormals(normals, tangents, vcount, (v) => tangentW[v]);
  }
  let colors = null;
  if (col && col.dim >= 1) {
    colors = new Float32Array(vcount * 4);
    for (let v = 0; v < vcount; v++) {
      colors[v * 4] = col.arr[v * col.dim];
      colors[v * 4 + 1] = col.dim > 1 ? col.arr[v * col.dim + 1] : 0;
      colors[v * 4 + 2] = col.dim > 2 ? col.arr[v * col.dim + 2] : 0;
      colors[v * 4 + 3] = col.dim > 3 ? col.arr[v * col.dim + 3] : 1;
    }
  }
  let uv = null;
  if (uv0) {
    uv = new Float32Array(vcount * 2);
    for (let v = 0; v < vcount; v++) {
      uv[v * 2] = uv0.arr[v * uv0.dim];
      uv[v * 2 + 1] = uv0.arr[v * uv0.dim + 1];
    }
  }
  let uv1 = null;
  if (uv1c) {
    uv1 = new Float32Array(vcount * 2);
    for (let v = 0; v < vcount; v++) {
      uv1[v * 2] = uv1c.arr[v * uv1c.dim];
      uv1[v * 2 + 1] = uv1c.arr[v * uv1c.dim + 1];
    }
  }

  const use16 = Number(m.m_IndexFormat) === 0;
  const ibRaw = m.m_IndexBuffer;
  const ib = ibRaw && ibRaw.__bytes ? ibRaw.__bytes : Uint8Array.from(ibRaw || []);
  const idv = new DataView(ib.buffer, ib.byteOffset, ib.byteLength);
  const totalIdx = use16 ? ib.byteLength >> 1 : ib.byteLength >> 2;
  const indices = new Uint32Array(totalIdx);
  for (let i = 0; i < totalIdx; i++) indices[i] = use16 ? idv.getUint16(i * 2, LE) : idv.getUint32(i * 4, LE);

  const submeshes = (m.m_SubMeshes || []).map((sm) => {
    const fb = Number(sm.firstByte);
    return { indexStart: use16 ? fb >> 1 : fb >> 2, indexCount: Number(sm.indexCount), topology: Number(sm.topology) };
  });

  const wCh = readChannel(12),
    iCh = readChannel(13);
  let skinWeight = null,
    skinIndex = null;
  if (iCh && iCh.dim >= 1) {
    skinWeight = new Float32Array(vcount * 4);
    skinIndex = new Uint16Array(vcount * 4);
    const wd = wCh ? wCh.dim : 0,
      id = iCh.dim;
    for (let v = 0; v < vcount; v++) {
      let wsum = 0;
      for (let k = 0; k < 4; k++) {
        skinIndex[v * 4 + k] = k < id ? iCh.arr[v * id + k] | 0 : 0;
        const w = wCh ? (k < wd ? wCh.arr[v * wd + k] : 0) : k === 0 ? 1 : 0;
        skinWeight[v * 4 + k] = w;
        wsum += w;
      }
      if (wsum < 1e-6) skinWeight[v * 4] = 1;
    }
  }
  const shared = meshBonesAndShapes(m, vcount);
  const bindposes = shared.bindposes,
    boneNameHashes = shared.boneNameHashes,
    blendShapes = shared.blendShapes;
  if (!skinIndex && shared.rigidSkin) {
    skinWeight = shared.rigidSkin.w;
    skinIndex = shared.rigidSkin.i;
  }

  return { name: m.m_Name, vertexCount: vcount, positions, normals, tangents, binormals, tangentW, colors, uv, uv1, indices, submeshes, skinWeight, skinIndex, bindposes, boneNameHashes, blendShapes };
}
