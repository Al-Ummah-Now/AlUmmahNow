'use server';

/**
 * The Costs page (COST-1): the dashboard (ops:read) and its changes through admin-api /api/costs.
 * Connections and alert settings need ops:manage (super admins); everyone who opens the page
 * manages their own alert emails. A key passes through here once, to admin-api, which seals it:
 * it is never logged, returned or kept.
 */
import type { ActionResult } from './errors';
import { fetchAdmin, toResult } from './request';
import type { CostAlertKind, CostAlertSettings, CostCredentialResult, CostProvider, CostSubscription, CostsDashboard } from './costs-types';

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
