import { collectionRepository } from '../../data/collection.js';
import { getById, el } from '../../core/dom.js';
import { nameFix } from '../ui/ui-format.js';
import { ensureIndexes } from '../../data/index-store.js';
import { assetStore } from '../../data/asset-store.js';
import { DIRS } from '../../core/dirs.js';
import { unityMesh } from '../../unity/mesh.js';
import { unityDecode } from '../../unity/decode.js';
import { imageZoom } from '../../engine/render/imgzoom.js';
import { voiceOut } from '../panels/voice-out.js';
import { cachedAudioUrl } from '../../core/audio-url.js';
import { toast } from '../ui/notifier.js';
import { noteFailure } from '../../core/failures.js';

const FAILURE_SCOPE = 'キャラ詳細';
const DECODE_FAILED = 'failed';

const _lineUrls = new Map();

function buildStillVoices(si) {
  let clipsJob = null;
  const getClips = () => {
    if (!clipsJob)
      clipsJob = (async () => {
        const voiceRel = ((await ensureIndexes()).assets.illustVoiceIndex || {})[si.id];
        if (!voiceRel) return null;
        const bytes = await assetStore.readAsset(DIRS.home, voiceRel);
        if (!bytes) return null;
        try {
          const clips = (await unityDecode.extractVoiceClips(new Uint8Array(bytes))) || [];
          return clips.length ? clips : null;
        } catch (e) {
          noteFailure(FAILURE_SCOPE, '台詞ボイスの復号', e);
          return DECODE_FAILED;
        }
      })();
    return clipsJob;
  };
  const box = el('div', 'homelines mainstill-voices');
  (si.lines || []).forEach((ln) => {
    const row = el('div', { class: 'homeline', on: { click: play } });
    async function play() {
      const clips = await getClips();
      if (clips === DECODE_FAILED) {
        toast('この台詞の音声を復号できませんでした', 'err');
        return;
      }
      if (!clips) {
        toast('この台詞の音声は未取得です（「ホーム」のダウンロードで取得できます）', 'err');
        return;
      }
      box.querySelectorAll('.homeline').forEach((x) => x.classList.remove('playing'));
      row.classList.add('playing');
      const byName = new Map(clips.map((c) => [c.name, c.data]));
      const url = await cachedAudioUrl(_lineUrls, si.id + '|' + ln.voiceId, async () => byName.get(ln.voiceId) || null);
      if (url) voiceOut.play(url);
      else toast('この台詞の音声がバンドルの中に見つかりませんでした', 'err');
    }
    row.appendChild(el('span', 'homeline-play', '▶'));
    row.appendChild(el('span', null, nameFix((ln.text || '').replace(/\\n|\r?\n/g, ' '))));
    box.appendChild(row);
  });
  return box;
}

async function insertMainStill(dinfo, ms) {
  try {
    const idx = await ensureIndexes();
    const rel = (idx.assets.sceneAssetIndex || {})[ms.still];
    if (!rel) {
      console.warn('[tp] メインビジュアル: 索引に still が無い', ms.still);
      return;
    }
    let bytes = await assetStore.readAsset(DIRS.shared, rel);
    if (!bytes) bytes = await assetStore.readAsset(DIRS.home, rel);
    if (!bytes) {
      console.warn('[tp] メインビジュアル: バンドル未取得', ms.still, rel);
      return;
    }
    const list = unityMesh.decodeAllTextureCanvases(new Uint8Array(bytes));
    const canvas = list && list.length ? list[0] : null;
    if (!canvas) {
      noteFailure(FAILURE_SCOPE, 'メインビジュアルの復号', new Error(ms.still + ' ' + rel));
      return;
    }
    if (!dinfo.isConnected) return;
    const si = ((idx.master.homeIndex && idx.master.homeIndex.sceneIllust) || []).find((s) => s.still === ms.still || (s.stillAdult && s.stillAdult === ms.still));
    const extraGetter = si && (si.lines || []).length ? () => buildStillVoices(si) : null;
    const stillWrap = el('div', 'dinfo-still', [canvas]);
    imageZoom.makeZoomable(stillWrap, () => canvas.toDataURL('image/png'), nameFix(ms.name || ''), extraGetter);
    const rowsWrap = el('div', 'dinfo-rows');
    while (dinfo.firstChild) rowsWrap.appendChild(dinfo.firstChild);
    dinfo.appendChild(stillWrap);
    dinfo.appendChild(rowsWrap);
    dinfo.classList.add('has-still');
  } catch (e) {
    noteFailure(FAILURE_SCOPE, 'メインビジュアル', e);
  }
}

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

export async function stillVoiceLinesFor(charId) {
  try {
    const idx = await ensureIndexes();
    const ms = ((idx.master.characters || {})[String(charId)] || {}).mainStill;
    if (!ms || !ms.still) return null;
    const si = ((idx.master.homeIndex && idx.master.homeIndex.sceneIllust) || []).find((s) => s.still === ms.still || (s.stillAdult && s.stillAdult === ms.still));
    if (!si || !(si.lines || []).length) return null;
    return buildStillVoices(si);
  } catch (e) {
    noteFailure(FAILURE_SCOPE, 'クリックボイス欄', e);
    return null;
  }
}

export async function appendDetailInfo(charId, rosterKind) {
  if (rosterKind !== 'character') return;
  let d = null;
  try {
    d = await collectionRepository.characterDetail(charId);
  } catch (e) {
    noteFailure(FAILURE_SCOPE, 'プロフィール', e);
  }
  const rows = d
    ? [
        inlineRow([
          ['所属', d.affiliation],
          ['レアリティ', d.rarity],
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
  const dinfo = el('div', 'dinfo', rows);
  getById('charHead').appendChild(dinfo);
  if (d && d.mainStill && d.mainStill.still) void insertMainStill(dinfo, d.mainStill);
}
