/**
 * Platform analytics reads (admin-api /api/ops/*, ops:read). Server components
 * only: not a 'use server' module, so nothing here is a client-callable action.
 */
import { fetchAdmin } from './request';
import type { OpsCosts, OpsEnv, OpsKind, OpsMetric, OpsOverview, OpsRange, OpsResource, OpsSeries } from './ops-types';

export async function getOpsOverview(env: OpsEnv): Promise<OpsOverview> {
  return fetchAdmin<OpsOverview>(`/api/ops/overview?env=${env}`);
}

export async function getOpsSeries(env: OpsEnv, kind: OpsKind, metric: OpsMetric, range: OpsRange): Promise<OpsSeries> {
  const q = new URLSearchParams({ env, kind, metric, range });
  return fetchAdmin<OpsSeries>(`/api/ops/series?${q}`);
}

export async function listOpsResources(env: OpsEnv, kind: OpsKind): Promise<OpsResource[]> {
  return (await fetchAdmin<{ resources: OpsResource[] }>(`/api/ops/resources?env=${env}&kind=${kind}`)).resources;
}

/** Spend against the $500 budget (every env and source), the idle projection and the top drivers. */
export async function getOpsCosts(env: 'all' | OpsEnv = 'all'): Promise<OpsCosts> {
  return fetchAdmin<OpsCosts>(`/api/ops/costs?env=${env}`);
}
