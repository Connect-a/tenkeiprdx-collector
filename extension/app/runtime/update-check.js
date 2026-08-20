import { getById } from '../../core/dom.js';
import { CFG } from '../../config.js';

function cmpSemver(a, b) {
  const pa = String(a)
    .split('.')
    .map((x) => parseInt(x, 10) || 0);
  const pb = String(b)
    .split('.')
    .map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

export async function showVersionAndCheckUpdate() {
  let cur = '';
  try {
    cur = chrome.runtime.getManifest().version || '';
  } catch (e) {}
  if (getById('appVersion')) getById('appVersion').textContent = cur ? 'v' + cur : '';
  const badge = getById('updateBadge');
  if (!badge || !CFG.updateManifestUrl || !cur) return;
  try {
    const res = await fetch(CFG.updateManifestUrl, { cache: 'no-cache' });
    if (!res.ok) return;
    const latest = (await res.json()).version;
    if (latest && cmpSemver(latest, cur) > 0) {
      badge.href = CFG.githubReleasesUrl || '#';
      badge.textContent = `⬆ 更新あり v${latest}`;
      badge.title = `新しいバージョン v${latest} があります（現在 v${cur}）`;
      badge.style.display = '';
    }
  } catch (e) {}
}
