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

const DL_INTERVALS = [30, 60, 180];
const bulkOpts = { unlockedMode: 'only', overwrite: false, includeUnowned: false, dlIntervalSec: 180 };
const QUEST_KINDS = new Set(['main', 'event']);
const UNLOCK_LABELS = {
  character: ['ストーリー解放', '全解放のみ', '全解放を優先'],
  quest: ['クリア状況', '全クリアのみ', '全クリアを優先'],
};
const PHASE_LABEL = { running: '実行中', done: '完了', stopped: '停止', error: 'エラー' };
let _bulkTick = null;
let _latestBulkMissingSummary = null;
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
    target.textContent = '実行中（対象は開始時に確定済み）';
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
}
export function closeBulk() {
  getById('bulkModal').style.display = 'none';
}

export async function startBulk() {
  if (getSingleDlActive()) {
    toast('個別ダウンロードの実行中は一括ダウンロードができません。', 'err');
    return;
  }
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
  const r = await bulkDownloader.start(list, { overwrite: bulkOpts.overwrite, dlIntervalSec: bulkOpts.dlIntervalSec || 180 });
  if (!r.ok) {
    toast(r.reason === 'active' ? '既に実行中です' : '開始できませんでした', 'err');
    return;
  }
  await renderBulkCard();
}

let _bulkFailureButtons = null;

async function renderBulkFailures(st) {
  const wrap = getById('bulkFailWrap'),
    sum = getById('bulkFailSummary'),
    list = getById('bulkFailList');
  if (!wrap) return;
  let mv = null,
    ms = null;
  try {
    mv = await assetAcquirer.cdnMissingSummary();
  } catch (e) {}
  try {
    ms = await assetAcquirer.missingScenesSummary();
  } catch (e) {}
  _latestBulkMissingSummary = mv;
  const voiceRows = (mv && mv.rows) || [];
  const sceneRows = (ms && ms.rows) || [];
  const detailRows = ((st && st.failures) || []).filter((f) => f.report && f.report.total);
  if (!voiceRows.length && !sceneRows.length && !detailRows.length) {
    wrap.style.display = 'none';
    list.innerHTML = '';
    _bulkFailureButtons = null;
    _latestBulkMissingSummary = null;
    return;
  }
  wrap.style.display = '';
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
          await renderBulkFailures(st);
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
    stopBtn.style.display = 'none';
    if (clearBtn) clearBtn.style.display = 'none';
    tbody.innerHTML = '';
    await renderBulkFailures(null);
    return;
  }
  const active = bulkDownloader.isActive(st.phase);
  const s = bulkDownloader.stats(st.items);
  const gd = st.gd || { total: 0, done: 0, failed: 0 };
  startBtn.style.display = active ? 'none' : '';
  startBtn.disabled = false;
  stopBtn.style.display = active ? '' : 'none';
  if (clearBtn) clearBtn.style.display = active ? 'none' : '';
  await renderBulkFailures(st);
  card.style.display = '';

  const rows = [];
  rows.push(`<div class="bk-line"><span class="bk-phase ${st.phase}">${PHASE_LABEL[st.phase] || ''}</span> ${s.processed}/${s.total}${s.running ? '（DL中' + s.running + '）' : ''}</div>`);
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
  if (st.phase === 'error' && st.lastError) rows.push(html`<div class="bk-line err">エラー: ${st.lastError}</div>`);
  if (st.tokenError) rows.push(`<div class="bk-line err">トークンが切れているためシナリオのDLができません。ゲームと再接続してください。</div>`);
  card.innerHTML = rows.join('');

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

export async function renderBulkBanner() {
  const st = await bulkDownloader.getState();
  const banner = getById('bulkStatus');
  if (!banner) return;
  if (!st || !bulkDownloader.isActive(st.phase)) {
    banner.style.display = 'none';
    banner.innerHTML = '';
    return;
  }
  const s = bulkDownloader.stats(st.items);
  const gd = st.gd || { total: 0, done: 0 };
  banner.style.display = '';
  banner.innerHTML = `<span class="bkdot"></span><span class="bktxt"></span><button class="btn xs" id="bulkBannerStop">停止</button>`;
  banner.querySelector('.bktxt').textContent = `一括ダウンロード中 ${s.processed}/${s.total} ${bannerPhase(st)}`;
  banner.querySelector('.bktxt').addEventListener('click', openBulk);
  banner.querySelector('.bkdot').addEventListener('click', openBulk);
  banner.querySelector('#bulkBannerStop').addEventListener('click', (e) => {
    e.stopPropagation();
    bulkDownloader.stop();
  });
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
