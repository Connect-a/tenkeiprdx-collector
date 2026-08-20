export const playerState = {
  dl: [],
  owned: new Map(),
  binlistScenes: new Set(),
  _bulkCandidates: [],
  fsGranted: false,
  rosterOpen: false,
  rosterKind: 'character',
  rosterOwn: 'all',
  rosterGroup: '',
  rosterRank: '',
  cur: null,
  navId: null,
  imageAutoKey: null,

  viewKey() {
    return this.cur ? String(this.cur.folderKey || '') : '';
  },
  contentKey() {
    return this.cur ? this.viewKey() + ':' + String((this.cur.meta && this.cur.meta.builtAt) || '') : '';
  },
};
