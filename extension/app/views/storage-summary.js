import { getById, el } from '../../core/dom.js';
import { fileStore } from '../../core/fsdir.js';
import { errText } from '../../core/messages.js';

const fmt = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(1) + 'GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : n >= 1024 ? Math.round(n / 1024) + 'KB' : n + 'B');

let _folderText = null;

async function idbBytes() {
  try {
    return (await navigator.storage.estimate()).usage || 0;
  } catch (e) {
    return null;
  }
}

async function extBytes() {
  try {
    return await chrome.storage.local.getBytesInUse(null);
  } catch (e) {
    return null;
  }
}

function folderCell() {
  if (_folderText != null) return el('td', { class: 'tmpval', id: 'tmpFolderSize' }, _folderText);
  const btn = el('button', {
    class: 'btn xs',
    text: '計算',
    on: {
      click: async () => {
        btn.disabled = true;
        try {
          const root = await fileStore.load();
          if (!root || (await fileStore.permission({ request: false })) !== 'granted') {
            _folderText = '未選択';
          } else {
            btn.textContent = '計算中…';
            const r = await fileStore.totalSize(root, (a) => (btn.textContent = `${a.files}件…`));
            _folderText = `${fmt(r.bytes)} / ${r.files}件`;
          }
        } catch (e) {
          _folderText = errText(e);
        }
        const td = btn.parentElement;
        if (td) {
          td.id = 'tmpFolderSize';
          td.textContent = _folderText;
        }
      },
    },
  });
  return el('td', 'tmpval', btn);
}

export async function renderStorageSummary() {
  const host = getById('tmpDataTable');
  if (!host) return;
  const [idb, ext] = await Promise.all([idbBytes(), extBytes()]);
  const rows = [
    { label: 'IndexedDB', note: '索引キャッシュ・所持データ・保存先の権限', text: idb == null ? '不明' : fmt(idb) },
    { label: 'Extension Storage', note: 'トークン・一括DLの進捗・各種設定', text: ext == null ? '不明' : fmt(ext) },
    { label: '保存先フォルダ', note: 'ダウンロードした画像・音声・台本', folder: true },
  ];
  host.innerHTML = '';
  const body = el('tbody');
  for (const r of rows) {
    body.appendChild(el('tr', null, [el('td', null, [el('div', 'tmpname', r.label), el('div', 'tmpnote', r.note)]), r.folder ? folderCell() : el('td', 'tmpval', r.text)]));
  }
  host.appendChild(body);
}
