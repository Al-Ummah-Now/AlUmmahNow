# Core Web Experience Completion

**Status:** Draft v1 for review
**Date:** 2026-11-07
**Epic:** 29 (Core web experience completion)
**Why:** Channels, posting, commenting, profiles, reactions, search and the main browse pages were
never owned by an epic. Epics 1–8 cover compliance, analytics, i18n and selected features; native
Epics 9–24 describe apps. Many core flows were broken or stubbed (stories audit, Nov 2026).
PR #163 fixed a large part; this epic tracks **everything needed for a complete web product**,
which the native apps (Epic 12) then reuse through the same APIs.

Each story must ship in **en + ar (RTL)**, meet **Epic 1** accessibility, declare **entitlements**
(Epic 27), and have **E2E coverage** against QA. Status below reflects `integrate/qa-features` (#163).

---

## 1. Status by area

| Area | Done in #163 | Remaining gaps |
|---|---|---|
| **Channels** | Create/edit, avatar/cover, tabs config, sections (real data for events/featured/subscriptions), Channels tab, owner channel listing fixed, anonymous listing fixed | `@handle` URLs and handle uniqueness; channel About (links, contact, location, joined date, totals); channel trailer for non-subscribers; featured channels management UI; section types for events/featured not allowed by API enum; channel verification badge (Epic 21.3); channel deletion/transfer; team roles (native 19.6) |
| **Posting (community)** | Create text/poll posts (create was broken, fixed), Community tab shows posts, likes, poll voting, comments, pin/heart, replies | Image/GIF posts end-to-end check; scheduled posts; edit/delete UI for creators; post detail page with share URL; quiz posts; mentions; post notifications to subscribers |
| **Commenting** | List endpoint, real authors, ownership on edit/delete, reactions wired correctly, "load more", report | Live updates for other viewers (broadcast exists via realtime; UI subscription to verify); sort top/newest UI; replies UI on video comments (API supports 1 level); edited indicator; creator moderation (hide, block user, held-for-review) in Studio; mentions & timestamps (`12:34` links); comment settings per video (off / held / on) |
| **Profiles** | Create/edit, labels fixed, empty heading fixed, multi-account switching, privacy page (export/delete) | **Public profile page** (avatar, bio, public playlists, subscriptions if public); privacy controls (hide subscriptions/likes); account settings consolidation (email, password via auth profile app, sessions, connected devices) |
| **Likes & reactions** | Video like/dislike, comment like/dislike, post likes; counts update via realtime | **Liked videos** page; dislike count visibility policy (hide public dislike counts?); reaction rate-limits; undo states consistent across pages |
| **Subscriptions** | Subscribe/unsubscribe fixed, status endpoint, subscription feed page, manage subscriptions | Notification bell per channel (all / highlights / none); "new since last visit" markers; subscriptions sidebar with live/new dots; sort/filter in manage page |
| **Search** | Search page, suggestions/trending/recommendations real (no mocks), hidden content filtered, page 2 fixed | **Filters UI** (type: video/channel/playlist/post; duration; upload date; language; category; scholar-verified); Arabic normalisation (diacritics, hamza/alef forms, taa marbuta) in matching; search in channel; result types beyond videos; "did you mean"; search history (private, clearable); scalable index (current scan of ≤1000 objects won't scale: needs a search index, see §3) |
| **Home** | Sections real, Load More fixed, thumbnails placeholders, finite rails | Personalised rails ordering; "Continue watching" rail; category chips; hide/"not interested" feedback; learning paths rail (Epic 21.5) |
| **Explore** | – | **New page**: Trending (by region/language), categories (Tafsir, Hadith, Seerah, Fiqh, Recitation, Nasheeds, Kids…), Live now, New channels, seasonal (Ramadan) |
| **Library** | History page (remove/clear), playlists page, downloads n/a on web | **Library hub** page: History, Watch later, Liked videos, Playlists, Saved posts; **Watch later** (system playlist) with quick-add on cards |
| **Notifications** | Realtime toasts for comments/subscribers/processing (from #163) | **Notification center** (bell + inbox page, read/unread, persistence), settings per category, email digests (opt-in), push (native Epic 9.4) |
| **Watch page** | Player, chapters, subtitles, save to playlist, report, comments, related | Description with chapters/timestamps parsing, "Show more", hashtags/tags links, share at time (Epic 25), up-next autoplay toggle (off default), theater mode, mini-player when browsing |
| **Lamahat (shorts)** | Shorts tab on channels (≤60 s) | Dedicated vertical viewer page with finite daily stack (native 12.4 on web) |
| **Playlists** | Page, create/edit/delete, save to playlist, reorder | Play-all queue across the playlist (currently opens first video only), shuffle/loop, collaborative playlists (later), playlist visibility (public/unlisted/private) checks |
| **Live** | Live page lists streams (500 fixed), anonymous access fixed, realtime status | Live watch page `/live/{id}` (links 404), chat, premieres; real provider (decision D3) |

---

## 2. Stories

| # | Story | Priority | Est. |
|---|---|---|---|
| 29.1 | `@handle` channel URLs (claim, validate, uniqueness, redirect old ids), channel About page | P0 | 4 d |
| 29.2 | Comments completion: replies UI, sort, live updates, timestamps links, edited flag, per-video comment settings | P0 | 5 d |
| 29.3 | Creator comment moderation in Studio/settings (hide, block, held queue) incl. AI flags hook (Epic 28) | P1 | 4 d |
| 29.4 | Community posts completion: image/GIF verify, edit/delete, post detail URL, scheduled posts, subscriber notifications | P1 | 4 d |
| 29.5 | Public profile page + privacy toggles (subscriptions/likes/playlists visibility) | P1 | 3 d |
| 29.6 | Library hub + Watch later + Liked videos pages, quick-add on cards | P0 | 4 d |
| 29.7 | Explore page (trending by region/language, categories, live now, new channels, seasonal) | P0 | 4 d |
| 29.8 | Search v2: filters UI, multi-type results, channel search, Arabic normalisation, history | P0 | 5 d |
| 29.9 | Search index service (scalable, see §3) | P0 | 5 d |
| 29.10 | Notification center (bell, inbox, read state, settings) + per-channel bell | P0 | 5 d |
| 29.11 | Home personalisation: continue watching, chips, not-interested feedback | P1 | 4 d |
| 29.12 | Watch page completion: description timestamps/hashtags, theater mode, mini-player, autoplay toggle | P1 | 4 d |
| 29.13 | Playlists: play-all queue, shuffle/loop, visibility enforcement | P1 | 3 d |
| 29.14 | Lamahat vertical viewer (web) | P2 | 4 d |
| 29.15 | Subscriptions UX: sidebar with new/live dots, new-since-last-visit, manage sort/filter | P1 | 3 d |
| 29.16 | Account settings consolidation (links to auth profile for email/password/sessions) | P2 | 2 d |
| 29.17 | Live watch page `/live/{id}` (fix 404 links; player+status; chat after D3) | P1 | 3 d |
| 29.18 | Channel extras: trailer, featured channels UI, section enum for events/featured, deletion/transfer | P2 | 4 d |

Every story's Definition of Done: API + web (LTR/RTL) + unit tests + E2E spec against QA + entitlements
declared + seed data in Seed QA for the new feature.

---

## 3. Platform work needed

- **Search index.** Listing R2 objects and filtering in a Worker doesn't scale past a few thousand
  videos. Options: (a) D1 FTS5 table maintained by the processor on video/channel/playlist events
  (cheap, simple, good for Arabic with our own normalisation), (b) Workers AI `bge-m3` embeddings +
  Vectorize for semantic search later. Recommendation: **(a) now, (b) as an add-on**.
- **Per-user indexes.** Watch later, liked videos, history, notifications and subscription feeds need
  per-user index objects or D1 tables (the current scans of up to 1000 objects are a known limit).
- **Counters.** Likes/views/subscribers via processor rollups (exists from #161) everywhere, not
  recomputed on read.
- **Notifications store.** D1 table per user with retention (90 days), fed by the processor; realtime
  delivery via websocket; push later (native Epic 9.4).

---

## 4. Tiers (seed values, admin-editable; Epic 27)

Core viewing, commenting, subscribing, liking, search and library are **free for everyone**.
Creator-side extras are tiered, e.g. `posts.scheduled` (Plus+), `comments.heldForReview` (all) vs
`comments.aiAutoHold` (Plus+, Epic 28), `channel.trailer` (free), `channel.teamRoles` (Pro+),
`playlists.collaborative` (Plus+).

---

## 5. Sequencing

1. **Sprint A (P0, ~2.5 wk):** 29.1, 29.2, 29.6, 29.7, 29.8 + 29.9, 29.10
2. **Sprint B (P1, ~2.5 wk):** 29.3, 29.4, 29.5, 29.11, 29.12, 29.13, 29.15, 29.17
3. **Sprint C (P2, ~1.5 wk):** 29.14, 29.16, 29.18

Native mobile (Epic 12) starts after Sprint A so apps build on complete APIs.
