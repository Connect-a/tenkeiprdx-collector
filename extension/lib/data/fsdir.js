'use strict';
(function () {
  const IDB = globalThis.TP_IDB;
  const KEY = 'homeDir';
  const supported = typeof self !== 'undefined' && 'showDirectoryPicker' in self;
  let _handle = null;

  async function load() { if (_handle) return _handle; try { _handle = (await IDB.get(KEY)) || null; } catch (e) { _handle = null; } return _handle; }
  async function pick() {
    if (!supported) { const e = new Error('File System Access API 非対応'); e.fsUnsupported = true; throw e; }
    let picked;
    try { picked = await self.showDirectoryPicker({ mode: 'readwrite' }); }
    catch (e) { if (e && e.name === 'AbortError') return null; throw e; }
    _handle = picked; await IDB.set(KEY, picked); return picked;
  }
  async function permission(request) {
    const h = await load(); if (!h) return supported ? 'prompt' : 'unsupported';
    const opts = { mode: 'readwrite' };
    return request ? h.requestPermission(opts) : h.queryPermission(opts);
  }
  async function ensure() {
    const h = await load(); if (!h) return null;
    if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return h;
    if ((await h.requestPermission({ mode: 'readwrite' })) === 'granted') return h;
    return null;
  }
  const dirName = () => (_handle ? _handle.name : '');

  const sanitize = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
  const charDirName = (key, name) => `${key}__${sanitize(name)}`;
  const parseCharId = (dn) => { const m = dn.match(/^(.+?)__/); return m ? m[1] : null; };

  async function getCharDir(charId, name, create) {
    const h = create ? await ensure() : await load();
    if (!h) return null;
    if (!create && (await h.queryPermission({ mode: 'readwrite' })) !== 'granted') return null;
    return h.getDirectoryHandle(charDirName(charId, name), { create: !!create });
  }
  async function getDir(name, create) {
    const h = create ? await ensure() : await load();
    if (!h) return null;
    if (!create && (await h.queryPermission({ mode: 'readwrite' })) !== 'granted') return null;
    return h.getDirectoryHandle(name, { create: !!create });
  }
  async function writeUnder(dirHandle, subpath, data) {
    const parts = subpath.split('/'); const fn = parts.pop();
    let d = dirHandle;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create: true });
    const fh = await d.getFileHandle(fn, { create: true });
    const w = await fh.createWritable(); await w.write(data); await w.close();
  }
  async function readUnder(dirHandle, subpath) {
    const parts = subpath.split('/'); const fn = parts.pop();
    let d = dirHandle;
    try { for (const p of parts) d = await d.getDirectoryHandle(p, { create: false }); const fh = await d.getFileHandle(fn, { create: false }); return await fh.getFile(); }
    catch (e) { return null; }
  }
  async function listUnder(dirHandle, subdir) {
    let d = dirHandle;
    try { for (const p of subdir.split('/').filter(Boolean)) d = await d.getDirectoryHandle(p, { create: false }); }
    catch (e) { return []; }
    const out = []; for await (const [fn, e] of d.entries()) if (e.kind === 'file') out.push(fn); return out;
  }
  async function exists(dirHandle, subpath) {
    const parts = subpath.split('/'); const fn = parts.pop();
    let d = dirHandle;
    try { for (const p of parts) d = await d.getDirectoryHandle(p, { create: false }); await d.getFileHandle(fn, { create: false }); return true; }
    catch (e) { return false; }
  }

  async function listCharDirs() {
    const h = await load(); if (!h) return [];
    if ((await h.queryPermission({ mode: 'readwrite' })) !== 'granted') return [];
    const out = [];
    for await (const [dn, entry] of h.entries()) { if (entry.kind !== 'directory') continue; const cid = parseCharId(dn); if (cid) out.push({ charId: cid, dirName: dn, handle: entry }); }
    return out;
  }
  async function readBundleUnder(charHandle, rel) {
    if (!rel || typeof rel !== 'string') return null;
    let dir, sub;
    if (rel.startsWith('_共有リソース/')) { dir = await getDir('_共有リソース', false); sub = rel.replace(/^_共有リソース\//, ''); }
    else { dir = charHandle; sub = rel; }
    if (!dir) return null;
    const f = await readUnder(dir, sub);
    return f ? new Uint8Array(await f.arrayBuffer()) : null;
  }
  async function walkBundles(dirHandle, prefix, out, depth) {
    out = out || []; prefix = prefix || ''; depth = depth || 0;
    if (!dirHandle || depth > 6) return out;
    try {
      for await (const [name, entry] of dirHandle.entries()) {
        const rel = prefix ? prefix + '/' + name : name;
        if (entry.kind === 'file') { if (/\.bundle$/i.test(name)) out.push(rel); }
        else if (entry.kind === 'directory') await walkBundles(entry, rel, out, depth + 1);
      }
    } catch (e) {}
    return out;
  }
  globalThis.TP_FS = { supported, load, pick, permission, ensure, dirName, getCharDir, getDir, writeUnder, readUnder, listUnder, exists, listCharDirs, readBundleUnder, walkBundles };
})();
