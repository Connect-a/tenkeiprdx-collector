const STEP = 1000 / 60;
const IDLE_END_MS = 350;

export function createFrameLoop(io) {
  let raf = 0,
    prev = 0,
    acc = 0,
    simMs = 0,
    started = false,
    idleMs = 0;

  const reset = () => {
    acc = 0;
    simMs = 0;
    started = false;
    idleMs = 0;
  };

  const tick = (t, loop, dataMs, hardMs) => {
    const realDt = io.paused() ? 0 : t - prev;
    acc += realDt * io.speed();
    prev = t;
    let guard = 0;
    try {
      while (acc >= STEP && guard++ < 8) {
        io.stepSim(simMs, 1 / 60);
        acc -= STEP;
        simMs += STEP;
      }
      io.render(realDt);
    } catch (e) {
      io.onError(e);
      return false;
    }
    const live = io.liveCount();
    if (live > 0) {
      started = true;
      idleMs = 0;
    } else if (started) idleMs += realDt;
    const ended = dataMs ? simMs >= dataMs : started && idleMs > IDLE_END_MS;
    if (loop) {
      if (ended) {
        io.onRestart();
        reset();
      }
      return true;
    }
    if (ended || (!dataMs && simMs >= (hardMs || 1500))) {
      io.onEnd();
      return false;
    }
    return true;
  };

  return {
    get running() {
      return !!raf;
    },
    start(loop, dataMs, hardMs) {
      prev = performance.now();
      reset();
      const frame = (t) => {
        raf = 0;
        if (tick(t, loop, dataMs, hardMs)) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
