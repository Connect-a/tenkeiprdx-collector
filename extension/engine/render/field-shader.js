import { FIELD_SHADERS } from './shaders/field-shaders.js';

let disabled = false;
export const fieldShadersDisabled = () => disabled;
export const disableFieldShaders = () => (disabled = true);
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

const SHADOW_SAMPLERS = ['hlslcc_zcmp_MainLightShadowmapTexture', '_MainLightShadowmapTexture'];

function propValue(T, mat, p) {
  const floats = (mat && mat.allFloats) || {};
  const colors = (mat && mat.allColors) || {};
  const st = (mat && mat.texST) || {};
  if (p.type === 'float') return Number(floats[p.name]) || 0;
  const m = /^(_.*)_ST$/.exec(p.name);
  if (m && st[m[1]]) return st[m[1]].slice();
  const c = colors[p.name];
  if (c) return p.type === 'vec3' ? [c[0], c[1], c[2]] : [c[0], c[1], c[2], c[3]];
  const f = floats[p.name];
  if (f != null) return p.type === 'vec2' ? [Number(f), Number(f)] : p.type === 'vec3' ? [Number(f), Number(f), Number(f)] : [Number(f), Number(f), Number(f), Number(f)];
  return p.type === 'vec2' ? [0, 0] : p.type === 'vec3' ? [0, 0, 0] : [0, 0, 0, 0];
}

// 実ゲームはガンマ色空間(URPのGLSLに UNITY_COLORSPACE_GAMMA 由来の LinearToSRGB / RGBM指数1 が焼かれている)。
// three は出力で sRGB エンコードするので、実シェーダの出力をリニアへ戻してから渡す。
const TO_LINEAR_FN = 'vec3 tpToLinear(vec3 c){vec3 hi=pow((max(c,vec3(0.0))+0.055)/1.055,vec3(2.4));vec3 lo=c/12.92;return mix(hi,lo,step(c,vec3(0.04045)));}\n';

// 霧。焼いたバリアントは fog 無しなので、実ゲームの fog GLSL と同じ式を後段で掛ける（設計資料_viewer.md）。
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

function toLinearOutput(frag, fog) {
  if (!/\bvoid\s+main\s*\(\s*\)/.test(frag) || !/\bSV_Target0\b/.test(frag)) return frag;
  const body = frag.replace(/\bvoid\s+main\s*\(\s*\)/, 'void tpUnityMain()');
  const out = fog ? 'SV_Target0.rgb=tpToLinear(tpMixFog(SV_Target0.rgb));' : 'SV_Target0.rgb=tpToLinear(SV_Target0.rgb);';
  return body + '\n' + TO_LINEAR_FN + (fog ? FOG_FN : '') + 'void main(){tpUnityMain();' + out + '}\n';
}

function addFogVarying(vert) {
  if (!/\bvoid\s+main\s*\(\s*\)/.test(vert) || !/gl_Position/.test(vert)) return vert;
  return vert
    .replace(/\bvoid\s+main\s*\(\s*\)/, 'out highp float tpFogZ;\nvoid main()')
    .replace(/(gl_Position\s*=[^;]*;)/g, '$1\n    tpFogZ = gl_Position.w;');
}

export function makeFieldMaterial(T, shaderName, mat, deps) {
  const base = String(shaderName || '');
  const g = (deps.gi && FIELD_SHADERS[base + '|' + deps.gi]) || FIELD_SHADERS[base];
  if (!g || !g.vert || !g.frag) return null;
  const scene = deps.scene || {};
  const uniforms = {};
  // 影を受けないかはキーワードで決まる（プロパティ _ReceiveShadows は Inspector 用の残骸）。
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
    if (SHADOW_SAMPLERS.includes(s)) {
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
  // 焼いたバリアント自身が霧を持っているなら二重に掛けない。
  const fog = !!deps.fogMode && !g.globals.includes('unity_FogParams');
  if (fog) {
    uniforms.tpFogParams = { value: deps.fogParams || [0, 0, 0, 0] };
    uniforms.tpFogColor = { value: deps.fogColor || [0, 0, 0, 1] };
    uniforms.tpFogControl = { value: [deps.fogMode, 0.05, 0, 0] };
  }
  const dst = mat && mat.dstBlend != null ? Number(mat.dstBlend) : 0;
  const transparent = dst !== 0;
  const m = new T.RawShaderMaterial({
    glslVersion: T.GLSL3,
    vertexShader: '// FIELD ' + shaderName + '\n' + (fog ? addFogVarying(g.vert) : g.vert),
    fragmentShader: toLinearOutput(g.frag, fog),
    uniforms,
    side: deps.side(mat),
    transparent,
    depthWrite: mat && mat.zwrite === 0 ? false : true,
    blending: transparent && Number(mat.srcBlend) === 1 && dst === 1 ? T.AdditiveBlending : T.NormalBlending,
  });
  m.userData.fieldGlobals = g.globals;
  m.userData.fieldScene = needScene;
  return m;
}

export function updateFieldUniforms(mats, T, ctx) {
  const { camera, time, width, height, opaque, depth, shadow } = ctx;
  const shadowMap = shadow && shadow.map ? shadow.map.depthTexture : null;
  const shadowRows = shadow && shadow.matrix ? shadow.matrix.elements : null;
  const vp = new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const invVP = new T.Matrix4().copy(vp).invert();
  const invV = new T.Matrix4().copy(camera.matrixWorldInverse).invert();
  const near = camera.near;
  const far = camera.far;
  for (const m of mats) {
    const u = m.uniforms;
    for (const name of m.userData.fieldGlobals || []) {
      const slot = u[name];
      if (!slot) continue;
      if (name === '_TimeParameters') slot.value = [time, Math.sin(time), Math.cos(time), 0];
      else if (name === '_ProjectionParams') slot.value = [1, near, far, 1 / far];
      else if (name === '_ZBufferParams') slot.value = [1 - far / near, far / near, (1 - far / near) / far, far / near / far];
      else if (name === '_ScaledScreenParams' || name === '_ScreenParams') slot.value = [width, height, 1 + 1 / width, 1 + 1 / height];
      else if (name === '_WorldSpaceCameraPos') slot.value = [camera.position.x, camera.position.y, camera.position.z];
      else if (name === 'hlslcc_mtx4x4unity_MatrixV') slot.value = cols(camera.matrixWorldInverse);
      else if (name === 'hlslcc_mtx4x4unity_MatrixInvV') slot.value = cols(invV);
      else if (name === 'hlslcc_mtx4x4unity_MatrixVP') slot.value = cols(vp);
      else if (name === 'hlslcc_mtx4x4unity_MatrixInvVP') slot.value = cols(invVP);
      else if (name === 'hlslcc_mtx4x4unity_MatrixP') slot.value = cols(camera.projectionMatrix);
      else if (name === 'hlslcc_mtx4x4_MainLightWorldToShadow' && shadowRows) {
        // カスケード0の1枚だけを使う（材質側で _CascadeShadowSplitSphereRadii を巨大にして固定してある）。
        const a = slot.value.length === 80 ? slot.value : new Float32Array(80);
        a.set(shadowRows.subarray ? shadowRows.subarray(0, 16) : shadowRows.slice(0, 16), 0);
        slot.value = a;
      } else if (name === '_MainLightShadowmapSize' && shadow && shadow.mapSize) slot.value = [1 / shadow.mapSize.x, 1 / shadow.mapSize.y, shadow.mapSize.x, shadow.mapSize.y];
    }
    if (u.tpFogControl) u.tpFogControl.value = [u.tpFogControl.value[0], near, 0, 0];
    for (const s of m.userData.fieldScene || []) {
      if (s === '_CameraOpaqueTexture' && u[s]) u[s].value = opaque;
      if (s === '_CameraDepthTexture' && u[s]) u[s].value = depth;
      if (SHADOW_SAMPLERS.includes(s) && u[s]) u[s].value = shadowMap;
    }
  }
}
