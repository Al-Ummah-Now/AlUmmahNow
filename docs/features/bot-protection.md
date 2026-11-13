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

## Native apps

The native apps cannot run the Turnstile widget. Their Turnstile-equivalent is the token itself:
an access token Auth signed for a **registered native OAuth client** (its `aud`). The apps sign
up and sign in on Auth's web pages (system browser, Android Custom Tab, `ASWebAuthenticationSession`,
the TV device code on a phone), and those pages carry Turnstile, so every native token belongs to
an account that passed it. Rate limits still apply to native traffic.

`NATIVE_CLIENT_IDS` (api-videos) must list every native client of the environment:

| Client | Production / stage | QA |
| --- | --- | --- |
| Viewer (iOS / Android) | `567a2cbc-dab8-4d5c-9437-a9e61c7120f5` | `31389afb-d4f8-4c26-9492-4c77f4d07e65` |
| Viewer (TV) | `111648c6-24e6-4c35-8bcf-f50ab5c0d96d` | `9c3a81c8-3f9c-4873-abb1-a51e4f1d9543` |
| Viewer (desktop) | `f97abe68-ef61-41b6-bf08-d86650cc7cb3` | `ce7de8a4-59dd-4682-ab4d-105399105294` |
| Studio (iOS / Android) | `6f8073c6-754b-4d63-bf80-0546214e0d62` | `45364a42-21f4-4359-a76c-0a1e6615fd7b` |
| Studio (desktop) | `950e2b3b-6353-4472-affe-7c1f57f4e6a4` | `29b4792a-caad-4814-a83f-4337bc6a1aeb` |

`test/native-clients.spec.ts` pins this list against the wrangler configs. A new native client
(the native admin app, AUN-ADMIN-NATIVE) is registered in Auth, added here and to the test in the
same PR.

User-Agents: the scripted-client refusal (production, `enforce`) must never catch a native app.
What they send today, all allowed (pinned by the same test, every write method, TUS included):
AlUmmahNowCore `aun-core/<ver>` with the app's prefix (`AlUmmahNow-iOS/…`, `AlUmmahNow-Studio-Android/…`,
`AlUmmahNowStudioWindows/…`, `AlUmmahNowStudioLinux/…`); Apple URLSession `<App>/<ver> CFNetwork/… Darwin/…`
(Studio TUS background uploads); Android OkHttp `okhttp/<ver>` and tus-java-client over
HttpURLConnection `Dalvik/2.1.0 (…)`; the Windows and Linux viewers `AlUmmahNowWindows/0.1`,
`AlUmmahNowLinux/0.1`; no User-Agent at all (Core's telemetry sink). A native client must never
use a library default that is on the list (curl, python-requests, Go-http-client, `Java/<ver>` from a
desktop JVM). Auth's refusal covers only its `/password/*` form posts, which native apps never make
(they use the browser).

Stronger proof that a request comes from our app (App Attest / DeviceCheck on Apple, Play
Integrity on Android) needs the owner's Apple and Google accounts; tracked in #1274.

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

Secrets manifest: `TURNSTILE_SECRET` is a required secret of api-videos and admin-api in
`scripts/release/secrets-manifest.ts`. Before a Worker's first release with the binding,
`check:secrets` passes it as "not deployed yet; this release binds Secrets Store …" when the store
entry exists.
