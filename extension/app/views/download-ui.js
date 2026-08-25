import { bulkDownloader } from '../../data/acquire/bulk.js';
import { fileStore } from '../../core/fsdir.js';
import { downloadRunner } from '../../data/acquire/download-runner.js';
import { episodeCounts } from '../../data/character-meta.js';
import { getById } from '../../core/dom.js';
import { playerState } from '../runtime/player-state.js';
import { chip, html, raw } from '../ui/ui-format.js';
import { toast } from '../ui/notifier.js';
import { RECONNECT, errText } from '../../core/messages.js';
import { failureReport, failureText, hasFailures } from '../../core/failure-report.js';
import { refreshLists, folderHandle } from '../runtime/state-refresh.js';
import { openCharacter, appendDetailInfo } from './detail-view.js';
import { closeRoster } from './roster-view.js';
import { audioScene } from '../runtime/audio-scene.js';
import { ensureUserState } from '../runtime/user-state-guard.js';

let _singleDLActive = false;

export function isSingleDlActive() {
  return _singleDLActive;
}

const PHASE_UI = {
  story: { msg: 'dlmsgStory', fill: 'dlfillStory', pct: 'dlpctStory' },
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

function guideConnect() {
  const bar = getById('dlbar');
  bar.style.display = '';
  bar.classList.add('err');
  getById('dlmsg').textContent = '⚠ ' + RECONNECT;
  getById('dlfill').style.width = '100%';
  const b = getById('connToggle');
  if (b) {
    b.classList.add('flash');
    setTimeout(() => b.classList.remove('flash'), 8000);
  }
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
  setPhaseProgress('story', '開始…', 0);
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
    if (!(await ensureUserState({ onDemand: true }))) {
      setProgress('解放状態が読み取れないため中止しました', 0);
      getById('dlbar').classList.add('err');
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
    let storyDone = false;
    const [storyOutcome, assetOutcome] = await Promise.all([
      downloadRunner.run([{ ...target, assets: false }], { report }).then((o) => {
        storyDone = true;
        setPhaseProgress('story', '完了', 1);
        return o;
      }),
      downloadRunner.run([{ ...target, story: false }], {
        report,
        readyFor: async () => {
          for (;;) {
            if (storyDone) return true;
            await new Promise((res) => setTimeout(res, 500));
          }
        },
      }),
    ]);
    const outcome = assetOutcome === 'done' ? storyOutcome : assetOutcome;
    await refreshLists(['fs', 'owned']);
    if (folderHandle(String(folderKey))) await openCharacter(String(folderKey));
    else setProgress('ダウンロードは終わりましたが、保存できたデータがありませんでした。解放済みの話が無いか、通信に失敗しています。', 1);
    if (outcome === 'auth') {
      guideConnect();
      return;
    }
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
  const distFull = episodeCounts.distOnly(item);
  const unlocked = item.counts.open;
  const total = item.counts.total;
  const available = episodeCounts.availableCount(item);
  let note;
  let badge;
  let btnLabel;
  if (isChar && owned) {
    note = `ストーリー ${available}/${total}話・ボイス・立ち絵・3Dモデルを保存します。`;
    badge = `<span class="ownbadge">所持 Lv${level}</span>`;
    btnLabel = `ダウンロード（${available}話＋立ち絵など）`;
  } else if (isChar && distFull) {
    note = `ストーリー ${total}/${total}話・ボイス・立ち絵・3Dモデルを保存します。`;
    badge = '<span class="ownbadge dist">未所持</span>';
    btnLabel = `ダウンロード（${total}話＋立ち絵など）`;
  } else if (isChar) {
    note = '立ち絵・アイコン・背景CG・3Dモデル・ボイスを保存します（**このキャラのストーリーは取得できません**）。';
    badge = '<span class="ownbadge dist">未所持</span>';
    btnLabel = 'ダウンロード（立ち絵・ボイス・3D）';
  } else {
    note = `ストーリー ${available}/${total}話・ボイス・背景などを保存します。`;
    badge = '';
    btnLabel = `ダウンロード（${available}話）`;
  }
  getById('charHead').innerHTML = html`<h2>${raw(chip(item.rosterKind))} ${item.displayName || item.folderKey} <span class="hint">#${item.folderKey}</span> ${raw(badge)}</h2>
    <div class="headrow"><span class="note">${raw(note.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'))}</span></div>
    <div class="headrow" style="margin:12px 0 14px"><button class="btn primary" id="doDl">${btnLabel}</button></div>`;
  getById('doDl').addEventListener('click', () => runDownload(item.folderKey));
  await appendDetailInfo(item.folderKey, item.rosterKind);
}
