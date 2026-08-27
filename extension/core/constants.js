export const DIRS = { shared: '_共有リソース', home: '_ホーム', master: '_マスタ', other: '_その他3D', monster: '_モンスター', verify: '_検証', cache: '_キャッシュ', save: '_拡張機能のセーブデータ' };

export const FOLDER_PARENTS = { character: '_キャラ', main: '_メインシナリオ', event: '_イベントシナリオ', special: '_特別シナリオ' };

export const OTHER_EPISODE_SUBTYPE = 'その他エピソード';

export const SCENE_TEXT_IN_FRAME_FIELD = [{ sceneId: '477201', order: 26 }];

export const R18_ALT_EPISODES = [
  { id: '404113', after: '602600104', label: '第4話(R18)' },
  { id: '404114', after: '602600105', label: '第5話(R18)' },
  { id: '404115', after: '602600106', label: '第6話(R18)' },
  { id: '404116', after: '602600201', label: '第7話(R18)' },
  { id: '404117', after: '602600206', label: '第12話(R18)' },
];
export const R18_ALT_OWNER = 'special_other';

export const XPOS_CATEGORIES = [
  [1, '\u6b63\u5e38\u4f4d'],
  [2, '\u9a0e\u4e57\u4f4d'],
  [4, '\u7acb\u4f4d'],
  [8, '\u5074\u4f4d'],
  [16, '\u5ea7\u4f4d'],
  [32, '\u7acb\u3061\u30d0\u30c3\u30af'],
  [64, '69'],
  [128, '\u5f8c\u80cc\u4f4d'],
  [256, '\u30d1\u30a4\u30ba\u30ea'],
  [512, '\u624b\u30b3\u30ad'],
  [1024, '\u8db3\u30b3\u30ad'],
  [2048, '\u30d5\u30a7\u30e9'],
  [4096, '\u30aa\u30ca\u30cb\u30fc'],
  [8192, '\u30af\u30f3\u30cb'],
  [16384, '\u624b\u30de\u30f3'],
  [32768, '\u30d0\u30a4\u30d6'],
  [65536, '\u305d\u306e\u4ed6'],
];

export const xposNames = (mask) => XPOS_CATEGORIES.filter(([bit]) => (mask || 0) & bit).map(([, name]) => name);

export const DEFAULT_PLAYER_NAME = 'おーじ';

export const FAIL_CAP = 20;

export const MISS_STREAK_CAP = 10;

export const DL_CONC = { asset: 32, decode: 8, large: 3 };

export const MOTION_ORDER = ['Idle', 'IdleAction', 'IdleVictory', 'Attack', 'Damage', 'AbnormalCondition', 'Victory', 'Run', 'Skill', 'CastingSpell'];

export const MOTION_VOICE = {
  attack: 4,
  skill: 5,
  castingspell: 6,
  damage: 8,
  abnormalcondition: 10,
  victory: 11,
  idleaction: 22,
};

export const AFFILIATION_NAMES = { 1: 'リーニャ', 2: 'テーセツ', 3: 'ジャハラ', 4: 'クォンツィ', 5: 'ジェネラス', 6: 'ペイシェ', 7: 'ヒューム', 8: 'アンノウン' };
export const RARITY_NAMES = { 1: 'S', 2: 'A', 3: 'B', 4: 'C', 5: 'UR' };
export const MONSTER_TYPE_NAMES = { 1: 'Attacker', 2: 'Defender', 3: 'Sorcerer', 4: 'Supporter', 5: 'Jammer' };
export const MONSTER_RACE_NAMES = {
  1: 'アンデッド',
  2: 'ドラゴン',
  3: '魔法生物',
  4: '亜人',
  5: '巨人',
  6: '水棲',
  7: '霊体',
  8: '不定形',
  9: '機械',
  10: '爬虫類',
  11: '獣',
  12: '虫',
  13: '石',
  14: '植物',
  15: '悪魔',
  16: '鳥',
  17: 'アニマ',
  18: '無機物',
  19: '精霊',
  20: '自然',
};

export const SK = {
  origin: 'origin',
  originManual: 'originManual',
  indexCache: 'indexCache',
  apiAuth: 'apiAuth',
  apiAuthBad: 'apiAuthBad',
  userRaw: 'userRaw',
  cdnMissing: 'cdnMissing',
  missingScenes: 'missingScenes',
  binlistUrl: 'binlistUrl',
  binlistScenes: 'binlistScenes',
  exFavorites: 'exFavorites',
  email: 'email',
  bulkState: 'bulkState',
  scenarioSettings: 'scenarioSettings',
};
