export function createStageCore(hostEl, deps) {
  const { state, onNote, onBusy } = deps;
  const items = new Map();
  let impl = null;
  let alive = true;
  let raf = 0;
  let lastT = 0;

  const core = {
    hostEl,
    state,
    items,
    note: (t) => onNote && onNote(t),
    busy: (on, text) => onBusy && onBusy(on, text),
    entryOf: (id) => deps.entryOf(String(id)),
    live: (id) => {
      const it = items.get(String(id));
      return it && it.ok ? it : null;
    },
    liveCount: () => [...items.values()].filter((i) => i && i.ok).length,
    attach(x) {
      impl = x;
      return api;
    },
  };

  let frameFailed = false;
  function loop(now) {
    if (!alive) return;
    raf = requestAnimationFrame(loop);
    const dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0;
    lastT = now;
    try {
      impl.frame(dt);
    } catch (e) {
      if (!frameFailed) {
        frameFailed = true;
        core.note('描画中にエラーが起きました。' + (e && e.message ? e.message : e));
        console.error('[viewer] frame error', e);
      }
    }
  }

  const api = {
    async init() {
      await impl.init();
      raf = requestAnimationFrame(loop);
    },
    controlsFor: (id) => impl.controlsFor(core.live(id)),
    async addChar(id) {
      const key = String(id);
      if (items.has(key)) return;
      items.set(key, { ok: false });
      const entry = core.entryOf(key);
      core.busy(true, `${(entry && entry.displayName) || '#' + key} を読み込み中…`);
      try {
        const it = await impl.create(key, entry, state.get(key));
        if (!it) return;
        it.ok = true;
        items.set(key, it);
        const c = state.get(key);
        if (!c) return;
        if (!c.motion) state.update(key, { motion: impl.defaultMotion(it) });
        impl.apply(c, it);
        if (impl.added) impl.added(key, it);
      } finally {
        core.busy(false);
      }
    },
    removeChar(id) {
      const key = String(id);
      const it = items.get(key);
      if (it && it.ok) impl.destroy(it);
      items.delete(key);
    },
    syncChar(id) {
      const key = String(id);
      const c = state.get(key);
      const it = core.live(key);
      if (!c || !it) return;
      if (impl.needsRebuild && impl.needsRebuild(c, it)) {
        api.removeChar(key);
        api.addChar(key).catch(() => {});
        return;
      }
      impl.apply(c, it);
    },
    async syncAll() {
      await api.syncField();
      for (const key of [...items.keys()]) if (!state.has(key)) api.removeChar(key);
      for (const c of state.scene.chars) {
        if (!items.has(c.id)) await api.addChar(c.id);
        else if (core.live(c.id)) impl.apply(c, items.get(c.id));
      }
      if (impl.afterSync) impl.afterSync();
    },
    syncField: () => impl.syncField(),
    snapshot: () => impl.snapshot(),
    selected: () => (impl.selected ? impl.selected() : null),
    select: (id) => impl.select && impl.select(id),
    resetCamera: () => impl.resetCamera && impl.resetCamera(),
    lockCamera: () => impl.lockCamera && impl.lockCamera(),
    dispose() {
      alive = false;
      cancelAnimationFrame(raf);
      for (const key of [...items.keys()]) api.removeChar(key);
      if (impl.dispose) impl.dispose();
      hostEl.textContent = '';
    },
  };

  return core;
}
