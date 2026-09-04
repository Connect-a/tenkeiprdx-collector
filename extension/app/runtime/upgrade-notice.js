import { showNotice } from '../ui/notice-modal.js';
import { SK, LEGACY_KEYS, LEGACY_IDB_KEYS, LEGACY_LOCAL_STORAGE_KEYS } from '../../core/storage-keys.js';
import { idbStore } from '../../core/idb.js';

const KEY = SK.noticedRelease;
const RELEASE = '2.6';
const MAJOR = RELEASE.split('.')[0];
const TITLE = '更新のお知らせ';
const LINES = [
  { h: 'ver2.6.0' },
  '設定の保存先を整理したため、**ストーリーの主人公名などの設定**が初期化されます。お手数ですが設定し直してください。',
  { h: 'ver2.5.0' },
  '索引の作り直しをしたうえで、以下の3つを実行してください。',
  '・キャラクター「アイトリア【聖夜を手伝う謙譲の大天使】」の個別ダウンロード',
  '・サイドバーの「共有リソース」のダウンロード',
  '・サイドバーの「ホーム」のダウンロード',
  '武器のモデルが2つのバンドルに分かれている場合に片方しか取得できていなかった問題、別々の資産が同じ名前で保存されて片方が失われる問題、シーンイラストの台詞とボイスを取りこぼしていた問題を修正しました。取得し直すのは合計21件です。',
  { h: 'ver2.4.0' },
  '索引の作り直しをしたうえで、サイドバーの「共有リソース」と「バトルフィールド」のダウンロードを再実行してください。すでに取得済みのファイルはスキップされるため、短時間で終わる想定です。',
  'エンドクレジットの再生とタイトルロゴの表示を追加したため「共有リソース」に、マップが参照していた取りこぼしの資産を加えたため「バトルフィールド」に、それぞれダウンロード対象が増えています。',
  { h: 'ver2.3.0' },
  '天啓パラドクスがサービスを終了しました。ストーリーの取得は今後できません。',
  '配信元CDNが生きている間はサイドバーの「ダウンロード」から各種ダウンロードが可能であるため、取り直しが必要な場合はできる限り早く実施してください。',
  '2.2.0で追加されたダウンロード対象があるため、ダウンロード前に索引の作り直しを実施することを推奨します。',
  { h: 'ver2.2.0' },
  'スキルのエフェクトが再生できるようになりました。キャラ固有のエフェクトは「一括ダウンロード（キャラ）」で、複数のキャラが使う共通エフェクトは「共有リソースDL」で取得します。どちらも差分取得なので、両方を実行してください。',
  'サービス終了前に、ゲーム接続と、サイドバーからのダウンロードのし直しをして、欠落が無いかの最終チェックをしてください。',
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
    await chrome.storage.local.remove(LEGACY_KEYS);
    for (const k of LEGACY_LOCAL_STORAGE_KEYS) localStorage.removeItem(k);
    for (const k of LEGACY_IDB_KEYS) await idbStore.del(k);
  } catch (e) {}
}
