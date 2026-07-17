'use strict';
(function () {
  function createController(deps) {
    const { S, $, V, FS, D, toast } = deps;
    const errMsg = (e) => (e && e.message ? e.message : String(e));
    const notify = (msg, kind) => { if (typeof toast === 'function') toast(msg, kind); };

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
      const spineHost = $('spineHost');
      if (!imageHost || !spineHost || !S.cur || !V || !V.renderImageGallery) return;
      const flipY = !!($('imageFlipY') ? $('imageFlipY').checked : true);
      showSpinner(imageHost, '画像を読み込み中…');
      showSpinner(spineHost, 'Spineを読み込み中…');
      try {
        await V.renderImageGallery(S.cur, FS, D, imageHost, {
          maxBundles: 120, maxItems: 96, maxConcurrent: 4, flipY, includeStoryAssets: true,
        });
      } catch (e) { showError(imageHost, '画像表示失敗: ' + errMsg(e)); }
      try {
        if (V.prepareSpineRuntime) await V.prepareSpineRuntime(spineHost); // Spineランタイム(vendor/spine-player-3.8.js)を遅延ロード
        if (V.renderSpinePreview) await V.renderSpinePreview(S.cur, FS, D, spineHost);
      } catch (e) { showError(spineHost, 'Spine表示失敗: ' + errMsg(e)); }
    }

    async function readCharBundle(relPath) {
      if (!relPath || !S.cur || !S.cur.handle) return null;
      const f = await FS.readUnder(S.cur.handle, relPath);
      if (!f) return null;
      return new Uint8Array(await f.arrayBuffer());
    }

    // shared mouth expression atlas (mouth_texture_preset). Read-only: does NOT download.
    // Returns the parsed atlas, or null (render3dModel then shows a DL prompt with a button).
    function parseMouthAtlas(bytes) {
      if (!bytes || !globalThis.TP_MESH) return null;
      const mb = globalThis.TP_MESH.parseMaterialBundle(bytes);
      const mp = (mb.textures || []).find((t) => t.name === 'mouth_texture_preset' && t.rgba);
      return mp ? { rgba: mp.rgba, width: mp.width, height: mp.height } : null;
    }
    async function loadMouthAtlas() {
      try {
        const bytes = globalThis.TP_COLLECTION && globalThis.TP_COLLECTION.readMouthAtlas ? await globalThis.TP_COLLECTION.readMouthAtlas() : null;
        return parseMouthAtlas(bytes);
      } catch (e) { return null; }
    }

    // Show a notice + DL button above the 3D viewer when the shared mouth atlas is missing.
    function clearMouthDlNotice() { const n = $('mouthDlNotice'); if (n) n.remove(); }
    function showMouthDlNotice(host) {
      clearMouthDlNotice();
      if (!host || !host.parentNode) return;
      const bar = document.createElement('div');
      bar.id = 'mouthDlNotice'; bar.className = 'note'; bar.style.cssText = 'padding:8px;margin:0 0 6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap';
      const txt = document.createElement('span'); txt.textContent = '口の描画には共有リソース（口アトラス）が必要です。'; bar.appendChild(txt);
      const btn = document.createElement('button'); btn.textContent = '口アトラスをDL'; btn.className = 'btn';
      btn.addEventListener('click', async () => {
        if (!(globalThis.TP_COLLECTION && globalThis.TP_COLLECTION.downloadMouthAtlas)) return;
        btn.disabled = true; txt.textContent = '口アトラスをDL中…';
        try {
          const bytes = await globalThis.TP_COLLECTION.downloadMouthAtlas();
          if (bytes) { clearMouthDlNotice(); await render3dModel(); notify('口アトラスを取得しました', 'ok'); }
          else { txt.textContent = '口アトラスの取得に失敗しました（フォルダ許可/接続を確認）'; btn.disabled = false; }
        } catch (e) { txt.textContent = 'DL失敗: ' + errMsg(e); btn.disabled = false; }
      });
      bar.appendChild(btn);
      host.parentNode.insertBefore(bar, host);
    }

    // equipped 3D weapons (downloaded to visual/weapon/ and linked via meta.assets.weapon)
    async function loadWeapons(assets) {
      const wmap = assets && assets.weapon;
      if (!wmap || !globalThis.TP_MESH) return null;
      const out = [];
      for (const id of Object.keys(wmap)) {
        const w = wmap[id];
        try {
          const mb = w.model ? await readCharBundle(w.model) : null;
          if (!mb) continue;
          const model = globalThis.TP_MESH.parseModelBundle(mb);
          const matB = w.materials ? await readCharBundle(w.materials) : null;
          const materials = matB ? globalThis.TP_MESH.parseMaterialBundle(matB) : { materials: [], textures: [] };
          out.push({ model, materials, slot: w.slot || 'wp_2', scale: w.scale || 1 });
        } catch (e) {}
      }
      return out.length ? out : null;
    }

    async function render3dModel() {
      const host = $('model3dHost');
      if (!host || !S.cur) return;
      if (!globalThis.THREE || !globalThis.TP_MESH || !globalThis.TP_MODEL3D) return;
      const assets = (S.cur.meta || {}).assets || {};
      const charId = String(S.cur.charId || '');
      const modelPath = assets.model && (assets.model[charId] || assets.model[Object.keys(assets.model)[0]]);
      // costume/material variations (e.g. 標準/属性別). Downloaded per-variation into assets.materials.
      const variations = Object.keys(assets.materials || {});
      const costume = (S._costume && variations.includes(S._costume)) ? S._costume : (variations.includes('default') ? 'default' : variations[0]);
      const matPath = (assets.materials && (assets.materials[costume] || assets.materials[charId])) || null;
      if (!modelPath) { host.style.display = 'none'; host.innerHTML = ''; return; }
      showSpinner(host, '3Dモデルを読み込み中…');
      try {
        if (S._model3d && S._model3d.dispose) { try { S._model3d.dispose(); } catch (e) {} S._model3d = null; }
        const modelBytes = await readCharBundle(modelPath);
        if (!modelBytes) { showError(host, 'modelバンドルを読めませんでした'); return; }
        const matBytes = matPath ? await readCharBundle(matPath) : null;
        const model = globalThis.TP_MESH.parseModelBundle(modelBytes);
        const matBundle = matBytes ? globalThis.TP_MESH.parseMaterialBundle(matBytes) : { materials: [], textures: [] };
        const mouthAtlas = await loadMouthAtlas();
        const weapons = await loadWeapons(assets);
        host.style.display = '';
        const costumeOpt = { list: variations, current: costume, onChange: (v) => { S._costume = v; render3dModel(); } };
        const shadingOpt = { mode: S._shading || 'unlit', onChange: (v) => { S._shading = v; render3dModel(); } };
        S._model3d = globalThis.TP_MODEL3D.render(host, model, matBundle, { height: 560, mouthAtlas, weapons, costume: costumeOpt, shading: shadingOpt });
        if (mouthAtlas) clearMouthDlNotice(); else showMouthDlNotice(host);
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
        render3dModel(); // 3D shows by default (no button needed)
      }
    }

    function resetForCharacter() {
      S.imageAutoKey = null;
      if (S._model3d && S._model3d.dispose) { try { S._model3d.dispose(); } catch (e) {} }
      S._model3d = null; S._costume = null; // keep S._shading as a cross-character preference
      clearMouthDlNotice();
      const host = $('model3dHost');
      if (host) { host.style.display = 'none'; host.innerHTML = ''; }
    }

    function bind() {
      $('saveDecodedPack')?.addEventListener('click', saveDecodedPack);
      $('imageFlipY')?.addEventListener('change', () => { if (S.cur) runImageGallery(); });
    }

    return { bind, onTabSwitched, resetForCharacter };
  }

  globalThis.TP_PLAYER_IMAGE = { createController };
})();
