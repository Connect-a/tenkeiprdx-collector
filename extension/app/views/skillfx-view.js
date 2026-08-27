import { el } from '../../core/dom.js';
import { assetStore } from '../../data/asset-store.js';
import { CATALOG_DIR } from '../../data/index-store.js';
import { unityDecode } from '../../unity/decode.js';
import { fileStore } from '../../core/fsdir.js';
import { DIRS } from '../../core/constants.js';

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let _mods = null;
const loadMods = async () => {
  if (!_mods) {
    const [sv, vp, three] = await Promise.all([import('../../engine/render/scene-vfx.js'), import('../../engine/render/vfx-parse.js'), import('../../vendor/three.module.js')]);
    _mods = { sceneVfx: sv.sceneVfx, vfxParse: vp.vfxParse, THREE: three };
  }
  return _mods;
};

let _catalog = null;
async function vfxCatalog() {
  if (_catalog) return _catalog;
  const dir = await fileStore.getDir(DIRS.shared, { create: false });
  const f = dir ? await fileStore.readUnder(dir, CATALOG_DIR + '/vfx_catalog.json') : null;
  if (!f) throw new Error('vfx_catalog');
  _catalog = JSON.parse(await f.text());
  return _catalog;
}

const readFrom = (dir, rel, place) => (rel ? assetStore.readAsset(dir, rel, place) : Promise.resolve(null));

async function loadEffect(src, effect, vfxRel) {
  const bytes = await readFrom(src.dir, vfxRel, src.place);
  if (!bytes) return null;
  let texByMatPid = null;
  try {
    const { vfxParse, THREE } = await loadMods();
    const cat = await vfxCatalog();
    const deps = vfxParse.resolveDeps(cat, new RegExp(escapeRe(effect) + '\\.prefab$', 'i')).filter((d) => d !== vfxRel);
    const db = [];
    for (const d of deps) {
      const b = await assetStore.readAsset(DIRS.shared, d);
      if (b) db.push(b);
    }
    texByMatPid = vfxParse.buildMaterialMap(THREE, db);
  } catch (e) {}
  return { bytes, texByMatPid };
}

async function loadSeUrl(src, seRel) {
  const bytes = await readFrom(src.dir, seRel, src.sePlace || src.place);
  if (!bytes) return null;
  try {
    const clips = (unityDecode.extractAudioResource ? await unityDecode.extractAudioResource(bytes) : []) || [];
    const clip = clips.find((c) => c && c.data && c.data.length);
    if (clip) return URL.createObjectURL(new Blob([clip.data], { type: clip.mime || 'audio/mp4' }));
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
