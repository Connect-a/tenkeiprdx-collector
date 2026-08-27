import { fileStore } from '../../core/fsdir.js';
import { assetStore } from '../../data/asset-store.js';
import { DIRS } from '../../core/constants.js';
import { unityDecode } from '../../unity/decode.js';
import { unityMesh } from '../../unity/mesh.js';
import { utilHelpers } from '../../core/util.js';
import { TITLE_AA_CACHE, TITLE_SPRITE_NAMES } from '../../data/credits-assets.js';

const { audioBlobUrl, sleep } = utilHelpers;

export const END_CREDIT_EPISODE_ID = 2510010;

const VIDEO_FILE = 'EndCredits.mp4';
const BGM_NAME = 'bgm_2059';
const BGM_FADE_IN = 0.5;
const WAIT_SPECIAL_THANKS = 4;
const WAIT_TITLE_LOGO = 4;
const WAIT_SCENE_CHANGE = 2;

// タイトルロゴは共有DL(credits-assets)で落としてある aa titlesprites を「読むだけ」。
// クレジット再生時にライブ取得はしない（拡張のルール）。無ければ文字表示にフォールバック。
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
    const f = await fileStore.readUnder(dir, 'statics/' + VIDEO_FILE);
    if (f) return URL.createObjectURL(f);
  } catch (e) {}
  return null;
}

async function readBgmUrl(bgmRel) {
  if (!bgmRel) return null;
  try {
    const bytes = await assetStore.readAsset(DIRS.shared, bgmRel);
    if (!bytes) return null;
    const clips = await unityDecode.extractAudioResource(bytes);
    if (clips && clips.length) return audioBlobUrl(clips[0].data, clips[0].mime);
  } catch (e) {}
  return null;
}

function fadeAudio(a, to, sec) {
  const from = a.volume;
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / (sec * 1000));
    a.volume = from + (to - from) * k;
    if (k < 1) requestAnimationFrame(step);
  };
  step();
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

  let audio = null;
  let done = false;
  let onVis = null;
  // クレジットは専用BGMを鳴らすので、audioScene に「他BGM再生中」を報告して
  // ヘッダー/ホームBGMの復帰（二重再生）を抑止する。cleanup で解除。
  if (opts.reportBgm) opts.reportBgm(true);
  const cleanup = () => {
    if (done) return;
    done = true;
    if (opts.reportBgm) opts.reportBgm(false);
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

  const [videoUrl, bgmUrl, resolvedLogo] = await Promise.all([readVideoUrl(), bgmOn() ? readBgmUrl(opts.bgmRel) : Promise.resolve(null), opts.titleLogoCanvas ? Promise.resolve(opts.titleLogoCanvas) : resolveTitleLogoCanvas()]);
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
    audio.loop = true;
    audio.volume = 0;
    audio.play().then(() => fadeAudio(audio, vol(), BGM_FADE_IN)).catch(() => {});
  }

  // 別タブ（非表示）ではブラウザが動画再生/rAF/timerをスロットルするため、動画と音声を
  // 一緒に一時停止し、再表示で再開して同期ズレ（動画停止・音だけ進行）を防ぐ。
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
    el.style.transition = 'opacity 0.6s ease';
    overlay.appendChild(el);
    requestAnimationFrame(() => {
      el.style.opacity = '1';
    });
  };

  const runFinale = async () => {
    if (finaleStarted) return;
    finaleStarted = true;
    overlay.classList.add('show');
    // finale に入ったらスキップボタンは消す（この先はロゴ表示までロック）。
    try {
      skip.remove();
    } catch (e) {}

    // ①Special Thanks 画面＝「Special Thanks」＋プレイヤー名（userName）を一緒に表示（実ゲーム準拠：
    //   ExecuteEndCreditSequence は userName を先にセットし specialThanks キャンバスで一緒に見せる）。
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
    await sleep(WAIT_SPECIAL_THANKS * 1000);
    if (!gen()) return cleanup();

    // ②タイトルロゴ（specialThanks の後）。
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
    await sleep(WAIT_TITLE_LOGO * 1000);
    if (!gen()) return cleanup();

    // ③シーン遷移待ち後は「操作不能」でロック：このタイトルロゴ画面を表示したまま保持し、
    //   物語の最後のフレームへは戻さない（自動 cleanup しない）。BGMはループ継続。
    //   離脱は通常ナビゲーション（エピソード選択／シーク／前後送り＝cancelEndCredits）で行う。
    await sleep(WAIT_SCENE_CHANGE * 1000);
  };

  let finaleStarted = false;
  video.addEventListener('ended', runFinale);
  // スキップ＝長い動画を飛ばして finale へ。finale 開始後はボタン自体が消える（ロック）。
  skip.addEventListener('click', () => {
    if (finaleStarted) return;
    try {
      video.pause();
    } catch (e) {}
    runFinale();
  });
  if (!videoUrl) runFinale();
}
