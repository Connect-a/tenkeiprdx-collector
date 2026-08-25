import { FAIL_CAP } from '../core/constants.js';
import { fileStore } from '../core/fsdir.js';
import { networkClient } from './network.js';
import { assetStore } from './asset-store.js';

const { fetchBytes } = networkClient;

async function saveUrl(session, targetDir, { url, subpath, label }) {
  const counters = session.counters;
  if (!targetDir) return { status: 'fail' };
  if (!session.overwrite && (await fileStore.exists(targetDir, subpath))) {
    counters.skip++;
    return { status: 'skip', path: subpath };
  }
  if (!url) {
    counters.unresolved++;
    return { status: 'missing' };
  }
  if (session.aborted) return { status: 'abort' };
  const r = await fetchBytes(url);
  if (r.status === 'missing') {
    counters.missing++;
    return { status: 'missing' };
  }
  if (r.status !== 'ok' || !r.bytes) {
    counters.fail++;
    return { status: 'fail' };
  }
  try {
    await fileStore.writeUnder(targetDir, subpath, r.bytes);
    counters.got++;
    return { status: 'got', path: subpath };
  } catch (e) {
    return { status: 'fail' };
  }
}

async function saveAsset(session, dir, rel, spec) {
  const c = session.counters;
  const r = await assetStore.acquireAsset(dir, rel, { base: spec.base, place: spec.place, overwrite: session.overwrite, fast: !!spec.fast });
  if (r.status === 'skip') c.skip++;
  else if (r.status === 'got') c.got++;
  else if (r.status === 'missing') c.missing++;
  else {
    if (!spec.retrying) {
      session.deferred.push({ dir, rel, spec: { ...spec, retrying: true } });
      c.fail++;
    }
    return { ...r, label: spec.label, retriable: true };
  }
  return { ...r, label: spec.label };
}

const dirIds = new WeakMap();
let dirSeq = 0;
function dirId(d) {
  if (!d) return '0';
  let n = dirIds.get(d);
  if (!n) {
    n = String(++dirSeq);
    dirIds.set(d, n);
  }
  return n;
}

function createDlSession(opts) {
  const session = {
    counters: { got: 0, skip: 0, fail: 0, missing: 0, unresolved: 0, recovered: 0 },
    aborted: null,
    overwrite: !!(opts && opts.overwrite),
    deferred: [],
  };
  const guard = (r, note) => {
    if (r.status === 'fail' && session.counters.fail >= FAIL_CAP && !session.aborted) session.aborted = new Error(`失敗${FAIL_CAP}件で中断（${note || ''}）`);
    return r;
  };
  session.saveUrl = async (targetDir, spec, note) => guard(await saveUrl(session, targetDir, spec), note);

  const inflight = new Map();
  session.saveAsset = async (dir, rel, spec, note) => {
    const key = `${dirId(dir)}|${spec.place || ''}|${rel}`;
    const known = inflight.get(key);
    if (known) {
      const r = await known;
      return { ...r, status: r.status === 'got' ? 'skip' : r.status };
    }
    const p = (async () => guard(await saveAsset(session, dir, rel, spec), note))();
    inflight.set(key, p);
    const r = await p;
    if (r.status !== 'got' && r.status !== 'skip') inflight.delete(key);
    return r;
  };

  session.flushDeferred = async (onProgress) => {
    const q = session.deferred;
    session.deferred = [];
    if (!q.length) return { tried: 0, recovered: 0, stillFailed: [] };
    let recovered = 0;
    const stillFailed = [];
    for (let i = 0; i < q.length; i++) {
      if (onProgress) onProgress(i + 1, q.length);
      if (session.aborted) {
        stillFailed.push(q[i].spec.label);
        continue;
      }
      const r = await saveAsset(session, q[i].dir, q[i].rel, q[i].spec);
      if (r.status === 'got' || r.status === 'skip') {
        recovered++;
        session.counters.fail = Math.max(0, session.counters.fail - 1);
      } else stillFailed.push(q[i].spec.label);
    }
    session.deferred = [];
    session.counters.recovered += recovered;
    return { tried: q.length, recovered, stillFailed };
  };
  return session;
}

export const dlSession = { create: createDlSession };
