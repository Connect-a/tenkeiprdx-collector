'use strict';
(function () {
  const THREE = () => globalThis.THREE;

  function buildTextureMap(materialBundle) {
    const byName = new Map();
    const texByPath = new Map((materialBundle.textures || []).map((t) => [t.pathID, t]));
    for (const m of materialBundle.materials || []) {
      const t = texByPath.get(m.mainTexPathID);
      if (t && t.rgba) byName.set(m.name, t);
    }
    const withRgba = (materialBundle.textures || []).filter((t) => t.rgba);
    const pick = (pred) => withRgba.find((t) => pred(String(t.name || '')));
    let biggest = null;
    for (const t of withRgba) if (!biggest || t.rgba.length > biggest.rgba.length) biggest = t;
    const fallback = pick((n) => /head.*color|face.*color/i.test(n)) || pick((n) => /_color/i.test(n) && !/body/i.test(n)) || pick((n) => /_color/i.test(n)) || biggest;
    const headColor = pick((n) => /head.*color/i.test(n)) || fallback;
    return { byName, fallback, headColor };
  }

  // The mouth mesh carries no texture; the game assigns a SHARED mouth atlas (mouth_texture_preset, a 5x5
  // grid of expressions) and picks an expression by offsetting the mesh UV at runtime. The mesh's own UV
  // points to an empty cell, and its V is inverted vs the atlas, so we remap: flip V within the base cell
  // and shift to the target expression cell. Base cell = col0,row4 (bottom-left, empty).
  const MOUTH_CELL = 0.2;
  const MOUTH_BASE_ROW = 4;
  // expression list: [label, col, row] in the atlas grid (v=0 top). Labels 1/2/5/8/10 confirmed by inspecting each cell.
  const MOUTH_EXPRESSIONS = [
    ['ムッ', 0, 1], ['あっ', 3, 4], ['真顔', 1, 0], ['にっこり', 0, 3], ['ニヤッ', 1, 1],
    ['大きく開', 0, 2], ['歯見せ', 2, 2], ['うにっ', 3, 3], ['おちょぼ', 4, 4], ['むー', 0, 0],
  ];
  function remapMouthUV(baseUv, vMin, vMax, col, row) {
    const out = new Float32Array(baseUv.length);
    const du = col * MOUTH_CELL;
    const dv = (MOUTH_BASE_ROW - row) * MOUTH_CELL;
    for (let i = 0; i < baseUv.length; i += 2) {
      out[i] = baseUv[i] + du;
      out[i + 1] = baseUv[i + 1] - dv; // plain shift to the target expression cell (no V-flip, no fine offset)
    }
    return out;
  }

  function makeDataTexture(tex) {
    const T = THREE();
    const dt = new T.DataTexture(tex.rgba, tex.width, tex.height, T.RGBAFormat);
    dt.flipY = false;
    dt.needsUpdate = true;
    // Unity default is Repeat; some meshes author UVs outside [0,1] (e.g. U in [1,2]) expecting wrap.
    dt.wrapS = T.RepeatWrapping;
    dt.wrapT = T.RepeatWrapping;
    dt.magFilter = T.LinearFilter;
    dt.minFilter = T.LinearMipmapLinearFilter;
    dt.generateMipmaps = true;
    if ('colorSpace' in dt) dt.colorSpace = T.SRGBColorSpace || 'srgb';
    else dt.encoding = T.sRGBEncoding;
    return dt;
  }

  // Build the shared bone hierarchy from the parsed Avatar skeleton.
  function buildSkeleton(avatar) {
    const T = THREE();
    const n = avatar.count;
    const bones = new Array(n);
    for (let i = 0; i < n; i++) {
      const b = new T.Bone();
      b.name = 'b' + (avatar.hashes[i] >>> 0);
      const dp = avatar.defPose && avatar.defPose[i];
      if (dp) { b.position.set(dp.t[0], dp.t[1], dp.t[2]); b.quaternion.set(dp.q[0], dp.q[1], dp.q[2], dp.q[3]); b.scale.set(dp.s[0], dp.s[1], dp.s[2]); }
      bones[i] = b;
    }
    const roots = [];
    for (let i = 0; i < n; i++) {
      const p = avatar.parents[i];
      if (p >= 0 && p < n) bones[p].add(bones[i]); else roots.push(bones[i]);
    }
    return { bones, roots };
  }

  function mat4FromBindpose(bp) {
    const T = THREE();
    const m = new T.Matrix4();
    // bindpose is row-major e00..e33
    m.set(bp[0], bp[1], bp[2], bp[3], bp[4], bp[5], bp[6], bp[7], bp[8], bp[9], bp[10], bp[11], bp[12], bp[13], bp[14], bp[15]);
    return m;
  }

  function buildThreeClip(clip, fps) {
    const T = THREE();
    const data = clip.buildTracks(fps);
    const tracks = [];
    for (const tr of data.tracks) {
      const nm = 'b' + (tr.boneHash >>> 0);
      if (tr.type === 'pos') tracks.push(new T.VectorKeyframeTrack(nm + '.position', tr.times, tr.values));
      else if (tr.type === 'scale') tracks.push(new T.VectorKeyframeTrack(nm + '.scale', tr.times, tr.values));
      else if (tr.type === 'rot') tracks.push(new T.QuaternionKeyframeTrack(nm + '.quaternion', tr.times, tr.values));
    }
    return new T.AnimationClip(data.name, data.duration || -1, tracks);
  }

  function render(hostEl, model, materialBundle, opt) {
    const T = THREE();
    if (!T) return { ok: false, reason: 'three-not-loaded' };
    if (!model || !model.meshes || !model.meshes.length) return { ok: false, reason: 'no-meshes' };
    const options = opt || {};
    const skinnable = !!(model.avatar && model.avatar.count && model.meshes.some((m) => m.skinIndex && m.boneNameHashes));

    hostEl.innerHTML = '';
    // controls bar (clip picker) when animated
    let clipSelect = null, playBtn = null;
    const bar = document.createElement('div');
    bar.className = 'model3d-controls';
    hostEl.appendChild(bar);
    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'model3d-canvas';
    hostEl.appendChild(canvasWrap);

    const W = hostEl.clientWidth || 480;
    const H = options.height || 520;

    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(35, W / H, 0.01, 100);
    // Unity is left-handed, three.js is right-handed: loading Unity vertex/bone data verbatim renders the
    // whole model mirrored left<->right vs the game. Flip the projection X to un-mirror uniformly (applies
    // once at screen level -> works for skinned meshes + bone-attached weapons alike, and leaves view-space
    // lighting untouched). DoubleSide materials keep faces visible despite the reversed winding.
    const _updateProj = camera.updateProjectionMatrix.bind(camera);
    camera.updateProjectionMatrix = function () { _updateProj(); camera.projectionMatrix.elements[0] *= -1; };
    camera.updateProjectionMatrix();
    const renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
    if ('outputColorSpace' in renderer) renderer.outputColorSpace = T.SRGBColorSpace || 'srgb';
    else renderer.outputEncoding = T.sRGBEncoding;
    canvasWrap.appendChild(renderer.domElement);

    // shading mode: 'toon' (flat/unlit + outline — closest to the game; the color textures are already
    // toon-shaded, so applying scene lighting on top just darkens them), 'unlit' (flat, no outline),
    // 'pbr' (soft scene lighting).
    const shadeMode = (options.shading && options.shading.mode) || 'unlit';
    const litMode = shadeMode === 'pbr';
    scene.add(new T.AmbientLight(0xffffff, 0.85));
    const dir = new T.DirectionalLight(0xffffff, 0.7); dir.position.set(0.5, 1, 1); scene.add(dir);
    const dir2 = new T.DirectionalLight(0xffffff, 0.35); dir2.position.set(-0.5, 0.5, -1); scene.add(dir2);

    const texMap = buildTextureMap(materialBundle || { materials: [], textures: [] });
    const meshByPath = new Map(model.meshes.map((m) => [m.pathID, m]));
    const modelMatByPath = new Map((model.materials || []).map((m) => [m.pathID, m]));
    const mouthAtlasTex = options.mouthAtlas && options.mouthAtlas.rgba ? makeDataTexture(options.mouthAtlas) : null;

    const texCache = new Map();
    const getMat = (modelMat) => {
      const name = modelMat ? modelMat.name : null;
      const key = ((modelMat && modelMat.pathID) || name || '__fb') + '|' + shadeMode;
      if (texCache.has(key)) return texCache.get(key);
      const ownTex = name ? texMap.byName.get(name) : null;
      const isMouth = /mouth/i.test(name || '');
      const params = { side: T.DoubleSide };
      if (isMouth && mouthAtlasTex) {
        // mouth: shared expression atlas; the mesh UV (remapped below) selects the expression cell.
        // The atlas alpha is a real cutout, so alpha-test it.
        params.map = mouthAtlasTex; params.transparent = true; params.alphaTest = 0.5; params.depthWrite = false;
      }
      // color textures are opaque toon maps: their alpha channel is a shading/mask channel, NOT opacity.
      // Do NOT alpha-test them (some bodies have alpha≈0 everywhere, which would erase the whole mesh).
      else if (ownTex) { params.map = makeDataTexture(ownTex); }
      else if (texMap.fallback) { params.map = makeDataTexture(texMap.fallback); }
      else if (modelMat && modelMat.color) params.color = new T.Color(modelMat.color[0], modelMat.color[1], modelMat.color[2]);
      else params.color = new T.Color(0xcccccc);
      if (!isMouth && modelMat && modelMat.transparent) {
        params.transparent = true; params.depthWrite = false;
        if (modelMat.color && modelMat.color[3] != null) params.opacity = modelMat.color[3];
        delete params.alphaTest;
      }
      // toon & unlit: MeshBasicMaterial (show the already-toon-shaded texture at full brightness; scene
      // lighting on these bakes-in-shaded textures only darkens them). pbr: soft scene lighting.
      let mat;
      if (litMode) { params.roughness = 0.92; params.metalness = 0.0; mat = new T.MeshStandardMaterial(params); }
      else mat = new T.MeshBasicMaterial(params);
      texCache.set(key, mat);
      return mat;
    };
    // inverted-hull outline: a black BackSide copy pushed out along normals (toon mode only).
    const OUTLINE_THICK = () => radius * 0.0025;
    const makeOutline = (mesh, useSkin, skeleton) => {
      if (!mesh.normals) return null;
      const th = OUTLINE_THICK();
      const op = new Float32Array(mesh.positions.length);
      for (let i = 0; i < op.length; i += 3) { op[i] = mesh.positions[i] + mesh.normals[i] * th; op[i + 1] = mesh.positions[i + 1] + mesh.normals[i + 1] * th; op[i + 2] = mesh.positions[i + 2] + mesh.normals[i + 2] * th; }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(op, 3));
      g.setIndex(new T.BufferAttribute(mesh.indices, 1));
      // NOTE: the camera projection X-flip (LH->RH un-mirror) reverses winding, so an inverted-hull outline
      // needs FrontSide here (not the usual BackSide) — otherwise the expanded black hull's near faces render
      // and cover the whole character (all-black body).
      const omat = new T.MeshBasicMaterial({ color: 0x101010, side: T.FrontSide });
      let o;
      if (useSkin) {
        g.setAttribute('skinIndex', new T.Uint16BufferAttribute(mesh.skinIndex, 4));
        g.setAttribute('skinWeight', new T.Float32BufferAttribute(mesh.skinWeight, 4));
        o = new T.SkinnedMesh(g, omat); o.frustumCulled = false; root.add(o); o.bind(skeleton, new T.Matrix4());
      } else { o = new T.Mesh(g, omat); o.frustumCulled = false; root.add(o); }
      return o;
    };
    // mouth expression state (updated by selector); geometry UV remapped from the mesh's base UV
    let mouthExprIdx = 0;
    const mouthGeoms = []; // { geo, baseUv, vMin, vMax }
    const morphObjs = []; // { obj, feature } for eye(face)/eyebrow blendshapes
    // base expression name (drop trailing _R/_L half). e.g. "face.face_idle2_R" -> "face.face_idle2"
    const exprBase = (n) => String(n || '').replace(/_[RL]$/, '');
    const exprLabel = (b) => String(b || '').replace(/^face\.face_/, '').replace(/^eyebrow\.eyebrows_/, '').replace(/^face\./, '').replace(/^eyebrow\./, '');
    const applyMouthExpr = (idx) => {
      mouthExprIdx = idx;
      const e = MOUTH_EXPRESSIONS[idx] || MOUTH_EXPRESSIONS[0];
      for (const mg of mouthGeoms) {
        const uv = remapMouthUV(mg.baseUv, mg.vMin, mg.vMax, e[1], e[2]);
        mg.geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
        mg.geo.attributes.uv.needsUpdate = true;
      }
    };

    const root = new T.Group();
    scene.add(root);

    // shared skeleton bones
    let skelBones = null;
    if (skinnable) {
      const sk = buildSkeleton(model.avatar);
      skelBones = sk.bones;
      for (const rb of sk.roots) root.add(rb);
    }

    // framing box from bind-pose vertex positions
    const box = new T.Box3();
    const tmpV = new T.Vector3();
    for (const m of model.meshes) { for (let i = 0; i < m.positions.length; i += 3) box.expandByPoint(tmpV.set(m.positions[i], m.positions[i + 1], m.positions[i + 2])); }
    const center = box.getCenter(new T.Vector3());
    const size = box.getSize(new T.Vector3());
    const radius = Math.max(size.x, size.y, size.z) || 1;

    const stats = { meshes: 0, textured: 0, submeshes: 0, skinned: 0 };
    const meshGroups = {};
    const renderers = (model.renderers && model.renderers.length) ? model.renderers : model.meshes.map((m) => ({ meshPathID: m.pathID, materialPathIDs: [] }));
    let added = 0;
    for (const r of renderers) {
      const mesh = meshByPath.get(r.meshPathID);
      if (!mesh) continue;
      const firstMat = r.materialPathIDs && r.materialPathIDs[0] ? modelMatByPath.get(r.materialPathIDs[0]) : null;
      const isMouth = /mouth/i.test((firstMat && firstMat.name) || mesh.name || '');
      if (isMouth && !mouthAtlasTex) continue; // no shared mouth atlas available -> skip (avoids a solid color patch)
      const isMouthMesh = isMouth && mouthAtlasTex;
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(mesh.positions, 3));
      if (mesh.normals) geo.setAttribute('normal', new T.BufferAttribute(mesh.normals, 3));
      if (mesh.uv) {
        if (isMouthMesh) {
          let vMin = Infinity, vMax = -Infinity;
          for (let i = 1; i < mesh.uv.length; i += 2) { const v = mesh.uv[i]; if (v < vMin) vMin = v; if (v > vMax) vMax = v; }
          const e = MOUTH_EXPRESSIONS[mouthExprIdx] || MOUTH_EXPRESSIONS[0];
          geo.setAttribute('uv', new T.BufferAttribute(remapMouthUV(mesh.uv, vMin, vMax, e[1], e[2]), 2));
          mouthGeoms.push({ geo, baseUv: mesh.uv, vMin, vMax });
        } else {
          geo.setAttribute('uv', new T.BufferAttribute(mesh.uv, 2));
        }
      }
      geo.setIndex(new T.BufferAttribute(mesh.indices, 1));
      if (!mesh.normals) geo.computeVertexNormals();

      // blendshapes -> morph targets (set before Mesh construction so influences/dictionary are built)
      let morphFeature = null;
      if (mesh.blendShapes && mesh.blendShapes.length) {
        const morphs = mesh.blendShapes.map((bs) => { const a = new T.BufferAttribute(bs.deltas, 3); a.name = bs.name; return a; });
        geo.morphAttributes.position = morphs;
        geo.morphTargetsRelative = true;
        const cn = mesh.blendShapes[0].name || '';
        if (/^face\./.test(cn)) morphFeature = 'face';
        else if (/^eyebrow\./.test(cn)) morphFeature = 'brow';
      }

      const useSkin = skinnable && mesh.skinIndex && mesh.boneNameHashes && mesh.bindposes;
      if (useSkin) {
        geo.setAttribute('skinIndex', new T.Uint16BufferAttribute(mesh.skinIndex, 4));
        geo.setAttribute('skinWeight', new T.Float32BufferAttribute(mesh.skinWeight, 4));
      }

      const subs = mesh.submeshes && mesh.submeshes.length ? mesh.submeshes : [{ indexStart: 0, indexCount: mesh.indices.length }];
      const mats = [];
      subs.forEach((sm, i) => {
        geo.addGroup(sm.indexStart, sm.indexCount, i);
        const pid = r.materialPathIDs[i] || r.materialPathIDs[0];
        const modelMat = pid ? modelMatByPath.get(pid) : null;
        const mat = getMat(modelMat);
        if (mat.map) stats.textured++;
        mats.push(mat); stats.submeshes++;
      });
      const material = mats.length === 1 ? mats[0] : mats;

      let obj, objSkeleton = null;
      if (useSkin) {
        const meshBones = mesh.boneNameHashes.map((h) => skelBones[model.avatar.hashToIndex.get(h >>> 0)]).filter(Boolean);
        if (meshBones.length === mesh.boneNameHashes.length) {
          const boneInverses = mesh.bindposes.map(mat4FromBindpose);
          objSkeleton = new T.Skeleton(meshBones, boneInverses);
          obj = new T.SkinnedMesh(geo, material);
          obj.frustumCulled = false;
          root.add(obj);
          // pass an explicit (identity) bind matrix: without it SkinnedMesh.bind() calls
          // skeleton.calculateInverses(), overwriting our real bindposes with identity (bones are at rest here)
          obj.bind(objSkeleton, new T.Matrix4());
          stats.skinned++;
        }
      }
      if (!obj) { obj = new T.Mesh(geo, material); obj.frustumCulled = false; root.add(obj); }
      if (morphFeature && obj.morphTargetInfluences) morphObjs.push({ obj, feature: morphFeature });
      // categorize meshes so the game's contextual-only props (flags, presents, effects) don't clutter the idle view:
      //  - base: body/face/hair (always shown)
      //  - outfit: attachments skinned into the outfit via mat_body/mat_head with many bones (wings, capes) -> shown
      //  - prop: attachments with a dedicated mat_attachment, or few-bone effects -> hidden by default, toggleable
      const nm = (mesh.name || '').toLowerCase();
      const boneCount = mesh.boneNameHashes ? mesh.boneNameHashes.length : 0;
      const matName = (firstMat && firstMat.name || '').toLowerCase();
      let cat = 'base';
      if (/attachment/.test(nm)) {
        const outfitMat = /^mat_(body|head|eyes|eyebrows)$/.test(matName);
        cat = (outfitMat && boneCount >= 20) ? 'outfit' : 'prop';
      }
      (meshGroups[cat] || (meshGroups[cat] = [])).push(obj);
      if (cat === 'prop') obj.visible = false;
      // toon outline for solid body/outfit meshes (skip the flat mouth atlas). Added to the same group so
      // the visibility toggle hides the outline with its mesh.
      if (shadeMode === 'toon' && (cat === 'base' || cat === 'outfit') && !isMouthMesh) {
        const ol = makeOutline(mesh, !!objSkeleton, objSkeleton);
        if (ol) { ol.visible = obj.visible; meshGroups[cat].push(ol); }
      }
      added++; stats.meshes++;
    }

    // equipped weapons: rigid meshes (no bones) parented to the character's weapon bone.
    // Slot (e.g. "wp_2") maps to the TOS path ".../Weapon_R/wp_2"; the bone drives placement via animation.
    if (options.weapons && options.weapons.length && skelBones && model.avatar) {
      const boneBySlot = (slot) => {
        const re = new RegExp('/' + slot + '$');
        for (const [h, pth] of model.avatar.tos) { if (re.test(pth)) { const bi = model.avatar.hashToIndex.get(h >>> 0); return (bi != null && skelBones[bi]) || null; } }
        return null;
      };
      for (const w of options.weapons) {
        if (!w.model || !w.model.meshes || !w.model.meshes.length) continue;
        const bone = boneBySlot(w.slot || 'wp_2');
        const wTex = buildTextureMap(w.materials || { materials: [], textures: [] });
        // weapon root GameObject carries a local transform (all weapons: 180° Y rotation) that orients the
        // mesh relative to the bone. Apply it (plus the master AssetConfiguration Scale); identity is wrong.
        const wroot = (w.model.transforms || []).find((t) => t.fatherPathID === '0' || t.fatherPathID === 0);
        for (const mesh of w.model.meshes) {
          const geo = new T.BufferGeometry();
          geo.setAttribute('position', new T.BufferAttribute(mesh.positions, 3));
          if (mesh.normals) geo.setAttribute('normal', new T.BufferAttribute(mesh.normals, 3));
          if (mesh.uv) geo.setAttribute('uv', new T.BufferAttribute(mesh.uv, 2));
          geo.setIndex(new T.BufferAttribute(mesh.indices, 1));
          if (!mesh.normals) geo.computeVertexNormals();
          const wmName = (w.model.materials && w.model.materials[0] && w.model.materials[0].name) || 'mat_weapon';
          const wt = wTex.byName.get(wmName) || wTex.fallback;
          const params = { side: T.DoubleSide };
          if (wt) params.map = makeDataTexture(wt); else params.color = new T.Color(0xcccccc);
          let wmat;
          if (litMode) { params.roughness = 0.9; params.metalness = 0.0; wmat = new T.MeshStandardMaterial(params); }
          else wmat = new T.MeshBasicMaterial(params);
          const wobj = new T.Mesh(geo, wmat);
          wobj.frustumCulled = false;
          const s = w.scale || 1;
          if (wroot) {
            wobj.position.set(wroot.pos[0], wroot.pos[1], wroot.pos[2]);
            wobj.quaternion.set(wroot.rot[0], wroot.rot[1], wroot.rot[2], wroot.rot[3]);
            wobj.scale.set(wroot.scale[0] * s, wroot.scale[1] * s, wroot.scale[2] * s);
          } else if (s !== 1) wobj.scale.setScalar(s);
          if (bone) bone.add(wobj); else root.add(wobj);
          (meshGroups.weapon || (meshGroups.weapon = [])).push(wobj);
          added++; stats.meshes++;
        }
      }
    }
    if (!added) return { ok: false, reason: 'no-renderable-mesh' };

    // center via camera target (root stays at origin so skinning space is unchanged)
    const state = { yaw: 0, pitch: 0.05, dist: radius * 2.2, target: center.clone() };
    const applyCam = () => {
      camera.position.set(
        state.target.x + state.dist * Math.cos(state.pitch) * Math.sin(state.yaw),
        state.target.y + state.dist * Math.sin(state.pitch),
        state.target.z + state.dist * Math.cos(state.pitch) * Math.cos(state.yaw)
      );
      camera.lookAt(state.target);
    };
    applyCam();

    // ---- animation ---- play the selected clip on a simple loop.
    let mixer = null, action = null, playing = true;
    const fps = 60;
    const clips = (skinnable && model.clips && model.clips.length) ? model.clips : [];
    const threeClipCache = new Map();
    const getThreeClip = (idx) => { if (!threeClipCache.has(idx)) threeClipCache.set(idx, buildThreeClip(clips[idx], fps)); return threeClipCache.get(idx); };
    const playClip = (idx) => {
      if (!clips.length) return;
      if (!mixer) mixer = new T.AnimationMixer(root);
      if (action) action.stop();
      action = mixer.clipAction(getThreeClip(idx));
      action.reset(); action.setLoop(T.LoopRepeat, Infinity); action.play();
      mixer.update(0);
      playing = true; if (playBtn) playBtn.textContent = '⏸';
    };
    // "棒立ち" pose: stop animation and reset bones to the skeleton rest (DefaultPose).
    const restPose = () => {
      if (mixer) mixer.stopAllAction();
      action = null;
      if (skelBones && model.avatar && model.avatar.defPose) {
        for (let i = 0; i < skelBones.length; i++) {
          const dp = model.avatar.defPose[i], b = skelBones[i]; if (!dp || !b) continue;
          b.position.set(dp.t[0], dp.t[1], dp.t[2]); b.quaternion.set(dp.q[0], dp.q[1], dp.q[2], dp.q[3]); b.scale.set(dp.s[0], dp.s[1], dp.s[2]);
        }
      }
      if (playBtn) playBtn.textContent = '▶';
    };

    if (clips.length) {
      clipSelect = document.createElement('select');
      clipSelect.className = 'model3d-clip';
      clips.forEach((c, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = `${c.name} (${c.duration.toFixed(1)}s)`; clipSelect.appendChild(o); });
      const POSE_VAL = '__boon';
      const poseOpt = document.createElement('option'); poseOpt.value = POSE_VAL; poseOpt.textContent = '⊂二二二( ^ω^)二⊃ブーン'; clipSelect.appendChild(poseOpt);
      const prefer = clips.findIndex((c) => /^idle$/i.test(c.name));
      const defIdx = prefer >= 0 ? prefer : 0;
      clipSelect.value = String(defIdx);
      clipSelect.addEventListener('change', () => { if (clipSelect.value === POSE_VAL) restPose(); else playClip(Number(clipSelect.value)); });
      playBtn = document.createElement('button');
      playBtn.className = 'model3d-play'; playBtn.textContent = '⏸';
      playBtn.addEventListener('click', () => { if (!action) return; playing = !playing; action.paused = !playing; playBtn.textContent = playing ? '⏸' : '▶'; });
      const lbl = document.createElement('span'); lbl.className = 'model3d-lbl'; lbl.textContent = 'モーション';
      bar.appendChild(lbl); bar.appendChild(clipSelect); bar.appendChild(playBtn);
      playClip(defIdx);
    }
    // fullscreen toggle: fullscreen the whole 3D host (keeps controls) and resize the renderer to fill.
    // Pinned to the host's top-right corner (not in the wrapping control bar).
    hostEl.style.position = 'relative';
    const fsBtn = document.createElement('button'); fsBtn.className = 'model3d-play'; fsBtn.textContent = '⛶'; fsBtn.title = '全画面';
    fsBtn.style.cssText = 'position:absolute;top:8px;right:8px;z-index:5';
    fsBtn.addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else if (hostEl.requestFullscreen) hostEl.requestFullscreen(); });
    hostEl.appendChild(fsBtn);
    const onFsChange = () => {
      const fs = document.fullscreenElement === hostEl;
      const w = fs ? (hostEl.clientWidth || W) : W;
      const h = fs ? Math.max(120, (hostEl.clientHeight || H) - bar.offsetHeight - 10) : H;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    document.addEventListener('fullscreenchange', onFsChange);
    const shuffleTargets = []; // { sel, apply } for the random-shuffle button
    // mouth expression selector (shared atlas). Options labelled by their cell number (1..N).
    if (mouthGeoms.length && mouthAtlasTex) {
      const lbl = document.createElement('span'); lbl.className = 'model3d-lbl'; lbl.textContent = '口';
      const sel = document.createElement('select'); sel.className = 'model3d-clip';
      MOUTH_EXPRESSIONS.forEach((e, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = String(i + 1); sel.appendChild(o); });
      sel.value = '0';
      const apply = () => applyMouthExpr(Number(sel.value));
      sel.addEventListener('change', apply);
      bar.appendChild(lbl); bar.appendChild(sel);
      shuffleTargets.push({ sel, apply });
    }
    // eye/eyebrow blendshape expression selectors. Expressions are split into _R/_L halves; a selection
    // sets influence=1 on every channel sharing the chosen base name (both halves) and 0 on the rest.
    const applyExpr = (feature, base) => {
      for (const mt of morphObjs) {
        if (mt.feature !== feature) continue;
        const infl = mt.obj.morphTargetInfluences; const dict = mt.obj.morphTargetDictionary || {};
        if (!infl) continue;
        for (let i = 0; i < infl.length; i++) infl[i] = 0;
        if (base) for (const nm in dict) { if (exprBase(nm) === base) infl[dict[nm]] = 1; }
      }
    };
    const addExprSelector = (feature, labelText) => {
      const bases = [];
      for (const mt of morphObjs) {
        if (mt.feature !== feature) continue;
        for (const nm in (mt.obj.morphTargetDictionary || {})) { const b = exprBase(nm); if (!bases.includes(b)) bases.push(b); }
      }
      if (!bases.length) return;
      const lbl = document.createElement('span'); lbl.className = 'model3d-lbl'; lbl.textContent = labelText;
      const sel = document.createElement('select'); sel.className = 'model3d-clip';
      const none = document.createElement('option'); none.value = ''; none.textContent = '0'; sel.appendChild(none);
      bases.forEach((b, i) => { const o = document.createElement('option'); o.value = b; o.textContent = String(i + 1); sel.appendChild(o); });
      sel.value = '';
      const apply = () => applyExpr(feature, sel.value);
      sel.addEventListener('change', apply);
      bar.appendChild(lbl); bar.appendChild(sel);
      shuffleTargets.push({ sel, apply });
    };
    addExprSelector('face', '目');
    addExprSelector('brow', '眉');
    // random shuffle: pick a random option for every face-part selector (mouth/eyes/eyebrows) at once
    if (shuffleTargets.length) {
      const shBtn = document.createElement('button'); shBtn.className = 'model3d-play'; shBtn.textContent = '🎲';
      shBtn.title = 'ランダム表情';
      shBtn.addEventListener('click', () => {
        for (const t of shuffleTargets) {
          const opts = t.sel.options; if (!opts.length) continue;
          t.sel.selectedIndex = Math.floor(Math.random() * opts.length);
          t.apply();
        }
      });
      bar.appendChild(shBtn);
    }
    // line break: motion/expression controls on row 1, 描画/服装/表示トグル wrap to row 2
    { const brk = document.createElement('div'); brk.style.cssText = 'flex-basis:100%;height:0'; bar.appendChild(brk); }
    // shading mode selector (toon = cel + outline, closest to the game / unlit / 標準PBR)
    if (options.shading && typeof options.shading.onChange === 'function') {
      const lbl = document.createElement('span'); lbl.className = 'model3d-lbl'; lbl.textContent = '描画';
      const sel = document.createElement('select'); sel.className = 'model3d-clip';
      [['toon', 'トゥーン'], ['unlit', 'アンリット'], ['pbr', '標準']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); });
      sel.value = shadeMode;
      sel.addEventListener('change', () => options.shading.onChange(sel.value));
      bar.appendChild(lbl); bar.appendChild(sel);
    }
    // costume (material variation) selector — only when the character has >1 downloaded variation.
    // Switching re-parses a different materials bundle from disk, which lives in the caller, so it's driven
    // by a callback (options.costume.onChange) rather than done in-place here.
    if (options.costume && options.costume.list && options.costume.list.length > 1) {
      const label = (v) => (v === 'default' ? '標準' : v === 'default_g' ? '標準(金)' : v);
      const lbl = document.createElement('span'); lbl.className = 'model3d-lbl'; lbl.textContent = '服装';
      const sel = document.createElement('select'); sel.className = 'model3d-clip';
      options.costume.list.forEach((v) => { const o = document.createElement('option'); o.value = v; o.textContent = label(v); sel.appendChild(o); });
      sel.value = options.costume.current;
      sel.addEventListener('change', () => { if (typeof options.costume.onChange === 'function') options.costume.onChange(sel.value); });
      bar.appendChild(lbl); bar.appendChild(sel);
    }
    // mesh group visibility toggles (outfit / weapons / props)
    const GROUP_LABELS = { base: '本体', outfit: '装飾', weapon: '武器', prop: '小物' };
    for (const cat of ['base', 'outfit', 'weapon', 'prop']) {
      const objs = meshGroups[cat];
      if (!objs || !objs.length) continue;
      const lab = document.createElement('label'); lab.className = 'model3d-toggle';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = objs[0].visible;
      cb.addEventListener('change', () => { for (const o of objs) o.visible = cb.checked; });
      lab.appendChild(cb); lab.appendChild(document.createTextNode(GROUP_LABELS[cat] || cat));
      bar.appendChild(lab);
    }
    if (!bar.childNodes.length) bar.style.display = 'none';

    // ---- interaction ---- (left drag = orbit, right/middle drag = pan, wheel = zoom)
    let dragging = false, panning = false, lx = 0, ly = 0;
    const el = renderer.domElement;
    el.style.touchAction = 'none'; el.style.cursor = 'grab';
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      lx = e.clientX; ly = e.clientY;
      if (e.button === 2 || e.button === 1) { panning = true; el.style.cursor = 'move'; }
      else { dragging = true; el.style.cursor = 'grabbing'; }
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointerup', (e) => { dragging = false; panning = false; el.style.cursor = 'grab'; try { el.releasePointerCapture(e.pointerId); } catch (x) {} });
    el.addEventListener('pointermove', (e) => {
      const dx = e.clientX - lx, dy = e.clientY - ly;
      if (dragging) {
        state.yaw -= dx * 0.01;
        state.pitch += dy * 0.01;
        state.pitch = Math.max(-1.4, Math.min(1.4, state.pitch));
        lx = e.clientX; ly = e.clientY; applyCam();
      } else if (panning) {
        // move the orbit target in the camera's right/up plane
        const panScale = state.dist * 0.0018;
        const right = new T.Vector3().setFromMatrixColumn(camera.matrix, 0);
        const up = new T.Vector3().setFromMatrixColumn(camera.matrix, 1);
        state.target.addScaledVector(right, -dx * panScale);
        state.target.addScaledVector(up, dy * panScale);
        lx = e.clientX; ly = e.clientY; applyCam();
      }
    });
    el.addEventListener('wheel', (e) => { e.preventDefault(); state.dist *= (1 + Math.sign(e.deltaY) * 0.1); state.dist = Math.max(radius * 0.5, Math.min(radius * 8, state.dist)); applyCam(); }, { passive: false });

    let alive = true;
    let lastT = (globalThis.performance && performance.now()) ? performance.now() : 0;
    const loop = () => {
      if (!alive) return;
      const now = (globalThis.performance && performance.now()) ? performance.now() : lastT + 16;
      const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
      if (mixer && playing && action) mixer.update(dt);
      renderer.render(scene, camera);
      globalThis.requestAnimationFrame(loop);
    };
    loop();

    const dispose = () => {
      alive = false;
      document.removeEventListener('fullscreenchange', onFsChange);
      if (document.fullscreenElement === hostEl) { try { document.exitFullscreen(); } catch (e) {} }
      if (mixer) mixer.stopAllAction();
      renderer.dispose();
      texCache.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
      root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      if (renderer.domElement && renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };

    return { ok: true, stats, animated: clips.length > 0, clipNames: clips.map((c) => c.name), bbox: { min: box.min.toArray(), max: box.max.toArray() }, dispose };
  }

  globalThis.TP_MODEL3D = { render };
})();
