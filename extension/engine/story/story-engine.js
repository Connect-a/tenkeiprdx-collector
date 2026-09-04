import { unityCrunch } from '../../unity/crunch.js';
import { unityDecode } from '../../unity/decode.js';
import { fileStore } from '../../core/fsdir.js';
import { DEFAULT_PLAYER_NAME, applyUserName } from '../../core/username.js';
import { unityMesh as MESH_MOD } from '../../unity/mesh.js';
import { stageGl } from './stage-gl.js';
import { createCastSource } from './cast-source.js';
import { CAST_CATS } from '../../data/character-meta.js';
import { createStoryBg } from './story-bg.js';
import { createTextReveal } from './text-reveal.js';
import { scenarioUi } from './scenario-ui.js';
import { vfxAssets } from './vfx-assets.js';
import { scenarioSettings } from './scenario-settings.js';
import { sceneModel } from './scene-model.js';
import { audioController } from './audio-controller.js';
import { sceneEffects } from './scene-effects.js';
const AUTO_VOICE_GAP_MS = 400;
const AUTO_VOICE_LOAD_CAP_MS = 2500;
const AUTO_TTS_MIN_GAP_MS = 500;
const AUTO_TTS_CAP_MS = 30000;
const AUTO_READ_BASE_MS = 800;
const AUTO_READ_PER_CHAR_MS = 120;
const AUTO_READ_MIN_MS = 1500;
const AUTO_READ_MAX_MS = 24000;
const readWaitMs = (text) => {
  const n = String(text || '').replace(/\s/g, '').length;
  if (!n) return AUTO_READ_MIN_MS;
  const revealed = n * scenarioSettings.textMs();
  return Math.max(AUTO_READ_MIN_MS, Math.min(AUTO_READ_MAX_MS, AUTO_READ_BASE_MS + AUTO_READ_PER_CHAR_MS * n - revealed));
};
const INTRO_WAIT_MS = 2700;
const POSMAP = { 0: 0, 1: -326, 2: -196, 3: 0, 4: 196, 5: 326 };
const SPKFLAG = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 };
const FACE_ANIM = ['idle_normal', 'idle_joy', 'idle_sad', 'idle_angry', 'idle_surprise', 'idle_unique', 'idle_shy'];
async function crunchReady(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (unityCrunch && unityCrunch.canDecodeCrunched()) return true;
    await new Promise((r) => setTimeout(r, 120));
  }
  return !!(unityCrunch && unityCrunch.canDecodeCrunched());
}

function create(opts) {
  const o = opts || {};
  const els = o.els || {};
  const voiceEnabled = o.voiceEnabled || (() => true);
  const bgmEnabled = o.bgmEnabled || (() => true);
  const ttsMode = o.ttsMode || (() => 'off');
  const masterVol = o.masterVol || (() => 0.5);
  const playerName = typeof o.playerName === 'function' ? o.playerName : () => o.playerName || DEFAULT_PLAYER_NAME;
  const subUser = (s) => applyUserName(s, playerName());
  const ST = {
    folderHandle: null,
    meta: null,
    ep: null,
    frames: [],
    idx: 0,
    gen: 0,
    stage: null,
    emotionAtlas: null,
    autoActive: false,
    sceneById: null,
    choiceGroups: null,
    visited: null,
    pendingChoice: null,
    carryBgm: null,
    openGen: 0,
    intro: false,
    introTimer: null,
    introResolve: null,
  };
  function endIntro() {
    ST.intro = false;
    if (ST.introTimer) {
      clearTimeout(ST.introTimer);
      ST.introTimer = null;
    }
    const resolve = ST.introResolve;
    ST.introResolve = null;
    if (resolve) resolve();
  }
  const FONT_PX = { 1: '20px', 2: '14px', 3: '24px', 4: '32px' };
  const setText = (el, v) => {
    if (el) el.textContent = v;
  };
  const readBundle = (p) => fileStore.readBundleUnder(ST.folderHandle, p);
  const audio = audioController.create({
    els,
    masterVol,
    bgmEnabled,
    voiceEnabled,
    ttsMode,
    readBundle,
    getEp: () => ST.ep,
    getGen: () => ST.gen,
    getCurrentText: () => subUser((ST.frames[ST.idx] || {}).text) || '',
  });
  const fx = sceneEffects.create({ els, readBundle, getEp: () => ST.ep });
  function applyBgParallax(cam) {
    if (o.bgEl) o.bgEl.style.transform = `scale(${cam.zoom || 1}) translate(${-(cam.panX || 0) * 100}%, ${(cam.panY || 0) * 100}%)`;
  }

  const reveal = createTextReveal(() => els.text);
  const castSource = createCastSource(readBundle);
  const bg = createStoryBg({ readBundle, getEp: () => ST.ep, getGen: () => ST.gen });

  function ensureSkeleton(key, getBytes) {
    if (!ST.stage) return null;
    return ST.stage.ensureSkeleton(key, async () => MESH_MOD.extractSpineInputs(await getBytes()));
  }

  function autoWaitImpl(token) {
    const gen = ST.gen,
      a = els.audio,
      fr = ST.frames[ST.idx];
    const gameVoiced = !!(fr && fr.voice && voiceEnabled());
    const mode = ttsMode(),
      useTts = mode === 'on' && audio.hasTts();
    const readMs = readWaitMs(fr && fr.text);
    return new Promise((resolve) => {
      let revealAt = 0;
      const done = (ok) => {
        clearInterval(iv);
        resolve(ok);
      };
      const finishAfter = (ms) => {
        clearInterval(iv);
        setTimeout(() => resolve(gen === ST.gen), ms);
      };
      const iv = setInterval(() => {
        if (gen !== ST.gen || (token != null && token !== ST.autoToken)) return done(false);
        if (reveal.revealing) return;
        if (!revealAt) revealAt = Date.now();
        if (gameVoiced) {
          const ready = a && a.src && a.duration > 0 && !isNaN(a.duration);
          if (ready) {
            if (a.ended || a.currentTime >= a.duration - 0.06) finishAfter(AUTO_VOICE_GAP_MS);
            return;
          }
          if (Date.now() - revealAt > AUTO_VOICE_LOAD_CAP_MS) return done(true);
          return;
        }
        if (useTts) {
          audio.speakCurrent(gen, true);
          if (audio.ttsState === 'unavailable') {
            if (Date.now() - revealAt >= readMs) return done(true);
            return;
          }
          if (audio.ttsState === 'done' || Date.now() - revealAt > AUTO_TTS_CAP_MS) return finishAfter(AUTO_TTS_MIN_GAP_MS);
          return;
        }
        if (Date.now() - revealAt >= readMs) return done(true);
      }, 60);
    });
  }
  function clearAuto() {
    ST.autoToken = (ST.autoToken || 0) + 1;
    if (ST.autoTimer) {
      clearTimeout(ST.autoTimer);
      ST.autoTimer = null;
    }
  }
  function scheduleAuto(gen, opts) {
    clearAuto();
    const myToken = ST.autoToken;
    if (opts && (opts.instant || opts.bgOnly)) return;
    const fr = ST.frames[ST.idx];
    if (!fr) return;
    const isBeat = !!fr.auto;
    if (!isBeat && !ST.autoActive) return;
    const advance = () => {
      ST.autoTimer = null;
      if (myToken !== ST.autoToken || gen !== ST.gen) return;
      if ((globalThis.document && globalThis.document.hidden) || (o.canAutoAdvance && !o.canAutoAdvance())) {
        ST.autoTimer = setTimeout(advance, 200);
        return;
      }
      if (ST.bgBusy) {
        ST.autoTimer = setTimeout(advance, 120);
        return;
      }
      if (ST.idx < ST.frames.length - 1) {
        ST.idx++;
        renderFrame();
      } else if (o.onEnd) {
        try {
          o.onEnd();
        } catch (e) {}
      }
    };
    if (isBeat) ST.autoTimer = setTimeout(advance, fr.auto);
    else
      autoWaitImpl(myToken).then((ok) => {
        if (myToken === ST.autoToken && gen === ST.gen && ok !== false) advance();
      });
  }
  async function renderFrame(opts) {
    const gen = ++ST.gen;
    clearAuto();
    const fr = ST.frames[ST.idx];
    if (!fr) return;
    const bgHost = o.bgEl;
    const paintBg = async () => {
      if (!fr.bg || !bgHost) return;
      const instant = !!(opts && (opts.instant || opts.bgOnly));
      const seq = instant ? [{ bg: fr.bg, fade: 0, flip: fr.bgFlip }] : [...(fr.bgVia || []), { bg: fr.bg, fade: fr.bgFade, flip: fr.bgFlip }];
      const needXfade = !instant && seq.some((s) => s.bg !== ST.curBg || !!s.flip !== !!ST.curFlip);
      if (needXfade) ST.bgBusy = true;
      try {
        for (const step of seq) {
          if (step.bg === ST.curBg && !!step.flip === !!ST.curFlip) continue;
          await bg.crossfade(bgHost, step.bg, step.flip, step.fade, gen, instant);
          if (gen !== ST.gen) return;
          ST.curBg = step.bg;
          ST.curFlip = !!step.flip;
        }
      } finally {
        ST.bgBusy = false;
      }
    };
    const blackTransition = !!(fr.bgVia && fr.bgVia.length) && !(opts && (opts.instant || opts.bgOnly));
    if (blackTransition && ST.stage) {
      ST.stage.clear();
      if (els.speaker) {
        els.speaker.style.display = 'none';
        setText(els.speaker, '');
      }
      if (els.text) setText(els.text, '');
    }
    if (!fr.still) await paintBg();
    if (opts && opts.bgOnly) {
      if (fr.still) await paintBg();
      if (gen !== ST.gen) return;
      if (ST.stage) {
        ST.stage.clear();
        ST.stage.setCamera(fr.cam);
      }
      if (els.speaker) {
        els.speaker.style.display = 'none';
        setText(els.speaker, '');
      }
      if (els.text) setText(els.text, '');
      audio.playBgm(fr);
      return;
    }
    const castRouting = (ST.meta.routing && ST.meta.routing.cast) || {};
    if (fr.still) {
      const path = (ST.ep.cg && (ST.ep.cg[fr.still] || ST.ep.cg[String(fr.still)])) || null;
      const rec = path ? await ensureSkeleton('still:' + fr.still, () => readBundle(path)) : null;
      if (gen !== ST.gen) return;
      if (rec) ST.stage.showStill(rec, fr.stillAnim, fr.stillSpeed > 0 ? fr.stillSpeed / 1000 : 1);
      else ST.stage.clear();
    } else {
      const casts = [];
      for (const c of fr.cast) {
        const entry = castRouting[String(c.id)] || castRouting[c.id];
        const path = entry && CAST_CATS.map((cat) => entry[cat]).find(Boolean);
        const rec = await ensureSkeleton('c' + c.id, () => castSource.bytesFor(c.id, path));
        if (gen !== ST.gen) return;
        if (!rec) continue;
        const speaking = fr.speakerPos ? (fr.speakerPos & (SPKFLAG[c.pos] || 0)) !== 0 : true;
        casts.push({
          rec,
          id: c.id,
          appear: c.app,
          act: c.act,
          emo: c.emo,
          posMapX: POSMAP[c.pos] != null ? POSMAP[c.pos] : 0,
          flip: !!c.flip,
          unityAnim: FACE_ANIM[c.face] || 'idle_normal',
          speaking,
          zoom: !!c.zoom,
        });
      }
      ST.stage.setCast(casts);
    }
    if (gen !== ST.gen) return;
    if (ST.stage) ST.stage.setCamera(fr.cam);
    if (fr.still) await paintBg();
    if (gen !== ST.gen) return;
    fx.playFrameEffect(fr, ST.idx);
    fx.applyAmbient(fr.ambient);
    fx.applyInsert(fr.insert);
    if (els.speaker) els.speaker.style.display = fr.speaker ? '' : 'none';
    setText(els.speaker, subUser(fr.speaker) || '');
    if (els.text) {
      els.text.style.textAlign = fr.center ? 'center' : '';
      els.text.style.fontSize = FONT_PX[fr.fontSize] || '';
    }
    reveal.start(subUser(fr.text) || '');
    if (els.meta)
      setText(
        els.meta,
        `#${fr.i}  bg=${fr.bg || '-'}  bgm=${fr.bgm || '-'}${fr.still ? '  still=' + fr.still + '/' + (fr.stillAnim || '?') : ''}  cast=[${fr.cast.map((c) => c.id + '@' + c.pos + (c.face ? ':f' + c.face : '')).join(',')}]`,
      );
    setText(els.prog, `${ST.idx + 1} / ${ST.frames.length}`);
    audio.playVoice(fr, gen);
    audio.playSe(fr, gen);
    audio.playBgm(fr);
    const gameVoiced = !!(fr.voice && voiceEnabled()),
      mode = ttsMode();
    if (!gameVoiced && mode === 'on') audio.speakCurrent(gen, true);
    else audio.cancelTts();
    if (o.onFrame) {
      try {
        o.onFrame(fr, ST.folderHandle, ST.ep);
      } catch (e) {}
    }
    if (ST.idx >= ST.frames.length - 1 && ST.pendingChoice && o.onChoice) {
      try {
        o.onChoice(ST.pendingChoice);
      } catch (e) {}
    }
    scheduleAuto(gen, opts);
  }

  async function loadAndAppendScene(sceneEntry, frames, carryBgm) {
    if (!sceneEntry) return { meta: null, carry: carryBgm };
    const b = await readBundle(sceneEntry.scene);
    if (!b) return { meta: null, carry: carryBgm };
    let dec = null;
    try {
      dec = unityDecode.decodeSceneBin(b);
    } catch (e) {}
    if (!dec) return { meta: null, carry: carryBgm };
    const fs = sceneModel.sceneFrames(dec, carryBgm);
    for (const fr of fs) {
      fr._sid = String(sceneEntry.sceneId);
      fr._voicePath = sceneEntry.voice;
      frames.push(fr);
    }
    const carry = fs.length && fs[fs.length - 1].bgm != null ? fs[fs.length - 1].bgm : carryBgm;
    return { meta: unityDecode.sceneMeta(dec), carry };
  }

  async function extendChoiceChain(startSid, frames) {
    let cur = startSid ? String(startSid) : null;
    ST.pendingChoice = null;
    while (cur && !ST.visited.has(cur)) {
      ST.visited.add(cur);
      const { meta, carry } = await loadAndAppendScene(ST.sceneById.get(cur), frames, ST.carryBgm);
      ST.carryBgm = carry;
      if (!meta) break;
      if (meta.choiceGroup && ST.choiceGroups && ST.choiceGroups[meta.choiceGroup]) {
        ST.pendingChoice = { group: meta.choiceGroup, members: ST.choiceGroups[meta.choiceGroup] };
        return;
      }
      if (meta.next) {
        cur = meta.next;
        continue;
      }
      break;
    }
  }

  function frameIndexOfText(q) {
    if (!q) return -1;
    const needle = subUser(String(q)).replace(/\s+/g, '');
    if (!needle) return -1;
    for (let i = 0; i < ST.frames.length; i++) {
      const t = subUser(ST.frames[i].text || '').replace(/\s+/g, '');
      if (t && t.includes(needle)) return i;
    }
    return -1;
  }

  return {
    async open(folderHandle, meta, ep, options) {
      const gen = ++ST.openGen;
      ST.folderHandle = folderHandle;
      ST.meta = meta;
      ST.ep = ep;
      await crunchReady(4000);
      if (!ST.stage) {
        ST.stage = stageGl.create(
          o.canvas,
          Object.assign({ onCam: applyBgParallax, mosaicOn: o.mosaicOn, onStill: o.onStill, emotionSprite: (name) => (ST.emotionAtlas ? ST.emotionAtlas.get(name) : null) }, o.stageOpts || {})
        );
      }
      if (!ST.emotionAtlas && scenarioUi) {
        try {
          ST.emotionAtlas = await scenarioUi.loadStage('emotion');
        } catch (e) {}
      }
      audio.stopAllAudio();
      fx.clearVfx();
      fx.clearLines();
      fx.clearEye();
      fx.setNoise(false);
      fx.resetFxIdx();
      ST.stage.clear();
      if (o.bgEl) o.bgEl.innerHTML = '';
      ST.curBg = null;
      ST.curFlip = false;
      bg.clearCache();
      audio.resetUrls();
      audio.stopBgm();
      ST.pendingChoice = null;
      ST.sceneById = null;
      ST.choiceGroups = null;
      ST.visited = null;
      ST.carryBgm = null;
      const frames = [];
      const useChoices = !!(ep.choiceGroups && Object.keys(ep.choiceGroups).length && (ep.scenes || []).length);
      if (useChoices) {
        ST.sceneById = new Map((ep.scenes || []).map((s) => [String(s.sceneId), s]));
        ST.choiceGroups = ep.choiceGroups;
        ST.visited = new Set();
        ST.carryBgm = (options && options.initBgm) || null;
        await extendChoiceChain(String((ep.scenes[0] || {}).sceneId), frames);
      } else {
        let carryBgm = (options && options.initBgm) || null;
        for (const s of ep.scenes || []) {
          const r = await loadAndAppendScene(s, frames, carryBgm);
          carryBgm = r.carry;
        }
      }
      ST.frames = frames;
      const vfxCodes = new Set();
      for (const fr of frames)
        for (const e of fr.effects || []) {
          const c = Number(e && e.code);
          if (c >= 11 && c <= 18) vfxCodes.add(c);
        }
      for (const c of vfxCodes) vfxAssets.loadVfxByCode(c).catch((e) => console.warn('[tp] VFXの先読みに失敗', c, e));
      const seekIdx = options && options.seekText ? frameIndexOfText(options.seekText) : -1;
      ST.idx = seekIdx >= 0 ? seekIdx : 0;
      endIntro();
      const doIntro = frames.length && seekIdx < 0 && !(options && options.noIntro);
      if (doIntro) {
        await renderFrame({ bgOnly: true });
        ST.intro = true;
        if (o.onIntroTitle) {
          try {
            o.onIntroTitle(ep);
          } catch (e) {}
        }
        await new Promise((res) => {
          ST.introResolve = res;
          ST.introTimer = setTimeout(res, INTRO_WAIT_MS);
        });
        if (gen !== ST.openGen) return frames.length;
        endIntro();
        await renderFrame();
      } else if (frames.length) {
        await renderFrame(seekIdx >= 0 ? { instant: true } : undefined);
      }
      return frames.length;
    },
    inIntro() {
      return !!ST.intro;
    },
    go(d) {
      if (!ST.frames.length || ST.bgBusy) return;
      const ni = Math.max(0, Math.min(ST.frames.length - 1, ST.idx + d));
      if (ni === ST.idx) return;
      ST.idx = ni;
      return renderFrame();
    },
    next() {
      return this.go(1);
    },
    prev() {
      return this.go(-1);
    },
    render(i) {
      if (i != null) ST.idx = Math.max(0, Math.min(ST.frames.length - 1, i));
      return renderFrame();
    },
    advance() {
      if (ST.intro) return;
      if (reveal.revealing) return reveal.complete();
      if (ST.idx >= ST.frames.length - 1) {
        if (o.onEnd)
          try {
            o.onEnd();
          } catch (e) {}
        return;
      }
      return this.go(1);
    },
    back() {
      if (ST.intro) return;
      return this.go(-1);
    },
    mode() {
      if (!ST.frames.length) return 'idle';
      if (ST.intro) return 'intro';
      if (reveal.revealing) return 'revealing';
      if (ST.idx >= ST.frames.length - 1) return 'ended';
      return 'playing';
    },
    pendingChoice() {
      return ST.idx >= ST.frames.length - 1 && ST.pendingChoice ? ST.pendingChoice : null;
    },
    async choose(sceneMasterId) {
      if (!ST.pendingChoice || !ST.sceneById) return;
      const from = ST.frames.length;
      await extendChoiceChain(String(sceneMasterId), ST.frames);
      if (ST.frames.length > from) {
        ST.idx = from;
        await renderFrame();
      }
    },
    isRevealing() {
      return reveal.revealing;
    },
    completeReveal() {
      reveal.complete();
    },
    replayVoice() {
      const fr = ST.frames[ST.idx];
      if (!fr) return;
      if (fr.voice && voiceEnabled()) audio.playVoice(fr);
      else if (ttsMode() !== 'off' && audio.hasTts && audio.hasTts()) {
        audio.cancelTts();
        audio.speakCurrent(ST.gen, true);
      }
    },
    backlog() {
      const out = [];
      for (let i = 0; i <= ST.idx && i < ST.frames.length; i++) {
        const f = ST.frames[i];
        if (f.text || f.speaker) out.push({ idx: i, speaker: subUser(f.speaker) || '', text: subUser(f.text) || '' });
      }
      return out;
    },
    autoWait() {
      return autoWaitImpl();
    },
    pauseAudio() {
      audio.stopAllAudio();
    },
    setAutoActive(on) {
      ST.autoActive = !!on;
      if (!on) audio.cancelTts();
      scheduleAuto(ST.gen);
    },
    stopTts() {
      audio.cancelTts();
    },
    stopVoice() {
      if (els.audio) els.audio.pause();
    },
    refreshBgm() {
      audio.refreshBgm();
    },
    setStillVisibility(map) {
      if (ST.stage) ST.stage.setStillVisibility(map);
    },
    setUserZoom(v) {
      if (ST.stage) ST.stage.setUserZoom(v);
    },
    setUserPan(x, y) {
      if (ST.stage) ST.stage.setUserPan(x, y);
    },
    setStillClean(v) {
      if (ST.stage) ST.stage.setStillClean(v);
    },
    setStillSpeed(v) {
      if (ST.stage) ST.stage.setStillSpeed(v);
    },
    stopAudio() {
      audio.stopAllAudio();
      audio.stopBgm();
      clearAuto();
      fx.setNoise(false);
      fx.clearLines();
      fx.clearEye();
      fx.clearVfx();
    },
    get count() {
      return ST.frames.length;
    },
    get index() {
      return ST.idx;
    },
    firstStill() {
      for (let i = 0; i < ST.frames.length; i++) if (ST.frames[i].still) return i;
      return 0;
    },
    indexOfText(q) {
      return frameIndexOfText(q);
    },
    atEnd() {
      return ST.idx >= ST.frames.length - 1;
    },
    dispose() {
      reveal.stop();
      audio.stopAllAudio();
      audio.stopBgm();
      clearAuto();
      fx.setNoise(false);
      fx.clearLines();
      fx.clearEye();
      fx.clearVfx();
      fx.dispose();
      if (ST.stage) ST.stage.dispose();
      audio.dispose();
    },
  };
}

export const storyEngine = { create };
