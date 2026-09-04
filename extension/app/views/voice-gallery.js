import { collectionRepository } from '../../data/collection.js';
import { charAssets } from '../../data/char-assets.js';
import { characterMeta } from '../../data/character-meta.js';
import { getById, el } from '../../core/dom.js';
import { playerState } from '../runtime/player-state.js';
import { nameFix } from '../ui/ui-format.js';
import { cachedAudioUrl } from '../../core/audio-url.js';
import { voiceOut } from '../panels/voice-out.js';

const VOICE_SITUATION = {
  1: '自己紹介',
  2: 'バトル開始',
  3: 'ボス戦開始',
  4: '通常攻撃',
  5: 'スキル攻撃',
  6: '必殺技',
  7: 'とどめ',
  8: '被ダメージ',
  9: '戦闘不能',
  10: '状態異常',
  11: '勝利',
  12: '宝箱を開ける',
  13: '10ターン経過',
  14: '作戦変更',
  15: '強化',
  16: 'ランクアップ',
  17: '編成変更',
  18: '特技習得',
  19: '会話1',
  20: '会話2',
  21: '会話3',
  22: 'タップ',
  23: '放置',
  24: '誕生日',
  25: 'バレンタイン',
  26: 'ホワイトデー',
  27: 'お正月',
  28: 'クリスマス',
  29: 'タイトル',
  30: 'プレイヤー誕生日',
  31: 'ログインボーナス',
};

export async function renderVoiceGallery() {
  const grid = getById('voicegrid');
  const note = getById('voiceNote');
  if (!grid || !note) return;
  grid.innerHTML = '';
  const bundle = playerState.cur.meta && characterMeta.voiceGalleryBundle(playerState.cur.meta.voiceGallery);
  if (!bundle) {
    note.textContent = 'このキャラのキャラボイスは未取得です。';
    return;
  }

  const clips = await charAssets.extractClips(playerState.cur.handle, bundle);
  const voiceNo = (nm) => {
    const m = String(nm).match(/_(\d+)[a-z]*$/i);
    return m ? parseInt(m[1], 10) : 0;
  };
  clips.sort((a, b) => voiceNo(a.name) - voiceNo(b.name) || (a.name > b.name ? 1 : -1));
  note.textContent = clips.length ? '' : 'キャラボイスを展開できませんでした。';

  const meta = playerState.cur.meta;
  let vmsg = (meta.voiceGallery && meta.voiceGallery.messages) || {};
  if (!Object.keys(vmsg).length) {
    try {
      const d = await collectionRepository.characterDetail(playerState.cur.folderKey);
      if (d && d.voiceMessages) vmsg = d.voiceMessages;
    } catch (e) {}
    if (!Object.keys(vmsg).length) vmsg = (meta.profile && meta.profile.voiceMessages) || {};
  }

  const cards = [];
  for (const c of clips) {
    const no = voiceNo(c.name);
    const card = el('div', { class: 'voicecard', html: '<div class="voicecard-name"></div><div class="voicecard-serif"></div><div class="voicecard-id"></div>' });
    card.querySelector('.voicecard-name').textContent = VOICE_SITUATION[no] || `No.${String(no).padStart(3, '0')}`;
    const serif = vmsg[no] != null ? vmsg[no] : vmsg[String(no)];
    const vs = card.querySelector('.voicecard-serif');
    if (serif) vs.textContent = nameFix(serif);
    else vs.remove();
    card.querySelector('.voicecard-id').textContent = c.name;
    cards.push(card);
    card.addEventListener('click', async () => {
      cards.forEach((x) => x.classList.remove('playing'));
      card.classList.add('playing');
      voiceOut.play(await cachedAudioUrl(playerState.cur.voiceUrls, c.name, async () => c));
    });
    grid.appendChild(card);
  }
}
