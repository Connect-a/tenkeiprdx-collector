const bytesToB64 = (buf) => {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
  return btoa(bin);
};
const b64ToBytes = (b64) => {
  const bin = atob(b64);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const latin1 = new TextDecoder('iso-8859-1');
const num = (x) => (typeof x === 'bigint' ? Number(x) : x);
async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runner = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return out;
}
const safeProgress = (progress) => (...a) => {
  try {
    progress && progress(...a);
  } catch (e) {}
};
const audioBlobUrl = (data, mime) => URL.createObjectURL(new Blob([data], { type: mime || 'audio/mp4' }));
const revokeUrlMap = (map) => {
  for (const u of map.values()) {
    try {
      URL.revokeObjectURL(u);
    } catch (e) {}
  }
  map.clear();
};
const _audioJobs = new WeakMap();
const cachedAudioUrl = (cache, key, produce) => {
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  let jobs = _audioJobs.get(cache);
  if (!jobs) {
    jobs = new Map();
    _audioJobs.set(cache, jobs);
  }
  let job = jobs.get(key);
  if (!job) {
    job = (async () => {
      const r = await produce();
      if (!r) return null;
      const url = r.data ? audioBlobUrl(r.data, r.mime) : audioBlobUrl(r);
      cache.set(key, url);
      return url;
    })();
    jobs.set(key, job);
    job.catch(() => {}).finally(() => jobs.delete(key));
  }
  return job;
};
const observeVisibility = (el, onChange, opts) => {
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
export const utilHelpers = { bytesToB64, b64ToBytes, sleep, latin1, num, pool, safeProgress, audioBlobUrl, revokeUrlMap, cachedAudioUrl, observeVisibility };
