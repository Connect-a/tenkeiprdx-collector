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
};

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

export function makeFieldMaterial(T, shaderName, mat, deps) {
  const g = FIELD_SHADERS[String(shaderName || '')];
  if (!g || !g.vert || !g.frag) return null;
  const uniforms = {};
  for (const name of g.globals) uniforms[name] = { value: (GLOBAL_INIT[name] || zeroVec4)() };
  for (const p of g.props) uniforms[p.name] = { value: propValue(T, mat, p) };
  const needScene = [];
  for (const s of g.samplers) {
    if (s === '_CameraOpaqueTexture' || s === '_CameraDepthTexture') {
      uniforms[s] = { value: null };
      needScene.push(s);
      continue;
    }
    const pid = ((mat && mat.texByName) || {})[s];
    uniforms[s] = { value: (pid && deps.textureOf(pid)) || deps.white() };
  }
  const dst = mat && mat.dstBlend != null ? Number(mat.dstBlend) : 0;
  const transparent = dst !== 0;
  const m = new T.RawShaderMaterial({
    glslVersion: T.GLSL3,
    vertexShader: '// FIELD ' + shaderName + '\n' + g.vert,
    fragmentShader: g.frag,
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
  const { camera, time, width, height, opaque, depth } = ctx;
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
    }
    for (const s of m.userData.fieldScene || []) {
      if (s === '_CameraOpaqueTexture' && u[s]) u[s].value = opaque;
      if (s === '_CameraDepthTexture' && u[s]) u[s].value = depth;
    }
  }
}
