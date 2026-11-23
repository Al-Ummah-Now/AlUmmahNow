# Spec: Watch page related-videos shelf — empty vs failed (#1552)

## Problem

On the watch page, the related-videos shelf displays a load failure (`"We couldn’t load related videos right now."` + `"Try again"`) whenever `relatedVideos.length === 0`. This conflates a genuine fetch error with a successful empty result (e.g., a channel's only video, a brand-new site, or a single-video local stack). Viewers see an unrecoverable error, and clicking "Try again" repeats the same empty response.

Additionally:
- The English heading uses Title Case (`"Related Videos"`) instead of sentence case (`"Related videos"`).
- The RTL shelf hardcodes `المرئيات ذات الصلة` instead of reading `t.video.relatedVideos` from i18n.
- The retry button uses raw Tailwind color utilities (`bg-blue-700 hover:bg-blue-800 text-white`) instead of the shared flat filled button classes (`aun-btn aun-btn-filled`).

## Current behavior

- **`apps/web/src/lib/api/videos.ts:696-731, 764-797, 1061-1079, 1081-1120`**: `getRecommendedVideos` and `getTrendingVideos` swallow HTTP/network failures into `[]`, while `fetchVideos` returns `undefined` on error. `fetchRelatedVideos` calls `loadRelated` and returns `VideoInfo[]` without distinguishing total upstream failure from an empty catalog.
- **`apps/web/src/lib/video/related.ts:79-128`**: `read()` catches rejections and coerces `undefined` to `[]`, so `loadRelated()` always resolves to `[]` whether sources succeeded with zero other videos or threw.
- **`apps/web/src/components/video/WatchPageContent.tsx:85-88, 222-225, 243-263, 409-417`**: Inline `useState` + `useEffect` stores only `relatedVideos` and `relatedLoading` (no error state). `.catch()` (line 254) logs a warning and leaves `relatedVideos` empty.
- **`apps/web/src/components/related/index.tsx:9-23` & `apps/web/src/components/related/rtl/index.tsx:8-21`**: Both branch solely on `loading ? <RelatedVideosSkeleton /> : relatedVideos.length === 0 ? <RelatedVideosEmpty onRetry={onRetry} /> : <list />`. Line 11 of `rtl/index.tsx` hardcodes `المرئيات ذات الصلة`.
- **`apps/web/src/components/related/RelatedVideosEmpty.tsx:6-22`**: Renders the failure copy and a `bg-blue-700` retry button (6 hard-coded color violations in `theme-colors.allowlist.json:146`).
- **`packages/shared-types/src/i18n-static/en.ts:543`**: `relatedVideos: 'Related Videos'`.
- **`apps/web/e2e/30-watch-page.spec.ts:69`**: `WATCH-002` asserts `/ذات الصلة/` against the hardcoded RTL heading.

## Empty-shelf decision

**Decision: Hide the related-videos shelf completely (`return null`) when loading succeeds with zero other videos, and hide its outer secondary wrapper when no playlist pane is present.**

Justification against owner rules:
1. **No hollow sections**: Matches the established rule in `docs/specs/CHANNEL-SECTIONS.md` (empty sections are hidden from viewers rather than showing an empty heading/box).
2. **Honest on single-video catalogs**: `fetchRelatedVideos` already falls back from recommendations to the general public feed and monthly trending. If all succeed and still yield zero other videos, neither the channel nor Explore has another video to watch—a "More from this channel" link would lead back to the same video, and a boxed Explore CTA under a "Related videos" heading would create a hollow section (and an empty raised card in Fawanees, `apps/web/src/theme/fawanees.css:21-26`).
3. **No dead sidebar**: Omitting `watch-secondary` when both the playlist pane and the related shelf are absent prevents a 300–402px blank column on desktop (`>= lg`) and removes trailing vertical margin on mobile (`watch-secondary-below`).

## Exact UI copy

Existing i18n keys under `video` (`packages/shared-types/src/i18n-static/{en,ar}.ts`) are preserved for R2 translation-override compatibility. Arabic uses «مرئي/مرئيات»; no numerals appear in this copy.

| Element | i18n key | English (US) | Arabic |
| --- | --- | --- | --- |
| Shelf heading | `video.relatedVideos` | `Related videos` | `مرئيات ذات صلة` |
| Failure message | `video.relatedEmpty` | `We couldn’t load related videos right now.` | `تعذّر تحميل المرئيات ذات الصلة حاليًا.` |
| Retry button | `video.relatedEmptyRetry` | `Try again` | `حاول مرة أخرى` |
| Empty state | — | *(shelf hidden)* | *(shelf hidden)* |

## Shelf states

| State | Condition | Rendered output | Container (`watch-secondary` / `-below`) |
| --- | --- | --- | --- |
| **Loading** | Request in flight (`status === 'loading'`) | `<section className="related-videos" aria-busy="true">` with `<h2>` + `<RelatedVideosSkeleton />` (`data-testid="related-videos-skeleton"`) | Shown |
| **Failed** | Request threw or upstream sources failed (`status === 'failed'`) | `<section className="related-videos">` with `<h2>` + `<RelatedVideosError />` (`data-testid="related-videos-error"`, `role="alert"`) + `.aun-btn.aun-btn-filled` retry button | Shown |
| **Empty** | Request succeeded and filtered list has `0` items (`status === 'empty'` or `related.length === 0 && !failed`) | `null` (nothing rendered; never an error) | `watch-secondary` hidden unless playlist pane is active; `watch-secondary-below` hidden |
| **Loaded** | Request succeeded and filtered list has `>= 1` items (`status === 'loaded'`) | `<section className="related-videos">` with `<h2>` + `<div data-testid="related-videos-list">` | Shown |

State transitions:
- `videoId` changes -> `loading` (previous in-flight promise cancelled).
- `loading` -> `loaded` / `empty` on resolve; `loading` -> `failed` on reject.
- Clicking "Try again" in `failed` -> increments attempt -> `loading` -> `loaded` / `empty` / `failed`.
- Auth settling does **not** refetch.

## Architecture changes

1. **`apps/web/src/lib/video/related.ts`**: Add `loadRelatedWithStatus()` returning `{ status: 'loaded' | 'empty' | 'failed'; videos: VideoInfo[] }`. Keep `loadRelated()` delegating to it for backwards compatibility.
2. **`apps/web/src/lib/api/videos.ts`**: Extract internal `requestRecommendedVideos` / `requestTrendingVideos` returning `VideoObject[] | undefined` (preserving `getRecommendedVideos` / `getTrendingVideos` public signatures). `fetchRelatedVideos` calls `loadRelatedWithStatus` and throws when `status === 'failed'`, resolving to `[]` when `status === 'empty'`.
3. **`apps/web/src/hooks/useRelatedVideos.ts`**: Extract the watch page's related-videos state machine (`status`, `videos`, `loading`, `failed`, `retry`) so it is cleanly separated and unit-testable.
4. **`apps/web/src/components/related/`**:
   - Replace `RelatedVideosEmpty.tsx` with `RelatedVideosError.tsx` (`role="alert"`, `text-[var(--fanous-color-text-secondary)]`, `<button type="button" className="aun-btn aun-btn-filled">`). Zero hard-coded colors; update `theme-colors.allowlist.json` via `pnpm check:theme-colors --update`.
   - Update `index.tsx` (LTR) and `rtl/index.tsx` (RTL) to accept `failed?: boolean`, render `<section aria-labelledby={headingId}>`, use `t.video.relatedVideos` in both LTR and RTL, show `<RelatedVideosError />` only when `failed`, and return `null` when empty.
5. **`apps/web/src/components/video/WatchPageContent.tsx`**: Use `useRelatedVideos(videoId)`, pass `failed` to both LTR/RTL sections, and hide empty secondary wrappers cleanly.

## Accessibility

- Landmark region: `<section aria-labelledby={headingId}>` with `useId()` so desktop and mobile copies never produce duplicate `id`s.
- Loading announcement: `aria-busy="true"` on the section while loading; `<RelatedVideosSkeleton />` remains `aria-hidden="true"`.
- Error announcement: `<RelatedVideosError />` uses `role="alert"`; the inactive viewport copy is `display: none` so screen readers announce only the visible copy once.
- Retry button: native `<button type="button">` with `.aun-btn.aun-btn-filled` (token-driven WCAG AA contrast across all themes/modes, `var(--aun-btn-height)` touch target, `:focus-visible` ring via `--fanous-color-focus-ring`).
- RTL: `dir="rtl"` preserved on the RTL shelf with logical spacing.

## Test plan

- **Unit (`apps/web/src/lib/video/__tests__/related.test.ts`)**: `loadRelatedWithStatus` returns `loaded`, `empty` (all sources 200 with `[]` or `[cur]`), and `failed` (upstream sources throw or return `undefined`).
- **Unit (`apps/web/src/hooks/__tests__/useRelatedVideos.test.ts`)**: `loading` -> `loaded`, `empty`, `failed`; retry recovers from `failed`; stale requests ignored on `videoId` change/unmount.
- **Unit (`apps/web/src/components/related/__tests__/RelatedVideosSection.test.tsx`)**: LTR and RTL render all 4 states, sentence-case `"Related videos"` / i18n `"مرئيات ذات صلة"`, `aun-btn aun-btn-filled` (no `bg-blue-700`), `role="alert"`, `aria-busy`, `aria-labelledby`, and `onRetry` click.
- **Integration (`apps/web/src/components/video/__tests__/WatchPageContent.related.test.tsx`)**: Empty response (both `[]` and `[cur]`) hides the shelf and secondary containers with no error/retry; failed request shows error + retry and recovers when retried; auth state settling does not refetch.
- **E2E (`apps/web/e2e/30-watch-page.spec.ts`)**: Update `WATCH-002` line 69 regex from `/ذات الصلة/` to `/ذات (ال)?صلة/` (matching the i18n heading `مرئيات ذات صلة`).
- **Verification**: `pnpm check:theme-colors`, `pnpm --filter @al-ummah/shared-types type-check`, `pnpm --filter @al-ummah/shared-types test`, `pnpm --filter @al-ummah/web lint`, `pnpm --filter @al-ummah/web type-check`, affected Jest suites, and `apps/api-videos` i18n sync tests.

## Risks

- **Desktop transition on 1-video stacks**: While loading, the skeleton occupies the side column; if the catalog truly has 1 video, collapsing `watch-secondary` widens the player once the fetch finishes. Multi-video stacks (production, QA, and all layout/CLS E2E specs) never collapse, so steady-state CLS is unaffected.
- **R2 translation overrides**: Keeping existing i18n key names (`video.relatedVideos`, `video.relatedEmpty`, `video.relatedEmptyRetry`) avoids breaking stored overrides; any admin-edited override for `video.relatedVideos` continues to win over the static fallback.
- **Color-lint allowlist**: Removing `RelatedVideosEmpty.tsx` lowers hard-coded color counts, which fails `pnpm check:theme-colors` unless `theme-colors.allowlist.json` is updated in the same commit.
