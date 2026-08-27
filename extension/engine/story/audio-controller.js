import { audioOut } from '../../core/audio-gain.js';
import { unityDecode } from '../../unity/decode.js';
import { assetStore } from '../../data/asset-store.js';
import { ensureIndexes } from '../../data/index-store.js';
import { DIRS } from '../../core/constants.js';
import { utilHelpers } from '../../core/util.js';
import { scenarioSettings } from './scenario-settings.js';
import { createBgmEngine } from '../../core/bgm-engine.js';
const { audioBlobUrl, cachedAudioUrl, sleep, revokeUrlMap } = utilHelpers;
const TTS_MIN_REAL_MS = 350;

function create(deps) {
  const els = deps.els || {};
  const masterVol = deps.masterVol || (() => 0.5);
  const bgmEnabled = deps.bgmEnabled || (() => true);
  const voiceEnabled = deps.voiceEnabled || (() => true);
  const ttsMode = deps.ttsMode || (() => 'off');
  const readBundle = deps.readBundle;
  const getEp = deps.getEp || (() => null);
  const getGen = deps.getGen || (() => null);
  const getCurrentText = deps.getCurrentText || (() => '');

  const chVol = (ch) => masterVol() * scenarioSettings.volumeOf(ch);
  const onBgmPlaying = deps.onBgmPlaying || (() => {});
  const bgm = createBgmEngine({ onPlayingChange: onBgmPlaying });
  const st = {
    curBgm: null,
    bgmSrc: null,
    pendingBgm: null,
    bgmGen: 0,
    bgmBufs: new Map(),
    seUrls: new Map(),
    voiceUrls: new Map(),
    seMap: null,
    extractedSids: new Set(),
    ttsUtter: null,
    ttsState: 'idle',
    ttsGen: -1,
    jaVoice: null,
  };

  const applyLiveVolume = () => {
    if (els.bgm && !els.bgm.isConnected) {
      detachVolume();
      return;
    }
    bgm.setVolume(chVol('bgm'));
    audioOut.setVolume(els.se, chVol('se'));
    audioOut.setVolume(els.audio, chVol('voice'));
  };
  let unsubSettings = null;
  const detachVolume = () => {
    window.removeEventListener('tp:mastervol', applyLiveVolume);
    if (unsubSettings) unsubSettings();
    unsubSettings = null;
  };
  window.addEventListener('tp:mastervol', applyLiveVolume);
  unsubSettings = scenarioSettings.subscribe(applyLiveVolume);

  const ensureAudioUrl = (cache, key, path) =>
    cachedAudioUrl(cache, key, async () => {
      if (!path) return null;
      const b = await readBundle(path);
      if (!b) return null;
      let clips = [];
      try {
        clips = await unityDecode.extractAudioResource(b);
      } catch (e) {}
      return clips.length ? clips[0] : null;
    });
  const voiceJobs = new Map();
  async function ensureSceneVoice(sid, voicePath) {
    if (!sid || !voicePath || st.extractedSids.has(sid)) return;
    let job = voiceJobs.get(sid);
    if (!job) {
      job = (async () => {
        const b = await readBundle(voicePath);
        if (!b) return false;
        let clips = [];
        try {
          clips = await unityDecode.extractVoiceClips(b);
        } catch (e) {}
        for (const c of clips) if (!st.voiceUrls.has(c.name)) st.voiceUrls.set(c.name, audioBlobUrl(c.data, c.mime));
        return true;
      })();
      voiceJobs.set(sid, job);
      job
        .then((ok) => {
          if (ok) st.extractedSids.add(sid);
        })
        .catch(() => {})
        .finally(() => voiceJobs.delete(sid));
    }
    try {
      await job;
    } catch (e) {}
  }
  const clearVoiceSrc = (a) => {
    if (!a.getAttribute('src')) return;
    a.removeAttribute('src');
    try {
      a.load();
    } catch (e) {}
  };
  async function playVoice(fr, gen) {
    const a = els.audio;
    if (!a) return;
    if (!fr.voice || !voiceEnabled()) {
      if (!scenarioSettings.voiceContinues() || (voiceEnabled() && ttsMode() === 'on')) a.pause();
      return;
    }
    a.pause();
    clearVoiceSrc(a);
    await ensureSceneVoice(fr._sid, fr._voicePath);
    if (gen != null && gen !== getGen()) return;
    const url = st.voiceUrls.get(fr.voice);
    if (!url) return;
    a.src = url;
    audioOut.setVolume(a, chVol('voice'));
    a.play().catch(() => {});
  }
  const synthObj = () => window.speechSynthesis || null;
  function pickJaVoice(s) {
    try {
      return (s.getVoices() || []).find((v) => /ja(-|_)?JP/i.test(v.lang) || /japanese/i.test(v.name)) || null;
    } catch (e) {
      return null;
    }
  }
  function cancelTts() {
    const s = synthObj();
    if (s) {
      try {
        s.cancel();
      } catch (e) {}
    }
    st.ttsUtter = null;
    st.ttsState = 'idle';
    st.ttsGen = -1;
  }
  function stopAllAudio() {
    bgm.pause();
    if (els.se) els.se.pause();
    if (els.audio) els.audio.pause();
    cancelTts();
  }
  function speakCurrent(gen, audible) {
    const s = synthObj();
    if (!s) {
      st.ttsGen = gen;
      st.ttsState = 'unavailable';
      return;
    }
    if (st.ttsGen === gen && st.ttsUtter) return;
    const text = getCurrentText() || '';
    st.ttsGen = gen;
    try {
      s.cancel();
    } catch (e) {}
    if (!text) {
      st.ttsUtter = null;
      st.ttsState = 'done';
      return;
    }
    if (!st.jaVoice) st.jaVoice = pickJaVoice(s);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    if (st.jaVoice) u.voice = st.jaVoice;
    u.volume = audible ? Math.min(1, masterVol() * 1.8) : 0;
    st.ttsUtter = u;
    st.ttsState = 'speaking';
    const startedAt = Date.now();
    u.onend = () => {
      if (st.ttsUtter === u) st.ttsState = Date.now() - startedAt < TTS_MIN_REAL_MS ? 'unavailable' : 'done';
    };
    u.onerror = () => {
      if (st.ttsUtter === u) st.ttsState = 'unavailable';
    };
    try {
      s.speak(u);
    } catch (e) {
      st.ttsState = 'unavailable';
    }
  }
  async function resolveSe(name) {
    const ep = getEp();
    if (ep && ep.se && ep.se[name]) return ep.se[name];
    const key = 'se:' + String(name).toLowerCase();
    if (st.seMap && st.seMap[key] !== undefined) return st.seMap[key];
    if (!st.seMap) st.seMap = {};
    let path = null;
    try {
      const rel = ((await ensureIndexes()).assets.sceneAssetIndex || {})[key];
      const p = rel ? await assetStore.locate(DIRS.shared, rel) : null;
      path = p ? DIRS.shared + '/' + p : null;
    } catch (e) {}
    st.seMap[key] = path;
    return path;
  }
  async function playSe(fr, gen) {
    const a = els.se;
    if (!a || !fr.se) return;
    const url = await ensureAudioUrl(st.seUrls, fr.se, await resolveSe(fr.se));
    if (gen != null && gen !== getGen()) return;
    if (!url) return;
    a.src = url;
    a.currentTime = 0;
    audioOut.setVolume(a, chVol('se'));
    a.play().catch(() => {});
  }
  async function bgmBufOf(key, path) {
    if (!path) return null;
    if (st.bgmBufs.has(key)) return st.bgmBufs.get(key);
    let buf = null;
    try {
      const b = await readBundle(path);
      if (b) {
        let clips = [];
        try {
          clips = await unityDecode.extractAudioResource(b);
        } catch (e) {}
        if (clips.length) buf = await bgm.decode(clips[0].data);
      }
    } catch (e) {}
    st.bgmBufs.set(key, buf);
    return buf;
  }
  function stopBgm() {
    bgm.stop();
    st.curBgm = null;
    st.bgmSrc = null;
    st.pendingBgm = null;
    st.bgmGen++;
  }
  function fadeOutBgm(sec) {
    if (!bgm.isPlaying() || !(sec > 0)) return stopBgm();
    const gen = st.bgmGen;
    bgm.fade(0, sec);
    setTimeout(
      () => {
        if (gen === st.bgmGen) stopBgm();
      },
      sec * 1000 + 150,
    );
  }
  async function playBgm(fr) {
    if (!bgmEnabled()) {
      if (fr.bgm != null) st.pendingBgm = fr.bgm;
      if (st.curBgm) bgm.pause();
      return;
    }
    st.pendingBgm = null;
    const cue = unityDecode.bgmCue(fr.bgm);
    const name = cue.name;
    if (cue.stop) {
      if (!st.curBgm) return;
      st.curBgm = null;
      const gen = ++st.bgmGen;
      if (cue.delay > 0) await sleep(cue.delay * 1000);
      if (gen === st.bgmGen) fadeOutBgm(cue.fade);
      return;
    }
    if (st.curBgm === name) {
      bgm.setVolume(chVol('bgm'));
      if (!bgm.isPlaying() && st.bgmSrc === name) bgm.play();
      return;
    }
    const gen = ++st.bgmGen;
    st.curBgm = name;
    if (cue.delay > 0) {
      await sleep(cue.delay * 1000);
      if (gen !== st.bgmGen) return;
    }
    st.bgmSrc = null;
    const ep = getEp() || {};
    const loopPath = (ep.bgm && ep.bgm[name]) || null;
    if (!loopPath) {
      bgm.stop();
      return;
    }
    const introPath = (ep.bgmIntro && ep.bgmIntro[name]) || null;
    const loopBuf = await bgmBufOf(name, loopPath);
    const introBuf = introPath ? await bgmBufOf(name + '_intro', introPath) : null;
    if (gen !== st.bgmGen) return;
    if (!loopBuf) {
      bgm.stop();
      st.curBgm = null;
      return;
    }
    st.bgmSrc = name;
    bgm.setTrack(introBuf, loopBuf);
    bgm.setLoop(true);
    bgm.setVolume(chVol('bgm'));
    bgm.play();
  }
  function refreshBgm() {
    if (!bgmEnabled()) {
      bgm.pause();
      return;
    }
    if (st.pendingBgm != null) {
      const cue = st.pendingBgm;
      st.pendingBgm = null;
      playBgm({ bgm: cue });
      return;
    }
    if (!st.curBgm || !st.bgmSrc) return;
    bgm.setVolume(chVol('bgm'));
    if (!bgm.isPlaying()) bgm.play();
  }
  function resetUrls() {
    revokeUrlMap(st.voiceUrls);
    voiceJobs.clear();
    st.extractedSids.clear();
    revokeUrlMap(st.seUrls);
    st.seMap = null;
    st.bgmBufs.clear();
  }
  function dispose() {
    detachVolume();
    revokeUrlMap(st.voiceUrls);
    revokeUrlMap(st.seUrls);
    bgm.dispose();
  }
  return {
    chVol,
    applyLiveVolume,
    playVoice,
    playSe,
    playBgm,
    stopBgm,
    fadeOutBgm,
    refreshBgm,
    speakCurrent,
    cancelTts,
    stopAllAudio,
    resetUrls,
    dispose,
    hasTts: () => !!synthObj(),
    get ttsState() {
      return st.ttsState;
    },
  };
}

export const audioController = { create };
