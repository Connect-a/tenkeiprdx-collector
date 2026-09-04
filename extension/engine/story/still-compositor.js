const VERT = 'attribute vec2 aPos;attribute vec2 aUV;varying vec2 vUV;void main(){vUV=aUV;gl_Position=vec4(aPos,0.0,1.0);}';
const FRAG = 'precision mediump float;varying vec2 vUV;uniform sampler2D uTex;uniform float uAlpha;void main(){gl_FragColor=texture2D(uTex,vUV)*uAlpha;}';

export function createStillCompositor(gl) {
  let W = 0,
    H = 0,
    accumFB = null,
    accumTex = null,
    tempFB = null,
    tempTex = null,
    prog = null,
    quad = null,
    aPos = -1,
    aUV = -1,
    uTex = null,
    uAlpha = null,
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
    uTex = gl.getUniformLocation(p, 'uTex');
    uAlpha = gl.getUniformLocation(p, 'uAlpha');
    quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, -1, 1, 0, 1, 1, -1, 1, 0, 1, 1, 1, 1]), gl.STATIC_DRAW);
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
    if (w === W && h === H && accumFB) return true;
    free(true);
    W = w;
    H = h;
    accumTex = mkTex(w, h);
    accumFB = mkFB(accumTex);
    tempTex = mkTex(w, h);
    tempFB = mkFB(tempTex);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) broken = true;
    return ok;
  }
  function beginAccum() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, accumFB);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  function bindAccum() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, accumFB);
    gl.viewport(0, 0, W, H);
  }
  function bindTemp() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, tempFB);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  function drawQuad(tex, alpha, target) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, W, H);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(uTex, 0);
    gl.uniform1f(uAlpha, alpha);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aUV);
    gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 16, 8);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  function overAccum(alpha) {
    drawQuad(tempTex, alpha, accumFB);
  }
  function toCanvas() {
    drawQuad(accumTex, 1, null);
  }
  function free(keepProgram) {
    for (const fb of [accumFB, tempFB]) if (fb) gl.deleteFramebuffer(fb);
    for (const t of [accumTex, tempTex]) if (t) gl.deleteTexture(t);
    accumFB = tempFB = accumTex = tempTex = null;
    if (!keepProgram) {
      if (quad) gl.deleteBuffer(quad);
      if (prog) gl.deleteProgram(prog);
      quad = prog = null;
      W = H = 0;
    }
  }
  return { ensure, beginAccum, bindAccum, bindTemp, overAccum, toCanvas, dispose: () => free(false), ok: () => !!prog && !broken };
}
