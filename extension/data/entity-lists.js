import { DIRS } from '../core/constants.js';
import { assetStore } from './asset-store.js';
import { PLACE, subFor } from '../core/placement.js';
import { bundleName } from '../core/paths.js';
import { staticsList } from './statics.js';
import { buildIndexes as BUILD_MOD } from './build-indexes.js';
import { localInventory } from './inventory.js';
import { ensureIndexes } from './index-store.js';
import { assetRefs } from './asset-refs.js';

const resolveVariationMaterial = assetRefs.resolveVariationMaterial;

function weaponOwners(x) {
  const out = new Map();
  const note = (wid, owner, kind) => {
    if (!wid || owner == null) return;
    const k = String(wid);
    let r = out.get(k);
    if (!r) out.set(k, (r = new Map()));
    if (!r.has(String(owner))) r.set(String(owner), kind);
  };
  for (const [cid, c] of Object.entries(x.master.characters || {})) if ((c.episodes || []).length) for (const w of c.weapons || []) note(w.weaponId, cid, 'char');
  for (const em of x.master.monsterMaster || []) for (const w of em.weapons || []) note(w.weaponId, em.id, 'monster');
  for (const [mid, b] of Object.entries(x.master.battleByModel || {})) for (const w of b.weapons || []) note(w.weaponId, mid, 'monster');
  return out;
}

function soleWeaponOwner(owners, weaponId) {
  const r = owners.get(String(weaponId));
  if (!r || r.size !== 1) return null;
  const [id, kind] = [...r][0];
  return { kind, id };
}

function unlistedMonsters(x) {
  const ai = x.assets.assetIndex || {};
  const known = new Set((x.master.monsterMaster || []).map((e) => e.id));
  const battle = x.master.battleByModel || {};
  const nameSelf = x.master.nameByModel || {};
  const nameBase = x.master.nameByBaseModel || {};
  const out = [];
  for (const [id, a] of Object.entries(ai)) {
    if (String(id)[0] !== '2' || known.has(id) || (a.model || []).length) continue;
    if (!((a.spine || []).length || (a.spinelight || []).length || (a.monstericon || []).length || (a.battleicon || []).length)) continue;
    const b = battle[id] || {};
    out.push({
      id: String(id),
      speciesId: String(id),
      baseModel: String(id),
      name: nameSelf[id] || nameBase[id] || '',
      variation: b.variation || 'Default',
      scale: b.scale || 1,
      attachments: b.attachments,
      weapons: b.weapons,
      likes: '',
      dislikes: '',
      desc: '',
      awakenItemId: null,
      chibiIconIds: [],
      unlisted: true,
    });
  }
  return out.sort((a, b) => (a.id > b.id ? 1 : -1));
}

const byIdAsc = (a, b) => (a.id > b.id ? 1 : -1);

const modelDisplayName = (x, id) => (x.master.battleByModel[id] || {}).name || x.master.nameByModel[id] || x.master.nameByBaseModel[id] || '';

const indexByName = (list) => {
  const m = new Map();
  for (const em of list) {
    if (!em.name) continue;
    if (!m.has(em.name)) m.set(em.name, []);
    m.get(em.name).push(String(em.id));
  }
  return m;
};

function altModelsByMonster(x) {
  const listed = x.master.monsterMaster || [];
  const unlisted = unlistedMonsters(x);
  const listedByName = indexByName(listed);
  const unlistedByName = indexByName(unlisted);
  const own = new Set([...listed, ...unlisted].map((e) => String(e.id)));
  const ai = x.assets.assetIndex || {};
  const byMonster = new Map();
  const linked = new Set();
  for (const id of x.assets.otherModelIds || []) {
    const key = String(id);
    if (own.has(key) || !((ai[key] || {}).model || []).length) continue;
    const name = modelDisplayName(x, key);
    const owners = listedByName.get(name) || unlistedByName.get(name);
    if (!owners || owners.length !== 1) continue;
    if (!byMonster.has(owners[0])) byMonster.set(owners[0], []);
    byMonster.get(owners[0]).push(key);
    linked.add(key);
  }
  return { byMonster, linked };
}

export async function otherList() {
  const x = await ensureIndexes();
  const ai = x.assets.assetIndex || {};
  const chars = x.master.characters || {};
  const battle = x.master.battleByModel || {};
  const modelDeps = x.meta.modelDeps || {};
  const modelFolder = x.meta.modelFolder || {};
  const matVar = x.meta.matVariation || {};
  const mouthRel = (x.assets.globalAssets && x.assets.globalAssets.mouthAtlas) || null;
  const nameSelf = x.master.nameByModel || {};
  const nameBase = x.master.nameByBaseModel || {};

  const weaponIds = new Set();
  const ownerByWeapon = {};
  const noteWeapons = (owner, ws) => {
    for (const w of ws || []) {
      if (!w.weaponId) continue;
      weaponIds.add(String(w.weaponId));
      if (owner && !ownerByWeapon[w.weaponId]) ownerByWeapon[w.weaponId] = owner;
    }
  };
  for (const c of Object.values(chars)) noteWeapons(c.name, c.weapons);
  for (const b of Object.values(battle)) noteWeapons(b.name, b.weapons);

  const weaponName = {};
  for (const e of x.master.equipWeapons || [])
    for (const w of e.weapons || []) {
      if (!w.weaponId) continue;
      weaponIds.add(String(w.weaponId));
      if (!weaponName[w.weaponId]) weaponName[w.weaponId] = e.name;
    }

  const resolveWeapons = (ws) =>
    (ws || [])
      .map((w) => {
        const wa = ai[String(w.weaponId)] || {};
        const model = (wa.model || [])[0] || null;
        return model ? { model, materials: resolveVariationMaterial(matVar, String(w.weaponId), w.variation, wa.materials || []), slot: w.slot || 'wp_2', scale: w.scale || 1 } : null;
      })
      .filter(Boolean);

  const entry = ({ dispId, modelId, category, name, variation, scale, attachments }) => {
    const a = ai[modelId] || {};
    const materials = a.materials || [];
    const wcfg = (battle[modelId] && battle[modelId].weapons) || (chars[modelId] && chars[modelId].weapons) || null;
    const weapons = wcfg ? resolveWeapons(wcfg) : [];
    const humanoid = weapons.length > 0 || category === 'boss' || category === 'ally';
    return {
      id: dispId,
      modelId,
      category,
      name: name || nameSelf[modelId] || nameBase[modelId] || null,
      variation: variation || 'Default',
      scale: scale || 1,
      attachments: attachments || undefined,
      attachmentColors: (chars[modelId] || {}).attachmentColors,
      desc: '',
      model: (a.model || [])[0] || null,
      material: resolveVariationMaterial(matVar, modelId, variation || 'Default', materials),
      materials,
      icon: (a.monstericon || [])[0] || null,
      battleIcon: (a.battleicon || [])[0] || null,
      weapons,
      mouth: humanoid ? mouthRel : null,
      meshDeps: modelDeps[modelId] || [],
    };
  };

  const owners = weaponOwners(x);
  const listedMonsters = new Set([...(x.master.monsterMaster || []).map((e) => String(e.id)), ...unlistedMonsters(x).map((e) => String(e.id))]);
  const isMonster = new Set((x.master.monsterMaster || []).map((e) => e.id));
  for (const s of x.master.monsterSpecies || []) isMonster.add(String(s.model));
  const { linked } = altModelsByMonster(x);

  const out = [];
  for (const id of x.assets.otherModelIds || []) {
    if (isMonster.has(String(id)) || linked.has(String(id))) continue;
    const a = ai[id] || {};
    if (!(a.model || []).length) continue;
    const b = battle[id];
    const c = chars[id];
    const fld = modelFolder[id];
    if (b) out.push(entry({ dispId: id, modelId: id, category: 'boss', name: b.name, variation: b.variation, scale: b.scale, attachments: b.attachments }));
    else if ((a.monstericon || []).length) out.push(entry({ dispId: id, modelId: id, category: 'monster' }));
    else if (weaponIds.has(id) || fld === 'Weapons') {
      const sole = soleWeaponOwner(owners, id);
      if (sole && (sole.kind === 'char' || listedMonsters.has(String(sole.id)))) continue;
      out.push(entry({ dispId: id, modelId: id, category: 'weapon', name: weaponName[id] || (ownerByWeapon[id] ? ownerByWeapon[id] + 'の武器' : null) }));
    } else if (c || fld === 'Characters') out.push(entry({ dispId: id, modelId: id, category: 'ally', name: c ? (c.title ? (c.name || '') + c.title : c.name) || null : null }));
    else out.push(entry({ dispId: id, modelId: id, category: 'misc' }));
  }
  return out;
}

const MONSTER_ICON_CATS = ['monstericon', 'battleicon', 'icon', 'iconlight', 'spine', 'spinelight'];

export async function monsterList() {
  const x = await ensureIndexes();
  const ai = x.assets.assetIndex || {};
  const itemIdx = x.assets.itemIndex || {};
  const chibiIdx = x.assets.chibiIndex || {};
  const modelDeps = x.meta.modelDeps || {};
  const matVar = x.meta.matVariation || {};
  const resolveMat = (modelId, variation, materials) => resolveVariationMaterial(matVar, modelId, variation, materials);
  const itemById = {};
  for (const it of x.master.itemMaster || []) itemById[it.id] = it;
  const owners = weaponOwners(x);
  const { byMonster: altByMonster } = altModelsByMonster(x);
  const out = [];
  const seen = new Set();

  for (const em of [...(x.master.monsterMaster || []), ...unlistedMonsters(x)]) {
    if (seen.has(em.id)) continue;
    seen.add(em.id);
    const a = ai[em.id] || {};
    const assets = [];
    const push = (cat, rel, ownerId) => {
      if (!rel || assets.some((v) => v.rel === rel)) return;
      assets.push({ cat, rel, ownerId: ownerId || em.id, id: assetStore.idOf(rel) });
    };
    for (const cat of MONSTER_ICON_CATS) for (const rel of a[cat] || []) push(cat, rel);
    for (const cid of em.chibiIconIds || []) push('chibiicon', chibiIdx[cid]);

    const modelOwner = (a.model || []).length ? em.id : em.baseModel;
    const model = ((ai[modelOwner] || {}).model || [])[0] || null;
    push('model', model, modelOwner);
    const ownMaterials = a.materials || [];
    const baseMaterials = ((ai[em.baseModel] || {}).materials || []).filter((rel) => !ownMaterials.includes(rel));
    for (const rel of ownMaterials) push('materials', rel, em.id);
    for (const rel of baseMaterials) push('materials', rel, em.baseModel);
    for (const rel of modelDeps[modelOwner] || []) push('meshdep', rel, modelOwner);

    const weapons = [];
    for (const w of em.weapons || []) {
      const wa = ai[String(w.weaponId)] || {};
      const wm = (wa.model || [])[0];
      if (!wm) continue;
      const wmat = resolveMat(String(w.weaponId), w.variation, wa.materials || []);
      const sole = soleWeaponOwner(owners, w.weaponId);
      const wOwner = sole && sole.kind === 'monster' && sole.id === em.id ? em.id : w.weaponId;
      push('model', wm, wOwner);
      push('materials', wmat, wOwner);
      weapons.push({ model: wm, materials: wmat, slot: w.slot || 'wp_2', scale: w.scale || 1 });
    }

    const altModels = [];
    for (const altId of altByMonster.get(String(em.id)) || []) {
      const alt = ai[altId] || {};
      const altModel = (alt.model || [])[0];
      if (!altModel) continue;
      const altMaterials = alt.materials || [];
      push('model', altModel, altId);
      for (const rel of altMaterials) push('materials', rel, altId);
      for (const rel of modelDeps[altId] || []) push('meshdep', rel, altId);
      const battle = x.master.battleByModel[altId] || {};
      altModels.push({ id: altId, model: altModel, materials: altMaterials, material: resolveMat(altId, battle.variation, altMaterials), meshDeps: modelDeps[altId] || [] });
    }

    const item = em.awakenItemId ? itemById[em.awakenItemId] : null;
    if (BUILD_MOD.isAwakenOwner(item, em.name)) push('awakenicon', itemIdx[item.icon] || itemIdx[item.id]);

    const materials = [...ownMaterials, ...baseMaterials];
    out.push({
      ...em,
      weapons,
      model,
      materials,
      meshDeps: modelDeps[modelOwner] || [],
      altModels,
      material: resolveMat(em.baseModel, em.variation, materials),
      awakenItem: item ? { id: item.id, name: item.name, desc: item.desc } : null,
      assets,
    });
  }
  return out.sort(byIdAsc);
}

const BUILTIN_LABEL = {
  titlesprites: 'タイトル画面',
  logosprites: 'ロゴ',
  homesprites: 'ホーム画面',
  baseuisprites: '共通UI',
  buttonssprites: 'ボタン',
  headersprites: 'ヘッダー',
  windowsprites: 'ウィンドウ',
  emotionsprites: '感情アイコン',
  equipmentsprites: '装備',
  organizationsprites: '編成',
  shortcutmenusprites: 'ショートカット',
  skilliconsprites: 'スキルアイコン',
  thingsiconsprites: 'アイテムアイコン',
};
const builtinName = (rel) => bundleName(rel).replace(/^builtin\([^)]*\)(\([^)]*\))?_assets_/, '').replace(/^builtin_assets_/, '');

function builtinEntries(x) {
  const out = [];
  for (const rel of x.assets.builtinRels || []) {
    const key = builtinName(rel);
    if (!/sprites$/.test(key)) continue;
    const ref = { rel, id: assetStore.idOf(rel) };
    out.push({ id: 'ui_' + key, name: BUILTIN_LABEL[key] || key, source: 'ui', spine: null, spinelight: null, icon: rel, refs: [ref], ids: [ref.id], spineIds: [], iconIds: [ref.id] });
  }
  return out.sort((a, b) => (a.name > b.name ? 1 : -1));
}

const MISSION_TYPE_LABEL = { 1: 'キャラパネル', 2: 'スチルパネル' };
const MISSION_UI_LABEL = { uispritesassets_assets_missionsprites: 'ミッションUI（共通アトラス）' };

function missionEntries(x) {
  const sceneAssets = x.assets.sceneAssetIndex || {};
  const spineMisc = x.assets.spineMiscIndex || {};
  const toRef = (rel) => ({ rel, id: assetStore.idOf(rel) });
  const mk = (id, name, spineRels, iconRels) => {
    const spineRefs = spineRels.map(toRef);
    const iconRefs = iconRels.map(toRef);
    const refs = [...spineRefs, ...iconRefs];
    return {
      id,
      name,
      source: 'mission',
      spine: spineRels[0] || null,
      spinelight: null,
      icon: iconRels[0] || null,
      refs,
      ids: refs.map((r) => r.id),
      spineIds: spineRefs.map((r) => r.id),
      iconIds: iconRefs.map((r) => r.id),
    };
  };
  const out = [];
  for (const g of x.master.missionGroups || []) {
    const spineRels = [g.effect ? spineMisc[g.effect] : null].filter(Boolean);
    const iconRels = [g.bg ? sceneAssets[g.bg] : null, g.still ? sceneAssets[g.still] : null].filter(Boolean);
    if (!spineRels.length && !iconRels.length) continue;
    const type = MISSION_TYPE_LABEL[g.type];
    out.push(mk('mission_' + g.id, g.name + (type ? `（${type}）` : ''), spineRels, iconRels));
  }
  for (const rel of x.assets.missionUiRels || []) out.push(mk('mission_ui_' + bundleName(rel), MISSION_UI_LABEL[bundleName(rel)] || bundleName(rel), [], [rel]));
  return out;
}

export async function other2dList() {
  const x = await ensureIndexes();
  const ai = x.assets.assetIndex || {};
  const chars = x.master.characters || {};
  const monsters = new Set((x.master.monsterMaster || []).map((e) => e.id));
  for (const e of unlistedMonsters(x)) monsters.add(e.id);
  const nameSelf = x.master.nameByModel || {};
  const nameBase = x.master.nameByBaseModel || {};
  const out = [];
  for (const [id, a] of Object.entries(ai)) {
    if (chars[id] || monsters.has(id)) continue;
    const spine = (a.spine || [])[0] || null;
    const spinelight = (a.spinelight || [])[0] || null;
    if (!spine && !spinelight) continue;
    const icons = [];
    for (const cat of ['icon', 'iconlight', 'battleicon', 'monstericon']) for (const rel of a[cat] || []) icons.push(rel);
    const toRef = (rel) => ({ rel, id: assetStore.idOf(rel) });
    const spineRefs = [spine, spinelight].filter(Boolean).map(toRef);
    const iconRefs = icons.map(toRef);
    const refs = [...spineRefs, ...iconRefs];
    out.push({
      id,
      name: nameSelf[id] || nameBase[id] || '',
      source: nameSelf[id] ? 'model' : nameBase[id] ? 'base' : '',
      spine,
      spinelight,
      icon: (a.monstericon || [])[0] || (a.icon || [])[0] || (a.battleicon || [])[0] || null,
      refs,
      ids: refs.map((r) => r.id),
      spineIds: spineRefs.map((r) => r.id),
      iconIds: iconRefs.map((r) => r.id),
    });
  }
  const statics = (await staticsList()).map((s) => ({ id: s.key, name: s.name, source: s.kind, spine: null, spinelight: null, icon: null, refs: [], ids: [], spineIds: [], iconIds: [], file: s.path }));
  return [...out.sort(byIdAsc), ...builtinEntries(x), ...missionEntries(x), ...statics];
}

function other3dCoreRefs(entry) {
  const out = [];
  if (entry.model) out.push(entry.model);
  if (entry.material) out.push(entry.material);
  for (const d of entry.meshDeps || []) out.push(d);
  for (const w of entry.weapons || []) {
    if (w.model) out.push(w.model);
    if (w.materials) out.push(w.materials);
  }
  if (entry.mouth) out.push(entry.mouth);
  return out;
}

function other3dRefs(entry) {
  const out = other3dCoreRefs(entry);
  for (const rel of entry.materials || []) if (!out.includes(rel)) out.push(rel);
  for (const rel of [entry.icon, entry.battleIcon]) if (rel && !out.includes(rel)) out.push(rel);
  return out;
}

export function other3dReady(entry, have) {
  return localInventory.allPresent(other3dCoreRefs(entry).map(assetStore.idOf), have);
}

export function monsterReady(entry, have) {
  return localInventory.allPresent(
    (entry.assets || []).map((a) => a.id),
    have,
  );
}

export async function other3dStatus(listIn) {
  const list = listIn || (await otherList());
  const refs = new Map();
  for (const e of list) for (const rel of other3dRefs(e)) refs.set(assetStore.idOf(rel), rel);
  const have = await assetStore.presentIds(DIRS.other, [...refs.values()].map((rel) => ({ rel, place: PLACE.flat })));
  return {
    list,
    have,
    models: list.length,
    ready: list.filter((e) => other3dReady(e, have)).length,
    total: refs.size,
    refs: [...refs.values()],
    missing: [...refs.entries()].filter(([f]) => !have.has(f)).map(([, rel]) => rel),
  };
}

export async function monsterStatus(listIn) {
  const list = listIn || (await monsterList());
  const ids = new Set();
  const rels = [];
  for (const e of list) for (const a of e.assets) {
    ids.add(a.id);
    rels.push(a);
  }
  const have = await assetStore.presentIds(DIRS.monster, rels.map((a) => ({ rel: a.rel, place: PLACE.owned(a) })));
  const missing = new Map();
  for (const e of list) for (const a of e.assets) if (!have.has(a.id)) missing.set(a.id, a);
  const byPath = new Map();
  for (const a of rels) {
    const p = subFor(PLACE.owned(a), a.rel, 'web');
    if (!byPath.has(p)) byPath.set(p, a);
  }
  return { list, have, monsters: list.length, ready: list.filter((e) => monsterReady(e, have)).length, total: ids.size, refs: [...byPath.values()], missing: [...missing.values()] };
}

export async function other2dStatus(listIn) {
  const list = listIn || (await other2dList());
  const ids = list.flatMap((e) => e.ids);
  const have = await assetStore.presentIds(DIRS.shared, list.flatMap((e) => e.refs.map((r) => r.rel)));
  const files = list.map((e) => e.file).filter(Boolean);
  const haveFiles = files.length ? await localInventory.presentFiles(DIRS.shared, files) : new Set();
  const missing = [];
  for (const e of list) for (const r of e.refs) if (!have.has(r.id)) missing.push(r);
  const done = (e) => (e.file ? haveFiles.has(e.file) : e.ids.length > 0 && e.ids.every((s) => have.has(s)));
  const refs = [...new Map(list.flatMap((e) => e.refs).map((r) => [r.id, r])).values()];
  const unknown = (await staticsList()).filter((s) => !s.url && !haveFiles.has(s.path)).length;
  return { list, have, haveFiles, total: new Set(ids).size + files.length, unknown, ready: list.filter(done).length, refs, missing };
}

const ITEM_CAT_LABEL = { item: 'アイテム', weapon: '武器', armor: '防具', grimoire: '教典', stone: '石', equipweapon: '装備武器', aura: 'オーラ', other: 'その他' };

const ITEM_TYPE_LABEL = {
  1: '資源',
  2: '回復',
  3: 'キャラ強化',
  4: 'ガチャチケット',
  5: 'ガチャボーナス',
  6: 'スキップチケット',
  7: 'マイレージ',
  8: 'キャンディ',
  9: 'ランクアップ素材',
  10: 'スキル強化',
  11: '精錬石（共通）',
  12: '覚醒片',
  13: '覚醒結晶（キャラ）',
  14: 'アイコン',
  15: '覚醒結晶（モンスター）',
  16: '覚醒結晶（レアモンスター）',
  17: 'メダル・ポイント',
  18: '精錬石（武器）',
  19: '精錬石（防具）',
  20: 'イベント素材',
  21: '交換チケット',
  23: 'シーズンパス',
  24: 'ウィークリーパス',
  25: 'ミッションパック',
  26: 'キャンペーンパス',
  27: 'スキル結晶',
  28: '特別シナリオ',
  29: 'アルカナ（装飾解放）',
  30: 'イベントポイント',
  31: '霊石（共通）',
  32: '霊石（武器）',
  33: '霊石（防具）',
  34: 'マテリアル',
  35: 'ダイヤスタンプシート',
};

export async function itemList() {
  const x = await ensureIndexes();
  const rels = x.assets.itemIndex || {};
  const owners = BUILD_MOD.itemIconOwners(x.master.characters);
  const awaken = BUILD_MOD.awakenItemIds(x.master.monsterMaster);
  const out = (x.master.itemMaster || [])
    .filter((it) => !it.ownerCharId && !awaken.has(it.id) && !owners[it.icon] && !owners[it.id])
    .map((it) => ({ ...it, category: it.category || 'item', rel: rels[it.icon] || rels[it.id] || null }));
  for (const id of BUILD_MOD.unlistedItemIconIds(x.master, x.assets)) out.push({ id, name: '', desc: '', icon: id, category: 'other', rel: rels[id] || null });
  return out;
}

const byNameThenVariant = (a, b) => (a.name > b.name ? 1 : a.name < b.name ? -1 : Number(a.variantCategoryId || 0) - Number(b.variantCategoryId || 0));

export function itemGroups(list) {
  const by = new Map();
  for (const it of list || []) {
    const k = it.category || 'item';
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(it);
  }
  const out = [];
  for (const k of Object.keys(ITEM_CAT_LABEL)) {
    const raw = by.get(k);
    if (!raw) continue;
    const items = raw.some((it) => it.variant) ? [...raw].sort(byNameThenVariant) : raw;
    if (k !== 'item') {
      out.push({ key: k, label: ITEM_CAT_LABEL[k], items });
      continue;
    }
    const sub = new Map();
    for (const it of items) {
      const t = it.itemType || 0;
      if (!sub.has(t)) sub.set(t, []);
      sub.get(t).push(it);
    }
    for (const t of [...sub.keys()].sort((a, b) => a - b)) {
      out.push({ key: 'item' + t, label: ITEM_TYPE_LABEL[t] || `${ITEM_CAT_LABEL.item}（種別${t}）`, items: sub.get(t) });
    }
  }
  return out;
}
