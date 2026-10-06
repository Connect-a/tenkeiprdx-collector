import { fileStore } from '../../core/fsdir.js';
import { getById } from '../../core/dom.js';
import { playerState } from '../runtime/player-state.js';
import { toast } from '../ui/notifier.js';
import { showNotice } from '../ui/notice-modal.js';
import { refreshLists } from '../runtime/state-refresh.js';
import { renderStorageSummary } from './storage-summary.js';

const FS_FLAG_URL = 'brave://flags/#file-system-access-api';

function showFsHelp() {
  return showNotice(
    [
      '「保存先フォルダ」機能（File System Access API）がこのブラウザでは無効になっています。取得したデータを保存・再生するにはこの機能が必要です。',
      { h: 'Brave の場合' },
      { step: `アドレスバーに **${FS_FLAG_URL}** を貼り付けて開く` },
      { step: '表示された項目を **Enabled** に変更する' },
      { step: '右下の **Restart** でブラウザを再起動する' },
      { h: 'そのほかのブラウザ' },
      'Chrome / Edge は既定で利用できます。Firefox / Safari は非対応です。',
    ],
    {
      title: '保存先フォルダを有効にする',
      actions: [
        {
          text: 'URLをコピー',
          on: () =>
            navigator.clipboard.writeText(FS_FLAG_URL).then(
              () => toast('URLをコピーしました。Braveのアドレスバーに貼り付けてください', 'ok'),
              () => toast(`コピーできませんでした。手動で入力してください: ${FS_FLAG_URL}`, 'err'),
            ),
        },
      ],
    },
  );
}

export function updateFsUi() {
  const info = getById('fsInfo');
  const grant = getById('fsGrant');
  const pick = getById('fsPick');
  const dot = getById('fsDot');
  const name = fileStore && fileStore.supported ? fileStore.dirName() : '';
  if (name && playerState.fsGranted) {
    info.textContent = name;
    dot.className = 'fsdot ok';
    grant.style.display = 'none';
    pick.style.display = '';
    pick.textContent = '変更';
  } else if (name) {
    info.textContent = `${name}（要再許可）`;
    dot.className = 'fsdot';
    grant.style.display = '';
    pick.style.display = 'none';
  } else {
    info.textContent = '保存先フォルダ未選択';
    dot.className = 'fsdot';
    grant.style.display = 'none';
    pick.style.display = '';
    pick.textContent = '選ぶ';
  }
}

export function fsPickErr(e) {
  return e && e.fsUnsupported
    ? 'この環境では保存先フォルダを使えません（File System Access API が無効）。Chrome / Edge を使うか、Brave の場合は brave://flags/#file-system-access-api を Enabled にして再起動してください。'
    : '保存先フォルダを選べませんでした: ' + (e && e.message ? e.message : e);
}

export async function pickFolder() {
  try {
    if (await fileStore.pick()) {
      playerState.fsGranted = (await fileStore.permission({ request: false })) === 'granted';
      await refreshLists();
    }
    return true;
  } catch (e) {
    if (e && e.fsUnsupported) {
      showFsHelp();
      return false;
    }
    toast(fsPickErr(e), 'err');
    return false;
  }
}

export const updateStorage = renderStorageSummary;
