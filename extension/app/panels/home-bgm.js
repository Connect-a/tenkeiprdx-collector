import { settings } from '../../core/settings.js';
import { createBgmEngine } from '../../core/bgm-engine.js';

const CACHE_MAX = 6;

export function createHomeBgm({ getById, unityDecode, playerState, collectionRepository, audioScene, toast, navTo, nameFix, masterVol, readBundle, paintIcon, onSelectionChange }) {
  let _sel = null;
  let _downloaded = [];
  let _shuffleOrder = [];
  let _hasIntro = false;
  let _drag = null;
  let _gen = 0;
  let _raf = 0;
  const _bufs = new Map();
  const notifyList = () => onSelectionChange && onSelectionChange();

  const engine = createBgmEngine({
    onEnded: () => {
      if (settings.get('homeBgmMode') !== 'repeat') playNext();
    },
    onPhaseChange: () => updateWidget(),
  });

  function applyLoop() {
    engine.setLoop(settings.get('homeBgmMode') === 'repeat');
  }

  function applyVolume() {
    engine.setVolume(masterVol() * settings.get('homeBgmVolume'));
  }

  function pushWants() {
    audioScene.set({ homeWants: !!(settings.get('homeBgmPlaying') && _sel) });
  }

  function tick() {
    updateSeek();
    _raf = engine.isPlaying() ? requestAnimationFrame(tick) : 0;
  }
  function startTick() {
    if (!_raf) _raf = requestAnimationFrame(tick);
  }

  function sync() {
    if (!_sel || document.hidden) return;
    if (settings.get('homeBgmPlaying') && audioScene.homeAudible()) {
      if (!engine.isPlaying()) {
        engine.play();
        startTick();
      }
    } else if (engine.isPlaying()) engine.pause();
  }

  function trimCache() {
    if (_bufs.size <= CACHE_MAX) return;
    const keep = new Set([_sel && _sel.path, _sel && _sel.intro].filter(Boolean));
    for (const k of [..._bufs.keys()]) {
      if (_bufs.size <= CACHE_MAX) break;
      if (keep.has(k)) continue;
      _bufs.delete(k);
    }
  }

  async function bufOf(path) {
    if (!path) return null;
    if (_bufs.has(path)) return _bufs.get(path);
    let buf = null;
    try {
      const bytes = await readBundle(path);
      if (bytes) {
        let clips = [];
        try {
          clips = await unityDecode.extractAudioResource(bytes);
        } catch (e) {}
        if (clips.length) buf = await engine.decode(clips[0].data);
      }
    } catch (e) {}
    _bufs.set(path, buf);
    trimCache();
    return buf;
  }

  async function load(sel) {
    const main = await bufOf(sel.path);
    const intro = main ? await bufOf(sel.intro) : null;
    return main ? { main, intro } : null;
  }

  async function select(sel) {
    const gen = ++_gen;
    const next = { id: sel.id, name: sel.name, path: sel.path, intro: sel.intro || null };
    const prev = _sel;
    _sel = next;
    updateWidget();
    notifyList();
    const src = await load(next);
    if (gen !== _gen) return false;
    if (!src) {
      _sel = prev;
      pushWants();
      updateWidget();
      notifyList();
      toast('BGMを展開できませんでした', 'err');
      return false;
    }
    _hasIntro = !!src.intro;
    engine.setTrack(src.intro, src.main);
    applyLoop();
    applyVolume();
    setWant(true);
    sync();
    try {
      await chrome.storage.local.set({ homeBgmSel: _sel });
    } catch (e) {}
    updateWidget();
    notifyList();
    return true;
  }

  function setWant(v) {
    settings.set('homeBgmPlaying', !!v);
    pushWants();
  }

  async function pauseResume() {
    if (!_sel) return;
    setWant(!engine.isPlaying());
    sync();
    updateWidget();
    notifyList();
  }

  async function toggle(e, m) {
    if (_sel && String(_sel.id) === String(e.id)) {
      if (!engine.isPlaying()) {
        setWant(true);
        sync();
        updateWidget();
        notifyList();
      }
      return;
    }
    await select({ id: e.id, name: e.name, path: m.audio, intro: m.intro || null });
  }

  function buildShuffle() {
    const a = _downloaded.slice();
    for (let k = a.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      [a[k], a[j]] = [a[j], a[k]];
    }
    if (a.length > 1 && _sel && String(a[0].id) === String(_sel.id)) [a[0], a[1]] = [a[1], a[0]];
    _shuffleOrder = a;
  }
  function orderList() {
    return settings.get('homeBgmMode') === 'shuffle' ? _shuffleOrder : _downloaded;
  }

  async function step(dir) {
    const list = orderList();
    const n = list.length;
    if (!n) return;
    const i = list.findIndex((x) => _sel && String(x.id) === String(_sel.id));
    if (settings.get('homeBgmMode') === 'shuffle' && dir > 0 && i >= 0 && i + 1 >= n) {
      buildShuffle();
      await select(_shuffleOrder[0]);
      return;
    }
    await select(list[i < 0 ? 0 : (i + dir + n) % n]);
  }

  function setMode(mode) {
    settings.set('homeBgmMode', mode);
    if (mode === 'shuffle') buildShuffle();
    applyLoop();
    updateWidget();
  }

  async function playNext() {
    const list = orderList();
    if (!list.length) return;
    const i = list.findIndex((x) => _sel && String(x.id) === String(_sel.id));
    if (settings.get('homeBgmMode') === 'shuffle' && i >= 0 && i + 1 >= list.length) {
      buildShuffle();
      for (const cand of _shuffleOrder) if (await select(cand)) return;
      return;
    }
    const n = list.length;
    for (let k = 1; k <= n; k++) {
      const cand = list[(i < 0 ? k - 1 : i + k) % n];
      if (await select(cand)) return;
    }
  }

  async function menuToggle() {
    if (_sel) {
      pauseResume();
      return;
    }
    if (!_downloaded.length) {
      toast('先にホームBGMをダウンロードしてください', 'err');
      return;
    }
    if (settings.get('homeBgmMode') === 'shuffle') buildShuffle();
    await select(orderList()[0]);
  }

  function showMenu(show) {
    const menu = getById('hbMenu');
    if (!menu) return;
    menu.style.display = (show == null ? menu.style.display === 'none' : show) ? '' : 'none';
  }

  function syncMarquee(inner) {
    const box = inner.parentElement;
    if (!box) return;
    const over = inner.scrollWidth - box.clientWidth;
    box.classList.toggle('marquee', over > 1);
    if (over > 1) {
      box.style.setProperty('--mshift', -over + 'px');
      box.style.setProperty('--mdur', Math.round(4 + over / 20) + 's');
    }
  }

  function fmtTime(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    return m + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  }

  function barSet(suffix, which, on) {
    const seek = getById('hbSeek' + suffix);
    if (!seek) return;
    const row = getById('hbSeekRow' + suffix);
    if (row) row.classList.toggle('active', on);
    if (_drag && _drag.suffix === suffix) return;
    const dur = engine.duration(which);
    const cur = engine.position(which);
    drawBar(suffix, dur > 0 ? Math.min(1, cur / dur) : 0, dur, cur);
  }

  function drawBar(suffix, ratio, dur, cur) {
    const fill = getById('hbSeekFill' + suffix);
    if (fill) fill.style.width = (ratio * 100).toFixed(2) + '%';
    const t = getById('hbTime' + suffix);
    if (t) t.textContent = fmtTime(cur == null ? ratio * dur : cur) + ' / ' + fmtTime(dur);
  }

  function updateSeek() {
    const introRow = getById('hbSeekRowI');
    if (introRow) introRow.style.display = _hasIntro ? '' : 'none';
    const p = engine.phaseNow();
    barSet('I', 'intro', p === 'intro');
    barSet('M', 'main', p === 'main');
  }

  const ratioAt = (el, ev) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 ? Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width)) : 0;
  };

  function bindSeek(phase, suffix) {
    const el = getById('hbSeek' + suffix);
    if (!el) return;
    el.addEventListener('pointerdown', (ev) => {
      if (!_sel || (phase === 'intro' && !_hasIntro)) return;
      const dur = engine.duration(phase);
      if (!dur) return;
      _drag = { phase, suffix, dur, ratio: ratioAt(el, ev) };
      try {
        el.setPointerCapture(ev.pointerId);
      } catch (e) {}
      drawBar(suffix, _drag.ratio, dur);
      ev.preventDefault();
    });
    el.addEventListener('pointermove', (ev) => {
      if (!_drag || _drag.suffix !== suffix) return;
      _drag.ratio = ratioAt(el, ev);
      drawBar(suffix, _drag.ratio, _drag.dur);
    });
    el.addEventListener('pointerup', (ev) => {
      if (!_drag || _drag.suffix !== suffix) return;
      const d = _drag;
      _drag = null;
      engine.seek(d.phase, ratioAt(el, ev) * d.dur);
      setWant(true);
      sync();
      updateWidget();
    });
    el.addEventListener('pointercancel', () => {
      if (!_drag || _drag.suffix !== suffix) return;
      _drag = null;
      updateSeek();
    });
  }

  function updateWidget() {
    const w = getById('homeBgmWidget');
    if (!w) return;
    const has = !!_sel || _downloaded.length > 0;
    w.style.display = has ? '' : 'none';
    if (!has) return;
    const playing = !!(_sel && engine.isPlaying());
    const title = _sel ? nameFix(_sel.name || _sel.id) : '';
    const icon = getById('hbIcon');
    if (icon) {
      icon.classList.toggle('playing', playing);
      icon.classList.toggle('has-title', !!title);
    }
    const ct = getById('hbChipTitle');
    if (ct) {
      ct.textContent = title;
      requestAnimationFrame(() => syncMarquee(ct));
    }
    const t = getById('hbMenuTitle');
    if (t) t.textContent = title || '未選択';
    const mi = getById('hbMenuIcon');
    if (mi) {
      const cur = _sel && _downloaded.find((x) => String(x.id) === String(_sel.id));
      const iconSub = (cur && cur.icon) || null;
      mi.style.display = iconSub ? '' : 'none';
      if (iconSub) paintIcon(mi, iconSub, 'hbmenuiconimg');
      else mi.innerHTML = '';
    }
    const flag = (id, on) => getById(id) && getById(id).classList.toggle('active', on);
    flag('hbPriority', audioScene.bgmPriority());
    flag('hbModeRepeat', settings.get('homeBgmMode') === 'repeat');
    flag('hbModeShuffle', settings.get('homeBgmMode') === 'shuffle');
    flag('hbModeSeq', settings.get('homeBgmMode') === 'sequence');
    const tog = getById('hbMenuToggle');
    if (tog) {
      tog.textContent = playing ? '⏸' : '▶';
      tog.title = playing ? '一時停止' : '再生';
    }
    updateSeek();
    if (playing) startTick();
  }

  function setDownloaded(list) {
    _downloaded = list || [];
    if (settings.get('homeBgmMode') === 'shuffle') buildShuffle();
    updateWidget();
  }

  function addDownloaded(entry) {
    if (!entry || !entry.audio || _downloaded.some((x) => String(x.id) === String(entry.id))) return;
    setDownloaded(_downloaded.concat([{ id: entry.id, name: entry.name, path: entry.audio, intro: entry.intro || null, icon: entry.icon || null }]));
  }

  async function restore() {
    try {
      await settings.load();
      settings.bind(getById('hbVolume'), 'homeBgmVolume');
      audioScene.set({ bgmPriority: settings.get('homeBgmPriority') });
      applyVolume();
      const st = await chrome.storage.local.get('homeBgmSel');
      if (!playerState.fsGranted) {
        updateWidget();
        return;
      }
      const data = await collectionRepository.homeData().catch(() => null);
      const hs = data ? await collectionRepository.homeStatus(data).catch(() => null) : null;
      if (hs) _downloaded = [...hs.homeBgm.values(), ...hs.otherBgm.values()].map((m) => ({ id: m.id, name: m.name, path: m.audio, intro: m.intro, icon: m.icon }));
      if (settings.get('homeBgmMode') === 'shuffle') buildShuffle();
      const stored = st.homeBgmSel;
      const sel = stored ? _downloaded.find((x) => String(x.id) === String(stored.id)) || stored : null;
      if (sel && sel.path) {
        const gen = ++_gen;
        const src = await load(sel);
        if (src && gen === _gen) {
          _sel = { id: sel.id, name: sel.name, path: sel.path, intro: sel.intro || null };
          _hasIntro = !!src.intro;
          engine.setTrack(src.intro, src.main);
          applyLoop();
          applyVolume();
          pushWants();
          sync();
        }
      }
      updateWidget();
    } catch (e) {}
  }

  function bind() {
    getById('hbIcon')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      engine.resumeCtx();
      showMenu();
      updateWidget();
    });
    getById('hbPriority')?.addEventListener('click', () => settings.set('homeBgmPriority', !settings.get('homeBgmPriority')));
    getById('hbModeRepeat')?.addEventListener('click', () => setMode('repeat'));
    getById('hbModeShuffle')?.addEventListener('click', () => setMode('shuffle'));
    getById('hbModeSeq')?.addEventListener('click', () => setMode('sequence'));
    getById('hbChange')?.addEventListener('click', () => {
      showMenu(false);
      if (typeof navTo === 'function') navTo('home', 'homeBgm');
    });
    getById('hbMenuToggle')?.addEventListener('click', menuToggle);
    getById('hbPrev')?.addEventListener('click', () => step(-1));
    getById('hbNext')?.addEventListener('click', () => step(1));
    bindSeek('intro', 'I');
    bindSeek('main', 'M');
    settings.subscribe((n) => {
      if (n === 'homeBgmVolume' || n === 'masterVolume') applyVolume();
      else if (n === 'homeBgmPriority') {
        audioScene.set({ bgmPriority: settings.get('homeBgmPriority') });
        updateWidget();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      engine.resumeCtx();
      sync();
      updateWidget();
    });
    document.addEventListener('click', (ev) => {
      const w = getById('homeBgmWidget');
      if (w && w.style.display !== 'none' && !w.contains(ev.target)) showMenu(false);
    });
    audioScene.subscribe(() => {
      sync();
      updateWidget();
    });
  }

  const glyph = (on) => (on && engine.isPlaying() ? '⏸' : '▶');

  return {
    setDownloaded,
    addDownloaded,
    restore,
    bind,
    toggle,
    glyph,
    applyVolume,
    isCurrent: (id) => !!(_sel && String(_sel.id) === String(id)),
    revoke: () => _bufs.clear(),
  };
}
