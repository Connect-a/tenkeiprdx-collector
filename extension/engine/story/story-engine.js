import { unityCrunch } from '../../unity/crunch.js';
import { assetStore } from '../../data/asset-store.js';
import { unityDecode } from '../../unity/decode.js';
import { fileStore } from '../../core/fsdir.js';
import { ensureIndexes } from '../../data/index-store.js';
import { DIRS, DEFAULT_PLAYER_NAME } from '../../core/constants.js';
import { unityMesh as MESH_MOD } from '../../unity/mesh.js';
import { stageGl } from './stage-gl.js';
import { scenarioUi } from './scenario-ui.js';
import { vfxAssets } from './vfx-assets.js';
import { scenarioSettings } from './scenario-settings.js';
import { sceneModel } from './scene-model.js';
import { audioController } from './audio-controller.js';
import { sceneEffects } from './scene-effects.js';
import { PLACE } from '../../core/placement.js';
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
const EMO_MAP = {
  1: 'Pleasure',
  2: 'Sad',
  3: 'Angry',
  4: 'Amazing',
  5: 'Panicked',
  6: 'Shy',
  7: 'Love',
  8: 'Question',
  10: 'Disorder',
  11: 'Gloomy',
  12: 'Idea',
  13: 'Sigh',
  14: 'Sigh',
  15: 'Trouble',
  16: 'Sparkle',
  17: 'Silence',
  18: 'Burn',
};

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
  const subUser = (s) => (s == null ? s : String(s).replace(/%username%/gi, playerName() || DEFAULT_PLAYER_NAME));
  const ST = {
    folderHandle: null,
    meta: null,
    ep: null,
    frames: [],
    idx: 0,
    gen: 0,
    stage: null,
    bgCache: new Map(),
    emoAtlas: null,
    revealRaf: 0,
    revealFull: '',
    revealing: false,
    autoActive: false,
    sceneById: null,
    choiceGroups: null,
    visited: null,
    pendingChoice: null,
    carryBgm: null,
  };
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
    onBgmPlaying: o.onBgmPlaying,
  });
  const fx = sceneEffects.create({ els, readBundle, getEp: () => ST.ep });
  function applyBgParallax(cam) {
    if (o.bgEl) o.bgEl.style.transform = `scale(${cam.zoom || 1}) translate(${-(cam.panX || 0) * 100}%, ${(cam.panY || 0) * 100}%)`;
  }

  function stopReveal() {
    if (ST.revealRaf) {
      cancelAnimationFrame(ST.revealRaf);
      ST.revealRaf = 0;
    }
    ST.revealing = false;
  }
  function startReveal(full) {
    stopReveal();
    ST.revealFull = full || '';
    const el = els.text;
    if (!el) return;
    const ms = scenarioSettings.textMs();
    if (!ST.revealFull || !ms) {
      el.textContent = ST.revealFull;
      return;
    }
    el.textContent = '';
    ST.revealing = true;
    const t0 = performance.now();
    const step = () => {
      if (!ST.revealing) return;
      const n = Math.min(ST.revealFull.length, Math.floor((performance.now() - t0) / ms));
      el.textContent = ST.revealFull.slice(0, n);
      if (n >= ST.revealFull.length) {
        stopReveal();
        return;
      }
      ST.revealRaf = requestAnimationFrame(step);
    };
    ST.revealRaf = requestAnimationFrame(step);
  }
  function completeReveal() {
    stopReveal();
    if (els.text) els.text.textContent = ST.revealFull;
  }

  function decodeBundleCanvas(bytes) {
    try {
      return MESH_MOD.decodeTextureCanvas(bytes);
    } catch (e) {
      return null;
    }
  }
  async function loadSkel(key, path) {
    if (!ST.stage) return null;
    let rec = ST.stage._skels.get(key);
    if (rec) return rec;
    let bytes = null;
    try {
      bytes = await readBundle(path);
    } catch (e) {}
    if (!bytes) return null;
    const inp = MESH_MOD.extractSpineInputs(bytes);
    if (!inp) return null;
    return ST.stage.ensure(key, inp);
  }
  function loadSkelFromBytes(key, bytes) {
    if (!ST.stage) return null;
    const cached = ST.stage._skels.get(key);
    if (cached) return cached;
    const inp = bytes && MESH_MOD.extractSpineInputs(bytes);
    if (!inp) return null;
    return ST.stage.ensure(key, inp);
  }
  let _castFolders = null;
  async function castFolderMap() {
    if (_castFolders) return _castFolders;
    _castFolders = {};
    try {
      for (const d of await fileStore.listFolderDirs()) _castFolders[String(d.folderKey)] = d.handle;
    } catch (e) {}
    return _castFolders;
  }
  async function ownCastBytes(id) {
    try {
      const h = (await castFolderMap())[id];
      if (!h) return null;
      let idx;
      try {
        idx = await ensureIndexes();
      } catch (e) {
        return null;
      }
      const a = idx.assets.assetIndex[id];
      if (!a) return null;
      for (const cat of ['spine', 'spinelight']) {
        const rel = (a[cat] || [])[0];
        if (!rel) continue;
        const b = await assetStore.readAsset(h, rel, PLACE.visual(cat));
        if (b) return b;
      }
    } catch (e) {}
    return null;
  }
  async function sharedCastBytes(id) {
    let idx;
    try {
      idx = await ensureIndexes();
    } catch (e) {
      return null;
    }
    const a = idx.assets.assetIndex[id];
    if (!a) return null;
    const cat = a.spine && a.spine.length ? 'spine' : 'spinelight';
    const rel = (a[cat] || [])[0] || null;
    if (!rel) return null;
    return await assetStore.readAsset(DIRS.shared, rel);
  }
  async function castBytes(id, routedPath) {
    id = String(id);
    const own = await ownCastBytes(id);
    if (own) return own;
    if (routedPath) {
      const b = await readBundle(routedPath);
      if (b) return b;
    }
    return await sharedCastBytes(id);
  }

  function renderEmotions(fr) {
    if (!ST.stage || !ST.stage.setEmotions) return;
    if (!ST.emoAtlas || fr.still) {
      if (ST.stage.clearEmotions) ST.stage.clearEmotions();
      return;
    }
    const list = [];
    for (const c of fr.cast) {
      if (!c.emo) continue;
      const nm = EMO_MAP[c.emo];
      if (!nm) continue;
      const sp = ST.emoAtlas.get(nm);
      if (!sp) continue;
      list.push({ id: c.id, code: c.emo, name: nm, sprite: sp });
    }
    ST.stage.setEmotions(list);
  }

  async function loadBgCanvas(bgId) {
    if (!bgId) return null;
    let cv = ST.bgCache.get(bgId);
    if (!cv) {
      const path = (ST.ep.bg && ST.ep.bg[bgId]) || null;
      if (path) {
        const b = await readBundle(path);
        if (b) {
          try {
            cv = decodeBundleCanvas(b);
          } catch (e) {}
        }
      }
      if (cv) ST.bgCache.set(bgId, cv);
    }
    return cv;
  }
  function bgElement(cv, bgId) {
    let el;
    if (cv instanceof HTMLCanvasElement) {
      el = document.createElement('canvas');
      el.width = cv.width;
      el.height = cv.height;
      try {
        el.getContext('2d').drawImage(cv, 0, 0);
      } catch (e) {}
    } else {
      el = document.createElement('div');
      el.textContent = bgId;
      el.style.background = '#000';
    }
    el.style.position = 'absolute';
    el.style.left = el.style.top = '0';
    el.style.width = el.style.height = '100%';
    return el;
  }
  async function crossfadeBg(bgHost, bgId, flip, fadeMs, gen, instant) {
    const cv = await loadBgCanvas(bgId);
    if (gen !== ST.gen) return;
    const el = bgElement(cv, bgId);
    el.style.transform = flip ? 'scaleX(-1)' : '';
    if (getComputedStyle(bgHost).position === 'static') bgHost.style.position = 'relative';
    const dur = instant ? 0 : Number(fadeMs) > 0 ? Number(fadeMs) : 500;
    if (!bgHost.children.length || dur <= 0) {
      el.style.opacity = '1';
      el.style.transition = '';
      bgHost.innerHTML = '';
      bgHost.appendChild(el);
      return;
    }
    el.style.opacity = '0';
    el.style.transition = `opacity ${dur}ms linear`;
    bgHost.appendChild(el);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    el.style.opacity = '1';
    await new Promise((r) => setTimeout(r, dur));
    if (gen !== ST.gen) {
      el.remove();
      return;
    }
    for (const c of [...bgHost.children]) if (c !== el) c.remove();
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
        if (ST.revealing) return;
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
    else autoWaitImpl(myToken).then((ok) => { if (myToken === ST.autoToken && gen === ST.gen && ok !== false) advance(); });
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
          await crossfadeBg(bgHost, step.bg, step.flip, step.fade, gen, instant);
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
      if (ST.stage) ST.stage.setCamera(fr.cam);
      if (els.speaker) {
        els.speaker.style.display = 'none';
        setText(els.speaker, '');
      }
      if (els.text) setText(els.text, '');
      audio.playBgm(fr);
      return;
    }
    const cast = (ST.meta.routing && ST.meta.routing.cast) || {};
    if (fr.still) {
      const path = (ST.ep.cg && (ST.ep.cg[fr.still] || ST.ep.cg[String(fr.still)])) || null;
      const rec = path ? await loadSkel('still:' + fr.still, path) : null;
      if (gen !== ST.gen) return;
      if (rec && !rec.dead) ST.stage.showStill(rec, fr.stillAnim, fr.stillSpeed > 0 ? fr.stillSpeed / 1000 : 1);
      else ST.stage.clear();
    } else {
      const casts = [];
      for (const c of fr.cast) {
        const entry = cast[String(c.id)] || cast[c.id];
        const path = entry && (entry.spine || entry.spinelight);
        const rec = loadSkelFromBytes('c' + c.id, await castBytes(c.id, path));
        if (gen !== ST.gen) return;
        if (!rec) continue;
        const speaking = fr.speakerPos ? (fr.speakerPos & (SPKFLAG[c.pos] || 0)) !== 0 : true;
        if (rec && !rec.dead)
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
    renderEmotions(fr);
    fx.playFrameEffect(fr, ST.idx);
    fx.applyAmbient(fr.ambient);
    fx.applyInsert(fr.insert);
    if (els.speaker) els.speaker.style.display = fr.speaker ? '' : 'none';
    setText(els.speaker, subUser(fr.speaker) || '');
    if (els.text) {
      els.text.style.textAlign = fr.center ? 'center' : '';
      els.text.style.fontSize = FONT_PX[fr.fontSize] || '';
    }
    startReveal(subUser(fr.text) || '');
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
      ST.folderHandle = folderHandle;
      ST.meta = meta;
      ST.ep = ep;
      await crunchReady(4000);
      if (!ST.stage) {
        ST.stage = stageGl.create(o.canvas, Object.assign({ onCam: applyBgParallax, mosaicOn: o.mosaicOn, onStill: o.onStill }, o.stageOpts || {}));
      }
      if (!ST.emoAtlas && scenarioUi) {
        try {
          ST.emoAtlas = await scenarioUi.loadStage('emotion');
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
      if (els.emoLayer) els.emoLayer.innerHTML = '';
      ST.bgCache.clear();
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
        ST.carryBgm = null;
        await extendChoiceChain(String((ep.scenes[0] || {}).sceneId), frames);
      } else {
        let carryBgm = null;
        for (const s of ep.scenes || []) {
          const r = await loadAndAppendScene(s, frames, carryBgm);
          carryBgm = r.carry;
        }
      }
      ST.frames = frames;
      try {
        const vfxCodes = new Set();
        for (const fr of frames)
          for (const e of fr.effects || []) {
            const c = Number(e && e.code);
            if (c >= 11 && c <= 18) vfxCodes.add(c);
          }
        for (const c of vfxCodes) vfxAssets.loadVfxByCode(c).catch(() => {});
      } catch (e) {}
      const seekIdx = options && options.seekText ? frameIndexOfText(options.seekText) : -1;
      ST.idx = seekIdx >= 0 ? seekIdx : 0;
      ST.intro = false;
      if (ST.introTimer) {
        clearTimeout(ST.introTimer);
        ST.introTimer = null;
      }
      ST.introResolve = null;
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
        ST.intro = false;
        ST.introResolve = null;
        ST.introTimer = null;
        await renderFrame();
      } else if (frames.length) {
        await renderFrame(seekIdx >= 0 ? { instant: true } : undefined);
      }
      return frames.length;
    },
    inIntro() {
      return !!ST.intro;
    },
    skipIntro() {
      if (ST.introTimer) {
        clearTimeout(ST.introTimer);
        ST.introTimer = null;
      }
      const r = ST.introResolve;
      ST.introResolve = null;
      if (r) r();
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
      if (ST.intro) return this.skipIntro();
      if (ST.revealing) return completeReveal();
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
      if (ST.revealing) return 'revealing';
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
      return !!ST.revealing;
    },
    completeReveal() {
      completeReveal();
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
      if (ST.stage && ST.stage.setStillVisibility) ST.stage.setStillVisibility(map);
    },
    setUserZoom(v) {
      if (ST.stage && ST.stage.setUserZoom) ST.stage.setUserZoom(v);
    },
    setUserPan(x, y) {
      if (ST.stage && ST.stage.setUserPan) ST.stage.setUserPan(x, y);
    },
    setStillClean(v) {
      if (ST.stage && ST.stage.setStillClean) ST.stage.setStillClean(v);
    },
    setStillSpeed(v) {
      if (ST.stage && ST.stage.setStillSpeed) ST.stage.setStillSpeed(v);
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
      stopReveal();
      audio.stopAllAudio();
      audio.stopBgm();
      clearAuto();
      fx.setNoise(false);
      fx.clearLines();
      fx.clearEye();
      fx.clearVfx();
      if (ST.stage) ST.stage.dispose();
      audio.dispose();
    },
  };
}

export const storyEngine = { create };
