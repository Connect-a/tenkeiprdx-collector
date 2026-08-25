import { showNotice } from '../ui/notice-modal.js';

const KEY = 'noticedRelease';
const OLD_KEY = 'noticedMajor';
const RELEASE = '2.2';
const MAJOR = RELEASE.split('.')[0];
const TITLE = '更新のお知らせ';
const LINES = [
  { h: 'ver2.2.0' },
  'スキルのエフェクトが再生できるようになりました。キャラ固有のエフェクトは「一括ダウンロード（キャラ）」で、複数のキャラが使う共通エフェクトは「共有リソースDL」で取得します。どちらも差分取得なので、両方を実行してください。',
  'サービス終了前に、ゲーム接続と、サイドバーからのダウンロードのし直しをして、欠落が無いかの最終チェックをしてください。',
  { h: '【情報提供のお願い】' },
  '「360度OK! 3Dキャラフェスティバル！」の第4話・第5話・第6話・第7話・第12話について、台本データの紐づけルールがわかっていません。',
  '全年齢版、R18版の両方から以下の情報を取得し、おてがみで送っていただけると大変助かります。',
  { step: '1. ブラウザで F12 を開き、Network タブを表示' },
  { step: '2. ゲームで該当の話を再生' },
  { step: '3. getDetails のリクエストを右クリック →「Copy as fetch」' },
  { step: '4. Authorization ヘッダーの行を **必ず** 削除してから貼り付け' },
  { step: '5. レスポンス本文（base64エンコード）をその下に貼り付け' },
  { h: 'ver2.1.0' },
  'キャラクター詳細の画像一覧に、これまで表示されていなかった静止画・背景が並ぶようになりました。あわせて、ダウンロードの対象に加わった画像があります。',
  'このため、「一括ダウンロード（キャラ）」と、サイドバーのダウンロードのそれぞれで、取りこぼしが起きている可能性があります。ゲームと再接続をしたのち、各ダウンロードの再実行を推奨します。',
  'すでに取得済みのファイルはスキップされるため、短時間で終わる想定です。',
  { h: 'ver2.0.0' },
  'ver2.0 で画像の取り先が高画質な DMM GAME PLAYER 版に変わっています。',
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
  if (seen === RELEASE) return;
  await showNotice(LINES, { blocking: true, title: TITLE });
  try {
    await chrome.storage.local.set({ [KEY]: RELEASE });
    await chrome.storage.local.remove(OLD_KEY);
  } catch (e) {}
}
