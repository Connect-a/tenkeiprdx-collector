import { collectionRepository } from '../../data/collection.js';
import { saveData } from '../../core/savedata.js';
import { assetStore } from '../../data/asset-store.js';
import { ensureIndexes } from '../../data/index-store.js';
import { unityMesh } from '../../unity/mesh.js';
import { PLACE } from '../../core/placement.js';
import { SK, DIRS, xposNames } from '../../core/constants.js';
import { fileStore } from '../../core/fsdir.js';
import { getById, el, append } from '../../core/dom.js';
import { playerState } from '../runtime/player-state.js';
import { folderHandle } from '../runtime/state-refresh.js';
import { nameFix, kanaKey, spinnerHtml } from '../ui/ui-format.js';
import { navTo } from '../runtime/router-controller.js';
import { characterComparer } from './roster-ui.js';

const THUMB_CONC = 12;
const EX_RE = /^EX/i;

let favorites = null;
let observer = null;
const thumbQueue = [];
let draining = false;

async function loadFavorites() {
  if (favorites) return favorites;
  let saved = await saveData.loadFavorites();
  if (saved == null) {
    try {
      saved = (await chrome.storage.local.get(SK.exFavorites))[SK.exFavorites] || [];
    } catch (e) {
      saved = [];
    }
    if (saved.length) await saveData.saveFavorites(saved);
  }
  favorites = new Set(saved.map(String));
  return favorites;
}

async function toggleFavorite(epId) {
  const set = await loadFavorites();
  const key = String(epId);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  const items = [...set];
  if (!(await saveData.saveFavorites(items))) {
    try {
      await chrome.storage.local.set({ [SK.exFavorites]: items });
    } catch (e) {}
  }
  return set.has(key);
}

export async function exSceneItems() {
  const { folderMeta } = await collectionRepository.folderModel();
  const fav = await loadFavorites();
  const ownedBy = new Map();
  try {
    const items = await collectionRepository.rosterItems('character', { dl: playerState.dl, distSet: playerState.binlistScenes || new Set() });
    for (const it of items) ownedBy.set(String(it.folderKey), !!it.owned);
  } catch (e) {}
  const out = [];
  for (const [folderKey, meta] of Object.entries(folderMeta)) {
    if (meta.rosterKind !== 'character') continue;
    for (const ep of meta.episodes || []) {
      if (!EX_RE.test(ep.label || '')) continue;
      out.push({
        owned: !!ownedBy.get(String(folderKey)),
        downloaded: !!folderHandle(String(folderKey)),
        folderKey: String(folderKey),
        episodeId: String(ep.episodeId),
        charName: meta.name || '',
        charTitle: meta.title || '',
        displayName: `${meta.name || ''}${meta.title || ''}`,
        group: meta.group || '',
        rank: meta.rank || '',
        bwh: meta.bwh || null,
        label: ep.label || '',
        title: ep.title || '',
        xpos: ep.xpos || 0,
        thumb: ep.thumb || null,
        favorite: fav.has(String(ep.episodeId)),
      });
    }
  }
  return out;
}

function matches(it, q, qk) {
  if (playerState.rosterGroup && it.group !== playerState.rosterGroup) return false;
  if (playerState.rosterRank && it.rank !== playerState.rosterRank) return false;
  if (playerState.rosterOwn === 'owned' && !it.owned) return false;
  if (playerState.rosterOwn === 'unowned' && it.owned) return false;
  if (playerState.rosterXpos && !(it.xpos & playerState.rosterXpos)) return false;
  if (playerState.exFavOnly && !it.favorite) return false;
  if (q && !kanaKey(it.displayName).includes(qk) && !kanaKey(it.title).includes(qk) && !String(it.folderKey).includes(q)) return false;
  return true;
}

function markEmpty(box, note) {
  box.innerHTML = '';
  box.dataset.note = note;
  box.classList.add('nothumb');
}

const CACHE_SUB = 'exthumb';
const CACHE_W = 384;
const CACHE_TYPE = 'image/webp';
const CACHE_QUALITY = 0.82;
let useCache = false;
const urls = [];

export function setThumbCache(on) {
  useCache = !!on;
}

const cachePath = (epId) => `${CACHE_SUB}/${epId}.webp`;

function showBlob(box, blob) {
  const url = URL.createObjectURL(blob);
  urls.push(url);
  const img = el('img', { class: 'exthumb-img', src: url, loading: 'lazy' });
  box.innerHTML = '';
  box.appendChild(img);
}

async function readCached(epId) {
  try {
    const d = await fileStore.getDir(DIRS.cache, { create: false });
    if (!d) return null;
    const bytes = await fileStore.readBytesUnder(d, cachePath(epId));
    return bytes && bytes.length ? new Blob([bytes], { type: CACHE_TYPE }) : null;
  } catch (e) {
    return null;
  }
}

async function writeCached(epId, canvas) {
  try {
    const w = Math.min(CACHE_W, canvas.width);
    const h = Math.round((canvas.height / canvas.width) * w);
    const small = document.createElement('canvas');
    small.width = w;
    small.height = h;
    small.getContext('2d').drawImage(canvas, 0, 0, w, h);
    const blob = await new Promise((r) => small.toBlob(r, CACHE_TYPE, CACHE_QUALITY));
    if (!blob) return null;
    const d = await fileStore.getDir(DIRS.cache, { create: true });
    if (d) await fileStore.writeUnder(d, cachePath(epId), new Uint8Array(await blob.arrayBuffer()));
    return blob;
  } catch (e) {
    return null;
  }
}

async function paintThumb(box, it) {
  if (useCache) {
    const hit = await readCached(it.episodeId);
    if (hit) return showBlob(box, hit);
  }
  const handle = folderHandle(it.folderKey);
  if (!handle) return markEmpty(box, '未ダウンロード');
  if (!it.thumb) return markEmpty(box, '画像なし');
  let rel = null;
  try {
    rel = (await ensureIndexes()).assets.sceneAssetIndex[it.thumb] || null;
  } catch (e) {}
  if (!rel) return markEmpty(box, '取り先不明');
  let bytes = null;
  try {
    bytes = await assetStore.readAsset(handle, rel, PLACE.episode(`story/${it.episodeId}`, 'bg'));
  } catch (e) {}
  if (!bytes) return markEmpty(box, '未取得');
  try {
    const cvs = unityMesh.decodeAllTextureCanvases(bytes);
    if (cvs && cvs[0]) {
      if (useCache) {
        const blob = await writeCached(it.episodeId, cvs[0]);
        if (blob) return showBlob(box, blob);
      }
      box.innerHTML = '';
      cvs[0].className = 'exthumb-img';
      box.appendChild(cvs[0]);
      return;
    }
  } catch (e) {}
  markEmpty(box, '表示できません');
}

async function drainThumbs() {
  if (draining) return;
  draining = true;
  while (thumbQueue.length) await Promise.all(thumbQueue.splice(0, THUMB_CONC).map(([box, it]) => paintThumb(box, it)));
  draining = false;
}

function watchThumbs(grid, byId) {
  if (observer) observer.disconnect();
  thumbQueue.length = 0;
  if (typeof IntersectionObserver !== 'function') return;
  observer = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        observer.unobserve(en.target);
        const it = byId.get(en.target.dataset.epid);
        if (it) thumbQueue.push([en.target, it]);
      }
      if (thumbQueue.length) drainThumbs();
    },
    { rootMargin: '300px' },
  );
  for (const box of grid.querySelectorAll('.exthumb')) observer.observe(box);
}

function card(it) {
  const box = el('div', { class: 'exthumb', data: { epid: it.episodeId }, html: spinnerHtml() });
  const star = el('button', {
    class: 'exfav' + (it.favorite ? ' on' : ''),
    text: it.favorite ? '★' : '☆',
    title: 'お気に入り',
    on: {
      click: async (e) => {
        e.stopPropagation();
        it.favorite = await toggleFavorite(it.episodeId);
        star.textContent = it.favorite ? '★' : '☆';
        star.classList.toggle('on', it.favorite);
      },
    },
  });
  const c = el('div', { class: 'excard', title: `${it.displayName}／${it.label} ${it.title}`, on: { click: () => navTo('character', it.folderKey, { section: 'story', epId: it.episodeId }) } });
  c.appendChild(box);
  c.appendChild(star);
  c.appendChild(el('div', 'exname', nameFix(it.displayName)));
  c.appendChild(el('div', 'extitle', `${it.label}　${nameFix(it.title)}`));
  const cats = xposNames(it.xpos);
  if (cats.length) c.appendChild(el('div', 'excats', cats.map((n) => el('span', 'excat', n))));
  return c;
}

function revokeUrls() {
  for (const u of urls) URL.revokeObjectURL(u);
  urls.length = 0;
}

export async function renderExScenes(grid) {
  const items = await exSceneItems();
  const q = (getById('rosterSearch').value || '').trim();
  const qk = kanaKey(q);
  const shown = items.filter((it) => matches(it, q, qk));
  const byName = (a, b) => (a.displayName > b.displayName ? 1 : a.displayName < b.displayName ? -1 : 0);
  const cmp = characterComparer(byName);
  shown.sort((a, b) => cmp(a, b) || Number(a.episodeId) - Number(b.episodeId));

  grid.innerHTML = '';
  revokeUrls();
  grid.className = 'rostergrid exgrid';
  const byId = new Map(shown.map((it) => [it.episodeId, it]));
  append(grid, shown.map(card));
  watchThumbs(grid, byId);
  const count = getById('rostercount');
  if (count) count.textContent = `${shown.filter((it) => it.downloaded).length} / ${shown.length}`;
}

export function resetExScenes() {
  if (observer) observer.disconnect();
  observer = null;
  thumbQueue.length = 0;
  revokeUrls();
}
