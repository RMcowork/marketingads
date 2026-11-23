# Security assessment against the OWASP Top 10:2025

Date: 2026-11-23 · Scope: this repository (`ad-agents`, commit `63b3d1b` and the changes below) · Method: manual code
review of every file that handles a request, a secret, a dependency or a deployment, plus automated checks
(`npm audit`, `npm audit signatures`, lockfile and git-history scans, pattern searches), then fixes and tests.

The categories are the ones on <https://top10.owasp.org/2025/>: A01 Broken Access Control, A02 Security
Misconfiguration, A03 Software Supply Chain Failures, A04 Cryptographic Failures, A05 Injection, A06 Insecure Design,
A07 Authentication Failures, A08 Software or Data Integrity Failures, A09 Security Logging and Alerting Failures,
A10 Mishandling of Exceptional Conditions.

> ## ⚠️ NEEDS YOUR ATTENTION
>
> The code fixes are done, but **some things only you can do**. Until they are done, the service is **not safe to put
> on the internet**. Tick them off:
>
> - [ ] **1. Replace the password. Do this first.** The `APP_PASSWORD` in your local `.env` is only **8 characters**.
>   Anyone who learns the URL can try to guess it, and the password is the only thing between them and your paid
>   Anthropic and OpenAI accounts. Make a new one: `openssl rand -base64 24`. Put it in `.env` **and** in the cloud
>   variables (Railway, App Platform or the droplet's `.env`). Until you do, the cloud server **will refuse to start**
>   with a password under 12 characters (this is on purpose).
> - [ ] **2. Set spending limits in the provider consoles** (Anthropic and OpenAI). The caps inside the app can be
>   reset by a restart. The monthly limit at the provider is the one that cannot be bypassed.
> - [ ] **3. Check `AD_TRUST_PROXY` after you deploy.** It is on by default in the cloud, which is right behind
>   Railway, App Platform or Caddy. If the service ever runs reachable directly (no proxy in front), set
>   `AD_TRUST_PROXY=off`, or an attacker can fake their address and dodge the login lockout.
> - [ ] **4. Decide `AD_REVIEW_FAIL`.** `open` (default): if the second-model reviewer is down, ads still go out,
>   marked "not reviewed". `closed`: nothing goes out without the review. For a business account, `closed` is the
>   safer choice.
> - [ ] **5. Secure GitHub.** Turn on **two-factor sign-in** for the `RMcowork` account, and require a pull-request
>   review for `main`. Then nobody (including a stolen login) can ship code to production alone. Accept the
>   Dependabot pull requests that arrive each week: they carry security fixes.
> - [ ] **6. Never paste keys, the password or the Telegram bot token into a chat, an issue or a screenshot.** If one
>   ever leaks, create a new one in the provider's console, update the variables, then delete the old one.
> - [ ] **7. Test it for real before customers see it.** No live penetration test was done, the Docker image was not
>   built, and the second-model reviewer has not yet judged a real ad. Run one Hebrew and one Arabic ad (about $0.40),
>   and build the image once (`docker build .`) before the first deploy.
> - [ ] **8. Confirm the prices.** The prices in `prompts/facts.md` are invented placeholders. The service now checks
>   every price against that file exactly, so a wrong file means wrong, but "approved", ads.
>
> **Open items I did not change** (details in the table at the end): upgrade the Anthropic SDK (0.124 to 1.x) after a
> live test, replace the NodeSource install script in `deploy/setup-droplet.sh`, drop `'unsafe-inline'` from the
> CSP, run the container as a non-root user, and add an alert on `[security]` log lines.

## Summary

**19 findings. 15 fixed in code, 1 needs an action from you (the password), 3 are accepted or left as recommendations.**
No critical finding. The service had good bones (one password with a constant-time check, no HTML injection, strict
picture ids, spending caps, a locked-down agent). The serious gaps were no brute-force protection, a weak password
allowed, and a price check that could be fooled.

| # | Category | Finding | Severity | Status |
|---|---|---|---|---|
| 1 | A07 | No limit on wrong passwords: the only gate could be guessed at full speed | High | **Fixed** |
| 2 | A07 | Passwords under 12 characters only warned. Your local `.env` password is **8 characters** | High | **Fixed in code. You must rotate it** |
| 3 | A06 | The price check was a substring match: `₪6` passed when `₪62` was listed, `₪10` passed when the request said `₪100` | High | **Fixed** |
| 4 | A04 | Nothing stopped the password travelling over plain http | Medium | **Fixed** |
| 5 | A05 | A brief from a model that read the open web could close the reviewer's `<brief>` tag and talk to it | Medium | **Fixed** |
| 6 | A10 | `{"request": {...}}` was accepted and started a paid run with the text `[object Object]`; `null` gave a 500 | Medium | **Fixed** |
| 7 | A09 | A provider error that echoes a key (OpenAI masks only part of it) went to the log, the page and Telegram | Medium | **Fixed** |
| 8 | A09 | Failed logins were not logged at all | Medium | **Fixed** |
| 9 | A10 | No global handler for errors nobody caught | Medium | **Fixed** |
| 10 | A03 | Docker base image referenced by a movable tag | Medium | **Fixed** |
| 11 | A08 | Fonts downloaded from the internet had no integrity record | Medium | **Fixed** |
| 12 | A02 | CSP lacked `object-src`, `base-uri`, `form-action`; no Permissions-Policy, COOP, CORP | Low | **Fixed** |
| 13 | A02 | No slow-client timeouts (slow-loris) | Low | **Fixed** |
| 14 | A02 | DigitalOcean spec did not store the Telegram token as a secret and missed new settings | Low | **Fixed** |
| 15 | A05 | Model-written fields with no size cap flowed into the image prompt, the page and the reviewer; price regex ran on unbounded text | Low | **Fixed** |
| 16 | A03 | Dependencies could run install scripts; no automated update process | Low | **Fixed** |
| 17 | A10 | A reviewer that is down always let ads through (fail open) | Low | **Option added** (`AD_REVIEW_FAIL=closed`) |
| 18 | A04 | `TELEGRAM_API_BASE` could be set to plain http, sending the bot token in clear text | Low | **Fixed** |
| 19 | several | Accepted risks and recommendations (see the end) | Low | **Documented** |

## What was checked and found sound

- **A01.** Every `/api` route needs the password; only `/health` and the two static files are public. Ad ids must match
  a strict pattern, so `../` and similar are a 404 (tested). Picture paths are rebuilt from the id, never taken from the
  request. No CORS headers, so another website cannot call the API from a browser. The server fetches only fixed hosts
  (Anthropic, OpenAI, Google, Telegram): it never fetches a URL a user or the model supplies, so there is no server-side
  request forgery. The Telegram bot ignores groups and every chat not on the allowlist.
- **A03.** `npm audit`: 0 vulnerabilities. `npm audit signatures`: all 25 installed packages have verified registry
  signatures, 10 have verified provenance attestations. The lockfile has an integrity hash for all 49 entries, every
  one from `registry.npmjs.org`, and no install scripts. Four direct dependencies only. Git history has no key,
  token or private key in any commit, and `.env` was never tracked.
- **A04/A07.** The password is compared by SHA-256 digest with `timingSafeEqual` (no timing leak). There are no
  sessions or cookies, so no CSRF and no session fixation: the page sends the password in a header from a script.
  Job ids come from `crypto.randomBytes`.
- **A05.** No `eval`, no shell commands from request data, no SQL, no `innerHTML`: the page writes everything with
  `textContent` and shows source links only for `http(s)` with `rel="noopener noreferrer"`. Telegram messages are sent
  as plain text. The headline overlay draws glyph outlines only, so the model's text is never put into an SVG as text.
- **A10.** Every outgoing request has a timeout, every agent session has a budget and a time limit, and a corrupt job
  or state file is treated as missing and not as a crash.

## Findings and fixes, by category

### A07 Authentication Failures

**1. No brute-force protection (High).** Any client could try passwords as fast as the server answered.
*Fix:* `src/security.mjs` counts wrong passwords per client. After 8 in 15 minutes the client is locked out for 15
minutes and gets `429` with `Retry-After`, without its password even being looked at, so a correct guess made during
the lockout does not help. The client is the last `X-Forwarded-For` entry (the one the trusted proxy added), because
earlier entries can be forged; without a proxy the header is ignored. Settings: `AUTH_MAX_FAILURES`,
`AUTH_WINDOW_MINUTES`, `AUTH_LOCKOUT_MINUTES`. *Tests:* lockout, expiry, per-client separation, forged-header
evasion with and without a proxy, table size cap.

**2. A weak password was allowed (High).** The server only warned below 12 characters, and the `APP_PASSWORD` in
your local `.env` is **8 characters** (I did not print it). *Fix:* when `NODE_ENV=production` (which the Dockerfile and
the droplet service set) the server refuses to start with a password under 12 characters; on a laptop it warns.
**Action for you:** generate a new one with `openssl rand -base64 24`, put it in `.env` and in the cloud variables,
and log in again. I did not change your `.env`, because it holds your secrets.

### A06 Insecure Design

**3. The price guard could be fooled (High).** The service's main promise is that a price in an ad must be a price the
owner gave. The check used `usedText.includes(price)`, a substring match. Confirmed on the old code: copy saying `₪6`
was accepted when `₪62` was listed, and `₪10` was accepted when the request said `₪100`. *Fix:* prices are now compared
as whole amounts (`src/brief.mjs`). *Tests:* `₪6`, `₪620` and `₪10` are refused, and `₪62`, `62 ₪` and the owner's
`₪100` are accepted.

**17. The reviewer fails open (Low).** If the second-model reviewer is down, ads go through marked `skipped`. That keeps
the service available and the code checks still run, so it stays the default. *Option added:* `AD_REVIEW_FAIL=closed`
holds the draft back instead (and spends nothing on a picture). Tested both ways.

### A04 Cryptographic Failures

**4. The password could travel in clear text (Medium).** *Fix:* behind a trusted proxy, a request the proxy reports as
`http` is refused with `403` (except `/health`, which platform health checks use), and `https` responses carry
`Strict-Transport-Security`. `AD_TRUST_PROXY` is on by default in production. **18.** `TELEGRAM_API_BASE` must be
`https` (or localhost for tests), because the bot token is part of every request URL; the server refuses to start
otherwise.

### A05 Injection

**5. Prompt injection into the reviewer (Medium).** The brief is written by a model that read the open web, then
embedded in the reviewer's message between `<brief>` tags. A caption containing `</brief>` followed by fake
instructions could have escaped the tag. *Fix:* the brief is embedded as JSON with every `<` written as `<`
(still valid JSON). *Test:* a malicious caption stays inside one `<brief>` block and round-trips unchanged.

**15. No size caps (Low).** `image.avoid`, `text_in_image` (one huge "word"), `angle`, `facts_used`, hashtags and
source urls and notes had no limits, and the price pattern ran on whatever length it was given. *Fix:* caps on all of
them, source urls with spaces refused, and the price pattern runs on at most 3,000 characters. *Test:* a 300,000
character caption is refused in 40 ms.

*Residual:* the writer reads untrusted web pages, so prompt injection of the writer cannot be removed, only limited.
It is limited by design: the agent has only web search and fetch, holds no keys, cannot post, and everything it
submits is checked by code (facts, prices, lengths, banned words) and by a second model before anything is drawn.

### A10 Mishandling of Exceptional Conditions

**6. Bad input handled wrongly (Medium).** `{"request": {"a": 1}}` became the ad text `[object Object]` and started a
paid run; a `null` body gave a 500. *Fix:* the body must be a JSON object, `request` and `text` must be strings, body
size is counted in bytes (not characters), and an oversized body now gets a clear `413` before the connection closes.
**9. No global handler.** *Fix:* `unhandledRejection` is logged (with secrets removed), and `uncaughtException` is
logged and the process exits so the platform restarts it, instead of continuing in an unknown state.
**7 and 17** are covered under A09 and A06.

### A09 Security Logging and Alerting Failures

**8. Failed logins were invisible (Medium).** *Fix:* the first three wrong passwords from a client and every lockout
are logged as `[security] ...` with the client address, never the password; further guesses are not logged one by one,
so an attacker cannot flood the log. **7. Secrets in logs and on screen (Medium).** Provider errors can echo
keys (OpenAI includes a partly masked key) and a Telegram bot token sits in every request URL. *Fix:* everything
printed passes through `redact()` (`src/log.mjs`), which removes the configured secret values and anything shaped
like an Anthropic, OpenAI, Google or Telegram key or an Authorization header. The same function cleans the error
text shown on the page and sent to Telegram. *Tests:* every key shape, an Error object, and that the lockout log
contains no password. While writing these tests I found my own first Telegram pattern missed tokens inside a URL
(`/bot123456:AA...`), and fixed it.

### A03 Software Supply Chain Failures

**10. Movable base image (Medium).** *Fix:* `FROM node:22-slim@sha256:e9f565d3...`, the digest taken from the registry.
**16. Install scripts and no update process (Low).** *Fix:* `npm ci --ignore-scripts` in the image and in
`deploy/deploy.sh` (verified: a clean install still loads sharp, fontkit, bidi-js and the Anthropic SDK),
`.github/dependabot.yml` for npm and Docker (weekly pull requests, including new base-image digests), and
`npm run audit` (audit plus signature check).

### A08 Software or Data Integrity Failures

**11. Fonts without an integrity record (Medium).** Six fonts and their licences were downloaded from GitHub's
`main` branch. *Fix:* `assets/fonts/manifest.json` records the SHA-256 of all 14 files and their source, and
`test/fonts.mjs` fails if any file changes.

### A02 Security Misconfiguration

**12.** CSP now also has `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`; every response has
`Permissions-Policy`, `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy`. **13.** `headersTimeout` 15 s,
`requestTimeout` 30 s, `keepAliveTimeout` 5 s, at most 60 headers. **14.** `scripts/do-app-spec.mjs` now lists the
Telegram token (as a secret), the chat allowlist, the reviewer and the new settings.

### A01 Broken Access Control

No defect found. See "found sound" above. One design note: the service has a single shared password, so everyone who
has it sees every ad (accepted: it is a one-business tool).

## Accepted risks and recommendations (item 19)

| Risk | Why it is left | What to do |
|---|---|---|
| The CSP keeps `style-src 'unsafe-inline'` (the page has one inline `<style>`). Scripts are still locked to the site | Moving the styles to a file is a cosmetic refactor; the residual risk (style injection) is low | Move the `<style>` into `public/` and drop `'unsafe-inline'` |
| The container runs as root | Railway mounts volumes owned by root, so a normal user cannot write to `/app/data` | Use a non-root user if you attach a volume with the right owner |
| `deploy/setup-droplet.sh` pipes NodeSource's installer into bash | Cannot be tested here without a droplet | Replace with NodeSource's signed apt repository (key plus `signed-by` list), the way the script already adds Caddy |
| `@anthropic-ai/sdk` is 0.124.0; 1.13.0 exists | A major upgrade must be tested against the Managed Agents calls; no vulnerability is known in 0.124 | Upgrade in a branch and run the live test |
| The daily run counter lives in memory and resets on restart | Fixing it needs persisted state and changes the restart tests | Cap spend in the Anthropic and OpenAI consoles (the README already says so) |
| The writer's web research can be steered by a hostile page | Inherent to reading the open web | Keep the agent tool-less, key-less and validated, as now |
| systemd hardening is already decent; stricter options were not added untested | A wrong option can stop the service | Try `PrivateDevices`, `ProtectKernelTunables`, `RestrictAddressFamilies` on a test droplet |
| No alerting on `[security]` log lines | Depends on the platform | Add a Railway or log-drain alert on `[security]` and on repeated `401`/`429` |
| Branch protection and 2FA | Settings on GitHub, not in the code | Turn on two-factor sign-in and require a review for `main`, so no single person can ship code to production unreviewed |

## What was not done

No live penetration test against a deployed instance. The Docker image was not built (the Docker daemon is not running
here); the pinned digest comes from the registry and the install step was tested in a scratch folder. No review of
Railway, DigitalOcean, Anthropic, OpenAI or Telegram account settings. The real reviewer model's behaviour on hostile
input was not tested (no live run).

## How to re-run the checks

```bash
npm test                  # 250 offline tests, including test/security.mjs (79 checks)
npm run test:security     # only the security tests
npm run audit             # known vulnerabilities and registry signatures of the dependencies
```
