const _seen = new Set();

export function noteFailure(scope, kind, err) {
  const key = String(scope || '?') + '\u0000' + String(kind || '?');
  if (_seen.has(key)) return;
  _seen.add(key);
  console.warn('[tp] ' + String(scope || '?') + ' / ' + String(kind || '?'), err);
}
