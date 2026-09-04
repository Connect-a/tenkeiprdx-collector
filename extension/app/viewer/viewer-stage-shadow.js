import * as THREE from '../../vendor/three.module.js';
import { SHADOW_OPACITY } from './viewer-shadow.js';

export const LAYER_CHAR = 2;
export const LAYER_FIELD_SHADOW = 3;

const FIELD_SIZE = 2048;
const FIELD_EXTENT = 40;
const CHAR_SIZE = 2048;
const CHAR_EXTENT = 8;
const CHAR_BIAS = 0.0015;
const BIAS_MATRIX = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
const FALLBACK_DIR = new THREE.Vector3(0.4, 1, 0.8).normalize();

const depthRT = (size) => {
  const rt = new THREE.WebGLRenderTarget(size, size);
  rt.depthTexture = new THREE.DepthTexture(size, size, THREE.UnsignedIntType);
  rt.depthTexture.format = THREE.DepthFormat;
  rt.depthTexture.compareFunction = THREE.LessEqualCompare;
  rt.depthTexture.minFilter = THREE.LinearFilter;
  rt.depthTexture.magFilter = THREE.LinearFilter;
  return rt;
};

export function createShadows(scene, renderer, deps) {
  const { anchor, state, core, mainLight, fieldGroup } = deps;

  const light = new THREE.DirectionalLight(0xffffff, 0);
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.bias = -0.0006;
  const sc = light.shadow.camera;
  sc.left = -8;
  sc.right = 8;
  sc.top = 8;
  sc.bottom = -8;
  sc.near = 0.5;
  sc.far = 40;
  sc.updateProjectionMatrix();
  scene.add(light);
  scene.add(light.target);

  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: SHADOW_OPACITY, transparent: true, side: THREE.DoubleSide }));
  catcher.receiveShadow = true;
  catcher.material.depthWrite = false;
  catcher.visible = false;
  scene.add(catcher);

  const fieldCam = new THREE.OrthographicCamera(-FIELD_EXTENT, FIELD_EXTENT, FIELD_EXTENT, -FIELD_EXTENT, 0.5, FIELD_EXTENT * 4);
  fieldCam.layers.set(LAYER_FIELD_SHADOW);
  const fieldDepthMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    side: THREE.DoubleSide,
    colorWrite: false,
    uniforms: { uLightDir: { value: new THREE.Vector3(0, 1, 0) }, uBias: { value: new THREE.Vector2(0, 0) } },
    vertexShader: [
      'precision highp float;',
      'in vec3 position;',
      'in vec3 normal;',
      'uniform mat4 modelMatrix, viewMatrix, projectionMatrix;',
      'uniform vec3 uLightDir;',
      'uniform vec2 uBias;',
      'void main(){',
      '  vec4 w = modelMatrix * vec4( position, 1.0 );',
      '  vec3 n = normalize( mat3( modelMatrix ) * normal );',
      '  float invNdotL = 1.0 - clamp( dot( uLightDir, n ), 0.0, 1.0 );',
      '  vec3 p = w.xyz + uLightDir * uBias.x + n * ( invNdotL * uBias.y );',
      '  gl_Position = projectionMatrix * viewMatrix * vec4( p, 1.0 );',
      '}',
    ].join('\n'),
    fragmentShader: 'precision highp float;\nout vec4 o;\nvoid main(){ o = vec4( 1.0 ); }',
  });
  const fieldRT = depthRT(FIELD_SIZE);
  const field = { map: fieldRT, matrix: new THREE.Matrix4(), mapSize: new THREE.Vector2(FIELD_SIZE, FIELD_SIZE) };
  let fieldUniforms = [];

  const charCam = new THREE.OrthographicCamera(-CHAR_EXTENT, CHAR_EXTENT, CHAR_EXTENT, -CHAR_EXTENT, 0.5, CHAR_EXTENT * 6);
  charCam.layers.set(LAYER_CHAR);
  const charDepthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking, side: THREE.DoubleSide });
  const charRT = depthRT(CHAR_SIZE);
  const char = { map: charRT.depthTexture, matrix: new THREE.Matrix4(), strength: 0 };
  let charUniforms = [];

  let primed = false;
  function prime() {
    if (primed) return;
    primed = true;
    for (const rt of [fieldRT, charRT]) {
      renderer.setRenderTarget(rt);
      renderer.clear();
    }
    renderer.setRenderTarget(null);
  }

  const bake = (cam, mat, rt) => {
    const prevMat = scene.overrideMaterial;
    const prevBg = scene.background;
    scene.overrideMaterial = mat;
    scene.background = null;
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(null);
    scene.overrideMaterial = prevMat;
    scene.background = prevBg;
  };

  const soft = () => {
    const l = mainLight();
    return !!(l && l.shadow && Number(l.shadow.type) === 2);
  };
  function charDir() {
    const l = mainLight();
    const md = l && l.dir;
    if (!md) return FALLBACK_DIR;
    const v = new THREE.Vector3(md[0], md[1], md[2]);
    if (!(v.lengthSq() > 1e-8)) return FALLBACK_DIR;
    v.normalize();
    return v.y < 0.15 ? FALLBACK_DIR : v;
  }

  let charKey = '';
  let charPosed = true;
  const charKeyOf = (d) => {
    let k = anchor.x.toFixed(3) + ',' + anchor.y.toFixed(3) + ',' + anchor.z.toFixed(3);
    k += '|' + d.x.toFixed(4) + ',' + d.y.toFixed(4) + ',' + d.z.toFixed(4) + '|' + char.strength;
    for (const c of state.scene.chars) {
      k += '|' + c.id + ':' + c.x + ',' + c.y + ',' + c.z + ':' + c.rotX + ',' + c.rotY + ',' + c.rotZ + ':' + c.scale;
      k += ':' + (c.motion || '') + ':' + (c.paused ? 1 : 0) + ':' + (core.live(c.id) ? 1 : 0);
    }
    return k;
  };

  return {
    field,
    char,
    catcher,
    markPosed() {
      charPosed = true;
    },
    setUniforms(fieldList, charList) {
      fieldUniforms = fieldList || [];
      charUniforms = charList || [];
    },
    renderField(l) {
      prime();
      for (const u of fieldUniforms) u.uShadowMap.value = fieldRT.depthTexture;
      if (!fieldGroup() || !l || !l.shadow || !(l.shadow.strength > 0)) {
        for (const u of fieldUniforms) u.uShadowStrength.value = 0;
        return;
      }
      const d = new THREE.Vector3(l.dir[0], l.dir[1], l.dir[2]).normalize();
      fieldCam.position.copy(anchor).addScaledVector(d, FIELD_EXTENT * 2);
      fieldCam.lookAt(anchor);
      fieldCam.updateMatrixWorld();
      fieldCam.updateProjectionMatrix();
      const texel = (2 * FIELD_EXTENT * 2) / FIELD_SIZE;
      const s = l.shadow.type === 2 ? Math.SQRT2 : 1;
      fieldDepthMat.uniforms.uLightDir.value.copy(d);
      fieldDepthMat.uniforms.uBias.value.set(-(l.shadow.bias || 0) * texel, -(l.shadow.normalBias || 0) * texel * s);
      field.matrix.copy(BIAS_MATRIX).multiply(fieldCam.projectionMatrix).multiply(fieldCam.matrixWorldInverse);
      bake(fieldCam, fieldDepthMat, fieldRT);
      for (const u of fieldUniforms) {
        u.uShadowMap.value = fieldRT.depthTexture;
        u.uShadowMatrix.value.copy(field.matrix);
      }
    },
    renderChar() {
      prime();
      if (!(char.strength > 0)) {
        charKey = '';
        for (const u of charUniforms) u.uCharShadowStrength.value = 0;
        return;
      }
      const d = charDir();
      const key = charKeyOf(d);
      if (!charPosed && key === charKey) return;
      charKey = key;
      charPosed = false;
      charCam.position.copy(anchor).addScaledVector(d, CHAR_EXTENT * 3);
      charCam.lookAt(anchor);
      charCam.updateMatrixWorld();
      charCam.updateProjectionMatrix();
      char.matrix.copy(BIAS_MATRIX).multiply(charCam.projectionMatrix).multiply(charCam.matrixWorldInverse);
      char.matrix.elements[14] -= CHAR_BIAS;
      bake(charCam, charDepthMat, charRT);
      for (const u of charUniforms) {
        u.uCharShadowMap.value = char.map;
        u.uCharShadowMatrix.value.copy(char.matrix);
        u.uCharShadowStrength.value = char.strength;
      }
    },
    applyMode() {
      const group = fieldGroup();
      let any = false;
      for (const c of state.scene.chars) {
        const inst = core.live(c.id);
        if (!inst) continue;
        const cast = state.scene.shadow === 'cast';
        if (cast) any = true;
        inst.root.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = cast;
          if (cast) o.layers.enable(LAYER_CHAR);
          else o.layers.disable(LAYER_CHAR);
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            if (!m) continue;
            m.shadowSide = THREE.DoubleSide;
          }
        });
      }
      char.strength = any && group ? SHADOW_OPACITY : 0;
      const useThree = any && !group;
      if (renderer.shadowMap.enabled !== useThree) {
        renderer.shadowMap.enabled = useThree;
        renderer.shadowMap.type = soft() ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
        scene.traverse((o) => {
          if (!o.material) return;
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
        });
      }
      light.castShadow = useThree;
      catcher.visible = useThree;
      catcher.position.set(anchor.x, anchor.y + 0.005, anchor.z);
      if (!any) return;
      const d = charDir();
      light.position.copy(anchor).addScaledVector(d, 14);
      light.target.position.copy(anchor);
      light.target.updateMatrixWorld();
    },
    dispose() {
      fieldRT.depthTexture.dispose();
      fieldRT.dispose();
      fieldDepthMat.dispose();
      charRT.depthTexture.dispose();
      charRT.dispose();
      charDepthMat.dispose();
      catcher.geometry.dispose();
      catcher.material.dispose();
    },
  };
}
