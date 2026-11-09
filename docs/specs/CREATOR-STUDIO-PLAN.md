# Web Creator Studio: plan

**Spec:** [CREATOR-STUDIO.md](CREATOR-STUDIO.md)
**Status:** Owner decisions are in (spec §10). Nothing below has started, and it doesn't start until the go-ahead.

Each step is one PR into `main`, with tests written first (`BEFORE_YOU_CODE.md`). QA follows `main`. The owner is holding merges, so PRs may queue up in this order.

Retention and traffic collection comes first, because every day before it ships is a day of data the charts can never show. Studio pages have no links to them until step 19, so users see no change until then.

## Prerequisites

| # | Item | Needed by | Notes |
|---|---|---|---|
| P1 | `CHANNEL_ROLES_DB` created per environment (same as #462 plan P2) | Step 13 | Studio doesn't wait for #462, but block storage needs this database. Step 13 adds only its own migration if #462 hasn't run yet |
| P2 | Epic 27 entitlements on `main` (#390 and the PRs around it) | Steps 10, 13, 16 | Until then, gated features use the catalogue fallback |
| P3 | Native speaker available to review Arabic strings | Before step 19 | |
| P4 | Decisions D2 and D3 | Follow-up only | Waiting on Cloudflare. Nothing in steps 1 to 21 needs them |

## Steps

Every step lists its tests first. Each UI step also has the page's E2E (spec §9.2), both locales, axe, and the role checks that apply at that time (spec §9.3).

### Data collection

**1. Processor rollups.** The consumer ships before anything produces.
- Tests: the increments, bounded hosts, exact totals with concurrent consumers on the D1 fake, and a case for every produced `MessageType`.
- Build: `MessageType.VideoRetention` and its payload in `packages/shared-types`. Retention and traffic as D1 counter increments (`retention`, `retention_start`, `traffic`, `external_host`) in `apps/processor/src/lib/analytics-rollup.ts`, on #505's `CounterBatch`.

**2. api-videos ingest.**
- Tests: `POST /api/videos/:id/retention` validation, rate limit, and deleted or hidden videos. `POST /api/videos/:id/view` accepts valid `trafficSource` and `referrerHost`, and refuses other values.
- Build: the route and the changed view input.

**3. Player capture and forwarding.** Data starts accumulating here.
- Tests: the retention tracker (seek, rewatch, invalid duration, flush triggers, no consent) and the source classifier (every row of spec §8.4, host only).
- Build: the tracker in `services/analytics/`, the traffic helper, the batch `context`, and `app/api/analytics/video/route.ts` forwarding real values in place of the hard-coded ones.
- Docs: `docs/analytics/README.md` and `docs/compliance/GDPR.md`.
- Check on QA after merge: play a video and find the retention and rollup documents.

**4. Read APIs.**
- Tests: curve maths across months, 10-start minimum, owner only, range limit from `analytics.retentionDays`.
- Build: `GET /api/analytics/videos/:videoId/retention`, the `traffic` field on the channel and video responses, the new entitlement keys.

### Studio frame

**5. Frame and access.**
- Tests: page guard and navigation per role, every resolver branch (spec §3.2), the errors in spec §3.5.
- Build: `app/[locale]/studio/`, `[channelId]/layout.tsx`, left rail, drawer, switcher, no-channel page, resolvers. A `can()`-shaped helper returning `owner` or none until #462 ships, so pages need no rewrite.
- Also: Firefox and WebKit projects for Studio specs in `playwright.release.config.ts`, and Studio files with no theme-colour allowlist entries.

### Content

**6. Content backend.**
- Tests: the status rule, table-driven (spec §9.1). `/content` and `/content/summary`, filters, cursor, index sync and rebuild for the new columns.
- Build: `SEARCH_DB` migration and snapshot, `isDraft` on the record, the two routes.

**7. Content page, Videos tab.**
- Tests: E2E for each status filter, other filters, existing bulk actions, schedule actions, calendar and list.
- Build: the Content frame with its type tabs, and the Videos tab, reusing `BulkEditDialog`, `ScheduledVideoCalendar`, `ScheduledVideosList`.

**8. Drafts and new bulk actions.**
- Tests: save as draft, cancelled schedule becomes a draft, publish clears it, bulk playlist and bulk schedule with partial failures.
- Build: upload option, `publish-now` for drafts, `bulk-playlist`, `bulk-schedule`.

**9. Video editor in Studio.**
- Tests: E2E save and return. Resolver for a video id.
- Build: move the edit page into the frame, with tabs and playlist assignment.

### Analytics and Dashboard

**10. Analytics page.**
- Tests: API for `top-content`. E2E with real playback, with and without consent. Partial failure keeps the other sections.
- Build: overview, Top content, per-video page with the retention chart and traffic sources. Merge the `AnalyticsDashboard` RTL copy.

**11. Dashboard.**
- Tests: cards per role, new channel, one card failing.
- Build: the page. Recent comments arrive with step 14, and the card is hidden until then.

### Comments

**12. Soft removal and the index.**
- Tests: spec §9.1 comment removal list, index sync and rebuild.
- Build: `channel_comments` in `SEARCH_DB`, soft removal in the video and post `DELETE` routes, `eraseUserData`, the 90-day daily purge, `GET /comments` and `/summary`.

**13. Comment actions.**
- Tests: each action per capability. A blocked account's new comment is visible only to them, and isn't in the Held tab.
- Build: restore, pin, heart, hide, post approve, bulk, and `channel_blocks` with enforcement in the comment create routes.

**14. Comments page.**
- Tests: E2E including remove then restore.
- Build: Inbox, Held, Removed, and Dashboard's recent comments.

### Remaining pages

**15. Playlists, Posts tab, Layout tab.** One PR each if a reviewer prefers.
- Tests: E2E per page.
- Build: move into the frame. Fold `PlaylistManager/rtl` into one component. Add the post edit page.

**16. Customisation Profile tab and Settings General tab.**
- Tests: every field, handle owner-only at the UI and API, delete channel confirmation.
- Build: move the edit form. Coordinate with #441 if it merges first. The Settings page.

**17. Content, Live tab.**
- Tests: list, schedule, cancel, the unavailable health state, no key or ingest field.
- Build: the tab and `GET /api/live-streams/:id/health` returning unavailable.

**18. Live chat moderation.**
- Tests: messages stored, removal reaches viewers, chat off, block shared with step 13, the 30-day purge.
- Build: `live_chat_messages`, the routes, websocket broadcast, the Chat tab.

### Going live to users

**19. Entry points, links and redirects.** Studio becomes visible here.
- Tests: spec §9.4, every row in both locales. Move the listed E2E specs to the new URLs.
- Build: the account menu (after the nav clean-up PR), internal links (spec §2.2), redirects, removal of old page files.
- Arabic review (P3) is done before this merges.

**20. Sweep.**
- Tests: visual checks in all four themes, light and dark, across Chromium, Firefox, WebKit and the mobile projects. Add the specs to the Release regressions table in `CLAUDE.md`.
- Build: fixes only.

**21. Settings, Permissions tab.** When #462's plan reaches step 6.
- Tests: from #462 §15, at the new URL.
- Build: the tab at `studio/{channelId}/settings/permissions`, and swap the helper from step 5 to #462's `can()` and `GET /api/channels/access`.

## Parallel work

To go faster, these lanes don't depend on each other once step 5 is merged: Content (6 to 9), Analytics (10), Comments (12 to 14), Remaining pages (15 to 18). Steps 1 to 4 can run alongside step 5 from the start.

## After D2 and D3

A separate PR adds stream keys and rotation, ingest URLs, OBS export, provider start and stop, and the health adapter behind the existing response.

## Rollout

1. Merge steps in order, within the lanes. Migrations run through the normal CI path. All are additive.
2. Owner tries each page on QA at its direct URL before step 19.
3. Step 19 goes to QA, then a tagged release takes it to production.

## Risks

| Risk | Mitigation |
|---|---|
| Extra rollup writes lose increments between isolates | Same accepted limit as today's rollups. Curves are shares, so small losses barely change them |
| Few viewers allow analytics, so curves are sparse | 10-start minimum, and the page says what it covers |
| Prod's imported videos have no channel (`channelId: null`) | They appear in no Studio until the data migration issue is done. That issue should run before step 19 |
| A permission gap in the moved routes | Undeclared routes stay owner-only, and step 5's role tests grow with each page |
| Soft removal leaves text that should be gone | Purge job and erasure tested in step 12 |
| Redirects miss a link | Every row is tested, and old routes aren't removed until they pass |
| #441 or the nav clean-up PR conflicts | Steps 16 and 19 are rebased onto whichever merges first |
| #462 changes the matrix | Pages read capabilities, so only the tests change |
