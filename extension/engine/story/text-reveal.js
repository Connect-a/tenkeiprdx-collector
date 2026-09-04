import { scenarioSettings } from './scenario-settings.js';

export function createTextReveal(getEl) {
  let raf = 0;
  let full = '';
  let active = false;

  function stop() {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    active = false;
  }

  function start(text) {
    stop();
    full = text || '';
    const el = getEl();
    if (!el) return;
    const ms = scenarioSettings.textMs();
    if (!full || !ms) {
      el.textContent = full;
      return;
    }
    el.textContent = '';
    active = true;
    const t0 = performance.now();
    const step = () => {
      if (!active) return;
      const n = Math.min(full.length, Math.floor((performance.now() - t0) / ms));
      el.textContent = full.slice(0, n);
      if (n >= full.length) {
        stop();
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  function complete() {
    stop();
    const el = getEl();
    if (el) el.textContent = full;
  }

  return {
    start,
    stop,
    complete,
    get revealing() {
      return active;
    },
  };
}
