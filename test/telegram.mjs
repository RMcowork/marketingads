// Offline test of the Telegram bot: the real server with a fake agent and a mock image model, talking to a
// fake Telegram API that this script runs. No network, no cost. Run: npm run test:telegram
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const WORK = mkdtempSync(join(tmpdir(), 'ad-agents-tg-'));
const TOKEN = '111:TESTTOKEN_do_not_log_me';
const OWNER = 111;
const STRANGER = 999;
const FAKE_PORT = 3105;
const REQUEST = 'מודעה ליום שישי: דאבל צ׳יזבורגר, 2 ב-100, תל אביב';

// ---------- a fake Telegram Bot API ----------
const sent = [];          // everything the bot sent: { kind: 'text' | 'photo', chat, text, mid }
const queue = [];         // updates waiting for getUpdates
let updateId = 0;
let messageId = 1000;
const calls = [];
const fakeApi = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const method = req.url.split('/').pop();
  calls.push({ url: req.url, method });
  const reply = (result) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, result })); };
  if (!req.url.startsWith(`/bot${TOKEN}/`)) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: false, description: 'Unauthorized' })); }
  if (method === 'getMe') return reply({ id: 1, username: 'testbot' });
  if (method === 'deleteWebhook') return reply(true);
  if (method === 'getUpdates') {
    const body = JSON.parse(raw.toString() || '{}');
    for (let i = 0; i < 10; i++) {
      const ready = queue.filter((u) => u.update_id >= (body.offset ?? 0));
      if (ready.length) return reply(ready);
      await new Promise((r) => setTimeout(r, 50));
    }
    return reply([]);
  }
  if (method === 'sendMessage') {
    const b = JSON.parse(raw.toString());
    const mid = ++messageId;
    sent.push({ kind: 'text', chat: b.chat_id, text: b.text, mid });
    return reply({ message_id: mid });
  }
  if (method === 'sendPhoto') {
    const body = raw.toString('utf8');
    const caption = /name="caption"\r\n\r\n([\s\S]*?)\r\n--/.exec(body)?.[1] ?? '';
    const chat = Number(/name="chat_id"\r\n\r\n(\d+)/.exec(body)?.[1]);
    const mid = ++messageId;
    sent.push({ kind: 'photo', chat, text: caption, mid, jpeg: /Content-Type: image\/jpeg/.test(body) });
    return reply({ message_id: mid });
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: false, description: `unknown method ${method}` }));
});
await new Promise((r) => fakeApi.listen(FAKE_PORT, '127.0.0.1', r));

const say = (chat, text, extra = {}) => {
  const message = { message_id: ++messageId, chat: { id: chat, type: 'private' }, ...(text === null ? { sticker: {} } : { text }), ...extra };
  queue.push({ update_id: ++updateId, message });
  return message.message_id;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, ms = 10_000) {
  for (let t = 0; t < ms; t += 50) { const v = pred(); if (v) return v; await sleep(50); }
  return null;
}
const mine = (chat = OWNER) => sent.filter((s) => s.chat === chat);
const photos = () => mine().filter((s) => s.kind === 'photo');

const results = [];
const check = (name, ok, detail = '') => { results.push(Boolean(ok)); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };

// ---------- the real server ----------
const env = {
  ...process.env, PORT: '3104', APP_PASSWORD: 'test-password-123', AD_AGENT_DRIVER: 'fake', IMAGE_PROVIDER: 'mock',
  FAKE_AGENT_DELAY_MS: '100', MAX_RUNS_PER_DAY: '20', MAX_PARALLEL_RUNS: '3', DATA_DIR: '',
  TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM: '', TELEGRAM_ALLOWED_CHAT_IDS: String(OWNER), TELEGRAM_API_BASE: `http://127.0.0.1:${FAKE_PORT}`,
  TELEGRAM_LONG_POLL_SECONDS: '1', TELEGRAM_WAIT_POLL_MS: '100',
};
const server = spawn('node', [join(ROOT, 'src/server.mjs')], { cwd: WORK, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (d) => { log += d; });
server.stderr.on('data', (d) => { log += d; });
const adFiles = () => (existsSync(join(WORK, 'data/ads')) ? readdirSync(join(WORK, 'data/ads')).filter((f) => f.endsWith('.json')) : []);

try {
  check('the bot starts and says which bot is listening', await waitFor(() => /bot @testbot is listening \(1 allowed chat\)/.test(log)));
  check('it clears any old webhook before polling', calls.some((c) => c.method === 'deleteWebhook'));

  // A stranger can learn their id and nothing else
  say(STRANGER, '/myid');
  check('a stranger gets their own chat id', await waitFor(() => mine(STRANGER).some((s) => s.text.includes(`Your chat id is ${STRANGER}`))));
  say(STRANGER, REQUEST);
  await sleep(1200);
  check('a stranger cannot make an ad', mine(STRANGER).length === 1 && adFiles().length === 0, `${mine(STRANGER).length} replies, ${adFiles().length} ads`);

  // A new ad from the owner: acknowledgement, then picture + copy
  say(OWNER, REQUEST);
  check('the owner gets an acknowledgement in Hebrew', await waitFor(() => mine().some((s) => s.kind === 'text' && /קיבלתי/.test(s.text))));
  const first = await waitFor(() => photos()[0]);
  check('the draft arrives as a JPEG photo with the copy as its caption', first && first.jpeg && first.text.includes('#MeatLocker') && first.text.includes('דאבל צ׳יזבורגר ליום שישי'), first?.text?.slice(0, 40));
  check('the caption fits Telegram\'s 1024 limit', first && first.text.length <= 1024, String(first?.text.length));
  check('the agent\'s note and the how-to hint follow', await waitFor(() => mine().some((s) => /^הערה: /.test(s.text)) && mine().some((s) => /השיבו עם מה לשנות/.test(s.text))));

  // A change, as a reply to the draft: copy only, no new picture
  say(OWNER, 'קצר יותר', { reply_to_message: { message_id: first.mid } });
  const short = await waitFor(() => mine().find((s) => s.kind === 'text' && s.text.includes('שני פטיס צרובים וגבינה נמסה. 2 ב-100. בואו.')));
  check('a change comes back as text, with no new picture', short && photos().length === 1);

  // A plain message while an ad is open is also a change
  say(OWNER, 'תמונה אחרת');
  check('"תמונה אחרת" draws a second picture', await waitFor(() => photos().length === 2));

  // /myid for the owner
  say(OWNER, '/myid');
  check('the owner is told they are allowed', await waitFor(() => mine().some((s) => /You are allowed to use this bot/.test(s.text))));

  // ok approves and closes
  say(OWNER, 'ok');
  check('"ok" saves and says nothing is posted', await waitFor(() => mine().some((s) => /נשמר/.test(s.text))));
  const approved = readdirSync(join(WORK, 'data/ads')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(WORK, 'data/ads', f), 'utf8'))).filter((j) => j.approved);
  check('the job is marked approved on disk', approved.length === 1);

  // Nothing open: ok again says so
  say(OWNER, 'ok');
  check('"ok" with nothing open says so (in English: nothing tells us the language)', await waitFor(() => mine().some((s) => s.text === 'No ad is open. Write what to advertise.')));

  // The agent asks a question; the owner's next plain message answers it
  const before = photos().length;
  say(OWNER, '[NOBRIEF] משהו');
  check('a question from the agent is sent as text', await waitFor(() => mine().some((s) => s.text === 'על איזה בורגר המודעה?')));
  say(OWNER, 'דאבל צ׳יזבורגר');
  check('the answer goes into the same ad and a picture follows', await waitFor(() => photos().length === before + 1) && adFiles().length === 2, `${adFiles().length} ads`);

  // /new starts another ad even while one is open
  say(OWNER, `/new ${REQUEST}`);
  check('"/new" starts a separate ad', await waitFor(() => photos().length === before + 2 && adFiles().length === 3), `${adFiles().length} ads`);

  // Things that are not text, and an English owner
  say(OWNER, null);
  check('a message with no text gets a short answer, in the open ad\'s language', await waitFor(() => mine().some((s) => s.text === 'שלחו הודעת טקסט.')));
  say(OWNER, 'stop');
  check('"stop" closes the open ad', await waitFor(() => mine().some((s) => /^נסגר/.test(s.text))));
  say(OWNER, '/new Ad for Friday: Double Cheeseburger, 2 for ₪100, Tel Aviv');
  check('an English message gets an English acknowledgement', await waitFor(() => mine().some((s) => s.text === 'Got it. Working on it, about a minute.')));

  check('the bot token never appears in the server log', !log.includes('TESTTOKEN'));
} catch (e) {
  console.error('test runner error:', e);
  results.push(false);
} finally {
  server.kill('SIGTERM');
  fakeApi.close();
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed  (work dir: ${WORK})`);
if (failed) console.log('--- server log ---\n' + log.split('\n').slice(-25).join('\n'));
process.exit(failed ? 1 : 0);
