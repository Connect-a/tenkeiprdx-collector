function isContextLost(renderer) {
  try {
    return renderer.getContext().isContextLost();
  } catch (e) {
    return true;
  }
}

export function guardRenderer(renderer, opts) {
  const o = opts || {};
  const canvas = renderer.domElement;
  let deadTimer = null;
  let disposed = false;
  let lost = false;
  const onLost = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    lost = true;
    if (o.onLost) o.onLost();
    if (o.onDead) {
      if (deadTimer) clearTimeout(deadTimer);
      deadTimer = setTimeout(() => {
        if (!disposed && lost) o.onDead();
      }, o.deadMs || 2500);
    }
  };
  const onRestored = () => {
    lost = false;
    if (deadTimer) {
      clearTimeout(deadTimer);
      deadTimer = null;
    }
    if (o.onRestored) o.onRestored();
  };
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);
  return {
    get lost() {
      return lost || isContextLost(renderer);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (deadTimer) clearTimeout(deadTimer);
      canvas.removeEventListener('webglcontextlost', onLost, false);
      canvas.removeEventListener('webglcontextrestored', onRestored, false);
      try {
        renderer.forceContextLoss();
      } catch (e) {}
      try {
        renderer.dispose();
      } catch (e) {}
    },
  };
}

export function makeRebuildLimiter(windowMs, maxRebuilds) {
  let stamps = [];
  return () => {
    const now = (globalThis.performance && performance.now && performance.now()) || 0;
    stamps = stamps.filter((t) => now - t < (windowMs || 8000));
    if (stamps.length >= (maxRebuilds || 2)) return false;
    stamps.push(now);
    return true;
  };
}
