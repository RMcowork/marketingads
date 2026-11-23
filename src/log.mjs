// Plain console logging with a timestamp. Railway and DigitalOcean show stdout in their log view;
// on a droplet systemd appends it to logs/server.log.
//
// Everything printed goes through redact() first: a secret that ends up in an error message (an API key
// echoed back by a provider, a bot token in a URL) must never reach the log or the owner's screen.
import { config } from './env.mjs';

// Shapes of secrets, including the masked forms providers print ("sk-proj-********abcd").
const SHAPES = [
  /sk-ant-[\w*-]{6,}/g,
  /sk-[\w*-]{12,}/g,
  /AIza[\w-]{20,}/g,
  /\d{6,}:[A-Za-z0-9_-]{30,}/g, // a bot token, also inside a URL like /bot123456:AA.../getMe
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=*-]{8,}/gi,
];
const secretValues = () => [process.env.APP_PASSWORD, process.env.ANTHROPIC_API_KEY, process.env.OPENAI_API_KEY, process.env.GEMINI_API_KEY, config.telegramToken]
  .filter((v) => typeof v === 'string' && v.length >= 8);

/** The text with every secret replaced by [redacted]: the known values first, then anything shaped like a key. */
export function redact(input) {
  let s = typeof input === 'string' ? input : input instanceof Error ? (input.message ?? String(input)) : (() => { try { return JSON.stringify(input) ?? String(input); } catch { return String(input); } })();
  for (const v of secretValues()) s = s.split(v).join('[redacted]');
  for (const re of SHAPES) s = s.replace(re, '[redacted]');
  return s;
}

const scrub = (args) => args.map((a) => (typeof a === 'string' || a instanceof Error || (a && typeof a === 'object') ? redact(a) : a));
export const info = (...a) => console.log(`[${new Date().toISOString()}]`, ...scrub(a));
export const warn = (...a) => console.warn(`[${new Date().toISOString()}]`, ...scrub(a));
