import { createBakeSession } from './vfx-bake.js';
import { NO_ENV } from './vfx-lighting.js';

export function createVfxContext(env) {
  return { env: env || NO_ENV, bakes: createBakeSession() };
}

const _scriptEnv = { avg: null, cube: null, hdr: [1, 1, 0], light: null };
let _scriptCtx = null;
export function scriptVfxContext() {
  if (!_scriptCtx) _scriptCtx = { env: _scriptEnv, bakes: createBakeSession() };
  return _scriptCtx;
}
