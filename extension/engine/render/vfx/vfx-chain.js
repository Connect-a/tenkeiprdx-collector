import * as THREE from '../../../vendor/three.module.js';
import { noteBuildFailure } from './vfx-failures.js';

const _q = new THREE.Quaternion();
const _qc = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0);
function placeCamera(c, pl) {
  if (!c || !pl) return c;
  _q.setFromAxisAngle(_Y, pl.yaw || 0);
  const [tx, ty, tz] = pl.pos;
  const mv = (p) => (p ? (_v.set(p.x, p.y, p.z).applyQuaternion(_q), { x: _v.x + tx, y: _v.y + ty, z: _v.z + tz }) : p);
  const rt = (r) => (r ? (_qc.set(r.x || 0, r.y || 0, r.z || 0, r.w == null ? 1 : r.w).premultiply(_q), { x: _qc.x, y: _qc.y, z: _qc.z, w: _qc.w }) : r);
  return { ...c, pos: mv(c.pos), rot: rt(c.rot), lookAt: mv(c.lookAt), lookAtRot: rt(c.lookAtRot) };
}

export function createLayerChain(io) {
  let layers = [];
  let head = null;

  const dropAll = () => {
    for (const L of layers) {
      try {
        if (L.mounted) io.unmount(L.fx.group);
        L.fx.dispose();
      } catch (e) {}
    }
    layers = [];
    head = null;
  };

  const effectStartMs = (main, k) => {
    if (!main) return null;
    const cues = main.fx.effectCues || [];
    let one = 0;
    for (const c of cues) {
      if (c.kind === 'all') return main.startMs + Math.round(c.t * 1000);
      if (one++ === k) return main.startMs + Math.round(c.t * 1000);
    }
    return main.startMs + main.durMs;
  };

  const build = (links, loop) => {
    layers = [];
    let at = 0;
    let main = null;
    let effectIndex = 0;
    for (const lk of links) {
      let f = null;
      try {
        f = io.makeFx(lk.bytes, { texByMatPid: lk.texByMatPid, loop: loop && links.length === 1 });
      } catch (e) {
        noteBuildFailure('chainLink', e);
      }
      if (!f) continue;
      let place = null;
      try {
        place = io.placeOf ? io.placeOf(lk, f) : null;
      } catch (e) {
        noteBuildFailure('placement', e);
      }
      if (place && f.group) {
        f.group.position.set(place.pos[0], place.pos[1], place.pos[2]);
        f.group.rotation.set(0, place.yaw || 0, 0);
      }
      const durS = Math.max(0, Number(f.duration) || 0);
      const handoffS = f.chainAt != null ? Math.max(0, Math.min(f.chainAt, durS || f.chainAt)) : durS;
      const durMs = Math.round(durS * 1000);
      if (lk.role === 'effect' && main) {
        layers.push({ fx: f, startMs: effectStartMs(main, effectIndex++), durMs, mounted: false, done: false, place });
        continue;
      }
      const L = { fx: f, startMs: at, durMs, mounted: false, done: false, place };
      layers.push(L);
      main = L;
      effectIndex = 0;
      at += Math.round(handoffS * 1000);
    }
    head = layers.length ? layers[0].fx : null;
    if (head) {
      layers[0].mounted = true;
      io.mount(head.group);
    }
    return head;
  };

  const rebuild = (links, loop) => {
    dropAll();
    return build(links, loop);
  };

  const lead = () => {
    for (let i = layers.length - 1; i >= 0; i--) {
      const L = layers[i];
      if (L.mounted && !L.done && L.fx.cameras && L.fx.cameras.length) return L;
    }
    for (let i = layers.length - 1; i >= 0; i--) if (layers[i].mounted && !layers[i].done) return layers[i];
    return layers.length ? layers[0] : null;
  };

  return {
    get layers() {
      return layers;
    },
    get fx() {
      return head;
    },
    get count() {
      return layers.length;
    },
    build,
    rebuild,
    dropAll,
    lead,
    leadCam() {
      const L = lead();
      return L && L.fx.activeCamera ? placeCamera(L.fx.activeCamera(), L.place) : null;
    },
    totalMs() {
      return layers.reduce((mx, L) => Math.max(mx, L.startMs + L.durMs), 0);
    },
    updateMatrices() {
      for (const L of layers) if (L.mounted && !L.done) L.fx.group.updateMatrixWorld(true);
    },
    step(simMs, dtSec) {
      for (const L of layers) {
        if (L.done) continue;
        if (!L.mounted) {
          if (simMs < L.startMs) continue;
          L.mounted = true;
          io.mount(L.fx.group);
          L.fx.group.updateMatrixWorld(true);
        }
        L.fx.update(dtSec);
        if (L.durMs > 0 && simMs - L.startMs >= L.durMs) {
          L.done = true;
          try {
            io.unmount(L.fx.group);
            L.fx.dispose();
          } catch (e) {}
        }
      }
    },
    liveCount() {
      let live = 0;
      for (const L of layers) if (L.mounted && !L.done) live += L.fx.liveCount ? L.fx.liveCount() : 1;
      if (layers.some((L) => !L.mounted)) live++;
      return live;
    },
    starts() {
      return layers.map((L) => L.startMs / 1000);
    },
    events(key) {
      const out = [];
      layers.forEach((L, i) => {
        const off = L.startMs / 1000;
        for (const e of L.fx[key] || []) out.push({ ...e, t: e.t + off, link: i });
      });
      out.sort((a, b) => a.t - b.t);
      return out;
    },
  };
}
