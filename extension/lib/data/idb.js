'use strict';
(function () {
  const DB = 'tenkeiprdx', VER = 3, STORE = 'kv';
  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, VER);
      req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode); const store = tx.objectStore(STORE);
      let out; const r = fn(store); if (r) r.onsuccess = () => (out = r.result);
      tx.oncomplete = () => { resolve(out); db.close(); };
      tx.onerror = () => { reject(tx.error); db.close(); };
    });
  }
  globalThis.TP_IDB = {
    get: (key) => run('readonly', (s) => s.get(key)),
    set: (key, val) => run('readwrite', (s) => s.put(val, key)),
    del: (key) => run('readwrite', (s) => s.delete(key)),
  };
})();
