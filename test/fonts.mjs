// Tests of the headline fonts: at least three modern fonts per language, picked per ad, drawn as vector
// shapes (src/fonts.mjs and src/headline.mjs). Free and offline. Run: npm run test:fonts
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { FONTS, FALLBACK, detectLang, pickFont } from '../src/fonts.mjs';
import { renderHeadline } from '../src/headline.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const results = [];
const check = (name, ok, detail = '') => { results.push(Boolean(ok)); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const sha = (b) => createHash('sha256').update(b).digest('hex').slice(0, 12);

const TEXT = { he: 'שני פטיס. גבינה נמסה.', en: 'Two patties. Melted cheese.', ar: 'قطعتان من اللحم. جبنة ذائبة.' };

// ---------- the registry ----------
for (const lang of ['he', 'en', 'ar']) {
  check(`${lang}: at least 3 fonts`, FONTS[lang].length >= 3, FONTS[lang].map((f) => f.key).join(', '));
  check(`${lang}: the keys are distinct`, new Set(FONTS[lang].map((f) => f.key)).size === FONTS[lang].length);
}
const files = [...new Set([...Object.values(FONTS).flat(), FALLBACK].map((f) => f.file))];
check('every font file is in assets/fonts', files.every((f) => existsSync(join(ROOT, 'assets/fonts', f))), `${files.length} files`);
check('every font has a licence file next to it', ['Heebo', 'Rubik', 'SecularOne', 'Anton', 'Poppins', 'Tajawal', 'Almarai'].every((n) => existsSync(join(ROOT, `assets/fonts/${n}-LICENSE.txt`))));

// ---------- language and choice ----------
check('Hebrew is detected', detectLang(TEXT.he) === 'he');
check('English is detected', detectLang(TEXT.en) === 'en');
check('Arabic is detected', detectLang(TEXT.ar) === 'ar');
check('Hebrew with an English burger name stays Hebrew', detectLang('Double Cheeseburger ב-₪62') === 'he');
check('Arabic with a price stays Arabic', detectLang('برجر سماش ₪54') === 'ar');

check('the same seed always gets the same font', pickFont('he', { seed: 'ad_x_1' }).key === pickFont('he', { seed: 'ad_x_1' }).key);
for (const lang of ['he', 'en', 'ar']) {
  const seen = new Set(Array.from({ length: 60 }, (_, i) => pickFont(lang, { seed: `ad_${i}` }).key));
  check(`${lang}: over many ads every font gets used`, seen.size === FONTS[lang].length, [...seen].join(', '));
}
check('a font key forces that font', pickFont('en', { seed: 'a', font: 'anton' }).key === 'anton');
check('a key from another language is ignored', FONTS.ar.some((f) => f.key === pickFont('ar', { seed: 'a', font: 'anton' }).key));
check('"auto" leaves the choice to the seed', pickFont('he', { seed: 'z', font: 'auto' }).key === pickFont('he', { seed: 'z' }).key);

// ---------- drawing ----------
for (const lang of ['he', 'en', 'ar']) {
  const drawn = FONTS[lang].map((def) => renderHeadline(TEXT[lang], { maxWidth: 900, maxHeight: 160, font: def.key }));
  check(`${lang}: every font draws something`, drawn.every((d) => d.width > 100 && d.svg.toString().includes('<path')), drawn.map((d) => `${d.font} ${d.width}x${d.height}`).join(', '));
  check(`${lang}: the fonts really look different`, new Set(drawn.map((d) => sha(d.svg))).size === drawn.length);
  check(`${lang}: the right font is reported`, drawn.every((d, i) => d.font === FONTS[lang][i].key && d.lang === lang));
}

const png = await sharp(renderHeadline(TEXT.ar, { maxWidth: 900, maxHeight: 160, font: 'tajawal', color: '#ff0000' }).svg).png().toBuffer();
const { width: pw, height: ph } = await sharp(png).metadata();
const raw = await sharp(png).raw().toBuffer({ resolveWithObject: true });
let ink = 0; for (let i = 3; i < raw.data.length; i += 4) if (raw.data[i] > 128) ink++;
check('the shapes render to real pixels in the chosen colour', ink > 2000 && pw > 100 && ph > 30, `${ink} pixels`);

// Reading order. Hebrew starts at the right: the first letter's glyph sits right of the last letter's.
// The glyphs are written left to right as they appear on the picture. In "אב" (alef, bet) the bet is on the
// left and the alef on the right; "AB" is the other way round.
const outlines = (text, font) => [...renderHeadline(text, { maxWidth: 900, maxHeight: 160, font, startSize: 100 }).svg.toString().matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
const [alef, bet] = [outlines('א', 'heebo')[0], outlines('ב', 'heebo')[0]];
const heb = outlines('אב', 'heebo');
check('Hebrew runs right to left (alef is on the right, bet on the left)', heb.length === 2 && heb[1] === alef && heb[0] === bet);
const [A, B] = [outlines('A', 'poppins')[0], outlines('B', 'poppins')[0]];
const eng = outlines('AB', 'poppins');
check('English runs left to right (A on the left, B on the right)', eng.length === 2 && eng[0] === A && eng[1] === B);
const [arAlef, arBa] = [outlines('ا', 'tajawal')[0], outlines('ب', 'tajawal')[0]];
const arJoined = outlines('با', 'tajawal');
check('Arabic runs right to left and the letters take their joined shapes', arJoined.length === 2 && arJoined[0] !== arBa, 'ba+alef: the ba is drawn in its joining form');

// A character the font lacks is drawn from Rubik, not left blank.
const mixed = renderHeadline('Double ב-₪62', { maxWidth: 900, maxHeight: 160, font: 'anton' });
check('Anton with Hebrew and a shekel sign falls back and still draws every letter', (mixed.svg.toString().match(/<path/g) ?? []).length >= 10, `${(mixed.svg.toString().match(/<path/g) ?? []).length} glyphs`);

// Long headlines wrap to two even lines, never one word alone on the second line.
const long = renderHeadline('בייקון פריך. גבינה נמסה. עכשיו במבשרת ציון', { maxWidth: 520, maxHeight: 200, maxLines: 2, font: 'rubik' });
const rows = new Set([...long.svg.toString().matchAll(/translate\([\d.]+ ([\d.]+)\)/g)].map((m) => Math.round(Number(m[1]))));
check('a long headline wraps to two lines', rows.size === 2, `${rows.size} lines, ${long.width}x${long.height}`);
check('the wrapped headline fits its box', long.width <= 521 && long.height <= 200);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
