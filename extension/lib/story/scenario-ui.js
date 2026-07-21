'use strict';
// TP_SCENARIO_UI — シナリオUIアトラスを復号し、テキストボックス背景/名前枠/次へ矢印/ボタンを名前付きスプライトで供給する。
(function () {
  const cacheByUrl = new Map();

  function decodeAtlas(parsed, bytes) {
    const SF = globalThis.TP_UNITYSF, TEX = globalThis.TP_TEXCODEC, MESH = globalThis.TP_MESH;
    const meta = SF.parseSerializedFile(parsed.data);
    let tex = null;
    for (const o of meta.objects) { if (o.classID === 28) { tex = SF.readObject(parsed.data, meta.LE, o); break; } }
    if (tex) {
      const raw = tex['image data'] && tex['image data'].__bytes;
      const W = tex.m_Width, H = tex.m_Height, fmt = tex.m_TextureFormat;
      if (raw && raw.length) {
        try {
          let rgba = null;
          if (fmt === 12) rgba = TEX.decodeDxt5Rgba(raw, W, H);
          else if (fmt === 4) rgba = raw.subarray(0, W * H * 4);
          else if (fmt === 13) rgba = TEX.decodeRgba4444(raw, W, H);
          else if (fmt === 2) rgba = TEX.decodeArgb4444(raw, W, H);
          if (rgba) return { meta: meta, rgba: rgba, TW: W, TH: H };
        } catch (e) {}
      }
    }
    const t = MESH && MESH.decodeTextureRgba(bytes, parsed);
    return t && t.rgba ? { meta: meta, rgba: t.rgba, TW: t.width, TH: t.height } : null;
  }

  async function load(url) {
    if (cacheByUrl.has(url)) return cacheByUrl.get(url);
    const D = globalThis.TP_DECODE, SF = globalThis.TP_UNITYSF;
    if (!D || !SF) return null;
    let bytes; try { const res = await fetch(url); bytes = new Uint8Array(await res.arrayBuffer()); } catch (e) { return null; }
    const parsed = D.parseUnityFS(bytes);
    const dec = decodeAtlas(parsed, bytes);
    if (!dec) return null;
    const meta = dec.meta, rgba = dec.rgba, TW = dec.TW, TH = dec.TH;
    // SpriteAtlasのm_RenderDataMap(GUID→パック後の実rect)。個々のSprite.m_RDは元rect(0,0)なので使えない。
    const keyStr = (k) => { const f = (k && k.first) || {}; return [f['data[0]'], f['data[1]'], f['data[2]'], f['data[3]']].join('_'); };
    const rdm = {};
    for (const o of meta.objects) {
      if (o.classID !== 687078895) continue; // SpriteAtlas
      const av = SF.readObject(parsed.data, meta.LE, o); if (!av || !av.m_RenderDataMap) continue;
      for (const pair of av.m_RenderDataMap) { if (Array.isArray(pair) && pair[1]) rdm[keyStr(pair[0])] = pair[1]; }
    }
    const sprites = {};
    for (const o of meta.objects) {
      if (o.classID !== 213) continue; // Sprite
      const v = SF.readObject(parsed.data, meta.LE, o); if (!v) continue;
      const rd = v.m_RD || {}, rect = v.m_Rect || {}, bd = v.m_Border || { x: 0, y: 0, z: 0, w: 0 };
      const ad = rdm[keyStr(v.m_RenderDataKey)] || rd;
      const tr = ad.textureRect || rd.textureRect || {};
      const off = ad.textureRectOffset || rd.textureRectOffset || { x: 0, y: 0 };
      const rw = Math.max(1, Math.round(rect.width)), rh = Math.max(1, Math.round(rect.height));
      const tx = Math.round(tr.x), ty = Math.round(tr.y), tw = Math.round(tr.width), th = Math.round(tr.height);
      const ox = Math.round(off.x), oy = Math.round(off.y);
      const cv = document.createElement('canvas'); cv.width = rw; cv.height = rh;
      const ctx = cv.getContext('2d'); const img = ctx.createImageData(rw, rh);
      for (let r = 0; r < th; r++) {
        const srcBU = ty + r; if (srcBU < 0 || srcBU >= TH) continue;
        const dBU = oy + r; if (dBU < 0 || dBU >= rh) continue;
        const dTop = rh - 1 - dBU; // canvasは top-down
        for (let c = 0; c < tw; c++) {
          const sx = tx + c; if (sx < 0 || sx >= TW) continue;
          const dx = ox + c; if (dx < 0 || dx >= rw) continue;
          const si = (srcBU * TW + sx) * 4, di = (dTop * rw + dx) * 4;
          img.data[di] = rgba[si]; img.data[di + 1] = rgba[si + 1]; img.data[di + 2] = rgba[si + 2]; img.data[di + 3] = rgba[si + 3];
        }
      }
      ctx.putImageData(img, 0, 0);
      // Unity m_Border=(left=x, bottom=y, right=z, top=w)
      sprites[v.m_Name] = { canvas: cv, dataUrl: cv.toDataURL('image/png'), w: rw, h: rh, border: { l: bd.x, b: bd.y, r: bd.z, t: bd.w } };
    }
    const result = { sprites: sprites, get: (n) => sprites[n] || null };
    cacheByUrl.set(url, result);
    return result;
  }

  function apply9Slice(el, sp, opt) {
    if (!el || !sp) return;
    const o = opt || {}, b = sp.border, k = o.scale || 1;
    const s = o.slice || {};
    const sliceTop = s.t != null ? s.t : b.t, sliceRight = s.r != null ? s.r : b.r, sliceBottom = s.b != null ? s.b : b.b, sliceLeft = s.l != null ? s.l : b.l;
    el.style.background = 'none';
    el.style.borderStyle = 'solid';
    el.style.borderImageSource = 'url(' + sp.dataUrl + ')';
    el.style.borderImageSlice = sliceTop + ' ' + sliceRight + ' ' + sliceBottom + ' ' + sliceLeft + ' fill';
    el.style.borderImageRepeat = o.repeat || 'stretch';
    el.style.borderWidth = (sliceTop * k) + 'px ' + (sliceRight * k) + 'px ' + (sliceBottom * k) + 'px ' + (sliceLeft * k) + 'px';
  }
  function applyStretch(el, sp) {
    if (!el || !sp) return;
    // スプライト(半透明グラデ)の背後に暗いグラデ下地を敷き、パネルを"詰まって"見せる(上が透けて名前枠が浮くのを防ぐ)。
    el.style.background = 'url(' + sp.dataUrl + ') 0 0 / 100% 100% no-repeat, linear-gradient(to top, rgba(8,10,16,.8) 0%, rgba(8,10,16,.4) 42%, rgba(8,10,16,0) 68%)';
    el.style.border = 'none';
  }

  globalThis.TP_SCENARIO_UI = { load: load, apply9Slice: apply9Slice, applyStretch: applyStretch };
})();
