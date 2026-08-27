import { PLACE } from '../../core/placement.js';
import { assetStore } from '../../data/asset-store.js';
import { DIRS, RARITY_NAMES, AFFILIATION_NAMES, MONSTER_TYPE_NAMES, MONSTER_RACE_NAMES } from '../../core/constants.js';
import { assetAcquirer } from '../../data/acquire/acquire-assemble.js';
import { unityMesh as MESH_MOD } from '../../unity/mesh.js';
import { loadModel3d, disposeModel3d } from '../../engine/render/lazy.js';
import { glManager } from '../../engine/render/gl-manager.js';
import { spineWeb } from '../../engine/story/spine-web.js';
import { charAssets } from '../../data/char-assets.js';
import { errText } from '../../core/messages.js';
import { hideRosterControls, splitLayout, clearView, entryCard, viewHeader, downloadBar, noteRow } from '../ui/panel-shell.js';
import { el } from '../../core/dom.js';
import { kanaKey } from '../ui/ui-format.js';

const ICON_ORDER = ['monstericon', 'battleicon', 'chibiicon', 'awakenicon'];

export function createMonsterPanel(deps) {
  const { getById, collectionRepository, toast, nameFix, spinnerHtml, visualRenderer, navTo } = deps;
  let _list = null;
  let _have = new Set();
  let _model3d = null;
  const _glRebuildOk = glManager.makeRebuildLimiter(8000, 2);
  let _spine = [];
  let _gen = 0;
  let _cards = new Map();
  let _cardsHost = null;
  let _ready = 0;
  let _searchBound = false;

  function disposeAll() {
    for (const p of _spine) {
      try {
        p && p.dispose && p.dispose();
      } catch (e) {}
    }
    _spine = [];
    _model3d = disposeModel3d(_model3d);
  }

  function view(e) {
    const byRel = new Map();
    const byCat = new Map();
    for (const a of e.assets || []) {
      if (!_have.has(a.id)) continue;
      byRel.set(a.rel, a);
      if (!byCat.has(a.cat)) byCat.set(a.cat, []);
      byCat.get(a.cat).push(a);
    }
    return {
      read: (rel) => (byRel.has(rel) ? assetStore.readAsset(DIRS.monster, rel, PLACE.owned(byRel.get(rel))) : Promise.resolve(null)),
      of: (cat) => byCat.get(cat) || [],
    };
  }

  function dlBar(status) {
    return downloadBar({
      text: `未取得 ${status.missing.length}バンドル（全部そろっているのは ${status.ready}/${status.monsters}体）`,
      label: 'モンスター資産をダウンロード',
      run: async (onProgress) => {
        try {
          const r = await assetAcquirer.runMonsterDownload(onProgress);
          toast(`モンスター資産を取得しました（新規${r.got}件${r.failed ? `・失敗${r.failed}件` : ''}）`, r.failed ? 'err' : 'ok');
          await render();
        } catch (er) {
          onProgress(errText(er));
        }
      },
    });
  }

  async function paintIcons(host, e, v) {
    for (const cat of ICON_ORDER) {
      for (const a of v.of(cat)) {
        const bytes = await v.read(a.rel);
        if (!bytes) continue;
        let cvs = [];
        try {
          cvs = MESH_MOD.decodeAllTextureCanvases(bytes);
        } catch (er) {}
        for (const cv of cvs) {
          cv.className = 'monstericon';
          host.appendChild(cv);
        }
      }
    }
  }

  async function paintSpine(host, e, v, alive) {
    const list = [...v.of('spine'), ...v.of('spinelight')];
    if (!list.length) return noteRow(host, '立ち絵が未取得です。');
    const rt = await visualRenderer.prepareSpineRuntime(host);
    if (!alive()) return;
    if (!rt || !rt.ok) return noteRow(host, 'Spineランタイムを初期化できませんでした。');
    const grid = el('div', 'spine-grid stand');
    host.appendChild(grid);
    for (const a of list) {
      const cell = el('div', 'spine-cell');
      grid.appendChild(cell);
      let inputs = null;
      try {
        const bytes = await v.read(a.rel);
        if (bytes) inputs = MESH_MOD.extractSpineInputs(bytes);
      } catch (er) {}
      if (!alive()) return;
      if (!inputs) {
        noteRow(cell, '立ち絵を取り出せませんでした。');
        continue;
      }
      const box = el('div', 'spine-player-box');
      cell.appendChild(box);
      try {
        const { player } = spineWeb.buildPlayable(box, inputs, {
          showControls: true,
          backgroundColor: '#00000000',
          onReady: (pl) => spineWeb.startDefaultIdle(pl),
          onError: (m) => noteRow(cell, 'Spine失敗: ' + m),
        });
        if (player) _spine.push(player);
      } catch (er) {
        noteRow(cell, 'Spine失敗: ' + errText(er));
      }
    }
  }

  const loadModel = (variant, v) => charAssets.loadModelBundle(v.read, variant.model, variant.meshDeps, { always: true });
  const loadMaterials = (variant, v) => charAssets.loadMaterialBundle(v.read, variant.material);

  function modelVariants(e) {
    const list = [];
    if (e.model) list.push({ label: '通常', model: e.model, material: e.material, meshDeps: e.meshDeps || [] });
    for (const alt of e.altModels || []) list.push({ label: `別モデル #${alt.id}`, model: alt.model, material: alt.material, meshDeps: alt.meshDeps });
    return list;
  }

  async function paintModel(host, e, v, alive) {
    const variants = modelVariants(e);
    if (!variants.length) return noteRow(host, 'このモンスターには3Dモデルがありません。');
    const weapons = await charAssets.buildWeapons(v.read, e.weapons);
    if (!alive()) return;

    const canvasHost = el('div');
    const paint = async (variant) => {
      const [model, matBundle] = [await loadModel(variant, v), await loadMaterials(variant, v)];
      if (!alive()) return;
      _model3d = disposeModel3d(_model3d);
      canvasHost.innerHTML = '';
      if (!model) return noteRow(canvasHost, '3Dモデルが未取得か、読み込めませんでした。');
      const opts = charAssets.build3dOptions({ weapons }, e, { height: 380, hidePartsUI: true });
      opts.onContextLost = () => (_glRebuildOk() ? (paint(variant), true) : false);
      const r = (await loadModel3d()).render(canvasHost, model, matBundle, opts);
      _model3d = r && r.dispose ? r : null;
      if (r && r.ok === false) noteRow(canvasHost, '3Dを表示できませんでした（' + (r.reason || '不明') + '）。');
    };

    if (variants.length > 1) {
      const sel = el(
        'select',
        { class: 'rgsel', on: { change: () => paint(variants[Number(sel.value)]) } },
        variants.map((variant, i) => el('option', { value: i, text: variant.label })),
      );
      host.appendChild(el('div', 'enemyvarrow', [el('span', 'note dim', `見た目（${variants.length}種）`), sel]));
    }
    host.appendChild(canvasHost);
    await paint(variants[0]);
  }

  const GRID_ROWS = [
    ['レアリティ', (e) => RARITY_NAMES[e.rarity]],
    ['タイプ', (e) => MONSTER_TYPE_NAMES[e.type]],
    ['グループ', (e) => AFFILIATION_NAMES[e.affiliation]],
    ['種族', (e) => MONSTER_RACE_NAMES[e.race]],
    ['コスト', (e) => (e.cost ? String(e.cost) : '')],
    ['最大レベル', (e) => (e.maxLevel ? String(e.maxLevel) : '')],
    ['すき', (e) => e.likes],
    ['きらい', (e) => e.dislikes],
  ];

  const cell = (label, v) => el('div', 'dinfocell', [el('span', 'dinfo-label', label), el('span', 'dinfo-value', nameFix(v))]);

  function profile(e) {
    const grid = GRID_ROWS.map(([label, get]) => [label, get(e)]).filter(([, v]) => v);
    const kids = [];
    if (grid.length)
      kids.push(
        el(
          'div',
          'dinfogrid',
          grid.map(([label, v]) => cell(label, v)),
        ),
      );
    if (e.desc) kids.push(el('div', 'dinforow', [el('span', 'dinfo-label', 'このモンスターについて'), el('span', 'dinfo-value', nameFix(e.desc))]));
    return el('div', 'dinfo', kids);
  }

  async function openMonster(e) {
    const host = getById('monsterView');
    if (!host) return;
    disposeAll();
    const gen = ++_gen;
    const alive = () => gen === _gen;
    host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    host.innerHTML = '';
    host.appendChild(viewHeader(e.name ? `${nameFix(e.name)}　#${e.id}` : `#${e.id}`, _list, e, openMonster));
    const v = view(e);
    const iconRow = el('div', 'monstericons');
    host.appendChild(iconRow);
    await paintIcons(iconRow, e, v);
    if (!alive()) return;
    host.appendChild(profile(e));
    await paintSpine(host, e, v, alive);
    if (!alive()) return;
    await paintModel(host, e, v, alive);
  }

  const card = (e) => {
    const node = entryCard({
      name: e.name ? nameFix(e.name) : '#' + e.id,
      note: e.name ? '#' + e.id : '',
      ready: collectionRepository.monsterReady(e, _have),
      onClick: () => (typeof navTo === 'function' ? navTo('monster', String(e.id)) : openTarget(String(e.id))),
    });
    _cards.set(String(e.id), node);
    return node;
  };

  function openTarget(id) {
    const key = String(id);
    const entry = (_list || []).find((e) => String(e.id) === key);
    if (!entry) return;
    for (const [k, node] of _cards) node.classList.toggle('sel', k === key);
    openMonster(entry);
  }

  function matches(e, q) {
    if (!q) return true;
    const name = e.name ? nameFix(e.name) : '';
    return kanaKey(name).includes(kanaKey(q)) || String(e.id).includes(q);
  }

  function paintCards() {
    if (!_cardsHost) return;
    const q = ((getById('rosterSearch') || {}).value || '').trim();
    const shown = (_list || []).filter((e) => matches(e, q));
    _cards = new Map();
    _cardsHost.innerHTML = '';
    _cardsHost.append(...shown.map(card));
    const count = getById('rostercount');
    if (count) count.textContent = `${_ready} / ${(_list || []).length}`;
  }

  function bindSearch() {
    if (_searchBound) return;
    const input = getById('rosterSearch');
    if (!input) return;
    _searchBound = true;
    input.addEventListener('input', () => {
      if (_cardsHost && _cardsHost.isConnected) paintCards();
    });
  }

  async function render() {
    const grid = getById('rosterGrid');
    if (!grid) return;
    hideRosterControls({ keepSearch: true });
    disposeAll();
    _gen++;
    _cards = new Map();
    grid.innerHTML = spinnerHtml('モンスターを読み込み中…');
    try {
      _list = await collectionRepository.monsterList();
    } catch (er) {
      grid.innerHTML = '';
      noteRow(grid, 'モンスターを読み込めませんでした。' + errText(er));
      return;
    }
    let status = null;
    try {
      status = await collectionRepository.monsterStatus(_list);
    } catch (er) {}
    _have = (status && status.have) || new Set();
    _ready = status ? status.ready : 0;

    grid.innerHTML = '';
    if (status && status.missing.length) grid.appendChild(dlBar(status));

    const { listCol } = splitLayout(grid, 'monsterView', 'カードを選ぶとここに表示');
    _cardsHost = el('div', 'rostercards');
    listCol.appendChild(_cardsHost);
    bindSearch();
    paintCards();
  }

  function reset() {
    disposeAll();
    _gen++;
    clearView('monsterView', 'カードを選ぶとここに表示');
  }

  return { render, reset, openTarget };
}
