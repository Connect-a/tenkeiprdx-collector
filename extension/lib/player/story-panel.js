'use strict';
// TP_PLAYER_STORY — ストーリータブの演出再生コントローラ。
// 実ゲーム忠実のシナリオHUD(TP_STORY_HUD)＋再生エンジン(TP_STORY_ENGINE)をstoryタブへ埋め込む。
// イメージタブ(image-panel.js)と同じcreateController(deps)形＝上位(player.js)は薄い配線のみ。
// 依存: TP_STORY_HUD / TP_STORY_ENGINE / TP_STAGE_GL / TP_SCENARIO_UIと、遅延ロードのSpineランタイム(V.prepareSpineRuntime)。
(function () {
  function createController(deps) {
    const { S, $, V, nameFix, toast } = deps;
    const notify = (m, k) => { if (typeof toast === 'function') toast(m, k); };
    let hud = null, player = null, runtimeReady = false;

    async function ensurePlayer() {
      const host = $('stage');
      if (!host) return null;
      if (!globalThis.TP_STORY_HUD || !globalThis.TP_STORY_ENGINE) { host.textContent = '再生モジュール未ロード'; return null; }
      // TP_STAGE_GL(=生spine-webgl)がspineランタイムを要するため先に用意(イメージタブと共有の遅延ロード)。
      if (!runtimeReady && V && V.prepareSpineRuntime) { const r = await V.prepareSpineRuntime(host); if (!r || !r.ok) return null; runtimeReady = true; }
      if (player) return player;
      hud = globalThis.TP_STORY_HUD.create(host, { onSetting: () => { const v = $('voiceOn'); if (v) v.checked = !v.checked; } });
      player = globalThis.TP_STORY_ENGINE.create({
        canvas: hud.canvas, bgEl: hud.bgEl, els: hud.els,
        voiceEnabled: () => { const v = $('voiceOn'); return !v || v.checked; },
        emotionAtlasUrl: 'data/stage/emotion.bundle',
        stageOpts: { scaleMul: 1.0, baseline: -0.34, refW: 1136, refH: 640, stillZoom: 1.0, stillYShift: 0.5 },
        onFrame: () => { const p = $('prog'); if (p && player) p.textContent = `${player.index + 1} / ${player.count}`; },
      });
      hud.bind(player); await hud.theme();
      return player;
    }

    // ep=character.jsonのエピソード(scenes[].scene生bin＋cg/bg/se/bgmマップ)。seekText指定で該当台詞のフレームから再生(行検索用)。
    async function playEpisode(ep, seekText) {
      if (!S.cur || !ep) return;
      const host = $('stage'), ctr = $('controls');
      if (host) host.style.display = '';
      if (ctr) ctr.style.display = '';
      const p = await ensurePlayer();
      if (!p) return;
      hud.stopAuto();
      let n = 0;
      try { n = await p.open(S.cur.handle, S.cur.meta, ep); } catch (e) { console.error(e); }
      if (!n) { if (ctr) ctr.style.display = 'none'; notify('この話の演出データが見つかりません（再DLで補完できる場合があります）', 'err'); return; }
      hud.fit();
      const pos = (seekText && p.indexOfText) ? p.indexOfText(seekText) : -1;
      if (pos >= 0) p.render(pos);
      else hud.showTitle(nameFix(ep.label || ''), nameFix(ep.title || '')); // シーンタイトルカード
    }

    function go(d) { if (player) player.go(d); }
    function reset() {
      if (hud) hud.stopAuto();
      if (player) player.stopAudio();
      const host = $('stage'); if (host) host.style.display = 'none';
      const ctr = $('controls'); if (ctr) ctr.style.display = 'none';
    }
    // タブ切替: ストーリー以外へ移ったらBGM/SE/ボイスを止める(鳴り続け防止)、戻ったらBGMを続ける。
    function onTabSwitched(name) {
      if (!player) return;
      if (name === 'story') player.resumeBgm();
      else { if (hud) hud.stopAuto(); player.pauseAudio(); }
    }
    // ページ非表示(ブラウザのタブ切替/最小化)でも止める。
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.hidden && player) { if (hud) hud.stopAuto(); player.pauseAudio(); } });

    return { playEpisode, go, reset, onTabSwitched };
  }

  globalThis.TP_PLAYER_STORY = { createController };
})();
