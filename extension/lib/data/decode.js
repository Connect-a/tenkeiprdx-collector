'use strict';
(function () {
  const MP = globalThis.MessagePack;
  const latin1 = globalThis.TP_UTIL.latin1;

  function lz4DecodeBlock(src, destLen) {
    const dst = new Uint8Array(destLen);
    let s = 0, d = 0;
    while (s < src.length) {
      const token = src[s++];
      let litLen = token >> 4;
      if (litLen === 15) { let b; do { b = src[s++]; litLen += b; } while (b === 255); }
      if (s + litLen > src.length) litLen = Math.max(0, src.length - s);
      if (d + litLen > destLen) litLen = Math.max(0, destLen - d);
      if (litLen > 0) {
        dst.set(src.subarray(s, s + litLen), d);
        s += litLen;
        d += litLen;
      }
      if (s >= src.length || d >= destLen) break;
      if (s + 1 >= src.length) break;
      const offset = src[s] | (src[s + 1] << 8); s += 2;
      if (!offset || offset > d) break;
      let matchLen = (token & 0x0f) + 4;
      if ((token & 0x0f) === 15) { let b; do { b = src[s++]; matchLen += b; } while (b === 255); }
      let m = d - offset;
      const maxMatch = Math.min(matchLen, destLen - d);
      for (let k = 0; k < maxMatch; k++) dst[d++] = dst[m++];
    }
    return dst.subarray(0, d);
  }

  function readCStr(buf, pos) { let e = pos; while (e < buf.length && buf[e] !== 0) e++; return { str: latin1.decode(buf.subarray(pos, e)), next: e + 1 }; }
  function parseUnityFS(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let p = 0;
    p = readCStr(buf, p).next; const version = dv.getUint32(p); p += 4;
    p = readCStr(buf, p).next; p = readCStr(buf, p).next;
    p += 8; const cInfo = dv.getUint32(p); p += 4; const uInfo = dv.getUint32(p); p += 4;
    const flags = dv.getUint32(p); p += 4;
    let headerEnd = p; if (version >= 7) headerEnd = (headerEnd + 15) & ~15;
    const infoAtEnd = (flags & 0x80) !== 0;
    const blockInfoNeedPaddingAtStart = (flags & 0x200) !== 0;
    const infoOff = infoAtEnd ? (buf.length - cInfo) : headerEnd;
    let blocksStart = infoAtEnd ? headerEnd : (infoOff + cInfo);
    if (blockInfoNeedPaddingAtStart) blocksStart = (blocksStart + 15) & ~15;
    let info = buf.subarray(infoOff, infoOff + cInfo);
    const infoComp = flags & 0x3f; if (infoComp === 2 || infoComp === 3) info = lz4DecodeBlock(info, uInfo);
    const idv = new DataView(info.buffer, info.byteOffset, info.byteLength);
    let ip = 16; const blockCount = idv.getInt32(ip); ip += 4; const blks = [];
    for (let i = 0; i < blockCount; i++) { const us = idv.getUint32(ip); ip += 4; const cs = idv.getUint32(ip); ip += 4; const bf = idv.getUint16(ip); ip += 2; blks.push({ us, cs, bf }); }
    const nodeCount = idv.getInt32(ip); ip += 4; const nodes = [];
    for (let i = 0; i < nodeCount; i++) { const off = Number(idv.getBigInt64(ip)); ip += 8; const sz = Number(idv.getBigInt64(ip)); ip += 8; const nf = idv.getUint32(ip); ip += 4; const ns = readCStr(info, ip); ip = ns.next; nodes.push({ off, sz, nf, path: ns.str }); }
    let bp = blocksStart; const parts = []; let total = 0;
    for (const b of blks) { const comp = b.bf & 0x3f; const chunk = buf.subarray(bp, bp + b.cs); bp += b.cs; const part = (comp === 2 || comp === 3) ? lz4DecodeBlock(chunk, b.us) : chunk; parts.push(part); total += part.length; }
    const data = new Uint8Array(total); let o = 0; for (const part of parts) { data.set(part, o); o += part.length; }
    return { data, nodes };
  }

  function parseSerializedTextAssets(sf) {
    const dv = new DataView(sf.buffer, sf.byteOffset, sf.byteLength);
    let p = 0;
    const beU32 = () => { const v = dv.getUint32(p, false); p += 4; return v; };
    beU32(); beU32(); const version = beU32(); let dataOffset = beU32();
    let endianess = 0;
    if (version >= 9) { endianess = dv.getUint8(p); p += 1; p += 3; }
    if (version >= 22) { beU32(); dv.getBigInt64(p, false); p += 8; dataOffset = Number(dv.getBigInt64(p, false)); p += 8; p += 8; }
    const LE = endianess === 0;
    const rU32 = () => { const v = dv.getUint32(p, LE); p += 4; return v; };
    const rI32 = () => { const v = dv.getInt32(p, LE); p += 4; return v; };
    const rI16 = () => { const v = dv.getInt16(p, LE); p += 2; return v; };
    const rI64 = () => { const v = dv.getBigInt64(p, LE); p += 8; return v; };
    const rU8 = () => { const v = dv.getUint8(p); p += 1; return v; };
    const rStrNull = () => { while (true) { const c = dv.getUint8(p); p += 1; if (!c) break; } };
    const align4 = () => { p = (p + 3) & ~3; };
    rStrNull();
    rI32();
    const enableTypeTree = version >= 13 ? rU8() !== 0 : false;
    const typeCount = rI32();
    const types = [];
    for (let i = 0; i < typeCount; i++) {
      const classID = rI32();
      if (version >= 16) rU8();
      if (version >= 17) rI16();
      if (version >= 13) {
        if ((version < 16 && classID < 0) || (version >= 16 && classID === 114)) p += 16;
        p += 16;
      }
      if (enableTypeTree) {
        const nodeNumber = rI32();
        const stringBufferSize = rI32();
        const nodeSize = version >= 19 ? 32 : 24;
        p += nodeNumber * nodeSize;
        p += stringBufferSize;
        if (version >= 21) { const depCount = rI32(); p += depCount * 4; }
      }
      types.push(classID);
    }
    const objCount = rI32();
    const objs = [];
    for (let i = 0; i < objCount; i++) {
      align4();
      rI64();
      let byteStart;
      if (version >= 22) byteStart = Number(rI64()); else byteStart = rU32();
      byteStart += dataOffset;
      const byteSize = rU32();
      const typeID = rI32();
      objs.push({ byteStart, byteSize, classID: types[typeID] });
    }
    const dec = new TextDecoder();
    const out = [];
    for (const o of objs) {
      if (o.classID !== 49) continue;
      let q = o.byteStart;
      const rStr = () => { const len = dv.getInt32(q, LE); q += 4; const b = sf.subarray(q, q + len); q += len; q = (q + 3) & ~3; return b; };
      const name = dec.decode(rStr());
      const bytes = new Uint8Array(rStr());
      out.push({ name, bytes });
    }
    return out;
  }
  function extractTextAssets(bundleBytes) {
    const { data, nodes } = parseUnityFS(bundleBytes);
    const cab = nodes.find((n) => !n.path.endsWith('.resource')) || nodes[0];
    if (!cab) return [];
    const sf = data.subarray(cab.off, cab.off + cab.sz);
    try { return parseSerializedTextAssets(sf); } catch (e) { console.debug('[tp] extractTextAssets failed', e); return []; }
  }

  function extractVoiceClips(bundleBytes) {
    const { data, nodes } = parseUnityFS(bundleBytes);
    const resNode = nodes.find((n) => n.path.endsWith('.resource'));
    const cabNode = nodes.find((n) => !n.path.endsWith('.resource'));
    if (!resNode || !cabNode) return [];
    const res = data.subarray(resNode.off, resNode.off + resNode.sz);
    const cab = data.subarray(cabNode.off, cabNode.off + cabNode.sz);
    const t = latin1.decode(cab);
    const names = [];
    { const archiveRe = /archive:/g; const nameRe = /(?:vo|c_|s_)\d{6,}_\d+[a-z]*/gi; const seen = new Set(); let am;
      while ((am = archiveRe.exec(t)) !== null) {
        let name = null, mm; nameRe.lastIndex = 0;
        while ((mm = nameRe.exec(t)) !== null) { if (mm.index >= am.index) break; name = mm[0]; }
        if (name && !seen.has(name)) { seen.add(name); names.push(name); }
      }
    }
    const starts = [];
    for (let i = 0; i + 8 <= res.length; i++) {
      if (res[i + 4] === 0x66 && res[i + 5] === 0x74 && res[i + 6] === 0x79 && res[i + 7] === 0x70) starts.push(i);
    }
    const clips = [];
    for (let i = 0; i < starts.length; i++) clips.push(res.subarray(starts[i], i + 1 < starts.length ? starts[i + 1] : res.length));
    const out = [];
    const n = Math.min(names.length, clips.length);
    for (let i = 0; i < n; i++) out.push({ name: names[i], data: clips[i] });
    return out;
  }

  function extractAudioResource(bundleBytes) {
    const { data, nodes } = parseUnityFS(bundleBytes);
    const resNode = nodes.find((n) => n.path.endsWith('.resource'));
    if (!resNode) return [];
    const res = data.subarray(resNode.off, resNode.off + resNode.sz);
    const starts = [];
    for (let i = 0; i + 8 <= res.length; i++) { if (res[i + 4] === 0x66 && res[i + 5] === 0x74 && res[i + 6] === 0x79 && res[i + 7] === 0x70) starts.push(i); }
    const clips = [];
    for (let i = 0; i < starts.length; i++) clips.push(res.subarray(starts[i], i + 1 < starts.length ? starts[i + 1] : res.length));
    return clips;
  }

  // inner ext codecはextTagだけで決まり状態を持たない＝モジュールレベルで2種キャッシュ(scene毎の128登録×2を回避)。
  let innerCodecTagged = null, innerCodecPlain = null;
  function innerCodec(extTag) {
    if (extTag) { if (!innerCodecTagged) { innerCodecTagged = new MP.ExtensionCodec(); for (let t = 0; t < 128; t++) { const ty = t; innerCodecTagged.register({ type: t, encode: () => null, decode: () => 'ext' + ty }); } } return innerCodecTagged; }
    if (!innerCodecPlain) { innerCodecPlain = new MP.ExtensionCodec(); for (let t = 0; t < 128; t++) innerCodecPlain.register({ type: t, encode: () => null, decode: () => null }); }
    return innerCodecPlain;
  }

  // MessagePack-CSharpのunion: ext98/99=LZ4ブロック圧縮。
  function decodeCSharpLz4(bytes, opts) {
    opts = opts || {};
    const multiRoot = !!opts.multiRoot, extTag = !!opts.extTag;
    let lengths = null;
    const outer = new MP.ExtensionCodec();
    for (let t = 0; t < 128; t++) outer.register({ type: t, encode: () => null, decode: (d) => { lengths = []; for (const v of MP.decodeMulti(d)) lengths.push(Number(v)); return null; } });
    const inner = innerCodec(extTag);
    const vals = [];
    const emit = (blocks) => {
      if (!(blocks.length && lengths && lengths.length)) return false;
      const parts = blocks.map((b, i) => lz4DecodeBlock(b, lengths[i]));
      let tot = 0; for (const p of parts) tot += p.length;
      const full = new Uint8Array(tot); let o = 0; for (const p of parts) { full.set(p, o); o += p.length; }
      try { for (const v of MP.decodeMulti(full, { extensionCodec: inner, useBigInt64: true })) vals.push(v); } catch (e) { console.debug('[tp] decodeCSharpLz4: inner decodeMulti failed', e); }
      return true;
    };
    if (multiRoot) {
      for (const root of MP.decodeMulti(bytes, { extensionCodec: outer, useBigInt64: true })) {
        if (!Array.isArray(root)) { vals.push(root); continue; }
        if (!emit(root.filter((e) => e instanceof Uint8Array))) vals.push(root);
      }
    } else {
      const root = MP.decode(bytes, { extensionCodec: outer, useBigInt64: true });
      emit(Array.isArray(root) ? root.filter((e) => e instanceof Uint8Array) : []);
    }
    return vals;
  }
  const decodeSceneBin = (binBytes) => decodeCSharpLz4(binBytes, { multiRoot: false, extTag: true });

  const num = globalThis.TP_UTIL.num;
  function sceneToTimeline(decoded, sceneId) {
    const scene = decoded[0];
    const cmds = scene && scene[4];
    if (!Array.isArray(cmds)) return { sceneId, count: 0, lines: [], castIds: [] };
    let curBg = null, curBgm = null, curCast = [];
    const lines = [];
    const castSet = new Set();
    for (const c of cmds) {
      if (c[3]) curBg = c[3];
      if (c[27]) curBgm = c[27];
      if (Array.isArray(c[31])) {
        curCast = c[31].filter((e) => Array.isArray(e)).map((e) => ({ id: num(e[0]), expr: num(e[1]), pos: num(e[2]) })).filter((e) => e.id > 0);
        for (const e of curCast) castSet.add(e.id);
      }
      const text = c[12], speaker = c[10], voice = c[29];
      if (text || voice || speaker) {
        lines.push({
          i: num(c[0]),
          speaker: speaker || null,
          text: text ? String(text).replace(/\\n/g, '\n') : null,
          voice: voice || null,
          bg: curBg,
          bgm: curBgm,
          face: typeof c[30] === 'number' ? c[30] : null,
          cast: curCast.map((e) => e.id),
        });
      }
    }
    return { sceneId, count: lines.length, lines, castIds: [...castSet] };
  }

  // scene[6]＝再生中に追加ロードされる続きシーンのID（無ければ0/null）。連鎖はこれを辿って発見する。
  function sceneNext(decoded) {
    const s = decoded && decoded[0];
    const n = s && s[6];
    return n ? String(n) : null;
  }

  globalThis.TP_DECODE = { parseUnityFS, extractTextAssets, extractVoiceClips, extractAudioResource, decodeCSharpLz4, decodeSceneBin, sceneToTimeline, sceneNext };
})();
