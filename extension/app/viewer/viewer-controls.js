import { el } from '../../core/dom.js';
import { buildGroupedVisPanel } from '../../core/vis-panel.js';

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
  for (const [v, t, off] of options) {
    const o = el('option', { value: String(v), text: String(t) });
    if (off) {
      o.disabled = true;
      o.title = 'このキャラはこのモーションを持っていません';
    }
    sel.appendChild(o);
  }
  sel.value = String(value == null ? '' : value);
  sel.addEventListener('change', () => onChange(sel.value));
  return { row: el('label', 'vw-ctl', [el('span', 'vw-ctl-lbl', label), sel]), sel };
}

function slider(label, min, max, step, value, onInput) {
  const input = el('input', { class: 'vw-range', type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  input.addEventListener('input', () => onInput(Number(input.value)));
  return { row: el('label', 'vw-ctl', [el('span', 'vw-ctl-lbl', label), input]), input };
}

export function createControls(hostEl, deps) {
  const { state, stage, nameOf } = deps;
  const ranges = new Map();
  const picks = new Map();
  let openVis = null;
  const visPanel = el('div', 'spine-vispanel vw-vispanel');
  const visHost = el('div', { class: 'vw-vishost', style: { display: 'none' } }, [visPanel]);
  const closeVis = () => {
    if (!openVis) return;
    visHost.style.display = 'none';
    visPanel.textContent = '';
    openVis.btn.classList.add('active');
    openVis = null;
  };

  function card(c) {
    const st = stage();
    const ui = (st && st.controlsFor && st.controlsFor(c.id)) || { motions: [], selects: [], sliders: [] };
    const box = el('div', 'vw-card');
    const off = el('button', { class: 'vw-off', text: '✕', title: 'このキャラをフィールドから外します' });
    const head = [el('span', 'vw-cardname', nameOf(c.id))];
    if (ui.control) {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = !!c.control;
      cb.addEventListener('change', () => {
        if (cb.checked) for (const o of state.scene.chars) if (String(o.id) !== String(c.id) && o.control) state.update(o.id, { control: false });
        state.update(c.id, { control: cb.checked });
        if (st && st.syncChar) st.syncChar(c.id);
        rebuild();
      });
      head.push(el('label', { class: 'vw-radio vw-ctlbox', title: '画面右上の操作説明を参照。ONにできるのは1人まで。' }, [cb, el('span', '', 'コントロール')]));
    }
    head.push(off);
    box.appendChild(el('div', 'vw-cardhd', head));
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
    const sels = new Map();
    if (ui.motions.length) {
      const r = selectRow(ui.motionLabel || 'モーション', ui.motions, c.motion || ui.motions[0][0], (v) => apply({ motion: v }));
      sels.set('motion', r.sel);
      motion.appendChild(r.row);
    }
    motion.appendChild(selectRow('速度', SPEEDS, c.speed, (v) => apply({ speed: Number(v) })).row);
    motion.appendChild(pause);
    body.appendChild(motion);

    const row = el('div', 'vw-row');
    for (const s of ui.selects) {
      const options = s.keep ? [KEEP, ...s.options] : s.options;
      const cur = c[s.key] == null ? '' : c[s.key];
      const r = selectRow(
        s.label,
        options,
        cur || (s.keep ? '' : options[0][0]),
        (v) => apply({ [s.key]: v === '' ? null : s.cast === 'number' ? Number(v) : v }),
        s.keep ? '「-」はモーション側の指定に任せます' : '',
      );
      sels.set(s.key, r.sel);
      row.appendChild(r.row);
    }
    const resettable = ui.selects.filter((s) => s.keep);
    if (resettable.length) {
      const paint = (patch) => {
        apply(patch);
        for (const s of resettable) {
          const sel = sels.get(s.key);
          if (sel) sel.value = patch[s.key] == null ? '' : String(patch[s.key]);
        }
      };
      const shuffle = el('button', { class: 'vw-step btn xs', text: '🎲', title: 'ランダム表情' });
      shuffle.addEventListener('click', () => {
        const patch = {};
        for (const s of resettable) {
          const v = s.options[Math.floor(Math.random() * s.options.length)][0];
          patch[s.key] = s.cast === 'number' ? Number(v) : v;
        }
        paint(patch);
      });
      const reset = el('button', { class: 'vw-step btn xs', text: '⟲', title: '目・眉・口をすべて未選択に戻します' });
      reset.addEventListener('click', () => {
        const patch = {};
        for (const s of resettable) patch[s.key] = null;
        paint(patch);
      });
      row.appendChild(shuffle);
      row.appendChild(reset);
    }
    if (row.childNodes.length) body.appendChild(row);

    const pos = el('div', 'vw-grid');
    const inputs = new Map();
    for (const [key, label, min, max, step] of ui.sliders) {
      const s = slider(label, min, max, step, c[key], (v) => apply({ [key]: v }));
      inputs.set(key, s.input);
      pos.appendChild(s.row);
    }
    if (ui.vis && st && st.visInfo) {
      const btn = el('button', { class: 'btn xs vw-visbtn active', text: '表示制御', title: '部品ごとに 表示／半透明／非表示 を切り替えます' });
      btn.addEventListener('click', () => {
        const mine = openVis && openVis.id === String(c.id);
        closeVis();
        if (mine) return;
        const info = st.visInfo(c.id);
        visPanel.textContent = '';
        if (!info) visPanel.appendChild(el('div', 'note dim', '（読み込み中… もう一度開いてください）'));
        else buildGroupedVisPanel(visPanel, { title: nameOf(c.id) + ' の表示制御', groups: info.groups, alphaOf: info.alphaOf, onSet: info.set, onResetAll: info.resetAll });
        visHost.style.display = '';
        btn.classList.remove('active');
        openVis = { id: String(c.id), btn };
      });
      pos.appendChild(btn);
    }
    ranges.set(String(c.id), inputs);
    picks.set(String(c.id), sels);
    if (pos.childNodes.length) body.appendChild(pos);

    off.addEventListener('click', () => {
      state.remove(c.id);
      if (st && st.removeChar) st.removeChar(c.id);
      rebuild();
      if (deps.onRemove) deps.onRemove(c.id);
    });
    return box;
  }

  function rebuild() {
    openVis = null;
    visHost.style.display = 'none';
    visPanel.textContent = '';
    hostEl.textContent = '';
    ranges.clear();
    picks.clear();
    const list = state.scene.chars;
    if (!list.length) {
      hostEl.appendChild(el('div', 'note dim', '左の一覧から選ぶと、ここに個別の操作が出ます。'));
      return;
    }
    for (const c of list) hostEl.appendChild(card(c));
    hostEl.appendChild(visHost);
  }

  function refresh(id) {
    const c = state.get(id);
    if (!c) return;
    const inputs = ranges.get(String(id));
    if (inputs) for (const [key, input] of inputs) if (c[key] != null) input.value = String(c[key]);
    const sels = picks.get(String(id));
    if (sels) for (const [key, sel] of sels) sel.value = c[key] == null ? '' : String(c[key]);
  }

  return { rebuild, refresh };
}
