// Telegram front door for the ad service. The owner writes to a bot, gets the picture and the copy
// back in the same chat, and answers a draft by replying to it. It calls the same functions as the web
// page (createJob, replyToJob), so every check and every spending cap applies unchanged.
//
// It uses long polling (getUpdates), so it needs no public URL and works on a laptop and on Railway.
// Run only ONE instance per bot token: two pollers on one token fight each other (Telegram answers 409).
//
// Who may use it: only the chat ids in TELEGRAM_ALLOWED_CHAT_IDS. Everyone else can send /myid and gets
// their own id back, which is how you find the id to put in the list. Nothing else from them is read.
//
// A chat has at most one "open" ad. A plain message while an ad is open is a change to it. To start another
// ad: `/new <text>`, or close the open one with "ok" or "stop".
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from './env.mjs';
import { info, warn } from './log.mjs';
import { createJob, replyToJob, approveJob, loadJob, imagePath, UserError } from './ads.mjs';
import { composeCaption } from './brief.mjs';

const TG_CAPTION_LIMIT = 1024; // Telegram's limit for the caption of a photo
const HEBREW = /[֐-׿]/;
const REDRAW = /^(\/redraw|new picture|another picture|another image|תמונה אחרת|תמונה חדשה)$/i;
const OK = /^(ok|okay|👍|אוקיי|אישור)$/i;
const STOP = /^(stop|\/stop|עצור)$/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Two languages, picked from the owner's own message. Everything the bot says by itself is here.
const T = {
  help: {
    he: 'שלחו הודעה עם מה לפרסם: מוצר, מבצע, יום וסניף. למשל:\nמודעה ליום שישי: דאבל צ׳יזבורגר, 2 ב-100, תל אביב\n\nאחרי שמגיעה טיוטה, כל הודעה שלכם היא בקשה לשינוי ("קצר יותר"). "תמונה אחרת" מצייר תמונה חדשה. "ok" מאשר וסוגר. "/new" ואחריו טקסט פותח מודעה חדשה.',
    en: 'Write what to advertise: product, offer, day and branch. For example:\nAd for Friday: Double Cheeseburger, 2 for ₪100, Tel Aviv\n\nOnce a draft arrives, every message you send is a change request ("shorter"). "new picture" draws a new picture. "ok" approves and closes it. "/new" and then text starts another ad.',
  },
  working: { he: 'קיבלתי, עובד על זה. זה לוקח בערך דקה.', en: 'Got it. Working on it, about a minute.' },
  updating: { he: 'מעדכן.', en: 'Updating.' },
  saved: { he: 'נשמר. שום דבר לא מתפרסם מעצמו, הפרסום אצלכם.', en: 'Saved. Nothing is posted for you: publishing is yours.' },
  closed: { he: 'נסגר. הודעה חדשה תתחיל מודעה חדשה.', en: 'Closed. Your next message starts a new ad.' },
  nothingOpen: { he: 'אין מודעה פתוחה. כתבו מה לפרסם.', en: 'No ad is open. Write what to advertise.' },
  textOnly: { he: 'שלחו הודעת טקסט.', en: 'Please send a text message.' },
  failed: { he: 'לא הצלחתי להכין את המודעה: ', en: "I couldn't make the ad: " },
  slow: { he: 'זה לוקח יותר מדי זמן. נסו שוב בעוד רגע.', en: 'This is taking too long. Try again in a moment.' },
  note: { he: 'הערה: ', en: 'Note: ' },
  hint: {
    he: 'לשינוי: השיבו עם מה לשנות, למשל "קצר יותר". לתמונה חדשה: "תמונה אחרת". לאישור: ok.',
    en: 'To change it, reply with what to change, for example "shorter". New picture: "new picture". To approve: ok.',
  },
};
const say = (lang, key) => T[key][lang];

// ---------- state: which ad is open in which chat, and how far we have read ----------
const STATE_FILE = join(config.dataDir, 'telegram-state.json');
let state = { offset: 0, chats: {} };
try { if (existsSync(STATE_FILE)) state = { ...state, ...JSON.parse(readFileSync(STATE_FILE, 'utf8')) }; } catch { /* start fresh */ }
function saveState() {
  try { mkdirSync(dirname(STATE_FILE), { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify(state)); } catch (e) { warn(`telegram: could not save state: ${e.message}`); }
}
const sentToJob = new Map(); // message_id of something we sent -> job id, so a reply to an older ad changes that ad
function remember(chatId, messageId, jobId) {
  if (!messageId) return;
  sentToJob.set(`${chatId}:${messageId}`, jobId);
  if (sentToJob.size > 500) sentToJob.delete(sentToJob.keys().next().value);
}

// ---------- the Telegram Bot API ----------
const endpoint = (method) => `${config.telegramApiBase}/bot${config.telegramToken}/${method}`;

async function parse(res, method) {
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    const e = new Error(`telegram ${method} ${res.status}: ${String(json.description ?? 'error').slice(0, 200)}`);
    e.status = res.status;
    throw e;
  }
  return json.result;
}
async function tg(method, params = {}, timeoutMs = 30_000) {
  const res = await fetch(endpoint(method), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.timeout(timeoutMs) });
  return parse(res, method);
}
async function sendText(chatId, text) {
  return tg('sendMessage', { chat_id: chatId, text: String(text).slice(0, 4000) }).catch((e) => { warn(`telegram: ${e.message}`); return null; });
}
async function sendPhoto(chatId, file, caption) {
  const form = new FormData();
  form.set('chat_id', String(chatId));
  form.set('caption', caption);
  form.set('photo', new Blob([readFileSync(file)], { type: 'image/jpeg' }), 'ad.jpg');
  const res = await fetch(endpoint('sendPhoto'), { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) });
  return parse(res, 'sendPhoto');
}

// ---------- delivering a finished job ----------
async function deliver(chatId, job, imagesBefore) {
  const lang = job.brief?.language === 'he' || HEBREW.test(job.request) ? 'he' : 'en';
  if (job.status === 'failed') return void (await sendText(chatId, `${say(lang, 'failed')}${job.error ?? ''}`));
  if (job.status === 'needs_input') return void (await sendText(chatId, job.agentText || say(lang, 'textOnly')));

  const caption = composeCaption(job.brief, TG_CAPTION_LIMIT);
  const file = job.images.length > imagesBefore ? imagePath(job) : null;
  let sent = null;
  try {
    sent = file ? await sendPhoto(chatId, file, caption) : await tg('sendMessage', { chat_id: chatId, text: caption });
  } catch (e) {
    warn(`telegram: could not send the draft of ${job.id}: ${e.message}`);
    return void (await sendText(chatId, `${say(lang, 'failed')}${e.message}`));
  }
  remember(chatId, sent?.message_id, job.id);
  const notes = String(job.brief.notes_for_owner ?? '').trim();
  if (notes) await sendText(chatId, `${say(lang, 'note')}${notes}`);
  if (!job.replies?.length) await sendText(chatId, say(lang, 'hint'));
}

/** Wait for a job to leave "working", then send the result. Runs in the background. */
async function watch(chatId, jobId, imagesBefore, lang) {
  try {
    const deadline = Date.now() + config.adTurnTimeoutMs + 180_000;
    while (Date.now() < deadline) {
      await sleep(config.telegramWaitPollMs);
      const job = loadJob(jobId);
      if (!job) return;
      if (job.status !== 'working') return await deliver(chatId, job, imagesBefore);
    }
    await sendText(chatId, say(lang, 'slow'));
  } catch (e) {
    warn(`telegram: watching ${jobId} failed: ${e?.message ?? e}`);
  }
}

// ---------- one incoming message ----------
async function handle(msg) {
  if (msg.chat?.type !== 'private') return;           // groups and channels are ignored
  const chatId = msg.chat.id;
  const text = String(msg.text ?? '').trim();
  const allowed = config.telegramAllowedChats.includes(String(chatId));

  if (/^\/(myid|start)(@\w+)?$/i.test(text) && !allowed) {
    return void (await sendText(chatId, `Your chat id is ${chatId}.\nAsk the owner of this service to add it to TELEGRAM_ALLOWED_CHAT_IDS.`));
  }
  if (!allowed) { warn(`telegram: ignored a message from chat ${chatId}`); return; }

  // The ad this message is about: the one it replies to, else the chat's open ad.
  const repliedTo = msg.reply_to_message ? sentToJob.get(`${chatId}:${msg.reply_to_message.message_id}`) : null;
  const openId = repliedTo || state.chats[chatId] || null;
  const open = openId ? loadJob(openId) : null;
  // Hebrew if the message is, or (for short words like "ok" and "stop") if the open ad was asked for in Hebrew.
  const lang = HEBREW.test(text) || (open && HEBREW.test(open.request)) ? 'he' : 'en';

  if (!text) return void (await sendText(chatId, say(lang, 'textOnly')));
  if (/^\/myid(@\w+)?$/i.test(text)) return void (await sendText(chatId, `Your chat id is ${chatId}. You are allowed to use this bot.`));
  if (/^\/(start|help)(@\w+)?$/i.test(text)) return void (await sendText(chatId, say(lang, 'help')));

  if (STOP.test(text) || OK.test(text)) {
    if (!open) return void (await sendText(chatId, say(lang, 'nothingOpen')));
    if (OK.test(text)) approveJob(open.id);
    if (state.chats[chatId] === open.id) { delete state.chats[chatId]; saveState(); }
    return void (await sendText(chatId, say(lang, OK.test(text) ? 'saved' : 'closed')));
  }

  const forcedNew = /^\/new(@\w+)?(\s|$)/i.exec(text);
  const body = forcedNew ? text.slice(forcedNew[0].length).trim() : text;
  if (forcedNew && !body) return void (await sendText(chatId, say(lang, 'help')));

  try {
    if (open?.sessionId && !forcedNew) {
      const redraw = REDRAW.test(body);
      const imagesBefore = open.images?.length ?? 0;
      replyToJob(open.id, redraw ? '' : body, { redraw });
      state.chats[chatId] = open.id; saveState();
      await sendText(chatId, say(lang, 'updating'));
      watch(chatId, open.id, imagesBefore, lang);
    } else {
      const job = createJob(body);
      state.chats[chatId] = job.id; saveState();
      await sendText(chatId, say(lang, 'working'));
      watch(chatId, job.id, 0, lang);
    }
  } catch (e) {
    if (e instanceof UserError) return void (await sendText(chatId, e.message));
    warn(`telegram: ${e?.message ?? e}`);
    await sendText(chatId, `${say(lang, 'failed')}${String(e?.message ?? e).slice(0, 200)}`);
  }
}

// ---------- the polling loop ----------
export function startTelegram() {
  if (!config.telegramToken) return null;
  let stopped = false;
  (async () => {
    try {
      await tg('deleteWebhook');                       // a leftover webhook would block getUpdates (409)
      const me = await tg('getMe');
      info(`telegram: bot @${me.username} is listening (${config.telegramAllowedChats.length} allowed chat${config.telegramAllowedChats.length === 1 ? '' : 's'})`);
    } catch (e) {
      warn(`telegram: could not start: ${e.message}${e.status === 401 ? ' (the bot token was refused; check TELEGRAM_BOT_TOKEN)' : ''}`);
      if (e.status === 401) return;
    }
    let backoff = 2000;
    while (!stopped) {
      try {
        const updates = await tg('getUpdates', { offset: state.offset, timeout: config.telegramLongPollSeconds, allowed_updates: ['message'] }, (config.telegramLongPollSeconds + 15) * 1000);
        backoff = 2000;
        for (const u of updates) {
          state.offset = u.update_id + 1;
          saveState();
          if (u.message) await handle(u.message).catch((e) => warn(`telegram: ${e?.message ?? e}`));
        }
      } catch (e) {
        warn(`telegram: ${e.message}${e.status === 409 ? ' (is another copy of this service polling the same bot?)' : ''}`);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 60_000);
      }
    }
  })();
  return { stop: () => { stopped = true; } };
}
