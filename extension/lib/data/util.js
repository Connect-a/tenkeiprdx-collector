'use strict';
// TP_UTIL — data層で重複していた小ヘルパの単一実装。各ファイルはload時にここへaliasする。
// (各エントリHTMLでdecode.jsより前に読み込むこと。decodeUserBytesはTP_DECODEに呼出時委譲。)
(function () {
  const bytesToB64 = (buf) => { let bin = ''; const CHUNK = 0x8000; for (let i = 0; i < buf.length; i += CHUNK) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK)); return btoa(bin); };
  const b64ToBytes = (b64) => { const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const latin1 = new TextDecoder('iso-8859-1');
  const num = (x) => (typeof x === 'bigint' ? Number(x) : x);
  const decodeUserBytes = (bytes) => globalThis.TP_DECODE.decodeCSharpLz4(bytes, { multiRoot: true, extTag: false });
  globalThis.TP_UTIL = { bytesToB64, b64ToBytes, sleep, latin1, num, decodeUserBytes };
})();
