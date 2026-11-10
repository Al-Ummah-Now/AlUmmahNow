# Channel sections

**Status:** Spec v1, 2026-11-10. Built in the same change set (see §14).
**Scope:** the channel Home tab, the section manager (`/[locale]/settings/channel/[id]/sections`), the
"Add channel section" dialog, and the channel-section API in `api-videos`.
**Related:** `docs/specs/CHANNEL-ROLES.md` (PR #462, channel roles), `docs/design/DESIGN-INTENT.md`
(Channel sections), `docs/themes/README.md` (theme packages), `docs/architecture/SCALABILITY-AUDIT.md`
(AV-20 order document), `apps/api-videos/COMMUNITY_POSTS_DESIGN.md`.

---

## 1. Summary

A channel's Home tab is a stack of **sections** that the channel owner picks, orders and titles.
Today seven types exist. Two of them are not built (`single_playlist` and `multiple_playlists`
populate nothing on the server), and one is wrong (`liked_videos` shows the channel's own uploads
under a "Liked videos" heading). Two of them expose personal data with no consent. The web caps a
channel at 10 sections and the API at 5.

This spec:

1. Fixes the existing seven types.
2. Adds **Channel spotlight** (trailer for visitors, featured video for subscribers), **Shorts**,
   **Live and upcoming** / **Past live streams**, **Created playlists**, **Featured channels** and
   **Community posts**.
3. Puts **Subscribed channels** and **Liked videos** behind an explicit opt-in that only the owner
   can give.
4. Moves all section data to the server (`GET /sections/populated`), so the API decides what is empty
   and visitors never see an empty section.
5. Groups the add dialog into Videos, Playlists, Channels and Community, with pickers instead of
   comma-separated ids.

## 2. What exists today (2026-11-10, `origin/main` a329554a)

| Area | Specced | Built | Missing or wrong |
|---|---|---|---|
| Section CRUD + reorder API (`endpoints/channel-section/*`) | `docs/architecture/channel-sections-*.md`, ADR-001 | Yes. Order document `_order/<channelId>` with conditional writes (AV-20) | Ownership check is `channel.userId === userId`. No channel roles yet (#462 is a spec) |
| `GET /api/channels/:id/sections/populated` | Yes | Populates `recent_uploads`, `popular_uploads`, `subscribed_channels` | `featured_videos` and both playlist types not populated (the web fetches them one by one). `liked_videos` always empty on the server |
| Section limit | "max 10" in the UI | Web 10, API 5 (`CHANNEL_SECTION_CONSTRAINTS.MAX_SECTIONS_PER_CHANNEL`) | Sixth create fails with a raw English error |
| Web renderer (`components/ChannelSections`) | Design intent: hairline headings, fading shelves, larger first featured item | 13 components, including Live/Upcoming/Completed events and All playlists, which no API type creates | Empty sections show a dashed box to **visitors**. Hard-coded palette colours (allowlisted) |
| `LikedVideosSection` | — | Calls `listVideos({ channelId })` | Shows the channel's own uploads as "Liked videos" |
| `subscribed_channels` | — | Lists the owner's public subscriptions | Exposes what the owner subscribes to with no consent step |
| Add dialog / form | — | 7 flat cards. Form asks for raw ids, comma-separated | No pickers, no grouping. Option-card redesign is in flight in another branch (§9) |
| Community posts | `COMMUNITY_POSTS_DESIGN.md` | Posting (text, image, poll, quiz, video, GIF), likes, comments, pin (`pinned` on the post), Community tab and studio pages | No Home section. `list-posts` sorts pinned posts first only within a page |
| Shorts | Channel Shorts tab | `GET /api/channels/:id/shorts`, index query `shortsOnly` | No Home section. Short rule is being changed in #591; sections reuse `shortsOnly` and follow it |
| Live | Live tab | `GET /api/live-streams` (`livestream:` keys in the videos bucket) | No API section type. Web components exist but are unreachable |
| Channel trailer / featured video | — | — | Not built |
| Featured channels | — | Web `MultipleChannelsSection` and the Channels tab read `channelIds` | No API type creates `channelIds` |
| Channel roles | `CHANNEL-ROLES.md` (#462, not merged) | — | Sections fall under `channel.edit` (owner, channel admin) |

## 3. Research

**YouTube** (Studio → Customization → Home tab, [help](https://support.google.com/youtube/answer/3219384)):

- A **video spotlight** above the sections: a *channel trailer* for people who have not subscribed,
  and a *featured video for returning subscribers*. Each viewer sees the one that fits them.
- **Up to 12 featured sections**, drag to reorder, changes go live on **Publish**.
- Section types: Videos, Popular videos, Shorts, Popular Shorts, Live now, Past live streams,
  Upcoming live streams, Single playlist, Created playlists, Multiple playlists (custom title),
  Subscriptions, **Featured channels** (custom title, hand-picked list), **Posts** (a carousel of the
  latest community posts, linked to the Posts tab), For you, Members-only.
- Subscriptions are shown only when the account's subscriptions are public. Public liked videos were
  removed years ago: likes are private.
- Empty sections are hidden from viewers.

**Facebook Pages:** a *Featured* area holds pinned posts until the page removes them. Pinning does not
change the post itself.

**Vimeo:** showcases are hand-curated collections. There is no automatic layout.

**What we take for Al Ummah Now** (religious and educational, Arabic and English):

- Spotlight matters more here than on an entertainment site. A scholar's channel introduces itself
  with a trailer, and subscribers get the current lesson or the latest series episode.
- Series and courses are playlists, so playlist sections are first-class: a single playlist renders
  as a shelf of its lessons, in playlist order.
- Live is central (lessons, khutbahs, Ramadan programmes), so *Live and upcoming* shows what is on
  now first, then what is scheduled soonest.
- Featured channels are how a mosque or institute points to its scholars' channels. The list is
  hand-picked and never derived from anyone's subscriptions.
- Community posts carry announcements (lesson times, Eid notices). A pinned announcement can lead the
  Home tab.
- No "For you" section: recommendations live on the site home, and a channel's own page stays
  curated by the channel.

## 4. Section types

Keys are the API `type`. Existing keys keep their names so stored sections keep working.

Common to every type:

- **Title:** optional (required where noted), 1–100 characters, no `<` or `>`. Empty or old
  generated titles (`"recent_uploads section"`) render the localized default from §11.
- **Item count:** `itemCount`, 1–20, default 12, where the type shows a list. Clamped by the type's
  own limit.
- **Empty state:** the API leaves out an empty section for everyone except people who can edit the
  channel (§7). They see the section with a hint (`emptyHint` key, §11) and a link to fix it.
- **Visibility:** the section is public when the channel is public. On a private channel only the
  owner (and, once roles exist, channel members) can load the Home tab, as today.
- **Removed content:** deleted, moderation-hidden, private and still-processing items are always
  filtered at read time, so a removed video or channel disappears everywhere at once without any
  background clean-up.

### 4.1 Videos group

| Type | Label (en) | Purpose | Config | Data source | Empty when | Limit per channel |
|---|---|---|---|---|---|---|
| `channel_spotlight` (**new**) | Channel spotlight | Trailer for visitors and non-subscribers, featured video for subscribers | `trailerVideoId`, `returningVideoId`. At least one. Each must be a public, ready video of **this** channel | Both videos loaded server-side. The web picks: signed-in subscriber → returning video (falls back to trailer), everyone else → trailer (falls back to returning). One response for all viewers, so it caches | Neither video is listable | 1. Always rendered first and pinned above the drag list |
| `featured_videos` | Featured videos | Hand-picked videos, first one larger | `videoIds`, 1–20, any public video on the site, in the owner's order | `getVideosByIds`, order kept | No listable video left | Any |
| `recent_uploads` | Latest videos | Newest uploads | `itemCount` | Ownership index, `sort: latest`, long-form | No public videos | 1 |
| `popular_uploads` | Popular videos | Most viewed | `itemCount` | Ownership index, `sort: popular`, long-form | No public videos | 1 |
| `shorts` (**new**) | Shorts | Shorts shelf with 9:16 tiles | `sort`: `latest` \| `popular`, `itemCount` | Ownership index, `shortsOnly` (follows the Short rule from #591) | No public Shorts | 1 per sort |
| `live_streams` (**new**) | Live and upcoming / Past live streams | What is on now and next, or recordings | `liveFilter`: `live_and_upcoming` \| `past`, `itemCount` | `livestream:` objects of this channel (bounded list, §8.3). `live_and_upcoming`: live first, then scheduled soonest. `past`: ended, most recent first | Nothing in the filter | 1 per filter |
| `liked_videos` (**opt-in**, §6) | Liked videos | Videos the channel owner liked | `itemCount`, `consent` | D1 `liked_videos` for `channel.userId`, newest like first, public videos only | No public liked videos, **or no valid consent** | 1 |

### 4.2 Playlists group

| Type | Label (en) | Purpose | Config | Data source | Empty when | Limit |
|---|---|---|---|---|---|---|
| `single_playlist` | Single playlist | One series or course as a shelf of its videos | `playlistId`: a public playlist of **this** channel | Playlist + its first `itemCount` videos, playlist order. Header title defaults to the playlist name and links to the playlist | Playlist missing, private, or no listable video | Any |
| `multiple_playlists` | Featured playlists | Hand-picked playlists as tiles | `playlistIds`, 1–10 public playlists of this channel. **Title required** | Playlists with covers and counts, in the owner's order | No listable playlist | Any |
| `created_playlists` (**new**) | Created playlists | All the channel's public playlists, newest first | `itemCount` | Channel playlists (same filter as `GET /api/channels/:id/playlists`) | None public | 1 |

### 4.3 Channels group

| Type | Label (en) | Purpose | Config | Data source | Empty when | Limit |
|---|---|---|---|---|---|---|
| `featured_channels` (**new**) | Featured channels | Channels the owner recommends (scholars of an institute, sister channels) | `channelIds`, 1–20, picked by search. **Title required**, e.g. "Our scholars" | Each channel loaded, in order. Left out: this channel, deleted, moderation-hidden (this covers suspended and banned), private | No listable channel | Any |
| `subscribed_channels` (**opt-in**, §6) | Subscriptions | Channels the owner subscribes to | `itemCount`, `consent` | D1 subscriptions of `channel.userId` (plus legacy profile list), same filters as above | None listable, **or no valid consent** | 1 |

Featured channels never lists anyone's subscriptions: it shows only what the owner typed in. The
viewer's own subscriptions are never shown on someone else's channel.

### 4.4 Community group

| Type | Label (en) | Purpose | Config | Data source | Empty when | Limit |
|---|---|---|---|---|---|---|
| `community_posts` (**new**) | Community posts | Latest announcements, or the pinned one | `postMode`: `latest` \| `pinned`. `itemCount` 1–6, default 3 (`latest` only) | Channel post index. Published, public-visibility, not deleted or hidden posts. `pinned` shows pinned posts only, newest first. Each post is a compact card (text clamped to 4 lines, first image or video thumbnail, poll question with option count, like and comment counts). "See all" links to the Community tab | No matching post, **or the Community tab is hidden** in the channel's tab settings | 1 |

Posts with `subscribers` or `members` visibility never appear on Home, because Home responses are
shared and cached (§8.4). Voting, liking and commenting happen on the Community tab. The card links
to the post there.

## 5. Ordering and limits

- **12 sections per channel** (YouTube's limit). One constant,
  `CHANNEL_SECTION_CONSTRAINTS.MAX_SECTIONS_PER_CHANNEL`, read by the API and the web. The UI shows
  "N of 12 sections used".
- **Per-type limits** come from §4 (`SECTION_TYPE_LIMITS`). The API answers 409 with
  `code: 'section_type_limit'`. The dialog shows the card as "Already on your channel".
- **Order** stays in the order document. Drag (pointer and keyboard) reorders locally, and **Publish**
  sends the full list, as today. `channel_spotlight` is always first. Reorder moves it to the front
  whatever the client sends, and the manager shows it pinned above the drag list.
- Adding, editing and removing a section takes effect at once. Only order changes wait for Publish.
  This is today's behaviour, and the copy says so.

## 6. Privacy: Subscriptions and Liked videos

What someone subscribes to or likes is their personal data. A channel showing it publicly needs an
explicit opt-in.

- Creating either type needs `consent: true` in the body. The API stores
  `consent: { grantedBy: userId, grantedAt }`.
- **Only the channel owner** (`channel.userId`) can consent, because it is their data. A channel admin
  can't create, enable or edit these two types (403 `code: 'owner_consent_required'`).
- The section populates only while `consent.grantedBy === channel.userId`. After an ownership
  transfer (#460) the old owner's consent lapses, and the section is hidden until the new owner
  opts in.
- **Existing sections** of these types have no `consent`, so from this release they are hidden from
  visitors. The owner sees them with the hint "Hidden: turn on public display to show it" and a
  **Show publicly** switch in the edit form.
- The form shows a consent checkbox with the exact consequence: "Anyone who visits your channel will
  see the channels you subscribe to" / "…the videos you have liked". Unticking it in edit removes the
  consent, and the section is hidden at once.
- Liked videos only ever lists public, ready videos. Private likes data (timestamps) is not returned.

## 7. Permissions

Channel roles are videos-side data (`CHANNEL-ROLES.md`), never Auth RBAC.

| Action | Owner | Channel admin | Editor | Moderator | Site staff |
|---|---|---|---|---|---|
| View Home on a public channel | Yes | Yes | Yes | Yes | Yes |
| See empty sections and hints | Yes | Yes | No | No | No |
| Add, edit, remove, reorder sections | Yes | Yes (`channel.edit`) | No | No | No |
| Create or consent to Subscriptions / Liked videos | Yes | No | No | No | No |

Until #462 is built, every write checks `canEditChannelLayout(channel, userId)` in
`lib/channelSectionAccess.ts`, which returns true for the owner only. When `requireChannelAccess`
lands, that one helper switches to `channel.edit`, and the consent check stays owner-only. A site role
never grants a channel capability.

## 8. Data model and API

### 8.1 `ChannelSection` (R2 `channel_sections/<channelId>/<sectionId>`)

New optional fields, all ignored by types they don't belong to:

```ts
type ChannelSectionType =
  | 'channel_spotlight' | 'featured_videos' | 'recent_uploads' | 'popular_uploads' | 'shorts'
  | 'live_streams' | 'liked_videos' | 'single_playlist' | 'multiple_playlists'
  | 'created_playlists' | 'featured_channels' | 'subscribed_channels' | 'community_posts';

interface ChannelSection {
  // existing fields unchanged
  trailerVideoId?: string;          // channel_spotlight
  returningVideoId?: string;        // channel_spotlight
  sort?: 'latest' | 'popular';      // shorts
  liveFilter?: 'live_and_upcoming' | 'past'; // live_streams
  postMode?: 'latest' | 'pinned';   // community_posts
  consent?: { grantedBy: string; grantedAt: string }; // subscribed_channels, liked_videos
}
```

No migration is needed. Sections without the new fields read with defaults (`sort: 'latest'`,
`liveFilter: 'live_and_upcoming'`, `postMode: 'latest'`, no consent).

### 8.2 Endpoints

| Method and path | Change |
|---|---|
| `POST /api/channels/:id/sections` | New types and fields. Per-type validation (§4) runs in `validateSectionContent`, including "video or playlist belongs to this channel". Limits: 12 total (400 `section_limit`), per type (409 `section_type_limit`). Consent rules (§6). Errors return a stable `code` (and an English `error` for logs). The web shows localized text for the code, never the raw message |
| `PUT /api/channels/:id/sections/:sectionId` | Same fields. `type` can't change. `consent: false` removes consent. A channel admin editing a consent type gets 403 |
| `PATCH /api/channels/:id/sections/reorder` | Spotlight is moved first |
| `DELETE …/:sectionId` | Unchanged |
| `GET /api/channels/:id/sections` | Unchanged. Returns the raw config for the manager |
| `GET /api/channels/:id/sections/populated` | Populates **every** type server-side (§8.3). Each section gets `populatedContent` and `isEmpty`. `consented` reports whether an opt-in type's consent is valid. Empty sections are dropped unless the caller can edit the channel, who also gets `emptyHint` and `canEdit: true` |

`populatedContent` shape:

```ts
interface SectionContent {
  videos?: VideoView[];             // featured, recent, popular, shorts, liked, single_playlist
  playlist?: PlaylistView;          // single_playlist header
  playlists?: PlaylistView[];       // multiple_playlists, created_playlists
  channels?: PublicChannelSummary[];// featured_channels, subscribed_channels
  streams?: LiveStreamView[];       // live_streams (no stream key or RTMP URL)
  posts?: CommunityPostSummary[];   // community_posts
  spotlight?: { trailer?: VideoView; returning?: VideoView };
}
```

### 8.3 Population rules

- One populator per type in `lib/channelSectionPopulator.ts`, each a pure function of
  `(section, channel, env)`. Sections populate in parallel, and one failing section doesn't fail
  the response: it is logged with the section id and type, treated as empty, and the request still
  returns 200. A 5xx from the endpoint itself carries an error reference and is reported to the
  admin Errors page by the shared reporter (#599).
- Bounded reads only: index queries for uploads and Shorts, at most `itemCount` object loads per
  section. Playlists and live streams use one bounded list (`FALLBACK_SCAN_OBJECTS`), as their tabs do
  today.
- Videos returned are the public view (no private fields), with the channel name and avatar filled
  from the already-loaded channel.

### 8.4 Caching

- Anonymous `populated` responses are cached on the Cache API (`lib/edge-cache.ts`) for **60 s**,
  keyed by channel id. Signed-in requests skip the cache, because editors get empty sections and
  hints.
- Any section write deletes the channel's cache key in the colo that served it. Other colos expire
  within 60 s, which is acceptable for a channel layout.
- The spotlight choice happens on the client (§4.1), so subscriber state never enters the cache.

### 8.5 Background work

No new long-running work. Removed content is filtered at read time, so nothing needs a clean-up job.
Section create, update, delete and reorder keep sending their analytics events through the existing
queue (`queueChannelSectionEvent`), which has retry, backoff and a DLQ. With #599, dead letters become
needs-action items on the admin Errors page. If a later change adds background section work, it must
follow the same queue → retry → DLQ → Errors-page pattern.

Users never see raw errors. The manager maps API `code`s to localized messages (§11), and anything
unknown shows the generic "Couldn't save the section. Try again."

## 9. Add / edit flow

The "Add channel section" dialog uses the option-card design being built in another branch. New types
are added as cards in that design, under four small headings:

| Videos | Playlists | Channels | Community |
|---|---|---|---|
| Channel spotlight, Featured videos, Latest videos, Popular videos, Shorts, Live and upcoming, Past live streams, Liked videos | Single playlist, Featured playlists, Created playlists | Featured channels, Subscriptions | Community posts |

- Each card has an icon, the label and a one-line description. A card at its per-type limit is
  disabled with "Already on your channel". Liked videos and Subscriptions carry a small "Private
  data" tag.
- Picking a card opens its config step in the same dialog, with Back. The step uses **pickers**, not id
  fields:
  - **Video picker:** the channel's videos (latest first, search by title), multi-select with order
    by selection, up to the type's limit. Featured videos can also take any public video by pasted
    link or id.
  - **Playlist picker:** the channel's playlists. Single for `single_playlist`, multi for
    `multiple_playlists`.
  - **Channel picker:** site search for channels by name or @handle, with chips that can be removed.
    This channel and unavailable channels can't be picked.
  - **Spotlight:** two video pickers, "Trailer for new visitors" and "Featured video for
    subscribers".
  - **Options:** Shorts sort, live filter, post mode, item count.
  - **Consent** checkbox for the two opt-in types (§6).
- Edit opens the same config step, filled in. In the manager each row shows the type icon, title, a
  type label, and a "Hidden" badge when the section is empty or lacks consent.

## 10. Rendering (channel Home tab)

- Sections render in order with `section[data-section=<kind>]`, so the themed shelf styles in
  `theme/pages.css` apply: a heading over a hairline that fades from the theme's edge colour, shelves
  that fade at their far edge, and a larger first item for Featured.
- New `data-section` kinds: `spotlight`, `shorts` (9:16 tiles, existing CSS), `events`, `channels`,
  `community`.
- **Spotlight:** a large player-style card (thumbnail, title, description clamped to 3 lines, Watch
  button) leading the tab. No autoplay.
- **Community posts:** a horizontal shelf of compact post cards on wide screens, stacked on phones.
- Everything uses semantic tokens (`bg-card`, `text-foreground`, `text-muted-foreground`,
  `border-border`, `bg-brand-soft`, `text-brand`). New files add **no** hard-coded colours, and edited
  files lower their `theme-colors.allowlist.json` count. Checked in all four themes (Lantern, Zujaj,
  Nahas, Fawanees), light and dark.
- RTL: logical properties (`ms-`, `me-`, `start`, `end`), and shelf fades and chevrons flip. Video
  titles keep their own direction (`dir="auto"`). Handles and ids are `dir="ltr"`.
- Loading shows skeletons per section. If the whole request fails, the Home tab shows nothing to
  visitors, and editors see "Couldn't load your sections" with Retry. The client error is reported
  with context (channel id, status).

## 11. Copy (en / ar)

Strings live in `packages/shared-types/src/i18n-channel-sections.ts` (`channelSections`, en and ar),
shared by the web static fallback and the api-videos translation seed. The manager's page chrome
(header, count, publish, delete) stays under `channelManage.sections` in
`packages/shared-types/src/i18n-static/{en,ar}.ts`.

| Key | en | ar |
|---|---|---|
| group.videos | Videos | الفيديوهات |
| group.playlists | Playlists | قوائم التشغيل |
| group.channels | Channels | القنوات |
| group.community | Community | المجتمع |
| typeLabels.channel_spotlight | Channel spotlight | واجهة القناة |
| typeLabels.featured_videos | Featured videos | فيديوهات مميزة |
| typeLabels.recent_uploads | Latest videos | أحدث الفيديوهات |
| typeLabels.popular_uploads | Popular videos | الأكثر مشاهدة |
| typeLabels.shorts | Shorts | مقاطع قصيرة |
| typeLabels.live_streams | Live and upcoming | مباشر وقادم |
| typeLabels.live_streams_past | Past live streams | البث السابق |
| typeLabels.liked_videos | Liked videos | الفيديوهات التي أعجبتني |
| typeLabels.single_playlist | Single playlist | قائمة تشغيل واحدة |
| typeLabels.multiple_playlists | Featured playlists | قوائم تشغيل مميزة |
| typeLabels.created_playlists | Created playlists | قوائم التشغيل المنشأة |
| typeLabels.featured_channels | Featured channels | قنوات مميزة |
| typeLabels.subscribed_channels | Subscriptions | الاشتراكات |
| typeLabels.community_posts | Community posts | منشورات المجتمع |
| spotlight.trailer | Trailer for new visitors | مقدمة للزوار الجدد |
| spotlight.returning | Featured video for subscribers | فيديو مميز للمشتركين |
| consent.subscriptions | Anyone who visits your channel will see the channels you subscribe to. | سيرى كل من يزور قناتك القنوات التي تشترك فيها. |
| consent.likes | Anyone who visits your channel will see the videos you have liked. | سيرى كل من يزور قناتك الفيديوهات التي أعجبتك. |
| privateData | Private data | بيانات خاصة |
| alreadyAdded | Already on your channel | موجود في قناتك |
| hidden | Hidden | مخفي |
| emptyHint.* | e.g. "Visitors don't see this section until you have public Shorts." | مثال: «لا يرى الزوار هذا القسم حتى تنشر مقاطع قصيرة عامة.» |
| errors.section_limit | You can have up to 12 sections. | يمكنك إضافة ١٢ قسمًا كحد أقصى. |
| errors.section_type_limit | This section is already on your channel. | هذا القسم موجود في قناتك بالفعل. |
| errors.owner_consent_required | Only the channel owner can show their subscriptions or likes. | يمكن لمالك القناة وحده عرض اشتراكاته أو إعجاباته. |
| errors.generic | Couldn't save the section. Try again. | تعذّر حفظ القسم. حاول مرة أخرى. |

The full set (descriptions, every empty hint, picker strings) is in the i18n files. The i18n sync test
fails if a key is missing in one language.

## 12. Tests

**API unit** (`apps/api-videos/test/channel-sections-types.spec.ts`, node:test, `MemoryBucket` +
`SqliteD1`):

- For each of the 13 types: populated content from fixtures, and the empty case (omitted for a
  visitor, present with `isEmpty` and `emptyHint` for the owner).
- Removed content filtered: deleted, hidden, private and processing videos. Deleted, hidden and
  private channels, and this channel itself, in Featured channels.
- Consent: create without consent → 400. Channel admin path → 403. Section hidden when
  `grantedBy` ≠ owner. Unticking removes it.
- Limits: 13th section, and a second `recent_uploads` → 409. Spotlight moved first on reorder.
  Spotlight and playlist ids from another channel → 400.
- Community: only public, published posts. Pinned mode. Hidden Community tab → empty.
- Live: filter and order (live first, then soonest upcoming; past most recent first). No stream key in
  the output.
- One populator throwing doesn't fail the response.

**Web unit** (jest): renderer per type from `populatedContent`, spotlight choice (subscriber vs
visitor and the fallbacks), no output for an empty section for visitors, dialog grouping and disabled
cards, form validation per type, consent checkbox.

**E2E on QA** (`apps/web/e2e/52-channel-sections.spec.ts`, en and ar): for each new type, add it
through the dialog with the pickers, see it on the Home tab, reorder it (keyboard) and publish, then
remove it. Opt-in types: the consent checkbox is required, and the section shows to a signed-out
visitor only after consent. Arabic run checks `dir="rtl"` and the Arabic labels.

## 13. Decisions taken in this spec

- **12 sections**, not 10 or 5: matches YouTube and gives room for the new types.
- **Existing Subscriptions / Liked videos sections become hidden** until the owner opts in. This is a
  privacy fix, so it isn't optional. The owner sees why and can turn it on.
- **Spotlight choice on the client:** keeps one cacheable response. The cost is that a signed-in
  subscriber briefly sees the trailer skeleton before the returning video. Both are loaded, so the
  swap is instant.
- **Community posts on Home are public-visibility only:** the Home response is shared. Subscriber-only
  posts stay on the Community tab, where visibility is checked per viewer.
- **No "For you" section:** a channel's page stays curated by the channel.

## 14. Delivery

1. This spec (docs).
2. API: types, validation, limits, consent, populators, cache, unit tests.
3. Web: renderer, grouped dialog cards with pickers, manager, i18n, jest and E2E, screenshots in all
   four themes, en and ar.
