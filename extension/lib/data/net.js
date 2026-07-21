'use strict';
(function () {
  const CFG = globalThis.TP_CONFIG;
  const MISSING = Symbol('missing');
  const sleep = globalThis.TP_UTIL.sleep;
  const bytesToB64 = globalThis.TP_UTIL.bytesToB64;

  function voiceCandidates(base) {
    const set = new Set([base + '/Assets/WebGL']);
    for (const n of [3, 0]) { const v = base.replace(/production\d+-/, 'production' + n + '-'); if (v !== base) set.add(v + '/Assets/WebGL'); }
    return [...set];
  }

  async function assetRoot() {
    const o = await chrome.storage.local.get('assetRoot');
    return (o.assetRoot || CFG.assetRootDefault || '').replace(/\/+$/, '');
  }
  let _voiceBase = null;
  async function resolveVoiceBase(voice, probeSceneId) {
    if (_voiceBase) return _voiceBase;
    // assetRoot(ライブ現行productionN)を最優先候補にしつつ、prod3/prod0フォールバックもprobeする(productionN差異でvoiceが404する話を取り逃さないため)。
    const root = await assetRoot();
    const candidates = [];
    if (root) candidates.push(root + '/Assets/WebGL');
    for (const c of (voice.cdnBaseCandidates || [])) if (!candidates.includes(c)) candidates.push(c);
    if (!candidates.length) return (_voiceBase = null);
    const cached = (await chrome.storage.local.get('voiceBase')).voiceBase;
    if (cached && candidates.includes(cached)) return (_voiceBase = cached);
    const firstChar = Object.keys(voice.character)[0];
    const probe = probeSceneId && voice.adventure[probeSceneId]
      ? `adventurevoice_assets_adventurevoice/${probeSceneId}_${voice.adventure[probeSceneId]}.bundle`
      : (firstChar ? `charactervoices_assets_charactervoices/${firstChar}_${voice.character[firstChar]}.bundle` : null);
    if (probe) for (const base of candidates) {
      try { const res = await fetch(`${base}/${probe}`, { method: 'HEAD' }); if (res.ok) { _voiceBase = base; await chrome.storage.local.set({ voiceBase: base }); return base; } } catch (e) {}
    }
    return (_voiceBase = candidates[0]);
  }
  const adventureVoiceUrl = (base, sceneId, hash) => `${base}/adventurevoice_assets_adventurevoice/${sceneId}_${hash}.bundle`;
  const characterVoiceUrl = (base, charId, hash) => `${base}/charactervoices_assets_charactervoices/${charId}_${hash}.bundle`;

  const SEGMENT_FALLBACK = [3, 4];
  let _segmentHint = null;
  async function loadSegmentHints() { if (_segmentHint) return; try { _segmentHint = (await chrome.storage.local.get('segHints')).segHints || {}; } catch (e) { _segmentHint = {}; } }
  const segmentOf = (url) => { const m = url.match(/\/production\/production(\d+)-[0-9a-f-]+\//i); return m ? Number(m[1]) : null; };
  const swapSegment = (url, n) => url.replace(/(\/production\/production)\d+(-[0-9a-f-]+\/)/i, `$1${n}$2`);
  const categoryOf = (url) => { const m = url.match(/\/Assets\/WebGL\/([a-z0-9()]+_assets_[a-z0-9()]+)\//i); return m ? m[1] : null; };
  async function fetchBytes(url, returnMissingSentinel) {
    const primary = segmentOf(url);
    let tryUrls = [url];
    if (primary != null) {
      await loadSegmentHints();
      const cat = categoryOf(url);
      const hint = cat != null ? _segmentHint[cat] : null;
      const order = [];
      if (hint != null) order.push(hint);
      if (!order.includes(primary)) order.push(primary);
      for (const s of SEGMENT_FALLBACK) if (!order.includes(s)) order.push(s);
      tryUrls = order.map((s) => swapSegment(url, s));
    }
    for (const u of tryUrls) {
      for (let i = 0; i < 2; i++) {
        try {
          const res = await fetch(u, { signal: AbortSignal.timeout(120000) });
          if (res.ok) {
            const cat = categoryOf(u), s = segmentOf(u);
            if (cat != null && s != null && _segmentHint && _segmentHint[cat] !== s) { _segmentHint[cat] = s; try { chrome.storage.local.set({ segHints: _segmentHint }); } catch (e) {} }
            return new Uint8Array(await res.arrayBuffer());
          }
          if (res.status === 404) break;
        } catch (e) { if (i === 0) await sleep(5000); }
      }
    }
    return returnMissingSentinel ? MISSING : null;
  }

  async function apiFetchBytes(url, method, withStatus) {
    const st = await chrome.storage.local.get(['apiAuth', 'apiAuthBad']);
    const auth = st.apiAuth;
    const expired = auth && auth.exp && Math.floor(Date.now() / 1000) >= auth.exp;
    if (!auth || !auth.authorization || auth.authorization === st.apiAuthBad || expired) { const e = new Error('AUTH'); e.auth = true; throw e; }
    const headers = { Accept: 'application/vnd.msgpack', Authorization: auth.authorization };
    for (const k of ['X-Platform', 'X-Device', 'x-client-version', 'x-masterdata-version']) if (auth[k]) headers[k] = auth[k];
    headers['X-Rating'] = 'r18'; // R18タイトル固定(auth側のX-Ratingは使わない)
    try {
      const r = await fetch(url, { method: method || 'GET', headers, credentials: 'include' });
      if (r.status === 401 || r.status === 403) { try { await chrome.storage.local.set({ apiAuthBad: auth.authorization }); } catch (e2) {} const e = new Error('AUTH'); e.auth = true; throw e; }
      if (!r.ok) return null;
      const buf = new Uint8Array(await r.arrayBuffer());
      return withStatus ? { status: r.status, ok: true, base64: bytesToB64(buf) } : buf;
    } catch (e) { if (e && e.auth) throw e; return null; }
  }

  globalThis.TP_NET = { MISSING, voiceCandidates, assetRoot, resolveVoiceBase, adventureVoiceUrl, characterVoiceUrl, fetchBytes, apiFetchBytes };
})();
