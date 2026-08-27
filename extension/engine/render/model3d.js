import { model3dLib } from './model3d-lib.js';
import { assetStore } from '../../data/asset-store.js';
import { ensureIndexes } from '../../data/index-store.js';
import { unityMesh } from '../../unity/mesh.js';
import { texCodec } from '../../unity/texcodec.js';
import { auraRenderer } from './vfx-aura.js';
import { guardRenderer } from './gl-manager.js';
import { DIRS } from '../../core/constants.js';
import { utilHelpers } from '../../core/util.js';
import { el, append } from '../../core/dom.js';
import { buildGroupedVisPanel } from '../../core/vis-panel.js';
import { createPartControl } from './model-parts.js';
import * as THREE_NS from '../../vendor/three.module.js';
const { sharedBgTexture, setSharedBgFromRgba, buildTextureMap, MOUTH_EXPRESSIONS, remapMouthUV, makeDataTexture, TP_TO_LINEAR, buildPostPass, buildThreeSkeleton, mat4FromBindpose, buildThreeClip } =
  model3dLib;

// ガンマ色空間の実ゲームに合わせ、色は生値のまま演算して出力直前だけリニアへ戻す。
const rawColor = (T, a) => new T.Color(a[0], a[1], a[2]);
const gammaOut = (mat, cacheKey) => {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(mat, shader, renderer);
    shader.fragmentShader = TP_TO_LINEAR + shader.fragmentShader.replace('#include <opaque_fragment>', 'outgoingLight = tpToLinear( outgoingLight );\n#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => cacheKey;
  return mat;
};
const hexRgb = (s) => {
  const m = /^#?([0-9a-fA-F]{3,8})$/.exec(String(s || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4)
    h = h
      .slice(0, 3)
      .split('')
      .map((c) => c + c)
      .join('');
  if (h.length < 6) return null;
  const n = parseInt(h.slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const attachmentEmission = (cfg) => {
  const rgb = hexRgb(cfg && cfg.colorcode);
  if (!rgb) return null;
  const k = Math.pow(2, Number(cfg.intensity) || 0);
  return rgb.map((c) => c * k);
};

let _bgCssUrl = null;
const applyBgCss = (wrap) => {
  if (wrap && _bgCssUrl) {
    wrap.style.backgroundImage = "url('" + _bgCssUrl + "')";
    wrap.style.backgroundSize = 'cover';
    wrap.style.backgroundPosition = 'center';
  }
};
async function ensureBgCommon(wrap) {
  applyBgCss(wrap);
  if (_bgCssUrl) return;
  try {
    const idx = await ensureIndexes();
    const rel = idx && idx.assets && idx.assets.globalAssets && idx.assets.globalAssets.stage && idx.assets.globalAssets.stage.bgCommon;
    if (!rel) return;
    const bytes = await assetStore.readAsset(DIRS.shared, rel);
    if (!bytes) return;
    const dec = unityMesh.decodeTextureRgba(bytes);
    if (!dec || !dec.rgba) return;
    setSharedBgFromRgba(dec.rgba, dec.width, dec.height);
    try {
      _bgCssUrl = texCodec.renderRgbaToCanvas(dec.rgba, dec.width, dec.height).toDataURL('image/png');
    } catch (e) {}
    applyBgCss(wrap);
  } catch (e) {}
}

function createMaterialFactory(T, deps) {
  const { texMap, TOON_LIGHT, MAIN_LIGHT_COLOR, mouthAtlasTex } = deps;
  const mainLight = MAIN_LIGHT_COLOR || [1, 1, 1];
  const shadowTexCache = new Map(),
    maskTexCache = new Map();
  const bundleIds = new WeakMap();
  let bundleSeq = 0;
  const bid = (tm) => {
    let n = bundleIds.get(tm);
    if (!n) {
      n = ++bundleSeq;
      bundleIds.set(tm, n);
    }
    return n;
  };
  const applyToonShadow = (mat, name, tmap, emOverride) => {
    const p = tmap.toonByName.get(name) || {};
    const ck = bid(tmap) + '|' + name;
    const shadowRgba = tmap.shadowByName.get(name);
    let shadowTex = null;
    if (shadowRgba) {
      if (!shadowTexCache.has(ck)) shadowTexCache.set(ck, makeDataTexture(shadowRgba));
      shadowTex = shadowTexCache.get(ck);
    }
    const maskRgba = tmap.maskByName.get(name);
    let maskTex = null;
    if (maskRgba) {
      if (!maskTexCache.has(ck)) maskTexCache.set(ck, makeDataTexture(maskRgba));
      maskTex = maskTexCache.get(ck);
    }
    const hc = p.highlightColor || [1, 1, 1, 1];
    const em = emOverride || p.emissionColor || [0, 0, 0, 0];
    const co = p.colorOverride || [1, 1, 1, 1];
    const num = (v, d) => (v != null ? v : d);
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        uShadowTex: { value: shadowTex || mat.map },
        uHasShadow: { value: shadowTex ? 1 : 0 },
        uMaskTex: { value: maskTex || mat.map },
        uHasMask: { value: maskTex ? 1 : 0 },
        uLightDir: { value: new T.Vector3(TOON_LIGHT[0], TOON_LIGHT[1], TOON_LIGHT[2]) },
        uShadowThreshold: { value: num(p.shadowBorderThreshold, 0.05) },
        uShadowGrad: { value: num(p.shadowBorderGradation, 0.0) },
        uShadowWeight: { value: num(p.shadowColorWeight, 0.3) },
        uHiColor: { value: new T.Vector3(hc[0], hc[1], hc[2]) },
        uHiIntensity: { value: num(p.highlightIntensity, 0.5) },
        uHiSharp: { value: num(p.highlightSharpness, 105) },
        uHiPos: { value: num(p.highlightPosition, -0.5) },
        uHiNoise: { value: num(p.highlightNoiseIntensity, 0.2) },
        uFresnel: { value: num(p.fresnel, 0.0) },
        uRimThreshold: { value: num(p.rimLightThreshold, 0.04) },
        uRimStrength: { value: 1.0 },
        uEmission: { value: new T.Vector3(em[0], em[1], em[2]) },
        uColorOverride: { value: new T.Vector4(co[0], co[1], co[2], co[3] != null ? co[3] : 1) },
        uMainLight: { value: new T.Vector3(mainLight[0], mainLight[1], mainLight[2]) },
      });
      shader.vertexShader =
        'attribute vec3 aToonTangent;\nattribute vec4 aToonColor;\nvarying vec3 vToonWN;\nvarying vec3 vToonVD;\nvarying vec3 vToonTAN;\nvarying vec4 vToonCol;\nvarying vec2 vToonUv;\n' +
        shader.vertexShader
          .replace('#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )', '#if 1')
          .replace(
            '#include <defaultnormal_vertex>',
            '#include <defaultnormal_vertex>\n\tvToonWN = normalize( mat3( modelMatrix ) * objectNormal );\n\tvec3 toonTan = aToonTangent;\n\t#ifdef USE_SKINNING\n\t\ttoonTan = mat3( skinMatrix ) * toonTan;\n\t#endif\n\tvToonTAN = mat3( modelMatrix ) * toonTan;\n\tvToonCol = aToonColor;',
          )
          .replace('#include <project_vertex>', '#include <project_vertex>\n\tvToonVD = normalize( cameraPosition - ( modelMatrix * vec4( transformed, 1.0 ) ).xyz );\n\tvToonUv = uv;');
      const inject = [
        'if (dot(vToonWN, vToonWN) > 0.5) {',
        '  vec3 N = vToonWN;',
        '  vec3 Vd = vToonVD;',
        '  vec3 Ld = normalize(uLightDir);',
        '  float ndl = dot(N, Ld);',
        '  vec4 maskT = (uHasMask > 0.5) ? texture2D(uMaskTex, vToonUv) : vec4(0.0, 0.0, 0.0, 1.0);',
        '  vec3 mask = maskT.rgb;',
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
        '  float hiF = max(((rim >= uRimThreshold) ? uRimStrength : 0.0) * vToonCol.r, hiBand);',
        '  vec3 cTex = diffuseColor.rgb;',
        '  vec3 baseCol = diffuseColor.rgb;',
        '  if (uHasShadow > 0.5) {',
        '    float bw = max(2.0 * uShadowGrad, 1e-4);',
        '    float s = clamp((ndl - uShadowThreshold + uShadowGrad) / bw, 0.0, 1.0);',
        '    s = s * s * (3.0 - 2.0 * s);',
        '    vec3 shTex = texture2D(uShadowTex, vToonUv).rgb;',
        '    float sf = (mask.r < 0.5) ? s : (-(1.0 - s) * uShadowWeight);',
        '    baseCol = shTex + sf * (diffuseColor.rgb - shTex);',
        '  }',
        '  vec3 lo2 = 2.0 * cTex * uHiColor;',
        '  vec3 hi2 = 1.0 - 2.0 * (1.0 - cTex) * (1.0 - uHiColor);',
        '  vec3 ov = mix(lo2, hi2, step(vec3(0.5), cTex)) * uMainLight;',
        '  baseCol *= uMainLight * uColorOverride.rgb;',
        '  diffuseColor.rgb = mix(baseCol, ov, hiF);',
        '  diffuseColor.rgb += uEmission * maskT.a;',
        '  diffuseColor.a *= uColorOverride.a;',
        '}',
      ].join('\n');
      shader.fragmentShader =
        'uniform sampler2D uShadowTex, uMaskTex;\nuniform float uHasShadow, uHasMask, uShadowThreshold, uShadowGrad, uShadowWeight, uHiIntensity, uHiSharp, uHiPos, uHiNoise, uFresnel, uRimThreshold, uRimStrength;\nuniform vec3 uLightDir, uHiColor, uEmission, uMainLight;\nuniform vec4 uColorOverride;\nvarying vec3 vToonWN;\nvarying vec3 vToonVD;\nvarying vec3 vToonTAN;\nvarying vec4 vToonCol;\nvarying vec2 vToonUv;\n' +
        shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + inject);
    };
  };

  const texCache = new Map();
  const getMat = (modelMat, tmap, emOverride) => {
    tmap = tmap || texMap;
    const name = modelMat ? modelMat.name : null;
    const key = bid(tmap) + '|' + ((modelMat && modelMat.pathID) || name || '__fallback') + (emOverride ? '|em' + emOverride.join(',') : '');
    if (texCache.has(key)) return texCache.get(key);
    const ownTex = name ? tmap.byName.get(name) : null;
    const isMouth = /mouth|month/i.test(name || '');
    // キャラ材質は全て ToonShader・_Cull=2(Back)・完全不透明。three は巻きが反転するので BackSide（設計資料_viewer.md）。
    const params = { side: T.BackSide };
    if (isMouth && mouthAtlasTex) {
      params.map = mouthAtlasTex;
      params.alphaTest = 0.5;
    } else if (ownTex) {
      params.map = makeDataTexture(ownTex, { forceOpaque: true });
    } else if (tmap.fallback) {
      params.map = makeDataTexture(tmap.fallback, { forceOpaque: true });
    } else if (modelMat && modelMat.color) params.color = rawColor(T, modelMat.color);
    else params.color = new T.Color(0xcccccc);
    const mat = new T.MeshBasicMaterial(params);
    const tn = tmap.toonByName.get(name);
    const toon = !isMouth && tn && (tn.colorTexPathID || tn.shadowTexPathID || tn.shadowBorderThreshold != null);
    if (toon) applyToonShadow(mat, name, tmap, emOverride);
    gammaOut(mat, toon ? 'tp-toonshadow' : 'tp-gamma');
    texCache.set(key, mat);
    return mat;
  };
  return {
    getMat,
    dispose() {
      texCache.forEach((m) => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
      shadowTexCache.forEach((t) => t.dispose());
      maskTexCache.forEach((t) => t.dispose());
      texCache.clear();
      shadowTexCache.clear();
      maskTexCache.clear();
    },
  };
}

function createPlayback(T, st, deps) {
  const { getThreeClip, clips, root, skelBones, model, weaponRigs } = deps;
  const XFADE = 0.12;
  const syncWeapons = (name, loopOnce) => {
    if (!weaponRigs || !weaponRigs.length || !name) return;
    for (const rig of weaponRigs) {
      const tc = rig.get(name);
      if (!tc) continue;
      const wa = rig.mixer.clipAction(tc);
      wa.reset();
      if (loopOnce) {
        wa.setLoop(T.LoopOnce, 1);
        wa.clampWhenFinished = true;
      } else wa.setLoop(T.LoopRepeat, Infinity);
      wa.enabled = true;
      wa.setEffectiveWeight(1);
      wa.play();
      if (rig.cur && rig.cur !== wa) wa.crossFadeFrom(rig.cur, XFADE, false);
      rig.cur = wa;
    }
  };
  const startAction = (idx, loopOnce) => {
    const next = st.mixer.clipAction(getThreeClip(idx));
    next.reset();
    if (loopOnce) {
      next.setLoop(T.LoopOnce, 1);
      next.clampWhenFinished = true;
    } else {
      next.setLoop(T.LoopRepeat, Infinity);
    }
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    if (st.action && st.action !== next) next.crossFadeFrom(st.action, XFADE, false);
    st.action = next;
    st.curClip = clips[idx];
    syncWeapons(clips[idx] && clips[idx].name, loopOnce);
    return next;
  };
  const playClip = (idx) => {
    if (!clips.length) return;
    if (!st.mixer) st.mixer = new T.AnimationMixer(root);
    st.mixer.timeScale = st.playSpeed;
    startAction(idx, false);
    st.mixer.update(0);
    st.playing = true;
    if (st.playBtn) st.playBtn.textContent = '⏸';
  };
  const setDefPose = (bones, defPose) => {
    if (!bones || !defPose) return;
    for (let i = 0; i < bones.length; i++) {
      const dp = defPose[i],
        b = bones[i];
      if (!dp || !b) continue;
      b.position.set(dp.t[0], dp.t[1], dp.t[2]);
      b.quaternion.set(dp.q[0], dp.q[1], dp.q[2], dp.q[3]);
      b.scale.set(dp.s[0], dp.s[1], dp.s[2]);
    }
  };
  const restPose = () => {
    if (st.mixer) st.mixer.stopAllAction();
    st.action = null;
    st.curClip = null;
    if (skelBones && model.avatar) setDefPose(skelBones, model.avatar.defPose);
    if (weaponRigs)
      for (const rig of weaponRigs) {
        rig.mixer.stopAllAction();
        rig.cur = null;
        setDefPose(rig.bones, rig.defPose);
      }
    if (st.playBtn) st.playBtn.textContent = '▶';
  };
  return { playClip, restPose };
}

const EMPTY_FIXED = new Set();

function createExpression(T, st, deps) {
  const { mouthGeoms, morphObjs, weaponObjs, objBySmr, attachBase, fbx, remapMouthUV, exprBase } = deps;
  const applyMouthCell = (col, row) => {
    const k = col + ',' + row;
    if (k === st.mouthCellKey) return;
    st.mouthCellKey = k;
    for (const mg of mouthGeoms) {
      const uv = remapMouthUV(mg.baseUv, mg.vMin, mg.vMax, col, row);
      mg.geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
      mg.geo.attributes.uv.needsUpdate = true;
    }
  };
  const evalBlend = (evs, t) => {
    let val = 0;
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      if (t < e.time) break;
      if (e.dur > 0 && t < e.time + e.dur) {
        const prev = i > 0 ? evs[i - 1].weight : 0;
        return prev + (e.weight - prev) * ((t - e.time) / e.dur);
      }
      val = e.weight;
    }
    return val;
  };
  const applyClipExpr = () => {
    const clip = st.curClip;
    if (!clip || !clip.events || !clip.events.length || !st.action) return false;
    const dur = clip.duration || 1;
    let t = st.action.time || 0;
    if (dur > 0) t = ((t % dur) + dur) % dur;
    let faceDriven = false;
    const fixed = st.exprFixed || EMPTY_FIXED;
    if (!st.exprFix) {
      const byTarget = new Map();
      let mouthDriven = false;
      for (const e of clip.events) {
        if (e.type === 'blend') {
          let a = byTarget.get(e.target);
          if (!a) byTarget.set(e.target, (a = []));
          a.push(e);
        } else if (e.type === 'mouth') mouthDriven = true;
      }
      const drivenFeat = new Set();
      for (const tg of byTarget.keys()) {
        if (/^face\./.test(tg)) drivenFeat.add('face');
        else if (/^eyebrow\./.test(tg)) drivenFeat.add('brow');
      }
      for (const mt of morphObjs) {
        const infl = mt.obj.morphTargetInfluences;
        if (!infl || fixed.has(mt.feature)) continue;
        for (let i = 0; i < infl.length; i++) infl[i] = 0;
        const baseMap = mt.feature === 'face' ? fbx.faceBaseValues : mt.feature === 'brow' ? fbx.browBaseValues : null;
        const bv = baseMap && baseMap[clip.name];
        if (bv) for (let i = 0; i < infl.length && i < bv.length; i++) infl[i] = (bv[i] || 0) / 100;
        if (drivenFeat.has(mt.feature) && !fixed.has(mt.feature)) {
          const dict = mt.obj.morphTargetDictionary || {};
          for (const [tg, evs] of byTarget) {
            const w = evalBlend(evs, t);
            for (const nm in dict) {
              if (nm === tg || exprBase(nm) === tg) infl[dict[nm]] = w;
            }
          }
        }
      }
      if (mouthDriven && mouthGeoms.length && !fixed.has('mouth')) {
        let idx = null;
        for (const e of clip.events) {
          if (e.time > t) break;
          if (e.type === 'mouth') idx = e.index;
        }
        if (idx != null) applyMouthIndex(idx);
      }
      faceDriven = drivenFeat.has('face') && !fixed.has('face');
    }
    if (!st.attachFix) {
      if (weaponObjs.length) {
        let show = true;
        for (const e of clip.events) {
          if (e.time > t) break;
          if (e.type === 'weapon') show = e.show;
        }
        for (const w of weaponObjs) {
          w.visible = show;
          if (w.__outline) w.__outline.visible = show;
        }
      }
      if (objBySmr.size && (fbx.attachmentSmrPathIDs || []).length) {
        const shown = new Map();
        for (const e of clip.events) {
          if (e.time > t) break;
          if (e.type === 'attach') shown.set(e.index, e.show);
        }
        for (let i = 0; i < fbx.attachmentSmrPathIDs.length; i++) {
          const smr = fbx.attachmentSmrPathIDs[i];
          const o = smr && objBySmr.get(String(smr));
          if (!o) continue;
          const show = shown.has(i) ? shown.get(i) : attachBase.has(String(smr));
          o.visible = show;
          if (o.__outline) o.__outline.visible = show;
        }
      }
    }
    return faceDriven;
  };
  const applyMouthIndex = (idx) => {
    const i0 = Math.max(0, (idx | 0) - 1);
    applyMouthCell(i0 % 5, 4 - Math.floor(i0 / 5));
  };

  const faceMorph = () => {
    const m = morphObjs.find((x) => x.feature === 'face');
    return m ? m.obj : null;
  };
  const blinkIdx = (fbx.blinkBlendShapes || []).filter((i) => i >= 0);
  const updateBlink = (dt, clipDrivesFace) => {
    const fo = faceMorph();
    if (!fo || !fo.morphTargetInfluences || !blinkIdx.length) return;
    if (clipDrivesFace) {
      st.blinkClock = 0;
      return;
    }
    st.blinkClock += dt;
    let w = 0;
    const into = st.blinkClock - st.blinkNext;
    if (into >= 0) {
      const D = 0.16;
      if (into < D) {
        const h = into / (D / 2);
        w = h < 1 ? h : 2 - h;
        if (w < 0) w = 0;
      } else {
        st.blinkClock = 0;
        st.blinkNext = 2.0 + Math.random() * 2.5;
        w = 0;
      }
    }
    for (const i of blinkIdx) if (i < fo.morphTargetInfluences.length) fo.morphTargetInfluences[i] = w;
  };
  return { applyClipExpr, updateBlink, applyMouthIndex };
}

const PITCH_LIMIT = Math.PI / 2;
const POSE_VALUE = '__boon';
const SPEED_OPTIONS = [
  ['0.25', '0.25x'],
  ['0.5', '0.5x'],
  ['1', '1x'],
  ['1.5', '1.5x'],
  ['2', '2x'],
];
const PART_GROUPS = [
  ['weapon', '武器'],
  ['prop', '小物'],
];
const costumeLabel = (v) => (v === 'default' ? '標準' : v === 'default_g' ? '標準(金)' : v);

function addSelect(parent, labelText, entries, value, onChange, warn) {
  const sel = el(
    'select',
    { class: 'model3d-clip', on: { change: () => onChange(sel.value) } },
    entries.map(([v, t]) => el('option', { value: String(v), text: String(t) })),
  );
  sel.value = String(value);
  const label = el('span', 'model3d-lbl', labelText);
  if (warn) label.appendChild(el('span', 'model3d-warn', warn));
  append(parent, [label, sel]);
  return sel;
}

function addIconButton(parent, glyph, hint, onClick) {
  const btn = el('button', { class: 'model3d-play', text: glyph, title: hint, on: { click: () => onClick(btn) } });
  parent.appendChild(btn);
  return btn;
}

function addCheckbox(parent, labelText, extraClass, checked, onChange) {
  const cb = el('input', { type: 'checkbox', checked, on: { change: () => onChange(cb.checked) } });
  parent.appendChild(el('label', 'model3d-toggle' + (extraClass ? ' ' + extraClass : ''), [cb, document.createTextNode(labelText)]));
  return cb;
}

function buildControls(st, deps) {
  const { bar, hostEl, clips, mouthGeoms, morphObjs, mouthAtlasTex, model, fbx, meshGroups, options, exprBase, playClip, restPose, applyMouthIndex, postPass } = deps;
  const addBreak = () => bar.appendChild(el('div', 'model3d-break'));
  const addGroup = () => {
    const g = el('span', 'model3d-group');
    bar.appendChild(g);
    return g;
  };

  if (clips.length) {
    const prefer = clips.findIndex((c) => /^idle$/i.test(c.name));
    const defIdx = prefer >= 0 ? prefer : 0;
    if (!options.hidePlaybackUI) {
      const gMotion = addGroup();
      st.clipSelect = addSelect(gMotion, 'モーション', [...clips.map((c, i) => [i, `${c.name} (${c.duration.toFixed(1)}s)`]), [POSE_VALUE, '⊂二二二( ^ω^)二⊃ブーン']], defIdx, (v) => {
        if (v === POSE_VALUE) {
          restPose();
          if (options.onClip) options.onClip(POSE_VALUE);
          return;
        }
        const idx = Number(v);
        playClip(idx);
        const mv = options.motionVoice;
        if (mv && mv.enabled && clips[idx]) mv.onMotion(clips[idx].name);
        if (options.onClip && clips[idx]) options.onClip(clips[idx].name);
      });
      st.playBtn = addIconButton(gMotion, '⏸', null, (btn) => {
        if (!st.action) return;
        st.playing = !st.playing;
        st.action.paused = !st.playing;
        btn.textContent = st.playing ? '⏸' : '▶';
      });
      addSelect(gMotion, '速度', SPEED_OPTIONS, '1', (v) => {
        st.playSpeed = Number(v) || 1;
        if (st.mixer) st.mixer.timeScale = st.playSpeed;
        if (options.onSpeed) options.onSpeed(st.playSpeed);
      });
    }
    playClip(defIdx);
  }

  hostEl.style.position = 'relative';
  addIconButton(hostEl, '⛶', '全画面', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (hostEl.requestFullscreen) hostEl.requestFullscreen();
  }).classList.add('model3d-full');

  const shuffleTargets = [];
  const exprCtrlWrap = el('span', 'model3d-group');
  const decoCtrlWrap = el('span', 'model3d-group');

  if (mouthGeoms.length && mouthAtlasTex) {
    let usedMouth = [...new Set((model.clips || []).flatMap((c) => (c.events || []).filter((e) => e.type === 'mouth').map((e) => e.index)))].filter((i) => i >= 1 && i <= 25).sort((a, b) => a - b);
    const defMouth = fbx.defaultMouthId > 0 ? fbx.defaultMouthId : 6;
    if (!usedMouth.length) usedMouth = [defMouth];
    else if (!usedMouth.includes(defMouth)) usedMouth.unshift(defMouth);
    const apply = () => {
      st.mouthCellKey = '';
      if (sel.value === '') {
        fixedFeat.delete('mouth');
        applyMouthIndex(defMouth);
        return;
      }
      fixedFeat.add('mouth');
      applyMouthIndex(Number(sel.value));
    };
    const sel = addSelect(exprCtrlWrap, '口', [['', '-'], ...usedMouth.map((i) => [i, i])], '', apply);
    shuffleTargets.push({ sel, apply });
  }

  const applyExpr = (feature, base) => {
    for (const mt of morphObjs) {
      if (mt.feature !== feature) continue;
      const infl = mt.obj.morphTargetInfluences;
      const dict = mt.obj.morphTargetDictionary || {};
      if (!infl) continue;
      for (let i = 0; i < infl.length; i++) infl[i] = 0;
      if (base)
        for (const nm in dict) {
          if (exprBase(nm) === base) infl[dict[nm]] = 1;
        }
    }
  };
  const fixedFeat = st.exprFixed || (st.exprFixed = new Set());
  const addExprSelector = (feature, labelText) => {
    const bases = [];
    for (const mt of morphObjs) {
      if (mt.feature !== feature) continue;
      for (const nm in mt.obj.morphTargetDictionary || {}) {
        const b = exprBase(nm);
        if (!bases.includes(b)) bases.push(b);
      }
    }
    if (!bases.length) return;
    const apply = () => {
      if (sel.value === '') fixedFeat.delete(feature);
      else fixedFeat.add(feature);
      applyExpr(feature, sel.value);
    };
    const sel = addSelect(exprCtrlWrap, labelText, [['', '-'], ...bases.map((b, i) => [b, i + 1])], '', apply);
    shuffleTargets.push({ sel, apply });
  };
  addExprSelector('face', '目');
  addExprSelector('brow', '眉');

  if (shuffleTargets.length) {
    addIconButton(exprCtrlWrap, '🎲', 'ランダム表情', () => {
      for (const t of shuffleTargets) {
        if (!t.sel.options.length) continue;
        t.sel.selectedIndex = Math.floor(Math.random() * t.sel.options.length);
        t.apply();
      }
    });
  }

  const aura = options.auraRenderer;
  const voice = options.motionVoice;
  const hasAura = !!(aura && (aura.list || []).length && typeof aura.onChange === 'function');
  if (hasAura || voice) {
    const gAura = addGroup();
    if (hasAura) addSelect(gAura, 'オーラ', [['', 'なし'], ...aura.list.map((a) => [a.rel, a.label])], aura.current || '', (v) => aura.onChange(v), '（バグあり）');
    if (voice) addCheckbox(gAura, 'ボイス再生', null, !!voice.enabled, (on) => voice.onToggle(on));
  }
  if (postPass && typeof postPass.setBloom === 'function') {
    const gB = addGroup();
    addCheckbox(gB, 'Bloom', null, !!postPass.bloomDefaultOn, (on) => postPass.setBloom(on));
  }

  addBreak();

  const costume = options.costume;
  if (costume && (costume.list || []).length > 1) {
    addSelect(
      addGroup(),
      '服装',
      costume.list.map((v) => [v, costumeLabel(v)]),
      costume.current,
      (v) => {
        if (typeof costume.onChange === 'function') costume.onChange(v);
      },
    );
  }

  const setVisible = (objs, pick) =>
    objs.forEach((o, i) => {
      o.visible = pick(i);
      if (o.__outline) o.__outline.visible = o.visible;
    });
  const addVisToggle = (labelText, objs) =>
    addCheckbox(
      decoCtrlWrap,
      labelText,
      null,
      objs.some((o) => o.visible),
      (on) => setVisible(objs, () => on),
    );
  const addVisSelect = (labelText, objs) => {
    const first = objs.findIndex((o) => o.visible);
    const entries = [['', 'なし'], ...objs.map((o, i) => [i, (o.__emOverride ? '★発光 ' : '') + (o.name || '#' + (i + 1))]), ['*', 'すべて']];
    addSelect(decoCtrlWrap, labelText, entries, objs.every((o) => o.visible) ? '*' : first >= 0 ? String(first) : '', (v) => setVisible(objs, (i) => v === '*' || v === String(i)));
  };
  if (!options.hidePartsUI) {
    for (const [cat, labelText] of PART_GROUPS) {
      const objs = meshGroups[cat];
      if (!objs || !objs.length) continue;
      if (objs.length < 2) addVisToggle(labelText, objs);
      else addVisSelect(labelText, objs);
    }
  }

  const addOverrideToggle = (labelText, wrap, setFlag, onEnable) => {
    const ctrls = wrap.querySelectorAll('select,button,input');
    const g = addGroup();
    let on = false;
    const sync = () => {
      for (const c of ctrls) c.disabled = !on;
      wrap.style.opacity = on ? '1' : '0.4';
    };
    addCheckbox(g, labelText, 'override', false, (checked) => {
      on = checked;
      setFlag(checked);
      sync();
      if (checked && onEnable) onEnable();
    });
    g.appendChild(wrap);
    sync();
  };
  if (exprCtrlWrap.childNodes.length || decoCtrlWrap.childNodes.length) addBreak();
  if (exprCtrlWrap.childNodes.length) addGroup().appendChild(exprCtrlWrap);
  if (decoCtrlWrap.childNodes.length)
    addOverrideToggle(
      '装飾上書き',
      decoCtrlWrap,
      (v) => {
        st.attachFix = v;
      },
      () => {
        for (const cb of decoCtrlWrap.querySelectorAll('input')) cb.dispatchEvent(new Event('change'));
      },
    );
  if (!bar.childNodes.length) bar.style.display = 'none';
}

function buildCharacterMeshes(T, st, deps) {
  const { model, meshByPath, modelMatByPath, getMat, texMap, mouthAtlasTex, skinnable, fbx, options, scene } = deps;
  const attachNums = Array.isArray(options.attachments) ? new Set(options.attachments.map(Number)) : null;
  const attachBase = new Set();
  const attachWanted = (nm) => {
    if (!attachNums) return false;
    const m = String(nm).match(/attachment_(\d+)/);
    return !!(m && attachNums.has(Number(m[1])));
  };
  const addSkin = (g, um) => {
    g.setAttribute('skinIndex', new T.Uint16BufferAttribute(um.skinIndex, 4));
    g.setAttribute('skinWeight', new T.Float32BufferAttribute(um.skinWeight, 4));
  };
  const applyToonAttrs = (g, um) => {
    g.setAttribute('position', new T.BufferAttribute(um.positions, 3));
    if (um.normals) g.setAttribute('normal', new T.BufferAttribute(um.normals, 3));
    const hiVec = um.binormals || um.tangents;
    if (hiVec) g.setAttribute('aToonTangent', new T.BufferAttribute(hiVec, 3));
    g.setAttribute('aToonColor', new T.BufferAttribute(um.colors || new Float32Array((um.vertexCount || um.positions.length / 3) * 4).fill(1), 4));
  };
  const skinScaleOf = (unityMesh, skeleton) => {
    if (!skeleton || !skeleton.bones || !skeleton.boneInverses || !unityMesh.skinIndex || !unityMesh.skinWeight) return 1;
    const used = new Set();
    for (let i = 0; i < unityMesh.skinIndex.length; i++) if (unityMesh.skinWeight[i] > 0) used.add(unityMesh.skinIndex[i]);
    const m = new T.Matrix4();
    let sum = 0,
      cnt = 0;
    for (const j of used) {
      const b = skeleton.bones[j],
        bi = skeleton.boneInverses[j];
      if (!b || !bi) continue;
      b.updateWorldMatrix(true, false);
      m.multiplyMatrices(b.matrixWorld, bi);
      const e = m.elements;
      const s = (Math.hypot(e[0], e[1], e[2]) + Math.hypot(e[4], e[5], e[6]) + Math.hypot(e[8], e[9], e[10])) / 3;
      if (s > 0) {
        sum += s;
        cnt++;
      }
    }
    return cnt ? sum / cnt : 1;
  };
  const makeOutline = (unityMesh, useSkin, skeleton, thick, colArr, parent) => {
    if (!unityMesh.normals) return null;
    if (!(thick > 0)) return null;
    const sc = useSkin ? skinScaleOf(unityMesh, skeleton) : 1;
    const th = sc > 1e-4 ? thick / sc : thick;
    const op = new Float32Array(unityMesh.positions.length);
    for (let i = 0; i < op.length; i += 3) {
      op[i] = unityMesh.positions[i] + unityMesh.normals[i] * th;
      op[i + 1] = unityMesh.positions[i + 1] + unityMesh.normals[i + 1] * th;
      op[i + 2] = unityMesh.positions[i + 2] + unityMesh.normals[i + 2] * th;
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(op, 3));
    g.setIndex(new T.BufferAttribute(unityMesh.indices, 1));
    const c = colArr || [0.345, 0.302, 0.259];
    const omat = gammaOut(new T.MeshBasicMaterial({ color: rawColor(T, c), side: T.FrontSide }), 'tp-outline');
    let o;
    const par = parent || root;
    if (useSkin) {
      addSkin(g, unityMesh);
      o = new T.SkinnedMesh(g, omat);
      o.frustumCulled = false;
      par.add(o);
      o.bind(skeleton, new T.Matrix4());
    } else {
      o = new T.Mesh(g, omat);
      o.frustumCulled = false;
      par.add(o);
    }
    return o;
  };
  const mouthGeoms = [];
  const morphObjs = [];
  const partTargets = [];
  const boneNameByHash = new Map();
  if (model.avatar && model.avatar.tos) for (const [h, p] of model.avatar.tos) boneNameByHash.set(h >>> 0, String(p).split('/').pop());
  const boneName = (h) => boneNameByHash.get(h >>> 0) || 'bone' + (h >>> 0);

  const root = new T.Group();
  scene.add(root);

  let skelBones = null;
  if (skinnable) {
    const sk = buildThreeSkeleton(model.avatar);
    skelBones = sk.bones;
    for (const rb of sk.roots) root.add(rb);
  }

  const hidden = texMap.hiddenByName || new Set();
  const skipMesh = (firstMat) => !!firstMat && hidden.has(firstMat.name);

  const box = new T.Box3();
  const tmpV = new T.Vector3();
  const hiddenMeshPaths = new Set();
  for (const r of model.renderers || []) {
    const first = r.materialPathIDs && r.materialPathIDs[0] ? modelMatByPath.get(r.materialPathIDs[0]) : null;
    if (skipMesh(first)) hiddenMeshPaths.add(String(r.meshPathID));
  }
  for (const m of model.meshes) {
    if (hiddenMeshPaths.has(String(m.pathID))) continue;
    for (let i = 0; i < m.positions.length; i += 3) box.expandByPoint(tmpV.set(m.positions[i], m.positions[i + 1], m.positions[i + 2]));
  }
  const center = box.getCenter(new T.Vector3());
  const size = box.getSize(new T.Vector3());
  const radius = Math.max(size.x, size.y, size.z) || 1;

  const stats = { meshes: 0, textured: 0, submeshes: 0, skinned: 0 };
  const meshGroups = {};
  const objBySmr = new Map();
  const weaponObjs = [];
  const weaponRigs = [];
  const renderers = model.renderers && model.renderers.length ? model.renderers : model.meshes.map((m) => ({ meshPathID: m.pathID, materialPathIDs: [] }));
  const emByAttachNum = new Map();
  const emBySmr = new Map();
  for (const cfg of options.attachmentColors || []) {
    const em = attachmentEmission(cfg);
    if (!em) continue;
    for (const n of cfg.attachments || []) {
      emByAttachNum.set(Number(n), em);
      const smr = (fbx.attachmentSmrPathIDs || [])[Number(n) - 1];
      if (smr) emBySmr.set(String(smr), em);
    }
  }
  const emissionFor = (unityMesh, r) => {
    if (!emByAttachNum.size) return null;
    const m = String((unityMesh && unityMesh.name) || '').match(/attachment_(\d+)/);
    return (m && emByAttachNum.get(Number(m[1]))) || (r.smrPathID ? emBySmr.get(String(r.smrPathID)) : null) || null;
  };
  let added = 0;
  for (const r of renderers) {
    const unityMesh = meshByPath.get(r.meshPathID);
    if (!unityMesh) continue;
    const firstMat = r.materialPathIDs && r.materialPathIDs[0] ? modelMatByPath.get(r.materialPathIDs[0]) : null;
    if (skipMesh(firstMat)) continue;
    const isMouth = /mouth|month/i.test((firstMat && firstMat.name) || unityMesh.name || '');
    if (isMouth && !mouthAtlasTex) continue;
    const isMouthMesh = isMouth && mouthAtlasTex;
    const geo = new T.BufferGeometry();
    applyToonAttrs(geo, unityMesh);
    if (unityMesh.uv) {
      if (isMouthMesh) {
        let vMin = Infinity,
          vMax = -Infinity;
        for (let i = 1; i < unityMesh.uv.length; i += 2) {
          const v = unityMesh.uv[i];
          if (v < vMin) vMin = v;
          if (v > vMax) vMax = v;
        }
        const e = MOUTH_EXPRESSIONS[st.mouthExprIdx] || MOUTH_EXPRESSIONS[0];
        geo.setAttribute('uv', new T.BufferAttribute(remapMouthUV(unityMesh.uv, vMin, vMax, e[1], e[2]), 2));
        mouthGeoms.push({ geo, baseUv: unityMesh.uv, vMin, vMax });
      } else {
        geo.setAttribute('uv', new T.BufferAttribute(unityMesh.uv, 2));
      }
    }
    geo.setIndex(new T.BufferAttribute(unityMesh.indices, 1));
    if (!unityMesh.normals) geo.computeVertexNormals();

    let morphFeature = null;
    if (unityMesh.blendShapes && unityMesh.blendShapes.length) {
      const morphs = unityMesh.blendShapes.map((bs) => {
        const a = new T.BufferAttribute(bs.deltas, 3);
        a.name = bs.name;
        return a;
      });
      geo.morphAttributes.position = morphs;
      geo.morphTargetsRelative = true;
      const cn = unityMesh.blendShapes[0].name || '';
      if (/^face\./.test(cn)) morphFeature = 'face';
      else if (/^eyebrow\./.test(cn)) morphFeature = 'brow';
    }

    const useSkin = skinnable && unityMesh.skinIndex && unityMesh.boneNameHashes && unityMesh.bindposes;
    if (useSkin) addSkin(geo, unityMesh);

    const subs = unityMesh.submeshes && unityMesh.submeshes.length ? unityMesh.submeshes : [{ indexStart: 0, indexCount: unityMesh.indices.length }];
    const mats = [];
    const emOv = emissionFor(unityMesh, r);
    subs.forEach((sm, i) => {
      geo.addGroup(sm.indexStart, sm.indexCount, i);
      const pid = r.materialPathIDs[i] || r.materialPathIDs[0];
      const modelMat = pid ? modelMatByPath.get(pid) : null;
      const mat = getMat(modelMat, null, i === 0 ? emOv : null);
      if (mat.map) stats.textured++;
      mats.push(mat);
      stats.submeshes++;
    });
    const material = mats.length === 1 ? mats[0] : mats;

    let obj,
      objSkeleton = null;
    if (useSkin) {
      const meshBones = unityMesh.boneNameHashes.map((h) => skelBones[model.avatar.hashToIndex.get(h >>> 0)]).filter(Boolean);
      if (meshBones.length === unityMesh.boneNameHashes.length) {
        const boneInverses = unityMesh.bindposes.map(mat4FromBindpose);
        objSkeleton = new T.Skeleton(meshBones, boneInverses);
        obj = new T.SkinnedMesh(geo, material);
        obj.frustumCulled = false;
        root.add(obj);
        obj.bind(objSkeleton, new T.Matrix4());
        stats.skinned++;
      }
    }
    if (!obj) {
      obj = new T.Mesh(geo, material);
      obj.frustumCulled = false;
      root.add(obj);
    }
    obj.name = unityMesh.name || '';
    if (emOv) obj.__emOverride = true;
    if (r.smrPathID) objBySmr.set(String(r.smrPathID), obj);
    if (morphFeature && obj.morphTargetInfluences) morphObjs.push({ obj, feature: morphFeature });
    const nm = (unityMesh.name || '').toLowerCase();
    const attList = fbx.attachmentSmrPathIDs || [];
    const isAttach = (r.smrPathID && attList.indexOf(String(r.smrPathID)) >= 0) || (!attList.length && /attachment/.test(nm));
    const cat = isAttach ? 'prop' : 'base';
    (meshGroups[cat] || (meshGroups[cat] = [])).push(obj);
    if (cat === 'prop') {
      obj.visible = attachWanted(nm);
      if (obj.visible && r.smrPathID) attachBase.add(String(r.smrPathID));
    }
    if (!isMouthMesh) {
      let th = null,
        col = null;
      for (const pid of r.materialPathIDs && r.materialPathIDs.length ? r.materialPathIDs : [firstMat && firstMat.pathID]) {
        const m = pid ? modelMatByPath.get(pid) : null;
        const tn = texMap.toonByName.get(m && m.name);
        if (!tn || !(tn.outlineThickness > 0)) continue;
        if (th == null || tn.outlineThickness > th) {
          th = tn.outlineThickness;
          col = tn.outlineColor;
        }
      }
      const ol = makeOutline(unityMesh, !!objSkeleton, objSkeleton, th, col);
      if (ol) {
        ol.visible = obj.visible;
        obj.__outline = ol;
        (meshGroups[cat] || (meshGroups[cat] = [])).push(ol);
      }
      if (cat === 'base' && objSkeleton) partTargets.push({ obj, outline: ol, unityMesh, mats, boneName });
    }
    added++;
    stats.meshes++;
  }

  const weaponAttach = options.weaponAttach || 'anchor';
  if (weaponAttach !== 'none' && options.weapons && options.weapons.length && (model.actionPoints || (skelBones && model.avatar))) {
    const apMap = weaponAttach === 'bone' ? {} : model.actionPoints || {};
    const boneBySlot = (slot) => {
      if (!skelBones || !model.avatar) return null;
      const re = new RegExp('/' + slot + '$');
      for (const [h, pth] of model.avatar.tos) {
        if (re.test(pth)) {
          const bi = model.avatar.hashToIndex.get(h >>> 0);
          return (bi != null && skelBones[bi]) || null;
        }
      }
      return null;
    };
    root.updateMatrixWorld(true);
    const socketBySlot = (slot) => {
      const ap = apMap[slot];
      const bone = boneBySlot(slot);
      if (ap && bone) {
        const apWorld = new T.Matrix4().compose(
          new T.Vector3(ap.pos[0], ap.pos[1], ap.pos[2]),
          new T.Quaternion(ap.rot ? ap.rot[0] : 0, ap.rot ? ap.rot[1] : 0, ap.rot ? ap.rot[2] : 0, ap.rot ? ap.rot[3] : 1),
          new T.Vector3(ap.scale ? ap.scale[0] : 1, ap.scale ? ap.scale[1] : 1, ap.scale ? ap.scale[2] : 1),
        );
        const offset = new T.Matrix4().copy(bone.matrixWorld).invert().multiply(apWorld);
        const g = new T.Group();
        g.matrixAutoUpdate = false;
        g.matrix.copy(offset);
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
      const socket = socketInfo.node,
        viaAP = socketInfo.viaAP;
      const wparent = socket || root;
      const wTex = buildTextureMap(w.materials || { materials: [], textures: [] });
      const s = w.scale || 1;
      const wAvatar = w.model.avatar;
      const wCanSkin = !!(wAvatar && wAvatar.count && wAvatar.hashToIndex);
      let wBones = null,
        wrig = null;
      const wMat0 = (w.model.materials && w.model.materials[0]) || { name: 'mat_weapon' };
      const wToon = wTex.toonByName.get(wMat0.name);
      for (const unityMesh of w.model.meshes) {
        const geo = new T.BufferGeometry();
        applyToonAttrs(geo, unityMesh);
        if (unityMesh.uv) geo.setAttribute('uv', new T.BufferAttribute(unityMesh.uv, 2));
        geo.setIndex(new T.BufferAttribute(unityMesh.indices, 1));
        if (!unityMesh.normals) geo.computeVertexNormals();
        const wmat = getMat(wMat0, wTex);
        let wobj = null,
          wOutlineSkel = null;
        if (wCanSkin && unityMesh.skinIndex && unityMesh.boneNameHashes && unityMesh.bindposes) {
          if (!wrig) {
            try {
              wBones = buildThreeSkeleton(wAvatar);
              wrig = new T.Group();
              for (const rb of wBones.roots) wrig.add(rb);
              if (s !== 1) wrig.scale.setScalar(s);
              wparent.add(wrig);
            } catch (e) {
              wBones = null;
              wrig = null;
            }
          }
          const meshBones = wrig ? unityMesh.boneNameHashes.map((h) => wBones.bones[wAvatar.hashToIndex.get(h >>> 0)]).filter(Boolean) : [];
          if (wrig && meshBones.length === unityMesh.boneNameHashes.length) {
            addSkin(geo, unityMesh);
            wobj = new T.SkinnedMesh(geo, wmat);
            wobj.frustumCulled = false;
            wrig.add(wobj);
            wOutlineSkel = new T.Skeleton(meshBones, unityMesh.bindposes.map(mat4FromBindpose));
            wobj.bind(wOutlineSkel, new T.Matrix4());
            stats.skinned++;
          }
        }
        if (!wobj) {
          wobj = new T.Mesh(geo, wmat);
          wobj.frustumCulled = false;
          if (s !== 1) wobj.scale.setScalar(s);
          wparent.add(wobj);
        }
        const wol = makeOutline(unityMesh, !!wOutlineSkel, wOutlineSkel, wToon ? wToon.outlineThickness : null, wToon && wToon.outlineColor, wOutlineSkel ? wrig : wobj);
        if (wol) {
          wol.visible = wobj.visible;
          wobj.__outline = wol;
          (meshGroups.weapon || (meshGroups.weapon = [])).push(wol);
        }
        (meshGroups.weapon || (meshGroups.weapon = [])).push(wobj);
        weaponObjs.push(wobj);
        added++;
        stats.meshes++;
      }
      if (wrig && wBones) {
        const wClips = w.model.clips || [];
        const wValid = new Set((wAvatar.hashes || []).map((h) => h >>> 0));
        const wClipCache = new Map();
        const getWClip = (name) => {
          if (wClipCache.has(name)) return wClipCache.get(name);
          const c = wClips.find((x) => x.name === name) || wClips.find((x) => x.name && x.name.toLowerCase() === String(name).toLowerCase());
          let tc = null;
          if (c && c.buildTracks) {
            try {
              tc = buildThreeClip(c, 60, wValid);
            } catch (e) {}
          }
          wClipCache.set(name, tc);
          return tc;
        };
        weaponRigs.push({ mixer: new T.AnimationMixer(wrig), get: getWClip, cur: null, bones: wBones.bones, defPose: wAvatar.defPose });
      }
    }
  }
  return { root, skelBones, radius, center, box, meshGroups, mouthGeoms, morphObjs, objBySmr, attachBase, weaponObjs, weaponRigs, stats, added, partTargets };
}

function render(hostEl, model, materialBundle, opt) {
  if (!THREE_NS) return { ok: false, reason: 'three-not-loaded' };
  if (THREE_NS.ColorManagement) THREE_NS.ColorManagement.enabled = true;

  if (!model || !model.meshes || !model.meshes.length) return { ok: false, reason: 'no-meshes' };
  const options = opt || {};
  const st = {
    mixer: null,
    action: null,
    playing: true,
    curClip: null,
    exprFix: false,
    exprFixed: new Set(),
    attachFix: false,
    playSpeed: 1,
    mouthExprIdx: 0,
    mouthCellKey: '',
    blinkClock: 0,
    blinkNext: 2.5,
    playBtn: null,
    clipSelect: null,
  };
  const skinnable = !!(model.avatar && model.avatar.count && model.meshes.some((m) => m.skinIndex && m.boneNameHashes));

  hostEl.innerHTML = '';
  const bar = el('div', 'model3d-controls');
  const canvasWrap = el('div', 'model3d-canvas');
  append(hostEl, [bar, canvasWrap]);
  const applyWrapHeight = () => {
    if (options.height > 0) canvasWrap.style.height = document.fullscreenElement === hostEl ? '' : options.height + 'px';
  };
  applyWrapHeight();

  const W = canvasWrap.clientWidth || hostEl.clientWidth || 400;
  const H = canvasWrap.clientHeight || Math.round((W * 4) / 3);

  const scene = new THREE_NS.Scene();
  const camera = new THREE_NS.PerspectiveCamera(30, W / H, 0.01, 100);
  const _updateProj = camera.updateProjectionMatrix.bind(camera);
  camera.updateProjectionMatrix = function () {
    _updateProj();
    camera.projectionMatrix.elements[0] *= -1;
  };
  camera.updateProjectionMatrix();
  const renderer = new THREE_NS.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(W, H, false);
  renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE_NS.SRGBColorSpace || 'srgb';
  canvasWrap.appendChild(renderer.domElement);

  let postPass = null;
  const bgTex = sharedBgTexture(THREE_NS);
  try {
    postPass = buildPostPass(renderer, bgTex, 1136 / 640);
  } catch (e) {
    postPass = null;
  }
  canvasWrap.style.background = '#e7ddca';
  ensureBgCommon(canvasWrap);
  const TOON_LIGHT = [0.2962, 0.5, 0.8138];

  const texMap = buildTextureMap(materialBundle || { materials: [], textures: [] });
  const meshByPath = new Map(model.meshes.map((m) => [m.pathID, m]));
  const modelMatByPath = new Map((model.materials || []).map((m) => [m.pathID, m]));
  const mouthMatOverride = (model.fbx && model.fbx.mouthMaterialOverride) || 0;
  const mouthVariant = (options.mouthAtlas && options.mouthAtlas.variants && options.mouthAtlas.variants[mouthMatOverride]) || options.mouthAtlas;
  const mouthAtlasTex = mouthVariant && mouthVariant.rgba ? makeDataTexture(mouthVariant) : null;

  const matFactory = createMaterialFactory(THREE_NS, { texMap, TOON_LIGHT, mouthAtlasTex });
  const getMat = matFactory.getMat;
  const exprBase = (n) => String(n || '').replace(/_[RL]$/, '');
  const fbx = (model && model.fbx) || {};
  const built = buildCharacterMeshes(THREE_NS, st, { model, meshByPath, modelMatByPath, getMat, texMap, mouthAtlasTex, skinnable, fbx, options, scene });
  if (!built.added) {
    if (postPass) {
      try {
        postPass.dispose();
      } catch (e) {}
    }
    try {
      renderer.forceContextLoss();
    } catch (e) {}
    renderer.dispose();
    matFactory.dispose();
    if (mouthAtlasTex) mouthAtlasTex.dispose();
    if (built.root)
      built.root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
    if (renderer.domElement && renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    hostEl.innerHTML = '';
    return { ok: false, reason: 'no-renderable-unityMesh' };
  }
  const { root, skelBones, radius, center, box, meshGroups, mouthGeoms, morphObjs, objBySmr, attachBase, weaponObjs, weaponRigs, stats } = built;
  // 深度プリパスの床面を足元(bbox最小Y)に置く＝床から立ち上る soft-particle オーラの床際フェード用(box確定後に設定)。
  if (postPass && postPass.setFloorY && box && isFinite(box.min.y)) postPass.setFloorY(box.min.y);

  const state = { yaw: ((fbx.rotationOverrideY || 0) * Math.PI) / 180, pitch: 0.05, dist: radius * 2.2, target: center.clone() };
  camera.near = Math.max(0.01, radius / 1000);
  camera.far = Math.max(100, radius * 12);
  camera.updateProjectionMatrix();
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
  const clips = skinnable && model.clips && model.clips.length ? model.clips : [];
  const validBones = new Set(((model.avatar && model.avatar.hashes) || []).map((h) => h >>> 0));
  const threeClipCache = new Map();
  const getThreeClip = (idx) => {
    if (!threeClipCache.has(idx)) threeClipCache.set(idx, buildThreeClip(clips[idx], fps, validBones));
    return threeClipCache.get(idx);
  };
  const playback = createPlayback(THREE_NS, st, { getThreeClip, clips, root, skelBones, model, weaponRigs });
  const { playClip, restPose } = playback;
  const expr = createExpression(THREE_NS, st, { mouthGeoms, morphObjs, weaponObjs, objBySmr, attachBase, fbx, remapMouthUV, exprBase });
  const { applyClipExpr, updateBlink, applyMouthIndex } = expr;
  if (mouthGeoms.length) applyMouthIndex(fbx.defaultMouthId > 0 ? fbx.defaultMouthId : 6);

  buildControls(st, {
    bar,
    hostEl,
    canvasWrap,
    clips,
    mouthGeoms,
    morphObjs,
    mouthAtlasTex,
    model,
    fbx,
    meshGroups,
    options,
    exprBase,
    W,
    H,
    renderer,
    camera,
    playClip,
    restPose,
    applyMouthIndex,
    postPass,
  });

  let partCtl = null;
  if (!options.hidePartsUI && (built.partTargets || []).length) {
    const panel = el('div', { class: 'spine-vispanel m3d-partspanel', style: { display: 'none' } });
    const btn = el('button', {
      class: 'btn xs m3d-partsbtn active',
      text: '表示制御',
      title: 'ボーン単位で部品を半透明／非表示にします',
      on: {
        click: () => {
          if (panel.style.display !== 'none') {
            panel.style.display = 'none';
            btn.classList.add('active');
            return;
          }
          if (!partCtl) {
            partCtl = createPartControl(THREE_NS, built.partTargets);
            if (!partCtl.available) {
              panel.textContent = '（この模型は部位に分けられません）';
            } else {
              buildGroupedVisPanel(panel, {
                groups: partCtl.groups,
                alphaOf: (n) => partCtl.alphaOf(n),
                onSet: (list, a) => partCtl.set(list, a),
                onResetAll: () => partCtl.resetAll(),
              });
            }
          }
          panel.style.display = '';
          btn.classList.remove('active');
        },
      },
    });
    append(hostEl, [btn, panel]);
  }

  let auraFx = null;
  // オーラは常に loop サブツリー(定常状態=玉/リング)を表示する必要があるため animGate は常に無視する。
  const buildAura = (bytes, texByMatPid) => {
    if (auraFx) {
      try {
        root.remove(auraFx.group);
        auraFx.dispose();
      } catch (e) {}
      auraFx = null;
    }
    if (bytes && auraRenderer) {
      try {
        auraFx = auraRenderer.createAuraParticles(bytes, { texByMatPid: texByMatPid || null, ignoreGate: true });
        if (auraFx) root.add(auraFx.group);
      } catch (e) {
        console.warn('[tp] オーラの描画に失敗', e);
      }
    }
  };
  buildAura(options.auraBytes, options.auraTexMap);
  const resize = () => {
    const w = canvasWrap.clientWidth,
      h = canvasWrap.clientHeight;
    if (w < 2 || h < 2) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  let roView = null;
  if ('ResizeObserver' in globalThis) {
    roView = new ResizeObserver(resize);
    roView.observe(canvasWrap);
  }
  const onFsChange = () => {
    applyWrapHeight();
    resize();
  };
  document.addEventListener('fullscreenchange', onFsChange);

  let dragging = false,
    panning = false,
    lx = 0,
    ly = 0;
  const canvasEl = renderer.domElement;
  canvasEl.style.touchAction = 'none';
  canvasEl.style.cursor = 'grab';
  canvasEl.addEventListener('contextmenu', (e) => e.preventDefault());
  canvasEl.addEventListener('pointerdown', (e) => {
    lx = e.clientX;
    ly = e.clientY;
    if (e.button === 2 || e.button === 1) {
      panning = true;
      canvasEl.style.cursor = 'move';
    } else {
      dragging = true;
      canvasEl.style.cursor = 'grabbing';
    }
    canvasEl.setPointerCapture(e.pointerId);
  });
  canvasEl.addEventListener('pointerup', (e) => {
    dragging = false;
    panning = false;
    canvasEl.style.cursor = 'grab';
    try {
      canvasEl.releasePointerCapture(e.pointerId);
    } catch (x) {}
  });
  canvasEl.addEventListener('pointermove', (e) => {
    const dx = e.clientX - lx,
      dy = e.clientY - ly;
    if (dragging) {
      state.yaw += dx * 0.01;
      state.pitch += dy * 0.01;
      state.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, state.pitch));
      lx = e.clientX;
      ly = e.clientY;
      applyRot();
    } else if (panning) {
      const panScale = state.dist * 0.0018;
      const right = new THREE_NS.Vector3().setFromMatrixColumn(camera.matrix, 0);
      const up = new THREE_NS.Vector3().setFromMatrixColumn(camera.matrix, 1);
      state.target.addScaledVector(right, -dx * panScale);
      state.target.addScaledVector(up, dy * panScale);
      lx = e.clientX;
      ly = e.clientY;
      applyCam();
    }
  });
  canvasEl.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      state.dist *= 1 + Math.sign(e.deltaY) * 0.1;
      state.dist = Math.max(radius * 0.12, Math.min(radius * 8, state.dist));
      applyCam();
    },
    { passive: false },
  );

  let alive = true;
  let selfDispose = null;
  let onScreen = true;
  const stopVis = utilHelpers.observeVisibility(canvasWrap, (vis) => {
    onScreen = vis;
  });
  let lastT = globalThis.performance && performance.now() ? performance.now() : 0;
  const glOverlay = el('div', 'model3d-gllost', '描画コンテキストを復帰しています…');
  glOverlay.style.display = 'none';
  canvasWrap.appendChild(glOverlay);
  let glLost = false;
  const glGuard = guardRenderer(renderer, {
    deadMs: 2600,
    onLost: () => {
      glLost = true;
      glOverlay.textContent = '描画コンテキストを復帰しています…';
      glOverlay.style.display = '';
    },
    onRestored: () => {
      glLost = false;
      glOverlay.style.display = 'none';
      lastT = globalThis.performance && performance.now() ? performance.now() : lastT;
    },
    onDead: () => {
      const handled = options.onContextLost && options.onContextLost();
      if (!handled) glOverlay.textContent = '描画を復帰できませんでした。ページを再読み込みしてください。';
    },
  });
  const loop = () => {
    if (!alive) return;
    if (!canvasWrap.isConnected) {
      if (selfDispose) selfDispose();
      return;
    }
    const now = globalThis.performance && performance.now() ? performance.now() : lastT + 16;
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    if (onScreen && !(globalThis.document && globalThis.document.hidden)) {
      if (st.mixer && st.playing && st.action) {
        st.mixer.update(dt);
        for (const rig of weaponRigs) {
          rig.mixer.timeScale = st.playSpeed;
          rig.mixer.update(dt);
        }
        const faceDriven = applyClipExpr();
        updateBlink(dt, faceDriven || (st.exprFixed && st.exprFixed.has('face')));
      }
      if (auraFx) auraFx.update(dt);
      if (!glLost) {
        // オーラに soft-particle(靄/メテオ)があればシーン深度プリパスを実行して供給する。
        const needDepth = auraFx && auraFx.setDepthTexture;
        if (postPass) postPass.render(scene, camera, needDepth ? auraFx.group : null, needDepth ? (tex) => auraFx.setDepthTexture(tex) : null);
        else renderer.render(scene, camera);
      }
    }
    globalThis.requestAnimationFrame(loop);
  };
  loop();

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    alive = false;
    stopVis();
    if (roView) roView.disconnect();
    document.removeEventListener('fullscreenchange', onFsChange);
    if (document.fullscreenElement === hostEl) {
      try {
        document.exitFullscreen();
      } catch (e) {}
    }
    if (st.mixer) st.mixer.stopAllAction();
    if (auraFx) {
      try {
        auraFx.dispose();
      } catch (e) {}
    }
    if (postPass) {
      try {
        postPass.dispose();
      } catch (e) {}
    }
    glGuard.dispose();
    if (partCtl) partCtl.dispose();
    matFactory.dispose();
    if (mouthAtlasTex) mouthAtlasTex.dispose();
    root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    if (renderer.domElement && renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  };
  selfDispose = dispose;

  const setClip = (name) => {
    if (name === POSE_VALUE) {
      playback.restPose();
      if (st.clipSelect) st.clipSelect.value = POSE_VALUE;
      return;
    }
    const i = clips.findIndex((c) => c.name === name);
    if (i >= 0) {
      playback.playClip(i);
      if (st.clipSelect) st.clipSelect.value = String(i);
    }
  };
  const setSpeed = (v) => {
    st.playSpeed = Number(v) || 1;
    if (st.mixer) st.mixer.timeScale = st.playSpeed;
  };
  return {
    ok: true,
    stats,
    animated: clips.length > 0,
    clipNames: clips.map((c) => c.name),
    bbox: { min: box.min.toArray(), max: box.max.toArray() },
    dispose,
    setClip,
    setSpeed,
    setAura: (bytes, texByMatPid) => buildAura(bytes, texByMatPid),
  };
}

function disposeModel3d(m) {
  if (m && m.dispose) {
    try {
      m.dispose();
    } catch (e) {}
  }
  return null;
}

function buildInstance(model, materialBundle, opt) {
  const options = opt || {};
  const st = {
    mixer: null,
    action: null,
    playing: true,
    curClip: null,
    exprFix: false,
    exprFixed: new Set(),
    attachFix: false,
    playSpeed: 1,
    mouthExprIdx: 0,
    mouthCellKey: '',
    blinkClock: 0,
    blinkNext: 2.5,
  };
  const skinnable = !!(model.avatar && model.avatar.count && model.meshes.some((m) => m.skinIndex && m.boneNameHashes));
  const texMap = buildTextureMap(materialBundle || { materials: [], textures: [] });
  const meshByPath = new Map(model.meshes.map((m) => [m.pathID, m]));
  const modelMatByPath = new Map((model.materials || []).map((m) => [m.pathID, m]));
  const mouthMatOverride = (model.fbx && model.fbx.mouthMaterialOverride) || 0;
  const mouthVariant = (options.mouthAtlas && options.mouthAtlas.variants && options.mouthAtlas.variants[mouthMatOverride]) || options.mouthAtlas;
  const mouthAtlasTex = mouthVariant && mouthVariant.rgba ? makeDataTexture(mouthVariant) : null;
  const matFactory = createMaterialFactory(THREE_NS, {
    texMap,
    TOON_LIGHT: (options.mainLight && options.mainLight.dir) || [0.2962, 0.5, 0.8138],
    MAIN_LIGHT_COLOR: (options.mainLight && options.mainLight.color) || null,
    mouthAtlasTex,
  });
  const exprBase = (n) => String(n || '').replace(/_[RL]$/, '');
  const fbx = (model && model.fbx) || {};
  const holder = new THREE_NS.Group();
  const built = buildCharacterMeshes(THREE_NS, st, { model, meshByPath, modelMatByPath, getMat: matFactory.getMat, texMap, mouthAtlasTex, skinnable, fbx, options, scene: holder });
  if (!built.added) {
    matFactory.dispose();
    if (mouthAtlasTex) mouthAtlasTex.dispose();
    return { ok: false, reason: 'no-renderable-unityMesh' };
  }
  const { root, skelBones, radius, center, box, morphObjs, mouthGeoms, objBySmr, attachBase, weaponObjs, weaponRigs } = built;
  const clips = skinnable && model.clips && model.clips.length ? model.clips : [];
  const validBones = new Set(((model.avatar && model.avatar.hashes) || []).map((h) => h >>> 0));
  const clipCache = new Map();
  const getThreeClip = (i) => {
    if (!clipCache.has(i)) clipCache.set(i, buildThreeClip(clips[i], 60, validBones));
    return clipCache.get(i);
  };
  const playback = createPlayback(THREE_NS, st, { getThreeClip, clips, root, skelBones, model, weaponRigs });
  const expr = createExpression(THREE_NS, st, { mouthGeoms, morphObjs, weaponObjs, objBySmr, attachBase, fbx, remapMouthUV, exprBase });
  const defaultMouth = fbx.defaultMouthId > 0 ? fbx.defaultMouthId : 6;
  if (mouthGeoms.length) expr.applyMouthIndex(defaultMouth);

  const basesOf = (feature) => {
    const out = [];
    for (const mt of morphObjs) {
      if (mt.feature !== feature) continue;
      for (const nm in mt.obj.morphTargetDictionary || {}) {
        const b = exprBase(nm);
        if (!out.includes(b)) out.push(b);
      }
    }
    return out;
  };
  const exprSel = { face: undefined, brow: undefined, mouth: undefined };
  const applyExpr = (feature, base) => {
    const key = base || '';
    if (exprSel[feature] === key) return;
    exprSel[feature] = key;
    for (const mt of morphObjs) {
      if (mt.feature !== feature) continue;
      const infl = mt.obj.morphTargetInfluences;
      const dict = mt.obj.morphTargetDictionary || {};
      if (!infl) continue;
      for (let i = 0; i < infl.length; i++) infl[i] = 0;
      if (base) for (const nm in dict) if (exprBase(nm) === base) infl[dict[nm]] = 1;
    }
    if (base) st.exprFixed.add(feature);
    else {
      st.exprFixed.delete(feature);
      expr.applyClipExpr();
    }
  };
  const mouths = mouthGeoms.length
    ? [...new Set([defaultMouth, ...(model.clips || []).flatMap((c) => (c.events || []).filter((e) => e.type === 'mouth').map((e) => e.index))])].filter((i) => i >= 1 && i <= 25).sort((a, b) => a - b)
    : [];
  const clipNames = clips.map((c) => c.name);
  if (clipNames.length) {
    const pref = clipNames.findIndex((n) => /^idle$/i.test(n));
    playback.playClip(pref >= 0 ? pref : 0);
  }

  return {
    ok: true,
    root,
    box,
    center,
    radius,
    defaultRotY: ((fbx.rotationOverrideY || 0) * Math.PI) / 180,
    clipNames,
    clipDuration: (name) => {
      const i = clipNames.indexOf(name);
      return i < 0 ? 0 : clips[i].duration || 0;
    },
    mouths,
    faces: basesOf('face'),
    brows: basesOf('brow'),
    setClip(name) {
      const i = clipNames.indexOf(name);
      if (i < 0) {
        if (st.curClip) playback.restPose();
        return;
      }
      if (st.curClip === clips[i]) return;
      playback.playClip(i);
    },
    setSpeed(v) {
      const n = Number(v);
      st.playSpeed = n > 0 ? n : 1;
      if (st.mixer) st.mixer.timeScale = st.playSpeed;
    },
    setPaused(on) {
      st.playing = !on;
      if (st.action) st.action.paused = !!on;
      for (const rig of weaponRigs) if (rig.cur) rig.cur.paused = !!on;
    },
    setMouth(i) {
      const key = i == null || i === '' ? '' : String(Number(i) || defaultMouth);
      if (exprSel.mouth === key) return;
      exprSel.mouth = key;
      st.mouthCellKey = '';
      if (!key) {
        st.exprFixed.delete('mouth');
        expr.applyMouthIndex(defaultMouth);
        expr.applyClipExpr();
        return;
      }
      st.exprFixed.add('mouth');
      expr.applyMouthIndex(Number(key));
    },
    get paused() {
      return !st.playing;
    },
    setFace: (base) => applyExpr('face', base),
    setBrow: (base) => applyExpr('brow', base),
    update(dt) {
      if (!st.mixer || !st.playing || !st.action) return;
      st.mixer.update(dt);
      for (const rig of weaponRigs) {
        rig.mixer.timeScale = st.playSpeed;
        rig.mixer.update(dt);
      }
      const faceDriven = expr.applyClipExpr();
      expr.updateBlink(dt, faceDriven || st.exprFixed.has('face'));
    },
    dispose() {
      if (root.parent) root.parent.remove(root);
      matFactory.dispose();
      if (mouthAtlasTex) mouthAtlasTex.dispose();
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
    },
  };
}

export const model3dRenderer = { render, disposeModel3d, buildInstance, createMaterialFactory };
