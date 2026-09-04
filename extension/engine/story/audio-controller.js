import { audioOut } from '../../core/audio-gain.js';
import { unityDecode } from '../../unity/decode.js';
import { assetStore } from '../../data/asset-store.js';
import { ensureIndexes } from '../../data/index-store.js';
import { DIRS } from '../../core/dirs.js';
import { audioBlobUrl, cachedAudioUrl, revokeUrlMap } from '../../core/audio-url.js';
import { scenarioSettings } from './scenario-settings.js';
import { createTts } from './tts.js';
import { createStoryBgm } from './story-bgm.js';

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
  const bgm = createStoryBgm({ readBundle, enabled: bgmEnabled, volume: () => chVol('bgm'), getEp });
  const st = {
    seUrls: new Map(),
    voiceUrls: new Map(),
    seMap: null,
    extractedSids: new Set(),
  };
  const tts = createTts({ getCurrentText, masterVol });

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
  function stopAllAudio() {
    bgm.pause();
    if (els.se) els.se.pause();
    if (els.audio) els.audio.pause();
    tts.cancel();
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
  function resetUrls() {
    revokeUrlMap(st.voiceUrls);
    voiceJobs.clear();
    st.extractedSids.clear();
    revokeUrlMap(st.seUrls);
    st.seMap = null;
    bgm.clearCache();
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
    playBgm: (fr) => bgm.play(fr),
    stopBgm: () => bgm.stop(),
    fadeOutBgm: (sec) => bgm.fadeOut(sec),
    refreshBgm: () => bgm.refresh(),
    speakCurrent: (gen, audible) => tts.speak(gen, audible),
    cancelTts: () => tts.cancel(),
    stopAllAudio,
    resetUrls,
    dispose,
    hasTts: () => tts.available(),
    get ttsState() {
      return tts.state;
    },
  };
}

export const audioController = { create };
