/**
 * GraphQL groups → one row per resource-hour (ops_hourly). Rows whose
 * script/bucket/database/queue is not in the manifest are dropped here, in
 * memory, before anything is written (docs/cost-monitoring/README.md §3.2).
 */
import type { ManifestIndex, Resource } from './manifest';
import { MP4_OBJECTS, type OpsResponse } from './graphql';

export const METRICS = [
  'requests',
  'errors',
  'cpu_p50',
  'cpu_p99',
  'latency_p50',
  'latency_p99',
  'reads',
  'writes',
  'bytes',
  'stored_bytes',
  'objects',
  'backlog_avg',
  'backlog_max',
] as const;
export type Metric = (typeof METRICS)[number];

export interface OpsRow {
  hour: string;
  resource: Resource;
  values: Partial<Record<Metric, number>>;
}

/** R2 Class A (mutating and list) operations; the rest that cost anything are Class B. Deletes are free. */
const R2_CLASS_A = new Set([
  'ListBuckets', 'PutBucket', 'ListObjects', 'PutObject', 'CopyObject', 'CompleteMultipartUpload', 'CreateMultipartUpload',
  'LifecycleStorageTierTransition', 'ListMultipartUploads', 'UploadPart', 'UploadPartCopy', 'ListParts', 'PutBucketEncryption',
  'PutBucketCors', 'PutBucketLifecycleConfiguration',
]);
const R2_FREE = new Set(['DeleteObject', 'DeleteBucket', 'AbortMultipartUpload', 'DeleteObjects']);

/** Normalizes a GraphQL hour to the stored form ('2026-11-12T14:00:00Z'). */
export function hourOf(value: string): string {
  const d = new Date(value);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString().replace('.000Z', 'Z');
}

export interface NormalizeResult {
  rows: OpsRow[];
  /** Groups dropped because they are not ours (should be 0: the query is filtered). */
  dropped: number;
}

export function normalize(data: OpsResponse, index: ManifestIndex): NormalizeResult {
  const rows = new Map<string, OpsRow>();
  let dropped = 0;
  const row = (resource: Resource | undefined, hourValue: string): OpsRow | null => {
    if (!resource) {
      dropped++;
      return null;
    }
    const hour = hourOf(hourValue);
    const key = `${hour}|${resource.id}`;
    let r = rows.get(key);
    if (!r) rows.set(key, (r = { hour, resource, values: {} }));
    return r;
  };
  const add = (r: OpsRow, m: Metric, v: number | undefined | null) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    r.values[m] = (r.values[m] ?? 0) + v;
  };
  const max = (r: OpsRow, m: Metric, v: number | undefined | null) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    r.values[m] = Math.max(r.values[m] ?? -Infinity, v);
  };

  // Workers: one group per status; sum the counts, request-weight the p50, keep the worst p99
  const cpuWeight = new Map<OpsRow, { w: number; sum: number }>();
  for (const g of data.workers ?? []) {
    const r = row(index.find('worker', g.dimensions.scriptName), g.dimensions.datetimeHour);
    if (!r) continue;
    add(r, 'requests', g.sum.requests);
    add(r, 'errors', g.sum.errors);
    max(r, 'cpu_p99', g.quantiles?.cpuTimeP99);
    if (g.sum.requests > 0 && typeof g.quantiles?.cpuTimeP50 === 'number') {
      const acc = cpuWeight.get(r) ?? { w: 0, sum: 0 };
      acc.w += g.sum.requests;
      acc.sum += g.sum.requests * g.quantiles.cpuTimeP50;
      cpuWeight.set(r, acc);
    }
  }
  for (const [r, acc] of cpuWeight) if (acc.w > 0) r.values.cpu_p50 = Math.round(acc.sum / acc.w);

  for (const g of data.d1 ?? []) {
    const r = row(index.find('d1', g.dimensions.databaseId), g.dimensions.datetimeHour);
    if (!r) continue;
    add(r, 'requests', g.sum.readQueries + g.sum.writeQueries);
    add(r, 'reads', g.sum.rowsRead);
    add(r, 'writes', g.sum.rowsWritten);
    max(r, 'latency_p50', g.quantiles?.queryBatchTimeMsP50);
    max(r, 'latency_p99', g.quantiles?.queryBatchTimeMsP99);
  }
  for (const g of data.d1Storage ?? []) {
    const r = row(index.find('d1', g.dimensions.databaseId), g.dimensions.datetimeHour);
    if (r) max(r, 'stored_bytes', g.max.databaseSizeBytes);
  }

  for (const g of data.r2 ?? []) {
    const r = row(index.find('r2', g.dimensions.bucketName), g.dimensions.datetimeHour);
    if (!r) continue;
    add(r, 'requests', g.sum.requests);
    add(r, 'bytes', g.sum.responseObjectSize);
    if (R2_CLASS_A.has(g.dimensions.actionType)) add(r, 'writes', g.sum.requests);
    else if (!R2_FREE.has(g.dimensions.actionType)) add(r, 'reads', g.sum.requests);
  }
  // The MP4 slice (manifest SLICES): its Class B reads move from the bucket's row to their own line
  for (const g of data.r2Mp4 ?? []) {
    const action = g.dimensions.actionType;
    if (R2_CLASS_A.has(action) || R2_FREE.has(action)) continue;
    const r = row(index.findSlice(g.dimensions.bucketName, MP4_OBJECTS), g.dimensions.datetimeHour);
    if (!r) continue;
    add(r, 'requests', g.sum.requests);
    add(r, 'reads', g.sum.requests);
    add(r, 'bytes', g.sum.responseObjectSize);
    const bucket = rows.get(`${r.hour}|r2:${g.dimensions.bucketName}`);
    if (!bucket) continue;
    for (const [m, v] of [['requests', g.sum.requests], ['reads', g.sum.requests], ['bytes', g.sum.responseObjectSize]] as const) {
      if (typeof v === 'number' && Number.isFinite(v) && typeof bucket.values[m] === 'number') bucket.values[m] = Math.max(0, bucket.values[m]! - v);
    }
  }
  for (const g of data.r2Storage ?? []) {
    const r = row(index.find('r2', g.dimensions.bucketName), g.dimensions.datetimeHour);
    if (!r) continue;
    max(r, 'stored_bytes', g.max.payloadSize);
    max(r, 'objects', g.max.objectCount);
  }

  // Queue backlog comes in 15-minute averages: the hour's mean and its worst quarter
  const backlog = new Map<OpsRow, number[]>();
  for (const g of data.queueBacklog ?? []) {
    const r = row(index.find('queue', g.dimensions.queueId), g.dimensions.datetimeFifteenMinutes);
    if (!r || typeof g.avg?.messages !== 'number') continue;
    const list = backlog.get(r) ?? [];
    list.push(g.avg.messages);
    backlog.set(r, list);
  }
  for (const [r, list] of backlog) {
    r.values.backlog_avg = Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 100) / 100;
    r.values.backlog_max = Math.max(...list);
  }
  for (const g of data.queueOps ?? []) {
    const r = row(index.find('queue', g.dimensions.queueId), g.dimensions.datetimeHour);
    if (!r) continue;
    if (g.dimensions.actionType === 'WriteMessage') {
      add(r, 'writes', g.count);
      add(r, 'requests', g.count);
    } else if (g.dimensions.actionType === 'ReadMessage') add(r, 'reads', g.count);
  }

  return { rows: [...rows.values()], dropped };
}
