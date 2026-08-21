const VERT = `
attribute vec2 aPos;
attribute vec2 aUV;
varying vec2 vUV;
void main() {
  vUV = aUV;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
varying vec2 vUV;
uniform sampler2D uScene;
uniform sampler2D uMask;
uniform vec2 uBlocks;
void main() {
  float m = texture2D(uMask, vUV).a;
  vec2 quv = (floor(vUV * uBlocks) + 0.5) / uBlocks;
  vec4 pix = texture2D(uScene, quv);
  vec4 nrm = texture2D(uScene, vUV);
  gl_FragColor = mix(nrm, pix, step(0.5, m));
}`;

export function createMosaicPass(gl) {
  let W = 0,
    H = 0;
  let sceneFB = null,
    sceneTex = null,
    maskFB = null,
    maskTex = null,
    prog = null,
    quad = null,
    aPos = -1,
    aUV = -1,
    uScene = null,
    uMask = null,
    uBlocks = null,
    broken = false;

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  function makeProgram() {
    if (prog || broken) return !!prog;
    const vs = compile(gl.VERTEX_SHADER, VERT),
      fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) {
      broken = true;
      return false;
    }
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      gl.deleteProgram(p);
      broken = true;
      return false;
    }
    prog = p;
    aPos = gl.getAttribLocation(p, 'aPos');
    aUV = gl.getAttribLocation(p, 'aUV');
    uScene = gl.getUniformLocation(p, 'uScene');
    uMask = gl.getUniformLocation(p, 'uMask');
    uBlocks = gl.getUniformLocation(p, 'uBlocks');
    quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    const v = new Float32Array([-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, -1, 1, 0, 1, 1, -1, 1, 0, 1, 1, 1, 1]);
    gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    return true;
  }

  function mkTex(w, h) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  function mkFB(tex) {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return fb;
  }

  function ensure(w, h) {
    if (broken) return false;
    if (!makeProgram()) return false;
    if (w === W && h === H && sceneFB) return true;
    dispose(true);
    W = w;
    H = h;
    sceneTex = mkTex(w, h);
    sceneFB = mkFB(sceneTex);
    maskTex = mkTex(w, h);
    maskFB = mkFB(maskTex);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) {
      broken = true;
      return false;
    }
    return true;
  }

  function bindScene() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFB);
  }
  function bindMask() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, maskFB);
  }

  function composite(blocksX, blocksY) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.uniform1i(uScene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.uniform1i(uMask, 1);
    gl.uniform2f(uBlocks, Math.max(1, blocksX), Math.max(1, blocksY));
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aUV);
    gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 16, 8);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.activeTexture(gl.TEXTURE0);
  }

  function dispose(keepProgram) {
    for (const fb of [sceneFB, maskFB]) if (fb) gl.deleteFramebuffer(fb);
    for (const t of [sceneTex, maskTex]) if (t) gl.deleteTexture(t);
    sceneFB = maskFB = sceneTex = maskTex = null;
    if (!keepProgram) {
      if (quad) gl.deleteBuffer(quad);
      if (prog) gl.deleteProgram(prog);
      quad = prog = null;
      W = H = 0;
    }
  }

  return { ensure, bindScene, bindMask, composite, dispose: () => dispose(false), ok: () => !!prog && !broken };
}
