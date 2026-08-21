import { CFG } from './config.js';
import { parseOrigin } from './data/origin.js';
const GAME_RE = /:\/\/play\.games\.dmm\.(co\.jp|com)\/game\/tenkeiprdx/i;
const AUTO_STOP_DELAY = 3000;
const SELF_PREFIX = chrome.runtime.getURL('');

const attached = { tabs: new Set(), childTargets: new Set() };
const observed = { assets: '', statics: '' };

function noteOrigin(url) {
  const p = parseOrigin(url);
  const assets = p.assets || observed.assets;
  const statics = p.statics || observed.statics;
  if (assets === observed.assets && statics === observed.statics) return;
  observed.assets = assets;
  observed.statics = statics;
  chrome.storage.local.get('origin').then((o) => {
    const cur = o.origin || {};
    const next = { assets: assets || cur.assets || null, statics: statics || cur.statics || null };
    if (next.assets === (cur.assets || null) && next.statics === (cur.statics || null)) return;
    chrome.storage.local.set({ origin: { ...next, from: 'observed', at: Date.now() } });
  });
}

let restoring = null;
function restoreAttached() {
  if (!restoring) {
    restoring = chrome.storage.session
      .get('attachedState')
      .then((o) => {
        const s = o && o.attachedState;
        if (!s) return;
        for (const t of s.tabs || []) attached.tabs.add(t);
        for (const t of s.childTargets || []) attached.childTargets.add(t);
      })
      .catch(() => {});
  }
  return restoring;
}
function saveAttached() {
  return chrome.storage.session.set({ attachedState: { tabs: [...attached.tabs], childTargets: [...attached.childTargets] } }).catch(() => {});
}

function jwtExp(bearer) {
  try {
    const t = String(bearer || '').replace(/^Bearer\s+/i, '');
    const p = t.split('.');
    if (p.length < 2) return 0;
    let b = p[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    const j = JSON.parse(atob(b));
    return typeof j.exp === 'number' ? j.exp : 0;
  } catch (e) {
    return 0;
  }
}
const tokenExpired = (a) => !!(a && a.exp && Math.floor(Date.now() / 1000) >= a.exp);

const getIntent = async () => !!(await chrome.storage.local.get('capturing')).capturing;
const setIntent = (v) => chrome.storage.local.set({ capturing: !!v });

async function hasUsableToken() {
  const st = await chrome.storage.local.get(['apiAuth', 'apiAuthBad']);
  const tok = st.apiAuth && st.apiAuth.authorization;
  return !!(tok && tok !== st.apiAuthBad && !tokenExpired(st.apiAuth));
}

async function updateLive() {
  await restoreAttached();
  const live = attached.tabs.size > 0;
  const intent = await getIntent();
  const hasToken = await hasUsableToken();
  await chrome.storage.local.set({ captureLive: live });
  chrome.action.setBadgeText({ text: live ? 'ON' : intent ? '…' : '' });
  chrome.action.setBadgeBackgroundColor({ color: live ? (hasToken ? '#2e9e5b' : '#c98a2b') : '#7a7590' });
}

const findGameTabs = async () => (await chrome.tabs.query({})).filter((t) => t.url && GAME_RE.test(t.url));

async function enableDebugger(target) {
  try {
    await chrome.debugger.sendCommand(target, 'Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false });
  } catch (e) {}
  try {
    await chrome.debugger.sendCommand(target, 'Network.enable', {});
  } catch (e) {}
}
async function attachChildTarget(targetId) {
  await restoreAttached();
  if (attached.childTargets.has(targetId)) return;
  try {
    await chrome.debugger.attach({ targetId }, '1.3');
  } catch (e) {
    if (!/already attached/i.test(String((e && e.message) || e))) return;
  }
  attached.childTargets.add(targetId);
  await saveAttached();
  await enableDebugger({ targetId });
}
async function attachTab(tabId) {
  await restoreAttached();
  let live = false;
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable', {});
    live = true;
  } catch (e) {}
  if (!live) {
    try {
      await chrome.debugger.attach({ tabId }, '1.3');
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (attached.tabs.delete(tabId)) await saveAttached();
      await chrome.storage.local.set({ captureError: /already attached|another debugger/i.test(msg) ? 'そのタブは別のデバッガ(DevTools/他拡張)が接続中です。閉じてから再接続してください。' : msg });
      await updateLive();
      return false;
    }
  }
  if (!attached.tabs.has(tabId)) {
    attached.tabs.add(tabId);
    await saveAttached();
  }
  await enableDebugger({ tabId });
  await chrome.storage.local.remove('captureError');
  await updateLive();
  return true;
}
async function detachAll() {
  await restoreAttached();
  for (const tabId of [...attached.tabs]) {
    try {
      await chrome.debugger.detach({ tabId });
    } catch (e) {}
  }
  for (const targetId of [...attached.childTargets]) {
    try {
      await chrome.debugger.detach({ targetId });
    } catch (e) {}
  }
  attached.tabs.clear();
  attached.childTargets.clear();
  await saveAttached();
  try {
    for (const t of await chrome.debugger.getTargets()) {
      const u = String(t.url || '');
      if (!t.attached || !t.id || u.startsWith('devtools://') || u.startsWith(SELF_PREFIX)) continue;
      try {
        await chrome.debugger.detach({ targetId: t.id });
      } catch (e) {}
    }
  } catch (e) {}
  await chrome.storage.local.set({ captureLive: false });
  chrome.action.setBadgeText({ text: '' });
}
async function maybeAutoStop() {
  if (!(await getIntent())) return false;
  if (!(await hasUsableToken())) return false;
  await setIntent(false);
  await detachAll();
  await chrome.storage.local.remove('captureError');
  return true;
}
async function reattach() {
  if (!(await getIntent())) return;
  if (await maybeAutoStop()) return;
  for (const t of await findGameTabs()) await attachTab(t.id);
  await updateLive();
}

chrome.debugger.onEvent.addListener(async (source, method, params) => {
  if (source && source.tabId != null && !attached.tabs.has(source.tabId) && (await getIntent())) {
    attached.tabs.add(source.tabId);
    await saveAttached();
    updateLive();
  }
  if (method === 'Target.attachedToTarget') {
    const tid = params && params.targetInfo && params.targetInfo.targetId;
    if (tid) await attachChildTarget(tid);
    return;
  }
  if (method !== 'Network.requestWillBeSent') return;
  const req = params.request;
  const url = req && req.url;
  if (!url) return;
  noteOrigin(url);
  if (!req.headers || !CFG.targetHosts.some((h) => url.includes(h))) return;
  const auth = req.headers.Authorization || req.headers.authorization;
  if (!auth || !/^Bearer /.test(auth)) return;
  const pick = (n) => req.headers[n] || req.headers[n.toLowerCase()] || '';
  const st = await chrome.storage.local.get(['apiAuth', 'apiAuthBad']);
  if (st.apiAuth && st.apiAuth.authorization === auth) {
    if (st.apiAuth.exp == null) {
      await chrome.storage.local.set({ apiAuth: Object.assign({}, st.apiAuth, { exp: jwtExp(auth) }) });
    }
    if (st.apiAuthBad === auth) {
      await chrome.storage.local.remove('apiAuthBad');
    }
    updateLive();
    scheduleAutoStop();
    return;
  }
  await chrome.storage.local.set({
    apiAuth: {
      authorization: auth,
      'X-Platform': pick('X-Platform'),
      'X-Device': pick('X-Device'),
      'X-Rating': pick('X-Rating'),
      'x-client-version': pick('x-client-version'),
      'x-masterdata-version': pick('x-masterdata-version'),
      ts: Date.now(),
      exp: jwtExp(auth),
    },
  });
  await chrome.storage.local.remove('apiAuthBad');
  updateLive();
  scheduleAutoStop();
});

let autoStopTimer = null;
function scheduleAutoStop() {
  if (autoStopTimer) return;
  autoStopTimer = setTimeout(() => {
    autoStopTimer = null;
    maybeAutoStop();
  }, AUTO_STOP_DELAY);
}

chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && (ch.apiAuth || ch.apiAuthBad)) updateLive();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  let replied = false;
  const reply = (v) => {
    if (replied) return;
    replied = true;
    try {
      sendResponse(v);
    } catch (e) {}
  };
  (async () => {
    try {
      if (msg.cmd === 'start') {
        await setIntent(true);
        await chrome.storage.local.remove('captureError');
        const tabs = await findGameTabs();
        if (!tabs.length) {
          await setIntent(false);
          await updateLive();
          return reply({ ok: false, error: 'no-tab' });
        }
        let ok = false,
          lastErr = '';
        for (const t of tabs) {
          if (await attachTab(t.id)) ok = true;
          else lastErr = (await chrome.storage.local.get('captureError')).captureError || 'attach';
        }
        await updateLive();
        return reply(ok ? { ok: true, game: tabs.map((t) => t.id), gameTab: true } : { ok: false, error: 'attach-failed', detail: lastErr });
      }
      if (msg.cmd === 'stop') {
        await setIntent(false);
        await detachAll();
        await chrome.storage.local.remove('captureError');
        return reply({ ok: true });
      }
      if (msg.cmd === 'reattach') {
        await reattach();
        return reply({ live: attached.tabs.size > 0 });
      }
      reply({ ok: false, error: 'unknown-cmd' });
    } catch (e) {
      reply({ ok: false, error: String((e && e.message) || e) });
    } finally {
      reply({ ok: false, error: 'no-response' });
    }
  })();
  return true;
});

chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('player.html');
  const existing = (await chrome.tabs.query({})).find((t) => t.url && t.url.startsWith(url));
  if (existing) {
    try {
      await chrome.tabs.update(existing.id, { active: true });
      await chrome.windows.update(existing.windowId, { focused: true });
    } catch (e) {}
  } else chrome.tabs.create({ url });
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (attached.tabs.has(tabId)) {
    attached.tabs.delete(tabId);
    await saveAttached();
    await updateLive();
  }
});
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !tab.url || !GAME_RE.test(tab.url)) return;
  if ((await getIntent()) && !attached.tabs.has(tabId)) await attachTab(tabId);
});
chrome.debugger.onDetach.addListener(async (source, reason) => {
  await restoreAttached();
  let changed = false;
  if (source.tabId != null) changed = attached.tabs.delete(source.tabId) || changed;
  if (source.targetId) changed = attached.childTargets.delete(source.targetId) || changed;
  if (changed) await saveAttached();
  await updateLive();
  if (reason === 'canceled_by_user') {
    await setIntent(false);
    await detachAll();
    return;
  }
  if (source.tabId != null && (await getIntent())) {
    setTimeout(async () => {
      try {
        const t = await chrome.tabs.get(source.tabId);
        if (t && t.url && GAME_RE.test(t.url) && (await getIntent())) await attachTab(source.tabId);
      } catch (e) {}
    }, 1500);
  }
});

chrome.runtime.onStartup.addListener(reattach);
chrome.runtime.onInstalled.addListener(reattach);
try {
  chrome.alarms.create('recap', { periodInMinutes: 1 });
} catch (e) {}
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'recap') reattach();
});
reattach();
