# 🎴 天啓パラドクス コレクター

天啓パラドクス（DMM / FANZA）の所持キャラのリソースを、自分のPCのフォルダへダウンロードして再生するブラウザ拡張（Chrome / Edge、Manifest V3）。

- 対象：所持キャラの解放済みストーリー・ボイス・立ち絵・アイコン・背景CG・3Dモデル など
- 再生できるもの：
  - 演出付きストーリー（テキスト＋ボイス、背景・立ち絵・カメラ・SE・BGM）
  - ボイスギャラリー
  - 立ち絵Spine・アイコン・背景CG
  - 3Dモデル（モーション・表情・装飾・武器・オーラ。回転・ズーム）

## ⚠️ 免責事項

- 本ソフトウェアは非公式の個人制作物です。ゲーム運営（DMM／FANZA）および同梱ライブラリの提供元とは一切関係ありません。
- すべて自己責任でご利用ください。現状有姿・無保証で提供され、作者は本ソフトウェアの使用によって生じたいかなる損害・不利益についても一切責任を負いません。
- 本拡張で取得したデータ（ストーリー・ボイス・画像・テキスト等）は、私的な閲覧の範囲でのみ利用し、再配布・公開・アップロード等の二次利用はしないでください。
- 本拡張はダウンロード時に、知り得たリソースを収集サーバーへ送信します。使いたくない場合は使用しないでください。
  - DMMのアカウント情報（ログイン情報・認証トークン等）は収集・送信していません。
  - 不安に思ったら F12（開発者ツール）の Network タブで通信内容を確認してください。

## 🖥️ 対応ブラウザ

保存先フォルダへの書き込みに File System Access API（`showDirectoryPicker`）を使うため、Chromium系デスクトップブラウザ専用です。

| ブラウザ                      | 対応       | 備考                                              |
| ----------------------------- | ---------- | ------------------------------------------------- |
| Chrome / Edge                 | ✅         | そのまま動作                                      |
| Brave                         | ⚠️         | 既定で無効。下記フラグをONにする必要あり          |
| Opera / Vivaldi 等 Chromium系 | ✅（概ね） | バージョンによる                                  |
| Firefox / Safari              | ❌         | File System Access API 非対応（現状は動きません） |

### Brave での許可のしかた

1. ブラウザのアドレスバーに `brave://flags/#file-system-access-api` を入力して開く
2. File System Access API を Enabled に変更
3. Relaunch（Brave を再起動）
4. その後、ビューアで「保存先フォルダ」を選び直す

## 📦 インストール

1. [Releases](https://github.com/Connect-a/tenkeiprdx-collector/releases) を開き、いちばん上（最新版）の **Assets** から zip か 7z をダウンロードして、任意のフォルダに展開する
2. ブラウザのアドレスバーに `chrome://extensions`（Edge は `edge://extensions`）を入力して開き、デベロッパーモードを ON
3. 「パッケージ化されていない拡張機能を読み込む」を押す
4. 手順1で展開したフォルダの中の `extension` フォルダを選択
5. ツールバーの拡張アイコンをクリックしてビューアを開く

リポジトリを clone して使う場合は、手順1のかわりに clone したフォルダの `extension` を選んでください。

## 🚀 使い方（3ステップ）

1. 保存先フォルダを選ぶ … ダウンロード物はすべてここに保存されます
2. 「ゲームと接続」 … ライブの天啓パラドクスを開いてホームまで進むと、トークンと所持キャラ・レベルを取得します
   - 接続状態はバッジで表示：緑＝トークン取得済み／赤＝トークン切れ／黄＝トークン待ち
   - トークン有効時は「データ再取得」ボタンが出ます（ゲーム内で入手/育成したら押すと最新化）
3. キャラを選んで「ダウンロード」 … DL後に開けば再生できます
   - 立ち絵・アイコン・背景CG・3Dモデル・ボイス は、所持/未所持を問わず取得できます
   - ストーリー（本文＋ボイス）は、所持していて解放済みの話が取得対象です

> 2.0 で保存形式が変わりました。1.x で取得したフォルダとは互換性がないため、新しいフォルダを指定して取り直してください。

## ❓ こまったときは

- 「トークン切れ」と出る
  - 数時間で失効します。ゲームのタブを少し操作すると取り直され、自動で反映されます
  - 反映されない場合は、拡張を「ゲームと接続」した状態でゲームを再起動（タブを再読み込み）するのが最も確実です
- 「接続失敗」になる
  - 同じゲームタブで DevTools（F12）を開いていると失敗します（1タブに接続できるデバッガは1つだけ、という Chrome の仕様）
  - DevTools を閉じてから接続してください
- 保存先フォルダが「要再許可」
  - ブラウザ再起動で許可が外れることがあります。「このフォルダを許可」を押すだけでOK（選び直し不要）
- 一覧が空のまま
  - まだ接続していないか、ゲームをホームまで進めていません。手順2をやり直してください

## 📁 保存先フォルダの中身（参考）

```
_キャラ/<キャラID>__<名前>/
  story/<話ID>/          台本(scene)・ボイス
  visual/<種類>/         立ち絵spine / アイコン / 背景CG(still) / 3Dモデル(model) / 武器(weapon) など
  voice_gallery.web.bundle  キャラボイス
_メインシナリオ/<quest_章キー>__<名前>/    story/ と visual/（thumb=話のサムネ、banner=ロゴ/ボタン画像）
_イベントシナリオ/<quest_章キー>__<名前>/  同上
_特別シナリオ/<special_ID>__<名前>/        同上
_共有リソース/             共通の背景/BGM/SE、登場キャラの立ち絵（重複排除）、3D共有アトラス、アイテムアイコン
_ホーム/                   シーンイラスト・1コマ漫画・ホーム背景・プロフィールアイコン
_モンスター/<ID>/          図鑑の3Dモデル・立ち絵・アイコン
_その他3D/                 モンスター以外の3Dモデル（ボス・武器など）
_マスタ/                   マスタデータ
```

索引・ゲームデータは拡張に同梱していません。接続時にゲームから取得して自動生成します（更新時は「データ管理 → 索引を作り直す」）。

## 🧩 使用ライブラリ・サードパーティ（`extension/vendor/`）

各ライセンス全文は `vendor/*.LICENSE.txt`。

- @msgpack/msgpack（`msgpack.esm.js`）… API/マスタの MessagePack デコード（ISC License）
- three.js（`three.module.js` / `three.core.js`）… 3Dモデルの描画（MIT License）
- three.quarks（`three.quarks.esm.js` / `quarks.core.esm.js`）… 演出パーティクルの描画（MIT License）
- @esotericsoftware/spine-player 3.8（`spine-player-3.8.js` / `spine-player-3.8.css`）… 立ち絵Spineの再生（Spine Runtimes License）
- Unity crunch デコーダ（`unitycrn.wasm` / `unitycrn.js`）… テクスチャ（crunch圧縮）の展開（AssetStudio Texture2DDecoderNative ＋ Unity-Technologies/crunch を emscripten でビルド・ZLIB License）
- crnlib (asm.js)（`crn-O2.js`）… テクスチャ候補プローブ用（ZLIB License）

LZ4 / UnityFS / SerializedFile / Mesh / Avatar / AnimationClip の解析は本拡張の独自実装（外部依存なし）。

### 既知のランタイム不具合と対処（Spine deform 残留）

同梱の spine-player 3.8 は、あるアニメ内で「加重メッシュに deform を掛けた直後に別メッシュへアタッチメント差替」すると、差替後も前メッシュ用の `slot.deform`（別頂点数）が残留し `computeWorldVertices` が NaN 頂点を生む不具合がある（後続 3.8 パッチで修正済／実ゲームの Unity ランタイムは修正版のため崩れない＝データ側は正常）。実例＝EX still `10069301_01`（口=加重メッシュ、animation4 で mouth_2(deform)→mouth_4 差替時に口が崩壊）。対処＝`spine-web.js` の `patchStaleDeformOnce()` が `VertexAttachment.prototype.computeWorldVertices` を一度だけラップし、`slot.deform.length` が現アタッチメントの期待長（加重= `vertices.length/3*2`／非加重= `worldVerticesLength`）と一致しない場合に deform を破棄する。story(stage-gl)・立ち絵(SpinePlayer)両経路で有効。

## 🗂️ 構成

```
extension/                読み込む拡張本体（load-unpacked 対象）
  manifest.json config.js background.js player.html
  app/       画面（パネル・ビュー・実行時の配線）
  core/      土台（保存先フォルダ・パス規則・設定・共通処理）
  data/      索引の構築とダウンロード
  engine/    再生（ストーリー・3D・Spine・演出）
  unity/     Unity資産のデコード（UnityFS / Mesh / Anim / テクスチャ / 音声）
  style/     CSS
  vendor/    同梱ライブラリ（上記）
```
