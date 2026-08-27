export const MAX_CHARS = 10;

const APP_VERSION = (() => {
  try {
    return chrome.runtime.getManifest().version;
  } catch (e) {
    return '';
  }
})();

const num = (v, def, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
};
const str = (v, def) => (typeof v === 'string' && v ? v : def);
const KINDS = ['monster', 'ex', 'other3d'];

const visMap = (raw) => {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of Object.keys(raw)) {
    if (typeof k !== 'string' || !k) continue;
    const a = Number(raw[k]);
    if (Number.isFinite(a) && a >= 0 && a < 1) out[k] = a;
  }
  return out;
};

function defaultChar(id, kind) {
  return {
    id: String(id),
    kind: KINDS.includes(kind) ? kind : 'character',
    x: 0,
    y: 0,
    z: 0,
    rotX: 0,
    rotY: 0,
    rotZ: 0,
    scale: 1,
    motion: null,
    speed: 1,
    paused: false,
    costume: '',
    mouth: null,
    face: '',
    brow: '',
    control: false,
    vis: {},
  };
}

function defaultScene(mode) {
  const m = mode === '2d' ? '2d' : '3d';
  return {
    app: APP_VERSION,
    mode: m,
    field: { kind: m === '3d' ? 'grid' : 'none', rel: '' },
    shadow: 'cast',
    camera: { yaw: 0.5, pitch: 0.28, dist: 8, panX: 0, panY: 0, tx: 0, ty: 1, tz: 0 },
    chars: [],
  };
}

function normalizeChar(raw) {
  if (!raw || !raw.id) return null;
  const c = defaultChar(raw.id, raw.kind);
  c.x = num(raw.x, 0, -50, 50);
  c.y = num(raw.y, 0, -50, 50);
  c.z = num(raw.z, 0, -50, 50);
  c.rotX = num(raw.rotX, 0, -Math.PI * 4, Math.PI * 4);
  c.rotY = num(raw.rotY, 0, -Math.PI * 4, Math.PI * 4);
  c.rotZ = num(raw.rotZ, 0, -Math.PI * 4, Math.PI * 4);
  c.scale = num(raw.scale, 1, 0.05, 8);
  c.motion = str(raw.motion, null) || str(raw.clip, null) || str(raw.anim, null);
  c.speed = num(raw.speed, 1, 0, 4);
  c.paused = !!raw.paused;
  c.costume = str(raw.costume, '');
  c.mouth = raw.mouth == null ? null : num(raw.mouth, 6, 1, 25);
  c.face = str(raw.face, '');
  c.brow = str(raw.brow, '');
  c.control = !!raw.control;
  c.vis = visMap(raw.vis);
  return c;
}

export function normalizeScene(raw, mode) {
  const base = defaultScene((raw && raw.mode) || mode);
  if (!raw || typeof raw !== 'object') return base;
  const f = raw.field || {};
  const kind = str(f.kind, base.field.kind);
  base.field = { kind, rel: str(f.rel, '') };
  base.shadow = raw.shadow === 'blob' || raw.shadow === 'none' ? raw.shadow : 'cast';
  if (!['none', 'grid', 'battlemap', 'background'].includes(kind)) base.field = { kind: 'none', rel: '' };
  const cam = raw.camera || {};
  base.camera = {
    yaw: num(cam.yaw, base.camera.yaw, -Math.PI * 4, Math.PI * 4),
    pitch: num(cam.pitch, base.camera.pitch, -1.5, 1.5),
    dist: num(cam.dist, base.camera.dist, 0.05, 2000),
    panX: num(cam.panX, 0, -5000, 5000),
    panY: num(cam.panY, 0, -5000, 5000),
    tx: num(cam.tx, 0, -5000, 5000),
    ty: num(cam.ty, 1, -5000, 5000),
    tz: num(cam.tz, 0, -5000, 5000),
  };
  const seen = new Set();
  for (const rc of Array.isArray(raw.chars) ? raw.chars : []) {
    const c = normalizeChar(rc);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    base.chars.push(c);
    if (base.chars.length >= MAX_CHARS) break;
  }
  return base;
}

export function createViewerState(mode) {
  let scene = defaultScene(mode);
  const find = (id) => scene.chars.find((c) => c.id === String(id)) || null;
  return {
    get scene() {
      return scene;
    },
    get mode() {
      return scene.mode;
    },
    ids: () => scene.chars.map((c) => c.id),
    has: (id) => !!find(id),
    get: find,
    full: () => scene.chars.length >= MAX_CHARS,
    add(id, kind) {
      if (find(id) || scene.chars.length >= MAX_CHARS) return null;
      const c = defaultChar(id, kind);
      const n = scene.chars.length;
      c.x = n ? (n % 2 ? 1 : -1) * Math.ceil(n / 2) * 1.2 : 0;
      scene.chars.push(c);
      return c;
    },
    remove(id) {
      const i = scene.chars.findIndex((c) => c.id === String(id));
      if (i < 0) return false;
      scene.chars.splice(i, 1);
      return true;
    },
    clear() {
      scene.chars = [];
    },
    update(id, patch) {
      const c = find(id);
      if (!c) return null;
      Object.assign(c, patch);
      return c;
    },
    setField(kind, rel) {
      scene.field = { kind, rel: rel || '' };
    },
    setShadow(kind) {
      scene.shadow = kind === 'blob' || kind === 'none' ? kind : 'cast';
    },
    toJSON: () => JSON.parse(JSON.stringify(scene)),
    load(raw) {
      scene = normalizeScene(raw, (raw && raw.mode) || scene.mode);
      return scene;
    },
  };
}
