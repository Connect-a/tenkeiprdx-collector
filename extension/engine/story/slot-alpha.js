export function visFactors(skeleton, vis) {
  const slots = skeleton.slots;
  const f = new Array(slots.length).fill(1);
  if (!vis) return f;
  const get = vis instanceof Map ? (k) => vis.get(k) : (k) => vis[k];
  for (let i = 0; i < slots.length; i++) {
    const a = get(slots[i].data.name);
    if (a != null) f[i] = a;
  }
  return f;
}

export function withSlotAlphas(skeleton, factors, draw) {
  const slots = skeleton.slots;
  const saved = new Array(slots.length);
  for (let i = 0; i < slots.length; i++) {
    saved[i] = slots[i].color.a;
    slots[i].color.a = saved[i] * factors[i];
  }
  try {
    draw();
  } finally {
    for (let i = 0; i < slots.length; i++) slots[i].color.a = saved[i];
  }
}
