'use strict';
importScripts('config.js');
const CFG = globalThis.TP_CONFIG;
const GAME_RE = /:\/\/play\.games\.dmm\.(co\.jp|com)\/game\/tenkeiprdx/i;

const attached = { tabs: new Set(), childTargets: new Set() };

function jwtExp(bearer) {
  try {
    const t = String(bearer || '').replace(/^Bearer\s+/i, '');
    const p = t.split('.'); if (p.length < 2) return 0;
    let b = p[1].replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '=';
    const j = JSON.parse(atob(b));
    return typeof j.exp === 'number' ? j.exp : 0;
  } catch (e) { return 0; }
}
const tokenExpired = (a) => !!(a && a.exp && Math.floor(Date.now() / 1000) >= a.exp);

const getIntent = async () => !!(await chrome.storage.local.get('capturing')).capturing;
const setIntent = (v) => chrome.storage.local.set({ capturing: !!v });

async function updateLive() {
  const live = attached.tabs.size > 0;
  const intent = await getIntent();
  const st = await chrome.storage.local.get(['apiAuth', 'apiAuthBad']);
  const tok = st.apiAuth && st.apiAuth.authorization;
  const hasToken = !!(tok && tok !== st.apiAuthBad && !tokenExpired(st.apiAuth));
  await chrome.storage.local.set({ captureLive: live });
  chrome.action.setBadgeText({ text: live ? 'ON' : (intent ? '…' : '') });
  chrome.action.setBadgeBackgroundColor({ color: live ? (hasToken ? '#2e9e5b' : '#c98a2b') : '#7a7590' });
}

const findGameTabs = async () => (await chrome.tabs.query({})).filter((t) => t.url && GAME_RE.test(t.url));

async function enableDebugger(target) {
  try { await chrome.debugger.sendCommand(target, 'Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false }); } catch (e) {}
  try { await chrome.debugger.sendCommand(target, 'Network.enable', {}); } catch (e) {}
}
async function attachChildTarget(targetId) {
  if (attached.childTargets.has(targetId)) return;
  attached.childTargets.add(targetId);
  try { await chrome.debugger.attach({ targetId }, '1.3'); await enableDebugger({ targetId }); } catch (e) { attached.childTargets.delete(targetId); }
}
async function attachTab(tabId) {
  if (attached.tabs.has(tabId)) return true;
  try { await chrome.debugger.sendCommand({ tabId }, 'Network.enable', {}); attached.tabs.add(tabId); await enableDebugger({ tabId }); await chrome.storage.local.remove('captureError'); await updateLive(); return true; } catch (e) {}
  try { await chrome.debugger.attach({ tabId }, '1.3'); }
  catch (e) {
    const msg = String((e && e.message) || e);
    await chrome.storage.local.set({ captureError: /already attached|another debugger/i.test(msg) ? 'そのタブは別のデバッガ(DevTools/他拡張)が接続中です。閉じてから再接続してください。' : msg });
    return false;
  }
  attached.tabs.add(tabId);
  await enableDebugger({ tabId });
  await chrome.storage.local.remove('captureError');
  await updateLive();
  return true;
}
async function detachAll() {
  for (const tabId of [...attached.tabs]) { try { await chrome.debugger.detach({ tabId }); } catch (e) {} }
  for (const targetId of [...attached.childTargets]) { try { await chrome.debugger.detach({ targetId }); } catch (e) {} }
  attached.tabs.clear(); attached.childTargets.clear();
  await chrome.storage.local.set({ captureLive: false });
  chrome.action.setBadgeText({ text: '' });
}
async function reattach() {
  if (!(await getIntent())) return;
  for (const t of await findGameTabs()) await attachTab(t.id);
  await updateLive();
}

chrome.debugger.onEvent.addListener(async (source, method, params) => {
  if (source && source.tabId != null && !attached.tabs.has(source.tabId)) { attached.tabs.add(source.tabId); updateLive(); }
  if (method === 'Target.attachedToTarget') { const tid = params && params.targetInfo && params.targetInfo.targetId; if (tid) await attachChildTarget(tid); return; }
  if (method !== 'Network.requestWillBeSent') return;
  const req = params.request; const url = req && req.url;
  if (!url) return;
  const am = url.match(/^(https:\/\/cdne-paripari-prod\.tenkei-paradox\.com\/production\/production\d+-[0-9a-f-]+)\//i);
  if (am) { chrome.storage.local.get('assetRoot').then((o) => { if (o.assetRoot !== am[1]) chrome.storage.local.set({ assetRoot: am[1] }); }); }
  if (!req.headers || !CFG.targetHosts.some((h) => url.includes(h))) return;
  const auth = req.headers.Authorization || req.headers.authorization;
  if (!auth || !/^Bearer /.test(auth)) return;
  const pick = (n) => req.headers[n] || req.headers[n.toLowerCase()] || '';
  const st = await chrome.storage.local.get(['apiAuth', 'apiAuthBad']);
  if (st.apiAuth && st.apiAuth.authorization === auth) {
    if (st.apiAuth.exp == null) { await chrome.storage.local.set({ apiAuth: Object.assign({}, st.apiAuth, { exp: jwtExp(auth) }) }); }
    if (st.apiAuthBad === auth) { await chrome.storage.local.remove('apiAuthBad'); }
    updateLive();
    return;
  }
  await chrome.storage.local.set({ apiAuth: {
    authorization: auth, 'X-Platform': pick('X-Platform'), 'X-Device': pick('X-Device'), 'X-Rating': pick('X-Rating'),
    'x-client-version': pick('x-client-version'), 'x-masterdata-version': pick('x-masterdata-version'), ts: Date.now(), exp: jwtExp(auth),
  } });
  await chrome.storage.local.remove('apiAuthBad');
  updateLive();
});

chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && (ch.apiAuth || ch.apiAuthBad)) updateLive();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.cmd === 'start') {
      await setIntent(true);
      await chrome.storage.local.remove('captureError');
      let tabs = await findGameTabs();
      const fellBack = !tabs.length;
      if (fellBack) { const active = (await chrome.tabs.query({ active: true, currentWindow: true }))[0]; if (active) tabs = [active]; }
      if (!tabs.length) { await setIntent(false); await updateLive(); sendResponse({ ok: false, error: 'no-tab' }); return; }
      let ok = false, lastErr = '';
      for (const t of tabs) { if (await attachTab(t.id)) ok = true; else lastErr = (await chrome.storage.local.get('captureError')).captureError || 'attach'; }
      await updateLive();
      sendResponse(ok ? { ok: true, game: tabs.map((t) => t.id), gameTab: !fellBack } : { ok: false, error: 'attach-failed', detail: lastErr });
    } else if (msg.cmd === 'stop') { await setIntent(false); await detachAll(); await chrome.storage.local.remove('captureError'); sendResponse({ ok: true }); }
    else if (msg.cmd === 'reattach') { await reattach(); sendResponse({ live: attached.tabs.size > 0 }); }
  })();
  return true;
});

chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('player.html');
  const existing = (await chrome.tabs.query({})).find((t) => t.url && t.url.startsWith(url));
  if (existing) { try { await chrome.tabs.update(existing.id, { active: true }); await chrome.windows.update(existing.windowId, { focused: true }); } catch (e) {} }
  else chrome.tabs.create({ url });
});

chrome.tabs.onRemoved.addListener(async (tabId) => { if (attached.tabs.has(tabId)) { attached.tabs.delete(tabId); await updateLive(); } });
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !tab.url || !GAME_RE.test(tab.url)) return;
  if (await getIntent() && !attached.tabs.has(tabId)) await attachTab(tabId);
});
chrome.debugger.onDetach.addListener(async (source, reason) => {
  if (source.tabId != null) attached.tabs.delete(source.tabId);
  if (source.targetId) attached.childTargets.delete(source.targetId);
  await updateLive();
  if (reason === 'canceled_by_user') { await setIntent(false); await detachAll(); return; }
  if (source.tabId != null && await getIntent()) {
    setTimeout(async () => { try { const t = await chrome.tabs.get(source.tabId); if (t && t.url && GAME_RE.test(t.url) && await getIntent()) await attachTab(source.tabId); } catch (e) {} }, 1500);
  }
});

chrome.runtime.onStartup.addListener(reattach);
chrome.runtime.onInstalled.addListener(reattach);
try { chrome.alarms.create('recap', { periodInMinutes: 1 }); } catch (e) {}
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'recap') reattach(); });
reattach();
