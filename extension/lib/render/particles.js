'use strict';
// TP_PARTICLES — Unity ParticleSystem(VFX)を読取りthree.jsで忠実エミュレートする(オーラ描画)。
// バンドルのParticleSystem(198)+ParticleSystemRenderer(199)をSF.readObjectで構造取得→各モジュールを評価しながら
// 粒子をシミュレート/描画。MinMaxCurve/MinMaxGradient/Hermite曲線を実機同様に評価する。
(function () {
  const THREE = () => globalThis.THREE;

  // テクスチャ未解決時のフォールバック＝soft radial glow(加算)。孫依存/手続き材でbuildTexMapが解決できない材に使う。
  let _glowTex = null;
  function glowTexture(T) {
    if (_glowTex) return _glowTex;
    const S = 64, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    _glowTex = new T.CanvasTexture(cv); _glowTex.minFilter = T.LinearFilter; _glowTex.magFilter = T.LinearFilter;
    return _glowTex;
  }

  // ---- 評価器 -------------------------------------------------------------
  // Unity AnimationCurve(Hermite/3次)。keyframe={time,value,inSlope,outSlope}。
  function evalCurve(curve, t) {
    const ks = (curve && curve.m_Curve) || [];
    if (!ks.length) return 0;
    if (ks.length === 1) return ks[0].value;
    if (t <= ks[0].time) return ks[0].value;
    if (t >= ks[ks.length - 1].time) return ks[ks.length - 1].value;
    let i = 0; while (i < ks.length - 1 && ks[i + 1].time < t) i++;
    const a = ks[i], b = ks[i + 1];
    const dt = b.time - a.time; if (dt <= 1e-9) return a.value;
    const u = (t - a.time) / dt;
    const u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    return h00 * a.value + h10 * dt * (a.outSlope || 0) + h01 * b.value + h11 * dt * (b.inSlope || 0);
  }
  // MinMaxCurve: minMaxState 0=定数(scalar) 1=曲線(scalar*max曲線) 2=2曲線ランダム3=2定数ランダム。
  function evalMMCurve(mm, t, rnd) {
    if (!mm) return 0;
    const st = mm.minMaxState;
    if (st === 1) return (mm.scalar || 0) * evalCurve(mm.maxCurve, t);
    if (st === 2) { const a = (mm.scalar || 0) * evalCurve(mm.maxCurve, t), b = (mm.scalar || 0) * evalCurve(mm.minCurve, t); return b + (a - b) * (rnd == null ? 0.5 : rnd); }
    if (st === 3) { const a = mm.scalar || 0, b = mm.minScalar || 0; return b + (a - b) * (rnd == null ? Math.random() : rnd); }
    return mm.scalar || 0;
  }
  // 生成時サンプル(t=0固定・ランダムは粒子毎に固定)。
  const sampleMM = (mm, rnd) => evalMMCurve(mm, 0, rnd);

  // MinMaxGradient(maxGradient): color/alphaキー(ctime/atime÷65535)を線形補間。out=[r,g,b,a]。
  function evalGradient(g, t, out) {
    out = out || [1, 1, 1, 1];
    if (!g) { out[0] = out[1] = out[2] = out[3] = 1; return out; }
    const nc = g.m_NumColorKeys || 0, na = g.m_NumAlphaKeys || 0;
    // color
    let r = 1, gg = 1, b = 1;
    if (nc > 0) {
      const tt = t * 65535;
      let i = 0; while (i < nc - 1 && g['ctime' + (i + 1)] < tt) i++;
      const c0 = g['key' + i], t0 = g['ctime' + i];
      if (i >= nc - 1) { r = c0.r; gg = c0.g; b = c0.b; }
      else { const c1 = g['key' + (i + 1)], t1 = g['ctime' + (i + 1)]; const u = t1 > t0 ? (tt - t0) / (t1 - t0) : 0; r = c0.r + (c1.r - c0.r) * u; gg = c0.g + (c1.g - c0.g) * u; b = c0.b + (c1.b - c0.b) * u; }
    }
    // alpha
    let a = 1;
    if (na > 0) {
      const tt = t * 65535;
      let i = 0; while (i < na - 1 && g['atime' + (i + 1)] < tt) i++;
      const a0 = g['key' + i].a, t0 = g['atime' + i];
      if (i >= na - 1) a = a0;
      else { const a1 = g['key' + (i + 1)].a, t1 = g['atime' + (i + 1)]; const u = t1 > t0 ? (tt - t0) / (t1 - t0) : 0; a = a0 + (a1 - a0) * u; }
    }
    out[0] = r; out[1] = gg; out[2] = b; out[3] = a; return out;
  }
  // MinMaxGradient全体(色モード): m_Mode/minMaxStateで単色orグラデ。startColor用。
  function evalMMGradient(mm, t, out) {
    out = out || [1, 1, 1, 1];
    if (!mm) { out[0] = out[1] = out[2] = out[3] = 1; return out; }
    const st = mm.minMaxState;
    if (st === 1 || st === 3) return evalGradient(mm.maxGradient, t, out);
    if (st === 2 && mm.minColor && mm.maxColor) { // 2色ランダム: t(=粒子rnd)でmin↔max補間
      const a = mm.minColor, b = mm.maxColor, u = t == null ? 0.5 : t;
      out[0] = a.r + (b.r - a.r) * u; out[1] = a.g + (b.g - a.g) * u; out[2] = a.b + (b.b - a.b) * u; out[3] = a.a + (b.a - a.a) * u; return out;
    }
    const c = mm.maxColor || mm.minColor || { r: 1, g: 1, b: 1, a: 1 }; // 単色(0)
    out[0] = c.r; out[1] = c.g; out[2] = c.b; out[3] = c.a; return out;
  }

  // ---- ノイズ(NoiseModule用の3D値ノイズ) ---------------------------------
  // ハッシュベースの平滑値ノイズ[-1,1]。Unityのcurl相当の完全一致でなく、乱流的な揺らぎを与える近似。
  const _fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const _hash = (x, y, z) => { let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (z | 0) * 2147483647 + 0x9e3779b9; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 2147483647.5 - 1; };
  function valueNoise3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = _fade(xf), v = _fade(yf), w = _fade(zf);
    const lerp = (a, b, t) => a + (b - a) * t;
    const c000 = _hash(xi, yi, zi), c100 = _hash(xi + 1, yi, zi), c010 = _hash(xi, yi + 1, zi), c110 = _hash(xi + 1, yi + 1, zi);
    const c001 = _hash(xi, yi, zi + 1), c101 = _hash(xi + 1, yi, zi + 1), c011 = _hash(xi, yi + 1, zi + 1), c111 = _hash(xi + 1, yi + 1, zi + 1);
    return lerp(lerp(lerp(c000, c100, u), lerp(c010, c110, u), v), lerp(lerp(c001, c101, u), lerp(c011, c111, u), v), w);
  }
  // オクターブ合成の1軸ノイズ。seedで軸を分離。
  function fbmNoise(x, y, z, seed, octaves, octMul, octScale) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) { sum += amp * valueNoise3(x * freq + seed, y * freq + seed * 1.7, z * freq + seed * 2.3); norm += amp; amp *= octMul; freq *= octScale; }
    return norm > 0 ? sum / norm : 0;
  }

  // ---- 読取り ------------------------------------------------------------
  // バンドル→ParticleSystem群(モジュール構造そのまま)＋Transform階層＋Renderer＋Mesh参照＋外部マテリアル参照。
  function parseAura(bytes) {
    const D = globalThis.TP_DECODE, SF = globalThis.TP_UNITYSF;
    if (!D || !SF) return null;
    let parsed, meta;
    try { parsed = D.parseUnityFS(bytes); meta = SF.parseSerializedFile(parsed.data); } catch (e) { return null; }
    const read = (o) => { try { return SF.readObject(parsed.data, meta.LE, o); } catch (e) { return null; } };
    // Transform群: pathID→{tr, goId}。fatherを辿ってprefabルート相対の累積ローカル位置を出す(配置用)。
    const trByPath = new Map(), trByGo = new Map();
    for (const o of meta.objects) if (o.classID === 4) { const tr = read(o); if (tr) { trByPath.set(String(o.pathID), tr); trByGo.set(String(tr.m_GameObject && tr.m_GameObject.m_PathID), { tr, pid: String(o.pathID) }); } }
    const worldPos = (trPid) => {
      const p = { x: 0, y: 0, z: 0 }; let cur = trPid, guard = 0;
      while (cur && cur !== '0' && guard++ < 32) { const tr = trByPath.get(cur); if (!tr) break; const lp = tr.m_LocalPosition || { x: 0, y: 0, z: 0 }; p.x += lp.x || 0; p.y += lp.y || 0; p.z += lp.z || 0; cur = String(tr.m_Father && tr.m_Father.m_PathID); }
      return p;
    };
    // クォータニオン積a*b。fatherを辿ってworld = father*…*selfを合成(shape/mesh向きの忠実化に使う)。
    const quatMul = (a, b) => ({ x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x, z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z });
    const worldRot = (trPid) => {
      let q = { x: 0, y: 0, z: 0, w: 1 }; let cur = trPid, guard = 0;
      while (cur && cur !== '0' && guard++ < 32) { const tr = trByPath.get(cur); if (!tr) break; const lq = tr.m_LocalRotation || { x: 0, y: 0, z: 0, w: 1 }; q = quatMul(lq, q); cur = String(tr.m_Father && tr.m_Father.m_PathID); }
      return q;
    };
    const systems = [];
    for (const o of meta.objects) {
      if (o.classID !== 198) continue;
      const ps = read(o); if (!ps) continue;
      const goId = String(ps.m_GameObject && ps.m_GameObject.m_PathID);
      const trEnt = trByGo.get(goId);
      let rend = null;
      for (const r of meta.objects) { if (r.classID !== 199) continue; const rr = read(r); if (rr && String(rr.m_GameObject && rr.m_GameObject.m_PathID) === goId) { rend = rr; break; } }
      const matPid = rend && rend.m_Materials ? String((Array.isArray(rend.m_Materials) ? rend.m_Materials[0] : rend.m_Materials).m_PathID) : null;
      systems.push({ ps, objPid: String(o.pathID), pos: trEnt ? worldPos(trEnt.pid) : { x: 0, y: 0, z: 0 }, rot: trEnt ? worldRot(trEnt.pid) : { x: 0, y: 0, z: 0, w: 1 }, renderMode: rend ? rend.m_RenderMode : 0, matPid });
    }
    let meshGeo = null;
    for (const o of meta.objects) if (o.classID === 43) { const mo = read(o); if (mo && globalThis.TP_MESH && globalThis.TP_MESH.extractMeshGeometry) { try { meshGeo = globalThis.TP_MESH.extractMeshGeometry(mo, meta.LE); } catch (e) {} } break; }
    return { systems, meshGeo, unityVersion: meta.unityVersion };
  }

  // ---- 描画バックエンド ---------------------------------------------------
  // renderMode=4(Mesh): VFXメッシュのInstancedMesh。per-instance=行列(位置/euler回転/3軸scale)＋instanceColor(rgb×alpha)。
  function makeMeshBackend(T, maxP, P, meshGeo, tex) {
    const bg = new T.BufferGeometry();
    bg.setAttribute('position', new T.BufferAttribute(meshGeo.positions, 3));
    if (meshGeo.normals) bg.setAttribute('normal', new T.BufferAttribute(meshGeo.normals, 3));
    if (meshGeo.uv) bg.setAttribute('uv', new T.BufferAttribute(meshGeo.uv, 2));
    if (meshGeo.indices) bg.setIndex(new T.BufferAttribute(meshGeo.indices, 1));
    const mat = new T.MeshBasicMaterial({ map: tex || null, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide });
    const im = new T.InstancedMesh(bg, mat, maxP); im.frustumCulled = false; im.count = 0;
    im.instanceColor = new T.InstancedBufferAttribute(new Float32Array(maxP * 3), 3);
    const dm = new T.Object3D();
    return {
      mesh: im,
      writeInst: (n, i, sm, col) => { dm.position.set(P.px[i], P.py[i], P.pz[i]); dm.rotation.set(P.rx[i], P.ry[i], P.rz[i]); dm.scale.set(P.sx[i] * sm[0], P.sy[i] * sm[1], P.sz[i] * sm[2]); dm.updateMatrix(); im.setMatrixAt(n, dm.matrix); im.instanceColor.setXYZ(n, col[0] * col[3], col[1] * col[3], col[2] * col[3]); },
      commit: (n) => { im.count = n; im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; },
      dispose: () => { bg.dispose(); mat.dispose(); },
    };
  }
  // 他(billboard): カメラ正対quadを加算合成。UVシートアニメ時はタイルoffset/scaleでサブ矩形を参照。
  function makeBillboardBackend(T, maxP, P, tex, uv) {
    const geo = new T.InstancedBufferGeometry(); const quad = new T.PlaneGeometry(1, 1);
    geo.index = quad.index; geo.attributes.position = quad.attributes.position; geo.attributes.uv = quad.attributes.uv;
    const iOffset = new Float32Array(maxP * 3), iColor = new Float32Array(maxP * 4), iSize = new Float32Array(maxP * 2), iRot = new Float32Array(maxP), iUvOff = new Float32Array(maxP * 2);
    geo.setAttribute('iOffset', new T.InstancedBufferAttribute(iOffset, 3)); geo.setAttribute('iColor', new T.InstancedBufferAttribute(iColor, 4));
    geo.setAttribute('iSize', new T.InstancedBufferAttribute(iSize, 2)); geo.setAttribute('iRot', new T.InstancedBufferAttribute(iRot, 1));
    geo.setAttribute('iUvOff', new T.InstancedBufferAttribute(iUvOff, 2));
    geo.instanceCount = 0;
    const uvScale = uv.on ? [1 / uv.tilesX, 1 / uv.tilesY] : [1, 1];
    const mat = new T.ShaderMaterial({ uniforms: { uTex: { value: tex || glowTexture(T) }, uUvScale: { value: new T.Vector2(uvScale[0], uvScale[1]) } }, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
      vertexShader: 'attribute vec3 iOffset;attribute vec4 iColor;attribute vec2 iSize;attribute float iRot;attribute vec2 iUvOff;varying vec2 vUv;varying vec4 vCol;varying vec2 vUvOff;void main(){vUv=uv;vUvOff=iUvOff;vCol=iColor;vec3 p=position;float c=cos(iRot),s=sin(iRot);vec2 r=vec2(p.x*c-p.y*s,p.x*s+p.y*c)*iSize;vec4 mv=modelViewMatrix*vec4(iOffset,1.0);mv.xy+=r;gl_Position=projectionMatrix*mv;}',
      fragmentShader: 'uniform sampler2D uTex;uniform vec2 uUvScale;varying vec2 vUv;varying vec4 vCol;varying vec2 vUvOff;void main(){vec2 uv=vUv*uUvScale+vUvOff;vec4 t=texture2D(uTex,uv);gl_FragColor=vec4(vCol.rgb*t.rgb,vCol.a*t.a);}' });
    const mesh = new T.Mesh(geo, mat); mesh.frustumCulled = false;
    return {
      mesh,
      writeInst: (n, i, sm, col) => { const o = n * 3, c = n * 4, s = n * 2, u = n * 2; iOffset[o] = P.px[i]; iOffset[o + 1] = P.py[i]; iOffset[o + 2] = P.pz[i]; iColor[c] = col[0]; iColor[c + 1] = col[1]; iColor[c + 2] = col[2]; iColor[c + 3] = col[3]; iSize[s] = P.sx[i] * sm[0]; iSize[s + 1] = P.sy[i] * sm[1]; iRot[n] = P.rz[i]; if (uv.on) { const fr = uv.frameOf(i); const fx = fr % uv.tilesX, fy = (fr / uv.tilesX) | 0; iUvOff[u] = fx / uv.tilesX; iUvOff[u + 1] = ((uv.tilesY - 1) - fy) / uv.tilesY; } },
      commit: (n) => { geo.instanceCount = n; geo.attributes.iOffset.needsUpdate = geo.attributes.iColor.needsUpdate = geo.attributes.iSize.needsUpdate = geo.attributes.iRot.needsUpdate = geo.attributes.iUvOff.needsUpdate = true; },
      dispose: () => { geo.dispose(); mat.dispose(); quad.dispose(); },
    };
  }

  // ---- エミュレータ -------------------------------------------------------
  // 1つのParticleSystemをシミュレートしthree.jsで描画。renderMode=4(Mesh)はVFXメッシュのInstancedMesh、他は加算ビルボード。
  // color/size/rotation over-lifetime・emission(burst+rate)・重力を実機評価。
  function createSystem(T, sys, opt) {
    opt = opt || {};
    const ps = sys.ps;
    const init = ps.InitialModule || {}, em = ps.EmissionModule || {};
    const colMod = ps.ColorModule || {}, sizeMod = ps.SizeModule || {};
    const shapeMod = ps.ShapeModule || {}, forceMod = ps.ForceModule || {}, rotMod = ps.RotationModule || {}, velMod = ps.VelocityModule || {}, uvMod = ps.UVModule || {}, noiseMod = ps.NoiseModule || {}, clampMod = ps.ClampVelocityModule || {};
    const shapeOn = !!shapeMod.enabled, forceOn = !!forceMod.enabled, rotOn = !!rotMod.enabled, rotSep = !!rotMod.separateAxes, velOn = !!velMod.enabled, uvOn = !!uvMod.enabled, noiseOn = !!noiseMod.enabled, clampOn = !!clampMod.enabled;
    const sizeSep = !!(sizeMod.enabled && sizeMod.separateAxes); // 3D size over-life(X軸=curve, y, z)
    const clampDampen = clampMod.dampen != null ? clampMod.dampen : 0; // 速度上限超過分の減衰率
    const maxP = Math.max(1, Math.min(2000, (init.maxNumParticles | 0) || 100));
    const looping = ps.looping !== false;
    const duration = ps.lengthInSec || 5;
    const simSpeed = ps.simulationSpeed || 1; // 系統ごとの再生速度倍率(実測8系統が≠1)
    const gravityBase = 9.81;
    const size3D = !!init.size3D, rot3D = !!init.rotation3D;
    const startColor = init.startColor;
    const tex = opt.texture || null;
    const useMesh = sys.renderMode === 4 && opt.meshGeo && opt.meshGeo.positions && opt.meshGeo.positions.length;

    // ---- Shape変換(定数): m_Rotation(Euler ZXY度)・m_Scale・m_Positionを生成位置/方向へ適用 ----
    const D2R = Math.PI / 180;
    const shRotE = shapeMod.m_Rotation || { x: 0, y: 0, z: 0 };
    const shScale = shapeMod.m_Scale || { x: 1, y: 1, z: 1 };
    const shPos = shapeMod.m_Position || { x: 0, y: 0, z: 0 };
    const shapeRotMat = new T.Matrix4().makeRotationFromEuler(new T.Euler(shRotE.x * D2R, shRotE.y * D2R, shRotE.z * D2R, 'ZXY'));
    const shPosV = new T.Vector3(shPos.x || 0, shPos.y || 0, shPos.z || 0);
    const _sp = new T.Vector3(), _sd = new T.Vector3();
    const shType = shapeMod.type | 0;
    const shRadius = (shapeMod.radius && shapeMod.radius.value) || 0;
    const shThick = shapeMod.radiusThickness != null ? shapeMod.radiusThickness : 1; // 0=外殻のみ 1=全体
    const shArc = ((shapeMod.arc && shapeMod.arc.value) || 360) * D2R;
    const shConeAng = (shapeMod.angle || 0) * D2R; // angleは度なのでラジアンへ
    const shLen = shapeMod.length || 0;
    const shDonut = shapeMod.donutRadius || 0;
    // radiusThicknessを面積/体積一様サンプル(内半径=rad*(1-thick))
    const sampleR = () => { const inner = shRadius * (1 - shThick); return Math.sqrt(inner * inner + (shRadius * shRadius - inner * inner) * Math.random()); };
    // 形状に応じた生成位置(o[0..2])と初期方向(o[3..5]・+Y基準)をサンプル。Shape変換は呼び出し側で適用。
    const _e6 = [0, 0, 0, 0, 0, 0];
    const sampleShape = (o) => {
      if (!shapeOn) { o[0] = o[1] = o[2] = 0; const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, rr = Math.sqrt(1 - u * u); o[3] = rr * Math.cos(th); o[4] = u; o[5] = rr * Math.sin(th); return; }
      if (shType === 0 || shType === 1) { // Sphere/SphereShell
        const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, rr = Math.sqrt(1 - u * u), r = sampleR();
        o[3] = rr * Math.cos(th); o[4] = u; o[5] = rr * Math.sin(th); o[0] = r * o[3]; o[1] = r * o[4]; o[2] = r * o[5];
      } else if (shType === 2 || shType === 3) { // Hemisphere(上半球+Y)
        const u = Math.random(), th = Math.random() * Math.PI * 2, rr = Math.sqrt(1 - u * u), r = sampleR();
        o[3] = rr * Math.cos(th); o[4] = u; o[5] = rr * Math.sin(th); o[0] = r * o[3]; o[1] = r * o[4]; o[2] = r * o[5];
      } else if (shType === 10 || shType === 11) { // Circle/CircleEdge(XZ円・外向き)
        const a = Math.random() * shArc, r = sampleR();
        o[3] = Math.cos(a); o[4] = 0; o[5] = Math.sin(a); o[0] = r * o[3]; o[1] = 0; o[2] = r * o[5];
      } else if (shType === 12) { // SingleSidedEdge(X軸ライン・+Y放出)
        o[0] = (Math.random() * 2 - 1) * shRadius; o[1] = 0; o[2] = 0; o[3] = 0; o[4] = 1; o[5] = 0;
      } else if (shType === 17) { // Donut(torus・大半径=radius/小半径=donutRadius)
        const a = Math.random() * shArc, phi = Math.random() * Math.PI * 2, rr = shDonut * Math.sqrt(Math.random());
        const cx = Math.cos(a), cz = Math.sin(a), cp = Math.cos(phi);
        o[0] = (shRadius + rr * cp) * cx; o[1] = rr * Math.sin(phi); o[2] = (shRadius + rr * cp) * cz;
        o[3] = cx * cp; o[4] = Math.sin(phi); o[5] = cz * cp;
      } else { // Cone(4/7)/ConeVolume(8/9)ほか: 底円周から円錐角で+Y上外へ
        const a = Math.random() * shArc, r = sampleR(), sa = Math.sin(shConeAng), ca = Math.cos(shConeAng);
        const cx = Math.cos(a), cz = Math.sin(a);
        o[0] = r * cx; o[1] = 0; o[2] = r * cz; o[3] = cx * sa; o[4] = ca; o[5] = cz * sa;
        if ((shType === 8 || shType === 9) && shLen > 0) { const tt = Math.random() * shLen; o[0] += o[3] * tt; o[1] += o[4] * tt; o[2] += o[5] * tt; } // ConeVolume: 長さ方向に分布
      }
    };

    // ---- UVシートアニメ(billboardのみ): tiles分割・frameOverTimeで進行 ----
    const uvTilesX = Math.max(1, uvMod.tilesX | 0 || 1), uvTilesY = Math.max(1, uvMod.tilesY | 0 || 1);
    const uvAnimType = uvMod.animationType | 0; // 0=WholeSheet 1=SingleRow
    const uvRowIndex = uvMod.rowIndex | 0, uvCycles = uvMod.cycles || 1;
    const uvFrames = uvOn ? (uvAnimType === 1 ? uvTilesX : uvTilesX * uvTilesY) : 1;
    // 粒子iの現フレーム(sheet内通し番号)。frameOverTimeで進行・cycles倍・startFrameオフセット。
    function uvFrameOf(i) {
      const t = P.life[i] > 0 ? P.age[i] / P.life[i] : 0;
      const fnorm = evalMMCurve(uvMod.frameOverTime, t, P.rnd[i]);
      const sf = evalMMCurve(uvMod.startFrame, 0, P.rnd[i]) || 0;
      let frame = Math.floor(fnorm * uvCycles * uvFrames + sf);
      frame = ((frame % uvFrames) + uvFrames) % uvFrames;
      return uvAnimType === 1 ? (uvRowIndex * uvTilesX + frame) : frame; // SingleRowはrowIndex行の列
    }

    // ---- Noise設定 ----
    const nzFreq = noiseMod.frequency || 0.5;
    const nzOct = Math.max(1, Math.min(4, noiseMod.octaves | 0 || 1));
    const nzOctMul = noiseMod.octaveMultiplier != null ? noiseMod.octaveMultiplier : 0.5;
    const nzOctScale = noiseMod.octaveScale != null ? noiseMod.octaveScale : 2;
    const nzSep = !!noiseMod.separateAxes;
    let nzTime = 0; // scrollSpeedで進むノイズ時間

    // ---- sub-emitter用: 生成/死亡イベントの記録＋外部からの位置指定生成 ----
    let selfEmit = true, emitEvents = false, ox = 0, oy = 0, oz = 0;
    const births = [], deaths = [];

    // 粒子プール(共通)
    const P = { age: new Float32Array(maxP), life: new Float32Array(maxP), alive: new Uint8Array(maxP),
      px: new Float32Array(maxP), py: new Float32Array(maxP), pz: new Float32Array(maxP),
      vx: new Float32Array(maxP), vy: new Float32Array(maxP), vz: new Float32Array(maxP),
      sx: new Float32Array(maxP), sy: new Float32Array(maxP), sz: new Float32Array(maxP),
      rx: new Float32Array(maxP), ry: new Float32Array(maxP), rz: new Float32Array(maxP),
      grav: new Float32Array(maxP), rnd: new Float32Array(maxP) };

    // ---- 描画バックエンド ----
    const backend = useMesh
      ? makeMeshBackend(T, maxP, P, opt.meshGeo, tex)
      : makeBillboardBackend(T, maxP, P, tex, { on: uvOn, tilesX: uvTilesX, tilesY: uvTilesY, frameOf: uvFrameOf });
    const mesh = backend.mesh, writeInst = backend.writeInst, disposeFn = backend.dispose;

    // ---- 放出(emission)設定 ----
    const emEnabled = em.enabled !== false;
    const bursts = (em.m_Bursts || []).map((b) => ({ time: b.time || 0, count: b.countCurve, cycles: b.cycleCount == null ? 1 : b.cycleCount, repeat: b.repeatInterval || 0, prob: b.probability == null ? 1 : b.probability }));
    const startDelayV = Math.max(0, sampleMM(ps.startDelay, Math.random()) || 0);
    let emitAcc = 0, sysTime = 0, curLoop = -1;
    const burstFired = new Array(bursts.length).fill(0);
    const rateOver = () => evalMMCurve(em.rateOverTime, 0);
    const spawn = () => {
      let idx = -1; for (let i = 0; i < maxP; i++) if (!P.alive[i]) { idx = i; break; }
      if (idx < 0) return;
      P.alive[idx] = 1; P.age[idx] = 0; const rn = Math.random(); P.rnd[idx] = rn;
      P.life[idx] = Math.max(0.05, sampleMM(init.startLifetime, rn));
      const sx = sampleMM(init.startSize, rn) || 1;
      P.sx[idx] = sx; P.sy[idx] = size3D ? (sampleMM(init.startSizeY, rn) || sx) : sx; P.sz[idx] = size3D ? (sampleMM(init.startSizeZ, rn) || sx) : sx;
      P.rx[idx] = rot3D ? (sampleMM(init.startRotationX, rn) || 0) : 0; P.ry[idx] = rot3D ? (sampleMM(init.startRotationY, rn) || 0) : 0; P.rz[idx] = sampleMM(init.startRotation, rn) || 0;
      P.grav[idx] = sampleMM(init.gravityModifier, rn) || 0;
      const spd = sampleMM(init.startSpeed, rn);
      sampleShape(_e6); // _e6[0..2]=shape-local位置, [3..5]=方向(+Y基準)
      // Shape変換(scale→rotation→position)を位置に、rotationを方向に適用。ox/oy/oz=sub-emitter生成原点。
      _sp.set(_e6[0] * shScale.x, _e6[1] * shScale.y, _e6[2] * shScale.z).applyMatrix4(shapeRotMat).add(shPosV);
      _sd.set(_e6[3], _e6[4], _e6[5]).applyMatrix4(shapeRotMat);
      P.px[idx] = _sp.x + ox; P.py[idx] = _sp.y + oy; P.pz[idx] = _sp.z + oz;
      P.vx[idx] = _sd.x * spd; P.vy[idx] = _sd.y * spd; P.vz[idx] = _sd.z * spd;
      if (emitEvents) births.push(P.px[idx], P.py[idx], P.pz[idx]);
    };
    // sub-emitter: 親粒子の位置(child-local)にcount個生成
    const emitAt = (x, y, z, count) => { ox = x; oy = y; oz = z; for (let k = 0; k < count; k++) spawn(); ox = oy = oz = 0; };

    // 放出処理: burstはループ毎に再発火(repeatInterval/cycleCount/probability尊重)、rateは継続。非ループはduration経過で停止。
    const emit = (dt) => {
      if (!emEnabled || !selfEmit) return; // selfEmit=false: sub-emitter子(親イベントでのみ生成)
      sysTime += dt;
      const local = sysTime - startDelayV; if (local < 0) return;
      const overDur = !looping && local > duration;
      const cycleT = looping ? (local % duration) : Math.min(local, duration);
      if (looping) { const li = Math.floor(local / duration); if (li !== curLoop) { curLoop = li; burstFired.fill(0); } }
      for (let bi = 0; bi < bursts.length; bi++) {
        const bd = bursts[bi];
        const instant = bd.repeat <= 0; // repeatInterval=0はその周期で1発(cycles>1なら同時多発)
        const maxCyc = instant ? 1 : (bd.cycles <= 0 ? 1e9 : bd.cycles);
        const volley = instant && bd.cycles > 1 ? bd.cycles : 1;
        let guard = 0;
        while (burstFired[bi] < maxCyc && guard++ < 4096) {
          const fireT = bd.time + burstFired[bi] * bd.repeat;
          if (cycleT + 1e-6 < fireT || overDur) break;
          if (Math.random() <= bd.prob) { const cnt = (Math.round(sampleMM(bd.count, Math.random())) || 0) * volley; for (let k = 0; k < cnt; k++) spawn(); }
          burstFired[bi]++;
        }
      }
      if (!overDur) { const rate = rateOver(); if (rate > 0) { emitAcc += rate * dt; while (emitAcc >= 1) { spawn(); emitAcc -= 1; } } }
    };

    const tmpCol = [1, 1, 1, 1], scol = [1, 1, 1, 1], _sm = [1, 1, 1];
    const update = (dt) => {
      dt *= simSpeed;
      if (emitEvents) { births.length = 0; deaths.length = 0; }
      emit(dt);
      if (noiseOn) nzTime += evalMMCurve(noiseMod.scrollSpeed, 0) * dt;
      let n = 0;
      for (let i = 0; i < maxP; i++) {
        if (!P.alive[i]) continue;
        P.age[i] += dt; if (P.age[i] >= P.life[i]) { if (emitEvents) deaths.push(P.px[i], P.py[i], P.pz[i]); P.alive[i] = 0; continue; }
        const t = P.age[i] / P.life[i];
        P.vy[i] -= gravityBase * P.grav[i] * dt;
        if (forceOn) { P.vx[i] += evalMMCurve(forceMod.x, t) * dt; P.vy[i] += evalMMCurve(forceMod.y, t) * dt; P.vz[i] += evalMMCurve(forceMod.z, t) * dt; }
        if (rotOn) { if (rotSep) { P.rx[i] += evalMMCurve(rotMod.x, t) * dt; P.ry[i] += evalMMCurve(rotMod.y, t) * dt; } P.rz[i] += evalMMCurve(rotMod.curve, t) * dt; }
        // VelocityOverLifetime＝加速でなく速度の上乗せ(位置に直接寄与)
        let vlx = 0, vly = 0, vlz = 0; if (velOn) { vlx = evalMMCurve(velMod.x, t); vly = evalMMCurve(velMod.y, t); vlz = evalMMCurve(velMod.z, t); }
        // NoiseModule: 3D fbmノイズで乱流変位(strength=速度)。positionAmount/rotationAmount/sizeAmountを尊重。
        let nzSizeF = 1;
        if (noiseOn) {
          const px = P.px[i] * nzFreq, py = P.py[i] * nzFreq, pz = P.pz[i] * nzFreq;
          const nx = fbmNoise(px + nzTime, py, pz, 0, nzOct, nzOctMul, nzOctScale);
          const ny = fbmNoise(px, py + nzTime, pz, 17, nzOct, nzOctMul, nzOctScale);
          const nz = fbmNoise(px, py, pz + nzTime, 43, nzOct, nzOctMul, nzOctScale);
          const sX = evalMMCurve(noiseMod.strength, t), sY = nzSep ? evalMMCurve(noiseMod.strengthY, t) : sX, sZ = nzSep ? evalMMCurve(noiseMod.strengthZ, t) : sX;
          const posAmt = evalMMCurve(noiseMod.positionAmount, t); const pa = posAmt === 0 ? 1 : posAmt;
          vlx += nx * sX * pa; vly += ny * sY * pa; vlz += nz * sZ * pa;
          const rotAmt = evalMMCurve(noiseMod.rotationAmount, t); if (rotAmt) P.rz[i] += nx * rotAmt * dt;
          const szAmt = evalMMCurve(noiseMod.sizeAmount, t); if (szAmt) nzSizeF = Math.max(0, 1 + nx * szAmt);
        }
        // ClampVelocity: 速度上限magnitudeを超えた分をdampenで減衰(drag未実装=使用ほぼ0)
        if (clampOn) { const lim = evalMMCurve(clampMod.magnitude, t); if (lim > 0) { const sp = Math.hypot(P.vx[i], P.vy[i], P.vz[i]); if (sp > lim) { const f = (sp - (sp - lim) * clampDampen) / sp; P.vx[i] *= f; P.vy[i] *= f; P.vz[i] *= f; } } }
        P.px[i] += (P.vx[i] + vlx) * dt; P.py[i] += (P.vy[i] + vly) * dt; P.pz[i] += (P.vz[i] + vlz) * dt;
        evalMMGradient(startColor, P.rnd[i], scol);
        if (colMod.enabled) { evalGradient(colMod.gradient && colMod.gradient.maxGradient, t, tmpCol); scol[0] *= tmpCol[0]; scol[1] *= tmpCol[1]; scol[2] *= tmpCol[2]; scol[3] *= tmpCol[3]; }
        // SizeOverLifetime(separateAxes対応)＋noise sizeAmount
        let smx = 1; if (sizeMod.enabled) smx = evalMMCurve(sizeMod.curve, t) || 1;
        let smy = smx, smz = smx; if (sizeSep) { smy = evalMMCurve(sizeMod.y, t) || 1; smz = evalMMCurve(sizeMod.z, t) || 1; }
        if (nzSizeF !== 1) { smx *= nzSizeF; smy *= nzSizeF; smz *= nzSizeF; }
        _sm[0] = smx; _sm[1] = smy; _sm[2] = smz;
        writeInst(n, i, _sm, scol);
        n++;
      }
      backend.commit(n);
    };
    // prewarm: ループ系は初期状態で既に満ちている想定。1周期分を粗くシミュして満たす。sub-emitter子でない確定後(createAura)に実行。
    const doPrewarm = () => { if (ps.prewarm && looping && duration > 0) { const steps = 30, wdt = duration / steps; for (let k = 0; k < steps; k++) update(wdt); } };
    return {
      mesh, update, dispose: disposeFn, emitAt, births, deaths, doPrewarm,
      setSubDriven: () => { selfEmit = false; }, enableEvents: () => { emitEvents = true; },
    };
  }

  // オーラ全体(複数PS)をGroupにまとめる。
  function createAura(bytes, opt) {
    const T = THREE(); if (!T) return null;
    const data = parseAura(bytes); if (!data || !data.systems.length) return null;
    const group = new T.Group();
    const sims = [];
    const simByPid = new Map(); // objPid→sim(sub-emitter参照解決用)
    const texByMatPid = (opt && opt.texByMatPid) || null;
    for (const sys of data.systems) {
      const so = Object.assign({}, opt || {});
      so.meshGeo = data.meshGeo;
      if (texByMatPid && sys.matPid && texByMatPid.get(sys.matPid)) so.texture = texByMatPid.get(sys.matPid);
      const s = createSystem(T, sys, so);
      s._sys = sys; s._subDriven = false;
      const p = sys.pos || { x: 0, y: 0, z: 0 }; s.mesh.position.set(p.x || 0, p.y || 0, p.z || 0);
      const q = sys.rot; if (q && (q.x || q.y || q.z || q.w !== 1)) s.mesh.quaternion.set(q.x || 0, q.y || 0, q.z || 0, q.w == null ? 1 : q.w);
      if (sys.renderMode !== 5) group.add(s.mesh); // None=描画なし(sub-emitter親)。simは残し発火/シミュは継続
      sims.push(s); if (sys.objPid) simByPid.set(sys.objPid, s);
    }
    // sub-emitter配線: 解決可能な(同バンドル・fileID0)emitter PPtrのみ。type0=Birth/2=Death。子はself-emit停止し親イベントで生成。
    const links = [];
    for (const s of sims) {
      const sub = s._sys.ps.SubModule;
      if (!sub || !sub.enabled || !Array.isArray(sub.subEmitters)) continue;
      for (const se of sub.subEmitters) {
        const type = se.type | 0; if (type !== 0 && type !== 2) continue;
        if (se.emitter && se.emitter.m_FileID) continue; // 別バンドル参照は未対応
        const pid = se.emitter ? String(se.emitter.m_PathID) : '0'; if (pid === '0') continue;
        const child = simByPid.get(pid); if (!child || child === s) continue;
        child.setSubDriven(); child._subDriven = true; s.enableEvents();
        links.push({ parent: s, child, type, prob: se.emitProbability == null ? 1 : se.emitProbability });
      }
    }
    // prewarmはsub-driven確定後に(子は自発生成しない=原点への誤puff回避)
    for (const s of sims) if (!s._subDriven && s.doPrewarm) s.doPrewarm();
    const _wp = new T.Vector3(), _cl = new T.Vector3(), _inv = new T.Matrix4();
    return {
      group,
      update(dt) {
        for (const s of sims) s.update(dt);
        for (const L of links) { // 親のbirth/death位置(親local)→world→child-localへ変換して生成
          const src = L.type === 0 ? L.parent.births : L.parent.deaths; if (!src.length) continue;
          L.parent.mesh.updateMatrix(); L.child.mesh.updateMatrix(); _inv.copy(L.child.mesh.matrix).invert();
          const cnt = L.type === 0 ? 1 : 3;
          for (let k = 0; k + 2 < src.length; k += 3) {
            if (Math.random() > L.prob) continue;
            _wp.set(src[k], src[k + 1], src[k + 2]).applyMatrix4(L.parent.mesh.matrix);
            _cl.copy(_wp).applyMatrix4(_inv); L.child.emitAt(_cl.x, _cl.y, _cl.z, cnt);
          }
        }
      },
      dispose() { for (const s of sims) s.dispose(); },
      systemCount: sims.length,
    };
  }

  // Addressablesカタログ(ContentCatalogData)からprefabの依存バンドルrelパスを解決。
  // KeyData/BucketData/EntryData(base64)を読み、prefabのentry→dependencyKey→bucket→依存entryのinternalId。
  function resolveDeps(catalog, prefabRe) {
    try {
      const b64 = (s) => { const bin = atob(s); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };
      const bd = b64(catalog.m_BucketDataString), ed = b64(catalog.m_EntryDataString);
      const dvB = new DataView(bd.buffer), dvE = new DataView(ed.buffer); const rI = (dv, o) => dv.getInt32(o, true);
      const bc = rI(dvB, 0); let bo = 4; const buckets = [];
      for (let i = 0; i < bc; i++) { const ec = (bo += 4, rI(dvB, bo - 4)); const cnt = rI(dvB, bo); bo += 4; const es = []; for (let k = 0; k < cnt; k++) { es.push(rI(dvB, bo)); bo += 4; } buckets.push(es); }
      const ec2 = rI(dvE, 0); const entries = [];
      for (let i = 0; i < ec2; i++) { const o = 4 + i * 28; entries.push({ iid: rI(dvE, o), depKey: rI(dvE, o + 8) }); }
      const ids = catalog.m_InternalIds || [];
      const auraIid = ids.findIndex((s) => prefabRe.test(String(s)));
      if (auraIid < 0) return [];
      const deps = new Set();
      for (const e of entries) { if (e.iid !== auraIid) continue; if (e.depKey >= 0 && e.depKey < buckets.length) for (const ei of buckets[e.depKey]) { const de = entries[ei]; if (de) deps.add(String(ids[de.iid])); } }
      // internalId(例 "PariPariRemote/vfxmaterials_assets_vfxmaterials/xxx.bundle")→ rel "vfxmaterials_assets_vfxmaterials/xxx.bundle"
      return [...deps].map((s) => { const m = s.match(/([a-z0-9]+_assets_[a-z0-9]+\/[^/]+\.bundle)$/i); return m ? m[1] : null; }).filter(Boolean);
    } catch (e) { return []; }
  }

  // 依存バンドル群(bytes配列)からmaterial pathID→THREE.Textureのマップを作る。
  // materialの _BaseMap/_MainTex(=mainTexPathID)が同梱textureを指すなら厳密ペア。指す先が別バンドル(孫依存)/手続き材ならスキップ(呼び出し側がglow代替)。
  function buildTexMap(T, depBundles) {
    const MESH = globalThis.TP_MESH;
    const map = new Map();
    if (!MESH || !MESH.parseMaterialBundle) return map;
    const mkTex = (t) => { if (!t || !t.rgba) return null; const tx = new T.DataTexture(t.rgba, t.width, t.height, T.RGBAFormat); tx.needsUpdate = true; tx.minFilter = T.LinearFilter; tx.magFilter = T.LinearFilter; if ('colorSpace' in tx) tx.colorSpace = T.SRGBColorSpace || 'srgb'; return tx; };
    for (const bytes of depBundles) {
      if (!bytes) continue;
      let mats, texs; try { const b = MESH.parseMaterialBundle(bytes); mats = b.materials || []; texs = b.textures || []; } catch (e) { continue; }
      if (!mats.length || !texs.length) continue;
      const texByPid = new Map(); // pathID→THREE.Texture(遅延生成)
      const getTex = (pid) => { if (texByPid.has(pid)) return texByPid.get(pid); const t = texs.find((x) => String(x.pathID) === String(pid)); const tx = t ? mkTex(t) : null; texByPid.set(pid, tx); return tx; };
      // 面積最大texを暗黙のfallback(単一tex材向け)
      let primaryPid = null, area = -1; for (const t of texs) { const a = (t.width | 0) * (t.height | 0); if (t.rgba && a > area) { area = a; primaryPid = String(t.pathID); } }
      for (const m of mats) {
        if (map.has(String(m.pathID))) continue;
        let tx = null;
        if (m.mainTexPathID) tx = getTex(m.mainTexPathID); // ★_BaseMap/_MainTexの厳密pathID
        if (!tx && texs.length === 1 && primaryPid) tx = getTex(primaryPid); // 単一texバンドルはそれ
        if (tx) map.set(String(m.pathID), tx);
      }
    }
    return map;
  }

  globalThis.TP_PARTICLES = { parseAura, createAura, resolveDeps, buildTexMap };
})();
