const painters = new Map();

export function registerPainter(name, fn) {
  const list = painters.get(name) || [];
  list.push(fn);
  painters.set(name, list);
}

export async function redraw(name, ...args) {
  const list = painters.get(name);
  if (!list || !list.length) {
    console.warn('[tp] 再描画先が登録されていません:', name);
    return;
  }
  for (const fn of list) await fn(...args);
}
