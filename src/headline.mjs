// Draws an ad headline as vector shapes (an SVG made of glyph outlines) that sharp can lay on the picture.
//
// Why not let sharp draw the text: its text renderer asks the operating system for fonts, and on a Mac it
// ignores the font files in assets/fonts/ and quietly falls back to a system font. Here fontkit reads the
// font file itself and shapes the text (Arabic letters join, Hebrew and English mix in the right order),
// so the result is the same everywhere and needs no font installed.
import { join } from 'node:path';
import * as fontkit from 'fontkit';
import bidiFactory from 'bidi-js';
import { ROOT } from './env.mjs';
import { FALLBACK, RTL, detectLang, pickFont } from './fonts.mjs';

const bidi = bidiFactory();
const cache = new Map();

function load(def) {
  if (!cache.has(def.key)) {
    const font = fontkit.openSync(join(ROOT, 'assets/fonts', def.file));
    cache.set(def.key, def.variation ? font.getVariation(def.variation) : font);
  }
  return cache.get(def.key);
}

const covers = (font, text) => [...text].every((ch) => /\s/.test(ch) || font.hasGlyphForCodePoint(ch.codePointAt(0)));

/** One line of text in logical order -> glyph outlines in visual order, with their width (in font units of `size`). */
function layoutLine(text, primaryDef, baseRtl, size) {
  const { levels } = bidi.getEmbeddingLevels(text, baseRtl ? 'rtl' : 'ltr');
  // Runs of equal direction level, then reordered into visual order (the Unicode bidi rule L2).
  let runs = [];
  for (let i = 0, start = 0; i <= text.length; i++) {
    if (i === text.length || levels[i] !== levels[start]) { if (i > start) runs.push({ start, end: i, level: levels[start] }); start = i; }
  }
  const lv = runs.map((r) => r.level);
  const high = Math.max(0, ...lv), lowOdd = Math.min(...lv.filter((l) => l % 2 === 1), Infinity);
  for (let level = high; level >= lowOdd && level > 0; level--) {
    for (let i = 0; i < runs.length; i++) {
      if (runs[i].level < level) continue;
      let j = i;
      while (j + 1 < runs.length && runs[j + 1].level >= level) j++;
      const rev = runs.slice(i, j + 1).reverse();
      runs.splice(i, rev.length, ...rev);
      i = j;
    }
  }

  const primary = load(primaryDef), fallback = load(FALLBACK);
  const glyphs = [];
  let pen = 0;
  for (const run of runs) {
    const rtl = run.level % 2 === 1;
    let part = text.slice(run.start, run.end);
    if (rtl) part = [...part].map((ch) => bidi.getMirroredCharacter(ch) ?? ch).join('');
    const font = covers(primary, part) || !covers(fallback, part) ? primary : fallback;
    const scale = size / font.unitsPerEm;
    const shaped = font.layout(part, undefined, undefined, undefined, rtl ? 'rtl' : 'ltr');
    shaped.glyphs.forEach((g, i) => {
      const p = shaped.positions[i];
      const d = g.path.toSVG();
      if (d) glyphs.push({ d, x: pen + p.xOffset * scale, y: p.yOffset * scale, scale });
      pen += p.xAdvance * scale;
    });
  }
  return { glyphs, width: pen };
}

/** Greedy word wrap, then the narrowest width that keeps the same number of lines, so the lines are even. */
function wrap(text, maxWidth, measure) {
  const words = text.split(/\s+/).filter(Boolean);
  const fill = (limit) => {
    const lines = [];
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (line && measure(next) > limit) { lines.push(line); line = w; } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };
  const first = fill(maxWidth);
  if (first.length < 2) return first;
  let lo = Math.max(...words.map(measure)), hi = maxWidth;
  while (hi - lo > 2) {
    const mid = (lo + hi) / 2;
    if (fill(mid).length === first.length) hi = mid; else lo = mid;
  }
  return fill(hi);
}

/**
 * @param text  the headline
 * @param opts  { color, maxWidth, maxHeight, maxLines = 2, startSize, seed, font }
 * @returns {{ svg: Buffer, width: number, height: number, font: string, lang: string }}  the picture of the text
 */
export function renderHeadline(text, { color = '#FEF8DF', maxWidth, maxHeight, maxLines = 2, startSize, seed = '', font = '' } = {}) {
  const lang = detectLang(text);
  const def = pickFont(lang, { seed, font });
  const clean = (def.upper && lang === 'en' ? String(text).toUpperCase() : String(text)).replace(/\s+/g, ' ').trim();
  const rtl = RTL[lang];

  let size = startSize ?? Math.round(maxHeight * 0.55);
  for (;;) {
    const lines = wrap(clean, maxWidth, (s) => layoutLine(s, def, rtl, size).width);
    const lineH = size * 1.22;
    const fits = lines.length <= maxLines && lines.length * lineH <= maxHeight && lines.every((l) => layoutLine(l, def, rtl, size).width <= maxWidth + 1);
    if (fits || size <= 14) {
      const laid = lines.map((l) => layoutLine(l, def, rtl, size));
      const width = Math.ceil(Math.max(...laid.map((l) => l.width)));
      const height = Math.ceil(laid.length * lineH);
      const body = laid.map((l, i) => {
        const x0 = (width - l.width) / 2, base = i * lineH + size * 0.95;
        return l.glyphs.map((g) => `<path transform="translate(${(x0 + g.x).toFixed(2)} ${(base - g.y).toFixed(2)}) scale(${g.scale.toFixed(5)} ${(-g.scale).toFixed(5)})" d="${g.d}"/>`).join('');
      }).join('');
      const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g fill="${color}">${body}</g></svg>`);
      return { svg, width, height, font: def.key, lang };
    }
    size = Math.floor(size * 0.93);
  }
}
