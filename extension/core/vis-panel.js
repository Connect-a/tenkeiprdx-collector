import { el, filterBox } from './dom.js';

export const VIS_STATES = [
  ['1', '表示'],
  ['0.5', '半透明'],
  ['0', '非表示'],
];

let _seq = 0;

export function visRadios(initial, onPick) {
  const name = 'pv' + _seq++;
  const w = el('span', 'stillradios');
  for (const [v, t] of VIS_STATES) {
    const input = el('input', { type: 'radio', name, value: v, checked: String(initial) === v });
    input.addEventListener('change', () => {
      if (input.checked) onPick(Number(v));
    });
    w.appendChild(el('label', 'stillradio', [input, el('span', { text: t })]));
  }
  return w;
}

export function setRadios(root, a) {
  root.querySelectorAll('.stillradios input[value="' + a + '"]').forEach((r) => (r.checked = true));
}

export function syncPartsBtn(wrap) {
  const parts = wrap.querySelector('.stillparts');
  const btn = wrap.querySelector('.stillgrp-row .btn');
  if (parts && btn) btn.classList.toggle('active', parts.style.display === 'none');
}

export function applyVisFilter(panel, q) {
  const on = !!q;
  panel.querySelectorAll('.stillgrp').forEach((wrap) => {
    const parts = wrap.querySelector('.stillparts');
    let any = false;
    wrap.querySelectorAll('.stillpart-row').forEach((row) => {
      const nm = (row.querySelector('.stillpart-lbl').textContent || '').toLowerCase();
      const m = !on || nm.includes(q);
      row.style.display = m ? '' : 'none';
      if (m && on) any = true;
    });
    if (parts) parts.style.display = on ? (any ? '' : 'none') : 'none';
    syncPartsBtn(wrap);
    wrap.style.display = on && !any ? 'none' : '';
  });
}

const CYCLE = [1, 0.5, 0];
const nextState = (cur) => CYCLE[(CYCLE.indexOf(cur == null ? 1 : cur) + 1) % CYCLE.length];
const flashRow = (row) => {
  row.classList.remove('rowflash');
  void row.offsetWidth;
  row.classList.add('rowflash');
};

export function buildGroupedVisPanel(panel, opt) {
  const { title, groups, alphaOf, onSet, onResetAll, extraHead } = opt;
  panel.innerHTML = '';
  const groupAlpha = new Map();
  const head = el('div', 'stillpanel-hd', [
    el('span', { text: title || '表示制御' }),
    el('button', {
      class: 'btn xs',
      text: '全表示',
      on: {
        click: () => {
          groupAlpha.clear();
          onResetAll();
          setRadios(panel, 1);
        },
      },
    }),
  ]);
  for (const n of extraHead || []) head.appendChild(n);
  panel.appendChild(head);
  panel.appendChild(filterBox({ placeholder: '部品名でフィルタ（入力すると部品を表示）…' }, (q) => applyVisFilter(panel, q)).wrap);
  for (const [g, names] of groups) {
    const wrap = el('div', 'stillgrp');
    const parts = el('div', { class: 'stillparts', style: { display: 'none' } });
    const setGroup = (a) => {
      groupAlpha.set(g, a);
      onSet(names, a);
      setRadios(parts, a);
    };
    const grad = visRadios(1, setGroup);
    const exp = el('button', { class: 'btn xs', text: '部品' });
    exp.addEventListener('click', () => {
      parts.style.display = parts.style.display === 'none' ? '' : 'none';
      syncPartsBtn(wrap);
    });
    const grow = el('div', 'stillgrp-row', [el('span', { class: 'stillgrp-lbl', text: g + '（' + names.length + '）' }), grad, exp]);
    grow.addEventListener('click', (e) => {
      if (e.target.closest('.stillradios') || e.target.closest('button')) return;
      const a = nextState(groupAlpha.get(g));
      setGroup(a);
      setRadios(grad, a);
      flashRow(grow);
    });
    wrap.appendChild(grow);
    for (const n of names) {
      const prad = visRadios(alphaOf ? alphaOf(n) : 1, (a) => onSet([n], a));
      const prow = el('div', 'stillpart-row', [el('span', { class: 'stillpart-lbl', text: n }), prad]);
      prow.addEventListener('click', (e) => {
        if (e.target.closest('.stillradios')) return;
        const a = nextState(alphaOf ? alphaOf(n) : 1);
        onSet([n], a);
        setRadios(prad, a);
        flashRow(prow);
      });
      parts.appendChild(prow);
    }
    wrap.appendChild(parts);
    syncPartsBtn(wrap);
    panel.appendChild(wrap);
  }
}
