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

function buildTextures(T, bytes, maxAniso) {
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
    const mips = (t.mipCount || 1) > 1;
    const point = Number(t.filter) === 0;
    tx.magFilter = point ? T.NearestFilter : T.LinearFilter;
    tx.minFilter = point ? (mips ? T.NearestMipmapNearestFilter : T.NearestFilter) : mips ? T.LinearMipmapLinearFilter : T.LinearFilter;
    tx.generateMipmaps = mips;
    tx.anisotropy = Math.max(1, Math.min(maxAniso || 1, Number(t.aniso) || 1));
    tx.colorSpace = T.LinearSRGBColorSpace || 'srgb-linear';
    texByPid.set(String(t.pathID), { tex: tx, name: t.name, width: t.width, height: t.height, rgba: t.rgba });
  }
  return { mats: parsedMats.materials || [], texByPid, cubeByPid, rawByPid };
}

const scaleRgb = (rgba, k) => {
  if (Math.abs(k - 1) < 1e-4) return rgba;
  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    out[i] = Math.min(255, rgba[i] * k);
    out[i + 1] = Math.min(255, rgba[i + 1] * k);
    out[i + 2] = Math.min(255, rgba[i + 2] * k);
    out[i + 3] = rgba[i + 3];
  }
  return out;
};

function cubeTexture(T, rec, exposure) {
  const faces = rec.faces.map((f) => canvasOf(scaleRgb(f, exposure), rec.width, rec.height));
  const tex = new T.CubeTexture(faces);
  tex.colorSpace = T.SRGBColorSpace || 'srgb';
  tex.needsUpdate = true;
  return tex;
}

function skyTexture(T, rec, exposure) {
  const tex = new T.DataTexture(scaleRgb(rec.rgba, exposure), rec.width, rec.height, T.RGBAFormat);
  tex.colorSpace = T.SRGBColorSpace || 'srgb';
  tex.mapping = T.EquirectangularReflectionMapping;
  tex.flipY = false;
  tex.wrapS = T.RepeatWrapping;
  tex.wrapT = T.ClampToEdgeWrapping;
  tex.minFilter = T.LinearFilter;
  tex.magFilter = T.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function flatSkyColor(T, mat, exposure) {
  const c = (mat.allColors && (mat.allColors._Tint || mat.allColors._SkyTint || mat.allColors._BaseColor || mat.allColors._Color)) || [0, 0, 0, 1];
  const k = mat.allFloats && mat.allFloats._Exposure != null ? exposure : 1;
  return new T.Color(Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k));
}

function skyboxInfo(T, rs, matByPid, cubeByPid, texByPid) {
  const skyPid = isLocal(rs.m_SkyboxMaterial) ? null : pid(rs.m_SkyboxMaterial);
  const skyMat = skyPid ? matByPid.get(skyPid) : null;
  const skyRef = skyMat ? String(skyMat.mainTexPathID || skyMat.firstTexPathID || '') : '';
  const f = (skyMat && skyMat.allFloats) || {};
  return {
    mat: skyMat,
    cube: skyRef ? cubeByPid.get(skyRef) : null,
    tex: skyRef ? texByPid.get(skyRef) : null,
    exposure: f._Exposure == null ? 1 : Number(f._Exposure),
    rotation: ((Number(f._Rotation) || 0) * Math.PI) / 180,
  };
}

// 焼き込み済みキューブが無いマップ（47/81）は実ゲームと同じく skybox から作る。反射は生値で読むので linear 扱い。
function skyboxCube(T, renderer, sky) {
  const raw = (t) => {
    if (t) t.colorSpace = T.LinearSRGBColorSpace || 'srgb-linear';
    return t;
  };
  if (sky.cube) return { tex: raw(cubeTexture(T, sky.cube, sky.exposure)), rt: null };
  if (sky.tex && renderer) {
    // fromEquirectangularTexture は元テクスチャから minFilter/generateMipmaps を引き継ぐ。先に設定しないとミップが無い。
    const src = skyTexture(T, sky.tex, sky.exposure);
    src.minFilter = T.LinearMipmapLinearFilter;
    src.generateMipmaps = true;
    const rt = new T.WebGLCubeRenderTarget(256);
    try {
      rt.fromEquirectangularTexture(renderer, src);
    } catch (e) {
      src.dispose();
      rt.dispose();
      return { tex: null, rt: null };
    }
    src.dispose();
    return { tex: raw(rt.texture), rt };
  }
  if (sky.mat) {
    const c = flatSkyColor(T, sky.mat, sky.exposure);
    const px = new Uint8Array([Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255), 255]);
    const faces = [];
    for (let i = 0; i < 6; i++) faces.push(canvasOf(px, 1, 1));
    const tex = new T.CubeTexture(faces);
    tex.needsUpdate = true;
    return { tex: raw(tex), rt: null };
  }
  return { tex: null, rt: null };
}

function lightmapTexture(T, rec, bptc) {
  if (!rec || !rec.raw) return null;
  let tex = null;
  if (rec.format === 17) tex = new T.DataTexture(new Uint16Array(rec.raw.buffer, rec.raw.byteOffset, rec.raw.byteLength >> 1), rec.width, rec.height, T.RGBAFormat, T.HalfFloatType);
  else if (rec.format === 24 && bptc) tex = new T.CompressedTexture([{ data: rec.raw, width: rec.width, height: rec.height }], rec.width, rec.height, T.RGB_BPTC_UNSIGNED_Format, T.UnsignedByteType);
  else if (rec.format === 25 && bptc) tex = new T.CompressedTexture([{ data: rec.raw, width: rec.width, height: rec.height }], rec.width, rec.height, T.RGBA_BPTC_Format, T.UnsignedByteType);
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
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const FLAT_SH = (l0) => [l0.map((x) => x / SH_C[0]), [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];

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
  }
  const c = (rs && rs.m_AmbientSkyColor) || null;
  const rgb = c ? [Number(c.r) || 0, Number(c.g) || 0, Number(c.b) || 0] : [1, 1, 1];
  return FLAT_SH(rgb.map(srgbToLinear));
}

// ベイク済み LightProbes（sharedAssets 側の classID 258）。実データを持つのは
// deepforest3 / plainforest / plainforest2 の3本だけで、他は空。
function lightProbesOf(ssf, ssfp) {
  if (!ssf || !ssfp) return null;
  const key = (i) => 'sh[' + (i < 10 ? ' ' : '') + i + ']';
  for (const o of ssfp.objects) {
    if (o.classID !== 258) continue;
    let lp;
    try {
      lp = unitySf.readObject(ssf, ssfp.LE, o);
    } catch (e) {
      continue;
    }
    const bc = lp.m_BakedCoefficients || [];
    const d = lp.m_Data || {};
    const pos = d.m_Positions || [];
    const tets = (d.m_Tetrahedralization || {}).m_Tetrahedra || [];
    if (!bc.length || !pos.length || !tets.length) continue;
    const coeff = bc.map((c) => {
      const sh = [];
      for (let k = 0; k < 9; k++) sh.push([Number(c[key(k)]) || 0, Number(c[key(k + 9)]) || 0, Number(c[key(k + 18)]) || 0]);
      return sh;
    });
    return {
      coeff,
      pos: pos.map((p) => [Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0]),
      // matrix は行優先（実データ 90/90 で検証: プローブ位置を入れると重心座標が (1,0,0)/(0,1,0)/(0,0,1) になる）
      tets: tets.map((t) => {
        const m = t.matrix || {};
        return {
          i: [Number(t['indices[0]']), Number(t['indices[1]']), Number(t['indices[2]']), Number(t['indices[3]'])],
          m: [m.e00, m.e01, m.e02, m.e10, m.e11, m.e12, m.e20, m.e21, m.e22].map(Number),
        };
      }),
    };
  }
  return null;
}

// Unity と同じで、点を含む四面体の重心座標で4つのプローブを混ぜる。
// 凸包の外に出た点は、いちばん内側に近い四面体でクランプする（Unity は m_HullRays を使う）。
function probeShAt(lp, x, y, z) {
  let best = null;
  let bestScore = -Infinity;
  for (const t of lp.tets) {
    const p3 = lp.pos[t.i[3]];
    if (!p3) continue;
    const dx = x - p3[0],
      dy = y - p3[1],
      dz = z - p3[2];
    const b0 = t.m[0] * dx + t.m[1] * dy + t.m[2] * dz;
    const b1 = t.m[3] * dx + t.m[4] * dy + t.m[5] * dz;
    const b2 = t.m[6] * dx + t.m[7] * dy + t.m[8] * dz;
    const b3 = 1 - b0 - b1 - b2;
    const score = Math.min(b0, b1, b2, b3);
    if (score > bestScore) {
      bestScore = score;
      best = [t, b0, b1, b2, b3];
      if (score >= 0) break;
    }
  }
  if (!best) return null;
  const [t, ...b] = best;
  if (bestScore < 0) {
    for (let k = 0; k < 4; k++) b[k] = Math.max(0, b[k]);
    const s = b[0] + b[1] + b[2] + b[3] || 1;
    for (let k = 0; k < 4; k++) b[k] /= s;
  }
  const out = [];
  for (let c = 0; c < 9; c++) {
    const v = [0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const sh = lp.coeff[t.i[k]];
      if (!sh) continue;
      v[0] += sh[c][0] * b[k];
      v[1] += sh[c][1] * b[k];
      v[2] += sh[c][2] * b[k];
    }
    out.push(v);
  }
  return out;
}

const SH_C = [0.2820948, 0.325735, 0.2731371, 0.0788479, 0.1365686];
function sampleSH(sh, nx, ny, nz, out) {
  for (let k = 0; k < 3; k++) {
    let r = SH_C[0] * sh[0][k];
    r += SH_C[1] * (sh[1][k] * ny + sh[2][k] * nz + sh[3][k] * nx);
    r += SH_C[2] * (sh[4][k] * nx * ny + sh[5][k] * ny * nz + sh[7][k] * nx * nz);
    r += SH_C[3] * sh[6][k] * (3 * nz * nz - 1);
    r += SH_C[4] * sh[8][k] * (nx * nx - ny * ny);
    out[k] = linearToSrgb(Math.max(0, r));
  }
  return out;
}

// Unity が unity_SHAr..unity_SHC へ詰める形（LightProbes.cpp の fC0..fC4）。
// sh[係数][チャンネル] の並びは m_AmbientProbe と同じ。
function shConstants(sh) {
  const [fC0, fC1, fC2, fC3, fC4] = SH_C;
  const out = {};
  const names = ['unity_SHAr', 'unity_SHAg', 'unity_SHAb'];
  const namesB = ['unity_SHBr', 'unity_SHBg', 'unity_SHBb'];
  for (let k = 0; k < 3; k++) {
    out[names[k]] = [sh[3][k] * fC1, sh[1][k] * fC1, sh[2][k] * fC1, sh[0][k] * fC0 - sh[6][k] * fC3];
    out[namesB[k]] = [sh[4][k] * fC2, sh[5][k] * fC2, sh[6][k] * fC3 * 3, sh[7][k] * fC2];
  }
  out.unity_SHC = [sh[8][0] * fC4, sh[8][1] * fC4, sh[8][2] * fC4, 1];
  return out;
}

// Unity の unity_FogParams。x,y は Exp/Exp2 用、z,w は Linear 用。
function fogParams(rs) {
  const d = Number(rs.m_FogDensity) || 0;
  const s = Number(rs.m_LinearFogStart) || 0;
  const e = Number(rs.m_LinearFogEnd) || 0;
  const span = e - s || 1;
  return [d * 1.2011224087, d * 1.4426950408, -1 / span, e / span];
}

function bakeAmbientColors(T, geo, sh) {
  const nrm = geo.attributes.normal;
  if (!nrm) return null;
  const col = new Float32Array(nrm.count * 3);
  const tmp = [0, 0, 0];
  for (let i = 0; i < nrm.count; i++) {
    sampleSH(sh, nrm.getX(i), nrm.getY(i), nrm.getZ(i), tmp);
    col[i * 3] = tmp[0];
    col[i * 3 + 1] = tmp[1];
    col[i * 3 + 2] = tmp[2];
  }
  return new T.BufferAttribute(col, 3);
}

const TP_TO_LINEAR = 'vec3 tpToLinear(vec3 c){vec3 hi=pow((max(c,vec3(0.0))+0.055)/1.055,vec3(2.4));vec3 lo=c/12.92;return mix(hi,lo,step(c,vec3(0.04045)));}\n';

// 霧（実ゲームの焼き込み GLSL と同じ式。field-shader.js の FOG_FN と同一）。
const TP_FOG = [
  'uniform vec4 uTpFogParams;',
  'uniform vec3 uTpFogColor;',
  'uniform vec2 uTpFogControl;',
  'varying float vTpFogZ;',
  'vec3 tpMixFog( vec3 c ) {',
  '  float z = max( vTpFogZ - uTpFogControl.y, 0.0 );',
  '  float fi;',
  '  if ( uTpFogControl.x < 1.5 ) fi = clamp( z * uTpFogParams.z + uTpFogParams.w, 0.0, 1.0 );',
  '  else if ( uTpFogControl.x < 2.5 ) fi = min( exp2( -( uTpFogParams.x * z ) ), 1.0 );',
  '  else { float t = uTpFogParams.x * z; fi = min( exp2( -( t * t ) ), 1.0 ); }',
  '  return mix( uTpFogColor, c, fi );',
  '}',
].join('\n');

// URP の Lit / Simple Lit フラグメント（WebGL版バンドルの実GLSL）を式のまま移した直接光。
// Baked Lit は直接光を一切持たないので対象外。
const TP_DIRECT = [
  '#if defined( TP_LIT ) || defined( TP_BLINN )',
  '  {',
  '    vec3 tpAlbedo = diffuseColor.rgb;',
  '    vec3 tpN = normalize( vTpNormal );',
  '    float tpAtten = 1.0;',
  '    #ifdef TP_SHADOW',
  '      vec4 tpSc = uShadowMatrix * vec4( vTpWorld, 1.0 );',
  '      tpSc.xyz /= tpSc.w;',
  '      if ( tpSc.x > 0.0 && tpSc.x < 1.0 && tpSc.y > 0.0 && tpSc.y < 1.0 && tpSc.z < 1.0 )',
  '        tpAtten = mix( 1.0, texture( uShadowMap, tpSc.xyz ), uShadowStrength );',
  '    #endif',
  '    vec3 tpRadiance = uLightColor * clamp( dot( tpN, uLightDir ), 0.0, 1.0 ) * tpAtten;',
  '    #ifdef TP_LIT',
  '      vec3 tpV = normalize( cameraPosition - vTpWorld );',
  '      float tpPr = 1.0 - diffuseColor.a * uSmoothness;',
  '      float tpRough = max( tpPr * tpPr, 0.0078125 );',
  '      float tpOneMinusRefl = 0.96 - 0.96 * uMetallic;',
  '      vec3 tpDiff = tpAlbedo * tpOneMinusRefl;',
  '      vec3 tpSpec = mix( vec3( 0.04 ), tpAlbedo, uMetallic );',
  '      vec3 tpIndirect = tpGi * tpDiff;',
  '      #ifdef TP_SPECCUBE',
  '        vec3 tpEnv = textureLod( uSpecCube, reflect( -tpV, tpN ), tpPr * ( 1.7 - 0.7 * tpPr ) * 6.0 ).rgb;',
  '        float tpFresnel = pow( 1.0 - clamp( dot( tpN, tpV ), 0.0, 1.0 ), 4.0 );',
  '        float tpGrazing = clamp( diffuseColor.a * uSmoothness + ( 1.0 - tpOneMinusRefl ), 0.0, 1.0 );',
  '        tpIndirect += tpEnv * ( mix( tpSpec, vec3( tpGrazing ), tpFresnel ) / ( tpRough * tpRough + 1.0 ) );',
  '      #endif',
  '      vec3 tpH = normalize( tpV + uLightDir );',
  '      float tpLoH = clamp( dot( uLightDir, tpH ), 0.0, 1.0 );',
  '      float tpNoH = clamp( dot( tpN, tpH ), 0.0, 1.0 );',
  '      float tpD = tpNoH * tpNoH * ( tpRough * tpRough - 1.0 ) + 1.00001;',
  '      float tpSpecTerm = ( tpRough * tpRough ) / ( tpD * tpD * max( tpLoH * tpLoH, 0.1 ) * ( tpRough * 4.0 + 2.0 ) );',
  '      outgoingLight = tpIndirect + ( tpSpec * tpSpecTerm + tpDiff ) * tpRadiance;',
  '    #else',
  '      outgoingLight = ( tpGi + tpRadiance ) * tpAlbedo;',
  '    #endif',
  '  }',
  '#endif',
].join('\n');

function gammaPipeline(T, opts, o) {
  const uniforms = {};
  const defines = {};
  const needNormal = !!(o.dirLightMap || o.lighting);
  if (o.dirLightMap) {
    uniforms.uDirLightMap = { value: o.dirLightMap };
    defines.TP_DIRLM = '';
  }
  if (o.emission) {
    uniforms.uEmission = { value: new T.Vector3(o.emission[0], o.emission[1], o.emission[2]) };
    defines.TP_EMISSION = '';
    if (o.emissionMap && opts.map) {
      uniforms.uEmissionMap = { value: o.emissionMap };
      defines.TP_EMISSIONMAP = '';
    }
  }
  if (o.lighting) {
    uniforms.uLightDir = { value: new T.Vector3(o.light.dir[0], o.light.dir[1], o.light.dir[2]) };
    uniforms.uLightColor = { value: new T.Vector3(o.light.color[0], o.light.color[1], o.light.color[2]) };
    defines[o.lighting === 'lit' ? 'TP_LIT' : 'TP_BLINN'] = '';
    if (o.sh) defines.TP_SH = '';
    if (o.shadow) {
      defines.TP_SHADOW = '';
      uniforms.uShadowMap = { value: null };
      uniforms.uShadowMatrix = { value: new T.Matrix4() };
      uniforms.uShadowStrength = { value: o.light.shadow.strength };
      o.shadow.push(uniforms);
    }
    if (o.lighting === 'lit') {
      uniforms.uSmoothness = { value: o.smoothness };
      uniforms.uMetallic = { value: o.metallic };
      if (o.specCube) {
        uniforms.uSpecCube = { value: o.specCube };
        defines.TP_SPECCUBE = '';
      }
    }
  }
  if (o.fog && o.fog.mode) {
    defines.TP_FOG = '';
    uniforms.uTpFogParams = { value: o.fog.params.slice() };
    uniforms.uTpFogColor = { value: o.fog.color.slice() };
    uniforms.uTpFogControl = { value: [o.fog.mode, 0.05] };
    if (o.fogUniforms) o.fogUniforms.push(uniforms);
  }
  const key = 'tp-field|' + Object.keys(defines).sort().join('+');
  return (m) => {
    m.defines = Object.assign(m.defines || {}, defines);
    m.customProgramCacheKey = () => key;
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      if (needNormal || defines.TP_FOG != null) {
        let vs = shader.vertexShader;
        if (needNormal)
          vs = vs.replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\n\tvTpNormal = mat3( modelMatrix ) * normal;\n\tvTpWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;' + (defines.TP_SH != null ? '\n\tvTpSH = aTpSH;' : ''),
          );
        if (defines.TP_FOG != null) vs = vs.replace('#include <project_vertex>', '#include <project_vertex>\n\tvTpFogZ = gl_Position.w;');
        shader.vertexShader =
          (needNormal ? 'varying vec3 vTpNormal;\nvarying vec3 vTpWorld;\n' : '') +
          (defines.TP_SH != null ? 'attribute vec3 aTpSH;\nvarying vec3 vTpSH;\n' : '') +
          (defines.TP_FOG != null ? 'varying float vTpFogZ;\n' : '') +
          vs;
      }
      shader.fragmentShader =
        TP_TO_LINEAR +
        (needNormal ? 'varying vec3 vTpNormal;\nvarying vec3 vTpWorld;\n' : '') +
        (defines.TP_SH != null ? 'varying vec3 vTpSH;\n' : '') +
        (o.dirLightMap ? 'uniform sampler2D uDirLightMap;\n' : '') +
        (o.emission ? 'uniform vec3 uEmission;\n' : '') +
        (defines.TP_EMISSIONMAP != null ? 'uniform sampler2D uEmissionMap;\n' : '') +
        (o.lighting ? 'uniform vec3 uLightDir;\nuniform vec3 uLightColor;\n' : '') +
        (defines.TP_LIT != null ? 'uniform float uSmoothness;\nuniform float uMetallic;\n' : '') +
        (defines.TP_SPECCUBE != null ? 'uniform samplerCube uSpecCube;\n' : '') +
        (defines.TP_SHADOW != null ? 'uniform highp sampler2DShadow uShadowMap;\nuniform mat4 uShadowMatrix;\nuniform float uShadowStrength;\n' : '') +
        (defines.TP_FOG != null ? TP_FOG + '\n' : '') +
        shader.fragmentShader
          .replace(
            '#ifdef USE_LIGHTMAP\n\t\tvec4 lightMapTexel = texture2D( lightMap, vLightMapUv );\n\t\treflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;\n\t#else\n\t\treflectedLight.indirectDiffuse += vec3( 1.0 );\n\t#endif',
            'vec3 tpGi = vec3( 1.0 );\n\t#ifdef USE_LIGHTMAP\n\t\tvec4 lightMapTexel = texture2D( lightMap, vLightMapUv );\n\t\ttpGi = lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;\n\t\t#ifdef TP_DIRLM\n\t\t\tvec4 tpDir = texture2D( uDirLightMap, vLightMapUv );\n\t\t\ttpGi = tpGi * ( dot( normalize( vTpNormal ), tpDir.xyz - 0.5 ) + 0.5 ) / max( tpDir.w, 1e-4 );\n\t\t#endif\n\t#endif\n\t#ifdef TP_SH\n\t\ttpGi = vTpSH;\n\t#endif\n\treflectedLight.indirectDiffuse += tpGi;',
          )
          .replace(
            'vec3 outgoingLight = reflectedLight.indirectDiffuse;',
            'vec3 outgoingLight = reflectedLight.indirectDiffuse;\n' +
              TP_DIRECT +
              '\n\t#ifdef TP_EMISSION\n\t\t#ifdef TP_EMISSIONMAP\n\t\t\toutgoingLight += uEmission * texture2D( uEmissionMap, vMapUv ).rgb;\n\t\t#else\n\t\t\toutgoingLight += uEmission;\n\t\t#endif\n\t#endif\n\t#ifdef TP_FOG\n\t\toutgoingLight = tpMixFog( outgoingLight );\n\t#endif\n\toutgoingLight = tpToLinear( outgoingLight );',
          );
    };
  };
}

function threeMaterial(T, mat, texByPid, lightMap, dirLightMap, env) {
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
  const shader = String((mat && mat.shaderName) || '');
  const lighting = /^Universal Render Pipeline\/Lit$/.test(shader) ? 'lit' : /^Universal Render Pipeline\/Simple Lit$/.test(shader) ? 'blinn' : null;
  const lit = !lightMap && mat && LIT_SHADER.test(shader);
  if (lit && !lighting) opts.vertexColors = true;
  const c = (mat && mat.color) || null;
  const base = Array.isArray(c) ? c : c ? [c.r ?? 1, c.g ?? 1, c.b ?? 1] : [1, 1, 1];
  if (c) opts.color = new T.Color(base[0], base[1], base[2]);
  if (mat && mat.cutoff != null && mat.alphaClip === 1) {
    opts.alphaTest = mat.cutoff;
    opts.transparent = false;
  } else if (mat && mat.transparent) {
    opts.transparent = true;
    opts.depthWrite = mat.zwrite === 1;
    if (Number(mat.srcBlend) === 1 && Number(mat.dstBlend) === 1) opts.blending = T.AdditiveBlending;
  }
  const em = emissionOf(mat);
  const emMap = em && mat.texByName && mat.texByName._EmissionMap ? (texByPid.get(String(mat.texByName._EmissionMap)) || {}).tex : null;
  const f = (mat && mat.allFloats) || {};
  const m = new T.MeshBasicMaterial(opts);
  gammaPipeline(T, opts, {
    dirLightMap: lightMap ? dirLightMap : null,
    emission: em,
    emissionMap: emMap,
    lighting: env && env.light ? lighting : null,
    light: env && env.light,
    shadow: env && env.light && lighting && env.light.shadow && env.light.shadow.strength > 0 && !(mat && mat.keywords && mat.keywords.has('_RECEIVE_SHADOWS_OFF')) ? env.shadowUniforms : null,
    sh: !lightMap,
    smoothness: Number(f._Smoothness) || 0,
    metallic: Number(f._Metallic) || 0,
    specCube: env && env.specCube,
    fog: env && env.fog,
    fogUniforms: env && env.fogUniforms,
  })(m);
  return m;
}

function emissionOf(mat) {
  const c = mat && mat.allColors && mat.allColors._EmissionColor;
  if (!c) return null;
  const on = !mat.keywords || mat.keywords.has('_EMISSION');
  if (!on) return null;
  return c[0] + c[1] + c[2] > 0.001 ? [c[0], c[1], c[2]] : null;
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

  const bptc = !opt || opt.bptc !== false;
  const { mats, texByPid, cubeByPid, rawByPid } = buildTextures(T, bytes, (opt && opt.maxAniso) || 1);
  const matByPid = new Map(mats.map((m) => [String(m.pathID), m]));

  const sf = parsed.data.subarray(main.off, main.off + main.sz);
  const sfp = unitySf.parseSerializedFile(sf);

  const lightMaps = [];
  const dirLightMaps = [];
  for (const o of sfp.objects) {
    if (o.classID !== CLS.LIGHTMAP_SETTINGS) continue;
    try {
      const ls = unitySf.readObject(sf, sfp.LE, o);
      for (const entry of ls.m_Lightmaps || []) {
        lightMaps.push(lightmapTexture(T, rawByPid.get(pid(entry.m_Lightmap)), bptc));
        dirLightMaps.push(lightmapTexture(T, rawByPid.get(pid(entry.m_DirLightmap)), bptc));
      }
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
  const env = { light: null, specCube: null, specCubeRT: null, globals: {}, rsRead: false, shadowUniforms: [], fog: null, fogUniforms: [] };
  const fieldMats = [];
  const matCache = new Map();
  const materialFor = (p, lmIndex, shOverride, shKey) => {
    const k = `${p || ''}|${lmIndex}|${shKey || ''}`;
    if (matCache.has(k)) return matCache.get(k);
    const mat = matByPid.get(String(p || ''));
    let m = null;
    if (mat && hasFieldShader(mat.shaderName)) {
      const lm = lmIndex >= 0 ? lightMaps[lmIndex] : null;
      const dir = lmIndex >= 0 ? dirLightMaps[lmIndex] : null;
      try {
        m = makeFieldMaterial(T, mat.shaderName, mat, {
          textureOf: (pid) => (texByPid.get(String(pid)) || {}).tex || null,
          white,
          side: (x) => sideOf(T, x),
          gi: lm ? (dir ? 'lmdir' : 'lm') : 'sh',
          scene: shOverride ? Object.assign({}, env.globals, shConstants(shOverride)) : env.globals,
          cube: () => env.specCube,
          sceneTexture: (name) => (name === 'unity_Lightmap' ? lm : name === 'unity_LightmapInd' ? dir : undefined),
          fogMode: env.fog ? env.fog.mode : 0,
          fogParams: env.fog ? env.fog.params : null,
          fogColor: env.fog ? env.fog.color : null,
        });
      } catch (e) {
        m = null;
      }
      if (m) fieldMats.push(m);
    }
    if (!m) m = threeMaterial(T, mat, texByPid, lmIndex >= 0 ? lightMaps[lmIndex] : null, lmIndex >= 0 ? dirLightMaps[lmIndex] : null, env);
    matCache.set(k, m);
    return m;
  };
  const usesFieldShader = (p) => {
    const mat = matByPid.get(String(p || ''));
    return !!(mat && hasFieldShader(mat.shaderName));
  };
  const queueOf = (p) => {
    const mat = matByPid.get(String(p || ''));
    const q = mat ? Number(mat.renderQueue) : 0;
    return q > 0 ? q : 2000;
  };
  const byId = new Map(sfp.objects.map((o) => [String(o.pathID), o]));

  const sharedNode = cabs.find((n) => /sharedAssets$/.test(n.path));
  let ssf = null;
  let ssfp = null;
  let lightProbes = null;
  const ssById = new Map();
  if (sharedNode) {
    try {
      ssf = parsed.data.subarray(sharedNode.off, sharedNode.off + sharedNode.sz);
      ssfp = unitySf.parseSerializedFile(ssf);
      for (const o of ssfp.objects) ssById.set(String(o.pathID), o);
      lightProbes = lightProbesOf(ssf, ssfp);
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

  for (const o of sfp.objects) {
    if (o.classID === CLS.RENDER_SETTINGS && !env.rsRead) {
      try {
        const rs = unitySf.readObject(sf, sfp.LE, o);
        env.rsRead = true;
        const ref = rs.m_CustomReflection && pid(rs.m_CustomReflection) !== '0' ? rs.m_CustomReflection : rs.m_GeneratedSkyboxReflection;
        const rec = ref ? cubeByPid.get(pid(ref)) : null;
        if (rec) {
          env.specCube = cubeTexture(T, rec, 1);
          env.specCube.colorSpace = T.LinearSRGBColorSpace || 'srgb-linear';
        } else {
          const made = skyboxCube(T, opt && opt.renderer, skyboxInfo(T, rs, matByPid, cubeByPid, texByPid));
          env.specCube = made.tex;
          env.specCubeRT = made.rt;
        }
        const fc = rs.m_FogColor || {};
        Object.assign(env.globals, shConstants(ambient), {
          unity_LightmapST: [1, 1, 0, 0],
          unity_SpecCube0_HDR: [1, 1, 0, 0],
          _MainLightCookieTextureFormat: -1,
          unity_LightData: [0, 0, 1, 0],
          unity_FogColor: [Number(fc.r) || 0, Number(fc.g) || 0, Number(fc.b) || 0, 1],
          unity_FogParams: rs.m_Fog ? fogParams(rs) : [0, 0, 0, 0],
        });
        if (rs.m_Fog) env.fog = { mode: Number(rs.m_FogMode) || 1, params: fogParams(rs), color: [Number(fc.r) || 0, Number(fc.g) || 0, Number(fc.b) || 0] };
      } catch (e) {}
    } else if (o.classID === CLS.LIGHT && !env.light) {
      try {
        const l = unitySf.readObject(sf, sfp.LE, o);
        if (Number(l.m_Type) !== 1 || Number(l.m_Lightmapping) === 2) continue;
        const c = l.m_Color || { r: 1, g: 1, b: 1 };
        const e = worldMatrix(pid(l.m_GameObject)).elements;
        const len = Math.hypot(e[8], e[9], e[10]) || 1;
        const k = Number(l.m_Intensity) || 1;
        const sh = l.m_Shadows || {};
        const type = Number(sh.m_Type) || 0;
        const strength = type === 0 ? 0 : sh.m_Strength == null ? 1 : Number(sh.m_Strength);
        env.light = {
          intensity: k,
          r: c.r,
          g: c.g,
          b: c.b,
          dir: [-e[8] / len, -e[9] / len, -e[10] / len],
          color: [c.r * k, c.g * k, c.b * k],
          shadow: { type, strength, bias: Number(sh.m_Bias) || 0, normalBias: Number(sh.m_NormalBias) || 0 },
        };
        env.globals._MainLightPosition = [env.light.dir[0], env.light.dir[1], env.light.dir[2], 0];
        env.globals._MainLightColor = [c.r * k, c.g * k, c.b * k, 1];
        // Unity と同じ lerp(1, shadow, strength)。影 Off のマップは strength=0 で影が消える。
        // z/w は距離フェード（0 にすると無効）。y はソフト影のタップ数選択で、0 なら単発サンプル。
        env.globals._MainLightShadowParams = [strength, 0, 0, 0];
        // カスケードは1枚に固定する（半径を巨大にすると ComputeCascadeIndex が必ず 0 を返す）。
        env.globals._CascadeShadowSplitSpheres0 = [0, 0, 0, 0];
        env.globals._CascadeShadowSplitSpheres1 = [0, 0, 0, 0];
        env.globals._CascadeShadowSplitSpheres2 = [0, 0, 0, 0];
        env.globals._CascadeShadowSplitSpheres3 = [0, 0, 0, 0];
        env.globals._CascadeShadowSplitSphereRadii = [1e18, 1e18, 1e18, 1e18];
      } catch (e) {}
    }
  }

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
          t4[i * 4 + 3] = geo.tangentW ? geo.tangentW[i] : 1;
        }
        a.tangent = new T.BufferAttribute(t4, 4);
      }
      attrCache.set(geo, a);
    }
    return attrCache.get(geo);
  };
  const centerCache = new Map();
  const centerOf = (geo, matrix) => {
    let c = centerCache.get(geo);
    if (!c) {
      const P = geo.positions;
      let x0 = Infinity,
        y0 = Infinity,
        z0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity,
        z1 = -Infinity;
      for (let i = 0; i < P.length; i += 3) {
        if (P[i] < x0) x0 = P[i];
        if (P[i] > x1) x1 = P[i];
        if (P[i + 1] < y0) y0 = P[i + 1];
        if (P[i + 1] > y1) y1 = P[i + 1];
        if (P[i + 2] < z0) z0 = P[i + 2];
        if (P[i + 2] > z1) z1 = P[i + 2];
      }
      c = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
      centerCache.set(geo, c);
    }
    if (!matrix) return c;
    const v = new T.Vector3(c[0], c[1], c[2]).applyMatrix4(matrix);
    return [v.x, v.y, v.z];
  };
  let probeSeq = 0;
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
    // ライトマップを持たないレンダラは、Unity と同じくレンダラ1点（bbox 中心）で
    // ベイク済み LightProbes を四面体補間して使う。プローブが無いマップは従来どおり ambient probe。
    let probeSh = null;
    let probeKey = '';
    if (lightProbes && parts.some((p) => !(p.lm && geo.uv1))) {
      const c = centerOf(geo, matrix);
      probeSh = probeShAt(lightProbes, c[0], c[1], c[2]);
      if (probeSh) probeKey = 'pb' + ++probeSeq;
    }
    if (parts.some((p) => !(p.lm && geo.uv1))) {
      const vc = bakeAmbientColors(T, g, probeSh || ambient);
      if (vc) {
        g.setAttribute('color', vc);
        g.setAttribute('aTpSH', vc);
      }
    }
    const matList = [];
    const matIndex = new Map();
    for (const p of parts) {
      const key = `${p.matPid || ''}|${p.lm && geo.uv1 ? p.lm.index : -1}`;
      if (!matIndex.has(key)) {
        matIndex.set(key, matList.length);
        const useProbe = probeSh && !(p.lm && geo.uv1);
        matList.push(materialFor(p.matPid, p.lm && geo.uv1 ? p.lm.index : -1, useProbe ? probeSh : null, useProbe ? probeKey : ''));
      }
      g.addGroup(p.start, p.count, matIndex.get(key));
      drawn++;
    }
    const mesh = new T.Mesh(g, matList);
    mesh.frustumCulled = false;
    const qs = new Set(parts.map((p) => queueOf(p.matPid)));
    if (qs.size === 1 && !qs.has(2000)) mesh.renderOrder = [...qs][0] - 2000;
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
        const sky = skyboxInfo(T, rs, matByPid, cubeByPid, texByPid);
        const skyMat = sky.mat,
          skyCube = sky.cube,
          skyTex = sky.tex,
          exposure = sky.exposure;
        backgroundRotation = sky.rotation;
        if (skyCube) {
          background = cubeTexture(T, skyCube, exposure);
        } else if (skyTex) {
          background = skyTexture(T, skyTex, exposure);
        } else if (skyMat) {
          background = flatSkyColor(T, skyMat, exposure);
        } else {
          const a = rs.m_AmbientSkyColor || { r: 0.2, g: 0.22, b: 0.26 };
          background = new T.Color(Math.min(1, a.r), Math.min(1, a.g), Math.min(1, a.b));
        }
      } catch (e) {}
    }
  }

  group.__dispose = () => {
    if (env.specCubeRT) env.specCubeRT.dispose();
    else if (env.specCube) env.specCube.dispose();
    for (const g of owned) g.dispose();
    for (const m of matCache.values()) m.dispose();
    for (const t of texByPid.values()) t.tex.dispose();
    for (const t of lightMaps) if (t) t.dispose();
    for (const t of dirLightMaps) if (t) t.dispose();
    if (env.specCube) env.specCube.dispose();
    if (background && background.isTexture) background.dispose();
  };
  return {
    group,
    fog,
    background,
    backgroundRotation,
    backgroundIntensity,
    light: env.light,
    origin,
    meshCount: drawn,
    lightmaps: lightMaps.filter(Boolean).length,
    fieldMats,
    shadowUniforms: env.shadowUniforms,
    fogUniforms: env.fogUniforms,
  };
}

export { gammaPipeline };
