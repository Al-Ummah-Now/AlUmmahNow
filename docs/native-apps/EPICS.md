# Al Ummah Now — Native Apps: Product Spec & Epics

**Status:** Draft v2 for review: **native on every platform** (owner decision, 2026-11-08)
**Date:** 2026-11-07, revised 2026-11-08
**Scope:** Viewer ("player") apps and Studio (creator) apps on every major platform
**Continues:** `docs/epics.md` (Epics 1–8). Native app epics are numbered **9–24**, plus **Epic 30** (Studio media engine).
**Inputs:** `docs/PRD.md` (Phase 3: mobile, smart TV, offline), current web app and APIs, YouTube product family as reference, Al Ummah Now branding.

---

## 1. Vision

> **Beneficial knowledge, on every screen.** Al Ummah Now apps bring trusted Islamic lectures,
> recitation and nasheeds to phones, TVs, desktops and cars, Arabic-first and English-equal,
> calm by design, and respectful of the viewer's time and prayer.

We borrow what YouTube does well (frictionless playback, a family of focused apps, a powerful
creator studio) and deliberately do things differently where our audience needs it:

| YouTube does | Al Ummah Now does instead |
|---|---|
| Infinite autoplay and engagement-maximising feeds | **Intentional viewing**: autoplay off by default, "session goals", a gentle end-of-session card, no dark patterns |
| Ads everywhere | **No ads by default**; optional creator support and premium later (Epic 24) |
| Shorts (vertical, endless) | **Lamahat (لمحات, "glimpses")**: short reflections, finite daily stack, each linking to the full lecture |
| YouTube Music | **Listen mode**: lectures, recitation and nasheeds as audio, background play, CarPlay/Android Auto |
| YouTube Kids (separate app) | **Ummah Kids profiles** inside the main app, curated allow-list, parental controls |
| Generic calendar-agnostic UX | **Islamic time awareness**: prayer-time reminders and optional auto-pause, Hijri dates, Ramadan mode |
| Chapters | Chapters **plus study mode**: notes, bookmarks, A–B loop for memorisation, verse-synced recitation subtitles |
| Verified badge (popularity) | **Scholar & institution verification** (credential-based, moderated) |
| Courses (limited) | **Learning paths**: ordered series with progress, certificates later |
| Watch parties (none) | **Study circles**: synchronised group viewing with moderated discussion (PRD) |

---

## 2. Product family

| App | Who | Platforms | Reference |
|---|---|---|---|
| **Al Ummah Now** (viewer) | Everyone | iOS, iPadOS, Android (phone/tablet/foldable), Android TV / Google TV, Fire TV, Apple TV (tvOS), Samsung Tizen, LG webOS, Windows, macOS, Linux, Web (PWA), CarPlay & Android Auto (audio) | YouTube, YouTube Music, YouTube Kids |
| **Al Ummah Now Studio** | Creators, scholars, institutions, channel teams | iOS, iPadOS, Android, Windows, macOS, Linux, Web. **Desktop:** encoding, transcription, batch upload, video editing. **Mobile:** editing, live streaming | YouTube Studio, plus a lightweight editor (CapCut / DaVinci-style basics) |
| **Ummah Kids** | Children (via parent) | A profile type inside the viewer app on every platform (no separate binary) | YouTube Kids |

The **internal bulk importer** (AlUmmahNowTools, .NET Uno desktop) is folded into **Studio Desktop**
(Epic 19) so creators and the content team use one tool.

---

## 3. Brand & design system: "Fanous" (فانوس)

Named after the lantern in the logo. One design language, adapted per platform (phone, tablet,
10-foot TV, desktop, car).

**Brand assets today:** `apps/web/public/logo.png` (lantern, night-teal sky),
`apps/web/public/ai/logo-original-animated.mp4` (animated logo), wordmark
`AlUmmahNowUI/public/alummah now logo.png`, palette in `AlUmmahNowUI/tailwind.config.cjs`.

### Core tokens (proposed, from existing brand)

| Token | Value | Use |
|---|---|---|
| `night` | `#093041` | App background (dark, default theme) |
| `night-deep` → `night-shallow` | `#07425a` → `#083f58` | Hero gradients, TV backgrounds |
| `lantern` (primary) | `#ffa037` | Primary actions, progress bars, focus rings |
| `glow` | `#ffc46b` | Highlights, live badges, TV focus glow |
| `earth` (secondary) | `#8e6c53` | Secondary actions, dividers on dark |
| `parchment` | `#f7f1e8` | Light theme background |
| `verified` | `#16a34a` | Scholar verification, success |
| `error` | `#b00020` | Errors |

- **Dark-first** (night teal); full light theme ("parchment"); both must pass WCAG 2.1 AA (Epic 1).
- **Typography:** Arabic display + body and Latin pair with matching x-height. The current
  "Farsi Simple Bold" (`FRSSPBL.TTF`) has unclear redistribution rights for apps, so replace it with
  an open-licensed pair, e.g. **IBM Plex Sans Arabic + IBM Plex Sans** or **Noto Kufi Arabic + Inter**
  (decision D6).
- **RTL is first-class:** mirrored layouts, mirrored progress and seek gestures, bidi-safe
  truncation, Eastern Arabic numerals option.
- **Motion:** "lantern glow" focus and loading motif; respects reduced-motion.
- **10-foot variant:** focus-driven UI, 48dp+ targets, safe areas, glow focus ring.
- **Iconography:** custom geometric set (Islamic pattern-inspired) on a standard icon grid; no
  figurative imagery in brand art.
- **Thumbnails guidance for creators:** modest, text-legible in Arabic & English, safe-area guides
  (Studio, Epic 18/19).

---

## 4. Technical architecture (decided: native on every platform)

**Owner decision (2026-11-08):** every app is a native app built with each platform's own UI toolkit
and media stack. There is no cross-platform UI framework (no React Native, no Tauri/Electron, no web
views). Windows and Linux use **C# or Rust**. For macOS we chose the best native option, **Swift +
SwiftUI/AppKit**. The only exception is **LG webOS**, where the public store accepts web apps only
(its native SDK is partner-only); see 15.x.

### 4.1 Per-platform stacks

| Platform | Language & UI | Media stack | Notes |
|---|---|---|---|
| **iOS, iPadOS** (viewer + Studio) | **Swift + SwiftUI** (UIKit where needed) | AVFoundation / AVKit (HLS, PiP, AirPlay), VideoToolbox, ReplayKit (screen broadcast), Core ML | One Apple workspace, shared Swift packages |
| **tvOS** (Apple TV) | **Swift + SwiftUI** (focus engine) | AVKit | Shares the Apple packages with iOS |
| **macOS** (viewer + Studio) | **Swift + SwiftUI, with AppKit** for the editor timeline, multi-window and menus | AVFoundation, **VideoToolbox** (hardware H.264/HEVC/ProRes), Metal (editor preview, effects), Core ML / Metal for on-device transcription | Best-in-class native Mac. Mac App Store + notarised direct download |
| **Android phone, tablet, foldable** | **Kotlin + Jetpack Compose** | **Media3** (ExoPlayer playback, **Transformer** editing/export, MediaCodec), CameraX, MediaProjection (screen broadcast) | Material 3 themed with Fanous tokens |
| **Android TV / Google TV, Fire TV** | **Kotlin + Compose for TV** | Media3 ExoPlayer | One TV app; Fire TV build flavour for Amazon specifics |
| **Android Auto / CarPlay** | Kotlin (Car App Library, media templates) / Swift (CarPlay templates) | Platform audio | Part of the mobile apps |
| **Windows 10/11** (viewer + Studio) | **C# (.NET 9) + WinUI 3** (Windows App SDK) | Media Foundation (hardware encode/decode: NVENC / Quick Sync / AMF), Windows.Media.Playback, Direct3D 11/12 for the editor preview | MSIX via Microsoft Store + winget |
| **Linux** (viewer + Studio) | **C# (.NET 9) + GTK 4 / libadwaita** via Gir.Core bindings | **GStreamer** (playback, encode: VA-API / NVENC / software x264/x265/SVT-AV1), PipeWire (capture) | Flatpak (Flathub) first; Snap optional |
| **Samsung Tizen TV** | **C# (Tizen .NET, NUI)** | Tizen AVPlay | Reuses the C# app layer from Windows/Linux |
| **LG webOS TV** | Web app (TypeScript), packaged as IPK | webOS media pipeline (HLS) | **Exception:** web apps are the only public option on webOS |
| **Web** (viewer + Studio) | Existing Next.js apps | hls.js / native HLS | Not replaced; stays the universal fallback and share target |

**Why C# for Windows and Linux:** one C# application layer (view-models, services, navigation,
i18n, using CommunityToolkit.Mvvm) is shared by the Windows (WinUI 3) and Linux (GTK 4) apps, and by
the Samsung Tizen TV app. Each OS still gets its own native UI on top. Rust is used where it is strongest: the
shared core below.

### 4.2 Shared core in Rust: `aun-core`

UI and players are native, but the logic that must behave identically everywhere lives in **one Rust
library**. It is exposed to Swift and Kotlin via **UniFFI** and to C# via **uniffi-bindgen-cs**
(csbindgen as a fallback):

| Module | Responsibility |
|---|---|
| `aun-api` | Typed API client generated from the api-videos OpenAPI (Epic 9.3); retries, auth refresh, offline write queue |
| `aun-auth` | OAuth 2 + PKCE, device flow (RFC 8628), multi-account, token storage via platform adapters (Keychain / Keystore / Windows Credential Locker / libsecret) |
| `aun-sync` | Watch-state, history, notes and offline-library sync (conflict-free last-writer-wins) |
| `aun-upload` | Resumable **TUS** engine: batch queues, parallelism, bandwidth caps, checksums, retry/backoff, folder watching (desktop), manifests |
| `aun-media` | **Studio media engine (Epic 30):** encode job graph, proxy generation, loudness analysis, **transcription** (whisper.cpp via whisper-rs, with Metal / CUDA / Vulkan / CPU backends), edit-decision-list (EDL) model and render planning |
| `aun-i18n` | Shared translation bundles synced from the API, pluralisation, Arabic shaping helpers for burned-in text (HarfBuzz) |
| `aun-telemetry` | Consent-gated analytics, QoE events, crash breadcrumbs |

**Platform adapters** stay native, because the OS must own these:
- background transfers (iOS `URLSession` background sessions, Android WorkManager, Windows BackgroundTransfer);
- players;
- hardware encoders (`aun-media` plans a job, and VideoToolbox, MediaCodec, Media Foundation or GStreamer executes it);
- camera and screen capture;
- notifications.

### 4.3 Code sharing at a glance

| Shared by | What |
|---|---|
| All apps | `aun-core` (Rust), Fanous tokens (generated per platform), translation bundles, OpenAPI contract |
| iOS + iPadOS + tvOS + macOS | Swift packages: UI components, view-models, player wrapper |
| Android phone + TV + Auto | Kotlin modules: UI components, view-models, Media3 wrapper |
| Windows + Linux + Tizen | C# application layer; separate WinUI 3 / GTK 4 / NUI views |

**Team shape:** Apple (Swift), Android (Kotlin), Desktop/Tizen (C#), Core & media (Rust), plus webOS
(TS, small). This costs more than one TS stack. In return, each platform gets its best UI, performance
and battery life, plus first-class access to hardware encoders and system features (widgets,
App Intents, Top Shelf, Live Activities, Android TV channels).

**Dependencies on open platform decisions:**
- **Video delivery** (Bunny today vs R2 + Cloudflare CDN, see cost report): affects signed URLs,
  offline download protection, costs, and whether Studio desktop uploads **pre-encoded renditions**
  (D11). Decision D2.
- **Live provider** (Bunny Stream Live preview vs self-hosted RTMP/SRT to R2): affects Epics 17 and 18.7
  "Go live" and 19.5. Decision D3.

---

## 5. Epics overview

| # | Epic | Apps | Priority | Est. | Depends on |
|---|---|---|---|---|---|
| 9 | Platform foundations for native clients | backend | P0 | 4 wk | — |
| 10 | Fanous design system | all | P0 | 3 wk | — |
| 11 | Shared core in Rust (`aun-core`) + per-platform app layers | all | P0 | 6 wk | 9 |
| 12 | Viewer mobile apps (iOS / iPadOS in Swift; Android in Kotlin), built in parallel | viewer | P0 | 10 wk | 9, 10, 11, 13 |
| 13 | Native players (AVKit, Media3, Media Foundation, GStreamer, AVPlay) with one shared behaviour spec | viewer, studio | P0 | 7 wk | 11 |
| 14 | Offline & Listen mode (incl. CarPlay / Android Auto) | viewer | P1 | 4 wk | 12, 13, D2 |
| 15 | TV apps (Apple TV in Swift; Android TV / Fire TV in Kotlin; Tizen in C#; webOS web) | viewer | P1 | 10 wk | 9 (device flow), 10, 11, 13 |
| 16 | Desktop viewer (macOS in Swift; Windows in C# + WinUI 3; Linux in C# + GTK 4) | viewer | P2 | 6 wk | 10, 11, 13 |
| 17 | Live in apps (watch, chat, premieres, reminders) | viewer | P1 | 5 wk | 13, D3 |
| 18 | Studio mobile (iOS / iPadOS / Android): manage, upload, **edit, live stream** | studio | P1 | 10 wk | 9, 10, 11, 30, D3 |
| 19 | Studio desktop (macOS, Windows, Linux): **encoding, transcription, batch upload, video editing**, bulk import | studio | P1 | 12 wk | 9, 11, 30 |
| 20 | Ummah Kids profiles & parental controls | viewer | P2 | 4 wk | 12, 15 |
| 21 | Islamic experience layer | viewer | P1 | 5 wk | 12 |
| 22 | Notifications, sharing, study circles | viewer, studio | P1 | 4 wk | 9 |
| 23 | Release engineering & store compliance | all | P0 | ongoing (3 wk setup) | — |
| 24 | Creator support & premium (later) | viewer, studio | P3 | TBD | D4 |
| 30 | Studio media engine (`aun-media`, Rust): encoding, transcription, editing engine | studio | P1 | 8 wk | 11 |

---

## 6. Epics in detail

Each story is written as *As a … I want … so that …* with key acceptance criteria (AC).
Bilingual (en/ar, RTL) and accessibility (Epic 1 standards) are implicit ACs for **every** UI story.

### Epic 9: Platform foundations for native clients (backend)

**Goal:** Make the existing backend safe and complete for public native clients on every platform.

- **9.1 Native OAuth clients.** As a platform team I want a registered **public** OAuth client per app
  (viewer-mobile, viewer-tv, viewer-desktop, studio-mobile, studio-desktop) using **PKCE (S256 required)**.
  AC: custom URI schemes (`alummahnow://`, `alummahnow-studio://`) and universal/app links
  (`https://videos.alummahnow.net/app/...`); refresh-token rotation; per-client scopes. QA + prod.
- **9.2 Device authorization grant (RFC 8628)** in the openauth fork for TVs, cars and consoles.
  AC: TV shows code + QR; user approves at `alummahnow.net/activate` on phone; polling with backoff; codes
  expire in 10 min.
- **9.3 Public API contract & versioning.** As app developers we want a versioned, documented API
  (`/api/v1`), OpenAPI as the source for SDK generation, a deprecation policy, and a minimum-supported
  app version check (`/api/app-config`).
- **9.4 Push notification service.** A Worker plus Queue fan-out to APNs, FCM, WNS and web push; device
  registration API; per-category preferences (uploads from subscriptions, replies, live, prayer reminders).
- **9.5 Remote config & feature flags** (KV-backed) by platform, app version and locale.
- **9.6 Playback authorization.** Signed, expiring playback and download URLs/tokens (Bunny token auth or
  R2 signed URLs, per D2); download entitlements with expiry and device binding.
- **9.7 In-app account deletion & data export API** (Apple 5.1.1(v), Google Play policy; ties to GDPR
  story 1.3).
- **9.8 Client telemetry ingest:** privacy-respecting events (consent-gated), crash breadcrumbs, QoE
  (startup time, rebuffer ratio).
- **9.9 Watch-state sync:** cross-device resume (watch history and progress already exist; add
  conflict-free last-writer semantics and a "Continue watching" endpoint).

### Epic 10: Fanous design system

**Goal:** One design language, implemented natively per platform (SwiftUI, Compose, WinUI 3, GTK 4, NUI) plus web.

- **10.1 Tokens** (colour, type, spacing, radius, elevation, motion) as a single source (JSON) generating
  **SwiftUI** (Swift package), **Compose** (Kotlin theme), **WinUI 3** (XAML resource dictionaries), **GTK 4**
  (CSS for libadwaita), **Tizen NUI** and web CSS; dark (night) and light (parchment); contrast-verified.
- **10.2 Typography licensing & pairing** (D6) with Arabic and Latin scales; Eastern Arabic numeral option.
- **10.3 Component library:** video card, Lamahat card, channel header, chip filters, player chrome,
  comment item, sheet and dialogs, empty states, skeletons, a lantern-glow loader. LTR and RTL.
- **10.4 10-foot components:** focus engine patterns, rails, hero, on-screen keyboard and search, glow focus.
- **10.5 Iconography & illustration:** geometric icon set; empty-state illustrations (no figurative imagery).
- **10.6 App icons, splash and store art** per platform, from the lantern logo (adaptive icons,
  tvOS layered icons, TV banners).
- **10.7 Component catalogues** per platform (SwiftUI previews, Compose previews, a WinUI/GTK gallery app) plus a
  docs site with RTL toggle and TV preview.

### Epic 11: Shared core in Rust (`aun-core`) + per-platform app layers

**Goal:** One implementation of the logic that must behave identically everywhere (see §4.2), with thin,
idiomatic bindings for each native app.

- **11.1 `aun-core` workspace & bindings:** Rust workspace; UniFFI bindings for Swift (XCFramework) and
  Kotlin (AAR); uniffi-bindgen-cs for C# (NuGet). CI builds every target: aarch64/x86_64 Apple, Android
  ABIs, Windows x64/arm64, Linux x64/arm64, Tizen arm.
- **11.2 API client** generated from the api-videos OpenAPI (9.3): typed, retries, auth refresh, offline
  write queue (likes, comments, notes).
- **11.3 Auth module:** PKCE login, device flow, multi-account (mirrors web SessionManager). Secure storage
  through platform adapters (Keychain / Android Keystore / Windows Credential Locker / libsecret).
- **11.4 i18n:** shared bundles with the web app, synced from the API translations; pluralisation
  (Epic 3); runtime locale switching; future locales (Urdu, Turkish, Indonesian, Malay, French).
- **11.5 Player behaviour spec + conformance tests:** queue, resume, quality policy, data-saver and
  study-mode loops are specified once and tested against each native player wrapper (Epic 13).
- **11.6 Download & upload engines** (`aun-upload`) with native background-transfer adapters (Epic 14, 18, 19).
- **11.7 Analytics & consent** (respects the consent banner from story 1.3).
- **11.8 Realtime client** (websocket auth via token, live counters, notifications).
- **11.9 Per-platform app layers:** a Swift package (Apple), Kotlin modules (Android), and a C# application
  layer (Windows, Linux, Tizen) on top of `aun-core`, holding view-models and navigation.

### Epic 12: Viewer mobile app (iOS / iPadOS / Android)

**Goal:** Polished native viewer apps, **Swift/SwiftUI on iOS and iPadOS** and **Kotlin/Compose on Android**, built
in parallel to the same stories, at parity with the core web experience plus mobile-native strengths.

- **12.1 Onboarding:** language (Arabic / English first), interests (Tafsir, Hadith, Seerah, Fiqh,
  Recitation, Nasheeds, Kids…), notifications opt-in, optional prayer settings (Epic 21). Skippable,
  with guest mode.
- **12.2 Home:** personalised rails (Continue watching, From your subscriptions, Recommended,
  Trending, Learning paths, Lamahat strip), category chips, pull-to-refresh, infinite rails with a
  finite home (see 21.6).
- **12.3 Watch page:** player, title and description (localised), channel row with subscribe,
  like/dislike, save to playlist, share, download, report; chapters; comments sheet; related videos;
  "Up next" with autoplay **off by default**.
- **12.4 Lamahat (short reflections):** vertical player, a daily finite stack ("You're all caught up"),
  "Watch full lecture" deep-link at the exact timestamp.
- **12.5 Subscriptions feed** with "new since last visit" and per-channel notification bell
  (all / highlights / none).
- **12.6 Library:** history (pause / clear), watch later, playlists, downloads, liked, study notes.
- **12.7 Search:** suggestions (API exists), voice search, filters (type, duration, language, date,
  scholar-verified), Arabic diacritics-insensitive matching.
- **12.8 Channel page:** tabs (Home sections, Videos, Lamahat, Live, Playlists, Community, About),
  scholar verification badge.
- **12.9 Community posts:** text, images, polls, comments; reactions.
- **12.10 Comments:** threaded one level, pin / heart by creator, report, sort (top / newest),
  respectful-speech nudges before posting.
- **12.11 Profile & accounts:** multi-account switcher, channel switcher, settings (playback, data saver,
  downloads, notifications, language, theme, prayer), privacy, account deletion (9.7).
- **12.12 Tablet & foldable layouts:** two-pane watch, landscape-first.
- **12.13 Widgets & shortcuts:** "Continue watching" and "Today's reflection" widgets (WidgetKit / Glance);
  App Intents / Siri and Android App Actions ("Play latest from …"); Live Activities for live events (iOS).
- **12.14 Deep links** for every shareable entity (video at a timestamp, channel, playlist, live, post).

### Epic 13: Native players

Each platform uses its native player: **AVKit** (Apple), **Media3 ExoPlayer** (Android, Android TV, Fire TV),
**Windows.Media.Playback / Media Foundation** (Windows), **GStreamer** (Linux), **AVPlay** (Tizen) and the webOS
pipeline. Behaviour is identical because every wrapper passes the shared conformance suite (11.5).


- **13.1 HLS ABR playback** with a fast start (< 1.5 s p50 on 4G), quality selector, data-saver cap.
- **13.2 Speed** 0.5–2× with pitch correction; **skip ±10 s** and double-tap gestures (mirrored in RTL).
- **13.3 Subtitles:** multi-language (existing API), styling, **verse-synced recitation subtitles**
  (Arabic text + translation lines, Epic 21.4).
- **13.4 Chapters:** markers, chapter list, chapter-skip gestures.
- **13.5 PiP, background audio** (respecting platform rules), lock-screen and Now Playing controls.
- **13.6 Casting:** Chromecast, AirPlay; second-screen remote from phone to TV app.
- **13.7 Study tools:** A–B loop (memorisation), repeat-N, bookmark at timestamp with a note.
- **13.8 Sleep timer** (end of video / minutes).
- **13.9 Resume & sync** across devices (9.9).
- **13.10 QoE telemetry** (startup, rebuffering, errors) with clear error messages (not "format not
  supported" for missing renditions).
- **13.11 Accessibility:** screen-reader labels, captions default by preference, audio descriptions
  track support.

### Epic 14: Offline & Listen mode

- **14.1 Downloads:** select quality, Wi-Fi-only, storage management, encrypted at rest, licence expiry
  and refresh (9.6), auto-download new episodes from chosen channels/paths.
- **14.2 Audio-only downloads** (much smaller) for lectures and recitation.
- **14.3 Listen mode:** audio-first UI with a queue, background play, playback speed, sleep timer;
  "listen to this lecture" from any video.
- **14.4 CarPlay & Android Auto:** browse Continue listening, Downloads, Subscriptions, Recitation;
  voice play.
- **14.5 Offline-first library sync** (likes and notes queued while offline).

### Epic 15: TV apps

Platforms: **Apple TV (tvOS)** in Swift/SwiftUI; **Android TV / Google TV and Fire TV** in Kotlin + Compose for TV;
**Samsung Tizen** in C# (Tizen .NET, NUI); **LG webOS** as a web app (the only public option on webOS).

- **15.1 Sign-in with device code** (9.2) plus QR; guest browsing.
- **15.2 Profiles on TV** (multi-account, Ummah Kids profiles) with a PIN for adult profiles.
- **15.3 10-foot home:** hero, rails, Continue watching, Live now, Ramadan rail (seasonal).
- **15.4 Watch on TV:** full-screen player, chapters, subtitles, speed, Up next (off by default).
- **15.5 Search:** on-screen keyboard (Arabic and Latin), voice (platform assistant).
- **15.6 Phone as remote / cast target** (13.6).
- **15.7 "Sakinah" ambient mode:** when idle, show calm brand visuals with a Qur'an verse or hadith of
  the day and the next prayer time (opt-in), instead of a generic screensaver.
- **15.8 Platform integrations:** Android TV channels / Watch Next, tvOS Top Shelf, Fire TV catalogue
  integration.
- **15.9 Certification:** each store's TV guidelines, remote-only navigation, performance on low-end
  TVs (Tizen / webOS 2019+).

### Epic 16: Desktop viewer (Windows, macOS, Linux)

Native apps: **macOS** in Swift + SwiftUI (AppKit where needed); **Windows** in C# + WinUI 3; **Linux** in
C# + GTK 4 / libadwaita. The web app stays installable as a PWA for everyone else.

- **16.1 Native desktop shells:** sidebar navigation, keyboard-first, multi-window (watch in a separate
  window), system dark/light, RTL.
- **16.2 Distribution:** Mac App Store and a notarised DMG; Microsoft Store (MSIX) and winget; Flathub
  (Flatpak). Auto-update through each store, or Sparkle (direct macOS download).
- **16.3 Mini-player and always-on-top** window; media keys and Now Playing (MPNowPlayingInfoCenter, SMTC,
  MPRIS); system notifications; deep links.
- **16.4 Downloads & Listen mode on desktop** (Epic 14) using `aun-upload` / `aun-sync`.

### Epic 17: Live in apps

(Depends on D3 live provider.)

- **17.1 Live watch:** low-latency HLS, live badge, viewer count (realtime), DVR seek-back.
- **17.2 Live chat:** moderated (slow mode, keyword filters, creator moderators), Arabic and English,
  pinned messages.
- **17.3 Premieres & scheduled streams** with reminders (push and calendar) and a countdown page.
- **17.4 Event streams:** Taraweeh, Jumu'ah khutbah, conferences; a dedicated "Live events" rail.
- **17.5 Replays** become VOD automatically with chat replay (optional).

### Epic 18: Studio mobile (iOS / iPadOS / Android)

- **18.1 Dashboard:** latest video performance, channel totals (real analytics from Epic 2 / #161),
  recent comments, tasks (processing, failed uploads).
- **18.2 Upload from phone:** camera or library; background resumable upload (TUS) that survives app
  kill; Wi-Fi-only option; processing status (fixed status mapping) with push when ready.
- **18.3 Edit details:** bilingual title and description, category, tags, thumbnail (pick frame or
  upload), visibility, schedule, chapters, subtitles upload, playlist assignment.
- **18.4 Comments & community:** reply, heart, pin, hide, report, block; post community updates and polls.
- **18.5 Analytics:** views, watch time, retention curve, traffic sources, top videos, subscribers;
  date ranges.
- **18.6 Channel management:** avatar, banner, about, sections, tabs, multiple channels, team roles
  (see 19.8).
- **18.7 Go live from phone** (D3): native camera ingest over **RTMP/SRT** (front/back camera, external mic,
  adaptive bitrate for weak networks), **screen broadcast** (ReplayKit / MediaProjection) for slides and
  recitation apps, title and schedule, a live health indicator (bitrate, dropped frames), chat moderation
  while live, and a one-tap "end and publish replay".
- **18.9 Mobile video editor:** trim, split and reorder clips; merge clips from the camera roll; bilingual text
  overlays and lower thirds (correct Arabic shaping, RTL); captions from transcription (on-device for short
  clips, server-side for long ones, per D10), editable; voice-over track; volume and loudness normalisation;
  brand intro/outro templates; thumbnail from a frame; export presets for the upload. Built on
  **AVFoundation** (iOS) and **Media3 Transformer** (Android), with the edit model (EDL) from `aun-media`
  (Epic 30), so a project started on the phone opens in Studio desktop.
- **18.8 Notifications:** processing finished, new comments, milestones, moderation actions.

### Epic 19: Studio desktop (Windows, macOS, Linux)

Native apps: **macOS** in Swift + SwiftUI/AppKit (Metal preview, VideoToolbox); **Windows** in C# + WinUI 3
(Media Foundation, Direct3D preview); **Linux** in C# + GTK 4 (GStreamer). All three use `aun-core` and the
media engine (Epic 30). The .NET Uno importer (AlUmmahNowTools) is retired once 19.2 ships.

- **19.1 Content library:** table view, multi-select, filters, bulk edit (visibility, category, tags,
  playlist, schedule).
- **19.2 Batch upload & bulk import** (absorbs AlUmmahNowTools): watch folders, CSV/JSON manifests (existing
  `example_watch_import.*`), metadata templates, approval queue, duplicate detection (hash), resumable
  parallel uploads, retry, bandwidth limits and schedules (e.g. upload overnight), per-file status that
  survives restarts.
- **19.3 Local encoding:** transcode any source (camera files, screen recordings, legacy formats) into
  upload-ready mezzanine files, using hardware encoders (VideoToolbox / Media Foundation with NVENC, Quick Sync or
  AMF / GStreamer with VA-API or NVENC) and a software fallback. Presets (lecture, recitation audio-first,
  conference); loudness normalisation (EBU R128); deinterlace and resize; audio-only extraction; batch
  encode queue with pause/resume. Optionally pre-encode **HLS renditions** for direct upload (D11).
- **19.4 Transcription & captions:** on-device speech-to-text (Whisper models via `aun-media`; Arabic,
  English and more) producing timed captions; a **caption editor** (timeline, waveform, split/merge cues,
  speaker labels, import/export SRT/VTT); chapter suggestions from transcript topics (editable); upload the
  captions with the video. Model download is managed and opt-in, with GPU acceleration where available.
- **19.5 Video editor:** multi-track timeline (video, audio, titles, captions): trim, split, ripple
  delete, reorder, simple transitions; bilingual titles and lower-thirds templates (brand kit, correct
  Arabic shaping); intro/outro templates; audio cleanup (noise reduction, normalisation); captions
  burn-in (optional); markers become chapters; thumbnail designer with brand templates and safe areas;
  real-time preview (Metal / Direct3D / GL); export through 19.3 straight into 19.2. Opens projects
  started on mobile (18.9).
- **19.6 Analytics deep dive** with export (CSV).
- **19.7 Live control room** (D3): stream keys, OBS profile export, health (bitrate / dropped frames),
  chat moderation, start/stop, scheduled events.
- **19.8 Teams & roles:** owner, manager, editor, moderator, viewer-of-analytics per channel; audit log
  (uses auth RBAC).
- **19.9 Institution mode:** many channels under one organisation (masjid, university), shared
  assets, brand kit.

### Epic 20: Ummah Kids profiles & parental controls

- **20.1 Kids profile** creation by a parent (age bands 3–6, 7–12); simplified UI, big targets, no
  comments, no community, no external links.
- **20.2 Curated allow-list:** only "kids-approved" channels/videos (moderator workflow in admin;
  creators can request review).
- **20.3 Parental controls:** time limits, bedtime, prayer-time pauses, content level, PIN-protected
  exit, activity view.
- **20.4 Kids learning paths:** du'a, stories of the prophets, Arabic letters, nasheeds without
  instruments filter (content tag).
- **20.5 Compliance:** COPPA / GDPR-K: no tracking, no personalised recommendations, verifiable
  parental consent flow.

### Epic 21: Islamic experience layer (the Al Ummah Now mix)

- **21.1 Prayer times:** location or manual city, calculation method and madhab settings; optional
  reminder N minutes before adhan; optional **auto-pause at adhan** with a gentle "Time for salah"
  card and resume later.
- **21.2 Hijri calendar & seasons:** Hijri dates in UI (optional), **Ramadan mode** (iftar/suhoor
  times, Taraweeh live rail, daily Qur'an juz' playlist), Dhul-Hijjah first-ten-days collection,
  Jumu'ah reminder.
- **21.3 Scholar & institution verification:** application flow (Studio), credential review (admin),
  badge with "Verified by Al Ummah Now" detail sheet; search filter.
- **21.4 Recitation tools:** verse-synced Arabic text with translation lines, reciter metadata, ayah
  repeat for memorisation (with 13.7), surah/ayah deep links.
- **21.5 Learning paths:** ordered series (e.g. "Seerah in 30 lessons") with progress, notes,
  reminders; certificates later.
- **21.6 Intentional viewing:** autoplay off by default, daily-time reminders, "session complete"
  card, finite Lamahat, no streaks or guilt mechanics.
- **21.7 Content preferences:** "instrument-free nasheeds only", language of instruction, madhab
  labels where creators provide them (labels, not filtering, by default).
- **21.8 Study mode notes:** timestamped notes and highlights, exportable (PDF / Markdown),
  synced (11.5).

### Epic 22: Notifications, sharing, study circles

- **22.1 Push categories & inbox** (9.4) with quiet hours and prayer-time quiet windows.
- **22.2 Share** with deep links and rich previews (OG cards for web, App Clips / Instant Apps
  optional).
- **22.3 Study circles:** create a circle, schedule a session, synchronised playback (websocket),
  moderated discussion, host controls; for halaqas and classes (PRD "watch parties / study groups").
- **22.4 Event calendar:** lectures, live events, local masjid events from institutions (19.7); add to
  calendar.

### Epic 23: Release engineering & store compliance

- **23.1 CI/CD:** Xcode Cloud or GitHub Actions macOS runners + **Fastlane** (Apple); **Gradle** + Gradle Play
  Publisher (Android, Fire TV); **MSIX** packaging + Store submission API and winget (Windows); **Flatpak**
  builder + Flathub (Linux); Tizen Studio CLI / sdb (Tizen); ares-cli (webOS); `aun-core` cross-compiled
  for every target. Environment builds: **QA** apps point at `*.qa.alummahnow.net`, prod apps at prod.
  Releases are cut from tags on `main` (CLAUDE.md "Deploy Rules").
- **23.2 Signing & accounts:** Apple Developer (organisation, needs D-U-N-S), Google Play, Amazon
  Appstore, Microsoft Partner Center, Samsung Seller Office, LG Seller Lounge, Flathub.
- **23.3 Beta channels:** TestFlight, Play internal/closed testing, Fire TV Live App Testing.
- **23.4 Staged rollouts** through each store (phased release, Play staged rollout, Store flighting) plus
  remote config and kill switches (9.5). Native apps don't hot-patch code.
- **23.5 Store listings** in Arabic and English (screenshots per locale), privacy labels / data safety,
  content ratings, kids category rules (20.5).
- **23.6 Monitoring:** crash reporting (Sentry), performance (QoE 13.10), release health gates.
- **23.7 Accessibility & RTL QA matrix** per platform; device lab (low-end Android, older Tizen/webOS).

### Epic 24: Creator support & premium (later, needs decision D4)

- **24.1 Creator support** (sadaqah/donations to creators/institutions). Note: Apple and Google rules
  on donations (registered non-profits) and IAP must be reviewed per region.
- **24.2 Premium membership** (PRD: offline, early access): IAP on iOS/Android/TV, web checkout
  elsewhere.
- **24.3 Ethical sponsorship slots** (opt-in, creator-controlled, no behavioural targeting).

### Epic 30: Studio media engine (`aun-media`, Rust)

**Goal:** One media engine behind Studio desktop and mobile, so encoding presets, transcripts and edit
projects behave the same everywhere. Execution uses each OS's hardware media APIs.

- **30.1 Probe & analyse:** container/codec probing, duration, loudness (EBU R128), scene changes, silence
  detection (used for chapter and trim suggestions).
- **30.2 Encode job graph:** presets → a platform-neutral job plan, executed by native backends
  (VideoToolbox, MediaCodec, Media Foundation, GStreamer) with a software fallback; progress, pause/resume,
  cancellation, and a conformance test corpus per backend.
- **30.3 Proxies & thumbnails:** low-res editing proxies, filmstrips and waveforms for timelines.
- **30.4 Transcription:** whisper.cpp via whisper-rs (Metal, CUDA, Vulkan, CPU); model management (download,
  checksum, size tiers); Arabic and English first; word-level timestamps; output to VTT/SRT and to the caption
  editor (19.4). Server-side fallback for low-end devices (D10).
- **30.5 Edit model (EDL):** versioned project format (tracks, clips, titles, captions, markers) shared by
  mobile (18.9) and desktop (19.5); render planning (what to re-encode vs stream-copy); project sync through
  the API so a project moves between devices.
- **30.6 Text rendering for titles & burned-in captions:** HarfBuzz shaping, bidi, Arabic fonts (D6).
- **30.7 Upload handoff:** export straight into `aun-upload` with metadata and captions attached.

---

## 7. Phased roadmap

Platform teams work in parallel after Phase A. Durations assume the team shape in §4.3.

| Phase | Duration | Ships |
|---|---|---|
| **A: Foundations** | ~8 wk | Epics 9 (9.1–9.5, 9.7, 9.9), 10, **11 (`aun-core` + bindings)**, 23 setup |
| **B: Mobile viewer MVP** | ~10 wk | Epic 12 on **iOS (Swift)** and **Android (Kotlin)** in parallel (12.1–12.11, 12.14), Epic 13 core (13.1–13.5, 13.9–13.11), 21.1 + 21.6; store launch |
| **C: Media engine + Studio mobile + Listen** | ~10 wk | **Epic 30** core (encode planning, transcription, EDL), Epic 18 (18.1–18.6, 18.8, **18.9 editor**), Epic 14, 21.3–21.5, 22.1–22.2 |
| **D: TV** | ~10 wk | Epic 15: Apple TV (Swift) and Android TV / Fire TV (Kotlin) first; then Tizen (C#) and webOS; 13.6 casting |
| **E: Desktop viewer + Studio desktop** | ~12 wk | Epic 16 (macOS, Windows, Linux) and Epic 19: batch upload and encoding first (19.2, 19.3), then transcription (19.4) and the editor (19.5). Retire the .NET importer |
| **F: Live, Kids, Community** | ~8 wk | Epics 17, **18.7 (live from phone)**, 19.7 (after D3), Epic 20, 22.3–22.4, 21.2 (before Ramadan) |
| **G: Monetisation (optional)** | TBD | Epic 24 after D4 |

Ramadan is a natural launch moment: aim Phase B + 21.2 to ship **before Ramadan**.

---

## 8. Success metrics

- Crash-free sessions ≥ 99.5% (mobile), ≥ 99.0% (TV).
- Playback start p50 < 1.5 s, rebuffer ratio < 0.5%.
- 30-day retention, weekly active learners (≥ 1 learning-path lesson / week).
- Share of sessions ending with the "session complete" card (healthy, intentional viewing).
- Creator time-to-publish from phone < 3 min (excluding upload time).
- Store ratings ≥ 4.6 in both Arabic and English locales.

---

## 9. Open decisions

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | App stack | **Decided 2026-11-08: native everywhere.** Swift (Apple, incl. macOS), Kotlin (Android/TV), C# (Windows WinUI 3, Linux GTK 4, Tizen), Rust shared core; webOS web | — (decided) |
| D2 | Video delivery | Bunny (today) / R2 + Cloudflare CDN | Pending Cloudflare confirmation and cost cap (≤ $500/mo) |
| D3 | Live provider | Bunny Stream Live (preview) / self-hosted RTMP to R2 | Follows D2 |
| D4 | Monetisation | None / donations / premium / sponsorship | None at launch |
| D5 | Kids content policy | Allow-list ownership, age bands | Moderator-curated allow-list |
| D6 | Fonts | Plex Arabic + Plex / Noto Kufi + Inter / licensed custom | Open-licensed pair |
| D7 | Prayer-time data | On-device calculation (adhan-js) / API | On-device (privacy, offline) |
| D8 | Brand naming | "Lamahat", "Sakinah", "Ummah Kids", "Fanous" | Confirm names and Arabic forms |
| D9 | Linux UI toolkit for C# | GTK 4 / libadwaita via Gir.Core (native GNOME look) / Avalonia (one C# UI for Windows + Linux, custom-drawn) | GTK 4 via Gir.Core (native); revisit if binding gaps block 19.5 |
| D10 | Transcription location | On-device Whisper only / server-side (Workers AI) only / hybrid | Hybrid: on-device on desktop and for short mobile clips; server-side for long mobile uploads and web |
| D11 | Who encodes renditions | Server (Bunny / Workers pipeline) only / Studio desktop uploads pre-encoded HLS renditions | Server by default; desktop pre-encode as an option once D2 settles (cuts encoding cost) |

---

## 10. Out of scope (for now)

Wearables (Apple Watch / Wear OS) beyond Now Playing controls; consoles (Xbox / PlayStation); VR / visionOS;
AI features beyond transcription (semantic search, auto-summaries, auto-translated subtitles), which are
candidates for a later epic set. **Transcription is in scope** (Epic 30.4, Studio 18.9 / 19.4).
