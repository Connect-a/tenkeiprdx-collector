import { settings } from '../../core/settings.js';
import { DEFAULT_PLAYER_NAME } from '../../core/username.js';
import { episodeIdOf } from '../../data/character-meta.js';
import { createCreditsRunner } from './story-credits.js';
import { createStillPanel } from './story-still.js';
import { playDokidokiIntro, DOKIDOKI_EPISODE_ID } from '../../engine/story/dokidoki-intro.js';
import { ensureIndexes } from '../../data/index-store.js';
import { folderHandle } from '../runtime/state-refresh.js';
import { assetAcquirer } from '../../data/acquire/acquire-assemble.js';

let storyHud = null;
let storyEngine = null;
let scenarioSettings = null;
let storyModsP = null;
function loadStoryMods() {
  if (!storyModsP)
    storyModsP = Promise.all([import('../../engine/story/scenario-hud.js'), import('../../engine/story/story-engine.js'), import('../../engine/story/scenario-settings.js')]).then(([a, b, c]) => {
      storyHud = a.storyHud;
      storyEngine = b.storyEngine;
      scenarioSettings = c.scenarioSettings;
    });
  return storyModsP;
}

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
  let _lastFolderKey = null;

  let _panX = 0,
    _panY = 0,
    _zoom = 1,
    _moveMode = false,
    _dragBound = false;
  const applyPan = () => {
    if (player && player.setUserPan) player.setUserPan(_panX, _panY);
  };
  function bindStageDrag() {
    const host = getById('stage');
    if (!host || _dragBound) return;
    _dragBound = true;
    let dragging = false,
      sx = 0,
      sy = 0,
      bx = 0,
      by = 0;
    host.addEventListener('pointerdown', (e) => {
      if (!_moveMode) return;
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      bx = _panX;
      by = _panY;
      try {
        host.setPointerCapture(e.pointerId);
      } catch (x) {}
      e.preventDefault();
    });
    host.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      _panX = bx + (e.clientX - sx);
      _panY = by + (e.clientY - sy);
      applyPan();
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      try {
        host.releasePointerCapture(e.pointerId);
      } catch (x) {}
    };
    host.addEventListener('pointerup', end);
    host.addEventListener('pointercancel', end);
    host.addEventListener(
      'click',
      (e) => {
        if (_moveMode) e.stopImmediatePropagation();
      },
      true,
    );
    host.addEventListener(
      'wheel',
      (e) => {
        if (!_moveMode) return;
        e.preventDefault();
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;
        else if (e.deltaMode === 2) dy *= 400;
        _zoom = Math.max(0.5, Math.min(4, _zoom * Math.exp(-Math.max(-120, Math.min(120, dy)) * 0.0012)));
        if (player && player.setUserZoom) player.setUserZoom(_zoom);
      },
      { passive: false },
    );
  }
  const setMoveMode = (on) => {
    _moveMode = !!on;
    const host = getById('stage');
    if (host) host.style.cursor = _moveMode ? 'grab' : '';
  };
  const resetView = () => {
    _panX = 0;
    _panY = 0;
    _zoom = 1;
    applyPan();
    if (player && player.setUserZoom) player.setUserZoom(1);
  };
  function updateBgHiddenNotice() {
    const n = getById('bgHiddenNotice');
    if (!n) return;
    const ctr = getById('controls');
    const inStory = ctr && ctr.style.display !== 'none';
    n.style.display = inStory && settings.get('stillBackImgHidden') ? '' : 'none';
  }
  const setBackImgHidden = (on) => {
    if (hud && hud.bgEl) hud.bgEl.style.display = on ? 'none' : '';
    settings.set('stillBackImgHidden', !!on);
    updateBgHiddenNotice();
  };
  const applyStageToggles = () => {
    if (hud && hud.bgEl) hud.bgEl.style.display = settings.get('stillBackImgHidden') ? 'none' : '';
    updateBgHiddenNotice();
  };

  const episodeList = () => (playerState.cur && playerState.cur.meta && playerState.cur.meta.episodes) || [];
  const nextEpisode = () => {
    const eps = episodeList();
    const i = eps.findIndex((e) => curEp && String(e.episodeId) === String(curEp.episodeId));
    return i < 0 ? null : eps.slice(i + 1).find((e) => e.have !== 'none') || null;
  };
  const episodeName = (ep) => [ep.label, nameFix(ep.title || '')].filter(Boolean).join('　');
  async function offerNextEpisode(opts) {
    const next = nextEpisode();
    if (!next) return;
    const ok = await hud.ask({
      text: '次の話「' + episodeName(next) + '」',
      countdown: 5,
      countdownText: (n) => n + '秒で次の話に移動します…',
    });
    if (!ok) return;
    await playEpisode(next);
    if (opts && opts.wasAuto) hud.setAuto(true);
  }

  const still = createStillPanel({ getPlayer: () => player, setBackImgHidden });
  const credits = createCreditsRunner({ getEpisode: () => curEp, getPlayer: () => player, masterVol });
  let _dokidokiIntro = null;
  function cancelDokidokiIntro() {
    if (_dokidokiIntro) {
      const it = _dokidokiIntro;
      _dokidokiIntro = null;
      try {
        it.cancel();
      } catch (e) {}
    }
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
    try {
      await loadStoryMods();
    } catch (e) {}
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
        showProg(true);
        updateProg();
      },
      onFrame: () => updateProg(),
      onEnd: () => {
        if (hud && hud.reachEnd) hud.reachEnd();
        credits.maybePlay();
      },
      onChoice: (pc) => {
        if (hud && hud.showChoices) hud.showChoices(pc);
      },
      canAutoAdvance: () => (hud && hud.canAdvance ? hud.canAdvance() : true),
      playerName: () => settings.get('playerName') || DEFAULT_PLAYER_NAME,
      mosaicOn: () => settings.get('storyMosaic'),
      onStill: (slots) => still.render(slots),
    });
    hud.bind(player);
    bindStageDrag();
    await hud.theme();
    return player;
  }

  function selectEpisodeRow(ep) {
    const box = getById('eplist');
    if (!box) return;
    const id = String(episodeIdOf(ep));
    box.querySelectorAll('.eprow').forEach((r) => r.classList.toggle('sel', r.dataset.epid === id));
  }

  const _altMeta = new Map();
  async function resolveSource(ep) {
    const own = { handle: playerState.cur.handle, meta: playerState.cur.meta, ep };
    if (!ep.linkTo) return own;
    const { folderKey, episodeId } = ep.linkTo;
    const handle = folderHandle(folderKey);
    if (!handle) return null;
    let meta = _altMeta.get(folderKey);
    if (!meta) {
      try {
        meta = await assetAcquirer.charMetaFull(folderKey);
      } catch (e) {}
      if (meta) _altMeta.set(folderKey, meta);
    }
    const target = meta && (meta.episodes || []).find((e) => String(episodeIdOf(e)) === String(episodeId));
    return target ? { handle, meta, ep: target } : null;
  }

  async function playEpisode(ep, seekText) {
    if (!playerState.cur || !ep) return;
    audioScene.set({ storyPlaying: true });
    if (hud) hud.cancelAsk();
    credits.reset();
    cancelDokidokiIntro();
    const fk = playerState.cur.folderKey;
    if (fk !== _lastFolderKey) {
      still.forgetMemory();
      _lastFolderKey = fk;
    }
    still.collapse();
    const host = getById('stage'),
      ctr = getById('controls');
    if (host) host.style.display = '';
    if (ctr) ctr.style.display = '';
    const p = await ensurePlayer();
    if (!p) return stopOwning();
    curEp = ep;
    selectEpisodeRow(ep);
    applyPan();
    applyStageToggles();
    hud.stopAuto();
    hud.setReady(false);
    hud.fit();
    const src = await resolveSource(ep);
    if (!src) {
      if (ctr) ctr.style.display = 'none';
      showProg(false);
      hud.setReady(true);
      notify('R18版のデータが保存先にありません（その他エピソードから取得してください）', 'err');
      return stopOwning();
    }
    const isDokidoki = String(episodeIdOf(ep)) === String(DOKIDOKI_EPISODE_ID) && !seekText;
    if (isDokidoki) {
      let bgRel = null,
        bgmRel = null,
        seRel = null;
      let idx = null;
      try {
        idx = await ensureIndexes();
      } catch (e) {
        console.warn('[tp] 索引を読めませんでした', e);
      }
      if (idx) {
        const sai = idx.assets.sceneAssetIndex || {};
        const shared = idx.assets.sharedIndex || [];
        bgRel = sai['bg_eventstill_2093'] || shared.find((r) => /(^|\/)bg_eventstill_2093(_|\.)/.test(r)) || null;
        bgmRel = sai['bgm_2014'] || shared.find((r) => /(^|\/)bgm_2014(_|\.)/.test(r)) || null;
        seRel = shared.find((r) => /click\.wav/i.test(r)) || null;
      }
      hud.setReady(true);
      const intro = playDokidokiIntro({
        host,
        bgRel,
        bgmRel,
        seRel,
        volume: () => masterVol() * (scenarioSettings ? scenarioSettings.volumeOf('bgm') : 1),
        bgmEnabled: audioScene.storyAudible,
      });
      _dokidokiIntro = intro;
      await intro.started;
      if (_dokidokiIntro !== intro) return;
      _dokidokiIntro = null;
      hud.setReady(false);
    }
    try {
      await hud.theme(isDokidoki ? 'tokimeki' : null);
    } catch (e) {}
    let n = 0;
    try {
      n = await p.open(src.handle, src.meta, src.ep, { seekText, noIntro: isDokidoki, initBgm: isDokidoki ? 'bgm_2014' : null });
    } catch (e) {
      console.error('[tp] ストーリー描画に失敗', e);
    }
    if (!n) {
      if (ctr) ctr.style.display = 'none';
      showProg(false);
      hud.setReady(true);
      notify('この話の演出データが見つかりません（再DLで補完できる場合があります）', 'err');
      return stopOwning();
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
    credits.reset();
    const i = Math.round(Math.min(1, Math.max(0, frac)) * (player.count - 1));
    player.render(i);
  }

  function go(d) {
    if (!hud) return;
    credits.reset();
    if (d < 0) hud.back();
    else hud.advance();
  }
  const stopOwning = () => audioScene.set({ storyPlaying: false });

  function reset() {
    stopOwning();
    if (hud) hud.cancelAsk();
    if (hud) hud.stopAuto();
    if (player) player.stopAudio();
    still.reset();
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
    if (hud) hud.cancelAsk();
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

  return {
    playEpisode,
    cancelAutoNext: () => hud && hud.cancelAsk(),
    go,
    reset,
    onTabSwitched,
    jumpFrac,
    setUserZoom: (v) => player && player.setUserZoom && player.setUserZoom(v),
    replayVoice: () => player && player.replayVoice && player.replayVoice(),
    toggleStill: () => still.toggle(),
    setMoveMode,
    resetView,
    setBackImgHidden,
    backImgHidden: () => settings.get('stillBackImgHidden'),
  };
}
