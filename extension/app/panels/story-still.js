import { settings } from '../../core/settings.js';
import { el, getById } from '../../core/dom.js';
import { buildGroupedVisPanel } from '../../core/vis-panel.js';
import { GROUPS, groupSlots, groupSetting } from '../../engine/story/slot-group.js';

export function createStillPanel({ getPlayer, setBackImgHidden }) {
  let _stillVis = {},
    _stillNames = null,
    _stillVisMem = {},
    _cleanOn = true,
    _stillSpeed = 1,
    _stillCollapsed = true;
  const STILL_SPEEDS = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5];
  const usePlayer = (fn) => {
    const p = getPlayer();
    if (p) fn(p);
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
    usePlayer((p) => p.setStillVisibility(_stillVis));
    updateMosaicLock();
  };
  const groupAlpha = (id) => (groupSetting(id) ? settings.get(groupSetting(id)) : 1);
  const setAllRadios = (a) => {
    const host = getById('stillPanel');
    if (host) host.querySelectorAll('.stillradios input[value="' + a + '"]').forEach((r) => (r.checked = true));
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
  function renderStillPanel(names) {
    const host = getById('stillPanel');
    if (!host) return;
    _stillNames = names;
    _stillVis = {};
    host.innerHTML = '';
    host.style.display = _stillCollapsed ? 'none' : '';
    if (!names || !names.length) {
      _mosaicCb = null;
      host.appendChild(el('div', 'stillpanel-hd', [makeBgCheckbox()]));
      syncStillToggleBtn();
      return;
    }
    const groups = groupSlots(names);
    for (const g of groups)
      for (const n of g.names) {
        const a = _stillVisMem[n] != null ? _stillVisMem[n] : groupAlpha(g.id);
        if (a !== 1) _stillVis[n] = a;
      }
    const setAllGroups = (a) => {
      _stillVisMem = {};
      _stillVis = {};
      for (const g of GROUPS) settings.set(g.setting, a);
      if (a !== 1) for (const n of _stillNames || []) _stillVis[n] = a;
      setAllRadios(a);
      pushStillVis();
    };
    usePlayer((p) => p.setStillClean(_cleanOn));
    const cleanCb = el('input', { type: 'checkbox', checked: _cleanOn });
    cleanCb.addEventListener('change', () => {
      _cleanOn = cleanCb.checked;
      usePlayer((p) => p.setStillClean(_cleanOn));
      updateMosaicLock();
    });
    const mosaicCb = el('input', { type: 'checkbox', checked: settings.get('storyMosaic') });
    mosaicCb.addEventListener('change', () => {
      settings.set('storyMosaic', mosaicCb.checked);
      updateMosaicLock();
    });
    _mosaicCb = mosaicCb;
    usePlayer((p) => p.setStillSpeed(_stillSpeed));
    const speedSel = el(
      'select',
      { class: 'stillspeed-sel' },
      STILL_SPEEDS.map((v) => el('option', { value: String(v), text: v + '×' })),
    );
    speedSel.value = String(_stillSpeed);
    speedSel.addEventListener('change', () => {
      _stillSpeed = Number(speedSel.value);
      usePlayer((p) => p.setStillSpeed(_stillSpeed));
    });
    buildGroupedVisPanel(host, {
      groups,
      compact: true,
      alphaOf: (n) => (_stillVis[n] != null ? _stillVis[n] : 1),
      groupAlphaOf: groupAlpha,
      onSet: (names, a) => {
        for (const n of names) {
          _stillVisMem[n] = a;
          if (a !== 1) _stillVis[n] = a;
          else delete _stillVis[n];
        }
        pushStillVis();
      },
      onGroupSet: (id, names, a) => {
        if (groupSetting(id)) settings.set(groupSetting(id), a);
        for (const n of names) {
          delete _stillVisMem[n];
          if (a !== 1) _stillVis[n] = a;
          else delete _stillVis[n];
        }
        pushStillVis();
      },
      head: [
        el('button', { class: 'btn xs', text: 'アニメ非表示', title: '全グループを非表示にします（ラジオと同期）', on: { click: () => setAllGroups(0) } }),
        el('button', { class: 'btn xs', text: 'アニメ全表示', title: '全グループを表示に戻します', on: { click: () => setAllGroups(1) } }),
        el('label', { class: 'stillmosaic', title: MOSAIC_TITLE }, [mosaicCb, el('span', { text: 'モザイク' })]),
        makeBgCheckbox(),
        el('label', { class: 'stillspeed', title: 'この一枚絵のアニメ再生速度（0×で停止）' }, [el('span', { text: 'アニメ速度' }), speedSel]),
        el('label', { class: 'stillclean', title: '半透明の重なり（自己二重ブレンド）を消してクリーンに合成します。前後関係は描画順の連続ラン単位で保持。' }, [
          cleanCb,
          el('span', { text: 'クリーン半透明' }),
        ]),
      ],
    });
    pushStillVis();
    syncStillToggleBtn();
    if (!_stillCollapsed) scrollStillIntoView();
  }
  return {
    render: renderStillPanel,
    toggle: toggleStill,
    collapse() {
      _stillCollapsed = true;
      applyStillOpen();
    },
    forgetMemory() {
      _stillVisMem = {};
    },
    reset() {
      _stillVisMem = {};
      _stillVis = {};
      _stillCollapsed = true;
      const sp = getById('stillPanel');
      if (sp) sp.style.display = 'none';
      syncStillToggleBtn();
    },
  };
}
