import { idbStore } from './idb.js';
import { DIRS, FOLDER_PARENTS } from './constants.js';
import { utilHelpers } from './util.js';
const pool = utilHelpers.pool;
const DIR_HANDLE_KEY = 'homeDir';
const supported = typeof self !== 'undefined' && 'showDirectoryPicker' in self;
let _handle = null;

async function load() {
  if (_handle) return _handle;
  try {
    _handle = (await idbStore.get(DIR_HANDLE_KEY)) || null;
  } catch (e) {
    _handle = null;
  }
  return _handle;
}
async function pick() {
  if (!supported) {
    const e = new Error('File System Access API 非対応');
    e.fsUnsupported = true;
    throw e;
  }
  let picked;
  try {
    picked = await self.showDirectoryPicker({ mode: 'readwrite' });
  } catch (e) {
    if (e && e.name === 'AbortError') return null;
    throw e;
  }
  _handle = picked;
  await idbStore.set(DIR_HANDLE_KEY, picked);
  return picked;
}
async function permission({ request } = {}) {
  const h = await load();
  if (!h) return supported ? 'prompt' : 'unsupported';
  const opts = { mode: 'readwrite' };
  return request ? h.requestPermission(opts) : h.queryPermission(opts);
}
async function ensure() {
  const h = await load();
  if (!h) return null;
  if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return h;
  if ((await h.requestPermission({ mode: 'readwrite' })) === 'granted') return h;
  return null;
}
const dirName = () => (_handle ? _handle.name : '');

const sanitize = (s) =>
  String(s || '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .slice(0, 60);
const folderDirName = (key, name) => `${key}__${sanitize(name)}`;
const parseFolderKey = (dn) => {
  const m = dn.match(/^(.+?)__/);
  return m ? m[1] : null;
};

async function rootDir(create) {
  const h = create ? await ensure() : await load();
  if (!h) return null;
  if (!create && (await h.queryPermission({ mode: 'readwrite' })) !== 'granted') return null;
  return h;
}
const _dirCache = new WeakMap();
function dropCachedChild(parent, name) {
  const m = _dirCache.get(parent);
  if (m) m.delete(name);
}
function cachedChild(parent, name) {
  let m = _dirCache.get(parent);
  if (!m) {
    m = new Map();
    _dirCache.set(parent, m);
  }
  let p = m.get(name);
  if (!p) {
    p = parent.getDirectoryHandle(name, { create: false });
    p.catch(() => {
      if (m.get(name) === p) m.delete(name);
    });
    m.set(name, p);
  }
  return p;
}
async function dropCachedPath(parent, parts) {
  let d = parent;
  for (const p of parts) {
    const m = _dirCache.get(d);
    if (!m) return;
    const pr = m.get(p);
    m.delete(p);
    if (!pr) return;
    try {
      d = await pr;
    } catch (e) {
      return;
    }
  }
}
async function descend(dirHandle, parts, create) {
  let d = dirHandle;
  for (const p of parts) d = create ? await d.getDirectoryHandle(p, { create: true }) : await cachedChild(d, p);
  return d;
}
async function getFolderDir(folderKey, name, { create, kind } = {}) {
  const h = await rootDir(create);
  if (!h) return null;
  const parent = FOLDER_PARENTS[kind] || FOLDER_PARENTS.character;
  const dn = folderDirName(folderKey, name);
  if (!parent) return h.getDirectoryHandle(dn, { create: !!create });
  if (create) return (await h.getDirectoryHandle(parent, { create: true })).getDirectoryHandle(dn, { create: true });
  try {
    return await (await cachedChild(h, parent)).getDirectoryHandle(dn, { create: false });
  } catch (e) {
    return null;
  }
}
async function removeDirUnder(dirHandle, subpath) {
  if (!dirHandle || !subpath) return false;
  const parts = String(subpath).split('/');
  const name = parts.pop();
  try {
    const d = await descend(dirHandle, parts, false);
    await d.removeEntry(name, { recursive: true });
    dropCachedChild(d, name);
    return true;
  } catch (e) {
    return false;
  }
}
async function getDir(name, { create } = {}) {
  const h = await rootDir(create);
  if (!h) return null;
  if (create) return h.getDirectoryHandle(name, { create: true });
  try {
    return await h.getDirectoryHandle(name, { create: false });
  } catch (e) {
    return null;
  }
}
const _writing = new Map();
const holdWrite = (fn) => _writing.set(fn, (_writing.get(fn) || 0) + 1);
const releaseWrite = (fn) => {
  const n = (_writing.get(fn) || 0) - 1;
  if (n > 0) _writing.set(fn, n);
  else _writing.delete(fn);
};

async function saveStream(dirHandle, subpath, body) {
  const parts = subpath.split('/');
  const fn = parts.pop();
  const d = await descend(dirHandle, parts, true);
  holdWrite(fn);
  try {
    const fh = await d.getFileHandle(fn, { create: true });
    const w = await fh.createWritable();
    try {
      await body.pipeTo(w);
    } catch (e) {
      try {
        if (!(await fh.getFile()).size) await d.removeEntry(fn);
      } catch (e2) {}
      throw e;
    }
  } finally {
    releaseWrite(fn);
  }
  return subpath;
}
async function purgeEmptyIn(dirHandle, subdirs) {
  let n = 0;
  for (const sub of subdirs || []) {
    try {
      const d = await descend(dirHandle, String(sub).split('/').filter(Boolean), false);
      n += await purgeEmpty(d, 6);
    } catch (e) {}
  }
  return n;
}

async function purgeEmpty(dirHandle, depth) {
  const lv = depth || 0;
  if (!dirHandle || lv > 6) return 0;
  let n = 0;
  const kill = [];
  try {
    for await (const [name, entry] of dirHandle.entries()) {
      if (entry.kind === 'directory') {
        n += await purgeEmpty(entry, lv + 1);
        continue;
      }
      if (entry.kind !== 'file') continue;
      const swap = name.match(/^(.*?)(?:\.\d+)?\.crswap$/);
      if (swap) {
        if (!_writing.has(swap[1])) kill.push(name);
        continue;
      }
      if (_writing.has(name)) continue;
      try {
        if (!(await entry.getFile()).size) kill.push(name);
      } catch (e) {}
    }
  } catch (e) {
    return n;
  }
  for (const name of kill) {
    const swap = name.match(/^(.*?)(?:\.\d+)?\.crswap$/);
    if (_writing.has(swap ? swap[1] : name)) continue;
    try {
      await dirHandle.removeEntry(name);
      n++;
    } catch (e) {}
  }
  return n;
}
async function writeUnder(dirHandle, subpath, data) {
  const parts = subpath.split('/');
  const fn = parts.pop();
  const d = await descend(dirHandle, parts, true);
  holdWrite(fn);
  try {
    const fh = await d.getFileHandle(fn, { create: true });
    const w = await fh.createWritable();
    await w.write(data);
    await w.close();
  } finally {
    releaseWrite(fn);
  }
}
async function removeUnder(dirHandle, subpath) {
  const parts = subpath.split('/');
  const fn = parts.pop();
  try {
    const d = await descend(dirHandle, parts, false);
    await d.removeEntry(fn);
    return true;
  } catch (e) {
    return false;
  }
}
async function readUnder(dirHandle, subpath) {
  const parts = subpath.split('/');
  const fn = parts.pop();
  try {
    const d = await descend(dirHandle, parts, false);
    const fh = await d.getFileHandle(fn, { create: false });
    return await fh.getFile();
  } catch (e) {
    return null;
  }
}
const STALE = new Set(['NotReadableError', 'NotFoundError', 'InvalidStateError']);
async function readBytesUnder(dirHandle, subpath) {
  const parts = subpath.split('/');
  const fn = parts.pop();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const d = await descend(dirHandle, parts, false);
      const fh = await d.getFileHandle(fn, { create: false });
      return new Uint8Array(await (await fh.getFile()).arrayBuffer());
    } catch (e) {
      if (attempt === 0 && e && STALE.has(e.name)) {
        await dropCachedPath(dirHandle, parts);
        continue;
      }
      return null;
    }
  }
  return null;
}
async function listUnder(dirHandle, subdir, { nonEmpty } = {}) {
  let d;
  try {
    d = await descend(dirHandle, subdir.split('/').filter(Boolean), false);
  } catch (e) {
    return [];
  }
  const out = [];
  for await (const [fn, e] of d.entries()) {
    if (e.kind !== 'file') continue;
    if (nonEmpty) {
      try {
        if (!(await e.getFile()).size) continue;
      } catch (e2) {
        continue;
      }
    }
    out.push(fn);
  }
  return out;
}
async function listDirsUnder(dirHandle, subdir) {
  const out = new Map();
  let d;
  try {
    d = await descend(dirHandle, subdir.split('/').filter(Boolean), false);
  } catch (e) {
    return out;
  }
  try {
    for await (const [name, entry] of d.entries()) if (entry.kind === 'directory') out.set(name, entry);
  } catch (e) {}
  return out;
}
async function listFilesIn(dirHandle) {
  const out = [];
  if (!dirHandle) return out;
  try {
    for await (const [name, entry] of dirHandle.entries()) if (entry.kind === 'file') out.push(name);
  } catch (e) {}
  return out;
}
const SIZE_CONC = 24;

async function totalSize(dirHandle, onProgress) {
  const acc = { files: 0, bytes: 0 };
  if (!dirHandle) return acc;
  const handles = [];
  let level = [dirHandle];
  for (let depth = 0; depth < 8 && level.length; depth++) {
    const next = [];
    await pool(level, SIZE_CONC, async (d) => {
      try {
        for await (const [, e] of d.entries()) {
          if (e.kind === 'directory') next.push(e);
          else if (e.kind === 'file') handles.push(e);
        }
      } catch (er) {}
    });
    level = next;
  }
  await pool(handles, SIZE_CONC, async (h) => {
    try {
      const n = (await h.getFile()).size;
      acc.bytes += n;
      acc.files++;
      if (onProgress && acc.files % 500 === 0) onProgress(acc);
    } catch (e) {}
  });
  return acc;
}

async function anyEntry(dirHandle) {
  try {
    for await (const e of dirHandle.entries()) if (e) return true;
  } catch (er) {}
  return false;
}
async function exists(dirHandle, subpath, { checkSize = true } = {}) {
  const parts = subpath.split('/');
  const fn = parts.pop();
  try {
    const d = await descend(dirHandle, parts, false);
    const fh = await d.getFileHandle(fn, { create: false });
    if (!checkSize) return true;
    return (await fh.getFile()).size > 0;
  } catch (e) {
    return false;
  }
}

async function listFolderDirs() {
  const h = await load();
  if (!h) return [];
  if ((await h.queryPermission({ mode: 'readwrite' })) !== 'granted') return [];
  const out = [];
  for (const parent of Object.values(FOLDER_PARENTS)) {
    try {
      const p = await cachedChild(h, parent);
      for await (const [dn, entry] of p.entries()) {
        if (entry.kind !== 'directory') continue;
        const key = parseFolderKey(dn);
        if (key) out.push({ folderKey: key, dirName: dn, handle: entry, parent });
      }
    } catch (e) {}
  }
  return out;
}
const ROOT_TOPS = new Set([...Object.values(DIRS), ...Object.values(FOLDER_PARENTS)]);
async function readBundleUnder(folderHandle, rel) {
  if (!rel || typeof rel !== 'string') return null;
  if (ROOT_TOPS.has(rel.split('/')[0])) {
    const root = await load();
    return root ? readBytesUnder(root, rel) : null;
  }
  return folderHandle ? readBytesUnder(folderHandle, rel) : null;
}
async function readNamedBundle(dirName, sub) {
  if (!sub) return null;
  const d = await getDir(dirName, { create: false });
  if (!d) return null;
  return readBytesUnder(d, sub);
}
async function walkBundles(dirHandle, prefix, out, depth) {
  out = out || [];
  prefix = prefix || '';
  depth = depth || 0;
  if (!dirHandle || depth > 6) return out;
  try {
    for await (const [name, entry] of dirHandle.entries()) {
      const rel = prefix ? prefix + '/' + name : name;
      if (entry.kind === 'file') {
        if (/\.bundle$/i.test(name)) out.push(rel);
      } else if (entry.kind === 'directory') await walkBundles(entry, rel, out, depth + 1);
    }
  } catch (e) {}
  return out;
}
export const fileStore = {
  supported,
  load,
  pick,
  permission,
  ensure,
  dirName,
  folderDirName,
  getFolderDir,
  removeDirUnder,
  getDir,
  saveStream,
  purgeEmpty,
  purgeEmptyIn,
  writeUnder,
  removeUnder,
  readUnder,
  readBytesUnder,
  listUnder,
  listDirsUnder,
  listFilesIn,
  anyEntry,
  totalSize,
  exists,
  listFolderDirs,
  readBundleUnder,
  readNamedBundle,
  walkBundles,
};
