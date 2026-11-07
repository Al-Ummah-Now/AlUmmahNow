# Admin Web UI Test Plan

Playwright suite for `apps/admin-web`, run against a deployed environment
(QA by default). Source: `apps/admin-web/e2e/`, config:
`apps/admin-web/playwright.config.ts`, CI: `.github/workflows/admin-e2e.yml`.

## Running

```bash
cd apps/admin-web
export QA_SEED_PASSWORD=...            # never commit; CI uses the repo secret
pnpm exec playwright install chromium webkit
pnpm exec playwright test              # all projects
pnpm exec playwright test --project=chromium e2e/05-report-actions.spec.ts
pnpm exec playwright show-report
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADMIN_WEB_URL` | `https://admin.qa.alummahnow.net` | base URL under test |
| `ADMIN_API_URL` | `https://admin.api.qa.alummahnow.net` | fixtures, cleanup, cross-checks |
| `VIDEOS_API_URL` | `https://videos.api.qa.alummahnow.net` | filing reports, reading translations |
| `OPENAUTH_URL` | `https://auth.qa.alummahnow.net` | login |
| `QA_SEED_PASSWORD` | (required) | password of `qa-admin@` / `qa-moderator@delivered.resend.dev` |
| `QA_NONADMIN_EMAIL` / `QA_NONADMIN_PASSWORD` | throwaway QA user | role-less account; also files the test reports |
| `E2E_REUSE_AUTH=1` | off | reuse storage states/tokens younger than 1h |

**Projects:** `chromium` (Desktop Chrome), `webkit` (Desktop Safari), `mobile` (Pixel 5).

**Global setup** logs in admin, moderator and non-admin through the real
auth-server password form and saves `e2e/.auth/{admin,moderator,nonadmin}.json`
(gitignored). It also gets API tokens with a headless OAuth code flow, dismisses
e2e reports left open by earlier runs, and files 21 pending comment reports so
pagination has more than one page.

**Test data and cleanup:** every report is filed through
`POST /api/moderation/reports` on api-videos, as the non-admin user, against
a made-up `e2e-admin-*` entity id. No real content is hidden or banned.
admin-api has no delete endpoint, so cleanup means dismissing: the
`makeReport` fixture dismisses its reports after each test, and global
teardown dismisses any `e2e-admin-*` report still open. The translation test
edits `common.loading` (en), reverts it in the UI, and restores it through
admin-api if the revert fails. It runs only in the chromium project, in
serial mode, so concurrent merges cannot bring back the temporary value.
CI runs are serialised with `concurrency: admin-e2e-qa`.

## Case inventory and status

Status is from the last full run against QA (2026-11-07, after deploying
this branch's admin-web and admin-api): **317 passed, 5 failed, 8 skipped**.
By project: chromium 109/1/0, webkit 106/2/2, mobile 102/2/6
(passed/failed/skipped).

Legend: P = pass, F = fail, S = skipped by design.

### Authentication and access (`01-auth.spec.ts`)
| ID | Case | chromium | webkit | mobile |
| --- | --- | --- | --- | --- |
| AUTH-01 | Each protected route (dashboard, moderation, translations, indices, report) sends a signed-out user to `/authorize` with this app's callback | P | P | P |
| AUTH-02 | Signed-out home page offers a login link | P | P | P |
| AUTH-03 | Admin logs in through the auth server; `admin_session` is HttpOnly and Secure | P | P | P |
| AUTH-04 | Moderator logs in | P | P | P |
| AUTH-05 | Non-admin lands on Access Denied with no admin session | P | P | P |
| AUTH-06 | A forged `admin_session` cookie is rejected | P | P | P |
| AUTH-07 | Login error codes show localized messages; unknown codes show a generic message | P | P | P |
| AUTH-08 | Callback without a code goes to `no_code` | P | P | P |
| AUTH-09 | Callback with an invalid code goes to `exchange_failed` | P | P | P |
| AUTH-10 | `/login` while signed in goes to the dashboard | P | P | P |
| AUTH-11 | Home page greets the signed-in admin | P | P | P |
| AUTH-12 | Logout from the nav clears the session | P | P | P |
| AUTH-13 | Logout responds with 303 (no POST replay) | P | P | P |
| AUTH-14 | A denied user cannot reach admin pages | P | P | P |
| AUTH-15 | Logout from Access Denied returns to the home page | P | P | P |

### Dashboard (`02-dashboard.spec.ts`)
| ID | Case | chromium | webkit | mobile |
| --- | --- | --- | --- | --- |
| DASH-01 | Stat cards are labelled and consistent with admin-api stats | P | P | P |
| DASH-02 | A newly filed report increases the total; pending badge shown | P | P | P |
| DASH-03 | Cards link to moderation, translations and indices | P | P | P |
| DASH-04 | Moderator sees the dashboard without errors | P | P | P |

### Navigation (`03-navigation.spec.ts`)
| ID | Case | chromium | webkit | mobile |
| --- | --- | --- | --- | --- |
| NAV-01 | Nav reaches every section; exactly one `aria-current="page"` | P | P | P |
| NAV-02 | Brand link goes to the dashboard | P | P | P |
| NAV-03 | Report detail keeps Moderation active | P | P | P |
| NAV-04 | Email shown on wide screens; no horizontal overflow on mobile | P | P | P |
| NAV-05 | Unknown routes return a localized 404 page | P | P | P |
| NAV-06 | Back and forward work across sections | P | P | P |

### Moderation queue (`04-moderation-queue.spec.ts`)
| ID | Case | chromium | webkit | mobile |
| --- | --- | --- | --- | --- |
| MOD-01 | A new report is listed with type, reason, status and date; View opens the detail | P | P | P |
| MOD-02 | Status filter narrows the list and updates the URL | P | P | P |
| MOD-03 | Content type filter narrows the list | P | P | P |
| MOD-04 | Combined filters match admin-api totals; Clear filters resets | P | P | P |
| MOD-05 | Keyboard: Apply filters is reachable and submits | P | S (WebKit tab model) | S (desktop only) |
| MOD-06 | Pagination: 20 rows per page; Next/Previous keep the filters | P | P | P |
| MOD-07 | Invalid query values are ignored, not shown as an error | P | P | P |
| MOD-08 | A page past the end shows the empty state | P | P | P |
| MOD-09 | Filters offer all 6 entity types and 4 statuses | P | P | P |

### Report detail and actions (`05-report-actions.spec.ts`)
| ID | Case | chromium | webkit | mobile |
| --- | --- | --- | --- | --- |
| RPT-01 | Detail shows every field and the action panel | P | P | P |
| RPT-02 | The reporter's description reaches the moderator | **F** (1) | **F** (1) | **F** (1) |
| RPT-03 | Unknown report id shows the report 404 inside the admin shell | P | P | P |
| ACT-01 | Dismiss with notes, and the decision is still in place after the queue consumer runs | P (2) | **F** (2) | **F** (2) |
| ACT-02 | Issue Warning resolves with action `warning` | P | P | P |
| ACT-03 | Remove Content (hide) resolves with action `removed`; notes kept | P | P | P |
| ACT-04 | Ban Content resolves with action `banned` | P | P | P |
| ACT-05 | A closed report cannot be actioned again (409); first decision kept | P | P | P |
| ACT-06 | Acting on a report closed in another tab shows "already closed" | P | P | P |
| ACT-07 | A failed action request shows an error and keeps the page usable | P | P | P |
| ACT-08 | A moderator can dismiss a report | P | P | P |

(1) Fixed in this branch (api-videos `reportCreate.ts`), but QA's api-videos
was deployed from another branch, so it still drops the description.

(2) Fixed in this branch (processor `ReportResolve`), but QA's processor was
redeployed from another branch during the run (05:23 UTC). That build still
forces `status='resolved'` after a dismissal, normally within seconds. Whether
the chromium run catches this depends on queue delivery timing; direct API
probes reproduce it 4 out of 4 times.

### Translations (`06-translations.spec.ts`)
| ID | Case | chromium | webkit | mobile |
| --- | --- | --- | --- | --- |
| TR-01 | Metadata cards match `/api/i18n/metadata` | P | P | P |
| TR-02 | Default section lists keys; the count matches | P | P | P |
| TR-03 | Nested groups are flattened (no `[object Object]`) | P | P | P |
| TR-04 | Search filters keys and values; no-match message | P | P | P |
| TR-05 | Arabic values render RTL | P | P | P |
| TR-06 | Cancel and Escape discard an edit | P | P | P |
| TR-07 | A failing load shows the error state; Retry recovers | P | P | P |
| TR-08 | Edit, save, reload, check public API, revert (`common.loading`) | P | S (one project) | S (one project) |

### Indices (`07-indices.spec.ts`)
| ID | Case | chromium | webkit | mobile |
| --- | --- | --- | --- | --- |
| IDX-01 | `GET /api/indices` rejects an invalid token (401) | P | P | P |
| IDX-02 | Indices page matches `operation=status` (rows, stale/fresh, total videos) | P | P | P |

### Language and RTL (`08-i18n-rtl.spec.ts`)
| ID | Case | chromium | webkit | mobile |
| --- | --- | --- | --- | --- |
| I18N-01 | Language switcher sets `lang=ar dir=rtl`, persists across reload, switches back | P | P | P |
| I18N-02 | `Accept-Language: ar` defaults to Arabic | P | P | P |
| I18N-03 | Dashboard, moderation, translations, indices: Arabic headings, no English nav text, no overflow, brand on the right | P | P | P |
| I18N-04 | Report detail and action labels are in Arabic; ids stay LTR | P | P | P |
| I18N-05 | Filters and table headers are in Arabic | P | P | P |
| I18N-06 | Public home, login error and 404 are in Arabic | P | P | P |
| I18N-07 | Access Denied is in Arabic | P | P | P |

### Theme (`09-theme.spec.ts`)
| ID | Case | chromium | webkit | mobile |
| --- | --- | --- | --- | --- |
| THEME-01 | Follows a dark OS preference by default | P | P | P |
| THEME-02 | Explicit Light overrides a dark OS and persists | P | P | P |
| THEME-03 | Follows a light OS preference by default | P | P | P |
| THEME-04 | Explicit Dark applies on every page | P | P | P |
| THEME-05 | Back to System removes the override | P | P | P |

### Accessibility (`10-accessibility.spec.ts`)
| ID | Case | chromium | webkit | mobile |
| --- | --- | --- | --- | --- |
| A11Y-01 | axe WCAG 2.1 A/AA on dashboard, moderation, translations, indices and 404, in en/ar and light/dark (20 scans) | P | P | P |
| A11Y-02 | axe on report detail with an action selected, in en/ar and light/dark | P | P | P |
| A11Y-03 | axe on public home and login error, in en/ar and light/dark | P | P | P |
| A11Y-04 | axe on Access Denied, in en/ar and light/dark | P | P | P |
| KBD-01 | Skip link is the first tab stop and focuses `main` | P | P | S (desktop only) |
| KBD-02 | Nav links are in the tab order and show a focus indicator | P | P | S |
| KBD-03 | A moderation action can be completed with the keyboard | P | P | S |
| KBD-04 | Translation edit focuses the textbox; Escape cancels | P | P | S |

### Error states (where they are covered)
Auth errors: AUTH-06 to AUTH-09. Invalid filters and out-of-range pages:
MOD-07, MOD-08. Unknown report and route: RPT-03, NAV-05. Closed report and
failed request: ACT-05 to ACT-07. Translations load failure and retry: TR-07.

## Bugs found and fixed

| # | Area | Bug | Fix |
| --- | --- | --- | --- |
| 1 | admin-web auth (security) | The `admin_session` cookie was trusted as plain JSON. A hand-made cookie with `role: super_admin` rendered the admin UI. `auth.ts` was also a `'use server'` module, so `setAdminSession` could be called from the client as a server action. | The access token is verified (and refreshed) on every request; identity and role come from the verified token. `auth.ts` is server-only, and logout moved to `app/actions.ts`. (AUTH-06) |
| 2 | admin-web moderation | Status and type filters were selects with no handler, so they did nothing. Pagination links dropped the filters. | GET form with auto-submit and an Apply button. Pagination keeps the filters. (MOD-02 to MOD-06) |
| 3 | admin-web moderation | `?status=bogus` passed the value to admin-api and showed "Admin API error: Bad Request". | Query values are validated and unknown ones dropped. (MOD-07) |
| 4 | admin-web actions | After a successful action the button stayed on "Processing...", because `router.refresh()` right after `push()` cancelled the navigation. | Push only. (ACT-01 to ACT-04) |
| 5 | admin-web actions | Server-action errors are redacted in production, so the 409 "already closed" error never reached the user. | `takeAction` returns a result object, and errors are mapped to localized messages. Network failures are caught. (ACT-06, ACT-07) |
| 6 | admin-web translations | Nested groups (e.g. `channel.tabs`) showed `[object Object]`, and saving one overwrote the whole group with that string. | Nested keys are flattened into dotted rows and saved as nested updates. (TR-03) |
| 7 | admin-web translations | Requests sent `{mode}`, but admin-api reads a boolean `merge`, so "replace" silently merged. | Send `merge`. |
| 8 | admin-web translations | Retry refetched only one of the two queries, so the error state never cleared. | Refetch both. (TR-07) |
| 9 | admin-web logout | `/api/logout` replied 307, so the browser re-POSTed to `/`. Logout from Access Denied went to `/login`, which restarts OAuth straight away. | 303 to `/`; the server action also redirects to `/`. (AUTH-12, AUTH-13, AUTH-15) |
| 10 | admin-web i18n/RTL | All text was hard-coded English, with no Arabic and no RTL (against CLAUDE.md). | en/ar dictionaries; `lang`/`dir` rendered on the server from a cookie or Accept-Language; logical CSS properties; language switcher. (I18N-*) |
| 11 | admin-web theme/a11y | Dark-only theme. Unlabelled selects and labels. Action buttons with white text on yellow-600/orange-600 (below 4.5:1 contrast). No skip link or landmarks. Desktop-only nav. | Light/dark/system theme with AA colour tokens; labels, captions, `aria-current`, `aria-pressed`, skip link; focusable scroll region; reduced-motion support; responsive nav. (THEME-*, A11Y-*, KBD-*) |
| 12 | admin-web | Unbranded default 404; no error boundary. | Localized 404 pages for the app and for reports; error boundary for the protected area. (NAV-05, RPT-03) |
| 13 | admin-api | Actions on already-closed reports returned 200 and overwrote the earlier decision. Concurrent actions could both succeed. | 409 when the report is closed; the UPDATE only applies to open reports. (ACT-05) |
| 14 | admin-api / processor | The processor's `ReportResolve` hard-coded `status='resolved'` and set the notes from a field admin-api never sent. About a second after a dismissal, the report showed as resolved with its notes gone. | admin-api sends `status` and `moderatorNotes`. The processor uses that status and `COALESCE`s the moderator fields. Report inserts are idempotent. Unit test `report-resolve.test.ts`. (ACT-01, ACT-03) |
| 15 | api-videos | `ReportCreate` did not include `description` in the queue message, so D1 and the admin queue never had it. | Forward it. (RPT-02) |
| 16 | admin-api | `isAdmin`/`isModerator` helpers ignored `super_admin`. | Include it. |

## Known issues / follow-ups

- RPT-02 and ACT-01 need this branch's api-videos and processor changes on
  QA. QA's api-videos and processor are shared and were deployed from other
  branches, so they were not redeployed from here.
- Reports cannot be deleted, so each run leaves about 40 dismissed `e2e-admin-*`
  reports in QA's D1, which the dashboard counts. A delete endpoint would
  allow a hard cleanup.
- The auth server keeps no SSO session. After logout, `/login` asks for
  credentials again (AUTH-14 relies on this).
