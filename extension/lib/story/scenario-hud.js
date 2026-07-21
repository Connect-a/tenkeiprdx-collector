'use strict';
// TP_STORY_HUD — 実ゲーム忠実のシナリオHUDを1コンポーネントに集約(埋め込み再利用可)。
// 参照解像度1136×640でUI(メッセージ枠/名前枠/台詞/ボタン/バックログ/演出層)を組みホストへtransform:scale。
// DOM生成＋スコープCSS注入＋操作(クリック送り/オート/スキップ/ログ/非表示)＋アトラス適用を担う。
// 使い方: const hud = TP_STORY_HUD.create(hostEl, opts); player = TP_STORY_ENGINE.create({canvas:hud.canvas, bgEl:hud.bgEl, els:hud.els, ...}); hud.bind(player); await hud.theme();
// 依存: TP_SCENARIO_UI(アトラス復号/適用)。
(function () {
  const REF_W = 1136, REF_H = 640;
  const UI_BUNDLE = 'data/stage/scenario-ui.bundle', ADV_BUNDLE = 'data/stage/adventure-ui.bundle';
  const CSS = `
.tphud{position:relative;overflow:hidden;cursor:pointer;user-select:none;-webkit-user-select:none;background:#000}
.tphud .bgLayer,.tphud .glLayer{position:absolute;inset:0}
.tphud .bgLayer canvas{width:100%;height:100%;object-fit:cover;display:block}
.tphud .glLayer{width:100%;height:100%;display:block}
.tphud .uiLayer{position:absolute;left:0;top:0;width:${REF_W}px;height:${REF_H}px;transform-origin:top left;pointer-events:none}
.tphud .sbtn,.tphud .speaker,.tphud .backlog{pointer-events:auto}
.tphud .textbox{position:absolute;left:0;right:0;bottom:0;height:180px;box-sizing:border-box}
.tphud .speaker{position:absolute;bottom:115px;left:160px;width:300px;height:57px;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:flex-start;font-weight:700;color:#fff;padding:5px 0 0 6px;font-size:21px}
.tphud .text{position:absolute;left:180px;right:200px;top:71px;bottom:12px;overflow:hidden;white-space:pre-wrap;font-size:21px;line-height:1.5}
.tphud .nextIcon{position:absolute;right:170px;bottom:20px;width:26px;height:auto;display:none;animation:tpNextBlink 1s ease-in-out infinite}
@keyframes tpNextBlink{0%,100%{opacity:.25}50%{opacity:1}}
.tphud .titleWrap{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);height:264px;display:flex;flex-direction:column;align-items:center;justify-content:center;opacity:0;transition:opacity .45s ease;pointer-events:none;z-index:7}
.tphud .titleWrap.show{opacity:1}
.tphud .titleSub{color:#eef2ff;font-size:24px;font-weight:600;letter-spacing:2px;text-shadow:0 2px 8px #000}
.tphud .titleSep{width:530px;height:2px;background:linear-gradient(to right,transparent,rgba(220,225,255,.85),transparent);margin:14px 0}
.tphud .titleMain{color:#fff;font-size:40px;font-weight:800;letter-spacing:3px;text-shadow:0 2px 10px #000}
.tphud .sbtn{position:absolute;cursor:pointer;opacity:.9;z-index:8}
.tphud .sbtn.sb-log,.tphud .sbtn.sb-set,.tphud .sbtn.sb-hide{width:60px;height:60px;top:15px}
.tphud .sbtn.sb-log{right:170px}.tphud .sbtn.sb-set{right:100px}.tphud .sbtn.sb-hide{right:30px}
.tphud .sbtn.sb-skip,.tphud .sbtn.sb-auto{width:56px;height:56px;right:67px}
.tphud .sbtn.sb-skip{bottom:92px}.tphud .sbtn.sb-auto{bottom:22px}
.tphud.uiHidden .textbox,.tphud.uiHidden .sbtn,.tphud.uiHidden .nextIcon{display:none}
.tphud .fxLayer{position:absolute;inset:0;opacity:0;pointer-events:none;z-index:9;background:#fff}
@keyframes tpShakeS{0%,100%{transform:translate(0,0)}25%{transform:translate(-3px,2px)}50%{transform:translate(3px,-2px)}75%{transform:translate(-2px,-2px)}}
@keyframes tpShakeM{0%,100%{transform:translate(0,0)}20%{transform:translate(-7px,4px)}40%{transform:translate(7px,-4px)}60%{transform:translate(-5px,-5px)}80%{transform:translate(5px,5px)}}
@keyframes tpShakeL{0%,100%{transform:translate(0,0)}15%{transform:translate(-13px,7px)}35%{transform:translate(13px,-7px)}55%{transform:translate(-10px,-10px)}75%{transform:translate(10px,10px)}}
.tphud.fxShakeS{animation:tpShakeS .3s ease-in-out}.tphud.fxShakeM{animation:tpShakeM .4s ease-in-out}.tphud.fxShakeL{animation:tpShakeL .5s ease-in-out}
.tphud .backlog{position:absolute;inset:0;background:rgba(8,10,14,.9);display:none;flex-direction:column;z-index:10}
.tphud.logOpen .backlog{display:flex}
.tphud .backlogHead{display:flex;justify-content:space-between;align-items:center;padding:10px 18px;border-bottom:1px solid rgba(120,130,150,.3);color:#cfd3db;font-weight:700}
.tphud .backlogList{flex:1;overflow-y:auto;padding:12px 18px}
.tphud .blItem{padding:8px 10px;border-radius:8px;cursor:pointer;margin-bottom:6px}
.tphud .blItem:hover{background:rgba(255,255,255,.08)}
.tphud .blSpk{font-weight:700;color:#8fd0ff;margin-bottom:2px;font-size:13px}
.tphud .blTxt{white-space:pre-wrap;color:#e6e6ea;font-size:14px}
.tphud .meta,.tphud .prog{display:none;position:absolute;top:6px;font-size:11px;color:#9aa0ab;background:rgba(0,0,0,.4);padding:2px 6px;border-radius:4px}
.tphud .meta{left:8px}.tphud .prog{right:8px}`;

  function injectCss() { if (document.getElementById('tp-hud-css')) return; const s = document.createElement('style'); s.id = 'tp-hud-css'; s.textContent = CSS; document.head.appendChild(s); }
  const mk = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };

  function create(host, opts) {
    const o = opts || {};
    injectCss();
    host.classList.add('tphud');
    host.innerHTML = '';

    const bgEl = mk('div', 'bgLayer', host);
    const canvas = mk('canvas', 'glLayer', host);
    const ui = mk('div', 'uiLayer', host);
    const emoLayer = mk('div', 'emoLayer', ui); emoLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    const fxLayer = mk('div', 'fxLayer', ui);
    const meta = mk('div', 'meta', ui), prog = mk('div', 'prog', ui);
    const btnLog = mk('img', 'sbtn sb-log', ui); btnLog.title = 'ログ';
    const btnSet = mk('img', 'sbtn sb-set', ui); btnSet.title = '設定';
    const btnHide = mk('img', 'sbtn sb-hide', ui); btnHide.title = 'テキスト非表示';
    const btnSkip = mk('img', 'sbtn sb-skip', ui); btnSkip.title = 'スキップ';
    const btnAuto = mk('img', 'sbtn sb-auto', ui); btnAuto.title = 'オート';
    const titleWrap = mk('div', 'titleWrap', ui);
    const titleSub = mk('div', 'titleSub', titleWrap); mk('div', 'titleSep', titleWrap); const titleMain = mk('div', 'titleMain', titleWrap);
    const backlog = mk('div', 'backlog', ui);
    const blHead = mk('div', 'backlogHead', backlog); mk('span', null, blHead).textContent = 'ログ';
    const btnLogClose = mk('img', 'sbtn', blHead); btnLogClose.title = '閉じる';
    const backlogList = mk('div', 'backlogList', backlog);
    const textbox = mk('div', 'textbox', ui);
    const speaker = mk('div', 'speaker', textbox);
    const text = mk('div', 'text', textbox);
    const nextIcon = mk('img', 'nextIcon', textbox);
    const audio = mk('audio', null, host), se = mk('audio', null, host), bgm = mk('audio', null, host); bgm.loop = true;

    const els = { speaker, text, meta, prog, audio, se, bgm, emoLayer, fxLayer, shakeEl: host };

    const fit = () => { ui.style.transform = 'scale(' + (host.clientWidth / REF_W) + ',' + (host.clientHeight / REF_H) + ')'; };
    fit();
    if (typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(fit); ro.observe(host); }
    else window.addEventListener('resize', fit);

    let player = null, autoOn = false, skipOn = false, uiHidden = false, timer = null, titleT = null, sp = null;
    const stopTimers = () => { if (timer) { clearTimeout(timer); clearInterval(timer); timer = null; } };
    const refreshBtns = () => {
      if (sp && sp.auto_on && sp.auto_off) btnAuto.src = autoOn ? sp.auto_on : sp.auto_off;
      btnSkip.style.opacity = skipOn ? '1' : '0.9';
    };
    const autoDelay = () => (player && player.autoDelayMs ? player.autoDelayMs() : 3000);
    function autoStep() { if (!player || player.atEnd()) { setAuto(false); return; } player.go(1); timer = setTimeout(autoStep, autoDelay()); }
    function setAuto(on) { autoOn = on; skipOn = false; stopTimers(); if (on) timer = setTimeout(autoStep, autoDelay()); refreshBtns(); if (o.onAuto) o.onAuto(autoOn); }
    function setSkip(on) { skipOn = on; autoOn = false; stopTimers(); if (on) timer = setInterval(() => { if (!player || player.atEnd()) setSkip(false); else player.go(1); }, 250); refreshBtns(); }
    function showTitle(sub, main) { if (!sub && !main) return; titleSub.textContent = sub || ''; titleMain.textContent = main || ''; titleWrap.classList.add('show'); clearTimeout(titleT); titleT = setTimeout(() => titleWrap.classList.remove('show'), 2200); }
    const openLog = () => {
      if (!player) return;
      backlogList.innerHTML = '';
      for (const it of player.backlog()) {
        const d = mk('div', 'blItem', backlogList);
        if (it.speaker) mk('div', 'blSpk', d).textContent = it.speaker;
        mk('div', 'blTxt', d).textContent = it.text;
        d.onclick = (e) => { e.stopPropagation(); host.classList.remove('logOpen'); player.render(it.idx); };
      }
      host.classList.add('logOpen'); backlogList.scrollTop = backlogList.scrollHeight;
    };

    host.onclick = () => {
      if (host.classList.contains('logOpen')) return;
      if (uiHidden) { uiHidden = false; host.classList.remove('uiHidden'); return; }
      if (player && player.isRevealing()) { player.completeReveal(); return; }
      if (player) player.go(1);
    };
    const stop = (e) => e.stopPropagation();
    btnAuto.onclick = (e) => { stop(e); setAuto(!autoOn); };
    btnSkip.onclick = (e) => { stop(e); setSkip(!skipOn); };
    btnLog.onclick = (e) => { stop(e); openLog(); };
    btnLogClose.onclick = (e) => { stop(e); host.classList.remove('logOpen'); };
    backlog.onclick = stop;
    btnHide.onclick = (e) => { stop(e); uiHidden = true; host.classList.add('uiHidden'); };
    btnSet.onclick = (e) => { stop(e); if (o.onSetting) o.onSetting(); };

    async function theme() {
      const UI = globalThis.TP_SCENARIO_UI; if (!UI) return false;
      const scAtlas = await UI.load(UI_BUNDLE), adv = await UI.load(ADV_BUNDLE);
      if (scAtlas) {
        const tb = scAtlas.get('img_adventure_text_bg'), nb = scAtlas.get('img_adventure_character_name_bg'), nx = scAtlas.get('img_adventure_icon_next');
        if (tb) UI.applyStretch(textbox, tb);
        if (nb) UI.apply9Slice(speaker, nb, { slice: { t: 0, b: 0 }, scale: 1 });
        if (nx) { nextIcon.src = nx.dataUrl; nextIcon.style.display = 'block'; }
      }
      if (adv) {
        const g = (n) => (adv.get(n) || {}).dataUrl;
        btnSkip.src = g('btn_adventure_skip'); btnLog.src = g('btn_adventure_log');
        btnSet.src = g('btn_adventure_setting'); btnHide.src = g('btn_adventure_full_screen'); btnLogClose.src = g('btn_adventure_log_close');
        const tbg = g('img_adventure_title_bg'); if (tbg) titleWrap.style.background = 'url(' + tbg + ') 0 0 / 100% 100% no-repeat';
        sp = { auto_on: g('btn_adventure_auto_on'), auto_off: g('btn_adventure_auto_off') };
      }
      refreshBtns();
      return !!(scAtlas || adv);
    }

    return {
      host, canvas, bgEl, els, fit, theme,
      bind(p) { player = p; },
      showTitle,
      setAuto, setSkip, stopAuto() { setAuto(false); },
    };
  }

  globalThis.TP_STORY_HUD = { create };
})();
