export const playerState = {
  dl: [],
  owned: new Map(),
  binlistScenes: new Set(),
  _bulkCandidates: [],
  fsGranted: false,
  rosterOpen: false,
  rosterKind: 'character',
  rosterOwn: 'all',
  rosterAffiliation: '',
  rosterRarity: '',
  rosterXpos: 0,
  rosterSort: 'name',
  rosterSortAsc: true,
  exMode: false,
  exFavOnly: false,
  cur: null,
  navId: null,
  imageAutoKey: null,
  selGen: 0,

  setNav(folderKey) {
    this.navId = folderKey == null ? null : String(folderKey);
    return ++this.selGen;
  },
  isStale(gen) {
    return this.selGen !== gen;
  },

  viewKey() {
    return this.cur ? String(this.cur.folderKey || '') : '';
  },
  contentKey() {
    return this.cur ? this.viewKey() + ':' + String((this.cur.meta && this.cur.meta.builtAt) || '') : '';
  },
};
