# Playlist playback: URL, queue, autoplay and the playlist pane

Status: **design, awaiting owner approval.** No code merges until the open decisions (section 9) are settled.

Owner reports (2026-11-11):
- "when you hit play all on playlist, or when you hit play next or it goes there auto, shouldnt it auto play the video?"
- "shouldnt there by a playlist pane, and shouldnt it play them as ORDERED IN PLAYLIST"
- "so the play list will be in the url not only the video id, think about this before doing it, and consider all PLAYERS"

Related: Epic 29.13 play-all queue, shuffle and loop (#373); docs/specs/VIDEO-PLAYER.md section 5 (up next); docs/embeds/README.md section 2 (embed contract).

## 1. What happens today (root cause)

Found in the code on `main` (a2c24014):

| Symptom | Cause |
|---|---|
| Play all opens the first video but nothing plays | `getPlayAllHref` (apps/web/src/lib/playlists/playlist-utils.ts) links to `/{locale}/video?vid={firstId}`. The watch page receives no playlist context at all. |
| "Next" / auto-advance plays something outside the playlist | The player's Next button (`FanousNextButton`, lib/video/components.ts), the `N` shortcut and the end-screen countdown all call `upNext.go()`, and the watch page sets up next to `related[0]`, the first *related* video (WatchPageContent.tsx). The watch page has no playlist queue. |
| The next video loads but does not start | The watch player hard-codes `autoplay={false}` (VideoPagePlayer/index.tsx and rtl/index.tsx). Navigation is already client-side (`router.push`), so the browser would allow the play; the app never asks for it. |
| No playlist pane | None exists on the watch page. Only the embed player (`/embed/p/{id}`) has a list drawer. |
| Order | The API is already correct. `GET /api/playlists/{id}?includeVideos=true` returns `videoItems` in the playlist's order: manual order, automatic sort field and direction (re-sorted at most every 10 minutes), and Watch later's user order (`orderedPlaylist`, apps/api-videos/src/lib/playlistOrder.ts; tested in test/playlist-bulk.spec.ts). The web app never uses that order for playback, and the response stops at 200 videos. |

## 2. URL model

### 2.1 Watch URL

```
/{locale}/video/{videoId}?list={listId}&index={n}&t={time}
```

- The path stays `/{locale}/video/{videoId}`, the route the app, sitemaps, oEmbed and the CMS (`AlUmmahNowUI/src/lib/embeds.ts`) already use. We do not add a `/watch/` path. Cards that still link to the legacy `/{locale}/video?vid=` move to the path form in the same change. The legacy route keeps working and carries `list`/`index` over.
- `list`: a playlist id, or a private alias (2.4).
- `index`: the position in the list, **0-based**, the same meaning as the embed contract's `index` (docs/embeds/README.md section 2), so one rule covers every surface. The pane shows it 1-based ("3 / 12").
- `t`: start time, unchanged (`parseTime`).
- No `autoplay`, `shuffle` or `loop` in watch URLs (decisions D3, D4).

### 2.2 Is `index` needed when the video id is in the URL?

The video id decides **what plays**. `index` is only a hint for **where in the list** we are:

- **Duplicates:** the API rejects a video that is already in a playlist (`playlistAddVideo`, `playlistBulk` skip existing ids), so duplicates cannot happen today. `index` keeps the URL correct if that ever changes: with duplicates, the occurrence nearest `index` wins.
- **After a reorder:** the id is looked up in the current order. If `index` disagrees, the found position wins and the URL is corrected with `history.replaceState`.
- **Video removed from the list:** `index` says where the viewer was, so "Up next" continues from there (2.3).

### 2.3 Resolution rules (the same on every player)

| Case | Behaviour |
|---|---|
| List visible, video in it | Play the video; position = its index; pane shown. |
| `index` stale (video is elsewhere in the list) | Use the video's real position; `replaceState` the corrected `index`. |
| Video no longer in the list | Play the video; pane shown with no item highlighted; "Up next" = the item at `index` (clamped). The header says "Not in this playlist". |
| List private and not the viewer's, deleted, soft-deleted (pending purge), hidden, or unknown alias | Play the video alone with no pane, exactly like a plain link. `replaceState` drops `list` and `index` so the dead list is not shared on. The API answers 404 in all these cases (`canViewPlaylist`), so nobody learns whether a private list exists. |
| Video itself not viewable | Unchanged: the "video not found" page. With a usable list, a "Play next in playlist" link to the next viewable item. |
| Items the viewer can't see (private/deleted videos inside a public list) | Left out of the queue for that viewer. Position and count are over what the viewer sees. |

### 2.4 Private lists: aliases

| Alias | List | Order |
|---|---|---|
| `list=WL` | the signed-in viewer's Watch later (`watch-later-{userId}` on the server) | the viewer's own order |
| `list=LL` | the viewer's Liked videos | newest like first (the library's order) |

- Aliases resolve on the server **from the caller's session**, never from the URL. The stored id (`watch-later-{userId}`) never appears in a URL, the page or a share link.
- A shared `?list=WL` link opens the *receiver's* own Watch later, or, signed out, the video alone.
- The share dialog and "copy link" drop alias lists. Public and unlisted playlist ids are kept, so "share this video in this playlist" works.

### 2.5 Canonical, SEO, OG and oEmbed

- `canonical` stays the plain video URL (`watchPageUrl`, apps/web/src/lib/embed/watch-metadata.ts already ignores the query). `list`/`index` never reach the canonical, the hreflang alternates or the sitemap.
- OG/Twitter cards stay the video's card. A link with a list still unfurls as the video.
- oEmbed: a watch URL with a public `list` returns the playlist embed (`/embed/p/{list}?index={n}`) so a pasted "video in playlist" link embeds the playlist starting there. Without a list, or with an alias or private list, it stays the video embed. `/embed/p` is `noindex` (already).

### 2.6 History: push or replace

| Navigation | History |
|---|---|
| Play all, clicking a pane item, the player's Next button or `N`, the pane's Previous/Next, end-screen "Play now", auto-advance | **push**: every video is a page, so Back returns to the previous video, as on YouTube |
| `index` correction, dropping a dead `list` | **replace** |
| Shuffle/loop toggles | no history entry (not in the URL) |

All of these navigations are client-side (`router.push`). The page never reloads inside a playlist, which keeps the browser's user-activation state for unmuted play (section 4).

## 3. Ordering source of truth and the queue API

The playlist's saved order, resolved **only on the server**, is the one order. Clients never sort.

New endpoint (api-videos, `/api/v1`, OpenAPI regenerated):

```
GET /api/playlists/{listId}/queue?video={videoId}&index={n}&cursor=&limit=50
```

- `listId` is a playlist id or `WL` / `LL` (resolved from the session; 404 when signed out).
- Optional auth: the visibility rules of `GET /api/playlists/{id}` (`canViewPlaylist`, channel playlist managers) and per-item `canViewVideo`.
- Response:
  ```json
  {
    "playlist": { "id": "…", "title": "…", "titleLocalized": {}, "ownerName": "…", "ownerHref": "…", "isPublic": true, "kind": "playlist|watch_later|liked", "sortMode": "manual|auto" },
    "total": 120,
    "position": 37,                // where `video` is (null when it is not in the list)
    "items": [ { "id": "…", "title": "…", "titleLocalized": {}, "thumbnailUrl": "…", "duration": 612, "channelName": "…", "isShort": false, "index": 30 } ],
    "prevCursor": "…", "nextCursor": "…"
  }
  ```
- The first page is a **window around `video`** (25 before, 25 after), so a viewer at item 400 gets item 400 immediately. Cursors page backwards and forwards for the pane's scroll. `total` and `position` are counted over the items the viewer can see.
- It applies `orderedPlaylist` before cutting, as the manager list does, so pages never overlap and an automatic order is the same one the playlist page shows. There is no 200-item cap.
- Responses carry `Cache-Control: private` for aliases and private lists. Public lists may be cached at the edge for 60 s (the automatic order refreshes every 10 minutes).
- Every player uses this endpoint: web watch page, playlist embed and the native apps (through Core's generated client). `GET /api/playlists/{id}?includeVideos=true` stays for the playlist page and existing embeds.

Tests (unit, api-videos): after a manual reorder the queue's ids equal the saved order; an automatic list returns the sorted order; WL returns the user's order and is 404 to anyone else; windows around item N; private items left out with correct `total`/`position`; soft-deleted list is 404.

## 4. Players: how each one gets the context, autoplays and ends

Inventory from the code (no guesses):

| Player | Where | Today | Playlist context | Next and autoplay | Pane |
|---|---|---|---|---|---|
| **Web watch page** | apps/web `WatchPageContent` → `VideoPagePlayer` → `VideoPlayerWithChapters` → `CustomVideoPlayer` (Video.js + HLS) | single video, `autoplay={false}`; up next = first related video, 8 s countdown | `list`/`index` from the URL → queue API; the page publishes the next *playlist* item as `upNext`, so the existing Next button, `N` key and end screen follow the list | Play all, pane click, Next/Prev, end-screen countdown → client-side push → new player plays (below) | **Yes** |
| **Shorts** | the same watch page (`isShort`, portrait frame). There is no separate Shorts route or feed player | as above | same | same; Shorts start from 0 (no resume), as today | Yes (same pane; on mobile under the player) |
| **Mini player** | `CustomVideoPlayer` floats itself when the watch page scrolls the player away (`miniPlayerAvailable`) | continues the current video | inherits the page's | auto-advance keeps the mini state: the next video plays in the mini player | No (the page's pane is on screen) |
| **Native picture-in-picture** | `fullscreen-pip.ts`, `native-pip-toggle.ts` | browser PiP of the `<video>` element | inherits the page's | Advancing replaces the `<video>`, which ends browser PiP (browsers tie PiP to the element). Accepted limit: the countdown runs, the next item plays in the page, and the viewer re-enters PiP. `mediaSession` next/previous track actions are added so the OS controls skip in the list. | No |
| **Playlist embed** | `/embed/p/{id}` → `EmbedPlayer` | own list drawer; advances on `ended` in the same frame; `index` 0-based; `autoplay=1` always muted | the embed URL (`index`) | Already advances. Changes: use the queue API (no 200 cap, real order), keep "muted only when the embedder asked for autoplay", add the same countdown, "Watch on Al Ummah Now" links to `/video/{id}?list={id}&index={n}&t=` | Its existing drawer (no change in layout) |
| **Video embed** | `/embed/v/{id}` | single video | none | none (no up next in embeds, by contract) | No |
| **CMS / www (AlUmmahNowUI)** | `src/lib/embeds.ts`, `facade.ts`: a click-to-load facade that inserts the `/embed/v` or `/embed/p` iframe with `autoplay=1` | the iframe player | through the embed URL | the embed's behaviour; the click on the facade is the gesture, so its autoplay plays (muted per the embed contract) | the embed's drawer |
| **Studio preview** | apps/web `videoPreview` (plain `<video>` in the edit page); native Studio editors (Apple `EditorMac`, Android `feature-editor`, Desktop) | single video, no autoplay | none | none | No (out of scope: editing, not playback) |
| **Dev player harness** | `/[locale]/dev/player` (`PlayerHarness.tsx`) | fixtures; up next to the next fixture | gains `&list=fixtures` mode | used by the player E2E (section 8) | Yes |
| **Apple viewer** (iOS, iPadOS, macOS, tvOS) | `AUNFeatures/WatchView`, `AUNPlayer/PlayerController` (AVPlayer; `load(…, autoplay: true)`) | single video, autoplays on open | none yet | Phase 3: Core `aun-player` already has the queue model (`LoadQueue`, `Next`, `Previous`, `SetShuffle`, `SetRepeatMode`, `SetAutoplay`, end of queue) fed by the queue API. Native players may play unmuted without a web-style gesture | Phase 3: a list sheet (iPhone), side column (iPad/Mac), list row (tvOS) |
| **Android viewer** | `viewer-mobile`, `feature-watch/WatchScreen`, `player/AunPlaybackService` (Media3) | single video | deep link `alummahnow://watch` takes only a video today | Phase 3, same Core queue; `AunPlaybackService` exposes next/previous to the media notification | Phase 3 |
| **Desktop viewer** (Windows, Linux) | `WatchViewModel` (`_player.Open(…, autoPlay: true)`), MPRIS on Linux | single video; `MediaCommand.Next` = skip forward | none | Phase 3, same Core queue; MPRIS/SMTC next = next item | Phase 3 |
| **External shares** | share dialog, oEmbed, OG | video URL | public `list` kept in shared links, aliases dropped (2.4); oEmbed as in 2.5 | n/a | n/a |

### 4.1 Web autoplay policy (watch page and harness)

- **Intent.** The page autoplays only when the URL has a usable `list` (playlist intent), or when the navigation came from an in-app auto-advance or "Play now" (router state flag, not a URL parameter). A plain `/video/{id}` load never autoplays.
- **How.** After the new player's source is ready (`loadedmetadata`) the page calls `player.play()` itself, rather than relying on Video.js's `autoplay` option, so a rejection can be seen.
- **Unmuted first.** Chrome and Firefox allow unmuted play after a user gesture in the same document (sticky activation). Client-side navigation keeps the document, so Play all, pane clicks and Next play with sound. Desktop Safari mostly allows it too.
- **Muted fallback.** If `play()` rejects with `NotAllowedError` (iOS Safari always does for an auto-advance with no fresh gesture; any browser on a cold load of a list link), the page mutes, plays again, and shows a **"Tap to unmute"** button over the player (focusable, Enter/Space, announced in a polite live region, en/ar, mirrored for RTL). The viewer's remembered volume is restored on unmute. If even muted play fails, the normal big play button stays.
- **iOS.** `playsinline` is already on the `<video>`; muted autoplay needs it. The first unmute tap is a real gesture, so later items in the same session play with sound.
- **Background tab.** The countdown already counts only while visible (EndScreen); auto-advance waits for the tab.

### 4.2 End of list

- Last item ends, loop off → the end screen shows **Watch again** and **Replay playlist**. There is no countdown and no related video: the list stops.
- Loop on → item 0 follows with the normal countdown.
- Embeds: unchanged (stop at the end; `loop` still means single-video loop, per the contract).

## 5. The playlist pane (web watch page, Shorts, harness)

- **Header:** the playlist title, localized (`pickLanguage` / `titleLocalized`, en/ar), owner (channel name, linked; "You" for WL/LL), "3 / 12" (or "– / 12" when the video is not in the list), and the private/unlisted badge.
- **Controls:** Previous, Next, Loop (off by default), Shuffle (off by default), Collapse/Expand. All are buttons with `aria-pressed` where they toggle, names in en/ar, and visible focus.
  - Shuffle builds a random order **for this tab only** (sessionStorage per list) and never writes to the playlist. The pane keeps showing the saved order; Next follows the shuffle; the "3 / 12" stays the saved position.
  - Loop and shuffle state persist per tab and list (sessionStorage), not in the URL (D4).
- **List:** every item in the saved order, with thumbnail (16:9; Shorts badge), title, channel (for WL/LL) and duration. The current item is highlighted (`aria-current="true"`) and scrolled into view inside the pane, never by scrolling the page. Each item is a link to its `/video/{id}?list&index` (so open-in-new-tab and middle-click work), and a plain click plays it client-side.
- **Long lists:** windowed paging from the queue API (2 windows ahead/behind loaded, more on scroll), with a fixed pane height so the page never grows. Items use `content-visibility: auto`. The list is `role="list"`, with arrow-key roving focus (Up/Down, Home/End).
- **Layout:** desktop (≥ lg) the pane is the top of the right column above the related videos (and in theatre mode, beside the related list under the player). Below lg it sits directly under the player and action row, above comments, collapsed to its header by default on phones. RTL mirrors through logical properties (`ms-`, `me-`, `start`, `end`); the list order stays first-to-last in reading direction.
- **Collapse** keeps the header (title, "3 / 12", Next) visible. The state is remembered per device (localStorage, try/catch).
- **Theme:** Fanous tokens and the existing compact related-row component styles. No new colours (`pnpm check:tokens`).

## 6. Edge cases

- **Views and analytics.** Each item mounts a new player, which creates a new `VideoAnalytics` and sends its own `ready` → one view per item, as for a normal watch. Watch time, quartiles and completion are per item. A muted autoplay counts the same way. Analytics batches gain `context.source = 'playlist'` and `playlistId` (never the WL/LL ids), so creators can see playlist plays later. An item skipped within 1 s of loading still counts one view (unchanged rule; this matches how a quick click on a related video counts today).
- **Resume.** Today a watched video reopens at its saved time (lib/video/resume.ts rules) with a "Start from beginning" pill. Inside a playlist, items start at 0 instead (a list is watched in order), and when the same rules would have resumed, a "Resume at 3:42" pill is offered (D12). Explicit `t=` still wins. Shorts never resume (unchanged).
- **Up next countdown.** The existing EndScreen: an 8 s ring today. In playlist mode the countdown is 5 s (D7), and the card shows the next playlist item and its "4 / 12". Cancel works as today (Cancel, Escape, any key, hover and focus pause it). Cancelled → stays on the end screen with "Play now".
- **User setting: Autoplay next.** None exists today: the related countdown always runs. Add one toggle in the player's settings menu: **Autoplay next** (default on), stored per device (localStorage). It applies to both the playlist countdown and the related countdown. Off → end screen with "Play now", no countdown. Synced to the profile later if Settings gains a playback section (D8).
- **Queue changes while playing.** The pane refetches its window when the tab regains focus. A removed current item stays playing ("Not in this playlist"); a reorder takes effect at the next advance.
- **Errors.** A queue fetch failure plays the video alone and shows the pane's retry state (`FriendlyError`, reported with `reportError`).
- **Keyboard shortcuts.** `N` (existing) moves to the playlist's next item. Previous is a pane button only, because `P` is already picture-in-picture.

## 7. Rollout

| Phase | Scope | Repos |
|---|---|---|
| 1 | Queue API + web watch page (URL model, pane, autoplay with muted fallback, countdown, Autoplay next setting), Play all on the playlist page / Watch later / Liked / channel playlist cards, share and oEmbed rules | AlUmmahNow (api-videos, web) |
| 2 | Playlist embed on the queue API, countdown, "Watch on" with list | AlUmmahNow (web) + docs/embeds |
| 3 | Native viewers: Core queue client + `aun-player` queue wired in Apple, Android, Desktop; deep links `alummahnow://watch?v=&list=&index=` | AlUmmahNowCore, Apple, Android, Desktop |

Each phase is its own PR; phase 1 can be split into API and web.

## 8. Tests (no paid AI; all on seeded or per-run data)

- **api-videos unit:** queue order = saved manual order after `PATCH` reorder; automatic sort order; WL order and access; window around N; hidden items; 404 cases.
- **web unit (jest):** URL parse/build (`list`, `index`, aliases, stale index, removed video); shuffle never changes the saved order; end-of-list decisions; pane rendering in en/ar.
- **Player harness (`playwright.player.config.ts`, Chromium + WebKit locally, Firefox in CI):** with `/dev/player?list=fixtures`: Play all → pane visible in fixture order → `currentTime` advances; Next → next item plays; seek to end → `ended` → countdown → next item plays and the highlight moves; last item → no countdown; Autoplay next off → no advance; forced `NotAllowedError` → muted play + "Tap to unmute"; RTL mirrored; axe clean.
- **Release E2E (QA):** `playlist-playback.player.spec.ts`: a run account makes a playlist of the seed's two lectures and the Short, reorders it, opens the playlist page → Play all → pane order equals the saved order → media plays → seek to end → the next item **in the saved order** plays and the highlight moves; en and ar. The run account and its playlist are deleted afterwards.
- **Native (phase 3):** Core queue tests in `aun-player` (already has fixtures); each app's UI test drives a fixture queue.

## 9. Open decisions for the owner

| # | Decision | Recommendation |
|---|---|---|
| D1 | Watch path | Keep `/{locale}/video/{id}` and add `?list=&index=`. Don't add `/watch/`; move the legacy `?vid=` links to the path form. |
| D2 | `index` base | 0-based, same as the existing embed contract; the pane shows it 1-based. |
| D3 | Autoplay intent | No `autoplay` parameter on watch URLs. A usable `list` means "autoplay"; in-app advances carry it in router state; a plain video link never autoplays. |
| D4 | Shuffle and loop | Per tab, not in the URL, so shared links always start in the saved order. |
| D5 | Back button | Push one history entry per video; replace only for corrections. |
| D6 | Private lists | Aliases `WL` (Watch later) and `LL` (Liked), resolved from the session; shares drop them. |
| D7 | Countdown | 5 s inside a playlist, 8 s for related; cancellable as today. |
| D8 | Autoplay-next setting | A per-device "Autoplay next" toggle in the player settings, default on, covering playlist and related. |
| D9 | After the last item | Stop with Watch again / Replay playlist; no related video afterwards. |
| D10 | Queue API | A new paginated `GET /api/playlists/{listId}/queue` used by every player, with no 200 cap. |
| D11 | Native apps | Phase 3, after web, on Core's existing queue model. |
| D12 | Resume inside a playlist | Start items at 0 and offer a "Resume at…" pill, rather than jumping to saved progress. |
