# cost-monitor (`al-ummah-cost-monitor`)

Scheduled collector of platform analytics for the videos admin's Operations page
(`docs/admin/LIVE_OPS.md` Part A; it is the collector of `docs/cost-monitoring/README.md`).

- **Crons:** `10 * * * *` collects the last 3 hours (idempotent) with **one** Cloudflare GraphQL
  request (Workers, D1, R2, queues), rolls up today and checks the alert thresholds;
  `30 3 * * *` finalises yesterday and prunes rows older than 13 months.
- **Scope:** only the resources in `src/manifest.ts`. Queries are filtered with `_in`, and rows of
  anything else are dropped in memory before a write. The account is shared with other projects.
- **Deployments:** production collects production, stage and QA (`COLLECT_ENVS`), so the
  production admin can switch env; stage and QA collect only themselves. No route, no workers.dev.
- **Storage:** D1 `al-ummah-now-costs[-qa|-stage]` (`migrations/`), read by admin-api `/api/ops/*`
  (`COSTS_DB`). admin-api writes only `ops_thresholds` (super admins, audited).
- **Alerts:** a crossed threshold becomes a needs-action item on the admin Errors page
  (key `ops:<rule>:<resource>`, source `ops`) and is resolved when the metric recovers.
- **Token:** Secrets Store `media-cdn-api-token` (Account Analytics Read) as `CF_ANALYTICS_TOKEN`,
  until the least-privilege `al-ummah-cost-monitor-read` token exists. Never logged.

```bash
pnpm --filter @al-ummah/cost-monitor test
```
