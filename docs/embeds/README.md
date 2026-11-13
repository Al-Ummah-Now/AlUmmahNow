# Embeds & sharing: integration contract

**Status:** v1. Implements the first slice of Epic 25 (sharing & embeddable player) and a read-only slice of Epic 26
(embedded discussions) from `docs/specs/EMBEDS-COMMENTS-TIERS.md`. The plan and what is deferred are in
[`PLAN.md`](./PLAN.md).

This is the contract for sites that embed Al Ummah Now videos, mainly the public site (`alummahnow.net`,
repo AlUmmahNowUI) and the CMS video picker (`cms.alummahnow.net`, repo AlUmmahNowCMS). Anything not listed
here is not part of the contract and may change.

## 1. Hosts

| Environment | Embed / oEmbed host (web app) | Videos API |
|---|---|---|
| Production | `https://videos.alummahnow.net` | `https://videos.api.alummahnow.net` |
| Stage | `https://videos.stage.alummahnow.net` | `https://videos.api.stage.alummahnow.net` |
| QA | `https://videos.qa.alummahnow.net` | `https://videos.api.qa.alummahnow.net` |

Below, `{host}` is the embed host and `{api}` the videos API.

> The spec's recommended separate origin `embed.alummahnow.net` (decision E1) is not live yet. When it is, the
> paths below stay the same and `{host}/embed/...` keeps working. Always build URLs from a configurable host.

## 2. Embed URLs

| What | URL |
|---|---|
| One video | `{host}/embed/v/{videoId}` |
| A playlist | `{host}/embed/p/{playlistId}` |
| A video's comments, read-only | `{host}/embed/comments/{videoId}` |

`videoId` and `playlistId` are the ids the videos API returns (`GET {api}/api/videos`, `GET {api}/api/playlists/{id}`).

### Parameters (query string)

| Param | Applies to | Values | Default | Meaning |
|---|---|---|---|---|
| `lang` | all | `en`, `ar` | `en` | UI language. `ar` renders right to left. |
| `start` | v, p | seconds (`754`) or `1h2m34s` / `12m34s` / `34s` | `0` | Start position. Ignored if it is past the end. |
| `end` | v | seconds or `12m34s` | none | Pause at this position. Ignored unless it is after `start`. |
| `autoplay` | v, p | `1` | off | Starts playing as soon as it loads, **always muted** (browsers block autoplay with sound). |
| `gesture` | v, p | `1` | off | With `autoplay=1`: the host page inserted the frame from the viewer's own click (www's video facade does), so the player tries to play **with sound**; if the browser refuses (Safari/WebKit does not carry a parent click into a cross-origin frame) it plays muted and shows "Tap to unmute". Only send it for a real click: without one the browser refuses sound anyway. |
| `loop` | v | `1` | off | Restart when the video ends. |
| `title` | v, p | `0` | shown | `0` hides the title bar over the player. |
| `index` | p | 0-based integer | `0` | Which playlist item plays first. |
| `origin` | v, p | an origin (`https://alummahnow.net`) | see §5 | The origin that may talk to the player through `postMessage`. |

Unknown params are ignored. Invalid values fall back to the default.

### What the frame shows

- **Available video:** a poster with a play button (facade). The player (the same Video.js player as the watch page:
  HLS from Bunny, quality menu, captions, chapters, keyboard shortcuts, click-only menus) loads when the viewer
  presses play, or at once with `autoplay=1`. A "Watch on Al Ummah Now" link opens the full watch page in a new tab,
  at the current time.
- **Any frame size:** the player fills the frame and the video is fitted inside it at its own ratio, on the night
  colour (a Short in a wide card, such as X's, is pillarboxed). The control bar (one row) and the progress bar sit
  at the bottom of the frame across its full width, as on YouTube for vertical videos, so a narrow Short still gets
  full-size controls; the least important controls (picture in picture, the volume slider, the duration) go only
  when the frame itself is narrow. The "Watch on" link sits in the frame's top corner, outside the video when there
  is room beside it, and shows its icon alone (its label kept as the link's name) in frames under 480px wide and
  wherever the full label would cover the picture.
- **Social cards:** the watch page declares the video's own ratio to link-preview bots (`og:video:width/height`,
  `twitter:player:width/height`, oEmbed `width/height`; a Short is 405x720), for sites that size their
  player from it. X draws its player card in a landscape box whatever the declared size (checked 2026-11-12: a Short
  declared 413x720 shows in a ~16:9 card), so on X a Short is pillarboxed inside the card.
- **Unavailable video:** a clean "This video is unavailable" frame with a link to Al Ummah Now. The same frame is
  shown for private, scheduled (not yet published), deleted, moderation-hidden, still-processing and non-existent
  videos, so the frame never reveals which one it is. The HTTP status is 200 either way (so the host page shows the
  frame instead of a browser error page); use oEmbed (404) to check availability from code.
- **Playlist:** the player plus a list of the playlist's public videos in the playlist's saved order (manual, or its
  automatic sort), read from the playback queue API (`GET /api/playlists/{id}/queue`, up to 500 videos). When a video
  ends, a 3-second "Up next" countdown (cancellable) plays the next one, which starts on its own (muted if the
  browser refuses sound); after the last video the playlist stops. "Watch on Al Ummah Now" opens the watch page
  inside the playlist (`?list=&index=`). Private videos inside a public playlist are skipped. A private or missing
  playlist shows the unavailable frame. See docs/specs/PLAYLIST-PLAYBACK.md.

Only **public, published** videos and playlists ever play in an embed. The embed never uses the viewer's
Al Ummah Now session, even when the host is a subdomain of `alummahnow.net` (where the browser would send the
session cookie): embed pages read no cookies and fetch content anonymously. Signing in inside an embed is not
supported in v1 (see `PLAN.md`).

### Sizes and snippets

The player is 16:9. Recommended fixed sizes: **560×315**, **640×360**, **853×480**, **1280×720**. The share dialog on
the watch page generates these snippets; build the same ones yourself:

```html
<!-- Fixed size -->
<iframe src="https://videos.alummahnow.net/embed/v/VIDEO_ID" width="560" height="315"
  title="Al Ummah Now video player" frameborder="0" loading="lazy"
  allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen
  referrerpolicy="strict-origin-when-cross-origin"></iframe>

<!-- Responsive (fills its container, keeps 16:9) -->
<div style="position:relative;width:100%;aspect-ratio:16/9">
  <iframe src="https://videos.alummahnow.net/embed/v/VIDEO_ID"
    style="position:absolute;inset:0;width:100%;height:100%;border:0"
    title="Al Ummah Now video player" loading="lazy"
    allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen
    referrerpolicy="strict-origin-when-cross-origin"></iframe>
</div>
```

- `allow="autoplay; fullscreen; picture-in-picture"` is needed for autoplay, the fullscreen button and PiP.
- Keep `referrerpolicy` at `strict-origin-when-cross-origin` (the browser default) or looser: the embed reads the
  host **origin** (never the path) from the referrer to attribute embed views (§6) and to find the `postMessage`
  target (§5). With `no-referrer`, pass `origin=` instead.

### Framing policy

- `/embed/*` responses send `Content-Security-Policy: frame-ancestors *` and no `X-Frame-Options`, so **any origin**
  may frame them (the spec's default "embedding allowed anywhere"). Per-video domain allowlists (Studio creator
  controls, spec 25.6) are not built yet; when they are, a restricted video shows a "can't be played on this site"
  frame on other domains.
- Every other page of the web app keeps `frame-ancestors 'none'` and `X-Frame-Options: DENY`.

## 3. oEmbed

```
GET {host}/oembed?url={url}&maxwidth={px}&maxheight={px}&format=json
```

- `url` (required) accepts: `{host}/{en|ar}/video/{id}`, `{host}/{en|ar}/video?vid={id}`, `{host}/embed/v/{id}`,
  `{host}/{en|ar}/playlist/{id}`, `{host}/embed/p/{id}`, with or without a query string (`?t=` / `?start=` is
  carried into the embed). Only URLs on the same host as the endpoint are recognised (QA oEmbed answers for QA URLs,
  production for production URLs).
- `maxwidth` / `maxheight` (optional): the returned size is the largest 16:9 size that fits, at most 1280×720,
  default 640×360 (minimum 200×113).
- `format`: only `json`. `format=xml` answers **501**.
- **CORS:** `Access-Control-Allow-Origin: *` (public data, no credentials), so browsers and the CMS can call it directly.
- Cached for 5 minutes (`Cache-Control: public, max-age=300`).

Response `200 application/json`:

```json
{
  "version": "1.0",
  "type": "video",
  "provider_name": "Al Ummah Now",
  "provider_url": "https://videos.alummahnow.net",
  "title": "Video title (English, or the only title)",
  "author_name": "Channel name",
  "author_url": "https://videos.alummahnow.net/en/channels/CHANNEL_ID",
  "thumbnail_url": "https://…/thumbnail.jpg",
  "thumbnail_width": 1280,
  "thumbnail_height": 720,
  "width": 640,
  "height": 360,
  "html": "<iframe src=\"https://videos.alummahnow.net/embed/v/VIDEO_ID\" width=\"640\" height=\"360\" title=\"…\" frameborder=\"0\" loading=\"lazy\" allow=\"autoplay; fullscreen; picture-in-picture; encrypted-media\" allowfullscreen referrerpolicy=\"strict-origin-when-cross-origin\"></iframe>",
  "aun_video_id": "VIDEO_ID",
  "aun_duration": 754
}
```

- For a playlist URL, `type` is still `video`, `html` points at `/embed/p/{id}`, `aun_playlist_id` replaces
  `aun_video_id`, and `aun_duration` is omitted.
- `author_name` / `author_url` / `thumbnail_*` / `aun_duration` are omitted when unknown (legacy videos).
- Errors: **400** missing or malformed `url`, **404** URL not recognised or the content is not public / not
  available, **501** non-JSON `format`. Error bodies are `{ "error": "…" }`.

Watch pages advertise the endpoint for discovery:

```html
<link rel="alternate" type="application/json+oembed"
  href="https://videos.alummahnow.net/oembed?url=https%3A%2F%2Fvideos.alummahnow.net%2Fen%2Fvideo%2FVIDEO_ID&format=json"
  title="Video title">
```

### Social previews

Watch pages (`/{locale}/video/{id}`) of public videos render Open Graph and Twitter tags server side: `og:type`
`video.other`, `og:title`, `og:description`, `og:image` (thumbnail), `og:url`, `og:video` / `og:video:secure_url`
(the embed URL, `text/html`, 1280×720), `twitter:card=player`, `twitter:player` (embed URL), `twitter:player:width`
/ `height`, `hreflang` alternates for `en` / `ar`, and the oEmbed `<link>`. Private or missing videos get only the
site defaults.

## 4. Sharing links

- Watch page: `{host}/{en|ar}/video/{id}`; `?t=754` starts at 754 s (`t` takes the same forms as `start`).
- Channel pages (no embed): `{host}/{en|ar}/@{handle}` (canonical); `{host}/{en|ar}/channels/{channelId}` for
  channels without a handle.
- The watch page has a **Share** button: copy link, "start at" the current time, copy embed code (sizes above plus
  responsive), and WhatsApp / Telegram / X / Facebook / email, plus the device share sheet where supported.

## 5. Player JavaScript API (`postMessage`)

The embed talks to its parent window with `window.postMessage`. Messages are plain objects, versioned with the
`aun:v1:` prefix.

**Who can talk to the player.** The embed fixes one *partner origin* at load time, in this order: the `origin`
parameter (only if it equals the real embedding origin when the browser exposes it via `location.ancestorOrigins`),
else `location.ancestorOrigins[0]`, else the origin of `document.referrer`. Events are posted **only** to that
origin (never `*`), and commands are accepted **only** from `window.parent` with that exact origin. If no partner
origin can be found (e.g. `referrerpolicy="no-referrer"` and no `origin` param) the API is off; the player still works.

### Events (player → host)

```ts
type AunEvent = {
  type: 'aun:v1:event';
  event: 'ready' | 'play' | 'pause' | 'ended' | 'timeupdate' | 'error';
  videoId: string;          // the playing video (changes inside a playlist embed)
  playlistId?: string;      // playlist embeds only
  currentTime: number;      // seconds
  duration: number | null;  // seconds, null until known
  muted: boolean;
  error?: { code: 'unavailable' | 'media' | 'network' | 'unknown'; message?: string }; // error only
};
```

- `ready`: the frame is ready for commands. Sent once per load, also for an unavailable video (followed by `error`
  with `code: 'unavailable'`). Before the viewer presses play the facade answers commands too (`play` loads the player).
- `timeupdate`: at most every 1 s while playing.
- `ended` is not sent when `loop=1`.

### Commands (host → player)

```ts
type AunCommand = {
  type: 'aun:v1:command';
  command: 'play' | 'pause' | 'seek' | 'mute' | 'unmute' | 'getState';
  seconds?: number; // seek only
};
```

`getState` answers with an event whose `event` is `'timeupdate'` (current state). A `play` command is subject
to the browser's autoplay rules: unless the viewer has interacted with the frame, call `mute` first.

### Example

```html
<iframe id="aun" src="https://videos.alummahnow.net/embed/v/VIDEO_ID?origin=https%3A%2F%2Falummahnow.net"
  width="640" height="360" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>
<script>
  const PLAYER_ORIGIN = 'https://videos.alummahnow.net';
  const frame = document.getElementById('aun');
  window.addEventListener('message', (e) => {
    if (e.origin !== PLAYER_ORIGIN || e.source !== frame.contentWindow) return;
    if (e.data?.type !== 'aun:v1:event') return;
    if (e.data.event === 'ready') frame.contentWindow.postMessage({ type: 'aun:v1:command', command: 'mute' }, PLAYER_ORIGIN);
    console.log(e.data.event, e.data.currentTime);
  });
</script>
```

An npm/CDN wrapper (`@alummahnow/embed`, spec 25.5) is not published yet; the messages above are the stable layer it
will wrap.

## 6. Analytics

An embed counts **one view per player load**, through the same path as the watch page
(`VideoAnalytics` → `POST {host}/api/analytics/video` → `POST {api}/api/videos/{id}/view` → queue `VideoView` →
processor rollups). Because the player loads only after the viewer presses play (or with `autoplay=1`), an embed
that is never played counts nothing. The view is tagged `source: "embed"` and `embedOrigin` (the host page's origin,
from the referrer; never the path), and the processor adds per-day `sources` and `embedOrigins` counts to the video
and channel rollups. The anonymous server-side fetch that renders the embed is not a counted view, so nothing is
counted twice. Embed views on `alummahnow.net` itself are embed views too.

## 7. Embedded discussions (read-only, v1)

```html
<script src="https://videos.alummahnow.net/embed/widget.js" async></script>
<alummah-discussion video="VIDEO_ID" lang="ar"></alummah-discussion>
```

- The custom element inserts an iframe of `{host}/embed/comments/{videoId}?lang=…` and resizes it to its content
  (the frame posts `{ type: 'aun:v1:resize', height }` to its parent, checked against the frame's origin).
- It shows the video's public comment thread (the same thread as the watch page: `scope="shared"`), newest first,
  with replies counts and "load more", and a "Join the discussion on Al Ummah Now" link to the watch page.
  Comments on private or unavailable videos are not shown.
- `lang` defaults to the host page's `<html lang>` (`ar*` → Arabic, right to left), else `en`.
- Posting, sign-in, Sites and site keys, page threads, moderation and theming are **not** in v1 (see `PLAN.md`).

## 8. Videos API for the www site and the CMS picker

`{api}` allows CORS (no credentials) from these origins:

| Environment | Origins |
|---|---|
| Production | `https://alummahnow.net`, `https://www.alummahnow.net`, `https://cms.alummahnow.net` (plus `videos.` and `admin.`) |
| Stage | `https://stage.alummahnow.net`, `https://www.stage.alummahnow.net`, `https://cms.stage.alummahnow.net` (plus `videos.stage.` and `admin.stage.`) |
| QA | `https://qa.alummahnow.net`, `https://www.qa.alummahnow.net`, `https://cms.qa.alummahnow.net` (plus `videos.qa.` and `admin.qa.`) |

If the www or CMS QA/stage host names differ from these, tell us and the list (`CORS_ORIGINS` in
`apps/api-videos/wrangler*.jsonc`, checked by `scripts/release/apps.ts`) is updated. oEmbed (§3) allows every origin.

Anonymous (no `Authorization`) endpoints a picker needs. They return only public, published content:

| Call | Use |
|---|---|
| `GET {api}/api/videos?limit=20&cursor=…` | Recent public videos (`data[]`; pass the returned `cursor` back for the next page) |
| `GET {api}/api/search?q=…&type=video` | Search (`results[].video`) |
| `GET {api}/api/videos/{id}` | One video (404 if not public) |
| `GET {api}/api/playlists/{id}/queue` | One public playlist's public videos in its saved order, paged (`offset`, `limit`) |
| `GET {api}/api/playlists/{id}?includeVideos=true` | One public playlist with its public videos (first 200) |
| `GET {host}/oembed?url=…` | Embed HTML, title, thumbnail, duration in one call |

Store the **video id** (or the watch URL) in the CMS, not the iframe HTML, and build the iframe at render time from
§2, so host or parameter changes need no content migration. Re-check availability with oEmbed when publishing:
a video can become private after it was picked; the frame then shows "unavailable", it never breaks the page.

### Play data for the www timeline (hover preview and Shorts viewer)

Two anonymous endpoints give www what a plain `<video>` needs, so it can play videos without the embed frame
(code: `apps/api-videos/src/lib/media/public-play.ts`, `src/endpoints/video/publicPlay.ts`; contract
`openapi/v1.json`). The unversioned `/api/...` paths answer too.

| Call | Use |
|---|---|
| `GET {api}/api/v1/videos/{id}/play` | One public video's play data. `404 {"success":false,"error":"Object not found"}` for anything not public and published. |
| `GET {api}/api/v1/shorts?after={id}&limit={1..20}` | `{ items: [play data…], next }`: the next public Shorts after `after`, newest first (the order of `GET {api}/api/v1/search?type=video&format=short&sort=date`). `limit` defaults to 10 (400 outside 1..20). When `after` is missing, or is not a listed public Short (any more), the list starts from the newest. Pass `next` back as `after`; `next` is `null` at the end. `503 {"error":"shorts_unavailable"}` (with `Retry-After`) if the index is down. |

Play data:

```json
{
  "id": "912859ed-e618-4d04-8438-874a74a251dd",
  "format": "short",
  "title": "…",
  "channelName": "Quran Daily",
  "channelHandle": "qurandaily",
  "width": 1080, "height": 1920, "durationSeconds": 42,
  "poster": "https://vz-25839d05-80d.b-cdn.net/912859ed-…/thumbnail.jpg?token=…&expires=1794515200",
  "mp4": { "url": "https://vz-25839d05-80d.b-cdn.net/bcdn_token=…&expires=1794515200&token_path=%2F912859ed-…%2F/912859ed-…/play_480p.mp4", "width": null, "height": null },
  "hls": "https://media.alummahnow.net/pub/912859ed-…/<rev>/master.m3u8",
  "expiresAt": "2026-11-12T17:00:00.000Z",
  "watchUrl": "https://videos.alummahnow.net/en/video/912859ed-…"
}
```

- **`format`**: the one Short rule (`packages/shared-types/src/video-format.ts`): the uploader's "Upload as Short / as
  video" choice wins; otherwise a Short is at most 180 s long **and** vertical or square (height ≥ width). Unknown
  size or length means `video`. The Shorts feed only lists `short`.
- **`mp4`**: a progressive MP4 with audio for `<video muted playsinline src>`. It is always Bunny's MP4 fallback file of
  the video's own library (the R2 transcode writes HLS only): 480p, else 360p, 720p, 240p, whichever Bunny encoded
  (Bunny writes MP4 fallbacks up to 720p). A video whose record lists no resolutions (old imports) gets 360p, which
  may not exist for a very small source: handle the `<video>` `error` event by keeping the poster. `mp4` is `null`
  only when the video's library has no CDN host configured. `mp4.width`/`height` are `null` for now: use the
  top-level `width`/`height` for the aspect ratio.
- **`hls`**: the adaptive stream the delivery switch chose (R2 on `media.*`, or Bunny). Chrome needs hls.js for it.
- **`poster`**: may be `null` (thumbnail not ready). Custom thumbnails come from `images.alummahnow.net` (img-src).
- **Signatures**: URLs carry tokens that expire at `expiresAt` (6 to 7 hours out, rounded to the hour, so a response
  is identical for up to an hour). Responses carry `Cache-Control: public, max-age=300` (never longer than the
  signatures). Refetch play data rather than storing URLs.
- **Never returned**: private or unlisted, draft, scheduled, still processing, hidden, deleted and live videos;
  videos of a hidden, private, suspended or deleted channel; videos uploaded by E2E test accounts.
- **CORS**: the www origins of §8's table (`https://www.alummahnow.net`, `https://www.stage.alummahnow.net`,
  `https://www.qa.alummahnow.net`), plus the www dev servers `http://localhost:4321` and `http://localhost:4331`
  on these two routes only, outside production (`apps/api-videos/src/lib/cors.ts`). No credentials.
- **Rate limits**: none beyond Cloudflare's, like the other anonymous reads.

Media hosts the URLs come from (for www's CSP `media-src`; HLS segments load from the same hosts, so add them to
`connect-src` too when using hls.js):

| Environment | Hosts |
|---|---|
| Production | `https://media.alummahnow.net`, `https://vz-25839d05-80d.b-cdn.net`, `https://vz-215a1ffd-a5a.b-cdn.net` (legacy library) |
| Stage | `https://media.stage.alummahnow.net`, `https://vz-cb79844a-c5d.b-cdn.net` |
| QA | `https://media.qa.alummahnow.net`, `https://vz-cb79844a-c5d.b-cdn.net` |

Posters come from the same hosts plus `https://images.alummahnow.net` (img-src).

## 9. Versioning

Additive changes (new params, new event fields, new oEmbed `aun_*` fields) keep `v1`. Removing or renaming anything
here bumps the message prefix to `aun:v2:` and is announced first.
