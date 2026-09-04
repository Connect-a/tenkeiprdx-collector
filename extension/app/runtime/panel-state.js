const PANEL_KINDS = ['image', 'audio', 'story', 'other', 'item', 'monster', 'other2d', 'home'];

const panels = new Map();
let ordered = [];

export function registerPanels(r = {}) {
  panels.clear();
  for (const kind of PANEL_KINDS) if (r[kind + 'Panel']) panels.set(kind, r[kind + 'Panel']);
  ordered = Array.isArray(r.panels) ? r.panels : [];
}

export const getPanel = (kind) => panels.get(kind) || null;

export function dispatchPanels(hook, ...args) {
  for (const p of ordered) {
    if (p && typeof p[hook] === 'function') {
      try {
        p[hook](...args);
      } catch (e) {
        console.error('[tp] panel hook failed', hook, e);
      }
    }
  }
}

export function focusPanelTarget(panel, target) {
  if (!panel || !target) return;
  if (panel.openTarget) panel.openTarget(target);
  else if (panel.scrollToSection) panel.scrollToSection(target);
}
