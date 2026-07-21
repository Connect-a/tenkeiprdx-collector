'use strict';
// Unity Texture2D / 埋め込み画像のフォーマットデコード層。
(function () {
  const flipEncodedImageBytesY = async (bytes, mime) => {
    try {
      const srcBlob = new Blob([bytes], { type: mime });
      const bmp = await createImageBitmap(srcBlob);
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext('2d');
      ctx.translate(0, c.height);
      ctx.scale(1, -1);
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      const outBlob = await new Promise((resolve) => c.toBlob(resolve, mime));
      if (!outBlob) return { bytes, width: bmp.width, height: bmp.height, flipped: false };
      const outBytes = new Uint8Array(await outBlob.arrayBuffer());
      return { bytes: outBytes, width: c.width, height: c.height, flipped: true };
    } catch (e) {
      return { bytes, width: null, height: null, flipped: false, error: e && e.message ? e.message : String(e) };
    }
  };

  const renderRgbaToCanvas = (width, height, rgba) => {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    const img = new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height);
    ctx.putImageData(img, 0, 0);
    return c;
  };

  const flipRgbaY = (rgba, width, height) => {
    const out = new Uint8Array(rgba.length);
    const stride = width * 4;
    for (let y = 0; y < height; y++) {
      const srcOff = y * stride;
      const dstOff = (height - 1 - y) * stride;
      out.set(rgba.subarray(srcOff, srcOff + stride), dstOff);
    }
    return out;
  };

  const sigEq = (buf, off, sig) => {
    if (off + sig.length > buf.length) return false;
    for (let i = 0; i < sig.length; i++) if (buf[off + i] !== sig[i]) return false;
    return true;
  };

  const be32 = (buf, off) => ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
  const le32 = (buf, off) => (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;

  const parsePngSize = (png) => {
    if (png.length < 24) return null;
    if (!sigEq(png, 0, [0x89, 0x50, 0x4e, 0x47])) return null;
    if (!(png[12] === 0x49 && png[13] === 0x48 && png[14] === 0x44 && png[15] === 0x52)) return null;
    return { width: be32(png, 16), height: be32(png, 20) };
  };

  const parseJpegSize = (jpg) => {
    if (jpg.length < 10 || jpg[0] !== 0xff || jpg[1] !== 0xd8) return null;
    let p = 2;
    while (p + 9 < jpg.length) {
      if (jpg[p] !== 0xff) {
        p += 1;
        continue;
      }
      const m = jpg[p + 1];
      if (m === 0xd9 || m === 0xda) break;
      if (p + 4 >= jpg.length) break;
      const len = ((jpg[p + 2] << 8) | jpg[p + 3]) >>> 0;
      if (len < 2 || p + 2 + len > jpg.length) break;
      if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
        if (p + 8 < jpg.length) {
          return { height: ((jpg[p + 5] << 8) | jpg[p + 6]) >>> 0, width: ((jpg[p + 7] << 8) | jpg[p + 8]) >>> 0 };
        }
        break;
      }
      p += 2 + len;
    }
    return null;
  };

  const parseWebpSize = (webp) => {
    if (webp.length < 30) return null;
    if (!(sigEq(webp, 0, [0x52, 0x49, 0x46, 0x46]) && sigEq(webp, 8, [0x57, 0x45, 0x42, 0x50]))) return null;
    const kind = String.fromCharCode(webp[12], webp[13], webp[14], webp[15]);
    if (kind === 'VP8X' && webp.length >= 30) {
      const w = 1 + (webp[24] | (webp[25] << 8) | (webp[26] << 16));
      const h = 1 + (webp[27] | (webp[28] << 8) | (webp[29] << 16));
      return { width: w, height: h };
    }
    if (kind === 'VP8 ' && webp.length >= 30) {
      const w = ((webp[26] | (webp[27] << 8)) & 0x3fff) >>> 0;
      const h = ((webp[28] | (webp[29] << 8)) & 0x3fff) >>> 0;
      return { width: w, height: h };
    }
    if (kind === 'VP8L' && webp.length >= 25) {
      const bits = le32(webp, 21);
      const w = (bits & 0x3fff) + 1;
      const h = ((bits >> 14) & 0x3fff) + 1;
      return { width: w, height: h };
    }
    return null;
  };

  const TEX_FMT = {
    2: 'ARGB4444',
    4: 'RGBA32',
    12: 'DXT5',
    13: 'RGBA4444',
    29: 'DXT5Crunched',
  };

  const rgb565 = (v) => {
    const r = ((v >> 11) & 0x1f) * 255 / 31;
    const g = ((v >> 5) & 0x3f) * 255 / 63;
    const b = (v & 0x1f) * 255 / 31;
    return [r | 0, g | 0, b | 0];
  };

  const decodeDxt5Rgba = (src, width, height) => {
    const bw = Math.ceil(width / 4);
    const bh = Math.ceil(height / 4);
    const need = bw * bh * 16;
    if (!src || src.length < need) throw new Error('dxt5-bytes-short');

    const out = new Uint8Array(width * height * 4);
    let o = 0;
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++, o += 16) {
        const a0 = src[o];
        const a1 = src[o + 1];
        // 48bitのalphaインデックスを24bit×2に分割(BigInt回避＝最内ループ高速化)。lo=pixel0-7 / hi=pixel8-15。
        const alphaLo = src[o + 2] | (src[o + 3] << 8) | (src[o + 4] << 16);
        const alphaHi = src[o + 5] | (src[o + 6] << 8) | (src[o + 7] << 16);

        const alpha = new Uint8Array(8);
        alpha[0] = a0;
        alpha[1] = a1;
        if (a0 > a1) {
          alpha[2] = ((6 * a0 + 1 * a1) / 7) | 0;
          alpha[3] = ((5 * a0 + 2 * a1) / 7) | 0;
          alpha[4] = ((4 * a0 + 3 * a1) / 7) | 0;
          alpha[5] = ((3 * a0 + 4 * a1) / 7) | 0;
          alpha[6] = ((2 * a0 + 5 * a1) / 7) | 0;
          alpha[7] = ((1 * a0 + 6 * a1) / 7) | 0;
        } else {
          alpha[2] = ((4 * a0 + 1 * a1) / 5) | 0;
          alpha[3] = ((3 * a0 + 2 * a1) / 5) | 0;
          alpha[4] = ((2 * a0 + 3 * a1) / 5) | 0;
          alpha[5] = ((1 * a0 + 4 * a1) / 5) | 0;
          alpha[6] = 0;
          alpha[7] = 255;
        }

        const c0 = src[o + 8] | (src[o + 9] << 8);
        const c1 = src[o + 10] | (src[o + 11] << 8);
        const c0rgb = rgb565(c0);
        const c1rgb = rgb565(c1);
        const code = (src[o + 12] | (src[o + 13] << 8) | (src[o + 14] << 16) | (src[o + 15] << 24)) >>> 0;

        for (let py = 0; py < 4; py++) {
          for (let px = 0; px < 4; px++) {
            const x = bx * 4 + px;
            const y = by * 4 + py;
            if (x >= width || y >= height) continue;

            const p = py * 4 + px;
            const ai = p < 8 ? ((alphaLo >> (p * 3)) & 7) : ((alphaHi >> ((p - 8) * 3)) & 7);
            const ci = (code >> (p * 2)) & 0x3;

            let r = 0, g = 0, b = 0;
            if (ci === 0) {
              r = c0rgb[0]; g = c0rgb[1]; b = c0rgb[2];
            } else if (ci === 1) {
              r = c1rgb[0]; g = c1rgb[1]; b = c1rgb[2];
            } else if (ci === 2) {
              r = ((2 * c0rgb[0] + c1rgb[0]) / 3) | 0;
              g = ((2 * c0rgb[1] + c1rgb[1]) / 3) | 0;
              b = ((2 * c0rgb[2] + c1rgb[2]) / 3) | 0;
            } else {
              r = ((c0rgb[0] + 2 * c1rgb[0]) / 3) | 0;
              g = ((c0rgb[1] + 2 * c1rgb[1]) / 3) | 0;
              b = ((c0rgb[2] + 2 * c1rgb[2]) / 3) | 0;
            }

            const di = (y * width + x) * 4;
            out[di] = r;
            out[di + 1] = g;
            out[di + 2] = b;
            out[di + 3] = alpha[ai];
          }
        }
      }
    }
    return out;
  };

  const decodeRgba4444 = (src, width, height) => {
    const need = width * height * 2;
    if (!src || src.length < need) throw new Error('rgba4444-bytes-short');
    const out = new Uint8Array(width * height * 4);
    for (let i = 0, p = 0; i < width * height; i++, p += 2) {
      const v = src[p] | (src[p + 1] << 8);
      const r4 = (v >> 12) & 0x0f;
      const g4 = (v >> 8) & 0x0f;
      const b4 = (v >> 4) & 0x0f;
      const a4 = v & 0x0f;
      const di = i * 4;
      out[di] = (r4 << 4) | r4;
      out[di + 1] = (g4 << 4) | g4;
      out[di + 2] = (b4 << 4) | b4;
      out[di + 3] = (a4 << 4) | a4;
    }
    return out;
  };

  const decodeArgb4444 = (src, width, height) => {
    const need = width * height * 2;
    if (!src || src.length < need) throw new Error('argb4444-bytes-short');
    const out = new Uint8Array(width * height * 4);
    for (let i = 0, p = 0; i < width * height; i++, p += 2) {
      const v = src[p] | (src[p + 1] << 8);
      const a4 = (v >> 12) & 0x0f;
      const r4 = (v >> 8) & 0x0f;
      const g4 = (v >> 4) & 0x0f;
      const b4 = v & 0x0f;
      const di = i * 4;
      out[di] = (r4 << 4) | r4;
      out[di + 1] = (g4 << 4) | g4;
      out[di + 2] = (b4 << 4) | b4;
      out[di + 3] = (a4 << 4) | a4;
    }
    return out;
  };

  const findTextureBlobStart = (buf, from, completeImageSize) => {
    const maxScan = Math.min(buf.length - 8, from + 512);
    for (let p = from; p <= maxScan; p += 4) {
      if (le32(buf, p) !== completeImageSize) continue;
      const start = p + 4;
      if (start + completeImageSize <= buf.length) return start;
    }
    return -1;
  };

  const extractTexture2DPreviews = (buf, cmod, limit, opt) => {
    const options = opt || {};
    const flipY = options.flipY !== false;
    const out = [];
    const stats = {
      headerCandidates: 0,
      blobResolved: 0,
      decoded: 0,
      crunchedSeen: 0,
      crunchedProbeFailed: 0,
      crunchedDecodeFailed: 0,
      unityCrunchedUnsupported: 0,
    };
    const max = Math.max(1, Math.min(16, Number(limit) || 2));
    const seen = new Set();

    for (let i = 0; i + 24 < buf.length && out.length < max; i += 4) {
      const w = le32(buf, i);
      const h = le32(buf, i + 4);
      const cis = le32(buf, i + 8);
      if (w < 16 || h < 16 || w > 4096 || h > 4096) continue;
      if (cis <= 0 || cis > buf.length) continue;

      for (const fmtOff of [12, 16]) {
        const fmt = le32(buf, i + fmtOff);
        if (!TEX_FMT[fmt]) continue;
        stats.headerCandidates += 1;
        if (fmt === 29) stats.crunchedSeen += 1;

        const key = `${i}:${fmtOff}:${w}:${h}:${cis}:${fmt}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const dataStart = findTextureBlobStart(buf, i + fmtOff + 8, cis);
        if (dataStart < 0) continue;
        stats.blobResolved += 1;

        try {
          let rgba = null;
          const texBytes = buf.subarray(dataStart, dataStart + cis);
          if (fmt === 29) {
            if (!cmod || !cmod.decodeLevel0RGBA) continue;
            if (!cmod.probe) continue;
            if (cmod.supportsUnityCrunched && !cmod.supportsUnityCrunched()) {
              stats.unityCrunchedUnsupported += 1;
              continue;
            }
            const info = cmod.probe(texBytes);
            if (!info) {
              stats.crunchedProbeFailed += 1;
              continue;
            }
            if (info.width !== w || info.height !== h) {
              stats.crunchedProbeFailed += 1;
              continue;
            }
            const dec = cmod.decodeLevel0RGBA(texBytes);
            rgba = flipY ? flipRgbaY(dec.rgbaBytes, dec.width, dec.height) : dec.rgbaBytes;
            out.push({ offset: dataStart, width: dec.width, height: dec.height, type: 'tex-DXT5Crunched', canvas: renderRgbaToCanvas(dec.width, dec.height, rgba) });
            stats.decoded += 1;
          } else if (fmt === 12) {
            rgba = decodeDxt5Rgba(texBytes, w, h);
            if (flipY) rgba = flipRgbaY(rgba, w, h);
            out.push({ offset: dataStart, width: w, height: h, type: 'tex-DXT5', canvas: renderRgbaToCanvas(w, h, rgba) });
            stats.decoded += 1;
          } else if (fmt === 4) {
            const need = w * h * 4;
            if (texBytes.length < need) continue;
            rgba = texBytes.subarray(0, need);
            if (flipY) rgba = flipRgbaY(rgba, w, h);
            out.push({ offset: dataStart, width: w, height: h, type: 'tex-RGBA32', canvas: renderRgbaToCanvas(w, h, rgba) });
            stats.decoded += 1;
          } else if (fmt === 13) {
            rgba = decodeRgba4444(texBytes, w, h);
            if (flipY) rgba = flipRgbaY(rgba, w, h);
            out.push({ offset: dataStart, width: w, height: h, type: 'tex-RGBA4444', canvas: renderRgbaToCanvas(w, h, rgba) });
            stats.decoded += 1;
          } else if (fmt === 2) {
            rgba = decodeArgb4444(texBytes, w, h);
            if (flipY) rgba = flipRgbaY(rgba, w, h);
            out.push({ offset: dataStart, width: w, height: h, type: 'tex-ARGB4444', canvas: renderRgbaToCanvas(w, h, rgba) });
            stats.decoded += 1;
          }
        } catch (e) {
          if (fmt === 29) stats.crunchedDecodeFailed += 1;
        }

        if (out.length >= max) break;
      }
    }

    return { previews: out, stats };
  };

  const extractEmbeddedImages = (buf, limit) => {
    const out = [];
    const max = Math.max(1, Math.min(10, Number(limit) || 4));
    for (let i = 0; i + 12 < buf.length && out.length < max; i++) {
      if (sigEq(buf, i, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
        let end = -1;
        for (let p = i + 8; p + 12 < buf.length; ) {
          const len = be32(buf, p);
          const typeOff = p + 4;
          const next = p + 12 + len;
          if (next > buf.length) break;
          if (buf[typeOff] === 0x49 && buf[typeOff + 1] === 0x45 && buf[typeOff + 2] === 0x4e && buf[typeOff + 3] === 0x44) {
            end = next;
            break;
          }
          p = next;
        }
        if (end > i) {
          const bytes = buf.subarray(i, end);
          const sz = parsePngSize(bytes) || {};
          out.push({ type: 'png', bytes, offset: i, width: sz.width || null, height: sz.height || null });
          i = end - 1;
          continue;
        }
      }
      if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) {
        let end = -1;
        for (let p = i + 2; p + 1 < buf.length; p++) {
          if (buf[p] === 0xff && buf[p + 1] === 0xd9) {
            end = p + 2;
            break;
          }
        }
        if (end > i) {
          const bytes = buf.subarray(i, end);
          const sz = parseJpegSize(bytes) || {};
          if (!(sz.width > 0 && sz.height > 0 && sz.width <= 8192 && sz.height <= 8192)) continue;
          out.push({ type: 'jpg', bytes, offset: i, width: sz.width, height: sz.height });
          i = end - 1;
          continue;
        }
      }
      if (sigEq(buf, i, [0x52, 0x49, 0x46, 0x46]) && sigEq(buf, i + 8, [0x57, 0x45, 0x42, 0x50])) {
        const size = le32(buf, i + 4);
        const end = i + 8 + size;
        if (end <= buf.length && size > 12) {
          const bytes = buf.subarray(i, end);
          const sz = parseWebpSize(bytes) || {};
          out.push({ type: 'webp', bytes, offset: i, width: sz.width || null, height: sz.height || null });
          i = end - 1;
        }
      }
    }
    return out;
  };

  function decodeDXT1(dxt, width, height) {
    const out = new Uint8Array(width * height * 4);
    let p = 0;
    const bw = Math.ceil(width / 4);
    const bh = Math.ceil(height / 4);
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        const c0 = dxt[p] | (dxt[p + 1] << 8);
        const c1 = dxt[p + 2] | (dxt[p + 3] << 8);
        const bits = dxt[p + 4] | (dxt[p + 5] << 8) | (dxt[p + 6] << 16) | (dxt[p + 7] << 24);
        p += 8;

        const c = [rgb565(c0), rgb565(c1), [0, 0, 0], [0, 0, 0]];
        if (c0 > c1) {
          c[2] = [((2 * c[0][0] + c[1][0]) / 3) | 0, ((2 * c[0][1] + c[1][1]) / 3) | 0, ((2 * c[0][2] + c[1][2]) / 3) | 0];
          c[3] = [((c[0][0] + 2 * c[1][0]) / 3) | 0, ((c[0][1] + 2 * c[1][1]) / 3) | 0, ((c[0][2] + 2 * c[1][2]) / 3) | 0];
        } else {
          c[2] = [((c[0][0] + c[1][0]) / 2) | 0, ((c[0][1] + c[1][1]) / 2) | 0, ((c[0][2] + c[1][2]) / 2) | 0];
          c[3] = [0, 0, 0];
        }

        for (let py = 0; py < 4; py++) {
          for (let px = 0; px < 4; px++) {
            const x = bx * 4 + px;
            const y = by * 4 + py;
            if (x >= width || y >= height) continue;
            const ci = (bits >> (2 * (py * 4 + px))) & 3;
            const o = (y * width + x) * 4;
            out[o] = c[ci][0];
            out[o + 1] = c[ci][1];
            out[o + 2] = c[ci][2];
            out[o + 3] = (c0 <= c1 && ci === 3) ? 0 : 255;
          }
        }
      }
    }
    return out;
  }

  globalThis.TP_TEXCODEC = {
    TEX_FMT, rgb565, be32, le32, sigEq, decodeDXT1, decodeDxt5Rgba, decodeRgba4444, decodeArgb4444, parsePngSize, parseJpegSize, parseWebpSize, findTextureBlobStart, extractTexture2DPreviews, extractEmbeddedImages, flipEncodedImageBytesY, flipRgbaY, renderRgbaToCanvas,
  };
})();
