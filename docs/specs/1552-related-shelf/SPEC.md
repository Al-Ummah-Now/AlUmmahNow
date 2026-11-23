# Related shelf: empty is not a failure (#1552)

## Problem
The watch page's related shelf shows "We couldn’t load related videos right now." and **Try again**
whenever its list is empty. That includes the normal case where the request worked and found nothing
(a channel's only video, a new site, a one-video local stack). Retrying returns the same empty list,
so the viewer sees an error they can't fix.

## Current behavior (origin/main @ 4486c207b)
- `apps/web/src/components/related/index.tsx:14` and `related/rtl/index.tsx:12`: one branch,
  `relatedVideos.length === 0 ? <RelatedVideosEmpty onRetry={onRetry} />`, for both cases.
- `related/RelatedVideosEmpty.tsx:15`: the retry button is raw `bg-blue-700`, not the shared flat
  filled button.
- `index.tsx:13` heading "Related Videos" (title case, `en.ts:543`); `rtl/index.tsx:11` hard-codes
  «المرئيات ذات الصلة» instead of using i18n.
- The loader cannot report a failure at all, so "the hook knows whether the fetch threw" is not true
  today: `getRecommendedVideos` / `getTrendingVideos` turn a failed request into `[]`
  (`lib/api/videos.ts:722,729,788,795`), `fetchVideos` into `undefined`, and `loadRelated` counts any
  failing source as empty (`lib/video/related.ts:78-83`). `fetchRelatedVideos` therefore never rejects,
  and the `.catch` in `WatchPageContent.tsx:254` is dead code.

## Decision: an empty shelf is hidden
An empty answer renders **nothing**: no heading, no message, no button. On wide screens the side
column is dropped too, so the player takes the width instead of sitting beside an empty column.

Why hide instead of a "More from this channel" or Explore link: the shelf is already the widest net.
It asks for recommendations, tops up from the newest public videos, retries once, then tries a month
of trending and the last shelf this tab saw. If all of that answered with nothing, the channel has no
other videos and the site has no other public videos, so a channel link or Explore would open a page
showing the same lone video: a hollow page (owner rule: no hollow pages/sections; hidden features
vanish rather than explain themselves). The player, the details and the comments stay, so the
page is not hollow without the shelf.

## States
| State | When | Shows |
|---|---|---|
| loading | requested, no answer yet (also right after Try again) | heading + skeleton, `aria-busy` |
| failed | no source answered (all requests failed and no remembered shelf) | heading + message + **Try again** |
| empty | a source answered and nothing but the current video was found | nothing (shelf and empty side column removed) |
| loaded | at least one other video | heading + list (unchanged) |

"Answered" means a request returned a list (even an empty one). A failed request, a network error or
no remembered shelf is not an answer. One answer is enough for "empty": if the feed answered with
nothing, there are no other public videos, whatever the recommendations request did.

## Copy (i18n, `video.*`)
| Key | English | Arabic |
|---|---|---|
| `relatedVideos` | Related videos | مرئيات ذات صلة |
| `relatedFailed` (was `relatedEmpty`) | We couldn’t load related videos right now. | تعذّر تحميل المرئيات ذات الصلة حاليًا. |
| `relatedRetry` (was `relatedEmptyRetry`) | Try again | حاول مرة أخرى |

The Arabic heading uses the i18n string everywhere (the RTL component's hard-coded copy is removed).
No numbers in this copy.

## Accessibility
- The shelf is a `<section>` labelled by its `h2`; `aria-busy` while loading.
- The failure message is `role="status"` (polite: the shelf must not interrupt the video).
- Try again is a real `<button>` with the shared `aun-btn aun-btn-filled` style (token colors, focus
  ring, contrast covered by `check:tokens`). Pressing it moves focus to the shelf heading
  (`tabIndex=-1`) because the button disappears with the failure.
- Empty renders nothing, so screen readers are not told about a section that has no content.

## Test plan
- Unit, `loadRelated`: rejects `RelatedUnavailableError` only when no source answered (after the retry
  and every last resort); resolves `[]` when any source answered empty (even if others failed, or if
  only the current video came back); a last resort's videos still show when the API is down.
- Unit, `fetchRelatedVideos` with mocked `fetch`/feed: 503s and network errors reject; an empty answer
  resolves `[]`; the remembered shelf is used when everything fails; `getRecommendedVideos` and
  `getTrendingVideos` still resolve `[]` on failure for their other callers.
- Unit, `useRelatedVideos`: loading → loaded/empty/failed; failure reported with `reportError`
  (shown), empty is not reported; retry goes back to loading; a stale answer for an old video is
  ignored.
- Unit, LTR and RTL shelf: each state; empty renders nothing; failed has the status message and an
  `aun-btn-filled` button with no `bg-blue`; focus moves to the heading on retry; copy in en and ar.
- Unit, `WatchPageContent`: empty hides the shelf and both shelf columns; failure → Try again → videos.
- E2E: no existing spec asserted the old empty-as-error behavior (`related-videos-empty` was only used
  in unit tests). `30-watch-page.spec.ts` WATCH-002 matched the RTL component's hard-coded heading
  (/ذات الصلة/); it now asserts the i18n heading «مرئيات ذات صلة» as an `h2`. The release specs
  (`related.spec.ts`, `theatre`, `watch-layout`) seed related videos and use `related-videos-list`.
- E2E (local stack, `30-watch-page.spec.ts`): WATCH-015 answers the three related sources empty in the
  browser and checks the shelf and side column are gone with no error or retry; WATCH-016 aborts them,
  checks the failure message, restores the API and checks Try again loads the shelf.

## Risks
- **Layout shift when empty:** on wide screens the side column shows a skeleton, then disappears when
  the answer is empty and the player widens. Rare (a site with one public video) and preferable to a
  permanent empty column.
- **Fewer retries surfaced:** a partial outage where the feed answers but recommendations fail now
  shows the feed's videos or hides the shelf, never an error. Intended: the viewer can't fix it.
- **Renamed i18n keys:** an admin translation override saved under `video.relatedEmpty` would no
  longer apply. Checked 2026-11-23: the stored translation files on QA, stage and production (en, ar)
  have empty `overrides` lists, so no override uses the old keys; their leftover stored values are
  never served (only listed overrides replace repo text). The copy is kept word for word.
- Failures are now reported to the admin Errors page (`reportError`, `shown: true`); a real API
  outage adds one report per watch-page view that fails.
