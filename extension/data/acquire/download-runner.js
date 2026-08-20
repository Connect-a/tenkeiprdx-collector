import { assetAcquirer } from './acquire-assemble.js';

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NO_WAIT_ASSET_MAX = 5;

async function run(targets, opts) {
  const o = opts || {};
  const sleep = o.sleep || defaultSleep;
  const stop = o.shouldAbort || (() => false);
  const report = o.report || (() => {});
  const failCap = o.failCap || 0;
  const list = targets || [];
  let consecutive = 0;
  for (let i = 0; i < list.length; i++) {
    const target = list[i];
    if (stop()) return 'aborted';
    if (o.readyFor && !(await o.readyFor(target))) {
      report({ type: 'skip', target });
      continue;
    }
    if (stop()) return 'aborted';
    report({ type: 'start', target });
    let worked = false;
    let assetCount = 0;
    try {
      if (target.story !== false) {
        const r = await assetAcquirer.collectStory(target.folderKey, (msg, frac) => report({ type: 'progress', target, phase: 'story', msg, frac }), {
          intervalMs: o.storyIntervalMs,
          sleep,
          shouldAbort: stop,
          overwrite: o.overwrite,
          onPlan: (need) => report({ type: 'plan', target, need }),
          onEpisodeStart: (ep) => report({ type: 'episodeStart', target, ep }),
          onEpisode: (ep, result) => report({ type: 'episode', target, ep, result }),
          onWait: (ms) => report({ type: 'wait', target, phase: 'story', ms }),
        });
        report({ type: 'story', target, result: r });
        if (r.aborted) return 'aborted';
        if (r.got) worked = true;
      }
      if (stop()) return 'aborted';
      if (target.assets !== false) {
        const r = await assetAcquirer.downloadCharacterAssets(target.folderKey, (msg, frac) => report({ type: 'progress', target, phase: 'assets', msg, frac }), { overwrite: o.overwrite });
        report({ type: 'assets', target, result: r });
        if (r && r.downloaded > 0) worked = true;
        assetCount = (r && r.downloaded) || 0;
      }
      consecutive = 0;
      report({ type: 'done', target, worked });
    } catch (e) {
      consecutive++;
      report({ type: 'error', target, error: e });
      if (e && e.auth) return 'auth';
      if (failCap && consecutive >= failCap) return 'failcap';
    }
    if (o.targetIntervalMs > 0 && worked && assetCount > NO_WAIT_ASSET_MAX && i < list.length - 1 && !stop()) {
      report({ type: 'wait', target, phase: 'target', ms: o.targetIntervalMs, until: Date.now() + o.targetIntervalMs });
      await sleep(o.targetIntervalMs);
      report({ type: 'waitEnd', target, phase: 'target' });
    }
  }
  return stop() ? 'aborted' : 'done';
}

export const downloadRunner = { run };
