import { noteFailure } from '../core/failures.js';
import { unitySf } from './unity-sf.js';
import { openCab } from './bundle-cab.js';
import { decodeTexture, decodeCubemap } from './texture.js';
export function readMaterialObj(sf, LE, o) {
  const mat = unitySf.readObject(sf, LE, o);
  const props = mat.m_SavedProperties || {};
  const tex = props.m_TexEnvs || mat.m_TexEnvs || [];
  let mainTexPathID = null,
    firstTexPathID = null,
    colorTexPathID = null,
    shadowTexPathID = null,
    maskTexPathID = null,
    mainTexScale = null,
    mainTexOffset = null;
  const texByName = {};
  const texST = {};
  for (const pair of tex) {
    const name = pair[0];
    const env = pair[1];
    const pid = env && env.m_Texture ? String(env.m_Texture.m_PathID) : null;
    if (typeof name === 'string' && env) {
      const sc = env.m_Scale || {};
      const of = env.m_Offset || {};
      texST[name] = [sc.x == null ? 1 : Number(sc.x), sc.y == null ? 1 : Number(sc.y), Number(of.x) || 0, Number(of.y) || 0];
      if (pid && pid !== '0') texByName[name] = pid;
    }
    if (pid && pid !== '0') {
      if (firstTexPathID === null) firstTexPathID = pid;
      if (name === '_ColorTex') colorTexPathID = pid;
      else if (name === '_ShadowTex') shadowTexPathID = pid;
      else if (name === '_MaskTex') maskTexPathID = pid;
      else if (name === '_MainTex' || name === '_BaseMap') {
        mainTexPathID = pid;
        mainTexScale = [Number((env.m_Scale || {}).x), Number((env.m_Scale || {}).y)];
        mainTexOffset = [Number((env.m_Offset || {}).x), Number((env.m_Offset || {}).y)];
      }
    }
  }
  const colors = props.m_Colors || [];
  const floats = props.m_Floats || [];
  const getColor = (n) => {
    const p = colors.find((x) => x[0] === n);
    if (!p) return null;
    const v = p[1] || {};
    return [v.r != null ? v.r : v.x != null ? v.x : 1, v.g != null ? v.g : v.y != null ? v.y : 1, v.b != null ? v.b : v.z != null ? v.z : 1, v.a != null ? v.a : v.w != null ? v.w : 1];
  };
  const getF = (n) => {
    const p = floats.find((x) => x[0] === n);
    return p ? Number(p[1]) : null;
  };
  const dstBlend = getF('_DstBlend');
  const toon = {
    colorTexPathID,
    shadowTexPathID,
    maskTexPathID,
    outlineColor: getColor('_OutlineColor') || [0.35, 0.3, 0.26, 1],
    outlineThickness: getF('_OutlineThickness'),
    shadowColorWeight: getF('_ShadowColorWeight'),
    shadowBorderThreshold: getF('_ShadowBorderThreshold'),
    shadowBorderGradation: getF('_ShadowBorderGradation'),
    rimLightThreshold: getF('_RimLightThreshold'),
    highlightColor: getColor('_HighlightColor'),
    highlightIntensity: getF('_HighlightIntensity'),
    highlightPosition: getF('_HighlightPosition'),
    highlightSharpness: getF('_HighlightSharpness'),
    highlightNoiseIntensity: getF('_HighlightNoiseIntensity'),
    fresnel: getF('_Fresnel'),
    emissionColor: getColor('_EmissionColor'),
    colorOverride: getColor('_ColorOverride'),
  };
  const vec1 = {};
  for (const p of floats) if (typeof p[0] === 'string' && p[0].indexOf('Vector1') === 0) vec1[p[0]] = Number(p[1]);
  const allColors = {},
    allFloats = {};
  for (const p of colors) if (typeof p[0] === 'string') allColors[p[0]] = getColor(p[0]);
  for (const p of floats) if (typeof p[0] === 'string') allFloats[p[0]] = Number(p[1]);
  const graphColors = colors.filter((x) => typeof x[0] === 'string' && x[0][0] !== '_').map((x) => getColor(x[0]));
  const kw = new Set();
  if (typeof mat.m_ShaderKeywords === 'string') for (const k of mat.m_ShaderKeywords.split(' ')) if (k) kw.add(k);
  if (Array.isArray(mat.m_ValidKeywords)) for (const k of mat.m_ValidKeywords) if (k) kw.add(String(k));
  return {
    pathID: o.pathID,
    name: mat.m_Name,
    keywords: kw,
    renderQueue: Number(mat.m_CustomRenderQueue),
    shaderPathID: mat.m_Shader ? String(mat.m_Shader.m_PathID) : null,
    mainTexPathID: mainTexPathID || colorTexPathID || firstTexPathID,
    mainTexScale,
    mainTexOffset,
    color: getColor('_BaseColor') || getColor('_Color'),
    graphColors,
    transparent: dstBlend != null && dstBlend !== 0,
    srcBlend: getF('_SrcBlend'),
    dstBlend,
    cutoff: getF('_Cutoff') != null ? getF('_Cutoff') : getF('_AlphaClip'),
    alphaClip: getF('_AlphaClip'),
    cull: getF('_Cull'),
    zwrite: getF('_ZWrite'),
    texByName,
    texST,
    vec1,
    allColors,
    allFloats,
    toon,
  };
}

function readShaderProps(pf) {
  const out = {};
  for (const p of (pf.m_PropInfo && pf.m_PropInfo.m_Props) || []) {
    if (typeof p.m_Name !== 'string') continue;
    out[p.m_Name] = { type: Number(p.m_Type), defTex: (p.m_DefTexture && p.m_DefTexture.m_DefaultName) || null };
  }
  return out;
}

function readShaderInfo(sf, LE, o) {
  const s = unitySf.readObject(sf, LE, o);
  const pf = s.m_ParsedForm;
  if (!pf) return { name: null };
  const name = pf.m_Name;
  const props = readShaderProps(pf);
  if (!pf.m_SubShaders || !pf.m_SubShaders.length) return { name, props };
  const ss = pf.m_SubShaders[0];
  const ps = ss && ss.m_Passes && ss.m_Passes[0];
  const queue = shaderQueue(ss, ps);
  const st = (ps && ps.m_State) || {};
  const sv = (x) => (x && typeof x === 'object' ? (x.val != null ? Number(x.val) : null) : x != null ? Number(x) : null);
  const zWrite = sv(st.zWrite);
  const zTest = sv(st.zTest);
  const cull = sv(st.culling);
  const rt = ps && ps.m_State && ps.m_State.rtBlend0;
  if (!rt) return { name, props, queue, zWrite, zTest, cull };
  const db = rt.destBlend || {};
  const sb = rt.srcBlend || {};
  const dynamic = typeof db.name === 'string' && db.name.charAt(0) === '_';
  return { name, props, queue, zWrite, zTest, cull, dst: db.val != null ? Number(db.val) : null, src: sb.val != null ? Number(sb.val) : null, dynamic };
}

const QUEUE_BASE = { background: 1000, geometry: 2000, alphatest: 2450, transparent: 3000, overlay: 4000 };
function tagMapOf(t) {
  const m = t && (t.tags || t.m_Tags);
  if (!m) return null;
  if (Array.isArray(m)) {
    const o = {};
    for (const kv of m) if (Array.isArray(kv) && typeof kv[0] === 'string') o[kv[0]] = kv[1];
    return o;
  }
  return typeof m === 'object' ? m : null;
}
function shaderQueue(ss, ps) {
  const tags = Object.assign({}, tagMapOf(ss && ss.m_Tags) || {}, tagMapOf(ps && ps.m_State && ps.m_State.m_Tags) || {});
  let q = null;
  for (const k of Object.keys(tags)) if (k.toLowerCase() === 'queue') q = tags[k];
  if (typeof q !== 'string' || !q) return null;
  const m = /^\s*([A-Za-z]+)\s*([+-]\s*\d+)?\s*$/.exec(q);
  if (!m) {
    const n = Number(q);
    return Number.isFinite(n) ? n : null;
  }
  const base = QUEUE_BASE[m[1].toLowerCase()];
  if (base == null) return null;
  return base + (m[2] ? Number(m[2].replace(/\s+/g, '')) : 0);
}

const MAIN_TEX_SLOTS = ['_BaseMap', '_MainTex', '_ColorTex'];
const TINT_SLOTS = ['_BaseColor', '_Color'];
const DEFAULT_TEX_RGB = { white: [1, 1, 1], black: [0, 0, 0], gray: [0.5, 0.5, 0.5], grey: [0.5, 0.5, 0.5] };

function untexturedFill(mat, shaderProps) {
  if (!shaderProps) return null;
  let slot = null;
  for (const s of MAIN_TEX_SLOTS)
    if (shaderProps[s]) {
      slot = s;
      break;
    }
  const defTex = slot ? shaderProps[slot].defTex : null;
  const base = defTex ? DEFAULT_TEX_RGB[String(defTex).toLowerCase()] || null : null;
  let tint = null;
  for (const s of TINT_SLOTS)
    if (shaderProps[s]) {
      tint = (mat.allColors && mat.allColors[s]) || null;
      break;
    }
  if (!slot && !tint) return { mainTexSlot: null, defaultTex: null, tint: null, rgba: null };
  const b = base || [1, 1, 1];
  const t = tint || [1, 1, 1, 1];
  return { mainTexSlot: slot, defaultTex: defTex, tint, rgba: [b[0] * t[0], b[1] * t[1], b[2] * t[2], t[3]] };
}

export function resolveBlend(mat, shaderInfoByPid) {
  const sh = mat.shaderPathID ? shaderInfoByPid[mat.shaderPathID] : null;
  if (sh && !sh.dynamic && sh.dst != null) {
    if (sh.dst === 0) return 'opaque';
    if (sh.dst === 10) return 'alpha';
    return 'add';
  }
  if (mat.dstBlend === 10) return 'alpha';
  if (mat.dstBlend === 0) return 'opaque';
  return 'add';
}

export function parseMaterialBundle(bytes, opt) {
  const keep = (opt && opt.keepCompressed) || null;
  const co = openCab(bytes);
  if (!co) return { materials: [], textures: [] };
  const { parsed, sf, sfp } = co;
  const materials = [];
  const textures = [];
  const shaderInfoByPid = {};
  const shaders = {};
  for (const o of sfp.objects) {
    if (o.classID === 48) {
      try {
        const b = readShaderInfo(sf, sfp.LE, o);
        if (b) {
          shaderInfoByPid[String(o.pathID)] = b;
          if (b.name) shaders[String(o.pathID)] = b.name;
        }
      } catch (e) {
        noteFailure('材質解析', 'Shaderの1件', e);
      }
    }
  }
  for (const o of sfp.objects) {
    if (o.classID === 21) {
      try {
        const m = readMaterialObj(sf, sfp.LE, o);
        m.blend = resolveBlend(m, shaderInfoByPid);
        const si = m.shaderPathID ? shaderInfoByPid[m.shaderPathID] : null;
        m.shaderName = si && si.name ? si.name : null;
        m.untextured = untexturedFill(m, si && si.props);
        materials.push(m);
      } catch (e) {
        noteFailure('材質解析', 'Materialの1件', e);
      }
    } else if (o.classID === 28 || o.classID === 89) {
      try {
        const tx = unitySf.readObject(sf, sfp.LE, o);
        const dec = o.classID === 89 ? decodeCubemap(tx, parsed) : decodeTexture(tx, parsed, keep);
        textures.push({
          pathID: o.pathID,
          name: tx.m_Name,
          width: dec.width,
          height: dec.height,
          format: dec.format,
          rgba: dec.rgba || null,
          raw: dec.raw || null,
          blocks: dec.blocks || null,
          decode: dec.decode || null,
          faces: dec.faces || null,
          wrapU: dec.wrapU || 0,
          wrapV: dec.wrapV || 0,
          filter: dec.filter,
          aniso: dec.aniso,
          mipCount: dec.mipCount,
          srgb: dec.srgb,
          error: dec.error || null,
        });
      } catch (e) {
        textures.push({ pathID: o.pathID, error: e && e.message ? e.message : String(e) });
      }
    }
  }
  return { materials, textures, shaders, shaderInfo: shaderInfoByPid };
}

export function parseMouthAtlas(bytes) {
  if (!bytes) return null;
  const mb = parseMaterialBundle(bytes);
  const byName = (n) => {
    const t = (mb.textures || []).find((x) => x.name === n && x.rgba);
    return t ? { rgba: t.rgba, width: t.width, height: t.height } : null;
  };
  const variants = {
    0: byName('mouth_texture_preset'),
    1: byName('mouth_fanged_texture_preset'),
    2: byName('mouth_shark_texture_preset'),
    3: byName('mouth_secondary_texture_preset'),
  };
  const def = variants[0];
  if (!def) return null;
  return { rgba: def.rgba, width: def.width, height: def.height, variants };
}
