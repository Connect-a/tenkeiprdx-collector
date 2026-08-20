import { scanFolder } from '../folder-scan.js';
import { downloadRunner } from './download-runner.js';
import { SK } from '../../core/constants.js';
import { failureReport, failureSummary, hasFailures } from '../../core/failure-report.js';
const STATE_KEY = SK.bulkState;
const FAIL_LIMIT = 5;
const GD_INTERVAL_SEC = 3;
const DL_INTERVAL_SEC = 180;

const isActive = (phase) => phase === 'running';
const isActiveState = () => !!_state && _state.phase === 'running';

let _state = null;
let _stopReq = false;
let _running = false;

async function loadState() {
  try {
    return (await chrome.storage.local.get(STATE_KEY))[STATE_KEY] || null;
  } catch (e) {
    return null;
  }
}

let _flushTimer = null,
  _flushPending = false;
function flush(force) {
  if (!_state) return;
  if (force) {
    if (_flushTimer) {
      clearTimeout(_flushTimer);
      _flushTimer = null;
    }
    _flushPending = false;
    try {
      chrome.storage.local.set({ [STATE_KEY]: _state });
    } catch (e) {}
    return;
  }
  if (_flushTimer) {
    _flushPending = true;
    return;
  }
  try {
    chrome.storage.local.set({ [STATE_KEY]: _state });
  } catch (e) {}
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    if (_flushPending) {
      _flushPending = false;
      flush();
    }
  }, 500);
}

function stats(items) {
  let done = 0,
    skipped = 0,
    failed = 0,
    running = 0;
  for (const it of items) {
    if (it.status === 'done') done++;
    else if (it.status === 'skipped') skipped++;
    else if (it.status === 'failed') failed++;
    else if (it.status === 'dl') running++;
  }
  return { total: items.length, done, skipped, failed, running, processed: done + skipped + failed };
}

const _wakers = new Set();
function sleepCancelable(ms) {
  return new Promise((res) => {
    if (ms <= 0) return res();
    const w = () => {
      clearTimeout(t);
      _wakers.delete(w);
      res();
    };
    const t = setTimeout(w, Math.min(ms, 60000));
    _wakers.add(w);
  });
}
const wakeAll = () => {
  for (const w of [..._wakers]) w();
};
function pushFailure(name, reason, soft, report) {
  if (!_state.failures) _state.failures = [];
  _state.failures.push({ name, reason, soft: !!soft, at: Date.now(), report: report || null });
  if (_state.failures.length > 500) _state.failures.shift();
  try {
    (soft ? console.warn : console.error)('[tp] 一括DLに失敗', name, reason);
  } catch (e) {}
}

function recomputeGd() {
  let total = 0,
    done = 0,
    failed = 0;
  for (const it of _state.items) {
    total += it.gdNeed || 0;
    done += it.gdGot || 0;
    failed += it.gdFail || 0;
  }
  _state.gd = { total, done, failed };
}

const itemOf = (target) => _state.items.find((x) => String(x.id) === String(target.folderKey)) || null;

let _statusAt = 0;
function onEvent(ev) {
  if (!_state) return;
  const it = itemOf(ev.target);
  if (!it) return;
  const metaOnly = ev.target.assets === false;
  if (ev.type === 'start') {
    if (!metaOnly) it.status = 'dl';
  } else if (ev.type === 'skip') {
    if (!metaOnly && !_state.tokenError && it.skipReason === 'story-missing' && it.status === 'pending') {
      it.status = 'skipped';
      it.at = Date.now();
    }
  } else if (ev.type === 'plan') {
    it.gdNeed = ev.need;
    it.gdGot = 0;
    it.gdFail = 0;
    recomputeGd();
    _state.gdStatus = ev.need ? `ストーリー情報の取得待ち… ${it.name}` : '';
  } else if (ev.type === 'episodeStart') {
    _state.gdStatus = `ストーリー情報を取得中 ${it.name} #${ev.ep.episodeId}`;
  } else if (ev.type === 'episode') {
    const r = ev.result || {};
    if (r.ok) {
      it.gdGot = (it.gdGot || 0) + 1;
      it.gdFetched = (it.gdFetched || 0) + ((r.log && r.log.length) || 0);
    } else it.gdFail = (it.gdFail || 0) + 1;
    recomputeGd();
  } else if (ev.type === 'story') {
    it.gd = it.gdFail ? (it.gdGot ? 'partial' : 'failed') : 'done';
    if (it.gdFail && !it.gdGot) pushFailure(it.name, `ストーリー情報を${it.gdFail}件取得できませんでした`, true);
    _state.gdStatus = '';
  } else if (ev.type === 'progress') {
    if (ev.phase === 'story') return;
    const now = Date.now();
    if (now - _statusAt < 800) return;
    _statusAt = now;
    _state.currentStatus = `${it.name}: ${ev.msg}`;
  } else if (ev.type === 'assets') {
    const r = ev.result || {};
    const cp = (r.meta && r.meta.completeness) || {};
    it.have = cp.episodesHave || 0;
    it.partial = cp.episodesPartial || 0;
    it.total = cp.episodesTotal || it.total || 0;
    it.voiced = cp.voicedScenes || 0;
    it.bg = cp.sceneBgResolved || 0;
    it.assetCats = cp.assetCategories || 0;
    it.cast = cp.castResolved || 0;
    const rep = failureReport({ ...r, missingVoices: (r.missingVoices || []).length ? r.missingVoices : new Array(cp.missingVoices || 0).fill('(詳細なし)') });
    it.report = rep;
    it.missing = rep.counts.missing;
    it.fails = rep.counts.fails;
    it.missingVoices = rep.counts.missingVoices;
    it.downloaded = r.downloaded || 0;
    if (hasFailures(rep)) pushFailure(it.name, `一部取得できず（${failureSummary(rep)}）`, true, rep);
  } else if (ev.type === 'done') {
    if (!metaOnly) {
      it.status = ev.worked || it.gdFetched || it.fails ? 'done' : 'skipped';
      it.at = Date.now();
      _state.consecutiveFailures = 0;
    }
    _state.currentStatus = '';
  } else if (ev.type === 'error') {
    const e = ev.error;
    const msg = e && e.message ? e.message : String(e);
    if (e && e.auth) {
      _state.tokenError = true;
      _state.lastError = 'ゲームとの接続が切れたため、取得できたところまでで停止しました。';
      if (!metaOnly && it.status === 'dl') it.status = 'pending';
      flush(true);
      return;
    }
    pushFailure(it.name, msg);
    _state.lastError = `${it.name}: ${msg}`;
    if (!metaOnly) {
      it.status = 'failed';
      it.error = msg;
      it.at = Date.now();
      _state.consecutiveFailures = (_state.consecutiveFailures || 0) + 1;
    }
    flush(true);
    return;
  } else if (ev.type === 'wait') {
    if (ev.phase === 'target') {
      _state.nextDlAt = ev.until;
      _state.currentStatus = '';
    } else _state.gdStatus = `ストーリー情報の取得待ち… ${it.name}`;
  } else if (ev.type === 'waitEnd') {
    _state.nextDlAt = 0;
  }
  flush();
}

async function sleepUntil(ms) {
  const end = Date.now() + ms;
  while (!_stopReq && isActiveState() && Date.now() < end) await sleepCancelable(end - Date.now());
}

async function runPipelines() {
  if (_running) return;
  _running = true;
  for (const it of _state.items) {
    if (it.status === 'dl') it.status = 'pending';
    if (it.skipReason) delete it.skipReason;
  }
  recomputeGd();
  flush(true);
  const pending = () => _state.items.filter((it) => it.status === 'pending');
  const shouldAbort = () => _stopReq || !isActiveState();
  let outcome = 'done';
  try {
    const meta = pending()
      .filter((it) => it.gd === 'pending')
      .map((it) => ({ folderKey: it.id, name: it.name, assets: false }));
    const assets = pending().map((it) => ({ folderKey: it.id, name: it.name, story: false }));
    let metaOutcome = 'done';
    let metaRunning = meta.length > 0;
    await Promise.all([
      meta.length
        ? downloadRunner
            .run(meta, {
              sleep: sleepUntil,
              shouldAbort,
              storyIntervalMs: (_state.gdIntervalSec || GD_INTERVAL_SEC) * 1000,
              overwrite: !!_state.overwrite,
              report: onEvent,
            })
            .then((o) => {
              metaOutcome = o;
              metaRunning = false;
            })
        : null,
      assets.length
        ? downloadRunner
            .run(assets, {
              sleep: sleepUntil,
              shouldAbort,
              targetIntervalMs: (_state.dlIntervalSec || DL_INTERVAL_SEC) * 1000,
              failCap: FAIL_LIMIT,
              overwrite: !!_state.overwrite,
              report: onEvent,
              readyFor: async (t) => {
                const it = itemOf(t);
                if (!it) return false;
                for (;;) {
                  if (shouldAbort()) return false;
                  if (it.gd !== 'pending') return true;
                  if (!metaRunning) {
                    if (it.gdGot > 0) return true;
                    it.skipReason = 'story-missing';
                    return false;
                  }
                  await sleepCancelable(500);
                }
              },
            })
            .then((o) => {
              outcome = o;
            })
        : null,
    ]);
    if (metaOutcome === 'auth' && outcome === 'done') outcome = 'auth';
  } finally {
    _running = false;
  }
  if (_stopReq || !_state) return;
  if (isActive(_state.phase)) {
    if (outcome === 'failcap') _state.lastError = `${_state.consecutiveFailures}回続けて失敗したため停止しました。${_state.lastError || ''}`;
    else if (_state.tokenError) _state.lastError = 'ゲームとの接続が切れたため、取得できたところまでで停止しました。';
    _state.phase = outcome === 'done' || outcome === 'aborted' ? (_state.tokenError ? 'error' : 'done') : 'error';
    _state.currentStatus = '';
    _state.gdStatus = '';
    _state.nextDlAt = 0;
    _state.endedAt = Date.now();
    flush(true);
  }
}

async function start(items, opts) {
  opts = opts || {};
  if (_state && isActive(_state.phase)) return { ok: false, reason: 'active' };
  if (!items || !items.length) return { ok: false, reason: 'empty' };
  const overwrite = !!opts.overwrite;
  let have = new Set();
  if (!overwrite) {
    try {
      have = new Set((await scanFolder()).filter((x) => x.counts.total > 0 && x.counts.have >= x.counts.total).map((x) => String(x.folderKey)));
    } catch (e) {}
  }
  _state = {
    phase: 'running',
    gdIntervalSec: opts.gdIntervalSec || GD_INTERVAL_SEC,
    dlIntervalSec: opts.dlIntervalSec || DL_INTERVAL_SEC,
    overwrite,
    tokenError: false,
    lastError: '',
    currentStatus: '',
    gdStatus: '',
    nextDlAt: 0,
    gd: { total: 0, done: 0, failed: 0 },
    consecutiveFailures: 0,
    failures: [],
    startedAt: Date.now(),
    endedAt: 0,
    items: items.map((s) => ({
      id: String(s.id),
      name: s.name || String(s.id),
      rosterKind: s.rosterKind || '',
      total: s.total || 0,
      gd: !overwrite && have.has(String(s.id)) ? 'skipped' : 'pending',
      gdNeed: 0,
      gdGot: 0,
      gdFail: 0,
      status: 'pending',
    })),
  };
  flush(true);
  _stopReq = false;
  runPipelines();
  return { ok: true, stats: stats(_state.items) };
}

async function stop() {
  _stopReq = true;
  wakeAll();
  if (!_state) _state = await loadState();
  if (_state) {
    _state.phase = 'stopped';
    _state.currentStatus = '';
    _state.gdStatus = '';
    _state.endedAt = Date.now();
    flush(true);
  }
}

async function resume() {
  if (_running) return;
  const st = await loadState();
  if (st && isActive(st.phase)) {
    _state = st;
    _stopReq = false;
    runPipelines();
  }
}

async function resumeAfterReconnect() {
  if (_running) return false;
  const st = _state || (await loadState());
  if (!st || st.phase !== 'error' || !st.tokenError) return false;
  st.phase = 'running';
  st.tokenError = false;
  st.lastError = '';
  st.consecutiveFailures = 0;
  st.endedAt = 0;
  _state = st;
  _stopReq = false;
  flush(true);
  runPipelines();
  return true;
}

async function getState() {
  if (_running && _state) return _state;
  return (await loadState()) || _state;
}

async function clear() {
  if (_state && isActive(_state.phase)) return { ok: false, reason: 'active' };
  _state = null;
  _stopReq = false;
  try {
    await chrome.storage.local.remove(STATE_KEY);
  } catch (e) {}
  return { ok: true };
}

export const bulkDownloader = { isActive, getState, stats, start, stop, resume, resumeAfterReconnect, clear };
