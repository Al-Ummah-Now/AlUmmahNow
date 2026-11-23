# SPEC — Watch page: distinguish an empty related shelf from a failed load (#1552)

## Problem

On the watch page, the related-videos shelf renders its "failure" UI whenever the video list is
empty, even when the request succeeded and simply found nothing (a channel's only video, a new
site, a local stack with one video). A successful empty answer reads as an error the viewer cannot
fix, and retrying returns the same empty list.

Root cause: one branch handles both cases —
`loading ? <Skeleton/> : relatedVideos.length === 0 ? <RelatedVideosEmpty onRetry={...}/> : <list/>`
in `apps/web/src/components/related/index.tsx` and `related/rtl/index.tsx` — and the loader in
`WatchPageContent.tsx` (lines 85–88, 243–263) keeps no error state: `fetchRelatedVideos` rejects
are only logged, `relatedVideos` stays `[]`, and `relatedLoading` flips to `false` either way.

## Current behavior (file:line, `origin/main`)

- `apps/web/src/components/related/index.tsx:13` — `length === 0` → `RelatedVideosEmpty` (message + Try again).
- `apps/web/src/components/related/rtl/index.tsx:14` — same branch; heading hardcoded «المرئيات ذات الصلة».
- `apps/web/src/components/related/RelatedVideosEmpty.tsx` — message `t.video.relatedEmpty`
  ("We couldn't load related videos right now.") + retry button with raw `bg-blue-700`.
- `apps/web/src/components/video/WatchPageContent.tsx:243-263` — inline effect: no error tracking.
- i18n keys `relatedEmpty` / `relatedEmptyRetry` (`packages/shared-types/src/i18n-static/{en,ar}.ts`),
  typed in `packages/shared-types/src/i18n.ts:761-762`. Heading key `relatedVideos` is title case.

## Decision: empty shelf hides itself entirely

When the request **succeeded with zero items**, the section renders `null` — no heading, no
message, no button — in both LTR and RTL panes.

Justification against the owner's options and rules:

- **Owner rule "no hollow sections"** is the deciding factor. A heading floating over whitespace
  is precisely a hollow section; hiding the whole shelf (heading included) avoids it by
  construction. The alternative "quiet More-from-channel / Explore link" still paints a one-line
  ghost of the section and adds copy to maintain in two languages for a rare state.
- **The fallback ladder makes empty genuinely rare.** `fetchRelatedVideos`
  (`apps/web/src/lib/api/videos.ts:1061`) tops recommendations up from the feed, then trending
  (month), then the last good shelf. An empty shelf means the platform has nothing else to show;
  a "More from this channel" link would be just as empty, and Explore is already one tap away in
  the nav.
- **A succeeded-but-empty result is not an error** and not the viewer's to fix: no error styling,
  no retry. Retrying a succeeded request is a no-op that previously looped the same message.

## States

| State | UI |
|---|---|
| `loading` | Heading + `RelatedVideosSkeleton` (existing, `aria-hidden`). |
| `failed` | Heading + message + **Try again** button (`role="alert"` on the message block). Retry re-runs the fetch. |
| `empty` (ready, 0 items) | Nothing rendered — the shelf hides itself. |
| `loaded` (≥1 item) | Heading + list (existing). |

## UI copy

| Key | English | Arabic |
|---|---|---|
| `video.relatedVideos` (heading) | Related videos | مرئيات ذات صلة |
| `video.relatedError` (failed) | We couldn't load related videos right now. | تعذّر تحميل المرئيات ذات الصلة حاليًا. |
| `video.relatedErrorRetry` | Try again | حاول مرة أخرى |

Notes: US English, sentence case heading; Arabic copy unchanged (already «مرئيات», Arabic
numerals n/a — no numbers). The old keys `relatedEmpty`/`relatedEmptyRetry` are renamed to
`relatedError`/`relatedErrorRetry`: after the fix they describe the *failed* state, and the old
names would lie. The retry button drops raw `bg-blue-700` for the shared flat filled button
tokens (`--aun-btn-filled-bg/fg` + state-layer hover), matching `UploadButton`.

## Implementation

- New hook `apps/web/src/hooks/useRelatedVideos.ts`: `useRelatedVideos(videoId)` returns
  `{ videos, status: 'loading' | 'error' | 'ready', retry }`. Fetch on `[videoId, attempt]`;
  success → `{status:'ready', videos}`; rejection → `{status:'error'}` (still logged). No refetch
  when auth settles (dependency list unchanged from today).
- `WatchPageContent.tsx` uses the hook; the inline related state/effect is deleted;
  `renderRelated` passes `status` + `onRetry`.
- `related/index.tsx` and `related/rtl/index.tsx` take `status`; `ready && length===0` → `null`;
  `error` → new `RelatedVideosError`; RTL heading moves to `t.video.relatedVideos` (all
  user-facing text through i18n, per project rule).
- `RelatedVideosEmpty.tsx` → `RelatedVideosError.tsx` (`data-testid="related-videos-error"`).

## Accessibility

- The failed message is announced: `role="alert"` on the error block.
- Retry is a native `<button type="button">` with a visible text label (both locales).
- The skeleton stays `aria-hidden="true"`; the list keeps `data-testid="related-videos-list"`.
- Empty state removes nothing focusable (the shelf exposes no tab stops while loading).

## Test plan

- `apps/web/src/hooks/__tests__/useRelatedVideos.test.tsx` (new): ready/error/retry/videoId-change.
- `apps/web/src/components/related/__tests__/related-section.test.tsx` (new): all four states,
  LTR + RTL; error state has `role="alert"`, retry label, filled-button classes; empty renders null.
- `WatchPageContent.related.test.tsx` (updated): empty success hides the shelf (no heading, no
  error UI, no list); failure shows the error + Try again and retry recovers; skeleton cleared on
  failure; existing "no refetch on auth settle" and "recommendations exclude current video" cases
  keep passing.
- No E2E spec asserts the old empty-equals-error behavior (`e2e/release/related.spec.ts` only
  asserts a non-empty shelf), so none needs changing.
- Run: `pnpm lint`, `pnpm type-check`, `jest` for the three suites above (build lock held).

## Risks

- R2-served dynamic translations may still carry the old keys; per-key fallback to static covers
  the rename (static holds the same strings).
- Other consumers of the `relatedEmpty` keys: none outside this shelf (grep-verified).
- When the shelf hides, the desktop side column and mobile below-player block collapse to zero
  height — intended; the watch layout already handles the comments column without the shelf.
