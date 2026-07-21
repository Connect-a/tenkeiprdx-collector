'use strict';
(function () {
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

  const CRUNCH = () => globalThis.TP_CRUNCH;
  const TEX = () => globalThis.TP_TEXCODEC;
  const ZOOM = () => globalThis.TP_IMGZOOM;

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

  const getVisuals = (meta) => (meta && Array.isArray(meta.visuals) && meta.visuals) || (globalThis.TP_BUILD && globalThis.TP_BUILD.buildVisuals ? globalThis.TP_BUILD.buildVisuals(meta || {}) : []);
  const spineVisuals = (meta) => getVisuals(meta).filter((v) => v.kind === 'spine' && /\.bundle$/i.test(v.path || ''));
  const imageVisuals = (meta) => getVisuals(meta).filter((v) => v.kind === 'image' && /\.bundle$/i.test(v.path || ''));


  const extractSpineInputsFromBundle = async (cur, FS, D, bundlePath) => {
    const f = await readBundle(cur, FS, bundlePath);
    if (!f) return { ok: false, reason: 'bundle-missing', bundlePath };
    const inp = globalThis.TP_MESH.extractSpineInputs(new Uint8Array(await f.arrayBuffer()));
    if (!inp) return { ok: false, reason: 'spine-inputs-missing', bundlePath };
    return { ok: true, bundlePath, ...inp };
  };

  const extractSpineFromEntry = async (cur, FS, D, entry) => {
    let lastErr = null;
    for (const p of [entry.spinePath].filter(Boolean)) {
      try {
        const r = await extractSpineInputsFromBundle(cur, FS, D, p);
        if (r && r.ok) return { inputs: r };
        lastErr = r;
      } catch (e) {
        lastErr = { ok: false, reason: e && e.message ? e.message : String(e), bundlePath: p };
      }
    }
    return { inputs: null, lastErr };
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

  let _galleryUrls = [];
  function disposeGallery() { for (const u of _galleryUrls) { try { URL.revokeObjectURL(u); } catch (e) {} } _galleryUrls = []; }

  async function renderSpinePreview(cur, FS, D, hostEl) {
    if (!hostEl) return { ok: false, reason: 'host-missing' };
    if (!(globalThis.spine && globalThis.spine.SpinePlayer)) return { ok: false, reason: 'spine-runtime-not-ready' };
    const entries = spineVisuals((cur && cur.meta) || {})
      .map((v) => ({ id: v.label, label: v.label, spinePath: v.path, stand: v.stand !== false }))
      .sort((a, b) => (a.stand === b.stand ? String(a.spinePath).localeCompare(String(b.spinePath)) : (a.stand ? -1 : 1)));
    if (!entries.length) { disposeSpinePlayers(); return { ok: false, reason: 'no-spine-bundle-paths' }; }

    disposeSpinePlayers();
    const myGen = _renderGen;
    const alive = () => myGen === _renderGen;
    const myPlayers = [];
    _activePlayers = myPlayers;
    hostEl.style.display = '';
    hostEl.innerHTML = '';
    hostEl.classList.remove('spine-preview-error');

    const standWrap = document.createElement('div'); standWrap.className = 'spine-grid stand';
    const stillWrap = document.createElement('div'); stillWrap.className = 'spine-grid still';
    hostEl.appendChild(standWrap); hostEl.appendChild(stillWrap);
    const isStill = (entry) => entry.stand === false;

    const shown = entries.slice(0, MAX_SPINE_PREVIEWS);
    const results = [];
    let anyOk = false;

    for (const entry of shown) {
      if (!alive()) break;
      const cell = document.createElement('div');
      cell.className = 'spine-cell';
      const cap = document.createElement('div');
      cap.className = 'spine-cell-cap';
      cap.textContent = (entry.label || entry.id || 'spine');
      cell.appendChild(cap);
      (isStill(entry) ? stillWrap : standWrap).appendChild(cell);

      const { inputs, lastErr } = await extractSpineFromEntry(cur, FS, D, entry);
      if (!alive()) { cell.remove(); break; }
      if (!inputs) {
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

      const stl = isStill(entry); // still(CG)は箱を実CGのアスペクト比に合わせる＝列幅いっぱいに正しく充填(CGごとに縦横比が違う)
      let playerErr = null;
      const onError = (msg) => {
        if (playerErr) return;
        playerErr = msg;
        const e = document.createElement('div'); e.className = 'note'; e.textContent = 'Spine失敗: ' + msg;
        cell.appendChild(e);
      };
      try {
        const { player } = globalThis.TP_SPINE.buildPlayable(box, inputs, {
          showControls: true, backgroundColor: '#00000000', onError,
          onReady: (pl) => {
            if (stl) {
              let asp = 0;
              try { const vp = pl.currentViewport; if (vp && vp.width > 0 && vp.height > 0) asp = vp.width / vp.height; } catch (e) {}
              if (!asp) { try { const sp = globalThis.spine; const o2 = new sp.Vector2(), s2 = new sp.Vector2(); pl.skeleton.setToSetupPose(); pl.skeleton.updateWorldTransform(); pl.skeleton.getBounds(o2, s2, []); if (s2.x > 0 && s2.y > 0) asp = s2.x / s2.y; } catch (e) {} }
              if (asp > 0) box.style.aspectRatio = asp.toFixed(4);
            }
            globalThis.TP_SPINE.startDefaultIdle(pl);
            if (stl && pl.drawFrame) { try { pl.drawFrame(false); } catch (e) {} }
          },
        });
        myPlayers.push(player);
        anyOk = true;
      } catch (e) {
        playerErr = e && e.message ? e.message : String(e);
        onError(playerErr);
      }
      results.push({ id: entry.id, ok: !playerErr, bundlePath: inputs.bundlePath, playerError: playerErr });
    }

    if (!alive()) {
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
    disposeGallery();
    const cmod = CRUNCH();
    const canCrunch = !!(cmod && cmod.canDecodeCrunched && cmod.canDecodeCrunched());
    const unityCrunchSupported = !!(canCrunch && cmod.supportsUnityCrunched && cmod.supportsUnityCrunched());

    const options = opt || {};
    const includeStoryAssets = !!options.includeStoryAssets;
    const maxBundles = Math.max(1, Math.min(200, Number(options.maxBundles) || 40));
    const maxItems = Math.max(1, Math.min(128, Number(options.maxItems) || 32));
    const maxConcurrent = Math.max(1, Math.min(8, Number(options.maxConcurrent) || 4));
    const flipY = options.flipY !== false;
    const myGen = currentRenderGen();

    hostEl.style.display = '';
    hostEl.innerHTML = '';

    let paths = imageVisuals(cur.meta || {}).map((v) => v.path);
    if (includeStoryAssets && cur.handle && FS.walkBundles) {
      try {
        const known = new Set([...paths, ...spineVisuals(cur.meta || {}).map((v) => v.path)]);
        const SKIP = /voice|bgm|\/model\/|3dmodel|materialsbundles|weapon|spine|\.skel|\.atlas|se_assets|vfx|movie|getdetails|(^|\/)scene\//i;
        for (const rel of await FS.walkBundles(cur.handle)) { if (known.has(rel) || SKIP.test(rel)) continue; known.add(rel); paths.push(rel); }
      } catch (e) { console.debug('[tp] walkBundles(gallery) failed', e); }
    }
    paths = paths.slice(0, maxBundles);
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
              // Texture2D経路と同様にflipYに従う（無いとcrn直接スキャンだけ向きが食い違う）
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

    if (myGen !== currentRenderGen()) return { ok: false, superseded: true };

    for (const res of bundleResults) {
      for (const it of (res.items || [])) if (it.imgUrl) _galleryUrls.push(it.imgUrl);
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
    const cmod = CRUNCH();
    const canCrunch = !!(cmod && cmod.canDecodeCrunched && cmod.canDecodeCrunched());
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

    const imgPaths = [...new Set([...imageVisuals(cur.meta || {}), ...spineVisuals(cur.meta || {})].map((v) => v.path))];
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
    disposeGallery,
    saveDecodedResources,
  };
})();
