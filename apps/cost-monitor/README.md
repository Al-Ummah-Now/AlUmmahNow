# cost-monitor (`al-ummah-cost-monitor`)

Scheduled collector of platform analytics for the videos admin's Operations page
(`docs/admin/LIVE_OPS.md` Part A; it is the collector of `docs/cost-monitoring/README.md`).

- **Crons → queue (COST-1):** the crons only plan jobs on `COST_JOBS_QUEUE`
  (`al-ummah-cost-jobs[-qa|-stage]`, created by `scripts/release/ensure-resources.ts`); the queue
  consumer runs them (`src/jobs.ts`). A failed job retries with backoff (1, 2, 4, 8, 16 min; 6
  attempts); the last failure, a refused key or a dead-lettered job (`al-ummah-cost-jobs-dlq*`) is
  flagged on the admin **Errors** page (key `cost-job:<job>:<day>`, **Run again** = admin-api
  builtin retry `cost-job`). Every job is an idempotent upsert.
  - `10 * * * *` → `hourly` (the last 3 hours with **one** Cloudflare GraphQL request: Workers, D1,
    R2, queues, KV, Durable Objects; rollup of today; thresholds), `containers` and `bunny` for today.
  - `30 3 * * *` → `daily` (discovery, yesterday's final rollup, 13-month retention), and
    `containers`/`bunny` for yesterday, `resend` for yesterday and today.
- **Products beyond ops_daily** (`src/products.ts` → `cost_product_daily`): Containers from the
  billing dataset `containersUsageAdaptiveGroups` (our applications only, per env); Bunny from
  `GET api.bunny.net/billing` (`ThisMonthCharges`: the day's row is the month so far minus the
  month's earlier rows); Resend emails per day from `GET api.resend.com/emails` (full-access key),
  priced from the plan chosen on the Costs page.
- **Keys (Costs → Connections):** the super admin sets a read-only Cloudflare token and optional
  Bunny/Resend keys in the videos admin. admin-api seals them (AES-256-GCM, key = HKDF of
  `COST_CREDENTIALS_KEY` if bound, else `INTERNAL_API_KEY`; provider as additional data;
  `packages/shared-types/src/cost-credentials.ts`) into `cost_credentials`; this worker opens them in
  memory per job. The admin's Cloudflare token wins; until one is set the bound `CF_ANALYTICS_TOKEN`
  is used. **With no token at all every job is skipped, nothing fails**, and the Costs page asks
  for one (`cost_settings` key `collector` records which token ran).
- **Scope:** the resources in `src/manifest.ts` plus every al-ummah resource **discovered** on the
  account (`src/discover.ts`: six GET listings, names matched by `isAlUmmahName`, stored in
  `ops_resources`, dropped after 7 days unseen), so Auth, CMS, www and new Workers, databases, KV
  namespaces, buckets, queues and DO namespaces are costed without a code change. Discovery runs
  daily and whenever the stored set is empty or over 26 h old; a failed listing (e.g. a token
  without list access) keeps the stored set and is recorded in the run's detail. Queries are
  filtered with `_in` (a kind with nothing to ask for sends a name that cannot exist, never an
  empty list), and rows of anything else are dropped in memory before a write. The account is
  shared with other projects.
- **Cost:** `src/pricing.ts` list prices per resource-day (`ops_daily.cost_usd`), KV reads/writes/
  storage and DO requests, duration (`gb_seconds`, 128 MB per active object) and storage units
  included. admin-api adds Bunny, transcoding and Workers AI for the configured monthly budget (`lib/opsCost.ts`).
- **Deployments:** production collects production, stage and QA (`COLLECT_ENVS`), so the
  production admin can switch env; stage and QA collect only themselves. No route, no workers.dev.
- **Storage:** D1 `al-ummah-now-costs[-qa|-stage]` (`migrations/`), read by admin-api `/api/ops/*`
  (`COSTS_DB`). admin-api writes only `ops_thresholds` (super admins, audited) and
  `ops_cost_alerts` (the open spend alerts).
- **Alerts:** a crossed threshold becomes a needs-action item on the admin Errors page
  (key `ops:<rule>:<resource>`, source `ops`) and is resolved when the metric recovers.
- **Token fallback:** Secrets Store `media-cdn-api-token` (Account Analytics Read) as `CF_ANALYTICS_TOKEN`,
  used only until the super admin sets a read-only token on the Costs page. Keys are never logged.
- **Alerts and digest** live in admin-api (`lib/opsCost.ts` + `lib/cost-alert-mail.ts`): budget
  levels, projected overrun and spend spikes (thresholds editable on the Costs page) open Errors
  page items and email the admins who opted in; a weekly digest goes out on the chosen day and hour
  (New York time). Running cost of this worker: 25 cron invocations and about 80 queue
  messages a day, a few GraphQL/REST calls per hour; well under $0.10 a month.

```bash
pnpm --filter @al-ummah/cost-monitor test
```
