import { assetAcquirer } from '../../data/acquire/acquire-assemble.js';
import { collectionRepository } from '../../data/collection.js';
import { errText, LOW_QUALITY_INDEX, pinnedBaseStale } from '../../core/messages.js';
import { SK } from '../../core/constants.js';
import { getById, el, append } from '../../core/dom.js';
import { toast } from '../ui/notifier.js';
import { refreshLists } from '../runtime/state-refresh.js';
import { idbStore } from '../../core/idb.js';
import { renderStorageSummary } from './storage-summary.js';

const _busy = new Set();
let _rows = [];
let _dirty = true;
let _bound = false;

function syncRowButtons() {
  for (const r of _rows) {
    const blocked = _busy.size > 0 && !_busy.has(r.key);
    r.btn.disabled = blocked || r.stopping();
    r.btn.title = blocked ? '他のダウンロードが終わってから実行できます' : '';
  }
}

export function markDownloadSectionDirty() {
  _dirty = true;
}

function bindOpen(sec) {
  if (_bound || !sec) return;
  _bound = true;
  sec.addEventListener('toggle', () => {
    if (sec.open && _dirty) refreshDownloadSection().catch(() => {});
  });
}

const PHANTOM_KEY = 'dlPhantoms';
let _phantoms = null;
async function phantoms() {
  if (!_phantoms) _phantoms = (await idbStore.get(PHANTOM_KEY)) || {};
  return _phantoms;
}
async function setPhantom(key, n) {
  const map = await phantoms();
  map[key] = n;
  await idbStore.set(PHANTOM_KEY, map);
}

const purgedText = (r) => (r && r.purged ? `・壊れた分を削除${r.purged}件` : '');
const summary = (r) => `新規${r.got}件` + (r.skip != null ? `・既にあった分${r.skip}件` : '') + (r.missing ? `・データ無し${r.missing}件` : '') + (r.fail ? `・失敗${r.fail}件` : '') + purgedText(r);

const fromStatus = (st) => ({ have: (st.have ? st.have.size : 0) + (st.haveFiles ? st.haveFiles.size : 0), total: st.total || 0 });

async function lowQualityRow() {
  try {
    const idx = await collectionRepository.ensureIndexes();
    if (!idx || !idx.meta || idx.meta.altRelCount !== 0) return null;
  } catch (e) {
    return null;
  }
  return el('div', 'dlrow', el('div', 'note warn', LOW_QUALITY_INDEX));
}

async function pinnedBaseRow() {
  try {
    const o = await chrome.storage.local.get([SK.assetRootManual, SK.assetRootEnv]);
    const manual = (o[SK.assetRootManual] || '').replace(/\/+$/, '');
    const env = (o[SK.assetRootEnv] || '').replace(/\/+$/, '');
    if (!manual || !env || manual === env) return null;
    return el('div', 'dlrow', el('div', 'note warn', pinnedBaseStale(manual, env)));
  } catch (e) {
    return null;
  }
}

const JOBS = [
  {
    key: 'shared',
    label: '共有リソース',
    hint: '背景・BGM・SE・フォント・演出・アイテムアイコン。物語再生に必須',
    run: (onProgress, opts) => assetAcquirer.runSharedResourceDownload(onProgress, opts),
    status: () => assetAcquirer.sharedStatus(),
  },
  {
    key: 'home',
    label: 'ホーム',
    hint: 'シーンイラスト・1コマ漫画・BGM・ホーム背景・プロフィールアイコン',
    run: (onProgress, opts) => assetAcquirer.collectHome(onProgress, null, opts),
    done: (r) => `新規${r.got}件・既にあった分${r.skip}件` + (r.miss ? `・データ無し${r.miss}件` : '') + purgedText(r),
    status: () => collectionRepository.homeAssetStatus(),
  },
  {
    key: 'other3d',
    label: 'その他3D',
    hint: 'モンスター以外の3Dモデル（ボス・武器など）',
    run: (onProgress, opts) => assetAcquirer.runOther3dDownload(onProgress, opts),
    status: async () => fromStatus(await collectionRepository.other3dStatus()),
  },
  {
    key: 'other2d',
    label: 'その他2D',
    hint: 'カードにならない立ち絵とアイコン',
    run: async (onProgress, opts) => {
      const st = await collectionRepository.other2dStatus();
      return assetAcquirer.runOther2dDownload(st.refs, onProgress, opts);
    },
    status: async () => fromStatus(await collectionRepository.other2dStatus()),
  },
  {
    key: 'monster',
    label: 'モンスター',
    hint: '図鑑の3Dモデル・立ち絵・アイコン',
    run: (onProgress, opts) => assetAcquirer.runMonsterDownload(onProgress, opts),
    status: async () => fromStatus(await collectionRepository.monsterStatus()),
  },
];

function badgeText(have, total, phantom) {
  const ph = phantom || 0;
  const missing = Math.max(0, total - have - ph);
  if (!total) return { cls: 'dim', text: '—' };
  if (have <= 0) return { cls: 'no', text: '未取得' };
  if (missing <= 0) return { cls: 'ok', text: have >= total ? '✓ 取得済み' : `✓ 取得済み（欠品${total - have}）` };
  return { cls: 'part', text: `一部 ${have}/${total}` };
}

function paint(badge, spin, have, total, phantom, running) {
  const b = badgeText(have, total, phantom);
  badge.className = 'dlbadge ' + b.cls;
  badge.textContent = b.text;
  spin.style.display = running ? '' : 'none';
}

function markChecking(badge, spin) {
  badge.className = 'dlbadge dim';
  badge.textContent = '確認中…';
  spin.style.display = '';
}

async function paintFromStatus(job, badge, spin) {
  if (!job.status) return null;
  markChecking(badge, spin);
  try {
    const [st, map] = [await job.status(), await phantoms()];
    paint(badge, spin, st.have, st.total, map[job.key], false);
    return st;
  } catch (e) {
    paint(badge, spin, 0, 0, 0, false);
    return null;
  }
}

function jobRow(job) {
  const note = el('span', 'note dim');
  const spin = el('span', { class: 'dlspin', style: { display: 'none' } });
  const badge = el('span', 'dlbadge dim');
  let stopReq = false;
  let running = false;
  const btn = el('button', {
    class: 'btn xs',
    text: '取得',
    on: {
      click: async () => {
        if (running) {
          stopReq = true;
          btn.textContent = '停止中…';
          syncRowButtons();
          return;
        }
        running = true;
        _busy.add(job.key);
        stopReq = false;
        btn.textContent = '停止';
        btn.classList.add('rec');
        syncRowButtons();
        markChecking(badge, spin);
        note.textContent = '保存済みを確認しています…';
        await new Promise((r) => requestAnimationFrame(r));
        let base = 0;
        let total = 0;
        try {
          const st0 = job.status ? await job.status() : null;
          if (st0) {
            base = st0.have || 0;
            total = st0.total || 0;
          }
        } catch (e) {}
        try {
          const r = await job.run(
            (m, f, c) => {
              note.textContent = m;
              if (c) paint(badge, spin, base + (c.got || 0), total, 0, true);
            },
            { shouldAbort: () => stopReq },
          );
          note.textContent = (r && r.stopped ? '停止しました｜' : '') + (job.done || summary)(r);
          toast(`${job.label}${r && r.stopped ? 'を停止しました' : 'を取得しました'}（${(job.done || summary)(r)}）`, r && (r.fail || r.stopped) ? 'err' : 'ok');
          await refreshLists(['fs']);
          if (job.status) {
            try {
              const st = await job.status();
              if (r && !r.stopped && !r.fail) await setPhantom(job.key, Math.max(0, (st.total || 0) - (st.have || 0)));
              paint(badge, spin, st.have, st.total, (await phantoms())[job.key], false);
            } catch (e) {
              await paintFromStatus(job, badge, spin);
            }
          }
        } catch (e) {
          note.textContent = errText(e);
          toast(`${job.label}のダウンロードを中断しました。` + errText(e), 'err');
          await paintFromStatus(job, badge, spin);
        } finally {
          running = false;
          _busy.delete(job.key);
          stopReq = false;
          spin.style.display = 'none';
          btn.textContent = '取得';
          btn.classList.remove('rec');
          syncRowButtons();
        }
      },
    },
  });
  _rows.push({ key: job.key, btn, stopping: () => stopReq });
  paintFromStatus(job, badge, spin);
  return el('div', 'dlrow', [el('div', 'dlrow-head', [el('span', 'dlrow-label', job.label), spin, badge, btn]), el('div', 'note dim', job.hint), note]);
}

function indexRow(onBuilt, rebuild) {
  const note = el('span', 'note dim');
  const btn = el('button', {
    class: rebuild ? 'btn xs' : 'btn xs primary',
    text: rebuild ? '索引を作り直す' : '索引を作成',
    on: {
      click: async () => {
        btn.disabled = true;
        try {
          const run = rebuild ? collectionRepository.rebuildIndexes : collectionRepository.ensureIndexes;
          await run((m) => {
            note.textContent = m;
          });
          toast(rebuild ? '索引を作り直しました。' : '索引を作成しました。', 'ok');
          await refreshLists(['fs', 'index', 'dl']);
          await onBuilt();
          if (rebuild) await renderStorageSummary();
        } catch (e) {
          note.textContent = errText(e);
        } finally {
          btn.disabled = false;
        }
      },
    },
  });
  if (rebuild) return el('div', 'dlrow', [el('div', 'dlrow-head', [btn]), note]);
  return el('div', 'dlrow', [el('div', 'note', 'どこに何があるかの索引がまだありません。保存先に masterdata.bin があれば接続なしで作れます。'), el('div', 'dlrow-head', [btn]), note]);
}

export function renderIndexRebuild() {
  const host = getById('indexRebuildHost');
  if (!host) return;
  host.innerHTML = '';
  host.appendChild(indexRow(refreshDownloadSection, true));
}

export async function refreshDownloadSection() {
  const host = getById('dlSectionBody');
  if (!host) return;
  const sec = getById('dlSection');
  bindOpen(sec);
  if (_busy.size) {
    _dirty = true;
    return;
  }
  if (sec && !sec.open) {
    _dirty = true;
    host.innerHTML = '';
    return;
  }
  _dirty = false;
  _rows = [];
  host.innerHTML = '';
  let ready = false;
  try {
    ready = await collectionRepository.indexReady();
  } catch (e) {}
  if (!ready) {
    host.appendChild(indexRow(refreshDownloadSection));
    return;
  }
  for (const row of [await pinnedBaseRow(), await lowQualityRow()]) if (row) host.appendChild(row);
  append(host, JOBS.map(jobRow));
  syncRowButtons();
}
