const ROUTE_KINDS = ['character', 'main', 'event', 'special', 'home', 'other', 'item', 'monster', 'other2d'];
const TARGET_KINDS = ['home', 'other', 'monster'];

const dec = (s) => {
  try {
    return decodeURIComponent(s);
  } catch (e) {
    return s;
  }
};

export function parseRoute(hash = location.hash) {
  const raw = String(hash || '')
    .replace(/^#/, '')
    .trim();
  if (!raw) return { rosterKind: 'character', id: null, section: null, epId: null };
  const parts = raw.split('/');
  const rosterKind = ROUTE_KINDS.includes(parts[0]) ? parts[0] : 'character';
  const rest = parts.slice(1);
  if (isTargetRoute(rosterKind)) return { rosterKind, id: rest.length ? dec(rest.join('/')) : null, section: null, epId: null };
  return { rosterKind, id: rest[0] ? dec(rest[0]) : null, section: rest[1] || null, epId: rest[2] ? dec(rest[2]) : null };
}

export function routeHash(rosterKind, id, section, epId) {
  let h = '#' + rosterKind + (id ? '/' + encodeURIComponent(id) : '');
  if (id && section) h += '/' + section;
  if (id && section && epId) h += '/' + encodeURIComponent(epId);
  return h;
}

export function routeKey({ rosterKind, id, section, epId }) {
  const sec = section || '';
  return `${rosterKind}|${id || ''}|${sec}|${(sec && epId) || ''}`;
}

export function isTargetRoute(rosterKind) {
  return TARGET_KINDS.includes(rosterKind);
}

export { ROUTE_KINDS };
