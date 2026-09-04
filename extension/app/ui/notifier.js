import { getById, el } from '../../core/dom.js';

export function toast(msg, tone, opts) {
  opts = opts || {};
  let wrap = getById('toastwrap');
  if (!wrap) {
    wrap = el('div', { id: 'toastwrap', class: 'toastwrap' });
    document.body.appendChild(wrap);
  }
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  };
  const t = el('div', 'toast' + (tone ? ' ' + tone : ''), [el('span', 'toastmsg', msg), el('button', { class: 'toastx', text: '×', title: '閉じる', on: { click: close } })]);

  wrap.appendChild(t);
  while (wrap.children.length > 4) wrap.firstChild.remove();
  requestAnimationFrame(() => t.classList.add('show'));

  const sticky = opts.sticky || tone === 'err';
  if (!sticky) setTimeout(close, opts.dur || 4500);
  return { close, el: t };
}

const _flashTimers = new Map();

export function flashText(id, message, ms) {
  const node = getById(id);
  if (!node) return;
  clearTimeout(_flashTimers.get(id));
  node.textContent = message;
  _flashTimers.set(
    id,
    setTimeout(() => {
      const n = getById(id);
      if (n) n.textContent = '';
      _flashTimers.delete(id);
    }, ms || 1500),
  );
}
