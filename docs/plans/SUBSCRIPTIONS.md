# Subscriptions and tiers: one plan for the whole site

**Status:** proposal for the owner to review (2026-11-11). Nothing here is implemented.
**Why:** each feature has been inventing its own tiers: creator tiers, the Epic 27 seed plans, caption minutes, social limits and AI moderation. The owner, on caption-minute tiers: *"what free tier? this needs planning with all subs on the site"*.
**Constraints (owner, standing):** never Stripe (T2, O4). Every feature is tiered and admin-managed through plans and entitlements (T1, O3). Whole-platform infra stays under **$500/month** at "millions of viewers / thousands of videos" (O1). No monetisation at launch (D4). Uploads and channel creation are invite-only (O25).
**Wiki:** [SUBS-PLAN](https://github.com/Al-Ummah-Now/AlUmmahNowWiki/blob/main/epics/SUBS-PLAN-subscriptions.md) (short summary and decision list).

---

## 0. Summary

1. **There are two tier systems today, and they disagree.** *Creator tiers* (None / Creator / Unlimited, shipped 2026-11-10) decide who may upload. The *Epic 27 plans* (Free / Plus / Pro / Institution, schema merged, resolver and enforcement PRs #390, #391, #427, #428 and #429 open since 2026-11-08) seed a public, default "Free" plan that includes uploads. This proposal merges them into **one plans system**. The creator tier becomes a plan, and the default plan grants no uploads.
2. **The lowest tier.** Watching is free for everyone and needs no plan. For creators, the options are in §3.2. The recommendation is **no public free creator tier at launch**: creator plans are granted (sponsored) by admins, then sold once a payment provider is chosen.
3. **Cost.** With every feature on at its spec defaults, the target scale (S3: 2M monthly viewers, 5,000 library hours) costs about **$1,200–1,400/month**, 2.4–2.9× the cap. The levers in §5.3 bring it to about $660. Getting to **$500** also needs budget stops and one owner decision: does usage paid for by subscribers count against the cap (§5.4)?
4. **What costs money is not delivery.** On R2 + Cloudflare CDN egress is $0. What costs money is **video storage, transcoding, AI moderation, social posting to X, live transcoding and Workers requests**. The plan limits those.
5. **Decisions for the owner** are in §8, one per line, each with a recommendation.

---

## 1. Inventory: everything that is tiered, metered or gated

"Cost" is what one unit costs us. **M** = measured by us. **D** = documented in a spec or invoice. **L** = provider list price, not yet measured. **E** = our estimate, not measured.

### 1.1 The two existing systems

| System | Where | What it holds | State |
|---|---|---|---|
| **Creator tiers** | `packages/shared-types/src/creator-tiers.ts`, `apps/api-videos/src/lib/creatorTiers.ts`, `middleware/upload-limits.ts`, migration `api-videos/migrations/search/0011_creator_tiers.sql`, admin-web `creators/tiers` | Per **user**. A user with no tier can't upload or create channels (403 `uploads_by_invitation`). Tier `creator`: 300 uploads/hour, 2,000/day, 20 concurrent, 3 channels. Tier `unlimited`: no limits. Super admins are always Unlimited. `source` is `admin`, or `subscription` (reserved for later) | **Shipped** (#623, #630, #659, #660, #675). Enforced in prod |
| **Epic 27 plans and entitlements** | Catalogue and resolver in `packages/shared-types/src/entitlements.ts`. Tables in `apps/admin-api/migrations/0004_plans_entitlements.sql` (`plans`, `plan_entitlements`, `subscriptions`, `entitlement_overrides`, `usage_counters`, `plan_audit_log`). Seeds in `0005`, `0015` and `0016` | Per **user, channel or organisation**. Resolution order: override > live subscription > default plan > catalogue fallback. Fails open | Schema and seeds **merged** (#385). Resolver/API #390, enforcement #391, admin-api #427, admin-web #428 and web #429 **open since 2026-11-08**. Today nothing reads plan values, so `lib/studioLimits.ts` allows everything |

The wiki already records the conflict between them ([CHAT-CREATOR-TIERS](https://github.com/Al-Ummah-Now/AlUmmahNowWiki/blob/main/epics/CHAT-CREATOR-TIERS-creator-tiers.md), "Conflicts between sources").

### 1.2 Videos and Studio (AlUmmahNow)

Values are the seeds as Free / Plus / Pro / Institution. "unl." means unlimited.

| Item | Keys, and where they are defined | Current values | Cost per unit |
|---|---|---|---|
| Channels | `channel.max` (catalogue). Creator tier `maxChannels` | Free 1. Creator tier 3 | ≈ $0 |
| Channel links, handle | `channel.about.links.max`, `channel.handle` | Free 5 links, handle on | $0 |
| Upload count and length | `upload.monthlyUploads`, `upload.maxDurationMinutes` | Free 10 a month, 30 min (#391, not enforced) | Transcode below |
| Upload hours | `upload.monthlyHours` | unl. (catalogued, **not enforced**) | Transcode: **E ≈ $0.10–0.20 per source hour** on Cloudflare Containers. The social spec documents ~1,200 vCPU-s per whole-video transcode at ~$0.00002/vCPU-s (D). Not measured (#687). **Bunny encodes for free today** |
| Upload rate | Creator tier `perHour`, `perDay`, `maxConcurrent` | 300 / 2,000 / 20 | $0 (abuse limit) |
| Storage | `storage.gb` | Free 5 GB (not enforced) | **R2 $0.015/GB-month (L)**. Per stored hour of video: **E ≈ 2.0 GB** for a 360p–720p ladder (~4.4 Mbps), **4.2 GB** with 1080p, so **$0.030–0.063 per hour-month**. Originals are extra unless deleted |
| Delivery (VOD, embeds, Shorts) | none (D2: R2 + CDN) | — | Egress **$0** (D2). Cache misses are R2 Class B reads at $0.36/M (L). At 6 s segments and an assumed 5% miss rate: **E ≈ $0.011 per 1,000 viewer-hours**. Segment writes are Class A at $4.50/M (L): ≈ $0.01 per transcoded hour |
| Shorts | none: a Short is a video (O27) | — | Same as video |
| Live | `live.monthlyMinutes` | unl. (**not enforced**). Live endpoints exist; provider undecided (D3) | **E: ≈ $0.03/h passthrough packaging, ≈ $0.30/h for an ABR ladder** (always-on container). Unmeasured until D3 |
| Captions | `captions.monthlyMinutes`, `captions.maxTargetLanguages`, `captions.highAccuracy`, `captions.editor` (spec `docs/specs/TRANSCRIPTION-TRANSLATION.md` §6; follow-up PR #826 open). AI-MODERATION §10 also has `captions.ai.drafts`, which duplicates it | Suggested 60 / 600 / 3,000 / 15,000 minutes | **M: transcription $0.034/h ($0.00057/min), translation $0.024/h per language. Default stack $0.059/h ≈ $0.001 per caption minute.** DeepL Voice $1.85/h (M), DeepL translation $1.00/h (M). Global budget $100/month (spec default) |
| Inline title/description translation | `translate.inline.dailyItems`, `translate.bulk.maxItems`, `translate.viewerAuto` | 200 / 1,000 / 5,000 / 20,000 a day | **M: $0.00002 (Gemma) – $0.00007 (DeepSeek) per title**, so 100k titles ≈ $2–7. DeepL ≈ $0.002/title. Budget $20 |
| Analytics | `analytics.retentionDays` (unl., not enforced), `analytics.retentionCurve`, `analytics.trafficSources` | All on | D1 rows; ≈ $0 per channel |
| Studio tools | `studio.drafts.max`, `studio.bulkSchedule`, `studio.bulkImport`, `studio.teamSeats` (not enforced). Bulk edit (#765) and `studio.commentsInbox` (CREATOR-STUDIO.md) have no key yet | Open on every plan. Seats 1 / 2 / 10 / unl. | ≈ $0 |
| Comments | `comments.replies`, `comments.settings`, `comments.heldForReview` | On for all | Moderation below |
| AI moderation | `moderation.ai.creatorFlags`, `.autoHold`, `.customRules`, `.widgetGuestPosts`, `.reports` (`docs/specs/AI-MODERATION.md` §10) | Spec matrix | **D: $170–290 per 1M comments a month** (Workers AI list prices), plus ≈ $0.0005 per uploaded minute for the video scan |
| Sharing and embeds | `share.shortLinks`, `embed.*` (Epic 25) | Seeded. EMB-D12: v1 consults no entitlement | Delivery, as for VOD |
| Ummah Comments widget | `sites.max`, `discussions.*` (Epic 26) | Seeded. Feature not built | Moderation per comment |
| Social media management | `social.enabled`, `.accounts.max` 10, `.monthlyPosts` 300, `.scheduledPosts.max` 200, `.automation`, `.inbox`, `.analytics.retentionDays` (`docs/specs/social-media-management.md` §11.2) | Spec defaults. Not built | **D (X pricing page): $0.015 per native X post, $0.20 per post with a URL, $0.005 per metrics read.** Other networks' APIs are free. Containers and Media Transformations ≈ $0.15–0.25 per active channel a month (D, §18). **The spec's platform X cap defaults to $500, the whole platform cap** |
| Cost display | `studio.costs.dollars` (cost-monitoring Q6) | Flag | $0 |
| Offline downloads, viewer premium | `premium.offline`, `kids.curation` (EMBEDS-COMMENTS-TIERS §27.4); Epics 14 and 24 | Not built; E24 deferred (D4) | Delivery, as for VOD |

### 1.3 CMS (AlUmmahNowCMS)

| Item | Where | Current | Cost per unit |
|---|---|---|---|
| Roles: admin, editor, **writer** (scholars) | `docs/SPEC.md` §3, `docs/SCHOLARS.md` §2. Auth role `role_scholar` (AlUmmahNowAuth migration 0029) maps to CMS `writer`: own posts only | Granted by an admin or the videos invite form. **Not a plan** | $0 |
| AI writing assistant | `docs/AI_ASSIST_SPEC.md` §4–5, `docs/AI_PROVIDERS.md`, migration `0011_ai_providers.sql` | Per-user rate limit hard-coded at **10 jobs per 10 min and 60 a day** (translations weigh 3). Environment `monthlyBudgetUsd`: default $50, max $500 | **M: SEO $0.0003, short translation $0.0006, pre-publish check $0.006–0.007, longest translation $0.046.** Expected ≈ $11/month. Theoretical ceiling ≈ $277/month at 10 editors |
| Media library | CMS media (R2) | No quota | R2 $0.015/GB-month (L) |

### 1.4 www (AlUmmahNowUI) and Auth (AlUmmahNowAuth)

- **www** is a public viewer site (Astro): home timeline, articles, scholar pages and search. It has **no gated features** today, and none are proposed. It reads the CMS and videos APIs only.
- **Auth** has roles (`role_scholar`, moderator, admins), admin invites that pre-provision accounts (`docs/USER_INVITES.md`), and the planned `billing_admin` / `billing_viewer` roles (AlUmmahNowAuth#227, Q27-3). It holds **no plan data**, and should not (Epic 27 §3: plans are videos-side data, never Auth RBAC).

### 1.5 Native apps (Apple, Android, Desktop; Core)

- The **Studio MVPs** upload, edit and list. Android reads `GET /api/me/creator` (`CreatorAccess`) and handles HTTP 402 `upgrade_required` (`core-bridge/.../StudioRepository.kt`). On the main branches, **Apple and Desktop have no handling for `uploads_by_invitation`, `upload_limit` or 402**. Each needs a small change once plans land (§7, step 5).
- **On-device transcription** in desktop Studio is proposed as free, using no caption minutes (captions spec O11, D10). It costs us $0.
- **Desktop pre-encode** (D11) would move transcode cost to the creator's machine.
- **In-app purchase** is needed only if we sell inside the apps. Epic 24 (viewer Premium) is deferred. Until then the apps show the plan and its limits as plain text (Q27-2), and sell nothing.

### 1.6 Platform costs every plan shares

| Item | Unit cost |
|---|---|
| Workers Paid | $5/month base; 10M requests included, then $0.30/M; 30M CPU-ms included, then $0.02/M (L) |
| Cloudflare Pro zone (D2 assumes Pro for the 512 MB cacheable limit) | $25/month (L) |
| Workers Logs | 20M events included, then $0.60/M. **D: $25.80 billed for one QA spike** (cost-monitoring README) |
| D1, KV, Queues, Durable Objects | D1 $0.001 per M rows read and $1 per M written; KV $0.50/M reads and $5/M writes; Queues $0.40/M (L) |
| Email (Resend) | List price; to be confirmed by AUN-COST P4 |

`docs/INFRASTRUCTURE_COST_ANALYSIS.md` predates D2 and is stale. It prices Bunny egress, and it computes Workers CPU as $1,000 for 50M ms, which is $1 at its own unit price. This plan does not use it (issue filed, §9).

---

## 2. Audiences

| Audience | Exists today | Planned |
|---|---|---|
| **Viewers** (signed in or not) | Watch, comment, subscribe, playlists, history. No plan and no ads. The Epic 27 default plan applies to every user but gates nothing a viewer does | Viewer Premium (offline, early access): Epic 24, deferred (D4). Donations to creators: 24.1 |
| **Creators / channels** | Invite-only creator tiers, assigned per user; channel managers and editors upload under the owner's tier. The Epic 27 seeds for Plus and Pro exist as drafts | Paid self-serve plans once a payment provider exists (P1) |
| **Scholars** | Auth role `role_scholar` → CMS writer, a scholar page on www, AI assist under the same per-user limit. May own channels (then they need a creator tier) | Featuring by editors (exists). No plan of their own |
| **Organisations** (masjids, institutes) | Only a value in the `subject_type` CHECK, and the draft "Institution" plan. **No organisation entity** | Organisation accounts with seats and several channels |
| **Staff** (admins, moderators, editors) | Site roles; super admins are Unlimited | Not subscribers. A non-public "Staff" plan (§3.3) |

---

## 3. Draft plan structure

### 3.1 Principles

1. **One system.** Every limit is an Epic 27 entitlement key. Creator tiers become plans (§7). Nothing is hard-coded: the CMS's 60-a-day assist limit and the creator-tier rate limits become keys too.
2. **The plan belongs to the account owner (user)**, and covers every channel they own. Per-channel counters (captions, social) count against the owner's allowance. Organisations hold plans once they exist.
3. **Watching is never gated.** Plans gate making, storing, processing and AI, which are the things that cost money.
4. **Two kinds of key.** *Allowances* cost money (storage, upload hours, caption minutes, live minutes, social posts, AI), and their sum is our exposure. *Features* cost nothing (colours, handle, bulk tools, analytics charts). Features can be generous. Allowances are sized against §5.
5. **Every allowance also has a global budget stop**, so the cap holds even when grants pile up. Captions ($100), inline translation ($20) and CMS assist ($50) already have one. Live, moderation, transcoding and X don't yet (§5.3).
6. **Grandfathering** (Epic 27 invariant 1): lowering a plan never deletes or hides content; it only blocks new growth.

### 3.2 The lowest tier: the options

The owner asked "what free tier?". Viewers always watch for free, so this is about **creating**.

| Option | What it means | Cost exposure | Fits today's decisions? | Risks |
|---|---|---|---|---|
| **A. Free with small allowances** | Anyone who signs up can create one channel, store ~5 GB, upload ~2 h a month, and get ~30 caption minutes | Unbounded in number: 10,000 sign-ups × full use ≈ $15–25k storage-months a year, plus moderation of their content | **No**: contradicts O25 (invite-only uploads) | Abuse, spam, moderation load, CSAM exposure on R2 (M4) |
| **B. Invite / admin grant only** *(recommended for launch)* | No public free creator tier. Admins grant a creator plan, often **sponsored** (waqf) at no charge, with a reason and an optional expiry. This is what O25 does today | Bounded by the admin's choices: number of grants × the plan's full-use cost (§4.3) | **Yes**: O25, D4 | Growth depends on admin time. The invite flow (`USER_INVITES.md`) makes that cheap |
| **C. Paid only** | Every creator pays; scholars and masjids are sponsored by admin grant | Self-funding | Needs a payment provider (P1, open) and conflicts with D4 (no monetisation at launch) | Excludes small creators. Can't launch until P1 |

**Recommendation:** B at launch. When a payment provider exists, add C beside it: paid self-serve plans, with grants still available. Revisit A only if growth needs it, and then only behind sign-up checks (verified email, account age, a first upload held for review).

**Consequence for the seeds:** the default plan `plan_free` is renamed **Member** (display name only; slug and id stay so nothing migrates). It grants **no** uploads, channels, storage or caption minutes. Its upload values today (10 a month, 5 GB) were for an open-upload world that O25 replaced.

### 3.3 Tiers

Names are proposals. Plans are admin-editable (T1), so these are seeds.

| Plan | Audience | How you get it | Public? |
|---|---|---|---|
| **Member** (was "Free"; default) | Everyone | Automatic | Yes |
| **Creator** (was creator tier `creator`) | Creators | Admin grant (sponsored), later paid | Yes, once paid |
| **Creator Plus** (seed `plus`) | Growing channels | Grant or paid | Later |
| **Creator Pro** (seed `pro`) | Large channels, publishers | Grant or paid | Later |
| **Institution** (seed `institution`) | Organisations | Grant or contract (manual provider) | On request |
| **Staff** (was tier `unlimited`) | Super admins, official channels | Automatic for super admins; admin grant | No |
| **Supporter** (viewer, Epic 24) | Viewers | Paid, later | Deferred (D4) |

**Scholars:** a role, not a plan. Recommended: when an admin grants `role_scholar` and the scholar owns a channel, the invite form also grants a **sponsored Creator Plus** (§8, S7).

### 3.4 What each tier gets

"—" means off or 0. Existing keys keep their names; **new** keys are marked. Full-use costs are in §4.3.

| Key | Member | Creator | Plus | Pro | Institution | Staff |
|---|---|---|---|---|---|---|
| **upload.enabled** (new; replaces "has a tier") | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| `channel.max` | — | 3 (as today) | 5 | 10 | unl. | unl. |
| **upload.perHour / perDay / maxConcurrent** (new; abuse limits, from the tier) | — | 300 / 2,000 / 20 | same | same | same | unl. |
| `upload.monthlyHours` (bounds transcode) | — | 10 | 30 | 100 | 300 | unl. |
| `upload.monthlyUploads` | — | 60 | 200 | 1,000 | unl. | unl. |
| `upload.maxDurationMinutes` (lectures are long) | — | 180 | 360 | 720 | 720 | unl. |
| `storage.gb` (≈ hours at 720p) | — | 50 (≈ 25 h) | 250 (≈ 120 h) | 1,000 (≈ 480 h) | 5,000 (≈ 2,400 h) | unl. |
| **video.maxRendition** (new) | — | 720 | 1080 | 1080 | 1080 | 1080 |
| `captions.monthlyMinutes` | — | 120 | 600 | 3,000 | 15,000 | unl. |
| `captions.maxTargetLanguages` | — | 1 | 3 | 10 | unl. | unl. |
| `captions.highAccuracy` (DeepL Voice) | — | — | — | ✅ | ✅ | ✅ |
| `translate.inline.dailyItems` | — | 200 | 1,000 | 5,000 | 20,000 | unl. |
| `translate.bulk.maxItems` | — | 50 | 200 | 1,000 | 5,000 | unl. |
| `live.monthlyMinutes` | — | — | 600 | 3,000 | 12,000 | unl. |
| **live.abr** (new; ladder vs passthrough) | — | — | — | ✅ | ✅ | ✅ |
| `social.enabled` / `social.accounts.max` | — | — | ✅ / 5 | ✅ / 10 | ✅ / 30 | ✅ |
| `social.monthlyPosts` | — | — | 100 | 300 | 1,000 | unl. |
| **social.x** (new; X costs money per post) | — | — | — | ✅ | ✅ | ✅ |
| `social.automation`, `social.inbox` | — | — | ✅ | ✅ | ✅ | ✅ |
| `analytics.retentionDays` | — | 365 | 730 | unl. | unl. | unl. |
| `analytics.retentionCurve`, `.trafficSources` | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| `studio.teamSeats` | — | 2 | 3 | 10 | unl. | unl. |
| `studio.drafts.max`, `studio.bulkSchedule`, `studio.bulkImport`, **studio.bulkEdit** (new) | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| `embed.*`, `sites.max`, `discussions.*` | Epic 25/26 seeds, with Free → Creator | | | | | |
| `moderation.ai.autoHold` / `.customRules` / `.reports` | — | ✅ / — / — | ✅ / — / basic | ✅ / ✅ / ✅ | ✅ / ✅ / ✅ | ✅ |
| **cms.assist.dailyWeight** (new; replaces the hard-coded 60) | — | 60 (if CMS writer) | 60 | 120 | 200 | 200 |
| `premium.offline` (viewer, Epic 14/24) | — | — | — | — | — | — |

Keys stay `true` on every plan when gating them saves nothing (comments, handle, share links). They exist so a plan *can* turn them off.

### 3.5 Add-ons

Add-ons are **additive grants** (`entitlement_grants`, proposed in the captions spec §6.3). Overrides *replace* a value, so they can't stack packs. An add-on is sold (later) or granted (now), and it is either monthly or used until spent.

| Add-on | Unit | Our cost (full use) | Notes |
|---|---|---|---|
| Caption minutes | 1,000 / 5,000 / 20,000 min | $0.98 / $4.90 / $19.60 (M) | Spec price suggestion $3 / $12 / $40 |
| Storage | +100 GB a month | $1.50 (L) | |
| Upload hours | +10 h a month | ≈ $1.50 (E) | Transcode |
| Live hours | +10 h (ABR) | ≈ $3 (E) | |
| X posts | +100 native posts | $1.50 + $1 reads (D) | Only with `social.x` |
| High-accuracy captions | DeepL Voice hours | $1.85/h (M) | Uses minutes at 30× (spec §7.4) |
| Extra channel or seat | +1 | ≈ $0 | Feature add-on |

### 3.6 Admin grants and management

Everything below exists or is specified in Epic 27 and the captions spec. This plan makes it the one path for every feature:

- **Assign a plan** (manual provider), with a reason, an optional end date and trials.
- **Override** any key for a user, channel or organisation, with an expiry.
- **Grant** an add-on amount, monthly or until used, with a reason and source `admin | purchase | promo | sponsored`.
- Everything is audited (`plan_audit_log`) and picked with search boxes, never raw ids (admin-pickers rule).
- The **admin Creators page** keeps its workflow ("Invite creator", "raise a limit"), but writes plan assignments and grants instead of creator-tier rows.
- **Budgets:** one screen holds every global monthly budget per environment: captions, inline translation, CMS assist, moderation, live, transcode and X (§5.3).

### 3.7 Payment providers (listed; not decided: P1 stays open)

Never Stripe. Card data never touches our systems. A **manual provider is always present**: admin grants, bank transfer, invoices, sponsored and waqf accounts. Candidates, by the Epic 27.7 criteria (MENA coverage, recurring billing, payouts, fees, PCI scope, Shariah):

| Kind | Candidates | Notes |
|---|---|---|
| Merchant of record (handles global VAT) | **Paddle**, **FastSpring** | Takes on tax liability. **Remove Lemon Squeezy from the 27.7 list: it is owned by Stripe** (acquired 2024). Gumroad and Polar also run on Stripe, so they are excluded too |
| Wallet | **PayPal** | Wide reach; recurring billing |
| GCC / MENA gateways | **Tap**, **Moyasar** (mada), **HyperPay**, **PayTabs**, **Checkout.com**, **Paymob** (Egypt), **iyzico** (Türkiye) | Local cards (mada, KNET), wallets |
| Other regions | **Xendit / Midtrans** (Indonesia), **Razorpay** (India) | Large Muslim populations |
| App stores | **App Store IAP**, **Google Play Billing** | Needed only for in-app sales of viewer digital goods (Epic 24); 15–30% fee |

This plan doesn't need a provider until creators pay (option C). Before then, everything runs on the manual provider.

---

## 4. Cost per tier

### 4.1 Unit costs used below

| Unit | $ | Source |
|---|---|---|
| Stored video hour, per month | 0.030 (720p ladder) / 0.063 (1080p) | L price × E size |
| Transcoded source hour | 0.15 (range 0.10–0.20) | E, #687 to measure |
| 1,000 viewer-hours delivered | ≈ 0.03 (Class B misses + Worker API requests) | L × E |
| Caption minute | 0.001 | M |
| Live hour | 0.03 passthrough / 0.30 ABR | E, D3 |
| 1,000 comments AI-moderated | 0.17–0.29 | D |
| X post (native) + 2 reads | 0.025 | D |
| CMS assist action | 0.0003–0.046 | M |

### 4.2 Scenarios

| | **S1: Launch** | **S2: Growth** | **S3: Target** (owner's "millions of viewers / thousands of videos") |
|---|---|---|---|
| Monthly viewers | 20k | 300k | 2M |
| Viewer-hours a month | 50k | 600k | 4M |
| Active creator channels | 100 | 1,000 | 3,000 |
| New video hours a month | 100 | 250 | 400 |
| Library (hours stored) | 500 | 2,500 | 5,000 (≈ 7,500 videos) |
| Comments a month | 10k | 200k | 1M |
| Channels using Social | 20 | 200 | 600 |
| Live hours a month | 50 | 300 | 800 |

### 4.3 Full-use cost of one subscriber (worst case: every allowance used)

| Plan | Storage (at cap) | Transcode | Captions | Live | Social | Total ≈ |
|---|---|---|---|---|---|---|
| Member | 0 | 0 | 0 | 0 | 0 | **$0** (viewing only) |
| Creator | $0.75 | $1.50 | $0.12 | 0 | 0 | **$2.40** |
| Plus | $3.75 | $4.50 | $0.60 | $0.30 | $0.20 | **$9.40** |
| Pro | $15 | $15 | $3 | $15 | $7.50 | **$56** |
| Institution | $75 | $45 | $15 | $60 | $25 | **$220** |

Grants are bounded by this table: 100 sponsored Creators cost at most $240 a month, and realistically 20–30% of that. Any paid price should be at least 3× the full-use cost plus provider fees. The owner sets prices; none are proposed here (Q27-2: no prices shown yet).

---

## 5. Cost at scale against the $500 cap

### 5.1 Everything on, at spec defaults (monthly $)

| Line | S1 | S2 | S3 | Basis |
|---|---|---|---|---|
| Fixed (Workers Paid, Pro zone) | 30 | 30 | 30 | L |
| Workers requests + CPU (~60 requests and 5 ms per viewer-hour) | 0 | 11 | 92 | L × E |
| Workers Logs (unsampled) | 0 | 10 | 132 | D |
| D1, KV, Queues, DO | 5 | 20 | 60 | E |
| Video storage (2.4 GB/h blended) | 18 | 90 | 180 | L × E |
| Delivery (Class B misses at 5%, Class A writes) | 2 | 9 | 47 | L × E |
| Transcode | 15 | 38 | 60 | E |
| Captions (bounded by the $100 budget) | 6 | 30 | 100 | M |
| Inline translation | 1 | 3 | 10 | M |
| CMS AI assist | 11 | 11 | 20 | M |
| AI moderation | 6 | 50 | 230 | D |
| Social without X | 5 | 40 | 120 | D |
| Social, X (if every Social channel posts to X) | 8 | 78 | 234 | D |
| Live (passthrough; ABR on Pro and up) | 2 | 20 | 60 | E |
| Email | 0 | 20 | 50 | L, unconfirmed |
| **Total** | **≈ $109** | **≈ $460** | **≈ $1,425** | |
| **Total without X** | ≈ $101 | ≈ $382 | ≈ $1,191 | |

S1 is far inside the cap. S2 is near it. **S3 is two to three times over.**

### 5.2 Where the money goes at S3

AI moderation, X and Workers Logs together are ~$600, and each has a cheap fix. Storage ($180) is the largest line that can't be switched off: video that is stored must stay stored. Delivery is only $47 because egress is free (D2).

### 5.3 Levers that bring S3 under $500

| Lever | Saves at S3 | Cost to the product |
|---|---|---|
| **Sample Workers Logs** (head sampling ~10% in prod; errors always logged) | ~$127 | Less raw logging. Errors still reach admin (O26) |
| **AI moderation fast path:** skip short comments by trusted users, cache identical texts, run the extension classifier only when uncertain (AI-MODERATION §9 already lists these) | ~$150 | Slightly slower first moderation of trusted users |
| **X only on Pro and up, and the platform X cap at $50, not $500** | ~$200 | X posting is a paid feature |
| **Social as a paid feature** (Plus and up) and **its other costs inside a $20 budget** | ~$100 | — |
| **Storage:** 1080p only on paid tiers; delete originals after 30 days; for videos unwatched for 180 days, keep only 480p and the audio track | ~$60 | Old videos stream at 480p until rewatched (re-encode on demand) |
| **Transcode:** prefer desktop pre-encode (D11), keep Bunny encoding during the side-by-side trial (O32), queue at the budget | ~$25 | Slower processing at budget |
| **Workers:** cache public pages and API reads at the edge, send analytics beacons to Analytics Engine in batches | ~$30 | — |
| **Captions:** budget $30 at S3 for platform-funded minutes; paid packs beyond that | ~$70 | Free allowance minutes wait at the budget ("starts within 24 h") |

### 5.4 Two ways to hold the cap

Applying every lever in §5.3 brings S3 to about **$660**. Getting the rest of the way to $500 takes budget stops on live, CMS assist and translation (§5.5), and one owner decision (§8, S3):

- **(i) Gross cap:** every dollar counts, whoever pays for it. S3 fits only with every lever and tight budget stops, X stays off, and paid features can't grow past the envelope however many people pay.
- **(ii) Platform-funded cap** *(recommended)*: the $500 covers what **we** fund: Member usage, sponsored grants and platform features. Usage paid for by a subscriber or add-on at ≥ 3× cost is tracked by AUN-COST but counted outside the cap. Paid growth then never forces a free cut.

### 5.5 Recommended S3 envelope (platform-funded, monthly)

| Cost centre | How it is stopped | Envelope |
|---|---|---|
| Fixed | — | $30 |
| Workers + Logs | Engineering levers (§5.3) | $65 |
| D1, KV, Queues, DO | — | $40 |
| Video storage | Plan `storage.gb` caps and the rendition policy | $120 |
| Delivery | Can't stop serving; free egress | $45 |
| Transcode | Queue at the budget (new) | $35 |
| AI moderation | Budget stop + fast path (new) | $60 |
| CMS AI assist | Existing budget (set $15 at S3) | $15 |
| Captions (allowances + grants) | Existing budget (spec $100; set $30 at S3) | $30 |
| Inline translation | Existing budget ($20; set $5) | $5 |
| Live | Plan minutes + budget (new) | $20 |
| Social incl. X | Platform cap (spec $500 → $10 platform-funded) | $10 |
| Email | Rate limits | $25 |
| **Total** | | **$500** |

At S1 and S2 the current budget defaults are fine. The envelope should shrink only as viewers grow, and AUN-COST (#268–#272) should alert at 80% of each line.

---

## 6. Where entitlements are checked, per repo

| Repo | Reads entitlements for | How |
|---|---|---|
| AlUmmahNow (api-videos, processor) | Uploads, storage, channels, captions, translation, live, social, analytics, Studio tools, moderation | Epic 27 resolver (#390) and `usage_counters` |
| AlUmmahNow (admin-api, admin-web) | Writes plans, assignments, overrides, grants and budgets | #427, #428 + grants |
| AlUmmahNowCMS | `cms.assist.dailyWeight` (replaces the hard-coded 60 a day), CMS media quota if one is wanted | `GET /api/entitlements?subject=user:{id}` from api-videos over a service binding, cached 60 s |
| AlUmmahNowUI (www) | Nothing: www is viewer-only | — |
| AlUmmahNowAuth | Nothing. It keeps roles; `billing_admin` / `billing_viewer` gate the Plans screens (#227) | — |
| Native Studio (Apple, Android, Desktop via Core) | Shows the plan and usage; handles 402 | `GET /api/entitlements` through `aun-api`. Android does part of this today; Apple and Desktop need it |

---

## 7. Migration path (after approval; not part of this PR)

1. **Rebase and land the Epic 27 stack** (#390, #391, #427, #428, #429). Rename the default plan to Member and set its creator keys to off.
2. **Fold creator tiers into plans.** Add the new keys (`upload.enabled`, `upload.perHour/perDay/maxConcurrent`, `video.maxRendition`, `live.abr`, `social.x`, `studio.bulkEdit`, `cms.assist.dailyWeight`). Copy each `creator_tier_assignments` row into `subscriptions` (provider `manual`, `assigned_by` kept). Map tier `creator` to plan Creator, and `unlimited` to Staff. Super admins resolve to Staff by rule. `GET /api/me/creator` keeps its shape, read from the plan. Keep the old tables read-only for one release, then drop them.
3. **Add `entitlement_grants`** (from the captions spec) and a Budgets screen holding every global budget.
4. **Enforce the unenforced keys:** `upload.monthlyHours`, `live.monthlyMinutes`, `studio.teamSeats`, `analytics.retentionDays`.
5. **Clients:** the CMS reads `cms.assist.dailyWeight`. Apple and Desktop Studio handle `uploads_by_invitation`, `upload_limit` and 402 the way Android does.
6. **Payments** (after P1): `plan_prices`, a `PaymentProvider` adapter for the chosen provider, and webhooks. The manual provider stays.

Every step is a small PR that keeps today's behaviour for existing creators (grandfathering, no backfill), with release E2E for the admin and creator flows.

---

## 8. Decisions for the owner

One per line, with a recommendation.

| # | Decision | Recommendation |
|---|---|---|
| S1 | One plans system for every feature: creator tiers fold into Epic 27 plans | **Yes**; migrate tier assignments to plan subscriptions (§7) |
| S2 | The lowest creator tier: A (free allowances), B (invite / admin grant only) or C (paid only) | **B at launch**, add C when a provider exists; no public free creator tier |
| S3 | Does the $500 cap count subscriber-paid usage (gross) or only platform-funded usage? | **Platform-funded** (§5.4 ii); paid usage priced at ≥ 3× cost sits outside it but is tracked |
| S4 | Rename the default plan "Free" to "Member", with no creator allowances | **Yes** (display name only; no data migration) |
| S5 | Tier names and ladder: Member, Creator, Creator Plus, Creator Pro, Institution, Staff | **Accept as seeds**; admins rename freely |
| S6 | Who holds the plan: the user (owner of the channels) or each channel | **The user**; channel counters roll up to the owner |
| S7 | Scholars: sponsored Creator Plus granted with the scholar role when they own a channel | **Yes**, as an admin grant with source `sponsored` |
| S8 | The §3.4 matrix as the seed values | **Accept as seeds**; admins edit without a deploy |
| S9 | Viewers: free, no viewer plan until Epic 24 | **Yes**; Supporter/Premium stays deferred (D4) |
| S10 | Organisations: build the organisation entity now, or let a user hold the Institution plan until the first institution asks | **Defer the entity**; a user holds Institution |
| S11 | X posting only on Pro and up, and the platform X cap lowered from $500 to $50 | **Yes**; the $500 default alone equals the whole-platform cap |
| S12 | Storage rendition policy: 1080p on paid tiers only, delete originals after 30 days, keep 480p + audio for videos unwatched for 180 days | **Yes** to all three; re-encode on demand |
| S13 | Global budget stops for transcode, moderation and live, plus a Budgets screen | **Yes**; the S3 envelope in §5.5 |
| S14 | Workers Logs sampling in production | **Yes**, ~10% head sampling, errors always kept |
| S15 | Add-ons as additive grants (`entitlement_grants`) | **Yes**, from the captions spec |
| S16 | Payment provider candidates (P1 stays open): drop Lemon Squeezy, Gumroad and Polar (Stripe-based); shortlist Paddle or FastSpring + PayPal + one GCC gateway (Tap or Moyasar) | **Approve the shortlist**; decide P1 when C is wanted |
| S17 | Native apps sell nothing until Epic 24; they show the plan as plain text | **Yes** (Q27-2) |
| S18 | Inline title translation free with fair use on every creator tier (captions O5) | **Yes**; it costs ≈ $2–7 per 100k titles |

---

## 9. Findings filed while writing this

| Finding | Issue |
|---|---|
| The creator tiers and the Epic 27 seeds conflict; fold tiers into plans (S1, S4) | #827 |
| The Epic 27 stack (#390, #391, #427, #428, #429) has been held and unrebased since 2026-11-08 | #828 |
| The social spec's platform X cap defaults to $500, the whole-platform cap (S11) | #829 |
| EMBEDS-COMMENTS-TIERS §27.7 lists Lemon Squeezy, which Stripe owns (S16) | #830 |
| `docs/INFRASTRUCTURE_COST_ANALYSIS.md` is stale (pre-D2) and miscomputes Workers CPU | #831 |
| `captions.ai.drafts` duplicates `captions.monthlyMinutes` | #832 |
| Apple and Desktop Studio don't handle `uploads_by_invitation`, `upload_limit` or 402 | [AlUmmahNowApple#20](https://github.com/Al-Ummah-Now/AlUmmahNowApple/issues/20), [AlUmmahNowDesktop#30](https://github.com/Al-Ummah-Now/AlUmmahNowDesktop/issues/30) |
