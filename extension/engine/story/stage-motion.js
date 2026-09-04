const ACT_DUR = { 1: 0.5, 2: 1.0, 3: 1.3, 4: 0.25, 6: 0.5, 9: 0.7 };
export const EXIT_CODES = new Set([7, 8, 9, 10, 11, 12, 13, 16, 17]);
export const ZOOM_ACTION_CODES = new Set([7, 8]);

export function actionDuration(code) {
  return ACT_DUR[code] || 0.5;
}

export function appearTr(code) {
  const D = 1500;
  const mk = (mode, axis, sign, dur, opts) => Object.assign({ mode, axis, sign, dur, ease: 'outCubic', dist: D, t: 0, fade: false }, opts || {});
  switch (code) {
    case 1:
      return mk('in', null, 0, 0.3, { fade: true, ease: 'linear' });
    case 2:
      return mk('in', 'y', -1, 0.75);
    case 3:
      return mk('in', 'x', -1, 0.75);
    case 4:
      return mk('in', 'x', 1, 0.75);
    case 5:
      return mk('in', 'x', -1, 0.375);
    case 6:
      return mk('in', 'x', 1, 0.375);
    case 8:
      return mk('out', null, 0, 0.3, { fade: true, ease: 'linear' });
    case 9:
      return mk('out', 'y', -1, 0.75);
    case 10:
      return mk('out', 'x', -1, 0.75);
    case 11:
      return mk('out', 'x', 1, 0.75);
    case 12:
      return mk('out', 'x', -1, 0.25);
    case 13:
      return mk('out', 'x', 1, 0.25);
    case 14:
      return mk('in', 'y', 1, 0.75);
    case 15:
      return mk('in', 'y', 1, 2.0);
    case 16:
      return mk('out', 'y', 1, 0.75);
    case 17:
      return mk('out', 'y', 1, 2.0);
    default:
      return null;
  }
}

const outSine = (x) => Math.sin((x * Math.PI) / 2);
const outCubic = (x) => 1 - Math.pow(1 - x, 3);

export function stepMotion(actor, dt, env) {
  const { W, H, refW, refH } = env;
  let ox = 0,
    oy = 0,
    alpha = 1,
    finishedOut = false;
  if (actor.tr) {
    actor.tr.t += dt;
    const k = Math.min(1, actor.tr.t / actor.tr.dur);
    const eased = actor.tr.ease === 'linear' ? k : 1 - Math.pow(1 - k, 3);
    const p = actor.tr.mode === 'in' ? 1 - eased : eased;
    const dist = actor.tr.dist || 0;
    if (actor.tr.axis === 'x') ox = dist * (W / refW) * p * (actor.tr.sign || 1);
    else if (actor.tr.axis === 'y') oy = dist * (H / refH) * p * (actor.tr.sign || 1);
    if (actor.tr.fade) alpha = actor.tr.mode === 'in' ? k : 1 - k;
    if (k >= 1) {
      if (actor.tr.mode === 'out') finishedOut = true;
      actor.tr = null;
    }
  }
  if (actor.act) {
    actor.act.t += dt;
    const t = actor.act.t;
    if (t >= actor.act.dur) actor.act = null;
    else {
      const R = H / refH;
      const k = t / actor.act.dur;
      switch (actor.act.type) {
        case 1:
          oy += 10 * R * Math.abs(Math.sin(k * Math.PI * 2));
          break;
        case 2: {
          const decay = 1 - k;
          const osc = Math.cos(k * Math.PI * 20);
          ox += 5 * R * decay * osc;
          oy += 5 * R * decay * osc;
          break;
        }
        case 3:
          if (t < 0.6) oy -= 25 * R * outSine(t / 0.6);
          else if (t < 0.8) oy -= 25 * R;
          else oy -= 25 * R * (1 - outCubic((t - 0.8) / 0.5));
          break;
        case 4:
          oy += 10 * R * Math.abs(Math.sin(k * Math.PI));
          break;
        case 6:
          alpha *= 1 - k;
          break;
        case 9:
          oy -= 25 * R * outSine(Math.min(1, t / 0.6));
          alpha *= Math.max(0, 1 - k);
          break;
      }
    }
  }
  return { ox, oy, alpha, finishedOut };
}
