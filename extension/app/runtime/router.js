const ROUTE_KINDS = ['character', 'main', 'event', 'special', 'home', 'other', 'item', 'monster', 'other2d'];
const TARGET_KINDS = ['home', 'other', 'monster'];

export function parseRoute(hash = location.hash) {
  const raw = String(hash || '')
    .replace(/^#/, '')
    .trim();
  if (!raw) return { rosterKind: 'character', id: null };
  const parts = raw.split('/');
  const rosterKind = ROUTE_KINDS.includes(parts[0]) ? parts[0] : 'character';
  let id = null;
  if (parts.length > 1) {
    const encodedId = parts.slice(1).join('/');
    try {
      id = decodeURIComponent(encodedId);
    } catch (e) {
      id = encodedId;
    }
  }
  return { rosterKind, id };
}

export function routeHash(rosterKind, id) {
  return '#' + rosterKind + (id ? '/' + encodeURIComponent(id) : '');
}

export function isTargetRoute(rosterKind) {
  return TARGET_KINDS.includes(rosterKind);
}

export { ROUTE_KINDS };
