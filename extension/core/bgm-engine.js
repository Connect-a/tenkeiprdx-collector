const MAX_GAIN = 1.5;
const LEAD = 0.02;

export function createBgmEngine({ onEnded, onPhaseChange, onPlayingChange } = {}) {
  let ctx = null;
  let gain = null;
  let vol = 1;
  let intro = null;
  let main = null;
  let phase = 'main';
  let loopMain = false;
  let playing = false;
  let introNode = null;
  let mainNode = null;
  let introStartT = 0;
  let introOff = 0;
  let mainStartT = 0;
  let mainOff = 0;
  let pausedIntroPos = 0;
  let pausedMainPos = 0;

  const clampVol = (v) => Math.max(0, Math.min(MAX_GAIN, Number(v) || 0));

  function setPlaying(v) {
    if (playing === v) return;
    playing = v;
    if (onPlayingChange) onPlayingChange(v);
  }

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      gain = ctx.createGain();
      gain.gain.value = vol;
      gain.connect(ctx.destination);
    }
    return ctx;
  }

  const hasIntro = () => !!intro;

  async function decode(bytes) {
    ac();
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return ctx.decodeAudioData(ab);
  }

  function clearNodes() {
    for (const n of [introNode, mainNode]) {
      if (!n) continue;
      try {
        n.onended = null;
        n.stop();
      } catch (e) {}
    }
    introNode = null;
    mainNode = null;
  }

  function makeSrc(buf, loop) {
    const n = ctx.createBufferSource();
    n.buffer = buf;
    n.loop = !!loop;
    n.connect(gain);
    return n;
  }

  function handleMainEnded() {
    if (!playing) return;
    setPlaying(false);
    clearNodes();
    pausedMainPos = 0;
    if (onEnded) onEnded();
  }

  function startNodes() {
    clearNodes();
    const t0 = ctx.currentTime + LEAD;
    if (phase === 'intro' && intro) {
      const off = Math.max(0, Math.min(introOff, intro.duration - 0.001));
      introOff = off;
      introStartT = t0;
      introNode = makeSrc(intro, false);
      introNode.start(t0, off);
      introNode.onended = () => {
        if (!introNode) return;
        introNode = null;
        phase = 'main';
        pausedIntroPos = intro ? intro.duration : 0;
        if (onPhaseChange) onPhaseChange();
      };
      if (main) {
        mainStartT = t0 + (intro.duration - off);
        mainOff = 0;
        mainNode = makeSrc(main, loopMain);
        mainNode.start(mainStartT, 0);
        if (!loopMain) mainNode.onended = handleMainEnded;
      }
    } else if (main) {
      phase = 'main';
      const off = loopMain ? mainOff % main.duration : Math.max(0, Math.min(mainOff, main.duration - 0.001));
      mainOff = off;
      mainStartT = t0;
      mainNode = makeSrc(main, loopMain);
      mainNode.start(t0, off);
      if (!loopMain) mainNode.onended = handleMainEnded;
    } else {
      return;
    }
    setPlaying(true);
  }

  function positionOf(which) {
    if (which === 'intro') {
      if (!intro) return 0;
      if (playing && phase === 'intro' && introNode) return Math.max(0, Math.min(intro.duration, ctx.currentTime - introStartT + introOff));
      return pausedIntroPos;
    }
    if (!main) return 0;
    if (playing && phase === 'main' && mainNode) {
      const e = Math.max(0, ctx.currentTime - mainStartT + mainOff);
      return loopMain ? e % main.duration : Math.min(main.duration, e);
    }
    return pausedMainPos;
  }

  function setTrack(introBuf, mainBuf) {
    clearNodes();
    setPlaying(false);
    intro = introBuf || null;
    main = mainBuf || null;
    phase = hasIntro() ? 'intro' : 'main';
    pausedIntroPos = 0;
    pausedMainPos = 0;
    introOff = 0;
    mainOff = 0;
  }

  function play() {
    if (playing || (!main && !intro)) return;
    ac();
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    introOff = pausedIntroPos;
    mainOff = pausedMainPos;
    startNodes();
  }

  function pause() {
    if (!playing) return;
    pausedIntroPos = positionOf('intro');
    pausedMainPos = positionOf('main');
    clearNodes();
    setPlaying(false);
  }

  function stop() {
    clearNodes();
    setPlaying(false);
    pausedIntroPos = 0;
    pausedMainPos = 0;
    introOff = 0;
    mainOff = 0;
    phase = hasIntro() ? 'intro' : 'main';
  }

  function seek(targetPhase, sec) {
    const wasPlaying = playing;
    clearNodes();
    setPlaying(false);
    if (targetPhase === 'intro' && intro) {
      phase = 'intro';
      pausedIntroPos = Math.max(0, Math.min(sec, intro.duration));
    } else if (main) {
      phase = 'main';
      pausedMainPos = loopMain ? ((sec % main.duration) + main.duration) % main.duration : Math.max(0, Math.min(sec, main.duration));
    }
    if (wasPlaying) play();
    else if (onPhaseChange) onPhaseChange();
  }

  function setLoop(v) {
    loopMain = !!v;
    if (mainNode) {
      mainNode.loop = loopMain;
      mainNode.onended = loopMain ? null : handleMainEnded;
    }
  }

  function setVolume(v) {
    vol = clampVol(v);
    if (gain) {
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(vol, now);
    }
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  function fade(target, seconds) {
    if (!gain) return;
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(clampVol(target), now + Math.max(0.01, seconds || 0));
  }

  function resumeCtx() {
    if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
  }

  function dispose() {
    clearNodes();
    setPlaying(false);
    if (ctx) {
      try {
        ctx.close();
      } catch (e) {}
    }
    ctx = null;
    gain = null;
  }

  return {
    decode,
    setTrack,
    hasIntro,
    play,
    pause,
    stop,
    seek,
    setLoop,
    setVolume,
    fade,
    resumeCtx,
    dispose,
    isPlaying: () => playing,
    phaseNow: () => (phase === 'intro' && hasIntro() ? 'intro' : 'main'),
    position: positionOf,
    duration: (which) => ((which === 'intro' ? intro : main) ? (which === 'intro' ? intro.duration : main.duration) : 0),
  };
}
