const D2R = Math.PI / 180;

function meshPivotOffset(positions, pivot) {
  const px = (pivot && pivot.x) || 0,
    py = (pivot && pivot.y) || 0,
    pz = (pivot && pivot.z) || 0;
  if ((!px && !py && !pz) || !positions || !positions.length) return null;
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < positions.length; i += 3)
    for (let c = 0; c < 3; c++) {
      const v = positions[i + c];
      if (v < mn[c]) mn[c] = v;
      if (v > mx[c]) mx[c] = v;
    }
  const ex = mx[0] - mn[0] || 0,
    ey = mx[1] - mn[1] || 0,
    ez = mx[2] - mn[2] || 0;
  const ox = px * ex,
    oy = py * ey,
    oz = -pz * ez;
  return ox || oy || oz ? [ox, oy, oz] : null;
}

export function meshPositionsWithPivot(positions, pivot) {
  const o = meshPivotOffset(positions, pivot);
  if (!o) return positions;
  const out = new Float32Array(positions);
  for (let i = 0; i + 2 < out.length; i += 3) {
    out[i] += o[0];
    out[i + 1] += o[1];
    out[i + 2] += o[2];
  }
  return out;
}

export function sampleMeshShape(mesh, mode, o) {
  const P = mesh.positions,
    N = mesh.normals,
    I = mesh.indices,
    C = mesh.colors,
    UV = mesh.uv;
  const nIdx = I ? I.length : (P.length / 3) | 0;
  const gi = (k) => (I ? I[k] : k);
  const put = (a, b, c, w, u, v) => {
    if (C) {
      for (let k = 0; k < 4; k++) o[6 + k] = C[a * 4 + k] * w + C[b * 4 + k] * u + C[c * 4 + k] * v;
    } else {
      o[6] = o[7] = o[8] = o[9] = 1;
    }
    if (UV) {
      o[10] = UV[a * 2] * w + UV[b * 2] * u + UV[c * 2] * v;
      o[11] = UV[a * 2 + 1] * w + UV[b * 2 + 1] * u + UV[c * 2 + 1] * v;
    } else {
      o[10] = o[11] = 0;
    }
    o[0] = P[a * 3] * w + P[b * 3] * u + P[c * 3] * v;
    o[1] = P[a * 3 + 1] * w + P[b * 3 + 1] * u + P[c * 3 + 1] * v;
    o[2] = P[a * 3 + 2] * w + P[b * 3 + 2] * u + P[c * 3 + 2] * v;
    if (!N) {
      o[3] = 0;
      o[4] = 1;
      o[5] = 0;
      return;
    }
    const nx = N[a * 3] * w + N[b * 3] * u + N[c * 3] * v,
      ny = N[a * 3 + 1] * w + N[b * 3 + 1] * u + N[c * 3 + 1] * v,
      nz = N[a * 3 + 2] * w + N[b * 3 + 2] * u + N[c * 3 + 2] * v;
    const l = Math.hypot(nx, ny, nz) || 1;
    o[3] = nx / l;
    o[4] = ny / l;
    o[5] = nz / l;
  };
  if ((mode | 0) === 0) {
    const nV = (P.length / 3) | 0;
    const a = Math.min(nV - 1, (Math.random() * nV) | 0);
    put(a, a, a, 1, 0, 0);
    return;
  }
  const nTri = (nIdx / 3) | 0;
  if (nTri < 1) {
    put(0, 0, 0, 1, 0, 0);
    return;
  }
  const tri = Math.min(nTri - 1, (Math.random() * nTri) | 0);
  const v0 = gi(tri * 3),
    v1 = gi(tri * 3 + 1),
    v2 = gi(tri * 3 + 2);
  if ((mode | 0) === 1) {
    const e = Math.min(2, (Math.random() * 3) | 0);
    const a = e === 0 ? v0 : e === 1 ? v1 : v2;
    const b = e === 0 ? v1 : e === 1 ? v2 : v0;
    const t = Math.random();
    put(a, b, b, 1 - t, t, 0);
    return;
  }
  let u = Math.random(),
    v = Math.random();
  if (u + v > 1) {
    u = 1 - u;
    v = 1 - v;
  }
  put(v0, v1, v2, 1 - u - v, u, v);
}

export function createShapeSampler(T, shapeMod, ctx) {
  const sh = shapeMod || {};
  const mesh = (ctx && ctx.shapeMesh) || null;
  const randomPos = Number(sh.randomPositionAmount || 0);
  const randomDir = Number(sh.randomDirectionAmount || 0);
  const sphericalDir = Number(sh.sphericalDirectionAmount || 0);
  const on = !!sh.enabled;
  const rotE = sh.m_Rotation || { x: 0, y: 0, z: 0 };
  const scale = sh.m_Scale || { x: 1, y: 1, z: 1 };
  const pos = sh.m_Position || { x: 0, y: 0, z: 0 };
  const rotMat = new T.Matrix4().makeRotationFromEuler(new T.Euler(rotE.x * D2R, rotE.y * D2R, rotE.z * D2R, 'ZXY'));
  const posV = new T.Vector3(pos.x || 0, pos.y || 0, pos.z || 0);
  const type = sh.type | 0;
  const placement = sh.placementMode | 0;
  const radius = (sh.radius && sh.radius.value) || 0;
  const thick = sh.radiusThickness != null ? sh.radiusThickness : 1;
  const arc = ((sh.arc && sh.arc.value) || 360) * D2R;
  const coneAng = (sh.angle || 0) * D2R;
  const len = sh.length || 0;
  const donut = sh.donutRadius || 0;
  const buf = [0, 0, 0, 0, 0, 0];

  const sampleR = () => {
    const inner = radius * (1 - thick);
    return Math.sqrt(inner * inner + (radius * radius - inner * inner) * Math.random());
  };

  const raw = (o) => {
    if (!on) {
      o[0] = o[1] = o[2] = 0;
      const u = Math.random() * 2 - 1,
        th = Math.random() * Math.PI * 2,
        rr = Math.sqrt(1 - u * u);
      o[3] = rr * Math.cos(th);
      o[4] = u;
      o[5] = rr * Math.sin(th);
      return;
    }
    if (type === 0 || type === 1) {
      const u = Math.random() * 2 - 1,
        th = Math.random() * Math.PI * 2,
        rr = Math.sqrt(1 - u * u),
        r = sampleR();
      o[3] = rr * Math.cos(th);
      o[4] = u;
      o[5] = rr * Math.sin(th);
      o[0] = r * o[3];
      o[1] = r * o[4];
      o[2] = r * o[5];
    } else if (type === 2 || type === 3) {
      const u = Math.random(),
        th = Math.random() * Math.PI * 2,
        rr = Math.sqrt(1 - u * u),
        r = sampleR();
      o[3] = rr * Math.cos(th);
      o[4] = rr * Math.sin(th);
      o[5] = u;
      o[0] = r * o[3];
      o[1] = r * o[4];
      o[2] = r * o[5];
    } else if (type === 10 || type === 11) {
      const a = Math.random() * arc,
        r = sampleR();
      o[3] = Math.cos(a);
      o[4] = Math.sin(a);
      o[5] = 0;
      o[0] = r * o[3];
      o[1] = r * o[4];
      o[2] = 0;
    } else if (type === 12) {
      o[0] = (Math.random() * 2 - 1) * radius;
      o[1] = 0;
      o[2] = 0;
      o[3] = 0;
      o[4] = 1;
      o[5] = 0;
    } else if (type === 5 || type === 15 || type === 16) {
      let x = Math.random() - 0.5,
        y = Math.random() - 0.5,
        z = Math.random() - 0.5;
      if (type === 15 || type === 16) {
        const face = (Math.random() * 3) | 0;
        const side = Math.random() < 0.5 ? -0.5 : 0.5;
        if (face === 0) x = side;
        else if (face === 1) y = side;
        else z = side;
        if (type === 16) {
          const other = (Math.random() * 2) | 0;
          const s2 = Math.random() < 0.5 ? -0.5 : 0.5;
          if (face === 0) other === 0 ? (y = s2) : (z = s2);
          else if (face === 1) other === 0 ? (x = s2) : (z = s2);
          else other === 0 ? (x = s2) : (y = s2);
        }
      }
      o[0] = x;
      o[1] = y;
      o[2] = z;
      o[3] = 0;
      o[4] = 0;
      o[5] = 1;
    } else if (type === 18 || type === 19 || type === 20) {
      o[0] = Math.random() - 0.5;
      o[1] = Math.random() - 0.5;
      o[2] = 0;
      o[3] = 0;
      o[4] = 0;
      o[5] = 1;
    } else if ((type === 6 || type === 13 || type === 14) && mesh && mesh.positions && mesh.positions.length) {
      sampleMeshShape(mesh, placement, o);
    } else if (type === 17) {
      const a = Math.random() * arc,
        phi = Math.random() * Math.PI * 2,
        rr = donut * Math.sqrt(Math.random());
      const cx = Math.cos(a),
        cy = Math.sin(a),
        cp = Math.cos(phi);
      o[0] = (radius + rr * cp) * cx;
      o[1] = (radius + rr * cp) * cy;
      o[2] = rr * Math.sin(phi);
      o[3] = cx * cp;
      o[4] = cy * cp;
      o[5] = Math.sin(phi);
    } else {
      const a = Math.random() * arc,
        r = sampleR(),
        sa = Math.sin(coneAng),
        ca = Math.cos(coneAng);
      const cx = Math.cos(a),
        cy = Math.sin(a);
      o[0] = r * cx;
      o[1] = r * cy;
      o[2] = 0;
      o[3] = cx * sa;
      o[4] = cy * sa;
      o[5] = ca;
      if ((type === 8 || type === 9) && len > 0) {
        const tt = Math.random() * len;
        o[0] += o[3] * tt;
        o[1] += o[4] * tt;
        o[2] += o[5] * tt;
      }
    }
  };

  return {
    sample(posOut, dirOut) {
      raw(buf);
      if (sphericalDir > 0) {
        const pl = Math.hypot(buf[0], buf[1], buf[2]);
        if (pl > 1e-6) for (let i = 0; i < 3; i++) buf[3 + i] += (buf[i] / pl - buf[3 + i]) * sphericalDir;
      }
      if (randomDir > 0) {
        let rx = Math.random() * 2 - 1,
          ry = Math.random() * 2 - 1,
          rz = Math.random() * 2 - 1;
        const rl = Math.hypot(rx, ry, rz) || 1;
        rx /= rl;
        ry /= rl;
        rz /= rl;
        buf[3] += (rx - buf[3]) * randomDir;
        buf[4] += (ry - buf[4]) * randomDir;
        buf[5] += (rz - buf[5]) * randomDir;
      }
      if (sphericalDir > 0 || randomDir > 0) {
        const dl = Math.hypot(buf[3], buf[4], buf[5]);
        if (dl > 1e-6) {
          buf[3] /= dl;
          buf[4] /= dl;
          buf[5] /= dl;
        }
      }
      if (randomPos > 0) for (let i = 0; i < 3; i++) buf[i] += (Math.random() * 2 - 1) * randomPos;
      posOut
        .set(buf[0] * scale.x, buf[1] * scale.y, buf[2] * scale.z)
        .applyMatrix4(rotMat)
        .add(posV);
      dirOut.set(buf[3], buf[4], buf[5]).applyMatrix4(rotMat);
    },
  };
}
