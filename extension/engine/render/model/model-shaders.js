const COMMON_GLSL = [
  'vec3 tpLinearToSrgb(vec3 c){',
  '  vec3 hi = pow(abs(c), vec3(0.416667)) * 1.055 - 0.055;',
  '  vec3 lo = c * 12.923210;',
  '  return mix(hi, lo, step(c, vec3(0.003131)));',
  '}',
  'vec3 tpRgbToHsv(vec3 c){',
  '  vec4 K = vec4(0.0, -0.333333, 0.666667, -1.0);',
  '  vec4 P = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));',
  '  vec4 Q = mix(vec4(P.xyw, c.r), vec4(c.r, P.yzx), step(P.x, c.r));',
  '  float D = Q.x - min(Q.w, Q.y);',
  '  return vec3(Q.z + (Q.w - Q.y) / (6.0 * D), D / Q.x, Q.x);',
  '}',
  'vec3 tpHsvToRgb(vec3 c){',
  '  vec3 ramp = clamp(abs(fract(c.xxx + vec3(1.0, 0.666667, 0.333333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);',
  '  return (1.0 + c.y * (ramp - 1.0)) * c.z;',
  '}',
  'float tpWrapHue(float h, float deg){',
  '  float v = abs(h) + deg * 0.002778;',
  '  v = (v > 1.0) ? v - 1.0 : v;',
  '  return (v < 0.0) ? v + 1.0 : v;',
  '}',
  'float tpSmooth(float x){ return x * x * (3.0 - 2.0 * x); }',
].join('\n');

const PIKAPIKA = [
  'vec3 hsv = tpRgbToHsv(tpLinearToSrgb(uTpColor.rgb));',
  'vec3 rgb = tpHsvToRgb(vec3(tpWrapHue(hsv.x, uTpHue), hsv.y, hsv.z));',
  'float ndv = dot(normalize(vTpNormal), normalize(vTpView));',
  'float f = clamp((pow(abs(ndv), 3.35) - 0.217638) * 1.04 + 0.217638, 0.0, 1.0);',
  'diffuseColor.rgb = tpLinearToSrgb(rgb);',
  'diffuseColor.a = pow(f, uTpPower);',
].join('\n');

const FIRE_MODEL_3_COLOR = [
  'float ndv = dot(normalize(vTpNormal), normalize(vTpView));',
  'float s = tpSmooth(min((abs(ndv) + 0.73) * 0.369004, 1.0));',
  'float inv = 1.0 / (uTpPower1 - uTpPower2);',
  'float t1 = tpSmooth(clamp((s - 0.07 - uTpPower2) * inv, 0.0, 1.0));',
  'float t2 = tpSmooth(clamp((s - 0.29 - uTpPower2) * inv, 0.0, 1.0));',
  'vec3 col = tpLinearToSrgb(uTpBase.rgb) + step(0.48, t1) * tpLinearToSrgb(uTpSecond.rgb) + step(0.27, t2) * tpLinearToSrgb(uTpThird.rgb);',
  'vec3 hsv = tpRgbToHsv(col);',
  'diffuseColor.rgb = tpLinearToSrgb(tpHsvToRgb(vec3(tpWrapHue(hsv.x, uTpHue), hsv.y, hsv.z)));',
  'diffuseColor.a = 1.0;',
].join('\n');

const color = (material, name, fallback) => {
  const v = (material.allColors || {})[name];
  return v ? [v[0], v[1], v[2], v[3] != null ? v[3] : 1] : fallback;
};
const float = (material, name, fallback) => {
  const v = (material.allFloats || {})[name];
  return typeof v === 'number' && isFinite(v) ? v : fallback;
};

const SPECS = {
  'Shader Graphs/pikapika': {
    body: PIKAPIKA,
    declarations: 'uniform vec4 uTpColor;\nuniform float uTpPower, uTpHue;\n',
    uniforms: (material) => ({
      uTpColor: color(material, '_Color', [1, 1, 1, 0]),
      uTpPower: float(material, '_power', 1),
      uTpHue: float(material, '_hue', 0),
    }),
  },
  'Shader Graphs/FireModel3Color': {
    body: FIRE_MODEL_3_COLOR,
    declarations: 'uniform vec4 uTpBase, uTpSecond, uTpThird;\nuniform float uTpPower1, uTpPower2, uTpHue;\n',
    uniforms: (material) => ({
      uTpBase: color(material, 'BaseColor', [1, 0.0481, 0, 0]),
      uTpSecond: color(material, 'SecondColor', [0.0625, 0.0034, 0, 0]),
      uTpThird: color(material, 'TherdColor', [4.9101, 0.4134, 0, 0]),
      uTpPower1: float(material, 'ColorPower1', 0.72),
      uTpPower2: float(material, 'ColorPower2', 0.08),
      uTpHue: float(material, 'Hue', 0),
    }),
  },
};

export const modelShaderFor = (shaderName) => SPECS[shaderName] || null;

export function applyModelShader(T, mat, spec, material) {
  const values = spec.uniforms(material);
  mat.onBeforeCompile = (shader) => {
    for (const [key, v] of Object.entries(values)) shader.uniforms[key] = { value: Array.isArray(v) ? new T.Vector4(v[0], v[1], v[2], v[3]) : v };
    shader.vertexShader =
      'varying vec3 vTpNormal;\nvarying vec3 vTpView;\n' +
      shader.vertexShader
        .replace('#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )', '#if 1')
        .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\n\tvTpNormal = mat3( modelMatrix ) * objectNormal;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n\tvTpView = cameraPosition - ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    shader.fragmentShader =
      'varying vec3 vTpNormal;\nvarying vec3 vTpView;\n' +
      spec.declarations +
      COMMON_GLSL +
      '\n' +
      shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + spec.body);
  };
  return mat;
}
