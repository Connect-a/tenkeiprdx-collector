'use strict';
// キャラ資産ロード。handle/metaからmodel/material/weapon/口アトラスを解決し、ボイスclip抽出/BlobURL化を提供。
(function () {
  const FS = () => globalThis.TP_FS;
  const MESH = () => globalThis.TP_MESH;
  const DECODE = () => globalThis.TP_DECODE;
  const EMPTY_MAT = { materials: [], textures: [] };

  async function readBundle(handle, rel) {
    if (!rel || !handle) return null;
    const f = await FS().readUnder(handle, rel);
    return f ? new Uint8Array(await f.arrayBuffer()) : null;
  }

  async function openByCharId(charId) {
    const fs = FS(); if (!fs) return { error: 'nofs' };
    await fs.load();
    if ((await fs.permission(false)) !== 'granted') return { error: 'permission' };
    const hit = (await fs.listCharDirs()).find((d) => String(d.charId) === String(charId));
    if (!hit) return { error: 'notfound' };
    const f = await fs.readUnder(hit.handle, 'character.json');
    if (!f) return { error: 'nometa' };
    try { return { charId: String(charId), handle: hit.handle, meta: JSON.parse(await f.text()) }; }
    catch (e) { return { error: 'parse' }; }
  }

  async function loadWeapons(handle, assets) {
    const wmap = assets && assets.weapon; const mesh = MESH();
    if (!wmap || !mesh) return null;
    const out = [];
    for (const id of Object.keys(wmap)) {
      const w = wmap[id];
      try {
        const mb = w.model ? await readBundle(handle, w.model) : null;
        if (!mb) continue;
        const matB = w.materials ? await readBundle(handle, w.materials) : null;
        out.push({ model: mesh.parseModelBundle(mb), materials: matB ? mesh.parseMaterialBundle(matB) : EMPTY_MAT, slot: w.slot || 'wp_2', scale: w.scale || 1 });
      } catch (e) {}
    }
    return out.length ? out : null;
  }

  async function loadMouthAtlas(bytes) {
    const mesh = MESH(); if (!mesh) return null;
    try {
      let b = bytes;
      if (!b && FS()) b = await FS().readBundleUnder(null, '_共有リソース/3d/mouthmaterials.bundle'); // 口アトラスは共有フォルダ直読(readBundleUnderが_共有リソース/をルーティング)
      return b ? mesh.parseMouthAtlas(b) : null;
    } catch (e) { return null; }
  }

  async function load3d(cur, opts) {
    opts = opts || {};
    const mesh = MESH(); if (!mesh || !cur || !cur.handle) return null;
    const assets = (cur.meta || {}).assets || {};
    const charId = String(cur.charId || '');
    const modelPath = assets.model && (assets.model[charId] || assets.model[Object.keys(assets.model)[0]]);
    if (!modelPath) return null;
    const variations = Object.keys(assets.materials || {});
    const costume = (opts.costume && variations.includes(opts.costume)) ? opts.costume
      : (variations.includes('default') ? 'default' : variations[0]);
    const matPath = (assets.materials && (assets.materials[costume] || assets.materials[charId])) || null;
    const modelBytes = await readBundle(cur.handle, modelPath);
    if (!modelBytes) return null;
    const matBytes = matPath ? await readBundle(cur.handle, matPath) : null;
    return {
      model: mesh.parseModelBundle(modelBytes),
      matBundle: matBytes ? mesh.parseMaterialBundle(matBytes) : EMPTY_MAT,
      weapons: await loadWeapons(cur.handle, assets),
      mouthAtlas: await loadMouthAtlas(opts.mouthAtlasBytes),
      variations, costume,
    };
  }

  async function extractClips(handle, path) {
    const dec = DECODE(), fs = FS();
    if (!handle || !path || !dec || !fs) return [];
    const f = await fs.readUnder(handle, path);
    if (!f) return [];
    try { return dec.extractVoiceClips(new Uint8Array(await f.arrayBuffer())); } catch (e) { return []; }
  }

  async function voiceClips(handle, path, cache) {
    cache = cache || new Map();
    for (const c of await extractClips(handle, path)) {
      if (!cache.has(c.name)) cache.set(c.name, URL.createObjectURL(new Blob([c.data], { type: 'audio/mp4' })));
    }
    return cache;
  }

  globalThis.TP_CHARASSETS = { openByCharId, load3d, loadWeapons, loadMouthAtlas, extractClips, voiceClips, readBundle };
})();
