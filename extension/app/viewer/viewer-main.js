import { getById, el } from '../../core/dom.js';
import { fileStore } from '../../core/fsdir.js';
import { saveData } from '../../core/savedata.js';
import { listEntries, ensureKinds, entryOf } from './viewer-source.js';
import { errText } from '../../core/messages.js';
import { createViewerState } from './viewer-state.js';
import { createPicker } from './viewer-picker.js';
import { createFieldList } from './viewer-field.js';
import { createControls } from './viewer-controls.js';
import { createSceneIo } from './viewer-scenes.js';

const state = createViewerState('3d');
let picker = null;
let controls = null;
let stage = null;
let scenes = null;
let fields = [];

const setNote = (t) => {
  const n = getById('vwFieldNote');
  if (n) n.textContent = t || '';
};

let busyN = 0;
function setBusy(on, text) {
  busyN = Math.max(0, busyN + (on ? 1 : -1));
  if (on && text) getById('vwBusyText').textContent = text;
  getById('vwBusy').style.display = busyN ? '' : 'none';
}

async function busy(text, fn) {
  setBusy(true, text);
  try {
    return await fn();
  } finally {
    setBusy(false);
  }
}

async function loadStage(mode) {
  if (stage) {
    try {
      stage.dispose();
    } catch (e) {}
    stage = null;
  }
  const host = getById('vwStage');
  host.textContent = '';
  const mod = mode === '2d' ? await import('./viewer-stage2d.js') : await import('./viewer-stage3d.js');
  stage = mod.createStage(host, { state, entryOf, onNote: setNote, onBusy: setBusy, onGizmo: (id) => controls.refresh(id), onDrive: (id) => controls.refresh(id) });
  await stage.init();
  await stage.syncAll();
}

async function switchMode(mode) {
  if (state.mode === mode && stage) return;
  state.load({ ...state.scene, mode, chars: [] });
  document.querySelectorAll('.vw-tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));
  scenes.reset();
  await loadKind(picker.kind());
  await busy('表示を切り替え中…', async () => {
    await refreshFields();
    await loadStage(mode);
  });
  picker.refreshMarks();
  controls.rebuild();
}

async function refreshFields() {
  fields = await createFieldList(state.mode);
  const sel = getById('vwField');
  sel.textContent = '';
  const groups = new Map();
  for (const f of fields) {
    let host = sel;
    if (f.group) {
      let og = groups.get(f.group);
      if (!og) {
        og = el('optgroup', { label: f.group });
        groups.set(f.group, og);
        sel.appendChild(og);
      }
      host = og;
    }
    host.appendChild(el('option', { value: f.key, text: f.label }));
  }
  const want = state.scene.field;
  const cur = fields.find((f) => f.kind === want.kind && f.rel === want.rel);
  sel.value = cur ? cur.key : fields[0] ? fields[0].key : '';
  getById('vwFieldLabel').textContent = state.mode === '2d' ? '背景' : 'フィールド';
  applyField(sel.value, true);
}

function applyField(key, quiet) {
  const f = fields.find((x) => x.key === key) || fields[0];
  if (!f) return;
  state.setField(f.kind, f.rel);
  if (stage && !quiet) stage.syncField();
}

async function loadKind(kind) {
  try {
    picker.setItems(await busy('一覧を読み込み中…', () => listEntries(kind, state.mode)));
    setNote('');
  } catch (e) {
    setNote('一覧を読み込めませんでした。' + errText(e));
  }
}

async function connect() {
  const ok = await fileStore.load();
  const granted = ok && (await fileStore.permission({ mode: 'readwrite' })) === 'granted';
  getById('vwNeedFolder').style.display = granted ? 'none' : '';
  getById('vwMain').style.display = granted ? '' : 'none';
  if (!granted) return false;
  await loadKind(picker.kind());
  return true;
}

async function applyScene(sc, raw) {
  state.load(sc);
  if (stage && raw && raw.camera) stage.lockCamera();
  await busy('配置を読み込み中…', async () => {
    await ensureKinds(
      sc.chars.map((c) => c.kind),
      state.mode,
    );
    await refreshFields();
    if (stage) await stage.syncAll();
  });
  picker.refreshMarks();
  controls.rebuild();
}

const stamp = () => new Date().toLocaleString('sv-SE').replace(/[- :]/g, '').slice(2, 14);

async function saveShot() {
  if (!stage || !stage.snapshot) return;
  setNote('画像を保存しています…');
  const blob = await stage.snapshot();
  const path = blob ? await saveData.saveImage(`${state.mode}_${stamp()}`, blob) : '';
  setNote(path ? `保存しました： ${path}` : '画像を保存できませんでした。フォルダの権限を確認してください。');
}

function bind() {
  document.querySelectorAll('.vw-tab').forEach((t) => t.addEventListener('click', () => switchMode(t.dataset.mode).catch((e) => setNote(errText(e)))));
  getById('vwField').addEventListener('change', (e) => applyField(e.target.value));
  const stepField = (d) => {
    const sel = getById('vwField');
    const opts = [...sel.options];
    if (opts.length < 2) return;
    const i = opts.findIndex((o) => o.value === sel.value);
    const next = opts[(Math.max(0, i) + d + opts.length) % opts.length];
    sel.value = next.value;
    applyField(next.value);
  };
  getById('vwFieldPrev').addEventListener('click', () => stepField(-1));
  getById('vwFieldNext').addEventListener('click', () => stepField(1));
  getById('vwRecenter').addEventListener('click', () => stage && stage.resetCamera());
  getById('vwShot').addEventListener('click', () => saveShot().catch((e) => setNote('画像を保存できませんでした。' + errText(e))));
  getById('vwClear').addEventListener('click', () => {
    state.clear();
    picker.refreshMarks();
    if (stage) stage.syncAll();
    controls.rebuild();
  });
  getById('vwPickFolder').addEventListener('click', async () => {
    await fileStore.pick();
    await connect();
  });
  scenes.bind();
}

async function init() {
  picker = createPicker(getById('vwPicker'), {
    state,
    onPick: async (id) => {
      if (stage) await stage.addChar(id);
      controls.rebuild();
    },
    onKind: (kind) => loadKind(kind),
    onDrop: (id) => {
      if (stage) stage.removeChar(id);
      controls.rebuild();
    },
  });
  controls = createControls(getById('vwCtrls'), { state, stage: () => stage, nameOf: (id) => (entryOf(id) || {}).displayName || '#' + id });
  scenes = createSceneIo({ state, apply: applyScene, note: setNote });
  bind();
  if (!(await connect())) return;
  await busy('読み込み中…', async () => {
    await refreshFields();
    await loadStage(state.mode);
  });
  controls.rebuild();
}

init().catch((e) => setNote('起動に失敗しました。' + errText(e)));
