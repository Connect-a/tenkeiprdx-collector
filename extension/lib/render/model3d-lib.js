'use strict';
// model3dの再利用可能な描画プリミティブ(THREE依存の純粋関数群)。render本体(model3d.js)から分離。
(function () {
  const THREE = () => globalThis.THREE;

  // 実ゲーム背景(bg_common_system)は静的PNG。生値サンプル用にcolorSpaceは非変換(shaderで手動sRGB→linear)。
  let _sharedBgTex = null;
  function sharedBgTexture(T, url) {
    if (_sharedBgTex) return _sharedBgTex;
    try {
      const t = new T.TextureLoader().load(url);
      if ('colorSpace' in t) t.colorSpace = (T.NoColorSpace || T.LinearSRGBColorSpace || 'srgb-linear'); else t.encoding = T.LinearEncoding;
      t.minFilter = T.LinearFilter; t.magFilter = T.LinearFilter; t.generateMipmaps = false;
      _sharedBgTex = t;
    } catch (e) { _sharedBgTex = null; }
    return _sharedBgTex;
  }

  function buildTextureMap(materialBundle) {
    const byName = new Map();
    const shadowByName = new Map();
    const maskByName = new Map();
    const toonByName = new Map();
    const texByPath = new Map((materialBundle.textures || []).map((t) => [t.pathID, t]));
    for (const m of materialBundle.materials || []) {
      const t = texByPath.get(m.mainTexPathID);
      if (t && t.rgba) byName.set(m.name, t);
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
    const headColor = pick((n) => /head.*color/i.test(n)) || fallback;
    return { byName, shadowByName, maskByName, toonByName, fallback, headColor };
  }

  // mouth meshはテクスチャを持たず、共有アトラス(mouth_texture_preset・5x5)をmaterial.mainTextureOffset(mouthMap[index])で選ぶ。
  // 実機同様mesh native UV(=mouthMap[1]=offset(0,0)=col0,row4)を基準に(col,row)セルへシフトする。
  const MOUTH_CELL = 0.2;
  const MOUTH_BASE_ROW = 4;
  const MOUTH_EXPRESSIONS = [
    ['ムッ', 0, 1], ['あっ', 3, 4], ['真顔', 1, 0], ['にっこり', 0, 3], ['ニヤッ', 1, 1],
    ['大きく開', 0, 2], ['歯見せ', 2, 2], ['うにっ', 3, 3], ['おちょぼ', 4, 4], ['むー', 0, 0],
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

  // linear=trueはデータテクスチャ(_MaskTex=値)用でsRGB→linear変換を掛けない(色でなく値なので歪めない)。
  // forceOpaque=true: 色(_ColorTex)のalphaは陰影/マスク値で不透明度でない。そのまま使うと透過し背景が透けて白く見える→255固定。
  function makeDataTexture(tex, linear, forceOpaque) {
    const T = THREE();
    let rgba = tex.rgba;
    if (forceOpaque) { rgba = rgba.slice(); for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255; }
    const dt = new T.DataTexture(rgba, tex.width, tex.height, T.RGBAFormat);
    dt.flipY = false;
    dt.needsUpdate = true;
    dt.wrapS = T.RepeatWrapping;  // Unity default Repeat。UVが[0,1]外(U in [1,2]等)のwrap前提メッシュがある
    dt.wrapT = T.RepeatWrapping;
    dt.magFilter = T.LinearFilter;
    dt.minFilter = T.LinearMipmapLinearFilter;
    dt.generateMipmaps = true;
    if ('colorSpace' in dt) dt.colorSpace = linear ? (T.LinearSRGBColorSpace || T.NoColorSpace || 'srgb-linear') : (T.SRGBColorSpace || 'srgb');
    else dt.encoding = linear ? (T.LinearEncoding || 3000) : T.sRGBEncoding;
    return dt;
  }

  // 実ゲーム準拠の後処理(実VolumeProfile再現)。実効はVignette(周縁を灰へ乗算)＋僅かなコントラスト低下のみ
  // (postExposure/hueShift/saturationはoverride OFF)。背景ごとRTへ描いて後処理し、sRGBへ手動エンコードしてcanvasへ。
  function buildPostPass(renderer, bgTexture, bgAspect) {
    const T = THREE();
    const size = renderer.getDrawingBufferSize(new T.Vector2());
    const rt = new T.WebGLRenderTarget(size.x, size.y, {
      minFilter: T.LinearFilter, magFilter: T.LinearFilter, format: T.RGBAFormat, type: T.UnsignedByteType, samples: 4,
    });
    if ('colorSpace' in rt.texture) rt.texture.colorSpace = (T.LinearSRGBColorSpace || 'srgb-linear');
    else rt.texture.encoding = T.LinearEncoding;
    const quadCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadScene = new T.Scene();
    // 背景をRT内(後処理対象)に最初に描くフルスクリーンquad。CSS背景だとビネット/コントラストが掛からず白飛びして見える。
    let bgScene = null, bgUniforms = null;
    if (bgTexture) {
      bgUniforms = { uBg: { value: bgTexture }, uRepeat: { value: new T.Vector2(1, 1) }, uOffset: { value: new T.Vector2(0, 0) } };
      const bgMat = new T.ShaderMaterial({
        uniforms: bgUniforms, depthTest: false, depthWrite: false,
        vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
        fragmentShader: [
          'precision highp float; varying vec2 vUv; uniform sampler2D uBg; uniform vec2 uRepeat,uOffset;',
          'vec3 s2l(vec3 c){ return mix(pow((c+0.055)/1.055,vec3(2.4)), c/12.92, step(c,vec3(0.04045))); }',
          'void main(){ vec3 c=texture2D(uBg, vUv*uRepeat+uOffset).rgb; gl_FragColor=vec4(s2l(c),1.0); }',
        ].join('\n'),
      });
      bgScene = new T.Scene(); const bgq = new T.Mesh(new T.PlaneGeometry(2, 2), bgMat); bgq.frustumCulled = false; bgScene.add(bgq);
    }
    const uniforms = {
      tDiffuse: { value: rt.texture },
      uExposure: { value: 0.0 },                                  // postExposure(実機-0.17)はoverride OFF→未適用
      uContrast: { value: -4.0 },                                 // ColorAdjustments.contrast(override ON)
      uColorFilter: { value: new T.Vector3(1, 1, 1) },
      uVigColor: { value: new T.Vector3(0.783, 0.783, 0.783) },   // Vignette.color(灰)
      uVigCenter: { value: new T.Vector2(0.5, 0.5) },
      uVigIntensity: { value: 0.3 },
      uVigSmooth: { value: 0.2 },
    };
    const mat = new T.ShaderMaterial({
      uniforms,
      blending: T.NoBlending,                                     // RTはMSAAでプリマルチ済み→直書き(canvasはpremultipliedAlpha)
      depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
      fragmentShader: [
        'precision highp float; varying vec2 vUv; uniform sampler2D tDiffuse;',
        'uniform float uExposure,uContrast,uVigIntensity,uVigSmooth; uniform vec3 uColorFilter,uVigColor; uniform vec2 uVigCenter;',
        'vec3 lin2srgb(vec3 c){ c=clamp(c,0.0,1.0); return mix(1.055*pow(c,vec3(1.0/2.4))-0.055, c*12.92, step(c,vec3(0.0031308))); }',
        'void main(){',
        '  vec4 src=texture2D(tDiffuse,vUv); vec3 col=src.rgb;',   // RTは線形
        '  col*=exp2(uExposure);',
        '  col*=uColorFilter;',
        '  float cf=1.0+uContrast/100.0; col=(col-0.5)*cf+0.5;',   // ColorAdjustments contrast(LDR近似)
        '  vec2 d=(vUv-uVigCenter)*uVigIntensity*3.0;',             // URP procedural Vignette近似
        '  float vf=pow(clamp(1.0-dot(d,d),0.0,1.0), uVigSmooth*5.0+1.0);',
        '  col*=mix(uVigColor, vec3(1.0), vf);',
        '  gl_FragColor=vec4(lin2srgb(col), src.a);',
        '}',
      ].join('\n'),
    });
    const quad = new T.Mesh(new T.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    quadScene.add(quad);
    let curW = size.x, curH = size.y;
    const updateCover = (w, h) => {
      if (!bgUniforms || !bgAspect) return;
      const pa = w / h;
      if (pa > bgAspect) { const r = bgAspect / pa; bgUniforms.uRepeat.value.set(1, r); bgUniforms.uOffset.value.set(0, (1 - r) / 2); }
      else { const r = pa / bgAspect; bgUniforms.uRepeat.value.set(r, 1); bgUniforms.uOffset.value.set((1 - r) / 2, 0); }
    };
    updateCover(size.x, size.y);
    return {
      uniforms,
      render(scene, camera) {
        const s = renderer.getDrawingBufferSize(new T.Vector2());
        if (s.x !== curW || s.y !== curH) { curW = s.x; curH = s.y; rt.setSize(s.x, s.y); updateCover(s.x, s.y); }
        renderer.setRenderTarget(rt);
        renderer.setClearColor(0x000000, 0); renderer.clear();
        const prevAuto = renderer.autoClear; renderer.autoClear = false;
        if (bgScene && bgTexture.image) renderer.render(bgScene, quadCam);
        renderer.render(scene, camera);
        renderer.autoClear = prevAuto;
        renderer.setRenderTarget(null);
        renderer.render(quadScene, quadCam);
      },
      dispose() { rt.dispose(); mat.dispose(); quad.geometry.dispose(); if (bgScene) bgScene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); },
    };
  }

  function buildSkeleton(avatar) {
    const T = THREE();
    const n = avatar.count;
    const bones = new Array(n);
    for (let i = 0; i < n; i++) {
      const b = new T.Bone();
      b.name = 'b' + (avatar.hashes[i] >>> 0);
      const dp = avatar.defPose && avatar.defPose[i];
      if (dp) { b.position.set(dp.t[0], dp.t[1], dp.t[2]); b.quaternion.set(dp.q[0], dp.q[1], dp.q[2], dp.q[3]); b.scale.set(dp.s[0], dp.s[1], dp.s[2]); }
      bones[i] = b;
    }
    const roots = [];
    for (let i = 0; i < n; i++) {
      const p = avatar.parents[i];
      if (p >= 0 && p < n) bones[p].add(bones[i]); else roots.push(bones[i]);
    }
    return { bones, roots };
  }

  function mat4FromBindpose(bp) {
    const T = THREE();
    const m = new T.Matrix4();
    m.set(bp[0], bp[1], bp[2], bp[3], bp[4], bp[5], bp[6], bp[7], bp[8], bp[9], bp[10], bp[11], bp[12], bp[13], bp[14], bp[15]); // row-major e00..e33
    return m;
  }

  function buildThreeClip(clip, fps, validBones) {
    const T = THREE();
    const data = clip.buildTracks(fps);
    const tracks = [];
    for (const tr of data.tracks) {
      // アバター外の骨(呪文エフェクト等の追加ノード)向けトラックは書込先が無く毎フレーム補間コストだけ増えカクつく主因→除去
      if (validBones && validBones.size && !validBones.has(tr.boneHash >>> 0)) continue;
      const nm = 'b' + (tr.boneHash >>> 0);
      if (tr.type === 'pos') tracks.push(new T.VectorKeyframeTrack(nm + '.position', tr.times, tr.values));
      else if (tr.type === 'scale') tracks.push(new T.VectorKeyframeTrack(nm + '.scale', tr.times, tr.values));
      else if (tr.type === 'rot') tracks.push(new T.QuaternionKeyframeTrack(nm + '.quaternion', tr.times, tr.values));
    }
    return new T.AnimationClip(data.name, data.duration || -1, tracks);
  }

  globalThis.TP_MODEL3DLIB = { sharedBgTexture, buildTextureMap, MOUTH_EXPRESSIONS, remapMouthUV, makeDataTexture, buildPostPass, buildSkeleton, mat4FromBindpose, buildThreeClip };
})();
