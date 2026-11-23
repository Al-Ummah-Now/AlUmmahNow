# #1552 — Related shelf: empty vs failed

## Problem and current behavior

The watch page must not report a successful request with no recommendations as a load failure. Today `WatchPageContent` stores only an array and a loading flag; its fetch effect logs a rejection without recording it (`apps/web/src/components/video/WatchPageContent.tsx:85-88,243-263`). Both shelf variants consequently route every non-loading empty array to `RelatedVideosEmpty` (`apps/web/src/components/related/index.tsx:9-20` and `apps/web/src/components/related/rtl/index.tsx:8-19`). That component shows the failure copy and retry button for both outcomes, with raw `bg-blue-700` styling (`apps/web/src/components/related/RelatedVideosEmpty.tsx:5-20`). The English heading is title case (`packages/shared-types/src/i18n-static/en.ts:543`), and the RTL heading is hardcoded rather than read from i18n.

## Decision

Hide the entire related shelf after a **successful** result that yields no displayable videos, including its heading, placeholder, and retry action. This follows the owner's “no hollow sections” rule and avoids adding a second, low-value discovery surface when the recommendation service has already found nothing. A failure remains visible and actionable because it is not an empty result.

## Exact UI copy

| Purpose | English | Arabic |
| --- | --- | --- |
| Heading | `Related videos` | `مرئيات ذات صلة` |
| Request failed | `We couldn’t load related videos right now.` | `تعذّر تحميل المرئيات ذات الصلة حاليًا.` |
| Retry | `Try again` | `حاول مرة أخرى` |

The existing failure wording is retained. Both LTR and RTL components consume these shared i18n values; empty renders no copy. No numerals are introduced.

## State contract

- **Loading:** show the heading and skeleton; clear any previous failure while a retry is pending.
- **Failed:** show the heading, localized failure message, and localized retry button. Retry starts one new request.
- **Empty (success):** return no shelf markup in either LTR or RTL, whether the API returned no items or all returned items were filtered from the displayed list.
- **Loaded:** show the sentence-case localized heading and related-video list.

The related-videos loader owns explicit loading, failure, data, and retry state, ignores stale completions after video changes, and preserves the existing behavior of not refetching merely because auth settles.

## Accessibility and styling

Keep the heading as an `h2`. Skeleton rows remain hidden from assistive technology. The failure message uses `role="alert"`; retry remains a native `type="button"` with an accessible localized name and visible keyboard focus. Replace raw blue classes with the shared flat filled-button tokens (`--aun-btn-filled-bg`, `--aun-btn-filled-fg`, `--aun-radius-button`) and the shared focus-ring token. RTL retains `dir="rtl"` and uses the same translated strings.

## Test plan

- Unit-test the related loader: initial loading, loaded data, successful empty, rejection, retry, and stale-response protection.
- Unit-test both shelf variants: loading skeleton, failed message/retry, empty returning no markup, loaded cards, localized heading, and filled-button/focus classes.
- Update the watch-page regression suite so empty success never shows an error and only failure can retry.
- Update the Arabic watch-page E2E so it accepts a successful empty shelf without an error and checks the localized heading when a related list is present.
- Run the affected Jest suites, web/shared-types type-checks, and ESLint on changed files under the shared build lock. Release recommendation behavior remains unchanged.

## Risks

- Hiding a previously visible section changes layout after loading; this is intentional and limited to successful empty results.
- Retrying must clear stale data/failure without allowing an older request to overwrite a newer video’s shelf.
- Existing translation keys retain their names for compatibility, but are used only for the failed state rather than successful empty results.
