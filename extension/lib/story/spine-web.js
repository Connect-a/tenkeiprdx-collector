'use strict';
// TP_SPINE — Spine立ち絵/stillのWeb描画コア。
// ★肝（横断知見・_hack/08）：decode済み生premult rgbaをtexImage2Dで直接アップロードし、
//   canvas/PNG往復による低alpha縁の丸め崩れ（頬の赤み等の縁の線）を回避する。
(function () {
  const latin1 = new TextDecoder('iso-8859-1');
  const utf8 = new TextDecoder('utf-8'); // atlasリージョン名の非ASCII（日本語）対策

  const flipRgbaY = (rgba, width, height) => globalThis.TP_TEXCODEC.flipRgbaY(rgba, width, height);
  const rgbaToCanvas = (width, height, rgba) => {
    const c = document.createElement('canvas'); c.width = width; c.height = height;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height), 0, 0);
    return c;
  };
  const objectUrlToPageToken = (url) => { const s = String(url || ''); if (!s.startsWith('blob:')) return s; const i = s.lastIndexOf('/'); return i >= 0 ? s.slice(i + 1) : s; };
  const pageNamesOf = (atlasBytes) => latin1.decode(atlasBytes).split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith(' ') && !l.includes(':'))
    .map((l) => l.trim().split('/').pop())
    .filter((n) => /\.(png|jpg|jpeg|webp)$/i.test(n));
  const rewriteAtlasPageNames = (atlasText, token) => atlasText.split(/\r?\n/).map((line) => {
    const t = line.trim();
    return (t && !line.startsWith(' ') && !line.includes(':') && /\.(png|jpg|jpeg|webp)$/i.test(t)) ? token : line;
  }).join('\n');
  // atlas宣言サイズ≠実テクスチャ時、座標(size/xy/orig/offset)を実寸へスケール（native供給・拡大しない）。
  // Spineはpage.width=実画像幅 で上書きするため座標スケールは不可避。orig/offsetもスケールが正しい
  // （RegionAttachment.updateOffsetはthis.width/region.originalWidth比で使うため比が保たれ世界サイズ不変）。
  const scaleAtlasCoords = (atlasBytes, sx, sy) => new TextEncoder().encode(utf8.decode(atlasBytes).replace(
    /^([ \t]*)(size|xy|orig|offset):[ \t]*(-?\d+)[ \t]*,[ \t]*(-?\d+)[ \t]*$/gim,
    (m, ind, key, a, b) => `${ind}${key}: ${Math.round(Number(a) * sx)},${Math.round(Number(b) * sy)}`));
  const detectSkeletonIsJson = (path, bytes) => {
    const p = String(path || '').toLowerCase();
    if (p.endsWith('.json')) return true;
    if (!bytes || !bytes.length) return false;
    let i = 0;
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
    while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
    if (i < bytes.length && (bytes[i] === 0x7b || bytes[i] === 0x5b)) return true;
    return false;
  };

  // ★canvas/PNG往復を回避：生premult rgbaを各ページテクスチャへ直接texImage2D（縁の線を回避）。
  // Spineは既にPNG経由でページテクスチャ生成済み＝寸法/UVはそのまま、画素だけ上書きする。
  const uploadRawTexturePixels = (player, flippedRgba, width, height) => {
    if (!flippedRgba) return;
    try {
      const skins = (player && player.skeleton && player.skeleton.data && player.skeleton.data.skins) || [];
      const seen = new Set();
      const buf = new Uint8Array(flippedRgba.buffer, flippedRgba.byteOffset, flippedRgba.byteLength);
      for (const skin of skins) for (const m of (skin.attachments || [])) {
        if (!m) continue;
        for (const key in m) {
          const glt = m[key] && m[key].region && m[key].region.texture;
          if (!glt || !glt.context || seen.has(glt)) continue;
          seen.add(glt);
          const gl = glt.context.gl;
          glt.bind();
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        }
      }
    } catch (e) { console.debug('[tp-spine] uploadRawTexturePixels failed', e); }
  };

  const startDefaultIdle = (player) => {
    try {
      const anims = (player && player.skeleton && player.skeleton.data && player.skeleton.data.animations) || [];
      if (!anims.length || !player.animationState) return;
      const names = anims.map((a) => a.name);
      const pick = names.includes('idle_normal') ? 'idle_normal' : (names.find((n) => /idle/i.test(n)) || names[0]);
      if (pick) player.animationState.setAnimation(0, pick, true);
    } catch (e) {}
  };

  const runtimeReady = () => !!(globalThis.spine && globalThis.spine.SpinePlayer);

  const buildPlayable = (host, input, opts) => {
    if (!runtimeReady()) throw new Error('spine-runtime-not-ready');
    if (!host) throw new Error('host-missing');
    const o = opts || {};
    let atlasBytes = input.atlasBytes;
    const tex = input.texture;
    if (!atlasBytes || !input.skeletonBytes || !tex || !tex.rgba) throw new Error('spine-inputs-incomplete');

    const flipped = flipRgbaY(tex.rgba, tex.width, tex.height);
    const cv = rgbaToCanvas(tex.width, tex.height, flipped);

    const szm = latin1.decode(atlasBytes).match(/size:\s*(\d+)\s*,\s*(\d+)/);
    if (szm) { const pw = +szm[1], ph = +szm[2]; if (pw > 0 && ph > 0 && (pw !== cv.width || ph !== cv.height)) atlasBytes = scaleAtlasCoords(atlasBytes, cv.width / pw, cv.height / ph); }

    const pngUrl = URL.createObjectURL(canvasToPngBlob(cv));
    const token = objectUrlToPageToken(pngUrl);

    const atlasText = utf8.decode(atlasBytes);
    const atlasUrl = URL.createObjectURL(new Blob([rewriteAtlasPageNames(atlasText, token)], { type: 'text/plain' }));
    const isJson = detectSkeletonIsJson(input.skeletonPath, input.skeletonBytes);
    const skeletonUrl = URL.createObjectURL(new Blob([input.skeletonBytes], { type: isJson ? 'application/json' : 'application/octet-stream' }));

    let erred = false;
    const cfg = {
      atlasUrl,
      alpha: true,
      premultipliedAlpha: o.premultipliedAlpha !== false,
      showControls: !!o.showControls,
      fitToCanvas: o.fitToCanvas !== false,
      backgroundColor: o.backgroundColor || '#00000000',
      success: (player) => {
        uploadRawTexturePixels(player, flipped, tex.width, tex.height);
        if (o.onReady) { try { o.onReady(player); } catch (e) {} } else startDefaultIdle(player);
      },
      // errorは(player, err)の2引数（第1=player循環参照・実エラーは第2）。一度だけ通知しdisposeでリトライ停止。
      error: (player, err) => {
        if (erred) return; erred = true;
        const e0 = (err !== undefined && err !== null) ? err : player;
        const msg = (e0 && e0.message) ? e0.message : (typeof e0 === 'string' ? e0 : String(e0));
        if (o.onError) { try { o.onError(msg, player); } catch (e) {} }
        try { player && player.dispose && player.dispose(); } catch (x) {}
      },
    };
    if (isJson) cfg.jsonUrl = skeletonUrl; else cfg.skelUrl = skeletonUrl;

    const player = new globalThis.spine.SpinePlayer(host, cfg);
    const _urls = [pngUrl, atlasUrl, skeletonUrl];
    const prevDispose = player.dispose && player.dispose.bind(player);
    player.dispose = function () { for (const u of _urls) { try { URL.revokeObjectURL(u); } catch (e) {} } if (prevDispose) return prevDispose(); };
    gateByVisibility(player, host);
    return { player, isJson };
  };

  // ★複数のSpineプレイヤー＋3Dが同一ページで並走するとフレームが飛び再生が終始カクつく。
  // 各プレイヤーがビューポート外の間は内部rAFを止め(stopRendering=stopRequestAnimationFrame)、
  // 表示に戻ったら再開する。stopRendering後の再開はstopRequestAnimationFrame=false＋drawFrame()。
  // 二重にdrawFrame()を呼ぶとrAF鎖が二重化するのでstoppedフラグで単一化する。
  const gateByVisibility = (player, host) => {
    if (!('IntersectionObserver' in globalThis) || !host) return;
    let stopped = false;
    const io = new IntersectionObserver((ents) => {
      const vis = ents.some((e) => e.isIntersecting);
      if (!vis && !stopped) { stopped = true; if (player.stopRendering) player.stopRendering(); }
      else if (vis && stopped) { stopped = false; player.stopRequestAnimationFrame = false; if (player.drawFrame) player.drawFrame(); }
    }, { threshold: 0 });
    io.observe(host);
    const origDispose = player.dispose && player.dispose.bind(player);
    player.dispose = function () { try { io.disconnect(); } catch (e) {} if (origDispose) return origDispose(); };
  };

  // toBlobは非同期だが、URL.createObjectURL(canvas)は不可＝同期でPNG化するため一旦dataURL経由を避け、
  // ここではSpineが読めれば良いので同期にblob化できるconvertToBlob/ OffscreenCanvasも使えない同期文脈。
  // → cv.toDataURL(同期)をBlob化してobjectURLにする。
  function canvasToPngBlob(cv) {
    const dataUrl = cv.toDataURL('image/png');
    const comma = dataUrl.indexOf(',');
    const bin = atob(dataUrl.slice(comma + 1));
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: 'image/png' });
  }

  globalThis.TP_SPINE = { runtimeReady, buildPlayable, uploadRawTexturePixels, startDefaultIdle, scaleAtlasCoords, pageNamesOf, detectSkeletonIsJson };
})();
