// Small security helpers for the web service (src/server.mjs): who is calling, is it plain http, and a
// throttle that stops password guessing. See SECURITY-ASSESSMENT.md.
import { config } from './env.mjs';

/**
 * The caller's address. Behind a trusted proxy (AD_TRUST_PROXY) it is the LAST X-Forwarded-For entry: the one the
 * proxy itself added. Earlier entries are written by the client and can be forged. Without a proxy it is the
 * socket address, and the header is ignored.
 */
export function clientKey(req) {
  if (config.trustProxy) {
    const hops = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (hops.length) return hops.at(-1).slice(0, 64);
  }
  return req.socket?.remoteAddress ?? 'unknown';
}

const proto = (req) => String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim().toLowerCase();
/** True when a trusted proxy says this request arrived over plain http (the password would travel in clear text). */
export const isPlainHttp = (req) => config.trustProxy && proto(req) === 'http';
/** True when a trusted proxy says this request arrived over https. */
export const isHttps = (req) => config.trustProxy && proto(req) === 'https';

/**
 * Counts wrong passwords per client. After `maxFailures` inside `windowMs` the client is locked out for `lockoutMs`:
 * while locked, its requests are answered without even looking at the password, so guessing gets nowhere.
 */
export function createThrottle({ maxFailures = config.authMaxFailures, windowMs = config.authWindowMs, lockoutMs = config.authLockoutMs, now = Date.now } = {}) {
  const hits = new Map(); // key -> { fails, since, lockedUntil }
  const trim = () => { while (hits.size > 5000) hits.delete(hits.keys().next().value); };
  return {
    /** Seconds this client must still wait, or 0. */
    blockedFor(key) {
      const h = hits.get(key);
      if (!h?.lockedUntil) return 0;
      if (now() >= h.lockedUntil) { hits.delete(key); return 0; }
      return Math.ceil((h.lockedUntil - now()) / 1000);
    },
    /** Record a wrong password. Returns { fails, locked }. */
    fail(key) {
      let h = hits.get(key);
      if (!h || now() - h.since > windowMs) h = { fails: 0, since: now(), lockedUntil: 0 };
      h.fails += 1;
      if (h.fails >= maxFailures) h.lockedUntil = now() + lockoutMs;
      hits.set(key, h);
      trim();
      return { fails: h.fails, locked: Boolean(h.lockedUntil) };
    },
    /** A correct password clears the client's count. */
    ok(key) { hits.delete(key); },
    size: () => hits.size,
  };
}
