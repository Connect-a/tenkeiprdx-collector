import { DIRS } from '../core/constants.js';
import { toPath } from '../core/paths.js';
import { assetRefs } from './asset-refs.js';
import { localInventory } from './inventory.js';
import { resolveOrigin } from './origin.js';
import { assetStore } from './asset-store.js';
import { ensureIndexes } from './index-store.js';

export function otherBgmList(x) {
  const hi = x.master.homeIndex || { homeBgm: [] };
  const sa = x.assets.sceneAssetIndex || {};
  const homeAudio = new Set((hi.homeBgm || []).map((e) => e.audio).filter(Boolean));
  const bgmCtx = x.master.bgmContext || {};
  return (x.assets.bgmTracks || [])
    .filter((t) => !homeAudio.has(t.audio) && (sa[t.audio] || sa[t.audio + '_loop']))
    .map((t) => ({ id: 'x' + t.id, name: bgmCtx[t.audio] ? t.audio + '（' + bgmCtx[t.audio] + '）' : t.audio, audio: t.audio, order: Number(t.id) || 0 }));
}

export async function homeData() {
  const x = await ensureIndexes();
  const hi = x.master.homeIndex || { sceneIllust: [], comic: [], homeBgm: [] };
  const sa = x.assets.sceneAssetIndex || {};
  const iv = x.assets.illustVoiceIndex || {};
  const itemIdx = x.assets.itemIndex || {};
  const iconNamed = x.assets.itemIconNamed || {};
  const sharedSet = new Set(x.assets.sharedIndex || []);

  const withBgm = (e) => {
    const p = assetRefs.bgmParts(sa, e.audio);
    return { ...e, audioRel: (p && p.loop) || null, introRel: (p && p.intro) || null, plainRel: (p && p.split && p.plain) || null, audioResolvable: !!(p && p.loop) };
  };
  const withIcon = (e) => ({ ...e, iconRel: (e.icon && iconNamed[e.icon]) || null });

  const background = (hi.background || [])
    .map((e) => {
      const body = e.bg ? sa[e.bg] : null;
      const inShared = !!(body && sharedSet.has(body));
      return { ...withIcon(e), sharedRel: inShared ? body : null, bodyRel: body && !inShared ? body : null, bgResolvable: !!body };
    })
    .sort((a, b) => (a.source === b.source ? (a.order || 0) - (b.order || 0) : a.source === 'comic' ? 1 : -1));

  const owned = new Set();
  for (const c of Object.values(x.master.characters || {})) if (c.chibiIconId) owned.add(String(c.chibiIconId));
  for (const em of x.master.monsterMaster || []) for (const cid of em.chibiIconIds || []) owned.add(String(cid));
  const profileIcon = (hi.profileIcon || [])
    .filter((e) => !owned.has(String(e.id)) && !owned.has(String(e.icon)))
    .map((e) => ({ ...e, iconRel: itemIdx[e.icon] || itemIdx[e.id] || null }))
    .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));

  const sceneIllust = (hi.sceneIllust || []).map((e) => {
    const nm = e.stillAdult && sa[e.stillAdult] ? e.stillAdult : e.still;
    const cg = (nm && sa[nm]) || null;
    return { ...e, cgRel: cg || null, voiceRel: iv[e.id] || null };
  });

  return {
    sceneIllust,
    comic: hi.comic || [],
    homeBgm: (hi.homeBgm || []).map(withBgm).map(withIcon),
    otherBgm: otherBgmList(x).map(withBgm).map(withIcon),
    background,
    profileIcon,
    staticsBase: (await resolveOrigin()).statics,
  };
}

const comicPath = (id) => `comic/${id}.dds`;

function collectHomeRefs(data) {
  const home = new Set();
  const shared = new Set();
  const comic = new Set();
  const add = (set, s) => s && set.add(s);
  for (const e of data.sceneIllust || []) {
    add(shared, e.cgRel);
    if ((e.lines || []).length) add(home, e.voiceRel);
  }
  for (const e of data.comic || []) comic.add(comicPath(e.id));
  for (const e of [...(data.homeBgm || []), ...(data.otherBgm || [])]) {
    add(home, e.iconRel);
    add(shared, e.audioRel);
    add(shared, e.introRel);
  }
  for (const e of data.background || []) {
    add(home, e.iconRel);
    add(shared, e.sharedRel);
    add(home, e.bodyRel);
  }
  for (const e of data.profileIcon || []) add(home, e.iconRel);
  return { home, shared, comic };
}

async function lookupHome(data) {
  const refs = collectHomeRefs(data);
  const [home, shared, comic] = await Promise.all([
    refs.home.size ? assetStore.presentIds(DIRS.home, [...refs.home]) : new Map(),
    refs.shared.size ? assetStore.presentIds(DIRS.shared, [...refs.shared]) : new Map(),
    refs.comic.size ? localInventory.presentFiles(DIRS.home, [...refs.comic]) : new Set(),
  ]);
  const inHome = (rel) => (rel && home.get(assetStore.idOf(rel))) || null;
  const inShared = (rel) => {
    const p = rel && shared.get(assetStore.idOf(rel));
    return p ? toPath(DIRS.shared, p) : null;
  };
  return { refs, total: refs.home.size + refs.shared.size + refs.comic.size, have: home.size + shared.size + comic.size, inHome, inShared, hasComic: (id) => comic.has(comicPath(id)) };
}

const mapOf = (list, build) => {
  const m = new Map();
  for (const e of list || []) {
    const rec = build(e);
    if (rec) m.set(String(e.id), rec);
  }
  return m;
};

export async function homeAssetStatus(dataIn) {
  try {
    const data = dataIn || (await homeData());
    const r = await lookupHome(data);
    const unknown = data.staticsBase
      ? 0
      : [...r.refs.comic].filter(
          (p) =>
            !r.hasComic(
              String(p)
                .replace(/^comic\//, '')
                .replace(/\.dds$/, ''),
            ),
        ).length;
    return { have: r.have, total: r.total, unknown };
  } catch (e) {
    return { have: 0, total: 0, unknown: 0 };
  }
}

export async function homeStatus(dataIn) {
  const data = dataIn || (await homeData());
  const { inHome, inShared, hasComic } = await lookupHome(data);

  const bgmOf = (e) => {
    const audio = inShared(e.audioRel) || inShared(e.plainRel);
    return audio ? { id: e.id, name: e.name, order: e.order || 0, audio, intro: inShared(e.introRel), icon: inHome(e.iconRel) } : null;
  };

  return {
    homeBgm: mapOf(data.homeBgm, bgmOf),
    otherBgm: mapOf(data.otherBgm, bgmOf),
    sceneIllust: mapOf(data.sceneIllust, (e) => {
      const cg = inShared(e.cgRel);
      if (!cg) return null;
      return { id: e.id, name: e.name, order: e.order || 0, lines: e.lines || [], cg, voice: inHome(e.voiceRel) };
    }),
    comic: mapOf(data.comic, (e) => (hasComic(e.id) ? { id: e.id, title: e.title, order: e.order || 0, img: comicPath(e.id) } : null)),
    background: mapOf(data.background, (e) => {
      const bg = inShared(e.sharedRel) || inHome(e.bodyRel);
      const icon = inHome(e.iconRel);
      return icon || bg ? { id: e.id, name: e.name, desc: e.desc || '', source: e.source || '', order: e.order || 0, icon, bg } : null;
    }),
    profileIcon: mapOf(data.profileIcon, (e) => {
      const icon = inHome(e.iconRel);
      return icon ? { id: e.id, name: e.name, kind: e.kind, order: e.order || 0, icon } : null;
    }),
  };
}
