import { getById, el } from '../../core/dom.js';
import { saveData } from '../../core/savedata.js';
import { errText } from '../../core/messages.js';
import { normalizeScene } from './viewer-state.js';

export function createSceneIo(deps) {
  const { state, apply, note } = deps;
  let sceneName = '';

  const setName = (n) => {
    sceneName = n || '';
    getById('vwSceneName').textContent = sceneName;
  };
  const closeModal = () => (getById('vwModal').style.display = 'none');

  function modal(title, body) {
    getById('vwModalTitle').textContent = title;
    const b = getById('vwModalBody');
    b.textContent = '';
    b.appendChild(body);
    getById('vwModal').style.display = '';
  }

  async function load(raw, name) {
    const sc = normalizeScene(raw, state.mode);
    if (sc.mode !== state.mode) {
      note(`この配置は ${sc.mode.toUpperCase()} 用です。タブを切り替えてから読み込んでください。`);
      return;
    }
    await apply(sc, raw);
    setName(name);
  }

  function onSave() {
    const input = el('input', { class: 'rgsel', type: 'text', value: sceneName || '', placeholder: '配置の名前' });
    const msg = el('div', 'note dim');
    const go = el('button', { class: 'btn xs primary', text: '保存' });
    go.addEventListener('click', async () => {
      const name = input.value.trim();
      if (!saveData.nameOk(name)) {
        msg.textContent = '名前に使えない文字があります（/ \\ : * ? " < > | と空白は不可）。';
        return;
      }
      const ok = await saveData.saveScene(`${state.mode}_${name}`, state.toJSON());
      msg.textContent = ok ? '保存しました。' : '保存できませんでした。フォルダの権限を確認してください。';
      if (!ok) return;
      setName(name);
      closeModal();
    });
    modal('配置を保存', el('div', 'vw-form', [input, go, msg]));
  }

  async function onLoad() {
    const all = await saveData.listScenes();
    const mine = all.filter((n) => n.startsWith(state.mode + '_'));
    const body = el('div', 'vw-form');
    if (!mine.length) body.appendChild(el('div', 'note dim', 'この表示モードで保存した配置がありません。'));
    for (const full of mine) {
      const name = full.slice(state.mode.length + 1);
      const row = el('div', 'vw-loadrow', [el('span', { text: name })]);
      const btn = el('button', { class: 'btn xs', text: '読み込む' });
      btn.addEventListener('click', async () => {
        const raw = await saveData.loadScene(full);
        if (!raw) return;
        await load(raw, name);
        closeModal();
      });
      const del = el('button', { class: 'btn xs', text: '削除' });
      del.addEventListener('click', async () => {
        await saveData.deleteScene(full);
        row.remove();
      });
      row.appendChild(btn);
      row.appendChild(del);
      body.appendChild(row);
    }
    modal('配置を読み込む', body);
  }

  function onExport() {
    const blob = new Blob([JSON.stringify(state.toJSON(), null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `viewer_${state.mode}_${sceneName || 'scene'}.json` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function onImport() {
    const inp = el('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0];
      inp.remove();
      if (!f) return;
      try {
        await load(JSON.parse(await f.text()), f.name.replace(/\.json$/i, ''));
      } catch (e) {
        note('JSONを読めませんでした。' + errText(e));
      }
    });
    document.body.appendChild(inp);
    inp.click();
  }

  return {
    bind() {
      getById('vwSave').addEventListener('click', onSave);
      getById('vwLoad').addEventListener('click', () => onLoad().catch((e) => note(errText(e))));
      getById('vwExport').addEventListener('click', onExport);
      getById('vwImport').addEventListener('click', onImport);
      getById('vwModalClose').addEventListener('click', closeModal);
    },
    reset: () => setName(''),
  };
}
