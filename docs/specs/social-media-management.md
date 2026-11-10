# Social media management for channels

**Status:** Owner decisions recorded (§19). Not implemented.
**Date:** 2026-11-09 (owner decisions the same day, US Eastern)
**Related:** web Creator Studio spec ([PR #476](https://github.com/Al-Ummah-Now/AlUmmahNow/pull/476)), channel roles spec ([PR #462](https://github.com/Al-Ummah-Now/AlUmmahNow/pull/462)), `docs/features/01-scheduled-publishing.md`, `docs/features/10-premiere.md`, `docs/features/community-posts.md`, `docs/analytics/README.md`, `docs/specs/AI-MODERATION.md`, `packages/shared-types/src/entitlements.ts`, `docs/design/THEMES.md`

In the API tables, **Exists** means the route or binding is on `main` today, **#462** / **#476** means that spec defines it and it isn't built, and **New** means this spec is the first to ask for it.

Network facts (limits, prices, scopes, review rules) were checked against official developer documentation on 2026-11-09 and are cited in §20. They change often: X moved to pay-per-use in 2026, and YouTube changed upload quota in June and its unverified-app rule in November 2026. The per-network rules live as data (§6.3) so a change is a data edit, and the processor reads live limits from the networks wherever an endpoint exposes them.

## 1. Summary

A channel's owner and team connect the channel's accounts on other networks (Facebook and X first, then Telegram, Instagram, YouTube and the rest) to Studio. From then on, Al Ummah Now can:

1. **Announce automatically** when a video is published, a premiere is scheduled or starts, or a live stream starts. Each rule picks, per network, the **video itself** (the whole video where the network allows it, or an automatic cut that fits), a **short vertical export**, or a **link post** to the watch page (§6.1.1).
2. **Cross-post on demand** from a composer with the same three formats, plus a thumbnail image or a community post, each adjusted per network (length, aspect ratio, hashtags, language).
3. **Schedule** everything on one calendar, with best-time suggestions, recurring slots, and an approval step for editors.
4. **Measure** each post on the network and the traffic it sent to the watch page, inside Studio Analytics.
5. **Answer** comments, mentions and messages from the networks that allow it, in one inbox.

It lives in Creator Studio as a new rail item, **Social**, and follows the per-channel roles in #462. Platform staff control it from the videos admin (admin-web/admin-api): which networks are on, plan limits, abuse controls, and cost.

### Goals

- One flow for every network, with each network's rules applied before a post can be scheduled, never discovered at publish time.
- Nothing a channel publishes off-platform without a person with the right channel role having seen it, or having switched on an automatic rule.
- Tokens are encrypted, scoped to the minimum, refreshed without the creator noticing, and destroyed when the account, the channel, or the person's videos data goes.
- Every network that has a usable public API ships in the first build. Where an API is closed, paid, behind an app review we haven't passed, or behind a registered-business requirement we can't meet yet (§2.4), the spec says exactly what unblocks it, and the product shows a working fallback (a "share kit"), not a dead button.

### Non-goals

- Managing personal profiles of viewers. Social is a channel feature. A viewer sharing a video uses the existing share sheet.
- Buying ads, boosting posts, or paid promotion on any network.
- Importing content from other networks into Al Ummah Now (YouTube import is a separate feature, `20-upload-from-url.md`).
- Site roles. Nothing here touches AlUmmahNowAuth's RBAC or tokens (#462 §2). Social sign-in on Auth is unrelated.
- Social listening across the whole network (keyword monitoring of strangers' posts). Only the channel's own posts, mentions and messages.

## 2. Research

Full notes, with sources and dates, are in [§20 Sources](#20-sources). This section has the conclusions that shape the design.

### 2.1 What the established tools do

| Product | Connect | Compose and schedule | Approvals and roles | Analytics | Inbox | Links |
|---|---|---|---|---|---|---|
| **YouTube Studio** [Y1] | Its own channel only | Schedules uploads and Posts, one at a time; no cross-network | Channel permissions (owner, manager, editor, viewer…) | Deep, own platform only | Comments | No |
| **Buffer** [B1] | 12 networks incl. Threads, Bluesky, Mastodon | Base post with per-network edits, queue of time slots, calendar | Approvals only on the Team plan | Per post and account | Community inbox and AI replies on every plan | UTM on Essentials and up; Start Page link in bio |
| **Hootsuite** [H1, H2] | Most networks | Composer, bulk, calendar, best time | Approvals only on Advanced; assignment and routing | Reports, link tracking (Professional+) | Inbox on all plans, automated replies (Professional+), assignment (Advanced) | Ow.ly links |
| **Later** [L1] | "Social sets" of 8 profiles incl. Snapchat | Visual calendar, best time per network | Internal and external approvals (Growth+) | Per post, link-in-bio analytics | Inbox (Growth+) | Linkin.bio |
| **Meta Business Suite** [M1] | Facebook, Instagram, WhatsApp only | Planner, "active times" suggestions | Business roles | Insights | Unified FB/IG/WhatsApp inbox with labels and automations | No |
| **Metricool** [MC1] | Most networks incl. Threads, Bluesky | Planner, best-time heat maps | Email approvals | Strong, with heat maps | Inbox | SmartLinks |
| **Publer** [P1] | Incl. Telegram, Mastodon, Bluesky | Recycling queues, CSV bulk, first comment, hashtag groups | Workspaces with roles and approvals | Per post | Limited | Link shortener |

Patterns this spec adopts: one composer with a base caption and per-network variants (§6.2); validation from live network metadata before the button is enabled (§6.9); calendar plus slot queue with drag to reschedule (§7.1); best times from the channel's own data with a network fallback (§7.2); a role-based approval step (§3.3); per-account health with reconnect prompts (§5.6, §17.2); automatic UTM and short links with click counts (§8.1); first comment and hashtag groups (§6.2); a unified inbox with assignment, saved replies and AI triage (§9); one-tap share kits where no API exists (§6.8); cost-aware posting for X (§6.3). Where we go further than all of them is the feature none of them can offer: we own the destination, so we can show what each network sent back as views and watch time on Al Ummah Now (§8.3).

### 2.2 Network feasibility

Rows are in the owner's priority order (§19, decision 1): Facebook and X first, then the rest. The **Gate** column is what each network asks of an app that posts for accounts it doesn't own; §2.4 says what that means with no registered legal entity, which is the case today.

| Network | Publish | Analytics | Inbox | Gate | Status with no legal entity (§2.4) |
|---|---|---|---|---|---|
| **Facebook Pages** | Text, link, photos, Page video, Reels (30/day/Page) | Page and post insights | Page comments (webhooks); Messenger | Advanced Access to the Pages permissions, which needs **Business Verification** of a registered business, App Review, and Tech Provider status [F1, F2, F4, F5, F6] | **Own and role-holder Pages only.** Every other channel: share kit with the native video file (§6.8) |
| **X** | Text, images, video up to 20 min (125 min Premium), threads | Post metrics (reads are billed) | Mentions, DMs (billed) | Pay-per-use credits: **$0.015 per post, $0.20 if it contains a URL**, reads $0.005. No review, no business needed [X1, X2, X3, X5] | **Feasible now for every channel, paid** |
| **Telegram** (channels, groups) | Text, photo, video (≤ 2,000 MB through the local Bot API server, §6.6), albums | Only what the bot sees (no channel stats for bots) | Comments in the linked discussion group | None [T1, T2, T3] | **Feasible now for every channel, free** |
| **Instagram** (Business/Creator) | Image, carousel, Reel, Story; ~100 API posts/24 h | Media and account insights | Comments, mentions (webhooks), DMs (24 h window) | Same as Facebook: Advanced Access needs Business Verification [I1, I2, I3, I4] | **Own and role-holder accounts only.** Others: share kit |
| **YouTube** | Upload video / Short, thumbnail, playlist | YouTube Analytics API | Comments (no DMs exist) | Google OAuth verification of sensitive scopes (website, privacy policy, demo video; no company needed); 100 new users until verified; **100 uploads/day per project** until the audit (individuals can apply) [Y2, Y3, Y4, Y5, Y6] | **Feasible now for every channel**: first 100 connecting users before verification, unlimited after; quota-bound. **Posts (community) have no API** |
| **TikTok** | Direct Post (video, photos) | Basic video stats | **No comment/DM API** | App review (a full public website with privacy policy and terms) and the **Content Posting audit**; unaudited apps post **private-only**, 5 users/day. No company requirement found [TT1–TT6] | **Feasible now as private posts; public posting after the audit**, which doesn't need an entity |
| **Threads** | Text, image, video ≤ 5 min, carousel; 250/24 h | Views, likes, replies, reposts, quotes, link clicks, followers | Replies (manage, hide) | Same as Facebook (Meta Advanced Access) [TH1, TH2, F5] | **Own and role-holder profiles only.** Others: share kit |
| **LinkedIn** | Company Pages: text, images, video, documents. Member profiles: the same, as the person | Org and post analytics (company Pages only) | Org comments (company Pages only) | Company Pages: Community Management API, **"only available to registered legal organizations"**. Member posting: *Share on LinkedIn* (`w_member_social`), self-serve [LI1–LI5] | **Member profiles feasible now for every channel.** Company Pages need an entity |
| **Bluesky** | Text, images, video, link cards | Like/repost/reply counts only | Notifications (mentions, replies) | None [BS1, BS2, BS3] | **Feasible now, free** |
| **Mastodon** | Text, media, CW | Counts only | Notifications | Per-instance app registration (automatic, no review) [MA1–MA3] | **Feasible now, free** |
| **WhatsApp Channels** | — | — | — | **No API for Channels** (Cloud API is business messaging only); unofficial web automation risks bans [W1] | **Blocked for everyone; share kit (§6.8)** |
| **Snapchat** | — | — | — | Public Profile API is allowlist-only and needs a Snap Business (Organization) account; Creative Kit Web needs nothing but the person finishes the post in the app [S1, S3, S4] | **Share kit with Creative Kit Web** (§6.8); posting API needs an entity and a Snap partnership |

What this means today: X, Telegram, YouTube, TikTok (private until the audit, then public), LinkedIn member profiles, Bluesky and Mastodon serve every channel the day the build ships. Facebook, Instagram and Threads publish for Al Ummah Now's own accounts and for Pages and accounts whose people hold a role on our Meta app (§2.4), and every other channel gets the share kit for them, with the video file ready, until a registered business is verified. The code is the same in every case: the gate is a switch per network (§11.1), not a different build.

### 2.3 Audience: networks that matter for Arabic and Muslim audiences

Ad-reach estimates from DataReportal *Digital 2026* (published November 2025, data from late 2025) [D1]. TikTok counts adults only. These are reach, not daily use.

| Country | YouTube | Facebook | Instagram | TikTok | Snapchat | X |
|---|---|---|---|---|---|---|
| Saudi Arabia | 27.5M | 17.7M | 18.2M | 38.6M | 25.3M | 15.0M |
| UAE | 8.4M | 9.7M | 8.1M | 12.5M | 5.1M | 2.9M |
| Egypt | 49.3M | 51.6M | 21.7M | 48.8M | 20.6M | 4.6M |
| Indonesia | 151M | 121M | 108M | 180M | 4.0M | 22.9M |
| Pakistan | 54.3M | 52.9M | 22.4M | 79.9M | 41.1M | 2.9M |
| Turkey | 57.9M | 34.7M | 62.3M | 44.9M | 16.2M | 18.5M |
| Malaysia | 23.6M | 23.0M | 16.1M | 30.7M | 1.7M | 4.8M |

Consequences for the product:

- **TikTok, YouTube and Facebook** are the largest everywhere; **Instagram** leads in Turkey; **X and Snapchat** are unusually strong in the Gulf (Saudi X reach is 15M). Snapchat being closed is a real gap for Gulf channels; the share kit covers it until a partnership exists.
- **Telegram and WhatsApp channels** are where many Islamic lecture and reminder channels already broadcast. DataReportal's reach figures don't cover them, but Telegram has a free, open API, so it comes straight after the owner's two priority networks (Facebook, X) in the connect list (§19, decision 1).
- **Arabic text.** On X, Arabic letters (U+0600–U+06FF, U+0750–U+077F) weigh 1, so an Arabic post gets the full 280; Arabic presentation forms such as ﷺ (U+FDFA) and ﷽ (U+FDFD), and emoji, weigh 2 [X4]. Hashtags with different spellings (أ/ا, ة/ه, ى/ي) are different tags; the composer suggests the variant the channel used before and never rewrites the person's text.
- **Timing.** In Ramadan, Saudi engagement peaks after Taraweeh and again before Suhoor, and posts just before Iftar underperform [R1, R2]. Weekends differ (Friday–Saturday in Saudi Arabia, Saturday–Sunday in the UAE since 2022), so "Friday" isn't one rule. No current source quantifies Jumu'ah peaks; the spec avoids the khutbah window by default and learns from each channel's own data (§7.2).
- **Policy.** Meta moved "shaheed" to contextual enforcement after the Oversight Board's 2024 opinion [MP1], but Arabic religious content still meets over-enforcement under Dangerous Organisations rules. Removal notices and appeal states from the networks are shown in Social (post detail and inbox) rather than as silent failures. YouTube channels set as Made for Kids (children's Qur'an channels) can't use YouTube Posts at all, which doesn't affect uploads.

### 2.4 Without a registered legal entity

Owner decision (§19, decision 4): **no legal entity exists.** Each network's rules were checked on 2026-11-09:

| Network | What works with no entity | Who it works for | What needs an entity | What an entity unlocks |
|---|---|---|---|---|
| **Facebook Pages** | A Meta app with **Standard Access** to every permission in §5.3. Standard Access "can only be requested from app users who have a role on the requesting app", and needs no verification when only role-holders use it [F5, F7]. Individual developer verification, which once gave limited Page access, was replaced by Business Verification in 2023 and is no longer offered to new apps [F8] | (1) **Al Ummah Now's own Pages**, managed by the owner and staff as app admins or developers (up to 500 admins). (2) **Testers**: Meta allows adding someone as a tester only if they are "your employee or you have an agreement with them which establishes that they are acting on your behalf as a tester", **at most 50** on an app without a verified business [F7]. That fits a written closed beta with chosen creators who give feedback, not general availability | Advanced Access for any Page whose admin has no role on the app: "Business Verification is required to get Advanced Access" [F5]; such apps are Tech Providers, which still need Business Verification and App Review (the separate Access Verification step was retired on 2026-10-09) [F6] | Every channel connects its Pages with no role on our app; inbox and insights for everyone; testers up to 500 |
| **Instagram, Threads** | Same as Facebook | Same: own accounts, plus role-holders and up to 50 testers in total across the Meta app | Same: Advanced Access needs Business Verification [I4, F5] | Same |
| **X** | Everything. A developer account with a card on file; no business required [X1] | Every channel | Nothing | — |
| **Telegram** | Everything. A bot from @BotFather, plus `api_id`/`api_hash` for the local Bot API server from my.telegram.org [T1, T3] | Every channel | Nothing | — |
| **YouTube** | Google OAuth verification of the sensitive scopes: homepage on our verified domain, privacy policy, demo video, per-scope justification. No company requirement stated [Y5]. The quota audit form accepts "As an individual user" / "Independent Developer/Sole Proprietor" [Y6]. Since 2026-11-02 uploads from unverified projects are no longer forced private [Y4] | Every channel. Before verification: at most 100 users in total and a warning screen [Y7] | Nothing | — |
| **TikTok** | App review (a full public website with privacy policy and terms, not for "private or personal use") and the Content Posting audit; neither official page requires a company. An organisation in the developer portal is a name only [TT5, TT6] | Every channel; posts are `SELF_ONLY` until the audit passes, then public | Nothing found. The audit form is behind a login, so whether it asks for company details is checked when we submit | — |
| **LinkedIn** | *Share on LinkedIn* (`w_member_social`), a self-serve product: posting as the **member** to their own profile, 150 requests per member per day [LI3, LI4] | Every channel, posting as the person who connects (the owner's or a team member's profile), not as a company Page | Community Management API (company Pages, org analytics and comments): "only available to registered legal organizations for commercial use cases", with legal name, registered address, business email and a verified organisation [LI5] | Company Pages with analytics and comments; Development tier first, Standard tier after a second review |
| **Snapchat** | Creative Kit Web, "no special setup required": a share button that opens Snapchat with the media; the person finishes in the app [S3] | Every channel, as a share kit | Public Profile API: allowlist plus a Snap Business (Organization) account [S4] | An application to Snap's partner programme; no public posting API is documented even then |
| **Bluesky, Mastodon** | Everything (self-published OAuth client metadata; per-instance app registration) [BS3, MA3] | Every channel | Nothing | — |
| **WhatsApp Channels** | Share kit only | Every channel | No API exists, entity or not | — |

**The best path for Facebook with no entity**, the owner's first-priority network, in order:

1. **Al Ummah Now's own Pages** run on the full feature set (auto-posts with the native video, composer, analytics, inbox) from the first production build, through Standard Access with the owner and staff as app admins and developers.
2. **A closed beta of up to 50 creators** as Meta app testers, each accepting a short beta-tester agreement inside Studio (what they test, that they give feedback, that it ends at general availability or when we remove them). Each tester accepts Meta's tester invitation with their own Facebook account at developers.facebook.com/requests, after which their Pages connect like any other. Studio manages the list (§11.1): invite, accepted, removed. This is within Meta's tester rule only as a genuine beta, so the seats go to channels that agree to report problems, and the list is reviewed monthly.
3. **Every other channel** gets the **Facebook share kit** (§6.8): the whole video file (or fit cut, or short) ready to download, the caption to copy, and a scheduled reminder. The person uploads it natively by hand in Meta Business Suite. Short-link clicks still count in Analytics.
4. **Everything else is built, reviewed and ready.** The App Review screencasts and permission write-ups for Advanced Access are recorded from the beta build, so submitting is the only step left once a business is verified.

With an entity, steps 2 and 3 end: Business Verification (Meta gives no official duration; reports range from days to several weeks), then App Review for the §5.3 permissions, then the Facebook, Instagram and Threads switches go on for every channel with no code change.

## 3. Personas and permissions

### 3.1 Personas

| Persona | Channel role (#462) | What they want from Social |
|---|---|---|
| **Sheikh Yusuf**, runs a lecture channel alone | Owner | Every new lecture announced on Facebook, Telegram and X without thinking about it, in Arabic, with a clip on Instagram and TikTok |
| **Nour**, social lead at a mosque media team | Admin | Connects the mosque's accounts once, plans Ramadan content a month ahead on a calendar, approves volunteers' drafts, reports reach weekly |
| **Bilal**, volunteer editor | Editor | Cuts a 45-second clip from Friday's khutbah, writes captions in both languages, submits for approval |
| **Huda**, community moderator | Moderator | Answers questions under the channel's Facebook and Instagram posts, hides abuse, never publishes |
| **Platform staff** | Site admin, on the videos admin | Turns a network off when its API breaks, stops a channel that spams, watches X and YouTube quota spend |

### 3.2 Capabilities

New capabilities are added to the #462 matrix (`packages/shared-types/src/channel-roles.ts`), with the same `can()` and `requireChannelAccess`. They are channel capabilities and are never written to Auth or a token.

| Capability | Owner | Admin | Editor | Moderator |
|---|:-:|:-:|:-:|:-:|
| `social.view`: see Social, connected accounts (name and avatar only), calendar and queue | Yes | Yes | Yes | Yes |
| `social.connect`: connect, reconnect and disconnect accounts, change account defaults | Yes | Yes | No | No |
| `social.compose`: create and edit drafts, request approval | Yes | Yes | Yes | No |
| `social.publish`: schedule or publish without approval, approve or reject others' posts, delete a published post on the network | Yes | Yes | Setting (§3.3) | No |
| `social.automate`: create and change automatic rules (§7) | Yes | Yes | No | No |
| `social.inbox`: read and reply in the inbox, hide or delete comments on the network | Yes | Yes | No | Yes |
| `social.analytics`: per-post and per-account metrics | Yes | Yes | No | No |
| `social.settings`: channel Social settings (approval policy, UTM, default hashtags, time zone) | Yes | Yes | No | No |

Notes:

- `social.analytics` follows `analytics.view` (owner and admin), as Studio decision 6 did.
- Moderators get the inbox because it is comment moderation, which they already have on-platform (`comment.moderate`). They can't compose posts.
- A member removed from the channel loses all of this on the next request (#462 §5.3). Accounts they connected **stay connected**, because the account belongs to the channel, and the audit log records who connected it. The owner can reconnect it under their own login on the network if they want to break the link to that person's network identity (§5.6).

### 3.3 Approval policy

A channel setting, `social.approval`, edited by `social.settings`:

| Value | Meaning |
|---|---|
| `editors` (default) | Posts written by an editor need approval by an owner or admin. Owners' and admins' own posts don't |
| `everyone` | Every post needs a second person with `social.publish`, including an admin's. The author can't approve their own post. Channels with one owner and no admins can't pick this |
| `none` | Editors can schedule and publish directly. `social.publish` is then granted to editors |

Automatic rules (§7) were approved when they were created, by someone with `social.automate`. Each generated post shows in the queue before it goes out (it can be edited or cancelled until then), but needs no second approval.

### 3.4 Audit

Every social action is written to `social_audit` in `SOCIAL_DB` (§12), in the same D1 batch as the change, so a change and its record can't disagree. It is a separate table from #462's `channel_audit` because the two live in different databases (`CHANNEL_ROLES_DB` and `SOCIAL_DB`) and D1 can't batch across databases. The Studio **Settings → Permissions → Activity** tab reads both and merges them by time, with a filter for Social.

Actions: `account_connected`, `account_reconnected`, `account_disconnected`, `account_revoked_by_network`, `account_expired`, `post_created`, `post_edited`, `post_submitted`, `post_approved`, `post_rejected`, `post_scheduled`, `post_unscheduled`, `post_published`, `post_failed`, `post_deleted_on_network`, `rule_created`, `rule_changed`, `rule_paused`, `rule_deleted`, `inbox_reply`, `inbox_hidden`, `inbox_deleted`, `settings_changed`, `beta_invited`, `beta_agreement_accepted`, `beta_removed`, `platform_suspended`, `platform_unsuspended`, `post_blocked_by_moderation`.

Each row has `actor_id` (or `system` for rules and the scheduler), `account_id`, `post_id`, and a `detail_json` that never contains tokens, message text from strangers, or email addresses. Rows are kept for one year, like #462 §10.

## 4. Information architecture in Studio

A new rail item **Social**, between Comments and Playlists, at `/[locale]/studio/{channelId}/social`. It is hidden for anyone without `social.view`, and for every channel when the platform switch is off (§11.1).

```text
/studio/{channelId}/social                         goes to social/calendar
/studio/{channelId}/social/calendar                ?view=month|week|list&date=YYYY-MM-DD&account=...
/studio/{channelId}/social/queue                   ?status=drafts|awaiting|scheduled|published|failed
/studio/{channelId}/social/compose                 new post; ?from=video:{id}|post:{id}|live:{id}
/studio/{channelId}/social/posts/{postId}          post detail: preview, per-network status, metrics, history
/studio/{channelId}/social/inbox                   ?account=...&type=comments|mentions|messages&state=open|done
/studio/{channelId}/social/analytics               ?range=7d|28d|90d|365d&account=...
/studio/{channelId}/social/automation              rules
/studio/{channelId}/social/accounts                connect, reconnect, disconnect
/studio/{channelId}/social/settings                approval, UTM, defaults, time zone
```

Tabs inside Social: **Calendar, Queue, Inbox, Analytics, Automation, Accounts, Settings**, each removed when the role can't use it (#476 §5.3). A **Create post** button sits at the top of the Social area on every tab, like Upload on the rail.

Other entry points:

- Video editor (#476 §4.5): a **Share to social** card showing auto-post status for this video and a **Create post** button (`compose?from=video:{id}`).
- Content → Posts: **Share to social** in each community post's menu.
- Content → Live: an **Announce** toggle per stream.
- Dashboard: a **Social** card with posts waiting for approval, failures, and reconnect warnings.
- Studio Analytics → Traffic sources: the `social` source links to Social → Analytics.

## 5. Connecting accounts

### 5.1 The model

A **connection** is one account on one network, attached to one channel. A channel can have several connections per network (two Facebook Pages, an Arabic and an English X account). One network account can be attached to several Al Ummah Now channels: each attachment is its own connection with its own token, and disconnecting one doesn't affect the others.

Types of target per network:

Rows are in the connect-list order the owner set (§19, decision 1).

| Network | Target connected | How |
|---|---|---|
| Facebook | A Page | OAuth (Facebook Login, or Facebook Login for Business once a business portfolio exists, §2.4), then pick Pages |
| X | An X account | OAuth 2.0 with PKCE |
| Telegram | A channel or group | Add the platform bot as an admin, then a link code (§5.4) |
| Instagram | A professional (Business or Creator) account | Instagram API with Instagram Login (no Page needed), or through the linked Facebook Page |
| YouTube | A YouTube channel | Google OAuth, pick the channel if the Google account has several |
| TikTok | A TikTok account | TikTok Login Kit OAuth |
| Threads | A Threads profile | Threads OAuth |
| LinkedIn | A company Page (and optionally the person's profile) | LinkedIn OAuth, pick organisations the person administers |
| Bluesky | A Bluesky account (any PDS) | AT Protocol OAuth (§5.5) |
| Mastodon | An account on any instance | Per-instance OAuth with dynamic app registration (§5.5) |
| WhatsApp Channels | none | No API. Share kit only (§6.8) |
| Snapchat | none | No posting API. Share kit only (§6.8) |

### 5.2 OAuth flow

```mermaid
sequenceDiagram
  participant B as Browser (Studio)
  participant A as api-videos
  participant K as KV SOCIAL_OAUTH
  participant N as Network
  participant D as SOCIAL_DB
  B->>A: POST /api/channels/:id/social/connect {network}
  A->>A: requireChannelAccess(social.connect), network enabled?, limit?
  A->>K: put state = {userId, channelId, network, pkceVerifier, nonce, returnTo} TTL 10 min
  A-->>B: {authorizeUrl}
  B->>N: authorize (scopes from §5.3)
  N-->>B: redirect to /api/social/oauth/{network}/callback?code&state
  B->>A: GET callback
  A->>K: get + delete state (single use)
  A->>A: same user? channel still exists? role still has social.connect?
  A->>N: exchange code (+ PKCE verifier)
  A->>N: fetch identity and pickable targets (Pages, channels, orgs)
  A->>K: put pick session {encrypted tokens, targets} TTL 10 min
  A-->>B: 302 /studio/{channelId}/social/accounts?pick={pickId}
  B->>A: POST /api/channels/:id/social/connect/pick {pickId, targetIds}
  A->>D: batch: insert social_accounts + social_tokens (encrypted) + social_audit
  A-->>B: connections
```

Rules:

- `state` is 32 random bytes, bound to the user id and channel id, single use, 10 minutes. The callback refuses a state created by another user, a channel the user lost access to in the meantime, or a network that was switched off.
- PKCE (S256) is used everywhere the network supports it (X, Google, TikTok, Bluesky, Mastodon, LinkedIn where available), even for confidential clients.
- The callback is on api-videos so the client secret never reaches the browser. Redirect URIs are fixed per environment (§15.2). No wildcard or user-supplied redirect.
- Scopes are requested **per feature the channel turned on**. A channel that never uses the inbox never grants message scopes. Turning the inbox on later triggers a reconnect with the extra scopes (incremental authorization where the network supports it: Google `include_granted_scopes`, Meta re-request).
- The pick step exists because one login can return many targets (all of a person's Pages). Nothing is stored until the person picks. Tokens for unpicked targets are discarded.
- The connected account's network-side id is unique per channel: connecting the same Page twice to one channel updates the existing connection (reconnect) instead of creating a duplicate.

### 5.3 Scopes (least privilege)

Requested scopes, by feature. **Base** is always requested; the others only when the channel enables that feature.

| Network | Base (connect + publish) | Analytics | Inbox | Notes |
|---|---|---|---|---|
| Facebook | `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `publish_video`, `business_management` (only to list Pages owned through a Business) | `read_insights` | `pages_manage_engagement`, `pages_read_user_engagement`, `pages_messaging` | Person needs CREATE_CONTENT (and MODERATE for inbox) task on the Page [F1] |
| Instagram (Instagram Login, recommended) | `instagram_business_basic`, `instagram_business_content_publish` | `instagram_business_manage_insights` | `instagram_business_manage_comments`, `instagram_business_manage_messages` | Works for Business and Creator accounts with no Facebook Page [I2]. The Facebook Login path (`instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`, `instagram_manage_comments`, `instagram_manage_messages`) is used only when the account is already reached through a connected Page |
| Threads | `threads_basic`, `threads_content_publish`, `threads_delete` | `threads_manage_insights` | `threads_read_replies`, `threads_manage_replies` | [TH1] |
| YouTube | `youtube.upload`, `youtube.readonly` | `yt-analytics.readonly` | `youtube.force-ssl` (comments insert/moderate) | `access_type=offline`, `include_granted_scopes=true` [Y2] |
| X | `tweet.read`, `tweet.write`, `users.read`, `media.write`, `offline.access` | (same; metrics via `tweet.read`) | `dm.read`, `dm.write` | Access token 2 h; refresh tokens rotate [X2] |
| TikTok | `user.info.basic`, `video.publish` (Direct Post), `video.upload` (inbox draft fallback) | `video.list` | — (no API) | `creator_info/query` before every post [TT2] |
| LinkedIn | `w_organization_social`, `r_organization_admin` | `r_organization_social` | `r_organization_social_feed`, `w_organization_social_feed` | Member must be ADMINISTRATOR or CONTENT_ADMIN of the Page; `w_member_social` only if the person chooses to post as themselves [LI1] |
| Bluesky | `atproto transition:generic` | — | (same) | Granular atproto scopes replace `transition:generic` when the PDS supports them |
| Mastodon | `read:accounts write:statuses write:media` | `read:statuses` | `read:notifications write:conversations` | Instance may cap scopes |
| Telegram | Bot admin right `can_post_messages` (`can_edit_messages` to edit) | — | `can_delete_messages` in the discussion group | Not OAuth (§5.4) |

### 5.4 Telegram

Telegram has no OAuth for channels. The platform runs one bot per environment (`@AlUmmahNowBot`, `@AlUmmahNowQABot`, `@AlUmmahNowStageBot`).

1. Studio shows: "Add @AlUmmahNowBot to your channel as an administrator with **Post messages** (and, for the inbox, **Delete messages**), then post this code in the channel: `AUN-7Q4K-93`". The code is 8 characters, single use, valid 30 minutes, stored in KV against the channel id and user id.
2. Telegram calls our webhook (`POST /api/social/webhooks/telegram`, checked with `X-Telegram-Bot-Api-Secret-Token`) with a `my_chat_member` update (bot promoted) and the `channel_post` with the code.
3. The webhook matches the code, checks that the bot's admin rights include `can_post_messages`, deletes the code message from the channel, stores the connection (`chat_id`, title, username), and confirms in Studio over the existing realtime socket (`social_account_connected` event).
4. If the bot is later demoted or removed, the `my_chat_member` update marks the connection `revoked` and notifies the channel (§9).

The bot token is a platform secret, not per channel. A channel's connection stores only the `chat_id`. Groups (for a linked discussion group, used by the inbox) connect the same way.

### 5.5 Bluesky and Mastodon

- **Bluesky:** AT Protocol OAuth. The client metadata document is served by api-videos at `https://videos.alummahnow.net/.well-known/atproto-client/{env}.json` (public, cacheable). Tokens are DPoP-bound, so the DPoP private key (ES256) is stored encrypted with the tokens and used for every call. The person enters their handle; we resolve it to their PDS and authorization server. App passwords are not accepted: they grant full account access and can't be scoped.
- **Mastodon:** the person enters their instance (`mastodon.social`, `ummah.social`, …). On first use of an instance, api-videos registers an app there (`POST /api/v1/apps`, scopes `read write:statuses write:media`, redirect URI fixed) and stores the client id and secret, encrypted, in `social_instance_apps`. Instances that refuse registration, or block our domain, show the instance's error. A platform deny list blocks instances known for abuse (§11.3).

### 5.6 Token storage, encryption and refresh

**Storage.** Tokens are never in R2, KV (except the 10-minute pick session, itself encrypted), logs, queue messages or analytics. They are in `social_tokens` (§12) as ciphertext.

**Encryption.** AES-256-GCM through WebCrypto, envelope style:

- A per-environment key-encryption key in Cloudflare Secrets Store, `social-token-kek` (binding `SOCIAL_TOKEN_KEK`), available only to api-videos (connect, callback) and processor (publishing, refresh, inbox). Not bound to web, admin-web, scheduler or websocket-server.
- Each token row has its own random data key, wrapped by the KEK. The row stores `kek_version`, wrapped data key, 12-byte IV and ciphertext. Additional authenticated data is `account_id|channel_id|network|token_kind`, so a ciphertext copied to another row fails to decrypt.
- Key rotation: a new KEK version is added to Secrets Store as `social-token-kek-v{n}`; a resumable job rewraps the data keys (not the tokens). Old versions are removed after the job reports zero rows.
- Decrypted tokens live only in the memory of the request or Durable Object that uses them.

**Refresh.** One Durable Object per connection, `SocialAccount` (§10.3), owns that connection's tokens. Every network call goes through it, so:

- Only one refresh happens at a time. This matters for networks with **rotating, single-use refresh tokens** (X, TikTok, Bluesky): two Workers refreshing in parallel would invalidate each other.
- Access tokens are refreshed when they have under 10% of their life left, or after a 401 that the network documents as expiry.
- Meta long-lived user tokens (60 days) and Instagram Login tokens are re-extended by the daily sweep when they are older than 7 days and have been used in the last 60. Page tokens derived from a long-lived user token don't expire, but are re-derived on each sweep to catch revoked permissions.
- The scheduler's daily sweep (§10.2) also calls each network's token introspection or a cheap "who am I" call for connections idle for 30 days, so a dead connection is found before a scheduled post needs it.

**States** of a connection: `active`, `needs_reconnect` (refresh failed, a scope was removed, password changed on the network, or Meta's 90-day re-consent), `revoked` (the network or the person revoked it), `disconnected` (by us, tokens destroyed), `suspended` (by platform staff). Posts targeting a non-active connection don't go out; they move to `failed` with the reason, and the channel is notified once (§9), not once per post.

### 5.7 Disconnect and revocation

Disconnect (Studio, `social.connect`):

1. Calls the network's revoke endpoint where one exists (Google `oauth2/revoke`, X `oauth2/revoke`, TikTok `oauth/revoke`, Meta `DELETE /{user-id}/permissions`, Mastodon `oauth/revoke`, Bluesky token revocation; Telegram: the bot leaves the chat).
2. Deletes the token rows in the same batch as marking the connection `disconnected`, regardless of whether the revoke call succeeded. A failed revoke is retried by a queue message for 24 hours, then logged.
3. Cancels its scheduled posts (they move to `drafts` with a note), pauses rules that target only this account, and removes it from rules that target several.
4. Keeps published-post records and metrics for analytics history (the post ids and counts, no tokens), deleted with the channel or after the retention period (§13.4).

**Deauthorize callbacks.** Meta's *Deauthorize* and *Data deletion* callbacks, TikTok's and Google's revocation notifications (Google's Cross-Account Protection / RISC), X's account activity where available, and Telegram's `my_chat_member` all land on `POST /api/social/webhooks/{network}`. Each verifies the network's signature, then marks matching connections `revoked` and destroys their tokens. Meta's data deletion callback returns a status URL and confirmation code as Meta requires.

### 5.8 Deleting channels and people

| Event | Effect on Social |
|---|---|
| **Channel deleted** (`channelDelete.ts`) | Every connection on the channel is disconnected as in §5.7 (revoke, destroy tokens), scheduled posts cancelled, rules deleted, inbox items deleted, media in `social-media` R2 deleted. Published-post records and metrics are deleted. Audit rows age out as in #462 §12 |
| **Person erases their videos data** (`DELETE /api/privacy/data`, `eraseUserData`) | Their own channels are deleted, so the row above applies. On channels they were only a member of: drafts they wrote and never submitted are deleted; posts already approved or published stay with the channel and their `created_by` becomes `DELETED_USER_ID`; connections they made stay (they belong to the channel) and `connected_by` becomes `DELETED_USER_ID`. Their audit rows are anonymised |
| **Auth `account.deleted`** (#462 §12) | Same as erasure, through the same internal route |
| **Member removed from channel** | Loses access immediately. Their drafts stay, visible to admins, so work isn't lost |
| **Data export** (`collectUserData`) | Adds the person's own drafts and the audit rows where they are the actor. No tokens, no inbox content |

## 6. Composer

### 6.1 What can be posted

| Source | What the composer builds | Default per network |
|---|---|---|
| **Video** (`from=video:{id}`) | One of three formats per target, **Whole video**, **Short (vertical)** or **Link post** (§6.1.1), or the thumbnail as an image post | The preselection in §6.1.1: the video itself on every network that takes video |
| **Short** (vertical video already on the platform) | The short as native vertical video everywhere that takes video | Native video |
| **Community post** (`from=post:{id}`) | Text, image(s), poll as text with a link, quiz as text with a link | Text with link to the post page; images attached where allowed |
| **Live stream or premiere** (`from=live:{id}`) | Announcement: "Live now" or "Premieres at …", thumbnail, link | Link post (there is no video file yet); Instagram and TikTok get a Story (where the API allows) or are skipped. When the stream ends and its recording is published, the `video.published` rule applies to the recording like any video |
| **Blank** | Free text, images, a link to any page of the channel | |

#### 6.1.1 Formats for a video: whole video, short, or link

Owner decision (§19, decisions 2 and 3): post the **video itself** natively, the whole video where the network allows it, with a short export when needed; and offer every format on every rule and every post so the channel chooses. No format is hidden, and none is preferred for our sake.

| Format | What is posted | When the whole video doesn't fit |
|---|---|---|
| **Whole video** (`full`) | The video file, transcoded to the network's spec (§6.6), with the caption | An automatic **fit cut**: the longest portion that fits the network's limit for *this* account (duration and size, read live where the network exposes it), starting at the beginning or at a chosen chapter, ending on a 3-second end card "Watch the full video on Al Ummah Now" with the channel name. The composer says it before scheduling: "X allows 20 minutes on this account. A 20:00 cut will be posted." |
| **Short** (`short`) | A vertical 9:16 export, ≤ 90 s by default (up to the network's maximum), from a range the person picks or an automatic range (§6.6.1) | Not applicable: a short is always made to fit |
| **Link post** (`link`) | Caption, link to the watch page, thumbnail card | Not applicable |

**The watch link with native video.** A native post carries the watch link wherever the network makes it free and clickable: in the caption (Facebook, Telegram, LinkedIn, Threads, Bluesky, Mastodon, YouTube description, TikTok has no clickable links so it is left out) or as the first comment (Instagram, where caption links aren't clickable). **On X** a URL in a post or a reply is billed at the link price (§18), so the link is **off by default** and offered as **"Add the watch link as a reply (+$0.20)"**; the fit-cut end card and the channel's X bio carry the way back instead.

**Preselection.** The composer and every new rule start with the format below for each network. It is the video itself wherever the network takes video; the person can change any of them, and the channel can change its own defaults in Social → Settings (§17.9), which then apply to new rules and new posts.

| Network | Preselected format | Why | Other formats offered |
|---|---|---|---|
| Facebook | Whole video (Page video; fit cut only past Facebook's limit) | Facebook takes long video natively | Short (as a Reel), Link post |
| X | Whole video (20 min, or 125 min for Premium accounts; fit cut past that, §6.3) | Native video, no URL billing | Short, Link post (shows its price) |
| Telegram | Whole video (§6.6, Telegram size) | Channels watch inside Telegram | Short, Link post |
| Instagram | Short (Reel) | Instagram has no link posts and its video surface is vertical Reels | Whole video (as a Reel, fit cut past 15 min) |
| YouTube | Whole video | The upload is the post | Short (as a YouTube Short) |
| TikTok | Short | Vertical-only surface; whole video up to the creator's `max_video_post_duration_sec` | Whole video |
| Threads | Whole video (fit cut past 5 min) | Native video | Short, Link post |
| LinkedIn | Whole video (fit cut past the limit) | Native video | Short, Link post |
| Bluesky, Mastodon | Whole video (fit cut past the limits read from the server) | Native video | Short, Link post |
| WhatsApp Channels, Snapchat (share kit) | Short | The kit's downloadable file must be small enough to share by hand | Whole video file, link |

**No hidden bias toward links.** The three formats are shown as equal choices with the same weight (§17.3); the only extra text is facts: the fit-cut length, the processing time, and on X the price. Link posts are never chosen automatically as a fallback for a failed or slow export: if an export fails, the target fails with the reason and a **Retry** or **Switch format** action, and an automatic rule's post waits in the queue for the person (§7.3).

**More than one format to one account.** A post can include the same account more than once with different formats (for example the whole video on the Facebook Page feed and a short as a Facebook Reel). Each is its own target.

### 6.2 Layout

The composer has one **base** caption and per-network tabs. Each tab starts as "Same as base" and can be customised; once customised it stops following base edits (with a "Reset to base" link), the pattern Buffer, Hootsuite and Publer use.

Fields:

- **Accounts:** chips for every connected account; selecting one adds its tab.
- **Caption** (base, and per network), with a counter that uses that network's counting rules (§6.4).
- **Language:** English, Arabic, or both. "Both" makes two captions side by side (§6.5).
- **Format** (per network tab, §6.1.1): **Whole video**, **Short (vertical)** or **Link post**, preselected per network, plus thumbnail or custom frame as an image post, or uploaded images (up to the network's limit).
- **Link:** the watch page or post page, with UTM added automatically (§8.1). Shown to the person as the short link. With a native format it goes where the network makes it free (§6.1.1); on X it is an opt-in reply that shows its price.
- **Hashtags:** suggested from the video's tags, category and channel defaults; network-specific placement (end of caption, or first comment on Instagram).
- **Mentions:** typed per network, since handles differ per network. No cross-network mention mapping.
- **First comment** (Instagram, Facebook, YouTube, LinkedIn, X as a reply): optional.
- **Network options:** per network, from §6.3 (privacy level and interaction settings on TikTok, Reel vs. post vs. Story on Instagram, Short vs. video and privacy on YouTube, silent message and pin on Telegram, content warning on Mastodon, alt text everywhere).
- **When:** Publish now, Schedule (date and time in the channel's time zone, best-time chips, §7.2), Add to queue slot, or Save draft.

### 6.3 Per-network rules

The composer refuses to schedule a post that breaks a hard limit and warns on soft ones. The rules are data, in `packages/shared-types/src/social-networks.ts`, so web, api-videos and processor check the same table.

| Network | Text | Media | Video | Hard limits and required UX | Source |
|---|---|---|---|---|---|
| **Facebook** | ~63,206 chars; feed folds after ~125 | Up to 10 photos | Page video by Resumable Upload: **no size or duration limit is documented** [F4], so the whole video is sent as is; if Meta rejects it for size or length, the target is re-posted as a fit cut and the limit Meta reported is stored for that Page. **Reels 3–90 s, 9:16, 1080×1920, 24–60 fps**; a Reel shared as a Page story ≤ 60 s | **30 API Reels per Page per 24 h** | [F1, F2, F4] |
| **Instagram** | Caption 2,200; ≤ 30 hashtags; ≤ 20 @mentions | JPEG only, 4:5 to 1.91:1, ≤ 8 MB, 320–1440 px; carousel ≤ 20 items | **Reels 3 s–15 min, ≤ 300 MB**, 9:16; Stories video 3–60 s, ≤ 100 MB | Publishing limit from `content_publishing_limit` (documented as 100 per 24 h, carousel counts 1; docs also say 50 in one place, so we read it live). Media URL must be publicly fetchable. Containers expire after 24 h | [I1, I3] |
| **Threads** | 500 | JPEG/PNG ≤ 8 MB; carousel 2–20 | MOV/MP4 ≤ 5 min, ≤ 1 GB, 9:16 recommended | 250 posts and 1,000 replies per 24 h (read `threads_publishing_limit`) | [TH1] |
| **YouTube** | Title 100, description 5,000 | Thumbnail ≤ 2 MB | ≤ 256 GB / 12 h; Short = vertical ≤ 3 min | **100 `videos.insert` per day per project**; with no privacy set, uploads default to public, so we always send `privacyStatus` explicitly | [Y2, Y3] |
| **X** | **280 weighted** (Arabic letters 1, presentation forms and emoji 2, URL 23) | 4 images ≤ 5 MB; GIF ≤ 15 MB | `tweet_video`: **0.5 s–20 min, ≤ 8 GB** for every account; **125 min, ≤ 16 GB** for Premium / verified accounts. H.264 High, AAC-LC, ≤ 60 fps, up to 1280×1024 (we send 1280×720 or 720×1280), aspect 1:3 to 3:1. Chunked upload, ≤ 5 MB chunks | 100 posts per 15 min per user; 10,000 per 24 h per app; media `initialize`/`append`/`finalize` 1,875 each per 15 min per user. The long-video tier isn't documented per subscription type, so the adapter reads `subscription_type` and `verified_type` from `GET /2/users/me` as a hint, posts up to 20 min for everyone, and treats the 403 "not allowed to post a video longer than 20 minutes" as a signal to re-post the 20-minute fit cut and remember the account's limit. **Cost shown in the composer:** $0.015 for a native post; "$0.20: this post contains a link" when the person adds one (§18) | [X1–X3, X5] |
| **TikTok** | Title 2,200 UTF-16 units | Photos WebP/JPEG ≤ 20 MB | MP4/WebM/MOV, 23–60 fps, 360–4096 px, ≤ 10 min via API (per creator: `max_video_post_duration_sec`), ≤ 4 GB | **Required UX** (TikTok's content-sharing guidelines): show the creator's nickname; privacy dropdown from `creator_info` **with no default**; comment, duet and stitch toggles off by default and disabled when the creator has disabled them; commercial-content disclosure ("Your brand" / "Branded content", branded content can't be private); Music Usage Confirmation consent text; preview; notice that processing takes minutes; no watermark; `is_aigc` label when the person marks AI-generated content. ~15 posts per creator per day; 6 init requests per minute | [TT1–TT4] |
| **LinkedIn** | 3,000 | Images; documents | Videos API multi-part upload, wait for AVAILABLE | `Linkedin-Version` header pinned and bumped before each sunset (202511 sunsets 2026-11-16) | [LI1, LI2] |
| **Telegram** | 4,096; caption 1,024 | Photo ≤ 10 MB; albums 2–10 | **Upload ≤ 50 MB** on the cloud Bot API; **≤ 2,000 MB** through our local Bot API server (§6.6) | ~20 messages per minute per group; ~30 per second per bot overall | [T1, T2, T3] |
| **Bluesky** | 300 graphemes | 4 images; blob ≤ 50 MB on the PDS | Limits per user from `app.bsky.video.getUploadLimits` | 5,000 write points per hour, 35,000 per day per account | [BS1, BS2] |
| **Mastodon** | Instance limit (default 500, URL = 23) | Instance limits from `/api/v2/instance` | Instance limits | 300 calls per 5 min; 30 media uploads per 30 min; `Idempotency-Key` honoured for 1 h (we send it) | [MA1, MA2] |

Soft warnings: Facebook text past the fold, Instagram hashtags past 5 (reach guidance), a link in an Instagram caption (not clickable), a post with no media on networks where link cards are weak (Instagram, TikTok can't post text at all), X posts with a URL anywhere in the text (the price is shown), a whole video that will be posted as a fit cut (the cut length is shown).

### 6.4 Counting characters

- **X** uses weighted counting after NFC normalisation: code points up to U+10FF weigh 1 (Latin, Arabic U+0600–U+06FF, Arabic Supplement U+0750–U+077F), everything else weighs 2 (CJK, emoji, and Arabic presentation forms such as ﷺ U+FDFA and ﷽ U+FDFD), and every URL counts as 23 regardless of length. The counter uses the `twitter-text` v3 weighting configuration, vendored as data, not an approximation. The composer warns when a presentation-form ligature costs double and offers the spelled-out form (صلى الله عليه وسلم).
- **Bluesky** counts grapheme clusters (300). **Mastodon** counts characters with every URL as 23 (500 default, read from the instance's `/api/v2/instance` `configuration.statuses.max_characters`). **Threads** 500 characters. **Instagram** and **TikTok** captions 2,200. **Facebook** has a high limit but truncates in feed after about 125 characters; the preview shows the fold. **LinkedIn** 3,000. **Telegram** 4,096 for text, 1,024 for a media caption.
- Counting is done with `Intl.Segmenter` (graphemes) so combining Arabic marks (tashkeel) and emoji sequences count the way the network counts them, and is unit tested against each network's own examples.

### 6.5 Arabic, English and bidi text

- "Both" languages produces either **one bilingual post** (Arabic first, a blank line, then English; or the reverse, per channel setting) or **two separate posts** to two accounts (an Arabic account and an English account). The composer suggests two posts when the channel has two accounts on the same network tagged with different languages (§5 account defaults: `language: ar|en|both`).
- Each caption field is `dir="auto"` and shows the preview in the direction the network will render it.
- Mixed lines (Arabic text with an English hashtag, @handle or URL) are previewed with Unicode isolates (`U+2068 … U+2069`) around the Latin run so the person sees where punctuation will land. Isolates and other invisible direction controls are **stripped before sending**: networks count them as characters and they break hashtag and mention parsing. To fix a line that will render badly, the composer suggests moving the Latin run to its own line, which renders correctly everywhere.
- Arabic hashtags are allowed and suggested (`#رمضان`, `#خطبة_الجمعة`). Hashtags can't contain spaces; the composer replaces spaces with `_` and strips tashkeel and tatweel from hashtags (they break matching on most networks), and keeps Arabic-Indic digits as typed.
- The video's localised title and description (`titleLocalized`, `descriptionLocalized`) prefill the matching language.
- The **watch link** uses the locale of the post's language (`/ar/video/{id}` for Arabic posts), so a reader lands in their language.

### 6.6 Media preparation

Networks need different files. Al Ummah Now's videos live in Bunny Stream; the processor prepares derived files and stores them in a new R2 bucket, `social-media`.

Constraints found in research that decide the design:

- **Bunny Stream has no clip, trim or crop API.** It offers MP4 fallback renditions (`https://{pull-zone}/{videoId}/play_{240…1080}p.mp4`), enabled per library and only for videos encoded after enabling, up to 1080p [BN1, BN2].
- **Cloudflare Media Transformations** (`/cdn-cgi/media/…`) can trim and centre-crop, but takes inputs **under 100 MB and up to 10 minutes long**, starts a clip **within the first 10 minutes**, and outputs **at most 60 s** [CF1]. A lecture clip from minute 40, or a 90 s Reel, is out of its reach. It is still the right tool for frames and thumbnails.
- So clips, fit cuts and per-network transcodes are rendered by **ffmpeg in a Cloudflare Container** (`ClipRenderer`, a container class attached to the processor through a Durable Object), reading the 720p or 1080p MP4 fallback by HTTP range requests and writing to R2. One path for every export: shorts at any start point up to 3 minutes, fit cuts and whole-video transcodes of any length, with crop, blurred letterbox and burned-in captions from the video's subtitles. Cloudflare Containers was in public beta at the time of writing [CF2]; it is the one Cloudflare dependency here that isn't GA, and the fallback if it's unavailable is a ≤ 60 s clip from the first 10 minutes through Media Transformations, offered with that limit stated in the clip editor.
- **Older videos without MP4 fallback.** Turning on MP4 fallback in each Bunny library is part of rollout (§15.3). Videos encoded earlier get it through a resumable re-encode job, oldest-popular first, and until then their composer offers link posts and thumbnails only, with the reason shown.

| Output | Used for | How it's made |
|---|---|---|
| **Whole video, as is** (`full_mp4`) | Whole-video targets where one of Bunny's renditions meets the network's spec and size: usually YouTube, Facebook, LinkedIn and Telegram (1080p), X and Threads (the 720p rendition is H.264/AAC at 1280×720), Mastodon and Bluesky (a lower rendition when the size cap needs it) | The highest Bunny MP4 fallback rendition (240p–1080p) that meets the target's resolution, codec and size limits, streamed from Bunny into the network upload or into R2 when the network pulls from a URL. No render. **Copy, don't encode** is the rule: the planner tries every rendition before asking for a transcode |
| **Whole video, transcoded** (`full_export`) | Whole-video targets no rendition fits: a size cap no rendition at ≥ 480p meets (Instagram's 300 MB for a 15-minute Reel, small Mastodon instances), or a codec the network refuses | `ClipRenderer` re-encodes the whole video to the target's spec (resolution, bitrate ceiling chosen to land under the size limit, frame rate, audio), writes to R2. One export per (video, spec) is reused by every target and channel that needs the same spec until it expires |
| **Fit cut** (`fit_cut`) | Whole-video targets where the video is longer (or, at an acceptable bitrate, larger) than the network or account allows | `ClipRenderer` cuts the chosen rendition from the start or the chosen chapter to the limit minus 3 s **by stream copy** (cut at the keyframe at or before the limit, no re-encode), then joins an end card ("Watch the full video on Al Ummah Now", channel name and avatar, in the post's language) encoded once per channel, language and rendition with matching codec parameters, so the join is also a copy. A few seconds of CPU per cut. If the rendition can't be stream-copied cleanly (variable parameters), it is re-encoded like a `full_export` |
| **Short** (`clip`; 9:16, ≤ 90 s by default, up to 3 min where the network allows) | Instagram Reels, TikTok, YouTube Shorts, Facebook Reels (≤ 90 s), Threads, X, Bluesky, Mastodon, share kits | ffmpeg in the `ClipRenderer` container: range-reads the MP4 fallback, trims, crops or letterboxes, optionally burns in captions, encodes H.264/AAC 1080×1920 30 fps, writes to R2 (§6.6.1). The range is chosen by the person, or automatically for rules (§6.6.1) |
| **Frame or thumbnail image** | Image posts, link cards, Telegram photo, custom frames | The video's existing thumbnail from the images pipeline, or a frame at a chosen time through Media Transformations `mode=frame`, resized per network (1080×1080, 1080×1350, 1200×675) |
| **Captions** | YouTube (captions track); burned into clips for Reels, TikTok and Shorts when the person ticks it | The video's existing subtitles (`05-subtitles-captions.md`), as SRT/VTT for YouTube, or rendered into the clip by ffmpeg with an Arabic-capable font (Noto Naskh Arabic / Noto Sans, shaped by libass with HarfBuzz) |

**Crop.** The composer shows a 9:16 frame over the video with a draggable horizontal position (centre by default) and a keyboard alternative (WCAG 2.5.7). The chosen offset becomes the crop. Letterbox (blurred background) is offered when the subject doesn't fit.

**Public URLs for pull-based networks.** Instagram, Threads, Facebook (Reels by URL) and TikTok (`PULL_FROM_URL`) fetch media from a URL. Those URLs are served from `https://media.videos.alummahnow.net/social/{random}` (R2 custom domain on the `social-media` bucket), with unguessable 128-bit object names, `Cache-Control: private`, and the object deleted 24 hours after the post publishes. TikTok requires the URL prefix to be verified in the TikTok developer portal; the `media.` subdomain is verified once per environment.

**Size and time budget.** The processor never holds a whole video in memory. Uploads to networks that take bytes (YouTube resumable, X chunked, LinkedIn multipart, Telegram via `sendVideo` multipart) stream from Bunny or R2 in chunks through the `SocialAccount` Durable Object, which resumes from the last acknowledged chunk if a Worker invocation ends.

**Telegram size limit.** The cloud Bot API accepts uploads up to 50 MB, which a lecture never fits. Because the owner wants the whole video posted (§19, decision 2), the processor runs Telegram's open-source **local Bot API server** (`telegram-bot-api`, Boost licence) as a second container class, `TelegramBotApi`, which accepts uploads **up to 2,000 MB** [T3]. It needs the platform's `api_id` and `api_hash` from my.telegram.org (a personal developer registration, no business needed) as secrets. Whole videos up to 2,000 MB go through it; a longer video gets a transcode that lands under 2,000 MB at ≥ 720p if one exists, otherwise a fit cut. Shorts and images keep using the cloud Bot API directly. If the local server is down, whole-video Telegram targets wait and retry (class `retryable`); they don't switch to a link post on their own.

#### 6.6.1 Clip jobs

Every export (short, fit cut, whole-video transcode, image) is a job (`social_media_jobs`): `queued → rendering → ready | failed`. The composer shows progress over the realtime socket and lets the person keep writing.

- **Which job a target needs** is decided by api-videos from the format (§6.1.1), the source video's duration, size and codec, and the target's limits (§6.3, live values where the network has them): `full_mp4` when Bunny's rendition already fits, `full_export` when only the spec differs, `fit_cut` when the duration (or the size at the network's minimum acceptable bitrate) is over the limit, `clip` for shorts. Jobs are shared: the key is `(video_id, kind, spec_hash, range)`, so ten channels' rules wanting the same X export of the same video render once.
- **Automatic ranges.** For a short or a fit cut made by a rule, the start is chosen by the rule's setting: **From the start** (skipping the channel's intro length, a channel setting, default 0 s), **From a chapter** (the first chapter whose title matches, or chapter N), or **Most-watched part** (the peak window of the video's retention graph; needs at least 500 views, so it applies to rules with a delay or to recurring "best of" posts, and falls back to From the start with a note). In the composer the person can always move the range by hand.

- **Renderer.** `ClipRenderer` is a Cloudflare Container image (ffmpeg with libass, HarfBuzz and the Noto Arabic and Latin fonts), driven by a Durable Object class in the processor. The processor's `SocialMediaJob` handler starts an instance, passes a signed Bunny MP4 URL, the trim, crop and caption parameters, and a one-time R2 upload URL; the container streams input by range requests and uploads the result. Instances sleep after 2 minutes idle; at most 5 run at once per environment (a setting), and jobs queue behind them.
- **Limits.** Shorts up to 3 minutes; fit cuts and whole-video exports any length; source any length. Shorts run on the standard instance type; whole-video exports and fit cuts over 10 minutes run on the largest instance type, one per job. A render fails with a retry button when it takes longer than 10 minutes for a short, or longer than the source's own duration (minimum 10 minutes) for a whole-video export.
- **Fallback.** If the container service is unavailable, clips of up to 60 s starting in the first 10 minutes of a video are made with Media Transformations (§6.6 constraints), and the clip editor says why longer or later clips are unavailable right now. A post can't be scheduled until its media is `ready`, except for automatic rules and for scheduled posts with a whole-video export, where the job runs ahead of the scheduled time and the post waits for it (and fails with a clear reason and a **Retry** or **Switch format** action if it never becomes ready; it never falls back to a link post on its own).

### 6.7 Previews

Each network tab shows a preview built from that network's current layout: avatar and name from the connection, caption with the network's truncation ("… more" fold), link card or media in the network's aspect ratio, hashtags styled as links. Previews are approximations and say so in small text. Arabic previews render right to left as the network does.

### 6.8 Share kit (networks without a posting API)

For WhatsApp Channels and Snapchat, for Facebook, Instagram and Threads while the channel can't connect them (§2.4: no Advanced Access without a verified business), and for any network the platform has switched off or the channel hasn't connected, the composer offers a **share kit**: the caption (copy button), the media in the format the person chose (download button for the whole video, fit cut, short, image or thumbnail, made by the same jobs as §6.6.1), the short link, and an **Open in app** link (`https://wa.me/?text=…`; Snapchat's Creative Kit Web share button, which opens Snapchat with the media attached [S3]; `https://business.facebook.com/latest/composer` for Facebook and Instagram). A share-kit post can be scheduled as a **reminder**: at the time, the person who scheduled it gets a notification with the kit. Clicks on its short link are still counted, so analytics covers these networks too.

### 6.9 Validation before publishing

Before a post can be scheduled, api-videos checks:

1. Every hard rule in §6.3 for every target.
2. The target connections are `active` and have the scopes the post needs.
3. The source still exists and is public (or will be public at the scheduled time: a scheduled video can be announced for a time at or after its publish time, never before).
4. Plan limits (§11.2) and the platform rate limits (§11.3).
5. Outbound moderation (§11.4).

The same checks run again in the processor just before publishing, because things change between scheduling and sending.

## 7. Scheduling, queue and automation

### 7.1 Calendar and queue

- **Calendar** (month, week, list) shows scheduled, published and failed posts per day, coloured by status with a text label (never colour alone), and filterable by account. It also shows the channel's scheduled videos and premieres (from the existing scheduled-videos data) as read-only markers, so posts can be planned around them. Dragging a scheduled post to another day reschedules it (owner, admin, or the author while it's a draft), with a **Move to…** menu as the keyboard alternative.
- **Queue** is the list view with status tabs: Drafts, Awaiting approval, Scheduled, Published, Failed.
- **Queue slots** (Buffer's pattern): the channel defines weekly slots per account (for example Sat–Thu 08:00 and 20:00, Fri 13:30 after Jumu'ah). "Add to queue" puts the post in the next free slot. Slots are created from best-time suggestions with one click.
- **Recurring posts:** a post can repeat weekly or monthly (for example "Every Friday 11:00: Surah Al-Kahf reminder" or "every Monday: this week's lectures"). Each occurrence is generated 7 days ahead as its own scheduled post, editable on its own. Recurrence uses an RRULE subset (`FREQ=WEEKLY|MONTHLY;BYDAY;BYMONTHDAY;UNTIL|COUNT`).
- **Hijri dates:** the calendar can show Hijri dates under Gregorian ones (Umm al-Qura calendar via `Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura')`), and recurrence can be "yearly on 1 Ramadan" using the same calendar. Hijri dates computed this way can differ by a day from local moon sighting; the UI says "approximately" and the person confirms the date.

### 7.2 Time zones and best time

- Every channel has a Social time zone (default: the channel owner's `scheduledPublishTimezone`). Times are stored in UTC with the IANA zone the person chose, and shown with the zone. DST changes keep the wall-clock time for recurring posts.
- **Best time** suggestions, per account, in order of preference:
  1. The account's own audience-online data where the network exposes it (Instagram `online_followers`, Facebook Page insights).
  2. The channel's own published-post history: median engagement by weekday and hour over the last 90 days, once it has at least 20 posts on that account.
  3. A starting table per network and region from published research (§2.3), adjusted for Arab audiences: evenings after Isha, Friday after Jumu'ah (never inside the khutbah window, about 12:00–13:30 local), and during Ramadan after Taraweeh and before Suhoor rather than just before Iftar. Ramadan dates come from the Hijri calendar above.
- **Prayer-relative slots.** A queue slot can be set relative to a prayer in a chosen city ("30 minutes after Isha in Riyadh"), computed daily with the `adhan` library (MIT) using the method common to that country (Umm al-Qura for Saudi Arabia, Egyptian General Authority for Egypt, and so on, editable). The slot moves with the prayer time through the year.
- Suggestions are shown as three chips with a one-line reason ("Your followers are most active Thursdays at 21:00"). They're suggestions; nothing moves on its own.

### 7.3 Automatic rules

A rule says: **when** this happens on the channel, **post** this template to these accounts, **with** this timing. Created in Social → Automation by `social.automate`.

| Trigger | Source | Default template |
|---|---|---|
| `video.published` | Scheduler publish, or Publish now | "{title}" plus "{link}" where the link is free (§6.1.1), with each network's preselected format: the whole video (or fit cut) on Facebook, X, Telegram, YouTube, Threads, LinkedIn, Bluesky and Mastodon; a short on Instagram and TikTok |
| `premiere.scheduled` | Premiere created (`10-premiere.md`) | "Premieres {date, local}: {title} {link}" |
| `premiere.starting` | 15 min before (configurable 5–60) | "Starting in 15 minutes: {title} {link}" |
| `live.started` | Live stream goes live | "Live now: {title} {link}" |
| `community_post.published` | New community post | Post text truncated per network + link |
| `short.published` | New short | The short as native vertical video |

Each rule has, **per account in the rule, a format**: Whole video, Short or Link post (§6.1.1), preselected as in §6.1.1 and changed with the same control as the composer (§17.9), plus the short's range setting (From the start, From a chapter, Most-watched part) and, on X, whether to add the watch link as a reply (off by default, priced). Each rule also has filters (only public videos, only a playlist, only a category, only videos longer or shorter than N minutes, language), a delay (0 to 24 h after the trigger, or "next queue slot"), per-network template overrides, and a **hold for review** option (the generated post waits in Awaiting approval instead of being scheduled).

**How triggers reach Social.** The existing events already exist or are being added: the scheduler publishes videos and emits queue events (`apps/scheduler/src/publisher.ts`), Publish now writes the video in api-videos, and live state changes in api-videos. Each of these sends a `SocialTrigger` message to the new `al-ummah-now-social` queue with `{channelId, trigger, sourceId, occurredAt}`. The processor matches rules, renders templates, validates (§6.9), and creates scheduled posts. A trigger message is idempotent on `(rule_id, source_id, trigger)` (unique index), so a retried event never posts twice.

**Timing with exports.** When a rule fires, its export jobs start at once. The post is scheduled for the trigger time plus the delay, and waits for its media if the export isn't ready by then (a 90-minute lecture's X export takes minutes, not hours). Each account's post goes out when its own media is ready; one slow export doesn't hold the others.

**Unpublish.** If a video is made private or deleted before its auto-post goes out, the post is cancelled. If it's already out, the channel gets a notification offering to delete the post on the networks (one click, `social.publish`). It is never deleted automatically, because the network post may have its own discussion.

### 7.4 Publishing and retries

1. The scheduler's minute cron (§10.2) selects posts due in the next minute and sends one `SocialPublish` message per **target** (a post to five accounts is five targets) to the `al-ummah-now-social` queue.
2. The processor's handler calls the target's `SocialAccount` Durable Object, which re-validates, gets a fresh token, prepares media (or waits for the media job), and calls the network.
3. Success: stores the network's post id and permalink, marks the target `published`, and emits `social_post_published` to the channel's Studio sockets.
4. Failure: classified as

| Class | Examples | Action |
|---|---|---|
| `retryable` | 5xx, timeouts, 429, Meta "temporarily unavailable", media still processing on the network | Retry with exponential backoff and jitter: 1, 2, 5, 15, 30, 60 min, then fail. Respect `Retry-After` and rate-limit reset headers |
| `auth` | 401 expired, revoked, scope missing | Try one refresh; if it fails, connection → `needs_reconnect`, target fails with "Reconnect {account}" |
| `content` | Caption too long, media rejected, duplicate post (X), policy rejection | Fail at once with the network's message translated to a known reason where possible |
| `quota` | YouTube daily quota exhausted, X credits exhausted, Instagram 24-hour publishing limit | Reschedule to the time the quota resets if within 24 h of the planned time, otherwise fail. Platform admins are alerted (§11.5) |

5. **No double posts.** Before each attempt, the DO writes `attempt_id` and state `sending` for the target. If a Worker dies after the network accepted the post but before we stored the id, the next attempt first looks for the post on the network (by our UTM `utm_content` token in the link, or the network's idempotency key where one exists: Telegram has none, X none, so the lookup is a "recent posts" read limited to 15 minutes) before sending again. Where a network offers no way to look, the target is marked `unknown` and the person is asked to check, rather than risk a duplicate.
6. **Container networks** (Instagram, Threads, TikTok, YouTube processing): the DO creates the container, then polls its status with an alarm (every 10 s for 5 min, then every minute up to the network's limit) before the publish call. No Worker waits in a loop.

### 7.5 Failure notifications

New notification keys, in a new `social` category (on by default, toggle in notification settings), delivered through the existing notification centre and push (`apps/processor/src/push`):

| Key | To | English | Arabic |
|---|---|---|---|
| `socialPostFailed` | Author and approvers | Your post to {account} didn't go out: {reason}. | لم يُنشر منشورك على {account}: {reason}. |
| `socialAccountNeedsReconnect` | Owner and admins | {account} needs to be reconnected before scheduled posts can go out. | يجب إعادة ربط {account} قبل نشر المنشورات المجدولة. |
| `socialPostAwaitingApproval` | Approvers | {author} sent a post for approval. | أرسل {author} منشوراً للموافقة. |
| `socialPostApproved` | Author | Your post was approved and scheduled for {time}. | تمت الموافقة على منشورك وجدولته في {time}. |
| `socialPostRejected` | Author | Your post was returned with a note: {note}. | أُعيد منشورك مع ملاحظة: {note}. |
| `socialShareKitReminder` | Scheduler of the reminder | Time to post to {network}. Your caption and media are ready. | حان وقت النشر على {network}. النص والوسائط جاهزة. |
| `socialAccountRevoked` | Owner and admins | {account} was disconnected on {network}. | تم فصل {account} من {network}. |

`dedupeKey` is the target id (failure), the connection id plus day (reconnect), or the post id (approval). Reconnect warnings are sent at most once a day per connection.

## 8. Analytics

### 8.1 Links and attribution

Every link we generate points to a short link on our domain, `https://videos.alummahnow.net/s/{code}`, one code per **target** (post × account). The short link:

- Redirects (302, `Cache-Control: no-store`) to the watch or post page with `utm_source={network}&utm_medium=social&utm_campaign={campaign}&utm_content={targetCode}`. `campaign` defaults to `aun_auto` for rules and `aun_social` for manual posts, and can be set per post (for example `ramadan_1448`).
- Counts the click server-side as an aggregate counter (no cookie, no user id, no IP stored): D1 `analytics_daily` counters `social_click` with dimension `target:{code}` and `network:{network}`. This works without the viewer's analytics consent because it is a count of requests to our own redirect, like a page view counter, with nothing about the person.
- Lets us see clicks for networks with no analytics API (WhatsApp, Snapchat share kits, Telegram, Mastodon).

**On the watch page**, the traffic-source classifier from #476 §8.4 adds a `social` source: the first page of a visit whose URL has `utm_medium=social` is classed `social` with dimension `utm_source` (the network) instead of `external`. The `utm_content` code is passed to the view event, and the processor adds `traffic_social` counters per network and per target code, for the video and the channel, under the same consent rules as §8.4 (aggregate, needs analytics consent). Without consent the click counter in the redirect still counts.

The UTM parameters are stripped from the address bar after reading (`history.replaceState`), so shared copies of the page don't carry the attribution forward.

### 8.2 Metrics pulled from networks

A daily job per connection (and an extra pull at 1 h, 24 h and 7 days after each post) reads metrics through the `SocialAccount` DO and stores daily snapshots.

| Network | Per post | Per account | Notes |
|---|---|---|---|
| Facebook | Impressions, reach, reactions, comments, shares, clicks, video views (Reels plays) | Followers, Page reach, online times (when Meta provides them) | `read_insights` [F1] |
| Instagram | Reach, views, likes, comments, saves, shares, Reel plays and watch time | Followers, reach, profile views, online followers | Insights scopes [I1] |
| Threads | Views, likes, replies, reposts, quotes, shares, link clicks | Followers, demographics (≥ 100 followers) | No data before 2024-04-13 [TH2] |
| YouTube | Views, watch time, likes, comments, average view duration | Subscribers, views | YouTube Analytics API, `videos.batchGetStats` (1 unit) [Y4] |
| X | Impressions, likes, reposts, replies, quotes, bookmarks, link clicks | Followers | Every read costs credits; pulled at 24 h and 7 days only (§18) [X1] |
| TikTok | Views, likes, comments, shares | Followers, likes | Display API basic stats [TT1] |
| LinkedIn | Impressions, clicks, reactions, comments, shares | Followers | Org analytics [LI1] |
| Telegram | View count on channel posts (`views` field when the bot reads the post via forwarded/edited updates); otherwise our short-link clicks | Subscriber count (`getChatMemberCount`) | No channel statistics for bots [T1] |
| Bluesky, Mastodon | Like, repost, reply counts | Followers | No impressions exist |
| WhatsApp, Snapchat (share kit) | Our short-link clicks only | — | — |

Metrics are normalised to a common set where a network supports them: `impressions`, `reach`, `views` (video), `likes`, `comments`, `shares` (reposts/retweets/forwards), `saves`, `clicks` (the network's own link clicks), `followers` (account level), plus `aun_clicks` (our short link) and `aun_views` (views on Al Ummah Now with `traffic_social` for that target). Network-specific extras are kept in `extra_json` and shown on the post detail page.

### 8.3 Dashboards

**Social → Analytics:**

- Range selector (7, 28, 90, 365 days) and account filter.
- Summary cards: posts published, total reach, engagements, link clicks to Al Ummah Now, views on Al Ummah Now from social, follower change.
- **Funnel per network:** impressions → engagements → clicks → views on Al Ummah Now → watch time on Al Ummah Now. This is the number that matters to a creator: what each network sent back.
- Top posts table (sortable by reach, clicks, views on AUN).
- Best times heat map (weekday × hour, from the channel's own data).
- Follower growth per account.
- Every chart has a text summary and a table alternative (#476 §7.2).

**Elsewhere:**

- Studio Analytics → Traffic sources gets the `social` source with a per-network breakdown.
- Video analytics (#476 §4.6) gets a "Social posts" card listing the posts about the video with their clicks and AUN views.
- Post detail shows per-target metrics over time.

Metric retention follows the plan entitlement `analytics.retentionDays` like the rest of Studio Analytics.

## 9. Inbox

### 9.1 Scope per network

| Network | Comments on our posts | Mentions | Direct messages | How |
|---|---|---|---|---|
| Facebook | Read, reply, hide, delete | Page mentions | Messenger (24 h window) | Webhooks (`feed`, `mention`, `messages`) |
| Instagram | Read, reply, hide, delete | @mentions in posts and comments | DMs (24 h window) | Webhooks (`comments`, `mentions`, `messages`) |
| Threads | Read replies, reply, hide | Mentions | — (no DM API) | Webhooks and polling |
| YouTube | Read, reply, hold for review, reject | — | — (YouTube has no DMs) | Polling (`commentThreads.list`, 1 unit; reply 50 units) |
| X | Replies to our posts | Mentions | DMs | Polling; **every read is billed** ($0.005 per post read), so X inbox is off by default and an admin-controlled option with its own budget (§11.5, §18) |
| TikTok | — | — | — | **No API. Externally blocked.** Unblocks if TikTok opens comment APIs to posting apps |
| LinkedIn | Org post comments, reply, delete | Org mentions | — | Polling (Development tier call caps apply) |
| Telegram | Comments in the channel's linked discussion group; reply, delete | — | Messages to the bot are not the channel's DMs; not used | Bot webhook (`message` in the group) |
| Bluesky | Replies, quote posts | Mentions | Chat API exists but needs a separate scope; not used | Polling `listNotifications` |
| Mastodon | Replies | Mentions | Direct-visibility mentions | Polling notifications |
| WhatsApp, Snapchat | — | — | — | No API |

### 9.2 How it works

- **Push first.** Networks with webhooks (Meta: Page `feed`, Instagram `comments`, `mentions`, `messages`; Threads replies; YouTube has none; X account activity is paid) deliver to `POST /api/social/webhooks/{network}`, verified by signature (`X-Hub-Signature-256` for Meta). The handler stores the item and returns 200 within the network's deadline, doing nothing slow inline.
- **Poll the rest**, with the `SocialAccount` DO's alarm: every 5 minutes for accounts with activity in the last day, hourly otherwise, within each network's quota (YouTube comment reads cost 1 unit per call; budgeted in §11.5).
- Items are threads (a post and its comments, or a DM conversation), with states `open`, `done`, `spam`. Assignment to a team member is supported (`assigned_to`).
- **Replies** go out through the same DO as posts, as the connected account. A reply to a DM honours the network's window (Instagram and Messenger: 24 hours after the person's last message; replies outside the window are refused with that reason).
- **Hide and delete** comments on the network where the API allows (Facebook, Instagram, YouTube "hold for review" / reject, Threads hide, Telegram delete in the discussion group). Mastodon and Bluesky can't delete others' replies; the inbox offers mute/block instead.
- **Saved replies:** a per-channel library of canned replies, in both languages.
- **Moderation assist:** incoming items go through the same Workers AI classifier as on-platform comments (`AI-MODERATION.md`) to tag likely spam, scams and abuse; tagged items are sorted into a Filtered view, never auto-deleted.
- **Privacy:** inbox content is personal data of people who aren't our users. It's kept 90 days after the thread is marked done (or 180 days of inactivity), then deleted. It's never used for anything except showing it to the channel team. Authors' network handles and display names are stored; profile photos are loaded live from the network, not copied.

## 10. Architecture

### 10.1 Components

```mermaid
flowchart LR
  subgraph Web["apps/web (Studio)"]
    UI[Social pages]
  end
  subgraph API["apps/api-videos"]
    R["Social routes"]
    CB[OAuth callbacks]
    WH[Webhooks]
    SL["/s/:code redirect"]
  end
  subgraph SCH["apps/scheduler (cron)"]
    C1[every minute: due posts]
    C2[daily: token sweep, metrics, cleanup]
  end
  subgraph PROC["apps/processor"]
    Q[social queue consumer]
    DO[("SocialAccount DO<br/>one per connection")]
    MJ[media jobs]
  end
  DB[(D1 SOCIAL_DB)]
  KV[(KV SOCIAL_OAUTH)]
  R2[(R2 social-media)]
  SS[("Secrets Store<br/>KEK, client secrets")]
  BUN[Bunny Stream]
  CFMT[CF Media Transformations]
  NET[Networks]
  WS[websocket-server]

  UI --> R
  R --> DB
  R --> KV
  CB --> NET
  CB --> DB
  WH --> DB
  WH --> Q
  SL --> DB
  C1 --> DB
  C1 --> Q
  C2 --> Q
  Q --> DO
  DO --> NET
  DO --> DB
  MJ --> BUN
  MJ --> CT["ClipRenderer container<br/>ffmpeg"]
  CT --> R2
  MJ --> CFMT
  MJ --> R2
  DO --> R2
  DO --> SS
  Q --> WS
```

No new Worker is added. Each existing app takes the part that matches what it already does:

| App | New responsibility |
|---|---|
| `api-videos` | Social REST routes for Studio, OAuth start and callbacks, webhooks, Telegram bot webhook, `/s/{code}` redirect, the AT Protocol client metadata document, emitting `SocialTrigger` from Publish now, live state changes and community posts |
| `scheduler` | Minute cron also selects due social targets and sends `SocialPublish`; selects posts for `premiere.starting` triggers. Daily cron (03:00 UTC) sends token-sweep, metrics, retention-cleanup and recurrence-expansion messages. Emits `SocialTrigger` after a scheduled video is published |
| `processor` | Consumer of the new `al-ummah-now-social` queue; hosts the `SocialAccount` and `SocialPlatformBudget` Durable Object classes, the network adapters, and the `ClipRenderer` container class for media jobs; inbox polling via DO alarms |
| `web` | Studio Social pages; `social` traffic source and UTM capture in the analytics helper; `/s/{code}` is served by api-videos through the existing web→API routing |
| `admin-api` / `admin-web` | Platform Social admin (§11) |
| `websocket-server` | Delivers `social_*` events to the channel's Studio sessions (existing per-user socket; no new DO) |

### 10.2 Queue and scheduler

**Queue** `al-ummah-now-social` (and `-stage`, `-qa`), consumer in processor, `max_batch_size` 10, `max_batch_timeout` 5 s, `max_retries` 6, DLQ `al-ummah-now-dlq` (existing). Separate from `al-ummah-now-videos` so a network outage backing up social retries can never delay video processing.

Message types (added to `MessageType` in shared-types):

| Type | Payload | Sent by |
|---|---|---|
| `SocialTrigger` | `{channelId, trigger, sourceId, occurredAt}` | api-videos, scheduler |
| `SocialPublish` | `{targetId, attempt}` | scheduler, api-videos (Publish now) |
| `SocialMediaJob` | `{jobId}` | api-videos (composer), processor (rules) |
| `SocialMetricsPull` | `{accountId, targetIds?}` | scheduler |
| `SocialTokenSweep` | `{accountId}` | scheduler |
| `SocialRevoke` | `{network, revokeHandle}` (handle is an opaque id of an encrypted row kept 24 h for retry, never a token) | api-videos |
| `SocialWebhookItem` | `{network, accountId, itemRef}` | api-videos webhooks |
| `SocialCleanup` | `{kind}` | scheduler |

**Scheduling query.** Due targets are in D1 with an index on `(status, scheduled_at)`. The scheduler reads `status='scheduled' AND scheduled_at <= now + 60s` in pages of 200, flips them to `queued` with a guarded update (`WHERE status='scheduled'`), and sends a message per row. The guard is the lock; the existing `SchedulerLock` DO is not needed for this.

**Why D1 and not the R2 hour buckets** that scheduled videos use: social posts are edited, moved and filtered often (calendar drag, status tabs, approval), need indexes by channel, status and time, and are small rows. D1 fits; R2 objects keyed by hour don't.

### 10.3 The `SocialAccount` Durable Object

One instance per connection, id `idFromName(accountId)`, class in processor.

Responsibilities:

1. **Token custody.** Decrypts tokens on demand, refreshes under its own single-threaded execution (no two refreshes), writes back new ciphertext. Keeps nothing decrypted in storage.
2. **Rate limiting.** Keeps the network's per-account budget (for example Instagram's 100 API-published posts per 24 h, Threads 250 posts per 24 h, X per-user post caps, YouTube per-project units counted in the platform DO below), and the reset times from response headers. Requests over budget are scheduled with an alarm instead of sent.
3. **Long operations.** Chunked uploads and container polling, resumed by alarm after a Worker invocation ends.
4. **Inbox polling** by alarm for networks without webhooks.

A second DO, `SocialPlatformBudget`, one per network per environment, tracks **app-level** budgets shared by all channels: YouTube's 100 `videos.insert` calls and 10,000 units per day per project (reset at midnight Pacific; uploads beyond the day's budget wait for the reset, and the quota extension request is part of rollout), X API credits, Meta app-level rate limit (`X-App-Usage` header), TikTok daily caps. Each `SocialAccount` asks it for a reservation before a costly call. When a budget is nearly exhausted, it degrades in this order: inbox polling, metrics pulls, then (X only) posts with a URL, then manual posts are queued until the reset, and automatic rules last. For X it keeps spend in micro-dollars from each call's price (§18) and checks a reservation against the platform's monthly cap (§11.5) before the call. Publishing a post someone scheduled always comes before reading metrics.

### 10.4 Network adapters

`apps/processor/src/social/adapters/{network}.ts`, each implementing:

```ts
interface SocialAdapter {
  network: SocialNetwork;
  limits: NetworkRules;                                // from shared-types
  refresh(tokens: Tokens): Promise<Tokens>;
  revoke(tokens: Tokens): Promise<void>;
  publish(ctx: PublishContext): Promise<PublishResult>; // may return {pending: containerId}
  checkPending(ctx, containerId): Promise<PublishResult>;
  findRecent(ctx, marker: string): Promise<PublishResult | null>; // for §7.4 step 5
  deletePost(ctx, networkPostId): Promise<void>;
  metrics(ctx, networkPostIds: string[]): Promise<MetricSnapshot[]>;
  accountMetrics(ctx): Promise<AccountSnapshot>;
  inbox?: { poll(ctx, cursor): Promise<InboxPage>; reply(ctx, item, text): Promise<void>; hide?(...); delete?(...) };
  classifyError(err: NetworkError): 'retryable' | 'auth' | 'content' | 'quota';
}
```

Adapters use `fetch` only, with no network SDKs (most don't run on Workers, and they hide rate-limit headers we need). Each adapter has a recorded-fixture test suite (§16.2).

## 11. Platform admin (videos admin)

A **Social** section in admin-web, behind a new admin-api permission `social:manage` (site admins), and `social:review` for the outbound review queue (site moderators). These are videos-side admin permissions in admin-api's role→permission map, not Auth RBAC.

### 11.1 Networks

A table of networks with, per environment:

- **Enabled** (on/off). Off hides the network from the connect list and pauses its scheduled posts (they stay scheduled and go out when it's turned back on, if still within 24 h, otherwise they fail with "network paused by Al Ummah Now"). This is the kill switch for an API outage or a policy change.
- **Features** enabled: publish, automation, analytics, inbox (each can be off independently, for example inbox off while Meta's app review for messages is pending).
- **App status:** which app review / audit stage the network app is at (free text plus a "verified" flag), shown to channels as "Instagram inbox coming once Meta approves our app" rather than hiding the reason.
- **Access level:** `all_channels` or `role_holders_only`. Meta networks are `role_holders_only` until a verified business gets Advanced Access (§2.4). In that mode the connect tile works for channels on the **beta list** and shows the share kit to everyone else, with the text "Facebook posting for all channels needs Meta business verification. Your posts can still go out with the share kit."
- **Meta beta list** (only while `role_holders_only`): channels invited to the closed beta, at most 50 testers per Meta app (Meta's cap for an unverified app [F7]). Staff invite a channel; its owner accepts the beta-tester agreement in Studio and gets the steps to accept Meta's tester invitation, which staff send from the Meta app dashboard by Facebook username; the row shows invited, agreement accepted, Meta role accepted, removed. A monthly review reminder lists testers with no posts in 30 days.
- **Health:** last success, error rate over 1 h and 24 h, open circuit breaker (§14.1).

Stored in `global_settings` (existing R2 bucket used by site settings), cached 60 s by api-videos and processor.

### 11.2 Plan limits

New entitlements in `packages/shared-types/src/entitlements.ts`, edited in the existing plans UI (#427/#428):

| Key | Type | Default | At limit |
|---|---|---|---|
| `social.enabled` | boolean | true | Social hidden |
| `social.accounts.max` | number (accounts per channel) | 10 | Connect refused; existing accounts kept |
| `social.monthlyPosts` | number (targets per channel per month) | 300 | Scheduling refused until next month; automatic rules pause with a notice |
| `social.scheduledPosts.max` | number (pending scheduled targets) | 200 | Scheduling refused |
| `social.automation` | boolean | true | Rules can't be created; existing rules pause |
| `social.inbox` | boolean | true | Inbox hidden |
| `social.analytics.retentionDays` | number | follows `analytics.retentionDays` | Older snapshots hidden, deleted by cleanup |

Limits are the **channel owner's** plan, as #462 §8.

**No per-channel X link allowance.** The earlier draft had `social.x.monthlyLinkPosts` (20 per channel per month). It is dropped (§19, decision 2): the default X post is now native video at $0.015, so links are no longer the normal case, and cost is already bounded twice without it. `social.monthlyPosts` caps one channel at 300 targets a month (at most $60 if every one were an X link post, $4.50 if native), and the platform-wide monthly X cap (§11.5) is a hard stop for everyone. A per-channel link count would only add a third limit for creators to hit. If one channel ever uses an outsized share of the cap, the abuse controls (§11.3) and the per-channel suspend are the tools, not a plan entitlement.

### 11.3 Abuse controls

- **Rate limits** (`RATE_LIMIT_KV`, existing pattern): per channel, 60 targets per hour and 300 per day across networks (below plan limits, for burst control); per user, 20 connect attempts per hour; Telegram link codes 10 per hour per channel.
- **New-channel hold:** channels younger than 7 days or with no published video have outbound posts held for review (§11.4) until a moderator clears the channel once.
- **Link policy:** links in captions must point to Al Ummah Now, or to domains in a platform allow list, or be reviewed. URL shorteners from elsewhere are refused (they hide destinations).
- **Mastodon instance deny list** and **Telegram chat deny list**.
- **Suspend Social for a channel** (staff action): pauses all posts and rules, disconnects nothing, shows a banner with the reason and an appeal link (the existing moderation appeal flow). Audited as `platform_suspended`.
- **Bulk duplicate detection:** the same caption to more than 10 channels' accounts within an hour (by hash) is held for review; this catches spam rings using many channels.

### 11.4 Moderation of outbound posts

Outbound posts carry our name on other networks: our app is the one Meta, TikTok and X see. Each post's caption, images and link destination go through the Workers AI moderation pipeline from `AI-MODERATION.md` (text classifier, image classifier, the Islamic-context rules there) before scheduling and again before sending:

| Result | Action |
|---|---|
| Clean | Proceeds |
| Borderline | Proceeds, flagged in the admin Social review list for spot checks |
| Likely violating (hate, takfir, incitement, scam, adult, graphic violence) | Held. Status `blocked_review`; the channel sees "Held for review by Al Ummah Now". A moderator approves or rejects with a reason in the admin queue |
| Known-bad (hash match, deny-listed link) | Refused at once, `post_blocked_by_moderation` audited |

The source video itself was already moderated when uploaded; outbound moderation covers what's new in the post (captions, uploaded images, clip choice is not re-moderated).

### 11.5 Cost and quota monitoring

The admin Social page shows, per network and environment:

- YouTube Data API units used today vs. the project quota, and the projection.
- X API spend this month vs. the **platform-wide monthly cap** (a number in dollars, edited here by `social:manage`, default $500 (§18), also set as X's own per-billing-cycle spending limit in the developer console so X blocks calls even if our counter is wrong [X1]), split into native posts, posts with a URL and reads, with the top channels by spend.
- Meta, TikTok, Threads app-level usage headers (percent of limit).
- Cloudflare: Media Transformations usage, R2 `social-media` storage, queue operations, DO requests and duration.
- Alerts (existing `cost-monitoring` patterns, `docs/cost-monitoring/`) at 70% and 90% of any budget. For X: at 90% of the cap, posts with a URL pause (the composer offers the same post without the link, and the reason is shown); at 100%, all X posts queue until next month or until an admin raises the cap. Native posts are never paused before link posts.

## 12. Data model

### 12.1 D1: `SOCIAL_DB`

A new D1 database for api-videos and processor, `al-ummah-now-social` (`-stage`, `-qa`), migrations in `apps/api-videos/migrations/social/`, append-only per the CI migration gate, with a schema snapshot like the other databases. Scheduler binds it too (read due targets, flip status).

```sql
-- 0001_social.sql
CREATE TABLE social_accounts (
  id TEXT PRIMARY KEY,                    -- sac_...
  channel_id TEXT NOT NULL,
  network TEXT NOT NULL,                  -- facebook|instagram|threads|youtube|x|tiktok|linkedin|telegram|bluesky|mastodon
  external_id TEXT NOT NULL,              -- page id, ig user id, chat id, did, ...
  external_kind TEXT NOT NULL,            -- page|ig_business|ig_creator|yt_channel|profile|org|tg_channel|tg_group
  instance TEXT,                          -- mastodon instance host, bluesky PDS host
  display_name TEXT NOT NULL,
  handle TEXT,
  avatar_url TEXT,
  language TEXT CHECK (language IN ('ar','en','both')) DEFAULT 'both',
  scopes TEXT NOT NULL,                   -- space-separated, as granted
  features TEXT NOT NULL DEFAULT 'publish', -- publish,analytics,inbox
  status TEXT NOT NULL CHECK (status IN ('active','needs_reconnect','revoked','disconnected','suspended')),
  status_reason TEXT,
  connected_by TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  last_ok_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_sac_unique ON social_accounts (channel_id, network, external_id) WHERE status != 'disconnected';
CREATE INDEX idx_sac_channel ON social_accounts (channel_id, status);
CREATE INDEX idx_sac_external ON social_accounts (network, external_id);  -- webhooks and deauth callbacks

CREATE TABLE social_tokens (
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('access','refresh','page','dpop_key','user_long_lived')),
  kek_version INTEGER NOT NULL,
  wrapped_dek BLOB NOT NULL,
  iv BLOB NOT NULL,
  ciphertext BLOB NOT NULL,
  expires_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, kind)
);

CREATE TABLE social_instance_apps (      -- Mastodon dynamic registrations
  network TEXT NOT NULL,
  instance TEXT NOT NULL,
  client_id TEXT NOT NULL,
  kek_version INTEGER NOT NULL,
  wrapped_dek BLOB NOT NULL,
  iv BLOB NOT NULL,
  client_secret_ct BLOB NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (network, instance)
);

CREATE TABLE social_posts (
  id TEXT PRIMARY KEY,                    -- spo_...
  channel_id TEXT NOT NULL,
  source_kind TEXT CHECK (source_kind IN ('video','short','community_post','live','premiere','none')),
  source_id TEXT,
  rule_id TEXT,                           -- set when generated by a rule
  recurrence_id TEXT,
  base_json TEXT NOT NULL,                -- base caption(s) per language, link, hashtags, media refs
  campaign TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft','awaiting_approval','scheduled','publishing','published','partially_published','failed','cancelled','blocked_review')),
  scheduled_at TEXT,                      -- UTC
  timezone TEXT,                          -- IANA zone chosen
  created_by TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  rejection_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_spo_channel_status ON social_posts (channel_id, status, scheduled_at);
CREATE INDEX idx_spo_source ON social_posts (source_kind, source_id);
CREATE UNIQUE INDEX idx_spo_rule_once ON social_posts (rule_id, source_id) WHERE rule_id IS NOT NULL AND recurrence_id IS NULL;

CREATE TABLE social_targets (
  id TEXT PRIMARY KEY,                    -- stg_...
  post_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  network TEXT NOT NULL,
  short_code TEXT NOT NULL UNIQUE,        -- /s/{code}
  variant_json TEXT NOT NULL,             -- per-network caption, options, media refs; NULL fields follow base
  format TEXT NOT NULL CHECK (format IN ('full','short','link','image','text')),
  media_job_id TEXT,                      -- the export this target posts (full_mp4, full_export, fit_cut, clip, image)
  link_placement TEXT NOT NULL DEFAULT 'none' CHECK (link_placement IN ('none','caption','first_comment','reply')),
  cost_micros INTEGER NOT NULL DEFAULT 0, -- network API cost of this target (X), for §11.5 and §18
  status TEXT NOT NULL CHECK (status IN ('scheduled','queued','sending','pending_network','published','failed','cancelled','unknown','share_kit_reminder')),
  scheduled_at TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  attempt_id TEXT,
  last_error_class TEXT,
  last_error TEXT,                        -- network message, truncated 500 chars, no tokens
  network_post_id TEXT,
  network_container_id TEXT,
  permalink TEXT,
  published_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_stg_due ON social_targets (status, scheduled_at);
CREATE INDEX idx_stg_post ON social_targets (post_id);
CREATE INDEX idx_stg_account ON social_targets (account_id, status);
CREATE INDEX idx_stg_network_post ON social_targets (network, network_post_id);
CREATE UNIQUE INDEX idx_stg_post_account_format ON social_targets (post_id, account_id, format);  -- §6.1.1: one account may take several formats

CREATE TABLE social_media_jobs (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('full_mp4','full_export','fit_cut','clip','image')),
  spec_hash TEXT NOT NULL,                -- hash of the target spec (codec, max resolution, bitrate ceiling, max duration, size cap)
  params_json TEXT NOT NULL,              -- start, end, range mode (start|chapter|most_watched|manual), crop offset, size, letterbox, end card language
  status TEXT NOT NULL CHECK (status IN ('queued','rendering','ready','failed')),
  r2_key TEXT,
  bunny_derived_video_id TEXT,
  bytes INTEGER,
  error TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT                         -- 24 h after the last target using it publishes
);
CREATE INDEX idx_smj_status ON social_media_jobs (status, created_at);
CREATE INDEX idx_smj_reuse ON social_media_jobs (video_id, kind, spec_hash, status);  -- shared exports (§6.6.1)

CREATE TABLE social_rules (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  name TEXT NOT NULL,
  trigger TEXT NOT NULL,
  filters_json TEXT NOT NULL,
  template_json TEXT NOT NULL,            -- base + per-account overrides, each with format, short range mode, X link reply flag
  account_ids TEXT NOT NULL,              -- JSON array
  delay_minutes INTEGER NOT NULL DEFAULT 0,
  use_queue_slot INTEGER NOT NULL DEFAULT 0,
  hold_for_review INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('active','paused')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_srl_channel_trigger ON social_rules (channel_id, trigger, status);

CREATE TABLE social_recurrences (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  template_post_id TEXT NOT NULL,
  rrule TEXT NOT NULL,
  calendar TEXT NOT NULL DEFAULT 'gregory' CHECK (calendar IN ('gregory','islamic-umalqura')),
  timezone TEXT NOT NULL,
  generated_until TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','paused','ended')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE social_slots (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  local_time TEXT NOT NULL,               -- HH:MM in the channel's social timezone
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ssl_account ON social_slots (account_id);

CREATE TABLE social_metrics_daily (
  target_id TEXT,                         -- NULL for account-level rows
  account_id TEXT NOT NULL,
  day TEXT NOT NULL,
  impressions INTEGER, reach INTEGER, views INTEGER, likes INTEGER, comments INTEGER,
  shares INTEGER, saves INTEGER, clicks INTEGER, followers INTEGER,
  extra_json TEXT,
  pulled_at TEXT NOT NULL,
  PRIMARY KEY (account_id, day, target_id)
);

CREATE TABLE social_inbox_threads (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('comment','mention','message')),
  external_thread_id TEXT NOT NULL,
  target_id TEXT,                         -- our post it's under, when known
  author_handle TEXT,
  author_name TEXT,
  last_item_at TEXT NOT NULL,
  reply_window_ends_at TEXT,              -- DMs with a 24 h window
  state TEXT NOT NULL CHECK (state IN ('open','done','spam','filtered')),
  assigned_to TEXT,
  delete_after TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_sit_ext ON social_inbox_threads (account_id, external_thread_id);
CREATE INDEX idx_sit_channel ON social_inbox_threads (channel_id, state, last_item_at);

CREATE TABLE social_inbox_items (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  author_handle TEXT,
  text TEXT,
  media_json TEXT,                        -- URLs on the network, not copies
  ai_label TEXT,
  sent_by TEXT,                           -- our user id for outgoing replies
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_sii_ext ON social_inbox_items (thread_id, external_id);

CREATE TABLE social_saved_replies (
  id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  language TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE social_settings (
  channel_id TEXT PRIMARY KEY,
  approval TEXT NOT NULL DEFAULT 'editors' CHECK (approval IN ('editors','everyone','none')),
  timezone TEXT,
  utm_campaign_default TEXT,
  default_hashtags_json TEXT,
  bilingual_order TEXT NOT NULL DEFAULT 'ar_first' CHECK (bilingual_order IN ('ar_first','en_first')),
  default_formats_json TEXT,              -- per network: full|short|link; NULL = the §6.1.1 preselection
  intro_seconds INTEGER NOT NULL DEFAULT 0, -- skipped by automatic short and fit-cut ranges
  suspended_reason TEXT,                  -- set by platform staff
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE social_meta_beta (         -- §11.1, only used while Meta is role_holders_only
  channel_id TEXT PRIMARY KEY,
  meta_app_env TEXT NOT NULL,             -- qa|stage|production
  status TEXT NOT NULL CHECK (status IN ('invited','agreement_accepted','role_accepted','removed')),
  agreement_version TEXT,
  agreement_accepted_by TEXT,
  agreement_accepted_at TEXT,
  invited_by TEXT NOT NULL,               -- platform:{adminId}
  updated_at TEXT NOT NULL
);

CREATE TABLE social_audit (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,                 -- user id, 'system', or 'platform:{adminId}'
  action TEXT NOT NULL,
  account_id TEXT,
  post_id TEXT,
  detail_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sau_channel ON social_audit (channel_id, created_at);
CREATE INDEX idx_sau_actor ON social_audit (actor_id);
```

Short-link resolution reads `social_targets.short_code` (unique index). Hot codes are cached in the edge cache for 5 minutes (the destination never changes for a code).

### 12.2 R2

| Bucket | Objects | Lifetime |
|---|---|---|
| `social-media` (new, `-stage`, `-qa`), custom domain `media.videos.alummahnow.net` (and env equivalents) | `clips/{jobId}.mp4`, `images/{jobId}.jpg`, `pull/{random128}.{ext}` (pull-URL copies) | Deleted 24 h after the last target using them publishes, or 7 days after creation if never used. Lifecycle rule deletes anything older than 30 days as a backstop |
| `global_settings` (existing) | `social/networks.json` (§11.1) | Permanent |

### 12.3 KV

`SOCIAL_OAUTH` (new): OAuth state (10 min), pick sessions (10 min, encrypted), Telegram link codes (30 min). Nothing else.

## 13. API

### 13.1 Studio routes (api-videos)

All authenticated, `private, no-store`, OpenAPI via chanfana like the existing routes, under `/api/channels/:channelId/social`.

| Method and path | Capability | Purpose |
|---|---|---|
| `GET /accounts` | `social.view` | Connections (no tokens, no scopes for non-`social.connect`) |
| `POST /connect` `{network, instance?, handle?, features[]}` | `social.connect` | Start OAuth; returns `{authorizeUrl}` or, for Telegram, `{code, botUsername, expiresAt}` |
| `POST /connect/pick` `{pickId, targetIds[]}` | `social.connect` | Finish a multi-target connect |
| `POST /accounts/:accountId/reconnect` `{features[]}` | `social.connect` | Re-run OAuth, keeping the connection id |
| `PATCH /accounts/:accountId` `{language?, features?}` | `social.connect` | Account defaults |
| `DELETE /accounts/:accountId` | `social.connect` | Disconnect (§5.7) |
| `GET /posts?status&from&to&accountId&cursor` | `social.view` | Calendar and queue |
| `POST /posts` (body below) | `social.compose` | Create draft or schedule (`intent: draft|submit|schedule|publish_now|queue_slot`) |
| `GET /posts/:postId` | `social.view` | Detail with targets, metrics, history |
| `PATCH /posts/:postId` | `social.compose` (own draft), `social.publish` (scheduled) | Edit, reschedule |
| `POST /posts/:postId/approve` `{scheduledAt?}` | `social.publish`, not the author when policy is `everyone` | Approve |
| `POST /posts/:postId/reject` `{note}` | `social.publish` | Return to author |
| `POST /posts/:postId/cancel` | `social.publish`, or author for own unapproved | Unschedule |
| `DELETE /posts/:postId/targets/:targetId/network` | `social.publish` | Delete the published post on the network |
| `POST /posts/:postId/retry` | `social.publish` | Retry failed targets |
| `POST /validate` (same body as create) | `social.compose` | Dry-run validation for live composer feedback |
| `POST /media-jobs` `{videoId, kind, params}` | `social.compose` | Start a clip or image job |
| `GET /media-jobs/:jobId` | `social.compose` | Job status |
| `GET /best-times?accountId` | `social.compose` | Suggestions (§7.2) |
| `GET/PUT /slots` | `social.settings` | Queue slots |
| `GET/POST/PATCH/DELETE /rules[/:ruleId]` | `social.automate` (`GET`: `social.view`) | Automation |
| `GET/POST/PATCH/DELETE /recurrences[/:id]` | `social.publish` | Recurring posts |
| `GET /analytics?range&accountId` | `social.analytics` | Dashboard data |
| `GET /analytics/posts?range&sort` | `social.analytics` | Top posts |
| `GET /inbox?accountId&kind&state&cursor` | `social.inbox` | Threads |
| `GET /inbox/:threadId` | `social.inbox` | Items |
| `POST /inbox/:threadId/reply` `{text, savedReplyId?}` | `social.inbox` | Reply |
| `POST /inbox/:threadId/items/:itemId/hide` / `delete` | `social.inbox` | Moderate on the network |
| `PATCH /inbox/:threadId` `{state?, assignedTo?}` | `social.inbox` | Triage |
| `GET/POST/PATCH/DELETE /saved-replies[/:id]` | `social.inbox` | Canned replies |
| `GET/PUT /settings` | `social.view` / `social.settings` | Channel settings, including default formats per network |
| `POST /meta-beta/accept` `{agreementVersion}` | Channel owner | Accept the Meta beta-tester agreement (§2.4) |

Create body:

```json
{
  "intent": "schedule",
  "source": { "kind": "video", "id": "vid_123" },
  "base": {
    "captions": { "ar": "محاضرة جديدة: تفسير سورة الكهف", "en": "New lecture: Tafsir of Surah Al-Kahf" },
    "languageMode": "bilingual",
    "link": { "kind": "watch" },
    "hashtags": ["#تفسير", "#Quran"],
    "format": "full"
  },
  "targets": [
    { "accountId": "sac_fb1" },
    { "accountId": "sac_fb1", "variant": { "format": "short", "media": { "jobId": "smj_9" }, "options": { "fbType": "reel" } } },
    { "accountId": "sac_ig1", "variant": { "format": "short", "media": { "jobId": "smj_9" }, "options": { "igType": "reel", "shareToFeed": true }, "firstComment": "#رمضان #تفسير" } },
    { "accountId": "sac_x_ar", "variant": { "format": "full", "fitCut": { "from": "chapter", "chapter": 2 }, "linkReply": false, "captions": { "ar": "تفسير سورة الكهف — محاضرة جديدة" }, "languageMode": "ar" } },
    { "accountId": "sac_tt1", "variant": { "format": "short", "media": { "jobId": "smj_9" }, "options": { "privacy": "PUBLIC_TO_EVERYONE", "allowComment": true, "allowDuet": false, "allowStitch": false, "brandedContent": false } } }
  ],
  "scheduledAt": "2026-11-13T10:30:00Z",
  "timezone": "Asia/Riyadh",
  "campaign": "kahf_series"
}
```

`format` is required per target (from the base when the variant leaves it out); for `full`, api-videos picks `full_mp4`, `full_export` or `fit_cut` and returns the job ids and the fit-cut length in the response, and `/validate` returns the same plan with the X price per target, so the composer can show it before scheduling.

Errors use the existing error envelope. Validation errors are per target: `{ "targets": { "sac_x_ar": [{ "code": "caption_too_long", "limit": 280, "count": 301 }] } }`.

### 13.2 Public and callback routes (api-videos)

| Method and path | Auth | Purpose |
|---|---|---|
| `GET /api/social/oauth/:network/callback` | `state` | OAuth callback (§5.2) |
| `POST /api/social/webhooks/:network` | Network signature | Webhooks, deauthorize and data-deletion callbacks |
| `GET /api/social/webhooks/:network` | Verify token | Meta subscription verification |
| `GET /s/:code` | Public | Short link redirect (§8.1) |
| `GET /.well-known/atproto-client/:env.json` | Public | Bluesky client metadata |
| `GET /api/social/meta/data-deletion/:confirmationCode` | Public | Meta deletion status page |

### 13.3 Admin routes (admin-api)

| Method and path | Permission | Purpose |
|---|---|---|
| `GET/PUT /admin/social/networks` | `social:manage` | §11.1 |
| `GET /admin/social/usage` | `social:manage` | §11.5 |
| `GET /admin/social/review?status` | `social:review` | Held posts |
| `POST /admin/social/review/:postId/approve` / `reject` `{reason}` | `social:review` | Decide |
| `POST /admin/social/channels/:channelId/suspend` / `unsuspend` `{reason}` | `social:manage` | §11.3 |
| `GET /admin/social/channels/:channelId` | `social:manage` | Connections (no tokens), recent posts, audit |
| `GET/PUT /admin/social/deny-lists` | `social:manage` | Instances, chats, domains |
| `GET/PUT /admin/social/x-budget` `{monthlyCapUsd}` | `social:manage` | X monthly cap (§11.5) |
| `GET/POST/DELETE /admin/social/meta-beta[/:channelId]` | `social:manage` | Meta closed-beta list (§11.1) |

admin-api reads `SOCIAL_DB` (bound read-write for review status and suspension only).

### 13.4 Retention

| Data | Kept |
|---|---|
| Tokens | Until disconnect, revocation or channel deletion. Destroyed immediately then |
| Connections (disconnected) | 30 days (to show history), then deleted |
| Posts and targets | Life of the channel, subject to `social.analytics.retentionDays` for metrics |
| Metrics snapshots | `social.analytics.retentionDays` |
| Inbox | 90 days after done, 180 days inactive |
| Media in R2 | §12.2 |
| Audit | 1 year |
| OAuth state, pick sessions, link codes | Minutes (KV TTL) |

## 14. Security and privacy

- **Least privilege:** scopes per feature (§5.3); the KEK only in api-videos and processor; admin-api never sees tokens; tokens never leave the server, never in logs (the logger's redaction list gains `access_token`, `refresh_token`, `client_secret`, `code`, `code_verifier`, `id_token`, `DPoP`).
- **Webhook verification:** Meta `X-Hub-Signature-256` (HMAC-SHA256 with the app secret, constant-time compare), Telegram secret token header, TikTok signature header, Google RISC JWT verification. Unverified requests get 401 and are counted.
- **SSRF:** Mastodon instance and Bluesky PDS hosts are user input. Requests to them go through a guarded fetch: HTTPS only, public DNS only (no private, loopback or link-local ranges, checked after resolution), 10 s timeout, 1 MB response cap, no redirects to other hosts.
- **Open redirect:** `/s/{code}` only redirects to the URL stored for the code, which is always a page on our own domain plus UTM. No query-supplied destinations.
- **CSRF and clickjacking on connect:** connect starts with an authenticated POST; callback is bound to the state's user; the pick page refuses a `pickId` from another user.
- **Content Security Policy:** Studio previews render captions as text only (no HTML from user input), and remote avatars via the existing image proxy.
- **Separation from Auth:** no Auth change. Channel capabilities are checked in api-videos from `CHANNEL_ROLES_DB`; site roles grant nothing here.
- **GDPR:** this processing is on behalf of the channel (controller for its social accounts); Al Ummah Now is processor for the channel's social data and controller for the platform's own logs. `docs/compliance/GDPR.md` gets a Social section: purposes, retention (§13.4), sub-processors (each network, for the data we send it), and the inbox's handling of non-user personal data. The privacy policy names the networks and links to their terms, as Google's API Services User Data Policy and Meta's Platform Terms require.
- **Google's Limited Use** policy: data from YouTube APIs is used only to provide the features the channel sees, never for ads or training, and YouTube data is refreshed or deleted within the 30-day window YouTube's API Developer Policies require for stored API data (metrics snapshots older than 30 days keep only our own aggregates, not raw YouTube responses).

### 14.1 Observability

- **Logs** with the shared logger, prefixes `[SOCIAL:CONNECT]`, `[SOCIAL:PUBLISH]`, `[SOCIAL:DO]`, `[SOCIAL:WEBHOOK]`, `[SOCIAL:MEDIA]`, `[SOCIAL:INBOX]`, carrying `channelId`, `accountId`, `targetId`, `network`, `attempt` and the error class. Never tokens or message text.
- **Metrics** (Analytics Engine, existing client telemetry dataset from #432 or a new `social_ops` dataset): publish attempts, successes, failures by class and network; latency from scheduled time to published; refresh failures; webhook verification failures; queue backlog; DO alarm lag.
- **Circuit breaker per network:** more than 50% failures of class `retryable` over 5 minutes with at least 20 attempts opens the breaker for 10 minutes; targets are delayed, not failed, and the admin page shows it.
- **Alerts:** publish success rate below 95% over 1 h (per network), scheduled-to-published p95 above 5 minutes, DLQ messages from the social queue, token-refresh failures above 5% in a day, any budget above 90%.
- **Status for creators:** each failed target shows the exact reason and a fix ("Reconnect", "Shorten caption", "Retry"), and a network-level incident shows a banner in Social ("Instagram is having problems; posts will retry").

## 15. Configuration and rollout

### 15.1 Bindings

| App | New bindings |
|---|---|
| api-videos | `SOCIAL_DB` (D1), `SOCIAL_OAUTH` (KV), `SOCIAL_QUEUE` (producer), `SOCIAL_MEDIA` (R2), `SOCIAL_TOKEN_KEK` (Secrets Store), per-network client ids/secrets (Secrets Store) |
| processor | `SOCIAL_DB`, `SOCIAL_QUEUE` (consumer and producer), `SOCIAL_MEDIA`, `SOCIAL_TOKEN_KEK`, per-network secrets, DO classes `SocialAccount`, `SocialPlatformBudget`, `ClipRenderer` (container, image built from `apps/processor/containers/clip-renderer/Dockerfile`) and `TelegramBotApi` (container running the official `telegram-bot-api` server, `apps/processor/containers/telegram-bot-api/Dockerfile`), migration tag `social-v1` |
| scheduler | `SOCIAL_DB`, `SOCIAL_QUEUE` (producer) |
| admin-api | `SOCIAL_DB` |
| web | none (calls api-videos) |

All in `wrangler.jsonc`, `wrangler.qa.jsonc` and the stage/production env blocks, checked by the existing wrangler config gate.

### 15.2 Network apps and secrets per environment

One developer app per network per environment where the network allows several (Meta, Google, TikTok, X, LinkedIn: separate QA/stage/production apps so QA can never post with production credentials), with redirect URIs:

| Env | Redirect URI base |
|---|---|
| QA | `https://videos.api.qa.alummahnow.net/api/social/oauth/{network}/callback` |
| Stage | `https://videos.api.stage.alummahnow.net/api/social/oauth/{network}/callback` |
| Production | `https://videos.api.alummahnow.net/api/social/oauth/{network}/callback` |

Secrets Store names (per env store): `social-token-kek`, `social-meta-app-id`, `social-meta-app-secret`, `social-meta-webhook-verify-token`, `social-threads-app-id`, `social-threads-app-secret`, `social-google-client-id`, `social-google-client-secret`, `social-x-client-id`, `social-x-client-secret`, `social-tiktok-client-key`, `social-tiktok-client-secret`, `social-linkedin-client-id`, `social-linkedin-client-secret`, `social-telegram-bot-token`, `social-telegram-webhook-secret`, `social-telegram-api-id`, `social-telegram-api-hash`, `social-bluesky-client-key` (ES256 private key for `private_key_jwt`). Mastodon needs none (dynamic registration).

Meta, TikTok and Google app review is done against the **production** app with a reviewer account on production; QA and stage apps stay in development mode with the test users each network allows (Meta app roles/test users, TikTok sandbox, Google test users, X developer account).

**Who owns the developer accounts with no entity.** Every network app is registered by the platform owner as an individual (Meta developer account, X developer account, Google Cloud project, TikTok developer organisation named "Al Ummah Now", LinkedIn app with the Al Ummah Now LinkedIn Page as its default Page, Telegram bot), with the support email and privacy policy on `alummahnow.net`. When an entity is registered, the Meta app is linked to its verified business portfolio, which moves the app without changing its id, so connections and tokens survive.

### 15.3 Feature flags, build order and review plan

- Flag `social` in app-config (existing `feature-flags.ts`), off by default in production, on in QA. Per-network enabling and access level are the admin switches (§11.1).
- **Before the flag goes on:** MP4 fallback enabled in every Bunny Stream library, and the re-encode job for older videos started (§6.6); the `media.` subdomain verified with TikTok for `PULL_FROM_URL`; a full public website on `alummahnow.net` with privacy policy, terms and data-deletion URL linked from the home page without opening a menu (TikTok's and Google's reviews require it [TT5, Y5]).
- **Build order** (owner priority, §19 decision 1). Everything ships in the first build, each merge behind the flag and complete:
  1. Data model, roles capabilities, token custody, `SocialAccount` and `SocialPlatformBudget` DOs, network switches and access levels.
  2. **Facebook** and **X** adapters (connect, publish in all three formats, delete, metrics, inbox) with the media pipeline they need: `full_mp4`, `full_export` (X spec), `fit_cut`, `clip`, and the Facebook share kit.
  3. Composer and format control (§6.1.1, §17.3), scheduling, queue, rules, notifications.
  4. Telegram (with the `TelegramBotApi` container), Instagram, YouTube, TikTok, Threads, LinkedIn (member and company), Bluesky, Mastodon adapters, in that order.
  5. Analytics, inbox for every network, admin (X budget, Meta beta list).
  The flag is turned on in production when the release E2E suite (§16.3) is green on stage.
- **Review and submission plan** (in priority order, each started the day the first stage build has its screens):

| Network | Submission with no entity | Production state until it passes | With an entity |
|---|---|---|---|
| Facebook | None possible for Advanced Access. Prepare the App Review screencasts and permission write-ups for every §5.3 permission from the beta build, so they're ready | `role_holders_only`: Al Ummah Now's own Pages plus up to 50 beta channels; share kit for everyone else | Business Verification of the entity, then App Review submission (already recorded), then `all_channels` |
| X | None needed. Developer account with a card, X spending limit set to the cap (§11.5) | `all_channels` from day one | — |
| Telegram | None needed | `all_channels` | — |
| Instagram | Same as Facebook (same Meta app, same screencasts) | `role_holders_only` | Same review as Facebook |
| YouTube | Google OAuth verification (homepage, privacy policy, demo video, scope justifications) and the YouTube API audit / quota extension as an individual | `all_channels`, capped at 100 users until verification, and at 100 uploads a day per project until the quota extension | — |
| TikTok | App review, then the Content Posting audit | `all_channels` with posts `SELF_ONLY` (the composer says so) until the audit, then public | — (no company requirement found; if the audit form asks for one, this row moves to "with an entity") |
| Threads | Same as Facebook | `role_holders_only` | Same review as Facebook |
| LinkedIn | Share on LinkedIn (self-serve) for member posting | Member profiles `all_channels`; company Pages switch off, with "Company Pages need LinkedIn's business approval" on the tile | Community Management API, Development tier, then Standard tier |
| Bluesky, Mastodon | None needed | `all_channels` | — |
| Snapchat | None possible | Share kit with Creative Kit Web | Snap Business account and a Public Profile API partner application |
| WhatsApp Channels | None possible | Share kit | No API either way |

- Networks under `role_holders_only` or still in review show their state in the connect list ("Facebook: available to Al Ummah Now beta channels. Everyone else can post with the share kit."), never a dead button. Turning a network to `all_channels` the day a review passes needs no code change.

## 16. Test plan

### 16.1 Unit (vitest)

- `can()` table extended with every `social.*` capability per role (§3.2), and approval policy combinations (§3.3), including "author can't approve own post" under `everyone`.
- Character counting per network (§6.4) against each network's published examples: X weighted counting with Arabic, emoji, URLs; Bluesky graphemes with tashkeel and emoji ZWJ sequences; Mastodon URL weighting.
- Hashtag normalisation (spaces, tashkeel, tatweel, Arabic-Indic digits), bidi isolate insertion.
- Rules for every network in `social-networks.ts`: each hard limit refuses, each soft limit warns.
- Token envelope: encrypt/decrypt round trip, AAD mismatch fails, KEK version rotation, no plaintext in the stored row.
- RRULE expansion with DST changes in `Europe/London` and `America/New_York`, and the Umm al-Qura yearly rule.
- Error classification for every adapter from recorded error fixtures.
- Best-time calculation from synthetic history.
- Format planning (§6.1.1, §6.6.1): for each network and a matrix of source durations, sizes and codecs, the planner picks `full_mp4`, `full_export`, `fit_cut` or `clip` correctly, and the fit-cut length equals the limit minus the end card; X 20-minute and 125-minute limits; Facebook re-plans to a fit cut after a size or length rejection.
- Preselection: every network gets the §6.1.1 format; the channel's `default_formats_json` overrides it; no code path picks `link` unless the person or the channel's default chose it, including after a failed export (asserted by a property test over failure classes).
- X cost: $0.015 for native text and media, $0.20 when any URL is in the text or the link reply is on, summed into `cost_micros`; the 90% cap pauses URL posts before native ones.
- UTM and short-link generation; `/s/{code}` never redirects off-domain.
- SSRF guard: private IPs, IPv6 link-local, DNS rebinding (resolved after redirect refused), oversized responses.

### 16.2 Integration (Workers runtime, `@cloudflare/vitest-pool-workers`)

- Each adapter against a **local mock server** that replays recorded, scrubbed responses from the real API (fixtures recorded once from sandbox/test accounts, stored in `apps/processor/test/fixtures/social/{network}/`), including rate-limit headers, 429s, container polling, chunked upload resumes and token rotation.
- `SocialAccount` DO: concurrent refresh requests produce one refresh; a Worker killed mid-upload resumes from the last chunk; alarm-driven container polling; budget reservations from `SocialPlatformBudget`.
- Publish idempotency: duplicate `SocialPublish` messages produce one post; a crash after the network accepted produces no second post (`findRecent`).
- Webhooks: valid and invalid signatures for Meta, Telegram secret, TikTok; deauthorize destroys tokens.
- Channel deletion and privacy erasure revoke and destroy tokens and delete media (asserted by reading D1 and R2 after).
- `ClipRenderer` against short fixture videos: a fit cut ends on the end card in the post's language (Arabic shaped correctly), an X export meets the X spec (probed with ffprobe), and two jobs with the same `(video_id, kind, spec_hash, range)` render once.
- `TelegramBotApi` container: a 120 MB fixture video posts through the local server; the cloud Bot API is used for files under 50 MB.
- Meta access level: with `role_holders_only`, a channel not on the beta list gets the share kit and the connect endpoint refuses; a beta channel connects after accepting the agreement.

### 16.3 E2E (Playwright)

**QA, against network sandboxes** (release suite, `apps/web/e2e/release/social/*.spec.ts`), using throwaway `@e2e.alummahnow.net` users and dedicated test accounts on each network:

| Network | Test account | What runs on every QA deploy |
|---|---|---|
| Telegram | A private test channel with the QA bot as admin | Connect by code, publish link post and thumbnail, publish a short (cloud Bot API) and a 120 MB whole video (local Bot API server), delete them, inbox reply in the discussion group. **Fully real**: Telegram has no sandbox but a private channel is harmless |
| Bluesky | A test account on a PDS we run for tests, or a dedicated bsky.social account | Connect (OAuth), post with link card, delete |
| Mastodon | A test account on an instance we control (a small GoToSocial/Mastodon on the QA box) | Register app, connect, post, delete |
| Meta (Facebook, Instagram, Threads) | Meta test users and a test Page in the QA app (development mode) | Connect, pick Page, publish to the test Page, Instagram test account Reel from a clip, Threads post; webhook for a comment from a second test user |
| X | The development app's own account | Connect, post a native 10-second video and a text post, delete. A few posts per run (about $0.05) |
| TikTok | Sandbox with target users | Connect, upload a clip; unaudited apps post `SELF_ONLY`, which is what the test asserts |
| YouTube | A test Google account in the QA project's test users | Connect, upload a short private video, delete (1,600+ units; run once a day, not per deploy) |
| LinkedIn | Development app, test Page | Connect, post, delete |

Each spec asserts what the creator sees (status chips, permalink opens, metrics appear after the next pull) and cleans up what it posted.

**Mock mode** for PR previews and local runs: `SOCIAL_MOCK=1` points every adapter at the mock server from §16.2, so PR E2E runs need no network accounts and never post.

**Studio UI** specs (both locales, phone and desktop, all themes, as #476 §9.5):

1. Owner connects Telegram, creates a rule for `video.published`, publishes a video, sees the post in the queue then Published, opens the permalink.
2. Editor composes a bilingual post with a clip and submits; admin approves; post goes out at the scheduled time (clock moved in the mock).
3. Composer refuses an over-long Arabic X caption with the weighted count shown.
3a. Composer preselects the §6.1.1 formats, shows the fit-cut notice for a 40-minute video on X ("20:00 cut"), shows $0.20 only after the X link reply is turned on, and a rule created with a short for Instagram and the whole video for Facebook posts both when a video is published.
4. Calendar drag and keyboard "Move to…" reschedule.
5. Disconnect cancels scheduled posts and shows them as drafts.
6. Moderator sees only Inbox and Calendar, replies to a comment, can't open Compose (route returns no-access).
7. Platform admin turns a network off; the connect button disappears and scheduled posts pause.
8. RTL screenshots of every Social page (visual snapshots, Linux, like the existing suite).

**Release suite on stage** runs the mock-mode Studio specs plus Telegram real-post (cheap, harmless) and one Bluesky post, so every production release proves publishing end to end.

### 16.4 Manual checks before turning on each network in production

Connect, post, delete, metrics appear, reconnect after revoking on the network's own settings page, disconnect revokes on the network side. Recorded in `docs/test-cases/social/`.

## 17. UI

### 17.1 Design direction

Social follows the Studio frame (#476 §4.2, §7) and the theme packages: every surface uses semantic tokens, per-component styling from the active theme package, light and dark. The bar is the sign-in page: depth, layered surfaces, gradients and borders from the theme, not flat grey cards. Network identity appears as small official marks (from each network's brand kit, as their guidelines require) on chips and previews only; the Social pages themselves stay in the channel's theme, never in network colours.

Phone (below 768 px): the Social tabs become a scrollable tab strip under the Studio top bar; the composer becomes a full-screen sheet with steps (Accounts → Write → Media → When) and a sticky bottom bar (Save draft · Next); previews become a swipeable carousel; the calendar defaults to list view.

All screens: en and ar; logical properties; rail and drawer on the right in Arabic; user text `dir="auto"`; handles and URLs `dir="ltr"`.

### 17.2 Accounts

```text
┌ Studio rail ┐┌───────────────────────────────────────────────────────────────┐
│ Dashboard   ││ Social                                        [ + Create post ]│
│ Content     ││ Calendar  Queue  Inbox  Analytics  Automation [Accounts] Settings│
│ Analytics   │├───────────────────────────────────────────────────────────────┤
│ Comments    ││ Connected                                                      │
│▶Social      ││ ┌───────────────────────────────────────────────────────────┐ │
│ Playlists   ││ │ [f] Masjid Al-Noor          Page · Arabic+English  ● Active│ │
│ Custom...   ││ │     Publish · Analytics · Inbox      [Settings] [Disconnect]│ │
│             ││ ├───────────────────────────────────────────────────────────┤ │
│             ││ │ [ig] @masjidalnoor          Business       ▲ Reconnect     │ │
│             ││ │     Token expired on 3 Nov. 2 scheduled posts are waiting.  │ │
│             ││ ├───────────────────────────────────────────────────────────┤ │
│             ││ │ [tg] قناة مسجد النور  t.me/alnoor   Channel  ● Active       │ │
│             ││ └───────────────────────────────────────────────────────────┘ │
│             ││ Add an account                                                 │
│             ││ [f Facebook] [X] [tg Telegram] [ig Instagram] [▶ YouTube]      │
│             ││ [♪ TikTok] [@ Threads] [in LinkedIn] [🦋 Bluesky] [🐘 Mastodon]│
│             ││ Without an API (share kit): [WhatsApp Channels] [Snapchat]     │
│             ││ ♪ TikTok: posts are private until TikTok approves our app      │
│ Settings    ││ 3 of 10 accounts on your plan                                  │
└─────────────┘└───────────────────────────────────────────────────────────────┘
```

Tiles follow the owner's order (Facebook, X, then the rest). For a channel outside the Meta beta while Meta is `role_holders_only` (§2.4), the Facebook, Instagram and Threads tiles open a sheet: "Posting to Facebook for every channel needs Meta to verify Al Ummah Now as a business. Until then, your Facebook posts come with a share kit: the video file and caption ready, and a reminder at the time you pick." with **Use the share kit** as the button.

States: empty ("Connect your first account" with Facebook and X first), connecting (spinner on the tile), pick targets (list of Pages / channels / organisations with checkboxes), limit reached, network paused by Al Ummah Now, waiting for approval, needs reconnect, revoked on network, suspended.

Telegram connect sheet:

```text
┌ Connect Telegram ───────────────────────────────────┐
│ 1  Open your channel → Administrators → Add admin   │
│    Search  @AlUmmahNowBot          [Copy] [Open ↗]   │
│ 2  Allow: ☑ Post messages  ☑ Delete messages        │
│ 3  Post this code in the channel:                   │
│        ┌──────────────┐                             │
│        │ AUN-7Q4K-93  │ [Copy]    expires in 29:41  │
│        └──────────────┘                             │
│    ◌ Waiting for the code…                          │
└─────────────────────────────────────────────────────┘
```

### 17.3 Composer (desktop)

```text
┌ Create post ───────────────────────────────────────────────────────────────────┐
│ From: ▶ تفسير سورة الكهف — الحلقة ٣  (video, published)              [Change]   │
│ Accounts: [✓ f Masjid] [✓ ig @masjid] [✓ X عربي] [✓ X English] [✓ tg] [ ♪ ]      │
├──────────────────────────────────────────┬─────────────────────────────────────┤
│ [Base] [f] [ig] [X عربي] [X EN] [tg]       │ Preview  [f] [ig] [X] [tg]   ◀ ▶     │
│ Language: (•) Both  ( ) العربية  ( ) English│ ┌─────────────────────────────────┐ │
│ ┌ العربية ───────────────────────────────┐│ │ (◉) Masjid Al-Noor · now          │ │
│ │ الحلقة الثالثة من تفسير سورة الكهف…     ││ │ الحلقة الثالثة من تفسير سورة…    │ │
│ └──────────────────────── 212 / 63,206 ─┘│ │ New: episode 3 of the Tafsir…    │ │
│ ┌ English ───────────────────────────────┐│ │ ┌─────────────────────────────┐ │ │
│ │ Episode 3 of our Tafsir of Al-Kahf…     ││ │ │      [ thumbnail 1.91:1 ]   │ │ │
│ └────────────────────────────────────────┘│ │ │ videos.alummahnow.net        │ │ │
│ Link  videos.alummahnow.net/s/k3P9   ⓘ UTM │ │ └─────────────────────────────┘ │ │
│ Hashtags [#تفسير ×] [#Quran ×] [+ suggest] │ └─────────────────────────────────┘ │
│ Format  [ Whole video ][ Short ][ Link post ] │ Approximate preview                 │
│   X عربي: whole video — X allows 20 min,    │                                     │
│   a 20:00 cut ends with "Watch the full…"  │                                     │
│   [From: start ▾]  ☐ Link as reply (+$0.20)│                                     │
│   Cost on X: $0.015                        │                                     │
│ ⚠ X English: 291/280 — shorten by 11       │                                     │
├──────────────────────────────────────────┴─────────────────────────────────────┤
│ When: ( ) Now (•) Schedule [Fri 13 Nov 13:30 ▾] Asia/Riyadh  Best: [Fri 13:30]  │
│       ( ) Next queue slot  ( ) Repeat…                [Fri 21:00] [Sat 20:30]    │
│                                   [Save draft]  [Submit for approval ▸]          │
└──────────────────────────────────────────────────────────────────────────────────┘
```

The primary button reads **Schedule** / **Publish now** for people who can publish, and **Submit for approval** otherwise.

**Format control.** A segmented control with three equal segments (same size, same weight, no "recommended" badge), **Whole video · Short · Link post**, on the Base tab (applies to every network still following base) and on each network tab. Each network's preselection is §6.1.1; a network that can't take a format shows that segment disabled with the reason on hover and focus ("Instagram has no link posts"). Under the control, one line of facts for the selection: the fit-cut length when the whole video won't fit, the expected processing time, where the link goes ("Link in the first comment"), and on X the price. **+ Add another format** under a network tab adds a second target for the same account (for example a Reel next to the Page video). On phone the control sits at the top of the Media step.

Clip editor (opens from Media → Clip):

```text
┌ Clip for Reels, TikTok, Shorts ─────────────────────────────────────┐
│ ┌───────────┐   Start 12:04  End 12:49   Length 45 s (max 90 s)       │
│ │ ┌───────┐ │   ◀── crop position ──▶   [Centre]  ( ) Blur background   │
│ │ │ 9:16  │ │   [◀ 1 s] [1 s ▶] keyboard: ←/→ moves crop                │
│ │ └───────┘ │   ▕▔▔▔▔▔▔▔▔▔▔▔[████]▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▏ timeline        │
│ └───────────┘   Captions: ☑ burn in  [العربية ▾]  (from the subtitles) │
│                                      [Cancel]  [Make clip]            │
└──────────────────────────────────────────────────────────────────────┘
```

The caption language list shows only languages the video has subtitles for; with none, the checkbox is replaced by "Add subtitles to burn in captions" linking to the video editor.

### 17.4 Composer (phone)

```text
┌──────────────────────────┐   ┌──────────────────────────┐   ┌──────────────────────────┐
│ ✕  Create post   1/4     │   │ ←  Write          2/4    │   │ ←  When           4/4    │
│ Accounts                 │   │ [Base][f][ig][X][tg] ▸   │   │ (•) Schedule             │
│ ☑ f  Masjid Al-Noor      │   │ ┌──────────────────────┐ │   │ Fri 13 Nov · 13:30       │
│ ☑ ig @masjidalnoor       │   │ │ الحلقة الثالثة…      │ │   │ Asia/Riyadh              │
│ ☑ X  عربي                │   │ └────────────── 212 ─┘ │   │ Best: [13:30] [21:00]    │
│ ☐ X  English             │   │ ┌──────────────────────┐ │   │ ( ) Now                  │
│ ☑ tg قناة مسجد النور     │   │ │ Episode 3 of…        │ │   │ ( ) Next slot            │
│                          │   │ └──────────────────────┘ │   │ ( ) Repeat…              │
│                          │   │ [Preview ▸]              │   │                          │
├──────────────────────────┤   ├──────────────────────────┤   ├──────────────────────────┤
│ [Save draft]    [Next ▸] │   │ [Save draft]    [Next ▸] │   │ [Save draft] [Submit ▸]  │
└──────────────────────────┘   └──────────────────────────┘   └──────────────────────────┘
```

### 17.5 Calendar

```text
┌ Calendar ─────────────────────────────── [Month|Week|List]  ◀ November 2026 ▶  [All accounts ▾] ┐
│  Sat 7        Sun 8        Mon 9        Tue 10       Wed 11       Thu 12        Fri 13           │
│  ٢٦ جمادى…    ٢٧           ٢٨           ٢٩           ١ رجب        ٢             ٣                │
│ ┌─────────┐               ┌─────────┐                ▶ Video      ┌─────────┐  ┌─────────┐      │
│ │✓ 20:30  │               │◷ 09:00  │                  premiere   │! 21:00  │  │◷ 13:30  │      │
│ │ f ig tg │               │ X X     │                  20:00      │ ig Failed│  │ f ig X tg│     │
│ │Published│               │Awaiting │                             │Reconnect │  │Scheduled │     │
│ └─────────┘               └─────────┘                             └─────────┘  └─────────┘      │
│ Legend: ✓ Published  ◷ Scheduled  ⧗ Awaiting approval  ! Failed  ▶ Video/premiere (read-only)    │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 17.6 Queue and post detail

```text
┌ Queue ─ [Drafts 3] [Awaiting 2] [Scheduled 14] [Published] [Failed 1] ───────── [Search…] ┐
│ ☐  When              Post                                  Accounts      By       Status  │
│ ☐  Fri 13 Nov 13:30  تفسير سورة الكهف — الحلقة ٣            f ig X tg     Bilal    ⧗ Awaiting│
│                                                                        [Approve] [Return] │
│ ☐  Fri 13 Nov 21:00  Khutbah clip: patience                 ig ♪ ▶       Rule     ◷ Sched. │
│ ☐  Thu 12 Nov 21:00  Live now: Tafsir Q&A                   ig           Nour     ! Failed │
│                      Instagram: reconnect @masjidalnoor        [Reconnect] [Retry]         │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

Post detail: preview per target, status timeline (created → submitted → approved → scheduled → published, with who and when), permalink per target, metrics chart per target, Delete on network, Duplicate.

### 17.7 Inbox

```text
┌ Inbox ─ [All accounts ▾] [Comments] [Mentions] [Messages]   Open 12 · Done · Filtered 3 ┐
│ ┌ Threads ───────────────────────┐┌ ig · comment on "Khutbah clip: patience" ─────────┐ │
│ │● ig  Ahmad: جزاكم الله خيرا…   ││ Ahmad (@ahmad_k) · 2 h                              │ │
│ │  f   Sara: When is the next…   ││ جزاكم الله خيرا، متى الدرس القادم؟                 │ │
│ │  X   @omar: @masjid link pls   ││                                                     │ │
│ │  tg  Yusuf: is there audio?    ││ ─────────────────────────────────────────────────── │ │
│ │                                ││ Reply as @masjidalnoor                              │ │
│ │                                ││ ┌───────────────────────────────────────────────┐   │ │
│ │                                ││ │ وإياكم، الدرس القادم الجمعة بعد العشاء…       │   │ │
│ │                                ││ └───────────────────────────────────────────────┘   │ │
│ │                                ││ [Saved replies ▾] [Hide] [Delete]  [Done] [Send ▸]   │ │
│ └────────────────────────────────┘└─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

On phone the thread list and the thread are two screens.

### 17.8 Analytics

```text
┌ Social analytics ─ [28 days ▾] [All accounts ▾] ─────────────────────────────────────────┐
│ ┌Posts──┐ ┌Reach────┐ ┌Engagements┐ ┌Clicks to AUN┐ ┌Views on AUN┐ ┌Followers┐            │
│ │  46   │ │ 182,400 │ │  9,310    │ │   3,904     │ │   2,811    │ │ +1,204  │            │
│ └───────┘ └─────────┘ └───────────┘ └─────────────┘ └────────────┘ └─────────┘            │
│ What each network sent back                                                             │
│ Network   Impressions  Engagements  Clicks  Views on AUN  Watch time                    │
│ Facebook      96,000        4,100     1,920        1,410      212 h   ███████████        │
│ Telegram           —            —     1,050          880      190 h   ███████            │
│ Instagram     61,000        4,600       410          300       31 h   ██                 │
│ X             25,400          610       524          221       18 h   █                  │
│ [Top posts table]   [Best times heat map]   [Follower growth]   [View as table]          │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### 17.9 Automation and settings

```text
┌ Automation ───────────────────────────────────────────────── [+ New rule] ┐
│ ● When a video is published → f ig X tg   after 0 min   Active  [Edit] [Pause]│
│   Only public · Arabic and English · f X tg: whole video · ig: short (start)  │
│ ● 15 min before a premiere → f X tg                     Active  [Edit] [Pause]│
│ ○ When I go live → ig f                                  Paused  [Edit] [Resume]│
└───────────────────────────────────────────────────────────────────────────────┘
```

Rule editor, the per-account format step:

```text
┌ When a video is published › Accounts and formats ────────────────────────────┐
│ Account            Format                                  Options            │
│ f  Masjid Al-Noor  [ Whole video ][ Short ][ Link post ]   Link in caption ☑  │
│ X  عربي            [ Whole video ][ Short ][ Link post ]   Over 20 min: cut   │
│                                                             from [start ▾]     │
│                                                             ☐ Link as reply    │
│                                                               (+$0.20 a post)  │
│ ig @masjidalnoor   [ Whole video ][ Short ][ — ]           Short from         │
│                                                             [chapter 1 ▾] 60 s │
│ tg قناة مسجد النور [ Whole video ][ Short ][ Link post ]   Link in caption ☑  │
│ Preselected from your channel defaults (Settings → Default formats)            │
└───────────────────────────────────────────────────────────────────────────────┘
```

```text
┌ Social settings ─────────────────────────────────────────────────────────────┐
│ Approval        (•) Editors' posts need approval  ( ) Every post  ( ) None    │
│ Time zone       [Asia/Riyadh ▾]                                               │
│ Bilingual order (•) Arabic first  ( ) English first                           │
│ Default hashtags [#مسجد_النور ×] [+]                                          │
│ Campaign name   [aun_social]   Links use UTM tags so Analytics can count them │
│ Queue slots     Sat–Thu 08:00, 20:00 · Fri 13:30          [Edit slots]        │
│ Default formats f Whole · X Whole · tg Whole · ig Short · ▶ Whole · ♪ Short   │
│                 [Edit]   Intro to skip in automatic cuts [ 0 s ]              │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 17.10 Strings

All new strings go in `packages/shared-types/src/i18n-static` under `social.*`, reviewed by a native Arabic speaker (#476 §7.1). Network names stay in their official Latin form in Arabic UI (Facebook, Instagram, X, Telegram, TikTok), wrapped in `dir="ltr"` isolates inside Arabic sentences, matching how Arabic users see them in the apps.

## 18. Cost estimate

Recomputed for native video by default (§19, decisions 2 and 3). Assumptions for a first year: **1,000 channels** using Social, 4 connected accounts each, **60 targets per channel per month** (60,000 targets), 15% of them to X (9,000), of which **10% carry a link** by the person's choice (a link post, or the watch link as a reply) and 90% are native video with no URL. 10,000 shorts a month averaging 45 s. 40,000 whole-video uploads to networks a month at ~300 MB each, of which 15,000 are fit cuts and 3,000 need a real transcode (the rest are Bunny renditions copied as is, §6.6).

| Item | Unit price | Monthly volume | Monthly cost |
|---|---|---|---|
| **X native video or text posts** (no URL) | $0.015 per post [X1] | 8,100 | **$122** |
| X posts with a URL (link posts, or a native post plus the link reply: the reply is the billed post) | $0.20 per post [X1] | 900 | $180 |
| X media upload (`initialize`/`append`/`finalize`) | No price is listed on X's pricing page; treated as free and watched on the X usage line in admin (§11.5) [X1] | ~8,100 videos | $0 (to confirm on the first invoice) |
| X metrics reads (2 pulls per post) | $0.005 per post read | 18,000 | $90 |
| **X total** | | | **≈ $390** (it was ≈ $1,890 when every auto-post was a link) |
| YouTube, Meta (Facebook, Instagram, Threads), TikTok, LinkedIn, Telegram, Bluesky, Mastodon APIs | Free | — | $0 |
| Cloudflare Containers, shorts | ~$0.00002 per vCPU-second plus memory [CF2] | 10,000 × ~60 vCPU-s | ~$15 |
| Cloudflare Containers, fit cuts (stream copy) | same | 15,000 × ~10 vCPU-s | ~$3 |
| Cloudflare Containers, whole-video transcodes | same, on the largest instance | 3,000 × ~1,200 vCPU-s plus memory | ~$100 |
| `TelegramBotApi` container (sleeps when idle) | same | a few hours a day of uploads | ~$10–30 |
| Media Transformations (frames, thumbnails) | $0.50 per 1,000 units, 5,000 free [CF1] | ~30,000 frames | ~$13 |
| Bunny egress for whole-video uploads | ~$0.005–0.01 per GB | ~12 TB | ~$60–120 |
| R2 `social-media` (24 h lifetime) | $0.015/GB-month + operations | ~500 GB average, ~400k ops | ~$10 |
| Queues, D1, Durable Objects, Workers requests | Workers Paid usage | ~500k queue ops, ~5M DO requests | ~$10–20 |
| Workers AI (outbound moderation and inbox triage) | 10,000 free neurons/day, then $0.011 per 1,000 | Mostly within free tier | ~$0–10 |
| **Total without X** | | | **≈ $230–330 per month** |
| **Total with X** | | | **≈ $620–720 per month** |

What changed: native video makes X about five times cheaper per post, and moves cost to video handling (Bunny egress and containers), which grows with whole-video uploads, not with links. Copying Bunny renditions instead of encoding (§6.6) keeps the container line around $120; encoding every whole video would cost roughly ten times that.

**X spend control** is one platform-wide monthly cap in admin (§11.5), with X's own spending limit set to the same figure. At the volume above X costs ≈ $390 a month including reads, so the cap's default is **$500**, which covers this volume with headroom; admins change it at any time. The per-channel link allowance is gone (§11.2 says why).

## 19. Decisions and open questions

### 19.1 Owner decisions, 2026-11-09 (US Eastern)

| # | Question | Decision | Where the spec applies it |
|---|---|---|---|
| 1 | Network priority | **Facebook and X first**, then the rest in the order recommended earlier: Telegram, Instagram, YouTube, TikTok, Threads, LinkedIn, Bluesky, Mastodon (share kits for WhatsApp Channels and Snapchat) | §2.2 row order, §5.1 connect order, §15.3 build order and review plan, §17.2 connect list |
| 2 | X link-post cost | *"Why links? Export whole video, make short export if need be and so on."* The default on X, and everywhere, is the **video itself posted natively**: the whole video where the network allows it (X: 20 min, 125 min for Premium accounts), an automatic fit cut when it doesn't, shorts when wanted. On X the watch link is an opt-in reply that shows its $0.20 price. One platform-wide monthly X cap in admin (default $500); the per-channel 20-link-post allowance is dropped. X inbox reads stay off by default and count against the same cap when an admin turns them on | §6.1.1, §6.3, §6.6, §10.3, §11.2, §11.5, §18 |
| 3 | Default for auto-posts | *"Both, and the user can choose."* Every rule and every manual post offers **Whole video, Short and Link post** per account, with a per-network preselection (the video itself wherever the network takes video) and channel-level defaults. No hidden bias toward links: equal controls, no automatic fallback to a link | §6.1.1, §7.3, §12 (`format`, `default_formats_json`), §17.3, §17.9 |
| 4 | Legal entity | **No entity exists.** The spec ships everything that works without one: X, Telegram, YouTube, TikTok (public after its audit, which needs no company), LinkedIn member profiles, Bluesky and Mastodon for every channel. Facebook, Instagram and Threads publish for Al Ummah Now's own accounts and a closed beta of up to 50 channels, with a share kit for every other channel. The Meta review material is prepared so that an entity only needs verifying | §2.2, §2.4, §6.8, §11.1, §15.2, §15.3 |

### 19.2 Open question

1. **Register a business so Facebook works for every channel?** Facebook is the first priority, and Meta allows publishing to other people's Pages (and Instagram and Threads accounts) only with Advanced Access, which needs Business Verification of a registered business (§2.4). Without it, Facebook reaches Al Ummah Now's own Pages and at most 50 beta channels. The same registration would also unlock LinkedIn company Pages and an application to Snapchat's Public Profile API. *Recommended:* register the smallest entity Meta's Business Verification accepts in your country of residence (a sole proprietorship or single-member company is often enough; Meta's accepted documents vary by country and couldn't be confirmed from an official page, so check Meta Business Help's list for your country before choosing). Then verify it in a Meta business portfolio with you as admin, and submit the prepared App Review the same week. Until then, the no-entity path in §2.4 is what ships.

## 20. Sources

All accessed 2026-11-09 unless a date is given. [2°] marks a secondary source used where no official page was available.

**YouTube**
- [Y1] YouTube Help, schedule Posts and channel permissions — https://support.google.com/youtube/answer/9409631
- [Y2] YouTube Data API `videos.insert` — https://developers.google.com/youtube/v3/docs/videos/insert
- [Y3] YouTube Data API quota costs — https://developers.google.com/youtube/v3/determine_quota_cost
- [Y4] YouTube Data API revision history (2025-12-04 quota change, 2026-06-01 upload bucket, 2026-06-03 `videos.batchGetStats`, 2026-11-02 unverified-app rule lifted, 2026-11-03 Shorts thumbnails) — https://developers.google.com/youtube/v3/revision_history
- [Y5] Google OAuth app verification for sensitive scopes (homepage, privacy policy, demo video; no company requirement stated) — https://support.google.com/cloud/answer/13464321
- [Y6] YouTube API Services audit and quota extension form ("As an individual user", "Independent Developer/Sole Proprietor") — https://support.google.com/youtube/contact/yt_api_form ; quota and audits — https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits
- [Y7] Unverified apps (warning screen, 100-user cap) — https://support.google.com/cloud/answer/7454865

**X**
- [X1] X API pricing (pay-per-use, $0.015 per post, $0.20 with URL) — https://docs.x.com/x-api/getting-started/pricing ; move to pay-per-use 2026-02-06 [2°] gigazine 2026-02-09
- [X2] OAuth 2.0 Authorization Code with PKCE — https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code
- [X3] Rate limits and chunked media upload — https://docs.x.com/x-api/fundamentals/rate-limits ; https://docs.x.com/x-api/media/quickstart/media-upload-chunked
- [X4] Counting characters and twitter-text v3 config — https://docs.x.com/fundamentals/counting-characters ; https://raw.githubusercontent.com/twitter/twitter-text/master/config/v3.json
- [X5] Video limits (`tweet_video` 0.5 s–20 min / 8 GB; Premium or verified 125 min / 16 GB), specs, and the long-video 403 — https://docs.x.com/x-api/media/quickstart/media-upload-chunked ; https://docs.x.com/x-api/media/quickstart/best-practices ; `subscription_type` and `verified_type` — https://docs.x.com/x-api/users/get-my-user . No page shows an updated date; prices "subject to change". Media upload has no price row on the pricing page

**Meta**
- [F1] Pages API posts and permissions — https://developers.facebook.com/docs/pages-api/posts
- [F2] Reels publishing — https://developers.facebook.com/docs/video-api/guides/reels-publishing
- [F3] Long-lived tokens — https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived ; Business Verification timing: no official figure; reports range from days to several weeks [2°]
- [F4] Video API publishing and `/{page-id}/videos` reference (no size or duration limit stated for Page video) — https://developers.facebook.com/docs/video-api/guides/publishing ; https://developers.facebook.com/docs/graph-api/reference/page/videos/
- [F5] Access levels ("Business Verification is required to get Advanced Access"; Standard Access only for app users with a role) — https://developers.facebook.com/docs/graph-api/overview/access-levels/ ; permissions reference — https://developers.facebook.com/docs/permissions ; Business Verification — https://developers.facebook.com/docs/development/release/business-verification ; announcement 2023-02-01 — https://developers.facebook.com/blog/post/2023/02/01/developer-platform-requiring-business-verification-for-advanced-access/
- [F6] Tech Providers (restricted permissions include `pages_manage_posts`, `publish_video`, `instagram_business_content_publish`, `threads_content_publish`) — https://developers.facebook.com/docs/development/release/tech-providers ; Access Verification retired, 2026-10-09 — https://developers.facebook.com/blog/post/2026/10/09/retiring-access-verification-for-tech-provider-apps ; Facebook Login for Business needs a business portfolio — https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business
- [F7] App roles (tester policy; 50 testers without a verified business, 500 with one; up to 500 admins) — https://developers.facebook.com/docs/development/build-and-test/app-roles
- [F8] Individual developer verification, 2018-12-10 (up to three Pages) — https://developers.facebook.com/blog/post/2018/12/10/verification-for-individual-developers/ ; superseded by the 2023 Business Verification rule [F5]
- [I1] Instagram content publishing — https://developers.facebook.com/docs/instagram-platform/content-publishing
- [I2] Instagram API with Instagram Login and business login tokens — https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login ; https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login
- [I3] IG User media reference (specs) — https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
- [I4] Instagram Platform overview (Business Verification for Advanced Access to accounts you don't own) — https://developers.facebook.com/docs/instagram-platform/overview
- [TH1] Threads API overview — https://developers.facebook.com/docs/threads/overview
- [TH2] Threads insights — https://developers.facebook.com/docs/threads/insights
- [W1] WhatsApp Channels have no API — https://developers.secure.facebook.com/community/threads/839137344932813 ; [2°] whapi.cloud, getkanal (2026)
- [M1] Meta Business Suite features [2°] Buffer guide
- [MP1] Oversight Board policy advisory opinion on "shaheed" (March 2024) — https://www.oversightboard.com/?p=27868

**TikTok**
- [TT1] Content Posting API, get started (updated 2026-08-04) — https://developers.tiktok.com/doc/content-posting-api-get-started
- [TT2] Direct Post reference (updated 2026-10-27) — https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
- [TT3] Media transfer guide (updated 2026-08-04) — https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide
- [TT4] Content sharing guidelines (updated 2026-08-04) — https://developers.tiktok.com/doc/content-sharing-guidelines ; audit duration and unaudited 5-user cap [2°]
- [TT5] App review guidelines (full public website, privacy policy and terms visible; "Apps must not be for private or personal use"; updated 2026-08-04) — https://developers.tiktok.com/doc/app-review-guidelines
- [TT6] Organizations (a name, no business verification; updated 2026-08-04) — https://developers.tiktok.com/doc/working-with-organizations ; sandbox (updated 2026-08-04) — https://developers.tiktok.com/doc/add-a-sandbox

**Others**
- [T1] Telegram Bot API (10.4) — https://core.telegram.org/bots/api
- [T2] Telegram Bots FAQ (limits) — https://core.telegram.org/bots/faq
- [T3] Local Bot API server (uploads up to 2,000 MB; needs `api_id`/`api_hash`) — https://github.com/tdlib/telegram-bot-api ; https://core.telegram.org/bots/api#using-a-local-bot-api-server ; creating a bot — https://core.telegram.org/bots/features
- [LI1] LinkedIn increasing access, Community Management tiers (2026-10-14) — https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access
- [LI2] LinkedIn Posts API — https://learn.microsoft.com/en-us/linkedin/marketing/integrations/community-management/shares/posts-api
- [LI3] Getting access, Open Permissions incl. `w_member_social` (updated 2026-06-03) — https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access
- [LI4] Share on LinkedIn (150 requests per member per day; updated 2023-12-14) — https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin ; every app needs a LinkedIn Page — https://www.linkedin.com/help/linkedin/answer/a548360
- [LI5] Community Management App Review ("only available to registered legal organizations"; updated 2026-02-11) — https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review
- [BS1] Bluesky rate limits — https://raw.githubusercontent.com/bluesky-social/bsky-docs/main/docs/advanced-guides/rate-limits.md
- [BS2] Bluesky `app.bsky.video.getUploadLimits` — https://docs.bsky.app/docs/api/app-bsky-video-get-upload-limits ; video length and size increases in August 2026 [2°, unverified]
- [MA1] Mastodon statuses API — https://docs.joinmastodon.org/methods/statuses/
- [MA2] Mastodon rate limits — https://docs.joinmastodon.org/api/rate-limits/
- [MA3] Mastodon app registration (public, no review) — https://docs.joinmastodon.org/methods/apps/
- [BS3] AT Protocol OAuth (client metadata published by the app, no pre-registration) — https://atproto.com/specs/oauth
- [S1] Snapchat Public Profile API — https://developers.snap.com/api/marketing-api/Public-Profile-API/Introduction ; allowlist-only [2°]
- [S2] Snap Creative Kit and Spotlight — https://snapkit.com/news/extending-creative-kit-into-spotlight
- [S3] Creative Kit Web ("No special setup required") — https://developers.snap.com/snap-kit/creative-kit/web
- [S4] Public Profile API, get started (allowlist; Snap Business / Organization account) — https://developers.snap.com/api/marketing-api/Public-Profile-API/GetStarted

**Tools**
- [B1] Buffer pricing — https://buffer.com/pricing
- [H1] Hootsuite plans — https://www.hootsuite.com/plans
- [H2] Hootsuite new features, April 2026 — https://blog.hootsuite.com/new-features-apr-2026/
- [L1] Later pricing — https://later.com/pricing/
- [MC1] Metricool [2°] — https://metricool.com/de/beste-zeit-fuer-facebook-posts/ ; https://releasebot.io/updates/metricool (September 2026)
- [P1] Publer features [2°] Publer blog

**Audience and timing**
- [D1] DataReportal, Digital 2026 country reports (Saudi Arabia, UAE, Egypt, Indonesia, Pakistan, Turkey, Malaysia), published November 2025 — https://datareportal.com/reports/digital-2026-saudi-arabia (and the matching country URLs). Digital 2027 editions are starting to appear and should replace these figures when complete.
- [R1] Arab News, Ramadan engagement in Saudi Arabia (March 2026) — https://www.arabnews.pk/node/2636507
- [R2] Asharq Al-Awsat on Facebook Ramadan data (c. 2019–20, dated) — https://english.aawsat.com/home/article/1743016/ramadan-middle-east-fasting-and-facebook-data-shows

**Media**
- [CF1] Cloudflare Media Transformations (limits, pricing) — https://developers.cloudflare.com/stream/transform-videos/ ; open beta announcement 2025-03-07 — https://blog.cloudflare.com/media-transformations-for-video-open-beta/
- [CF2] Cloudflare Containers — https://developers.cloudflare.com/containers/ (pricing and status to be rechecked when the build starts)
- [BN1] Bunny Stream storage structure (MP4 fallback URLs) — https://bunny.net/docs/stream-video-storage-structure
- [BN2] Bunny Stream security and token authentication; changelog — https://bunny.net/docs/stream/security ; https://bunny.net/docs/stream/changelog
