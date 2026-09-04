import { SK } from '../../core/storage-keys.js';
async function cdnMissing() {
  const state = await chrome.storage.local.get(SK.cdnMissing);
  return state[SK.cdnMissing] || { updatedAt: 0, chars: {} };
}
async function cdnMissingSummary() {
  const m = await cdnMissing();
  let chars = 0,
    stories = 0,
    scenes = 0,
    withUrl = 0;
  const rows = [];
  for (const [cid, c] of Object.entries(m.chars || {})) {
    chars++;
    for (const [eid, s] of Object.entries(c.stories || {})) {
      stories++;
      const sids = Object.keys(s.scenes || {});
      scenes += sids.length;
      for (const sc of Object.values(s.scenes || {})) if (sc.url) withUrl++;
      rows.push({ folderKey: cid, name: c.name, title: c.title, epId: eid, label: s.label, epTitle: s.title, scenes: sids.length });
    }
  }
  return { updatedAt: m.updatedAt || 0, chars, stories, scenes, withUrl, rows, data: m };
}
async function clearCdnMissing() {
  try {
    await chrome.storage.local.remove(SK.cdnMissing);
  } catch (e) {}
}

async function missingScenesSummary() {
  const state = await chrome.storage.local.get(SK.missingScenes);
  const m = state[SK.missingScenes] || { updatedAt: 0, chars: {} };
  let chars = 0,
    stories = 0,
    scenes = 0;
  const rows = [];
  for (const [cid, c] of Object.entries(m.chars || {})) {
    chars++;
    for (const [eid, s] of Object.entries(c.stories || {})) {
      stories++;
      const sids = Object.keys(s.scenes || {});
      scenes += sids.length;
      rows.push({ folderKey: cid, name: c.name, title: c.title, epId: eid, label: s.label, epTitle: s.title, scenes: sids.length });
    }
  }
  return { updatedAt: m.updatedAt || 0, chars, stories, scenes, rows, data: m };
}
async function clearMissingScenes() {
  try {
    await chrome.storage.local.remove(SK.missingScenes);
  } catch (e) {}
}

export const acquireCdn = { cdnMissingSummary, clearCdnMissing, missingScenesSummary, clearMissingScenes };
