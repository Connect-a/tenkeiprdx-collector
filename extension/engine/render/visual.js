import { utilHelpers } from '../../core/util.js';
import { unityCrunch as CRUNCH_MOD } from '../../unity/crunch.js';
import { texCodec } from '../../unity/texcodec.js';
import { imageZoom } from './imgzoom.js';
import { characterMeta, episodeIdOf } from '../../data/character-meta.js';
import { unityMesh } from '../../unity/mesh.js';
import { spineWeb } from '../story/spine-web.js';
import { slotGroup } from '../story/slot-group.js';
import { DIRS } from '../../core/constants.js';
import { bundleName } from '../../core/paths.js';
import { el, append } from '../../core/dom.js';
import { buildGroupedVisPanel } from '../../core/vis-panel.js';
import { fileStore } from '../../core/fsdir.js';
import { assetStore } from '../../data/asset-store.js';
import { ensureIndexes } from '../../data/index-store.js';
import { unityDecode } from '../../unity/decode.js';
const mapLimit = (items, limit, worker) => utilHelpers.pool(Array.isArray(items) ? items : [], limit, worker);

const setupAlpha = (slot) => (slot.data && slot.data.color && slot.data.color.a != null ? slot.data.color.a : 1);
function installPlayerVis(player) {
  if (player.__visHooked) return player.__vis;
  player.__vis = {};
  const orig = player.drawFrame ? player.drawFrame.bind(player) : null;
  if (!orig) return player.__vis;
  const held = new Set();
  player.drawFrame = function (rnf) {
    try {
      const sk = player.skeleton;
      if (sk && sk.slots)
        for (const slot of sk.slots) {
          const name = slot.data.name;
          const a = player.__vis[name];
          if (a != null) {
            slot.color.a = a;
            held.add(name);
          } else if (held.has(name)) {
            slot.color.a = setupAlpha(slot);
            held.delete(name);
          }
        }
    } catch (e) {}
    return orig(rnf);
  };
  player.__visHooked = true;
  return player.__vis;
}
function buildVisPanel(panel, player) {
  const sk = player && player.skeleton;
  if (!sk || !sk.slots) {
    panel.textContent = '（読み込み中… もう一度開いてください）';
    return false;
  }
  const vis = installPlayerVis(player);
  const groups = new Map();
  for (const slot of sk.slots) {
    const nm = slot.data.name;
    const g = slotGroup(nm);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(nm);
  }
  buildGroupedVisPanel(panel, {
    groups: [...groups],
    alphaOf: (n) => (vis[n] == null ? 1 : vis[n]),
    onSet: (names, a) => {
      for (const n of names) {
        if (a === 1) delete vis[n];
        else vis[n] = a;
      }
    },
    onResetAll: () => {
      for (const k of Object.keys(vis)) delete vis[k];
    },
  });
  return true;
}
function attachVisControl(cell, player) {
  const panel = el('div', { class: 'spine-vispanel', style: { display: 'none' } });
  const btn = el('button', {
    class: 'btn xs spine-visbtn active',
    text: '表示制御',
    on: {
      click: () => {
        if (panel.style.display !== 'none') {
          panel.style.display = 'none';
          btn.classList.add('active');
          return;
        }
        if (!panel.__built) panel.__built = buildVisPanel(panel, player);
        panel.style.display = '';
        btn.classList.remove('active');
      },
    },
  });
  cell.appendChild(btn);
  cell.appendChild(panel);
}

const crunchCaps = () => {
  const canCrunch = !!(CRUNCH_MOD && CRUNCH_MOD.canDecodeCrunched && CRUNCH_MOD.canDecodeCrunched());
  const unityCrunchSupported = !!(canCrunch && CRUNCH_MOD.supportsUnityCrunched && CRUNCH_MOD.supportsUnityCrunched());
  return { canCrunch, unityCrunchSupported };
};

const readBundle = async (cur, relPath) => {
  if (!relPath || typeof relPath !== 'string') return null;
  if (relPath.startsWith(DIRS.shared + '/')) {
    const shared = await fileStore.getDir(DIRS.shared, { create: false });
    if (!shared) return null;
    const sub = relPath.slice(DIRS.shared.length + 1);
    return fileStore.readUnder(shared, sub);
  }
  return fileStore.readUnder(cur.handle, relPath);
};

const readParsedBundle = async (cur, relPath) => {
  const f = await readBundle(cur, relPath);
  if (!f) return null;
  return unityDecode.parseUnityFS(new Uint8Array(await f.arrayBuffer()));
};

async function storySceneBgNames(cur) {
  const names = new Set();
  const eps = (cur && cur.meta && Array.isArray(cur.meta.episodes) && cur.meta.episodes) || [];
  for (const ep of eps) {
    const dir = 'story/' + episodeIdOf(ep);
    let files = [];
    try {
      files = await fileStore.listUnder(cur.handle, dir);
    } catch (e) {}
    for (const fn of files) {
      if (!/^scene_.*\.json$/i.test(fn)) continue;
      try {
        const f = await fileStore.readUnder(cur.handle, dir + '/' + fn);
        if (!f) continue;
        const tl = JSON.parse(await f.text());
        for (const ln of (tl && tl.lines) || []) if (ln && ln.bg) names.add(String(ln.bg));
      } catch (e) {}
    }
  }
  return names;
}

async function sharedStoryImagePaths(cur, known) {
  const names = await storySceneBgNames(cur);
  if (!names.size) return [];
  let sceneAssets = {};
  let generic = new Set();
  try {
    const idx = await ensureIndexes();
    sceneAssets = idx.assets.sceneAssetIndex || {};
    generic = new Set(idx.master.sharedImageNames || []);
  } catch (e) {}
  const out = [];
  for (const name of [...names].sort()) {
    if (generic.has(name)) continue;
    const rel = sceneAssets[name];
    if (!rel) continue;
    let sub = null;
    try {
      sub = await assetStore.locate(DIRS.shared, rel);
    } catch (e) {}
    if (!sub) continue;
    const path = DIRS.shared + '/' + sub;
    if (known.has(path)) continue;
    known.add(path);
    out.push(path);
  }
  return out;
}

const getVisuals = (meta) => (meta && Array.isArray(meta.visuals) && meta.visuals) || (characterMeta && characterMeta.buildVisuals ? characterMeta.buildVisuals(meta || {}) : []);
const spineVisuals = (meta) => getVisuals(meta).filter((v) => v.kind === 'spine' && /\.bundle$/i.test(v.path || ''));
const imageVisuals = (meta) => getVisuals(meta).filter((v) => v.kind === 'image' && /\.bundle$/i.test(v.path || ''));

const extractSpineInputsFromBundle = async (cur, bundlePath) => {
  const f = await readBundle(cur, bundlePath);
  if (!f) return { ok: false, reason: 'bundle-missing', bundlePath };
  const inp = unityMesh.extractSpineInputs(new Uint8Array(await f.arrayBuffer()));
  if (!inp) return { ok: false, reason: 'spineWeb-inputs-missing', bundlePath };
  return { ok: true, bundlePath, ...inp };
};

const extractSpineFromEntry = async (cur, entry) => {
  let lastErr = null;
  for (const p of [entry.spinePath].filter(Boolean)) {
    try {
      const r = await extractSpineInputsFromBundle(cur, p);
      if (r && r.ok) return { inputs: r };
      lastErr = r;
    } catch (e) {
      lastErr = { ok: false, reason: e && e.message ? e.message : String(e), bundlePath: p };
    }
  }
  return { inputs: null, lastErr };
};

const MAX_SPINE_PREVIEWS = 12;
let _renderGen = 0;
const newRenderGen = () => ++_renderGen;
let _activePlayers = [];
function disposeSpinePlayers() {
  _renderGen++;
  for (const sp of _activePlayers) {
    try {
      sp && sp.dispose && sp.dispose();
    } catch (e) {}
  }
  _activePlayers = [];
}
function reapDetachedSpinePlayers() {
  const live = [];
  for (const sp of _activePlayers) {
    const cv = sp && (sp.canvas || (sp.gl && sp.gl.canvas));
    if (cv && !cv.isConnected) {
      try {
        sp.dispose && sp.dispose();
      } catch (e) {}
    } else live.push(sp);
  }
  _activePlayers = live;
}
const currentRenderGen = () => _renderGen;

let _galleryUrls = [];
let _galleryCanvases = [];
function disposeGallery() {
  for (const u of _galleryUrls) {
    try {
      URL.revokeObjectURL(u);
    } catch (e) {}
  }
  _galleryUrls = [];
  for (const cv of _galleryCanvases) {
    try {
      cv.width = 0;
      cv.height = 0;
    } catch (e) {}
  }
  _galleryCanvases = [];
}

async function renderSpinePreview(cur, hostEl) {
  reapDetachedSpinePlayers();
  if (!hostEl) return { ok: false, reason: 'host-missing' };
  const baseEntries = spineVisuals((cur && cur.meta) || {}).map((v) => ({ id: v.label, label: v.label, spinePath: v.path, stand: v.stand !== false }));
  if (cur && cur.handle && fileStore.walkBundles) {
    try {
      const known = new Set(baseEntries.map((e) => e.spinePath));
      for (const rel of await fileStore.walkBundles(cur.handle)) {
        if (known.has(rel) || !/(^|\/)story\/[^/]+\/cg\//i.test(rel)) continue;
        const rn = bundleName(rel);
        if (!/^\d{8}_\d+$/.test(rn)) continue;
        known.add(rel);
        baseEntries.push({ id: 'still ' + rn, label: 'still ' + rn, spinePath: rel, stand: false });
      }
    } catch (e) {}
  }
  const entries = baseEntries.sort((a, b) => (a.stand === b.stand ? String(a.spinePath).localeCompare(String(b.spinePath)) : a.stand ? -1 : 1));
  if (!entries.length) {
    disposeSpinePlayers();
    hostEl.style.display = 'none';
    hostEl.innerHTML = '';
    return { ok: false, reason: 'no-spine-bundle-paths' };
  }
  const runtime = await prepareSpineRuntime(hostEl);
  if (!runtime.ok) return { ok: false, reason: 'spineWeb-runtime-not-ready' };

  disposeSpinePlayers();
  const myGen = newRenderGen();
  const alive = () => myGen === _renderGen;
  const myPlayers = [];
  _activePlayers = myPlayers;
  hostEl.style.display = '';
  hostEl.innerHTML = '';
  hostEl.classList.remove('spine-preview-error');

  const standWrap = el('div', 'spine-grid stand');
  const stillWrap = el('div', 'spine-grid still');
  append(hostEl, [standWrap, stillWrap]);
  const isStill = (entry) => entry.stand === false;

  const shown = entries.slice(0, MAX_SPINE_PREVIEWS);
  const results = [];
  let anyOk = false;

  for (const entry of shown) {
    if (!alive()) break;
    const cell = el('div', 'spine-cell', el('div', 'spine-cell-cap', entry.label || entry.id || 'spineWeb'));
    (isStill(entry) ? stillWrap : standWrap).appendChild(cell);

    const { inputs, lastErr } = await extractSpineFromEntry(cur, entry);
    if (!alive()) {
      cell.remove();
      break;
    }
    if (!inputs) {
      cell.appendChild(el('div', 'note', '再生不可: ' + ((lastErr && lastErr.reason) || 'unknown')));
      results.push({ id: entry.id, ok: false, reason: (lastErr && lastErr.reason) || 'unknown' });
      continue;
    }

    const box = el('div', 'spine-player-box');
    cell.appendChild(box);

    const stl = isStill(entry);
    let playerErr = null;
    const onError = (msg) => {
      if (playerErr) return;
      playerErr = msg;
      cell.appendChild(el('div', 'note', 'Spine失敗: ' + msg));
    };
    try {
      const { player } = spineWeb.buildPlayable(box, inputs, {
        showControls: true,
        backgroundColor: '#00000000',
        onError,
        onReady: (pl) => {
          if (stl) {
            let asp = 0;
            try {
              const vp = pl.currentViewport;
              if (vp && vp.width > 0 && vp.height > 0) asp = vp.width / vp.height;
            } catch (e) {}
            if (!asp) {
              try {
                const sp = spineWeb.lib();
                const o2 = new sp.Vector2(),
                  s2 = new sp.Vector2();
                pl.skeleton.setToSetupPose();
                pl.skeleton.updateWorldTransform();
                pl.skeleton.getBounds(o2, s2, []);
                if (s2.x > 0 && s2.y > 0) asp = s2.x / s2.y;
              } catch (e) {}
            }
            if (asp > 0) box.style.aspectRatio = asp.toFixed(4);
          }
          spineWeb.startDefaultIdle(pl);
          if (stl && pl.drawFrame) {
            try {
              pl.drawFrame(false);
            } catch (e) {}
          }
        },
      });
      myPlayers.push(player);
      attachVisControl(cell, player);
      anyOk = true;
    } catch (e) {
      playerErr = e && e.message ? e.message : String(e);
      onError(playerErr);
    }
    results.push({ id: entry.id, ok: !playerErr, bundlePath: inputs.bundlePath, playerError: playerErr });
  }

  if (!alive()) {
    for (const sp of myPlayers) {
      try {
        sp && sp.dispose && sp.dispose();
      } catch (e) {}
    }
    return { ok: false, reason: 'superseded' };
  }
  if (!standWrap.children.length) standWrap.remove();
  if (!stillWrap.children.length) stillWrap.remove();
  await new Promise((resolve) => setTimeout(resolve, 500));
  return { ok: anyOk, total: entries.length, shown: shown.length, truncated: entries.length > MAX_SPINE_PREVIEWS, entries: results };
}

async function renderImageGallery(cur, hostEl, opt) {
  if (!hostEl) return { ok: false, error: 'host element missing' };
  reapDetachedSpinePlayers();
  const myGen = newRenderGen();
  disposeGallery();
  const { canCrunch, unityCrunchSupported } = crunchCaps();

  const options = opt || {};
  const includeStoryAssets = !!options.includeStoryAssets;
  const maxBundles = Math.max(1, Math.min(200, Number(options.maxBundles) || 40));
  const maxItems = Math.max(1, Math.min(128, Number(options.maxItems) || 32));
  const maxConcurrent = Math.max(1, Math.min(8, Number(options.maxConcurrent) || 4));
  const flipY = options.flipY !== false;

  hostEl.style.display = '';
  hostEl.innerHTML = '';

  let paths = imageVisuals(cur.meta || {}).map((v) => v.path);
  if (includeStoryAssets && cur.handle && fileStore.walkBundles) {
    const known = new Set([...paths, ...spineVisuals(cur.meta || {}).map((v) => v.path)]);
    try {
      const SKIP = /(^|\/)(visual\/(spine|spinelight|model|weapon|illustvoice|skillfx)\/|story\/[^/]+\/(voice|bgm|se)\/|voice_gallery\.)/i;
      for (const rel of await fileStore.walkBundles(cur.handle)) {
        if (known.has(rel) || SKIP.test(rel)) continue;
        known.add(rel);
        paths.push(rel);
      }
    } catch (e) {}
    paths = paths.slice(0, maxBundles);
    try {
      paths.push(...(await sharedStoryImagePaths(cur, known)));
    } catch (e) {}
  }
  paths = paths.slice(0, maxBundles + 40);
  if (!paths.length) {
    hostEl.textContent = '画像系バンドルの候補が見つかりませんでした。';
    return { ok: false, error: 'no image bundle paths' };
  }

  const wrap = el('div', 'texprev');
  hostEl.appendChild(wrap);
  const summary = {
    ok: true,
    scannedBundles: paths.length,
    rendered: 0,
    failed: 0,
    items: [],
    mode: canCrunch ? 'crn+embedded' : 'embedded-only',
    maxConcurrent,
    flipY,
    includeStoryAssets,
    crunchSupport: {
      runtimeReady: canCrunch,
      unityCrunched: unityCrunchSupported,
    },
    failReasonCounts: {},
    failSamples: [],
  };

  const slots = paths.map((p) => {
    const ph = el('div', 'imgcard ph', [el('div', 'imgcap', bundleName(p) || p), el('div', 'loadspin', el('span', 'spin'))]);
    wrap.appendChild(ph);
    return ph;
  });

  const decodeBundle = async (p) => {
    const result = { path: p, rendered: false, items: [], failSamples: [], failed: 0 };
    try {
      const parsed = await readParsedBundle(cur, p);
      if (!parsed) {
        result.failed = 1;
        result.failSamples.push({ path: p, reason: 'missing-file' });
        return result;
      }

      if (!result.rendered) {
        const texResult = texCodec.extractTexture2DPreviews(parsed.data, canCrunch ? CRUNCH_MOD : null, Infinity, { flipY });
        for (const t of texResult.previews) {
          result.items.push({
            path: p,
            offset: t.offset,
            width: t.width,
            height: t.height,
            type: t.type,
            canvas: t.canvas,
          });
        }
        if (result.items.length) {
          result.rendered = true;
        } else {
          const probe = {
            texHeaders: texResult.stats.headerCandidates,
            texBlobResolved: texResult.stats.blobResolved,
            texDecoded: texResult.stats.decoded,
            texCrunchedSeen: texResult.stats.crunchedSeen,
            texCrunchedProbeFailed: texResult.stats.crunchedProbeFailed,
            texCrunchedDecodeFailed: texResult.stats.crunchedDecodeFailed,
            texUnityCrunchedUnsupported: texResult.stats.unityCrunchedUnsupported,
          };
          result.failSamples.push({
            path: p,
            reason: !unityCrunchSupported && texResult.stats.crunchedSeen > 0 ? 'unity-unityCrunch-unityDecode-unavailable' : 'texture2d-unityDecode-failed',
            probe,
          });
        }
      }

      if (!result.rendered) {
        const embedded = texCodec.extractEmbeddedImages(parsed.data, 2);
        for (const e of embedded) {
          const mime = e.type === 'jpg' ? 'image/jpeg' : `image/${e.type}`;
          if (flipY) {
            const canvas = await texCodec.decodeEncodedToCanvas(e.bytes, mime, true);
            result.items.push({ path: p, offset: e.offset, width: canvas.width, height: canvas.height, type: e.type, canvas });
          } else {
            const url = URL.createObjectURL(new Blob([e.bytes], { type: mime }));
            _galleryUrls.push(url);
            result.items.push({ path: p, offset: e.offset, width: e.width, height: e.height, type: e.type, imgUrl: url });
          }
        }
        if (result.items.length) result.rendered = true;
      }

      if (!result.rendered && canCrunch && unityCrunchSupported) {
        const cands = CRUNCH_MOD.findInBuffer(parsed.data, 1);
        let crnLastErr = null;
        for (const cand of cands) {
          try {
            const dec = CRUNCH_MOD.decodeLevel0RGBA(parsed.data.subarray(cand.offset));
            const rgba = flipY ? texCodec.flipRgbaY(dec.rgbaBytes, dec.width, dec.height) : dec.rgbaBytes;
            result.items.push({
              path: p,
              offset: cand.offset,
              width: dec.width,
              height: dec.height,
              type: 'crn',
              canvas: texCodec.renderRgbaToCanvas(rgba, dec.width, dec.height),
            });
            result.rendered = true;
            break;
          } catch (e) {
            crnLastErr = e;
          }
        }
        if (!result.rendered && cands.length && crnLastErr) {
          result.failSamples.push({
            path: p,
            reason: crnLastErr && crnLastErr.message ? crnLastErr.message : String(crnLastErr),
            crnProbe: cands[0] && cands[0].info ? cands[0].info : null,
          });
        }
      } else if (!result.rendered && canCrunch && !unityCrunchSupported) {
        result.failSamples.push({ path: p, reason: 'skip-crn-scan-unitycrunch-unsupported' });
      }

      if (!result.rendered) {
        result.failed = 1;
        result.failSamples.push({ path: p, reason: 'no-crn-no-texture2d-and-no-embedded-image' });
      }
    } catch (e) {
      result.failed = 1;
      result.failSamples.push({ path: p, reason: e && e.message ? e.message : String(e) });
    }
    return result;
  };

  const done = new Array(paths.length).fill(null);
  let commitAt = 0;
  const commit = () => {
    while (commitAt < paths.length && done[commitAt]) {
      const { res, slot } = done[commitAt];
      commitAt++;
      summary.failed += res.failed || 0;
      for (const s of res.failSamples || []) {
        const rk = String((s && s.reason) || 'unknown');
        summary.failReasonCounts[rk] = (summary.failReasonCounts[rk] || 0) + 1;
        if (summary.failSamples.length < 8) summary.failSamples.push(s);
      }
      const frag = document.createDocumentFragment();
      for (const item of res.items) {
        if (summary.rendered >= maxItems) break;
        if (item.canvas) _galleryCanvases.push(item.canvas);
        frag.appendChild(imageZoom.createImageCard(item));
        summary.items.push({ path: item.path, width: item.width, height: item.height, offset: item.offset, type: item.type });
        summary.rendered += 1;
      }
      if (frag.childNodes.length && slot.parentNode) slot.parentNode.insertBefore(frag, slot);
      slot.remove();
    }
  };
  await mapLimit(
    paths.map((p, i) => ({ p, i })),
    maxConcurrent,
    async ({ p, i }) => {
      if (myGen !== currentRenderGen()) return;
      const res = await decodeBundle(p);
      if (myGen !== currentRenderGen()) return;
      done[i] = { res, slot: slots[i] };
      commit();
    },
  );
  commit();

  if (myGen !== currentRenderGen()) return { ok: false, superseded: true };
  for (const s of slots) if (s.isConnected) s.remove();

  if (!summary.rendered) {
    hostEl.innerHTML = '';
    append(hostEl, [
      el('div', 'note', '候補バンドルは見つかりましたが、表示可能な画像を生成できませんでした。'),
      summary.failSamples.length ? el('pre', 'statusout', JSON.stringify({ failSamples: summary.failSamples })) : null,
    ]);
    return {
      ok: false,
      error: 'no renderable images',
      scannedBundles: summary.scannedBundles,
      failed: summary.failed,
      failReasonCounts: summary.failReasonCounts,
    };
  }

  return summary;
}

const WEBP_QUALITY = 0.92;
const DECODED_DIR = 'デコード結果';

const canvasToImageBytes = async (canvas) => {
  if (!canvas) return null;
  let blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY));
  if (blob && blob.type === 'image/webp') return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: 'webp' };
  blob = blob || (await new Promise((resolve) => canvas.toBlob(resolve, 'image/png')));
  if (!blob) return null;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: 'png' };
};

async function saveDecodedResources(cur, opt) {
  const options = opt || {};
  const includeStory = !!options.includeStory;
  const flipY = options.flipY !== false;
  const { canCrunch, unityCrunchSupported } = crunchCaps();

  if (!cur || !cur.handle || !fileStore.writeUnder || !fileStore.readUnder) {
    return { ok: false, reason: 'invalid-context' };
  }

  const destHandle = await fileStore.getDir(DIRS.save, { create: true });
  if (!destHandle) return { ok: false, reason: 'no-save-dir' };
  const folderName = fileStore.folderDirName ? fileStore.folderDirName(cur.folderKey, characterMeta.displayName(cur.meta || {}) || '') : String(cur.folderKey || 'char');
  const baseDir = `${DECODED_DIR}/${folderName}`;
  const outPath = (rel) => `${baseDir}/${rel}`;
  const writeOut = (rel, bytes) => fileStore.writeUnder(destHandle, outPath(rel), bytes);
  if (fileStore.removeDirUnder) {
    try {
      await fileStore.removeDirUnder(destHandle, baseDir);
    } catch (e) {}
  }
  const out = {
    ok: true,
    baseDir,
    includeStory,
    flipY,
    imageSaved: 0,
    voiceSaved: 0,
    timelineSaved: 0,
    imageBundlesScanned: 0,
    imageBundlesFailed: 0,
    failReasonCounts: {},
    failSamples: [],
  };

  const addFail = (reason, bundlePath) => {
    const key = String(reason || 'unknown');
    out.failReasonCounts[key] = (out.failReasonCounts[key] || 0) + 1;
    if (out.failSamples.length < 12) out.failSamples.push({ path: bundlePath || null, reason: key });
  };

  const imgPaths = [...new Set([...imageVisuals(cur.meta || {}), ...spineVisuals(cur.meta || {})].map((v) => v.path))];
  out.imageBundlesScanned = imgPaths.length;

  let imageIdx = 0;
  for (const p of imgPaths) {
    try {
      const parsed = await readParsedBundle(cur, p);
      if (!parsed) {
        out.imageBundlesFailed += 1;
        addFail('missing-file', p);
        continue;
      }
      const texResult = texCodec.extractTexture2DPreviews(parsed.data, canCrunch ? CRUNCH_MOD : null, Infinity, { flipY });
      const embedded = texCodec.extractEmbeddedImages(parsed.data, 4);

      let wrote = 0;
      for (const t of texResult.previews) {
        const img = await canvasToImageBytes(t.canvas);
        if (!img) continue;
        const bn = bundleName(p) || 'bundle';
        await writeOut(`images/${bn}__tex_${imageIdx}.${img.ext}`, img.bytes);
        imageIdx += 1;
        out.imageSaved += 1;
        wrote += 1;
      }

      for (let i = 0; i < embedded.length; i++) {
        const e = embedded[i];
        const bn = bundleName(p) || 'bundle';
        const mime = e.type === 'jpg' ? 'image/jpeg' : `image/${e.type}`;
        let img = null;
        try {
          img = await canvasToImageBytes(await texCodec.decodeEncodedToCanvas(e.bytes, mime, flipY));
        } catch (er) {}
        if (img) await writeOut(`images/${bn}__embedded_${i}.${img.ext}`, img.bytes);
        else await writeOut(`images/${bn}__embedded_${i}.${e.type === 'jpg' ? 'jpg' : e.type}`, flipY ? (await texCodec.flipEncodedImageBytesY(e.bytes, mime)).bytes : e.bytes);
        out.imageSaved += 1;
        wrote += 1;
      }

      if (!wrote) {
        out.imageBundlesFailed += 1;
        if (!unityCrunchSupported && texResult.stats.crunchedSeen > 0) addFail('unity-unityCrunch-unityDecode-unavailable', p);
        else addFail('no-renderable-image', p);
      }
    } catch (e) {
      out.imageBundlesFailed += 1;
      addFail(e && e.message ? e.message : String(e), p);
    }
  }

  const saveVoiceBundle = async (voicePath, prefix) => {
    if (!voicePath) return;
    const vf = await fileStore.readUnder(cur.handle, voicePath);
    if (!vf) {
      addFail('missing-voice-bundle', voicePath);
      return;
    }
    try {
      const clips = await unityDecode.extractVoiceClips(new Uint8Array(await vf.arrayBuffer()));
      const bn = bundleName(voicePath) || 'voice';
      for (const c of clips) {
        const nm = String(c.name || 'voice').replace(/[\\/:*?"<>|]+/g, '_');
        await writeOut(`${prefix}/${bn}/${nm}.${c.mime === 'audio/ogg' ? 'ogg' : 'mp4'}`, c.data);
        out.voiceSaved += 1;
      }
    } catch (e) {
      addFail('voice-extract-failed', voicePath);
    }
  };

  const voiceBundle = cur.meta && characterMeta.voiceGalleryBundle(cur.meta.voiceGallery);
  if (voiceBundle) {
    await saveVoiceBundle(voiceBundle, 'voice/character');
  }

  if (includeStory && cur.meta && Array.isArray(cur.meta.episodes)) {
    for (const ep of cur.meta.episodes) {
      if (!ep || ep.have === 'none') continue;
      const eid = String(episodeIdOf(ep) || 'episode');
      if (Array.isArray(ep.scenes)) {
        for (const s of ep.scenes) {
          if (s && s.timeline) {
            const tf = await fileStore.readUnder(cur.handle, s.timeline);
            if (tf) {
              const bytes = new Uint8Array(await tf.arrayBuffer());
              const tlName = (String(s.sceneId || 'scene') + '.json').replace(/[\\/:*?"<>|]+/g, '_');
              await writeOut(`story/${eid}/timeline/${tlName}`, bytes);
              out.timelineSaved += 1;
            }
          }
          if (s && s.voice) await saveVoiceBundle(s.voice, `voice/story/${eid}`);
        }
      }
    }
  }

  return out;
}

async function prepareSpineRuntime(hostEl) {
  if (!hostEl) return { ok: false, error: 'host element missing' };
  hostEl.style.display = '';
  if (spineWeb.runtimeReady()) return { ok: true, alreadyLoaded: true };
  const jsUrl = chrome.runtime.getURL('vendor/spine-player-3.8.js');
  const cssUrl = chrome.runtime.getURL('vendor/spine-player-3.8.css');
  document.head.appendChild(el('link', { rel: 'stylesheet', href: cssUrl }));
  try {
    await new Promise((resolve, reject) => {
      document.head.appendChild(el('script', { src: jsUrl, onload: resolve, onerror: reject }));
    });
    return { ok: true, loadedNow: true };
  } catch (e) {
    hostEl.textContent = '立ち絵の表示に必要な部品を読み込めませんでした。拡張機能を入れ直してください。';
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

export const visualRenderer = {
  prepareSpineRuntime,
  renderImageGallery,
  renderSpinePreview,
  disposeSpinePlayers,
  disposeGallery,
  saveDecodedResources,
};
