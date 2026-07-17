'use strict';
(function () {
  const num = (x) => (typeof x === 'bigint' ? Number(x) : x);
  const str = (x) => (typeof x === 'string' && x.trim() ? x : undefined);
  const int = (x) => (typeof x === 'number' ? x : (typeof x === 'bigint' ? Number(x) : undefined));

  function masterIndexes(recs) {
    // master は MessagePack-CSharp Union `[tag,payload]`。tag=Union番号。payload位置=各クラスの[Key(N)]。
    // 物語階層＝EventMaster(tag18) → LocationMaster(tag19,章) → LocationNodeMaster(tag20,話)。
    // 話の題名/scene資産は EpisodeMaster(tag32) が持ち、node.EpisodeMasterId(p[5])で引く。
    const characterDetails = {}, sceneMeta = {}, nameMap = {};
    const eventMap = {}, locMap = {};
    for (const r of recs) {
      if (!Array.isArray(r)) continue;
      const t = num(r[0]); const p = r[1];
      if (!Array.isArray(p)) continue;
      if (t === 4) {
        const id = String(num(p[0]));
        const bwh = [int(p[17]), int(p[18]), int(p[19])];
        // p[8] = JSON string of equipped 3D weapons: [{Slot,WeaponId,AssetConfiguration:{Variation,Scale}}]
        let weapons;
        try {
          const wj = typeof p[8] === 'string' ? JSON.parse(p[8]) : null;
          if (Array.isArray(wj) && wj.length) weapons = wj.map((w) => ({ slot: str(w.Slot), weaponId: w.WeaponId != null ? String(w.WeaponId) : null, variation: (w.AssetConfiguration && str(w.AssetConfiguration.Variation)) || 'Default', scale: (w.AssetConfiguration && Number(w.AssetConfiguration.Scale)) || 1 })).filter((w) => w.weaponId);
        } catch (e) {}
        characterDetails[id] = {
          name: str(p[3]), title: str(p[4]), intro: str(p[14]), race: str(p[15]), groupId: int(p[10]), rankId: int(p[9]),
          bwh: bwh.every((x) => typeof x === 'number') ? bwh : undefined,
          likes: str(p[20]), dislikes: str(p[21]), specialty: str(p[22]), profile1: str(p[23]), profile2: str(p[24]),
          chibiIconId: int(p[25]) != null ? String(int(p[25])) : undefined,
          itemIconIds: [...new Set([p[25], p[31], p[34]].map((x) => (int(x) != null ? String(int(x)) : null)).filter(Boolean))],
          weapons: (weapons && weapons.length) ? weapons : undefined,
        };
        nameMap[id] = { name: str(p[3]) || '(不明)', title: str(p[4]) || '' };
      } else if (t === 32) {
        // EpisodeMaster: EpisodeOrderName(p1=「第N話」)・Title(p2=実題)・SceneAssetIds(p8)＋AdultSceneAssetIds(p9=続き/R18)
        sceneMeta[num(p[0])] = { label: p[1], title: p[2], binIds: [...(p[8] || []), ...(p[9] || [])].map((x) => String(num(x))) };
      } else if (t === 18) {
        // EventMaster: Id/Name/Type(EventTypes)/Order
        eventMap[num(p[0])] = { id: num(p[0]), name: str(p[1]) || ('イベント' + num(p[0])), type: num(p[2]), order: int(p[14]) || 0 };
      } else if (t === 19) {
        // LocationMaster(章): Id/EventMasterId/Name/GroupOrder/InGroupOrder
        locMap[num(p[0])] = { id: num(p[0]), eventId: num(p[1]), name: str(p[3]) || '', groupOrder: int(p[4]) || 0, inGroupOrder: int(p[5]) || 0 };
      }
    }
    const binIdsOf = (sceneId) => { const sc = sceneMeta[sceneId]; return sc && sc.binIds && sc.binIds.length ? sc.binIds : [String(sceneId)]; };

    const charMap = {};
    for (const [id, nm] of Object.entries(nameMap)) charMap[id] = { id: Number(id), name: nm.name, title: nm.title, episodes: [] };
    for (const r of recs) {
      if (!Array.isArray(r) || num(r[0]) !== 33) continue; const p = r[1]; if (!Array.isArray(p)) continue;
      const epId = num(p[0]), sceneId = num(p[1]), base = String(num(p[3])); const sc = sceneMeta[sceneId] || {};
      if (!charMap[base]) charMap[base] = { id: Number(base), name: '(不明)', title: '', episodes: [] };
      charMap[base].episodes.push({ episodeMasterId: String(epId), order: num(p[2]), label: sc.label || null, title: sc.title || null, sceneBinIds: binIdsOf(sceneId) });
    }
    const characterIndex = {};
    for (const [id, c] of Object.entries(charMap)) { if (!c.episodes.length) continue; c.episodes.sort((a, b) => (a.order || 0) - (b.order || 0)); characterIndex[id] = c; }

    // tag20=LocationNodeMaster(話)。EpisodeMasterId(p[5])を持つnode＝物語有り（無し＝バトルのみ→除外）。
    // 1イベント(=部/期間限定イベント)配下の各章(LocationMaster)のnodeをEventMaster単位に束ねる（章バラけを解消）。
    // カテゴリ＝EventType: MainQuest(1)/MainStory(24)/SideStory(25)＝常設メイン、他の物語持ちイベント＝期間限定イベント。
    const MAIN_EVENT_TYPES = new Set([1, 24, 25]);
    const evGroups = {};
    for (const r of recs) {
      if (!Array.isArray(r) || num(r[0]) !== 20) continue; const p = r[1]; if (!Array.isArray(p)) continue;
      const epId = p[5] != null ? num(p[5]) : null; if (epId == null || !sceneMeta[epId]) continue;
      const loc = locMap[num(p[1])]; if (!loc) continue;
      const ev = eventMap[loc.eventId]; if (!ev) continue;
      const g = evGroups[ev.id] || (evGroups[ev.id] = { event: ev.id, name: ev.name, type: ev.type, cat: MAIN_EVENT_TYPES.has(ev.type) ? 'main' : 'event', order: ev.order, nodes: [] });
      const sc = sceneMeta[epId];
      g.nodes.push({ questEpisodeId: String(num(p[0])), locId: loc.id, chapter: loc.name, gOrder: loc.groupOrder, igOrder: loc.inGroupOrder, nOrder: num(p[2]), label: sc.label || null, title: sc.title || null, sceneBinIds: binIdsOf(epId) });
    }
    const questIndex = {};
    for (const [eid, g] of Object.entries(evGroups)) {
      if (!g.nodes.length) continue;
      g.nodes.sort((a, b) => (a.gOrder - b.gOrder) || (a.igOrder - b.igOrder) || (a.nOrder - b.nOrder));
      g.episodes = g.nodes.map((n, i) => ({ questEpisodeId: n.questEpisodeId, order: i + 1, chapter: n.chapter, chapterId: n.locId, label: n.label, title: n.title, sceneBinIds: n.sceneBinIds }));
      delete g.nodes;
      questIndex[eid] = g;
    }

    // tag145=PaidEpisodeMaster（特別エピソード・有料/アイテム解放）。Id(p0)/EpisodeMasterId(p1)/ActivateItemMasterId(p2)/AssetId(p4=ep_eventstill_<eid>)/Type(p8)。
    // 話本体はEpisodeMasterId(p1)でEpisodeMasterを引く。DLは episodeMasterId で getPaidEpisodeDetails/getSpecialEpisodeDetails を叩く（解放済みのみ・下記collection）。
    const SPECIAL_SUBTYPE = { 0: 'エクストラエピソード', 1: 'イベントエピソード', 2: 'スペシャルエピソード' };
    const specialMap = {};
    for (const r of recs) {
      if (!Array.isArray(r) || num(r[0]) !== 145) continue; const p = r[1]; if (!Array.isArray(p)) continue;
      const paidMasterId = String(num(p[0])); const episodeMasterId = num(p[1]);
      const still = String(p[4] || ''); const m = still.match(/eventstill_(\d+)_/); const eid = m ? m[1] : 'misc';
      const sc = sceneMeta[episodeMasterId] || {};
      const subType = SPECIAL_SUBTYPE[num(p[8])] || '特別エピソード';
      const unlockItem = int(p[2]) != null ? String(int(p[2])) : null;
      const ev = specialMap[eid] || (specialMap[eid] = { event: eid, name: sc.title || sc.label || ('特別エピソード' + eid), subType, episodes: [] });
      ev.episodes.push({ paidMasterId, episodeMasterId: String(episodeMasterId), order: num(p[5]) || 0, label: sc.label || null, title: sc.title || null, subType, unlockItem, sceneBinIds: binIdsOf(episodeMasterId) });
    }
    const eventIndex = {};
    for (const [e, ev] of Object.entries(specialMap)) { if (!ev.episodes.length) continue; ev.episodes.sort((a, b) => (a.order || 0) - (b.order || 0)); if (ev.episodes[0]) ev.name = ev.episodes[0].title || ev.episodes[0].label || ev.name; eventIndex[e] = ev; }

    const nameToChar = {};
    for (const [id, d] of Object.entries(characterDetails)) if (d.name) (nameToChar[d.name] || (nameToChar[d.name] = [])).push(id);
    const illustVoiceByChar = {};
    for (const r of recs) {
      if (!Array.isArray(r) || num(r[0]) !== 36) continue; const p = r[1]; if (!Array.isArray(p) || num(p[3]) !== 4) continue;
      let lines = null;
      for (const v of p) if (Array.isArray(v) && v.length && Array.isArray(v[0]) && typeof v[0][0] === 'string' && /^[cs]_/.test(v[0][0])) { lines = v; break; }
      if (!lines || !lines.length) continue;
      const nm = str(p[1]) || ''; const chars = nameToChar[nm.replace(/^【[^】]*】/, '').trim()]; if (!chars) continue;
      const entry = { ivId: String(num(p[0])), name: nm, still: str(p[4]), lines: lines.map((l) => ({ voiceId: l[0], text: l[1], order: num(l[2]) })) };
      for (const cid of chars) (illustVoiceByChar[cid] || (illustVoiceByChar[cid] = [])).push(entry);
    }

    return { characterDetails, characterIndex, questIndex, eventIndex, illustVoiceByChar };
  }

  function mapPath(id) {
    let m;
    if ((m = id.match(/^PariPari(?:Public)?Remote\/(.+)$/))) return 'Assets/WebGL/' + m[1];
    if ((m = id.match(/^\{UnityEngine\.AddressableAssets\.Addressables\.RuntimePath\}\/WebGL\/(.+)$/))) return 'WebGL/StreamingAssets/aa/WebGL/' + m[1];
    return null;
  }
  const A_FRIENDLY = {
    '3dmodels_assets_3dmodels': 'model', 'materialsbundles_assets_assets': 'materials',
    'spines_assets_spines': 'spine', 'spineslight_assets_spineslight': 'spinelight',
    'charactericons_assets_charactericons': 'icon', 'charactericonslight_assets_charactericonslight': 'iconlight',
    'battlecharactersicons_assets_battlecharactersicons': 'battleicon', 'monstericons_assets_monstericons': 'monstericon',
    'characterillustrationx_assets_characterillustrationx': 'illustx', 'stills_assets_stills': 'still',
    'backgrounds_assets_backgrounds': 'cg_bg', 'chibiicons_assets_chibiicons': 'chibiicon',
    'illustrationvoice_assets_illustrationvoice': 'illustvoice',
  };
  const A_SKIP = new Set([
    'adventurevoice_assets_adventurevoice', 'charactervoices_assets_charactervoices',
    'events_assets_events', 'obstacleassets_assets_obstacles', 'loginbonus_assets_loginbonus',
    'itemicons_assets_itemicons', 'vfxtextureassets_assets_assets', 'tutorialassets_assets_assets',
    'tutorialassets_assets_spines', '3dmodels_assets_assets',
  ]);
  const SHARED_KEEP = [
    (r) => /^backgrounds_assets_backgrounds\/bg_adventure_/.test(r),
    (r) => /^bgm_assets_bgm\//.test(r),
    (r) => /^se_assets_/.test(r),
    (r) => /^builtinaudio\(uncompressed\)_assets_/.test(r),
    (r) => /^fontassets_assets_/.test(r),
    (r) => /vfxmaterialassets_assets_.*\/advmaterials\//.test(r),
    (r) => /^scenariolayouts_assets_/.test(r),
    (r) => /_unitybuiltinshaders_/.test(r),
    (r) => /^uispritesassets_assets_adventuresprites/.test(r),
    (r) => /_emotionsprites_/.test(r),
    (r) => /^uicomponentspartsassets_assets_scenario\//.test(r),
    (r) => /nativeassets\)_scenes_scenario/.test(r),
  ];

  function catalogIndexes(internalIds, cdnBaseCandidates) {
    const rels = new Set(), subs = new Set();
    for (const id of internalIds) {
      if (typeof id !== 'string' || !id.endsWith('.bundle')) continue;
      const sub = mapPath(id); if (!sub) continue;
      subs.add(sub);
      rels.add(sub.replace(/^Assets\/WebGL\//, ''));
    }
    const catPrefix = /^([a-z0-9()]+_assets_[a-z0-9()]+)\//;
    const HERO_MARK = [/^3dmodels_assets_3dmodels\/(\d{8})_/, /^spines_assets_spines\/(\d{8})_/, /^charactericons_assets_charactericons\/(\d{8})_/];
    const heroSet = new Set();
    for (const rel of rels) for (const re of HERO_MARK) { const m = rel.match(re); if (m) heroSet.add(m[1]); }

    const assetIndex = {};
    for (const rel of rels) {
      const cm = rel.match(catPrefix); if (!cm) continue;
      const prefix = cm[1]; if (A_SKIP.has(prefix)) continue;
      const friendly = A_FRIENDLY[prefix] || prefix;
      const ids = new Set((rel.match(/\d{8}/g) || []).filter((t) => heroSet.has(t)));
      for (const id of ids) { const o = (assetIndex[id] || (assetIndex[id] = {})); (o[friendly] || (o[friendly] = [])).push(rel); }
    }
    for (const id of Object.keys(assetIndex)) for (const k of Object.keys(assetIndex[id])) assetIndex[id][k].sort();

    const sceneAssetIndex = {};
    for (const sub of subs) {
      const rel = sub.replace(/^Assets\/WebGL\//, '');
      let m;
      if ((m = rel.match(/^backgrounds_assets_backgrounds\/(.+)_[0-9a-f]{32}\.bundle$/))) sceneAssetIndex[m[1]] = sub;
      else if ((m = rel.match(/^stills_assets_stills\/(.+)_[0-9a-f]{32}\.bundle$/))) sceneAssetIndex[m[1]] = sub;
      else if ((m = rel.match(/^bgm_assets_bgm\/(.+)_[0-9a-f]{32}\.bundle$/))) sceneAssetIndex[m[1]] = sub;
    }

    const sharedSet = new Set();
    for (const sub of subs) {
      const rel = sub.replace(/^Assets\/WebGL\//, '').replace(/^WebGL\/StreamingAssets\/aa\/WebGL\//, '');
      if (SHARED_KEEP.some((fn) => fn(rel))) sharedSet.add(sub);
    }
    const sharedIndex = [...sharedSet].sort();

    const adventure = {}, character = {}, chibiIndex = {}, itemIndex = {}, illustVoiceIndex = {};
    for (const rel of rels) {
      let m;
      if ((m = rel.match(/^adventurevoice_assets_adventurevoice\/(\d+)_([0-9a-f]{32})\.bundle$/))) adventure[m[1]] = m[2];
      else if ((m = rel.match(/^charactervoices_assets_charactervoices\/(\d+)_([0-9a-f]{32})\.bundle$/))) character[m[1]] = m[2];
      else if ((m = rel.match(/^chibiicons_assets_chibiicons\/(\d+)_[0-9a-f]{32}\.bundle$/))) chibiIndex[m[1]] = rel;
      else if ((m = rel.match(/^itemicons_assets_itemicons\/(\d+)_[0-9a-f]{32}\.bundle$/))) itemIndex[m[1]] = rel;
      else if ((m = rel.match(/^illustrationvoice_assets_illustrationvoice\/(\d+)_[0-9a-f]{32}\.bundle$/))) illustVoiceIndex[m[1]] = rel;
    }
    const voiceIndex = { cdnBaseCandidates: cdnBaseCandidates || [], adventure, character };

    // shared 3D assets referenced by all character models (not per-character): the mouth expression atlas
    const globalAssets = {};
    for (const rel of rels) { const m = rel.match(/^materialsbundles_assets_assets\/mouthmaterials_[0-9a-f]{16,}\.bundle$/); if (m) { globalAssets.mouthAtlas = rel; break; } }

    return { assetIndex, sceneAssetIndex, sharedIndex, voiceIndex, chibiIndex, itemIndex, illustVoiceIndex, globalAssets };
  }

  const api = { masterIndexes, catalogIndexes };
  globalThis.TP_BUILD = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
