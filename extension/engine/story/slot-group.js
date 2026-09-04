const SPECIAL_GROUP_RULES = [
  { re: /penis|kougan|tama/i, group: 'penis' },
  { re: /(?=.*(?<!wo)man)(?=.*(?:hand|finger))/i, group: 'hand' },
  { re: /_man_/i, group: 'male' },
];

const MEN_PART = /(?:^|_)men(?=[_0-9])/i;
const HAND_PART = /hand|finger/i;

export const GROUPS = [
  { id: 'female', label: '♀', setting: 'stillGroupFemale' },
  { id: 'male', label: '♂', setting: 'stillGroupMale' },
  { id: 'hand', label: '♂👐', setting: 'stillGroupHand' },
  { id: 'penis', label: '♂♂', setting: 'stillGroupPenis' },
  { id: 'bg', label: '背景', setting: 'stillGroupBg' },
  { id: 'other', label: 'その他', setting: 'stillGroupOther' },
];

const BY_ID = new Map(GROUPS.map((g) => [g.id, g]));

export function slotGroup(name) {
  const s = String(name);
  for (const r of SPECIAL_GROUP_RULES) if (r.re.test(s)) return r.group;
  if (MEN_PART.test(s)) return HAND_PART.test(s) ? 'hand' : 'male';
  if (/^bg/i.test(s)) return 'bg';
  if (/^man_/i.test(s)) return 'male';
  if (/^(frame|template)/i.test(s)) return 'other';
  return 'female';
}

export const groupLabel = (id) => (BY_ID.has(id) ? BY_ID.get(id).label : id);
export const groupSetting = (id) => (BY_ID.has(id) ? BY_ID.get(id).setting : null);

export function groupSlots(names) {
  const by = new Map();
  for (const n of names) {
    const id = slotGroup(n);
    if (!by.has(id)) by.set(id, []);
    by.get(id).push(n);
  }
  return GROUPS.filter((g) => by.has(g.id)).map((g) => ({ id: g.id, label: g.label, names: by.get(g.id).sort((a, b) => a.localeCompare(b)) }));
}
