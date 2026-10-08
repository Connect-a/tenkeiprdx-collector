export const UNITY_BUILTIN_MESH = { 10210: 'quad', 10209: 'plane', 10207: 'sphere', 10202: 'cube', 10206: 'cylinder', 10208: 'capsule' };
const meshOut = (name, pos, nrm, uv, idx) => ({ name, positions: new Float32Array(pos), normals: new Float32Array(nrm), uv: new Float32Array(uv), indices: idx.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx) });
function uvSphereGeo(name, radius, seg, rings, yTop, yBottom) {
  const pos = [],
    nrm = [],
    uv = [],
    idx = [];
  for (let y = 0; y <= rings; y++) {
    const v = y / rings,
      phi = v * Math.PI;
    const off = phi <= Math.PI / 2 ? yTop : yBottom;
    for (let x = 0; x <= seg; x++) {
      const u = x / seg,
        th = u * Math.PI * 2;
      const nx = -Math.sin(phi) * Math.cos(th),
        ny = Math.cos(phi),
        nz = Math.sin(phi) * Math.sin(th);
      pos.push(nx * radius, ny * radius + off, nz * radius);
      nrm.push(nx, ny, nz);
      uv.push(u, 1 - v);
    }
  }
  for (let y = 0; y < rings; y++)
    for (let x = 0; x < seg; x++) {
      const a = y * (seg + 1) + x,
        b = a + 1,
        c = a + seg + 1,
        d = c + 1;
      if (y !== 0) idx.push(a, c, b);
      if (y !== rings - 1) idx.push(b, c, d);
    }
  return meshOut(name, pos, nrm, uv, idx);
}
function tubeGeo(name, radius, halfHeight, seg, caps) {
  const pos = [],
    nrm = [],
    uv = [],
    idx = [];
  for (let ring = 0; ring < 2; ring++) {
    const y = ring === 0 ? halfHeight : -halfHeight;
    for (let x = 0; x <= seg; x++) {
      const u = x / seg,
        th = u * Math.PI * 2;
      const nx = Math.sin(th),
        nz = Math.cos(th);
      pos.push(nx * radius, y, nz * radius);
      nrm.push(nx, 0, nz);
      uv.push(u, ring === 0 ? 1 : 0);
    }
  }
  for (let x = 0; x < seg; x++) {
    const a = x,
      b = x + 1,
      c = seg + 1 + x,
      d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  if (caps)
    for (let ring = 0; ring < 2; ring++) {
      const y = ring === 0 ? halfHeight : -halfHeight;
      const center = pos.length / 3;
      pos.push(0, y, 0);
      nrm.push(0, ring === 0 ? 1 : -1, 0);
      uv.push(0.5, 0.5);
      const start = pos.length / 3;
      for (let x = 0; x <= seg; x++) {
        const th = (x / seg) * Math.PI * 2;
        const nx = Math.sin(th),
          nz = Math.cos(th);
        pos.push(nx * radius, y, nz * radius);
        nrm.push(0, ring === 0 ? 1 : -1, 0);
        uv.push(0.5 + nx * 0.5, 0.5 + nz * 0.5);
      }
      for (let x = 0; x < seg; x++) {
        const a = start + x,
          b = start + x + 1;
        if (ring === 0) idx.push(center, a, b);
        else idx.push(center, b, a);
      }
    }
  return meshOut(name, pos, nrm, uv, idx);
}
function mergeGeo(name, parts) {
  const pos = [],
    nrm = [],
    uv = [],
    idx = [];
  for (const g of parts) {
    if (!g) continue;
    const base = pos.length / 3;
    for (let i = 0; i < g.positions.length; i++) pos.push(g.positions[i]);
    for (let i = 0; i < g.normals.length; i++) nrm.push(g.normals[i]);
    for (let i = 0; i < g.uv.length; i++) uv.push(g.uv[i]);
    for (let i = 0; i < g.indices.length; i++) idx.push(g.indices[i] + base);
  }
  return meshOut(name, pos, nrm, uv, idx);
}
export function builtinMeshGeo(kind) {
  if (kind === 'quad')
    return meshOut(
      'builtin_quad',
      [-0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0],
      [0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1],
      [0, 0, 1, 1, 1, 0, 0, 1],
      [0, 1, 2, 1, 0, 3]
    );
  if (kind === 'plane')
    return meshOut(
      'builtin_plane',
      [-5, 0, -5, 5, 0, -5, -5, 0, 5, 5, 0, 5],
      [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
      [0, 0, 1, 0, 0, 1, 1, 1],
      [0, 2, 1, 2, 3, 1]
    );
  if (kind === 'sphere') return uvSphereGeo('builtin_sphere', 0.5, 24, 16, 0, 0);
  if (kind === 'capsule') return mergeGeo('builtin_capsule', [uvSphereGeo('caps', 0.5, 24, 16, 0.5, -0.5), tubeGeo('side', 0.5, 0.5, 24, false)]);
  if (kind === 'cylinder') return tubeGeo('builtin_cylinder', 0.5, 1, 20, true);
  if (kind === 'cube') {
    const faces = [
      [
        [0, 0, 1],
        [-0.5, -0.5, 0.5],
        [0.5, -0.5, 0.5],
        [0.5, 0.5, 0.5],
        [-0.5, 0.5, 0.5],
      ],
      [
        [0, 0, -1],
        [0.5, -0.5, -0.5],
        [-0.5, -0.5, -0.5],
        [-0.5, 0.5, -0.5],
        [0.5, 0.5, -0.5],
      ],
      [
        [0, 1, 0],
        [-0.5, 0.5, 0.5],
        [0.5, 0.5, 0.5],
        [0.5, 0.5, -0.5],
        [-0.5, 0.5, -0.5],
      ],
      [
        [0, -1, 0],
        [-0.5, -0.5, -0.5],
        [0.5, -0.5, -0.5],
        [0.5, -0.5, 0.5],
        [-0.5, -0.5, 0.5],
      ],
      [
        [1, 0, 0],
        [0.5, -0.5, 0.5],
        [0.5, -0.5, -0.5],
        [0.5, 0.5, -0.5],
        [0.5, 0.5, 0.5],
      ],
      [
        [-1, 0, 0],
        [-0.5, -0.5, -0.5],
        [-0.5, -0.5, 0.5],
        [-0.5, 0.5, 0.5],
        [-0.5, 0.5, -0.5],
      ],
    ];
    const pos = [],
      nrm = [],
      uv = [],
      idx = [];
    for (const f of faces) {
      const base = pos.length / 3;
      for (let i = 1; i <= 4; i++) {
        pos.push(f[i][0], f[i][1], f[i][2]);
        nrm.push(f[0][0], f[0][1], f[0][2]);
      }
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return meshOut('builtin_cube', pos, nrm, uv, idx);
  }
  return null;
}
