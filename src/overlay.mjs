// Puts the brand on a finished picture: the logo at the top and the ad's headline at the bottom, on a
// maroon fade. It is done here, in code, because image models misspell words (Hebrew most of all) and
// redraw the logo differently every time. The model is asked to leave the top and bottom of the frame
// empty (see composePrompt in image.mjs), so nothing important sits under the logo or the headline.
//
// The headline is drawn in one of three or more modern fonts for its language (Hebrew, English or Arabic),
// chosen per ad: see src/fonts.mjs and src/headline.mjs. AD_FONT=<key> forces one (for example anton).
//
// Needs the `sharp`, `fontkit` and `bidi-js` packages, assets/meatlocker-logo.svg (the vector logo, made from
// the client's PDF) and the font files in assets/fonts/. AD_OVERLAY=off turns it off. If anything is missing
// the picture is returned unchanged, so an ad is never lost because of the overlay.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, ROOT } from './env.mjs';
import { warn } from './log.mjs';
import { FONTS, FALLBACK } from './fonts.mjs';

const LOGO = join(ROOT, 'assets/meatlocker-logo.svg');
const FONT_FILES = [...new Set([...Object.values(FONTS).flat(), FALLBACK].map((f) => join(ROOT, 'assets/fonts', f.file)))];
export const BRAND = { maroon: '#894136', tan: '#B79261', cream: '#FEF8DF' };

let sharp = null;
try { sharp = (await import('sharp')).default; } catch { /* the overlay stays off */ }
let headlineLib = null;
try { headlineLib = await import('./headline.mjs'); } catch { /* the overlay stays off */ }

/** True when pictures will get the logo and headline. Also decides whether the image prompt keeps room for them. */
export const overlayActive = () => config.overlay && Boolean(sharp) && Boolean(headlineLib) && existsSync(LOGO) && FONT_FILES.every((f) => existsSync(f));

/** A plain grey JPEG of px x px. Only the tests use it, through MOCK_IMAGE_PX, to have a picture big enough to brand. */
export const solidJpeg = (px) => sharp({ create: { width: px, height: px, channels: 3, background: '#d9d6d0' } }).jpeg().toBuffer();

/**
 * @param bytes     the picture, JPEG or PNG
 * @param headline  the ad's headline; omit it (or pass hasText) to add only the logo
 * @param seed      picks the headline font (the ad's id and picture number), so one ad keeps one font
 * @param font      a font key such as "anton", to force one; a revision passes the key it got the first time
 * @returns {Promise<{ bytes: Buffer, branded: boolean, font: string|null }>}  font is the key used, if a headline was drawn
 */
export async function brandImage(bytes, { headline = '', hasText = false, seed = '', font = '' } = {}) {
  if (!overlayActive()) return { bytes, branded: false, font: null };
  let usedFont = null;
  try {
    const base = sharp(bytes);
    const { width: w, height: h } = await base.metadata();
    if (!w || !h || w < 256 || h < 256) return { bytes, branded: false }; // the test pictures are 1x1
    const layers = [];
    const margin = Math.round(w * 0.05);

    // The logo, top centre, on the plain wall the model was asked to leave there.
    const logoW = Math.round(w * 0.3);
    const logo = await sharp(readFileSync(LOGO), { density: 300 }).resize({ width: logoW }).png().toBuffer();
    layers.push({ input: logo, top: margin, left: Math.round((w - logoW) / 2) });

    // The headline, bottom, in cream on a maroon fade.
    const text = String(headline).trim();
    if (text && !hasText) {
      const bandH = Math.round(h * 0.3);
      const fade = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${bandH}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="${BRAND.maroon}" stop-opacity="0"/><stop offset="0.65" stop-color="${BRAND.maroon}" stop-opacity="0.88"/>` +
        `<stop offset="1" stop-color="${BRAND.maroon}" stop-opacity="0.94"/></linearGradient></defs><rect width="${w}" height="${bandH}" fill="url(#g)"/></svg>`);
      layers.push({ input: fade, top: h - bandH, left: 0 });

      // Drawn as vector shapes (src/headline.mjs), in a font chosen for the headline's language.
      const label = headlineLib.renderHeadline(text, { color: BRAND.cream, maxWidth: Math.round(w * 0.86), maxHeight: Math.round(h * 0.17), maxLines: 2, seed, font });
      usedFont = label.font;
      layers.push({ input: await sharp(label.svg).png().toBuffer(), top: Math.max(0, h - margin - label.height), left: Math.round((w - label.width) / 2) });
    }

    const out = await base.composite(layers).jpeg({ quality: 90 }).toBuffer();
    return { bytes: out, branded: true, font: usedFont };
  } catch (e) {
    warn(`overlay: could not brand the picture, using it as drawn: ${e?.message ?? e}`);
    return { bytes, branded: false, font: null };
  }
}
