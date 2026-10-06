const MOTION_VOICE = {
  attack: 4,
  skill: 6,
  castingspell: 5,
  damage: 8,
  abnormalcondition: 10,
  victory: 11,
  idleaction: 22,
};

export const motionVoiceNo = (motionName) => MOTION_VOICE[String(motionName || '').toLowerCase()] || 0;
