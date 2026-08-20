import { el } from '../../core/dom.js';

export function showNotice(lines, { blocking, title } = {}) {
  return new Promise((resolve) => {
    const parts = [];
    if (title) parts.push(el('div', 'upmodal-hd', title));
    parts.push(
      el(
        'div',
        'upmodal-body',
        lines.map((t) => el('p', null, t)),
      ),
    );
    parts.push(el('div', 'upmodal-foot', [el('button', { class: 'btn', text: blocking ? 'OK' : '閉じる', on: { click: () => dlg.close() } })]));
    const dlg = el('dialog', 'upmodal', parts);
    if (blocking) dlg.addEventListener('cancel', (e) => e.preventDefault());
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve();
    });
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}
