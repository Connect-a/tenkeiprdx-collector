import { unityDecode } from './decode.js';
import { unitySf } from './unity-sf.js';
import { noteFailure } from '../core/failures.js';

export function openCab(bytes, parsed) {
  try {
    parsed = parsed || unityDecode.parseUnityFS(bytes);
    const cab = parsed.nodes.find((n) => !n.path.endsWith('.resource') && !n.path.endsWith('.resS'));
    if (!cab) return null;
    const sf = parsed.data.subarray(cab.off, cab.off + cab.sz);
    return { parsed, sf, sfp: unitySf.parseSerializedFile(sf) };
  } catch (e) {
    noteFailure('Unity CAB', 'CABを開く', e);
    return null;
  }
}

export function attempt(fn, scope = 'Unity CAB', kind = 'SerializedFileの1件') {
  try {
    return fn();
  } catch (e) {
    noteFailure(scope, kind, e);
    return null;
  }
}

export const readOne = (sf, LE, o) => unitySf.readObjectSafe(sf, LE, o);
