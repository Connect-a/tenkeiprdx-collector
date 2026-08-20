import { audioOut } from '../../core/audio-gain.js';

const audioEl = () => document.getElementById('audio');

function play(url) {
  const a = audioEl();
  if (!a || !url) return;
  a.src = url;
  a.play().catch(() => {});
}

function stop() {
  const a = audioEl();
  if (a && !a.paused) a.pause();
}

function setVolume(v) {
  audioOut.setVolume(audioEl(), v);
}

export const voiceOut = { play, stop, setVolume };
