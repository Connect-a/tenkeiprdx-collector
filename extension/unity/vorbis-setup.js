let _table;

async function loadSetupTable() {
  if (_table !== undefined) return _table;
  try {
    const m = await import('./vorbis-setup-table.js');
    _table = m.VORBIS_SETUP_TABLE || null;
  } catch (e) {
    _table = null;
  }
  return _table;
}

export async function setupFor(crc32) {
  const t = await loadSetupTable();
  if (!t) return null;
  const i = t.map['0x' + (Number(crc32) >>> 0).toString(16).padStart(8, '0')];
  if (i == null) return null;
  const s = atob(t.setups[i]);
  const out = new Uint8Array(s.length);
  for (let k = 0; k < s.length; k++) out[k] = s.charCodeAt(k);
  return out;
}

export const vorbisSetup = { loadSetupTable, setupFor };
