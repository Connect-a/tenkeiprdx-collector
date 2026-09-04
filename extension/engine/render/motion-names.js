export const MOTION_ORDER = ['Idle', 'IdleAction', 'IdleVictory', 'Attack', 'Damage', 'AbnormalCondition', 'Victory', 'Run', 'Skill', 'CastingSpell'];

export const idleClip = (names) => (names || []).find((n) => /^idle$/i.test(n)) || (names || []).find((n) => /idle/i.test(n)) || (names || [])[0] || '';
export const clipLike = (names, re) => (names || []).find((n) => re.test(n)) || '';

export const MOTION_VOICE = {
  attack: 4,
  skill: 5,
  castingspell: 6,
  damage: 8,
  abnormalcondition: 10,
  victory: 11,
  idleaction: 22,
};
