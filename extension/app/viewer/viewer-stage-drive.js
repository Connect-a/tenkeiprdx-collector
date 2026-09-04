import { MOTION_ORDER, MOTION_VOICE, clipLike, idleClip } from '../../engine/render/motion-names.js';
import { voiceClipFor } from './viewer-source.js';
import { cachedAudioUrl, revokeUrlMap } from '../../core/audio-url.js';

const RUN_SPEED = 3;
const LIFT_SPEED = 2;
const TURN_RATE = 12;
const HIT_REACH = 2.4;
const HIT_HALF_ANGLE = Math.PI / 4;
const HIT_HEIGHT = 1.6;
const HIT_AT = 0.35;
const HIT_DELAY = 0.12;

export function createDriver(deps) {
  const { state, core, place, cam, onDrive, syncChar } = deps;
  const CAM = cam;
  const api = { syncChar: (id) => syncChar && syncChar(id) };
  const keys = new Set();
  let act = null;
  const clipOf = (inst, re, fallback) => clipLike(inst.clipNames, re) || (fallback ? idleClip(inst.clipNames) : '');

  function onKey(e) {
    const k = (e.key || '').toLowerCase();
    if (!('wasdjert '.includes(k) || /^[0-9]$/.test(k)) || e.ctrlKey || e.altKey || e.metaKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (!state.scene.chars.some((c) => c.control)) return;
    e.preventDefault();
    if (e.type === 'keyup') keys.delete(k);
    else keys.add(k);
  }

  function playOnce(c, inst, clip, withHit) {
    inst.setClip(clip);
    lastMotion.set(String(c.id), clip);
    const dur = (inst.clipDuration && inst.clipDuration(clip)) || 1;
    act = { ...(act || {}), once: dur, hit: withHit ? dur * HIT_AT : null };
    playMotionVoice(c.id, String(clip).toLowerCase());
  }

  function charSelects(inst) {
    const selects = [
      { key: 'mouth', label: '口', keep: true, cast: 'number', options: (inst.mouths || []).map((v) => [v, String(v)]) },
      { key: 'face', label: '目', keep: true, options: (inst.faces || []).map((b, i) => [b, String(i + 1)]) },
      { key: 'brow', label: '眉', keep: true, options: (inst.brows || []).map((b, i) => [b, String(i + 1)]) },
    ].filter((s) => s.options.length);
    if ((inst.costumes || []).length > 1) selects.push({ key: 'costume', label: '服装', options: inst.costumes.map((x) => [x.value, x.label]) });
    return selects;
  }

  function randomParts(c, inst) {
    const patch = {};
    for (const s of charSelects(inst)) {
      const opts = s.options;
      const v = opts[Math.floor(Math.random() * opts.length)][0];
      patch[s.key] = s.cast === 'number' ? Number(v) : v;
    }
    if (!Object.keys(patch).length) return;
    state.update(c.id, patch);
    if (api) api.syncChar(c.id);
    if (onDrive) onDrive(c.id);
  }

  const voiceUrls = new Map();
  const lastMotion = new Map();
  let voiceEl = null;
  async function playMotionVoice(id, motion) {
    const no = MOTION_VOICE[motion];
    if (!no) return;
    try {
      const url = await cachedAudioUrl(voiceUrls, id + ':' + motion, () => voiceClipFor(core.entryOf(id), no));
      if (!url) return;
      if (!voiceEl) voiceEl = new Audio();
      voiceEl.src = url;
      voiceEl.play().catch(() => {});
    } catch (e) {}
  }

  function strike(c, inst) {
    const from = inst.root.position;
    const face = inst.root.rotation.y;
    for (const o of state.scene.chars) {
      if (String(o.id) === String(c.id)) continue;
      const target = core.live(o.id);
      if (!target) continue;
      const dx = target.root.position.x - from.x;
      const dz = target.root.position.z - from.z;
      if (Math.abs(target.root.position.y - from.y) > HIT_HEIGHT) continue;
      const dist = Math.hypot(dx, dz);
      if (!(dist <= HIT_REACH)) continue;
      let diff = Math.atan2(dx, dz) - face;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > HIT_HALF_ANGLE) continue;
      const hurt = clipOf(target, /^damage$/i) || clipOf(target, /damage/i);
      if (!hurt) continue;
      act = act || {};
      (act.hurt = act.hurt || []).push({
        id: o.id,
        clip: hurt,
        wait: HIT_DELAY,
        until: (target.clipDuration && target.clipDuration(hurt)) || 0.8,
        rotY: Math.atan2(-dx, -dz) - (target.defaultRotY || 0),
      });
    }
  }

  function drive(dt) {
    const c = state.scene.chars.find((x) => x.control);
    const inst = c && core.live(c.id);
    if (!c || !inst) {
      act = null;
      return;
    }
    let dy = 0;
    if (keys.has('e')) dy += 1;
    if (keys.has('r')) dy -= 1;
    if (keys.has('t')) {
      keys.delete('t');
      if (c.y) {
        state.update(c.id, { y: 0 });
        place(state.get(c.id), inst);
        if (onDrive) onDrive(c.id);
      }
    } else if (dy) {
      state.update(c.id, { y: (c.y || 0) + dy * LIFT_SPEED * dt });
      place(state.get(c.id), inst);
      if (onDrive) onDrive(c.id);
    }
    if (act && act.hurt) {
      for (const h of act.hurt) {
        const t = core.live(h.id);
        if (h.wait > 0) {
          h.wait -= dt;
          if (h.wait > 0) continue;
          if (t) {
            state.update(h.id, { rotY: h.rotY });
            place(state.get(h.id), t);
            t.setClip(h.clip);
            if (onDrive) onDrive(h.id);
          }
          continue;
        }
        h.until -= dt;
        if (h.until > 0) continue;
        const o = state.get(h.id);
        if (t) t.setClip(o && o.motion ? o.motion : idleClip(t.clipNames));
      }
      act.hurt = act.hurt.filter((h) => h.wait > 0 || h.until > 0);
      if (!act.hurt.length) delete act.hurt;
    }
    if (act && act.once != null) {
      act.once -= dt;
      if (act.drift) {
        state.update(c.id, { x: (c.x || 0) + act.drift.x * dt, z: (c.z || 0) + act.drift.z * dt });
        place(state.get(c.id), inst);
        if (onDrive) onDrive(c.id);
      }
      if (act.hit != null) {
        act.hit -= dt;
        if (act.hit <= 0) {
          act.hit = null;
          strike(c, inst);
        }
      }
      if (act.once <= 0) {
        const back = idleClip(inst.clipNames);
        inst.setClip(back);
        lastMotion.set(String(c.id), back);
        state.update(c.id, { motion: back });
        if (onDrive) onDrive(c.id);
        act = act && act.hurt ? { hurt: act.hurt } : null;
      }
      return;
    }
    for (const k of keys) {
      if (!/^[0-9]$/.test(k)) continue;
      keys.delete(k);
      if (k === '0') {
        randomParts(c, inst);
        break;
      }
      const want = MOTION_ORDER[Number(k)];
      const clip = want && clipLike(inst.clipNames, new RegExp('^' + want + '$', 'i'));
      if (clip) playOnce(c, inst, clip, /^attack$/i.test(clip));
      break;
    }
    if (keys.has('j')) {
      keys.delete('j');
      const vel = act && act.vel ? { ...act.vel } : null;
      const jc = clipLike(inst.clipNames, /^jump$/i);
      if (jc) {
        playOnce(c, inst, jc);
        if (vel) act.drift = vel;
        return;
      }
    }
    if (act && act.once != null) return;
    if (keys.has(' ')) {
      keys.delete(' ');
      const atk = clipOf(inst, /^attack$/i) || clipOf(inst, /attack/i);
      if (atk) {
        playOnce(c, inst, atk, true);
        return;
      }
    }
    let fx = 0;
    let fz = 0;
    if (keys.has('w')) fz += 1;
    if (keys.has('s')) fz -= 1;
    if (keys.has('a')) fx -= 1;
    if (keys.has('d')) fx += 1;
    const run = clipOf(inst, /^run$/i) || clipOf(inst, /run/i);
    if (!fx && !fz) {
      if (act && act.moving) {
        inst.setClip(c.motion || idleClip(inst.clipNames));
        act.moving = false;
      }
      if (act) act.vel = null;
      return;
    }
    const yaw = CAM().yaw;
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    const wx = -(fz * sy) - fx * cy;
    const wz = -(fz * cy) + fx * sy;
    const len = Math.hypot(wx, wz) || 1;
    const step = (RUN_SPEED * dt) / len;
    const nx = (c.x || 0) - wx * step;
    const nz = (c.z || 0) + wz * step;
    const want = Math.atan2(wx, wz) - (inst.defaultRotY || 0);
    let cur = c.rotY || 0;
    let diff = want - cur;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    cur += diff * Math.min(1, TURN_RATE * dt);
    state.update(c.id, { x: nx, z: nz, rotY: cur });
    place(state.get(c.id), inst);
    act = { ...(act || {}), vel: { x: (-wx / len) * RUN_SPEED, z: (wz / len) * RUN_SPEED } };
    if (run) {
      inst.setClip(run);
      act.moving = true;
    }
    if (onDrive) onDrive(c.id);
  }

  return {
    onKey,
    drive,
    selectsFor: charSelects,
    noteMotion(id, motion) {
      const key = String(id);
      if (lastMotion.has(key) && lastMotion.get(key) !== motion) playMotionVoice(id, String(motion).toLowerCase());
      lastMotion.set(key, motion);
    },
    dispose() {
      revokeUrlMap(voiceUrls);
    },
  };
}
