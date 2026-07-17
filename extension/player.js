'use strict';
(() => {
const CFG = globalThis.TP_CONFIG;
const COLLECTION = globalThis.TP_COLLECTION;
const BULK = globalThis.TP_BULK;
const IDB = globalThis.TP_IDB;
const FS = globalThis.TP_FS;
const D = globalThis.TP_DECODE;
const V = globalThis.TP_VISUAL;
const PLAYER_AUDIO = globalThis.TP_PLAYER_AUDIO;
const PLAYER_IMAGE = globalThis.TP_PLAYER_IMAGE;
const $ = (id) => document.getElementById(id);

// UIタブ種別（ロースター）。folderMeta.type は character/quest/special。questは dated で main/event に分岐。
const TYPE_LABEL = { character: 'キャラ', main: 'メイン', event: 'イベント', special: '特別' };
const catOf = (m) => (m && m.type === 'character') ? 'character' : (m && m.type === 'special') ? 'special' : (m && m.cat) ? m.cat : 'main';
const chip = (t) => (TYPE_LABEL[t] ? `<span class="chip ${t}">${TYPE_LABEL[t]}</span>` : '');
const nameFix = (s) => (s || '').replace(/%username%/g, '主人公');
// 検索正規化：カタカナ→ひらがな（ひらがな入力でカタカナ名を引ける）
const kanaKey = (s) => String(s || '').replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).toLowerCase();

const S = {
  dl: [], owned: new Map(), distScenes: new Set(), paidUnlocked: new Set(), clearedNodes: new Set(), fsGranted: false,
  rosterOpen: false, rosterType: 'character', rosterOwn: 'all', rosterGroup: '', rosterRank: '', cur: null,
  navId: null,
  scene: null, idx: 0, autoTimer: null, epVoiceUrls: null, extractedSids: null,
  imageAutoKey: null,
};

let imagePanel = null;
let audioPanel = null;
let letterPanel = null;

async function refreshLists() {
  S.fsGranted = false;
  if (FS && FS.supported) { try { S.fsGranted = (await FS.permission(false)) === 'granted'; } catch (e) {} }
  updateFsUi();
  S.dl = []; S.owned = new Map();
  try { S.paidUnlocked = await COLLECTION.unlockedPaidSet(); } catch (e) { S.paidUnlocked = new Set(); }
  try { S.clearedNodes = await COLLECTION.clearedNodeSet(); } catch (e) { S.clearedNodes = new Set(); }
  if (S.fsGranted) {
    try { S.dl = await COLLECTION.scanFolder(); } catch (e) { console.error(e); }
    try { S.owned = await COLLECTION.ownedLevels(); } catch (e) {}
  }
  try { S.distScenes = await COLLECTION.distSceneSet(); } catch (e) { S.distScenes = new Set(); }
  await updateStorage();
  if (S.rosterOpen) await renderRoster();
}

function charHandle(folderKey) { const e = S.dl.find((x) => String(x.charId) === String(folderKey)); return e ? e.handle : null; }

function parseCharHash() {
  const raw = String(location.hash || '').replace(/^#/, '').trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return raw;
  let m = raw.match(/(?:^|[?&])(?:char|id)=(\d+)/i);
  if (m) return m[1];
  m = raw.match(/(?:char|id)[:=](\d+)/i);
  return m ? m[1] : null;
}

function pushCharHash(charId) {
  const next = '#' + String(charId || '');
  if (next === '#') return;
  if (location.hash === next) return; // hashchange経由（既にその値）なら履歴を積まない
  try { history.pushState(null, '', next); } catch (e) { location.hash = String(charId); }
}
function clearHash() {
  if (!location.hash) return;
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
}

function toast(msg, kind, opts) {
  opts = opts || {};
  let wrap = $('toastwrap');
  if (!wrap) { wrap = document.createElement('div'); wrap.id = 'toastwrap'; wrap.className = 'toastwrap'; document.body.appendChild(wrap); }
  const t = document.createElement('div'); t.className = 'toast' + (kind ? ' ' + kind : '');
  const span = document.createElement('span'); span.className = 'toastmsg'; span.textContent = msg; t.appendChild(span);
  const x = document.createElement('button'); x.className = 'toastx'; x.textContent = '×'; x.title = '閉じる'; t.appendChild(x);
  let closed = false;
  const close = () => { if (closed) return; closed = true; t.classList.remove('show'); setTimeout(() => t.remove(), 300); };
  x.addEventListener('click', close);
  wrap.appendChild(t);
  while (wrap.children.length > 4) wrap.firstChild.remove();
  requestAnimationFrame(() => t.classList.add('show'));
  const sticky = opts.sticky || kind === 'err';
  if (!sticky) setTimeout(close, opts.dur || 4500);
  return { close, el: t };
}

const EMPTY_IDLE = '「キャラ一覧」から選択してください。';
function showEmptyIdle() { const em = $('emptyMsg'); if (em) em.textContent = EMPTY_IDLE; $('empty').style.display = ''; }
function closeDetail() { $('detail').style.display = 'none'; S.cur = null; showEmptyIdle(); }

function resetVisualPanel() {
  if (V && V.disposeSpinePlayers) { try { V.disposeSpinePlayers(); } catch (e) {} }
  const imageHost = $('imageHost');
  if (imageHost) { imageHost.style.display = 'none'; imageHost.textContent = ''; }
  const spineHost = $('spineHost');
  if (spineHost) { spineHost.style.display = 'none'; spineHost.textContent = ''; }
}

function updateFsUi() {
  const info = $('fsInfo'), grant = $('fsGrant'), pick = $('fsPick'), dot = $('fsDot');
  if (!FS || !FS.supported) { info.textContent = '非対応ブラウザ（Chrome/Edge推奨）'; pick.style.display = 'none'; grant.style.display = 'none'; dot.className = 'fsdot'; return; }
  const name = FS.dirName();
  if (name && S.fsGranted) { info.textContent = name; dot.className = 'fsdot ok'; grant.style.display = 'none'; pick.style.display = ''; pick.textContent = '変更'; }
  else if (name) { info.textContent = `${name}（要再許可）`; dot.className = 'fsdot'; grant.style.display = ''; pick.style.display = 'none'; }
  else { info.textContent = '保存先フォルダ未選択'; dot.className = 'fsdot'; grant.style.display = 'none'; pick.style.display = ''; pick.textContent = '選ぶ'; }
}

const FS_UNSUPPORTED_MSG = 'この環境では保存先フォルダを使えません（File System Access API が無効）。Chrome / Edge を使うか、Brave の場合は brave://flags/#file-system-access-api を Enabled にして再起動してください。';
function fsPickErr(e) { return (e && e.fsUnsupported) ? FS_UNSUPPORTED_MSG : ('保存先フォルダを選べませんでした: ' + (e && e.message ? e.message : e)); }
async function pickFolder() {
  try { const h = await FS.pick(); if (h) { S.fsGranted = (await FS.permission(false)) === 'granted'; await refreshLists(); } return true; }
  catch (e) { toast(fsPickErr(e), 'err'); return false; }
}

async function updateStorage() {
  try { const est = await navigator.storage.estimate(); const mb = (n) => (n / 1048576).toFixed(0); $('storageInfo').textContent = `使用量 約${mb(est.usage || 0)}MB / ${mb(est.quota || 0)}MB`; } catch (e) { $('storageInfo').textContent = ''; }
}

async function updateConn() {
  const o = await chrome.storage.local.get(['capturing', 'captureLive', 'captureError', 'apiAuth', 'apiAuthBad']);
  const on = !!o.capturing, live = !!o.captureLive;
  const tok = o.apiAuth && o.apiAuth.authorization;
  const hasToken = !!(tok && tok !== o.apiAuthBad);
  const tokenBad = !!(tok && tok === o.apiAuthBad);
  const b = $('connToggle'); b.textContent = on ? '接続を解除' : 'ゲームと接続'; b.className = on ? 'btn rec' : 'btn primary'; b.dataset.on = on ? '1' : '';
  const ru = $('refreshUser'); if (ru) ru.style.display = hasToken ? '' : 'none';
  const el = $('connInfo');
  el.textContent = (on && !live) ? (o.captureError || 'ゲームタブ未接続（ライブのゲームを開く／DevToolsを閉じて再接続）') : '';
  // トークンの状態は接続状態とは独立に表示する（解除してもトークンは期限内なら生きていてDL可能）。
  let cls = null, label = null;
  if (on && live) {
    if (hasToken) { cls = 'ok'; label = 'トークン取得済み'; }
    else if (tokenBad) { cls = 'bad'; label = 'トークン切れ'; }
    else { cls = 'wait'; label = 'トークン待ち'; }
  } else if (hasToken) {
    cls = 'ok'; label = 'トークン有効（未接続でもDL可・期限切れまで）';
  } else if (tokenBad) {
    cls = 'bad'; label = 'トークン切れ（接続して取り直し）';
  }
  if (label) {
    const badge = document.createElement('span');
    badge.className = 'tokbadge ' + cls;
    badge.textContent = label;
    el.appendChild(document.createTextNode(' '));
    el.appendChild(badge);
  }
}

// 必要データ（当日トークン＋所持状況）が揃ったらゲームとの接続を自動解除する。
// 収集はトークン＋user取得だけで完結＝以後は接続維持不要。
// トークンは解除後も期限内なら有効でDL可能（updateConnがその旨を表示）。
let _autoDisc = false;
async function maybeAutoDisconnect() {
  if (_autoDisc) return;
  const o = await chrome.storage.local.get(['capturing', 'apiAuth', 'apiAuthBad']);
  if (!o.capturing) return;
  const tok = o.apiAuth && o.apiAuth.authorization;
  if (!(tok && tok !== o.apiAuthBad)) return;
  if (S.owned.size <= 0) return;
  _autoDisc = true;
  try { await chrome.runtime.sendMessage({ cmd: 'stop' }); } catch (e) {}
  await updateConn();
  toast('必要データ（トークン＋所持状況）を取得したので接続を自動解除しました。トークンは期限まで有効でDLできます。', 'ok', { dur: 6000 });
}

function twoStep(btn, label, action) {
  let armed = false, t = null;
  const reset = () => { armed = false; btn.textContent = label; btn.classList.remove('rec'); if (t) clearTimeout(t); };
  btn.textContent = label;
  btn.addEventListener('click', async () => { if (!armed) { armed = true; btn.textContent = 'もう一度で確定'; btn.classList.add('rec'); t = setTimeout(reset, 5000); return; } reset(); await action(); });
}

// グループ(勢力/国)・ランクのフィルタ選択肢を folderMeta から生成（ゲーム表示順・選択保持・キャラタブ時のみ表示）。
const GROUP_ORDER = ['リーニャ', 'テーセツ', 'ジャハラ', 'クォンツィ', 'ジェネラス', 'ペイシェ', 'ヒューム', 'アンノウン'];
const RANK_ORDER = ['UR', 'S', 'A', 'B'];
function fillSelect(selId, field, order, allLabel, cur, set) {
  const sel = $(selId); if (!sel) return;
  sel.style.display = S.rosterType === 'character' ? '' : 'none';
  const present = new Set(Object.values(_fm || {}).filter((m) => m.type === 'character' && m[field]).map((m) => m[field]));
  const opts = order.filter((v) => present.has(v)).concat([...present].filter((v) => !order.includes(v)));
  sel.innerHTML = '';
  const all = document.createElement('option'); all.value = ''; all.textContent = allLabel; sel.appendChild(all);
  for (const v of opts) { const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); }
  sel.value = opts.includes(cur) ? cur : '';
  if (sel.value !== cur) set(sel.value);
}
let _fm = {};
function populateFilterSelects(folderMeta) {
  _fm = folderMeta || {};
  fillSelect('rosterGroup', 'group', GROUP_ORDER, 'グループすべて', S.rosterGroup, (v) => (S.rosterGroup = v));
  fillSelect('rosterRank', 'rank', RANK_ORDER, 'ランクすべて', S.rosterRank, (v) => (S.rosterRank = v));
}

async function renderRoster() {
  const bulkBtn = $('bulkOpen'); if (bulkBtn) bulkBtn.textContent = `一括ダウンロード（${TYPE_LABEL[S.rosterType] || ''}）`;
  const grid = $('rosterGrid');
  if (!grid.children.length) grid.innerHTML = '<div class="loadspin"><span class="spin"></span><span class="loadtxt">読み込み中…</span></div>';
  let folderMeta = {}; try { ({ folderMeta } = await COLLECTION.indexes()); } catch (e) {}
  grid.innerHTML = '';
  populateFilterSelects(folderMeta);
  const capturing = !!(await chrome.storage.local.get('capturing')).capturing;
  const hasData = S.owned.size > 0 || S.dl.length > 0;
  // データ未取得（オンボーディング中）は一覧の操作系（検索/タブ/フィルタ/一括DL/共有DL）を隠す＝案内だけ出す
  const showControls = S.fsGranted && hasData;
  const setD = (id, v) => { const el = $(id); if (el) el.style.display = v; };
  if (!showControls) {
    for (const id of ['rosterSearch', 'rosterType', 'rosterOwn', 'rosterGroup', 'rosterRank', 'bulkOpen', 'sharedDl', 'rosterCount']) setD(id, 'none');
  } else {
    for (const id of ['rosterSearch', 'rosterType', 'bulkOpen', 'sharedDl', 'rosterCount']) setD(id, '');
    setD('rosterOwn', S.rosterType === 'character' ? '' : 'none'); // group/rank は populateFilterSelects が種別に応じ設定済み
  }
  if (!S.fsGranted || !hasData) grid.appendChild(buildOnboard(S.fsGranted, capturing, hasData));
  if (!S.fsGranted) { $('rosterCount').textContent = ''; return; }

  const model = await rosterModel(folderMeta);
  for (const g of model.groups) {
    if (!g.items.length) continue;
    const h = document.createElement('div'); h.className = 'rgroup'; h.textContent = `${g.title}（${g.items.length}）`; grid.appendChild(h);
    const wrap = document.createElement('div'); wrap.className = 'rostercards';
    g.items.forEach((it) => wrap.appendChild(rcard(it)));
    grid.appendChild(wrap);
  }
  $('rosterCount').textContent = model.count;
}

// 一覧の表示順（グループ+名前順+フィルタ/検索）を1箇所で計算。renderRosterと左右移動が共用し並びを一致。
async function rosterModel(folderMeta) {
  if (!folderMeta) { try { ({ folderMeta } = await COLLECTION.indexes()); } catch (e) { folderMeta = {}; } }
  const dlMap = new Map(S.dl.map((x) => [String(x.charId), x]));
  const type = S.rosterType, f = ($('rosterSearch').value || '').trim(), fk = kanaKey(f);
  const byName = (a, b) => (a.name > b.name ? 1 : -1);
  if (type === 'character') {
    const distSet = S.distScenes || new Set();
    const full = [], partial = [], unowned = []; let ownedCount = 0;
    for (const [id, m] of Object.entries(folderMeta)) {
      if (m.type !== 'character') continue;
      if (S.rosterGroup && (m.group || '') !== S.rosterGroup) continue;
      if (S.rosterRank && (m.rank || '') !== S.rosterRank) continue;
      const isOwned = S.owned.has(id); if (isOwned) ownedCount++;
      if (S.rosterOwn === 'owned' && !isOwned) continue;
      if (S.rosterOwn === 'unowned' && isOwned) continue;
      const name = (m.title ? m.name + m.title : m.name) || id;
      if (f && !kanaKey(name).includes(fk) && !String(id).includes(f)) continue;
      const level = isOwned ? S.owned.get(id) : null;
      const dl = dlMap.get(id);
      const total = (m.episodes || []).length;
      const distCov = isOwned ? 0 : COLLECTION.distEpisodesCovered(m, distSet);
      const distFull = !isOwned && total > 0 && distCov === total;
      const item = { id, name, level, unlocked: isOwned ? COLLECTION.unlockedCount(level) : 0, total, covered: dl ? dl.covered : (isOwned ? 0 : distCov), status: dl ? 'dl' : 'none', isOwned, dl, fullUnlocked: level != null && level >= 70, distFull };
      if (!isOwned) (distFull ? full : unowned).push(item);
      else if (item.fullUnlocked) full.push(item);
      else partial.push(item);
    }
    full.sort(byName); partial.sort(byName); unowned.sort(byName);
    return { type, groups: [
      { title: '★ 全ストーリー解放', items: full },
      { title: '解放途中（Lv70未満）', items: partial },
      { title: '未所持', items: unowned },
    ], count: `所持${ownedCount}体 / 全ストーリー${full.length}体` };
  }
  // 特別エピソード（tag145）＝解放制。解放済み(user PaidEpisode)分のみDL可。3分類(subType)で節分け。
  if (type === 'special') {
    const paid = S.paidUnlocked || new Set();
    const bySub = {};
    for (const [id, m] of Object.entries(folderMeta)) {
      if (m.type !== 'special') continue;
      if (f && !kanaKey(m.name || '').includes(fk) && !String(id).includes(f)) continue;
      const dl = dlMap.get(id);
      const unlockedAvail = (m.episodes || []).filter((e) => paid.has(String(e.paidMasterId))).length;
      const item = { id, name: m.name, level: null, unlocked: unlockedAvail, total: (m.episodes || []).length, covered: dl ? dl.covered : 0, status: dl ? 'dl' : 'none', isOwned: !!dl || unlockedAvail > 0, dl, special: true, unlockedAvail };
      (bySub[m.subType || '特別エピソード'] = bySub[m.subType || '特別エピソード'] || []).push(item);
    }
    const order = ['スペシャルエピソード', 'イベントエピソード', 'エクストラエピソード', '特別エピソード'];
    const subs = Object.keys(bySub).sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
    let n = 0, unl = 0; for (const s of subs) { n += bySub[s].length; unl += bySub[s].filter((x) => x.unlockedAvail > 0).length; }
    return { type, groups: subs.map((s) => ({ title: s, items: bySub[s].sort(byName) })), count: `特別エピソード ${n}件（解放制）${unl ? ` / 解放済み${unl}件DL可` : ' / 解放済み無し'}` };
  }
  // メイン／イベント（tag20 quest を EventType で分岐＝cat）。ゲーム表示順(order)で並べ、クリア進捗(user tag22)で解放/未開放を表示。
  const byOrder = (a, b) => (a.order - b.order) || (a.name > b.name ? 1 : -1);
  const cleared = S.clearedNodes || new Set();
  const done = [], progress = [], locked = []; let clearedCards = 0;
  for (const [id, m] of Object.entries(folderMeta)) {
    if (catOf(m) !== type) continue;
    if (f && !kanaKey(m.name).includes(fk) && !String(id).includes(f)) continue;
    const dl = dlMap.get(id);
    const eps = m.episodes || [];
    const clearedN = eps.filter((e) => cleared.has(String(e.id))).length;
    const total = eps.length;
    const fullCleared = total > 0 && clearedN === total;
    if (clearedN > 0) clearedCards++;
    const item = { id, name: m.name, order: m.order || 0, level: null, unlocked: clearedN, total, covered: dl ? dl.covered : 0, status: dl ? 'dl' : 'none', isOwned: clearedN > 0, dl, fullCleared };
    (fullCleared ? done : clearedN > 0 ? progress : locked).push(item);
  }
  done.sort(byOrder); progress.sort(byOrder); locked.sort(byOrder);
  return { type, groups: [
    { title: '★ 全クリア', items: done },
    { title: '進行中（クリア途中）', items: progress },
    { title: '未クリア', items: locked },
  ], count: `${TYPE_LABEL[type]} ${done.length + progress.length + locked.length}件 / クリア済み${clearedCards}件` };
}

function rcard(it) {
  const isCharacter = S.rosterType === 'character';
  const isQuest = S.rosterType === 'main' || S.rosterType === 'event';
  const card = document.createElement('div');
  card.className = 'rcard'
    + (it.isOwned ? '' : ' un')
    + (it.status === 'dl' ? ' dl' : '')
    + ((it.fullUnlocked || it.fullCleared) ? ' full' : '')
    + (it.distFull ? ' distfull' : '');
  // 状態ラベル：キャラ=Lv、メイン/イベント=クリア進捗、特別=解放状況
  let lv = '';
  if (isCharacter) lv = it.level != null ? `Lv${it.level}` : '未所持';
  else if (isQuest) lv = it.fullCleared ? '全クリア' : (it.unlocked > 0 ? `${it.unlocked}話クリア` : '未クリア');
  else if (it.special) lv = it.unlockedAvail > 0 ? '解放済み' : '未解放';
  const badge = it.status === 'dl' ? `<span class="rst dl">DL済 ${it.covered}話</span>` : (it.distFull ? '<span class="rst dist">シーン取得済</span>' : '');
  // 進捗＝分子:解放済み(キャラ)/クリア済み(メイン・イベント)/解放済み(特別)、分母:総話数。フル解放/全クリアで N/N。
  const total = it.total || 0;
  const num = isCharacter ? (it.isOwned ? it.unlocked : (it.covered || 0))
    : it.special ? (it.unlockedAvail || 0) : (it.unlocked || 0);
  card.innerHTML = `<span class="rdot ${it.isOwned ? 'own' : 'noown'}"></span><span class="rnm"></span><span class="rlv">${lv}</span><span class="rprog">${num}/${total}</span>${badge}`;
  card.querySelector('.rnm').textContent = it.name;
  card.addEventListener('click', () => {
    closeRoster();
    if (it.dl) openCharacter(it.id);
    else if (it.special && !it.unlockedAvail) toast('特別エピソードは解放制（購入/アイテム）です。未解放は取得できません（ゲームで解放済みの分のみDL可）。', 'err');
    else showDownloadPrompt({ id: it.id, name: it.name, type: S.rosterType, total: it.special ? it.unlockedAvail : it.total, covered: it.covered, isOwned: it.isOwned, distFull: it.distFull });
  });
  return card;
}

function buildOnboard(fs, capturing, hasData) {
  const box = document.createElement('div'); box.className = 'onboard';
  const step = (done, active, num, label, btn) => `<div class="step ${done ? 'done' : active ? 'active' : ''}"><span class="onum">${done ? '✓' : num}</span><span class="olabel">${label}</span>${!done && active && btn ? btn : ''}</div>`;
  const supported = !!(FS && FS.supported);
  const hasHandle = supported && FS.dirName();
  const step1label = !supported ? 'この環境では保存先フォルダを使えません（File System Access API 無効）。Chrome/Edge、または Brave はフラグ有効化が必要です'
    : (hasHandle ? `保存先フォルダ「${FS.dirName()}」を許可` : '保存先フォルダを選択');
  const step1btn = !supported ? '' : `<button class="btn primary" id="obFolder">${hasHandle ? 'このフォルダを許可' : 'フォルダを選ぶ'}</button>`;
  box.innerHTML = `<h2 class="obh">はじめに（3ステップ）</h2>
    ${step(fs, !fs, '①', step1label, step1btn)}
    ${step(fs && capturing, fs && !capturing, '②', 'ゲームと接続（トークン取得）', '<button class="btn primary" id="obConn">ゲームと接続</button>')}
    ${step(fs && hasData, fs && capturing && !hasData, '③', 'ライブのゲームを開いてホームまで進む→所持データを取得', '<a class="gamelink" href="https://play.games.dmm.co.jp/game/tenkeiprdx_x" target="_blank" rel="noopener" style="display:inline-block;margin-top:4px">ゲームを開く（R18）</a>')}
    <div class="note dim" style="margin-top:10px">※接続後、所持キャラの解放済みストーリーをAPIで取得し選択フォルダへ保存します。</div>`;
  setTimeout(() => {
    const b = box.querySelector('#obFolder');
    if (b) b.addEventListener('click', async () => {
      if (FS.dirName()) { try { S.fsGranted = (await FS.permission(true)) === 'granted'; await refreshLists(); } catch (e) { toast(fsPickErr(e), 'err'); } }
      else await pickFolder();
    });
    const c = box.querySelector('#obConn'); if (c) c.addEventListener('click', () => $('connToggle').click());
  }, 0);
  return box;
}

function openRoster() { S.rosterOpen = true; S.cur = null; clearHash(); $('roster').style.display = ''; $('empty').style.display = 'none'; $('detail').style.display = 'none'; renderRoster(); }
function closeRoster() { S.rosterOpen = false; $('roster').style.display = 'none'; if (!S.cur) showEmptyIdle(); }

/* ===== 一括ダウンロード ===== */
const bulkOpts = { unlockedMode: 'only', overwrite: false, includeUnowned: false, dlIntervalSec: 300 };

async function collectBulkCandidates() {
  const type = S.rosterType; // 常に現在のタブ（種別）全件が対象
  let folderMeta = {}; try { ({ folderMeta } = await COLLECTION.indexes()); } catch (e) {}
  const list = [];
  for (const [id, m] of Object.entries(folderMeta)) {
    if (catOf(m) !== type) continue;
    const name = (m.title ? m.name + m.title : m.name) || id;
    if (type === 'character') {
      if (!S.owned.has(id)) {
        const total = (m.episodes || []).length;
        const distFull = total > 0 && COLLECTION.distEpisodesCovered(m, S.distScenes || new Set()) === total;
        if (distFull) list.push({ id, name, type, total, full: true, dist: true });
        else if (bulkOpts.includeUnowned) list.push({ id, name, type, total, full: false, unowned: true });
        continue;
      }
      const level = S.owned.get(id);
      const full = level != null && level >= 70;
      if (bulkOpts.unlockedMode === 'only' && !full) continue;
      list.push({ id, name, type, total: (m.episodes || []).length, full });
    } else if (type === 'special') {
      // 特別＝解放済み(user PaidEpisode)の話が1つでもある物だけ候補に（未解放へは撃たない＝個別DLと同ゲート）。
      const unlockedAvail = (m.episodes || []).filter((e) => (S.paidUnlocked || new Set()).has(String(e.paidMasterId))).length;
      if (!unlockedAvail) continue;
      list.push({ id, name, type, total: unlockedAvail, full: true });
    } else {
      // メイン/イベント＝クリア済み話が1つでもある(=DL対象が有る)ものだけ候補に（未クリアのみのカードは撃たない）。
      const clearedN = (m.episodes || []).filter((e) => (S.clearedNodes || new Set()).has(String(e.id))).length;
      if (!clearedN) continue;
      list.push({ id, name, type, total: clearedN, full: true });
    }
  }
  if (type === 'character' && bulkOpts.unlockedMode === 'priority') list.sort((a, b) => Number(b.full) - Number(a.full) || (a.name > b.name ? 1 : -1));
  else list.sort((a, b) => (a.name > b.name ? 1 : -1));
  return list;
}

function seg(id, val, onPick) {
  const wrap = $(id); if (!wrap) return;
  wrap.querySelectorAll('.sg').forEach((b) => {
    b.classList.toggle('active', b.dataset.v === String(val));
    b.onclick = () => { wrap.querySelectorAll('.sg').forEach((x) => x.classList.remove('active')); b.classList.add('active'); onPick(b.dataset.v); };
  });
}

async function openBulk() {
  try { const o = (await chrome.storage.local.get('bulkOpts')).bulkOpts; if (o) Object.assign(bulkOpts, o); } catch (e) {}
  $('bulkTitle').textContent = `一括ダウンロード（${TYPE_LABEL[S.rosterType] || ''}）`;
  const isChar = S.rosterType === 'character';
  $('bulkUnlockRow').style.display = isChar ? '' : 'none';
  $('bulkUnownedRow').style.display = isChar ? '' : 'none';
  seg('bulkUnlock', bulkOpts.unlockedMode, (v) => { bulkOpts.unlockedMode = v; persistBulkOpts(); refreshBulkTarget(); });
  seg('bulkUnowned', bulkOpts.includeUnowned ? '1' : '0', (v) => { bulkOpts.includeUnowned = v === '1'; persistBulkOpts(); refreshBulkTarget(); });
  seg('bulkOverwrite', bulkOpts.overwrite ? '1' : '0', (v) => { bulkOpts.overwrite = v === '1'; persistBulkOpts(); });
  seg('bulkInterval', String(bulkOpts.dlIntervalSec || 300), (v) => { bulkOpts.dlIntervalSec = parseInt(v, 10) || 300; persistBulkOpts(); });
  $('bulkModal').style.display = '';
  await refreshBulkTarget();
  await renderBulkCard();
}
function closeBulk() { $('bulkModal').style.display = 'none'; }
function persistBulkOpts() { try { chrome.storage.local.set({ bulkOpts }); } catch (e) {} }

async function refreshBulkTarget() {
  const st = await BULK.getState();
  if (st && BULK.isActive(st.phase)) { $('bulkTarget').textContent = '実行中（対象は開始時に確定済み）'; return; }
  const list = await collectBulkCandidates();
  S._bulkCandidates = list;
  const distN = list.filter((x) => x.dist).length;
  const unownedN = list.filter((x) => x.unowned).length;
  let note = '';
  if (S.rosterType === 'character') {
    const parts = [];
    if (distN) parts.push(`配布 ${distN}体`);
    if (unownedN) parts.push(`未所持(立ち絵等) ${unownedN}体`);
    note = parts.length ? `（うち ${parts.join('・')}）` : '（所持キャラのみ）';
  }
  $('bulkTarget').textContent = `対象 ${list.length} 件${note}`;
}

async function startBulk() {
  const list = S._bulkCandidates || (await collectBulkCandidates());
  if (!list.length) { toast('対象が0件です', 'err'); return; }
  const root = FS && FS.supported ? await FS.ensure() : null;
  if (!root) { toast('先に保存先フォルダを選んでください', 'err'); return; }
  const r = await BULK.start(list, { overwrite: bulkOpts.overwrite, dlIntervalSec: bulkOpts.dlIntervalSec || 300 });
  if (!r.ok) { toast(r.reason === 'active' ? '既に実行中です' : '開始できませんでした', 'err'); return; }
  await renderBulkCard();
}

const PHASE_LABEL = { running: '実行中', done: '完了', stopped: '停止', error: 'エラー' };

function renderBulkFailures(st) {
  const wrap = $('bulkFailWrap'), sum = $('bulkFailSummary'), list = $('bulkFailList');
  if (!wrap) return;
  const fails = (st && st.failures) || [];
  if (!fails.length) { wrap.style.display = 'none'; list.innerHTML = ''; return; }
  wrap.style.display = '';
  sum.textContent = `失敗ログ（${fails.length}）`;
  list.innerHTML = '';
  for (const f of fails) {
    const d = document.createElement('div');
    d.className = 'bkfail' + (f.soft ? ' soft' : '');
    d.textContent = `${f.soft ? '[一部] ' : '[失敗] '}${f.name}: ${f.reason}`;
    list.appendChild(d);
  }
}

async function renderBulkCard() {
  const st = await BULK.getState();
  const card = $('bulkCard'), startBtn = $('bulkStart'), stopBtn = $('bulkStop'), clearBtn = $('bulkClear'), tbody = $('bulkTable').querySelector('tbody');
  if (!st) { card.style.display = 'none'; startBtn.style.display = ''; stopBtn.style.display = 'none'; if (clearBtn) clearBtn.style.display = 'none'; tbody.innerHTML = ''; renderBulkFailures(null); return; }
  const active = BULK.isActive(st.phase);
  const s = BULK.stats(st.items);
  const gd = st.gd || { total: 0, done: 0, failed: 0 };
  startBtn.style.display = active ? 'none' : '';
  startBtn.disabled = false;
  stopBtn.style.display = active ? '' : 'none';
  if (clearBtn) clearBtn.style.display = active ? 'none' : '';
  renderBulkFailures(st);
  card.style.display = '';

  const rows = [];
  rows.push(`<div class="bkline"><span class="bkphase ${st.phase}">${PHASE_LABEL[st.phase] || ''}</span> キャラ処理 ${s.processed}/${s.total}${s.dl ? '（DL中' + s.dl + '）' : ''}</div>`);
  rows.push(`<div class="bkline dim">ストーリーメタ ${gd.done}/${gd.total}${gd.failed ? '（失敗' + gd.failed + '）' : ''}｜資産DL済 ${s.done} / スキップ ${s.skipped} / 失敗 ${s.failed}</div>`);
  if (active && st.gdStatus) rows.push(`<div class="bkline dim">${escapeHtml(st.gdStatus)}</div>`);
  if (active && st.currentStatus) rows.push(`<div class="bkline dim">${escapeHtml(st.currentStatus)}</div>`);
  if (active && st.nextDlAt && st.nextDlAt > Date.now()) {
    const sec = Math.ceil((st.nextDlAt - Date.now()) / 1000);
    rows.push(`<div class="bkline dim">次のキャラDLまで ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}</div>`);
  }
  if (st.phase === 'error' && st.lastError) rows.push(`<div class="bkline err">エラー: ${escapeHtml(st.lastError)}</div>`);
  if (st.tokenError) rows.push(`<div class="bkline err">トークンを取り直したら、もう一度「開始」してください（取得済み資産はスキップされます）。</div>`);
  card.innerHTML = rows.join('');

  tbody.innerHTML = '';
  for (const it of st.items) {
    const tr = document.createElement('tr');
    tr.className = 'bkrow ' + it.status;
    let metaText, metaCls = '';
    if (it.status === 'skipped') { metaText = 'スキップ'; metaCls = 'skip'; }
    else if (it.gd === 'failed') { metaText = '取得失敗'; metaCls = 'bad'; }
    else if (it.gd === 'partial') { metaText = `一部 ${it.gdGot || 0}/${it.gdNeed || 0}`; metaCls = 'warn'; }
    else if (it.gd === 'pending') { metaText = it.gdNeed ? `${it.gdGot || 0}/${it.gdNeed}` : '待機'; }
    else { metaText = it.gdNeed ? `✓ ${it.gdGot || 0}/${it.gdNeed}` : '✓ 済'; metaCls = 'ok'; }
    const assetText = it.status === 'skipped' ? 'スキップ'
      : it.status === 'done' ? `${it.covered || 0}/${it.total || 0}話・音声${it.voiced || 0}・背景${it.bg || 0}${it.missing ? '・欠番' + it.missing : ''}${it.fails ? '・失敗' + it.fails : ''}`
      : it.status === 'dl' ? 'DL中…' : it.status === 'failed' ? (it.error || '失敗') : '';
    const detailText = it.status === 'skipped' ? 'スキップ' : it.status === 'done' ? `資産${it.assetCats || 0}種・立ち絵${it.cast || 0}` : '';
    tr.innerHTML = `<td class="bknm"></td><td class="bk-meta ${metaCls}">${escapeHtml(metaText)}</td><td class="bk-asset dim">${escapeHtml(assetText)}</td><td class="bk-detail dim">${escapeHtml(detailText)}</td>`;
    tr.querySelector('.bknm').textContent = it.name;
    tbody.appendChild(tr);
  }
}

function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

async function renderBulkBanner() {
  const st = await BULK.getState();
  const el = $('bulkStatus');
  if (!st || !BULK.isActive(st.phase)) { el.style.display = 'none'; el.innerHTML = ''; return; }
  const s = BULK.stats(st.items);
  const gd = st.gd || { total: 0, done: 0 };
  el.style.display = '';
  el.innerHTML = `<span class="bkdot"></span><span class="bktxt"></span><button class="btn xs" id="bulkBannerStop">停止</button>`;
  el.querySelector('.bktxt').textContent = `一括DL 実行中 ストーリーメタ ${gd.done}/${gd.total}・資産 ${s.done}/${s.total}${s.failed ? '・失敗' + s.failed : ''}`;
  el.querySelector('#bulkBannerStop').addEventListener('click', () => BULK.stop());
}

let _bulkTick = null;
function ensureBulkTick(on) {
  if (on && !_bulkTick) _bulkTick = setInterval(() => { renderBulkBanner(); if ($('bulkModal').style.display !== 'none') renderBulkCard(); }, 1000);
  else if (!on && _bulkTick) { clearInterval(_bulkTick); _bulkTick = null; }
}

async function appendDetailInfo(charId, type) {
  if (type !== 'character') return;
  let d = null; try { d = await COLLECTION.characterDetail(charId); } catch (e) {}
  const box = document.createElement('div'); box.className = 'dinfo';
  const add = (label, val) => {
    if (!val) return;
    const r = document.createElement('div'); r.className = 'dinforow';
    if (label) { const l = document.createElement('span'); l.className = 'dinfol'; l.textContent = label; r.appendChild(l); }
    const v = document.createElement('span'); v.className = 'dinfov'; v.textContent = nameFix(val); r.appendChild(v);
    box.appendChild(r);
  };
  // 複数の label:値を1行に横並び（空の項目は省く）
  const addInline = (pairs) => {
    const items = pairs.filter(([, v]) => v);
    if (!items.length) return;
    const r = document.createElement('div'); r.className = 'dinforow inline';
    for (const [label, val] of items) {
      const it = document.createElement('span'); it.className = 'dinfoitem';
      const l = document.createElement('span'); l.className = 'dinfol'; l.textContent = label;
      const v = document.createElement('span'); v.className = 'dinfov'; v.textContent = nameFix(val);
      it.appendChild(l); it.appendChild(v); r.appendChild(it);
    }
    box.appendChild(r);
  };
  if (d) {
    addInline([['グループ', d.group], ['ランク', d.rank], ['種族', d.race]]);
    addInline([['好き', d.likes], ['嫌い', d.dislikes], ['特技', d.specialty], ['スリーサイズ', Array.isArray(d.bwh) ? `B${d.bwh[0]} W${d.bwh[1]} H${d.bwh[2]}` : '']]);
    add('自己紹介', d.intro);
    add('プロフィール', d.profile1); add('', d.profile2);
  }
  $('charHead').appendChild(box);
}

async function showDownloadPrompt(c) {
  S.navId = String(c.id);
  pushCharHash(c.id);
  closeRoster();
  $('empty').style.display = 'none'; $('detail').style.display = ''; $('dlbar').style.display = 'none'; $('playwrap').style.display = 'none';
  $('eplist').innerHTML = ''; $('stage').style.display = 'none'; $('voicegrid').innerHTML = ''; $('voiceNote').textContent = '';
  const owned = S.owned.has(String(c.id));
  const level = S.owned.get(String(c.id));
  const isChar = c.type === 'character';
  const distFull = !!c.distFull;
  const unlocked = level != null ? COLLECTION.unlockedCount(level) : c.total;
  let note, badge, btnLabel;
  if (isChar && owned) {
    note = `解放 ${unlocked}/${c.total}話（現在Lv${level}）。DLでストーリー本文＋ボイス＋立ち絵・3D等を保存します。`;
    badge = `<span class="ownbadge">所持 Lv${level}</span>`;
    btnLabel = `ダウンロード（${unlocked}話＋立ち絵等）`;
  } else if (isChar && distFull) {
    note = `未所持。立ち絵・アイコン・背景CG・3D・ボイスギャラリーと、全${c.total}話のストーリーを取得します。`;
    badge = '<span class="ownbadge dist">未所持・シーン取得済</span>';
    btnLabel = `ダウンロード（${c.total}話＋立ち絵等）`;
  } else if (isChar) {
    note = `未所持。立ち絵・アイコン・背景CG・3Dモデル・ボイスギャラリーを取得します（**ストーリーは所持者のみ**）。`;
    badge = '<span class="ownbadge dist">未所持（立ち絵・ボイス・3D）</span>';
    btnLabel = 'ダウンロード（立ち絵・ボイス・3D）';
  } else {
    note = `DLでストーリー本文＋ボイス＋背景などを保存します（取得可能な ${c.total} 話）。`;
    badge = '';
    btnLabel = `ダウンロード（${c.total}話）`;
  }
  $('charHead').innerHTML = `<h2>${chip(c.type)} ${c.name || c.id} <span class="hint">#${c.id}</span> ${badge}</h2>
    <div class="headrow"><span class="note">${note.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</span></div>
    <div class="headrow" style="margin:12px 0 14px"><button class="btn primary" id="doDl">${btnLabel}</button></div>`;
  $('doDl').addEventListener('click', () => runDownload(c.id));
  await appendDetailInfo(c.id, c.type);
}

function guideConnect() {
  const bar = $('dlbar'); bar.style.display = ''; bar.classList.add('err');
  $('dlmsg').textContent = '⚠ トークン切れです。「ゲームと接続」→ライブのゲームを操作してトークンを取得し直し、再DLしてください。';
  $('dlfill').style.width = '100%';
  const b = $('connToggle'); if (b) { b.classList.add('flash'); setTimeout(() => b.classList.remove('flash'), 8000); }
}

async function runDownload(folderKey) {
  try { const bst = await BULK.getState(); if (bst && BULK.isActive(bst.phase)) { toast('一括DLの実行中です。完了または停止してから個別DLしてください。', 'err'); return; } } catch (e) {}
  $('dlbar').style.display = ''; $('dlbar').classList.remove('err'); setProgress('開始…', 0);
  const btn = $('doDl'); if (btn) btn.disabled = true;
  try {
    const root = FS && FS.supported ? await FS.ensure() : null;
    if (!root) { setProgress('先に保存先フォルダを選んでください', 0); await refreshLists(); return; }
    await COLLECTION.collectStory(folderKey, setProgress);
    const r = await COLLECTION.downloadEntry(folderKey, setProgress);
    await refreshLists();
    await openCharacter(String(folderKey));
    const fails = (r && r.fails) || [], missing = (r && r.missing) || [];
    if (fails.length) toast(`DL一部失敗 ${fails.length}件（他は取得済み）。一時的な通信失敗の可能性が高いので「再DL」で補完できます。${missing.length ? `\n（別途、CDNに元データが無い欠番 ${missing.length}件は再DLしても取得できません）` : ''}\n・${fails.slice(0, 8).join('\n・')}${fails.length > 8 ? `\n…ほか${fails.length - 8}件` : ''}`, 'err');
    else if (missing.length) toast(`DL完了（ただし ${missing.length}件は元データがCDNに存在せず取得不可＝欠番。再DLしても取れません）。\n・${missing.slice(0, 8).join('\n・')}${missing.length > 8 ? `\n…ほか${missing.length - 8}件` : ''}`, 'err');
    else toast('DL完了', 'ok');
  } catch (e) {
    if (e && e.auth) guideConnect();
    else { setProgress('失敗: ' + (e && e.message ? e.message : e), 0); toast('DL中断: ' + (e && e.message ? e.message : e), 'err'); }
    console.error(e);
  } finally { if (btn) btn.disabled = false; }
}
function setProgress(msg, frac) { $('dlmsg').textContent = msg; $('dlfill').style.width = Math.round((frac || 0) * 100) + '%'; }

async function openCharacter(folderKey) {
  closeRoster();
  stopAuto();
  resetVisualPanel();
  if (S.epVoiceUrls) for (const u of S.epVoiceUrls.values()) URL.revokeObjectURL(u);
  if (S.cur && S.cur.bundleClips) for (const b of S.cur.bundleClips.values()) for (const u of b.list) URL.revokeObjectURL(u);
  S.epVoiceUrls = new Map(); S.extractedSids = new Set(); S.scene = null;
  if (imagePanel && imagePanel.resetForCharacter) imagePanel.resetForCharacter();
  const handle = charHandle(folderKey);
  if (!handle) return;
  pushCharHash(folderKey);
  let m = { name: folderKey, episodes: [] };
  try { const f = await FS.readUnder(handle, 'character.json'); if (f) m = JSON.parse(await f.text()); } catch (e) {}
  S.cur = { charId: String(folderKey), handle, meta: m, voiceUrls: new Map() };
  S.navId = String(folderKey);

  $('empty').style.display = 'none'; $('detail').style.display = ''; $('dlbar').style.display = 'none'; $('playwrap').style.display = '';
  const eps = m.episodes || [];
  const avail = eps.filter((e) => e.available).length;
  $('charHead').innerHTML = `<h2>${chip(catOf(m))} ${nameFix(m.name || folderKey)}${m.title || ''} <span class="hint">#${folderKey}</span></h2>
    <div class="headrow"><span class="note"><span class="dim">取得 ${avail}/${eps.length}話${m.builtAt ? '・DL ' + new Date(m.builtAt).toLocaleString('ja-JP') : ''}</span></span>
    <button class="btn xs" id="reDl">再DL</button></div>`;
  $('reDl').addEventListener('click', () => showDownloadPrompt({ id: folderKey, name: (m.name || folderKey) + (m.title || ''), type: catOf(m), total: eps.length, covered: avail }));

  const cp = m.completeness;
  if (cp) {
    const unresolved = (cp.bgUnresolved || 0) + (cp.castUnresolved || 0);
    // 全解決(✓)時の要約は不要＝未解決がある時だけ警告を出す
    if (unresolved) {
      const line = document.createElement('div');
      line.className = 'routewarn';
      line.textContent = `⚠ ルーティング未解決 ${unresolved}件（背景${cp.bgUnresolved || 0}/cast${cp.castUnresolved || 0}）`;
      $('charHead').appendChild(line);
    }
  }
  await appendDetailInfo(folderKey, m.type);
  renderEpisodes(m); renderVoiceGallery(); renderIllustVoice(); switchTab('image');
}

function renderEpisodes(m) {
  const box = $('eplist'); box.innerHTML = '';
  const eps = m.episodes || [];
  if (!eps.some((e) => e.available)) { box.innerHTML = '<div class="emptyrow">取得済みの話がありません。「再DL」で取得してください。</div>'; $('stage').style.display = 'none'; return; }
  let curChapter = null;
  eps.forEach((ep) => {
    // メイン/イベントは章(chapter=LocationMaster)ごとに見出しを挟む。
    if (ep.chapter && ep.chapter !== curChapter) {
      curChapter = ep.chapter;
      const h = document.createElement('div'); h.className = 'epchapter'; h.textContent = ep.chapter; box.appendChild(h);
    }
    const row = document.createElement('div');
    row.className = 'eprow' + (ep.available ? '' : ' na');
    const naLabel = ep.locked ? (m.type === 'quest' ? '未クリア' : '未解放') : '未取得';
    row.innerHTML = `<span class="lbl">${ep.label || ''}</span><span class="ti"></span><span class="epid">#${ep.episodeMasterId}</span><span class="vc">${ep.available ? (ep.lineCount + '行' + (ep.voiced ? ' / 音声' + ep.voiced : '')) : naLabel}</span>`;
    row.querySelector('.ti').textContent = ep.title || '';
    if (ep.available) row.addEventListener('click', () => { document.querySelectorAll('.eprow').forEach((x) => x.classList.remove('sel')); row.classList.add('sel'); playEpisode(ep); });
    box.appendChild(row);
  });
  $('stage').style.display = 'none'; $('controls').style.display = 'none';
}

async function playEpisode(ep) {
  stopAuto();
  const eid = ep.episodeMasterId;
  const sc = (ep.scenes || []).slice();
  const merged = [];
  for (const s of sc) {
    const f = await FS.readUnder(S.cur.handle, s.timeline);
    if (!f) continue;
    let tl = null; try { tl = JSON.parse(await f.text()); } catch (e) {}
    if (!tl) continue;
    for (const ln of tl.lines) { ln._sid = String(s.sceneId); ln._voice = s.voice; merged.push(ln); }
  }
  if (!merged.length) { $('stage').style.display = ''; $('controls').style.display = 'none'; $('stage').innerHTML = '<div class="v1note">この話の台詞データがありません。</div>'; return; }
  S.scene = { lines: merged };
  S.idx = 0;
  if (!$('bgName')) $('stage').innerHTML = '<div class="bg" id="bg"><span id="bgName">背景</span></div><div class="textbox"><div class="speaker" id="speaker"></div><div class="text" id="text"></div><div class="meta" id="meta"></div></div>';
  $('stage').style.display = ''; $('controls').style.display = '';
  render();
}

function render() {
  const l = S.scene.lines[S.idx];
  $('speaker').textContent = nameFix(l.speaker) || '';
  $('text').textContent = nameFix(l.text) || '';
  $('bgName').textContent = l.bg || '背景';
  $('meta').textContent = `#${l.i}  bg=${l.bg || '-'}  bgm=${l.bgm || '-'}  voice=${l.voice || '-'}`;
  $('prog').textContent = `${S.idx + 1} / ${S.scene.lines.length}`;
  playVoice(l);
}

async function ensureSceneVoice(sid, voicePath) {
  if (!sid || !voicePath || S.extractedSids.has(sid)) return;
  S.extractedSids.add(sid);
  const f = await FS.readUnder(S.cur.handle, voicePath);
  if (!f) return;
  let clips = [];
  try { clips = D.extractVoiceClips(new Uint8Array(await f.arrayBuffer())); } catch (e) {}
  for (const c of clips) if (!S.epVoiceUrls.has(c.name)) S.epVoiceUrls.set(c.name, URL.createObjectURL(new Blob([c.data], { type: 'audio/mp4' })));
}

async function playVoice(l) {
  const a = $('audio'); a.pause();
  if (!l.voice || !$('voiceOn').checked) return;
  await ensureSceneVoice(l._sid, l._voice);
  if (S.epVoiceUrls.has(l.voice)) { a.src = S.epVoiceUrls.get(l.voice); a.play().catch(() => {}); }
}

function go(d) { if (!S.scene) return; S.idx = Math.max(0, Math.min(S.scene.lines.length - 1, S.idx + d)); render(); }
function stopAuto() { if (S.autoTimer) { clearInterval(S.autoTimer); S.autoTimer = null; } const a = $('auto'); if (a) a.checked = false; }

async function renderVoiceGallery() {
  const grid = $('voicegrid'); grid.innerHTML = '';
  if (!(S.cur.meta && S.cur.meta.voiceGallery)) { $('voiceNote').textContent = 'このキャラのキャラボイスは未取得です。'; return; }
  const f = await FS.readUnder(S.cur.handle, S.cur.meta.voiceGallery);
  let clips = [];
  if (f) { try { clips = D.extractVoiceClips(new Uint8Array(await f.arrayBuffer())); } catch (e) {} }
  const voiceNo = (nm) => { const m = String(nm).match(/_(\d+)[a-z]*$/i); return m ? parseInt(m[1], 10) : 0; };
  clips.sort((a, b) => voiceNo(a.name) - voiceNo(b.name) || (a.name > b.name ? 1 : -1));
  $('voiceNote').textContent = clips.length ? `キャラボイス ${clips.length} 件（番号順）` : 'キャラボイスを展開できませんでした。';
  for (const c of clips) {
    const no = voiceNo(c.name);
    const card = document.createElement('div'); card.className = 'voicecard';
    card.innerHTML = '<div class="vn"></div><div class="vb"></div>';
    card.querySelector('.vn').textContent = `No.${String(no).padStart(3, '0')}`;
    card.querySelector('.vb').textContent = c.name;
    card.addEventListener('click', () => {
      document.querySelectorAll('.voicecard').forEach((x) => x.classList.remove('playing')); card.classList.add('playing');
      if (!S.cur.voiceUrls.has(c.name)) S.cur.voiceUrls.set(c.name, URL.createObjectURL(new Blob([c.data], { type: 'audio/mp4' })));
      const a = $('audio'); a.src = S.cur.voiceUrls.get(c.name); a.play().catch(() => {});
    });
    grid.appendChild(card);
  }
}

async function ensureBundleClips(path) {
  S.cur.bundleClips = S.cur.bundleClips || new Map();
  if (S.cur.bundleClips.has(path)) return S.cur.bundleClips.get(path);
  const res = { byName: new Map(), list: [] };
  const f = await FS.readUnder(S.cur.handle, path);
  if (f) {
    let clips = []; try { clips = D.extractVoiceClips(new Uint8Array(await f.arrayBuffer())); } catch (e) {}
    for (const c of clips) { const url = URL.createObjectURL(new Blob([c.data], { type: 'audio/mp4' })); res.byName.set(c.name, url); res.list.push(url); }
  }
  S.cur.bundleClips.set(path, res);
  return res;
}

async function renderIllustVoice() {
  const host = $('illustvoice'); if (!host) return;
  host.innerHTML = '';
  const list = (S.cur.meta && S.cur.meta.illustVoice) || [];
  if (!list.length) return;
  const head = document.createElement('div'); head.className = 'ivhead'; head.textContent = `イラストボイス（${list.length}）`; host.appendChild(head);
  list.forEach((iv) => {
    const block = document.createElement('div'); block.className = 'ivblock';
    const t = document.createElement('div'); t.className = 'ivtitle'; t.textContent = nameFix(iv.name || iv.ivId); block.appendChild(t);
    (iv.lines || []).forEach((ln, i) => {
      const row = document.createElement('div'); row.className = 'ivline';
      const btn = document.createElement('button'); btn.className = 'btn xs ivplay'; btn.textContent = '▶';
      const tx = document.createElement('span'); tx.className = 'ivtext'; tx.textContent = nameFix(ln.text || '');
      row.appendChild(btn); row.appendChild(tx); block.appendChild(row);
      btn.addEventListener('click', async () => {
        document.querySelectorAll('.ivline').forEach((x) => x.classList.remove('playing')); row.classList.add('playing');
        const sid = (String(ln.voiceId).match(/^[cs]_(\d+)_/) || [])[1];
        const path = (iv.voice && (iv.voice[sid] || iv.voice.bundle)) || null;
        if (!path) { toast('この台詞の音声は未取得です', 'err'); return; }
        const clips = await ensureBundleClips(path);
        const url = clips.byName.get(ln.voiceId) || clips.list[i] || clips.list[0];
        if (!url) { toast('音声を展開できませんでした', 'err'); return; }
        const a = $('audio'); a.src = url; a.play().catch(() => {});
      });
    });
    host.appendChild(block);
  });
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === name));
  if (imagePanel && imagePanel.onTabSwitched) imagePanel.onTabSwitched(name);
}

async function navChar(dir) {
  const model = await rosterModel();
  const flat = model.groups.flatMap((g) => g.items);
  const i = flat.findIndex((x) => String(x.id) === String(S.navId || ''));
  if (i < 0) { toast('現在のキャラ一覧の並びに含まれないため移動できません（タブ/絞り込みを確認）'); return; }
  const j = i + dir;
  if (j < 0 || j >= flat.length) { toast(dir > 0 ? '一覧の最後です' : '一覧の最初です'); return; }
  const it = flat[j];
  closeRoster();
  if (it.dl) openCharacter(it.id);
  else showDownloadPrompt({ id: it.id, name: it.name, type: model.type, total: it.total, covered: it.covered });
}

async function openById(id) {
  const sid = String(id || '');
  if (!sid) return false;
  if (S.dl.some((z) => String(z.charId) === sid)) {
    await openCharacter(sid);
    return true;
  }
  try {
    const x = await COLLECTION.indexes();
    const m = x && x.folderMeta && x.folderMeta[sid];
    if (m) {
      showDownloadPrompt({ id: sid, name: (m.title ? m.name + m.title : m.name) || sid, type: catOf(m), total: (m.episodes || []).length, covered: 0 });
      return true;
    }
  } catch (e) {}
  return false;
}

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
$('next').addEventListener('click', () => go(1));
$('prev').addEventListener('click', () => go(-1));
$('auto').addEventListener('change', (e) => { if (S.autoTimer) { clearInterval(S.autoTimer); S.autoTimer = null; } if (e.target.checked) S.autoTimer = setInterval(() => { if (S.scene && S.idx < S.scene.lines.length - 1) go(1); else stopAuto(); }, 3500); });
$('homeTitle').addEventListener('click', openRoster);
$('backToRoster').addEventListener('click', openRoster);
$('prevChar').addEventListener('click', () => navChar(-1));
$('nextChar').addEventListener('click', () => navChar(1));
$('rosterSearch').addEventListener('input', renderRoster);
$('rosterType').querySelectorAll('.rf').forEach((b) => b.addEventListener('click', () => {
  $('rosterType').querySelectorAll('.rf').forEach((x) => x.classList.remove('active')); b.classList.add('active');
  S.rosterType = b.dataset.rt; $('rosterOwn').style.display = S.rosterType === 'character' ? '' : 'none'; renderRoster();
}));
$('rosterGroup').addEventListener('change', () => { S.rosterGroup = $('rosterGroup').value; renderRoster(); });
$('rosterRank').addEventListener('change', () => { S.rosterRank = $('rosterRank').value; renderRoster(); });
$('rosterOwn').querySelectorAll('.rf').forEach((b) => b.addEventListener('click', () => {
  $('rosterOwn').querySelectorAll('.rf').forEach((x) => x.classList.remove('active')); b.classList.add('active'); S.rosterOwn = b.dataset.r; renderRoster();
}));

$('bulkOpen').addEventListener('click', openBulk);
$('bulkClose').addEventListener('click', closeBulk);
$('bulkModal').addEventListener('click', (e) => { if (e.target === $('bulkModal')) closeBulk(); });
$('bulkStart').addEventListener('click', startBulk);
$('bulkClear').addEventListener('click', async () => { await BULK.clear(); await renderBulkCard(); await renderBulkBanner(); await refreshBulkTarget(); });
$('bulkStop').addEventListener('click', () => BULK.stop());

$('fsPick').addEventListener('click', () => { pickFolder(); });
$('fsGrant').addEventListener('click', async () => { S.fsGranted = (await FS.permission(true)) === 'granted'; await refreshLists(); });

$('connToggle').addEventListener('click', async () => {
  const wasOn = $('connToggle').dataset.on === '1';
  if (!wasOn) _autoDisc = false; // 手動で接続し直したら自動解除を再度許可
  const resp = await chrome.runtime.sendMessage({ cmd: wasOn ? 'stop' : 'start' });
  if (!wasOn) {
    if (!resp || !resp.ok) {
      await updateConn();
      const e = resp && resp.error;
      if (e === 'no-tab') $('connInfo').textContent = 'ゲームのタブが見つかりません（play.games.dmm でゲームを開いてから）';
      return;
    }
    $('connInfo').textContent = `ゲームタブ${(resp.game || []).length}件に接続。所持データ取得中…`;
    try { const r = await COLLECTION.refreshUserViaApi(); if (r.ok) $('connInfo').textContent = `接続・所持${r.owned}体を取得`; } catch (e) {}
    try { await COLLECTION.ensureIndexes((m) => { $('connInfo').textContent = m; }); } catch (e) { $('connInfo').textContent = '索引生成に失敗（トークン取得後に再試行）'; }
    await refreshLists();
    await maybeAutoDisconnect(); // 既にトークン＋所持が揃っていれば即解除（未捕捉なら接続維持でトークン到着を待つ）
  }
  await updateConn();
});

$('refreshUser').addEventListener('click', async () => {
  const btn = $('refreshUser'); const prev = btn.textContent; btn.disabled = true; btn.textContent = '更新中…';
  try {
    const r = await COLLECTION.refreshUserViaApi();
    await refreshLists();
    btn.textContent = (r && r.ok) ? `所持${r.owned}体を更新` : 'トークン切れ（接続して取り直し）';
  } catch (e) { btn.textContent = '更新失敗'; }
  setTimeout(() => { btn.disabled = false; btn.textContent = prev; }, 2500);
});


function updateCdnReset() { $('cdnReset').disabled = ($('cdnBase').value || '').trim().replace(/\/+$/, '') === CFG.assetRootDefault; }
$('cdnBase').addEventListener('input', updateCdnReset);
$('cdnSave').addEventListener('click', async () => {
  const v = ($('cdnBase').value || '').trim().replace(/\/+$/, '');
  await chrome.storage.local.set({ assetRoot: v || CFG.assetRootDefault });
  $('cdnSaved').textContent = '更新'; setTimeout(() => ($('cdnSaved').textContent = ''), 1500);
  updateCdnReset();
});
$('cdnReset').addEventListener('click', async () => {
  $('cdnBase').value = CFG.assetRootDefault;
  await chrome.storage.local.set({ assetRoot: CFG.assetRootDefault });
  $('cdnOut').textContent = ''; updateCdnReset();
});
$('cdnTest').addEventListener('click', async () => {
  const out = $('cdnOut');
  const base = ($('cdnBase').value || '').trim().replace(/\/+$/, '') || CFG.assetRootDefault;
  const probe = `${base}/Assets/WebGL/charactericons_assets_charactericons/10432401_e0f1f571e3b008125f423af43e161390.bundle`;
  out.textContent = 'テスト中…';
  try { const r = await fetch(probe, { method: 'HEAD' }); out.textContent = `${base}\nHTTP ${r.status} ${r.ok ? 'OK（配信中）' : 'NG'}`; }
  catch (e) { out.textContent = `${base}\nerror: ${e && e.message ? e.message : e}`; }
});

$('sharedDl').addEventListener('click', async () => {
  const out = $('sharedOut');
  out.style.display = '';
  const root = FS && FS.supported ? await FS.ensure() : null;
  if (!root) { out.textContent = '先に保存先フォルダ（ホームディレクトリ）を選んでください'; return; }
  $('sharedDl').disabled = true;
  try { const r = await COLLECTION.buildSharedResources((m) => { out.textContent = m; }); toast(`共有リソース 取得${r.got}/既存${r.skip}/全${r.total}`, 'ok'); }
  catch (e) { const msg = e && e.message ? e.message : e; out.textContent = '中断: ' + msg; toast('共有リソース中断: ' + msg, 'err'); }
  $('sharedDl').disabled = false;
});


twoStep($('resetCap'), '一時データを消す', async () => { try { await IDB.del('userRaw'); } catch (e) {} try { await chrome.storage.local.remove(['apiAuth', 'apiAuthBad']); } catch (e) {} closeDetail(); await refreshLists(); });

$('rebuildIdx').addEventListener('click', async () => {
  const out = $('idxOut'); out.textContent = '再生成中…（接続してトークン取得済みが前提）';
  try { const x = await COLLECTION.rebuildIndexes((m) => { out.textContent = m; }); out.textContent = `完了: キャラ${Object.keys(x.characterIndex).length} / 資産${Object.keys(x.assetIndex).length}`; await refreshLists(); }
  catch (e) { out.textContent = '失敗: ' + (e && e.auth ? 'トークン切れ（ゲームと接続）' : (e && e.message ? e.message : e)); }
});

let _reactTimer = null, _bulkRefreshTimer = null;
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local') return;
  if (ch.bulkState) {
    const nv = ch.bulkState.newValue, ov = ch.bulkState.oldValue;
    const active = nv && BULK.isActive(nv.phase);
    ensureBulkTick(!!active);
    renderBulkBanner();
    if ($('bulkModal').style.display !== 'none') renderBulkCard();
    const nDone = nv ? nv.items.filter((x) => x.status === 'done').length : 0;
    const oDone = ov ? ov.items.filter((x) => x.status === 'done').length : 0;
    if (nDone !== oDone || (ov && BULK.isActive(ov.phase) && (!nv || !BULK.isActive(nv.phase)))) {
      clearTimeout(_bulkRefreshTimer); _bulkRefreshTimer = setTimeout(() => refreshLists(), 1200);
    }
  }
  if (ch.capturing || ch.captureLive || ch.captureError || ch.apiAuth || ch.apiAuthBad) updateConn();
  if (ch.apiAuth || ch.apiAuthBad) {
    const nv = ch.apiAuth && ch.apiAuth.newValue, ov = ch.apiAuth && ch.apiAuth.oldValue;
    const tokenChanged = !!(nv && nv.authorization && (!ov || ov.authorization !== nv.authorization));
    clearTimeout(_reactTimer);
    _reactTimer = setTimeout(async () => { if (tokenChanged) { try { await COLLECTION.refreshUserViaApi(); } catch (e) {} } await refreshLists(); await maybeAutoDisconnect(); }, 1500);
  }
  if (ch.assetRoot && ch.assetRoot.newValue) {
    if (document.activeElement !== $('cdnBase')) { $('cdnBase').value = ch.assetRoot.newValue; updateCdnReset(); }
    if (ch.assetRoot.oldValue && ch.assetRoot.oldValue !== ch.assetRoot.newValue) { try { COLLECTION.invalidateIndex(); } catch (e) {} clearTimeout(_reactTimer); _reactTimer = setTimeout(() => refreshLists(), 1500); }
  }
});

window.addEventListener('hashchange', async () => {
  const id = parseCharHash();
  if (!id) {
    if (!S.rosterOpen) openRoster();
    return;
  }
  if (S.cur && String(S.cur.charId) === String(id)) return;
  const opened = await openById(id);
  if (!opened) openRoster();
});

// ヘッダにバージョン表示＋GitHubのmanifest.jsonと比較して新しければ「更新あり」バッヂ。
function cmpSemver(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}
async function showVersionAndCheckUpdate() {
  let cur = '';
  try { cur = chrome.runtime.getManifest().version || ''; } catch (e) {}
  if ($('appVersion')) $('appVersion').textContent = cur ? 'v' + cur : '';
  const badge = $('updateBadge');
  if (!badge || !CFG.updateManifestUrl || !cur) return;
  try {
    const res = await fetch(CFG.updateManifestUrl, { cache: 'no-cache' });
    if (!res.ok) return;
    const latest = (await res.json()).version;
    if (latest && cmpSemver(latest, cur) > 0) {
      badge.href = CFG.githubReleasesUrl || '#';
      badge.textContent = `⬆ 更新あり v${latest}`;
      badge.title = `新しいバージョン v${latest} があります（現在 v${cur}）`;
      badge.style.display = '';
    }
  } catch (e) {}
}

async function init() {
  try { await chrome.runtime.sendMessage({ cmd: 'reattach' }); } catch (e) {}
  showVersionAndCheckUpdate();
  updateConn();
  try {
    const o = await chrome.storage.local.get(['email', 'assetRoot']);
    if (o.email) $('email').value = o.email;
    $('cdnBase').value = o.assetRoot || CFG.assetRootDefault;
  } catch (e) {}
  updateCdnReset();
  if (CFG.githubIssuesUrl && $('ghIssue')) { $('ghIssue').href = CFG.githubIssuesUrl; $('ghIssue').style.display = ''; }
  letterPanel = globalThis.TP_PLAYER_LETTER ? globalThis.TP_PLAYER_LETTER.createController({ $, toast, CFG, COLLECTION, nameFix, onDistUpdated: async () => { try { S.distScenes = await COLLECTION.distSceneSet(true); } catch (e) {} if (S.rosterOpen) renderRoster(); } }) : null;
  if (letterPanel) { letterPanel.bind(); await letterPanel.refresh(); }
  audioPanel = PLAYER_AUDIO && PLAYER_AUDIO.createController ? PLAYER_AUDIO.createController({ S, $, storage: chrome.storage.local }) : null;
  if (audioPanel && audioPanel.bind) audioPanel.bind();
  if (audioPanel && audioPanel.initFromStorage) await audioPanel.initFromStorage();
  imagePanel = PLAYER_IMAGE && PLAYER_IMAGE.createController ? PLAYER_IMAGE.createController({ S, $, V, FS, D, toast }) : null;
  if (imagePanel && imagePanel.bind) imagePanel.bind();
  try { await COLLECTION.refreshUserViaApi(); } catch (e) {}
  await refreshLists();
  try {
    const bst = await BULK.getState();
    if (bst && BULK.isActive(bst.phase)) { ensureBulkTick(true); await renderBulkBanner(); BULK.resume(); }
  } catch (e) {}
  const q = new URLSearchParams(location.search).get('char');
  const h = parseCharHash();
  if (h && await openById(h)) return;
  if (q && await openById(q)) return;
  openRoster();
}
init();
})();
