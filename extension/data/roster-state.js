const allOpen = (it) => !!it && it.counts.total > 0 && it.counts.open >= it.counts.total;
const allHave = (it) => !!it && it.counts.total > 0 && it.counts.have >= it.counts.total;
const distFull = (it) => !!it && it.counts.total > 0 && it.counts.dist >= it.counts.total;
const distOnly = (it) => distFull(it) && it.rosterKind === 'character' && !it.owned;
const storyFull = (it) => allOpen(it) || distFull(it);
const availableCount = (it) => (!it ? 0 : Math.max(it.counts.open || 0, it.counts.dist || 0));

const questIdKey = (folderKey) => {
  const m = /^quest_(\d+)(?:c(\d+))?$/.exec(String(folderKey == null ? '' : folderKey));
  return m ? [Number(m[1]), Number(m[2] || 0)] : [Number.MAX_SAFE_INTEGER, 0];
};
const byQuestId = (keyOf) => (a, b) => {
  const x = questIdKey(keyOf(a)),
    y = questIdKey(keyOf(b));
  return x[0] - y[0] || x[1] - y[1];
};

export const rosterState = { allOpen, allHave, distOnly, distFull, storyFull, availableCount, byQuestId };
