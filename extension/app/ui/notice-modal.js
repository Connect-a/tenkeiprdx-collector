import { el } from '../../core/dom.js';

function para(text, cls) {
  const p = el('p', cls || null);
  String(text)
    .split(/\*\*(.+?)\*\*/g)
    .forEach((s, i) => {
      if (s) p.appendChild(i % 2 ? el('strong', null, s) : document.createTextNode(s));
    });
  return p;
}

export function showNotice(lines, { blocking, title, actions } = {}) {
  return new Promise((resolve) => {
    const parts = [];
    if (title) parts.push(el('div', 'upmodal-hd', title));
    parts.push(
      el(
        'div',
        'upmodal-body',
        lines.map((t) => (t && t.h ? el('div', 'upmodal-sec', t.h) : t && t.step ? para(t.step, 'upmodal-step') : para(t))),
      ),
    );
    const buttons = (actions || []).map((a) =>
      el('button', {
        class: 'btn',
        text: a.text,
        on: {
          click: () => {
            dlg.close();
            try {
              a.on();
            } catch (e) {}
          },
        },
      }),
    );
    buttons.push(el('button', { class: 'btn', text: blocking ? 'OK' : '閉じる', on: { click: () => dlg.close() } }));
    parts.push(el('div', 'upmodal-foot', buttons));
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
