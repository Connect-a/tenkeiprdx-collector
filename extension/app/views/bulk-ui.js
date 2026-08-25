import { bulkDownloader } from '../../data/acquire/bulk.js';
import { fileStore } from '../../core/fsdir.js';
import { assetAcquirer } from '../../data/acquire/acquire-assemble.js';
import { collectionRepository } from '../../data/collection.js';
import { episodeCounts, questSort } from '../../data/character-meta.js';
import { getById, el } from '../../core/dom.js';
import { playerState } from '../runtime/player-state.js';
import { TYPE_LABEL, html } from '../ui/ui-format.js';
import { toast } from '../ui/notifier.js';
import { failureGroups } from '../../core/failure-report.js';
import { isSingleDlActive as getSingleDlActive } from './download-ui.js';
import { ensureUserState } from '../runtime/user-state-guard.js';
import { rescanAll, pendingScan, lastScanAt } from '../runtime/state-refresh.js';
import { networkClient } from '../../data/network.js';

const DL_INTERVALS = [30, 60, 180];
const SCAN_FRESH_MS = 5 * 60 * 1000;
const bulkOpts = { unlockedMode: 'only', overwrite: false, includeUnowned: false, dlIntervalSec: 180 };
const QUEST_KINDS = new Set(['main', 'event']);
const UNLOCK_LABELS = {
  character: ['ストーリー解放', '全解放のみ', '全解放を優先'],
  quest: ['クリア状況', '全クリアのみ', '全クリアを優先'],
};
const PHASE_LABEL = { running: '実行中', done: '完了', stopped: '停止', error: 'エラー' };
let _bulkTick = null;
let _starting = false;
let _startCancelled = false;
let _latestBulkMissingSummary = null;

async function storyCompleteKeys() {
  try {
    await pendingScan();
  } catch (e) {}
  const at = lastScanAt();
  if (!at || Date.now() - at > SCAN_FRESH_MS) return null;
  const arr = Array.isArray(playerState.dl) ? playerState.dl : [];
  return arr.filter((x) => x && x.counts && x.counts.total > 0 && x.counts.have >= x.counts.total).map((x) => String(x.folderKey));
}

function setStartingUi(on) {
  _starting = on;
  const startBtn = getById('bulkStart'),
    stopBtn = getById('bulkStop'),
    clearBtn = getById('bulkClear');
  if (!startBtn) return;
  startBtn.disabled = on;
  if (on) {
    startBtn.innerHTML = '<span class="dlspin"></span>準備中…';
    if (stopBtn) stopBtn.style.display = '';
    if (clearBtn) clearBtn.style.display = 'none';
  } else {
    startBtn.textContent = '開始';
  }
}
const assetStatusText = (it) =>
  it.status === 'skipped'
    ? it.skipReason === 'story-missing'
      ? 'ストーリー情報が無く未処理'
      : '変更なし'
    : it.status === 'done'
      ? `${it.have || 0}/${it.total || 0}話${it.partial ? '（うち途中' + it.partial + '）' : ''}・音声${it.voiced || 0}・背景${it.bg || 0}${it.missing ? '・データ無し' + it.missing : ''}${it.fails ? '・失敗' + it.fails : ''}`
      : it.status === 'dl'
        ? 'ダウンロード中…'
        : it.status === 'failed'
          ? it.error || '失敗'
          : '';
const assetDetailText = (it) => (it.status === 'skipped' ? '' : it.status === 'done' ? `資産${it.assetCats || 0}種・立ち絵${it.cast || 0}` : '');

export function seg(id, val, onPick) {
  const wrap = getById(id);
  if (!wrap) return;
  wrap.querySelectorAll('.sg').forEach((b) => {
    b.classList.toggle('active', b.dataset.v === String(val));
    b.onclick = () => {
      wrap.querySelectorAll('.sg').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      onPick(b.dataset.v);
    };
  });
}

async function collectBulkCandidates() {
  const rosterKind = playerState.rosterKind;
  let items = [];
  try {
    items = await collectionRepository.rosterItems(rosterKind, { dl: playerState.dl, distSet: playerState.binlistScenes || new Set() });
  } catch (e) {}
  const list = [];
  for (const it of items) {
    const base = { id: it.folderKey, name: it.displayName, rosterKind: it.rosterKind };
    const storyFull = episodeCounts.storyFull(it);
    if (rosterKind === 'character') {
      if (!it.owned) {
        if (episodeCounts.distOnly(it)) list.push({ ...base, total: it.counts.total, full: true, dist: true });
        else if (bulkOpts.includeUnowned) list.push({ ...base, total: it.counts.total, full: false, unowned: true });
        continue;
      }
      if (bulkOpts.unlockedMode === 'only' && !storyFull) continue;
      list.push({ ...base, total: it.counts.total, full: storyFull });
    } else {
      const avail = episodeCounts.availableCount(it);
      if (!avail) continue;
      if (QUEST_KINDS.has(rosterKind) && bulkOpts.unlockedMode === 'only' && !storyFull) continue;
      list.push({ ...base, total: avail, full: storyFull });
    }
  }
  const byName = (a, b) => (a.name > b.name ? 1 : -1);
  const cmp = QUEST_KINDS.has(rosterKind) ? questSort.byQuestId((x) => x.id) : byName;
  if (bulkOpts.unlockedMode === 'priority' && rosterKind !== 'special') list.sort((a, b) => Number(b.full) - Number(a.full) || cmp(a, b));
  else list.sort(cmp);
  return list;
}

function persistBulkOpts() {
  try {
    chrome.storage.local.set({ bulkOpts });
  } catch (e) {}
}

export async function refreshBulkTarget() {
  const target = getById('bulkTarget');
  if (!target) return;
  const st = await bulkDownloader.getState();
  if (st && bulkDownloader.isActive(st.phase)) {
    target.textContent = '';
    return;
  }
  const list = await collectBulkCandidates();
  playerState._bulkCandidates = list;
  const unownedN = list.filter((x) => x.unowned).length;
  let note = '';
  if (playerState.rosterKind === 'character') {
    note = unownedN ? `（うち未所持 ${unownedN}体は立ち絵などのみ）` : '';
  } else if (QUEST_KINDS.has(playerState.rosterKind)) {
    note = bulkOpts.unlockedMode === 'only' ? '（全クリアのみ）' : `（うち全クリア ${list.filter((x) => x.full).length}件）`;
  }
  target.textContent = `対象 ${list.length} 件${note}`;
}

export async function openBulk() {
  try {
    const o = (await chrome.storage.local.get('bulkOpts')).bulkOpts;
    if (o) Object.assign(bulkOpts, o);
    if (!DL_INTERVALS.includes(bulkOpts.dlIntervalSec)) bulkOpts.dlIntervalSec = 180;
  } catch (e) {}
  getById('bulkTitle').textContent = `一括ダウンロード（${TYPE_LABEL[playerState.rosterKind] || ''}）`;
  const isChar = playerState.rosterKind === 'character';
  const isQuest = QUEST_KINDS.has(playerState.rosterKind);
  const unlockRow = getById('bulkUnlockRow');
  unlockRow.style.display = isChar || isQuest ? '' : 'none';
  if (isChar || isQuest) {
    const [rowLabel, only, priority] = UNLOCK_LABELS[isChar ? 'character' : 'quest'];
    unlockRow.querySelector('.optlbl').textContent = rowLabel;
    const segs = unlockRow.querySelectorAll('.sg');
    if (segs[0]) segs[0].textContent = only;
    if (segs[1]) segs[1].textContent = priority;
  }
  getById('bulkUnownedRow').style.display = isChar ? '' : 'none';
  seg('bulkUnlock', bulkOpts.unlockedMode, (v) => {
    bulkOpts.unlockedMode = v;
    persistBulkOpts();
    refreshBulkTarget();
  });
  seg('bulkUnowned', bulkOpts.includeUnowned ? '1' : '0', (v) => {
    bulkOpts.includeUnowned = v === '1';
    persistBulkOpts();
    refreshBulkTarget();
  });
  seg('bulkOverwrite', bulkOpts.overwrite ? '1' : '0', (v) => {
    bulkOpts.overwrite = v === '1';
    persistBulkOpts();
  });
  seg('bulkInterval', String(bulkOpts.dlIntervalSec || 180), (v) => {
    bulkOpts.dlIntervalSec = parseInt(v, 10) || 180;
    persistBulkOpts();
  });
  getById('bulkModal').style.display = '';
  await refreshBulkTarget();
  await renderBulkCard();
  rescanAll()
    .then(() => refreshBulkTarget())
    .catch(() => {});
}
export function closeBulk() {
  getById('bulkModal').style.display = 'none';
}

export async function stopBulk() {
  if (_starting) _startCancelled = true;
  await bulkDownloader.stop();
}

export async function startBulk() {
  if (_starting) return;
  if (getSingleDlActive()) {
    toast('個別ダウンロードの実行中は一括ダウンロードができません。', 'err');
    return;
  }
  _startCancelled = false;
  setStartingUi(true);
  let r = null;
  try {
    if (!(await ensureUserState({ onDemand: true }))) return;
    const list = playerState._bulkCandidates || (await collectBulkCandidates());
    if (!list.length) {
      toast('対象が0件です', 'err');
      return;
    }
    const root = fileStore && fileStore.supported ? await fileStore.ensure() : null;
    if (!root) {
      toast('先に保存先フォルダを選んでください', 'err');
      return;
    }
    const have = bulkOpts.overwrite ? null : await storyCompleteKeys();
    r = _startCancelled ? { ok: false, reason: 'stopped' } : await bulkDownloader.start(list, { overwrite: bulkOpts.overwrite, dlIntervalSec: bulkOpts.dlIntervalSec || 180, have });
  } finally {
    setStartingUi(false);
    await renderBulkCard();
  }
  if (!r.ok) {
    if (r.reason === 'stopped') toast('開始前に停止しました');
    else toast(r.reason === 'active' ? '既に実行中です' : '開始できませんでした', 'err');
  }
}

let _bulkFailureButtons = null;
const SUMMARY_TTL_MS = 5000;
let _summaryAt = 0;
let _summaryCache = null;
let _failSig = '';

async function missingSummaries(force) {
  if (!force && _summaryCache && Date.now() - _summaryAt < SUMMARY_TTL_MS) return _summaryCache;
  let mv = null,
    ms = null;
  try {
    mv = await assetAcquirer.cdnMissingSummary();
  } catch (e) {}
  try {
    ms = await assetAcquirer.missingScenesSummary();
  } catch (e) {}
  _summaryCache = { mv, ms };
  _summaryAt = Date.now();
  return _summaryCache;
}

async function renderBulkFailures(st, opts) {
  const wrap = getById('bulkFailWrap'),
    sum = getById('bulkFailSummary'),
    list = getById('bulkFailList');
  if (!wrap) return;
  const { mv, ms } = await missingSummaries(!!(opts && opts.force));
  _latestBulkMissingSummary = mv;
  const voiceRows = (mv && mv.rows) || [];
  const sceneRows = (ms && ms.rows) || [];
  const detailRows = ((st && st.failures) || []).filter((f) => f.report && f.report.total);
  if (!voiceRows.length && !sceneRows.length && !detailRows.length) {
    wrap.style.display = 'none';
    list.innerHTML = '';
    _bulkFailureButtons = null;
    _latestBulkMissingSummary = null;
    _failSig = '';
    return;
  }
  wrap.style.display = '';
  const sig = `${voiceRows.length}|${(mv && mv.scenes) || 0}|${sceneRows.length}|${(ms && ms.scenes) || 0}|${((st && st.failures) || []).length}`;
  if (sig === _failSig && list.querySelector('.bk-fail')) return;
  _failSig = sig;
  const parts = [];
  if (voiceRows.length) parts.push(`ボイス欠落 ${mv.chars}キャラ/${mv.stories}話/${mv.scenes}scene（URL${mv.withUrl}）`);
  if (sceneRows.length) parts.push(`台本欠落 ${ms.chars}キャラ/${ms.stories}話/${ms.scenes}scene`);
  sum.textContent = parts.join(' ・ ');

  if (!_bulkFailureButtons) {
    const copyBtn = el('button', {
      class: 'bk-failbtn',
      text: '欠損ボイスURLをコピー',
      on: {
        click: async () => {
          const latest = _latestBulkMissingSummary;
          const urls = [];
          for (const c of Object.values((latest && latest.data && latest.data.chars) || {}))
            for (const s of Object.values(c.stories || {})) for (const sc of Object.values(s.scenes || {})) if (sc.url) urls.push(sc.url);
          try {
            await navigator.clipboard.writeText(urls.join('\n'));
            copyBtn.textContent = `コピー済 ${urls.length}件`;
          } catch (e) {
            copyBtn.textContent = 'コピー失敗';
          }
        },
      },
    });
    const clrBtn = el('button', {
      class: 'bk-failbtn',
      text: 'クリア',
      on: {
        click: async () => {
          await assetAcquirer.clearCdnMissing();
          await assetAcquirer.clearMissingScenes();
          await renderBulkFailures(st, { force: true });
        },
      },
    });
    _bulkFailureButtons = { bar: el('div', 'bk-failbar', [copyBtn, clrBtn]) };
  }

  const existingBar = list.querySelector('.bk-failbar');
  if (existingBar) existingBar.remove();
  list.appendChild(_bulkFailureButtons.bar);

  list.querySelectorAll('.bk-fail').forEach((row) => row.remove());

  const rowText = (r, kind) => `${r.name || r.folderKey}${r.title || ''}｜${r.label || r.epId}${r.epTitle ? '「' + r.epTitle + '」' : ''}｜${kind} ${r.scenes}scene`;
  for (const [rows, kind] of [
    [voiceRows, 'ボイス欠落'],
    [sceneRows, '台本欠落'],
  ]) {
    for (const r of rows) list.appendChild(el('div', 'bk-fail soft', rowText(r, kind)));
  }
  for (const f of (st && st.failures) || []) {
    for (const g of failureGroups(f.report)) {
      list.appendChild(el('div', 'bk-fail soft', `${f.name}｜${g.label} ${g.count}件`));
      for (const item of g.items) list.appendChild(el('div', 'bk-fail dim', `　・${item}`));
      if (g.more) list.appendChild(el('div', 'bk-fail dim', `　…ほか${g.more}件`));
    }
  }
}

function metaCell(it) {
  if (it.gd === 'skipped') return { text: 'スキップ', cls: 'skip' };
  if (it.gd === 'failed') return { text: '取得失敗', cls: 'bad' };
  if (it.gd === 'partial') return { text: `一部 ${it.gdGot || 0}/${it.gdNeed || 0}`, cls: 'warn' };
  if (it.gd === 'pending') return { text: it.gdNeed ? `${it.gdGot || 0}/${it.gdNeed}` : '待機', cls: '' };
  return { text: it.gdNeed ? `${it.gdGot || 0}/${it.gdNeed}` : 'スキップ', cls: it.gdNeed ? '' : 'skip' };
}

function createBulkRow(it) {
  const { text: metaText, cls: metaCls } = metaCell(it);
  const tr = el('tr', {
    class: 'bkrow ' + it.status,
    data: { itemId: it.id },
    html: html`<td class="bk-name"></td>
      <td class="bk-meta ${metaCls}">${metaText}</td>
      <td class="bk-asset dim">${assetStatusText(it)}</td>
      <td class="bk-detail dim">${assetDetailText(it)}</td>`,
  });
  tr.querySelector('.bk-name').textContent = it.name;
  return tr;
}

function cardParts(card) {
  let head = card.querySelector('.bk-head');
  if (!head) {
    card.textContent = '';
    head = el('div', { class: 'bk-line bk-head', html: '<span class="dlspin"></span><span class="bk-phase"></span><span class="bk-count"></span>' });
    card.appendChild(head);
    card.appendChild(el('div', 'bk-rest'));
  }
  return { spin: head.querySelector('.dlspin'), phase: head.querySelector('.bk-phase'), count: head.querySelector('.bk-count'), rest: card.querySelector('.bk-rest') };
}

export async function renderBulkCard() {
  const st = await bulkDownloader.getState();
  const card = getById('bulkCard'),
    startBtn = getById('bulkStart'),
    stopBtn = getById('bulkStop'),
    clearBtn = getById('bulkClear'),
    tbody = getById('bulkTable').querySelector('tbody');
  if (!st) {
    card.style.display = 'none';
    startBtn.style.display = '';
    stopBtn.style.display = _starting ? '' : 'none';
    if (clearBtn) clearBtn.style.display = 'none';
    tbody.innerHTML = '';
    await renderBulkFailures(null);
    return;
  }
  const active = bulkDownloader.isActive(st.phase);
  const busy = active || _starting;
  const s = bulkDownloader.stats(st.items);
  const gd = st.gd || { total: 0, done: 0, failed: 0 };
  startBtn.style.display = active ? 'none' : '';
  startBtn.disabled = _starting;
  stopBtn.style.display = busy ? '' : 'none';
  if (clearBtn) clearBtn.style.display = busy ? 'none' : '';
  await renderBulkFailures(st);
  card.style.display = '';

  const parts = cardParts(card);
  parts.spin.style.display = active ? '' : 'none';
  parts.phase.className = 'bk-phase ' + st.phase;
  parts.phase.textContent = PHASE_LABEL[st.phase] || '';
  parts.count.textContent = ` ${s.processed}/${s.total}${s.running ? '（DL中' + s.running + '）' : ''}`;

  const rows = [];
  rows.push(
    `<div class="bk-line dim">ストーリー情報 ${gd.done}/${gd.total}${gd.failed ? '（失敗' + gd.failed + '）' : ''}｜本文・画像・音声 取得済み${s.done} / スキップ${s.skipped} / 失敗${s.failed}</div>`,
  );
  if (active) {
    let slotB = '';
    if (st.nextDlAt && st.nextDlAt > Date.now()) {
      const sec = Math.ceil((st.nextDlAt - Date.now()) / 1000);
      slotB = `次のDLまで ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    } else if (st.gdStatus && st.currentStatus) {
      slotB = st.gdStatus;
    }
    const slotA = st.currentStatus || st.gdStatus || '';
    rows.push(html`<div class="bk-line dim bk-slot">${slotA}</div>`);
    rows.push(html`<div class="bk-line dim bk-slot">${slotB}</div>`);
  }
  const fbs = networkClient.fallbackStats ? networkClient.fallbackStats() : null;
  if (fbs && (fbs.hit || fbs.off)) rows.push(`<div class="bk-line dim">旧世代から救済 ${fbs.hit}件${fbs.off ? '（効果が無いため打ち切り）' : ''}</div>`);
  if (st.phase === 'error' && st.lastError) rows.push(html`<div class="bk-line err">エラー: ${st.lastError}</div>`);
  if (st.tokenError) rows.push(`<div class="bk-line err">トークンが切れているためシナリオのDLができません。ゲームと再接続してください。</div>`);
  parts.rest.innerHTML = rows.join('');

  const existingRows = Array.from(tbody.querySelectorAll('tr'));
  const existingMap = new Map(existingRows.map((r) => [r.dataset.itemId, r]));

  for (let i = 0; i < st.items.length; i++) {
    const it = st.items[i];
    const existing = existingMap.get(it.id);

    if (existing) {
      existing.className = 'bkrow ' + it.status;
      const tds = existing.querySelectorAll('td');
      const { text: metaText, cls: metaCls } = metaCell(it);
      const assetText = assetStatusText(it);
      const detailText = assetDetailText(it);
      tds[1].className = `bk-meta ${metaCls}`;
      tds[1].textContent = metaText;
      tds[2].textContent = assetText;
      tds[3].textContent = detailText;
      existingMap.delete(it.id);
    } else {
      tbody.appendChild(createBulkRow(it));
    }
  }

  for (const orphan of existingMap.values()) orphan.remove();
}

function bannerPhase(st) {
  const items = st.items || [];
  const now = items.find((it) => it.status === 'dl');
  if (now) return `DL中…（${now.name}）`;
  const next = items.find((it) => it.status === 'pending');
  return next ? `待機中…（NEXT：${next.name}）` : '待機中…';
}

function buildBanner(banner) {
  banner.innerHTML = `<span class="bkdot"></span><span class="bktxt"></span><button class="btn xs" id="bulkBannerStop">停止</button>`;
  banner.querySelector('.bktxt').addEventListener('click', openBulk);
  banner.querySelector('.bkdot').addEventListener('click', openBulk);
  banner.querySelector('#bulkBannerStop').addEventListener('click', (e) => {
    e.stopPropagation();
    bulkDownloader.stop();
  });
}

export async function renderBulkBanner() {
  const banner = getById('bulkStatus');
  if (!banner) return;
  const st = await bulkDownloader.getState();
  if (!st || !bulkDownloader.isActive(st.phase)) {
    banner.style.display = 'none';
    if (banner.firstChild) banner.innerHTML = '';
    return;
  }
  if (!banner.querySelector('.bktxt')) buildBanner(banner);
  const s = bulkDownloader.stats(st.items);
  banner.style.display = '';
  banner.querySelector('.bktxt').textContent = `一括ダウンロード中 ${s.processed}/${s.total} ${bannerPhase(st)}`;
}

export function ensureBulkTick(on) {
  if (on && !_bulkTick)
    _bulkTick = setInterval(() => {
      renderBulkBanner();
      const modal = getById('bulkModal');
      if (modal && modal.style.display !== 'none') renderBulkCard();
    }, 1000);
  else if (!on && _bulkTick) {
    clearInterval(_bulkTick);
    _bulkTick = null;
  }
}
