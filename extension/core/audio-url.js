export const audioBlobUrl = (data, mime) => URL.createObjectURL(new Blob([data], { type: mime || 'audio/mp4' }));

export const firstClipUrl = (clips) => {
  const c = (clips || []).find((x) => x && x.data && x.data.length);
  return c ? audioBlobUrl(c.data, c.mime) : null;
};

export const revokeUrlMap = (map) => {
  for (const u of map.values()) {
    try {
      URL.revokeObjectURL(u);
    } catch (e) {}
  }
  map.clear();
};

const _audioJobs = new WeakMap();

export const cachedAudioUrl = (cache, key, produce) => {
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
