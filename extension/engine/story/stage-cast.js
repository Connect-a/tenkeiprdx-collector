import { spineWeb } from './spine-web.js';
import { emotionSpec } from './emotion-spec.js';
import { appearTr, actionDuration, stepMotion, EXIT_CODES, ZOOM_ACTION_CODES } from './stage-motion.js';

const BASE_SCALE = 0.33;
const ZOOM_SCALE = 0.5 / BASE_SCALE;
const ZOOM_Y_REF = -200;
const EMO_ALPHA_MIN = 0.003;
const EMO_TAIL_SEC = 0.05;
const FILL_FULL = 0.999;

function castTransform(detail, bounds, env, layout, advBone) {
  const zf = detail.zoom ? ZOOM_SCALE : 1;
  const sRef = layout.scaleMul * BASE_SCALE;
  const useAdv = !!advBone;
  const anchorY = useAdv ? layout.pinScreenAdv : layout.pinScreen;
  const pinLocalY = useAdv ? advBone.y : layout.pinBody * bounds.h;
  const scale = sRef * (env.H / env.refH);
  const scaleX = (detail.flip ? -scale : scale) * zf;
  const baseline = anchorY - (pinLocalY * sRef * zf) / env.refH;
  const zoomOff = zf > 1 ? ZOOM_Y_REF * (env.H / env.refH) : 0;
  return {
    x: env.W * (0.5 + (detail.posMapX || 0) / env.refW) - (advBone ? advBone.x : 0) * scaleX,
    y: env.H * baseline + zoomOff,
    scaleX,
    scaleY: scale * zf,
    dim: detail.speaking === false ? 0.5 : 1.0,
  };
}

function emotionTransform(bone, offsetX, offsetY, mirrored) {
  const ox = mirrored ? -offsetX : offsetX;
  return {
    x: bone.worldX + bone.a * ox + bone.b * offsetY,
    y: bone.worldY + bone.c * ox + bone.d * offsetY,
    scaleX: Math.sqrt(bone.a * bone.a + bone.c * bone.c),
    scaleY: Math.sqrt(bone.b * bone.b + bone.d * bone.d),
  };
}

export function createCastScene({ canvas, renderer, drawSkeleton, setAnim, emotionTexture, layout, refSize }) {
  const onStage = new Map();
  let exiting = [];

  const env = () => {
    const ref = refSize();
    return { W: canvas.width, H: canvas.height, refW: ref.w, refH: ref.h };
  };

  const applyTransform = (actor) => {
    if (!(actor.rec.bounds.h > 0)) return;
    Object.assign(actor, castTransform(actor.detail, actor.rec.bounds, env(), layout, actor.rec.advBone));
  };

  const allActors = () => [...onStage.values(), ...exiting];

  const setEmotion = (actor, code) => {
    const spec = code > 0 ? emotionSpec(code) : null;
    const tex = spec && emotionTexture ? emotionTexture(spec.spriteName) : null;
    actor.emotion = tex ? { spec, tex, startedMs: null } : null;
  };

  function drawQuad({ tex, x, y, w, h, pivot, angle, fill, alpha }) {
    const Color = spineWeb.lib().Color;
    const col = new Color(alpha, alpha, alpha, alpha);
    const mirrored = w < 0;
    const width = mirrored ? -w : w;
    const pivotX = width * (mirrored ? 1 - pivot[0] : pivot[0]);
    const pivotY = h * pivot[1];
    const left = x - pivotX;
    const bottom = y - pivotY;
    if (angle) {
      renderer.drawTextureRotated(tex, left, bottom, width, h, pivotX, pivotY, angle, col);
      return;
    }
    const u0 = mirrored ? 1 : 0;
    const u2 = mirrored ? 0 : 1;
    if (fill < FILL_FULL) renderer.drawTextureUV(tex, left, bottom, width * fill, h, u0, 0, u0 + (u2 - u0) * fill, 1, col);
    else renderer.drawTextureUV(tex, left, bottom, width, h, u0, 0, u2, 1, col);
  }

  function drawEmotion(actor, nowMs) {
    const bone = actor.rec.emotionBone;
    if (!bone) return;
    const emotion = actor.emotion;
    if (emotion.startedMs == null) emotion.startedMs = nowMs;
    const spec = emotion.spec;
    const sec = (nowMs - emotion.startedMs) / 1000;
    if (sec > spec.sampler.total + EMO_TAIL_SEC) return;
    const pose = spec.sampler.sample(sec);
    if (pose.a <= EMO_ALPHA_MIN) return;
    const mirrored = actor.rec.skeleton.scaleX < 0;
    const transform = emotionTransform(bone, spec.parentPos[0] + pose.x, spec.parentPos[1] + pose.y, mirrored);
    const w = spec.sizeDelta * transform.scaleX * pose.sx;
    const h = spec.sizeDelta * transform.scaleY * pose.sy;
    if (w === 0 || h === 0) return;
    drawQuad({ tex: emotion.tex, x: transform.x, y: transform.y, w, h, pivot: spec.pivot, angle: pose.rz, fill: pose.fill, alpha: pose.a });
  }

  return {
    skeletons: () => allActors().map((actor) => actor.rec),
    cameraBounds: () => null,
    step(dt) {
      const motionEnv = env();
      const finished = [];
      for (const actor of allActors()) {
        actor.rec.state.update(dt);
        actor.rec.state.apply(actor.rec.skeleton);
        const motion = stepMotion(actor, dt, motionEnv);
        if (motion.finishedOut) finished.push(actor);
        const sk = actor.rec.skeleton;
        sk.x = actor.x + motion.ox;
        sk.y = actor.y + motion.oy;
        sk.scaleX = actor.scaleX;
        sk.scaleY = actor.scaleY;
        const dim = actor.dim != null ? actor.dim : 1;
        sk.color.set(dim, dim, dim, motion.alpha);
        sk.updateWorldTransform();
      }
      if (finished.length) exiting = exiting.filter((actor) => !finished.includes(actor));
    },
    render({ nowMs }) {
      const actors = allActors();
      renderer.begin();
      for (const actor of actors) drawSkeleton(actor.rec.skeleton);
      for (const actor of actors) if (actor.emotion) drawEmotion(actor, nowMs);
      renderer.end();
    },
    renderMosaic() {},
    relayout() {
      for (const actor of onStage.values()) if (actor.detail) applyTransform(actor);
    },
    setCast(list) {
      const seen = new Set();
      for (const detail of list) {
        if (!detail.rec || !(detail.rec.bounds.h > 0)) continue;
        setAnim(detail.rec, detail.unityAnim, true);
        if (EXIT_CODES.has(detail.appear)) {
          const actor = onStage.get(detail.id);
          if (actor) {
            const tr = appearTr(detail.appear);
            onStage.delete(detail.id);
            if (tr) {
              actor.tr = tr;
              exiting.push(actor);
            }
          }
          continue;
        }
        seen.add(detail.id);
        let actor = onStage.get(detail.id);
        if (actor) actor.rec = detail.rec;
        else {
          actor = { rec: detail.rec, tr: appearTr(detail.appear), lastAction: 0, act: null, emotion: null };
          onStage.set(detail.id, actor);
        }
        actor.detail = detail;
        applyTransform(actor);
        setEmotion(actor, detail.emo);
        if (detail.act && !ZOOM_ACTION_CODES.has(detail.act) && detail.act !== actor.lastAction) actor.act = { type: detail.act, t: 0, dur: actionDuration(detail.act) };
        actor.lastAction = detail.act || 0;
      }
      for (const [id, actor] of [...onStage]) {
        if (seen.has(id)) continue;
        actor.tr = { mode: 'out', fade: true, dur: 0.15, t: 0 };
        onStage.delete(id);
        exiting.push(actor);
      }
    },
    clear() {
      onStage.clear();
      exiting = [];
    },
  };
}
