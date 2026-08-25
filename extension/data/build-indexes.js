import { OTHER_EPISODE_SUBTYPE } from '../core/constants.js';
import { utilHelpers } from '../core/util.js';
import { toRel, APP_DIR, APP_PREFIX, bundleName } from '../core/paths.js';
const num = utilHelpers.num;
const str = (x) => (typeof x === 'string' && x.trim() ? x : undefined);
const int = (x) => (typeof x === 'number' ? x : typeof x === 'bigint' ? Number(x) : undefined);

function commonLabel(labels) {
  if (labels.length === 1) return labels[0];
  let p = labels[0];
  for (const s of labels.slice(1)) {
    let i = 0;
    while (i < p.length && i < s.length && p[i] === s[i]) i++;
    p = p.slice(0, i);
  }
  p = p.replace(/[\s_\-・:：/(（【]+$/u, '').trim();
  return p || labels[0];
}

function splitChapters(nodes) {
  const gOrders = new Set(nodes.map((n) => n.gOrder));
  const names = new Set(nodes.map((n) => n.locName));
  const shorts = new Set(nodes.map((n) => n.locShort));
  const useShort = names.size < gOrders.size && shorts.size > 1 && !shorts.has('');
  for (const n of nodes) n.label2 = (useShort ? n.locShort : n.locName) || n.locShort || n.locName || '';
  const chapters = [];
  for (const n of nodes) {
    const last = chapters[chapters.length - 1];
    if (last && last.gOrder === n.gOrder) {
      last.nodes.push(n);
      if (!last.labels.includes(n.label2)) last.labels.push(n.label2);
    } else chapters.push({ gOrder: n.gOrder, labels: [n.label2], nodes: [n] });
  }
  const cards = [];
  for (const c of chapters) {
    const sig = JSON.stringify(c.labels);
    const last = cards[cards.length - 1];
    if (last && last.sig === sig) last.nodes.push(...c.nodes);
    else cards.push({ gOrder: c.gOrder, sig, title: commonLabel(c.labels), nodes: c.nodes });
  }
  return cards;
}

const ITEM_TABLES = {
  14: { key: 'weapon', icon: 3, desc: 2, owner: 13, stones: [11, 16], label: '武器' },
  10: { key: 'armor', icon: 3, desc: 2, owner: 13, stones: [11, 16], label: '防具' },
  30: { key: 'grimoire', icon: 3, desc: 2, label: '教典' },
  141: { key: 'stone', icon: 3, desc: 2, label: '石' },
  149: { key: 'equipweapon', icon: 3, weapons: 5, variantCat: 2, label: '装備武器' },
  150: { key: 'aura', icon: 2, label: 'オーラ' },
};

const MAIN_EVENT_TYPES = new Set([1, 24, 25]);
const SPECIAL_SUBTYPE = { 0: 'エクストラエピソード', 1: 'イベントエピソード', 2: 'スペシャルエピソード' };
const DEFERRED_TABLES = [33, 20, 145, 36, 168, 17];

const bgmKey = (b) => String(b).replace(/_(loop|intro)$/, '');
const byOrder = (a, b) => (a.order || 0) - (b.order || 0);
const idStr = (v) => (v != null ? String(num(v)) : '');

function parseJson(s) {
  try {
    return typeof s === 'string' ? JSON.parse(s) : null;
  } catch (e) {
    return null;
  }
}

function attachNums(cfg) {
  const a = cfg && cfg.Attachments;
  if (!Array.isArray(a)) return undefined;
  const out = a.map((x) => num(x)).filter((x) => x > 0);
  return out.length ? out : undefined;
}

function parseAttachmentColors(s) {
  const arr = Array.isArray(s) ? s : parseJson(s);
  if (!Array.isArray(arr)) return undefined;
  const out = [];
  for (const c of arr) {
    if (!c || num(c.TargetPlatformType) >= 2) continue;
    const idx = (Array.isArray(c.TargetAttachments) ? c.TargetAttachments : []).map((x) => num(x)).filter((x) => x > 0);
    const hex = str(c.Colorcode);
    if (idx.length && hex) out.push({ attachments: idx, colorcode: hex, intensity: Number(c.Intensity) || 0 });
  }
  return out.length ? out : undefined;
}

function parseWeapons(s) {
  const wj = parseJson(s);
  if (!Array.isArray(wj) || !wj.length) return undefined;
  return wj
    .map((w) => ({
      slot: str(w.Slot),
      weaponId: w.WeaponId != null ? String(w.WeaponId) : null,
      variation: (w.AssetConfiguration && str(w.AssetConfiguration.Variation)) || 'Default',
      scale: (w.AssetConfiguration && Number(w.AssetConfiguration.Scale)) || 1,
    }))
    .filter((w) => w.weaponId);
}

function voiceMessagesOf(raw) {
  const vm = {};
  if (raw instanceof Map) {
    for (const [k, v] of raw) {
      const s = str(v);
      if (s) vm[num(k)] = s;
    }
  } else if (raw && typeof raw === 'object' && !(raw instanceof Uint8Array)) {
    for (const k of Object.keys(raw)) {
      const s = str(raw[k]);
      if (s) vm[Number(k)] = s;
    }
  }
  return Object.keys(vm).length ? vm : undefined;
}

const TABLE_HANDLERS = {
  4(p, acc) {
    const bwh = [int(p[17]), int(p[18]), int(p[19])];
    const weapons = parseWeapons(p[8]);
    acc.characters[String(num(p[0]))] = {
      name: str(p[3]),
      title: str(p[4]),
      intro: str(p[14]),
      race: str(p[15]),
      groupId: int(p[10]),
      rankId: int(p[9]),
      bwh: bwh.every((x) => typeof x === 'number') ? bwh : undefined,
      likes: str(p[20]),
      dislikes: str(p[21]),
      specialty: str(p[22]),
      profile1: str(p[23]),
      profile2: str(p[24]),
      chibiIconId: int(p[25]) != null ? String(int(p[25])) : undefined,
      itemIconIds: [...new Set([p[25], p[31], p[34]].map((x) => (int(x) != null ? String(int(x)) : null)).filter(Boolean))],
      weapons: weapons && weapons.length ? weapons : undefined,
      attachmentColors: parseAttachmentColors(p[46]),
      voiceMessages: voiceMessagesOf(p[35]),
    };
    const cat = idStr(p[40]);
    const nm = str(p[3]);
    if (cat && cat !== '0' && nm) (acc.weaponCatChars[cat] || (acc.weaponCatChars[cat] = new Set())).add(nm);
    const sk = [];
    for (const e of Array.isArray(p[33]) ? p[33] : []) {
      const sid = e && e[3] != null ? String(int(e[3])) : null;
      if (sid) sk.push({ skillId: sid, lv: int(e[1]) || 0, type: int(e[2]) || 0 });
    }
    if (sk.length) acc.charSkills[String(num(p[0]))] = sk;
  },
  154(p, acc) {
    const nm = str(p[1]);
    if (nm) acc.weaponCatName[String(num(p[0]))] = nm;
  },
  103(p, acc) {
    const nm = str(p[4]);
    if (nm) acc.gachaNames[String(num(p[0]))] = nm;
  },
  144(p, acc) {
    const id = String(num(p[0]));
    acc.missionGroups.push({
      id,
      name: str(p[1]) || 'パネルミッション' + id,
      type: num(p[12]) || 0,
      bg: str(p[2]) || null,
      navCharId: str(p[3]) || null,
      icon: str(p[6]) || null,
      title: str(p[7]) || null,
      effect: str(p[8]) || null,
      still: str(p[13]) || null,
    });
  },
  12(p, acc) {
    const iid = String(num(p[0]));
    acc.itemMaster.push({ id: iid, name: str(p[1]) || iid, desc: str(p[3]) || '', icon: String(num(p[4]) || iid), category: 'item', itemType: num(p[2]) || 0 });
  },
  18(p, acc) {
    acc.eventMap[num(p[0])] = { id: num(p[0]), name: str(p[1]) || 'イベント' + num(p[0]), type: num(p[2]), order: int(p[14]) || 0 };
    if (typeof p[10] === 'string' && /^bgm_\d/.test(p[10])) {
      const k = bgmKey(p[10]);
      if (!acc.bgm.eventCtx[k]) acc.bgm.eventCtx[k] = 'イベント「' + (str(p[1]) || '') + '」';
    }
  },
  19(p, acc) {
    acc.locMap[num(p[0])] = { id: num(p[0]), eventId: num(p[1]), name: str(p[3]) || '', groupOrder: int(p[4]) || 0, inGroupOrder: int(p[5]) || 0, short: str(p[15]) || '' };
    const th = str(p[12]);
    if (!th) return;
    for (const k of [num(p[1]), num(p[1]) + ':' + (int(p[4]) || 0)]) (acc.questThumbSets[k] || (acc.questThumbSets[k] = new Set())).add(th);
  },
  32(p, acc) {
    const bgList = Array.isArray(p[10]) ? p[10] : [];
    acc.sceneMeta[num(p[0])] = {
      label: p[1],
      title: p[2],
      xpos: int(p[15]) || 0,
      thumb: bgList.find((n) => typeof n === 'string' && /_still_01$/.test(n)) || null,
      binIds: [...(p[8] || []), ...(p[9] || [])].map((x) => String(num(x))),
    };
    const imgs = [...(Array.isArray(p[10]) ? p[10] : []), ...(Array.isArray(p[11]) ? p[11] : [])].filter((x) => typeof x === 'string' && x);
    if (imgs.length) acc.sceneImages[String(num(p[0]))] = imgs;
    if (Array.isArray(p[10])) for (const b of p[10]) if (typeof b === 'string' && b) acc.sceneBgNames.add(b);
    if (!Array.isArray(p[12])) return;
    const ttl = str(p[2]) || str(p[1]);
    const bgms = p[12].filter((b) => typeof b === 'string' && /^bgm_\d/.test(b)).map(bgmKey);
    const firstK = bgms.length ? bgms[0] : null;
    const uniq = [...new Set(bgms)];
    for (const k of uniq) {
      acc.bgm.useCount[k] = (acc.bgm.useCount[k] || 0) + 1;
      if (!ttl) continue;
      const isFirst = k === firstK;
      const cur = acc.bgm.storyBest[k];
      if (!cur || (isFirst && !cur.first) || (isFirst === cur.first && uniq.length < cur.len)) acc.bgm.storyBest[k] = { ttl, len: uniq.length, first: isFirst };
    }
  },
  41(p, acc) {
    noteModelName(acc, p[2], p[3], p[1]);
    const mid = String(num(p[3]));
    if (!mid || mid === 'null' || acc.battleByModel[mid]) return;
    const cfg = parseJson(p[4]) || {};
    acc.battleByModel[mid] = { name: str(p[1]) || mid, variation: str(cfg.Variation) || 'Default', scale: Number(cfg.Scale) || 1, attachments: attachNums(cfg), weapons: parseWeapons(p[5]) };
  },
  49(p, acc) {
    const cfg = parseJson(p[4]) || {};
    noteModelName(acc, p[2], p[3], p[1]);
    noteModelName(acc, null, p[0], p[1]);
    const look = { variation: str(cfg.Variation) || 'Default', scale: Number(cfg.Scale) || 1, attachments: attachNums(cfg) };
    const name = str(p[1]) || String(num(p[0]));
    acc.monsterMaster.push({
      id: String(num(p[2])),
      speciesId: String(num(p[0])),
      baseModel: String(num(p[3])),
      name,
      ...look,
      weapons: parseWeapons(p[5]),
      rarity: int(p[6]),
      affiliation: int(p[7]),
      type: int(p[8]),
      race: int(p[9]),
      maxLevel: int(p[10]),
      cost: int(p[12]),
      likes: str(p[14]) || '',
      dislikes: str(p[15]) || '',
      desc: str(p[16]) || '',
      awakenItemId: p[22] != null ? String(num(p[22])) : null,
      chibiIconIds: [p[25], p[26]].map((v) => (v != null ? String(num(v)) : null)).filter(Boolean),
    });
    acc.monsterSpecies.push({ species: String(num(p[0])), model: String(num(p[3])), ...look, name, desc: str(p[16]) || '' });
  },
};

function noteModelName(acc, own, base, name) {
  const nm = str(name);
  if (!nm) return;
  const o = idStr(own);
  const b = idStr(base);
  if (o && o !== 'null' && !acc.nameByModel[o]) acc.nameByModel[o] = nm;
  if (b && b !== 'null' && !acc.nameByBaseModel[b]) acc.nameByBaseModel[b] = nm;
}

function handleItemTable(t, p, acc) {
  const c = ITEM_TABLES[t];
  const icon = str(p[c.icon]) || String(num(p[c.icon]));
  const ownerId = c.owner != null && p[c.owner] != null ? String(num(p[c.owner])) : '';
  const owned = ownerId && ownerId !== '0' ? ownerId : '';
  if (icon && icon !== '0') {
    const variantCategoryId = c.variantCat != null ? idStr(p[c.variantCat]) : '';
    acc.itemMaster.push({
      id: str(p[0]) || String(num(p[0])),
      name: str(p[1]) || icon,
      desc: c.desc != null ? str(p[c.desc]) || '' : '',
      icon,
      category: c.key,
      ownerCharId: owned || undefined,
      variantCategoryId: variantCategoryId || undefined,
    });
  }
  if (owned) {
    for (const fi of c.stones || []) {
      const sid = idStr(p[fi]);
      if (sid && sid !== '0') acc.equipStoneOwner[sid] = owned;
    }
  }
  if (c.weapons != null) {
    const ws = parseWeapons(p[c.weapons]);
    if (ws && ws.length) acc.equipWeapons.push({ name: str(p[1]) || icon, weapons: ws });
  }
}

function collectRecords(recs) {
  const acc = {
    characters: {},
    charSkills: {},
    sceneMeta: {},
    sceneBgNames: new Set(),
    sceneImages: {},
    sceneOwners: {},
    eventMap: {},
    locMap: {},
    monsterSpecies: [],
    battleByModel: {},
    monsterMaster: [],
    nameByModel: {},
    nameByBaseModel: {},
    itemMaster: [],
    missionGroups: [],
    equipWeapons: [],
    equipStoneOwner: {},
    weaponCatName: {},
    weaponCatChars: {},
    gachaNames: {},
    questThumbSets: {},
    bgm: { eventCtx: {}, storyBest: {}, useCount: {} },
    deferred: {},
  };
  for (const t of DEFERRED_TABLES) acc.deferred[t] = [];
  for (const r of recs) {
    if (!Array.isArray(r)) continue;
    const p = r[1];
    if (!Array.isArray(p)) continue;
    const t = num(r[0]);
    if (acc.deferred[t]) acc.deferred[t].push(p);
    else if (TABLE_HANDLERS[t]) TABLE_HANDLERS[t](p, acc);
    else if (ITEM_TABLES[t]) handleItemTable(t, p, acc);
  }
  return acc;
}

function noteSceneOwner(acc, masterId, owner) {
  const k = String(masterId);
  if (!k || k === 'null' || !owner) return;
  (acc.sceneOwners[k] || (acc.sceneOwners[k] = new Set())).add(owner);
}

function attachCharacterEpisodes(acc, binIdsOf) {
  for (const p of acc.deferred[33]) {
    const base = String(num(p[3]));
    noteSceneOwner(acc, num(p[1]), base);
    const sc = acc.sceneMeta[num(p[1])] || {};
    if (!acc.characters[base]) acc.characters[base] = { name: '(不明)', title: '' };
    const c = acc.characters[base];
    (c.episodes || (c.episodes = [])).push({
      episodeId: String(num(p[0])),
      order: num(p[2]),
      label: sc.label || null,
      title: sc.title || null,
      xpos: sc.xpos || 0,
      thumb: sc.thumb || null,
      sceneBinIds: binIdsOf(num(p[1])),
    });
  }
  for (const [id, c] of Object.entries(acc.characters)) {
    c.id = Number(id);
    if (c.episodes) c.episodes.sort(byOrder);
  }
}

function buildQuestIndex(acc, binIdsOf) {
  const evGroups = {};
  for (const p of acc.deferred[20]) {
    const epId = p[5] != null ? num(p[5]) : null;
    if (epId == null || !acc.sceneMeta[epId]) continue;
    const loc = acc.locMap[num(p[1])];
    const ev = loc && acc.eventMap[loc.eventId];
    if (!ev) continue;
    const g = evGroups[ev.id] || (evGroups[ev.id] = { event: ev.id, name: ev.name, type: ev.type, cat: MAIN_EVENT_TYPES.has(ev.type) ? 'main' : 'event', order: ev.order, nodes: [] });
    const sc = acc.sceneMeta[epId];
    g.nodes.push({
      episodeId: String(num(p[0])),
      masterId: String(epId),
      locId: loc.id,
      locName: loc.name,
      locShort: loc.short,
      gOrder: loc.groupOrder,
      igOrder: loc.inGroupOrder,
      nOrder: num(p[2]),
      label: sc.label || null,
      title: sc.title || null,
      sceneBinIds: binIdsOf(epId),
    });
  }
  const questIndex = {};
  for (const [eid, g] of Object.entries(evGroups)) {
    if (!g.nodes.length) continue;
    g.nodes.sort((a, b) => a.gOrder - b.gOrder || a.igOrder - b.igOrder || a.nOrder - b.nOrder);
    const cards = splitChapters(g.nodes);
    const many = cards.length > 1;
    for (const c of cards) {
      const questKey = many ? `${eid}c${c.gOrder}` : String(eid);
      for (const n of c.nodes) noteSceneOwner(acc, n.masterId, 'quest_' + questKey);
      questIndex[questKey] = {
        event: Number(eid),
        name: g.name,
        type: g.type,
        cat: g.cat,
        order: g.order,
        chapter: many ? c.title : '',
        chapterOrder: c.gOrder,
        episodes: c.nodes.map((n, i) => ({ episodeId: n.episodeId, order: i + 1, chapter: n.label2, chapterId: n.locId, label: n.label, title: n.title, sceneBinIds: n.sceneBinIds })),
      };
    }
  }
  return questIndex;
}

function referencedSceneIds(acc) {
  const used = new Set();
  for (const p of acc.deferred[33]) used.add(String(num(p[1])));
  for (const p of acc.deferred[20]) if (p[5] != null) used.add(String(num(p[5])));
  for (const p of acc.deferred[145]) used.add(String(num(p[1])));
  return used;
}

function buildOtherIndex(acc, binIdsOf) {
  const used = referencedSceneIds(acc);
  const episodes = [];
  for (const [sid, sc] of Object.entries(acc.sceneMeta)) {
    if (used.has(String(sid))) continue;
    noteSceneOwner(acc, sid, 'special_other');
    episodes.push({
      paidMasterId: null,
      episodeId: String(sid),
      order: Number(sid) || 0,
      label: sc.label || null,
      title: sc.title || null,
      subType: OTHER_EPISODE_SUBTYPE,
      unlockItem: null,
      sceneBinIds: binIdsOf(Number(sid)),
    });
  }
  if (!episodes.length) return null;
  episodes.sort(byOrder);
  return { event: 'other', name: OTHER_EPISODE_SUBTYPE, subType: OTHER_EPISODE_SUBTYPE, episodes };
}

function buildSpecialIndex(acc, binIdsOf) {
  const specialMap = {};
  for (const p of acc.deferred[145]) {
    const episodeId = num(p[1]);
    const m = String(p[4] || '').match(/eventstill_(\d+)_/);
    const eid = m ? m[1] : 'misc';
    const sc = acc.sceneMeta[episodeId] || {};
    const subType = SPECIAL_SUBTYPE[num(p[8])] || '特別エピソード';
    noteSceneOwner(acc, episodeId, 'special_' + eid);
    const ev = specialMap[eid] || (specialMap[eid] = { event: eid, name: sc.title || sc.label || '特別エピソード' + eid, subType, episodes: [] });
    ev.episodes.push({
      paidMasterId: String(num(p[0])),
      episodeId: String(episodeId),
      order: num(p[5]) || 0,
      label: sc.label || null,
      title: sc.title || null,
      subType,
      unlockItem: int(p[2]) != null ? String(int(p[2])) : null,
      sceneBinIds: binIdsOf(episodeId),
    });
  }
  const eventIndex = {};
  for (const [e, ev] of Object.entries(specialMap)) {
    if (!ev.episodes.length) continue;
    ev.episodes.sort(byOrder);
    ev.name = ev.episodes[0].title || ev.episodes[0].label || ev.name;
    eventIndex[e] = ev;
  }
  return eventIndex;
}

function buildHomeIndex(acc) {
  const homeIndex = { sceneIllust: [], comic: [], homeBgm: [], background: [], profileIcon: [] };
  for (const p of acc.deferred[36]) {
    const ty = num(p[3]);
    const id = String(num(p[0]));
    const name = str(p[1]) || '';
    const order = int(p[9]) || 0;
    const icon = str(p[4]);
    if (ty === 4) {
      const lines = p.find((v) => Array.isArray(v) && v.length && Array.isArray(v[0]) && typeof v[0][0] === 'string' && /^[cs]_/.test(v[0][0]));
      homeIndex.sceneIllust.push({ id, name, still: icon, stillAdult: str(p[7]) || null, order, lines: (lines || []).map((l) => ({ voiceId: l[0], text: l[1], order: num(l[2]) })) });
    } else if (ty === 3) {
      homeIndex.homeBgm.push({ id, name, icon, audio: icon ? icon.replace(/_icon$/, '') : null, order });
    } else if (ty === 2 || ty === 6) {
      homeIndex.background.push({ id, name, desc: str(p[2]) || '', icon, bg: icon ? icon.replace(/_icon$/, '') : null, source: ty === 6 ? 'comic' : 'scene', order });
    } else if (ty === 1 || ty === 5) {
      homeIndex.profileIcon.push({ id, name, icon: icon || id, kind: ty === 1 ? 'character' : 'monster', order });
    }
  }
  for (const p of acc.deferred[168]) homeIndex.comic.push({ id: String(num(p[0])), title: str(p[1]) || '', asset: str(p[2]), order: int(p[3]) || 0 });
  for (const list of Object.values(homeIndex)) list.sort(byOrder);
  return homeIndex;
}

function buildBgmContext(bgm) {
  const out = {};
  for (const k of new Set([...Object.keys(bgm.eventCtx), ...Object.keys(bgm.storyBest)])) {
    if (bgm.eventCtx[k]) out[k] = bgm.eventCtx[k];
    else if ((bgm.useCount[k] || 0) <= 9 && bgm.storyBest[k]) out[k] = '物語「' + bgm.storyBest[k].ttl + '」';
  }
  return out;
}

function attachWeaponVariants(acc) {
  for (const it of acc.itemMaster) {
    const cat = it.variantCategoryId;
    if (!cat) continue;
    const chars = [...(acc.weaponCatChars[cat] || [])].sort();
    const catName = acc.weaponCatName[cat] || '';
    it.variantChars = chars;
    const who = chars.length === 1 ? `${chars[0]}専用` : chars.length && chars.length <= 3 ? chars.join('・') : chars.length ? `${chars.length}人` : '';
    it.variant = [catName, who].filter(Boolean).join('・');
  }
}

function buildSharedImageNames(acc) {
  const owners = {};
  for (const [sid, names] of Object.entries(acc.sceneImages)) {
    const os = acc.sceneOwners[sid];
    if (!os) continue;
    for (const n of names) {
      const s = owners[n] || (owners[n] = new Set());
      for (const o of os) s.add(o);
    }
  }
  return Object.keys(owners)
    .filter((n) => owners[n].size > 1)
    .sort();
}

function buildSkillMaster(acc) {
  const referenced = new Set();
  for (const list of Object.values(acc.charSkills || {})) for (const s of list) referenced.add(s.skillId);
  const skillMaster = {};
  for (const p of acc.deferred[17] || []) {
    const sid = p && p[0] != null ? String(int(p[0])) : null;
    if (!sid || !referenced.has(sid) || skillMaster[sid]) continue;
    const effects = Array.isArray(p[14]) ? p[14].map((x) => str(x)).filter(Boolean) : [];
    skillMaster[sid] = { name: str(p[1]) || '', desc: str(p[2]) || '', effects };
  }
  return skillMaster;
}

function masterIndexes(recs) {
  const acc = collectRecords(recs);
  const binIdsOf = (sceneId) => {
    const sc = acc.sceneMeta[sceneId];
    return sc && sc.binIds && sc.binIds.length ? sc.binIds : [String(sceneId)];
  };

  attachCharacterEpisodes(acc, binIdsOf);
  const questIndex = buildQuestIndex(acc, binIdsOf);
  const eventIndex = buildSpecialIndex(acc, binIdsOf);
  const other = buildOtherIndex(acc, binIdsOf);
  if (other) eventIndex.other = other;
  const homeIndex = buildHomeIndex(acc);

  const questThumbsByEvent = {};
  for (const [k, set] of Object.entries(acc.questThumbSets)) questThumbsByEvent[k] = [...set];

  for (const it of acc.itemMaster) {
    if (it.ownerCharId) continue;
    const own = acc.equipStoneOwner[it.id] || acc.equipStoneOwner[it.icon];
    if (own) it.ownerCharId = own;
  }
  attachWeaponVariants(acc);

  const skillMaster = buildSkillMaster(acc);
  const effectUse = {};
  for (const list of Object.values(acc.charSkills || {})) {
    const seen = new Set();
    for (const s of list) {
      const sk = skillMaster[s.skillId];
      if (!sk) continue;
      for (const e of sk.effects) seen.add(e);
    }
    for (const e of seen) effectUse[e] = (effectUse[e] || 0) + 1;
  }
  const sharedEffects = Object.keys(effectUse).filter((e) => effectUse[e] > 1);

  return {
    characters: acc.characters,
    charSkills: acc.charSkills,
    skillMaster,
    sharedEffects,
    questIndex,
    eventIndex,
    homeIndex,
    monsterSpecies: acc.monsterSpecies,
    battleByModel: acc.battleByModel,
    monsterMaster: acc.monsterMaster,
    nameByModel: acc.nameByModel,
    nameByBaseModel: acc.nameByBaseModel,
    questThumbsByEvent,
    bgmContext: buildBgmContext(acc.bgm),
    itemMaster: acc.itemMaster,
    missionGroups: acc.missionGroups,
    gachaNames: acc.gachaNames,
    equipWeapons: acc.equipWeapons,
    sceneBgNames: [...acc.sceneBgNames],
    sharedImageNames: buildSharedImageNames(acc),
  };
}

function mapPath(id) {
  let m;
  if ((m = id.match(/^PariPari(?:Public)?Remote\/(.+)$/))) return m[1];
  if ((m = id.match(/^\{UnityEngine\.AddressableAssets\.Addressables\.RuntimePath\}\/WebGL\/(.+)$/))) return APP_DIR + m[1];
  return null;
}
const ADDRESSABLE_FRIENDLY_NAMES = {
  '3dmodels_assets_3dmodels': 'model',
  materialsbundles_assets_assets: 'materials',
  spines_assets_spines: 'spine',
  spineslight_assets_spineslight: 'spinelight',
  charactericons_assets_charactericons: 'icon',
  charactericonslight_assets_charactericonslight: 'iconlight',
  battlecharactersicons_assets_battlecharactersicons: 'battleicon',
  monstericons_assets_monstericons: 'monstericon',
  characterillustrationx_assets_characterillustrationx: 'illustx',
  stills_assets_stills: 'still',
  backgrounds_assets_backgrounds: 'cg_bg',
  chibiicons_assets_chibiicons: 'chibiicon',
  illustrationvoice_assets_illustrationvoice: 'illustvoice',
};
const ADDRESSABLE_SKIP_PREFIXES = new Set([
  'adventurevoice_assets_adventurevoice',
  'charactervoices_assets_charactervoices',
  'events_assets_events',
  'obstacleassets_assets_obstacles',
  'loginbonus_assets_loginbonus',
  'itemicons_assets_itemicons',
  'vfxtextureassets_assets_assets',
  'tutorialassets_assets_assets',
  'tutorialassets_assets_spines',
  '3dmodels_assets_assets',
]);
const SHARED_KEEP = [
  (r) => /^backgrounds_assets_backgrounds\/bg_adventure_/.test(r),
  (r) => /^backgrounds_assets_backgrounds\/bg_common_system_/.test(r),
  (r) => /^bgm_assets_bgm\//.test(r),
  (r) => /^se_assets_/.test(r),
  (r) => /^builtinaudio\(uncompressed\)_assets_/.test(r),
  (r) => /^scenariolayouts_assets_/.test(r),
  (r) => /_unitybuiltinshaders_/.test(r),
  (r) => /^uispritesassets_assets_adventuresprites/.test(r),
  (r) => /_emotionsprites_/.test(r),
  (r) => /^uicomponentspartsassets_assets_scenario\//.test(r),
  (r) => /nativeassets\)_scenes_scenario/.test(r),
  (r) => /^questthumbnails_[a-z0-9_()]+\/(img_quest_top_button_inner_|btn_home_voting|btn_quest_top)/.test(r),
  (r) => /^eventpages_/.test(r),
  (r) => /^exchangeassets_assets_exchangeassets\//.test(r),
  (r) => /^loginbonus_assets_loginbonus\//.test(r),
  (r) => /^systemvoice_assets_/.test(r),
];

const CAT_PREFIX = /^([a-z0-9()]+_assets_[a-z0-9()]+)\//;
const HERO_MARK = [/^3dmodels_assets_3dmodels\/(\d{8})_/, /^spines_assets_spines\/(\d{8})_/, /^charactericons_assets_charactericons\/(\d{8})_/];
const ICON_CAT = /^(charactericons|charactericonslight|battlecharactersicons|monstericons)_assets_[a-z0-9]+\/(\d+)_[0-9a-f]{32}\.bundle$/;
const VFX_DL_RE = /^(vfx_assets_vfx\/|vfxmaterials_assets_vfxmaterials\/|vfxtextureassets_assets_assets\/|vfxmaterialassets_assets_)/;
const MISSION_UI_RE = /^uispritesassets_assets_missionsprites_[0-9a-f]{16,}\.bundle$/;
const UI_SPRITE_RE = /^uispritesassets_assets_[a-z0-9]+sprites_[0-9a-f]{16,}\.bundle$/;
const UI_PANEL_RE = /^uicomponentspartsassets_assets_[a-z0-9]*panel.*_[0-9a-f]{16,}\.bundle$/i;
const WORLDMAP_RE = /^worldmapassets_assets_assets\/.*\/worldmap_\d+_[a-z0-9]+\.png_[0-9a-f]{16,}\.bundle$/i;
const MINIGAME_RE = /^minigames_(?:assets|scenes)_/i;
const GACHA_BG_RE = /^backgrounds_assets_backgrounds\/bg_gacha_\d+_[0-9a-f]{16,}\.bundle$/i;
const GACHA_ANY_RE = /gacha/i;
const BATTLEFIELD_RE = /^(?:battlefieldsassets_scenes_battlefields|obstacleassets_assets_obstacles)\//i;

const SCENE_ASSET_RULES = [
  [/^backgrounds_assets_backgrounds\/(.+)_[0-9a-f]{32}\.bundle$/, (n) => n],
  [/^stills_assets_stills\/(.+)_[0-9a-f]{32}\.bundle$/, (n) => n],
  [/^bgm_assets_bgm\/(.+)_[0-9a-f]{32}\.bundle$/, (n) => n],
  [/^se_assets_se\/(.+)_[0-9a-f]{32}\.bundle$/, (n) => 'se:' + n.toLowerCase()],
];

const STAGE_RULES = [
  ['bgCommon', /^backgrounds_assets_backgrounds\/bg_common_system_/],
  ['adventureUi', /^uispritesassets_assets_adventuresprites_/],
  ['scenarioUi', /^scenariolayouts_assets_scenariouiassetpacks\/default_/],
  ['emotion', /_assets_emotionsprites_/],
];

function buildAssetIndex(rels) {
  const heroSet = new Set();
  for (const rel of rels)
    for (const re of HERO_MARK) {
      const m = rel.match(re);
      if (m) heroSet.add(m[1]);
    }
  const assetIndex = {};
  for (const rel of rels) {
    const cm = rel.match(CAT_PREFIX);
    if (!cm || ADDRESSABLE_SKIP_PREFIXES.has(cm[1])) continue;
    const friendly = ADDRESSABLE_FRIENDLY_NAMES[cm[1]] || cm[1];
    for (const id of new Set((rel.match(/\d{8}/g) || []).filter((t) => heroSet.has(t)))) {
      const o = assetIndex[id] || (assetIndex[id] = {});
      (o[friendly] || (o[friendly] = [])).push(rel);
    }
  }
  for (const cats of Object.values(assetIndex)) for (const list of Object.values(cats)) list.sort();
  return assetIndex;
}

function buildOtherModelIds(rels) {
  const modelIds = new Set();
  const charIconIds = new Set();
  for (const rel of rels) {
    let m;
    if ((m = rel.match(/^3dmodels_assets_3dmodels\/(\d{6,})_/))) modelIds.add(m[1]);
    else if ((m = rel.match(/^charactericons_assets_charactericons\/(\d{6,})_/))) charIconIds.add(m[1]);
  }
  return [...modelIds].filter((id) => !charIconIds.has(id)).sort();
}

function buildSceneAssetIndex(rels) {
  const out = {};
  for (const rel of rels) {
    for (const [re, key] of SCENE_ASSET_RULES) {
      const m = rel.match(re);
      if (m) {
        out[key(m[1])] = rel;
        break;
      }
    }
  }
  return out;
}

function buildGlobalAssets(rels) {
  const globalAssets = {};
  for (const rel of rels) {
    if (/^materialsbundles_assets_assets\/mouthmaterials_[0-9a-f]{16,}\.bundle$/.test(rel)) {
      globalAssets.mouthAtlas = rel;
      break;
    }
  }
  const stage = {};
  for (const r of rels) {
    const rel = r.replace(APP_PREFIX, '');
    for (const [key, re] of STAGE_RULES) {
      if (!stage[key] && re.test(rel)) {
        stage[key] = r;
        break;
      }
    }
  }
  globalAssets.stage = stage;
  return globalAssets;
}

function buildBgmTracks(sceneAssetIndex) {
  const seen = new Set();
  const tracks = [];
  for (const name of Object.keys(sceneAssetIndex)) {
    const m = name.match(/^bgm_(\d+)(?:_loop|_intro)?$/);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    const base = 'bgm_' + m[1];
    if (sceneAssetIndex[base] || sceneAssetIndex[base + '_loop']) tracks.push({ id: m[1], audio: base });
  }
  return tracks.sort((a, b) => Number(a.id) - Number(b.id));
}

function buildNamedIndexes(rels) {
  const adventure = {};
  const character = {};
  const chibiIndex = {};
  const itemIndex = {};
  const itemIconNamed = {};
  const illustVoiceIndex = {};
  const iconIndex = {};
  const spineMiscIndex = {};
  const strayVoice = [];
  for (const rel of rels) {
    let m;
    if ((m = rel.match(/^adventurevoice_assets_adventurevoice\/(\d+)_([0-9a-f]{32})\.bundle$/))) adventure[m[1]] = m[2];
    else if ((m = rel.match(/^charactervoices_assets_charactervoices\/(\d+)_([0-9a-f]{32})\.bundle$/))) character[m[1]] = m[2];
    else if ((m = rel.match(/^chibiicons_assets_chibiicons\/(\d+)_[0-9a-f]{32}\.bundle$/))) chibiIndex[m[1]] = rel;
    else if ((m = rel.match(/^itemicons_assets_itemicons\/(\d+)_[0-9a-f]{32}\.bundle$/))) itemIndex[m[1]] = rel;
    else if ((m = rel.match(/^itemicons_assets_itemicons\/(.+)_[0-9a-f]{32}\.bundle$/))) itemIconNamed[m[1]] = rel;
    else if ((m = rel.match(/^illustrationvoice_assets_illustrationvoice\/(\d+)_[0-9a-f]{32}\.bundle$/))) illustVoiceIndex[m[1]] = rel;
    else if ((m = rel.match(/^spinesmisc_assets_spinesmisc\/(.+)_[0-9a-f]{32}\.bundle$/))) spineMiscIndex[m[1]] = rel;
    else if (/^(adventurevoice|charactervoice|illustrationvoice)s?_assets_/.test(rel)) strayVoice.push(rel);
    if ((m = rel.match(ICON_CAT))) (iconIndex[m[2]] || (iconIndex[m[2]] = [])).push(rel);
  }
  return { chibiIndex, itemIndex, itemIconNamed, illustVoiceIndex, iconIndex, spineMiscIndex, strayVoice, voiceIndex: { adventure, character } };
}

function buildThumbIndexes(rels) {
  const episodeThumbsByEvent = {};
  const episodeThumbsByChapter = {};
  const questThumbs = [];
  const eventBanners = {};
  const addEpThumb = (eid, rel, chapter) => {
    const k = String(eid);
    (episodeThumbsByEvent[k] || (episodeThumbsByEvent[k] = [])).push(rel);
    if (chapter != null) (episodeThumbsByChapter[k + ':' + chapter] || (episodeThumbsByChapter[k + ':' + chapter] = [])).push(rel);
  };
  for (const rel of rels) {
    let m;
    if ((m = rel.match(/^episodethumbnails_[a-z0-9_()]+\/(.+)_[0-9a-f]{16,}\.bundle$/))) {
      const nm = m[1];
      let mm;
      if ((mm = nm.match(/^ep_eventstill_(\d+)_/))) addEpThumb(mm[1], rel);
      else if ((mm = nm.match(/^img_episode_side_scenario_(\d+)_(\d+)$/))) addEpThumb(mm[1], rel, Number(mm[2]));
      else if ((mm = nm.match(/^img_episode_side_scenario_(\d+)_/))) addEpThumb(mm[1], rel);
      else if ((mm = nm.match(/^img_episode_main_scenario_chapter_thumbnail_big_(\d+)_(\d+)$/))) addEpThumb(25000 + Number(mm[1]), rel, Number(mm[2]));
      else if ((mm = nm.match(/^img_episode_main_scenario_chapter_thumbnail_big_(\d+)$/))) addEpThumb(25001, rel, Number(mm[1]));
    } else if ((m = rel.match(/^questthumbnails_[a-z0-9_()]+\/(.+)_[0-9a-f]{16,}\.bundle$/))) {
      questThumbs.push({ name: m[1], rel });
      const qm = m[1].match(/^img_quest_top_(\d+)$/);
      if (qm) addEpThumb(qm[1], rel);
    } else if ((m = rel.match(/^events_assets_events\/(.+)_[0-9a-f]{16,}\.bundle$/))) {
      const nm = m[1];
      const em = nm.match(/^(\d+)_/) || nm.match(/^logo_event_(\d+)$/) || nm.match(/^img_quest_top_(\d+)$/) || nm.match(/_score_attack(?:_boss)?_(\d+)$/);
      (eventBanners[em ? em[1] : 'misc'] || (eventBanners[em ? em[1] : 'misc'] = [])).push(rel);
    }
  }
  const questThumbRel = {};
  for (const q of questThumbs) if (!questThumbRel[q.name]) questThumbRel[q.name] = q.rel;
  return { episodeThumbsByEvent, episodeThumbsByChapter, questThumbs, questThumbRel, eventBanners };
}

function buildVfxNameMap(rels, catRe) {
  const map = {};
  for (const rel of rels) {
    if (!catRe.test(rel)) continue;
    const n = bundleName(rel).toLowerCase();
    if (!map[n]) map[n] = rel;
  }
  return map;
}

function catalogIndexes(internalIds) {
  const rels = new Set();
  for (const id of internalIds) {
    if (typeof id !== 'string' || !id.endsWith('.bundle')) continue;
    const rel = mapPath(id);
    if (rel) rels.add(rel);
  }

  const sceneAssetIndex = buildSceneAssetIndex(rels);
  const sharedIndex = [...rels].filter((rel) => SHARED_KEEP.some((fn) => fn(rel.replace(APP_PREFIX, '')))).sort();

  return {
    assetIndex: buildAssetIndex(rels),
    sceneAssetIndex,
    sharedIndex,
    vfxAllRels: [...rels].filter((rel) => VFX_DL_RE.test(rel)).sort(),
    missionUiRels: [...rels].filter((rel) => MISSION_UI_RE.test(rel)).sort(),
    uiSpriteRels: [...rels].filter((rel) => UI_SPRITE_RE.test(rel) && !MISSION_UI_RE.test(rel)).sort(),
    uiPanelRels: [...rels].filter((rel) => UI_PANEL_RE.test(rel)).sort(),
    worldMapRels: [...rels].filter((rel) => WORLDMAP_RE.test(rel)).sort(),
    miniGameRels: [...rels].filter((rel) => MINIGAME_RE.test(rel)).sort(),
    battleFieldRels: [...rels].filter((rel) => BATTLEFIELD_RE.test(rel)).sort(),
    gachaBgRels: [...rels].filter((rel) => GACHA_BG_RE.test(rel)).sort(),
    systemVoiceRel: [...rels].filter((rel) => /^systemvoice_assets_/.test(rel)).sort()[0] || null,
    gachaExtraRels: [...rels].filter((rel) => GACHA_ANY_RE.test(rel) && !GACHA_BG_RE.test(rel) && !VFX_DL_RE.test(rel) && !SHARED_KEEP.some((fn) => fn(rel.replace(APP_PREFIX, '')))).sort(),
    vfxByName: buildVfxNameMap(rels, /^vfx_assets_vfx\//),
    vfxseByName: buildVfxNameMap(rels, /^vfxse_assets_vfxse\//),
    builtinRels: [...rels].filter((rel) => APP_PREFIX.test(rel)).sort(),
    otherModelIds: buildOtherModelIds(rels),
    globalAssets: buildGlobalAssets(rels),
    bgmTracks: buildBgmTracks(sceneAssetIndex),
    ...buildNamedIndexes(rels),
    ...buildThumbIndexes(rels),
  };
}

function catalogDeps(catalogs) {
  const b64 = utilHelpers && utilHelpers.b64ToBytes;
  const deps = {},
    folder = {},
    matByModel = {},
    matVar = {};
  if (!b64) return { deps, folder, matByModel, matVar };
  const relOf = (s) => {
    const m = mapPath(s);
    return m ? toRel(m) : null;
  };
  const modelRe = /^3dmodels_assets_3dmodels\/(\d+)_/;
  const folderRe = /^Assets\/3DModels\/([^/]+)\//i;
  const matAddrRe = /^Assets\/3DModels\/[^/]+\/(\d+)\//i;
  const matRelRe = /^materialsbundles_assets_assets\/3dmodels\//i;
  for (const cat of catalogs || []) {
    if (!cat || !cat.m_InternalIds || !cat.m_EntryDataString || !cat.m_BucketDataString) continue;
    try {
      const ids = cat.m_InternalIds;
      const eu = b64(cat.m_EntryDataString),
        bu = b64(cat.m_BucketDataString);
      const ku = cat.m_KeyDataString ? b64(cat.m_KeyDataString) : null;
      const eDV = new DataView(eu.buffer, eu.byteOffset, eu.byteLength);
      const bDV = new DataView(bu.buffer, bu.byteOffset, bu.byteLength);
      const kDV = ku ? new DataView(ku.buffer, ku.byteOffset, ku.byteLength) : null;
      const readKey = (off) => {
        if (!kDV) return null;
        const t = ku[off];
        let q = off + 1;
        if (t === 0) {
          const len = kDV.getInt32(q, true);
          q += 4;
          let s = '';
          for (let i = 0; i < len; i++) s += String.fromCharCode(ku[q + i]);
          return s;
        }
        if (t === 1) {
          const len = kDV.getInt32(q, true);
          q += 4;
          let s = '';
          for (let i = 0; i < len; i += 2) s += String.fromCharCode(kDV.getUint16(q + i, true));
          return s;
        }
        return null;
      };
      const ec = eDV.getInt32(0, true);
      if (ec <= 0) continue;
      const fp = (eu.byteLength - 4) / 4 / ec;
      if (!Number.isInteger(fp) || fp < 3) continue;
      const ent = [];
      let p = 4;
      for (let i = 0; i < ec; i++) {
        ent.push({ iid: eDV.getInt32(p, true), depKey: eDV.getInt32(p + 8, true) });
        p += fp * 4;
      }
      const bc = bDV.getInt32(0, true);
      const bk = [];
      const bKeyOff = [];
      p = 4;
      for (let i = 0; i < bc; i++) {
        bKeyOff.push(bDV.getInt32(p, true));
        p += 4;
        const n = bDV.getInt32(p, true);
        p += 4;
        const a = [];
        for (let k = 0; k < n; k++) {
          a.push(bDV.getInt32(p, true));
          p += 4;
        }
        bk.push(a);
      }
      const varKeyRe = /^(\d+)_([A-Za-z][A-Za-z0-9_]*)$/;
      for (let bi = 0; bi < bc; bi++) {
        const key = readKey(bKeyOff[bi]);
        if (typeof key !== 'string' || !varKeyRe.test(key)) continue;
        const bundles = new Set();
        for (const ei of bk[bi]) {
          const e = ent[ei];
          if (!e || e.depKey < 0 || !bk[e.depKey]) continue;
          for (const di of bk[e.depKey]) {
            const r = ent[di] && relOf(ids[ent[di].iid]);
            if (r && matRelRe.test(r)) bundles.add(r);
          }
        }
        if (bundles.size) matVar[key] = [...new Set([...(matVar[key] || []), ...bundles])];
      }
      for (const e of ent) {
        if (e.depKey < 0 || !bk[e.depKey]) continue;
        const self = ids[e.iid];
        const dl = bk[e.depKey].map((x) => ent[x] && ids[ent[x].iid]).filter((s) => typeof s === 'string' && s.endsWith('.bundle'));
        const am = typeof self === 'string' && self.match(matAddrRe);
        if (am) {
          const mats = dl.map(relOf).filter((r) => r && matRelRe.test(r));
          if (mats.length) matByModel[am[1]] = [...new Set([...(matByModel[am[1]] || []), ...mats])];
        }
        let modelId = null;
        for (const d of dl) {
          const r = relOf(d);
          const mm = r && r.match(modelRe);
          if (mm) {
            modelId = mm[1];
            break;
          }
        }
        if (!modelId) continue;
        const fm = typeof self === 'string' && self.match(folderRe);
        if (fm && !folder[modelId]) folder[modelId] = fm[1];
        const extra = dl
          .map(relOf)
          .filter(Boolean)
          .filter((r) => {
            const mm = r.match(modelRe);
            return !(mm && mm[1] === modelId);
          });
        if (extra.length) deps[modelId] = [...new Set([...(deps[modelId] || []), ...extra])];
      }
    } catch (e) {}
  }
  return { deps, folder, matByModel, matVar };
}
function other2dRels(master, assets) {
  const ai = assets.assetIndex || {};
  const chars = master.characters || {};
  const other3dIds = new Set(assets.otherModelIds || []);
  const known = new Set((master.monsterMaster || []).map((e) => e.id));
  for (const [id, a] of Object.entries(ai)) {
    if (String(id)[0] !== '2' || known.has(id) || (a.model || []).length) continue;
    if ((a.spine || []).length || (a.spinelight || []).length || (a.monstericon || []).length || (a.battleicon || []).length) known.add(id);
  }
  const out = [];
  for (const [id, a] of Object.entries(ai)) {
    if (chars[id] || known.has(id)) continue;
    if (!(a.spine || []).length && !(a.spinelight || []).length) continue;
    const cats = other3dIds.has(id) ? ['spine', 'spinelight'] : ['spine', 'spinelight', 'icon', 'iconlight', 'battleicon', 'monstericon'];
    for (const cat of cats) for (const rel of a[cat] || []) out.push(rel);
  }
  for (const rel of assets.uiSpriteRels || []) out.push(rel);
  for (const rel of assets.uiPanelRels || []) out.push(rel);
  for (const rel of assets.worldMapRels || []) out.push(rel);
  return out;
}

function orphanIconRels(master, assets) {
  const ai = assets.assetIndex || {};
  const chars = master.characters || {};
  const mm = new Set((master.monsterMaster || []).map((e) => String(e.id)));
  const battle = master.battleByModel || {};
  const out = [];
  for (const [id, rels] of Object.entries(assets.iconIndex || {})) {
    if (chars[id] || mm.has(id) || battle[id]) continue;
    const a = ai[id] || {};
    if ((a.model || []).length || (a.spine || []).length || (a.spinelight || []).length) continue;
    for (const rel of rels) out.push(rel);
  }
  return out;
}

function orphanMiscRels(master, assets) {
  const out = [];
  const sceneIllust = master.homeIndex && master.homeIndex.sceneIllust ? master.homeIndex.sceneIllust : [];
  const illustIds = new Set(sceneIllust.map((e) => String(e.id)));
  for (const [id, rel] of Object.entries(assets.illustVoiceIndex || {})) if (!illustIds.has(String(id))) out.push(rel);
  for (const rel of assets.strayVoice || []) out.push(rel);
  const chibiUsed = new Set();
  for (const c of Object.values(master.characters || {})) {
    if (c.chibiIconId) chibiUsed.add(String(c.chibiIconId));
    for (const it of c.itemIconIds || []) chibiUsed.add(String(it));
  }
  for (const em of master.monsterMaster || []) for (const cid of em.chibiIconIds || []) chibiUsed.add(String(cid));
  for (const [id, rel] of Object.entries(assets.chibiIndex || {})) if (!chibiUsed.has(String(id))) out.push(rel);
  const bgNames = new Set(master.sceneBgNames || []);
  for (const e of (master.homeIndex && master.homeIndex.background) || []) if (e.bg) bgNames.add(e.bg);
  for (const e of sceneIllust) {
    if (e.still) bgNames.add(e.still);
    if (e.stillAdult) bgNames.add(e.stillAdult);
  }
  for (const [name, sub] of Object.entries(assets.sceneAssetIndex || {})) if (/^bg_eventstill_/.test(name) && !bgNames.has(name)) out.push(sub);
  return out;
}

function awakenItemIds(monsterMaster) {
  const out = new Set();
  for (const em of monsterMaster || []) if (em && em.awakenItemId) out.add(em.awakenItemId);
  return out;
}

function isAwakenOwner(item, monsterName) {
  return !!item && !!monsterName && item.name.replace(/の覚醒結晶$/, '') === monsterName;
}

function ownedAwakenItemIds(monsterMaster, itemMaster) {
  const byId = {};
  for (const it of itemMaster || []) byId[it.id] = it;
  const out = new Set();
  for (const em of monsterMaster || []) if (em && em.awakenItemId && isAwakenOwner(byId[em.awakenItemId], em.name)) out.add(em.awakenItemId);
  return out;
}
function strayCardImageRels(master, assets) {
  const usedKeys = new Set();
  for (const [eid] of Object.entries(master.eventIndex || {})) usedKeys.add(String(eid));
  for (const [questKey, q] of Object.entries(master.questIndex || {})) {
    usedKeys.add(String(q.event));
    usedKeys.add(String(questKey));
  }
  const out = [];
  for (const [key, rels] of Object.entries(assets.eventBanners || {})) if (!usedKeys.has(String(key))) for (const rel of rels) out.push(rel);
  const cardThumbs = new Set();
  for (const nm of Object.values(master.questThumbsByEvent || {}).flat()) {
    const rel = (assets.questThumbRel || {})[nm];
    if (rel) cardThumbs.add(rel);
  }
  for (const arr of Object.values(assets.episodeThumbsByEvent || {})) for (const rel of arr) cardThumbs.add(rel);
  for (const arr of Object.values(assets.episodeThumbsByChapter || {})) for (const rel of arr) cardThumbs.add(rel);
  for (const q of assets.questThumbs || []) if (!cardThumbs.has(q.rel)) out.push(q.rel);
  return out;
}

function unlistedItemIconIds(master, assets) {
  const known = new Set();
  for (const it of master.itemMaster || []) {
    known.add(String(it.id));
    known.add(String(it.icon));
  }
  const hi = master.homeIndex || {};
  for (const e of hi.profileIcon || []) {
    known.add(String(e.icon));
    known.add(String(e.id));
  }
  for (const e of [...(hi.background || []), ...(hi.homeBgm || [])]) if (e.icon) known.add(String(e.icon));
  return Object.keys(assets.itemIndex || {}).filter((id) => !known.has(String(id)));
}

function itemIconOwners(characters) {
  const out = {};
  for (const [folderKey, det] of Object.entries(characters || {})) for (const ic of (det && det.itemIconIds) || []) if (!out[ic]) out[ic] = folderKey;
  return out;
}
function itemIconOwnerCounts(characters) {
  const out = {};
  for (const det of Object.values(characters || {})) for (const ic of (det && det.itemIconIds) || []) out[ic] = (out[ic] || 0) + 1;
  return out;
}
function charSkillEffects(master, assets, charId) {
  const skills = (master.charSkills || {})[String(charId)] || [];
  const sm = master.skillMaster || {};
  const shared = new Set(master.sharedEffects || []);
  const vfxByName = assets.vfxByName || {};
  const vfxseByName = assets.vfxseByName || {};
  const seen = new Set();
  const unique = [];
  const sharedOut = [];
  for (const s of skills) {
    const sk = sm[s.skillId];
    if (!sk) continue;
    for (const eff of sk.effects) {
      if (seen.has(eff)) continue;
      seen.add(eff);
      const low = eff.toLowerCase();
      const entry = { effect: eff, skillId: s.skillId, skillName: sk.name, vfxRel: vfxByName[low] || null, seRel: vfxseByName[low] || null };
      (shared.has(eff) ? sharedOut : unique).push(entry);
    }
  }
  return { unique, shared: sharedOut };
}

function skillFxSplit(master, assets) {
  const uniqueRels = new Set();
  const sharedRels = new Set();
  for (const charId of Object.keys(master.charSkills || {})) {
    const e = charSkillEffects(master, assets, charId);
    for (const x of e.unique) {
      if (x.vfxRel) uniqueRels.add(x.vfxRel);
      if (x.seRel) uniqueRels.add(x.seRel);
    }
    for (const x of e.shared) {
      if (x.vfxRel) sharedRels.add(x.vfxRel);
      if (x.seRel) sharedRels.add(x.seRel);
    }
  }
  for (const rel of sharedRels) uniqueRels.delete(rel);
  return { uniqueRels, sharedRels: [...sharedRels].sort() };
}

function compose({ recs, catalogIds, catalogObjs }) {
  const master = masterIndexes(recs || []);
  const assets = catalogIndexes(catalogIds || []);
  const cd = catalogDeps(catalogObjs || []);
  for (const [id, mats] of Object.entries(cd.matByModel || {})) {
    const o = assets.assetIndex[id];
    if (!o) continue;
    o.materials = [...new Set([...(o.materials || []), ...mats])].sort();
  }
  const itemRels = [];
  const counts = itemIconOwnerCounts(master.characters);
  const soleOwned = (it) => counts[it.icon] === 1 || counts[it.id] === 1;
  const byMonster = ownedAwakenItemIds(master.monsterMaster, master.itemMaster);
  const soleEquip = (it) => !!(it.ownerCharId && ((master.characters || {})[it.ownerCharId] || {}).episodes);
  const sharedItemIconMap = {};
  for (const it of master.itemMaster || []) {
    if (soleOwned(it) || soleEquip(it) || byMonster.has(it.id)) continue;
    const rel = assets.itemIndex[it.icon] || assets.itemIndex[it.id];
    if (!rel) continue;
    itemRels.push(rel);
    sharedItemIconMap[it.icon] = 1;
    sharedItemIconMap[it.id] = 1;
  }
  assets.sharedItemIconMap = sharedItemIconMap;
  const equipIconsByChar = {};
  for (const it of master.itemMaster || []) {
    if (!soleEquip(it)) continue;
    const rel = assets.itemIndex[it.icon] || assets.itemIndex[it.id];
    if (rel) (equipIconsByChar[it.ownerCharId] || (equipIconsByChar[it.ownerCharId] = [])).push(rel);
  }
  assets.equipIconsByChar = equipIconsByChar;
  for (const id of unlistedItemIconIds(master, assets)) {
    const rel = assets.itemIndex[id];
    if (rel) itemRels.push(rel);
  }
  const skillFx = skillFxSplit(master, assets);
  assets.skillFxSharedRels = skillFx.sharedRels;
  assets.skillFxUniqueRels = [...skillFx.uniqueRels].sort();
  const extra = [...itemRels, ...other2dRels(master, assets), ...orphanIconRels(master, assets), ...orphanMiscRels(master, assets), ...strayCardImageRels(master, assets)];
  if (extra.length) assets.sharedIndex = [...new Set([...(assets.sharedIndex || []), ...extra])].sort();
  return { master, assets, modelDeps: cd.deps, modelFolder: cd.folder, matVariation: cd.matVar };
}

const api = {
  masterIndexes,
  catalogIndexes,
  catalogDeps,
  compose,
  charSkillEffects,
  skillFxSplit,
  itemIconOwners,
  itemIconOwnerCounts,
  unlistedItemIconIds,
  awakenItemIds,
  isAwakenOwner,
  ownedAwakenItemIds,
  other2dRels,
  orphanIconRels,
  orphanMiscRels,
  strayCardImageRels,
  ITEM_TABLES,
};
export const buildIndexes = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
