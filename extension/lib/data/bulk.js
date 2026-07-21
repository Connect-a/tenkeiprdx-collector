'use strict';

(function () {
  const COLLECTION = globalThis.TP_COLLECTION;
  const ACQUIRE = globalThis.TP_ACQUIRE;
  const FS = globalThis.TP_FS;
  const KEY = 'bulkState';
  const FAIL_LIMIT = 5;
  const DOWNLOAD_CONCURRENCY = 1;
  const GD_INTERVAL_SEC = 3;
  const LOG_FLUSH = 10;
  const DL_INTERVAL_SEC = 300;

  const isActive = (phase) => phase === 'running';
  const isActiveState = () => !!_state && _state.phase === 'running';

  let _state = null;
  let _stopReq = false;
  let _running = false;
  let _readyQueue = [];
  let _aDone = false;
  let _bInFlight = 0;

  async function loadState() { try { return (await chrome.storage.local.get(KEY))[KEY] || null; } catch (e) { return null; } }

  let _flushTimer = null, _flushPending = false;
  function flush(force) {
    if (!_state) return;
    if (force) { if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; } _flushPending = false; try { chrome.storage.local.set({ [KEY]: _state }); } catch (e) {} return; }
    if (_flushTimer) { _flushPending = true; return; }
    try { chrome.storage.local.set({ [KEY]: _state }); } catch (e) {}
    _flushTimer = setTimeout(() => { _flushTimer = null; if (_flushPending) { _flushPending = false; flush(); } }, 500);
  }

  function stats(items) {
    let done = 0, skipped = 0, failed = 0, dl = 0;
    for (const it of items) { if (it.status === 'done') done++; else if (it.status === 'skipped') skipped++; else if (it.status === 'failed') failed++; else if (it.status === 'dl') dl++; }
    return { total: items.length, done, skipped, failed, dl, processed: done + skipped + failed, pending: items.length - done - skipped - failed };
  }

  const _wakers = new Set();
  function sleepCancelable(ms) {
    return new Promise((res) => {
      if (ms <= 0) return res();
      const w = () => { clearTimeout(t); _wakers.delete(w); res(); };
      const t = setTimeout(w, Math.min(ms, 60000));
      _wakers.add(w);
    });
  }
  const wakeAll = () => { for (const w of [..._wakers]) w(); };
  async function waitUntil(ts) {
    while (!_stopReq && isActiveState() && Date.now() < ts) await sleepCancelable(ts - Date.now());
  }

  function pushFailure(name, reason, soft) {
    if (!_state.failures) _state.failures = [];
    _state.failures.push({ name, reason, soft: !!soft, at: Date.now() });
    if (_state.failures.length > 500) _state.failures.shift();
    try { (soft ? console.warn : console.error)('[一括DL失敗]', name, reason); } catch (e) {}
  }

  function recomputeGd() {
    let total = 0, done = 0, failed = 0;
    for (const it of _state.items) { total += it.gdNeed || 0; done += it.gdGot || 0; failed += it.gdFail || 0; }
    _state.gd = { total, done, failed };
  }

  function makeProgress(prefix) {
    let last = 0;
    return (msg) => {
      const now = Date.now();
      if (now - last < 800) return;
      last = now;
      if (!isActiveState()) return;
      _state.currentStatus = prefix ? `${prefix}: ${msg}` : msg;
      flush();
    };
  }

  const enqueueB = (id) => { _readyQueue.push(String(id)); wakeAll(); };

  async function storyMetaPipeline() {
    let lastAt = 0;
    for (const it of _state.items) {
      if (_stopReq || !isActiveState() || _state.tokenError) break;
      if (it.gd !== 'pending') continue;
      let plan = null;
      try { plan = await ACQUIRE.planApiEpisodes(it.id); } catch (e) { console.debug('[tp] bulk: planApiEpisodes failed', it.id, e); }
      if (!plan) { it.gd = 'done'; enqueueB(it.id); flush(); continue; }
      const eps = plan.episodes || [];
      it.gdNeed = eps.length;
      _state.gd.total += eps.length;
      _state.gdStatus = eps.length ? `ストーリーメタ 待機中… ${it.name}` : '';
      flush();

      const charLog = [];
      for (const ep of eps) {
        if (_stopReq || !isActiveState()) { _aDone = true; if (charLog.length) { try { await ACQUIRE.postLog(charLog, it.id); } catch (e) {} } return; }
        const wait = lastAt + (_state.gdIntervalSec || 5) * 1000 - Date.now();
        if (wait > 0) { _state.gdStatus = `ストーリーメタ 待機中… ${it.name}`; flush(); await sleepCancelable(wait); }
        if (_stopReq || !isActiveState()) { _aDone = true; if (charLog.length) { try { await ACQUIRE.postLog(charLog, it.id); } catch (e) {} } return; }
        lastAt = Date.now();
        _state.gdStatus = `ストーリーメタ 取得中 ${it.name} #${ep.id}`; flush();
        let res = null, threw = null;
        try { res = await ACQUIRE.apiFetchStory(plan.dir, plan.apiType, ep.id, ep.subType); }
        catch (e) { threw = e; }
        if (threw && threw.auth) {
          _state.tokenError = true; _state.lastError = 'トークン切れ（ストーリーメタ取得を停止）';
          pushFailure(it.name, 'トークン切れでストーリーメタ未取得');
          flush(true);
          break;
        }
        if (res && res.ok) {
          it.gdGot = (it.gdGot || 0) + 1; _state.gd.done++;
          if (res.log && res.log.length) { it.gdFetched = (it.gdFetched || 0) + res.log.length; charLog.push(...res.log); }
          if (charLog.length >= LOG_FLUSH) { try { await ACQUIRE.postLog(charLog.splice(0), it.id); } catch (e) {} }
        } else { it.gdFail = (it.gdFail || 0) + 1; _state.gd.failed++; }
        flush();
      }
      if (charLog.length) { try { await ACQUIRE.postLog(charLog, it.id); } catch (e) {} }
      it.gd = it.gdFail ? (it.gdGot ? 'partial' : (eps.length ? 'failed' : 'done')) : 'done';
      if (it.gdFail && !it.gdGot && eps.length) pushFailure(it.name, `ストーリーメタ ${it.gdFail}件失敗`, true);
      enqueueB(it.id);
      flush();
      if (_state.tokenError) break;
    }
    _aDone = true;
    _state.gdStatus = '';
    flush();
    wakeAll();
  }

  async function assetDownloadWorker() {
    for (;;) {
      if (_stopReq || !isActiveState()) return;
      if (!_readyQueue.length) { if (_aDone) return; await sleepCancelable(250); continue; }
      const id = _readyQueue.shift();
      const it = _state.items.find((x) => String(x.id) === String(id));
      if (!it || it.status === 'done' || it.status === 'failed' || it.status === 'skipped') continue;
      _bInFlight++;
      it.status = 'dl'; flush();
      let result = null, threw = null;
      const progress = makeProgress(it.name);
      try { result = await ACQUIRE.downloadCharacterAssets(it.id, progress); }
      catch (e) { threw = e; }
      if (_stopReq || !isActiveState()) { _bInFlight--; return; }
      if (threw) {
        it.status = 'failed'; it.error = (threw && threw.message) ? threw.message : String(threw); it.at = Date.now();
        _state.consecutiveFailures = (_state.consecutiveFailures || 0) + 1;
        _state.lastError = `${it.name}: ${it.error}`;
        pushFailure(it.name, it.error);
      } else {
        const cp = (result && result.meta && result.meta.completeness) || {};
        it.covered = cp.episodesAvailable || 0; it.total = cp.episodesTotal || it.total || 0;
        it.voiced = cp.voicedScenes || 0; it.bg = cp.sceneBgResolved || 0;
        it.assetCats = cp.assetCategories || 0; it.cast = cp.castResolved || 0;
        it.missing = (result && result.missing) ? result.missing.length : 0;
        it.fails = (result && result.fails) ? result.fails.length : 0;
        it.missingVoices = (result && result.missingVoices) ? result.missingVoices.length : (cp.missingVoices || 0);
        it.downloaded = (result && result.downloaded) || 0;
        const didWork = it.downloaded > 0 || it.gdFetched > 0 || it.fails || it.missing || it.missingVoices;
        it.at = Date.now(); it.status = didWork ? 'done' : 'skipped'; _state.consecutiveFailures = 0;
        if (it.fails || it.missing || it.missingVoices) pushFailure(it.name, `一部失敗（通信失敗${it.fails} / CDN欠番${it.missing} / voice未取得${it.missingVoices}）`, true);
      }
      _bInFlight--;
      flush();
      if ((_state.consecutiveFailures || 0) >= FAIL_LIMIT) {
        _state.lastError = `連続${_state.consecutiveFailures}回失敗のため停止（最後: ${_state.lastError || ''}）`;
        _state.phase = 'error'; _state.currentStatus = ''; _state.gdStatus = ''; _state.endedAt = Date.now();
        flush(true); _stopReq = true; wakeAll(); return;
      }
      const moreComing = _readyQueue.length > 0 || !_aDone;
      if (it.status === 'done' && it.downloaded > 0 && moreComing && !_stopReq && isActiveState()) {
        _state.nextDlAt = Date.now() + (_state.dlIntervalSec || DL_INTERVAL_SEC) * 1000;
        _state.currentStatus = ''; flush();
        await waitUntil(_state.nextDlAt);
        _state.nextDlAt = 0; flush();
      }
    }
  }

  async function runPipelines() {
    if (_running) return;
    _running = true;
    _readyQueue = []; _aDone = false; _bInFlight = 0;
    for (const it of _state.items) {
      if (it.status === 'dl') it.status = 'pending';
      if (it.status === 'pending' && it.gd !== 'pending' && it.gd !== 'skipped') _readyQueue.push(String(it.id));
    }
    recomputeGd();
    flush(true);
    try {
      await Promise.all([storyMetaPipeline()].concat(Array.from({ length: DOWNLOAD_CONCURRENCY }, () => assetDownloadWorker())));
    } finally { _running = false; }
    if (_stopReq || !_state) return;
    if (isActive(_state.phase)) {
      _state.phase = _state.tokenError ? 'error' : 'done';
      if (_state.tokenError && !_state.lastError) _state.lastError = 'トークンが切れました。取り直して再開してください。';
      _state.currentStatus = ''; _state.gdStatus = ''; _state.endedAt = Date.now();
      flush(true);
    }
  }

  async function start(items, opts) {
    opts = opts || {};
    if (_state && isActive(_state.phase)) return { ok: false, reason: 'active' };
    if (!items || !items.length) return { ok: false, reason: 'empty' };
    const overwrite = !!opts.overwrite;
    let have = new Set();
    if (!overwrite) { try { have = new Set((await COLLECTION.scanFolder()).filter((x) => x.total > 0 && x.covered >= x.total && !x.unresolved).map((x) => String(x.charId))); } catch (e) {} }
    _state = {
      phase: 'running', gdIntervalSec: opts.gdIntervalSec || GD_INTERVAL_SEC, dlIntervalSec: opts.dlIntervalSec || DL_INTERVAL_SEC, overwrite,
      tokenError: false, lastError: '', currentStatus: '', gdStatus: '', nextDlAt: 0,
      gd: { total: 0, done: 0, failed: 0 }, consecutiveFailures: 0, failures: [],
      startedAt: Date.now(), endedAt: 0,
      items: items.map((s) => {
        const skip = !overwrite && have.has(String(s.id));
        return { id: String(s.id), name: s.name || String(s.id), type: s.type || '', total: s.total || 0,
          gd: skip ? 'skipped' : 'pending', gdNeed: 0, gdGot: 0, gdFail: 0, status: skip ? 'skipped' : 'pending' };
      }),
    };
    flush(true);
    _stopReq = false;
    runPipelines();
    return { ok: true, stats: stats(_state.items) };
  }

  async function stop() {
    _stopReq = true; wakeAll();
    if (!_state) _state = await loadState();
    if (_state) { _state.phase = 'stopped'; _state.currentStatus = ''; _state.gdStatus = ''; _state.endedAt = Date.now(); flush(true); }
  }

  async function resume() {
    if (_running) return;
    const st = await loadState();
    if (st && isActive(st.phase)) { _state = st; _stopReq = false; runPipelines(); }
  }

  async function getState() { return _state || (await loadState()); }

  async function clear() {
    if (_state && isActive(_state.phase)) return { ok: false, reason: 'active' };
    _state = null; _stopReq = false;
    try { await chrome.storage.local.remove(KEY); } catch (e) {}
    return { ok: true };
  }

  globalThis.TP_BULK = { KEY, isActive, getState, stats, start, stop, resume, clear };
})();
