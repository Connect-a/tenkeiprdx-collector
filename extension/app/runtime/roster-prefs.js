import { settings } from '../../core/settings.js';
import { playerState } from './player-state.js';

const ROSTER_PREF_KEYS = ['rosterOwn', 'rosterGroup', 'rosterRank', 'rosterSearch', 'rosterSort', 'rosterSortAsc', 'rosterXpos', 'exMode', 'exFavOnly'];

export function loadRosterPrefs() {
  for (const k of ROSTER_PREF_KEYS) playerState[k] = settings.get(k);
}

export const rosterQuery = () => String(playerState.rosterSearch || '').trim();

export const setRosterQuery = (value) => {
  playerState.rosterSearch = String(value || '');
};

export function rememberRosterPref(name, value) {
  playerState[name] = value;
  settings.set(name, value);
}

const BWH_INDEX = { b: 0, w: 1, h: 2 };

export function characterComparer(byName) {
  const dir = playerState.rosterSortAsc ? 1 : -1;
  const key = playerState.rosterSort;
  if (key === 'id') return (a, b) => dir * (Number(a.folderKey) - Number(b.folderKey));
  const i = BWH_INDEX[key];
  if (i != null)
    return (a, b) => {
      const av = a.bwh ? a.bwh[i] : null;
      const bv = b.bwh ? b.bwh[i] : null;
      if (av == null && bv == null) return byName(a, b);
      if (av == null) return 1;
      if (bv == null) return -1;
      return dir * (av - bv) || byName(a, b);
    };
  return (a, b) => dir * byName(a, b);
}
