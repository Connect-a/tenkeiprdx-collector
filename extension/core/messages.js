export const RECONNECT = 'サービス終了によりゲームのトークンが取得できないため、ストーリーの取得はできません。';

export const pinnedBaseStale = (manual, env) =>
  `配信元を手入力で固定しています（${manual}）。ゲームが案内している最新は ${env} です。古い方を指していると資産が取れないことがあります。設定の「クリア」で自動に戻せます。`;

export const LOW_QUALITY_INDEX =
  '高画質版（DMM GAME PLAYER 版）の一覧が取れていません。このままダウンロードすると画像が低画質になります。サイドバーの「ダウンロード」から「索引を作り直す」を実行してください。';

export const errText = (e) => {
  if (e && e.auth) return RECONNECT;
  if (e && e.noFolder) return e.message;
  const m = e && e.message ? e.message : e ? String(e) : '';
  return m || '原因不明のエラーが発生しました。';
};
