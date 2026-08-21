import { assetStore } from '../../data/asset-store.js';
import { fileStore } from '../../core/fsdir.js';
import { DIRS } from '../../core/constants.js';
import { assetAcquirer } from '../../data/acquire/acquire-assemble.js';
import { unityMesh as MESH_MOD } from '../../unity/mesh.js';
import { spineWeb } from '../../engine/story/spine-web.js';
import { errText } from '../../core/messages.js';
import { hideRosterControls, splitLayout, clearView, entryCard, viewHeader, groupHeading, downloadBar, errorRow } from '../ui/panel-shell.js';
import { bundleName } from '../../core/paths.js';
import { el } from '../../core/dom.js';

const SECTIONS = [
  ['動画', (e) => !!e.file],
  ['ストーリーキャラ', (e) => !e.file && e.source !== 'ui' && e.source !== 'mission'],
  ['アイコン', (e) => !e.file && e.source === 'ui'],
  ['パネルミッション', (e) => e.source === 'mission'],
];

export function createOther2dPanel(deps) {
  const { getById, collectionRepository, toast, nameFix, spinnerHtml, visualRenderer } = deps;
  let _list = null;
  let _ordered = [];
  let _have = new Set();
  let _players = [];
  const _videoUrls = [];

  function disposePlayers() {
    for (const p of _players) {
      try {
        p && p.dispose && p.dispose();
      } catch (e) {}
    }
    _players = [];
  }

  let _haveFiles = new Set();
  const ready = (e) => (e.file ? _haveFiles.has(e.file) : e.ids.some((s) => _have.has(s)));
  const readBundle = (rel) => assetStore.readAsset(DIRS.shared, rel);

  function dlBar(missing, count) {
    return downloadBar({
      label: `その他2D DL（${count}）`,
      run: async (onProgress) => {
        try {
          const r = await assetAcquirer.runOther2dDownload(missing, onProgress);
          toast(`その他2Dを取得しました（新規${r.got}件・既にあった分${r.skip}件${r.failed ? `・失敗${r.failed}件` : ''}）`, r.failed ? 'err' : 'ok');
          await render();
        } catch (er) {
          onProgress(errText(er));
        }
      },
    });
  }

  async function paintSpine(grid, id) {
    const cell = el('div', 'spine-cell', el('div', 'spine-cell-cap', bundleName(id)));
    grid.appendChild(cell);
    const fail = (msg) => cell.appendChild(el('div', 'note', msg));
    if (!_have.has(id)) return fail('未取得');
    let inputs = null;
    try {
      const bytes = await readBundle(id);
      if (bytes) inputs = MESH_MOD.extractSpineInputs(bytes);
    } catch (er) {}
    if (!inputs) return fail('立ち絵を取り出せませんでした');
    const box = el('div', 'spine-player-box');
    cell.appendChild(box);
    try {
      const { player } = spineWeb.buildPlayable(box, inputs, {
        showControls: true,
        backgroundColor: '#00000000',
        onError: (msg) => fail('Spine失敗: ' + msg),
        onReady: (pl) => spineWeb.startDefaultIdle(pl),
      });
      if (player) _players.push(player);
    } catch (er) {
      fail('Spine失敗: ' + errText(er));
    }
  }

  async function paintIcons(host, ids) {
    const row = el('div', 'monstericons');
    host.appendChild(row);
    for (const id of ids) {
      if (!_have.has(id)) continue;
      let canvases = [];
      try {
        const bytes = await readBundle(id);
        if (bytes) canvases = MESH_MOD.decodeAllTextureCanvases(bytes);
      } catch (er) {}
      for (const cv of canvases) {
        cv.className = 'monstericon';
        row.appendChild(cv);
      }
    }
    if (!row.childNodes.length) row.remove();
  }

  async function paintVideo(host, e) {
    const f = await fileStore.readUnder(await fileStore.getDir(DIRS.shared, { create: false }), e.file);
    if (!f) {
      host.appendChild(el('div', 'note', '未取得'));
      return;
    }
    const url = URL.createObjectURL(f);
    _videoUrls.push(url);
    const v = el('video', { class: 'statvideo', src: url, controls: true, loop: true, playsInline: true, autoplay: true });
    host.appendChild(v);
    try {
      await v.play();
    } catch (e) {
      v.muted = true;
      v.play().catch(() => {});
    }
  }

  async function openEntry(e) {
    const host = getById('other2dView');
    if (!host) return;
    disposePlayers();
    host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    host.innerHTML = spinnerHtml('立ち絵を読み込み中…');
    const rt = await visualRenderer.prepareSpineRuntime(host);
    if (!rt || !rt.ok) {
      host.innerHTML = '<div class="note" style="padding:8px">Spineランタイムを初期化できませんでした。</div>';
      return;
    }
    host.innerHTML = '';
    host.appendChild(viewHeader(`#${e.id}${e.name ? '　' + nameFix(e.name) : ''}`, _ordered, e, openEntry));
    if (e.file) return paintVideo(host, e);
    await paintIcons(host, e.iconIds || []);
    const grid = el('div', 'spine-grid stand one');
    host.appendChild(grid);
    if (!(e.spineIds || []).length) grid.appendChild(el('div', 'note', 'この項目に立ち絵はありません（アイコンのみ）。'));
    for (const id of e.spineIds || []) await paintSpine(grid, id);
  }

  const card = (e) => entryCard({ name: e.name ? nameFix(e.name) : '#' + e.id, note: e.name ? '#' + e.id : '', ready: ready(e), onClick: () => openEntry(e) });

  async function render() {
    const grid = getById('rosterGrid');
    if (!grid) return;
    hideRosterControls();
    disposePlayers();
    grid.innerHTML = spinnerHtml('その他2Dを読み込み中…');
    let st = null;
    try {
      st = await collectionRepository.other2dStatus();
    } catch (er) {
      grid.innerHTML = '';
      errorRow(grid, 'その他2Dを読み込めませんでした。' + errText(er));
      return;
    }
    _list = st.list;
    _have = st.have;
    _haveFiles = st.haveFiles || new Set();
    getById('rostercount').textContent = `${st.ready} / ${_list.length}`;

    grid.innerHTML = '';
    const missing = _list.filter((e) => !ready(e)).flatMap((e) => e.refs.filter((r) => !_have.has(r.id)));
    const missingFiles = _list.filter((e) => e.file && !_haveFiles.has(e.file)).length;
    if (missing.length || missingFiles) grid.appendChild(dlBar(missing, missing.length + missingFiles));
    const { listCol } = splitLayout(grid, 'other2dView', 'カードを選ぶとここに立ち絵表示');
    _ordered = SECTIONS.flatMap(([, pick]) => _list.filter(pick));
    for (const [title, pick] of SECTIONS) {
      const items = _list.filter(pick);
      if (!items.length) continue;
      groupHeading(listCol, `${title}（${items.length}）`);
      listCol.appendChild(el('div', 'rostercards', items.map(card)));
    }
  }

  function reset() {
    disposePlayers();
    clearView('other2dView', 'カードを選ぶとここに立ち絵表示');
  }

  return { render, reset };
}
