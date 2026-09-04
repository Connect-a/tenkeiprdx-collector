import { SHARED_FILE } from '../core/assetpath/placement.js';
import { ensureIndexes } from './index-store.js';
import { resolveOrigin } from './origin.js';

const VIDEO_DIR = 'InGameStatics/VideoFiles';
const DDS_DIR = 'InGameStatics/Gacha/DDS';

const expand = (spec) =>
  spec.split(',').flatMap((part) => {
    const [a, b] = part.split('-');
    if (!b) return [a];
    return Array.from({ length: Number(b) - Number(a) + 1 }, (_, i) => String(Number(a) + i));
  });
const OLD_GACHA = expand('1001,1002,1004,1005,2030-2033,3020,3021,3024-3027,3029-3032,3035-3049,4011-4014,6018-6020,6025-6027,7001');

const GACHA_MISSING = {
  video: OLD_GACHA,
  banner: [],
  foreground: OLD_GACHA,
  stamp: [],
  stampTitle: [],
  ticket: ['1040028', '1040096', '1040137', '1040141', '1040158', '1040189', '1040207', '1040220', '1040228', '1040280', '1040281', '1040306', '1040328', '1040329', '104000211'],
};

const GACHA_ONLY = {
  stamp: ['1001', '1005', '2030', '2033', '13050', '13057'],
  stampTitle: ['1001', '1005', '2030', '2033', '13050', '13057'],
};

const GACHA_KINDS = [
  { key: 'video', label: '演出動画', ext: 'mp4', sub: (id) => `${VIDEO_DIR}/Gacha_${id}.mp4`, file: (id) => `Gacha_${id}.mp4` },
  { key: 'banner', label: 'バナー', ext: 'dds', sub: (id) => `${DDS_DIR}/banner_${id}.dds`, file: (id) => `banner_${id}.dds` },
  { key: 'foreground', label: '前景', ext: 'dds', sub: (id) => `${DDS_DIR}/foreground_${id}.dds`, file: (id) => `foreground_${id}.dds` },
  { key: 'stamp', label: 'スタンプ', ext: 'dds', sub: (id) => `${DDS_DIR}/stamp_${id}.dds`, file: (id) => `stamp_${id}.dds` },
  { key: 'stampTitle', label: 'スタンプ台紙', ext: 'dds', sub: (id) => `${DDS_DIR}/stampTitle_${id}.dds`, file: (id) => `stampTitle_${id}.dds` },
  { key: 'ticket', label: 'チケット', ext: 'dds', sub: (id) => `${DDS_DIR}/ticket_${id}.dds`, file: (id) => `ticket_${id}.dds` },
];

export const KIND_BY_KEY = new Map(GACHA_KINDS.map((k) => [k.key, k]));
const TICKET_ITEM_TYPE = 4;

async function gachaIds() {
  const x = await ensureIndexes();
  const ids = new Set();
  for (const rel of x.assets.gachaBgRels || []) {
    const m = String(rel).match(/bg_gacha_(\d+)_/);
    if (m) ids.add(m[1]);
  }
  for (const id of Object.keys(x.master.gachaNames || {})) ids.add(String(id));
  return [...ids].sort((a, b) => Number(a) - Number(b));
}

async function gachaTicketIds() {
  const x = await ensureIndexes();
  const out = new Map();
  for (const it of x.master.itemMaster || []) if (Number(it.itemType) === TICKET_ITEM_TYPE) out.set(String(it.id), it.name || String(it.id));
  return out;
}

async function staticsBase() {
  try {
    return (await resolveOrigin()).statics || null;
  } catch (e) {
    return null;
  }
}

const wanted = (kindKey, id) => {
  const only = GACHA_ONLY[kindKey];
  if (only) return only.includes(String(id));
  return !(GACHA_MISSING[kindKey] || []).includes(String(id));
};

export async function gachaFileList() {
  const [base, ids, tickets] = [await staticsBase(), await gachaIds(), await gachaTicketIds()];
  const out = [];
  const push = (kind, id, name) => {
    if (!wanted(kind.key, id)) return;
    const sub = kind.sub(id);
    out.push({
      kindKey: kind.key,
      kindLabel: kind.label,
      gachaId: String(id),
      key: `gacha_${kind.key}_${id}`,
      name,
      sub,
      file: kind.file(id),
      path: SHARED_FILE.statics(kind.file(id)),
      url: base ? `${base}/${sub}` : null,
    });
  };
  for (const kind of GACHA_KINDS) {
    if (kind.key === 'ticket') for (const [id, nm] of tickets) push(kind, id, nm);
    else for (const id of ids) push(kind, id, String(id));
  }
  return out;
}
