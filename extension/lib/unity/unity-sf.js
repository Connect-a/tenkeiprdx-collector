'use strict';
(function () {
  const COMMON = {0:'AABB',5:'AnimationClip',19:'AnimationCurve',34:'AnimationState',49:'Array',55:'Base',60:'BitField',69:'bitset',76:'bool',81:'char',86:'ColorRGBA',96:'Component',106:'data',111:'deque',117:'double',124:'dynamic_array',138:'FastPropertyName',155:'first',161:'float',167:'Font',172:'GameObject',183:'Generic Mono',196:'GradientNEW',208:'GUID',213:'GUIStyle',222:'int',226:'list',231:'long long',241:'map',245:'Matrix4x4f',256:'MdFour',263:'MonoBehaviour',277:'MonoScript',288:'m_ByteSize',299:'m_Curve',307:'m_EditorClassIdentifier',331:'m_EditorHideFlags',349:'m_Enabled',359:'m_ExtensionPtr',374:'m_GameObject',387:'m_Index',395:'m_IsArray',405:'m_IsStatic',416:'m_MetaFlag',427:'m_Name',434:'m_ObjectHideFlags',452:'m_PrefabInternal',469:'m_PrefabParentObject',490:'m_Script',499:'m_StaticEditorFlags',519:'m_Type',526:'m_Version',536:'Object',543:'pair',548:'PPtr<Component>',564:'PPtr<GameObject>',581:'PPtr<Material>',596:'PPtr<MonoBehaviour>',616:'PPtr<MonoScript>',633:'PPtr<Object>',646:'PPtr<Prefab>',659:'PPtr<Sprite>',672:'PPtr<TextAsset>',688:'PPtr<Texture>',702:'PPtr<Texture2D>',718:'PPtr<Transform>',734:'Prefab',741:'Quaternionf',753:'Rectf',759:'RectInt',767:'RectOffset',778:'second',785:'set',789:'short',795:'size',800:'SInt16',807:'SInt32',814:'SInt64',821:'SInt8',827:'staticvector',840:'string',847:'TextAsset',857:'TextMesh',866:'Texture',874:'Texture2D',884:'Transform',894:'TypelessData',907:'UInt16',914:'UInt32',921:'UInt64',928:'UInt8',934:'unsigned int',947:'unsigned long long',966:'unsigned short',981:'vector',988:'Vector2f',997:'Vector3f',1006:'Vector4f',1015:'m_ScriptingClassIdentifier',1042:'Gradient',1051:'Type*',1057:'int2_storage',1070:'int3_storage',1083:'BoundsInt',1093:'m_CorrespondingSourceObject',1121:'m_PrefabInstance',1138:'m_PrefabAsset',1152:'FileSize',1161:'Hash128'};

  function parseSerializedFile(sf) {
    const dv = new DataView(sf.buffer, sf.byteOffset, sf.byteLength);
    let p = 0;
    const beU32 = () => { const v = dv.getUint32(p, false); p += 4; return v; };
    let metadataSize = beU32(); let fileSize = BigInt(beU32()); const version = beU32(); let dataOffset = BigInt(beU32());
    let endian = 0;
    if (version >= 9) { endian = dv.getUint8(p); p += 1; p += 3; }
    if (version >= 22) { metadataSize = beU32(); fileSize = dv.getBigInt64(p, false); p += 8; dataOffset = dv.getBigInt64(p, false); p += 8; p += 8; }
    const LE = endian === 0;
    const rU32 = () => { const v = dv.getUint32(p, LE); p += 4; return v; };
    const rI32 = () => { const v = dv.getInt32(p, LE); p += 4; return v; };
    const rI16 = () => { const v = dv.getInt16(p, LE); p += 2; return v; };
    const rU16 = () => { const v = dv.getUint16(p, LE); p += 2; return v; };
    const rU8 = () => { const v = dv.getUint8(p); p += 1; return v; };
    const rI64 = () => { const v = dv.getBigInt64(p, LE); p += 8; return v; };
    const rStr = () => { let s = ''; while (true) { const c = dv.getUint8(p); p += 1; if (!c) break; s += String.fromCharCode(c); } return s; };
    const unityVersion = rStr(); const targetPlatform = rI32();
    const enableTypeTree = version >= 13 ? rU8() !== 0 : false;
    const typeCount = rI32();
    const u8all = new Uint8Array(sf.buffer);
    const types = [];
    for (let i = 0; i < typeCount; i++) {
      const classID = rI32();
      if (version >= 16) rU8();
      if (version >= 17) rI16();
      if (version >= 13) { if ((version < 16 && classID < 0) || (version >= 16 && classID === 114)) p += 16; p += 16; }
      let nodes = null;
      if (enableTypeTree) {
        const nodeCount = rI32(); const strBufSize = rI32();
        const raw = [];
        for (let n = 0; n < nodeCount; n++) {
          const ver = rU16(); const level = rU8(); const typeFlags = rU8();
          const typeOff = rU32(); const nameOff = rU32();
          const byteSize = rI32(); const idx = rI32(); const metaFlag = rU32();
          if (version >= 19) p += 8;
          raw.push({ level, typeOff, nameOff, metaFlag });
        }
        const strStart = p; p += strBufSize;
        if (version >= 21) { const dc = rI32(); p += dc * 4; }
        const resolve = (off) => { if (off & 0x80000000) return COMMON[off & 0x7fffffff] || ('C?' + (off & 0x7fffffff)); let s = ''; let q = sf.byteOffset + strStart + off; while (u8all[q]) s += String.fromCharCode(u8all[q++]); return s; };
        nodes = raw.map((nd) => ({ level: nd.level, type: resolve(nd.typeOff), name: resolve(nd.nameOff), metaFlag: nd.metaFlag }));
      }
      types.push({ classID, nodes });
    }
    const objCount = rI32();
    const objects = [];
    for (let i = 0; i < objCount; i++) {
      p = (p + 3) & ~3; const pathID = rI64();
      let byteStart; if (version >= 22) byteStart = Number(rI64()); else byteStart = rU32();
      const byteSize = rU32(); const typeID = rI32();
      const t = types[typeID] || {};
      objects.push({ pathID: pathID.toString(), classID: t.classID, nodes: t.nodes, byteStart: byteStart + Number(dataOffset), byteSize });
    }
    return { version, unityVersion, LE, objects };
  }

  function makeReader(sf, LE, startAbs) {
    const dv = new DataView(sf.buffer, sf.byteOffset, sf.byteLength);
    const u8 = new Uint8Array(sf.buffer, sf.byteOffset, sf.byteLength);
    const R = { p: startAbs };
    R.align = () => { R.p = (R.p + 3) & ~3; };
    R.i8 = () => { const v = dv.getInt8(R.p); R.p += 1; return v; };
    R.u8 = () => { const v = dv.getUint8(R.p); R.p += 1; return v; };
    R.i16 = () => { const v = dv.getInt16(R.p, LE); R.p += 2; return v; };
    R.u16 = () => { const v = dv.getUint16(R.p, LE); R.p += 2; return v; };
    R.i32 = () => { const v = dv.getInt32(R.p, LE); R.p += 4; return v; };
    R.u32 = () => { const v = dv.getUint32(R.p, LE); R.p += 4; return v; };
    R.i64 = () => { const v = dv.getBigInt64(R.p, LE); R.p += 8; return v; };
    R.u64 = () => { const v = dv.getBigUint64(R.p, LE); R.p += 8; return v; };
    R.f32 = () => { const v = dv.getFloat32(R.p, LE); R.p += 4; return v; };
    R.f64 = () => { const v = dv.getFloat64(R.p, LE); R.p += 8; return v; };
    R.bytes = (n) => { const b = u8.subarray(R.p, R.p + n); R.p += n; return b; };
    R.alignedStr = () => { const len = R.i32(); const b = R.bytes(len); R.align(); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); try { return decodeURIComponent(escape(s)); } catch (e) { return s; } };
    return R;
  }

  function subtree(nodes, index) {
    const out = [nodes[index]];
    const lvl = nodes[index].level;
    for (let i = index + 1; i < nodes.length; i++) { if (nodes[i].level <= lvl) break; out.push(nodes[i]); }
    return out;
  }

  function readValue(nodes, R, iRef) {
    const node = nodes[iRef.i];
    const t = node.type;
    let value;
    let align = (node.metaFlag & 0x4000) !== 0;
    switch (t) {
      case 'SInt8': value = R.i8(); break;
      case 'UInt8': case 'char': value = R.u8(); break;
      case 'short': case 'SInt16': value = R.i16(); break;
      case 'UInt16': case 'unsigned short': value = R.u16(); break;
      case 'int': case 'SInt32': value = R.i32(); break;
      case 'UInt32': case 'unsigned int': case 'Type*': value = R.u32(); break;
      case 'long long': case 'SInt64': value = R.i64(); break;
      case 'UInt64': case 'unsigned long long': case 'FileSize': value = R.u64(); break;
      case 'float': value = R.f32(); break;
      case 'double': value = R.f64(); break;
      case 'bool': value = R.u8() !== 0; break;
      case 'string': { value = R.alignedStr(); const sk = subtree(nodes, iRef.i); iRef.i += sk.length - 1; break; }
      case 'map': {
        if ((nodes[iRef.i + 1].metaFlag & 0x4000) !== 0) align = true;
        const map = subtree(nodes, iRef.i); iRef.i += map.length - 1;
        const first = subtree(map, 4); const next = 4 + first.length; const second = subtree(map, next);
        const size = R.i32(); const arr = [];
        for (let j = 0; j < size; j++) { const a = { i: 0 }; const k = readValue(first, R, a); const b = { i: 0 }; const v2 = readValue(second, R, b); arr.push([k, v2]); }
        value = arr; break;
      }
      case 'TypelessData': { const size = R.i32(); value = { __bytes: R.bytes(size) }; iRef.i += 2; break; }
      default: {
        if (iRef.i < nodes.length - 1 && nodes[iRef.i + 1].type === 'Array') {
          if ((nodes[iRef.i + 1].metaFlag & 0x4000) !== 0) align = true;
          const vec = subtree(nodes, iRef.i); iRef.i += vec.length - 1;
          const size = R.i32(); const list = new Array(size);
          for (let j = 0; j < size; j++) { const a = { i: 3 }; list[j] = readValue(vec, R, a); }
          value = list; break;
        } else {
          const cls = subtree(nodes, iRef.i); iRef.i += cls.length - 1;
          const obj = {};
          for (let j = 1; j < cls.length; ) { const name = cls[j].name; const a = { i: j }; obj[name] = readValue(cls, R, a); j = a.i + 1; }
          value = obj; break;
        }
      }
    }
    if (align) R.align();
    return value;
  }

  function readObject(sf, LE, obj) {
    if (!obj.nodes) return null;
    const R = makeReader(sf, LE, obj.byteStart);
    const nodes = obj.nodes;
    const out = {};
    for (let i = 1; i < nodes.length; ) { const name = nodes[i].name; const a = { i }; out[name] = readValue(nodes, R, a); i = a.i + 1; }
    return out;
  }

  globalThis.TP_UNITYSF = { parseSerializedFile, readObject };
})();
