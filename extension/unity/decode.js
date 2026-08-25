import { utilHelpers } from '../core/util.js';
import { fsb5 } from './fsb5.js';
import { fsb5Vorbis } from './fsb5-vorbis.js';
import { vorbisSetup } from './vorbis-setup.js';
import { unitySf } from './unity-sf.js';
import * as MessagePack from '../vendor/msgpack.esm.js';
const latin1 = utilHelpers.latin1;

function lz4DecodeBlock(src, destLen) {
  const dst = new Uint8Array(destLen);
  let s = 0,
    d = 0;
  while (s < src.length) {
    const token = src[s++];
    let litLen = token >> 4;
    if (litLen === 15) {
      let b;
      do {
        b = src[s++];
        litLen += b;
      } while (b === 255);
    }
    if (s + litLen > src.length) litLen = Math.max(0, src.length - s);
    if (d + litLen > destLen) litLen = Math.max(0, destLen - d);
    if (litLen > 0) {
      dst.set(src.subarray(s, s + litLen), d);
      s += litLen;
      d += litLen;
    }
    if (s >= src.length || d >= destLen) break;
    if (s + 1 >= src.length) break;
    const offset = src[s] | (src[s + 1] << 8);
    s += 2;
    if (!offset || offset > d) break;
    let matchLen = (token & 0x0f) + 4;
    if ((token & 0x0f) === 15) {
      let b;
      do {
        b = src[s++];
        matchLen += b;
      } while (b === 255);
    }
    let m = d - offset;
    const maxMatch = Math.min(matchLen, destLen - d);
    for (let k = 0; k < maxMatch; k++) dst[d++] = dst[m++];
  }
  return dst.subarray(0, d);
}

function readCStr(buf, pos) {
  let e = pos;
  while (e < buf.length && buf[e] !== 0) e++;
  return { str: latin1.decode(buf.subarray(pos, e)), next: e + 1 };
}
function parseUnityFS(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 0;
  p = readCStr(buf, p).next;
  const version = dv.getUint32(p);
  p += 4;
  p = readCStr(buf, p).next;
  p = readCStr(buf, p).next;
  p += 8;
  const cInfo = dv.getUint32(p);
  p += 4;
  const uInfo = dv.getUint32(p);
  p += 4;
  const flags = dv.getUint32(p);
  p += 4;
  let headerEnd = p;
  if (version >= 7) headerEnd = (headerEnd + 15) & ~15;
  const infoAtEnd = (flags & 0x80) !== 0;
  const blockInfoNeedPaddingAtStart = (flags & 0x200) !== 0;
  const infoOff = infoAtEnd ? buf.length - cInfo : headerEnd;
  let blocksStart = infoAtEnd ? headerEnd : infoOff + cInfo;
  if (blockInfoNeedPaddingAtStart) blocksStart = (blocksStart + 15) & ~15;
  let info = buf.subarray(infoOff, infoOff + cInfo);
  const infoComp = flags & 0x3f;
  if (infoComp === 2 || infoComp === 3) info = lz4DecodeBlock(info, uInfo);
  const idv = new DataView(info.buffer, info.byteOffset, info.byteLength);
  let ip = 16;
  const blockCount = idv.getInt32(ip);
  ip += 4;
  const blks = [];
  for (let i = 0; i < blockCount; i++) {
    const us = idv.getUint32(ip);
    ip += 4;
    const cs = idv.getUint32(ip);
    ip += 4;
    const bf = idv.getUint16(ip);
    ip += 2;
    blks.push({ us, cs, bf });
  }
  const nodeCount = idv.getInt32(ip);
  ip += 4;
  const nodes = [];
  for (let i = 0; i < nodeCount; i++) {
    const off = Number(idv.getBigInt64(ip));
    ip += 8;
    const sz = Number(idv.getBigInt64(ip));
    ip += 8;
    const nf = idv.getUint32(ip);
    ip += 4;
    const ns = readCStr(info, ip);
    ip = ns.next;
    nodes.push({ off, sz, nf, path: ns.str });
  }
  let bp = blocksStart;
  const parts = [];
  let total = 0;
  for (const b of blks) {
    const comp = b.bf & 0x3f;
    const chunk = buf.subarray(bp, bp + b.cs);
    bp += b.cs;
    const part = comp === 2 || comp === 3 ? lz4DecodeBlock(chunk, b.us) : chunk;
    parts.push(part);
    total += part.length;
  }
  const data = new Uint8Array(total);
  let o = 0;
  for (const part of parts) {
    data.set(part, o);
    o += part.length;
  }
  return { data, nodes };
}

function parseSerializedTextAssets(sf) {
  const { LE, objects } = unitySf.parseSerializedFile(sf);
  const dv = new DataView(sf.buffer, sf.byteOffset, sf.byteLength);
  const dec = new TextDecoder();
  const out = [];
  for (const o of objects) {
    if (o.classID !== 49) continue;
    let q = o.byteStart;
    const rStr = () => {
      const len = dv.getInt32(q, LE);
      q += 4;
      const b = sf.subarray(q, q + len);
      q += len;
      q = (q + 3) & ~3;
      return b;
    };
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
  try {
    return parseSerializedTextAssets(sf);
  } catch (e) {
    return [];
  }
}

const MP4 = 'audio/mp4';
const OGG = 'audio/ogg';
const isFsb5 = (b) => b.length > 4 && b[0] === 0x46 && b[1] === 0x53 && b[2] === 0x42 && b[3] === 0x35;

async function fsb5Clips(res) {
  const blocks = fsb5.parseFsb5Stream(res);
  const out = [];
  for (const b of blocks) {
    for (const c of b.clips || []) {
      const setup = await vorbisSetup.setupFor(c.vorbisCrc32);
      const o = setup ? fsb5Vorbis.toOgg(c, setup) : null;
      if (o && o.ok) out.push({ name: c.name || '', data: o.bytes, mime: OGG });
    }
  }
  return out;
}

async function resourceClips(res) {
  if (isFsb5(res)) return fsb5Clips(res);
  return sliceFtypClips(res).map((data) => ({ name: '', data, mime: MP4 }));
}

function sliceFtypClips(res) {
  const starts = [];
  for (let i = 0; i + 8 <= res.length; i++) if (res[i + 4] === 0x66 && res[i + 5] === 0x74 && res[i + 6] === 0x79 && res[i + 7] === 0x70) starts.push(i);
  const clips = [];
  for (let i = 0; i < starts.length; i++) clips.push(res.subarray(starts[i], i + 1 < starts.length ? starts[i + 1] : res.length));
  return clips;
}

async function extractVoiceClips(bundleBytes) {
  const { data, nodes } = parseUnityFS(bundleBytes);
  const resNode = nodes.find((n) => n.path.endsWith('.resource'));
  const cabNode = nodes.find((n) => !n.path.endsWith('.resource'));
  if (!resNode || !cabNode) return [];
  const res = data.subarray(resNode.off, resNode.off + resNode.sz);
  const cab = data.subarray(cabNode.off, cabNode.off + cabNode.sz);
  const t = latin1.decode(cab);
  const names = [];
  {
    const archiveRe = /archive:/g;
    const nameRe = /(?:vo|c_|s_|e_|m_)\d{6,}_\d+(?:_?[a-z]+\d*)*|system\d{3,}/gi;
    const seen = new Set();
    let am;
    while ((am = archiveRe.exec(t)) !== null) {
      let name = null,
        mm;
      nameRe.lastIndex = 0;
      while ((mm = nameRe.exec(t)) !== null) {
        if (mm.index >= am.index) break;
        name = mm[0];
      }
      if (name && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }
  const clips = await resourceClips(res);
  if (clips.some((c) => c.name)) return clips;
  const n = Math.min(names.length, clips.length);
  return clips.slice(0, n).map((c, i) => ({ ...c, name: names[i] }));
}

async function extractAudioResource(bundleBytes) {
  const { data, nodes } = parseUnityFS(bundleBytes);
  const resNode = nodes.find((n) => n.path.endsWith('.resource'));
  if (!resNode) return [];
  return resourceClips(data.subarray(resNode.off, resNode.off + resNode.sz));
}

let innerCodecTagged = null,
  innerCodecPlain = null;
function innerCodec(extTag) {
  if (extTag) {
    if (!innerCodecTagged) {
      innerCodecTagged = new MessagePack.ExtensionCodec();
      for (let t = 0; t < 128; t++) {
        const ty = t;
        innerCodecTagged.register({ type: t, encode: () => null, decode: () => 'ext' + ty });
      }
    }
    return innerCodecTagged;
  }
  if (!innerCodecPlain) {
    innerCodecPlain = new MessagePack.ExtensionCodec();
    for (let t = 0; t < 128; t++) innerCodecPlain.register({ type: t, encode: () => null, decode: () => null });
  }
  return innerCodecPlain;
}

function decodeCSharpLz4(bytes, opts) {
  opts = opts || {};
  const multiRoot = !!opts.multiRoot,
    extTag = !!opts.extTag;
  let lengths = null;
  const outer = new MessagePack.ExtensionCodec();
  for (let t = 0; t < 128; t++)
    outer.register({
      type: t,
      encode: () => null,
      decode: (d) => {
        lengths = [];
        for (const v of MessagePack.decodeMulti(d)) lengths.push(Number(v));
        return null;
      },
    });
  const inner = innerCodec(extTag);
  const vals = [];
  const emit = (blocks) => {
    if (!(blocks.length && lengths && lengths.length)) return false;
    const parts = blocks.map((b, i) => lz4DecodeBlock(b, lengths[i]));
    let tot = 0;
    for (const p of parts) tot += p.length;
    const full = new Uint8Array(tot);
    let o = 0;
    for (const p of parts) {
      full.set(p, o);
      o += p.length;
    }
    try {
      for (const v of MessagePack.decodeMulti(full, { extensionCodec: inner, useBigInt64: true })) vals.push(v);
    } catch (e) {}
    return true;
  };
  if (multiRoot) {
    for (const root of MessagePack.decodeMulti(bytes, { extensionCodec: outer, useBigInt64: true })) {
      if (!Array.isArray(root)) {
        vals.push(root);
        continue;
      }
      if (!emit(root.filter((e) => e instanceof Uint8Array))) vals.push(root);
    }
  } else {
    const root = MessagePack.decode(bytes, { extensionCodec: outer, useBigInt64: true });
    emit(Array.isArray(root) ? root.filter((e) => e instanceof Uint8Array) : []);
  }
  return vals;
}
const decodeSceneBin = (binBytes) => decodeCSharpLz4(binBytes, { multiRoot: false, extTag: true });
const decodeUserBytes = (bytes) => decodeCSharpLz4(bytes, { multiRoot: true, extTag: false });

const num = utilHelpers.num;

function decodeSceneCommands(decoded) {
  const scene = decoded && decoded[0];
  const cmds = scene && scene[4];
  if (!Array.isArray(cmds)) return [];
  return cmds.map((c) => ({
    order: c[0],
    effect: c[1],
    effectDur: c[2],
    bg: c[3],
    bgFlip: c[5],
    bgFade: c[6],
    still: c[7],
    stillAnim: c[8],
    stillSpeed: c[9],
    speaker: c[10],
    text: c[12],
    fontSize: c[13],
    center: c[15],
    camStartX: c[16],
    camStartY: c[17],
    camStartZ: c[18],
    camEndX: c[19],
    camEndY: c[20],
    camEndZ: c[21],
    camDur: c[22],
    insert: c[23],
    insertEffect: c[24],
    insertX: c[25],
    insertY: c[26],
    bgm: c[27],
    se: c[28],
    voice: c[29],
    speakerPos: c[30],
    cast: Array.isArray(c[31])
      ? c[31]
          .filter((e) => Array.isArray(e))
          .map((e) => ({
            id: e[0],
            app: e[1],
            pos: e[2],
            act: e[3],
            emo: e[4],
            face: e[5],
            flip: e[6],
            skin: e[7],
          }))
      : null,
    ambientVfx: c[32],
  }));
}

function sceneToTimeline(decoded, sceneId) {
  const cmds = decodeSceneCommands(decoded);
  let curBg = null,
    curBgm = null,
    curCast = [];
  const lines = [];
  const castSet = new Set();
  for (const cmd of cmds) {
    if (cmd.bg) curBg = cmd.bg;
    if (cmd.bgm) curBgm = cmd.bgm;
    if (cmd.cast) {
      curCast = cmd.cast.map((e) => ({ id: num(e.id), expr: num(e.app), pos: num(e.pos) })).filter((e) => e.id > 0);
      for (const e of curCast) castSet.add(e.id);
    }
    const text = cmd.text,
      speaker = cmd.speaker,
      voice = cmd.voice;
    if (text || voice || speaker) {
      lines.push({
        i: num(cmd.order),
        speaker: speaker || null,
        text: text ? String(text).replace(/\\n/g, '\n') : null,
        voice: voice || null,
        bg: curBg,
        bgm: curBgm,
        face: typeof cmd.speakerPos === 'number' ? cmd.speakerPos : null,
        cast: curCast.map((e) => e.id),
      });
    }
  }
  return { sceneId, count: lines.length, lines, castIds: [...castSet] };
}

function bgmCue(raw) {
  const s = String(raw == null ? '' : raw);
  const body = (s.match(/[{｛]([^}｝]*)[}｝]/) || [])[1] || '';
  const name = s
    .replace(/[{｛][^}｝]*[}｝]/g, '')
    .replace(/[{｛].*$/, '')
    .trim();
  const val = (key) => {
    const m = body.match(new RegExp(key + '_([0-9.]+)', 'i'));
    const v = m ? Number(m[1]) : NaN;
    return Number.isFinite(v) ? v : null;
  };
  return { name, stop: !name || /nobgm/i.test(name), fade: val('Fade'), delay: val('Delay') };
}

function sceneNext(decoded) {
  const s = decoded && decoded[0];
  const n = s && s[6];
  return n ? String(n) : null;
}

function sceneMeta(decoded) {
  const s = (decoded && decoded[0]) || null;
  const g = (i) => {
    const v = s && s[i];
    return v == null || v === 0 ? null : String(v);
  };
  return { id: g(5), next: g(6), choiceGroup: g(7), jump: s && s[8] != null ? num(s[8]) : null };
}

function extractChoiceGroups(bytes) {
  const out = {};
  let root = null;
  try {
    root = decodeCSharpLz4(bytes, { multiRoot: true, extTag: false });
  } catch (e) {
    return out;
  }
  const add = (cgm) => {
    if (!Array.isArray(cgm) || cgm.length < 2 || !Array.isArray(cgm[1])) return;
    const gid = String(num(cgm[0]));
    const members = cgm[1]
      .map((m) => (Array.isArray(m) ? { content: m[0] != null ? String(m[0]) : '', sceneMasterId: m[1] != null ? String(num(m[1])) : null, order: num(m[2]) || 0 } : null))
      .filter((m) => m && m.sceneMasterId);
    if (members.length) out[gid] = members.sort((a, b) => a.order - b.order);
  };
  (function walk(v, d) {
    if (d > 7 || v == null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      if (v.length === 5 && Array.isArray(v[4]) && Array.isArray(v[2])) for (const cgm of v[4]) add(cgm);
      for (const x of v) walk(x, d + 1);
    } else for (const k in v) walk(v[k], d + 1);
  })(root, 0);
  return out;
}

function extractEmbeddedUrls(bytes, re) {
  const matches = [];
  const scan = (s) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s)) !== null) matches.push(m);
  };
  let vals = null;
  try {
    vals = decodeUserBytes(bytes);
  } catch (e) {}
  if (vals)
    (function walk(x) {
      if (typeof x === 'string') scan(x);
      else if (Array.isArray(x)) x.forEach(walk);
    })(vals);
  if (!matches.length) scan(latin1.decode(bytes));
  return matches;
}

export const unityDecode = {
  parseUnityFS,
  extractTextAssets,
  extractVoiceClips,
  extractAudioResource,
  decodeSceneBin,
  decodeUserBytes,
  decodeSceneCommands,
  sceneToTimeline,
  bgmCue,
  sceneNext,
  sceneMeta,
  extractChoiceGroups,
  extractEmbeddedUrls,
};
