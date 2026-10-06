import { el } from '../../core/dom.js';
import { assetStore } from '../../data/asset-store.js';
import { unityDecode } from '../../unity/decode.js';
import { audioBlobUrl } from '../../core/audio-url.js';
import { audioOut } from '../../core/audio-gain.js';
import { settings } from '../../core/settings.js';
import { DIRS } from '../../core/dirs.js';
import { motionClip } from '../../engine/render/motion/motion-names.js';
import { chainLinksOf, skillMotion, skillPlaybackPlan, placementNote } from '../../engine/skill/playback-plan.js';
import { noteFailure as noteFailureIn } from '../../core/failures.js';

let _mods = null;
const loadMods = async () => {
  if (!_mods) {
    const [vfx, vm] = await Promise.all([import('../../engine/render/vfx/index.js'), import('../../engine/render/vfx/vfx-material-deps.js')]);
    _mods = { vfx, vfxMaterialDeps: vm.vfxMaterialDeps };
  }
  return _mods;
};

const FAILURE_SCOPE = 'スキル演出';
const noteFailure = (kind, err) => noteFailureIn(FAILURE_SCOPE, kind, err);

async function readFrom(dir, rel, place) {
  if (!rel) return null;
  const own = await assetStore.readAsset(dir, rel, place);
  if (own || dir === DIRS.shared) return own;
  return assetStore.readAsset(DIRS.shared, rel, null);
}

async function loadEffect(src, effect, vfxRel) {
  const bytes = await readFrom(src.dir, vfxRel, src.place);
  if (!bytes) return null;
  let texByMatPid = null;
  try {
    const { vfxMaterialDeps } = await loadMods();
    texByMatPid = await vfxMaterialDeps.forPrefab(effect, vfxRel, bytes);
  } catch (e) {
    noteFailure('材質の解決', e);
  }
  return { bytes, texByMatPid };
}

const clipKey = (ref) => ref.cab + '|' + ref.pathID;

async function addClipUrls(urls, bytes) {
  try {
    for (const c of await unityDecode.extractAudioClips(bytes)) if (c.data && c.data.length && !urls.has(clipKey(c))) urls.set(clipKey(c), audioBlobUrl(c.data, c.mime));
  } catch (e) {
    noteFailure('SEの復号', e);
  }
}

async function loadLinkSe(src, link, part) {
  const urls = new Map();
  if (part && part.bytes) await addClipUrls(urls, part.bytes);
  for (const rel of link.seRels || []) {
    const bytes = await readFrom(src.dir, rel, src.sePlace || src.place);
    if (bytes) await addClipUrls(urls, bytes);
  }
  return urls;
}

const uiState = { gameCam: true, showFbx: true, speed: 1 };
const SPEEDS = [0.25, 0.5, 0.75, 1];
const PAUSE_LABEL = '⏸ 一時停止';
const RESUME_LABEL = '▶ 再開';

const SKILL_TYPE = { 1: '物理', 2: '武術', 3: '波動', 4: '魔法' };
const SKILL_CAT = { 1: '攻撃', 2: '補助', 3: '妨害', 4: '特殊', 5: 'トリガー' };
const SKILL_ATTR = { 1: '無', 2: '炎', 3: '水', 4: '氷', 5: '風', 6: '岩', 7: '雷', 8: '闇' };
const SKILL_RARITY = { 1: 'S', 2: 'A', 3: 'B', 4: 'C', 5: 'UR' };
const SKILL_TARGETS = { 0: 'なし', 1: '味方', 2: '敵', 3: '味方/敵', 4: '地面' };
const EFFECT_FLAGS = [[1, 'ダメージ'], [2, '回復'], [4, 'バフ'], [8, 'デバフ']];
const EFFECT_TAGS = { 1: '無敵', 2: '巨岩', 3: 'HP割合倍率', 4: 'HP吸収', 5: 'ホバー', 6: 'バリア', 7: '回避', 8: 'ワープ', 9: '移動生成', 10: '詠唱' };

const badge = (label, val) => (val || val === 0 ? el('span', 'skillfx-badge', `${label}: ${val}`) : null);
const flagsText = (v) => EFFECT_FLAGS.filter(([b]) => (v & b) === b).map(([, t]) => t).join('/');

const rangeGrid = (cells, label) => {
  if (!Array.isArray(cells) || !cells.length) return null;
  const cols = (cells[0] && cells[0].length) || cells.length;
  const grid = el('div', 'skillfx-grid');
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  for (const row of cells) for (const v of row) grid.appendChild(el('div', 'skillfx-cell' + (v >= 2 ? ' center' : v ? ' on' : '')));
  return el('div', 'skillfx-range', [el('div', 'skillfx-range-cap', label), grid]);
};

const unionLine = (label, text) => el('div', 'skillfx-union', [el('span', 'skillfx-union-h', label), el('span', {}, text)]);

const metaBlock = (m) => {
  if (!m) return null;
  const badges = el('div', 'skillfx-badges');
  const add = (b) => b && badges.appendChild(b);
  add(badge('種別', SKILL_TYPE[m.type]));
  add(badge('分類', SKILL_CAT[m.category]));
  add(badge('属性', SKILL_ATTR[m.attribute]));
  add(badge('レア', SKILL_RARITY[m.rarity]));
  add(badge('対象', SKILL_TARGETS[m.eligibleTargets]));
  if (m.tpCost != null) add(badge('TP', m.tpCost + (m.tpCostPerLevel ? ` (+${m.tpCostPerLevel}/Lv)` : '')));
  if (m.maxLevel) add(badge('最大Lv', m.maxLevel));
  add(badge('効果', flagsText(m.effectsFlags || 0)));
  add(badge('タグ', (m.effectTypeTags || []).map((t) => EFFECT_TAGS[t]).filter(Boolean).join('/')));
  const kids = [];
  if (badges.children.length) kids.push(badges);
  const row = [rangeGrid(m.targetCells, '射程'), rangeGrid(m.effectCells, '効果範囲')].filter(Boolean);
  const union = [];
  if (m.unionCondDesc) union.push(unionLine('ユニオン条件', m.unionCondDesc));
  if (m.unionEffectDesc) union.push(unionLine('ユニオン効果', m.unionEffectDesc));
  if (m.originalDesc) union.push(el('div', 'skillfx-union', m.originalDesc));
  if (union.length) row.push(el('div', 'skillfx-union-col', union));
  if (row.length) kids.push(el('div', 'skillfx-ranges', row));
  return kids.length ? el('div', 'skillfx-meta', kids) : null;
};

export function createSkillFxView() {
  let _fbxObjs = [];
  let _fbxCall = 0;
  let _loadFbx = null;
  let _loadChar = null;
  let _onMotion = null;
  let _gen = 0;
  let src = { dir: DIRS.shared, place: null };
  let _player = null;
  let _canvas = null;
  let _fxCache = null;
  let _seCache = null;
  let _stage = null;
  let _active = null;
  let _spinEl = null;
  let _msgEl = null;
  let _camChk = null;
  let _telopEl = null;
  let _env = null;
  if (typeof window !== 'undefined')
    window.addEventListener('tp:mastervol', () => {
      for (const au of (_active && _active.sounds) || []) audioOut.setVolume(au, settings.get('masterVolume'));
    });

  function makePlayer(vfx) {
    const ov = vfx.createVfxPlayer(_canvas, { stage: true, battleCamera: true });
    _env = null;
    ov.setOnUserCamera(() => {
      uiState.gameCam = false;
      if (_camChk) _camChk.checked = true;
    });
    return ov;
  }

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
    _spinEl = el('span', { class: 'skillfx-spin', style: { display: 'none' } });
    _telopEl = el('div', { class: 'skillfx-telop', style: { display: 'none' } });
    _stage.appendChild(_canvas);
    _stage.appendChild(_spinEl);
    _stage.appendChild(_telopEl);
    _stage.appendChild(fsBtn);
  }

  let _pauseBtn = null;
  function resetPauseBtn() {
    if (_pauseBtn) _pauseBtn.textContent = PAUSE_LABEL;
  }
  function setTelop(text) {
    if (!_telopEl) return;
    _telopEl.textContent = text || '';
    _telopEl.style.display = text ? '' : 'none';
  }

  function stopActive() {
    const a = _active;
    _active = null;
    resetPauseBtn();
    if (_player) {
      try {
        _player.stop();
      } catch (e) {}
    }
    if (_player) {
      try {
        _player.showIdle();
      } catch (e) {}
    }
    if (a) {
      for (const au of a.sounds) au.pause();
      a.sounds = [];
      setTelop('');
      if (a.btn) {
        a.btn.textContent = '▶ 再生';
        a.btn.disabled = false;
        a.btn.classList.remove('playing');
      }
    }
    if (_spinEl) _spinEl.style.display = 'none';
  }

  const revokeLists = (lists) => {
    for (const urls of lists || []) for (const u of urls.values()) URL.revokeObjectURL(u);
  };

  function releaseSe() {
    if (_seCache) revokeLists(_seCache.lists);
    _seCache = null;
  }

  const cacheKey = (entry) => String(entry.effect) + '|' + String(entry.vfxRel);

  function getEffect(entry) {
    const key = cacheKey(entry);
    if (!_fxCache || _fxCache.key !== key) _fxCache = { key, promise: Promise.all(chainLinksOf(entry).map((l) => loadEffect(src, l.effect, l.vfxRel))) };
    return _fxCache.promise;
  }

  function ensureSeUrlsPerLink(entry, parts) {
    const key = cacheKey(entry);
    if (_seCache && _seCache.key === key) return _seCache.promise;
    releaseSe();
    const cache = { key, lists: null, promise: null };
    cache.promise = (async () => {
      const lists = [];
      try {
        for (const [i, l] of chainLinksOf(entry).entries()) lists.push(await loadLinkSe(src, l, parts[i]));
      } catch (e) {
        revokeLists(lists);
        if (_seCache === cache) _seCache = null;
        throw e;
      }
      if (_seCache === cache) cache.lists = lists;
      else revokeLists(lists);
      return lists;
    })();
    _seCache = cache;
    return cache.promise;
  }

  async function warmUp(list) {
    try {
      const { vfx } = await loadMods();
      ensureField();
      if (!_player) _player = makePlayer(vfx);
      _player.showIdle();
    } catch (e) {
      noteFailure('待機表示の初期化', e);
    }
    if (list.length !== 1) return;
    try {
      const parts = await getEffect(list[0]);
      const { vfx } = await loadMods();
      for (const r of parts || []) if (r && r.texByMatPid) vfx.prewarmMaterials(r.texByMatPid);
      await ensureSeUrlsPerLink(list[0], parts || []);
    } catch (e) {
      noteFailure('事前読み込み', e);
    }
  }

  function reset() {
    _gen++;
    stopActive();
    clearFbx();
    releaseSe();
    _fxCache = null;
  }

  function clearFbx() {
    for (const o of _fbxObjs) {
      try {
        if (o && o.dispose) o.dispose();
      } catch (e) {}
    }
    _fbxObjs = [];
    if (_player && _player.setExtraObjects) {
      try {
        _player.setExtraObjects([]);
      } catch (e) {}
    }
  }

  async function applyFbx(gen) {
    const call = ++_fbxCall;
    clearFbx();
    if (!uiState.showFbx || !_player) return;
    const builts = [];
    const stale = () => {
      if (gen === _gen && call === _fbxCall) return false;
      for (const b of builts) if (b.dispose) b.dispose();
      return true;
    };
    const slots = _loadFbx ? _player.timeline().fbxSlots : [];
    for (const s of slots) {
      let built = null;
      try {
        built = await _loadFbx(s);
      } catch (e) {
        noteFailure('VFX付属モデルの構築', e);
      }
      if (built && built.root) {
        built.root.position.set(s.pos.x || 0, s.pos.y || 0, s.pos.z || 0);
        built.root.quaternion.set(s.rot.x || 0, s.rot.y || 0, s.rot.z || 0, s.rot.w == null ? 1 : s.rot.w);
        const cs = Number(built.cfgScale) > 0 ? Number(built.cfgScale) : 1;
        built.root.scale.set((s.scale.x || 1) * cs, (s.scale.y || 1) * cs, (s.scale.z || 1) * cs);
        builts.push(built);
      }
      if (stale()) return;
    }
    if (_loadChar) {
      let built = null;
      try {
        built = await _loadChar();
      } catch (e) {
        noteFailure('キャラ3Dの構築', e);
      }
      if (built && built.root) builts.push(built);
      if (stale()) return;
    }
    _fbxObjs = builts;
    const objs = builts.map((b) => b.root);
    const updaters = builts.filter((b) => b.update).map((b) => b.update);
    const motionEvs = _player.timeline().motions;
    if (motionEvs.length) {
      for (const built of _fbxObjs) {
        if (!built.setClip || !built.clipNames) continue;
        const pick = (nm) => built.clipNames.find((c) => c.toLowerCase() === String(nm).toLowerCase()) || null;
        const evs = motionEvs.map((e) => ({ t: e.t, clip: pick(e.name) })).filter((e) => e.clip);
        if (!evs.length) continue;
        let t = 0,
          i = 0;
        updaters.push((dt) => {
          t += dt;
          while (i < evs.length && evs[i].t <= t) built.setClip(evs[i++].clip);
        });
      }
    }
    if (objs.length && _player.setExtraObjects) _player.setExtraObjects(objs, updaters);
    if (_msgEl && !objs.length) _msgEl.textContent = 'この演出の3Dモデルは未取得です（3Dのダウンロードで取得できます）。';
  }

  function startMotions(entry) {
    const motion = skillMotion(entry);
    for (const built of _fbxObjs) {
      if (!built || !built.setClip) continue;
      const clip = motionClip(built.clipNames, motion, built.motionClips);
      if (!clip) continue;
      try {
        built.setClip(clip);
      } catch (e) {
        noteFailure('モーションの適用', e);
      }
      const lead = Number(built.motionTransition) >= 0 ? Number(built.motionTransition) : 0;
      if (built.update)
        try {
          built.update(lead);
        } catch (e) {
          noteFailure('モーションの先送り', e);
        }
    }
    if (_onMotion)
      try {
        _onMotion(motion);
      } catch (e) {
        noteFailure('モーションボイス', e);
      }
  }

  async function play(entry, btn) {
    const gen = ++_gen;
    stopActive();
    if (gen !== _gen) return;
    ensureField();
    const a = { entry, btn, sounds: [] };
    _active = a;
    if (btn) {
      btn.textContent = '■ 停止';
      btn.disabled = true;
      btn.classList.add('playing');
    }
    if (_msgEl) _msgEl.textContent = '';
    if (_spinEl) _spinEl.style.display = '';
    try {
      const { vfx } = await loadMods();
      if (gen !== _gen) return;
      if (!_player) _player = makePlayer(vfx);
      const parts = await getEffect(entry);
      if (gen !== _gen) return;
      const env = await vfx.loadBattleEnv();
      if (gen !== _gen) return;
      if (env && env !== _env) {
        _env = env;
        _player.setEnvironment(env.cube, env.avg, env.light);
      }
      const plan = skillPlaybackPlan(entry, (parts || []).map((r) => !!(r && r.bytes)));
      if (plan.links.length) {
        const seAll = await ensureSeUrlsPerLink(entry, parts || []);
        if (gen !== _gen) return;
        const seUrls = plan.links.map((x) => seAll[x.index]);
        let placed = 0;
        const playLinks = plan.links.map((x) => ({
          ...parts[x.index],
          role: x.role,
          placeOf: (f) => {
            const p = plan.placeOf(x, f && f.placement);
            if (p) placed++;
            return p;
          },
        }));
        const drawing = _player.play(playLinks, 0, {
          gameCamera: uiState.gameCam,
          speed: uiState.speed,
          paused: true,
          onEnd: () => {
            if (_active === a) stopActive();
          },
        });
        if (drawing !== false) {
          await applyFbx(gen);
          if (gen !== _gen) return;
          startMotions(entry);
          const tl = _player.timeline();
          const cues = tl.texts.map((ev) => ({ t: ev.t, run: () => setTelop(ev.text) }));
          for (const se of tl.sounds) {
            const url = seUrls[se.link] && seUrls[se.link].get(clipKey(se.ref));
            if (!url) continue;
            cues.push({
              t: se.t,
              run: () => {
                const au = new Audio(url);
                au.loop = !!se.looped;
                audioOut.setVolume(au, settings.get('masterVolume'));
                a.sounds.push(au);
                au.play().catch(() => {});
              },
            });
          }
          _player.setCues(cues);
          _player.setPaused(false);
        }
        const note = placementNote(plan, placed);
        if (_msgEl) _msgEl.textContent = drawing === false ? 'このエフェクトは描画される要素を持ちません（カメラ演出などの制御のみ）。' : note;
      } else if (_msgEl) {
        _msgEl.textContent = 'このエフェクトは未取得です。ダウンロードを実行してください。';
      }
    } catch (er) {
      console.error('[tp] VFX再生に失敗', er);
      if (_msgEl) _msgEl.textContent = 'VFX再生に失敗しました: ' + ((er && er.message) || er);
    }
    if (gen !== _gen) return;
    if (_spinEl) _spinEl.style.display = 'none';
    if (btn) btn.disabled = false;
  }

  async function render(entries, hostEl, opt) {
    reset();
    hostEl.innerHTML = '';
    src = { dir: (opt && opt.dir) || DIRS.shared, place: (opt && opt.place) || null, sePlace: (opt && opt.sePlace) || (opt && opt.place) || null };
    _loadFbx = (opt && opt.loadFbx) || null;
    _loadChar = (opt && opt.loadChar) || null;
    _onMotion = (opt && opt.onMotion) || null;
    const list = (entries || []).filter((e) => e && e.vfxRel);
    if (!list.length) {
      hostEl.appendChild(el('div', 'note', (opt && opt.emptyText) || 'スキルエフェクトはありません。'));
      return;
    }
    const makeBtn = (e) => {
      const btn = el('button', { class: 'btn xs vspine-btn', text: '▶ 再生' });
      btn.addEventListener('click', () => {
        if (_active && _active.btn === btn) {
          _gen++;
          stopActive();
        } else {
          play(e, btn);
        }
      });
      return btn;
    };
    const camChk = el('input', { type: 'checkbox' });
    _camChk = camChk;
    camChk.checked = !uiState.gameCam;
    camChk.addEventListener('change', () => {
      uiState.gameCam = !camChk.checked;
      if (_player && _player.setGameCamera) _player.setGameCamera(uiState.gameCam);
    });
    const spdSel = el(
      'select',
      {
        class: 'rgsel',
        on: {
          change: () => {
            uiState.speed = Number(spdSel.value) || 1;
            if (_player && _player.setSpeed) _player.setSpeed(uiState.speed);
          },
        },
      },
      SPEEDS.map((v) => el('option', { value: String(v), text: '×' + v })),
    );
    spdSel.value = String(uiState.speed);
    _pauseBtn = el('button', { class: 'btn xs', text: PAUSE_LABEL });
    _pauseBtn.addEventListener('click', () => {
      if (!_player || !_player.setPaused) return;
      const on = _player.setPaused(!(_player.isPaused && _player.isPaused()));
      _pauseBtn.textContent = on ? RESUME_LABEL : PAUSE_LABEL;
      for (const au of (_active && _active.sounds) || []) {
        if (on) au.pause();
        else if (!au.ended) au.play().catch(() => {});
      }
    });
    const toolbar = el('div', 'skillfx-toolbar');
    toolbar.appendChild(_pauseBtn);
    toolbar.appendChild(el('label', 'skillfx-toggle', [camChk, el('span', {}, 'カメラ固定')]));
    toolbar.appendChild(el('label', 'skillfx-toggle', [el('span', {}, '再生速度'), spdSel]));
    if (_loadFbx || _loadChar) {
      const fbxChk = el('input', { type: 'checkbox' });
      fbxChk.checked = uiState.showFbx;
      fbxChk.addEventListener('change', () => {
        uiState.showFbx = fbxChk.checked;
        void applyFbx(_gen);
      });
      toolbar.appendChild(el('label', 'skillfx-toggle', [fbxChk, el('span', {}, _loadChar ? 'キャラの3Dを表示' : '3Dキャラを表示')]));
    }
    hostEl.appendChild(toolbar);
    ensureField();
    _msgEl = el('div', 'note dim', '');
    hostEl.appendChild(el('div', 'skillfx-field', [_stage, _msgEl]));
    void warmUp(list);
    const listEl = el('div', 'skillfx-list');
    hostEl.appendChild(listEl);
    const heads = new Set(list.filter((e) => e.chain).map((e) => String(e.skillId)));
    for (const e of list) {
      if (!e.chain && heads.has(String(e.skillId))) continue;
      const title = el('span', 'skillfx-cap', `${e.skillName || e.effect}${chainLinksOf(e).some((l) => (l.seRels || []).length) ? '　♪' : ''}`);
      const head = el('div', 'skillfx-rowhead', [makeBtn(e), title]);
      const kids = [head];
      const meta = metaBlock(e.skillMeta);
      if (meta) kids.push(meta);
      listEl.appendChild(el('div', 'skillfx-row', kids));
    }
  }

  return { render, reset };
}
