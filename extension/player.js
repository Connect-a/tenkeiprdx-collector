'use strict';
(() => {
const CFG = globalThis.TP_CONFIG;
const COLLECTION = globalThis.TP_COLLECTION;
const ACQUIRE = globalThis.TP_ACQUIRE;
const BULK = globalThis.TP_BULK;
const IDB = globalThis.TP_IDB;
const FS = globalThis.TP_FS;
const D = globalThis.TP_DECODE;
const V = globalThis.TP_VISUAL;
const CHARASSETS = globalThis.TP_CHARASSETS;
const PLAYER_AUDIO = globalThis.TP_PLAYER_AUDIO;
const PLAYER_IMAGE = globalThis.TP_PLAYER_IMAGE;
const PLAYER_STORY = globalThis.TP_PLAYER_STORY;
const $ = (id) => document.getElementById(id);

const TYPE_LABEL = { character: 'キャラ', main: 'メイン', event: 'イベント', special: '特別', home: 'ホーム' };
const catOf = (m) => (m && m.type === 'character') ? 'character' : (m && m.type === 'special') ? 'special' : (m && m.cat) ? m.cat : 'main';
const chip = (t) => (TYPE_LABEL[t] ? `<span class="chip ${t}">${TYPE_LABEL[t]}</span>` : '');
const nameFix = (s) => (s || '').replace(/%username%/g, '主人公');

const kanaKey = (s) => String(s || '').replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).toLowerCase();

const S = {
  dl: [], owned: new Map(), binlistScenes: new Set(), paidUnlocked: new Set(), clearedNodes: new Set(), fsGranted: false,
  rosterOpen: false, rosterType: 'character', rosterOwn: 'all', rosterGroup: '', rosterRank: '', cur: null,
  navId: null,
  scene: null, idx: 0, autoTimer: null, epVoiceUrls: null, extractedSids: null,
  imageAutoKey: null,
};

let imagePanel = null;
let audioPanel = null;
let letterPanel = null;
let storyPanel = null;

async function refreshLists() {
  S.fsGranted = false;
  if (FS && FS.supported) { try { S.fsGranted = (await FS.permission(false)) === 'granted'; } catch (e) {} }
  updateFsUi();
  if (S.fsGranted) { try { COLLECTION.saveMasterArtifacts && COLLECTION.saveMasterArtifacts(); } catch (e) {} }
  S.dl = []; S.owned = new Map();
  try { S.paidUnlocked = await COLLECTION.unlockedPaidSet(); } catch (e) { S.paidUnlocked = new Set(); }
  try { S.clearedNodes = await COLLECTION.clearedNodeSet(); } catch (e) { S.clearedNodes = new Set(); }
  if (S.fsGranted) {
    try { S.dl = await COLLECTION.scanFolder(); } catch (e) { console.error(e); }
    try { S.owned = await COLLECTION.ownedLevels(); } catch (e) {}
  }
  try { S.binlistScenes = await ACQUIRE.binlistSceneSet(); } catch (e) { S.binlistScenes = new Set(); }
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
  if (location.hash === next) return;
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
  if (V && V.disposeGallery) { try { V.disposeGallery(); } catch (e) {} }
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

function tokRemain(exp) {
  if (!exp) return '';
  const secs = Math.floor(exp - Date.now() / 1000);
  if (secs <= 0) return '失効';
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
  return `残り約${h > 0 ? h + '時間' + m + '分' : m + '分'}`;
}
async function updateConn() {
  const o = await chrome.storage.local.get(['capturing', 'captureLive', 'captureError', 'apiAuth', 'apiAuthBad']);
  const on = !!o.capturing, live = !!o.captureLive;
  const tok = o.apiAuth && o.apiAuth.authorization;
  const exp = o.apiAuth && o.apiAuth.exp;
  const expired = !!(exp && Math.floor(Date.now() / 1000) >= exp);
  const hasToken = !!(tok && tok !== o.apiAuthBad && !expired);
  const tokenBad = !!(tok && (tok === o.apiAuthBad || expired));
  const b = $('connToggle'); b.textContent = on ? '接続を解除' : 'ゲームと接続'; b.className = on ? 'btn rec' : 'btn primary'; b.dataset.on = on ? '1' : '';
  const ru = $('refreshUser'); if (ru) ru.style.display = hasToken ? '' : 'none';
  const el = $('connInfo');
  el.textContent = (on && !live) ? (o.captureError || 'ゲームタブ未接続（ライブのゲームを開く／DevToolsを閉じて再接続）') : '';

  const remain = hasToken ? tokRemain(exp) : '';
  let cls = null, label = null;
  if (hasToken) {
    cls = 'ok'; label = remain || 'トークン取得済み';
  } else if (on && live && tokenBad) {
    cls = 'bad'; label = expired ? 'トークン失効' : 'トークン切れ';
  } else if (on && live) {
    cls = 'wait'; label = 'トークン待ち';
  } else if (tokenBad) {
    cls = 'bad'; label = expired ? 'トークン失効（接続して取り直し）' : 'トークン切れ（接続して取り直し）';
  }
  if (label) {
    const badge = document.createElement('span');
    badge.className = 'tokbadge ' + cls;
    badge.textContent = label;
    el.appendChild(document.createTextNode(' '));
    el.appendChild(badge);
  }
}

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
  if (S.rosterType === 'home') { await renderHome(); return; }
  const bulkBtn = $('bulkOpen'); if (bulkBtn) bulkBtn.textContent = `一括ダウンロード（${TYPE_LABEL[S.rosterType] || ''}）`;
  const grid = $('rosterGrid');
  if (!grid.children.length) grid.innerHTML = '<div class="loadspin"><span class="spin"></span><span class="loadtxt">読み込み中…</span></div>';
  let folderMeta = {}; try { ({ folderMeta } = await COLLECTION.indexes()); } catch (e) {}
  grid.innerHTML = '';
  populateFilterSelects(folderMeta);
  const capturing = !!(await chrome.storage.local.get('capturing')).capturing;
  const hasData = S.owned.size > 0 || S.dl.length > 0;

  const showControls = S.fsGranted && hasData;
  const setD = (id, v) => { const el = $(id); if (el) el.style.display = v; };
  if (!showControls) {
    for (const id of ['rosterSearch', 'rosterType', 'rosterOwn', 'rosterGroup', 'rosterRank', 'bulkOpen', 'sharedDl', 'rostercount']) setD(id, 'none');
  } else {
    for (const id of ['rosterSearch', 'rosterType', 'bulkOpen', 'sharedDl', 'rostercount']) setD(id, '');
    setD('rosterOwn', S.rosterType === 'character' ? '' : 'none');
  }
  if (!S.fsGranted || !hasData) grid.appendChild(buildOnboard(S.fsGranted, capturing, hasData));
  if (!S.fsGranted) { $('rostercount').textContent = ''; return; }

  const model = await rosterModel(folderMeta);
  for (const g of model.groups) {
    if (!g.items.length) continue;
    const h = document.createElement('div'); h.className = 'rgroup'; h.textContent = `${g.title}（${g.items.length}）`; grid.appendChild(h);
    const wrap = document.createElement('div'); wrap.className = 'rostercards';
    g.items.forEach((it) => wrap.appendChild(rcard(it)));
    grid.appendChild(wrap);
  }
  $('rostercount').textContent = model.count;
}

async function rosterModel(folderMeta) {
  if (!folderMeta) { try { ({ folderMeta } = await COLLECTION.indexes()); } catch (e) { folderMeta = {}; } }
  const dlMap = new Map(S.dl.map((x) => [String(x.charId), x]));
  const type = S.rosterType, f = ($('rosterSearch').value || '').trim(), fk = kanaKey(f);
  const byName = (a, b) => (a.name > b.name ? 1 : -1);
  if (type === 'character') {
    const distSet = S.binlistScenes || new Set();
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
      const distCov = isOwned ? 0 : ACQUIRE.binlistEpisodesCovered(m, distSet);
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

  let lv = '';
  if (isCharacter) lv = it.level != null ? `Lv${it.level}` : '未所持';
  else if (isQuest) lv = it.fullCleared ? '全クリア' : (it.unlocked > 0 ? `${it.unlocked}話クリア` : '未クリア');
  else if (it.special) lv = it.unlockedAvail > 0 ? '解放済み' : '未解放';
  const badge = it.status === 'dl' ? `<span class="rst dl">DL済 ${it.covered}話</span>` : (it.distFull ? '<span class="rst dist">シーン取得済</span>' : '');

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

// メアド(任意)。保存/クリアはサイドバー設定の既存ロジック(storage＋おてがみ欄同期)を再利用する。
function buildEmailStep() {
  const st = document.createElement('div'); st.className = 'step active';
  const onum = document.createElement('span'); onum.className = 'onum'; onum.textContent = '0';
  const olabel = document.createElement('span'); olabel.className = 'olabel';
  olabel.appendChild(document.createTextNode('メールアドレス（入力不要）'));
  const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px;margin-top:6px;flex-wrap:wrap';
  const input = document.createElement('input'); input.type = 'email'; input.placeholder = 'you@example.com';
  input.style.cssText = 'flex:1;min-width:180px;box-sizing:border-box;background:#201e2a;color:#e8e6f0;border:1px solid #363248;border-radius:6px;padding:6px 8px;font-size:12px';
  const save = document.createElement('button'); save.className = 'btn xs'; save.textContent = '保存';
  row.appendChild(input); row.appendChild(save);
  const note = document.createElement('div'); note.className = 'note dim'; note.style.marginTop = '4px';
  note.textContent = '入力せずとも機能に変化や欠落はありません。あとでサイドバーの「設定」からいつでも変更・削除できます。';
  olabel.appendChild(row); olabel.appendChild(note);
  st.appendChild(onum); st.appendChild(olabel);
  try { chrome.storage.local.get('email').then((o) => { if (o.email) input.value = o.email; }); } catch (e) {}
  save.addEventListener('click', () => {
    const v = (input.value || '').trim(); const ef = $('email'); if (ef) ef.value = v;
    const btn = $(v ? 'emailSave' : 'emailClear'); if (btn) btn.click();
    toast(v ? 'メールアドレスを保存しました' : 'メールアドレスをクリアしました', 'ok');
  });
  return st;
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
    <div class="note dim" style="margin-top:10px">※接続後、所持キャラの解放済みストーリーをAPIで取得し選択フォルダへ保存します。</div>
    <div class="note dim" style="margin-top:4px">※取得したデータ（ストーリー・ボイス・画像等）は私的な閲覧のみに使用し、再配布・公開はしないでください。</div>`;
  box.insertBefore(buildEmailStep(), box.querySelector('.obh').nextSibling);
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

function openRoster() { S.rosterOpen = true; S.cur = null; if (storyPanel) storyPanel.reset(); clearHash(); $('roster').style.display = ''; $('empty').style.display = 'none'; $('detail').style.display = 'none'; renderRoster(); }
function closeRoster() { S.rosterOpen = false; $('roster').style.display = 'none'; if (!S.cur) showEmptyIdle(); }

const bulkOpts = { unlockedMode: 'only', overwrite: false, includeUnowned: false, dlIntervalSec: 300 };

async function collectBulkCandidates() {
  const type = S.rosterType;
  let folderMeta = {}; try { ({ folderMeta } = await COLLECTION.indexes()); } catch (e) {}
  const list = [];
  for (const [id, m] of Object.entries(folderMeta)) {
    if (catOf(m) !== type) continue;
    const name = (m.title ? m.name + m.title : m.name) || id;
    if (type === 'character') {
      if (!S.owned.has(id)) {
        const total = (m.episodes || []).length;
        const distFull = total > 0 && ACQUIRE.binlistEpisodesCovered(m, S.binlistScenes || new Set()) === total;
        if (distFull) list.push({ id, name, type, total, full: true, dist: true });
        else if (bulkOpts.includeUnowned) list.push({ id, name, type, total, full: false, unowned: true });
        continue;
      }
      const level = S.owned.get(id);
      const full = level != null && level >= 70;
      if (bulkOpts.unlockedMode === 'only' && !full) continue;
      list.push({ id, name, type, total: (m.episodes || []).length, full });
    } else if (type === 'special') {

      const unlockedAvail = (m.episodes || []).filter((e) => (S.paidUnlocked || new Set()).has(String(e.paidMasterId))).length;
      if (!unlockedAvail) continue;
      list.push({ id, name, type, total: unlockedAvail, full: true });
    } else {

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
  if (_singleDLActive) { toast('個別DLの実行中です。完了してから一括DLしてください。', 'err'); return; }
  const list = S._bulkCandidates || (await collectBulkCandidates());
  if (!list.length) { toast('対象が0件です', 'err'); return; }
  const root = FS && FS.supported ? await FS.ensure() : null;
  if (!root) { toast('先に保存先フォルダを選んでください', 'err'); return; }
  const r = await BULK.start(list, { overwrite: bulkOpts.overwrite, dlIntervalSec: bulkOpts.dlIntervalSec || 300 });
  if (!r.ok) { toast(r.reason === 'active' ? '既に実行中です' : '開始できませんでした', 'err'); return; }
  await renderBulkCard();
}

const PHASE_LABEL = { running: '実行中', done: '完了', stopped: '停止', error: 'エラー' };

async function renderBulkFailures(st) {
  const wrap = $('bulkFailWrap'), sum = $('bulkFailSummary'), list = $('bulkFailList');
  if (!wrap) return;
  let m = null; try { m = await ACQUIRE.cdnMissingSummary(); } catch (e) {}
  const rows = (m && m.rows) || [];
  if (!rows.length) { wrap.style.display = 'none'; list.innerHTML = ''; return; }
  wrap.style.display = '';
  sum.textContent = `CDN欠落 ${m.chars}キャラ / ${m.stories}話 / ${m.scenes}scene（URL${m.withUrl}）`;
  list.innerHTML = '';
  const bar = document.createElement('div'); bar.style.cssText = 'margin:0 0 6px;display:flex;gap:8px;';
  const copyBtn = document.createElement('button'); copyBtn.textContent = '欠損URLをコピー'; copyBtn.style.cssText = 'font-size:11px;padding:2px 8px;';
  copyBtn.addEventListener('click', async () => {
    const urls = [];
    for (const c of Object.values((m.data && m.data.chars) || {})) for (const s of Object.values(c.stories || {})) for (const sc of Object.values(s.scenes || {})) if (sc.url) urls.push(sc.url);
    try { await navigator.clipboard.writeText(urls.join('\n')); copyBtn.textContent = `コピー済 ${urls.length}件`; } catch (e) { copyBtn.textContent = 'コピー失敗'; }
  });
  const clrBtn = document.createElement('button'); clrBtn.textContent = 'クリア'; clrBtn.style.cssText = 'font-size:11px;padding:2px 8px;';
  clrBtn.addEventListener('click', async () => { await ACQUIRE.clearCdnMissing(); await renderBulkFailures(st); });
  bar.appendChild(copyBtn); bar.appendChild(clrBtn); list.appendChild(bar);
  for (const r of rows) {
    const d = document.createElement('div');
    d.className = 'bk-fail soft';
    d.textContent = `${r.name || r.charId}${r.title || ''}｜${r.label || r.epId}${r.epTitle ? '「' + r.epTitle + '」' : ''}｜${r.scenes}scene欠落`;
    list.appendChild(d);
  }
}

async function renderBulkCard() {
  const st = await BULK.getState();
  const card = $('bulkCard'), startBtn = $('bulkStart'), stopBtn = $('bulkStop'), clearBtn = $('bulkClear'), tbody = $('bulkTable').querySelector('tbody');
  if (!st) { card.style.display = 'none'; startBtn.style.display = ''; stopBtn.style.display = 'none'; if (clearBtn) clearBtn.style.display = 'none'; tbody.innerHTML = ''; await renderBulkFailures(null); return; }
  const active = BULK.isActive(st.phase);
  const s = BULK.stats(st.items);
  const gd = st.gd || { total: 0, done: 0, failed: 0 };
  startBtn.style.display = active ? 'none' : '';
  startBtn.disabled = false;
  stopBtn.style.display = active ? '' : 'none';
  if (clearBtn) clearBtn.style.display = active ? 'none' : '';
  await renderBulkFailures(st);
  card.style.display = '';

  const rows = [];
  rows.push(`<div class="bk-line"><span class="bk-phase ${st.phase}">${PHASE_LABEL[st.phase] || ''}</span> キャラ処理 ${s.processed}/${s.total}${s.dl ? '（DL中' + s.dl + '）' : ''}</div>`);
  rows.push(`<div class="bk-line dim">ストーリーメタ ${gd.done}/${gd.total}${gd.failed ? '（失敗' + gd.failed + '）' : ''}｜資産DL済 ${s.done} / スキップ ${s.skipped} / 失敗 ${s.failed}</div>`);
  if (active && st.gdStatus) rows.push(`<div class="bk-line dim">${escapeHtml(st.gdStatus)}</div>`);
  if (active && st.currentStatus) rows.push(`<div class="bk-line dim">${escapeHtml(st.currentStatus)}</div>`);
  if (active && st.nextDlAt && st.nextDlAt > Date.now()) {
    const sec = Math.ceil((st.nextDlAt - Date.now()) / 1000);
    rows.push(`<div class="bk-line dim">次のキャラDLまで ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}</div>`);
  }
  if (st.phase === 'error' && st.lastError) rows.push(`<div class="bk-line err">エラー: ${escapeHtml(st.lastError)}</div>`);
  if (st.tokenError) rows.push(`<div class="bk-line err">トークンを取り直したら、もう一度「開始」してください（取得済み資産はスキップされます）。</div>`);
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
    tr.innerHTML = `<td class="bk-name"></td><td class="bk-meta ${metaCls}">${escapeHtml(metaText)}</td><td class="bk-asset dim">${escapeHtml(assetText)}</td><td class="bk-detail dim">${escapeHtml(detailText)}</td>`;
    tr.querySelector('.bk-name').textContent = it.name;
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
    if (label) { const l = document.createElement('span'); l.className = 'dinfo-label'; l.textContent = label; r.appendChild(l); }
    const v = document.createElement('span'); v.className = 'dinfo-value'; v.textContent = nameFix(val); r.appendChild(v);
    box.appendChild(r);
  };

  const addInline = (pairs) => {
    const items = pairs.filter(([, v]) => v);
    if (!items.length) return;
    const r = document.createElement('div'); r.className = 'dinforow inline';
    for (const [label, val] of items) {
      const it = document.createElement('span'); it.className = 'dinfoitem';
      const l = document.createElement('span'); l.className = 'dinfo-label'; l.textContent = label;
      const v = document.createElement('span'); v.className = 'dinfo-value'; v.textContent = nameFix(val);
      it.appendChild(l); it.appendChild(v); r.appendChild(it);
    }
    box.appendChild(r);
  };
  if (d) {
    addInline([['グループ', d.group], ['ランク', d.rank], ['種族', d.race]]);
    addInline([['すき', d.likes], ['きらい', d.dislikes], ['特技', d.specialty], ['スリーサイズ', Array.isArray(d.bwh) ? `B${d.bwh[0]} W${d.bwh[1]} H${d.bwh[2]}` : '']]);
    add('自己紹介', d.intro);
    add('秘密1', d.profile1); add('秘密2', d.profile2);
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

let _singleDLActive = false;
async function runDownload(folderKey) {
  try { const bst = await BULK.getState(); if (bst && BULK.isActive(bst.phase)) { toast('一括DLの実行中です。完了または停止してから個別DLしてください。', 'err'); return; } } catch (e) {}
  _singleDLActive = true;
  $('dlbar').style.display = ''; $('dlbar').classList.remove('err'); setProgress('開始…', 0);
  const btn = $('doDl'); if (btn) btn.disabled = true;
  try {
    const root = FS && FS.supported ? await FS.ensure() : null;
    if (!root) { setProgress('先に保存先フォルダを選んでください', 0); await refreshLists(); return; }
    await ACQUIRE.collectStory(folderKey, setProgress);
    const r = await ACQUIRE.downloadCharacterAssets(folderKey, setProgress);
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
  } finally { _singleDLActive = false; if (btn) btn.disabled = false; }
}
function setProgress(msg, frac) { $('dlmsg').textContent = msg; $('dlfill').style.width = Math.round((frac || 0) * 100) + '%'; }

async function openCharacter(folderKey) {
  closeRoster();
  if (storyPanel) storyPanel.reset();
  resetVisualPanel();
  if (S.epVoiceUrls) for (const u of S.epVoiceUrls.values()) URL.revokeObjectURL(u);
  if (S.cur && S.cur.voiceUrls) for (const u of S.cur.voiceUrls.values()) URL.revokeObjectURL(u);
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
    const unresolved = (cp.sceneUnresolved || 0) + (cp.castUnresolved || 0);

    if (unresolved) {
      const line = document.createElement('div');
      line.className = 'routewarn';
      line.textContent = `⚠ ルーティング未解決 ${unresolved}件（シーン資産${cp.sceneUnresolved || 0}/cast${cp.castUnresolved || 0}）`;
      $('charHead').appendChild(line);
    }
  }
  await appendDetailInfo(folderKey, m.type);
  resetLineSearch();
  renderEpisodes(m); renderVoiceGallery(); switchTab('image');
}

function renderEpisodes(m) {
  const box = $('eplist'); box.innerHTML = '';
  const eps = m.episodes || [];
  if (!eps.some((e) => e.available)) { box.innerHTML = '<div class="emptyrow">取得済みの話がありません。「再DL」で取得してください。</div>'; $('stage').style.display = 'none'; return; }
  let curChapter = null;
  eps.forEach((ep) => {

    if (ep.chapter && ep.chapter !== curChapter) {
      curChapter = ep.chapter;
      const h = document.createElement('div'); h.className = 'epchapter'; h.textContent = ep.chapter; box.appendChild(h);
    }
    const row = document.createElement('div');
    row.className = 'eprow' + (ep.available ? '' : ' na');
    const naLabel = ep.locked ? (m.type === 'quest' ? '未クリア' : '未解放') : '未取得';
    row.innerHTML = `<span class="lbl">${ep.label || ''}</span><span class="ti"></span><span class="epid">#${ep.episodeMasterId}</span><span class="vc">${ep.available ? (ep.lineCount + '行' + (ep.voiced ? ' / 音声' + ep.voiced : '')) : naLabel}</span>`;
    row.querySelector('.ti').textContent = ep.title || '';
    if (ep.available) row.addEventListener('click', () => { document.querySelectorAll('.eprow').forEach((x) => x.classList.remove('sel')); row.classList.add('sel'); if (storyPanel) storyPanel.playEpisode(ep); });
    box.appendChild(row);
  });
  $('stage').style.display = 'none'; $('controls').style.display = 'none';
}

// ストーリー演出再生はstoryPanel(TP_PLAYER_STORY)＝実ゲーム忠実のHUD+エンジンに委譲。

const VOICE_SITUATION = {
  1: '自己紹介', 2: 'バトル開始', 3: 'ボス戦開始', 4: '通常攻撃', 5: 'スキル攻撃', 6: '必殺技',
  7: 'とどめ', 8: '被ダメージ', 9: '戦闘不能', 10: '状態異常', 11: '勝利', 12: '宝箱を開ける',
  13: '10ターン経過', 14: '作戦変更', 15: '強化', 16: 'ランクアップ', 17: '編成変更', 18: '特技習得',
  19: '会話1', 20: '会話2', 21: '会話3', 22: 'タップ', 23: '放置', 24: '誕生日', 25: 'バレンタイン',
  26: 'ホワイトデー', 27: 'お正月', 28: 'クリスマス', 29: 'タイトル', 30: 'プレイヤー誕生日', 31: 'ログインボーナス',
};

function voiceTypeLabel(v) {
  const s = String(v || '');
  if (/^vo\d/i.test(s)) return 'キャラボイス';
  if (/^c_\d/i.test(s)) return 'advボイス';
  if (/^s_\d/i.test(s)) return 'EXボイス';
  return s ? 'ボイス' : '';
}

async function buildLineIndex() {
  if (!S.cur) return [];
  if (S.cur.lineIndex) return S.cur.lineIndex;
  const out = [];
  for (const ep of (S.cur.meta.episodes || [])) {
    if (!ep.available) continue;
    const merged = [];
    for (const s of (ep.scenes || [])) {
      const f = await FS.readUnder(S.cur.handle, s.timeline);
      if (!f) continue;
      let tl = null; try { tl = JSON.parse(await f.text()); } catch (e) {}
      if (!tl || !Array.isArray(tl.lines)) continue;
      for (const ln of tl.lines) merged.push(ln);
    }
    merged.forEach((ln, pos) => {
      const text = ln.text || '';
      if (!text) return;
      out.push({ ep, pos, speaker: ln.speaker || '', text, voice: ln.voice || '', vtype: voiceTypeLabel(ln.voice) });
    });
  }
  S.cur.lineIndex = out;
  return out;
}

function resetLineSearch() {
  const s = $('lineSearch'); if (s) s.value = '';
  const h = $('lineHits'); if (h) { h.style.display = 'none'; h.innerHTML = ''; }
  const n = $('lineSearchNote'); if (n) n.textContent = '';
  const el = $('eplist'); if (el) el.style.display = '';
}

async function runLineSearch() {
  if (!S.cur) return;
  const q = ($('lineSearch').value || '').trim();
  const hits = $('lineHits'), note = $('lineSearchNote'), eplist = $('eplist');
  if (!q) { hits.style.display = 'none'; hits.innerHTML = ''; note.textContent = ''; eplist.style.display = ''; return; }
  note.textContent = '検索中…';
  const idx = await buildLineIndex();
  const qq = q.toLowerCase();
  const CAP = 300;
  const found = idx.filter((h) => h.text.toLowerCase().includes(qq) || (h.speaker || '').toLowerCase().includes(qq)).slice(0, CAP);
  note.textContent = `${found.length}${found.length >= CAP ? '+（上位' + CAP + '）' : ''}件`;
  eplist.style.display = 'none';
  hits.style.display = '';
  hits.innerHTML = '';
  if (!found.length) { hits.innerHTML = '<div class="emptyrow">一致する発言がありません。</div>'; return; }
  for (const h of found) {
    const row = document.createElement('div'); row.className = 'linehit';
    row.innerHTML = '<div class="lh-top"><span class="lh-sp"></span><span class="lh-ep"></span><span class="lh-vt"></span></div><div class="lh-tx"></div>';
    row.querySelector('.lh-sp').textContent = nameFix(h.speaker) || '（地の文）';
    row.querySelector('.lh-ep').textContent = `${h.ep.label || ''} ${h.ep.title || ''}`.trim();
    const vt = row.querySelector('.lh-vt'); if (h.vtype) vt.textContent = h.vtype; else vt.remove();
    row.querySelector('.lh-tx').textContent = nameFix(h.text) || '';
    row.addEventListener('click', () => jumpToLine(h));
    hits.appendChild(row);
  }
}

async function jumpToLine(h) {
  if (storyPanel) await storyPanel.playEpisode(h.ep, h.text);
  const stage = $('stage'); if (stage && stage.scrollIntoView) stage.scrollIntoView({ block: 'nearest' });
}

async function renderVoiceGallery() {
  const grid = $('voicegrid'); grid.innerHTML = '';
  if (!(S.cur.meta && S.cur.meta.voiceGallery)) { $('voiceNote').textContent = 'このキャラのキャラボイスは未取得です。'; return; }
  const clips = await CHARASSETS.extractClips(S.cur.handle, S.cur.meta.voiceGallery);
  const voiceNo = (nm) => { const m = String(nm).match(/_(\d+)[a-z]*$/i); return m ? parseInt(m[1], 10) : 0; };
  clips.sort((a, b) => voiceNo(a.name) - voiceNo(b.name) || (a.name > b.name ? 1 : -1));
  $('voiceNote').textContent = clips.length ? `キャラボイス ${clips.length} 件（番号順）` : 'キャラボイスを展開できませんでした。';

  let vmsg = {};
  try { const d = await COLLECTION.characterDetail(S.cur.charId); if (d && d.voiceMessages) vmsg = d.voiceMessages; } catch (e) {}
  if (!Object.keys(vmsg).length) vmsg = (S.cur.meta && S.cur.meta.profile && S.cur.meta.profile.voiceMessages) || {};
  for (const c of clips) {
    const no = voiceNo(c.name);
    const card = document.createElement('div'); card.className = 'voicecard';
    card.innerHTML = '<div class="voicecard-name"></div><div class="voicecard-serif"></div><div class="voicecard-id"></div>';
    card.querySelector('.voicecard-name').textContent = VOICE_SITUATION[no] || `No.${String(no).padStart(3, '0')}`;
    const serif = vmsg[no] != null ? vmsg[no] : vmsg[String(no)];
    const vs = card.querySelector('.voicecard-serif'); if (serif) vs.textContent = nameFix(serif); else vs.remove();
    card.querySelector('.voicecard-id').textContent = c.name;
    card.addEventListener('click', () => {
      document.querySelectorAll('.voicecard').forEach((x) => x.classList.remove('playing')); card.classList.add('playing');
      if (!S.cur.voiceUrls.has(c.name)) S.cur.voiceUrls.set(c.name, URL.createObjectURL(new Blob([c.data], { type: 'audio/mp4' })));
      const a = $('audio'); a.src = S.cur.voiceUrls.get(c.name); a.play().catch(() => {});
    });
    grid.appendChild(card);
  }
}

// 背景/スチル(Texture2D・crunch)bundle → canvas。Unityは下方向格納なので上下反転して正立させる。
function illustBundleToCanvas(bytes) {
  const MESH = globalThis.TP_MESH, TX = globalThis.TP_TEXCODEC;
  if (!MESH || !MESH.decodeTextureRgba) return null;
  let dec = null; try { dec = MESH.decodeTextureRgba(bytes); } catch (e) {}
  if (!dec || !dec.rgba || !dec.width || !dec.height) return null;
  const rgba = (TX && TX.flipRgbaY) ? TX.flipRgbaY(dec.rgba, dec.width, dec.height) : dec.rgba;
  const src = rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  const cv = document.createElement('canvas'); cv.width = dec.width; cv.height = dec.height;
  cv.getContext('2d').putImageData(new ImageData(src, dec.width, dec.height), 0, 0);
  return cv;
}

// ===== ホーム枠（シーンイラスト / 1コマ漫画 / ホームBGM）=====
let _homeBgmSel = null;            // 拡張再生中のBGM {id,name,path}
let _homeBgmMode = 'repeat';       // 'repeat'(1曲リピート) | 'shuffle'
let _homeBgmDownloaded = [];       // シャッフル候補 [{id,name,path}]
const _homeBgmUrls = new Map();    // bundlePath -> objectURL
const _homeVoiceUrls = new Map();  // "id:voiceId" -> objectURL

async function readHomeBundle(sub) {
  try { const d = await FS.getDir('_ホーム', false); if (!d) return null; const f = await FS.readUnder(d, sub); if (!f) return null; return new Uint8Array(await f.arrayBuffer()); } catch (e) { return null; }
}

const _home = { refs: new Map(), got: null, headers: null, items: null };
const HOME_KIND_LABEL = { sceneIllust: 'シーンイラスト', comic: '1コマ漫画', homeBgm: 'ホームBGM' };
const homePrimary = (kind, m) => !m ? null : (kind === 'sceneIllust' ? m.cg : kind === 'comic' ? m.img : m.audio);

// DDSテクスチャ(DXT5/DXT1)→canvas。1コマ漫画のstatics直URL資産用。下向き格納なので反転して正立。
function ddsToCanvas(bytes) {
  const TX = globalThis.TP_TEXCODEC; if (!TX || !bytes || bytes.length < 128) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x20534444) return null; // 'DDS '
  const height = dv.getUint32(12, true), width = dv.getUint32(16, true);
  const fourCC = String.fromCharCode(bytes[84], bytes[85], bytes[86], bytes[87]);
  const data = bytes.subarray(128);
  let rgba = null;
  try { if (fourCC === 'DXT5') rgba = TX.decodeDxt5Rgba(data, width, height); else if (fourCC === 'DXT1') rgba = TX.decodeDXT1(data, width, height); } catch (e) {}
  if (!rgba || !width || !height) return null;
  if (TX.flipRgbaY) rgba = TX.flipRgbaY(rgba, width, height); // DDSは下向き格納→正立へ
  const src = rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  const cv = document.createElement('canvas'); cv.width = width; cv.height = height;
  cv.getContext('2d').putImageData(new ImageData(src, width, height), 0, 0);
  return cv;
}
function homeAssetToCanvas(sub, bytes) { return /\.dds$/i.test(sub || '') ? ddsToCanvas(bytes) : illustBundleToCanvas(bytes); }

async function renderHome() {
  const grid = $('rosterGrid');
  for (const id of ['rosterSearch', 'rosterOwn', 'rosterGroup', 'rosterRank', 'bulkOpen', 'sharedDl']) { const el = $(id); if (el) el.style.display = 'none'; }
  $('rostercount').textContent = '';
  if (!S.fsGranted) { grid.innerHTML = ''; grid.appendChild(buildOnboard(false, false, false)); return; }
  grid.innerHTML = '<div class="loadspin"><span class="spin"></span><span class="loadtxt">読み込み中…</span></div>';

  let data = { sceneIllust: [], comic: [], homeBgm: [] };
  try { data = await COLLECTION.homeData(); } catch (e) {}
  const manifest = (await COLLECTION.scanHome()) || null;
  const mMap = (arr) => new Map((arr || []).map((e) => [String(e.id), e]));
  const dl = { sceneIllust: mMap(manifest && manifest.sceneIllust), comic: mMap(manifest && manifest.comic), homeBgm: mMap(manifest && manifest.homeBgm) };

  _home.refs = new Map();
  _home.items = data;
  _home.dl = dl;
  _home.got = { sceneIllust: new Set(), comic: new Set(), homeBgm: new Set() };
  _home.headers = {};
  for (const kind of ['sceneIllust', 'comic', 'homeBgm']) for (const e of data[kind]) if (homePrimary(kind, dl[kind].get(String(e.id)))) _home.got[kind].add(String(e.id));
  setHomeBgmDownloaded(data.homeBgm.map((e) => { const mm = dl.homeBgm.get(String(e.id)); return (mm && mm.audio) ? { id: e.id, name: e.name, path: mm.audio } : null; }).filter(Boolean));

  grid.innerHTML = '';
  const bar = document.createElement('div'); bar.className = 'homebar';
  const dlBtn = document.createElement('button'); dlBtn.className = 'btn primary'; dlBtn.id = 'homeDl';
  dlBtn.textContent = 'ホームのリソースダウンロード';
  const pbar = document.createElement('div'); pbar.className = 'hpbar'; pbar.id = 'homePbar'; pbar.style.display = 'none'; pbar.innerHTML = '<i></i>';
  const status = document.createElement('span'); status.className = 'note dim'; status.id = 'homeDlStatus';
  bar.appendChild(dlBtn); bar.appendChild(pbar); bar.appendChild(status); grid.appendChild(bar);

  dlBtn.addEventListener('click', async () => {
    const root = FS && FS.supported ? await FS.ensure() : null;
    if (!root) { toast('先に保存先フォルダを選んでください', 'err'); return; }
    dlBtn.disabled = true; pbar.style.display = '';
    const total = data.sceneIllust.length + data.comic.length + data.homeBgm.length;
    let processed = 0;
    const fill = pbar.querySelector('i');
    try {
      const r = await ACQUIRE.collectHome(null, (kind, entry) => {
        processed++;
        if (fill) fill.style.width = Math.round(total ? processed / total * 100 : 0) + '%';
        status.textContent = `取得中… ${processed}/${total}`;
        applyHomeItem(kind, entry);
      });
      status.textContent = `完了 取得${r.got}／既存${r.skip}／欠番${r.miss}／未解決${r.unresolved}`;
      toast(`ホーム取得 完了（取得${r.got}／既存${r.skip}／欠番${r.miss}／未解決${r.unresolved}）`, 'ok');
    } catch (e) {
      const msg = e && e.auth ? 'トークン切れ（ゲームと接続）' : (e && e.message ? e.message : e);
      status.textContent = '中断: ' + msg; toast('ホーム取得中断: ' + msg, 'err');
    } finally { dlBtn.disabled = false; }
  });

  // ページ内リンク(ホームは長いので各セクションへジャンプ)
  const nav = document.createElement('div'); nav.className = 'homenav';
  for (const [kind, label] of [['sceneIllust', `シーンイラスト ${data.sceneIllust.length}`], ['comic', `1コマ漫画 ${data.comic.length}`], ['homeBgm', `ホームBGM ${data.homeBgm.length}`]]) {
    const a = document.createElement('button'); a.className = 'homenavlink'; a.textContent = label;
    a.addEventListener('click', () => { const h = _home.headers[kind]; if (h && h.scrollIntoView) h.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    nav.appendChild(a);
  }
  grid.appendChild(nav);

  homeSection(grid, 'sceneIllust', data.sceneIllust, dl.sceneIllust, homeIllustCard);
  homeSection(grid, 'comic', data.comic, dl.comic, homeComicCard);
  if (!data.staticsBase) {
    const kd = data.catalogDiag || {};
    const note = document.createElement('div'); note.className = 'note dim'; note.style.margin = '-6px 0 14px'; note.style.wordBreak = 'break-all';
    note.textContent = `※1コマ漫画の配信元(statics)を特定できませんでした（EnvConfig: ${kd.step || '?'}${kd.envErr ? '/' + kd.envErr : ''}）。ゲームと接続して索引を再生成してください。`;
    grid.appendChild(note);
  }
  homeSectionBgm(grid, data.homeBgm, dl.homeBgm);
}

function homeHeaderText(kind) {
  const list = (_home.items && _home.items[kind]) || [];
  return `${HOME_KIND_LABEL[kind]}（取得 ${_home.got[kind].size}/${list.length}）`;
}

function homeSection(grid, kind, list, dlMap, cardFn) {
  const h = document.createElement('div'); h.className = 'rgroup'; grid.appendChild(h);
  _home.headers[kind] = h; h.textContent = homeHeaderText(kind);
  const wrap = document.createElement('div'); wrap.className = 'homegrid'; grid.appendChild(wrap);
  for (const e of list) { const card = cardFn(e, dlMap.get(String(e.id))); wrap.appendChild(card); _home.refs.set(kind + ':' + e.id, { el: card, item: e, wrap }); }
}

// カードのサムネは重い(crunch展開)ので可視域に入ってから遅延デコード。
const _homeThumbObs = ('IntersectionObserver' in window) ? new IntersectionObserver((ents, obs) => {
  for (const en of ents) if (en.isIntersecting) { obs.unobserve(en.target); loadHomeThumb(en.target); }
}, { rootMargin: '120px' }) : null;
async function loadHomeThumb(el) {
  const sub = el.dataset.thumb; if (!sub || el.dataset.loaded) return; el.dataset.loaded = '1';
  const bytes = await readHomeBundle(sub); if (!bytes) return;
  const cv = homeAssetToCanvas(sub, bytes); if (!cv) return;
  const W = 200, t = document.createElement('canvas'); const scale = Math.min(1, W / cv.width);
  t.width = Math.round(cv.width * scale); t.height = Math.round(cv.height * scale);
  t.getContext('2d').drawImage(cv, 0, 0, t.width, t.height);
  el.innerHTML = ''; el.appendChild(t);
}
function homeThumb(sub) {
  const th = document.createElement('div'); th.className = 'hcthumb';
  if (sub) { th.dataset.thumb = sub; if (_homeThumbObs) _homeThumbObs.observe(th); else loadHomeThumb(th); }
  else { th.classList.add('empty'); }
  return th;
}

function homeIllustCard(e, m) {
  const voiced = !!(e.lines && e.lines.length);
  const card = document.createElement('div'); card.className = 'homecard' + (m && m.cg ? '' : ' un');
  card.appendChild(homeThumb(m && m.cg ? m.cg : null));
  const nm = document.createElement('div'); nm.className = 'hcname'; nm.textContent = nameFix(e.name || e.id);
  card.appendChild(nm);
  if (voiced) { const v = document.createElement('span'); v.className = 'hcvoice'; v.textContent = `♪${e.lines.length}`; card.appendChild(v); }
  if (m && m.cg) card.addEventListener('click', () => openHomeByItem('sceneIllust', e.id));
  return card;
}

function homeComicCard(e, m) {
  const card = document.createElement('div'); card.className = 'homecard' + (m && m.img ? '' : ' un');
  card.appendChild(homeThumb(m && m.img ? m.img : null));
  const nm = document.createElement('div'); nm.className = 'hcname'; nm.textContent = nameFix(e.title || e.id);
  card.appendChild(nm);
  if (m && m.img) card.addEventListener('click', () => openHomeByItem('comic', e.id));
  return card;
}

function homeBgmGlyph(active) { const p = $('homeBgmPlayer'); return (active && p && !p.paused) ? '⏸' : '▶'; }
function homeBgmBtn(e, m) {
  const btn = document.createElement('button');
  const active = _homeBgmSel && String(_homeBgmSel.id) === String(e.id);
  btn.className = 'homebgmbtn' + (active ? ' active' : '') + ((m && m.audio) ? '' : ' un');
  btn.innerHTML = '<span class="hbnote"></span><span class="hbname"></span>';
  btn.querySelector('.hbnote').textContent = homeBgmGlyph(active);
  btn.querySelector('.hbname').textContent = nameFix(e.name || e.id);
  if (m && m.audio) btn.addEventListener('click', () => toggleHomeBgm(e, m));
  else btn.title = e.audioResolvable ? '未取得（ホームのリソースダウンロード）' : 'カタログ未解決';
  return btn;
}

function homeSectionBgm(grid, list, dlMap) {
  const h = document.createElement('div'); h.className = 'rgroup'; grid.appendChild(h);
  _home.headers.homeBgm = h; h.textContent = homeHeaderText('homeBgm');
  const note = document.createElement('div'); note.className = 'note dim'; note.style.margin = '0 0 8px'; note.textContent = 'クリックでこの拡張機能の再生BGMに設定（選択中をもう一度で一時停止/再開・解除はヘッダーの×）。再生モードと選択はヘッダーの♪から。設定は保存され次回も再生します。';
  grid.appendChild(note);
  const wrap = document.createElement('div'); wrap.className = 'homebgmgrid'; grid.appendChild(wrap);
  for (const e of list) { const btn = homeBgmBtn(e, dlMap.get(String(e.id))); wrap.appendChild(btn); _home.refs.set('homeBgm:' + e.id, { el: btn, item: e, wrap }); }
}

// DL完了1件ごとに該当カードだけ差し替え、セクション件数を更新（リアクティブ表示）。
function applyHomeItem(kind, entry) {
  if (S.rosterType !== 'home' || !_home.refs) return;
  if (_home.dl && _home.dl[kind]) _home.dl[kind].set(String(entry.id), entry); // 送りリスト用に最新DLを反映
  const ref = _home.refs.get(kind + ':' + entry.id); if (!ref) return;
  const fresh = kind === 'sceneIllust' ? homeIllustCard(ref.item, entry) : kind === 'comic' ? homeComicCard(ref.item, entry) : homeBgmBtn(ref.item, entry);
  if (ref.el.parentNode) ref.el.parentNode.replaceChild(fresh, ref.el);
  ref.el = fresh;
  if (homePrimary(kind, entry)) {
    _home.got[kind].add(String(entry.id)); const h = _home.headers[kind]; if (h) h.textContent = homeHeaderText(kind);
    if (kind === 'homeBgm' && entry.audio && !_homeBgmDownloaded.some((x) => String(x.id) === String(entry.id))) setHomeBgmDownloaded(_homeBgmDownloaded.concat([{ id: entry.id, name: entry.name, path: entry.audio }]));
  }
}

// 開けるのはDL済み(primaryあり)の項目のみ。左右送りはこのリスト内を循環。
function homeOpenableList(kind) {
  const items = (_home.items && _home.items[kind]) || [];
  const dl = _home.dl && _home.dl[kind];
  const out = [];
  for (const e of items) { const m = dl && dl.get(String(e.id)); if (m && homePrimary(kind, m)) out.push({ e, m }); }
  return out;
}
let _homeView = null;
function openHomeByItem(kind, id) { const list = homeOpenableList(kind); const idx = list.findIndex((x) => String(x.e.id) === String(id)); if (idx >= 0) openHomeAt(kind, idx, list); }
function openHomeAt(kind, idx, list) {
  list = list || homeOpenableList(kind); if (!list.length) return;
  idx = (idx % list.length + list.length) % list.length;
  _homeView = { kind, idx };
  const { e, m } = list[idx];
  const title = `${kind === 'comic' ? nameFix(e.title || e.id) : nameFix(e.name || e.id)}　(${idx + 1}/${list.length})`;
  const body = kind === 'sceneIllust' ? buildIllustBody(e, m) : buildImageBody(m.img);
  openOverlay(title, body, { onPrev: () => openHomeAt(kind, idx - 1, list), onNext: () => openHomeAt(kind, idx + 1, list) });
}

function buildIllustBody(e, m) {
  const body = document.createElement('div'); body.className = 'homeview';
  const holder = document.createElement('div'); holder.className = 'homeimgholder'; body.appendChild(holder);
  (async () => { const bytes = await readHomeBundle(m.cg); const cv = bytes ? illustBundleToCanvas(bytes) : null; if (cv) { cv.className = 'homeviewimg'; holder.appendChild(cv); } else holder.textContent = 'CGを展開できませんでした'; })();
  const lines = e.lines || [];
  if (lines.length) {
    const lw = document.createElement('div'); lw.className = 'homelines';
    lines.forEach((ln, i) => {
      const row = document.createElement('div'); row.className = 'homeline';
      const b = document.createElement('button'); b.className = 'btn xs'; b.textContent = '▶';
      const tx = document.createElement('span'); tx.textContent = nameFix((ln.text || '').replace(/\\n|\r?\n/g, ' '));
      row.appendChild(b); row.appendChild(tx); lw.appendChild(row);
      b.addEventListener('click', () => playHomeVoice(e, m, ln, i, row));
    });
    body.appendChild(lw);
  }
  return body;
}

function buildImageBody(sub) {
  const body = document.createElement('div'); body.className = 'homeview';
  const holder = document.createElement('div'); holder.className = 'homeimgholder'; body.appendChild(holder);
  (async () => { const bytes = await readHomeBundle(sub); const cv = bytes ? homeAssetToCanvas(sub, bytes) : null; if (cv) { cv.className = 'homeviewimg'; holder.appendChild(cv); } else holder.textContent = '画像を展開できませんでした'; })();
  return body;
}

async function playHomeVoice(e, m, ln, i, row) {
  if (!m.voice) { toast('この台詞の音声は未取得です', 'err'); return; }
  row.parentNode.querySelectorAll('.homeline').forEach((x) => x.classList.remove('playing')); row.classList.add('playing');
  const key = String(e.id) + ':' + String(ln.voiceId);
  if (!_homeVoiceUrls.has(key)) {
    const bytes = await readHomeBundle(m.voice); if (!bytes) { toast('音声を読めませんでした', 'err'); return; }
    let clips = []; try { clips = D.extractVoiceClips(bytes); } catch (e2) {}
    if (!clips.length) { toast('音声を展開できませんでした', 'err'); return; }
    const byName = new Map(clips.map((c) => [c.name, c.data]));
    const data = byName.get(ln.voiceId) || clips[i] && clips[i].data || clips[0].data;
    _homeVoiceUrls.set(key, URL.createObjectURL(new Blob([data], { type: 'audio/mp4' })));
  }
  const a = $('audio'); a.src = _homeVoiceUrls.get(key); a.play().catch(() => {});
}

function applyBgmLoop() { const p = $('homeBgmPlayer'); if (p) p.loop = (_homeBgmMode === 'repeat'); }

async function homeBgmUrl(path) {
  if (!path) return null;
  if (_homeBgmUrls.has(path)) return _homeBgmUrls.get(path);
  const bytes = await readHomeBundle(path); if (!bytes) return null;
  let clips = []; try { clips = D.extractAudioResource(bytes); } catch (e) {}
  if (!clips.length) return null;
  const url = URL.createObjectURL(new Blob([clips[0]], { type: 'audio/mp4' }));
  _homeBgmUrls.set(path, url); return url;
}

async function setHomeBgm(sel) {
  _homeBgmSel = { id: sel.id, name: sel.name, path: sel.path }; // 先にハイライト(復号待ちのラグを体感させない)
  updateHomeBgmWidget(); refreshHomeBgmButtons();
  const url = await homeBgmUrl(sel.path); if (!url) { toast('BGMを展開できませんでした', 'err'); return false; }
  const p = $('homeBgmPlayer'); p.src = url; p.volume = 0.4; applyBgmLoop(); p.play().catch(() => {});
  try { await chrome.storage.local.set({ homeBgmSel: _homeBgmSel }); } catch (e) {}
  updateHomeBgmWidget(); refreshHomeBgmButtons();
  return true;
}

// ホーム全体を再描画せず、BGMボタンの選択状態(緑+♪)だけ更新。
function refreshHomeBgmButtons() {
  if (!_home.refs) return;
  for (const [key, ref] of _home.refs) {
    if (!key.startsWith('homeBgm:')) continue;
    const active = !!(_homeBgmSel && String(_homeBgmSel.id) === key.slice(8));
    ref.el.classList.toggle('active', active);
    const n = ref.el.querySelector('.hbnote'); if (n) n.textContent = homeBgmGlyph(active);
  }
}

async function toggleHomeBgm(e, m) {
  if (_homeBgmSel && String(_homeBgmSel.id) === String(e.id)) { pauseResumeHomeBgm(); return; } // 選択中を再クリック＝一時停止/再開(解除はヘッダーの×)
  await setHomeBgm({ id: e.id, name: e.name, path: m.audio });
}

async function clearHomeBgm() {
  const p = $('homeBgmPlayer'); if (p) p.pause();
  _homeBgmSel = null; try { await chrome.storage.local.remove('homeBgmSel'); } catch (e) {}
  updateHomeBgmWidget(); refreshHomeBgmButtons();
}

function pauseResumeHomeBgm() {
  const p = $('homeBgmPlayer'); if (!p || !_homeBgmSel) return;
  if (p.paused) p.play().catch(() => {}); else p.pause();
  updateHomeBgmWidget(); refreshHomeBgmButtons();
}

async function setBgmMode(mode) {
  _homeBgmMode = mode;
  try { await chrome.storage.local.set({ homeBgmMode: mode }); } catch (e) {}
  applyBgmLoop(); updateHomeBgmWidget();
}

// 曲終端: リピート以外は次の曲へ（シャッフル=ランダム / sequence=上から順に循環）。
async function playNextBgm() {
  if (!_homeBgmDownloaded.length) return;
  let next = null;
  if (_homeBgmMode === 'shuffle') {
    if (_homeBgmDownloaded.length === 1) next = _homeBgmDownloaded[0];
    else { do { next = _homeBgmDownloaded[Math.floor(Math.random() * _homeBgmDownloaded.length)]; } while (_homeBgmSel && String(next.id) === String(_homeBgmSel.id)); }
  } else {
    const i = _homeBgmDownloaded.findIndex((x) => _homeBgmSel && String(x.id) === String(_homeBgmSel.id));
    next = _homeBgmDownloaded[i < 0 ? 0 : (i + 1) % _homeBgmDownloaded.length];
  }
  if (next) await setHomeBgm(next);
}
function onHomeBgmEnded() { if (_homeBgmMode !== 'repeat') playNextBgm(); }

// menuの再生ボタン: 選択があれば再生/停止、無ければモードに従って開始。
async function menuPlayToggle() {
  if (_homeBgmSel) { pauseResumeHomeBgm(); return; }
  if (!_homeBgmDownloaded.length) { toast('先にホームBGMをダウンロードしてください', 'err'); return; }
  const first = _homeBgmMode === 'shuffle' ? _homeBgmDownloaded[Math.floor(Math.random() * _homeBgmDownloaded.length)] : _homeBgmDownloaded[0];
  await setHomeBgm(first);
}

function toggleBgmMenu(show) {
  const menu = $('hbMenu'); if (!menu) return;
  const vis = (show == null) ? (menu.style.display === 'none') : show;
  menu.style.display = vis ? '' : 'none';
}

// ヘッダーの♪ウィジェット(アイコン→メニュー: タイトル/モード/再生停止/解除)。
function updateHomeBgmWidget() {
  const w = $('homeBgmWidget'); if (!w) return;
  const has = !!_homeBgmSel || _homeBgmDownloaded.length > 0;
  w.style.display = has ? '' : 'none';
  if (!has) return;
  const p = $('homeBgmPlayer'); const playing = !!(_homeBgmSel && p && !p.paused);
  const title = _homeBgmSel ? nameFix(_homeBgmSel.name || _homeBgmSel.id) : '';
  const icon = $('hbIcon'); if (icon) { icon.classList.toggle('playing', playing); icon.classList.toggle('has-title', !!title); }
  const ct = $('hbChipTitle'); if (ct) ct.textContent = title;
  const t = $('hbMenuTitle'); if (t) t.textContent = title || '未選択';
  $('hbModeRepeat') && $('hbModeRepeat').classList.toggle('active', _homeBgmMode === 'repeat');
  $('hbModeShuffle') && $('hbModeShuffle').classList.toggle('active', _homeBgmMode === 'shuffle');
  $('hbModeSeq') && $('hbModeSeq').classList.toggle('active', _homeBgmMode === 'sequence');
  const tog = $('hbMenuToggle'); if (tog) tog.textContent = playing ? '⏸ 停止' : '▶ 再生';
}

function setHomeBgmDownloaded(list) { _homeBgmDownloaded = list || []; updateHomeBgmWidget(); }

async function restoreHomeBgm() {
  try {
    const st = await chrome.storage.local.get(['homeBgmSel', 'homeBgmMode']);
    if (st.homeBgmMode) _homeBgmMode = st.homeBgmMode;
    if (!S.fsGranted) { updateHomeBgmWidget(); return; }
    const manifest = await COLLECTION.scanHome();
    if (manifest) _homeBgmDownloaded = (manifest.homeBgm || []).filter((x) => x.audio).map((x) => ({ id: x.id, name: x.name, path: x.audio }));
    const sel = st.homeBgmSel;
    if (sel && sel.path) {
      const url = await homeBgmUrl(sel.path);
      if (url) { _homeBgmSel = sel; const p = $('homeBgmPlayer'); p.src = url; p.volume = 0.4; applyBgmLoop(); p.play().catch(() => {}); }
    }
    updateHomeBgmWidget();
  } catch (e) {}
}

function closeHomeOverlay() { const ov = $('homeOverlay'); if (ov) ov.style.display = 'none'; _homeView = null; }
function openOverlay(title, body, nav) {
  let ov = $('homeOverlay');
  if (!ov) { ov = document.createElement('div'); ov.id = 'homeOverlay'; ov.className = 'modalback'; document.body.appendChild(ov); ov.addEventListener('click', (ev) => { if (ev.target === ov) closeHomeOverlay(); }); }
  ov.innerHTML = '';
  const box = document.createElement('div'); box.className = 'modal homemodal';
  const hd = document.createElement('div'); hd.className = 'modalhd';
  const prev = document.createElement('button'); prev.className = 'btn xs hbnav'; prev.textContent = '◀'; prev.title = '前 (←)';
  const t = document.createElement('span'); t.className = 'homehdtitle'; t.textContent = title;
  const next = document.createElement('button'); next.className = 'btn xs hbnav'; next.textContent = '▶'; next.title = '次 (→)';
  const x = document.createElement('button'); x.className = 'btn xs'; x.textContent = '閉じる'; x.addEventListener('click', closeHomeOverlay);
  if (nav) { prev.addEventListener('click', nav.onPrev); next.addEventListener('click', nav.onNext); } else { prev.style.display = 'none'; next.style.display = 'none'; }
  hd.appendChild(prev); hd.appendChild(t); hd.appendChild(next); hd.appendChild(x); box.appendChild(hd);
  const bodyWrap = document.createElement('div'); bodyWrap.className = 'modalbody'; bodyWrap.appendChild(body); box.appendChild(bodyWrap);
  ov.appendChild(box); ov.style.display = '';
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === name));
  if (imagePanel && imagePanel.onTabSwitched) imagePanel.onTabSwitched(name);
  if (storyPanel && storyPanel.onTabSwitched) storyPanel.onTabSwitched(name);
  if (name === 'story') refreshSharedNotice();
}

async function refreshSharedNotice() {
  const box = $('sharedNotice'); if (!box) return;
  let present = true; try { present = await ACQUIRE.sharedResourcesPresent(); } catch (e) {}
  if (present) { box.style.display = 'none'; box.innerHTML = ''; return; }
  box.style.display = ''; box.innerHTML = '';
  const msg = document.createElement('div'); msg.className = 'note'; msg.textContent = 'ストーリー再生には共有リソース（背景・BGM・SE・フォント・演出）が必要です。まだダウンロードされていません。';
  const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:10px;align-items:center;margin-top:8px;flex-wrap:wrap';
  const btn = document.createElement('button'); btn.className = 'btn primary'; btn.textContent = '共有リソースをダウンロード';
  const prog = document.createElement('span'); prog.className = 'note dim';
  row.appendChild(btn); row.appendChild(prog); box.appendChild(msg); box.appendChild(row);
  btn.addEventListener('click', async () => {
    const root = FS && FS.supported ? await FS.ensure() : null;
    if (!root) { toast('先に保存先フォルダを選んでください', 'err'); return; }
    btn.disabled = true;
    try { const r = await ACQUIRE.buildSharedResources((m) => { prog.textContent = m; }); toast(`共有リソース 取得${r.got}/既存${r.skip}/全${r.total}`, 'ok'); await refreshSharedNotice(); }
    catch (e) { const m = e && e.auth ? 'トークン切れ（ゲームと接続）' : (e && e.message ? e.message : e); prog.textContent = '中断: ' + m; toast('共有リソース中断: ' + m, 'err'); btn.disabled = false; }
  });
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
$('next').addEventListener('click', () => storyPanel && storyPanel.go(1));
$('prev').addEventListener('click', () => storyPanel && storyPanel.go(-1));
$('homeTitle').addEventListener('click', openRoster);
$('backToRoster').addEventListener('click', openRoster);
$('prevChar').addEventListener('click', () => navChar(-1));
$('nextChar').addEventListener('click', () => navChar(1));
$('rosterSearch').addEventListener('input', renderRoster);
let _lineSearchTimer = null;
$('lineSearch').addEventListener('input', () => { clearTimeout(_lineSearchTimer); _lineSearchTimer = setTimeout(runLineSearch, 200); });
$('rosterType').querySelectorAll('.rf').forEach((b) => b.addEventListener('click', () => {
  $('rosterType').querySelectorAll('.rf').forEach((x) => x.classList.remove('active')); b.classList.add('active');
  S.rosterType = b.dataset.rosterType; $('rosterOwn').style.display = S.rosterType === 'character' ? '' : 'none'; renderRoster();
}));
$('rosterGroup').addEventListener('change', () => { S.rosterGroup = $('rosterGroup').value; renderRoster(); });
$('rosterRank').addEventListener('change', () => { S.rosterRank = $('rosterRank').value; renderRoster(); });
$('rosterOwn').querySelectorAll('.rf').forEach((b) => b.addEventListener('click', () => {
  $('rosterOwn').querySelectorAll('.rf').forEach((x) => x.classList.remove('active')); b.classList.add('active'); S.rosterOwn = b.dataset.rosterOwn; renderRoster();
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
  if (!wasOn) _autoDisc = false;
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
    // 接続＝マスタ/カタログを強制再取得(新規に取れれば差し替え・取れなければ旧データ維持)。
    try { await COLLECTION.rebuildIndexes((m) => { $('connInfo').textContent = m; }); } catch (e) { $('connInfo').textContent = '索引生成に失敗（トークン取得後に再試行）'; }
    await refreshLists();
    await maybeAutoDisconnect();
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
  try { const r = await ACQUIRE.buildSharedResources((m) => { out.textContent = m; }); toast(`共有リソース 取得${r.got}/既存${r.skip}/全${r.total}`, 'ok'); }
  catch (e) { const msg = e && e.message ? e.message : e; out.textContent = '中断: ' + msg; toast('共有リソース中断: ' + msg, 'err'); }
  $('sharedDl').disabled = false;
});

twoStep($('resetCap'), '一時データを消す', async () => { try { await IDB.del('userRaw'); } catch (e) {} try { await chrome.storage.local.remove(['apiAuth', 'apiAuthBad']); } catch (e) {} closeDetail(); await refreshLists(); });

$('rebuildIdx').addEventListener('click', async () => {
  const out = $('idxOut'); out.textContent = '再生成中…（接続してトークン取得済みが前提）';
  try { const x = await COLLECTION.rebuildIndexes((m) => { out.textContent = m; }); out.textContent = `完了: キャラ${Object.keys(x.characters).length} / 資産${Object.keys(x.assetIndex).length}`; await refreshLists(); }
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
  setInterval(updateConn, 30000);
  try {
    const o = await chrome.storage.local.get(['email', 'assetRoot']);
    if (o.email) $('email').value = o.email;
    $('cdnBase').value = o.assetRoot || CFG.assetRootDefault;
  } catch (e) {}
  updateCdnReset();
  if (CFG.githubIssuesUrl && $('ghIssue')) { $('ghIssue').href = CFG.githubIssuesUrl; $('ghIssue').style.display = ''; }
  letterPanel = globalThis.TP_PLAYER_LETTER ? globalThis.TP_PLAYER_LETTER.createController({ $, toast, CFG, COLLECTION, nameFix, onDistUpdated: async () => { try { S.binlistScenes = await ACQUIRE.binlistSceneSet(true); } catch (e) {} if (S.rosterOpen) renderRoster(); } }) : null;
  if (letterPanel) { letterPanel.bind(); await letterPanel.refresh(); }
  audioPanel = PLAYER_AUDIO && PLAYER_AUDIO.createController ? PLAYER_AUDIO.createController({ S, $, storage: chrome.storage.local }) : null;
  if (audioPanel && audioPanel.bind) audioPanel.bind();
  if (audioPanel && audioPanel.initFromStorage) await audioPanel.initFromStorage();
  imagePanel = PLAYER_IMAGE && PLAYER_IMAGE.createController ? PLAYER_IMAGE.createController({ S, $, V, FS, D, toast, storage: chrome.storage.local }) : null;
  if (imagePanel && imagePanel.bind) imagePanel.bind();
  if (imagePanel && imagePanel.initFromStorage) await imagePanel.initFromStorage();
  storyPanel = PLAYER_STORY && PLAYER_STORY.createController ? PLAYER_STORY.createController({ S, $, V, nameFix, toast }) : null;
  $('hbIcon')?.addEventListener('click', (ev) => { ev.stopPropagation(); toggleBgmMenu(); updateHomeBgmWidget(); });
  $('hbModeRepeat')?.addEventListener('click', () => setBgmMode('repeat'));
  $('hbModeShuffle')?.addEventListener('click', () => setBgmMode('shuffle'));
  $('hbModeSeq')?.addEventListener('click', () => setBgmMode('sequence'));
  $('hbMenuToggle')?.addEventListener('click', menuPlayToggle);
  $('hbMenuClear')?.addEventListener('click', () => clearHomeBgm());
  $('homeBgmPlayer')?.addEventListener('play', updateHomeBgmWidget);
  $('homeBgmPlayer')?.addEventListener('pause', updateHomeBgmWidget);
  $('homeBgmPlayer')?.addEventListener('ended', onHomeBgmEnded);
  document.addEventListener('click', (ev) => { const w = $('homeBgmWidget'); if (w && w.style.display !== 'none' && !w.contains(ev.target)) toggleBgmMenu(false); });
  document.addEventListener('keydown', (ev) => {
    const ov = $('homeOverlay'); if (!ov || ov.style.display === 'none' || !_homeView) return;
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); openHomeAt(_homeView.kind, _homeView.idx - 1); }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); openHomeAt(_homeView.kind, _homeView.idx + 1); }
    else if (ev.key === 'Escape') closeHomeOverlay();
  });
  try { await COLLECTION.refreshUserViaApi(); } catch (e) {}
  await refreshLists();
  restoreHomeBgm();
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
