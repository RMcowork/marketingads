// The fonts a headline can be drawn in, three or more for each language. All are free (SIL Open Font
// License, licences in assets/fonts/). The headline is drawn by src/headline.mjs, not by the operating
// system, so it looks the same on a Mac, in Docker and on Railway.
//
// A font that lacks a character (a ₪ sign, an English burger name inside a Hebrew headline) is replaced
// for that stretch of text by Rubik, which covers Hebrew, Latin and Arabic.
import { createHash } from 'node:crypto';

const RUBIK = { key: 'rubik', name: 'Rubik ExtraBold', file: 'Rubik-Variable.ttf', variation: { wght: 800 } };

export const FONTS = {
  // Hebrew
  he: [
    { key: 'heebo', name: 'Heebo ExtraBold', file: 'Heebo_800ExtraBold.ttf' },      // clean and neutral
    RUBIK,                                                                           // rounded, friendly, young
    { key: 'secular', name: 'Secular One', file: 'SecularOne-Regular.ttf' },        // a classic Israeli poster face
  ],
  // English
  en: [
    { key: 'poppins', name: 'Poppins ExtraBold', file: 'Poppins-ExtraBold.ttf' },    // geometric and clear
    { key: 'anton', name: 'Anton', file: 'Anton-Regular.ttf', upper: true },         // tall, condensed, street poster
    RUBIK,
  ],
  // Arabic
  ar: [
    { key: 'tajawal', name: 'Tajawal ExtraBold', file: 'Tajawal-ExtraBold.ttf' },    // modern and sharp
    { key: 'almarai', name: 'Almarai ExtraBold', file: 'Almarai-ExtraBold.ttf' },    // wide and calm
    RUBIK,
  ],
};

export const FALLBACK = RUBIK;
export const RTL = { he: true, ar: true, en: false };

const HEBREW = /[֐-׿]/g;
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;

/** 'he', 'ar' or 'en', by whichever script has the most letters in the text. */
export function detectLang(text) {
  const he = (String(text).match(HEBREW) ?? []).length;
  const ar = (String(text).match(ARABIC) ?? []).length;
  if (!he && !ar) return 'en';
  return ar > he ? 'ar' : 'he';
}

/**
 * Picks the font for one ad. `font` (a key such as "anton") or AD_FONT forces one when the language has it.
 * Otherwise the seed (the ad's id and picture number) chooses, so each ad gets one font and keeps it.
 */
export function pickFont(lang, { seed = '', font = process.env.AD_FONT || '' } = {}) {
  const list = FONTS[lang] ?? FONTS.en;
  const wanted = String(font).toLowerCase();
  const forced = wanted && wanted !== 'auto' ? list.find((f) => f.key === wanted) : null;
  if (forced) return forced;
  const n = createHash('sha256').update(String(seed)).digest().readUInt32BE(0);
  return list[n % list.length];
}
