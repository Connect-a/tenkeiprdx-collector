import { gameShaders } from './shaders/game-shaders.js';

const RAW_VARY_RE = /^\s*(?:layout\s*\([^)]*\)\s*)?in\s+(?:highp|mediump|lowp)?\s*(vec2|vec3|vec4)\s+(vs_[A-Z]+\d+)\s*;/gm;
export const materialClips = (entry) => !!(entry && (entry.alphaClip || shaderDiscards(entry.proc && entry.proc.shader)));

export function effectiveVaryings(g) {
  if (g && g.varyings && g.varyings.length) return g.varyings.map((v) => ({ ...v, name: 'vs_INTERP' + v.slot }));
  const out = [];
  RAW_VARY_RE.lastIndex = 0;
  let m;
  while ((m = RAW_VARY_RE.exec((g && g.frag) || ''))) {
    const name = m[2];
    const sem = /^vs_COLOR\d+$/.test(name) ? 'color' : name === 'vs_TEXCOORD0' ? 'uv' : 'unknown';
    out.push({ slot: -1, type: m[1], sem, name });
  }
  return out;
}

const glf = (v) => {
  const x = Number(v) || 0;
  const s = x.toFixed(6);
  return s.indexOf('.') < 0 ? s + '.0' : s;
};

export function genVaryingIO(varyings, values, exprs) {
  const outs = [],
    asg = [];
  for (const vv of varyings || []) {
    const nm = vv.name || 'vs_INTERP' + vv.slot;
    outs.push('out ' + vv.type + ' ' + nm + ';');
    let e;
    if (vv.sem === 'uv') e = vv.type === 'vec4' ? 'vec4(quv,0.0,0.0)' : vv.type === 'vec3' ? 'vec3(quv,0.0)' : 'quv';
    else if (vv.sem === 'color') e = vv.type === 'vec4' ? 'vec4(colRgb,colA)' : 'colRgb';
    else if (vv.sem === 'worldPos') e = vv.type === 'vec4' ? 'vec4(wp,1.0)' : 'wp';
    else if (vv.sem === 'normal') e = vv.type === 'vec4' ? 'vec4(nrm,0.0)' : 'nrm';
    else if (exprs && vv.src && exprs[vv.src]) {
      const ex = exprs[vv.src];
      e = vv.type === 'vec4' ? ex : vv.type === 'vec3' ? '(' + ex + ').xyz' : '(' + ex + ').xy';
    } else {
      const v = values && vv.src ? values[vv.src] : null;
      if (v) e = vv.type === 'vec4' ? 'vec4(' + v.slice(0, 4).map(glf).join(',') + ')' : vv.type === 'vec3' ? 'vec3(' + v.slice(0, 3).map(glf).join(',') + ')' : 'vec2(' + v.slice(0, 2).map(glf).join(',') + ')';
      else e = vv.type === 'vec4' ? 'vec4(0.0,0.0,0.0,1.0)' : vv.type === 'vec3' ? 'vec3(0.0)' : 'vec2(0.0)';
    }
    asg.push(nm + '=' + e + ';');
  }
  return { outs: outs.join('\n'), asg: asg.join('') };
}
export const GAME_VERT_MATCAP =
  'precision highp float;\n' +
  'in vec3 position;in vec3 normal;in mat4 instanceMatrix;in vec3 instanceColor;\n' +
  'uniform mat4 modelMatrix;uniform mat4 viewMatrix;uniform mat4 projectionMatrix;uniform vec3 cameraPosition;\n' +
  'uniform float uViewAlign;\n' +
  'out vec4 vs_INTERP0;out vec3 vs_INTERP1;out vec3 vs_INTERP2;\n' +
  'void main(){vec3 wp;vec3 wn;mat4 mi=modelMatrix*instanceMatrix;\n' +
  'if(uViewAlign>0.5){\n' +
  ' vec3 s=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));\n' +
  ' vec3 center=(mi*vec4(0.0,0.0,0.0,1.0)).xyz;\n' +
  ' vec3 fwd=normalize(cameraPosition-center);\n' +
  ' vec3 up0=abs(fwd.y)>0.99?vec3(1.0,0.0,0.0):vec3(0.0,1.0,0.0);\n' +
  ' vec3 rgt=normalize(cross(up0,fwd));vec3 upv=cross(fwd,rgt);\n' +
  ' vec3 lp=position*s;wp=center+rgt*lp.x+fwd*lp.y+upv*lp.z;\n' +
  ' vec3 ln=normal;wn=normalize(rgt*ln.x+fwd*ln.y+upv*ln.z);\n' +
  '}else{wp=(mi*vec4(position,1.0)).xyz;wn=normalize((mi*vec4(normal,0.0)).xyz);}\n' +
  'vs_INTERP0=vec4(instanceColor,1.0);vs_INTERP1=wp;vs_INTERP2=wn;\n' +
  'gl_Position=projectionMatrix*viewMatrix*vec4(wp,1.0);}';
const OBJECT_PRELUDE = 'mat4 _M=modelMatrix*instanceMatrix; mat4 _WI=inverse(_M);';

export function particleWorldVertex(vert) {
  const at = vert ? vert.indexOf(OBJECT_PRELUDE) : -1;
  if (at < 0) return null;
  const hasNormal = /\bin vec3 normal;/.test(vert);
  const prelude =
    'mat4 tpPM=modelMatrix*instanceMatrix; vec3 tpWPos=(tpPM*vec4(position,1.0)).xyz;' +
    (hasNormal ? ' vec3 tpWNrm=normalize(transpose(inverse(mat3(tpPM)))*normal);' : '') +
    ' mat4 _M=mat4(1.0); mat4 _WI=mat4(1.0);';
  let rest = vert.slice(at + OBJECT_PRELUDE.length).replace(/\bposition\b/g, 'tpWPos');
  if (hasNormal) rest = rest.replace(/\bnormal\b/g, 'tpWNrm');
  return vert.slice(0, at) + prelude + rest;
}

const ENGINE_LIGHTING_RE = /\b(unity_SH[ABC][rgb]?|_MainLightPosition|_MainLightColor|_AdditionalLights\w*|unity_LightData|unity_SpecCube0_HDR|_MainLightShadowmapTexture)\b/;
const _realVert = new WeakMap();
function realVertexParts(g) {
  if (!g || typeof g !== 'object') return null;
  if (_realVert.has(g)) return _realVert.get(g);
  let out = null;
  try {
    const v = g.vert || '';
    const mi = v.indexOf('void main');
    const at = v.indexOf(OBJECT_PRELUDE);
    if (mi >= 0 && at > mi && !ENGINE_LIGHTING_RE.test(g.frag + '\n' + v)) {
      const head = v.slice(0, mi);
      const inputs = {};
      for (const m of head.matchAll(/\bin\s+(?:highp\s+|mediump\s+|lowp\s+)?(vec[234]|float)\s+(in_TEXCOORD\d+)\s*;/g)) inputs[m[2]] = m[1];
      const decls = head
        .replace(/^\s*precision\b[^;]*;/gm, '')
        .replace(/\bin\s+[^;]+;/g, '')
        .replace(/\buniform\s+mat4\s+(?:modelMatrix|viewMatrix|projectionMatrix|modelViewMatrix)\s*;/g, '');
      const body = v
        .slice(at + OBJECT_PRELUDE.length, v.lastIndexOf('}'))
        .replace(/\bgl_Position\s*=[^;]*;/g, '')
        .replace(/\breturn\s*;/g, '')
        .replace(/\bposition\b/g, 'wp')
        .replace(/\bnormal\b/g, 'nrm')
        .replace(/\buv\b/g, 'quv')
        .replace(/\binstanceColor\b/g, 'colRgb')
        .replace(/\biColorA\b/g, 'colA');
      const names = [...g.frag.matchAll(new RegExp(RAW_VARY_RE.source, 'gm'))].map((m) => m[2]);
      if (names.length && names.every((n) => new RegExp('\\b' + n + '(\\.[xyzw]+)?\\s*=').test(body))) out = { decls, body: ' mat4 _M=mat4(1.0); mat4 _WI=mat4(1.0);' + body, inputs };
    }
  } catch (e) {
    out = null;
  }
  _realVert.set(g, out);
  return out;
}

export function usesRealVertex(g) {
  if (!g || !g.frag || (g.varyings && g.varyings.length)) return false;
  return effectiveVaryings(g).some((v) => v.sem === 'unknown');
}

export function realVertexIO(g, values, exprs) {
  const p = realVertexParts(g);
  if (!p) return null;
  let asg = p.body;
  for (const [name, type] of Object.entries(p.inputs)) {
    const v = values && values[name];
    const e = exprs && exprs[name] ? exprs[name] : v ? 'vec4(' + v.slice(0, 4).map(glf).join(',') + ')' : 'vec4(0.0,0.0,0.0,1.0)';
    const cast = type === 'vec4' ? e : type === 'vec3' ? '(' + e + ').xyz' : type === 'vec2' ? '(' + e + ').xy' : '(' + e + ').x';
    asg = asg.replace(new RegExp('\\b' + name + '\\b', 'g'), '(' + cast + ')');
  }
  return { outs: p.decls, asg };
}

const varyingIO = (g, values, exprs) => (usesRealVertex(g) ? realVertexIO(g, values, exprs) : genVaryingIO(effectiveVaryings(g), values, exprs));

export function genMeshUvVertex(g) {
  const io = varyingIO(g);
  return (
    'precision highp float;\n' +
    'in vec3 position;in vec3 normal;in vec2 uv;in mat4 instanceMatrix;in vec3 instanceColor;in float iColorA;\n' +
    'uniform mat4 modelMatrix;uniform mat4 viewMatrix;uniform mat4 projectionMatrix;uniform vec3 cameraPosition;uniform float uViewAlign;\n' +
    io.outs +
    '\n' +
    'void main(){mat4 mi=modelMatrix*instanceMatrix;vec3 wp;vec3 nrm;\n' +
    'if(uViewAlign>0.5){\n' +
    ' vec3 s=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));\n' +
    ' vec3 center=(mi*vec4(0.0,0.0,0.0,1.0)).xyz;\n' +
    ' vec3 camR=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]);\n' +
    ' vec3 camU=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);\n' +
    ' vec3 camF=vec3(viewMatrix[0][2],viewMatrix[1][2],viewMatrix[2][2]);\n' +
    ' vec3 lp=position*s;wp=center+camR*lp.x+camU*lp.y-camF*lp.z;nrm=normalize(-camF);\n' +
    '}else{wp=(mi*vec4(position,1.0)).xyz;nrm=normalize((mi*vec4(normal,0.0)).xyz);}\n' +
    'vec2 quv=uv;vec3 colRgb=instanceColor;float colA=iColorA;\n' +
    io.asg +
    '\n' +
    'gl_Position=projectionMatrix*viewMatrix*vec4(wp,1.0);}'
  );
}

function mat4Col(out, m, i) {
  const e = m.elements;
  out.set(e[i * 4 + 0], e[i * 4 + 1], e[i * 4 + 2], e[i * 4 + 3]);
  return out;
}
let _farDepthTex = null;
function farDepthTexture(T) {
  if (_farDepthTex) return _farDepthTex;
  const dt = new T.DataTexture(new Float32Array([1, 1, 1, 1]), 1, 1, T.RGBAFormat, T.FloatType);
  dt.needsUpdate = true;
  _farDepthTex = dt;
  return dt;
}
export function buildGameUniforms(T, g, mp) {
  const frag = (g.frag || '') + '\n' + (g.vert || '');
  const has = (n) => new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(frag);
  const u = { _TimeParameters: { value: new T.Vector4(0, 0, 0, 0) } };
  const mc = (mp && mp.colors) || {},
    mf = (mp && mp.floats) || {},
    mv1 = (mp && mp.vec1) || {};
  for (const [name, pd] of Object.entries(g.props || {})) {
    if (/^vec/.test(pd.type)) {
      const a = mc[name] || pd.def || [0, 0, 0, 0];
      u[name] = { value: new T.Vector4(a[0] || 0, a[1] || 0, a[2] || 0, a[3] == null ? 0 : a[3]) };
    } else {
      const v = mf[name] != null ? mf[name] : mv1[name] != null ? mv1[name] : pd.def;
      u[name] = { value: v == null ? 0 : v };
    }
  }
  if (has('_AlphaToMaskAvailable')) u._AlphaToMaskAvailable = { value: 0 };
  if (has('_GlobalMipBias')) u._GlobalMipBias = { value: new T.Vector2(0, 0) };
  if (has('unity_OrthoParams')) u.unity_OrthoParams = { value: new T.Vector4(0, 0, 0, 0) };
  if (has('_WorldSpaceCameraPos')) u._WorldSpaceCameraPos = { value: new T.Vector3() };
  if (has('_ProjectionParams')) u._ProjectionParams = { value: new T.Vector4(1, 0.1, 1000, 0.001) };
  if (has('_ZBufferParams')) u._ZBufferParams = { value: new T.Vector4(0, 0, 0, 0) };
  if (has('_ScaledScreenParams')) u._ScaledScreenParams = { value: new T.Vector4(1, 1, 1, 1) };
  const mkMat4 = () => [new T.Vector4(), new T.Vector4(), new T.Vector4(), new T.Vector4()];
  if (has('hlslcc_mtx4x4unity_MatrixV')) u.hlslcc_mtx4x4unity_MatrixV = { value: mkMat4() };
  if (has('hlslcc_mtx4x4unity_MatrixInvV')) u.hlslcc_mtx4x4unity_MatrixInvV = { value: mkMat4() };
  if (has('hlslcc_mtx4x4unity_MatrixVP')) u.hlslcc_mtx4x4unity_MatrixVP = { value: mkMat4() };
  if (has('hlslcc_mtx4x4unity_MatrixInvVP')) u.hlslcc_mtx4x4unity_MatrixInvVP = { value: mkMat4() };
  const needDepth = !!g.needsDepth || has('_CameraDepthTexture');
  if (needDepth) u._CameraDepthTexture = { value: farDepthTexture(T) };
  const _cp = new T.Vector3(),
    _vp = new T.Matrix4(),
    _ivp = new T.Matrix4();
  const wire = (renderer, camera) => {
    const near = camera.near || 0.1,
      far = camera.far || 1000;
    if (u._WorldSpaceCameraPos) {
      camera.getWorldPosition(_cp);
      u._WorldSpaceCameraPos.value.copy(_cp);
    }
    if (u._ProjectionParams) u._ProjectionParams.value.set(1, near, far, 1 / far);
    if (u._ZBufferParams) {
      const fn = far / near;
      u._ZBufferParams.value.set(1 - fn, fn, (1 - fn) / far, fn / far);
    }
    if (u._ScaledScreenParams && renderer) {
      const sz = renderer.getDrawingBufferSize(new T.Vector2());
      u._ScaledScreenParams.value.set(sz.x, sz.y, 1 + 1 / sz.x, 1 + 1 / sz.y);
    }
    if (u.hlslcc_mtx4x4unity_MatrixV) for (let i = 0; i < 4; i++) mat4Col(u.hlslcc_mtx4x4unity_MatrixV.value[i], camera.matrixWorldInverse, i);
    if (u.hlslcc_mtx4x4unity_MatrixInvV) for (let i = 0; i < 4; i++) mat4Col(u.hlslcc_mtx4x4unity_MatrixInvV.value[i], camera.matrixWorld, i);
    if (u.hlslcc_mtx4x4unity_MatrixVP || u.hlslcc_mtx4x4unity_MatrixInvVP) {
      _vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      if (u.hlslcc_mtx4x4unity_MatrixVP) for (let i = 0; i < 4; i++) mat4Col(u.hlslcc_mtx4x4unity_MatrixVP.value[i], _vp, i);
      if (u.hlslcc_mtx4x4unity_MatrixInvVP) {
        _ivp.copy(_vp).invert();
        for (let i = 0; i < 4; i++) mat4Col(u.hlslcc_mtx4x4unity_MatrixInvVP.value[i], _ivp, i);
      }
    }
  };
  const setDepth = (tex) => {
    if (u._CameraDepthTexture) u._CameraDepthTexture.value = tex || farDepthTexture(T);
  };
  return { uniforms: u, wire, setDepth, needsDepth: needDepth };
}
export function applyGameBlend(T, mat, blend) {
  if (blend === 'opaque') {
    mat.transparent = false;
    mat.depthWrite = true;
    mat.blending = T.NormalBlending;
  } else if (blend === 'add') {
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = T.AdditiveBlending;
  } else {
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = T.NormalBlending;
  }
  mat.depthTest = true;
  mat.needsUpdate = true;
}
let _whiteTex = null;
export function whiteTexture(T) {
  if (_whiteTex) return _whiteTex;
  const dt = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, T.RGBAFormat);
  dt.needsUpdate = true;
  _whiteTex = dt;
  return dt;
}
let _whiteCube = null;
function whiteCubeTexture(T) {
  if (_whiteCube) return _whiteCube;
  const faces = [];
  for (let i = 0; i < 6; i++) {
    const cv = document.createElement('canvas');
    cv.width = 1;
    cv.height = 1;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 1, 1);
    faces.push(cv);
  }
  const ct = new T.CubeTexture(faces);
  ct.needsUpdate = true;
  _whiteCube = ct;
  return ct;
}
let _shadowTex = null;
function shadowDepthTexture(T) {
  if (_shadowTex) return _shadowTex;
  const dt = new T.DepthTexture(1, 1, T.UnsignedIntType);
  dt.compareFunction = T.LessEqualCompare;
  dt.needsUpdate = true;
  _shadowTex = dt;
  return dt;
}

const SAMPLER_RE = /uniform\s+(?:highp|mediump|lowp)?\s*(sampler2DShadow|samplerCubeShadow|samplerCube|sampler2DArray|sampler3D|sampler2D)\s+(\w+)/g;
export function collectSamplers(frag) {
  const out = [];
  const seen = new Set();
  SAMPLER_RE.lastIndex = 0;
  let m;
  while ((m = SAMPLER_RE.exec(frag || ''))) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    out.push({ name: m[2], kind: m[1] });
  }
  return out;
}
export function samplerPlaceholder(T, kind) {
  if (kind === 'samplerCube' || kind === 'samplerCubeShadow') return whiteCubeTexture(T);
  if (kind === 'sampler2DShadow') return shadowDepthTexture(T);
  return whiteTexture(T);
}

const _unknownVaryOk = new Map();
function unknownSlotsFeedable(key, g) {
  if (_unknownVaryOk.has(key)) return _unknownVaryOk.get(key);
  const ok = (g.varyings || []).filter((v) => v.sem === 'unknown').every((v) => v.type === 'vec4' || v.type === 'vec3' || v.type === 'vec2');
  _unknownVaryOk.set(key, ok);
  return ok;
}

const VARIANT_KEYWORDS = ['_COLORADDSUBDIFF_ON'];
function pickVariant(base, keywords) {
  if (!Array.isArray(keywords) || !keywords.length) return base;
  let best = base, bestN = 0;
  for (const k of Object.keys(gameShaders)) {
    if (k.length <= base.length + 1 || !k.startsWith(base + '|')) continue;
    const need = k.slice(base.length + 1).split('+');
    if (!need.some((n) => VARIANT_KEYWORDS.includes(n))) continue;
    if (!need.every((n) => keywords.includes(n))) continue;
    if (need.length > bestN) { best = k; bestN = need.length; }
  }
  return best;
}
function usableKey(key) {
  const g = gameShaders[key];
  if (!g) return null;
  if (g.unknownVary && !unknownSlotsFeedable(key, g)) return null;
  if (/\bvs_(TEXCOORD|COLOR)\d/.test(g.frag)) {
    const ev = effectiveVaryings(g);
    if (!ev.length) return null;
    if (!ev.every((v) => v.sem === 'uv' || v.sem === 'color') && !realVertexParts(g)) return null;
  }
  return key;
}
export function resolveGameKey(sh, keywords) {
  if (!sh) return null;
  const base = String(sh).replace(/^Shader Graphs\//, '');
  const picked = pickVariant(base, keywords);
  return usableKey(picked) || (picked !== base ? usableKey(base) : null);
}

const _discardCache = new Map();
function shaderDiscards(sh) {
  if (!sh) return false;
  const key = String(sh).replace(/^Shader Graphs\//, '');
  if (_discardCache.has(key)) return _discardCache.get(key);
  const g = gameShaders[key];
  const v = !!(g && g.frag && /discard;/.test(g.frag));
  _discardCache.set(key, v);
  return v;
}

const CAM_AXES =
  ' vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);\n' +
  ' vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);\n' +
  ' vec3 camF = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);\n';
const ROT2 = ' vec2 ap = position.xy * size.xy;\n vec2 rp = vec2(cos(rotation)*ap.x - sin(rotation)*ap.y, sin(rotation)*ap.x + cos(rotation)*ap.y) * tpEScale.xy;\n';
const ESCALE_ATTR = 'in vec3 tpEScale;\n';
const ALIGN_Q =
  'mat3 tpBasis(vec4 q){\n' +
  ' float x2=q.x+q.x, y2=q.y+q.y, z2=q.z+q.z;\n' +
  ' float xx=q.x*x2, xy=q.x*y2, xz=q.x*z2, yy=q.y*y2, yz=q.y*z2, zz=q.z*z2;\n' +
  ' float wx=q.w*x2, wy=q.w*y2, wz=q.w*z2;\n' +
  ' return mat3(1.0-(yy+zz), xy+wz, xz-wy, xy-wz, 1.0-(xx+zz), yz+wx, xz+wy, yz-wx, 1.0-(xx+yy));\n' +
  '}\n';
const ALIGN_MODES = {
  quad: {
    rotType: 'float',
    alwaysModel: true,
    extraAttr: 'in vec4 tpAlignQ;\n' + ESCALE_ATTR,
    preUni: ALIGN_Q,
    body:
      ROT2 +
      ' mat3 tpB = tpBasis(tpAlignQ);\n' +
      ' vec3 tpWp = (modelMatrix * vec4(offset,1.0)).xyz + tpB[0]*rp.x + tpB[1]*rp.y;\n' +
      ' vec4 mv = viewMatrix * vec4(tpWp,1.0);\n',
    world: ' vec3 wp = tpWp;\n vec3 nrm = tpB[2];\n',
  },
  stretchedAligned: {
    rotType: 'float',
    alwaysModel: true,
    extraAttr: 'in vec4 velocity;\nin vec4 tpAlignQ;\n',
    preUni: ALIGN_Q,
    body:
      ' float avgSize = (abs(size.x) + abs(size.y)) * 0.5;\n' +
      ' mat3 tpB = tpBasis(tpAlignQ);\n' +
      ' vec3 tpOrg = (modelMatrix * vec4(offset,1.0)).xyz;\n' +
      ' vec3 tpVel = mat3(modelMatrix) * velocity.xyz;\n' +
      ' float vlength = length(tpVel);\n' +
      ' vec3 tpDir = vlength > 1e-6 ? tpVel / vlength : tpB[1];\n' +
      ' vec3 tpW = cross(tpB[2], tpDir);\n' +
      ' float tpWl = length(tpW);\n' +
      ' tpW = tpWl > 1e-6 ? tpW / tpWl : tpB[0];\n' +
      ' vec3 tpWp = tpOrg + tpW * (position.y * avgSize) - tpDir * ((position.x + 0.5) * (vlength + velocity.w) * avgSize);\n' +
      ' vec4 mv = viewMatrix * vec4(tpWp,1.0);\n',
    world: ' vec3 wp = tpWp;\n vec3 nrm = tpB[2];\n',
  },
};
const PARTICLE_MODES = {
  billboard: {
    rotType: 'float',
    extraAttr: ESCALE_ATTR,
    body:
      ROT2 + ' vec4 mv = modelViewMatrix * vec4(offset,1.0);\n mv.xy += rp;\n',
    world: CAM_AXES + ' vec3 wp = (modelMatrix * vec4(offset,1.0)).xyz + camR*rp.x + camU*rp.y;\n vec3 nrm = normalize(camF);\n',
  },
  horizontal: {
    rotType: 'float',
    alwaysModel: true,
    extraAttr: ESCALE_ATTR,
    body: ROT2 + ' vec4 mv = modelMatrix * vec4(offset,1.0);\n mv.x += rp.x; mv.z -= rp.y;\n vec3 tpWp = mv.xyz;\n mv = viewMatrix * mv;\n',
    world: ' vec3 wp = tpWp;\n vec3 nrm = vec3(0.0,1.0,0.0);\n',
  },
  vertical: {
    rotType: 'float',
    alwaysModel: true,
    extraAttr: ESCALE_ATTR,
    body: ROT2 + ' vec4 mv = modelMatrix * vec4(offset,1.0);\n mv.y += rp.y;\n vec3 tpWp = mv.xyz;\n mv = viewMatrix * mv;\n mv.x += rp.x;\n',
    world: CAM_AXES + ' vec3 wp = tpWp + camR*rp.x;\n vec3 nrm = normalize(vec3(camF.x, 0.0, camF.z));\n',
  },
  mesh: {
    rotType: 'vec4',
    needsNormal: true,
    extraAttr: 'in vec4 tpBaseQ;\nin vec3 tpEScale;\n',
    preUni: ALIGN_Q,
    body:
      ' float sx = size.x, sy = size.y, sz = size.z;\n' +
      ' mat3 tpRp = tpBasis(rotation);\n' +
      ' mat3 tpBq = tpBasis(tpBaseQ);\n' +
      ' mat3 tpM = tpBq * mat3(tpEScale.x,0.0,0.0, 0.0,tpEScale.y,0.0, 0.0,0.0,tpEScale.z) * tpRp;\n' +
      ' vec4 lp = vec4(offset + tpM * (position * vec3(sx,sy,sz)), 1.0);\n vec4 mv = modelViewMatrix * lp;\n',
    world:
      ' vec3 wp = (modelMatrix * lp).xyz;\n' +
      ' vec3 tpNObj = normal / max(vec3(sx,sy,sz), vec3(1e-6));\n' +
      ' vec3 nrm = normalize(mat3(modelMatrix) * (tpBq * ((tpRp * tpNObj) / max(tpEScale, vec3(1e-6)))));\n',
  },
  stretched: {
    rotType: 'float',
    extraAttr: 'in vec4 velocity;\n',
    extraUni: 'uniform mat3 normalMatrix;\n',
    body:
      ' float avgSize = (abs(size.x) + abs(size.y)) * 0.5;\n' +
      ' vec4 mv = modelViewMatrix * vec4(offset,1.0);\n' +
      ' vec3 viewVelocity = normalMatrix * velocity.xyz;\n' +
      ' float vlength = length(viewVelocity);\n' +
      ' vec3 tpVDir = vlength > 1e-6 ? viewVelocity / vlength : vec3(0.0,1.0,0.0);\n' +
      ' mv.xyz += position.y * normalize(cross(mv.xyz, tpVDir)) * avgSize;\n' +
      ' mv.xyz -= (position.x + 0.5) * tpVDir * (vlength + velocity.w) * avgSize;\n',
    world: CAM_AXES + ' vec3 wp = transpose(mat3(viewMatrix)) * (mv.xyz - viewMatrix[3].xyz);\n vec3 nrm = normalize(camF);\n',
  },
  freeform: {
    rotType: 'float',
    extraAttr: 'in vec4 velocity;\n',
    extraUni: 'uniform mat3 normalMatrix;\n',
    body:
      ' float avgSize = (abs(size.x) + abs(size.y)) * 0.5;\n' +
      ' vec4 mv = modelViewMatrix * vec4(offset,1.0);\n' +
      ' vec3 viewVelocity = normalMatrix * velocity.xyz;\n' +
      ' float vlength = length(viewVelocity);\n' +
      ' vec2 sdir = viewVelocity.xy;\n' +
      ' float slen = length(sdir);\n' +
      ' vec2 perp = slen > 1e-6 ? vec2(-sdir.y, sdir.x) / slen : vec2(1.0, 0.0);\n' +
      ' mv.xy += perp * (position.y * avgSize);\n' +
      ' mv.xy -= (slen > 1e-6 ? sdir / slen : vec2(0.0,1.0)) * ((position.x + 0.5) * (slen + velocity.w) * avgSize);\n',
    world: CAM_AXES + ' vec3 wp = transpose(mat3(viewMatrix)) * (mv.xyz - viewMatrix[3].xyz);\n vec3 nrm = normalize(camF);\n',
  },
};

ALIGN_MODES.freeformAligned = {
  rotType: 'float',
  alwaysModel: true,
  extraAttr: 'in vec4 velocity;\nin vec4 tpAlignQ;\n',
  preUni: ALIGN_Q,
  body:
    ' float avgSize = (abs(size.x) + abs(size.y)) * 0.5;\n' +
    ' mat3 tpB = tpBasis(tpAlignQ);\n' +
    ' vec3 tpOrg = (modelMatrix * vec4(offset,1.0)).xyz;\n' +
    ' vec3 tpVel = mat3(modelMatrix) * velocity.xyz;\n' +
    ' float vlength = length(tpVel);\n' +
    ' vec3 tpVelP = tpVel - tpB[2] * dot(tpVel, tpB[2]);\n' +
    ' float slen = length(tpVelP);\n' +
    ' vec3 tpDir = slen > 1e-6 ? tpVelP / slen : tpB[0];\n' +
    ' vec3 tpW = cross(tpB[2], tpDir);\n' +
    ' vec3 tpWp = tpOrg + tpW * (position.y * avgSize) - tpDir * ((position.x + 0.5) * (slen + velocity.w) * avgSize);\n' +
    ' vec4 mv = viewMatrix * vec4(tpWp,1.0);\n',
  world: ' vec3 wp = tpWp;\n vec3 nrm = tpB[2];\n',
};

export function gameParticleShaders(g, opt) {
  if (!g || !g.frag) return null;
  const varys = effectiveVaryings(g);
  if (!varys.length) return null;
  const o = opt || {};
  const alignQuad = (o.mode === 'billboard' || o.mode === 'stretched' || o.mode === 'freeform') && o.align != null && o.align !== 0;
  const M = alignQuad ? ALIGN_MODES[o.mode === 'freeform' ? 'freeformAligned' : o.mode === 'stretched' ? 'stretchedAligned' : 'quad'] : PARTICLE_MODES[o.mode || 'billboard'];
  if (!M) return null;
  const real = usesRealVertex(g);
  const io = real ? realVertexIO(g, o.values, o.exprs) : genVaryingIO(varys, o.values, o.exprs);
  if (!io) return null;
  const needsWorld = real || varys.some((v) => v.sem === 'worldPos' || v.sem === 'normal');
  const useCustom1 = /\btpCustom1\b/.test(io.asg);
  const useCustom2 = /\btpCustom2\b/.test(io.asg);
  const tiles = !!o.tiles;
  const needsModel = needsWorld || !!M.alwaysModel;
  const vert =
    'precision highp float;\n' +
    'in vec3 position;in vec2 uv;\n' +
    (M.needsNormal && needsWorld ? 'in vec3 normal;\n' : '') +
    'in vec3 offset;in ' + M.rotType + ' rotation;in vec3 size;in vec4 color;\n' +
    (tiles ? 'in float uvTile;\nuniform vec2 tileCount;\n' : '') +
    (M.extraAttr || '') +
    (useCustom1 ? 'in vec4 tpCustom1;\n' : '') +
    (useCustom2 ? 'in vec4 tpCustom2;\n' : '') +
    'uniform mat4 modelViewMatrix;uniform mat4 projectionMatrix;\n' +
    (M.extraUni || '') +
    (needsModel ? 'uniform mat4 modelMatrix;uniform mat4 viewMatrix;\n' : '') +
    (M.preUni || '') +
    io.outs +
    '\nvoid main(){\n' +
    M.body +
    (tiles
      ? ' float tpT = floor(uvTile);\n' +
        ' float tpCol = mod(tpT, tileCount.x);\n' +
        ' float tpRow = tileCount.y - floor(tpT / tileCount.x) - 1.0;\n' +
        ' vec2 quv = vec2(uv.x / tileCount.x + tpCol / tileCount.x, uv.y / tileCount.y + tpRow / tileCount.y);\n'
      : ' vec2 quv = uv;\n') +
    ' vec3 colRgb = color.rgb; float colA = color.a;\n' +
    (needsWorld ? M.world : ' vec3 wp = vec3(0.0); vec3 nrm = vec3(0.0,0.0,-1.0);\n') +
    ' ' +
    io.asg +
    '\n gl_Position = projectionMatrix * mv;\n' +
    '}\n';
  const om = /layout\s*\(\s*location\s*=\s*0\s*\)\s*(?:inout|out)\s+(highp|mediump|lowp)\s+vec4\s+(SV_T\w*0)\s*;/i.exec(g.frag);
  if (!om) return null;
  const outName = om[2];
  const esc = outName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let body = g.frag.replace(new RegExp('layout\\s*\\(\\s*location\\s*=\\s*0\\s*\\)\\s*(?:inout|out)\\s+(?:highp|mediump|lowp)\\s+vec4\\s+' + esc + '\\s*;', 'g'), om[1] + ' vec4 ' + outName + ';');
  body = body.replace(/^\s*layout\s*\([^)]*\)\s*(in\s+(?:highp|mediump|lowp)?\s*vec[234]\s+vs_[A-Z]+\d+\s*;)/gm, '$1');
  if (/\blayout\s*\([^)]*\)\s*(?:inout|out)\b/.test(body)) return null;
  if (!/void\s+main\s*\(\s*\)/.test(body)) return null;
  body = body.replace(/void\s+main\s*\(\s*\)/, 'void tpGameMain()');
  const em = !!o.emission;
  const frag =
    body +
    '\nlayout(location = 0) out highp vec4 tpOut;\n' +
    (em ? 'uniform highp vec3 tpEmission;\n' : '') +
    'void main(){ tpGameMain(); tpOut = ' + outName + ';\n' +
    (em ? ' tpOut.rgb += tpEmission;\n' : '') +
    '}\n';
  return { vert, frag, outs: io.outs };
}

export const ENGINE_TEXTURE_NAME = /^_(Camera(Depth|Opaque|Color)Texture|MainLight(Shadowmap|Cookie)Texture|AdditionalLights(Shadowmap)?Texture|DitheringTexture|ScreenSpaceOcclusionTexture)$/;
