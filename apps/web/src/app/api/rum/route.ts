/**
 * POST /api/rum: field Core Web Vitals beacons (wiki AUN-SEO phase 4, #1207; D-SEO-9).
 *
 * Cookieless and anonymous: the body is a page kind, a device class, a locale and up to three metric
 * values (lib/rum/vitals.ts). No cookie, header or IP is read or kept; the user agent is looked at only to
 * drop beacons from automated browsers (E2E suites, Lighthouse: isAutomatedAgent) and is never stored. Each metric becomes
 * one Workers Analytics Engine data point (binding RUM): index = metric, blobs = metric, page kind,
 * device, locale, environment; double = value. Read p75s with the SQL API (docs/operations/rum.md,
 * scripts/ops/rum-report.ts). Always 204: a beacon never fails a page.
 */
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { logger } from '@/lib/logger-server';
import { isAutomatedAgent, parseRumBeacon, RUM_METRICS } from '@/lib/rum/vitals';

/** Workers Analytics Engine dataset binding (wrangler analytics_engine_datasets) */
interface AnalyticsEngineDataset {
  writeDataPoint(point: { indexes?: string[]; blobs?: string[]; doubles?: number[] }): void;
}

/** A beacon is a few dozen bytes; anything larger is not one */
const MAX_BODY_BYTES = 512;

const noContent = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request): Promise<Response> {
  if (isAutomatedAgent(request.headers.get('user-agent'))) return noContent();
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return noContent();
  }
  if (!raw || raw.length > MAX_BODY_BYTES) return noContent();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return noContent();
  }
  const beacon = parseRumBeacon(body);
  if (!beacon) return noContent();

  let dataset: AnalyticsEngineDataset | undefined;
  let environment = 'local';
  try {
    const { env } = await getCloudflareContext({ async: true });
    const e = env as unknown as { RUM?: AnalyticsEngineDataset; NEXTJS_ENV?: string };
    dataset = e.RUM;
    environment = e.NEXTJS_ENV || environment;
  } catch {
    dataset = undefined;
  }
  // Local development and the local stack have no dataset: the beacon is accepted and dropped
  if (!dataset) return noContent();
  try {
    for (const metric of RUM_METRICS) {
      const value = beacon.m[metric];
      if (value === undefined) continue;
      dataset.writeDataPoint({ indexes: [metric], blobs: [metric, beacon.k, beacon.d, beacon.l, environment], doubles: [value] });
    }
  } catch (error) {
    logger.warn('[rum] Analytics Engine write failed', { error: error instanceof Error ? error.message : String(error) });
  }
  return noContent();
}
