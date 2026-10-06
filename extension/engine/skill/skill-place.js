const CELL = 2;
const CLICK_POINT_Y = 0.5;
// NOTE: 暫定値 距離 … 対象は正面の隣のマス（1 マス）に固定。射程いっぱいに置くと画面の外に出るため（vfx-design 15.26）。
const TARGET_CELLS = 1;

export function targetReach(cells) {
  if (!Array.isArray(cells) || !cells.length) return 0;
  let cr = -1, cc = -1;
  cells.forEach((row, r) => (row || []).forEach((v, c) => { if (v === 2) { cr = r; cc = c; } }));
  if (cr < 0) { cr = (cells.length - 1) >> 1; cc = cr; }
  let line = 0, any = 0;
  cells.forEach((row, r) => (row || []).forEach((v, c) => {
    if (v !== 1) return;
    const d = Math.abs(r - cr) + Math.abs(c - cc);
    if (d > any) any = d;
    if ((r === cr || c === cc) && d > line) line = d;
  }));
  return line || any;
}

export function skillVfxPlace(slot, placement, reach) {
  const s = slot | 0;
  const z = (reach | 0) > 0 ? TARGET_CELLS * CELL : 0;
  if (s === 0 || !z) return null;
  const flags = (placement && placement.flags) || [];
  if (s !== 1) return null;
  if (flags.includes('PlaybackAtClickPoint')) return { pos: [0, CLICK_POINT_Y, z], yaw: 0 };
  // NOTE: 暫定値 向き・高さ … 対象は使用者の方を向く（yaw=π）・足元を y=0。実機は UnitBase.TryAqcuirePositionData の実行時値。
  if (flags.includes('UseAtTargetPosition')) return { pos: [0, 0, z], yaw: Math.PI };
  return null;
}
