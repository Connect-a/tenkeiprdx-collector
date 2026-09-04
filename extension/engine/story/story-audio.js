import { assetStore } from '../../data/asset-store.js';
import { DIRS } from '../../core/dirs.js';
import { unityDecode } from '../../unity/decode.js';
import { firstClipUrl } from '../../core/audio-url.js';

export async function readSharedBgmUrl(rel) {
  if (!rel) return null;
  try {
    const bytes = await assetStore.readAsset(DIRS.shared, rel);
    if (!bytes) return null;
    return firstClipUrl(await unityDecode.extractAudioResource(bytes));
  } catch (e) {}
  return null;
}

export function fadeAudio(a, to, sec, andStop) {
  const from = a.volume;
  const t0 = performance.now();
  const step = () => {
    const k = sec > 0 ? Math.min(1, (performance.now() - t0) / (sec * 1000)) : 1;
    a.volume = Math.max(0, Math.min(1, from + (to - from) * k));
    if (k < 1) requestAnimationFrame(step);
    else if (andStop) {
      try {
        a.pause();
        if (a.src) URL.revokeObjectURL(a.src);
      } catch (e) {}
    }
  };
  step();
}
