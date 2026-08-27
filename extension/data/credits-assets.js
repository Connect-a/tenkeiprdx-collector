// クレジット/ロゴ用に共有リソースDLで取得する aa(StreamingAssets) バンドル群。
// 取得は共有DL時のみ、クレジット/表示時は共有から読むだけ（ライブ取得しない）。
// path は base_catalog の RuntimePath 由来（prod0固定）で origin.assets からの相対。

export const TITLE_AA_CACHE = 'statics/titlesprites_aa.bundle';
export const LOGO_AA_CACHE = 'statics/logosprites_aa.bundle';

export const AA_BUNDLES = [
  {
    path: 'WebGL/StreamingAssets/aa/WebGL/builtin(uispritesassets)(uncompressed)_assets_titlesprites_36e59b6ae3fb5e18b2d13f6d15539c61.bundle',
    cache: TITLE_AA_CACHE,
    label: 'タイトルロゴ',
  },
  {
    path: 'WebGL/StreamingAssets/aa/WebGL/builtin(uispritesassets)(uncompressed)_assets_logosprites_6db12e27d6465e8520a2f3ee496d48d7.bundle',
    cache: LOGO_AA_CACHE,
    label: 'ロゴ',
  },
];

// クレジットのタイトルロゴ Sprite（Xなし normal を優先、無ければ adult=FANZA "X"版）。
export const TITLE_SPRITE_NAMES = ['img_start_title_normal', 'img_start_title_adult'];
// logosprites 内の Sprite（ゲームロゴ／DMM／FANZA）。
export const LOGO_SPRITE_NAMES = ['01_00_logo', '01_00_dmm', 'fanza'];
