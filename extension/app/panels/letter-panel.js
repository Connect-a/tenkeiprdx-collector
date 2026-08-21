import { SK } from '../../core/constants.js';
import { showNotice } from '../ui/notice-modal.js';
import { openUpgradeNotice } from '../runtime/upgrade-notice.js';
const LETTER_MAX = 1000;

const KNOWN_ISSUES_TITLE = '残っている課題・わかっている不具合';
const KNOWN_ISSUES = [
  '・特別エピソード（EX・イベント有償エピソード）の再生は未検証です',
  '・ストーリー再生に細かい表示ズレがあり得ます',
  '・3Dキャラのオーラ描画が壊れています',
  '・BGMとストーリーキャラの名前が紐づけできていないものがあります',
];

export function createLetterPanel(deps) {
  const { getById, toast, CFG, collectionRepository, nameFix, onDistUpdated, onDistCleared } = deps;
  let letterEmail = '';
  let storedBinlist = '';

  async function refreshEmail() {
    try {
      const st = await chrome.storage.local.get(SK.email);
      letterEmail = (st[SK.email] || '').trim();
    } catch (e) {
      letterEmail = '';
    }
    const el = getById('letterEmail');
    if (el) el.value = letterEmail;
  }
  async function refreshBinlist() {
    try {
      const st = await chrome.storage.local.get(SK.binlistUrl);
      storedBinlist = (st[SK.binlistUrl] || '').trim();
    } catch (e) {
      storedBinlist = '';
    }
  }
  function updateCount() {
    const v = getById('letterBody').value || '';
    const c = getById('letterCount');
    if (c) c.textContent = `${v.length}/${LETTER_MAX}`;
    const foot = getById('letterCount') && getById('letterCount').parentElement;
    if (foot) foot.classList.toggle('over', v.length > LETTER_MAX);
    const show = /^https?:\/\/\S+$/.test(v.trim()) || storedBinlist ? '' : 'none';
    for (const id of ['secretRecv', 'secretDrop']) {
      const b = getById(id);
      if (b) b.style.display = show;
    }
  }

  function openReport(text) {
    const body = getById('letterBody');
    if (!body) return false;
    const dt = body.closest('details');
    if (dt) dt.open = true;
    const cur = (body.value || '').trim();
    const add = String(text || '').trim();
    const next = cur && add && !cur.includes(add) ? `${cur}\n${add}` : add || cur;
    body.value = next.slice(0, LETTER_MAX);
    updateCount();
    try {
      body.scrollIntoView({ block: 'center' });
    } catch (e) {}
    body.focus();
    return true;
  }

  function splitBunsetsu(text) {
    const out = [];
    const push = (s) => {
      s = String(s).trim();
      if (s && !/^[、・…\s]+$/.test(s)) out.push(s);
    };
    const t = String(text).replace(/[【】]/g, '');
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      const seg = new Intl.Segmenter('ja', { granularity: 'word' });
      let cur = '';
      for (const w of seg.segment(t)) {
        if (w.isWordLike === false && /^[、・…\s]+$/.test(w.segment)) {
          push(cur);
          cur = '';
          continue;
        }
        cur += w.segment;
        if (/[のにをはがでとへやもらしてでるういな]$/.test(w.segment) && cur.length >= 2) {
          push(cur);
          cur = '';
        }
      }
      push(cur);
    } else {
      for (const f of t.split(/(?<=[のにをはがでとへやも、・…\s])/)) push(f);
    }
    return out.filter((s) => s.length <= 8);
  }
  async function randomName() {
    const names = [],
      pool = [];
    try {
      const { folderMeta } = await collectionRepository.folderModel();
      for (const m of Object.values(folderMeta || {})) {
        if (m.rosterKind !== 'character') continue;
        if (m.name) names.push(nameFix(m.name));
        if (m.title) pool.push(...splitBunsetsu(nameFix(m.title)));
      }
    } catch (e) {}
    if (!names.length) return '';
    const name = names[Math.floor(Math.random() * names.length)];
    let nick = '';
    if (pool.length) for (let i = 0; i < 3; i++) nick += pool[Math.floor(Math.random() * pool.length)];
    nick = nick
      .replace(/^[のにをはがでとへやも、・…\s]+/, '')
      .replace(/[のにをはがでとへやも、・…\s]+$/, '')
      .slice(0, 20);
    return (nick ? `${name}【${nick}】` : name).slice(0, 40);
  }

  function bindEmail() {
    const save = getById('emailSave'),
      clear = getById('emailClear');
    if (save)
      save.addEventListener('click', async () => {
        await chrome.storage.local.set({ [SK.email]: getById('email').value.trim() });
        getById('emailSaved').textContent = '更新';
        setTimeout(() => (getById('emailSaved').textContent = ''), 1500);
        refreshEmail();
      });
    if (clear)
      clear.addEventListener('click', async () => {
        getById('email').value = '';
        await chrome.storage.local.remove(SK.email);
        getById('emailSaved').textContent = 'クリア';
        setTimeout(() => (getById('emailSaved').textContent = ''), 1500);
        refreshEmail();
      });
  }
  function bindLetter() {
    if (!getById('letterBody')) return;
    getById('letterBody').addEventListener('input', updateCount);
    if (getById('letterName'))
      getById('letterName').addEventListener('input', () => {
        try {
          localStorage.setItem('tp_name', getById('letterName').value || '');
        } catch (e) {}
      });
    getById('letterRand').addEventListener('click', async () => {
      const nm = await randomName();
      if (nm) {
        getById('letterName').value = nm;
        try {
          localStorage.setItem('tp_name', nm);
        } catch (e) {}
      } else toast('ゲームと接続すると使えるようになります。', 'err');
    });
    getById('letterSend').addEventListener('click', async () => {
      const btn = getById('letterSend'),
        msg = getById('letterMsg');
      const content = (getById('letterBody').value || '').trim();
      const name = (getById('letterName').value || '').trim();
      if (!content) {
        msg.textContent = '内容を入力してください';
        return;
      }
      if (content.length > LETTER_MAX) {
        msg.textContent = `本文が長すぎます（${LETTER_MAX}文字以内）`;
        return;
      }
      if (!CFG.receiverUrl) {
        msg.textContent = '送信先が未設定です';
        return;
      }
      btn.disabled = true;
      msg.textContent = '送信中…';
      let ver = '';
      try {
        ver = chrome.runtime.getManifest().version || '';
      } catch (e) {}
      try {
        const res = await fetch(CFG.receiverUrl + '/letter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email: letterEmail, content, ext: ver }),
        });
        const d = await res.json().catch(() => ({}));
        if (res.ok && d.ok) {
          msg.textContent = '✓';
          getById('letterBody').value = '';
          updateCount();
        } else {
          msg.textContent = '✕';
        }
      } catch (e) {
        msg.textContent = '✕';
      }
      btn.disabled = false;
      setTimeout(() => {
        if (msg.textContent === '✓' || msg.textContent === '✕') msg.textContent = '';
      }, 3000);
    });
    getById('knownIssues').addEventListener('click', () => showNotice(KNOWN_ISSUES, { title: KNOWN_ISSUES_TITLE }));
    const v2 = getById('v2Notice');
    if (v2) v2.addEventListener('click', () => openUpgradeNotice());
  }
  function bindSecretDrop() {
    const btn = getById('secretDrop');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        if (onDistCleared) await onDistCleared();
        toast('OK', 'ok');
      } catch (e) {
        toast('削除エラー: ' + (e && e.message ? e.message : e), 'err');
      } finally {
        btn.disabled = false;
      }
    });
  }
  function bindSecretRecv() {
    if (!getById('secretRecv')) return;
    getById('secretRecv').addEventListener('click', async () => {
      const fromBody = (getById('letterBody').value || '').trim();
      const url = /^https?:\/\/\S+$/.test(fromBody) ? fromBody : storedBinlist;
      if (!/^https?:\/\/\S+$/.test(url)) {
        toast('URLがありません', 'err');
        return;
      }
      const email = (letterEmail || '').trim();
      if (!email) {
        toast('メールアドレスが必要です。設定から入力してください。', 'err');
        const dm = document.querySelector('.dm');
        if (dm) dm.open = true;
        const ef = getById('email');
        if (ef) ef.focus();
        return;
      }
      if (/^https?:\/\/\S+$/.test(fromBody)) {
        storedBinlist = fromBody;
        try {
          await chrome.storage.local.set({ [SK.binlistUrl]: fromBody });
        } catch (e) {}
        updateCount();
      }
      const reqUrl = url + (url.includes('?') ? '&' : '?') + 'id=' + encodeURIComponent(email);
      const btn = getById('secretRecv');
      btn.disabled = true;
      try {
        const res = await fetch(reqUrl);
        if (!res.ok) {
          toast('照会失敗: HTTP ' + res.status + (res.status === 403 ? '（未許可のメアドです）' : ''), 'err');
          return;
        }
        const d = await res.json();
        const n = Array.isArray(d.scenes) ? (d.count != null ? d.count : d.scenes.length) : 0;
        toast(`${n}件 OK`, 'ok');
        if (Array.isArray(d.scenes) && onDistUpdated) {
          try {
            await onDistUpdated();
          } catch (e) {}
        }
      } catch (e) {
        toast('照会エラー: ' + (e && e.message ? e.message : e), 'err');
      } finally {
        btn.disabled = false;
      }
    });
  }

  return {
    openReport,
    bind() {
      bindEmail();
      bindLetter();
      bindSecretRecv();
      bindSecretDrop();
    },
    async refresh() {
      try {
        const nm = localStorage.getItem('tp_name');
        if (nm && getById('letterName')) getById('letterName').value = nm;
      } catch (e) {}
      await refreshEmail();
      await refreshBinlist();
      updateCount();
    },
  };
}
