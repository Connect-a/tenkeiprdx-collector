export function readClipEvents(ctx, clipIsOff) {
  const { meta, read } = ctx;
  const out = [];
  for (const o of meta.objects) {
    if (o.classID !== 74 || clipIsOff(String(o.pathID))) continue;
    const clip = read(o);
    if (!clip) continue;
    for (const e of clip.m_Events || []) {
      const fn = String(e.functionName || '');
      if (!fn) continue;
      out.push({ t: Number(e.time) || 0, fn, i: Number(e.intParameter) || 0, f: Number(e.floatParameter) || 0, s: typeof e.data === 'string' ? e.data : '' });
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}
