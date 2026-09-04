import { settings } from '../../core/settings.js';
import { DIRS } from '../../core/dirs.js';
import { DEFAULT_PLAYER_NAME } from '../../core/username.js';
import { getById } from '../../core/dom.js';
import { episodeIdOf } from '../../data/character-meta.js';
import { playEndCredits, END_CREDIT_EPISODE_ID } from '../../engine/story/end-credits.js';
import { ensureIndexes } from '../../data/index-store.js';
import { assetStore } from '../../data/asset-store.js';
import { unityMesh } from '../../unity/mesh.js';
import { scenarioSettings } from '../../engine/story/scenario-settings.js';
import { audioScene } from '../runtime/audio-scene.js';

export function createCreditsRunner({ getEpisode, getPlayer, masterVol }) {
  let running = false;
  let cancelFn = null;
  let shownFor = null;

  async function resolveSprites() {
    const out = { specialThanksCanvas: null, titleLogoCanvas: null };
    let bytes = null;
    try {
      const idx = await ensureIndexes();
      const sceneRel = (idx.assets.sharedIndex || []).find((r) => /^scenes_scenes_endcredits_/.test(r));
      if (!sceneRel || !(await assetStore.hasAsset(DIRS.shared, sceneRel))) return out;
      bytes = await assetStore.readAsset(DIRS.shared, sceneRel);
    } catch (e) {}
    if (!bytes) return out;
    let texs = [];
    try {
      texs = unityMesh.decodeNamedTextureCanvases(bytes) || [];
    } catch (e) {
      console.warn('[tp] エンドクレジットの画像を展開できませんでした', e);
    }
    const pick = (re) => (texs.find((t) => re.test(t.name || '')) || {}).canvas || null;
    out.specialThanksCanvas = pick(/special.?thanks/i);
    out.titleLogoCanvas = pick(/title.?logo/i) || pick(/(^|_)logo(_|$)/i);
    return out;
  }

  async function maybePlay() {
    const curEp = getEpisode();
    if (running || !curEp) return;
    if (String(episodeIdOf(curEp)) !== String(END_CREDIT_EPISODE_ID)) return;
    if (shownFor === String(episodeIdOf(curEp))) return;
    const host = getById('stage');
    if (!host) return;
    running = true;
    shownFor = String(episodeIdOf(curEp));
    let bgmRel = null;
    try {
      bgmRel = ((await ensureIndexes()).assets.sceneAssetIndex || {})['bgm_2059'] || null;
    } catch (e) {}
    const sprites = await resolveSprites();
    const player = getPlayer();
    if (player) {
      try {
        player.stopBgm();
      } catch (e) {}
    }
    playEndCredits({
      host,
      bgmRel,
      userName: settings.get('playerName') || DEFAULT_PLAYER_NAME,
      specialThanksCanvas: sprites.specialThanksCanvas,
      titleLogoCanvas: sprites.titleLogoCanvas,
      volume: () => masterVol() * (scenarioSettings ? scenarioSettings.volumeOf('bgm') : 1),
      bgmEnabled: audioScene.storyAudible,
      gen: () => running,
      register: (fn) => {
        cancelFn = fn;
      },
      onDone: () => {
        running = false;
        cancelFn = null;
      },
    });
  }

  function reset() {
    if (cancelFn) {
      const fn = cancelFn;
      cancelFn = null;
      fn();
    }
    running = false;
    shownFor = null;
  }

  return { maybePlay, reset };
}
