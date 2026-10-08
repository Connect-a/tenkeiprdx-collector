export const MOTION_ORDER = ['Idle', 'IdleAction', 'IdleVictory', 'Attack', 'Damage', 'AbnormalCondition', 'Victory', 'Run', 'Skill', 'CastingSpell'];

export const idleClip = (names) => (names || []).find((n) => /^idle$/i.test(n)) || (names || []).find((n) => /idle/i.test(n)) || (names || [])[0] || '';
export const clipLike = (names, re) => (names || []).find((n) => re.test(n)) || '';

export const pawnMotion = (pawnAnimationName) => (pawnAnimationName === 'Skill' || pawnAnimationName === 'CastingSpell' ? pawnAnimationName : 'Attack');
const STATE_FALLBACK = { Skill: 'Attack', CastingSpell: 'Attack', IdleAction: 'Idle', AbnormalCondition: 'Idle', Run: 'Idle', Sleep: 'Idle', Damage: 'Idle', IdleVictory: 'Idle' };
export const motionClip = (names, motion, binding) => {
  const bound = binding && binding[motion];
  if (bound && clipLike(names, new RegExp('^' + String(bound).replace(/[^A-Za-z]/g, '') + '$', 'i'))) return bound;
  for (let state = String(motion); state; state = STATE_FALLBACK[state] || '') {
    const clip = clipLike(names, new RegExp('^' + state.replace(/[^A-Za-z]/g, '') + '$', 'i'));
    if (clip) return clip;
  }
  return '';
};
