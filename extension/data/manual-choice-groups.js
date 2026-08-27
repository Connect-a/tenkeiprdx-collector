const DOKIDOKI = {
  8: [
    { content: 'ソフィアとのストーリー', sceneMasterId: '480110', order: 0 },
    { content: 'ナディラとのストーリー', sceneMasterId: '480210', order: 1 },
    { content: 'ライサとのストーリー', sceneMasterId: '480310', order: 2 },
  ],
  9: [
    { content: '教室で待ってるよ', sceneMasterId: '480111', order: 0 },
    { content: '先に帰っておくよ', sceneMasterId: '480112', order: 1 },
    { content: 'そっと見守ろう', sceneMasterId: '480113', order: 2 },
  ],
  10: [
    { content: 'ちょっとドキドキした', sceneMasterId: '480121', order: 0 },
    { content: '本当に申し訳ございません', sceneMasterId: '480122', order: 1 },
    { content: 'お互いに成長を実感したな', sceneMasterId: '480123', order: 2 },
  ],
  11: [
    { content: 'しっかり手を握る', sceneMasterId: '480131', order: 0 },
    { content: '言葉で伝える', sceneMasterId: '480132', order: 1 },
    { content: '強く抱きしめる', sceneMasterId: '480133', order: 2 },
  ],
  12: [
    { content: '告白する', sceneMasterId: '480141', order: 0 },
    { content: '……勇気が出ない', sceneMasterId: '480142', order: 1 },
    { content: '実は宇宙人なんだ', sceneMasterId: '480143', order: 2 },
  ],
  13: [
    { content: '大きな音を立ててみよう', sceneMasterId: '480211', order: 0 },
    { content: 'じゃあ脱いでみようかな', sceneMasterId: '480212', order: 1 },
    { content: '黙って待とう', sceneMasterId: '480213', order: 2 },
  ],
  14: [
    { content: 'うん、いいよ！', sceneMasterId: '480221', order: 0 },
    { content: 'おにぎりとかどうかな？', sceneMasterId: '480222', order: 1 },
    { content: '俺が作ってみようか', sceneMasterId: '480223', order: 2 },
  ],
  15: [
    { content: '不正をすれば問題ないよ', sceneMasterId: '480231', order: 0 },
    { content: 'もう１回いまのお願いしていいかな', sceneMasterId: '480232', order: 1 },
    { content: 'とことん練習すれば大丈夫だよ', sceneMasterId: '480233', order: 2 },
  ],
  16: [
    { content: '告白する', sceneMasterId: '480241', order: 0 },
    { content: '……勇気が出ない', sceneMasterId: '480242', order: 1 },
    { content: '実は犯人がわかったんだ', sceneMasterId: '480243', order: 2 },
  ],
  17: [
    { content: '風邪ひかれると困るし', sceneMasterId: '480312', order: 0 },
    { content: '恋人に見えるかな', sceneMasterId: '480311', order: 1 },
    { content: '忘れてると思った', sceneMasterId: '480313', order: 2 },
  ],
  18: [
    { content: 'ちょっと調子悪いんだ', sceneMasterId: '480321', order: 0 },
    { content: 'キスしてくれたら治る', sceneMasterId: '480322', order: 1 },
    { content: 'なんともないよ', sceneMasterId: '480323', order: 2 },
  ],
  19: [
    { content: 'いってらっしゃい', sceneMasterId: '480331', order: 0 },
    { content: '俺も一緒に行くよ', sceneMasterId: '480332', order: 1 },
    { content: '俺にも野菜をくれ', sceneMasterId: '480333', order: 2 },
  ],
  20: [
    { content: '告白する', sceneMasterId: '480341', order: 0 },
    { content: '……勇気が出ない', sceneMasterId: '480342', order: 1 },
    { content: 'ライサの正体に気づいた', sceneMasterId: '480343', order: 2 },
  ],
};

const SENNEN = {
  2200104: {
    2: [
      { content: '着物、似合ってるね', sceneMasterId: '901801', order: 0 },
      { content: 'その履き物、変わってるね', sceneMasterId: '901802', order: 1 },
    ],
  },
  2200110: {
    3: [
      { content: '月はどうだった？', sceneMasterId: '901805', order: 0 },
      { content: 'ウサちゃんズのこと', sceneMasterId: '901806', order: 1 },
    ],
  },
  2200204: {
    4: [
      { content: 'この子はいつ現れた？', sceneMasterId: '901808', order: 0 },
      { content: '最初に会ったのはいつ？', sceneMasterId: '901809', order: 1 },
    ],
  },
  2200212: {
    5: [
      { content: 'パンツのこと', sceneMasterId: '901810', order: 0 },
      { content: 'ブラのこと', sceneMasterId: '901811', order: 1 },
    ],
  },
  2200312: {
    6: [
      { content: 'ヤヤ', sceneMasterId: '901812', order: 0 },
      { content: '鏡界のヤヤ', sceneMasterId: '901813', order: 1 },
    ],
  },
  2200315: {
    7: [
      { content: 'お餅、まだある？', sceneMasterId: '901814', order: 0 },
      { content: 'おもちゃで遊ぶ？', sceneMasterId: '901815', order: 1 },
    ],
  },
};
const MANUAL_CHOICE_GROUPS = { 2300101: DOKIDOKI, ...SENNEN };

export function manualChoiceGroups(episodeId) {
  return MANUAL_CHOICE_GROUPS[String(episodeId)] || null;
}
