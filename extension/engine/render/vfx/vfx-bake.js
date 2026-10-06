import * as THREE from '../../../vendor/three.module.js';
import { gameShaders } from '../shaders/game-shaders.js';
import { genVaryingIO, buildGameUniforms, whiteTexture, resolveGameKey, effectiveVaryings, usesRealVertex, collectSamplers, samplerPlaceholder, ENGINE_TEXTURE_NAME } from '../game-shader-util.js';
import { applyMatAnim } from './vfx-matanim.js';
import { noteBuildFailure, notePlayFailure } from './vfx-failures.js';

const BAKE_SIZE = 256;
let _bakeRT = null,
  _bakeRenderer = null,
  _bakeScene = null,
  _bakeCam = null,
  _bakeMesh = null,
  _bakeDead = false;
const _bakeCache = new Map();

function bakeVertex(g, values) {
  const io = genVaryingIO(effectiveVaryings(g), values);
  return (
    'precision highp float;\n' +
    'in vec3 position;in vec2 uv;\n' +
    io.outs +
    '\n' +
    'void main(){vec2 quv=uv;vec3 wp=vec3(position.xy,0.0);vec3 nrm=vec3(0.0,0.0,-1.0);vec3 colRgb=vec3(1.0);float colA=1.0;\n' +
    io.asg +
    '\ngl_Position=vec4(position.xy,0.0,1.0);}'
  );
}

function ensureBakeScene() {
  if (_bakeScene) return;
  _bakeScene = new THREE.Scene();
  _bakeCam = new THREE.Camera();
  _bakeMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
  _bakeMesh.frustumCulled = false;
  _bakeScene.add(_bakeMesh);
}

function ensureBaker() {
  if (_bakeDead) return false;
  ensureBakeScene();
  if (_bakeRenderer) return true;
  try {
    const cv = document.createElement('canvas');
    cv.width = BAKE_SIZE;
    cv.height = BAKE_SIZE;
    _bakeRenderer = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: false });
    _bakeRenderer.setClearColor(0x000000, 0);
    _bakeRT = new THREE.WebGLRenderTarget(BAKE_SIZE, BAKE_SIZE, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat });
    return true;
  } catch (e) {
    noteBuildFailure('bakeRenderer', e);
    _bakeDead = true;
    return false;
  }
}

const SHADER_TIME_RE = /_TimeParameters|\b_Time\b/;

const _sessions = new Set();
export function createBakeSession() {
  const s = { live: [], time: 0 };
  _sessions.add(s);
  return s;
}
export function disposeBakeSession(s) {
  if (!s) return;
  s.live.length = 0;
  _sessions.delete(s);
}
export function clearSessionBakes(s) {
  if (s) s.live.length = 0;
}
const liveInUse = (live) => {
  for (const s of _sessions) if (s.live.indexOf(live) >= 0) return true;
  return false;
};

function renderBake(gu, mat, px) {
  gu.wire(_bakeRenderer, _bakeCam);
  _bakeMesh.material = mat;
  _bakeRenderer.setRenderTarget(_bakeRT);
  _bakeRenderer.clear(true, true, true);
  _bakeRenderer.render(_bakeScene, _bakeCam);
  _bakeRenderer.readRenderTargetPixels(_bakeRT, 0, 0, BAKE_SIZE, BAKE_SIZE, px);
  _bakeRenderer.setRenderTarget(null);
  _bakeMesh.material = null;
}

const BAKE_CACHE_MAX = 192;
let _bakeGen = 0;
export function beginBakeGeneration() {
  _bakeGen++;
}
function _disposeBakeRec(rec) {
  if (!rec) return;
  try {
    if (rec.live && rec.live.rt) rec.live.rt.dispose();
    else if (rec.tex && rec.tex.dispose) rec.tex.dispose();
    if (rec.live && rec.live.mat) rec.live.mat.dispose();
  } catch (e) {}
}
function _bakeCachePut(ck, rec) {
  rec.gen = _bakeGen;
  _bakeCache.set(ck, rec);
  if (_bakeCache.size <= BAKE_CACHE_MAX) return;
  for (const [k, v] of _bakeCache) {
    if (_bakeCache.size <= BAKE_CACHE_MAX) break;
    if (!v || v.gen === _bakeGen || (v.live && liveInUse(v.live))) continue;
    _bakeCache.delete(k);
    _disposeBakeRec(v);
  }
}

const STRIP_CACHE_MAX = 48;
const _stripCache = new Map();
function _disposeStripRec(rec) {
  if (!rec) return;
  try {
    if (rec.res && rec.res.tex && rec.res.tex.dispose) rec.res.tex.dispose();
    if (rec.live && rec.live.mats) for (const m of rec.live.mats) m.dispose();
  } catch (e) {}
}
function _stripCachePut(ck, rec) {
  rec.gen = _bakeGen;
  _stripCache.set(ck, rec);
  if (_stripCache.size <= STRIP_CACHE_MAX) return;
  for (const [k, v] of _stripCache) {
    if (_stripCache.size <= STRIP_CACHE_MAX) break;
    if (!v || v.gen === _bakeGen || (v.live && liveInUse(v.live))) continue;
    _stripCache.delete(k);
    _disposeStripRec(v);
  }
}
function blitInto(strip, px, stripW, tileIdx) {
  const x0 = tileIdx * BAKE_SIZE;
  for (let y = 0; y < BAKE_SIZE; y++) {
    const src = y * BAKE_SIZE * 4;
    const dst = (y * stripW + x0) * 4;
    strip.set(px.subarray(src, src + BAKE_SIZE * 4), dst);
  }
}
export function bakeGameShaderAges(session, proc, srcTex, sliceValues, matAnim) {
  if (!proc || !proc.shader || !sliceValues || sliceValues.length < 2) return null;
  const key = resolveGameKey(proc.shader, proc.keywords);
  if (!key) return null;
  const g = gameShaders[key];
  if (!g || !g.frag || usesRealVertex(g)) return null;
  if (srcTex && !srcTex.__tpBakeId) srcTex.__tpBakeId = ++_bakeSrcId;
  if (matAnim && !matAnim.__tpAnimId) matAnim.__tpAnimId = ++_matAnimId;
  const ck =
    key + '|' + JSON.stringify(proc.vec1 || {}) + '|' + JSON.stringify(proc.colors || {}) + '|' + JSON.stringify(proc.floats || {}) + '|t' + (srcTex ? srcTex.__tpBakeId : 0) + '|A' + JSON.stringify(sliceValues) + '|a' + (matAnim ? matAnim.__tpAnimId : 0);
  if (_stripCache.has(ck)) {
    const hit = _stripCache.get(ck);
    if (hit) hit.gen = _bakeGen;
    if (hit && hit.live) _liveRegister(session, hit.live);
    return hit ? hit.res : null;
  }
  if (!ensureBaker()) return null;
  let res = null,
    live = null;
  try {
    const n = sliceValues.length;
    const stripW = BAKE_SIZE * n;
    const strip = new Uint8Array(stripW * BAKE_SIZE * 4);
    const px = new Uint8Array(BAKE_SIZE * BAKE_SIZE * 4);
    const white = whiteTexture(THREE);
    const parts = [];
    for (let k = 0; k < n; k++) {
      const gu = buildGameUniforms(THREE, g, proc);
      for (const sm of collectSamplers(g.frag)) { const ph = samplerPlaceholder(THREE, sm.kind); const own = sm.kind === 'sampler2D' && !ENGINE_TEXTURE_NAME.test(sm.name) ? srcTex || white : ph; if (!gu.uniforms[sm.name] || gu.uniforms[sm.name].value == null) gu.uniforms[sm.name] = { value: own }; }
      for (const sn of g.samplers || []) if (!gu.uniforms[sn] || gu.uniforms[sn].value == null) gu.uniforms[sn] = { value: ENGINE_TEXTURE_NAME.test(sn) ? white : srcTex || white };
      gu.uniforms.uViewAlign = { value: 0 };
      const mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: gu.uniforms, vertexShader: bakeVertex(g, sliceValues[k]), fragmentShader: g.frag, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
      parts.push({ gu, mat, anim: matAnim ? applyMatAnim(gu.uniforms, matAnim) : null });
    }
    const timed = SHADER_TIME_RE.test(g.frag) || !!matAnim;
    const renderAll = (tSec) => {
      for (let k = 0; k < parts.length; k++) {
        const p = parts[k];
        const u = p.gu.uniforms._TimeParameters;
        if (u && u.value && u.value.set) u.value.set(tSec, Math.sin(tSec), Math.cos(tSec), 0);
        if (p.anim) p.anim(tSec);
        renderBake(p.gu, p.mat, px);
        blitInto(strip, px, stripW, k);
      }
    };
    renderAll(timed && session ? session.time : 0);
    let amax = 0;
    for (let i = 3; i < strip.length; i += 4) if (strip[i] > amax) amax = strip[i];
    if (amax > 4 || timed) {
      const tex = new THREE.DataTexture(strip, stripW, BAKE_SIZE, THREE.RGBAFormat);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      res = { tex, tiles: n };
      if (timed) {
        live = { strip: true, tex, renderAll, mats: parts.map((p) => p.mat) };
        _liveRegister(session, live);
      } else for (const p of parts) p.mat.dispose();
    } else for (const p of parts) p.mat.dispose();
  } catch (e) {
    noteBuildFailure('ageStripBake', e);
    res = null;
    live = null;
  }
  _stripCachePut(ck, { res, live });
  return res;
}
function _liveRegister(session, rec) {
  if (!session || !rec || session.live.indexOf(rec) >= 0) return;
  session.live.push(rec);
}

export function advanceBakes(session, tSec, dt, renderer) {
  if (!session) return;
  session.time = tSec;
  if (!session.live.length) return;
  const useMain = !!(renderer && renderer.setRenderTarget);
  if (!useMain && !ensureBaker()) return;
  ensureBakeScene();
  const prevRT = useMain ? renderer.getRenderTarget() : null;
  for (const lb of session.live) {
    try {
      if (lb.strip) {
        lb.renderAll(tSec);
        lb.tex.needsUpdate = true;
        continue;
      }
      const u = lb.gu.uniforms._TimeParameters;
      if (u && u.value && u.value.set) u.value.set(tSec, Math.sin(tSec), Math.cos(tSec), dt || 0);
      if (lb.anim) lb.anim(tSec);
      if (useMain && lb.rt) {
        lb.gu.wire(renderer, _bakeCam);
        _bakeMesh.material = lb.mat;
        renderer.setRenderTarget(lb.rt);
        renderer.clear(true, true, true);
        renderer.render(_bakeScene, _bakeCam);
        _bakeMesh.material = null;
      } else if (lb.px) {
        renderBake(lb.gu, lb.mat, lb.px);
        lb.tex.needsUpdate = true;
      }
    } catch (e) {
      notePlayFailure('liveBake', e);
    }
  }
  if (useMain) renderer.setRenderTarget(prevRT);
}

let _bakeSrcId = 0;
let _matAnimId = 0;
export function bakeGameShaderTex(session, proc, srcTex, streamValues, matAnim) {
  if (!proc || !proc.shader) return null;
  const key = resolveGameKey(proc.shader, proc.keywords);
  if (!key) return null;
  const g = gameShaders[key];
  if (!g || !g.frag || usesRealVertex(g)) return null;
  if (srcTex && !srcTex.__tpBakeId) srcTex.__tpBakeId = ++_bakeSrcId;
  if (matAnim && !matAnim.__tpAnimId) matAnim.__tpAnimId = ++_matAnimId;
  const ck = key + '|' + JSON.stringify(proc.vec1 || {}) + '|' + JSON.stringify(proc.colors || {}) + '|' + JSON.stringify(proc.floats || {}) + '|t' + (srcTex ? srcTex.__tpBakeId : 0) + '|s' + (streamValues ? JSON.stringify(streamValues) : '') + '|a' + (matAnim ? matAnim.__tpAnimId : 0);
  if (_bakeCache.has(ck)) {
    const hit = _bakeCache.get(ck);
    if (hit && hit.live && !session) return null;
    if (hit) hit.gen = _bakeGen;
    if (hit && hit.live) _liveRegister(session, hit.live);
    return hit ? hit.tex : null;
  }
  if (!ensureBaker()) return null;
  let tex = null,
    live = null;
  try {
    const gu = buildGameUniforms(THREE, g, proc);
    const white = whiteTexture(THREE);
    for (const sm of collectSamplers(g.frag)) { const ph = samplerPlaceholder(THREE, sm.kind); const own = sm.kind === 'sampler2D' && !ENGINE_TEXTURE_NAME.test(sm.name) ? srcTex || white : ph; if (!gu.uniforms[sm.name] || gu.uniforms[sm.name].value == null) gu.uniforms[sm.name] = { value: own }; }
    for (const sn of g.samplers || []) if (!gu.uniforms[sn] || gu.uniforms[sn].value == null) gu.uniforms[sn] = { value: ENGINE_TEXTURE_NAME.test(sn) ? white : srcTex || white };
    gu.uniforms.uViewAlign = { value: 0 };
    const mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: gu.uniforms, vertexShader: bakeVertex(g, streamValues), fragmentShader: g.frag, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    const anim = matAnim ? applyMatAnim(gu.uniforms, matAnim) : null;
    const timed = SHADER_TIME_RE.test(g.frag) || !!anim;
    if (timed && !session) {
      mat.dispose();
      return null;
    }
    const t0 = session ? session.time : 0;
    if (timed && gu.uniforms._TimeParameters) gu.uniforms._TimeParameters.value.set(t0, Math.sin(t0), Math.cos(t0), 0);
    if (anim) anim(0);
    if (timed) {
      const rt = new THREE.WebGLRenderTarget(BAKE_SIZE, BAKE_SIZE, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false });
      tex = rt.texture;
      live = { gu, mat, rt, tex, anim };
      _liveRegister(session, live);
    } else {
      const px = new Uint8Array(BAKE_SIZE * BAKE_SIZE * 4);
      renderBake(gu, mat, px);
      let amax = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] > amax) amax = px[i];
      if (amax > 4) {
        tex = new THREE.DataTexture(px, BAKE_SIZE, BAKE_SIZE, THREE.RGBAFormat);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
      }
      mat.dispose();
    }
  } catch (e) {
    noteBuildFailure('shaderBake', e);
    tex = null;
    live = null;
  }
  _bakeCachePut(ck, { tex, live });
  return tex;
}
