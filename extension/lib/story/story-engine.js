'use strict';
// TP_STORY_ENGINE — ストーリー演出再生エンジン(埋め込み可能・DOM非依存)。
(function () {
  const num = (x) => (typeof x === 'bigint' ? Number(x) : x);
  // CharacterPositions → characterPositionXMap実値(ScenarioCharacter.cctor由来・基準解像度単位)
  const POSMAP = { 0: 0, 1: -326, 2: -196, 3: 0, 4: 196, 5: 326 };
  // CharacterPositions → SpeakerPositionFlags(喋り判定)
  const SPKFLAG = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 };
  // CharacterFacialExpressions → Spine idle_* アニメ
  const FACE_ANIM = ['idle_normal', 'idle_joy', 'idle_sad', 'idle_angry', 'idle_surprise', 'idle_unique', 'idle_shy'];
  // CharacterEmotionIcons(e4) → Emotion Sprites Atlasのスプライト名(dump.cs enum由来)。
  // 9=ConcentratedLineは集中線エフェクト=アイコン無し。13/14(Right/LeftSideSigh)はSigh共用。
  const EMO_MAP = { 1: 'Pleasure', 2: 'Sad', 3: 'Angry', 4: 'Amazing', 5: 'Panicked', 6: 'Shy', 7: 'Love', 8: 'Question', 10: 'Disorder', 11: 'Gloomy', 12: 'Idea', 13: 'Sigh', 14: 'Sigh', 15: 'Trouble' };

  function sceneFrames(decoded, initBgm) {
    const cmds = (decoded[0] && decoded[0][4]) || [];
    let bg = null, bgm = (initBgm != null ? initBgm : null), still = null, stillAnim = null, cast = [], pendingSe = null;
    const frames = [];
    for (const c of cmds) {
      if (c[3]) bg = c[3];
      if (typeof c[7] === 'string' && c[7]) still = c[7];
      if (typeof c[8] === 'string' && c[8]) stillAnim = c[8];
      if (c[27]) bgm = c[27];
      if (typeof c[28] === 'string' && c[28]) pendingSe = c[28]; // SE(c28)は次フレームで一度だけ鳴らす
      if (Array.isArray(c[31])) {
        cast = c[31].filter((e) => Array.isArray(e)).map((e) => ({
          id: num(e[0]), app: num(e[1]) || 0, pos: num(e[2]) || 0,
          act: num(e[3]) || 0, emo: num(e[4]) || 0, face: num(e[5]) || 0,
          flip: !!e[6], skin: (e[7] == null ? null : num(e[7])),
        })).filter((e) => e.id > 0);
      }
      const text = c[12], spk = c[10], voice = c[29];
      if (text || voice || spk) {
        const inStill = !!(still && bg && !/^bg_/.test(String(bg)));
        const cs = [num(c[16]) || 0, num(c[17]) || 0, num(c[18]) || 0], ce = [num(c[19]) || 0, num(c[20]) || 0, num(c[21]) || 0];
        const hasCam = [...cs, ...ce].some((v) => v !== 0);
        frames.push({
          i: num(c[0]), speaker: spk || null,
          text: text ? String(text).replace(/\\n/g, '\n') : null,
          voice: voice || null, bg, bgm,
          still: inStill ? still : null, stillAnim: inStill ? stillAnim : null,
          speakerPos: num(c[30]) || 0, cast: cast.map((x) => ({ ...x })),
          cam: hasCam ? { s: cs, e: ce, dur: num(c[22]) || 0 } : null,
          se: pendingSe,
          center: !!c[15],          // Key15 IsPhraseCenter: 地の文は中央寄せ
          fontSize: num(c[13]) || 0, // Key13 PhraseFontSize (1 Normal/2 Small/3 Large/4 Huge)
          effect: num(c[1]) || 0,    // Key1 FrameEffect (4 WhiteFlash/5 RedFlash/6-8 Shake…)
          effectDur: num(c[2]) || 0, // Key2 FrameEffectDuration(ms)
        });
        pendingSe = null;
      }
    }
    return frames;
  }

  async function crunchReady(ms) {
    const CR = globalThis.TP_CRUNCH, t0 = Date.now();
    while (Date.now() - t0 < ms) { if (CR && CR.canDecodeCrunched()) return true; await new Promise((r) => setTimeout(r, 120)); }
    return !!(CR && CR.canDecodeCrunched());
  }

  function create(opts) {
    const o = opts || {};
    const D = globalThis.TP_DECODE, FS = globalThis.TP_FS, TEX = globalThis.TP_TEXCODEC, CR = globalThis.TP_CRUNCH, MESH = globalThis.TP_MESH;
    const els = o.els || {};
    const voiceEnabled = o.voiceEnabled || (() => true);
    const PLAYER = o.playerName || '主人公';
    const subUser = (s) => (s == null ? s : String(s).replace(/%username%/gi, PLAYER)); // ゲームは%username%をプレイヤー名へ置換
    const S = { charHandle: null, meta: null, ep: null, frames: [], idx: 0, gen: 0, stage: null, bgCache: new Map(), voiceUrls: new Map(), extractedSids: new Set(), seUrls: new Map(), seMap: null, emoAtlas: null, bgmUrls: new Map(), curBgm: null, revealTimer: null, revealFull: '', revealing: false, fxIdx: -1 };
    const FONT_PX = { 1: '16px', 2: '13px', 3: '20px', 4: '26px' }; // FontSizes: Normal/Small/Large/Huge
    const setText = (el, v) => { if (el) el.textContent = v; };
    const readBundle = (p) => FS.readBundleUnder(S.charHandle, p);

    // テキストを1文字ずつ表示(タイプライター)。クリックでcompleteReveal即時全表示(ADV標準)。
    function startReveal(full) {
      if (S.revealTimer) { clearInterval(S.revealTimer); S.revealTimer = null; }
      S.revealFull = full || '';
      const el = els.text; if (!el) return;
      if (!S.revealFull) { el.textContent = ''; S.revealing = false; return; }
      const cps = (o.textCps || 45); let n = 0; el.textContent = ''; S.revealing = true;
      S.revealTimer = setInterval(() => {
        n++; el.textContent = S.revealFull.slice(0, n);
        if (n >= S.revealFull.length) { clearInterval(S.revealTimer); S.revealTimer = null; S.revealing = false; }
      }, Math.max(16, 1000 / cps));
    }
    function completeReveal() {
      if (S.revealTimer) { clearInterval(S.revealTimer); S.revealTimer = null; }
      if (els.text) els.text.textContent = S.revealFull;
      S.revealing = false;
    }
    // FrameEffect(Key1): WhiteFlash/RedFlash=フラッシュ, Shake=画面揺れ。同一フレームの再描画では二重発火しない。
    function playFrameEffect(fr) {
      const shakeEl = els.shakeEl, fx = els.fxLayer;
      if (shakeEl) shakeEl.classList.remove('fxShakeS', 'fxShakeM', 'fxShakeL');
      if (fx) { fx.style.transition = 'none'; fx.style.opacity = '0'; }
      if (S.fxIdx === S.idx) return; S.fxIdx = S.idx;
      const e = fr.effect; if (!e) return;
      const dur = Math.max(120, fr.effectDur || 300);
      if (e === 4 || e === 5) {
        if (fx) { fx.style.background = e === 5 ? '#ff3b3b' : '#fff'; fx.style.opacity = '1'; requestAnimationFrame(() => { fx.style.transition = 'opacity ' + dur + 'ms ease-out'; fx.style.opacity = '0'; }); }
      } else if (e === 6 || e === 7 || e === 8) {
        if (shakeEl) { const cls = e === 6 ? 'fxShakeS' : (e === 7 ? 'fxShakeM' : 'fxShakeL'); shakeEl.classList.add(cls); setTimeout(() => shakeEl.classList.remove(cls), dur); }
      }
    }

    function decodeBundleCanvas(bytes) {
      const parsed = D.parseUnityFS(bytes);
      const cmod = (CR && CR.canDecodeCrunched()) ? CR : null;
      const r = TEX.extractTexture2DPreviews(parsed.data, cmod, 1, { flipY: true });
      return (r.previews && r.previews[0]) ? r.previews[0].canvas : null;
    }
    async function loadSkel(key, path) {
      if (!S.stage) return null;
      let rec = S.stage._skels.get(key);
      if (rec) return rec;
      let bytes = null; try { bytes = await readBundle(path); } catch (e) {}
      if (!bytes) return null;
      const inp = MESH.extractSpineInputs(bytes); if (!inp) return null;
      return S.stage.ensure(key, inp);
    }
    async function ensureSceneVoice(sid, voicePath) {
      if (!sid || !voicePath || S.extractedSids.has(sid)) return;
      S.extractedSids.add(sid);
      const b = await readBundle(voicePath); if (!b) return;
      let clips = []; try { clips = D.extractVoiceClips(b); } catch (e) {}
      for (const c of clips) if (!S.voiceUrls.has(c.name)) S.voiceUrls.set(c.name, URL.createObjectURL(new Blob([c.data], { type: 'audio/mp4' })));
    }
    async function playVoice(fr) {
      const a = els.audio; if (!a) return;
      a.pause();
      if (!fr.voice || !voiceEnabled()) return;
      await ensureSceneVoice(fr._sid, fr._voicePath);
      if (S.voiceUrls.has(fr.voice)) { a.src = S.voiceUrls.get(fr.voice); a.play().catch(() => {}); }
    }
    async function resolveSe(name) {
      if (S.ep && S.ep.se && S.ep.se[name]) return S.ep.se[name];
      if (!S.seMap) {
        S.seMap = {};
        try {
          const shared = await FS.getDir('_共有リソース', false);
          const files = shared ? await FS.listUnder(shared, 'Assets/WebGL/se_assets_se') : [];
          for (const fn of files) { const m = fn.match(/^(.+)_[0-9a-f]{32}\.bundle$/); if (m) S.seMap[m[1].toLowerCase()] = '_共有リソース/Assets/WebGL/se_assets_se/' + fn; }
        } catch (e) {}
      }
      return S.seMap[String(name).toLowerCase()] || null;
    }
    async function playBgm(fr) {
      const a = els.bgm; if (!a) return;
      const name = fr.bgm;
      if (!name || /^nobgm/i.test(String(name))) { if (S.curBgm) { a.pause(); S.curBgm = null; } return; }
      if (S.curBgm === name) { if (a.paused && a.src) a.play().catch(() => {}); return; } // 自動再生ブロック時のリトライ
      S.curBgm = name;
      const path = (S.ep.bgm && S.ep.bgm[name]) || null; if (!path) { a.pause(); return; }
      if (!S.bgmUrls.has(name)) {
        const b = await readBundle(path); if (!b) return;
        let clips = []; try { clips = D.extractAudioResource(b); } catch (e) {}
        if (!clips.length) return;
        S.bgmUrls.set(name, URL.createObjectURL(new Blob([clips[0]], { type: 'audio/mp4' })));
      }
      if (S.curBgm !== name) return; // await中に切替
      a.src = S.bgmUrls.get(name); a.loop = true; a.volume = 0.4; a.play().catch(() => {});
    }
    async function playSe(fr) {
      const a = els.se; if (!a || !fr.se) return;
      if (!S.seUrls.has(fr.se)) {
        const path = await resolveSe(fr.se); if (!path) return;
        const b = await readBundle(path); if (!b) return;
        let clips = []; try { clips = D.extractAudioResource(b); } catch (e) {}
        if (!clips.length) return;
        S.seUrls.set(fr.se, URL.createObjectURL(new Blob([clips[0]], { type: 'audio/mp4' })));
      }
      const url = S.seUrls.get(fr.se); if (!url) return;
      a.src = url; a.currentTime = 0; a.play().catch(() => {});
    }

    function renderEmotions(fr) {
      const layer = els.emoLayer; if (!layer) return;
      layer.innerHTML = '';
      if (!S.emoAtlas || fr.still) return;
      // emoLayerは参照解像度(1136×640)のuiLayer内。位置はキャラ立ち絵の頭アンカー(stage.castAnchor)へ追従＝
      // 実装(ScenarioCharacterEmotionがキャラの頭アンカー子)に忠実。取得不可時のみ従来の近似へフォールバック。
      const refW = (o.stageOpts && o.stageOpts.refW) || 1136, refH = (o.stageOpts && o.stageOpts.refH) || 640;
      for (const c of fr.cast) {
        if (!c.emo) continue;
        const nm = EMO_MAP[c.emo]; if (!nm) continue;
        const sp = S.emoAtlas.get(nm); if (!sp) continue;
        // 位置微調整(refH/refW比)。EMO_DROP=頭bbox上端から下へ(顔〜頭の高さへ)、EMO_DX=左右。実物と合わせて調整可。
        const EMO_DROP = 0.10, EMO_DX = 0;
        const anchor = (S.stage && S.stage.castAnchor) ? S.stage.castAnchor(c.id) : null;
        const x = (anchor ? anchor.x : (refW / 2 + (POSMAP[c.pos] != null ? POSMAP[c.pos] : 0))) + refW * EMO_DX;
        let y = (anchor ? anchor.y : Math.round(refH * 0.12)) + refH * EMO_DROP;
        // 溜息(13/14)は口横アンカー＝頭より下(実装のright/leftSideMouth相当の近似)
        if (c.emo === 13 || c.emo === 14) y += Math.round(refH * 0.16);
        const img = document.createElement('img');
        img.src = sp.dataUrl;
        img.style.cssText = 'position:absolute;left:' + Math.round(x) + 'px;top:' + Math.round(y) + 'px;width:96px;transform:translate(-50%,-50%);pointer-events:none';
        layer.appendChild(img);
      }
    }

    async function renderFrame() {
      const gen = ++S.gen;
      const fr = S.frames[S.idx];
      if (!fr) return;
      if (S.stage) S.stage.setCamera(fr.cam);
      // 背景
      const bgHost = o.bgEl;
      if (fr.bg && bgHost) {
        let cv = S.bgCache.get(fr.bg);
        if (!cv) {
          const path = (S.ep.bg && (S.ep.bg[fr.bg])) || null;
          if (path) { const b = await readBundle(path); if (b) { try { cv = decodeBundleCanvas(b); } catch (e) {} } }
          if (cv) S.bgCache.set(fr.bg, cv);
        }
        if (gen === S.gen) { bgHost.innerHTML = ''; if (cv) bgHost.appendChild(cv); else { const d = document.createElement('div'); d.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#556;background:#1a1d24'; d.textContent = fr.bg; bgHost.appendChild(d); } }
      }
      // still/CG or立ち絵
      const cast = (S.meta.routing && S.meta.routing.cast) || {};
      if (fr.still) {
        const path = (S.ep.cg && (S.ep.cg[fr.still] || S.ep.cg[String(fr.still)])) || null;
        const rec = path ? await loadSkel('still:' + fr.still, path) : null;
        if (gen !== S.gen) return;
        if (rec && !rec.dead) S.stage.showStill(rec, fr.stillAnim); else S.stage.clear();
      } else {
        const casts = [];
        for (const c of fr.cast) {
          const entry = cast[String(c.id)] || cast[c.id];
          const path = entry && (entry.spine || entry.spinelight);
          if (!path) continue;
          const rec = await loadSkel('c' + c.id, path);
          if (gen !== S.gen) return;
          const speaking = fr.speakerPos ? ((fr.speakerPos & (SPKFLAG[c.pos] || 0)) !== 0) : true;
          if (rec && !rec.dead) casts.push({ rec, id: c.id, appear: c.app, act: c.act, emo: c.emo, posMapX: POSMAP[c.pos] != null ? POSMAP[c.pos] : 0, flip: !!c.flip, anim: FACE_ANIM[c.face] || 'idle_normal', speaking });
        }
        S.stage.setCast(casts);
      }
      renderEmotions(fr);
      playFrameEffect(fr);
      if (els.speaker) els.speaker.style.display = fr.speaker ? '' : 'none'; // 地の文(話者なし)は名前枠を隠す
      setText(els.speaker, subUser(fr.speaker) || '');
      if (els.text) { els.text.style.textAlign = fr.center ? 'center' : ''; els.text.style.fontSize = FONT_PX[fr.fontSize] || ''; }
      startReveal(subUser(fr.text) || ''); // タイプライター表示
      if (els.meta) setText(els.meta, `#${fr.i}  bg=${fr.bg || '-'}  bgm=${fr.bgm || '-'}${fr.still ? '  still=' + fr.still + '/' + (fr.stillAnim || '?') : ''}  cast=[${fr.cast.map((c) => c.id + '@' + c.pos + (c.face ? ':f' + c.face : '')).join(',')}]`);
      setText(els.prog, `${S.idx + 1} / ${S.frames.length}`);
      playVoice(fr);
      playSe(fr);
      playBgm(fr);
      if (o.onFrame) { try { o.onFrame(fr, S.charHandle, S.ep); } catch (e) {} }
    }

    return {
      async open(charHandle, meta, ep) {
        S.charHandle = charHandle; S.meta = meta; S.ep = ep;
        await crunchReady(4000);
        if (!S.stage) { S.stage = globalThis.TP_STAGE_GL.create(o.canvas, Object.assign({ bgEl: o.bgEl }, o.stageOpts || {})); }
        if (!S.emoAtlas && o.emotionAtlasUrl && globalThis.TP_SCENARIO_UI) { try { S.emoAtlas = await globalThis.TP_SCENARIO_UI.load(o.emotionAtlasUrl); } catch (e) {} }
        const revokeAll = (map) => { for (const u of map.values()) { try { URL.revokeObjectURL(u); } catch (e) {} } map.clear(); };
        if (els.audio) els.audio.pause(); if (els.se) els.se.pause(); if (els.bgm) els.bgm.pause();
        S.stage.clear(); S.bgCache.clear(); revokeAll(S.voiceUrls); S.extractedSids.clear(); revokeAll(S.seUrls); S.seMap = null;
        revokeAll(S.bgmUrls); S.curBgm = null;
        const frames = [];
        let carryBgm = null; // BGMはエピソード内でシーンを跨いで継続(次シーン冒頭で同曲が鳴り直す誤遷移を防ぐ)
        for (const s of (ep.scenes || [])) {
          const b = await readBundle(s.scene); if (!b) continue;
          let dec = null; try { dec = D.decodeSceneBin(b); } catch (e) {}
          if (!dec) continue;
          const fs = sceneFrames(dec, carryBgm);
          for (const fr of fs) { fr._sid = String(s.sceneId); fr._voicePath = s.voice; frames.push(fr); }
          if (fs.length && fs[fs.length - 1].bgm != null) carryBgm = fs[fs.length - 1].bgm;
        }
        S.frames = frames; S.idx = 0;
        if (frames.length) renderFrame();
        return frames.length;
      },
      go(d) { if (!S.frames.length) return; const ni = Math.max(0, Math.min(S.frames.length - 1, S.idx + d)); if (ni === S.idx) return; S.idx = ni; renderFrame(); },
      next() { this.go(1); }, prev() { this.go(-1); },
      render(i) { if (i != null) S.idx = Math.max(0, Math.min(S.frames.length - 1, i)); renderFrame(); },
      isRevealing() { return !!S.revealing; },
      completeReveal() { completeReveal(); },
      replayVoice() { const fr = S.frames[S.idx]; if (fr) playVoice(fr); },
      backlog() { const out = []; for (let i = 0; i <= S.idx && i < S.frames.length; i++) { const f = S.frames[i]; if (f.text || f.speaker) out.push({ idx: i, speaker: subUser(f.speaker) || '', text: subUser(f.text) || '' }); } return out; },
      // オート送り待ち時間(ms): 表示(タイプライター)＋読了猶予をテキスト長から算出(固定間隔でなくデータ依存)
      autoDelayMs() { const fr = S.frames[S.idx]; if (!fr) return 2000; const len = (subUser(fr.text) || '').length; const cps = o.textCps || 45; return Math.round(len * 1000 / cps + 800 + len * 45); },
      setOpts(p) { if (S.stage) { S.stage.setOpts(p); renderFrame(); } },
      // 音声制御(タブ離脱/復帰/リセット用)。pauseAudioは状態保持し復帰時resumeBgmで続き、stopAudioはcurBgmを消して次エピソードで鳴り直す。
      pauseAudio() { if (els.bgm) els.bgm.pause(); if (els.se) els.se.pause(); if (els.audio) els.audio.pause(); },
      resumeBgm() { const a = els.bgm; if (a && S.curBgm && a.src) a.play().catch(() => {}); },
      stopAudio() { if (els.bgm) els.bgm.pause(); if (els.se) els.se.pause(); if (els.audio) els.audio.pause(); S.curBgm = null; },
      get count() { return S.frames.length; },
      get index() { return S.idx; },
      firstStill() { for (let i = 0; i < S.frames.length; i++) if (S.frames[i].still) return i; return 0; },
      // 台詞テキスト一致で最初のフレーム番号を返す(行検索からのジャンプ用)。空白差を無視。無ければ-1。
      indexOfText(q) {
        if (!q) return -1;
        const needle = subUser(String(q)).replace(/\s+/g, '');
        if (!needle) return -1;
        for (let i = 0; i < S.frames.length; i++) { const t = subUser(S.frames[i].text || '').replace(/\s+/g, ''); if (t && t.includes(needle)) return i; }
        return -1;
      },
      atEnd() { return S.idx >= S.frames.length - 1; },
      dispose() { if (S.stage) S.stage.dispose(); },
    };
  }

  globalThis.TP_STORY_ENGINE = { create };
})();
