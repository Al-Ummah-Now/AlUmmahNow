'use server';

/**
 * The Costs page (COST-1): the dashboard (ops:read) and its changes through admin-api /api/costs.
 * Connections and alert settings need ops:manage (super admins); everyone who opens the page
 * manages their own alert emails. A key passes through here once, to admin-api, which seals it:
 * it is never logged, returned or kept.
 */
import type { ActionResult } from './errors';
import { fetchAdmin, toResult } from './request';
import type { CostAlertKind, CostAlertSettings, CostCredentialResult, CostDatabases, CostProvider, CostSubscription, CostsDashboard, FixedCost, FixedCostInput } from './costs-types';

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const credentialPath = (provider: CostProvider, test = false) => `/api/costs/credentials/${encodeURIComponent(provider)}${test ? '/test' : ''}`;

/** The one admin-set monthly budget (Costs → Alert settings, #1427); null while unset. */
export async function getMonthlyBudget(): Promise<number | null> {
  return (await fetchAdmin<{ budgetUsd: number | null }>('/api/costs/budget')).budgetUsd;
}

export async function getCostsDashboard(): Promise<CostsDashboard> {
  return fetchAdmin<CostsDashboard>('/api/costs');
}

/** Stores the key (replacing any) and tests it. */
export async function saveCostCredential(provider: CostProvider, value: string): Promise<ActionResult<CostCredentialResult>> {
  return toResult(() => fetchAdmin<CostCredentialResult>(credentialPath(provider), json('PUT', { value })));
}

export async function testCostCredential(provider: CostProvider): Promise<ActionResult<CostCredentialResult>> {
  return toResult(() => fetchAdmin<CostCredentialResult>(credentialPath(provider, true), { method: 'POST' }));
}

export async function removeCostCredential(provider: CostProvider): Promise<ActionResult<{ provider: CostProvider; set: false }>> {
  return toResult(() => fetchAdmin<{ provider: CostProvider; set: false }>(credentialPath(provider), { method: 'DELETE' }));
}

export async function saveCostSettings(settings: CostAlertSettings): Promise<ActionResult<CostAlertSettings>> {
  return toResult(() => fetchAdmin<CostAlertSettings>('/api/costs/settings', json('PUT', settings)));
}

export async function saveMyCostAlerts(kinds: CostAlertKind[], locale: 'en' | 'ar'): Promise<ActionResult<CostSubscription>> {
  return toResult(() => fetchAdmin<CostSubscription>('/api/costs/subscriptions/me', json('PUT', { kinds, locale })));
}

/** D1 capacity (wiki AUN-D1-SCALING D1-1): every database against the limits, the account total and the capacity rules. */
export async function getCostDatabases(): Promise<CostDatabases> {
  return fetchAdmin<CostDatabases>('/api/costs/databases');
}

/** The limits the capacity alerts judge against, in whole GB (ops:manage). */
export async function saveD1Limits(maxDbGb: number, accountGb: number): Promise<ActionResult<{ maxDbBytes: number; accountBytes: number }>> {
  return toResult(() => fetchAdmin<{ maxDbBytes: number; accountBytes: number }>('/api/costs/d1-limits', json('PUT', { maxDbGb, accountGb })));
}

/** One capacity rule's value and switch (admin-api PUT /api/ops/thresholds/:id, ops:manage, audited). */
export async function saveCapacityRule(id: string, value: number, enabled: boolean): Promise<ActionResult<{ id: string }>> {
  return toResult(() => fetchAdmin<{ id: string }>(`/api/ops/thresholds/${encodeURIComponent(id)}`, json('PUT', { value, enabled })));
}

/** Adds a fixed or other cost (id null) or changes one (ops:manage; audited by admin-api). */
export async function saveFixedCost(id: string | null, input: FixedCostInput): Promise<ActionResult<FixedCost>> {
  return toResult(() => (id ? fetchAdmin<FixedCost>(`/api/costs/fixed/${encodeURIComponent(id)}`, json('PUT', input)) : fetchAdmin<FixedCost>('/api/costs/fixed', json('POST', input))));
}

export async function removeFixedCost(id: string): Promise<ActionResult<unknown>> {
  return toResult(() => fetchAdmin<unknown>(`/api/costs/fixed/${encodeURIComponent(id)}`, { method: 'DELETE' }));
}
