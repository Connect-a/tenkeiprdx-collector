import { unityDecode } from './decode.js';
import { unityCrunch as CRUNCH_MOD } from './crunch.js';
import { texCodec } from './texcodec.js';
import { openCab, attempt, readOne } from './bundle-cab.js';
import { fileNameOf } from '../core/assetpath/paths.js';
import { noteFailure } from '../core/failures.js';
function textureBytes(tex, parsed) {
  let bytes = tex['image data'] && tex['image data'].__bytes;
  if ((!bytes || bytes.length === 0) && tex.m_StreamData && tex.m_StreamData.path) {
    const sd = tex.m_StreamData;
    const off = Number(sd.offset),
      size = Number(sd.size);
    const base = fileNameOf(sd.path);
    const node = parsed.nodes.find((n) => n.path === sd.path || n.path.endsWith(base));
    if (node) bytes = parsed.data.subarray(node.off + off, node.off + off + size);
  }
  return bytes && bytes.length ? bytes : null;
}

export function decodeTexture(tex, parsed, keep) {
  const fmt = Number(tex.m_TextureFormat);
  const w = Number(tex.m_Width),
    h = Number(tex.m_Height);
  if (!w || !h) return { width: 0, height: 0, format: fmt, empty: true };
  const bytes = textureBytes(tex, parsed);
  if (!bytes) return { width: w, height: h, format: fmt, error: 'no-image-bytes' };
  if (keep && keep[fmt]) {
    const st = textureSettings(tex);
    const blocks = mipBlocks(bytes, fmt, w, h, st.mipCount);
    if (blocks) return { width: w, height: h, format: fmt, blocks, decode: () => texCodec.decodeByFormat(fmt, bytes, w, h), ...st };
  }
  let rgba = null;
  try {
    if (fmt === 29) {
      if (CRUNCH_MOD && CRUNCH_MOD.canDecodeCrunched && CRUNCH_MOD.canDecodeCrunched() && CRUNCH_MOD.decodeLevel0RGBA) {
        const d = CRUNCH_MOD.decodeLevel0RGBA(bytes);
        return { width: d.width, height: d.height, format: fmt, rgba: d.rgbaBytes };
      }
      return { width: w, height: h, format: fmt, error: 'unityCrunch-unavailable' };
    } else if (texCodec.canDecodeFormat(fmt)) rgba = texCodec.decodeByFormat(fmt, bytes, w, h);
    else if (fmt === 17 || fmt === 24 || fmt === 25)
      return { width: w, height: h, format: fmt, raw: bytes.subarray(0, fmt === 17 ? w * h * 8 : Math.ceil(w / 4) * Math.ceil(h / 4) * 16), ...textureSettings(tex) };
    else return { width: w, height: h, format: fmt, error: 'unsupported-format-' + fmt };
  } catch (e) {
    noteFailure('テクスチャ復号', 'Texture2D', e);
    return { width: w, height: h, format: fmt, error: e && e.message ? e.message : String(e) };
  }
  if (!rgba) return { width: w, height: h, format: fmt, error: 'unityDecode-failed' };
  return { width: w, height: h, format: fmt, rgba, ...textureSettings(tex) };
}

function textureSettings(tex) {
  const ts = tex.m_TextureSettings || {};
  return {
    wrapU: Number(ts.m_WrapU) || 0,
    wrapV: Number(ts.m_WrapV) || 0,
    filter: Number(ts.m_FilterMode),
    aniso: Number(ts.m_Aniso) || 1,
    mipCount: Number(tex.m_MipCount) || 1,
    srgb: Number(tex.m_ColorSpace) !== 0,
  };
}

const blockBytes = (fmt) => (fmt === 12 || fmt === 13 ? 16 : 8);
const levelBytes = (fmt, w, h) => Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * blockBytes(fmt);

function mipBlocks(bytes, fmt, w, h, mipCount) {
  const out = [];
  let off = 0;
  for (let i = 0; i < Math.max(1, Number(mipCount) || 1); i++) {
    const lw = Math.max(1, w >> i),
      lh = Math.max(1, h >> i);
    const n = levelBytes(fmt, lw, lh);
    if (off + n > bytes.length) break;
    out.push({ data: bytes.subarray(off, off + n), width: lw, height: lh });
    off += n;
  }
  return out.length ? out : null;
}

export function decodeCubemap(tex, parsed) {
  const fmt = Number(tex.m_TextureFormat);
  const w = Number(tex.m_Width);
  const h = Number(tex.m_Height);
  const faces = Number(tex.m_ImageCount) || 6;
  const bytes = textureBytes(tex, parsed);
  if (fmt !== 12 || !bytes || faces !== 6) return { width: w, height: h, format: fmt, error: 'unsupported-cubemap-' + fmt };
  const mips = Number(tex.m_MipCount) || 1;
  let stride = 0;
  for (let i = 0; i < mips; i++) stride += levelBytes(fmt, Math.max(1, w >> i), Math.max(1, h >> i));
  const out = [];
  const levels = [];
  for (let f = 0; f < 6; f++) {
    let off = f * stride;
    const chain = [];
    for (let i = 0; i < mips; i++) {
      const lw = Math.max(1, w >> i);
      const lh = Math.max(1, h >> i);
      const size = levelBytes(fmt, lw, lh);
      if (off + size > bytes.length) {
        if (i === 0) return { width: w, height: h, format: fmt, error: 'cubemap-short' };
        break;
      }
      chain.push({ width: lw, height: lh, rgba: texCodec.decodeByFormat(fmt, bytes.subarray(off, off + size), lw, lh) });
      off += size;
    }
    out.push(chain[0].rgba);
    levels.push(chain);
  }
  return { width: w, height: h, format: fmt, faces: out, levels, mipCount: Math.min(...levels.map((c) => c.length)) };
}

export const KEEP_DXT = { 10: true, 12: true };

function decodeLargestTexture(bytes, parsed) {
  const co = openCab(bytes, parsed);
  if (!co) return null;
  const { sf, sfp } = co;
  parsed = co.parsed;
  let best = null,
    bestArea = -1;
  for (const o of sfp.objects) {
    if (o.classID !== 28) continue;
    const tx = readOne(sf, sfp.LE, o);
    if (!tx) continue;
    const area = Number(tx.m_Width) * Number(tx.m_Height);
    if (area > bestArea) {
      bestArea = area;
      best = tx;
    }
  }
  if (!best) return null;
  const dec = decodeTexture(best, parsed);
  return { name: best.m_Name, width: dec.width, height: dec.height, format: dec.format, rgba: dec.rgba || null, error: dec.error || null };
}

export function newDecodeStats() {
  return { failed: 0, reasons: {} };
}
const noteDecodeFail = (stats, dec) => {
  if (!stats || !dec || dec.empty || !dec.error) return;
  stats.failed++;
  const k = 'fmt' + dec.format + ' ' + dec.error;
  stats.reasons[k] = (stats.reasons[k] || 0) + 1;
};

export function decodeLargestTextureRgba(bytes, parsed, stats) {
  parsed = parsed || unityDecode.parseUnityFS(bytes);
  try {
    const t = decodeLargestTexture(bytes, parsed);
    if (t && t.rgba) return { rgba: t.rgba, width: t.width, height: t.height };
    noteDecodeFail(stats, t);
  } catch (e) {
    noteFailure('テクスチャ復号', '最大テクスチャ主経路', e);
  }
  if (CRUNCH_MOD && CRUNCH_MOD.findInBuffer && CRUNCH_MOD.decodeLevel0RGBA) {
    const cands = CRUNCH_MOD.findInBuffer(parsed.data, 2);
    if (cands && cands.length) {
      try {
        const dec = CRUNCH_MOD.decodeLevel0RGBA(parsed.data.subarray(cands[0].offset));
        return { rgba: dec.rgbaBytes, width: dec.width, height: dec.height };
      } catch (e) {
        noteFailure('テクスチャ復号', 'CRN候補', e);
      }
    }
  }
  const canDecode = !!(CRUNCH_MOD && CRUNCH_MOD.canDecodeCrunched && CRUNCH_MOD.canDecodeCrunched());
  const tr = texCodec.extractTexture2DPreviews(parsed.data, canDecode ? CRUNCH_MOD : null, 1, { flipY: false });
  if (tr.previews.length) {
    const c = tr.previews[0].canvas;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    return { rgba: new Uint8Array(d.data.buffer.slice(0)), width: c.width, height: c.height };
  }
  return null;
}

export function decodeLargestTextureCanvas(bytes, parsed, stats) {
  const dec = decodeLargestTextureRgba(bytes, parsed, stats);
  if (!dec || !dec.rgba || !dec.width || !dec.height) return null;
  const rgba = texCodec && texCodec.flipRgbaY ? texCodec.flipRgbaY(dec.rgba, dec.width, dec.height) : dec.rgba;
  return texCodec && texCodec.renderRgbaToCanvas ? texCodec.renderRgbaToCanvas(rgba, dec.width, dec.height) : null;
}

function eachTexture(bytes, parsed, stats, fn) {
  const co = openCab(bytes, parsed);
  if (!co) return;
  const { sf, sfp } = co;
  for (const o of sfp.objects) {
    if (o.classID !== 28) continue;
    const tx = readOne(sf, sfp.LE, o);
    const dec = tx ? attempt(() => decodeTexture(tx, co.parsed)) : null;
    if (!dec || !dec.rgba || !dec.width || !dec.height) {
      noteDecodeFail(stats, dec);
      continue;
    }
    fn(tx, dec);
  }
}

const toCanvas = (dec) => {
  const rgba = texCodec && texCodec.flipRgbaY ? texCodec.flipRgbaY(dec.rgba, dec.width, dec.height) : dec.rgba;
  return texCodec && texCodec.renderRgbaToCanvas ? texCodec.renderRgbaToCanvas(rgba, dec.width, dec.height) : null;
};

export function decodeAllTextureCanvases(bytes, parsed, stats) {
  const out = [];
  eachTexture(bytes, parsed, stats, (tx, dec) => {
    const cv = toCanvas(dec);
    if (cv) out.push(cv);
  });
  if (out.length) return out;
  const single = decodeLargestTextureCanvas(bytes, parsed);
  return single ? [single] : [];
}

export function decodeNamedTextureCanvases(bytes, parsed, stats) {
  const out = [];
  eachTexture(bytes, parsed, stats, (tx, dec) => {
    const cv = toCanvas(dec);
    if (cv) out.push({ name: tx.m_Name || '', canvas: cv, width: dec.width, height: dec.height });
  });
  if (out.length) return out;
  return decodeAllTextureCanvases(bytes, parsed, stats).map((canvas) => ({ name: '', canvas, width: canvas.width, height: canvas.height }));
}

export function decodeAtlasSprite(bytes, spriteName, parsed) {
  const co = openCab(bytes, parsed);
  if (!co) return null;
  const { sf, sfp } = co;
  const p = co.parsed;
  let sprite = null;
  for (const o of sfp.objects) {
    if (o.classID !== 213) continue;
    const s = readOne(sf, sfp.LE, o);
    if (s && s.m_Name === spriteName) {
      sprite = s;
      break;
    }
  }
  if (!sprite) return null;
  let rect = sprite.m_RD && sprite.m_RD.textureRect;
  let texPathID = sprite.m_RD && sprite.m_RD.texture ? String(sprite.m_RD.texture.m_PathID || '0') : '0';
  if (sprite.m_RenderDataKey) {
    const sa = sfp.objects.find((o) => o.classID === 687078895);
    if (sa) {
      const atlas = readOne(sf, sfp.LE, sa);
      const rdm = atlas && atlas.m_RenderDataMap;
      const kk = sprite.m_RenderDataKey;
      const keyEq = (a) => a && a.first && kk.first && ['data[0]', 'data[1]', 'data[2]', 'data[3]'].every((d) => String(a.first[d]) === String(kk.first[d])) && String(a.second) === String(kk.second);
      if (Array.isArray(rdm)) {
        for (const entry of rdm) {
          const k = entry && entry[0];
          const v = entry && entry[1];
          if (v && keyEq(k)) {
            if (v.textureRect) rect = v.textureRect;
            if (v.texture) texPathID = String(v.texture.m_PathID || '0');
            break;
          }
        }
      }
    }
  }
  if (!rect) return null;
  let dec = null;
  const texObjs = sfp.objects.filter((o) => o.classID === 28);
  const targetTex = texPathID !== '0' ? texObjs.find((o) => String(o.pathID) === texPathID) : null;
  for (const o of targetTex ? [targetTex] : texObjs) {
    const tx = readOne(sf, sfp.LE, o);
    const d = tx ? attempt(() => decodeTexture(tx, p)) : null;
    if (d && d.rgba && d.width && d.height) {
      dec = d;
      break;
    }
  }
  if (!dec) return null;
  const top = texCodec && texCodec.flipRgbaY ? texCodec.flipRgbaY(dec.rgba, dec.width, dec.height) : dec.rgba;
  const rw = Math.max(1, Math.round(rect.width));
  const rh = Math.max(1, Math.round(rect.height));
  const rx = Math.min(Math.max(0, Math.round(rect.x)), dec.width - rw);
  const ry = Math.min(Math.max(0, Math.round(dec.height - rect.y - rect.height)), dec.height - rh);
  const sub = new Uint8ClampedArray(rw * rh * 4);
  for (let row = 0; row < rh; row++) {
    const srcOff = ((ry + row) * dec.width + rx) * 4;
    sub.set(top.subarray(srcOff, srcOff + rw * 4), row * rw * 4);
  }
  return texCodec && texCodec.renderRgbaToCanvas ? texCodec.renderRgbaToCanvas(sub, rw, rh) : null;
}

export function decodeNamedTextureRgba(bytes, parsed) {
  const out = [];
  eachTexture(bytes, parsed, null, (tx, dec) => {
    out.push({ name: tx.m_Name || '', rgba: dec.rgba, width: dec.width, height: dec.height });
  });
  return out;
}
