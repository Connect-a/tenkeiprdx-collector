const CAM_FIELDS = ['panX', 'panY', 'zoom', 'camX', 'camY', 'camZ'];
const neutralCam = () => ({ panX: 0, panY: 0, zoom: 1, camX: 0, camY: 0, camZ: 0 });
const lerp = (a, b, k) => a + (b - a) * k;

export function createStageCamera(deps) {
  const { planeZ, worldPerSkel, fovDeg, refSize } = deps;
  const fovTan = Math.tan((fovDeg * Math.PI) / 360);
  let cur = neutralCam();
  let from = neutralCam();
  let to = neutralCam();
  let t = 0;
  let dur = 0;
  let lastKey = '';
  let userZoom = 1;
  let userPanX = 0;
  let userPanY = 0;

  const fromTriple = (tr) => {
    if (!tr) return neutralCam();
    const X = Number(tr[0]) || 0,
      Y = Number(tr[1]) || 0,
      Z = Number(tr[2]) || 0;
    const ref = refSize();
    return { panX: X / ref.w, panY: Y / ref.h, zoom: planeZ / Math.max(1, planeZ - Z), camX: X, camY: Y, camZ: Z };
  };

  return {
    fromTriple,
    set(cam) {
      if (!cam) {
        if (lastKey === 'none') return;
        lastKey = 'none';
        from = neutralCam();
        to = neutralCam();
        cur = { ...to };
        t = 0;
        dur = 0;
        return;
      }
      const key = JSON.stringify({ s: cam.s || null, e: cam.e || null, dur: cam.dur || 0 });
      if (lastKey === key) return;
      lastKey = key;
      const d = (Number(cam.dur) || 0) / 1000;
      to = fromTriple(cam.e);
      if (d > 0 && cam.s) {
        from = fromTriple(cam.s);
        cur = { ...from };
        t = 0;
        dur = d;
      } else {
        from = { ...to };
        cur = { ...to };
        t = 0;
        dur = 0;
      }
    },
    snapNeutral() {
      cur = neutralCam();
      from = neutralCam();
      to = neutralCam();
      dur = 0;
      t = 0;
      lastKey = '';
    },
    step(delta) {
      if (dur > 0) {
        t += delta;
        const k = Math.min(1, t / dur);
        for (const f of CAM_FIELDS) cur[f] = lerp(from[f], to[f], k);
        if (k >= 1) dur = 0;
      } else {
        cur = { ...to };
      }
    },
    setUserZoom(v) {
      userZoom = v > 0 ? v : 1;
    },
    setUserPan(x, y) {
      userPanX = x || 0;
      userPanY = y || 0;
    },
    frame(W, H, bounds) {
      const uz = userZoom > 0 ? userZoom : 1;
      if (bounds) {
        const D = Math.max(1, planeZ - (cur.camZ || 0));
        const vh = (2 * D * fovTan) / worldPerSkel / uz;
        const vw = vh * (W / H);
        return {
          x: bounds.x + bounds.w / 2 + (cur.camX || 0) / worldPerSkel - userPanX * (vw / W),
          y: bounds.y + bounds.h / 2 + (cur.camY || 0) / worldPerSkel + userPanY * (vh / H),
          vw,
          vh,
        };
      }
      const z = (cur.zoom || 1) * uz;
      const vw = W / z,
        vh = H / z;
      return {
        x: W * (0.5 + cur.panX) - userPanX * (vw / W),
        y: H * (0.5 + cur.panY) + userPanY * (vh / H),
        vw,
        vh,
      };
    },
    state(mode) {
      return { panX: cur.panX || 0, panY: cur.panY || 0, zoom: cur.zoom || 1, mode };
    },
  };
}
