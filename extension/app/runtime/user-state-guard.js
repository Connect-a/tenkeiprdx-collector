import { userStateService } from '../../data/user-state.js';
import { showNotice } from '../ui/notice-modal.js';
import { getLetterPanel } from './panel-state.js';
import { toast } from '../ui/notifier.js';

const TITLE = '解放状態を読み取れません';
let shownKey = '';

const issueKey = (issue) => `${issue.reason}|${issue.message}|${issue.detail || ''}`;

function extVersion() {
  try {
    return chrome.runtime.getManifest().version || '';
  } catch (e) {
    return '';
  }
}

function reportText(issue) {
  const ver = extVersion();
  return ['【不具合報告】解放状態（user.bin）を読み取れません', `種別: ${issue.reason}`, `内容: ${issue.message}`, issue.detail ? `詳細: ${issue.detail}` : '', ver ? `拡張: v${ver}` : ''].filter(Boolean).join('\n');
}

function noticeLines(issue) {
  return [
    `どのストーリーが解放済みかを判定できませんでした（${issue.message}）。`,
    'このままではキャラのストーリーはダウンロードできません（解放されていないものを取りに行かないため、すべて対象外になります）。',
    'ゲームのタブを開いて接続し、データの再取得を行ってください。',
    '直らない場合はおてがみで報告してください（内容は自動で入ります）。',
  ];
}

export async function ensureUserState({ onDemand } = {}) {
  const issue = await userStateService.userIssue();
  if (!issue) {
    shownKey = '';
    return true;
  }
  const key = issueKey(issue);
  if (!onDemand && shownKey === key) return false;
  shownKey = key;
  await showNotice(noticeLines(issue), {
    title: TITLE,
    actions: [
      {
        text: 'おてがみで報告',
        on: () => {
          const p = getLetterPanel();
          if (p && p.openReport) p.openReport(reportText(issue));
          else toast('おてがみを開けませんでした', 'err');
        },
      },
    ],
  });
  return false;
}
