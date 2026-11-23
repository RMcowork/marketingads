// Tests of the second opinion: an independent reviewer model checks the language and the brand guidelines of every
// accepted brief before a picture is drawn (src/review.mjs, agents/ad-reviewer.md). The real server runs with a fake
// writer, a fake reviewer and a mock picture, so this is free and offline. Run: npm run test:review
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const results = [];
const check = (name, ok, detail = '') => { results.push(Boolean(ok)); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- the agent file ----------
const model = (f) => /^model:\s*(\S+)/m.exec(readFileSync(join(ROOT, f), 'utf8'))?.[1];
const reviewerMd = readFileSync(join(ROOT, 'agents/ad-reviewer.md'), 'utf8');
check('the reviewer is a different model from the writer', model('agents/ad-reviewer.md') && model('agents/ad-reviewer.md') !== model('agents/ad-researcher.md'), `${model('agents/ad-researcher.md')} writes, ${model('agents/ad-reviewer.md')} reviews`);
check('the reviewer has one tool, submit_review, and no web tools', /name: submit_review/.test(reviewerMd) && !/web_search|web_fetch|agent_toolset/.test(reviewerMd));
check('the reviewer checks language and brand', /## A\. The language/.test(reviewerMd) && /## B\. The brand guidelines/.test(reviewerMd));
check('the reviewer covers Hebrew, English and Arabic', /Hebrew/.test(reviewerMd) && /Arabic/.test(reviewerMd) && /English/.test(reviewerMd));
check('the reviewer reads the brand sheet and the facts', /<brand_sheet>/.test(reviewerMd) && /<facts>/.test(reviewerMd));
check('the researcher knows what a <review> block is', /<review>/.test(readFileSync(join(ROOT, 'agents/ad-researcher.md'), 'utf8')));

// ---------- the adapter ----------
process.env.AD_AGENT_DRIVER = 'fake';
const { normalizeReview, reviewMessage, formatProblems } = await import('../src/review.mjs');
check('a pass has no problems', JSON.stringify(normalizeReview({ verdict: 'pass', problems: [{ problem: 'x' }] })) === JSON.stringify({ verdict: 'pass', problems: [] }));
const fix = normalizeReview({ verdict: 'fix', problems: [{ field: 'copy.caption', category: 'language', problem: 'A Hebrew word in Arabic copy.', suggestion: 'Use the Arabic word.' }] });
check('a fix keeps its problems', fix.verdict === 'fix' && fix.problems.length === 1 && fix.problems[0].category === 'language');
check('an unknown category becomes "brand"', normalizeReview({ verdict: 'fix', problems: [{ field: 'x', category: 'weird', problem: 'p', suggestion: 's' }] }).problems[0].category === 'brand');
check('at most five problems are kept', normalizeReview({ verdict: 'fix', problems: Array.from({ length: 9 }, (_, i) => ({ field: 'f', category: 'brand', problem: `p${i}`, suggestion: 's' })) }).problems.length === 5);
check('no verdict is refused', (() => { try { normalizeReview({}); return false; } catch { return true; } })());
check('"fix" with no problem listed is refused', (() => { try { normalizeReview({ verdict: 'fix', problems: [] }); return false; } catch { return true; } })());
const msg = reviewMessage(fix.problems);
check('the message to the writer is a <review> block, not the owner', msg.startsWith('<review>') && msg.endsWith('</review>') && /not the owner talking/.test(msg) && !msg.includes('<reply>'));
check('the message lists every problem with its category and field', msg.includes(formatProblems(fix.problems)) && /\[language\] copy\.caption/.test(msg));

// ---------- through the real server ----------
const WORK = mkdtempSync(join(tmpdir(), 'ad-agents-review-'));
const FAKE_LOG = join(WORK, 'fake.jsonl');
const PASSWORD = 'test-password-123';
const procs = [];
function start(port, extraEnv = {}) {
  const env = { ...process.env, PORT: String(port), APP_PASSWORD: PASSWORD, AD_AGENT_DRIVER: 'fake', IMAGE_PROVIDER: 'mock', FAKE_AGENT_LOG: FAKE_LOG, FAKE_AGENT_DELAY_MS: '30', MAX_RUNS_PER_DAY: '50', MAX_PARALLEL_RUNS: '3', DATA_DIR: '', TELEGRAM_BOT_TOKEN: '', TELEGRAM: '', AD_REVIEW: 'on', AD_REVIEW_MAX_FIXES: '2', ...extraEnv };
  const p = spawn('node', [join(ROOT, 'src/server.mjs')], { cwd: WORK, env, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(p);
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  p.log = () => out;
  p.done = new Promise((r) => p.on('exit', (code) => r(code)));
  p.base = `http://localhost:${port}`;
  return p;
}
const auth = { authorization: 'Basic ' + Buffer.from(`student:${PASSWORD}`).toString('base64') };
const api = (srv) => ({
  post: (path, body) => fetch(srv.base + path, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()),
  get: (path) => fetch(srv.base + path, { headers: auth }),
  async done(id) { for (let i = 0; i < 80; i++) { const j = await (await this.get(`/api/ads/${id}`)).json(); if (j.status !== 'working') return j; await sleep(100); } throw new Error(`job ${id} did not finish`); },
});
const fakeLog = () => (existsSync(FAKE_LOG) ? readFileSync(FAKE_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const reviewsOf = (id) => fakeLog().filter((e) => e.op === 'review' && e.jobId === id);

try {
  const server = start(3107);
  for (let i = 0; i < 40; i++) { try { await fetch(`${server.base}/health`); break; } catch { await sleep(150); } }
  const A = api(server);

  // 1. a brief that passes
  const j1 = await A.done((await A.post('/api/ads', { request: 'מודעה ליום שישי: דאבל צ׳יזבורגר, 2 ב-100, מבשרת ציון' })).id);
  check('a good brief is reviewed once and passes', j1.status === 'draft' && j1.review?.verdict === 'pass' && j1.review.fixes === 0 && reviewsOf(j1.id).length === 1, JSON.stringify(j1.review?.rounds?.map((r) => r.verdict)));
  check('the picture is drawn after the review', Boolean(j1.image));
  check('the reviewer is named in the job', Boolean(j1.review?.model));

  // 2. the reviewer finds a problem, the writer fixes it, the second review passes
  const j2 = await A.done((await A.post('/api/ads', { request: 'מודעה ליום שישי: דאבל צ׳יזבורגר, 2 ב-100, מבשרת ציון [REVIEWFIX]' })).id);
  const turns2 = fakeLog().filter((e) => e.op === 'turn' && e.sessionId && /^<review>/.test(e.text ?? ''));
  check('a problem sends the writer back with a <review> message', turns2.length >= 1 && /\[language\] copy\.caption/.test(turns2.at(-1).text), `${turns2.length} fix turn(s)`);
  check('the corrected brief is reviewed again and passes', j2.status === 'draft' && j2.review?.verdict === 'pass' && j2.review.fixes === 1 && reviewsOf(j2.id).map((e) => e.verdict).join() === 'fix,pass', reviewsOf(j2.id).map((e) => e.verdict).join());
  check('the draft shows the corrected headline', j2.brief?.copy?.headline === 'כותרת מתוקנת', j2.brief?.copy?.headline);
  check('a picture is drawn once, after the review passed', j2.image?.count === 1);
  check('the review message did not become an owner fact', !JSON.stringify(j2.replies).includes('review'));

  // 3. the reviewer never passes: the draft is held back and no picture is drawn
  const j3 = await A.done((await A.post('/api/ads', { request: 'מודעה ליום שישי: דאבל צ׳יזבורגר, 2 ב-100, מבשרת ציון [REVIEWSTUCK]' })).id);
  check('after the allowed fixes a failing draft is held back', j3.status === 'needs_input' && j3.review?.verdict === 'fix' && j3.review.fixes === 2, `${j3.status}, ${j3.review?.fixes} fixes`);
  check('a held-back draft has no picture (nothing is spent on it)', j3.image === null);
  check('the owner is told why, with the reviewer\'s problem', /independent reviewer/.test(j3.agentText) && /mixes two languages/.test(j3.agentText));
  check('the reviewer was asked three times (one more than the fixes)', reviewsOf(j3.id).length === 3, String(reviewsOf(j3.id).length));
  const back = await A.post(`/api/ads/${j3.id}/reply`, { text: 'תן לי זווית אחרת' });
  const j3b = await A.done(j3.id);
  check('the owner can reply to a held-back draft and the review runs again', back.status === 'working' && reviewsOf(j3.id).length > 3 && j3b.review != null);

  // 4. a reviewer that fails never stops an ad
  const j4 = await A.done((await A.post('/api/ads', { request: 'מודעה ליום שישי: דאבל צ׳יזבורגר, 2 ב-100, מבשרת ציון [REVIEWERR]' })).id);
  check('a failing reviewer does not stop the ad', j4.status === 'draft' && j4.review?.verdict === 'skipped' && j4.review.reason === 'the reviewer failed' && Boolean(j4.image), j4.review?.reason);
  check('the failure is logged', /review 1 failed, going on without it/.test(server.log()));

  // 5. revisions are reviewed too
  const before = reviewsOf(j1.id).length;
  await A.post(`/api/ads/${j1.id}/reply`, { text: 'קצר יותר' });
  const j1b = await A.done(j1.id);
  check('a change from the owner is reviewed as well', j1b.status === 'draft' && reviewsOf(j1.id).length === before + 1 && j1b.review?.verdict === 'pass');

  server.kill('SIGTERM'); await server.done;

  // 6. switched off
  const off = start(3108, { AD_REVIEW: 'off' });
  for (let i = 0; i < 40; i++) { try { await fetch(`${off.base}/health`); break; } catch { await sleep(150); } }
  const O = api(off);
  const reviewsBefore = fakeLog().filter((e) => e.op === 'review').length;
  const j5 = await O.done((await O.post('/api/ads', { request: 'מודעה ליום שישי: דאבל צ׳יזבורגר, 2 ב-100, מבשרת ציון' })).id);
  check('AD_REVIEW=off skips the review and says so', j5.status === 'draft' && j5.review?.verdict === 'skipped' && j5.review.reason === 'AD_REVIEW=off' && fakeLog().filter((e) => e.op === 'review').length === reviewsBefore, j5.review?.reason);
  check('the server warns at start-up that ads are not reviewed', /NOT being reviewed by a second model \(AD_REVIEW=off\)/.test(off.log()));
  off.kill('SIGTERM'); await off.done;
} finally {
  for (const p of procs) { try { p.kill('SIGKILL'); } catch { /* already gone */ } }
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed  (work dir: ${WORK})`);
process.exit(failed ? 1 : 0);
