import * as THREE_NS from '../../vendor/three.module.js';

let _sharedBgTex = null;
function sharedBgTexture(T) {
  if (_sharedBgTex) return _sharedBgTex;
  const t = new T.DataTexture(new Uint8Array([231, 221, 202, 255]), 1, 1, T.RGBAFormat);
  t.needsUpdate = true;
  t.colorSpace = T.SRGBColorSpace || 'srgb';
  t.minFilter = T.LinearFilter;
  t.magFilter = T.LinearFilter;
  t.generateMipmaps = false;
  _sharedBgTex = t;
  return _sharedBgTex;
}
function setSharedBgFromRgba(rgba, width, height) {
  if (!_sharedBgTex || !rgba || !width || !height) return;
  _sharedBgTex.dispose();
  _sharedBgTex.image = { data: rgba, width, height };
  _sharedBgTex.flipY = true;
  _sharedBgTex.needsUpdate = true;
}

const drawsNothing = (m) => !m.mainTexPathID && (m.graphColors || []).length > 0 && m.graphColors.every((c) => c[0] === 0 && c[1] === 0 && c[2] === 0);

function buildTextureMap(materialBundle) {
  const byName = new Map();
  const shadowByName = new Map();
  const maskByName = new Map();
  const toonByName = new Map();
  const hiddenByName = new Set();
  const texByPath = new Map((materialBundle.textures || []).map((t) => [t.pathID, t]));
  for (const m of materialBundle.materials || []) {
    const t = texByPath.get(m.mainTexPathID);
    if (t && t.rgba) byName.set(m.name, t);
    if (drawsNothing(m)) hiddenByName.add(m.name);
    const tn = m.toon || {};
    const st = tn.shadowTexPathID && texByPath.get(tn.shadowTexPathID);
    if (st && st.rgba) shadowByName.set(m.name, st);
    const mk = tn.maskTexPathID && texByPath.get(tn.maskTexPathID);
    if (mk && mk.rgba) maskByName.set(m.name, mk);
    if (m.toon) toonByName.set(m.name, m.toon);
  }
  const withRgba = (materialBundle.textures || []).filter((t) => t.rgba);
  const pick = (pred) => withRgba.find((t) => pred(String(t.name || '')));
  let biggest = null;
  for (const t of withRgba) if (!biggest || t.rgba.length > biggest.rgba.length) biggest = t;
  const fallback = pick((n) => /head.*color|face.*color/i.test(n)) || pick((n) => /_color/i.test(n) && !/body/i.test(n)) || pick((n) => /_color/i.test(n)) || biggest;
  return { byName, shadowByName, maskByName, toonByName, hiddenByName, fallback };
}

const MOUTH_CELL = 0.2;
const MOUTH_BASE_ROW = 4;
const MOUTH_EXPRESSIONS = [
  ['ムッ', 0, 1],
  ['あっ', 3, 4],
  ['真顔', 1, 0],
  ['にっこり', 0, 3],
  ['ニヤッ', 1, 1],
  ['大きく開', 0, 2],
  ['歯見せ', 2, 2],
  ['うにっ', 3, 3],
  ['おちょぼ', 4, 4],
  ['むー', 0, 0],
];
function remapMouthUV(baseUv, vMin, vMax, col, row) {
  const out = new Float32Array(baseUv.length);
  const du = col * MOUTH_CELL;
  const dv = (MOUTH_BASE_ROW - row) * MOUTH_CELL;
  for (let i = 0; i < baseUv.length; i += 2) {
    out[i] = baseUv[i] + du;
    out[i + 1] = baseUv[i + 1] - dv;
  }
  return out;
}

// 実ゲームはガンマ色空間。生値で受けて最後に tpToLinear で戻す（設計資料_viewer.md）。
const TP_TO_LINEAR = 'vec3 tpToLinear(vec3 c){vec3 hi=pow((max(c,vec3(0.0))+0.055)/1.055,vec3(2.4));vec3 lo=c/12.92;return mix(hi,lo,step(c,vec3(0.04045)));}\n';

function makeDataTexture(tex, { forceOpaque } = {}) {
  let rgba = tex.rgba;
  if (forceOpaque) {
    rgba = rgba.slice();
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  }
  const dt = new THREE_NS.DataTexture(rgba, tex.width, tex.height, THREE_NS.RGBAFormat);
  dt.flipY = false;
  dt.needsUpdate = true;
  dt.wrapS = THREE_NS.RepeatWrapping;
  dt.wrapT = THREE_NS.RepeatWrapping;
  dt.magFilter = THREE_NS.LinearFilter;
  dt.minFilter = THREE_NS.LinearMipmapLinearFilter;
  dt.generateMipmaps = true;
  dt.colorSpace = THREE_NS.LinearSRGBColorSpace || THREE_NS.NoColorSpace || 'srgb-linear';
  return dt;
}

const GAME_GRADE = {
  contrast: -4,
  vignetteColor: [0.783019, 0.783019, 0.783019],
  vignetteIntensity: 0.3,
  vignetteSmoothness: 0.2,
  vignetteRounded: false,
  // Bloom実測(prod5 WebGL.data 全VolumeProfile抽出): 焼込Bloomは2個とも active=0(既定オフ)・Tonemappingインスタンス0個。
  // ＝bloomは PPController.ShowBloom/AnimationBloom でバトルのスキル発動時に一時ONにする実行時エフェクト。
  // ON時のパラメータ(ground-truth)= threshold0.9 / intensity1.0 / scatter0.7 / tint白 / half解像度 / トーンマップ無し。
  // コレクターのモデルビューアは静的表示(=ゲームでは bloom オフの文脈)なので既定オフ。オーラ確認用に toggle で ON にできる。
  bloomThreshold: 0.9,
  bloomIntensity: 1.0,
  bloomScatter: 0.7,
  bloomDefaultOn: false,
};

function buildPostPass(renderer, bgTexture, bgAspect) {
  const G = GAME_GRADE;
  const size = renderer.getDrawingBufferSize(new THREE_NS.Vector2());
  const rtType = THREE_NS.HalfFloatType != null ? THREE_NS.HalfFloatType : THREE_NS.UnsignedByteType;
  const rt = new THREE_NS.WebGLRenderTarget(size.x, size.y, {
    minFilter: THREE_NS.LinearFilter,
    magFilter: THREE_NS.LinearFilter,
    format: THREE_NS.RGBAFormat,
    type: rtType,
    samples: 4,
  });
  if ('colorSpace' in rt.texture) rt.texture.colorSpace = THREE_NS.LinearSRGBColorSpace || 'srgb-linear';
  // soft-particle(靄/メテオ)用のシーン深度プリパス。不透明(キャラ)のみを描いて深度テクスチャに焼き、
  // オーラの _CameraDepthTexture に供給する(実ゲーム同様に地面/キャラ際でフェード)。
  const depthRT = new THREE_NS.WebGLRenderTarget(size.x, size.y, { minFilter: THREE_NS.NearestFilter, magFilter: THREE_NS.NearestFilter, format: THREE_NS.RGBAFormat, type: THREE_NS.UnsignedByteType });
  depthRT.depthTexture = new THREE_NS.DepthTexture(size.x, size.y);
  depthRT.depthTexture.type = THREE_NS.UnsignedIntType != null ? THREE_NS.UnsignedIntType : THREE_NS.UnsignedShortType;
  // 床面(不可視・深度のみ)。ゲームのステージ床の代わりに置き、床から立ち上る soft-particle オーラ
  // (enemy_fire 等)が実ゲーム同様に床際でフェードしてプルーム形になるようにする(床Yは足元bbox=実値)。
  const floorScene = new THREE_NS.Scene();
  const floorMat = new THREE_NS.MeshBasicMaterial({ colorWrite: false, depthWrite: true });
  const floorMesh = new THREE_NS.Mesh(new THREE_NS.PlaneGeometry(1000, 1000), floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.frustumCulled = false;
  floorScene.add(floorMesh);
  let floorEnabled = false;
  const quadCam = new THREE_NS.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadScene = new THREE_NS.Scene();
  // scatter=拡散量(実ゲーム抽出0.7)。
  const bloomScatter = G.bloomScatter != null ? G.bloomScatter : 0.7;
  const BLOOM_MIPS = 6;
  const bloomOpt = { minFilter: THREE_NS.LinearFilter, magFilter: THREE_NS.LinearFilter, format: THREE_NS.RGBAFormat, type: rtType, depthBuffer: false };
  let downMips = [], upMips = [];
  const allocMips = (w, h) => {
    for (const m of downMips) m.dispose();
    for (const m of upMips) m.dispose();
    downMips = []; upMips = [];
    let mw = Math.max(1, w >> 1), mh = Math.max(1, h >> 1);
    for (let i = 0; i < BLOOM_MIPS && mw > 2 && mh > 2; i++) {
      downMips.push(new THREE_NS.WebGLRenderTarget(mw, mh, bloomOpt));
      upMips.push(new THREE_NS.WebGLRenderTarget(mw, mh, bloomOpt));
      mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1);
    }
  };
  allocMips(size.x, size.y);
  const FS_V = 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }';
  const fxScene = new THREE_NS.Scene();
  const fxQuad = new THREE_NS.Mesh(new THREE_NS.PlaneGeometry(2, 2), null);
  fxQuad.frustumCulled = false;
  fxScene.add(fxQuad);
  const prefiltMat = new THREE_NS.ShaderMaterial({
    uniforms: { t: { value: null }, threshold: { value: G.bloomThreshold != null ? G.bloomThreshold : 0.9 } },
    depthTest: false, depthWrite: false, vertexShader: FS_V,
    fragmentShader: 'precision highp float; varying vec2 vUv; uniform sampler2D t; uniform float threshold; void main(){ vec3 c=texture2D(t,vUv).rgb; float br=max(c.r,max(c.g,c.b)); float k=threshold*0.5; float soft=clamp(br-threshold+k,0.0,2.0*k); soft=soft*soft/(4.0*k+1e-4); float w=max(soft,br-threshold)/max(br,1e-4); gl_FragColor=vec4(c*w,1.0); }',
  });
  const downMat = new THREE_NS.ShaderMaterial({
    uniforms: { t: { value: null }, texel: { value: new THREE_NS.Vector2() } },
    depthTest: false, depthWrite: false, vertexShader: FS_V,
    fragmentShader: 'precision highp float; varying vec2 vUv; uniform sampler2D t; uniform vec2 texel;\n' +
      'void main(){ vec2 e=texel;\n' +
      ' vec3 a=texture2D(t,vUv+e*vec2(-2.,2.)).rgb, b=texture2D(t,vUv+e*vec2(0.,2.)).rgb, c=texture2D(t,vUv+e*vec2(2.,2.)).rgb;\n' +
      ' vec3 d=texture2D(t,vUv+e*vec2(-2.,0.)).rgb, ee=texture2D(t,vUv).rgb, f=texture2D(t,vUv+e*vec2(2.,0.)).rgb;\n' +
      ' vec3 g=texture2D(t,vUv+e*vec2(-2.,-2.)).rgb, h=texture2D(t,vUv+e*vec2(0.,-2.)).rgb, i=texture2D(t,vUv+e*vec2(2.,-2.)).rgb;\n' +
      ' vec3 j=texture2D(t,vUv+e*vec2(-1.,1.)).rgb, k=texture2D(t,vUv+e*vec2(1.,1.)).rgb, l=texture2D(t,vUv+e*vec2(-1.,-1.)).rgb, m=texture2D(t,vUv+e*vec2(1.,-1.)).rgb;\n' +
      ' vec3 col=ee*0.125; col+=(a+c+g+i)*0.03125; col+=(b+d+f+h)*0.0625; col+=(j+k+l+m)*0.125;\n' +
      ' gl_FragColor=vec4(col,1.0); }',
  });
  const upMat = new THREE_NS.ShaderMaterial({
    uniforms: { uHigh: { value: null }, uLow: { value: null }, texel: { value: new THREE_NS.Vector2() }, scatter: { value: bloomScatter } },
    depthTest: false, depthWrite: false, vertexShader: FS_V,
    fragmentShader: 'precision highp float; varying vec2 vUv; uniform sampler2D uHigh,uLow; uniform vec2 texel; uniform float scatter;\n' +
      'void main(){ vec2 e=texel;\n' +
      ' vec3 lo=texture2D(uLow,vUv).rgb*4.0;\n' +
      ' lo+=(texture2D(uLow,vUv+vec2(-e.x,0.)).rgb+texture2D(uLow,vUv+vec2(e.x,0.)).rgb+texture2D(uLow,vUv+vec2(0.,-e.y)).rgb+texture2D(uLow,vUv+vec2(0.,e.y)).rgb)*2.0;\n' +
      ' lo+=texture2D(uLow,vUv+vec2(-e.x,-e.y)).rgb+texture2D(uLow,vUv+vec2(e.x,-e.y)).rgb+texture2D(uLow,vUv+vec2(-e.x,e.y)).rgb+texture2D(uLow,vUv+vec2(e.x,e.y)).rgb;\n' +
      ' lo/=16.0;\n' +
      ' vec3 hi=texture2D(uHigh,vUv).rgb;\n' +
      ' gl_FragColor=vec4(mix(hi,lo,scatter),1.0); }',
  });
  const copyMat = new THREE_NS.ShaderMaterial({
    uniforms: { t: { value: null } }, depthTest: false, depthWrite: false, vertexShader: FS_V,
    fragmentShader: 'precision highp float; varying vec2 vUv; uniform sampler2D t; void main(){ gl_FragColor=vec4(texture2D(t,vUv).rgb,1.0); }',
  });
  let bgScene = null,
    bgUniforms = null;
  if (bgTexture) {
    bgUniforms = { uBg: { value: bgTexture }, uRepeat: { value: new THREE_NS.Vector2(1, 1) }, uOffset: { value: new THREE_NS.Vector2(0, 0) } };
    const bgMat = new THREE_NS.ShaderMaterial({
      uniforms: bgUniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
      fragmentShader: [
        'precision highp float; varying vec2 vUv; uniform sampler2D uBg; uniform vec2 uRepeat,uOffset;',
        // uBg は colorSpace=SRGB なので GPU が sRGB→linear デコード済み。手動 pow(2.2) は二重デコード(暗くなる)なので付けない。
        'void main(){ vec3 c=texture2D(uBg, vUv*uRepeat+uOffset).rgb; gl_FragColor=vec4(c, 1.0); }',
      ].join('\n'),
    });
    bgScene = new THREE_NS.Scene();
    const bgq = new THREE_NS.Mesh(new THREE_NS.PlaneGeometry(2, 2), bgMat);
    bgq.frustumCulled = false;
    bgScene.add(bgq);
  }
  const uniforms = {
    tDiffuse: { value: rt.texture },
    uVigColor: { value: new THREE_NS.Vector3(G.vignetteColor[0], G.vignetteColor[1], G.vignetteColor[2]) },
    uVigParams: { value: new THREE_NS.Vector2(G.vignetteIntensity * 3, G.vignetteSmoothness * 5) },
    uVigRoundness: { value: G.vignetteRounded ? bgAspect || 1 : 1 },
    uContrast: { value: G.contrast / 100 + 1 },
    uScreenScale: { value: new THREE_NS.Vector2(1, 1) },
    uBloom: { value: upMips[0] ? upMips[0].texture : null },
    uBloomIntensity: { value: G.bloomDefaultOn ? (G.bloomIntensity != null ? G.bloomIntensity : 1.0) : 0 },
  };
  const mat = new THREE_NS.ShaderMaterial({
    uniforms,
    blending: THREE_NS.NoBlending,
    depthTest: false,
    depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
    fragmentShader: [
      'precision highp float; varying vec2 vUv; uniform sampler2D tDiffuse, uBloom;',
      'uniform vec3 uVigColor; uniform vec2 uVigParams, uScreenScale; uniform float uVigRoundness, uContrast, uBloomIntensity;',
      'vec3 l2s(vec3 c){ c=clamp(c,0.0,1.0); return mix(1.055*pow(c,vec3(1.0/2.4))-0.055, c*12.92, step(c,vec3(0.0031308))); }',
      'vec3 lin2logc(vec3 x){ return 0.244161*(log2(5.555556*max(x,0.0)+0.047996)/log2(10.0))+0.386036; }',
      'vec3 logc2lin(vec3 x){ return (pow(vec3(10.0),(x-0.386036)/0.244161)-0.047996)/5.555556; }',
      'void main(){',
      '  vec4 src=texture2D(tDiffuse,vUv);',
      // bloom OFF(intensity=0)時は bloom を一切足さない。mipチェーンが HalfFloat で Inf/NaN 化していると
      // NaN*0=NaN となり画面全体が黒く点滅するため、乗算せず分岐で切る。ON時も clamp で Inf を抑える。
      '  vec3 bc = uBloomIntensity > 0.0 ? clamp(texture2D(uBloom,vUv).rgb, 0.0, 64.0) : vec3(0.0);',
      '  vec3 c=src.rgb + bc * uBloomIntensity;',
      '  vec2 guv = vec2(0.5) + (vUv - vec2(0.5)) * uScreenScale;',
      '  vec2 d = abs(guv - vec2(0.5)) * uVigParams.x;',
      '  d.x *= uVigRoundness;',
      '  float vf = pow(max(1.0 - dot(d,d), 0.0), uVigParams.y);',
      '  c *= mix(uVigColor, vec3(1.0), vf);',
      '  vec3 lg = lin2logc(c);',
      '  lg = (lg - 0.4135884) * uContrast + 0.4135884;',
      '  c = max(logc2lin(lg), vec3(0.0));',
      '  gl_FragColor=vec4(l2s(c), src.a);',
      '}',
    ].join('\n'),
  });
  const quad = new THREE_NS.Mesh(new THREE_NS.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  quadScene.add(quad);
  let curW = size.x,
    curH = size.y;
  const updateCover = (w, h) => {
    if (!bgAspect) return;
    const pa = w / h;
    const wide = pa > bgAspect;
    const r = wide ? bgAspect / pa : pa / bgAspect;
    uniforms.uScreenScale.value.set(wide ? 1 : r, wide ? r : 1);
    if (!bgUniforms) return;
    bgUniforms.uRepeat.value.set(wide ? 1 : r, wide ? r : 1);
    bgUniforms.uOffset.value.set(wide ? 0 : (1 - r) / 2, wide ? (1 - r) / 2 : 0);
  };
  updateCover(size.x, size.y);
  const bloomOnValue = G.bloomIntensity != null ? G.bloomIntensity : 1.0;
  return {
    uniforms,
    bloomDefaultOn: !!G.bloomDefaultOn,
    setBloom(on) { uniforms.uBloomIntensity.value = on ? bloomOnValue : 0; },
    // 床から立ち上る soft-particle オーラ用に、深度プリパスへ足元床面を有効化(y=足元)。
    setFloorY(y) { if (y == null || !isFinite(y)) { floorEnabled = false; return; } floorMesh.position.y = y; floorEnabled = true; },
    render(scene, camera, depthExclude, onDepth) {
      const s = renderer.getDrawingBufferSize(new THREE_NS.Vector2());
      if (s.x !== curW || s.y !== curH) {
        curW = s.x;
        curH = s.y;
        rt.setSize(s.x, s.y);
        depthRT.setSize(s.x, s.y);
        allocMips(s.x, s.y);
        uniforms.uBloom.value = upMips[0] ? upMips[0].texture : null;
        updateCover(s.x, s.y);
      }
      // 深度プリパス: オーラを隠して不透明シーンの深度のみ焼く → soft-particle へ供給。
      if (onDepth) {
        if (depthExclude) depthExclude.visible = false;
        renderer.setRenderTarget(depthRT);
        renderer.setClearColor(0x000000, 1);
        renderer.clear(true, true, false);
        renderer.render(scene, camera);
        if (floorEnabled) { const pa = renderer.autoClear; renderer.autoClear = false; renderer.render(floorScene, camera); renderer.autoClear = pa; } // 床の深度を追記(色/深度はクリアしない)
        if (depthExclude) depthExclude.visible = true;
        onDepth(depthRT.depthTexture);
      }
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      const prevAuto = renderer.autoClear;
      renderer.autoClear = false;
      if (bgScene && bgTexture.image) renderer.render(bgScene, quadCam);
      renderer.render(scene, camera);
      renderer.autoClear = prevAuto;
      const drawFx = (rtOut, m) => { fxQuad.material = m; renderer.setRenderTarget(rtOut); renderer.clear(); renderer.render(fxScene, quadCam); };
      if (downMips.length && uniforms.uBloomIntensity.value > 0) {
        prefiltMat.uniforms.t.value = rt.texture;
        drawFx(downMips[0], prefiltMat);
        for (let i = 1; i < downMips.length; i++) {
          downMat.uniforms.t.value = downMips[i - 1].texture;
          downMat.uniforms.texel.value.set(1 / downMips[i - 1].width, 1 / downMips[i - 1].height);
          drawFx(downMips[i], downMat);
        }
        const last = downMips.length - 1;
        copyMat.uniforms.t.value = downMips[last].texture;
        drawFx(upMips[last], copyMat);
        for (let i = last - 1; i >= 0; i--) {
          upMat.uniforms.uHigh.value = downMips[i].texture;
          upMat.uniforms.uLow.value = upMips[i + 1].texture;
          upMat.uniforms.texel.value.set(1 / upMips[i + 1].width, 1 / upMips[i + 1].height);
          drawFx(upMips[i], upMat);
        }
      }
      renderer.setRenderTarget(null);
      renderer.render(quadScene, quadCam);
    },
    dispose() {
      rt.dispose();
      if (depthRT.depthTexture) depthRT.depthTexture.dispose();
      depthRT.dispose();
      floorMesh.geometry.dispose();
      floorMat.dispose();
      for (const m of downMips) m.dispose();
      for (const m of upMips) m.dispose();
      prefiltMat.dispose();
      downMat.dispose();
      upMat.dispose();
      copyMat.dispose();
      fxQuad.geometry.dispose();
      mat.dispose();
      quad.geometry.dispose();
      if (bgScene)
        bgScene.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
    },
  };
}

function buildThreeSkeleton(avatar) {
  const n = avatar.count;
  const bones = new Array(n);
  for (let i = 0; i < n; i++) {
    const b = new THREE_NS.Bone();
    b.name = 'b' + (avatar.hashes[i] >>> 0);
    const dp = avatar.defPose && avatar.defPose[i];
    if (dp) {
      b.position.set(dp.t[0], dp.t[1], dp.t[2]);
      b.quaternion.set(dp.q[0], dp.q[1], dp.q[2], dp.q[3]);
      b.scale.set(dp.s[0], dp.s[1], dp.s[2]);
    }
    bones[i] = b;
  }
  const roots = [];
  for (let i = 0; i < n; i++) {
    const p = avatar.parents[i];
    if (p >= 0 && p < n) bones[p].add(bones[i]);
    else roots.push(bones[i]);
  }
  return { bones, roots };
}

function mat4FromBindpose(bp) {
  const m = new THREE_NS.Matrix4();
  m.set(bp[0], bp[1], bp[2], bp[3], bp[4], bp[5], bp[6], bp[7], bp[8], bp[9], bp[10], bp[11], bp[12], bp[13], bp[14], bp[15]);
  return m;
}

function buildThreeClip(clip, fps, validBones) {
  const data = clip.buildTracks(fps);
  const tracks = [];
  for (const tr of data.tracks) {
    if (validBones && validBones.size && !validBones.has(tr.boneHash >>> 0)) continue;
    const nm = 'b' + (tr.boneHash >>> 0);
    if (tr.type === 'pos') tracks.push(new THREE_NS.VectorKeyframeTrack(nm + '.position', tr.times, tr.values));
    else if (tr.type === 'scale') tracks.push(new THREE_NS.VectorKeyframeTrack(nm + '.scale', tr.times, tr.values));
    else if (tr.type === 'rot') tracks.push(new THREE_NS.QuaternionKeyframeTrack(nm + '.quaternion', tr.times, tr.values));
  }
  return new THREE_NS.AnimationClip(data.name, data.duration || -1, tracks);
}

export const model3dLib = {
  sharedBgTexture,
  setSharedBgFromRgba,
  buildTextureMap,
  MOUTH_EXPRESSIONS,
  remapMouthUV,
  makeDataTexture,
  TP_TO_LINEAR,
  buildPostPass,
  buildThreeSkeleton,
  mat4FromBindpose,
  buildThreeClip,
};
