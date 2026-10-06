import * as THREE_NS from '../../../vendor/three.module.js';
import { vfxParse } from './vfx-parse.js';
import { proceduralTex } from './vfx-proctex.js';
import { gameShaders } from '../shaders/game-shaders.js';
import { createShapeSampler, meshPositionsWithPivot } from './vfx-shape.js';
import { keyOnAt } from './vfx-curve.js';
import { genVaryingIO, GAME_VERT_MATCAP, genMeshUvVertex, particleWorldVertex, buildGameUniforms, applyGameBlend, whiteTexture, resolveGameKey, effectiveVaryings, usesRealVertex, realVertexIO } from '../game-shader-util.js';
import { evalMinMaxGradient } from './vfx-gradient.js';
import { evalMinMax, sampleMinMax, mmIsActive } from './vfx-minmax.js';
import { unityNoise, makeNoiseOffsets, remapNoise, noiseRemapOf } from './vfx-noise.js';
import { createSpinNodes } from './vfx-transform.js';
import { GRAVITY } from './vfx-constants.js';
import { orbitalVelocity } from './vfx-orbital.js';

let _solidTex = null;
function solidTexture(T) {
  if (_solidTex) return _solidTex;
  _solidTex = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, T.RGBAFormat);
  _solidTex.needsUpdate = true;
  return _solidTex;
}
function makeGameShaderMaterial(T, key, viewAlign, mp, blend, tex) {
  const g = gameShaders[key];
  if (!g) return null;
  const realVert = !viewAlign ? particleWorldVertex(g.vert) : null;
  const useRealVert = !!realVert;
  const useMatcapVert = !useRealVert && key === 'skill_fire_normal';
  const gu = buildGameUniforms(T, g, mp);
  const uniforms = gu.uniforms;
  for (const sn of g.samplers || []) uniforms[sn] = { value: tex || whiteTexture(T) };
  uniforms.uViewAlign = { value: viewAlign ? 1 : 0 };
  const mat = new T.RawShaderMaterial({
    glslVersion: T.GLSL3,
    uniforms,
    vertexShader: useRealVert ? realVert : useMatcapVert ? GAME_VERT_MATCAP : genMeshUvVertex(g),
    fragmentShader: g.frag,
    side: T.DoubleSide,
  });
  applyGameBlend(T, mat, blend);
  const onBeforeRender = (renderer, scene, camera) => gu.wire(renderer, camera);
  const tick = (dt) => {
    uniforms._TimeParameters.value.x += dt;
  };
  return { mat, tick, onBeforeRender, setDepth: gu.setDepth };
}

function makeGameBillboardBackend(T, key, maxP, P, o) {
  const g = gameShaders[key];
  if (!g) return null;
  const uv = o.uv || { on: false, tilesX: 1, tilesY: 1, frameOf: () => 0 };
  const geo = new T.InstancedBufferGeometry();
  const quad = new T.PlaneGeometry(1, 1);
  geo.index = quad.index;
  geo.attributes.position = quad.attributes.position;
  geo.attributes.uv = quad.attributes.uv;
  const iOffset = new Float32Array(maxP * 3),
    iColor = new Float32Array(maxP * 4),
    iSize = new Float32Array(maxP * 2),
    iRot = new Float32Array(maxP),
    iUvOff = new Float32Array(maxP * 2);
  geo.setAttribute('iOffset', new T.InstancedBufferAttribute(iOffset, 3));
  geo.setAttribute('iColor', new T.InstancedBufferAttribute(iColor, 4));
  geo.setAttribute('iSize', new T.InstancedBufferAttribute(iSize, 2));
  geo.setAttribute('iRot', new T.InstancedBufferAttribute(iRot, 1));
  geo.setAttribute('iUvOff', new T.InstancedBufferAttribute(iUvOff, 2));
  geo.instanceCount = 0;
  const uvScale = uv.on ? [1 / uv.tilesX, 1 / uv.tilesY] : [1, 1];
  const io = usesRealVertex(g) ? realVertexIO(g) : genVaryingIO(effectiveVaryings(g));
  const vertexShader =
    'precision highp float;\n' +
    'in vec3 position;in vec2 uv;in vec3 iOffset;in vec4 iColor;in vec2 iSize;in float iRot;in vec2 iUvOff;\n' +
    'uniform mat4 modelMatrix;uniform mat4 viewMatrix;uniform mat4 projectionMatrix;uniform vec3 cameraPosition;uniform mat4 uCamWorld;\n' +
    'uniform vec2 uUvScale;uniform float uScale;uniform vec2 uPivot;uniform float uViewAligned;uniform float uRenderMode;\n' +
    io.outs +
    '\n' +
    'void main(){vec2 quv=uv*uUvScale+iUvOff;vec3 colRgb=iColor.rgb;float colA=iColor.a;vec3 p=position;p.xy+=uPivot;\n' +
    'float cr=cos(iRot),sr=sin(iRot);vec2 r=vec2(p.x*cr-p.y*sr,p.x*sr+p.y*cr)*iSize;vec3 wp;\n' +
    'if(uRenderMode>1.5){vec3 cw=(modelMatrix*vec4(iOffset,1.0)).xyz;vec3 toCam=cameraPosition-cw;toCam.y=0.0;float ll=length(toCam);toCam=ll>1e-5?toCam/ll:vec3(0.0,0.0,1.0);\n' +
    ' vec3 upW=vec3(0.0,1.0,0.0);vec3 rightW=normalize(cross(upW,toCam));vec3 upv=(uRenderMode>2.5)?upW:normalize(cross(rightW,upW));\n' +
    ' wp=cw+rightW*(r.x*uScale)+upv*(r.y*uScale);}\n' +
    'else{vec4 mvc=viewMatrix*modelMatrix*vec4(iOffset,1.0);mvc.xy+=r*uScale;wp=(uCamWorld*mvc).xyz;}\n' +
    'vec3 nrm=normalize(cameraPosition-wp);\n' +
    io.asg +
    '\n' +
    'gl_Position=projectionMatrix*viewMatrix*vec4(wp,1.0);}';

  const gu = buildGameUniforms(T, g, o.matParams);
  const uniforms = gu.uniforms;
  for (const sn of g.samplers || []) uniforms[sn] = { value: o.tex || whiteTexture(T) };
  uniforms.uUvScale = { value: new T.Vector2(uvScale[0], uvScale[1]) };
  uniforms.uScale = { value: 1 };
  uniforms.uPivot = { value: new T.Vector2(o.pivot ? o.pivot.x : 0, o.pivot ? o.pivot.y : 0) };
  uniforms.uViewAligned = { value: o.viewAligned === false ? 0 : 1 };
  uniforms.uRenderMode = { value: o.renderMode == null ? 0 : o.renderMode };
  uniforms.uCamWorld = { value: new T.Matrix4() };
  const mat = new T.RawShaderMaterial({
    glslVersion: T.GLSL3,
    uniforms,
    vertexShader,
    fragmentShader: g.frag,
    side: T.DoubleSide,
  });
  applyGameBlend(T, mat, o.blend);
  const unityMesh = new T.Mesh(geo, mat);
  unityMesh.frustumCulled = false;
  unityMesh.onBeforeRender = (renderer, scene, camera) => {
    uniforms.uCamWorld.value.copy(camera.matrixWorld);
    gu.wire(renderer, camera);
  };
  return {
    unityMesh,
    proc: true,
    gameMat: mat,
    tick: (dt) => {
      uniforms._TimeParameters.value.x += dt;
    },
    setDepth: gu.setDepth,
    writeInst: (n, i, sm, col) => {
      const o3 = n * 3,
        c4 = n * 4,
        s2 = n * 2;
      iOffset[o3] = P.px[i];
      iOffset[o3 + 1] = P.py[i];
      iOffset[o3 + 2] = P.pz[i];
      iColor[c4] = col[0];
      iColor[c4 + 1] = col[1];
      iColor[c4 + 2] = col[2];
      iColor[c4 + 3] = col[3];
      iSize[s2] = P.sx[i] * sm[0];
      iSize[s2 + 1] = P.sy[i] * sm[1];
      iRot[n] = P.rz[i];
      if (uv.on) {
        const fr = uv.frameOf(i);
        const fx = fr % uv.tilesX,
          fy = (fr / uv.tilesX) | 0;
        iUvOff[n * 2] = fx / uv.tilesX;
        iUvOff[n * 2 + 1] = (uv.tilesY - 1 - fy) / uv.tilesY;
      }
    },
    commit: (n) => {
      geo.instanceCount = n;
      geo.attributes.iOffset.needsUpdate = geo.attributes.iColor.needsUpdate = geo.attributes.iSize.needsUpdate = geo.attributes.iRot.needsUpdate = geo.attributes.iUvOff.needsUpdate = true;
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
      quad.dispose();
    },
  };
}

function makeMeshBackend(T, maxP, P, meshGeo, tex, proc, viewAlign, procShader, matParams, meshBlend, pivot) {
  const bg = new T.BufferGeometry();
  bg.setAttribute('position', new T.BufferAttribute(meshPositionsWithPivot(meshGeo.positions, pivot), 3));
  if (meshGeo.normals) bg.setAttribute('normal', new T.BufferAttribute(meshGeo.normals, 3));
  if (meshGeo.uv) bg.setAttribute('uv', new T.BufferAttribute(meshGeo.uv, 2));
  if (meshGeo.indices) bg.setIndex(new T.BufferAttribute(meshGeo.indices, 1));
  const gameKey = proc ? resolveGameKey(procShader) : null;
  const hasGame = !!gameKey;
  let mat,
    procMat = null,
    gameTick = null,
    gameOnBefore = null,
    gameSetDepth = null;
  if (hasGame) {
    const gm = makeGameShaderMaterial(T, gameKey, viewAlign, matParams, meshBlend, tex);
    procMat = gm.mat;
    mat = gm.mat;
    gameTick = gm.tick;
    gameOnBefore = gm.onBeforeRender;
    gameSetDepth = gm.setDepth;
  } else {
    mat = new T.MeshBasicMaterial({ map: tex || null, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide });
  }
  const im = new T.InstancedMesh(bg, mat, maxP);
  im.frustumCulled = false;
  im.count = 0;
  im.instanceColor = new T.InstancedBufferAttribute(new Float32Array(maxP * 3), 3);
  let iColA = null;
  if (hasGame) {
    iColA = new T.InstancedBufferAttribute(new Float32Array(maxP), 1);
    bg.setAttribute('iColorA', iColA);
  }
  if (gameOnBefore) im.onBeforeRender = gameOnBefore;
  const dm = new T.Object3D();
  return {
    unityMesh: im,
    proc: !!procMat,
    tick:
      gameTick ||
      (procMat && procMat.uniforms && procMat.uniforms.uTime
        ? (dt) => {
            procMat.uniforms.uTime.value += dt;
          }
        : null),
    setDepth: gameSetDepth,
    writeInst: (n, i, sm, col) => {
      dm.position.set(P.px[i], P.py[i], P.pz[i]);
      dm.rotation.set(P.rx[i], P.ry[i], P.rz[i]);
      dm.scale.set(P.sx[i] * sm[0], P.sy[i] * sm[1], P.sz[i] * sm[2]);
      dm.updateMatrix();
      im.setMatrixAt(n, dm.matrix);
      if (iColA) {
        im.instanceColor.setXYZ(n, col[0], col[1], col[2]);
        iColA.array[n] = col[3];
      } else im.instanceColor.setXYZ(n, col[0] * col[3], col[1] * col[3], col[2] * col[3]);
    },
    commit: (n) => {
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      im.instanceColor.needsUpdate = true;
      if (iColA) iColA.needsUpdate = true;
    },
    dispose: () => {
      bg.dispose();
      mat.dispose();
    },
  };
}
function makeBillboardBackend(T, maxP, P, { tex, uv, viewAligned, stretched, lengthScale, velocityScale, tint, renderMode, pivot }) {
  const tc = tint || [1, 1, 1, 1];
  const geo = new T.InstancedBufferGeometry();
  const quad = new T.PlaneGeometry(1, 1);
  geo.index = quad.index;
  geo.attributes.position = quad.attributes.position;
  geo.attributes.uv = quad.attributes.uv;
  const iOffset = new Float32Array(maxP * 3),
    iColor = new Float32Array(maxP * 4),
    iSize = new Float32Array(maxP * 2),
    iRot = new Float32Array(maxP),
    iUvOff = new Float32Array(maxP * 2),
    iVel = new Float32Array(maxP * 3);
  geo.setAttribute('iOffset', new T.InstancedBufferAttribute(iOffset, 3));
  geo.setAttribute('iColor', new T.InstancedBufferAttribute(iColor, 4));
  geo.setAttribute('iSize', new T.InstancedBufferAttribute(iSize, 2));
  geo.setAttribute('iRot', new T.InstancedBufferAttribute(iRot, 1));
  geo.setAttribute('iUvOff', new T.InstancedBufferAttribute(iUvOff, 2));
  geo.setAttribute('iVel', new T.InstancedBufferAttribute(iVel, 3));
  geo.instanceCount = 0;
  const uvScale = uv.on ? [1 / uv.tilesX, 1 / uv.tilesY] : [1, 1];
  const mat = new T.ShaderMaterial({
    uniforms: {
      uTex: { value: tex || solidTexture(T) },
      uUvScale: { value: new T.Vector2(uvScale[0], uvScale[1]) },
      uScale: { value: 1 },
      uPivot: { value: new T.Vector2(pivot ? pivot.x : 0, pivot ? pivot.y : 0) },
      uViewAligned: { value: 1 },
      uRenderMode: { value: renderMode == null ? 0 : renderMode },
      uStretch: { value: stretched ? 1 : 0 },
      uLenScale: { value: lengthScale || 2 },
      uVelScale: { value: velocityScale || 0 },
      uTint: { value: new T.Vector4(tc[0] == null ? 1 : tc[0], tc[1] == null ? 1 : tc[1], tc[2] == null ? 1 : tc[2], tc[3] == null ? 1 : tc[3]) },
    },
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    side: T.DoubleSide,
    vertexShader:
      'attribute vec3 iOffset;attribute vec4 iColor;attribute vec2 iSize;attribute float iRot;attribute vec2 iUvOff;attribute vec3 iVel;' +
      'uniform float uScale;uniform vec2 uPivot;uniform float uViewAligned;uniform float uRenderMode;uniform float uStretch;uniform float uLenScale;uniform float uVelScale;' +
      'varying vec2 vUv;varying vec4 vCol;varying vec2 vUvOff;void main(){vUv=uv;vUvOff=iUvOff;vCol=iColor;vec3 p=position;p.xy+=uPivot;' +
      'if(uStretch>0.5){vec3 vv=(modelViewMatrix*vec4(iVel,0.0)).xyz;float sp=length(vv.xy);vec2 vdir=sp>1e-4?vv.xy/sp:vec2(0.0,1.0);vec2 pdir=vec2(-vdir.y,vdir.x);' +
      'float len=iSize.y*(uLenScale+sp*uVelScale);vec2 r=(pdir*(p.x*iSize.x)+vdir*(p.y*len))*uScale;vec4 mv=modelViewMatrix*vec4(iOffset,1.0);mv.xy+=r;gl_Position=projectionMatrix*mv;}' +
      'else{float c=cos(iRot),s=sin(iRot);vec2 r=vec2(p.x*c-p.y*s,p.x*s+p.y*c)*iSize;vec4 cw=modelMatrix*vec4(iOffset,1.0);' +
      'if(uRenderMode>2.5){vec3 toCam=cameraPosition-cw.xyz;toCam.y=0.0;float ll=length(toCam);toCam=ll>1e-5?toCam/ll:vec3(0.0,0.0,1.0);vec3 upW=vec3(0.0,1.0,0.0);vec3 rightW=normalize(cross(upW,toCam));vec3 wp=cw.xyz+rightW*(r.x*uScale)+upW*(r.y*uScale);gl_Position=projectionMatrix*viewMatrix*vec4(wp,1.0);}' +
      'else if(uRenderMode>1.5){vec3 toCam=cameraPosition-cw.xyz;toCam.y=0.0;float ll=length(toCam);toCam=ll>1e-5?toCam/ll:vec3(0.0,0.0,1.0);vec3 upW=vec3(0.0,1.0,0.0);vec3 rightW=normalize(cross(upW,toCam));vec3 fwdW=normalize(cross(rightW,upW));vec3 wp=cw.xyz+rightW*(r.x*uScale)+fwdW*(r.y*uScale);gl_Position=projectionMatrix*viewMatrix*vec4(wp,1.0);}' +
      'else if(uViewAligned>0.5){vec4 mv=modelViewMatrix*vec4(iOffset,1.0);mv.xy+=r*uScale;gl_Position=projectionMatrix*mv;}' +
      'else{vec3 lp=iOffset+vec3(r,0.0);gl_Position=projectionMatrix*modelViewMatrix*vec4(lp,1.0);}}}',
    fragmentShader:
      'uniform sampler2D uTex;uniform vec2 uUvScale;uniform vec4 uTint;varying vec2 vUv;varying vec4 vCol;varying vec2 vUvOff;void main(){vec2 uv=vUv*uUvScale+vUvOff;vec4 t=texture2D(uTex,uv);vec3 rgb=vCol.rgb*t.rgb*uTint.rgb;float m=max(rgb.r,max(rgb.g,rgb.b));if(m>1.0)rgb/=m;gl_FragColor=vec4(rgb,vCol.a*t.a*uTint.a);}',
  });
  mat.uniforms.uViewAligned.value = viewAligned === false ? 0 : 1;
  const unityMesh = new T.Mesh(geo, mat);
  unityMesh.frustumCulled = false;
  return {
    unityMesh,
    writeInst: (n, i, sm, col) => {
      const o = n * 3,
        c = n * 4,
        s = n * 2,
        u = n * 2;
      iOffset[o] = P.px[i];
      iOffset[o + 1] = P.py[i];
      iOffset[o + 2] = P.pz[i];
      iColor[c] = col[0];
      iColor[c + 1] = col[1];
      iColor[c + 2] = col[2];
      iColor[c + 3] = col[3];
      iSize[s] = P.sx[i] * sm[0];
      iSize[s + 1] = P.sy[i] * sm[1];
      iRot[n] = P.rz[i];
      if (stretched) {
        const v = n * 3;
        iVel[v] = P.vx[i];
        iVel[v + 1] = P.vy[i];
        iVel[v + 2] = P.vz[i];
      }
      if (uv.on) {
        const fr = uv.frameOf(i);
        const fx = fr % uv.tilesX,
          fy = (fr / uv.tilesX) | 0;
        iUvOff[u] = fx / uv.tilesX;
        iUvOff[u + 1] = (uv.tilesY - 1 - fy) / uv.tilesY;
      }
    },
    commit: (n) => {
      geo.instanceCount = n;
      geo.attributes.iOffset.needsUpdate = geo.attributes.iColor.needsUpdate = geo.attributes.iSize.needsUpdate = geo.attributes.iRot.needsUpdate = geo.attributes.iUvOff.needsUpdate = true;
      if (stretched) geo.attributes.iVel.needsUpdate = true;
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
      quad.dispose();
    },
  };
}

function createSystem(T, sys, opt) {
  opt = opt || {};
  const ps = sys.ps;
  const init = ps.InitialModule || {},
    em = ps.EmissionModule || {};
  const colMod = ps.ColorModule || {},
    sizeMod = ps.SizeModule || {};
  const shapeMod = ps.ShapeModule || {},
    forceMod = ps.ForceModule || {},
    rotMod = ps.RotationModule || {},
    velMod = ps.VelocityModule || {},
    uvMod = ps.UVModule || {},
    noiseMod = ps.NoiseModule || {},
    clampMod = ps.ClampVelocityModule || {};
  const forceOn = !!forceMod.enabled,
    rotOn = !!rotMod.enabled,
    rotSep = !!rotMod.separateAxes,
    velOn = !!velMod.enabled,
    uvOn = !!uvMod.enabled,
    noiseOn = !!noiseMod.enabled,
    clampOn = !!clampMod.enabled;
  const velOrbOn = velOn && (mmIsActive(velMod.orbitalX, 0) || mmIsActive(velMod.orbitalY, 0) || mmIsActive(velMod.orbitalZ, 0));
  const velRadOn = velOn && mmIsActive(velMod.radial, 0);
  const velSpdOn = velOn && mmIsActive(velMod.speedModifier, 1);
  const velOffOn = velOn && (mmIsActive(velMod.orbitalOffsetX, 0) || mmIsActive(velMod.orbitalOffsetY, 0) || mmIsActive(velMod.orbitalOffsetZ, 0));
  const velToLocal = velOn && !!velMod.inWorldSpace && (ps.moveWithTransform | 0) === 0;
  const sysRot = sys.rot || { x: 0, y: 0, z: 0, w: 1 };
  const velQi = velToLocal ? new THREE_NS.Quaternion(sysRot.x || 0, sysRot.y || 0, sysRot.z || 0, sysRot.w == null ? 1 : sysRot.w).invert() : null;
  const velS = sys.scale || { x: 1, y: 1, z: 1 };
  const _vl = new THREE_NS.Vector3(),
    _vc = new THREE_NS.Vector3();
  const sizeSep = !!(sizeMod.enabled && sizeMod.separateAxes);
  const clampDampen = clampMod.dampen != null ? clampMod.dampen : 0;
  const maxP = Math.max(1, Math.min(2000, init.maxNumParticles | 0 || 100));
  const looping = opt.forceLoop ? true : ps.looping !== false;
  const duration = ps.lengthInSec || 5;
  const simSpeed = ps.simulationSpeed || 1;
  const gravityBase = GRAVITY;
  const size3D = !!init.size3D,
    rot3D = !!init.rotation3D;
  const startColor = init.startColor;
  const useMesh = sys.renderMode === 4 && opt.meshGeo && opt.meshGeo.positions && opt.meshGeo.positions.length;

  const shape = createShapeSampler(T, shapeMod, { shapeMesh: opt.shapeMesh || null });
  const _sp = new T.Vector3(),
    _sd = new T.Vector3();

  const uvTilesX = Math.max(1, uvMod.tilesX | 0 || 1),
    uvTilesY = Math.max(1, uvMod.tilesY | 0 || 1);
  const uvAnimType = uvMod.animationType | 0;
  const uvRowIndex = uvMod.rowIndex | 0,
    uvCycles = uvMod.cycles || 1;
  const uvFrames = uvOn ? (uvAnimType === 1 ? uvTilesX : uvTilesX * uvTilesY) : 1;
  function uvFrameOf(i) {
    const t = P.life[i] > 0 ? P.age[i] / P.life[i] : 0;
    const fnorm = evalMinMax(uvMod.frameOverTime, t, P.rnd[i]);
    const sf = evalMinMax(uvMod.startFrame, 0, P.rnd[i]) || 0;
    let frame = Math.floor(fnorm * uvCycles * uvFrames + sf);
    frame = ((frame % uvFrames) + uvFrames) % uvFrames;
    return uvAnimType === 1 ? uvRowIndex * uvTilesX + frame : frame;
  }

  const nzState = noiseOn
    ? {
        freq: Math.max(Number(noiseMod.frequency) || 0.5, 1e-6),
        octaves: Math.max(1, Math.min(4, noiseMod.octaves | 0 || 1)),
        octaveMul: noiseMod.octaveMultiplier != null ? Number(noiseMod.octaveMultiplier) : 0.5,
        octaveScale: noiseMod.octaveScale != null ? Number(noiseMod.octaveScale) : 2,
        quality: noiseMod.quality == null ? 2 : noiseMod.quality | 0,
        ...makeNoiseOffsets(),
      }
    : null;
  const nzDamp = nzState && noiseMod.damping !== false ? 1 / nzState.freq : 1;
  const nzSep = !!noiseMod.separateAxes;
  const nzScrollOn = noiseOn && mmIsActive(noiseMod.scrollSpeed, 0);
  const nzRemap = noiseRemapOf(noiseMod);
  const nzOut = [0, 0, 0];
  let nzScrollT = 0;

  let selfEmit = true,
    emitEvents = false,
    ox = 0,
    oy = 0,
    oz = 0;
  const deaths = [];

  const P = {
    age: new Float32Array(maxP),
    life: new Float32Array(maxP),
    alive: new Uint8Array(maxP),
    px: new Float32Array(maxP),
    py: new Float32Array(maxP),
    pz: new Float32Array(maxP),
    vx: new Float32Array(maxP),
    vy: new Float32Array(maxP),
    vz: new Float32Array(maxP),
    sx: new Float32Array(maxP),
    sy: new Float32Array(maxP),
    sz: new Float32Array(maxP),
    rx: new Float32Array(maxP),
    ry: new Float32Array(maxP),
    rz: new Float32Array(maxP),
    grav: new Float32Array(maxP),
    rnd: new Float32Array(maxP),
    emit: new Float32Array(maxP),
    spx: new Float32Array(maxP),
    spy: new Float32Array(maxP),
    spz: new Float32Array(maxP),
    rz0: new Float32Array(maxP),
  };

  const viewAligned = sys.renderAlignment == null || sys.renderAlignment === 0 || sys.renderAlignment === 3;
  const stretched = sys.renderMode === 1;
  const procShaderName = opt.proc && opt.proc.shader ? opt.proc.shader : '';
  const meshProc = useMesh && !!resolveGameKey(procShaderName);
  const meshViewAlign = sys.renderAlignment === 0 || sys.renderAlignment == null;
  const gameBlend = opt.matOpaque ? 'opaque' : opt.matAdditive ? 'add' : 'alpha';
  const billboardGameKey = !useMesh && !stretched ? resolveGameKey(procShaderName) : null;
  const liveGame = useMesh ? meshProc : !!billboardGameKey;
  const tex = opt.texture || (!liveGame && procShaderName ? proceduralTex(opt.proc) : null);
  const backend = useMesh
    ? makeMeshBackend(T, maxP, P, opt.meshGeo, tex, meshProc, meshViewAlign, procShaderName, opt.proc, gameBlend, sys.pivot)
    : billboardGameKey
      ? makeGameBillboardBackend(T, billboardGameKey, maxP, P, {
          uv: { on: uvOn, tilesX: uvTilesX, tilesY: uvTilesY, frameOf: uvFrameOf },
          viewAligned,
          renderMode: sys.renderMode,
          pivot: sys.pivot,
          matParams: opt.proc,
          blend: gameBlend,
          tex,
        })
      : makeBillboardBackend(T, maxP, P, {
          tex,
          uv: { on: uvOn, tilesX: uvTilesX, tilesY: uvTilesY, frameOf: uvFrameOf },
          viewAligned,
          stretched,
          lengthScale: sys.lengthScale || 2,
          velocityScale: sys.velocityScale || 0,
          tint: opt.tint,
          renderMode: sys.renderMode,
          pivot: sys.pivot,
        });
  const unityMesh = backend.unityMesh,
    writeInst = backend.writeInst,
    disposeFn = backend.dispose;
  const _additive = opt.matAdditive != null ? opt.matAdditive : opt.defaultBlend !== 'normal';
  if (unityMesh && unityMesh.material && !backend.proc) {
    const mm = unityMesh.material;
    if (opt.matOpaque) {
      mm.blending = T.NormalBlending;
      mm.transparent = false;
      mm.depthWrite = true;
      if (opt.proc && !opt.texture) mm.alphaTest = opt.cutoff != null ? opt.cutoff : 0.5;
    } else {
      mm.blending = _additive ? T.AdditiveBlending : T.NormalBlending;
    }
    mm.needsUpdate = true;
  }

  const emEnabled = em.enabled !== false;
  const bursts = (em.m_Bursts || []).map((b) => ({
    time: b.time || 0,
    count: b.countCurve,
    cycles: b.cycleCount == null ? 1 : b.cycleCount,
    repeat: b.repeatInterval || 0,
    prob: b.probability == null ? 1 : b.probability,
  }));
  const startDelayV = Math.max(0, sampleMinMax(ps.startDelay, Math.random()) || 0);
  let emitAcc = 0,
    sysTime = 0,
    emitNorm = 0,
    curLoop = -1;
  const burstFired = new Array(bursts.length).fill(0);
  const rateOver = () => (opt.emissionRateOverride != null ? opt.emissionRateOverride : evalMinMax(em.rateOverTime, 0));
  const persistLoop = looping && bursts.length > 0 && rateOver() <= 0 && opt.emissionRateOverride == null;
  const spawn = () => {
    let idx = -1;
    for (let i = 0; i < maxP; i++)
      if (!P.alive[i]) {
        idx = i;
        break;
      }
    if (idx < 0) return;
    P.alive[idx] = 1;
    P.age[idx] = 0;
    const rn = Math.random();
    P.rnd[idx] = rn;
    P.emit[idx] = emitNorm;
    P.life[idx] = Math.max(0.05, sampleMinMax(init.startLifetime, rn));
    const sx = sampleMinMax(init.startSize, rn) || 1;
    P.sx[idx] = sx;
    P.sy[idx] = size3D ? sampleMinMax(init.startSizeY, rn) || sx : sx;
    P.sz[idx] = size3D ? sampleMinMax(init.startSizeZ, rn) || sx : sx;
    P.rx[idx] = rot3D ? sampleMinMax(init.startRotationX, rn) || 0 : 0;
    P.ry[idx] = rot3D ? sampleMinMax(init.startRotationY, rn) || 0 : 0;
    P.rz[idx] = sampleMinMax(init.startRotation, rn) || 0;
    P.grav[idx] = sampleMinMax(init.gravityModifier, rn) || 0;
    const spd = sampleMinMax(init.startSpeed, rn);
    shape.sample(_sp, _sd);
    P.px[idx] = _sp.x + ox;
    P.py[idx] = _sp.y + oy;
    P.pz[idx] = _sp.z + oz;
    P.vx[idx] = _sd.x * spd;
    P.vy[idx] = _sd.y * spd;
    P.vz[idx] = _sd.z * spd;
    P.spx[idx] = P.px[idx];
    P.spy[idx] = P.py[idx];
    P.spz[idx] = P.pz[idx];
    P.rz0[idx] = P.rz[idx];
  };
  const emitAt = (x, y, z, count) => {
    ox = x;
    oy = y;
    oz = z;
    for (let k = 0; k < count; k++) spawn();
    ox = oy = oz = 0;
  };

  const emit = (dt) => {
    if (!emEnabled || !selfEmit) return;
    sysTime += dt;
    const local = sysTime - startDelayV;
    if (local < 0) return;
    const overDur = !looping && local > duration;
    const cycleT = looping ? local % duration : Math.min(local, duration);
    emitNorm = duration > 0 ? Math.min(1, Math.max(0, cycleT / duration)) : 0;
    if (looping && !persistLoop) {
      const li = Math.floor(local / duration);
      if (li !== curLoop) {
        curLoop = li;
        burstFired.fill(0);
      }
    }
    for (let bi = 0; bi < bursts.length; bi++) {
      const bd = bursts[bi];
      const instant = bd.repeat <= 0;
      const maxCyc = instant ? 1 : bd.cycles <= 0 ? 1e9 : bd.cycles;
      const volley = instant && bd.cycles > 1 ? bd.cycles : 1;
      let guard = 0;
      while (burstFired[bi] < maxCyc && guard++ < 4096) {
        const fireT = bd.time + burstFired[bi] * bd.repeat;
        if (cycleT + 1e-6 < fireT || overDur) break;
        if (Math.random() <= bd.prob) {
          const cnt = (Math.round(sampleMinMax(bd.count, Math.random())) || 0) * volley;
          for (let k = 0; k < cnt; k++) spawn();
        }
        burstFired[bi]++;
      }
    }
    if (!overDur) {
      const rate = rateOver();
      if (rate > 0) {
        emitAcc += rate * dt;
        while (emitAcc >= 1) {
          spawn();
          emitAcc -= 1;
        }
      }
    }
  };

  const tmpCol = [1, 1, 1, 1],
    scol = [1, 1, 1, 1],
    _sm = [1, 1, 1];
  const _gravDir = [0, -1, 0];
  const gateKeys = opt.gateKeys || null;
  const gateDur = Number(opt.gateDur) || 0;
  let gateT = 0;
  const update = (dt) => {
    dt *= simSpeed;
    if (gateKeys) {
      gateT += dt;
      const gt = gateDur > 0.01 ? gateT % gateDur : gateT;
      if (!keyOnAt(gateKeys, gt)) {
        backend.commit(0);
        return;
      }
    }
    if (backend.tick) backend.tick(dt);
    if (emitEvents) deaths.length = 0;
    emit(dt);
    if (noiseOn) nzScrollT += dt;
    let n = 0;
    for (let i = 0; i < maxP; i++) {
      if (!P.alive[i]) continue;
      P.age[i] += dt;
      if (P.age[i] >= P.life[i]) {
        if (persistLoop && P.life[i] > 1e-4) {
          P.age[i] -= P.life[i] * Math.floor(P.age[i] / P.life[i]);
          P.px[i] = P.spx[i];
          P.py[i] = P.spy[i];
          P.pz[i] = P.spz[i];
          P.vx[i] = 0;
          P.vy[i] = 0;
          P.vz[i] = 0;
          P.rz[i] = P.rz0[i];
        } else {
          if (emitEvents) deaths.push(P.px[i], P.py[i], P.pz[i]);
          P.alive[i] = 0;
          continue;
        }
      }
      const t = P.age[i] / P.life[i];
      const gA = gravityBase * P.grav[i] * dt;
      P.vx[i] += _gravDir[0] * gA;
      P.vy[i] += _gravDir[1] * gA;
      P.vz[i] += _gravDir[2] * gA;
      if (forceOn) {
        P.vx[i] += evalMinMax(forceMod.x, t) * dt;
        P.vy[i] += evalMinMax(forceMod.y, t) * dt;
        P.vz[i] += evalMinMax(forceMod.z, t) * dt;
      }
      if (rotOn) {
        if (rotSep) {
          P.rx[i] += evalMinMax(rotMod.x, t) * dt;
          P.ry[i] += evalMinMax(rotMod.y, t) * dt;
        }
        P.rz[i] += evalMinMax(rotMod.curve, t) * dt;
      }
      let vlx = 0,
        vly = 0,
        vlz = 0,
        spdMod = 1;
      if (velOn) {
        _vl.set(evalMinMax(velMod.x, t), evalMinMax(velMod.y, t), evalMinMax(velMod.z, t));
        if (velQi) {
          _vl.applyQuaternion(velQi);
          _vl.set(Math.abs(velS.x) > 1e-6 ? _vl.x / velS.x : 0, Math.abs(velS.y) > 1e-6 ? _vl.y / velS.y : 0, Math.abs(velS.z) > 1e-6 ? _vl.z / velS.z : 0);
        }
        if (velOrbOn || velRadOn) {
          _vc.set(P.px[i], P.py[i], P.pz[i]);
          if (velOffOn) {
            _vc.x -= evalMinMax(velMod.orbitalOffsetX, t);
            _vc.y -= evalMinMax(velMod.orbitalOffsetY, t);
            _vc.z -= evalMinMax(velMod.orbitalOffsetZ, t);
          }
          const ax = velOrbOn ? evalMinMax(velMod.orbitalX, t) * dt : 0,
            ay = velOrbOn ? evalMinMax(velMod.orbitalY, t) * dt : 0,
            az = velOrbOn ? evalMinMax(velMod.orbitalZ, t) * dt : 0;
          _vl.add(orbitalVelocity(_vc, ax, ay, az, velRadOn ? evalMinMax(velMod.radial, t) * dt : 0, dt));
        }
        vlx = _vl.x;
        vly = _vl.y;
        vlz = _vl.z;
        if (velSpdOn) spdMod = evalMinMax(velMod.speedModifier, t);
      }
      let nzSizeF = 1,
        ndx = 0,
        ndy = 0,
        ndz = 0;
      if (noiseOn) {
        const scroll = nzScrollOn ? evalMinMax(noiseMod.scrollSpeed, t) * nzScrollT : 0;
        unityNoise(nzState, P.px[i], P.py[i], P.pz[i], scroll, nzOut);
        if (nzRemap.x) {
          nzOut[0] = remapNoise(nzRemap.x, nzOut[0]);
          nzOut[1] = remapNoise(nzRemap.y || nzRemap.x, nzOut[1]);
          nzOut[2] = remapNoise(nzRemap.z || nzRemap.x, nzOut[2]);
        }
        const sX = evalMinMax(noiseMod.strength, t),
          sY = nzSep ? evalMinMax(noiseMod.strengthY, t) : sX,
          sZ = nzSep ? evalMinMax(noiseMod.strengthZ, t) : sX;
        const posAmt = evalMinMax(noiseMod.positionAmount, t);
        if (posAmt !== 0) {
          const k = nzDamp * posAmt * dt;
          ndx = nzOut[0] * sX * k;
          ndy = nzOut[1] * sY * k;
          ndz = nzOut[2] * sZ * k;
        }
        const rotAmt = evalMinMax(noiseMod.rotationAmount, t);
        if (rotAmt) P.rz[i] += nzOut[2] * rotAmt * nzDamp * dt;
        const szAmt = evalMinMax(noiseMod.sizeAmount, t);
        if (szAmt) nzSizeF = 1 + nzOut[0] * szAmt * nzDamp;
      }
      if (clampOn) {
        const lim = evalMinMax(clampMod.magnitude, t);
        if (lim > 0) {
          const sp = Math.hypot(P.vx[i], P.vy[i], P.vz[i]);
          if (sp > lim) {
            const f = (sp - (sp - lim) * clampDampen) / sp;
            P.vx[i] *= f;
            P.vy[i] *= f;
            P.vz[i] *= f;
          }
        }
      }
      P.px[i] += (P.vx[i] * spdMod + vlx) * dt + ndx;
      P.py[i] += (P.vy[i] * spdMod + vly) * dt + ndy;
      P.pz[i] += (P.vz[i] * spdMod + vlz) * dt + ndz;
      evalMinMaxGradient(startColor, P.rnd[i], P.emit[i], scol);
      if (colMod.enabled) {
        evalMinMaxGradient(colMod.gradient, P.rnd[i], t, tmpCol);
        scol[0] *= tmpCol[0];
        scol[1] *= tmpCol[1];
        scol[2] *= tmpCol[2];
        scol[3] *= tmpCol[3];
      }
      let smx = 1;
      if (sizeMod.enabled) smx = evalMinMax(sizeMod.curve, t) || 1;
      let smy = smx,
        smz = smx;
      if (sizeSep) {
        smy = evalMinMax(sizeMod.y, t) || 1;
        smz = evalMinMax(sizeMod.z, t) || 1;
      }
      if (nzSizeF !== 1) {
        smx *= nzSizeF;
        smy *= nzSizeF;
        smz *= nzSizeF;
      }
      _sm[0] = smx;
      _sm[1] = smy;
      _sm[2] = smz;
      writeInst(n, i, _sm, scol);
      n++;
    }
    backend.commit(n);
  };
  const doPrewarm = () => {
    if (ps.prewarm && looping && duration > 0) {
      const steps = 30,
        wdt = duration / steps;
      for (let k = 0; k < steps; k++) update(wdt);
    }
  };
  const livePos = () => {
    const a = [];
    for (let i = 0; i < maxP; i++) if (P.alive[i]) a.push(P.px[i], P.py[i], P.pz[i]);
    return a;
  };
  return {
    unityMesh,
    update,
    dispose: disposeFn,
    emitAt,
    deaths,
    doPrewarm,
    livePos,
    setDepth: backend.setDepth || null,
    setGravDir: (x, y, z) => {
      _gravDir[0] = x;
      _gravDir[1] = y;
      _gravDir[2] = z;
    },
    ownRate: () => rateOver(),
    setSubDriven: () => {
      selfEmit = false;
    },
    enableEvents: () => {
      emitEvents = true;
    },
  };
}

function createAuraParticles(bytes, opt) {
  if (!THREE_NS) return null;
  const data = vfxParse.parseVfx(bytes);
  if (!data || !data.systems.length) return null;
  const group = new THREE_NS.Group();
  const sims = [];
  const simByPid = new Map();
  const texByMatPid = (opt && opt.texByMatPid) || null;
  const gate = data.animGate;
  const gateOn = !(opt && opt.ignoreGate);
  const inactive = (gate && gate.inactive) || [];
  const emissionMap = new Map((gate && gate.emission) || []);
  const defaultActiveSet = new Set((gate && gate.defaultActive) || []);
  const goHidden = (sys) => sys.goActive === false && !defaultActiveSet.has(sys.path);
  const gateHidden = (p) => {
    if (!gateOn || !p) return false;
    if (inactive.some((ip) => p === ip || p.startsWith(ip + '/'))) return true;
    for (const [ep, ev] of emissionMap) if (ev <= 0.0001 && (p === ep || p.startsWith(ep + '/'))) return true;
    return false;
  };
  const gateTimeline = (gate && gate.timeline) || [];
  const gateSchedule = (p) => {
    if (!p || !gateTimeline.length) return null;
    let best = null;
    for (const tl of gateTimeline) if (p === tl.path || p.startsWith(tl.path + '/')) if (!best || tl.path.length > best.path.length) best = tl;
    return best && best.keys && best.keys.length > 1 ? best.keys : null;
  };
  const { nodes: spinNodes, advance: advanceSpins } = createSpinNodes(group, data.transformAnims);
  for (const sys of data.systems) {
    if (gateHidden(sys.path)) continue;
    if (goHidden(sys)) continue;
    const so = { ...(opt || {}) };
    so.forceLoop = true;
    so.meshGeo = (sys.meshPid && data.meshByPid && data.meshByPid[sys.meshPid]) || null;
    so.gateKeys = gateSchedule(sys.path);
    so.gateDur = (gate && gate.duration) || 0;
    const shp = sys.ps && sys.ps.ShapeModule;
    const shpT = shp && shp.enabled ? shp.type | 0 : -1;
    so.shapeMesh =
      (shpT === 6 || shpT === 13 || shpT === 14) && data.meshByPid
        ? (sys.shapeMeshPid && data.meshByPid[sys.shapeMeshPid]) || (shp.m_Mesh && (shp.m_Mesh.m_FileID | 0) === 0 ? data.meshByPid[String(shp.m_Mesh.m_PathID)] || null : null)
        : null;
    if (gateOn && emissionMap.has(sys.path) && emissionMap.get(sys.path) > 0.0001) so.emissionRateOverride = emissionMap.get(sys.path);
    const e = texByMatPid && sys.matPid ? texByMatPid.get(sys.matPid) : null;
    if (e) {
      so.texture = e.tex || null;
      so.proc = e.proc || null;
      so.matAdditive = e.blend === 'add';
      so.matOpaque = e.blend === 'opaque';
      so.tint = e.tint;
      so.cutoff = e.cutoff;
    }
    const s = createSystem(THREE_NS, sys, so);
    s._sys = sys;
    s._subDriven = false;
    const spin = sys.animParent ? spinNodes.get(sys.animParent) : null;
    s._spin = spin;
    const p = spin && sys.localPos ? sys.localPos : sys.pos || { x: 0, y: 0, z: 0 };
    s.unityMesh.position.set(p.x || 0, p.y || 0, p.z || 0);
    const sc = sys.scale || { x: 1, y: 1, z: 1 };
    const ms = (spin && sys.animLocalScale) || sc;
    s.unityMesh.scale.set(ms.x || 1, ms.y || 1, ms.z || 1);
    const mm = s.unityMesh.material;
    if (mm && mm.uniforms && mm.uniforms.uScale) mm.uniforms.uScale.value = Math.abs(sc.x || 1);
    s.unityMesh.userData = {
      name: sys.name || '',
      sortingOrder: sys.sortingOrder || 0,
      renderMode: sys.renderMode,
      renderAlignment: sys.renderAlignment,
      moveWithTransform: sys.moveWithTransform,
      moveWithCustomTransformPathID: sys.moveWithCustomTransformPathID,
      matAdditive: so.matAdditive,
      matPid: sys.matPid,
      startColor: sys.ps && sys.ps.InitialModule ? sys.ps.InitialModule.startColor : null,
    };
    s.unityMesh.renderOrder = sys.sortingOrder || 0;
    const q = spin && sys.localRot ? sys.localRot : sys.rot;
    if (q && (q.x || q.y || q.z || q.w !== 1)) s.unityMesh.quaternion.set(q.x || 0, q.y || 0, q.z || 0, q.w == null ? 1 : q.w);
    if (sys.renderMode !== 5) (spin ? spin.node : group).add(s.unityMesh);
    sims.push(s);
    if (sys.objPid) simByPid.set(String(sys.objPid), s);
  }
  const links = [];
  for (const lk of vfxParse.getSubEmitterLinks(sims.map((s) => s._sys))) {
    const parent = lk.parent.objPid != null ? simByPid.get(String(lk.parent.objPid)) : null;
    const child = simByPid.get(lk.childObjPid);
    if (!parent || !child || child === parent) continue;
    child.setSubDriven();
    child._subDriven = true;
    if (lk.type === 2) parent.enableEvents();
    links.push({ parent, child, type: lk.type, prob: lk.prob, childRate: child.ownRate ? child.ownRate() : 0, acc: 0 });
  }
  for (const s of sims) if (!s._subDriven && s.doPrewarm) s.doPrewarm();
  const _wp = new THREE_NS.Vector3(),
    _cl = new THREE_NS.Vector3(),
    _inv = new THREE_NS.Matrix4();
  const _gq = new THREE_NS.Quaternion(),
    _gd = new THREE_NS.Vector3();
  const updateGravDirs = () => {
    for (const s of sims) {
      if (!s.setGravDir || !s.unityMesh) continue;
      if (s._spin && s._spin.node) _gq.copy(s._spin.node.quaternion).multiply(s.unityMesh.quaternion);
      else _gq.copy(s.unityMesh.quaternion);
      _gq.invert();
      _gd.set(0, -1, 0).applyQuaternion(_gq);
      s.setGravDir(_gd.x, _gd.y, _gd.z);
    }
  };
  advanceSpins(0);
  return {
    group,
    update(dt) {
      advanceSpins(dt);
      updateGravDirs();
      for (const s of sims) s.update(dt);
      for (const L of links) {
        L.child.unityMesh.updateMatrix();
        _inv.copy(L.child.unityMesh.matrix).invert();
        if (L.type === 0) {
          const live = L.parent.livePos();
          if (!live.length) continue;
          L.parent.unityMesh.updateMatrix();
          L.acc += (L.childRate > 0 ? L.childRate : 0) * dt;
          let toEmit = Math.floor(L.acc);
          if (toEmit <= 0) continue;
          L.acc -= toEmit;
          while (toEmit-- > 0) {
            const base = Math.floor(Math.random() * (live.length / 3)) * 3;
            if (Math.random() > L.prob) continue;
            _wp.set(live[base], live[base + 1], live[base + 2]).applyMatrix4(L.parent.unityMesh.matrix);
            _cl.copy(_wp).applyMatrix4(_inv);
            L.child.emitAt(_cl.x, _cl.y, _cl.z, 1);
          }
        } else {
          const src = L.parent.deaths;
          if (!src.length) continue;
          L.parent.unityMesh.updateMatrix();
          for (let k = 0; k + 2 < src.length; k += 3) {
            if (Math.random() > L.prob) continue;
            _wp.set(src[k], src[k + 1], src[k + 2]).applyMatrix4(L.parent.unityMesh.matrix);
            _cl.copy(_wp).applyMatrix4(_inv);
            L.child.emitAt(_cl.x, _cl.y, _cl.z, 1);
          }
        }
      }
    },
    dispose() {
      for (const s of sims) s.dispose();
    },
    setDepthTexture(tex) {
      for (const s of sims) if (s.setDepth) s.setDepth(tex);
    },
    systemCount: sims.length,
  };
}

export const auraParticles = { createAuraParticles };
