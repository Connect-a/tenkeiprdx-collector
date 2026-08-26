import { unityDecode } from '../../unity/decode.js';
import { unitySf } from '../../unity/unity-sf.js';
import { unityMesh } from '../../unity/mesh.js';
import { assetStore } from '../../data/asset-store.js';
import { DIRS } from '../../core/constants.js';
import { hasFieldShader, makeFieldMaterial } from '../../engine/render/field-shader.js';

const CLS = { GAME_OBJECT: 1, TRANSFORM: 4, MESH_RENDERER: 23, MESH_FILTER: 33, MESH: 43, RENDER_SETTINGS: 104, LIGHT: 108, LIGHTMAP_SETTINGS: 157 };
const pid = (ref) => (ref && ref.m_PathID != null ? String(ref.m_PathID) : null);
const isLocal = (ref) => ref && Number(ref.m_FileID || 0) === 0 && pid(ref) && pid(ref) !== '0';

function sliceStream(parsed, sd) {
  if (!sd || !sd.path) return null;
  const base = String(sd.path).split('/').pop();
  const node = parsed.nodes.find((n) => n.path === sd.path || n.path.endsWith(base));
  if (!node) return null;
  const off = Number(sd.offset) || 0;
  const size = Number(sd.size) || 0;
  return parsed.data.subarray(node.off + off, node.off + off + size);
}

function readGeometry(parsed, sf, LE, obj) {
  const m = unitySf.readObject(sf, LE, obj);
  const vd = m.m_VertexData;
  if (vd && (!vd.m_DataSize || !vd.m_DataSize.__bytes || !vd.m_DataSize.__bytes.length)) {
    const bytes = sliceStream(parsed, m.m_StreamData);
    if (!bytes) return null;
    vd.m_DataSize = { __bytes: bytes };
  }
  const geo = unityMesh.extractMeshGeometry(m, LE);
  return geo && geo.positions && geo.positions.length ? geo : null;
}

function canvasOf(rgba, w, h) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), w, h), 0, 0);
  return cv;
}

const wrapOf = (T, m) => (Number(m) === 1 ? T.ClampToEdgeWrapping : Number(m) === 2 ? T.MirroredRepeatWrapping : T.RepeatWrapping);

const sideOf = (T, mat) => {
  const c = mat && mat.cull != null ? Number(mat.cull) : 2;
  if (c === 0) return T.DoubleSide;
  return c === 1 ? T.FrontSide : T.BackSide;
};

function buildTextures(T, bytes) {
  const parsedMats = unityMesh.parseMaterialBundle(bytes);
  const texByPid = new Map();
  const cubeByPid = new Map();
  const rawByPid = new Map();
  for (const t of parsedMats.textures || []) {
    if (!t.width || !t.height) continue;
    if (t.faces) {
      cubeByPid.set(String(t.pathID), t);
      continue;
    }
    if (t.raw) {
      rawByPid.set(String(t.pathID), t);
      continue;
    }
    if (!t.rgba) continue;
    const tx = new T.DataTexture(t.rgba, t.width, t.height, T.RGBAFormat);
    tx.needsUpdate = true;
    tx.flipY = false;
    tx.wrapS = wrapOf(T, t.wrapU);
    tx.wrapT = wrapOf(T, t.wrapV);
    tx.minFilter = T.LinearMipmapLinearFilter;
    tx.magFilter = T.LinearFilter;
    tx.generateMipmaps = true;
    tx.colorSpace = T.SRGBColorSpace || 'srgb';
    texByPid.set(String(t.pathID), { tex: tx, name: t.name, width: t.width, height: t.height });
  }
  return { mats: parsedMats.materials || [], texByPid, cubeByPid, rawByPid };
}

function cubeTexture(T, rec) {
  const faces = rec.faces.map((f) => canvasOf(f, rec.width, rec.height));
  const tex = new T.CubeTexture(faces);
  tex.colorSpace = T.SRGBColorSpace || 'srgb';
  tex.needsUpdate = true;
  return tex;
}

function lightmapTexture(T, rec, bptc) {
  if (!rec || !rec.raw) return null;
  let tex = null;
  if (rec.format === 17) tex = new T.DataTexture(new Uint16Array(rec.raw.buffer, rec.raw.byteOffset, rec.raw.byteLength >> 1), rec.width, rec.height, T.RGBAFormat, T.HalfFloatType);
  else if (rec.format === 24 && bptc) tex = new T.CompressedTexture([{ data: rec.raw, width: rec.width, height: rec.height }], rec.width, rec.height, T.RGB_BPTC_UNSIGNED_Format, T.UnsignedByteType);
  if (!tex) return null;
  tex.flipY = false;
  tex.wrapS = T.ClampToEdgeWrapping;
  tex.wrapT = T.ClampToEdgeWrapping;
  tex.minFilter = T.LinearFilter;
  tex.magFilter = T.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = T.LinearSRGBColorSpace || 'srgb-linear';
  tex.channel = 1;
  tex.needsUpdate = true;
  return tex;
}

const LIT_SHADER = /Baked Lit|^Universal Render Pipeline\/(Lit|Simple Lit)$/;
const FLAT_SH = (l0) => [l0.map((x) => x / 0.886227), [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];

function ambientOf(rs) {
  const probe = rs && rs.m_AmbientProbe;
  if (probe) {
    const keys = Object.keys(probe).sort((a, b) => parseInt(a.replace(/\D+/g, ''), 10) - parseInt(b.replace(/\D+/g, ''), 10));
    const v = keys.map((k) => Number(probe[k]));
    if (v.length >= 27) {
      const sh = [];
      for (let i = 0; i < 9; i++) sh.push([v[i], v[i + 9], v[i + 18]]);
      if (sh.some((c) => c.some((x) => x !== 0))) return sh;
    }
    if (v.length >= 19) {
      const dc = [v[0], v[9], v[18]].map((x) => Math.max(0, x * 0.886227));
      if (dc.some((x) => x > 0)) return FLAT_SH(dc);
    }
  }
  const c = (rs && rs.m_AmbientSkyColor) || null;
  return FLAT_SH(c ? [Number(c.r) || 0, Number(c.g) || 0, Number(c.b) || 0] : [1, 1, 1]);
}

const SH_A = [0.886227, 1.023328, 0.858086, 0.247708, 0.429043];
function shIrradiance(sh, nx, ny, nz, out) {
  for (let k = 0; k < 3; k++) {
    let r = SH_A[0] * sh[0][k];
    r += SH_A[1] * (sh[1][k] * ny + sh[2][k] * nz + sh[3][k] * nx);
    r += SH_A[4] * (sh[4][k] * nx * ny + sh[5][k] * ny * nz + sh[7][k] * nx * nz) * 2;
    r += SH_A[3] * sh[6][k] * (3 * nz * nz - 1);
    r += SH_A[4] * sh[8][k] * (nx * nx - ny * ny);
    out[k] = Math.max(0, r);
  }
  return out;
}

function bakeAmbientColors(T, geo, sh) {
  const nrm = geo.attributes.normal;
  if (!nrm) return null;
  const col = new Float32Array(nrm.count * 3);
  const tmp = [0, 0, 0];
  for (let i = 0; i < nrm.count; i++) {
    shIrradiance(sh, nrm.getX(i), nrm.getY(i), nrm.getZ(i), tmp);
    col[i * 3] = tmp[0];
    col[i * 3 + 1] = tmp[1];
    col[i * 3 + 2] = tmp[2];
  }
  return new T.BufferAttribute(col, 3);
}

function threeMaterial(T, mat, texByPid, lightMap, ambient) {
  const rec = mat && mat.mainTexPathID ? texByPid.get(String(mat.mainTexPathID)) : null;
  let map = rec ? rec.tex : null;
  const sc = (mat && mat.mainTexScale) || null;
  const of = (mat && mat.mainTexOffset) || null;
  const tiled = sc && (Math.abs(sc[0] - 1) > 1e-4 || Math.abs(sc[1] - 1) > 1e-4);
  const shifted = of && (Math.abs(of[0]) > 1e-4 || Math.abs(of[1]) > 1e-4);
  if (map && (tiled || shifted)) {
    map = map.clone();
    map.needsUpdate = true;
    if (tiled) map.repeat.set(sc[0], sc[1]);
    if (shifted) map.offset.set(of[0], of[1]);
  }
  const opts = { map, side: sideOf(T, mat) };
  if (lightMap) {
    opts.lightMap = lightMap;
    opts.lightMapIntensity = Math.PI;
  }
  const lit = !lightMap && mat && LIT_SHADER.test(String(mat.shaderName || ''));
  if (lit) opts.vertexColors = true;
  const c = (mat && mat.color) || null;
  const base = Array.isArray(c) ? c : c ? [c.r ?? 1, c.g ?? 1, c.b ?? 1] : [1, 1, 1];
  if (c) opts.color = new T.Color(base[0], base[1], base[2]);
  if (mat && mat.cutoff != null && mat.alphaClip === 1) {
    opts.alphaTest = mat.cutoff;
    opts.transparent = false;
  } else if (mat && mat.transparent) {
    opts.transparent = true;
    opts.depthWrite = false;
  }
  return new T.MeshBasicMaterial(opts);
}

function groundNear(geos, x, z, refY) {
  let best = null;
  for (const geo of geos) {
    const a = geo.positions;
    const ix = geo.indices;
    for (let t = 0; t + 2 < ix.length; t += 3) {
      const i0 = ix[t] * 3,
        i1 = ix[t + 1] * 3,
        i2 = ix[t + 2] * 3;
      const x0 = a[i0],
        z0 = a[i0 + 2],
        x1 = a[i1],
        z1 = a[i1 + 2],
        x2 = a[i2],
        z2 = a[i2 + 2];
      const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
      if (Math.abs(d) < 1e-9) continue;
      const l0 = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / d;
      if (l0 < 0 || l0 > 1) continue;
      const l1 = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / d;
      if (l1 < 0 || l1 > 1) continue;
      const l2 = 1 - l0 - l1;
      if (l2 < 0 || l2 > 1) continue;
      const ux = a[i1] - a[i0],
        uy = a[i1 + 1] - a[i0 + 1],
        uz = a[i1 + 2] - a[i0 + 2];
      const vx = a[i2] - a[i0],
        vy = a[i2 + 1] - a[i0 + 1],
        vz = a[i2 + 2] - a[i0 + 2];
      const ny = uz * vx - ux * vz;
      if (ny / (Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx) || 1) <= 0.3) continue;
      const y = l0 * a[i0 + 1] + l1 * a[i1 + 1] + l2 * a[i2 + 1];
      if (best === null || Math.abs(y - refY) < Math.abs(best - refY)) best = y;
    }
  }
  return best;
}

function bakeLightmapUv(geo, parts) {
  const out = new Float32Array(geo.uv1.length);
  const idx = geo.indices;
  for (const p of parts) {
    const st = p.lm;
    if (!st) continue;
    for (let i = p.start; i < p.start + p.count; i++) {
      const v = idx[i] * 2;
      out[v] = geo.uv1[v] * st.sx + st.ox;
      out[v + 1] = geo.uv1[v + 1] * st.sy + st.oy;
    }
  }
  return out;
}

export async function loadBattleField(T, rel, opt) {
  const bytes = await assetStore.readAsset(DIRS.shared, rel);
  if (!bytes) return null;
  const parsed = unityDecode.parseUnityFS(bytes);
  const cabs = parsed.nodes.filter((n) => !/\.resS$|\.resource$/.test(n.path));
  const main = cabs.find((n) => !/sharedAssets$/.test(n.path));
  if (!main) return null;

  const { mats, texByPid, cubeByPid, rawByPid } = buildTextures(T, bytes);
  const matByPid = new Map(mats.map((m) => [String(m.pathID), m]));

  const sf = parsed.data.subarray(main.off, main.off + main.sz);
  const sfp = unitySf.parseSerializedFile(sf);

  const lightMaps = [];
  for (const o of sfp.objects) {
    if (o.classID !== CLS.LIGHTMAP_SETTINGS) continue;
    try {
      const ls = unitySf.readObject(sf, sfp.LE, o);
      for (const entry of ls.m_Lightmaps || []) lightMaps.push(lightmapTexture(T, rawByPid.get(pid(entry.m_Lightmap)), !opt || opt.bptc !== false));
    } catch (e) {}
  }
  const lightmapRef = (mr) => {
    const i = Number(mr.m_LightmapIndex);
    if (!(i >= 0) || i >= lightMaps.length || !lightMaps[i]) return null;
    const t = mr.m_LightmapTilingOffset || {};
    return { index: i, sx: t.x == null ? 1 : Number(t.x), sy: t.y == null ? 1 : Number(t.y), ox: Number(t.z) || 0, oy: Number(t.w) || 0 };
  };

  let ambient = FLAT_SH([1, 1, 1]);
  for (const o of sfp.objects) {
    if (o.classID !== CLS.RENDER_SETTINGS) continue;
    try {
      ambient = ambientOf(unitySf.readObject(sf, sfp.LE, o));
    } catch (e) {}
    break;
  }

  let whiteTex = null;
  const white = () => {
    if (!whiteTex) {
      whiteTex = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, T.RGBAFormat);
      whiteTex.needsUpdate = true;
    }
    return whiteTex;
  };
  const fieldMats = [];
  const matCache = new Map();
  const materialFor = (p, lmIndex) => {
    const k = `${p || ''}|${lmIndex}`;
    if (matCache.has(k)) return matCache.get(k);
    const mat = matByPid.get(String(p || ''));
    let m = null;
    if (mat && hasFieldShader(mat.shaderName)) {
      try {
        m = makeFieldMaterial(T, mat.shaderName, mat, {
          textureOf: (pid) => (texByPid.get(String(pid)) || {}).tex || null,
          white,
          side: (x) => sideOf(T, x),
        });
      } catch (e) {
        m = null;
      }
      if (m) fieldMats.push(m);
    }
    if (!m) m = threeMaterial(T, mat, texByPid, lmIndex >= 0 ? lightMaps[lmIndex] : null, ambient);
    matCache.set(k, m);
    return m;
  };
  const usesFieldShader = (p) => {
    const mat = matByPid.get(String(p || ''));
    return !!(mat && hasFieldShader(mat.shaderName));
  };
  const byId = new Map(sfp.objects.map((o) => [String(o.pathID), o]));

  const sharedNode = cabs.find((n) => /sharedAssets$/.test(n.path));
  let ssf = null;
  let ssfp = null;
  const ssById = new Map();
  if (sharedNode) {
    try {
      ssf = parsed.data.subarray(sharedNode.off, sharedNode.off + sharedNode.sz);
      ssfp = unitySf.parseSerializedFile(ssf);
      for (const o of ssfp.objects) ssById.set(String(o.pathID), o);
    } catch (e) {
      ssf = null;
    }
  }
  const sharedFileIds = new Set();
  (sfp.externals || []).forEach((e, i) => {
    if (/sharedAssets$/.test(String(e.pathName || ''))) sharedFileIds.add(i + 1);
  });

  const geoCache = new Map();
  const geometryOf = (ref) => {
    const file = Number(ref.m_FileID || 0);
    const k = `${file}:${pid(ref)}`;
    if (!geoCache.has(k)) {
      const inShared = file !== 0 && sharedFileIds.has(file) && ssf;
      const obj = inShared ? ssById.get(pid(ref)) : file === 0 ? byId.get(pid(ref)) : null;
      let g = null;
      try {
        g = obj && obj.classID === CLS.MESH ? readGeometry(parsed, inShared ? ssf : sf, inShared ? ssfp.LE : sfp.LE, obj) : null;
      } catch (e) {
        g = null;
      }
      geoCache.set(k, g);
    }
    return geoCache.get(k);
  };

  const filterByGo = new Map();
  for (const o of sfp.objects) {
    if (o.classID !== CLS.MESH_FILTER) continue;
    try {
      const mf = unitySf.readObject(sf, sfp.LE, o);
      if (mf.m_GameObject && pid(mf.m_Mesh) && pid(mf.m_Mesh) !== '0') filterByGo.set(pid(mf.m_GameObject), mf.m_Mesh);
    } catch (e) {}
  }

  const trById = new Map();
  const trByGo = new Map();
  for (const o of sfp.objects) {
    if (o.classID !== CLS.TRANSFORM) continue;
    try {
      const t = unitySf.readObject(sf, sfp.LE, o);
      trById.set(String(o.pathID), t);
      if (pid(t.m_GameObject)) trByGo.set(pid(t.m_GameObject), t);
    } catch (e) {}
  }
  const worldMatrix = (goPid) => {
    const chain = [];
    let t = trByGo.get(goPid);
    while (t && chain.length < 64) {
      chain.push(t);
      t = isLocal(t.m_Father) ? trById.get(pid(t.m_Father)) : null;
    }
    const m = new T.Matrix4();
    const local = new T.Matrix4();
    const v = new T.Vector3();
    const q = new T.Quaternion();
    const s = new T.Vector3();
    for (let i = chain.length - 1; i >= 0; i--) {
      const tr = chain[i];
      const p = tr.m_LocalPosition || {};
      const r = tr.m_LocalRotation || {};
      const sc = tr.m_LocalScale || {};
      v.set(Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0);
      q.set(Number(r.x) || 0, Number(r.y) || 0, Number(r.z) || 0, r.w == null ? 1 : Number(r.w));
      s.set(sc.x == null ? 1 : Number(sc.x), sc.y == null ? 1 : Number(sc.y), sc.z == null ? 1 : Number(sc.z));
      m.multiply(local.compose(v, q, s));
    }
    return m;
  };

  const goName = new Map();
  const goSelfActive = new Map();
  for (const o of sfp.objects) {
    if (o.classID !== CLS.GAME_OBJECT) continue;
    try {
      const g = unitySf.readObject(sf, sfp.LE, o);
      goName.set(String(o.pathID), String(g.m_Name || ''));
      goSelfActive.set(String(o.pathID), g.m_IsActive === undefined ? true : !!g.m_IsActive);
    } catch (e) {}
  }
  const activeCache = new Map();
  const isActive = (goPid) => {
    if (activeCache.has(goPid)) return activeCache.get(goPid);
    let ok = goSelfActive.get(goPid) !== false;
    activeCache.set(goPid, ok);
    if (ok) {
      const t = trByGo.get(goPid);
      const father = t && isLocal(t.m_Father) ? trById.get(pid(t.m_Father)) : null;
      const up = father ? pid(father.m_GameObject) : null;
      if (up) ok = isActive(up);
      activeCache.set(goPid, ok);
    }
    return ok;
  };

  const perMesh = new Map();
  const loose = [];
  for (const o of sfp.objects) {
    if (o.classID !== CLS.MESH_RENDERER) continue;
    let mr;
    try {
      mr = unitySf.readObject(sf, sfp.LE, o);
    } catch (e) {
      continue;
    }
    if (mr.m_Enabled === 0 || !isActive(pid(mr.m_GameObject))) continue;
    const meshRef = filterByGo.get(pid(mr.m_GameObject));
    const geo = meshRef ? geometryOf(meshRef) : null;
    if (!geo) continue;
    const meshKey = `${Number(meshRef.m_FileID || 0)}:${pid(meshRef)}`;
    const sb = mr.m_StaticBatchInfo || {};
    const first = Number(sb.firstSubMesh) || 0;
    const cnt = Number(sb.subMeshCount) || 0;
    const subs = geo.submeshes && geo.submeshes.length ? geo.submeshes : [{ indexStart: 0, indexCount: geo.indices.length, topology: 0 }];
    const range = cnt > 0 ? subs.slice(first, first + cnt) : subs;
    const matRefs = mr.m_Materials || [];
    const lmRaw = lightmapRef(mr);
    const lm = cnt > 0 && lmRaw ? { index: lmRaw.index, sx: 1, sy: 1, ox: 0, oy: 0 } : lmRaw;
    const parts = [];
    range.forEach((sm, i) => {
      if (!sm || !sm.indexCount || Number(sm.topology) !== 0) return;
      parts.push({ start: sm.indexStart, count: sm.indexCount, matPid: pid(matRefs[i] || matRefs[0]), lm });
    });
    if (!parts.length) continue;
    if (cnt > 0) {
      if (!perMesh.has(meshKey)) perMesh.set(meshKey, { geo, parts: [] });
      perMesh.get(meshKey).parts.push(...parts);
    } else {
      loose.push({ geo, parts, matrix: worldMatrix(pid(mr.m_GameObject)) });
    }
  }

  const group = new T.Group();
  const owned = [];
  let drawn = 0;
  const attrCache = new Map();
  const attrsOf = (geo) => {
    if (!attrCache.has(geo)) {
      const a = { position: new T.BufferAttribute(geo.positions, 3), index: new T.BufferAttribute(geo.indices, 1) };
      if (geo.normals) a.normal = new T.BufferAttribute(geo.normals, 3);
      if (geo.uv) a.uv = new T.BufferAttribute(geo.uv, 2);
      if (geo.tangents) {
        const n = geo.tangents.length / 3;
        const t4 = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
          t4[i * 4] = geo.tangents[i * 3];
          t4[i * 4 + 1] = geo.tangents[i * 3 + 1];
          t4[i * 4 + 2] = geo.tangents[i * 3 + 2];
          t4[i * 4 + 3] = 1;
        }
        a.tangent = new T.BufferAttribute(t4, 4);
      }
      attrCache.set(geo, a);
    }
    return attrCache.get(geo);
  };
  const addMesh = (geo, parts, matrix, shaderPass) => {
    if (!parts.length) return;
    const a = attrsOf(geo);
    const g = new T.BufferGeometry();
    g.setAttribute('position', a.position);
    if (a.normal) g.setAttribute('normal', a.normal);
    if (a.uv) g.setAttribute('uv', a.uv);
    if (a.tangent) g.setAttribute('tangent', a.tangent);
    g.setIndex(a.index);
    if (!a.normal) g.computeVertexNormals();
    if (geo.uv1) g.setAttribute('uv1', new T.BufferAttribute(bakeLightmapUv(geo, parts), 2));
    if (parts.some((p) => !(p.lm && geo.uv1))) {
      const vc = bakeAmbientColors(T, g, ambient);
      if (vc) g.setAttribute('color', vc);
    }
    const matList = [];
    const matIndex = new Map();
    for (const p of parts) {
      const key = `${p.matPid || ''}|${p.lm && geo.uv1 ? p.lm.index : -1}`;
      if (!matIndex.has(key)) {
        matIndex.set(key, matList.length);
        matList.push(materialFor(p.matPid, p.lm && geo.uv1 ? p.lm.index : -1));
      }
      g.addGroup(p.start, p.count, matIndex.get(key));
      drawn++;
    }
    const mesh = new T.Mesh(g, matList);
    mesh.frustumCulled = false;
    if (shaderPass) mesh.userData.fieldShaderPass = true;
    if (matrix) {
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(matrix);
    }
    group.add(mesh);
    owned.push(g);
  };
  const addSplit = (geo, parts, matrix) => {
    addMesh(
      geo,
      parts.filter((p) => !usesFieldShader(p.matPid)),
      matrix,
      false,
    );
    addMesh(
      geo,
      parts.filter((p) => usesFieldShader(p.matPid)),
      matrix,
      true,
    );
  };
  for (const { geo, parts } of perMesh.values()) addSplit(geo, parts, null);
  for (const { geo, parts, matrix } of loose) addSplit(geo, parts, matrix);
  if (!drawn) return null;

  let origin = null;
  let originRank = 0;
  for (const o of sfp.objects) {
    if (o.classID !== CLS.TRANSFORM) continue;
    try {
      const t = unitySf.readObject(sf, sfp.LE, o);
      const nm = goName.get(pid(t.m_GameObject)) || '';
      const rooted = !isLocal(t.m_Father);
      const kind = /^field/i.test(nm) ? 3 : /^battlestage$/i.test(nm) ? 2 : rooted && /^battlemap/i.test(nm) ? 1 : 0;
      const rank = kind * 2 + (rooted ? 1 : 0);
      if (!kind || rank <= originRank) continue;
      const p = t.m_LocalPosition;
      if (!p) continue;
      originRank = rank;
      origin = { x: Number(p.x) || 0, y: Number(p.y) || 0, z: Number(p.z) || 0 };
    } catch (e) {}
  }

  if (origin) {
    const g = groundNear(
      [...perMesh.values()].map((x) => x.geo),
      origin.x,
      origin.z,
      origin.y,
    );
    if (g !== null && Math.abs(g - origin.y) <= 5) origin.y = g;
  }

  let fog = null;
  let background = null;
  let backgroundRotation = 0;
  let backgroundIntensity = 1;
  let light = null;
  for (const o of sfp.objects) {
    if (o.classID === CLS.RENDER_SETTINGS) {
      try {
        const rs = unitySf.readObject(sf, sfp.LE, o);
        if (rs.m_Fog) {
          const fc = rs.m_FogColor || { r: 0.5, g: 0.5, b: 0.5 };
          const mode = Number(rs.m_FogMode);
          const col = new T.Color(fc.r, fc.g, fc.b);
          if (mode === 1) fog = new T.Fog(col, Number(rs.m_LinearFogStart) || 60, Number(rs.m_LinearFogEnd) || 300);
          else fog = new T.FogExp2(col, Number(rs.m_FogDensity) || 0.01);
        }
        const skyPid = isLocal(rs.m_SkyboxMaterial) ? null : pid(rs.m_SkyboxMaterial);
        const skyMat = skyPid ? matByPid.get(skyPid) : null;
        const skyRef = skyMat ? String(skyMat.mainTexPathID || skyMat.firstTexPathID || '') : '';
        const skyCube = skyRef ? cubeByPid.get(skyRef) : null;
        const skyTex = skyRef ? texByPid.get(skyRef) : null;
        const skyFloats = (skyMat && skyMat.allFloats) || {};
        backgroundRotation = ((Number(skyFloats._Rotation) || 0) * Math.PI) / 180;
        backgroundIntensity = Number(skyFloats._Exposure) || 1;
        if (skyCube) {
          background = cubeTexture(T, skyCube);
        } else if (skyTex) {
          skyTex.tex.mapping = T.EquirectangularReflectionMapping;
          skyTex.tex.flipY = false;
          background = skyTex.tex;
        } else {
          const a = rs.m_AmbientSkyColor || { r: 0.2, g: 0.22, b: 0.26 };
          background = new T.Color(Math.min(1, a.r), Math.min(1, a.g), Math.min(1, a.b));
        }
      } catch (e) {}
    } else if (o.classID === CLS.LIGHT && !light) {
      try {
        const l = unitySf.readObject(sf, sfp.LE, o);
        const c = l.m_Color || { r: 1, g: 1, b: 1 };
        light = { intensity: Number(l.m_Intensity) || 0.9, r: c.r, g: c.g, b: c.b };
      } catch (e) {}
    }
  }

  group.__dispose = () => {
    for (const g of owned) g.dispose();
    for (const m of matCache.values()) m.dispose();
    for (const t of texByPid.values()) t.tex.dispose();
    for (const t of lightMaps) if (t) t.dispose();
    if (background && background.dispose && background.isCubeTexture) background.dispose();
  };
  return { group, fog, background, backgroundRotation, backgroundIntensity, light, origin, meshCount: drawn, lightmaps: lightMaps.filter(Boolean).length, fieldMats };
}
