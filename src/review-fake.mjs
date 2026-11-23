// Test double for review-claude.mjs (AD_AGENT_DRIVER=fake). No network. Every review is appended to the file
// named by FAKE_AGENT_LOG, next to the fake writer's turns. Markers in the owner's request steer it:
//   [REVIEWFIX]    the first review asks for a fix, the second passes
//   [REVIEWSTUCK]  every review asks for a fix (the draft must be held back)
//   [REVIEWERR]    the reviewer fails (the ad must still go through, marked as not reviewed)
import { appendFileSync } from 'node:fs';

const log = (entry) => { if (process.env.FAKE_AGENT_LOG) appendFileSync(process.env.FAKE_AGENT_LOG, JSON.stringify(entry) + '\n'); };

export const available = () => true;
export const unavailableReason = () => '';

export async function review({ brief, ctx, jobId, round }) {
  const delay = Number(process.env.FAKE_AGENT_DELAY_MS || 0);
  if (delay) await new Promise((r) => setTimeout(r, delay / 3));
  const request = ctx.request ?? '';
  if (/\[REVIEWERR\]/.test(request)) { log({ op: 'review', jobId, round, error: true }); throw new Error('the fake reviewer failed'); }
  const fix = /\[REVIEWSTUCK\]/.test(request) || (/\[REVIEWFIX\]/.test(request) && round === 1);
  const out = fix
    ? { verdict: 'fix', problems: [{ field: 'copy.caption', category: 'language', problem: 'The caption mixes two languages in one sentence.', suggestion: 'Write the whole caption in Hebrew.' }] }
    : { verdict: 'pass', problems: [] };
  log({ op: 'review', jobId, round, verdict: out.verdict, headline: brief?.copy?.headline });
  return { ...out, model: 'fake-reviewer', costCents: 1, sessionId: `sesn_fake_review_${round}` };
}
