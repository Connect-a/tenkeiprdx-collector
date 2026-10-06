import { extractMeshGeometry } from './mesh-geometry.js';
import { KEEP_DXT, newDecodeStats, decodeLargestTextureRgba, decodeLargestTextureCanvas, decodeAllTextureCanvases, decodeNamedTextureCanvases, decodeAtlasSprite } from './texture.js';
import { resolveBlend, parseMaterialBundle, parseMouthAtlas } from './material.js';
import { parseModelBundle } from './model-bundle.js';
import { extractReflectionCube, extractSceneLight } from './scene-env.js';
import { extractSpineInputs } from './spine-input.js';

export const unityMesh = {
  KEEP_DXT,
  newDecodeStats,
  parseModelBundle,
  parseMaterialBundle,
  resolveBlend,
  decodeLargestTextureRgba,
  decodeLargestTextureCanvas,
  decodeAllTextureCanvases,
  decodeNamedTextureCanvases,
  decodeAtlasSprite,
  parseMouthAtlas,
  extractSpineInputs,
  extractMeshGeometry,
  extractReflectionCube,
  extractSceneLight,
};
