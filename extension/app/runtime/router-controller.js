import { parseRoute, routeHash, routeKey, defaultSection } from './router.js';
import { redraw } from './ui-bus.js';

let appliedRoute = null;
let routeSeq = 0;
let routeBusy = false;

export function navTo(rosterKind, id, opts) {
  const o = opts || {};
  const wantEp = o.section === 'story' && o.epId;
  const section = id && o.section && (o.section !== defaultSection(rosterKind) || wantEp) ? o.section : null;
  const next = routeHash(rosterKind, id || null, section, section === 'story' ? o.epId : null);
  if (location.hash === next) {
    route(true);
    return;
  }
  try {
    if (o.replace) history.replaceState(null, '', next);
    else history.pushState(null, '', next);
    route(true);
  } catch (e) {
    location.hash = next;
  }
}

export async function route(force) {
  const key = routeKey(parseRoute());
  if (!force && key === appliedRoute) return;
  appliedRoute = key;
  routeSeq++;
  if (routeBusy) return;
  routeBusy = true;
  try {
    let applied = -1;
    while (applied !== routeSeq) {
      applied = routeSeq;
      await redraw('route', parseRoute());
    }
  } finally {
    routeBusy = false;
  }
}
