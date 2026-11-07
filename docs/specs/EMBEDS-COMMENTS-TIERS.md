# Sharing, Embeddable Player, Embedded Discussions & Plan Tiers

**Status:** Draft v1 for review
**Date:** 2026-11-07
**Epics:** 25 (Sharing & embeddable player), 26 (Embedded discussions: "Ummah Comments"), 27 (Plans & entitlements framework)
**Related:** `docs/epics.md` (1–8), `docs/native-apps/EPICS.md` (9–24), `docs/compliance/GDPR.md`

---

## 1. Summary

1. **Every video is shareable and embeddable** with the Al Ummah Now player: links at a timestamp,
   rich previews on social platforms, oEmbed, and an `<iframe>` player with a JavaScript API.
2. **Embedded discussions**: a website owner drops one tag on their page to get an Al Ummah Now
   video **plus its comment thread**, or a comment thread alone, powered by Al Ummah Now accounts,
   moderation and anti-abuse. No need to build or host a comment system. Owners manage their sites,
   threads and moderation from **Studio**.
3. **Every feature is tier-aware from day one.** A plans & entitlements framework (Epic 27) is built
   now, with everyone on **Free** until billing exists. Each feature declares its entitlement keys
   and free-tier defaults.

Inspiration: YouTube embeds and IFrame API, Disqus / Giscus / Commento-style comment plugins, and Vimeo's
domain-level privacy, combined in one product: **the video and its community travel together.**

---

## 2. Concepts

| Term | Meaning |
|---|---|
| **Site** | An external website registered by a channel/organisation in Studio (e.g. `masjid-example.org`). Has verified domains, a public **site key**, settings and a plan. |
| **Embed** | The Al Ummah Now player rendered on a third-party page (iframe). |
| **Discussion** | A comment thread rendered on a third-party page by the widget. |
| **Thread** | A comment thread, attached either to a **video** (shared with the video page on alummahnow.net) or to a **page** of a Site (keyed by a stable page key). |
| **Thread scope** | `shared` (same comments everywhere the video appears) or `site` (a separate thread per Site/page, optionally still linked to the video). |
| **Entitlement** | A named capability or limit (e.g. `embed.domains.max = 3`) granted by a Plan, with optional overrides. |

---

## 3. Epic 25: Sharing & embeddable player

### 25.1 Share sheet (web + apps)
- Copy link, **"start at current time"** toggle (`?t=754`), QR code, native share (mobile), and quick
  targets (WhatsApp, Telegram, X, Facebook, email).
- Share playlists, channels, live streams, community posts, and **chapter links**.
- Short links: `alummah.link/v/{shortId}` (optional; Worker redirect + click analytics).
- AC: links open the web watch page or the native app (universal/app links, Epic 9.1) at the exact time.

### 25.2 Rich previews
- Open Graph + Twitter `player` cards (title, localised description, thumbnail, duration,
  `og:video` with an embed URL), `hreflang` for en/ar, JSON-LD `VideoObject` for SEO.
- AC: previews render in WhatsApp, Telegram, X, Facebook, LinkedIn and Discord, and pass Google's rich results test.

### 25.3 oEmbed provider
- `GET https://videos.alummahnow.net/oembed?url=…&maxwidth=&maxheight=&format=json` returns
  `type: video` with the iframe HTML. Discovery `<link rel="alternate" type="application/json+oembed">`
  on watch pages.
- AC: pasting a link into WordPress, Notion, Ghost, Discourse or Medium (where oEmbed is supported)
  embeds the player.

### 25.4 Embed player (iframe)
- URL: `https://embed.alummahnow.net/v/{videoId}` (also `/p/{playlistId}`, `/live/{streamId}`).
- Parameters: `start`, `end`, `autoplay` (muted only), `loop`, `controls`, `captions={lang}`,
  `lang=ar|en` (UI and RTL), `chapters=1`, `speed=1`, `theme=dark|light|auto`, `color`
  (accent, entitlement), `title=0`, `branding=0` (entitlement), `related=channel|none`
  (no cross-channel recommendations; see 25.7), `comments=0|1` (shows the discussion under the player, Epic 26).
- Same Al Ummah Now player as the site (HLS, quality, speed, chapters, subtitles, a11y from Epic 1).
- **Privacy-enhanced by default**: no cookies, analytics or session until the viewer presses play; then
  respects the viewer's consent choice (story 1.3). Signed-in state uses a first-party popup, never
  third-party cookies.
- Responsive (`aspect-ratio` wrapper snippet), lazy-loading snippet (`loading="lazy"`), facade mode
  (thumbnail + play button, player loads on click) for page performance.
- AC: Lighthouse impact under 50 KB before interaction in facade mode; passes axe on the host page; works in
  RTL host pages.

### 25.5 Player JavaScript API
- `@alummahnow/embed` (npm + CDN script) wrapping `postMessage`:
  `player.play()`, `pause()`, `seek(t)`, `setCaptions(lang)`, `getCurrentTime()`, events
  `ready|play|pause|ended|timeupdate|chapterchange|error`.
- Strict origin checks in both directions; messages versioned (`aun:v1:*`).
- AC: documented with examples; type definitions published.

### 25.6 Creator embed controls (Studio)
- Per video: **embedding allowed** (default on), **allowed domains** list (default: anywhere),
  **"only on my verified Sites"** option, default start time, default captions language.
- Enforced via `Content-Security-Policy: frame-ancestors` computed per video, plus a signed embed
  token for domain-restricted videos (prevents copying the iframe elsewhere).
- Private and unlisted videos follow their visibility rules; embed of private requires a signed,
  expiring embed token issued to a verified Site.
- AC: blocked domains show a branded "This video can't be played on this site" card with a link
  to watch on Al Ummah Now.

### 25.7 Embed end screen & related
- End screen: replay, "Watch on Al Ummah Now", the **same channel's** next videos only (never other
  channels' content on someone's website), subscribe button (popup sign-in).

### 25.8 Embed analytics
- Plays, watch time and completion by **domain and page**, in Studio analytics (Epic 2 rollups +
  new `embed_domain` dimension). Domain-level retention follows the tier.

### 25.9 Cost guardrails
- Embeds drive delivery volume on our CDN (see cost decision D2). Embed delivery uses the same
  CDN path as the site; usage is metered per Site so tiers can set fair-use limits (27.6).

---

## 4. Epic 26: Embedded discussions ("Ummah Comments")

### 26.1 Sites in Studio
- Add a Site: name, domains (`example.org`, `*.example.org`), **domain verification** by DNS TXT
  `alummahnow-site-verification=…` or `<meta name="alummahnow-site-verification">`.
- Get a **site key** (public) and an install snippet; manage multiple Sites per channel or organisation.
- Team access via Studio roles (owner, manager, moderator; native Epic 19.6).
- AC: unverified Sites can preview the widget on `localhost` only.

### 26.2 Widget: install
```html
<script src="https://embed.alummahnow.net/widget.js" async></script>

<!-- Video + its discussion -->
<alummah-discussion site="SITE_KEY" video="VIDEO_ID" scope="shared"></alummah-discussion>

<!-- Discussion only, for any page (article, event page…) -->
<alummah-discussion site="SITE_KEY" page="events/eid-2027" title="Eid program"></alummah-discussion>
```
- Web Component in a Shadow DOM: no CSS leaks either way. Framework snippets for React and Vue,
  plus WordPress plugin and Ghost/Webflow instructions.
- `page` is the stable thread key. If omitted, the canonical URL is used (normalised, query
  string stripped by default). Configurable per Site.
- **Thread hijack protection:** a thread is bound to its Site; requests must come from a verified
  domain (`Origin` check) and match the site key. Optional **signed page config** (HMAC with a site
  secret, server-side) for sites that need strict thread identity.

### 26.3 Widget: experience
- Video player (if `video` is set) and comments under it: top/newest sort, threaded replies (1 level,
  same as the platform), likes, pin/heart (Site moderators and the video owner), report,
  "load more", live updates over WebSocket (new comments, counts).
- **Sign-in** with an Al Ummah Now account through a popup (OAuth PKCE public client per Epic 9.1;
  no third-party cookies). Registration in the same popup. Guests can read; posting requires an
  account (default). Tiers can enable **guest posting with pre-moderation** (27.5).
- Language: Arabic/English UI auto-detected from the host page `lang`/`dir`, overridable; RTL support.
- Theming: light/dark/auto; accent colour, font inheritance and corner radius (tiered).
- Accessibility: WCAG 2.1 AA (Epic 1 standards), keyboard-complete, screen-reader announcements for
  new comments.
- Respectful-speech nudge before posting; Islamic etiquette reminders configurable by the Site.
- AC: renders under 30 KB gzipped before interaction (lazy loads on scroll into view); CLS-safe placeholder.

### 26.4 Thread scope
- **Shared** (`scope="shared"`, video only): the same thread appears on alummahnow.net and every
  embed. Ideal for creators who want one community.
- **Site** (`scope="site"`): a separate thread per Site/page. Comments can be **surfaced on the
  video page** under "Discussions on other sites" (opt-in by the Site), linking back to the site.
- The Site owner chooses defaults; the video owner can disallow `site` threads for their video.

### 26.5 Moderation (Studio → Sites → Moderation)
- Queue: pending (pre-moderation), reported, held by filters; bulk approve/remove; ban user from Site;
  shadow-hold.
- Rules: keyword and link filters (Arabic and Latin normalisation), first-post pre-moderation, slow mode,
  minimum account age, close thread, auto-close after N days.
- Platform safety still applies: reports flow into the existing admin moderation (admin-web), and
  platform bans are global.
- Notifications to Site moderators (email, push, Studio inbox).
- Audit log of moderation actions.

### 26.6 Anti-abuse
- Rate limits per user, IP and Site; Cloudflare Turnstile challenge on suspicious posting; link
  limits for new accounts; duplicate detection; Site-level CORS/origin enforcement.

### 26.7 SEO & no-JS
- Optional server-side snapshot: `GET /api/discussions/{site}/{page}/snapshot.html` (cached) for sites
  to include for crawlers or as `<noscript>`; JSON-LD `Comment` markup.

### 26.8 Data, privacy & export
- Commenters' data falls under the existing GDPR features (export/erasure, story 1.3). Widget
  comments are included.
- The widget sets **no cookies** on the host page. Session lives in the popup/first-party iframe.
- Site owners can **export** their threads (JSON/CSV) and get a webhook on new comments (tiered).
- Sites' privacy-policy helper text is provided in Studio.

### 26.9 API (api-videos, new router `/api/sites`, `/api/discussions`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST/GET/PATCH/DELETE | `/api/sites[/:siteId]` | owner/manager | Manage Sites |
| POST | `/api/sites/:siteId/verify` | owner | Check DNS/meta verification |
| GET | `/api/discussions/:siteKey/threads/:pageKey` | public (Origin-checked) | Thread + first page of comments |
| POST | `/api/discussions/:siteKey/threads/:pageKey/comments` | user | Post comment/reply |
| POST/DELETE | `…/comments/:commentId/likes` | user | React |
| POST | `…/comments/:commentId/report` | user | Report |
| GET/POST | `/api/sites/:siteId/moderation[...]` | moderator | Queue, approve, remove, ban |
| GET | `/api/sites/:siteId/export` | owner | Export threads |
| POST | `/api/sites/:siteId/webhooks` | owner | Configure webhooks (tiered) |
| GET | `/oembed`, `/embed/v/:id` (embed host) | public | Embeds |

Storage: Sites and site membership in D1 (relational, small); threads and comments in R2 alongside
existing comment storage, with per-thread index objects; counters via existing processor rollups.

### 26.10 Studio surfaces
- Sites list and settings, install snippet generator (with live preview), moderation queue,
  discussion analytics (comments/day, top pages, top commenters, embed plays by page).

---

## 5. Epic 27: Plans & entitlements framework

**Principle:** *Every feature ships tier-aware.* Billing can come later; plans, entitlements,
limits and metering exist now, and everyone is on **Free** with generous defaults.

### 27.1 Data model (D1, `admin-api` owned)
- `plans` (id, slug, name_en, name_ar, description_en/ar, audience = creator|organisation|viewer, status = draft|active|archived, is_public, sort_order, version, created_by)
- `plan_prices` (plan_id, currency, interval = month|year|one_time, amount, provider_price_refs_json): a plan can have several prices; each provider maps its own product/price ids here
- `plan_entitlements` (plan_id, key, value_json), e.g. `{"embed.domains.max": 3}`
- `subscriptions` (subject_type = channel|organisation|user, subject_id, plan_id, plan_version, status = trialing|active|past_due|canceled|expired, current_period_start/end, provider = manual|<provider id>, provider_subscription_ref)
- `payment_providers` (id, adapter, display_name, enabled, regions, currencies, config_ref) and `payment_events` (provider, event_id, type, payload_hash, processed_at) for idempotent webhook processing
- `entitlement_overrides` (subject, key, value, expires_at, reason) for grants, trials and partners
- `usage_counters` (subject, key, period, value), updated by the processor

### 27.2 Resolution & enforcement
- `GET /api/entitlements?subject=channel:{id}` returns the resolved entitlements (plan + overrides),
  cached in KV (60 s) and invalidated on change.
- API middleware `requireEntitlement(key)` / `checkLimit(key, n)` returns **402-style** structured
  errors `{ error: "upgrade_required", entitlement: "embed.customBranding" }` the UIs can render
  as an upsell or "available on Pro".
- UI helper `useEntitlement(key)` (web, Studio, apps); disabled controls show the required plan.
- **Definition of Done addition (all epics):** each feature lists its entitlement keys, Free
  defaults and the behaviour at the limit.

### 27.3 Plans are custom and admin-managed (decision T1: resolved)
Plans are **not hard-coded**. Admins create, edit, version, price, publish and retire plans in admin-web
(27.6); the table below is only the **initial seed** suggestion. Changing a plan creates a new
**version**; existing subscribers stay on their version until migrated (bulk migrate with notice).
Custom/private plans (e.g. a negotiated Institution deal) are plans with `is_public = false`
assigned to specific subjects.

| Plan | Audience | Intent |
|---|---|---|
| **Free** | everyone | Full platform use, embeds and comments widget with fair limits and branding |
| **Plus** | individual creators/scholars | More Sites and domains, custom colours, longer analytics, priority processing |
| **Pro** | channels/teams | Unbranded embeds, guest posting, webhooks, advanced moderation, team seats |
| **Institution** | masjids, universities, publishers | Many channels/Sites, SSO later, SLA, bulk import (Studio Desktop), dedicated support |
| **Viewer Premium** (later) | viewers | Offline downloads, early access (native Epic 24) |

### 27.4 Entitlement matrix: embeds & discussions (initial seed values, editable by admins)
| Key | Free | Plus | Pro | Institution |
|---|---|---|---|---|
| `share.shortLinks` | ✅ | ✅ | ✅ | ✅ |
| `embed.enabled` | ✅ | ✅ | ✅ | ✅ |
| `embed.domains.max` (domain-restricted videos) | 1 | 5 | 25 | unlimited |
| `embed.customColor` | — | ✅ | ✅ | ✅ |
| `embed.hideBranding` | — | — | ✅ | ✅ |
| `embed.privateVideos` (signed embeds) | — | ✅ | ✅ | ✅ |
| `embed.analytics.retentionDays` | 28 | 90 | 365 | 730 |
| `sites.max` | 1 | 3 | 10 | unlimited |
| `discussions.pageThreads` (comments-only pages) | 3 pages | 50 | unlimited | unlimited |
| `discussions.monthlyComments` | 1,000 | 10,000 | 100,000 | custom |
| `discussions.guestPosting` (pre-moderated) | — | — | ✅ | ✅ |
| `discussions.theming` | light/dark | + colours | + fonts/radius | full |
| `discussions.moderators.max` | 1 | 3 | 10 | unlimited |
| `discussions.filters.advanced` | basic | ✅ | ✅ | ✅ |
| `discussions.export` | — | ✅ | ✅ | ✅ |
| `discussions.webhooks` | — | — | ✅ | ✅ |
| `discussions.ssr.snapshot` | — | ✅ | ✅ | ✅ |
| `studio.teamSeats` | 1 | 2 | 10 | unlimited |

Existing features get keys too (non-exhaustive): `upload.maxDurationMinutes`,
`upload.monthlyHours`, `storage.gb`, `live.monthlyMinutes`, `analytics.retentionDays`,
`studio.bulkImport`, `channel.max`, `kids.curation` (moderator only), `premium.offline` (viewer).

### 27.5 Metering & limits
- Counters incremented asynchronously (queue → processor) and checked synchronously against cached
  values. Soft limit warnings at 80%, hard stop at 100% (or overage when billing exists). A
  **grace period** keeps existing embeds working: we never break a creator's live website
  without notice.

### 27.6 Admin tooling (admin-web): Plans & Billing
- **Entitlement catalogue:** registry of every entitlement key (type: boolean | number | enum | list, unit, default, description en/ar, owning epic). Features register keys in code; the catalogue is synced so admins can only pick valid keys.
- **Plan editor:** create/clone plans, set entitlement values validated against the catalogue, bilingual names/descriptions, prices per currency and interval, public/private, draft → active → archived, versioning with a diff view.
- **Assignments:** assign/migrate plans for channels/organisations/users, trials with expiry, per-subject overrides, bulk operations.
- **Usage & limits:** usage per subject vs limits, upcoming limit breaches, grace states.
- **Provider management:** enable/disable payment providers per region/currency, map plan prices to provider product ids, webhook/event log, retry failed events.
- **Audit trail** for every plan, price, assignment and override change (who/when/why).
- RBAC: new auth roles `billing_admin` (full) and `billing_viewer` (read-only).

### 27.7 Pluggable payment providers (decision T2: resolved)
**Stripe will not be used.** Billing goes through a provider-agnostic interface so providers can be
added, swapped or run side by side per region (important for MENA and Muslim-majority markets, where
local payment methods matter).

```ts
interface PaymentProvider {
  id: string;                                   // e.g. "manual", "paddle", "paypal", "tap", "apple", "google"
  capabilities: { subscriptions: boolean; oneTime: boolean; refunds: boolean; currencies: string[]; regions: string[] };
  createCheckout(input: CheckoutInput): Promise<{ redirectUrl?: string; clientToken?: string }>;
  getSubscription(ref: string): Promise<ProviderSubscription>;
  cancelSubscription(ref: string, atPeriodEnd: boolean): Promise<void>;
  changePlan(ref: string, newPriceRef: string): Promise<void>;
  verifyWebhook(req: Request): Promise<ProviderEvent>;   // signature check + normalisation
  customerPortalUrl?(customerRef: string): Promise<string>;
}
```

- Adapters live in a `billing` Worker (or a module in admin-api). Webhooks land on
  `/api/billing/webhooks/:providerId`, are verified, normalised to internal events
  (`subscription.activated|renewed|past_due|canceled`, `payment.succeeded|failed|refunded`), stored
  idempotently in `payment_events`, and update `subscriptions`, which invalidates the entitlements cache.
- A **manual provider** always exists: admin-assigned plans, bank transfer, invoices, sponsored/waqf accounts.
- **App stores:** App Store and Google Play adapters for in-app purchases where store rules require
  them (viewer Premium, native Epic 24), with server-side receipt validation.
- Candidate providers (decision P1): merchant-of-record options (e.g. Paddle, Lemon Squeezy) to
  offload global tax/VAT, PayPal, and regional gateways (e.g. Tap, Checkout.com, HyperPay, PayTabs,
  Moyasar) chosen per market. Criteria: MENA card coverage (mada, KNET, local wallets), recurring
  billing, payouts for creator support (Epic 24), fees, PCI scope staying with the provider (card data
  never touches our systems), and Shariah considerations (no interest-bearing instalment products).
- Checkout shows only providers available for the buyer region/currency, with prices from `plan_prices`.

---

## 6. Phasing

| Phase | Scope | Est. |
|---|---|---|
| 1 | 27.1–27.2, 27.6 (framework, all Free) + 25.1–25.3 (share, previews, oEmbed) | 3 wk |
| 2 | 25.4–25.6, 25.8 (embed player, JS API, creator controls, analytics) | 4 wk |
| 3 | 26.1–26.5 (Sites, widget, scopes, moderation) | 5 wk |
| 4 | 26.6–26.10, 25.7, 25.9 (abuse, SEO, export, Studio surfaces, end screen) | 3 wk |
| 5 | 27.6 plan editor & provider management; 27.7 manual + first provider adapters | 4 wk |

---

## 7. Open decisions

| # | Decision | Recommendation |
|---|---|---|
| T1 | Plan names, prices, limits | **Resolved:** custom plans, fully admin-managed in admin-web; the table is seed data only |
| T2 | Billing provider | **Resolved:** pluggable provider interface; **never Stripe**; manual + app-store adapters first |
| P1 | First paid providers | Pick 1 global merchant-of-record + 1–2 MENA gateways using the 27.7 criteria |
| E1 | Embed host domain | `embed.alummahnow.net` (separate origin isolates embeds from the main app) |
| E2 | Default thread scope for video discussions | `shared` (one community per video) |
| E3 | Guest commenting | Off by default; Pro+ with pre-moderation |
| E4 | Delivery cost for embeds | Tie to D2 (R2 + CDN); meter per Site for fair use |
