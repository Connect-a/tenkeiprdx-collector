import { auraRenderer } from '../../engine/render/aura.js';
import { assetAcquirer } from '../../data/acquire/acquire-assemble.js';
import { model3dRenderer } from '../../engine/render/model3d.js';
import { glManager } from '../../engine/render/gl-manager.js';
import { charAssets } from '../../data/char-assets.js';
import { errText } from '../../core/messages.js';
import { MOTION_VOICE } from '../../core/constants.js';
import { characterMeta } from '../../data/character-meta.js';
import { voiceOut } from './voice-out.js';
import { utilHelpers } from '../../core/util.js';
import { settings } from '../../core/settings.js';
import { el } from '../../core/dom.js';
import { groupHeading, downloadBar } from '../ui/panel-shell.js';

export function createImagePanel(deps) {
  const { playerState, getById, visualRenderer, toast, spinnerHtml } = deps;
  const notify = (msg, tone) => {
    if (typeof toast === 'function') toast(msg, tone);
  };
  const show3d = () => settings.get('show3d');
  const showSpine = () => settings.get('showSpine');
  let _load3d = { key: null, byCostume: new Map() };
  let _weapon3d = [];
  const _glRebuildOk = glManager.makeRebuildLimiter(8000, 2);
  const onGlContextLost = () => {
    if (_glRebuildOk()) {
      render3dModel();
      return true;
    }
    notify('GPUの描画コンテキストが復帰しません。ページを再読み込みしてください。', 'err');
    return false;
  };

  const listAuras = () => (auraRenderer ? auraRenderer.list() : Promise.resolve([]));
  const loadAura = (rel) => (auraRenderer ? auraRenderer.load(rel) : null);

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
      voiceOut.play(await utilHelpers.cachedAudioUrl(playerState.cur.voiceUrls, clip.name, async () => clip));
    } catch (e) {}
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
    playerState._model3d = model3dRenderer.disposeModel3d(playerState._model3d);
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
    const host = getById('model3dHost');
    if (!host || !playerState.cur) return;
    if (!show3d()) {
      playerState._model3d = model3dRenderer.disposeModel3d(playerState._model3d);
      host.style.display = 'none';
      host.innerHTML = '';
      renderWeapons3d(null);
      return;
    }
    if (!model3dRenderer || !charAssets) return;
    const assets = (playerState.cur.meta || {}).assets || {};
    const folderKey = String(playerState.cur.folderKey || '');
    const hasModel = assets.model && (assets.model[folderKey] || assets.model[Object.keys(assets.model)[0]]);
    if (!hasModel) {
      host.style.display = 'none';
      host.innerHTML = '';
      renderWeapons3d(null);
      return;
    }
    if (assetAcquirer && assetAcquirer.sharedResourcesPresent && !(await assetAcquirer.sharedResourcesPresent())) {
      showSharedResNotice(host);
      return;
    }
    showSpinner(host, '3Dモデルを読み込み中…');
    try {
      playerState._model3d = model3dRenderer.disposeModel3d(playerState._model3d);
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
          m.setAura(a && a.bytes, a && a.texByMatPid, false);
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
        auraRenderer: auraOpt,
        motionVoice: voiceOpt,
        auraBytes: auraLoaded && auraLoaded.bytes,
        auraTexMap: auraLoaded && auraLoaded.texByMatPid,
      });
      opts.onContextLost = onGlContextLost;
      playerState._model3d = model3dRenderer.render(host, d.model, d.matBundle, opts);
      renderWeapons3d(d.weapons);
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

  function renderWeapons3d(weapons) {
    const host = getById('weapon3dHost');
    if (!host) return;
    disposeWeapons3d();
    const list = (weapons || []).filter((w) => w && w.model);
    if (!show3d() || !list.length) {
      host.style.display = 'none';
      host.innerHTML = '';
      return;
    }
    host.style.display = '';
    host.innerHTML = '';
    groupHeading(host, `武器 ${list.length}種`);
    const grid = el('div', 'weapongrid');
    host.appendChild(grid);
    for (const w of list) {
      const box = el('div');
      const cell = el('div', 'weaponcell', [el('div', 'note dim', `#${w.id || '?'}　${w.slot || ''}`), box]);
      grid.appendChild(cell);
      const r = model3dRenderer.render(box, w.model, w.materials, { height: 240 });
      if (r && r.dispose) _weapon3d.push(r);
      if (r && r.ok === false) cell.appendChild(el('div', 'note', '表示できませんでした（' + (r.reason || '不明') + '）'));
    }
  }

  async function saveDecodedPack() {
    if (!playerState.cur) return;
    const flipY = settings.get('imageFlipY');
    let destDir = null;
    if (globalThis.showDirectoryPicker) {
      try {
        destDir = await globalThis.showDirectoryPicker({ id: 'tpDecodedExport', mode: 'readwrite', startIn: 'downloads' });
      } catch (e) {
        return;
      }
      if (destDir.requestPermission && (await destDir.requestPermission({ mode: 'readwrite' })) !== 'granted') {
        notify('保存先の書き込み許可がありません', 'err');
        return;
      }
    }
    const btn = getById('saveDecodedPack');
    if (btn) btn.disabled = true;
    notify('デコード結果を保存しています…');
    try {
      const r = await visualRenderer.saveDecodedResources(playerState.cur, { includeStory: true, flipY, destDir });
      notify(`デコード結果を保存しました（${destDir ? destDir.name : '既定の保存先'}/${(r && r.baseDir) || ''}）`, 'ok');
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
      runImageGallery();
      render3dModel();
    }
  }

  function resetForCharacter() {
    playerState.imageAutoKey = null;
    _load3d = { key: null, byCostume: new Map() };
    playerState._model3d = model3dRenderer.disposeModel3d(playerState._model3d);
    playerState._costume = null;
    disposeWeapons3d();
    for (const id of ['model3dHost', 'weapon3dHost']) {
      const host = getById(id);
      if (host) {
        host.style.display = 'none';
        host.innerHTML = '';
      }
    }
  }

  function bind() {
    getById('saveDecodedPack')?.addEventListener('click', saveDecodedPack);
    settings.subscribe((n) => {
      if (!playerState.cur) return;
      if (n === 'imageFlipY') runImageGallery();
      else if (n === 'show3d') render3dModel();
      else if (n === 'showSpine') runSpine();
    });
  }

  return { bind, onTabSwitched, resetForCharacter };
}
