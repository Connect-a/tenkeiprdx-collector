const WORKER_SRC = 'onmessage=function(e){var d=e.data;setTimeout(function(){postMessage(d.id);},d.ms);};';

const IDLE_TERM_MS = 30000;

let _worker;
let _seq = 0;
let _idleTerm = null;
const _waiting = new Map();

function scheduleIdleTerm() {
  clearTimeout(_idleTerm);
  if (!_worker || _waiting.size) return;
  _idleTerm = setTimeout(() => {
    if (_worker && !_waiting.size) {
      _worker.terminate();
      _worker = undefined;
    }
  }, IDLE_TERM_MS);
}

function ensureWorker() {
  clearTimeout(_idleTerm);
  if (_worker !== undefined) return _worker;
  _worker = null;
  let w = null;
  try {
    w = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })));
  } catch (e) {
    console.warn('[tp] バックグラウンドタイマーを起動できませんでした', e);
    return _worker;
  }
  w.onmessage = (e) => {
    const fn = _waiting.get(e.data);
    if (!fn) return;
    _waiting.delete(e.data);
    fn();
  };
  w.onerror = () => {
    if (_worker === w) _worker = null;
  };
  _worker = w;
  return _worker;
}

export function bgTimeout(ms, fn) {
  let done = false;
  let id = 0;
  const cancelAll = () => {
    clearTimeout(t);
    if (id) _waiting.delete(id);
    scheduleIdleTerm();
  };
  const fire = () => {
    if (done) return;
    done = true;
    cancelAll();
    fn();
  };
  const t = setTimeout(fire, ms);
  const w = ensureWorker();
  if (w) {
    id = ++_seq;
    _waiting.set(id, fire);
    w.postMessage({ id, ms });
  }
  return () => {
    done = true;
    cancelAll();
  };
}

export const bgSleep = (ms) => (ms > 0 ? new Promise((res) => bgTimeout(ms, res)) : Promise.resolve());
