import { scenarioSettings } from './scenario-settings.js';
import { mk } from '../../core/dom.js';

const { VOL_MAX } = scenarioSettings;

const HEADER = [120, 22, 896, 50];
const VOL_ROWS = [
  { key: 'bgm', label: 'BGM', labelW: 50, sliderTop: 141, textTop: 144 },
  { key: 'se', label: 'SE', labelW: 50, sliderTop: 202, textTop: 205 },
  { key: 'voice', label: 'ボイス', labelW: 70, sliderTop: 261, textTop: 264 },
];
const LABEL_X = 243;
const MIN_X = 313;
const SLIDER_X = 338;
const SLIDER_W = 500;
const TICKS_X = 374;
const TICKS_W = 428;
const VALUE_X = 853;
const DEFAULT_VOL_RECT = [228, 311, 160, 28];
const ALL_LABEL_RECT = [728, 313, 70, 26];
const ALL_TOGGLE_RECT = [805, 310, 92, 32];
const OPT_X = [645, 769, 887];
const RADIO_ROWS = [
  { key: 'alpha', label: 'テキストウィンドウの透明度変更', opts: ['低', '中', '高'], subTop: 373, optTop: 370 },
  { key: 'speed', label: 'テキストの速度設定', opts: ['低', '中', '高'], subTop: 443, optTop: 440 },
  { key: 'voiceContinue', label: 'メッセージ送り時の音声継続', opts: ['ON', 'OFF'], subTop: 513, optTop: 510 },
];
const SUB_X = 123;
const SUB_W = 500;
const FOOT = { reset: [134, 568, 190, 45], cancel: [616, 568, 180, 45], decide: [818, 568, 180, 45] };

const place = (e, r) => {
  e.style.left = r[0] + 'px';
  e.style.top = r[1] + 'px';
  e.style.width = r[2] + 'px';
  e.style.height = r[3] + 'px';
  return e;
};

function create(parent) {
  const wrap = mk('div', 'setwin', parent);
  place(mk('div', 'setHeader', wrap, 'システム設定'), HEADER);

  const sliders = {};
  for (const row of VOL_ROWS) {
    place(mk('div', 'setLabel', wrap, row.label), [LABEL_X, row.textTop, row.labelW, 30]);
    place(mk('div', 'setMin', wrap, '0'), [MIN_X, row.textTop, 20, 30]);
    const s = place(mk('input', 'setSlider', wrap), [SLIDER_X, row.sliderTop, SLIDER_W, 36]);
    s.type = 'range';
    s.min = '0';
    s.max = String(VOL_MAX);
    s.step = '1';
    place(mk('div', 'setTicks', wrap), [TICKS_X, row.sliderTop, TICKS_W, 23]);
    const val = place(mk('div', 'setVal', wrap), [VALUE_X, row.textTop, 40, 30]);
    s.oninput = () => {
      scenarioSettings.apply({ [row.key]: Number(s.value) });
      sync();
    };
    sliders[row.key] = { input: s, val };
  }

  const btnVolDefault = place(mk('button', 'setBtn setBtnSm', wrap, '音声を初期値に戻す'), DEFAULT_VOL_RECT);
  place(mk('div', 'setLabel', wrap, '全音声'), ALL_LABEL_RECT);
  const allBtn = place(mk('button', 'setToggle', wrap), ALL_TOGGLE_RECT);

  const radios = {};
  for (const row of RADIO_ROWS) {
    place(mk('div', 'setSub', wrap, row.label), [SUB_X, row.subTop, SUB_W, 34]);
    radios[row.key] = row.opts.map((t, i) => {
      const b = place(mk('button', 'setOpt', wrap), [OPT_X[i], row.optTop, 82, 40]);
      mk('span', 'setMark', b);
      mk('span', 'setOptText', b, t);
      b.onclick = () => {
        draft[row.key] = i;
        sync();
      };
      return b;
    });
  }

  const btnReset = place(mk('button', 'setBtn', wrap, '全て初期値に戻す'), FOOT.reset);
  const btnCancel = place(mk('button', 'setBtn', wrap, 'キャンセル'), FOOT.cancel);
  const btnOk = place(mk('button', 'setBtn setBtnMain', wrap, '決定'), FOOT.decide);

  let snapshot = null;
  let draft = {};

  function sync() {
    const st = scenarioSettings.get();
    for (const row of VOL_ROWS) {
      const s = sliders[row.key];
      s.input.value = String(st[row.key]);
      s.input.style.setProperty('--fill', (st[row.key] / VOL_MAX) * 100 + '%');
      s.val.textContent = String(st[row.key] * 10);
    }
    const allOff = VOL_ROWS.every((r) => st[r.key] === 0);
    allBtn.textContent = allOff ? 'OFF' : 'ON';
    allBtn.classList.toggle('on', !allOff);
    for (const row of RADIO_ROWS) row.opts.forEach((t, i) => radios[row.key][i].classList.toggle('on', draft[row.key] === i));
  }

  const volDefaults = () => {
    const d = scenarioSettings.defaults();
    return { bgm: d.bgm, se: d.se, voice: d.voice };
  };
  allBtn.onclick = () => {
    const st = scenarioSettings.get();
    scenarioSettings.apply(VOL_ROWS.every((r) => st[r.key] === 0) ? volDefaults() : { bgm: 0, se: 0, voice: 0 });
    sync();
  };
  btnVolDefault.onclick = () => {
    scenarioSettings.apply(volDefaults());
    sync();
  };
  btnReset.onclick = () => {
    const d = scenarioSettings.defaults();
    scenarioSettings.apply(volDefaults());
    draft = { alpha: d.alpha, speed: d.speed, voiceContinue: d.voiceContinue };
    sync();
  };

  let onClose = null;
  const close = () => {
    wrap.classList.remove('open');
    if (onClose) onClose();
  };
  btnCancel.onclick = () => {
    if (snapshot) scenarioSettings.apply(snapshot);
    close();
  };
  btnOk.onclick = () => {
    scenarioSettings.apply(draft);
    scenarioSettings.save();
    close();
  };
  wrap.onclick = (e) => e.stopPropagation();

  return {
    open(closeHandler) {
      onClose = closeHandler || null;
      snapshot = { ...scenarioSettings.get() };
      draft = { alpha: snapshot.alpha, speed: snapshot.speed, voiceContinue: snapshot.voiceContinue };
      sync();
      wrap.classList.add('open');
    },
    isOpen: () => wrap.classList.contains('open'),
  };
}

export const settingsWindow = { create };
