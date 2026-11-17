// Tests of the logo and headline overlay: the module on its own, then through the real server (fake agent,
// mock picture of 640x640 pixels). Free and offline. Run: npm run test:overlay
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const ROOT = resolve(import.meta.dirname, '..');
const results = [];
const check = (name, ok, detail = '') => { results.push(Boolean(ok)); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- the module ----------
const { brandImage, overlayActive, solidJpeg } = await import('../src/overlay.mjs');
check('the overlay is active (sharp, logo and font are all present)', overlayActive());
const plain = await solidJpeg(1000);
const sizes = { square: [1000, 1000], portrait: [1000, 1500], landscape: [1500, 1000] };
for (const [name, [w, h]] of Object.entries(sizes)) {
  const src = await sharp({ create: { width: w, height: h, channels: 3, background: '#d9d6d0' } }).jpeg().toBuffer();
  const r = await brandImage(src, { headline: 'שני פטיס. גבינה נמסה.' });
  const meta = await sharp(r.bytes).metadata();
  check(`${name}: branded, same size, still a JPEG`, r.branded && meta.format === 'jpeg' && meta.width === w && meta.height === h, `${meta.width}x${meta.height}`);
}
{
  const a = await sharp(plain).raw().toBuffer({ resolveWithObject: true });
  const r = await brandImage(plain, { headline: 'שני פטיס. גבינה נמסה.' });
  const b = await sharp(r.bytes).raw().toBuffer({ resolveWithObject: true });
  const px = (img, x, y) => { const i = (y * img.info.width + x) * img.info.channels; return [...img.data.subarray(i, i + 3)]; };
  const dist = (p, q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
  check('the bottom of the picture turns maroon under the headline', dist(px(a, 20, 990), px(b, 20, 990)) > 120, `${px(b, 20, 990)}`);
  check('the middle of the picture is left alone', dist(px(a, 500, 500), px(b, 500, 500)) < 6);
  // The logo sits at the top centre: some pixel there must differ from plain grey.
  let changed = 0;
  for (let y = 50; y < 150; y += 5) for (let x = 400; x < 600; x += 5) if (dist(px(a, x, y), px(b, x, y)) > 60) changed++;
  check('the logo is drawn at the top centre', changed > 20, `${changed} pixels`);
  // Headline text: cream pixels in the bottom strip.
  let cream = 0;
  for (let y = 880; y < 980; y += 2) for (let x = 100; x < 900; x += 2) { const p = px(b, x, y); if (p[0] > 235 && p[1] > 225 && p[2] > 190) cream++; }
  check('the headline is drawn in cream at the bottom', cream > 300, `${cream} pixels`);
}
{
  const r = await brandImage(plain, { headline: 'כותרת', hasText: true });
  const bottom = await sharp(r.bytes).extract({ left: 100, top: 900, width: 800, height: 80 }).stats();
  check('a picture that already has words gets the logo but no headline fade', r.branded && bottom.channels[0].mean > 200, `mean red ${bottom.channels[0].mean.toFixed(0)}`);
}
const tiny = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
check('a tiny picture is returned unchanged', (await brandImage(tiny, { headline: 'x' })).branded === false);
check('bytes that are not an image are returned unchanged, not thrown', (await brandImage(Buffer.from('nope'), { headline: 'x' })).branded === false);

// ---------- through the server ----------
const WORK = mkdtempSync(join(tmpdir(), 'ad-agents-ov-'));
const PORT = 3106;
const BASE = `http://localhost:${PORT}`;
const PASSWORD = 'test-password-123';
const auth = { authorization: 'Basic ' + Buffer.from(`x:${PASSWORD}`).toString('base64') };
const server = spawn('node', [join(ROOT, 'src/server.mjs')], { cwd: WORK, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(PORT), APP_PASSWORD: PASSWORD, AD_AGENT_DRIVER: 'fake', IMAGE_PROVIDER: 'mock', MOCK_IMAGE_PX: '640', FAKE_AGENT_DELAY_MS: '50', DATA_DIR: '', TELEGRAM_BOT_TOKEN: '', TELEGRAM: '' } });
let log = '';
server.stdout.on('data', (d) => { log += d; });
server.stderr.on('data', (d) => { log += d; });
const call = (path, opts = {}) => fetch(BASE + path, { ...opts, headers: { ...auth, 'content-type': 'application/json', ...(opts.headers ?? {}) } });
async function until(id) { for (let i = 0; i < 80; i++) { const j = await (await call(`/api/ads/${id}`)).json(); if (j.status !== 'working') return j; await sleep(100); } throw new Error('timeout'); }
try {
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/health`); break; } catch { await sleep(150); } }
  const a = await (await call('/api/ads', { method: 'POST', body: JSON.stringify({ request: 'מודעה ליום שישי: דאבל צ׳יזבורגר, 2 ב-100, מבשרת ציון' }) })).json();
  const d1 = await until(a.id);
  const img1 = Buffer.from(await (await call(d1.image.url)).arrayBuffer());
  const m1 = await sharp(img1).metadata();
  const files = () => readdirSync(join(WORK, 'data/ads'));
  check('the served picture is a branded 640x640 JPEG', d1.image.count === 1 && m1.width === 640 && m1.format === 'jpeg');
  check('the picture as drawn is kept next to it', files().includes(`${a.id}_1_raw.jpg`));
  check('the branded picture differs from the raw one', !img1.equals(readFileSync(join(WORK, 'data/ads', `${a.id}_1_raw.jpg`))));

  await call(`/api/ads/${a.id}/reply`, { method: 'POST', body: JSON.stringify({ text: 'קצר יותר' }) });
  const d2 = await until(a.id);
  check('a change that keeps the headline keeps the same picture', d2.image.count === 1);

  await call(`/api/ads/${a.id}/reply`, { method: 'POST', body: JSON.stringify({ text: '[NEWHEAD] כותרת אחרת' }) });
  const d3 = await until(a.id);
  const img3 = Buffer.from(await (await call(d3.image.url)).arrayBuffer());
  check('a new headline is put on the picture again, without drawing a new one', d3.image.count === 2 && !img3.equals(img1) && /new headline put on the picture/.test(log) && (log.match(/picture \d drawn/g) ?? []).length === 1, `count ${d3.image.count}`);
  check('the old picture is still available', (await call(`/api/ads/${a.id}/image?n=1`)).status === 200);
} catch (e) {
  console.error('test runner error:', e);
  results.push(false);
} finally {
  server.kill('SIGTERM');
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed  (work dir: ${WORK})`);
if (failed) console.log('--- server log ---\n' + log.split('\n').slice(-20).join('\n'));
process.exit(failed ? 1 : 0);
