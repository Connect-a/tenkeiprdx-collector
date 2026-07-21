'use strict';
(function () {
  function createController(deps) {
    const { S, $, V, FS, D, toast, storage } = deps;
    const errMsg = (e) => (e && e.message ? e.message : String(e));
    const notify = (msg, kind) => { if (typeof toast === 'function') toast(msg, kind); };
    let show3d = true, showSpine = true; // 3Dモデル/Spine表示のトグル(ext storageに保存)

    // オーラ(VFX)＝任意装備コスメ。カタログ取得/列挙/解決はTP_AURA共有。ピッカーは3D枠内コントロール(model3d buildControls)に生成する。
    const listAuras = () => (globalThis.TP_AURA ? globalThis.TP_AURA.list() : Promise.resolve([]));
    const loadAura = (rel) => globalThis.TP_AURA ? globalThis.TP_AURA.load(rel) : null;

    function showSpinner(host, label) {
      if (!host) return;
      host.style.display = '';
      host.innerHTML = '<div class="loadspin"><span class="spin"></span><span class="loadtxt">' + (label || '読み込み中…') + '</span></div>';
    }
    function showError(host, msg) {
      if (!host) return;
      host.style.display = '';
      host.innerHTML = '';
      const d = document.createElement('div'); d.className = 'note'; d.style.padding = '8px'; d.textContent = msg;
      host.appendChild(d);
    }

    async function runImageGallery() {
      const imageHost = $('imageHost');
      if (!imageHost || !S.cur || !V || !V.renderImageGallery) return;
      const flipY = !!($('imageFlipY') ? $('imageFlipY').checked : true);
      showSpinner(imageHost, '画像を読み込み中…');
      try {
        await V.renderImageGallery(S.cur, FS, D, imageHost, {
          maxBundles: 120, maxItems: 96, maxConcurrent: 4, flipY, includeStoryAssets: true,
        });
      } catch (e) { showError(imageHost, '画像表示失敗: ' + errMsg(e)); }
      await runSpine();
    }

    async function runSpine() {
      const spineHost = $('spineHost');
      if (!spineHost || !S.cur || !V) return;
      if (!showSpine) { if (V.disposeSpinePlayers) V.disposeSpinePlayers(); spineHost.style.display = 'none'; spineHost.innerHTML = ''; return; }
      showSpinner(spineHost, 'Spineを読み込み中…');
      try {
        if (V.prepareSpineRuntime) await V.prepareSpineRuntime(spineHost);
        if (V.renderSpinePreview) await V.renderSpinePreview(S.cur, FS, D, spineHost);
      } catch (e) { showError(spineHost, 'Spine表示失敗: ' + errMsg(e)); }
    }

    function clearMouthDlNotice() { const n = $('mouthDlNotice'); if (n) n.remove(); }
    function showMouthDlNotice(host) {
      clearMouthDlNotice();
      if (!host || !host.parentNode) return;
      const bar = document.createElement('div');
      bar.id = 'mouthDlNotice'; bar.className = 'note'; bar.style.cssText = 'padding:8px;margin:0 0 6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap';
      const txt = document.createElement('span'); txt.textContent = '口の描画には共有リソース（口アトラス）が必要です。'; bar.appendChild(txt);
      const btn = document.createElement('button'); btn.textContent = '口アトラスをDL'; btn.className = 'btn';
      btn.addEventListener('click', async () => {
        if (!(globalThis.TP_ACQUIRE && globalThis.TP_ACQUIRE.downloadMouthAtlas)) return;
        btn.disabled = true; txt.textContent = '口アトラスをDL中…';
        try {
          const bytes = await globalThis.TP_ACQUIRE.downloadMouthAtlas();
          if (bytes) { clearMouthDlNotice(); await render3dModel(); notify('口アトラスを取得しました', 'ok'); }
          else { txt.textContent = '口アトラスの取得に失敗しました（フォルダ許可/接続を確認）'; btn.disabled = false; }
        } catch (e) { txt.textContent = 'DL失敗: ' + errMsg(e); btn.disabled = false; }
      });
      bar.appendChild(btn);
      host.parentNode.insertBefore(bar, host);
    }

    async function render3dModel() {
      const host = $('model3dHost');
      if (!host || !S.cur) return;
      if (!show3d) { if (S._model3d && S._model3d.dispose) { try { S._model3d.dispose(); } catch (e) {} S._model3d = null; } clearMouthDlNotice(); host.style.display = 'none'; host.innerHTML = ''; return; }
      if (!globalThis.THREE || !globalThis.TP_MODEL3D || !globalThis.TP_CHARASSETS) return;
      const assets = (S.cur.meta || {}).assets || {};
      const charId = String(S.cur.charId || '');
      const hasModel = assets.model && (assets.model[charId] || assets.model[Object.keys(assets.model)[0]]);
      if (!hasModel) { host.style.display = 'none'; host.innerHTML = ''; return; }
      showSpinner(host, '3Dモデルを読み込み中…');
      try {
        if (S._model3d && S._model3d.dispose) { try { S._model3d.dispose(); } catch (e) {} S._model3d = null; }
        const d = await globalThis.TP_CHARASSETS.load3d(S.cur, { costume: S._costume });
        if (!d) { showError(host, 'modelバンドルを読めませんでした'); return; }
        host.style.display = '';
        const costumeOpt = { list: d.variations, current: d.costume, onChange: (v) => { S._costume = v; render3dModel(); } };
        const shadingOpt = { mode: S._shading || 'game', onChange: (v) => { S._shading = v; render3dModel(); } };
        const auraSel = S._aura || '';
        const auraList = await listAuras();
        const aura = await loadAura(auraSel);
        const auraOpt = { list: auraList, current: auraSel, onChange: (rel) => { S._aura = rel; render3dModel(); } };
        S._model3d = globalThis.TP_MODEL3D.render(host, d.model, d.matBundle, { height: 560, mouthAtlas: d.mouthAtlas, weapons: d.weapons, costume: costumeOpt, shading: shadingOpt, aura: auraOpt, auraBytes: aura && aura.bytes, auraTexMap: aura && aura.texByMatPid });
        if (d.mouthAtlas) clearMouthDlNotice(); else showMouthDlNotice(host);
      } catch (e) { showError(host, '3D表示失敗: ' + errMsg(e)); }
    }

    async function saveDecodedPack() {
      if (!S.cur) { notify('先にキャラを開いてください', 'err'); return; }
      if (!V || !V.saveDecodedResources) { notify('保存機能が読み込まれていません', 'err'); return; }
      const flipY = !!($('imageFlipY') ? $('imageFlipY').checked : true);
      const btn = $('saveDecodedPack'); if (btn) btn.disabled = true;
      notify('デコード結果を保存しています…');
      try {
        await V.saveDecodedResources(S.cur, FS, D, { includeStory: true, flipY });
        notify('デコード結果を保存しました', 'ok');
      } catch (e) { notify('保存失敗: ' + errMsg(e), 'err'); }
      finally { if (btn) btn.disabled = false; }
    }

    function onTabSwitched(name) {
      if (name !== 'image' || !S.cur) return;
      const key = String(S.cur.charId || '') + ':' + String((S.cur.meta && S.cur.meta.builtAt) || '');
      if (S.imageAutoKey !== key) {
        S.imageAutoKey = key;
        runImageGallery();
        render3dModel();
      }
    }

    function resetForCharacter() {
      S.imageAutoKey = null;
      if (S._model3d && S._model3d.dispose) { try { S._model3d.dispose(); } catch (e) {} }
      S._model3d = null; S._costume = null;
      clearMouthDlNotice();
      const host = $('model3dHost');
      if (host) { host.style.display = 'none'; host.innerHTML = ''; }
    }

    function bind() {
      $('saveDecodedPack')?.addEventListener('click', saveDecodedPack);
      $('imageFlipY')?.addEventListener('change', () => { if (S.cur) runImageGallery(); });
      $('show3d')?.addEventListener('change', async () => {
        show3d = !!$('show3d').checked;
        if (storage && storage.set) { try { await storage.set({ imgShow3d: show3d }); } catch (e) {} }
        if (S.cur) render3dModel();
      });
      $('showSpine')?.addEventListener('change', async () => {
        showSpine = !!$('showSpine').checked;
        if (storage && storage.set) { try { await storage.set({ imgShowSpine: showSpine }); } catch (e) {} }
        if (S.cur) runSpine();
      });
    }

    async function initFromStorage() {
      try { if (storage && storage.get) { const o = await storage.get(['imgShow3d', 'imgShowSpine']); show3d = o.imgShow3d !== false; showSpine = o.imgShowSpine !== false; } } catch (e) {}
      const c3 = $('show3d'), cs = $('showSpine');
      if (c3) c3.checked = show3d;
      if (cs) cs.checked = showSpine;
    }

    return { bind, initFromStorage, onTabSwitched, resetForCharacter };
  }

  globalThis.TP_PLAYER_IMAGE = { createController };
})();
