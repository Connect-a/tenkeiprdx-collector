import { readSharedBgmUrl, fadeAudio } from './story-audio.js';
import { scenarioUi } from './scenario-ui.js';

export const DOKIDOKI_EPISODE_ID = 2300101;
const BGM_FADE_IN = 0.5;

async function readSharedCanvas(rel) {
  if (!rel) return null;
  try {
    const pack = await scenarioUi.loadPack(rel);
    if (!pack) return null;
    const sp = pack.get('bg_eventstill_2093') || Object.values(pack.sprites || {})[0];
    return sp && sp.canvas ? sp.canvas : null;
  } catch (e) {
    return null;
  }
}

export function playDokidokiIntro(opts) {
  const host = opts.host;
  const vol = () => (typeof opts.volume === 'function' ? opts.volume() : opts.volume != null ? opts.volume : 0.5);
  const bgmOn = () => (typeof opts.bgmEnabled === 'function' ? opts.bgmEnabled() : opts.bgmEnabled !== false);
  const st = { done: false, root: null, audio: null, resolveStart: null };
  const started = new Promise((res) => (st.resolveStart = res));

  const stopBgm = (fade) => {
    const a = st.audio;
    st.audio = null;
    if (!a) return;
    if (fade > 0) fadeAudio(a, 0, fade, true);
    else {
      try {
        a.pause();
        if (a.src) URL.revokeObjectURL(a.src);
      } catch (e) {}
    }
  };
  const removeVisual = () => {
    if (st.root) {
      try {
        st.root.remove();
      } catch (e) {}
      st.root = null;
    }
  };
  const finish = (ok, bgmFade) => {
    if (st.done) return;
    st.done = true;
    removeVisual();
    stopBgm(bgmFade);
    if (st.resolveStart) {
      const r = st.resolveStart;
      st.resolveStart = null;
      r(ok);
    }
  };
  const cancel = () => finish(false, 0);

  (async () => {
    const [bgCanvas, bgmUrl, seUrl] = await Promise.all([
      readSharedCanvas(opts.bgRel),
      bgmOn() ? readSharedBgmUrl(opts.bgmRel) : Promise.resolve(null),
      opts.seRel ? readSharedBgmUrl(opts.seRel) : Promise.resolve(null),
    ]);
    st.seUrl = seUrl;
    if (st.done || !host) return;
    const root = document.createElement('div');
    root.className = 'dokidoki-intro-root';
    Object.assign(root.style, { position: 'absolute', inset: '0', zIndex: '60', background: '#000', overflow: 'hidden', cursor: 'pointer', containerType: 'size' });
    if (bgCanvas) {
      Object.assign(bgCanvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', display: 'block' });
      root.appendChild(bgCanvas);
    }
    const label = document.createElement('div');
    label.textContent = 'ゲームスタート';
    Object.assign(label.style, {
      position: 'absolute',
      left: '50%',
      top: '75.5%',
      transform: 'translate(-50%,-50%)',
      color: '#ff9ec6',
      fontFamily: '"Rounded Mplus 1c","Kosugi Maru","Zen Maru Gothic","Hiragino Maru Gothic ProN","Hiragino Maru Gothic Pro","M PLUS Rounded 1c",sans-serif',
      fontWeight: '700',
      fontSize: '5.2cqh',
      letterSpacing: '0.06em',
      whiteSpace: 'nowrap',
      textShadow: '0 0 1px #fff,1px 1px 0 #fff,-1px 1px 0 #fff,1px -1px 0 #fff,-1px -1px 0 #fff',
      pointerEvents: 'none',
    });
    root.appendChild(label);
    let starting = false;
    const clickStart = (e) => {
      e.stopPropagation();
      if (starting || st.done) return;
      starting = true;
      if (st.seUrl) {
        try {
          const a = new Audio(st.seUrl);
          a.volume = vol();
          a.play().catch(() => {});
        } catch (e2) {}
      }
      let n = 0;
      const blink = setInterval(() => {
        label.style.visibility = n % 2 ? 'hidden' : 'visible';
        if (++n >= 6) {
          clearInterval(blink);
          label.style.visibility = 'visible';
          const fade = document.createElement('div');
          Object.assign(fade.style, { position: 'absolute', inset: '0', background: '#000', opacity: '0', transition: 'opacity 1200ms ease', pointerEvents: 'none', zIndex: '3' });
          root.appendChild(fade);
          void fade.offsetHeight;
          requestAnimationFrame(() => requestAnimationFrame(() => (fade.style.opacity = '1')));
          setTimeout(() => finish(true, 1.1), 1300);
        }
      }, 80);
    };
    root.addEventListener('click', clickStart);
    root.addEventListener('pointerdown', (e) => e.stopPropagation());
    host.appendChild(root);
    st.root = root;
    if (bgmUrl) {
      const a = new Audio(bgmUrl);
      a.loop = true;
      a.volume = 0;
      st.audio = a;
      a.play()
        .then(() => fadeAudio(a, vol(), BGM_FADE_IN))
        .catch(() => {});
    }
  })();

  return { started, cancel };
}
