import * as THREE from '../../../vendor/three.module.js';
import * as TQ from './quarks-ext.js';
import { resolveGameKey, gameParticleShaders, buildGameUniforms, whiteTexture, collectSamplers, samplerPlaceholder, ENGINE_TEXTURE_NAME } from '../game-shader-util.js';
import { gameShaders } from '../shaders/game-shaders.js';
import { streamVaryingValues } from './vfx-streams.js';
import { applyMatAnim } from './vfx-matanim.js';
import { materialEmission } from './vfx-material.js';
import { noteBuildFailure } from './vfx-failures.js';

const _animIds = new WeakMap();
let _animSeq = 0;
const animIdOf = (a) => {
  if (!a) return 0;
  if (!_animIds.has(a)) _animIds.set(a, ++_animSeq);
  return _animIds.get(a);
};

const _timeByRenderer = new WeakMap();
export const setShaderTime = (renderer, t) => {
  if (renderer) _timeByRenderer.set(renderer, t);
};
const shaderTimeOf = (renderer) => (renderer && _timeByRenderer.get(renderer)) || 0;

export const LIVE_MODE = {
  [TQ.RenderMode.BillBoard]: 'billboard',
  [TQ.RenderMode.HorizontalBillBoard]: 'horizontal',
  [TQ.RenderMode.VerticalBillBoard]: 'vertical',
  [TQ.RenderMode.Mesh]: 'mesh',
  [TQ.RenderMode.StretchedBillBoard]: 'stretched',
};

export function buildLiveGameShader(entry, sys, mode, tiles, align, cache) {
  if (!mode) return null;
  const proc = entry && entry.proc;
  if (!proc || !proc.shader) return null;
  const key = resolveGameKey(proc.shader, entry && entry.keywords);
  if (!key) return null;
  const g = gameShaders[key];
  if (!g || !g.frag) return null;
  const emissionRGB = materialEmission(entry);
  const values = streamVaryingValues(sys, 0);
  const custom = sys.useCustomVertexStreams && sys.ps && sys.ps.CustomDataModule && sys.ps.CustomDataModule.enabled ? { in_TEXCOORD1: 'tpCustom1' } : null;
  const ck = key + '|' + mode + '|' + (tiles ? 1 : 0) + '|a' + (align | 0) + '|' + JSON.stringify(proc.vec1 || {}) + '|' + JSON.stringify(proc.colors || {}) + '|' + JSON.stringify(proc.floats || {}) + '|t' + (entry.tex ? entry.tex.uuid : '0') + '|s' + JSON.stringify(values || {}) + '|c' + (custom ? 1 : 0) + '|e' + (emissionRGB ? emissionRGB.join(',') : '0') + '|m' + animIdOf(sys.matAnim);
  if (cache.has(ck)) return cache.get(ck);
  let out = null;
  try {
    const src = gameParticleShaders(g, { values, exprs: custom, mode, tiles, align, emission: !!emissionRGB });
    if (src) {
      const gu = buildGameUniforms(THREE, g, proc);
      if (emissionRGB) gu.uniforms.tpEmission = { value: new THREE.Vector3(emissionRGB[0], emissionRGB[1], emissionRGB[2]) };
      const white = whiteTexture(THREE);
      for (const s of collectSamplers(g.frag)) {
        const ph = samplerPlaceholder(THREE, s.kind);
        const own = s.kind === 'sampler2D' && !ENGINE_TEXTURE_NAME.test(s.name) ? entry.tex || white : ph;
        if (!gu.uniforms[s.name] || gu.uniforms[s.name].value == null) gu.uniforms[s.name] = { value: own };
      }
      for (const sn of g.samplers || []) if (!gu.uniforms[sn] || gu.uniforms[sn].value == null) gu.uniforms[sn] = { value: ENGINE_TEXTURE_NAME.test(sn) ? white : entry.tex || white };
      const t0 = gu.uniforms._TimeParameters;
      const anim = sys.matAnim ? applyMatAnim(gu.uniforms, sys.matAnim) : null;
      const wire = (renderer, camera) => {
        const t = shaderTimeOf(renderer);
        if (t0 && t0.value && t0.value.set) t0.value.set(t, Math.sin(t), Math.cos(t), 1 / 60);
        if (anim) anim(t);
        if (gu.wire) gu.wire(renderer, camera);
      };
      out = { shader: { vert: src.vert, frag: src.frag, uniforms: gu.uniforms, wire }, useCustom: !!custom && /\btpCustom1\b/.test(src.vert), setDepth: gu.needsDepth ? gu.setDepth : null };
    }
  } catch (e) {
    noteBuildFailure('liveShader', e);
    out = null;
  }
  cache.set(ck, out);
  return out;
}
