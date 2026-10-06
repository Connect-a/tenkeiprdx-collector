import * as THREE from '../../../vendor/three.module.js';
import { gammaToLinear as G2L } from '../color.js';
import { GAME_ASPECT } from '../../../core/game-screen.js';
import { DEFAULT_BLOOM } from './vfx-constants.js';

const FS_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const DOF_ENABLED = true;

const DOF_COC_FRAG =
  'precision highp float; varying vec2 vUv;\n' +
  'uniform sampler2D tDepth; uniform vec4 uZBuf; uniform vec3 uCoC;\n' +
  'void main(){\n' +
  ' float d = texture2D(tDepth, vUv).x;\n' +
  ' float eye = 1.0 / (uZBuf.z * d + uZBuf.w);\n' +
  ' gl_FragColor = vec4(clamp((eye - uCoC.x) / (uCoC.y - uCoC.x), 0.0, 1.0), 0.0, 0.0, 1.0);\n' +
  '}';
const DOF_TAPS = ' vec4 o1 = uTexel.zwzw * vec4(0.9, -0.4, -0.9, 0.4) + vUv.xyxy;\n vec4 o2 = uTexel.zwzw * vec4(0.4, 0.9, -0.4, -0.9) + vUv.xyxy;\n';
const DOF_DOWN_COC_FRAG =
  'precision highp float; varying vec2 vUv;\n' +
  'uniform sampler2D tCoC; uniform vec4 uTexel;\n' +
  'void main(){\n' +
  DOF_TAPS +
  ' float s = texture2D(tCoC, vUv).x + texture2D(tCoC, o1.xy).x + texture2D(tCoC, o1.zw).x + texture2D(tCoC, o2.xy).x + texture2D(tCoC, o2.zw).x;\n' +
  ' gl_FragColor = vec4(s * 0.2, 0.0, 0.0, 1.0);\n' +
  '}';
const DOF_DOWN_COLOR_FRAG =
  'precision highp float; varying vec2 vUv;\n' +
  'uniform sampler2D t; uniform sampler2D tCoC; uniform vec4 uTexel;\n' +
  'void main(){\n' +
  DOF_TAPS +
  ' vec3 c = texture2D(t, vUv).xyz * texture2D(tCoC, vUv).x;\n' +
  ' c += texture2D(t, o1.xy).xyz * texture2D(tCoC, o1.xy).x;\n' +
  ' c += texture2D(t, o1.zw).xyz * texture2D(tCoC, o1.zw).x;\n' +
  ' c += texture2D(t, o2.xy).xyz * texture2D(tCoC, o2.xy).x;\n' +
  ' c += texture2D(t, o2.zw).xyz * texture2D(tCoC, o2.zw).x;\n' +
  ' gl_FragColor = vec4(c * 0.2, 1.0);\n' +
  '}';
const DOF_BLUR_FRAG =
  'precision highp float; varying vec2 vUv;\n' +
  'uniform sampler2D t; uniform sampler2D tHalfCoC; uniform vec2 uDir; uniform float uMaxRadius;\n' +
  'void main(){\n' +
  ' float cocC = texture2D(tHalfCoC, vUv).x;\n' +
  ' vec2 d = uDir * (cocC * uMaxRadius);\n' +
  ' vec4 acc = vec4(0.0);\n' +
  ' vec2 uvL = vUv - d * 1.33333337;\n vec2 uvR = vUv + d * 1.33333337;\n' +
  ' float cL = texture2D(tHalfCoC, uvL).x; float wL = clamp(1.0 - (cocC - cL), 0.0, 1.0);\n' +
  ' acc += vec4(texture2D(t, uvL).xyz, 1.0) * wL * 0.352941185;\n' +
  ' float cM = texture2D(tHalfCoC, vUv).x; float wM = clamp(1.0 - (cocC - cM), 0.0, 1.0);\n' +
  ' acc += vec4(texture2D(t, vUv).xyz, 1.0) * wM * 0.294117659;\n' +
  ' float cR = texture2D(tHalfCoC, uvR).x; float wR = clamp(1.0 - (cocC - cR), 0.0, 1.0);\n' +
  ' acc += vec4(texture2D(t, uvR).xyz, 1.0) * wR * 0.352941185;\n' +
  ' gl_FragColor = vec4(acc.xyz / (acc.w + 9.99999975e-05), 1.0);\n' +
  '}';
const DOF_COMPOSITE_FRAG =
  'precision highp float; varying vec2 vUv;\n' +
  'uniform sampler2D t; uniform sampler2D tBlur; uniform sampler2D tCoC;\n' +
  'void main(){\n' +
  ' vec3 sharp = texture2D(t, vUv).xyz;\n' +
  ' float coc = texture2D(tCoC, vUv).x;\n' +
  ' vec3 far = vec3(0.0); float base = 1.0;\n' +
  ' if (coc > 0.0) {\n' +
  '  float k = min(sqrt(coc * 6.28318548), 1.0);\n' +
  '  far = texture2D(tBlur, vUv).xyz * k;\n' +
  '  base = max(1.0 - k, 0.0);\n' +
  ' }\n' +
  ' gl_FragColor = vec4(sharp * base + far, 1.0);\n' +
  '}';
const THRESH_FRAG =
  'uniform sampler2D t; uniform float threshold; varying vec2 vUv;\n' +
  'void main(){ vec4 c = vec4(texture2D(t,vUv).rgb, 1.0);\n' +
  ' float br = max(c.r, max(c.g, c.b));\n' +
  ' float knee = threshold * 0.5;\n' +
  ' float soft = clamp(br - threshold + knee, 0.0, 2.0*knee);\n' +
  ' soft = soft*soft / (4.0*knee + 1e-4);\n' +
  ' float w = max(soft, br - threshold) / max(br, 1e-4);\n' +
  ' gl_FragColor = vec4(c.rgb * w, 1.0); }';
const BLUR_FRAG =
  'uniform sampler2D t; uniform vec2 dir; varying vec2 vUv;\n' +
  'void main(){ vec4 c = texture2D(t,vUv)*0.227027;' +
  ' c += texture2D(t,vUv+dir*1.3846)*0.316216; c += texture2D(t,vUv-dir*1.3846)*0.316216;' +
  ' c += texture2D(t,vUv+dir*3.2308)*0.070270; c += texture2D(t,vUv-dir*3.2308)*0.070270;' +
  ' gl_FragColor = c; }';
const L2S_FN =
  'vec3 tpL2S(vec3 c){ return clamp(1.055*pow(max(c,vec3(0.0)),vec3(0.4166667))-0.055, 0.0, 1.0); }\n' +
  'vec3 tpFastS2L(vec3 c){ return c*(c*(c*0.305306017+0.682171106)+0.0125228781); }\n';
const GLOBAL_GRADE = { vignetteColor: [0.783019, 0.783019, 0.783019], vignetteIntensity: 0.3, vignetteSmoothness: 0.2, vignetteRounded: false, contrast: -4 };
const COMBINE_FRAG =
  L2S_FN +
  'vec3 tpLin2LogC(vec3 x){ return log2(max(x*5.55555582+0.0479959995, vec3(0.0)))*0.0734997839 - 0.0275523961; }\n' +
  'vec3 tpLogC2Lin(vec3 x){ return (exp2(x*13.6054821)-0.0479959995)*0.179999992; }\n' +
  'uniform sampler2D t; uniform sampler2D tb; uniform float intensity; varying vec2 vUv;\n' +
  'uniform vec3 uVigColor; uniform vec2 uVigParams; uniform float uVigRoundness, uContrast, uChroma;\n' +
  'void main(){ vec4 c = texture2D(t,vUv); vec4 b = texture2D(tb,vUv);\n' +
  ' if (uChroma > 0.0) {\n' +
  '   vec2 cc = vUv * 2.0 - 1.0;\n' +
  '   vec2 dl = -cc * dot(cc,cc) * uChroma * 0.333333343;\n' +
  '   c.g = texture2D(t, vUv + dl).g;\n' +
  '   c.b = texture2D(t, vUv + dl * 2.0).b;\n' +
  ' }\n' +
  ' vec3 rgb = tpFastS2L(c.rgb) + b.rgb * b.rgb * intensity;\n' +
  ' float a = min(1.0, c.a + b.a * intensity);\n' +
  ' vec2 d = abs(vUv - vec2(0.5)) * uVigParams.x;\n' +
  ' d.x *= uVigRoundness;\n' +
  ' float vf = pow(max(1.0 - dot(d,d), 0.0), uVigParams.y);\n' +
  ' rgb *= mix(uVigColor, vec3(1.0), vf);\n' +
  ' rgb = max(tpLogC2Lin(tpLin2LogC(rgb) * uContrast + 0.0275523961), vec3(0.0));\n' +
  ' gl_FragColor = vec4(tpL2S(rgb), a); }';

export { DOF_ENABLED };

export function createPostChain(renderer) {
  let bloom = null;
  const ensureBloom = (w, h, needDepth) => {
    const opt = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, depthBuffer: false };
    const fw = Math.max(2, w | 0),
      fh = Math.max(2, h | 0),
      hw = Math.max(1, fw >> 1),
      hh = Math.max(1, fh >> 1);
    if (bloom && bloom.fw === fw && bloom.fh === fh && bloom.hasDepth === !!needDepth) return bloom;
    if (bloom) {
      try {
        bloom.rtScene.dispose();
        bloom.rtA.dispose();
        bloom.rtB.dispose();
        if (bloom.rtCoC) bloom.rtCoC.dispose();
        if (bloom.rtHalfCoC) bloom.rtHalfCoC.dispose();
        if (bloom.rtDof) bloom.rtDof.dispose();
      } catch (e) {}
    }
    const rtScene = new THREE.WebGLRenderTarget(fw, fh, { ...opt, type: THREE.HalfFloatType, depthBuffer: true });
    if (DOF_ENABLED && needDepth) {
      rtScene.depthTexture = new THREE.DepthTexture(fw, fh, THREE.UnsignedInt248Type);
      rtScene.depthTexture.format = THREE.DepthStencilFormat;
    }
    const rtCoC = new THREE.WebGLRenderTarget(fw, fh, { ...opt, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const rtHalfCoC = new THREE.WebGLRenderTarget(hw, hh, opt);
    const rtDof = new THREE.WebGLRenderTarget(fw, fh, { ...opt, type: THREE.HalfFloatType });
    const rtA = new THREE.WebGLRenderTarget(hw, hh, opt),
      rtB = new THREE.WebGLRenderTarget(hw, hh, opt);
    if (!bloom) {
      const fsScene = new THREE.Scene(),
        fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const threshMat = new THREE.ShaderMaterial({
        uniforms: { t: { value: null }, threshold: { value: DEFAULT_BLOOM.threshold } },
        vertexShader: FS_VERT,
        fragmentShader: THRESH_FRAG,
        depthTest: false,
        depthWrite: false,
      });
      const blurMat = new THREE.ShaderMaterial({
        uniforms: { t: { value: null }, dir: { value: new THREE.Vector2() } },
        vertexShader: FS_VERT,
        fragmentShader: BLUR_FRAG,
        depthTest: false,
        depthWrite: false,
      });
      const G = GLOBAL_GRADE;
      const combineMat = new THREE.ShaderMaterial({
        uniforms: {
          t: { value: null },
          tb: { value: null },
          intensity: { value: 1.0 },
          uVigColor: { value: new THREE.Vector3(G.vignetteColor[0], G.vignetteColor[1], G.vignetteColor[2]) },
          uVigParams: { value: new THREE.Vector2(G.vignetteIntensity * 3, G.vignetteSmoothness * 5) },
          uVigRoundness: { value: G.vignetteRounded ? GAME_ASPECT : 1 },
          uContrast: { value: G.contrast / 100 + 1 },
          uChroma: { value: 0 },
        },
        vertexShader: FS_VERT,
        fragmentShader: COMBINE_FRAG,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        blending: THREE.NoBlending,
      });
      const fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), combineMat);
      fsScene.add(fsQuad);
      const mk = (frag, uniforms) => new THREE.ShaderMaterial({ uniforms, vertexShader: FS_VERT, fragmentShader: frag, depthTest: false, depthWrite: false, blending: THREE.NoBlending });
      const dofCoCMat = mk(DOF_COC_FRAG, { tDepth: { value: null }, uZBuf: { value: new THREE.Vector4() }, uCoC: { value: new THREE.Vector3(1, 200, 1) } });
      const dofDownCoCMat = mk(DOF_DOWN_COC_FRAG, { tCoC: { value: null }, uTexel: { value: new THREE.Vector4() } });
      const dofDownColMat = mk(DOF_DOWN_COLOR_FRAG, { t: { value: null }, tCoC: { value: null }, uTexel: { value: new THREE.Vector4() } });
      const dofBlurMat = mk(DOF_BLUR_FRAG, { t: { value: null }, tHalfCoC: { value: null }, uDir: { value: new THREE.Vector2() }, uMaxRadius: { value: 1 } });
      const dofCompMat = mk(DOF_COMPOSITE_FRAG, { t: { value: null }, tBlur: { value: null }, tCoC: { value: null } });
      bloom = { fsScene, fsCam, fsQuad, threshMat, blurMat, combineMat, dofCoCMat, dofDownCoCMat, dofDownColMat, dofBlurMat, dofCompMat };
    }
    bloom.rtScene = rtScene;
    bloom.rtA = rtA;
    bloom.rtB = rtB;
    bloom.rtCoC = rtCoC;
    bloom.rtHalfCoC = rtHalfCoC;
    bloom.rtDof = rtDof;
    bloom.hasDepth = !!needDepth;
    bloom.fw = fw;
    bloom.fh = fh;
    bloom.hw = hw;
    bloom.hh = hh;
    return bloom;
  };
  let depthRT = null;
  const ensureDepthRT = (fw, fh) => {
    if (depthRT && depthRT.width === fw && depthRT.height === fh) return depthRT;
    if (depthRT) {
      if (depthRT.depthTexture) depthRT.depthTexture.dispose();
      depthRT.dispose();
    }
    depthRT = new THREE.WebGLRenderTarget(fw, fh, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat, depthBuffer: true });
    depthRT.depthTexture = new THREE.DepthTexture(fw, fh, THREE.UnsignedIntType != null ? THREE.UnsignedIntType : THREE.UnsignedShortType);
    return depthRT;
  };
  const render = (scene, camera, w, h, p) => {
    const pr = renderer.getPixelRatio();
    const b = ensureBloom(w * pr, h * pr, !!p.dof);
    const drawFs = (mat) => {
      b.fsQuad.material = mat;
      renderer.render(b.fsScene, b.fsCam);
    };
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    if (p.onDepth) {
      const d = ensureDepthRT(Math.max(2, b.fw >> 1), Math.max(2, b.fh >> 1));
      p.onDepth(null);
      const keepAuto = renderer.autoClear;
      renderer.autoClear = true;
      renderer.setRenderTarget(d);
      renderer.setClearColor(0x000000, 1);
      renderer.clear(true, true, false);
      renderer.render(scene, camera);
      renderer.autoClear = keepAuto;
      p.onDepth(d.depthTexture);
    }
    if (p.bg != null) renderer.setClearColor(p.bg, 1);
    else renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(b.rtScene);
    renderer.clear();
    renderer.render(scene, camera);
    let srcTex = b.rtScene.texture;
    if (p.dof) {
      const near = camera.near || 0.1,
        far = camera.far || 1000,
        fn = far / near;
      b.dofCoCMat.uniforms.tDepth.value = b.rtScene.depthTexture;
      b.dofCoCMat.uniforms.uZBuf.value.set(1 - fn, fn, (1 - fn) / far, fn / far);
      b.dofCoCMat.uniforms.uCoC.value.set(p.dof.start, p.dof.end, p.dof.maxRadius);
      renderer.setRenderTarget(b.rtCoC);
      renderer.clear();
      drawFs(b.dofCoCMat);
      const texel = [b.fw, b.fh, 1 / b.fw, 1 / b.fh];
      b.dofDownCoCMat.uniforms.tCoC.value = b.rtCoC.texture;
      b.dofDownCoCMat.uniforms.uTexel.value.set(texel[0], texel[1], texel[2], texel[3]);
      renderer.setRenderTarget(b.rtHalfCoC);
      renderer.clear();
      drawFs(b.dofDownCoCMat);
      b.dofDownColMat.uniforms.t.value = b.rtScene.texture;
      b.dofDownColMat.uniforms.tCoC.value = b.rtCoC.texture;
      b.dofDownColMat.uniforms.uTexel.value.set(texel[0], texel[1], texel[2], texel[3]);
      renderer.setRenderTarget(b.rtA);
      renderer.clear();
      drawFs(b.dofDownColMat);
      b.dofBlurMat.uniforms.tHalfCoC.value = b.rtHalfCoC.texture;
      b.dofBlurMat.uniforms.uMaxRadius.value = p.dof.maxRadius;
      b.dofBlurMat.uniforms.t.value = b.rtA.texture;
      b.dofBlurMat.uniforms.uDir.value.set(1 / b.hw, 0);
      renderer.setRenderTarget(b.rtB);
      renderer.clear();
      drawFs(b.dofBlurMat);
      b.dofBlurMat.uniforms.t.value = b.rtB.texture;
      b.dofBlurMat.uniforms.uDir.value.set(0, 1 / b.hh);
      renderer.setRenderTarget(b.rtA);
      renderer.clear();
      drawFs(b.dofBlurMat);
      b.dofCompMat.uniforms.t.value = b.rtScene.texture;
      b.dofCompMat.uniforms.tBlur.value = b.rtA.texture;
      b.dofCompMat.uniforms.tCoC.value = b.rtCoC.texture;
      renderer.setRenderTarget(b.rtDof);
      renderer.clear();
      drawFs(b.dofCompMat);
      srcTex = b.rtDof.texture;
    }
    b.threshMat.uniforms.threshold.value = G2L(p.threshold);
    b.combineMat.uniforms.intensity.value = p.intensity;
    b.combineMat.uniforms.uChroma.value = p.chroma;
    b.threshMat.uniforms.t.value = srcTex;
    renderer.setRenderTarget(b.rtA);
    renderer.clear();
    drawFs(b.threshMat);
    b.blurMat.uniforms.t.value = b.rtA.texture;
    b.blurMat.uniforms.dir.value.set(2.5 / b.hw, 0);
    renderer.setRenderTarget(b.rtB);
    renderer.clear();
    drawFs(b.blurMat);
    b.blurMat.uniforms.t.value = b.rtB.texture;
    b.blurMat.uniforms.dir.value.set(0, 2.5 / b.hh);
    renderer.setRenderTarget(b.rtA);
    renderer.clear();
    drawFs(b.blurMat);
    renderer.setRenderTarget(null);
    if (p.bg != null) {
      renderer.setClearColor(p.bg, 1);
      renderer.clear();
    } else renderer.clear();
    b.combineMat.uniforms.t.value = srcTex;
    b.combineMat.uniforms.tb.value = b.rtA.texture;
    drawFs(b.combineMat);
    renderer.autoClear = prevAuto;
  };
  const dispose = () => {
    if (depthRT) {
      try {
        if (depthRT.depthTexture) depthRT.depthTexture.dispose();
        depthRT.dispose();
      } catch (e) {}
      depthRT = null;
    }
    if (!bloom) return;
    try {
      for (const k of ['rtScene', 'rtA', 'rtB', 'rtCoC', 'rtHalfCoC', 'rtDof']) if (bloom[k]) bloom[k].dispose();
      for (const k of ['threshMat', 'blurMat', 'combineMat', 'dofCoCMat', 'dofDownCoCMat', 'dofDownColMat', 'dofBlurMat', 'dofCompMat']) if (bloom[k]) bloom[k].dispose();
      if (bloom.fsQuad) bloom.fsQuad.geometry.dispose();
    } catch (e) {}
    bloom = null;
  };
  return { render, dispose };
}
