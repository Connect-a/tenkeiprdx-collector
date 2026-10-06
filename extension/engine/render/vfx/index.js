import { createSceneVfx, prewarmMaterials } from './vfx-scenegraph.js';
import { createVfxPlayer } from './vfx-player.js';

export { createVfxPlayer, prewarmMaterials };
export { loadBattleEnv } from './vfx-env.js';

export const sceneVfx = { createSceneVfx, createVfxPlayer, prewarmMaterials };
