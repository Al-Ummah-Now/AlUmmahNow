# cost-monitor (`al-ummah-cost-monitor`)

Scheduled collector of platform analytics for the videos admin's Operations page
(`docs/admin/LIVE_OPS.md` Part A; it is the collector of `docs/cost-monitoring/README.md`).

- **Crons:** `10 * * * *` collects the last 3 hours (idempotent) with **one** Cloudflare GraphQL
  request (Workers, D1, R2, queues, KV, Durable Objects), rolls up today and checks the alert
  thresholds; `30 3 * * *` discovers resources, finalises yesterday and prunes rows older than 13 months.
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
  included. admin-api adds Bunny, transcoding and Workers AI for the $500 budget (`lib/opsCost.ts`).
- **Deployments:** production collects production, stage and QA (`COLLECT_ENVS`), so the
  production admin can switch env; stage and QA collect only themselves. No route, no workers.dev.
- **Storage:** D1 `al-ummah-now-costs[-qa|-stage]` (`migrations/`), read by admin-api `/api/ops/*`
  (`COSTS_DB`). admin-api writes only `ops_thresholds` (super admins, audited) and
  `ops_cost_alerts` (the open spend alerts).
- **Alerts:** a crossed threshold becomes a needs-action item on the admin Errors page
  (key `ops:<rule>:<resource>`, source `ops`) and is resolved when the metric recovers.
- **Token:** Secrets Store `media-cdn-api-token` (Account Analytics Read) as `CF_ANALYTICS_TOKEN`,
  until the least-privilege `al-ummah-cost-monitor-read` token exists. Never logged.

```bash
pnpm --filter @al-ummah/cost-monitor test
```
