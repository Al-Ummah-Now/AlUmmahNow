# Bot protection: Turnstile, edge rate limits, scripted clients

Owner request 2026-11-13 ("CAPTCHA and bot block"). Wiki page: "Bot Protection" (owner steps for
the zone settings live there). Auth's side: AlUmmahNowAuth `docs/BOT_PROTECTION.md`.

## What is protected

| Endpoint (api-videos unless noted) | Turnstile | Rate limit (Workers Rate Limiting, per user, else IP) |
| --- | --- | --- |
| Sign-up, password reset / email code, sign-in after 3 failures (Auth) | always / from the 3rd failure | Auth's existing limiters |
| Contact us (admin-api `/internal/contact`, via web `/api/contact`) | always | D1 per IP/account (existing) |
| `POST /api/moderation/reports` (always an account's) | no | `REPORT_LIMITER` 10/min |
| Reports without an account (admin-api `/internal/guest-reports`, via web `/api/report`) | when Turnstile is on | `GUEST_REPORT_LIMITER` per network, then D1 per IPv4 address or IPv6 /64 and /48, and per reported item (`lib/guest-report-limits.ts`; counters deleted within two days) |
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

### App attestation (App Attest, Play Integrity; #1274, NAT-REL)

Stronger proof that a request comes from our app, **off until configured** in videos admin →
**Mobile apps** (admin-api `site_settings` key `mobile_apps`, audited; shared-types `mobile-apps.ts`).
api-videos reads the settings from admin-api `/public/mobile-apps` (once a minute per isolate,
`ADMIN_API_URL`) and turns a verified attestation into a one-hour **native proof**
(`lib/attestation/`, `routers/attestation.router.ts`):

| Call | What |
| --- | --- |
| `GET /api/apps/attestation/config` | `{apple:{enabled}, android:{enabled, cloudProjectNumber}}`; both false by default |
| `POST /api/apps/attestation/challenge` | one-time challenge (32 bytes, base64url), 5 min |
| `POST /api/apps/attestation/apple/register` | `{keyId, attestation, challenge, bundleId}`: chain to Apple's App Attestation Root CA, nonce, key id, rpIdHash of `<Team ID>.<bundle id>`, counter 0, AAGUID of the chosen environment → proof; the key is kept |
| `POST /api/apps/attestation/apple/assert` | `{keyId, assertion, challenge, bundleId}`: signature with the kept key, rising counter → proof; `404 unknown_key` → register again |
| `POST /api/apps/attestation/android` | `{token, challenge, packageName}`: Play Integrity standard token (requestHash = hex SHA-256 of the challenge), decoded with Google; `PLAY_RECOGNIZED` + device integrity → proof |

clientDataHash (Apple) is SHA-256 of the UTF-8 challenge. A disabled platform answers
`404 attestation_off`. Everything lives in KV `HUMAN_VERIFIED` (`att:c:`, `att:k:`, `att:p:` with only
the proof's hash), rate limited by `ATTEST_LIMITER` (20/min). Play Integrity also needs the worker
secret **`PLAY_INTEGRITY_SERVICE_ACCOUNT`** (the Google Cloud service account JSON key with the Play
Integrity API) on `al-ummah-now-api` (and its QA / stage Workers); without it the Android endpoint
answers `503 not_configured`.

The apps send the proof in **`X-AUN-Native-Proof`** on writes. Native client ids listed under
"Require a proof" in the admin lose the signed-client exemption: without a valid proof they get
`403 native_proof_required` (counted as `native_proof_missing` on the Abuse page). A proof is not a
bearer pass: it counts only on a signed-in request from a registered native client
(`NATIVE_CLIENT_IDS`), only while its platform's check is on, and only for the account that first
used it (the first use pins the account in KV). On any other request the header is ignored and
Turnstile applies as usual. Desktop and TV have no platform attestation and keep the
exemption. Running cost: one KV write per challenge and per proof (about one per app per hour),
nothing while it is off.

## Responses the clients handle

| Status / code | Web |
| --- | --- |
| 403 `human_check_required` (+ `siteKey`) | `useHumanCheck` runs the widget and the call is sent again with `X-Turnstile-Token` |
| 429 `rate_limited`, `Retry-After: 60` | "You are doing that too often. Please wait a minute and try again." (en/ar) |
| 403 `forbidden_client` | not shown in the web (browsers are never refused) |
| 403 `native_proof_required` | native apps only: fetch a new proof once and send again |

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

The widget's allowed domains are managed by `scripts/release/ensure-resources.ts`, never by hand:
each env's run appends that env's www hostnames (the www newsletter form) when no listed domain
already covers them (a domain allows all its subdomains), and logs the covering domain for each
host it leaves alone. It only appends, never removes. The
release token needs **Account > Turnstile > Edit**; without it the step logs a warning and the
rest of the run goes on.

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
2. Production `monitor` in every Worker; watch the Abuse page for a few days. api-videos and admin-api: `monitor` since 2026-11-16 (Auth still `off`).
3. Production `enforce`. Undo: set `off` again.

Secrets manifest: `TURNSTILE_SECRET` is a required secret of api-videos and admin-api in
`scripts/release/secrets-manifest.ts`. Before a Worker's first release with the binding,
`check:secrets` passes it as "not deployed yet; this release binds Secrets Store …" when the store
entry exists.
