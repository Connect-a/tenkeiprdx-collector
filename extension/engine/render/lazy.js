let _m3d = null;
let _m3dP = null;
let _aura = null;
let _auraP = null;

export async function loadModel3d() {
  if (!_m3d) _m3d = await (_m3dP ||= import('./model3d.js'));
  return _m3d.model3dRenderer;
}

export const model3dSync = () => (_m3d ? _m3d.model3dRenderer : null);

export const disposeModel3d = (m) => (_m3d ? _m3d.model3dRenderer.disposeModel3d(m) : null);

export async function loadAura() {
  if (!_aura) _aura = await (_auraP ||= import('./aura.js'));
  return _aura.auraCatalog;
}
