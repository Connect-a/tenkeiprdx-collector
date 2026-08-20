const list = (o, k) => (o && Array.isArray(o[k]) ? o[k] : []);

function resolveVariationMaterial(matVar, modelId, variation, materials) {
  const mapped = (matVar || {})[modelId + '_' + (variation || 'Default')];
  if (!mapped || !mapped.length) return null;
  return mapped.find((r) => materials.includes(r)) || mapped[0];
}

function imagesForCard(idx, meta, folderKey) {
  const assets = (idx && idx.assets) || {};
  const master = (idx && idx.master) || {};
  const apiType = meta && meta.apiType;
  const eid = meta && meta.eventId != null ? String(meta.eventId) : String(folderKey == null ? '' : folderKey).replace(/^(quest|special)_/, '');
  const out = [];
  const seen = new Set();
  const push = (rel, kind) => {
    if (!rel || seen.has(rel)) return;
    seen.add(rel);
    out.push({ rel, kind });
  };
  if (!eid) return out;
  const ck = meta && meta.chapter ? eid + ':' + (meta.chapterOrder || 0) : '';
  if (apiType === 'Special' || apiType === 'Quest') {
    const byCh = ck ? list(assets.episodeThumbsByChapter, ck) : [];
    for (const rel of byCh.length ? byCh : list(assets.episodeThumbsByEvent, eid)) push(rel, 'thumb');
  }
  if (apiType === 'Quest') {
    const byCh = ck ? list(master.questThumbsByEvent, ck) : [];
    for (const nm of byCh.length ? byCh : list(master.questThumbsByEvent, eid)) push(assets.questThumbRel && assets.questThumbRel[nm], 'thumb');
  }
  for (const rel of list(assets.eventBanners, eid)) push(rel, 'banner');
  return out;
}
function visualAssetsForCard(idx, meta, folderKey) {
  const assets = (idx && idx.assets) || {};
  const master = (idx && idx.master) || {};
  const out = [];
  const seen = new Set();
  const push = (cat, rel) => {
    if (!rel || seen.has(cat + '|' + rel)) return;
    seen.add(cat + '|' + rel);
    out.push({ cat, rel });
  };
  const own = (assets.assetIndex || {})[String(folderKey)] || {};
  for (const [cat, rels] of Object.entries(own)) {
    if (cat === 'cg_bg' || cat === 'still' || cat === 'illustx') continue;
    for (const rel of rels) push(cat, rel);
  }
  if (meta && meta.apiType === 'Character') {
    const det = (master.characters || {})[String(folderKey)];
    push('chibiicon', det && det.chibiIconId && assets.chibiIndex && assets.chibiIndex[det.chibiIconId]);
    const sharedItems = assets.sharedItemIconMap || {};
    for (const it of (det && det.itemIconIds) || []) if (!sharedItems[it]) push('itemicon', assets.itemIndex && assets.itemIndex[it]);
    for (const rel of (assets.equipIconsByChar || {})[String(folderKey)] || []) push('equipicon', rel);
  }
  for (const img of imagesForCard(idx, meta, folderKey)) push(img.kind, img.rel);
  return out;
}

function bgmParts(sceneAssets, name) {
  const sa = sceneAssets || {};
  if (!name) return null;
  const loop = sa[name + '_loop'];
  if (loop) return { loop, intro: sa[name + '_intro'] || null, plain: sa[name] || null, split: true };
  const plain = sa[name];
  return plain ? { loop: plain, intro: null, plain, split: false } : null;
}

export const assetRefs = { imagesForCard, visualAssetsForCard, bgmParts, resolveVariationMaterial };
