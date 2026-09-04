const TARGET_PER_CELL = 16;
const MAX_CELLS = 1 << 20;

function collect(group, moving) {
  const meshes = [];
  const movers = [];
  let total = 0;
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const pos = o.geometry.attributes && o.geometry.attributes.position;
    if (!pos) return;
    const idx = o.geometry.index ? o.geometry.index.array : null;
    const n = idx ? Math.floor(idx.length / 3) : Math.floor(pos.count / 3);
    if (!n) return;
    const rec = { obj: o, idx, pos: pos.array, itemSize: pos.itemSize || 3, start: 0, count: n };
    if (moving && moving.has(o)) {
      movers.push(rec);
      return;
    }
    rec.start = total;
    meshes.push(rec);
    total += n;
  });
  return { meshes, movers, total };
}

export function buildGroundIndex(T, group, moving) {
  let built = false;
  let meshes = [];
  let movers = [];
  let total = 0;
  let minX = 0,
    minZ = 0,
    cell = 1,
    nx = 1,
    nz = 1;
  let cellStart = null;
  let cellItems = null;
  const v = new T.Vector3();

  const meshOf = (t) => {
    let lo = 0,
      hi = meshes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (meshes[mid].start <= t) lo = mid;
      else hi = mid - 1;
    }
    return meshes[lo];
  };

  const tri = (t, out) => {
    const m = meshOf(t);
    const k = (t - m.start) * 3;
    for (let j = 0; j < 3; j++) {
      const vi = m.idx ? m.idx[k + j] : k + j;
      const o = vi * m.itemSize;
      v.set(m.pos[o], m.pos[o + 1], m.pos[o + 2]).applyMatrix4(m.obj.matrixWorld);
      out[j * 3] = v.x;
      out[j * 3 + 1] = v.y;
      out[j * 3 + 2] = v.z;
    }
    return m;
  };

  function build() {
    built = true;
    group.updateMatrixWorld(true);
    const c = collect(group, moving);
    meshes = c.meshes;
    movers = c.movers;
    total = c.total;
    for (const m of movers) if (m.obj.geometry && !m.obj.geometry.boundingBox) m.obj.geometry.computeBoundingBox();
    if (!total) return;
    const p = new Float64Array(9);
    let x0 = Infinity,
      x1 = -Infinity,
      z0 = Infinity,
      z1 = -Infinity;
    for (let t = 0; t < total; t++) {
      tri(t, p);
      for (let j = 0; j < 3; j++) {
        const X = p[j * 3],
          Z = p[j * 3 + 2];
        if (X < x0) x0 = X;
        if (X > x1) x1 = X;
        if (Z < z0) z0 = Z;
        if (Z > z1) z1 = Z;
      }
    }
    const w = Math.max(1e-6, x1 - x0),
      h = Math.max(1e-6, z1 - z0);
    const want = Math.max(1, Math.ceil(total / TARGET_PER_CELL));
    cell = Math.max(1e-3, Math.sqrt((w * h) / want));
    nx = Math.min(4096, Math.max(1, Math.ceil(w / cell)));
    nz = Math.min(4096, Math.max(1, Math.ceil(h / cell)));
    while (nx * nz > MAX_CELLS) {
      cell *= 2;
      nx = Math.max(1, Math.ceil(w / cell));
      nz = Math.max(1, Math.ceil(h / cell));
    }
    minX = x0;
    minZ = z0;

    const cells = nx * nz;
    const counts = new Int32Array(cells + 1);
    const cx0 = new Int32Array(total),
      cx1 = new Int32Array(total),
      cz0 = new Int32Array(total),
      cz1 = new Int32Array(total);
    const clampX = (i) => (i < 0 ? 0 : i >= nx ? nx - 1 : i);
    const clampZ = (i) => (i < 0 ? 0 : i >= nz ? nz - 1 : i);
    for (let t = 0; t < total; t++) {
      tri(t, p);
      let ax = Infinity,
        bx = -Infinity,
        az = Infinity,
        bz = -Infinity;
      for (let j = 0; j < 3; j++) {
        const X = p[j * 3],
          Z = p[j * 3 + 2];
        if (X < ax) ax = X;
        if (X > bx) bx = X;
        if (Z < az) az = Z;
        if (Z > bz) bz = Z;
      }
      const i0 = clampX(Math.floor((ax - minX) / cell)),
        i1 = clampX(Math.floor((bx - minX) / cell));
      const j0 = clampZ(Math.floor((az - minZ) / cell)),
        j1 = clampZ(Math.floor((bz - minZ) / cell));
      cx0[t] = i0;
      cx1[t] = i1;
      cz0[t] = j0;
      cz1[t] = j1;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) counts[j * nx + i + 1]++;
    }
    for (let i = 0; i < cells; i++) counts[i + 1] += counts[i];
    cellStart = counts;
    cellItems = new Int32Array(counts[cells]);
    const cursor = Int32Array.from(counts.subarray(0, cells));
    for (let t = 0; t < total; t++) for (let j = cz0[t]; j <= cz1[t]; j++) for (let i = cx0[t]; i <= cx1[t]; i++) cellItems[cursor[j * nx + i]++] = t;
  }

  const p = new Float64Array(9);
  const hitY = (x, z, ceilY, floorY) => {
    const ax = p[0],
      ay = p[1],
      az = p[2];
    const bx = p[3],
      by = p[4],
      bz = p[5];
    const gx = p[6],
      gy = p[7],
      gz = p[8];
    const d = (bz - gz) * (ax - gx) + (gx - bx) * (az - gz);
    if (d === 0) return null;
    const l1 = ((bz - gz) * (x - gx) + (gx - bx) * (z - gz)) / d;
    if (l1 < 0 || l1 > 1) return null;
    const l2 = ((gz - az) * (x - gx) + (ax - gx) * (z - gz)) / d;
    if (l2 < 0 || l2 > 1) return null;
    const l3 = 1 - l1 - l2;
    if (l3 < 0 || l3 > 1) return null;
    const y = l1 * ay + l2 * by + l3 * gy;
    return y > ceilY || y < floorY ? null : y;
  };
  const box = new T.Box3();
  const movingBest = (x, z, ceilY, floorY, best) => {
    for (const m of movers) {
      if (!m.obj.visible || !m.obj.geometry.boundingBox) continue;
      box.copy(m.obj.geometry.boundingBox).applyMatrix4(m.obj.matrixWorld);
      if (x < box.min.x || x > box.max.x || z < box.min.z || z > box.max.z) continue;
      for (let t = 0; t < m.count; t++) {
        const k = t * 3;
        for (let j = 0; j < 3; j++) {
          const vi = m.idx ? m.idx[k + j] : k + j;
          const o = vi * m.itemSize;
          v.set(m.pos[o], m.pos[o + 1], m.pos[o + 2]).applyMatrix4(m.obj.matrixWorld);
          p[j * 3] = v.x;
          p[j * 3 + 1] = v.y;
          p[j * 3 + 2] = v.z;
        }
        const y = hitY(x, z, ceilY, floorY);
        if (y !== null && (best === null || y > best)) best = y;
      }
    }
    return best;
  };
  return {
    heightAt(x, z, ceilY, floorY) {
      if (!built) build();
      let best = null;
      if (total && cellItems) {
        const i = Math.floor((x - minX) / cell),
          j = Math.floor((z - minZ) / cell);
        if (i >= 0 && j >= 0 && i < nx && j < nz) {
          const c = j * nx + i;
          for (let k = cellStart[c]; k < cellStart[c + 1]; k++) {
            const t = cellItems[k];
            const m = tri(t, p);
            if (!m.obj.visible) continue;
            const y = hitY(x, z, ceilY, floorY);
            if (y !== null && (best === null || y > best)) best = y;
          }
        }
      }
      return movers.length ? movingBest(x, z, ceilY, floorY, best) : best;
    },
    stats() {
      if (!built) build();
      return { 三角形: total, セル: nx * nz, セルの大きさ: +cell.toFixed(3), 登録数: cellItems ? cellItems.length : 0 };
    },
  };
}
