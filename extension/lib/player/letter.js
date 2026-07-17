'use strict';
(function () {
  const LETTER_MAX = 1000;

  // 残課題・わかっている不具合（解決したらここから削除する）。
  const KNOWN_ISSUES = [
    '【残っている課題・わかっている不具合】',
    '・一部の演出モーションで、ループの繋ぎ目が一瞬ガクッとなる（表示自体は可能）',
    '・立ち絵Spineの一部で、頬の赤み等が濃く出ることがある',
    '・演出付き(背景/立ち絵/効果)のストーリー描画は未対応（テキスト＋ボイス＋立ち絵の再生は可）',
    '・キャラボイスギャラリーの台詞テキストは未対応（音声のみ再生）',
  ].join('\n');

  function createController(deps) {
    const { $, toast, CFG, COLLECTION, nameFix, onDistUpdated } = deps;
    let letterEmail = '';
    let storedBinlist = '';

    async function refreshEmail() {
      try { letterEmail = ((await chrome.storage.local.get('email')).email || '').trim(); } catch (e) { letterEmail = ''; }
      const el = $('letterEmail'); if (el) el.value = letterEmail;
    }
    async function refreshBinlist() {
      try { storedBinlist = ((await chrome.storage.local.get('binlistUrl')).binlistUrl || '').trim(); } catch (e) { storedBinlist = ''; }
    }
    function updateCount() {
      const v = ($('letterBody').value || '');
      const c = $('letterCount'); if (c) c.textContent = `${v.length}/${LETTER_MAX}`;
      const foot = $('letterCount') && $('letterCount').parentElement; if (foot) foot.classList.toggle('over', v.length > LETTER_MAX);
      const recv = $('secretRecv');
      if (recv) recv.style.display = (/^https?:\/\/\S+$/.test(v.trim()) || storedBinlist) ? '' : 'none';
    }

    function splitBunsetsu(text) {
      const out = [];
      const push = (s) => { s = String(s).trim(); if (s && !/^[、・…\s]+$/.test(s)) out.push(s); };
      const t = String(text).replace(/[【】]/g, '');
      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        const seg = new Intl.Segmenter('ja', { granularity: 'word' });
        let cur = '';
        for (const w of seg.segment(t)) {
          if (w.isWordLike === false && /^[、・…\s]+$/.test(w.segment)) { push(cur); cur = ''; continue; }
          cur += w.segment;
          if (/[のにをはがでとへやもらしてでるういな]$/.test(w.segment) && cur.length >= 2) { push(cur); cur = ''; }
        }
        push(cur);
      } else {
        for (const f of t.split(/(?<=[のにをはがでとへやも、・…\s])/)) push(f);
      }
      return out.filter((s) => s.length <= 8);
    }
    async function randomName() {
      const names = [], pool = [];
      try {
        const { folderMeta } = await COLLECTION.indexes();
        for (const m of Object.values(folderMeta || {})) {
          if (m.type !== 'character') continue;
          if (m.name) names.push(nameFix(m.name));
          if (m.title) pool.push(...splitBunsetsu(nameFix(m.title)));
        }
      } catch (e) {}
      if (!names.length) return '';
      const name = names[Math.floor(Math.random() * names.length)];
      let nick = '';
      if (pool.length) for (let i = 0; i < 3; i++) nick += pool[Math.floor(Math.random() * pool.length)];
      nick = nick.replace(/^[のにをはがでとへやも、・…\s]+/, '').replace(/[のにをはがでとへやも、・…\s]+$/, '').slice(0, 20);
      return (nick ? `${name}【${nick}】` : name).slice(0, 40);
    }

    function bindEmail() {
      const save = $('emailSave'), clear = $('emailClear');
      if (save) save.addEventListener('click', async () => { await chrome.storage.local.set({ email: $('email').value.trim() }); $('emailSaved').textContent = '更新'; setTimeout(() => ($('emailSaved').textContent = ''), 1500); refreshEmail(); });
      if (clear) clear.addEventListener('click', async () => { $('email').value = ''; await chrome.storage.local.remove('email'); $('emailSaved').textContent = 'クリア'; setTimeout(() => ($('emailSaved').textContent = ''), 1500); refreshEmail(); });
    }
    function bindLetter() {
      if (!$('letterBody')) return;
      $('letterBody').addEventListener('input', updateCount);
      if ($('letterName')) $('letterName').addEventListener('input', () => { try { localStorage.setItem('tp_name', $('letterName').value || ''); } catch (e) {} });
      $('letterRand').addEventListener('click', async () => {
        const nm = await randomName();
        if (nm) { $('letterName').value = nm; try { localStorage.setItem('tp_name', nm); } catch (e) {} }
        else toast('索引が未生成です（ゲームと接続後に使えます）', 'err');
      });
      $('letterSend').addEventListener('click', async () => {
        const btn = $('letterSend'), msg = $('letterMsg');
        const content = ($('letterBody').value || '').trim();
        const name = ($('letterName').value || '').trim();
        if (!content) { msg.textContent = '内容を入力してください'; return; }
        if (content.length > LETTER_MAX) { msg.textContent = `本文が長すぎます（${LETTER_MAX}文字以内）`; return; }
        if (!CFG.receiverUrl) { msg.textContent = '送信先が未設定です'; return; }
        btn.disabled = true; msg.textContent = '送信中…';
        let ver = ''; try { ver = chrome.runtime.getManifest().version || ''; } catch (e) {}
        try {
          const res = await fetch(CFG.receiverUrl + '/letter', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email: letterEmail, content, ext: ver }),
          });
          const d = await res.json().catch(() => ({}));
          if (res.ok && d.ok) { msg.textContent = '✓'; $('letterBody').value = ''; updateCount(); }
          else { msg.textContent = '✕'; }
        } catch (e) { msg.textContent = '✕'; }
        btn.disabled = false;
        setTimeout(() => { if (msg.textContent === '✓' || msg.textContent === '✕') msg.textContent = ''; }, 3000);
      });
      $('knownIssues').addEventListener('click', () => { toast(KNOWN_ISSUES, '', { sticky: true }); });
    }
    function bindSecretRecv() {
      if (!$('secretRecv')) return;
      $('secretRecv').addEventListener('click', async () => {
        const fromBody = ($('letterBody').value || '').trim();
        const url = /^https?:\/\/\S+$/.test(fromBody) ? fromBody : storedBinlist;
        if (!/^https?:\/\/\S+$/.test(url)) { toast('秘密URLがありません', 'err'); return; }
        const email = (letterEmail || '').trim();
        if (!email) {
          toast('配布の許可IDにメールアドレスが必要です。設定でメアドを入力してください。', 'err');
          const dm = document.querySelector('.dm'); if (dm) dm.open = true; const ef = $('email'); if (ef) ef.focus();
          return;
        }
        if (/^https?:\/\/\S+$/.test(fromBody)) { storedBinlist = fromBody; try { await chrome.storage.local.set({ binlistUrl: fromBody }); } catch (e) {} updateCount(); }
        const reqUrl = url + (url.includes('?') ? '&' : '?') + 'id=' + encodeURIComponent(email);
        const btn = $('secretRecv'); btn.disabled = true;
        try {
          const res = await fetch(reqUrl);
          if (!res.ok) { toast('照会失敗: HTTP ' + res.status + (res.status === 403 ? '（未許可のメアドです）' : ''), 'err'); return; }
          const d = await res.json(); const lines = [];
          if (Array.isArray(d.scenes)) lines.push(`配布中の物語bin: ${d.count != null ? d.count : d.scenes.length} 件`);
          toast(lines.join('\n') || JSON.stringify(d, null, 1), 'ok', { sticky: true });
          if (Array.isArray(d.scenes) && onDistUpdated) { try { await onDistUpdated(); } catch (e) {} }
        } catch (e) { toast('照会エラー: ' + (e && e.message ? e.message : e), 'err'); }
        finally { btn.disabled = false; }
      });
    }

    return {
      bind() { bindEmail(); bindLetter(); bindSecretRecv(); },
      async refresh() {
        try { const nm = localStorage.getItem('tp_name'); if (nm && $('letterName')) $('letterName').value = nm; } catch (e) {}
        await refreshEmail();
        await refreshBinlist();
        updateCount();
      },
    };
  }

  globalThis.TP_PLAYER_LETTER = { createController };
})();
