const SPECIAL_GROUP_RULES = [
  { re: /penis|kougan|tama/i, group: '♂♂' },
  { re: /(?=.*(?<!wo)man)(?=.*(?:hand|finger))/i, group: '♂👐' },
  { re: /_man_/i, group: '♂' },
];

export function slotGroup(name) {
  const s = String(name);
  for (const r of SPECIAL_GROUP_RULES) if (r.re.test(s)) return r.group;
  if (/^bg/i.test(s)) return '背景';
  if (/^man_/i.test(s)) return '♂';
  if (/^(frame|template)/i.test(s)) return 'その他';
  return '♀';
}
