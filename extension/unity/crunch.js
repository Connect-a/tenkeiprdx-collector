import { texCodec } from './texcodec.js';
let unityModule = null;
let unityInitTried = false;

function initUnityModule() {
  if (unityInitTried) return;
  unityInitTried = true;
  try {
    const f = globalThis.UnityCRNModule;
    if (typeof f !== 'function') return;
    const opt = {
      locateFile: (path) => {
        try {
          if (globalThis.chrome && chrome.runtime && chrome.runtime.getURL) {
            return chrome.runtime.getURL('vendor/' + path);
          }
        } catch (e) {}
        return path;
      },
    };
    const p = f(opt);
    if (p && typeof p.then === 'function') {
      p.then((m) => {
        unityModule = m || null;
      }).catch((e) => console.warn('[tp] Crunchデコーダを初期化できませんでした', e));
    } else {
      unityModule = p || null;
    }
  } catch (e) {
    console.warn('[tp] Crunchデコーダを初期化できませんでした', e);
  }
}

initUnityModule();

function toRGBA(width, height, format, dxtBytes) {
  if (format === 0) return texCodec.decodeDXT1(dxtBytes, width, height);
  if (format === 2) return texCodec.decodeDxt5Rgba(dxtBytes, width, height);
  throw new Error('unsupported dxt format: ' + format);
}

function runtimeModule() {
  const m = globalThis.Module;
  if (!m || typeof m._malloc !== 'function') return null;
  return m;
}

function classicCrnModule() {
  const m = runtimeModule();
  if (!m || typeof m._crn_get_width !== 'function' || typeof m._crn_decompress !== 'function') return null;
  return m;
}

function capabilities() {
  const um = unityModule;
  const unityViaModule = !!(um && typeof um._tp_unity_get_info === 'function' && typeof um._tp_unity_unpack_level0 === 'function');
  return { classic: !!classicCrnModule(), unityCrunched: unityViaModule, unityRuntimeLoaded: unityViaModule };
}

function unityMod() {
  initUnityModule();
  return unityModule;
}

const readOut = (m, ptr, len) => {
  const b = new Uint8Array(len);
  b.set(m.HEAPU8.subarray(ptr, ptr + len));
  return b;
};
function withBuf(m, bytes, fn) {
  const src = m._malloc(bytes.length);
  m.HEAPU8.set(bytes, src);
  try {
    return fn(src, bytes.length);
  } finally {
    if (typeof m._free === 'function') m._free(src);
  }
}
function withDst(m, size, fn) {
  const dst = m._malloc(size);
  try {
    return fn(dst);
  } finally {
    if (typeof m._free === 'function') m._free(dst);
  }
}

function supportsUnityCrunched() {
  return capabilities().unityCrunched;
}

function decodeUnityLevel0(bytes) {
  const m = unityMod();
  if (!m || typeof m._malloc !== 'function' || typeof m._tp_unity_get_info !== 'function' || typeof m._tp_unity_unpack_level0 !== 'function') {
    throw new Error('unity unityCrunch runtime unavailable');
  }
  return withBuf(m, bytes, (src, srcSize) => {
    const out = m._malloc(24);
    try {
      const okInfo = m._tp_unity_get_info(src, srcSize, out, out + 4, out + 8, out + 12, out + 16);
      if (!okInfo) throw new Error('unity unityCrunch info failed');
      const width = m.HEAPU32[out >> 2] >>> 0;
      const height = m.HEAPU32[(out >> 2) + 1] >>> 0;
      const levels = m.HEAPU32[(out >> 2) + 2] >>> 0;
      const format = m.HEAPU32[(out >> 2) + 3] >>> 0;
      const faceSize = m.HEAPU32[(out >> 2) + 4] >>> 0;
      if (!width || !height || !faceSize) throw new Error('unity unityCrunch invalid info');
      return withDst(m, faceSize, (dst) => {
        const got = m._tp_unity_unpack_level0(src, srcSize, dst, faceSize) | 0;
        if (got <= 0) throw new Error('unity unityCrunch unpack failed');
        return { width, height, levels, format, dxtBytes: readOut(m, dst, got) };
      });
    } finally {
      if (typeof m._free === 'function') m._free(out);
    }
  });
}

function withSrc(bytes, fn) {
  const m = classicCrnModule();
  if (!m) throw new Error('unityCrunch runtime unavailable');
  return withBuf(m, bytes, (src, srcSize) => fn(m, src, srcSize));
}

function probe(bytes) {
  try {
    return withSrc(bytes, (m, src, srcSize) => {
      const width = m._crn_get_width(src, srcSize) | 0;
      const height = m._crn_get_height(src, srcSize) | 0;
      const levels = m._crn_get_levels(src, srcSize) | 0;
      const format = m._crn_get_dxt_format(src, srcSize) | 0;
      if (width <= 0 || height <= 0 || levels <= 0) return null;
      if (width > 8192 || height > 8192) return null;
      return { width, height, levels, format };
    });
  } catch (e) {
    return null;
  }
}

function decodeLevel0(bytes) {
  return withSrc(bytes, (m, src, srcSize) => {
    const width = m._crn_get_width(src, srcSize) | 0;
    const height = m._crn_get_height(src, srcSize) | 0;
    const levels = m._crn_get_levels(src, srcSize) | 0;
    const format = m._crn_get_dxt_format(src, srcSize) | 0;
    if (width <= 0 || height <= 0 || levels <= 0) throw new Error('invalid crn');
    const dstSize = m._crn_get_uncompressed_size(src, srcSize, 0) | 0;
    if (dstSize <= 0) throw new Error('invalid dst size');
    return withDst(m, dstSize, (dst) => {
      const ok = m._crn_decompress(src, srcSize, dst, dstSize, 0);
      if (!ok) throw new Error('crn_decompress failed');
      return { width, height, levels, format, dxtBytes: readOut(m, dst, dstSize) };
    });
  });
}

function decodeLevel0RGBA(bytes) {
  let d = null;
  if (supportsUnityCrunched()) {
    try {
      d = decodeUnityLevel0(bytes);
    } catch (e) {}
  }
  if (!d) d = decodeLevel0(bytes);
  const rgba = toRGBA(d.width, d.height, d.format, d.dxtBytes);
  return { width: d.width, height: d.height, levels: d.levels, format: d.format, rgbaBytes: rgba };
}

function findInBuffer(buf, maxCandidates) {
  const candidates = [];
  const lim = Math.max(1, maxCandidates || 32);
  for (let i = 0; i + 64 < buf.length; i++) {
    if (buf[i] !== 0x48 || buf[i + 1] !== 0x78) continue;
    const slice = buf.subarray(i);
    const info = probe(slice);
    if (!info) continue;
    candidates.push({ offset: i, info });
    if (candidates.length >= lim) break;
  }
  return candidates;
}

export const unityCrunch = {
  canDecodeCrunched: () => !!classicCrnModule() || supportsUnityCrunched(),
  supportsUnityCrunched,
  probe,
  decodeLevel0RGBA,
  findInBuffer,
};
