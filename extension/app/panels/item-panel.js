import { assetStore } from '../../data/asset-store.js';
import { assetAcquirer } from '../../data/acquire/acquire-assemble.js';
import { unityMesh as MESH_MOD } from '../../unity/mesh.js';
import { DIRS } from '../../core/constants.js';
import { errText } from '../../core/messages.js';
import { createZoomOverlay } from '../ui/zoom-overlay.js';

import { hideRosterControls, groupHeading, downloadBar, errorRow } from '../ui/panel-shell.js';
import { el } from '../../core/dom.js';

export function createItemPanel(deps) {
  const { getById, collectionRepository, toast, nameFix, spinnerHtml } = deps;
  let _items = null;
  let _obs = null;
  let _src = new Map();

  async function readIcon(rel) {
    if (!rel) return null;
    try {
      const b = await assetStore.readAsset(DIRS.shared, rel);
      return b ? MESH_MOD.decodeTextureCanvas(b) : null;
    } catch (e) {
      return null;
    }
  }

  async function fillIcon(box) {
    if (!box.dataset.rel || box.dataset.done) return;
    box.dataset.done = '1';
    const cv = await readIcon(box.dataset.rel);
    if (!cv) return;
    cv.className = 'itemicon';
    box.innerHTML = '';
    box.appendChild(cv);
  }

  function observe(box) {
    if (!_obs) {
      _obs = new IntersectionObserver(
        (ents, o) => {
          for (const en of ents)
            if (en.isIntersecting) {
              o.unobserve(en.target);
              fillIcon(en.target);
            }
        },
        { rootMargin: '200px' },
      );
    }
    _obs.observe(box);
  }

  const zoom = createZoomOverlay({
    id: 'itemOverlay',
    title: (it) => nameFix(it.name) + (it.variant ? `（${it.variant}）` : ''),
    lines: (it) => [nameFix(it.desc), (it.variantChars || []).length > 1 ? '対象キャラ: ' + it.variantChars.join('、') : '', '#' + it.id].filter(Boolean),
    load: (it) => readIcon((_src.get(it) || {}).rel),
    emptyText: (it) => (it.rel ? 'アイコンは未取得です。' : 'このアイテムにはアイコン画像がありません。'),
  });

  const sharedDlBar = (needShared) =>
    downloadBar({
      text: `アイコン未取得 ${needShared}件（共有リソースのダウンロードで表示できるようになります）`,
      label: '共有リソースをダウンロード',
      run: async (onProgress) => {
        try {
          const r = await assetAcquirer.runSharedResourceDownload(onProgress);
          toast(`共有リソースを取得しました（新規${r.got}件・既にあった分${r.skip}件／全${r.total}件）`, 'ok');
          await render();
        } catch (e) {
          onProgress(errText(e));
        }
      },
    });

  async function collectSources(items) {
    const rels = items.map((it) => it.rel).filter(Boolean);
    const have = await assetStore.presentIds(DIRS.shared, rels);
    return (it) => (it.rel && have.has(assetStore.idOf(it.rel)) ? { rel: it.rel } : null);
  }

  async function render() {
    const grid = getById('rosterGrid');
    if (!grid) return;
    hideRosterControls();
    grid.innerHTML = spinnerHtml('アイテムを読み込み中…');
    try {
      _items = await collectionRepository.itemList();
    } catch (e) {
      grid.innerHTML = '';
      errorRow(grid, 'アイテムを読み込めませんでした。' + errText(e));
      return;
    }
    const srcOf = await collectSources(_items);
    const src = new Map(_items.map((it) => [it, srcOf(it)]));
    _src = src;
    const n = _items.length;
    const shown = _items.filter((it) => src.get(it)).length;
    const noIcon = _items.filter((it) => !it.rel).length;
    const needShared = _items.filter((it) => it.rel && !src.get(it)).length;
    getById('rostercount').textContent = `${shown} / ${n}`;

    grid.innerHTML = '';
    if (needShared) grid.appendChild(sharedDlBar(needShared));

    const indexOf = new Map(_items.map((it, i) => [it, i]));
    const groups = collectionRepository.itemGroups(_items);
    const headers = new Map();
    const jump = (key) => {
      const h = headers.get(key);
      if (h && h.scrollIntoView) h.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    grid.appendChild(
      el(
        'div',
        'homenav',
        groups.map((g) => el('button', { class: 'homenavlink', text: `${g.label} ${g.items.length}`, on: { click: () => jump(g.key) } })),
      ),
    );
    for (const g of groups) {
      headers.set(g.key, groupHeading(grid, `${g.label}（${g.items.length}）`));
      const wrap = el('div', 'itemgrid');
      grid.appendChild(wrap);
      for (const it of g.items) {
        const s = src.get(it);
        const icon = el('div', { class: 'itemiconbox', data: s ? { rel: s.rel } : null });
        if (s) observe(icon);
        wrap.appendChild(
          el('div', { class: 'itemcard' + (s ? '' : ' un'), on: { click: () => zoom.open(_items, indexOf.get(it)) } }, [
            icon,
            el('div', 'itembody', [
              el('div', 'itemname', nameFix(it.name)),
              it.variant ? el('div', 'itemvariant', it.variant) : null,
              el('div', 'itemdesc', nameFix(it.desc)),
              el('div', 'itemid', '#' + it.id),
            ]),
          ]),
        );
      }
    }
  }

  return { render };
}
