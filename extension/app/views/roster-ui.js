import { collectionRepository } from '../../data/collection.js';
import { episodeCounts, questSort } from '../../data/character-meta.js';
import { XPOS_CATEGORIES } from '../../core/constants.js';
import { settings } from '../../core/settings.js';
import { getById, el, append } from '../../core/dom.js';
import { playerState } from '../runtime/player-state.js';
import { TYPE_LABEL, spinnerHtml, kanaKey } from '../ui/ui-format.js';
import { toast } from '../ui/notifier.js';
import { navTo } from '../runtime/router-controller.js';
import { buildOnboard } from './onboarding-ui.js';
import { getOtherPanel, getHomePanel, getItemPanel, getOther2dPanel, getMonsterPanel } from '../runtime/panel-state.js';
import { focusTarget } from './roster-view.js';
import { hideRosterControls, groupHeading } from '../ui/panel-shell.js';
import { renderExScenes, resetExScenes, setThumbCache } from './exscene-view.js';

const GROUP_ORDER = ['リーニャ', 'テーセツ', 'ジャハラ', 'クォンツィ', 'ジェネラス', 'ペイシェ', 'ヒューム', 'アンノウン'];
const RANK_ORDER = ['UR', 'S', 'A', 'B'];
let filterMeta = {};
let renderSeq = 0;

const VERIFY_CONC = 8;
const verified = new Set();
const queue = [];
let observer = null;
let draining = false;

async function verifyOne(folderKey) {
  const arr = playerState.dl;
  const i = arr.findIndex((x) => String(x.folderKey) === folderKey);
  if (i < 0 || !arr[i].handle) return;
  let fresh = null;
  try {
    fresh = await collectionRepository.scanFolderHandle(arr[i].handle, folderKey);
  } catch (e) {}
  if (!fresh) return;
  const old = arr[i].counts || {};
  arr[i] = { ...fresh, at: Date.now() };
  if (old.have !== fresh.counts.have || old.partial !== fresh.counts.partial) await updateCard(folderKey);
}

async function drainQueue() {
  if (draining) return;
  draining = true;
  while (queue.length) await Promise.all(queue.splice(0, VERIFY_CONC).map(verifyOne));
  draining = false;
}

function watchCards(grid) {
  if (observer) observer.disconnect();
  if (typeof IntersectionObserver !== 'function') return;
  observer = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        observer.unobserve(en.target);
        const fk = en.target.dataset.fk;
        if (!fk || verified.has(fk)) continue;
        verified.add(fk);
        queue.push(fk);
      }
      if (queue.length) drainQueue();
    },
    { rootMargin: '200px' },
  );
  for (const card of grid.querySelectorAll('.rcard')) if (!verified.has(card.dataset.fk)) observer.observe(card);
}

function fillSelect({ selId, field, order, allLabel, current, onChange }) {
  const sel = getById(selId);
  if (!sel) return;
  sel.style.display = playerState.rosterKind === 'character' ? '' : 'none';
  const present = new Set(
    Object.values(filterMeta || {})
      .filter((m) => m.rosterKind === 'character' && m[field])
      .map((m) => m[field]),
  );
  const opts = order.filter((v) => present.has(v)).concat([...present].filter((v) => !order.includes(v)));
  sel.innerHTML = '';
  append(sel, [el('option', { value: '', text: allLabel }), ...opts.map((v) => el('option', { value: v, text: v }))]);
  sel.value = opts.includes(current) ? current : '';
  if (sel.value !== current) onChange(sel.value);
}

const BWH_INDEX = { b: 0, w: 1, h: 2 };

const PREF_KEYS = ['rosterOwn', 'rosterGroup', 'rosterRank', 'rosterSort', 'rosterSortAsc', 'rosterXpos', 'exMode', 'exFavOnly'];

export function restoreRosterPrefs() {
  for (const k of PREF_KEYS) playerState[k] = settings.get(k);
  const search = getById('rosterSearch');
  if (search) search.value = settings.get('rosterSearch') || '';
  const own = getById('rosterOwn');
  if (own) own.querySelectorAll('.rf').forEach((b) => b.classList.toggle('active', b.dataset.rosterOwn === playerState.rosterOwn));
  setThumbCache(settings.get('exThumbCache'));
}

const remember = (name, value) => {
  playerState[name] = value;
  settings.set(name, value);
};

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

function buildExModeControls() {
  const cb = getById('exMode');
  const lbl = getById('exModeLabel');
  const row = getById('exFilterRow');
  const isChar = playerState.rosterKind === 'character';
  if (lbl) lbl.style.display = isChar ? '' : 'none';
  if (row) row.style.display = isChar && playerState.exMode ? '' : 'none';
  if (!cb || cb.dataset.bound) return;
  cb.dataset.bound = '1';
  cb.checked = !!playerState.exMode;
  const f0 = getById('exFavOnly');
  if (f0) f0.checked = !!playerState.exFavOnly;
  const c0 = getById('exCache');
  if (c0) c0.checked = !!settings.get('exThumbCache');
  cb.addEventListener('change', () => {
    remember('exMode', cb.checked);
    renderRoster();
  });
  const fav = getById('exFavOnly');
  if (fav)
    fav.addEventListener('change', () => {
      remember('exFavOnly', fav.checked);
      renderRoster();
    });
  const cache = getById('exCache');
  if (cache)
    cache.addEventListener('change', () => {
      settings.set('exThumbCache', cache.checked);
      setThumbCache(cache.checked);
      renderRoster();
    });
}

function buildSortControls() {
  const sel = getById('rosterSort');
  const descLbl = getById('rosterSortDescLabel');
  const show = playerState.rosterKind === 'character' ? '' : 'none';
  if (sel) sel.style.display = show;
  if (descLbl) descLbl.style.display = show;
  if (!sel || sel.dataset.bound) return;
  sel.dataset.bound = '1';
  sel.value = playerState.rosterSort;
  const d0 = getById('rosterSortDesc');
  if (d0) d0.checked = !playerState.rosterSortAsc;
  sel.addEventListener('change', () => {
    remember('rosterSort', sel.value);
    renderRoster();
  });
  const desc = getById('rosterSortDesc');
  if (desc)
    desc.addEventListener('change', () => {
      remember('rosterSortAsc', !desc.checked);
      renderRoster();
    });
}

function buildXposFilter() {
  const sel = getById('rosterXpos');
  if (!sel) return;
  sel.style.display = playerState.rosterKind === 'character' ? '' : 'none';
  if (sel.children.length > 1) return;
  append(
    sel,
    XPOS_CATEGORIES.map(([bit, name]) => el('option', { value: String(bit), text: name })),
  );
  sel.value = String(playerState.rosterXpos || 0);
  sel.addEventListener('change', () => {
    remember('rosterXpos', Number(sel.value) || 0);
    renderRoster();
  });
}

function populateFilterSelects(folderMeta) {
  filterMeta = folderMeta || {};
  fillSelect({ selId: 'rosterGroup', field: 'group', order: GROUP_ORDER, allLabel: 'グループすべて', current: playerState.rosterGroup, onChange: (v) => remember('rosterGroup', v) });
  fillSelect({ selId: 'rosterRank', field: 'rank', order: RANK_ORDER, allLabel: 'ランクすべて', current: playerState.rosterRank, onChange: (v) => remember('rosterRank', v) });
}

const KIND_DEPS = {
  other: ['index'],
  other2d: ['index'],
  monster: ['index'],
  home: ['fs', 'index'],
  character: ['fs', 'owned', 'binlist', 'index'],
  main: ['fs', 'owned', 'binlist', 'index'],
  event: ['fs', 'owned', 'binlist', 'index'],
  special: ['fs', 'owned', 'binlist', 'index'],
};

export async function renderRoster(opts) {
  const changed = opts && opts.changed;
  const target = (opts && opts.target) || null;
  if (changed) {
    const deps = KIND_DEPS[playerState.rosterKind] || KIND_DEPS.character;
    if (!changed.some((p) => deps.includes(p))) return;
  }
  const seq = ++renderSeq;
  const stale = () => seq !== renderSeq;
  const otherPanel = getOtherPanel();
  const homePanel = getHomePanel();

  if (playerState.rosterKind !== 'character' || !playerState.exMode) {
    resetExScenes();
    getById('rosterGrid').className = 'rostergrid';
  }

  if (otherPanel && playerState.rosterKind !== 'other') otherPanel.reset();
  const o2 = getOther2dPanel();
  if (o2 && playerState.rosterKind !== 'other2d') o2.reset();
  const ep = getMonsterPanel();
  if (ep && playerState.rosterKind !== 'monster') ep.reset();
  if (playerState.rosterKind === 'home') {
    if (homePanel) {
      await homePanel.renderHome();
      if (stale()) return;
      focusTarget(homePanel, target);
    }
    return;
  }
  if (playerState.rosterKind === 'item') {
    const itemPanel = getItemPanel();
    if (itemPanel) await itemPanel.render();
    return;
  }
  if (playerState.rosterKind === 'monster') {
    if (ep) {
      await ep.render();
      if (stale()) return;
      focusTarget(ep, target);
    }
    return;
  }
  if (playerState.rosterKind === 'other2d') {
    if (o2) await o2.render();
    return;
  }
  if (playerState.rosterKind === 'other') {
    hideRosterControls();
    if (otherPanel) {
      await otherPanel.renderList(getById('rosterGrid'));
      if (stale()) return;
      focusTarget(otherPanel, target);
    } else {
      getById('rosterGrid').innerHTML = '';
    }
    return;
  }

  const bulkBtn = getById('bulkOpen');
  if (bulkBtn) bulkBtn.textContent = `一括ダウンロード（${TYPE_LABEL[playerState.rosterKind] || ''}）`;
  const grid = getById('rosterGrid');
  if (!grid.children.length) grid.innerHTML = spinnerHtml();

  let folderMeta = {};
  try {
    ({ folderMeta } = await collectionRepository.folderModel());
  } catch (e) {}
  if (stale()) return;
  grid.innerHTML = '';
  populateFilterSelects(folderMeta);
  buildXposFilter();
  buildSortControls();
  buildExModeControls();

  let hasIndex = false;
  try {
    hasIndex = await collectionRepository.indexReady();
  } catch (e) {}
  if (stale()) return;

  const showControls = playerState.fsGranted && hasIndex;
  const setD = (id, v) => {
    const node = getById(id);
    if (node) node.style.display = v;
  };

  if (!showControls) {
    for (const id of [
      'rosterSearch',
      'rosterType',
      'rosterOwn',
      'rosterGroup',
      'rosterRank',
      'bulkOpen',
      'sharedDl',
      'rostercount',
      'rosterSortLbl',
      'rosterSort',
      'rosterSortDescLabel',
      'exModeLabel',
      'exFilterRow',
    ])
      setD(id, 'none');
  } else {
    for (const id of ['rosterSearch', 'rosterType', 'bulkOpen', 'sharedDl', 'rostercount']) setD(id, '');
    setD('rosterOwn', playerState.rosterKind === 'character' ? '' : 'none');
    for (const id of ['rosterSortLbl', 'rosterSort', 'rosterSortDescLabel', 'exModeLabel']) setD(id, playerState.rosterKind === 'character' ? '' : 'none');
  }

  if (!showControls) grid.appendChild(buildOnboard({ fsGranted: playerState.fsGranted, hasIndex }));
  if (!playerState.fsGranted) {
    getById('rostercount').textContent = '';
    return;
  }

  if (playerState.exMode && playerState.rosterKind === 'character') {
    await renderExScenes(grid);
    return;
  }

  const model = await rosterModel();
  if (stale()) return;
  const frag = document.createDocumentFragment();
  for (const g of model.groups) {
    const sections = g.sections || [{ title: '', items: g.items }];
    const n = sections.reduce((a, s) => a + s.items.length, 0);
    if (!n) continue;
    groupHeading(frag, `${g.title}（${n}）`);
    for (const s of sections) {
      if (!s.items.length) continue;
      if (s.title) frag.appendChild(el('div', 'rsub', `${s.title}（${s.items.length}）`));
      frag.appendChild(el('div', 'rostercards', cardVMs(s.items, { trim: s.trim }).map(rcard)));
    }
  }
  grid.appendChild(frag);
  getById('rostercount').textContent = model.summary;
  watchCards(grid);
}

export async function rosterModel() {
  const rosterKind = playerState.rosterKind;
  let items = [];
  try {
    items = await collectionRepository.rosterItems(rosterKind, { dl: playerState.dl, distSet: playerState.binlistScenes || new Set() });
  } catch (e) {
    items = [];
  }
  const f = (getById('rosterSearch').value || '').trim();
  const fk = kanaKey(f);
  const byName = (a, b) => (a.displayName > b.displayName ? 1 : -1);
  const matchSearch = (it) => !f || kanaKey(it.displayName).includes(fk) || String(it.folderKey).includes(f);

  const summaryOf = (all) => `${all.filter((x) => episodeCounts.availableCount(x) > 0).length} / ${all.length}`;

  if (rosterKind === 'character') {
    const full = [];
    const partial = [];
    const unowned = [];
    for (const it of items) {
      if (playerState.rosterGroup && (it.group || '') !== playerState.rosterGroup) continue;
      if (playerState.rosterRank && (it.rank || '') !== playerState.rosterRank) continue;
      if (playerState.rosterOwn === 'owned' && !it.owned) continue;
      if (playerState.rosterOwn === 'unowned' && it.owned) continue;
      if (!matchSearch(it)) continue;
      if (!it.owned) (episodeCounts.distOnly(it) ? full : unowned).push(it);
      else if (episodeCounts.storyFull(it)) full.push(it);
      else partial.push(it);
    }
    const cmp = characterComparer(byName);
    full.sort(cmp);
    partial.sort(cmp);
    unowned.sort(cmp);
    return {
      rosterKind,
      groups: [
        { title: '★ 全ストーリー解放', items: full },
        { title: '解放途中', items: partial },
        { title: '未所持', items: unowned },
      ],
      summary: summaryOf([...full, ...partial, ...unowned]),
    };
  }

  if (rosterKind === 'special') {
    const bySub = {};
    for (const it of items) {
      if (!matchSearch(it)) continue;
      const sub = it.subType || '特別エピソード';
      (bySub[sub] = bySub[sub] || []).push(it);
    }
    const order = ['スペシャルエピソード', 'イベントエピソード', 'エクストラエピソード', '特別エピソード'];
    const subs = Object.keys(bySub).sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
    return {
      rosterKind,
      groups: subs.map((s) => ({ title: s, items: bySub[s].sort(byName) })),
      summary: summaryOf(Object.values(bySub).flat()),
    };
  }

  const byOrder = questSort.byQuestId((x) => x.folderKey);
  const done = [];
  const progress = [];
  const locked = [];
  for (const it of items) {
    if (!matchSearch(it)) continue;
    const avail = episodeCounts.availableCount(it);
    (episodeCounts.storyFull(it) ? done : avail > 0 ? progress : locked).push(it);
  }
  done.sort(byOrder);
  progress.sort(byOrder);
  locked.sort(byOrder);
  return {
    rosterKind,
    groups: [
      { title: '★ 全クリア', sections: questSections(rosterKind, done) },
      { title: '進行中（クリア途中）', sections: questSections(rosterKind, progress) },
      { title: '未クリア', sections: questSections(rosterKind, locked) },
    ],
    summary: summaryOf([...done, ...progress, ...locked]),
  };
}

const MINERVA = 'ミネルヴァのパワーアップロード';

function questSections(rosterKind, arr) {
  if (rosterKind === 'main') {
    const main = [],
      side = [],
      etc = [];
    for (const it of arr) (String(it.name).startsWith('メインシナリオ') ? main : String(it.name).startsWith('サイドストーリー') ? side : etc).push(it);
    return [
      { title: 'メインストーリー', items: main, trim: 'メインシナリオ' },
      { title: 'サイドストーリー', items: side, trim: 'サイドストーリー' },
      { title: 'その他', items: etc },
    ];
  }
  const mine = [],
    rest = [];
  for (const it of arr) (it.name === MINERVA ? mine : rest).push(it);
  return [
    { title: '', items: rest },
    { title: MINERVA, items: mine, trim: MINERVA },
  ];
}

function cardVM(it, opts) {
  const kind = it.rosterKind;
  const isCharacter = kind === 'character';
  const isQuest = kind === 'main' || kind === 'event';
  const isSpecial = kind === 'special';
  const c = it.counts;
  const avail = episodeCounts.availableCount(it);
  const storyFull = episodeCounts.storyFull(it);
  let name = it.displayName;
  if (opts.trim && name.startsWith(opts.trim)) name = name.slice(opts.trim.length).trim();
  if (opts.suffix) name += '　' + opts.suffix;
  return {
    folderKey: String(it.folderKey),
    rosterKind: kind,
    name,
    active: isCharacter ? !!it.owned : isSpecial ? !!it.hasDownload || avail > 0 : avail > 0,
    full: (isCharacter || isQuest) && storyFull,
    byDist: !episodeCounts.allOpen(it) && episodeCounts.distFull(it),
    hasDownload: !!it.hasDownload,
    partial: !!it.hasDownload && (c.have || 0) < (c.open || 0),
    status: isCharacter ? (it.level != null ? `Lv${it.level}` : '未所持') : isQuest ? (storyFull ? '全クリア' : c.open > 0 ? `${c.open}話クリア` : '未クリア') : avail > 0 ? '解放済み' : '未解放',
    shown: Math.max(avail, it.hasDownload ? c.have : 0),
    total: c.total || 0,
    locked: isSpecial && !avail,
  };
}

function cardVMs(items, opts) {
  const dup = new Map();
  for (const it of items) dup.set(it.displayName, (dup.get(it.displayName) || 0) + 1);
  return items.map((it) => cardVM(it, { trim: (opts || {}).trim, suffix: (dup.get(it.displayName) || 0) > 1 ? it.firstEpisodeTitle : '' }));
}

function rcard(vm) {
  const badge = !vm.hasDownload ? '' : vm.partial ? '<span class="rst part">一部DL済み</span>' : '<span class="rst dl">DL済</span>';
  const card = el('div', {
    class: 'rcard' + (vm.active ? '' : ' un') + (vm.hasDownload ? ' dl' : '') + (vm.full ? ' full' : '') + (vm.byDist ? ' distfull' : ''),
    html: `<span class="rdot ${vm.active ? 'own' : 'noown'}"></span><span class="rnm"></span><span class="rlv">${vm.status}</span><span class="rprog">${vm.shown}/${vm.total}</span>${badge}`,
    on: {
      click: () => {
        if (vm.locked) {
          toast('特別エピソードは解放制（購入/アイテム）です。未解放は取得できません（ゲームで解放済みの分のみDL可）。', 'err');
          return;
        }
        navTo(vm.rosterKind, vm.folderKey);
      },
    },
  });
  card.querySelector('.rnm').textContent = vm.name;
  card.dataset.fk = String(vm.folderKey);
  return card;
}

export async function updateCard(folderKey) {
  try {
    if (!playerState.rosterOpen) return;
    const grid = getById('rosterGrid');
    if (!grid) return;
    const old = grid.querySelector(`.rcard[data-fk="${CSS.escape(String(folderKey))}"]`);
    if (!old) return;
    const item = await collectionRepository.buildRosterItemFor(String(folderKey), { dl: playerState.dl, distSet: playerState.binlistScenes });
    if (!item || item.rosterKind !== playerState.rosterKind) return;
    old.replaceWith(rcard(cardVM(item, {})));
  } catch (e) {}
}
