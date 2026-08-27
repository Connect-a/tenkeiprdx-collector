import { assetAcquirer } from '../../data/acquire/acquire-assemble.js';
import { getById, el, append } from '../../core/dom.js';
import { toast } from '../ui/notifier.js';
import { errText } from '../../core/messages.js';

export function sharedDlToast(o) {
  if (o.ok) toast(`共有リソースを取得しました（新規${o.result.got}件・既にあった分${o.result.skip}件／全${o.result.total}件）`, 'ok');
  else if (!o.noFolder) toast('共有リソースのダウンロードを中断しました。' + o.message, 'err');
}

export async function runSharedDownload(onProgress) {
  try {
    const result = await assetAcquirer.runSharedResourceDownload(onProgress);
    return { ok: true, result };
  } catch (e) {
    if (e && e.noFolder) return { ok: false, noFolder: true, message: e.message };
    return { ok: false, message: errText(e) };
  }
}

export async function refreshSharedNotice() {
  const box = getById('sharedNotice');
  if (!box) return;
  let present = true;
  try {
    present = await assetAcquirer.sharedResourcesPresent();
  } catch (e) {}
  if (present) {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }

  box.style.display = '';
  box.innerHTML = '';
  const prog = el('span', 'note dim');
  const btn = el('button', {
    class: 'btn primary',
    text: '共有リソースをダウンロード',
    on: {
      click: async () => {
        btn.disabled = true;
        const o = await runSharedDownload((m) => {
          prog.textContent = m;
        });
        if (o.ok) {
          sharedDlToast(o);
          await refreshSharedNotice();
          return;
        }
        if (o.noFolder) toast(o.message, 'err');
        else {
          prog.textContent = o.message;
          sharedDlToast(o);
        }
        btn.disabled = false;
      },
    },
  });
  append(box, [el('div', 'note', 'ストーリー再生には共有リソース（背景・BGM・SE・フォント・演出）が必要です。まだダウンロードされていません。'), el('div', { class: 'sharedfixrow' }, [btn, prog])]);
}
