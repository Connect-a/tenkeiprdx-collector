import { bulkDownloader } from '../../data/acquire/bulk.js';
import { fileStore } from '../../core/fsdir.js';
import { downloadRunner } from '../../data/acquire/download-runner.js';
import { getById } from '../../core/dom.js';
import { playerState } from '../runtime/player-state.js';
import { chip, html, raw } from '../ui/ui-format.js';
import { toast } from '../ui/notifier.js';
import { errText } from '../../core/messages.js';
import { failureReport, failureText, hasFailures } from '../../core/failure-report.js';
import { refreshLists, folderHandle } from '../runtime/state-refresh.js';
import { openCharacter, appendDetailInfo } from './detail-view.js';
import { closeRoster } from './roster-view.js';
import { audioScene } from '../runtime/audio-scene.js';

let _singleDLActive = false;

export function isSingleDlActive() {
  return _singleDLActive;
}

const PHASE_UI = {
  assets: { msg: 'dlmsg', fill: 'dlfill', pct: 'dlpctAssets' },
};

function setPhaseProgress(phase, msg, frac) {
  const ui = PHASE_UI[phase] || PHASE_UI.assets;
  const pct = Math.round(Math.min(1, Math.max(0, frac || 0)) * 100);
  const m = getById(ui.msg);
  if (m) m.textContent = msg;
  const f = getById(ui.fill);
  if (f) f.style.width = pct + '%';
  const p = getById(ui.pct);
  if (p) p.textContent = msg ? pct + '%' : '';
}

function setProgress(msg, frac) {
  setPhaseProgress('assets', msg, frac);
}

function resetProgress() {
  for (const phase of Object.keys(PHASE_UI)) setPhaseProgress(phase, '', 0);
}

export async function runDownload(folderKey, triggerBtn) {
  getById('dlbar').style.display = '';
  getById('dlbar').classList.remove('err');
  resetProgress();
  try {
    const bst = await bulkDownloader.getState();
    if (bulkDownloader.isStarting() || (bst && bulkDownloader.isActive(bst.phase))) {
      const m = '一括DLの実行中です。完了または停止してから個別DLしてください。';
      setProgress(m, 0);
      toast(m, 'err');
      return;
    }
  } catch (e) {}
  _singleDLActive = true;
  setPhaseProgress('assets', '開始…', 0);
  const btn = triggerBtn || getById('doDl');
  if (btn) btn.disabled = true;
  try {
    const root = fileStore && fileStore.supported ? await fileStore.ensure() : null;
    if (!root) {
      setProgress('先に保存先フォルダを選んでください', 0);
      await refreshLists(['fs', 'owned']);
      return;
    }
    let r = null,
      err = null;
    const target = { folderKey: String(folderKey), name: String(folderKey) };
    const report = (ev) => {
      if (ev.type === 'progress') setPhaseProgress(ev.phase, ev.msg, ev.frac);
      else if (ev.type === 'assets') r = ev.result;
      else if (ev.type === 'error') err = ev.error;
    };
    await downloadRunner.run([target], { report });
    await refreshLists(['fs', 'owned']);
    if (folderHandle(String(folderKey))) await openCharacter(String(folderKey));
    else setProgress('ダウンロードは終わりましたが、保存できたデータがありませんでした。', 1);
    if (err) {
      setProgress(errText(err), 0);
      toast('ダウンロードを中断しました。' + errText(err), 'err');
      console.error('[tp] カードのダウンロードに失敗', err);
      return;
    }
    const rep = failureReport(r);
    if (hasFailures(rep)) toast('ダウンロードが完了しました。取得できなかったものがあります。\n' + failureText(rep), 'err');
    else toast('ダウンロードが完了しました。', 'ok');
  } catch (e) {
    setProgress(errText(e), 0);
    toast('ダウンロードを中断しました。' + errText(e), 'err');
    console.error('[tp] カードのダウンロードに失敗', e);
  } finally {
    _singleDLActive = false;
    if (btn) btn.disabled = false;
  }
}

export async function showDownloadPrompt(item) {
  playerState.navId = String(item.folderKey);
  closeRoster();
  getById('empty').style.display = 'none';
  getById('detail').style.display = '';
  getById('dlbar').style.display = 'none';
  getById('playwrap').style.display = 'none';
  audioScene.set({ storyVisible: false });
  getById('eplist').innerHTML = '';
  getById('stage').style.display = 'none';
  getById('voicegrid').innerHTML = '';
  getById('voiceNote').textContent = '';
  const isChar = item.rosterKind === 'character';
  const owned = item.owned;
  const level = item.level;
  const note = isChar
    ? '立ち絵・アイコン・背景CG・3Dモデル・エフェクト・ボイスを保存します（**ストーリー本文はサービス終了により取得できません**）。'
    : '背景・ボイスなど、保存済みの台本から分かるぶんを保存します（**ストーリー本文はサービス終了により取得できません**）。';
  const badge = isChar && owned ? `<span class="ownbadge">所持 Lv${level}</span>` : isChar ? '<span class="ownbadge dist">未所持</span>' : '';
  const btnLabel = 'ダウンロード（立ち絵・ボイス・3Dなど）';
  getById('charHead').innerHTML = html`<h2>${raw(chip(item.rosterKind))} ${item.displayName || item.folderKey} <span class="hint">#${item.folderKey}</span> ${raw(badge)}</h2>
    <div class="headrow"><span class="note">${raw(note.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'))}</span></div>
    <div class="headrow" style="margin:12px 0 14px"><button class="btn primary" id="doDl">${btnLabel}</button></div>`;
  getById('doDl').addEventListener('click', () => runDownload(item.folderKey));
  await appendDetailInfo(item.folderKey, item.rosterKind);
}
