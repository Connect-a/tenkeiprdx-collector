import { settings } from '../../core/settings.js';
import { DEFAULT_PLAYER_NAME } from '../../core/constants.js';
import { el, filterBox } from '../../core/dom.js';
import { episodeIdOf } from '../../data/character-meta.js';

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

const STILL_STATES = [
  ['1', '表示'],
  ['0.5', '半透明'],
  ['0', '非表示'],
];
let _radSeq = 0;
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
  let _stillVis = {},
    _stillSlots = null,
    _stillVisMem = {},
    _cleanOn = true,
    _stillSpeed = 1,
    _stillCollapsed = true,
    _lastFolderKey = null;
  const STILL_SPEEDS = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5];

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
  const setBackImgHidden = (on) => {
    if (hud && hud.bgEl) hud.bgEl.style.display = on ? 'none' : '';
    settings.set('stillBackImgHidden', !!on);
  };
  const applyStageToggles = () => {
    if (hud && hud.bgEl) hud.bgEl.style.display = settings.get('stillBackImgHidden') ? 'none' : '';
  };

  let _mosaicCb = null;
  const MOSAIC_TITLE = 'EXシーンの該当箇所にモザイクをかけます（ゲーム準拠）。';
  const updateMosaicLock = () => {
    const mos = _mosaicCb;
    if (!mos) return;
    const label = mos.closest('label');
    const lock = _cleanOn && Object.values(_stillVis).some((a) => a > 0 && a < 1);
    if (lock && settings.get('storyMosaic')) settings.set('storyMosaic', false);
    mos.checked = settings.get('storyMosaic');
    mos.disabled = lock;
    if (label) {
      label.classList.toggle('ctl-disabled', lock);
      label.setAttribute('title', lock ? 'クリーン半透明使用時はモザイクは使用できません' : MOSAIC_TITLE);
    }
  };
  const pushStillVis = () => {
    if (player && player.setStillVisibility) player.setStillVisibility(Object.keys(_stillVis).length ? _stillVis : null);
    updateMosaicLock();
  };
  const nextState = (cur) => {
    const order = [1, 0.5, 0];
    const i = order.findIndex((v) => v === (cur == null ? 1 : cur));
    return order[(i < 0 ? 0 : i + 1) % order.length];
  };
  const flashRow = (row) => {
    row.classList.remove('rowflash');
    void row.offsetWidth;
    row.classList.add('rowflash');
  };
  const setStillVal = (n, a) => {
    _stillVisMem[n] = a;
    _stillVis[n] = a;
  };
  const GROUP_KEY = { '♀': 'stillGroupFemale', '♂': 'stillGroupMale', '♂👐': 'stillGroupHand', '♂♂': 'stillGroupPenis', 背景: 'stillGroupBg', その他: 'stillGroupOther' };
  const GROUP_ORDER = ['♀', '♂', '♂👐', '♂♂', '背景', 'その他'];
  const groupAlpha = (g) => (GROUP_KEY[g] ? settings.get(GROUP_KEY[g]) : 1);
  const setGroupAlpha = (g, a) => {
    if (GROUP_KEY[g]) settings.set(GROUP_KEY[g], a);
  };
  function stillRadios(initial, onPick, compact) {
    const name = 'sr' + _radSeq++;
    const wrap = el('span', 'stillradios');
    for (const [v, t] of STILL_STATES) {
      const input = el('input', { type: 'radio', name, value: v, checked: String(initial) === v });
      input.addEventListener('change', () => {
        if (input.checked) onPick(Number(v));
      });
      const lab = el('label', 'stillradio', compact ? [input] : [input, el('span', { text: t })]);
      if (compact) lab.title = t;
      wrap.appendChild(lab);
    }
    return wrap;
  }
  const setRadioGroup = (root, a) => {
    root.querySelectorAll('.stillradios input[value="' + a + '"]').forEach((r) => (r.checked = true));
  };
  const applyStillFilter = (host, q) => {
    const on = !!q;
    host.querySelectorAll('.stillgrp').forEach((wrap) => {
      const parts = wrap.querySelector('.stillparts');
      let any = false;
      wrap.querySelectorAll('.stillpart-row').forEach((row) => {
        const nm = (row.querySelector('.stillpart-lbl').textContent || '').toLowerCase();
        const m = !on || nm.includes(q);
        row.style.display = m ? '' : 'none';
        if (m && on) any = true;
      });
      if (parts) parts.style.display = on ? (any ? '' : 'none') : 'none';
      wrap.style.display = on && !any ? 'none' : '';
    });
  };
  const scrollStillIntoView = () => {
    requestAnimationFrame(() => {
      const m = getById('main');
      if (m) m.scrollTo({ top: m.scrollHeight, behavior: 'smooth' });
    });
  };
  const syncStillToggleBtn = () => {
    const btn = getById('stillToggle');
    if (btn) btn.classList.toggle('active', !_stillCollapsed);
  };
  const applyStillOpen = () => {
    const host = getById('stillPanel');
    if (host) host.style.display = _stillCollapsed ? 'none' : '';
    syncStillToggleBtn();
  };
  const setStillOpen = (open) => {
    _stillCollapsed = !open;
    applyStillOpen();
    if (open) scrollStillIntoView();
  };
  const toggleStill = () => setStillOpen(_stillCollapsed);
  const makeBgCheckbox = () => {
    const cb = el('input', { type: 'checkbox', checked: settings.get('stillBackImgHidden') });
    cb.addEventListener('change', () => setBackImgHidden(cb.checked));
    return el('label', { class: 'stillbg', title: '静止画の背景（Spineでない背景）を隠す／戻す' }, [cb, el('span', { text: 'BG非表示' })]);
  };
  function renderStillPanel(slots) {
    const host = getById('stillPanel');
    if (!host) return;
    _stillSlots = slots;
    _stillVis = {};
    host.innerHTML = '';
    host.style.display = _stillCollapsed ? 'none' : '';
    if (!slots || !slots.length) {
      _mosaicCb = null;
      host.appendChild(el('div', 'stillpanel-hd', [makeBgCheckbox()]));
      syncStillToggleBtn();
      return;
    }
    for (const s of slots) {
      const a = _stillVisMem[s.name] != null ? _stillVisMem[s.name] : groupAlpha(s.group);
      if (a !== 1) _stillVis[s.name] = a;
    }
    const groups = new Map();
    for (const s of slots) {
      if (!groups.has(s.group)) groups.set(s.group, []);
      groups.get(s.group).push(s.name);
    }
    for (const arr of groups.values()) arr.sort((a, b) => a.localeCompare(b));
    const orderIdx = (g) => {
      const i = GROUP_ORDER.indexOf(g);
      return i < 0 ? GROUP_ORDER.length : i;
    };
    const orderedGroups = [...groups.entries()].sort((a, b) => orderIdx(a[0]) - orderIdx(b[0]));
    const showAll = () => {
      _stillVis = {};
      _stillVisMem = {};
      for (const k of Object.values(GROUP_KEY)) settings.set(k, 1);
      host.querySelectorAll('.stillradios input[value="1"]').forEach((r) => (r.checked = true));
      if (player && player.setStillVisibility) player.setStillVisibility({});
      updateMosaicLock();
    };
    const hideAll = () => {
      _stillVisMem = {};
      _stillVis = {};
      for (const k of Object.values(GROUP_KEY)) settings.set(k, 0);
      for (const s of _stillSlots || []) _stillVis[s.name] = 0;
      host.querySelectorAll('.stillradios input[value="0"]').forEach((r) => (r.checked = true));
      pushStillVis();
    };
    if (player && player.setStillClean) player.setStillClean(_cleanOn);
    const cleanCb = el('input', { type: 'checkbox', checked: _cleanOn });
    cleanCb.addEventListener('change', () => {
      _cleanOn = cleanCb.checked;
      if (player && player.setStillClean) player.setStillClean(_cleanOn);
      updateMosaicLock();
    });
    const mosaicCb = el('input', { type: 'checkbox', checked: settings.get('storyMosaic') });
    mosaicCb.addEventListener('change', () => {
      settings.set('storyMosaic', mosaicCb.checked);
      updateMosaicLock();
    });
    _mosaicCb = mosaicCb;
    if (player && player.setStillSpeed) player.setStillSpeed(_stillSpeed);
    const speedSel = el(
      'select',
      { class: 'stillspeed-sel' },
      STILL_SPEEDS.map((v) => el('option', { value: String(v), text: v + '×' })),
    );
    speedSel.value = String(_stillSpeed);
    speedSel.addEventListener('change', () => {
      _stillSpeed = Number(speedSel.value);
      if (player && player.setStillSpeed) player.setStillSpeed(_stillSpeed);
    });
    host.appendChild(
      el('div', 'stillpanel-hd', [
        el('button', { class: 'btn xs', text: 'アニメ非表示', title: '全グループを非表示にします（ラジオと同期）', on: { click: hideAll } }),
        el('button', { class: 'btn xs', text: 'アニメ全表示', title: '全グループを表示に戻します', on: { click: showAll } }),
        el('label', { class: 'stillmosaic', title: MOSAIC_TITLE }, [mosaicCb, el('span', { text: 'モザイク' })]),
        makeBgCheckbox(),
        el('label', { class: 'stillspeed', title: 'この一枚絵のアニメ再生速度（0×で停止）' }, [el('span', { text: 'アニメ速度' }), speedSel]),
        el('label', { class: 'stillclean', title: '半透明の重なり（自己二重ブレンド）を消してクリーンに合成します。前後関係は描画順の連続ラン単位で保持。' }, [cleanCb, el('span', { text: 'クリーン半透明' })]),
      ]),
    );
    const body = el('div', 'stillbody');
    const fb = filterBox({ placeholder: '部品名でフィルタ（入力すると部品を表示）…' }, (q) => applyStillFilter(host, q));
    body.appendChild(fb.wrap);
    const setNames = (g, names, a, wrap) => {
      setGroupAlpha(g, a);
      for (const n of names) {
        delete _stillVisMem[n];
        if (a !== 1) _stillVis[n] = a;
        else delete _stillVis[n];
      }
      if (wrap) setRadioGroup(wrap.querySelector('.stillparts') || wrap, a);
      pushStillVis();
    };
    for (const [g, names] of orderedGroups) {
      const wrap = el('div', 'stillgrp');
      const parts = el('div', { class: 'stillparts', style: { display: 'none' } });
      const grad = stillRadios(groupAlpha(g), (a) => setNames(g, names, a, wrap));
      const exp = el('button', { class: 'btn xs', text: '部品' });
      exp.addEventListener('click', () => (parts.style.display = parts.style.display === 'none' ? '' : 'none'));
      const grow = el('div', 'stillgrp-row', [el('span', { class: 'stillgrp-lbl', text: g + '（' + names.length + '）' }), grad, exp]);
      grow.addEventListener('click', (e) => {
        if (e.target.closest('.stillradios') || e.target.closest('button')) return;
        const a = nextState(groupAlpha(g));
        setNames(g, names, a, wrap);
        setRadioGroup(grad, a);
        flashRow(grow);
      });
      wrap.appendChild(grow);
      for (const n of names) {
        const prad = stillRadios(
          _stillVis[n] != null ? _stillVis[n] : 1,
          (a) => {
            setStillVal(n, a);
            pushStillVis();
          },
          true,
        );
        const prow = el('div', 'stillpart-row', [el('span', { class: 'stillpart-lbl', text: n }), prad]);
        prow.addEventListener('click', (e) => {
          if (e.target.closest('.stillradios')) return;
          const a = nextState(_stillVis[n] != null ? _stillVis[n] : 1);
          setStillVal(n, a);
          setRadioGroup(prad, a);
          pushStillVis();
          flashRow(prow);
        });
        parts.appendChild(prow);
      }
      wrap.appendChild(parts);
      body.appendChild(wrap);
    }
    host.appendChild(body);
    pushStillVis();
    syncStillToggleBtn();
    if (!_stillCollapsed) scrollStillIntoView();
  }

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
      },
      onChoice: (pc) => {
        if (hud && hud.showChoices) hud.showChoices(pc);
      },
      canAutoAdvance: () => (hud && hud.canAdvance ? hud.canAdvance() : true),
      onBgmPlaying: (playing) => audioScene.report('story', playing),
      playerName: () => settings.get('playerName') || DEFAULT_PLAYER_NAME,
      mosaicOn: () => settings.get('storyMosaic'),
      onStill: (slots) => renderStillPanel(slots),
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

  async function playEpisode(ep, seekText) {
    if (!playerState.cur || !ep) return;
    const fk = playerState.cur.folderKey;
    if (fk !== _lastFolderKey) {
      _stillVisMem = {};
      _lastFolderKey = fk;
    }
    _stillCollapsed = true;
    const host = getById('stage'),
      ctr = getById('controls');
    if (host) host.style.display = '';
    if (ctr) ctr.style.display = '';
    applyStillOpen();
    const p = await ensurePlayer();
    if (!p) return;
    curEp = ep;
    selectEpisodeRow(ep);
    applyPan();
    applyStageToggles();
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
    _stillVisMem = {};
    _stillVis = {};
    _stillCollapsed = true;
    const sp = getById('stillPanel');
    if (sp) sp.style.display = 'none';
    syncStillToggleBtn();
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

  return {
    playEpisode,
    go,
    reset,
    onTabSwitched,
    jumpFrac,
    setUserZoom: (v) => player && player.setUserZoom && player.setUserZoom(v),
    replayVoice: () => player && player.replayVoice && player.replayVoice(),
    toggleStill,
    setMoveMode,
    resetView,
    setBackImgHidden,
    backImgHidden: () => settings.get('stillBackImgHidden'),
  };
}
