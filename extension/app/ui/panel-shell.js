import { el, getById } from '../../core/dom.js';

const ROSTER_CONTROLS = ['rosterSearch', 'rosterOwn', 'rosterGroup', 'rosterRank', 'bulkOpen', 'sharedDl', 'rosterSortLbl', 'rosterSort', 'rosterSortDescLabel', 'exModeLabel', 'exFilterRow'];

export function hideRosterControls({ keepSearch } = {}) {
  for (const id of ROSTER_CONTROLS) {
    if (keepSearch && id === 'rosterSearch') continue;
    const node = getById(id);
    if (node) node.style.display = 'none';
  }
  const search = getById('rosterSearch');
  if (keepSearch && search) search.style.display = '';
}

export function splitLayout(grid, viewId, placeholder) {
  const listCol = el('div', 'othercol-list');
  const viewCol = el('div', { class: 'othercol-view', id: viewId, html: `<div class="otherview-empty">${placeholder}</div>` });
  grid.appendChild(el('div', 'otherlayout', [listCol, viewCol]));
  return { listCol, viewCol };
}

export function clearView(viewId, placeholder) {
  const host = getById(viewId);
  if (host) host.innerHTML = `<div class="otherview-empty">${placeholder}</div>`;
}

export function entryCard({ name, note, ready, onClick }) {
  return el('div', { class: 'rcard' + (ready ? '' : ' un'), on: { click: onClick } }, [el('span', `rdot ${ready ? 'own' : 'noown'}`), el('span', 'rnm', name), el('span', 'rlv', note || '')]);
}

export function viewHeader(text, list, cur, open) {
  const i = list ? list.indexOf(cur) : -1;
  const step = (d) => {
    const t = list[i + d];
    if (t) open(t);
  };
  const btn = (glyph, d) =>
    el('button', {
      class: 'btn xs headnav',
      text: glyph,
      disabled: i < 0 || !list[i + d],
      title: d < 0 ? '前へ' : '次へ',
      on: { click: () => step(d) },
    });
  return el('div', 'headrow', [btn('◀', -1), el('span', 'headname', text), btn('▶', 1)]);
}

export function groupHeading(parent, text) {
  const h = el('div', 'rgroup', text);
  parent.appendChild(h);
  return h;
}

export function downloadBar({ text, label, small, run }) {
  const note = el('span', 'note dim');
  const btn = el('button', {
    class: small ? 'btn xs' : 'btn sm primary',
    text: label,
    on: {
      click: async () => {
        btn.disabled = true;
        try {
          await run((m) => {
            note.textContent = m;
          });
        } finally {
          btn.disabled = false;
        }
      },
    },
  });
  return el('div', 'homebar', [text ? el('span', 'note', text) : null, btn, note]);
}

export function noteRow(parent, message) {
  const row = el('div', { class: 'note', style: { padding: '8px 0' }, text: message });
  parent.appendChild(row);
  return row;
}

export function errorRow(parent, message) {
  const row = el('div', 'note', message);
  parent.appendChild(row);
  return row;
}
