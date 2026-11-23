// The ad agents' web service: one page and a small JSON API. The API needs the password.
//
//   GET  /health                          no password; the platform's health check
//   GET  /  and  /app.js                  the web page, no password (it holds nothing secret and asks for the password)
//   GET  /api/info                        brand name, image provider, today's usage
//   GET  /api/ads                         recent ads
//   POST /api/ads            {request}    start an ad: 202 and the job, status "working"
//   GET  /api/ads/:id                     one ad; poll until status is no longer "working"
//   POST /api/ads/:id/reply  {text, redraw}  a revision, in the same agent session
//   GET  /api/ads/:id/image[?n=2]         the picture (the latest one without n)
//
// Password: every /api call carries HTTP Basic auth with any user name and APP_PASSWORD as the password.
// The page asks for it once and sends it itself; with curl use -u any:$APP_PASSWORD. No WWW-Authenticate
// header is sent, so browsers never pop up their own login box.
import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { config, checkConfig, ROOT } from './env.mjs';
import { info, warn } from './log.mjs';
import { createJob, replyToJob, loadJob, listJobs, publicJob, imagePath, validId, usageToday, brandName, UserError } from './ads.mjs';
import { reviewEnabled, reviewOffReason } from './review.mjs';
import { clientKey, createThrottle, isHttps, isPlainHttp } from './security.mjs';

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
};
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  // Only this site's own script runs. No plug-ins, no <base> tricks, no form posts anywhere, no framing.
  'content-security-policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
};

// Wrong passwords are counted per client: too many and that client is locked out (src/security.mjs).
const throttle = createThrottle();

const digest = (s) => createHash('sha256').update(String(s)).digest();
const passwordDigest = digest(config.appPassword);

/** HTTP Basic auth: any user name, the password must equal APP_PASSWORD. */
export function authorized(header) {
  if (!config.appPassword) return false;
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(String(header ?? ''));
  if (!m) return false;
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  const password = decoded.slice(decoded.indexOf(':') + 1);
  return timingSafeEqual(digest(password), passwordDigest);
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, { ...SECURITY_HEADERS, 'cache-control': 'no-store', ...(isJson ? { 'content-type': 'application/json; charset=utf-8' } : {}), ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
}

/** The JSON body as an object. Counts bytes (not characters), and refuses anything that is not a JSON object. */
function readJson(req, limit = 20_000) {
  return new Promise((resolve, reject) => {
    // Too big: answer 413 first, then close the connection (the catch in createApp), so the sender gets a clear error.
    const tooBig = () => { const e = new UserError(413, 'Request body too large.'); e.closeAfter = true; return e; };
    if (Number(req.headers['content-length']) > limit) return reject(tooBig());
    const chunks = [];
    let size = 0, dead = false;
    req.on('data', (c) => {
      if (dead) return;
      size += c.length;
      if (size > limit) { dead = true; chunks.length = 0; reject(tooBig()); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        const body = raw ? JSON.parse(raw) : {};
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
        resolve(body);
      } catch { reject(new UserError(400, 'The body must be a JSON object.')); }
    });
    req.on('error', reject);
  });
}

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  if (path === '/health') return send(res, 200, 'ok', { 'content-type': 'text/plain' });

  // The password must never travel in clear text: a trusted proxy that says "http" is refused (platforms redirect to https first).
  if (isPlainHttp(req)) return send(res, 403, { error: 'This service only accepts https.' });

  if (req.method === 'GET' && STATIC[path]) {
    const [file, type] = STATIC[path];
    return send(res, 200, readFileSync(join(ROOT, 'public', file)), { 'content-type': type });
  }

  // Password guessing: a client with too many wrong passwords is answered without its password being looked at.
  const who = clientKey(req);
  const wait = throttle.blockedFor(who);
  if (wait) return send(res, 429, { error: `Too many wrong passwords. Try again in ${Math.ceil(wait / 60)} minute${wait > 60 ? 's' : ''}.` }, { 'retry-after': String(wait) });
  if (!authorized(req.headers.authorization)) {
    const { fails, locked } = throttle.fail(who);
    // Log the first few and the lockout, not every guess, so the log cannot be flooded.
    if (locked && fails === config.authMaxFailures) warn(`[security] ${who} locked out for ${Math.round(config.authLockoutMs / 60000)} minutes after ${fails} wrong passwords`);
    else if (fails <= 3) warn(`[security] wrong or missing password from ${who} (${fails} in this window) on ${req.method} ${path.slice(0, 60)}`);
    return send(res, 401, { error: 'Wrong or missing password.' });
  }
  throttle.ok(who);

  if (path === '/api/info' && req.method === 'GET') {
    return send(res, 200, { brand: brandName(), imageProvider: config.imageProvider, imageModel: config.imageModel, usage: usageToday() });
  }

  if (path === '/api/ads') {
    if (req.method === 'GET') return send(res, 200, { ads: listJobs() });
    if (req.method === 'POST') {
      const body = await readJson(req);
      if (typeof body.request !== 'string') throw new UserError(400, 'The body needs a "request" with the text of the ad.');
      return send(res, 202, createJob(body.request));
    }
    return send(res, 405, { error: 'Use GET or POST.' });
  }

  const m = /^\/api\/ads\/([^/]+)(\/reply|\/image)?$/.exec(path);
  if (m) {
    const [, id, action] = m;
    if (!validId(id)) return send(res, 404, { error: 'No ad with that id.' });
    if (!action && req.method === 'GET') {
      const job = loadJob(id);
      return job ? send(res, 200, publicJob(job)) : send(res, 404, { error: 'No ad with that id.' });
    }
    if (action === '/reply' && req.method === 'POST') {
      const body = await readJson(req);
      if (body.text !== undefined && typeof body.text !== 'string') throw new UserError(400, 'The "text" must be a string.');
      return send(res, 202, replyToJob(id, body.text, { redraw: body.redraw === true }));
    }
    if (action === '/image' && req.method === 'GET') {
      const n = url.searchParams.has('n') ? Number(url.searchParams.get('n')) : 0;
      const file = Number.isInteger(n) && n >= 0 ? imagePath(loadJob(id), n) : null;
      if (!file) return send(res, 404, { error: 'No picture.' });
      return send(res, 200, readFileSync(file), { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400', 'content-disposition': `inline; filename="${id}${n ? `_${n}` : ''}.jpg"` });
    }
  }
  return send(res, 404, { error: 'Not found.' });
}

export function createApp() {
  const server = createServer((req, res) => {
    if (isHttps(req)) res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
    route(req, res).catch((e) => {
      if (e instanceof UserError) {
        if (e.closeAfter) res.once('finish', () => req.destroy()); // stop reading the rest of an oversized body
        return send(res, e.status, { error: e.message }, e.closeAfter ? { connection: 'close' } : {});
      }
      warn(`${req.method} ${String(req.url).slice(0, 120)} failed:`, e?.message ?? e);
      if (!res.headersSent) send(res, 500, { error: 'Something went wrong on the server. See the server log.' });
    });
  });
  // Slow-loris protection: a client has seconds, not minutes, to send its headers and its small JSON body.
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 60;
  return server;
}

const isMain = (() => { try { return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; } })();
if (isMain) {
  const { fatal, warnings } = checkConfig();
  for (const w of warnings) warn(`[config] ${w}`);
  if (!reviewEnabled()) warn(`[config] ads are NOT being reviewed by a second model (${reviewOffReason()}).`);
  if (fatal.length) { for (const f of fatal) console.error(`[config] ${f}`); process.exit(1); }
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
  // The last line of defence for anything not caught where it happened: log it (with secrets removed), and
  // never carry on in an unknown state after a crash. The platform restarts the service.
  process.on('unhandledRejection', (reason) => warn('[error] unhandled rejection:', reason instanceof Error ? (reason.stack ?? reason.message) : reason));
  process.on('uncaughtException', (e) => { warn('[error] uncaught exception, exiting:', e?.stack ?? e); process.exit(1); });
  if (config.production && !config.trustProxy) warn('[config] AD_TRUST_PROXY is off in production: the login lockout sees every visitor as the proxy, and plain http is not refused. Turn it on when a proxy sits in front.');
  createApp().listen(config.port, () => {
    info(`ad agents listening on http://localhost:${config.port}  (data: ${config.dataDir}, images: ${config.imageProvider})`);
  });
  if (config.telegramToken) (await import('./telegram.mjs')).startTelegram();
}
