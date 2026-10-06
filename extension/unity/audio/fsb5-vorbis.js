const OGG_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let k = 0; k < 8; k++) r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0;
    t[i] = r >>> 0;
  }
  return t;
})();

function oggCrc(buf) {
  let c = 0;
  for (let i = 0; i < buf.length; i++) c = ((c << 8) ^ OGG_CRC[((c >>> 24) & 0xff) ^ buf[i]]) >>> 0;
  return c >>> 0;
}

function oggPage(packets, { serial, seq, granule, bos, eos }) {
  const segs = [];
  for (const p of packets) {
    let left = p.length;
    while (left >= 255) {
      segs.push(255);
      left -= 255;
    }
    segs.push(left);
  }
  const body = packets.reduce((n, p) => n + p.length, 0);
  const page = new Uint8Array(27 + segs.length + body);
  const dv = new DataView(page.buffer);
  page.set([0x4f, 0x67, 0x67, 0x53], 0);
  page[4] = 0;
  page[5] = (bos ? 2 : 0) | (eos ? 4 : 0);
  dv.setBigUint64(6, BigInt(granule), true);
  dv.setUint32(14, serial >>> 0, true);
  dv.setUint32(18, seq >>> 0, true);
  dv.setUint32(22, 0, true);
  page[26] = segs.length;
  page.set(segs, 27);
  let o = 27 + segs.length;
  for (const p of packets) {
    page.set(p, o);
    o += p.length;
  }
  dv.setUint32(22, oggCrc(page), true);
  return page;
}

function identificationHeader(channels, rate, blockBits) {
  const b = new Uint8Array(30);
  const dv = new DataView(b.buffer);
  b.set([0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73], 0);
  dv.setUint32(7, 0, true);
  b[11] = channels;
  dv.setUint32(12, rate, true);
  dv.setInt32(16, 0, true);
  dv.setInt32(20, 0, true);
  dv.setInt32(24, 0, true);
  b[28] = blockBits;
  b[29] = 1;
  return b;
}

function commentHeader(vendor = 'fsb5') {
  const v = new TextEncoder().encode(vendor);
  const b = new Uint8Array(7 + 4 + v.length + 4 + 1);
  const dv = new DataView(b.buffer);
  b.set([0x03, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73], 0);
  dv.setUint32(7, v.length, true);
  b.set(v, 11);
  dv.setUint32(11 + v.length, 0, true);
  b[15 + v.length] = 1;
  return b;
}

function splitPackets(data) {
  const out = [];
  let p = 0;
  while (p + 2 <= data.length) {
    const n = data[p] | (data[p + 1] << 8);
    p += 2;
    if (!n || p + n > data.length) break;
    out.push(data.subarray(p, p + n));
    p += n;
  }
  return out;
}

function toOgg(clip, setup, opts = {}) {
  if (!setup || !setup.length) return { ok: false, reason: 'setup ヘッダがありません' };
  const packets = splitPackets(clip.data);
  if (!packets.length) return { ok: false, reason: '音声パケットを切り出せません' };
  const blockBits = opts.blockBits != null ? opts.blockBits : 0xb8;
  const serial = opts.serial != null ? opts.serial : 0x0f5b0001;
  const pages = [];
  let seq = 0;
  pages.push(oggPage([identificationHeader(clip.channels, clip.rate, blockBits)], { serial, seq: seq++, granule: 0, bos: true }));
  pages.push(oggPage([commentHeader(), setup], { serial, seq: seq++, granule: 0 }));

  const total = clip.samples || 0;
  let i = 0;
  while (i < packets.length) {
    const group = [];
    let segs = 0;
    while (i < packets.length) {
      const need = Math.floor(packets[i].length / 255) + 1;
      if (segs + need > 255) break;
      segs += need;
      group.push(packets[i++]);
    }
    const last = i >= packets.length;
    const granule = total ? Math.round((total * i) / packets.length) : 0;
    pages.push(oggPage(group, { serial, seq: seq++, granule, eos: last }));
  }
  const size = pages.reduce((n, p) => n + p.length, 0);
  const ogg = new Uint8Array(size);
  let o = 0;
  for (const p of pages) {
    ogg.set(p, o);
    o += p.length;
  }
  return { ok: true, bytes: ogg, packets: packets.length, pages: pages.length };
}

export const fsb5Vorbis = { toOgg };
