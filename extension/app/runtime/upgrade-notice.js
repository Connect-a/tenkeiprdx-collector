import { showNotice } from '../ui/notice-modal.js';

const KEY = 'noticedMajor';
const MAJOR = '2';
const TITLE = 'ver2.0 のお知らせ';
const LINES = [
  'ver2.0 になりました。画像の取り先が高画質な DMM GAME PLAYER 版に変わっています。',
  'また、欠けていた資産の追加や、Web版で配信エラーにより欠けていた音声が取得できます。',
  '保存の形式が変わったため、新しいフォルダを指定して再度ダウンロードしてください。',
  '1.x で取得したデータは 2.0 からは読めません。そのまま見たい場合は 1.x の拡張機能をお使いください。',
];

export function openUpgradeNotice() {
  return showNotice(LINES, { title: TITLE });
}

export async function showUpgradeNotice() {
  let major = '';
  try {
    major = String((chrome.runtime.getManifest().version || '').split('.')[0]);
  } catch (e) {
    return;
  }
  if (major !== MAJOR) return;
  let seen = '';
  try {
    seen = (await chrome.storage.local.get(KEY))[KEY] || '';
  } catch (e) {}
  if (seen === MAJOR) return;
  await showNotice(LINES, { blocking: true, title: TITLE });
  try {
    await chrome.storage.local.set({ [KEY]: MAJOR });
  } catch (e) {}
}
