import { resolveOrigin } from './origin.js';

const STATICS_DIR = 'statics';

const VIDEO_DIR = 'InGameStatics/VideoFiles';
const VIDEOS = [
  ['Title', 'タイトル動画'],
  ['NewTitle', 'タイトル動画（旧 NewTitle）'],
  ['NewTitle2', 'タイトル動画（旧 NewTitle2）'],
  ['DefaultTitle', 'タイトル動画（旧 DefaultTitle）'],
  ['EndCredits', 'エンドクレジット'],
];

const FILES = VIDEOS.map(([n, name]) => ({ key: 'video_' + n.toLowerCase(), name, sub: `${VIDEO_DIR}/${n}.mp4`, file: `${n}.mp4`, kind: 'video' }));

const withUrl = (list, base) => list.map((f) => ({ ...f, url: base ? `${base}/${f.sub}` : null, path: `${STATICS_DIR}/${f.file}` }));

async function staticsBase() {
  try {
    return (await resolveOrigin()).statics || null;
  } catch (e) {
    return null;
  }
}

export async function staticsList() {
  return withUrl(FILES, await staticsBase());
}
