// Test double for agent.mjs (AD_AGENT_DRIVER=fake). Same exports, no network. Every turn is
// appended to the file named by FAKE_AGENT_LOG so tests can assert what the agent was sent.
// Markers in the owner text steer it: [NOBRIEF] answers with a question and no brief,
// [BADPRICE] submits a brief with an unlisted price first (one rejection), [REDRAW] or
// "new picture" sets redraw_image on a reply. FAKE_AGENT_DELAY_MS slows every turn down.
import { appendFileSync } from 'node:fs';
import { validateBrief } from './brief.mjs';

const sessions = new Map();
let n = 0;
const log = (entry) => { if (process.env.FAKE_AGENT_LOG) appendFileSync(process.env.FAKE_AGENT_LOG, JSON.stringify(entry) + '\n'); };

const SCENE = 'A double cheeseburger on a glossy amber brioche bun, two seared patties with melted yellow cheese running down the sides, pickles and caramelised onions peeking out. It sits centred on a pale warm-grey stone counter in front of a softly mottled grey marble wall. Soft diffused light from the front-left, shot straight-on at eye level, so the burger fills most of the frame. Clean, simple and hungry-making.';

function makeBrief({ redraw, bad, short, newHead }) {
  return {
    language: 'he',
    angle: 'Friday lunch is burger time in Tel Aviv.',
    copy: {
      headline: newHead ? 'כותרת חדשה' : short ? 'דאבל צ׳יזבורגר ליום שישי' : 'דאבל צ׳יזבורגר ליום שישי',
      caption: bad ? 'שני דאבל צ׳יזבורגר ב-₪95 בתל אביב, רק השבוע' : short ? 'שני פטיס צרובים וגבינה נמסה. 2 ב-100. בואו.' : 'שני פטיס צרובים, גבינה נמסה, בצל מקורמל ומלפפון חמוץ. 2 ב-100 בתל אביב. בואו רעבים ביום שישי.',
      cta: 'יום שישי, תל אביב, מ-12:00',
      hashtags: ['#MeatLocker', '#המבורגר', '#תלאביב'],
    },
    image: { scene: SCENE, aspect: 'square', text_in_image: '', avoid: ['faces', 'logos'] },
    facts_used: ['Double Cheeseburger ₪62'],
    sources: [],
    redraw_image: redraw,
    notes_for_owner: short ? '' : 'הנחתי שהמבצע הוא לסניף תל אביב בלבד.',
  };
}

export function resolveIds() { return { agentId: 'agent_fake', envId: 'env_fake', workspace: 'default' }; }
export const consoleUrl = (id) => `fake://${id}`;

export async function createSession({ title }) {
  const id = `sesn_fake_${++n}`;
  sessions.set(id, { briefs: 0, title });
  log({ op: 'create', sessionId: id, title });
  return id;
}

export async function runTurn({ sessionId, text, ctx }) {
  const delay = Number(process.env.FAKE_AGENT_DELAY_MS || 0);
  if (delay) await new Promise((r) => setTimeout(r, delay));
  const s = sessions.get(sessionId) ?? { briefs: 0 };
  log({ op: 'turn', sessionId, text, factsHead: ctx.facts.slice(0, 60) });
  if (/\[NOBRIEF\]/.test(text)) return { brief: null, text: 'על איזה בורגר המודעה?', stop: 'end_turn', rejections: 0, problems: [], error: null };
  const isReply = text.startsWith('<reply>');
  const redraw = !isReply || /\[REDRAW\]|תמונה אחרת|new picture/i.test(text);
  const short = isReply && /קצר/.test(text);
  let rejections = 0;
  const newHead = /\[NEWHEAD\]/.test(text);
  let brief = makeBrief({ redraw, bad: /\[BADPRICE\]/.test(text) && s.briefs === 0, short, newHead });
  let v = validateBrief(brief, ctx);
  if (!v.ok) { rejections = 1; log({ op: 'rejected', sessionId, problems: v.problems }); brief = makeBrief({ redraw, bad: false, short, newHead }); v = validateBrief(brief, ctx); }
  s.briefs += 1;
  return { brief: v.ok ? brief : null, text: v.ok ? 'המודעה על דאבל צ׳יזבורגר ליום שישי בתל אביב.' : v.result, stop: 'end_turn', rejections, problems: v.problems, error: null };
}

export async function getUsage() { return null; }
