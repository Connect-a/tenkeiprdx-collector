const REVEAL_MARGIN = '200px';

export const observeVisibility = (el, onChange, opts) => {
  if (!el || !('IntersectionObserver' in globalThis)) return () => {};
  const io = new IntersectionObserver(
    (ents) => {
      onChange(ents.some((e) => e.isIntersecting));
    },
    opts || { threshold: 0 },
  );
  io.observe(el);
  return () => {
    try {
      io.disconnect();
    } catch (e) {}
  };
};

export function createRevealer({ onReveal, onBatch, rootMargin = REVEAL_MARGIN } = {}) {
  let io = null;
  const ensure = () => {
    if (io) return io;
    if (typeof IntersectionObserver !== 'function') return null;
    io = new IntersectionObserver(
      (ents) => {
        let n = 0;
        for (const en of ents) {
          if (!en.isIntersecting) continue;
          io.unobserve(en.target);
          n++;
          onReveal(en.target);
        }
        if (n && onBatch) onBatch(n);
      },
      { rootMargin },
    );
    return io;
  };
  return {
    supported: () => typeof IntersectionObserver === 'function',
    watch(node) {
      const o = ensure();
      if (o && node) o.observe(node);
      return !!o;
    },
    watchAll(nodes) {
      const o = ensure();
      if (!o) return false;
      for (const node of nodes) o.observe(node);
      return true;
    },
    reset() {
      if (!io) return;
      try {
        io.disconnect();
      } catch (e) {}
      io = null;
    },
  };
}
