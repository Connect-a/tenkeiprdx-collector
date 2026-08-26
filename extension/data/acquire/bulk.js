import { downloadRunner } from './download-runner.js';
import { SK } from '../../core/constants.js';
import { failureReport, failureSummary, hasFailures } from '../../core/failure-report.js';
import { bgTimeout } from '../../core/bgtimer.js';
const STATE_KEY = SK.bulkState;
const FAIL_LIMIT = 5;
const FLUSH_MS = 2000;
const DL_INTERVAL_SEC = 180;

const RUNNER_ID = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
const OWNER_STALE_MS = 90000;

const isActive = (phase) => phase === 'running';
const isActiveState = () => !!_state && _state.phase === 'running';
const ownedByOther = (st) => !!st && !!st.owner && st.owner !== RUNNER_ID && Date.now() - (st.beat || 0) < OWNER_STALE_MS;

let _state = null;
let _stopReq = false;
let _running = false;
let _starting = false;

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
  if (_running) {
    _state.owner = RUNNER_ID;
    _state.beat = Date.now();
  }
  if (force) {
    if (_flushTimer) {
      _flushTimer();
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
  _flushTimer = bgTimeout(FLUSH_MS, () => {
    _flushTimer = null;
    if (_flushPending) {
      _flushPending = false;
      flush();
    }
  });
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
      cancel();
      _wakers.delete(w);
      res();
    };
    const cancel = bgTimeout(Math.min(ms, 60000), w);
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

const itemOf = (target) => _state.items.find((x) => String(x.id) === String(target.folderKey)) || null;

let _statusAt = 0;
function onEvent(ev) {
  if (!_state) return;
  const it = itemOf(ev.target);
  if (!it) return;
  if (ev.type === 'start') {
    it.status = 'dl';
  } else if (ev.type === 'progress') {
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
    it.missing = rep.counts.missing;
    it.fails = rep.counts.fails;
    it.missingVoices = rep.counts.missingVoices;
    it.downloaded = r.downloaded || 0;
    if (hasFailures(rep)) pushFailure(it.name, `一部取得できず（${failureSummary(rep)}）`, true, rep);
  } else if (ev.type === 'done') {
    it.status = ev.worked || it.fails ? 'done' : 'skipped';
    it.at = Date.now();
    _state.consecutiveFailures = 0;
    _state.currentStatus = '';
  } else if (ev.type === 'error') {
    const e = ev.error;
    const msg = e && e.message ? e.message : String(e);
    pushFailure(it.name, msg);
    _state.lastError = `${it.name}: ${msg}`;
    it.status = 'failed';
    it.error = msg;
    it.at = Date.now();
    _state.consecutiveFailures = (_state.consecutiveFailures || 0) + 1;
    flush(true);
    return;
  } else if (ev.type === 'wait') {
    if (ev.phase === 'target') {
      _state.nextDlAt = ev.until;
      _state.currentStatus = '';
    }
  } else if (ev.type === 'waitEnd') {
    _state.nextDlAt = 0;
  }
  flush();
}

async function ownershipLost() {
  const st = await loadState();
  if (!st) return false;
  if (!isActive(st.phase)) return true;
  return !!st.owner && st.owner !== RUNNER_ID && st.owner < RUNNER_ID && Date.now() - (st.beat || 0) < OWNER_STALE_MS;
}

async function sleepUntil(ms) {
  if (await ownershipLost()) {
    _stopReq = true;
    wakeAll();
    return;
  }
  const end = Date.now() + ms;
  while (!_stopReq && isActiveState() && Date.now() < end) await sleepCancelable(end - Date.now());
}

async function runPipelines() {
  if (_running) return;
  _running = true;
  for (const it of _state.items) if (it.status === 'dl') it.status = 'pending';
  flush(true);
  const shouldAbort = () => _stopReq || !isActiveState();
  let outcome = 'done';
  try {
    const assets = _state.items.filter((it) => it.status === 'pending').map((it) => ({ folderKey: it.id, name: it.name }));
    if (assets.length)
      outcome = await downloadRunner.run(assets, {
        sleep: sleepUntil,
        shouldAbort,
        targetIntervalMs: (_state.dlIntervalSec || DL_INTERVAL_SEC) * 1000,
        failCap: FAIL_LIMIT,
        overwrite: !!_state.overwrite,
        report: onEvent,
      });
  } finally {
    _running = false;
  }
  if (_stopReq || !_state) return;
  if (isActive(_state.phase)) {
    if (outcome === 'failcap') _state.lastError = `${_state.consecutiveFailures}回続けて失敗したため停止しました。${_state.lastError || ''}`;
    _state.phase = outcome === 'done' || outcome === 'aborted' ? 'done' : 'error';
    _state.currentStatus = '';
    _state.nextDlAt = 0;
    _state.endedAt = Date.now();
    flush(true);
  }
}

async function start(items, opts) {
  opts = opts || {};
  if (_starting) return { ok: false, reason: 'active' };
  if (_state && isActive(_state.phase)) return { ok: false, reason: 'active' };
  if (!items || !items.length) return { ok: false, reason: 'empty' };
  _stopReq = false;
  _starting = true;
  let stored = null;
  try {
    stored = await loadState();
  } finally {
    _starting = false;
  }
  if (stored && isActive(stored.phase) && ownedByOther(stored)) return { ok: false, reason: 'active' };
  if (_stopReq) return { ok: false, reason: 'stopped' };
  const overwrite = !!opts.overwrite;
  _state = {
    phase: 'running',
    owner: RUNNER_ID,
    beat: Date.now(),
    dlIntervalSec: opts.dlIntervalSec || DL_INTERVAL_SEC,
    overwrite,
    lastError: '',
    currentStatus: '',
    nextDlAt: 0,
    consecutiveFailures: 0,
    failures: [],
    startedAt: Date.now(),
    endedAt: 0,
    items: items.map((s) => ({
      id: String(s.id),
      name: s.name || String(s.id),
      rosterKind: s.rosterKind || '',
      total: s.total || 0,
      status: 'pending',
    })),
  };
  flush(true);
  runPipelines();
  return { ok: true, stats: stats(_state.items) };
}

async function stop() {
  _stopReq = true;
  wakeAll();
  if (_starting) return;
  if (!_state) _state = await loadState();
  if (_state && isActive(_state.phase)) {
    _state.phase = 'stopped';
    _state.currentStatus = '';
    _state.endedAt = Date.now();
    flush(true);
  }
}

async function resume() {
  if (_running) return;
  const st = await loadState();
  if (st && isActive(st.phase) && !ownedByOther(st)) {
    _state = st;
    _stopReq = false;
    runPipelines();
  }
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

export const bulkDownloader = { isActive, isStarting: () => _starting, getState, stats, start, stop, resume, clear };
