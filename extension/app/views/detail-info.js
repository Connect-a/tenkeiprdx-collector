import { collectionRepository } from '../../data/collection.js';
import { getById, el } from '../../core/dom.js';
import { nameFix } from '../ui/ui-format.js';

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
