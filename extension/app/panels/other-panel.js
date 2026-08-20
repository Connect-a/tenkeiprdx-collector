import { unityMesh as MESH_MOD } from '../../unity/mesh.js';
import { assetStore } from '../../data/asset-store.js';
import { PLACE } from '../../core/placement.js';
import { model3dRenderer } from '../../engine/render/model3d.js';
import { glManager } from '../../engine/render/gl-manager.js';
import { charAssets } from '../../data/char-assets.js';
import { DIRS } from '../../core/constants.js';
import { assetAcquirer } from '../../data/acquire/acquire-assemble.js';
import { errText } from '../../core/messages.js';
import { splitLayout, clearView, entryCard, viewHeader, downloadBar, noteRow } from '../ui/panel-shell.js';
import { bundleName } from '../../core/paths.js';
import { el } from '../../core/dom.js';

const CATEGORY = [
  { key: 'monster', label: 'モンスター' },
  { key: 'boss', label: 'ボス・敵キャラ' },
  { key: 'weapon', label: '武器' },
  { key: 'ally', label: '未分類' },
  { key: 'misc', label: '演出・その他' },
];

export function createOtherPanel(deps) {
  const { getById, collectionRepository, fileStore, escapeHtml, navTo, spinnerHtml, toast } = deps;
  let _model3d = null;
  const _glRebuildOk = glManager.makeRebuildLimiter(8000, 2);
  let _headers = {};
  let _listSig = '';
  let _ordered = [];
  let _have = new Set();
  const _mouthCache = new Map();
  function scrollToSection(name) {
    const h = _headers && _headers[name];
    if (h && h.scrollIntoView) setTimeout(() => h.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }

  async function renderList(grid) {
    let list = [];
    try {
      list = await collectionRepository.otherList();
    } catch (e) {}
    let status = null;
    try {
      status = await collectionRepository.other3dStatus(list);
    } catch (e) {}
    _have = (status && status.have) || new Set();
    const sig = list.length + ':' + (status ? status.ready + '/' + status.total : '') + ':' + list.map((e) => e.id).join(',');
    if (_listSig === sig && grid.querySelector('.otherlayout')) return;
    _listSig = sig;
    _model3d = model3dRenderer.disposeModel3d(_model3d);
    grid.innerHTML = '';
    if (!list.length) {
      grid.appendChild(el('div', 'emptyrow', 'その他の3Dデータがありません。「ゲームと接続」してからやり直してください。'));
      return;
    }
    const byCat = {};
    for (const c of CATEGORY) byCat[c.key] = [];
    for (const e of list) (byCat[e.category] || byCat.misc).push(e);
    const present = CATEGORY.filter((c) => byCat[c.key].length);
    getById('rostercount').textContent = `その他3D ${list.length}体（${present.map((c) => `${c.label}${byCat[c.key].length}`).join(' / ')}）`;

    if (status && status.missing.length) grid.appendChild(dlBar(status));

    const { listCol } = splitLayout(grid, 'otherView', 'カードを選ぶとここに3D表示');

    const goto = (key) => () => {
      if (typeof navTo === 'function') navTo('other', key);
    };
    listCol.appendChild(el('div', 'homenav', present.map((c) => el('button', { class: 'homenavlink', text: `${c.label} ${byCat[c.key].length}`, on: { click: goto(c.key) } }))));

    _headers = {};
    _ordered = present.flatMap((c) => byCat[c.key]);
    for (const c of present) {
      const arr = byCat[c.key];
      const h = el('div', {
        class: 'rgroup',
        text: `${c.label}（${arr.length}）`,
        title: 'このセクションへ移動（リンク）',
        style: { cursor: 'pointer' },
        on: { click: goto(c.key) },
      });
      _headers[c.key] = h;
      listCol.appendChild(h);
      listCol.appendChild(el('div', 'rostercards', arr.map(card)));
    }
  }

  function dlBar(status) {
    return downloadBar({
      text: `3Dデータ未取得 ${status.missing.length}件（表示できるのは ${status.ready}/${status.models}体）`,
      label: 'その他3Dをダウンロード',
      run: async (onProgress) => {
        try {
          const r = await assetAcquirer.runOther3dDownload(onProgress);
          toast(`その他3Dを取得しました（新規${r.got}件・失敗${r.fail}件／全${r.total}件）`, r.fail ? 'err' : 'ok');
          _listSig = '';
          const grid = getById('rosterGrid');
          if (grid) await renderList(grid);
        } catch (e) {
          onProgress(errText(e));
        }
      },
    });
  }

  const card = (e) =>
    entryCard({
      name: e.name || '#' + e.id,
      note: e.name ? '#' + e.id : e.variation,
      ready: collectionRepository.other3dReady(e, _have),
      onClick: () => openModel(e),
    });

  async function openModel(e) {
    const host = getById('otherView');
    if (!host) return;
    host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (!collectionRepository.other3dReady(e, _have)) {
      host.innerHTML = '<div class="note" style="padding:8px">この3Dデータはまだダウンロードされていません。上の「その他3Dをダウンロード」から取得してください。</div>';
      return;
    }
    host.innerHTML = spinnerHtml('3Dを読み込み中…');
    try {
      _model3d = model3dRenderer.disposeModel3d(_model3d);
      const matRel = e.material;
      const model = await charAssets.loadModelBundle(grab, e.model, e.meshDeps);
      if (!model) {
        host.innerHTML = '<div class="note" style="padding:8px">3Dモデルのデータを読み込めませんでした。「その他3Dをダウンロード」でやり直してください。</div>';
        return;
      }
      let matBundle = await charAssets.loadMaterialBundle(grab, matRel);
      const weapons = await charAssets.buildWeapons(grab, e.weapons);
      const mouthAtlas = e.mouth ? await grabMouth(e.mouth) : null;
      host.innerHTML = '';
      const catLabel = (CATEGORY.find((c) => c.key === e.category) || {}).label || '';
      host.appendChild(viewHeader(`${e.name || '#' + e.id}　#${e.id}　[${catLabel}]`, _ordered, e, openModel));
      const variants = (e.materials || []).filter((rel) => _have.has(assetStore.idOf(rel)));
      if (variants.length > 1) {
        const sel = el(
          'select',
          {
            class: 'rgsel',
            on: {
              change: async () => {
                matBundle = await charAssets.loadMaterialBundle(grab, sel.value);
                paint();
              },
            },
          },
          variants.map((rel) => el('option', { value: rel, text: bundleName(rel) })),
        );
        if (matRel) sel.value = matRel;
        host.appendChild(el('div', 'enemyvarrow', [el('span', 'note dim', `見た目（${variants.length}種）`), sel]));
      }
      const canvasHost = el('div');
      host.appendChild(canvasHost);
      const paint = () => {
        _model3d = model3dRenderer.disposeModel3d(_model3d);
        const opts = charAssets.build3dOptions({ mouthAtlas, weapons }, e, { height: 440 });
        opts.onContextLost = () => (_glRebuildOk() ? (paint(), true) : false);
        const r = model3dRenderer.render(canvasHost, model, matBundle, opts);
        _model3d = r && r.dispose ? r : null;
        if (r && r.ok === false) {
          const reason = r.reason === 'no-meshes' || r.reason === 'no-renderable-unityMesh' ? `このモデル(#${e.id})は表示できる形状データを持っていません。` : '3Dを表示できませんでした。';
          noteRow(canvasHost, '⚠ ' + reason);
        }
      };
      paint();
    } catch (er) {
      host.innerHTML = '<div class="note" style="padding:8px">3D表示失敗: ' + escapeHtml(er && er.message ? er.message : String(er)) + '</div>';
    }
  }

  async function grab(rel) {
    if (!rel || !fileStore) return null;
    return assetStore.readAsset(DIRS.other, rel, PLACE.flat);
  }

  async function grabMouth(rel) {
    if (!rel) return null;
    if (_mouthCache.has(rel)) return _mouthCache.get(rel);
    let atlas = null;
    try {
      const b = await grab(rel);
      if (b) atlas = MESH_MOD.parseMouthAtlas(b);
    } catch (e) {}
    _mouthCache.set(rel, atlas);
    return atlas;
  }

  function reset() {
    clearView('otherView', 'カードを選ぶとここに3D表示');
    _model3d = model3dRenderer.disposeModel3d(_model3d);
    _listSig = '';
  }

  return { renderList, reset, scrollToSection };
}
