import { unityDecode } from './decode.js';
import { spineAtlas } from './spine-atlas.js';
import { decodeNamedTextureRgba, decodeLargestTextureRgba } from './texture.js';
export function extractSpineInputs(bytes) {
  if (!bytes) return null;
  const parsed = unityDecode.parseUnityFS(bytes);
  const tas = unityDecode.extractTextAssets ? unityDecode.extractTextAssets(bytes) || [] : [];
  const a = tas.find((t) => /\.atlas$/i.test(t.name));
  const s = tas.find((t) => /\.skel(?:\.bytes)?$/i.test(t.name));
  if (!a || !a.bytes || !a.bytes.length || !s || !s.bytes || !s.bytes.length) return null;
  const names = spineAtlas.atlasPageNames(a.bytes);
  const found = decodeNamedTextureRgba(bytes, parsed);
  const textures = [];
  for (let i = 0; i < names.length; i++) {
    const t = spineAtlas.textureForPage(found, names[i], i);
    if (t && !textures.includes(t)) textures.push(t);
  }
  for (const t of found) if (!textures.includes(t)) textures.push(t);
  const texture = textures[0] || decodeLargestTextureRgba(bytes, parsed);
  if (!texture || !texture.rgba) return null;
  return { atlasBytes: a.bytes, skeletonBytes: s.bytes, skeletonPath: s.name, texture, textures: textures.length ? textures : [texture] };
}
