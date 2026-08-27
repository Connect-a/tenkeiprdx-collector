import { collectionRepository } from '../../data/collection.js';
import { assetAcquirer } from '../../data/acquire/acquire-assemble.js';
import { episodeIdOf } from '../../data/character-meta.js';
import { characterMeta } from '../../data/character-meta.js';
import { getById, el } from '../../core/dom.js';
import { xposNames } from '../../core/constants.js';
import { playerState } from '../runtime/player-state.js';
import { nameFix, chip, html, raw, spinnerHtml } from '../ui/ui-format.js';
import { closeRoster } from './roster-view.js';
import { folderHandle } from '../runtime/state-refresh.js';
import { getStoryPanel, getImagePanel } from '../runtime/panel-state.js';
import { utilHelpers } from '../../core/util.js';
import { voiceOut } from '../panels/voice-out.js';
import { runDownload } from './download-ui.js';
import { resetLineSearch } from './line-search.js';
import { renderVoiceGallery } from './voice-gallery.js';
import { applyKindTabs, resetVisualPanel, switchTab } from './shell-ui.js';
import { navTo } from '../runtime/router-controller.js';
import { migrateR18Episodes } from '../../data/acquire/r18-migrate.js';

const labelSpan = (text) => el('span', 'dinfo-label', text);
const valueSpan = (val) => el('span', 'dinfo-value', nameFix(val));

const inlineRow = (pairs) => {
  const items = pairs.filter(([, v]) => v);
  return items.length
    ? el(
        'div',
        'dinforow inline',
        items.map(([label, val]) => el('span', 'dinfoitem', [labelSpan(label), valueSpan(val)])),
      )
    : null;
};
const labeledRow = (label, val) => (val ? el('div', 'dinforow', [labelSpan(label), valueSpan(val)]) : null);

export async function appendDetailInfo(charId, rosterKind) {
  if (rosterKind !== 'character') return;
  let d = null;
  try {
    d = await collectionRepository.characterDetail(charId);
  } catch (e) {}
  const rows = d
    ? [
        inlineRow([
          ['グループ', d.group],
          ['ランク', d.rank],
          ['種族', d.race],
          ['CV', d.cv],
        ]),
        inlineRow([
          ['すき', d.likes],
          ['きらい', d.dislikes],
          ['特技', d.specialty],
          ['スリーサイズ', Array.isArray(d.bwh) ? `B${d.bwh[0]} W${d.bwh[1]} H${d.bwh[2]}` : ''],
        ]),
        labeledRow('自己紹介', d.intro),
        labeledRow('秘密1', d.profile1),
        labeledRow('秘密2', d.profile2),
      ]
    : [];
  getById('charHead').appendChild(el('div', 'dinfo', rows));
}

function renderEpisodes(m) {
  const box = getById('eplist');
  box.innerHTML = '';
  const eps = m.episodes || [];
  if (!eps.some((e) => e.have !== 'none')) {
    box.innerHTML = '<div class="emptyrow">取得済みの話がありません。「再DL」で取得してください。</div>';
    getById('stage').style.display = 'none';
    return;
  }

  let curChapter = m.chapter || null;
  for (const ep of eps) {
    if (ep.chapter && ep.chapter !== curChapter) {
      curChapter = ep.chapter;
      box.appendChild(el('div', 'epchapter', ep.chapter));
    }
    const naLabel = ep.gate === 'locked' ? (m.rosterKind === 'main' || m.rosterKind === 'event' ? '未クリア' : '未解放') : '未取得';
    const playable = ep.have !== 'none' || !!ep.linkTo;
    const row = el('div', {
      class: 'eprow' + (playable ? '' : ' na'),
      data: { epid: String(episodeIdOf(ep)) },
      html: html`<span class="lbl">${ep.label || ''}</span><span class="ti"></span><span class="cats"></span><span class="epid">#${episodeIdOf(ep)}</span
        ><span class="vc"
          >${ep.linkTo ? 'R18版' : ep.have !== 'none' ? ep.lineCount + '行' + (ep.voiced ? ' / 音声' + ep.voiced : '') + (ep.have === 'partial' ? ' / 続き未取得' : '') : naLabel}</span
        >`,
    });
    row.querySelector('.ti').textContent = ep.title || '';
    for (const n of xposNames(ep.xpos)) row.querySelector('.cats').appendChild(el('span', 'epcat', n));
    if (playable) {
      row.addEventListener('click', () => navTo(playerState.rosterKind || 'character', String(m.id || playerState.viewKey()), { section: 'story', epId: String(episodeIdOf(ep)), replace: true }));
    }
    box.appendChild(row);
  }
  getById('stage').style.display = 'none';
  getById('controls').style.display = 'none';
}

export async function openCharacter(folderKey) {
  closeRoster();
  const storyPanel = getStoryPanel();
  if (storyPanel) storyPanel.reset();
  resetVisualPanel();
  voiceOut.stop();
  if (playerState.cur && playerState.cur.voiceUrls) utilHelpers.revokeUrlMap(playerState.cur.voiceUrls);

  const imagePanel = getImagePanel();
  if (imagePanel && imagePanel.resetForCharacter) imagePanel.resetForCharacter();
  const handle = folderHandle(folderKey);
  if (!handle) return;
  playerState.navId = String(folderKey);

  try {
    const { folderMeta } = await collectionRepository.folderModel();
    await migrateR18Episodes(folderKey, (folderMeta[String(folderKey)] || {}).episodes);
  } catch (e) {}

  let m = null;
  try {
    m = await assetAcquirer.charMeta(folderKey);
  } catch (e) {}
  if (!m) m = { name: folderKey, episodes: [] };

  playerState.cur = { folderKey: String(folderKey), handle, meta: m, voiceUrls: new Map() };

  getById('empty').style.display = 'none';
  getById('detail').style.display = '';
  getById('dlbar').style.display = 'none';
  getById('playwrap').style.display = '';

  const eps = (m.episodes || []).filter((e) => !e.linkTo);
  const avail = eps.filter((e) => e.have !== 'none').length;
  getById('charHead').innerHTML = html`<div class="charhead-top">
    <h2>${raw(chip(m.rosterKind))} ${nameFix(characterMeta.displayName(m) || folderKey)} <span class="hint">#${folderKey}</span></h2>
    <button class="btn xs" id="reDl">再DL</button>
    <span class="note"><span class="dim">取得 ${avail}/${eps.length}話${m.builtAt ? '・DL ' + new Date(m.builtAt).toLocaleString('ja-JP') : ''}</span></span>
  </div>`;

  getById('reDl').addEventListener('click', () => runDownload(String(folderKey), getById('reDl')));

  await appendDetailInfo(folderKey, m.rosterKind);
  resetLineSearch();
  renderVoiceGallery();
  applyKindTabs(m.rosterKind);
  return true;
}

export function ensureEpisodes(folderKey) {
  const cur = playerState.cur;
  if (!cur) return null;
  const key = String(folderKey || cur.folderKey || '');
  if (!key || key !== String(cur.folderKey)) return null;
  if (!cur.epLoad) cur.epLoad = loadEpisodesDeferred(key);
  return cur.epLoad;
}

export function reloadEpisodes() {
  if (!playerState.cur) return null;
  playerState.cur.epLoad = null;
  return ensureEpisodes();
}

export async function showSection(folderKey, section, epId) {
  const key = String(folderKey);
  if (playerState.viewKey() !== key) return;
  switchTab(section);
  if (section !== 'story') {
    const imagePanel = getImagePanel();
    if (imagePanel && imagePanel.visualsReady) await imagePanel.visualsReady();
    if (playerState.viewKey() === key) ensureEpisodes(key);
    return;
  }
  await ensureEpisodes(key);
  if (playerState.viewKey() !== key || !epId) return;
  const eps = (playerState.cur.meta && playerState.cur.meta.episodes) || [];
  const ep = eps.find((e) => String(episodeIdOf(e)) === String(epId));
  if (!ep || (ep.have === 'none' && !ep.linkTo)) return;
  const row = getById('eplist').querySelector(`.eprow[data-epid="${CSS.escape(String(epId))}"]`);
  if (row) row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const storyPanel = getStoryPanel();
  if (storyPanel) storyPanel.playEpisode(ep);
}

function renderRoutingWarning(m) {
  const head = getById('charHead');
  const old = head.querySelector('.routewarn');
  if (old) old.remove();
  const cp = m && m.completeness;
  if (!cp) return;
  const unresolved = (cp.sceneUnresolved || 0) + (cp.castUnresolved || 0) + (cp.sceneDlFailed || 0);
  if (!unresolved) return;
  const routing = m.routing || {};
  let bg = 0,
    bgm = 0,
    se = 0;
  const items = [];
  const kindOf = (u) => (/^bgm:/.test(u) ? ['BGM', u.slice(4)] : /^se:/.test(u) ? ['SE', u.slice(3)] : ['背景', u]);
  for (const u of routing.unresolved || []) {
    const [k, name] = kindOf(u);
    if (k === 'BGM') bgm++;
    else if (k === 'SE') se++;
    else bg++;
    items.push([k, name]);
  }
  for (const u of routing.dlFailed || []) {
    const [k, name] = kindOf(u);
    items.push([k + '（取得失敗）', name]);
  }
  for (const id of routing.unresolvedCast || []) items.push(['cast', String(id)]);
  const parts = [];
  if (bg) parts.push(`背景${bg}`);
  if (bgm) parts.push(`BGM${bgm}`);
  if (se) parts.push(`SE${se}`);
  if (cp.castUnresolved) parts.push(`cast${cp.castUnresolved}`);
  if (cp.sceneDlFailed) parts.push(`取得失敗${cp.sceneDlFailed}`);

  const detail = el(
    'div',
    { class: 'rw-detail', style: { display: 'none' } },
    items.map(([k, name]) => el('div', 'rw-item', [el('span', 'rw-kind', k), el('span', null, name)])),
  );
  const label = (open) => `⚠ 不足しているデータ ${unresolved}件（${parts.join('・')}） ${open ? '▼' : '▶'}`;
  const headEl = el('div', {
    class: 'rw-head',
    text: label(false),
    on: {
      click: () => {
        const open = detail.style.display === 'none';
        detail.style.display = open ? '' : 'none';
        headEl.textContent = label(open);
      },
    },
  });
  const castIds = routing.unresolvedCast || [];
  if (castIds.length) detail.appendChild(castRepairRow(castIds, m));
  head.appendChild(el('div', 'routewarn', [headEl, detail]));
}

function castRepairRow(ids, m) {
  const note = el('span', 'note dim');
  const btn = el('button', {
    class: 'btn xs primary',
    text: `不足している立ち絵を取得（${ids.length}体）`,
    on: {
      click: async () => {
        btn.disabled = true;
        try {
          const r = await assetAcquirer.runCastRepair(ids, (msg) => {
            note.textContent = msg;
          });
          if (r.noAsset.length) note.textContent += `／ゲーム側に立ち絵が無い ${r.noAsset.length}体（${r.noAsset.join(',')}）`;
          await reloadEpisodes();
        } catch (e) {
          note.textContent = e && e.message ? e.message : String(e);
          btn.disabled = false;
        }
      },
    },
  });
  return el('div', 'rw-fix', [btn, note]);
}

async function loadEpisodesDeferred(folderKey) {
  const box = getById('eplist');
  if (box) box.innerHTML = spinnerHtml('エピソードを読み込み中…');
  getById('stage').style.display = 'none';
  const key = playerState.viewKey();
  let full = null;
  try {
    full = await assetAcquirer.charMetaFull(folderKey);
  } catch (e) {}
  if (playerState.viewKey() !== key) return;
  if (!full) {
    if (box) box.innerHTML = '<div class="emptyrow">エピソードの読み込みに失敗しました</div>';
    return;
  }
  playerState.cur.meta = full;
  renderRoutingWarning(full);
  renderEpisodes(full);
}
