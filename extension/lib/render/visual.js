'use strict';
(function () {
  const latin1 = new TextDecoder('iso-8859-1');
  const utf8 = new TextDecoder('utf-8'); // atlasのリージョン名に日本語(非ASCII)が入りうる＝latin1で読むと化けてskelと不一致→region未検出

  const mapLimit = async (items, limit, worker) => {
    const arr = Array.isArray(items) ? items : [];
    const out = new Array(arr.length);
    const n = Math.max(1, Math.min(Number(limit) || 1, arr.length || 1));
    let cursor = 0;
    const run = async () => {
      while (true) {
        const idx = cursor;
        cursor += 1;
        if (idx >= arr.length) break;
        out[idx] = await worker(arr[idx], idx);
      }
    };
    await Promise.all(Array.from({ length: n }, run));
    return out;
  };

  const crunch = () => globalThis.TP_CRUNCH;
  const TEX = () => globalThis.TP_TEXCODEC; // テクスチャ/画像デコード層（lib/render/texcodec.js）
  const ZOOM = () => globalThis.TP_IMGZOOM; // 全画面ズーム＋画像カード（lib/render/imgzoom.js）

  // skeletonデータがJSON(.json/先頭'{'または'[')かバイナリ(.skel)かを判定。
  const detectSkeletonIsJson = (path, bytes) => {
    const p = String(path || '').toLowerCase();
    if (p.endsWith('.json')) return true;
    if (!bytes || !bytes.length) return false;
    let i = 0;
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
    while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
    if (i < bytes.length && (bytes[i] === 0x7b || bytes[i] === 0x5b)) return true;
    if (bytes.length >= 2) {
      if (bytes[0] === 0x7b && bytes[1] === 0x00) return true;
      if (bytes[0] === 0x00 && bytes[1] === 0x7b) return true;
      if (bytes[0] === 0x5b && bytes[1] === 0x00) return true;
      if (bytes[0] === 0x00 && bytes[1] === 0x5b) return true;
    }
    return false;
  };

  const readBundle = async (cur, FS, relPath) => {
    if (!relPath || typeof relPath !== 'string') return null;
    if (relPath.startsWith('_共有リソース/')) {
      const shared = await FS.getDir('_共有リソース', false);
      if (!shared) return null;
      const sub = relPath.replace(/^_共有リソース\//, '');
      return FS.readUnder(shared, sub);
    }
    return FS.readUnder(cur.handle, relPath);
  };

  const objectUrlToAtlasPageToken = (url) => {
    const s = String(url || '');
    if (!s.startsWith('blob:')) return s;
    const i = s.lastIndexOf('/');
    return i >= 0 ? s.slice(i + 1) : s;
  };

  const collectMainSpinePaths = (meta, charId) => {
    const paths = [];
    if (meta && meta.assets && meta.assets.spine && meta.assets.spine[charId]) paths.push(meta.assets.spine[charId]);
    if (meta && meta.assets && meta.assets.spinelight && meta.assets.spinelight[charId]) paths.push(meta.assets.spinelight[charId]);
    if (meta && meta.routing && meta.routing.cast && meta.routing.cast[charId]) {
      const rec = meta.routing.cast[charId];
      if (rec.spine) paths.push(rec.spine);
      if (rec.spinelight) paths.push(rec.spinelight);
    }
    return [...new Set(paths)];
  };

  const SPINE_NONCANDIDATE_CATS = new Set(['icon', 'iconlight', 'battleicon', 'monstericon', 'chibiicon', 'itemicon', 'model', 'materials', 'cg_bg', 'scenecg', 'illustx']);

  const collectOwnSpineEntries = (meta, charId) => {
    const out = [];
    const seen = new Set();
    const add = (label, path) => {
      if (!path || typeof path !== 'string' || seen.has(path) || !/\.bundle$/i.test(path)) return;
      seen.add(path);
      out.push({ id: String(label || ''), label: String(label || ''), spinePath: path, spinelightPath: null });
    };
    const self = String(charId || '');
    const assets = (meta && meta.assets) || {};
    const order = ['spine', 'spinelight', 'still'];
    const cats = Object.keys(assets).filter((c) => !SPINE_NONCANDIDATE_CATS.has(c));
    cats.sort((a, b) => { const ia = order.indexOf(a), ib = order.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
    for (const cat of cats) {
      const rec = assets[cat];
      if (typeof rec === 'string') { add(cat, rec); continue; }
      if (!rec || typeof rec !== 'object') continue;
      for (const [k, v] of Object.entries(rec)) {
        if (typeof v !== 'string') continue;
        const label = (cat === 'spine' || cat === 'spinelight') ? cat : (k === self ? cat : (cat + ' ' + k));
        add(label, v);
      }
    }
    out.sort((a, b) => String(a.spinePath).localeCompare(String(b.spinePath))); // バンドル名(パス)順
    return out;
  };

  const isStoryCategory = (cat) => /(story|scenario|episode|event|cg|bg)/i.test(String(cat || ''));

  const isStoryBundlePath = (p) => {
    const s = String(p || '');
    return /(?:^|\/)(story|scenario|episode|event)(?:\/|$)/i.test(s)
      || /(?:^|\/)visual\/(cg_?bg|bg)(?:\/|$)/i.test(s);
  };

  const collectImageBundlePaths = (meta, charId, opt) => {
    const options = opt || {};
    const includeStory = !!options.includeStory;
    const out = [];
    const push = (p) => {
      if (!p || typeof p !== 'string') return;
      if (!/\.bundle$/i.test(p)) return;
      if (!includeStory && isStoryBundlePath(p)) return;
      out.push(p);
    };
    const assets = (meta && meta.assets) || {};
    for (const [cat, rec] of Object.entries(assets)) {
      if (!includeStory && isStoryCategory(cat)) continue;
      if (typeof rec === 'string') {
        push(rec);
        continue;
      }
      if (!rec || typeof rec !== 'object') continue;
      if (typeof rec[charId] === 'string') push(rec[charId]);
      const keys = Object.keys(rec);
      for (const k of keys) {
        if (k === charId) continue;
        const v = rec[k];
        if (typeof v !== 'string') continue;
        const isGeneralImageCat = /(icon|card|face|chara|image|spine|stand|thumb|model|3d|mesh|material|texture|body)/i.test(cat);
        const isStoryImageCat = /(cg|bg|still|story|scenario|episode|event)/i.test(cat);
        if (isGeneralImageCat || (includeStory && isStoryImageCat)) push(v);
      }
    }
    for (const p of collectMainSpinePaths(meta, charId)) push(p);
    const uniq = [...new Set(out)];
    // バンドル名(パス)順で安定表示。includeStory時は本体資産→ストーリー資産の順にしてから名前順。
    uniq.sort((a, b) => {
      if (includeStory) {
        const as = isStoryBundlePath(a) ? 1 : 0, bs = isStoryBundlePath(b) ? 1 : 0;
        if (as !== bs) return as - bs;
      }
      return String(a).localeCompare(String(b));
    });
    return uniq;
  };

  const rewriteAtlasPageNames = (atlasText, imageUrlByBase) => {
    const lines = String(atlasText || '').split(/\r?\n/);
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const t = line.trim();
      if (!t) {
        out.push(line);
        continue;
      }
      const isPageCandidate = !line.startsWith(' ') && !line.includes(':');
      if (isPageCandidate) {
        const base = t.split('/').pop();
        const repl = imageUrlByBase.get(base);
        if (repl) {
          out.push(repl);
          continue;
        }
      }
      out.push(line);
    }
    return out.join('\n');
  };

  // atlas宣言サイズ≠実テクスチャ寸法の時、拡大せず atlas座標(size/xy/orig/offset)を実寸へスケール（UVは
  // 正規化なので等価かつtexel厳密＝拡大補間/過剰縮小によるseamが出ない・ゲーム同様のnativeサンプリング）。
  const scaleAtlasCoords = (atlasBytes, sx, sy) => {
    const text = utf8.decode(atlasBytes).replace(
      /^([ \t]*)(size|xy|orig|offset):[ \t]*(-?\d+)[ \t]*,[ \t]*(-?\d+)[ \t]*$/gim,
      (m, ind, key, a, b) => `${ind}${key}: ${Math.round(Number(a) * sx)},${Math.round(Number(b) * sy)}`,
    );
    return new TextEncoder().encode(text);
  };

  const tryBuildPlayableSpineFromBundle = async (cur, FS, D, bundlePath) => {
    const f = await readBundle(cur, FS, bundlePath);
    if (!f) return { ok: false, reason: 'bundle-missing', bundlePath };
    const bytes = new Uint8Array(await f.arrayBuffer());
    const parsed = D.parseUnityFS(bytes);

    // atlas/skel は CAB 内 TextAsset から直接読む（このゲームは常にこの形）。
    let atlasPath = null, atlasBytes = null, skeletonPath = null, skeletonBytes = null;
    if (D.extractTextAssets) {
      try {
        const tas = D.extractTextAssets(bytes) || [];
        const a = tas.find((t) => /\.atlas$/i.test(t.name));
        const s = tas.find((t) => /\.skel(?:\.bytes)?$/i.test(t.name));
        if (a && a.bytes && a.bytes.length) { atlasBytes = a.bytes; atlasPath = a.name; }
        if (s && s.bytes && s.bytes.length) { skeletonBytes = s.bytes; skeletonPath = s.name; }
      } catch (e) { console.debug('[tp] spine atlas/skel extraction failed', bundlePath, e); }
    }
    if (!atlasBytes || !skeletonBytes) return { ok: false, reason: 'atlas-skeleton-missing', bundlePath };

    // テクスチャは CAB 内 Texture2D を復号。
    const imageUrlByBase = new Map();
    {
      try {
        const cmod = crunch();
        let cv = null;
        if (globalThis.TP_MESH && globalThis.TP_MESH.decodePrimaryTexture) {
          try {
            const t = globalThis.TP_MESH.decodePrimaryTexture(bytes);
            if (t && t.rgba) { const rgba = TEX().flipRgbaY(t.rgba, t.width, t.height); cv = TEX().renderRgbaToCanvas(t.width, t.height, rgba); }
          } catch (e) {}
        }
        if (!cv) {
          const cands = cmod && cmod.findInBuffer ? cmod.findInBuffer(parsed.data, 2) : [];
          if (cands && cands.length && cmod.decodeLevel0RGBA) {
            const dec = cmod.decodeLevel0RGBA(parsed.data.subarray(cands[0].offset));
            const rgba = TEX().flipRgbaY(dec.rgbaBytes, dec.width, dec.height);
            cv = TEX().renderRgbaToCanvas(dec.width, dec.height, rgba);
          }
        }
        if (!cv) {
          const canDecode = !!(cmod && cmod.ready && cmod.ready());
          const tr = TEX().extractTexture2DPreviews(parsed.data, canDecode ? cmod : null, 1, { flipY: true });
          if (tr.previews.length) cv = tr.previews[0].canvas;
        }
        if (cv) {
          const szm = latin1.decode(atlasBytes).match(/size:\s*(\d+)\s*,\s*(\d+)/);
          if (szm) {
            const pw = +szm[1], ph = +szm[2];
            if (pw > 0 && ph > 0 && (pw !== cv.width || ph !== cv.height)) {
              // テクスチャは拡大せず native のまま供給し、atlas座標を実テクスチャ寸法へスケール。
              // 拡大補間や表示縮小のフィルタ跨ぎが無くなり、口周り等の領域境界の seam が消える。
              atlasBytes = scaleAtlasCoords(atlasBytes, cv.width / pw, cv.height / ph);
            }
          }
          const blob = await (cv.convertToBlob ? cv.convertToBlob({ type: 'image/png' }) : new Promise((res) => cv.toBlob(res, 'image/png')));
          const token = objectUrlToAtlasPageToken(URL.createObjectURL(blob));
          const pages = latin1.decode(atlasBytes).split(/\r?\n/).filter((l) => l.trim() && !l.startsWith(' ') && !l.includes(':')).map((l) => l.trim().split('/').pop()).filter((n) => /\.(png|jpg|jpeg|webp)$/i.test(n));
          if (pages.length) for (const pg of pages) imageUrlByBase.set(pg, token);
          else imageUrlByBase.set('default.png', token);
        }
      } catch (e) {}
    }

    if (atlasBytes && imageUrlByBase.size > 0) {
      const atlasPageNames = latin1.decode(atlasBytes).split(/\r?\n/)
        .filter(line => line.trim() && !line.startsWith(' ') && !line.includes(':'))
        .map(line => line.trim().split('/').pop())
        .filter(name => /\.(png|jpg|jpeg|webp)$/i.test(name));
      for (const pageName of atlasPageNames) {
        if (imageUrlByBase.has(pageName)) continue;
        const existingToken = imageUrlByBase.get('default.png') || [...imageUrlByBase.values()][0];
        if (existingToken) imageUrlByBase.set(pageName, existingToken);
      }
    }

    if (imageUrlByBase.size === 0) return { ok: false, reason: 'texture-missing', bundlePath };

    const atlasText = utf8.decode(atlasBytes);
    const atlasPatched = rewriteAtlasPageNames(atlasText, imageUrlByBase);
    const atlasUrl = URL.createObjectURL(new Blob([atlasPatched], { type: 'text/plain' }));

    const isJson = detectSkeletonIsJson(skeletonPath, skeletonBytes);
    const skeletonUrl = URL.createObjectURL(new Blob([skeletonBytes], { type: isJson ? 'application/json' : 'application/octet-stream' }));

    const skelHead = Array.from(skeletonBytes.subarray(0, 12)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    
    const atlasDiag = {
      originalLineCount: atlasText.split('\n').length,
      patchedLineCount: atlasPatched.split('\n').length,
      imageMapSize: imageUrlByBase.size,
      imageMapKeys: Array.from(imageUrlByBase.keys()).slice(0, 5),
      atlasPatchSample: atlasPatched.split('\n').slice(0, 10).join('\n'),
      imageSrc: imageUrlByBase.size > 0 ? 'cab-texture2d' : 'unknown',
    };

    return {
      ok: true,
      bundlePath,
      atlasPath,
      skeletonPath,
      imagePaths: [...imageUrlByBase.keys()],
      atlasUrl,
      skeletonUrl,
      isJson,
      skelHead,
      skelSize: skeletonBytes.length,
      atlasDiag,
    };
  };

  const startSpinePlayerAnimation = (player) => {
    try {
      const data = player && player.skeleton && player.skeleton.data;
      const anims = (data && data.animations) || [];
      if (!anims.length || !player.animationState) return;
      const names = anims.map((a) => a.name);
      const pick = names.includes('idle_normal') ? 'idle_normal' : (names.find((n) => /idle/i.test(n)) || names[0]);
      if (pick) player.animationState.setAnimation(0, pick, true);
    } catch (e) {}
  };

  const buildSpineFromEntry = async (cur, FS, D, entry) => {
    let lastErr = null;
    for (const p of [entry.spinePath, entry.spinelightPath].filter(Boolean)) {
      try {
        const r = await tryBuildPlayableSpineFromBundle(cur, FS, D, p);
        if (r && r.ok) return { built: r };
        lastErr = r;
      } catch (e) {
        lastErr = { ok: false, reason: e && e.message ? e.message : String(e), bundlePath: p };
      }
    }
    return { built: null, lastErr };
  };

  const MAX_SPINE_PREVIEWS = 12;
  // 描画世代。キャラ切替/新規描画で++し、await滞留中の旧描画を無効化（前キャラのSpineが遅延完了して混入するのを防ぐ）
  let _renderGen = 0;
  let _activePlayers = []; // 現行(最新)描画が生成したSpinePlayer群（外部/次描画からの破棄用）
  function disposeSpinePlayers() {
    _renderGen++; // in-flightな renderSpinePreview を無効化（alive()がfalseになる）
    for (const sp of _activePlayers) { try { sp && sp.dispose && sp.dispose(); } catch (e) {} }
    _activePlayers = [];
  }
  const currentRenderGen = () => _renderGen;

  async function renderSpinePreview(cur, FS, D, hostEl) {
    if (!hostEl) return { ok: false, reason: 'host-missing' };
    if (!(globalThis.spine && globalThis.spine.SpinePlayer)) return { ok: false, reason: 'spine-runtime-not-ready' };
    const entries = collectOwnSpineEntries((cur && cur.meta) || {}, String(cur && cur.charId || ''));
    if (!entries.length) { disposeSpinePlayers(); return { ok: false, reason: 'no-spine-bundle-paths' }; }

    disposeSpinePlayers(); // 前回のプレイヤーを破棄＋世代++
    const myGen = _renderGen;
    const alive = () => myGen === _renderGen; // 以降に新しい描画/切替が起きたらfalse
    const myPlayers = [];
    _activePlayers = myPlayers; // この描画が現行の所有者
    hostEl.style.display = '';
    hostEl.innerHTML = '';
    hostEl.classList.remove('spine-preview-error');

    // spine立ち絵(spine/spinelight)は2列、stillは横幅いっぱいの1列で縦積み。
    const standWrap = document.createElement('div'); standWrap.className = 'spine-grid stand';
    const stillWrap = document.createElement('div'); stillWrap.className = 'spine-grid still';
    hostEl.appendChild(standWrap); hostEl.appendChild(stillWrap);
    const isStill = (entry) => /\/still\//i.test(entry.spinePath || '') || /^still/i.test(entry.label || '');

    const shown = entries.slice(0, MAX_SPINE_PREVIEWS);
    const results = [];
    let anyOk = false;

    for (const entry of shown) {
      if (!alive()) break; // 別キャラへ移った＝この描画は破棄済み→中断
      const cell = document.createElement('div');
      cell.className = 'spine-cell';
      const cap = document.createElement('div');
      cap.className = 'spine-cell-cap';
      cap.textContent = (entry.label || entry.id || 'spine');
      cell.appendChild(cap);
      (isStill(entry) ? stillWrap : standWrap).appendChild(cell);

      const { built, lastErr } = await buildSpineFromEntry(cur, FS, D, entry);
      if (!alive()) { cell.remove(); break; } // await中に無効化された
      if (!built) {
        const note = document.createElement('div');
        note.className = 'note';
        note.textContent = '再生不可: ' + ((lastErr && lastErr.reason) || 'unknown');
        cell.appendChild(note);
        results.push({ id: entry.id, ok: false, reason: (lastErr && lastErr.reason) || 'unknown' });
        continue;
      }

      const box = document.createElement('div');
      box.className = 'spine-player-box';
      cell.appendChild(box);

      let playerErr = null;
      const opt = {
        atlasUrl: built.atlasUrl,
        alpha: true,
        premultipliedAlpha: true,
        showControls: true,
        fitToCanvas: true,
        backgroundColor: '#00000000',
        success: (player) => startSpinePlayerAnimation(player),
        // error コールバックは (player, error) の2引数（第1=player循環参照・実エラーは第2）
        error: (player, err) => {
          if (playerErr) return; // 連続発火するので一度だけ
          const e0 = (err !== undefined && err !== null) ? err : player;
          playerErr = (e0 && e0.message) ? e0.message : (typeof e0 === 'string' ? e0 : String(e0));
          const e = document.createElement('div');
          e.className = 'note';
          e.textContent = 'Spine失敗: ' + playerErr;
          cell.appendChild(e);
          try { player && player.dispose && player.dispose(); } catch (x) {} // リトライループを止める
        },
      };
      if (built.isJson) opt.jsonUrl = built.skeletonUrl;
      else opt.skelUrl = built.skeletonUrl;

      try {
        myPlayers.push(new globalThis.spine.SpinePlayer(box, opt));
        anyOk = true;
      } catch (e) {
        playerErr = e && e.message ? e.message : String(e);
      }
      results.push({ id: entry.id, ok: !playerErr, bundlePath: built.bundlePath, isJson: built.isJson, playerError: playerErr });
    }

    if (!alive()) { // 途中で無効化＝この描画が作ったプレイヤーを破棄して撤収（現行所有者は既に次の描画）
      for (const sp of myPlayers) { try { sp && sp.dispose && sp.dispose(); } catch (e) {} }
      return { ok: false, reason: 'superseded' };
    }
    if (!standWrap.children.length) standWrap.remove();
    if (!stillWrap.children.length) stillWrap.remove();
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { ok: anyOk, total: entries.length, shown: shown.length, truncated: entries.length > MAX_SPINE_PREVIEWS, entries: results };
  }

  async function renderImageGallery(cur, FS, D, hostEl, opt) {
    if (!hostEl) return { ok: false, error: 'host element missing' };
    const cmod = crunch();
    const canCrunch = !!(cmod && cmod.ready && cmod.ready());
    const unityCrunchSupported = !!(canCrunch && cmod.supportsUnityCrunched && cmod.supportsUnityCrunched());

    const options = opt || {};
    const includeStoryAssets = !!options.includeStoryAssets;
    const maxBundles = Math.max(1, Math.min(200, Number(options.maxBundles) || 40));
    const maxItems = Math.max(1, Math.min(128, Number(options.maxItems) || 32));
    const maxConcurrent = Math.max(1, Math.min(8, Number(options.maxConcurrent) || 4));
    const flipY = options.flipY !== false;
    const myGen = currentRenderGen(); // 開始時の描画世代（別キャラへ移ると変わる）

    hostEl.style.display = '';
    hostEl.innerHTML = '';

    const paths = collectImageBundlePaths(cur.meta || {}, String(cur.charId || ''), { includeStory: includeStoryAssets }).slice(0, maxBundles);
    if (!paths.length) {
      hostEl.textContent = '画像系バンドルの候補が見つかりませんでした。';
      return { ok: false, error: 'no image bundle paths' };
    }

    const wrap = document.createElement('div');
    wrap.className = 'texprev';
    const summary = {
      ok: true,
      scannedBundles: paths.length,
      rendered: 0,
      failed: 0,
      items: [],
      mode: canCrunch ? 'crn+embedded' : 'embedded-only',
      maxConcurrent,
      flipY,
      includeStoryAssets,
      crunchSupport: {
        runtimeReady: canCrunch,
        unityCrunched: unityCrunchSupported,
      },
      failReasonCounts: {},
      failSamples: [],
    };

    const bundleResults = await mapLimit(paths, maxConcurrent, async (p) => {
      const result = { path: p, rendered: false, items: [], failSamples: [], failed: 0 };
      try {
        const f = await readBundle(cur, FS, p);
        if (!f) {
          result.failed = 1;
          result.failSamples.push({ path: p, reason: 'missing-file' });
          return result;
        }
        const bytes = new Uint8Array(await f.arrayBuffer());
        const parsed = D.parseUnityFS(bytes);

        if (!result.rendered) {
          const texResult = TEX().extractTexture2DPreviews(parsed.data, canCrunch ? cmod : null, 12, { flipY });
          for (const t of texResult.previews) {
            result.items.push({
              path: p,
              offset: t.offset,
              width: t.width,
              height: t.height,
              type: t.type,
              canvas: t.canvas,
            });
          }
          if (result.items.length) {
            result.rendered = true;
          } else {
            const probe = {
              texHeaders: texResult.stats.headerCandidates,
              texBlobResolved: texResult.stats.blobResolved,
              texDecoded: texResult.stats.decoded,
              texCrunchedSeen: texResult.stats.crunchedSeen,
              texCrunchedProbeFailed: texResult.stats.crunchedProbeFailed,
              texCrunchedDecodeFailed: texResult.stats.crunchedDecodeFailed,
              texUnityCrunchedUnsupported: texResult.stats.unityCrunchedUnsupported,
            };
            result.failSamples.push({
              path: p,
              reason: (!unityCrunchSupported && texResult.stats.crunchedSeen > 0) ? 'unity-crunch-decode-unavailable' : 'texture2d-decode-failed',
              probe,
            });
          }
        }

        if (!result.rendered) {
          const embedded = TEX().extractEmbeddedImages(parsed.data, 2);
          for (const e of embedded) {
            const mime = e.type === 'jpg' ? 'image/jpeg' : `image/${e.type}`;
            const enc = flipY ? await TEX().flipEncodedImageBytesY(e.bytes, mime) : { bytes: e.bytes, width: e.width, height: e.height };
            const url = URL.createObjectURL(new Blob([enc.bytes], { type: mime }));
            result.items.push({
              path: p,
              offset: e.offset,
              width: enc.width || e.width,
              height: enc.height || e.height,
              type: e.type,
              imgUrl: url,
            });
          }
          if (result.items.length) result.rendered = true;
        }

        if (!result.rendered && canCrunch && unityCrunchSupported) {
          const cands = cmod.findInBuffer(parsed.data, 1);
          let crnLastErr = null;
          for (const cand of cands) {
            try {
              const dec = cmod.decodeLevel0RGBA(parsed.data.subarray(cand.offset));
              // Texture2D経路と同様に flipY に従う（無いとcrn直接スキャンだけ向きが食い違う）
              const rgba = flipY ? TEX().flipRgbaY(dec.rgbaBytes, dec.width, dec.height) : dec.rgbaBytes;
              result.items.push({
                path: p,
                offset: cand.offset,
                width: dec.width,
                height: dec.height,
                type: 'crn',
                canvas: TEX().renderRgbaToCanvas(dec.width, dec.height, rgba),
              });
              result.rendered = true;
              break;
            } catch (e) {
              crnLastErr = e;
            }
          }
          if (!result.rendered && cands.length && crnLastErr) {
            result.failSamples.push({
              path: p,
              reason: crnLastErr && crnLastErr.message ? crnLastErr.message : String(crnLastErr),
              crnProbe: cands[0] && cands[0].info ? cands[0].info : null,
            });
          }
        } else if (!result.rendered && canCrunch && !unityCrunchSupported) {
          result.failSamples.push({ path: p, reason: 'skip-crn-scan-unitycrunch-unsupported' });
        }

        if (!result.rendered) {
          result.failed = 1;
          result.failSamples.push({ path: p, reason: 'no-crn-no-texture2d-and-no-embedded-image' });
        }
      } catch (e) {
        result.failed = 1;
        result.failSamples.push({ path: p, reason: e && e.message ? e.message : String(e) });
      }
      return result;
    });

    // 重い並列読み込み中に別キャラへ移っていたら、この結果を新キャラのホストに描かずに撤収
    if (myGen !== currentRenderGen()) return { ok: false, superseded: true };

    for (const res of bundleResults) {
      summary.failed += res.failed || 0;
      for (const s of (res.failSamples || [])) {
        const rk = String((s && s.reason) || 'unknown');
        summary.failReasonCounts[rk] = (summary.failReasonCounts[rk] || 0) + 1;
        if (summary.failSamples.length >= 8) break;
        summary.failSamples.push(s);
      }
      for (const item of (res.items || [])) {
        if (summary.rendered >= maxItems) break;
        wrap.appendChild(ZOOM().createImageCard(item, { flipY }));
        summary.items.push({ path: item.path, width: item.width, height: item.height, offset: item.offset, type: item.type });
        summary.rendered += 1;
      }
      if (summary.rendered >= maxItems) break;
    }

    if (!summary.rendered) {
      hostEl.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'note';
      head.textContent = '候補バンドルは見つかりましたが、表示可能な画像を生成できませんでした。';
      hostEl.appendChild(head);
      if (summary.failSamples.length) {
        const pre = document.createElement('pre');
        pre.className = 'statusout';
        pre.textContent = JSON.stringify({ failSamples: summary.failSamples });
        hostEl.appendChild(pre);
      }
      return {
        ok: false,
        error: 'no renderable images',
        scannedBundles: summary.scannedBundles,
        failed: summary.failed,
        failReasonCounts: summary.failReasonCounts,
        consideration: {
          topFailedReasons: Object.entries(summary.failReasonCounts).sort((a, b) => b[1] - a[1]).slice(0, 6),
          note: 'unity-crunch-decode-unavailable が上位なら、ブラウザ内UnityCrunch復号未対応が主因です。',
        },
      };
    }

    hostEl.appendChild(wrap);
    return summary;
  }

  const canvasToPngBytes = async (canvas) => {
    if (!canvas) return null;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
  };

  async function saveDecodedResources(cur, FS, D, opt) {
    const options = opt || {};
    const includeStory = !!options.includeStory;
    const flipY = options.flipY !== false;
    const cmod = crunch();
    const canCrunch = !!(cmod && cmod.ready && cmod.ready());
    const unityCrunchSupported = !!(canCrunch && cmod.supportsUnityCrunched && cmod.supportsUnityCrunched());

    if (!cur || !cur.handle || !FS || !FS.writeUnder || !FS.readUnder) {
      return { ok: false, reason: 'invalid-context' };
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseDir = `_decoded_export/${String(cur.charId || 'char')}_${stamp}`;
    const out = {
      ok: true,
      baseDir,
      includeStory,
      flipY,
      imageSaved: 0,
      voiceSaved: 0,
      timelineSaved: 0,
      imageBundlesScanned: 0,
      imageBundlesFailed: 0,
      failReasonCounts: {},
      failSamples: [],
    };

    const addFail = (reason, bundlePath) => {
      const key = String(reason || 'unknown');
      out.failReasonCounts[key] = (out.failReasonCounts[key] || 0) + 1;
      if (out.failSamples.length < 12) out.failSamples.push({ path: bundlePath || null, reason: key });
    };

    const imgPaths = collectImageBundlePaths(cur.meta || {}, String(cur.charId || ''), { includeStory: false });
    out.imageBundlesScanned = imgPaths.length;

    let imageIdx = 0;
    for (const p of imgPaths) {
      try {
        const f = await readBundle(cur, FS, p);
        if (!f) {
          out.imageBundlesFailed += 1;
          addFail('missing-file', p);
          continue;
        }
        const bytes = new Uint8Array(await f.arrayBuffer());
        const parsed = D.parseUnityFS(bytes);
        const texResult = TEX().extractTexture2DPreviews(parsed.data, canCrunch ? cmod : null, 12, { flipY });
        const embedded = TEX().extractEmbeddedImages(parsed.data, 4);

        let wrote = 0;
        for (const t of texResult.previews) {
          const png = await canvasToPngBytes(t.canvas);
          if (!png) continue;
          const bn = (p.split('/').pop() || 'bundle').replace(/\.bundle$/i, '');
          const sub = `${baseDir}/images/${bn}__tex_${imageIdx}.png`;
          await FS.writeUnder(cur.handle, sub, png);
          imageIdx += 1;
          out.imageSaved += 1;
          wrote += 1;
        }

        for (let i = 0; i < embedded.length; i++) {
          const e = embedded[i];
          const ext = e.type === 'jpg' ? 'jpg' : e.type;
          const bn = (p.split('/').pop() || 'bundle').replace(/\.bundle$/i, '');
          const sub = `${baseDir}/images/${bn}__embedded_${i}.${ext}`;
          const mime = e.type === 'jpg' ? 'image/jpeg' : `image/${e.type}`;
          const enc = flipY ? await TEX().flipEncodedImageBytesY(e.bytes, mime) : { bytes: e.bytes };
          await FS.writeUnder(cur.handle, sub, enc.bytes);
          out.imageSaved += 1;
          wrote += 1;
        }

        if (!wrote) {
          out.imageBundlesFailed += 1;
          if (!unityCrunchSupported && texResult.stats.crunchedSeen > 0) addFail('unity-crunch-decode-unavailable', p);
          else addFail('no-renderable-image', p);
        }
      } catch (e) {
        out.imageBundlesFailed += 1;
        addFail(e && e.message ? e.message : String(e), p);
      }
    }

    const saveVoiceBundle = async (voicePath, prefix) => {
      if (!voicePath) return;
      const vf = await FS.readUnder(cur.handle, voicePath);
      if (!vf) {
        addFail('missing-voice-bundle', voicePath);
        return;
      }
      try {
        const clips = D.extractVoiceClips(new Uint8Array(await vf.arrayBuffer()));
        const bn = (voicePath.split('/').pop() || 'voice').replace(/\.bundle$/i, '');
        for (const c of clips) {
          const nm = String(c.name || 'voice').replace(/[\\/:*?"<>|]+/g, '_');
          const sub = `${baseDir}/${prefix}/${bn}/${nm}.mp4`;
          await FS.writeUnder(cur.handle, sub, c.data);
          out.voiceSaved += 1;
        }
      } catch (e) {
        addFail('voice-extract-failed', voicePath);
      }
    };

    if (cur.meta && cur.meta.voiceGallery) {
      await saveVoiceBundle(cur.meta.voiceGallery, 'voice/character');
    }

    if (includeStory && cur.meta && Array.isArray(cur.meta.episodes)) {
      for (const ep of cur.meta.episodes) {
        if (!ep || !ep.available) continue;
        const eid = String(ep.episodeMasterId || 'episode');
        if (Array.isArray(ep.scenes)) {
          for (const s of ep.scenes) {
            if (s && s.timeline) {
              const tf = await FS.readUnder(cur.handle, s.timeline);
              if (tf) {
                const bytes = new Uint8Array(await tf.arrayBuffer());
                const tlName = (String(s.sceneId || 'scene') + '.json').replace(/[\\/:*?"<>|]+/g, '_');
                await FS.writeUnder(cur.handle, `${baseDir}/story/${eid}/timeline/${tlName}`, bytes);
                out.timelineSaved += 1;
              }
            }
            if (s && s.voice) await saveVoiceBundle(s.voice, `voice/story/${eid}`);
          }
        }
      }
    }

    out.consideration = {
      topFailedReasons: Object.entries(out.failReasonCounts).sort((a, b) => b[1] - a[1]).slice(0, 6),
      note: 'unity-crunch-decode-unavailable が多い場合は、ブラウザ内UnityCrunch復号未対応が主因です。',
    };
    return out;
  }

  // Spine Web Player(vendor/spine-player-3.8.js)を遅延ロードする。
  async function prepareSpineRuntime(hostEl) {
    if (!hostEl) return { ok: false, error: 'host element missing' };
    hostEl.style.display = '';
    if (globalThis.spine && globalThis.spine.SpinePlayer) return { ok: true, alreadyLoaded: true };
    const jsUrl = chrome.runtime.getURL('vendor/spine-player-3.8.js');
    const cssUrl = chrome.runtime.getURL('vendor/spine-player-3.8.css');
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = cssUrl;
    document.head.appendChild(css);
    try {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = jsUrl;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
      return { ok: true, loadedNow: true };
    } catch (e) {
      hostEl.textContent = 'Spine Web Player の読み込みに失敗。vendor/spine-player-3.8.{js,css} を配置してください。';
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  }

  globalThis.TP_VISUAL = {
    prepareSpineRuntime,
    renderImageGallery,
    renderSpinePreview,
    disposeSpinePlayers,
    saveDecodedResources,
  };
})();
