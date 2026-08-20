import { ensureIndexes } from './index-store.js';

const STATICS_DIR = 'statics';

const VIDEO_DIR = 'InGameStatics/VideoFiles';
const VIDEOS = [
  ['Title', 'タイトル動画'],
  ['NewTitle', 'タイトル動画（旧 NewTitle）'],
  ['NewTitle2', 'タイトル動画（旧 NewTitle2）'],
  ['DefaultTitle', 'タイトル動画（旧 DefaultTitle）'],
];

const FILES = VIDEOS.map(([n, name]) => ({ key: 'video_' + n.toLowerCase(), name, sub: `${VIDEO_DIR}/${n}.mp4`, file: `${n}.mp4`, kind: 'video' }));

export async function staticsList() {
  let base = null;
  try {
    base = (await ensureIndexes()).meta.staticsBase || null;
  } catch (e) {}
  return FILES.map((f) => ({ ...f, url: base ? `${base}/${f.sub}` : null, path: `${STATICS_DIR}/${f.file}` }));
}
