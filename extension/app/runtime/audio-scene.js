const RELEASE_MS = 400;
const scene = { storyVisible: false, bgmPriority: false, homeWants: false, otherBgm: false };
const subs = new Set();
const playing = new Set();
const releaseTimers = new Map();

function notify() {
  for (const fn of subs) {
    try {
      fn(scene);
    } catch (e) {
      console.error('[tp] audioScene subscriber failed', e);
    }
  }
}

function set(patch) {
  let changed = false;
  for (const k of Object.keys(patch)) {
    if (scene[k] === patch[k]) continue;
    scene[k] = patch[k];
    changed = true;
  }
  if (changed) notify();
}

function applyPlaying() {
  const v = playing.size > 0;
  if (scene.otherBgm === v) return;
  scene.otherBgm = v;
  notify();
}

function report(source, isPlaying) {
  const t = releaseTimers.get(source);
  if (t) {
    clearTimeout(t);
    releaseTimers.delete(source);
  }
  if (isPlaying) {
    if (playing.has(source)) return;
    playing.add(source);
    applyPlaying();
    return;
  }
  if (!playing.has(source)) return;
  releaseTimers.set(
    source,
    setTimeout(() => {
      releaseTimers.delete(source);
      playing.delete(source);
      applyPlaying();
    }, RELEASE_MS),
  );
}

export const audioScene = {
  set,
  report,
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
  storyAudible: () => scene.storyVisible && !(scene.bgmPriority && scene.homeWants),
  homeAudible: () => scene.bgmPriority || !scene.otherBgm,
  bgmPriority: () => scene.bgmPriority,
};
