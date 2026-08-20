import { fileStore } from '../../core/fsdir.js';
import { getById } from '../../core/dom.js';
import { playerState } from '../runtime/player-state.js';
import { toast } from '../ui/notifier.js';
import { refreshLists } from '../runtime/state-refresh.js';
import { renderStorageSummary } from './storage-summary.js';

export function updateFsUi() {
  const info = getById('fsInfo');
  const grant = getById('fsGrant');
  const pick = getById('fsPick');
  const dot = getById('fsDot');
  if (!fileStore || !fileStore.supported) {
    info.textContent = '非対応ブラウザ（Chrome/Edge推奨）';
    pick.style.display = 'none';
    grant.style.display = 'none';
    dot.className = 'fsdot';
    return;
  }
  const name = fileStore.dirName();
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
    toast(fsPickErr(e), 'err');
    return false;
  }
}

export const updateStorage = renderStorageSummary;
