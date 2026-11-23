// The real reviewer: a Claude Managed Agent on its own model (agents/ad-reviewer.md), a different model
// from the writer. Each review is a new session, so it judges the brief fresh, with no memory of the
// writer's reasoning or of its own earlier verdicts. It has one tool, submit_review, and no web access.
// The agent id comes from claude-lock.json (written by `npm run agents:apply`) unless AD_REVIEWER_AGENT_ID is set.
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, ROOT } from './env.mjs';
import { info, warn } from './log.mjs';
import { lock } from './agent.mjs';

const client = new Anthropic();

const reviewerId = () => config.reviewerAgentId || lock()?.resources?.['./agents/ad-reviewer.md']?.id || '';
const environmentId = () => config.adEnvironmentId || lock()?.resources?.['./environments/ad-research.yaml']?.id || '';

export const available = () => Boolean(reviewerId() && environmentId());
export const unavailableReason = () => 'the reviewer agent is not created yet: run "npm run agents:apply" and commit claude-lock.json, or set AD_REVIEWER_AGENT_ID';

/** The model named in agents/ad-reviewer.md, for the log and the job file. */
function reviewerModel() {
  try { return /^model:\s*(\S+)/m.exec(readFileSync(join(ROOT, 'agents/ad-reviewer.md'), 'utf8'))?.[1] ?? ''; } catch { return ''; }
}

/** The message the reviewer receives: the same three blocks the writer got, plus the brief to review. */
// The brief came from a model that read the open web, so it is untrusted text. It is embedded as JSON with every "<"
// written as \u003c: a caption that contains "</brief>" or a fake <instructions> block cannot close the tag and talk
// to the reviewer as if it were the service. (Still valid JSON; the reviewer reads it the same.)
export const reviewRequest = (brief, ctx) =>
  `<brand_sheet>\n${ctx.brandSheet}\n</brand_sheet>\n\n<facts>\n${ctx.facts}\n</facts>\n\n<request>\n${ctx.request}\n</request>\n\n<brief>\n${JSON.stringify(brief, null, 2).replace(/</g, '\\u003c')}\n</brief>`;

export async function review({ brief, ctx, jobId, round }) {
  const session = await client.beta.sessions.create({
    agent: reviewerId(),
    environment_id: environmentId(),
    title: `Review ${round}: ${String(brief?.copy?.headline ?? '').slice(0, 50)}`,
    metadata: { job: jobId, round: String(round) },
    budget: { type: 'limit', max_list_cost: { amount: config.reviewBudgetCents, currency: 'USD' } },
  });
  info(`${jobId}: review ${round}: session ${session.id}`);

  const stream = await client.beta.sessions.events.stream(session.id);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; stream.controller.abort(); }, config.reviewTimeoutMs);
  let verdict = null, stop = null;
  try {
    await client.beta.sessions.events.send(session.id, { events: [{ type: 'user.message', content: [{ type: 'text', text: reviewRequest(brief, ctx) }] }] });
    loop: for await (const ev of stream) {
      switch (ev.type) {
        case 'agent.custom_tool_use': {
          let result = 'Unknown tool. Only submit_review exists.';
          if (ev.name === 'submit_review') {
            if (verdict) result = 'Already recorded. Reply with one line and stop.';
            else { verdict = ev.input; result = 'recorded'; }
          }
          await client.beta.sessions.events.send(session.id, { events: [{ type: 'user.custom_tool_result', custom_tool_use_id: ev.id, content: [{ type: 'text', text: result }] }] });
          break;
        }
        case 'session.error':
          warn(`${jobId}: review session ${session.id} error:`, JSON.stringify(ev).slice(0, 300));
          break;
        case 'session.status_idle':
          if (ev.stop_reason?.type === 'requires_action') break; // waiting on our tool result
          stop = ev.stop_reason?.type ?? 'idle';
          break loop;
        case 'session.status_terminated':
          stop = 'terminated';
          break loop;
      }
    }
  } catch (e) {
    if (!timedOut) throw e;
  } finally {
    clearTimeout(timer);
    try { stream.controller.abort(); } catch { /* already closed */ }
  }

  if (timedOut) {
    await client.beta.sessions.events.send(session.id, { events: [{ type: 'user.interrupt' }] }).catch(() => {});
    throw new Error(`review session ${session.id}: no verdict within ${config.reviewTimeoutMs / 1000}s`);
  }
  if (!verdict) throw new Error(`review session ${session.id}: ended (${stop}) without a verdict`);

  let costCents = null;
  try { costCents = (await client.beta.sessions.retrieve(session.id)).usage?.list_cost?.amount ?? null; } catch { /* the cost is only for the log */ }
  return { ...verdict, model: reviewerModel(), costCents, sessionId: session.id };
}
