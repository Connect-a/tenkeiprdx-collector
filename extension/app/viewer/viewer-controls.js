import { el } from '../../core/dom.js';

const SPEEDS = [
  [0.25, '0.25x'],
  [0.5, '0.5x'],
  [1, '1x'],
  [1.5, '1.5x'],
  [2, '2x'],
];
const KEEP = ['', '-'];

function selectRow(label, options, value, onChange, title) {
  const sel = el('select', { class: 'rgsel', title: title || '' });
  for (const [v, t] of options) sel.appendChild(el('option', { value: String(v), text: String(t) }));
  sel.value = String(value == null ? '' : value);
  sel.addEventListener('change', () => onChange(sel.value));
  return el('label', 'vw-ctl', [el('span', 'vw-ctl-lbl', label), sel]);
}

function radioRow(label, name, options, value, onChange) {
  const group = el('span', 'vw-radios');
  for (const [v, t] of options) {
    const input = el('input', { type: 'radio', name, value: String(v) });
    input.checked = String(v) === String(value);
    input.addEventListener('change', () => {
      if (input.checked) onChange(String(v));
    });
    group.appendChild(el('label', 'vw-radio', [input, el('span', '', t)]));
  }
  return el('div', 'vw-ctl', [el('span', 'vw-ctl-lbl', label), group]);
}

function slider(label, min, max, step, value, onInput) {
  const input = el('input', { class: 'vw-range', type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  input.addEventListener('input', () => onInput(Number(input.value)));
  return { row: el('label', 'vw-ctl', [el('span', 'vw-ctl-lbl', label), input]), input };
}

export function createControls(hostEl, deps) {
  const { state, stage, nameOf } = deps;
  const ranges = new Map();

  function card(c) {
    const st = stage();
    const ui = (st && st.controlsFor && st.controlsFor(c.id)) || { motions: [], selects: [], sliders: [] };
    const box = el('div', 'vw-card');
    const off = el('button', { class: 'vw-off', text: '✕', title: 'このキャラをフィールドから外します' });
    box.appendChild(el('div', 'vw-cardhd', [el('span', 'vw-cardname', nameOf(c.id)), el('span', 'vw-cardid', '#' + c.id), off]));
    const body = el('div', 'vw-cardbody');
    box.appendChild(body);

    const apply = (patch) => {
      state.update(c.id, patch);
      if (st && st.syncChar) st.syncChar(c.id);
    };

    const pause = el('button', { class: 'vw-pause btn xs' + (c.paused ? ' rec' : ''), text: c.paused ? '▶' : '⏸', title: c.paused ? '再生' : '一時停止' });
    pause.addEventListener('click', () => {
      const next = !state.get(c.id).paused;
      apply({ paused: next });
      pause.textContent = next ? '▶' : '⏸';
      pause.title = next ? '再生' : '一時停止';
      pause.classList.toggle('rec', next);
    });

    const motion = el('div', 'vw-row');
    if (ui.motions.length) motion.appendChild(selectRow(ui.motionLabel || 'モーション', ui.motions, c.motion || ui.motions[0][0], (v) => apply({ motion: v })));
    motion.appendChild(selectRow('速度', SPEEDS, c.speed, (v) => apply({ speed: Number(v) })));
    motion.appendChild(pause);
    body.appendChild(motion);

    if (ui.shadow) body.appendChild(radioRow('影', 'vwshadow-' + c.id, ui.shadow, c.shadow, (v) => apply({ shadow: v })));

    const row = el('div', 'vw-row');
    for (const s of ui.selects) {
      const options = s.keep ? [KEEP, ...s.options] : s.options;
      const cur = c[s.key] == null ? '' : c[s.key];
      row.appendChild(
        selectRow(
          s.label,
          options,
          cur || (s.keep ? '' : options[0][0]),
          (v) => apply({ [s.key]: v === '' ? null : s.cast === 'number' ? Number(v) : v }),
          s.keep ? '「-」はモーション側の指定に任せます' : '',
        ),
      );
    }
    if (row.childNodes.length) body.appendChild(row);

    const pos = el('div', 'vw-grid');
    const inputs = new Map();
    for (const [key, label, min, max, step] of ui.sliders) {
      const s = slider(label, min, max, step, c[key], (v) => apply({ [key]: v }));
      inputs.set(key, s.input);
      pos.appendChild(s.row);
    }
    ranges.set(String(c.id), inputs);
    if (ui.sliders.length) body.appendChild(pos);

    off.addEventListener('click', () => {
      state.remove(c.id);
      if (st && st.removeChar) st.removeChar(c.id);
      rebuild();
      if (deps.onRemove) deps.onRemove(c.id);
    });
    return box;
  }

  function rebuild() {
    hostEl.textContent = '';
    ranges.clear();
    const list = state.scene.chars;
    if (!list.length) {
      hostEl.appendChild(el('div', 'note dim', '左の一覧から選ぶと、ここに個別の操作が出ます。'));
      return;
    }
    for (const c of list) hostEl.appendChild(card(c));
  }

  function refresh(id) {
    const inputs = ranges.get(String(id));
    const c = state.get(id);
    if (!inputs || !c) return;
    for (const [key, input] of inputs) if (c[key] != null) input.value = String(c[key]);
  }

  return { rebuild, refresh };
}
