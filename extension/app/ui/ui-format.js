export const TYPE_LABEL = { character: 'キャラ', main: 'メイン', event: 'イベント', special: '特別', home: 'ホーム', other: 'その他3D', item: 'アイテム', monster: 'モンスター', other2d: 'その他2D' };

import { settings } from '../../core/settings.js';

export const chip = (rosterKind) => (TYPE_LABEL[rosterKind] ? `<span class="chip ${rosterKind}">${TYPE_LABEL[rosterKind]}</span>` : '');
export const nameFix = (s) => (s || '').replace(/%username%/gi, settings.get('playerName') || '主人公');
export const kanaKey = (s) =>
  String(s || '')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .toLowerCase();
export const spinnerHtml = (label) => '<div class="loadspin"><span class="spin"></span><span class="loadtxt">' + (label || '読み込み中…') + '</span></div>';
export const escapeHtml = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => {
    if (ch === '&') return '&amp;';
    if (ch === '<') return '&lt;';
    if (ch === '>') return '&gt;';
    if (ch === '"') return '&quot;';
    return '&#39;';
  });

class RawHtml {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}
export const raw = (v) => new RawHtml(v == null ? '' : String(v));
const renderHtmlValue = (v) => {
  if (v == null || v === false || v === true) return '';
  if (v instanceof RawHtml) return v.value;
  if (Array.isArray(v)) return v.map(renderHtmlValue).join('');
  return escapeHtml(v);
};
export const html = (strings, ...values) => new RawHtml(strings.reduce((acc, s, i) => acc + s + (i < values.length ? renderHtmlValue(values[i]) : ''), ''));
