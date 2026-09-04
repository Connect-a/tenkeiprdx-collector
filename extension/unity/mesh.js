import { unityDecode } from './decode.js';
import { unitySf } from './unity-sf.js';
import { fileNameOf } from '../core/assetpath/paths.js';
import { unityAnim as ANIM_MOD } from './anim.js';
import { unityCrunch as CRUNCH_MOD } from './crunch.js';
import { texCodec } from './texcodec.js';
import { spineAtlas } from './spine-atlas.js';

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

function readMaterialObj(sf, LE, o) {
  const mat = unitySf.readObject(sf, LE, o);
  const props = mat.m_SavedProperties || {};
  const tex = props.m_TexEnvs || mat.m_TexEnvs || [];
  let mainTexPathID = null,
    firstTexPathID = null,
    colorTexPathID = null,
    shadowTexPathID = null,
    maskTexPathID = null,
    mainTexScale = null,
    mainTexOffset = null;
  const texByName = {};
  const texST = {};
  for (const pair of tex) {
    const name = pair[0];
    const env = pair[1];
    const pid = env && env.m_Texture ? String(env.m_Texture.m_PathID) : null;
    if (typeof name === 'string' && env) {
      const sc = env.m_Scale || {};
      const of = env.m_Offset || {};
      texST[name] = [sc.x == null ? 1 : Number(sc.x), sc.y == null ? 1 : Number(sc.y), Number(of.x) || 0, Number(of.y) || 0];
      if (pid && pid !== '0') texByName[name] = pid;
    }
    if (pid && pid !== '0') {
      if (firstTexPathID === null) firstTexPathID = pid;
      if (name === '_ColorTex') colorTexPathID = pid;
      else if (name === '_ShadowTex') shadowTexPathID = pid;
      else if (name === '_MaskTex') maskTexPathID = pid;
      else if (name === '_MainTex' || name === '_BaseMap') {
        mainTexPathID = pid;
        mainTexScale = [Number((env.m_Scale || {}).x), Number((env.m_Scale || {}).y)];
        mainTexOffset = [Number((env.m_Offset || {}).x), Number((env.m_Offset || {}).y)];
      }
    }
  }
  const colors = props.m_Colors || [];
  const floats = props.m_Floats || [];
  const getColor = (n) => {
    const p = colors.find((x) => x[0] === n);
    if (!p) return null;
    const v = p[1] || {};
    return [v.r != null ? v.r : v.x != null ? v.x : 1, v.g != null ? v.g : v.y != null ? v.y : 1, v.b != null ? v.b : v.z != null ? v.z : 1, v.a != null ? v.a : v.w != null ? v.w : 1];
  };
  const getF = (n) => {
    const p = floats.find((x) => x[0] === n);
    return p ? Number(p[1]) : null;
  };
  const dstBlend = getF('_DstBlend');
  const toon = {
    colorTexPathID,
    shadowTexPathID,
    maskTexPathID,
    outlineColor: getColor('_OutlineColor') || [0.35, 0.3, 0.26, 1],
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
    emissionColor: getColor('_EmissionColor'),
    colorOverride: getColor('_ColorOverride'),
  };
  const vec1 = {};
  for (const p of floats) if (typeof p[0] === 'string' && p[0].indexOf('Vector1') === 0) vec1[p[0]] = Number(p[1]);
  const allColors = {},
    allFloats = {};
  for (const p of colors) if (typeof p[0] === 'string') allColors[p[0]] = getColor(p[0]);
  for (const p of floats) if (typeof p[0] === 'string') allFloats[p[0]] = Number(p[1]);
  const graphColors = colors.filter((x) => typeof x[0] === 'string' && x[0][0] !== '_').map((x) => getColor(x[0]));
  const kw = new Set();
  if (typeof mat.m_ShaderKeywords === 'string') for (const k of mat.m_ShaderKeywords.split(' ')) if (k) kw.add(k);
  if (Array.isArray(mat.m_ValidKeywords)) for (const k of mat.m_ValidKeywords) if (k) kw.add(String(k));
  return {
    pathID: o.pathID,
    name: mat.m_Name,
    keywords: kw,
    renderQueue: Number(mat.m_CustomRenderQueue),
    shaderPathID: mat.m_Shader ? String(mat.m_Shader.m_PathID) : null,
    mainTexPathID: mainTexPathID || colorTexPathID || firstTexPathID,
    mainTexScale,
    mainTexOffset,
    color: getColor('_BaseColor') || getColor('_Color'),
    graphColors,
    transparent: dstBlend != null && dstBlend !== 0,
    srcBlend: getF('_SrcBlend'),
    dstBlend,
    cutoff: getF('_Cutoff') != null ? getF('_Cutoff') : getF('_AlphaClip'),
    alphaClip: getF('_AlphaClip'),
    cull: getF('_Cull'),
    zwrite: getF('_ZWrite'),
    texByName,
    texST,
    vec1,
    allColors,
    allFloats,
    toon,
  };
}

function readShaderInfo(sf, LE, o) {
  const s = unitySf.readObject(sf, LE, o);
  const pf = s.m_ParsedForm;
  if (!pf || !pf.m_SubShaders || !pf.m_SubShaders.length) return { name: pf ? pf.m_Name : null };
  const ss = pf.m_SubShaders[0];
  const ps = ss && ss.m_Passes && ss.m_Passes[0];
  const rt = ps && ps.m_State && ps.m_State.rtBlend0;
  const name = pf.m_Name;
  if (!rt) return { name };
  const db = rt.destBlend || {};
  const sb = rt.srcBlend || {};
  const dynamic = typeof db.name === 'string' && db.name.charAt(0) === '_';
  return { name, dst: db.val != null ? Number(db.val) : null, src: sb.val != null ? Number(sb.val) : null, dynamic };
}

function resolveBlend(mat, shaderInfoByPid) {
  const sh = mat.shaderPathID ? shaderInfoByPid[mat.shaderPathID] : null;
  if (sh && !sh.dynamic && sh.dst != null) {
    if (sh.dst === 0) return 'opaque';
    if (sh.dst === 10) return 'alpha';
    return 'add';
  }
  if (mat.dstBlend === 10) return 'alpha';
  if (mat.dstBlend === 0) return 'opaque';
  return 'add';
}

function openCab(bytes, parsed) {
  try {
    parsed = parsed || unityDecode.parseUnityFS(bytes);
    const cab = parsed.nodes.find((n) => !n.path.endsWith('.resource') && !n.path.endsWith('.resS'));
    if (!cab) return null;
    const sf = parsed.data.subarray(cab.off, cab.off + cab.sz);
    return { parsed, sf, sfp: unitySf.parseSerializedFile(sf) };
  } catch (e) {
    return null;
  }
}

function attempt(fn) {
  try {
    return fn();
  } catch (e) {
    return null;
  }
}
const readOne = (sf, LE, o) => attempt(() => unitySf.readObject(sf, LE, o));

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

function parseModelBundle(bytes) {
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
  for (const o of sfp.objects) {
    if (o.classID === 114) {
      const mb = readOne(sf, sfp.LE, o);
      const looksFbx = mb && (Array.isArray(mb.actionPoints) || Array.isArray(mb.blinkRelatedBlendShapes) || Array.isArray(mb.attachments) || mb.faceRenderer);
      if (looksFbx && !fbx) {
        if (Array.isArray(mb.actionPoints) && mb.actionPoints.length) fbxActionPointRefs = mb.actionPoints;
        const pid = (pp) => (pp && pp.m_PathID != null ? String(pp.m_PathID) : null);
        fbx = {
          attachmentSmrPathIDs: (mb.attachments || []).map(pid).filter(Boolean),
          rotationOverrideY: Number((mb.rotationOverride || {}).y) || 0,
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
  return { meshes, renderers, materials, transforms, gameObjects, goActive, avatar, clips, actionPoints, fbx };
}

function textureBytes(tex, parsed) {
  let bytes = tex['image data'] && tex['image data'].__bytes;
  if ((!bytes || bytes.length === 0) && tex.m_StreamData && tex.m_StreamData.path) {
    const sd = tex.m_StreamData;
    const off = Number(sd.offset),
      size = Number(sd.size);
    const base = fileNameOf(sd.path);
    const node = parsed.nodes.find((n) => n.path === sd.path || n.path.endsWith(base));
    if (node) bytes = parsed.data.subarray(node.off + off, node.off + off + size);
  }
  return bytes && bytes.length ? bytes : null;
}

function decodeTexture(tex, parsed, keep) {
  const fmt = Number(tex.m_TextureFormat);
  const w = Number(tex.m_Width),
    h = Number(tex.m_Height);
  if (!w || !h) return { width: 0, height: 0, format: fmt, empty: true };
  const bytes = textureBytes(tex, parsed);
  if (!bytes) return { width: w, height: h, format: fmt, error: 'no-image-bytes' };
  if (keep && keep[fmt]) {
    const st = textureSettings(tex);
    const blocks = mipBlocks(bytes, fmt, w, h, st.mipCount);
    if (blocks) return { width: w, height: h, format: fmt, blocks, decode: () => texCodec.decodeByFormat(fmt, bytes, w, h), ...st };
  }
  let rgba = null;
  try {
    if (fmt === 29) {
      if (CRUNCH_MOD && CRUNCH_MOD.canDecodeCrunched && CRUNCH_MOD.canDecodeCrunched() && CRUNCH_MOD.decodeLevel0RGBA) {
        const d = CRUNCH_MOD.decodeLevel0RGBA(bytes);
        return { width: d.width, height: d.height, format: fmt, rgba: d.rgbaBytes };
      }
      return { width: w, height: h, format: fmt, error: 'unityCrunch-unavailable' };
    } else if (texCodec.canDecodeFormat(fmt)) rgba = texCodec.decodeByFormat(fmt, bytes, w, h);
    else if (fmt === 17 || fmt === 24 || fmt === 25)
      return { width: w, height: h, format: fmt, raw: bytes.subarray(0, fmt === 17 ? w * h * 8 : Math.ceil(w / 4) * Math.ceil(h / 4) * 16), ...textureSettings(tex) };
    else return { width: w, height: h, format: fmt, error: 'unsupported-format-' + fmt };
  } catch (e) {
    return { width: w, height: h, format: fmt, error: e && e.message ? e.message : String(e) };
  }
  if (!rgba) return { width: w, height: h, format: fmt, error: 'unityDecode-failed' };
  return { width: w, height: h, format: fmt, rgba, ...textureSettings(tex) };
}

function textureSettings(tex) {
  const ts = tex.m_TextureSettings || {};
  return {
    wrapU: Number(ts.m_WrapU) || 0,
    wrapV: Number(ts.m_WrapV) || 0,
    filter: Number(ts.m_FilterMode),
    aniso: Number(ts.m_Aniso) || 1,
    mipCount: Number(tex.m_MipCount) || 1,
    srgb: Number(tex.m_ColorSpace) !== 0,
  };
}

const blockBytes = (fmt) => (fmt === 12 || fmt === 13 ? 16 : 8);
const levelBytes = (fmt, w, h) => Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * blockBytes(fmt);

function mipBlocks(bytes, fmt, w, h, mipCount) {
  const out = [];
  let off = 0;
  for (let i = 0; i < Math.max(1, Number(mipCount) || 1); i++) {
    const lw = Math.max(1, w >> i),
      lh = Math.max(1, h >> i);
    const n = levelBytes(fmt, lw, lh);
    if (off + n > bytes.length) break;
    out.push({ data: bytes.subarray(off, off + n), width: lw, height: lh });
    off += n;
  }
  return out.length ? out : null;
}

function decodeCubemap(tex, parsed) {
  const fmt = Number(tex.m_TextureFormat);
  const w = Number(tex.m_Width);
  const h = Number(tex.m_Height);
  const faces = Number(tex.m_ImageCount) || 6;
  const bytes = textureBytes(tex, parsed);
  if (fmt !== 12 || !bytes || faces !== 6) return { width: w, height: h, format: fmt, error: 'unsupported-cubemap-' + fmt };
  let stride = 0;
  for (let i = 0; i < (Number(tex.m_MipCount) || 1); i++) stride += levelBytes(fmt, Math.max(1, w >> i), Math.max(1, h >> i));
  const size = levelBytes(fmt, w, h);
  const out = [];
  for (let f = 0; f < 6; f++) {
    const off = f * stride;
    if (off + size > bytes.length) return { width: w, height: h, format: fmt, error: 'cubemap-short' };
    out.push(texCodec.decodeByFormat(fmt, bytes.subarray(off, off + size), w, h));
  }
  return { width: w, height: h, format: fmt, faces: out };
}

const KEEP_DXT = { 10: true, 12: true };

function parseMaterialBundle(bytes, opt) {
  const keep = (opt && opt.keepCompressed) || null;
  const co = openCab(bytes);
  if (!co) return { materials: [], textures: [] };
  const { parsed, sf, sfp } = co;
  const materials = [];
  const textures = [];
  const shaderInfoByPid = {};
  const shaders = {};
  for (const o of sfp.objects) {
    if (o.classID === 48) {
      try {
        const b = readShaderInfo(sf, sfp.LE, o);
        if (b) {
          shaderInfoByPid[String(o.pathID)] = b;
          if (b.name) shaders[String(o.pathID)] = b.name;
        }
      } catch (e) {}
    }
  }
  for (const o of sfp.objects) {
    if (o.classID === 21) {
      try {
        const m = readMaterialObj(sf, sfp.LE, o);
        m.blend = resolveBlend(m, shaderInfoByPid);
        const si = m.shaderPathID ? shaderInfoByPid[m.shaderPathID] : null;
        m.shaderName = si && si.name ? si.name : null;
        materials.push(m);
      } catch (e) {}
    } else if (o.classID === 28 || o.classID === 89) {
      try {
        const tx = unitySf.readObject(sf, sfp.LE, o);
        const dec = o.classID === 89 ? decodeCubemap(tx, parsed) : decodeTexture(tx, parsed, keep);
        textures.push({
          pathID: o.pathID,
          name: tx.m_Name,
          width: dec.width,
          height: dec.height,
          format: dec.format,
          rgba: dec.rgba || null,
          raw: dec.raw || null,
          blocks: dec.blocks || null,
          decode: dec.decode || null,
          faces: dec.faces || null,
          wrapU: dec.wrapU || 0,
          wrapV: dec.wrapV || 0,
          filter: dec.filter,
          aniso: dec.aniso,
          mipCount: dec.mipCount,
          srgb: dec.srgb,
          error: dec.error || null,
        });
      } catch (e) {
        textures.push({ pathID: o.pathID, error: e && e.message ? e.message : String(e) });
      }
    }
  }
  return { materials, textures, shaders, shaderInfo: shaderInfoByPid };
}

function decodeLargestTexture(bytes, parsed) {
  const co = openCab(bytes, parsed);
  if (!co) return null;
  const { sf, sfp } = co;
  parsed = co.parsed;
  let best = null,
    bestArea = -1;
  for (const o of sfp.objects) {
    if (o.classID !== 28) continue;
    const tx = readOne(sf, sfp.LE, o);
    if (!tx) continue;
    const area = Number(tx.m_Width) * Number(tx.m_Height);
    if (area > bestArea) {
      bestArea = area;
      best = tx;
    }
  }
  if (!best) return null;
  const dec = decodeTexture(best, parsed);
  return { name: best.m_Name, width: dec.width, height: dec.height, format: dec.format, rgba: dec.rgba || null, error: dec.error || null };
}

function newDecodeStats() {
  return { failed: 0, reasons: {} };
}
const noteDecodeFail = (stats, dec) => {
  if (!stats || !dec || dec.empty || !dec.error) return;
  stats.failed++;
  const k = 'fmt' + dec.format + ' ' + dec.error;
  stats.reasons[k] = (stats.reasons[k] || 0) + 1;
};

function decodeLargestTextureRgba(bytes, parsed, stats) {
  parsed = parsed || unityDecode.parseUnityFS(bytes);
  try {
    const t = decodeLargestTexture(bytes, parsed);
    if (t && t.rgba) return { rgba: t.rgba, width: t.width, height: t.height };
    noteDecodeFail(stats, t);
  } catch (e) {}
  if (CRUNCH_MOD && CRUNCH_MOD.findInBuffer && CRUNCH_MOD.decodeLevel0RGBA) {
    const cands = CRUNCH_MOD.findInBuffer(parsed.data, 2);
    if (cands && cands.length) {
      try {
        const dec = CRUNCH_MOD.decodeLevel0RGBA(parsed.data.subarray(cands[0].offset));
        return { rgba: dec.rgbaBytes, width: dec.width, height: dec.height };
      } catch (e) {}
    }
  }
  const canDecode = !!(CRUNCH_MOD && CRUNCH_MOD.canDecodeCrunched && CRUNCH_MOD.canDecodeCrunched());
  const tr = texCodec.extractTexture2DPreviews(parsed.data, canDecode ? CRUNCH_MOD : null, 1, { flipY: false });
  if (tr.previews.length) {
    const c = tr.previews[0].canvas;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    return { rgba: new Uint8Array(d.data.buffer.slice(0)), width: c.width, height: c.height };
  }
  return null;
}

function decodeLargestTextureCanvas(bytes, parsed, stats) {
  const dec = decodeLargestTextureRgba(bytes, parsed, stats);
  if (!dec || !dec.rgba || !dec.width || !dec.height) return null;
  const rgba = texCodec && texCodec.flipRgbaY ? texCodec.flipRgbaY(dec.rgba, dec.width, dec.height) : dec.rgba;
  return texCodec && texCodec.renderRgbaToCanvas ? texCodec.renderRgbaToCanvas(rgba, dec.width, dec.height) : null;
}

function eachTexture(bytes, parsed, stats, fn) {
  const co = openCab(bytes, parsed);
  if (!co) return;
  const { sf, sfp } = co;
  for (const o of sfp.objects) {
    if (o.classID !== 28) continue;
    const tx = readOne(sf, sfp.LE, o);
    const dec = tx ? attempt(() => decodeTexture(tx, co.parsed)) : null;
    if (!dec || !dec.rgba || !dec.width || !dec.height) {
      noteDecodeFail(stats, dec);
      continue;
    }
    fn(tx, dec);
  }
}

const toCanvas = (dec) => {
  const rgba = texCodec && texCodec.flipRgbaY ? texCodec.flipRgbaY(dec.rgba, dec.width, dec.height) : dec.rgba;
  return texCodec && texCodec.renderRgbaToCanvas ? texCodec.renderRgbaToCanvas(rgba, dec.width, dec.height) : null;
};

function decodeAllTextureCanvases(bytes, parsed, stats) {
  const out = [];
  eachTexture(bytes, parsed, stats, (tx, dec) => {
    const cv = toCanvas(dec);
    if (cv) out.push(cv);
  });
  if (out.length) return out;
  const single = decodeLargestTextureCanvas(bytes, parsed);
  return single ? [single] : [];
}

function decodeNamedTextureCanvases(bytes, parsed, stats) {
  const out = [];
  eachTexture(bytes, parsed, stats, (tx, dec) => {
    const cv = toCanvas(dec);
    if (cv) out.push({ name: tx.m_Name || '', canvas: cv, width: dec.width, height: dec.height });
  });
  if (out.length) return out;
  return decodeAllTextureCanvases(bytes, parsed, stats).map((canvas) => ({ name: '', canvas, width: canvas.width, height: canvas.height }));
}

function decodeAtlasSprite(bytes, spriteName, parsed) {
  const co = openCab(bytes, parsed);
  if (!co) return null;
  const { sf, sfp } = co;
  const p = co.parsed;
  let sprite = null;
  for (const o of sfp.objects) {
    if (o.classID !== 213) continue;
    const s = readOne(sf, sfp.LE, o);
    if (s && s.m_Name === spriteName) {
      sprite = s;
      break;
    }
  }
  if (!sprite) return null;
  let rect = sprite.m_RD && sprite.m_RD.textureRect;
  let texPathID = sprite.m_RD && sprite.m_RD.texture ? String(sprite.m_RD.texture.m_PathID || '0') : '0';
  if (sprite.m_RenderDataKey) {
    const sa = sfp.objects.find((o) => o.classID === 687078895);
    if (sa) {
      const atlas = readOne(sf, sfp.LE, sa);
      const rdm = atlas && atlas.m_RenderDataMap;
      const kk = sprite.m_RenderDataKey;
      const keyEq = (a) => a && a.first && kk.first && ['data[0]', 'data[1]', 'data[2]', 'data[3]'].every((d) => String(a.first[d]) === String(kk.first[d])) && String(a.second) === String(kk.second);
      if (Array.isArray(rdm)) {
        for (const entry of rdm) {
          const k = entry && entry[0];
          const v = entry && entry[1];
          if (v && keyEq(k)) {
            if (v.textureRect) rect = v.textureRect;
            if (v.texture) texPathID = String(v.texture.m_PathID || '0');
            break;
          }
        }
      }
    }
  }
  if (!rect) return null;
  let dec = null;
  const texObjs = sfp.objects.filter((o) => o.classID === 28);
  const targetTex = texPathID !== '0' ? texObjs.find((o) => String(o.pathID) === texPathID) : null;
  for (const o of targetTex ? [targetTex] : texObjs) {
    const tx = readOne(sf, sfp.LE, o);
    const d = tx ? attempt(() => decodeTexture(tx, p)) : null;
    if (d && d.rgba && d.width && d.height) {
      dec = d;
      break;
    }
  }
  if (!dec) return null;
  const top = texCodec && texCodec.flipRgbaY ? texCodec.flipRgbaY(dec.rgba, dec.width, dec.height) : dec.rgba;
  const rw = Math.max(1, Math.round(rect.width));
  const rh = Math.max(1, Math.round(rect.height));
  const rx = Math.min(Math.max(0, Math.round(rect.x)), dec.width - rw);
  const ry = Math.min(Math.max(0, Math.round(dec.height - rect.y - rect.height)), dec.height - rh);
  const sub = new Uint8ClampedArray(rw * rh * 4);
  for (let row = 0; row < rh; row++) {
    const srcOff = ((ry + row) * dec.width + rx) * 4;
    sub.set(top.subarray(srcOff, srcOff + rw * 4), row * rw * 4);
  }
  return texCodec && texCodec.renderRgbaToCanvas ? texCodec.renderRgbaToCanvas(sub, rw, rh) : null;
}

function parseMouthAtlas(bytes) {
  if (!bytes) return null;
  const mb = parseMaterialBundle(bytes);
  const byName = (n) => {
    const t = (mb.textures || []).find((x) => x.name === n && x.rgba);
    return t ? { rgba: t.rgba, width: t.width, height: t.height } : null;
  };
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

function decodeNamedTextureRgba(bytes, parsed) {
  const out = [];
  eachTexture(bytes, parsed, null, (tx, dec) => {
    out.push({ name: tx.m_Name || '', rgba: dec.rgba, width: dec.width, height: dec.height });
  });
  return out;
}

function extractSpineInputs(bytes) {
  if (!bytes) return null;
  const parsed = unityDecode.parseUnityFS(bytes);
  const tas = unityDecode.extractTextAssets ? unityDecode.extractTextAssets(bytes) || [] : [];
  const a = tas.find((t) => /\.atlas$/i.test(t.name));
  const s = tas.find((t) => /\.skel(?:\.bytes)?$/i.test(t.name));
  if (!a || !a.bytes || !a.bytes.length || !s || !s.bytes || !s.bytes.length) return null;
  const names = spineAtlas.atlasPageNames(a.bytes);
  const found = decodeNamedTextureRgba(bytes, parsed);
  const textures = [];
  for (let i = 0; i < names.length; i++) {
    const t = spineAtlas.textureForPage(found, names[i], i);
    if (t && !textures.includes(t)) textures.push(t);
  }
  for (const t of found) if (!textures.includes(t)) textures.push(t);
  const texture = textures[0] || decodeLargestTextureRgba(bytes, parsed);
  if (!texture || !texture.rgba) return null;
  return { atlasBytes: a.bytes, skeletonBytes: s.bytes, skeletonPath: s.name, texture, textures: textures.length ? textures : [texture] };
}

export const unityMesh = {
  KEEP_DXT,
  newDecodeStats,
  parseModelBundle,
  parseMaterialBundle,
  resolveBlend,
  decodeLargestTextureRgba,
  decodeLargestTextureCanvas,
  decodeAllTextureCanvases,
  decodeNamedTextureCanvases,
  decodeNamedTextureRgba,
  decodeAtlasSprite,
  parseMouthAtlas,
  extractSpineInputs,
  extractMeshGeometry,
};
