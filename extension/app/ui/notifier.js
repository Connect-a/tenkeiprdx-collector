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
