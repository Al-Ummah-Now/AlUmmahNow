/**
 * The collector's one Cloudflare GraphQL request per run (cost guard,
 * docs/admin/LIVE_OPS.md §A.2): every dataset is an aliased field of the same
 * account query, filtered with `_in` to the manifest's names/ids. Field names
 * were checked against the live schema on 2026-11-12 (test/fixtures).
 *
 * The token never leaves this module and is never logged; responses are
 * normalized in memory and only counts are logged.
 */
import type { ManifestIndex } from './manifest';

export const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';

/** Objects of the MP4 slice (manifest SLICES): the progressive MP4 (#1182); a plain %.mp4 would also count every HLS rung's init.mp4. */
export const MP4_OBJECTS = '%/video.mp4';

export const OPS_QUERY = `query Ops($a: String!, $s: Time!, $e: Time!, $w: [String!], $b: [String!], $m: [String!], $d: [String!], $q: [String!]) {
  viewer { accounts(filter: { accountTag: $a }) {
    workers: workersInvocationsAdaptive(limit: 5000, filter: { datetime_geq: $s, datetime_lt: $e, scriptName_in: $w }) {
      dimensions { scriptName datetimeHour status }
      sum { requests errors subrequests cpuTimeUs }
      quantiles { cpuTimeP50 cpuTimeP99 }
    }
    d1: d1AnalyticsAdaptiveGroups(limit: 2000, filter: { datetime_geq: $s, datetime_lt: $e, databaseId_in: $d }) {
      dimensions { databaseId datetimeHour }
      sum { readQueries writeQueries rowsRead rowsWritten }
      quantiles { queryBatchTimeMsP50 queryBatchTimeMsP99 }
    }
    d1Storage: d1StorageAdaptiveGroups(limit: 2000, filter: { datetime_geq: $s, datetime_lt: $e, databaseId_in: $d }) {
      dimensions { databaseId datetimeHour }
      max { databaseSizeBytes }
    }
    r2: r2OperationsAdaptiveGroups(limit: 5000, filter: { datetime_geq: $s, datetime_lt: $e, bucketName_in: $b }) {
      dimensions { bucketName datetimeHour actionType }
      sum { requests responseObjectSize }
    }
    r2Mp4: r2OperationsAdaptiveGroups(limit: 2000, filter: { datetime_geq: $s, datetime_lt: $e, bucketName_in: $m, objectName_like: "${MP4_OBJECTS}" }) {
      dimensions { bucketName datetimeHour actionType }
      sum { requests responseObjectSize }
    }
    r2Storage: r2StorageAdaptiveGroups(limit: 2000, filter: { datetime_geq: $s, datetime_lt: $e, bucketName_in: $b }) {
      dimensions { bucketName datetimeHour }
      max { payloadSize objectCount }
    }
    queueBacklog: queueBacklogAdaptiveGroups(limit: 5000, filter: { datetime_geq: $s, datetime_lt: $e, queueId_in: $q }) {
      dimensions { queueId datetimeFifteenMinutes }
      avg { messages }
    }
    queueOps: queueMessageOperationsAdaptiveGroups(limit: 5000, filter: { datetime_geq: $s, datetime_lt: $e, queueId_in: $q }) {
      count
      dimensions { queueId datetimeHour actionType }
    }
  } }
}`;

export interface OpsResponse {
  workers?: { dimensions: { scriptName: string; datetimeHour: string; status: string }; sum: { requests: number; errors: number; subrequests: number; cpuTimeUs: number }; quantiles: { cpuTimeP50: number; cpuTimeP99: number } }[];
  d1?: { dimensions: { databaseId: string; datetimeHour: string }; sum: { readQueries: number; writeQueries: number; rowsRead: number; rowsWritten: number }; quantiles: { queryBatchTimeMsP50: number; queryBatchTimeMsP99: number } }[];
  d1Storage?: { dimensions: { databaseId: string; datetimeHour: string }; max: { databaseSizeBytes: number } }[];
  r2?: { dimensions: { bucketName: string; datetimeHour: string; actionType: string }; sum: { requests: number; responseObjectSize: number } }[];
  /** The media buckets' *.mp4 operations (the MP4 slice line) */
  r2Mp4?: { dimensions: { bucketName: string; datetimeHour: string; actionType: string }; sum: { requests: number; responseObjectSize: number } }[];
  r2Storage?: { dimensions: { bucketName: string; datetimeHour: string }; max: { payloadSize: number; objectCount: number } }[];
  queueBacklog?: { dimensions: { queueId: string; datetimeFifteenMinutes: string }; avg: { messages: number } }[];
  queueOps?: { count: number; dimensions: { queueId: string; datetimeHour: string; actionType: string } }[];
}

export interface QueryResult {
  data: OpsResponse;
  /** Dataset errors (messages only); data for the other datasets is still used. */
  errors: string[];
}

export function queryVariables(accountId: string, index: ManifestIndex, start: Date, end: Date) {
  return {
    a: accountId,
    s: start.toISOString(),
    e: end.toISOString(),
    w: index.keys('worker'),
    b: index.keys('r2'),
    m: index.sliceBuckets(MP4_OBJECTS),
    d: index.keys('d1'),
    q: index.keys('queue'),
  };
}

/** Runs the ops query. Throws only when no data came back at all. */
export async function runOpsQuery(
  token: string,
  variables: ReturnType<typeof queryVariables>,
  fetchImpl: typeof fetch = fetch,
): Promise<QueryResult> {
  const res = await fetchImpl(GRAPHQL_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: OPS_QUERY, variables }),
  });
  if (!res.ok) throw new Error(`Cloudflare GraphQL answered HTTP ${res.status}`);
  const body = (await res.json()) as { data?: { viewer?: { accounts?: OpsResponse[] } } | null; errors?: { message?: string }[] | null };
  const errors = (body.errors ?? []).map((e) => String(e?.message ?? 'unknown error').slice(0, 200));
  const account = body.data?.viewer?.accounts?.[0];
  if (!account) throw new Error(`Cloudflare GraphQL returned no data${errors.length ? `: ${errors[0]}` : ''}`);
  return { data: account, errors };
}
