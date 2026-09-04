const utf8 = new TextDecoder('utf-8');
const HEADER_RE = /^(size|format|filter|repeat|pma):/;

function splitAtlasPages(text) {
  const lines = String(text).split(/\r?\n/);
  const pages = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln.trim() || /^[ \t]/.test(ln) || ln.includes(':')) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    if (j < lines.length && HEADER_RE.test(lines[j])) pages.push({ name: ln.trim(), start: i, end: lines.length });
  }
  for (let i = 0; i + 1 < pages.length; i++) pages[i].end = pages[i + 1].start;
  return { lines, pages };
}

function atlasPageNames(atlasBytes) {
  if (!atlasBytes || !atlasBytes.length) return [];
  return splitAtlasPages(utf8.decode(atlasBytes)).pages.map((p) => p.name);
}

const baseNameOf = (name) =>
  String(name || '')
    .replace(/\.[^.]*$/, '')
    .toLowerCase();

function textureForPage(textures, pageName, index) {
  const base = baseNameOf(pageName);
  return textures.find((t) => baseNameOf(t.name) === base) || textures[index] || textures[0] || null;
}

function textureListOf(input) {
  const list = (Array.isArray(input && input.textures) ? input.textures : []).filter((t) => t && t.rgba && t.width && t.height);
  if (list.length) return list;
  const t = input && input.texture;
  return t && t.rgba && t.width && t.height ? [{ name: t.name || '', rgba: t.rgba, width: t.width, height: t.height }] : [];
}

const scaleAtlasText = (text, sx, sy) =>
  text.replace(/^([ \t]*)(size|xy|orig|offset):[ \t]*(-?\d+)[ \t]*,[ \t]*(-?\d+)[ \t]*$/gim, (m, ind, key, a, b) => `${ind}${key}: ${Math.round(Number(a) * sx)},${Math.round(Number(b) * sy)}`);

function prepareAtlas(input, tokenFor) {
  const textures = textureListOf(input);
  const { lines, pages } = splitAtlasPages(utf8.decode(input.atlasBytes));
  if (!pages.length) return { text: lines.join('\n'), pages: [], textures };
  const out = lines.slice(0, pages[0].start);
  const used = [];
  pages.forEach((p, i) => {
    const tex = textureForPage(textures, p.name, i);
    let block = lines.slice(p.start, p.end);
    const m = block.join('\n').match(/^size:[ \t]*(\d+)[ \t]*,[ \t]*(\d+)[ \t]*$/m);
    if (tex && m) {
      const pw = Number(m[1]);
      const ph = Number(m[2]);
      if (pw > 0 && ph > 0 && (pw !== tex.width || ph !== tex.height)) block = scaleAtlasText(block.join('\n'), tex.width / pw, tex.height / ph).split('\n');
    }
    const token = tokenFor ? tokenFor(i, p.name, tex) : p.name;
    block = block.slice();
    block[0] = token;
    used.push({ name: p.name, token, tex });
    out.push(...block);
  });
  return { text: out.join('\n'), pages: used, textures };
}

export const spineAtlas = { splitAtlasPages, atlasPageNames, textureForPage, textureListOf, prepareAtlas };
