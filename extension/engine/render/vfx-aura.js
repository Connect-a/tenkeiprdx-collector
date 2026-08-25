import * as THREE_NS from '../../vendor/three.module.js';
import { vfxParse } from './vfx-parse.js';
import { proceduralTex } from './vfx-tex.js';
import { gameShaders } from './shaders/game-shaders.js';

let _solidTex = null;
function solidTexture(T) {
  if (_solidTex) return _solidTex;
  _solidTex = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, T.RGBAFormat);
  _solidTex.needsUpdate = true;
  return _solidTex;
}
let _glowTex = null;
function glowTexture(T) {
  if (_glowTex) return _glowTex;
  const S = 64,
    cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  _glowTex = new T.CanvasTexture(cv);
  _glowTex.minFilter = T.LinearFilter;
  _glowTex.magFilter = T.LinearFilter;
  return _glowTex;
}

function evalCurve(curve, t) {
  const ks = (curve && curve.m_Curve) || [];
  if (!ks.length) return 0;
  if (ks.length === 1) return ks[0].value;
  if (t <= ks[0].time) return ks[0].value;
  if (t >= ks[ks.length - 1].time) return ks[ks.length - 1].value;
  let i = 0;
  while (i < ks.length - 1 && ks[i + 1].time < t) i++;
  const a = ks[i],
    b = ks[i + 1];
  const dt = b.time - a.time;
  if (dt <= 1e-9) return a.value;
  const u = (t - a.time) / dt;
  const u2 = u * u,
    u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1,
    h10 = u3 - 2 * u2 + u,
    h01 = -2 * u3 + 3 * u2,
    h11 = u3 - u2;
  return h00 * a.value + h10 * dt * (a.outSlope || 0) + h01 * b.value + h11 * dt * (b.inSlope || 0);
}
function evalMMCurve(mm, t, rnd) {
  if (!mm) return 0;
  const st = mm.minMaxState;
  if (st === 1) return (mm.scalar || 0) * evalCurve(mm.maxCurve, t);
  if (st === 2) {
    const a = (mm.scalar || 0) * evalCurve(mm.maxCurve, t),
      b = (mm.scalar || 0) * evalCurve(mm.minCurve, t);
    return b + (a - b) * (rnd == null ? 0.5 : rnd);
  }
  if (st === 3) {
    const a = mm.scalar || 0,
      b = mm.minScalar || 0;
    return b + (a - b) * (rnd == null ? Math.random() : rnd);
  }
  return mm.scalar || 0;
}
const sampleMM = (mm, rnd) => evalMMCurve(mm, 0, rnd);

function evalGradient(g, t, out) {
  out = out || [1, 1, 1, 1];
  if (!g) {
    out[0] = out[1] = out[2] = out[3] = 1;
    return out;
  }
  const nc = g.m_NumColorKeys || 0,
    na = g.m_NumAlphaKeys || 0;
  let r = 1,
    grn = 1,
    b = 1;
  if (nc > 0) {
    const tt = t * 65535;
    let i = 0;
    while (i < nc - 1 && g['ctime' + (i + 1)] < tt) i++;
    const c0 = g['key' + i],
      t0 = g['ctime' + i];
    if (i >= nc - 1) {
      r = c0.r;
      grn = c0.g;
      b = c0.b;
    } else {
      const c1 = g['key' + (i + 1)],
        t1 = g['ctime' + (i + 1)];
      const u = t1 > t0 ? (tt - t0) / (t1 - t0) : 0;
      r = c0.r + (c1.r - c0.r) * u;
      grn = c0.g + (c1.g - c0.g) * u;
      b = c0.b + (c1.b - c0.b) * u;
    }
  }
  let a = 1;
  if (na > 0) {
    const tt = t * 65535;
    let i = 0;
    while (i < na - 1 && g['atime' + (i + 1)] < tt) i++;
    const a0 = g['key' + i].a,
      t0 = g['atime' + i];
    if (i >= na - 1) a = a0;
    else {
      const a1 = g['key' + (i + 1)].a,
        t1 = g['atime' + (i + 1)];
      const u = t1 > t0 ? (tt - t0) / (t1 - t0) : 0;
      a = a0 + (a1 - a0) * u;
    }
  }
  out[0] = r;
  out[1] = grn;
  out[2] = b;
  out[3] = a;
  return out;
}
function evalMMGradient(mm, t, out) {
  out = out || [1, 1, 1, 1];
  if (!mm) {
    out[0] = out[1] = out[2] = out[3] = 1;
    return out;
  }
  const st = mm.minMaxState;
  // 1=Gradient,3=TwoGradients,4=RandomColor: いずれも maxGradient を評価(4は粒子ごと乱数位置=t=P.rnd)。
  // 4を未対応にすると maxColor(kami01では緑)に落ち、実際の紫グラデが出ず靄が緑化する。
  if (st === 1 || st === 3 || st === 4) return evalGradient(mm.maxGradient, t, out);
  if (st === 2 && mm.minColor && mm.maxColor) {
    const a = mm.minColor,
      b = mm.maxColor,
      u = t == null ? 0.5 : t;
    out[0] = a.r + (b.r - a.r) * u;
    out[1] = a.g + (b.g - a.g) * u;
    out[2] = a.b + (b.b - a.b) * u;
    out[3] = a.a + (b.a - a.a) * u;
    return out;
  }
  const c = mm.maxColor || mm.minColor || { r: 1, g: 1, b: 1, a: 1 };
  out[0] = c.r;
  out[1] = c.g;
  out[2] = c.b;
  out[3] = c.a;
  return out;
}

const _fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const _hash = (x, y, z) => {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (z | 0) * 2147483647 + 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 2147483647.5 - 1;
};
function valueNoise3(x, y, z) {
  const xi = Math.floor(x),
    yi = Math.floor(y),
    zi = Math.floor(z);
  const xf = x - xi,
    yf = y - yi,
    zf = z - zi;
  const u = _fade(xf),
    v = _fade(yf),
    w = _fade(zf);
  const lerp = (a, b, t) => a + (b - a) * t;
  const c000 = _hash(xi, yi, zi),
    c100 = _hash(xi + 1, yi, zi),
    c010 = _hash(xi, yi + 1, zi),
    c110 = _hash(xi + 1, yi + 1, zi);
  const c001 = _hash(xi, yi, zi + 1),
    c101 = _hash(xi + 1, yi, zi + 1),
    c011 = _hash(xi, yi + 1, zi + 1),
    c111 = _hash(xi + 1, yi + 1, zi + 1);
  return lerp(lerp(lerp(c000, c100, u), lerp(c010, c110, u), v), lerp(lerp(c001, c101, u), lerp(c011, c111, u), v), w);
}
function fbmNoise(x, y, z, seed, octaves, octMul, octScale) {
  let amp = 1,
    freq = 1,
    sum = 0,
    norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise3(x * freq + seed, y * freq + seed * 1.7, z * freq + seed * 2.3);
    norm += amp;
    amp *= octMul;
    freq *= octScale;
  }
  return norm > 0 ? sum / norm : 0;
}

// 実ゲームの WebGL フラグメント GLSL(shaders/game-shaders.js に焼き込み)を three RawShaderMaterial(GLSL3)で実行する。
// 頂点は collector 自前(粒子色/worldPos/法線 を vs_INTERP0/1/2 に供給)。Unity uniform(_WorldSpaceCameraPos/MatrixV/
// InvV/_TimeParameters/_MainColor/Speed)を毎フレーム onBeforeRender で実カメラから配線する。推測値は一切入れない。
// 頂点色(startColor)を sRGB→linear 化する GLSL(URP linear + rt linear→最終sRGB 構成に一致させる)。
const S2L_GLSL = 'vec3 s2l(vec3 c){return mix(pow((c+0.055)/1.055,vec3(2.4)),c/12.92,step(c,vec3(0.04045)));}\n';
// g.varyings(頂点静的解析で確定した slot→意味)から vs_INTERP の out 宣言と代入を生成。
// 頂点は quv(uv)/colRgb(粒子色rgb)/colA(alpha)/wp(worldPos)/nrm(法線) をローカルに用意しておくこと。
function genVaryingIO(varyings) {
  const outs = [], asg = [];
  for (const vv of varyings || []) {
    outs.push('out ' + vv.type + ' vs_INTERP' + vv.slot + ';');
    let e;
    if (vv.sem === 'uv') e = vv.type === 'vec4' ? 'vec4(quv,0.0,0.0)' : (vv.type === 'vec3' ? 'vec3(quv,0.0)' : 'quv');
    else if (vv.sem === 'color') e = vv.type === 'vec4' ? 'vec4(s2l(colRgb),colA)' : 's2l(colRgb)';
    else if (vv.sem === 'worldPos') e = vv.type === 'vec4' ? 'vec4(wp,1.0)' : 'wp';
    else if (vv.sem === 'normal') e = vv.type === 'vec4' ? 'vec4(nrm,0.0)' : 'nrm';
    else e = vv.type === 'vec4' ? 'vec4(0.0)' : (vv.type === 'vec3' ? 'vec3(0.0)' : 'vec2(0.0)');
    asg.push('vs_INTERP' + vv.slot + '=' + e + ';');
  }
  return { outs: outs.join('\n'), asg: asg.join('') };
}
// matcap系(skill_fire_normal): worldPos(vs_INTERP1)+法線(vs_INTERP2)を供給。renderAlignment=View は uViewAlign で頂点整列。
const GAME_VERT_MATCAP =
  'precision highp float;\n' +
  'in vec3 position;in vec3 normal;in mat4 instanceMatrix;in vec3 instanceColor;\n' +
  'uniform mat4 modelMatrix;uniform mat4 viewMatrix;uniform mat4 projectionMatrix;uniform vec3 cameraPosition;\n' +
  'uniform float uViewAlign;\n' +
  'out vec4 vs_INTERP0;out vec3 vs_INTERP1;out vec3 vs_INTERP2;\n' +
  S2L_GLSL +
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
  'vs_INTERP0=vec4(s2l(instanceColor),1.0);vs_INTERP1=wp;vs_INTERP2=wn;\n' +
  'gl_Position=projectionMatrix*viewMatrix*vec4(wp,1.0);}';
function genMeshUvVertex(g) {
  const io = genVaryingIO(g.varyings);
  return 'precision highp float;\n' +
    'in vec3 position;in vec3 normal;in vec2 uv;in mat4 instanceMatrix;in vec3 instanceColor;in float iColorA;\n' +
    'uniform mat4 modelMatrix;uniform mat4 viewMatrix;uniform mat4 projectionMatrix;uniform vec3 cameraPosition;uniform float uViewAlign;\n' +
    io.outs + '\n' + S2L_GLSL +
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
    io.asg + '\n' +
    'gl_Position=projectionMatrix*viewMatrix*vec4(wp,1.0);}';
}

function mat4Col(out, m, i) {
  const e = m.elements;
  out.set(e[i * 4 + 0], e[i * 4 + 1], e[i * 4 + 2], e[i * 4 + 3]);
  return out;
}
let _farDepthTex = null;
function farDepthTexture(T) {
  // シーン深度が無い/未供給時の既定=遠(1.0)。soft-particle フェード項が最大(=フェード無効)になる。
  if (_farDepthTex) return _farDepthTex;
  const dt = new T.DataTexture(new Float32Array([1, 1, 1, 1]), 1, 1, T.RGBAFormat, T.FloatType);
  dt.needsUpdate = true;
  _farDepthTex = dt;
  return dt;
}
// フラグメントが宣言する Unity uniform を検出して供給し、毎フレーム実カメラから配線する共通ヘルパ。
// material prop(_MainColor/Speed/Color_*/Vector*_*)は「各オーラの実材質値(mp)を最優先、無ければシェーダ既定」で解決。推測値は入れない。
function buildGameUniforms(T, g, mp) {
  const frag = (g.frag || '') + '\n' + (g.vert || ''); // 実頂点も走査(MatrixVP/_TimeParameters/材質prop は頂点でも使う)
  const has = (n) => new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(frag);
  const u = { _TimeParameters: { value: new T.Vector4(0, 0, 0, 0) } };
  const mc = (mp && mp.colors) || {}, mf = (mp && mp.floats) || {}, mv1 = (mp && mp.vec1) || {};
  for (const [name, pd] of Object.entries(g.props || {})) {
    if (/^vec/.test(pd.type)) {
      const a = mc[name] || pd.def || [0, 0, 0, 0];   // 色/Vector4: 実材質 override 優先
      u[name] = { value: new T.Vector4(a[0] || 0, a[1] || 0, a[2] || 0, a[3] == null ? 0 : a[3]) };
    } else {
      const v = mf[name] != null ? mf[name] : (mv1[name] != null ? mv1[name] : pd.def); // float: 実材質 override 優先
      u[name] = { value: v == null ? 0 : v };
    }
  }
  if (has('_AlphaToMaskAvailable')) u._AlphaToMaskAvailable = { value: 0 };
  if (has('_GlobalMipBias')) u._GlobalMipBias = { value: new T.Vector2(0, 0) };
  if (has('unity_OrthoParams')) u.unity_OrthoParams = { value: new T.Vector4(0, 0, 0, 0) }; // w=0=透視
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
  const _cp = new T.Vector3(), _vp = new T.Matrix4(), _ivp = new T.Matrix4();
  const wire = (renderer, camera) => {
    const near = camera.near || 0.1, far = camera.far || 1000;
    if (u._WorldSpaceCameraPos) { camera.getWorldPosition(_cp); u._WorldSpaceCameraPos.value.copy(_cp); }
    if (u._ProjectionParams) u._ProjectionParams.value.set(1, near, far, 1 / far);
    if (u._ZBufferParams) { const fn = far / near; u._ZBufferParams.value.set(1 - fn, fn, (1 - fn) / far, fn / far); }
    if (u._ScaledScreenParams && renderer) { const sz = renderer.getDrawingBufferSize(new T.Vector2()); u._ScaledScreenParams.value.set(sz.x, sz.y, 1 + 1 / sz.x, 1 + 1 / sz.y); }
    if (u.hlslcc_mtx4x4unity_MatrixV) for (let i = 0; i < 4; i++) mat4Col(u.hlslcc_mtx4x4unity_MatrixV.value[i], camera.matrixWorldInverse, i);
    if (u.hlslcc_mtx4x4unity_MatrixInvV) for (let i = 0; i < 4; i++) mat4Col(u.hlslcc_mtx4x4unity_MatrixInvV.value[i], camera.matrixWorld, i);
    if (u.hlslcc_mtx4x4unity_MatrixVP || u.hlslcc_mtx4x4unity_MatrixInvVP) {
      _vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      if (u.hlslcc_mtx4x4unity_MatrixVP) for (let i = 0; i < 4; i++) mat4Col(u.hlslcc_mtx4x4unity_MatrixVP.value[i], _vp, i);
      if (u.hlslcc_mtx4x4unity_MatrixInvVP) { _ivp.copy(_vp).invert(); for (let i = 0; i < 4; i++) mat4Col(u.hlslcc_mtx4x4unity_MatrixInvVP.value[i], _ivp, i); }
    }
  };
  const setDepth = (tex) => { if (u._CameraDepthTexture) u._CameraDepthTexture.value = tex || farDepthTexture(T); };
  return { uniforms: u, wire, setDepth, needsDepth: needDepth };
}
// 実材質のブレンドを忠実適用。opaque(One/Zero)=深度書込→不透明(手前の透明パーティクルが正しく前後判定される・
// 例: 玉が不透明で深度を書くと、後ろ(sortingOrder-1)の靄が「玉の前にある分だけ」表示され前面にも立ち上る)。
function applyGameBlend(T, mat, blend) {
  if (blend === 'opaque') { mat.transparent = false; mat.depthWrite = true; mat.blending = T.NormalBlending; }
  else if (blend === 'add') { mat.transparent = true; mat.depthWrite = false; mat.blending = T.AdditiveBlending; }
  else { mat.transparent = true; mat.depthWrite = false; mat.blending = T.NormalBlending; } // alpha
  mat.depthTest = true;
  mat.needsUpdate = true;
}
let _whiteTex = null;
function whiteTexture(T) {
  if (_whiteTex) return _whiteTex;
  const dt = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, T.RGBAFormat);
  dt.needsUpdate = true;
  _whiteTex = dt;
  return dt;
}
function makeGameShaderMaterial(T, key, viewAlign, mp, blend, tex) {
  const g = gameShaders[key];
  if (!g) return null;
  const USE_REAL_VERT = true;
  const useRealVert = USE_REAL_VERT && !viewAlign && !!g.vert;
  const useMatcapVert = !useRealVert && key === 'skill_fire_normal';
  const gu = buildGameUniforms(T, g, mp);
  const uniforms = gu.uniforms;
  // baked shader が宣言するテクスチャ sampler に材質の mainTex をバインド(無ければ白=実質無効)。
  // 実ゲーム通り: skill_WaterShildTex 等は texture(Texture,uv) を matcap/HSV 合成に使う。
  for (const sn of g.samplers || []) uniforms[sn] = { value: tex || whiteTexture(T) };
  uniforms.uViewAlign = { value: viewAlign ? 1 : 0 }; // GAME_VERT_MATCAP 用(汎用頂点では未使用)
  const mat = new T.RawShaderMaterial({
    glslVersion: T.GLSL3,
    uniforms,
    vertexShader: useRealVert ? g.vert : (useMatcapVert ? GAME_VERT_MATCAP : genMeshUvVertex(g)),
    fragmentShader: g.frag,
    side: T.DoubleSide,
  });
  applyGameBlend(T, mat, blend);
  const onBeforeRender = (renderer, scene, camera) => gu.wire(renderer, camera);
  const tick = (dt) => { uniforms._TimeParameters.value.x += dt; };
  return { mat, tick, onBeforeRender, setDepth: gu.setDepth };
}

// proc.shader 名 → 焼き込み済み game-shaders.js のキー(= 'Shader Graphs/' 除去名)。
// varying に unknown が残るシェーダ(頂点解析が曖昧)は汎用頂点に載らないので null(=proceduralTex フォールバック)。
// 例外: skill_fire_normal は専用 matcap 頂点(GAME_VERT_MATCAP)で確実に動くので unknownVary でも採用。
function resolveGameKey(sh) {
  if (!sh) return null;
  const key = String(sh).replace(/^Shader Graphs\//, '');
  const g = gameShaders[key];
  if (!g) return null;
  if (g.unknownVary && key !== 'skill_fire_normal') return null;
  // 自前頂点は vs_INTERP* しか供給しない。別命名の varying(vs_TEXCOORD/vs_COLOR=URP標準シェーダ等)を読む
  // フラグメントは駆動できないので game 経路から除外(テクスチャfallbackへ)。
  if (/\bvs_(TEXCOORD|COLOR)\d/.test(g.frag)) return null;
  return key;
}

// billboard(quad)粒子に実ゲームフラグメントGLSLを適用する backend。頂点は g.varyings(頂点静的解析で確定した
// スロット→意味 uv/color/worldPos/normal)から生成し、各 vs_INTERP に正しい値を供給する。soft-particle は
// _CameraDepthTexture(シーン深度プリパス)で実ゲーム同様にフェードする。material params/depth uniform は実データ配線。
function makeGameBillboardBackend(T, key, maxP, P, o) {
  const g = gameShaders[key];
  if (!g) return null;
  const uv = o.uv || { on: false, tilesX: 1, tilesY: 1, frameOf: () => 0 };
  const geo = new T.InstancedBufferGeometry();
  const quad = new T.PlaneGeometry(1, 1);
  geo.index = quad.index;
  geo.attributes.position = quad.attributes.position;
  geo.attributes.uv = quad.attributes.uv;
  const iOffset = new Float32Array(maxP * 3), iColor = new Float32Array(maxP * 4), iSize = new Float32Array(maxP * 2), iRot = new Float32Array(maxP), iUvOff = new Float32Array(maxP * 2);
  geo.setAttribute('iOffset', new T.InstancedBufferAttribute(iOffset, 3));
  geo.setAttribute('iColor', new T.InstancedBufferAttribute(iColor, 4));
  geo.setAttribute('iSize', new T.InstancedBufferAttribute(iSize, 2));
  geo.setAttribute('iRot', new T.InstancedBufferAttribute(iRot, 1));
  geo.setAttribute('iUvOff', new T.InstancedBufferAttribute(iUvOff, 2));
  geo.instanceCount = 0;
  const uvScale = uv.on ? [1 / uv.tilesX, 1 / uv.tilesY] : [1, 1];
  const io = genVaryingIO(g.varyings);
  const vertexShader =
    'precision highp float;\n' +
    'in vec3 position;in vec2 uv;in vec3 iOffset;in vec4 iColor;in vec2 iSize;in float iRot;in vec2 iUvOff;\n' +
    'uniform mat4 modelMatrix;uniform mat4 viewMatrix;uniform mat4 projectionMatrix;uniform vec3 cameraPosition;uniform mat4 uCamWorld;\n' +
    'uniform vec2 uUvScale;uniform float uScale;uniform vec2 uPivot;uniform float uViewAligned;uniform float uRenderMode;\n' +
    io.outs + '\n' + S2L_GLSL +
    'void main(){vec2 quv=uv*uUvScale+iUvOff;vec3 colRgb=iColor.rgb;float colA=iColor.a;vec3 p=position;p.xy-=uPivot;\n' +
    'float cr=cos(iRot),sr=sin(iRot);vec2 r=vec2(p.x*cr-p.y*sr,p.x*sr+p.y*cr)*iSize;vec3 wp;\n' +
    'if(uRenderMode>1.5){vec3 cw=(modelMatrix*vec4(iOffset,1.0)).xyz;vec3 toCam=cameraPosition-cw;toCam.y=0.0;float ll=length(toCam);toCam=ll>1e-5?toCam/ll:vec3(0.0,0.0,1.0);\n' +
    ' vec3 upW=vec3(0.0,1.0,0.0);vec3 rightW=normalize(cross(upW,toCam));vec3 upv=(uRenderMode>2.5)?upW:normalize(cross(rightW,upW));\n' +
    ' wp=cw+rightW*(r.x*uScale)+upv*(r.y*uScale);}\n' +
    'else{vec4 mvc=viewMatrix*modelMatrix*vec4(iOffset,1.0);mvc.xy+=r*uScale;wp=(uCamWorld*mvc).xyz;}\n' +
    'vec3 nrm=normalize(cameraPosition-wp);\n' +
    io.asg + '\n' +
    'gl_Position=projectionMatrix*viewMatrix*vec4(wp,1.0);}';

  const gu = buildGameUniforms(T, g, o.matParams);  // material props(実材質override) + _TimeParameters + depth(必要時)
  const uniforms = gu.uniforms;
  for (const sn of g.samplers || []) uniforms[sn] = { value: o.tex || whiteTexture(T) }; // テクスチャsampler に mainTex をバインド
  uniforms.uUvScale = { value: new T.Vector2(uvScale[0], uvScale[1]) };
  uniforms.uScale = { value: 1 };
  uniforms.uPivot = { value: new T.Vector2(o.pivot ? o.pivot.x : 0, o.pivot ? o.pivot.y : 0) };
  uniforms.uViewAligned = { value: o.viewAligned === false ? 0 : 1 };
  uniforms.uRenderMode = { value: o.renderMode == null ? 0 : o.renderMode };
  uniforms.uCamWorld = { value: new T.Matrix4() };
  const mat = new T.RawShaderMaterial({
    glslVersion: T.GLSL3, uniforms, vertexShader, fragmentShader: g.frag, side: T.DoubleSide,
  });
  applyGameBlend(T, mat, o.blend);
  const unityMesh = new T.Mesh(geo, mat);
  unityMesh.frustumCulled = false;
  unityMesh.onBeforeRender = (renderer, scene, camera) => {
    uniforms.uCamWorld.value.copy(camera.matrixWorld);
    gu.wire(renderer, camera);
  };
  return {
    unityMesh,
    proc: true,
    gameMat: mat,
    tick: (dt) => { uniforms._TimeParameters.value.x += dt; },
    setDepth: gu.setDepth,
    writeInst: (n, i, sm, col) => {
      const o3 = n * 3, c4 = n * 4, s2 = n * 2;
      iOffset[o3] = P.px[i]; iOffset[o3 + 1] = P.py[i]; iOffset[o3 + 2] = P.pz[i];
      iColor[c4] = col[0]; iColor[c4 + 1] = col[1]; iColor[c4 + 2] = col[2]; iColor[c4 + 3] = col[3];
      iSize[s2] = P.sx[i] * sm[0]; iSize[s2 + 1] = P.sy[i] * sm[1];
      iRot[n] = P.rz[i];
      if (uv.on) { const fr = uv.frameOf(i); const fx = fr % uv.tilesX, fy = (fr / uv.tilesX) | 0; iUvOff[n * 2] = fx / uv.tilesX; iUvOff[n * 2 + 1] = (uv.tilesY - 1 - fy) / uv.tilesY; }
    },
    commit: (n) => {
      geo.instanceCount = n;
      geo.attributes.iOffset.needsUpdate = geo.attributes.iColor.needsUpdate = geo.attributes.iSize.needsUpdate = geo.attributes.iRot.needsUpdate = geo.attributes.iUvOff.needsUpdate = true;
    },
    dispose: () => { geo.dispose(); mat.dispose(); quad.dispose(); },
  };
}

function makeMeshBackend(T, maxP, P, meshGeo, tex, proc, viewAlign, procShader, matParams, meshBlend) {
  const bg = new T.BufferGeometry();
  bg.setAttribute('position', new T.BufferAttribute(meshGeo.positions, 3));
  if (meshGeo.normals) bg.setAttribute('normal', new T.BufferAttribute(meshGeo.normals, 3));
  if (meshGeo.uv) bg.setAttribute('uv', new T.BufferAttribute(meshGeo.uv, 2));
  if (meshGeo.indices) bg.setIndex(new T.BufferAttribute(meshGeo.indices, 1));
  // 実ゲームGLSLを焼き込んだ shader key に解決(手続き型近似でなく実コードを直実行)。
  const gameKey = proc ? resolveGameKey(procShader) : null;
  const hasGame = !!gameKey;
  let mat, procMat = null, gameTick = null, gameOnBefore = null, gameSetDepth = null;
  if (hasGame) {
    const gm = makeGameShaderMaterial(T, gameKey, viewAlign, matParams, meshBlend, tex);
    procMat = gm.mat; mat = gm.mat; gameTick = gm.tick; gameOnBefore = gm.onBeforeRender; gameSetDepth = gm.setDepth;
  } else {
    // GLSL未焼込の proc mesh(Circle_add/enemy_fire 等)は proceduralTex+加算で描く。
    mat = new T.MeshBasicMaterial({ map: tex || null, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide });
  }
  const im = new T.InstancedMesh(bg, mat, maxP);
  im.frustumCulled = false;
  im.count = 0;
  im.instanceColor = new T.InstancedBufferAttribute(new Float32Array(maxP * 3), 3);
  // 実ゲームGLSLは vs_INTERP1.w(粒子alpha)をエッジ/フィールド計算に使う。instanceColor(vec3)では alpha を運べないので
  // 専用の per-instance alpha 属性を足し、rgb は非乗算(startColor そのまま)で渡す(乗算+alpha=1固定だとエッジが潰れ濃くなる)。
  let iColA = null;
  if (hasGame) { iColA = new T.InstancedBufferAttribute(new Float32Array(maxP), 1); bg.setAttribute('iColorA', iColA); }
  if (gameOnBefore) im.onBeforeRender = gameOnBefore;
  const dm = new T.Object3D();
  return {
    unityMesh: im,
    // proc=true は専用ShaderMaterial(slash/実GLSL)のみ。MeshBasicMaterial経路は false にして createSystem の
    // blend上書き(加算/alpha/opaque)を効かせる。
    proc: !!procMat,
    tick: gameTick || (procMat && procMat.uniforms && procMat.uniforms.uTime ? (dt) => { procMat.uniforms.uTime.value += dt; } : null),
    setDepth: gameSetDepth,
    writeInst: (n, i, sm, col) => {
      dm.position.set(P.px[i], P.py[i], P.pz[i]);
      dm.rotation.set(P.rx[i], P.ry[i], P.rz[i]);
      dm.scale.set(P.sx[i] * sm[0], P.sy[i] * sm[1], P.sz[i] * sm[2]);
      dm.updateMatrix();
      im.setMatrixAt(n, dm.matrix);
      // game: 非乗算 rgb + alpha 別持ち。非game: 従来どおり alpha 乗算(vec3)。
      if (iColA) { im.instanceColor.setXYZ(n, col[0], col[1], col[2]); iColA.array[n] = col[3]; }
      else im.instanceColor.setXYZ(n, col[0] * col[3], col[1] * col[3], col[2] * col[3]);
    },
    commit: (n) => {
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      im.instanceColor.needsUpdate = true;
      if (iColA) iColA.needsUpdate = true;
    },
    dispose: () => {
      bg.dispose();
      mat.dispose();
    },
  };
}
function makeBillboardBackend(T, maxP, P, { tex, uv, solid, viewAligned, stretched, lengthScale, velocityScale, tint, renderMode, pivot }) {
  const tc = tint || [1, 1, 1, 1];
  const geo = new T.InstancedBufferGeometry();
  const quad = new T.PlaneGeometry(1, 1);
  geo.index = quad.index;
  geo.attributes.position = quad.attributes.position;
  geo.attributes.uv = quad.attributes.uv;
  const iOffset = new Float32Array(maxP * 3),
    iColor = new Float32Array(maxP * 4),
    iSize = new Float32Array(maxP * 2),
    iRot = new Float32Array(maxP),
    iUvOff = new Float32Array(maxP * 2),
    iVel = new Float32Array(maxP * 3);
  geo.setAttribute('iOffset', new T.InstancedBufferAttribute(iOffset, 3));
  geo.setAttribute('iColor', new T.InstancedBufferAttribute(iColor, 4));
  geo.setAttribute('iSize', new T.InstancedBufferAttribute(iSize, 2));
  geo.setAttribute('iRot', new T.InstancedBufferAttribute(iRot, 1));
  geo.setAttribute('iUvOff', new T.InstancedBufferAttribute(iUvOff, 2));
  geo.setAttribute('iVel', new T.InstancedBufferAttribute(iVel, 3));
  geo.instanceCount = 0;
  const uvScale = uv.on ? [1 / uv.tilesX, 1 / uv.tilesY] : [1, 1];
  const mat = new T.ShaderMaterial({
    uniforms: {
      uTex: { value: tex || (solid ? solidTexture(T) : glowTexture(T)) },
      uUvScale: { value: new T.Vector2(uvScale[0], uvScale[1]) },
      uScale: { value: 1 },
      uPivot: { value: new T.Vector2(pivot ? pivot.x : 0, pivot ? pivot.y : 0) },
      uViewAligned: { value: 1 },
      uRenderMode: { value: renderMode == null ? 0 : renderMode },
      uStretch: { value: stretched ? 1 : 0 },
      uLenScale: { value: lengthScale || 2 },
      uVelScale: { value: velocityScale || 0 },
      uTint: { value: new T.Vector4(tc[0] == null ? 1 : tc[0], tc[1] == null ? 1 : tc[1], tc[2] == null ? 1 : tc[2], tc[3] == null ? 1 : tc[3]) },
    },
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    side: T.DoubleSide,
    vertexShader:
      'attribute vec3 iOffset;attribute vec4 iColor;attribute vec2 iSize;attribute float iRot;attribute vec2 iUvOff;attribute vec3 iVel;' +
      'uniform float uScale;uniform vec2 uPivot;uniform float uViewAligned;uniform float uRenderMode;uniform float uStretch;uniform float uLenScale;uniform float uVelScale;' +
      'varying vec2 vUv;varying vec4 vCol;varying vec2 vUvOff;void main(){vUv=uv;vUvOff=iUvOff;vCol=iColor;vec3 p=position;p.xy-=uPivot;' +
      'if(uStretch>0.5){vec3 vv=(modelViewMatrix*vec4(iVel,0.0)).xyz;float sp=length(vv.xy);vec2 vdir=sp>1e-4?vv.xy/sp:vec2(0.0,1.0);vec2 pdir=vec2(-vdir.y,vdir.x);' +
      'float len=iSize.y*(uLenScale+sp*uVelScale);vec2 r=(pdir*(p.x*iSize.x)+vdir*(p.y*len))*uScale;vec4 mv=modelViewMatrix*vec4(iOffset,1.0);mv.xy+=r;gl_Position=projectionMatrix*mv;}' +
      'else{float c=cos(iRot),s=sin(iRot);vec2 r=vec2(p.x*c-p.y*s,p.x*s+p.y*c)*iSize;vec4 cw=modelMatrix*vec4(iOffset,1.0);' +
      'if(uRenderMode>2.5){vec3 toCam=cameraPosition-cw.xyz;toCam.y=0.0;float ll=length(toCam);toCam=ll>1e-5?toCam/ll:vec3(0.0,0.0,1.0);vec3 upW=vec3(0.0,1.0,0.0);vec3 rightW=normalize(cross(upW,toCam));vec3 wp=cw.xyz+rightW*(r.x*uScale)+upW*(r.y*uScale);gl_Position=projectionMatrix*viewMatrix*vec4(wp,1.0);}' +
      'else if(uRenderMode>1.5){vec3 toCam=cameraPosition-cw.xyz;toCam.y=0.0;float ll=length(toCam);toCam=ll>1e-5?toCam/ll:vec3(0.0,0.0,1.0);vec3 upW=vec3(0.0,1.0,0.0);vec3 rightW=normalize(cross(upW,toCam));vec3 fwdW=normalize(cross(rightW,upW));vec3 wp=cw.xyz+rightW*(r.x*uScale)+fwdW*(r.y*uScale);gl_Position=projectionMatrix*viewMatrix*vec4(wp,1.0);}' +
      'else if(uViewAligned>0.5){vec4 mv=modelViewMatrix*vec4(iOffset,1.0);mv.xy+=r*uScale;gl_Position=projectionMatrix*mv;}' +
      'else{vec3 lp=iOffset+vec3(r,0.0);gl_Position=projectionMatrix*modelViewMatrix*vec4(lp,1.0);}}}',
    fragmentShader:
      'uniform sampler2D uTex;uniform vec2 uUvScale;uniform vec4 uTint;varying vec2 vUv;varying vec4 vCol;varying vec2 vUvOff;void main(){vec2 uv=vUv*uUvScale+vUvOff;vec4 t=texture2D(uTex,uv);vec3 rgb=vCol.rgb*t.rgb*uTint.rgb;float m=max(rgb.r,max(rgb.g,rgb.b));if(m>1.0)rgb/=m;gl_FragColor=vec4(rgb,vCol.a*t.a*uTint.a);}',
  });
  mat.uniforms.uViewAligned.value = viewAligned === false ? 0 : 1;
  const unityMesh = new T.Mesh(geo, mat);
  unityMesh.frustumCulled = false;
  return {
    unityMesh,
    writeInst: (n, i, sm, col) => {
      const o = n * 3,
        c = n * 4,
        s = n * 2,
        u = n * 2;
      iOffset[o] = P.px[i];
      iOffset[o + 1] = P.py[i];
      iOffset[o + 2] = P.pz[i];
      iColor[c] = col[0];
      iColor[c + 1] = col[1];
      iColor[c + 2] = col[2];
      iColor[c + 3] = col[3];
      iSize[s] = P.sx[i] * sm[0];
      iSize[s + 1] = P.sy[i] * sm[1];
      iRot[n] = P.rz[i];
      if (stretched) {
        const v = n * 3;
        iVel[v] = P.vx[i];
        iVel[v + 1] = P.vy[i];
        iVel[v + 2] = P.vz[i];
      }
      if (uv.on) {
        const fr = uv.frameOf(i);
        const fx = fr % uv.tilesX,
          fy = (fr / uv.tilesX) | 0;
        iUvOff[u] = fx / uv.tilesX;
        iUvOff[u + 1] = (uv.tilesY - 1 - fy) / uv.tilesY;
      }
    },
    commit: (n) => {
      geo.instanceCount = n;
      geo.attributes.iOffset.needsUpdate = geo.attributes.iColor.needsUpdate = geo.attributes.iSize.needsUpdate = geo.attributes.iRot.needsUpdate = geo.attributes.iUvOff.needsUpdate = true;
      if (stretched) geo.attributes.iVel.needsUpdate = true;
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
      quad.dispose();
    },
  };
}

function createSystem(T, sys, opt) {
  opt = opt || {};
  const ps = sys.ps;
  const init = ps.InitialModule || {},
    em = ps.EmissionModule || {};
  const colMod = ps.ColorModule || {},
    sizeMod = ps.SizeModule || {};
  const shapeMod = ps.ShapeModule || {},
    forceMod = ps.ForceModule || {},
    rotMod = ps.RotationModule || {},
    velMod = ps.VelocityModule || {},
    uvMod = ps.UVModule || {},
    noiseMod = ps.NoiseModule || {},
    clampMod = ps.ClampVelocityModule || {};
  const shapeOn = !!shapeMod.enabled,
    forceOn = !!forceMod.enabled,
    rotOn = !!rotMod.enabled,
    rotSep = !!rotMod.separateAxes,
    velOn = !!velMod.enabled,
    uvOn = !!uvMod.enabled,
    noiseOn = !!noiseMod.enabled,
    clampOn = !!clampMod.enabled;
  const sizeSep = !!(sizeMod.enabled && sizeMod.separateAxes);
  const clampDampen = clampMod.dampen != null ? clampMod.dampen : 0;
  const maxP = Math.max(1, Math.min(2000, init.maxNumParticles | 0 || 100));
  const looping = opt.forceLoop ? true : ps.looping !== false;
  const duration = ps.lengthInSec || 5;
  const simSpeed = ps.simulationSpeed || 1;
  const gravityBase = 9.81;
  const size3D = !!init.size3D,
    rot3D = !!init.rotation3D;
  const startColor = init.startColor;
  const tex = opt.texture || (opt.proc && opt.proc.shader ? proceduralTex(opt.proc) : null);
  const useMesh = sys.renderMode === 4 && opt.meshGeo && opt.meshGeo.positions && opt.meshGeo.positions.length;

  const D2R = Math.PI / 180;
  const shRotE = shapeMod.m_Rotation || { x: 0, y: 0, z: 0 };
  const shScale = shapeMod.m_Scale || { x: 1, y: 1, z: 1 };
  const shPos = shapeMod.m_Position || { x: 0, y: 0, z: 0 };
  const shapeRotMat = new T.Matrix4().makeRotationFromEuler(new T.Euler(shRotE.x * D2R, shRotE.y * D2R, shRotE.z * D2R, 'ZXY'));
  const shPosV = new T.Vector3(shPos.x || 0, shPos.y || 0, shPos.z || 0);
  const _sp = new T.Vector3(),
    _sd = new T.Vector3();
  const shType = shapeMod.type | 0;
  const shRadius = (shapeMod.radius && shapeMod.radius.value) || 0;
  const shThick = shapeMod.radiusThickness != null ? shapeMod.radiusThickness : 1;
  const shArc = ((shapeMod.arc && shapeMod.arc.value) || 360) * D2R;
  const shConeAng = (shapeMod.angle || 0) * D2R;
  const shLen = shapeMod.length || 0;
  const shDonut = shapeMod.donutRadius || 0;
  const sampleR = () => {
    const inner = shRadius * (1 - shThick);
    return Math.sqrt(inner * inner + (shRadius * shRadius - inner * inner) * Math.random());
  };
  const _shapeSample = [0, 0, 0, 0, 0, 0];
  const sampleShape = (o) => {
    if (!shapeOn) {
      o[0] = o[1] = o[2] = 0;
      const u = Math.random() * 2 - 1,
        th = Math.random() * Math.PI * 2,
        rr = Math.sqrt(1 - u * u);
      o[3] = rr * Math.cos(th);
      o[4] = u;
      o[5] = rr * Math.sin(th);
      return;
    }
    if (shType === 0 || shType === 1) {
      const u = Math.random() * 2 - 1,
        th = Math.random() * Math.PI * 2,
        rr = Math.sqrt(1 - u * u),
        r = sampleR();
      o[3] = rr * Math.cos(th);
      o[4] = u;
      o[5] = rr * Math.sin(th);
      o[0] = r * o[3];
      o[1] = r * o[4];
      o[2] = r * o[5];
    } else if (shType === 2 || shType === 3) {
      const u = Math.random(),
        th = Math.random() * Math.PI * 2,
        rr = Math.sqrt(1 - u * u),
        r = sampleR();
      o[3] = rr * Math.cos(th);
      o[4] = u;
      o[5] = rr * Math.sin(th);
      o[0] = r * o[3];
      o[1] = r * o[4];
      o[2] = r * o[5];
    } else if (shType === 10 || shType === 11) {
      const a = Math.random() * shArc,
        r = sampleR();
      o[3] = Math.cos(a);
      o[4] = 0;
      o[5] = Math.sin(a);
      o[0] = r * o[3];
      o[1] = 0;
      o[2] = r * o[5];
    } else if (shType === 12) {
      o[0] = (Math.random() * 2 - 1) * shRadius;
      o[1] = 0;
      o[2] = 0;
      o[3] = 0;
      o[4] = 1;
      o[5] = 0;
    } else if (shType === 17) {
      const a = Math.random() * shArc,
        phi = Math.random() * Math.PI * 2,
        rr = shDonut * Math.sqrt(Math.random());
      const cx = Math.cos(a),
        cz = Math.sin(a),
        cp = Math.cos(phi);
      o[0] = (shRadius + rr * cp) * cx;
      o[1] = rr * Math.sin(phi);
      o[2] = (shRadius + rr * cp) * cz;
      o[3] = cx * cp;
      o[4] = Math.sin(phi);
      o[5] = cz * cp;
    } else {
      const a = Math.random() * shArc,
        r = sampleR(),
        sa = Math.sin(shConeAng),
        ca = Math.cos(shConeAng);
      const cx = Math.cos(a),
        cz = Math.sin(a);
      o[0] = r * cx;
      o[1] = 0;
      o[2] = r * cz;
      o[3] = cx * sa;
      o[4] = ca;
      o[5] = cz * sa;
      if ((shType === 8 || shType === 9) && shLen > 0) {
        const tt = Math.random() * shLen;
        o[0] += o[3] * tt;
        o[1] += o[4] * tt;
        o[2] += o[5] * tt;
      }
    }
  };

  const uvTilesX = Math.max(1, uvMod.tilesX | 0 || 1),
    uvTilesY = Math.max(1, uvMod.tilesY | 0 || 1);
  const uvAnimType = uvMod.animationType | 0;
  const uvRowIndex = uvMod.rowIndex | 0,
    uvCycles = uvMod.cycles || 1;
  const uvFrames = uvOn ? (uvAnimType === 1 ? uvTilesX : uvTilesX * uvTilesY) : 1;
  function uvFrameOf(i) {
    const t = P.life[i] > 0 ? P.age[i] / P.life[i] : 0;
    const fnorm = evalMMCurve(uvMod.frameOverTime, t, P.rnd[i]);
    const sf = evalMMCurve(uvMod.startFrame, 0, P.rnd[i]) || 0;
    let frame = Math.floor(fnorm * uvCycles * uvFrames + sf);
    frame = ((frame % uvFrames) + uvFrames) % uvFrames;
    return uvAnimType === 1 ? uvRowIndex * uvTilesX + frame : frame;
  }

  const nzFreq = noiseMod.frequency || 0.5;
  const nzOct = Math.max(1, Math.min(4, noiseMod.octaves | 0 || 1));
  const nzOctMul = noiseMod.octaveMultiplier != null ? noiseMod.octaveMultiplier : 0.5;
  const nzOctScale = noiseMod.octaveScale != null ? noiseMod.octaveScale : 2;
  const nzSep = !!noiseMod.separateAxes;
  let nzTime = 0;

  let selfEmit = true,
    emitEvents = false,
    ox = 0,
    oy = 0,
    oz = 0;
  const births = [],
    deaths = [];

  const P = {
    age: new Float32Array(maxP),
    life: new Float32Array(maxP),
    alive: new Uint8Array(maxP),
    px: new Float32Array(maxP),
    py: new Float32Array(maxP),
    pz: new Float32Array(maxP),
    vx: new Float32Array(maxP),
    vy: new Float32Array(maxP),
    vz: new Float32Array(maxP),
    sx: new Float32Array(maxP),
    sy: new Float32Array(maxP),
    sz: new Float32Array(maxP),
    rx: new Float32Array(maxP),
    ry: new Float32Array(maxP),
    rz: new Float32Array(maxP),
    grav: new Float32Array(maxP),
    rnd: new Float32Array(maxP),
    spx: new Float32Array(maxP),
    spy: new Float32Array(maxP),
    spz: new Float32Array(maxP),
    rz0: new Float32Array(maxP),
  };

  const viewAligned = sys.renderAlignment == null || sys.renderAlignment === 0 || sys.renderAlignment === 3;
  const stretched = sys.renderMode === 1;
  const procShaderName = opt.proc && opt.proc.shader ? opt.proc.shader : '';
  // baked game shader が解決できるなら(プロシージャルでもテクスチャ付きでも)実GLSLで描く。
  // 解決できない材質のみ従来の tex 素通し/proceduralTex フォールバック。
  const meshProc = useMesh && !!resolveGameKey(procShaderName);
  const meshViewAlign = sys.renderAlignment === 0 || sys.renderAlignment == null;
  // 実材質のブレンド('opaque'/'add'/'alpha')。opaque は深度書込＝手前の透明パーティクルが正しく前後判定される。
  const gameBlend = opt.matOpaque ? 'opaque' : (opt.matAdditive ? 'add' : 'alpha');
  // billboard 系(靄/メテオ等)も焼込済み game shader があれば実GLSLで描く(stretch系除く)。
  const billboardGameKey = (!useMesh && !stretched) ? resolveGameKey(procShaderName) : null;
  const backend = useMesh
    ? makeMeshBackend(T, maxP, P, opt.meshGeo, tex, meshProc, meshViewAlign, procShaderName, opt.proc, gameBlend)
    : billboardGameKey
      ? makeGameBillboardBackend(T, billboardGameKey, maxP, P, {
          uv: { on: uvOn, tilesX: uvTilesX, tilesY: uvTilesY, frameOf: uvFrameOf },
          viewAligned, renderMode: sys.renderMode, pivot: sys.pivot, matParams: opt.proc, blend: gameBlend, tex,
        })
      : makeBillboardBackend(T, maxP, P, {
        tex,
        uv: { on: uvOn, tilesX: uvTilesX, tilesY: uvTilesY, frameOf: uvFrameOf },
        solid: opt.solid,
        viewAligned,
        stretched,
        lengthScale: sys.lengthScale || 2,
        velocityScale: sys.velocityScale || 0,
        tint: opt.tint,
        renderMode: sys.renderMode,
        pivot: sys.pivot,
      });
  const unityMesh = backend.unityMesh,
    writeInst = backend.writeInst,
    disposeFn = backend.dispose;
  const _additive = opt.matAdditive != null ? opt.matAdditive : opt.defaultBlend !== 'normal';
  // 手続き型mesh backend は専用ShaderMaterialで blend/depth を自前設定済み(depthWrite=false等)なので上書きしない。
  if (unityMesh && unityMesh.material && !backend.proc) {
    const mm = unityMesh.material;
    if (opt.matOpaque) {
      mm.blending = T.NormalBlending;
      mm.transparent = false;
      mm.depthWrite = true;
      // opaque かつ手続き型(実テクスチャ無し=形状は生成αに在る)は alphaTest でカットアウト
      // (Debuff/skill_fire等)。実テクスチャのopaque(hanpen等)は全面不透明のまま。
      if (opt.proc && !opt.texture) mm.alphaTest = opt.cutoff != null ? opt.cutoff : 0.5;
    } else {
      mm.blending = _additive ? T.AdditiveBlending : T.NormalBlending;
    }
    mm.needsUpdate = true;
  }

  const emEnabled = em.enabled !== false;
  const bursts = (em.m_Bursts || []).map((b) => ({
    time: b.time || 0,
    count: b.countCurve,
    cycles: b.cycleCount == null ? 1 : b.cycleCount,
    repeat: b.repeatInterval || 0,
    prob: b.probability == null ? 1 : b.probability,
  }));
  const startDelayV = Math.max(0, sampleMM(ps.startDelay, Math.random()) || 0);
  let emitAcc = 0,
    sysTime = 0,
    curLoop = -1;
  const burstFired = new Array(bursts.length).fill(0);
  const rateOver = () => (opt.emissionRateOverride != null ? opt.emissionRateOverride : evalMMCurve(em.rateOverTime, 0));
  // 表示メッシュ系(burstのみ・rate0・looping)は再バーストせず粒子を持続させ age をラップ＝ループ境界の再spawnジャンプ/隙間を消す
  const persistLoop = looping && bursts.length > 0 && rateOver() <= 0 && opt.emissionRateOverride == null;
  const spawn = () => {
    let idx = -1;
    for (let i = 0; i < maxP; i++)
      if (!P.alive[i]) {
        idx = i;
        break;
      }
    if (idx < 0) return;
    P.alive[idx] = 1;
    P.age[idx] = 0;
    const rn = Math.random();
    P.rnd[idx] = rn;
    P.life[idx] = Math.max(0.05, sampleMM(init.startLifetime, rn));
    const sx = sampleMM(init.startSize, rn) || 1;
    P.sx[idx] = sx;
    P.sy[idx] = size3D ? sampleMM(init.startSizeY, rn) || sx : sx;
    P.sz[idx] = size3D ? sampleMM(init.startSizeZ, rn) || sx : sx;
    P.rx[idx] = rot3D ? sampleMM(init.startRotationX, rn) || 0 : 0;
    P.ry[idx] = rot3D ? sampleMM(init.startRotationY, rn) || 0 : 0;
    P.rz[idx] = sampleMM(init.startRotation, rn) || 0;
    P.grav[idx] = sampleMM(init.gravityModifier, rn) || 0;
    const spd = sampleMM(init.startSpeed, rn);
    sampleShape(_shapeSample);
    _sp
      .set(_shapeSample[0] * shScale.x, _shapeSample[1] * shScale.y, _shapeSample[2] * shScale.z)
      .applyMatrix4(shapeRotMat)
      .add(shPosV);
    _sd.set(_shapeSample[3], _shapeSample[4], _shapeSample[5]).applyMatrix4(shapeRotMat);
    P.px[idx] = _sp.x + ox;
    P.py[idx] = _sp.y + oy;
    P.pz[idx] = _sp.z + oz;
    P.vx[idx] = _sd.x * spd;
    P.vy[idx] = _sd.y * spd;
    P.vz[idx] = _sd.z * spd;
    P.spx[idx] = P.px[idx];
    P.spy[idx] = P.py[idx];
    P.spz[idx] = P.pz[idx];
    P.rz0[idx] = P.rz[idx];
    if (emitEvents) births.push(P.px[idx], P.py[idx], P.pz[idx]);
  };
  const emitAt = (x, y, z, count) => {
    ox = x;
    oy = y;
    oz = z;
    for (let k = 0; k < count; k++) spawn();
    ox = oy = oz = 0;
  };

  const emit = (dt) => {
    if (!emEnabled || !selfEmit) return;
    sysTime += dt;
    const local = sysTime - startDelayV;
    if (local < 0) return;
    const overDur = !looping && local > duration;
    const cycleT = looping ? local % duration : Math.min(local, duration);
    if (looping && !persistLoop) {
      const li = Math.floor(local / duration);
      if (li !== curLoop) {
        curLoop = li;
        burstFired.fill(0);
      }
    }
    for (let bi = 0; bi < bursts.length; bi++) {
      const bd = bursts[bi];
      const instant = bd.repeat <= 0;
      const maxCyc = instant ? 1 : bd.cycles <= 0 ? 1e9 : bd.cycles;
      const volley = instant && bd.cycles > 1 ? bd.cycles : 1;
      let guard = 0;
      while (burstFired[bi] < maxCyc && guard++ < 4096) {
        const fireT = bd.time + burstFired[bi] * bd.repeat;
        if (cycleT + 1e-6 < fireT || overDur) break;
        if (Math.random() <= bd.prob) {
          const cnt = (Math.round(sampleMM(bd.count, Math.random())) || 0) * volley;
          for (let k = 0; k < cnt; k++) spawn();
        }
        burstFired[bi]++;
      }
    }
    if (!overDur) {
      const rate = rateOver();
      if (rate > 0) {
        emitAcc += rate * dt;
        while (emitAcc >= 1) {
          spawn();
          emitAcc -= 1;
        }
      }
    }
  };

  const tmpCol = [1, 1, 1, 1],
    scol = [1, 1, 1, 1],
    _sm = [1, 1, 1];
  const _gravDir = [0, -1, 0]; // world -Y をメッシュのローカル系に変換した方向(createAuraParticles が毎フレーム更新)
  const update = (dt) => {
    dt *= simSpeed;
    if (backend.tick) backend.tick(dt);
    if (emitEvents) {
      births.length = 0;
      deaths.length = 0;
    }
    emit(dt);
    if (noiseOn) nzTime += evalMMCurve(noiseMod.scrollSpeed, 0) * dt;
    let n = 0;
    for (let i = 0; i < maxP; i++) {
      if (!P.alive[i]) continue;
      P.age[i] += dt;
      if (P.age[i] >= P.life[i]) {
        if (persistLoop && P.life[i] > 1e-4) {
          P.age[i] -= P.life[i] * Math.floor(P.age[i] / P.life[i]);
          P.px[i] = P.spx[i]; P.py[i] = P.spy[i]; P.pz[i] = P.spz[i];
          P.vx[i] = 0; P.vy[i] = 0; P.vz[i] = 0;
          P.rz[i] = P.rz0[i];
        } else {
          if (emitEvents) deaths.push(P.px[i], P.py[i], P.pz[i]);
          P.alive[i] = 0;
          continue;
        }
      }
      const t = P.age[i] / P.life[i];
      // 重力は常にワールド空間(world -Y)。粒子速度はメッシュのローカル系なので、world下方向をローカルに変換した
      // _gravDir に沿って加える(mesh が回転/spinノード配下だと local Y≠world Y になる＝靄が横流れするのを是正)。
      const gA = gravityBase * P.grav[i] * dt;
      P.vx[i] += _gravDir[0] * gA;
      P.vy[i] += _gravDir[1] * gA;
      P.vz[i] += _gravDir[2] * gA;
      if (forceOn) {
        P.vx[i] += evalMMCurve(forceMod.x, t) * dt;
        P.vy[i] += evalMMCurve(forceMod.y, t) * dt;
        P.vz[i] += evalMMCurve(forceMod.z, t) * dt;
      }
      if (rotOn) {
        if (rotSep) {
          P.rx[i] += evalMMCurve(rotMod.x, t) * dt;
          P.ry[i] += evalMMCurve(rotMod.y, t) * dt;
        }
        P.rz[i] += evalMMCurve(rotMod.curve, t) * dt;
      }
      let vlx = 0,
        vly = 0,
        vlz = 0;
      if (velOn) {
        vlx = evalMMCurve(velMod.x, t);
        vly = evalMMCurve(velMod.y, t);
        vlz = evalMMCurve(velMod.z, t);
      }
      let nzSizeF = 1;
      if (noiseOn) {
        const px = P.px[i] * nzFreq,
          py = P.py[i] * nzFreq,
          pz = P.pz[i] * nzFreq;
        const nx = fbmNoise(px + nzTime, py, pz, 0, nzOct, nzOctMul, nzOctScale);
        const ny = fbmNoise(px, py + nzTime, pz, 17, nzOct, nzOctMul, nzOctScale);
        const nz = fbmNoise(px, py, pz + nzTime, 43, nzOct, nzOctMul, nzOctScale);
        const sX = evalMMCurve(noiseMod.strength, t),
          sY = nzSep ? evalMMCurve(noiseMod.strengthY, t) : sX,
          sZ = nzSep ? evalMMCurve(noiseMod.strengthZ, t) : sX;
        const posAmt = evalMMCurve(noiseMod.positionAmount, t);
        const pa = posAmt === 0 ? 1 : posAmt;
        vlx += nx * sX * pa;
        vly += ny * sY * pa;
        vlz += nz * sZ * pa;
        const rotAmt = evalMMCurve(noiseMod.rotationAmount, t);
        if (rotAmt) P.rz[i] += nx * rotAmt * dt;
        const szAmt = evalMMCurve(noiseMod.sizeAmount, t);
        if (szAmt) nzSizeF = Math.max(0, 1 + nx * szAmt);
      }
      if (clampOn) {
        const lim = evalMMCurve(clampMod.magnitude, t);
        if (lim > 0) {
          const sp = Math.hypot(P.vx[i], P.vy[i], P.vz[i]);
          if (sp > lim) {
            const f = (sp - (sp - lim) * clampDampen) / sp;
            P.vx[i] *= f;
            P.vy[i] *= f;
            P.vz[i] *= f;
          }
        }
      }
      P.px[i] += (P.vx[i] + vlx) * dt;
      P.py[i] += (P.vy[i] + vly) * dt;
      P.pz[i] += (P.vz[i] + vlz) * dt;
      evalMMGradient(startColor, P.rnd[i], scol);
      if (colMod.enabled) {
        evalGradient(colMod.gradient && colMod.gradient.maxGradient, t, tmpCol);
        scol[0] *= tmpCol[0];
        scol[1] *= tmpCol[1];
        scol[2] *= tmpCol[2];
        scol[3] *= tmpCol[3];
      }
      let smx = 1;
      if (sizeMod.enabled) smx = evalMMCurve(sizeMod.curve, t) || 1;
      let smy = smx,
        smz = smx;
      if (sizeSep) {
        smy = evalMMCurve(sizeMod.y, t) || 1;
        smz = evalMMCurve(sizeMod.z, t) || 1;
      }
      if (nzSizeF !== 1) {
        smx *= nzSizeF;
        smy *= nzSizeF;
        smz *= nzSizeF;
      }
      _sm[0] = smx;
      _sm[1] = smy;
      _sm[2] = smz;
      writeInst(n, i, _sm, scol);
      n++;
    }
    backend.commit(n);
  };
  const doPrewarm = () => {
    if (ps.prewarm && looping && duration > 0) {
      const steps = 30,
        wdt = duration / steps;
      for (let k = 0; k < steps; k++) update(wdt);
    }
  };
  const livePos = () => {
    const a = [];
    for (let i = 0; i < maxP; i++) if (P.alive[i]) a.push(P.px[i], P.py[i], P.pz[i]);
    return a;
  };
  return {
    unityMesh,
    update,
    dispose: disposeFn,
    emitAt,
    births,
    deaths,
    doPrewarm,
    livePos,
    setDepth: backend.setDepth || null,
    setGravDir: (x, y, z) => { _gravDir[0] = x; _gravDir[1] = y; _gravDir[2] = z; },
    ownRate: () => rateOver(),
    setSubDriven: () => {
      selfEmit = false;
    },
    enableEvents: () => {
      emitEvents = true;
    },
  };
}

// Unity Quaternion.Euler(x,y,z) = Ry(y)·Rx(x)·Rz(z) (ZXY: Z→X→Y の順で適用) を three で再現。
const _qx = { v: null }, _qy = { v: null }, _qz = { v: null };
function unityEulerQuat(T, out, xDeg, yDeg, zDeg) {
  const d = Math.PI / 180;
  if (!_qx.v) { _qx.v = new T.Quaternion(); _qy.v = new T.Quaternion(); _qz.v = new T.Quaternion(); }
  _qx.v.setFromAxisAngle(_AX_X, xDeg * d);
  _qy.v.setFromAxisAngle(_AX_Y, yDeg * d);
  _qz.v.setFromAxisAngle(_AX_Z, zDeg * d);
  out.copy(_qy.v).multiply(_qx.v).multiply(_qz.v);
  return out;
}
let _AX_X = null, _AX_Y = null, _AX_Z = null;

function createAuraParticles(bytes, opt) {
  if (!THREE_NS) return null;
  if (!_AX_X) { _AX_X = new THREE_NS.Vector3(1, 0, 0); _AX_Y = new THREE_NS.Vector3(0, 1, 0); _AX_Z = new THREE_NS.Vector3(0, 0, 1); }
  const data = vfxParse.parseVfx(bytes);
  if (!data || !data.systems.length) return null;
  const group = new THREE_NS.Group();
  const sims = [];
  const simByPid = new Map();
  const texByMatPid = (opt && opt.texByMatPid) || null;
  const gate = data.animGate;
  const gateOn = !(opt && opt.ignoreGate);
  const inactive = (gate && gate.inactive) || [];
  const emissionMap = new Map((gate && gate.emission) || []);
  // prefab で m_IsActive=false の GameObject は既定で非表示(loop2 等スキル専用要素)。ignoreGate でも尊重する
  // (これは Animator の gate ではなく prefab の静的既定)。ただし idle state が明示 active 化する path は表示。
  const defaultActiveSet = new Set((gate && gate.defaultActive) || []);
  const goHidden = (sys) => sys.goActive === false && !defaultActiveSet.has(sys.path);
  const gateHidden = (p) => {
    if (!gateOn || !p) return false;
    if (inactive.some((ip) => p === ip || p.startsWith(ip + '/'))) return true;
    for (const [ep, ev] of emissionMap) if (ev <= 0.0001 && (p === ep || p.startsWith(ep + '/'))) return true;
    return false;
  };
  // Transform euler アニメ(周回)ノード。子systemはこのノード配下に localPos で置き、node を回して周回を再生する。
  const spinNodes = new Map();
  for (const a of data.transformAnims || []) {
    const node = new THREE_NS.Group();
    const np = a.nodeWorldPos || { x: 0, y: 0, z: 0 };
    node.position.set(np.x || 0, np.y || 0, np.z || 0);
    group.add(node);
    spinNodes.set(a.path, { node, anim: a, t: 0 });
  }
  for (const sys of data.systems) {
    if (gateHidden(sys.path)) continue;
    if (goHidden(sys)) continue; // 既定非アクティブ(m_IsActive=false)のスキル専用要素を idle で描かない
    const so = { ...(opt || {}) };
    so.forceLoop = true;
    so.meshGeo = (sys.meshPid && data.meshByPid && data.meshByPid[sys.meshPid]) || null;
    if (gateOn && emissionMap.has(sys.path) && emissionMap.get(sys.path) > 0.0001) so.emissionRateOverride = emissionMap.get(sys.path);
    const e = texByMatPid && sys.matPid ? texByMatPid.get(sys.matPid) : null;
    if (e) {
      so.texture = e.tex || null;
      so.proc = e.proc || null;
      so.matAdditive = e.blend === 'add';
      so.matOpaque = e.blend === 'opaque';
      so.solid = e.solid;
      so.tint = e.tint;
      so.cutoff = e.cutoff;
    }
    const s = createSystem(THREE_NS, sys, so);
    s._sys = sys;
    s._subDriven = false;
    // 周回アニメ親がある系はそのノードのローカル系に置く(localPos/localRot)。無ければ world 直置き。
    const spin = sys.animParent ? spinNodes.get(sys.animParent) : null;
    s._spin = spin;
    const p = (spin && sys.localPos) ? sys.localPos : (sys.pos || { x: 0, y: 0, z: 0 });
    s.unityMesh.position.set(p.x || 0, p.y || 0, p.z || 0);
    const sc = sys.scale || { x: 1, y: 1, z: 1 };
    s.unityMesh.scale.set(sc.x || 1, sc.y || 1, sc.z || 1);
    const mm = s.unityMesh.material;
    if (mm && mm.uniforms && mm.uniforms.uScale) mm.uniforms.uScale.value = Math.abs(sc.x || 1);
    s.unityMesh.userData = {
      name: sys.name || '',
      sortingOrder: sys.sortingOrder || 0,
      renderMode: sys.renderMode,
      renderAlignment: sys.renderAlignment,
      moveWithTransform: sys.moveWithTransform,
      moveWithCustomTransformPathID: sys.moveWithCustomTransformPathID,
      matAdditive: so.matAdditive,
      matPid: sys.matPid,
      startColor: sys.ps && sys.ps.InitialModule ? sys.ps.InitialModule.startColor : null,
    };
    s.unityMesh.renderOrder = sys.sortingOrder || 0;
    const q = (spin && sys.localRot) ? sys.localRot : sys.rot;
    if (q && (q.x || q.y || q.z || q.w !== 1)) s.unityMesh.quaternion.set(q.x || 0, q.y || 0, q.z || 0, q.w == null ? 1 : q.w);
    if (sys.renderMode !== 5) (spin ? spin.node : group).add(s.unityMesh);
    sims.push(s);
    if (sys.objPid) simByPid.set(String(sys.objPid), s);
  }
  const links = [];
  for (const lk of vfxParse.getSubEmitterLinks(sims.map((s) => s._sys))) {
    const parent = lk.parent.objPid != null ? simByPid.get(String(lk.parent.objPid)) : null;
    const child = simByPid.get(lk.childObjPid);
    if (!parent || !child || child === parent) continue;
    child.setSubDriven();
    child._subDriven = true;
    // 死亡サブエミッタのみ親の birth/death イベントを要する。誕生(type0)は親の生存中ずっと
    // 子が自身の rate で親位置に発生し続ける(Unity Birth サブエミッタ挙動)ので acc で連続駆動。
    if (lk.type === 2) parent.enableEvents();
    links.push({ parent, child, type: lk.type, prob: lk.prob, childRate: child.ownRate ? child.ownRate() : 0, acc: 0 });
  }
  for (const s of sims) if (!s._subDriven && s.doPrewarm) s.doPrewarm();
  const _wp = new THREE_NS.Vector3(),
    _cl = new THREE_NS.Vector3(),
    _inv = new THREE_NS.Matrix4();
  const _spinQ = new THREE_NS.Quaternion();
  const _gq = new THREE_NS.Quaternion(), _gd = new THREE_NS.Vector3();
  // 各 sim のメッシュ world 回転(spinノード×mesh)から world -Y をローカル方向に変換し、重力方向として渡す。
  const updateGravDirs = () => {
    for (const s of sims) {
      if (!s.setGravDir || !s.unityMesh) continue;
      if (s._spin && s._spin.node) _gq.copy(s._spin.node.quaternion).multiply(s.unityMesh.quaternion);
      else _gq.copy(s.unityMesh.quaternion);
      _gq.invert();
      _gd.set(0, -1, 0).applyQuaternion(_gq);
      s.setGravDir(_gd.x, _gd.y, _gd.z);
    }
  };
  // 実キーフレーム列 keys=[[t,v],...] を区分線形補間(clip をループ)。静止→急回転→静止の実カーブを再現。
  const sampleKeys = (keys, t) => {
    const n = keys.length;
    if (n === 1) return keys[0][1];
    if (t <= keys[0][0]) return keys[0][1];
    if (t >= keys[n - 1][0]) return keys[n - 1][1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (keys[m][0] <= t) lo = m; else hi = m; }
    const a = keys[lo], b = keys[hi];
    const u = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0;
    return a[1] + (b[1] - a[1]) * u;
  };
  const advanceSpins = (dt) => {
    for (const sp of spinNodes.values()) {
      const a = sp.anim;
      const dur = a.dur > 0.01 ? a.dur : 10;
      sp.t = (sp.t + dt) % dur;
      const val = a.keys && a.keys.length ? sampleKeys(a.keys, sp.t) : a.from + (a.to - a.from) * (sp.t / dur);
      const e = a.eulerStatic || [0, 0, 0];
      const ex = a.axis === 0 ? val : e[0];
      const ey = a.axis === 1 ? val : e[1];
      const ez = a.axis === 2 ? val : e[2];
      unityEulerQuat(THREE_NS, _spinQ, ex, ey, ez);
      sp.node.quaternion.copy(_spinQ);
    }
  };
  advanceSpins(0);
  return {
    group,
    update(dt) {
      advanceSpins(dt);
      updateGravDirs();
      for (const s of sims) s.update(dt);
      for (const L of links) {
        L.child.unityMesh.updateMatrix();
        _inv.copy(L.child.unityMesh.matrix).invert();
        if (L.type === 0) {
          // Birth サブエミッタ: サブ自身の rateOverTime(実データ)で発生し、位置を親の生存粒子から継承する。
          // (×親粒子数や×3 の目分量は誤り＝過剰発生の原因だった。総rate=子の実rateのみ。)
          const live = L.parent.livePos();
          if (!live.length) continue;
          L.parent.unityMesh.updateMatrix();
          L.acc += (L.childRate > 0 ? L.childRate : 0) * dt;
          let toEmit = Math.floor(L.acc);
          if (toEmit <= 0) continue;
          L.acc -= toEmit;
          while (toEmit-- > 0) {
            const base = (Math.floor(Math.random() * (live.length / 3))) * 3;
            if (Math.random() > L.prob) continue;
            _wp.set(live[base], live[base + 1], live[base + 2]).applyMatrix4(L.parent.unityMesh.matrix);
            _cl.copy(_wp).applyMatrix4(_inv);
            L.child.emitAt(_cl.x, _cl.y, _cl.z, 1);
          }
        } else {
          const src = L.parent.deaths;
          if (!src.length) continue;
          L.parent.unityMesh.updateMatrix();
          for (let k = 0; k + 2 < src.length; k += 3) {
            if (Math.random() > L.prob) continue;
            _wp.set(src[k], src[k + 1], src[k + 2]).applyMatrix4(L.parent.unityMesh.matrix);
            _cl.copy(_wp).applyMatrix4(_inv);
            L.child.emitAt(_cl.x, _cl.y, _cl.z, 1); // 死亡サブは親死亡1件につき1発(旧: 目分量の3を撤去)
          }
        }
      }
    },
    dispose() {
      for (const s of sims) s.dispose();
    },
    // model3d-lib が毎フレーム、シーン深度プリパスのテクスチャを soft-particle シェーダへ供給する。
    setDepthTexture(tex) {
      for (const s of sims) if (s.setDepth) s.setDepth(tex);
    },
    systemCount: sims.length,
  };
}

export const auraRenderer = { createAuraParticles };
