import { FIELD_SHADERS } from './shaders/field-shaders.js';

let disabled = false;
const GAME_NEAR = 0.3;
export const hasFieldShader = (name) => !disabled && !!FIELD_SHADERS[String(name || '')];

export function noteShaderError(gl, program, vs) {
  let name = '';
  try {
    name = (/\/\/ FIELD (.+)/.exec(gl.getShaderSource(vs) || '') || [])[1] || '';
  } catch (e) {}
  if (!name) return null;
  disabled = true;
  return name;
}

const cols = (m) => m.elements;

const zeroVec4 = () => [0, 0, 0, 0];
const GLOBAL_INIT = {
  _TimeParameters: zeroVec4,
  _ProjectionParams: () => [1, 0.05, 5000, 1 / 5000],
  _ZBufferParams: zeroVec4,
  _ScaledScreenParams: () => [1, 1, 2, 2],
  _ScreenParams: () => [1, 1, 2, 2],
  unity_OrthoParams: () => [0, 0, 0, 0],
  _GlobalMipBias: () => [0, 0],
  _WorldSpaceCameraPos: () => [0, 0, 0],
  unity_WorldTransformParams: () => [0, 0, 0, 1],
  hlslcc_mtx4x4unity_MatrixV: () => new Float32Array(16),
  hlslcc_mtx4x4unity_MatrixInvV: () => new Float32Array(16),
  hlslcc_mtx4x4unity_MatrixVP: () => new Float32Array(16),
  hlslcc_mtx4x4unity_MatrixInvVP: () => new Float32Array(16),
  hlslcc_mtx4x4unity_MatrixP: () => new Float32Array(16),
  _MainLightPosition: () => [0, 1, 0, 0],
  _MainLightColor: () => [1, 1, 1, 1],
  _MainLightCookieTextureFormat: () => -1,
  unity_LightData: () => [0, 0, 1, 0],
  unity_SpecCube0_HDR: () => [1, 1, 0, 0],
  unity_LightmapST: () => [1, 1, 0, 0],
  _MainLightShadowParams: () => [0, 0, 0, 0],
  _MainLightShadowmapSize: () => [1, 1, 1, 1],
  hlslcc_mtx4x4_MainLightWorldToShadow: () => new Float32Array(80),
};

const SHADOW_SAMPLERS = new Set(['hlslcc_zcmp_MainLightShadowmapTexture', '_MainLightShadowmapTexture']);

function propValue(T, mat, p) {
  const floats = (mat && mat.allFloats) || {};
  const colors = (mat && mat.allColors) || {};
  const st = (mat && mat.texST) || {};
  if (p.type === 'float') return Number(floats[p.name]) || 0;
  const n = p.type === 'vec2' ? 2 : p.type === 'vec3' ? 3 : 4;
  const m = /^(_.*)_ST$/.exec(p.name);
  if (m && st[m[1]]) return st[m[1]].slice(0, n);
  const c = colors[p.name];
  if (c) return [c[0], c[1], c[2], c[3]].slice(0, n);
  const f = floats[p.name];
  if (f != null) return new Array(n).fill(Number(f));
  return new Array(n).fill(0);
}

const FOG_FN =
  'uniform vec4 tpFogParams;\nuniform vec4 tpFogColor;\nuniform vec4 tpFogControl;\nin highp float tpFogZ;\n' +
  'vec3 tpMixFog(vec3 c){\n' +
  '  float mode = tpFogControl.x;\n' +
  '  if (mode < 0.5) return c;\n' +
  '  float z = max(tpFogZ - tpFogControl.y, 0.0);\n' +
  '  float fi;\n' +
  '  if (mode < 1.5) fi = clamp(z * tpFogParams.z + tpFogParams.w, 0.0, 1.0);\n' +
  '  else if (mode < 2.5) fi = min(exp2(-(tpFogParams.x * z)), 1.0);\n' +
  '  else { float t = tpFogParams.x * z; fi = min(exp2(-(t * t)), 1.0); }\n' +
  '  return mix(tpFogColor.rgb, c, fi);\n' +
  '}\n';

const CHAR_SHADOW_FN =
  'uniform highp sampler2DShadow tpCharShadowMap;\nuniform mat4 tpCharShadowMatrix;\nuniform float tpCharShadowStrength;\nin highp vec3 tpCharW;\n' +
  'float tpCharShadow(){\n' +
  '  if (tpCharShadowStrength <= 0.0) return 1.0;\n' +
  '  vec4 c = tpCharShadowMatrix * vec4(tpCharW, 1.0);\n' +
  '  c.xyz /= c.w;\n' +
  '  if (c.x <= 0.0 || c.x >= 1.0 || c.y <= 0.0 || c.y >= 1.0 || c.z >= 1.0) return 1.0;\n' +
  '  return mix(1.0, texture(tpCharShadowMap, c.xyz), tpCharShadowStrength);\n' +
  '}\n';

const TO_LINEAR_FN = 'uniform float uTpEncode;\n' + 'vec3 tpToLinear(vec3 c){vec3 hi=pow((max(c,vec3(0.0))+0.055)/1.055,vec3(2.4));vec3 lo=c/12.92;return mix(hi,lo,step(c,vec3(0.04045)));}\n';

const wrapCache = new Map();

function wrapOutput(frag, fog, charShadow) {
  if (!/\bvoid\s+main\s*\(\s*\)/.test(frag) || !/\bSV_Target0\b/.test(frag)) return frag;
  const key = (fog ? 1 : 0) | (charShadow ? 2 : 0);
  let byKey = wrapCache.get(frag);
  if (byKey && byKey.has(key)) return byKey.get(key);
  if (!byKey) wrapCache.set(frag, (byKey = new Map()));
  const body = frag.replace(/\bvoid\s+main\s*\(\s*\)/, 'void tpUnityMain()');
  const out =
    body +
    '\n' +
    (fog ? FOG_FN : '') +
    (charShadow ? CHAR_SHADOW_FN : '') +
    TO_LINEAR_FN +
    'void main(){tpUnityMain();' +
    (charShadow ? 'SV_Target0.rgb=SV_Target0.rgb*tpCharShadow();' : '') +
    (fog ? 'SV_Target0.rgb=tpMixFog(SV_Target0.rgb);' : '') +
    'SV_Target0.rgb=mix(SV_Target0.rgb, tpToLinear(SV_Target0.rgb), uTpEncode);' +
    '}\n';
  byKey.set(key, out);
  return out;
}

function addVaryings(vert, fog, charShadow) {
  if (!/\bvoid\s+main\s*\(\s*\)/.test(vert) || !/gl_Position/.test(vert)) return vert;
  let out = vert.replace(/\bvoid\s+main\s*\(\s*\)/, (fog ? 'out highp float tpFogZ;\n' : '') + (charShadow ? 'out highp vec3 tpCharW;\n' : '') + 'void main()');
  if (fog) out = out.replace(/(gl_Position\s*=[^;]*;)/g, '$1\n    tpFogZ = gl_Position.w;');
  if (charShadow) out = out.replace(/(gl_Position\s*=[^;]*;)/g, '$1\n    tpCharW = (modelMatrix * vec4(position, 1.0)).xyz;');
  return out;
}

function fullHdrLightmap(frag, isFullHdr) {
  if (!isFullHdr || !/texture\(unity_Lightmap,/.test(frag)) return frag;
  const m = /(\bu_xlat\w*)\s*=\s*texture\(unity_Lightmap,/.exec(frag);
  if (!m) return frag;
  const re = new RegExp('\\b' + m[1] + '\\.w\\s*\\*\\s*5\\.0\\b', 'g');
  const out = frag.replace(re, '1.0');
  return out === frag ? frag : out;
}

export function makeFieldMaterial(T, shaderName, mat, deps) {
  const base = String(shaderName || '');
  const g = (deps.gi && FIELD_SHADERS[base + '|' + deps.gi]) || FIELD_SHADERS[base];
  if (!g || !g.vert || !g.frag) return null;
  const scene = deps.scene || {};
  const uniforms = {};
  const noShadow = !!(mat && mat.keywords && mat.keywords.has('_RECEIVE_SHADOWS_OFF'));
  for (const name of g.globals) {
    const v = scene[name] !== undefined ? scene[name] : (GLOBAL_INIT[name] || zeroVec4)();
    uniforms[name] = { value: noShadow && name === '_MainLightShadowParams' ? [0, 0, 0, 0] : v };
  }
  for (const p of g.props) uniforms[p.name] = { value: propValue(T, mat, p) };
  const needScene = [];
  const isCube = (s) => new RegExp('samplerCube\\s+' + s + '\\s*;').test(g.frag) || new RegExp('samplerCube\\s+' + s + '\\s*;').test(g.vert);
  for (const s of g.samplers) {
    if (s === '_CameraOpaqueTexture' || s === '_CameraDepthTexture') {
      uniforms[s] = { value: null };
      needScene.push(s);
      continue;
    }
    if (isCube(s)) {
      uniforms[s] = { value: (deps.cube && deps.cube(s)) || null };
      continue;
    }
    if (SHADOW_SAMPLERS.has(s)) {
      uniforms[s] = { value: null };
      needScene.push(s);
      continue;
    }
    const scenTex = deps.sceneTexture && deps.sceneTexture(s);
    if (scenTex !== undefined && scenTex !== null) {
      uniforms[s] = { value: scenTex };
      continue;
    }
    const pid = ((mat && mat.texByName) || {})[s];
    uniforms[s] = { value: (pid && deps.textureOf(pid)) || deps.white() };
  }
  const fog = !!deps.fogMode && !g.globals.includes('unity_FogParams');
  if (fog) {
    uniforms.tpFogParams = { value: deps.fogParams || [0, 0, 0, 0] };
    const fc = deps.fogColor || [0, 0, 0];
    uniforms.tpFogColor = { value: [fc[0] || 0, fc[1] || 0, fc[2] || 0, 1] };
    uniforms.tpFogControl = { value: [deps.fogMode, 0.05, 0, 0] };
  }
  const st = g.state || null;
  const floats = (mat && mat.allFloats) || {};
  const stVal = (v, fb) => {
    if (v == null) return fb;
    if (typeof v === 'string') return floats[v] == null ? fb : Number(floats[v]);
    return Number(v);
  };
  const src = stVal(st && st.src, mat && mat.srcBlend != null ? Number(mat.srcBlend) : 1);
  const dst = stVal(st && st.dst, mat && mat.dstBlend != null ? Number(mat.dstBlend) : 0);
  const transparent = dst !== 0;
  const zwrite = stVal(st && st.zw, mat && mat.zwrite === 0 ? 0 : 1) !== 0;
  const cull = stVal(st && st.cull, null);
  const charShadow = !!deps.charShadow;
  if (charShadow) {
    uniforms.tpCharShadowMap = { value: deps.charShadow.map };
    uniforms.tpCharShadowMatrix = { value: new T.Matrix4() };
    uniforms.tpCharShadowStrength = { value: 0 };
  }
  uniforms.uTpEncode = { value: 1 };
  if (deps.rtUniforms) deps.rtUniforms.push(uniforms);
  const lm = uniforms.unity_Lightmap && uniforms.unity_Lightmap.value;
  const m = new T.RawShaderMaterial({
    glslVersion: T.GLSL3,
    vertexShader: '// FIELD ' + shaderName + '\n' + addVaryings(g.vert, fog, charShadow),
    fragmentShader: fullHdrLightmap(wrapOutput(g.frag, fog, charShadow), lm && lm.userData && lm.userData.lightmapRgbm === false),
    uniforms,
    side: cull == null ? deps.side(mat) : cull === 0 ? T.DoubleSide : cull === 1 ? T.FrontSide : T.BackSide,
    transparent,
    depthWrite: zwrite,
    blending: transparent && src === 1 && dst === 1 ? T.AdditiveBlending : T.NormalBlending,
  });
  m.userData.fieldGlobals = g.globals;
  m.userData.fieldScene = needScene;
  return m;
}

const SHARED = {
  _TimeParameters: [0, 0, 0, 0],
  _ProjectionParams: [0, 0, 0, 0],
  _ZBufferParams: [0, 0, 0, 0],
  _ScaledScreenParams: [0, 0, 0, 0],
  _ScreenParams: [0, 0, 0, 0],
  _WorldSpaceCameraPos: [0, 0, 0],
  hlslcc_mtx4x4unity_MatrixV: null,
  hlslcc_mtx4x4unity_MatrixInvV: null,
  hlslcc_mtx4x4unity_MatrixVP: null,
  hlslcc_mtx4x4unity_MatrixInvVP: null,
  hlslcc_mtx4x4unity_MatrixP: null,
  hlslcc_mtx4x4_MainLightWorldToShadow: new Float32Array(80),
  _MainLightShadowmapSize: [0, 0, 0, 0],
};
const _vp = { m: null, invVP: null, invV: null };
const set4 = (a, x, y, z, w) => {
  a[0] = x;
  a[1] = y;
  a[2] = z;
  a[3] = w;
};

export function seedFieldShadowSamplers(mats, shadow) {
  const shadowMap = shadow && shadow.map ? shadow.map.depthTexture : null;
  for (const m of mats) {
    const u = m.uniforms;
    for (const s of m.userData.fieldScene || []) if (SHADOW_SAMPLERS.has(s) && u[s]) u[s].value = shadowMap;
  }
}

export function updateFieldUniforms(mats, T, ctx) {
  const { camera, time, width, height, opaque, depth, shadow, charShadow } = ctx;
  const shadowMap = shadow && shadow.map ? shadow.map.depthTexture : null;
  const shadowRows = shadow && shadow.matrix ? shadow.matrix.elements : null;
  if (!_vp.m) {
    _vp.m = new T.Matrix4();
    _vp.invVP = new T.Matrix4();
    _vp.invV = new T.Matrix4();
  }
  const vp = _vp.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const invVP = _vp.invVP.copy(vp).invert();
  const invV = _vp.invV.copy(camera.matrixWorldInverse).invert();
  const near = camera.near;
  const far = camera.far;

  set4(SHARED._TimeParameters, time, Math.sin(time), Math.cos(time), 0);
  set4(SHARED._ProjectionParams, 1, near, far, 1 / far);
  set4(SHARED._ZBufferParams, 1 - far / near, far / near, (1 - far / near) / far, far / near / far);
  set4(SHARED._ScaledScreenParams, width, height, 1 + 1 / width, 1 + 1 / height);
  set4(SHARED._ScreenParams, width, height, 1 + 1 / width, 1 + 1 / height);
  SHARED._WorldSpaceCameraPos[0] = camera.position.x;
  SHARED._WorldSpaceCameraPos[1] = camera.position.y;
  SHARED._WorldSpaceCameraPos[2] = camera.position.z;
  SHARED.hlslcc_mtx4x4unity_MatrixV = cols(camera.matrixWorldInverse);
  SHARED.hlslcc_mtx4x4unity_MatrixInvV = cols(invV);
  SHARED.hlslcc_mtx4x4unity_MatrixVP = cols(vp);
  SHARED.hlslcc_mtx4x4unity_MatrixInvVP = cols(invVP);
  SHARED.hlslcc_mtx4x4unity_MatrixP = cols(camera.projectionMatrix);
  if (shadowRows) SHARED.hlslcc_mtx4x4_MainLightWorldToShadow.set(shadowRows.subarray ? shadowRows.subarray(0, 16) : shadowRows.slice(0, 16), 0);
  if (shadow && shadow.mapSize) set4(SHARED._MainLightShadowmapSize, 1 / shadow.mapSize.x, 1 / shadow.mapSize.y, shadow.mapSize.x, shadow.mapSize.y);

  for (const m of mats) {
    const u = m.uniforms;
    for (const name of m.userData.fieldGlobals || []) {
      const slot = u[name];
      if (!slot) continue;
      const v = SHARED[name];
      if (v && slot.value !== v) slot.value = v;
    }
    if (u.tpFogControl) u.tpFogControl.value[1] = GAME_NEAR;
    if (u.tpCharShadowMap) {
      const on = !!(charShadow && charShadow.map && charShadow.strength > 0);
      u.tpCharShadowMap.value = charShadow && charShadow.map ? charShadow.map : null;
      u.tpCharShadowStrength.value = on ? charShadow.strength : 0;
      if (on) u.tpCharShadowMatrix.value.copy(charShadow.matrix);
    }
    for (const s of m.userData.fieldScene || []) {
      if (s === '_CameraOpaqueTexture' && u[s]) u[s].value = opaque;
      if (s === '_CameraDepthTexture' && u[s]) u[s].value = depth;
      if (SHADOW_SAMPLERS.has(s) && u[s]) u[s].value = shadowMap;
    }
  }
}
