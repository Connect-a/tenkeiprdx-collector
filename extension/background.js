const PLAYER_URL = chrome.runtime.getURL('player.html');

chrome.action.onClicked.addListener(async () => {
  const existing = (await chrome.tabs.query({})).find((t) => t.url && t.url.startsWith(PLAYER_URL));
  if (existing) {
    try {
      await chrome.tabs.update(existing.id, { active: true });
      return;
    } catch (e) {}
  }
  chrome.tabs.create({ url: PLAYER_URL });
});
