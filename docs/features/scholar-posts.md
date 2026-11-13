# Scholar posts: one post format, community posts as the source

**Status:** phase 1 of wiki AUN-SCHOLAR-SITES (§6.3, §6.6), 2026-11-13
**Repos:** AlUmmahNow (this: the schema, Studio, api-videos, the processor), AlUmmahNowCMS (www
references, featuring, the conversion), AlUmmahNowUI (www renders the posts).

## 1. The model

- A scholar's content is a **community post on their primary channel** (decision SS6). www's scholar
  page, its post pages and (later) the white-label site all read it from there.
- The CMS keeps only a hidden **reference** per post (www slug, language, featuring, curation and a
  summary cache). Editors feature references; they never edit scholar content.
- Every public post on a scholar's primary channel gets a reference: there is no opt-out (SS8).
- Scholars write only in Studio (SS18, recommended; not yet confirmed by the owner).

## 2. PostV2: one format (`packages/shared-types/src/post-schema.ts`)

The canonical file. AlUmmahNowCMS and AlUmmahNowUI vendor it byte for byte at a pinned commit
(`npm run sync:posts`, checked by `npm run check:posts`), so it has **no imports** and only
**erasable TypeScript** (no enums). Changes are additive.

| Kind | Fields (on top of the community post) |
|---|---|
| `text`, `image`, `poll`, `quiz`, `video`, `gif` | As before (`content`, `images` with `url`, `poll`, `quiz`, `videoId`, `gif`) |
| `article` | `article: { title, excerpt, body (markdown), cover, coverUrl, url (www), locale }` |
| `cards` | `title`, `slides: [{ id, image: { url, alt (required), width, height }, heading, body, position }]` (1–40) |
| `link` | `link: { url (http/https), title, description, image }`, the comment in `content` |
| every kind | `schemaVersion: 2`, `locale`, `translationKey`, `slug`, `www` (written back by the reference sync) |

`GIF` is kept and `link` is new (SS14, the spec's recommendation; not yet confirmed by the owner).

- `parsePostFields(kind, body, { mediaHost })`: the validator for the fields Studio writes (stable
  error codes: `required`, `too_long`, `too_many`, `bad_url`, `bad_media`, `alt_required`, `bad_value`).
- `postSummary(post)`: what the CMS caches (`posts.summary_json`) for lists, the timeline and search.
- `POST_FIXTURES`: one valid post per kind; tests in all three repos render them.
- Images come from platform hosts only (`*.alummahnow.net`; `lib/post-v2.ts platformMediaHost`).
  Studio uploads them first (`POST /api/community/media/upload/images`), then posts their URLs.

## 3. Studio

`/settings/channel/:id/community/new` offers every kind. Article (title, summary, cover, markdown
body), Cards (title; per card an image with alt text, heading, text, text position; reorder) and Link
(address, comment, title, description, image) are new; every post has a language (en/ar). Image posts
now upload their images before publishing (they used to send browser preview URLs). Edits of article,
cards and link fields go through `PUT /api/community/channels/:id/posts/:postId` (replaced whole).

The Community tab renders full articles (the text opens in place, with a link to www), cards (a
swipeable strip with overlay text) and links (nofollow, new tab).

## 4. The reference outbox (videos → CMS)

`apps/processor/src/handlers/scholar-refs.ts`, on every `CommunityPostCreated/Updated/Deleted`:

| Post | Call (X-API-Key = INTERNAL_API_KEY) |
|---|---|
| published or scheduled, public | `PUT {CMS_INTERNAL_URL}/internal/refs/:postId { channelId, post }` |
| deleted, draft, not public, missing | `DELETE {CMS_INTERNAL_URL}/internal/refs/:postId?channelId=` |

The CMS answers `ignored` for channels that are not a scholar's primary channel (one indexed read),
so this side keeps no list. Network errors, 429 and 5xx throw: the queue retries, then the DLQ and
the admin Errors page. A 4xx is logged and dropped. When www gives the post an address, it is written
back onto the post (`www`, `article.url`) with a conditional write and no queue message.

`CMS_INTERNAL_URL` is set per environment in `apps/processor/wrangler*.jsonc` (pinned by
`pnpm check:config`).

## 5. Internal API for the CMS

| Call | Use |
|---|---|
| `GET /internal/posts/:channelId/:postId` | www post pages (through the CMS): the post with live counts; never counts a view; 404 unless published and public |
| `PUT /internal/scholars/:userId/posts/:externalId` | The conversion (§6): `{ channelId, kind, locale, translationKey, title, article \| slides, www: { url, slug, locale }, status, publishedAt }`. A link-only mirror is upgraded **in place** (same id, likes, comments); otherwise a new post. Idempotent on `cms-<id>`. Sends no queue message |
| `GET /internal/scholars/:userId/posts/:externalId` | The conversion check reads what was written |

The old `PUT /internal/scholars/:userId/articles/:externalId` (link-only mirrors) still works for
posts not yet converted, and never overwrites a converted post.

## 6. Conversion of existing CMS scholar posts

Run from the CMS (`scripts/ops/convert-scholar-posts.ts`, see its docs/SCHOLARS.md): QA, then stage,
then production only with the owner's go-ahead. The CMS keeps each original for 30 days.
