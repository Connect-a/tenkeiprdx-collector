import { fileStore } from '../../core/fsdir.js';
import { getById, el } from '../../core/dom.js';
import { playerState } from '../runtime/player-state.js';
import { nameFix, kanaKey } from '../ui/ui-format.js';
import { getPanel } from '../runtime/panel-state.js';

function voiceTypeLabel(v) {
  const s = String(v || '');
  if (/^vo\d/i.test(s)) return 'キャラボイス';
  if (/^c_\d/i.test(s)) return 'advボイス';
  if (/^s_\d/i.test(s)) return 'EXボイス';
  return s ? 'ボイス' : '';
}

async function buildLineIndex() {
  if (!playerState.cur) return [];
  if (playerState.cur.lineIndex) return playerState.cur.lineIndex;
  const out = [];
  for (const ep of playerState.cur.meta.episodes || []) {
    if (ep.have === 'none') continue;
    const merged = [];
    for (const s of ep.scenes || []) {
      const f = await fileStore.readUnder(playerState.cur.handle, s.timeline);
      if (!f) continue;
      let tl = null;
      try {
        tl = JSON.parse(await f.text());
      } catch (e) {}
      if (!tl || !Array.isArray(tl.lines)) continue;
      for (const ln of tl.lines) merged.push(ln);
    }
    for (const ln of merged) {
      const text = ln.text || '';
      if (!text) continue;
      const speaker = ln.speaker || '';
      out.push({ ep, speaker, text, voice: ln.voice || '', vtype: voiceTypeLabel(ln.voice), key: kanaKey(text) + '\u0001' + kanaKey(speaker) });
    }
  }
  playerState.cur.lineIndex = out;
  return out;
}

export function resetLineSearch() {
  const s = getById('lineSearch');
  if (s) s.value = '';
  const h = getById('lineHits');
  if (h) {
    h.style.display = 'none';
    h.innerHTML = '';
  }
  const n = getById('lineSearchNote');
  if (n) n.textContent = '';
  const eplist = getById('eplist');
  if (eplist) eplist.style.display = '';
}

async function jumpToLine(h) {
  const storyPanel = getPanel('story');
  if (storyPanel) await storyPanel.playEpisode(h.ep, h.text);
  const stage = getById('stage');
  if (stage && stage.scrollIntoView) stage.scrollIntoView({ block: 'nearest' });
}

export async function runLineSearch() {
  if (!playerState.cur) return;
  const search = getById('lineSearch');
  const hits = getById('lineHits');
  const note = getById('lineSearchNote');
  const eplist = getById('eplist');
  if (!search || !hits || !note || !eplist) return;
  const q = (search.value || '').trim();
  if (!q) {
    hits.style.display = 'none';
    hits.innerHTML = '';
    note.textContent = '';
    eplist.style.display = '';
    return;
  }
  note.textContent = '検索中…';
  const idx = await buildLineIndex();
  const qq = kanaKey(q);
  const CAP = 300;
  const found = idx.filter((h) => h.key.includes(qq)).slice(0, CAP);
  note.textContent = `${found.length}${found.length >= CAP ? '+（上位' + CAP + '）' : ''}件`;
  eplist.style.display = 'none';
  hits.style.display = '';
  hits.innerHTML = '';
  if (!found.length) {
    hits.innerHTML = '<div class="emptyrow">一致する発言がありません。</div>';
    return;
  }
  for (const h of found) {
    const row = el('div', {
      class: 'linehit',
      html: '<div class="lh-top"><span class="lh-sp"></span><span class="lh-ep"></span><span class="lh-vt"></span></div><div class="lh-tx"></div>',
      on: { click: () => jumpToLine(h) },
    });
    row.querySelector('.lh-sp').textContent = nameFix(h.speaker) || '（地の文）';
    row.querySelector('.lh-ep').textContent = `${h.ep.label || ''} ${h.ep.title || ''}`.trim();
    const vt = row.querySelector('.lh-vt');
    if (h.vtype) vt.textContent = h.vtype;
    else vt.remove();
    row.querySelector('.lh-tx').textContent = nameFix(h.text) || '';
    hits.appendChild(row);
  }
}
