# Web Creator Studio

**Status:** Owner decisions applied 2026-11-09 (§10). Not implemented.
**Plan:** [CREATOR-STUDIO-PLAN.md](CREATOR-STUDIO-PLAN.md)
**Date:** 2026-11-09
**Supersedes:** [ADR-001, channel settings navigation](../adr/0001-channel-settings-refactor.md) (never implemented, status was Proposed), and the component layout in [channel-settings-component-architecture.md](../channel-settings-component-architecture.md).
**Related:** `docs/native-apps/EPICS.md` Epic 18 and 19.8; channel roles spec ([PR #462](https://github.com/Al-Ummah-Now/AlUmmahNow/pull/462)); channel claim and transfer spec ([PR #460](https://github.com/Al-Ummah-Now/AlUmmahNow/pull/460)); `docs/analytics/README.md`; `docs/design/THEMES.md`.

In the API tables, **Exists** means the route is on `main` today. **Exists, #462** means it exists but is owner-only until the channel roles work widens it. **#462** means PR #462 specifies it and it isn't built. **New** means nothing specifies it yet, and this spec is the first to ask for it.

## 1. Goals and non-goals

### Why

Creator pages on the web are scattered and duplicated:

| Today | Route | Source | Scope and notes |
|---|---|---|---|
| My videos | `/[locale]/dashboard/videos` | `apps/web/src/app/[locale]/dashboard/videos/page.tsx` | All the user's channels. Search, status, privacy and duration filters, bulk edit and delete. Loads up to 10 pages with `searchVideos`, then filters in the browser |
| Channel videos | `/[locale]/settings/channel/[id]/videos` | `.../settings/channel/[id]/videos/page.tsx` | One channel. A second list with its own filters and no bulk edit. Uses `listVideos` |
| Scheduled videos | `/[locale]/scheduled-videos` | `.../scheduled-videos/page.tsx` | List and calendar views, kept in the `view` and `calendarView` query values |
| Analytics | `/[locale]/analytics` | `.../analytics/page.tsx` | Summary for the account plus the current channel |
| Video analytics | `/[locale]/analytics/videos/[id]` | `.../analytics/videos/[id]/page.tsx` | One video (#241). `docs/analytics/README.md` §4 still says this page doesn't exist; that line is out of date |
| Channel settings | `/[locale]/settings/channel/[id]` and `edit`, `videos`, `playlists`, `sections`, `tabs`, `community`, `community/new` | `.../settings/channel/[id]/` | A card page linking to separate pages. `layout.tsx` adds no navigation, so each page has its own breadcrumb (`ChannelSettingsBreadcrumb`) |

The account menu links My Videos, Scheduled Videos and Analytics directly (`components/UnifiedNavigation/index.tsx` around lines 275 to 305, and a parallel copy in `rtl/index.tsx`).

### Goals

1. One place for creators, at `/[locale]/studio`, with one left navigation and one channel in context at a time.
2. One content list that replaces both video lists and the Scheduled page.
3. The same sections as native Studio (§4.1), so a creator moving between web and app finds the same things.
4. Every page and action follows the per-channel roles in #462. The navigation hides what a role can't reach, and the server refuses it anyway.
5. Every old URL keeps working through a permanent redirect.
6. English and Arabic, accessible, and themed only through semantic tokens.
7. Retention curves and traffic sources work in the first build, including collecting the data (§8.4).

### Non-goals

- **Mobile and desktop native Studio.** See Epics 18 and 19. Web doesn't take on local encoding, batch import, transcription or the video editor (19.2 to 19.5, 18.9).
- **Provider-specific live work.** Stream keys, ingest URLs, OBS export and the source of stream health data wait on decisions D2 and D3. The provider-independent Live tab is in scope (§4.4.2). Going live from a phone or from desktop stays in Epics 18.7 and 19.7.
- **Ownership transfer.** Only a super admin can transfer a channel, on the admin site (#460). Studio has no control that does it, for any channel role.
- **Site roles.** Channel roles are stored on the videos side and are never in AlUmmahNowAuth RBAC or tokens. Studio never reads a token's `roles` to decide channel access. A site admin gets no Studio access to someone else's channel.
- **Monetisation, copyright, audio library.** YouTube Studio has these areas, but this product has no backend for them.
- **The main site sidebar.** A separate navigation clean-up PR removes the duplicate browse links. This spec only defines the Studio entries in the account menu.
- **Payments.** Plan limits use the existing entitlements (§8.3). Nothing here touches billing.

## 2. Entry points

### 2.1 Account menu

The creator part of the account menu in `UnifiedNavigation` becomes:

| Caller has | Menu shows | Goes to |
|---|---|---|
| At least one owned channel | **Your channel** | The active channel's public page (`channelPath` in `lib/channel-url.ts`) |
| | **Studio** | `/[locale]/studio` |
| Only shared channels (a role through #462, none owned) | **Create channel** | The existing create flow (`handleCreateChannel`) |
| | **Studio** | `/[locale]/studio` |
| No channels and no roles | **Create channel** | The existing create flow |
| Signed out | Neither | |

My Videos, Scheduled Videos and Analytics leave the account menu. Browse links stay in the sidebar. The parallel clean-up PR removes the duplicates, so this spec doesn't describe them again.

### 2.2 Other links into Studio

These links exist today and must point straight at the new URLs:

| Where | File | New target |
|---|---|---|
| Owner actions on the channel page: Customise, Manage videos, settings | `components/Channel/ChannelOwnerActions.tsx` | `customisation/profile`, `content/videos`, `dashboard` |
| Channel card, edit | `components/channelManagement/index.tsx` and `rtl/index.tsx` | `customisation/profile` |
| Settings page, Channel card | `app/[locale]/settings/page.tsx` | `dashboard` |
| Profile page, manage playlists | `app/[locale]/profile/ProfilePageClient.tsx` | `playlists` |
| Video edit, back links | `app/[locale]/video/[id]/edit/page.tsx` | `content/videos` |
| Scheduled list | `components/scheduled-videos/ScheduledVideosList/index.tsx` | `content/videos?status=scheduled` |

The channel page's owner actions are shown only to people who hold the matching capability (§5).

`/[locale]/upload` stays where it is (decision 5). Studio's **Upload** button links to it with the Studio channel selected, and a finished upload offers a link back to Content. `/[locale]/settings/upload-defaults` and `/[locale]/settings/privacy` are account settings and stay in Settings.

## 3. URLs and the channel switcher

### 3.1 URL scheme

Every Studio page has the channel in its path, so a link always opens the same channel. All URLs are under `/[locale]`.

```text
/studio                                       resolver: goes to the right channel
/studio/go/{path}                             resolver for links with no channel, e.g. /studio/go/content/videos
/studio/video/{videoId}/{edit|analytics}      resolver for links with only a video id

/studio/{channelId}/dashboard
/studio/{channelId}/content                   goes to the first tab the role can use
/studio/{channelId}/content/videos            ?status=published|scheduled|drafts|processing|failed
/studio/{channelId}/content/videos/{videoId}/edit
/studio/{channelId}/content/videos/{videoId}/analytics
/studio/{channelId}/content/live              ?view=streams|chat
/studio/{channelId}/content/live/{streamId}
/studio/{channelId}/content/posts             ?status=published|scheduled|drafts
/studio/{channelId}/content/posts/new
/studio/{channelId}/content/posts/{postId}/edit
/studio/{channelId}/analytics
/studio/{channelId}/comments                  ?tab=inbox|held|removed
/studio/{channelId}/playlists
/studio/{channelId}/customisation             goes to customisation/profile
/studio/{channelId}/customisation/profile
/studio/{channelId}/customisation/layout      ?view=sections|tabs
/studio/{channelId}/settings                  goes to settings/general
/studio/{channelId}/settings/general
/studio/{channelId}/settings/permissions      ?tab=team|activity
```

- Static segments (`go`, `video`) win over `[channelId]` in the App Router, so they can't collide with a channel id.
- The Next route lives under `apps/web/src/app/[locale]/studio/`. A shared `[channelId]/layout.tsx` loads the channel and role once and renders the navigation, as ADR-001 intended.
- Filters, sort, search text and tabs are in the query string, so a view can be shared and survives a reload.
- Studio pages are `private, no-store` and `noindex`.

### 3.2 How the resolver chooses a channel

`/studio` and `/studio/go/{path}` send a temporary redirect (307), because the answer depends on who is asking:

1. Signed out: to sign-in, then back to the same URL.
2. The active channel, if the caller still has a role on it.
3. The main owned channel, then the first owned channel.
4. The first shared channel (#462 §7: someone with only shared channels isn't forced to create one).
5. No channel at all: the no-channel page (§3.4).

If the caller's role doesn't include the page in the link, they land on Dashboard, with a notice.

`/studio/video/{videoId}/...` reads the video's `channelId`. If the caller has a role on that channel, it redirects to the channel's URL. A video with no `channelId` is a legacy import and shows the not-available page (§3.5).

### 3.3 Channel switcher

The switcher is at the top of the left navigation, showing the channel's avatar, name and handle.

| Case | Behaviour |
|---|---|
| One channel, no shared channels | Shows the channel. No menu except **Create channel** and **View channel** |
| Several channels | Menu with owned channels first, then shared channels with the role next to them ("Editor"), as #462 §7 describes. Owned channels have no label |
| Choosing a channel | Goes to the same page and tab on the new channel, without the query string or nested video or post id. If the new role can't open that page, goes to Dashboard |
| Data source | Owned channels from the session (`useMultiAccount`), shared channels from `GET /api/channels/access` when the menu opens, because the session cookie has no room for them (#462 §7). Until #462 ships, owned channels only |
| Active channel | Choosing in the switcher also calls the existing `switchChannel`, so the header avatar follows. Opening a URL for another channel doesn't change the active channel. Studio's API calls use the channel from the URL |
| Role removed while on the page | The next request gets 403. Studio shows the no-access page. The `channels_changed` realtime event (#460, #462) refreshes the menu |

The menu also has **Leave this channel** for anyone who isn't the owner, since most roles can't open Settings (§5.1).

### 3.4 No channel

`/studio` for a signed-in user with no channel and no role shows a page with **Create channel**, using the same create flow as the menu, and a line about what Studio is. It never redirects to the home page, which is what today's pages do (`dashboard/videos/page.tsx:76`).

### 3.5 Errors at the channel level

| Case | Response |
|---|---|
| Unknown or deleted channel id | Localized 404 with a real 404 status |
| Channel exists, caller has no role | Same 404 page as above, so private channels aren't revealed. Today's pages redirect to the public channel page instead |
| Video or post isn't in this channel | 404 |
| Role can't open this page | "You don't have access to this page", with a link to Dashboard. Status 403 |
| Channel hidden by moderation | Studio stays open, with a banner saying the channel is hidden. Public links are not offered |
| D1 failure for a member (#462 §6.1) | Error page with Retry. Access is never granted. Owners are unaffected |

## 4. Navigation and pages

### 4.1 Left navigation, compared with Epic 18 and YouTube Studio

YouTube Studio is the reference: a left rail with the channel at the top and an Upload button, then Dashboard, Content (tabs for video types and playlists), Analytics, Comments, Subtitles and Customisation, with Settings at the bottom. Exact items vary by channel. We follow that structure (decision 12). The differences: playlists have their own item, and subtitles stay per video.

| Item | Route | Epic 18 | YouTube Studio |
|---|---|---|---|
| Dashboard | `dashboard` | 18.1 | Dashboard |
| Content | `content`: Videos, Live, Posts | 18.3, 18.4 (updates, polls), 18.7 and 19.7 (provider-independent parts), 19.1 | Content |
| Analytics | `analytics` | 18.5 | Analytics |
| Comments | `comments` | 18.4 | Comments |
| Playlists | `playlists` | 18.6 | Playlists |
| Customisation | `customisation`: Profile, Layout | 18.6 (avatar, banner, about, sections, tabs) | Customisation |
| Settings (pinned to the bottom) | `settings`: General, Permissions | 18.6, 19.8 | Settings, Permissions |

Not separate pages:

- **Upload** (18.2) is a button at the top of the rail.
- **Edit details, chapters, subtitles** (18.3) are in the video editor under Content.
- **Notifications** (18.8) stay in the site's notification centre.

The rail is in the order above. An item or tab a role can't reach is removed, not greyed out (§5.3).

### 4.2 Standards for every page

So the page sections below only list what's different:

- **Loading:** a skeleton in the page's real shape, not a full-page spinner. The rail and switcher stay visible.
- **Error:** an inline message with Retry. One failed card on a page doesn't blank the others. A 403 shows the no-access page.
- **Saving:** the button shows progress, success is announced (§7.2), failures keep what the person typed.
- **Unsaved changes:** forms warn before leaving.
- **Phone (below 768px):** the rail becomes a drawer opened from a top bar that shows the page title and the switcher. It opens from the inline-start edge. Tables become stacked cards. Actions in a row move into an overflow menu. Tap targets are at least 44 by 44 CSS pixels. Nothing scrolls sideways except charts or tab strips.
- **Plan limits:** a limit explains itself where it's hit, in place of a dead control (§8.3).

### 4.3 Dashboard

**Purpose.** What needs attention on this channel and how the latest video is doing (18.1).

| Card | Contents | Needs | Data |
|---|---|---|---|
| Latest video | Thumbnail, title, views, likes, comments. Watch time only with `analytics.view` | `video.view_private` | Content list, `GET /api/analytics/videos/:id` |
| Channel totals | Lifetime views, subscribers, videos, plus views over the last 28 days and the change from the 28 before | `analytics.view` | `GET /api/analytics/channels/:id` |
| Tasks | Counts of processing and failed uploads, failed schedules, comments held for review. Each links to the right tab | `video.view_private` or `comment.moderate`, per count | New summary endpoint (§8.1) |
| Recent comments | The latest five, with approve and reply | `comment.moderate` | New comments endpoint (§8.1) |
| Next scheduled | The next three scheduled videos | `video.view_private` | Content list |
| Quick links | Upload, New post, Customise | The action's capability | |

- **Empty, new channel:** a welcome with **Upload your first video**. Cards with only zeros are replaced by one line, not a row of 0s.
- **Roles with less to show:** a moderator sees only recent comments and the held count. An editor sees the latest video, tasks and next scheduled, with public counters only.
- **Phone:** one column, Tasks first.

### 4.4 Content

**Purpose.** Everything the channel publishes, in one place. As in YouTube Studio, it has three type tabs: **Videos**, **Live** and **Posts**. `content` opens the first tab the role can use: Videos for owners, admins and editors, Live for moderators. A role sees only its tabs (§5.1).

#### 4.4.1 Videos tab

The one video list. It replaces `/dashboard/videos`, `/settings/channel/[id]/videos` and `/scheduled-videos`.

**Status filter.** Published, Scheduled, Drafts, Processing and Failed. Each video has exactly one status, chosen in this order. The first match wins:

| Status | Rule (on the video record) | Note |
|---|---|---|
| Failed | `uploadStatus = failed`, or `processingStatus = failed`, or `scheduledPublishStatus = failed` | Shows the reason when one is stored |
| Processing | `uploadStatus` is `initiated`, `uploading` or `processing`, or `processingStatus` is `pending`, `processing` or `transcoding` | Status updates over the existing realtime upload events |
| Scheduled | `scheduledPublishStatus` is `scheduled` or `publishing` | List and calendar views, reusing `ScheduledVideoCalendar` and `?view=` |
| Drafts | New `isDraft = true` | **New work.** See below |
| Published | Everything else, public or private | A Private badge on `isPublic = false` |

**Drafts don't exist for videos today.** There's no draft state in `packages/shared-types/src/video.ts`. Community posts have one, videos don't. Today, a cancelled schedule only sets `scheduledPublishStatus = 'cancelled'`. This spec adds an optional `isDraft` on the video: upload offers **Save as draft**, a cancelled schedule becomes a draft, and publishing clears it. Existing videos are unchanged, with no backfill (decision 2).

Each status shows a count. An empty status stays visible, so people can learn where things go.

A finished live broadcast saved as a video stays here with a Live badge. Streams themselves are in the Live tab.

**Row.** Selection box, thumbnail with duration, title, badges (Private, Live, Short, Scheduled time in the viewer's zone), date, views, comments, likes. Owners and admins also see who uploaded it (`uploadedBy`, from #462, visible only to `members.view` holders per #462 §8).

Views, comments and likes in a row are the video's public counters, so editors see them without `analytics.view`.

**Filters and search.**

| Control | Values | Today |
|---|---|---|
| Search | Title, description, tags | Exists in `GET /api/videos/search` |
| Visibility | All, public, private | Exists |
| Type | All, videos, shorts (60 seconds or less, the rule the Shorts tab uses) | Partial: the existing duration filter's `short` means 180 seconds. New filter |
| Duration | All, under 4 minutes, 4 to 20, over 20 | Partial: today's `short` and `standard` split at 180 seconds. These buckets are new |
| Category | From `VideoCategory` | New filter |
| Language | From the video's `language` | New filter |
| Sort | Newest, oldest, most viewed, title | Exists, oldest is new |

**Per-row actions** (in an overflow menu, plus Edit on the row):

| Action | Capability | Status | Backend |
|---|---|---|---|
| Edit details | `video.edit` | All except Processing, while uploading | Editor (§4.5) |
| View on site | Public or `video.view_private` | Published | Existing watch page |
| Analytics | `analytics.view` | Published | `content/videos/{videoId}/analytics` |
| Copy link | Any | Published | Client |
| Reschedule, Cancel schedule, Publish now | `video.schedule` | Scheduled | Existing schedule routes |
| Schedule | `video.schedule` | Drafts, private Published | Existing |
| Publish | `video.schedule` | Drafts | `POST /api/videos/:id/publish-now` must accept drafts: **new behaviour** |
| Retry | `video.upload` | Failed, Processing if stalled | `GET /api/videos/upload/resume/:videoId` for uploads. New for a failed scheduled publish |
| Delete | `video.delete`: editors only their own uploads | All | Existing, with a confirmation dialog |

**Bulk actions.** Selecting rows replaces the filter bar with a bar showing the count. The maximum is 50 at a time (`MAX_BULK_VIDEOS`), and the page says so at the limit.

| Action | Capability | State |
|---|---|---|
| Change visibility | `video.edit` | Exists (`bulk-update`, `BulkEditDialog`) |
| Change category, add or remove tags | `video.edit` | Exists |
| Delete | `video.delete` | Exists (`bulk-delete`) |
| Add to playlist | `post.manage` | **New** (19.1) |
| Schedule | `video.schedule` | **New** (19.1). One time, or spaced at an interval |

The server checks each video on its own. An editor bulk-deleting a mix of videos gets a result per video, and the existing partial-failure notice reports it.

**Empty.** Each status has its own message: "No scheduled videos. Schedule one when you upload or edit." Published offers **Upload**. No results from a filter offers **Clear filters**.

**Loading.** Skeleton rows. Results are paged with a cursor on the server. The current client-side loop over 10 pages goes away (see §8.1).

**Phone.** Type tabs and status filters scroll sideways. Rows become cards with a selection mode on long press or a **Select** button. The bulk bar sticks to the bottom. The calendar defaults to the day list, as a month grid is too small.

#### 4.4.2 Live tab

**Purpose.** Plan and watch over the channel's streams, and moderate their chat. Decision 11 specs the parts that don't depend on the provider. The provider is blocked on D2 (Bunny or R2 plus Cloudflare CDN), and D3 follows from it.

**Today.** `/[locale]/live` is the public list. `api-videos` has `GET`, `POST` and `PATCH` on `/api/live-streams`, and streams have `status` (`scheduled`, `live`, `ended`, `cancelled`), `scheduledStartTime`, `allowChat` and `isPrivate`. `liveStreamCreate.ts` hard-codes a Bunny ingest URL. Chat exists only as a `live_chat` websocket message (`notify-helpers.ts`). No API stores or moderates chat.

| Surface | Contents | Needs | State |
|---|---|---|---|
| Streams | List filtered by Upcoming, Live, Ended. Title, thumbnail, scheduled or actual time, viewer count, status | `live.manage` | Exists, `channelId` and `status` filters |
| Schedule | Create and edit: title, description, time with zone, private, allow chat, tags. Cancel | `live.manage` | Exists. A stream with no ingest details says "Streaming setup isn't available yet" |
| Stream health (`content/live/{streamId}`) | State, bitrate, dropped frames, last update, from one provider-neutral response | `live.manage` | Page and response shape are specified now. Until an adapter exists after D2/D3, the panel says "Health data isn't available yet" and shows no numbers |
| Chat moderation (`?view=chat`) | Live message feed, remove a message, block from the channel (shared with §4.7), turn chat on or off for a stream | `live.moderate` | **New.** Chat runs on our own websocket server, so this doesn't depend on the provider |

**Waiting on D2/D3:** stream keys and rotation, ingest URLs, OBS profile export, start and stop signals from the provider, and health data. Studio shows no key or ingest field until then, and the hard-coded Bunny URL isn't displayed.

**Who sees it.** `live.manage` holders see all of it. A moderator has only `live.moderate`, so for them the tab opens on chat moderation and shows nothing else.

**Empty.** "No streams yet", with **Schedule a stream**. For chat, "Chat appears here while a stream is live". **Phone.** Cards, and the chat feed takes the full screen.

#### 4.4.3 Posts tab

**Purpose.** Write and manage channel posts (18.4).

Moved from `settings/channel/[id]/community` and `community/new`. The status filter is Published, Scheduled and Drafts, from `PostStatus`. Types are text, image, poll, quiz, video and GIF.

`PostCard` has an `onEdit` prop, but the current page doesn't pass it, so editing isn't reachable today. `content/posts/{postId}/edit` is a new page over the existing `PUT` route. Scheduled posts are listed as remaining work in Story 29.4, so the Scheduled filter only appears once they publish reliably.

**Empty.** Per status, with **New post**. **Phone.** Single column. The type picker is a list.


### 4.5 Video editor (under Content)

`/studio/{channelId}/content/videos/{videoId}/edit` puts the existing edit page (`app/[locale]/video/[id]/edit/page.tsx`) in the Studio frame, covering 18.3: bilingual title and description, category, tags, thumbnail, visibility, schedule, chapters, subtitles, comment settings (`on`, `held`, `off`).

Playlist assignment from this page is new. Everything else exists. It has tabs along the top: **Details**, **Analytics**.

### 4.6 Analytics

**Purpose.** How the channel and each video are performing (18.5).

**Channel overview** (`/analytics`).

- Date range: last 7, 28, 90, 365 days, all time. Longer ranges are limited by `analytics.retentionDays`, and the page explains the limit.
- Metric cards with the change from the previous period: views, watch time, average view duration, likes, comments, new subscribers.
- A daily chart with a metric selector.
- Top content table: thumbnail, title, views, watch time, average duration, sorted by any column. A row opens that video's analytics.

**Per-video** (`content/videos/{videoId}/analytics`). Reached from a row in Content, the Top content table, or the editor's Analytics tab. Reuses `VideoAnalyticsView`.

**Who can see stats (decision 6).** Owner and admin. Editors and moderators have no Analytics page, no per-video analytics and no analytics cards. This is #462's matrix with the analytics viewer role removed. Someone who needs stats is made a channel admin.

**Retention, on the per-video page.** A line chart of the share of viewers still watching at each 5% of the video, with the time shown for each point. It has a table alternative. Below 10 starts in the range, the chart is replaced by "Not enough data yet".

**Traffic sources, on the overview and per-video pages.** A ranked bar list of the sources in §8.4, with counts and shares, and a list of the top external sites. Viewers who didn't allow analytics are shown as one "Not shared" row, so the rows add up to total views.

Both note that they start from the date collection began, and that retention covers only viewers who allowed analytics.

**What the backend has** (`docs/analytics/README.md`):

| Metric | State |
|---|---|
| Lifetime views, likes, comments | Exists |
| Daily views, watch time, average view duration | Exists. Watch time is real only from #235 on, so the page notes when a range starts before that |
| New subscribers per day | Exists. Gains only, no unsubscribes, and labelled "New subscribers" |
| Retention curve (18.5) | **New, in the first build** (§8.4) |
| Traffic sources (18.5) | **New, in the first build** (§8.4) |
| Devices, geography, unique viewers, impressions, click-through, realtime | Not collected, not in decision 10, and not shown |

Nothing is shown with placeholder or zero values for data the backend doesn't collect. The "retention coming soon" line in `VideoAnalyticsView` is removed.

**Empty.** "No views yet in this period." with the option to widen the range. Prod's imported videos have `channelId: null` and a placeholder owner, so they appear in no channel's Studio until the data migration issue is done.

**Error.** One failing section shows Retry and the rest still render. The current page has a 20-second timeout and a single error state. That's replaced.

**Phone.** Cards in two columns, the chart full width, the table as a ranked list.

**Across channels (decision 3).** Studio is per channel. The combined analytics view is dropped. `GET /api/analytics/summary` stays as an API for now, but no Studio page uses it.

### 4.7 Comments

**Purpose.** Moderate comments across the channel's videos and posts from one place (18.4, Story 29.3). This page doesn't exist today. Approval only happens on the watch page.

**Tabs.**

| Tab | Contains |
|---|---|
| Inbox | Published comments, newest first |
| Held for review | `status = held`. Held by platform moderation (`heldBy = 'moderation'`) is shown read-only with a note: the API refuses creator approval with `held_by_moderation`, and that stays |
| Removed | **New, in the first build (decision 4).** Comments the channel removed in the last 90 days, with who removed them and when. **Restore** puts a comment back, with its replies |

**Filters.** Search text, a specific video or post, comments with no channel reply, has a link.

**Row.** Author, text, time, the video or post it's on, and its replies. Text follows its own direction (§7.1).

| Action | Capability | Video comments | Post comments |
|---|---|---|---|
| Approve | `comment.moderate` | Exists (`POST .../approve`) | **New** |
| Remove | `comment.moderate` | Exists (`DELETE`), owner check moves to the capability | Exists |
| Reply as the channel | `channel.speak` | Exists (`commentCreate`) | Exists |
| Pin | `comment.moderate` | **New.** The field exists, but no route sets it, and `CommentUpdateInput.isPinned` isn't used | Exists |
| Heart | `comment.moderate` | **New.** No field or route | Exists |
| Restore a removed comment | `comment.moderate` | **New** | **New** |
| Hide (hold a published comment) | `comment.moderate` | **New** | **New** |
| Report | Any signed-in role | Exists (`POST /api/moderation/reports`) | Exists |
| Block from channel | `comment.moderate` | **New** | **New** |

Blocking is per channel and silent (decision 8). The blocked person isn't told. Their new comments and replies on that channel are accepted and stay visible only to them, using the existing `held` visibility with a new `heldBy: 'channel_block'`. They don't appear in the Held tab. Storage is new, on the videos side, and enforcement goes in the comment create routes. It isn't a site ban.

**How removal changes.** Today `DELETE` on a video comment takes it out of the video for good (`removeStoredComment` in `commentDelete.ts`). Post comments are soft-deleted with `deletedAt`, with no record of who did it. So:

- A removal by someone with `comment.moderate` becomes a soft removal: the comment and its replies stay on the record, with `isDeleted`, `removedBy: 'channel'`, `removedAt` and the actor's id. Public lists already leave out `isDeleted` comments. `commentsCount` drops on removal and comes back on restore.
- A person deleting their own comment stays a real deletion and never appears in Removed.
- Comments removed or held by platform moderation never appear in Removed and can't be restored here.
- After 90 days a daily job deletes the comment for good. Account erasure deletes a person's removed comments immediately, so `eraseUserData` must cover them.
- Comments removed before launch can't be restored. The tab starts empty.

**Bulk.** Approve, remove or restore up to 50. New route.

**Backend constraint.** Video comments are stored inside each video's R2 object (`video.comments`). There's no way to read across a channel, so this page needs a new index (§8.1).

**Empty.** "No comments yet". For Held, "Nothing waiting for review". For Removed, "Comments you remove stay here for 90 days".

**Phone.** Cards, with Approve and Remove visible, and the rest in overflow.

### 4.8 Playlists

**Purpose.** Create, edit, order and delete channel playlists.

Reuses `PlaylistManager`, already used by `settings/channel/[id]/playlists`. The RTL copy (`PlaylistManager/rtl`) folds into one component (§7.1).

**Contents.** List with cover, title, video count, visibility, and row actions: edit, reorder videos, delete. Adding videos picks from the channel's Content.

Playlist updates compare `existingPlaylist.userId` with the caller today (`playlistUpdate.ts:97`), so #462's `createdBy` change applies.

**Empty.** **Create your first playlist**. **Error, loading** as §4.2. **Phone.** Cards. Reordering has move up and move down buttons as well as drag.

### 4.9 Customisation

**Purpose.** How the channel looks and reads to visitors. Two tabs, as in YouTube Studio: **Profile** and **Layout**. Both need `channel.edit`.

#### Profile tab (`customisation/profile`)

From `settings/channel/[id]/edit/page.tsx`.

| Field | Capability | Notes |
|---|---|---|
| Name (localized) | `channel.edit` | Exists |
| Handle | `channel.handle` (owner only) | Exists, entitlement `channel.handle`. Availability check on typing. Shown read-only to an admin with the reason |
| Avatar, banner | `channel.edit` | Exists, with `ImageCropDialog` and the `avatar` and `cover` routes |
| Description (localized) | `channel.edit` | Exists |
| Links | `channel.edit` | Exists, limit from `channel.about.links.max` |
| Contact email, location | `channel.edit` | Exists |

Open PR #441 adds in-place editing to the channel settings header. Whichever lands second must move that behaviour here.

**Empty.** Not applicable. **Phone.** One column, sticky Save bar.

#### Layout tab (`customisation/layout`)

What visitors see on the channel page, moved from the existing pages. Two views, chosen with `?view=`:

- **Sections** (`?view=sections`, from `settings/channel/[id]/sections/page.tsx`): create, edit, delete and reorder.
- **Tabs** (`?view=tabs`, from `settings/channel/[id]/tabs/page.tsx`): show, hide and order channel tabs.

Each has a **Preview channel page** link. `ChannelTabUpdate` messages currently fall to the processor's default case and go to the DLQ (`docs/analytics/README.md` §3). That's an existing issue, but this page depends on the tabs save working.

**Empty.** Sections: "Your channel page shows the default layout", with **Add section**. **Phone.** One column, with move up and down as well as drag.

### 4.10 Settings

**Purpose.** Things about the channel that aren't its public appearance. Two tabs: **General** and **Permissions**.

#### General tab (`settings/general`)

| Section | Capability | Contents | State |
|---|---|---|---|
| Plan and limits | `channel.view_private` | The owner's limits: uploads, storage, seats | Depends on Epic 27 PRs #390 and #429, not yet merged |
| Upload defaults | `channel.view_private` | A link to `/settings/upload-defaults`, which is per account | Exists |
| Ownership | `channel.view_private` | Who owns the channel, and that only the Al Ummah Now team can transfer it | Text only |
| Danger zone: delete channel | `channel.delete` (owner) | Confirm by typing the channel's name. The current controls are in `ChannelOwnerActions` and `ChannelCard` | Exists |

`isMain` (the owner's main channel) keeps its current place, in channel management.

Leave isn't here: it's in the switcher (§3.3).

**Phone.** One column.

#### Permissions tab (`settings/permissions`)

**Purpose.** Who can work on this channel. Exactly as #462 §14 specifies it, with these changes in location: `settings/channel/[id]/members` becomes `studio/{channelId}/settings/permissions`, and its Members and Activity tabs become `?tab=team` and `?tab=activity`. `settings/channel-invites` stays in account settings, because invitations belong to the person, not a channel.

The page shows, in plain words: "Ownership can't be changed here. Contact the Al Ummah Now team." There's no transfer control, and the owner row has no menu.

**States.** As #462 §14: empty, loading, member limit reached, sending, invitation sent, already invited, role saving, removed, forbidden. **Phone.** Cards, and the invite form in a sheet.

**Until #462 ships,** this tab doesn't appear (decision 1). Its page title is "Permissions", and it needs `members.view`, so Settings shows only General to anyone without it.

## 5. Permissions matrix

### 5.1 Pages

The roles and capability names are from #462 §4, which stays the source of truth. If #462's matrix changes, this table follows.

| Page or tab | Needs | Owner | Admin | Editor | Moderator |
|---|---|:-:|:-:|:-:|:-:|
| Dashboard | Any role, cards filtered | Yes | Yes | Yes | Yes |
| Content | At least one tab below | Yes | Yes | Yes | Yes |
| Content, Videos tab | `video.view_private` | Yes | Yes | Yes | No |
| Video editor | `video.edit` | Yes | Yes | Yes | No |
| Content, Live tab: streams, schedule, health | `live.manage` | Yes | Yes | No | No |
| Content, Live tab: chat moderation | `live.moderate` | Yes | Yes | No | Yes |
| Content, Posts tab | `post.manage` | Yes | Yes | Yes | No |
| Analytics, per-video analytics | `analytics.view` | Yes | Yes | No | No |
| Comments | `comment.moderate` | Yes | Yes | No | Yes |
| Playlists | `post.manage` | Yes | Yes | Yes | No |
| Customisation: Profile and Layout tabs | `channel.edit` | Yes | Yes | No | No |
| Settings, General tab | `channel.view_private` | Yes | Yes | No | No |
| Settings, Permissions tab | `members.view` | Yes | Yes | No | No |

### 5.2 Actions

| Action | Capability | Owner | Admin | Editor | Moderator |
|---|---|:-:|:-:|:-:|:-:|
| Upload | `video.upload` | Yes | Yes | Yes | No |
| Edit video details, chapters, subtitles, thumbnail | `video.edit` | Yes | Yes | Yes | No |
| Bulk change visibility, category, tags | `video.edit` | Yes | Yes | Yes | No |
| Delete video, single or bulk | `video.delete` | Yes | Yes | Own uploads | No |
| Schedule, reschedule, publish now, bulk schedule | `video.schedule` | Yes | Yes | Yes | No |
| Add to playlist, manage playlists, posts | `post.manage` | Yes | Yes | Yes | No |
| Approve, remove, restore, pin, heart, hide, block | `comment.moderate` | Yes | Yes | No | Yes |
| Reply as the channel | `channel.speak` | Yes | Yes | Yes, on the watch page (editors can't open Comments) | Yes |
| Edit name, avatar, banner, about, links, sections, tabs | `channel.edit` | Yes | Yes | No | No |
| Change handle | `channel.handle` | Yes | No | No | No |
| Delete channel | `channel.delete` | Yes | No | No | No |
| Invite or change editors, moderators | `members.manage` | Yes | Yes | No | No |
| Invite or change admins | `members.manage_admins` | Yes | No | No | No |
| Create, schedule, cancel a stream | `live.manage` | Yes | Yes | No | No |
| Remove a chat message, turn chat off, block | `live.moderate` | Yes | Yes | No | Yes |
| See stream keys, rotate them (waits on D2/D3) | `live.manage` | Yes | Yes | No | No |
| See activity log | `members.view` | Yes | Yes | No | No |
| Leave channel | Non-owner | No | Yes | Yes | Yes |
| Transfer ownership | **Super admin, admin site only** | No | No | No | No |

### 5.3 Enforcement

- **Display.** The role and capability list come from `GET /api/channels/access` (#462). `can()` in `packages/shared-types/src/channel-roles.ts` hides navigation items, page content and actions. This is only for display.
- **Page guard.** `[channelId]/layout.tsx` checks the page's capability on the server before rendering. It replaces `isChannelOwner` (`lib/channel-utils.ts`) and the client-side checks that redirect after load.
- **API.** Every route used by Studio calls `requireChannelAccess` with its capability. A route with no declaration stays owner-only (#462 §6.3). A hidden button is never the protection.
- **Until #462 ships,** the role is `owner` or none, from `channel.userId`, through the same helper shape, so pages need no rewrite.
- **Analytics (decision 6).** There is no analytics viewer role. `analytics.view` is held by owner and admin only, so Top content can show private titles without masking.
- **Moderators and private videos.** A moderator has no `video.view_private`, and `commentDelete.ts:74` refuses comment actions on private videos for anyone but the owner. Comments on private videos are therefore left out of a moderator's inbox.
- **Site roles.** Studio has no check for site roles. The separation tests in #462 §15 cover it, and §9.3 adds a Studio case.

## 6. Redirects

### 6.1 Rules

- Permanent (308) from every old URL. A redirect that needs to know who is asking points at a stable resolver URL, and the resolver then uses a 307 (§3.2).
- The old routes' page files are removed once redirects are in. Redirects live in `routeRequest` in `apps/web/src/middleware.ts`, or in `next.config.ts`, which has none today. Either way, they apply to all supported locales.
- Query strings are kept, with the mappings below.
- Old URLs with no locale reach the redirect through the existing locale hop.
- A signed-out visitor goes through sign-in and returns to the destination.
- At most one permanent hop plus the resolver's temporary hop, on top of any locale hop.

### 6.2 Map

| Old (under `/[locale]`) | New | Query and notes |
|---|---|---|
| `/dashboard/videos` | `/studio/go/content/videos` | The old page keeps its filters out of the URL, so there's nothing to map |
| `/scheduled-videos` | `/studio/go/content/videos?status=scheduled` | Keeps `view`, `calendarView`. Drops the obsolete `calendarType` |
| `/analytics` | `/studio/go/analytics` | |
| `/analytics/videos/[id]` | `/studio/video/[id]/analytics` | |
| `/video/[id]/edit` | `/studio/video/[id]/edit` | |
| `/settings/channel/[id]` | `/studio/[id]/dashboard` | |
| `/settings/channel/[id]/edit` | `/studio/[id]/customisation/profile` | |
| `/settings/channel/[id]/videos` | `/studio/[id]/content/videos` | |
| `/settings/channel/[id]/playlists` | `/studio/[id]/playlists` | |
| `/settings/channel/[id]/sections` | `/studio/[id]/customisation/layout?view=sections` | |
| `/settings/channel/[id]/tabs` | `/studio/[id]/customisation/layout?view=tabs` | |
| `/settings/channel/[id]/community` | `/studio/[id]/content/posts` | |
| `/settings/channel/[id]/community/new` | `/studio/[id]/content/posts/new` | |
| `/settings/channel/[id]/members` (if #462 ships it first) | `/studio/[id]/settings/permissions` | |

Not redirected: `/upload`, `/settings`, `/settings/upload-defaults`, `/settings/privacy`, `/settings/channel-invites`.

Native apps, emails and notifications that hold old links keep working through this table. Stored notifications are keys and params, so new ones get new links with no migration.

## 7. Arabic, accessibility and theming

### 7.1 Arabic and RTL

- `en` and `ar` at launch, from `LOCALES`, with all strings in `packages/shared-types/src/i18n-static`.
- **One component per screen.** No new `rtl/` copies. Studio uses logical properties (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`) and `dir`. Existing doubles that it adopts (`AnalyticsDashboard/rtl`, `PlaylistManager/rtl`) fold into one.
- The rail is on the right in Arabic, and the drawer opens from the right. Direction icons mirror. Media and chart time axes follow the design used on the rest of the site and stay consistent across Studio.
- User-written text uses `dir="auto"`, so an English title in an Arabic page reads correctly. Emails, handles and URLs are wrapped in `dir="ltr"`, as in #462 §14.
- Numbers and dates use `Intl` for the page's locale. Times show the zone. Scheduling uses `scheduledPublishTimezone` as it does today.
- The calendar already takes `isRTL`, and keeps that behaviour.
- Bilingual fields (`nameLocalized`, `descriptionLocalized`) edit both languages side by side.
- A native speaker reviews all new Arabic strings.

### 7.2 Accessibility

To WCAG 2.2 AA (Epic 1):

- The rail is `<nav>` with a label and `aria-current="page"`. Skip link to main content. One `h1` per page, and focus moves to it on page change.
- Tabs follow the ARIA tabs pattern. The switcher and overflow menus are keyboard-operable, Escape closes them and focus returns.
- Tables are real tables on wide screens. Selection boxes are named for their row ("Select {title}").
- Every drag has a button alternative (WCAG 2.5.7).
- Saves, errors and bulk results are announced in a polite live region. Destructive confirmations use `AlertDialog`.
- Charts have a text summary and a data table alternative, and don't rely on colour alone.
- Status badges have text, not only a colour.
- Motion respects `prefers-reduced-motion`.

### 7.3 Theming

- Every colour, radius and shadow comes from semantic tokens through `packages/fanous-tokens` and the shadcn variables, with no `dark:` pairs of raw colours. Existing pages use raw classes such as `bg-gray-100 dark:bg-gray-900`, which are not carried over as they move.
- Studio must render correctly under all four themes, in light and dark: **lantern** (base), **zujaj** and **nahas** (looks) and **fawanees** (event, extending lantern). The registry is in open PR #455, and the `check:theme-colors` gate is in open PR #456. Studio files start with no allowlist entries.
- The theme is chosen at build time (`ACTIVE_THEME`). Studio has no theme picker and no "Studio theme". Customisation is about the channel's own avatar and banner, and doesn't change the Studio's look.
- Chart colours use tokens and pass non-text contrast in every theme.

## 8. Analytics events, APIs and entitlements

### 8.1 Endpoints per page

All `api-videos`. Paths are as registered in `apps/api-videos/src/routers/`.

| Page | Method and path | State | Note |
|---|---|---|---|
| Frame, switcher | `GET /api/channels/:id/owner` | Exists | Private fields for the owner |
| | `GET /api/channels/access` | #462 | Role and capabilities |
| | `POST /api/channels/:id/leave` | #462 | |
| Content, Videos tab | `GET /api/channels/:id/content` | **New** | Status, filters, search, sort, cursor. Needs `video.view_private` |
| | `GET /api/channels/:id/content/summary` | **New** | Counts per status. Also used by Dashboard |
| | `GET /api/videos/search`, `/api/videos/scheduled` | Exists, retired from Studio | Today's source. Owner checks only, and filtering happens after loading |
| | `POST /api/videos/bulk-update`, `/bulk-delete` | Exists, #462 | Limit 50 |
| | `POST /api/videos/bulk-playlist`, `/bulk-schedule` | **New** | |
| | `DELETE /api/videos/:id` | Exists, #462 | |
| | `POST`, `GET`, `PATCH`, `DELETE /api/videos/:id/schedule` | Exists, #462 | |
| | `POST /api/videos/:id/publish-now` | Exists, #462 | Must accept drafts: **new behaviour** |
| | `GET /api/videos/upload/resume/:videoId`, `GET /api/videos/:id/upload-status` | Exists, #462 | |
| | `isDraft` on video create, update and upload | **New** | |
| Video editor | `GET`, `PUT /api/videos/:id`, `POST /:id/thumbnail` | Exists, #462 | |
| | `GET`, `PUT /api/videos/:id/chapters` | Exists, #462 | |
| | Subtitles routes under `/api/videos/:videoId/subtitles` | Exists, #462 | |
| Analytics | `GET /api/analytics/channels/:channelId` | Exists, #462 | |
| | `GET /api/analytics/metrics` | Exists, #462 | Daily series |
| | `GET /api/analytics/videos/:videoId` | Exists, #462 | |
| | `GET /api/channels/:id/analytics/top-content` | **New** | Sortable, paged. Today's top list is five videos in `/api/analytics` |
| | `GET /api/analytics/videos/:videoId/retention` | **New** | §8.4 |
| | `traffic` on the channel and video analytics responses | **New** field | §8.4 |
| Comments | `GET /api/channels/:id/comments`, `/comments/summary` | **New** | Across videos and posts |
| | `POST /api/videos/:id/comments/:cid/approve`, `DELETE .../:cid` | Exists, #462 | |
| | `POST /api/videos/:id/comments` | Exists, #462 | Reply as channel |
| | Post comment list, delete, pin, heart | Exists, #462 | `community.router.ts` |
| | Video comment pin and heart | **New** | |
| | Hold (video and post), approve (post) | **New** | |
| | Restore: `POST /api/videos/:id/comments/:cid/restore` and the post comment equivalent | **New** | §4.7 |
| | Soft removal in the video and post comment `DELETE` routes | **New behaviour** | §4.7 |
| | `POST /api/channels/:id/comments/bulk` | **New** | |
| | `GET`, `POST`, `DELETE /api/channels/:id/blocks` | **New** | |
| | `POST /api/moderation/reports` | Exists | |
| Playlists | `GET /api/channels/:id/playlists` | Exists, #462 | |
| | `POST`, `PATCH`, `DELETE /api/playlists...`, add and remove video | Exists, #462 | |
| Customisation, Layout tab | Sections: `GET`, `POST`, `PUT`, `DELETE`, `PATCH reorder` under `/api/channels/:channelId/sections` | Exists, #462 | |
| | `GET`, `PUT /api/channels/:id/tabs` | Exists, #462 | |
| Content, Posts tab | `GET`, `POST`, `PUT`, `DELETE /api/channels/:channelId/posts...` | Exists, #462 | Mount per `community.router.ts`. Media upload routes too |
| Customisation, Profile tab | `PUT /api/channels/:id`, `PUT .../avatar`, `.../cover` | Exists, #462 | The handle needs a separate owner-only check within `PUT` |
| | `GET /api/channels/handles/:handle/availability` | Exists | |
| Content, Live tab | `GET`, `POST /api/live-streams`, `PATCH /api/live-streams/:id` | Exists, #462 | Create stops returning ingest details to Studio |
| | `GET /api/live-streams/:id/health` | **New** | Provider-neutral shape. Returns "unavailable" until D2/D3 |
| | `GET`, `DELETE` chat messages, `PATCH` chat on or off under `/api/live-streams/:id/chat` | **New** | Needs chat messages to be stored |
| Settings, Permissions tab | All of §14 of #462 | #462 | |
| Settings | `DELETE /api/channels/:id` | Exists | Stays owner only |
| | `GET /api/entitlements` | Open PR #390 | |

**Supporting storage (new).**

- **Content list.** The `content_ownership` table in `SEARCH_DB` already has channel, public, live, duration, `scheduleStatus`, `uploadStatus`, views and dates (`packages/shared-types/src/search/ownership.ts`). It doesn't have `processingStatus`, `isDraft`, the failure reason or `uploadedBy`. Adding those columns gets the list and counts from one D1 query, instead of loading objects from R2 and filtering them. Title search stays on the search index.
- **Comments.** A new `channel_comments` table in `SEARCH_DB`: one row per comment, on a video or post, with channel, status, author, and time. Like `content_ownership`, R2 stays the source of truth, it's written when R2 changes, and can be rebuilt. It holds ids and status, and text is read from the source.
- **Live chat.** A `live_chat_messages` table in `SEARCH_DB`, written when a message is sent, kept for 30 days after the stream ends.
- **Blocks.** A `channel_blocks` table in `CHANNEL_ROLES_DB` (#462 open question 8), since it's the only copy and can't be rebuilt. Studio ships before #462 finishes (decision 1), so that database must be created for this table first.

### 8.2 Studio usage events

These measure whether Studio works for people. They're sent through the existing `POST /api/analytics/events` as `ClientAnalyticsEvent`, only with analytics consent. The processor only archives these messages today, so a report on them is later work.

| Event | Properties |
|---|---|
| `studio_page_view` | `page`, `tab` |
| `studio_channel_switched` | `from_role`, `to_role` |
| `studio_content_filter` | `tab`, filter names only (never the search text) |
| `studio_bulk_action` | `action`, `count`, `succeeded`, `failed` |
| `studio_video_action` | `action`, `tab` |
| `studio_comment_action` | `action`, `source` (video or post) |
| `studio_redirect_landing` | `old_path_pattern` |
| `studio_limit_hit` | `entitlement` |

Events carry no email, handle, comment text or search text.

### 8.3 Plan limits

Every feature is tiered and managed by admins through Epic 27, so each new capability gets a key. Enforcement is on the server, and the existing catalogue is in `packages/shared-types/src/entitlements.ts`.

| Key | State | Used by |
|---|---|---|
| `analytics.retentionDays` | Exists | Date ranges |
| `channel.handle`, `channel.about.links.max` | Exists | Customisation |
| `comments.settings`, `comments.heldForReview` | Exists | Editor, Comments |
| `upload.*`, `storage.gb` | Exists | Upload, Settings |
| `studio.teamSeats` | Exists, the seat limit per decision 7 | Settings, Permissions tab |
| `analytics.retentionCurve` (boolean) | **New** | Retention chart |
| `analytics.trafficSources` (boolean) | **New** | Traffic sources |
| `studio.commentsInbox` (boolean) | **New** | Comments page |
| `comments.blockUsers` (boolean) | **New** | Block |
| `comments.restoreRemoved` (boolean) | **New** | Removed tab |
| `studio.bulkSchedule` (boolean) | **New** | Bulk schedule |
| `studio.drafts.max` (number) | **New** | Drafts |

All new keys have a permissive fallback, following the catalogue's rule that an outage must not lock creators out. A hit limit explains the limit and which plan setting it comes from, and offers no payment link.

Cost: the new reads are D1 and replace many R2 reads per list. This is well within the $500 per month cap.

### 8.4 Retention and traffic data collection

Part of the first build (decision 10).

**What exists.** `VideoAnalytics` (`services/analytics/video-analytics.ts`) already batches player events, only with analytics consent, and sends a bare `ready` without it. The Next route `app/api/analytics/video/route.ts` drops everything except `ready` and watch-time reports, and hard-codes `referrer` and `deviceType`. Rollups (`apps/processor/src/lib/analytics-rollup.ts`) keep `views`, `watchTime`, `sources` (`watch` or `embed`) and `embedOrigins`.

**Retention.**

| Stage | Behaviour |
|---|---|
| Player | Splits the video into 20 buckets of 5%. A bucket counts when real playback passes through it. Seeking doesn't fill skipped buckets, and watching twice counts once per session. Skips videos with no valid duration and live streams |
| Report | A `retention` event with `sessionId` and the newly reached buckets. Sent when four or more are new, and on pause, end, tab hide and unload |
| Next route | Forwards to `POST /api/videos/:id/retention` |
| api-videos (**new route**) | Validates bucket numbers, rate-limits per session and video with the `WATCH_TIME_LIMITER` binding under its own key, and queues the new `MessageType.VideoRetention`. No counts for deleted or hidden videos |
| Processor | Folds into `analytics/retention/video/<id>/<YYYY-MM>.json`: `{ days: { day: { starts, buckets[20] } } }`. `starts` increases when bucket 0 first arrives in a session. Uses the same per-key chaining as the rollups, with the same small risk of losing an increment between isolates |
| Read | `GET /api/analytics/videos/:videoId/retention` sums the days in range. Each point is `buckets[i] / starts`. Under 10 starts it returns no curve |

**Traffic sources.**

| Source | How it's decided |
|---|---|
| `home`, `search`, `subscriptions`, `channel`, `playlist`, `up_next`, `explore`, `library`, `notification` | The previous page within the site, tracked in memory by a small client helper, because `document.referrer` doesn't change on in-app navigation |
| `embed` | The existing embed context |
| `external` | First page of the visit, and `document.referrer` is another site. Only the host is kept, never the path or query |
| `direct` | First page of the visit, with no referrer |
| `unknown` | No analytics consent, or an old client. Shown as "Not shared" |

The batch `context` carries `trafficSource` and `referrerHost`. The route forwards them instead of the hard-coded values, and `POST /api/videos/:id/view` accepts them, validated against the list above and with a length limit. Rollups gain `traffic` (a count per source) and `externalHosts` (top 50 per day, the rest under `other`, using `incrementBounded`), for both video and channel. The existing `sources` and `embedOrigins` are unchanged.

**Privacy.** Stored data is aggregate counts and hostnames, with no user id or session id. `sessionId` is used only for the rate limit and within the processor's message. Everything except the anonymous view count needs analytics consent. `docs/compliance/GDPR.md` and `docs/analytics/README.md` are updated with the work.

**History.** There's no backfill, because the events were never kept. Charts start on the day collection is deployed.

**Cost.** At most a handful of retention messages per session, each one R2 read and write on a per-video monthly document. Well within the $500 per month cap.

## 9. Testing requirements

Tests are written first (`BEFORE_YOU_CODE.md`). E2E specs follow the release suite rules: `apps/web/e2e/release/`, against QA and stage, never production. Each spec registers throwaway `@e2e.alummahnow.net` users and creates its own data.

### 9.1 Unit and API

- Status rule for the Videos tab (§4.4.1): table-driven over every combination of `uploadStatus`, `processingStatus`, `scheduledPublishStatus` and `isDraft`, each giving exactly one status.
- Navigation visibility and page guard: table-driven over every role and page in §5.1, including no role.
- Every new route in §8.1: each role against the capability, and a route with no declaration refuses members (#462 §6.3).
- Bulk: partial success per video, the limit of 50, and an editor's mixed delete.
- Resolver: every branch in §3.2.
- Index sync for the new columns and `channel_comments`, including rebuild.
- Retention: buckets from seeks and rewatches, invalid duration, no consent, the 10-start minimum, and the sum across months.
- Traffic: every row of the source table, host only and never a path, unknown values refused, and the top-50 limit.
- Comment removal: moderator removal is soft and restorable with replies and counts correct, the author's own deletion is permanent, platform-moderated comments can't be restored, the 90-day purge, and erasure.
- Processor: a case exists for `VideoRetention`.

### 9.2 E2E per page

New specs under `apps/web/e2e/release/studio-*.spec.ts`, each added to the Release regressions table in `CLAUDE.md`.

| Page | Must cover |
|---|---|
| Entry | Account menu for no channel, one channel, shared only. No channel page. Sign-in return |
| Switcher | Switching keeps the page. Role with no access lands on Dashboard. Removed member sees no-access |
| Dashboard | New channel welcome, cards after an upload, cards per role |
| Content, Videos tab | A video through Processing to Published. Each status. Filters. Bulk edit and delete. Schedule, reschedule, cancel, publish now. Calendar and list. Draft to publish |
| Editor | Save details and return to the same tab |
| Analytics | Real view count after a played video. Range limit. Per-video page from Content and from Top content. After real playback with consent, the retention chart and the right traffic source appear. Without consent, "Not shared" |
| Comments | Held comment approved. Remove then restore, and it reappears on the watch page. Reply, pin, block. Platform-held comment is read-only |
| Playlists | Create, add from Content, reorder with buttons, delete |
| Customisation, Layout tab | Add and reorder a section. Hide a tab. Check the public channel page |
| Content, Posts tab | Create a text post and a poll. Edit. Delete |
| Customisation | Each field. Handle is refused for an admin, in the UI and at the API |
| Content, Live tab | Schedule, edit and cancel a stream. Health shows its unavailable state and no numbers. No key or ingest field exists. Chat removal and block as a moderator |
| Settings, Permissions tab | From #462 §15, moved to the new URL. No transfer control exists |
| Settings | Delete channel with typed confirmation. Refused for an admin |

### 9.3 Roles

For each of the four roles and a user with no role: open every Studio URL, assert the navigation items and tabs exactly match §5.1, and call a sample write per page directly at the API, expecting the server's result, with the UI bypassed.

Separation: a token with `Super Admin` and no channel role gets the 404 of §3.5 on someone else's Studio, and no ownership transfer control exists anywhere in Studio.

### 9.4 Redirects

For each row in §6.2, in both locales: the status is exactly 308, the destination is correct, the query mapping holds, and it ends on a working page. Also signed-out, without a locale, a channel the user can't access, and a video with `channelId: null`. Existing specs that use the old URLs move to the new ones, keeping one redirect check each: `08-unified-navigation`, `14-video-management`, `19-dashboard-videos-ownership`, `21-channel-handles-owner`, `43-video-edit-schedule`, `45-dashboard-videos-extended`, `46-scheduled-videos-extended`, `51-channel-page`, `52-channel-sections`, `53-channel-settings`, `54-playlists`, `55-community`, `62-account-menu`, `64-settings-privacy`, `67-analytics`, `scheduled-videos-calendar`, `release/uploads`, and `test-utils/page-catalog.ts`.

### 9.5 RTL, accessibility, themes and browsers

- **RTL:** each page in `ar`: `dir="rtl"`, rail on the right, no sideways scroll, mixed-direction text correct.
- **Accessibility:** axe on every page with no serious or critical issues (the `a11y` project), and keyboard-only runs of the switcher, bulk bar and a dialog.
- **Themes:** visual checks of every page in all four themes, light and dark (the `visual` project), and `check:theme-colors` passes.
- **Browsers:** Chromium, Firefox and WebKit, plus Mobile Chrome and Mobile Safari for the phone layouts. `playwright.config.ts` has these projects, but `playwright.release.config.ts` has only `auth-flows` and `player`, so the release config needs Firefox and WebKit projects for the Studio specs. The Firefox no-referrer case for signed Bunny thumbnails is included.

## 10. Owner decisions

All decided 2026-11-09. There are no open questions left.

1. **Roles and Studio.** Decided 2026-11-09: ship owner-only first. The Permissions tab arrives when #462 lands.
2. **Video drafts.** Decided 2026-11-09: add a real draft state, `isDraft`. Existing videos stay as they are.
3. **All-channels views.** Decided 2026-11-09: per-channel only. The all-channels list and the combined analytics are dropped.
4. **Removed comments tab.** Decided 2026-11-09: yes, in v1. Creators can see and restore removed comments (§4.7).
5. **Upload.** Decided 2026-11-09: `/upload` stays outside Studio and is linked from it. The video editor moves into Studio.
6. **Analytics viewer role.** Decided 2026-11-09: the role is dropped, so the question about private videos is moot. Channel roles are owner, admin, editor and moderator. Stats are visible to owner and admin. Editors and moderators have no Analytics access, following #462's matrix (§4.6).
7. **Team seat limit.** Decided 2026-11-09: keep the existing `studio.teamSeats`.
8. **Blocking.** Decided 2026-11-09: per channel, silent, and not a site ban.
9. **Names.** Decided 2026-11-09: YouTube Studio's names: Dashboard, Content, Analytics, Comments, Playlists, Customisation, Settings.
10. **Retention and traffic sources.** Decided 2026-11-09: in v1, with data collection and the Analytics UI part of the first build (§8.4, §4.6).
11. **Live.** Decided 2026-11-09: spec and build the provider-independent parts now (§4.4.2). Stream keys, ingest URLs and OBS export wait on D2/D3. D2 is waiting on a reply from Cloudflare.
12. **Structure.** Decided 2026-11-09: follow YouTube Studio. Layout is a tab in Customisation. Posts and Live are tabs in Content, alongside Videos, and Drafts and the other statuses are filters. Members & roles is the Permissions tab in Settings.
