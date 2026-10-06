import { makeQuadProgram, makeQuadTexture, makeFramebuffer } from './gl-quad.js';
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

  function makeProgram() {
    if (prog || broken) return !!prog;
    const built = makeQuadProgram(gl, VERT, FRAG, ['uTex', 'uAlpha']);
    if (!built) {
      broken = true;
      return false;
    }
    prog = built.prog;
    quad = built.quad;
    aPos = built.aPos;
    aUV = built.aUV;
    uTex = built.uniforms.uTex;
    uAlpha = built.uniforms.uAlpha;
    return true;
  }
  function ensure(w, h) {
    if (broken) return false;
    if (!makeProgram()) return false;
    if (w === W && h === H && accumFB) return true;
    free(true);
    W = w;
    H = h;
    accumTex = makeQuadTexture(gl, w, h);
    accumFB = makeFramebuffer(gl, accumTex);
    tempTex = makeQuadTexture(gl, w, h);
    tempFB = makeFramebuffer(gl, tempTex);
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
