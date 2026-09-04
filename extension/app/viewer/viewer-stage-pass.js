import * as THREE from '../../vendor/three.module.js';
import { model3dLib } from '../../engine/render/model3d-lib.js';
import { updateFieldUniforms, seedFieldShadowSamplers } from '../../engine/render/field-shader.js';
import { LAYER_FIELD_SHADOW } from './viewer-stage-shadow.js';

export const LAYER_FIELD = 1;

export function createFieldPass(renderer, scene, camera, deps) {
  const { catcher, shadows } = deps;
  const postPass = model3dLib.buildPostPass(renderer, null, 0);
  const size = new THREE.Vector2();
  let mats = [];
  let transparent = [];
  let fogUniforms = [];
  let rtUniforms = [];
  let rt = null;

  function dropRT() {
    if (!rt) return;
    rt.depthTexture.dispose();
    rt.dispose();
    rt = null;
  }
  function ensureRT(w, h) {
    if (rt && rt.width === w && rt.height === h) return;
    dropRT();
    rt = new THREE.WebGLRenderTarget(w, h);
    rt.texture.colorSpace = THREE.LinearSRGBColorSpace || 'srgb-linear';
    rt.depthTexture = new THREE.DepthTexture(w, h);
    rt.depthTexture.format = THREE.DepthFormat;
    rt.depthTexture.type = THREE.UnsignedIntType;
  }

  return {
    fog: () => fogUniforms,
    mats: () => mats,
    adopt(group, r) {
      mats = r.fieldMats || [];
      fogUniforms = r.fogUniforms || [];
      rtUniforms = r.rtUniforms || [];
      postPass.setBloomOverride(r.bloom || null);
      transparent = [];
      group.traverse((o) => {
        if (!o.isMesh) return;
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        if (ms.some((m) => m && m.transparent)) transparent.push(o);
        if (!(o.userData && o.userData.fieldShaderPass)) o.layers.enable(LAYER_FIELD);
        if (!(o.userData && o.userData.noShadowCast)) o.layers.enable(LAYER_FIELD_SHADOW);
      });
    },
    seedShadows() {
      seedFieldShadowSamplers(mats, shadows.field);
    },
    clear() {
      mats = [];
      transparent = [];
      fogUniforms = [];
      rtUniforms = [];
      postPass.setBloomOverride(null);
    },
    render(clock) {
      if (!mats.length) return;
      renderer.getDrawingBufferSize(size);
      ensureRT(Math.max(1, size.x), Math.max(1, size.y));
      const hidden = [];
      if (catcher.visible) {
        catcher.visible = false;
        hidden.push(catcher);
      }
      for (const o of transparent) {
        if (!o.visible) continue;
        o.visible = false;
        hidden.push(o);
      }
      for (const u of rtUniforms) u.uTpEncode.value = 0;
      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      for (const o of hidden) o.visible = true;
      for (const u of rtUniforms) u.uTpEncode.value = 1;
      updateFieldUniforms(mats, THREE, { camera, time: clock, width: size.x, height: size.y, opaque: rt.texture, depth: rt.depthTexture, shadow: shadows.field, charShadow: shadows.char });
    },
    present() {
      postPass.render(scene, camera);
    },
    dispose() {
      dropRT();
      postPass.dispose();
    },
  };
}
