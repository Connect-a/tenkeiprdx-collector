import { assetAcquirer } from './acquire-assemble.js';
import { bgSleep } from '../../core/bgtimer.js';

const defaultSleep = bgSleep;
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
    report({ type: 'start', target });
    let assetCount = 0;
    try {
      const r = await assetAcquirer.downloadCharacterAssets(target.folderKey, (msg, frac) => report({ type: 'progress', target, phase: 'assets', msg, frac }), { overwrite: o.overwrite });
      report({ type: 'assets', target, result: r });
      assetCount = (r && r.downloaded) || 0;
      consecutive = 0;
      report({ type: 'done', target, worked: assetCount > 0 });
    } catch (e) {
      consecutive++;
      report({ type: 'error', target, error: e });
      if (failCap && consecutive >= failCap) return 'failcap';
    }
    if (o.targetIntervalMs > 0 && assetCount > NO_WAIT_ASSET_MAX && i < list.length - 1 && !stop()) {
      report({ type: 'wait', target, phase: 'target', ms: o.targetIntervalMs, until: Date.now() + o.targetIntervalMs });
      await sleep(o.targetIntervalMs);
      report({ type: 'waitEnd', target, phase: 'target' });
    }
  }
  return stop() ? 'aborted' : 'done';
}

export const downloadRunner = { run };
