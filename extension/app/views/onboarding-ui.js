import { fileStore } from '../../core/fsdir.js';
import { SK } from '../../core/constants.js';
import { getById, el, append } from '../../core/dom.js';
import { playerState } from '../runtime/player-state.js';
import { toast } from '../ui/notifier.js';
import { pickFolder, fsPickErr } from './fs-ui.js';
import { refreshLists } from '../runtime/state-refresh.js';

function buildEmailStep() {
  const input = el('input', { type: 'email', placeholder: 'you@example.com' });
  const save = el('button', {
    class: 'btn xs',
    text: '保存',
    on: {
      click: () => {
        const v = (input.value || '').trim();
        const field = getById('email');
        if (field) field.value = v;
        const btn = getById(v ? 'emailSave' : 'emailClear');
        if (btn) btn.click();
        toast(v ? 'メールアドレスを保存しました' : 'メールアドレスをクリアしました', 'ok');
      },
    },
  });
  try {
    chrome.storage.local.get(SK.email).then((o) => {
      if (o && o[SK.email]) input.value = o[SK.email];
    });
  } catch (e) {}

  const label = el('span', 'olabel', document.createTextNode('メールアドレス（入力不要）'));
  append(label, [
    el('div', 'emailrow', [input, save]),
    el('div', { class: 'note dim', style: { marginTop: '4px' }, text: '入力せずとも機能に変化や欠落はありません。あとでサイドバーの「設定」からいつでも変更・削除できます。' }),
  ]);
  return el('div', 'step active', [el('span', 'onum', '0'), label]);
}

export function buildOnboard({ fsGranted, hasIndex }) {
  const box = el('div', 'onboard');
  const step = ({ status, num, label, btn }) =>
    `<div class="step ${status === 'done' ? 'done' : status === 'active' ? 'active' : ''}"><span class="onum">${status === 'done' ? '✓' : num}</span><span class="olabel">${label}</span>${status === 'active' && btn ? btn : ''}</div>`;
  const stepStatus = (done, active) => (done ? 'done' : active ? 'active' : 'todo');
  const supported = !!(fileStore && fileStore.supported);
  const hasHandle = supported && fileStore.dirName();
  const step1label = !supported
    ? 'この環境では保存先フォルダを使えません（File System Access API 無効）。Chrome/Edge、または Brave はフラグ有効化が必要です'
    : hasHandle
      ? `保存先フォルダ「${fileStore.dirName()}」を許可`
      : '保存先フォルダを選択';
  const step1btn = !supported ? '' : `<button class="btn primary" id="obFolder">${hasHandle ? 'このフォルダを許可' : 'フォルダを選ぶ'}</button>`;
  box.innerHTML = `<h2 class="obh">はじめに（2ステップ）</h2>
    ${step({ status: stepStatus(fsGranted, !fsGranted), num: '①', label: step1label, btn: step1btn })}
    ${step({ status: stepStatus(hasIndex, fsGranted && !hasIndex), num: '②', label: 'サイドバーの「ダウンロード」から索引を作る', btn: '' })}
    <div class="note dim" style="margin-top:10px">※サービス終了によりゲームとの接続はできなくなりました。既に取得済みのデータと配信中のCDNから読み込みます。</div>
    <div class="note dim" style="margin-top:4px">※取得したデータ（ストーリー・ボイス・画像等）は私的な閲覧のみに使用し、再配布・公開はしないでください。</div>`;
  box.insertBefore(buildEmailStep(), box.querySelector('.obh').nextSibling);

  const b = box.querySelector('#obFolder');
  if (b) {
    b.addEventListener('click', async () => {
      if (fileStore.dirName()) {
        try {
          playerState.fsGranted = (await fileStore.permission({ request: true })) === 'granted';
          await refreshLists();
        } catch (e) {
          toast(fsPickErr(e), 'err');
        }
      } else {
        await pickFolder();
      }
    });
  }
  return box;
}
