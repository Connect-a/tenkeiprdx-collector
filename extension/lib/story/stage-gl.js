'use strict';
// 生spine-webgl(SceneRenderer)でステージ全体に立ち絵/CGを合成描画する(スケール/位置/カメラ/アニメ状態を制御)。
(function () {
  const SP = () => globalThis.spine;
  const GL = () => globalThis.spine && globalThis.spine.webgl;

  // native順rgba(w×h)→GLTexture。★拡張の洗練処理(spine-web.js/_hack/08)に合わせ、
  // decode済み生premult rgbaをtexImage2Dで直接アップロード＝canvas/PNG往復による
  // 低alpha縁の丸め崩れ(頬の赤み等の縁線)を回避。上下はflipRgbaYで合わせる。
  function makeTexture(ctx, tex) {
    const T = globalThis.TP_TEXCODEC;
    const flipped = T && T.flipRgbaY ? T.flipRgbaY(tex.rgba, tex.width, tex.height) : tex.rgba;
    const cv = document.createElement('canvas'); cv.width = tex.width; cv.height = tex.height;
    const src = flipped instanceof Uint8ClampedArray ? flipped : new Uint8ClampedArray(flipped.buffer, flipped.byteOffset, flipped.byteLength);
    cv.getContext('2d').putImageData(new ImageData(src, tex.width, tex.height), 0, 0);
    const glt = new (GL().GLTexture)(ctx, cv);
    try {
      const gl = ctx.gl; glt.bind();
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); // rgbaは既にpremult＝再乗算しない
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      const raw = flipped instanceof Uint8Array ? flipped : new Uint8Array(flipped.buffer, flipped.byteOffset, flipped.byteLength);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, tex.width, tex.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    } catch (e) { console.debug('[stage-gl] raw tex upload failed', e); }
    return glt;
  }

  function buildSkeleton(ctx, inputs) {
    const spine = SP(), SPX = globalThis.TP_SPINE;
    let atlasBytes = inputs.atlasBytes;
      const szm = new TextDecoder('utf-8').decode(atlasBytes).match(/size:\s*(\d+)\s*,\s*(\d+)/);
    if (szm && SPX && SPX.scaleAtlasCoords) { const pw = +szm[1], ph = +szm[2]; if (pw > 0 && ph > 0 && (pw !== inputs.texture.width || ph !== inputs.texture.height)) atlasBytes = SPX.scaleAtlasCoords(atlasBytes, inputs.texture.width / pw, inputs.texture.height / ph); }
    const atlasText = new TextDecoder('utf-8').decode(atlasBytes);
    const tex = makeTexture(ctx, inputs.texture);
    const atlas = new spine.TextureAtlas(atlasText, () => tex);
    const loader = new spine.AtlasAttachmentLoader(atlas);
    const isJson = (SPX && SPX.detectSkeletonIsJson) ? SPX.detectSkeletonIsJson(inputs.skeletonPath, inputs.skeletonBytes) : (inputs.skeletonBytes[0] === 0x7b);
    let data;
    if (isJson) { const j = new spine.SkeletonJson(loader); data = j.readSkeletonData(new TextDecoder('utf-8').decode(inputs.skeletonBytes)); }
    else { const b = new spine.SkeletonBinary(loader); data = b.readSkeletonData(inputs.skeletonBytes instanceof Uint8Array ? inputs.skeletonBytes : new Uint8Array(inputs.skeletonBytes)); }
    const skeleton = new spine.Skeleton(data);
    // 表情=別々の全身idleアニメ(idle_normal/joy/…)。切替時にクロスフェードして「ガクッ」を防ぐ(実ゲームも瞬時切替でない)。
    const stateData = new spine.AnimationStateData(data);
    stateData.defaultMix = 0.12; // 表情切替のクロスフェード(短め)。ガクつかず素早く切り替わる
    const state = new spine.AnimationState(stateData);
    skeleton.setToSetupPose(); skeleton.updateWorldTransform();
    const off = new spine.Vector2(), size = new spine.Vector2();
    skeleton.getBounds(off, size, []);
    return { data, skeleton, state, bounds: { x: off.x, y: off.y, w: size.x, h: size.y }, curAnim: null, anims: data.animations.map((a) => a.name) };
  }

  function create(canvas, opts) {
    const spine = SP(), wgl = GL();
    if (!spine || !wgl || !wgl.SceneRenderer) throw new Error('spine-webgl runtime unavailable');
    const o = opts || {};
    const ctx = new wgl.ManagedWebGLRenderingContext(canvas, { alpha: true, premultipliedAlpha: true, antialias: true });
    const gl = ctx.gl;
    const renderer = new wgl.SceneRenderer(canvas, ctx, true); // twoColorTint=true(SpinePlayerと同一・暗色tintで陰影を正しく描く)
    const skels = new Map();
    const cast = new Map(); let leaving = []; let stillItem = null; let mode = 'cast';
    let lastT = 0, raf = 0, disposed = false;
    const bgEl = o.bgEl || null;
    const refWidth = () => (o.refW || 1136), refHeight = () => (o.refH || (o.refW || 1136) * 9 / 16);
    let camCur = { px: 0, py: 0, z: 1 }, camFrom = { px: 0, py: 0, z: 1 }, camTo = { px: 0, py: 0, z: 1 }, camT = 0, camDur = 0;
    // カメラ値(X,Y=参照解像度単位・0=中央, Z=ズーム%・100=1×)→ 画面割合pan＋zoom。
    // ★0,0,0はリテラル(pan中央・zoom0→クランプ0.1)＝ズームイン開始。「カメラ無し」はsetCamera(null)で別扱い。
    const camFromTriple = (t) => {
      if (!t) return { px: 0, py: 0, z: 1 };
      return { px: (Number(t[0]) || 0) / refWidth(), py: (Number(t[1]) || 0) / refHeight(), z: Math.max(0.1, (Number(t[2]) || 0) / 100) };
    };
    const lerp = (a, b, k) => a + (b - a) * k;

    function ensure(key, inputs) {
      if (skels.has(key)) return skels.get(key);
      let rec = null; try { rec = buildSkeleton(ctx, inputs); } catch (e) { console.warn('[stage-gl] build失敗', key, e && e.message); rec = { dead: true }; }
      skels.set(key, rec); return rec;
    }

    // アニメは"変化時のみ"セット(セリフ送りで巻き戻らない)
    function setAnim(rec, name, loop) {
      if (!rec || rec.dead || !name) return;
      if (rec.curAnim === name) return;
      const pick = rec.anims.includes(name) ? name : (rec.anims.find((n) => /idle/i.test(n)) || rec.anims[0]);
      try { rec.state.setAnimation(0, pick, loop); rec.curAnim = name; } catch (e) {}
    }

    // CharacterAppearance(appearanceCode) → 登場/退場トランジション。0 CutIn/7 CutOut=瞬間(null)。
    function appearTr(appearanceCode) {
      const HS = 0.18, N = 0.35, F = 0.3;
      switch (appearanceCode) {
        case 1: return { mode: 'in', fade: true, dur: F, t: 0 };                 // FadeIn
        case 2: return { mode: 'in', axis: 'y', sign: -1, dur: N, t: 0 };        // SlideInFromBottom
        case 3: return { mode: 'in', axis: 'x', sign: -1, dur: N, t: 0 };        // SlideInFromLeft
        case 4: return { mode: 'in', axis: 'x', sign: 1, dur: N, t: 0 };         // SlideInFromRight
        case 5: return { mode: 'in', axis: 'x', sign: -1, dur: HS, t: 0 };       // HiSpeed L
        case 6: return { mode: 'in', axis: 'x', sign: 1, dur: HS, t: 0 };        // HiSpeed R
        case 8: return { mode: 'out', fade: true, dur: F, t: 0 };                // FadeOut
        case 9: return { mode: 'out', axis: 'y', sign: -1, dur: N, t: 0 };       // SlideOutToBottom
        case 10: return { mode: 'out', axis: 'x', sign: -1, dur: N, t: 0 };      // SlideOutToLeft
        case 11: return { mode: 'out', axis: 'x', sign: 1, dur: N, t: 0 };       // SlideOutToRight
        case 12: return { mode: 'out', axis: 'x', sign: -1, dur: HS, t: 0 };
        case 13: return { mode: 'out', axis: 'x', sign: 1, dur: HS, t: 0 };
        default: return null; // 0 CutIn / 7 CutOut
      }
    }

    function resize() {
      const dpr = Math.min(2, self.devicePixelRatio || 1);
      const w = canvas.clientWidth || 900, h = canvas.clientHeight || Math.round(w * 9 / 16);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }

    function loop(t) {
      if (disposed) return;
      raf = requestAnimationFrame(loop);
      const delta = lastT ? (t - lastT) / 1000 : 0; lastT = t;
      const W = canvas.width, H = canvas.height;
      if (camDur > 0) { camT += delta; const k = Math.min(1, camT / camDur); camCur.px = lerp(camFrom.px, camTo.px, k); camCur.py = lerp(camFrom.py, camTo.py, k); camCur.z = lerp(camFrom.z, camTo.z, k); if (k >= 1) camDur = 0; }
      else { camCur.px = camTo.px; camCur.py = camTo.py; camCur.z = camTo.z; }
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      const cam = renderer.camera;
      const stillM = (mode === 'still' && stillItem);
      if (stillM) {
        // CG: skeleton等倍(WebPlayer同一・メッシュ変形が壊れない)。ズーム/パンはカメラ側で適用。
        // ゲームはScenarioCanvasをカメラrectいっぱいに合わせstillを画面充填する(ScenarioCanvas.AdjustWorldSpaceCanvasToCameraRect)。
        // ∴CONTAIN(余白で小さく中央寄り)ではなくcover(画面充填・はみ出しはクロップ)でboundsを合わせる。
        const b = stillItem.bounds, sa = W / H, ba = b.w / b.h;
        let vw, vh; if (ba > sa) { vh = b.h; vw = b.h * sa; } else { vw = b.w; vh = b.w / sa; }
        const zz = (o.stillZoom || 1.0) * (camCur.z || 1);
        vw /= zz; vh /= zz;
        cam.position.x = b.x + b.w / 2 + (camCur.px || 0) * b.w;
        cam.position.y = b.y + b.h / 2 + (camCur.py || 0) * b.h;
        cam.setViewport(vw, vh); cam.update();
        if (bgEl) bgEl.style.transform = '';
      } else {
        const z = camCur.z || 1;
        cam.position.x = W * (0.5 + camCur.px); cam.position.y = H * (0.5 + camCur.py); cam.setViewport(W / z, H / z); cam.update();
        if (bgEl) bgEl.style.transform = `scale(${z}) translate(${-camCur.px * 100}%, ${camCur.py * 100}%)`;
      }
      renderer.begin();
      const items = (mode === 'still' && stillItem) ? [stillItem] : [...cast.values(), ...leaving];
      const finishedOut = [];
      for (const it of items) {
        const rec = it.rec; if (!rec || rec.dead) continue;
        rec.state.update(delta); rec.state.apply(rec.skeleton);
        let ox = 0, oy = 0, alpha = 1, sMul = 1;
        if (it.tr) {
          it.tr.t += delta; const k = Math.min(1, it.tr.t / it.tr.dur);
          const p = it.tr.mode === 'in' ? (1 - k) : k;
          if (it.tr.axis === 'x') ox = W * 0.6 * p * (it.tr.sign || 1);
          else if (it.tr.axis === 'y') oy = H * 0.7 * p * (it.tr.sign || 1);
          if (it.tr.fade) alpha = it.tr.mode === 'in' ? k : (1 - k);
          if (k >= 1) { if (it.tr.mode === 'out') finishedOut.push(it); it.tr = null; }
        }
        // アクション(e3): Jump/Tremble/Falldown/Startled/ZoomIn/ZoomOut等の一時演出
        if (it.act) {
          it.act.t += delta; const k = it.act.t / it.act.dur;
          if (k >= 1) it.act = null;
          else { const s = Math.sin(k * Math.PI);
            switch (it.act.type) {
              case 1: oy += H * 0.08 * s; break;                                    // Jump
              case 2: ox += W * 0.012 * Math.sin(k * 40) * (1 - k); break;          // Tremble
              case 3: oy -= H * 0.06 * s; break;                                    // Falldown
              case 4: oy += H * 0.04 * s; ox += W * 0.006 * Math.sin(k * 30) * (1 - k); break; // Startled
              case 6: alpha *= (1 - k); break;                                      // Disappearance
              case 7: sMul = 1 + 0.12 * s; break;                                   // ZoomIn
              case 8: sMul = 1 - 0.12 * s; break;                                   // ZoomOut
              case 9: oy -= H * 0.06 * s; alpha *= (1 - k); break;                  // FalldownToFadeOut
            }
          }
        }
        rec.skeleton.x = it.tx + ox; rec.skeleton.y = it.y + oy; rec.skeleton.scaleX = it.sx * sMul; rec.skeleton.scaleY = it.sy * sMul;
        const dv = (it.dim != null ? it.dim : 1);
        try { rec.skeleton.color.set(dv, dv, dv, alpha); } catch (e) {}
        rec.skeleton.updateWorldTransform();
        try { renderer.drawSkeleton(rec.skeleton, true); } catch (e) {}
      }
      if (finishedOut.length) leaving = leaving.filter((x) => !finishedOut.includes(x));
      renderer.end();
    }

    resize(); raf = requestAnimationFrame(loop);
    const onResize = () => resize(); self.addEventListener('resize', onResize);

    const api = {
      ensure,
      setCamera(cam) {
        if (!cam) { camFrom = { ...camCur }; camTo = { px: 0, py: 0, z: 1 }; camT = 0; camDur = 0.3; return; }
        camFrom = camFromTriple(cam.s); camCur = { ...camFrom }; camTo = camFromTriple(cam.e);
        camT = 0; camDur = (cam.dur || 0) / 1000;
      },
      showStill(rec, animName) {
        mode = 'still'; cast.clear(); leaving = [];
        if (!rec || rec.dead) { stillItem = null; return false; }
        setAnim(rec, animName, true);
        stillItem = { rec, tx: 0, y: 0, sx: 1, sy: 1, dim: 1, tr: null, bounds: rec.bounds };
        return true;
      },
      setCast(list) {
        mode = 'cast'; stillItem = null;
        const W = canvas.width, H = canvas.height;
        const baseline = (o.baseline != null ? o.baseline : 0.03);
        const refW = (o.refW || 1136);
        const refH = (o.refH || refW * 9 / 16);
        const seen = new Set();
        for (const c of list) {
          const rec = c.rec; if (!rec || rec.dead) continue;
          setAnim(rec, c.anim, true);
          const b = rec.bounds; if (!(b.h > 0)) continue;
          // 縮尺は各キャラ個別に正規化(骨格高→画面高の1.25倍)。1体流用だと骨格高の違うキャラが上下にずれる。
          const scale = (o.scaleMul || 1) * (1.25 / b.h) * H;
          const sx = c.flip ? -scale : scale;
          const tx = W * (0.5 + (c.posMapX || 0) / refW) - (b.x + b.w / 2) * sx;
          const y = H * baseline - b.y * scale;
          const dim = (c.speaking === false) ? 0.5 : 1.0;
          if (c.appear >= 7) { // 退場(CutOut/Fade/Slide Out)
            const it = cast.get(c.id);
            if (it) { const tr = appearTr(c.appear); cast.delete(c.id); if (tr) { it.tr = tr; leaving.push(it); } }
            continue;
          }
          seen.add(c.id);
          // 頭アンカー(ref座標・DOM上端基準)。感情アイコンをキャラ頭上へ追従配置するのに使う(カメラ中立想定)。
          // 頭のワールドY(Y-up比) = baseline + b.h*scale/H → DOM Y = refH*(1 - それ)。X=bbox中心=refW/2+posMapX。
          const anchor = { x: refW / 2 + (c.posMapX || 0), y: refH * (1 - (baseline + (b.h * scale) / H)) };
          let it = cast.get(c.id);
          if (it) { it.rec = rec; it.tx = tx; it.y = y; it.sx = sx; it.sy = scale; it.dim = dim; it.anchor = anchor; }
          else { it = { rec, tx, y, sx, sy: scale, dim, anchor, tr: appearTr(c.appear), actLast: 0, act: null }; cast.set(c.id, it); }
          if (c.act && c.act !== it.actLast) it.act = { type: c.act, t: 0, dur: 0.5 };
          it.actLast = c.act || 0;
        }
        for (const [id, it] of [...cast]) { if (!seen.has(id)) { it.tr = { mode: 'out', fade: true, dur: 0.15, t: 0 }; cast.delete(id); leaving.push(it); } }
      },
      castAnchor(id) { const it = cast.get(id); return it ? it.anchor : null; },
      setOpts(p) { if (p) for (const k in p) o[k] = p[k]; },
      getOpts() { return { scaleMul: o.scaleMul || 1, baseline: o.baseline != null ? o.baseline : 0.03, refW: o.refW || 1136 }; },
      clear() { mode = 'cast'; cast.clear(); leaving = []; stillItem = null; },
      dispose() { disposed = true; if (raf) cancelAnimationFrame(raf); self.removeEventListener('resize', onResize); try { renderer.dispose(); } catch (e) {} },
      _skels: skels,
    };
    return api;
  }

  globalThis.TP_STAGE_GL = { create };
})();
