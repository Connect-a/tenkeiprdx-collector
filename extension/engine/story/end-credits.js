import { SHARED_FILE } from '../../core/assetpath/placement.js';
import { fileStore } from '../../core/fsdir.js';
import { DIRS } from '../../core/dirs.js';
import { unityMesh } from '../../unity/mesh.js';
import { sleep } from '../../core/async.js';
import { readSharedBgmUrl, fadeAudio } from './story-audio.js';
import { TITLE_AA_CACHE, TITLE_SPRITE_NAMES } from '../../data/credits-assets.js';

export const END_CREDIT_EPISODE_ID = 2510010;

const VIDEO_FILE = 'EndCredits.mp4';
const BGM_FADE_IN = 0.5;
const FADE = 1;
const WAIT_SPECIAL_THANKS = 4;
const WAIT_TITLE_LOGO = 4;
const WAIT_SCENE_CHANGE = 2;

async function resolveTitleLogoCanvas() {
  let bytes = null;
  try {
    const dir = await fileStore.getDir(DIRS.shared, { create: false });
    bytes = dir && (await fileStore.readBytesUnder(dir, TITLE_AA_CACHE));
  } catch (e) {}
  if (!bytes) return null;
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const nm of TITLE_SPRITE_NAMES) {
    try {
      const cv = unityMesh.decodeAtlasSprite(b, nm);
      if (cv) return cv;
    } catch (e) {}
  }
  return null;
}

async function readVideoUrl() {
  try {
    const dir = await fileStore.getDir(DIRS.shared, { create: false });
    const f = await fileStore.readUnder(dir, SHARED_FILE.statics(VIDEO_FILE));
    if (f) return URL.createObjectURL(f);
  } catch (e) {}
  return null;
}

export async function playEndCredits(opts) {
  const host = opts.host;
  if (!host) return;
  const gen = opts.gen || (() => true);
  const vol = () => (typeof opts.volume === 'function' ? opts.volume() : opts.volume != null ? opts.volume : 0.5);
  const bgmOn = () => (typeof opts.bgmEnabled === 'function' ? opts.bgmEnabled() : opts.bgmEnabled !== false);
  const userName = (opts.userName || '').trim();

  const root = document.createElement('div');
  root.className = 'endcredits-root';
  const video = document.createElement('video');
  video.className = 'endcredits-video';
  video.muted = true;
  video.playsInline = true;
  const overlay = document.createElement('div');
  overlay.className = 'endcredits-overlay';
  const skip = document.createElement('button');
  skip.className = 'endcredits-skip';
  skip.textContent = 'スキップ ▶';
  root.appendChild(video);
  root.appendChild(overlay);
  root.appendChild(skip);
  host.appendChild(root);
  const swallow = (e) => e.stopPropagation();
  root.addEventListener('click', swallow);
  root.addEventListener('pointerdown', swallow);

  let audio = null;
  let done = false;
  let onVis = null;
  const cleanup = () => {
    if (done) return;
    done = true;
    try {
      if (onVis && globalThis.document) globalThis.document.removeEventListener('visibilitychange', onVis);
    } catch (e) {}
    try {
      if (audio) {
        audio.pause();
        if (audio.src) URL.revokeObjectURL(audio.src);
      }
    } catch (e) {}
    try {
      if (video.src) URL.revokeObjectURL(video.src);
    } catch (e) {}
    try {
      root.remove();
    } catch (e) {}
    if (opts.onDone) opts.onDone();
  };
  if (opts.register) opts.register(cleanup);

  const [videoUrl, bgmUrl, resolvedLogo] = await Promise.all([
    readVideoUrl(),
    bgmOn() ? readSharedBgmUrl(opts.bgmRel) : Promise.resolve(null),
    opts.titleLogoCanvas ? Promise.resolve(opts.titleLogoCanvas) : resolveTitleLogoCanvas(),
  ]);
  const titleLogoCanvas = opts.titleLogoCanvas || resolvedLogo;
  if (!gen()) {
    cleanup();
    return;
  }
  if (videoUrl) {
    video.src = videoUrl;
    video.play().catch(() => {});
  }
  if (bgmUrl) {
    audio = new Audio(bgmUrl);
    audio.loop = false;
    audio.volume = 0;
    audio
      .play()
      .then(() => fadeAudio(audio, vol(), BGM_FADE_IN))
      .catch(() => {});
  }

  onVis = () => {
    if (done) return;
    const hidden = globalThis.document && globalThis.document.hidden;
    if (hidden) {
      try {
        video.pause();
      } catch (e) {}
      try {
        if (audio) audio.pause();
      } catch (e) {}
    } else {
      if (!finaleStarted && video.src && !video.ended) video.play().catch(() => {});
      if (audio) audio.play().catch(() => {});
    }
  };
  if (globalThis.document) globalThis.document.addEventListener('visibilitychange', onVis);

  const fadeInEl = (el) => {
    el.style.opacity = '0';
    el.style.transition = `opacity ${FADE}s ease`;
    overlay.appendChild(el);
    requestAnimationFrame(() => {
      el.style.opacity = '1';
    });
  };
  const fadeOutEl = async (el) => {
    el.style.transition = `opacity ${FADE}s ease`;
    requestAnimationFrame(() => {
      el.style.opacity = '0';
    });
    await sleep(FADE * 1000);
    try {
      el.remove();
    } catch (e) {}
  };

  const runFinale = async () => {
    if (finaleStarted) return;
    finaleStarted = true;
    overlay.classList.add('show');
    try {
      skip.remove();
    } catch (e) {}

    const thanks = document.createElement('div');
    thanks.className = 'endcredits-thanks';
    if (opts.specialThanksCanvas) {
      opts.specialThanksCanvas.className = 'endcredits-img';
      thanks.appendChild(opts.specialThanksCanvas);
    } else {
      const t = document.createElement('div');
      t.className = 'endcredits-thanks-title';
      t.textContent = 'Special Thanks';
      thanks.appendChild(t);
    }
    if (userName) {
      const nm = document.createElement('div');
      nm.className = 'endcredits-username';
      nm.textContent = userName;
      thanks.appendChild(nm);
    }
    fadeInEl(thanks);
    await sleep((FADE + WAIT_SPECIAL_THANKS) * 1000);
    if (!gen()) return cleanup();
    await fadeOutEl(thanks);
    if (!gen()) return cleanup();

    const logo = document.createElement('div');
    logo.className = 'endcredits-logo';
    if (titleLogoCanvas) {
      titleLogoCanvas.className = 'endcredits-img';
      logo.appendChild(titleLogoCanvas);
    } else {
      logo.textContent = '天啓パラドクス';
      logo.classList.add('endcredits-logo-text');
    }
    fadeInEl(logo);
    await sleep((FADE + WAIT_TITLE_LOGO) * 1000);
    if (!gen()) return cleanup();

    await sleep(WAIT_SCENE_CHANGE * 1000);
  };

  let finaleStarted = false;
  video.addEventListener('ended', runFinale);
  skip.addEventListener('click', () => {
    if (finaleStarted) return;
    try {
      video.pause();
    } catch (e) {}
    runFinale();
  });
  if (!videoUrl) runFinale();
}
