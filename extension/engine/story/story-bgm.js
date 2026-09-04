import { unityDecode } from '../../unity/decode.js';
import { sleep } from '../../core/async.js';
import { createBgmEngine } from '../../core/bgm-engine.js';

export function createStoryBgm({ readBundle, enabled, volume, getEp }) {
  const engine = createBgmEngine();
  let cur = null;
  let src = null;
  let pending = null;
  let gen = 0;
  const bufs = new Map();

  async function bufOf(key, path) {
    if (!path) return null;
    if (bufs.has(key)) return bufs.get(key);
    let buf = null;
    let b = null;
    try {
      b = await readBundle(path);
    } catch (e) {}
    let clips = [];
    if (b) {
      try {
        clips = await unityDecode.extractAudioResource(b);
      } catch (e) {}
    }
    if (clips.length) {
      try {
        buf = await engine.decode(clips[0].data);
      } catch (e) {}
    }
    bufs.set(key, buf);
    return buf;
  }

  function stop() {
    engine.stop();
    cur = null;
    src = null;
    pending = null;
    gen++;
  }

  function fadeOut(sec) {
    if (!engine.isPlaying() || !(sec > 0)) return stop();
    const g = gen;
    engine.fade(0, sec);
    setTimeout(
      () => {
        if (g === gen) stop();
      },
      sec * 1000 + 150,
    );
  }

  async function play(frame) {
    if (!enabled()) {
      if (frame.bgm != null) pending = frame.bgm;
      if (cur) engine.pause();
      return;
    }
    pending = null;
    const cue = unityDecode.bgmCue(frame.bgm);
    const name = cue.name;
    if (cue.stop) {
      if (!cur) return;
      cur = null;
      const g = ++gen;
      if (cue.delay > 0) await sleep(cue.delay * 1000);
      if (g === gen) fadeOut(cue.fade);
      return;
    }
    if (cur === name) {
      engine.setVolume(volume());
      if (!engine.isPlaying() && src === name) engine.play();
      return;
    }
    const g = ++gen;
    cur = name;
    if (cue.delay > 0) {
      await sleep(cue.delay * 1000);
      if (g !== gen) return;
    }
    src = null;
    const ep = getEp() || {};
    const loopPath = (ep.bgm && ep.bgm[name]) || null;
    if (!loopPath) {
      engine.stop();
      return;
    }
    const introPath = (ep.bgmIntro && ep.bgmIntro[name]) || null;
    const loopBuf = await bufOf(name, loopPath);
    const introBuf = introPath ? await bufOf(name + '_intro', introPath) : null;
    if (g !== gen) return;
    if (!loopBuf) {
      engine.stop();
      cur = null;
      return;
    }
    src = name;
    engine.setTrack(introBuf, loopBuf);
    engine.setLoop(true);
    engine.setVolume(volume());
    engine.play();
  }

  function refresh() {
    if (!enabled()) {
      engine.pause();
      return;
    }
    if (pending != null) {
      const cue = pending;
      pending = null;
      play({ bgm: cue });
      return;
    }
    if (!cur || !src) return;
    engine.setVolume(volume());
    if (!engine.isPlaying()) engine.play();
  }

  return {
    play,
    stop,
    fadeOut,
    refresh,
    pause: () => engine.pause(),
    setVolume: (v) => engine.setVolume(v),
    clearCache: () => bufs.clear(),
    dispose: () => engine.dispose(),
  };
}
