const RULES = [
  [/skirt|tasset|hem_|obi(front|back|side)|chihaya|dress|petticoat/i, 'スカート/裾'],
  [/underwear/i, '下着'],
  [/hairacc|hairribbon|hairribon|haircap|hair_bando|sidecap|headdress|ribon_cap|^cap|hat|feather|butterfly|flower|^t_ear/i, '髪飾り'],
  [/hair|hiar|bangs|momiage|pony/i, '髪'],
  [/facial|face|eyelash|eyebrow|brow|eye|mouth|^ear_|^head/i, '頭'],
  [/ribbon|ribon|bowknot|bowtie|^bow|belt|pendant|earring|collar|access|_acc|acc_|ornament|rhombus|stone|neck_|bag|lace/i, 'リボン/装飾'],
  [/mant|shawl|cape|veil|cloth|skarf|scarf|cord/i, '衣装/布'],
  [/sode|sleeve|cuff/i, '袖'],
  [/shoulder|upperarm|forearm|hand|thumb|index|middle|^ring_|pinky|wrist|arm/i, '腕/手'],
  [/upperleg|foreleg|foot|toe|leg/i, '脚/足'],
  [/breast|bust|chest/i, '胸'],
  [/tail|wing/i, '尻尾/翼'],
  [/^bodycenter|^spine|^hip|^neck/i, '胴'],
  [/weapon|attachment|^ap_|^dp_|^ep_|^wp_|^ct_|^ik/i, '武器/装備'],
];

export const GROUP_ORDER = ['髪', '髪飾り', '頭', '胴', '胸', '腕/手', '袖', '脚/足', 'スカート/裾', '下着', '衣装/布', 'リボン/装飾', '尻尾/翼', '武器/装備', 'その他'];

export function boneGroup(name) {
  const s = String(name || '');
  for (const [re, g] of RULES) if (re.test(s)) return g;
  return 'その他';
}

const dominantTriBones = (um, nameIdOf) => {
  const idx = um.indices;
  const si = um.skinIndex;
  const sw = um.skinWeight;
  const per = si.length / (um.vertexCount || um.positions.length / 3);
  const triCount = idx.length / 3;
  const out = new Uint16Array(triCount);
  const acc = new Map();
  for (let t = 0; t < triCount; t++) {
    acc.clear();
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k];
      for (let j = 0; j < per; j++) {
        const w = sw[v * per + j];
        if (!(w > 0)) continue;
        const nid = nameIdOf(si[v * per + j]);
        acc.set(nid, (acc.get(nid) || 0) + w);
      }
    }
    let best = 0;
    let bw = -1;
    for (const [nid, w] of acc)
      if (w > bw) {
        bw = w;
        best = nid;
      }
    out[t] = best;
  }
  return out;
};

export function createPartControl(T, targets) {
  const names = [];
  const nameIds = new Map();
  const idOf = (n) => {
    let i = nameIds.get(n);
    if (i == null) {
      i = names.length;
      names.push(n);
      nameIds.set(n, i);
    }
    return i;
  };
  const entries = [];
  for (const t of targets) {
    const um = t.unityMesh;
    if (!um || !um.indices || !um.skinIndex || !um.skinWeight || !um.boneNameHashes) continue;
    const boneIds = Array.from(um.boneNameHashes, (h) => idOf(t.boneName(h)));
    const triBone = dominantTriBones(um, (b) => (boneIds[b] != null ? boneIds[b] : 0));
    const subs = um.submeshes && um.submeshes.length ? um.submeshes : [{ indexStart: 0, indexCount: um.indices.length }];
    entries.push({ obj: t.obj, outline: t.outline, indices: um.indices, triBone, subs, baseMats: t.mats, outlineMat: t.outline ? t.outline.material : null });
  }
  const used = new Set();
  for (const e of entries) for (const b of e.triBone) used.add(b);

  const alpha = new Map();
  const clones = new Map();
  const variant = (mat, a) => {
    if (a >= 1) return mat;
    const key = mat.uuid + '|' + a;
    let c = clones.get(key);
    if (!c) {
      c = mat.clone();
      c.onBeforeCompile = mat.onBeforeCompile;
      c.customProgramCacheKey = mat.customProgramCacheKey;
      c.transparent = true;
      c.opacity = a;
      c.depthWrite = false;
      c.needsUpdate = true;
      clones.set(key, c);
    }
    return c;
  };

  const apply = () => {
    for (const e of entries) {
      const levels = new Set([1]);
      for (const b of e.triBone) {
        const a = alpha.get(names[b]);
        if (a != null && a > 0) levels.add(a);
      }
      const order = [...levels].sort((x, y) => y - x);
      const buf = new e.indices.constructor(e.indices.length);
      const runs = [];
      let ptr = 0;
      e.subs.forEach((sm, si) => {
        const t0 = sm.indexStart / 3;
        const t1 = t0 + sm.indexCount / 3;
        for (const lv of order) {
          const start = ptr;
          for (let t = t0; t < t1; t++) {
            const a = alpha.get(names[e.triBone[t]]);
            if ((a == null ? 1 : a) !== lv) continue;
            buf[ptr++] = e.indices[t * 3];
            buf[ptr++] = e.indices[t * 3 + 1];
            buf[ptr++] = e.indices[t * 3 + 2];
          }
          if (ptr > start) runs.push({ start, count: ptr - start, sub: si, lv });
        }
      });
      const idxAttr = new T.BufferAttribute(buf.subarray(0, ptr), 1);
      const setGeo = (obj, matFor) => {
        if (!obj) return;
        const mats = [];
        const seen = new Map();
        const g = obj.geometry;
        g.setIndex(idxAttr);
        g.clearGroups();
        for (const r of runs) {
          const key = r.sub + '|' + r.lv;
          let mi = seen.get(key);
          if (mi == null) {
            mi = mats.length;
            mats.push(matFor(r));
            seen.set(key, mi);
          }
          g.addGroup(r.start, r.count, mi);
        }
        obj.material = mats.length === 1 ? mats[0] : mats;
      };
      setGeo(e.obj, (r) => variant(e.baseMats[r.sub] || e.baseMats[0], r.lv));
      setGeo(e.outline, (r) => variant(e.outlineMat, r.lv));
    }
  };

  const groups = new Map();
  for (const b of [...used].sort((x, y) => names[x].localeCompare(names[y]))) {
    const g = boneGroup(names[b]);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(names[b]);
  }
  const ordered = [...groups.entries()].sort((a, b) => {
    const i = GROUP_ORDER.indexOf(a[0]);
    const j = GROUP_ORDER.indexOf(b[0]);
    return (i < 0 ? 99 : i) - (j < 0 ? 99 : j);
  });

  return {
    available: entries.length > 0 && used.size > 1,
    groups: ordered,
    alphaOf: (n) => {
      const a = alpha.get(n);
      return a == null ? 1 : a;
    },
    set(list, a) {
      for (const n of list) {
        if (a === 1) alpha.delete(n);
        else alpha.set(n, a);
      }
      apply();
    },
    resetAll() {
      alpha.clear();
      apply();
    },
    dispose() {
      clones.forEach((m) => m.dispose());
      clones.clear();
    },
  };
}
