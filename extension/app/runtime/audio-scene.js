const scene = { storyPlaying: false, homeWants: false, bgmPriority: false };
const subs = new Set();

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
    if (!(k in scene)) throw new Error('audioScene: 知らないキー ' + k);
    if (scene[k] === patch[k]) continue;
    scene[k] = patch[k];
    changed = true;
  }
  if (changed) notify();
}

const homeWins = () => scene.bgmPriority && scene.homeWants;

export const audioScene = {
  set,
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
  state: () => ({ ...scene }),
  homeAudible: () => scene.homeWants && (scene.bgmPriority || !scene.storyPlaying),
  storyAudible: () => scene.storyPlaying && !homeWins(),
  bgmPriority: () => scene.bgmPriority,
};
