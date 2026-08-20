import { storyHud } from '../../engine/story/scenario-hud.js';
import { storyEngine } from '../../engine/story/story-engine.js';
import { scenarioSettings } from '../../engine/story/scenario-settings.js';
import { settings } from '../../core/settings.js';
export function createStoryPanel(deps) {
  const { playerState, getById, visualRenderer, nameFix, toast, masterVol, audioScene } = deps;
  const notify = (m, k) => {
    if (typeof toast === 'function') toast(m, k);
  };
  let hud = null,
    player = null,
    playerInitPromise = null,
    runtimeReady = false,
    curEp = null;

  const episodeList = () => (playerState.cur && playerState.cur.meta && playerState.cur.meta.episodes) || [];
  const nextEpisode = () => {
    const eps = episodeList();
    const i = eps.findIndex((e) => curEp && String(e.episodeId) === String(curEp.episodeId));
    return i < 0 ? null : eps.slice(i + 1).find((e) => e.have !== 'none') || null;
  };
  const episodeName = (ep) => [ep.label, nameFix(ep.title || '')].filter(Boolean).join('　');
  async function offerNextEpisode() {
    const next = nextEpisode();
    if (!next) return;
    const ok = await hud.ask({ text: '次の話「' + episodeName(next) + '」を続けて再生しますか？' });
    if (ok) await playEpisode(next);
  }

  const voiceMode = () => settings.get('voiceMode');
  const voiceOn = () => voiceMode() !== 'tts' && voiceMode() !== 'off';
  settings.subscribe((n) => {
    if (n !== 'voiceMode' || !player) return;
    player.stopTts();
    if (!voiceOn()) player.stopVoice();
  });

  const refreshBgm = () => {
    if (player && !document.hidden) player.refreshBgm();
  };
  audioScene.subscribe(refreshBgm);

  async function ensurePlayer() {
    if (player) return player;
    if (playerInitPromise) return playerInitPromise;
    playerInitPromise = initPlayer();
    try {
      return await playerInitPromise;
    } finally {
      if (!player) playerInitPromise = null;
    }
  }
  async function initPlayer() {
    const host = getById('stage');
    if (!host) return null;
    if (!storyHud || !storyEngine) {
      host.textContent = '再生モジュール未ロード';
      return null;
    }
    if (!runtimeReady && visualRenderer && visualRenderer.prepareSpineRuntime) {
      const r = await visualRenderer.prepareSpineRuntime(host);
      if (!r || !r.ok) return null;
      runtimeReady = true;
    }
    await scenarioSettings.load();
    hud = storyHud.create(host, { onEpisodeEnd: offerNextEpisode });
    player = storyEngine.create({
      canvas: hud.canvas,
      bgEl: hud.bgEl,
      els: hud.els,
      voiceEnabled: voiceOn,
      bgmEnabled: audioScene.storyAudible,
      ttsMode: () => (voiceMode() === 'voice+tts' || voiceMode() === 'tts' ? 'on' : 'off'),
      masterVol,
      stageOpts: { scaleMul: 1.0, refW: 1136, refH: 640 },
      onIntroTitle: (ep) => {
        hud.setReady(true);
        hud.showTitle(nameFix(ep.label || ''), nameFix(ep.title || ''));
      },
      onFrame: () => updateProg(),
      onEnd: () => {
        if (hud && hud.reachEnd) hud.reachEnd();
      },
      onChoice: (pc) => {
        if (hud && hud.showChoices) hud.showChoices(pc);
      },
      canAutoAdvance: () => (hud && hud.canAdvance ? hud.canAdvance() : true),
      onBgmPlaying: (playing) => audioScene.report('story', playing),
      playerName: () => settings.get('playerName') || '主人公',
    });
    hud.bind(player);
    await hud.theme();
    return player;
  }

  async function playEpisode(ep, seekText) {
    if (!playerState.cur || !ep) return;
    const host = getById('stage'),
      ctr = getById('controls');
    if (host) host.style.display = '';
    if (ctr) ctr.style.display = '';
    const p = await ensurePlayer();
    if (!p) return;
    curEp = ep;
    hud.stopAuto();
    hud.setReady(false);
    hud.fit();
    let n = 0;
    try {
      n = await p.open(playerState.cur.handle, playerState.cur.meta, ep, { seekText });
    } catch (e) {
      console.error('[tp] ストーリー描画に失敗', e);
    }
    if (!n) {
      if (ctr) ctr.style.display = 'none';
      showProg(false);
      hud.setReady(true);
      notify('この話の演出データが見つかりません（再DLで補完できる場合があります）', 'err');
      return;
    }
    hud.fit();
    hud.setReady(true);
    showProg(true);
    updateProg();
    refreshBgm();
  }

  function showProg(on) {
    const box = getById('storyProg');
    if (box) box.style.display = on ? '' : 'none';
  }
  function updateProg() {
    if (!player) return;
    const count = player.count,
      idx = player.index;
    const p = getById('prog');
    if (p) p.textContent = `${idx + 1} / ${count}`;
    const fill = getById('storyProgFill');
    if (fill) fill.style.width = (count > 1 ? (idx / (count - 1)) * 100 : count ? 100 : 0).toFixed(2) + '%';
  }
  function jumpFrac(frac) {
    if (!player || !player.count) return;
    if (hud) hud.stopAuto();
    const i = Math.round(Math.min(1, Math.max(0, frac)) * (player.count - 1));
    player.render(i);
  }

  function go(d) {
    if (!hud) return;
    if (d < 0) hud.back();
    else hud.advance();
  }
  function reset() {
    if (hud) hud.stopAuto();
    if (player) player.stopAudio();
    const host = getById('stage');
    if (host) host.style.display = 'none';
    const ctr = getById('controls');
    if (ctr) ctr.style.display = 'none';
    showProg(false);
  }
  function onTabSwitched(name) {
    if (name === 'story') {
      refreshBgm();
      return;
    }
    if (hud) hud.stopAuto();
    if (player) player.pauseAudio();
  }
  if (typeof document !== 'undefined')
    document.addEventListener('visibilitychange', () => {
      if (!player) return;
      if (!document.hidden) return refreshBgm();
      if (hud) hud.stopAuto();
      player.pauseAudio();
    });

  return { playEpisode, go, reset, onTabSwitched, jumpFrac };
}
