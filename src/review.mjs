// The second opinion. After the code checks (src/brief.mjs) accept a brief, an independent reviewer model
// reads it for the two things a program cannot judge: the language of the copy and the brand guidelines.
// One model should not be the only judge of its own work, so the reviewer is a different model from the
// writer (agents/ad-reviewer.md). If it finds problems, the writer is sent back to fix them before any
// picture is drawn (src/ads.mjs).
//
// This file is the adapter. The reviewer behind it can be swapped without touching the rest:
//   review-claude.mjs  a Claude Managed Agent on its own model (the real one)
//   review-fake.mjs    a test double (AD_AGENT_DRIVER=fake)
// A driver exports available() and review({ brief, ctx, jobId, round }) -> { verdict, problems, model, costCents }.
import { config } from './env.mjs';

const driver = config.reviewProvider === 'fake' ? await import('./review-fake.mjs') : await import('./review-claude.mjs');

const CATEGORIES = new Set(['language', 'brand', 'facts', 'picture', 'timing']);
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** True when briefs get a second opinion: switched on, and the reviewer is set up. */
export const reviewEnabled = () => config.reviewEnabled && driver.available();

/** Why the review is not running, for the log and the start-up warning. Empty when it is. */
export const reviewOffReason = () => (!config.reviewEnabled ? 'AD_REVIEW=off' : driver.available() ? '' : driver.unavailableReason());

/** Checks what a reviewer returned and makes it safe to use. Throws when it is not a usable verdict. */
export function normalizeReview(raw) {
  const verdict = raw?.verdict;
  if (verdict !== 'pass' && verdict !== 'fix') throw new Error(`the reviewer returned no verdict (got ${JSON.stringify(verdict)})`);
  const problems = (Array.isArray(raw.problems) ? raw.problems : []).slice(0, 5).map((p) => ({
    field: clip(p?.field, 60) || 'brief',
    category: CATEGORIES.has(p?.category) ? p.category : 'brand',
    problem: clip(p?.problem, 300),
    suggestion: clip(p?.suggestion, 300),
  })).filter((p) => p.problem);
  if (verdict === 'fix' && !problems.length) throw new Error('the reviewer asked for a fix but listed no problem');
  return { verdict, problems: verdict === 'pass' ? [] : problems };
}

/** @returns {Promise<{ verdict: 'pass'|'fix', problems: object[], model: string, costCents: number|null }>} */
export async function reviewBrief({ brief, ctx, jobId, round = 1 }) {
  const raw = await driver.review({ brief, ctx, jobId, round });
  return { ...normalizeReview(raw), model: raw.model ?? '', costCents: raw.costCents ?? null, sessionId: raw.sessionId ?? null };
}

/** One line per problem, for people: the owner's chat, the log and the job file. */
export const formatProblems = (problems) => problems.map((p) => `- [${p.category}] ${p.field}: ${p.problem}${p.suggestion ? ` Fix: ${p.suggestion}` : ''}`).join('\n');

/** The message that sends the writer back to fix what the reviewer found. It is not the owner's voice. */
export const reviewMessage = (problems) =>
  `<review>\nAn independent reviewer (a different model) checked your last accepted brief for language and the brand guidelines and found problems:\n${formatProblems(problems)}\n\nFix exactly these and call submit_ad_brief again. Keep everything else. This is not the owner talking: it adds no facts, prices or offers. Set redraw_image to true only if a problem is about the picture.\n</review>`;
