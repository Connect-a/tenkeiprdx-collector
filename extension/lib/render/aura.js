'use strict';
// TP_AURA — オーラ(VFX)カタログの取得・列挙・bytes/texMap解決。描画本体はTP_PARTICLES。
(function () {
  const AURA_RE = /(vfx[a-z]*_assets_[a-z]*\/([a-z0-9_]*abnorma.?aura[a-z0-9_]*)_[0-9a-f]{32}\.bundle)$/i;
  const KEY_RE = /\/([a-z0-9_]*abnorma.?aura[a-z0-9_]*)_[0-9a-f]{32}\.bundle$/i;
  let _catalog = null;
  const _cache = new Map();
  const assetRoot = async () => (await chrome.storage.local.get('assetRoot')).assetRoot || (globalThis.TP_CONFIG && globalThis.TP_CONFIG.assetRootDefault) || '';

  async function catalog() {
    if (_catalog) return _catalog;
    const base = await assetRoot();
    _catalog = await (await fetch(`${base}/Assets/WebGL/vfx_catalog.json`)).json();
    return _catalog;
  }

  // ピッカー用一覧。{rel(bundle相対パス), label(表示名)} を重複なしで返す。
  async function list() {
    const out = [], seen = new Set();
    let cat; try { cat = await catalog(); } catch (e) { return out; }
    for (const s of (cat.m_InternalIds || [])) {
      const m = String(s).match(AURA_RE);
      if (!m || seen.has(m[2])) continue;
      seen.add(m[2]);
      out.push({ rel: m[1], label: m[2].replace(/^abnorma.?aura_?/i, '') || m[2] });
    }
    return out;
  }

  async function fetchBytes(rel) {
    try { const base = await assetRoot(); const r = await fetch(`${base}/Assets/WebGL/${rel}`); if (r.ok) return new Uint8Array(await r.arrayBuffer()); } catch (e) {}
    return null;
  }

  // オーラbundleのbytesと、依存material→Texture解決(texByMatPid)を返す。相対パス毎にキャッシュ。
  async function load(rel) {
    if (!rel) return null;
    if (_cache.has(rel)) return _cache.get(rel);
    const bytes = await fetchBytes(rel);
    let texByMatPid = null;
    const P = globalThis.TP_PARTICLES;
    if (bytes && P && globalThis.THREE) {
      try {
        const key = (rel.match(KEY_RE) || [])[1];
        const cat = await catalog();
        const deps = P.resolveDeps(cat, new RegExp(key + '\\.prefab$', 'i')).filter((d) => d !== rel);
        const db = [];
        for (const d of deps) { const b = await fetchBytes(d); if (b) db.push(b); }
        texByMatPid = P.buildTexMap(globalThis.THREE, db);
      } catch (e) {}
    }
    const out = { bytes, texByMatPid };
    _cache.set(rel, out);
    return out;
  }

  globalThis.TP_AURA = { catalog, list, load };
})();
