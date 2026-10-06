const EFFECT_FNS = { VFX_EVENT_ShowSkillEffect: 'one', VFX_EVENT_ShowByEntitySkillEffect: 'one', VFX_EVENT_ShowAllSkillEffects: 'all' };
export const MOTION_FNS = ['VFX_EVENT_SetMotionTrigger', 'VFX_EVENT_SetMotionState', 'VFX_EVENT_ForceSetMotionTrigger', 'VFX_EVENT_ForceSetMotionState'];

function soundCues(ev, audioClips) {
  const clips = audioClips || [];
  const cue = (t, c) => (c && c.ref ? [{ t, ref: c.ref, looped: c.looped }] : []);
  const awake = clips.filter((c) => c.playOnAwake).flatMap((c) => cue(0, c));
  const played = ev.filter((e) => e.fn === 'VFX_EVENT_PlaySound').flatMap((e) => cue(e.t, clips[e.i | 0]));
  return [...awake, ...played].sort((a, b) => a.t - b.t);
}

export function interpretClipEvents(clipEvents, animGate, audioClips) {
  const ev = clipEvents || [];
  const background = ev.filter((e) => e.fn === 'VFX_EVENT_ShowBackground' || e.fn === 'VFX_EVENT_HideBackground');
  const sounds = soundCues(ev, audioClips);
  const texts = ev.filter((e) => e.fn === 'VFX_EVENT_ShowText').map((e) => ({ t: e.t, text: e.s || '' }));
  const endAt = ev.filter((e) => e.fn === 'VFX_EVENT_End').reduce((mx, e) => Math.max(mx, e.t), 0);
  const duration = Math.max(endAt, (animGate && animGate.duration) || 0);
  const chains = ev.filter((e) => e.fn === 'VFX_EVENT_Chain' || e.fn === 'VFX_EVENT_ChainToNextVFX');
  const chainAt = chains.length ? chains.reduce((mn, e) => Math.min(mn, e.t), Infinity) : null;
  const effectCues = ev.filter((e) => EFFECT_FNS[e.fn]).map((e) => ({ t: e.t, kind: EFFECT_FNS[e.fn] })).sort((a, b) => a.t - b.t);
  const motions = ev.filter((e) => MOTION_FNS.includes(e.fn) && e.s).map((e) => ({ t: e.t, name: e.s, force: e.fn.startsWith('VFX_EVENT_Force') }));
  return { background, sounds, texts, duration, chainAt, effectCues, motions };
}

export function backgroundVisibleAt(background, t) {
  let vis = true;
  for (const e of background) {
    if (e.t > t) break;
    vis = e.fn === 'VFX_EVENT_ShowBackground';
  }
  return vis;
}
