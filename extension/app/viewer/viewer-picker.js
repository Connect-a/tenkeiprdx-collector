import { el, filterBox } from '../../core/dom.js';
import { kanaKey } from '../ui/ui-format.js';
import { MAX_CHARS } from './viewer-state.js';

export function createPicker(hostEl, deps) {
  const { state, onPick, onDrop, onKind } = deps;
  let items = [];
  let kind = 'character';
  let query = '';
  const rows = new Map();

  const count = el('span', 'vw-pickcount');
  const kindBar = el('div', 'vw-kinds');
  const kindBtns = [
    ['character', 'キャラ'],
    ['monster', 'モンスター'],
    ['other3d', 'その他3D'],
    ['ex', 'EX'],
  ].map(([k, label]) => {
    const b = el('button', { class: 'vw-kind' + (k === kind ? ' active' : ''), text: label });
    b.addEventListener('click', () => {
      if (kind === k) return;
      kind = k;
      for (const x of kindBtns) x.classList.toggle('active', x === b);
      if (onKind) onKind(k);
    });
    b.dataset.kind = k;
    kindBar.appendChild(b);
    return b;
  });
  const fb = filterBox({ placeholder: 'キャラ名で絞り込み…' }, (q) => {
    query = q;
    paint();
  });
  const list = el('div', 'vw-picklist');
  hostEl.appendChild(el('div', 'vw-pickhead', [kindBar, count]));
  hostEl.appendChild(fb.wrap);
  hostEl.appendChild(list);

  const matches = (it) => !query || kanaKey(it.displayName).includes(kanaKey(query)) || String(it.id).includes(query);

  function syncRow(it, row) {
    const on = state.has(it.id);
    row.classList.toggle('on', on);
    row.classList.toggle('disabled', !on && state.full());
  }

  function paint() {
    list.textContent = '';
    rows.clear();
    const shown = items.filter(matches);
    let group = null;
    for (const it of shown) {
      if (it.group && it.group !== group) {
        group = it.group;
        list.appendChild(el('div', 'vw-pickgroup', group));
      }
      const cells = [el('span', 'vw-pickname', it.displayName)];
      if (it.kind !== 'ex') cells.push(el('span', 'vw-pickid', '#' + it.id));
      const row = el('div', { class: 'vw-pickrow', title: it.title || '' }, cells);
      row.addEventListener('click', () => toggle(it));
      rows.set(it.id, row);
      syncRow(it, row);
      list.appendChild(row);
    }
    if (!shown.length) list.appendChild(el('div', 'note dim', items.length ? '一致するものがありません。' : 'データがありません。フォルダを選び直してください。'));
    syncCount();
  }

  function syncCount() {
    count.textContent = `${state.ids().length} / ${MAX_CHARS}`;
    count.classList.toggle('full', state.full());
  }

  function toggle(it) {
    if (state.has(it.id)) {
      state.remove(it.id);
      if (onDrop) onDrop(it.id);
    } else {
      if (state.full()) return;
      if (state.add(it.id, it.kind) && onPick) onPick(it.id, it);
    }
    refreshMarks();
  }

  function refreshMarks() {
    for (const it of items) {
      const row = rows.get(it.id);
      if (row) syncRow(it, row);
    }
    syncCount();
  }

  return {
    setItems(list0) {
      items = (list0 || []).slice().sort((a, b) => (a.groupNo || 0) - (b.groupNo || 0) || (kanaKey(a.displayName) > kanaKey(b.displayName) ? 1 : -1));
      paint();
    },
    itemOf: (id) => items.find((x) => String(x.id) === String(id)) || null,
    kind: () => kind,
    setMode(mode) {
      const is2d = mode === '2d';
      const hidden = is2d ? 'other3d' : 'ex';
      for (const b of kindBtns) if (b.dataset.kind === 'ex' || b.dataset.kind === 'other3d') b.style.display = b.dataset.kind === hidden ? 'none' : '';
      if (kind === hidden) {
        kind = 'character';
        for (const x of kindBtns) x.classList.toggle('active', x.dataset.kind === kind);
      }
      return kind;
    },
    refreshMarks,
    focusSearch: () => fb.input.focus(),
  };
}
