import * as THREE_NS from '../../vendor/three.module.js';
import { vfxParse } from './vfx-parse.js';

let _solidTex = null;
function solidTexture(T) {
  if (_solidTex) return _solidTex;
  _solidTex = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, T.RGBAFormat);
  _solidTex.needsUpdate = true;
  return _solidTex;
}
let _glowTex = null;
function glowTexture(T) {
  if (_glowTex) return _glowTex;
  const S = 64,
    cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  _glowTex = new T.CanvasTexture(cv);
  _glowTex.minFilter = T.LinearFilter;
  _glowTex.magFilter = T.LinearFilter;
  return _glowTex;
}

function evalCurve(curve, t) {
  const ks = (curve && curve.m_Curve) || [];
  if (!ks.length) return 0;
  if (ks.length === 1) return ks[0].value;
  if (t <= ks[0].time) return ks[0].value;
  if (t >= ks[ks.length - 1].time) return ks[ks.length - 1].value;
  let i = 0;
  while (i < ks.length - 1 && ks[i + 1].time < t) i++;
  const a = ks[i],
    b = ks[i + 1];
  const dt = b.time - a.time;
  if (dt <= 1e-9) return a.value;
  const u = (t - a.time) / dt;
  const u2 = u * u,
    u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1,
    h10 = u3 - 2 * u2 + u,
    h01 = -2 * u3 + 3 * u2,
    h11 = u3 - u2;
  return h00 * a.value + h10 * dt * (a.outSlope || 0) + h01 * b.value + h11 * dt * (b.inSlope || 0);
}
function evalMMCurve(mm, t, rnd) {
  if (!mm) return 0;
  const st = mm.minMaxState;
  if (st === 1) return (mm.scalar || 0) * evalCurve(mm.maxCurve, t);
  if (st === 2) {
    const a = (mm.scalar || 0) * evalCurve(mm.maxCurve, t),
      b = (mm.scalar || 0) * evalCurve(mm.minCurve, t);
    return b + (a - b) * (rnd == null ? 0.5 : rnd);
  }
  if (st === 3) {
    const a = mm.scalar || 0,
      b = mm.minScalar || 0;
    return b + (a - b) * (rnd == null ? Math.random() : rnd);
  }
  return mm.scalar || 0;
}
const sampleMM = (mm, rnd) => evalMMCurve(mm, 0, rnd);

function evalGradient(g, t, out) {
  out = out || [1, 1, 1, 1];
  if (!g) {
    out[0] = out[1] = out[2] = out[3] = 1;
    return out;
  }
  const nc = g.m_NumColorKeys || 0,
    na = g.m_NumAlphaKeys || 0;
  let r = 1,
    grn = 1,
    b = 1;
  if (nc > 0) {
    const tt = t * 65535;
    let i = 0;
    while (i < nc - 1 && g['ctime' + (i + 1)] < tt) i++;
    const c0 = g['key' + i],
      t0 = g['ctime' + i];
    if (i >= nc - 1) {
      r = c0.r;
      grn = c0.g;
      b = c0.b;
    } else {
      const c1 = g['key' + (i + 1)],
        t1 = g['ctime' + (i + 1)];
      const u = t1 > t0 ? (tt - t0) / (t1 - t0) : 0;
      r = c0.r + (c1.r - c0.r) * u;
      grn = c0.g + (c1.g - c0.g) * u;
      b = c0.b + (c1.b - c0.b) * u;
    }
  }
  let a = 1;
  if (na > 0) {
    const tt = t * 65535;
    let i = 0;
    while (i < na - 1 && g['atime' + (i + 1)] < tt) i++;
    const a0 = g['key' + i].a,
      t0 = g['atime' + i];
    if (i >= na - 1) a = a0;
    else {
      const a1 = g['key' + (i + 1)].a,
        t1 = g['atime' + (i + 1)];
      const u = t1 > t0 ? (tt - t0) / (t1 - t0) : 0;
      a = a0 + (a1 - a0) * u;
    }
  }
  out[0] = r;
  out[1] = grn;
  out[2] = b;
  out[3] = a;
  return out;
}
function evalMMGradient(mm, t, out) {
  out = out || [1, 1, 1, 1];
  if (!mm) {
    out[0] = out[1] = out[2] = out[3] = 1;
    return out;
  }
  const st = mm.minMaxState;
  if (st === 1 || st === 3) return evalGradient(mm.maxGradient, t, out);
  if (st === 2 && mm.minColor && mm.maxColor) {
    const a = mm.minColor,
      b = mm.maxColor,
      u = t == null ? 0.5 : t;
    out[0] = a.r + (b.r - a.r) * u;
    out[1] = a.g + (b.g - a.g) * u;
    out[2] = a.b + (b.b - a.b) * u;
    out[3] = a.a + (b.a - a.a) * u;
    return out;
  }
  const c = mm.maxColor || mm.minColor || { r: 1, g: 1, b: 1, a: 1 };
  out[0] = c.r;
  out[1] = c.g;
  out[2] = c.b;
  out[3] = c.a;
  return out;
}

const _fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const _hash = (x, y, z) => {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (z | 0) * 2147483647 + 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 2147483647.5 - 1;
};
function valueNoise3(x, y, z) {
  const xi = Math.floor(x),
    yi = Math.floor(y),
    zi = Math.floor(z);
  const xf = x - xi,
    yf = y - yi,
    zf = z - zi;
  const u = _fade(xf),
    v = _fade(yf),
    w = _fade(zf);
  const lerp = (a, b, t) => a + (b - a) * t;
  const c000 = _hash(xi, yi, zi),
    c100 = _hash(xi + 1, yi, zi),
    c010 = _hash(xi, yi + 1, zi),
    c110 = _hash(xi + 1, yi + 1, zi);
  const c001 = _hash(xi, yi, zi + 1),
    c101 = _hash(xi + 1, yi, zi + 1),
    c011 = _hash(xi, yi + 1, zi + 1),
    c111 = _hash(xi + 1, yi + 1, zi + 1);
  return lerp(lerp(lerp(c000, c100, u), lerp(c010, c110, u), v), lerp(lerp(c001, c101, u), lerp(c011, c111, u), v), w);
}
function fbmNoise(x, y, z, seed, octaves, octMul, octScale) {
  let amp = 1,
    freq = 1,
    sum = 0,
    norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise3(x * freq + seed, y * freq + seed * 1.7, z * freq + seed * 2.3);
    norm += amp;
    amp *= octMul;
    freq *= octScale;
  }
  return norm > 0 ? sum / norm : 0;
}

function makeMeshBackend(T, maxP, P, meshGeo, tex) {
  const bg = new T.BufferGeometry();
  bg.setAttribute('position', new T.BufferAttribute(meshGeo.positions, 3));
  if (meshGeo.normals) bg.setAttribute('normal', new T.BufferAttribute(meshGeo.normals, 3));
  if (meshGeo.uv) bg.setAttribute('uv', new T.BufferAttribute(meshGeo.uv, 2));
  if (meshGeo.indices) bg.setIndex(new T.BufferAttribute(meshGeo.indices, 1));
  const mat = new T.MeshBasicMaterial({ map: tex || null, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide });
  const im = new T.InstancedMesh(bg, mat, maxP);
  im.frustumCulled = false;
  im.count = 0;
  im.instanceColor = new T.InstancedBufferAttribute(new Float32Array(maxP * 3), 3);
  const dm = new T.Object3D();
  return {
    unityMesh: im,
    writeInst: (n, i, sm, col) => {
      dm.position.set(P.px[i], P.py[i], P.pz[i]);
      dm.rotation.set(P.rx[i], P.ry[i], P.rz[i]);
      dm.scale.set(P.sx[i] * sm[0], P.sy[i] * sm[1], P.sz[i] * sm[2]);
      dm.updateMatrix();
      im.setMatrixAt(n, dm.matrix);
      im.instanceColor.setXYZ(n, col[0] * col[3], col[1] * col[3], col[2] * col[3]);
    },
    commit: (n) => {
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      im.instanceColor.needsUpdate = true;
    },
    dispose: () => {
      bg.dispose();
      mat.dispose();
    },
  };
}
function makeBillboardBackend(T, maxP, P, { tex, uv, solid, viewAligned, stretched, lengthScale, velocityScale, tint, renderMode, pivot }) {
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
      uTex: { value: tex || (solid ? solidTexture(T) : glowTexture(T)) },
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
      'varying vec2 vUv;varying vec4 vCol;varying vec2 vUvOff;void main(){vUv=uv;vUvOff=iUvOff;vCol=iColor;vec3 p=position;p.xy-=uPivot;' +
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
  const shapeOn = !!shapeMod.enabled,
    forceOn = !!forceMod.enabled,
    rotOn = !!rotMod.enabled,
    rotSep = !!rotMod.separateAxes,
    velOn = !!velMod.enabled,
    uvOn = !!uvMod.enabled,
    noiseOn = !!noiseMod.enabled,
    clampOn = !!clampMod.enabled;
  const sizeSep = !!(sizeMod.enabled && sizeMod.separateAxes);
  const clampDampen = clampMod.dampen != null ? clampMod.dampen : 0;
  const maxP = Math.max(1, Math.min(2000, init.maxNumParticles | 0 || 100));
  const looping = ps.looping !== false;
  const duration = ps.lengthInSec || 5;
  const simSpeed = ps.simulationSpeed || 1;
  const gravityBase = 9.81;
  const size3D = !!init.size3D,
    rot3D = !!init.rotation3D;
  const startColor = init.startColor;
  const tex = opt.texture || null;
  const useMesh = sys.renderMode === 4 && opt.meshGeo && opt.meshGeo.positions && opt.meshGeo.positions.length;

  const D2R = Math.PI / 180;
  const shRotE = shapeMod.m_Rotation || { x: 0, y: 0, z: 0 };
  const shScale = shapeMod.m_Scale || { x: 1, y: 1, z: 1 };
  const shPos = shapeMod.m_Position || { x: 0, y: 0, z: 0 };
  const shapeRotMat = new T.Matrix4().makeRotationFromEuler(new T.Euler(shRotE.x * D2R, shRotE.y * D2R, shRotE.z * D2R, 'ZXY'));
  const shPosV = new T.Vector3(shPos.x || 0, shPos.y || 0, shPos.z || 0);
  const _sp = new T.Vector3(),
    _sd = new T.Vector3();
  const shType = shapeMod.type | 0;
  const shRadius = (shapeMod.radius && shapeMod.radius.value) || 0;
  const shThick = shapeMod.radiusThickness != null ? shapeMod.radiusThickness : 1;
  const shArc = ((shapeMod.arc && shapeMod.arc.value) || 360) * D2R;
  const shConeAng = (shapeMod.angle || 0) * D2R;
  const shLen = shapeMod.length || 0;
  const shDonut = shapeMod.donutRadius || 0;
  const sampleR = () => {
    const inner = shRadius * (1 - shThick);
    return Math.sqrt(inner * inner + (shRadius * shRadius - inner * inner) * Math.random());
  };
  const _shapeSample = [0, 0, 0, 0, 0, 0];
  const sampleShape = (o) => {
    if (!shapeOn) {
      o[0] = o[1] = o[2] = 0;
      const u = Math.random() * 2 - 1,
        th = Math.random() * Math.PI * 2,
        rr = Math.sqrt(1 - u * u);
      o[3] = rr * Math.cos(th);
      o[4] = u;
      o[5] = rr * Math.sin(th);
      return;
    }
    if (shType === 0 || shType === 1) {
      const u = Math.random() * 2 - 1,
        th = Math.random() * Math.PI * 2,
        rr = Math.sqrt(1 - u * u),
        r = sampleR();
      o[3] = rr * Math.cos(th);
      o[4] = u;
      o[5] = rr * Math.sin(th);
      o[0] = r * o[3];
      o[1] = r * o[4];
      o[2] = r * o[5];
    } else if (shType === 2 || shType === 3) {
      const u = Math.random(),
        th = Math.random() * Math.PI * 2,
        rr = Math.sqrt(1 - u * u),
        r = sampleR();
      o[3] = rr * Math.cos(th);
      o[4] = u;
      o[5] = rr * Math.sin(th);
      o[0] = r * o[3];
      o[1] = r * o[4];
      o[2] = r * o[5];
    } else if (shType === 10 || shType === 11) {
      const a = Math.random() * shArc,
        r = sampleR();
      o[3] = Math.cos(a);
      o[4] = 0;
      o[5] = Math.sin(a);
      o[0] = r * o[3];
      o[1] = 0;
      o[2] = r * o[5];
    } else if (shType === 12) {
      o[0] = (Math.random() * 2 - 1) * shRadius;
      o[1] = 0;
      o[2] = 0;
      o[3] = 0;
      o[4] = 1;
      o[5] = 0;
    } else if (shType === 17) {
      const a = Math.random() * shArc,
        phi = Math.random() * Math.PI * 2,
        rr = shDonut * Math.sqrt(Math.random());
      const cx = Math.cos(a),
        cz = Math.sin(a),
        cp = Math.cos(phi);
      o[0] = (shRadius + rr * cp) * cx;
      o[1] = rr * Math.sin(phi);
      o[2] = (shRadius + rr * cp) * cz;
      o[3] = cx * cp;
      o[4] = Math.sin(phi);
      o[5] = cz * cp;
    } else {
      const a = Math.random() * shArc,
        r = sampleR(),
        sa = Math.sin(shConeAng),
        ca = Math.cos(shConeAng);
      const cx = Math.cos(a),
        cz = Math.sin(a);
      o[0] = r * cx;
      o[1] = 0;
      o[2] = r * cz;
      o[3] = cx * sa;
      o[4] = ca;
      o[5] = cz * sa;
      if ((shType === 8 || shType === 9) && shLen > 0) {
        const tt = Math.random() * shLen;
        o[0] += o[3] * tt;
        o[1] += o[4] * tt;
        o[2] += o[5] * tt;
      }
    }
  };

  const uvTilesX = Math.max(1, uvMod.tilesX | 0 || 1),
    uvTilesY = Math.max(1, uvMod.tilesY | 0 || 1);
  const uvAnimType = uvMod.animationType | 0;
  const uvRowIndex = uvMod.rowIndex | 0,
    uvCycles = uvMod.cycles || 1;
  const uvFrames = uvOn ? (uvAnimType === 1 ? uvTilesX : uvTilesX * uvTilesY) : 1;
  function uvFrameOf(i) {
    const t = P.life[i] > 0 ? P.age[i] / P.life[i] : 0;
    const fnorm = evalMMCurve(uvMod.frameOverTime, t, P.rnd[i]);
    const sf = evalMMCurve(uvMod.startFrame, 0, P.rnd[i]) || 0;
    let frame = Math.floor(fnorm * uvCycles * uvFrames + sf);
    frame = ((frame % uvFrames) + uvFrames) % uvFrames;
    return uvAnimType === 1 ? uvRowIndex * uvTilesX + frame : frame;
  }

  const nzFreq = noiseMod.frequency || 0.5;
  const nzOct = Math.max(1, Math.min(4, noiseMod.octaves | 0 || 1));
  const nzOctMul = noiseMod.octaveMultiplier != null ? noiseMod.octaveMultiplier : 0.5;
  const nzOctScale = noiseMod.octaveScale != null ? noiseMod.octaveScale : 2;
  const nzSep = !!noiseMod.separateAxes;
  let nzTime = 0;

  let selfEmit = true,
    emitEvents = false,
    ox = 0,
    oy = 0,
    oz = 0;
  const births = [],
    deaths = [];

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
  };

  const viewAligned = sys.renderAlignment == null || sys.renderAlignment === 0 || sys.renderAlignment === 3;
  const stretched = sys.renderMode === 1;
  const backend = useMesh
    ? makeMeshBackend(T, maxP, P, opt.meshGeo, tex)
    : makeBillboardBackend(T, maxP, P, {
        tex,
        uv: { on: uvOn, tilesX: uvTilesX, tilesY: uvTilesY, frameOf: uvFrameOf },
        solid: opt.solid,
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
  if (unityMesh && unityMesh.material) {
    const mm = unityMesh.material;
    if (opt.matOpaque) {
      mm.blending = T.NormalBlending;
      mm.transparent = false;
      mm.depthWrite = true;
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
  const startDelayV = Math.max(0, sampleMM(ps.startDelay, Math.random()) || 0);
  let emitAcc = 0,
    sysTime = 0,
    curLoop = -1;
  const burstFired = new Array(bursts.length).fill(0);
  const rateOver = () => (opt.emissionRateOverride != null ? opt.emissionRateOverride : evalMMCurve(em.rateOverTime, 0));
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
    P.life[idx] = Math.max(0.05, sampleMM(init.startLifetime, rn));
    const sx = sampleMM(init.startSize, rn) || 1;
    P.sx[idx] = sx;
    P.sy[idx] = size3D ? sampleMM(init.startSizeY, rn) || sx : sx;
    P.sz[idx] = size3D ? sampleMM(init.startSizeZ, rn) || sx : sx;
    P.rx[idx] = rot3D ? sampleMM(init.startRotationX, rn) || 0 : 0;
    P.ry[idx] = rot3D ? sampleMM(init.startRotationY, rn) || 0 : 0;
    P.rz[idx] = sampleMM(init.startRotation, rn) || 0;
    P.grav[idx] = sampleMM(init.gravityModifier, rn) || 0;
    const spd = sampleMM(init.startSpeed, rn);
    sampleShape(_shapeSample);
    _sp
      .set(_shapeSample[0] * shScale.x, _shapeSample[1] * shScale.y, _shapeSample[2] * shScale.z)
      .applyMatrix4(shapeRotMat)
      .add(shPosV);
    _sd.set(_shapeSample[3], _shapeSample[4], _shapeSample[5]).applyMatrix4(shapeRotMat);
    P.px[idx] = _sp.x + ox;
    P.py[idx] = _sp.y + oy;
    P.pz[idx] = _sp.z + oz;
    P.vx[idx] = _sd.x * spd;
    P.vy[idx] = _sd.y * spd;
    P.vz[idx] = _sd.z * spd;
    if (emitEvents) births.push(P.px[idx], P.py[idx], P.pz[idx]);
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
    if (looping) {
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
          const cnt = (Math.round(sampleMM(bd.count, Math.random())) || 0) * volley;
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
  const update = (dt) => {
    dt *= simSpeed;
    if (emitEvents) {
      births.length = 0;
      deaths.length = 0;
    }
    emit(dt);
    if (noiseOn) nzTime += evalMMCurve(noiseMod.scrollSpeed, 0) * dt;
    let n = 0;
    for (let i = 0; i < maxP; i++) {
      if (!P.alive[i]) continue;
      P.age[i] += dt;
      if (P.age[i] >= P.life[i]) {
        if (emitEvents) deaths.push(P.px[i], P.py[i], P.pz[i]);
        P.alive[i] = 0;
        continue;
      }
      const t = P.age[i] / P.life[i];
      P.vy[i] -= gravityBase * P.grav[i] * dt;
      if (forceOn) {
        P.vx[i] += evalMMCurve(forceMod.x, t) * dt;
        P.vy[i] += evalMMCurve(forceMod.y, t) * dt;
        P.vz[i] += evalMMCurve(forceMod.z, t) * dt;
      }
      if (rotOn) {
        if (rotSep) {
          P.rx[i] += evalMMCurve(rotMod.x, t) * dt;
          P.ry[i] += evalMMCurve(rotMod.y, t) * dt;
        }
        P.rz[i] += evalMMCurve(rotMod.curve, t) * dt;
      }
      let vlx = 0,
        vly = 0,
        vlz = 0;
      if (velOn) {
        vlx = evalMMCurve(velMod.x, t);
        vly = evalMMCurve(velMod.y, t);
        vlz = evalMMCurve(velMod.z, t);
      }
      let nzSizeF = 1;
      if (noiseOn) {
        const px = P.px[i] * nzFreq,
          py = P.py[i] * nzFreq,
          pz = P.pz[i] * nzFreq;
        const nx = fbmNoise(px + nzTime, py, pz, 0, nzOct, nzOctMul, nzOctScale);
        const ny = fbmNoise(px, py + nzTime, pz, 17, nzOct, nzOctMul, nzOctScale);
        const nz = fbmNoise(px, py, pz + nzTime, 43, nzOct, nzOctMul, nzOctScale);
        const sX = evalMMCurve(noiseMod.strength, t),
          sY = nzSep ? evalMMCurve(noiseMod.strengthY, t) : sX,
          sZ = nzSep ? evalMMCurve(noiseMod.strengthZ, t) : sX;
        const posAmt = evalMMCurve(noiseMod.positionAmount, t);
        const pa = posAmt === 0 ? 1 : posAmt;
        vlx += nx * sX * pa;
        vly += ny * sY * pa;
        vlz += nz * sZ * pa;
        const rotAmt = evalMMCurve(noiseMod.rotationAmount, t);
        if (rotAmt) P.rz[i] += nx * rotAmt * dt;
        const szAmt = evalMMCurve(noiseMod.sizeAmount, t);
        if (szAmt) nzSizeF = Math.max(0, 1 + nx * szAmt);
      }
      if (clampOn) {
        const lim = evalMMCurve(clampMod.magnitude, t);
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
      P.px[i] += (P.vx[i] + vlx) * dt;
      P.py[i] += (P.vy[i] + vly) * dt;
      P.pz[i] += (P.vz[i] + vlz) * dt;
      evalMMGradient(startColor, P.rnd[i], scol);
      if (colMod.enabled) {
        evalGradient(colMod.gradient && colMod.gradient.maxGradient, t, tmpCol);
        scol[0] *= tmpCol[0];
        scol[1] *= tmpCol[1];
        scol[2] *= tmpCol[2];
        scol[3] *= tmpCol[3];
      }
      let smx = 1;
      if (sizeMod.enabled) smx = evalMMCurve(sizeMod.curve, t) || 1;
      let smy = smx,
        smz = smx;
      if (sizeSep) {
        smy = evalMMCurve(sizeMod.y, t) || 1;
        smz = evalMMCurve(sizeMod.z, t) || 1;
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
  return {
    unityMesh,
    update,
    dispose: disposeFn,
    emitAt,
    births,
    deaths,
    doPrewarm,
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
  const gateHidden = (p) => {
    if (!gateOn || !p) return false;
    if (inactive.some((ip) => p === ip || p.startsWith(ip + '/'))) return true;
    for (const [ep, ev] of emissionMap) if (ev <= 0.0001 && (p === ep || p.startsWith(ep + '/'))) return true;
    return false;
  };
  for (const sys of data.systems) {
    if (gateHidden(sys.path)) continue;
    const so = { ...(opt || {}) };
    so.meshGeo = data.meshGeo;
    if (gateOn && emissionMap.has(sys.path) && emissionMap.get(sys.path) > 0.0001) so.emissionRateOverride = emissionMap.get(sys.path);
    const e = texByMatPid && sys.matPid ? texByMatPid.get(sys.matPid) : null;
    if (e) {
      so.texture = e.tex || null;
      so.matAdditive = e.blend === 'add';
      so.matOpaque = e.blend === 'opaque';
      so.solid = e.solid;
      so.tint = e.tint;
      if (e.solid && !so.texture) so.solid = /black|white|bg|背景/i.test(sys.name || '');
    }
    const s = createSystem(THREE_NS, sys, so);
    s._sys = sys;
    s._subDriven = false;
    const p = sys.pos || { x: 0, y: 0, z: 0 };
    s.unityMesh.position.set(p.x || 0, p.y || 0, p.z || 0);
    const sc = sys.scale || { x: 1, y: 1, z: 1 };
    s.unityMesh.scale.set(sc.x || 1, sc.y || 1, sc.z || 1);
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
    {
      const nm = sys.name || '';
      const isBgFlash = /black|white|背景/i.test(nm);
      s.unityMesh.renderOrder = (sys.sortingOrder || 0) + (isBgFlash ? 0 : 1000);
    }
    const q = sys.rot;
    if (q && (q.x || q.y || q.z || q.w !== 1)) s.unityMesh.quaternion.set(q.x || 0, q.y || 0, q.z || 0, q.w == null ? 1 : q.w);
    if (sys.renderMode !== 5) group.add(s.unityMesh);
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
    parent.enableEvents();
    links.push({ parent, child, type: lk.type, prob: lk.prob });
  }
  for (const s of sims) if (!s._subDriven && s.doPrewarm) s.doPrewarm();
  const _wp = new THREE_NS.Vector3(),
    _cl = new THREE_NS.Vector3(),
    _inv = new THREE_NS.Matrix4();
  return {
    group,
    update(dt) {
      for (const s of sims) s.update(dt);
      for (const L of links) {
        const src = L.type === 0 ? L.parent.births : L.parent.deaths;
        if (!src.length) continue;
        L.parent.unityMesh.updateMatrix();
        L.child.unityMesh.updateMatrix();
        _inv.copy(L.child.unityMesh.matrix).invert();
        const cnt = L.type === 0 ? 1 : 3;
        for (let k = 0; k + 2 < src.length; k += 3) {
          if (Math.random() > L.prob) continue;
          _wp.set(src[k], src[k + 1], src[k + 2]).applyMatrix4(L.parent.unityMesh.matrix);
          _cl.copy(_wp).applyMatrix4(_inv);
          L.child.emitAt(_cl.x, _cl.y, _cl.z, cnt);
        }
      }
    },
    dispose() {
      for (const s of sims) s.dispose();
    },
    systemCount: sims.length,
  };
}

export const auraRenderer = { createAuraParticles };
