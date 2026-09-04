import { el } from '../../core/dom.js';
import { assetStore } from '../../data/asset-store.js';
import { unityDecode } from '../../unity/decode.js';
import { firstClipUrl } from '../../core/audio-url.js';
import { DIRS } from '../../core/dirs.js';

let _mods = null;
const loadMods = async () => {
  if (!_mods) {
    const [sv, vm] = await Promise.all([import('../../engine/render/scene-vfx.js'), import('../../engine/render/vfx-materials.js')]);
    _mods = { sceneVfx: sv.sceneVfx, vfxMaterials: vm.vfxMaterials };
  }
  return _mods;
};

const readFrom = (dir, rel, place) => (rel ? assetStore.readAsset(dir, rel, place) : Promise.resolve(null));

async function loadEffect(src, effect, vfxRel) {
  const bytes = await readFrom(src.dir, vfxRel, src.place);
  if (!bytes) return null;
  let texByMatPid = null;
  try {
    const { vfxMaterials } = await loadMods();
    texByMatPid = await vfxMaterials.forPrefab(effect, vfxRel);
  } catch (e) {}
  return { bytes, texByMatPid };
}

async function loadSeUrl(src, seRel) {
  const bytes = await readFrom(src.dir, seRel, src.sePlace || src.place);
  if (!bytes) return null;
  try {
    return firstClipUrl(unityDecode.extractAudioResource ? await unityDecode.extractAudioResource(bytes) : []);
  } catch (e) {}
  return null;
}

export function createSkillFxView() {
  let _loop = true;
  let _gen = 0;
  let src = { dir: DIRS.shared, place: null };
  let _overlay = null;
  let _canvas = null;
  let _stage = null;
  let _active = null;
  let _titleEl = null;
  let _spinEl = null;
  let _msgEl = null;

  function ensureField() {
    if (_stage) return;
    _stage = el('div', 'skillfx-stage');
    _canvas = el('canvas', { class: 'skillfx-canvas' });
    const fsBtn = el('button', { class: 'model3d-full', title: '全画面', text: '⛶' });
    fsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (document.fullscreenElement) document.exitFullscreen();
      else if (_stage.requestFullscreen) _stage.requestFullscreen();
    });
    _stage.appendChild(_canvas);
    _stage.appendChild(fsBtn);
  }

  function stopActive() {
    const a = _active;
    _active = null;
    if (_overlay) {
      try {
        _overlay.stop();
      } catch (e) {}
    }
    if (_canvas) _canvas.style.display = 'none';
    if (a) {
      if (a.audio) {
        try {
          a.audio.pause();
        } catch (e) {}
        a.audio = null;
      }
      if (a.seUrl) {
        try {
          URL.revokeObjectURL(a.seUrl);
        } catch (e) {}
        a.seUrl = null;
      }
      if (a.btn) {
        a.btn.textContent = '▶ 再生';
        a.btn.disabled = false;
        a.btn.classList.remove('playing');
      }
    }
    if (_titleEl) _titleEl.textContent = '';
    if (_spinEl) _spinEl.style.display = 'none';
  }

  function dispose() {
    _gen++;
    stopActive();
  }

  async function play(entry, btn) {
    const gen = ++_gen;
    stopActive();
    if (gen !== _gen) return;
    ensureField();
    _canvas.style.display = '';
    const a = { entry, btn, audio: null, seUrl: null };
    _active = a;
    if (btn) {
      btn.textContent = '■ 停止';
      btn.disabled = true;
      btn.classList.add('playing');
    }
    if (_titleEl) _titleEl.textContent = entry.effect + (entry.skillName ? '　（' + entry.skillName + '）' : '');
    if (_msgEl) _msgEl.textContent = '';
    if (_spinEl) _spinEl.style.display = '';
    try {
      const { sceneVfx } = await loadMods();
      if (gen !== _gen) return;
      if (!_overlay) _overlay = sceneVfx.createOverlay(_canvas, { stage: true });
      const r = await loadEffect(src, entry.effect, entry.vfxRel);
      if (gen !== _gen) return;
      if (r && r.bytes) {
        _overlay.play(r.bytes, r.texByMatPid, 4000, { loop: _loop });
        if (_msgEl) _msgEl.textContent = '';
      } else if (_msgEl) {
        _msgEl.textContent = 'このエフェクトは未取得です。ダウンロードを実行してください。';
      }
    } catch (er) {
      if (_msgEl) _msgEl.textContent = 'VFX再生に失敗しました';
    }
    if (entry.seRel) {
      const url = await loadSeUrl(src, entry.seRel);
      if (gen !== _gen) {
        if (url)
          try {
            URL.revokeObjectURL(url);
          } catch (er) {}
        return;
      }
      if (url) {
        a.seUrl = url;
        a.audio = new Audio(url);
        a.audio.loop = _loop;
        a.audio.play().catch(() => {});
      }
    }
    if (gen !== _gen) return;
    if (_spinEl) _spinEl.style.display = 'none';
    if (btn) btn.disabled = false;
  }

  async function render(entries, hostEl, opt) {
    dispose();
    hostEl.innerHTML = '';
    src = { dir: (opt && opt.dir) || DIRS.shared, place: (opt && opt.place) || null, sePlace: (opt && opt.sePlace) || (opt && opt.place) || null };
    const list = (entries || []).filter((e) => e && e.vfxRel);
    if (!list.length) {
      hostEl.appendChild(el('div', 'note', (opt && opt.emptyText) || 'スキルエフェクトはありません。'));
      return;
    }
    const loopChk = el('input', { type: 'checkbox' });
    loopChk.checked = _loop;
    loopChk.addEventListener('change', () => {
      _loop = loopChk.checked;
      if (_active && _active.audio) _active.audio.loop = _loop;
    });
    hostEl.appendChild(el('label', 'skillfx-toolbar', [loopChk, el('span', {}, 'ループ再生')]));
    ensureField();
    _canvas.style.display = 'none';
    _titleEl = el('div', 'skillfx-cap', '');
    _spinEl = el('span', { class: 'skillfx-spin', style: { display: 'none' } });
    _msgEl = el('div', 'note dim', '');
    hostEl.appendChild(el('div', 'skillfx-field', [_titleEl, _stage, _spinEl, _msgEl]));
    const listEl = el('div', 'skillfx-list');
    hostEl.appendChild(listEl);
    for (const e of list) {
      const btn = el('button', { class: 'btn xs vspine-btn', text: '▶ 再生' });
      const label = el('span', 'skillfx-cap', `${e.effect}${e.skillName ? '　（' + e.skillName + '）' : ''}${e.seRel ? '　♪' : ''}`);
      listEl.appendChild(el('div', 'skillfx-row', [btn, label]));
      btn.addEventListener('click', () => {
        if (_active && _active.btn === btn) {
          _gen++;
          stopActive();
        } else {
          play(e, btn);
        }
      });
    }
  }

  return { render, dispose };
}
