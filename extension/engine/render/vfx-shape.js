const D2R = Math.PI / 180;

export function createShapeSampler(T, shapeMod) {
  const sh = shapeMod || {};
  const on = !!sh.enabled;
  const rotE = sh.m_Rotation || { x: 0, y: 0, z: 0 };
  const scale = sh.m_Scale || { x: 1, y: 1, z: 1 };
  const pos = sh.m_Position || { x: 0, y: 0, z: 0 };
  const rotMat = new T.Matrix4().makeRotationFromEuler(new T.Euler(rotE.x * D2R, rotE.y * D2R, rotE.z * D2R, 'ZXY'));
  const posV = new T.Vector3(pos.x || 0, pos.y || 0, pos.z || 0);
  const type = sh.type | 0;
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
      o[4] = u;
      o[5] = rr * Math.sin(th);
      o[0] = r * o[3];
      o[1] = r * o[4];
      o[2] = r * o[5];
    } else if (type === 10 || type === 11) {
      const a = Math.random() * arc,
        r = sampleR();
      o[3] = Math.cos(a);
      o[4] = 0;
      o[5] = Math.sin(a);
      o[0] = r * o[3];
      o[1] = 0;
      o[2] = r * o[5];
    } else if (type === 12) {
      o[0] = (Math.random() * 2 - 1) * radius;
      o[1] = 0;
      o[2] = 0;
      o[3] = 0;
      o[4] = 1;
      o[5] = 0;
    } else if (type === 17) {
      const a = Math.random() * arc,
        phi = Math.random() * Math.PI * 2,
        rr = donut * Math.sqrt(Math.random());
      const cx = Math.cos(a),
        cz = Math.sin(a),
        cp = Math.cos(phi);
      o[0] = (radius + rr * cp) * cx;
      o[1] = rr * Math.sin(phi);
      o[2] = (radius + rr * cp) * cz;
      o[3] = cx * cp;
      o[4] = Math.sin(phi);
      o[5] = cz * cp;
    } else {
      const a = Math.random() * arc,
        r = sampleR(),
        sa = Math.sin(coneAng),
        ca = Math.cos(coneAng);
      const cx = Math.cos(a),
        cz = Math.sin(a);
      o[0] = r * cx;
      o[1] = 0;
      o[2] = r * cz;
      o[3] = cx * sa;
      o[4] = ca;
      o[5] = cz * sa;
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
      posOut
        .set(buf[0] * scale.x, buf[1] * scale.y, buf[2] * scale.z)
        .applyMatrix4(rotMat)
        .add(posV);
      dirOut.set(buf[3], buf[4], buf[5]).applyMatrix4(rotMat);
    },
  };
}
