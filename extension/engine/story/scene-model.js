import { utilHelpers } from '../../core/util.js';
import { unityDecode } from '../../unity/decode.js';
const num = utilHelpers.num;

function sceneFrames(decoded, initBgm) {
  const cmds = unityDecode.decodeSceneCommands(decoded);
  let bg = null,
    bgFlip = false,
    bgFade = null,
    bgm = initBgm != null ? initBgm : null,
    still = null,
    stillAnim = null,
    stillSpeed = 0,
    cast = [],
    pendingSe = null,
    bandOn = false,
    noiseOn = false,
    insert = null,
    ambient = null,
    pendingFx = [],
    pendingBgVia = [],
    zoomSet = new Set();
  const frames = [];
  const drainPending = () => {
    pendingSe = null;
    pendingFx.length = 0;
    pendingBgVia.length = 0;
  };
  const buildFrame = (cmd, extra) =>
    Object.assign(
      {
        i: num(cmd.order),
        speaker: null,
        text: null,
        voice: null,
        bg,
        bgFlip,
        bgFade,
        bgm,
        still: null,
        stillAnim: null,
        stillSpeed: 0,
        speakerPos: 0,
        cast: cast.map((x) => ({ ...x, zoom: zoomSet.has(x.id) })),
        cam: null,
        se: pendingSe,
        center: false,
        fontSize: 0,
        effects: pendingFx.slice(),
        band: bandOn,
        noise: noiseOn,
        insert: insert ? { ...insert } : null,
        ambient: ambient || null,
        bgVia: pendingBgVia.slice(),
      },
      extra,
    );
  for (const cmd of cmds) {
    const ec = cmd.effect;
    if (ec === 0) bandOn = noiseOn = false;
    else if (ec === 2) bandOn = true;
    else if (ec === 3) noiseOn = true;
    else if (ec != null && ec !== 1) pendingFx.push({ code: ec, dur: num(cmd.effectDur) || 0 });
    if (cmd.insert != null && cmd.insert !== '') {
      insert = (num(cmd.insertEffect) || 0) === 1 ? null : { img: String(cmd.insert), x: num(cmd.insertX) || 0, y: num(cmd.insertY) || 0 };
    }
    if (typeof cmd.ambientVfx === 'string' && cmd.ambientVfx) {
      const m = cmd.ambientVfx.match(/^(.*)_(On|Off)$/i);
      if (m) ambient = /^On$/i.test(m[2]) ? m[1] : null;
    }
    if (cmd.bg) {
      bg = cmd.bg;
      bgFlip = !!cmd.bgFlip;
      bgFade = num(cmd.bgFade);
    }
    if (typeof cmd.still === 'string' && cmd.still) still = cmd.still;
    if (typeof cmd.stillAnim === 'string' && cmd.stillAnim) stillAnim = cmd.stillAnim;
    if (typeof cmd.stillSpeed === 'number' && cmd.stillSpeed > 0) stillSpeed = cmd.stillSpeed;
    if (cmd.bgm) bgm = cmd.bgm;
    if (typeof cmd.se === 'string' && cmd.se && !/^no_?se$/i.test(cmd.se)) pendingSe = cmd.se;
    if (cmd.cast) {
      cast = cmd.cast
        .map((e) => ({
          id: num(e.id),
          app: num(e.app) || 0,
          pos: num(e.pos) || 0,
          act: num(e.act) || 0,
          emo: num(e.emo) || 0,
          face: num(e.face) || 0,
          flip: !!e.flip,
          skin: e.skin == null ? null : num(e.skin),
        }))
        .filter((e) => e.id > 0);
      const present = new Set(cast.map((e) => e.id));
      for (const id of [...zoomSet]) if (!present.has(id)) zoomSet.delete(id);
      for (const e of cast) {
        if (e.act === 7) zoomSet.add(e.id);
        else if (e.act === 8) zoomSet.delete(e.id);
      }
    }
    const text = cmd.text,
      spk = cmd.speaker,
      voice = cmd.voice;
    if (text || voice || spk) {
      const inStill = !!(still && bg && !/^bg_/.test(String(bg)));
      const cs = [num(cmd.camStartX) || 0, num(cmd.camStartY) || 0, num(cmd.camStartZ) || 0],
        ce = [num(cmd.camEndX) || 0, num(cmd.camEndY) || 0, num(cmd.camEndZ) || 0];
      const hasCam = [...cs, ...ce].some((v) => v !== 0);
      frames.push(
        buildFrame(cmd, {
          speaker: spk || null,
          text: text ? String(text).replace(/\\n/g, '\n') : null,
          voice: voice || null,
          still: inStill ? still : null,
          stillAnim: inStill ? stillAnim : null,
          stillSpeed: inStill ? stillSpeed : 0,
          speakerPos: num(cmd.speakerPos) || 0,
          cam: hasCam ? { s: cs, e: ce, dur: num(cmd.camDur) || 0 } : null,
          center: !!cmd.center,
          fontSize: num(cmd.fontSize) || 0,
        }),
      );
      drainPending();
    } else if (cmd.cast && cast.length > 0) {
      const beatMs = pendingFx.length ? Math.max(700, ...pendingFx.map((f) => f.dur || 900)) : 700;
      frames.push(buildFrame(cmd, { auto: beatMs }));
      drainPending();
    } else if (cmd.bg) {
      pendingBgVia.push({ bg: cmd.bg, fade: num(cmd.bgFade), flip: !!cmd.bgFlip });
    }
  }
  return frames;
}

export const sceneModel = { sceneFrames };
