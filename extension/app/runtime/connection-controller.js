import { SK } from '../../core/constants.js';
import { getById, el } from '../../core/dom.js';
import { playerState } from './player-state.js';
import { toast } from '../ui/notifier.js';

let autoDisc = false;

const isTokenExpired = (exp) => !!(exp && Math.floor(Date.now() / 1000) >= exp);

function formatTokenRemain(exp) {
  if (!exp) return '';
  const secs = Math.floor(exp - Date.now() / 1000);
  if (secs <= 0) return '失効';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `残り約${h > 0 ? h + '時間' + m + '分' : m + '分'}`;
}

function deriveConnectionState(state) {
  const on = !!state.capturing;
  const live = !!state.captureLive;
  const token = state.apiAuth && state.apiAuth.authorization;
  const exp = state.apiAuth && state.apiAuth.exp;
  const expired = isTokenExpired(exp);
  const rejected = !!(token && token === state.apiAuthBad);
  const hasToken = !!(token && !rejected && !expired);
  if (hasToken) return { on, live, hasToken, cls: 'ok', label: formatTokenRemain(exp) || '接続済み' };
  if (token && expired) return { on, live, hasToken, cls: 'bad', label: 'トークン切れ' };
  if (rejected && on) return { on, live, hasToken, plain: true, cls: 'bad', label: '天啓パラドクスを起動して操作してください。' };
  if (on && live) return { on, live, hasToken, cls: 'wait', label: 'ゲームの操作を待っています' };
  return { on, live, hasToken, cls: null, label: null };
}

export function setAutoDisconnectOff() {
  autoDisc = false;
}

export async function updateConn() {
  const o = await chrome.storage.local.get([SK.capturing, SK.captureLive, SK.captureError, SK.apiAuth, SK.apiAuthBad]);
  const badgeState = deriveConnectionState({
    capturing: o.capturing,
    captureLive: o.captureLive,
    captureError: o.captureError,
    apiAuth: o.apiAuth,
    apiAuthBad: o.apiAuthBad,
  });

  const on = badgeState.on;
  const live = badgeState.live;
  const hasToken = badgeState.hasToken;
  const b = getById('connToggle');
  if (!b) return;
  b.textContent = on ? '接続を解除' : 'ゲームと接続';
  b.className = on ? 'btn rec' : 'btn primary';
  b.dataset.on = on ? '1' : '';

  const ru = getById('dataReacquire');
  if (ru) ru.style.display = hasToken ? '' : 'none';

  const info = getById('connInfo');
  if (!info) return;
  info.textContent = on && !live ? o.captureError || 'ゲームタブ未接続（ライブのゲームを開く／DevToolsを閉じて再接続）' : '';
  if (badgeState.label) {
    info.appendChild(document.createTextNode(' '));
    info.appendChild(el('span', badgeState.plain ? 'tokhint' : 'tokbadge ' + badgeState.cls, badgeState.label));
  }
}

export async function maybeAutoDisconnect() {
  if (autoDisc) return;
  const o = await chrome.storage.local.get([SK.capturing, SK.apiAuth, SK.apiAuthBad]);
  if (!o.capturing) return;
  const tok = o.apiAuth && o.apiAuth.authorization;
  if (!(tok && tok !== o.apiAuthBad)) return;
  if (isTokenExpired(o.apiAuth && o.apiAuth.exp)) return;
  if (playerState.owned.size <= 0) return;
  autoDisc = true;
  try {
    await chrome.runtime.sendMessage({ cmd: 'stop' });
  } catch (e) {}
  await updateConn();
  toast('接続完了しました。', 'ok', { dur: 6000 });
}
