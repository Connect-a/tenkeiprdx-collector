const KEEP = 8;

const FAILURE_KINDS = [
  { key: 'fails', label: '通信に失敗', note: 'もう一度ダウンロードすると埋まる場合があります' },
  { key: 'missing', label: 'ゲーム側にデータが無い', note: '不足しても再生には影響しません' },
  { key: 'missingVoices', label: '音声が取得できない', note: '' },
];

const arr = (v) => (Array.isArray(v) ? v : []);

export function failureReport(result) {
  const r = result || {};
  const out = { counts: {}, items: {}, total: 0 };
  for (const k of FAILURE_KINDS) {
    const list = arr(r[k.key]).map(String);
    out.counts[k.key] = list.length;
    out.items[k.key] = list.slice(0, KEEP);
    out.total += list.length;
  }
  return out;
}

export const hasFailures = (rep) => !!(rep && rep.total);

export const failureSummary = (rep) => FAILURE_KINDS.map((k) => `${k.label}${(rep && rep.counts[k.key]) || 0}件`).join('／');

export function failureGroups(rep) {
  if (!rep) return [];
  return FAILURE_KINDS.filter((k) => rep.counts[k.key] > 0).map((k) => ({
    key: k.key,
    label: k.label,
    note: k.note,
    count: rep.counts[k.key],
    items: rep.items[k.key] || [],
    more: Math.max(0, rep.counts[k.key] - (rep.items[k.key] || []).length),
  }));
}

export function failureText(rep) {
  return failureGroups(rep)
    .map((g) => `${g.label}（${g.count}件${g.note ? '・' + g.note : ''}）\n・${g.items.join('\n・')}${g.more ? `\n…ほか${g.more}件` : ''}`)
    .join('\n');
}
