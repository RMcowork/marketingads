// Puts the brand on a finished picture: the logo at the top and the ad's headline at the bottom, on a
// maroon fade. It is done here, in code, because image models misspell words (Hebrew most of all) and
// redraw the logo differently every time. The model is asked to leave the top and bottom of the frame
// empty (see composePrompt in image.mjs), so nothing important sits under the logo or the headline.
//
// Needs the `sharp` package, assets/meatlocker-logo.svg (the vector logo, made from the client's PDF) and
// assets/fonts/Heebo_800ExtraBold.ttf. AD_OVERLAY=off turns it off. If anything is missing the picture is
// returned unchanged, so an ad is never lost because of the overlay.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, ROOT } from './env.mjs';
import { warn } from './log.mjs';

const LOGO = join(ROOT, 'assets/meatlocker-logo.svg');
const FONT = join(ROOT, 'assets/fonts/Heebo_800ExtraBold.ttf');
export const BRAND = { maroon: '#894136', tan: '#B79261', cream: '#FEF8DF' };

let sharp = null;
try { sharp = (await import('sharp')).default; } catch { /* the overlay stays off */ }

/** True when pictures will get the logo and headline. Also decides whether the image prompt keeps room for them. */
export const overlayActive = () => config.overlay && Boolean(sharp) && existsSync(LOGO) && existsSync(FONT);

/** A plain grey JPEG of px x px. Only the tests use it, through MOCK_IMAGE_PX, to have a picture big enough to brand. */
export const solidJpeg = (px) => sharp({ create: { width: px, height: px, channels: 3, background: '#d9d6d0' } }).jpeg().toBuffer();

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * @param bytes     the picture, JPEG or PNG
 * @param headline  the ad's headline; omit it (or pass hasText) to add only the logo
 * @returns {Promise<{ bytes: Buffer, branded: boolean }>}
 */
export async function brandImage(bytes, { headline = '', hasText = false } = {}) {
  if (!overlayActive()) return { bytes, branded: false };
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

      const boxW = Math.round(w * 0.86);
      const boxH = Math.round(h * 0.14);
      const label = await sharp({
        text: { text: `<span foreground="${BRAND.cream}">${esc(text)}</span>`, font: 'Heebo ExtraBold', fontfile: FONT, width: boxW, height: boxH, align: 'center', rgba: true },
      }).png().toBuffer();
      const lm = await sharp(label).metadata();
      layers.push({ input: label, top: Math.max(0, h - margin - lm.height), left: Math.round((w - lm.width) / 2) });
    }

    const out = await base.composite(layers).jpeg({ quality: 90 }).toBuffer();
    return { bytes: out, branded: true };
  } catch (e) {
    warn(`overlay: could not brand the picture, using it as drawn: ${e?.message ?? e}`);
    return { bytes, branded: false };
  }
}
