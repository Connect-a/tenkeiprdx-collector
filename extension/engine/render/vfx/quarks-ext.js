import * as THREE from '../../../vendor/three.module.js';
import * as TQ from '../../../vendor/three.quarks.esm.js';

export * from '../../../vendor/three.quarks.esm.js';

const { ParticleSystem, SpriteBatch, TrailBatch, BatchedRenderer, RenderMode } = TQ;

const DEFAULT_TP = Object.freeze({ align: null, customCount: 0, ageTiles: 0, gameShader: null, lit: null });

function tpSettingsOf(params) {
  return {
    align: params.tpAlign == null ? null : params.tpAlign | 0,
    customCount: params.tpCustomCount | 0,
    ageTiles: params.tpAgeTiles | 0,
    gameShader: params.tpGameShader || null,
    lit: params.tpLit || null,
  };
}

export function createParticleSystem(params) {
  const ps = new ParticleSystem(params);
  ps.rendererSettings.tp = tpSettingsOf(params);
  ps.tpAlign = params.tpAlign ?? null;
  ps.tpAllowRoll = params.tpAllowRoll ?? true;
  ps.tpShapeScaleOnly = params.tpShapeScaleOnly ?? false;
  ps.tpMaxParticles = params.tpMaxParticles > 0 ? params.tpMaxParticles | 0 : 0;
  return ps;
}

const origSpawn = ParticleSystem.prototype.spawn;
ParticleSystem.prototype.spawn = function (count, emissionState, matrix) {
  const cap = this.tpMaxParticles;
  return origSpawn.call(this, cap > 0 ? Math.max(0, Math.min(count, cap - this.particleNum)) : count, emissionState, matrix);
};

export function disposeBatchedRenderer(renderer) {
  for (const b of renderer.batches) {
    b.dispose();
    if (b.material) b.material.dispose();
    const src = b.settings && b.settings.material;
    if (src && src !== b.material) src.dispose();
  }
  renderer.batches.length = 0;
  renderer.systemToBatchIndex.clear();
}

let pendingSettings = null;

function tpOf(batch) {
  const s = batch.settings;
  if (s.tp) return s.tp;
  const src = pendingSettings;
  s.tp = (src && src.tp) || DEFAULT_TP;
  return s.tp;
}

const settingsTp = (s) => s.tp || DEFAULT_TP;
const sameList = (a, b) => a === b || (!!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]));
const sameLit = (a, b) =>
  a === b ||
  (!!a &&
    !!b &&
    a.metallic === b.metallic &&
    a.perceptualRoughness === b.perceptualRoughness &&
    a.envCube === b.envCube &&
    sameList(a.emission, b.emission) &&
    sameList(a.env, b.env) &&
    sameList(a.envHdr, b.envHdr) &&
    sameList(a.lightDir, b.lightDir) &&
    sameList(a.lightColor, b.lightColor));
const sameTp = (a, b) => a.align === b.align && a.customCount === b.customCount && a.ageTiles === b.ageTiles && a.gameShader === b.gameShader && sameLit(a.lit, b.lit);

function tpDecompose(m, position, quaternion, scale) {
  const te = m.elements;
  const l0 = Math.hypot(te[0], te[1], te[2]);
  const l1 = Math.hypot(te[4], te[5], te[6]);
  const l2 = Math.hypot(te[8], te[9], te[10]);
  const EPS = 1e-8;
  if (l0 > EPS && l1 > EPS && l2 > EPS) {
    THREE.Matrix4.prototype.decompose.call(m, position, quaternion, scale);
    return;
  }
  position.set(te[12], te[13], te[14]);
  scale.set(l0, l1, l2);
  const c = [
    l0 > EPS ? [te[0] / l0, te[1] / l0, te[2] / l0] : null,
    l1 > EPS ? [te[4] / l1, te[5] / l1, te[6] / l1] : null,
    l2 > EPS ? [te[8] / l2, te[9] / l2, te[10] / l2] : null,
  ];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  if (!c[0] && c[1] && c[2]) c[0] = cross(c[1], c[2]);
  else if (!c[1] && c[2] && c[0]) c[1] = cross(c[2], c[0]);
  else if (!c[2] && c[0] && c[1]) c[2] = cross(c[0], c[1]);
  if (!c[0] || !c[1] || !c[2]) {
    quaternion.set(0, 0, 0, 1);
    return;
  }
  quatFromColumns(quaternion, c[0][0], c[0][1], c[0][2], c[1][0], c[1][1], c[1][2], c[2][0], c[2][1], c[2][2]);
}

function quatFromColumns(out, m00, m10, m20, m01, m11, m21, m02, m12, m22) {
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1.0);
    w = 0.25 / s;
    x = (m21 - m12) * s;
    y = (m02 - m20) * s;
    z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  return out.set(x, y, z, w);
}

const ALIGN_IDENT = new THREE.Quaternion();
const alignQ = new THREE.Quaternion();
const alignFwd = new THREE.Vector3();
const alignRight = new THREE.Vector3();
const alignUp = new THREE.Vector3();
const alignCamUp = new THREE.Vector3();
const alignCamPos = new THREE.Vector3();

function basisFromForward(out, fwd, upRef) {
  alignRight.crossVectors(upRef, fwd);
  if (alignRight.lengthSq() < 1e-12) {
    alignRight.set(upRef.y, upRef.z, upRef.x);
    alignRight.crossVectors(alignRight, fwd);
    if (alignRight.lengthSq() < 1e-12) return out.set(0, 0, 0, 1);
  }
  alignRight.normalize();
  alignUp.crossVectors(fwd, alignRight);
  return quatFromColumns(out, alignRight.x, alignRight.y, alignRight.z, alignUp.x, alignUp.y, alignUp.z, fwd.x, fwd.y, fwd.z);
}

const alignCamera = (batch) => batch.tpCamera || (batch.parent && batch.parent.tpCamera) || null;

function alignBase(batch, system, emitterQ, particle, worldPos) {
  const a = system.tpAlign;
  const localQ = () => (particle.parentMatrix ? batch.quaternion3_.setFromRotationMatrix(particle.parentMatrix) : emitterQ);
  if (a == null) return system.worldSpace ? null : localQ();
  if (a === 1) return ALIGN_IDENT;
  if (a === 2) return localQ();
  const cam = alignCamera(batch);
  const ce = cam ? cam.matrixWorld.elements : null;
  const rollFree = system.tpAllowRoll === false;
  if (ce && !rollFree) alignCamUp.set(ce[4], ce[5], ce[6]);
  else alignCamUp.set(0, 1, 0);
  if (a === 4) {
    alignFwd.copy(particle.velocity);
    if (!system.worldSpace) alignFwd.applyQuaternion(localQ());
    if (alignFwd.lengthSq() < 1e-12) return ALIGN_IDENT;
    return basisFromForward(alignQ, alignFwd.normalize(), alignCamUp);
  }
  if (!cam || (a !== 0 && a !== 3)) return system.worldSpace ? null : localQ();
  if (a === 0) {
    if (!rollFree) return alignQ.setFromRotationMatrix(cam.matrixWorld);
    alignFwd.set(ce[8], ce[9], ce[10]);
    return basisFromForward(alignQ, alignFwd.normalize(), alignCamUp);
  }
  alignCamPos.set(ce[12], ce[13], ce[14]);
  alignFwd.copy(alignCamPos).sub(worldPos);
  if (alignFwd.lengthSq() < 1e-12) return ALIGN_IDENT;
  return basisFromForward(alignQ, alignFwd.normalize(), alignCamUp);
}

const isQuadMode = (m) => m === RenderMode.BillBoard || m === RenderMode.StretchedBillBoard;
const needsAlignQuad = (a) => a === 1 || a === 2 || a === 3 || a === 4;
const isFlatBillboard = (m) => m === RenderMode.BillBoard || m === RenderMode.HorizontalBillBoard || m === RenderMode.VerticalBillBoard;
const isSpecialMaterial = (mat) => mat.type === 'MeshStandardMaterial' || mat.type === 'MeshPhysicalMaterial';

const GLSL_BASIS = `mat3 tpBasis(vec4 q) {
    float x2 = q.x + q.x, y2 = q.y + q.y, z2 = q.z + q.z;
    float xx = q.x * x2, xy = q.x * y2, xz = q.x * z2;
    float yy = q.y * y2, yz = q.y * z2, zz = q.z * z2;
    float wx = q.w * x2, wy = q.w * y2, wz = q.w * z2;
    return mat3(1.0 - (yy + zz), xy + wz, xz - wy,
                xy - wz, 1.0 - (xx + zz), yz + wx,
                xz + wy, yz - wx, 1.0 - (xx + yy));
}`;
const GLSL_CUSTOM_ATTR = `
#ifdef TP_CUSTOM1
attribute vec4 tpCustom1;
varying vec4 vTpCustom1;
#endif
#ifdef TP_CUSTOM2
attribute vec4 tpCustom2;
varying vec4 vTpCustom2;
#endif`;
const GLSL_CUSTOM_COPY = `
    #ifdef TP_CUSTOM1
    vTpCustom1 = tpCustom1;
    #endif
    #ifdef TP_CUSTOM2
    vTpCustom2 = tpCustom2;
    #endif
`;

function editShader(src, label, edits) {
  let out = src;
  for (const [how, at, text, until] of edits) {
    const i = out.indexOf(at);
    if (i < 0 || out.indexOf(at, i + 1) >= 0) throw new Error('quarks-ext: ' + label + ' の目印が 1 か所に定まらない: ' + at);
    if (how === 'after') out = out.slice(0, i + at.length) + text + out.slice(i + at.length);
    else if (how === 'before') out = out.slice(0, i) + text + out.slice(i);
    else if (how === 'replace') out = out.slice(0, i) + text + out.slice(i + at.length);
    else {
      const j = out.indexOf(until, i);
      if (j < 0) throw new Error('quarks-ext: ' + label + ' の終わりの目印が無い: ' + until);
      out = out.slice(0, i) + text + out.slice(how === 'range' ? j + until.length : j);
    }
  }
  return out;
}

const TILE_FRAGMENT_EDITS = [
  [
    'replace',
    'vec4 texelColor = texture2D( map, vUv);',
    `#ifdef TP_AGE_TILES
    float tpAgeK = floor( clamp( vTpCustom1.x, 0.0, 0.999999 ) * float( TP_AGE_TILES ) );
    vec4 texelColor = texture2D( map, vec2( ( vUv.x + tpAgeK ) / float( TP_AGE_TILES ), vUv.y ) );
  #else
    vec4 texelColor = texture2D( map, vUv);
  #endif`,
  ],
];

const PARTICLE_FRAG_EDITS = [
  [
    'before',
    'void main() {',
    `#ifdef TP_CUSTOM1
varying vec4 vTpCustom1;
#endif
#ifdef TP_CUSTOM2
varying vec4 vTpCustom2;
#endif

#ifdef TP_URP_LIT
uniform vec4 tpLitParams;
uniform vec3 tpEnv;
uniform vec3 tpLightDir;
uniform vec3 tpLightColor;
varying vec3 tpN;
varying vec3 tpV;
#ifdef TP_URP_LIT_CUBE
uniform samplerCube tpEnvCube;
uniform vec3 tpEnvHdr;
#endif
#ifdef TP_URP_LIT_EMISSION
uniform vec3 tpEmission;
#endif
#endif

`,
  ],
  [
    'after',
    'outgoingLight = diffuseColor.rgb;',
    `
    #ifdef TP_URP_LIT
    {
        vec3 N = normalize( tpN );
        vec3 V = normalize( tpV );
        vec3 L = normalize( tpLightDir );
        float metallic = tpLitParams.x;
        float pr = tpLitParams.y;
        float rough = max( pr * pr, 0.0078125 );
        float r2 = max( rough * rough, 1e-6 );
        float normTerm = rough * 4.0 + 2.0;
        float r2m1 = r2 - 1.0;
        vec3 albedo = diffuseColor.rgb;
        vec3 diff = albedo * ( 0.96 * ( 1.0 - metallic ) );
        vec3 F0 = mix( vec3( 0.04 ), albedo, metallic );
        vec3 H = normalize( L + V );
        float NoH = clamp( dot( N, H ), 0.0, 1.0 );
        float LoH = clamp( dot( L, H ), 0.0, 1.0 );
        float dd = NoH * NoH * r2m1 + 1.00001;
        float specTerm = r2 / ( ( dd * dd ) * max( 0.1, LoH * LoH ) * normTerm );
        float NdotL = clamp( dot( N, L ), 0.0, 1.0 );
        vec3 gi = ( diff + F0 ) * tpEnv;
        #ifdef TP_URP_LIT_CUBE
        {
            vec3 R = reflect( -V, N );
            float mip = pr * ( -pr * 0.7 + 1.7 ) * 6.0;
            vec4 envTex = textureCubeLodEXT( tpEnvCube, R, mip );
            float envM = max( tpEnvHdr.z * ( envTex.a - 1.0 ) + 1.0, 0.0 );
            vec3 envSpec = envTex.rgb * ( pow( envM, tpEnvHdr.y ) * tpEnvHdr.x );
            float NoV = clamp( dot( N, V ), 0.0, 1.0 );
            float fres = ( 1.0 - NoV ) * ( 1.0 - NoV );
            fres = fres * fres;
            float reflectivity = 1.0 - 0.96 * ( 1.0 - metallic );
            float grazing = clamp( reflectivity + ( 1.0 - pr ), 0.0, 1.0 );
            float surfRed = 1.0 / ( r2 + 1.0 );
            gi = diff * tpEnv + envSpec * ( surfRed * mix( F0, vec3( grazing ), fres ) );
        }
        #endif
        outgoingLight = ( diff + F0 * specTerm ) * ( tpLightColor * NdotL ) + gi;
        #ifdef TP_URP_LIT_EMISSION
        outgoingLight += tpEmission;
        #endif
    }
    #endif
`,
  ],
];

const PARTICLE_VERT_EDITS = [
  [
    'after',
    'attribute vec3 size;',
    `
#ifdef TP_ESCALE
attribute vec3 tpEScale;
#endif
${GLSL_CUSTOM_ATTR}
#ifdef TP_ALIGN
attribute vec4 tpAlignQ;
${GLSL_BASIS}
#endif`,
  ],
  ['after', 'void main() {', '\n' + GLSL_CUSTOM_COPY],
  [
    'replace',
    '#ifdef HORIZONTAL',
    `#ifdef TP_ESCALE
    rotatedPosition *= tpEScale.xy;
#endif
#ifdef TP_ALIGN
    mat3 tpB = tpBasis( tpAlignQ );
    vec3 tpWorld = ( modelMatrix * vec4( offset, 1.0 ) ).xyz + tpB[0] * rotatedPosition.x + tpB[1] * rotatedPosition.y;
    vec4 mvPosition = viewMatrix * vec4( tpWorld, 1.0 );
#elif defined(HORIZONTAL)`,
  ],
];

const LOCAL_PARTICLE_VERT_EDITS = [
  ['after', 'attribute vec3 size;', '\nattribute vec4 tpBaseQ;\nattribute vec3 tpEScale;'],
  [
    'after',
    '// attribute vec4 color;',
    `

#ifdef TP_URP_LIT
varying vec3 tpN;
varying vec3 tpV;
#endif
${GLSL_CUSTOM_ATTR}

mat3 tpQuatMat3( vec4 q ) {
    float x2 = q.x + q.x, y2 = q.y + q.y, z2 = q.z + q.z;
    float xx = q.x * x2, xy = q.x * y2, xz = q.x * z2;
    float yy = q.y * y2, yz = q.y * z2, zz = q.z * z2;
    float wx = q.w * x2, wy = q.w * y2, wz = q.w * z2;
    return mat3( 1.0 - ( yy + zz ), xy + wz, xz - wy,
                 xy - wz, 1.0 - ( xx + zz ), yz + wx,
                 xz + wy, yz - wx, 1.0 - ( xx + yy ) );
}`,
  ],
  ['upto', 'float x2 = rotation.x + rotation.x', GLSL_CUSTOM_COPY + '\n    ', 'float sx = size.x, sy = size.y, sz = size.z;'],
  [
    'range',
    'mat4 matrix = mat4(',
    `mat3 tpRp = tpQuatMat3( rotation );
    mat3 tpB = tpQuatMat3( tpBaseQ );
    mat3 tpM = tpB * mat3( tpEScale.x, 0.0, 0.0, 0.0, tpEScale.y, 0.0, 0.0, 0.0, tpEScale.z ) * tpRp;
    vec3 tpLocal = tpM * ( position * vec3( sx, sy, sz ) );

    vec4 mvPosition = modelViewMatrix * vec4( offset + tpLocal, 1.0 );`,
    'vec4 mvPosition = modelViewMatrix * (matrix * vec4( position, 1.0 ));',
  ],
  [
    'after',
    'vColor = color;',
    `

    #ifdef TP_URP_LIT
    {
        vec3 nObj = normal / max( vec3( sx, sy, sz ), vec3( 1e-6 ) );
        vec3 nLocal = tpB * ( ( tpRp * nObj ) / max( tpEScale, vec3( 1e-6 ) ) );
        tpN = normalize( mat3( modelMatrix ) * nLocal );
        vec3 wpos = ( modelMatrix * vec4( offset + tpLocal, 1.0 ) ).xyz;
        tpV = cameraPosition - wpos;
    }
    #endif`,
  ],
];

const STRETCHED_VERT_EDITS = [
  ['after', 'uniform float speedFactor;', `\n${GLSL_CUSTOM_ATTR}\n\n#ifdef TP_ALIGN\nattribute vec4 tpAlignQ;\n${GLSL_BASIS}\n#endif`],
  ['after', 'void main() {', '\n' + GLSL_CUSTOM_COPY],
  ['replace', 'float avgSize = (size.x + size.y) * 0.5;', 'float avgSize = (abs(size.x) + abs(size.y)) * 0.5;'],
  [
    'replace',
    '#ifdef USE_SKEW',
    `#ifdef TP_ALIGN
    mat3 tpB = tpBasis( tpAlignQ );
    vec3 tpWorldPos = ( modelMatrix * vec4( offset, 1.0 ) ).xyz;
    vec3 tpVel = mat3( modelMatrix ) * velocity.xyz;
    float vlength = length( tpVel );
    vec3 tpDir = vlength > 1e-6 ? tpVel / vlength : tpB[1];
    vec3 tpW = cross( tpB[2], tpDir );
    float tpWl = length( tpW );
    tpW = tpWl > 1e-6 ? tpW / tpWl : tpB[0];
    vec3 tpP = tpWorldPos + tpW * ( position.y * avgSize ) - tpDir * ( ( position.x + 0.5 ) * ( vlength + lengthFactor ) * avgSize );
    vec4 mvPosition = viewMatrix * vec4( tpP, 1.0 );
#elif defined(USE_SKEW)`,
  ],
  [
    'range',
    'mvPosition.xyz += position.y * normalize(cross(mvPosition.xyz, viewVelocity)) * avgSize;',
    `vec3 tpVDir = vlength > 1e-6 ? viewVelocity / vlength : vec3( 0.0, 1.0, 0.0 );
    mvPosition.xyz += position.y * normalize(cross(mvPosition.xyz, tpVDir)) * avgSize;
    mvPosition.xyz -= (position.x + 0.5) * tpVDir * ( vlength + lengthFactor ) * avgSize;`,
    '// minus position.x to match unity implementation',
  ],
];

const shaderCache = new Map();
function patchedShader(kind, src) {
  const key = kind + '\u0000' + src;
  let out = shaderCache.get(key);
  if (out === undefined) {
    const edits = kind === 'frag' ? PARTICLE_FRAG_EDITS : kind === 'mesh' ? LOCAL_PARTICLE_VERT_EDITS : kind === 'stretched' ? STRETCHED_VERT_EDITS : PARTICLE_VERT_EDITS;
    out = editShader(src, kind, edits);
    shaderCache.set(key, out);
  }
  return out;
}

THREE.ShaderChunk.tile_fragment = editShader(THREE.ShaderChunk.tile_fragment, 'tile_fragment', TILE_FRAGMENT_EDITS);

const origEquals = BatchedRenderer.equals;
BatchedRenderer.equals = function (a, b) {
  return origEquals.call(this, a, b) && sameTp(settingsTp(a), settingsTp(b));
};

const origRendererAddSystem = BatchedRenderer.prototype.addSystem;
BatchedRenderer.prototype.addSystem = function (system) {
  const prev = pendingSettings;
  pendingSettings = system.getRendererSettings();
  try {
    origRendererAddSystem.call(this, system);
    const i = this.systemToBatchIndex.get(system);
    if (i != null && this.batches[i]) tpOf(this.batches[i]);
  } finally {
    pendingSettings = prev;
  }
};

function instanced(batch, name, itemSize) {
  const b = new THREE.InstancedBufferAttribute(new Float32Array(batch.maxParticles * itemSize), itemSize);
  b.setUsage(THREE.DynamicDrawUsage);
  batch.geometry.setAttribute(name, b);
  return b;
}

const origBuildExpandable = SpriteBatch.prototype.buildExpandableBuffers;
SpriteBatch.prototype.buildExpandableBuffers = function () {
  origBuildExpandable.call(this);
  const tp = tpOf(this);
  const mode = this.settings.renderMode;
  this.tpBaseQBuffer = mode === RenderMode.Mesh ? instanced(this, 'tpBaseQ', 4) : null;
  this.tpEScaleBuffer = mode === RenderMode.Mesh || isFlatBillboard(mode) ? instanced(this, 'tpEScale', 3) : null;
  this.tpAlignBuffer = isQuadMode(mode) && needsAlignQuad(tp.align) ? instanced(this, 'tpAlignQ', 4) : null;
  this.tpCustomBuffers = null;
  if (tp.customCount > 0) {
    this.tpCustomBuffers = [];
    for (let k = 0; k < tp.customCount && k < 2; k++) this.tpCustomBuffers.push(instanced(this, 'tpCustom' + (k + 1), 4));
  }
};

const LATE_DEFINES = ['VERTICAL', 'HORIZONTAL'];

const origRebuildMaterial = SpriteBatch.prototype.rebuildMaterial;
SpriteBatch.prototype.rebuildMaterial = function () {
  origRebuildMaterial.call(this);
  const tp = tpOf(this);
  const s = this.settings;
  const src = s.material;
  const mode = s.renderMode;
  const special = mode === RenderMode.Mesh && isSpecialMaterial(src);
  const m = this.material;
  const defines = m.defines;
  const uniforms = m.uniforms;
  const lit = tp.lit;
  if (lit && mode === RenderMode.Mesh) {
    defines.TP_URP_LIT = '';
    uniforms.tpLitParams = new THREE.Uniform(new THREE.Vector4(lit.metallic || 0, lit.perceptualRoughness || 0, 0, 0));
    uniforms.tpEnv = new THREE.Uniform(new THREE.Vector3(lit.env[0], lit.env[1], lit.env[2]));
    uniforms.tpLightDir = new THREE.Uniform(new THREE.Vector3(lit.lightDir[0], lit.lightDir[1], lit.lightDir[2]));
    uniforms.tpLightColor = new THREE.Uniform(new THREE.Vector3(lit.lightColor[0], lit.lightColor[1], lit.lightColor[2]));
    if (lit.envCube) {
      defines.TP_URP_LIT_CUBE = '';
      uniforms.tpEnvCube = new THREE.Uniform(lit.envCube);
      const hdr = lit.envHdr && lit.envHdr.length === 3 ? lit.envHdr : [1, 1, 0];
      uniforms.tpEnvHdr = new THREE.Uniform(new THREE.Vector3(hdr[0], hdr[1], hdr[2]));
    }
    if (lit.emission) {
      defines.TP_URP_LIT_EMISSION = '';
      uniforms.tpEmission = new THREE.Uniform(new THREE.Vector3(lit.emission[0], lit.emission[1], lit.emission[2]));
    }
  }
  if (tp.customCount > 0) defines.TP_CUSTOM1 = '';
  if (tp.customCount > 1) defines.TP_CUSTOM2 = '';
  if (tp.customCount > 0 && tp.ageTiles > 1) defines.TP_AGE_TILES = String(tp.ageTiles);
  if (isQuadMode(mode) && needsAlignQuad(tp.align)) defines.TP_ALIGN = '';
  if (isFlatBillboard(mode)) defines.TP_ESCALE = '';

  const game = tp.gameShader;
  if (game && game.vert && game.frag) {
    const softBeforeRender = Object.prototype.hasOwnProperty.call(m, 'onBeforeRender') ? m.onBeforeRender : null;
    const gameDefines = Object.assign({}, defines);
    for (const k of LATE_DEFINES) delete gameDefines[k];
    if (special) delete gameDefines.USE_COLOR;
    const gu = Object.assign({}, game.uniforms || {});
    if (uniforms.tileCount) gu.tileCount = uniforms.tileCount;
    m.dispose();
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: gu,
      defines: gameDefines,
      vertexShader: game.vert,
      fragmentShader: game.frag,
      transparent: src.transparent,
      depthWrite: !src.transparent,
      blending: src.blending,
      blendDst: src.blendDst,
      blendSrc: src.blendSrc,
      blendEquation: src.blendEquation,
      premultipliedAlpha: src.premultipliedAlpha,
      side: src.side,
      depthTest: src.depthTest,
    });
    if (game.wire) {
      this.material.onBeforeRender = (renderer, scene, camera) => {
        if (softBeforeRender) softBeforeRender(renderer, scene, camera);
        game.wire(renderer, camera);
      };
    } else if (softBeforeRender) this.material.onBeforeRender = softBeforeRender;
    return;
  }
  if (special) return;
  const kind = mode === RenderMode.Mesh ? 'mesh' : mode === RenderMode.StretchedBillBoard ? 'stretched' : 'quad';
  m.vertexShader = patchedShader(kind, m.vertexShader);
  m.fragmentShader = patchedShader('frag', m.fragmentShader);
};

const postPos = new THREE.Vector3();
const postTranslation = new THREE.Vector3();
const postScale = new THREE.Vector3();
const postRotation = new THREE.Quaternion();

function markRange(buf, count) {
  if (!buf) return;
  buf.clearUpdateRanges();
  buf.addUpdateRange(0, count * buf.itemSize);
  buf.needsUpdate = true;
}

function decomposeKeepingZeroAxes(position, quaternion, scale) {
  tpDecompose(this, position, quaternion, scale);
  return this;
}

function withEmitterDecompose(batch, run) {
  const touched = [];
  for (const system of batch.systems) {
    const m = system.emitter.matrixWorld;
    if (Object.prototype.hasOwnProperty.call(m, 'decompose')) continue;
    m.decompose = decomposeKeepingZeroAxes;
    touched.push(m);
  }
  try {
    run();
  } finally {
    for (const m of touched) delete m.decompose;
  }
}

const origTrailUpdate = TrailBatch.prototype.update;
TrailBatch.prototype.update = function () {
  withEmitterDecompose(this, () => origTrailUpdate.call(this));
};

const origSpriteUpdate = SpriteBatch.prototype.update;
SpriteBatch.prototype.update = function () {
  withEmitterDecompose(this, () => origSpriteUpdate.call(this));
  const mode = this.settings.renderMode;
  const isMesh = mode === RenderMode.Mesh;
  let index = 0;
  for (const system of this.getVisibleSystems()) {
    const particles = system.particles;
    const particleNum = system.particleNum;
    tpDecompose(system.emitter.matrixWorld, postTranslation, postRotation, postScale);
    for (let j = 0; j < particleNum; j++, index++) {
      const particle = particles[j];
      let vec;
      if (system.worldSpace) vec = particle.position;
      else {
        vec = postPos;
        if (particle.parentMatrix) vec.copy(particle.position).applyMatrix4(particle.parentMatrix);
        else vec.copy(particle.position).applyMatrix4(system.emitter.matrixWorld);
      }
      const noEmitScale = system.worldSpace || particle.parentMatrix || system.tpShapeScaleOnly;
      if (this.tpEScaleBuffer) {
        if (noEmitScale) this.tpEScaleBuffer.setXYZ(index, 1, 1, 1);
        else this.tpEScaleBuffer.setXYZ(index, Math.abs(postScale.x), Math.abs(postScale.y), Math.abs(postScale.z));
      }
      if (isMesh) {
        const base = alignBase(this, system, postRotation, particle, vec);
        const p = particle.rotation;
        this.rotationBuffer.setXYZW(index, p.x, p.y, p.z, p.w);
        const b = base === null ? ALIGN_IDENT : base;
        this.tpBaseQBuffer.setXYZW(index, b.x, b.y, b.z, b.w);
      } else if (this.tpAlignBuffer) {
        const b = alignBase(this, system, postRotation, particle, vec) || ALIGN_IDENT;
        this.tpAlignBuffer.setXYZW(index, b.x, b.y, b.z, b.w);
      }
      if (this.tpEScaleBuffer || noEmitScale) this.sizeBuffer.setXYZ(index, particle.size.x, particle.size.y, particle.size.z);
      else this.sizeBuffer.setXYZ(index, particle.size.x * Math.abs(postScale.x), particle.size.y * Math.abs(postScale.y), particle.size.z * Math.abs(postScale.z));
      if (this.tpCustomBuffers) {
        for (let k = 0; k < this.tpCustomBuffers.length; k++) {
          const v = particle['tpCustom' + (k + 1)];
          if (v) this.tpCustomBuffers[k].setXYZW(index, v.x, v.y, v.z, v.w);
          else this.tpCustomBuffers[k].setXYZW(index, 0, 0, 0, 1);
        }
      }
    }
  }
  if (index > 0) {
    if (this.tpCustomBuffers) for (const b of this.tpCustomBuffers) markRange(b, index);
    markRange(this.tpBaseQBuffer, index);
    markRange(this.tpAlignBuffer, index);
    markRange(this.tpEScaleBuffer, index);
  }
};
