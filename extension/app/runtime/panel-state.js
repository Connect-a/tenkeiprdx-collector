let imagePanel = null;
let audioPanel = null;
let letterPanel = null;
let storyPanel = null;
let otherPanel = null;
let itemPanel = null;
let monsterPanel = null;
let other2dPanel = null;
let homePanel = null;
let panels = [];

export function registerPanels(r = {}) {
  letterPanel = r.letterPanel || null;
  audioPanel = r.audioPanel || null;
  imagePanel = r.imagePanel || null;
  storyPanel = r.storyPanel || null;
  otherPanel = r.otherPanel || null;
  itemPanel = r.itemPanel || null;
  monsterPanel = r.monsterPanel || null;
  other2dPanel = r.other2dPanel || null;
  homePanel = r.homePanel || null;
  panels = Array.isArray(r.panels) ? r.panels : [];
}

export function getLetterPanel() {
  return letterPanel;
}
export function getImagePanel() {
  return imagePanel;
}
export function getStoryPanel() {
  return storyPanel;
}
export function getOtherPanel() {
  return otherPanel;
}
export function getItemPanel() {
  return itemPanel;
}
export function getMonsterPanel() {
  return monsterPanel;
}
export function getOther2dPanel() {
  return other2dPanel;
}
export function getHomePanel() {
  return homePanel;
}

export function dispatchPanels(hook, ...args) {
  for (const p of panels) {
    if (p && typeof p[hook] === 'function') {
      try {
        p[hook](...args);
      } catch (e) {
        console.error('[tp] panel hook failed', hook, e);
      }
    }
  }
}
