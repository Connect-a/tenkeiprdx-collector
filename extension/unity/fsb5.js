const CODEC = {
  1: 'PCM8',
  2: 'PCM16',
  3: 'PCM24',
  4: 'PCM32',
  5: 'PCMFLOAT',
  6: 'GCADPCM',
  7: 'IMAADPCM',
  8: 'VAG',
  9: 'HEVAG',
  10: 'XMA',
  11: 'MPEG',
  12: 'CELT',
  13: 'AT9',
  14: 'XWMA',
  15: 'VORBIS',
  16: 'FADPCM',
};
const RATES = [4000, 8000, 11000, 11025, 16000, 22050, 24000, 32000, 44100, 48000, 96000];
const CHUNK = { 1: 'CHANNELS', 2: 'SAMPLERATE', 3: 'LOOP', 6: 'XMASEEK', 7: 'DSPCOEFF', 9: 'XWMADATA', 10: 'VORBISSEEK', 11: 'VORBISDATA' };

const magicAt = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

function readSampleHeader(dv, base, pos) {
  const v = dv.getBigUint64(pos, true);
  const s = {
    hasChunks: Number(v & 1n) === 1,
    rate: RATES[Number((v >> 1n) & 0xfn)] || 0,
    channels: Number((v >> 5n) & 0x1n) + 1,
    dataOffset: Number((v >> 6n) & 0xfffffffn) * 32,
    samples: Number((v >> 34n) & 0x3fffffffn),
    chunks: [],
  };
  let p = pos + 8;
  let more = s.hasChunks;
  while (more) {
    const c = dv.getUint32(p, true);
    more = (c & 1) === 1;
    const size = (c >> 1) & 0xffffff;
    const type = (c >> 25) & 0x7f;
    const at = p + 4;
    if (type === 1 && size >= 1) s.channels = dv.getUint8(at);
    if (type === 2 && size >= 4) s.rate = dv.getUint32(at, true);
    if (type === 11 && size >= 4) s.vorbisCrc32 = dv.getUint32(at, true) >>> 0;
    s.chunks.push({ type, name: CHUNK[type] || String(type), size, at: at - base });
    p = at + size;
  }
  return { sample: s, next: p };
}

function parseFsb5(bytes, offset = 0) {
  if (bytes.length - offset < 60 || magicAt(bytes, offset) !== 'FSB5') return { ok: false, reason: 'FSB5 ではありません' };
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (o) => dv.getUint32(offset + o, true);
  const head = {
    version: u32(4),
    numSamples: u32(8),
    sampleHeadersSize: u32(12),
    nameTableSize: u32(16),
    dataSize: u32(20),
    mode: u32(24),
  };
  const headerSize = head.version === 0 ? 64 : 60;
  const nameStart = offset + headerSize + head.sampleHeadersSize;
  const dataStart = nameStart + head.nameTableSize;
  const total = headerSize + head.sampleHeadersSize + head.nameTableSize + head.dataSize;
  if (dataStart + head.dataSize > bytes.length) return { ok: false, reason: 'サイズが合いません', head };

  const samples = [];
  let p = offset + headerSize;
  for (let i = 0; i < head.numSamples; i++) {
    const r = readSampleHeader(dv, offset, p);
    samples.push(r.sample);
    p = r.next;
  }

  const names = [];
  if (head.nameTableSize) {
    for (let i = 0; i < head.numSamples; i++) {
      const off = dv.getUint32(nameStart + i * 4, true);
      let q = nameStart + off;
      let s = '';
      while (q < bytes.length && bytes[q]) s += String.fromCharCode(bytes[q++]);
      names.push(s);
    }
  }

  const clips = samples.map((s, i) => {
    const start = dataStart + s.dataOffset;
    const end = i + 1 < samples.length ? dataStart + samples[i + 1].dataOffset : dataStart + head.dataSize;
    return {
      index: i,
      name: names[i] || '',
      rate: s.rate,
      channels: s.channels,
      samples: s.samples,
      seconds: s.rate ? s.samples / s.rate : 0,
      vorbisCrc32: s.vorbisCrc32,
      chunks: s.chunks,
      bytes: Math.max(0, end - start),
      data: bytes.subarray(start, Math.max(start, end)),
    };
  });

  return { ok: true, offset, totalBytes: total, version: head.version, mode: head.mode, codec: CODEC[head.mode] || 'mode' + head.mode, head, clips };
}

function parseFsb5Stream(bytes, max = 4096) {
  const out = [];
  let p = 0;
  while (p + 60 <= bytes.length && out.length < max) {
    if (magicAt(bytes, p) !== 'FSB5') {
      p += 4;
      continue;
    }
    const r = parseFsb5(bytes, p);
    if (!r.ok || !r.totalBytes) break;
    out.push(r);
    p += Math.ceil(r.totalBytes / 32) * 32;
  }
  return out;
}

function toWav(clip, codec) {
  const bits = { PCM8: 8, PCM16: 16, PCM24: 24, PCM32: 32 }[codec];
  if (!bits) return null;
  const d = clip.data;
  const blockAlign = (clip.channels * bits) >> 3;
  const buf = new Uint8Array(44 + d.length);
  const dv = new DataView(buf.buffer);
  const tag = (o, s) => {
    for (let i = 0; i < 4; i++) buf[o + i] = s.charCodeAt(i);
  };
  tag(0, 'RIFF');
  dv.setUint32(4, 36 + d.length, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, clip.channels, true);
  dv.setUint32(24, clip.rate, true);
  dv.setUint32(28, clip.rate * blockAlign, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, bits, true);
  tag(36, 'data');
  dv.setUint32(40, d.length, true);
  buf.set(d, 44);
  return buf;
}

export const fsb5 = { parseFsb5, parseFsb5Stream, toWav, CODEC };
