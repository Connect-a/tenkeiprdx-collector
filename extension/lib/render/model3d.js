'use strict';
(function () {
  const THREE = () => globalThis.THREE;
  const { sharedBgTexture, buildTextureMap, MOUTH_EXPRESSIONS, remapMouthUV, makeDataTexture, buildPostPass, buildSkeleton, mat4FromBindpose, buildThreeClip } = globalThis.TP_MODEL3DLIB;

  function createMaterialFactory(T, deps) {
    const { texMap, shadeMode, litMode, OVR, TOON_LIGHT, mouthAtlasTex } = deps;
    const shadowTexCache = new Map(), maskTexCache = new Map();
    const applyToonShadow = (mat, name) => {
      const p = texMap.toonByName.get(name) || {};
      const shadowRgba = texMap.shadowByName.get(name);
      let shadowTex = null;
      if (shadowRgba) { if (!shadowTexCache.has(name)) shadowTexCache.set(name, makeDataTexture(shadowRgba)); shadowTex = shadowTexCache.get(name); }
      const maskRgba = texMap.maskByName.get(name);
      let maskTex = null;
      if (maskRgba) { if (!maskTexCache.has(name)) maskTexCache.set(name, makeDataTexture(maskRgba, true)); maskTex = maskTexCache.get(name); } // linear=マスクは"値"(sRGB変換しない)
      const hc = p.highlightColor || [1, 1, 1, 1];
      const num = (v, d) => (v != null ? v : d);
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, {
          uShadowTex: { value: shadowTex || mat.map }, uHasShadow: { value: shadowTex ? 1 : 0 },
          uMaskTex: { value: maskTex || mat.map }, uHasMask: { value: maskTex ? 1 : 0 },
          uLightDir: { value: new T.Vector3(TOON_LIGHT[0], TOON_LIGHT[1], TOON_LIGHT[2]) },
          uShadowThreshold: { value: num(p.shadowBorderThreshold, 0.05) }, uShadowGrad: { value: num(p.shadowBorderGradation, 0.0) }, uShadowWeight: { value: num(p.shadowColorWeight, 0.3) },
          // 実マテリアル値を忠実採用(sharp105=細い光沢/int0.5)。研究用にOVRで上書き可。
          uHiColor: { value: new T.Vector3(hc[0], hc[1], hc[2]) }, uHiIntensity: { value: num(OVR.highlightIntensity, num(p.highlightIntensity, 0.5)) },
          uHiSharp: { value: num(OVR.highlightSharpness, num(p.highlightSharpness, 105)) }, uHiPos: { value: num(p.highlightPosition, -0.5) }, uHiNoise: { value: num(p.highlightNoiseIntensity, 0.2) },
          uFresnel: { value: num(p.fresnel, 0.0) }, uRimThreshold: { value: num(p.rimLightThreshold, 0.04) },
          // リム寄与の強度。実機は二値1.0だが白い肌/髪がoverlayで白飛びするので既定0.35に抑制(実機比較でクリーン一致)。OVRで1.0=厳密忠実。
          uRimStrength: { value: num(OVR.rimStrength, 0.35) },
        });
        // vToonWN=world normal, vToonVD=view方向(camera-worldPos), vToonTAN=world tangent。
        // cameraPositionはvertex組込uniform＝カメラ移動で毎フレーム更新→光沢が移動。
        shader.vertexShader = 'attribute vec3 aToonTangent;\nattribute vec4 aToonColor;\nvarying vec3 vToonWN;\nvarying vec3 vToonVD;\nvarying vec3 vToonTAN;\nvarying vec4 vToonCol;\n'
          + shader.vertexShader
            .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\n\tvToonWN = normalize( mat3( modelMatrix ) * objectNormal );\n\tvToonTAN = mat3( modelMatrix ) * aToonTangent;\n\tvToonCol = aToonColor;')
            .replace('#include <project_vertex>', '#include <project_vertex>\n\tvToonVD = cameraPosition - ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
        // ★USE_SKINNINGガードは使わない(fragmentでは常にfalse)。vToonWNの有効性で分岐。
        const inject = [
          'if (dot(vToonWN, vToonWN) > 0.5) {',
          '  vec3 N = normalize(vToonWN);',
          '  vec3 Vd = normalize(vToonVD);',
          '  vec3 Ld = normalize(uLightDir);',
          '  float ndl = dot(N, Ld);',
          '  vec3 mask = (uHasMask > 0.5) ? texture2D(uMaskTex, vUv).rgb : vec3(0.0);',
          '  float hp = (mask.b * 0.5 + 0.5) * uHiNoise + uHiPos;',
          '  vec3 Sv = normalize(-N * hp + vToonTAN);',
          '  vec3 Hh = normalize(Ld + Vd);',
          '  float xh = dot(Sv, Hh) * 0.5 + 0.5;',
          '  float band = 4.0 * xh * (1.0 - xh);',
          '  float hiBand = pow(max(band, 1e-4), uHiSharp) * uHiIntensity * mask.g;',
          '  float ndv = dot(Vd, N);',
          '  float rim = pow(max(1.0 - ndv, 0.0), 5.0);',
          '  rim = (1.0 - uFresnel) * rim + uFresnel;',
          '  rim = rim * ndl;',
          '  float hiF = max(((rim >= uRimThreshold) ? uRimStrength : 0.0) * vToonCol.r, hiBand);',  // リムは頂点カラーRでゲート(実機line100)。vToonCol.rは二値リムマスクのメッシュのみ非ゼロ(連続baked色はロード時ゼロ化済＝白飛び回避)。
          '  vec3 cTex = diffuseColor.rgb;',   // 生_ColorTex(overlayの基底=実機はこれを使う)
          '  vec3 baseCol = diffuseColor.rgb;',
          '  if (uHasShadow > 0.5) {',
          '    float bw = max(2.0 * uShadowGrad, 1e-4);',
          '    float s = clamp((ndl - uShadowThreshold + uShadowGrad) / bw, 0.0, 1.0);',
          '    s = s * s * (3.0 - 2.0 * s);',
          '    vec3 shTex = texture2D(uShadowTex, vUv).rgb;',  // colorTex(map)と同じ色空間扱い(three側でsRGB→linear済＝手動pow(2.2)は不要)
          '    float sf = (mask.r < 0.5) ? s : (-(1.0 - s) * uShadowWeight);',
          '    baseCol = shTex + sf * (diffuseColor.rgb - shTex);',
          '  }',
          '  vec3 lo2 = 2.0 * cTex * uHiColor;',
          '  vec3 hi2 = 1.0 - 2.0 * (1.0 - cTex) * (1.0 - uHiColor);',
          '  vec3 ov = mix(lo2, hi2, step(vec3(0.5), cTex));',
          '  diffuseColor.rgb = mix(baseCol, ov, hiF);',
          '}',
        ].join('\n');
        shader.fragmentShader = 'uniform sampler2D uShadowTex, uMaskTex;\nuniform float uHasShadow, uHasMask, uShadowThreshold, uShadowGrad, uShadowWeight, uHiIntensity, uHiSharp, uHiPos, uHiNoise, uFresnel, uRimThreshold, uRimStrength;\nuniform vec3 uLightDir, uHiColor;\nvarying vec3 vToonWN;\nvarying vec3 vToonVD;\nvarying vec3 vToonTAN;\nvarying vec4 vToonCol;\n'
          + shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + inject);
      };
      mat.customProgramCacheKey = () => 'tp-toonshadow';
    };

    const texCache = new Map();
    const getMat = (modelMat) => {
      const name = modelMat ? modelMat.name : null;
      const key = ((modelMat && modelMat.pathID) || name || '__fallback') + '|' + shadeMode;
      if (texCache.has(key)) return texCache.get(key);
      const ownTex = name ? texMap.byName.get(name) : null;
      const isMouth = /mouth/i.test(name || '');
      const params = { side: T.DoubleSide };
      if (isMouth && mouthAtlasTex) {
        // mouth: shared expression atlas; the mesh UV (remapped below) selects the expression cell.
        // The atlas alpha is a real cutout, so alpha-test it.
        params.map = mouthAtlasTex; params.transparent = true; params.alphaTest = 0.5; params.depthWrite = false;
      }
      // color textures are opaque toon maps: their alpha channel is a shading/mask channel, NOT opacity.
      // alphaは陰影値なので不透明固定(forceOpaque)する。しないとalpha≈0の色テクスチャでメッシュが透過し背景が
      // 透けて真っ白に見える(例10244402)。
      else if (ownTex) { params.map = makeDataTexture(ownTex, false, true); }
      else if (texMap.fallback) { params.map = makeDataTexture(texMap.fallback, false, true); }
      else if (modelMat && modelMat.color) params.color = new T.Color(modelMat.color[0], modelMat.color[1], modelMat.color[2]);
      else params.color = new T.Color(0xcccccc);
      if (!isMouth && modelMat && modelMat.transparent) {
        params.transparent = true; params.depthWrite = false;
        if (modelMat.color && modelMat.color[3] != null) params.opacity = modelMat.color[3];
        delete params.alphaTest;
      }
      // toon & unlit: MeshBasicMaterial (show the already-toon-shaded texture at full brightness; scene
      // lighting on these bakes-in-shaded textures only darkens them). pbr: soft scene lighting.
      let mat;
      if (litMode) { params.roughness = 0.92; params.metalness = 0.0; mat = new T.MeshStandardMaterial(params); }
      else mat = new T.MeshBasicMaterial(params);
      if (shadeMode === 'game' && !isMouth) applyToonShadow(mat, name);
      texCache.set(key, mat);
      return mat;
    };
    return { getMat, dispose() { texCache.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); } };
  }

  function createPlayback(T, st, deps) {
    const { getThreeClip, clips, idleActionIdx, root, skelBones, model, weaponRigs } = deps;
    // クリップ遷移は瞬間切替でなくクロスフェードでブレンド(実機Animatorの遷移相当)。瞬間切替はポーズが不連続に飛ぶ=ガクつきの原因。
    const XFADE = 0.12;
    // スキン武器を本体クリップと同名で同期再生(数珠の垂れ/揺れ等)。武器に該当名クリップが無ければ据え置き。
    const syncWeapons = (name, loopOnce) => {
      if (!weaponRigs || !weaponRigs.length || !name) return;
      for (const rig of weaponRigs) {
        const tc = rig.get(name); if (!tc) continue;
        const wa = rig.mixer.clipAction(tc); wa.reset();
        if (loopOnce) { wa.setLoop(T.LoopOnce, 1); wa.clampWhenFinished = true; } else wa.setLoop(T.LoopRepeat, Infinity);
        wa.enabled = true; wa.setEffectiveWeight(1); wa.play();
        if (rig.cur && rig.cur !== wa) wa.crossFadeFrom(rig.cur, XFADE, false);
        rig.cur = wa;
      }
    };
    const startAction = (idx, loopOnce) => {
      const next = st.mixer.clipAction(getThreeClip(idx));
      next.reset();
      if (loopOnce) { next.setLoop(T.LoopOnce, 1); next.clampWhenFinished = true; }
      else { next.setLoop(T.LoopRepeat, Infinity); }
      next.enabled = true; next.setEffectiveWeight(1); next.play();
      if (st.action && st.action !== next) next.crossFadeFrom(st.action, XFADE, false);
      st.action = next; st.curClip = clips[idx];
      syncWeapons(clips[idx] && clips[idx].name, loopOnce);
      return next;
    };
    const playIdleActionOnce = () => {
      if (idleActionIdx < 0 || !st.mixer) return;
      st.idleActionActive = true;
      startAction(idleActionIdx, true);
    };
    const onActionFinished = () => {
      if (st.idleActionActive) { st.idleActionActive = false; st.idleClock = 0; st.idleNext = 10 /* 実機idleActionTime実測=10s固定 */; if (st.baseClipIdx >= 0) startAction(st.baseClipIdx, false); }
    };
    const playClip = (idx, isAuto) => {
      if (!clips.length) return;
      if (!st.mixer) { st.mixer = new T.AnimationMixer(root); st.mixer.addEventListener('finished', onActionFinished); }
      st.mixer.timeScale = st.playSpeed;
      startAction(idx, false);
      st.mixer.update(0);
      if (!isAuto) { st.baseClipIdx = idx; st.idleActionActive = false; st.idleClock = 0; st.idleNext = 10 /* 実機idleActionTime実測=10s固定 */; }
      st.playing = true; if (st.playBtn) st.playBtn.textContent = '⏸';
    };
    const setDefPose = (bones, defPose) => {
      if (!bones || !defPose) return;
      for (let i = 0; i < bones.length; i++) { const dp = defPose[i], b = bones[i]; if (!dp || !b) continue; b.position.set(dp.t[0], dp.t[1], dp.t[2]); b.quaternion.set(dp.q[0], dp.q[1], dp.q[2], dp.q[3]); b.scale.set(dp.s[0], dp.s[1], dp.s[2]); }
    };
    const restPose = () => {
      if (st.mixer) st.mixer.stopAllAction();
      st.action = null; st.curClip = null; st.idleActionActive = false; st.baseClipIdx = -1;
      if (skelBones && model.avatar) setDefPose(skelBones, model.avatar.defPose);
      if (weaponRigs) for (const rig of weaponRigs) { rig.mixer.stopAllAction(); rig.cur = null; setDefPose(rig.bones, rig.defPose); }
      if (st.playBtn) st.playBtn.textContent = '▶';
    };
    return { playClip, restPose, playIdleActionOnce };
  }

  function createExpression(T, st, deps) {
    const { mouthGeoms, morphObjs, weaponObjs, objBySmr, fbx, remapMouthUV, exprBase } = deps;
    // 目/眉=ブレンドシェイプ、口=アトラスセルオフセット。＝「アクションに表情が付属」の実体。再生中は、その
    // クリップがイベントで触る顔パーツだけをイベント駆動(手動セレクタを上書き)し、触らないパーツは手動選択を残す。
    // 口セルUVを適用。mouthCellKeyでキャッシュ短絡。モーション復帰時に手動口が残らないよう手動セレクタは''でinvalidateする。
    // モーション復帰時に「同じセル番号だからスキップ」して手動の口が残ることはない。
    const applyMouthCell = (col, row) => {
      const k = col + ',' + row; if (k === st.mouthCellKey) return; st.mouthCellKey = k;
      for (const mg of mouthGeoms) { const uv = remapMouthUV(mg.baseUv, mg.vMin, mg.vMax, col, row); mg.geo.setAttribute('uv', new T.BufferAttribute(uv, 2)); mg.geo.attributes.uv.needsUpdate = true; }
    };
    // 目標blendShapeの時刻tの重み。イベント="時刻eventTimeからdur秒でweightへブレンド"。
    // loop=trueのループクリップでは起点を"前ループ末の値"にして継ぎ目を連続させる(t=0で最初のイベントが
    // prev=0からランプして閉じ目が一瞬開く、を防ぐ。実機はループ末の値から連続)。
    const evalBlend = (evs, t, loop) => {
      const start = loop && evs.length ? evs[evs.length - 1].weight : 0;
      let val = start;
      for (let i = 0; i < evs.length; i++) {
        const e = evs[i]; if (t < e.time) break;
        if (e.dur > 0 && t < e.time + e.dur) { const prev = i > 0 ? evs[i - 1].weight : start; return prev + (e.weight - prev) * ((t - e.time) / e.dur); }
        val = e.weight;
      }
      return val;
    };
    const applyClipExpr = () => {
      const clip = st.curClip;
      if (!clip || !clip.events || !clip.events.length || !st.action) return false;
      const dur = clip.duration || 1;
      let t = st.action.time || 0; if (dur > 0) t = ((t % dur) + dur) % dur;
      const isLoop = st.action.loop === T.LoopRepeat;
      let faceDriven = false;
      if (!st.exprFix) {
        const byTarget = new Map(); let mouthDriven = false;
        for (const e of clip.events) {
          if (e.kind === 'blend') { let a = byTarget.get(e.target); if (!a) byTarget.set(e.target, a = []); a.push(e); }
          else if (e.kind === 'mouth') mouthDriven = true;
        }
        const drivenFeat = new Set();
        for (const tg of byTarget.keys()) { if (/^face\./.test(tg)) drivenFeat.add('face'); else if (/^eyebrow\./.test(tg)) drivenFeat.add('brow'); }
        // 再生中は毎フレーム顔をクリア(実機の顔=イベント+まばたき+base)。クリア後にこのクリップが駆動する
        // 顔パーツへイベント値を乗せる。まばたきはこの後updateBlinkで付与。
        for (const mt of morphObjs) {
          const infl = mt.obj.morphTargetInfluences; if (!infl) continue;
          for (let i = 0; i < infl.length; i++) infl[i] = 0;
          const baseMap = mt.feature === 'face' ? fbx.faceBaseValues : mt.feature === 'brow' ? fbx.browBaseValues : null;
          const bv = baseMap && baseMap[clip.name];
          if (bv) for (let i = 0; i < infl.length && i < bv.length; i++) infl[i] = (bv[i] || 0) / 100;
          if (drivenFeat.has(mt.feature)) {
            const dict = mt.obj.morphTargetDictionary || {};
            for (const [tg, evs] of byTarget) {
              const w = evalBlend(evs, t, isLoop);
              for (const nm in dict) { if (nm === tg || exprBase(nm) === tg) infl[dict[nm]] = w; }
            }
          }
        }
        if (mouthDriven && mouthGeoms.length) {
          let idx = null;
          for (const e of clip.events) { if (e.time > t) break; if (e.kind === 'mouth') idx = e.index; }
          if (idx != null) applyMouthIndex(idx);
        }
        faceDriven = drivenFeat.has('face');
      }
      // 各クリップの可視は毎フレーム"既定＋このクリップのイベント"で決める(前のクリップの状態を引き継がない)。
      // ＝武器: 既定=表示(装備は持つ・イベント無いクリップも表示)、HideWeaponEventで非表示。
      //   持ち物: 既定=非表示(prop)、ShowAttachmentEventで表示。
      if (!st.attachFix) {
        if (weaponObjs.length) {
          let show = true;
          for (const e of clip.events) { if (e.time > t) break; if (e.kind === 'weapon') show = e.show; }
          for (const w of weaponObjs) w.visible = show;
        }
        if (objBySmr.size && (fbx.attachmentSmrPathIDs || []).length) {
          const shown = new Map();
          for (const e of clip.events) { if (e.time > t) break; if (e.kind === 'attach') shown.set(e.index, e.show); }
          for (let i = 0; i < fbx.attachmentSmrPathIDs.length; i++) {
            const smr = fbx.attachmentSmrPathIDs[i]; const o = smr && objBySmr.get(String(smr)); if (!o) continue;
            const show = shown.has(i) ? shown.get(i) : false;
            o.visible = show; if (o.__outline) o.__outline.visible = show;
          }
        }
      }
      return faceDriven;
    };
    // 実機mouthMap(稼働ゲームのIL2CPPメモリから実測): static Dictionary<int,(x,y)>。5x5グリッド・セル0.2。
    // col=(index-1)%5、y offset=((5-row)%5)*0.2。mesh native UV=mouthMap[1]=offset(0,0)=my(col0,row4)。
    // ∴ mycol=(index-1)%5、myrow=4-floor((index-1)/5)。既定index=6(=アイドル,offset(0,0.8))。
    const applyMouthIndex = (idx) => { const i0 = Math.max(0, (idx | 0) - 1); applyMouthCell(i0 % 5, 4 - Math.floor(i0 / 5)); };

    // ---- 自動まばたき(実機PlaybackBlinkMotion): faceRendererのblinkRelatedBlendShapes(実値からindex)を
    // タイマーで開閉。アクションが顔をイベント制御中(clipDrivesFace)は実機同様まばたきしない。
    const faceMorph = () => { const m = morphObjs.find((x) => x.feature === 'face'); return m ? m.obj : null; };
    const blinkIdx = (fbx.blinkBlendShapes || []).filter((i) => i >= 0);
    const updateBlink = (dt, clipDrivesFace) => {
      const fo = faceMorph(); if (!fo || !fo.morphTargetInfluences || !blinkIdx.length) return;
      if (clipDrivesFace) { st.blinkClock = 0; return; }
      st.blinkClock += dt;
      let w = 0; const into = st.blinkClock - st.blinkNext;
      if (into >= 0) {
        const D = 0.16; // 閉→開の総時間
        if (into < D) { const h = into / (D / 2); w = h < 1 ? h : (2 - h); if (w < 0) w = 0; }
        else { st.blinkClock = 0; st.blinkNext = 2.0 + Math.random() * 2.5; w = 0; }
      }
      // applyClipExprが毎フレーム顔を0にクリアしているので、まばたき値は毎フレーム書き込む(キャッシュ短絡しない)
      for (const i of blinkIdx) if (i < fo.morphTargetInfluences.length) fo.morphTargetInfluences[i] = w;
    };
    return { applyClipExpr, updateBlink, applyMouthIndex };
  }

  function buildControls(st, deps) {
    const { bar, hostEl, canvasWrap, clips, mouthGeoms, morphObjs, mouthAtlasTex, model, fbx, meshGroups, shadeMode, options, exprBase, W, H, renderer, camera, playClip, restPose, applyMouthIndex } = deps;
    if (clips.length) {
      st.clipSelect = document.createElement('select');
      st.clipSelect.className = 'model3d-clip';
      clips.forEach((c, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = `${c.name} (${c.duration.toFixed(1)}s)`; st.clipSelect.appendChild(o); });
      const POSE_VAL = '__boon';
      const poseOpt = document.createElement('option'); poseOpt.value = POSE_VAL; poseOpt.textContent = '⊂二二二( ^ω^)二⊃ブーン'; st.clipSelect.appendChild(poseOpt);
      const prefer = clips.findIndex((c) => /^idle$/i.test(c.name));
      const defIdx = prefer >= 0 ? prefer : 0;
      st.clipSelect.value = String(defIdx);
      st.clipSelect.addEventListener('change', () => { if (st.clipSelect.value === POSE_VAL) restPose(); else playClip(Number(st.clipSelect.value)); });
      st.playBtn = document.createElement('button');
      st.playBtn.className = 'model3d-play'; st.playBtn.textContent = '⏸';
      st.playBtn.addEventListener('click', () => { if (!st.action) return; st.playing = !st.playing; st.action.paused = !st.playing; st.playBtn.textContent = st.playing ? '⏸' : '▶'; });
      const lbl = document.createElement('span'); lbl.className = 'model3d-lbl'; lbl.textContent = 'モーション';
      bar.appendChild(lbl); bar.appendChild(st.clipSelect); bar.appendChild(st.playBtn);
      // 再生速度
      const spdLbl = document.createElement('span'); spdLbl.className = 'model3d-lbl'; spdLbl.textContent = '速度';
      const spdSel = document.createElement('select'); spdSel.className = 'model3d-clip';
      [['0.25', '0.25x'], ['0.5', '0.5x'], ['1', '1x'], ['1.5', '1.5x'], ['2', '2x']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; spdSel.appendChild(o); });
      spdSel.value = '1';
      spdSel.addEventListener('change', () => { st.playSpeed = Number(spdSel.value) || 1; if (st.mixer) st.mixer.timeScale = st.playSpeed; });
      bar.appendChild(spdLbl); bar.appendChild(spdSel);
      playClip(defIdx);
    }
    hostEl.style.position = 'relative';
    const fsBtn = document.createElement('button'); fsBtn.className = 'model3d-play'; fsBtn.textContent = '⛶'; fsBtn.title = '全画面';
    fsBtn.style.cssText = 'position:absolute;top:8px;right:8px;z-index:5';
    fsBtn.addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else if (hostEl.requestFullscreen) hostEl.requestFullscreen(); });
    hostEl.appendChild(fsBtn);
    // リサイズ(通常/全画面)はrender()側のresize()+ResizeObserverが一括で担当(CSS実寸をrendererへ渡す)。
    const shuffleTargets = [];
    const exprCtrlWrap = document.createElement('span'); exprCtrlWrap.className = 'model3d-subctrls'; exprCtrlWrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px';
    const decoCtrlWrap = document.createElement('span'); decoCtrlWrap.className = 'model3d-subctrls'; decoCtrlWrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px';
    if (mouthGeoms.length && mouthAtlasTex) {
      const lbl = document.createElement('span'); lbl.className = 'model3d-lbl'; lbl.textContent = '口';
      const sel = document.createElement('select'); sel.className = 'model3d-clip';
      // このキャラがクリップで実際に使う口index(実mouthMap)だけを並べる。override系キャラで空セル(未使用index)を
      // 選んでしまい何も出ない、という混乱を防ぐ。既定口(defaultMouthId or 6)を先頭に含める。
      let usedMouth = [...new Set((model.clips || []).flatMap((c) => (c.events || []).filter((e) => e.kind === 'mouth').map((e) => e.index)))].filter((i) => i >= 1 && i <= 25).sort((a, b) => a - b);
      const defMouth = fbx.defaultMouthId > 0 ? fbx.defaultMouthId : 6;
      if (!usedMouth.length) usedMouth = [defMouth];
      else if (!usedMouth.includes(defMouth)) usedMouth.unshift(defMouth);
      usedMouth.forEach((idx) => { const o = document.createElement('option'); o.value = String(idx); o.textContent = String(idx); sel.appendChild(o); });
      sel.value = String(defMouth);
      const apply = () => { st.mouthCellKey = ''; applyMouthIndex(Number(sel.value)); };
      sel.addEventListener('change', apply);
      exprCtrlWrap.appendChild(lbl); exprCtrlWrap.appendChild(sel);
      shuffleTargets.push({ sel, apply });
    }
    const applyExpr = (feature, base) => {
      for (const mt of morphObjs) {
        if (mt.feature !== feature) continue;
        const infl = mt.obj.morphTargetInfluences; const dict = mt.obj.morphTargetDictionary || {};
        if (!infl) continue;
        for (let i = 0; i < infl.length; i++) infl[i] = 0;
        if (base) for (const nm in dict) { if (exprBase(nm) === base) infl[dict[nm]] = 1; }
      }
    };
    const addExprSelector = (feature, labelText) => {
      const bases = [];
      for (const mt of morphObjs) {
        if (mt.feature !== feature) continue;
        for (const nm in (mt.obj.morphTargetDictionary || {})) { const b = exprBase(nm); if (!bases.includes(b)) bases.push(b); }
      }
      if (!bases.length) return;
      const lbl = document.createElement('span'); lbl.className = 'model3d-lbl'; lbl.textContent = labelText;
      const sel = document.createElement('select'); sel.className = 'model3d-clip';
      const none = document.createElement('option'); none.value = ''; none.textContent = '0'; sel.appendChild(none);
      bases.forEach((b, i) => { const o = document.createElement('option'); o.value = b; o.textContent = String(i + 1); sel.appendChild(o); });
      sel.value = '';
      const apply = () => applyExpr(feature, sel.value);
      sel.addEventListener('change', apply);
      exprCtrlWrap.appendChild(lbl); exprCtrlWrap.appendChild(sel);
      shuffleTargets.push({ sel, apply });
    };
    addExprSelector('face', '目');
    addExprSelector('brow', '眉');
    if (shuffleTargets.length) {
      const shBtn = document.createElement('button'); shBtn.className = 'model3d-play'; shBtn.textContent = '🎲';
      shBtn.title = 'ランダム表情';
      shBtn.addEventListener('click', () => {
        for (const t of shuffleTargets) { const opts = t.sel.options; if (!opts.length) continue; t.sel.selectedIndex = Math.floor(Math.random() * opts.length); t.apply(); }
      });
      exprCtrlWrap.appendChild(shBtn);
    }
    const addBreak = () => { const brk = document.createElement('div'); brk.style.cssText = 'flex-basis:100%;height:0'; bar.appendChild(brk); };
    if (options.shading && typeof options.shading.onChange === 'function') {
      const lbl = document.createElement('span'); lbl.className = 'model3d-lbl'; lbl.textContent = '描画';
      const sel = document.createElement('select'); sel.className = 'model3d-clip';
      [['game', '実ゲーム風'], ['toon', 'トゥーン'], ['unlit', 'アンリット'], ['pbr', '標準']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); });
      sel.value = shadeMode;
      sel.addEventListener('change', () => options.shading.onChange(sel.value));
      bar.appendChild(lbl); bar.appendChild(sel);
    }
    addBreak();
    if (options.costume && options.costume.list && options.costume.list.length > 1) {
      const label = (v) => (v === 'default' ? '標準' : v === 'default_g' ? '標準(金)' : v);
      const lbl = document.createElement('span'); lbl.className = 'model3d-lbl'; lbl.textContent = '服装';
      const sel = document.createElement('select'); sel.className = 'model3d-clip';
      options.costume.list.forEach((v) => { const o = document.createElement('option'); o.value = v; o.textContent = label(v); sel.appendChild(o); });
      sel.value = options.costume.current;
      sel.addEventListener('change', () => { if (typeof options.costume.onChange === 'function') options.costume.onChange(sel.value); });
      bar.appendChild(lbl); bar.appendChild(sel);
    }
    if (options.aura && options.aura.list && options.aura.list.length && typeof options.aura.onChange === 'function') {
      const lbl = document.createElement('span'); lbl.className = 'model3d-lbl'; lbl.textContent = 'オーラ';
      const sel = document.createElement('select'); sel.className = 'model3d-clip';
      const none = document.createElement('option'); none.value = ''; none.textContent = 'なし'; sel.appendChild(none);
      options.aura.list.forEach((a) => { const o = document.createElement('option'); o.value = a.rel; o.textContent = a.label; sel.appendChild(o); });
      sel.value = options.aura.current || '';
      sel.addEventListener('change', () => options.aura.onChange(sel.value));
      bar.appendChild(lbl); bar.appendChild(sel);
    }
    const addVisToggle = (parent, label, objs) => {
      const lab = document.createElement('label'); lab.className = 'model3d-toggle';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = objs[0].visible;
      cb.addEventListener('change', () => { for (const o of objs) { o.visible = cb.checked; if (o.__outline) o.__outline.visible = cb.checked; } });
      lab.appendChild(cb); lab.appendChild(document.createTextNode(label)); parent.appendChild(lab);
    };
    const GROUP_LABELS = { outfit: '装飾', weapon: '武器', prop: '小物' };
    for (const cat of ['outfit', 'weapon', 'prop']) { const objs = meshGroups[cat]; if (objs && objs.length) addVisToggle(decoCtrlWrap, GROUP_LABELS[cat], objs); }
    const addOverrideToggle = (label, wrap, setFlag, onEnable) => {
      const lab = document.createElement('label'); lab.className = 'model3d-toggle'; lab.style.marginLeft = '10px';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = false;
      const ctrls = wrap.querySelectorAll('select,button,input');
      const sync = () => { for (const el of ctrls) el.disabled = !cb.checked; wrap.style.opacity = cb.checked ? '1' : '0.4'; };
      cb.addEventListener('change', () => { setFlag(cb.checked); sync(); if (cb.checked && onEnable) onEnable(); });
      lab.appendChild(cb); lab.appendChild(document.createTextNode(label));
      bar.appendChild(lab); bar.appendChild(wrap); sync();
    };
    if (exprCtrlWrap.childNodes.length || decoCtrlWrap.childNodes.length) addBreak();
    if (exprCtrlWrap.childNodes.length) addOverrideToggle('表情上書き', exprCtrlWrap, (v) => { st.exprFix = v; }, () => { for (const t of shuffleTargets) t.apply(); });
    if (decoCtrlWrap.childNodes.length) addOverrideToggle('装飾上書き', decoCtrlWrap, (v) => { st.attachFix = v; }, () => { for (const cb of decoCtrlWrap.querySelectorAll('input')) cb.dispatchEvent(new Event('change')); });
    if (!bar.childNodes.length) bar.style.display = 'none';
  }

  function buildCharacterMeshes(T, st, deps) {
    const { model, meshByPath, modelMatByPath, getMat, texMap, mouthAtlasTex, skinnable, fbx, shadeMode, litMode, options, scene } = deps;
    const makeOutline = (mesh, useSkin, skeleton, thick, colArr) => {
      if (!mesh.normals) return null;
      const th = (thick != null) ? thick : (shadeMode === 'game' ? 0 : radius * 0.0025);
      if (!(th > 0)) return null; // 厚さ0(mat_eyes等)や未設定の材質は輪郭を描かない(実機準拠)
      const op = new Float32Array(mesh.positions.length);
      for (let i = 0; i < op.length; i += 3) { op[i] = mesh.positions[i] + mesh.normals[i] * th; op[i + 1] = mesh.positions[i + 1] + mesh.normals[i + 1] * th; op[i + 2] = mesh.positions[i + 2] + mesh.normals[i + 2] * th; }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(op, 3));
      g.setIndex(new T.BufferAttribute(mesh.indices, 1));
      const c = colArr || (shadeMode === 'game' ? [0.345, 0.302, 0.259] : [0.06, 0.06, 0.06]);
      // NOTE: the camera projection X-flip (LH->RH un-mirror) reverses winding, so an inverted-hull outline
      // needs FrontSide here (not the usual BackSide) — otherwise the expanded hull's near faces render
      // and cover the whole character.
      const omat = new T.MeshBasicMaterial({ color: new T.Color(c[0], c[1], c[2]), side: T.FrontSide });
      let o;
      if (useSkin) {
        g.setAttribute('skinIndex', new T.Uint16BufferAttribute(mesh.skinIndex, 4));
        g.setAttribute('skinWeight', new T.Float32BufferAttribute(mesh.skinWeight, 4));
        o = new T.SkinnedMesh(g, omat); o.frustumCulled = false; root.add(o); o.bind(skeleton, new T.Matrix4());
      } else { o = new T.Mesh(g, omat); o.frustumCulled = false; root.add(o); }
      return o;
    };
    const mouthGeoms = [];
    const morphObjs = [];

    const root = new T.Group();
    scene.add(root);

    let skelBones = null;
    if (skinnable) {
      const sk = buildSkeleton(model.avatar);
      skelBones = sk.bones;
      for (const rb of sk.roots) root.add(rb);
    }

    const box = new T.Box3();
    const tmpV = new T.Vector3();
    for (const m of model.meshes) { for (let i = 0; i < m.positions.length; i += 3) box.expandByPoint(tmpV.set(m.positions[i], m.positions[i + 1], m.positions[i + 2])); }
    const center = box.getCenter(new T.Vector3());
    const size = box.getSize(new T.Vector3());
    const radius = Math.max(size.x, size.y, size.z) || 1;

    const stats = { meshes: 0, textured: 0, submeshes: 0, skinned: 0 };
    const meshGroups = {};
    const objBySmr = new Map();
    const weaponObjs = [];
    const weaponRigs = [];
    const renderers = (model.renderers && model.renderers.length) ? model.renderers : model.meshes.map((m) => ({ meshPathID: m.pathID, materialPathIDs: [] }));
    let added = 0;
    for (const r of renderers) {
      const mesh = meshByPath.get(r.meshPathID);
      if (!mesh) continue;
      const firstMat = r.materialPathIDs && r.materialPathIDs[0] ? modelMatByPath.get(r.materialPathIDs[0]) : null;
      const isMouth = /mouth/i.test((firstMat && firstMat.name) || mesh.name || '');
      if (isMouth && !mouthAtlasTex) continue; // no shared mouth atlas available -> skip (avoids a solid color patch)
      const isMouthMesh = isMouth && mouthAtlasTex;
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(mesh.positions, 3));
      if (mesh.normals) geo.setAttribute('normal', new T.BufferAttribute(mesh.normals, 3));
      if (mesh.tangents) geo.setAttribute('aToonTangent', new T.BufferAttribute(mesh.tangents, 3)); // 実ゲームToon異方性ハイライト用
      // 頂点カラーRは実機Toonのリムマスク(in_COLOR0.r)。ただしキャラでR値の性質が異なる:
      //  ・二値(0/1)＝本物のリムマスク → そのまま通す(縁だけ発火＝忠実)
      //  ・連続値＝baked頂点色/AO → リムに使うと肌(明色ColorTex)がoverlayで白飛びするのでゼロ化(リムOFF)。無い場合もゼロ。
      // 判定＝中間値(0.15〜0.85)の割合midFracが大きければ連続値とみなす。
      let toonCol = mesh.colors;
      if (toonCol) {
        let mid = 0, tot = 0;
        for (let i = 0; i < toonCol.length; i += 4) { const r = toonCol[i]; if (r > 0.15 && r < 0.85) mid++; tot++; }
        if (tot && mid / tot > 0.2) toonCol = null; // 連続値(baked色/AO)＝リムマスクではない→リムに使わない
      }
      geo.setAttribute('aToonColor', new T.BufferAttribute(toonCol || new Float32Array((mesh.vertexCount || (mesh.positions.length / 3)) * 4), 4));
      if (mesh.uv) {
        if (isMouthMesh) {
          let vMin = Infinity, vMax = -Infinity;
          for (let i = 1; i < mesh.uv.length; i += 2) { const v = mesh.uv[i]; if (v < vMin) vMin = v; if (v > vMax) vMax = v; }
          const e = MOUTH_EXPRESSIONS[st.mouthExprIdx] || MOUTH_EXPRESSIONS[0];
          geo.setAttribute('uv', new T.BufferAttribute(remapMouthUV(mesh.uv, vMin, vMax, e[1], e[2]), 2));
          mouthGeoms.push({ geo, baseUv: mesh.uv, vMin, vMax });
        } else {
          geo.setAttribute('uv', new T.BufferAttribute(mesh.uv, 2));
        }
      }
      geo.setIndex(new T.BufferAttribute(mesh.indices, 1));
      if (!mesh.normals) geo.computeVertexNormals();

      // blendshapes -> morph targets (set before Mesh construction so influences/dictionary are built)
      let morphFeature = null;
      if (mesh.blendShapes && mesh.blendShapes.length) {
        const morphs = mesh.blendShapes.map((bs) => { const a = new T.BufferAttribute(bs.deltas, 3); a.name = bs.name; return a; });
        geo.morphAttributes.position = morphs;
        geo.morphTargetsRelative = true;
        const cn = mesh.blendShapes[0].name || '';
        if (/^face\./.test(cn)) morphFeature = 'face';
        else if (/^eyebrow\./.test(cn)) morphFeature = 'brow';
      }

      const useSkin = skinnable && mesh.skinIndex && mesh.boneNameHashes && mesh.bindposes;
      if (useSkin) {
        geo.setAttribute('skinIndex', new T.Uint16BufferAttribute(mesh.skinIndex, 4));
        geo.setAttribute('skinWeight', new T.Float32BufferAttribute(mesh.skinWeight, 4));
      }

      const subs = mesh.submeshes && mesh.submeshes.length ? mesh.submeshes : [{ indexStart: 0, indexCount: mesh.indices.length }];
      const mats = [];
      subs.forEach((sm, i) => {
        geo.addGroup(sm.indexStart, sm.indexCount, i);
        const pid = r.materialPathIDs[i] || r.materialPathIDs[0];
        const modelMat = pid ? modelMatByPath.get(pid) : null;
        const mat = getMat(modelMat);
        if (mat.map) stats.textured++;
        mats.push(mat); stats.submeshes++;
      });
      const material = mats.length === 1 ? mats[0] : mats;

      let obj, objSkeleton = null;
      if (useSkin) {
        const meshBones = mesh.boneNameHashes.map((h) => skelBones[model.avatar.hashToIndex.get(h >>> 0)]).filter(Boolean);
        if (meshBones.length === mesh.boneNameHashes.length) {
          const boneInverses = mesh.bindposes.map(mat4FromBindpose);
          objSkeleton = new T.Skeleton(meshBones, boneInverses);
          obj = new T.SkinnedMesh(geo, material);
          obj.frustumCulled = false;
          root.add(obj);
          // pass an explicit (identity) bind matrix: without it SkinnedMesh.bind() calls
          // skeleton.calculateInverses(), overwriting our real bindposes with identity (bones are at rest here)
          obj.bind(objSkeleton, new T.Matrix4());
          stats.skinned++;
        }
      }
      if (!obj) { obj = new T.Mesh(geo, material); obj.frustumCulled = false; root.add(obj); }
      if (r.smrPathID) objBySmr.set(String(r.smrPathID), obj);
      if (morphFeature && obj.morphTargetInfluences) morphObjs.push({ obj, feature: morphFeature });
      // categorize meshes so the game's contextual-only props (flags, presents, effects) don't clutter the idle view:
      //  - base: body/face/hair (always shown)
      //  - outfit: attachments skinned into the outfit via mat_body/mat_head with many bones (wings, capes) -> shown
      //  - prop: attachments with a dedicated mat_attachment, or few-bone effects -> hidden by default, toggleable
      const nm = (mesh.name || '').toLowerCase();
      const boneCount = mesh.boneNameHashes ? mesh.boneNameHashes.length : 0;
      const matName = (firstMat && firstMat.name || '').toLowerCase();
      // 表示可否は実機FBXControllerのattachments[](モーションで表示切替する持ち物/装飾)を権威に判定する。
      // そのリストに載るメッシュ＝motion制御のprop(既定非表示・イベントで表示)、他は本体(常時表示)。
      // リストが無いキャラは名前/材質ヒューリスティックにフォールバック。
      let cat = 'base';
      const attList = fbx.attachmentSmrPathIDs || [];
      if (r.smrPathID && attList.indexOf(String(r.smrPathID)) >= 0) cat = 'prop';
      else if (!attList.length && /attachment/.test(nm)) {
        const outfitMat = /^mat_(body|head|eyes|eyebrows)$/.test(matName);
        cat = (outfitMat && boneCount >= 20) ? 'outfit' : 'prop';
      }
      (meshGroups[cat] || (meshGroups[cat] = [])).push(obj);
      if (cat === 'prop') obj.visible = false;
      // toon outline: 材質単位の厚さで描く(mat_eyes=0/口/眉は輪郭なし)。持ち物(prop)もmat_attachment=0.005は
      // 輪郭を持つので対象に含める(表示時のみ見える)。口アトラスだけ除外。輪郭はobjに紐付け、可視を連動させる。
      if ((shadeMode === 'toon' || shadeMode === 'game') && !isMouthMesh) {
        let th = null, col = null;
        if (shadeMode === 'game') { const tn = texMap.toonByName.get(firstMat && firstMat.name); th = tn ? tn.outlineThickness : null; col = tn && tn.outlineColor; }
        else th = radius * 0.0025;
        const ol = makeOutline(mesh, !!objSkeleton, objSkeleton, th, col);
        if (ol) { ol.visible = obj.visible; obj.__outline = ol; (meshGroups[cat] || (meshGroups[cat] = [])).push(ol); }
      }
      added++; stats.meshes++;
    }

    // equipped weapons: rigid meshes parented to the character's equip anchor.
    // ★装着アンカー＝FBXController.actionPointsのTransform(GO名wp_1/wp_2でslotにマッチ・ルート直下の静的
    // Transform)。ゲームはTryEquip(slot,equipment)でここに装着する。スケルトン骨(.../Weapon_R/wp_2)はアンカーと
    // 別物で向き/位置がずれる(手袋等で顕在化)ため使わない。actionPointsはアニメ非追従(クリップに無い静的アンカー)
    // ＝ゲームと同じ挙動。無ければ骨にフォールバック。
    if (options.weapons && options.weapons.length && (model.actionPoints || (skelBones && model.avatar))) {
      const apMap = model.actionPoints || {};
      const boneBySlot = (slot) => {
        if (!skelBones || !model.avatar) return null;
        const re = new RegExp('/' + slot + '$');
        for (const [h, pth] of model.avatar.tos) { if (re.test(pth)) { const bi = model.avatar.hashToIndex.get(h >>> 0); return (bi != null && skelBones[bi]) || null; } }
        return null;
      };
      // ボーンはこの時点でrest(defPose)姿勢＝rest世界行列を取得しておく(アニメ適用前)
      root.updateMatrixWorld(true);
      // slot名に対応する装着親を返す。actionPoint(装着アンカー)は骨とbind位置一致・向きのみ差異。
      // ∴アニメ追従する骨の下に「offset = inverse(骨rest世界)×アンカー世界」の固定Groupを付ける
      // （＝アンカーの向き/位置で手に密着しつつ手のアニメに追従）。骨が無ければアンカーの静的Group。
      // 返り値 { node, viaAP }。viaAP時は武器メッシュをアンカーに直付け（wroot 180°Yは重ねない
      // ＝ゲームは武器のwpノード(ルート直下・単位)をアンカーに一致させるので、ルートの180°Yは相殺される）。
      const socketBySlot = (slot) => {
        const ap = apMap[slot];
        const bone = boneBySlot(slot);
        if (ap && bone) {
          const apWorld = new T.Matrix4().compose(
            new T.Vector3(ap.pos[0], ap.pos[1], ap.pos[2]),
            new T.Quaternion(ap.rot ? ap.rot[0] : 0, ap.rot ? ap.rot[1] : 0, ap.rot ? ap.rot[2] : 0, ap.rot ? ap.rot[3] : 1),
            new T.Vector3(ap.scale ? ap.scale[0] : 1, ap.scale ? ap.scale[1] : 1, ap.scale ? ap.scale[2] : 1));
          const offset = new T.Matrix4().copy(bone.matrixWorld).invert().multiply(apWorld);
          const g = new T.Group();
          g.matrixAutoUpdate = false; g.matrix.copy(offset);
          bone.add(g);
          return { node: g, viaAP: true };
        }
        if (ap) {
          const g = new T.Group();
          g.position.set(ap.pos[0], ap.pos[1], ap.pos[2]);
          if (ap.rot) g.quaternion.set(ap.rot[0], ap.rot[1], ap.rot[2], ap.rot[3]);
          if (ap.scale) g.scale.set(ap.scale[0], ap.scale[1], ap.scale[2]);
          root.add(g);
          return { node: g, viaAP: true };
        }
        return { node: bone, viaAP: false };
      };
      for (const w of options.weapons) {
        if (!w.model || !w.model.meshes || !w.model.meshes.length) continue;
        const socketInfo = socketBySlot(w.slot || 'wp_2');
        const socket = socketInfo.node, viaAP = socketInfo.viaAP;
        const wparent = socket || root;
        const wTex = buildTextureMap(w.materials || { materials: [], textures: [] });
        // 骨フォールバック時のみ武器ルート(180°Y)を適用。AP装着時は適用しない（アンカーで向き確定・
        // 武器wpノードがルート＝180°Yは相殺されるため。重ねると手袋等が逆向きになる）。
        const wroot = viaAP ? null : (w.model.transforms || []).find((t) => t.fatherPathID === '0' || t.fatherPathID === 0);
        const s = w.scale || 1;
        // 武器が自前avatarのスキン鎖を持つ場合のみskeleton+skin化(例:数珠=55ボーンの垂れ鎖)。剛体武器(大半)は従来の静的経路のまま(skeletonを作らない)。docsの「武器=ボーン無し静的」は誤り。
        const wAvatar = w.model.avatar;
        const wCanSkin = !!(wAvatar && wAvatar.count && wAvatar.hashToIndex);
        let wBones = null, wrig = null;
        for (const mesh of w.model.meshes) {
          const geo = new T.BufferGeometry();
          geo.setAttribute('position', new T.BufferAttribute(mesh.positions, 3));
          if (mesh.normals) geo.setAttribute('normal', new T.BufferAttribute(mesh.normals, 3));
          if (mesh.uv) geo.setAttribute('uv', new T.BufferAttribute(mesh.uv, 2));
          geo.setIndex(new T.BufferAttribute(mesh.indices, 1));
          if (!mesh.normals) geo.computeVertexNormals();
          const wmName = (w.model.materials && w.model.materials[0] && w.model.materials[0].name) || 'mat_weapon';
          const wt = wTex.byName.get(wmName) || wTex.fallback;
          const params = { side: T.DoubleSide };
          if (wt) params.map = makeDataTexture(wt, false, true); else params.color = new T.Color(0xcccccc); // 武器色テクスチャもalphaは陰影値→不透明固定(透過して消えるのを防ぐ)
          let wmat;
          if (litMode) { params.roughness = 0.9; params.metalness = 0.0; wmat = new T.MeshStandardMaterial(params); }
          else wmat = new T.MeshBasicMaterial(params);
          let wobj = null;
          if (wCanSkin && mesh.skinIndex && mesh.boneNameHashes && mesh.bindposes) {
            if (!wrig) { try { wBones = buildSkeleton(wAvatar); wrig = new T.Group(); for (const rb of wBones.roots) wrig.add(rb); if (s !== 1) wrig.scale.setScalar(s); wparent.add(wrig); } catch (e) { wBones = null; wrig = null; } }
            const meshBones = wrig ? mesh.boneNameHashes.map((h) => wBones.bones[wAvatar.hashToIndex.get(h >>> 0)]).filter(Boolean) : [];
            if (wrig && meshBones.length === mesh.boneNameHashes.length) {
              geo.setAttribute('skinIndex', new T.Uint16BufferAttribute(mesh.skinIndex, 4));
              geo.setAttribute('skinWeight', new T.Float32BufferAttribute(mesh.skinWeight, 4));
              wobj = new T.SkinnedMesh(geo, wmat);
              wobj.frustumCulled = false;
              wrig.add(wobj);
              wobj.bind(new T.Skeleton(meshBones, mesh.bindposes.map(mat4FromBindpose)), new T.Matrix4());
              stats.skinned++;
            }
          }
          if (!wobj) {
            wobj = new T.Mesh(geo, wmat);
            wobj.frustumCulled = false;
            if (wroot) {
              wobj.position.set(wroot.pos[0], wroot.pos[1], wroot.pos[2]);
              wobj.quaternion.set(wroot.rot[0], wroot.rot[1], wroot.rot[2], wroot.rot[3]);
              wobj.scale.set(wroot.scale[0] * s, wroot.scale[1] * s, wroot.scale[2] * s);
            } else if (s !== 1) wobj.scale.setScalar(s);
            wparent.add(wobj);
          }
          (meshGroups.weapon || (meshGroups.weapon = [])).push(wobj);
          weaponObjs.push(wobj);
          added++; stats.meshes++;
        }
        // スキン武器: 本体モーションに同期して武器も動く(数珠の垂れ/揺れは武器クリップに焼込済)。武器skeleton専用mixer＋
        // 同名クリップの遅延ビルドgetterをrig登録し、createPlaybackのstartActionが本体クリップと同名で同期再生する。
        if (wrig && wBones) {
          const wClips = w.model.clips || [];
          const wValid = new Set((wAvatar.hashes || []).map((h) => h >>> 0));
          const wClipCache = new Map();
          const getWClip = (name) => {
            if (wClipCache.has(name)) return wClipCache.get(name);
            const c = wClips.find((x) => x.name === name) || wClips.find((x) => x.name && x.name.toLowerCase() === String(name).toLowerCase());
            let tc = null; if (c && c.buildTracks) { try { tc = buildThreeClip(c, 60, wValid); } catch (e) {} }
            wClipCache.set(name, tc); return tc;
          };
          weaponRigs.push({ mixer: new T.AnimationMixer(wrig), get: getWClip, cur: null, bones: wBones.bones, defPose: wAvatar.defPose });
        }
      }
    }
    return { root, skelBones, radius, center, box, meshGroups, mouthGeoms, morphObjs, objBySmr, weaponObjs, weaponRigs, stats, added };
  }

  function render(hostEl, model, materialBundle, opt) {
    const T = THREE();
    if (!T) return { ok: false, reason: 'three-not-loaded' };
    if (!model || !model.meshes || !model.meshes.length) return { ok: false, reason: 'no-meshes' };
    const options = opt || {};
    const st = { mixer: null, action: null, playing: true, curClip: null, exprFix: false, attachFix: false, playSpeed: 1,
      baseClipIdx: -1, idleActionActive: false, idleClock: 0, idleNext: 10 /* 実機idleActionTime実測=10s固定 */,
      mouthExprIdx: 0, mouthCellKey: '', blinkClock: 0, blinkNext: 2.5, playBtn: null, clipSelect: null };
    const skinnable = !!(model.avatar && model.avatar.count && model.meshes.some((m) => m.skinIndex && m.boneNameHashes));

    hostEl.innerHTML = '';
    const bar = document.createElement('div');
    bar.className = 'model3d-controls';
    hostEl.appendChild(bar);
    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'model3d-canvas';
    hostEl.appendChild(canvasWrap);

    // サイズはCSS(.model3d-canvasのwidth/aspect-ratio)が決める。ここは実寸を読むだけ。
    const W = canvasWrap.clientWidth || hostEl.clientWidth || 400;
    const H = canvasWrap.clientHeight || Math.round(W * 4 / 3);

    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(35, W / H, 0.01, 100);
    // Unity is left-handed, three.js is right-handed: loading Unity vertex/bone data verbatim renders the
    // whole model mirrored left<->right vs the game. Flip the projection X to un-mirror uniformly (applies
    // once at screen level -> works for skinned meshes + bone-attached weapons alike, and leaves view-space
    // lighting untouched). DoubleSide materials keep faces visible despite the reversed winding.
    const _updateProj = camera.updateProjectionMatrix.bind(camera);
    camera.updateProjectionMatrix = function () { _updateProj(); camera.projectionMatrix.elements[0] *= -1; };
    camera.updateProjectionMatrix();
    const renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(W, H, false); // updateStyle=false: 表示サイズはCSS(canvas inset:0/100%)が担当、ここは描画バッファのみ
    renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
    if ('outputColorSpace' in renderer) renderer.outputColorSpace = T.SRGBColorSpace || 'srgb';
    else renderer.outputEncoding = T.sRGBEncoding;
    canvasWrap.appendChild(renderer.domElement);

    // shading mode: 'game'(実ゲーム準拠＝ToonShader再現: _ColorTex基本色＋_ShadowTexハード影バンド＋暗茶輪郭)
    // / 'toon'(unlit＋黒輪郭) / 'unlit'(素) / 'pbr'(シーン陰影)。
    const shadeMode = (options.shading && options.shading.mode) || 'game';
    const litMode = shadeMode === 'pbr';
    // 実ゲーム準拠(game)のみ実VolumeProfile(ビネット＋微コントラスト)を後処理で再現。他モードは素通し。
    // 背景(bg_common_system=クリーム地＋円形紋様・1136x640)は後処理RT内に描き、キャラと同じビネット/コントラストを
    // 通す(CSS背景だと後処理が掛からず相対的に白飛びして見えるため)。抽出元: backgrounds_assets_backgrounds/
    // bg_common_system(DXT5Crunched)を復号しextension/data/stage/ に同梱。CSSはフォールバック(未ロード/後処理不可時)。
    let postPass = null;
    if (shadeMode === 'game') {
      const bgUrl = (globalThis.chrome && chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL('data/stage/bg_common_system.png') : 'data/stage/bg_common_system.png';
      const bgTex = sharedBgTexture(T, bgUrl);
      try { postPass = buildPostPass(renderer, bgTex, 1136 / 640); } catch (e) { postPass = null; }
      canvasWrap.style.background = "#e7ddca url('" + bgUrl + "') center / cover no-repeat";
    }
    // 研究/比較用の任意オーバーライド(既定は実グレード=忠実値)。postExposure(実機authored -0.17・override OFF)や
    // ハイライト実値(sharp105/intensity0.5)を差し込んで見比べるため。未指定なら何も変えない。
    const OVR = options.overrides || {};
    if (postPass && OVR.postExposure != null) postPass.uniforms.uExposure.value = OVR.postExposure;
    // 実ゲームの光源＝organization3dpreviewerプレハブのFrontDirectionalLight(Directional・白・intensity1・
    // forward=+Z・仰角なしの純正面光)。我々はメッシュverbatimロード＋カメラを+Z(キャラ正面)に置くので、正面を
    // 照らす向き＝表面→光=(0,0,+1)を使う(実機値-forward=(0,0,-1)から符号のみ我々の座標系へ実測補正)。
    // 実機値＝organization3dpreviewerプレハブのFrontDirectionalLightを厳密抽出: Transform回転=単位
    // (FrontDirectionalLight→RootObject→Organization3dPreviewer全てidentity)＝world forward=(0,0,1)の
    // 純正面光・仰角/振りゼロ。表面→光=我々の座標系で(0,0,1)。form陰影はNdotLでなく_ShadowTex/回転で出る。
    const TOON_LIGHT = [0, 0, 1];
    // シーン光源はpbrモード(MeshStandardMaterial)専用。game/toon/unlitはMeshBasicMaterialで光源を無視するので追加しない。
    if (litMode) {
      scene.add(new T.AmbientLight(0xffffff, 0.85));
      const dir = new T.DirectionalLight(0xffffff, 0.7); dir.position.set(0.5, 1, 1); scene.add(dir);
      const dir2 = new T.DirectionalLight(0xffffff, 0.35); dir2.position.set(-0.5, 0.5, -1); scene.add(dir2);
    }

    const texMap = buildTextureMap(materialBundle || { materials: [], textures: [] });
    const meshByPath = new Map(model.meshes.map((m) => [m.pathID, m]));
    const modelMatByPath = new Map((model.materials || []).map((m) => [m.pathID, m]));
    // 口アトラスはキャラのmouthMaterialOverride(None/Fanged/SharkTeeth/Secondary)で差し替え。variant欠落時は既定にフォールバック。
    const mouthMatOverride = (model.fbx && model.fbx.mouthMaterialOverride) || 0;
    const mouthVariant = (options.mouthAtlas && options.mouthAtlas.variants && options.mouthAtlas.variants[mouthMatOverride]) || options.mouthAtlas;
    const mouthAtlasTex = mouthVariant && mouthVariant.rgba ? makeDataTexture(mouthVariant) : null;

    // 実ゲーム準拠(game)＝MeshBasicMaterial(色そのまま)にonBeforeCompileでToonShaderを★実シェーダGLSLから
    // 忠実移植した式で注入(抽出: PPShaders/ToonShaderフラグメント)。diffuseColor=_ColorTex(map)を基準に:
    //  ①影: NdotLのsmoothstep境界(threshold±gradation)で _ShadowTex↔_ColorTexをlerp・mask.Rで分岐。
    //  ②ハイライト(髪光沢): 異方性(Kajiya-Kay) S=normalize(-N*hp+tangent)、hp=(mask.B*0.5+0.5)*noise+pos、
    //     H=normalize(L+V)、band=4x(1-x)(x=dot(S,H)*0.5+0.5)、hi=pow(band,sharpness)*intensity*mask.G。
    //     視点(V=camera-worldPos)依存＝角度で移動。リムとmax合成→_HighlightColorとオーバーレイ合成をhiでmix。
    //  normal/tangent/viewのvaryingが要る＝skinnedメッシュで有効(vToonWNの長さで分岐)。
    const matFactory = createMaterialFactory(T, { texMap, shadeMode, litMode, OVR, TOON_LIGHT, mouthAtlasTex });
    const getMat = matFactory.getMat;
    // inverted-hull outline: 実機OutlineパスGLSL(pos+normalize(normal)*_OutlineThickness・オブジェクト空間)＋色
    // _OutlineColor。厚さは材質単位(mat_body/mat_head=0.005・mat_eyes=0)＝各メッシュ自身の材質値を使い、厚さ0/
    // 未設定の材質は輪郭を描かない(目/口/眉は輪郭なし)。toonモードは黒・radius基準。radiusはこの下(枠取り)で
    // 定義するがmakeOutline/呼出はその後に走るので参照可(トップレベルで即評価するとTDZ)。
    const exprBase = (n) => String(n || '').replace(/_[RL]$/, '');
    const fbx = (model && model.fbx) || {};
    const built = buildCharacterMeshes(T, st, { model, meshByPath, modelMatByPath, getMat, texMap, mouthAtlasTex, skinnable, fbx, shadeMode, litMode, options, scene });
    if (!built.added) return { ok: false, reason: 'no-renderable-mesh' };
    const { root, skelBones, radius, center, box, meshGroups, mouthGeoms, morphObjs, objBySmr, weaponObjs, weaponRigs, stats } = built;

    // ★実ゲームのキャラ詳細と同じ操作系＝カメラ/ライトは前方固定で「モデル側」を回す。カメラ周回＋ワールド
    // 固定ライトだと裏面(-Z側)が常に暗くなる(実ゲームはそうならない)。前方固定光の下でモデルを回せば、カメラに
    // 向いた面が常に前＝常に光が当たり暗い面が出ない。回転はモデルの中心(center)周りに行う(root原点周りだと偏心)。
    const state = { yaw: 0, pitch: 0.05, dist: radius * 2.2, target: center.clone() };
    const applyCam = () => {
      camera.position.set(state.target.x, state.target.y, state.target.z + state.dist);
      camera.lookAt(state.target);
    };
    const applyRot = () => {
      root.rotation.set(state.pitch, state.yaw, 0);
      const rc = center.clone().applyEuler(root.rotation);
      root.position.copy(center).sub(rc);
    };
    applyCam();
    applyRot();

    const fps = 60;
    const clips = (skinnable && model.clips && model.clips.length) ? model.clips : [];
    const validBones = new Set(((model.avatar && model.avatar.hashes) || []).map((h) => h >>> 0));
    const threeClipCache = new Map();
    const getThreeClip = (idx) => { if (!threeClipCache.has(idx)) threeClipCache.set(idx, buildThreeClip(clips[idx], fps, validBones)); return threeClipCache.get(idx); };
    // Idleループ中に定期的にIdleActionを1回差し込む(実機FBXController.idleActionTimer相当＝アイドルの表情/仕草)。
    const idleIdx = clips.findIndex((c) => /^idle$/i.test(c.name));
    const idleActionIdx = clips.findIndex((c) => /^idleaction$/i.test(c.name));
    const playback = createPlayback(T, st, { getThreeClip, clips, idleActionIdx, root, skelBones, model, weaponRigs });
    const { playClip, restPose, playIdleActionOnce } = playback;
    const expr = createExpression(T, st, { mouthGeoms, morphObjs, weaponObjs, objBySmr, fbx, remapMouthUV, exprBase });
    const { applyClipExpr, updateBlink, applyMouthIndex } = expr;
    if (mouthGeoms.length) applyMouthIndex(fbx.defaultMouthId > 0 ? fbx.defaultMouthId : 6);

    buildControls(st, { bar, hostEl, canvasWrap, clips, mouthGeoms, morphObjs, mouthAtlasTex, model, fbx, meshGroups, shadeMode, options, exprBase, W, H, renderer, camera, playClip, restPose, applyMouthIndex });

    // オーラ(VFX ParticleSystem)＝任意。装着キャラのroot直下に置き毎フレームtick(本体回転に追従)。
    let auraFx = null;
    if (options.auraBytes && globalThis.TP_PARTICLES) {
      try { auraFx = globalThis.TP_PARTICLES.createAura(options.auraBytes, { texByMatPid: options.auraTexMap || null }); if (auraFx) root.add(auraFx.group); } catch (e) { console.warn('aura', e); }
    }
    // リサイズ=CSSが決めたcanvasWrap実寸をrendererへ渡すだけ(通常/全画面/ウィンドウ幅すべて共通)。
    const resize = () => { const w = canvasWrap.clientWidth, h = canvasWrap.clientHeight; if (w < 2 || h < 2) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    let roView = null;
    if ('ResizeObserver' in globalThis) { roView = new ResizeObserver(resize); roView.observe(canvasWrap); }
    document.addEventListener('fullscreenchange', resize);

    let dragging = false, panning = false, lx = 0, ly = 0;
    const el = renderer.domElement;
    el.style.touchAction = 'none'; el.style.cursor = 'grab';
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      lx = e.clientX; ly = e.clientY;
      if (e.button === 2 || e.button === 1) { panning = true; el.style.cursor = 'move'; }
      else { dragging = true; el.style.cursor = 'grabbing'; }
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointerup', (e) => { dragging = false; panning = false; el.style.cursor = 'grab'; try { el.releasePointerCapture(e.pointerId); } catch (x) {} });
    el.addEventListener('pointermove', (e) => {
      const dx = e.clientX - lx, dy = e.clientY - ly;
      if (dragging) {
        state.yaw += dx * 0.01;
        state.pitch += dy * 0.01;
        state.pitch = Math.max(-1.0, Math.min(1.0, state.pitch));
        lx = e.clientX; ly = e.clientY; applyRot();
      } else if (panning) {
        const panScale = state.dist * 0.0018;
        const right = new T.Vector3().setFromMatrixColumn(camera.matrix, 0);
        const up = new T.Vector3().setFromMatrixColumn(camera.matrix, 1);
        state.target.addScaledVector(right, -dx * panScale);
        state.target.addScaledVector(up, dy * panScale);
        lx = e.clientX; ly = e.clientY; applyCam();
      }
    });
    el.addEventListener('wheel', (e) => { e.preventDefault(); state.dist *= (1 + Math.sign(e.deltaY) * 0.1); state.dist = Math.max(radius * 0.5, Math.min(radius * 8, state.dist)); applyCam(); }, { passive: false });


    let alive = true;
    // ★同一ページ上で複数のWebGL+rAFループ(立ち絵Spine×複数＋この3D)が並走すると、メイン
    // スレッド/GPU競合でフレーム間隔が跳ね(実測16.7ms→p95 130ms超のスパイク)、再生が終始
    // カクつく。ビューポート外の間は描画/アニメ更新をスキップして競合を無くす(表示に戻れば自動再開)。
    let onScreen = true;
    const io = ('IntersectionObserver' in globalThis) ? new IntersectionObserver((ents) => { onScreen = ents.some((e) => e.isIntersecting); }, { threshold: 0 }) : null;
    if (io) io.observe(canvasWrap);
    let lastT = (globalThis.performance && performance.now()) ? performance.now() : 0;
    const loop = () => {
      if (!alive) return;
      const now = (globalThis.performance && performance.now()) ? performance.now() : lastT + 16;
      const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
      if (onScreen && !(globalThis.document && globalThis.document.hidden)) {
        if (st.mixer && st.playing && st.action) {
          st.mixer.update(dt);
          for (const rig of weaponRigs) { rig.mixer.timeScale = st.playSpeed; rig.mixer.update(dt); }
          if (!st.idleActionActive && idleActionIdx >= 0 && st.baseClipIdx === idleIdx) { st.idleClock += dt; if (st.idleClock >= st.idleNext) playIdleActionOnce(); }
          const faceDriven = applyClipExpr(); updateBlink(dt, faceDriven || st.exprFix);
        }
        if (auraFx) auraFx.update(dt);
        if (postPass) postPass.render(scene, camera); else renderer.render(scene, camera);
      }
      globalThis.requestAnimationFrame(loop);
    };
    loop();

    const dispose = () => {
      alive = false;
      if (io) io.disconnect();
      if (roView) roView.disconnect();
      document.removeEventListener('fullscreenchange', resize);
      if (document.fullscreenElement === hostEl) { try { document.exitFullscreen(); } catch (e) {} }
      if (st.mixer) st.mixer.stopAllAction();
      if (auraFx) { try { auraFx.dispose(); } catch (e) {} }
      if (postPass) { try { postPass.dispose(); } catch (e) {} }
      renderer.dispose();
      matFactory.dispose();
      root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      if (renderer.domElement && renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };

    return { ok: true, stats, animated: clips.length > 0, clipNames: clips.map((c) => c.name), bbox: { min: box.min.toArray(), max: box.max.toArray() }, dispose };
  }

  globalThis.TP_MODEL3D = { render };
})();
