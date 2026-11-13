# Field Core Web Vitals (RUM)

Wiki AUN-SEO phase 4, issue #1207, owner decision D-SEO-9 (own analytics, cookieless, no consent needed).

## What is collected

One page load in 20 (`RUM_SAMPLE_RATE`, `apps/web/src/lib/rum/vitals.ts`) loads `web-vitals` and, when the page is hidden, sends one beacon to `POST /api/rum`:

| Field | Values |
|---|---|
| page kind | `home`, `watch`, `short`, `channel`, `playlist`, `search`, `explore`, `feed`, `studio`, `other` (from the path; the path itself is never sent) |
| device | `phone` (< 768 px), `tablet` (< 1024 px), `desktop` |
| locale | `en`, `ar` |
| metrics | LCP (ms), CLS, INP (ms), whichever the page produced |

Nothing else: no URL, no ids, no user agent, no IP, no cookie read or set, no browser storage. The sample is decided per page load with `Math.random()`.

## Where it goes

`apps/web/src/app/api/rum/route.ts` writes one Workers Analytics Engine data point per metric through the `RUM` binding:

| Environment | Dataset |
|---|---|
| production | `al_ummah_now_rum` |
| stage | `al_ummah_now_rum_stage` |
| QA | `al_ummah_now_rum_qa` |

Data point: `index1` = metric, `blob1..5` = metric, page kind, device, locale, environment, `double1` = value. Local development and the local stack have no dataset: beacons are accepted and dropped. Analytics Engine keeps data for 3 months.

## Reading the numbers

```bash
CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… \
  node --experimental-strip-types --no-warnings scripts/ops/rum-report.ts --env production --days 7
```

It prints a Markdown table of weighted p75 per metric, page kind, device and locale, rated against the Core Web Vitals thresholds (LCP 2.5 s / 4 s, CLS 0.1 / 0.25, INP 200 ms / 500 ms). The token needs **Account Analytics: Read**. The same query works in the Cloudflare dashboard (Workers → Analytics Engine) or any SQL API client:

```sql
SELECT blob1 AS metric, blob2 AS kind, blob3 AS device, blob4 AS locale,
       quantileExactWeighted(0.75)(double1, _sample_interval) AS p75,
       SUM(_sample_interval) AS samples
FROM al_ummah_now_rum
WHERE timestamp > NOW() - INTERVAL '7' DAY
GROUP BY metric, kind, device, locale
```

## Cost

About 3 data points per sampled page load (5% of loads), plus one Worker request per sampled load. Analytics Engine includes 10 million data points a month on Workers Paid.
