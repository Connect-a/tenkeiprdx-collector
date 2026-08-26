import { unityMesh as MESH_MOD } from '../../unity/mesh.js';
import { texCodec } from '../../unity/texcodec.js';
import { DIRS } from '../../core/constants.js';
import { assetStore } from '../../data/asset-store.js';
import { errText } from '../../core/messages.js';
import { utilHelpers } from '../../core/util.js';
import { voiceOut } from './voice-out.js';
import { createHomeBgm } from './home-bgm.js';
import { hideRosterControls } from '../ui/panel-shell.js';
import { inDir, stripDir } from '../../core/paths.js';
import { el, append } from '../../core/dom.js';
const { revokeUrlMap, cachedAudioUrl } = utilHelpers;

const HOME_SECTIONS = {
  homeBgm: { label: 'ホームBGM', bgm: true, primary: (m) => m.audio },
  otherBgm: { label: 'その他BGM', bgm: true, primary: (m) => m.audio },
  sceneIllust: { label: 'シーンイラスト', primary: (m) => m.cg, open: (m) => m.cg, title: (e) => e.name || e.id },
  comic: { label: '1コマ漫画', primary: (m) => m.img, open: (m) => m.img, title: (e) => e.title || e.id },
  background: { label: 'ホーム背景', primary: (m) => m.icon, open: (m) => m.bg, view: (m) => m.bg || m.icon, title: (e) => e.name || e.id },
  profileIcon: { label: 'プロフィールアイコン', primary: (m) => m.icon, open: (m) => m.icon, title: (e) => e.name || e.id },
};
const SECTION_ORDER = Object.keys(HOME_SECTIONS);
const THUMB_WIDTH = 200;

export function createHomePanel(deps) {
  const { getById, playerState, fileStore, collectionRepository, assetAcquirer, unityDecode, toast, nameFix, buildOnboard, navTo, masterVol, spinnerHtml, audioScene } = deps;

  const _homeVoiceUrls = new Map();

  async function readHomeBundle(sub) {
    const shared = inDir(sub, DIRS.shared);
    return fileStore.readNamedBundle(shared ? DIRS.shared : DIRS.home, shared ? stripDir(sub, DIRS.shared) : sub);
  }

  const bgm = createHomeBgm({
    getById,
    unityDecode,
    playerState,
    collectionRepository,
    audioScene,
    toast,
    navTo,
    nameFix,
    masterVol,
    readBundle: readHomeBundle,
    paintIcon: (host, sub, cls) => paintIcon(host, sub, cls),
    onSelectionChange: () => refreshHomeBgmButtons(),
  });

  const _home = { refs: new Map(), got: null, headers: null, items: null };
  const homePrimary = (section, m) => (m ? HOME_SECTIONS[section].primary(m) : null);
  const isBgm = (section) => !!HOME_SECTIONS[section].bgm;

  function illustBundleToCanvas(bytes) {
    if (!MESH_MOD || !MESH_MOD.decodeTextureCanvas) return null;
    try {
      return MESH_MOD.decodeTextureCanvas(bytes);
    } catch (e) {
      return null;
    }
  }

  function homeAssetToCanvas(sub, bytes) {
    return /\.dds$/i.test(sub || '') ? texCodec.decodeDdsCanvas(bytes) : illustBundleToCanvas(bytes);
  }

  async function renderHome() {
    const grid = getById('rosterGrid');
    hideRosterControls();
    getById('rostercount').textContent = '';
    if (!playerState.fsGranted) {
      grid.innerHTML = '';
      grid.appendChild(buildOnboard({ fsGranted: false, hasIndex: false }));
      return;
    }
    grid.innerHTML = spinnerHtml();

    let data = { sceneIllust: [], comic: [], homeBgm: [] };
    try {
      data = await collectionRepository.homeData();
    } catch (e) {}
    const st = await collectionRepository.homeStatus(data).catch(() => null);
    const dl = {
      sceneIllust: (st && st.sceneIllust) || new Map(),
      comic: (st && st.comic) || new Map(),
      background: (st && st.background) || new Map(),
      profileIcon: (st && st.profileIcon) || new Map(),
      homeBgm: (st && st.homeBgm) || new Map(),
      otherBgm: (st && st.otherBgm) || new Map(),
    };

    _home.refs = new Map();
    _home.items = data;
    _home.dl = dl;
    _home.got = {};
    _home.headers = {};
    for (const section of SECTION_ORDER) {
      _home.got[section] = new Set();
      for (const e of data[section] || []) if (homePrimary(section, dl[section].get(String(e.id)))) _home.got[section].add(String(e.id));
    }
    const bgmDlList = (section) =>
      (data[section] || [])
        .map((e) => {
          const mm = dl[section].get(String(e.id));
          return mm && mm.audio ? { id: e.id, name: e.name, path: mm.audio, intro: mm.intro || null, icon: mm.icon || null } : null;
        })
        .filter(Boolean);
    bgm.setDownloaded([...bgmDlList('homeBgm'), ...bgmDlList('otherBgm')]);

    grid.innerHTML = '';
    const homeTotal = SECTION_ORDER.reduce((n, section) => n + (data[section] || []).length, 0);
    const homeGot = SECTION_ORDER.reduce((n, section) => n + Math.min(_home.got[section].size, (data[section] || []).length), 0);
    getById('rostercount').textContent = `${homeGot} / ${homeTotal}`;
    if (homeGot < homeTotal) grid.appendChild(homeDownloadBar(data, homeTotal - homeGot));
    grid.appendChild(
      el(
        'div',
        'homenav',
        SECTION_ORDER.map((section) => el('button', { class: 'homenavlink', text: `${HOME_SECTIONS[section].label} ${(data[section] || []).length}`, on: { click: () => goToSection(section) } })),
      ),
    );

    for (const section of SECTION_ORDER) {
      const list = data[section] || [];
      if (isBgm(section)) homeSectionBgm(grid, section, list, dl[section]);
      else homeSection(grid, section, list, dl[section]);
      if (section === 'comic' && !data.staticsBase) {
        grid.appendChild(
          el('div', {
            class: 'note dim',
            style: { margin: '-6px 0 14px', wordBreak: 'break-all' },
            text: '※1コマ漫画の配信元が分かりませんでした。「索引を作り直す」を実行してからやり直してください。',
          }),
        );
      }
    }
    await systemVoiceSection(grid);
  }

  async function systemVoiceSection(host) {
    let rel = null;
    try {
      rel = (await collectionRepository.ensureIndexes()).assets.systemVoiceRel || null;
    } catch (e) {}
    let clips = [];
    let bytes = null;
    if (rel) {
      try {
        bytes = await assetStore.readAsset(DIRS.shared, rel);
        if (bytes) clips = await unityDecode.extractVoiceClips(bytes);
      } catch (e) {}
    }
    if (!clips.length) {
      const why = !rel
        ? '索引にシステムボイスがありません。「データ管理 → 索引を作り直す」を実行してください。'
        : !bytes
          ? '未取得です。サイドバーの「共有リソース」から取得できます。'
          : '取得済みですが音声を取り出せませんでした。';
      host.appendChild(el('div', 'rgroup', 'システムボイス'));
      host.appendChild(el('div', { class: 'note dim', style: { margin: '0 0 14px' }, text: why }));
      return;
    }
    host.appendChild(el('div', 'rgroup', `システムボイス（${clips.length}）`));
    const no = (nm) => {
      const m = String(nm).match(/(\d+)\s*$/);
      return m ? parseInt(m[1], 10) : 0;
    };
    clips.sort((a, b) => no(a.name) - no(b.name) || (a.name > b.name ? 1 : -1));
    const grid = el('div', 'voicegrid');
    const cards = [];
    for (const c of clips) {
      const card = el('div', { class: 'voicecard', html: '<div class="voicecard-name"></div><div class="voicecard-id"></div>' });
      card.querySelector('.voicecard-name').textContent = `No.${String(no(c.name)).padStart(3, '0')}`;
      card.querySelector('.voicecard-id').textContent = c.name;
      card.addEventListener('click', async () => {
        cards.forEach((x) => x.classList.remove('playing'));
        card.classList.add('playing');
        voiceOut.play(await cachedAudioUrl(_homeVoiceUrls, 'sys_' + c.name, async () => c));
      });
      cards.push(card);
      grid.appendChild(card);
    }
    host.appendChild(grid);
  }

  function homeDownloadBar(data, missing) {
    const status = el('span', { class: 'note dim', id: 'homeDlStatus' });
    const pbar = el('div', { class: 'hpbar', id: 'homePbar', style: { display: 'none' }, html: '<i></i>' });
    const dlBtn = el('button', {
      class: 'btn sm primary',
      id: 'homeDl',
      text: `ホームリソースDL（${missing}）`,
      on: {
        click: async () => {
          const root = fileStore && fileStore.supported ? await fileStore.ensure() : null;
          if (!root) {
            toast('先に保存先フォルダを選んでください', 'err');
            return;
          }
          dlBtn.disabled = true;
          pbar.style.display = '';
          const total = SECTION_ORDER.reduce((n, section) => n + (data[section] || []).length, 0);
          const fill = pbar.querySelector('i');
          let processed = 0;
          try {
            const r = await assetAcquirer.collectHome(null, (section, entry) => {
              processed++;
              if (fill) fill.style.width = Math.round(total ? (processed / total) * 100 : 0) + '%';
              status.textContent = `取得中… ${processed}/${total}`;
              applyHomeItem(section, entry);
            });
            const short = `新規${r.got}件・既にあった分${r.skip}件${r.missing ? `・ゲーム側にデータが無い分${r.missing}件` : ''}${r.unresolved ? `・紐づけできなかった分${r.unresolved}件` : ''}`;
            status.textContent = `完了（${short}）`;
            toast(`ホーム画面の素材を取得しました（${short}）`, 'ok');
          } catch (e) {
            const msg = errText(e);
            status.textContent = msg;
            toast('ホーム画面の素材のダウンロードを中断しました。' + msg, 'err');
          } finally {
            dlBtn.disabled = false;
          }
        },
      },
    });
    return el('div', 'homebar', [dlBtn, pbar, status]);
  }

  function homeHeaderText(section) {
    const list = (_home.items && _home.items[section]) || [];
    return `${HOME_SECTIONS[section].label}（取得 ${_home.got[section].size}/${list.length}）`;
  }
  function goToSection(section) {
    if (typeof navTo === 'function') navTo('home', section);
  }
  function scrollToSection(name) {
    const h = _home.headers && _home.headers[name];
    if (h && h.scrollIntoView) setTimeout(() => h.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }

  function sectionHeader(grid, section) {
    const h = el('div', {
      class: 'rgroup',
      text: homeHeaderText(section),
      title: 'このセクションへ移動（リンク）',
      style: { cursor: 'pointer' },
      on: { click: () => goToSection(section) },
    });
    _home.headers[section] = h;
    grid.appendChild(h);
  }

  function fillSection(grid, section, list, wrapClass, buildEntry) {
    const wrap = el('div', wrapClass);
    grid.appendChild(wrap);
    for (const e of list) {
      const node = buildEntry(e);
      wrap.appendChild(node);
      _home.refs.set(section + ':' + e.id, { el: node, item: e, wrap });
    }
  }

  function homeSection(grid, section, list, dlMap) {
    sectionHeader(grid, section);
    fillSection(grid, section, list, 'homegrid', (e) => homeCard(section, e, dlMap.get(String(e.id))));
  }

  const _homeThumbObs =
    'IntersectionObserver' in window
      ? new IntersectionObserver(
          (ents, obs) => {
            for (const en of ents)
              if (en.isIntersecting) {
                obs.unobserve(en.target);
                loadHomeThumb(en.target);
              }
          },
          { rootMargin: '120px' },
        )
      : null;
  async function loadHomeThumb(host) {
    const sub = host.dataset.thumb;
    if (!sub || host.dataset.loaded) return;
    host.dataset.loaded = '1';
    const bytes = await readHomeBundle(sub);
    const cv = bytes ? homeAssetToCanvas(sub, bytes) : null;
    if (!cv) return;
    const scale = Math.min(1, THUMB_WIDTH / cv.width);
    const t = el('canvas', { width: Math.round(cv.width * scale), height: Math.round(cv.height * scale) });
    t.getContext('2d').drawImage(cv, 0, 0, t.width, t.height);
    host.innerHTML = '';
    host.appendChild(t);
  }

  function homeThumb(sub) {
    if (!sub) return el('div', 'hcthumb empty');
    const th = el('div', { class: 'hcthumb', data: { thumb: sub } });
    if (_homeThumbObs) _homeThumbObs.observe(th);
    else loadHomeThumb(th);
    return th;
  }

  function homeCard(section, e, m) {
    const cfg = HOME_SECTIONS[section];
    const thumb = m ? cfg.primary(m) : null;
    const openable = m && cfg.open(m);
    const voiced = e.lines && e.lines.length;
    return el('div', { class: 'homecard' + (thumb ? '' : ' un'), on: openable ? { click: () => openHomeByItem(section, e.id) } : null }, [
      homeThumb(thumb),
      el('div', 'hcname', nameFix(cfg.title(e))),
      voiced ? el('span', 'hcvoice', `♪${e.lines.length}`) : null,
    ]);
  }

  const _iconCache = new Map();
  async function iconCanvas(sub) {
    if (!sub) return null;
    if (_iconCache.has(sub)) return _iconCache.get(sub);
    let cv = null;
    try {
      const bytes = await readHomeBundle(sub);
      if (bytes) cv = illustBundleToCanvas(bytes);
    } catch (e) {}
    _iconCache.set(sub, cv);
    return cv;
  }
  async function paintIcon(host, sub, cls) {
    const cv = await iconCanvas(sub);
    if (!cv || !host.isConnected) return;
    const c = el('canvas', { class: cls, width: cv.width, height: cv.height });
    c.getContext('2d').drawImage(cv, 0, 0);
    host.innerHTML = '';
    host.appendChild(c);
  }

  function homeBgmBtn(e, m) {
    const active = bgm.isCurrent(e.id);
    const icon = el('span', 'hbicon');
    const btn = el('button', { class: 'homebgmbtn' + (active ? ' active' : '') + (m && m.audio ? '' : ' un') }, [
      icon,
      el('span', 'hbnote', bgm.glyph(active)),
      el('span', 'hbname', nameFix(e.name || e.id)),
    ]);
    if (m && m.icon) paintIcon(icon, m.icon, 'hbiconimg');
    if (m && m.audio) btn.addEventListener('click', () => bgm.toggle(e, m));
    else if (!e.audioResolvable) btn.title = 'ゲーム側にデータが見つかりません';
    return btn;
  }

  function homeSectionBgm(grid, section, list, dlMap) {
    sectionHeader(grid, section);
    if (list.length && dlMap.size === 0) {
      grid.appendChild(
        el('div', {
          class: 'note dim',
          style: { margin: '0 0 8px' },
          text: '※BGMが未取得です。「ホームのリソースダウンロード」または共有リソースDLで取得してください（取得後クリックで再生。ストーリー再生と同じ音源を共有）。',
        }),
      );
    }
    fillSection(grid, section, list, 'homebgmgrid', (e) => homeBgmBtn(e, dlMap.get(String(e.id))));
  }

  function applyHomeItem(section, entry) {
    if (playerState.rosterKind !== 'home' || !_home.refs) return;
    if (_home.dl && _home.dl[section]) _home.dl[section].set(String(entry.id), entry);
    const ref = _home.refs.get(section + ':' + entry.id);
    if (!ref) return;
    const fresh = isBgm(section) ? homeBgmBtn(ref.item, entry) : homeCard(section, ref.item, entry);
    if (ref.el.parentNode) ref.el.parentNode.replaceChild(fresh, ref.el);
    ref.el = fresh;
    if (homePrimary(section, entry)) {
      _home.got[section].add(String(entry.id));
      const h = _home.headers[section];
      if (h) h.textContent = homeHeaderText(section);
      if (isBgm(section)) bgm.addDownloaded(entry);
    }
  }

  function homeOpenableList(section) {
    const items = (_home.items && _home.items[section]) || [];
    const dl = _home.dl && _home.dl[section];
    const out = [];
    for (const e of items) {
      const m = dl && dl.get(String(e.id));
      if (m && homePrimary(section, m)) out.push({ e, m });
    }
    return out;
  }
  let _homeView = null;
  function openHomeByItem(section, id) {
    const list = homeOpenableList(section);
    const idx = list.findIndex((x) => String(x.e.id) === String(id));
    if (idx >= 0) openHomeAt(section, idx, list);
  }
  function openHomeAt(section, idx, list) {
    list = list || homeOpenableList(section);
    if (!list.length) return;
    idx = ((idx % list.length) + list.length) % list.length;
    _homeView = { section, idx };
    const cfg = HOME_SECTIONS[section];
    const { e, m } = list[idx];
    const title = `${nameFix(cfg.title(e))}　(${idx + 1}/${list.length})`;
    const body = imageBody((cfg.view || cfg.open)(m), section === 'sceneIllust' ? 'CGを展開できませんでした' : '画像を展開できませんでした');
    if (section === 'sceneIllust' && (e.lines || []).length) body.appendChild(voiceLines(e, m));
    openOverlay(title, body, { onPrev: () => openHomeAt(section, idx - 1, list), onNext: () => openHomeAt(section, idx + 1, list) });
  }

  function imageBody(sub, failText) {
    const holder = el('div', 'homeimgholder');
    (async () => {
      const bytes = await readHomeBundle(sub);
      const cv = bytes ? homeAssetToCanvas(sub, bytes) : null;
      if (!cv) holder.textContent = failText;
      else {
        cv.className = 'homeviewimg';
        holder.appendChild(cv);
      }
    })();
    return el('div', 'homeview', holder);
  }

  function voiceLines(e, m) {
    return el(
      'div',
      'homelines',
      e.lines.map((ln, i) => {
        const row = el('div', 'homeline');
        return append(row, [el('button', { class: 'btn xs', text: '▶', on: { click: () => playHomeVoice(e, m, ln, i, row) } }), el('span', null, nameFix((ln.text || '').replace(/\\n|\r?\n/g, ' ')))]);
      }),
    );
  }

  async function playHomeVoice(e, m, ln, i, row) {
    if (!m.voice) {
      toast('この台詞の音声は未取得です', 'err');
      return;
    }
    const clearRows = () => row.parentNode.querySelectorAll('.homeline').forEach((x) => x.classList.remove('playing'));
    clearRows();
    row.classList.add('playing');
    const key = String(e.id) + ':' + String(ln.voiceId);
    const url = await cachedAudioUrl(_homeVoiceUrls, key, async () => {
      const bytes = await readHomeBundle(m.voice);
      if (!bytes) {
        toast('音声を読めませんでした', 'err');
        return null;
      }
      let clips = [];
      try {
        clips = await unityDecode.extractVoiceClips(bytes);
      } catch (e2) {}
      if (!clips.length) {
        toast('音声を展開できませんでした', 'err');
        return null;
      }
      const byName = new Map(clips.map((c) => [c.name, c.data]));
      return byName.get(ln.voiceId) || (clips[i] && clips[i].data) || clips[0].data;
    });
    if (!url) {
      clearRows();
      return;
    }
    voiceOut.play(url);
  }

  function refreshHomeBgmButtons() {
    if (!_home.refs) return;
    for (const [key, ref] of _home.refs) {
      const ci = key.indexOf(':');
      const section = key.slice(0, ci);
      if (!isBgm(section)) continue;
      const active = bgm.isCurrent(key.slice(ci + 1));
      ref.el.classList.toggle('active', active);
      const n = ref.el.querySelector('.hbnote');
      if (n) n.textContent = bgm.glyph(active);
    }
  }

  function revokeHomeVoiceUrls() {
    revokeUrlMap(_homeVoiceUrls);
  }
  function closeHomeOverlay() {
    const ov = getById('homeOverlay');
    if (ov) ov.style.display = 'none';
    _homeView = null;
    voiceOut.stop();
    revokeHomeVoiceUrls();
  }
  function openOverlay(title, body, nav) {
    let ov = getById('homeOverlay');
    if (!ov) {
      ov = el('div', {
        id: 'homeOverlay',
        class: 'modalback',
        on: {
          click: (ev) => {
            if (ev.target === ov) closeHomeOverlay();
          },
        },
      });
      document.body.appendChild(ov);
    }
    const navBtn = (glyph, hint, onClick) => el('button', { class: 'btn xs hbnav', text: glyph, title: hint, style: nav ? null : { display: 'none' }, on: nav ? { click: onClick } : null });
    ov.innerHTML = '';
    ov.appendChild(
      el('div', 'modal homemodal', [
        el('div', 'modalhd', [
          navBtn('◀', '前 (←)', nav && nav.onPrev),
          el('span', 'homehdtitle', title),
          navBtn('▶', '次 (→)', nav && nav.onNext),
          el('button', { class: 'btn xs', text: '閉じる', on: { click: closeHomeOverlay } }),
        ]),
        el('div', 'modalbody', body),
      ]),
    );
    ov.style.display = '';
  }

  function bind() {
    bgm.bind();
    document.addEventListener('keydown', (ev) => {
      const ov = getById('homeOverlay');
      if (!ov || ov.style.display === 'none' || !_homeView) return;
      if (ev.key === 'ArrowLeft') {
        ev.preventDefault();
        openHomeAt(_homeView.section, _homeView.idx - 1);
      } else if (ev.key === 'ArrowRight') {
        ev.preventDefault();
        openHomeAt(_homeView.section, _homeView.idx + 1);
      } else if (ev.key === 'Escape') closeHomeOverlay();
    });
  }

  if (deps.homeBgm) Object.assign(deps.homeBgm, { applyVolume: bgm.applyVolume });

  return { renderHome, restoreHomeBgm: bgm.restore, bind, scrollToSection };
}
