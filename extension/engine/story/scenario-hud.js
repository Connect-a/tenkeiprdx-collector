import { scenarioUi } from './scenario-ui.js';
import { settingsWindow } from './settings-window.js';
import { scenarioSettings } from './scenario-settings.js';
import { mk } from '../../core/dom.js';
const REF_W = 1136,
  REF_H = 640;

function create(host, opts) {
  const onEpisodeEnd = (opts && opts.onEpisodeEnd) || null;
  host.classList.add('tphud');
  host.innerHTML = '';

  const bgEl = mk('div', 'bgLayer', host);
  const canvas = mk('canvas', 'glLayer', host);
  const ui = mk('div', 'uiLayer', host);
  const emoLayer = mk('div', 'emoLayer', ui);
  emoLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none';
  const noiseLayer = mk('canvas', 'noiseLayer', ui);
  const lineLayer = mk('canvas', 'lineLayer', ui);
  const eyeLayer = mk('canvas', 'eyeLayer', ui);
  const ambientLayer = mk('canvas', 'vfxLayer', ui);
  const vfxLayer = mk('canvas', 'vfxLayer', ui);
  const bandTop = mk('div', 'bandBar bandTop', ui);
  const bandBottom = mk('div', 'bandBar bandBottom', ui);
  const fxLayer = mk('div', 'fxLayer', ui);
  const meta = mk('div', 'meta', ui),
    prog = mk('div', 'prog', ui);
  const btnLog = mk('img', 'sbtn sb-log', ui);
  btnLog.title = 'ログ';
  const btnSet = mk('img', 'sbtn sb-set', ui);
  btnSet.title = '設定';
  const btnHide = mk('img', 'sbtn sb-hide', ui);
  btnHide.title = 'テキスト非表示';
  const btnSkip = mk('img', 'sbtn sb-skip', ui);
  btnSkip.title = 'スキップ';
  const btnAuto = mk('img', 'sbtn sb-auto', ui);
  btnAuto.title = 'オート';
  const titleWrap = mk('div', 'titleWrap', ui);
  const titleSub = mk('div', 'titleSub', titleWrap);
  mk('div', 'titleSep', titleWrap);
  const titleMain = mk('div', 'titleMain', titleWrap);
  const backlog = mk('div', 'backlog', ui);
  const backlogList = mk('div', 'backlogList', backlog);
  const btnLogClose = mk('img', 'sbtn sb-logclose', backlog);
  btnLogClose.title = '閉じる';
  const choicePanel = mk('div', 'choicePanel', ui);
  const askPanel = mk('div', 'askPanel', host);
  const askText = mk('div', 'askText', askPanel);
  const askCount = mk('div', 'askCount', askPanel);
  const askRow = mk('div', 'askRow', askPanel);
  const askYes = mk('button', 'choiceBtn askBtn', askRow);
  const askNo = mk('button', 'choiceBtn askBtn', askRow);
  const textbox = mk('div', 'textbox', ui);
  const textboxBg = mk('div', 'tbBg', textbox);
  const speaker = mk('div', 'speaker', textbox);
  const text = mk('div', 'text', textbox);
  const nextIcon = mk('img', 'nextIcon', textbox);
  const insertEl = mk('img', null, ui);
  insertEl.style.cssText = 'position:absolute;pointer-events:none;max-width:100%;display:none';
  const audio = mk('audio', null, host),
    se = mk('audio', null, host),
    bgm = mk('audio', null, host);
  bgm.loop = true;

  const els = { speaker, text, meta, prog, audio, se, bgm, emoLayer, fxLayer, noiseLayer, lineLayer, eyeLayer, ambientLayer, vfxLayer, insertEl, bandTop, bandBottom, shakeEl: host };
  const setwin = settingsWindow.create(ui);
  let unsubSettings = null;
  const applyWindowStyle = () => {
    if (!host.isConnected && unsubSettings) {
      unsubSettings();
      return;
    }
    textboxBg.style.opacity = String(scenarioSettings.windowAlpha());
    textbox.classList.toggle('tbOutline', scenarioSettings.outlineFont());
  };
  unsubSettings = scenarioSettings.subscribe(applyWindowStyle);
  applyWindowStyle();

  const fit = () => {
    const hostW = Math.max(1, host.clientWidth || REF_W);
    const hostH = Math.max(1, host.clientHeight || REF_H);
    const scale = Math.min(hostW / REF_W, hostH / REF_H);
    const offX = (hostW - REF_W * scale) * 0.5;
    const offY = (hostH - REF_H * scale) * 0.5;
    ui.style.transform = `translate(${offX}px,${offY}px) scale(${scale})`;
  };
  fit();
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(fit);
    ro.observe(host);
  } else window.addEventListener('resize', fit);

  let player = null,
    autoOn = false,
    skipOn = false,
    uiHidden = false,
    timer = null,
    titleT = null,
    autoSprites = null,
    keyTrap = null,
    ending = false;
  const stopTimers = () => {
    if (timer) {
      clearTimeout(timer);
      clearInterval(timer);
      timer = null;
    }
  };
  const refreshBtns = () => {
    if (autoSprites && autoSprites.auto_on && autoSprites.auto_off) btnAuto.src = autoOn ? autoSprites.auto_on : autoSprites.auto_off;
    btnSkip.style.opacity = skipOn ? '1' : '0.9';
  };
  function renderChoices(pc) {
    choicePanel.innerHTML = '';
    for (const m of pc.members) {
      const b = mk('button', 'choiceBtn', choicePanel);
      b.textContent = m.content || '　';
      b.onclick = (e) => {
        e.stopPropagation();
        host.classList.remove('choiceOpen');
        player.choose(m.sceneMasterId);
      };
    }
    host.classList.add('choiceOpen');
  }
  function showChoices(pc) {
    if (!pc || !pc.members || !pc.members.length) return;
    if (autoOn) setAuto(false);
    renderChoices(pc);
  }
  function setAuto(on) {
    autoOn = on;
    skipOn = false;
    stopTimers();
    if (player && player.setAutoActive) player.setAutoActive(on);
    refreshBtns();
  }
  function setSkip(on) {
    skipOn = on;
    autoOn = false;
    stopTimers();
    if (player && player.setAutoActive) player.setAutoActive(false);
    if (on)
      timer = setInterval(() => {
        if (!player) setSkip(false);
        else player.advance();
      }, 250);
    refreshBtns();
  }
  function showTitle(sub, main) {
    if (!sub && !main) return;
    titleSub.textContent = sub || '';
    titleMain.textContent = main || '';
    clearTimeout(titleT);
    titleWrap.classList.remove('show', 'hiding');
    void titleWrap.offsetWidth;
    titleWrap.classList.add('show');
    titleT = setTimeout(() => {
      titleWrap.classList.remove('show');
      titleWrap.classList.add('hiding');
    }, 2200);
  }
  const openLog = () => {
    if (!player) return;
    backlogList.innerHTML = '';
    for (const it of player.backlog()) {
      const d = mk('div', 'blItem', backlogList);
      if (it.speaker) mk('div', 'blSpk', d).textContent = it.speaker;
      mk('div', 'blTxt', d).textContent = it.text;
      d.onclick = (e) => {
        e.stopPropagation();
        host.classList.remove('logOpen');
        player.render(it.idx);
      };
    }
    host.classList.add('logOpen');
    backlogList.scrollTop = backlogList.scrollHeight;
  };

  function ask(o) {
    const spec = o || {};
    const secs = Math.max(0, Math.round(Number(spec.countdown) || 0));
    const countLabel = spec.countdownText || ((n) => n + '秒後に進みます…');
    askText.textContent = spec.text || '';
    askYes.textContent = spec.yes || 'はい';
    askNo.textContent = spec.no || (secs ? 'キャンセル ⏎' : 'いいえ');
    askYes.style.display = secs ? 'none' : '';
    askCount.style.display = secs ? '' : 'none';
    let sel = 0;
    const paint = () => {
      askYes.classList.toggle('on', !secs && sel === 0);
      askNo.classList.toggle('on', !!secs || sel === 1);
    };
    paint();
    host.classList.add('askOpen');
    return new Promise((resolve) => {
      let left = secs;
      let tid = 0;
      const done = (v) => {
        if (tid) clearInterval(tid);
        keyTrap = null;
        askYes.onclick = askNo.onclick = null;
        host.classList.remove('askOpen');
        resolve(v);
      };
      if (secs) {
        askCount.textContent = countLabel(left);
        tid = setInterval(() => {
          left -= 1;
          if (left <= 0) done(true);
          else askCount.textContent = countLabel(left);
        }, 1000);
      }
      askYes.onclick = (e) => {
        e.stopPropagation();
        done(true);
      };
      askNo.onclick = (e) => {
        e.stopPropagation();
        done(false);
      };
      keyTrap = (e) => {
        if (secs) {
          if (e.key === ' ' || e.key === 'ArrowRight') done(true);
          else if (e.key === 'ArrowLeft' || e.key === 'Enter' || e.key === 'Escape') done(false);
          return;
        }
        if (e.key === ' ') done(true);
        else if (e.key === 'Enter') done(sel === 0);
        else if (e.key === 'Escape') done(false);
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          sel = e.key === 'ArrowLeft' ? 0 : 1;
          paint();
        }
      };
    });
  }
  async function finish() {
    if (ending || !player) return;
    const wasAuto = autoOn;
    setAuto(false);
    if (host.classList.contains('choiceOpen') || !onEpisodeEnd) return;
    ending = true;
    try {
      await onEpisodeEnd({ wasAuto });
    } finally {
      ending = false;
    }
  }
  const showUi = () => {
    uiHidden = false;
    host.classList.remove('uiHidden');
  };
  const modal = () => setwin.isOpen() || ['logOpen', 'choiceOpen', 'askOpen', 'preparing'].some((c) => host.classList.contains(c));
  async function advance() {
    if (modal() || !player) return;
    if (skipOn) return setSkip(false);
    if (uiHidden) return showUi();
    if (autoOn) setAuto(false);
    await player.advance();
  }
  async function back() {
    if (modal() || !player) return;
    if (skipOn) setSkip(false);
    if (autoOn) setAuto(false);
    if (uiHidden) showUi();
    await player.back();
  }

  host.onclick = () => advance();
  const typing = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  const onKey = (e) => {
    if (!host.isConnected) return document.removeEventListener('keydown', onKey);
    if (!host.getClientRects().length || typing(document.activeElement) || e.altKey || e.ctrlKey || e.metaKey) return;
    if (keyTrap) {
      e.preventDefault();
      return keyTrap(e);
    }
    if (e.key === ' ' || e.key === 'ArrowRight') {
      e.preventDefault();
      advance();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      back();
    }
  };
  document.addEventListener('keydown', onKey);
  const stop = (e) => e.stopPropagation();
  btnAuto.onclick = (e) => {
    stop(e);
    setAuto(!autoOn);
  };
  btnSkip.onclick = (e) => {
    stop(e);
    setSkip(!skipOn);
  };
  btnLog.onclick = (e) => {
    stop(e);
    openLog();
  };
  btnLogClose.onclick = (e) => {
    stop(e);
    host.classList.remove('logOpen');
  };
  backlog.onclick = stop;
  btnHide.onclick = (e) => {
    stop(e);
    uiHidden = true;
    host.classList.add('uiHidden');
  };
  btnSet.onclick = (e) => {
    stop(e);
    const wasAuto = autoOn;
    if (wasAuto) setAuto(false);
    setwin.open(() => {
      if (wasAuto) setAuto(true);
    });
  };

  async function theme() {
    if (!scenarioUi) return false;
    const scAtlas = await scenarioUi.loadStage('scenarioUi'),
      adv = await scenarioUi.loadStage('adventureUi');
    if (scAtlas) {
      const tb = scAtlas.get('img_adventure_text_bg'),
        nb = scAtlas.get('img_adventure_character_name_bg'),
        nx = scAtlas.get('img_adventure_icon_next');
      if (tb) scenarioUi.applyStretch(textboxBg, tb, 'linear-gradient(180deg, transparent 22%, rgba(9, 8, 13, 0.9) 46%, rgba(9, 8, 13, 0.92) 100%)');
      if (nb) scenarioUi.apply9Slice(speaker, nb, { slice: { t: 0, b: 0 }, scale: 1 });
      if (nx) {
        nextIcon.src = nx.dataUrl;
        nextIcon.style.display = 'block';
      }
    }
    if (adv) {
      const g = (n) => (adv.get(n) || {}).dataUrl;
      btnSkip.src = g('btn_adventure_skip');
      btnLog.src = g('btn_adventure_log');
      btnSet.src = g('btn_adventure_setting');
      btnHide.src = g('btn_adventure_full_screen');
      btnLogClose.src = g('btn_adventure_log_close');
      const tbg = g('img_adventure_title_bg');
      if (tbg) titleWrap.style.background = 'url(' + tbg + ') 0 0 / 100% 100% no-repeat';
      autoSprites = { auto_on: g('btn_adventure_auto_on'), auto_off: g('btn_adventure_auto_off') };
    }
    refreshBtns();
    return !!(scAtlas || adv);
  }

  return {
    host,
    canvas,
    bgEl,
    els,
    fit,
    theme,
    bind(p) {
      player = p;
    },
    showTitle,
    setReady(ready) {
      host.classList.toggle('preparing', !ready);
      if (!ready) host.classList.remove('choiceOpen');
    },
    advance,
    back,
    ask,
    setAuto,
    setSkip,
    stopAuto() {
      setAuto(false);
    },
    reachEnd() {
      finish();
    },
    showChoices,
    canAdvance: () => !modal(),
  };
}

export const storyHud = { create };
