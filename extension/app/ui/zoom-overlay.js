import { el, append } from '../../core/dom.js';

export function createZoomOverlay({ id, title, lines, load, emptyText }) {
  let items = [];
  let index = -1;
  let gen = 0;
  let shell = null;

  function close() {
    if (shell) shell.root.style.display = 'none';
    index = -1;
    document.removeEventListener('keydown', onKey);
  }

  function onKey(ev) {
    if (ev.key === 'Escape') return close();
    if (ev.key === 'ArrowLeft') step(-1);
    else if (ev.key === 'ArrowRight') step(1);
    else return;
    ev.preventDefault();
  }

  function step(d) {
    if (index < 0) return;
    const i = index + d;
    if (i >= 0 && i < items.length) open(items, i);
  }

  function build() {
    if (shell) return shell;
    const name = el('span');
    const pic = el('div', 'itemzoombox');
    const text = el('div', 'itemzoomtext');
    const prev = el('button', { class: 'btn xs', text: '◀', title: '前 (←)', on: { click: () => step(-1) } });
    const next = el('button', { class: 'btn xs', text: '▶', title: '次 (→)', on: { click: () => step(1) } });
    const root = el('div', { class: 'modalback', id }, [
      el('div', 'modal itemmodal', [
        el('div', 'modalhd', [name, el('button', { class: 'btn xs', text: '閉じる', on: { click: close } })]),
        el('div', 'modalbody itemzoombody', [pic, el('div', 'itemzoomnav', [prev, text, next])]),
      ]),
    ]);
    root.addEventListener('click', (ev) => {
      if (ev.target === root) close();
    });
    document.body.appendChild(root);
    shell = { root, name, pic, text, prev, next };
    return shell;
  }

  async function open(list, i) {
    items = list || [];
    const item = items[i];
    if (!item) return;
    const s = build();
    index = i;
    const mine = ++gen;
    s.name.textContent = title ? title(item) : '';
    s.text.innerHTML = '';
    append(
      s.text,
      (lines ? lines(item) : []).map((line, n) => el('div', n === 0 ? 'itemdesc' : 'itemid', line)),
    );
    s.prev.disabled = i <= 0;
    s.next.disabled = i >= items.length - 1;
    s.pic.innerHTML = '';
    s.root.style.display = '';
    document.removeEventListener('keydown', onKey);
    document.addEventListener('keydown', onKey);
    let canvas = null;
    try {
      canvas = await load(item);
    } catch (e) {}
    if (mine !== gen) return;
    s.pic.innerHTML = '';
    if (canvas) {
      canvas.className = 'itemzoom';
      s.pic.appendChild(canvas);
    } else s.pic.appendChild(el('div', 'note dim', emptyText ? emptyText(item) : '表示できませんでした。'));
  }

  return { open, close };
}
