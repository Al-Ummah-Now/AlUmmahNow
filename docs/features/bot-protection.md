# Bot protection: Turnstile, edge rate limits, scripted clients

Owner request 2026-11-13 ("CAPTCHA and bot block"). Wiki page: "Bot Protection" (owner steps for
the zone settings live there). Auth's side: AlUmmahNowAuth `docs/BOT_PROTECTION.md`.

## What is protected

| Endpoint (api-videos unless noted) | Turnstile | Rate limit (Workers Rate Limiting, per user, else IP) |
| --- | --- | --- |
| Sign-up, password reset / email code, sign-in after 3 failures (Auth) | always / from the 3rd failure | Auth's existing limiters |
| Contact us (admin-api `/internal/contact`, via web `/api/contact`) | always | D1 per IP/account (existing) |
| `POST /api/moderation/reports` | always | `REPORT_LIMITER` 10/min |
| `POST /api/videos/:id/comments`, post comments | an account's **first** comment | `COMMENT_LIMITER` 10/min |
| `POST /api/community/channels/:channelId/posts` | an account's **first** post | `POST_LIMITER` 5/min |
| likes, dislikes, votes, comment likes, subscriptions (POST/DELETE) | no | `REACTION_LIMITER` 60/min |
| `POST /api/videos/upload/initiate`, batch initiate | no (creator tiers already gate uploads) | `UPLOAD_INITIATE_LIMITER` 10/min, plus the D1 tier limits |
| `GET /api/search`, `GET /api/videos/search` | no | `SEARCH_LIMITER` 120/min |
| `GET /api/search/suggestions` | no | existing `SUGGEST_LIMITER` 120/min |

"First": once an account passes, api-videos remembers it for 180 days (KV `HUMAN_VERIFIED`,
`h:<userId>`). Tokens issued to our native apps (`NATIVE_CLIENT_IDS`, the token's `aud`) are never
asked: the apps cannot show the widget; rate limits still apply.

Rate-limit keys: the signed-in user, else `CF-Connecting-IP`. Requests from Cloudflare's own
addresses (`2a06:98c0::/29`: the web app's server actions and SSR call the API from a Worker) are
keyed by user only, so one shared Worker address never throttles everyone. Reads stay open to every
client, including Googlebot, Bingbot and link previewers.

Scripted clients: with `TURNSTILE_MODE=enforce` in **production**, writes (`POST/PUT/PATCH/DELETE
/api/*`) from curl, python-requests, Go-http-client, wget, Scrapy and similar answer 403
`forbidden_client`. Requests without a User-Agent are allowed (Worker subrequests).

## Responses the clients handle

| Status / code | Web |
| --- | --- |
| 403 `human_check_required` (+ `siteKey`) | `useHumanCheck` runs the widget and the call is sent again with `X-Turnstile-Token` |
| 429 `rate_limited`, `Retry-After: 60` | "You are doing that too often. Please wait a minute and try again." (en/ar) |
| 403 `forbidden_client` | not shown in the web (browsers are never refused) |

The web asks `GET /api/me/human-check?kind=comment|post|report` first and gets the token before
submitting, so a first comment is not refused and resent. Contact us is anonymous: the page sends,
gets 403 `human_check_required` with the site key, runs the check and sends again.

The widget is Cloudflare Turnstile in managed mode rendered `appearance: "interaction-only"`: almost
everyone sees nothing; when Cloudflare needs a click, a small labelled panel (`role="dialog"`)
appears at the bottom of the screen and takes focus. Copy: `humanCheck.*` in
`@al-ummah/shared-types` (en/ar). CSP: `https://challenges.cloudflare.com` in `script-src` (CSP2
fallback; CSP3 loads it through `'strict-dynamic'`) and `frame-src`.

## Modes, keys, environments

`TURNSTILE_MODE` (var, per Worker): `off` | `monitor` (verify and count, never refuse) | `enforce`.

| Env | Mode | Site key | Secret (Secrets Store) |
| --- | --- | --- | --- |
| local stack, unit tests, CI | `off` (the production config's value) or test keys | — | — |
| QA, stage | `enforce` | Cloudflare test key `1x00000000000000000000AA` | `turnstile-secret-test` (the public always-pass test secret) |
| production | `off`, then `monitor`, then `enforce` | `0x4AAAAAAF_3KPNkPlEGf_dP` (widget "al-ummah-now-production": alummahnow.net/.org/.com/.app) | `turnstile-secret` |

Test keys never reach Cloudflare: the server answers the test secrets itself (`lib/bot-guard.ts`)
and the web loads `/turnstile/stub.js` instead of `challenges.cloudflare.com`. Production refuses
test keys (the mode reads as `off`, an error is logged). E2E helpers that call the API directly send
Cloudflare's documented dummy token `XXXX.DUMMY.TOKEN.XXXX`, which only the test secret accepts.

A siteverify outage is let through and counted (`turnstile_error`): rate limits still apply, and an
outage at Cloudflare must not stop every comment.

Test bypass (never production): `X-AUN-Bot-Bypass: v1.<unix ts>.<hex HMAC-SHA256("v1.<ts>")>`
signed with `BOT_BYPASS_SECRET` (Secrets Store `bot-bypass-secret-nonprod`), 6 hours either way.
Not bound anywhere in this repo today (QA/stage use the test keys); Auth binds it on QA/stage.

## Abuse panel

Every outcome is one Analytics Engine point (`ABUSE_EVENTS`; datasets `al_ummah_now_abuse`,
`_stage`, `_qa`): blobs `[app, endpoint, kind, env]`, kinds `turnstile_pass`, `turnstile_fail`,
`turnstile_missing`, `turnstile_error`, `rate_limited`, `bad_user_agent`, `bypass`. No IP, email,
token or user id. Writers: Auth, api-videos, admin-api (Contact us) and the CMS (refused searches, CMS#120).

The videos admin **Abuse** page (`/abuse`, Operations group, `ops:read`) shows totals and per-endpoint
counts for 24 h or 7 days per environment. admin-api `GET /api/abuse/summary` reads the counters
with the Analytics Engine SQL API (`CF_ANALYTICS_TOKEN`, the cost monitor's Account Analytics token)
and caches each answer 5 minutes. No D1 reads or writes.

## Rollout

1. Merge with production `off` (Auth, api-videos, admin-api).
2. Production `monitor` in every Worker; watch the Abuse page for a few days.
3. Production `enforce`. Undo: set `off` again.

Secrets manifest: `TURNSTILE_SECRET` is not listed as required in
`scripts/release/secrets-manifest.ts` yet, because the release checks live production before the
new version is deployed; add it after the first release that carries the binding.
