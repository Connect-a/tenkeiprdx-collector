import { assetAcquirer } from '../../data/acquire/acquire-assemble.js';
import { loadModel3d, model3dSync, disposeModel3d, loadAura as getAuraRenderer } from '../../engine/render/lazy.js';
import { makeRebuildLimiter } from '../../engine/render/gl-manager.js';
import { charAssets } from '../../data/char-assets.js';
import { errText } from '../../core/messages.js';
import { DIRS } from '../../core/dirs.js';
import { MOTION_VOICE } from '../../engine/render/motion-names.js';
import { characterMeta } from '../../data/character-meta.js';
import { voiceOut } from './voice-out.js';
import { cachedAudioUrl } from '../../core/audio-url.js';
import { settings } from '../../core/settings.js';
import { el } from '../../core/dom.js';
import { downloadBar } from '../ui/panel-shell.js';
import { createSkillFxView } from '../views/skillfx-view.js';
import { ensureIndexes } from '../../data/index-store.js';
import { buildIndexes } from '../../data/build-indexes.js';
import { PLACE } from '../../core/assetpath/placement.js';

export function createImagePanel(deps) {
  const { playerState, getById, visualRenderer, toast, spinnerHtml } = deps;
  const notify = (msg, tone) => {
    if (typeof toast === 'function') toast(msg, tone);
  };
  const show3d = () => settings.get('show3d');
  const showSpine = () => settings.get('showSpine');
  let _load3d = { key: null, byCostume: new Map() };
  let _weapon3d = [];
  let _weaponsData = null;
  let _builtWeapons = false;
  let _builtSkillFx = false;
  let _syncClip = null;
  let _syncSpeed = 1;
  const _skillFx = createSkillFxView();
  let _visuals = Promise.resolve();
  const _glRebuildOk = makeRebuildLimiter(8000, 2);
  const onGlContextLost = () => {
    if (_glRebuildOk()) {
      render3dModel();
      return true;
    }
    notify('GPUの描画コンテキストが復帰しません。ページを再読み込みしてください。', 'err');
    return false;
  };

  const listAuras = async () => (await getAuraRenderer()).list();
  const loadAura = async (rel) => (await getAuraRenderer()).load(rel);

  const voiceNoOf = (nm) => {
    const m = String(nm).match(/_(\d+)[a-z]*$/i);
    return m ? parseInt(m[1], 10) : 0;
  };

  async function playMotionVoice(motionName) {
    const no = MOTION_VOICE[String(motionName).toLowerCase()];
    if (!no || !playerState.cur) return;
    const bundle = characterMeta.voiceGalleryBundle((playerState.cur.meta || {}).voiceGallery);
    if (!bundle) return;
    try {
      const clips = await charAssets.extractClips(playerState.cur.handle, bundle);
      const clip = clips.find((c) => voiceNoOf(c.name) === no);
      if (!clip) return;
      voiceOut.play(await cachedAudioUrl(playerState.cur.voiceUrls, clip.name, async () => clip));
    } catch (e) {}
  }

  function syncSplitLayout() {
    const split = document.querySelector('#image .imgsplit');
    if (!split) return;
    const shown = ['model3dHost', 'weapon3dHost', 'spineHost'].some((id) => {
      const h = getById(id);
      return h && h.style.display !== 'none';
    });
    split.classList.toggle('solo', !shown);
  }

  function showSpinner(host, label) {
    if (!host) return;
    host.style.display = '';
    host.innerHTML = spinnerHtml(label);
  }
  function showError(host, msg) {
    if (!host) return;
    host.style.display = '';
    host.innerHTML = '';
    host.appendChild(el('div', { class: 'note', style: { padding: '8px' }, text: msg }));
  }

  async function runImageGallery() {
    const imageHost = getById('imageHost');
    if (!imageHost || !playerState.cur || !visualRenderer || !visualRenderer.renderImageGallery) return;
    const flipY = settings.get('imageFlipY');
    showSpinner(imageHost, '画像を読み込み中…');
    try {
      await visualRenderer.renderImageGallery(playerState.cur, imageHost, {
        maxBundles: 120,
        maxItems: 96,
        maxConcurrent: 4,
        flipY,
        includeStoryAssets: true,
      });
    } catch (e) {
      showError(imageHost, '画像を表示できませんでした。' + errText(e));
    }
    await runSpine();
  }

  async function runSpine() {
    try {
      await runSpineInner();
    } finally {
      syncSplitLayout();
    }
  }

  async function runSpineInner() {
    const spineHost = getById('spineHost');
    if (!spineHost || !playerState.cur || !visualRenderer) return;
    if (!showSpine()) {
      if (visualRenderer.disposeSpinePlayers) visualRenderer.disposeSpinePlayers();
      spineHost.style.display = 'none';
      spineHost.innerHTML = '';
      return;
    }
    showSpinner(spineHost, 'Spineを読み込み中…');
    try {
      await visualRenderer.renderSpinePreview(playerState.cur, spineHost);
    } catch (e) {
      showError(spineHost, '立ち絵を表示できませんでした。' + errText(e));
    }
  }

  function showSharedResNotice(host) {
    if (!host) return;
    playerState._model3d = disposeModel3d(playerState._model3d);
    host.style.display = '';
    host.innerHTML = '';
    host.appendChild(
      downloadBar({
        text: '3D表示には共有リソース（背景・口など）が必要です。先に共有リソースをダウンロードしてください。',
        label: '共有リソースをダウンロード',
        run: async (onProgress) => {
          try {
            const r = await assetAcquirer.runSharedResourceDownload(onProgress);
            notify(`共有リソースを取得しました（新規${r.got}件・既にあった分${r.skip}件／全${r.total}件）`, 'ok');
            await render3dModel();
          } catch (e) {
            onProgress(errText(e));
          }
        },
      }),
    );
  }

  async function render3dModel() {
    try {
      await render3dModelInner();
    } finally {
      syncSplitLayout();
    }
  }

  async function render3dModelInner() {
    const host = getById('model3dHost');
    if (!host || !playerState.cur) return;
    if (!show3d()) {
      playerState._model3d = disposeModel3d(playerState._model3d);
      host.style.display = 'none';
      host.innerHTML = '';
      _weaponsData = null;
      syncM3dSections();
      return;
    }
    if (!charAssets) return;
    const assets = (playerState.cur.meta || {}).assets || {};
    const folderKey = String(playerState.cur.folderKey || '');
    const hasModel = assets.model && (assets.model[folderKey] || assets.model[Object.keys(assets.model)[0]]);
    if (!hasModel) {
      host.style.display = 'none';
      host.innerHTML = '';
      _weaponsData = null;
      syncM3dSections();
      return;
    }
    if (assetAcquirer && assetAcquirer.sharedResourcesPresent && !(await assetAcquirer.sharedResourcesPresent())) {
      showSharedResNotice(host);
      return;
    }
    showSpinner(host, '3Dモデルを読み込み中…');
    try {
      playerState._model3d = disposeModel3d(playerState._model3d);
      const charKey = playerState.contentKey();
      if (_load3d.key !== charKey) _load3d = { key: charKey, byCostume: new Map() };
      const costumeKey = String(playerState._costume || '');
      let d = _load3d.byCostume.get(costumeKey);
      if (!d) {
        d = await charAssets.load3d(playerState.cur, { costume: playerState._costume });
        if (d) _load3d.byCostume.set(costumeKey, d);
      }
      if (!d) {
        showError(host, 'modelバンドルを読めませんでした');
        return;
      }
      host.style.display = '';
      const costumeOpt = {
        list: d.variations,
        current: d.costume,
        onChange: (v) => {
          playerState._costume = v;
          render3dModel();
        },
      };
      const auraSel = playerState._aura || '';
      const auraList = await listAuras();
      const auraLoaded = await loadAura(auraSel);
      const applyAura = async (rel) => {
        const m = playerState._model3d;
        if (m && m.setAura) {
          const a = rel ? await loadAura(rel) : null;
          m.setAura(a && a.bytes, a && a.texByMatPid);
        } else render3dModel();
      };
      const auraOpt = {
        list: auraList,
        current: auraSel,
        onChange: async (rel) => {
          playerState._aura = rel;
          await applyAura(rel);
        },
      };
      let voiceOpt = null;
      if (characterMeta.voiceGalleryBundle((playerState.cur.meta || {}).voiceGallery)) {
        voiceOpt = { enabled: settings.get('motionVoice'), onMotion: playMotionVoice };
        voiceOpt.onToggle = (on) => {
          voiceOpt.enabled = on;
          settings.set('motionVoice', on);
        };
      }
      const opts = charAssets.build3dOptions(d, playerState.cur.meta, {
        height: 560,
        costume: costumeOpt,
        auraPicker: auraOpt,
        motionVoice: voiceOpt,
        auraBytes: auraLoaded && auraLoaded.bytes,
        auraTexMap: auraLoaded && auraLoaded.texByMatPid,
      });
      opts.onContextLost = onGlContextLost;
      opts.onClip = (name) => {
        _syncClip = name;
        for (const r of _weapon3d) if (r && r.setClip) r.setClip(name);
      };
      opts.onSpeed = (v) => {
        _syncSpeed = v;
        for (const r of _weapon3d) if (r && r.setSpeed) r.setSpeed(v);
      };
      playerState._model3d = (await loadModel3d()).render(host, d.model, d.matBundle, opts);
      _weaponsData = d.weapons;
      syncM3dSections();
    } catch (e) {
      showError(host, '3Dモデルを表示できませんでした。' + errText(e));
    }
  }

  function disposeWeapons3d() {
    for (const r of _weapon3d) {
      try {
        r && r.dispose && r.dispose();
      } catch (e) {}
    }
    _weapon3d = [];
  }

  function buildWeaponsSection() {
    const host = getById('weapon3dHost');
    if (!host) return;
    _builtWeapons = true;
    disposeWeapons3d();
    host.innerHTML = '';
    const list = (_weaponsData || []).filter((w) => w && w.model);
    const r3d = model3dSync();
    if (!list.length || !r3d) {
      host.appendChild(el('div', 'note', '武器はありません。'));
      return;
    }
    const grid = el('div', 'weapongrid');
    host.appendChild(grid);
    for (const w of list) {
      const box = el('div');
      const cell = el('div', 'weaponcell', [el('div', 'note dim', `#${w.id || '?'}　${w.slot || ''}`), box]);
      grid.appendChild(cell);
      const r = r3d.render(box, w.model, w.materials, { height: 240, hidePartsUI: true, hidePlaybackUI: true });
      if (r && r.dispose) _weapon3d.push(r);
      if (r && r.ok !== false) {
        if (_syncClip && r.setClip) r.setClip(_syncClip);
        if (r.setSpeed) r.setSpeed(_syncSpeed);
      }
      if (r && r.ok === false) cell.appendChild(el('div', 'note', '表示できませんでした（' + (r.reason || '不明') + '）'));
    }
  }

  async function buildSkillFxSection() {
    const host = getById('skillfxHost');
    const cur = playerState.cur;
    if (!host || !cur) return;
    _builtSkillFx = true;
    host.innerHTML = spinnerHtml('スキルエフェクトを準備中…');
    try {
      const idx = await ensureIndexes();
      const eff = buildIndexes.charSkillEffects(idx.master, idx.assets, String(cur.folderKey));
      await _skillFx.render(eff.unique, host, {
        dir: cur.handle,
        place: PLACE.visual('skillfx'),
        sePlace: PLACE.visual('skillfx/se'),
        emptyText: 'このキャラ固有のスキルエフェクトはありません。共通のものは「その他3D」で再生できます。',
      });
    } catch (e) {
      showError(host, 'スキルエフェクトを表示できませんでした。' + errText(e));
    }
  }

  const isCharacterEntry = () => {
    const cur = playerState.cur;
    if (!cur) return false;
    if (playerState.rosterKind && playerState.rosterKind !== 'character') return false;
    const apiType = (cur.meta || {}).apiType;
    return !apiType || apiType === 'Character';
  };

  function syncM3dSections() {
    const on = show3d() && isCharacterEntry();
    const hasWeapons = !!playerState._model3d && (_weaponsData || []).some((w) => w && w.model);
    const dW = getById('dWeaponDeco');
    const dS = getById('dSkillFx');
    if (dW) {
      dW.style.display = on && hasWeapons ? '' : 'none';
      if (on && hasWeapons && dW.open && !_builtWeapons) buildWeaponsSection();
    }
    if (dS) {
      dS.style.display = on ? '' : 'none';
      if (on && dS.open && !_builtSkillFx) buildSkillFxSection();
    }
  }

  async function saveDecodedPack() {
    if (!playerState.cur) return;
    const flipY = settings.get('imageFlipY');
    const btn = getById('saveDecodedPack');
    if (btn) btn.disabled = true;
    notify('デコード結果を保存しています…');
    try {
      const r = await visualRenderer.saveDecodedResources(playerState.cur, { includeStory: true, flipY });
      if (!r || r.ok === false) {
        notify(r && r.reason === 'no-save-dir' ? '先に保存先フォルダを選んでください' : '保存できませんでした', 'err');
        return;
      }
      notify(`デコード結果を保存しました（${DIRS.save}/${r.baseDir}）`, 'ok');
    } catch (e) {
      notify('保存できませんでした。' + errText(e), 'err');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function onTabSwitched(name) {
    if (name !== 'image' || !playerState.cur) return;
    const key = playerState.contentKey();
    if (playerState.imageAutoKey !== key) {
      playerState.imageAutoKey = key;
      _visuals = Promise.all([runImageGallery(), render3dModel()]).catch(() => {});
    }
  }

  function resetForCharacter() {
    _visuals = Promise.resolve();
    playerState.imageAutoKey = null;
    _load3d = { key: null, byCostume: new Map() };
    playerState._model3d = disposeModel3d(playerState._model3d);
    playerState._costume = null;
    disposeWeapons3d();
    _skillFx.dispose();
    _weaponsData = null;
    _builtWeapons = false;
    _builtSkillFx = false;
    _syncClip = null;
    _syncSpeed = 1;
    for (const id of ['model3dHost', 'weapon3dHost', 'skillfxHost']) {
      const host = getById(id);
      if (host) {
        if (id === 'model3dHost') host.style.display = 'none';
        host.innerHTML = '';
      }
    }
    for (const id of ['dWeaponDeco', 'dSkillFx']) {
      const d = getById(id);
      if (d) {
        d.open = false;
        d.style.display = 'none';
      }
    }
    syncSplitLayout();
  }

  function bind() {
    getById('saveDecodedPack')?.addEventListener('click', saveDecodedPack);
    getById('dWeaponDeco')?.addEventListener('toggle', () => {
      if (getById('dWeaponDeco').open && !_builtWeapons) buildWeaponsSection();
    });
    getById('dSkillFx')?.addEventListener('toggle', () => {
      if (getById('dSkillFx').open && !_builtSkillFx) buildSkillFxSection();
    });
    settings.subscribe((n) => {
      if (!playerState.cur) return;
      if (n === 'imageFlipY') runImageGallery();
      else if (n === 'show3d') render3dModel();
      else if (n === 'showSpine') runSpine();
    });
  }

  return { bind, onTabSwitched, resetForCharacter, visualsReady: () => _visuals };
}
